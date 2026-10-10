"use client";

import { useCallback, useEffect, useRef } from "react";

import { ICONS } from "./oneLineIcons";
import { ICON_PX, createLineTrain } from "./LineTrain";
import { resolveThread } from "./oneLineThread";

const AXIS_LOCK_PX = 8;
const CLICK_SUPPRESS_MS = 320;
const INTRO_FALLBACK_MS = 520;
const INTRO_SETTLE_LEAD_MS = 240;
const DEMO_STEP_MS = 2600;
const DEMO_RESUME_MS = 5000;

function riseOf(bar) {
  const stage = bar.closest(".ol-stage");
  if (!stage || typeof stage.getAnimations !== "function") return undefined;
  return stage.getAnimations().find((animation) => animation.animationName === "ol-rise") ?? null;
}

function introDelay(rise) {
  if (rise === undefined) return INTRO_FALLBACK_MS;
  if (!rise || rise.playState !== "running") return 0;
  const endTime = Number(rise.effect?.getComputedTiming?.().endTime) || 0;
  const elapsed = Number(rise.currentTime) || 0;
  return Math.max(0, endTime - INTRO_SETTLE_LEAD_MS - elapsed);
}

function layoutLeft(bar, rect) {
  const stage = bar.closest(".ol-stage");
  if (!stage) return rect.left;
  const transform = getComputedStyle(stage).transform;
  if (!transform || transform === "none") return rect.left;
  const matrix = new DOMMatrixReadOnly(transform);
  if (Math.abs(matrix.a) < 1e-6) return rect.left;
  const box = stage.getBoundingClientRect();
  const center = box.left + box.width / 2;
  return center - matrix.e + (rect.left - center) / matrix.a;
}

export default function OneLineBar({ active, onSelect, demo = false }) {
  const barRef = useRef(null);
  const canvasRef = useRef(null);
  const labelRefs = useRef([]);
  const buttonRefs = useRef([]);
  const engineRef = useRef(null);
  const selectRef = useRef(onSelect);
  const activeRef = useRef(active);
  const suppressUntilRef = useRef(0);
  const demoHoldUntilRef = useRef(0);

  useEffect(() => {
    selectRef.current = onSelect;
    activeRef.current = active;
  }, [onSelect, active]);

  const choose = useCallback((index) => {
    engineRef.current?.go(index);
    selectRef.current(index);
  }, []);

  const handleClick = useCallback(
    (index) => {
      if (performance.now() < suppressUntilRef.current) return;
      choose(index);
    },
    [choose],
  );

  const handleKeyDown = useCallback(
    (event) => {
      const count = ICONS.length;
      const current = activeRef.current;
      let next = -1;
      if (event.key === "ArrowRight") next = (current + 1) % count;
      else if (event.key === "ArrowLeft") next = (current - 1 + count) % count;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = count - 1;
      if (next < 0) return;
      event.preventDefault();
      demoHoldUntilRef.current = performance.now() + DEMO_RESUME_MS;
      if (next !== current) choose(next);
      buttonRefs.current[next]?.focus();
    },
    [choose],
  );

  useEffect(() => {
    const bar = barRef.current;
    const canvas = canvasRef.current;
    if (!bar || !canvas) return undefined;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const engine = createLineTrain({
      canvas,
      labels: labelRefs.current,
      initial: activeRef.current,
      reduced: motionQuery.matches,
      thread: resolveThread(canvas),
    });
    engineRef.current = engine;

    const metrics = { left: 0, scale: 1, layoutLeft: 0 };
    const measure = () => {
      const rect = bar.getBoundingClientRect();
      metrics.left = rect.left;
      metrics.scale = rect.width > 0 ? bar.offsetWidth / rect.width : 1;
      metrics.layoutLeft = layoutLeft(bar, rect);
    };
    measure();

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      const box = entry.borderBoxSize?.[0];
      measure();
      engine.resize(box ? box.inlineSize : bar.offsetWidth, metrics.layoutLeft);
      bar.setAttribute("data-threaded", "");
    });
    resizeObserver.observe(bar);

    const realign = () => {
      measure();
      engine.align(metrics.layoutLeft);
    };
    window.addEventListener("resize", realign);
    let alive = true;
    const rise = riseOf(bar);
    rise?.finished.then(
      () => {
        if (alive) realign();
      },
      () => {},
    );

    let densityQuery = null;
    const onDensity = () => {
      measure();
      engine.resize(bar.offsetWidth, metrics.layoutLeft);
      armDensity();
    };
    const armDensity = () => {
      densityQuery?.removeEventListener("change", onDensity);
      densityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      densityQuery.addEventListener("change", onDensity);
    };
    armDensity();

    let onScreen = true;
    let hidden = document.hidden;
    const syncPause = () => engine.setPaused(!onScreen || hidden);
    const intersectionObserver = new IntersectionObserver((entries) => {
      onScreen = entries[entries.length - 1].isIntersecting;
      syncPause();
    });
    intersectionObserver.observe(bar);
    const onVisibility = () => {
      hidden = document.hidden;
      syncPause();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const onMotion = () => engine.setReduced(motionQuery.matches);
    motionQuery.addEventListener("change", onMotion);

    const introTimer = window.setTimeout(() => engine.startIntro(), introDelay(rise));

    const holdDemo = () => {
      demoHoldUntilRef.current = performance.now() + DEMO_RESUME_MS;
    };
    const stepDemo = () => {
      if (!onScreen || hidden || motionQuery.matches || gesture.id !== -1) return;
      if (performance.now() < demoHoldUntilRef.current) return;
      const next = (engine.goal + 1) % ICONS.length;
      engine.go(next);
      selectRef.current(next);
    };
    const demoTimer = demo ? window.setInterval(stepDemo, DEMO_STEP_MS) : 0;

    const gesture = {
      id: -1,
      startX: 0,
      startY: 0,
      locked: 0,
    };

    const capture = (pointerId) => {
      try {
        bar.setPointerCapture(pointerId);
        return true;
      } catch {
        return false;
      }
    };

    const localX = (event) => (event.clientX - metrics.left) * metrics.scale;

    const endGesture = (event) => {
      if (event.pointerId !== gesture.id) return;
      if (gesture.locked === 1) {
        const index = engine.dragEnd();
        engine.go(index, { release: true });
        selectRef.current(index);
        suppressUntilRef.current = performance.now() + CLICK_SUPPRESS_MS;
        bar.removeAttribute("data-dragging");
        if (bar.hasPointerCapture?.(event.pointerId)) bar.releasePointerCapture(event.pointerId);
      }
      gesture.id = -1;
      gesture.locked = 0;
    };

    const onPointerDown = (event) => {
      holdDemo();
      if (!event.isPrimary || event.button > 0) return;
      measure();
      gesture.id = event.pointerId;
      gesture.startX = event.clientX;
      gesture.startY = event.clientY;
      gesture.locked = 0;
    };

    const onPointerMove = (event) => {
      if (event.pointerType === "mouse") holdDemo();
      if (event.pointerType === "mouse" && gesture.locked !== 1) engine.hover(localX(event));
      if (event.pointerId !== gesture.id || gesture.locked === -1) return;
      if (gesture.locked === 0) {
        const dx = event.clientX - gesture.startX;
        const dy = event.clientY - gesture.startY;
        if (dx * dx + dy * dy < AXIS_LOCK_PX * AXIS_LOCK_PX) return;
        if (Math.abs(dx) <= Math.abs(dy) || !engine.dragBegin(localX(event))) {
          gesture.locked = -1;
          return;
        }
        gesture.locked = 1;
        bar.setAttribute("data-dragging", "");
        capture(event.pointerId);
        engine.hover(null);
        return;
      }
      engine.dragMove(localX(event));
    };

    const onPointerEnter = (event) => {
      if (event.pointerType === "mouse") measure();
    };

    const onPointerLeave = (event) => {
      if (event.pointerType === "mouse" && gesture.locked !== 1) engine.hover(null);
    };

    bar.addEventListener("pointerenter", onPointerEnter);
    bar.addEventListener("pointerdown", onPointerDown);
    bar.addEventListener("pointermove", onPointerMove);
    bar.addEventListener("pointerup", endGesture);
    bar.addEventListener("pointercancel", endGesture);
    bar.addEventListener("pointerleave", onPointerLeave);

    return () => {
      alive = false;
      window.clearTimeout(introTimer);
      window.clearInterval(demoTimer);
      window.removeEventListener("resize", realign);
      resizeObserver.disconnect();
      densityQuery?.removeEventListener("change", onDensity);
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motionQuery.removeEventListener("change", onMotion);
      bar.removeEventListener("pointerenter", onPointerEnter);
      bar.removeEventListener("pointerdown", onPointerDown);
      bar.removeEventListener("pointermove", onPointerMove);
      bar.removeEventListener("pointerup", endGesture);
      bar.removeEventListener("pointercancel", endGesture);
      bar.removeEventListener("pointerleave", onPointerLeave);
      engine.destroy();
      engineRef.current = null;
      bar.removeAttribute("data-threaded");
    };
  }, [demo]);

  return (
    <div ref={barRef} className="ol-bar" role="tablist" aria-label="Music sections" onKeyDown={handleKeyDown}>
      {ICONS.map((icon, index) => {
        const selected = index === active;
        return (
          <button
            key={icon.key}
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`ol-tab-${icon.key}`}
            aria-selected={selected}
            aria-controls="ol-panel"
            tabIndex={selected ? 0 : -1}
            className="ol-tab"
            data-active={selected ? "" : undefined}
            onClick={() => handleClick(index)}
          >
            <svg
              className="ol-tab__icon"
              viewBox="0 0 24 24"
              width={ICON_PX}
              height={ICON_PX}
              aria-hidden="true"
            >
              <path d={icon.path} />
            </svg>
            <span
              ref={(node) => {
                labelRefs.current[index] = node;
              }}
              className="ol-tab__label text-ui-sm"
            >
              {icon.label}
            </span>
          </button>
        );
      })}
      <canvas ref={canvasRef} className="ol-bar__ink" aria-hidden="true" />
    </div>
  );
}
