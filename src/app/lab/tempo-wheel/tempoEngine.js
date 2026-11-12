import { MAX, MIN, START, bearingAt, leadAt, wheelPositions } from "./tempoMath";
import { createAudio } from "./tempoAudio";

// One value, v, in beats per minute, drives everything: the ruler, the
// counter wheels and the metronome. Input writes v straight through refs on
// the next frame, never through React, so the ruler stays under the finger.
//
// Modes: drag (v follows the pointer), wheel (v chases an accumulated wheel
// target), coast (momentum bleeding off), settle (a critically damped
// spring into the nearest whole-number detent).

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const BAND = 7; // how far past either end the ruler can be pulled, in units
const rubber = (over) => BAND * (1 - 1 / (over / BAND + 1));
const banded = (x) => (x < MIN ? MIN - rubber(MIN - x) : x > MAX ? MAX + rubber(x - MAX) : x);

const SPINE = 12; // the ruler's top line, in canvas px (on the 4px grid)
const MAJOR = 24; // a major tick's length below the spine
// The needle is the metronome's pallet. At rest it hangs from the spine to
// a major tick's length; on the beat it kicks to the ruler's full height
// and a heavier stroke, then bleeds back with the same decay as the click.
const NEEDLE = { rest: 2, beat: 3 };
const DECAY = 9; // per second
const FRICTION = 2.4; // per second, as a fling coasts
const STIFF = 260;
const DAMP = 2 * Math.sqrt(STIFF);

export function createTempo(root, { embedded, number, strips, ruler }) {
  const box = root.closest(".piece-box") || root;
  const ctx = ruler.getContext("2d");
  const audio = createAudio();
  const params = new URLSearchParams(window.location.search);
  const frozenV = params.has("v") ? parseFloat(params.get("v")) : null;
  const frozenBeat = params.has("beat") ? parseFloat(params.get("beat")) : null;

  let v = frozenV ?? START;
  let vel = 0;
  let mode = "rest";
  let target = START;
  let wheelTarget = START;
  let lastWheel = 0;
  let unit = 10; // px per bpm on the ruler
  let w = 1;
  let rh = 48;
  let dpr = 1;
  let leadW = 0; // the hundreds slot, in px
  let track = 0; // the tracking after it, in px
  let slots = [0, 0, 0, 1]; // left of each figure slot, and right of the last, in ruler px
  let dx = 0;
  let em = 16;
  // Where the ruler starts and ends, in ruler px: under the ink of the
  // outermost figures, whatever they are and wherever they roll.
  let edgeL = 0;
  let edgeR = 1;
  let drawnV = NaN;
  let drawnL = NaN;
  let drawnR = NaN;
  let pulse = 0; // 1 on the beat, decaying to 0
  let drawnPulse = NaN;
  let lastDetent = Math.round(v);
  let phase = 0;
  let scheduled = -1;
  let running = true;
  let raf = 0;
  let lastT = 0;
  let destroyed = false;

  // Drag state.
  let dragId = null;
  let dragX0 = 0;
  let dragV0 = 0;
  let dragMoved = false;
  let lastX = 0;
  let lastMoveT = 0;
  let dragVel = 0;

  const resize = () => {
    // The numeral's size is fluid CSS (see --text-tempo); the ruler is
    // stretched to the numeral's measure, so read both back from layout.
    w = Math.max(1, Math.round(ruler.getBoundingClientRect().width));
    rh = Math.round(ruler.getBoundingClientRect().height) || 48;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    ruler.width = Math.round(w * dpr);
    ruler.height = Math.round(rh * dpr);
    unit = clamp(Math.round(w / 110), 8, 12);
    const lead = strips[0].parentElement;
    em = parseFloat(getComputedStyle(number).fontSize) || 16;
    leadW = lead.getBoundingClientRect().width;
    track = parseFloat(getComputedStyle(lead).marginRight || "0");
    const x0 = ruler.getBoundingClientRect().left + dx;
    const rects = strips.map((s) => s.parentElement.getBoundingClientRect());
    slots = [...rects.map((r) => r.left - x0), rects[2].right - x0];
    drawnV = NaN;
    wake();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(box);

  // ---------- render ----------
  const renderNumber = () => {
    const p = wheelPositions(v);
    strips[0].style.setProperty("--tempo-roll", String(p.h));
    strips[1].style.setProperty("--tempo-roll", String(p.t));
    strips[2].style.setProperty("--tempo-roll", String(p.o));
    // The number slides by half the lead slot's spare width, so the figures
    // stay centred whether it holds a 1, a wider 2 or 3, or nothing.
    const lead = leadAt(p.h, em, leadW, track);
    dx = -lead.spare / 2;
    number.style.transform = `translate3d(${dx}px, 0, 0)`;
    // Left edge: the hundreds figure, handing over to the tens figure as
    // the hundreds slot empties and the number slides to centre.
    const hl = slots[0] + lead.ink;
    const tl = slots[1] + bearingAt(p.t, (k) => k % 10) * em;
    edgeL = hl + (tl - hl) * p.shift + dx;
    edgeR = slots[3] - bearingAt(p.o, (k) => k % 10) * em + dx;
  };

  const renderRuler = () => {
    // The ruler is the numeral's underline: it ends hard under the ink of
    // the first and last figure, with no fade of its own.
    const L = Math.round(edgeL);
    const R = Math.round(edgeR);
    const P = Math.round(pulse * 256) / 256;
    if (v === drawnV && L === drawnL && R === drawnR && P === drawnPulse) return;
    drawnPulse = P;
    drawnV = v;
    drawnL = L;
    drawnR = R;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, rh);
    const cx = Math.round(w / 2);
    const span = Math.ceil(Math.max(cx - L, R - cx) / unit) + 1;
    const first = Math.max(MIN, Math.floor(v) - span);
    const last = Math.min(MAX, Math.ceil(v) + span);
    const top = SPINE;
    const lw = 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(L, 0, R - L, rh);
    ctx.clip();
    for (let i = first; i <= last; i += 1) {
      const x = Math.round(cx + (i - v) * unit);
      if (x < L || x >= R) continue;
      const major = i % 10 === 0;
      const mid = !major && i % 5 === 0;
      const len = major ? MAJOR : mid ? 16 : 12;
      // Ticks right under the mark lift a little, like a loupe.
      const near = Math.exp(-Math.pow((x - cx) / (unit * 2.5), 2));
      const a = Math.min(1, (major ? 0.7 : mid ? 0.46 : 0.3) + near * 0.22);
      ctx.fillStyle = `rgba(242, 240, 235, ${a})`;
      ctx.fillRect(x, top, lw, len);
    }
    ctx.restore();
    // The spine: one full-strength hairline from edge to edge, so the
    // underline has a measure even where the ticks fall between pixels.
    ctx.fillStyle = "rgb(242, 240, 235)";
    ctx.fillRect(L, top, R - L, 1);
    // The centre mark, which is also the beat. It never leaves the ruler:
    // at rest it hangs from the spine like a heavy major tick; on the beat
    // it spans the whole strip, above the spine and below the ticks.
    // Snapped to device pixels, so the stroke stays a hard bar of ink
    // instead of a grey fringe while it thins back down.
    const snap = (x) => Math.round(x * dpr) / dpr;
    const nw = snap(NEEDLE.rest + (NEEDLE.beat - NEEDLE.rest) * P);
    const x0 = snap(cx - nw / 2);
    const y0 = snap(top * (1 - P));
    const y1 = snap(top + MAJOR + (rh - top - MAJOR) * P);
    ctx.fillRect(x0, y0, nw, y1 - y0);
  };

  // ---------- input ----------
  const arm = () => {
    if (!audio.unlocked) audio.unlock();
  };

  const toSettle = () => {
    target = clamp(Math.round(v + vel * 0.05), MIN, MAX);
    mode = "settle";
    wake();
  };

  const local = (e) => e.clientX - ruler.getBoundingClientRect().left;

  const onDown = (e) => {
    if (dragId != null || e.button > 0) return;
    arm();
    root.focus({ preventScroll: true });
    dragId = e.pointerId;
    root.setPointerCapture?.(e.pointerId);
    dragX0 = local(e);
    lastX = dragX0;
    lastMoveT = performance.now();
    dragV0 = v; // catch it where it is, mid flight
    dragMoved = false;
    dragVel = 0;
    vel = 0;
    mode = "drag";
    wake();
  };
  const onMove = (e) => {
    if (e.pointerId !== dragId) return;
    const x = local(e);
    const now = performance.now();
    const dt = Math.max(1, now - lastMoveT);
    if (Math.abs(x - dragX0) > 3) dragMoved = true;
    const inst = (-(x - lastX) / unit / dt) * 1000;
    dragVel += (inst - dragVel) * Math.min(1, dt / 40);
    lastX = x;
    lastMoveT = now;
    v = banded(dragV0 - (x - dragX0) / unit);
    wake();
  };
  const onUp = (e) => {
    if (e.pointerId !== dragId) return;
    dragId = null;
    if (!dragMoved) {
      // A tap: the first one only wakes the sound; after that it toggles.
      if (audio.tapped) running = !running;
      audio.tapped = true;
      toSettle();
      return;
    }
    audio.tapped = true;
    const idle = performance.now() - lastMoveT;
    vel = idle > 60 ? 0 : clamp(dragVel, -400, 400);
    mode = "coast";
    wake();
  };

  const onWheel = (e) => {
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.deltaMode === 1) {
      dx *= 16;
      dy *= 16;
    }
    // On the index page a vertical scroll belongs to the page.
    if (embedded && Math.abs(dy) > Math.abs(dx)) return;
    e.preventDefault();
    arm();
    const now = performance.now();
    if (mode !== "wheel") wheelTarget = v;
    const d = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    // A notched mouse wheel moves one detent per notch; a trackpad streams.
    const notch = e.deltaMode === 0 && dx === 0 && Math.abs(dy) >= 50 && Number.isInteger(dy);
    if (notch) wheelTarget = clamp(Math.round(wheelTarget) + Math.sign(d), MIN, MAX);
    else wheelTarget = clamp(wheelTarget + d / unit, MIN - BAND * 2, MAX + BAND * 2);
    lastWheel = now;
    mode = "wheel";
    wake();
  };

  const onKey = (e) => {
    const step = e.shiftKey ? 10 : 1;
    let next = null;
    const base = mode === "settle" || mode === "rest" ? target : Math.round(v);
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = base + step;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = base - step;
    else if (e.key === "PageUp") next = base + 10;
    else if (e.key === "PageDown") next = base - 10;
    else if (e.key === "Home") next = MIN;
    else if (e.key === "End") next = MAX;
    else if (e.key === " ") {
      e.preventDefault();
      arm();
      if (audio.tapped) running = !running;
      audio.tapped = true;
      return;
    }
    if (next == null) return;
    e.preventDefault();
    arm();
    audio.tapped = true;
    target = clamp(next, MIN, MAX);
    mode = "settle";
    wake();
  };

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  root.addEventListener("wheel", onWheel, { passive: false });
  root.addEventListener("keydown", onKey);

  // ---------- physics ----------
  const step = (dt) => {
    const prev = v;
    if (frozenV != null) return;
    if (mode === "drag") {
      vel = dragVel;
      if (performance.now() - lastMoveT > 50) dragVel *= Math.exp(-12 * dt);
    } else if (mode === "wheel") {
      const goal = banded(wheelTarget);
      const next = goal + (v - goal) * Math.exp(-26 * dt);
      vel = (next - v) / Math.max(dt, 1e-3);
      v = next;
      if (performance.now() - lastWheel > 140) {
        // The gesture is over: drop into the nearest detent, in bounds.
        wheelTarget = clamp(wheelTarget, MIN, MAX);
        vel *= 0.25;
        toSettle();
      }
    } else if (mode === "coast") {
      if (v < MIN || v > MAX) {
        target = clamp(Math.round(v), MIN, MAX);
        mode = "settle";
      } else {
        vel *= Math.exp(-FRICTION * dt);
        v += vel * dt;
        if (v < MIN || v > MAX) vel *= 0.35; // hit the end: most of it is absorbed
        if (Math.abs(vel) < 9) toSettle();
      }
    } else if (mode === "settle") {
      // Semi-implicit spring, sub-stepped for stability.
      const n = 4;
      const h = dt / n;
      for (let k = 0; k < n; k += 1) {
        vel += (STIFF * (target - v) - DAMP * vel) * h;
        v += vel * h;
      }
      if (Math.abs(target - v) < 0.002 && Math.abs(vel) < 0.05) {
        v = target;
        vel = 0;
        mode = "rest";
        root.setAttribute("aria-valuenow", String(target));
      }
    }
    const nearest = Math.round(v);
    if (nearest !== lastDetent && Math.abs(v - prev) > 0) {
      lastDetent = nearest;
      if (nearest >= MIN && nearest <= MAX) {
        audio.detent(Math.abs(vel));
        root.setAttribute("aria-valuenow", String(nearest));
      }
    }
  };

  // ---------- metronome ----------
  const beatTick = (dt) => {
    if (frozenBeat != null) {
      pulse = Math.exp(-frozenBeat * DECAY);
      return;
    }
    const bpm = clamp(Math.round(v), MIN, MAX);
    const rate = bpm / 60;
    if (!running) {
      pulse = 0;
      phase = 0.92;
      scheduled = Math.floor(phase);
      return;
    }
    phase += dt * rate;
    const idx = Math.floor(phase);
    // Look ahead and hand the next beat to the audio clock.
    const until = (idx + 1 - phase) / rate;
    if (until < 0.09 && scheduled < idx + 1) {
      scheduled = idx + 1;
      audio.beat(until);
    }
    const since = (phase - idx) / rate;
    pulse = Math.exp(-since * DECAY);
  };

  // ---------- loop ----------
  let visible = true;
  const frame = (t) => {
    raf = 0;
    if (destroyed || !visible) return;
    const dt = Math.min(1 / 20, lastT ? (t - lastT) / 1000 : 1 / 60);
    lastT = t;
    step(dt);
    renderNumber();
    beatTick(dt);
    renderRuler();
    raf = requestAnimationFrame(frame);
  };
  function wake() {
    if (!raf && visible && !destroyed) {
      lastT = 0;
      raf = requestAnimationFrame(frame);
    }
  }
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && !document.hidden;
    wake();
  });
  io.observe(box);
  const onVis = () => {
    visible = !document.hidden;
    wake();
  };
  document.addEventListener("visibilitychange", onVis);

  resize();
  if (document.fonts?.ready) document.fonts.ready.then(() => !destroyed && resize());

  return {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("keydown", onKey);
      audio.destroy();
    },
  };
}
