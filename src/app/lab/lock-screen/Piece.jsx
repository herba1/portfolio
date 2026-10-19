"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Airplay, Camera, Flashlight, Lock, Pause, Play, SkipBack, SkipForward } from "lucide-react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";
import { createLock } from "./lsEngine";
import { glow, readPalette } from "./lsPalette";
import { withDuration } from "./lsTracks";
import "./lock-screen.css";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function Slot({ digit }) {
  return (
    <span className="ls-slot" aria-hidden="true">
      <span className="ls-slot-col" style={{ transform: `translateY(${-digit * 10}%)` }}>
        {DIGITS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </span>
    </span>
  );
}

function Clock({ now }) {
  if (!now) return <p className="ls-clock" aria-hidden="true" />;
  const h = now.getHours() % 12 || 12;
  const m = now.getMinutes();
  const text = `${h}:${String(m).padStart(2, "0")}`;
  const hours = String(h).split("").map(Number);
  return (
    <p className="ls-clock" aria-label={text}>
      {hours.map((d, i) => (
        <Slot key={`h${hours.length - i}`} digit={d} />
      ))}
      <span className="ls-colon" aria-hidden="true">
        :
      </span>
      <Slot digit={Math.floor(m / 10)} />
      <Slot digit={m % 10} />
    </p>
  );
}

const dateText = (now) => (now ? now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "");

const unique = (list) => {
  const seen = new Set();
  return list.filter((t) => {
    const key = t.image;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export default function Piece({ embedded = false }) {
  const { tracks: raw } = useTopSongs(24);
  const tracks = useMemo(() => unique(raw).slice(0, 8).map(withDuration), [raw]);
  const rootRef = useRef(null);
  const phoneRef = useRef(null);
  const galleryRef = useRef(null);
  const widgetRef = useRef(null);
  const stripRef = useRef(null);
  const stripBoxRef = useRef(null);
  const coverRefs = useRef([]);
  const dotRefs = useRef([]);
  const fillRef = useRef(null);
  const knobRef = useRef(null);
  const trackRef = useRef(null);
  const timeARef = useRef(null);
  const timeBRef = useRef(null);
  const engineRef = useRef(null);
  const indexRef = useRef(0);
  const playingRef = useRef(true);

  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(null);
  const [playing, setPlaying] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);

  const track = tracks[Math.min(index, tracks.length - 1)];

  useEffect(() => {
    let timer = 0;
    const tick = () => {
      const d = new Date();
      setNow(d);
      timer = setTimeout(tick, 1000 - d.getMilliseconds() + 20);
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const engine = createLock(
      {
        root: rootRef.current,
        phoneEl: phoneRef.current,
        gallery: galleryRef.current,
        widget: widgetRef.current,
        strip: stripRef.current,
        stripBox: stripBoxRef.current,
        covers: coverRefs.current.slice(0, tracks.length),
        dots: dotRefs.current.slice(0, tracks.length),
        fill: fillRef.current,
        knob: knobRef.current,
        track: trackRef.current,
        timeA: timeARef.current,
        timeB: timeBRef.current,
      },
      {
        count: tracks.length,
        start: Math.min(indexRef.current, tracks.length - 1),
        duration: (i) => tracks[i]?.duration || 200,
        onIndex: (i) => {
          indexRef.current = i;
          setIndex(i);
        },
      },
    );
    engine.setPlaying(playingRef.current);
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [tracks]);

  useEffect(() => {
    let alive = true;
    Promise.all(tracks.map((t) => readPalette(t.imageLarge || t.image))).then((list) => {
      if (!alive) return;
      const shades = list.map(({ colors }) => ({
        c1: glow(colors[0]),
        c2: glow(colors[1]),
        deep: colors[0].map((v) => v * 0.3),
      }));
      engineRef.current?.setPalettes(shades);
    });
    return () => {
      alive = false;
    };
  }, [tracks]);

  const togglePlay = () => {
    const next = !playingRef.current;
    playingRef.current = next;
    setPlaying(next);
    engineRef.current?.setPlaying(next);
  };

  const back = () => {
    if ((engineRef.current?.elapsed() || 0) > 3) engineRef.current?.seek(0, true);
    else engineRef.current?.step(-1);
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
    const s = e.shiftKey ? 15 : 5;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") engineRef.current?.nudge(s);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") engineRef.current?.nudge(-s);
    else return;
    e.preventDefault();
  };

  const onPagerKey = (e) => {
    if (e.key === "ArrowRight") engineRef.current?.step(1);
    else if (e.key === "ArrowLeft") engineRef.current?.step(-1);
    else return;
    e.preventDefault();
  };

  if (!track) return null;

  return (
    <div
      className="lock-screen"
      ref={rootRef}
      data-embedded={embedded ? "" : undefined}
      data-playing={playing ? "" : undefined}
      data-scrubbing={scrubbing ? "" : undefined}
    >
      {embedded ? null : (
        <header className="ls-caption">
          <h1 className="ls-title">Lock Screen</h1>
        </header>
      )}
      <div className="ls-stage">
        <div className="ls-phone" ref={phoneRef}>
          <div className="ls-wall" aria-hidden="true" />
          <div className="ls-status" aria-hidden="true">
            <span />
            <span className="ls-status-icons">
              <svg width="18" height="12" viewBox="0 0 18 12">
                <rect x="0" y="8" width="3" height="4" rx="1" />
                <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
                <rect x="10" y="3" width="3" height="9" rx="1" />
                <rect x="15" y="0" width="3" height="12" rx="1" />
              </svg>
              <svg width="27" height="13" viewBox="0 0 27 13">
                <rect x="0.5" y="0.5" width="22" height="12" rx="3.5" fill="none" stroke="currentColor" />
                <rect x="2" y="2" width="16" height="9" rx="2" />
                <path d="M24.5 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" />
              </svg>
            </span>
          </div>
          <div className="ls-top">
            <Lock className="ls-lock" size={18} strokeWidth={2.4} aria-hidden="true" />
            <p className="ls-date">{dateText(now)}</p>
            <Clock now={now} />
          </div>
          <div className="ls-gallery" ref={galleryRef} aria-hidden="true">
            {tracks.map((t, i) => (
              <div
                key={t.id}
                className="ls-art"
                ref={(el) => {
                  coverRefs.current[i] = el;
                }}
              >
                <img src={t.imageLarge || t.image} alt="" draggable={false} />
              </div>
            ))}
          </div>
          <section className="ls-widget" ref={widgetRef} aria-label="Now playing" aria-roledescription="carousel">
            <div className="ls-strip-box" ref={stripBoxRef}>
              <div className="ls-strip" ref={stripRef}>
                {tracks.map((t, i) => (
                  <div className="ls-card" key={t.id} aria-hidden={i !== index} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${tracks.length}`}>
                    <img className="ls-thumb" src={t.image} alt="" draggable={false} />
                    <span className="ls-card-text">
                      <span className="ls-card-title">{t.title}</span>
                      <span className="ls-card-artist">{t.artist}</span>
                    </span>
                    <span className="ls-eq" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div
              className="ls-track"
              ref={trackRef}
              data-nodrag=""
              role="slider"
              tabIndex={0}
              aria-label="Playback position"
              aria-valuemin={0}
              aria-valuemax={track.duration}
              onPointerDown={onTrackDown}
              onKeyDown={onTrackKey}
            >
              <span className="ls-rail">
                <span className="ls-fill" ref={fillRef} />
              </span>
              <span className="ls-knob" ref={knobRef} />
            </div>
            <div className="ls-times">
              <span ref={timeARef}>0:00</span>
              <span ref={timeBRef}>-0:00</span>
            </div>
            <div className="ls-transport" data-nodrag="">
              <span className="ls-transport-side" />
              <button type="button" className="ls-btn" aria-label="Previous" onClick={back}>
                <SkipBack size={24} fill="currentColor" strokeWidth={0} />
              </button>
              <button type="button" className="ls-btn ls-btn-main" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
                <span className="ls-glyph" data-playing={playing ? "" : undefined}>
                  <Play className="ls-glyph-play" size={32} fill="currentColor" strokeWidth={0} />
                  <Pause className="ls-glyph-pause" size={32} fill="currentColor" strokeWidth={0} />
                </span>
              </button>
              <button type="button" className="ls-btn" aria-label="Next" onClick={() => engineRef.current?.step(1)}>
                <SkipForward size={24} fill="currentColor" strokeWidth={0} />
              </button>
              <button type="button" className="ls-btn ls-btn-side" aria-label="Play on another device">
                <Airplay size={18} strokeWidth={2} />
              </button>
            </div>
          </section>
          <div className="ls-dots" role="tablist" aria-label="Songs" onKeyDown={onPagerKey}>
            {tracks.map((t, i) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`${t.title} by ${t.artist}`}
                tabIndex={i === index ? 0 : -1}
                className="ls-dot"
                ref={(el) => {
                  dotRefs.current[i] = el;
                }}
                onClick={() => engineRef.current?.go(i)}
              />
            ))}
          </div>
          <span className="ls-quick ls-quick-left" aria-hidden="true">
            <Flashlight size={20} strokeWidth={2} />
          </span>
          <span className="ls-quick ls-quick-right" aria-hidden="true">
            <Camera size={20} strokeWidth={2} />
          </span>
          <span className="ls-home" aria-hidden="true" />
        </div>
      </div>
      <p className="ls-sr" aria-live="polite">
        {`${track.title} by ${track.artist}`}
      </p>
    </div>
  );
}
