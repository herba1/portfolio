"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import OrbitStage, { aimCamera } from "./OrbitStage";
import { createRgbdGeometry, createRgbdMaterial, prepareStackedTexture, stackedTexel } from "./rgbdMaterial";
import { RENDER } from "./splatVideoParams";
import { createVideoClock } from "./videoClock";

function createRuntime(clip) {
  const { meta } = clip;
  const group = new THREE.Group();
  const geometry = createRgbdGeometry(meta.source.width, meta.source.height);

  let liveMaterial = null;
  let liveMesh = null;
  const clock = createVideoClock(clip.video, meta, {
    onMetadata: (video) => liveMaterial.uniforms.uTexel.value.copy(stackedTexel(video.videoWidth, video.videoHeight)),
    onReady: () => {
      liveMesh.visible = true;
    },
  });
  liveMaterial = createRgbdMaterial(clock.texture, meta, { layer: "live" });
  liveMesh = new THREE.Mesh(geometry, liveMaterial);
  liveMesh.frustumCulled = false;
  liveMesh.visible = false;
  liveMesh.renderOrder = 0;
  group.add(liveMesh);

  let disposed = false;
  let plateTexture = null;
  let plateMaterial = null;
  if (clip.plateUrl) {
    new THREE.TextureLoader().load(
      clip.plateUrl,
      (texture) => {
        if (disposed) {
          texture.dispose();
          return;
        }
        plateTexture = prepareStackedTexture(texture);
        plateTexture.needsUpdate = true;
        plateMaterial = createRgbdMaterial(plateTexture, meta, { layer: "plate" });
        plateMaterial.uniforms.uTexel.value.copy(stackedTexel(texture.image.width, texture.image.height));
        const plateMesh = new THREE.Mesh(geometry, plateMaterial);
        plateMesh.frustumCulled = false;
        plateMesh.renderOrder = 1;
        group.add(plateMesh);
      },
      undefined,
      () => {},
    );
  }

  return {
    group,
    gesture: clock.gesture,
    sync: clock.sync,
    dispose() {
      disposed = true;
      clock.dispose();
      liveMaterial.dispose();
      if (plateTexture) plateTexture.dispose();
      if (plateMaterial) plateMaterial.dispose();
      geometry.dispose();
    },
  };
}

function RgbdField({ clip, engineRef }) {
  const groupRef = useRef(null);
  const runtimeRef = useRef(null);
  const pivotRef = useRef(null);

  useEffect(() => {
    const group = groupRef.current;
    const runtime = createRuntime(clip);
    group.add(runtime.group);
    runtimeRef.current = runtime;
    pivotRef.current = new THREE.Vector3(0, 0, -clip.meta.camera.pivotDepth);
    const engine = engineRef.current;
    const sound = { gesture: () => runtime.gesture(engine) };
    engine.sound = sound;
    return () => {
      if (engine.sound === sound) engine.sound = null;
      group.remove(runtime.group);
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, [clip, engineRef]);

  useFrame((state, rawDelta) => {
    const runtime = runtimeRef.current;
    const pivot = pivotRef.current;
    const engine = engineRef.current;
    if (!runtime || !pivot || !engine) return;
    const delta = Math.min(rawDelta, RENDER.maxDelta);
    runtime.sync(engine, performance.now());
    aimCamera(state.camera, engine, clip.meta, delta, pivot);
  });

  return <group ref={groupRef} rotation-x={Math.PI} />;
}

export default function RgbdScene({ clip, engineRef, isMobile }) {
  return (
    <OrbitStage meta={clip.meta} engineRef={engineRef} isMobile={isMobile}>
      <RgbdField clip={clip} engineRef={engineRef} />
    </OrbitStage>
  );
}
