'use client'

import { useEffect, useRef } from 'react'
import { motion, useAnimationControls } from 'motion/react'

/* ─────────────────────────────────────────────
 * PlayPauseIcon — the single play/pause primitive.
 *
 * Two filled paths (4 points each) morph between a play triangle and
 * pause bars. A soft blur pulse plays on each toggle. It does NOT rotate,
 * and nothing animates on mount/open — the morph + pulse only fire on a
 * genuine play→pause / pause→play change.
 *
 * Colour comes from `currentColor`, so set it via the parent's text colour
 * (or pass a `style`/`className`).
 * ───────────────────────────────────────────── */

const PLAY_L = 'M 4 2 L 9 5.5 L 9 10.5 L 4 14 Z'
const PLAY_R = 'M 9 5.5 L 13.5 8 L 13.5 8 L 9 10.5 Z'
const PAUSE_L = 'M 3 3 L 6.5 3 L 6.5 13 L 3 13 Z'
const PAUSE_R = 'M 9.5 3 L 13 3 L 13 13 L 9.5 13 Z'

const MORPH = { type: 'spring', stiffness: 500, damping: 30, mass: 0.5 }

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
    controls.start({
      filter: ['blur(0px)', 'blur(2px)', 'blur(0px)'],
      transition: { duration: 0.2, times: [0, 0.4, 1] },
    })
  }, [playing, controls])

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
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
