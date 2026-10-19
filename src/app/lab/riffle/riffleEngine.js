import { FRAMES, PAGE_ASPECT, WIDE_ASPECT, drawPage, loadCovers } from "./riffleFrames";

const MAX_SPEED = 14;
const PLAY_SPEED = 1.6;
const PX_PER_PAGE = 36;
const BACK = "#f1ede3";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mod = (n, m) => ((n % m) + m) % m;
const easeInOut = (t) => t * t * (3 - 2 * t);

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
      g.gain.value = 0.1 / (1 + rate * 0.06);
      src.connect(bp).connect(g).connect(ctx.destination);
      src.start(t);
    },
    destroy() {
      ctx?.close();
      ctx = null;
    },
  };
}

export async function createRiffle({ root, stage, canvas, onFrame, onPlaying, onReady }) {
  const ctx = canvas.getContext("2d");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sound = createSound();
  const cs = getComputedStyle(root);
  const fonts = {
    sans: cs.getPropertyValue("--font-sans").trim() || "system-ui, sans-serif",
    mono: cs.getPropertyValue("--font-mono").trim() || "ui-monospace, monospace",
  };
  const covers = await loadCovers();
  const view = { w: 1, h: 1, dpr: 1, x: 0, y: 0, pw: 1, ph: 1 };
  const flights = [];
  let pages = [];
  let pos = 0;
  let vel = 0;
  let playing = !reduced;
  let drag = null;
  let raf = 0;
  let last = 0;
  let active = true;
  let destroyed = false;
  let dirty = true;
  let shown = -1;

  function layout() {
    const rect = root.getBoundingClientRect();
    view.w = Math.max(1, rect.width);
    view.h = Math.max(1, rect.height);
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    const embedded = root.hasAttribute("data-embedded");
    const head = root.querySelector(".riffle__head");
    const narrow = view.w < 720;
    const side = !embedded && view.w >= 1024;
    if (side || (embedded && view.w / view.h > 1.2)) {
      const top = embedded ? 24 : 96;
      const bottom = embedded ? 24 : 104;
      const left = side ? 384 : 32;
      const right = embedded ? 32 : 48;
      const availW = view.w - left - right;
      const availH = Math.max(160, view.h - top - bottom);
      view.ph = Math.round(Math.min(availH, availW / WIDE_ASPECT, 640));
      view.pw = Math.round(view.ph * WIDE_ASPECT);
      const centred = (view.w - view.pw) / 2;
      view.x = Math.round((centred >= left ? centred : left + (availW - view.pw) / 2) + 4);
      view.y = Math.round(top + (availH - view.ph) / 2);
    } else {
      const headBottom = head ? head.getBoundingClientRect().bottom - rect.top : 0;
      const top = embedded ? 24 : Math.max(96, Math.round(headBottom + 24));
      const bottom = embedded ? 24 : narrow ? 92 : 104;
      const availH = Math.max(200, view.h - top - bottom);
      const availW = view.w - (narrow ? 56 : 96);
      view.ph = Math.round(Math.min(availH, availW / PAGE_ASPECT, 680));
      view.pw = Math.round(view.ph * PAGE_ASPECT);
      view.x = Math.round((view.w - view.pw) / 2 + 6);
      view.y = Math.round(top + (availH - view.ph) / 2);
    }
    root.style.setProperty("--riffle-cx", `${Math.round(view.x + view.pw / 2)}px`);
    pages = Array.from({ length: FRAMES }, (_, i) => {
      const c = document.createElement("canvas");
      c.width = Math.round(view.pw * view.dpr);
      c.height = Math.round(view.ph * view.dpr);
      const cx = c.getContext("2d");
      cx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      drawPage(cx, i, view.pw, view.ph, covers, fonts);
      return c;
    });
    dirty = true;
  }

  function flightTime() {
    return clamp(1.1 / Math.max(1, Math.abs(vel)), 0.14, 0.42);
  }

  function startFlight(index, dir) {
    for (const f of flights) f.dur = Math.min(f.dur, 0.16);
    flights.push({ index, dir, t: 0, dur: reduced ? 0.01 : flightTime() });
    if (flights.length > 8) flights.shift();
    sound.flick(Math.abs(vel));
  }

  function advance(dt) {
    const before = Math.floor(pos);
    if (drag) {
      const target = drag.pos + (drag.x0 - drag.x) / PX_PER_PAGE;
      const step = clamp(target - pos, -MAX_SPEED * dt, MAX_SPEED * dt);
      const inst = dt > 0 ? step / dt : 0;
      vel += (inst - vel) * Math.min(1, dt * 18);
      pos += step;
    } else if (playing) {
      vel += (PLAY_SPEED - vel) * Math.min(1, dt * 4);
      pos += vel * dt;
    } else {
      vel *= Math.exp(-dt * 4);
      if (Math.abs(vel) < 0.8) {
        const settle = vel >= 0 ? Math.ceil(pos - 0.001) : Math.floor(pos + 0.001);
        const k = Math.min(1, dt * 12);
        pos += (settle - pos) * k;
        if (Math.abs(settle - pos) < 0.002) pos = settle;
        vel = 0;
      } else pos += vel * dt;
    }
    const after = Math.floor(pos);
    if (after > before) for (let i = before; i < after; i += 1) startFlight(i, 1);
    else if (after < before) for (let i = before - 1; i >= after; i -= 1) startFlight(i, -1);
    for (const f of flights) f.t += dt / f.dur;
    for (let i = flights.length - 1; i >= 0; i -= 1) if (flights[i].t >= 1) flights.splice(i, 1);
  }

  function drawFlight(f) {
    const { x, y, pw, ph } = view;
    const p = clamp(f.dir > 0 ? f.t : 1 - f.t, 0, 1);
    const fold = pw * (1 - easeInOut(p));
    if (fold < 0.5) return;
    const flapW = Math.min(fold, (pw - fold) * 0.32, pw * 0.08);
    const flapL = fold - flapW;
    const page = pages[mod(f.index, FRAMES)];
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + fold, y, Math.min(pw - fold, 28), ph);
    ctx.clip();
    const cast = ctx.createLinearGradient(x + fold, 0, x + fold + 28, 0);
    cast.addColorStop(0, "rgb(30 28 36 / 0.16)");
    cast.addColorStop(0.4, "rgb(30 28 36 / 0.05)");
    cast.addColorStop(1, "rgb(30 28 36 / 0)");
    ctx.fillStyle = cast;
    ctx.fillRect(x + fold, y, 28, ph);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, fold, ph);
    ctx.clip();
    ctx.drawImage(page, x, y, pw, ph);
    ctx.restore();
    if (flapW > 0.5) {
      ctx.save();
      ctx.shadowColor = "rgb(30 28 36 / 0.18)";
      ctx.shadowBlur = 12;
      ctx.shadowOffsetX = -3;
      ctx.fillStyle = BACK;
      ctx.fillRect(x + flapL, y, flapW, ph);
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + flapL, y, flapW, ph);
      ctx.clip();
      ctx.globalAlpha = 0.14;
      ctx.translate(x + fold, y);
      ctx.scale(-1, 1);
      ctx.drawImage(page, 0, 0, pw, ph);
      ctx.restore();
      const sheen = ctx.createLinearGradient(x + flapL, 0, x + fold, 0);
      sheen.addColorStop(0, "rgb(255 255 255 / 0.5)");
      sheen.addColorStop(0.55, "rgb(255 255 255 / 0)");
      sheen.addColorStop(0.85, "rgb(30 28 36 / 0.05)");
      sheen.addColorStop(1, "rgb(30 28 36 / 0.14)");
      ctx.fillStyle = sheen;
      ctx.fillRect(x + flapL, y, flapW, ph);
    }
  }

  function render() {
    const d = view.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const { x, y, pw, ph } = view;
    const back = flights.filter((f) => f.dir < 0).length;
    const base = Math.floor(pos) + back;
    const current = mod(base, FRAMES);
    if (current !== shown) {
      shown = current;
      onFrame?.(current);
    }
    ctx.save();
    ctx.shadowColor = "rgb(30 28 36 / 0.14)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = "#f3f0e8";
    ctx.fillRect(x, y, pw + 8, ph + 8);
    ctx.restore();
    for (let i = 4; i >= 1; i -= 1) {
      ctx.fillStyle = i % 2 ? "#ece8de" : "#f6f3ec";
      ctx.fillRect(x + i * 2, y + i * 2, pw, ph);
      ctx.strokeStyle = "rgb(30 28 36 / 0.08)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + i * 2 + 0.5, y + i * 2 + 0.5, pw - 1, ph - 1);
    }
    ctx.drawImage(pages[mod(base, FRAMES)], x, y, pw, ph);
    const ordered = [...flights].sort((a, b) => b.index - a.index);
    for (const f of ordered) drawFlight(f);
    ctx.strokeStyle = "rgb(30 28 36 / 0.12)";
    ctx.strokeRect(x + 0.5, y + 0.5, pw - 1, ph - 1);
    const tape = Math.max(12, Math.round(pw * 0.034));
    ctx.fillStyle = "#1d1c22";
    ctx.beginPath();
    ctx.roundRect(x - tape * 0.6, y - 4, tape, ph + 16, 3);
    ctx.fill();
  }

  function frame(now) {
    raf = 0;
    if (destroyed || !active) return;
    const dt = last ? clamp((now - last) / 1000, 0, 0.05) : 1 / 60;
    last = now;
    advance(dt);
    const moving = drag || playing || Math.abs(vel) > 0 || flights.length > 0 || pos !== Math.round(pos);
    if (moving || dirty) {
      render();
      dirty = false;
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
    const [x] = local(e);
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

  function turn(dir) {
    sound.wake();
    if (playing) setPlaying(false);
    vel = 0;
    const from = Math.round(pos);
    pos = from + dir;
    if (dir > 0) startFlight(from, 1);
    else startFlight(from - 1, -1);
    wake();
  }

  function onKey(e) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      turn(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      turn(-1);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      sound.wake();
      setPlaying(!playing);
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
