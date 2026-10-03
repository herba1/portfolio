"use client";

import { Aperture, Film, SlidersHorizontal, Sparkles, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef } from "react";

import PlayPauseIcon from "@/app/ui/PlayPauseIcon";

import { SPEEDS, clamp, formatSeconds, frameCursor, steppedFrameTime } from "./splatVideoParams";

function speedLabel(speed) {
  return `${speed}×`;
}

export default function SplatVideoControls({
  engineRef,
  meta,
  playing,
  scrubbing,
  speed,
  expanded,
  sound = false,
  muted = true,
  onToggleMuted,
  look = null,
  onToggleLook,
  onTogglePlay,
  onPause,
  onSpeed,
  onBackToLens,
  onScrubStart,
  onScrubEnd,
  onToggleExpanded,
}) {
  const rootRef = useRef(null);
  const scrubRef = useRef(null);
  const timeRef = useRef(null);
  const frameRef = useRef(null);

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
        if (frameRef.current) {
          const cursor = frameCursor(time, meta);
          const nearest = cursor.blend < 0.5 ? cursor.frame0 : cursor.frame1;
          frameRef.current.textContent = `Frame ${nearest + 1} of ${meta.frames}`;
        }
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
    <div ref={rootRef} className="splat-video-controls" data-state={state} data-expanded={expanded} data-sound={sound}>
      <div className="splat-video-controls__main">
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
          <span className="splat-video-controls__of"> / {formatSeconds(meta.duration)}</span>
        </p>

        {sound ? (
          <button type="button" className="splat-video-controls__sound text-ui" onClick={onToggleMuted}>
            {muted ? (
              <VolumeX size={16} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Volume2 size={16} strokeWidth={1.75} aria-hidden="true" />
            )}
            <span className="splat-video-controls__sound-label">{muted ? "Unmute" : "Mute"}</span>
          </button>
        ) : null}

        <button
          type="button"
          className="splat-video-controls__more"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-controls="splat-video-extra"
          aria-label="More controls"
        >
          <SlidersHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <div id="splat-video-extra" className="splat-video-controls__extra">
        <p ref={frameRef} className="splat-video-controls__frame text-ui tabular-nums">
          Frame 1 of {meta.frames}
        </p>

        <div className="splat-video-controls__speeds" role="group" aria-label="Playback speed">
          {SPEEDS.map((option) => (
            <button
              key={option}
              type="button"
              className="splat-video-controls__speed text-ui tabular-nums"
              data-active={option === speed}
              aria-pressed={option === speed}
              onClick={() => onSpeed(option)}
            >
              {speedLabel(option)}
            </button>
          ))}
        </div>

        {look ? (
          <button type="button" className="splat-video-controls__lens text-ui" onClick={onToggleLook}>
            {look === "splats" ? (
              <Film size={16} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Sparkles size={16} strokeWidth={1.75} aria-hidden="true" />
            )}
            {look === "splats" ? "Video look" : "Splat look"}
          </button>
        ) : null}

        <button type="button" className="splat-video-controls__lens text-ui" onClick={onBackToLens}>
          <Aperture size={16} strokeWidth={1.75} aria-hidden="true" />
          Back to lens
        </button>
      </div>
    </div>
  );
}
