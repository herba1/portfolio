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

const easeOut = (t) => 1 - (1 - t) * (1 - t);

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

    // Optical metrics of one set word, read from the real font: where the
    // ink starts left of the origin, and how far the ascender sits below
    // the top of the CSS line box. Lets the block hang on its margins by
    // the ink, not by the sidebearing or the half-leading.
    const ink = (size, lineH) => {
      const cs = getComputedStyle(measure);
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) return { left: 0, top: 0, bottom: lineH };
      ctx.font = `${cs.fontWeight} ${size}px ${cs.fontFamily}`;
      if ("letterSpacing" in ctx) ctx.letterSpacing = cs.letterSpacing;
      const m = ctx.measureText(WORD);
      const asc = m.fontBoundingBoxAscent ?? size * 0.9;
      const desc = m.fontBoundingBoxDescent ?? size * 0.22;
      const baseline = (lineH - (asc + desc)) / 2 + asc;
      return {
        left: -(m.actualBoundingBoxLeft ?? 0),
        top: baseline - (m.actualBoundingBoxAscent ?? size * 0.75),
        bottom: baseline + (m.actualBoundingBoxDescent ?? 0),
      };
    };

    const layout = (snap) => {
      const r = box.getBoundingClientRect();
      g.W = r.width;
      g.H = r.height;
      g.dpr = window.devicePixelRatio || 1;
      // Set the way Gomringer set it: a dense block of text, not a grid of
      // labels. Lines on a ~1.04em pitch (whole 4px), one word space
      // (0.3em) between words, so each row reads "silence silence
      // silence" and the fourteen words knit into one grey texture that
      // the empty slot is punched out of.
      const setSize = (size) => {
        const rowPitch = round4(size * 1.04);
        const lineH = rowPitch;
        const ls = tracking(size);
        for (const el of [measure, ...els]) {
          if (!el) continue;
          el.style.fontSize = `${size}px`;
          el.style.lineHeight = `${lineH}px`;
          el.style.letterSpacing = ls;
        }
        const wordW = measure.getBoundingClientRect().width;
        const colPitch = Math.round(wordW + size * 0.3);
        return { size, lineH, wordW, rowPitch, colPitch };
      };
      // The block hangs on a left margin and runs across most of the
      // width. Vertically it is placed by its absence: the ink box of the
      // empty centre slot (row 2, middle column) sits on the page's
      // vertical centre, so the poem's silence is the poster's centre and
      // the white frames the block above and below in equal measure.
      const margin = round4(Math.max(16, Math.min(g.W, g.H) * 0.07));
      const blockW = (q) => q.wordW + (COLS - 1) * q.colPitch;
      const inkH = (q) => (ROWS - 1) * q.rowPitch + q.size * 0.76;
      const maxW = g.W - margin * 2;
      const maxH = g.H - margin * 2;
      const midRow = Math.floor(CENTRE / COLS);
      // y0 that centres the hole's ink on the page, on the 4px grid.
      const centred = (q, o) =>
        Math.round(
          (g.H / 2 - midRow * q.rowPitch - (o.top + o.bottom) / 2) / 4,
        ) * 4;
      // Does the centred block keep at least the side margin, top and
      // bottom, measured to the ink?
      const fits = (q, o, y0) =>
        blockW(q) <= maxW &&
        y0 + o.top >= margin &&
        y0 + (ROWS - 1) * q.rowPitch + o.bottom <= g.H - margin;
      let m = setSize(100);
      const fit = Math.min(maxW / blockW(m), maxH / inkH(m));
      m = setSize(Math.max(12, Math.floor(100 * fit)));
      let o = ink(m.size, m.lineH);
      let y0 = centred(m, o);
      while (m.size > 12 && !fits(m, o, y0)) {
        m = setSize(m.size - 1);
        o = ink(m.size, m.lineH);
        y0 = centred(m, o);
      }
      g.wordW = m.wordW;
      g.lineH = m.lineH;
      g.rowPitch = m.rowPitch;
      g.colPitch = m.colPitch;
      g.x0 = Math.round(margin - o.left);
      g.y0 = y0;
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
    // The whole page is the hit area: each slot owns its cell of the grid,
    // and the outer rows and columns run on to the edges of the page, so
    // any pointer position names a slot.
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const slotAt = (px, py) => {
      const lx = px - g.x0 + (g.colPitch - g.wordW) / 2;
      const ly = py - g.y0 + (g.rowPitch - g.lineH) / 2;
      const c = clamp(Math.floor(lx / g.colPitch), 0, COLS - 1);
      const r = clamp(Math.floor(ly / g.rowPitch), 0, ROWS - 1);
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

    // Still: the hole has taken one step up off the centre (7 -> 4), and
    // the word that stood above the centre is caught mid-slide down into
    // it, so the absence still sits in the middle of the poem.
    let stillSet = false;
    const paintStill = () => {
      if (!stillSet) {
        stillSet = true;
        const wi = occupant[4];
        occupant[CENTRE] = wi;
        occupant[4] = -1;
        words[wi].slot = CENTRE;
        hole = 4;
      }
      const moving = occupant[CENTRE];
      const a = slotPos(4);
      const e = easeOut(still);
      for (let i = 0; i < words.length; i++) {
        const w = words[i];
        const p = slotPos(w.slot);
        w.x = p.x;
        w.y = p.y;
        w.vx = w.vy = 0;
        if (i === moving) {
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
