"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import OrbitStage, { aimCamera } from "./OrbitStage";
import { createLayerMaterial } from "./hybridMaterial";
import {
  createLayerGrid,
  createRgbdGeometry,
  createRgbdMaterial,
  createRoomMaterial,
  prepareStackedTexture,
  stackedTexel,
} from "./rgbdMaterial";
import { RENDER, RGBD, gainAt, leanAmount } from "./splatVideoParams";
import { createVideoClock } from "./videoClock";

function updateRoom(material, meta, engine) {
  if (!material) return;
  const gain = gainAt(meta.plateGain, meta, engine.time);
  if (gain) material.uniforms.uGain.value.set(gain[0], gain[1], gain[2]);
  material.uniforms.uLean.value = leanAmount(engine);
}

function createLayeredRuntime(clip, isMobile) {
  const { meta } = clip;
  const { grid, geometry } = createLayerGrid(meta.layout, isMobile);
  const group = new THREE.Group();
  group.visible = false;
  let videoReady = false;
  let roomSettled = false;
  let roomMaterial = null;
  const reveal = () => {
    group.visible = videoReady && roomSettled;
  };

  const clock = createVideoClock(clip.video, meta, {
    onReady: () => {
      videoReady = true;
      reveal();
    },
  });
  const subjectMaterials = [true, false].map((core) =>
    createLayerMaterial(clock.texture, meta, {
      core,
      grid,
      tearRelative: RGBD.subjectTearRelative,
      borderFeather: RGBD.subjectBorderFeather,
      alphaLow: meta.layers.alphaLow,
      alphaHigh: meta.layers.alphaHigh,
    }),
  );
  subjectMaterials.forEach((material, order) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = order + 1;
    group.add(mesh);
  });

  let disposed = false;
  let plateTexture = null;
  new THREE.TextureLoader().load(
    clip.plateUrl,
    (texture) => {
      if (disposed) {
        texture.dispose();
        return;
      }
      plateTexture = prepareStackedTexture(texture);
      plateTexture.needsUpdate = true;
      roomMaterial = createRoomMaterial(clock.texture, plateTexture, meta);
      const roomMesh = new THREE.Mesh(geometry, roomMaterial);
      roomMesh.frustumCulled = false;
      roomMesh.renderOrder = 0;
      group.add(roomMesh);
      roomSettled = true;
      reveal();
    },
    undefined,
    () => {
      roomSettled = true;
      reveal();
    },
  );

  return {
    group,
    gesture: clock.gesture,
    sync(engine, now) {
      clock.sync(engine, now);
      updateRoom(roomMaterial, meta, engine);
    },
    dispose() {
      disposed = true;
      clock.dispose();
      subjectMaterials.forEach((material) => material.dispose());
      if (roomMaterial) roomMaterial.dispose();
      if (plateTexture) plateTexture.dispose();
      geometry.dispose();
    },
  };
}

function createRuntime(clip, isMobile) {
  if (clip.meta.layout) return createLayeredRuntime(clip, isMobile);
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

function RgbdField({ clip, engineRef, isMobile }) {
  const groupRef = useRef(null);
  const runtimeRef = useRef(null);
  const mobileAtMountRef = useRef(isMobile);
  const pivotRef = useRef(null);

  useEffect(() => {
    const group = groupRef.current;
    const runtime = createRuntime(clip, mobileAtMountRef.current);
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
    <OrbitStage meta={clip.meta} engineRef={engineRef} isMobile={isMobile} antialias={!isMobile}>
      <RgbdField clip={clip} engineRef={engineRef} isMobile={isMobile} />
    </OrbitStage>
  );
}
