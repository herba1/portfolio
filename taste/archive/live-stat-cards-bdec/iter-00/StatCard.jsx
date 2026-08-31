"use client";

import { useEffect, useRef, useState } from "react";

import RollingNumber from "./RollingNumber";
import Sparkline from "./Sparkline";
import { RECENT, deltaFor, formatCompact, formatValue, stampFor } from "./statFeed";

const Chevron = () => (
  <svg viewBox="0 0 12 12" className="lsc-chip__arrow" aria-hidden="true">
    <path d="M6 9.5V2.5M6 2.5L2.75 5.75M6 2.5L9.25 5.75" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function StatCard({ metric, points, frame, catchUp, index, state, pinned, onToggle, onUnpin, onNavigate, cardRef }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const chipRef = useRef(null);
  const armed = useRef(false);
  const trackRef = useRef(null);

  const inert = state === "empty" || state === "loading";
  const value = points.length ? points[points.length - 1] : null;
  const delta = deltaFor(metric, points);
  const tone = delta ? delta.direction : "flat";

  useEffect(() => {
    const timer = setTimeout(() => {
      armed.current = true;
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const node = chipRef.current;
    if (!node || !armed.current || frame === 0) return undefined;
    node.dataset.blinking = "false";
    const raf = requestAnimationFrame(() => {
      node.dataset.blinking = "true";
    });
    return () => {
      cancelAnimationFrame(raf);
      node.dataset.blinking = "false";
    };
  }, [frame]);

  const handlePointer = (event) => {
    const track = trackRef.current;
    if (!track || !points.length) return;
    const rect = track.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const nearest = Math.round(ratio * (RECENT - 1));
    setActiveIndex(Math.min(RECENT - 1, Math.max(0, nearest)));
  };

  const scrub = (direction) => {
    setActiveIndex((current) => {
      if (current === null) return direction > 0 ? 0 : RECENT - 1;
      return Math.min(RECENT - 1, Math.max(0, current + direction));
    });
  };

  const handleKeyDown = (event) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      onNavigate(1);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onNavigate(-1);
      return;
    }
    if (inert) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      scrub(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      scrub(-1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(RECENT - 1);
      return;
    }
    if (event.key === "Escape") {
      if (activeIndex !== null) setActiveIndex(null);
      else onUnpin();
    }
  };

  const recent = points.length ? points.slice(points.length - RECENT) : [];
  const firstRecent = frame + points.length - RECENT;
  const floor = recent.length ? Math.min(...recent) : 0;
  const ceiling = recent.length ? Math.max(...recent) : 1;
  const fillFor = (point) => 24 + ((point - floor) / (ceiling - floor || 1)) * 76;

  const spoken =
    state === "loading"
      ? `${metric.label}, loading`
      : state === "empty"
        ? `${metric.label}, no readings since doors`
        : `${metric.label}, ${formatValue(metric, value)}${delta ? `, ${delta.text}` : ""}${state === "stale" ? ", feed reconnecting" : ""}`;

  return (
    <button
      type="button"
      ref={cardRef}
      className="lsc-card"
      style={{ "--card": index }}
      data-state={state}
      data-tone={tone}
      data-open={pinned ? "true" : "false"}
      data-pinned={pinned ? "true" : "false"}
      aria-disabled={inert || undefined}
      aria-pressed={inert ? undefined : pinned}
      aria-label={spoken}
      onClick={inert ? undefined : onToggle}
      onKeyDown={handleKeyDown}
      onBlur={() => setActiveIndex(null)}
    >
      <span className="lsc-card__head">
        <span className="text-ui-lg lsc-card__label">{metric.label}</span>
        <span className="lsc-card__flag" data-state={state}>
          <span className="lsc-card__ping" />
        </span>
      </span>

      <span className="lsc-card__value">
        {state === "loading" ? (
          <span className="lsc-skeleton lsc-skeleton--value" />
        ) : value === null ? (
          <span className="text-heading lsc-card__idle">No data yet</span>
        ) : (
          <RollingNumber text={formatValue(metric, value)} className="text-title-lg" />
        )}
      </span>

      <span className="lsc-card__meta">
        {state === "loading" ? (
          <span className="lsc-skeleton lsc-skeleton--chip" />
        ) : (
          <span ref={chipRef} className="text-ui lsc-chip" data-tone={tone}>
            {delta ? <Chevron /> : null}
            {delta ? delta.text : "—"}
          </span>
        )}
        <span className="text-ui lsc-card__window">
          {state === "stale" ? "Reconnecting" : state === "empty" ? "None since doors" : "last 35 min"}
        </span>
      </span>

      <span
        className="lsc-card__track"
        ref={trackRef}
        onPointerMove={inert ? undefined : handlePointer}
        onPointerLeave={() => setActiveIndex(null)}
        onPointerCancel={() => setActiveIndex(null)}
      >
        {state === "loading" ? (
          <span className="lsc-skeleton lsc-skeleton--spark" />
        ) : (
          <Sparkline points={points} frame={frame} catchUp={catchUp} metricId={metric.id} tone={tone} activeIndex={activeIndex} />
        )}
      </span>

      <span className="lsc-reveal">
        <span className="lsc-reveal__clip">
          <span className="lsc-reveal__list">
            {recent.map((point, position) => (
              <span
                key={`p-${position}`}
                className="lsc-point"
                style={{ "--p": position, "--fill": `${fillFor(point)}%` }}
                data-active={activeIndex === position ? "true" : "false"}
              >
                <span className="text-ui-xs lsc-point__stamp">{stampFor(firstRecent + position)}</span>
                <span className="lsc-point__bar">
                  <span className="lsc-point__fill" />
                </span>
                <span className="text-ui lsc-point__value">{formatCompact(metric, point)}</span>
              </span>
            ))}
          </span>
        </span>
      </span>
    </button>
  );
}
