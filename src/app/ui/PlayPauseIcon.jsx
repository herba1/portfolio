'use client'

import { useEffect, useRef } from 'react'
import { motion, useAnimationControls } from 'motion/react'

/* ─────────────────────────────────────────────
 * PlayPauseIcon — the single play/pause primitive.
 *
 * Two round-cornered paths (4 points each) morph between a play triangle
 * and pause bars. A soft blur pulse plays on each toggle. It does NOT
 * rotate, and nothing animates on mount/open — the morph + pulse only fire
 * on a genuine play→pause / pause→play change.
 *
 * Colour comes from `currentColor`, so set it via the parent's text colour
 * (or pass a `style`/`className`).
 * ───────────────────────────────────────────── */

// Corner rounding. Both shapes must stay 4-point polygons for `d` to morph, so
// the radius comes from a round-joined stroke in the glyph's own colour rather
// than from arcs in the path data. JOIN is the stroke width, so the corner
// radius is half of it.
const JOIN = 1.8

// The paths below are the ORIGINAL outlines inset by JOIN/2 along their own
// normals, so the stroke lands the visible edge exactly where the un-stroked
// shape used to sit: the pause bars still span x 3→6.5 / 9.5→13 and y 3→13, and
// the play triangle still starts at x 4. Insetting is per-normal, not a uniform
// coordinate shift — the triangle's sharp tip pulls back much further than its
// flat left edge, which is what makes a rounded tip read as rounded and not as
// a shortened spike.
const PLAY_L = 'M 4.9 3.63 L 9 6.22 L 9 9.78 L 4.9 12.37 Z'
// The tip is two near-coincident points (0.04 apart, ~0.05px on screen) so this
// stays a 4-point polygon for the morph. They are not exactly coincident
// because a zero-length segment gives the round join no direction to work with.
const PLAY_R = 'M 9 6.22 L 11.81 7.98 L 11.81 8.02 L 9 9.78 Z'
const PAUSE_L = 'M 3.9 3.9 L 5.6 3.9 L 5.6 12.1 L 3.9 12.1 Z'
const PAUSE_R = 'M 10.4 3.9 L 12.1 3.9 L 12.1 12.1 L 10.4 12.1 Z'

const MORPH = { type: 'spring', stiffness: 500, damping: 30, mass: 0.5 }

// Blur pulse. --blur-xs is 4px, which is a quarter of the glyph's own width at
// these sizes — it read as a smear, not a pulse. A ~1.4px peak over a longer,
// back-weighted ramp softens the swap without dissolving it.
const PULSE = {
  filter: ['blur(0px)', 'blur(1.4px)', 'blur(0px)'],
  transition: { duration: 0.34, times: [0, 0.32, 1], ease: [0.33, 1, 0.68, 1] },
}

export default function PlayPauseIcon({ playing, size = 20, className, style }) {
  const controls = useAnimationControls()
  const mounted = useRef(false)

  // Blur pulse on each toggle — never on mount. (A keyframe array left in
  // `animate` would otherwise fire the moment the icon appears.)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    controls.start(PULSE)
  }, [playing, controls])

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={JOIN}
      strokeLinejoin="round"
      strokeLinecap="round"
      className={className}
      style={style}
      initial={{ filter: 'blur(0px)' }}
      animate={controls}
    >
      <motion.path initial={false} animate={{ d: playing ? PAUSE_L : PLAY_L }} transition={MORPH} />
      <motion.path initial={false} animate={{ d: playing ? PAUSE_R : PLAY_R }} transition={MORPH} />
    </motion.svg>
  )
}
