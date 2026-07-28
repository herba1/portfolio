/* ═════════════════════════════════════════════════════════════════════
 * MOTION TOKENS — the JavaScript half.
 *
 * The CSS tokens in globals.css can't be reached from a Motion
 * `transition` prop: `ease: "var(--ease-entrance)"` is not a thing, and
 * `duration` there is a NUMBER OF SECONDS, not a CSS time. So the values
 * have to exist twice — once as CSS custom properties, once here.
 *
 * That duplication is the whole reason this file exists. Six components
 * had each declared their own `const EASE_OUT_QUART = [0.165, 0.84,
 * 0.44, 1]`, and the Motion call sites that didn't bother had the raw
 * array inline. Six copies means six things to miss when the curve
 * changes. Now there's one copy per language, and they sit next to each
 * other in review.
 *
 * KEEP IN SYNC with the EASING and DURATION blocks in globals.css. If
 * you retune a curve there, retune it here in the same commit.
 * ═════════════════════════════════════════════════════════════════════ */

/* ── Easing ────────────────────────────────────────────────────────────
 * Motion takes the two control points as [x1, y1, x2, y2] — the same
 * four numbers CSS `cubic-bezier()` takes, in the same order. */

/** The signature curve. Anything arriving. Fast out, long settle. */
export const EASE_ENTRANCE = [0.16, 1, 0.3, 1]

/** Pointer feedback and small state changes. Gentler than entrance. */
export const EASE_HOVER = [0.165, 0.84, 0.44, 1]

/** Back-out. For things that should pop rather than arrive. */
export const EASE_OVERSHOOT = [0.34, 1.56, 0.64, 1]

/** Symmetric — for a value driven both directions (scrub, toggle). */
export const EASE_STANDARD = [0.4, 0, 0.2, 1]
export const EASE_IN_OUT = [0.7, 0, 0.3, 1]

/* ── Duration ──────────────────────────────────────────────────────────
 * SECONDS, because that's the unit Motion's `duration` wants. The CSS
 * side is the same ladder in milliseconds. */
export const DURATION = {
  color: 0.1,
  press: 0.12,
  base: 0.15,
  overlay: 0.2,
  slow: 0.3,
  reveal: 0.4,
  entrance: 0.6,
  entranceLg: 0.8,
}

/** Per-item delays for a cascade. Not durations — steps between items. */
export const STAGGER = {
  tight: 0.04,
  base: 0.08,
  loose: 0.15,
}

/* ── Springs ───────────────────────────────────────────────────────────
 * Stiffness/damping/mass rather than Motion's `visualDuration`, so the
 * feel is stated directly instead of being inferred. These were also
 * duplicated across components. */

/** Button and icon presses — quick, barely any overshoot. */
export const SPRING_PRESS = { type: 'spring', stiffness: 600, damping: 25, mass: 0.3 }

/** Panels and cards settling into place. */
export const SPRING_SETTLE = { type: "spring", stiffness: 400, damping: 30, mass: 0.5 }
