"use client";

import { GRID_COLS } from "./lib/config";

// Overview of the unique cover set with a "you are here" marker (the focused
// cover). Click a cell to ease the infinite grid onto the nearest instance.
export default function Minimap({ covers, focusIdx, onJump }) {
  return (
    <div className="cv-minimap" aria-label="Grid minimap">
      {covers.map((c, i) => {
        const uc = i % GRID_COLS;
        const ur = (i / GRID_COLS) | 0;
        return (
          <button
            key={i}
            className={`cv-mm-cell ${i === focusIdx ? "is-here" : ""}`}
            style={{
              gridColumn: uc + 1,
              // Reading order: cover #1 (index 0) sits top-left, filling
              // left-to-right then down — independent of the world's +y-up axis.
              gridRow: ur + 1,
              backgroundImage: c.image ? `url(${c.image})` : undefined,
            }}
            onClick={() => onJump(uc, ur)}
            title={c.title}
          />
        );
      })}
    </div>
  );
}
