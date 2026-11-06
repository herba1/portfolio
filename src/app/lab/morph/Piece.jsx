"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";
import { BODY, FADE, flat, isFade, layout } from "./states";
import { squircle } from "./squircle";

import "./morph.css";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (s) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

// The fallback catalogue carries no lengths, so each title gets a stable one
// in a plausible range rather than a random one per visit.
function durationOf(title = "") {
  let h = 2166136261;
  for (let i = 0; i < title.length; i += 1) h = Math.imul(h ^ title.charCodeAt(i), 16777619);
  return 132 + ((h >>> 0) % 118);
}

function step(s, target, { k, zeta }, dt) {
  const c = 2 * Math.sqrt(k) * zeta;
  const a = -k * (s.x - target) - c * s.v;
  s.v += a * dt;
  s.x += s.v * dt;
}

// The default "came from" state for a held frame: ?s=expanded holds
// idle -> expanded, ?s=toast-idle holds the fold back, and so on.
const FROM = { expanded: "idle", idle: "expanded", toast: "idle" };
const HOLD_SPAN = 0.6; // ?t=1 is this many seconds into the morph

const TOAST_LEAD = 4.5; // seconds before the end the next track is announced
const TOAST_HOLD = 5600; // ms the toast stays up

// Mean of the most saturated quarter of an 8x8 thumbnail, lifted so it holds
// on black: a waveform tint drawn from the record, not a theme colour.
const tintCache = new Map();
function tintOf(src) {
  if (!tintCache.has(src))
    tintCache.set(
      src,
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            const c = document.createElement("canvas");
            c.width = c.height = 8;
            const g = c.getContext("2d", { willReadFrequently: true });
            g.drawImage(img, 0, 0, 8, 8);
            const d = g.getImageData(0, 0, 8, 8).data;
            const px = [];
            for (let i = 0; i < d.length; i += 4) {
              const r = d[i] / 255;
              const gg = d[i + 1] / 255;
              const b = d[i + 2] / 255;
              const mx = Math.max(r, gg, b);
              const mn = Math.min(r, gg, b);
              px.push({ r, g: gg, b, s: mx === 0 ? 0 : (mx - mn) / mx, l: (mx + mn) / 2 });
            }
            px.sort((p, q) => q.s - p.s);
            const top = px.slice(0, 16);
            let r = 0;
            let gg = 0;
            let b = 0;
            for (const p of top) {
              r += p.r;
              gg += p.g;
              b += p.b;
            }
            r /= top.length;
            gg /= top.length;
            b /= top.length;
            // to HSL, then hold lightness and saturation in a band that reads on black
            const mx = Math.max(r, gg, b);
            const mn = Math.min(r, gg, b);
            let h = 0;
            const l = (mx + mn) / 2;
            const dd = mx - mn;
            const s = dd === 0 ? 0 : dd / (1 - Math.abs(2 * l - 1));
            if (dd) {
              if (mx === r) h = ((gg - b) / dd) % 6;
              else if (mx === gg) h = (b - r) / dd + 2;
              else h = (r - gg) / dd + 4;
              h *= 60;
              if (h < 0) h += 360;
            }
            const S = s < 0.12 ? 0 : clamp(s * 1.2, 0.45, 0.85);
            const L = S === 0 ? 0.86 : clamp(l, 0.64, 0.74);
            resolve(`hsl(${Math.round(h)} ${Math.round(S * 100)}% ${Math.round(L * 100)}%)`);
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = src;
      }),
    );
  return tintCache.get(src);
}

// Cover art that never pops: a new image lands on top of the old one and
// arrives out of a slight blur and scale; the old one is dropped once covered.
function Art({ src }) {
  const [layers, setLayers] = useState(() => (src ? [{ src, id: 0 }] : []));
  const n = useRef(0);
  useEffect(() => {
    if (!src) return;
    setLayers((ls) => (ls.length && ls[ls.length - 1].src === src ? ls : [...ls.slice(-1), { src, id: (n.current += 1) }]));
    const t = setTimeout(() => setLayers((ls) => ls.slice(-1)), 520);
    return () => clearTimeout(t);
  }, [src]);
  return layers.map((l) => <img key={l.id} src={l.src} alt="" draggable={false} className="mp-art-img" data-fresh={l.id > 0 ? "" : undefined} />);
}

const Icon = {
  prev: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11.2 12 19.6 6.4c.6-.4 1.4 0 1.4.7v9.8c0 .7-.8 1.1-1.4.7L11.2 12Z" />
      <path d="M2.2 12 10.6 6.4c.6-.4 1.4 0 1.4.7v9.8c0 .7-.8 1.1-1.4.7L2.2 12Z" />
    </svg>
  ),
  next: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12.8 12 4.4 17.6c-.6.4-1.4 0-1.4-.7V7.1c0-.7.8-1.1 1.4-.7l8.4 5.6Z" />
      <path d="M21.8 12 13.4 17.6c-.6.4-1.4 0-1.4-.7V7.1c0-.7.8-1.1 1.4-.7l8.4 5.6Z" />
    </svg>
  ),
  play: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4.9c0-.8.9-1.3 1.6-.9l11.2 7.1c.6.4.6 1.4 0 1.8L8.6 20c-.7.4-1.6-.1-1.6-.9V4.9Z" />
    </svg>
  ),
  pause: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5.5" y="4" width="4.5" height="16" rx="1.4" />
      <rect x="14" y="4" width="4.5" height="16" rx="1.4" />
    </svg>
  ),
};

export default function Piece() {
  const { tracks } = useTopSongs(12);

  const rootRef = useRef(null);
  const anchorRef = useRef(null);
  const surfRef = useRef(null);
  const edgeRef = useRef(null);
  const artRef = useRef(null);
  const waveRef = useRef(null);
  const barRefs = useRef([]);
  const elapsedRef = useRef(null);
  const nextRef = useRef(null);
  const fillRef = useRef(null);

  const [mode, setMode] = useState("idle");
  const [idx, setIdx] = useState(0);
  const [toastIdx, setToastIdx] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [sec, setSec] = useState(0);
  const [hover, setHover] = useState(false);
  const [press, setPress] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [tint, setTint] = useState(null);

  const springs = useRef(null);
  const target = useRef(null);
  const live = useRef({ mode: "idle", idx: 0, playing: true, elapsed: 0, toasted: -1, toastEnd: 0, frozen: false, box: { w: 0, h: 0 } });

  const count = tracks.length || 1;
  const track = tracks[idx % count];
  const toastTrack = tracks[toastIdx % count];
  const dur = durationOf(track?.title);
  const shown = mode === "toast" ? toastTrack : track;

  // ---- springs ---------------------------------------------------------

  const retarget = useCallback((m, opts) => {
    const t = flat(layout(m, opts));
    target.current = t;
    if (!springs.current) springs.current = Object.fromEntries(Object.entries(t).map(([k, x]) => [k, { x, v: 0 }]));
  }, []);

  useEffect(() => {
    live.current.mode = mode;
    if (live.current.frozen) return;
    retarget(mode, mode === "idle" ? { hover, press } : {});
  }, [mode, hover, press, retarget]);

  // ---- paint -------------------------------------------------------------

  const paint = useCallback((now) => {
    const S = springs.current;
    if (!S) return;
    const v = (k) => S[k].x;
    const W = Math.max(1, v("W"));
    const H = Math.max(1, v("H"));
    const R = Math.max(0, v("R"));
    const cx = W / 2;
    const surf = surfRef.current;
    if (surf) {
      const path = squircle(W, H, R);
      surf.style.width = `${W}px`;
      surf.style.height = `${H}px`;
      surf.style.transform = `translate3d(${-W / 2}px,0,0)`;
      surf.style.clipPath = `path("${path}")`;
      edgeRef.current?.setAttribute("d", path);
      edgeRef.current?.parentNode?.setAttribute("viewBox", `0 0 ${W} ${H}`);
    }
    const art = artRef.current;
    if (art) {
      const s = v("as");
      art.style.width = `${s}px`;
      art.style.height = `${s}px`;
      art.style.borderRadius = `${v("ar")}px`;
      art.style.transform = `translate3d(${cx + v("ax")}px,${v("ay")}px,0)`;
    }
    const fade = (o) => clamp(o, 0, 1) ** 2;
    // x, y is the top-left of the element at size s; it scales about its centre
    const shared = (el, x, y, o, w, h, s = 1) => {
      if (!el) return;
      const p = clamp(o, 0, 1);
      const k = s * (0.86 + 0.14 * p);
      el.style.transform = `translate3d(${cx + x + (w * s - w) / 2}px,${y + (h * s - h) / 2}px,0) scale(${k})`;
      el.style.opacity = fade(o);
      el.style.filter = p > 0.995 ? "none" : `blur(${(1 - p) * 6}px)`;
      el.style.pointerEvents = p > 0.5 ? "" : "none";
    };
    shared(waveRef.current, v("wx"), v("wy"), v("wo"), 22, 16);
    shared(elapsedRef.current, v("ex"), v("ey"), v("eo"), 32, 16);
    shared(nextRef.current, v("nx"), v("ny"), v("no"), 40, 40, v("ns") / 40);

    // State-only content: sits at its home address, and is revealed or
    // absorbed by the moving edge while it fades through a slight blur.
    // Arrivals wait for the first third of the fade, so the shared pieces have
    // mostly landed before new words appear under them; departures leave at once.
    const P = { idle: v("pi"), expanded: v("pe"), toast: v("pt") };
    const T = target.current || {};
    const IN = { idle: T.pi > 0.5, expanded: T.pe > 0.5, toast: T.pt > 0.5 };
    for (const el of surf ? surf.querySelectorAll(":scope > .mp-layer") : []) {
      const [state, x, y] = el.dataset.at.split(",");
      const p = clamp(P[state], 0, 1);
      el.style.transform = `translate3d(${cx + +x}px,${+y}px,0) scale(${0.92 + 0.08 * p})`;
      el.style.opacity = IN[state] ? clamp((p - 0.3) / 0.7, 0, 1) ** 2 : fade(p);
      el.style.filter = p > 0.995 ? "none" : `blur(${(1 - p) * 6}px)`;
      el.style.visibility = p < 0.002 ? "hidden" : "";
      el.style.pointerEvents = p > 0.6 ? "" : "none";
    }

    // waveform: a few bars riding a slow beat while playing, dots when paused
    const L = live.current;
    const amp = L.playing ? 1 : 0;
    L.amp = (L.amp ?? amp) + (amp - (L.amp ?? amp)) * 0.12;
    const t = L.frozen ? 2.15 : now / 1000;
    barRefs.current.forEach((bar, i) => {
      if (!bar) return;
      const n = 0.5 + 0.5 * Math.sin(t * (5.1 + i * 1.7) + i * 1.9) * Math.sin(t * (2.3 + i * 0.6) + i);
      const h = 4 + (12 * (0.25 + 0.75 * Math.abs(n))) * L.amp;
      bar.style.transform = `scaleY(${h / 16})`;
    });

    const fill = fillRef.current;
    if (fill) fill.style.transform = `scaleX(${clamp(L.elapsed / (L.dur || 1), 0, 1)})`;
  }, []);

  // ---- frame loop --------------------------------------------------------

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now) => {
      const L = live.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!L.frozen) {
        const S = springs.current;
        const T = target.current;
        if (S && T) {
          const n = Math.max(1, Math.ceil(dt / (1 / 240)));
          const h = dt / n;
          for (const k in T) for (let i = 0; i < n; i += 1) step(S[k], T[k], isFade(k) ? FADE : BODY, h);
        }
        if (L.playing && !L.scrubbing) L.elapsed += dt;
        if (L.elapsed >= L.dur) {
          L.elapsed = 0;
          L.idx += 1;
          setIdx(L.idx);
        }
        const rem = L.dur - L.elapsed;
        if (L.mode === "idle" && L.playing && rem <= TOAST_LEAD && L.toasted !== L.idx) {
          L.toasted = L.idx;
          L.toastEnd = now + TOAST_HOLD;
          setToastIdx(L.idx + 1);
          setMode("toast");
        }
        if (L.mode === "toast" && now >= L.toastEnd && !L.hoverToast) setMode("idle");
        const s = Math.floor(L.elapsed);
        if (s !== L.sec) {
          L.sec = s;
          setSec(s);
        }
      }
      paint(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [paint]);

  useEffect(() => {
    live.current.dur = dur;
  }, [dur]);

  useEffect(() => {
    live.current.playing = playing;
  }, [playing]);

  // ---- setup: hold frame, start position, box fit -------------------------

  useLayoutEffect(() => {
    const L = live.current;
    let held = null;
    try {
      const q = new URLSearchParams(window.location.search);
      const s = q.get("s");
      if (s) {
        const [a, b] = s.includes("-") ? s.split("-") : [FROM[s], s];
        if (FROM[a] && FROM[b]) held = { from: a, to: b, t: clamp(parseFloat(q.get("t") ?? "0.4") || 0, 0, 4) };
      }
    } catch {}

    L.dur = durationOf(tracks[0]?.title);
    if (held) {
      L.frozen = true;
      L.elapsed = 83;
      const from = flat(layout(held.from));
      const to = flat(layout(held.to));
      springs.current = Object.fromEntries(Object.entries(from).map(([k, x]) => [k, { x, v: 0 }]));
      target.current = to;
      const steps = Math.round(held.t * HOLD_SPAN * 240);
      for (let i = 0; i < steps; i += 1) for (const k in to) step(springs.current[k], to[k], isFade(k) ? FADE : BODY, 1 / 240);
      L.mode = held.to;
      // a held frame is read from the URL once, on mount
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMode(held.to);
      setSec(83);
    } else {
      // start near the end of the first record so the pill announces the
      // next one a few seconds in, without being asked
      L.elapsed = Math.max(0, L.dur - TOAST_LEAD - 2.5);
      L.sec = Math.floor(L.elapsed);
      setSec(L.sec);
      retarget("idle", {});
    }

    const root = rootRef.current;
    const box = root.closest(".piece-box") || root;
    const fit = () => {
      const w = box.clientWidth;
      const h = box.clientHeight;
      L.box = { w, h };
      const k = Math.min(1, (w - 32) / 368, (h - 32) / 192);
      const anchor = anchorRef.current;
      // the surface hangs from a fixed top edge, like the island does, set so
      // the open panel sits on the optical centre
      anchor.style.transform = `translate3d(0,${Math.round(h * 0.47 - 96 * k)}px,0) scale(${k})`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    paint(performance.now());
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // tint from the art on show
  useEffect(() => {
    let alive = true;
    if (shown?.image)
      tintOf(shown.image).then((c) => {
        if (alive && c) setTint(c);
      });
    return () => {
      alive = false;
    };
  }, [shown?.image]);

  // ---- actions -------------------------------------------------------------

  const go = useCallback((delta) => {
    const L = live.current;
    if (L.frozen) return;
    if (delta < 0 && L.elapsed > 3) {
      L.elapsed = 0;
    } else {
      L.idx = Math.max(0, L.idx + delta);
      L.elapsed = 0;
      setIdx(L.idx);
    }
    L.sec = 0;
    setSec(0);
  }, []);

  const open = () => {
    if (live.current.frozen) return;
    setMode("expanded");
  };
  const close = () => {
    if (live.current.frozen) return;
    setMode("idle");
  };

  const onSurfaceClick = () => {
    if (mode !== "expanded") open();
  };

  const onNext = (e) => {
    e.stopPropagation();
    if (live.current.frozen) return;
    if (mode === "toast") {
      const L = live.current;
      L.idx = toastIdx;
      L.elapsed = 0;
      setIdx(toastIdx);
      setSec(0);
      setMode("idle");
    } else go(1);
  };

  const onKey = (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Escape") close();
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (mode === "expanded") setPlaying((p) => !p);
      else open();
    }
  };

  useEffect(() => {
    const k = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  // scrubber
  const scrubRef = useRef(null);
  const seek = (e) => {
    const el = scrubRef.current;
    const r = el.getBoundingClientRect();
    const L = live.current;
    L.elapsed = clamp((e.clientX - r.left) / r.width, 0, 1) * (L.dur - 0.5);
    L.sec = Math.floor(L.elapsed);
    setSec(L.sec);
  };
  const onScrubDown = (e) => {
    e.stopPropagation();
    if (live.current.frozen) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    live.current.scrubbing = true;
    setScrubbing(true);
    seek(e);
  };
  const onScrubMove = (e) => {
    if (live.current.scrubbing) seek(e);
  };
  const onScrubUp = () => {
    live.current.scrubbing = false;
    setScrubbing(false);
  };

  const at = (state, x, y) => `${state},${x},${y}`;

  const upLabel = toastIdx === idx ? "Now playing" : "Up next";

  return (
    <div
      ref={rootRef}
      className="mp-root"
      data-mode={mode}
      onPointerDown={(e) => {
        if (mode === "expanded" && !surfRef.current?.contains(e.target)) close();
      }}
    >
      <div ref={anchorRef} className="mp-anchor">
        <div
          ref={surfRef}
          className="mp-surface"
          role="group"
          aria-label={track ? `Now playing: ${track.title}, ${track.artist}` : "Now playing"}
          tabIndex={0}
          style={tint ? { "--mp-tint": tint } : undefined}
          onClick={onSurfaceClick}
          onKeyDown={onKey}
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") setHover(true);
            live.current.hoverToast = true;
          }}
          onPointerLeave={() => {
            setHover(false);
            setPress(false);
            live.current.hoverToast = false;
          }}
          onPointerDown={() => mode === "idle" && setPress(true)}
          onPointerUp={() => setPress(false)}
        >
          <svg className="mp-edge" aria-hidden="true" preserveAspectRatio="none">
            <path ref={edgeRef} />
          </svg>

          {/* shared: art */}
          <div ref={artRef} className="mp-art">
            <Art src={shown?.imageLarge || shown?.image} />
          </div>

          {/* shared: waveform */}
          <div ref={waveRef} className="mp-wave" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <i key={i} ref={(el) => (barRefs.current[i] = el)} />
            ))}
          </div>

          {/* shared: elapsed */}
          <span ref={elapsedRef} className="mp-time mp-elapsed">
            {fmt(sec)}
          </span>

          {/* shared: next */}
          <button ref={nextRef} type="button" className="mp-btn mp-next" aria-label="Next" onClick={onNext}>
            <span className="mp-btn-face">{Icon.next}</span>
          </button>

          {/* expanded only */}
          <div data-at={at("expanded", -96, 28)} className="mp-layer mp-meta">
            <div className="mp-title">{track?.title}</div>
            <div className="mp-artist">{track?.artist}</div>
          </div>

          <div
            ref={scrubRef}
            data-at={at("expanded", -164, 88)}
            data-active={scrubbing ? "" : undefined}
            className="mp-layer mp-scrub"
            onPointerDown={onScrubDown}
            onPointerMove={onScrubMove}
            onPointerUp={onScrubUp}
            onPointerCancel={onScrubUp}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mp-track">
              <div ref={fillRef} className="mp-fill" />
            </div>
          </div>

          <span data-at={at("expanded", -164, 108)} className="mp-layer mp-time mp-pos">
            {fmt(sec)}
          </span>

          <span data-at={at("expanded", 164 - 96, 108)} className="mp-layer mp-time mp-remain">
            -{fmt(dur - sec)}
          </span>

          <button
            data-at={at("expanded", -84, 132)}
            type="button"
            className="mp-layer mp-btn"
            aria-label="Previous"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
          >
            <span className="mp-btn-face">{Icon.prev}</span>
          </button>

          <button
            data-at={at("expanded", -20, 132)}
            type="button"
            className="mp-layer mp-btn mp-play"
            aria-label={playing ? "Pause" : "Play"}
            data-playing={playing ? "" : undefined}
            onClick={(e) => {
              e.stopPropagation();
              if (!live.current.frozen) setPlaying((p) => !p);
            }}
          >
            <span className="mp-btn-face">
              <span className="mp-glyph mp-glyph-pause">{Icon.pause}</span>
              <span className="mp-glyph mp-glyph-play">{Icon.play}</span>
            </span>
          </button>

          {/* toast only */}
          <div data-at={at("toast", -96, 12)} className="mp-layer mp-up">
            <div key={upLabel} className="mp-up-label">
              {upLabel}
            </div>
            <div className="mp-up-title">{toastTrack?.title}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
