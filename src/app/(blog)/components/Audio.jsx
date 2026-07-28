'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { motion } from 'motion/react'
import { SPRING_PRESS } from '@/lib/motion'
import { geist } from '@/app/fonts'
import PlayPauseIcon from '@/app/ui/PlayPauseIcon'
import Waveform from '@/app/ui/Waveform'

const BAR_COUNT = 40


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
  const scrubbingRef = useRef(false)
  const resumeRef = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const bars = useRef(seededBars(BAR_COUNT)).current

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTime = () => {
      // While scrubbing the playhead is driven optimistically by onSeek; the
      // throttled element time lags, so don't let timeupdate snap it back.
      if (scrubbingRef.current) return
      setCurrentTime(audio.currentTime)
      setProgress(audio.duration ? audio.currentTime / audio.duration : 0)
    }
    const onMeta = () => setDuration(audio.duration)
    const onEnd = () => setPlaying(false)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('ended', onEnd)
    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('ended', onEnd)
    }
  }, [])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
    } else {
      audio.play()
    }
    setPlaying(!playing)
  }, [playing])

  // Waveform reports a target time in seconds; scrub the (paused) element to
  // match. Pausing for the scrub means re-seeking never glitches the audio.
  const onSeek = useCallback((seconds) => {
    const audio = audioRef.current
    if (!audio || !audio.duration) return
    audio.currentTime = seconds
    setCurrentTime(seconds)
    setProgress(seconds / audio.duration)
  }, [])

  const scrubStart = useCallback(() => {
    scrubbingRef.current = true
    const audio = audioRef.current
    resumeRef.current = !!audio && !audio.paused
    if (audio) audio.pause()
  }, [])
  const scrubEnd = useCallback(() => {
    scrubbingRef.current = false
    const audio = audioRef.current
    if (audio && resumeRef.current) audio.play()
    resumeRef.current = false
  }, [])

  return (
    <figure className={`my-8 ${geist.className}`}>
      <audio ref={audioRef} src={src} preload="metadata" />

      <div className="flex items-center gap-4">
        {/* play/pause button */}
        <motion.button
          onClick={toggle}
          className="bg-surface-inverse text-ink-inverse grid h-12 w-12 shrink-0 place-items-center rounded-full"
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.88 }}
          transition={SPRING_PRESS}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          <PlayPauseIcon playing={playing} size={16} />
        </motion.button>

        {/* waveform card */}
        {/* A card: one step up the surface ladder plus a 1px line. The
            gradient + drop shadow + inset highlight it replaces were all
            doing the same job, three times over. */}
        <div className="squircle-sm bg-surface-raised border-line flex min-w-0 flex-1 flex-col gap-1.5 border p-3">
          <div className="flex items-center justify-between gap-2">
            {title && (
              <span className="text-ink text-heading-sm truncate">{title}</span>
            )}
            {/* tabular-nums: the elapsed time changes every second and must
                not shift the layout around it as digits swap. */}
            <span className="text-ink-secondary shrink-0 font-mono text-ui-sm tabular-nums">
              {formatTime(currentTime)}{duration ? ` / ${formatTime(duration)}` : ''}
            </span>
          </div>

          {/* shared, rubber-band-overscroll waveform primitive */}
          <Waveform
            peaks={bars}
            progress={progress}
            duration={duration}
            onSeek={onSeek}
            onScrubStart={scrubStart}
            onScrubEnd={scrubEnd}
            height={32}
            idleColor="var(--color-line-strong)"
          />
        </div>
      </div>

      {caption && (
        <figcaption className="text-ink-secondary text-ui-lg mt-2 text-center">
          {caption}
        </figcaption>
      )}
    </figure>
  )
}
