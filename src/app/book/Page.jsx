"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { easing } from "maath";
import {
  PAGE_WIDTH,
  PAGE_HEIGHT,
  PAGE_DEPTH,
  PAGE_SEGMENTS,
  SEGMENT_WIDTH,
  PAGE_TONE,
} from "./pageData";
import { makePageTexture } from "./makePageTexture";
import { seededRand, DEFAULT_CONFIG, ARC_MODES, EASE_OUT } from "./bookConfig";

const templateGeometry = new THREE.BoxGeometry(
  PAGE_WIDTH,
  PAGE_HEIGHT,
  PAGE_DEPTH,
  PAGE_SEGMENTS,
  2
);
templateGeometry.translate(PAGE_WIDTH / 2, 0, 0);
{
  const position = templateGeometry.attributes.position;
  const vertex = new THREE.Vector3();
  const skinIndexes = [];
  const skinWeights = [];
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i);
    const x = vertex.x;
    const skinIndex = Math.max(0, Math.floor(x / SEGMENT_WIDTH));
    const skinWeight = (x % SEGMENT_WIDTH) / SEGMENT_WIDTH;
    skinIndexes.push(skinIndex, skinIndex + 1, 0, 0);
    skinWeights.push(1 - skinWeight, skinWeight, 0, 0);
  }
  templateGeometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndexes, 4));
  templateGeometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
}

const paperColor = new THREE.Color(PAGE_TONE);
const edgeColor = new THREE.Color("#d8deea");

export default function Page({
  pageIndex,
  currentPageRef,
  dragStateRef,
  configRef,
  frontData,
}) {
  const groupRef = useRef();
  const skinnedMeshRef = useRef();
  const progressRef = useRef({
    value: pageIndex < currentPageRef.current ? 1 : 0,
  });
  // Idle-frame skip: remembers last-applied frame state so we can bail early.
  const lastAppliedRef = useRef({ t: -1, current: -1, tilt: -1, pageVisible: true });
  // Cached per-bone arc weights — only recomputed when arcMode changes.
  const weightsCacheRef = useRef({ mode: null, N: -1, weights: null });
  // Tween state — captures the starting value and target when release begins.
  const tweenRef = useRef({
    active: false,
    from: 0,
    to: 0,
    startAt: 0,
    duration: 520,
  });
  const wasTurningRef = useRef(false);
  const lastRestTargetRef = useRef(null);
  const axisTiltRef = useRef({ value: 0 });

  // Per-page seeded randomness — deterministic but unique per page.
  const rand = useMemo(
    () => ({
      damp: seededRand(pageIndex, 1),
      arc: seededRand(pageIndex, 2),
      fold: seededRand(pageIndex, 3),
      tilt: seededRand(pageIndex, 4),
      phase: seededRand(pageIndex, 5),
    }),
    [pageIndex]
  );

  // Stable mesh built once.
  const { skinnedMesh, materials, geometry } = useMemo(() => {
    const geometry = templateGeometry.clone();
    const bones = [];
    for (let i = 0; i <= PAGE_SEGMENTS; i++) {
      const bone = new THREE.Bone();
      bone.position.x = i === 0 ? 0 : SEGMENT_WIDTH;
      if (i > 0) bones[i - 1].add(bone);
      bones.push(bone);
    }
    const skeleton = new THREE.Skeleton(bones);

    const materials = [
      new THREE.MeshStandardMaterial({ color: edgeColor, roughness: 0.95 }),
      new THREE.MeshStandardMaterial({ color: edgeColor, roughness: 0.95 }),
      new THREE.MeshStandardMaterial({ color: paperColor, roughness: 0.98 }),
      new THREE.MeshStandardMaterial({ color: paperColor, roughness: 0.98 }),
      new THREE.MeshStandardMaterial({ color: paperColor, roughness: 0.92 }),
      new THREE.MeshStandardMaterial({ color: paperColor, roughness: 0.98 }),
    ];

    const mesh = new THREE.SkinnedMesh(geometry, materials);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = true;
    mesh.add(bones[0]);
    mesh.bind(skeleton);
    return { skinnedMesh: mesh, materials, geometry };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      materials.forEach((m) => m.dispose());
      geometry.dispose();
    };
  }, [materials, geometry]);

  const { size } = useThree();
  const [stableSize, setStableSize] = useState({ width: size.width, height: size.height });
  useEffect(() => {
    if (!size.width || !size.height) return;
    const id = setTimeout(() => setStableSize({ width: size.width, height: size.height }), 180);
    return () => clearTimeout(id);
  }, [size.width, size.height]);

  const frontTexture = useMemo(
    () =>
      makePageTexture({
        ...frontData,
        pageNum: pageIndex + 1,
        width: stableSize.width || 1280,
        height: stableSize.height || 800,
      }),
    [frontData, pageIndex, stableSize.width, stableSize.height]
  );

  const prevTexRef = useRef(null);
  useEffect(() => {
    materials[4].map = frontTexture;
    materials[4].needsUpdate = true;
    if (prevTexRef.current && prevTexRef.current !== frontTexture) {
      prevTexRef.current.dispose();
    }
    prevTexRef.current = frontTexture;
  }, [frontTexture, materials]);

  useEffect(
    () => () => {
      if (prevTexRef.current) prevTexRef.current.dispose();
    },
    []
  );

  useFrame((_, rawDelta) => {
    const mesh = skinnedMeshRef.current;
    const group = groupRef.current;
    if (!mesh || !group || !mesh.skeleton) return;
    const bones = mesh.skeleton.bones;
    if (!bones || bones.length === 0) return;

    const delta = Math.min(rawDelta, 1 / 30);
    const current = currentPageRef.current;
    const drag = dragStateRef.current;
    const cfg = configRef?.current ?? DEFAULT_CONFIG;

    const r = cfg.randomness ?? 0;
    const durVary = 1 + rand.damp * 0.2 * r;
    const arcVary = 1 + rand.arc * 0.25 * r;
    const foldVary = 1 + rand.fold * 0.4 * r;
    const tiltVary = 1 + rand.tilt * 0.3 * r;

    const isTurning = drag.active && drag.pageIndex === pageIndex;
    const restTarget = pageIndex < current ? 1 : 0;

    // ── Paper release: time-based tween with an ease-out curve ──────────
    // While dragging: snap 1:1 to the pointer. On release OR when the rest
    // target changes (e.g., arrow key): start a tween from current → target.
    const easeFn = EASE_OUT[cfg.releaseEase] ?? EASE_OUT.quart;
    const durationMs = (cfg.releaseDurationMs ?? 520) * durVary;

    if (isTurning) {
      progressRef.current.value = drag.progress;
      tweenRef.current.active = false;
      wasTurningRef.current = true;
      lastRestTargetRef.current = null;
    } else {
      // Detect transition: either just released from drag, or rest target changed.
      const justReleased = wasTurningRef.current;
      const restChanged = lastRestTargetRef.current !== restTarget;
      if (justReleased || restChanged) {
        // Fixed base duration — the ease curve handles the motion shape.
        // Flick velocity only compresses the duration modestly (never below
        // 40% of base), so the feel stays CSS-transition-consistent.
        const flickInfl = cfg.flickInfluence ?? 0.7;
        const vel = justReleased ? Math.abs(drag.releaseVelocity ?? 0) : 0;
        const velocityFactor = Math.max(0.4, 1 / (1 + vel * 0.55 * flickInfl));
        tweenRef.current.active = true;
        tweenRef.current.from = progressRef.current.value;
        tweenRef.current.to = restTarget;
        tweenRef.current.startAt = performance.now();
        tweenRef.current.duration = durationMs * velocityFactor;
        wasTurningRef.current = false;
        lastRestTargetRef.current = restTarget;
      }
      if (tweenRef.current.active) {
        const elapsed = performance.now() - tweenRef.current.startAt;
        const u = Math.min(1, elapsed / tweenRef.current.duration);
        const k = easeFn(u);
        progressRef.current.value =
          tweenRef.current.from + (tweenRef.current.to - tweenRef.current.from) * k;
        if (u >= 1) {
          progressRef.current.value = tweenRef.current.to;
          tweenRef.current.active = false;
        }
      } else {
        progressRef.current.value = restTarget;
      }
    }
    const t = progressRef.current.value;

    const tiltTarget = isTurning
      ? drag.pivotY * (cfg.axisTiltAmplitude ?? 0.35) * tiltVary
      : 0;
    easing.damp(axisTiltRef.current, "value", tiltTarget, 0.18, delta);
    const tilt = axisTiltRef.current.value;

    // Hide pages that can't affect the view — deep in either stack.
    const visible = isTurning || tweenRef.current.active || Math.abs(pageIndex - current) <= 2;
    if (mesh.visible !== visible) mesh.visible = visible;

    // ── Early exit: page is idle, nothing's changed — skip the whole update.
    const last = lastAppliedRef.current;
    const settled =
      !isTurning &&
      !tweenRef.current.active &&
      t === last.t &&
      current === last.current &&
      Math.abs(tilt - last.tilt) < 1e-5 &&
      visible === last.pageVisible;
    if (settled) return;
    last.t = t;
    last.current = current;
    last.tilt = tilt;
    last.pageVisible = visible;

    // Z stacking — stay elevated for the ENTIRE tween (not just active drag)
    // so the page doesn't drop back into the stack while still rotating.
    // Wide gaps between stack positions avoid z-fighting.
    const Z_GAP = PAGE_DEPTH * 3;
    const inTransition = isTurning || tweenRef.current.active;
    let z;
    if (inTransition) {
      z = PAGE_DEPTH * 40;
    } else if (pageIndex < current) {
      // flipped stack (left side)
      z = -(current - pageIndex) * Z_GAP;
    } else {
      // unflipped stack (right side) — current is on top
      z = -(pageIndex - current) * Z_GAP;
    }
    group.position.z = z;
    group.position.y = 0;

    // Per-bone rotation is a straight lerp between two distributions:
    //   arcBlend=0 → all rotation at bone[0] (pure hinge swing)
    //   arcBlend=1 → distributed by arcMode weights (arc shape)
    //   arcBlend>1 → extrapolates; bone[0] may counter-rotate while others
    //                over-rotate, but the free-edge total stays -π·t.
    // Total rotation at the free edge is ALWAYS -π·t — monotonic in t, so
    // the fold can't stop-and-reverse as t grows.
    const arcBlend = (cfg.arcBlend ?? 0.5) * arcVary;
    const N = bones.length;
    const totalRot = -Math.PI * t;

    const cache = weightsCacheRef.current;
    let weights;
    if (cache.mode === cfg.arcMode && cache.N === N && cache.weights) {
      weights = cache.weights;
    } else {
      const arcFn = ARC_MODES[cfg.arcMode] ?? ARC_MODES.uniform;
      weights = new Array(N);
      let wSum = 0;
      for (let i = 0; i < N; i++) {
        const u = N === 1 ? 0 : i / (N - 1);
        const w = Math.max(0, arcFn(u));
        weights[i] = w;
        wSum += w;
      }
      if (wSum <= 0) {
        for (let i = 0; i < N; i++) weights[i] = 1 / N;
      } else {
        for (let i = 0; i < N; i++) weights[i] /= wSum;
      }
      cache.mode = cfg.arcMode;
      cache.N = N;
      cache.weights = weights;
    }

    // bone[0] = (1 - arcBlend·(1 - w[0])) · totalRot
    bones[0].rotation.y = totalRot * (1 - arcBlend * (1 - weights[0]));
    bones[0].rotation.z = tilt * Math.sin(Math.max(0.0001, t) * Math.PI);

    const foldAmt = (cfg.foldAmplitude ?? 0.05) * foldVary * Math.sin(t * Math.PI);
    const phase = rand.phase * 0.4;
    for (let i = 1; i < N; i++) {
      const u = i / (N - 1);
      const bend = Math.sin((u + phase * 0.05) * Math.PI);
      bones[i].rotation.y = arcBlend * totalRot * weights[i];
      bones[i].rotation.x = foldAmt * bend;
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={skinnedMesh} ref={skinnedMeshRef} />
    </group>
  );
}
