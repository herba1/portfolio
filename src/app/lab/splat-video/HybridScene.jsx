"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import OrbitStage from "./OrbitStage";
import { aimAndMeasure, applyDepthOfField, createScratch, createSplatRuntime } from "./SplatVideoScene";
import { createDepthMaterial, createLayerMaterial, createPointsGeometry, createPointsMaterial } from "./hybridMaterial";
import { createRgbdGeometry } from "./rgbdMaterial";
import { createResolvePass } from "./splatMaterial";
import { HYBRID, RENDER, TEXTURE_WIDTH, clamp, lowPassFor, momentPlan } from "./splatVideoParams";
import { createVideoClock } from "./videoClock";

const SPLAT_LAYER = 0;

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
  const stride = isMobile ? HYBRID.mobileGridStride : 1;
  const columns = Math.max(2, Math.round(layout.depth[2] / stride));
  const rows = Math.max(2, Math.round(layout.depth[3] / stride));
  const grid = new THREE.Vector2(1 / columns, 1 / rows);
  const geometry = createRgbdGeometry(columns, rows);
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
  const depthMaterial = createDepthMaterial(clock.texture, clip.meta, grid);
  const depthMesh = new THREE.Mesh(geometry, depthMaterial);
  depthMesh.frustumCulled = false;
  depthMesh.visible = false;
  depthMesh.layers.set(HYBRID.subjectLayer);
  subject.add(depthMesh);
  const pointsGeometry = createPointsGeometry(geometry.getAttribute("aGrid"));
  const pointsMaterial = createPointsMaterial(clock.texture, clip.meta, grid);
  const points = new THREE.Points(pointsGeometry, pointsMaterial);
  points.frustumCulled = false;
  points.visible = false;
  points.layers.set(HYBRID.subjectLayer);
  subject.add(points);

  return {
    backdrop,
    splats,
    subject,
    clock,
    show(look, viewportHeight, fovDeg) {
      const splats = look === "splats";
      surface.visible = !splats;
      depthMesh.visible = splats;
      points.visible = splats;
      if (splats) pointsMaterial.uniforms.uPixelsPerUnit.value = viewportHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
    },
    dispose() {
      clock.dispose();
      materials.forEach((material) => material.dispose());
      depthMaterial.dispose();
      pointsMaterial.dispose();
      pointsGeometry.dispose();
      geometry.dispose();
      splats.dispose();
    },
  };
}

function applyGain(resolve, meta, time) {
  const gains = meta.backgroundGain;
  if (!resolve || !Array.isArray(gains) || gains.length === 0) return;
  const frame = clamp(Math.floor(time * meta.fps), 0, gains.length - 1);
  const [red, green, blue] = gains[frame];
  resolve.uniforms.uGain.value.set(red, green, blue);
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
  const groupRef = useRef(null);
  const runtimeRef = useRef(null);
  const resolveRef = useRef(null);
  const scratchRef = useRef(null);

  useEffect(() => {
    const group = groupRef.current;
    const engine = engineRef.current;
    const runtime = createRuntime(clip, isMobile);
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
      group.remove(runtime.splats.mesh);
      group.remove(runtime.subject);
      runtime.dispose();
      resolve.dispose();
      runtimeRef.current = null;
      resolveRef.current = null;
    };
  }, [clip, engineRef, isMobile]);

  useFrame((state, rawDelta) => {
    const runtime = runtimeRef.current;
    const scratch = scratchRef.current;
    const group = groupRef.current;
    const engine = engineRef.current;
    if (!runtime || !scratch || !group || !engine) return;
    const delta = Math.min(rawDelta, RENDER.maxDelta);
    runtime.clock.sync(engine, performance.now());
    applyGain(resolveRef.current, clip.meta, engine.time);

    const backdrop = runtime.backdrop.meta;
    const zRow = aimAndMeasure(state, engine, clip.meta, delta, scratch, group);
    runtime.show(engine.look, scratch.viewport.y, state.camera.fov);
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
