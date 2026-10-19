"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";

import { createPlayer } from "./dpEngine";
import { css, glow, readPalette } from "./dpPalette";
import { TRACKS } from "./dpTracks";
import "./dynamic-player.css";

const BARS = 5;
const OPEN_DELAY = 80;
const CLOSE_DELAY = 240;

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const islandRef = useRef(null);
  const coverRef = useRef(null);
  const barBoxRef = useRef(null);
  const barRefs = useRef([]);
  const expandedRef = useRef(null);
  const rowRefs = useRef([]);
  const fillRef = useRef(null);
  const knobRef = useRef(null);
  const trackRef = useRef(null);
  const timeARef = useRef(null);
  const timeBRef = useRef(null);
  const hitRef = useRef(null);
  const playRef = useRef(null);
  const engineRef = useRef(null);
  const hoverTimer = useRef(0);
  const pinnedRef = useRef(false);
  const viaKeyRef = useRef(false);
  const indexRef = useRef(0);
  const playingRef = useRef(true);
  const scrubbingRef = useRef(false);

  const [index, setIndex] = useState(0);
  const [previous, setPrevious] = useState(null);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);

  const track = TRACKS[index];

  const goTo = useCallback((next, autoplay) => {
    const i = (next + TRACKS.length) % TRACKS.length;
    if (i === indexRef.current) return;
    setPrevious(TRACKS[indexRef.current].cover);
    indexRef.current = i;
    setIndex(i);
    engineRef.current?.load(TRACKS[i], autoplay);
  }, []);

  useEffect(() => {
    const engine = createPlayer(
      {
        root: rootRef.current,
        island: islandRef.current,
        cover: coverRef.current,
        barBox: barBoxRef.current,
        bars: barRefs.current,
        expanded: expandedRef.current,
        rows: rowRefs.current,
        fill: fillRef.current,
        knob: knobRef.current,
        track: trackRef.current,
        timeA: timeARef.current,
        timeB: timeBRef.current,
      },
      { onEnd: () => goTo(indexRef.current + 1, playingRef.current) },
    );
    engine.load(TRACKS[0], true, 47);
    engineRef.current = engine;
    return () => {
      engine.destroy();
      clearTimeout(hoverTimer.current);
      engineRef.current = null;
    };
  }, [goTo]);

  useEffect(() => {
    let alive = true;
    readPalette(track.cover).then(({ colors }) => {
      const root = rootRef.current;
      if (!alive || !root) return;
      root.style.setProperty("--dp-wave", css(glow(colors[0])));
    });
    return () => {
      alive = false;
    };
  }, [track.cover]);

  useEffect(() => {
    engineRef.current?.setOpen(open);
    if (open && viaKeyRef.current) playRef.current?.focus({ preventScroll: true });
    if (!open && islandRef.current?.contains(document.activeElement) && document.activeElement !== hitRef.current) hitRef.current?.focus({ preventScroll: true });
  }, [open]);

  const show = useCallback((next, pin) => {
    clearTimeout(hoverTimer.current);
    pinnedRef.current = pin;
    setOpen(next);
  }, []);

  const onEnter = (e) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setOpen(true), OPEN_DELAY);
  };

  const onLeave = (e) => {
    if (e.pointerType !== "mouse" || pinnedRef.current || scrubbingRef.current) return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY);
  };

  const onIslandDown = (e) => {
    if (e.target.closest("button, [role=slider]") && e.target !== hitRef.current) return;
    engineRef.current?.press(true);
    const up = () => {
      engineRef.current?.press(false);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onHitClick = () => {
    viaKeyRef.current = false;
    show(true, true);
  };

  const onHitKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      viaKeyRef.current = true;
      show(true, true);
    }
  };

  const onRootDown = (e) => {
    if (open && !islandRef.current?.contains(e.target)) show(false, false);
  };

  const onRootKey = (e) => {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      show(false, false);
    }
  };

  const togglePlay = () => {
    const next = !playingRef.current;
    playingRef.current = next;
    setPlaying(next);
    engineRef.current?.setPlaying(next);
  };

  const back = () => {
    if ((engineRef.current?.elapsed() || 0) > 3) engineRef.current?.seek(0, true);
    else goTo(indexRef.current - 1, playingRef.current);
  };

  const forward = () => goTo(indexRef.current + 1, playingRef.current);

  const onTrackDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const id = e.pointerId;
    el.setPointerCapture(id);
    scrubbingRef.current = true;
    setScrubbing(true);
    const at = (ev) => (ev.clientX - rect.left) / rect.width;
    engineRef.current?.seek(at(e), false);
    const move = (ev) => ev.pointerId === id && engineRef.current?.seek(at(ev), false);
    const up = (ev) => {
      if (ev.pointerId !== id) return;
      engineRef.current?.seek(at(ev), true);
      scrubbingRef.current = false;
      setScrubbing(false);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (ev.pointerType === "mouse" && !pinnedRef.current && !islandRef.current?.matches(":hover")) {
        clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY);
      }
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const onTrackKey = (e) => {
    const step = e.shiftKey ? 15 : 5;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") engineRef.current?.nudge(step);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") engineRef.current?.nudge(-step);
    else return;
    e.preventDefault();
  };

  return (
    <div
      className="dynamic-player"
      ref={rootRef}
      data-embedded={embedded ? "" : undefined}
      data-open={open ? "" : undefined}
      data-scrubbing={scrubbing ? "" : undefined}
      onPointerDown={onRootDown}
      onKeyDown={onRootKey}
    >
      <div className="dp-island" ref={islandRef} role="group" aria-label="Now playing" onPointerEnter={onEnter} onPointerLeave={onLeave} onPointerDown={onIslandDown}>
        <button
          type="button"
          className="dp-hit"
          ref={hitRef}
          aria-expanded={open}
          aria-label={`Now playing ${track.title} by ${track.artist}. Open player.`}
          tabIndex={open ? -1 : 0}
          data-hidden={open ? "" : undefined}
          onClick={onHitClick}
          onKeyDown={onHitKey}
        />
        <button type="button" className="dp-cover" ref={coverRef} tabIndex={open ? 0 : -1} aria-label="Fold player" onClick={() => show(false, false)}>
          {previous ? <img className="dp-cover-img" src={previous} alt="" draggable={false} /> : null}
          <img key={track.cover} className="dp-cover-img dp-cover-now" src={track.cover} alt={`${track.album} cover`} draggable={false} onAnimationEnd={() => setPrevious(null)} />
        </button>
        <span className="dp-bars" ref={barBoxRef} aria-hidden="true">
          {Array.from({ length: BARS }, (_, i) => (
            <i key={i} ref={(el) => (barRefs.current[i] = el)} />
          ))}
        </span>
        <div className="dp-expanded" ref={expandedRef} inert={!open}>
          <div className="dp-row dp-head" ref={(el) => (rowRefs.current[0] = el)}>
            <div className="dp-head-text" key={track.id}>
              <span className="dp-song">{track.title}</span>
              <span className="dp-artist">{track.artist}</span>
            </div>
          </div>
          <div className="dp-row dp-scrub" ref={(el) => (rowRefs.current[1] = el)}>
            <span className="dp-time" ref={timeARef}>
              0:00
            </span>
            <div
              className="dp-track"
              ref={trackRef}
              role="slider"
              tabIndex={0}
              aria-label="Playback position"
              aria-valuemin={0}
              aria-valuemax={track.duration}
              onPointerDown={onTrackDown}
              onKeyDown={onTrackKey}
            >
              <span className="dp-rail">
                <span className="dp-fill" ref={fillRef} />
              </span>
              <span className="dp-knob" ref={knobRef} />
            </div>
            <span className="dp-time dp-time-end" ref={timeBRef}>
              -0:00
            </span>
          </div>
          <div className="dp-row dp-transport" ref={(el) => (rowRefs.current[2] = el)}>
            <button type="button" className="dp-btn" aria-label="Previous" onClick={back}>
              <SkipBack size={24} fill="currentColor" strokeWidth={0} />
            </button>
            <button type="button" className="dp-btn dp-btn-main" ref={playRef} aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
              <span className="dp-glyph" data-playing={playing ? "" : undefined}>
                <Play className="dp-glyph-play" size={32} fill="currentColor" strokeWidth={0} />
                <Pause className="dp-glyph-pause" size={32} fill="currentColor" strokeWidth={0} />
              </span>
            </button>
            <button type="button" className="dp-btn" aria-label="Next" onClick={forward}>
              <SkipForward size={24} fill="currentColor" strokeWidth={0} />
            </button>
          </div>
        </div>
      </div>
      {embedded ? null : (
        <header className="dp-caption">
          <h1 className="dp-title">Dynamic Player</h1>
        </header>
      )}
      <p className="dp-sr" aria-live="polite">
        {`${playing ? "Playing" : "Paused"}: ${track.title}`}
      </p>
    </div>
  );
}
