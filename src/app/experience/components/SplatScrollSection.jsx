"use client";

import { Canvas, invalidate } from "@react-three/fiber";
import { Suspense, useEffect, useRef, useState, useCallback } from "react";
import { useProgress } from "@react-three/drei";
import { Leva } from "leva";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import SplatViewer from "./SplatViewer";
import DreamyEffect from "./PixelMaskEffect";

gsap.registerPlugin(ScrollTrigger);

// Eased gradient edge fade — computed once at module level
const easedEdgeFade = (() => {
  const fadePercent = 8;
  const steps = 12;
  const stops = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const eased = -(Math.cos(Math.PI * t) - 1) / 2;
    const pos = t * fadePercent;
    stops.push(`rgba(0,0,0,${eased.toFixed(3)}) ${pos.toFixed(1)}%`);
  }
  stops.push(`black ${fadePercent}%`);
  stops.push(`black ${100 - fadePercent}%`);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const eased = -(Math.cos(Math.PI * t) - 1) / 2;
    const pos = (100 - fadePercent) + t * fadePercent;
    stops.push(`rgba(0,0,0,${(1 - eased).toFixed(3)}) ${pos.toFixed(1)}%`);
  }
  return stops.join(", ");
})();

function LoadWatcher({ onLoaded }) {
  const { progress } = useProgress();
  useEffect(() => {
    if (progress < 100) return;
    const id = setTimeout(onLoaded, 0);
    return () => clearTimeout(id);
  }, [progress, onLoaded]);
  return null;
}

export default function SplatScrollSection() {
  const sectionRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const scrollProgressRef = useRef(0);
  const invalidateRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [debug, setDebug] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  // Pause rendering when off-screen
  useEffect(() => {
    if (!canvasWrapRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0, rootMargin: "100px" }
    );
    observer.observe(canvasWrapRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!sectionRef.current || !canvasWrapRef.current) return;

    const triggers = [];

    // Parallax: starts higher, settles down
    const tween = gsap.fromTo(
      canvasWrapRef.current,
      { yPercent: -40 },
      {
        yPercent: 0,
        ease: "none",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top bottom",
          end: "top 30%",
          scrub: 0.3,
        },
      }
    );
    if (tween.scrollTrigger) triggers.push(tween.scrollTrigger);

    // Progress: drives pixelation + camera zoom
    triggers.push(
      ScrollTrigger.create({
        trigger: sectionRef.current,
        start: "top bottom",
        end: "bottom bottom",
        scrub: 0.5,
        onUpdate: (self) => {
          scrollProgressRef.current = self.progress;
          // Trigger a render when scroll changes
          invalidateRef.current?.();
        },
      })
    );

    return () => triggers.forEach((t) => t.kill());
  }, []);

  // On mobile, prevent scroll when touching canvas
  useEffect(() => {
    const wrap = canvasWrapRef.current;
    if (!wrap) return;
    const preventScroll = (e) => {
      if (e.touches && e.touches.length === 1) e.preventDefault();
    };
    wrap.addEventListener("touchmove", preventScroll, { passive: false });
    return () => wrap.removeEventListener("touchmove", preventScroll);
  }, []);

  // Ctrl+G debug panel
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

  const handleLoaded = useCallback(() => setLoaded(true), []);

  const edgeFade = easedEdgeFade;

  return (
    <section
      ref={sectionRef}
      style={{
        display: "flex",
        justifyContent: "center",
        marginTop: "-15vh",
        paddingTop: "5vh",
        paddingBottom: "30vh",
        position: "relative",
        zIndex: 1,
        contain: "layout style",
      }}
    >
      <Leva hidden={!debug} collapsed />
      <div
        ref={canvasWrapRef}
        className="splat-canvas-wrap"
        data-loaded={loaded || undefined}
        style={{
          width: "min(55vh, 55vw)",
          height: "min(55vh, 55vw)",
          borderRadius: "40px",
          overflow: "hidden",
          willChange: "transform",
          touchAction: "none",
          maskImage: [
            `linear-gradient(to right, ${edgeFade})`,
            `linear-gradient(to bottom, ${edgeFade})`,
          ].join(", "),
          WebkitMaskImage: [
            `linear-gradient(to right, ${edgeFade})`,
            `linear-gradient(to bottom, ${edgeFade})`,
          ].join(", "),
          maskComposite: "intersect",
          WebkitMaskComposite: "destination-in",
        }}
      >
        <Canvas
          frameloop={isVisible ? "always" : "never"}
          flat
          camera={{ position: [0, 0, 8], fov: 50, near: 0.1, far: 100 }}
          gl={{ antialias: false, powerPreference: "high-performance" }}
          dpr={[1, 1.5]}
          style={{ width: "100%", height: "100%", background: "transparent" }}
          onCreated={(state) => {
            invalidateRef.current = state.invalidate;
          }}
        >
          <Suspense fallback={null}>
            <LoadWatcher onLoaded={handleLoaded} />
            <SplatViewer
              reducedMotion={false}
              loaded={loaded}
              scrollProgressRef={scrollProgressRef}
              isVisible={isVisible}
            />
            <DreamyEffect
              active={loaded}
              scrollProgressRef={scrollProgressRef}
              isVisible={isVisible}
            />
          </Suspense>
        </Canvas>
      </div>
      <style>{`
        .splat-canvas-wrap {
          opacity: 0;
          transition: opacity 1.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .splat-canvas-wrap[data-loaded] {
          opacity: 1;
        }
        @media (max-width: 768px) {
          .splat-canvas-wrap {
            width: calc(100vw - 32px) !important;
            height: calc(100vw - 32px) !important;
            border-radius: 24px !important;
          }
        }
      `}</style>
    </section>
  );
}
