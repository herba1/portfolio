"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import OrbitStage, { aimCamera } from "./OrbitStage";
import { createRgbdGeometry, createRgbdMaterial, prepareStackedTexture, stackedTexel } from "./rgbdMaterial";
import { RENDER, RGBD, clamp } from "./splatVideoParams";

const PLAY_RETRY_MS = 1000;
const SEEK_SETTLED = 1e-3;

function createVideo(objectUrl) {
  const video = document.createElement("video");
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.loop = true;
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.src = objectUrl;
  video.load();
  return video;
}

function createRuntime(clip) {
  const { meta } = clip;
  const group = new THREE.Group();
  const geometry = createRgbdGeometry(meta.source.width, meta.source.height);

  const objectUrl = URL.createObjectURL(clip.video);
  const video = createVideo(objectUrl);
  const videoTexture = prepareStackedTexture(new THREE.VideoTexture(video));
  const liveMaterial = createRgbdMaterial(videoTexture, meta, { layer: "live" });
  const liveMesh = new THREE.Mesh(geometry, liveMaterial);
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

  const refreshFrame = () => {
    if (video.readyState >= video.HAVE_CURRENT_DATA) videoTexture.needsUpdate = true;
  };
  const onMetadata = () => {
    liveMaterial.uniforms.uTexel.value.copy(stackedTexel(video.videoWidth, video.videoHeight));
  };
  const onData = () => {
    liveMesh.visible = true;
    refreshFrame();
  };
  const onVisibility = () => {
    if (document.hidden) video.pause();
  };
  video.addEventListener("loadedmetadata", onMetadata);
  video.addEventListener("loadeddata", onData);
  video.addEventListener("seeked", refreshFrame);
  document.addEventListener("visibilitychange", onVisibility);

  let lastPlayAttempt = -Infinity;
  const play = (now) => {
    if (now - lastPlayAttempt < PLAY_RETRY_MS) return;
    lastPlayAttempt = now;
    const attempt = video.play();
    if (attempt) attempt.catch(() => {});
  };

  const frame = 1 / meta.fps;
  const seek = (time) => {
    if (video.readyState < video.HAVE_METADATA || video.seeking) return;
    const length = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : meta.duration;
    const nudge = RGBD.seekNudgeFrames * frame;
    const target = clamp(time + nudge, 0, Math.max(0, length - nudge));
    const drifted = Math.abs(video.currentTime - time) > RGBD.syncToleranceFrames * frame;
    if (drifted && Math.abs(video.currentTime - target) > SEEK_SETTLED) video.currentTime = target;
  };

  const audible = Boolean(meta.audio);
  const applyMuted = (engine) => {
    const muted = !audible || engine.muted !== false;
    if (video.muted !== muted) video.muted = muted;
  };

  return {
    group,
    gesture(engine) {
      applyMuted(engine);
      if (engine.playing && video.paused) {
        const attempt = video.play();
        if (attempt) attempt.catch(() => {});
      }
    },
    sync(engine, now) {
      applyMuted(engine);
      if (video.playbackRate !== engine.speed) video.playbackRate = engine.speed;
      const wantPlaying = engine.playing && !engine.scrubbing && !document.hidden;
      if (wantPlaying) {
        if (video.paused) play(now);
        else lastPlayAttempt = -Infinity;
        engine.time = clamp(video.currentTime, 0, meta.duration);
        return;
      }
      if (!video.paused) video.pause();
      lastPlayAttempt = -Infinity;
      seek(engine.time);
    },
    dispose() {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      video.removeEventListener("loadedmetadata", onMetadata);
      video.removeEventListener("loadeddata", onData);
      video.removeEventListener("seeked", refreshFrame);
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(objectUrl);
      videoTexture.dispose();
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
