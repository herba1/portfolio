"use client";

import { GRID_COLS, GRID_ROWS } from "./lib/config";

// Miniature of the canvas click-push (see DEFAULTS.push* in lib/config.js).
// Opening a cover shoves its neighbours radially out and shrinks them while the
// clicked tile grows into the player card — the map replays that at map scale so
// the two surfaces agree about what just happened. Units are minimap px / cells.
const MM_RANGE = 2.4; // reach of the shockwave, in map cells
const MM_PUSH = 7; // px of displacement at the epicentre
const MM_SHRINK = 0.16; // how much shoved cells shrink
const MM_OPEN_SCALE = 1.45; // the opened cell, standing in for the card
const MM_RIPPLE = 70; // ms of extra delay at the far edge of the field

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);
const smoothstep = (e, x) => {
  const t = clamp01(x / e);
  return t * t * (3 - 2 * t);
};
// shortest distance on a torus: the world tiles infinitely, so column 0 and
// column 5 are neighbours out there. Wrapping keeps the ripple symmetric
// instead of dying against the map's arbitrary edges.
const wrap = (d, n) => {
  const m = ((d % n) + n) % n;
  return m > n / 2 ? m - n : m;
};

// Overview of the unique cover set with a "you are here" marker (the focused
// cover). Click a cell to ease the infinite grid onto the nearest instance.
export default function Minimap({ covers, focusIdx, openIdx, onJump }) {
  const open = openIdx == null ? null : { c: openIdx % GRID_COLS, r: (openIdx / GRID_COLS) | 0 };

  return (
    <div className={`cv-minimap${open ? " is-open" : ""}`} aria-label="Grid minimap">
      {covers.map((c, i) => {
        const uc = i % GRID_COLS;
        const ur = (i / GRID_COLS) | 0;

        // rest state — identity transform, no ripple delay
        let tx = 0;
        let ty = 0;
        let s = 1;
        let delay = 0;
        if (open) {
          const dx = wrap(uc - open.c, GRID_COLS);
          const dy = wrap(ur - open.r, GRID_ROWS);
          const d = Math.hypot(dx, dy);
          if (d < 0.001) {
            s = MM_OPEN_SCALE;
          } else {
            const f = 1 - smoothstep(MM_RANGE, d);
            tx = (dx / d) * MM_PUSH * f;
            // negated: dy counts in world rows (+row = up), CSS +y is down
            ty = -(dy / d) * MM_PUSH * f;
            s = 1 - MM_SHRINK * f;
            delay = clamp01(d / MM_RANGE) * MM_RIPPLE;
          }
        }

        return (
          <button
            key={i}
            className={`cv-mm-cell ${i === focusIdx ? "is-here" : ""} ${
              open && open.c === uc && open.r === ur ? "is-playing" : ""
            }`}
            style={{
              gridColumn: uc + 1,
              // ROW IS FLIPPED ON PURPOSE. World rows live in three's +y-up
              // space (ty = row * cell), so a higher row draws HIGHER on screen,
              // while CSS grid rows count downward. Laying the map out in
              // reading order (cover #1 top-left, counting down) therefore
              // mirrored the vertical axis: pan down on the canvas and the
              // marker crawled up the map. Columns already agree (+col = right),
              // so only y inverts. The set is tiled infinitely, so which row
              // anchors the top is arbitrary — direction of travel is not.
              gridRow: GRID_ROWS - ur,
              backgroundImage: c.image ? `url(${c.image})` : undefined,
              // The push rides its own custom properties so hover can keep its
              // own multiplier without the two transforms clobbering each other.
              "--mm-x": `${tx.toFixed(2)}px`,
              "--mm-y": `${ty.toFixed(2)}px`,
              "--mm-s": s.toFixed(3),
              // the delay applies on the way back too, so closing unwinds as a
              // ripple rather than a single flat snap
              transitionDelay: delay ? `${Math.round(delay)}ms` : undefined,
            }}
            onClick={() => onJump(uc, ur)}
            title={c.title}
          />
        );
      })}
    </div>
  );
}
