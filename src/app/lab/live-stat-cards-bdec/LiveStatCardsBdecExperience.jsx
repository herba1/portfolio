"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import StatCard from "./StatCard";
import Tape from "./Tape";
import {
  BUCKETS,
  CAPACITY,
  HEADLINE,
  LAST,
  METRICS,
  ORDERS,
  bucketAt,
  contributionFor,
  deltaFor,
  formatCount,
  positionAt,
  segmentsAt,
  stampAt,
  totalsAt,
} from "./statFeed";
import "./live-stat-cards.css";

const FINAL_FRACTION = HEADLINE.sold / CAPACITY;

export default function LiveStatCardsBdecExperience() {
  const [phase, setPhase] = useState("loading");
  const [scrub, setScrub] = useState(null);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setPhase("ready"), 720);
    return () => clearTimeout(timer);
  }, []);

  const engage = useCallback((index) => setScrub(index), []);

  const release = useCallback(() => {
    setScrub(null);
    setPinned(false);
  }, []);

  const pin = useCallback(
    (index) => {
      const releasing = pinned && scrub === index;
      setPinned(!releasing);
      setScrub(releasing ? null : index);
    },
    [pinned, scrub],
  );

  useEffect(() => {
    if (!pinned) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") release();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinned, release]);

  const held = scrub !== null;
  const readIndex = held ? scrub : LAST;
  const stamp = stampAt(readIndex);

  const rows = useMemo(() => {
    const list = [];
    for (let index = LAST; index >= 0; index -= 1) list.push({ index, order: ORDERS[index] });
    return list;
  }, []);

  const cards = useMemo(() => {
    const totals = totalsAt(readIndex);
    const segments = segmentsAt(readIndex);
    const touchedOrder = held ? ORDERS[readIndex] : null;
    return METRICS.map((metric) => {
      const value = metric.read(totals);
      const empty = Boolean(metric.canBeEmpty) && value === 0;
      return {
        metric,
        state: phase === "loading" ? "loading" : empty ? "empty" : "live",
        value,
        delta: deltaFor(metric, readIndex),
        held,
        cut: held ? positionAt(readIndex) : 1,
        bucket: held ? bucketAt(readIndex) : BUCKETS.length - 1,
        segments,
        finalFraction: FINAL_FRACTION,
        activeIndex: held ? readIndex : null,
        contribution: held ? contributionFor(metric, readIndex) : 0,
        hit: Boolean(touchedOrder) && metric.touched(touchedOrder),
      };
    });
  }, [phase, readIndex, held]);

  const announcement = useMemo(() => {
    if (phase === "loading") return "Loading the board.";
    if (held) return `Board held at ${stamp}, ${formatCount(totalsAt(readIndex).sold)} sold.`;
    return `On sale closed ${HEADLINE.closed}. ${formatCount(HEADLINE.sold)} of ${formatCount(CAPACITY)} sold.`;
  }, [phase, held, stamp, readIndex]);

  return (
    <main className="lsc-page bg-surface text-ink">
      <div className="lsc-shell">
        <header className="lsc-header">
          <div>
            <h1 className="text-title-sm lsc-title">Knockdown Center — Friday 12 September</h1>
            <p className="text-ui lsc-subtitle">
              <span>{`${formatCount(HEADLINE.sold)} of ${formatCount(CAPACITY)} sold`}</span>
              <span className="lsc-subtitle__rule" />
              <span>{`on sale ${HEADLINE.opened} to ${HEADLINE.closed}`}</span>
              <span className="lsc-subtitle__rule" />
              <span>{`doors ${HEADLINE.doors}`}</span>
            </p>
          </div>
          <button
            type="button"
            className="text-ui lsc-reset"
            data-held={held ? "true" : "false"}
            disabled={!held}
            onClick={release}
          >
            <span className="lsc-reset__dot" />
            <span className="lsc-reset__label">{held ? `Reading ${stamp}` : "Final"}</span>
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
          onEngage={engage}
          onRelease={release}
          onPin={pin}
        />

        <p className="lsc-sr" role="status" aria-live="polite">
          {announcement}
        </p>
      </div>
    </main>
  );
}
