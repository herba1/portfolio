"use client";

import { useEffect, useRef, useState } from "react";
import StatCard from "./StatCard";
import { HISTORY_LENGTH, STAT_DEFS, TICK_MS, nextValue, seedHistory } from "./statEngine";
import "./live-stat-cards.css";

function seedState() {
  const state = {};
  STAT_DEFS.forEach((def) => {
    const history = seedHistory(def);
    state[def.id] = { history, value: history[history.length - 1] };
  });
  return state;
}

export default function LiveStatCardsExperience() {
  const [stats, setStats] = useState(seedState);
  const [live, setLive] = useState(true);
  const liveRef = useRef(live);

  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!liveRef.current) return;
      setStats((prev) => {
        const next = {};
        STAT_DEFS.forEach((def) => {
          const entry = prev[def.id];
          const value = nextValue(def, entry.value);
          const history = entry.history.length >= HISTORY_LENGTH ? entry.history.slice(1) : entry.history.slice();
          history.push(value);
          next[def.id] = { history, value };
        });
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="lsc-page bg-surface text-ink">
      <div className="lsc-head">
        <h1 className="lsc-title text-title-sm sm:text-title">Live stat cards</h1>
        <button
          type="button"
          className="lsc-toggle text-ui-sm"
          onClick={() => setLive((value) => !value)}
          aria-pressed={live}
        >
          <span className={`lsc-toggle__dot ${live ? "lsc-toggle__dot--live" : ""}`} aria-hidden="true" />
          {live ? "Live" : "Paused"}
        </button>
      </div>

      <div className="lsc-grid">
        {STAT_DEFS.map((def) => (
          <StatCard key={def.id} def={def} value={stats[def.id].value} history={stats[def.id].history} />
        ))}
      </div>
    </main>
  );
}
