'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'motion/react'
import { geist } from '@/app/fonts'

const BAR_COUNT = 80

/* ─────────────────────────────────────────────
 * Play/Pause — two filled paths, 4 points each.
 * Play triangle splits into left-half + right-point.
 * Pause: two rectangles. Same vertex count = clean morph.
 * Whole SVG rotates 90deg during morph + blur pulse.
 *
 * Waveform drag:
 *   Pointer down → drag → pointer up
 *   Bars near drag point stretch vertically (scaleY)
 *   Gaussian falloff from drag position
 *   Progress follows drag in real time
 * ───────────────────────────────────────────── */

// stiffness/damping/mass for direct control — no visualDuration ambiguity
const SPRING = { type: 'spring', stiffness: 500, damping: 30, mass: 0.5 }
const SPRING_PRESS = { type: 'spring', stiffness: 600, damping: 25, mass: 0.3 }

// Play triangle — two halves (4 points each, same vertex count = clean morph)
// Both halves share the seam at x=9 so no gap appears during morph
const PLAY_L = 'M 4 2 L 9 5.5 L 9 10.5 L 4 14 Z'
const PLAY_R = 'M 9 5.5 L 13.5 8 L 13.5 8 L 9 10.5 Z'

// Pause bars — two filled rects, same 4 vertices
const PAUSE_L = 'M 3 3 L 6.5 3 L 6.5 13 L 3 13 Z'
const PAUSE_R = 'M 9.5 3 L 13 3 L 13 13 L 9.5 13 Z'

function seededBars(count) {
  const bars = []
  for (let i = 0; i < count; i++) {
    const center = count / 2
    const dist = Math.abs(i - center) / center
    const envelope = 1 - dist * dist
    const noise = Math.sin(i * 127.1 + 311.7) * 43758.5453 % 1
    bars.push(0.25 + envelope * 0.65 * (0.5 + noise * 0.5))
  }
  return bars
}

function formatTime(s) {
  if (!s || !isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export function Audio({ src, title, caption }) {
  const audioRef = useRef(null)
  const waveRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [hasInteracted, setHasInteracted] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dragX, setDragX] = useState(-1) // 0–1 normalized, -1 = not dragging
  const [iconRotation, setIconRotation] = useState(0)
  const bars = useRef(seededBars(BAR_COUNT)).current

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTime = () => {
      if (!dragging) {
        setCurrentTime(audio.currentTime)
        setProgress(audio.duration ? audio.currentTime / audio.duration : 0)
      }
    }
    const onMeta = () => setDuration(audio.duration)
    const onEnd = () => { setPlaying(false); setHasInteracted(true); setIconRotation(r => r - 90) }
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('ended', onEnd)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('ended', onEnd)
    }
  }, [dragging])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setIconRotation(r => r - 90)
    } else {
      audio.play()
      setIconRotation(r => r + 90)
    }
    setPlaying(!playing)
    setHasInteracted(true)
  }, [playing])

  // — drag handlers —
  const getX = (e) => {
    const rect = waveRef.current.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  }

  const onPointerDown = useCallback((e) => {
    e.preventDefault()
    waveRef.current.setPointerCapture(e.pointerId)
    setDragging(true)
    setHasInteracted(true)
    const x = getX(e)
    setDragX(x)
    setProgress(x)
    if (audioRef.current.duration) {
      audioRef.current.currentTime = x * audioRef.current.duration
    }
  }, [])

  const onPointerMove = useCallback((e) => {
    if (!dragging) return
    const x = getX(e)
    setDragX(x)
    setProgress(x)
    setCurrentTime(x * (audioRef.current.duration || 0))
  }, [dragging])

  const onPointerUp = useCallback((e) => {
    if (!dragging) return
    setDragging(false)
    setDragX(-1)
    const x = getX(e)
    if (audioRef.current.duration) {
      audioRef.current.currentTime = x * audioRef.current.duration
    }
  }, [dragging])

  const expanded = playing || hasInteracted

  return (
    <figure className={`my-8 ${geist.className}`}>
      <audio ref={audioRef} src={src} preload="metadata" />

      <div className="flex items-center gap-4">
        {/* play/pause button */}
        <motion.button
          onClick={toggle}
          className="bg-dark text-white grid h-12 w-12 shrink-0 place-items-center rounded-full shadow-lg shadow-dark/20"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.88 }}
          transition={SPRING_PRESS}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          <motion.svg
            width="16" height="16" viewBox="0 0 16 16"
            fill="white"
            initial={false}
            animate={{
              rotate: iconRotation,
              filter: ['blur(0px)', 'blur(2px)', 'blur(0px)'],
            }}
            transition={{
              rotate: { type: 'spring', stiffness: 400, damping: 25, mass: 0.4 },
              filter: { duration: 0.2, times: [0, 0.4, 1] },
            }}
            style={{ transformOrigin: '50% 50%' }}
          >
            <motion.path
              initial={false}
              animate={{ d: playing ? PAUSE_L : PLAY_L }}
              transition={SPRING}
            />
            <motion.path
              initial={false}
              animate={{ d: playing ? PAUSE_R : PLAY_R }}
              transition={SPRING}
            />
          </motion.svg>
        </motion.button>

        {/* waveform card */}
        <div className="squircle-sm bg-linear-to-b from-white to-slate-50 border-dark/10 shadow-dark/5 inset-shadow-white/80 flex min-w-0 flex-1 flex-col gap-1.5 border p-3 shadow-sm inset-shadow-sm">
          <div className="flex items-center justify-between gap-2">
            {title && (
              <span className="tracking-body-base text-dark truncate text-xs font-medium">
                {title}
              </span>
            )}
            <span className="text-dark/30 shrink-0 font-mono text-[10px] tabular-nums">
              {formatTime(currentTime)}{duration ? ` / ${formatTime(duration)}` : ''}
            </span>
          </div>

          {/* waveform — draggable, bars stretch near pointer */}
          <div
            ref={waveRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="relative flex h-8 cursor-pointer items-center select-none touch-none"
            style={{ gap: '0.5px' }}
            role="slider"
            aria-valuenow={Math.round(progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Audio progress"
          >
            {bars.map((h, i) => {
              const pct = i / BAR_COUNT
              const active = pct < progress
              const targetH = expanded ? h * 100 : 8

              // proximity stretch during drag
              let scaleY = 1
              if (dragging && dragX >= 0) {
                const dist = Math.abs(pct - dragX)
                // gaussian falloff — bars within ~8% of drag point stretch
                const influence = Math.exp(-(dist * dist) / (2 * 0.03 * 0.03))
                scaleY = 1 + influence * 0.5
              }

              const delay = expanded
                ? i * 0.004
                : (BAR_COUNT - i) * 0.003

              return (
                <motion.div
                  key={i}
                  className="flex-1 origin-center rounded-full"
                  initial={false}
                  animate={{
                    height: `${targetH}%`,
                    backgroundColor: active ? '#1a1a1a' : 'rgba(26,26,26,0.12)',
                    scaleY,
                    scaleX: dragging && dragX >= 0
                      ? 1 - Math.exp(-((pct - dragX) ** 2) / (2 * 0.03 * 0.03)) * 0.4
                      : 1,
                  }}
                  transition={{
                    height: {
                      type: 'spring',
                      stiffness: 400,
                      damping: expanded ? 20 : 30,
                      mass: 0.4,
                      delay: dragging ? 0 : delay,
                    },
                    backgroundColor: { duration: 0.06 },
                    scaleY: { type: 'spring', stiffness: 600, damping: 20, mass: 0.3 },
                    scaleX: { type: 'spring', stiffness: 600, damping: 20, mass: 0.3 },
                  }}
                />
              )
            })}
          </div>
        </div>
      </div>

      {caption && (
        <figcaption className="text-dark/50 mt-2 text-center text-sm">
          {caption}
        </figcaption>
      )}
    </figure>
  )
}
