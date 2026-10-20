import { albumById } from "@/app/lab/_music/catalog";

import { coverImage, wordImage } from "./moireArt";
import { createMoireSound } from "./moireAudio";
import { createMoireGL } from "./moireGL";

const SEQUENCE = [
  { word: "still here?" },
  { cover: "help" },
  { word: "let it be" },
  { cover: "with-the-beatles" },
  { word: "you are not alone" },
  { cover: "abbey-road" },
  { word: "breathe" },
  { cover: "let-it-be" },
  { word: "come back soon" },
];
const COVERS = {
  help: { crop: [0.02, 0.3, 0.96, 0.62], invert: true, gamma: 0.8 },
  "with-the-beatles": { crop: [0.01, 0.14, 0.955, 0.85], invert: true, gamma: 0.8 },
  "abbey-road": { crop: [0, 0.32, 1, 0.68], invert: true, gamma: 1.1 },
  "let-it-be": { crop: [0.04, 0.1, 0.92, 0.86], invert: true, gamma: 0.9 },
};
const AWAY = 3.6;
const APPROACH = 2.6;
const HOLD = 2.4;
const LEAVE = 2.2;
const CYCLE = AWAY + APPROACH + HOLD + LEAVE;
const SWAP_AT = 0.5;
const SWAP_LEN = 1.6;
const IDLE_RESUME = 2.6;
const TAU = Math.PI * 2;

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const easeInOut = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export function createMoire(stage, { embedded = false, caption = null, onLive = () => {}, onFail = () => {}, onGesture = () => {} } = {}) {
  const root = document.createElement("div");
  root.className = "moire-screen";
  if (embedded) root.tabIndex = 0;
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", "Two fine line gratings overlapping; a hidden word or Beatles cover appears only where they interfere");
  const canvas = document.createElement("canvas");
  canvas.className = "moire-canvas";
  root.append(canvas);
  stage.append(root);

  const gl = createMoireGL(canvas);
  if (!gl) {
    root.remove();
    onFail();
    return { destroy() {}, setSound: async () => false };
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const images = new Map();
  let sound = null;

  let W = 0;
  let H = 0;
  let dpr = 1;
  let period = 6;
  let warpAmp = 2.2;
  let freq = 0.01;
  let cx = 0;
  let cy = 0;
  let region = { x: 0, y: 0, w: 1, h: 1 };
  let band = [0, 1e5];
  let rects = [
    [0, 0, 1, 1],
    [0, 0, 1, 1],
  ];
  let slotItem = [null, null];
  let cur = 0;
  let mix = 0;

  let raf = 0;
  let last = 0;
  let clock = 0;
  let auto = 0;
  let visible = !document.hidden;
  let onscreen = true;
  let destroyed = false;
  let ready = false;
  let fade = 0;
  let seq = 0;
  let swappedCycle = -1;

  const user = { x: 0, y: 0, rot: 0, active: false, at: -Infinity, id: -1, lx: 0, ly: 0 };
  let top = { dx: 0, dy: 0, theta: 0 };
  const samples = [];
  let prevDelta = null;
  let beat = 0;

  const warp = (x0, y0, t) => {
    const x = x0 * freq;
    const y = y0 * freq;
    return warpAmp * (Math.sin(x + 1.3 * Math.sin(y * 0.8 + t * 0.07)) + 0.6 * Math.sin(y * 1.7 - 0.9 * Math.sin(x * 1.3 - t * 0.05) + 2.0) + 0.35 * Math.sin((x + y) * 2.3 + t * 0.04));
  };

  const deltaAt = (px, py, t) => {
    const k = TAU / period;
    const c = Math.cos(top.theta);
    const s = Math.sin(top.theta);
    const rx = px - cx - top.dx;
    const ry = py - cy - top.dy;
    const qx = c * rx + s * ry + cx;
    const qy = -s * rx + c * ry + cy;
    return py * k + warp(px, py, t) - (qy * k + warp(qx, qy, t));
  };

  const loadCovers = () => {
    for (const id of Object.keys(COVERS)) {
      const album = albumById(id);
      if (!album) continue;
      const img = new Image();
      img.decoding = "async";
      img.src = album.cover;
      img
        .decode()
        .then(() => {
          if (!destroyed) images.set(id, img);
        })
        .catch(() => {});
    }
  };

  const render = (item) => {
    if (item.word) return wordImage(item.word, region, period);
    const img = images.get(item.cover);
    if (!img) return null;
    return coverImage(img, region, period, COVERS[item.cover]);
  };

  const describe = (item) => (item.word ? item.word : `${albumById(item.cover)?.title ?? ""} cover`);

  const putInSlot = (slot, item) => {
    const made = render(item);
    if (!made) return false;
    gl.upload(slot, made.data, made.w, made.h);
    rects[slot] = made.rect;
    slotItem[slot] = item;
    return true;
  };

  const nextItem = () => {
    for (let k = 0; k < SEQUENCE.length; k += 1) {
      const it = SEQUENCE[seq % SEQUENCE.length];
      seq += 1;
      if (it.word || images.has(it.cover)) return it;
    }
    return SEQUENCE[0];
  };

  const swap = () => {
    const other = 1 - cur;
    if (putInSlot(other, nextItem())) {
      cur = other;
      onLive(describe(slotItem[cur]));
    }
  };

  let sizeKey = "";
  const layout = (force) => {
    const sr = stage.getBoundingClientRect();
    if (!sr.width || !sr.height) return false;
    const key = `${Math.round(sr.width)}x${Math.round(sr.height)}x${window.devicePixelRatio}`;
    if (!force && key === sizeKey) return false;
    sizeKey = key;
    W = sr.width;
    H = sr.height;
    const narrow = W < 640;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    gl.resize(Math.round(W * dpr), Math.round(H * dpr));
    period = embedded ? 4.5 : narrow ? 5 : 6;
    freq = 1 / Math.max(70, Math.min(W, H) * 0.24);
    warpAmp = 4.4;
    let topEdge = embedded ? 16 : 24;
    if (caption) {
      const side = narrow ? 16 : 32;
      caption.style.left = `${side}px`;
      caption.style.width = `${W - side * 2}px`;
      const cr = caption.getBoundingClientRect();
      const bandTop = Math.round(cr.bottom - sr.top + (narrow ? 20 : 28));
      band = [bandTop, Math.round(H - (narrow ? 48 : 52))];
      topEdge = bandTop + 16;
    } else {
      band = [-100, H + 100];
    }
    const bottom = embedded ? 16 : narrow ? 64 : 68;
    const side = embedded ? 16 : narrow ? 16 : 48;
    region = { x: side, y: topEdge, w: W - side * 2, h: Math.max(80, H - topEdge - bottom) };
    cx = region.x + region.w / 2;
    cy = region.y + region.h / 2;
    samples.length = 0;
    for (const [fx, fy] of [
      [0.5, 0.5],
      [0.2, 0.25],
      [0.8, 0.25],
      [0.2, 0.75],
      [0.8, 0.75],
      [0.5, 0.15],
      [0.5, 0.85],
    ])
      samples.push([region.x + region.w * fx, region.y + region.h * fy]);
    prevDelta = null;
    for (const slot of [0, 1]) if (slotItem[slot]) putInSlot(slot, slotItem[slot]);
    return true;
  };

  const autoTransform = (t) => {
    const local = ((t % CYCLE) + CYCLE) % CYCLE;
    let a;
    if (local < AWAY) a = 1;
    else if (local < AWAY + APPROACH) a = 1 - easeInOut((local - AWAY) / APPROACH);
    else if (local < AWAY + APPROACH + HOLD) a = 0;
    else a = easeInOut((local - AWAY - APPROACH - HOLD) / LEAVE);
    const span = Math.min(region.w, region.h);
    const turn = Math.abs(Math.floor((t - AWAY - APPROACH - HOLD) / CYCLE)) % 2 === 0 ? 1 : -1;
    const dx = span * 0.06 * Math.sin(t * 0.41 + 1) + span * 0.02 * Math.sin(t * 1.13);
    const dy = period * 1.6 * Math.sin(t * 0.27 + 0.4);
    const theta = turn * (0.36 + 0.06 * Math.sin(t * 0.33 + 2)) + 0.025 * Math.sin(t * 0.91);
    const ease = a * a * (3 - 2 * a);
    return { dx: dx * a, dy: dy * a, theta: theta * ease, a, local };
  };

  const frame = () => {
    const now = performance.now();
    raf = 0;
    if (destroyed) return;
    const raw = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
    last = now;
    clock += raw;
    fade = Math.min(1, fade + raw / 0.8);
    const idle = !user.active && clock - user.at > IDLE_RESUME;
    if (idle && !reduced) auto += raw;
    if (idle) {
      const k = 1 - Math.exp(-raw / 0.9);
      user.x -= user.x * k;
      user.y -= user.y * k;
      user.rot -= user.rot * k;
    }
    const at = autoTransform(auto);
    const cycle = Math.floor(auto / CYCLE);
    if (at.local > SWAP_AT && cycle !== swappedCycle && at.local < AWAY) {
      swappedCycle = cycle;
      if (cycle > 0) swap();
    }
    const target = cur;
    mix += (target - mix) * (1 - Math.exp(-raw / (SWAP_LEN / 4)));
    if (Math.abs(target - mix) < 0.001) mix = target;
    top = { dx: at.dx + user.x, dy: at.dy + user.y, theta: at.theta + user.rot };
    let sum = 0;
    const deltas = samples.map(([x, y]) => deltaAt(x, y, clock));
    if (prevDelta) for (let i = 0; i < deltas.length; i += 1) sum += Math.abs(deltas[i] - prevDelta[i]);
    prevDelta = deltas;
    const rate = Math.min(16, sum / deltas.length / TAU / raw);
    beat += (rate - beat) * (1 - Math.exp(-raw / 0.12));
    const clarity = 1 - Math.min(1, Math.hypot(top.dx / 40, top.dy / (period * 2), top.theta / 0.02));
    sound?.update(beat, clarity);
    gl.render({ mix, rectA: rects[0], rectB: rects[1], dpr, period, time: clock, warp: warpAmp, freq, dx: top.dx, dy: top.dy, theta: top.theta, cx, cy, maskOn: caption ? 1 : 0, band, fade: smooth(fade) });
    raf = requestAnimationFrame(frame);
  };

  function wake() {
    if (destroyed || raf || !visible || !onscreen || !ready) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const sleep = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  let gestured = false;
  const gesture = () => {
    if (gestured) return;
    gestured = true;
    onGesture();
  };

  const onDown = (e) => {
    gesture();
    if (user.active) return;
    user.active = true;
    user.id = e.pointerId;
    user.lx = e.clientX;
    user.ly = e.clientY;
    root.setPointerCapture?.(e.pointerId);
    root.dataset.dragging = "";
  };

  const onMove = (e) => {
    if (!user.active || e.pointerId !== user.id) return;
    const dx = e.clientX - user.lx;
    const dy = e.clientY - user.ly;
    user.lx = e.clientX;
    user.ly = e.clientY;
    const span = Math.min(region.w, region.h);
    user.x = Math.max(-span * 0.4, Math.min(span * 0.4, user.x + dx * 0.12));
    user.y = Math.max(-span * 0.2, Math.min(span * 0.2, user.y + dy * 0.1));
    user.rot = Math.max(-0.7, Math.min(0.7, user.rot + dx * 0.0011));
    user.at = clock;
  };

  const onUp = (e) => {
    if (e.pointerId !== user.id) return;
    user.active = false;
    user.at = clock;
    const at = autoTransform(auto);
    if (Math.abs(at.theta + user.rot) < 0.12 && Math.abs(at.dx + user.x) < 80) {
      user.x += at.dx;
      user.y += at.dy;
      user.rot += at.theta;
      const base = Math.floor(auto / CYCLE) * CYCLE;
      auto = base + AWAY + APPROACH + 0.01;
      user.at = clock - IDLE_RESUME;
    }
    delete root.dataset.dragging;
  };

  const onKey = (e) => {
    const step = e.shiftKey ? 12 : 3;
    let used = true;
    if (e.key === "ArrowLeft") user.x -= step;
    else if (e.key === "ArrowRight") user.x += step;
    else if (e.key === "ArrowUp") user.y -= step * 0.25;
    else if (e.key === "ArrowDown") user.y += step * 0.25;
    else used = false;
    if (!used) return;
    gesture();
    user.at = clock;
    e.preventDefault();
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
    else sleep();
  };

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  const keyTarget = embedded ? root : window;
  keyTarget.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisibility);
  const ro = new ResizeObserver(() => {
    if (ready) layout(false);
  });
  ro.observe(stage);
  const io = new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    if (onscreen) wake();
    else sleep();
  });
  io.observe(root);

  const boot = async () => {
    loadCovers();
    try {
      await Promise.race([document.fonts.load("700 64px MoireSans"), new Promise((r) => setTimeout(r, 1500))]);
    } catch {}
    if (destroyed) return;
    if (!layout(true)) {
      requestAnimationFrame(boot);
      return;
    }
    const first = nextItem();
    putInSlot(0, first);
    slotItem[1] = null;
    cur = 0;
    mix = 0;
    auto = AWAY + APPROACH * 0.55;
    swappedCycle = 0;
    onLive(describe(first));
    ready = true;
    root.dataset.ready = "";
    wake();
  };
  boot();

  return {
    async setSound(on) {
      if (on && !sound) sound = createMoireSound();
      if (!sound) return false;
      return sound.setEnabled(on);
    },
    destroy() {
      destroyed = true;
      sleep();
      ro.disconnect();
      io.disconnect();
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      keyTarget.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      sound?.destroy();
      gl.dispose();
      root.remove();
    },
  };
}
