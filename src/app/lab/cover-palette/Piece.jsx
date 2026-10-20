"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";

import { NEUTRAL, ROLES, extractPalette, paint, themeFrom } from "./palette";
import { createMosaic } from "./mosaic";
import { queueFrom } from "./queue";
import "./cover-palette.css";

const ROWS = 3;

const clock = (s) => {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const wrap = (d, n) => {
  let v = ((d % n) + n) % n;
  if (v > n / 2) v -= n;
  return v;
};

function rowOf(i, a, b, n) {
  const d = (((b - a) % n) + n) % n;
  const p = (((i - a) % n) + n) % n;
  if (d > 0 && d <= n / 2 && p < d) return clamp(p - 1 - d, -ROWS - 1, ROWS * 2);
  return clamp(((((i - b) % n) + n) % n) - 1, -ROWS - 1, ROWS * 2);
}

function Icon({ d, size = 20 }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true">
      <path d={d} fill="currentColor" />
    </svg>
  );
}

const PREV = "M5 4.5h1.6v11H5zM16 5.1v9.8a.6.6 0 0 1-.92.5L8.2 10.5a.6.6 0 0 1 0-1l6.88-4.9a.6.6 0 0 1 .92.5Z";
const NEXT = "M15 4.5h-1.6v11H15zM4 5.1v9.8a.6.6 0 0 0 .92.5l6.88-4.9a.6.6 0 0 0 0-1L4.92 4.6a.6.6 0 0 0-.92.5Z";
const PLAY = "M6 3.9v12.2a.7.7 0 0 0 1.06.6l10.1-6.1a.7.7 0 0 0 0-1.2L7.06 3.3A.7.7 0 0 0 6 3.9Z";
const PAUSE = "M5.5 3.5h3v13h-3zM11.5 3.5h3v13h-3z";

function Heart({ on }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M10 16.6s-6.6-3.9-6.6-8.5a3.5 3.5 0 0 1 6.6-1.5 3.5 3.5 0 0 1 6.6 1.5c0 4.6-6.6 8.5-6.6 8.5Z" />
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const { tracks } = useTopSongs(50);
  const queue = useMemo(() => queueFrom(tracks), [tracks]);
  const n = queue.length;
  const rootRef = useRef(null);
  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const mosaicRef = useRef(null);
  const imagesRef = useRef(new Map());
  const atIdRef = useRef(null);
  const sliderRef = useRef(null);
  const elapsedRef = useRef(null);
  const leftRef = useRef(null);
  const posRef = useRef(0);
  const huesRef = useRef({});
  const stepRef = useRef(() => {});
  const dragRef = useRef(null);
  const [nav, setNav] = useState({ queue: null, at: 0, from: 0, before: 0 });
  const [themes, setThemes] = useState({});
  const [playing, setPlaying] = useState(false);
  const [liked, setLiked] = useState({});

  const at = nav.queue === queue ? nav.at : 0;
  const from = nav.queue === queue ? nav.from : 0;
  const before = nav.queue === queue ? nav.before : 0;
  const item = queue[at];
  const theme = themes[item.id];

  useEffect(() => {
    let alive = true;
    for (const q of queue) {
      const img = new Image();
      if (q.remote) img.crossOrigin = "anonymous";
      img.decoding = "async";
      const done = (t) => alive && setThemes((m) => (m[q.id] ? m : { ...m, [q.id]: t }));
      img.onload = () => {
        if (!alive) return;
        imagesRef.current.set(q.id, img);
        if (atIdRef.current === q.id) mosaicRef.current?.show(img);
        let t = NEUTRAL;
        try {
          t = themeFrom(extractPalette(img));
        } catch {
          t = NEUTRAL;
        }
        done(t);
      };
      img.onerror = () => done(NEUTRAL);
      img.src = q.cover;
    }
    return () => {
      alive = false;
    };
  }, [queue]);

  const paintTime = () => {
    const slider = sliderRef.current;
    if (!slider) return;
    const len = item.length;
    const pos = clamp(posRef.current, 0, len);
    slider.style.setProperty("--cp-p", String(pos / len));
    slider.setAttribute("aria-valuenow", String(Math.round(pos)));
    slider.setAttribute("aria-valuetext", `${clock(pos)} of ${clock(len)}`);
    if (elapsedRef.current) elapsedRef.current.textContent = clock(pos);
    if (leftRef.current) leftRef.current.textContent = `-${clock(len - pos)}`;
  };

  const go = (to) => {
    if (n < 2) return;
    const next = ((to % n) + n) % n;
    if (next === at) return;
    posRef.current = 0;
    setNav({ queue, at: next, from: at, before: from });
  };

  const step = (d) => {
    if (d < 0 && posRef.current > 3) {
      posRef.current = 0;
      paintTime();
      return;
    }
    go(at + d);
  };

  useEffect(() => {
    stepRef.current = step;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return undefined;
    const mosaic = createMosaic(canvas);
    mosaicRef.current = mosaic;
    const fit = () => {
      const r = frame.getBoundingClientRect();
      mosaic.resize(frame.clientWidth || r.width, frame.clientHeight || r.height, Math.min(2, window.devicePixelRatio || 1));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(frame);
    return () => {
      ro.disconnect();
      mosaic.destroy();
      mosaicRef.current = null;
    };
  }, []);

  useEffect(() => {
    atIdRef.current = item.id;
    const img = imagesRef.current.get(item.id);
    if (img) mosaicRef.current?.show(img);
  }, [item.id]);

  useLayoutEffect(() => {
    paintTime();
  });

  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0;
    let last = performance.now();
    const tick = (now) => {
      if (!dragRef.current) posRef.current += (now - last) / 1000;
      last = now;
      if (posRef.current >= item.length) {
        posRef.current = item.length;
        stepRef.current(1);
        return;
      }
      paintTime();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !theme) return;
    const hues = huesRef.current;
    root.style.setProperty("--cp-g-bg", paint(theme.ground.bg));
    root.style.setProperty("--cp-g-a", paint(theme.ground.glows[0]));
    root.style.setProperty("--cp-g-b", paint(theme.ground.glows[1]));
    for (const role of ROLES) {
      const c = theme.roles[role];
      const prev = hues[role];
      let h = c.h;
      if (prev != null) h = c.C < 0.02 ? prev : prev + ((((c.h - prev) % 360) + 540) % 360) - 180;
      hues[role] = h;
      root.style.setProperty(`--cp-${role}-l`, c.L.toFixed(4));
      root.style.setProperty(`--cp-${role}-c`, c.C.toFixed(4));
      root.style.setProperty(`--cp-${role}-h`, h.toFixed(2));
    }
    root.dataset.tone = theme.dark ? "dark" : "light";
    root.dataset.ready = "true";
  }, [theme]);

  const seekTo = (clientX) => {
    const r = sliderRef.current.getBoundingClientRect();
    posRef.current = clamp((clientX - r.left) / r.width, 0, 1) * item.length;
    paintTime();
  };

  const onSliderDown = (e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = e.pointerId;
    rootRef.current.dataset.seeking = "true";
    seekTo(e.clientX);
  };

  const onSliderMove = (e) => {
    if (dragRef.current !== e.pointerId) return;
    seekTo(e.clientX);
  };

  const onSliderUp = (e) => {
    if (dragRef.current !== e.pointerId) return;
    dragRef.current = null;
    rootRef.current.dataset.seeking = "false";
  };

  const onSliderKey = (e) => {
    const delta = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 30, PageDown: -30 }[e.key];
    if (e.key === "Home" || e.key === "End") posRef.current = e.key === "Home" ? 0 : item.length - 1;
    else if (delta) posRef.current = clamp(posRef.current + delta, 0, item.length - 1);
    else return;
    e.preventDefault();
    paintTime();
  };

  const onKeyDown = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const onControl = e.target.closest?.("button, [role='slider']");
    if (e.key === "MediaPlayPause" || (e.key === " " && !onControl)) {
      e.preventDefault();
      setPlaying((p) => !p);
    } else if (e.key === "MediaTrackNext" || (e.key === "ArrowRight" && !onControl)) {
      e.preventDefault();
      step(1);
    } else if (e.key === "MediaTrackPrevious" || (e.key === "ArrowLeft" && !onControl)) {
      e.preventDefault();
      step(-1);
    }
  };

  const slide = (i, lo, hi) => {
    const now = clamp(wrap(i - at, n), lo, hi);
    const was = clamp(wrap(i - from, n), lo, hi);
    return { now, snap: Math.abs(now - was) > (hi - lo) / 2 };
  };

  const isLiked = Boolean(liked[item.id]);

  return (
    <div ref={rootRef} className="cp" data-embedded={embedded ? "true" : "false"} data-ready="false" data-playing={playing ? "true" : "false"} onKeyDown={onKeyDown}>
      <div className="cp-ground" aria-hidden="true" />

      <div className="cp-scroll" data-scroll-contain>
        <div className="cp-layout">
          <div ref={frameRef} className="cp-frame">
            <canvas ref={canvasRef} className="cp-art" role="img" aria-label={`${item.album ?? item.title} cover`} />
          </div>

          <div className="cp-info">
            <p className="cp-from text-ui-lg">
              <span className="cp-bars" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              Playing from Top Songs
            </p>

            <div className="cp-head">
              <div className="cp-lines">
                <div className="cp-clip cp-clip-title">
                  {queue.map((q, i) => {
                    const s = slide(i, -1, 1);
                    return (
                      <h2 key={q.id} className="cp-title text-title-lg" aria-hidden={i === at ? undefined : true} data-snap={s.snap ? "true" : "false"} style={{ "--s": s.now }}>
                        {q.title}
                      </h2>
                    );
                  })}
                </div>
                <div className="cp-clip cp-clip-sub">
                  {queue.map((q, i) => {
                    const s = slide(i, -1, 1);
                    return (
                      <p key={q.id} className="cp-sub text-body" aria-hidden={i === at ? undefined : true} data-snap={s.snap ? "true" : "false"} style={{ "--s": s.now }}>
                        {q.album ? `${q.artist} · ${q.album}` : q.artist}
                      </p>
                    );
                  })}
                </div>
              </div>
              <button
                type="button"
                className="cp-like"
                aria-pressed={isLiked}
                aria-label={isLiked ? `Remove ${item.title} from Liked Songs` : `Add ${item.title} to Liked Songs`}
                onClick={() => setLiked((m) => ({ ...m, [item.id]: !m[item.id] }))}
              >
                <Heart on={isLiked} />
              </button>
            </div>

            <div className="cp-seek">
              <div
                ref={sliderRef}
                className="cp-slider"
                role="slider"
                tabIndex={0}
                aria-label="Position"
                aria-valuemin={0}
                aria-valuenow={0}
                aria-valuemax={item.length}
                onPointerDown={onSliderDown}
                onPointerMove={onSliderMove}
                onPointerUp={onSliderUp}
                onPointerCancel={onSliderUp}
                onKeyDown={onSliderKey}
              >
                <span className="cp-track" />
                <span className="cp-fill" />
                <span className="cp-knob" />
              </div>
              <div className="cp-times text-ui tabular-nums">
                <span ref={elapsedRef}>0:00</span>
                <span ref={leftRef}>-{clock(item.length)}</span>
              </div>
            </div>

            <div className="cp-transport">
              <button type="button" className="cp-skip" aria-label="Previous" onClick={() => step(-1)}>
                <Icon d={PREV} size={24} />
              </button>
              <button type="button" className="cp-play" aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying((p) => !p)}>
                <span className="cp-glyph" data-on={playing ? "false" : "true"}>
                  <Icon d={PLAY} size={28} />
                </span>
                <span className="cp-glyph" data-on={playing ? "true" : "false"}>
                  <Icon d={PAUSE} size={28} />
                </span>
              </button>
              <button type="button" className="cp-skip" aria-label="Next" onClick={() => step(1)}>
                <Icon d={NEXT} size={24} />
              </button>
            </div>

            <div className="cp-next">
              <p className="cp-next-label text-heading-sm">Up Next</p>
              <ol className="cp-rows">
                {queue.map((q, i) => {
                  const now = rowOf(i, from, at, n);
                  const was = rowOf(i, before, from, n);
                  const shown = now >= 0 && now < ROWS;
                  return (
                    <li key={q.id} className="cp-row-cell" data-snap={Math.abs(now - was) > ROWS ? "true" : "false"} style={{ "--s": now }}>
                      <button type="button" className="cp-row" tabIndex={shown ? 0 : -1} aria-hidden={shown ? undefined : true} onClick={() => go(i)}>
                        <img className="cp-row-art" src={q.cover} alt="" draggable={false} />
                        <span className="cp-row-text">
                          <span className="cp-row-title text-heading-sm">{q.title}</span>
                          <span className="cp-row-artist text-ui-lg">{q.artist}</span>
                        </span>
                        <span className="cp-row-len text-ui-lg tabular-nums">{clock(q.length)}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
