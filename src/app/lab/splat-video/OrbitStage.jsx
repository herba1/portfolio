"use client";

import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { ORBIT, PARALLAX, RENDER, clamp, viewFov } from "./splatVideoParams";

const DEG = Math.PI / 180;

function subscribeVisibility(callback) {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
}

function readHidden() {
  return document.hidden;
}

function readHiddenOnServer() {
  return false;
}

export function useDocumentHidden() {
  return useSyncExternalStore(subscribeVisibility, readHidden, readHiddenOnServer);
}

function stepOrbit(engine, delta, now) {
  const { orbit } = engine;
  const follow = 1 - Math.exp(-ORBIT.damping * delta);
  orbit.yaw += (orbit.targetYaw - orbit.yaw) * follow;
  orbit.pitch += (orbit.targetPitch - orbit.pitch) * follow;
  orbit.dolly += (orbit.targetDolly - orbit.dolly) * follow;

  const idle = !orbit.dragging && now - orbit.lastDragAt > PARALLAX.idleAfterMs;
  const parallaxOn = !engine.reducedMotion && orbit.hovering && idle;
  const parallaxYaw = parallaxOn ? orbit.pointerX * PARALLAX.yawDeg * DEG : 0;
  const parallaxPitch = parallaxOn ? -orbit.pointerY * PARALLAX.pitchDeg * DEG : 0;
  if (engine.reducedMotion) {
    orbit.parallaxYaw = 0;
    orbit.parallaxPitch = 0;
  } else {
    const drift = 1 - Math.exp(-PARALLAX.damping * delta);
    orbit.parallaxYaw += (parallaxYaw - orbit.parallaxYaw) * drift;
    orbit.parallaxPitch += (parallaxPitch - orbit.parallaxPitch) * drift;
  }

  return {
    yaw: clamp(orbit.yaw + orbit.parallaxYaw, -ORBIT.yawLimitDeg * DEG, ORBIT.yawLimitDeg * DEG),
    pitch: clamp(orbit.pitch + orbit.parallaxPitch, -ORBIT.pitchLimitDeg * DEG, ORBIT.pitchLimitDeg * DEG),
    dolly: clamp(orbit.dolly, ORBIT.dollyMin, ORBIT.dollyMax),
  };
}

const followScratch = {
  local: new THREE.Matrix4(),
  scale: new THREE.Vector3(1, 1, 1),
};

export function aimCamera(camera, engine, meta, delta, pivot, base = null) {
  const fov = viewFov(meta);
  if (camera.fov !== fov || camera.near !== RENDER.near || camera.far !== RENDER.far) {
    camera.fov = fov;
    camera.near = RENDER.near;
    camera.far = RENDER.far;
    camera.updateProjectionMatrix();
  }

  const { yaw, pitch, dolly } = stepOrbit(engine, delta, performance.now());
  engine.view = { yaw, pitch, dolly };
  const distance = meta.camera.pivotDepth * dolly;
  camera.position.set(
    pivot.x + Math.sin(yaw) * Math.cos(pitch) * distance,
    pivot.y + Math.sin(pitch) * distance,
    pivot.z + Math.cos(yaw) * Math.cos(pitch) * distance,
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(pivot);
  if (base) {
    followScratch.local.compose(camera.position, camera.quaternion, followScratch.scale);
    followScratch.local.premultiply(base);
    followScratch.local.decompose(camera.position, camera.quaternion, followScratch.scale);
    followScratch.scale.set(1, 1, 1);
  }
  camera.updateMatrixWorld();
}

export default function OrbitStage({ meta, engineRef, isMobile, antialias = false, children }) {
  const hidden = useDocumentHidden();
  const stageRef = useRef(null);
  const pointersRef = useRef(null);

  useEffect(() => {
    const stage = stageRef.current;
    const onWheel = (event) => {
      event.preventDefault();
      const engine = engineRef.current;
      const pixels = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 400 : event.deltaY;
      engine.orbit.targetDolly = clamp(
        engine.orbit.targetDolly * Math.exp(pixels * ORBIT.wheelDollyPerPixel),
        ORBIT.dollyMin,
        ORBIT.dollyMax,
      );
      engine.orbit.lastDragAt = performance.now();
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [engineRef]);

  const pointers = () => {
    if (!pointersRef.current) pointersRef.current = new Map();
    return pointersRef.current;
  };

  const updateHover = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const { orbit } = engineRef.current;
    orbit.hovering = true;
    orbit.pointerX = clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
    orbit.pointerY = clamp(((event.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
  };

  const handlePointerDown = (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers().set(event.pointerId, { x: event.clientX, y: event.clientY });
    const { orbit } = engineRef.current;
    orbit.dragging = true;
    orbit.lastDragAt = performance.now();
    event.currentTarget.dataset.dragging = "true";
  };

  const handlePointerMove = (event) => {
    const active = pointers();
    const { orbit } = engineRef.current;
    if (!active.has(event.pointerId)) {
      if (event.pointerType === "mouse") updateHover(event);
      return;
    }
    const previous = active.get(event.pointerId);
    const next = { x: event.clientX, y: event.clientY };
    if (active.size === 1) {
      const step = ORBIT.dragDegPerPixel * DEG;
      orbit.targetYaw = clamp(orbit.targetYaw - (next.x - previous.x) * step, -ORBIT.yawLimitDeg * DEG, ORBIT.yawLimitDeg * DEG);
      orbit.targetPitch = clamp(orbit.targetPitch + (next.y - previous.y) * step, -ORBIT.pitchLimitDeg * DEG, ORBIT.pitchLimitDeg * DEG);
    } else if (active.size === 2) {
      const [otherId] = [...active.keys()].filter((id) => id !== event.pointerId);
      const other = active.get(otherId);
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(next.x - other.x, next.y - other.y);
      if (before > 1 && after > 1) {
        orbit.targetDolly = clamp(orbit.targetDolly * (before / after), ORBIT.dollyMin, ORBIT.dollyMax);
      }
    }
    active.set(event.pointerId, next);
    orbit.lastDragAt = performance.now();
    if (event.pointerType === "mouse") updateHover(event);
  };

  const handlePointerEnd = (event) => {
    const active = pointers();
    active.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (active.size === 0) {
      const { orbit } = engineRef.current;
      orbit.dragging = false;
      orbit.lastDragAt = performance.now();
      event.currentTarget.dataset.dragging = "false";
    }
  };

  const handlePointerLeave = () => {
    engineRef.current.orbit.hovering = false;
  };

  return (
    <div
      ref={stageRef}
      className="splat-video__canvas"
      data-dragging="false"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerLeave={handlePointerLeave}
    >
      <Canvas
        frameloop={hidden ? "never" : "always"}
        dpr={[1, isMobile ? RENDER.mobileDpr : RENDER.desktopDpr]}
        camera={{ fov: viewFov(meta), near: RENDER.near, far: RENDER.far, position: [0, 0, 0] }}
        gl={{ antialias, alpha: true, premultipliedAlpha: true, powerPreference: "high-performance" }}
        flat
        linear
      >
        {children}
      </Canvas>
    </div>
  );
}
