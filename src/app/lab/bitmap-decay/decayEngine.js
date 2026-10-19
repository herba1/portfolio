import { createTicks } from "./tickAudio";

const FAMILY = '"How Are You Pixelify", monospace';
const PROBE = 720;
const ASC = 8;
const DESC = 3;
const LETTER_GAP = 1;
const WORD_GAP = 3;
const LINES = 4;
const PITCH = 10;
const STEP = 1 / 20;
const BRUSH_STEP = 0.25;
const DEFAULTS = [0, 0.1, 0.3, 0.5];
const BLUE = "#0b1cff";
const STEP_MS = 46;
const HOLD_MS = 380;
const DRIFT_MS = 520;

function hash(x, y, line, k) {
  let h = (x * 374761393 + y * 668265263 + line * 2147483647 + k * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function quantize(v) {
  return Math.round(v / STEP) * STEP;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

const glyphCache = new Map();
let probeCtx = null;
let unit = 0;

function inkBox(data, size) {
  let minX = size;
  let maxX = -1;
  let minY = size;
  let maxY = -1;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (data[(y * size + x) * 4 + 3] > 127) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { minX, maxX, minY, maxY };
}

function probe() {
  if (probeCtx) return probeCtx;
  const canvas = document.createElement("canvas");
  canvas.width = PROBE * 1.5;
  canvas.height = PROBE * 1.5;
  probeCtx = canvas.getContext("2d", { willReadFrequently: true });
  return probeCtx;
}

function paintProbe(ch) {
  const g = probe();
  const size = g.canvas.width;
  g.clearRect(0, 0, size, size);
  g.font = `${PROBE}px ${FAMILY}`;
  g.textBaseline = "alphabetic";
  g.fillStyle = "#000";
  g.fillText(ch, PROBE * 0.25, PROBE);
  return { data: g.getImageData(0, 0, size, size).data, size };
}

function measureUnit() {
  if (unit) return unit;
  const dotProbe = paintProbe(".");
  const dot = inkBox(dotProbe.data, dotProbe.size);
  const ellProbe = paintProbe("l");
  const ell = inkBox(ellProbe.data, ellProbe.size);
  if (dot && ell) {
    const box = (dot.maxX - dot.minX + 1 + (dot.maxY - dot.minY + 1)) / 2;
    unit = { step: (ell.maxY - ell.minY + 1 - box) / 6, box };
  } else {
    unit = { step: PROBE * 0.09, box: PROBE * 0.1 };
  }
  return unit;
}

function glyph(ch) {
  if (glyphCache.has(ch)) return glyphCache.get(ch);
  const { step, box: pixel } = measureUnit();
  const { data, size } = paintProbe(ch);
  const box = inkBox(data, size);
  let result = { cols: 0, cells: [] };
  if (box) {
    const cols = Math.max(1, Math.round((box.maxX - box.minX + 1 - pixel) / step) + 1);
    const rows = Math.max(1, Math.round((box.maxY - box.minY + 1 - pixel) / step) + 1);
    const top = Math.round((PROBE - box.minY - pixel) / step) + 1;
    const cells = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const x = Math.floor(box.minX + c * step + pixel / 2);
        const y = Math.floor(box.minY + r * step + pixel / 2);
        if (data[(y * size + x) * 4 + 3] > 127) cells.push(c, ASC - top + r);
      }
    }
    result = { cols, cells };
  }
  glyphCache.set(ch, result);
  return result;
}

function rasterize(phrase) {
  const xs = [];
  const ys = [];
  let pen = 0;
  let started = false;
  for (const ch of phrase.trim()) {
    if (/\s/.test(ch)) {
      pen += WORD_GAP;
      started = false;
      continue;
    }
    const g = glyph(ch);
    if (!g.cols) continue;
    if (started) pen += LETTER_GAP;
    for (let k = 0; k < g.cells.length; k += 2) {
      xs.push(pen + g.cells[k]);
      ys.push(g.cells[k + 1]);
    }
    pen += g.cols;
    started = true;
  }
  const rows = ASC + DESC;
  const keep = [];
  for (let i = 0; i < xs.length; i += 1) if (ys[i] >= 0 && ys[i] < rows) keep.push(i);
  return { cols: Math.max(1, pen), rows, xs: Int16Array.from(keep.map((i) => xs[i])), ys: Int16Array.from(keep.map((i) => ys[i])) };
}

export function createDecay({ root, canvas, onChange }) {
  const ctx = canvas.getContext("2d");
  let phrase = "how are you?";
  let raster = null;
  let lines = [];
  let hashes = [];
  let dpr = 1;
  let cssW = 0;
  let cssH = 0;
  let cell = 8;
  let originX = 0;
  let originY = 0;
  const pitch = PITCH;
  let drift = 0;
  let driftTimer = 0;
  let frame = 0;
  let visible = true;
  let destroyed = false;
  let audio = null;
  let soundOn = true;
  let pointer = null;
  let hover = null;
  let gesture = null;
  let focusLine = -1;
  let animating = false;
  let lastStep = 0;

  const ensureAudio = () => {
    if (!audio) audio = createTicks();
    return audio;
  };

  const tick = (kind, amount = 1, x = cssW / 2) => audio?.tick(kind, cssW ? (x / cssW) * 1.2 - 0.6 : 0, amount);

  const buildHashes = () => {
    hashes = [];
    for (let l = 0; l < LINES; l += 1) {
      const n = raster.xs.length;
      const h = new Float32Array(n * 4);
      for (let i = 0; i < n; i += 1) {
        const x = raster.xs[i];
        const y = raster.ys[i];
        const along = hash(Math.floor(x / 3), Math.floor(y / 3), l, 5) < 0.62;
        const kx = along ? Math.floor((x + ((y * 7) % 3)) / 3) : x + 4096;
        const ky = along ? y : Math.floor((y + ((x * 5) % 3)) / 3) + 4096;
        h[i * 4] = hash(x, y, l, 1);
        h[i * 4 + 1] = hash(kx, ky, l, 2);
        h[i * 4 + 2] = (along ? 0 : 0.5) + hash(kx, ky, l, 3) * 0.5;
        h[i * 4 + 3] = hash(kx, ky, l, 4);
      }
      hashes.push(h);
    }
  };

  const build = (keepDecay) => {
    raster = rasterize(phrase);
    const previous = lines;
    lines = [];
    for (let l = 0; l < LINES; l += 1) {
      const d = keepDecay && previous[l] ? previous[l].d : DEFAULTS[l];
      lines.push({ d, target: d, v: new Float32Array(raster.xs.length), vTarget: 0 });
    }
    buildHashes();
    layout();
  };

  const layout = () => {
    const rect = root.getBoundingClientRect();
    cssW = rect.width;
    cssH = rect.height;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    if (!raster) return;
    const narrow = cssW < 640;
    const side = narrow ? 16 : Math.max(32, cssW * 0.06);
    const top = narrow ? 200 : 168;
    const bottom = narrow ? 132 : 112;
    const availW = cssW - side * 2;
    const availH = Math.max(80, cssH - top - bottom);
    const blockRows = pitch * (LINES - 1) + raster.rows;
    const fit = Math.min(availW / (raster.cols + 2), availH / blockRows, 22);
    cell = Math.max(1, Math.floor(fit * dpr));
    const blockW = raster.cols * cell;
    const blockH = blockRows * cell;
    originX = Math.round((canvas.width - blockW) / 2);
    const centreY = (top + availH * 0.56) * dpr;
    originY = Math.round(Math.min(centreY - blockH / 2, canvas.height - bottom * dpr - blockH));
    originY = Math.max(Math.round(top * dpr), originY);
    markAll();
    request();
  };

  const placed = (l, i, e) => {
    const h = hashes[l];
    const x = raster.xs[i];
    const y = raster.ys[i];
    if (e <= 0) return [x, y];
    if (h[i * 4] < e * 0.34) return null;
    if (h[i * 4 + 1] < e * 0.85) {
      const dir = h[i * 4 + 2];
      const far = e > 0.55 && h[i * 4 + 3] < 0.3 ? 2 : 1;
      if (dir < 0.25) return [x + far, y];
      if (dir < 0.5) return [x - far, y];
      if (dir < 0.75) return [x, y + 1];
      return [x, y - 1];
    }
    return [x, y];
  };

  const ambient = (l) => quantize((0.07 * Math.sin(drift * 0.83 + l * 2.1) + 0.035 * Math.sin(drift * 2.17 + l * 0.7)) * Math.min(1, lines[l].d / 0.3));

  const driftTick = () => {
    driftTimer = window.setTimeout(driftTick, DRIFT_MS);
    if (!visible || document.hidden || gesture || !raster) return;
    drift += 1;
    markAll();
    request();
  };

  const layers = [];
  const dirty = new Set();

  const markAll = () => {
    for (let l = 0; l < LINES; l += 1) dirty.add(l);
  };

  const renderLine = (l) => {
    let layer = layers[l];
    if (!layer) {
      layer = document.createElement("canvas");
      layers[l] = layer;
    }
    const w = (raster.cols + 6) * cell;
    const h = (raster.rows + 4) * cell;
    if (layer.width !== w || layer.height !== h) {
      layer.width = w;
      layer.height = h;
    }
    const g = layer.getContext("2d");
    g.clearRect(0, 0, w, h);
    g.fillStyle = BLUE;
    const line = lines[l];
    for (let i = 0; i < raster.xs.length; i += 1) {
      const e = clamp(line.d + line.v[i] + (line.d > 0 ? ambient(l) : 0), 0, 1);
      const p = placed(l, i, e);
      if (!p) continue;
      g.fillRect((p[0] + 3) * cell, (p[1] + 2) * cell, cell, cell);
    }
  };

  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!raster) return;
    for (const l of dirty) renderLine(l);
    dirty.clear();
    for (let l = 0; l < LINES; l += 1) {
      if (layers[l]) ctx.drawImage(layers[l], originX - 3 * cell, originY + l * pitch * cell - 2 * cell);
    }
    ctx.fillStyle = BLUE;
    if (focusLine >= 0) {
      const y = originY + focusLine * pitch * cell + (ASC - 5) * cell;
      ctx.fillRect(originX - 3 * cell, y, cell, cell * 5);
    }
    const at = gesture?.mode === "brush" || gesture?.mode === "repair" ? pointer : hover;
    if (at) {
      const r = brushRadius();
      const gx = Math.floor((at.x * dpr - originX) / cell);
      const gy = Math.floor((at.y * dpr - originY) / cell);
      const x0 = originX + (gx - r) * cell;
      const y0 = originY + (gy - r) * cell;
      const size = (r * 2 + 1) * cell;
      const t = Math.max(1, Math.round(dpr));
      ctx.fillStyle = BLUE;
      if (gesture?.mode === "repair") {
        const arm = Math.max(cell * 2, Math.round(size * 0.3));
        ctx.fillRect(x0, y0, arm, t * 2);
        ctx.fillRect(x0, y0, t * 2, arm);
        ctx.fillRect(x0 + size - arm, y0, arm, t * 2);
        ctx.fillRect(x0 + size - t * 2, y0, t * 2, arm);
        ctx.fillRect(x0, y0 + size - t * 2, arm, t * 2);
        ctx.fillRect(x0, y0 + size - arm, t * 2, arm);
        ctx.fillRect(x0 + size - arm, y0 + size - t * 2, arm, t * 2);
        ctx.fillRect(x0 + size - t * 2, y0 + size - arm, t * 2, arm);
      } else if (gesture?.mode !== "scrub") {
        ctx.globalAlpha = 0.55;
        ctx.fillRect(x0, y0, size, t);
        ctx.fillRect(x0, y0 + size - t, size, t);
        ctx.fillRect(x0, y0, t, size);
        ctx.fillRect(x0 + size - t, y0, t, size);
        ctx.globalAlpha = 1;
      }
    }
  };

  const stepTowards = () => {
    let moving = false;
    let changed = 0;
    for (const line of lines) {
      if (Math.abs(line.d - line.target) > 1e-6) {
        line.d = quantize(line.d + Math.sign(line.target - line.d) * STEP);
        if (Math.abs(line.d - line.target) < STEP / 2) line.d = line.target;
        moving = true;
        changed += 1;
      }
      dirty.add(lines.indexOf(line));
      for (let i = 0; i < line.v.length; i += 1) {
        const v = line.v[i];
        if (v === line.vTarget) continue;
        const next = v > line.vTarget ? Math.max(line.vTarget, v - BRUSH_STEP) : Math.min(line.vTarget, v + BRUSH_STEP);
        line.v[i] = next;
        moving = true;
        changed += 1;
      }
    }
    if (changed) tick("heal", changed);
    return moving;
  };

  const loop = (now) => {
    frame = 0;
    if (destroyed) return;
    if (animating && now - lastStep >= STEP_MS) {
      lastStep = now;
      animating = stepTowards();
      if (!animating) emitChange();
    }
    if (visible) draw();
    if (animating) request();
  };

  function request() {
    if (!frame && !destroyed) frame = requestAnimationFrame(loop);
  }

  const isDefault = () => lines.every((line, l) => Math.abs(line.d - DEFAULTS[l]) < 1e-6 && line.v.every((v) => v === 0));

  const emitChange = () => onChange?.({ dirty: !isDefault() });

  const lineAt = (y) => {
    const gy = (y * dpr - originY) / cell;
    const l = Math.floor(gy / pitch);
    if (gy < -2 || l >= LINES + 0 || gy > pitch * (LINES - 1) + raster.rows + 2) return -1;
    return clamp(l, 0, LINES - 1);
  };

  const brushRadius = () => Math.max(1, Math.round((30 * dpr) / cell));

  const applyBrush = (x, y, amount) => {
    const r = brushRadius();
    const gx = Math.floor((x * dpr - originX) / cell);
    const gy = Math.floor((y * dpr - originY) / cell);
    let changed = 0;
    for (let l = 0; l < LINES; l += 1) {
      const line = lines[l];
      const top = l * pitch;
      if (gy + r < top - 2 || gy - r > top + raster.rows + 2) continue;
      for (let i = 0; i < raster.xs.length; i += 1) {
        const dx = raster.xs[i] - gx;
        const dy = raster.ys[i] + top - gy;
        if (dx * dx + dy * dy > r * r + r) continue;
        const before = line.v[i];
        const next = clamp(before + amount, -line.d, 1 - line.d);
        if (next !== before) {
          line.v[i] = next;
          changed += 1;
          dirty.add(l);
        }
      }
    }
    if (changed) {
      tick(amount > 0 ? "decay" : "heal", changed / 6, x);
      emitChange();
    }
    return changed;
  };

  const local = (e) => {
    const rect = root.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const cellKey = (p) => `${Math.floor((p.x * dpr - originX) / cell)}:${Math.floor((p.y * dpr - originY) / cell)}`;

  const startRepair = () => {
    if (!gesture || gesture.mode !== "pending") return;
    gesture.mode = "repair";
    const pulse = () => {
      if (!gesture || gesture.mode !== "repair") return;
      applyBrush(pointer.x, pointer.y, -BRUSH_STEP);
      request();
      gesture.timer = window.setTimeout(pulse, 70);
    };
    pulse();
  };

  const onDown = (e) => {
    if (e.button !== 0 || !raster) return;
    audio?.wake();
    canvas.setPointerCapture?.(e.pointerId);
    pointer = local(e);
    hover = e.pointerType === "mouse" ? pointer : null;
    animating = false;
    for (const line of lines) {
      line.target = line.d;
      line.vTarget = 0;
    }
    gesture = { id: e.pointerId, x0: pointer.x, y0: pointer.y, at: e.timeStamp, mode: "pending", line: lineAt(pointer.y), d0: 0, key: "" };
    if (gesture.line >= 0) gesture.d0 = lines[gesture.line].d;
    gesture.timer = window.setTimeout(startRepair, HOLD_MS);
    request();
  };

  const onMove = (e) => {
    const p = local(e);
    if (e.pointerType === "mouse") hover = p;
    if (!gesture || e.pointerId !== gesture.id) {
      request();
      return;
    }
    pointer = p;
    const dx = p.x - gesture.x0;
    const dy = p.y - gesture.y0;
    const early = gesture.mode === "pending" || (gesture.mode === "repair" && e.timeStamp - gesture.at < HOLD_MS && !gesture.key);
    if (early && dx * dx + dy * dy > 49) {
      window.clearTimeout(gesture.timer);
      gesture.mode = Math.abs(dy) > Math.abs(dx) * 1.15 && gesture.line >= 0 ? "scrub" : "brush";
    }
    if (gesture.mode === "scrub") {
      const line = lines[gesture.line];
      const next = clamp(quantize(gesture.d0 + dy / 260), 0, 1);
      if (Math.abs(next - line.d) > 1e-6) {
        tick(next > line.d ? "decay" : "heal", 1 + Math.abs(next - line.d) / STEP, p.x);
        line.d = next;
        line.target = next;
        dirty.add(gesture.line);
        for (let i = 0; i < line.v.length; i += 1) line.v[i] = clamp(line.v[i], -next, 1 - next);
        emitChange();
      }
    } else if (gesture.mode === "brush" || gesture.mode === "repair") {
      const key = cellKey(p);
      if (key !== gesture.key) {
        gesture.key = key;
        applyBrush(p.x, p.y, gesture.mode === "repair" ? -BRUSH_STEP : BRUSH_STEP);
      }
    }
    request();
  };

  const onUp = (e) => {
    if (!gesture || e.pointerId !== gesture.id) return;
    window.clearTimeout(gesture.timer);
    if (gesture.mode === "pending") applyBrush(pointer.x, pointer.y, BRUSH_STEP);
    gesture = null;
    if (e.pointerType !== "mouse") hover = null;
    request();
  };

  const onLeave = (e) => {
    if (e.pointerType === "mouse" && !gesture) {
      hover = null;
      request();
    }
  };

  const onKey = (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      focusLine = focusLine < 0 ? 0 : clamp(focusLine + (e.key === "ArrowDown" ? 1 : -1), 0, LINES - 1);
      request();
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && focusLine >= 0) {
      e.preventDefault();
      audio?.wake();
      const line = lines[focusLine];
      const next = clamp(quantize(line.d + (e.key === "ArrowRight" ? STEP : -STEP)), 0, 1);
      if (next !== line.d) {
        tick(next > line.d ? "decay" : "heal", 1);
        line.d = next;
        line.target = next;
        dirty.add(focusLine);
        emitChange();
        request();
      }
    }
  };

  const onFocus = () => {
    if (!canvas.matches(":focus-visible")) return;
    if (focusLine < 0) focusLine = 3;
    request();
  };

  const onBlur = () => {
    focusLine = -1;
    request();
  };

  const onFirstGesture = () => {
    window.removeEventListener("pointerdown", onFirstGesture, true);
    window.removeEventListener("keydown", onFirstGesture, true);
    if (soundOn) ensureAudio()?.setEnabled(true);
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("keydown", onKey);
  canvas.addEventListener("focus", onFocus);
  canvas.addEventListener("blur", onBlur);
  window.addEventListener("pointerdown", onFirstGesture, true);
  window.addEventListener("keydown", onFirstGesture, true);

  const ro = new ResizeObserver(() => layout());
  ro.observe(root);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) request();
  });
  io.observe(root);
  const onVisibility = () => {
    if (!document.hidden) request();
  };
  document.addEventListener("visibilitychange", onVisibility);

  return {
    async init() {
      try {
        await document.fonts.load(`${PROBE}px "How Are You Pixelify"`);
      } catch {
        return;
      }
      if (destroyed) return;
      build(false);
      draw();
      driftTimer = window.setTimeout(driftTick, DRIFT_MS);
    },
    setPhrase(text) {
      phrase = text.trim() ? text : " ";
      build(true);
      emitChange();
    },
    reset() {
      audio?.wake();
      lines.forEach((line, l) => {
        line.target = DEFAULTS[l];
        line.vTarget = 0;
      });
      animating = true;
      lastStep = 0;
      request();
    },
    async setSound(on) {
      soundOn = on;
      if (!on) {
        await audio?.setEnabled(false);
        return false;
      }
      const a = ensureAudio();
      return a ? a.setEnabled(true) : false;
    },
    destroy() {
      destroyed = true;
      window.clearTimeout(driftTimer);
      if (frame) cancelAnimationFrame(frame);
      window.clearTimeout(gesture?.timer);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("keydown", onKey);
      canvas.removeEventListener("focus", onFocus);
      canvas.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerdown", onFirstGesture, true);
      window.removeEventListener("keydown", onFirstGesture, true);
      audio?.destroy();
      audio = null;
    },
  };
}
