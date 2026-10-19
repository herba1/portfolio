import { ALBUMS } from "@/app/lab/_music/catalog";

import { createChannelSound } from "./channelAudio";
import { createChannelGL } from "./channelGL";

const LINES = [
  "you don't have to be anyone tonight",
  "i keep your voice on the walk home",
  "we can stay out till the streetlights go soft",
  "it will take a while to feel like this again",
  "nothing good comes easy but it comes",
  "the whole point is not knowing and going anyway",
  "it must be out there.",
  "everyone we loved was in the same room once",
  "the bus is late and i don't mind at all",
  "still here?",
  "walk slow, the night isn't going anywhere",
  "leave it how it is. it's fine.",
];
const COUNT = ALBUMS.length;
const START = ALBUMS.findIndex((a) => a.id === "abbey-road");
const WORD = 0.26;
const LEAD = 0.75;
const HOLD = 5.6;
const GAP = 0.9;
const NOTCH = 72;

const mod = (n, m) => ((n % m) + m) % m;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function smooth(x) {
  const v = clamp(x, 0, 1);
  return v * v * (3 - 2 * v);
}

export function createChannel(stage, { embedded = false, caption = null, onLive = () => {}, onChannel = () => {}, onFail = () => {} } = {}) {
  const canvas = document.createElement("canvas");
  canvas.className = "channel-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "slider");
  canvas.setAttribute("aria-label", "Channel");
  canvas.setAttribute("aria-valuemin", "2");
  canvas.setAttribute("aria-valuemax", String(COUNT + 1));
  stage.prepend(canvas);
  const gl = createChannelGL(canvas);
  if (!gl) {
    canvas.remove();
    onFail();
    return { destroy() {}, setSound: async () => false, degauss() {} };
  }

  const capCanvas = document.createElement("canvas");
  const cx = capCanvas.getContext("2d");
  const covers = ALBUMS.map((a) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      gl.addCover(a.id, img);
    };
    img.src = a.cover;
    return img;
  });

  let sound = null;
  let screenW = 600;
  let screenH = 450;
  let scale = 1;
  let osdTop = 120;
  let osdSide = 32;
  let capBottom = 0.82;
  let chan = START;
  let drag = null;
  let detune = 0;
  let detuneSign = 1;
  let tuneClock = 0;
  let degaussClock = 99;
  let osdLeft = 0;
  let capKey = "";
  let wheelAcc = 0;
  let raf = 0;
  let last = 0;
  let visible = !document.hidden;
  let onscreen = true;
  let destroyed = false;
  let ready = false;
  let layoutKey = "";
  let wordsCache = null;
  let fadeIn = 0;

  const layout = () => {
    const sr = stage.getBoundingClientRect();
    if (!sr.width || !sr.height) return;
    const key = `${Math.round(sr.width)}x${Math.round(sr.height)}x${window.devicePixelRatio}`;
    if (key === layoutKey) return;
    layoutKey = key;
    const narrow = sr.width < 700;
    screenW = Math.round(sr.width);
    screenH = Math.round(sr.height);
    osdSide = narrow ? 24 : 40;
    const capRect = caption?.getBoundingClientRect();
    osdTop = capRect ? capRect.bottom - sr.top + (narrow ? 28 : 36) : narrow ? 32 : 48;
    capBottom = narrow ? 0.8 : 0.84;
    scale = Math.min(window.devicePixelRatio || 1, 2);
    gl.resize(Math.round(screenW * scale), Math.round(screenH * scale));
    const cs = Math.min(scale, 1.5);
    capCanvas.width = Math.round(screenW * cs);
    capCanvas.height = Math.round(screenH * cs);
    wordsCache = null;
    capKey = "";
    wake();
  };

  const layoutWords = () => {
    if (wordsCache && wordsCache.chan === chan) return wordsCache;
    const cs = capCanvas.width / screenW;
    const fs = Math.round(clamp(Math.min(screenH * 0.05, screenW * 0.068), 20, 46));
    cx.setTransform(cs, 0, 0, cs, 0, 0);
    cx.font = `${fs}px ChannelArimo, Arial, sans-serif`;
    const words = LINES[chan].split(" ");
    const maxW = Math.min(screenW * 0.72, fs * 15);
    const space = cx.measureText(" ").width;
    const rows = [[]];
    let rowW = 0;
    for (const w of words) {
      const ww = cx.measureText(w).width;
      const row = rows[rows.length - 1];
      if (row.length && rowW + space + ww > maxW) {
        rows.push([{ w, ww }]);
        rowW = ww;
      } else {
        row.push({ w, ww });
        rowW += (row.length > 1 ? space : 0) + ww;
      }
    }
    const lh = Math.round(fs * 1.2);
    const baseY = screenH * capBottom - (rows.length - 1) * lh;
    const placed = [];
    rows.forEach((row, r) => {
      const total = row.reduce((a, b) => a + b.ww, 0) + space * (row.length - 1);
      let x = (screenW - total) / 2;
      for (const item of row) {
        placed.push({ text: item.w, x, y: baseY + r * lh });
        x += item.ww + space;
      }
    });
    wordsCache = { chan, fs, words: placed };
    return wordsCache;
  };

  const drawCaption = (shown, osd) => {
    const key = `${chan}:${shown}:${osd ? 1 : 0}:${capCanvas.width}:${capCanvas.height}`;
    if (key === capKey) return;
    capKey = key;
    const cs = capCanvas.width / screenW;
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.clearRect(0, 0, capCanvas.width, capCanvas.height);
    cx.setTransform(cs, 0, 0, cs, 0, 0);
    const { fs, words } = layoutWords();
    cx.font = `${fs}px ChannelArimo, Arial, sans-serif`;
    cx.textBaseline = "alphabetic";
    cx.textAlign = "left";
    cx.shadowColor = "rgba(0, 0, 0, 0.42)";
    cx.shadowBlur = fs * 0.3;
    cx.shadowOffsetY = fs * 0.04;
    cx.fillStyle = "#fffdf6";
    for (let i = 0; i < Math.min(shown, words.length); i += 1) cx.fillText(words[i].text, words[i].x, words[i].y);
    cx.shadowColor = "transparent";
    if (osd) {
      const os = Math.round(clamp(screenH * 0.07, 36, 64));
      const ts = Math.round(os * 0.46);
      cx.textAlign = "right";
      cx.lineJoin = "round";
      const x = screenW - osdSide;
      const y = osdTop + os * 0.72;
      const label = `CH ${String(chan + 2).padStart(2, "0")}`;
      cx.font = `${os}px ChannelVT, monospace`;
      cx.lineWidth = os * 0.12;
      cx.strokeStyle = "rgba(0, 0, 0, 0.85)";
      cx.strokeText(label, x, y);
      cx.fillStyle = "#74ff6a";
      cx.fillText(label, x, y);
      cx.font = `${ts}px ChannelVT, monospace`;
      cx.lineWidth = ts * 0.16;
      const title = ALBUMS[chan].title.toLowerCase();
      cx.strokeText(title, x, y + ts * 1.25);
      cx.fillText(title, x, y + ts * 1.25);
      cx.textAlign = "left";
    }
    gl.setCaption(capCanvas);
  };

  const wordsShown = (tt) => {
    const n = LINES[chan].split(" ").length;
    if (tt < LEAD) return 0;
    const cycle = n * WORD + HOLD + GAP;
    const phase = (tt - LEAD) % cycle;
    if (phase > n * WORD + HOLD) return 0;
    return Math.min(n, Math.floor(phase / WORD) + 1);
  };

  const announce = () => {
    canvas.setAttribute("aria-valuenow", String(chan + 2));
    canvas.setAttribute("aria-valuetext", `Channel ${chan + 2}, ${ALBUMS[chan].title}`);
  };

  const tune = (index) => {
    const next = mod(index, COUNT);
    if (next === chan) return;
    chan = next;
    tuneClock = 0;
    osdLeft = 2.8;
    wordsCache = null;
    sound?.detent();
    sound?.retune(chan);
    announce();
    onLive(`Channel ${chan + 2}: ${ALBUMS[chan].title}`);
    onChannel(chan + 2);
    wake();
  };

  const step = (dir) => {
    tune(chan + dir);
  };

  const degauss = () => {
    degaussClock = 0;
    sound?.degauss();
    wake();
  };

  const frame = () => {
    const now = performance.now();
    raf = 0;
    if (destroyed || !visible || !onscreen) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    fadeIn = Math.min(1, fadeIn + dt / 0.6);
    if (drag) {
      detune = Math.abs(drag.acc) / NOTCH;
      detuneSign = Math.sign(drag.acc) || detuneSign;
    } else {
      detune *= Math.exp(-dt / 0.08);
      if (detune < 0.002) detune = 0;
    }
    tuneClock += dt;
    degaussClock += dt;
    osdLeft -= dt;
    const tt = tuneClock;
    const stat = tt < 0.14 ? 1 : tt < 0.46 ? 1 - smooth((tt - 0.14) / 0.32) : 0;
    const p = clamp((tt - 0.1) / 0.78, 0, 1);
    const roll = p > 0 && p < 1 ? 1 - Math.pow(1 - p, 3) : 0;
    const bar = p > 0 && p < 1 ? 1 - p * p : 0;
    const dg = degaussClock;
    const degaussAmt = dg < 2.4 ? Math.exp(-dg * 2.1) * (dg < 0.05 ? dg / 0.05 : 1) : 0;
    const off = smooth(detune);
    drawCaption(wordsShown(tt), osdLeft > 0 || drag !== null);
    const t = now / 1000;
    const seed = chan * 1.7 + 0.4;
    const ken = [1.06 + 0.05 * (0.5 + 0.5 * Math.sin(t * 0.09 + seed)), 0.024 * Math.sin(t * 0.05 + seed * 1.3), 0.04 * Math.sin(t * 0.06 + seed * 2.1)];
    const staticAmt = Math.max(stat, off * 0.62, gl.hasCover(ALBUMS[chan].id) ? 0 : 0.85);
    gl.render({
      cover: ALBUMS[chan].id,
      screenW,
      screenH,
      time: t % 1000,
      static: staticAmt,
      roll: roll + off * 0.08 * detuneSign,
      bar: Math.max(bar, off * 0.7),
      degauss: degaussAmt,
      ken,
      curve: screenW < 700 ? 0.05 : 0.07,
      fade: smooth(fadeIn),
    });
    sound?.levels(Math.max(stat, off * 0.7, bar * 0.12), (1 - stat) * (1 - Math.max(bar * 0.6, off * 0.8)));
    raf = requestAnimationFrame(frame);
  };

  function wake() {
    if (destroyed || raf || !visible || !onscreen || !ready) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const onDown = (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture?.(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, acc: 0, travel: 0, steps: 0 };
    canvas.dataset.grab = "";
    wake();
  };

  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.travel += Math.hypot(dx, dy);
    if (drag.travel < 6) return;
    const d = Math.abs(dx) >= Math.abs(dy) ? dx : -dy;
    drag.acc += clamp(d, -NOTCH * 0.9, NOTCH * 0.9);
    while (Math.abs(drag.acc) >= NOTCH) {
      const s = Math.sign(drag.acc);
      step(s);
      drag.steps += 1;
      drag.acc -= s * NOTCH;
    }
    wake();
  };

  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    canvas.removeAttribute("data-grab");
    const tap = d.travel < 6 && e.type === "pointerup";
    if (tap) step(1);
    else if (!d.steps && Math.abs(d.acc) > NOTCH * 0.5) step(Math.sign(d.acc));
    wake();
  };

  const onWheel = (e) => {
    if (embedded) return;
    e.preventDefault();
    wheelAcc += Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    while (Math.abs(wheelAcc) >= 60) {
      step(Math.sign(wheelAcc));
      wheelAcc -= Math.sign(wheelAcc) * 60;
    }
  };

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && t !== canvas && t !== document.body && t.closest?.("input, textarea, a, button")) return;
    if (t && t.isContentEditable) return;
    const k = e.key;
    if (k === "ArrowUp" || k === "ArrowRight" || k === "PageUp") step(1);
    else if (k === "ArrowDown" || k === "ArrowLeft" || k === "PageDown") step(-1);
    else if (k === "d" || k === "D") degauss();
    else return;
    e.preventDefault();
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  const keyTarget = embedded ? canvas : window;
  keyTarget.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisibility);
  const ro = new ResizeObserver(() => {
    if (ready) layout();
  });
  ro.observe(stage);
  if (caption) ro.observe(caption);
  const io = new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    if (onscreen) wake();
  });
  io.observe(stage);

  const boot = async () => {
    const fonts = Promise.all([document.fonts.load("24px ChannelArimo"), document.fonts.load("24px ChannelVT")]).catch(() => {});
    const first = new Promise((resolve) => {
      const img = covers[START];
      if (img.complete && img.naturalWidth) resolve();
      else {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      }
    });
    await Promise.race([Promise.all([fonts, first]), new Promise((r) => setTimeout(r, 3000))]);
    if (destroyed) return;
    if (covers[START].complete && covers[START].naturalWidth) gl.addCover(ALBUMS[START].id, covers[START]);
    tuneClock = LEAD + LINES[chan].split(" ").length * WORD + 0.6;
    osdLeft = 3.2;
    announce();
    onChannel(chan + 2);
    ready = true;
    layoutKey = "";
    layout();
    canvas.dataset.ready = "";
    wake();
  };
  boot();

  return {
    degauss,
    async setSound(on) {
      if (on && !sound) sound = createChannelSound("/blog/audio/friday-beat.wav");
      if (!sound) return false;
      return sound.setEnabled(on, chan);
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      keyTarget.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      sound?.destroy();
      gl.dispose();
      canvas.remove();
    },
  };
}
