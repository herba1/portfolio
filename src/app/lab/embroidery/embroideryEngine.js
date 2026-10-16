import { makeCanvas, paintHoopBase, paintLinen, paintRing } from "./embroideryCloth";
import { THREADS, drawNeedle, strokeThread } from "./embroideryThread";

const LOADERS = {
  john: () => import("./tours/tourJohn"),
  paul: () => import("./tours/tourPaul"),
  george: () => import("./tours/tourGeorge"),
};

const SUB = 1 / 120;
const ITERATIONS = 18;
const FADE_MS = 520;
const SEW_DELAY = 350;
const CHECKPOINT = 1200;
const CHECKPOINT_MAX = 10;
const tours = new Map();

function decode(text) {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const count = bin.length / 4;
  const out = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    const u = bin.charCodeAt(i * 4) | (bin.charCodeAt(i * 4 + 1) << 8);
    const v = bin.charCodeAt(i * 4 + 2) | (bin.charCodeAt(i * 4 + 3) << 8);
    out[i * 2] = (u / 65535) * 2 - 1;
    out[i * 2 + 1] = (v / 65535) * 2 - 1;
  }
  return out;
}

async function loadTour(key) {
  if (tours.has(key)) return tours.get(key);
  const mod = await LOADERS[key]();
  const tour = decode(mod.default);
  tours.set(key, tour);
  return tour;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export default class EmbroideryEngine {
  constructor({ canvas, box, embedded, portrait, thread, onStat, onReady }) {
    this.canvas = canvas;
    this.box = box;
    this.embedded = embedded;
    this.portrait = portrait;
    this.threadKey = thread;
    this.onStat = onStat;
    this.onReady = onReady;
    this.ctx = canvas.getContext("2d");
    this.raf = 0;
    this.visible = false;
    this.ready = false;
    this.destroyed = false;
    this.reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    this.cap = 1024;
    this.X = new Float64Array(this.cap);
    this.Y = new Float64Array(this.cap);
    this.OX = new Float64Array(this.cap);
    this.OY = new Float64Array(this.cap);

    this.bakeCap = 4096;
    this.BX = new Float32Array(this.bakeCap);
    this.BY = new Float32Array(this.bakeCap);
    this.BC = new Float32Array(this.bakeCap);
    this.BT = new Float32Array(this.bakeCap);
    this.bakeHold = 0;
    this.m = 0;
    this.n = 0;
    this.grip = -1;
    this.hand = { x: 0, y: 0 };
    this.handFrom = { x: 0, y: 0 };
    this.lastHand = { x: 0, y: 0 };
    this.handSpeed = 0;
    this.mode = "idle";
    this.releasedAt = 0;
    this.sewCarry = 0;
    this.popCredit = 0;
    this.still = 0;
    this.fade = null;
    this.lastTime = 0;
    this.endRest = 0;
    this.loop = this.loop.bind(this);
    this.onDown = this.onDown.bind(this);
    this.onMove = this.onMove.bind(this);
    this.onUp = this.onUp.bind(this);
    this.onKey = this.onKey.bind(this);
    this.onVisibility = this.onVisibility.bind(this);
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
    canvas.addEventListener("lostpointercapture", this.onUp);
    canvas.addEventListener("keydown", this.onKey);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.resizeTimer = 0;
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.ready) return;
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.build(false), 140);
    });
    this.resizeObserver.observe(box);
    this.io = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      this.visible = entry.isIntersecting;
      if (this.visible && !this.ready && !this.starting) this.start();
      else if (this.visible) this.kick();
      else this.stop();
    });
    this.io.observe(box);
  }

  async start() {
    this.starting = true;
    const tour = await loadTour(this.portrait);
    if (this.destroyed) return;
    this.tour = tour;
    this.build(true);
    this.ready = true;
    this.onReady?.();
  }

  destroy() {
    this.destroyed = true;
    this.stop();
    window.clearTimeout(this.resizeTimer);
    window.clearTimeout(this.ladderTimer);
    this.checkpoints = null;
    this.resizeObserver.disconnect();
    this.io.disconnect();
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
    c.removeEventListener("lostpointercapture", this.onUp);
    c.removeEventListener("keydown", this.onKey);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.baseLayer = this.cacheLayer = this.ringLayer = this.pileLayer = this.fadeLayer = null;
  }

  onVisibility() {
    if (document.hidden) this.stop();
    else this.kick();
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  kick() {
    if (this.raf || !this.ready || !this.visible || document.hidden || this.destroyed) return;
    this.still = 0;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  async setPortrait(key) {
    if (key === this.portrait) return;
    this.portrait = key;
    if (!this.ready) return;
    const tour = await loadTour(key);
    if (this.destroyed || key !== this.portrait) return;
    this.snapshot();
    this.tour = tour;
    this.build(false);
  }

  setThread(key) {
    if (key === this.threadKey) return;
    this.threadKey = key;
    if (!this.ready) return;
    this.snapshot();
    this.palette = THREADS[key];
    this.checkpoints = new Map();
    this.paintCache(this.ns, false);
    this.rebuildPile();
    this.render();
    this.kick();
  }

  snapshot() {
    if (this.reduced || !this.canvas.width) return;
    const layer = makeCanvas(this.canvas.width, this.canvas.height);
    layer.getContext("2d").drawImage(this.canvas, 0, 0);
    this.fade = { layer, at: performance.now() };
  }

  layout() {
    const W = Math.max(1, this.box.clientWidth);
    const H = Math.max(1, this.box.clientHeight);
    const narrow = W < 900;
    const top = this.embedded ? 20 : narrow ? 152 : 96;
    const below = this.embedded ? clamp(H * 0.14, 56, 120) : clamp(H * 0.15, 84, 170) + 16;
    const side = W < 600 ? 20 : 40;
    const D = clamp(Math.min(W - side * 2, H - top - below, 640), 140, 640);
    const outer = D / 2;
    const ring = Math.max(7, D * 0.034);
    const inner = outer - ring;
    const linen = inner - Math.max(2, ring * 0.32);
    const art = linen * 0.93;
    const lug = ring * 1.5 * 0.62;
    const cy = top + lug + outer + (H - top - below - D - lug) * 0.35;
    return { W, H, cx: W / 2, cy, outer, inner, linen, ring, art, floor: H - (this.embedded ? 8 : 64), D };
  }

  build(first) {
    const g = this.layout();
    this.g = g;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const dpr = this.dpr;
    this.canvas.width = Math.round(g.W * dpr);
    this.canvas.height = Math.round(g.H * dpr);
    this.palette = THREADS[this.threadKey];
    this.buildStitches();
    this.paintStatic();
    this.resetRope();
    this.checkpoints = new Map();
    this.paintCache(this.ns, false);
    this.pileLayer = makeCanvas(g.W * dpr, g.H * dpr);
    this.rebuildPile();
    this.mode = "idle";
    this.emitStat();
    this.render();
    if (!first) this.kick();
  }

  buildStitches() {
    const { cx, cy, art } = this.g;
    const tour = this.tour;
    const total = tour.length / 2;
    const step = art < 170 ? 2 : 1;
    const w = clamp(art * (step === 2 ? 0.0074 : 0.0056), 0.9, 2.6);
    this.w = w;
    this.h = clamp(w * 3, 3, 6);
    const minGap = w * 0.9;
    const maxLen = w * 4.6;
    const xs = [];
    const ys = [];
    for (let i = 0; i < total; i += 1) {
      if (i % step !== 0 && i !== total - 1) continue;
      const x = cx + tour[i * 2] * art;
      const y = cy + tour[i * 2 + 1] * art;
      const last = xs.length - 1;
      if (last >= 0) {
        const d = Math.hypot(x - xs[last], y - ys[last]);
        if (d < minGap && i !== total - 1) continue;
        if (d > maxLen) {
          const parts = Math.ceil(d / maxLen);
          const lx = xs[last];
          const ly = ys[last];
          for (let p = 1; p < parts; p += 1) {
            xs.push(lx + ((x - lx) * p) / parts);
            ys.push(ly + ((y - ly) * p) / parts);
          }
        }
      }
      xs.push(x);
      ys.push(y);
    }
    this.N = xs.length;
    this.SX = Float32Array.from(xs);
    this.SY = Float32Array.from(ys);
    this.SL = new Float32Array(this.N);
    for (let i = 0; i < this.N - 1; i += 1) this.SL[i] = Math.hypot(xs[i + 1] - xs[i], ys[i + 1] - ys[i]);
    this.ns = this.N - 1;
    this.sewCarry = 0;
    this.popCredit = 0;
  }

  paintStatic() {
    const g = this.g;
    const dpr = this.dpr;
    const pad = g.outer * 0.22;
    const lugs = g.ring * 1.6;
    const rect = { x: Math.floor(g.cx - g.outer - pad), y: Math.floor(g.cy - g.outer - lugs - pad * 0.4), w: 0, h: 0 };
    rect.w = Math.ceil(g.outer * 2 + pad * 2);
    rect.h = Math.ceil(g.outer * 2 + lugs + pad * 1.6);
    this.rect = rect;
    const base = makeCanvas(rect.w * dpr, rect.h * dpr);
    const bctx = base.getContext("2d");
    bctx.setTransform(dpr, 0, 0, dpr, -rect.x * dpr, -rect.y * dpr);
    paintHoopBase(bctx, g);
    const size = Math.ceil(g.linen * 2 * dpr) + 4;
    const linen = makeCanvas(size, size);
    paintLinen(linen.getContext("2d"), size, size / 2 - 2, dpr);
    bctx.save();
    bctx.beginPath();
    bctx.arc(g.cx, g.cy, g.inner, 0, Math.PI * 2);
    bctx.clip();
    bctx.drawImage(linen, g.cx - size / dpr / 2, g.cy - size / dpr / 2, size / dpr, size / dpr);
    const holes = new Path2D();
    const r = this.w * 0.42;
    for (let i = 0; i < this.N; i += 1) {
      holes.moveTo(this.SX[i] + r, this.SY[i]);
      holes.arc(this.SX[i], this.SY[i], r, 0, Math.PI * 2);
    }
    bctx.translate(0.3, 0.45);
    bctx.fillStyle = "rgba(255, 248, 232, 0.5)";
    bctx.fill(holes);
    bctx.translate(-0.3, -0.45);
    bctx.fillStyle = "rgba(74, 52, 30, 0.62)";
    bctx.fill(holes);
    bctx.restore();
    this.baseLayer = base;
    const ringLayer = makeCanvas(rect.w * dpr, rect.h * dpr);
    const rctx = ringLayer.getContext("2d");
    rctx.setTransform(dpr, 0, 0, dpr, -rect.x * dpr, -rect.y * dpr);
    paintRing(rctx, g);
    this.ringLayer = ringLayer;
    this.cacheLayer = makeCanvas(rect.w * dpr, rect.h * dpr);
  }

  paintCache(upTo, snapshots = true) {
    const dpr = this.dpr;
    const rect = this.rect;
    const ctx = this.cacheLayer.getContext("2d");
    const to = Math.max(0, upTo);
    if (!this.checkpoints) this.checkpoints = new Map();
    let from = 0;
    let start = this.baseLayer;
    for (const [index, layer] of this.checkpoints) {
      if (index <= to && index > from) {
        from = index;
        start = layer;
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.cacheLayer.width, this.cacheLayer.height);
    ctx.drawImage(start, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, -rect.x * dpr, -rect.y * dpr);
    let at = from;
    const lowest = from + CHECKPOINT;
    for (let mark = Math.ceil(lowest / CHECKPOINT) * CHECKPOINT; snapshots && mark <= to && to - from > CHECKPOINT; mark += CHECKPOINT) {
      if (mark <= at || this.checkpoints.has(mark)) continue;
      strokeThread(ctx, this.SX, this.SY, at, mark, this.w, this.palette, { holes: true });
      at = mark;
      this.saveCheckpoint(mark);
    }
    if (to > at) strokeThread(ctx, this.SX, this.SY, at, to, this.w, this.palette, { holes: true });
    this.cachedTo = to;
  }

  warmLadder() {
    if (this.ladderTimer || this.destroyed) return;
    const next = () => {
      this.ladderTimer = 0;
      if (this.destroyed || !this.cacheLayer) return;
      let from = 0;
      for (const key of this.checkpoints.keys()) from = Math.max(from, key);
      const mark = from + CHECKPOINT;
      if (mark > this.N - 1 || this.checkpoints.size >= CHECKPOINT_MAX) return;
      const layer = makeCanvas(this.cacheLayer.width, this.cacheLayer.height);
      const ctx = layer.getContext("2d");
      ctx.drawImage(from ? this.checkpoints.get(from) : this.baseLayer, 0, 0);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, -this.rect.x * this.dpr, -this.rect.y * this.dpr);
      strokeThread(ctx, this.SX, this.SY, from, mark, this.w, this.palette, { holes: true });
      this.checkpoints.set(mark, layer);
      this.ladderTimer = window.setTimeout(next, 32);
    };
    this.ladderTimer = window.setTimeout(next, 0);
  }

  saveCheckpoint(index) {
    const layer = makeCanvas(this.cacheLayer.width, this.cacheLayer.height);
    layer.getContext("2d").drawImage(this.cacheLayer, 0, 0);
    this.checkpoints.set(index, layer);
    while (this.checkpoints.size > CHECKPOINT_MAX) {
      let far = -1;
      for (const key of this.checkpoints.keys()) if (Math.abs(key - this.ns) > Math.abs(far - this.ns) || far < 0) far = key;
      this.checkpoints.delete(far);
    }
  }

  extendCache() {
    const dpr = this.dpr;
    const rect = this.rect;
    const ctx = this.cacheLayer.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, -rect.x * dpr, -rect.y * dpr);
    strokeThread(ctx, this.SX, this.SY, this.cachedTo, this.ns, this.w, this.palette, { holes: true });
    this.cachedTo = this.ns;
  }

  ensure(count) {
    if (count <= this.cap) return;
    let cap = this.cap;
    while (cap < count) cap *= 2;
    for (const key of ["X", "Y", "OX", "OY"]) {
      const next = new Float64Array(cap);
      next.set(this[key]);
      this[key] = next;
    }
    this.cap = cap;
  }

  ensureBake(count) {
    if (count <= this.bakeCap) return;
    let cap = this.bakeCap;
    while (cap < count) cap *= 2;
    for (const key of ["BX", "BY", "BC", "BT"]) {
      const next = new Float32Array(cap);
      next.set(this[key]);
      this[key] = next;
    }
    this.bakeCap = cap;
  }

  resetRope() {
    const g = this.g;
    const h = this.h;
    const ax = this.SX[this.N - 1];
    const ay = this.SY[this.N - 1];
    this.park = this.parkPose();
    const span = Math.hypot(this.park.x - ax, this.park.y - ay);
    const sag = Math.min(g.D * 0.2, (g.floor - (g.cy + g.outer)) * 0.75);
    const length = span + Math.max(40, g.cy + g.outer - ay + sag) * 1.7;
    const count = Math.max(8, Math.round(length / h));
    this.parked = true;
    this.tuck = null;
    this.ensure(count + 1);
    this.n = count + 1;
    this.h0 = h;
    this.m = 0;
    this.grip = -1;
    this.tailLength = count * h;
    for (let i = 0; i < this.n; i += 1) {
      const t = i / (this.n - 1);
      const x = ax + (this.park.x - ax) * t;
      const y = ay + (this.park.y - ay) * t + Math.sin(t * Math.PI) * length * 0.42;
      this.X[i] = x;
      this.Y[i] = y;
      this.OX[i] = x;
      this.OY[i] = y;
    }
    this.heights = new Float32Array(Math.ceil(g.W) + 2);
    for (let s = 0; s < 900; s += 1) this.step(SUB, 1);
    for (let i = 0; i < this.n; i += 1) {
      this.OX[i] = this.X[i];
      this.OY[i] = this.Y[i];
    }
  }

  parkPose() {
    const g = this.g;
    const angle = (40 * Math.PI) / 180;
    const r = g.linen * 0.86;
    const dir = (-46 * Math.PI) / 180;
    return { x: g.cx + Math.sin(angle) * r, y: g.cy + Math.cos(angle) * r, ux: Math.cos(dir), uy: Math.sin(dir) };
  }

  tuckProgress() {
    if (!this.tuck) return 1;
    const t = clamp((performance.now() - this.tuck.at) / this.tuck.ms, 0, 1);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  unpark() {
    this.parked = false;
    this.tuck = null;
  }

  anchor() {
    const i = this.ns;
    if (this.sewCarry > 0 && i < this.N - 1) {
      const t = this.sewCarry / this.SL[i];
      return [this.SX[i] + (this.SX[i + 1] - this.SX[i]) * t, this.SY[i] + (this.SY[i + 1] - this.SY[i]) * t];
    }
    return [this.SX[i], this.SY[i]];
  }

  root() {
    const plan = this.sewPlan;
    if (!plan) return this.anchor();
    const t = clamp((performance.now() - plan.at) / 380, 0, 1);
    const e = t * t * (3 - 2 * t);
    return [plan.fromX + (plan.ex - plan.fromX) * e, plan.fromY + (plan.ey - plan.fromY) * e];
  }

  surface(x) {
    const i = clamp(Math.round(x), 0, this.heights.length - 1);
    return this.g.floor - this.heights[i];
  }

  step(dt, handFrac) {
    const n = this.n;
    const X = this.X;
    const Y = this.Y;
    const OX = this.OX;
    const OY = this.OY;
    const gravity = 2400 * (this.g.D / 560) * dt * dt;
    const r = this.w * 0.5;
    const k = this.grip;
    let hx = 0;
    let hy = 0;
    const [ax, ay] = this.root();
    if (k > 0) {
      hx = this.handFrom.x + (this.hand.x - this.handFrom.x) * handFrac;
      hy = this.handFrom.y + (this.hand.y - this.handFrom.y) * handFrac;
      const chord = Math.hypot(hx - ax, hy - ay) || 1e-6;
      for (let i = 1; i <= k; i += 1) {
        const t = Math.min(1, (this.h0 + (i - 1) * this.h) / chord);
        OX[i] = X[i];
        OY[i] = Y[i];
        X[i] = ax + (hx - ax) * t;
        Y[i] = ay + (hy - ay) * t + this.sag * 4 * t * (1 - t);
      }
    }
    for (let i = k > 0 ? k + 1 : 1; i < n; i += 1) {
      const resting = Y[i] >= this.surface(X[i]) - r - 0.5;
      const damp = resting ? 0.9 : 0.978;
      const vx = (X[i] - OX[i]) * damp;
      const vy = (Y[i] - OY[i]) * damp;
      OX[i] = X[i];
      OY[i] = Y[i];
      X[i] += clamp(vx, -14, 14);
      Y[i] += clamp(vy, -14, 14) + gravity;
    }
    const h = this.h;
    const needle = this.m === 0 ? n - 1 : -1;
    const pinned = needle > 0 && (this.parked || this.tuck) ? needle : -1;
    let px = 0;
    let py = 0;
    if (pinned > 0) {
      if (this.parked) {
        px = this.park.x;
        py = this.park.y;
      } else {
        const t = this.tuckProgress();
        const lift = Math.sin(t * Math.PI) * this.g.D * 0.05;
        px = this.tuck.x + (this.park.x - this.tuck.x) * t;
        py = this.tuck.y + (this.park.y - this.tuck.y) * t - lift;
      }
    }
    const hasFrontier = this.m > 0;
    const fx = hasFrontier ? this.BX[this.m - 1] : 0;
    const fy = hasFrontier ? this.BY[this.m - 1] : 0;
    for (let it = 0; it < ITERATIONS; it += 1) {
      X[0] = ax;
      Y[0] = ay;
      if (k > 0) {
        X[k] = hx;
        Y[k] = hy;
      }
      if (pinned > 0) {
        X[pinned] = px;
        Y[pinned] = py;
      }
      const forward = (it & 1) === 0;
      for (let s = 0; s < n - 1; s += 1) {
        const i = forward ? s : n - 2 - s;
        const j = i + 1;
        const rest = i === 0 ? this.h0 : h;
        const dx = X[j] - X[i];
        const dy = Y[j] - Y[i];
        const d = Math.hypot(dx, dy) || 1e-6;
        const wi = i === 0 || i <= k ? 0 : i === needle ? 0.4 : 1;
        const wj = j <= k || j === pinned ? 0 : j === needle ? 0.4 : 1;
        const sum = wi + wj;
        if (sum === 0) continue;
        const diff = (d - rest) / d / sum;
        X[i] += dx * diff * wi;
        Y[i] += dy * diff * wi;
        X[j] -= dx * diff * wj;
        Y[j] -= dy * diff * wj;
      }
      if (hasFrontier && n - 1 !== k) {
        const e = n - 1;
        const dx = X[e] - fx;
        const dy = Y[e] - fy;
        const d = Math.hypot(dx, dy) || 1e-6;
        if (d > h) {
          const diff = (d - h) / d;
          X[e] -= dx * diff;
          Y[e] -= dy * diff;
        }
      }
      for (let i = 1; i < n; i += 1) {
        if (i <= k || i === pinned) continue;
        const floorY = this.surface(X[i]) - r;
        if (Y[i] > floorY) {
          Y[i] = floorY;
          OX[i] = X[i] - (X[i] - OX[i]) * 0.12;
        }
        if (X[i] < r) X[i] = r;
        else if (X[i] > this.g.W - r) X[i] = this.g.W - r;
      }
    }
  }

  insertAtAnchor(points) {
    const count = points.length / 2;
    if (!count) return;
    this.ensure(this.n + count);
    const { X, Y, OX, OY } = this;
    X.copyWithin(1 + count, 1, this.n);
    Y.copyWithin(1 + count, 1, this.n);
    OX.copyWithin(1 + count, 1, this.n);
    OY.copyWithin(1 + count, 1, this.n);
    for (let c = 0; c < count; c += 1) {
      const src = count - 1 - c;
      X[1 + c] = points[src * 2];
      Y[1 + c] = points[src * 2 + 1];
      OX[1 + c] = X[1 + c];
      OY[1 + c] = Y[1 + c];
    }
    this.n += count;
    if (this.grip > 0) this.grip += count;
  }

  insertAt(index, x, y) {
    this.ensure(this.n + 1);
    const { X, Y, OX, OY } = this;
    X.copyWithin(index + 1, index, this.n);
    Y.copyWithin(index + 1, index, this.n);
    OX.copyWithin(index + 1, index, this.n);
    OY.copyWithin(index + 1, index, this.n);
    X[index] = x;
    Y[index] = y;
    OX[index] = x;
    OY[index] = y;
    this.n += 1;
  }

  removeAt(index) {
    const { X, Y, OX, OY } = this;
    X.copyWithin(index, index + 1, this.n);
    Y.copyWithin(index, index + 1, this.n);
    OX.copyWithin(index, index + 1, this.n);
    OY.copyWithin(index, index + 1, this.n);
    this.n -= 1;
  }

  popStitches(length) {
    this.popCredit += length;
    let freed = 0;
    while (this.ns > 0 && this.popCredit >= this.SL[this.ns - 1]) {
      const l = this.SL[this.ns - 1];
      this.popCredit -= l;
      freed += l;
      this.ns -= 1;
    }
    if (this.ns === 0) this.popCredit = 0;
    return freed;
  }

  sewStitches(length) {
    let left = length;
    while (left > 0 && this.ns < this.N - 1) {
      const room = this.SL[this.ns] - this.sewCarry;
      const take = Math.min(room, left);
      this.sewCarry += take;
      left -= take;
      if (this.sewCarry >= this.SL[this.ns] - 1e-4) {
        this.sewCarry = 0;
        this.ns += 1;
      }
    }
  }

  startSew() {
    if (this.ns >= this.N - 1) return;
    let total = -this.sewCarry;
    for (let i = this.ns; i < this.N - 1; i += 1) total += this.SL[i];
    const g = this.g;
    const fx = this.m > 0 ? this.BX[this.m - 1] : this.X[this.n - 1];
    const fy = this.m > 0 ? this.BY[this.m - 1] : this.Y[this.n - 1];
    const angle = clamp(Math.atan2(fy - g.cy, fx - g.cx), (28 * Math.PI) / 180, (152 * Math.PI) / 180);
    const reach = g.outer - g.ring * 0.5;
    const [fromX, fromY] = this.anchor();
    const at = performance.now();
    this.sewPlan = {
      at,
      total,
      done: 0,
      ms: this.reduced ? 700 : clamp(2300 + total / 80, 2400, 3000),
      m0: this.m,
      pileAt: at,
      fromX,
      fromY,
      ex: g.cx + Math.cos(angle) * reach,
      ey: g.cy + Math.sin(angle) * reach,
    };
    this.mode = "sew";
    this.unpark();
  }

  advanceSew(now, dt) {
    const plan = this.sewPlan;
    const p = clamp((now - plan.at) / plan.ms, 0, 1);
    const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    const target = plan.total * eased;
    this.sewStitches(target - plan.done);
    plan.done = target;
    const reel = 1100 * (this.g.D / 560) * dt;
    this.h0 -= reel;
    while (this.h0 <= 0) {
      if (this.n > 4) {
        this.removeNearAnchor();
        this.h0 += this.h;
      } else {
        this.h0 = this.h * 0.5;
        break;
      }
    }
    const keep = Math.round(plan.m0 * (1 - eased));
    if (this.m > keep && (now - plan.pileAt > 110 || keep === 0)) {
      this.m = keep;
      if (this.m === 0) this.needleAt = null;
      this.recomputeHeights();
      this.rebuildPile();
      plan.pileAt = now;
    }
    if (p >= 1) {
      this.ns = this.N - 1;
      this.sewCarry = 0;
      this.sewPlan = null;
      this.snapshot();
      this.resetRope();
      this.recomputeHeights();
      this.rebuildPile();
      if (this.cachedTo < this.ns) this.extendCache();
      this.mode = "idle";
    }
  }

  removeNearAnchor() {
    const { X, Y, OX, OY } = this;
    X.copyWithin(1, 2, this.n);
    Y.copyWithin(1, 2, this.n);
    OX.copyWithin(1, 2, this.n);
    OY.copyWithin(1, 2, this.n);
    this.n -= 1;
    if (this.grip > 1) this.grip -= 1;
    else if (this.grip === 1) this.grip = -1;
  }

  popLength(length) {
    this.popCredit += length;
    const h = this.h;
    while (this.ns > 0 && this.popCredit >= this.SL[this.ns - 1]) {
      const l = this.SL[this.ns - 1];
      this.popCredit -= l;
      const bx = this.SX[this.ns];
      const by = this.SY[this.ns];
      const ax = this.SX[this.ns - 1];
      const ay = this.SY[this.ns - 1];
      this.ns -= 1;
      let rest = this.h0 + l;
      let d = h - this.h0;
      const local = [];
      while (rest > h) {
        const t = Math.min(1, d / l);
        local.push(bx + (ax - bx) * t, by + (ay - by) * t);
        d += h;
        rest -= h;
      }
      this.h0 = rest;
      if (local.length) this.insertAtAnchor(local);
    }
    if (this.ns === 0) this.popCredit = 0;
  }

  unsewPartial() {
    if (this.sewCarry <= 0) return;
    this.h0 += this.sewCarry;
    this.sewCarry = 0;
  }

  coilNext() {
    const e = this.n - 1;
    const r = this.w * 0.5;
    if (this.m === 0) {
      const x = this.X[e];
      return { x, y: this.surface(x) - r, cx: x, theta: Math.PI / 2 };
    }
    const stream = this.X[Math.max(1, e - 10)];
    let cx = this.BC[this.m - 1];
    cx += clamp((stream - cx) * 0.08, -0.9, 0.9);
    const base = clamp(this.g.D * 0.026, 7, 16);
    const prev = this.BT[this.m - 1];
    const R = base * (0.85 + 0.35 * Math.sin(prev * 0.11) + 0.2 * Math.sin(prev * 0.37 + 1) + 0.1 * Math.sin(prev * 0.93 + 2));
    const theta = prev + this.h / R;
    const x = cx + Math.cos(theta) * R;
    const y = this.surface(x) - r - R * 0.3 * (1 - Math.sin(theta));
    return { x, y, cx, theta };
  }

  bake() {
    if (this.parked || this.tuck || this.mode === "sew") return;
    if (this.bakeHold > 0) {
      this.bakeHold -= 1;
      return;
    }
    let baked = 0;
    const keep = this.grip > 0 ? this.grip + 12 : 24;
    const r = this.w * 0.5;
    while (this.n - 1 > keep && baked < 16) {
      const e = this.n - 1;
      const moving = Math.abs(this.X[e] - this.OX[e]) + Math.abs(this.Y[e] - this.OY[e]);
      const lift = this.surface(this.X[e]) - r - this.Y[e];
      if (lift > 1.5 && (moving > 0.5 || lift > clamp(this.g.D * 0.026, 7, 16) + 4)) break;
      const p = this.coilNext();
      const gap = Math.hypot(this.X[e] - p.x, this.Y[e] - p.y);
      if (gap > this.h * 3) {
        p.x = this.X[e];
        p.y = Math.min(this.Y[e], this.surface(p.x) - r);
        p.cx = p.x - Math.cos(p.theta) * clamp(this.g.D * 0.026, 7, 16);
      } else {
        const pull = 0.55;
        const nx = this.X[e] + (p.x - this.X[e]) * pull;
        p.cx += nx - p.x;
        p.x = nx;
        p.y = Math.min(this.Y[e] + (p.y - this.Y[e]) * pull, this.surface(nx) - r);
      }
      if (this.m >= 2) {
        const m0 = this.m - 1;
        const ex = this.BX[m0] * 2 - this.BX[m0 - 1];
        const ey = this.BY[m0] * 2 - this.BY[m0 - 1];
        p.x = p.x * 0.55 + ex * 0.45;
        p.y = p.y * 0.55 + ey * 0.45;
        const dx = p.x - this.BX[m0];
        const dy = p.y - this.BY[m0];
        const d = Math.hypot(dx, dy) || 1;
        const len = Math.min(d, this.h * 1.1);
        p.x = this.BX[m0] + (dx / d) * len;
        p.y = Math.min(this.BY[m0] + (dy / d) * len, this.surface(p.x) - r);
      }
      this.ensureBake(this.m + 1);
      const m = this.m;
      this.BX[m] = p.x;
      this.BY[m] = p.y;
      this.BC[m] = p.cx;
      this.BT[m] = p.theta;
      this.m += 1;
      this.n -= 1;
      this.deposit(p.x);
      this.drawBaked(m);
      baked += 1;
    }
  }

  deposit(x) {
    const H = this.heights;
    const area = this.h * this.w * 1.5;
    const spread = 4;
    let norm = 0;
    for (let o = -spread * 2; o <= spread * 2; o += 1) norm += Math.exp(-(o * o) / (2 * spread * spread));
    const c = Math.round(x);
    for (let o = -spread * 2; o <= spread * 2; o += 1) {
      const i = c + o;
      if (i < 0 || i >= H.length) continue;
      H[i] += (area * Math.exp(-(o * o) / (2 * spread * spread))) / norm;
    }
    const slope = 0.5;
    for (let pass = 0; pass < 3; pass += 1) {
      for (let i = Math.max(0, c - 60); i < Math.min(H.length - 1, c + 60); i += 1) {
        const diff = H[i] - H[i + 1];
        if (diff > slope) {
          const move = (diff - slope) / 2;
          H[i] -= move;
          H[i + 1] += move;
        } else if (diff < -slope) {
          const move = (-diff - slope) / 2;
          H[i + 1] -= move;
          H[i] += move;
        }
      }
    }
  }

  drawBaked(index) {
    const ctx = this.pileLayer.getContext("2d");
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (index === 0) {
      const dx = this.BX[0] - this.X[this.n - 1];
      const ux = dx < 0 ? -1 : 1;
      const tilt = 0.06 * ux;
      this.needleAt = { ux: Math.cos(tilt) * ux, uy: Math.sin(tilt) };
      this.paintNeedle(ctx, this.BX[0], this.BY[0], this.needleAt.ux, this.needleAt.uy);
      return;
    }
    strokeThread(ctx, this.BX, this.BY, Math.max(0, index - 2), index, this.w, this.palette, { lift: 0, smooth: true, from: 1 });
    ctx.globalCompositeOperation = "destination-over";
    this.pileShadow(ctx, this.BX[index]);
    ctx.globalCompositeOperation = "source-over";
  }

  pileShadow(ctx, x) {
    const floor = this.g.floor;
    const r = clamp(this.g.D * 0.03, 8, 18);
    ctx.fillStyle = "rgba(64, 52, 40, 0.009)";
    ctx.beginPath();
    ctx.ellipse(x, floor + r * 0.08, r * 1.4, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  rebuildPile() {
    if (!this.pileLayer) return;
    const ctx = this.pileLayer.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.pileLayer.width, this.pileLayer.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.m === 0) return;
    for (let i = 0; i < this.m; i += 1) this.pileShadow(ctx, this.BX[i]);
    if (this.needleAt) this.paintNeedle(ctx, this.BX[0], this.BY[0], this.needleAt.ux, this.needleAt.uy);
    if (this.m > 1) strokeThread(ctx, this.BX, this.BY, 0, this.m - 1, this.w, this.palette, { lift: 0, smooth: true });
  }

  recomputeHeights() {
    this.heights.fill(0);
    for (let i = 0; i < this.m; i += 1) this.deposit(this.BX[i]);
  }

  unbake(count) {
    if (this.m === 0 || count <= 0) return;
    this.ensure(this.n + count);
    for (let c = 0; c < count; c += 1) {
      const b = this.m - 1 - c;
      const e = this.n + c;
      this.X[e] = this.BX[b];
      this.Y[e] = this.BY[b];
      this.OX[e] = this.BX[b];
      this.OY[e] = this.BY[b];
    }
    this.n += count;
    this.m -= count;
    this.bakeHold = 30;
    if (this.m === 0) this.needleAt = null;
    this.recomputeHeights();
    this.rebuildPile();
  }

  needleLength() {
    return clamp(this.g.D * 0.1, 30, 62);
  }

  paintNeedle(ctx, x, y, ux, uy, tucked = 0) {
    drawNeedle(ctx, x, y, ux, uy, this.needleLength(), this.w, this.palette, tucked);
  }

  nearest(px, py, tolerance) {
    let best = -1;
    let bestD = tolerance * tolerance;
    for (let i = 1; i < this.n; i += 1) {
      const x0 = this.X[i - 1];
      const y0 = this.Y[i - 1];
      const sx = this.X[i] - x0;
      const sy = this.Y[i] - y0;
      const len = sx * sx + sy * sy || 1e-6;
      const t = clamp(((px - x0) * sx + (py - y0) * sy) / len, 0, 1);
      const dx = x0 + sx * t - px;
      const dy = y0 + sy * t - py;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = t < 0.5 && i > 1 ? i - 1 : i;
      }
    }
    if (this.m === 0 && this.n > 2) {
      const e = this.n - 1;
      const dx = this.X[e] - this.X[e - 1];
      const dy = this.Y[e] - this.Y[e - 1];
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d;
      const uy = dy / d;
      const L = this.needleLength();
      const t = clamp((px - this.X[e]) * ux + (py - this.Y[e]) * uy, 0, L);
      const qx = this.X[e] + ux * t;
      const qy = this.Y[e] + uy * t;
      const nd = (qx - px) ** 2 + (qy - py) ** 2;
      if (nd < bestD * 1.6 || (best < 0 && nd < tolerance * tolerance * 1.6)) best = e;
    }
    return best;
  }

  onPile(x, y) {
    const i = clamp(Math.round(x), 0, this.heights.length - 1);
    let top = 0;
    for (let o = -6; o <= 6; o += 1) top = Math.max(top, this.heights[clamp(i + o, 0, this.heights.length - 1)]);
    return top > 1 && y > this.g.floor - top - 10 && y < this.g.floor + 8;
  }

  local(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  onDown(event) {
    if (!this.ready || event.button > 0) return;
    const p = this.local(event);
    const tolerance = event.pointerType === "touch" ? 28 : 16;
    let hit = this.nearest(p.x, p.y, this.mode === "sew" ? tolerance * 1.5 : tolerance);
    if (hit < 1 && this.m > 0 && this.onPile(p.x, p.y)) {
      this.unbake(Math.min(this.m, 24));
      hit = this.n - 1;
    }
    if (hit < 1) return;
    event.preventDefault();
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      this.pointerId = event.pointerId;
    }
    this.pointerId = event.pointerId;
    this.sewPlan = null;
    this.unsewPartial();
    this.unpark();
    this.warmLadder();
    this.grip = hit;
    this.hand = { x: p.x, y: p.y };
    this.handFrom = { x: this.X[hit], y: this.Y[hit] };
    this.lastHand = { x: p.x, y: p.y };
    this.handSpeed = 0;
    this.sag = 0;
    this.feed = 0;
    this.mode = "held";
    this.canvas.dataset.state = "held";
    this.kick();
  }

  onMove(event) {
    if (!this.ready) return;
    const p = this.local(event);
    if (this.mode === "held" && event.pointerId === this.pointerId) {
      this.hand = { x: clamp(p.x, 0, this.g.W), y: clamp(p.y, 0, this.g.floor) };
      this.kick();
      return;
    }
    if (event.pointerType === "mouse") {
      const hit = this.nearest(p.x, p.y, 16) > 0 || (this.m > 0 && this.onPile(p.x, p.y));
      this.canvas.dataset.state = hit ? "over" : "";
    }
  }

  onUp(event) {
    if (this.mode !== "held" || (event.pointerId !== undefined && event.pointerId !== this.pointerId)) return;
    this.grip = -1;
    this.pointerId = undefined;
    this.mode = "settle";
    this.releasedAt = performance.now();
    this.canvas.dataset.state = "";
    this.kick();
  }

  onKey(event) {
    if (!this.ready) return;
    if (event.key === "ArrowDown" || event.key === " ") {
      event.preventDefault();
      if (this.mode === "held") return;
      this.sewPlan = null;
      this.unsewPartial();
      this.unpark();
      this.popLength(this.g.D * 0.9);
      this.mode = "settle";
      this.releasedAt = performance.now() + 500;
      this.emitStat();
      this.kick();
    } else if (event.key === "r" || event.key === "R" || event.key === "Enter") {
      event.preventDefault();
      if (this.mode === "held" || this.ns >= this.N - 1) return;
      this.startSew();
      this.kick();
    }
  }

  unpickAll() {
    if (!this.ready || this.mode === "held") return;
    this.sewPlan = null;
    this.unsewPartial();
    this.unpark();
    this.popLength(1e9);
    this.mode = "settle";
    this.releasedAt = performance.now() + 900;
    this.emitStat();
    this.kick();
  }

  resew() {
    if (!this.ready || this.mode === "held" || this.ns >= this.N - 1) return;
    this.startSew();
    this.kick();
  }

  startTuck() {
    if (this.parked || this.tuck || this.m > 0 || this.n < 3) return;
    const e = this.n - 1;
    this.tuck = { x: this.X[e], y: this.Y[e], at: performance.now(), ms: this.reduced ? 1 : 1400 };
  }

  pull(dt) {
    const k = this.grip;
    if (k < 1) return;
    const h = this.h;
    const hx = this.hand.x;
    const hy = this.hand.y;
    const moveX = hx - this.lastHand.x;
    const moveY = hy - this.lastHand.y;
    const speed = Math.hypot(moveX, moveY) / Math.max(dt, 1e-3);
    this.handSpeed += (speed - this.handSpeed) * 0.3;
    let [ax, ay] = this.anchor();
    let chord = Math.hypot(hx - ax, hy - ay) || 1e-6;
    const outward = Math.max(0, (moveX * (hx - ax) + moveY * (hy - ay)) / chord);
    let freed = 0;
    if (outward > 0 && this.ns > 0) {
      const gain = clamp(5 + this.handSpeed / 80, 5, 16);
      freed = this.popStitches(Math.min(outward * gain, 6000 * (this.g.D / 560) * dt));
      [ax, ay] = this.anchor();
      chord = Math.hypot(hx - ax, hy - ay) || 1e-6;
    }
    const span = this.h0 + (k - 1) * h;
    const want = Math.max(1, Math.ceil(chord / h));
    this.feed += freed - (chord - span);
    if (want > k) {
      for (let i = k; i < want; i += 1) this.insertAt(1, ax, ay);
    } else if (want < k) {
      for (let i = want; i < k; i += 1) this.removeAt(1);
    }
    this.grip = want;
    this.h0 = Math.max(0.01, chord - (want - 1) * h);
    const g = this.grip;
    while (this.feed >= h) {
      this.insertAt(g + 1, hx + (Math.sin(this.n * 1.7) * h) * 0.3, hy + h * 0.6);
      this.feed -= h;
    }
    while (this.feed <= -h && this.n - 1 > g + 1) {
      this.removeAt(g + 1);
      this.feed += h;
    }
    if (this.feed <= -h && this.m > 0) this.unbake(Math.min(this.m, 8));
    const sagTarget = this.handSpeed < 60 ? Math.min(chord * 0.03, this.g.D * 0.018) : 0;
    this.sag += (sagTarget - this.sag) * 0.08;
    this.lastHand = { x: hx, y: hy };
  }

  loop(now) {
    this.raf = 0;
    if (!this.ready || this.destroyed) return;
    const dt = clamp((now - this.lastTime) / 1000, 0.001, 0.05);
    this.lastTime = now;
    const steps = clamp(Math.round(dt / SUB), 1, 6);
    const before = this.ns;
    if (this.mode === "held") this.pull(dt);
    if (this.mode === "settle" && now - this.releasedAt > SEW_DELAY) {
      if (this.ns < this.N - 1) {
        this.startSew();
      } else {
        this.mode = "idle";
        this.startTuck();
      }
    }
    if (this.mode === "sew" && this.sewPlan) this.advanceSew(now, dt);
    else if (this.mode === "sew") this.mode = "idle";
    if (this.ns < this.cachedTo) this.paintCache(Math.max(0, this.ns - 300));
    else if (this.ns - this.cachedTo > 120 || (this.ns > this.cachedTo && this.mode !== "held" && this.mode !== "sew")) this.extendCache();
    for (let s = 0; s < steps; s += 1) this.step(SUB, (s + 1) / steps);
    this.handFrom = { x: this.hand.x, y: this.hand.y };
    if (this.tuck && this.tuckProgress() >= 1) {
      this.tuck = null;
      this.parked = true;
    }
    this.bake();
    if (this.m > 0 && this.mode !== "sew") {
      const e = this.n - 1;
      const d = Math.hypot(this.X[e] - this.BX[this.m - 1], this.Y[e] - this.BY[this.m - 1]);
      if (d > this.h * 2.6) this.unbake(Math.min(this.m, 24));
    }
    if (before !== this.ns) this.emitStat();
    this.render(now);
    let motion = 0;
    for (let i = 1; i < this.n; i += 1) motion = Math.max(motion, Math.abs(this.X[i] - this.OX[i]) + Math.abs(this.Y[i] - this.OY[i]));
    const busy = this.mode === "held" || this.mode === "sew" || this.mode === "settle" || this.fade || this.tuck;
    this.still = !busy && motion < 0.02 ? this.still + 1 : 0;
    if (this.still > 24) {
      this.mode = "idle";
      return;
    }
    if (this.visible && !document.hidden) this.raf = requestAnimationFrame(this.loop);
  }

  emitStat() {
    this.onStat?.(this.ns + 1, this.N);
  }

  render(now = performance.now()) {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const rect = this.rect;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.cacheLayer, rect.x * dpr, rect.y * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const [ax, ay] = this.anchor();
    if (this.ns > this.cachedTo) strokeThread(ctx, this.SX, this.SY, this.cachedTo, this.ns, this.w, this.palette, { holes: true });
    if (this.sewCarry > 0) strokeThread(ctx, this.SX, this.SY, this.ns, this.ns, this.w, this.palette, { tailX: ax, tailY: ay });
    const [rx, ry] = this.root();
    this.X[0] = rx;
    this.Y[0] = ry;
    const tail = this.m > 0 ? { tailX: this.BX[this.m - 1], tailY: this.BY[this.m - 1] } : {};
    const behind = Boolean(this.sewPlan);
    if (behind) strokeThread(ctx, this.X, this.Y, 0, this.n - 1, this.w, this.palette, { lift: 1, ...tail });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.ringLayer, rect.x * dpr, rect.y * dpr);
    if (this.m > 0) ctx.drawImage(this.pileLayer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!behind) strokeThread(ctx, this.X, this.Y, 0, this.n - 1, this.w, this.palette, { lift: 1, ...tail });
    if (this.m === 0 && this.n > 2) {
      const e = this.n - 1;
      const dx = this.X[e] - this.X[e - 1];
      const dy = this.Y[e] - this.Y[e - 1];
      const d = Math.hypot(dx, dy) || 1;
      let ux = dx / d;
      let uy = dy / d;
      let tucked = 0;
      if (this.parked) {
        ux = this.park.ux;
        uy = this.park.uy;
        tucked = 1;
      } else if (this.tuck) {
        const t = this.tuckProgress();
        const a0 = Math.atan2(uy, ux);
        let a1 = Math.atan2(this.park.uy, this.park.ux);
        while (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
        while (a1 - a0 < -Math.PI) a1 += Math.PI * 2;
        const a = a0 + (a1 - a0) * Math.min(1, t * 1.4);
        ux = Math.cos(a);
        uy = Math.sin(a);
        tucked = t > 0.92 ? (t - 0.92) / 0.08 : 0;
      }
      this.paintNeedle(ctx, this.X[e], this.Y[e], ux, uy, tucked);
    }
    if (this.fade) {
      const t = (now - this.fade.at) / FADE_MS;
      if (t >= 1) this.fade = null;
      else {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1 - t * t * (3 - 2 * t);
        ctx.drawImage(this.fade.layer, 0, 0);
        ctx.globalAlpha = 1;
      }
    }
  }
}
