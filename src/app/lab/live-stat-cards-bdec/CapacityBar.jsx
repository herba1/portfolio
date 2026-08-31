"use client";

import { CAPACITY } from "./statFeed";

const TICKS = [0, 0.25, 0.5, 0.75, 1];

export default function CapacityBar({ segments, finalFraction, held }) {
  const filled = segments.reduce((sum, segment) => sum + segment.seats, 0) / CAPACITY;

  return (
    <div className="lsc-capacity" aria-hidden="true">
      <div className="lsc-capacity__bar">
        {segments.map((segment, index) => (
          <span
            key={segment.id}
            className="lsc-capacity__segment"
            data-tier={segment.id}
            style={{ "--i": index, width: `${(segment.seats / CAPACITY) * 100}%` }}
          />
        ))}
        <span
          className="lsc-capacity__final"
          data-shown={held ? "true" : "false"}
          style={{ left: `${finalFraction * 100}%` }}
        />
        <span className="lsc-capacity__head" style={{ left: `${filled * 100}%` }} />
      </div>
      <div className="lsc-capacity__rule">
        {TICKS.map((tick) => (
          <span key={tick} className="lsc-capacity__tick" style={{ left: `${tick * 100}%` }} />
        ))}
      </div>
    </div>
  );
}
