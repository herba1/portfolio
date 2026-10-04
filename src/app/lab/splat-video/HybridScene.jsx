"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import OrbitStage from "./OrbitStage";
import { aimAndMeasure, applyDepthOfField, createScratch, createSplatRuntime } from "./SplatVideoScene";
import { createLayerMaterial, createSurfelGeometry, createSurfelMaterial } from "./hybridMaterial";
import { createLayerGrid } from "./rgbdMaterial";
import { createResolvePass } from "./splatMaterial";
import { HYBRID, RENDER, SURFEL, TEXTURE_WIDTH, gainAt, hasLensPath, leanAmount, lensMatrix, lowPassFor, momentPlan } from "./splatVideoParams";
import { createVideoClock } from "./videoClock";

const SPLAT_LAYER = 0;
const OPENCV_FLIP = new THREE.Matrix4().makeScale(1, -1, -1);
const lensScratch = new THREE.Matrix4();

function placeSubject(subject, meta, time) {
  if (!hasLensPath(meta)) return;
  subject.matrixAutoUpdate = false;
  subject.matrix.copy(OPENCV_FLIP).multiply(lensMatrix(meta, time, lensScratch)).multiply(OPENCV_FLIP);
  subject.matrixWorldNeedsUpdate = true;
}

function backgroundClip(clip) {
  const { meta, background } = clip;
  return {
    clip: clip.clip,
    meta: {
      ...meta,
      kind: "flipbook",
      version: 2,
      count: background.count,
      staticCount: background.count,
      dynamicCount: 0,
      frames: 1,
      frameOffsets: [0, 0],
      times: undefined,
      cameras: undefined,
      bounds: meta.background.bounds,
      covScale: meta.background.covScale,
    },
    base: background.base,
    velocity: null,
    staticPoints: background.points,
    dynamicPoints: new Uint16Array(4),
    layout: { width: TEXTURE_WIDTH, baseRows: background.rows, staticRows: background.rows, dynamicRows: 1, layerTexels: 1 },
  };
}

function createRuntime(clip, isMobile) {
  const backdrop = backgroundClip(clip);
  const splats = createSplatRuntime(backdrop);
  splats.mesh.layers.set(SPLAT_LAYER);

  const { layout } = clip.meta;
  const { columns, rows, grid, geometry } = createLayerGrid(layout, isMobile);
  const subject = new THREE.Group();
  subject.visible = false;
  const clock = createVideoClock(clip.video, clip.meta, {
    onReady: () => {
      subject.visible = true;
    },
  });
  const materials = [true, false].map((core) => createLayerMaterial(clock.texture, clip.meta, { core, grid }));
  const surface = new THREE.Group();
  materials.forEach((material, order) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.layers.set(HYBRID.subjectLayer);
    surface.add(mesh);
  });
  subject.add(surface);
  const surfelColumns = isMobile ? columns : clip.meta.layout.color[2];
  const surfelRows = isMobile ? rows : clip.meta.layout.color[3];
  const surfelGeometry = createSurfelGeometry(surfelColumns, surfelRows);
  const surfelMaterials = [true, false].map((core) =>
    createSurfelMaterial(clock.texture, clip.meta, { core, columns: surfelColumns, rows: surfelRows }),
  );
  const surfels = new THREE.Group();
  surfels.visible = false;
  surfelMaterials.forEach((material, order) => {
    const mesh = new THREE.Mesh(surfelGeometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.layers.set(HYBRID.subjectLayer);
    surfels.add(mesh);
  });
  subject.add(surfels);

  return {
    backdrop,
    splats,
    subject,
    clock,
    show(look, viewport, loosen) {
      const splats = look === "splats";
      surface.visible = !splats;
      surfels.visible = splats;
      if (!splats) return;
      surfelMaterials.forEach((material) => {
        material.uniforms.uViewport.value.copy(viewport);
        material.uniforms.uLoosen.value = loosen;
      });
    },
    dispose() {
      clock.dispose();
      materials.forEach((material) => material.dispose());
      surfelMaterials.forEach((material) => material.dispose());
      surfelGeometry.dispose();
      geometry.dispose();
      splats.dispose();
    },
  };
}

function applyGain(resolve, meta, time) {
  const gain = gainAt(meta.backgroundGain, meta, time);
  if (!resolve || !gain) return;
  resolve.uniforms.uGain.value.set(gain[0], gain[1], gain[2]);
}

function useLayeredRender(resolveRef, scratchRef) {
  useFrame((state) => {
    const resolve = resolveRef.current;
    const scratch = scratchRef.current;
    const { gl, scene, camera } = state;
    if (!resolve || !scratch) {
      gl.render(scene, camera);
      return;
    }
    camera.layers.set(SPLAT_LAYER);
    resolve.render(gl, scene, camera, Math.max(1, scratch.viewport.x), Math.max(1, scratch.viewport.y));
    const autoClear = gl.autoClear;
    gl.autoClear = false;
    gl.clearDepth();
    camera.layers.set(HYBRID.subjectLayer);
    gl.render(scene, camera);
    camera.layers.set(SPLAT_LAYER);
    gl.autoClear = autoClear;
  }, 1);
}

function HybridField({ clip, engineRef, isMobile }) {
  const mobileAtMountRef = useRef(isMobile);
  const groupRef = useRef(null);
  const runtimeRef = useRef(null);
  const resolveRef = useRef(null);
  const scratchRef = useRef(null);

  useEffect(() => {
    const group = groupRef.current;
    const engine = engineRef.current;
    const runtime = createRuntime(clip, mobileAtMountRef.current);
    const resolve = createResolvePass();
    group.add(runtime.splats.mesh);
    group.add(runtime.subject);
    const sound = { gesture: () => runtime.clock.gesture(engine) };
    engine.sound = sound;
    runtimeRef.current = runtime;
    resolveRef.current = resolve;
    scratchRef.current = createScratch(clip.meta);
    return () => {
      if (engine.sound === sound) engine.sound = null;
      engine.buffering = false;
      group.remove(runtime.splats.mesh);
      group.remove(runtime.subject);
      runtime.dispose();
      resolve.dispose();
      runtimeRef.current = null;
      resolveRef.current = null;
    };
  }, [clip, engineRef]);

  useFrame((state, rawDelta) => {
    const runtime = runtimeRef.current;
    const scratch = scratchRef.current;
    const group = groupRef.current;
    const engine = engineRef.current;
    if (!runtime || !scratch || !group || !engine) return;
    const delta = Math.min(rawDelta, RENDER.maxDelta);
    runtime.clock.sync(engine, performance.now());
    placeSubject(runtime.subject, clip.meta, runtime.clock.frameTime(engine.time));
    const { video } = runtime.clock;
    engine.buffering = engine.playing && !engine.scrubbing && !video.error && video.readyState < video.HAVE_FUTURE_DATA;
    applyGain(resolveRef.current, clip.meta, engine.time);

    const backdrop = runtime.backdrop.meta;
    const zRow = aimAndMeasure(state, engine, clip.meta, delta, scratch, group);
    runtime.show(engine.look, scratch.viewport, Math.pow(leanAmount(engine), SURFEL.loosen.ease));
    const { uniforms } = runtime.splats.material;
    uniforms.uViewport.value.copy(scratch.viewport);
    uniforms.uLowPass.value = lowPassFor(backdrop, scratch.viewport.y);
    runtime.splats.tick(0, engine.reducedMotion);
    applyDepthOfField(uniforms, engine, backdrop);
    runtime.splats.want({ zRow, ...momentPlan(backdrop, 0) });
  });

  useLayeredRender(resolveRef, scratchRef);

  return <group ref={groupRef} rotation-x={Math.PI} />;
}

export default function HybridScene({ clip, engineRef, isMobile }) {
  return (
    <OrbitStage meta={clip.meta} engineRef={engineRef} isMobile={isMobile}>
      <HybridField clip={clip} engineRef={engineRef} isMobile={isMobile} />
    </OrbitStage>
  );
}
