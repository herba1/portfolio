"use client";

import { useEffect, useRef, useState } from "react";

import { albumById } from "@/app/lab/_music/catalog";

import { createSaveAudio } from "./saveAudio";
import "./save-ring.css";

const ALBUM = albumById("abbey-road");
const LENGTHS = [260, 183, 185, 165, 242, 125];
const MB_PER_SEC = 0.04;
const TRACKS = (() => {
  let at = 0;
  return ALBUM.tracks.map((title, i) => {
    const size = LENGTHS[i] * MB_PER_SEC;
    const row = { title, n: i + 1, length: LENGTHS[i], start: at, end: at + size };
    at += size;
    return row;
  });
})();
const TOTAL = TRACKS[TRACKS.length - 1].end;
const MINUTES = Math.round(LENGTHS.reduce((a, b) => a + b, 0) / 60);
const time = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const mb = (v) => (Math.floor(Math.max(0, v) * 10 + 1e-6) / 10).toFixed(1);

const RING_R = 21;

function DownloadIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 3.5v9M5.8 8.6 10 12.8l4.2-4.2M4 16.5h12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4.8 10.4l3.4 3.4 7-7.4" />
    </svg>
  );
}

function RowMark({ state, frac }) {
  return (
    <svg className="save-ring-mark" viewBox="0 0 20 20" data-state={state} aria-hidden="true">
      <circle className="save-ring-mark-track" cx="10" cy="10" r="7.5" />
      <circle className="save-ring-mark-arc" cx="10" cy="10" r="7.5" pathLength="1" style={{ strokeDasharray: `${frac} 1` }} transform="rotate(-90 10 10)" />
      <circle className="save-ring-mark-dot" cx="10" cy="10" r="9" />
      <path className="save-ring-mark-check" d="M6.4 10.3l2.4 2.4 4.9-5.1" pathLength="1" />
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const coverRef = useRef(null);
  const arcRef = useRef(null);
  const sheenRef = useRef(null);
  const engineRef = useRef(null);
  const [phase, setPhase] = useState("idle");
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const audio = createSaveAudio();
    const st = { phase: "idle", real: 0, shown: 0, vel: 0, raf: 0, last: 0, t: 0, reported: -1, timer: 0, finished: 0 };

    const go = (next) => {
      st.phase = next;
      setPhase(next);
    };

    const paint = () => {
      const frac = Math.max(0, Math.min(1, st.shown / TOTAL));
      coverRef.current?.style.setProperty("--save-p", frac.toFixed(4));
      if (arcRef.current) arcRef.current.style.strokeDasharray = `${frac.toFixed(4)} 1`;
      const tenth = Math.floor(Math.max(0, st.shown) * 10 + 1e-6);
      if (tenth !== st.reported) {
        st.reported = tenth;
        setLoaded(Math.max(0, st.shown));
      }
    };

    const loop = (now) => {
      const dt = Math.min(0.1, (now - st.last) / 1000);
      st.last = now;
      st.t += dt;
      if (st.phase === "loading") {
        const burst = 0.6 + 0.4 * Math.sin(st.t * 2.3) * Math.sin(st.t * 0.9 + 1) + 0.2 * Math.sin(st.t * 7.1);
        st.real = Math.min(TOTAL, st.real + dt * 18 * Math.max(0.25, burst));
      }
      const unwinding = st.phase === "cancelling" || st.phase === "draining";
      const target = unwinding ? 0 : st.real;
      const k = st.phase === "draining" ? 36 : st.phase === "cancelling" ? 48 : 90;
      const c = 2 * Math.sqrt(k);
      const n = Math.max(1, Math.ceil(dt * 240));
      for (let i = 0; i < n; i += 1) {
        const a = k * (target - st.shown) - c * st.vel;
        st.vel += (a * dt) / n;
        st.shown += (st.vel * dt) / n;
      }
      if (st.shown > TOTAL) {
        st.shown = TOTAL;
        st.vel = 0;
      }
      if (reduce) st.shown = target;
      const finished = TRACKS.filter((tr) => st.shown >= tr.end - 0.01).length;
      if (finished > st.finished && st.phase === "loading") audio.track();
      st.finished = finished;
      paint();

      if (st.phase === "loading" && st.real >= TOTAL && st.shown >= TOTAL - 0.02) {
        st.shown = TOTAL;
        st.vel = 0;
        paint();
        setLoaded(TOTAL);
        go("filling");
        audio.done();
        celebrate();
        st.timer = window.setTimeout(() => go("saved"), 1300);
      }
      if (unwinding && st.shown < 0.02) {
        st.shown = 0;
        st.real = 0;
        st.vel = 0;
        st.finished = 0;
        paint();
        go("idle");
      }
      const moving = st.phase === "loading" || st.phase === "cancelling" || st.phase === "draining";
      st.raf = moving ? requestAnimationFrame(loop) : 0;
    };

    const start = () => {
      if (st.raf) return;
      st.last = performance.now();
      st.raf = requestAnimationFrame(loop);
    };

    function celebrate() {
      if (reduce) return;
      sheenRef.current?.animate(
        [
          { transform: "translateX(-110%) skewX(-16deg)", opacity: 0 },
          { transform: "translateX(-20%) skewX(-16deg)", opacity: 1, offset: 0.35 },
          { transform: "translateX(230%) skewX(-16deg)", opacity: 0 },
        ],
        { duration: 1000, delay: 120, easing: "cubic-bezier(0.45, 0, 0.55, 1)" },
      );
    }

    engineRef.current = {
      press() {
        audio.wake();
        if (st.phase === "idle" || st.phase === "cancelling" || st.phase === "draining") {
          st.real = Math.max(0, st.shown);
          go("loading");
          start();
        } else if (st.phase === "loading") {
          go("cancelling");
          audio.cancel();
          start();
        } else if (st.phase === "saved") {
          st.real = 0;
          st.finished = 0;
          go("draining");
          audio.cancel();
          start();
        }
      },
    };
    paint();

    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(st.raf);
        st.raf = 0;
      } else if (st.phase === "loading" || st.phase === "cancelling" || st.phase === "draining") start();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(st.raf);
      window.clearTimeout(st.timer);
      document.removeEventListener("visibilitychange", onVis);
      audio.destroy();
      engineRef.current = null;
    };
  }, []);

  const press = () => engineRef.current?.press();
  const ring = phase === "loading" || phase === "cancelling" || phase === "filling";
  const doneCount = TRACKS.filter((tr) => loaded >= tr.end - 0.01).length;
  const activeIndex = phase === "loading" ? Math.min(TRACKS.length - 1, doneCount) : -1;
  const label =
    phase === "loading"
      ? "Stop download"
      : phase === "cancelling"
        ? "Resume download"
        : phase === "filling"
          ? "Downloaded"
          : phase === "saved"
            ? "Remove download"
            : "Download Abbey Road";
  const face = phase === "saved" ? "saved" : ring ? "ring" : "idle";

  let headline;
  let sub;
  if (phase === "loading") {
    headline = `${mb(loaded)} of ${mb(TOTAL)} MB`;
    sub = `${TRACKS[activeIndex].title}`;
  } else if (phase === "cancelling") {
    headline = `${mb(loaded)} of ${mb(TOTAL)} MB`;
    sub = "Stopping";
  } else if (phase === "filling" || phase === "saved") {
    headline = "On this device";
    sub = `${mb(TOTAL)} MB`;
  } else if (phase === "draining") {
    headline = "Removing";
    sub = `${mb(loaded)} MB`;
  } else {
    headline = `${mb(TOTAL)} MB`;
    sub = "Not downloaded";
  }

  const Root = embedded ? "div" : "main";

  return (
    <Root className="save-ring" data-embedded={embedded ? "" : undefined} data-phase={phase}>
      {embedded ? null : (
        <header className="save-ring-head">
          <h1 className="save-ring-title">Save Ring</h1>
        </header>
      )}

      <section className="save-ring-stage">
        <div ref={coverRef} className="save-ring-cover" data-phase={phase}>
          <img className="save-ring-cover-grey" src={ALBUM.cover} alt={`${ALBUM.title} by ${ALBUM.artist}`} draggable={false} />
          <img className="save-ring-cover-color" src={ALBUM.cover} alt="" draggable={false} />
          <span ref={sheenRef} className="save-ring-sheen" aria-hidden="true" />
        </div>

        <div className="save-ring-side">
          <div className="save-ring-about">
            <h2 className="save-ring-album">{ALBUM.title}</h2>
            <p className="save-ring-meta">
              {ALBUM.artist} · {ALBUM.year} · {TRACKS.length} songs, {MINUTES} min
            </p>
          </div>

          <div className="save-ring-action">
            <p className="save-ring-status" aria-live="polite">
              <span className="save-ring-headline">{headline}</span>
              <span className="save-ring-sub">{sub}</span>
            </p>
            <button type="button" className="save-ring-btn" data-face={face} data-phase={phase} aria-label={label} onClick={press}>
              <span className="save-ring-pill" aria-hidden="true" />
              <span className="save-ring-face save-ring-face--idle" aria-hidden="true">
                <DownloadIcon />
                <span>Download</span>
              </span>
              <span className="save-ring-face save-ring-face--saved" aria-hidden="true">
                <CheckIcon />
                <span>Downloaded</span>
              </span>
              <svg className="save-ring-disc" viewBox="0 0 48 48" aria-hidden="true">
                <circle className="save-ring-track" cx="24" cy="24" r={RING_R} />
                <circle ref={arcRef} className="save-ring-arc" cx="24" cy="24" r={RING_R} pathLength="1" transform="rotate(-90 24 24)" />
                <circle className="save-ring-fill" cx="24" cy="24" r="24" />
                <rect className="save-ring-stop" x="18.5" y="18.5" width="11" height="11" rx="2" />
                <path className="save-ring-play" d="M20.5 17.6v12.8l10-6.4z" />
                <path className="save-ring-check" d="M16.4 24.6l5 5 10.2-10.4" pathLength="1" />
              </svg>
            </button>
          </div>

          <ol className="save-ring-list">
            {TRACKS.map((tr, i) => {
              const frac = Math.max(0, Math.min(1, (loaded - tr.start) / (tr.end - tr.start)));
              const state = loaded >= tr.end - 0.01 ? "done" : i === activeIndex ? "active" : "idle";
              return (
                <li key={tr.title} className="save-ring-row" data-state={state}>
                  <span className="save-ring-n">{tr.n}</span>
                  <span className="save-ring-song">{tr.title}</span>
                  <RowMark state={state} frac={frac} />
                  <span className="save-ring-len">{time(tr.length)}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    </Root>
  );
}
