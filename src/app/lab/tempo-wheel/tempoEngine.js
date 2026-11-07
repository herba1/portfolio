import { MAX, MIN, START, wheelPositions } from "./tempoMath";
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

const FRICTION = 2.4; // per second, as a fling coasts
const STIFF = 260;
const DAMP = 2 * Math.sqrt(STIFF);

export function createTempo(root, { embedded, number, strips, ruler, dot }) {
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
  let colW = 0;
  let drawnV = NaN;
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
    const r = box.getBoundingClientRect();
    const size = Math.round(clamp(Math.min(r.height * 0.3, r.width * 0.26), 64, 224) / 16) * 16;
    root.style.setProperty("--tempo-size", `${size}px`);
    w = Math.max(1, Math.round(ruler.getBoundingClientRect().width));
    rh = Math.round(ruler.getBoundingClientRect().height) || 48;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    ruler.width = Math.round(w * dpr);
    ruler.height = Math.round(rh * dpr);
    unit = clamp(Math.round(w / 110), 8, 12);
    const wheel = strips[2].parentElement;
    colW = wheel.getBoundingClientRect().width + parseFloat(getComputedStyle(wheel.previousElementSibling).marginRight || "0");
    drawnV = NaN;
    wake();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(box);

  // ---------- render ----------
  const renderNumber = () => {
    const p = wheelPositions(v);
    strips[0].style.transform = `translate3d(0, ${-p.h}em, 0)`;
    strips[1].style.transform = `translate3d(0, ${-p.t}em, 0)`;
    strips[2].style.transform = `translate3d(0, ${-p.o}em, 0)`;
    number.style.transform = `translate3d(${(-p.shift * colW) / 2}px, 0, 0)`;
  };

  const renderRuler = () => {
    if (v === drawnV) return;
    drawnV = v;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, rh);
    const cx = Math.round(w / 2);
    const half = w / 2;
    const span = Math.ceil(half / unit) + 1;
    const first = Math.max(MIN, Math.floor(v) - span);
    const last = Math.min(MAX, Math.ceil(v) + span);
    const top = 12;
    const lw = 1;
    for (let i = first; i <= last; i += 1) {
      const x = cx + (i - v) * unit;
      const d = Math.abs(x - cx) / half;
      if (d > 1) continue;
      // Fall off toward the edges so the ruler has no ends of its own.
      const edge = Math.pow(Math.cos(d * Math.PI * 0.5), 2.4);
      const major = i % 10 === 0;
      const mid = !major && i % 5 === 0;
      const len = major ? 24 : mid ? 16 : 12;
      // Ticks right under the mark lift a little, like a loupe.
      const near = Math.exp(-Math.pow((x - cx) / (unit * 2.5), 2));
      const a = Math.min(1, (major ? 0.7 : mid ? 0.46 : 0.3) * edge + near * 0.22);
      ctx.fillStyle = `rgba(242, 240, 235, ${a})`;
      ctx.fillRect(x - lw / 2, top, lw, len);
    }
    // The centre mark: fixed, full strength, longer than any tick.
    ctx.fillStyle = "rgb(242, 240, 235)";
    ctx.fillRect(cx - 1, 0, 2, 48);
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
      const glow = Math.exp(-frozenBeat * 9);
      dot.style.opacity = String(0.18 + 0.82 * glow);
      dot.style.transform = `scale(${1 + 0.25 * glow})`;
      return;
    }
    const bpm = clamp(Math.round(v), MIN, MAX);
    const rate = bpm / 60;
    if (!running) {
      dot.style.opacity = "0.18";
      dot.style.transform = "scale(1)";
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
    const glow = Math.exp(-since * 9);
    dot.style.opacity = String(0.18 + 0.82 * glow);
    dot.style.transform = `scale(${1 + 0.25 * glow})`;
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
    renderRuler();
    beatTick(dt);
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
