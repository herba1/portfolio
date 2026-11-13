"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { BODY, COLON_L, COLON_R, FADE, GAP_EM, LEAD_LSB, LEAD_OPT_R, OPT_L, OPT_R, PANEL, REMAIN_W, ROW, colonSpan, flat, isFade, layout, leadOf, trackPx } from "./states";
import { squircle } from "./squircle";
import { TRACKS } from "./records";
import Sleeve from "./Sleeve";

import "./morph.css";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (s) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const MINUS = "\u2212";

// The tracking law, tracking_px = -0.043 x (size_px - 12), for type whose
// size is a spring: written in em, so it holds at whatever size this frame is.
const trackEm = (size) => trackPx(size) / size;
const trackingFor = (size) => `${trackEm(size).toFixed(4)}em`;

// The clock is an odometer: every figure sits on a wheel of its own, a strip
// of tabular digits that rolls on its own spring to the place value of the
// time. Each wheel's target is unwrapped (seconds counts 0, 1, ... 83 ...),
// so a carry rolls the next wheel up exactly as far as it should, and lower
// places are stiffer, so a carry ripples left a beat after the units turn.
const WHEELS = {
  mt: { m: 10, place: 600, k: 220 },
  mu: { m: 10, place: 60, k: 260 },
  st: { m: 6, place: 10, k: 320 },
  su: { m: 10, place: 1, k: 420 },
};
const WHEEL_ZETA = 0.78;

// The clock hangs flush on the text column by its ink, not its box: it
// slides left by the lead figure's left side bearing (LEAD_LSB, in em so it
// holds as the clock grows). The colon is spaced optically, ink to ink: the
// figure before it and the seconds wheels keep their drums, and the colon's
// slot is set every frame from the optical edges of the figures either side
// of it, followed through a roll, so its two gaps stay equal as the wheels
// turn (see colonSpan in states.js).

// Every record carries its length; anything without one gets a stable length
// in a plausible range rather than a random one per visit.
function durationOf(track) {
  if (track?.dur) return track.dur;
  const title = track?.title || "";
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

// The sleeve never pops: a new record lands on top of the old one and
// arrives out of a slight blur and scale; the old one is dropped once covered.
function Art({ track }) {
  const id = track?.id;
  const [layers, setLayers] = useState(() => (track ? [{ track, id: 0 }] : []));
  const n = useRef(0);
  useEffect(() => {
    if (!track) return;
    setLayers((ls) => (ls.length && ls[ls.length - 1].track.id === track.id ? ls : [...ls.slice(-1), { track, id: (n.current += 1) }]));
    const t = setTimeout(() => setLayers((ls) => ls.slice(-1)), 520);
    return () => clearTimeout(t);
    // a record is its id: a fresh object for the same record is not a new sleeve
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return layers.map((l) => <Sleeve key={l.id} track={l.track} className="mp-art-img" data-fresh={l.id > 0 ? "" : undefined} />);
}

const Icon = {
  next: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12.8 12 4.4 17.6c-.6.4-1.4 0-1.4-.7V7.1c0-.7.8-1.1 1.4-.7l8.4 5.6Z" />
      <path d="M21.8 12 13.4 17.6c-.6.4-1.4 0-1.4-.7V7.1c0-.7.8-1.1 1.4-.7l8.4 5.6Z" />
    </svg>
  ),
};

export default function Piece() {
  const tracks = TRACKS;

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
  const ruleRef = useRef(null);
  const titleRef = useRef(null);
  const wheelRefs = useRef({});
  const colonRef = useRef(null);

  const [mode, setMode] = useState("idle");
  const [idx, setIdx] = useState(0);
  const [toastIdx, setToastIdx] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [sec, setSec] = useState(0);
  const [hover, setHover] = useState(false);
  const [press, setPress] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);

  const springs = useRef(null);
  const target = useRef(null);
  const live = useRef({ mode: "idle", idx: 0, playing: true, elapsed: 0, toasted: -1, toastEnd: 0, frozen: false, box: { w: 0, h: 0 } });

  const count = tracks.length || 1;
  const track = tracks[idx % count];
  const toastTrack = tracks[toastIdx % count];
  const dur = durationOf(track);
  const lead = leadOf(sec);
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
    retarget(mode, mode === "idle" ? { hover, press, lead } : { lead });
  }, [mode, hover, press, lead, retarget]);

  // ---- paint -------------------------------------------------------------

  const paint = useCallback((now) => {
    const S = springs.current;
    if (!S) return;
    const v = (k) => S[k].x;
    const W = Math.max(1, v("W"));
    const H = Math.max(1, v("H"));
    const R = Math.max(0, v("R"));
    const cx = W / 2;
    // the stage: the pill at its own scale, the open panel at the frame's,
    // zoomed between them on the edge's own spring, hanging from one top edge
    const F = live.current.fit;
    const anchor = anchorRef.current;
    if (F && anchor) {
      const z = F.rest + (F.open - F.rest) * v("z");
      anchor.style.transform = `translate3d(0,${F.top}px,0) scale(${z})`;
    }
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
      // the sleeve is the play button: it gives a little under the finger
      const Lp = live.current;
      Lp.ap = (Lp.ap ?? 0) + ((Lp.artDown ? 1 : 0) - (Lp.ap ?? 0)) * 0.3;
      const k = 1 - 0.035 * Lp.ap;
      art.style.transform = `translate3d(${cx + v("ax") + (s * (1 - k)) / 2}px,${v("ay") + (s * (1 - k)) / 2}px,0) scale(${k})`;
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
    // The waveform never travels or blurs: it folds. Its bars drop to dots in
    // place (the bar heights below follow the same channel), and only once
    // they are flat do the dots go out. Coming back, dots first, then bars.
    const wave = waveRef.current;
    const wo = clamp(v("wo"), 0, 1);
    if (wave) {
      wave.style.transform = `translate3d(${cx + v("wx")}px,${v("wy")}px,0)`;
      wave.style.opacity = clamp((wo - 0.2) / 0.25, 0, 1) ** 2;
    }
    // The clock is type that travels: its size is a spring channel and is set
    // as a real font size, with the tracking the law gives for that size, so
    // the figures are drawn, never stretched. It slides left by its own ink
    // bearing (in em, so it grows with it) to hang flush on the column.
    const clock = elapsedRef.current;
    const Lw = live.current;
    const size = v("es");
    // each wheel rolls its strip; `at` reads a per-digit metric at the
    // wheel's current, possibly mid-roll, position
    const pos = {};
    for (const key in WHEELS) {
      const el = wheelRefs.current[key];
      const w = Lw.wheels?.[key];
      if (!el || !w) continue;
      const { m } = WHEELS[key];
      pos[key] = ((w.x % m) + m) % m;
      el.style.transform = `translate3d(0,${-pos[key]}em,0)`;
    }
    const at = (table, key) => {
      const p = pos[key] ?? 0;
      const { m } = WHEELS[key];
      const i = Math.floor(p);
      const f = p - i;
      return table[i % m] * (1 - f) + table[(i + 1) % m] * f;
    };
    const two = Lw.elapsed >= 600;
    const lead = two ? "mt" : "mu";
    const bearing = at(LEAD_LSB, lead);
    const gap = GAP_EM + trackEm(size);
    const slot = (key, em) => {
      const el = wheelRefs.current[key]?.parentNode;
      if (el) el.style.width = em == null ? "" : `${em}em`;
    };
    // tens of minutes, from ten minutes up: the lead keeps the gap of "23" to
    // the minutes figure, drawn for a 2, so the minutes drum keeps its place
    if (two) slot("mt", at(LEAD_OPT_R, "mt") + gap - OPT_L[2]);
    // The colon between the figure before it and the seconds tens: its span
    // is fixed for the figure before it (the lead's own edge, or a 2 for a
    // tabular minutes drum), so the seconds keep their address, and the
    // colon's dots centre in what the span leaves, so the gap from the
    // stem to the dots always equals the gap from the dots to the bowl.
    const r = two ? at(OPT_R, "mu") : at(LEAD_OPT_R, "mu");
    const span = colonSpan(two ? OPT_R[2] : r, size);
    const g2 = (span + at(OPT_L, "st") - r - (COLON_R - COLON_L)) / 2;
    const colonAt = r + g2 - COLON_L;
    slot("mu", colonAt);
    if (colonRef.current) colonRef.current.style.width = `${span - colonAt}em`;
    slot("st", null);
    // the type column follows the lead figure: its left edge and measure
    const cl = v("cl");
    const cw = v("cw");
    for (const el of surf ? surf.querySelectorAll(":scope > [data-col]") : []) el.style.width = `${cw}px`;
    if (titleRef.current) titleRef.current.style.width = `${cw - REMAIN_W}px`;
    if (clock) {
      const o = v("eo");
      const p = clamp(o, 0, 1);
      const x = v("ex") - bearing * size;
      clock.style.fontSize = `${size}px`;
      clock.style.letterSpacing = trackingFor(size);
      clock.style.transform = `translate3d(${cx + x}px,${v("ey")}px,0)`;
      clock.style.opacity = fade(o);
      clock.style.filter = p > 0.995 ? "none" : `blur(${(1 - p) * 6}px)`;
    }
    shared(nextRef.current, v("nx"), v("ny"), v("no"), 40, 40, v("ns") / 40);

    // State-only content: sits at its home address, and is revealed or
    // absorbed by the moving edge while it fades through a slight blur.
    // Arrivals wait for the first third of the fade, so the shared pieces have
    // mostly landed before new words appear under them; departures leave at once.
    const P = { idle: v("pi"), expanded: v("pe"), toast: v("pt") };
    const T = target.current || {};
    const IN = { idle: T.pi > 0.5, expanded: T.pe > 0.5, toast: T.pt > 0.5 };
    // open, the figures are the scrubber: they take the pointer only once the
    // panel has mostly arrived
    if (clock) clock.style.pointerEvents = T.pe > 0.5 && P.expanded > 0.6 ? "auto" : "none";

    for (const el of surf ? surf.querySelectorAll(":scope > .mp-layer") : []) {
      const [state, ax, y] = el.dataset.at.split(",");
      const x = ax === "col" ? cl : +ax;
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
      const h = 4 + 12 * (0.25 + 0.75 * Math.abs(n)) * L.amp * clamp((wo - 0.45) / 0.55, 0, 1);
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
      // the odometer: each wheel springs to its place value of the time. A
      // jump of more than a turn is taken up silently, a whole turn at a
      // time, so a long seek still rolls, but never more than once round.
      const total = Math.floor(L.elapsed);
      L.wheels ??= {};
      const n = Math.max(1, Math.ceil(dt / (1 / 240)));
      for (const key in WHEELS) {
        const { m, place, k } = WHEELS[key];
        const T = Math.floor(total / place);
        const w = (L.wheels[key] ??= { x: T, v: 0 });
        const d = T - w.x;
        if (Math.abs(d) > m) w.x += m * Math.trunc(d / m);
        for (let i = 0; i < n; i += 1) step(w, T, { k, zeta: WHEEL_ZETA }, dt / n);
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

    L.dur = durationOf(tracks[0]);
    if (held) {
      L.frozen = true;
      L.elapsed = 83;
      const from = flat(layout(held.from, { lead: leadOf(83) }));
      const to = flat(layout(held.to, { lead: leadOf(83) }));
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
      retarget("idle", { lead: leadOf(L.elapsed) });
    }

    const root = rootRef.current;
    const box = root.closest(".piece-box") || root;
    const fit = () => {
      const w = box.clientWidth;
      const h = box.clientHeight;
      L.box = { w, h };
      // At rest the pill keeps its own size, only ever shrinking to fit. Open,
      // the panel owns the frame: it is scaled up until its widest form takes
      // 70% of the width, so the figures are set as a poster, not a widget.
      const rest = Math.min(1, (w - 32) / PANEL.W, (h - 32) / PANEL.H);
      const open = Math.max(rest, Math.min((w * 0.7) / PANEL.W, (w - 32) / PANEL.W, (h - 64) / PANEL.H));
      // the surface hangs from a fixed top edge, like the island does, set so
      // the open panel sits on the optical centre
      L.fit = { rest, open, top: Math.round(h * 0.47 - (PANEL.H / 2) * open) };
      paint(performance.now());
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    else if (mode === "expanded" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) onClockKey(e);
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

  // The figures are the scrubber. Drag them sideways and the time moves by
  // the distance along the rule under them, so the rule's played edge keeps
  // pace with the finger; press the rule itself and the time goes there.
  const drag = useRef(null);
  const seekTo = (t) => {
    const L = live.current;
    L.elapsed = clamp(t, 0, L.dur - 0.5);
    L.sec = Math.floor(L.elapsed);
    setSec(L.sec);
  };
  const scrubAt = (e) => {
    const d = drag.current;
    const L = live.current;
    seekTo(d.absolute ? ((e.clientX - d.left) / d.w) * L.dur : d.t0 + ((e.clientX - d.x0) / d.w) * L.dur);
  };
  const scrubDown = (e, absolute) => {
    e.stopPropagation();
    const L = live.current;
    if (L.frozen || L.mode !== "expanded" || e.button > 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = ruleRef.current.getBoundingClientRect();
    drag.current = { x0: e.clientX, t0: L.elapsed, w: r.width, left: r.left, absolute };
    L.scrubbing = true;
    setScrubbing(true);
    if (absolute) scrubAt(e);
  };
  const onClockDown = (e) => scrubDown(e, false);
  const onRuleDown = (e) => scrubDown(e, true);
  const scrubMove = (e) => {
    if (drag.current) scrubAt(e);
  };
  const scrubUp = () => {
    drag.current = null;
    live.current.scrubbing = false;
    setScrubbing(false);
  };
  const onClockKey = (e) => {
    if (live.current.frozen) return;
    const by = { ArrowLeft: -5, ArrowRight: 5, PageDown: -30, PageUp: 30 }[e.key];
    if (by) {
      e.preventDefault();
      seekTo(live.current.elapsed + by);
    } else if (e.key === "Home") {
      e.preventDefault();
      seekTo(0);
    }
  };

  // The sleeve is play and pause, once the panel is open.
  const artUp = () => {
    live.current.artDown = false;
  };
  const onArtClick = (e) => {
    if (mode !== "expanded") return;
    e.stopPropagation();
    if (!live.current.frozen) setPlaying((p) => !p);
  };

  const at = (state, x, y) => `${state},${x},${y}`;

  const upLabel = toastIdx === idx ? "Now playing" : "Up next";

  return (
    <div
      ref={rootRef}
      className="mp-root"
      data-mode={mode}
      data-paused={playing ? undefined : ""}
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
          // the waveform's tint is the record's own field, lifted to hold on black
          style={shown?.tint ? { "--mp-tint": shown.tint } : undefined}
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

          {/* shared: art, the pill's thumbnail and the open panel's sleeve,
              which, open, is also play and pause */}
          <div
            ref={artRef}
            className="mp-art"
            onClick={onArtClick}
            onPointerDown={() => {
              if (mode === "expanded") live.current.artDown = true;
            }}
            onPointerUp={artUp}
            onPointerLeave={artUp}
            onPointerCancel={artUp}
          >
            <Art track={shown} />
          </div>

          {/* shared: waveform */}
          <div ref={waveRef} className="mp-wave" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <i key={i} ref={(el) => (barRefs.current[i] = el)} />
            ))}
          </div>

          {/* shared: the clock, which carries the morph. Open, it is also the
              scrubber: drag the figures sideways to seek. */}
          <span
            ref={elapsedRef}
            className="mp-elapsed"
            role="slider"
            tabIndex={mode === "expanded" ? 0 : -1}
            aria-label="Position"
            aria-valuemin={0}
            aria-valuemax={dur}
            aria-valuenow={sec}
            aria-valuetext={`${fmt(sec)} of ${fmt(dur)}`}
            data-active={scrubbing ? "" : undefined}
            onPointerDown={onClockDown}
            onPointerMove={scrubMove}
            onPointerUp={scrubUp}
            onPointerCancel={scrubUp}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onClockKey}
          >
            <span className="mp-clock" aria-hidden="true">
              {(sec >= 600 ? ["mt", "mu", ":", "st", "su"] : ["mu", ":", "st", "su"]).map((key, k) =>
                key === ":" ? (
                  <span key={key} ref={colonRef} className="mp-colon">
                    :
                  </span>
                ) : (
                  <span key={key} className="mp-wheel">
                    <span ref={(el) => (wheelRefs.current[key] = el)} className="mp-strip">
                      {Array.from({ length: WHEELS[key].m + 1 }, (_, i) => (
                        // the lead wheel's 1 is the footless proportional one
                        <span key={i} className={k === 0 && i === 1 ? "mp-fig-1" : undefined}>
                          {i % WHEELS[key].m}
                        </span>
                      ))}
                    </span>
                  </span>
                ),
              )}
            </span>
          </span>

          {/* shared: next */}
          <button ref={nextRef} type="button" className="mp-btn mp-next" aria-label="Next" onClick={onNext}>
            <span className="mp-btn-face">{Icon.next}</span>
          </button>

          {/* expanded only: the rule a grid step under the figures' baseline,
              the title and artist under it, and the time left under the
              rule's far end, on the title's baseline. All of it hangs on the
              type column, which paint() sizes to the figures. */}
          <div
            ref={ruleRef}
            data-at={at("expanded", "col", ROW.rule - 8)}
            data-col=""
            className="mp-layer mp-rule"
            onPointerDown={onRuleDown}
            onPointerMove={scrubMove}
            onPointerUp={scrubUp}
            onPointerCancel={scrubUp}
            onClick={(e) => e.stopPropagation()}
            aria-hidden="true"
          >
            <div className="mp-rule-line">
              <div ref={fillRef} className="mp-rule-fill" />
            </div>
          </div>

          <div data-at={at("expanded", "col", ROW.title)} data-col="" className="mp-layer mp-meta">
            <div ref={titleRef} className="mp-title">
              {track?.title}
            </div>
            <div className="mp-artist">{track?.artist}</div>
          </div>

          <div data-at={at("expanded", "col", ROW.remain)} data-col="" className="mp-layer mp-time mp-remain">
            <span aria-label={`${fmt(dur - sec)} remaining`}>
              {MINUS}
              {fmt(dur - sec)}
            </span>
          </div>

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
