"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useRef, useState, useCallback } from "react";
import { useProgress } from "@react-three/drei";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useLenis } from "@/context/LenisContext";
import posthog from "posthog-js";
import SplatViewer from "./SplatViewer";
import DreamyEffect from "./PixelMaskEffect";

gsap.registerPlugin(ScrollTrigger);

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
  const maskProgressRef = useRef(0); // 0 = collapsed, 1 = expanded
  const invalidateRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [debug, setDebug] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const animatingRef = useRef(false);
  const expandTweenRef = useRef(null);
  const { lenis } = useLenis();

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

    const isMobile = window.innerWidth <= 768;

    // Parallax: starts higher, settles down
    const tween = gsap.fromTo(
      canvasWrapRef.current,
      { yPercent: isMobile ? -45 : -50 },
      {
        yPercent: 0,
        ease: "none",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top bottom",
          end: "top 30%",
          scrub: isMobile ? true : 0.3,
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
        scrub: isMobile ? true : 0.5,
        onUpdate: (self) => {
          scrollProgressRef.current = self.progress;
          invalidateRef.current?.();
        },
      })
    );

    return () => triggers.forEach((t) => t.kill());
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

  const handleLoaded = useCallback(() => {
    setLoaded(true);
    posthog.capture("3d_scene_loaded");
  }, []);

  // Set initial mask size in pixels so GSAP has a concrete starting value
  useEffect(() => {
    if (!canvasWrapRef.current) return;
    const setSize = () => {
      if (expanded) return;
      const vw = window.innerWidth;
      const size = vw <= 768
        ? `${vw - 32}px`
        : `${Math.min(vw, window.innerHeight) * 0.55}px`;
      canvasWrapRef.current.style.setProperty("--mask-size", size);
    };
    setSize();
    window.addEventListener("resize", setSize);
    return () => window.removeEventListener("resize", setSize);
  }, [expanded]);

  // Compute mask sizes in pixels for reliable GSAP tweening
  const getCollapsedSize = useCallback(() => {
    const vw = window.innerWidth;
    if (vw <= 768) return `${vw - 32}px`;
    const vmin = Math.min(vw, window.innerHeight);
    return `${vmin * 0.55}px`;
  }, []);

  const getExpandedSize = useCallback(() => {
    // Just big enough to cover viewport with fade overshoot
    const vmax = Math.max(window.innerWidth, window.innerHeight);
    return `${vmax * 2.5}px`;
  }, []);

  const handleExpand = useCallback(() => {
    if (!loaded || expanded || animatingRef.current) return;
    animatingRef.current = true;
    posthog.capture("3d_scene_expanded");
    // Strip animation fills so opacity transitions can work
    document.querySelectorAll(".nav__container, .footer-clock").forEach((el) => {
      el.style.animation = "none";
      el.style.opacity = "1";
    });
    // Let the browser apply the above, then add class to trigger transition
    requestAnimationFrame(() => {
      document.documentElement.classList.add("splat-immersive");
    });

    // Scroll to bottom so the scene is centered, then lock
    lenis?.scrollTo("bottom", { duration: 0.8, lock: true });
    setTimeout(() => lenis?.stop(), 850);

    expandTweenRef.current?.kill();
    const tl = gsap.timeline({
      onComplete: () => {
        setExpanded(true);
        animatingRef.current = false;
      },
    });
    tl.to(canvasWrapRef.current, {
      "--mask-size": getExpandedSize(),
      duration: 0.8,
      ease: "power3.inOut",
    }, 0);
    tl.to(maskProgressRef, {
      current: 1,
      duration: 0.8,
      ease: "power3.inOut",
    }, 0);
    expandTweenRef.current = tl;
  }, [loaded, expanded, lenis, getExpandedSize]);

  const handleCollapse = useCallback(() => {
    if (!expanded || animatingRef.current) return;
    animatingRef.current = true;
    posthog.capture("3d_scene_collapsed");

    const collapsedSize = getCollapsedSize();

    expandTweenRef.current?.kill();
    const tl = gsap.timeline({
      onComplete: () => {
        canvasWrapRef.current.style.setProperty("--mask-size", collapsedSize);
        setExpanded(false);
        animatingRef.current = false;
        document.documentElement.classList.remove("splat-immersive");
        // Restore opacity (transition will animate it back to 1 via removing the class)
        lenis?.start();
      },
    });
    tl.to(canvasWrapRef.current, {
      "--mask-size": collapsedSize,
      duration: 0.8,
      ease: "power3.inOut",
    }, 0);
    tl.to(maskProgressRef, {
      current: 0,
      duration: 0.8,
      ease: "power3.inOut",
    }, 0);
    expandTweenRef.current = tl;
  }, [expanded, lenis, getCollapsedSize]);

  // ESC to close
  useEffect(() => {
    if (!expanded) return;
    const handler = (e) => {
      if (e.key === "Escape") handleCollapse();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [expanded, handleCollapse]);

  return (
    <>
    <section
      ref={sectionRef}
      className="splat-section"
      data-expanded={expanded || undefined}
    >
      <div
        ref={canvasWrapRef}
        className="splat-canvas-wrap"
        data-loaded={loaded || undefined}
        data-expanded={expanded || undefined}
        style={{
          "--mask-size": "var(--mask-collapsed)",
        }}
        onPointerDown={(e) => {
          if (!expanded) return;
          canvasWrapRef.current._tapStart = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          if (!expanded || !canvasWrapRef.current._tapStart) return;
          const dx = Math.abs(e.clientX - canvasWrapRef.current._tapStart.x);
          const dy = Math.abs(e.clientY - canvasWrapRef.current._tapStart.y);
          canvasWrapRef.current._tapStart = null;
          if (dx < 8 && dy < 8) handleCollapse();
        }}
      >
        <Canvas
          frameloop={isVisible ? "always" : "never"}
          flat
          camera={{ position: [0, 0, 8], fov: 50, near: 0.1, far: 100 }}
          gl={{ antialias: false, powerPreference: "high-performance" }}
          dpr={[1, 1.5]}
          style={{ width: "100%", height: "100%" }}
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
              maskProgressRef={maskProgressRef}
            />
            <DreamyEffect
              active={loaded}
              scrollProgressRef={scrollProgressRef}
              isVisible={isVisible}
            />
          </Suspense>
        </Canvas>
      </div>
      {/* Collapsed: centered click target to expand */}
      {!expanded && loaded && (
        <div className="splat-click-target" onClick={handleExpand} />
      )}
      {/* Expanded: tap canvas to collapse (drag still orbits) */}
      <style>{`
        .splat-section {
          --mask-collapsed: 55vmin;
          position: relative;
          z-index: 1;
          margin-top: -10vh;
          contain: layout style;
          pointer-events: none;
        }
        @media (max-width: 768px) {
          .splat-section {
            --mask-collapsed: calc(100vw - 32px);
          }
        }
        .splat-section[data-expanded] {
          z-index: 9999;
        }
        .splat-canvas-wrap {
          width: 100%;
          height: 100lvh;
          min-height: 500px;
          position: relative;
          opacity: 0;
          transition: opacity 1.2s cubic-bezier(0.16, 1, 0.3, 1);
          will-change: transform;
          /* CSS mask: two intersecting eased gradients form a soft-edged square */
          /* Organic ease-in-out fade — denser stops near edges for natural falloff */
          mask-image:
            linear-gradient(to right,
              rgba(0,0,0,0) 0%, rgba(0,0,0,0.03) 2%, rgba(0,0,0,0.1) 4%,
              rgba(0,0,0,0.25) 6%, rgba(0,0,0,0.5) 8%, rgba(0,0,0,0.75) 10%,
              rgba(0,0,0,0.9) 12%, rgba(0,0,0,1) 15%,
              rgba(0,0,0,1) 85%,
              rgba(0,0,0,0.9) 88%, rgba(0,0,0,0.75) 90%,
              rgba(0,0,0,0.5) 92%, rgba(0,0,0,0.25) 94%, rgba(0,0,0,0.1) 96%,
              rgba(0,0,0,0.03) 98%, rgba(0,0,0,0) 100%
            ),
            linear-gradient(to bottom,
              rgba(0,0,0,0) 0%, rgba(0,0,0,0.03) 2%, rgba(0,0,0,0.1) 4%,
              rgba(0,0,0,0.25) 6%, rgba(0,0,0,0.5) 8%, rgba(0,0,0,0.75) 10%,
              rgba(0,0,0,0.9) 12%, rgba(0,0,0,1) 15%,
              rgba(0,0,0,1) 85%,
              rgba(0,0,0,0.9) 88%, rgba(0,0,0,0.75) 90%,
              rgba(0,0,0,0.5) 92%, rgba(0,0,0,0.25) 94%, rgba(0,0,0,0.1) 96%,
              rgba(0,0,0,0.03) 98%, rgba(0,0,0,0) 100%
            );
          -webkit-mask-image:
            linear-gradient(to right,
              rgba(0,0,0,0) 0%, rgba(0,0,0,0.03) 2%, rgba(0,0,0,0.1) 4%,
              rgba(0,0,0,0.25) 6%, rgba(0,0,0,0.5) 8%, rgba(0,0,0,0.75) 10%,
              rgba(0,0,0,0.9) 12%, rgba(0,0,0,1) 15%,
              rgba(0,0,0,1) 85%,
              rgba(0,0,0,0.9) 88%, rgba(0,0,0,0.75) 90%,
              rgba(0,0,0,0.5) 92%, rgba(0,0,0,0.25) 94%, rgba(0,0,0,0.1) 96%,
              rgba(0,0,0,0.03) 98%, rgba(0,0,0,0) 100%
            ),
            linear-gradient(to bottom,
              rgba(0,0,0,0) 0%, rgba(0,0,0,0.03) 2%, rgba(0,0,0,0.1) 4%,
              rgba(0,0,0,0.25) 6%, rgba(0,0,0,0.5) 8%, rgba(0,0,0,0.75) 10%,
              rgba(0,0,0,0.9) 12%, rgba(0,0,0,1) 15%,
              rgba(0,0,0,1) 85%,
              rgba(0,0,0,0.9) 88%, rgba(0,0,0,0.75) 90%,
              rgba(0,0,0,0.5) 92%, rgba(0,0,0,0.25) 94%, rgba(0,0,0,0.1) 96%,
              rgba(0,0,0,0.03) 98%, rgba(0,0,0,0) 100%
            );
          mask-composite: intersect;
          -webkit-mask-composite: destination-in;
          mask-size: var(--mask-size) var(--mask-size);
          -webkit-mask-size: var(--mask-size) var(--mask-size);
          mask-position: center;
          -webkit-mask-position: center;
          mask-repeat: no-repeat;
          -webkit-mask-repeat: no-repeat;
        }
        .splat-canvas-wrap[data-loaded] {
          opacity: 1;
        }
        .splat-click-target {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: var(--mask-collapsed);
          height: var(--mask-collapsed);
          cursor: pointer;
          pointer-events: auto;
          z-index: 2;
        }
      `}</style>
    </section>
    </>
  );
}
