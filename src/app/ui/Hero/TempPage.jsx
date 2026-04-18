"use client";

import { spencer, geist } from "@/app/fonts";
import { useRef, useCallback, useEffect } from "react";
import posthog from "posthog-js";
import dynamic from "next/dynamic";

const HeroEyes = dynamic(() => import("./Eyes"), { ssr: false });

function seeded(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function shuffledOrder(count) {
  const indices = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(seeded(i + 999) * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const order = new Array(count);
  for (let i = 0; i < count; i++) order[indices[i]] = i;
  return order;
}

const NAME = "Herbart Hernandez";
const CHARS = [...NAME];
const NON_SPACE = CHARS.filter((c) => c !== " ").length;
const ORDER = shuffledOrder(NON_SPACE);
const MAX_PULL = 120;
const HOLD_THRESHOLD = 0.85; // fraction of MAX_PULL to count as "maxed"
const HOLD_TIME = 800; // ms you must hold at max before explosion arms

export default function TempPage() {
  const containerRef = useRef(null);
  const charsRef = useRef([]);
  const originsRef = useRef([]);
  const dragging = useRef(false);
  const grabIndex = useRef(-1);
  const pointer = useRef({ x: 0, y: 0 });
  const startPointer = useRef({ x: 0, y: 0 });
  const rafRef = useRef(null);
  const positions = useRef([]);
  const velocities = useRef([]);
  const hasInteracted = useRef(false);
  const idleTimer = useRef(null);
  const maxHeldSince = useRef(0); // timestamp when pull first hit threshold
  const explosionArmed = useRef(false);
  const exploded = useRef(false);
  const reassembling = useRef(false); // gentle fade-back phase
  const reassembleStart = useRef(0); // timestamp when reassembly began
  const reassembleTimer = useRef(null);

  const measure = useCallback(() => {
    const chars = charsRef.current.filter(Boolean);
    originsRef.current = chars.map((el) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    if (!positions.current.length) {
      positions.current = chars.map(() => ({ x: 0, y: 0 }));
      velocities.current = chars.map(() => ({ x: 0, y: 0 }));
    }
  }, []);

  const animLoop = useCallback(() => {
    const chars = charsRef.current;
    const pos = positions.current;
    const vels = velocities.current;
    const count = pos.length;
    if (!count) return;

    let anyMoving = false;
    const targets = pos.map(() => ({ x: 0, y: 0 }));

    if (dragging.current && grabIndex.current >= 0) {
      const dx = pointer.current.x - startPointer.current.x;
      const dy = pointer.current.y - startPointer.current.y;
      const pullDist = Math.sqrt(dx * dx + dy * dy);
      const clampedPull = Math.min(pullDist, MAX_PULL);
      const pullDir = pullDist > 0 ? { x: dx / pullDist, y: dy / pullDist } : { x: 0, y: 0 };

      // track how long user has been holding at max pull
      const atMax = pullDist >= MAX_PULL * HOLD_THRESHOLD;
      if (atMax) {
        if (!maxHeldSince.current) maxHeldSince.current = performance.now();
        if (performance.now() - maxHeldSince.current >= HOLD_TIME) {
          explosionArmed.current = true;
        }
      } else {
        maxHeldSince.current = 0;
        explosionArmed.current = false;
      }

      for (let i = 0; i < count; i++) {
        const stringDist = Math.abs(i - grabIndex.current);
        const influence = Math.exp(-stringDist * 0.35);
        targets[i].x = pullDir.x * clampedPull * influence;
        targets[i].y = pullDir.y * clampedPull * influence;
      }
    }

    // reassembly: staggered fade-in over ~1s, no physics
    if (reassembling.current) {
      const elapsed = performance.now() - reassembleStart.current;
      const duration = 900;
      let allDone = true;

      for (let i = 0; i < count; i++) {
        const el = chars[i];
        if (!el) continue;
        // stagger: each char starts fading in at a slightly different time
        const stagger = (seeded(i * 5 + 2) * 0.4) * duration;
        const t = Math.min(Math.max((elapsed - stagger) / (duration * 0.6), 0), 1);
        // smooth ease-out
        const ease = 1 - Math.pow(1 - t, 3);

        pos[i].x = 0;
        pos[i].y = 0;
        vels[i].x = 0;
        vels[i].y = 0;
        el.style.transform = ease < 1 ? `scale(${(0.9 + ease * 0.1).toFixed(3)})` : "";
        el.style.opacity = ease.toFixed(2);

        if (t < 1) allDone = false;
      }

      if (allDone) {
        reassembling.current = false;
        for (let i = 0; i < count; i++) {
          const el = chars[i];
          if (el) { el.style.transform = ""; el.style.opacity = ""; }
        }
        rafRef.current = null;
      } else {
        rafRef.current = requestAnimationFrame(animLoop);
      }
      return;
    }

    for (let i = 0; i < count; i++) {
      const el = chars[i];
      if (!el) continue;

      if (exploded.current) {
        // free-flying: gravity pulls down, light air drag
        vels[i].y += 1.2;
        vels[i].x *= 0.98;
        vels[i].y *= 0.98;
      } else {
        // spring back toward target
        const fx = (targets[i].x - pos[i].x) * 0.12;
        const fy = (targets[i].y - pos[i].y) * 0.12;

        vels[i].x = (vels[i].x + fx) * 0.82;
        vels[i].y = (vels[i].y + fy) * 0.82;

        const nearOrigin = Math.abs(pos[i].x) < 2 && Math.abs(pos[i].y) < 2;
        if (nearOrigin && Math.abs(vels[i].x) < 0.1) vels[i].x = 0;
        if (nearOrigin && Math.abs(vels[i].y) < 0.1) vels[i].y = 0;
      }

      pos[i].x += vels[i].x;
      pos[i].y += vels[i].y;

      if (!dragging.current && !exploded.current && Math.abs(pos[i].x) < 0.2 && Math.abs(pos[i].y) < 0.2 &&
          vels[i].x === 0 && vels[i].y === 0) {
        pos[i].x = 0;
        pos[i].y = 0;
      }

      const pullAmount = Math.sqrt(pos[i].x * pos[i].x + pos[i].y * pos[i].y);
      const squeeze = Math.min(pullAmount / MAX_PULL, 1);
      const scaleY = 1 - squeeze * 0.15;
      const scaleX = 1 + squeeze * 0.05;
      const rotation = exploded.current ? vels[i].x * 2 : 0;

      if (pos[i].x === 0 && pos[i].y === 0) {
        el.style.transform = "";
        el.style.opacity = "";
      } else {
        el.style.transform = `translate(${pos[i].x.toFixed(1)}px, ${pos[i].y.toFixed(1)}px) scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)}) rotate(${rotation.toFixed(1)}deg)`;
        if (exploded.current) {
          const dist = Math.sqrt(pos[i].x * pos[i].x + pos[i].y * pos[i].y);
          el.style.opacity = Math.max(0, 1 - dist / 600).toFixed(2);
        }
      }

      if (pos[i].x !== 0 || pos[i].y !== 0) {
        anyMoving = true;
      }
    }

    if (anyMoving || dragging.current) {
      rafRef.current = requestAnimationFrame(animLoop);
    } else {
      rafRef.current = null;
    }
  }, []);

  const findClosestChar = useCallback((x, y) => {
    const origins = originsRef.current;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < origins.length; i++) {
      const d = Math.abs(origins[i].x - x) + Math.abs(origins[i].y - y);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }, []);

  // Defer interaction setup until after intro animation (~1s)
  // Uses requestIdleCallback where available, falls back to setTimeout
  useEffect(() => {
    const deferSetup = (cb) => {
      if ("requestIdleCallback" in window) {
        return window.requestIdleCallback(cb, { timeout: 2000 });
      }
      return setTimeout(cb, 1200);
    };

    const initId = deferSetup(() => {
      // Clear CSS animations so JS transforms can take over
      charsRef.current.forEach((el) => {
        if (el) el.style.animation = "none";
      });

      measure();

      // idle hint after interaction is ready
      idleTimer.current = setTimeout(() => {
        if (hasInteracted.current) return;
        const count = velocities.current.length;
        if (!count) return;

        // simulate grabbing the middle and yanking downward-right
        const fakeGrab = Math.floor(count * 0.45);
        grabIndex.current = fakeGrab;
        dragging.current = true;

        // fake a drag over ~600ms then release with explosion
        const steps = 30;
        let step = 0;
        const pullX = 35;
        const pullY = 25;

        const fakeDrag = () => {
          step++;
          const t = step / steps;
          // ease-out curve for the pull
          const ease = 1 - Math.pow(1 - t, 3);
          startPointer.current = { x: 0, y: 0 };
          pointer.current = { x: pullX * ease, y: pullY * ease };

          if (step < steps) {
            requestAnimationFrame(fakeDrag);
          } else {
            // release — explosion
            const vels = velocities.current;
            const baseAngle = Math.atan2(-pullY, -pullX);
            for (let i = 0; i < count; i++) {
              const sd = Math.abs(i - fakeGrab);
              const spread = (seeded(i * 7 + 13) - 0.5) * (0.6 + sd * 0.15) * Math.PI;
              const force = (0.6 + seeded(i * 3 + 7) * 0.4) * Math.exp(-sd * 0.25) * 15;
              vels[i].x += Math.cos(baseAngle + spread) * force;
              vels[i].y += Math.sin(baseAngle + spread) * force;
            }
            dragging.current = false;
            grabIndex.current = -1;
          }
        };

        if (!rafRef.current) rafRef.current = requestAnimationFrame(animLoop);
        requestAnimationFrame(fakeDrag);
      }, 3000);
    });

    window.addEventListener("resize", measure);
    return () => {
      if ("cancelIdleCallback" in window) {
        window.cancelIdleCallback(initId);
      } else {
        clearTimeout(initId);
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      clearTimeout(idleTimer.current);
      clearTimeout(reassembleTimer.current);
      window.removeEventListener("resize", measure);
    };
  }, [measure, animLoop]);

  // pointer move + up on window
  useEffect(() => {
    const onMove = (e) => {
      pointer.current = { x: e.clientX, y: e.clientY };
      if (dragging.current && !rafRef.current) {
        rafRef.current = requestAnimationFrame(animLoop);
      }
    };

    const onUp = () => {
      if (!dragging.current) return;

      const dx = pointer.current.x - startPointer.current.x;
      const dy = pointer.current.y - startPointer.current.y;
      const pullDist = Math.sqrt(dx * dx + dy * dy);
      const intensity = Math.min(pullDist / MAX_PULL, 1);

      if (explosionArmed.current) {
        // BOOM — full explosion, characters scatter everywhere
        exploded.current = true;
        const vels = velocities.current;
        const count = vels.length;
        for (let i = 0; i < count; i++) {
          const angle = (seeded(i * 11 + 3) * 2 - 1) * Math.PI;
          const force = 15 + seeded(i * 7 + 17) * 30;
          vels[i].x += Math.cos(angle) * force;
          vels[i].y += Math.sin(angle) * force - 10; // upward bias
        }

        // after scattering, transition to gentle fade-back
        clearTimeout(reassembleTimer.current);
        reassembleTimer.current = setTimeout(() => {
          exploded.current = false;
          reassembling.current = true;
          reassembleStart.current = performance.now();
          if (!rafRef.current) rafRef.current = requestAnimationFrame(animLoop);
        }, 1800);
      } else if (intensity > 0.4) {
        const vels = velocities.current;
        const count = vels.length;
        const baseAngle = Math.atan2(-dy, -dx);
        for (let i = 0; i < count; i++) {
          const stringDist = grabIndex.current >= 0 ? Math.abs(i - grabIndex.current) : 0;
          const spreadRange = 0.6 + stringDist * 0.15;
          const spread = (seeded(i * 7 + 13) - 0.5) * spreadRange * Math.PI;
          const angle = baseAngle + spread;
          const proxForce = Math.exp(-stringDist * 0.25);
          const force = (0.6 + seeded(i * 3 + 7) * 0.4) * intensity * proxForce * 20;
          vels[i].x += Math.cos(angle) * force;
          vels[i].y += Math.sin(angle) * force;
        }
      }

      dragging.current = false;
      grabIndex.current = -1;
      maxHeldSince.current = 0;
      explosionArmed.current = false;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [animLoop]);

  const onPointerDown = useCallback((e) => {
    if (!hasInteracted.current) {
      posthog.capture("hero_text_first_pull");
      // Clear CSS animations on first interaction so JS can control transforms
      charsRef.current.forEach((el) => {
        if (el) el.style.animation = "none";
      });
    }
    hasInteracted.current = true;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    // don't allow dragging while exploded or reassembling
    if (exploded.current || reassembling.current) return;
    measure();
    dragging.current = true;
    pointer.current = { x: e.clientX, y: e.clientY };
    startPointer.current = { x: e.clientX, y: e.clientY };
    grabIndex.current = findClosestChar(e.clientX, e.clientY);
    if (!rafRef.current) rafRef.current = requestAnimationFrame(animLoop);
  }, [animLoop, findClosestChar, measure]);

  let ci = 0;

  return (
    <article
      ref={containerRef}
      className="relative mx-auto flex h-svh min-h-fit w-full flex-col items-center justify-center pb-[12svh] text-slate-900 selection:bg-black selection:text-white"
    >
      <HeroEyes />
      <p
        className={`hero-sub tracking-body-base text-dark text-sm relative z-10 ${geist.className}`}
        style={{
          padding: "1.5rem 3rem",
          background: `radial-gradient(
            ellipse 100% 120% at center,
            rgb(241 245 249 / 0.95) 0%,
            rgb(241 245 249 / 0.9) 15%,
            rgb(241 245 249 / 0.75) 30%,
            rgb(241 245 249 / 0.5) 45%,
            rgb(241 245 249 / 0.25) 60%,
            rgb(241 245 249 / 0.1) 75%,
            rgb(241 245 249 / 0.03) 88%,
            transparent 100%
          )`,
        }}
      >
        design engineer @ <a href="https://crowdvolt.com" target="_blank" rel="noopener noreferrer">crowdvolt</a>
      </p>

      {/*
      <div
        className="touch-none relative z-20 mt-2"
        onPointerDown={onPointerDown}
      >
        <h1
          className={`text-dark cursor-grab text-6xl text-[15vw] leading-[1.3] tracking-normal will-change-transform select-none active:cursor-grabbing md:text-8xl ${spencer.className}`}
          style={{ paddingBottom: "0.15em" }}
        >
          {CHARS.map((ch, i) => {
            if (ch === " ") {
              return <span key={i} className="blog-ch-space" />;
            }
            const idx = ci++;
            const delay = (0.05 + ORDER[idx] * 0.035).toFixed(3);
            const rotate = (seeded(idx) * 14 - 7).toFixed(1);
            return (
              <span
                key={i}
                className="hero-ch"
                ref={(el) => { charsRef.current[idx] = el; }}
                style={{
                  "--ch-d": `${delay}s`,
                  "--ch-r": rotate,
                }}
              >
                {ch}
              </span>
            );
          })}
        </h1>
      </div>
      */}
    </article>
  );
}
