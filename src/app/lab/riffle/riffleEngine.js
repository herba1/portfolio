import { FRAMES, PAGE_ASPECT, drawFrame } from "./riffleFrames";

const FLIP = 0.16;
const MAX_SPEED = 26;
const PLAY_SPEED = 12;
const PX_PER_PAGE = 7;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mod = (n, m) => ((n % m) + m) % m;

function createSound() {
  let ctx = null;
  let noise = null;
  let lastAt = 0;
  return {
    wake() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        const len = Math.round(ctx.sampleRate * 0.2);
        noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      }
      if (ctx.state === "suspended") ctx.resume();
    },
    flick(rate) {
      if (!ctx || ctx.state !== "running") return;
      const t = ctx.currentTime;
      if (t - lastAt < 0.03) return;
      lastAt = t;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.playbackRate.value = 0.8 + Math.random() * 0.5;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2600 + Math.random() * 1600;
      bp.Q.value = 1.1;
      const g = ctx.createGain();
      g.gain.value = 0.11 / (1 + rate * 0.04);
      src.connect(bp).connect(g).connect(ctx.destination);
      src.start(t);
    },
    destroy() {
      ctx?.close();
      ctx = null;
    },
  };
}

export function createRiffle({ root, stage, canvas, onFrame, onPlaying, onReady }) {
  const ctx = canvas.getContext("2d");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sound = createSound();
  const cs = getComputedStyle(root);
  const fonts = {
    sans: cs.getPropertyValue("--font-sans").trim() || "system-ui, sans-serif",
    mono: cs.getPropertyValue("--font-mono").trim() || "ui-monospace, monospace",
  };
  const view = { w: 1, h: 1, dpr: 1, x: 0, y: 0, pw: 1, ph: 1 };
  const flights = [];
  let pos = 0;
  let vel = 0;
  let playing = !reduced;
  let drag = null;
  let raf = 0;
  let last = 0;
  let active = true;
  let destroyed = false;
  let dirty = true;
  let shownFrame = -1;
  let page = null;
  let pageCtx = null;

  function layout() {
    const rect = root.getBoundingClientRect();
    view.w = Math.max(1, rect.width);
    view.h = Math.max(1, rect.height);
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    const narrow = view.w < 720;
    const top = narrow ? 156 : 184;
    const bottom = narrow ? 100 : 104;
    const availH = Math.max(160, view.h - top - bottom);
    const availW = view.w - (narrow ? 40 : 96);
    view.pw = Math.min(availW * (narrow ? 0.94 : 0.62), availH * 0.86 * PAGE_ASPECT, 760);
    view.ph = view.pw / PAGE_ASPECT;
    view.x = (view.w - view.pw) / 2 + (narrow ? 6 : 10);
    view.y = top + (availH - view.ph) / 2;
    page = document.createElement("canvas");
    page.width = Math.round(view.pw * view.dpr);
    page.height = Math.round(view.ph * view.dpr);
    pageCtx = page.getContext("2d");
    shownFrame = -1;
    dirty = true;
  }

  function paintPage(frame) {
    pageCtx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    drawFrame(pageCtx, frame, view.pw, view.ph, fonts);
  }

  function frameCanvas(frame) {
    const c = document.createElement("canvas");
    c.width = page.width;
    c.height = page.height;
    const cx = c.getContext("2d");
    cx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    drawFrame(cx, frame, view.pw, view.ph, fonts);
    return c;
  }

  function startFlight(index, dir) {
    flights.push({ index, dir, t: 0, canvas: frameCanvas(index) });
    if (flights.length > 10) flights.shift();
    sound.flick(Math.abs(vel));
  }

  function advance(dt) {
    const before = Math.floor(pos);
    if (drag) {
      const target = drag.pos + (drag.x0 - drag.x) / PX_PER_PAGE;
      const inst = dt > 0 ? (target - pos) / dt : 0;
      vel += (clamp(inst, -MAX_SPEED, MAX_SPEED) - vel) * Math.min(1, dt * 14);
      pos += clamp(target - pos, -MAX_SPEED * dt, MAX_SPEED * dt);
    } else if (playing) {
      vel += (PLAY_SPEED - vel) * Math.min(1, dt * 4);
      pos += vel * dt;
    } else {
      vel *= Math.exp(-dt * 2.6);
      if (Math.abs(vel) < 0.6) {
        const settle = Math.round(pos);
        pos += (settle - pos) * Math.min(1, dt * 10);
        if (Math.abs(settle - pos) < 0.002) pos = settle;
        vel = 0;
      } else pos += vel * dt;
    }
    const after = Math.floor(pos);
    if (after > before) for (let i = before; i < after; i += 1) startFlight(i, 1);
    else if (after < before) for (let i = before - 1; i >= after; i -= 1) startFlight(i, -1);
    for (const f of flights) f.t += dt / FLIP;
    while (flights.length && flights[0].t >= 1) flights.shift();
  }

  function render() {
    const d = view.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const { x, y, pw, ph } = view;
    const back = flights.filter((f) => f.dir < 0).length;
    const top = Math.floor(pos) + back;
    if (top !== shownFrame) {
      paintPage(top);
      shownFrame = top;
      onFrame?.(mod(top, FRAMES));
    }
    ctx.save();
    ctx.shadowColor = "rgb(30 28 36 / 0.16)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = "#f3f0e8";
    ctx.fillRect(x, y, pw + 10, ph + 10);
    ctx.restore();
    for (let i = 5; i >= 1; i -= 1) {
      ctx.fillStyle = i % 2 ? "#ece8de" : "#f6f3ec";
      ctx.fillRect(x + i * 2, y + i * 2, pw, ph);
      ctx.strokeStyle = "rgb(30 28 36 / 0.1)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + i * 2 + 0.5, y + i * 2 + 0.5, pw - 1, ph - 1);
    }
    ctx.drawImage(page, x, y, pw, ph);
    ctx.strokeStyle = "rgb(30 28 36 / 0.14)";
    ctx.strokeRect(x + 0.5, y + 0.5, pw - 1, ph - 1);

    const ordered = [...flights].sort((a, b) => (a.dir > 0 ? a.t : 1 - a.t) - (b.dir > 0 ? b.t : 1 - b.t));
    for (const f of ordered) {
      const p = f.dir > 0 ? f.t : 1 - f.t;
      const e = p * p * (3 - 2 * p);
      const sx = Math.cos(e * Math.PI * 0.5);
      if (sx < 0.01) continue;
      const fw = pw * sx;
      ctx.save();
      ctx.shadowColor = "rgb(30 28 36 / 0.22)";
      ctx.shadowBlur = 14;
      ctx.shadowOffsetX = 4 + 10 * (1 - sx);
      ctx.fillStyle = "#fbf9f4";
      ctx.fillRect(x, y, fw, ph);
      ctx.restore();
      ctx.drawImage(f.canvas, x, y, fw, ph);
      const shade = ctx.createLinearGradient(x, 0, x + fw, 0);
      shade.addColorStop(0, `rgb(30 28 36 / ${(0.18 * e).toFixed(3)})`);
      shade.addColorStop(0.6, `rgb(30 28 36 / ${(0.06 * e).toFixed(3)})`);
      shade.addColorStop(1, `rgb(255 255 255 / ${(0.25 * e).toFixed(3)})`);
      ctx.fillStyle = shade;
      ctx.fillRect(x, y, fw, ph);
    }

    const tape = Math.max(14, pw * 0.035);
    ctx.fillStyle = "#1d1c22";
    ctx.beginPath();
    ctx.roundRect(x - tape * 0.6, y - 4, tape, ph + 18, 3);
    ctx.fill();
    ctx.fillStyle = "rgb(255 255 255 / 0.08)";
    ctx.fillRect(x - tape * 0.6 + 3, y, 2, ph + 10);
  }

  function frame(now) {
    raf = 0;
    if (destroyed || !active) return;
    const dt = last ? clamp((now - last) / 1000, 0, 0.05) : 0;
    last = now;
    advance(dt);
    const moving = drag || playing || Math.abs(vel) > 0 || flights.length > 0 || pos !== Math.round(pos);
    if (moving || dirty) {
      render();
      dirty = false;
      onReady?.();
    }
    if (moving) raf = requestAnimationFrame(frame);
    else last = 0;
  }

  function wake() {
    if (raf || destroyed || !active) return;
    raf = requestAnimationFrame(frame);
  }

  function setPlaying(on) {
    playing = on;
    onPlaying?.(on);
    wake();
  }

  function local(e) {
    const rect = root.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const [x, y] = local(e);
    const inside = x > view.x - 20 && x < view.x + view.pw + 30 && y > view.y - 20 && y < view.y + view.ph + 30;
    if (!inside) return;
    sound.wake();
    e.preventDefault();
    stage.setPointerCapture?.(e.pointerId);
    if (playing) setPlaying(false);
    drag = { id: e.pointerId, x0: x, x, pos };
    root.dataset.dragging = "";
    wake();
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.x = local(e)[0];
    wake();
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    delete root.dataset.dragging;
    wake();
  }

  function onKey(e) {
    if (e.key === "ArrowRight") {
      sound.wake();
      setPlaying(false);
      vel = 0;
      pos = Math.round(pos) + 1;
      startFlight(Math.round(pos) - 1, 1);
      e.preventDefault();
      wake();
    } else if (e.key === "ArrowLeft") {
      sound.wake();
      setPlaying(false);
      vel = 0;
      pos = Math.round(pos) - 1;
      startFlight(Math.round(pos), -1);
      e.preventDefault();
      wake();
    } else if (e.key === " " || e.key === "Enter") {
      sound.wake();
      setPlaying(!playing);
      e.preventDefault();
    }
  }

  layout();
  render();
  onReady?.();
  onPlaying?.(playing);

  const ro = new ResizeObserver(() => {
    layout();
    render();
  });
  ro.observe(root);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("keydown", onKey);
  wake();

  return {
    setActive(on) {
      active = on;
      if (on) {
        last = 0;
        wake();
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    toggle() {
      sound.wake();
      setPlaying(!playing);
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("keydown", onKey);
      sound.destroy();
    },
  };
}
