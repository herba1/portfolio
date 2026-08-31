"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import Sparkline from "./Sparkline";
import { formatValue, percentDelta } from "./statEngine";

const REVEAL_COUNT = 7;

export default function StatCard({ def, value, history }) {
  const [prevValue, setPrevValue] = useState(value);
  const [direction, setDirection] = useState("flat");
  const [pulseKey, setPulseKey] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);

  if (value !== prevValue) {
    setDirection(value > prevValue ? "up" : "down");
    setPulseKey((key) => key + 1);
    setPrevValue(value);
  }

  const delta = percentDelta(history);
  const deltaDirection = delta > 0.05 ? "up" : delta < -0.05 ? "down" : "flat";
  const revealed = hovered || focused || pinned;
  const recentPoints = history.slice(-REVEAL_COUNT);

  const DeltaIcon = deltaDirection === "up" ? ArrowUp : deltaDirection === "down" ? ArrowDown : Minus;

  return (
    <div
      className={`stat-card stat-card--${deltaDirection} ${revealed ? "stat-card--revealed" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onClick={() => setPinned((value) => !value)}
      role="button"
      tabIndex={0}
      aria-pressed={pinned}
      aria-label={`${def.label}, ${formatValue(def, value)}, ${deltaDirection === "flat" ? "flat" : deltaDirection === "up" ? "up" : "down"} ${Math.abs(delta).toFixed(1)} percent. Activate to ${pinned ? "hide" : "show"} the last ${REVEAL_COUNT} points.`}
    >
      <div className="stat-card__head">
        <span className="stat-card__label text-ui-sm">{def.label}</span>
        <span className={`stat-card__delta stat-card__delta--${deltaDirection} text-ui-sm`}>
          <DeltaIcon size={12} strokeWidth={2.5} />
          {Math.abs(delta).toFixed(1)}%
        </span>
      </div>

      <div className="stat-card__value-row">
        <span key={pulseKey} className={`stat-card__value stat-card__value--${direction} text-title-sm`}>
          {formatValue(def, value)}
        </span>
      </div>

      <Sparkline history={history} direction={deltaDirection} revealed={revealed} />

      <div className="stat-card__reveal-wrap">
        <div className="stat-card__reveal-inner">
          <ul className="stat-card__reveal-list">
            {recentPoints.map((point, i) => (
              <li key={history.length - REVEAL_COUNT + i} className="stat-card__reveal-row text-ui-xs">
                <span className="stat-card__reveal-tick">{i === recentPoints.length - 1 ? "now" : `t-${recentPoints.length - 1 - i}`}</span>
                <span className="stat-card__reveal-value">{formatValue(def, point)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
