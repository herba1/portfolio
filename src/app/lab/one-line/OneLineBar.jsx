"use client";

import { useCallback, useEffect, useRef } from "react";

import { ICONS } from "./oneLineIcons";
import { ICON_PX, createLineTrain } from "./LineTrain";

const AXIS_LOCK_PX = 8;
const VELOCITY_WINDOW_MS = 90;
const SAMPLE_CAPACITY = 24;
const CLICK_SUPPRESS_MS = 320;
const INTRO_DELAY_MS = 360;

export default function OneLineBar({ active, onSelect }) {
  const barRef = useRef(null);
  const canvasRef = useRef(null);
  const iconRefs = useRef([]);
  const labelRefs = useRef([]);
  const buttonRefs = useRef([]);
  const engineRef = useRef(null);
  const selectRef = useRef(onSelect);
  const activeRef = useRef(active);
  const suppressUntilRef = useRef(0);

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
      icons: iconRefs.current,
      labels: labelRefs.current,
      initial: activeRef.current,
      reduced: motionQuery.matches,
    });
    engineRef.current = engine;
    bar.setAttribute("data-live", "");

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      const box = entry.borderBoxSize?.[0];
      engine.resize(box ? box.inlineSize : bar.offsetWidth);
    });
    resizeObserver.observe(bar);

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

    const introTimer = window.setTimeout(() => engine.startIntro(), INTRO_DELAY_MS);

    const gesture = {
      id: -1,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastTime: 0,
      locked: 0,
      sampleX: new Float64Array(SAMPLE_CAPACITY),
      sampleTime: new Float64Array(SAMPLE_CAPACITY),
      sampleCount: 0,
      sampleHead: 0,
    };

    const capture = (pointerId) => {
      try {
        bar.setPointerCapture(pointerId);
        return true;
      } catch {
        return false;
      }
    };

    const layoutScale = () => {
      const rect = bar.getBoundingClientRect();
      return rect.width > 0 ? bar.offsetWidth / rect.width : 1;
    };

    const localX = (event) => {
      const rect = bar.getBoundingClientRect();
      const scale = rect.width > 0 ? bar.offsetWidth / rect.width : 1;
      return (event.clientX - rect.left) * scale;
    };

    const addSample = (x, time) => {
      gesture.sampleX[gesture.sampleHead] = x;
      gesture.sampleTime[gesture.sampleHead] = time;
      gesture.sampleHead = (gesture.sampleHead + 1) % SAMPLE_CAPACITY;
      gesture.sampleCount = Math.min(SAMPLE_CAPACITY, gesture.sampleCount + 1);
    };

    const releaseVelocity = (now) => {
      let newestX = 0;
      let newestTime = -1;
      let oldestX = 0;
      let oldestTime = -1;
      for (let index = 0; index < gesture.sampleCount; index += 1) {
        const slot = (gesture.sampleHead - 1 - index + SAMPLE_CAPACITY) % SAMPLE_CAPACITY;
        const time = gesture.sampleTime[slot];
        if (now - time > VELOCITY_WINDOW_MS) break;
        if (newestTime < 0) {
          newestTime = time;
          newestX = gesture.sampleX[slot];
        }
        oldestTime = time;
        oldestX = gesture.sampleX[slot];
      }
      if (newestTime < 0 || newestTime - oldestTime < 8) return 0;
      return ((newestX - oldestX) / (newestTime - oldestTime)) * 1000;
    };

    const endGesture = (event) => {
      if (event.pointerId !== gesture.id) return;
      if (gesture.locked === 1) {
        const velocity = releaseVelocity(event.timeStamp) * layoutScale();
        const index = engine.dragEnd(velocity);
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
      if (!event.isPrimary || event.button > 0) return;
      gesture.id = event.pointerId;
      gesture.startX = event.clientX;
      gesture.startY = event.clientY;
      gesture.lastX = event.clientX;
      gesture.lastTime = event.timeStamp;
      gesture.locked = 0;
      gesture.sampleCount = 0;
      gesture.sampleHead = 0;
      addSample(event.clientX, event.timeStamp);
    };

    const onPointerMove = (event) => {
      if (event.pointerType === "mouse" && gesture.locked !== 1) engine.hover(localX(event));
      if (event.pointerId !== gesture.id || gesture.locked === -1) return;
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      const scale = layoutScale();
      if (gesture.locked === 0) {
        if (dx * dx + dy * dy < AXIS_LOCK_PX * AXIS_LOCK_PX) return;
        if (Math.abs(dx) <= Math.abs(dy) || !engine.dragBegin()) {
          gesture.locked = -1;
          return;
        }
        gesture.locked = 1;
        bar.setAttribute("data-dragging", "");
        capture(event.pointerId);
        engine.hover(null);
        engine.dragMove(dx * scale, Math.max(1, event.timeStamp - gesture.lastTime) / 1000);
      } else {
        engine.dragMove((event.clientX - gesture.lastX) * scale, Math.max(1, event.timeStamp - gesture.lastTime) / 1000);
      }
      gesture.lastX = event.clientX;
      gesture.lastTime = event.timeStamp;
      addSample(event.clientX, event.timeStamp);
    };

    const onPointerLeave = (event) => {
      if (event.pointerType === "mouse" && gesture.locked !== 1) engine.hover(null);
    };

    bar.addEventListener("pointerdown", onPointerDown);
    bar.addEventListener("pointermove", onPointerMove);
    bar.addEventListener("pointerup", endGesture);
    bar.addEventListener("pointercancel", endGesture);
    bar.addEventListener("pointerleave", onPointerLeave);

    return () => {
      window.clearTimeout(introTimer);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motionQuery.removeEventListener("change", onMotion);
      bar.removeEventListener("pointerdown", onPointerDown);
      bar.removeEventListener("pointermove", onPointerMove);
      bar.removeEventListener("pointerup", endGesture);
      bar.removeEventListener("pointercancel", endGesture);
      bar.removeEventListener("pointerleave", onPointerLeave);
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

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
              ref={(node) => {
                iconRefs.current[index] = node;
              }}
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
