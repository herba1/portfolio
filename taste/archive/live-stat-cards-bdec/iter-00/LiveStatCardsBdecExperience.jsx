"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import StatCard from "./StatCard";
import { METRICS, STALE_FROM, TICK_MS, catchUpFor, isStale, seriesFor } from "./statFeed";
import "./live-stat-cards.css";

export default function LiveStatCardsBdecExperience() {
  const [phase, setPhase] = useState("loading");
  const [frame, setFrame] = useState(0);
  const [paused, setPaused] = useState(false);
  const [pinned, setPinned] = useState(null);
  const cardRefs = useRef([]);

  useEffect(() => {
    const timer = setTimeout(() => setPhase("live"), 900);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (phase !== "live" || paused) return undefined;
    const id = setInterval(() => setFrame((current) => current + 1), TICK_MS);
    return () => clearInterval(id);
  }, [phase, paused]);

  const cards = useMemo(
    () =>
      METRICS.map((metric) => {
        const stale = isStale(metric.id, frame);
        const points = seriesFor(metric, stale ? STALE_FROM : frame);
        return { metric, points, stale, catchUp: catchUpFor(metric.id, frame) };
      }),
    [frame],
  );

  const stateFor = (metric, stale) =>
    phase === "loading" ? "loading" : metric.empty ? "empty" : stale ? "stale" : "live";

  const staleLabel = cards.find((card) => card.stale)?.metric.label ?? null;
  const pinnedLabel = METRICS.find((metric) => metric.id === pinned)?.label ?? null;

  const announcement = useMemo(() => {
    if (phase === "loading") return "Loading the board.";
    if (staleLabel) return `${staleLabel} feed reconnecting.`;
    if (pinnedLabel) return `${pinnedLabel} pinned. Arrow up and down to read the last seven points.`;
    return "All four feeds live.";
  }, [phase, staleLabel, pinnedLabel]);

  const move = useCallback((from, direction) => {
    const total = METRICS.length;
    for (let step = 1; step <= total; step += 1) {
      const next = (from + direction * step + total * step) % total;
      const node = cardRefs.current[next];
      if (node) {
        node.focus();
        return;
      }
    }
  }, []);

  return (
    <main className="lsc-page bg-surface text-ink">
      <div className="lsc-shell">
        <header className="lsc-header">
          <h1 className="text-title-sm lsc-title">Knockdown Center — doors 21:00</h1>
          <button
            type="button"
            className="text-ui lsc-toggle"
            data-paused={paused ? "true" : "false"}
            onClick={() => setPaused((current) => !current)}
          >
            <span className="lsc-toggle__dot" data-paused={paused ? "true" : "false"} />
            <span className="lsc-toggle__label">{paused ? "Paused" : "Live"}</span>
          </button>
        </header>

        <div className="lsc-grid">
          {cards.map(({ metric, points, stale, catchUp }, index) => (
            <StatCard
              key={metric.id}
              metric={metric}
              points={points}
              frame={stale ? STALE_FROM : frame}
              catchUp={catchUp}
              index={index}
              state={stateFor(metric, stale)}
              pinned={pinned === metric.id}
              cardRef={(node) => {
                cardRefs.current[index] = node;
              }}
              onToggle={() => setPinned((current) => (current === metric.id ? null : metric.id))}
              onUnpin={() => setPinned(null)}
              onNavigate={(direction) => move(index, direction)}
            />
          ))}
        </div>

        <p className="lsc-sr" role="status" aria-live="polite">
          {announcement}
        </p>
      </div>
    </main>
  );
}
