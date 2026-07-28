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

    // Parallax: starts higher, settles down.
    // Mobile uses a shallower offset — the wrap is shorter and sits higher,
    // so a big offset would drag the scene back under the fold.
    const tween = gsap.fromTo(
      canvasWrapRef.current,
      { yPercent: isMobile ? -20 : -50 },
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
      {/* Click target + tap hint (stays in DOM for exit animation) */}
      {loaded && (
        <div
          className="splat-click-target"
          data-hiding={expanded || undefined}
          onClick={!expanded ? handleExpand : undefined}
        >
          {/* Outer: handles fade in + fade out */}
          <div className="splat-tap-wrap" aria-hidden="true">
            {/* Inner: looping tap-gesture showcase.
                110-unit viewBox leaves margin on every side so the hand never clips
                at the far end of its rest offset. Tap point is (46, 32). */}
            <svg viewBox="0 0 110 110" fill="none" className="splat-tap-anim">
              <circle className="splat-ripple" cx="46" cy="32" r="13" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              <circle className="splat-ripple" style={{ "--ripple-d": "0.11s" }} cx="46" cy="32" r="13" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              <circle className="splat-tap-dot" cx="46" cy="32" r="4.5" fill="currentColor" />
              {/* Split-transform: translate, rotate and press-scale each run on
                  their own track with different timing — that offset is what
                  reads as organic. The press group scales from the FINGERTIP,
                  not the bounding-box centre, so the hand pushes into the dot. */}
              <g className="splat-hand-move">
                <g className="splat-hand-tilt">
                  <g className="splat-hand-press">
                    <g
                      transform="translate(27.6 27.4) scale(2.3)"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M22 14a8 8 0 0 1-8 8" />
                      <path d="M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
                      <path d="M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1" />
                      <path d="M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10" />
                      <path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
                    </g>
                  </g>
                </g>
              </g>
            </svg>
          </div>
        </div>
      )}
      {/* Expanded: tap canvas to collapse (drag still orbits) */}
      <style>{`
        .splat-section {
          --mask-collapsed: 55vmin;
          position: relative;
          z-index: var(--z-index-raised);
          margin-top: -10vh;
          contain: layout style;
          pointer-events: none;
        }
        @media (max-width: 768px) {
          .splat-section {
            --mask-collapsed: calc(100vw - 32px);
            /* Pull the scene up so it peeks above the fold on load and centres
               after ~35vh of scroll, instead of only at the page bottom. */
            margin-top: -50vh;
          }
        }
        .splat-section[data-expanded] {
          z-index: var(--z-index-max);
        }
        .splat-canvas-wrap {
          width: 100%;
          height: 100lvh;
          min-height: 500px;
          position: relative;
          opacity: 0;
          transition: opacity var(--duration-1200) var(--ease-entrance);
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
        @media (max-width: 768px) {
          .splat-canvas-wrap {
            /* Shorter wrap = less scroll between hero and scene */
            height: 85svh;
            min-height: 420px;
          }
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
          z-index: var(--z-index-raised);
        }

        /* Outer wrapper: positioned center, handles opacity for entry + exit */
        .splat-tap-wrap {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 92px;
          height: 92px;
          color: #fff;
          transform-origin: center;
          /* Entry: fade + scale in */
          opacity: 0;
          animation: splatWrapEnter var(--duration-250) var(--ease-entrance) var(--duration-800) forwards;
        }
        @media (max-width: 768px) {
          .splat-tap-wrap {
            width: 116px;
            height: 116px;
          }
        }

        /* Inner SVG: holds the looping tap showcase */
        .splat-tap-anim {
          width: 100%;
          height: 100%;
          /* Legibility over whatever the scene renders behind it */
          filter: drop-shadow(0 2px 7px rgba(0,0,0,0.4));
        }

        .splat-ripple,
        .splat-tap-dot,
        .splat-hand-move,
        .splat-hand-tilt,
        .splat-hand-press {
          transform-box: fill-box;
          transform-origin: center;
        }

        /* fill-box excludes stroke, so the hand's box is x 31.81–78.2,
           y 32.0–78.0 and the fingertip (46, 32) sits at its top edge:
           30.6% across, 0% down. Scaling from there pushes the finger into
           the dot instead of shrinking the whole hand toward its middle. */
        .splat-hand-press {
          transform-origin: 30.6% 0%;
        }

        /* One rule, two rings, staggered by --ripple-d */
        .splat-ripple {
          opacity: 0;
          animation: splatRipple 3.2s var(--ease-out-quart)
            calc(1.05s + var(--ripple-d, 0s)) infinite;
        }
        .splat-tap-dot {
          fill-opacity: 0.72;
          animation: splatDotPress 3.2s cubic-bezier(0, 0.56, 0.15, 1.01) 1.05s infinite;
        }
        .splat-hand-move {
          animation: splatHandMove 3.2s ease-in-out 1.05s infinite;
        }
        .splat-hand-tilt {
          animation: splatHandTilt 3.2s ease-in-out 1.05s infinite;
        }
        .splat-hand-press {
          animation: splatHandPress 3.2s ease-in-out 1.05s infinite;
        }

        /* Hover: hold the gesture still */
        .splat-click-target:hover .splat-ripple,
        .splat-click-target:hover .splat-tap-dot,
        .splat-click-target:hover .splat-hand-move,
        .splat-click-target:hover .splat-hand-tilt,
        .splat-click-target:hover .splat-hand-press {
          animation-play-state: paused;
        }

        /* Scene expanding: fade out the wrapper */
        .splat-click-target[data-hiding] {
          pointer-events: none;
        }
        .splat-click-target[data-hiding] .splat-tap-wrap {
          animation: splatWrapExit var(--duration-200) ease-out forwards;
        }
        .splat-click-target[data-hiding] .splat-ripple,
        .splat-click-target[data-hiding] .splat-tap-dot,
        .splat-click-target[data-hiding] .splat-hand-move,
        .splat-click-target[data-hiding] .splat-hand-tilt,
        .splat-click-target[data-hiding] .splat-hand-press {
          animation-play-state: paused;
        }

        /* Wrapper entry. The nudge lands the SVG's tap point (46,32 of 110)
           on the square's true centre, not the wrap's bounding box centre. */
        @keyframes splatWrapEnter {
          0%   { opacity: 0; transform: translate(-41.8%, -29.1%) scale(0.3); }
          60%  { opacity: 1; transform: translate(-41.8%, -29.1%) scale(1.06); }
          100% { opacity: 1; transform: translate(-41.8%, -29.1%) scale(1); }
        }

        /* Wrapper exit */
        @keyframes splatWrapExit {
          0%   { opacity: 1; transform: translate(-41.8%, -29.1%) scale(1); }
          100% { opacity: 0; transform: translate(-41.8%, -29.1%) scale(0.3); }
        }

        /* Hand: rest → travel most of the way in → small wind-back
           (the anticipation lands mid-move, not from a dead stop) →
           strike → drift out and settle. */
        @keyframes splatHandMove {
          0%, 10%   { transform: translate(11px, 13px); }
          22%       { transform: translate(3.5px, 4.2px); }   /* approach */
          29%       { transform: translate(6.5px, 7.8px); }   /* wind back */
          36%       { transform: translate(0, 0); }           /* strike */
          44%       { transform: translate(2px, 2.4px); }
          54%       { transform: translate(12.5px, 14.8px); }
          62%       { transform: translate(10.4px, 12.3px); }
          70%, 100% { transform: translate(11px, 13px); }
        }

        /* Tilt runs on its own clock — straightens on the approach, cocks
           back with the anticipation, settles late so the tracks never land
           on the same frame. */
        @keyframes splatHandTilt {
          0%, 10%   { transform: rotate(5deg); }
          22%       { transform: rotate(2deg); }
          29%       { transform: rotate(7.5deg); }
          36%       { transform: rotate(-2deg); }
          46%       { transform: rotate(0.5deg); }
          56%       { transform: rotate(6.5deg); }
          66%       { transform: rotate(4.3deg); }
          74%, 100% { transform: rotate(5deg); }
        }

        /* Press: scales from the fingertip. Lifts a touch on the wind-back,
           then pushes down into the dot on contact. */
        @keyframes splatHandPress {
          0%, 20%   { transform: scale(1); }
          29%       { transform: scale(1.04); }
          36%       { transform: scale(0.9); }
          45%       { transform: scale(1.02); }
          53%       { transform: scale(0.99); }
          61%, 100% { transform: scale(1); }
        }

        /* Dot swells slightly as the finger comes in, compresses on contact,
           then rings down: 1.06 → 0.62 → 1.12 → 0.96 → 1.02 → 1 */
        @keyframes splatDotPress {
          0%, 26%   { transform: scale(1); }
          32%       { transform: scale(1.06); }
          36%       { transform: scale(0.62); }
          43%       { transform: scale(1.12); }
          50%       { transform: scale(0.96); }
          57%       { transform: scale(1.02); }
          64%, 100% { transform: scale(1); }
        }

        /* Ripples fire on contact and stay tight around the dot — a faint
           halo, not a broadcast. Opacity and transform run as two tracks. */
        @keyframes splatRipple {
          0%, 34%   { transform: scale(0.66); opacity: 0; }
          39%       { transform: scale(0.82); opacity: 0.34; }
          58%       {                          opacity: 0.16; }
          76%       { transform: scale(1.38); opacity: 0; }
          100%      { transform: scale(1.38); opacity: 0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .splat-tap-wrap {
            animation: splatWrapEnter var(--duration-250) ease var(--duration-500) forwards;
          }
          .splat-ripple,
          .splat-tap-dot,
          .splat-hand-move,
          .splat-hand-tilt,
          .splat-hand-press {
            animation: none;
          }
          .splat-ripple {
            opacity: 0.3;
          }
          .splat-hand-move {
            transform: translate(11px, 13px);
          }
          .splat-hand-tilt {
            transform: rotate(5deg);
          }
        }
      `}</style>
    </section>
    </>
  );
}
