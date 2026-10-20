import { createSpectroSound } from "./spectroAudio";
import { createSpectrum } from "./spectroFFT";
import { SpectroSynth } from "./spectroSynth";
import { createRaster } from "./spectroText";

const ROWS = 64;
const F_LO = 600;
const F_HI = 7200;
const COL_RATE = 72;
const FFT = 2048;
const SIM_RATE = 48000;
const FLOOR_DB = -104;
const RANGE_DB = 62;
const IDLE = 6;
const MAX_BACKLOG = 7;

const LINES = [
  "it will take a while to feel like this again",
  "i keep your voice on the walk home",
  "you don't have to be anyone tonight",
  "nothing good comes easy but it comes",
  "we can stay out till the streetlights go soft",
];

const GROUND = [9, 9, 8];
const INK = [242, 239, 230];

const allowed = (ch) => /^[a-z0-9 .,!?'’\-:;&]$/i.test(ch);

export function createSpectrogram(stage, { embedded = false, input = null, onLive = () => {} } = {}) {
  const root = document.createElement("div");
  root.className = "spectrogram-screen";
  if (embedded) root.tabIndex = 0;
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", "A spectrogram of the sound, spelling the words it plays");
  const canvas = document.createElement("canvas");
  canvas.className = "spectrogram-canvas";
  root.append(canvas);
  stage.append(root);
  const ctx = canvas.getContext("2d", { alpha: false });
  const ring = document.createElement("canvas");
  const rctx = ring.getContext("2d", { alpha: false });

  const freqs = new Float64Array(ROWS);
  const gains = new Float64Array(ROWS);
  for (let i = 0; i < ROWS; i += 1) {
    freqs[i] = F_HI * Math.pow(F_LO / F_HI, i / (ROWS - 1));
    gains[i] = 0.03 * Math.sqrt(F_LO / freqs[i]);
  }
  const sim = new SpectroSynth(freqs, gains, COL_RATE);
  const fft = createSpectrum(FFT);
  const simBuf = new Float32Array(SIM_RATE);
  const raster = createRaster({ rows: ROWS, fontPx: 52, baseline: 47, spacing: 4, family: "SpectroSans, Arial, sans-serif" });

  let sound = null;
  let soundState = "off";
  let W = 0;
  let H = 0;
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let speed = 200;
  let head = 0;
  let carry = 0;
  let rowBinLo = new Float32Array(0);
  let rowBinHi = new Float32Array(0);
  let rowTilt = new Float32Array(0);
  let mapRate = 0;
  let prevV = new Float32Array(0);
  let curV = new Float32Array(0);
  let img = null;
  let dither = new Float32Array(0);
  let fade = null;
  let vfade = null;
  let raf = 0;
  let last = 0;
  let clock = 0;
  let visible = !document.hidden;
  let onscreen = true;
  let destroyed = false;
  let ready = false;
  let mode = "attract";
  let lineIndex = 0;
  let typedUntil = 0;
  let typedLine = "";
  let lastInput = "";

  const fOf = (y, bandTop, rowH) => F_HI * Math.pow(F_LO / F_HI, (y - bandTop - rowH * 0.5) / ((ROWS - 1) * rowH));

  let band = { top: 0, h: 0, rowH: 1 };

  const buildRowMap = (sampleRate) => {
    mapRate = sampleRate;
    const binHz = sampleRate / FFT;
    rowBinLo = new Float32Array(H);
    rowBinHi = new Float32Array(H);
    rowTilt = new Float32Array(H);
    for (let y = 0; y < H; y += 1) {
      const yc = (y + 0.5) / dpr;
      const f0 = fOf(yc - 0.5 / dpr, band.top, band.rowH);
      const f1 = fOf(yc + 0.5 / dpr, band.top, band.rowH);
      const fc = fOf(yc, band.top, band.rowH);
      const lo = Math.min(f0, f1) / binHz;
      const hi = Math.max(f0, f1) / binHz;
      rowBinLo[y] = Math.max(0, Math.min(FFT / 2 - 2, lo));
      rowBinHi[y] = Math.max(0, Math.min(FFT / 2 - 2, hi));
      const outside = Math.max(band.top - yc, yc - (band.top + band.h), 0) / (band.h * 0.85);
      const nyq = fc > sampleRate * 0.46 ? 200 : 0;
      rowTilt[y] = Math.max(-8, Math.min(12, 10 * Math.log10(Math.max(1, fc) / F_LO))) - 46 * outside * outside - nyq - (fc < 140 ? 200 : 0);
    }
  };

  const layout = () => {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    const nw = Math.round(r.width);
    const nh = Math.round(r.height);
    if (nw === cssW && nh === cssH && nextDpr === dpr && W) return false;
    cssW = nw;
    cssH = nh;
    dpr = nextDpr;
    W = Math.round(cssW * dpr);
    H = Math.round(cssH * dpr);
    canvas.width = W;
    canvas.height = H;
    ring.width = W;
    ring.height = H;
    rctx.fillStyle = `rgb(${GROUND.join(",")})`;
    rctx.fillRect(0, 0, W, H);
    head = 0;
    carry = 0;
    const bandH = Math.max(110, Math.min(300, cssH * 0.31, cssW * 0.36));
    const rowH = bandH / ROWS;
    band = { top: Math.round(cssH * 0.5 - bandH * 0.56), h: bandH, rowH };
    speed = COL_RATE * rowH;
    buildRowMap(sound && sound.live ? sound.sampleRate : SIM_RATE);
    prevV = new Float32Array(H);
    curV = new Float32Array(H);
    img = rctx.createImageData(48, H);
    dither = new Float32Array(H * 48);
    let seed = 7;
    for (let i = 0; i < dither.length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      dither[i] = (seed / 4294967296 - 0.5) * 1.6;
    }
    const g = ctx.createLinearGradient(0, 0, W * 0.26, 0);
    const stops = [0, 0.18, 0.36, 0.54, 0.72, 0.86, 1];
    for (const s of stops) {
      const a = Math.pow(1 - s, 2.2);
      g.addColorStop(s, `rgba(${GROUND.join(",")},${a.toFixed(4)})`);
    }
    fade = g;
    const vg = ctx.createLinearGradient(0, 0, 0, H);
    const edge = Math.min(0.3, (band.top * dpr * 0.9) / H);
    for (let k = 0; k <= 6; k += 1) {
      const s = k / 6;
      const a = Math.pow(1 - s, 2);
      vg.addColorStop(s * edge, `rgba(${GROUND.join(",")},${a.toFixed(4)})`);
      vg.addColorStop(1 - s * edge, `rgba(${GROUND.join(",")},${a.toFixed(4)})`);
    }
    vfade = vg;
    return true;
  };

  const intensities = (db, target) => {
    for (let y = 0; y < H; y += 1) {
      const lo = rowBinLo[y];
      const hi = rowBinHi[y];
      const c = (lo + hi) * 0.5;
      const i = Math.floor(c);
      const f = c - i;
      const v = db[i] + (db[i + 1] - db[i]) * f;
      let n = (v + rowTilt[y] - FLOOR_DB) / RANGE_DB;
      n = n < 0 ? 0 : n > 1 ? 1 : n;
      target[y] = Math.pow(n, 2.1);
    }
  };

  const writeColumns = (count) => {
    const data = img.data;
    let left = count;
    while (left > 0) {
      const n = Math.min(left, 48);
      for (let j = 0; j < n; j += 1) {
        const t = (count - left + j + 1) / count;
        for (let y = 0; y < H; y += 1) {
          const v = prevV[y] + (curV[y] - prevV[y]) * t;
          const d = dither[y * 48 + j];
          const o = (y * 48 + j) * 4;
          data[o] = GROUND[0] + (INK[0] - GROUND[0]) * v + d;
          data[o + 1] = GROUND[1] + (INK[1] - GROUND[1]) * v + d;
          data[o + 2] = GROUND[2] + (INK[2] - GROUND[2]) * v + d;
          data[o + 3] = 255;
        }
      }
      const room = W - head;
      if (n <= room) {
        rctx.putImageData(img, head, 0, 0, 0, n, H);
      } else {
        rctx.putImageData(img, head, 0, 0, 0, room, H);
        rctx.putImageData(img, -room, 0, room, 0, n - room, H);
      }
      head = (head + n) % W;
      left -= n;
    }
    const swap = prevV;
    prevV = curV;
    curV = swap;
  };

  const queue = (built) => {
    sim.push(built.data, built.cols);
    sound?.push(built.data, built.cols);
  };

  const scheduleAttract = () => {
    if (mode !== "attract") return;
    if (sim.remaining() > 4) return;
    const text = LINES[lineIndex % LINES.length];
    lineIndex += 1;
    queue(raster.line(text));
    queue(raster.gap(1.4, COL_RATE));
    onLive(text);
  };

  let lastCt = 0;
  let pace = 1;
  let paceN = 0;

  const audioInStep = (dt) => {
    if (!sound || !sound.live) {
      lastCt = 0;
      return false;
    }
    const ct = sound.currentTime;
    if (lastCt) {
      pace += ((ct - lastCt) / dt - pace) * 0.08;
      paceN += 1;
    }
    lastCt = ct;
    return paceN > 8 && pace > 0.8 && pace < 1.25;
  };

  const spectrumNow = (dt) => {
    if (audioInStep(dt)) {
      if (mapRate !== sound.sampleRate) buildRowMap(sound.sampleRate);
      sim.advance(Math.round(dt * SIM_RATE), SIM_RATE);
      return sound.read();
    }
    if (mapRate !== SIM_RATE) buildRowMap(SIM_RATE);
    const count = Math.min(simBuf.length, Math.round(dt * SIM_RATE));
    sim.render(simBuf, count, SIM_RATE);
    fft.write(simBuf, count);
    return fft.compute();
  };

  const step = (dt) => {
    clock += dt;
    if (mode === "typed" && clock > typedUntil + IDLE && sim.remaining() < 1) {
      mode = "attract";
      typedLine = "";
    }
    scheduleAttract();
    const db = spectrumNow(dt);
    intensities(db, curV);
    carry += speed * dt * dpr;
    const n = Math.floor(carry);
    carry -= n;
    if (n > 0) writeColumns(n);
  };

  const composite = () => {
    const tail = W - head;
    ctx.drawImage(ring, head, 0, tail, H, 0, 0, tail, H);
    if (head > 0) ctx.drawImage(ring, 0, 0, head, H, tail, 0, head, H);
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W * 0.26, H);
    ctx.fillStyle = vfade;
    ctx.fillRect(0, 0, W, H);
  };

  const frame = () => {
    raf = 0;
    if (destroyed) return;
    const now = performance.now();
    const cap = sound && sound.live && pace > 0.8 && pace < 1.25 ? 0.25 : 1 / 20;
    const dt = Math.min(cap, Math.max(0.001, (now - last) / 1000));
    last = now;
    step(dt);
    composite();
    raf = requestAnimationFrame(frame);
  };

  const wake = () => {
    if (destroyed || raf || !visible || !onscreen || !ready) return;
    last = performance.now();
    lastCt = 0;
    paceN = 0;
    sound?.resume();
    raf = requestAnimationFrame(frame);
  };

  const sleep = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    sound?.suspend();
  };

  const startSound = () => {
    if (soundState !== "off") return;
    soundState = "starting";
    sound = createSpectroSound({ freqs, gains, colRate: COL_RATE, fftSize: FFT });
    if (!sound) {
      soundState = "failed";
      return;
    }
    sound.enable(() => sim.snapshot()).then((ok) => {
      soundState = ok ? "on" : "failed";
      if (!ok) {
        sound?.destroy();
        sound = null;
      }
    });
  };

  const typeChar = (ch) => {
    if (mode !== "typed") {
      mode = "typed";
      sim.clear();
      sound?.clear();
      queue(raster.gap(0.55, COL_RATE));
      typedLine = "";
    }
    if (sim.remaining() > MAX_BACKLOG * COL_RATE) return;
    queue(raster.glyph(ch));
    typedLine = (typedLine + ch).slice(-48);
    typedUntil = clock + sim.remaining() / COL_RATE;
  };

  const breakLine = () => {
    if (mode !== "typed") return;
    if (typedLine.trim()) onLive(typedLine.trim());
    typedLine = "";
    queue(raster.gap(0.5, COL_RATE));
    typedUntil = clock + sim.remaining() / COL_RATE;
  };

  const editable = (t) => t && t !== root && t !== document.body && t !== input && (t.closest?.("button, input, textarea, a, select") || t.isContentEditable);

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target === input || editable(e.target)) return;
    if (e.key === "Enter") {
      startSound();
      breakLine();
      e.preventDefault();
    } else if (e.key.length === 1 && allowed(e.key)) {
      startSound();
      typeChar(e.key.toLowerCase());
      e.preventDefault();
    }
  };

  const onInput = () => {
    startSound();
    const value = input.value;
    if (value.length > lastInput.length && value.startsWith(lastInput)) {
      for (const ch of value.slice(lastInput.length)) if (allowed(ch)) typeChar(ch.toLowerCase());
    } else if (value.length > lastInput.length) {
      const ch = value[value.length - 1];
      if (allowed(ch)) typeChar(ch.toLowerCase());
    }
    lastInput = value;
    if (value.length > 40) {
      input.value = "";
      lastInput = "";
    }
  };

  const onInputKey = (e) => {
    if (e.key === "Enter") {
      startSound();
      breakLine();
      input.value = "";
      lastInput = "";
    }
  };

  const onDown = () => {
    startSound();
    if (input) input.focus({ preventScroll: true });
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
    else sleep();
  };

  root.addEventListener("pointerdown", onDown);
  const keyTarget = embedded ? root : window;
  keyTarget.addEventListener("keydown", onKey);
  input?.addEventListener("input", onInput);
  input?.addEventListener("keydown", onInputKey);
  document.addEventListener("visibilitychange", onVisibility);
  const ro = new ResizeObserver(() => {
    if (ready && layout()) preroll(0.4);
  });
  ro.observe(stage);
  const io = new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    if (onscreen) wake();
    else sleep();
  });
  io.observe(root);

  const preroll = (fraction) => {
    const seconds = (cssW * fraction) / speed;
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i += 1) step(1 / 60);
  };

  const begin = () => {
    if (destroyed) return;
    layout();
    queue(raster.gap((cssW * 0.3) / speed, COL_RATE));
    preroll(1.04);
    composite();
    ready = true;
    root.dataset.ready = "";
    wake();
  };

  const fontReady = document.fonts && document.fonts.load ? document.fonts.load("500 52px SpectroSans") : Promise.resolve();
  Promise.race([fontReady, new Promise((r) => setTimeout(r, 1500))]).then(begin, begin);

  return {
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      io.disconnect();
      root.removeEventListener("pointerdown", onDown);
      keyTarget.removeEventListener("keydown", onKey);
      input?.removeEventListener("input", onInput);
      input?.removeEventListener("keydown", onInputKey);
      document.removeEventListener("visibilitychange", onVisibility);
      sound?.destroy();
      root.remove();
    },
  };
}
