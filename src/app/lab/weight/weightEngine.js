import { createWeightSound } from "./weightAudio";

const FAMILY = "WeightFlex";
const LINE = "you don't have to carry all of it at once";
const WGHT = [100, 233, 367, 500, 633, 767, 900];
const WDTH = [50, 70, 85, 100, 115, 130, 150];
const REST_WGHT = 210;
const PEAK_WGHT = 900;
const REST_WDTH = 100;
const CREST_WDTH = 30;
const PERIOD = 7.5;
const SIGMA = 0.2;
const STEP = 1 / 240;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const fvs = (w, s) => `"wght" ${w.toFixed(0)}, "wdth" ${s.toFixed(1)}`;

const locate = (axis, v) => {
  const x = clamp(v, axis[0], axis[axis.length - 1]);
  let i = 0;
  while (i < axis.length - 2 && x > axis[i + 1]) i += 1;
  return [i, (x - axis[i]) / (axis[i + 1] - axis[i])];
};

export function createWeight(stage, { embedded = false, onLive = () => {}, onGesture = () => {} } = {}) {
  const root = document.createElement("div");
  root.className = "weight-surface";
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", `${LINE}. A slow wave of weight breathes through the letters. Move closer to bend it, press and hold to make every letter heavy.`);
  if (embedded) root.tabIndex = 0;
  const block = document.createElement("div");
  block.className = "weight-block";
  block.setAttribute("aria-hidden", "true");
  root.append(block);
  const meter = document.createElement("div");
  meter.className = "weight-meter";
  meter.setAttribute("aria-hidden", "true");
  root.append(meter);
  stage.append(root);

  const chars = [...new Set(LINE.split(""))];
  let table = null;
  let kernTable = new Map();
  let W = 0;
  let H = 0;
  let size = 100;
  let lh = 100;
  let track = 0;
  let lines = [];
  let glyphs = [];
  let blockW = 1;
  let blockTop = 0;
  let sound = null;
  let soundWanted = false;
  let heavy = 0;
  let holding = false;
  let near = 0;
  let nearT = 0;
  let px = 0.5;
  let py = 0.5;
  let pxT = 0.5;
  let pyT = 0.5;
  let clock = 0;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let visible = !document.hidden;
  let onscreen = true;
  let started = false;
  let destroyed = false;
  let pressId = null;

  const measureTable = () => {
    meter.innerHTML = "";
    const spans = chars.map((c) => {
      const s = document.createElement("span");
      s.textContent = c === " " ? " " : c;
      meter.append(s);
      return s;
    });
    const t = new Map(chars.map((c) => [c, WGHT.map(() => WDTH.map(() => 0))]));
    WGHT.forEach((w, i) => {
      WDTH.forEach((s, j) => {
        meter.style.fontVariationSettings = fvs(w, s);
        spans.forEach((sp, k) => {
          t.get(chars[k])[i][j] = sp.getBoundingClientRect().width / 100;
        });
      });
    });
    meter.style.fontVariationSettings = fvs(REST_WGHT, REST_WDTH);
    meter.innerHTML = "";
    const pairs = new Map();
    const probe = document.createElement("span");
    meter.append(probe);
    const one = (txt) => {
      probe.textContent = txt.replace(/ /g, " ");
      return probe.getBoundingClientRect().width / 100;
    };
    for (let i = 0; i < LINE.length - 1; i += 1) {
      const pair = LINE.slice(i, i + 2);
      if (pairs.has(pair) || pair.includes(" ")) continue;
      meter.style.fontKerning = "normal";
      const both = one(pair);
      pairs.set(pair, both - one(pair[0]) - one(pair[1]));
    }
    meter.innerHTML = "";
    kernTable = pairs;
    return t;
  };

  const advance = (c, w, s) => {
    const g = table.get(c);
    const [i, fi] = locate(WGHT, w);
    const [j, fj] = locate(WDTH, s);
    const a = lerp(g[i][j], g[i][j + 1], fj);
    const b = lerp(g[i + 1][j], g[i + 1][j + 1], fj);
    return lerp(a, b, fi);
  };

  const splitLines = (n) => {
    const words = LINE.split(" ");
    if (n >= words.length) return words;
    let best = null;
    const walk = (startIdx, left, acc) => {
      if (left === 1) {
        const ls = [...acc, words.slice(startIdx).join(" ")];
        const worst = Math.max(...ls.map((l) => restWidth(l, 100)));
        if (!best || worst < best.worst) best = { worst, ls };
        return;
      }
      for (let k = startIdx + 1; k <= words.length - left + 1; k += 1) walk(k, left - 1, [...acc, words.slice(startIdx, k).join(" ")]);
    };
    walk(0, n, []);
    return best.ls;
  };

  const restWidth = (text, s) => {
    let sum = 0;
    for (let i = 0; i < text.length; i += 1) {
      sum += advance(text[i], REST_WGHT, REST_WDTH) * s;
      if (i < text.length - 1) sum += (kernTable.get(text.slice(i, i + 2)) || 0) * s + trackFor(s);
    }
    return sum;
  };

  const trackFor = (s) => -0.043 * (s - 12) * 0.55;

  const build = () => {
    const rect = stage.getBoundingClientRect();
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    const gutter = Math.max(16, W * 0.07);
    let best = null;
    for (let n = 1; n <= 6; n += 1) {
      const ls = splitLines(n);
      const em = Math.max(...ls.map((l) => restWidth(l, 100) / 100 + 0.0001));
      const s = Math.min((W - gutter * 2) / em, (H * 0.66) / (n * 1.02), 260);
      if (!best || s > best.s * 1.04) best = { n, ls, s };
    }
    size = Math.max(18, Math.floor(best.s * 0.97));
    lh = Math.round(size * 1.02);
    track = trackFor(size);
    block.innerHTML = "";
    glyphs = [];
    lines = best.ls.map((text, row) => {
      const measure = restWidth(text, size);
      const line = { text, row, measure, left: (W - measure) / 2, items: [] };
      for (let i = 0; i < text.length; i += 1) {
        const c = text[i];
        const el = document.createElement("span");
        el.className = "weight-glyph";
        el.textContent = c === " " ? " " : c;
        block.append(el);
        const kern = i < text.length - 1 ? (kernTable.get(text.slice(i, i + 2)) || 0) * size : 0;
        const item = { c, el, kern, w: REST_WGHT, s: REST_WDTH, u: 0, x: 0, fv: "", tx: "", line };
        line.items.push(item);
        glyphs.push(item);
      }
      return line;
    });
    blockW = Math.max(...lines.map((l) => l.measure));
    blockTop = Math.round(H / 2 - (lines.length * lh) / 2 - size * 0.04);
    block.style.fontSize = `${size}px`;
    block.style.lineHeight = `${lh}px`;
    lines.forEach((line) => {
      let x = line.left;
      line.items.forEach((it) => {
        it.x = x;
        it.nx = (x - (W - blockW) / 2) / blockW;
        x += advance(it.c, REST_WGHT, REST_WDTH) * size + it.kern + track;
      });
    });
  };

  const field = (nx, row) => {
    const n = lines.length;
    const ny = n > 1 ? row / (n - 1) : 0.5;
    const span = 1 + SIGMA * 4.4;
    const phase = ((clock / PERIOD) % 1 + 1) % 1;
    let c = -SIGMA * 2.2 + phase * span - ny * 0.18;
    const bend = near * 0.62;
    c = lerp(c, px, bend * Math.exp(-(((c - px) / 0.55) ** 2)));
    const breath = 0.07 + 0.06 * (0.5 - 0.5 * Math.cos((clock / (PERIOD * 1.3)) * Math.PI * 2));
    const d = (nx - c) / (SIGMA * (1 + near * 0.35));
    const wave = Math.exp(-d * d);
    const dy = n > 1 ? (ny - py) * 1.6 : 0;
    const local = near * 0.55 * Math.exp(-(((nx - px) / 0.13) ** 2) - dy * dy);
    return clamp(Math.max(wave, local) + breath * (1 - wave), 0, 1);
  };

  const solveLine = (line) => {
    const items = line.items;
    let kernSum = 0;
    for (const it of items) kernSum += it.kern;
    const goal = (line.measure - kernSum - track * (items.length - 1)) / size;
    const sumAt = (g) => {
      let s = 0;
      for (const it of items) s += advance(it.c, it.w, clamp(it.s0 + g, 50, 150));
      return s;
    };
    let lo = -130;
    let hi = 60;
    if (sumAt(lo) > goal) hi = lo;
    else if (sumAt(hi) < goal) lo = hi;
    else {
      for (let k = 0; k < 22; k += 1) {
        const mid = (lo + hi) / 2;
        if (sumAt(mid) > goal) hi = mid;
        else lo = mid;
      }
    }
    const g = (lo + hi) / 2;
    let used = 0;
    for (const it of items) {
      it.s = clamp(it.s0 + g, 50, 150);
      it.a = advance(it.c, it.w, it.s) * size;
      used += it.a;
    }
    const gaps = Math.max(1, items.length - 1);
    const spare = Math.max(-size * 0.015, (goal * size - used) / gaps);
    const over = used + spare * gaps - goal * size;
    let x = line.left - Math.max(0, over) / 2;
    for (const it of items) {
      it.x = x;
      x += it.a + it.kern + track + spare;
    }
  };

  const step = (dt) => {
    clock += dt * (1 - heavy * 0.7);
    const rateUp = 2.4;
    const rateDown = 1.15;
    const target = holding ? 1 : 0;
    heavy += (target - heavy) * (1 - Math.exp(-dt * (holding ? rateUp : rateDown)));
    near += (nearT - near) * (1 - Math.exp(-dt * 3));
    px += (pxT - px) * (1 - Math.exp(-dt * 5));
    py += (pyT - py) * (1 - Math.exp(-dt * 5));
    for (const it of glyphs) {
      const u = field(it.nx, it.line.row);
      it.u += (u - it.u) * (1 - Math.exp(-dt * 9));
    }
  };

  const render = () => {
    const h = smooth(clamp(heavy, 0, 1));
    let energy = 0;
    let crestX = 0;
    let crestW = 0;
    for (const it of glyphs) {
      const u = it.u;
      it.w = lerp(lerp(REST_WGHT, PEAK_WGHT, u), PEAK_WGHT, h);
      it.s0 = lerp(REST_WDTH + CREST_WDTH * u, REST_WDTH, h);
      energy += u;
      crestX += it.nx * u * u;
      crestW += u * u;
    }
    lines.forEach(solveLine);
    for (const it of glyphs) {
      const fv = fvs(it.w, it.s);
      if (fv !== it.fv) {
        it.fv = fv;
        it.el.style.fontVariationSettings = fv;
      }
      const tx = `translate3d(${it.x.toFixed(2)}px, ${blockTop + it.line.row * lh}px, 0)`;
      if (tx !== it.tx) {
        it.tx = tx;
        it.el.style.transform = tx;
      }
    }
    energy = glyphs.length ? energy / glyphs.length : 0;
    const pan = crestW > 0 ? (crestX / crestW) * 2 - 1 : 0;
    sound?.update(clamp(energy * 2.6 + h, 0, 1), pan, h);
  };

  const frame = (now) => {
    raf = 0;
    if (destroyed || !visible || !onscreen) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    acc += dt;
    while (acc >= STEP) {
      step(STEP);
      acc -= STEP;
    }
    render();
    raf = requestAnimationFrame(frame);
  };

  const wake = () => {
    if (destroyed || raf || !started || !visible || !onscreen) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  const gesture = () => {
    onGesture();
    if (soundWanted) return;
    soundWanted = true;
    sound = createWeightSound();
    sound?.setEnabled(true);
  };

  const toLocal = (e) => {
    const r = root.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const left = (W - blockW) / 2;
    const top = blockTop;
    const bh = lines.length * lh;
    pxT = clamp((x - left) / blockW, -0.2, 1.2);
    pyT = clamp((y - top) / Math.max(1, bh), -0.4, 1.4);
    const dx = Math.max(0, left - x, x - (left + blockW)) / W;
    const dy = Math.max(0, top - y, y - (top + bh)) / H;
    nearT = clamp(1 - Math.hypot(dx, dy) * 3.2, 0, 1);
  };

  const press = (on) => {
    if (on === holding) return;
    holding = on;
    sound?.breath(on);
  };

  const onDown = (e) => {
    if (!started) return;
    gesture();
    toLocal(e);
    pressId = e.pointerId;
    try {
      root.setPointerCapture(e.pointerId);
    } catch {}
    press(true);
  };
  const onMove = (e) => {
    if (!started) return;
    if (e.pointerType !== "mouse" && pressId === null) return;
    toLocal(e);
  };
  const onUp = (e) => {
    if (pressId !== e.pointerId) return;
    pressId = null;
    press(false);
    if (e.pointerType !== "mouse") nearT = 0;
  };
  const onLeave = (e) => {
    if (e.pointerType === "mouse" && pressId === null) nearT = 0;
  };
  const onKey = (e) => {
    if (!started || e.repeat) return;
    if (embedded && !root.contains(document.activeElement)) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      gesture();
      press(true);
    }
  };
  const onKeyUp = (e) => {
    if (e.key === " " || e.key === "Enter") press(false);
  };
  const onBlur = () => {
    pressId = null;
    press(false);
  };
  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) {
      sound?.resume();
      wake();
    } else sound?.suspend();
  };

  const ro = new ResizeObserver(() => {
    if (!started) return;
    build();
    render();
  });
  ro.observe(stage);
  const io = new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    if (onscreen) {
      sound?.resume();
      wake();
    } else sound?.suspend();
  });
  io.observe(root);

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  root.addEventListener("pointerleave", onLeave);
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);

  const go = () => {
    if (destroyed) return;
    table = measureTable();
    build();
    clock = PERIOD * 0.32;
    for (const it of glyphs) it.u = field(it.nx, it.line.row);
    render();
    started = true;
    root.dataset.ready = "";
    onLive(LINE);
    wake();
  };

  const fontReady = document.fonts?.load ? document.fonts.load(`100px ${FAMILY}`, LINE) : Promise.resolve();
  Promise.race([fontReady, new Promise((r) => setTimeout(r, 2500))]).then(() => requestAnimationFrame(go));

  return {
    async setSound(on) {
      if (on) {
        gesture();
        return true;
      }
      sound?.setEnabled(false);
      return false;
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      root.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      sound?.destroy();
      root.remove();
    },
  };
}
