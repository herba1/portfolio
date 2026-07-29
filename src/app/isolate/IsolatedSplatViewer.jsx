"use client";

import { useRef, useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Splat } from "@react-three/drei";
import { SPLAT_VERSION } from "./splatVersion";

// ---------------------------------------------------------------------------
// Same Vercel CDN workaround as the home-page viewer: drei's Splat loader
// trips over the Content-Length the CDN returns, so in production we pull the
// file ourselves and hand the loader a blob URL.
// ---------------------------------------------------------------------------
function useSplatUrl(src) {
  const needsBlob = process.env.NODE_ENV !== "development";
  const [url, setUrl] = useState(needsBlob ? null : src);
  useEffect(() => {
    if (!needsBlob) return;
    let revoke;
    fetch(src)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        revoke = blobUrl;
        setUrl(blobUrl);
      })
      .catch((err) => console.error("[Splat] fetch failed:", err?.message || err));
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [src, needsBlob]);
  return url;
}

function isTouchDevice() {
  if (typeof window === "undefined") return false;
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

// Produced by scripts/extract-splat-subject.mjs — the person only, recentred
// on the origin and normalised to 2 units tall.
//
// The ?v= is load-bearing: /splats/* is served `public, max-age=31536000,
// immutable` (next.config.mjs), so without a hash in the URL a browser that
// has already seen this file will never pick up a regenerated one — not even
// on reload. The script rewrites splatVersion.js on every run.
const SPLAT_SRC = `/splats/herb-isolated.splat?v=${SPLAT_VERSION}`;

// The scan's front faces roughly -Z after drei flips Y and Z, so start the
// orbit a little past three-quarter view and let drag take it from there.
const BASE_THETA = Math.PI * 0.18;

export default function IsolatedSplatViewer({ autoRotate = true, radius = 4.2 }) {
  const splatUrl = useSplatUrl(SPLAT_SRC);

  const thetaRef = useRef(0);       // smoothed
  const phiRef = useRef(0);
  const targetThetaRef = useRef(0); // driven by drag + autorotate
  const targetPhiRef = useRef(0);
  const spinRef = useRef(0);
  const draggingRef = useRef(false);
  const lastRef = useRef({ x: 0, y: 0 });

  const { gl } = useThree();

  // Drag to orbit — one handler set for pointer events covers mouse and touch.
  useEffect(() => {
    const canvas = gl.domElement;
    const dragSpeed = 3.2;
    const maxPhi = Math.PI / 3;

    const onDown = (e) => {
      draggingRef.current = true;
      lastRef.current = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e) => {
      if (!draggingRef.current) return;
      const dx = (e.clientX - lastRef.current.x) / window.innerWidth;
      const dy = (e.clientY - lastRef.current.y) / window.innerHeight;
      targetThetaRef.current -= dx * dragSpeed;
      targetPhiRef.current = Math.max(
        -maxPhi,
        Math.min(maxPhi, targetPhiRef.current + dy * dragSpeed)
      );
      lastRef.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e) => {
      draggingRef.current = false;
      canvas.releasePointerCapture?.(e.pointerId);
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };
  }, [gl]);

  // Desktop pointer parallax — a slight lean toward the cursor when idle.
  const mouseRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (isTouchDevice()) return;
    const handler = (e) => {
      mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, []);

  useFrame(({ camera }, delta) => {
    if (autoRotate && !draggingRef.current) {
      spinRef.current += delta * 0.16;
    }

    const parallaxT = isTouchDevice() ? 0 : mouseRef.current.x * 0.22;
    const parallaxP = isTouchDevice() ? 0 : mouseRef.current.y * 0.14;

    const wantTheta = BASE_THETA + spinRef.current + targetThetaRef.current + parallaxT;
    const wantPhi = targetPhiRef.current + parallaxP;

    const damping = 0.12;
    thetaRef.current += (wantTheta - thetaRef.current) * damping;
    phiRef.current += (wantPhi - phiRef.current) * damping;

    const theta = thetaRef.current;
    const phi = phiRef.current;

    camera.position.x = radius * Math.sin(theta) * Math.cos(phi);
    camera.position.y = radius * Math.sin(phi);
    camera.position.z = radius * Math.cos(theta) * Math.cos(phi);
    camera.lookAt(0, 0, 0);
  });

  if (!splatUrl) return null;

  return (
    <Splat
      src={splatUrl}
      scale={1}
      position={[0, 0, 0]}
      toneMapped={false}
      alphaTest={0.08}
      chunkSize={50000}
    />
  );
}
