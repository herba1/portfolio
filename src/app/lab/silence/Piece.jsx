"use client";

import { useEffect, useRef, useState } from "react";

import "./silence.css";

// Gomringer's Silencio: five rows of three, fourteen words, the centre slot empty.
const COLS = 3;
const ROWS = 5;
const SLOTS = COLS * ROWS;
const CENTRE = 7;
const WORD = "silence";

const STEP_MS = 300; // the hole walks one slot at a time, slowly
const REST_MS = 1500; // pointer still this long: the silence goes home
const K = 90; // spring stiffness
const C = 2 * Math.sqrt(K) * 0.94; // just under critical: settles, never bounces

const round4 = (v) => Math.max(4, Math.round(v / 4) * 4);

// The house tracking law. Below 20px in px, from 20px in em.
const tracking = (size) => {
  const px = -0.043 * (size - 12);
  return size < 20 ? `${px.toFixed(2)}px` : `${(px / size).toFixed(4)}em`;
};

const readStill = () => {
  if (typeof window === "undefined") return null;
  const t = new URLSearchParams(window.location.search).get("t");
  if (t == null) return null;
  const v = Number(t);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null;
};

const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const measureRef = useRef(null);
  const wordRefs = useRef([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const measure = measureRef.current;
    if (!root || !measure) return undefined;
    const box = root.closest(".piece-box") || root;
    const els = wordRefs.current;
    const still = readStill();

    // Fourteen words, each with a slot and a spring body.
    const occupant = new Array(SLOTS).fill(-1);
    const words = [];
    for (let s = 0, w = 0; s < SLOTS; s++) {
      if (s === CENTRE) continue;
      occupant[s] = w;
      words.push({ slot: s, x: 0, y: 0, vx: 0, vy: 0 });
      w++;
    }
    let hole = CENTRE;
    let target = CENTRE;
    let lastStep = 0;
    let lastMove = -Infinity;
    let pointerSlot = -1;
    let inside = false;

    const g = {
      W: 0,
      H: 0,
      x0: 0,
      y0: 0,
      colPitch: 0,
      rowPitch: 0,
      wordW: 0,
      lineH: 0,
      dpr: 1,
    };

    const slotPos = (s) => ({
      x: g.x0 + (s % COLS) * g.colPitch,
      y: g.y0 + Math.floor(s / COLS) * g.rowPitch,
    });

    const layout = (snap) => {
      const r = box.getBoundingClientRect();
      g.W = r.width;
      g.H = r.height;
      g.dpr = window.devicePixelRatio || 1;
      const size = Math.round(
        Math.min(34, Math.max(15, Math.min(g.W * 0.024, g.H * 0.036))),
      );
      const lineH = round4(size * 1.25);
      const ls = tracking(size);
      for (const el of [measure, ...els]) {
        if (!el) continue;
        el.style.fontSize = `${size}px`;
        el.style.lineHeight = `${lineH}px`;
        el.style.letterSpacing = ls;
      }
      g.wordW = measure.getBoundingClientRect().width;
      g.lineH = lineH;
      // Even spacing: the gap between columns matches the gap between rows.
      g.rowPitch = round4(size * 1.75);
      const gap = g.rowPitch - size * 0.72; // row gap read from the x-height band
      g.colPitch = g.wordW + gap;
      const totalW = g.wordW + (COLS - 1) * g.colPitch;
      const totalH = (ROWS - 1) * g.rowPitch + lineH;
      g.x0 = Math.round((g.W - totalW) / 2);
      g.y0 = Math.round((g.H - totalH) / 2 / 4) * 4;
      if (snap) {
        for (const w of words) {
          const p = slotPos(w.slot);
          w.x = p.x;
          w.y = p.y;
          w.vx = w.vy = 0;
        }
      }
    };

    const paint = () => {
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const el = els[i];
        if (!el) continue;
        const resting = Math.abs(w.vx) + Math.abs(w.vy) < 0.5;
        const q = resting ? g.dpr : 8;
        el.style.transform = `translate(${Math.round(w.x * q) / q}px, ${Math.round(w.y * q) / q}px)`;
      }
    };

    // ---- room tone (only after a gesture) ----
    let audio = null;
    const startAudio = () => {
      if (audio) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const len = ctx.sampleRate * 3;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      // pink-ish noise (Paul Kellet's economy filter)
      let b0 = 0,
        b1 = 0,
        b2 = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        d[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
      }
      // crossfade the loop seam
      const fade = 2048;
      for (let i = 0; i < fade; i++) {
        const a = i / fade;
        d[i] = d[i] * a + d[len - fade + i] * (1 - a);
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopEnd = (len - fade) / ctx.sampleRate;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 140;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2400;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(hp).connect(lp).connect(gain).connect(ctx.destination);
      src.start();
      audio = { ctx, gain, level: -1 };
    };
    const setTone = (on) => {
      if (!audio) return;
      const level = on ? 0.018 : 0;
      if (audio.level === level) return;
      audio.level = level;
      const t = audio.ctx.currentTime;
      const p = audio.gain.gain;
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(level, t + (on ? 1.2 : 0.35));
    };

    // ---- pointer ----
    const slotAt = (px, py) => {
      const padX = (g.colPitch - g.wordW) / 2;
      const padY = (g.rowPitch - g.lineH) / 2;
      const lx = px - g.x0 + padX;
      const ly = py - g.y0 + padY;
      if (lx < 0 || ly < 0) return -1;
      const c = Math.floor(lx / g.colPitch);
      const r = Math.floor(ly / g.rowPitch);
      if (c >= COLS || r >= ROWS) return -1;
      return r * COLS + c;
    };
    const onMove = (e) => {
      const r = box.getBoundingClientRect();
      const s = slotAt(e.clientX - r.left, e.clientY - r.top);
      inside = true;
      if (s !== pointerSlot || e.movementX || e.movementY)
        lastMove = performance.now();
      pointerSlot = s;
    };
    const onLeave = () => {
      inside = false;
      pointerSlot = -1;
    };
    const onDown = (e) => {
      startAudio();
      if (audio?.ctx.state === "suspended") audio.ctx.resume();
      onMove(e);
    };

    // ---- the hole walks, a word fills the slot it leaves ----
    const step = () => {
      const hr = Math.floor(hole / COLS);
      const hc = hole % COLS;
      const tr = Math.floor(target / COLS);
      const tc = target % COLS;
      const dr = tr - hr;
      const dc = tc - hc;
      if (!dr && !dc) return;
      const n =
        Math.abs(dc) >= Math.abs(dr) && dc
          ? hole + Math.sign(dc)
          : hole + Math.sign(dr) * COLS;
      const wi = occupant[n];
      occupant[hole] = wi;
      occupant[n] = -1;
      words[wi].slot = hole;
      hole = n;
    };

    layout(true);

    let raf = 0;
    let prev = performance.now();
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;

      const resting = !inside || pointerSlot < 0 || now - lastMove > REST_MS;
      target = resting ? CENTRE : pointerSlot;
      if (hole !== target && now - lastStep > STEP_MS) {
        step();
        lastStep = now;
      }
      setTone(!(inside && pointerSlot >= 0 && pointerSlot === hole));

      const sub = 4;
      const h = dt / sub;
      for (const w of words) {
        const p = slotPos(w.slot);
        for (let i = 0; i < sub; i++) {
          w.vx += (K * (p.x - w.x) - C * w.vx) * h;
          w.vy += (K * (p.y - w.y) - C * w.vy) * h;
          w.x += w.vx * h;
          w.y += w.vy * h;
        }
        if (Math.abs(p.x - w.x) < 0.01 && Math.abs(w.vx) < 0.01) {
          w.x = p.x;
          w.vx = 0;
        }
        if (Math.abs(p.y - w.y) < 0.01 && Math.abs(w.vy) < 0.01) {
          w.y = p.y;
          w.vy = 0;
        }
      }
      paint();
    };

    // Still: the hole has stepped up from the centre, and the next word
    // is caught mid-slide into it.
    let stillSet = false;
    const paintStill = () => {
      if (!stillSet) {
        stillSet = true;
        // The hole has walked 7 -> 4 -> 3 -> 0: the top-left word is
        // caught sliding down into slot 3, at t.
        for (const [from, to] of [
          [4, 7],
          [3, 4],
          [0, 3],
        ]) {
          const wi = occupant[from];
          occupant[to] = wi;
          occupant[from] = -1;
          words[wi].slot = to;
        }
        hole = 0;
      }
      const moving = occupant[3];
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const p = slotPos(w.slot);
        w.x = p.x;
        w.y = p.y;
        if (i === moving) {
          const a = slotPos(0);
          const e = easeOut(still);
          w.y = a.y + (p.y - a.y) * e;
          w.vy = 1;
        }
      }
      paint();
    };

    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      layout(true);
      if (still != null) {
        paintStill();
      } else {
        paint();
        raf = requestAnimationFrame(frame);
        box.addEventListener("pointermove", onMove);
        box.addEventListener("pointerdown", onDown);
        box.addEventListener("pointerleave", onLeave);
      }
      setReady(true);
    };

    const ro = new ResizeObserver(() => {
      if (!started) return;
      layout(true);
      if (still != null) {
        // rebuild the still from scratch
        paintStill();
      } else paint();
    });
    ro.observe(box);

    let cancelled = false;
    (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (!cancelled) start();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      box.removeEventListener("pointermove", onMove);
      box.removeEventListener("pointerdown", onDown);
      box.removeEventListener("pointerleave", onLeave);
      audio?.ctx.close();
    };
  }, []);

  const Root = embedded ? "div" : "main";
  return (
    <Root
      ref={rootRef}
      className="silence"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
    >
      <p className="silence-sr">
        silence, fourteen times, and in the middle, silence
      </p>
      <span ref={measureRef} className="silence-measure" aria-hidden="true">
        {WORD}
      </span>
      {Array.from({ length: SLOTS - 1 }, (_, i) => (
        <span
          key={i}
          ref={(el) => (wordRefs.current[i] = el)}
          className="silence-word"
          aria-hidden="true"
        >
          {WORD}
        </span>
      ))}
    </Root>
  );
}
