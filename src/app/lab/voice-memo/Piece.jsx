"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { PITCH, RATE, bucketFor, buildBars, buildRuler, clock, createVoice, prerecord, short } from "./waveform";
import "./voice-memo.css";

const MAX_SECONDS = 60;
const MIN_KEEP = 1;
const LIVE_HEAD = 0.75;
const FIRST_SECONDS = 24.6;
const FIRST = prerecord(20261014, FIRST_SECONDS);
const FIRST_PLAYHEAD = 9.35;
const SUBSTEP = 1 / 240;
const RUBBER = 0.55;
const RUBBER_DIM = 48;
const MORPH = { k: (2 * Math.PI / 0.5) ** 2, c: (4 * Math.PI * 1) / 0.5 };
const HANDLE = { k: (2 * Math.PI / 0.32) ** 2, c: (4 * Math.PI * 0.9) / 0.32 };
const FIRST_META = { title: "Bridge, take 3", when: "Oct 14, 2026", duration: short(FIRST_SECONDS), take: 3 };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function rubber(px, dim) {
  const d = Math.abs(px);
  return Math.sign(px) * ((d * dim * RUBBER) / (dim + RUBBER * d));
}

function stepSpring(s, target, dt, { k, c }) {
  const steps = Math.max(1, Math.ceil(dt / SUBSTEP));
  const h = dt / steps;
  for (let i = 0; i < steps; i += 1) {
    const a = -k * (s.x - target) - c * s.v;
    s.v += a * h;
    s.x += s.v * h;
  }
}

function beginMorph(st, g0, g1, srcBucket) {
  st.srcBucket = srcBucket;
  st.dstBucket = bucketFor(g1 - g0, st.W);
  st.morphDist = Math.abs(st.w0.x - g0) + Math.abs(st.w1.x - g1);
  st.g0 = g0;
  st.g1 = g1;
  st.morphing = true;
  st.drawn = "";
}

function createState() {
  return {
    mode: "edit",
    samples: FIRST,
    count: FIRST.length,
    c0: 0,
    c1: FIRST_SECONDS,
    t0: 0,
    t1: FIRST_SECONDS,
    p: FIRST_PLAYHEAD,
    h0: { x: 0, v: 0 },
    h1: { x: FIRST_SECONDS, v: 0 },
    w0: { x: 0, v: 0 },
    w1: { x: FIRST_SECONDS, v: 0 },
    g0: 0,
    g1: FIRST_SECONDS,
    morphing: false,
    srcBucket: 0,
    dstBucket: 0,
    morphDist: 0,
    playing: false,
    resume: false,
    rec: 0,
    recStart: 0,
    voice: null,
    drag: null,
    W: 0,
    H: 0,
    dpr: 1,
    drawn: "",
    raf: 0,
    last: 0,
    reduced: false,
    kick: null,
    stop: null,
    bubble: "",
    timer: "",
  };
}

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 5.8v12.4c0 .8.8 1.2 1.5.8l9.6-6.2a.9.9 0 0 0 0-1.6L9.5 5c-.7-.4-1.5 0-1.5.8Z" />
  </svg>
);

const PauseIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="6.5" y="5" width="4" height="14" rx="1.2" />
    <rect x="13.5" y="5" width="4" height="14" rx="1.2" />
  </svg>
);

const SkipIcon = ({ forward }) => (
  <svg viewBox="0 0 28 28" aria-hidden="true" className={forward ? "vm-skip-fwd" : undefined}>
    <path d="M14 5.5a8.5 8.5 0 1 1-8.1 5.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M14 2.2v6.6L9.8 5.5Z" fill="currentColor" />
  </svg>
);

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const waveRef = useRef(null);
  const canvasRefs = useRef([]);
  const outerRefs = useRef([]);
  const innerRefs = useRef([]);
  const selRef = useRef(null);
  const headRef = useRef(null);
  const handleRefs = useRef([]);
  const bubbleRefs = useRef([]);
  const timerRef = useRef(null);
  const stateRef = useRef(null);
  if (stateRef.current === null) stateRef.current = createState();

  const [mode, setMode] = useState("edit");
  const [playing, setPlaying] = useState(false);
  const [canTrim, setCanTrim] = useState(false);
  const [meta, setMeta] = useState(FIRST_META);

  const syncTrim = useCallback(() => {
    const st = stateRef.current;
    setCanTrim(st.t0 - st.c0 > 0.01 || st.c1 - st.t1 > 0.01);
  }, []);

  const setPlay = useCallback((next) => {
    const st = stateRef.current;
    if (st.mode !== "edit") return;
    if (next && st.p >= st.t1 - 0.02) st.p = st.t0;
    st.playing = next;
    setPlaying(next);
    st.kick?.();
  }, []);

  const stopRecording = useCallback(() => {
    const st = stateRef.current;
    if (st.mode !== "live") return;
    const rec = Math.max(st.rec, st.count / RATE);
    st.mode = "edit";
    st.rec = rec;
    st.c0 = st.t0 = st.h0.x = 0;
    st.c1 = st.t1 = st.h1.x = st.p = rec;
    st.h0.v = st.h1.v = 0;
    st.w0.v = 1;
    st.w1.v = 1;
    beginMorph(st, 0, rec, 1 / RATE);
    st.drawn = "";
    setMode("edit");
    setCanTrim(false);
    setMeta((m) => ({ ...m, duration: short(rec) }));
    st.kick?.();
  }, []);

  useLayoutEffect(() => {
    const st = stateRef.current;
    const root = rootRef.current;
    const wave = waveRef.current;
    if (!root || !wave) return undefined;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    st.reduced = motion.matches;
    const css = getComputedStyle(root);
    const colors = ["--vm-bar-out", "--vm-bar-in", "--vm-bar-ink"].map((name) => css.getPropertyValue(name).trim());
    const tickColor = css.getPropertyValue("--vm-tick").trim();
    const canvases = canvasRefs.current;
    const ctxs = canvases.map((c) => c.getContext("2d"));

    const liveSpan = () => st.W / (PITCH * RATE);

    const draw = () => {
      const v0 = st.w0.x;
      const v1 = st.w1.x;
      const key = `${v0.toFixed(4)}|${v1.toFixed(4)}|${st.count}|${st.W}|${st.H}|${st.morphing}`;
      if (key === st.drawn) return;
      st.drawn = key;
      const layers = [];
      if (st.mode === "live") layers.push([1 / RATE, 1]);
      else if (st.morphing) {
        const left = Math.abs(v0 - st.g0) + Math.abs(v1 - st.g1);
        const prog = st.morphDist < 1e-6 ? 1 : clamp(1 - left / st.morphDist, 0, 1);
        if (prog < 1) layers.push([st.srcBucket, 1 - prog]);
        if (prog > 0) layers.push([st.dstBucket, prog]);
      } else layers.push([bucketFor(v1 - v0, st.W), 1]);
      const paths = layers.map(([bucket, alpha]) => [buildBars(st.samples, st.count, v0, v1, st.W, st.H, bucket), alpha]);
      const ruler = buildRuler(v0, v1, st.W, st.count / RATE);
      ctxs.forEach((ctx, i) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, canvases[i].width, canvases[i].height);
        ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
        ctx.fillStyle = colors[i];
        for (const [path, alpha] of paths) {
          ctx.globalAlpha = alpha;
          ctx.fill(path);
        }
        ctx.globalAlpha = 1;
        if (i === 0) {
          ctx.fillStyle = tickColor;
          ctx.fill(ruler);
        }
      });
    };

    const render = () => {
      draw();
      const v0 = st.w0.x;
      const span = Math.max(1e-6, st.w1.x - v0);
      const pps = st.W / span;
      const x0 = (st.h0.x - v0) * pps;
      const x1 = (st.h1.x - v0) * pps;
      const xp = (st.p - v0) * pps;
      const cx0 = clamp(x0, 0, st.W);
      const cx1 = clamp(x1, 0, st.W);
      const cxp = clamp(xp, 0, st.W);
      [cx1, cxp].forEach((edge, j) => {
        const end = Math.max(cx0, edge);
        outerRefs.current[j].style.transform = `translate3d(${cx0.toFixed(2)}px, 0, 0)`;
        innerRefs.current[j].style.transform = `translate3d(${(end - st.W - cx0).toFixed(2)}px, 0, 0)`;
        canvases[j + 1].style.transform = `translate3d(${(st.W - end).toFixed(2)}px, 0, 0)`;
      });
      if (st.mode !== "live") {
        handleRefs.current[0].style.transform = `translate3d(${x0.toFixed(2)}px, 0, 0)`;
        handleRefs.current[1].style.transform = `translate3d(${x1.toFixed(2)}px, 0, 0)`;
        selRef.current.style.transform = `translate3d(${x0.toFixed(2)}px, 0, 0) scaleX(${(Math.max(0, x1 - x0) / 100).toFixed(4)})`;
        bubbleRefs.current[0].style.translate = `${Math.max(0, -16 - x0).toFixed(2)}px 0`;
        bubbleRefs.current[1].style.translate = `${Math.min(0, st.W + 16 - x1).toFixed(2)}px 0`;
      }
      headRef.current.style.transform = `translate3d(${xp.toFixed(2)}px, 0, 0)`;
      const timer = clock(st.mode === "live" ? st.rec : st.p - st.c0);
      if (timer !== st.timer) {
        st.timer = timer;
        timerRef.current.textContent = timer;
      }
      if (st.drag && st.drag.kind !== "scrub") {
        const h = st.drag.kind === "h0" ? st.t0 : st.t1;
        const text = clock(h - st.c0);
        if (text !== st.bubble) {
          st.bubble = text;
          bubbleRefs.current[st.drag.kind === "h0" ? 0 : 1].textContent = text;
        }
      }
    };

    const settle = (s, target) => {
      if (Math.abs(s.x - target) < 0.0005 && Math.abs(s.v) < 0.005) {
        s.x = target;
        s.v = 0;
        return true;
      }
      return false;
    };

    const tick = (now) => {
      const dt = Math.min(0.064, Math.max(0, (now - st.last) / 1000));
      st.last = now;
      let busy = false;
      if (st.mode === "live") {
        st.rec = Math.min(MAX_SECONDS, (now - st.recStart) / 1000);
        const need = Math.min(st.samples.length, Math.floor(st.rec * RATE));
        while (st.count < need) {
          st.samples[st.count] = st.voice();
          st.count += 1;
        }
        st.c1 = st.t1 = st.p = st.h1.x = st.rec;
        const span = liveSpan();
        st.w0.x = st.rec - LIVE_HEAD * span;
        st.w1.x = st.w0.x + span;
        busy = true;
        if (st.rec >= MAX_SECONDS) st.stop?.();
      } else {
        if (st.playing) {
          st.p = Math.min(st.t1, st.p + dt);
          if (st.p >= st.t1) {
            st.playing = false;
            setPlaying(false);
          } else busy = true;
        }
        if (st.morphing) {
          if (st.reduced) {
            st.w0.x = st.g0;
            st.w1.x = st.g1;
          } else {
            stepSpring(st.w0, st.g0, dt, MORPH);
            stepSpring(st.w1, st.g1, dt, MORPH);
          }
          const doneStart = settle(st.w0, st.g0);
          const doneEnd = settle(st.w1, st.g1);
          if (doneStart && doneEnd) st.morphing = false;
          else busy = true;
        }
        const pairs = [
          [st.h0, st.t0, "h0"],
          [st.h1, st.t1, "h1"],
        ];
        for (const [h, target, kind] of pairs) {
          if (st.drag?.kind === kind) continue;
          if (st.reduced) {
            h.x = target;
            h.v = 0;
            continue;
          }
          stepSpring(h, target, dt, HANDLE);
          if (!settle(h, target)) busy = true;
        }
      }
      render();
      st.raf = busy ? requestAnimationFrame(tick) : 0;
    };

    const kick = () => {
      if (st.raf) return;
      st.last = performance.now();
      st.raf = requestAnimationFrame(tick);
    };

    const measure = () => {
      st.W = wave.clientWidth;
      st.H = wave.clientHeight;
      st.dpr = Math.min(2, window.devicePixelRatio || 1);
      canvases.forEach((c) => {
        c.width = Math.round(st.W * st.dpr);
        c.height = Math.round(st.H * st.dpr);
      });
      if (st.mode === "live") {
        const span = liveSpan();
        st.w0.x = st.rec - LIVE_HEAD * span;
        st.w1.x = st.w0.x + span;
      }
      st.drawn = "";
      render();
    };

    st.kick = kick;
    st.stop = stopRecording;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wave);

    const halt = () => {
      if (st.mode === "live") st.stop?.();
      if (st.playing) {
        st.playing = false;
        setPlaying(false);
      }
    };
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) halt();
    });
    io.observe(root);
    const onVisibility = () => {
      if (document.hidden) halt();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const onMotion = () => {
      st.reduced = motion.matches;
    };
    motion.addEventListener("change", onMotion);

    return () => {
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      motion.removeEventListener("change", onMotion);
      cancelAnimationFrame(st.raf);
      st.raf = 0;
      st.kick = null;
      st.stop = null;
    };
  }, [stopRecording]);


  const startRecording = () => {
    const st = stateRef.current;
    st.playing = false;
    setPlaying(false);
    st.drag = null;
    st.mode = "live";
    st.samples = new Float32Array(MAX_SECONDS * RATE + 2);
    st.count = 0;
    st.voice = createVoice(Math.floor(Math.random() * 1e9));
    st.rec = 0;
    st.recStart = performance.now();
    st.morphing = false;
    st.c0 = st.c1 = st.t0 = st.t1 = st.p = 0;
    st.h0 = { x: 0, v: 0 };
    st.h1 = { x: 0, v: 0 };
    st.drawn = "";
    const when = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    setMode("live");
    setCanTrim(false);
    setMeta((m) => ({ title: `Bridge, take ${m.take + 1}`, when: `Today, ${when}`, duration: "0:00", take: m.take + 1 }));
    st.kick?.();
  };

  const onRecord = () => {
    const st = stateRef.current;
    if (st.mode === "live") {
      if (st.rec >= MIN_KEEP) stopRecording();
      return;
    }
    startRecording();
  };

  const onTrim = () => {
    const st = stateRef.current;
    if (st.mode !== "edit") return;
    st.c0 = st.t0;
    st.c1 = st.t1;
    st.p = clamp(st.p, st.t0, st.t1);
    beginMorph(st, st.t0, st.t1, bucketFor(st.w1.x - st.w0.x, st.W));
    setCanTrim(false);
    setMeta((m) => ({ ...m, duration: short(st.t1 - st.t0) }));
    st.kick?.();
  };

  const onRevert = () => {
    const st = stateRef.current;
    if (st.mode !== "edit") return;
    st.t0 = st.c0;
    st.t1 = st.c1;
    setCanTrim(false);
    st.kick?.();
  };

  const skip = (delta) => {
    const st = stateRef.current;
    if (st.mode !== "edit") return;
    st.p = clamp(st.p + delta, st.t0, st.t1);
    st.kick?.();
  };

  const onPointerDown = (e) => {
    const st = stateRef.current;
    if (st.mode !== "edit" || e.button !== 0) return;
    const handle = e.target.closest?.(".vm-handle");
    const rect = waveRef.current.getBoundingClientRect();
    const pps = st.W / Math.max(1e-6, st.w1.x - st.w0.x);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (handle) {
      const kind = handle.dataset.side;
      const h = kind === "h0" ? st.h0 : st.h1;
      st.drag = { kind, id: e.pointerId, startX: e.clientX, startT: kind === "h0" ? st.t0 : st.t1, pps };
      h.v = 0;
      st.bubble = "";
      handle.dataset.active = "true";
      st.kick?.();
      return;
    }
    st.resume = st.playing;
    if (st.playing) {
      st.playing = false;
      setPlaying(false);
    }
    st.drag = { kind: "scrub", id: e.pointerId, rect, pps };
    st.p = clamp(st.w0.x + (e.clientX - rect.left) / pps, st.t0, st.t1);
    st.kick?.();
  };

  const onPointerMove = (e) => {
    const st = stateRef.current;
    const drag = st.drag;
    if (!drag || drag.id !== e.pointerId) return;
    if (drag.kind === "scrub") {
      st.p = clamp(st.w0.x + (e.clientX - drag.rect.left) / drag.pps, st.t0, st.t1);
      st.kick?.();
      return;
    }
    const raw = drag.startT + (e.clientX - drag.startX) / drag.pps;
    const lo = drag.kind === "h0" ? st.c0 : st.t0 + MIN_KEEP;
    const hi = drag.kind === "h0" ? st.t1 - MIN_KEEP : st.c1;
    const bounded = clamp(raw, lo, hi);
    const over = rubber((raw - bounded) * drag.pps, RUBBER_DIM) / drag.pps;
    if (drag.kind === "h0") {
      st.t0 = bounded;
      st.h0.x = bounded + over;
    } else {
      st.t1 = bounded;
      st.h1.x = bounded + over;
    }
    st.p = clamp(st.p, st.t0, st.t1);
    st.kick?.();
  };

  const endDrag = (e) => {
    const st = stateRef.current;
    const drag = st.drag;
    if (!drag || drag.id !== e.pointerId) return;
    st.drag = null;
    if (drag.kind === "scrub") {
      if (st.resume) setPlay(true);
      st.resume = false;
      return;
    }
    handleRefs.current[drag.kind === "h0" ? 0 : 1].dataset.active = "false";
    syncTrim();
    st.kick?.();
  };

  const onWaveKey = (e) => {
    const st = stateRef.current;
    if (st.mode !== "edit") return;
    const step = e.shiftKey ? 0.1 : 1;
    const keys = {
      ArrowRight: () => skip(step),
      ArrowLeft: () => skip(-step),
      Home: () => skip(-Infinity),
      End: () => skip(Infinity),
      " ": () => setPlay(!st.playing),
      k: () => setPlay(!st.playing),
    };
    if (!keys[e.key]) return;
    e.preventDefault();
    keys[e.key]();
  };

  const onHandleKey = (side) => (e) => {
    const st = stateRef.current;
    if (st.mode !== "edit") return;
    const step = e.shiftKey ? 0.1 : 0.5;
    const delta = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step }[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    if (side === "h0") st.t0 = clamp(st.t0 + delta, st.c0, st.t1 - MIN_KEEP);
    else st.t1 = clamp(st.t1 + delta, st.t0 + MIN_KEEP, st.c1);
    st.p = clamp(st.p, st.t0, st.t1);
    syncTrim();
    st.kick?.();
  };

  const live = mode === "live";
  const Title = embedded ? "h2" : "h1";

  return (
    <div ref={rootRef} className="vm" data-mode={mode} data-embedded={embedded ? "true" : "false"}>
      <div className="vm-phone">
        <header className="vm-header">
          <Title className="vm-title text-title-sm">{meta.title}</Title>
          <p className="vm-meta text-ui-lg">
            <span className="vm-rec-dot" aria-hidden="true" />
            <span className="vm-meta-when">{live ? "Recording" : meta.when}</span>
            {!live && (
              <>
                <span className="vm-meta-sep" aria-hidden="true">·</span>
                <span className="vm-meta-dur">{meta.duration}</span>
              </>
            )}
          </p>
        </header>

        <div className="vm-stage">
          <div
            ref={waveRef}
            className="vm-wave"
            role="slider"
            tabIndex={live ? -1 : 0}
            aria-label="Playhead"
            aria-valuemin={0}
            aria-valuemax={Math.round(FIRST_SECONDS)}
            aria-valuenow={0}
            aria-valuetext="Playhead position"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={endDrag}
            onKeyDown={onWaveKey}
          >
            <canvas
              ref={(el) => {
                canvasRefs.current[0] = el;
              }}
              className="vm-canvas"
            />
            {[1, 2].map((i) => (
              <span
                key={i}
                ref={(el) => {
                  outerRefs.current[i - 1] = el;
                }}
                className="vm-clip"
              >
                <span
                  ref={(el) => {
                    innerRefs.current[i - 1] = el;
                  }}
                  className="vm-clip"
                >
                  <canvas
                    ref={(el) => {
                      canvasRefs.current[i] = el;
                    }}
                    className="vm-canvas"
                  />
                </span>
              </span>
            ))}
            <span ref={selRef} className="vm-sel" aria-hidden="true" />
            <span ref={headRef} className="vm-head" aria-hidden="true" />
            {["h0", "h1"].map((side, i) => (
              <span
                key={side}
                ref={(el) => {
                  handleRefs.current[i] = el;
                }}
                className={`vm-handle vm-handle-${i === 0 ? "start" : "end"}`}
                data-side={side}
                data-active="false"
                role="slider"
                tabIndex={live ? -1 : 0}
                aria-label={i === 0 ? "Trim start" : "Trim end"}
                aria-valuemin={0}
                aria-valuemax={Math.round(FIRST_SECONDS)}
                aria-valuenow={0}
                onKeyDown={onHandleKey(side)}
              >
                <span className="vm-grip" />
                <span
                  ref={(el) => {
                    bubbleRefs.current[i] = el;
                  }}
                  className="vm-bubble font-mono text-ui-xs"
                />
              </span>
            ))}
          </div>
        </div>

        <p ref={timerRef} className="vm-timer font-mono text-title-lg">
          {clock(FIRST_PLAYHEAD)}
        </p>

        <div className="vm-transport">
          <button type="button" className="vm-skip" onClick={() => skip(-15)} disabled={live} aria-label="Back 15 seconds">
            <SkipIcon />
            <span className="vm-skip-n text-ui-2xs">15</span>
          </button>
          <button type="button" className="vm-play" data-playing={playing ? "true" : "false"} onClick={() => setPlay(!playing)} disabled={live} aria-label={playing ? "Pause" : "Play"}>
            <span className="vm-icon vm-icon-play">
              <PlayIcon />
            </span>
            <span className="vm-icon vm-icon-pause">
              <PauseIcon />
            </span>
          </button>
          <button type="button" className="vm-skip" onClick={() => skip(15)} disabled={live} aria-label="Forward 15 seconds">
            <SkipIcon forward />
            <span className="vm-skip-n text-ui-2xs">15</span>
          </button>
        </div>

        <div className="vm-foot">
          <button type="button" className="vm-text-btn text-ui-lg" onClick={onRevert} disabled={live || !canTrim}>
            Revert
          </button>
          <button type="button" className="vm-rec" onClick={onRecord} aria-label={live ? "Stop recording" : "Record"} aria-pressed={live}>
            <span className="vm-rec-core" />
          </button>
          <button type="button" className="vm-trim text-ui-lg" onClick={onTrim} disabled={live || !canTrim}>
            Trim
          </button>
        </div>
      </div>
    </div>
  );
}
