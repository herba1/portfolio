"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import { createCardLayer } from "./cardLayer";
import { createFilmPass } from "./filmPass";
import OrbitStage, { aimCamera } from "./OrbitStage";
import { createSoundClock } from "./soundClock";
import {
  bindMoments,
  bindRemap,
  blendMoments,
  createResolvePass,
  createSplatGeometry,
  createSplatMaterial,
  createSplatTextures,
} from "./splatMaterial";
import { createStreamRuntime } from "./splatStream";
import {
  RENDER,
  SORT,
  advanceTime,
  depthOfField,
  frameCursor,
  hasLensPath,
  holdsMoments,
  isFlipbook,
  isStream,
  lensMatrix,
  lowPassFor,
  momentBlend,
  momentPlan,
  momentTime,
  remapZenith,
  sortCapacity,
  sourceMatrix,
  stereoScale,
  viewShift,
  viewStereo,
} from "./splatVideoParams";

const DEG = Math.PI / 180;

export function applyDepthOfField(uniforms, engine, meta) {
  const { aperture, focusDepth } = depthOfField(engine, meta);
  uniforms.uAperture.value = aperture;
  uniforms.uFocusDepth.value = focusDepth;
}

function covers(sent, wanted) {
  if (!sent || !wanted) return false;
  for (let k = 0; k < 4; k += 1) if (Math.abs(sent.zRow[k] - wanted.zRow[k]) > SORT.depthEpsilon) return false;
  if (wanted.momentA !== undefined) return holdsMoments(sent, wanted);
  return sent.frame0 === wanted.frame0 && sent.frame1 === wanted.frame1 && Math.abs(sent.blend - wanted.blend) <= SORT.blendEpsilon;
}

export function createSplatRuntime(clip) {
  const { meta, layout } = clip;
  const textures = createSplatTextures(clip);
  const material = createSplatMaterial(textures, meta);
  const capacity = sortCapacity(meta);
  const geometry = createSplatGeometry(capacity);
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
      capacity,
      boundsMin: min,
      boundsSize: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    },
    [staticPoints.buffer, dynamicPoints.buffer],
  );

  const sorter = { inFlight: false, sent: null, wanted: null, recycle: null, disposed: false, id: 0 };
  const clock = { time: 0, reducedMotion: false };
  let shown = null;

  const applyBlend = () => blendMoments(material, momentBlend(meta, shown, clock.time, clock.reducedMotion));

  const send = () => {
    if (sorter.disposed || sorter.inFlight || !sorter.wanted) return;
    if (covers(sorter.sent, sorter.wanted)) return;
    const request = sorter.wanted;
    const recycle = sorter.recycle;
    sorter.recycle = null;
    sorter.inFlight = true;
    sorter.sent = request;
    sorter.id += 1;
    worker.postMessage({ type: "sort", id: sorter.id, ...request, recycle }, recycle ? [recycle.buffer] : []);
  };

  worker.onmessage = (event) => {
    const reply = event.data;
    if (sorter.disposed || reply?.type !== "sorted") return;
    const attribute = geometry.getAttribute("aSplat");
    sorter.recycle = attribute.array;
    attribute.array = reply.order;
    attribute.needsUpdate = true;
    geometry.instanceCount = reply.count;
    if (reply.split !== undefined) {
      shown = { momentA: reply.momentA, momentB: reply.momentB, timeA: momentTime(meta, reply.momentA), timeB: momentTime(meta, reply.momentB) };
      bindMoments(material, reply, shown.timeA, shown.timeB);
      applyBlend();
    }
    sorter.inFlight = false;
    send();
  };

  worker.onerror = () => {
    sorter.inFlight = false;
  };

  return {
    mesh,
    material,
    tick(time, reducedMotion) {
      clock.time = time;
      clock.reducedMotion = reducedMotion;
      applyBlend();
    },
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

// Everything the worm's-eye remap needs per frame, worked out once: the rest
// orientation, the zenith the lean turns round and the sky deepens toward,
// and the elevation of the source's top edge where the analytic sky takes over.
function remapRuntime(meta, source) {
  const remap = meta.camera.remap;
  if (!remap) return null;
  const zenith = remapZenith(remap, new THREE.Vector3());
  const rest = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(remap.pitchDeg * DEG, remap.yawDeg * DEG, remap.rollDeg * DEG, "YXZ"),
  );
  const top = new THREE.Vector3(0, -remap.sky.topTan, 1).applyMatrix4(source).normalize();
  return {
    vfovDeg: remap.vfovDeg,
    lean: remap.lean,
    stereo: stereoScale(remap),
    frame: remap,
    rest,
    zenith,
    horizon: top.dot(zenith),
    skyTop: remap.sky.top.map((c) => c / 255),
    skyZenith: remap.sky.zenith.map((c) => c / 255),
    skyLow: remap.sky.low.map((c) => c / 255),
    skyLowSpan: remap.sky.lowSpanDeg * DEG,
    skyEase: remap.sky.ease,
  };
}

export function createScratch(meta) {
  const source = sourceMatrix(meta, new THREE.Matrix4());
  const remap = remapRuntime(meta, source);
  const pivot = remap
    ? new THREE.Vector3(...meta.camera.remap.pivot).applyMatrix4(source)
    : new THREE.Vector3(0, 0, -meta.camera.pivotDepth);
  return {
    pivot,
    source,
    remap,
    modelView: new THREE.Matrix4(),
    viewport: new THREE.Vector2(),
    lens: new THREE.Matrix4(),
  };
}

function placeSource(group, scratch) {
  group.matrixAutoUpdate = false;
  group.matrix.copy(scratch.source);
  group.matrixWorldNeedsUpdate = true;
}

// A slow GPU (software GL, an old phone) is never handed a new frame before it
// has finished the last one, so commands cannot pile up behind the compositor.
function gpuBusy(context, fenceRef) {
  const fence = fenceRef.current;
  if (!fence) return false;
  if (context.getSyncParameter(fence, context.SYNC_STATUS) !== context.SIGNALED) return true;
  context.deleteSync(fence);
  fenceRef.current = null;
  return false;
}

function useResolvedRender(resolveRef, scratchRef, engineRef, cardRef = null, groupRef = null) {
  const fenceRef = useRef(null);
  const filmRef = useRef(null);

  useEffect(() => {
    const film = createFilmPass();
    filmRef.current = film;
    return () => {
      film.dispose();
      filmRef.current = null;
      fenceRef.current = null;
    };
  }, []);

  useFrame((state) => {
    const context = state.gl.getContext();
    const fenced = typeof context.fenceSync === "function";
    if (fenced && gpuBusy(context, fenceRef)) return;
    const resolve = resolveRef.current;
    const scratch = scratchRef.current;
    const film = filmRef.current;
    if (!resolve || !scratch) state.gl.render(state.scene, state.camera);
    else {
      const width = Math.max(1, scratch.viewport.x);
      const height = Math.max(1, scratch.viewport.y);
      const card = cardRef?.current;
      const group = groupRef?.current;
      const drawSplats = (gl) => {
        resolve.render(gl, state.scene, state.camera, width, height);
        if (card && group) card.render(gl, state.camera, group.matrixWorld, width, height, scratch.remap?.stereo, scratch.remap?.stereoShift);
      };
      if (!film) drawSplats(state.gl);
      else {
        film.render(state.gl, drawSplats, width, height, {
          time: state.clock.elapsedTime,
          still: Boolean(engineRef.current?.reducedMotion),
          pixelRatio: state.gl.getPixelRatio(),
          sky: scratch.remap,
          camera: state.camera,
        });
      }
    }
    if (fenced) {
      fenceRef.current = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0);
      context.flush();
    }
  }, 1);
}

export function aimAndMeasure(state, engine, meta, delta, scratch, group) {
  const camera = state.camera;
  const base = hasLensPath(meta) ? lensMatrix(meta, engine.time, scratch.lens) : null;
  aimCamera(camera, engine, meta, delta, scratch.pivot, base, scratch.remap);
  group.updateMatrixWorld();
  scratch.modelView.multiplyMatrices(camera.matrixWorldInverse, group.matrixWorld);
  state.gl.getDrawingBufferSize(scratch.viewport);
  // The lens fits the full-bleed viewport (cover), so its scale follows the
  // window's aspect; the splats, the card and the film sky all read it here.
  if (scratch.remap) {
    scratch.remap.stereo = viewStereo(scratch.remap.frame, scratch.viewport.x, scratch.viewport.y);
    scratch.remap.stereoShift = viewShift(scratch.remap.frame, scratch.viewport.x, scratch.viewport.y);
  }
  const e = scratch.modelView.elements;
  return [e[2], e[6], e[10], e[14]];
}

function SplatField({ clip, engineRef }) {
  const groupRef = useRef(null);
  const runtimeRef = useRef(null);
  const resolveRef = useRef(null);
  const scratchRef = useRef(null);
  const cardRef = useRef(null);
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const group = groupRef.current;
    const runtime = createSplatRuntime(clip);
    const resolve = createResolvePass();
    const scratch = createScratch(clip.meta);
    const card = clip.cardImage && clip.meta.card ? createCardLayer(clip.meta.card, clip.cardImage, clip.meta.camera.remap, gl) : null;
    placeSource(group, scratch);
    bindRemap(runtime.material, clip.meta.camera.remap, scratch.remap);
    // With a remap the film pass paints the sky behind the splats, so they
    // composite straight over it.
    resolve.uniforms.uOver.value = scratch.remap ? 1 : 0;
    group.add(runtime.mesh);
    runtimeRef.current = runtime;
    resolveRef.current = resolve;
    scratchRef.current = scratch;
    cardRef.current = card;
    return () => {
      group.remove(runtime.mesh);
      runtime.dispose();
      resolve.dispose();
      if (card) card.dispose();
      runtimeRef.current = null;
      resolveRef.current = null;
      cardRef.current = null;
    };
  }, [clip, gl]);

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
    if (scratch.remap) {
      uniforms.uStereo.value = scratch.remap.stereo;
      uniforms.uStereoShift.value = scratch.remap.stereoShift;
    }
    uniforms.uLowPass.value = lowPassFor(meta, scratch.viewport.y);
    runtime.tick(engine.time, engine.reducedMotion);
    applyDepthOfField(uniforms, engine, meta);

    if (isFlipbook(meta)) runtime.want({ zRow, ...momentPlan(meta, engine.time, { reducedMotion: engine.reducedMotion }) });
    else runtime.want({ zRow, ...cursor });
    if (!engine.drawn && runtime.mesh.geometry.instanceCount > 0) engine.drawn = true;
  });

  useResolvedRender(resolveRef, scratchRef, engineRef, cardRef, groupRef);

  return <group ref={groupRef} matrixAutoUpdate={false} />;
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
    const scratch = createScratch(clip.meta);
    placeSource(group, scratch);
    bindRemap(runtime.material, clip.meta.camera.remap, scratch.remap);
    resolve.uniforms.uOver.value = scratch.remap ? 1 : 0;
    group.add(runtime.mesh);
    runtimeRef.current = runtime;
    resolveRef.current = resolve;
    soundRef.current = sound;
    scratchRef.current = scratch;
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
    const plan = runtime.plan(engine.time, engine.reducedMotion);
    engine.buffering = !runtime.focus(plan.momentA);

    const zRow = aimAndMeasure(state, engine, meta, delta, scratch, group);
    const { uniforms } = runtime.material;
    uniforms.uViewport.value.copy(scratch.viewport);
    if (scratch.remap) {
      uniforms.uStereo.value = scratch.remap.stereo;
      uniforms.uStereoShift.value = scratch.remap.stereoShift;
    }
    uniforms.uLowPass.value = lowPassFor(meta, scratch.viewport.y);
    runtime.tick(engine.time, engine.reducedMotion);
    applyDepthOfField(uniforms, engine, meta);

    runtime.want(zRow, plan);
    if (!engine.drawn && runtime.mesh.geometry.instanceCount > 0) engine.drawn = true;
  });

  useResolvedRender(resolveRef, scratchRef, engineRef);

  return <group ref={groupRef} matrixAutoUpdate={false} />;
}

export default function SplatVideoScene({ clip, engineRef, isMobile }) {
  const Field = isStream(clip.meta) ? StreamField : SplatField;
  return (
    <OrbitStage meta={clip.meta} engineRef={engineRef} isMobile={isMobile}>
      <Field clip={clip} engineRef={engineRef} />
    </OrbitStage>
  );
}
