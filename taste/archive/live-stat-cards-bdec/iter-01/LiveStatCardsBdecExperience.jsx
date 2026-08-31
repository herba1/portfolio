"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import StatCard from "./StatCard";
import Tape from "./Tape";
import {
  CAPACITY,
  EVENTS,
  HISTORY,
  LEAD,
  METRICS,
  STALE_FROM,
  TAPE_ROWS,
  TICK_MS,
  catchUpFor,
  contributionFor,
  deltaFor,
  isStale,
  seriesFor,
  stampAt,
  totalsAt,
} from "./statFeed";
import "./live-stat-cards.css";

export default function LiveStatCardsBdecExperience() {
  const [phase, setPhase] = useState("loading");
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const [scrub, setScrub] = useState(null);
  const [pinned, setPinned] = useState(false);
  const [hold, setHold] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setPhase("live"), 900);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (phase !== "live" || paused) return undefined;
    const id = setInterval(() => setTick((current) => current + 1), TICK_MS);
    return () => clearInterval(id);
  }, [phase, paused]);

  const cursor = LEAD + tick;
  const tapeEnd = hold === null ? cursor : hold;
  const queued = cursor - tapeEnd;
  const readIndex = scrub === null ? cursor : scrub;

  const engage = useCallback(
    (index) => {
      setScrub(index);
      setHold((current) => (current === null ? cursor : current));
    },
    [cursor],
  );

  const release = useCallback(() => {
    setScrub(null);
    setPinned(false);
    setHold(null);
  }, []);

  const pin = (index) => {
    const releasing = pinned && scrub === index;
    setPinned(!releasing);
    setScrub(releasing ? null : index);
    if (releasing) setHold(null);
  };

  const resume = useCallback(() => {
    setPinned(false);
    setScrub(null);
    setHold(null);
  }, []);

  const rows = useMemo(() => {
    const start = Math.max(0, tapeEnd - TAPE_ROWS - 1);
    const list = [];
    for (let index = tapeEnd; index > start; index -= 1) list.push({ index, event: EVENTS[index] });
    return list;
  }, [tapeEnd]);

  const touched = EVENTS[cursor];

  const cards = useMemo(
    () =>
      METRICS.map((metric) => {
        const stale = isStale(metric.id, tick);
        const index = stale ? LEAD + STALE_FROM : readIndex;
        const totals = totalsAt(index);
        const value = metric.read(totals);
        const empty = Boolean(metric.canBeEmpty) && value === 0;
        const state = phase === "loading" ? "loading" : empty ? "empty" : stale ? "stale" : "live";
        const marker = scrub === null || stale ? null : HISTORY - 1 - (tapeEnd - scrub);
        return {
          metric,
          state,
          value,
          points: seriesFor(metric, index),
          delta: deltaFor(metric, index),
          cursor: marker === null || marker < 0 ? null : marker,
          contribution: scrub === null ? 0 : contributionFor(metric, scrub),
          catchUp: catchUpFor(metric.id, tick),
          slideKey: index,
          hit: scrub === null && Boolean(touched) && metric.touched(touched),
        };
      }),
    [phase, tick, readIndex, scrub, tapeEnd, touched],
  );

  const stamp = scrub === null ? stampAt(cursor) : stampAt(scrub);
  const sold = totalsAt(readIndex).sold;

  const announcement = useMemo(() => {
    if (phase === "loading") return "Loading the board.";
    if (scrub !== null) return `Board held at ${stamp}. ${queued} orders waiting.`;
    return `Live at ${stamp}. ${sold} of ${CAPACITY} sold.`;
  }, [phase, scrub, stamp, queued, sold]);

  return (
    <main className="lsc-page bg-surface text-ink">
      <div className="lsc-shell">
        <header className="lsc-header">
          <div className="lsc-header__id">
            <h1 className="text-title-sm lsc-title">Knockdown Center — doors 21:00</h1>
            <p className="text-ui lsc-subtitle">
              <span className="lsc-subtitle__cell">{`${sold} of ${CAPACITY} sold`}</span>
              <span className="lsc-subtitle__rule" />
              <span className="lsc-subtitle__cell">{scrub === null ? `reading ${stamp}` : `held at ${stamp}`}</span>
            </p>
          </div>
          <button
            type="button"
            className="text-ui lsc-toggle"
            data-paused={paused ? "true" : "false"}
            data-held={scrub === null ? "false" : "true"}
            onClick={() => setPaused((current) => !current)}
          >
            <span className="lsc-toggle__dot" data-paused={paused || scrub !== null ? "true" : "false"} />
            <span className="lsc-toggle__label">{scrub !== null ? "Held" : paused ? "Paused" : "Live"}</span>
          </button>
        </header>

        <div className="lsc-grid">
          {cards.map((card, index) => (
            <StatCard key={card.metric.id} {...card} index={index} stamp={stamp} />
          ))}
        </div>

        <Tape
          rows={rows}
          loading={phase === "loading"}
          activeIndex={scrub}
          pinned={pinned}
          queued={queued}
          slideKey={tapeEnd}
          onEngage={engage}
          onRelease={release}
          onPin={pin}
          onResume={resume}
        />

        <p className="lsc-sr" role="status" aria-live="polite">
          {announcement}
        </p>
      </div>
    </main>
  );
}
