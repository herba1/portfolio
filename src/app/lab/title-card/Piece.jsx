"use client";

import { useEffect, useRef, useState } from "react";

import { BEATS, SECONDS, SECTIONS } from "./titleScene";
import "./title-card.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="title-card-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

function PlayIcon({ playing }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {playing ? <path d="M4.5 3h2.4v10H4.5zM9.1 3h2.4v10H9.1z" fill="currentColor" /> : <path d="M4.5 2.8v10.4L13 8z" fill="currentColor" />}
    </svg>
  );
}

const stamp = (t) => {
  const s = Math.floor(t);
  const cs = Math.floor((t - s) * 100);
  return `00:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
};

const ticks = Array.from({ length: BEATS }, (_, i) => i);

export default function Piece({ embedded = false }) {
  const stageRef = useRef(null);
  const frameRef = useRef(null);
  const trackRef = useRef(null);
  const headRef = useRef(null);
  const fillRef = useRef(null);
  const timeRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(false);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let cancelled = false;
    let engine = null;
    const onTime = (t) => {
      const f = t / SECONDS;
      if (headRef.current) headRef.current.style.transform = `translate3d(${(f * 100).toFixed(3)}cqw, 0, 0)`;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${f.toFixed(4)})`;
      if (timeRef.current) timeRef.current.textContent = stamp(t);
      if (trackRef.current) trackRef.current.setAttribute("aria-valuenow", String(Math.round(t * 10) / 10));
    };
    const start = () => {
      import("./titleEngine").then(({ createTitle }) => {
        if (cancelled) return;
        engine = createTitle({ frame: frameRef.current, track: trackRef.current, onTime, onPlaying: setPlaying });
        engineRef.current = engine;
        setReady(true);
      });
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        start();
      },
      { rootMargin: "240px" },
    );
    io.observe(stage);
    return () => {
      cancelled = true;
      io.disconnect();
      engine?.destroy();
      engineRef.current = null;
    };
  }, []);

  const toggleSound = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !sound;
    setSound(next);
    const result = await engine.setSound(next);
    if (result !== next) setSound(false);
  };

  const onTrackKey = (e) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      engine.seekBeat(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      engine.seekBeat(-1);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      engine.toggle();
    }
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={stageRef} className="title-card" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      {embedded ? null : (
        <header className="title-card-caption">
          <div className="title-card-caption-text">
            <h1 className="title-card-title">Title Sequence</h1>
            <p className="title-card-hint">An opening for Abbey Road in cut paper, cut on the beat of Friday Beat at 120 bpm. Scrub it, or let it loop.</p>
          </div>
          <button type="button" className="title-card-pill" aria-pressed={sound} onClick={toggleSound}>
            <SpeakerIcon on={sound} />
            <span>{sound ? "Sound on" : "Sound off"}</span>
          </button>
        </header>
      )}

      <div className="title-card-body">
        <div ref={frameRef} className="title-card-frame" role="img" aria-label="Animated title sequence for Abbey Road: a zebra crossing is cut from paper, the four Beatles walk across it with their names, then produced by George Martin and the title." />

        <div className="title-card-transport">
          <button type="button" className="title-card-play" aria-label={playing ? "Pause" : "Play"} onClick={() => engineRef.current?.toggle()}>
            <PlayIcon playing={playing} />
          </button>
          <div
            ref={trackRef}
            className="title-card-track"
            role="slider"
            tabIndex={0}
            aria-label="Scrub the sequence"
            aria-valuemin={0}
            aria-valuemax={SECONDS}
            aria-valuenow={0}
            onKeyDown={onTrackKey}
          >
            <div className="title-card-rail">
              <div ref={fillRef} className="title-card-fill" />
              {ticks.map((i) => (
                <span key={i} className="title-card-tick" data-bar={i % 4 === 0 ? "" : undefined} style={{ left: `${(i / BEATS) * 100}%` }} />
              ))}
            </div>
            <div className="title-card-sections" aria-hidden="true">
              {SECTIONS.map((s) => (
                <span key={s.name} className="title-card-section" style={{ left: `${(s.beat / BEATS) * 100}%` }}>
                  {s.name}
                </span>
              ))}
            </div>
            <div className="title-card-headwrap">
              <span ref={headRef} className="title-card-head" />
            </div>
          </div>
          <span ref={timeRef} className="title-card-time">
            00:00.00
          </span>
        </div>
      </div>
    </Root>
  );
}
