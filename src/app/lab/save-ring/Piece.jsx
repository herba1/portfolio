"use client";

import { useEffect, useId, useRef, useState } from "react";

import { albumById } from "@/app/lab/_music/catalog";

import Roll from "./Roll";
import { createSaveAudio } from "./saveAudio";
import "./save-ring.css";

const ALBUM = albumById("abbey-road");
const LENGTHS = [260, 183, 185, 165, 242, 125];
const MB_PER_SEC = 0.04;
const TRACKS = (() => {
  let at = 0;
  return ALBUM.tracks.map((title, i) => {
    const mb = LENGTHS[i] * MB_PER_SEC;
    const row = { title, n: i + 1, length: LENGTHS[i], start: at, end: at + mb };
    at += mb;
    return row;
  });
})();
const TOTAL = TRACKS[TRACKS.length - 1].end;
const MINUTES = Math.round(LENGTHS.reduce((a, b) => a + b, 0) / 60);
const time = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const mb = (v) => (Math.round(v * 10) / 10).toFixed(1);

function DownloadIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 3.5v9M5.8 8.6 10 12.8l4.2-4.2M4 16.5h12" />
    </svg>
  );
}

function RowMark({ state, frac }) {
  return (
    <svg className="save-ring-mark" viewBox="0 0 20 20" data-state={state} aria-hidden="true">
      <circle className="save-ring-mark-track" cx="10" cy="10" r="7" />
      <circle className="save-ring-mark-arc" cx="10" cy="10" r="7" pathLength="1" style={{ strokeDasharray: `${frac} 1` }} transform="rotate(-90 10 10)" />
      <circle className="save-ring-mark-dot" cx="10" cy="10" r="9" />
      <path className="save-ring-mark-check" d="M6.2 10.3l2.5 2.5 5-5.2" pathLength="1" />
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const raw = useId();
  const maskId = `save-ring-mask-${raw.replace(/[^a-zA-Z0-9]/g, "")}`;
  const maskRef = useRef(null);
  const buttonRef = useRef(null);
  const sheenRef = useRef(null);
  const waveRef = useRef(null);
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
      const frac = Math.min(1, st.shown / TOTAL);
      maskRef.current.style.strokeDasharray = `${frac.toFixed(4)} 1`;
      const r = Math.round(st.shown * 10) / 10;
      if (r !== st.reported) {
        st.reported = r;
        setLoaded(Math.max(0, st.shown));
      }
    };

    const loop = (now) => {
      const dt = Math.min(0.033, (now - st.last) / 1000);
      st.last = now;
      st.t += dt;
      if (st.phase === "loading") {
        const burst = 0.55 + 0.45 * Math.sin(st.t * 2.3) * Math.sin(st.t * 0.9 + 1) + 0.25 * Math.sin(st.t * 7.1);
        st.real = Math.min(TOTAL, st.real + dt * 10.5 * Math.max(0.15, burst));
      }
      const target = st.phase === "cancelling" ? 0 : st.real;
      const k = st.phase === "cancelling" ? 60 : 90;
      const c = 2 * Math.sqrt(k);
      const n = Math.max(1, Math.ceil(dt * 240));
      for (let i = 0; i < n; i += 1) {
        const a = k * (target - st.shown) - c * st.vel;
        st.vel += (a * dt) / n;
        st.shown += (st.vel * dt) / n;
      }
      if (reduce) st.shown = target;
      const finished = TRACKS.filter((tr) => st.shown >= tr.end - 0.01).length;
      if (finished > st.finished && st.phase === "loading") audio.track();
      st.finished = finished;
      paint();

      if (st.phase === "loading" && st.real >= TOTAL && st.shown >= TOTAL - 0.02) {
        st.shown = TOTAL;
        paint();
        setLoaded(TOTAL);
        go("filling");
        audio.done();
        celebrate();
        st.timer = window.setTimeout(() => go("saved"), 1700);
      }
      if (st.phase === "cancelling" && st.shown < 0.03) {
        st.shown = 0;
        st.real = 0;
        st.vel = 0;
        paint();
        go("idle");
      }
      const moving = st.phase === "loading" || st.phase === "cancelling";
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
          { transform: "translateX(-120%) skewX(-18deg)", opacity: 0 },
          { transform: "translateX(-40%) skewX(-18deg)", opacity: 1, offset: 0.3 },
          { transform: "translateX(140%) skewX(-18deg)", opacity: 0 },
        ],
        { duration: 1100, delay: 200, easing: "cubic-bezier(0.45, 0, 0.55, 1)" },
      );
      waveRef.current?.animate(
        [
          { transform: "scale(0.9)", opacity: 0.9, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
          { transform: "scale(2.4)", opacity: 0 },
        ],
        { duration: 900, delay: 250 },
      );
    }

    engineRef.current = {
      press() {
        audio.wake();
        if (st.phase === "idle") {
          st.real = Math.max(0, st.shown);
          go("loading");
          start();
        } else if (st.phase === "loading") {
          go("cancelling");
          audio.cancel();
          start();
        } else if (st.phase === "cancelling") {
          st.real = Math.max(0, st.shown);
          go("loading");
          start();
        } else if (st.phase === "saved") {
          st.real = 0;
          st.shown = 0;
          st.vel = 0;
          st.finished = 0;
          paint();
          go("idle");
        }
      },
    };
    paint();

    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(st.raf);
        st.raf = 0;
      } else if (st.phase === "loading" || st.phase === "cancelling") start();
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
  const busy = phase === "loading" || phase === "cancelling";
  const doneCount = TRACKS.filter((tr) => loaded >= tr.end - 0.01).length;
  const activeIndex = busy ? Math.min(TRACKS.length - 1, doneCount) : -1;
  const label =
    phase === "idle" ? "Download Abbey Road" : phase === "loading" ? "Cancel download" : phase === "cancelling" ? "Resume download" : phase === "filling" ? "Downloaded" : "Remove download";

  const Root = embedded ? "div" : "main";

  return (
    <Root className="save-ring" data-embedded={embedded ? "" : undefined} data-phase={phase}>
      {embedded ? null : (
        <header className="save-ring-head">
          <h1 className="save-ring-title">Save Ring</h1>
          <p className="save-ring-hint">Download the album. Tap the ring to cancel, tap again to pick it back up.</p>
        </header>
      )}

      <section className="save-ring-card">
        <div className="save-ring-top">
          <div className="save-ring-cover">
            <img src={ALBUM.cover} alt={`${ALBUM.title} by ${ALBUM.artist}`} draggable={false} />
            <span ref={sheenRef} className="save-ring-sheen" aria-hidden="true" />
          </div>
          <div className="save-ring-about">
            <h2 className="save-ring-album">{ALBUM.title}</h2>
            <p className="save-ring-meta">
              {ALBUM.artist} · {ALBUM.year} · {TRACKS.length} songs, {MINUTES} min
            </p>
            <div className="save-ring-action">
              <button ref={buttonRef} type="button" className="save-ring-btn" data-phase={phase} aria-label={label} onClick={press}>
                <span ref={waveRef} className="save-ring-wave" aria-hidden="true" />
                <span className="save-ring-face save-ring-face--idle" aria-hidden="true">
                  <DownloadIcon />
                  <span>Download</span>
                </span>
                <span className="save-ring-face save-ring-face--saved" aria-hidden="true">
                  <img src={ALBUM.cover} alt="" draggable={false} />
                  <span>Downloaded</span>
                </span>
                <svg className="save-ring-disc" viewBox="0 0 48 48" aria-hidden="true">
                  <defs>
                    <mask id={maskId}>
                      <circle ref={maskRef} className="save-ring-mask" cx="24" cy="24" r="20" pathLength="1" transform="rotate(-90 24 24)" />
                    </mask>
                    <clipPath id={`${maskId}-disc`}>
                      <circle cx="24" cy="24" r="24" />
                    </clipPath>
                  </defs>
                  <circle className="save-ring-track" cx="24" cy="24" r="20" />
                  <g clipPath={`url(#${maskId}-disc)`}>
                    <image href={ALBUM.cover} x="0" y="0" width="48" height="48" preserveAspectRatio="xMidYMid slice" mask={`url(#${maskId})`} />
                  </g>
                  <rect className="save-ring-stop" x="19" y="19" width="10" height="10" rx="2" />
                  <path className="save-ring-play" d="M20.5 18.2v11.6l9-5.8z" />
                  <circle className="save-ring-scrim" cx="24" cy="24" r="24" />
                  <path className="save-ring-check" d="M16 24.6l5.4 5.4L32.4 19" pathLength="1" />
                </svg>
              </button>
              <p className="save-ring-status" aria-live="polite">
                {phase === "idle" ? (
                  <span>
                    <Roll text={mb(TOTAL)} /> MB
                  </span>
                ) : phase === "saved" || phase === "filling" ? (
                  <span>On this device</span>
                ) : (
                  <span>
                    <Roll text={mb(loaded)} /> of {mb(TOTAL)} MB
                  </span>
                )}
                <span className="save-ring-sub">
                  {phase === "idle"
                    ? "Ready to download"
                    : phase === "cancelling"
                      ? "Cancelling…"
                      : phase === "loading"
                        ? `Song ${activeIndex + 1} of ${TRACKS.length}`
                        : `${TRACKS.length} songs, ${mb(TOTAL)} MB`}
                </span>
              </p>
            </div>
          </div>
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
      </section>
    </Root>
  );
}
