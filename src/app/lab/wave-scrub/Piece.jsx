"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, RotateCw } from "lucide-react";

import { createScrub } from "./wsEngine";
import { TRACKS } from "./wsTracks";
import { buildPeaks, readColumns } from "./wsWave";
import "./wave-scrub.css";

const clock = (seconds) => {
  const t = Math.max(0, Math.floor(seconds));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

const parseRgb = (value) => {
  const m = value.match(/[\d.]+/g);
  return m ? m.slice(0, 3).map(Number) : [250, 250, 250];
};

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const surfaceRef = useRef(null);
  const chaptersRef = useRef(null);
  const bubbleRef = useRef(null);
  const bubbleTimeRef = useRef(null);
  const bubbleNameRef = useRef(null);
  const readoutRef = useRef(null);
  const engineRef = useRef(null);
  const playingRef = useRef(true);
  const fromRef = useRef(97);

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [section, setSection] = useState(0);

  const track = TRACKS[index];
  const wave = useMemo(() => buildPeaks(track), [track]);

  useEffect(() => {
    const root = rootRef.current;
    const style = getComputedStyle(root);
    const engine = createScrub(
      {
        root,
        canvas: canvasRef.current,
        surface: surfaceRef.current,
        chapters: [...chaptersRef.current.querySelectorAll("[data-chapter]")],
        bubble: bubbleRef.current,
        bubbleTime: bubbleTimeRef.current,
        bubbleName: bubbleNameRef.current,
        readout: readoutRef.current,
        ink: style.getPropertyValue("--ws-ink").trim() || "#111",
        ink2: style.getPropertyValue("--ws-ink-2").trim() || "#888",
      },
      track,
      wave,
      { playing: playingRef.current, from: fromRef.current, onSection: setSection },
    );
    engineRef.current = engine;
    let alive = true;
    readColumns(track.cover, 96).then((cols) => {
      if (!alive || !cols) return;
      engine.setColors(cols, parseRgb(style.backgroundColor));
    });
    return () => {
      alive = false;
      engine.destroy();
      engineRef.current = null;
    };
  }, [track, wave]);

  const choose = (i) => {
    if (i === index) return;
    fromRef.current = 0;
    setIndex(i);
  };

  const togglePlay = () => {
    const next = !playingRef.current;
    playingRef.current = next;
    setPlaying(next);
    engineRef.current?.setPlaying(next);
  };

  const onKey = (e) => {
    const engine = engineRef.current;
    if (!engine) return;
    const big = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") engine.nudge(big);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") engine.nudge(-big);
    else if (e.key === "PageDown" || e.key === "]") engine.chapter(1);
    else if (e.key === "PageUp" || e.key === "[") engine.chapter(-1);
    else if (e.key === "Home") engine.seekTo(0);
    else if (e.key === "End") engine.seekTo(track.duration - 1);
    else if (e.key === " ") togglePlay();
    else return;
    e.preventDefault();
  };

  return (
    <div className="wave-scrub" ref={rootRef} data-embedded={embedded ? "" : undefined} data-playing={playing ? "" : undefined}>
      {embedded ? null : (
        <header className="ws-caption">
          <h1 className="ws-title">Wave Scrub</h1>
          <p className="ws-hint">Hover for time and section. Press and hold to zoom in under your finger, then drag for fine control.</p>
        </header>
      )}
      <div className="ws-player">
        <div className="ws-head">
          <img className="ws-cover" key={track.cover} src={track.cover} alt={`${track.album} cover`} draggable={false} />
          <div className="ws-meta" key={track.id}>
            <span className="ws-song">{track.title}</span>
            <span className="ws-album">
              {track.artist} · {track.album} · {track.year}
            </span>
          </div>
          <div className="ws-time">
            <span className="ws-readout" ref={readoutRef}>
              0:00.0
            </span>
            <span className="ws-total">{clock(track.duration)}</span>
          </div>
        </div>
        <div
          className="ws-surface"
          ref={surfaceRef}
          role="slider"
          tabIndex={0}
          aria-label={`Position in ${track.title}`}
          aria-valuemin={0}
          aria-valuemax={track.duration}
          onKeyDown={onKey}
        >
          <div className="ws-chapters" ref={chaptersRef} key={track.id}>
            {track.sections.map((s, i) => (
              <button
                key={i}
                type="button"
                tabIndex={-1}
                className="ws-chapter"
                data-chapter=""
                onClick={() => engineRef.current?.seekTo(s.start)}
                aria-label={`${s.name}, ${clock(s.start)}`}
              >
                <span>{s.name}</span>
              </button>
            ))}
          </div>
          <div className="ws-wave">
            <canvas ref={canvasRef} className="ws-canvas" aria-hidden="true" />
            <div className="ws-bubble" ref={bubbleRef} aria-hidden="true">
              <span className="ws-bubble-time" ref={bubbleTimeRef}>
                0:00
              </span>
              <span className="ws-bubble-name" ref={bubbleNameRef} />
            </div>
          </div>
        </div>
        <div className="ws-foot">
          <div className="ws-transport">
            <button type="button" className="ws-btn" aria-label="Back 15 seconds" onClick={() => engineRef.current?.nudge(-15)}>
              <RotateCcw size={18} strokeWidth={2} />
            </button>
            <button type="button" className="ws-btn ws-btn-main" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
              <span className="ws-glyph" data-playing={playing ? "" : undefined}>
                <Play className="ws-glyph-play" size={20} fill="currentColor" strokeWidth={0} />
                <Pause className="ws-glyph-pause" size={20} fill="currentColor" strokeWidth={0} />
              </span>
            </button>
            <button type="button" className="ws-btn" aria-label="Forward 15 seconds" onClick={() => engineRef.current?.nudge(15)}>
              <RotateCw size={18} strokeWidth={2} />
            </button>
            <span className="ws-now" aria-live="polite">
              {track.sections[section]?.name}
            </span>
          </div>
          <div className="ws-tracks" role="radiogroup" aria-label="Song">
            {TRACKS.map((t, i) => (
              <button key={t.id} type="button" role="radio" aria-checked={i === index} className="ws-pick" onClick={() => choose(i)}>
                <img src={t.cover} alt="" draggable={false} />
                <span>{t.title}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
