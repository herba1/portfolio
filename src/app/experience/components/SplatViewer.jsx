"use client";

import { useRef, useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Splat } from "@react-three/drei";
import posthog from "posthog-js";

// ---------------------------------------------------------------------------
// Workaround: Vercel CDN + drei Splat Content-Length mismatch
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

const SPLAT_SRC = "/splats/herb-scan-clean.splat";

export default function SplatViewer({ reducedMotion, loaded, scrollProgressRef, isVisible, maskProgressRef }) {
  const splatUrl = useSplatUrl(SPLAT_SRC);

  // Pointer parallax (desktop) — tracks mouse across full viewport
  const pointerThetaRef = useRef(0);
  const pointerPhiRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0 }); // normalized -1 to 1

  // Touch drag (mobile — only active when expanded)
  const touchThetaRef = useRef(0);
  const touchPhiRef = useRef(0);
  const isDraggingRef = useRef(false);
  const lastTouchRef = useRef({ x: 0, y: 0 });

  const { gl } = useThree();

  const cameraRadius = 2;
  const cameraStart = 8;
  const fovCollapsed = 86;
  const fovExpanded = 50;
  const splatScale = 1;
  const alphaTest = 0.1;

  // Global mouse tracking (desktop only)
  useEffect(() => {
    if (isTouchDevice()) return;
    const handler = (e) => {
      mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, []);

  // Track device interaction mode once
  useEffect(() => {
    const mode = isTouchDevice() ? "touch" : "desktop";
    posthog.capture("3d_interaction_mode", { mode });
  }, []);

  // Touch drag — only when expanded (maskProgress > 0.5)
  useEffect(() => {
    if (!isTouchDevice()) return;

    const canvas = gl.domElement;
    const dragSpeed = 4;

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      // Only allow drag when expanded
      if ((maskProgressRef?.current ?? 0) < 0.5) return;
      isDraggingRef.current = true;
      lastTouchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };

    const onTouchMove = (e) => {
      if (!isDraggingRef.current || e.touches.length !== 1) return;
      const dx = (e.touches[0].clientX - lastTouchRef.current.x) / window.innerWidth;
      const dy = (e.touches[0].clientY - lastTouchRef.current.y) / window.innerHeight;
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
  }, [gl, maskProgressRef]);

  useFrame(({ camera }) => {
    if (reducedMotion || !isVisible) return;

    // Camera distance driven by scroll progress
    const scrollP = scrollProgressRef?.current ?? 1;
    const t = scrollP;
    const eased = t < 0.5
      ? 16 * t * t * t * t * t
      : 1 - Math.pow(-2 * t + 2, 5) / 2;
    const currentRadius = cameraStart + (cameraRadius - cameraStart) * eased;

    const BASE_THETA = Math.PI * 0.39;
    let theta = BASE_THETA;
    let phi = 0;
    const damping = 0.15;

    if (isTouchDevice()) {
      // Mobile: touch drag only (when expanded)
      pointerThetaRef.current += (touchThetaRef.current - pointerThetaRef.current) * damping;
      pointerPhiRef.current += (touchPhiRef.current - pointerPhiRef.current) * damping;
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

    // FOV driven by expand state
    const maskP = maskProgressRef?.current ?? 0;
    const targetFov = fovCollapsed + (fovExpanded - fovCollapsed) * maskP;
    camera.fov += (targetFov - camera.fov) * 0.15;
    camera.updateProjectionMatrix();
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
