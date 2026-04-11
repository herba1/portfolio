"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useProgress } from "@react-three/drei";
import { Leva } from "leva";
import { useLenis } from "@/context/LenisContext";
import SplatViewer from "./SplatViewer";
import DreamyEffect from "./PixelMaskEffect";
import posthog from "posthog-js";

function LoadWatcher({ onLoaded }) {
  const { progress } = useProgress();
  useEffect(() => {
    if (progress < 100) return;
    const id = setTimeout(onLoaded, 0);
    return () => clearTimeout(id);
  }, [progress, onLoaded]);
  return null;
}

export default function ExperienceScene() {
  const { lenis } = useLenis();
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [debug, setDebug] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const wrapperRef = useRef(null);

  // Force full viewport
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyHeight = body.style.height;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.height = "100dvh";
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.height = prevBodyHeight;
    };
  }, []);

  useEffect(() => {
    if (!lenis) return;
    lenis.stop();
    return () => lenis.start();
  }, [lenis]);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mql.matches);
    const handler = (e) => setPrefersReducedMotion(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.key === "g") {
        e.preventDefault();
        setDebug((d) => !d);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleLoaded = useCallback(() => {
    setLoaded(true);
    posthog.capture("3d_scene_loaded");
  }, []);

  return (
    <>
      {debug && <Leva collapsed />}
      <div
        ref={wrapperRef}
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(75vh, 75vw)",
          height: "min(75vh, 75vw)",
          /* Edge fade on all 4 sides of the square */
          maskImage: [
            "linear-gradient(to right, transparent, black 10%, black 90%, transparent)",
            "linear-gradient(to bottom, transparent, black 10%, black 90%, transparent)",
          ].join(", "),
          WebkitMaskImage: [
            "linear-gradient(to right, transparent, black 10%, black 90%, transparent)",
            "linear-gradient(to bottom, transparent, black 10%, black 90%, transparent)",
          ].join(", "),
          maskComposite: "intersect",
          WebkitMaskComposite: "destination-in",
        }}
      >
        <Canvas
          camera={{ position: [0, 0, 8], fov: 50, near: 0.1, far: 100 }}
          gl={{ antialias: false, powerPreference: "high-performance" }}
          dpr={[1, 1.5]}
          style={{ width: "100%", height: "100%", background: "#ffffff" }}
        >
          <Suspense fallback={null}>
            <LoadWatcher onLoaded={handleLoaded} />
            <SplatViewer reducedMotion={prefersReducedMotion} loaded={loaded} />
            <DreamyEffect active={loaded} />
          </Suspense>
        </Canvas>
      </div>
    </>
  );
}
