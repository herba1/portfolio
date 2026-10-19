import { createStretchSound } from "./stretchAudio";

const FAMILY = "StretchSerif";
const HSCALE = 0.42;
const DEFAULT_LINE = "to run away";
const MAX_CHARS = 28;
const INK = "#f4eef7";
const RETURN_OMEGA = 4.2;
const FRICTION = 4.6;
const FLICK = 650;
const MAX_FLING = 2400;
const TICK_STEP = 7;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function gradePhoto(img, w, h, focusY) {
  const k = Math.min(1, 960 / Math.max(w, h));
  const cw = Math.max(2, Math.round(w * k));
  const ch = Math.max(2, Math.round(h * k));
  const work = document.createElement("canvas");
  work.width = cw;
  work.height = ch;
  const c = work.getContext("2d", { willReadFrequently: true });
  const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight) * 1.04;
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  const dx = (cw - dw) / 2;
  const dy = clamp(ch / 2 - dh * focusY, ch - dh, 0);
  c.drawImage(img, dx, dy, dw, dh);
  const frame = c.getImageData(0, 0, cw, ch);
  const px = frame.data;
  let seed = 4242;
  const cx = cw / 2;
  const cy = ch * 0.48;
  const rmax = Math.hypot(cx, cy);
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      const i = (y * cw + x) * 4;
      let r = px[i] / 255;
      let g = px[i + 1] / 255;
      let b = px[i + 2] / 255;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = lum + (r - lum) * 0.58;
      g = lum + (g - lum) * 0.58;
      b = lum + (b - lum) * 0.58;
      r = Math.pow(r * 0.5, 1.42);
      g = Math.pow(g * 0.5, 1.4);
      b = Math.pow(b * 0.52, 1.3);
      const dist = Math.hypot(x - cx, (y - cy) * 1.15) / rmax;
      const vig = 1 - 0.62 * Math.pow(clamp(dist, 0, 1), 2.2);
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const grain = ((seed / 4294967296) - 0.5) * 0.045;
      px[i] = clamp((r * vig + 0.012 + grain) * 255, 0, 255);
      px[i + 1] = clamp((g * vig + 0.014 + grain) * 255, 0, 255);
      px[i + 2] = clamp((b * vig + 0.032 + grain) * 255, 0, 255);
    }
  }
  c.putImageData(frame, 0, 0);
  return work;
}

export function createStretch(stage, { image, input, caret, onLive }) {
  const box = stage.closest(".piece-box") || stage;
  const bg = document.createElement("canvas");
  bg.className = "stretch-bg";
  bg.setAttribute("aria-hidden", "true");
  const fg = document.createElement("canvas");
  fg.className = "stretch-fg";
  fg.setAttribute("role", "img");
  stage.prepend(fg);
  stage.prepend(bg);
  const bctx = bg.getContext("2d");
  const fctx = fg.getContext("2d");
  const mid = document.createElement("canvas");
  const mctx = mid.getContext("2d");
  const glow = document.createElement("canvas");
  const gctx = glow.getContext("2d");
  const measure = document.createElement("canvas").getContext("2d");

  let W = 0;
  let H = 0;
  let dpr = 1;
  let photo = null;
  let fontReady = false;
  let line = DEFAULT_LINE;
  let glyphs = [];
  let F = 100;
  let baseline = 0;
  let lineLeft = 0;
  let lineWidth = 0;
  let ascent = 0;
  let descent = 0;
  let raf = 0;
  let last = 0;
  let visible = true;
  let destroyed = false;
  let drag = null;
  let hover = null;
  let sound = null;
  let soundOn = false;
  let seededDefault = false;

  const panOf = (gl) => clamp(((gl.hx + gl.hw / 2) / Math.max(1, W)) * 2 - 1, -1, 1) * 0.7;

  const font = (size) => `400 ${size}px "${FAMILY}", "Times New Roman", serif`;

  const limits = (gl) => ({
    min: -Math.max(0, gl.y + gl.g - 16 - (gl.g - gl.inkTop)),
    max: Math.max(0, H - 16 - (gl.y + gl.inkBottom)),
  });

  const buildSprite = (ch, adv, s) => {
    const padX = F * 0.14;
    const padY = F * 0.06;
    const w = adv * HSCALE + padX * 2;
    const h = ascent + descent + padY * 2;
    const sprite = document.createElement("canvas");
    sprite.width = Math.max(1, Math.ceil(w * s));
    sprite.height = Math.max(1, Math.ceil(h * s));
    const c = sprite.getContext("2d");
    c.setTransform(s, 0, 0, s, 0, 0);
    c.translate(padX, padY + ascent);
    c.scale(HSCALE, 1);
    c.font = font(F);
    c.fillStyle = INK;
    c.textBaseline = "alphabetic";
    c.fillText(ch, 0, 0);
    measure.font = font(F);
    const m = measure.measureText(ch);
    return {
      sprite,
      w,
      h,
      padX,
      padY,
      inkTop: padY + ascent - m.actualBoundingBoxAscent,
      inkBottom: padY + ascent + m.actualBoundingBoxDescent,
    };
  };

  const layout = (prev = []) => {
    if (!fontReady || !W) return;
    measure.font = font(100);
    const w100 = Math.max(1, measure.measureText(line || " ").width);
    const narrow = W < 700;
    const maxW = narrow ? W * 0.84 : Math.min(W * 0.44, 640);
    const oldF = F;
    F = Math.min(H * (narrow ? 0.26 : 0.36), maxW / ((w100 / 100) * HSCALE));
    measure.font = font(F);
    const tall = measure.measureText("Hdfklt");
    const deep = measure.measureText("gjpqy");
    ascent = tall.actualBoundingBoxAscent * 1.04;
    descent = deep.actualBoundingBoxDescent * 1.06;
    lineWidth = measure.measureText(line).width * HSCALE;
    lineLeft = (W - lineWidth) / 2;
    baseline = H * (narrow ? 0.47 : 0.5) + F * 0.2;
    const s = Math.max(1, dpr * 0.85);
    const ratio = oldF ? F / oldF : 1;
    const chars = Array.from(line);
    let prefix = "";
    glyphs = chars.map((ch, i) => {
      const x0 = measure.measureText(prefix).width;
      prefix += ch;
      const x1 = measure.measureText(prefix).width;
      const adv = Math.max(0, x1 - x0);
      const space = ch.trim() === "";
      const sp = space ? null : buildSprite(ch, adv, s);
      const old = prev[i] && prev[i].ch === ch ? prev[i] : null;
      const gl = {
        ch,
        space,
        s,
        hx: lineLeft + x0 * HSCALE,
        hw: adv * HSCALE,
        x: lineLeft + x0 * HSCALE - (sp ? sp.padX : 0),
        y: baseline - ascent - (sp ? sp.padY : 0),
        ...(sp || { sprite: null, w: 0, h: 0, inkTop: 0, inkBottom: 0 }),
        g: old ? old.g * ratio : 0,
        d: old ? old.d * ratio : 0,
        v: 0,
        mode: old ? (old.mode === "drag" ? "return" : old.mode) : "rest",
        alpha: old ? old.alpha : 0,
        acc: 0,
      };
      return gl;
    });
    for (const gl of glyphs) {
      if (gl.space) continue;
      const lim = limits(gl);
      gl.d = clamp(gl.d, lim.min, lim.max);
    }
    if (!seededDefault && line === DEFAULT_LINE) {
      seededDefault = true;
      const y = glyphs[glyphs.length - 1];
      if (y && !y.space) {
        y.g = y.padY + ascent + descent * 0.36;
        y.d = Math.min(H * 0.24, limits(y).max * 0.8);
        y.mode = "held";
        for (const gl of glyphs) gl.alpha = 1;
      }
    }
    fg.setAttribute("aria-label", line || "empty line");
    placeCaret();
  };

  const placeCaret = () => {
    if (!caret) return;
    const x = line ? lineLeft + lineWidth + F * 0.04 : W / 2;
    caret.style.transform = `translate3d(${x}px, ${baseline - ascent * 0.8}px, 0)`;
    caret.style.height = `${ascent * 0.86}px`;
  };

  const drawGlyph = (gl) => {
    const { sprite, s } = gl;
    const sw = sprite.width;
    const sh = sprite.height;
    const x = Math.round(gl.x * dpr) / dpr;
    const y = Math.round(gl.y * dpr) / dpr;
    const seam = 1 / dpr;
    const w = sw / s;
    const h = sh / s;
    const d = gl.d;
    fctx.globalAlpha = gl.alpha;
    if (Math.abs(d) < 0.25) {
      fctx.drawImage(sprite, x, y, w, h);
      return;
    }
    const row = clamp(Math.round(gl.g * s), 0, sh - 1);
    const top = row / s;
    if (d > 0) {
      if (row > 0) fctx.drawImage(sprite, 0, 0, sw, row, x, y, w, top);
      fctx.drawImage(sprite, 0, row, sw, 1, x, y + top - seam, w, d + seam * 2);
      fctx.drawImage(sprite, 0, row, sw, sh - row, x, y + top + d, w, h - top);
    } else {
      const e = -d;
      if (row > 0) fctx.drawImage(sprite, 0, 0, sw, row, x, y - e, w, top);
      fctx.drawImage(sprite, 0, row, sw, 1, x, y + top - e - seam, w, e + seam * 2);
      fctx.drawImage(sprite, 0, row, sw, sh - row, x, y + top, w, h - top);
    }
  };

  const render = () => {
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.globalCompositeOperation = "source-over";
    fctx.globalAlpha = 1;
    fctx.clearRect(0, 0, fg.width, fg.height);
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fctx.imageSmoothingEnabled = true;
    for (const gl of glyphs) if (!gl.space && gl.alpha > 0) drawGlyph(gl);
    fctx.globalAlpha = 1;
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, mid.width, mid.height);
    mctx.drawImage(fg, 0, 0, mid.width, mid.height);
    gctx.clearRect(0, 0, glow.width, glow.height);
    gctx.drawImage(mid, 0, 0, glow.width, glow.height);
    fctx.globalCompositeOperation = "destination-over";
    fctx.globalAlpha = 0.3;
    fctx.drawImage(glow, 0, 0, fg.width, fg.height);
    fctx.globalAlpha = 0.22;
    fctx.drawImage(mid, 0, 0, fg.width, fg.height);
    fctx.globalAlpha = 1;
    fctx.globalCompositeOperation = "source-over";
  };

  const drawBg = () => {
    if (!photo || !W) return;
    const graded = gradePhoto(photo, W, H, W < 700 ? 0.44 : 0.4);
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = "high";
    bctx.drawImage(graded, 0, 0, bg.width, bg.height);
  };

  const resize = () => {
    const rect = box.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [bg, fg]) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c.style.width = `${W}px`;
      c.style.height = `${H}px`;
    }
    mid.width = Math.max(1, Math.round(W / 3));
    mid.height = Math.max(1, Math.round(H / 3));
    glow.width = Math.max(1, Math.round(W / 10));
    glow.height = Math.max(1, Math.round(H / 10));
    drawBg();
    layout(glyphs);
    render();
  };

  const tickFor = (gl, delta, level) => {
    gl.acc += Math.abs(delta);
    if (gl.acc < TICK_STEP) return;
    gl.acc %= TICK_STEP;
    sound?.tick(panOf(gl), clamp(Math.abs(gl.d) / Math.max(1, H * 0.6), 0, 1), level);
  };

  const step = (dt) => {
    let active = false;
    for (const gl of glyphs) {
      if (gl.space) continue;
      if (gl.alpha < 1) {
        gl.alpha = Math.min(1, gl.alpha + dt / 0.22);
        active = true;
      }
      if (gl.mode === "coast") {
        const before = gl.d;
        const lim = limits(gl);
        gl.d += gl.v * dt;
        gl.v *= Math.exp(-FRICTION * dt);
        if (gl.d > lim.max || gl.d < lim.min) {
          gl.d = clamp(gl.d, lim.min, lim.max);
          gl.v = 0;
        }
        tickFor(gl, gl.d - before, 0.55);
        if (Math.abs(gl.v) < 24) {
          gl.v = 0;
          gl.mode = Math.abs(gl.d) < 1 ? "rest" : "held";
          if (gl.mode === "rest") gl.d = 0;
          sound?.settle(panOf(gl), 0.4 + 0.6 * clamp(Math.abs(gl.d) / (H * 0.5), 0, 1));
          onLive?.(`${gl.ch} held at ${Math.round(Math.abs(gl.d))} pixels`);
        } else active = true;
      } else if (gl.mode === "return") {
        const before = gl.d;
        const a = -RETURN_OMEGA * RETURN_OMEGA * gl.d - 2 * RETURN_OMEGA * gl.v;
        gl.v += a * dt;
        gl.d += gl.v * dt;
        if (before !== 0 && Math.sign(gl.d) !== Math.sign(before)) gl.d = 0;
        tickFor(gl, gl.d - before, 0.35);
        if (Math.abs(gl.d) < 0.3) {
          gl.d = 0;
          gl.v = 0;
          gl.mode = "rest";
          sound?.settle(panOf(gl), 0.25);
        } else active = true;
      } else if (gl.mode === "drag") {
        active = true;
      }
    }
    return active;
  };

  const frame = (t) => {
    raf = 0;
    if (destroyed) return;
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60;
    last = t;
    const active = step(dt);
    render();
    if (active && visible) raf = requestAnimationFrame(frame);
    else last = 0;
  };

  const wake = () => {
    if (destroyed || raf || !visible) return;
    raf = requestAnimationFrame(frame);
  };

  const localPoint = (e) => {
    const rect = fg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const hit = (p) => {
    let best = null;
    let bestDist = Infinity;
    for (const gl of glyphs) {
      if (gl.space || gl.alpha < 0.5) continue;
      const top = gl.y + gl.inkTop + Math.min(0, gl.d) - 12;
      const bottom = gl.y + gl.inkBottom + Math.max(0, gl.d) + 12;
      if (p.y < top || p.y > bottom) continue;
      const left = gl.hx - 4;
      const right = gl.hx + gl.hw + 4;
      if (p.x < left || p.x > right) continue;
      const dist = Math.abs(p.x - (gl.hx + gl.hw / 2));
      if (dist < bestDist) {
        bestDist = dist;
        best = gl;
      }
    }
    return best;
  };

  const sourceRow = (gl, localY) => {
    if (Math.abs(gl.d) < 1) return clamp(localY, gl.inkTop + 1, gl.inkBottom - 1);
    return gl.g;
  };

  const focusInput = () => {
    if (!input || document.activeElement === input) return;
    input.focus({ preventScroll: true });
    const n = input.value.length;
    input.setSelectionRange?.(n, n);
  };

  const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const p = localPoint(e);
    const gl = hit(p);
    if (e.pointerType === "mouse") focusInput();
    if (!gl) {
      if (e.pointerType !== "mouse") focusInput();
      return;
    }
    e.preventDefault();
    fg.setPointerCapture?.(e.pointerId);
    const localY = p.y - gl.y;
    gl.g = sourceRow(gl, localY);
    gl.mode = "drag";
    gl.v = 0;
    drag = { gl, id: e.pointerId, startY: p.y, d0: gl.d, samples: [{ t: e.timeStamp, y: p.y }] };
    fg.dataset.grabbing = "";
    sound?.grab(panOf(gl));
    wake();
  };

  const onMove = (e) => {
    const p = localPoint(e);
    if (!drag) {
      if (e.pointerType !== "mouse") return;
      const over = hit(p);
      if (over !== hover) {
        hover = over;
        if (over) fg.dataset.over = "";
        else delete fg.dataset.over;
      }
      return;
    }
    if (e.pointerId !== drag.id) return;
    const { gl } = drag;
    const lim = limits(gl);
    let d = drag.d0 + (p.y - drag.startY);
    if (d > lim.max) d = lim.max + (d - lim.max) * 0.2;
    if (d < lim.min) d = lim.min + (d - lim.min) * 0.2;
    const before = gl.d;
    gl.d = d;
    tickFor(gl, d - before, 1);
    drag.samples.push({ t: e.timeStamp, y: p.y });
    if (drag.samples.length > 12) drag.samples.shift();
    wake();
  };

  const release = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const { gl, samples } = drag;
    drag = null;
    delete fg.dataset.grabbing;
    const now = samples[samples.length - 1];
    let first = samples[0];
    for (const s of samples) {
      if (now.t - s.t <= 90) {
        first = s;
        break;
      }
    }
    const span = (now.t - first.t) / 1000;
    const idle = e ? e.timeStamp - now.t : 0;
    const v = span > 0.008 && idle < 70 ? (now.y - first.y) / span : 0;
    const lim = limits(gl);
    gl.d = clamp(gl.d, lim.min, lim.max);
    const outward = Math.abs(gl.d) < 6 || Math.sign(v) === Math.sign(gl.d);
    if (Math.abs(v) > FLICK && outward) {
      gl.mode = "coast";
      gl.v = clamp(v, -MAX_FLING, MAX_FLING);
    } else {
      gl.mode = "return";
      gl.v = Math.sign(v) === -Math.sign(gl.d) ? clamp(v, -900, 900) : 0;
    }
    wake();
  };

  const setLine = (next) => {
    const clean = Array.from(next.replace(/[\r\n\t]/g, " ")).slice(0, MAX_CHARS).join("");
    if (clean === line) return;
    const grew = clean.length > line.length;
    line = clean;
    layout(glyphs);
    const lastGlyph = glyphs[glyphs.length - 1];
    if (lastGlyph) sound?.key(grew ? panOf(lastGlyph) : 0);
    else sound?.key(0);
    stage.dataset.empty = line ? "false" : "true";
    render();
    wake();
  };

  const onInput = () => {
    stage.dataset.typed = "";
    setLine(input.value);
  };

  const onBlur = () => {
    if (line.trim()) return;
    input.value = DEFAULT_LINE;
    setLine(DEFAULT_LINE);
  };

  const nudge = (dir) => {
    const gl = [...glyphs].reverse().find((g) => !g.space);
    if (!gl) return;
    if (Math.abs(gl.d) < 1) gl.g = gl.ch.match(/[gjpqy]/) ? gl.padY + ascent + descent * 0.36 : gl.inkTop + (gl.inkBottom - gl.inkTop) * 0.5;
    gl.mode = "coast";
    gl.v = dir * 900;
    wake();
  };

  const onKey = (e) => {
    if (e.key === "Escape") {
      for (const gl of glyphs) if (gl.mode === "held" || gl.mode === "coast") gl.mode = "return";
      wake();
      return;
    }
    if (document.activeElement === input && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      nudge(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    const target = e.target;
    const typing = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName));
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!stage.isConnected) return;
    const r = stage.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return;
    if (e.key.length === 1 || e.key === "Backspace") {
      e.preventDefault();
      focusInput();
      input.value = e.key === "Backspace" ? input.value.slice(0, -1) : input.value + e.key;
      stage.dataset.typed = "";
      setLine(input.value);
    }
  };

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && document.visibilityState === "visible";
    if (visible) wake();
  });
  io.observe(stage);
  const onVis = () => {
    visible = document.visibilityState === "visible";
    if (visible) wake();
  };
  document.addEventListener("visibilitychange", onVis);
  const ro = new ResizeObserver(() => resize());

  fg.addEventListener("pointerdown", onDown);
  fg.addEventListener("pointermove", onMove);
  fg.addEventListener("pointerup", release);
  fg.addEventListener("pointercancel", release);
  fg.addEventListener("lostpointercapture", release);
  input?.addEventListener("input", onInput);
  input?.addEventListener("blur", onBlur);
  window.addEventListener("keydown", onKey);
  if (input) input.value = line;

  const ready = (async () => {
    const face = document.fonts?.load ? document.fonts.load(font(100)) : Promise.resolve();
    const [img] = await Promise.all([loadImage(image), face.catch(() => {})]);
    if (destroyed) return;
    photo = img;
    fontReady = true;
    resize();
    ro.observe(box);
  })();

  return {
    ready,
    async setSound(on) {
      if (on && !sound) sound = createStretchSound();
      if (!sound) return false;
      soundOn = await sound.setEnabled(on);
      return soundOn;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("keydown", onKey);
      input?.removeEventListener("input", onInput);
      input?.removeEventListener("blur", onBlur);
      sound?.destroy();
      sound = null;
      bg.remove();
      fg.remove();
    },
  };
}
