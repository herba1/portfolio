import * as THREE from "three";

import { loadStreamChunk } from "./loadSplat4d";
import { bindStreamChunk, createPairTextures, createSplatGeometry, createStreamMaterial } from "./splatMaterial";
import { SORT, STREAM, sortCapacity } from "./splatVideoParams";

function boundsArrays(bounds) {
  const { min, max } = bounds;
  return { boundsMin: min, boundsSize: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

function sameRequest(a, b) {
  if (!a || !b) return false;
  if (a.chunk !== b.chunk || a.token !== b.token || a.moment !== b.moment) return false;
  for (let k = 0; k < 4; k += 1) if (Math.abs(a.zRow[k] - b.zRow[k]) > SORT.depthEpsilon) return false;
  return true;
}

function chunkLookup(meta) {
  const lookup = new Int32Array(meta.frames);
  for (const chunk of meta.chunks) lookup.fill(chunk.index, chunk.firstMoment, chunk.firstMoment + chunk.moments);
  return lookup;
}

export function chunkWindow(current, total) {
  const steps = [0];
  for (let k = 1; k <= STREAM.ahead; k += 1) steps.push(k);
  for (let k = 1; k <= STREAM.behind; k += 1) steps.push(-k);
  const wanted = [];
  for (const step of steps) {
    const index = (((current + step) % total) + total) % total;
    if (!wanted.includes(index)) wanted.push(index);
  }
  return wanted;
}

export function createStreamRuntime(clip) {
  const { meta } = clip;
  const chunkOf = chunkLookup(meta);
  const capacity = sortCapacity(meta);
  const staticPair = createPairTextures(clip.staticSet);
  const material = createStreamMaterial(staticPair, meta.static);
  const geometry = createSplatGeometry(capacity);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  const worker = new Worker(new URL("./sortWorker.js", import.meta.url), { type: "module" });
  const staticPoints = clip.staticSet.points.slice(0, meta.static.count * 4);
  worker.postMessage(
    { type: "stream", staticPoints, staticCount: meta.static.count, capacity, ...boundsArrays(meta.static.bounds) },
    [staticPoints.buffer],
  );

  const resident = new Map();
  const loading = new Map();
  const retryAt = new Map();
  const uploads = [];
  const sorter = { inFlight: false, sent: null, wanted: null, recycle: null, id: 0 };
  let disposed = false;
  let nextToken = 1;
  let focusIndex = 0;
  let shown = null;

  const isResident = (entry) => resident.get(entry.index) === entry;

  const adopt = (index, data) => {
    const set = meta.chunks[index];
    const entry = { index, token: nextToken, set, data, pair: createPairTextures(data) };
    nextToken += 1;
    const points = data.points.slice(0, set.count * 4);
    worker.postMessage(
      { type: "chunk", index, token: entry.token, points, frameOffsets: set.frameOffsets, ...boundsArrays(set.bounds) },
      [points.buffer],
    );
    resident.set(index, entry);
    uploads.push({ entry, texture: entry.pair.baseTexture }, { entry, texture: entry.pair.pointsTexture });
  };

  const evict = (entry) => {
    resident.delete(entry.index);
    entry.pair.dispose();
    entry.data = null;
    worker.postMessage({ type: "drop", index: entry.index, token: entry.token });
  };

  function fetchChunk(index) {
    const job = new AbortController();
    loading.set(index, job);
    loadStreamChunk(clip, index, { signal: job.signal }).then(
      (data) => {
        if (disposed || loading.get(index) !== job) return;
        loading.delete(index);
        retryAt.delete(index);
        adopt(index, data);
        schedule();
      },
      (error) => {
        if (disposed || loading.get(index) !== job) return;
        loading.delete(index);
        if (error?.name !== "AbortError") retryAt.set(index, performance.now() + STREAM.retryMs);
        schedule();
      },
    );
  }

  function schedule() {
    if (disposed) return;
    const wanted = chunkWindow(focusIndex, meta.chunks.length);
    for (const entry of [...resident.values()]) {
      if (!wanted.includes(entry.index) && entry !== shown?.entry) evict(entry);
    }
    const now = performance.now();
    const missing = wanted.filter((index) => !resident.has(index) && !((retryAt.get(index) ?? 0) > now));
    const running = missing.slice(0, STREAM.parallelFetches);
    for (const [index, job] of [...loading]) {
      if (running.includes(index)) continue;
      loading.delete(index);
      job.abort();
    }
    for (const index of running) if (!loading.has(index)) fetchChunk(index);
  }

  const send = () => {
    if (disposed || sorter.inFlight || !sorter.wanted) return;
    if (sameRequest(sorter.sent, sorter.wanted)) return;
    const request = sorter.wanted;
    const recycle = sorter.recycle;
    sorter.recycle = null;
    sorter.inFlight = true;
    sorter.sent = request;
    sorter.id += 1;
    worker.postMessage({ type: "sortChunk", id: sorter.id, ...request, recycle }, recycle ? [recycle.buffer] : []);
  };

  worker.onmessage = (event) => {
    const reply = event.data;
    if (disposed || reply?.type !== "sorted") return;
    sorter.inFlight = false;
    const entry = resident.get(reply.chunk);
    if (reply.missing || !entry || entry.token !== reply.token) {
      if (reply.order) sorter.recycle = reply.order;
      sorter.sent = null;
      return;
    }
    const attribute = geometry.getAttribute("aSplat");
    sorter.recycle = attribute.array;
    attribute.array = reply.order;
    attribute.needsUpdate = true;
    geometry.instanceCount = reply.count;
    bindStreamChunk(material, entry.pair, entry.set);
    material.uniforms.uMomentTime.value = momentTime(meta, entry.set.firstMoment + reply.moment);
    const previous = shown?.entry;
    shown = { entry, moment: reply.moment };
    if (previous && previous !== entry) schedule();
    send();
  };

  worker.onerror = () => {
    sorter.inFlight = false;
  };

  for (const [index, data] of clip.handoff) adopt(index, data);
  clip.handoff.clear();

  return {
    mesh,
    material,
    focus(moment) {
      focusIndex = chunkOf[moment];
      schedule();
      return resident.has(focusIndex);
    },
    want(zRow, moment) {
      const entry = resident.get(chunkOf[moment]);
      if (entry) {
        sorter.wanted = { zRow, chunk: entry.index, token: entry.token, moment: moment - entry.set.firstMoment };
      } else if (shown && isResident(shown.entry)) {
        sorter.wanted = { zRow, chunk: shown.entry.index, token: shown.entry.token, moment: shown.moment };
      } else {
        sorter.wanted = null;
      }
      send();
    },
    upload(gl) {
      while (uploads.length > 0) {
        const { entry, texture } = uploads.shift();
        if (!isResident(entry)) continue;
        gl.initTexture(texture);
        return;
      }
    },
    dispose() {
      disposed = true;
      for (const job of loading.values()) job.abort();
      loading.clear();
      worker.terminate();
      for (const entry of resident.values()) {
        entry.pair.dispose();
        clip.handoff.set(entry.index, entry.data);
      }
      resident.clear();
      uploads.length = 0;
      shown = null;
      staticPair.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}

function momentTime(meta, moment) {
  if (Array.isArray(meta.times) && meta.times[moment] !== undefined) return meta.times[moment];
  return moment / Math.max(1, meta.fps);
}
