"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";

import { createKaraoke } from "./kEngine";
import { createMesh } from "./kMesh";
import { css, deep, ground, pale, readPalette } from "./kPalette";
import { SONGS } from "./kSongs";
import "./karaoke.css";

function Word({ word }) {
  return (
    <span className="k-word" data-hold={word.hold ? "" : undefined} data-text={word.text}>
      <span className="k-ink">
        {word.hold
          ? Array.from(word.text).map((ch, i) => (
              <span key={i} className="k-letter">
                {ch}
              </span>
            ))
          : word.text}
      </span>
    </span>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const viewportRef = useRef(null);
  const listRef = useRef(null);
  const fillRef = useRef(null);
  const knobRef = useRef(null);
  const trackRef = useRef(null);
  const timeARef = useRef(null);
  const timeBRef = useRef(null);
  const meshRef = useRef(null);
  const engineRef = useRef(null);
  const playingRef = useRef(true);
  const startRef = useRef(41);
  const indexRef = useRef(0);

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [current, setCurrent] = useState("");

  const song = SONGS[index];

  const choose = useCallback((i) => {
    const next = (i + SONGS.length) % SONGS.length;
    startRef.current = 0;
    indexRef.current = next;
    setIndex(next);
  }, []);

  useEffect(() => {
    const mesh = createMesh(canvasRef.current);
    meshRef.current = mesh;
    return () => {
      mesh.destroy();
      meshRef.current = null;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    readPalette(song.cover).then(({ colors }) => {
      const root = rootRef.current;
      if (!alive || !root) return;
      meshRef.current?.setPalette(colors.map(deep), ground(colors[0]));
      root.style.setProperty("--k-tint", css(pale(colors[0])));
      root.style.setProperty("--k-glow", css(pale(colors[1])));
    });
    return () => {
      alive = false;
    };
  }, [song.cover]);

  useEffect(() => {
    const engine = createKaraoke(
      {
        root: rootRef.current,
        viewport: viewportRef.current,
        list: listRef.current,
        fill: fillRef.current,
        knob: knobRef.current,
        track: trackRef.current,
        timeA: timeARef.current,
        timeB: timeBRef.current,
      },
      song,
      {
        from: startRef.current,
        playing: playingRef.current,
        onActive: (i) => {
          const line = song.lines[i];
          setCurrent(line.kind === "line" ? line.words.map((w) => w.text).join(" ") : "");
        },
        onEnd: () => choose(indexRef.current + 1),
        onKick: (v) => meshRef.current?.kick(v),
      },
    );
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [song, choose]);

  const togglePlay = () => {
    const next = !playingRef.current;
    playingRef.current = next;
    setPlaying(next);
    engineRef.current?.setPlaying(next);
  };

  const back = () => {
    if ((engineRef.current?.elapsed() || 0) > 3) engineRef.current?.seek(0, true);
    else choose(indexRef.current - 1);
  };

  const onLineClick = (line) => {
    if (viewportRef.current?.dataset.dragged !== undefined) return;
    engineRef.current?.seekTo(line.start);
  };

  const onTrackDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const id = e.pointerId;
    el.setPointerCapture(id);
    setScrubbing(true);
    const at = (ev) => (ev.clientX - rect.left) / rect.width;
    engineRef.current?.seek(at(e), false);
    const move = (ev) => ev.pointerId === id && engineRef.current?.seek(at(ev), false);
    const up = (ev) => {
      if (ev.pointerId !== id) return;
      engineRef.current?.seek(at(ev), true);
      setScrubbing(false);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
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

  const onRootKey = (e) => {
    if (e.target.closest("input, [role=slider]")) return;
    if (e.key === " " && e.target === rootRef.current) {
      e.preventDefault();
      togglePlay();
    }
  };

  return (
    <div
      className="karaoke"
      ref={rootRef}
      tabIndex={-1}
      data-embedded={embedded ? "" : undefined}
      data-playing={playing ? "" : undefined}
      data-scrubbing={scrubbing ? "" : undefined}
      onKeyDown={onRootKey}
    >
      <canvas className="k-mesh" ref={canvasRef} aria-hidden="true" />
      <div className="k-shade" aria-hidden="true" />
      <aside className="k-side">
        {embedded ? null : (
          <header className="k-caption">
            <h1 className="k-title">Karaoke</h1>
            <p className="k-hint">Lines fill word by word. Scroll to look around, click a line to jump there. The words are written for this page, not taken from the record.</p>
          </header>
        )}
        <div className="k-art" key={song.cover}>
          <img src={song.cover} alt={`${song.album} cover`} draggable={false} />
        </div>
        <div className="k-meta" key={song.id}>
          <span className="k-song">{song.title}</span>
          <span className="k-artist">
            {song.artist} · {song.album}
          </span>
        </div>
        <div className="k-scrub">
          <div
            className="k-track"
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="Playback position"
            aria-valuemin={0}
            aria-valuemax={song.duration}
            onPointerDown={onTrackDown}
            onKeyDown={onTrackKey}
          >
            <span className="k-rail">
              <span className="k-fill" ref={fillRef} />
            </span>
            <span className="k-knob" ref={knobRef} />
          </div>
          <div className="k-times">
            <span ref={timeARef}>0:00</span>
            <span ref={timeBRef}>-0:00</span>
          </div>
        </div>
        <div className="k-transport">
          <button type="button" className="k-btn" aria-label="Previous" onClick={back}>
            <SkipBack size={24} fill="currentColor" strokeWidth={0} />
          </button>
          <button type="button" className="k-btn k-btn-main" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
            <span className="k-glyph" data-playing={playing ? "" : undefined}>
              <Play className="k-glyph-play" size={32} fill="currentColor" strokeWidth={0} />
              <Pause className="k-glyph-pause" size={32} fill="currentColor" strokeWidth={0} />
            </span>
          </button>
          <button type="button" className="k-btn" aria-label="Next" onClick={() => choose(indexRef.current + 1)}>
            <SkipForward size={24} fill="currentColor" strokeWidth={0} />
          </button>
        </div>
        <div className="k-picker" role="radiogroup" aria-label="Song">
          {SONGS.map((s, i) => (
            <button key={s.id} type="button" role="radio" aria-checked={i === index} className="k-pick" onClick={() => choose(i)}>
              <img src={s.cover} alt="" draggable={false} />
              <span>{s.title}</span>
            </button>
          ))}
        </div>
      </aside>
      <section className="k-lyrics" ref={viewportRef} aria-label={`Lyrics for ${song.title}`}>
        <ol className="k-list" ref={listRef} key={song.id}>
          {song.lines.map((line, i) => (
            <li
              key={i}
              className="k-line"
              data-kind={line.kind}
            >
              {line.section ? <span className="k-section">{line.section}</span> : null}
              {line.kind === "gap" ? (
                <button type="button" className="k-gap" aria-label={`Jump to ${clockText(line.start)}, instrumental`} onClick={() => onLineClick(line)}>
                  <i />
                  <i />
                  <i />
                </button>
              ) : (
                <button type="button" className="k-text" onClick={() => onLineClick(line)}>
                  {line.words.map((w, j) => (
                    <span key={j}>
                      <Word word={w} />
                      {j < line.words.length - 1 ? " " : null}
                    </span>
                  ))}
                </button>
              )}
            </li>
          ))}
        </ol>
      </section>
      <p className="k-sr" aria-live="polite">
        {current}
      </p>
    </div>
  );
}

function clockText(seconds) {
  const t = Math.max(0, Math.floor(seconds));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}
