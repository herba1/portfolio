"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import OrbitStage, { aimCamera } from "./OrbitStage";
import { createSoundClock } from "./soundClock";
import { createResolvePass, createSplatGeometry, createSplatMaterial, createSplatTextures } from "./splatMaterial";
import { createStreamRuntime } from "./splatStream";
import {
  RENDER,
  SORT,
  advanceTime,
  frameCursor,
  hasLensPath,
  isStream,
  lensMatrix,
  lowPassFor,
  sortCapacity,
} from "./splatVideoParams";

function sameRequest(a, b) {
  if (!a || !b) return false;
  for (let k = 0; k < 4; k += 1) if (Math.abs(a.zRow[k] - b.zRow[k]) > SORT.depthEpsilon) return false;
  return a.frame0 === b.frame0 && a.frame1 === b.frame1 && Math.abs(a.blend - b.blend) <= SORT.blendEpsilon;
}

function createRuntime(clip) {
  const { meta, layout } = clip;
  const textures = createSplatTextures(clip);
  const material = createSplatMaterial(textures, meta);
  const geometry = createSplatGeometry(sortCapacity(meta));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  const worker = new Worker(new URL("./sortWorker.js", import.meta.url), { type: "module" });
  const staticPoints = clip.staticPoints.slice();
  const dynamicPoints = clip.dynamicPoints.slice();
  const { min, max } = meta.bounds;
  worker.postMessage(
    {
      type: "init",
      staticPoints,
      dynamicPoints,
      staticCount: meta.staticCount,
      dynamicCount: meta.dynamicCount,
      layerTexels: layout.layerTexels,
      frameOffsets: meta.frameOffsets ?? null,
      boundsMin: min,
      boundsSize: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    },
    [staticPoints.buffer, dynamicPoints.buffer],
  );

  const sorter = { inFlight: false, sent: null, wanted: null, recycle: null, disposed: false, id: 0 };

  const send = () => {
    if (sorter.disposed || sorter.inFlight || !sorter.wanted) return;
    if (sameRequest(sorter.sent, sorter.wanted)) return;
    const request = sorter.wanted;
    const recycle = sorter.recycle;
    sorter.recycle = null;
    sorter.inFlight = true;
    sorter.sent = request;
    sorter.id += 1;
    worker.postMessage({ type: "sort", id: sorter.id, ...request, recycle }, recycle ? [recycle.buffer] : []);
  };

  worker.onmessage = (event) => {
    if (sorter.disposed || event.data?.type !== "sorted") return;
    const attribute = geometry.getAttribute("aSplat");
    sorter.recycle = attribute.array;
    attribute.array = event.data.order;
    attribute.needsUpdate = true;
    geometry.instanceCount = event.data.count;
    sorter.inFlight = false;
    send();
  };

  worker.onerror = () => {
    sorter.inFlight = false;
  };

  return {
    mesh,
    material,
    want(request) {
      sorter.wanted = request;
      send();
    },
    dispose() {
      sorter.disposed = true;
      worker.terminate();
      geometry.dispose();
      material.dispose();
      textures.dispose();
    },
  };
}

function createScratch(meta) {
  return {
    pivot: new THREE.Vector3(0, 0, -meta.camera.pivotDepth),
    modelView: new THREE.Matrix4(),
    viewport: new THREE.Vector2(),
    lens: new THREE.Matrix4(),
  };
}

function useResolvedRender(resolveRef, scratchRef) {
  useFrame((state) => {
    const resolve = resolveRef.current;
    const scratch = scratchRef.current;
    if (!resolve || !scratch) {
      state.gl.render(state.scene, state.camera);
      return;
    }
    resolve.render(state.gl, state.scene, state.camera, Math.max(1, scratch.viewport.x), Math.max(1, scratch.viewport.y));
  }, 1);
}

function aimAndMeasure(state, engine, meta, delta, scratch, group) {
  const camera = state.camera;
  const base = hasLensPath(meta) ? lensMatrix(meta, engine.time, scratch.lens) : null;
  aimCamera(camera, engine, meta, delta, scratch.pivot, base);
  group.updateMatrixWorld();
  scratch.modelView.multiplyMatrices(camera.matrixWorldInverse, group.matrixWorld);
  state.gl.getDrawingBufferSize(scratch.viewport);
  const e = scratch.modelView.elements;
  return [e[2], e[6], e[10], e[14]];
}

function SplatField({ clip, engineRef }) {
  const groupRef = useRef(null);
  const runtimeRef = useRef(null);
  const resolveRef = useRef(null);
  const scratchRef = useRef(null);

  useEffect(() => {
    const group = groupRef.current;
    const runtime = createRuntime(clip);
    const resolve = createResolvePass();
    group.add(runtime.mesh);
    runtimeRef.current = runtime;
    resolveRef.current = resolve;
    scratchRef.current = createScratch(clip.meta);
    return () => {
      group.remove(runtime.mesh);
      runtime.dispose();
      resolve.dispose();
      runtimeRef.current = null;
      resolveRef.current = null;
    };
  }, [clip]);

  useFrame((state, rawDelta) => {
    const runtime = runtimeRef.current;
    const scratch = scratchRef.current;
    const group = groupRef.current;
    const engine = engineRef.current;
    if (!runtime || !scratch || !group || !engine) return;
    const { meta } = clip;
    const delta = Math.min(rawDelta, RENDER.maxDelta);

    if (engine.playing && !engine.scrubbing) {
      advanceTime(engine, delta * engine.speed, meta.duration);
    }

    const zRow = aimAndMeasure(state, engine, meta, delta, scratch, group);
    const cursor = frameCursor(engine.time, meta);

    const { uniforms } = runtime.material;
    uniforms.uFrame0.value = cursor.frame0;
    uniforms.uFrame1.value = cursor.frame1;
    uniforms.uBlend.value = cursor.blend;
    uniforms.uViewport.value.copy(scratch.viewport);
    uniforms.uLowPass.value = lowPassFor(meta, scratch.viewport.y);

    runtime.want({ zRow, ...cursor });
  });

  useResolvedRender(resolveRef, scratchRef);

  return <group ref={groupRef} rotation-x={Math.PI} />;
}

function StreamField({ clip, engineRef }) {
  const groupRef = useRef(null);
  const runtimeRef = useRef(null);
  const resolveRef = useRef(null);
  const soundRef = useRef(null);
  const scratchRef = useRef(null);

  useEffect(() => {
    const group = groupRef.current;
    const engine = engineRef.current;
    const runtime = createStreamRuntime(clip);
    const resolve = createResolvePass();
    const sound = clip.audioUrl ? createSoundClock(clip.audioUrl, clip.meta.duration) : null;
    const controls = sound ? { gesture: () => sound.sync(engineRef.current, true) } : null;
    engine.sound = controls;
    group.add(runtime.mesh);
    runtimeRef.current = runtime;
    resolveRef.current = resolve;
    soundRef.current = sound;
    scratchRef.current = createScratch(clip.meta);
    return () => {
      group.remove(runtime.mesh);
      runtime.dispose();
      resolve.dispose();
      if (sound) sound.dispose();
      if (engine.sound === controls) engine.sound = null;
      engine.buffering = false;
      engine.soundWaiting = false;
      runtimeRef.current = null;
      resolveRef.current = null;
      soundRef.current = null;
    };
  }, [clip, engineRef]);

  useFrame((state, rawDelta) => {
    const runtime = runtimeRef.current;
    const scratch = scratchRef.current;
    const group = groupRef.current;
    const engine = engineRef.current;
    if (!runtime || !scratch || !group || !engine) return;
    const { meta } = clip;
    const delta = Math.min(rawDelta, RENDER.maxDelta);
    runtime.upload(state.gl);

    const sound = soundRef.current;
    const clocked = sound ? sound.sync(engine) : false;
    if (!clocked && engine.playing && !engine.scrubbing && !engine.buffering) {
      advanceTime(engine, delta * engine.speed, meta.duration, false);
    }
    const moment = frameCursor(engine.time, meta).frame0;
    engine.buffering = !runtime.focus(moment);

    const zRow = aimAndMeasure(state, engine, meta, delta, scratch, group);
    const { uniforms } = runtime.material;
    uniforms.uViewport.value.copy(scratch.viewport);
    uniforms.uLowPass.value = lowPassFor(meta, scratch.viewport.y);
    uniforms.uTime.value = engine.time;
    uniforms.uHalfStep.value = engine.reducedMotion ? 0 : 0.5 / Math.max(1, meta.fps);

    runtime.want(zRow, moment);
  });

  useResolvedRender(resolveRef, scratchRef);

  return <group ref={groupRef} rotation-x={Math.PI} />;
}

export default function SplatVideoScene({ clip, engineRef, isMobile }) {
  const Field = isStream(clip.meta) ? StreamField : SplatField;
  return (
    <OrbitStage meta={clip.meta} engineRef={engineRef} isMobile={isMobile}>
      <Field clip={clip} engineRef={engineRef} />
    </OrbitStage>
  );
}
