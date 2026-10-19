"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

import useNearViewport from "@/app/experiments/useNearViewport";

import "./screen-glow.css";

const WEBM = new URL("./charge.webm", import.meta.url).href;
const MP4 = new URL("./charge.mp4", import.meta.url).href;
const POSTER = new URL("./charge-poster.webp", import.meta.url).href;

const clock = (seconds) => {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const screenRef = useRef(null);
  const videoRef = useRef(null);
  const roomRef = useRef(null);
  const lightRef = useRef(null);
  const trackRef = useRef(null);
  const fillRef = useRef(null);
  const timeRef = useRef(null);
  const engineRef = useRef(null);
  const scrubRef = useRef(null);
  const near = useNearViewport(rootRef);
  const [playing, setPlaying] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!near) return undefined;
    let cancelled = false;
    let engine = null;
    import("./screenGlowEngine").then(({ createScreenGlow }) => {
      if (cancelled) return;
      engine = createScreenGlow({
        root: rootRef.current,
        screen: screenRef.current,
        video: videoRef.current,
        room: roomRef.current,
        canvas: lightRef.current,
        poster: POSTER,
        onTime: (time, duration) => {
          const p = duration ? time / duration : 0;
          if (fillRef.current) fillRef.current.style.transform = `scaleX(${p})`;
          if (trackRef.current) {
            trackRef.current.style.setProperty("--sg-progress", String(p));
            trackRef.current.setAttribute("aria-valuenow", String(Math.round(time)));
            trackRef.current.setAttribute("aria-valuetext", `${clock(time)} of ${clock(duration)}`);
            trackRef.current.setAttribute("aria-valuemax", String(Math.round(duration || 0)));
          }
          if (timeRef.current) timeRef.current.textContent = clock(time);
        },
        onPlaying: setPlaying,
        onReady: () => setReady(true),
      });
      engineRef.current = engine;
    });
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
    };
  }, [near]);

  const toggle = useCallback(() => engineRef.current?.toggle(), []);

  const seekFromEvent = (event) => {
    const rect = trackRef.current.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    engineRef.current?.scrubTo(p);
  };

  const onTrackDown = (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (scrubRef.current != null) return;
    scrubRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    engineRef.current?.scrubStart();
    setScrubbing(true);
    seekFromEvent(event);
  };

  const onTrackMove = (event) => {
    if (scrubRef.current !== event.pointerId) return;
    seekFromEvent(event);
  };

  const onTrackUp = (event) => {
    if (scrubRef.current !== event.pointerId) return;
    scrubRef.current = null;
    setScrubbing(false);
    engineRef.current?.scrubEnd();
  };

  const onTrackKey = (event) => {
    const engine = engineRef.current;
    if (!engine) return;
    const steps = { ArrowLeft: -2, ArrowRight: 2, ArrowDown: -5, ArrowUp: 5, PageDown: -10, PageUp: 10 };
    if (event.key in steps) {
      event.preventDefault();
      engine.nudge(steps[event.key]);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      engine.scrubTo(event.key === "Home" ? 0 : 0.999);
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      engine.toggle();
    }
  };

  return (
    <div
      ref={rootRef}
      className="screen-glow"
      data-ready={ready ? "" : undefined}
      data-embedded={embedded ? "" : undefined}
      data-scrubbing={scrubbing ? "" : undefined}
    >
      {embedded ? null : (
        <header className="screen-glow__head">
          <h1 className="screen-glow__title">Screen Glow</h1>
          <p className="screen-glow__lede">
            A short film is the only light in the room. Drag the timeline and the type <em>catches</em> every cut.
          </p>
        </header>
      )}

      <div className="screen-glow__theatre">
        <div ref={screenRef} className="screen-glow__screen">
          <video
            ref={videoRef}
            className="screen-glow__video"
            poster={POSTER}
            muted
            playsInline
            loop
            preload={near ? "auto" : "none"}
            aria-label="Charge, a short animated film by the Blender Foundation"
            onClick={toggle}
          >
            <source src={WEBM} type="video/webm" />
            <source src={MP4} type="video/mp4" />
          </video>
        </div>

        <div className="screen-glow__controls">
          <button type="button" className="screen-glow__play" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause size={16} strokeWidth={1.75} aria-hidden="true" /> : <Play size={16} strokeWidth={1.75} aria-hidden="true" />}
          </button>
          <div
            ref={trackRef}
            className="screen-glow__track"
            role="slider"
            tabIndex={0}
            aria-label="Film position"
            aria-valuemin={0}
            aria-valuemax={55}
            aria-valuenow={0}
            onPointerDown={onTrackDown}
            onPointerMove={onTrackMove}
            onPointerUp={onTrackUp}
            onPointerCancel={onTrackUp}
            onLostPointerCapture={onTrackUp}
            onKeyDown={onTrackKey}
          >
            <span className="screen-glow__rail" aria-hidden="true">
              <span ref={fillRef} className="screen-glow__fill" />
            </span>
            <span className="screen-glow__head-dot" aria-hidden="true" />
          </div>
          <span ref={timeRef} className="screen-glow__time" aria-hidden="true">
            00:00
          </span>
        </div>

      </div>

      <div ref={roomRef} className="screen-glow__room">
        <canvas ref={lightRef} className="screen-glow__light" aria-hidden="true" />
        <div className="screen-glow__column">
          <p className="screen-glow__line">In the dark, a film is the only lamp in the room.</p>
          <p className="screen-glow__body">
            It throws its colour at whatever is near: the backs of the seats, the people in them, the edge of a coat. A cut to fire turns
            everyone orange for a moment. A cut to night and the faces go out, until the next shot finds them again.
          </p>
          <p className="screen-glow__body">Nobody looks at that light. It lands on you all the same.</p>
        </div>
      </div>

      <p className="screen-glow__credit">
        <a href="https://studio.blender.org/charge" target="_blank" rel="noreferrer">
          Charge
        </a>{" "}
        (2022) © Blender Foundation,{" "}
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
          CC BY 4.0
        </a>
        . Shortened by Codrops.
      </p>
    </div>
  );
}
