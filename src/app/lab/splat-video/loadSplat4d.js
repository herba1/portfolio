import { CLIP_NAME_RE, EXPORTS_ROOT, FALLBACK_CLIP, TEXTURE_WIDTH, clipKind } from "./splatVideoParams";

const EVALUATION_PREFIX = "eval-";

const ASSET_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

export class Splat4dError extends Error {
  constructor(message, { clip = null, missing = false } = {}) {
    super(message);
    this.name = "Splat4dError";
    this.clip = clip;
    this.missing = missing;
  }
}

function entryName(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry.name === "string") return entry.name;
  return null;
}

function indexEntries(index) {
  if (Array.isArray(index)) return index;
  if (index && Array.isArray(index.exports)) return index.exports;
  if (index && Array.isArray(index.clips)) return index.clips;
  return [];
}

async function readIndexNames(signal) {
  const response = await fetch(`${EXPORTS_ROOT}/index.json`, { cache: "no-store", signal });
  if (!response.ok) return [];
  return indexEntries(await response.json())
    .map(entryName)
    .filter((name) => name && CLIP_NAME_RE.test(name));
}

export async function resolveClip(requested, signal) {
  if (requested) {
    if (!CLIP_NAME_RE.test(requested)) throw new Splat4dError(`“${requested}” is not a valid clip name.`, { clip: requested });
    return requested;
  }
  try {
    const names = await readIndexNames(signal);
    return names.find((name) => name !== FALLBACK_CLIP && !name.startsWith(EVALUATION_PREFIX)) ?? FALLBACK_CLIP;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return FALLBACK_CLIP;
  }
}

async function readKind(name, signal) {
  try {
    const response = await fetch(`${EXPORTS_ROOT}/${name}/meta.json`, { cache: "no-store", signal });
    if (!response.ok) return null;
    return clipKind(await response.json());
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return null;
  }
}

export async function listClips(signal) {
  let names;
  try {
    names = [...new Set(await readIndexNames(signal))].filter((name) => !name.startsWith(EVALUATION_PREFIX));
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return [];
  }
  const kinds = await Promise.all(names.map((name) => readKind(name, signal)));
  return names.map((name, i) => ({ name, kind: kinds[i] }));
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function isVector(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function optionalAsset(value, fail, what) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !ASSET_NAME_RE.test(value)) fail(`has an invalid ${what} file name.`);
  return value;
}

function validateRgbd(meta, fail) {
  if (!Number.isInteger(meta.frames) || meta.frames < 1) fail("has no frames.");
  if (!(meta.fps > 0)) fail("has no fps.");
  if (!(meta.duration > 0)) fail("has no duration.");
  if (!(meta.camera?.vfovDeg > 0 && meta.camera.vfovDeg < 170)) fail("has no camera.vfovDeg.");
  const near = meta.disparity?.max;
  const far = meta.disparity?.min;
  if (!Number.isFinite(near) || !Number.isFinite(far) || far < 0 || near <= far) fail("has an invalid disparity range.");
  const video = optionalAsset(meta.video, fail, "video");
  if (!video) fail("names no video.");
  const plate = optionalAsset(meta.plate, fail, "plate");
  const source = meta.source ?? {};
  if (!isPositiveInteger(source.width) || !isPositiveInteger(source.height)) fail("has no source size.");
  const colorAspect = isPositiveInteger(source.colorWidth) && isPositiveInteger(source.colorHeight)
    ? source.colorWidth / source.colorHeight
    : source.width / source.height;
  return {
    ...meta,
    count: isCount(meta.count) ? meta.count : 0,
    video,
    plate,
    disparity: { min: far, max: near },
    camera: {
      vfovDeg: meta.camera.vfovDeg,
      aspect: meta.camera.aspect > 0 ? meta.camera.aspect : colorAspect,
      pivotDepth: meta.camera.pivotDepth > 0 ? meta.camera.pivotDepth : 2 / (far + near),
    },
  };
}

function isAscending(values) {
  return values.every((value, i) => Number.isFinite(value) && (i === 0 || value >= values[i - 1]));
}

function isOffsets(offsets, moments, count) {
  return (
    Array.isArray(offsets) &&
    offsets.length === moments + 1 &&
    offsets.every(isCount) &&
    offsets[0] === 0 &&
    offsets[moments] === count &&
    isAscending(offsets)
  );
}

function validateSplatSet(set, fail, what) {
  if (!set || !isCount(set.count)) fail(`has an invalid ${what} count.`);
  if (set.count === 0) return { count: 0, base: null, points: null, bounds: { min: [0, 0, 0], max: [1, 1, 1] }, covScale: 1 };
  const base = optionalAsset(set.base, fail, `${what} base`);
  const points = optionalAsset(set.points, fail, `${what} points`);
  if (!base || !points) fail(`names no ${what} files.`);
  if (!isVector(set.bounds?.min) || !isVector(set.bounds?.max)) fail(`has invalid ${what} bounds.`);
  if (!(set.covScale > 0)) fail(`has an invalid ${what} covScale.`);
  return { count: set.count, base, points, bounds: { min: set.bounds.min, max: set.bounds.max }, covScale: set.covScale };
}

function validateStream(meta, fail) {
  if (!Number.isInteger(meta.frames) || meta.frames < 1) fail("has no frames.");
  if (!(meta.fps > 0)) fail("has no fps.");
  if (!(meta.duration > 0)) fail("has no duration.");
  if (!(meta.camera?.vfovDeg > 0 && meta.camera.vfovDeg < 170)) fail("has no camera.vfovDeg.");
  if (meta.times !== undefined && (!Array.isArray(meta.times) || meta.times.length !== meta.frames || !isAscending(meta.times))) {
    fail("has invalid times.");
  }
  const audio = optionalAsset(meta.audio, fail, "audio");
  const staticSet = validateSplatSet(meta.static ?? { count: 0 }, fail, "static");
  if (!Array.isArray(meta.chunks) || meta.chunks.length === 0) fail("has no chunks.");
  let firstMoment = 0;
  const chunks = meta.chunks.map((chunk, index) => {
    const what = `chunk ${index}`;
    if (!chunk || (chunk.index ?? index) !== index || chunk.firstMoment !== firstMoment) fail(`has ${what} out of order.`);
    if (!isPositiveInteger(chunk.moments)) fail(`has ${what} with no moments.`);
    const set = validateSplatSet(chunk, fail, what);
    if (!isOffsets(chunk.frameOffsets, chunk.moments, set.count)) fail(`has invalid frameOffsets in ${what}.`);
    firstMoment += chunk.moments;
    return { ...set, index, firstMoment: chunk.firstMoment, moments: chunk.moments, frameOffsets: chunk.frameOffsets };
  });
  if (firstMoment !== meta.frames) fail("has chunks that do not add up to frames.");
  if (staticSet.count === 0 && chunks.every((chunk) => chunk.count === 0)) fail("has no splats.");
  const depthSource = staticSet.count > 0 ? staticSet : chunks.find((chunk) => chunk.count > 0);
  const middleZ = (depthSource.bounds.min[2] + depthSource.bounds.max[2]) / 2;
  return {
    ...meta,
    audio,
    static: staticSet,
    staticCount: staticSet.count,
    chunks,
    camera: {
      vfovDeg: meta.camera.vfovDeg,
      aspect: meta.camera.aspect > 0 ? meta.camera.aspect : 16 / 9,
      pivotDepth: meta.camera.pivotDepth > 0 ? meta.camera.pivotDepth : Math.max(0.5, middleZ),
    },
  };
}

function validateMeta(meta, clip) {
  const fail = (why) => {
    throw new Splat4dError(`meta.json for “${clip}” ${why}`, { clip });
  };
  if (!meta || meta.format !== "splat4d") fail("is not a splat4d export.");
  if (meta.version === 3) {
    if (meta.kind !== "stream") fail(`has an unknown kind “${meta.kind}”.`);
    return validateStream(meta, fail);
  }
  if (meta.version === 2 && meta.kind === "rgbd") return validateRgbd(meta, fail);
  if (meta.version === 2) {
    if (meta.kind !== "flipbook") fail(`has an unknown kind “${meta.kind}”.`);
    if (!isCount(meta.count) || !isCount(meta.staticCount)) fail("has invalid counts.");
    if (!(meta.fps > 0)) fail("has no fps.");
    const offsets = meta.frameOffsets;
    if (!Array.isArray(offsets) || offsets.length !== meta.frames + 1 || !offsets.every(isCount)) fail("has invalid frameOffsets.");
    if (meta.staticCount + offsets[offsets.length - 1] !== meta.count) fail("has frameOffsets that do not add up to count.");
  } else if (meta.version === 1) {
    if (!isCount(meta.count) || !isCount(meta.staticCount) || !isCount(meta.dynamicCount)) fail("has invalid counts.");
    if (meta.count !== meta.staticCount + meta.dynamicCount) fail("has a count that is not static plus dynamic.");
  } else {
    fail(`is version ${meta.version}; this player reads versions 1, 2 and 3.`);
  }
  if (meta.count === 0) fail("has no splats.");
  if (!Number.isInteger(meta.frames) || meta.frames < 1) fail("has no frames.");
  if (!(meta.duration > 0)) fail("has no duration.");
  if (!isVector(meta.bounds?.min) || !isVector(meta.bounds?.max)) fail("has invalid bounds.");
  if (!(meta.covScale > 0)) fail("has an invalid covScale.");
  if (!(meta.camera?.vfovDeg > 0 && meta.camera.vfovDeg < 170)) fail("has no camera.vfovDeg.");
  const [, , minZ] = meta.bounds.min;
  const [, , maxZ] = meta.bounds.max;
  return {
    ...meta,
    camera: {
      vfovDeg: meta.camera.vfovDeg,
      aspect: meta.camera.aspect > 0 ? meta.camera.aspect : 16 / 9,
      pivotDepth: meta.camera.pivotDepth > 0 ? meta.camera.pivotDepth : Math.max(0.5, (minZ + maxZ) / 2),
    },
  };
}

function versionQuery(meta) {
  return `?v=${encodeURIComponent(String(meta.exportId ?? "0"))}`;
}

function rowsFor(count) {
  return Math.max(1, Math.ceil(count / TEXTURE_WIDTH));
}

function linearWriter(bytes) {
  return (chunk, offset) => bytes.set(chunk, offset);
}

function frameMajorWriter(bytes, frameBytes, layerBytes) {
  return (chunk, offset) => {
    let read = 0;
    while (read < chunk.length) {
      const source = offset + read;
      const frame = Math.floor(source / frameBytes);
      const within = source - frame * frameBytes;
      const take = Math.min(chunk.length - read, frameBytes - within);
      bytes.set(chunk.subarray(read, read + take), frame * layerBytes + within);
      read += take;
    }
  };
}

async function streamInto({ url, name, clip, expected, write, signal, onChunk }) {
  if (expected === 0) return;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Splat4dError(`${name} for “${clip}” answered ${response.status}.`, { clip, missing: response.status === 404 });
  }
  const tooLong = () => new Splat4dError(`${name} for “${clip}” is larger than meta.json says (${expected} bytes).`, { clip });
  let received = 0;
  if (!response.body) {
    const whole = new Uint8Array(await response.arrayBuffer());
    if (whole.length > expected) throw tooLong();
    write(whole, 0);
    received = whole.length;
    onChunk(whole.length);
  } else {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.length > expected) {
        reader.cancel();
        throw tooLong();
      }
      write(value, received);
      received += value.length;
      onChunk(value.length);
    }
  }
  if (received !== expected) {
    throw new Splat4dError(`${name} for “${clip}” is ${received} bytes; meta.json expects ${expected}.`, { clip });
  }
}

export async function loadSplat4d(clip, { signal, onProgress } = {}) {
  const folder = `${EXPORTS_ROOT}/${clip}`;
  let response;
  try {
    response = await fetch(`${folder}/meta.json`, { cache: "no-store", signal });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Splat4dError(`Could not reach ${folder}/meta.json.`, { clip });
  }
  if (response.status === 404) throw new Splat4dError(`No export named “${clip}” yet.`, { clip, missing: true });
  if (!response.ok) throw new Splat4dError(`${folder}/meta.json answered ${response.status}.`, { clip });

  let raw;
  try {
    raw = await response.json();
  } catch {
    throw new Splat4dError(`meta.json for “${clip}” is not valid JSON.`, { clip, missing: true });
  }
  const meta = validateMeta(raw, clip);
  if (meta.kind === "stream") return loadStream(clip, folder, meta, { signal, onProgress });
  if (meta.kind === "rgbd") return loadRgbd(clip, folder, meta, { signal, onProgress });
  if (meta.kind === "flipbook") return loadFlipbook(clip, folder, meta, { signal, onProgress });

  const baseRows = rowsFor(meta.count);
  const staticRows = rowsFor(meta.staticCount);
  const dynamicRows = rowsFor(meta.dynamicCount);
  const layerTexels = TEXTURE_WIDTH * dynamicRows;

  const base = new Uint32Array(TEXTURE_WIDTH * baseRows * 4);
  const staticPoints = new Uint16Array(TEXTURE_WIDTH * staticRows * 4);
  const dynamicPoints = new Uint16Array(layerTexels * meta.frames * 4);

  const expected = {
    base: meta.count * 16,
    static: meta.staticCount * 8,
    dynamic: meta.frames * meta.dynamicCount * 8,
  };
  const total = expected.base + expected.static + expected.dynamic;
  let loaded = 0;
  const onChunk = (bytes) => {
    loaded += bytes;
    if (onProgress) onProgress(loaded, total);
  };
  if (onProgress) onProgress(0, total);

  const version = versionQuery(meta);
  await Promise.all([
    streamInto({
      url: `${folder}/base.bin${version}`,
      name: "base.bin",
      clip,
      expected: expected.base,
      write: linearWriter(new Uint8Array(base.buffer)),
      signal,
      onChunk,
    }),
    streamInto({
      url: `${folder}/static.bin${version}`,
      name: "static.bin",
      clip,
      expected: expected.static,
      write: linearWriter(new Uint8Array(staticPoints.buffer)),
      signal,
      onChunk,
    }),
    streamInto({
      url: `${folder}/dynamic.bin${version}`,
      name: "dynamic.bin",
      clip,
      expected: expected.dynamic,
      write: frameMajorWriter(new Uint8Array(dynamicPoints.buffer), meta.dynamicCount * 8, layerTexels * 8),
      signal,
      onChunk,
    }),
  ]);

  return {
    clip,
    meta,
    bytes: total,
    base,
    staticPoints,
    dynamicPoints,
    layout: { width: TEXTURE_WIDTH, baseRows, staticRows, dynamicRows, layerTexels },
  };
}

async function loadFlipbook(clip, folder, meta, { signal, onProgress }) {
  const rows = rowsFor(meta.count);
  const base = new Uint32Array(TEXTURE_WIDTH * rows * 4);
  const points = new Uint16Array(TEXTURE_WIDTH * rows * 4);
  const expected = { base: meta.count * 16, points: meta.count * 8 };
  const total = expected.base + expected.points;
  let loaded = 0;
  const onChunk = (bytes) => {
    loaded += bytes;
    if (onProgress) onProgress(loaded, total);
  };
  if (onProgress) onProgress(0, total);

  const version = versionQuery(meta);
  await Promise.all([
    streamInto({
      url: `${folder}/base.bin${version}`,
      name: "base.bin",
      clip,
      expected: expected.base,
      write: linearWriter(new Uint8Array(base.buffer)),
      signal,
      onChunk,
    }),
    streamInto({
      url: `${folder}/points.bin${version}`,
      name: "points.bin",
      clip,
      expected: expected.points,
      write: linearWriter(new Uint8Array(points.buffer)),
      signal,
      onChunk,
    }),
  ]);

  return {
    clip,
    meta: { ...meta, dynamicCount: 0 },
    bytes: total,
    base,
    staticPoints: points,
    dynamicPoints: new Uint16Array(4),
    layout: { width: TEXTURE_WIDTH, baseRows: rows, staticRows: rows, dynamicRows: 1, layerTexels: 1 },
  };
}

async function fetchSplatSet({ folder, version, clip, set, signal, onChunk }) {
  const rows = rowsFor(set.count);
  const base = new Uint32Array(TEXTURE_WIDTH * rows * 4);
  const points = new Uint16Array(TEXTURE_WIDTH * rows * 4);
  if (set.count > 0) {
    await Promise.all([
      streamInto({
        url: `${folder}/${set.base}${version}`,
        name: set.base,
        clip,
        expected: set.count * 16,
        write: linearWriter(new Uint8Array(base.buffer)),
        signal,
        onChunk,
      }),
      streamInto({
        url: `${folder}/${set.points}${version}`,
        name: set.points,
        clip,
        expected: set.count * 8,
        write: linearWriter(new Uint8Array(points.buffer)),
        signal,
        onChunk,
      }),
    ]);
  }
  const velocity = set.velocity && set.count > 0 ? await fetchVelocity({ folder, version, clip, set, rows, signal }) : null;
  return { count: set.count, rows, base, points, velocity };
}

async function fetchVelocity({ folder, version, clip, set, rows, signal }) {
  const response = await fetch(`${folder}/${set.velocity}${version}`, { signal });
  if (!response.ok) throw new Splat4dError(`${set.velocity} for “${clip}” answered ${response.status}.`, { clip });
  const packed = new Uint16Array(await response.arrayBuffer());
  if (packed.length !== set.count * 3) {
    throw new Splat4dError(`${set.velocity} for “${clip}” holds ${packed.length / 3} splats; meta.json expects ${set.count}.`, { clip });
  }
  const texels = new Uint16Array(TEXTURE_WIDTH * rows * 4);
  for (let i = 0; i < set.count; i += 1) {
    texels[i * 4] = packed[i * 3];
    texels[i * 4 + 1] = packed[i * 3 + 1];
    texels[i * 4 + 2] = packed[i * 3 + 2];
  }
  return texels;
}

async function loadStream(clip, folder, meta, { signal, onProgress }) {
  const version = versionQuery(meta);
  const first = meta.chunks[0];
  const total = (meta.static.count + first.count) * 24;
  let loaded = 0;
  const onChunk = (bytes) => {
    loaded += bytes;
    if (onProgress) onProgress(loaded, total);
  };
  if (onProgress) onProgress(0, total);
  const staticSet = await fetchSplatSet({ folder, version, clip, set: meta.static, signal, onChunk });
  const firstChunk = await fetchSplatSet({ folder, version, clip, set: first, signal, onChunk });
  return {
    clip,
    meta,
    bytes: total,
    folder,
    version,
    staticSet,
    handoff: new Map([[0, firstChunk]]),
    audioUrl: meta.audio ? `${folder}/${meta.audio}${version}` : null,
  };
}

export function loadStreamChunk(stream, index, { signal } = {}) {
  return fetchSplatSet({
    folder: stream.folder,
    version: stream.version,
    clip: stream.clip,
    set: stream.meta.chunks[index],
    signal,
    onChunk: () => {},
  });
}

async function streamBlob({ url, name, clip, type, signal, onProgress }) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Splat4dError(`${name} for “${clip}” answered ${response.status}.`, { clip, missing: response.status === 404 });
  }
  const declared = Number(response.headers.get("content-length")) || 0;
  if (!response.body) {
    const whole = await response.blob();
    if (onProgress) onProgress(whole.size, whole.size);
    return new Blob([whole], { type });
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  if (onProgress) onProgress(0, declared);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (onProgress) onProgress(received, Math.max(declared, received));
  }
  if (declared && received !== declared) {
    throw new Splat4dError(`${name} for “${clip}” ended at ${received} of ${declared} bytes.`, { clip });
  }
  if (received === 0) throw new Splat4dError(`${name} for “${clip}” is empty.`, { clip });
  return new Blob(chunks, { type });
}

async function loadRgbd(clip, folder, meta, { signal, onProgress }) {
  const version = versionQuery(meta);
  const video = await streamBlob({
    url: `${folder}/${meta.video}${version}`,
    name: meta.video,
    clip,
    type: "video/mp4",
    signal,
    onProgress,
  });
  return {
    clip,
    meta,
    bytes: video.size,
    video,
    plateUrl: meta.plate ? `${folder}/${meta.plate}${version}` : null,
  };
}
