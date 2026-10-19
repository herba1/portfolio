import { createCrayonAudio } from "./crayonAudio";
import { GLYPHS, SPACE, glyphWidth } from "./crayonGlyphs";
import { grainTile, mulberry, paintOrange, paperTexture, toothTile, valueNoise } from "./crayonPaper";

const DEFAULT_TEXT = "the whole point is not knowing and going anyway. you will end up somewhere good, somewhere you can stay.";
const VARIANTS = 3;
const BOIL_MS = 125;
const DRAW_MS = 1000 / 24;
const ORANGES = [
  { fx: 0.58, fy: -0.03, k: 1.05, seed: 11 },
  { fx: 0.77, fy: 0.21, k: 1.12, seed: 23 },
  { fx: -0.015, fy: 0.62, k: 0.98, seed: 37 },
  { fx: 0.19, fy: 1.03, k: 0.9, seed: 41 },
  { fx: 1.01, fy: 0.76, k: 0.86, seed: 53 },
];

function clean(text) {
  let out = "";
  for (const raw of text) {
    const ch = raw === "’" || raw === "‘" ? "'" : raw.toUpperCase();
    if (ch === "\n" || ch === " " || GLYPHS[ch]) out += ch;
  }
  return out;
}

function bend(stroke, rnd) {
  const out = [stroke[0]];
  const phase = rnd() * 10;
  const amp = 0.012 + rnd() * 0.018;
  for (let n = 1; n < stroke.length; n += 1) {
    const [ax, ay] = stroke[n - 1];
    const [bx, by] = stroke[n];
    const len = Math.hypot(bx - ax, by - ay);
    const pieces = Math.max(1, Math.round(len / 0.12));
    const nx = -(by - ay) / Math.max(0.0001, len);
    const ny = (bx - ax) / Math.max(0.0001, len);
    for (let p = 1; p <= pieces; p += 1) {
      const t = p / pieces;
      const off = p === pieces ? 0 : Math.sin(t * Math.PI) * amp * Math.sin(phase + n * 1.7 + t * 2.4) * Math.min(1, len * 3);
      out.push([ax + (bx - ax) * t + nx * off, ay + (by - ay) * t + ny * off]);
    }
  }
  return out;
}

function spring(value, velocity, target, stiffness, ratio, dt) {
  const damping = 2 * Math.sqrt(stiffness) * ratio;
  const v = velocity + (stiffness * (target - value) - damping * velocity) * dt;
  return [value + v * dt, v];
}

export function createCrayon({ root, panel, paperCanvas, inkCanvas, ghostCanvas, orangeLayer, input, embedded, onReady }) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const paperCtx = paperCanvas.getContext("2d");
  const inkCtx = inkCanvas.getContext("2d");
  const paper = paperTexture();
  const grain = grainTile();
  const tooth = toothTile();
  let toothPattern = null;
  let width = panel.clientWidth;
  let height = panel.clientHeight;
  let text = clean(DEFAULT_TEXT);
  let progress = Array.from(text, () => 1);
  let pristine = true;
  let layout = null;
  let caches = [];
  let lastVariant = -1;
  let lastDraw = 0;
  let raf = 0;
  let timer = 0;
  let destroyed = false;
  let visible = true;
  let focused = false;
  let audio = null;
  let soundWanted = true;
  let penDown = false;
  let drag = null;
  let panelRect = panel.getBoundingClientRect();
  let resizeTimer = 0;
  let z = 1;
  const oranges = [];

  const pan = (x) => Math.max(-0.8, Math.min(0.8, (x / Math.max(1, width)) * 1.6 - 0.8));

  const ensureAudio = async () => {
    if (!soundWanted) return;
    if (!audio) audio = createCrayonAudio();
    await audio?.wake();
  };

  function sizeCanvases() {
    for (const canvas of [paperCanvas, inkCanvas, ghostCanvas]) {
      canvas.width = Math.max(2, Math.round(width * dpr));
      canvas.height = Math.max(2, Math.round(height * dpr));
    }
    toothPattern = inkCtx.createPattern(tooth, "repeat");
    caches = [];
  }

  function drawPaper() {
    const ctx = paperCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scale = Math.max(width / paper.width, height / paper.height);
    const dw = paper.width * scale;
    const dh = paper.height * scale;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(paper, (width - dw) / 2, (height - dh) / 2, dw, dh);
    const pattern = ctx.createPattern(grain, "repeat");
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, width, height);
    const rnd = mulberry(4242);
    const count = Math.round((width * height) / 2600);
    for (let i = 0; i < count; i += 1) {
      const x = rnd() * width;
      const y = rnd() * height;
      const r = 0.35 + rnd() * rnd() * 1.3;
      ctx.fillStyle = `rgba(222, 234, 255, ${(0.2 + rnd() * 0.5).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.3, width / 2, height / 2, Math.max(width, height) * 0.75);
    vignette.addColorStop(0, "rgba(4, 14, 44, 0)");
    vignette.addColorStop(0.6, "rgba(4, 14, 44, 0.08)");
    vignette.addColorStop(1, "rgba(4, 14, 44, 0.32)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  function buildLayout() {
    const narrow = width < 560;
    let cap = Math.round(Math.min(40, Math.max(18, width * 0.032)));
    const marginX = width * (narrow ? 0.09 : 0.14);
    const top = height * (narrow ? 0.1 : 0.13);
    const maxW = width - marginX * 2;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const result = place(cap, marginX, top, maxW);
      if (result.bottom <= height * 0.9 || cap <= 14) return result;
      cap = Math.max(14, Math.round(cap * 0.9));
    }
    return place(cap, marginX, top, maxW);
  }

  function place(cap, marginX, top, maxW) {
    const glyphs = [];
    const lineH = cap * 1.9;
    let x = 0;
    let line = 0;
    const words = [];
    let current = null;
    for (let k = 0; k < text.length; k += 1) {
      const ch = text[k];
      if (ch === " " || ch === "\n") {
        if (current) words.push(current);
        current = null;
        words.push({ brk: ch, index: k });
      } else {
        if (!current) current = { chars: [], start: k };
        current.chars.push(k);
      }
    }
    if (current) words.push(current);
    const measure = (k) => {
      const rnd = mulberry(k * 7919 + text.charCodeAt(k) * 31 + 5);
      const sx = 0.84 + rnd() * 0.32;
      const sy = 0.86 + rnd() * 0.3;
      const gap = cap * (0.24 + rnd() * 0.14);
      return { rnd, sx, sy, advance: glyphWidth(GLYPHS[text[k]]) * cap * sx + gap };
    };
    for (const word of words) {
      if (word.brk === "\n") {
        line += 1;
        x = 0;
        continue;
      }
      if (word.brk === " ") {
        if (x > 0) x += cap * SPACE * (0.9 + mulberry(word.index * 13 + 1)() * 0.5);
        continue;
      }
      const metrics = word.chars.map(measure);
      const wordW = metrics.reduce((sum, m) => sum + m.advance, 0);
      if (x > 0 && x + wordW > maxW) {
        line += 1;
        x = 0;
      }
      word.chars.forEach((k, j) => {
        const { rnd, sx, sy, advance } = metrics[j];
        const rot = (rnd() - 0.5) * 0.16;
        const ox = marginX + x;
        const slope = (mulberry(line * 101 + 7)() - 0.5) * 0.03;
        const oy = top + line * lineH + (rnd() - 0.5) * cap * 0.16 + (1 - sy) * cap * 0.6 + x * slope;
        const base = GLYPHS[text[k]].map((stroke) => bend(stroke.map(([px, py]) => [px + (rnd() - 0.5) * 0.08, py + (rnd() - 0.5) * 0.08]), rnd));
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const variants = [];
        for (let v = 0; v < VARIANTS; v += 1) {
          const strokes = base.map((stroke) =>
            stroke.map(([px, py]) => {
              const jx = (rnd() - 0.5) * 0.045;
              const jy = (rnd() - 0.5) * 0.045;
              const lx = (px + jx) * cap * sx;
              const ly = (py + jy) * cap * sy;
              return [ox + lx * cos - ly * sin, oy + lx * sin + ly * cos];
            }),
          );
          const lengths = strokes.map((s) => {
            let len = 0;
            for (let n = 1; n < s.length; n += 1) len += Math.hypot(s[n][0] - s[n - 1][0], s[n][1] - s[n - 1][1]);
            return Math.max(len, cap * 0.05);
          });
          variants.push({ strokes, lengths });
        }
        const air = cap * 0.4;
        const total = variants[0].lengths.reduce((a, b) => a + b + air, 0);
        glyphs.push({ index: k, variants, air, total, width: cap * 0.095, seed: k * 3.17 });
        x += advance;
      });
    }
    return {
      cap,
      glyphs,
      cursor: [marginX + x, top + line * lineH],
      bottom: top + line * lineH + cap * 1.2,
    };
  }

  function strokeCrayon(ctx, pts, upTo, w, seed) {
    let walked = 0;
    const step = Math.max(2, w * 0.8);
    let prev = pts[0];
    let total = 0;
    for (let n = 1; n < pts.length; n += 1) total += Math.hypot(pts[n][0] - pts[n - 1][0], pts[n][1] - pts[n - 1][1]);
    ctx.lineCap = "round";
    for (let n = 1; n < pts.length && walked < upTo; n += 1) {
      const a = pts[n - 1];
      const b = pts[n];
      const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const pieces = Math.max(1, Math.ceil(seg / step));
      for (let p = 1; p <= pieces && walked < upTo; p += 1) {
        const t = p / pieces;
        const next = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        walked += seg / pieces;
        const along = walked / Math.max(1, total);
        const ends = Math.min(1, Math.min(along, 1 - along) * 7 + 0.35);
        const press = 0.7 + valueNoise(seed + walked * 0.08, seed * 0.5, 3) * 0.6;
        ctx.globalAlpha = Math.min(1, ends * press);
        ctx.lineWidth = w * (0.75 + press * 0.35);
        ctx.strokeStyle = toothPattern;
        ctx.beginPath();
        ctx.moveTo(prev[0], prev[1]);
        ctx.lineTo(next[0], next[1]);
        ctx.stroke();
        ctx.globalAlpha = Math.min(1, ends * press) * 0.22;
        ctx.lineWidth = w * 0.42;
        ctx.strokeStyle = "#f4f7ff";
        ctx.stroke();
        prev = next;
      }
    }
  }

  function drawGlyph(ctx, glyph, variant, amount) {
    const v = glyph.variants[variant];
    let budget = amount * glyph.total;
    let pen = null;
    for (let s = 0; s < v.strokes.length; s += 1) {
      budget -= glyph.air;
      if (budget <= 0) return pen;
      const len = v.lengths[s];
      const upTo = Math.min(len, budget);
      strokeCrayon(ctx, v.strokes[s], upTo, glyph.width, glyph.seed + s * 11);
      if (upTo < len) {
        const pts = v.strokes[s];
        let walked = 0;
        for (let n = 1; n < pts.length; n += 1) {
          const seg = Math.hypot(pts[n][0] - pts[n - 1][0], pts[n][1] - pts[n - 1][1]);
          if (walked + seg >= upTo) {
            const t = (upTo - walked) / Math.max(0.001, seg);
            pen = { x: pts[n - 1][0] + (pts[n][0] - pts[n - 1][0]) * t, angle: Math.atan2(pts[n][1] - pts[n - 1][1], pts[n][0] - pts[n - 1][0]), stroke: s };
            break;
          }
          walked += seg;
        }
        return pen;
      }
      budget -= len;
    }
    return pen;
  }

  function renderCache(variant) {
    const canvas = document.createElement("canvas");
    canvas.width = inkCanvas.width;
    canvas.height = inkCanvas.height;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const glyph of layout.glyphs) if (progress[glyph.index] >= 1) drawGlyph(ctx, glyph, variant, 1);
    return canvas;
  }

  function render(now) {
    const variant = reduced ? 0 : Math.floor(now / BOIL_MS) % VARIANTS;
    lastVariant = variant;
    const ctx = inkCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
    if (!caches[variant]) caches[variant] = renderCache(variant);
    ctx.globalAlpha = 1;
    ctx.drawImage(caches[variant], 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let pen = null;
    for (const glyph of layout.glyphs) {
      const amount = progress[glyph.index];
      if (amount > 0 && amount < 1) pen = drawGlyph(ctx, glyph, variant, amount) || pen;
    }
    if (focused && !layout.glyphs.some((g) => progress[g.index] < 1) && Math.floor(now / 530) % 2 === 0) {
      const [cx, cy] = layout.cursor;
      const cap = layout.cap;
      strokeCrayon(ctx, [[cx + cap * 0.1, cy + cap * 1.06], [cx + cap * 0.62, cy + cap * 1.04]], cap, cap * 0.095, 9);
    }
    ctx.globalAlpha = 1;
    return pen;
  }

  function advance(dt) {
    const pending = layout.glyphs.filter((g) => progress[g.index] < 1);
    if (!pending.length) return false;
    const speed = layout.cap * 12 * (1 + Math.min(4, (pending.length - 1) * 0.35));
    let budget = speed * dt;
    for (const glyph of pending) {
      const left = (1 - progress[glyph.index]) * glyph.total;
      if (budget >= left) {
        progress[glyph.index] = 1;
        budget -= left;
        caches = [];
      } else {
        progress[glyph.index] += budget / glyph.total;
        break;
      }
    }
    return true;
  }

  function relayout() {
    layout = buildLayout();
    caches = [];
  }

  function updateOranges(dt) {
    let busy = false;
    for (const o of oranges) {
      const dragging = drag?.orange === o;
      if (dragging) {
        o.tx = drag.px - drag.ox;
        o.ty = drag.py - drag.oy;
      }
      const stiff = dragging ? 600 : 260;
      [o.x, o.vx] = spring(o.x, o.vx, o.tx, stiff, dragging ? 0.92 : 1, dt);
      [o.y, o.vy] = spring(o.y, o.vy, o.ty, stiff, dragging ? 0.92 : 1, dt);
      [o.lift, o.liftV] = spring(o.lift, o.liftV, o.liftT, 260, 0.95, dt);
      if (o.lift > 0.4) o.high = true;
      if (o.high && o.liftT === 0 && o.lift < 0.08) {
        o.high = false;
        audio?.land(0.6, pan(o.x));
      }
      paintOrangeEl(o);
      if (dragging || Math.abs(o.tx - o.x) + Math.abs(o.ty - o.y) > 0.1 || Math.abs(o.vx) + Math.abs(o.vy) > 0.1 || Math.abs(o.lift - o.liftT) > 0.002 || Math.abs(o.liftV) > 0.01) busy = true;
    }
    return busy;
  }

  function paintOrangeEl(o) {
    const s = 1 + o.lift * 0.04;
    o.el.style.transform = `translate3d(${(o.x - o.size / 2).toFixed(2)}px, ${(o.y - o.size / 2).toFixed(2)}px, 0) scale(${s.toFixed(4)})`;
    o.far.style.opacity = (o.lift * 0.9).toFixed(3);
    o.far.style.transform = `translate(${(o.lift * 5).toFixed(2)}px, ${(4 + o.lift * 16).toFixed(2)}px)`;
    o.near.style.opacity = (1 - o.lift * 0.7).toFixed(3);
  }

  function orangeRadius(k) {
    return Math.round(Math.max(30, Math.max(width, height) * 0.06) * k);
  }

  function buildOranges() {
    ORANGES.forEach((spec) => {
      const el = document.createElement("div");
      el.className = "crayon-orange";
      el.tabIndex = 0;
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", "Paper orange. Drag to move it.");
      const far = document.createElement("div");
      far.className = "crayon-orange-far";
      const near = document.createElement("div");
      near.className = "crayon-orange-near";
      el.append(far, near);
      orangeLayer.append(el);
      const o = { spec, el, far, near, canvas: null, radius: 0, size: 0, x: spec.fx * width, y: spec.fy * height, vx: 0, vy: 0, tx: 0, ty: 0, lift: 0, liftV: 0, liftT: 0, high: false };
      o.tx = o.x;
      o.ty = o.y;
      paintOrangeArt(o);
      oranges.push(o);
    });
  }

  function paintOrangeArt(o) {
    const radius = orangeRadius(o.spec.k);
    if (o.radius && Math.abs(radius - o.radius) / o.radius < 0.12) return;
    o.radius = radius;
    const { canvas, size } = paintOrange(radius, o.spec.seed, dpr);
    canvas.className = "crayon-orange-art";
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    o.canvas?.remove();
    o.canvas = canvas;
    o.size = size;
    o.el.style.width = `${size}px`;
    o.el.style.height = `${size}px`;
    o.el.style.setProperty("--crayon-orange-r", `${radius}px`);
    o.el.append(canvas);
    paintOrangeEl(o);
  }

  let lastFrame = 0;
  function frame(now) {
    raf = 0;
    timer = 0;
    if (destroyed || !visible || !layout) return;
    const dt = Math.min(1 / 30, Math.max(0.001, (now - (lastFrame || now)) / 1000));
    lastFrame = now;
    const orangesBusy = updateOranges(dt);
    const variant = reduced ? 0 : Math.floor(now / BOIL_MS) % VARIANTS;
    const drawing = layout.glyphs.some((g) => progress[g.index] < 1);
    if (drawing) {
      if (now - lastDraw >= DRAW_MS) {
        const step = Math.min(0.12, (now - (lastDraw || now - DRAW_MS)) / 1000);
        lastDraw = now;
        advance(step);
        const pen = render(now);
        const down = Boolean(pen);
        if (down && (!penDown || pen.stroke !== penDown)) audio?.touch(pan(pen.x));
        penDown = down ? pen.stroke : false;
        audio?.draw(down ? 0.32 : 0, pen?.angle ?? 0, pan(pen?.x ?? width / 2));
      }
    } else {
      if (penDown !== false) {
        penDown = false;
        audio?.draw(0, 0, 0);
      }
      lastDraw = 0;
      if (variant !== lastVariant || focused) render(now);
    }
    schedule(orangesBusy || drawing || Boolean(drag));
  }

  function schedule(active) {
    if (destroyed || !visible || raf || timer) return;
    if (active) {
      raf = requestAnimationFrame(frame);
      return;
    }
    lastFrame = 0;
    if (reduced && !focused) return;
    const wait = focused ? 90 : BOIL_MS - (performance.now() % BOIL_MS) + 2;
    timer = setTimeout(() => {
      timer = 0;
      raf = requestAnimationFrame(frame);
    }, wait);
  }

  const kick = () => {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    if (!raf && visible && !destroyed) raf = requestAnimationFrame(frame);
  };

  function wipe() {
    const ctx = ghostCanvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ghostCanvas.width, ghostCanvas.height);
    ctx.drawImage(inkCanvas, 0, 0);
    ghostCanvas.dataset.state = "show";
    ghostCanvas.getBoundingClientRect();
    ghostCanvas.dataset.state = "fade";
    audio?.rub(0);
  }

  function setText(next) {
    const cleaned = clean(next).slice(0, 180);
    let p = 0;
    while (p < cleaned.length && p < text.length && cleaned[p] === text[p]) p += 1;
    const removed = text.length > p;
    const nextProgress = progress.slice(0, p);
    for (let k = p; k < cleaned.length; k += 1) nextProgress.push(cleaned[k] === " " || cleaned[k] === "\n" ? 1 : 0);
    text = cleaned;
    progress = nextProgress;
    if (removed) audio?.rub(0);
    relayout();
    kick();
  }

  const onInput = () => {
    ensureAudio();
    setText(input.value);
    input.selectionStart = input.selectionEnd = input.value.length;
  };

  const onFocus = () => {
    focused = true;
    root.dataset.writing = "";
    ensureAudio();
    if (pristine) {
      pristine = false;
      wipe();
      input.value = "";
      text = "";
      progress = [];
      relayout();
    }
    kick();
  };

  const onBlur = () => {
    focused = false;
    delete root.dataset.writing;
    kick();
  };

  const onInputKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      input.blur();
    } else if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") {
      e.preventDefault();
    }
  };

  const onWindowKey = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target;
    if (target === input || target?.closest?.("input, textarea, select, button, [contenteditable='true']")) return;
    const orange = oranges.find((o) => o.el === target);
    if (orange) {
      const step = e.shiftKey ? 24 : 6;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key]) {
        e.preventDefault();
        orange.tx = Math.max(-orange.radius * 0.5, Math.min(width + orange.radius * 0.5, orange.tx + moves[e.key][0]));
        orange.ty = Math.max(-orange.radius * 0.5, Math.min(height + orange.radius * 0.5, orange.ty + moves[e.key][1]));
        kick();
        return;
      }
    }
    if (e.key.length === 1) input.focus({ preventScroll: true });
  };

  const toPanel = (e) => ({ x: e.clientX - panelRect.left, y: e.clientY - panelRect.top });

  const onPointerDown = (e) => {
    const el = e.target.closest?.(".crayon-orange");
    if (!el || (e.button !== undefined && e.button !== 0)) return;
    const orange = oranges.find((o) => o.el === el);
    if (!orange) return;
    const box = el.getBoundingClientRect();
    const dx = e.clientX - (box.left + box.width / 2);
    const dy = e.clientY - (box.top + box.height / 2);
    if (Math.hypot(dx, dy) > orange.radius * 1.05) return;
    e.preventDefault();
    ensureAudio();
    panelRect = panel.getBoundingClientRect();
    const p = toPanel(e);
    drag = { orange, id: e.pointerId, px: p.x, py: p.y, ox: p.x - orange.x, oy: p.y - orange.y };
    el.setPointerCapture?.(e.pointerId);
    el.dataset.dragging = "";
    el.style.zIndex = String((z += 1));
    orange.liftT = 1;
    audio?.lift(pan(orange.x));
    kick();
  };

  const onPointerMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = toPanel(e);
    const r = drag.orange.radius * 0.6;
    drag.px = Math.max(-r + drag.ox, Math.min(width + r + drag.ox, p.x));
    drag.py = Math.max(-r + drag.oy, Math.min(height + r + drag.oy, p.y));
    kick();
  };

  const onPointerUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { orange } = drag;
    drag = null;
    delete orange.el.dataset.dragging;
    orange.liftT = 0;
    orange.spec = { ...orange.spec, fx: orange.tx / width, fy: orange.ty / height };
    kick();
  };

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && document.visibilityState === "visible";
    if (visible) kick();
  });
  const onVisibility = () => {
    visible = document.visibilityState === "visible";
    if (visible) kick();
  };

  const ro = new ResizeObserver(() => {
    const w = panel.clientWidth;
    const h = panel.clientHeight;
    if (!w || !h || (w === width && h === height)) return;
    const sx = w / width;
    const sy = h / height;
    width = w;
    height = h;
    panelRect = panel.getBoundingClientRect();
    for (const o of oranges) {
      o.x *= sx;
      o.tx *= sx;
      o.y *= sy;
      o.ty *= sy;
      paintOrangeArt(o);
      paintOrangeEl(o);
    }
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      sizeCanvases();
      drawPaper();
      relayout();
      render(performance.now());
    }, 100);
  });

  const onScroll = () => {
    panelRect = panel.getBoundingClientRect();
  };

  sizeCanvases();
  drawPaper();
  relayout();
  buildOranges();
  render(performance.now());
  input.value = "";

  orangeLayer.addEventListener("pointerdown", onPointerDown);
  orangeLayer.addEventListener("pointermove", onPointerMove);
  orangeLayer.addEventListener("pointerup", onPointerUp);
  orangeLayer.addEventListener("pointercancel", onPointerUp);
  input.addEventListener("input", onInput);
  input.addEventListener("focus", onFocus);
  input.addEventListener("blur", onBlur);
  input.addEventListener("keydown", onInputKey);
  if (!embedded) window.addEventListener("keydown", onWindowKey);
  window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  document.addEventListener("visibilitychange", onVisibility);
  io.observe(root);
  ro.observe(panel);
  onReady?.();
  kick();

  return {
    async setSound(on) {
      soundWanted = on;
      if (on && !audio) audio = createCrayonAudio();
      if (!audio) return false;
      return audio.setEnabled(on);
    },
    write() {
      ensureAudio();
      input.focus({ preventScroll: true });
    },
    clear() {
      ensureAudio();
      pristine = false;
      wipe();
      input.value = "";
      text = "";
      progress = [];
      relayout();
      render(performance.now());
      input.focus({ preventScroll: true });
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      clearTimeout(resizeTimer);
      io.disconnect();
      ro.disconnect();
      orangeLayer.removeEventListener("pointerdown", onPointerDown);
      orangeLayer.removeEventListener("pointermove", onPointerMove);
      orangeLayer.removeEventListener("pointerup", onPointerUp);
      orangeLayer.removeEventListener("pointercancel", onPointerUp);
      input.removeEventListener("input", onInput);
      input.removeEventListener("focus", onFocus);
      input.removeEventListener("blur", onBlur);
      input.removeEventListener("keydown", onInputKey);
      window.removeEventListener("keydown", onWindowKey);
      window.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      for (const o of oranges) o.el.remove();
      oranges.length = 0;
      audio?.destroy();
    },
  };
}
