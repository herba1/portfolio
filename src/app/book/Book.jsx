"use client";

import { useEffect, useRef, useCallback } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { useControls, folder } from "leva";
import * as THREE from "three";
import Page from "./Page";
import { PAGES, PAGE_WIDTH, PAGE_HEIGHT, PAGE_DEPTH } from "./pageData";
import { DEFAULT_CONFIG, ARC_MODE_NAMES, EASE_OUT_NAMES } from "./bookConfig";

export default function Book() {
  const totalPages = PAGES.length;
  const currentPageRef = useRef(0);
  const dragStateRef = useRef({
    active: false,
    pageIndex: -1,
    direction: "next",
    progress: 0,
    startX: 0,
    startY: 0,
    pivotY: 0,
    pointerId: -1,
    // Velocity tracking (progress per second).
    velocity: 0,
    lastMoveAt: 0,
    lastProgress: 0,
    // Velocity captured at release — Page reads this to scale the tween.
    releaseVelocity: 0,
  });

  // Config — live-editable via Leva panel
  const config = useControls("book", {
    fold: folder({
      arcBlend: { value: DEFAULT_CONFIG.arcBlend, min: 0, max: 3.0, step: 0.05 },
      arcMode: { value: DEFAULT_CONFIG.arcMode, options: ARC_MODE_NAMES },
      foldAmplitude: { value: DEFAULT_CONFIG.foldAmplitude, min: 0, max: 0.4, step: 0.005 },
      axisTiltAmplitude: { value: DEFAULT_CONFIG.axisTiltAmplitude, min: 0, max: 1.0, step: 0.05 },
    }),
    release: folder({
      releaseDurationMs: { value: DEFAULT_CONFIG.releaseDurationMs, min: 120, max: 1200, step: 20 },
      releaseEase: { value: DEFAULT_CONFIG.releaseEase, options: EASE_OUT_NAMES },
      flickInfluence: { value: DEFAULT_CONFIG.flickInfluence, min: 0, max: 2, step: 0.05 },
      flickLookaheadSec: { value: DEFAULT_CONFIG.flickLookaheadSec, min: 0, max: 0.4, step: 0.01 },
    }),
    drag: folder({
      dragDistanceRatio: { value: DEFAULT_CONFIG.dragDistanceRatio, min: 0.1, max: 1.0, step: 0.05 },
      commitThreshold: { value: DEFAULT_CONFIG.commitThreshold, min: 0.1, max: 0.9, step: 0.05 },
    }),
    variation: folder({
      randomness: { value: DEFAULT_CONFIG.randomness, min: 0, max: 1, step: 0.05 },
    }),
  });

  // Mirror config to a ref so useFrame reads the latest without rerendering.
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const { gl, size } = useThree();

  // Aspect → applied every frame via ref mutation (avoids JSX rerenders).
  const aspectGroupRef = useRef();
  useFrame(() => {
    if (!aspectGroupRef.current || !size.width || !size.height) return;
    const aspect = size.width / size.height;
    aspectGroupRef.current.scale.set(aspect, 1, 1);
    aspectGroupRef.current.position.x = -aspect / 2;
  });

  const releaseDrag = useCallback(
    (commit) => {
      const s = dragStateRef.current;
      if (!s.active) return;
      const cur = currentPageRef.current;
      if (commit) {
        if (s.direction === "next") {
          currentPageRef.current = Math.min(totalPages - 1, cur + 1);
        } else {
          currentPageRef.current = Math.max(0, cur - 1);
        }
      }
      s.active = false;
      s.progress = 0;
      s.pageIndex = -1;
      s.pointerId = -1;
      document.body.style.cursor = "default";
    },
    [totalPages]
  );

  const onPressStart = useCallback(
    (dir, e, pivotY) => {
      const cur = currentPageRef.current;
      if (dir === "next" && cur >= totalPages - 1) return;
      if (dir === "prev" && cur <= 0) return;

      const s = dragStateRef.current;
      s.active = true;
      s.direction = dir;
      s.pageIndex = dir === "next" ? cur : cur - 1;
      s.progress = dir === "next" ? 0 : 1;
      s.startX = e.clientX ?? 0;
      s.startY = e.clientY ?? 0;
      s.pivotY = pivotY ?? 0;
      s.pointerId = e.pointerId ?? -1;
      s.velocity = 0;
      s.lastMoveAt = performance.now();
      s.lastProgress = s.progress;
      document.body.style.cursor = "grabbing";
      try {
        gl.domElement.setPointerCapture?.(s.pointerId);
      } catch {}
    },
    [gl, totalPages]
  );

  useEffect(() => {
    const el = gl.domElement;
    const onMove = (ev) => {
      const s = dragStateRef.current;
      if (!s.active) return;
      const dx = ev.clientX - s.startX;
      const full = Math.max(
        160,
        window.innerWidth * (configRef.current.dragDistanceRatio ?? 0.4)
      );
      const prev = s.progress;
      s.progress =
        s.direction === "next"
          ? clamp(-dx / full, 0, 1)
          : clamp(1 - dx / full, 0, 1);
      // Velocity in progress-per-second, smoothed.
      const now = performance.now();
      const dt = Math.max(1, now - s.lastMoveAt) / 1000;
      const instantV = (s.progress - prev) / dt;
      s.velocity = s.velocity * 0.55 + instantV * 0.45;
      s.lastMoveAt = now;
      s.lastProgress = s.progress;
    };
    const onUp = () => {
      const s = dragStateRef.current;
      if (!s.active) return;
      const thresh = configRef.current.commitThreshold ?? 0.45;
      const lookahead = configRef.current.flickLookaheadSec ?? 0.13;
      // Project the progress forward using current velocity — a fast flick
      // will commit even if the drag didn't cross the static threshold.
      const projected = s.progress + s.velocity * lookahead;
      const commit =
        s.direction === "next" ? projected >= thresh : projected <= 1 - thresh;
      s.releaseVelocity = s.velocity;
      releaseDrag(commit);
    };
    // Passive: false lets us preventDefault to suppress scroll on touch.
    const opts = { passive: false };
    el.addEventListener("pointermove", onMove, opts);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("pointerleave", onUp);
    return () => {
      el.removeEventListener("pointermove", onMove, opts);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointerleave", onUp);
    };
  }, [gl, releaseDrag]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "ArrowRight") {
        currentPageRef.current = Math.min(totalPages - 1, currentPageRef.current + 1);
      } else if (e.key === "ArrowLeft") {
        currentPageRef.current = Math.max(0, currentPageRef.current - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [totalPages]);

  return (
    <group ref={aspectGroupRef}>
      {PAGES.map((pageData, i) => (
        <Page
          key={i}
          pageIndex={i}
          currentPageRef={currentPageRef}
          dragStateRef={dragStateRef}
          configRef={configRef}
          frontData={pageData}
        />
      ))}
      {/* Invisible hit target — captures pointer events so raycasts never hit
          the SkinnedMeshes. Centered in the page. */}
      <mesh
        position={[PAGE_WIDTH / 2, 0, PAGE_DEPTH * 50]}
        onPointerDown={(e) => {
          e.stopPropagation();
          const dir = e.point.x >= 0 ? "next" : "prev";
          const pivotY = THREE.MathUtils.clamp(
            e.point.y / (PAGE_HEIGHT / 2),
            -1,
            1
          );
          onPressStart(dir, e, pivotY);
        }}
        onPointerEnter={() => {
          document.body.style.cursor = "grab";
        }}
        onPointerLeave={() => {
          document.body.style.cursor = "default";
        }}
      >
        <planeGeometry args={[PAGE_WIDTH, PAGE_HEIGHT]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
