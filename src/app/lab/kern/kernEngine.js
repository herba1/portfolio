import { createKernSound } from "./kernAudio";

const FAMILY = "KernGrotesque";
const LIGHT = { wght: 320, wdth: 100 };
const HEAVY = { wght: 800, wdth: 75 };
const SAMPLES = 6;
const MAX = 12;
const WORDS = ["something", "together", "because", "blackbird", "yesterday", "michelle", "julia", "girl"];
const SVG = "http://www.w3.org/2000/svg";
const STEP = 1 / 240;
const K_HOME = 64;
const C_HOME = 10;
const K_LINK = 460;
const C_LINK = 7;
const K_GRAB = 900;
const C_GRAB = 52;
const K_GUARD = 5200;
const IDLE = 3200;
const BEAT = 2600;

const lerp = (a, b, t) => a + (b - a) * t;
const lawPx = (s) => -0.043 * (s - 12);
const trackAt = (s, m) => lawPx(s) * lerp(1, 0.22, m);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const axesAt = (m) => ({ wght: lerp(LIGHT.wght, HEAVY.wght, m), wdth: lerp(LIGHT.wdth, HEAVY.wdth, m) });
const fvs = (m) => {
  const a = axesAt(m);
  return `"wght" ${a.wght.toFixed(1)}, "wdth" ${a.wdth.toFixed(2)}, "opsz" 96`;
};
const minus = (n) => (n < 0 ? `−${Math.abs(n)}` : n > 0 ? `+${n}` : "0");

export function createKern(stage, { embedded = false, readout = null, onLive = () => {}, onMorph = () => {} } = {}) {
  const root = document.createElement("div");
  root.className = "kern-surface";
  root.setAttribute("role", "application");
  root.setAttribute("aria-label", "A word set in large type. Drag a letter to stretch the line. Type to change the word. Hold Shift for the heavy width.");
  if (embedded) root.tabIndex = 0;

  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "kern-svg");
  const base = document.createElementNS(SVG, "path");
  base.setAttribute("class", "kern-baseline");
  svg.append(base);
  const glyphLayer = document.createElementNS(SVG, "g");
  svg.append(glyphLayer);
  const caret = document.createElementNS(SVG, "rect");
  caret.setAttribute("class", "kern-caret");
  caret.setAttribute("width", "2");
  svg.append(caret);
  root.append(svg);

  const numbers = document.createElement("div");
  numbers.className = "kern-numbers";
  root.append(numbers);

  const meter = document.createElement("div");
  meter.className = "kern-meter";
  meter.setAttribute("aria-hidden", "true");
  root.append(meter);

  const input = document.createElement("input");
  input.className = "kern-input";
  input.type = "text";
  input.setAttribute("aria-label", "Word");
  input.autocapitalize = "none";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.maxLength = MAX;
  root.append(input);

  stage.append(root);

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const touchy = window.matchMedia("(hover: none)").matches;

  let sound = null;
  let W = 0;
  let H = 0;
  let cx = 0;
  let baseY = 0;
  let size = 0;
  let sizeT = 0;
  let sizeV = 0;
  let morph = 0;
  let morphT = 0;
  let morphV = 0;
  let morphLocked = false;
  let shiftHeld = false;
  let letters = [];
  let leaving = [];
  let metrics = null;
  let word = "";
  let grab = null;
  let ghost = null;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let lastInput = -1e9;
  let typing = false;
  let typedAt = -1e9;
  let attractTimer = 0;
  let attractStep = 0;
  let wordIndex = 0;
  let visible = !document.hidden;
  let onscreen = true;
  let destroyed = false;
  let lastFvs = "";
  let lastSize = -1;
  let readoutKey = "";
  let started = false;

  const measureAt = (text, m) => {
    meter.style.fontVariationSettings = fvs(m);
    meter.textContent = text;
    const node = meter.firstChild;
    const left = meter.getBoundingClientRect().left;
    const range = document.createRange();
    const lefts = [];
    for (let i = 0; i < text.length; i += 1) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      lefts.push(range.getBoundingClientRect().left - left);
    }
    const total = meter.getBoundingClientRect().width;
    const alone = [];
    const cache = new Map();
    for (const ch of text) {
      if (!cache.has(ch)) {
        meter.textContent = ch === " " ? " " : ch;
        cache.set(ch, meter.getBoundingClientRect().width);
      }
      alone.push(cache.get(ch));
    }
    return { lefts, total, alone };
  };

  const measure = (text) => {
    if (!text.length) return { text, samples: [] };
    const samples = [];
    for (let k = 0; k < SAMPLES; k += 1) samples.push(measureAt(text, k / (SAMPLES - 1)));
    return { text, samples };
  };

  const sampleAt = (m) => {
    const s = metrics.samples;
    const f = clamp(m, 0, 1) * (s.length - 1);
    const i = Math.min(s.length - 2, Math.floor(f));
    const t = f - i;
    const a = s[i];
    const b = s[i + 1];
    return {
      lefts: a.lefts.map((v, j) => lerp(v, b.lefts[j], t)),
      total: lerp(a.total, b.total, t),
      alone: a.alone.map((v, j) => lerp(v, b.alone[j], t)),
    };
  };

  const capH = () => size * 0.7;

  const homes = () => {
    if (!metrics || !metrics.samples.length) return null;
    const s = sampleAt(morph);
    const track = trackAt(size, morph);
    const n = s.lefts.length;
    const total = (s.total * size) / 100 + track * (n - 1);
    const x0 = cx - total / 2;
    return {
      x: s.lefts.map((l, i) => x0 + (l * size) / 100 + track * i),
      alone: s.alone.map((a) => (a * size) / 100),
      rest: s.lefts.slice(0, -1).map((l, i) => ((s.lefts[i + 1] - l) * size) / 100 + track),
      total,
      x0,
    };
  };

  const pickSize = (text) => {
    if (!text.length) return sizeT || 120;
    const m = measure(text);
    let widest = 0;
    for (const s of m.samples) widest = Math.max(widest, s.total);
    const side = W < 640 ? 20 : Math.max(48, W * 0.07);
    const room = W - side * 2;
    const per = widest / 100 - 0.043 * (text.length - 1);
    const fit = (room - 0.516 * (text.length - 1)) / Math.max(0.2, per);
    return clamp(Math.min(fit, H * 0.3, W * 0.42, 280), 28, 290);
  };

  const makeLetter = (ch) => {
    const g = document.createElementNS(SVG, "g");
    g.setAttribute("class", "kern-glyph");
    const left = document.createElementNS(SVG, "line");
    left.setAttribute("class", "kern-side");
    const right = document.createElementNS(SVG, "line");
    right.setAttribute("class", "kern-side");
    const t = document.createElementNS(SVG, "text");
    t.textContent = ch === " " ? " " : ch;
    t.setAttribute("x", "0");
    t.setAttribute("y", "0");
    g.append(left, right, t);
    glyphLayer.append(g);
    const num = document.createElement("span");
    num.className = "kern-num";
    numbers.append(num);
    return { ch, g, t, left, right, num, x: 0, y: 0, vx: 0, vy: 0, o: 0, born: performance.now(), home: 0, alone: 0, rot: 0, numText: "", numX: 0, live: false, sideKey: "", lastSide: 0, tickAt: 0 };
  };

  const retire = (l, now) => {
    l.dieAt = now;
    l.num.remove();
    leaving.push(l);
  };

  const setWord = (text, { spread = true, fromIndex = 0 } = {}) => {
    const now = performance.now();
    const keep = Math.min(fromIndex, letters.length, text.length);
    for (let i = keep; i < letters.length; i += 1) retire(letters[i], now);
    const kept = letters.slice(0, keep);
    word = text;
    metrics = measure(text);
    sizeT = pickSize(text);
    if (!size) size = sizeT;
    const h = homes();
    const added = [];
    for (let i = keep; i < text.length; i += 1) {
      const l = makeLetter(text[i]);
      added.push(l);
      kept.push(l);
    }
    letters = kept;
    if (h) {
      const mid = (text.length - 1) / 2;
      letters.forEach((l, i) => {
        l.home = h.x[i];
        l.alone = h.alone[i];
        if (!added.includes(l)) return;
        if (spread) {
          l.x = h.x[i] + (i - mid) * size * (reduced ? 0 : 0.62);
          l.y = baseY;
          l.born = now + i * 40;
        } else {
          l.x = h.x[i] + size * 0.32;
          l.y = baseY - size * 0.22;
          l.born = now;
        }
        l.vx = 0;
        l.vy = 0;
      });
    }
    lastFvs = "";
    lastSize = -1;
    input.value = text;
    wake();
  };

  const layout = () => {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const prevCx = cx;
    const prevBase = baseY;
    W = r.width;
    H = r.height;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));
    cx = W / 2;
    sizeT = pickSize(word);
    if (!started) size = sizeT;
    baseY = Math.round(H * (W < 640 ? 0.5 : 0.53) + sizeT * 0.24);
    if (started) {
      for (const l of letters) {
        l.x += cx - prevCx;
        l.y += baseY - prevBase;
      }
    } else {
      for (const l of letters) l.y = baseY;
    }
    lastSize = -1;
    wake();
  };

  const forces = (h, dt) => {
    const n = letters.length;
    const fx = new Float32Array(n);
    const fy = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const l = letters[i];
      fx[i] += -K_HOME * (l.x - h.x[i]) - C_HOME * l.vx;
      fy[i] += -K_HOME * 1.6 * (l.y - baseY) - C_HOME * 1.2 * l.vy;
    }
    for (let i = 0; i < n - 1; i += 1) {
      const a = letters[i];
      const b = letters[i + 1];
      const dx = b.x - a.x - h.rest[i];
      const dy = b.y - a.y;
      const dvx = b.vx - a.vx;
      const dvy = b.vy - a.vy;
      const sx = K_LINK * dx + C_LINK * dvx;
      const sy = K_LINK * dy + C_LINK * dvy;
      fx[i] += sx;
      fy[i] += sy;
      fx[i + 1] -= sx;
      fy[i + 1] -= sy;
      const floor = h.rest[i] * 0.88;
      const gx = b.x - a.x;
      if (gx < floor) {
        const push = K_GUARD * (floor - gx);
        fx[i] -= push;
        fx[i + 1] += push;
      }
    }
    const pulls = [];
    if (grab && letters[grab.index]) pulls.push(grab);
    if (ghost && letters[ghost.index] && !grab) pulls.push(ghost);
    for (const p of pulls) {
      const l = letters[p.index];
      fx[p.index] += K_GRAB * (p.tx - l.x) - C_GRAB * l.vx;
      fy[p.index] += K_GRAB * (p.ty - l.y) - C_GRAB * l.vy;
    }
    for (let i = 0; i < n; i += 1) {
      const l = letters[i];
      l.vx += fx[i] * dt;
      l.vy += fy[i] * dt;
      const cap = 5200;
      const sp = Math.hypot(l.vx, l.vy);
      if (sp > cap) {
        l.vx *= cap / sp;
        l.vy *= cap / sp;
      }
      const before = l.x - h.x[i];
      l.x += l.vx * dt;
      l.y += l.vy * dt;
      const after = l.x - h.x[i];
      if (before * after < 0 && Math.abs(l.vx) > 90 && !grab) {
        const now = performance.now();
        if (now - l.tickAt > 90) {
          l.tickAt = now;
          sound?.settle((l.x / W) * 1.6 - 0.8, Math.abs(l.vx));
        }
      }
    }
  };

  const springScalar = (x, v, target, k, dt) => {
    const c = 2 * Math.sqrt(k);
    const a = k * (target - x) - c * v;
    const nv = v + a * dt;
    return [x + nv * dt, nv];
  };

  const step = (dt) => {
    [size, sizeV] = springScalar(size, sizeV, sizeT, 90, dt);
    [morph, morphV] = springScalar(morph, morphV, morphT, 70, dt);
    const h = homes();
    if (!h) return;
    letters.forEach((l, i) => {
      l.home = h.x[i];
      l.alone = h.alone[i];
    });
    forces(h, dt);
  };

  const catmull = (pts) => {
    if (pts.length < 2) return "";
    let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
    }
    return d;
  };

  const render = (now) => {
    const f = fvs(morph);
    const fs = Math.round(size * 100) / 100;
    const styleChanged = f !== lastFvs || fs !== lastSize;
    lastFvs = f;
    lastSize = fs;
    const h = homes();
    const n = letters.length;
    let deform = 0;
    const pts = [];
    for (let i = 0; i < n; i += 1) {
      const l = letters[i];
      const prev = letters[i - 1] || l;
      const next = letters[i + 1] || l;
      const span = Math.max(1, next.x + next.alone / 2 - (prev.x + prev.alone / 2));
      const slope = n > 1 ? (next.y - prev.y) / span : 0;
      const target = clamp(Math.atan(slope) * 0.7, -0.42, 0.42);
      l.rot = target;
      const appear = reduced ? 1 : clamp((now - l.born) / 520, 0, 1);
      l.o = 1 - Math.pow(1 - appear, 3);
      const cxl = l.alone / 2;
      l.g.setAttribute("transform", `translate(${(l.x + cxl).toFixed(2)} ${l.y.toFixed(2)}) rotate(${((l.rot * 180) / Math.PI).toFixed(3)}) translate(${(-cxl).toFixed(2)} 0)`);
      l.g.style.opacity = l.o.toFixed(3);
      if (styleChanged) {
        l.t.style.fontVariationSettings = f;
        l.t.style.fontSize = `${fs}px`;
      }
      const sideKey = `${l.alone.toFixed(2)}:${fs}`;
      if (sideKey !== l.sideKey) {
        l.sideKey = sideKey;
        const top = (-size * 0.76).toFixed(2);
        const bottom = (size * 0.22).toFixed(2);
        l.left.setAttribute("x1", "0");
        l.left.setAttribute("x2", "0");
        l.left.setAttribute("y1", top);
        l.left.setAttribute("y2", bottom);
        l.right.setAttribute("x1", l.alone.toFixed(2));
        l.right.setAttribute("x2", l.alone.toFixed(2));
        l.right.setAttribute("y1", top);
        l.right.setAttribute("y2", bottom);
      }
      pts.push([l.x + l.alone / 2, l.y]);
      if (h) deform = Math.max(deform, Math.abs(l.x - h.x[i]) / size, Math.abs(l.y - baseY) / size);
    }
    const sideAlpha = clamp((deform - 0.02) * 9, 0, 1);
    glyphLayer.style.setProperty("--kern-side", sideAlpha.toFixed(3));
    if (pts.length) {
      const first = pts[0];
      const lastP = pts[pts.length - 1];
      const ext = size * 0.5;
      const a0 = n > 1 ? Math.atan2(pts[1][1] - first[1], pts[1][0] - first[0]) : 0;
      const a1 = n > 1 ? Math.atan2(lastP[1] - pts[n - 2][1], lastP[0] - pts[n - 2][0]) : 0;
      const line = [[first[0] - Math.cos(a0) * ext - letters[0].alone / 2, first[1] - Math.sin(a0) * ext], ...pts, [lastP[0] + Math.cos(a1) * ext + letters[n - 1].alone / 2, lastP[1] + Math.sin(a1) * ext]];
      base.setAttribute("d", catmull(line));
      base.style.opacity = (0.35 + sideAlpha * 0.65).toFixed(3);
    } else {
      base.setAttribute("d", `M${cx - size} ${baseY} L${cx + size} ${baseY}`);
    }

    const showCaret = typing && now - typedAt < 4200;
    if (showCaret) {
      const lastL = letters[n - 1];
      const x = lastL ? lastL.x + lastL.alone + Math.max(4, size * 0.04) : cx;
      const y = lastL ? lastL.y : baseY;
      caret.setAttribute("x", x.toFixed(2));
      caret.setAttribute("y", (y - size * 0.74).toFixed(2));
      caret.setAttribute("height", (size * 0.96).toFixed(2));
      caret.style.opacity = Math.floor((now - typedAt) / 530) % 2 === 0 ? "1" : "0";
    } else {
      caret.style.opacity = "0";
    }

    const numY = baseY + size * 0.24 + 16;
    const desired = [];
    for (let i = 0; i < n - 1; i += 1) {
      const a = letters[i];
      const b = letters[i + 1];
      const val = Math.round(((b.x - a.x - a.alone) / size) * 1000);
      const restVal = h ? Math.round(((h.rest[i] - a.alone) / size) * 1000) : val;
      desired.push({ l: a, x: (a.x + a.alone + b.x) / 2, val, live: Math.abs(val - restVal) > 4, o: Math.min(a.o, b.o) });
    }
    const minSep = W < 640 ? 32 : 40;
    for (let k = 1; k < desired.length; k += 1) desired[k].x = Math.max(desired[k].x, desired[k - 1].x + minSep);
    for (let k = desired.length - 2; k >= 0; k -= 1) desired[k].x = Math.min(desired[k].x, desired[k + 1].x - minSep);
    for (const d of desired) {
      const text = minus(d.val);
      if (text !== d.l.numText) {
        d.l.numText = text;
        d.l.num.textContent = text;
      }
      if (d.live !== d.l.live) {
        d.l.live = d.live;
        if (d.live) d.l.num.dataset.live = "";
        else delete d.l.num.dataset.live;
      }
      d.l.num.style.transform = `translate3d(${d.x.toFixed(1)}px, ${numY.toFixed(1)}px, 0) translateX(-50%)`;
      d.l.num.style.opacity = d.o.toFixed(3);
      d.l.num.hidden = false;
    }
    if (n) letters[n - 1].num.hidden = true;

    for (let k = leaving.length - 1; k >= 0; k -= 1) {
      const l = leaving[k];
      const t = clamp((now - l.dieAt) / 240, 0, 1);
      l.g.style.opacity = ((1 - t) * l.o).toFixed(3);
      l.g.setAttribute("transform", `translate(${l.x.toFixed(2)} ${(l.y - t * t * size * 0.3).toFixed(2)})`);
      if (styleChanged) l.t.style.fontSize = `${fs}px`;
      if (t >= 1) {
        l.g.remove();
        leaving.splice(k, 1);
      }
    }

    if (readout) {
      const a = axesAt(morph);
      const key = `${Math.round(a.wght)}|${Math.round(a.wdth)}|${Math.round(size)}|${Math.round(trackAt(size, morph) * 100)}`;
      if (key !== readoutKey) {
        readoutKey = key;
        readout.textContent = `wght ${Math.round(a.wght)}  ·  wdth ${Math.round(a.wdth)}  ·  ${Math.round(size)} px  ·  tracking ${minus(Math.round(trackAt(size, morph) * 100) / 100).replace("+", "")} px`;
      }
    }
  };

  const settled = () => {
    if (grab || ghost) return false;
    if (Math.abs(size - sizeT) > 0.05 || Math.abs(sizeV) > 0.05) return false;
    if (Math.abs(morph - morphT) > 0.001 || Math.abs(morphV) > 0.002) return false;
    if (leaving.length) return false;
    const h = homes();
    const now = performance.now();
    for (let i = 0; i < letters.length; i += 1) {
      const l = letters[i];
      if (l.o < 1 || now - l.born < 560) return false;
      if (Math.abs(l.vx) > 0.6 || Math.abs(l.vy) > 0.6) return false;
      if (h && (Math.abs(l.x - h.x[i]) > 0.08 || Math.abs(l.y - baseY) > 0.08)) return false;
    }
    if (typing && now - typedAt < 4300) return false;
    return true;
  };

  const ghostUpdate = (now) => {
    if (!ghost) return;
    const l = letters[ghost.index];
    if (!l) {
      ghost = null;
      return;
    }
    const t = (now - ghost.start) / ghost.dur;
    if (t >= 1) {
      sound?.release(0.55, (l.x / W) * 1.6 - 0.8);
      ghost = null;
      return;
    }
    const e = t < 0.7 ? 1 - Math.pow(1 - t / 0.7, 3) : 1;
    ghost.tx = ghost.x0 + ghost.dx * e;
    ghost.ty = ghost.y0 + ghost.dy * e;
  };

  const pluck = () => {
    const choices = letters.map((l, i) => i).filter((i) => letters[i].ch !== " ");
    if (!choices.length) return;
    const pick = choices[(attractStep * 5 + 3) % choices.length];
    const l = letters[pick];
    const dir = pick < letters.length / 2 ? -1 : 1;
    const amount = 0.36 + ((attractStep * 7) % 5) * 0.06;
    ghost = {
      index: pick,
      start: performance.now(),
      dur: 520,
      x0: l.x,
      y0: l.y,
      dx: dir * size * amount,
      dy: -size * (0.2 + ((attractStep * 3) % 4) * 0.07),
      tx: l.x,
      ty: l.y,
    };
    sound?.grab((l.x / W) * 1.6 - 0.8);
  };

  const attract = () => {
    attractTimer = 0;
    if (destroyed) return;
    const now = performance.now();
    if (grab || typing || now - lastInput < IDLE || !visible || !onscreen || reduced) {
      scheduleAttract(Math.max(600, IDLE - (now - lastInput)));
      return;
    }
    const phase = attractStep % 6;
    if (phase === 2) {
      morphT = 1;
      sound?.morph(true);
      onMorph(true);
    } else if (phase === 3) {
      morphT = morphLocked ? 1 : 0;
      if (!morphLocked) {
        sound?.morph(false);
        onMorph(false);
      }
    } else if (phase === 5) {
      wordIndex = (wordIndex + 1) % WORDS.length;
      setWord(WORDS[wordIndex]);
    } else {
      pluck();
    }
    attractStep += 1;
    wake();
    scheduleAttract(phase === 5 ? BEAT + 600 : BEAT);
  };

  const scheduleAttract = (ms) => {
    if (attractTimer) clearTimeout(attractTimer);
    attractTimer = setTimeout(attract, ms);
  };

  const frame = () => {
    raf = 0;
    if (destroyed) return;
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    ghostUpdate(now);
    acc += dt;
    let guard = 0;
    while (acc >= STEP && guard < 24) {
      step(STEP);
      acc -= STEP;
      guard += 1;
    }
    if (guard >= 24) acc = 0;
    render(now);
    if (!settled()) raf = requestAnimationFrame(frame);
    else {
      acc = 0;
      if (typing && now - typedAt >= 4300) typing = false;
      render(now);
    }
  };

  function wake() {
    if (destroyed || raf || !visible || !onscreen) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const touched = () => {
    lastInput = performance.now();
    if (ghost) ghost = null;
  };

  const local = (e) => {
    const r = root.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const hit = (x, y) => {
    let best = -1;
    let bestD = Infinity;
    letters.forEach((l, i) => {
      if (l.ch === " ") return;
      const lx = l.x + l.alone / 2;
      const ly = l.y - size * 0.34;
      const dx = Math.max(0, Math.abs(x - lx) - l.alone * 0.4);
      const dy = Math.max(0, Math.abs(y - ly) - size * 0.36);
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return bestD < (touchy ? size * 0.5 + 24 : size * 0.3 + 12) ? best : -1;
  };

  const onDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest && e.target.closest("button, a, input")) return;
    const [x, y] = local(e);
    const i = hit(x, y);
    if (i < 0) return;
    touched();
    const l = letters[i];
    grab = { index: i, id: e.pointerId, ox: x - l.x, oy: y - l.y, tx: l.x, ty: l.y };
    root.setPointerCapture?.(e.pointerId);
    root.dataset.grabbing = "";
    sound?.grab((l.x / W) * 1.6 - 0.8);
    e.preventDefault();
    wake();
  };

  const soft = (v, limit) => {
    const a = Math.abs(v);
    if (a <= limit) return v;
    return Math.sign(v) * (limit + (1 - Math.exp(-(a - limit) / limit)) * limit * 0.6);
  };

  const onMove = (e) => {
    if (!grab || e.pointerId !== grab.id) {
      if (e.pointerType === "mouse" && !grab) {
        const [x, y] = local(e);
        const over = hit(x, y) >= 0;
        if (over) root.dataset.over = "";
        else delete root.dataset.over;
      }
      return;
    }
    const [x, y] = local(e);
    const l = letters[grab.index];
    if (!l) return;
    const home = l.home;
    const dx = soft(x - grab.ox - home, Math.min(W * 0.36, size * 2.2));
    const dy = soft(y - grab.oy - baseY, Math.min(H * 0.3, size * 1.2));
    grab.tx = clamp(home + dx, 8 - l.alone * 0.5, W - 8 - l.alone * 0.5);
    grab.ty = clamp(baseY + dy, size * 0.8 + 8, H - size * 0.25 - 8);
    lastInput = performance.now();
    wake();
  };

  const onUp = (e) => {
    if (!grab || e.pointerId !== grab.id) return;
    const l = letters[grab.index];
    if (l) {
      const stretch = Math.hypot(l.x - l.home, l.y - baseY) / size;
      sound?.release(stretch, (l.x / W) * 1.6 - 0.8);
    }
    grab = null;
    delete root.dataset.grabbing;
    lastInput = performance.now();
    scheduleAttract(IDLE + 400);
    wake();
  };

  const setMorphTarget = (on, viaSound = true) => {
    const next = on ? 1 : 0;
    if (next === morphT) return;
    morphT = next;
    if (viaSound) sound?.morph(on);
    onMorph(on);
    touched();
    wake();
  };

  const typeChar = (ch) => {
    const now = performance.now();
    touched();
    const fresh = !typing || now - typedAt > 4200;
    typing = true;
    typedAt = now;
    if (fresh) {
      setWord(ch, { spread: false, fromIndex: 0 });
    } else {
      if (word.length >= MAX) return;
      setWord(word + ch, { spread: false, fromIndex: word.length });
    }
    const l = letters[letters.length - 1];
    sound?.key(l ? (l.x / W) * 1.6 - 0.8 : 0);
    onLive(`Word: ${word}`);
  };

  const backspace = () => {
    const now = performance.now();
    touched();
    typing = true;
    typedAt = now;
    if (!word.length) return;
    setWord(word.slice(0, -1), { spread: false, fromIndex: word.length - 1 });
    sound?.key(0);
  };

  const ALLOWED = /^[a-zA-Z0-9'&!?.,\- ]$/;

  const onKey = (e) => {
    if (e.target === input) return;
    if (e.key === "Shift") {
      if (!e.repeat && !shiftHeld) {
        shiftHeld = true;
        setMorphTarget(!morphLocked);
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "Backspace") {
      e.preventDefault();
      backspace();
      return;
    }
    if (e.key === "Enter" || e.key === "Escape") {
      typing = false;
      if (!word.length) setWord(WORDS[wordIndex]);
      wake();
      return;
    }
    if (e.key.length === 1 && ALLOWED.test(e.key)) {
      if (e.key === " " && (!typing || !word.length)) {
        if (e.target === document.body || root.contains(e.target)) e.preventDefault();
        return;
      }
      e.preventDefault();
      typeChar(e.key);
    }
  };

  const onKeyUp = (e) => {
    if (e.key === "Shift" && shiftHeld) {
      shiftHeld = false;
      setMorphTarget(morphLocked);
    }
  };

  const onBlur = () => {
    if (shiftHeld) {
      shiftHeld = false;
      setMorphTarget(morphLocked);
    }
  };

  const onInput = () => {
    const raw = input.value.replace(/[^a-zA-Z0-9'&!?.,\- ]/g, "").slice(0, MAX);
    const now = performance.now();
    touched();
    typing = true;
    typedAt = now;
    if (raw === word) return;
    let common = 0;
    while (common < raw.length && common < word.length && raw[common] === word[common]) common += 1;
    setWord(raw, { spread: false, fromIndex: common });
    sound?.key(0);
  };

  const onInputDone = () => {
    typing = false;
    if (!word.length) setWord(WORDS[wordIndex]);
    wake();
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
  };

  const ro = new ResizeObserver(() => layout());
  ro.observe(stage);
  const io = new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    if (onscreen) wake();
  });
  io.observe(root);

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  input.addEventListener("input", onInput);
  input.addEventListener("blur", onInputDone);
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);

  const begin = () => {
    if (destroyed) return;
    layout();
    started = true;
    setWord(WORDS[0]);
    root.dataset.ready = "";
    scheduleAttract(IDLE + 600);
  };

  const fontReady = document.fonts?.load ? document.fonts.load(`100px ${FAMILY}`, "something") : Promise.resolve();
  Promise.race([fontReady, new Promise((r) => setTimeout(r, 2500))]).then(() => requestAnimationFrame(begin));

  return {
    async setSound(on) {
      if (on && !sound) sound = createKernSound();
      if (!sound) return false;
      return sound.setEnabled(on);
    },
    setHeavy(on) {
      morphLocked = on;
      setMorphTarget(on || shiftHeld);
    },
    editWord() {
      input.value = word;
      input.focus({ preventScroll: true });
      typing = true;
      typedAt = performance.now();
      touched();
      wake();
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      if (attractTimer) clearTimeout(attractTimer);
      ro.disconnect();
      io.disconnect();
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      input.removeEventListener("input", onInput);
      input.removeEventListener("blur", onInputDone);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      sound?.destroy();
      root.remove();
    },
  };
}
