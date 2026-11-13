"use client";

import { Aperture, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef } from "react";

import PlayPauseIcon from "@/app/ui/PlayPauseIcon";

import { LOOKS, LOOK_LABELS, SPEEDS, clamp, formatSeconds, steppedFrameTime } from "./splatVideoParams";

function speedLabel(speed) {
  return `${speed}×`;
}

function nextSpeed(speed) {
  const index = SPEEDS.indexOf(speed);
  return SPEEDS[(index + 1) % SPEEDS.length];
}

// One small pill floating over the sky: play, a short scrubber, the time, the
// speed (one button that steps through the speeds) and back to lens. The
// stage is the piece; the pill only ever sits on its lower edge.
export default function SplatVideoControls({
  engineRef,
  meta,
  playing,
  scrubbing,
  speed,
  sound = false,
  muted = true,
  onToggleMuted,
  look = null,
  onLook,
  onTogglePlay,
  onPause,
  onSpeed,
  onBackToLens,
  onScrubStart,
  onScrubEnd,
}) {
  const rootRef = useRef(null);
  const scrubRef = useRef(null);
  const timeRef = useRef(null);

  useEffect(() => {
    let frame = 0;
    let lastTime = -1;
    const tick = () => {
      const engine = engineRef.current;
      const time = engine.time;
      if (time !== lastTime) {
        lastTime = time;
        const progress = clamp(time / meta.duration, 0, 1);
        if (scrubRef.current && !engine.scrubbing) scrubRef.current.value = String(time);
        if (scrubRef.current) scrubRef.current.setAttribute("aria-valuetext", `${formatSeconds(time)} of ${formatSeconds(meta.duration)}`);
        if (rootRef.current) rootRef.current.style.setProperty("--splat-video-progress", String(progress));
        if (timeRef.current) timeRef.current.textContent = formatSeconds(time);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [engineRef, meta]);

  const seek = (time) => {
    engineRef.current.time = clamp(time, 0, meta.duration);
  };

  const stepFrames = (direction) => {
    seek(steppedFrameTime(meta, engineRef.current.time, direction));
  };

  const handleScrubKey = (event) => {
    const keys = {
      ArrowRight: () => stepFrames(1),
      ArrowUp: () => stepFrames(1),
      ArrowLeft: () => stepFrames(-1),
      ArrowDown: () => stepFrames(-1),
      Home: () => seek(0),
      End: () => seek(meta.duration),
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    onPause();
    action();
  };

  const handleScrubInput = (event) => {
    seek(Number(event.target.value));
  };

  const handleScrubPointerDown = (event) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onScrubStart();
  };

  const state = scrubbing ? "scrubbing" : playing ? "playing" : "paused";

  return (
    <div ref={rootRef} className="splat-video-controls" data-state={state} role="group" aria-label="Player">
      <button
        type="button"
        className="splat-video-controls__play"
        onClick={onTogglePlay}
        aria-label={playing ? "Pause" : "Play"}
        aria-keyshortcuts="Space"
      >
        <PlayPauseIcon playing={playing} size={16} />
      </button>

      <label className="splat-video-controls__scrub">
        <span className="splat-video-sr">Scrub through the clip</span>
        <span className="splat-video-controls__track" aria-hidden="true">
          <span className="splat-video-controls__fill" />
        </span>
        <input
          ref={scrubRef}
          type="range"
          min={0}
          max={meta.duration}
          step="any"
          defaultValue={0}
          onInput={handleScrubInput}
          onChange={handleScrubInput}
          onKeyDown={handleScrubKey}
          onPointerDown={handleScrubPointerDown}
          onPointerUp={onScrubEnd}
          onPointerCancel={onScrubEnd}
          onBlur={onScrubEnd}
        />
      </label>

      <p className="splat-video-controls__time text-ui tabular-nums">
        <span ref={timeRef}>{formatSeconds(0)}</span>
      </p>

      <span className="splat-video-controls__rule" aria-hidden="true" />

      <button
        type="button"
        className="splat-video-controls__chip text-ui tabular-nums"
        onClick={() => onSpeed(nextSpeed(speed))}
        aria-label={`Speed ${speedLabel(speed)}, switch to ${speedLabel(nextSpeed(speed))}`}
      >
        {speedLabel(speed)}
      </button>

      {look ? (
        <button
          type="button"
          className="splat-video-controls__chip text-ui"
          onClick={() => onLook(LOOKS[(LOOKS.indexOf(look) + 1) % LOOKS.length])}
          aria-label={`Subject look: ${LOOK_LABELS[look]}`}
        >
          {LOOK_LABELS[look]}
        </button>
      ) : null}

      {sound ? (
        <button type="button" className="splat-video-controls__icon" onClick={onToggleMuted} aria-label={muted ? "Unmute" : "Mute"}>
          {muted ? <VolumeX size={16} strokeWidth={1.75} aria-hidden="true" /> : <Volume2 size={16} strokeWidth={1.75} aria-hidden="true" />}
        </button>
      ) : null}

      <button type="button" className="splat-video-controls__icon" onClick={onBackToLens} aria-label="Back to lens" title="Back to lens">
        <Aperture size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}
