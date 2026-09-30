"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useRef, useSyncExternalStore } from "react";
import * as THREE from "three";

import { createSplatGeometry, createSplatMaterial, createSplatTextures } from "./splatMaterial";
import { ORBIT, PARALLAX, RENDER, SORT, advanceTime, clamp, frameCursor } from "./splatVideoParams";

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

function sameRequest(a, b) {
  if (!a || !b) return false;
  for (let k = 0; k < 4; k += 1) if (Math.abs(a.zRow[k] - b.zRow[k]) > SORT.depthEpsilon) return false;
  return a.frame0 === b.frame0 && a.frame1 === b.frame1 && Math.abs(a.blend - b.blend) <= SORT.blendEpsilon;
}

function createRuntime(clip) {
  const { meta, layout } = clip;
  const textures = createSplatTextures(clip);
  const material = createSplatMaterial(textures, meta);
  const geometry = createSplatGeometry(meta.count);
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
    geometry.instanceCount = meta.count;
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

function SplatField({ clip, engineRef }) {
  const groupRef = useRef(null);
  const runtimeRef = useRef(null);
  const scratchRef = useRef(null);

  useEffect(() => {
    const group = groupRef.current;
    const runtime = createRuntime(clip);
    group.add(runtime.mesh);
    runtimeRef.current = runtime;
    scratchRef.current = {
      pivot: new THREE.Vector3(0, 0, -clip.meta.camera.pivotDepth),
      modelView: new THREE.Matrix4(),
      viewport: new THREE.Vector2(),
    };
    return () => {
      group.remove(runtime.mesh);
      runtime.dispose();
      runtimeRef.current = null;
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

    const camera = state.camera;
    if (camera.fov !== meta.camera.vfovDeg || camera.near !== RENDER.near || camera.far !== RENDER.far) {
      camera.fov = meta.camera.vfovDeg;
      camera.near = RENDER.near;
      camera.far = RENDER.far;
      camera.updateProjectionMatrix();
    }

    const { yaw, pitch, dolly } = stepOrbit(engine, delta, performance.now());
    const distance = meta.camera.pivotDepth * dolly;
    const { pivot } = scratch;
    camera.position.set(
      pivot.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      pivot.y + Math.sin(pitch) * distance,
      pivot.z + Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(pivot);
    camera.updateMatrixWorld();
    group.updateMatrixWorld();

    scratch.modelView.multiplyMatrices(camera.matrixWorldInverse, group.matrixWorld);
    const e = scratch.modelView.elements;
    const cursor = frameCursor(engine.time, meta);

    const { uniforms } = runtime.material;
    uniforms.uFrame0.value = cursor.frame0;
    uniforms.uFrame1.value = cursor.frame1;
    uniforms.uBlend.value = cursor.blend;
    state.gl.getDrawingBufferSize(scratch.viewport);
    uniforms.uViewport.value.copy(scratch.viewport);

    runtime.want({ zRow: [e[2], e[6], e[10], e[14]], ...cursor });
  });

  return <group ref={groupRef} rotation-x={Math.PI} />;
}

export default function SplatVideoScene({ clip, engineRef, isMobile }) {
  const hidden = useSyncExternalStore(subscribeVisibility, readHidden, readHiddenOnServer);
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

  const { meta } = clip;

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
        camera={{ fov: meta.camera.vfovDeg, near: RENDER.near, far: RENDER.far, position: [0, 0, 0] }}
        gl={{ antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: "high-performance" }}
        flat
        linear
      >
        <SplatField clip={clip} engineRef={engineRef} />
      </Canvas>
    </div>
  );
}
