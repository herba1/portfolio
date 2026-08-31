"use client";

import { useMemo } from "react";
import { CELL_COUNT, layoutForTip } from "./blenderThreeJsBackParams";

export default function BlenderThreeJsBackScene({ tips, index, onSelect }) {
  const cells = useMemo(() => layoutForTip(index), [index]);
  const tip = tips[index];
  const progress = tips.length > 1 ? (index / (tips.length - 1)) * 100 : 0;

  return (
    <div className="btjb__stage">
      <div className="btjb__grid" role="img" aria-label={`Diagram for tip ${tip.n}: ${tip.title}`}>
        {cells.map((cell, i) => (
          <span
            key={i}
            className="btjb__cell"
            style={{
              left: `${cell.left}%`,
              top: `${cell.top}%`,
              width: `${cell.size}%`,
              height: `${cell.size}%`,
              backgroundColor: cell.color,
              opacity: cell.opacity,
              transitionDelay: `${cell.delay}ms`,
            }}
          />
        ))}
      </div>

      <div className="btjb__rail">
        <span className="btjb__pole text-ink-secondary text-ui-lg">Blender</span>
        <div className="btjb__track" role="group" aria-label="Tips">
          <div className="btjb__track-fill" style={{ width: `${progress}%` }} />
          {tips.map((t, i) => (
            <button
              key={t.n}
              type="button"
              className="btjb__station"
              data-active={i === index ? "true" : undefined}
              aria-pressed={i === index}
              aria-label={`Tip ${t.n} of ${tips.length}: ${t.title}`}
              onClick={() => onSelect(i)}
            >
              <span className="btjb__station-dot" />
            </button>
          ))}
        </div>
        <span className="btjb__pole text-ink-secondary text-ui-lg">Three.js</span>
      </div>

      <div className="btjb__readout">
        <span className="btjb__count text-ink-secondary text-ui tabular-nums">
          {String(tip.n).padStart(2, "0")} / {String(tips.length).padStart(2, "0")}
        </span>
        <h2 className="text-ink text-heading">{tip.title}</h2>
        <p className="btjb__tip-blurb text-ink-secondary text-body">{tip.blurb}</p>
      </div>
    </div>
  );
}
