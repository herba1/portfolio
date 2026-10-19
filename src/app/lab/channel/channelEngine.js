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
const STEP = 360 / COUNT;

const mod = (n, m) => ((n % m) + m) % m;

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.append(node);
  return node;
}

export function createChannel(stage, { embedded = false, caption = null, onLive = () => {}, onFail = () => {} } = {}) {
  const set = el("div", "channel-set", stage);
  el("div", "channel-body", set);
  const bezel = el("div", "channel-bezel", set);
  const canvas = el("canvas", "channel-canvas", bezel);
  const gl = createChannelGL(canvas);
  if (!gl) {
    set.remove();
    onFail();
    return { destroy() {}, setSound: async () => false };
  }
  const dial = el("div", "channel-dial", set);
  const nums = ALBUMS.map((_, i) => {
    const n = el("span", "channel-num", dial);
    n.textContent = String(i + 2);
    n.style.setProperty("--a", `${i * STEP}deg`);
    return n;
  });
  const knob = el("div", "channel-knob", dial);
  knob.tabIndex = 0;
  knob.setAttribute("role", "slider");
  knob.setAttribute("aria-label", "Channel");
  knob.setAttribute("aria-valuemin", "2");
  knob.setAttribute("aria-valuemax", String(COUNT + 1));
  const cap = el("div", "channel-knob-cap", knob);
  el("div", "channel-knob-mark", cap);
  const degaussWrap = el("div", "channel-degauss-wrap", set);
  const degaussBtn = el("button", "channel-degauss", degaussWrap);
  degaussBtn.type = "button";
  degaussBtn.setAttribute("aria-label", "Degauss");
  const degaussLabel = el("span", "channel-degauss-label", degaussWrap);
  degaussLabel.textContent = "degauss";
  const led = el("div", "channel-led", set);
  el("div", "channel-grille", set);

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
  let S = 600;
  let screenW = 600;
  let screenH = 450;
  let scale = 1;
  let chan = START;
  let knobPos = START * STEP;
  let knobVel = 0;
  let knobTarget = START * STEP;
  let drag = null;
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

  const layout = () => {
    const sr = stage.getBoundingClientRect();
    if (!sr.width || !sr.height) return;
    const key = `${Math.round(sr.width)}x${Math.round(sr.height)}x${window.devicePixelRatio}`;
    if (key === layoutKey) return;
    layoutKey = key;
    const narrow = sr.width < 700;
    const side = narrow ? 16 : 32;
    if (caption) {
      caption.style.left = `${side}px`;
      caption.style.width = `${sr.width - side * 2}px`;
    }
    const capBottom = caption ? caption.getBoundingClientRect().bottom - sr.top : 0;
    const top = caption ? capBottom + 24 : side;
    const bottom = caption ? (narrow ? 56 : 64) : side;
    const availW = sr.width - side * 2;
    const availH = sr.height - top - bottom;
    const tall = narrow && availH > availW;
    S = tall ? Math.min(availW / 1.1, availH / 1.2) : Math.min(availW / 1.42, availH / 0.86, 820);
    S = Math.max(200, Math.floor(S));
    const bodyW = S * (tall ? 1.1 : 1.42);
    const bodyH = S * (tall ? 1.2 : 0.86);
    const left = Math.round((sr.width - bodyW) / 2);
    const y = Math.round(top + Math.max(0, (availH - bodyH) * 0.4));
    set.dataset.layout = tall ? "tall" : "wide";
    set.style.setProperty("--s", `${S}px`);
    set.style.left = `${left}px`;
    set.style.top = `${y}px`;
    if (caption && !narrow) {
      caption.style.left = `${left}px`;
      caption.style.width = `${Math.round(bodyW)}px`;
    }
    screenW = Math.round(S);
    screenH = Math.round(S * 0.75);
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
    const fs = Math.round(screenH * 0.064);
    cx.setTransform(cs, 0, 0, cs, 0, 0);
    cx.font = `${fs}px ChannelArimo, Arial, sans-serif`;
    const words = LINES[chan].split(" ");
    const maxW = screenW * 0.62;
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
    const baseY = screenH * 0.82 - (rows.length - 1) * lh;
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
    const key = `${chan}:${shown}:${osd ? 1 : 0}:${capCanvas.width}`;
    if (key === capKey) return;
    capKey = key;
    const cs = capCanvas.width / screenW;
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.clearRect(0, 0, capCanvas.width, capCanvas.height);
    cx.setTransform(cs, 0, 0, cs, 0, 0);
    const { fs, words } = layoutWords();
    cx.font = `${fs}px ChannelArimo, Arial, sans-serif`;
    cx.textBaseline = "alphabetic";
    cx.shadowColor = "rgba(0, 0, 0, 0.42)";
    cx.shadowBlur = fs * 0.3;
    cx.shadowOffsetY = fs * 0.04;
    cx.fillStyle = "#fffdf6";
    for (let i = 0; i < Math.min(shown, words.length); i += 1) cx.fillText(words[i].text, words[i].x, words[i].y);
    cx.shadowColor = "transparent";
    if (osd) {
      const os = Math.round(screenH * 0.1);
      cx.font = `${os}px ChannelVT, monospace`;
      cx.textAlign = "right";
      const label = `CH ${String(chan + 2).padStart(2, "0")}`;
      cx.lineWidth = os * 0.12;
      cx.strokeStyle = "rgba(0, 0, 0, 0.85)";
      cx.lineJoin = "round";
      cx.strokeText(label, screenW * 0.9, screenH * 0.17);
      cx.fillStyle = "#74ff6a";
      cx.fillText(label, screenW * 0.9, screenH * 0.17);
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

  const tune = (index) => {
    const next = mod(index, COUNT);
    if (next === chan) return;
    chan = next;
    tuneClock = 0;
    osdLeft = 2.6;
    wordsCache = null;
    sound?.detent();
    sound?.retune(chan);
    knob.setAttribute("aria-valuenow", String(chan + 2));
    knob.setAttribute("aria-valuetext", `Channel ${chan + 2}, ${ALBUMS[chan].title}`);
    nums.forEach((n, i) => (i === chan ? n.setAttribute("data-on", "") : n.removeAttribute("data-on")));
    onLive(`Channel ${chan + 2}: ${ALBUMS[chan].title}`);
    wake();
  };

  const step = (dir) => {
    const idx = Math.round(knobTarget / STEP) + dir;
    knobTarget = idx * STEP;
    tune(idx);
    wake();
  };

  const degauss = () => {
    degaussClock = 0;
    sound?.degauss();
    led.dataset.flash = "";
    window.setTimeout(() => led.removeAttribute("data-flash"), 260);
    wake();
  };

  const frame = () => {
    const now = performance.now();
    raf = 0;
    if (destroyed || !visible || !onscreen) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    if (!drag) {
      const k = 210;
      const c = 2 * Math.sqrt(k);
      knobVel += ((knobTarget - knobPos) * k - knobVel * c) * dt;
      knobPos += knobVel * dt;
      if (Math.abs(knobTarget - knobPos) < 0.01 && Math.abs(knobVel) < 0.01) {
        knobPos = knobTarget;
        knobVel = 0;
      }
    }
    knob.style.transform = `rotate(${knobPos}deg)`;
    tuneClock += dt;
    degaussClock += dt;
    osdLeft -= dt;
    const tt = tuneClock;
    const stat = tt < 0.14 ? 1 : tt < 0.46 ? 1 - smooth((tt - 0.14) / 0.32) : 0;
    const p = Math.min(1, Math.max(0, (tt - 0.1) / 0.78));
    const roll = p > 0 && p < 1 ? 1 - Math.pow(1 - p, 3) : 0;
    const bar = p > 0 && p < 1 ? 1 - p * p : 0;
    const dg = degaussClock;
    const degaussAmt = dg < 2.4 ? Math.exp(-dg * 2.1) * (dg < 0.05 ? dg / 0.05 : 1) : 0;
    drawCaption(wordsShown(tt), osdLeft > 0);
    const t = now / 1000;
    const seed = chan * 1.7 + 0.4;
    const ken = [1.07 + 0.05 * (0.5 + 0.5 * Math.sin(t * 0.09 + seed)), 0.024 * Math.sin(t * 0.05 + seed * 1.3), 0.055 * Math.sin(t * 0.06 + seed * 2.1)];
    gl.render({ cover: ALBUMS[chan].id, screenW, screenH, time: t % 1000, static: Math.max(stat, gl.hasCover(ALBUMS[chan].id) ? 0 : 0.85), roll, bar, degauss: degaussAmt, ken, curve: 0.06 });
    sound?.levels(Math.max(stat, bar * 0.12), (1 - stat) * (1 - bar * 0.6));
    raf = requestAnimationFrame(frame);
  };

  function smooth(x) {
    const v = Math.min(1, Math.max(0, x));
    return v * v * (3 - 2 * v);
  }

  function wake() {
    if (destroyed || raf || !visible || !onscreen || !ready) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const angleOf = (e) => {
    const r = knob.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  };

  const magnet = (raw) => {
    const near = Math.round(raw / STEP) * STEP;
    const d = raw - near;
    const half = STEP / 2;
    return near + Math.sign(d) * half * Math.pow(Math.abs(d) / half, 1.8);
  };

  const onKnobDown = (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    knob.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, last: angleOf(e), raw: knobTarget, moved: 0, x: e.clientX, y: e.clientY };
    knob.dataset.grab = "";
    wake();
  };

  const onKnobMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const a = angleOf(e);
    let d = a - drag.last;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    drag.last = a;
    d = Math.max(-40, Math.min(40, d));
    drag.raw += d;
    drag.moved += Math.abs(d);
    knobPos = magnet(drag.raw);
    knobVel = 0;
    const idx = Math.round(drag.raw / STEP);
    if (mod(idx, COUNT) !== chan) tune(idx);
    wake();
  };

  const onKnobUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    knob.removeAttribute("data-grab");
    const tap = d.moved < 4 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6;
    if (tap && e.type === "pointerup") {
      step(1);
      return;
    }
    knobTarget = Math.round(d.raw / STEP) * STEP;
    wake();
  };

  const onScreenDown = (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    step(1);
  };

  const onWheel = (e) => {
    if (embedded) return;
    e.preventDefault();
    wheelAcc += Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    while (Math.abs(wheelAcc) >= 50) {
      step(Math.sign(wheelAcc));
      wheelAcc -= Math.sign(wheelAcc) * 50;
    }
  };

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && t !== knob && t !== document.body && t.closest?.("input, textarea, a, button:not(.channel-degauss)")) return;
    if (t && t.isContentEditable) return;
    const k = e.key;
    if (k === "ArrowUp" || k === "ArrowRight" || k === "PageUp") step(1);
    else if (k === "ArrowDown" || k === "ArrowLeft" || k === "PageDown") step(-1);
    else if (k === "d" || k === "D") degauss();
    else return;
    e.preventDefault();
  };

  const onDegaussDown = () => {
    sound?.press();
  };

  const onDegauss = () => {
    degauss();
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
  };

  knob.addEventListener("pointerdown", onKnobDown);
  knob.addEventListener("pointermove", onKnobMove);
  knob.addEventListener("pointerup", onKnobUp);
  knob.addEventListener("pointercancel", onKnobUp);
  canvas.addEventListener("pointerdown", onScreenDown);
  set.addEventListener("wheel", onWheel, { passive: false });
  degaussBtn.addEventListener("pointerdown", onDegaussDown);
  degaussBtn.addEventListener("click", onDegauss);
  const keyTarget = embedded ? set : window;
  keyTarget.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisibility);
  const ro = new ResizeObserver(() => {
    if (ready) layout();
  });
  ro.observe(stage);
  const io = new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    if (onscreen) wake();
  });
  io.observe(set);

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
    knob.setAttribute("aria-valuenow", String(chan + 2));
    knob.setAttribute("aria-valuetext", `Channel ${chan + 2}, ${ALBUMS[chan].title}`);
    nums[chan].setAttribute("data-on", "");
    ready = true;
    layout();
    set.dataset.ready = "";
    wake();
  };
  boot();

  return {
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
      knob.removeEventListener("pointerdown", onKnobDown);
      knob.removeEventListener("pointermove", onKnobMove);
      knob.removeEventListener("pointerup", onKnobUp);
      knob.removeEventListener("pointercancel", onKnobUp);
      canvas.removeEventListener("pointerdown", onScreenDown);
      set.removeEventListener("wheel", onWheel);
      degaussBtn.removeEventListener("pointerdown", onDegaussDown);
      degaussBtn.removeEventListener("click", onDegauss);
      keyTarget.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      sound?.destroy();
      gl.dispose();
      set.remove();
    },
  };
}
