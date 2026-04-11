"use client";

import { useRef, useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Splat } from "@react-three/drei";
import { useControls, folder } from "leva";
import posthog from "posthog-js";

// Vercel's CDN strips Content-Length when applying brotli compression.
// Drei's Splat loader requires Content-Length and throws without it.
// Pre-fetch the file and serve via blob URL which always has Content-Length.
function useBlobUrl(src) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let revoke;
    const t0 = performance.now();
    console.log("[Splat] fetching", src);
    fetch(src)
      .then((r) => {
        const cl = r.headers.get("Content-Length");
        const ce = r.headers.get("Content-Encoding");
        console.log("[Splat] response", r.status, { contentLength: cl, contentEncoding: ce });
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        return r.blob();
      })
      .then((blob) => {
        console.log("[Splat] blob ready", (blob.size / 1024).toFixed(0) + "KB", "in", (performance.now() - t0).toFixed(0) + "ms");
        const blobUrl = URL.createObjectURL(blob);
        revoke = blobUrl;
        setUrl(blobUrl);
      })
      .catch((err) => {
        console.error("[Splat] pre-fetch failed:", err?.message || err);
      });
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [src]);
  return url;
}

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isTouchDevice() {
  if (typeof window === "undefined") return false;
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
}

const SPLAT_SRC = "/splats/herb-scan-clean.splat";

export default function SplatViewer({ reducedMotion, loaded, scrollProgressRef, isVisible }) {
  const splatUrl = useBlobUrl(SPLAT_SRC);

  // Pointer parallax (desktop) — tracks mouse across full viewport
  const pointerThetaRef = useRef(0);
  const pointerPhiRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0 }); // normalized -1 to 1

  // Gyro rotation (Android)
  const gyroThetaRef = useRef(0);
  const gyroPhiRef = useRef(0);
  const [useGyro, setUseGyro] = useState(false);

  // Touch drag fallback (iOS)
  const touchThetaRef = useRef(0);
  const touchPhiRef = useRef(0);
  const isDraggingRef = useRef(false);
  const lastTouchRef = useRef({ x: 0, y: 0 });

  const { gl } = useThree();

  const {
    cameraRadius,
    cameraStart,
    splatScale,
    alphaTest,
  } = useControls(
    "Experience",
    {
      Camera: folder({
        cameraRadius: { value: 2, min: 0.5, max: 20, step: 0.1 },
        cameraStart: { value: 8, min: 2, max: 20, step: 0.5 },
      }),
      Splat: folder({
        splatScale: { value: 1, min: 0.1, max: 5, step: 0.1 },
        alphaTest: { value: 0.1, min: 0, max: 1, step: 0.01 },
      }),
    },
    { collapsed: true }
  );

  // Global mouse tracking (viewport-based, not canvas-based)
  useEffect(() => {
    if (isTouchDevice()) return;
    const handler = (e) => {
      mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, []);

  // track device interaction mode once
  useEffect(() => {
    const mode = isIOS() ? "touch_ios" : isTouchDevice() ? "touch_android" : "desktop";
    posthog.capture("3d_interaction_mode", { mode });
  }, []);

  // Gyroscope (non-iOS touch devices)
  useEffect(() => {
    if (!isTouchDevice() || isIOS()) return;

    const handler = (e) => {
      // beta = front-back tilt (-180 to 180), gamma = left-right (-90 to 90)
      const maxAngle = Math.PI / 6;
      if (e.gamma !== null) gyroThetaRef.current = (e.gamma / 90) * maxAngle;
      if (e.beta !== null) gyroPhiRef.current = ((e.beta - 45) / 90) * maxAngle * 0.5;
    };

    window.addEventListener("deviceorientation", handler);
    setUseGyro(true);
    return () => window.removeEventListener("deviceorientation", handler);
  }, []);

  // Touch drag — full orbit, no clamping
  useEffect(() => {
    if (!isTouchDevice()) return;

    const canvas = gl.domElement;
    const dragSpeed = 4;

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      isDraggingRef.current = true;
      lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };

    const onTouchMove = (e) => {
      if (!isDraggingRef.current || e.touches.length !== 1) return;
      const dx = (e.touches[0].clientX - lastTouchRef.current.x) / window.innerWidth;
      const dy = (e.touches[0].clientY - lastTouchRef.current.y) / window.innerHeight;
      // Accumulate — no clamping, full 360° orbit
      touchThetaRef.current -= dx * dragSpeed;
      touchPhiRef.current += dy * dragSpeed;
      lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };

    const onTouchEnd = () => { isDraggingRef.current = false; };

    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: true });
    canvas.addEventListener("touchend", onTouchEnd);

    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, [gl]);

  useFrame(({ camera }) => {
    if (reducedMotion || !isVisible) return;

    // Camera distance driven by scroll progress
    const scrollP = scrollProgressRef?.current ?? 1;
    const t = scrollP;
    const eased = t < 0.5
      ? 16 * t * t * t * t * t
      : 1 - Math.pow(-2 * t + 2, 5) / 2;
    const currentRadius = cameraStart + (cameraRadius - cameraStart) * eased;

    // Rotation source: pointer (desktop), gyro (Android), touch drag (iOS)
    // Base offset: 90° around Y axis
    const BASE_THETA = Math.PI / 2;
    let theta = BASE_THETA;
    let phi = 0;
    const damping = 0.15;

    if (isTouchDevice()) {
      // Mobile: drag for full orbit + optional gyro tilt on top
      pointerThetaRef.current += (touchThetaRef.current + (useGyro ? gyroThetaRef.current : 0) - pointerThetaRef.current) * damping;
      pointerPhiRef.current += (touchPhiRef.current + (useGyro ? gyroPhiRef.current : 0) - pointerPhiRef.current) * damping;
      theta = BASE_THETA + pointerThetaRef.current;
      phi = pointerPhiRef.current;
    } else {
      // Desktop: pointer parallax
      const maxAngle = Math.PI / 3;
      pointerThetaRef.current += (mouseRef.current.x * maxAngle - pointerThetaRef.current) * damping;
      pointerPhiRef.current += (mouseRef.current.y * maxAngle * 0.5 - pointerPhiRef.current) * damping;
      theta = BASE_THETA + pointerThetaRef.current;
      phi = pointerPhiRef.current;
    }

    camera.position.x = currentRadius * Math.sin(theta) * Math.cos(phi);
    camera.position.y = currentRadius * Math.sin(phi);
    camera.position.z = currentRadius * Math.cos(theta) * Math.cos(phi);
    camera.lookAt(0, 0, 0);
  });

  if (!splatUrl) return null;

  return (
    <Splat
      src={splatUrl}
      scale={splatScale}
      position={[0, 0, 0]}
      toneMapped={false}
      alphaTest={alphaTest}
      chunkSize={50000}
    />
  );
}
