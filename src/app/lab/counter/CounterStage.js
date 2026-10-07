import { analyseLayout, createMeasurer, drawLayout, layoutTitle, portholeHit } from "./counterAnalysis";

const DEFAULT_PAPER = [241, 245, 249];
const PAPER_MIX = 0.84;
const VIVID = 1.5;
const WHEEL_GAIN = 0.0016;
const LINE_PX = 100 / 6;
const NOTCH_PX = 100;
const NOTCH_LINES = 3;
const NOTCH_COMMIT = 0.25;
const NOTCH_GESTURE_MS = 320;
const NOTCH_MAX_STEPS = 3;
const THROW_TAU = 0.24;
const COMMIT_EDGE = 0.12;
const DIRECTION_SPEED = 0.4;
const TRAVEL_EPSILON = 0.02;
const TICK_TRAVEL = 0.005;
const SPRING_OMEGA = 9;
const PRESS_OMEGA = 26;
const DRAG_PX_PER_LEVEL = 280;
const PINCH_GAIN = 0.8;
const RELEASE_WINDOW_MS = 90;
const TAP_SLOP_PX = 6;
const TAP_MAX_MS = 500;
const WHEEL_IDLE_MS = 140;
const FREE_MAX_VELOCITY = 6;
const DIVE_MS = 900;
const CARRY_MIN_VELOCITY = 0.6;
const CARRY_MIN_S = 0.32;
const CARRY_LEAD = 1.6;
const INTRO_MS = 1100;
const INTRO_DELAY_MS = 1300;
const REVEAL_MS = 420;
const FIRST_POP_DELAY_MS = 250;
const POP_DELAY_MS = 900;
const POP_MS = 440;
const HOVER_MS = 150;
const HOVER_ZOOM = 1.03;
const PRESS_ZOOM = 1.08;
const BLEND_SPAN = 0.3;
const MIN_SCALE = 1 / 40;
const NARROW_MIN_SCALE = 1 / 70;
const NARROW_PX = 640;
const RELAXED_MIN_SCALE = 1 / 90;
const PRIME_COUNT = 6;
const REROOT_PRIME = 3;
const IDLE_RETRY_MS = 120;
const IDLE_BUDGET_MS = 12;
const INTRO_QUIET_MS = 250;
const WORK_MAX = 1024;
const SPRITE_MAX = 256;
const DEPTH = 4;
const CUT_MS = 100;
const COVER_WAIT_MS = 1500;
const FONT_WAIT_MS = 3000;
const RUBBER = 0.3;
const SAMPLE_COUNT = 32;
const MAX_VELOCITY = 10;
const COAST_AFTER_MS = 34;
const INSTANT_GAP_MAX_MS = 100;
const TAIL_SPEED = 1.2;
const TAIL_PEAK = 2.5;
const TAIL_GAP_MS = 60;
const TAIL_MIN_EVENTS = 4;
const FLOOR_INPUT = 0.04;
const SOFT_HEIGHT = 0.15;
const ABOVE_MAX = 32;
const TINT_FADE_MS = 300;
const BLOOM_MIN = 0.5;
const BLOOM_MAX = 0.7;
const PIXELATE_SPAN = 0.1;
const SHATTER_END = 0.97;
const CELL_FADE = 0.05;
const CELL_SHRINK = 0.35;
const POP_TRAVEL = 0.12;
const PIXEL_GRIDS = [8, 16, 32];

const DISSOLVE_ORDER = new Float32Array(64);
for (let index = 0; index < 64; index += 1) {
  const column = index % 8;
  const row = (index - column) / 8;
  const radial = Math.hypot(column - 3.5, row - 3.5) / 4.95;
  const noise = Math.abs(Math.sin(index * 12.9898 + 78.233) * 43758.5453) % 1;
  DISSOLVE_ORDER[index] = 0.6 * radial + 0.4 * noise;
}

const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let low = 0;
    let high = 1;
    let t = x;
    for (let step = 0; step < 28; step += 1) {
      const value = sampleX(t);
      if (Math.abs(value - x) < 1e-6) break;
      if (value < x) low = t;
      else high = t;
      t = (low + high) / 2;
    }
    return sampleY(t);
  };
}

const EASE_IN_OUT = cubicBezier(0.7, 0, 0.3, 1);
const EASE_HOVER = cubicBezier(0.26, 0.08, 0.25, 1);

function readPaper(host) {
  const style = getComputedStyle(host);
  const value = style.getPropertyValue("--color-surface").trim() || style.backgroundColor;
  try {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    const ctx = probe.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = `rgb(${DEFAULT_PAPER.join(" ")})`;
    if (value) ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const { data } = ctx.getImageData(0, 0, 1, 1);
    return [data[0], data[1], data[2]];
  } catch {
    return DEFAULT_PAPER;
  }
}

function prepareCover(item, paper) {
  const lum = 0.2126 * item.red + 0.7152 * item.green + 0.0722 * item.blue;
  const channel = (value, index) => {
    const vivid = clamp(lum + (value - lum) * VIVID, 0, 255);
    return Math.round(vivid + (paper[index] - vivid) * PAPER_MIX);
  };
  const rgb = [channel(item.red, 0), channel(item.green, 1), channel(item.blue, 2)];
  const tint = `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
  const image = item.element;
  const naturalW = image.naturalWidth || image.width || 1;
  const naturalH = image.naturalHeight || image.height || 1;
  const side = Math.min(naturalW, naturalH);
  const crop = { x: (naturalW - side) / 2, y: (naturalH - side) / 2, side };
  const pixels = {};
  for (const grid of PIXEL_GRIDS) {
    const canvas = document.createElement("canvas");
    canvas.width = grid;
    canvas.height = grid;
    const ctx = canvas.getContext("2d", { willReadFrequently: grid === 8 });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, crop.x, crop.y, side, side, 0, 0, grid, grid);
    pixels[grid] = canvas;
  }
  const cells = new Array(64).fill(tint);
  try {
    const { data } = pixels[8].getContext("2d", { willReadFrequently: true }).getImageData(0, 0, 8, 8);
    for (let index = 0; index < 64; index += 1) cells[index] = `rgb(${data[index * 4]} ${data[index * 4 + 1]} ${data[index * 4 + 2]})`;
  } catch {
    cells.fill(tint);
  }
  return { image, crop, tint, rgb, pixels, cells };
}

export default class CounterStage {
  constructor({ root, canvas, probe, tracks, embedded, isFallback, onLand, onReady, onFallback }) {
    this.root = root;
    this.canvas = canvas;
    this.probe = probe;
    this.tracks = tracks;
    this.trackIds = new Set(tracks.map((track) => track.id));
    this.paper = DEFAULT_PAPER;
    this.paperColour = `rgb(${DEFAULT_PAPER.join(" ")})`;
    this.embedded = embedded;
    this.coarse = false;
    this.isFallback = isFallback;
    this.onLand = onLand;
    this.onReady = onReady;
    this.onFallback = onFallback;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.work = document.createElement("canvas");
    this.workCtx = this.work.getContext("2d");
    this.scratch = document.createElement("canvas");
    this.width = 0;
    this.height = 0;
    this.frameW = 0;
    this.frameH = 0;
    this.frameOffsetY = 0;
    this.pixelRatio = 1;
    this.family = "";
    this.ink = "#1a1a1a";
    this.covers = new Map();
    this.analyses = [];
    this.chain = [];
    this.analysedUpTo = 0;
    this.startIndex = 0;
    this.rootNumber = 1;
    this.above = [];
    this.complete = false;
    this.failed = false;
    this.relaxed = false;
    this.minScale = MIN_SCALE;
    this.z = 0;
    this.velocity = 0;
    this.mode = "rest";
    this.target = 0;
    this.tween = null;
    this.gestureFrom = 0;
    this.committed = null;
    this.base = 0;
    this.blendBase = -1;
    this.blendFrom = null;
    this.pop = { level: 0, start: Infinity, done: false };
    this.hover = 0;
    this.hoverFrom = 0;
    this.hoverTarget = 0;
    this.hoverStart = 0;
    this.landed = -1;
    this.introAt = 0;
    this.revealUntil = 0;
    this.lastWheel = 0;
    this.wheelAccum = 0;
    this.notchAccum = 0;
    this.wheelNotched = false;
    this.freeEvents = 0;
    this.freePeak = 0;
    this.freeInput = 0;
    this.instants = new Float64Array(3);
    this.tailSign = 0;
    this.tailDelta = 0;
    this.tintFade = null;
    this.pointers = new Map();
    this.drag = null;
    this.pinch = null;
    this.sampleTimes = new Float64Array(SAMPLE_COUNT);
    this.sampleValues = new Float64Array(SAMPLE_COUNT);
    this.sampleHead = 0;
    this.sampleSize = 0;
    this.frame = 0;
    this.lastTime = 0;
    this.clock = 0;
    this.visible = true;
    this.onscreen = true;
    this.ready = false;
    this.destroyed = false;
    this.cutting = false;
    this.idleHandle = 0;
    this.idleRetry = false;
    this.resizeTimer = 0;
    this.resizePending = false;
    this.timers = new Set();
    this.reduced = false;
    this.resolveCovers = null;
    this.coversReady = new Promise((resolve) => {
      this.resolveCovers = resolve;
    });

    this.tick = this.tick.bind(this);
    this.handleWheel = this.handleWheel.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleWindowKeyDown = this.handleWindowKeyDown.bind(this);
    this.handleVisibility = this.handleVisibility.bind(this);
    this.handleMotionPreference = this.handleMotionPreference.bind(this);
    this.handleResize = this.handleResize.bind(this);
  }

  start() {
    const { root } = this;
    this.paper = readPaper(root.closest(".counter") || root);
    this.paperColour = `rgb(${this.paper.join(" ")})`;
    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reduced = this.motionQuery.matches;
    this.coarse = window.matchMedia("(pointer: coarse)").matches;
    this.motionQuery.addEventListener("change", this.handleMotionPreference);
    this.visible = !document.hidden;
    document.addEventListener("visibilitychange", this.handleVisibility);
    root.addEventListener("pointerdown", this.handlePointerDown);
    root.addEventListener("pointermove", this.handlePointerMove);
    root.addEventListener("pointerup", this.handlePointerUp);
    root.addEventListener("pointercancel", this.handlePointerUp);
    root.addEventListener("pointerleave", this.handlePointerLeave);
    root.addEventListener("keydown", this.handleKeyDown);
    if (!this.embedded) {
      root.addEventListener("wheel", this.handleWheel, { passive: false });
      window.addEventListener("keydown", this.handleWindowKeyDown);
    }
    this.intersection = new IntersectionObserver(
      ([entry]) => {
        this.onscreen = entry.isIntersecting;
        if (this.onscreen) this.requestFrame();
      },
      { rootMargin: "80px" },
    );
    this.intersection.observe(root);
    this.resizer = new ResizeObserver(this.handleResize);
    this.resizer.observe(root.closest(".piece-box") || root);
    this.boot();
  }

  destroy() {
    this.destroyed = true;
    const { root } = this;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.cancelIdle();
    clearTimeout(this.resizeTimer);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.motionQuery?.removeEventListener("change", this.handleMotionPreference);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    root.removeEventListener("pointerdown", this.handlePointerDown);
    root.removeEventListener("pointermove", this.handlePointerMove);
    root.removeEventListener("pointerup", this.handlePointerUp);
    root.removeEventListener("pointercancel", this.handlePointerUp);
    root.removeEventListener("pointerleave", this.handlePointerLeave);
    root.removeEventListener("keydown", this.handleKeyDown);
    root.removeEventListener("wheel", this.handleWheel);
    window.removeEventListener("keydown", this.handleWindowKeyDown);
    this.intersection?.disconnect();
    this.resizer?.disconnect();
    root.style.cursor = "";
    delete root.dataset.cut;
    this.resolveCovers?.();
    this.work.width = 1;
    this.work.height = 1;
    this.scratch.width = 1;
    this.scratch.height = 1;
    this.analyses = [];
    this.covers.clear();
  }

  later(delay, callback) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.destroyed) callback();
    }, delay);
    this.timers.add(timer);
  }

  wait(delay) {
    return new Promise((resolve) => this.later(delay, resolve));
  }

  async boot() {
    this.family = getComputedStyle(this.probe).fontFamily || "sans-serif";
    this.ink = getComputedStyle(this.root).color || this.ink;
    try {
      await Promise.race([document.fonts.load(`600 200px ${this.family}`), this.wait(FONT_WAIT_MS)]);
    } catch {
      this.family = this.family || "sans-serif";
    }
    if (this.destroyed) return;
    this.measureBox();
    this.resetAnalysis(0);
    this.primeChain(2);
    if (this.failed || this.destroyed) return;
    this.scheduleIdle();
    await Promise.all([this.primeAhead(PRIME_COUNT), Promise.race([this.coversReady, this.wait(COVER_WAIT_MS)])]);
    if (this.destroyed || this.failed) return;
    this.primeChain(2);
    if (this.failed) return;
    this.ready = true;
    this.base = 0;
    this.render();
    this.root.dataset.ready = "1";
    this.revealUntil = performance.now() + REVEAL_MS;
    this.onReady?.();
    this.pop = { level: 0, start: Infinity, done: this.reduced };
    this.landed = -1;
    if (!this.reduced) {
      this.introAt = performance.now() + INTRO_DELAY_MS;
      this.later(INTRO_DELAY_MS, () => this.requestFrame());
    }
    this.land(0, true);
    this.applyResize();
  }

  async primeAhead(count) {
    while (!this.destroyed && !this.complete && !this.failed && this.chain.length < count) {
      this.analyseNext();
      await this.wait(0);
    }
  }

  measureBox() {
    const width = Math.max(1, this.root.clientWidth);
    const height = Math.max(1, this.root.clientHeight);
    const cap = this.embedded ? 1.5 : 2;
    const narrow = width < NARROW_PX;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, cap);
    this.frameW = width;
    this.frameH = height;
    this.fitCanvas(width, height);
    this.fitWidth = narrow ? 0.92 : 0.88;
    this.fitHeight = narrow ? 0.56 : 0.62;
    this.fitCentre = 0.53;
    this.minScale = this.relaxed ? RELAXED_MIN_SCALE : narrow ? NARROW_MIN_SCALE : MIN_SCALE;
  }

  fitCanvas(width, height) {
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.pixelRatio);
    this.canvas.height = Math.round(height * this.pixelRatio);
    this.frameOffsetY = (height - this.frameH) / 2;
  }

  resetAnalysis(startIndex) {
    this.cancelIdle();
    this.measurer = createMeasurer(this.family);
    this.analyses = new Array(this.tracks.length);
    this.startIndex = ((startIndex % this.tracks.length) + this.tracks.length) % this.tracks.length;
    this.analysedUpTo = 0;
    this.chain = [];
    this.complete = false;
  }

  primeChain(count) {
    while (!this.complete && !this.failed && this.chain.length < count) this.analyseNext();
  }

  analyseNext() {
    const index = (this.startIndex + this.analysedUpTo) % this.tracks.length;
    const track = this.tracks[index];
    let entry = null;
    try {
      const layout = layoutTitle(track.title, this.measurer, this.frameW, this.frameH, this.fitWidth, this.fitHeight, this.fitCentre);
      const result = analyseLayout(this.scratch, layout, this.family, this.frameW, this.frameH, this.minScale);
      if (result) entry = { ...result, layout, track, trackIndex: index, sprite: null };
    } catch {
      entry = null;
    }
    this.analyses[index] = entry;
    if (entry) this.chain.push(index);
    this.analysedUpTo += 1;
    if (this.analysedUpTo >= this.tracks.length) this.finishAnalysis();
  }

  finishAnalysis() {
    this.complete = true;
    if (this.chain.length >= 2) return;
    if (!this.isFallback) {
      this.failed = true;
      this.onFallback?.();
      return;
    }
    if (!this.relaxed) {
      this.relaxed = true;
      this.minScale = RELAXED_MIN_SCALE;
      this.resetAnalysis(this.startIndex);
    }
  }

  wantsAnalysis() {
    return !this.complete && !this.failed;
  }

  idleAllowed() {
    if (this.mode !== "rest" || this.cutting) return false;
    const now = performance.now();
    if (now < this.revealUntil) return false;
    return !this.introAt || now < this.introAt - INTRO_QUIET_MS;
  }

  retryIdle() {
    if (this.idleRetry) return;
    this.idleRetry = true;
    this.later(IDLE_RETRY_MS, () => {
      this.idleRetry = false;
      this.scheduleIdle();
    });
  }

  scheduleIdle() {
    if (this.idleHandle || this.destroyed || !this.wantsAnalysis()) return;
    const step = (deadline) => {
      this.idleHandle = 0;
      if (this.destroyed || !this.wantsAnalysis()) return;
      if (!this.idleAllowed()) {
        if (this.mode !== "tween" && this.mode !== "spring" && this.mode !== "free") this.retryIdle();
        return;
      }
      const wasComplete = this.complete;
      let analysed = 0;
      while (this.wantsAnalysis() && this.idleAllowed() && (deadline ? deadline.timeRemaining() > IDLE_BUDGET_MS : analysed === 0)) {
        this.analyseNext();
        analysed += 1;
        if (this.failed) return;
      }
      if (this.complete && !wasComplete) this.requestFrame();
      this.scheduleIdle();
    };
    if (typeof window.requestIdleCallback === "function") {
      this.idleHandle = { idle: window.requestIdleCallback(step) };
    } else {
      this.idleHandle = { timeout: setTimeout(step, 48) };
    }
  }

  cancelIdle() {
    if (!this.idleHandle) return;
    if (this.idleHandle.idle) window.cancelIdleCallback(this.idleHandle.idle);
    if (this.idleHandle.timeout) clearTimeout(this.idleHandle.timeout);
    this.idleHandle = 0;
  }

  setCovers(items) {
    if (!items || !items.length) return;
    const baseEntry = this.ready ? this.levelAt(this.base) : null;
    const childEntry = this.ready ? this.levelAt(this.base + 1) : null;
    const hadBase = !baseEntry || this.covers.has(baseEntry.track.id);
    const hadChild = !childEntry || this.covers.has(childEntry.track.id);
    let matched = false;
    for (const item of items) {
      if (!item || !item.element || !this.trackIds.has(item.id)) continue;
      matched = true;
      if (this.covers.has(item.id)) continue;
      try {
        this.covers.set(item.id, prepareCover(item, this.paper));
      } catch {
        this.covers.delete(item.id);
      }
    }
    if (!matched) return;
    this.resolveCovers?.();
    if (this.ready && !this.reduced) {
      const now = performance.now();
      if (!hadBase && this.covers.has(baseEntry.track.id)) this.tintFade = { id: baseEntry.track.id, start: now };
      if (!hadChild && this.covers.has(childEntry.track.id)) this.pop = { level: this.base, start: now, done: false };
    }
    this.requestFrame();
  }

  paperFor(entry, now) {
    const cover = this.coverFor(entry);
    if (!cover) return this.paperColour;
    const fade = this.tintFade;
    if (!fade || fade.id !== entry.track.id) return cover.tint;
    const u = (now - fade.start) / TINT_FADE_MS;
    if (u >= 1) return cover.tint;
    const eased = smoothstep(0, 1, u);
    const { paper } = this;
    const mix = (index) => Math.round(paper[index] + (cover.rgb[index] - paper[index]) * eased);
    return `rgb(${mix(0)} ${mix(1)} ${mix(2)})`;
  }

  levelAt(level) {
    const count = this.chain.length;
    if (level < 0 || !count) return null;
    if (!this.complete && level >= count) return null;
    return this.analyses[this.chain[level % count]];
  }

  maxZ() {
    return this.complete ? Infinity : Math.max(0, this.chain.length - 1);
  }

  baseFor(z) {
    let base = Math.floor(z + 1e-7);
    if (base < 0) base = 0;
    if (!this.complete) base = Math.min(base, Math.max(0, this.chain.length - 1));
    return base;
  }

  clampTarget(target) {
    return clamp(target, 0, this.maxZ());
  }

  rubber(raw) {
    if (raw < 0) return -RUBBER * (1 - Math.exp(raw / RUBBER));
    const max = this.maxZ();
    if (raw > max) return max + RUBBER * (1 - Math.exp(-(raw - max) / RUBBER));
    return raw;
  }

  coverFor(level) {
    return level ? this.covers.get(level.track.id) : null;
  }

  syncBase() {
    const base = this.baseFor(this.z);
    if (base === this.base) return;
    const rising = base > this.base;
    const chained = Math.abs(this.target - this.z) > 1.05 || (this.mode !== "tween" && this.mode !== "spring" && Math.abs(this.velocity) > 2.5);
    const previous = this.levelAt(base - 1);
    this.base = base;
    this.blendBase = base;
    this.blendFrom = chained && previous ? previous.fixed : null;
    this.pop = { level: base, start: Infinity, done: !rising || this.reduced };
  }

  leanFor(level, zoom) {
    return Math.log(zoom) / Math.log(1 / level.scale);
  }

  viewZ() {
    if (this.hover <= 0) return this.z;
    const level = this.levelAt(this.base);
    if (!level || !this.levelAt(this.base + 1)) return this.z;
    return this.z + this.hover * this.leanFor(level, HOVER_ZOOM);
  }

  camera(z = this.viewZ()) {
    const base = this.baseFor(z);
    const level = this.levelAt(base);
    if (!level) return null;
    const f = clamp(z - base, -RUBBER, this.levelAt(base + 1) ? 1 : RUBBER);
    const sigma = Math.pow(level.scale, f);
    const from = this.blendBase === base && this.blendFrom ? this.blendFrom : level.fixed;
    const blend = smoothstep(0, BLEND_SPAN, f);
    const pivotX = from.x + (level.fixed.x - from.x) * blend;
    const pivotY = from.y + (level.fixed.y - from.y) * blend;
    const originX = pivotX * (1 - sigma);
    const originY = pivotY * (1 - sigma);
    return { base, f, a: 1 / sigma, tx: -originX / sigma, ty: -originY / sigma + this.frameOffsetY };
  }

  requestFrame() {
    if (this.frame || this.destroyed || !this.ready || !this.visible || !this.onscreen) return;
    this.frame = requestAnimationFrame(this.tick);
  }

  springing() {
    return Math.abs(this.z - this.target) >= 5e-4 || Math.abs(this.velocity) >= 5e-3;
  }

  animating(now) {
    if (this.mode === "tween" || this.mode === "spring" || this.mode === "free") return true;
    if (this.mode === "press" && this.springing()) return true;
    if (this.hover !== this.hoverTarget) return true;
    if (!this.pop.done && this.pop.start <= now) return true;
    if (this.introAt && now >= this.introAt) return true;
    if (this.tintFade) return true;
    return false;
  }

  tick(now) {
    this.frame = 0;
    if (this.destroyed || !this.visible || !this.onscreen) {
      this.lastTime = 0;
      return;
    }
    const dt = this.lastTime ? clamp((now - this.lastTime) / 1000, 1 / 240, 1 / 20) : 1 / 60;
    this.lastTime = now;
    this.clock = now;
    this.step(now, dt);
    this.syncBase();
    if (this.hover !== this.hoverTarget) {
      const u = clamp((now - this.hoverStart) / HOVER_MS, 0, 1);
      this.hover = u >= 1 ? this.hoverTarget : this.hoverFrom + (this.hoverTarget - this.hoverFrom) * EASE_HOVER(u);
    }
    if (!this.pop.done && now >= this.pop.start + POP_MS) this.pop.done = true;
    if (this.tintFade && now >= this.tintFade.start + TINT_FADE_MS + 32) this.tintFade = null;
    if (this.introAt && now >= this.introAt && this.mode === "rest") {
      this.introAt = 0;
      this.startTween(this.z + 1, INTRO_MS, now);
    }
    this.render();
    if (this.animating(now)) this.requestFrame();
    else this.lastTime = 0;
  }

  step(now, dt) {
    if (this.mode === "tween") {
      const { from, to, slope, start, duration, carry } = this.tween;
      const u = clamp((now - start) / duration, 0, 1);
      const previous = this.z;
      const u2 = u * u;
      const u3 = u2 * u;
      if (carry) this.z = from + (to - from) * (3 * u2 - 2 * u3) + slope * (u3 - 2 * u2 + u);
      else this.z = from + (to - from) * EASE_IN_OUT(u) + slope * u * (1 - u) * (1 - u);
      this.velocity = (this.z - previous) / dt;
      if (u >= 1) this.settle(to);
      return;
    }
    if (this.mode === "spring" || this.mode === "press") {
      const omega = this.mode === "press" ? PRESS_OMEGA : SPRING_OMEGA;
      const offset = this.z - this.target;
      const decay = Math.exp(-omega * dt);
      const drive = this.velocity + omega * offset;
      this.z = this.target + (offset + drive * dt) * decay;
      this.velocity = (this.velocity - drive * omega * dt) * decay;
      if (this.springing()) return;
      if (this.mode === "spring") {
        this.settle(this.target);
        return;
      }
      this.z = this.target;
      this.velocity = 0;
      return;
    }
    if (this.mode !== "free") return;
    const since = now - this.lastWheel;
    if (since > COAST_AFTER_MS) {
      const max = this.maxZ();
      this.z += this.velocity * dt;
      this.velocity *= Math.exp(-dt / THROW_TAU);
      if (this.z < -RUBBER || this.z > max + RUBBER) {
        this.z = clamp(this.z, -RUBBER, max + RUBBER);
        this.velocity = 0;
      } else if (this.z < 0 || this.z > max) {
        this.velocity *= Math.exp(-dt / 0.06);
      }
    }
    if (since > WHEEL_IDLE_MS) this.commitFree(this.freeEvents <= 2);
  }

  commitFree(decisive) {
    this.velocity = clamp(this.velocity, -FREE_MAX_VELOCITY, FREE_MAX_VELOCITY);
    const committed = Math.abs(this.freeInput) >= FLOOR_INPUT ? this.committed : null;
    this.startSpring(this.commitTarget(this.velocity, decisive, committed));
  }

  commitTarget(velocity, decisive = false, committed = null) {
    const { z } = this;
    const travel = z - this.gestureFrom;
    const travelFloor = decisive ? TICK_TRAVEL : TRAVEL_EPSILON;
    const direction = Math.abs(velocity) > DIRECTION_SPEED ? Math.sign(velocity) : Math.abs(travel) > travelFloor ? Math.sign(travel) : 0;
    if (!direction) return this.clampTarget(Math.round(z));
    let target;
    if (decisive && Math.abs(velocity) <= DIRECTION_SPEED) {
      target = direction > 0 ? Math.floor(z + 1e-3) + 1 : Math.ceil(z - 1e-3) - 1;
    } else {
      const projected = z + velocity * THROW_TAU;
      const lead = direction > 0 ? Math.max(z, projected) : Math.min(z, projected);
      const nearest = Math.round(lead);
      if (Math.abs(lead - nearest) <= COMMIT_EDGE) target = nearest;
      else target = direction > 0 ? Math.ceil(lead) : Math.floor(lead);
    }
    if (committed !== null && direction === Math.sign(committed - this.gestureFrom)) {
      const floor = committed + direction;
      target = direction > 0 ? Math.max(target, floor) : Math.min(target, floor);
    }
    return this.clampTarget(target);
  }

  settle(target) {
    this.z = target;
    this.velocity = 0;
    this.mode = "rest";
    this.tween = null;
    this.syncBase();
    this.land(target, false);
    this.resumeResize();
    this.scheduleIdle();
  }

  resumeResize() {
    if (this.resizePending) this.handleResize();
  }

  startSpring(target) {
    this.target = this.clampTarget(target);
    this.mode = "spring";
    this.tween = null;
    this.requestFrame();
  }

  startTween(to, duration, now = performance.now()) {
    const target = this.clampTarget(to);
    const distance = target - this.z;
    const reach = Math.abs(distance);
    const velocity = clamp(this.velocity, -MAX_VELOCITY, MAX_VELOCITY);
    const carry = reach > 1e-3 && velocity * distance > 0 && Math.abs(velocity) > CARRY_MIN_VELOCITY;
    let seconds = duration / 1000;
    if (carry) {
      const longest = Math.max(CARRY_MIN_S, seconds * Math.min(2, 0.6 + 0.4 * reach));
      seconds = clamp((CARRY_LEAD * reach) / Math.abs(velocity), CARRY_MIN_S, longest);
    }
    const slope = carry ? clamp(velocity * seconds, -3 * reach, 3 * reach) : velocity * seconds;
    this.tween = { from: this.z, to: target, slope, start: now, duration: seconds * 1000, carry };
    this.target = target;
    this.mode = "tween";
    this.setHover(false);
    this.requestFrame();
  }

  land(level, initial) {
    if (level === this.landed && !initial) return;
    this.landed = level;
    this.blendFrom = null;
    const entry = this.levelAt(level);
    if (!entry) return;
    if (this.pop.level === level && !this.pop.done && this.pop.start === Infinity) {
      const delay = initial ? FIRST_POP_DELAY_MS : POP_DELAY_MS;
      this.pop.start = performance.now() + delay;
      this.later(delay, () => this.requestFrame());
    }
    this.announce(level);
    this.scheduleIdle();
  }

  announce(level) {
    const entry = this.levelAt(level);
    if (!entry) return;
    this.onLand?.({
      trackIndex: entry.trackIndex,
      number: this.numberAt(level),
      total: this.countTotal(),
      canSurface: level > 0 || this.above.length > 0,
    });
  }

  countTotal() {
    return this.complete ? Math.max(1, this.chain.length) : this.tracks.length;
  }

  numberAt(level) {
    const total = this.countTotal();
    return ((((this.rootNumber - 1 + level) % total) + total) % total) + 1;
  }

  reroot(startTrack, rootNumber) {
    this.resetAnalysis(startTrack);
    this.rootNumber = rootNumber;
    this.primeChain(REROOT_PRIME);
    if (this.failed) return false;
    this.z = 0;
    this.velocity = 0;
    this.mode = "rest";
    this.tween = null;
    this.base = 0;
    this.target = 0;
    this.blendBase = -1;
    this.blendFrom = null;
    this.committed = null;
    this.tailSign = 0;
    this.drag = null;
    this.pinch = null;
    this.pointers.clear();
    this.hover = 0;
    this.hoverTarget = 0;
    this.root.style.cursor = "";
    this.pop = { level: 0, start: Infinity, done: true };
    this.landed = -1;
    return true;
  }

  climb() {
    if (!this.above.length || this.cutting) return;
    const current = this.levelAt(0);
    const parentNumber = this.numberAt(-1);
    const parent = this.above.pop();
    if (!this.reroot(parent, parentNumber)) return;
    const child = this.levelAt(1);
    if (this.reduced || !current || !child || child.trackIndex !== current.trackIndex) {
      this.cut(0);
      return;
    }
    this.z = 1;
    this.base = 1;
    this.target = 1;
    this.landed = 1;
    this.pop = { level: 1, start: Infinity, done: true };
    this.startTween(0, DIVE_MS);
  }

  cancelIntro() {
    this.introAt = 0;
  }

  dive(delta) {
    if (!this.ready || !delta) return;
    this.cancelIntro();
    const moving = this.mode === "tween" || this.mode === "spring";
    const from = moving ? this.target : delta > 0 ? Math.floor(this.z + 1e-3) : Math.ceil(this.z - 1e-3);
    const to = this.clampTarget(from + delta);
    if (to === from) {
      if (delta < 0 && from === 0 && !moving && this.above.length) {
        this.climb();
        return;
      }
      if (moving || this.reduced) return;
      this.velocity = Math.sign(delta) * 1.6;
      this.startSpring(from);
      return;
    }
    if (this.reduced) {
      this.cut(to);
      return;
    }
    this.startTween(to, DIVE_MS);
  }

  surface() {
    this.dive(-1);
  }

  cut(to) {
    if (this.cutting) return;
    this.cutting = true;
    this.mode = "rest";
    this.root.dataset.cut = "1";
    this.later(CUT_MS, () => {
      this.z = to;
      this.velocity = 0;
      this.tween = null;
      this.syncBase();
      this.pop.done = true;
      this.render();
      delete this.root.dataset.cut;
      this.cutting = false;
      this.land(to, false);
      this.resumeResize();
    });
  }

  setDirectZ(raw) {
    this.z = this.rubber(raw);
    this.syncBase();
    this.requestFrame();
  }

  resetSamples(time) {
    this.sampleHead = 0;
    this.sampleSize = 0;
    this.pushSample(time);
  }

  pushSample(time) {
    this.sampleTimes[this.sampleHead] = time;
    this.sampleValues[this.sampleHead] = this.z;
    this.sampleHead = (this.sampleHead + 1) % SAMPLE_COUNT;
    this.sampleSize = Math.min(SAMPLE_COUNT, this.sampleSize + 1);
  }

  releaseVelocity() {
    if (this.sampleSize < 2) return 0;
    const newest = (this.sampleHead - 1 + SAMPLE_COUNT) % SAMPLE_COUNT;
    const newestTime = this.sampleTimes[newest];
    let oldest = newest;
    for (let count = 1; count < this.sampleSize; count += 1) {
      const index = (newest - count + SAMPLE_COUNT) % SAMPLE_COUNT;
      if (newestTime - this.sampleTimes[index] > RELEASE_WINDOW_MS) break;
      oldest = index;
    }
    const span = newestTime - this.sampleTimes[oldest];
    if (span < 8) return 0;
    return clamp(((this.sampleValues[newest] - this.sampleValues[oldest]) / span) * 1000, -MAX_VELOCITY, MAX_VELOCITY);
  }

  release() {
    const velocity = this.releaseVelocity();
    const target = this.commitTarget(velocity);
    if (this.reduced) {
      if (target === Math.round(this.z) && Math.abs(this.z - target) < 0.02) {
        this.z = target;
        this.mode = "rest";
        this.syncBase();
        this.requestFrame();
        this.resumeResize();
        return;
      }
      this.cut(target);
      return;
    }
    this.velocity = velocity;
    this.startSpring(target);
  }

  lean(direction) {
    const rest = Math.round(this.z);
    const level = this.levelAt(rest);
    if (!level) return;
    if (direction > 0 ? !this.levelAt(rest + 1) : rest <= 0) return;
    this.gestureFrom = rest;
    this.target = rest + direction * this.leanFor(level, PRESS_ZOOM);
    this.mode = "press";
    this.requestFrame();
  }

  handlePointerDown(event) {
    if (!this.ready) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    this.cancelIntro();
    if (this.embedded) {
      this.drag = event.isPrimary ? { id: event.pointerId, x0: event.clientX, y0: event.clientY, t0: event.timeStamp, shift: event.shiftKey } : null;
      return;
    }
    try {
      this.root.setPointerCapture(event.pointerId);
    } catch {
      this.root.releasePointerCapture?.(event.pointerId);
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 1) {
      this.drag = { id: event.pointerId, x0: event.clientX, y0: event.clientY, z0: this.z, t0: event.timeStamp, moved: false, shift: event.shiftKey };
      this.resetSamples(event.timeStamp);
      if (this.mode === "rest" && !this.reduced && !this.cutting) this.lean(event.shiftKey ? -1 : 1);
      return;
    }
    if (this.pointers.size === 2) {
      const [first, second] = Array.from(this.pointers.values());
      this.pinch = { distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)), raw: this.z };
      if (this.drag) this.drag.moved = true;
      this.gestureFrom = this.z;
      this.mode = "pinch";
      this.tween = null;
      this.setHover(false);
      this.resetSamples(event.timeStamp);
    }
  }

  handlePointerMove(event) {
    if (!this.ready) return;
    if (this.embedded) {
      const { drag } = this;
      if (drag && drag.id === event.pointerId) {
        const dx = event.clientX - drag.x0;
        const dy = event.clientY - drag.y0;
        if (dx * dx + dy * dy >= TAP_SLOP_PX * TAP_SLOP_PX) this.drag = null;
      } else if (event.pointerType === "mouse") {
        this.updateHover(event);
      }
      return;
    }
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) {
      if (event.pointerType === "mouse") this.updateHover(event);
      return;
    }
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (this.pinch && this.pointers.size >= 2) {
      const [first, second] = Array.from(this.pointers.values());
      const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
      const level = this.levelAt(this.base);
      if (level) this.pinch.raw += (PINCH_GAIN * Math.log(distance / this.pinch.distance)) / Math.log(1 / level.scale);
      this.pinch.distance = distance;
      this.setDirectZ(this.pinch.raw);
      this.pushSample(event.timeStamp);
      return;
    }
    const { drag } = this;
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.moved) {
      const dx = event.clientX - drag.x0;
      const dy = event.clientY - drag.y0;
      if (dx * dx + dy * dy < TAP_SLOP_PX * TAP_SLOP_PX) return;
      drag.moved = true;
      drag.y0 = event.clientY;
      drag.z0 = this.z;
      if (this.mode !== "press") this.gestureFrom = this.z;
      this.mode = "drag";
      this.tween = null;
      this.velocity = 0;
      this.setHover(false);
      this.root.style.cursor = "grabbing";
      this.resetSamples(event.timeStamp);
    }
    this.setDirectZ(drag.z0 - (event.clientY - drag.y0) / DRAG_PX_PER_LEVEL);
    this.pushSample(event.timeStamp);
  }

  handlePointerUp(event) {
    if (this.embedded) {
      const { drag } = this;
      this.drag = null;
      if (!drag || drag.id !== event.pointerId || event.type !== "pointerup") return;
      if (event.timeStamp - drag.t0 < TAP_MAX_MS) this.dive(event.shiftKey || drag.shift ? -1 : 1);
      return;
    }
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.delete(event.pointerId);
    if (this.pinch) {
      if (this.pointers.size >= 2) return;
      this.pinch = null;
      const remaining = Array.from(this.pointers.entries())[0];
      if (remaining) {
        const [id, point] = remaining;
        this.drag = { id, x0: point.x, y0: point.y, z0: this.z, t0: event.timeStamp, moved: true, shift: false };
        this.mode = "drag";
        return;
      }
      this.drag = null;
      this.release();
      return;
    }
    const { drag } = this;
    if (!drag || drag.id !== event.pointerId) return;
    this.drag = null;
    this.root.style.cursor = "";
    if (!drag.moved) {
      if (event.type === "pointerup" && event.timeStamp - drag.t0 < TAP_MAX_MS) {
        this.dive(event.shiftKey || drag.shift ? -1 : 1);
        return;
      }
      if (this.mode === "press") this.release();
      return;
    }
    this.release();
  }

  handlePointerLeave(event) {
    if (event.pointerType !== "mouse" || this.pointers.size) return;
    this.setHover(false);
  }

  updateHover(event) {
    if (this.mode !== "rest" && this.mode !== "spring" && this.mode !== "press") return;
    const camera = this.camera();
    if (!camera || !this.levelAt(camera.base + 1)) {
      this.setHover(false);
      return;
    }
    const rect = this.root.getBoundingClientRect();
    const x = (event.clientX - rect.left - camera.tx) / camera.a;
    const y = (event.clientY - rect.top - camera.ty) / camera.a;
    this.setHover(portholeHit(this.levelAt(camera.base), x, y));
  }

  setHover(active) {
    const next = active ? 1 : 0;
    if (next === this.hoverTarget) return;
    this.hoverFrom = this.hover;
    this.hoverTarget = next;
    this.hoverStart = performance.now();
    this.root.style.cursor = active ? "zoom-in" : "";
    this.requestFrame();
  }

  stepNotch(deltaMode, rawY, delta, gap) {
    const notches = deltaMode === 1 ? rawY / NOTCH_LINES : deltaMode === 2 ? rawY : delta / NOTCH_PX;
    const direction = Math.sign(notches);
    if (!direction) return;
    if (gap > NOTCH_GESTURE_MS || Math.sign(this.notchAccum) === -direction) this.notchAccum = 0;
    this.notchAccum += notches;
    if (Math.abs(this.notchAccum) < NOTCH_COMMIT) return;
    const steps = clamp(Math.round(Math.abs(this.notchAccum)), 1, NOTCH_MAX_STEPS);
    this.notchAccum = 0;
    this.dive(direction * steps);
  }

  handleWheel(event) {
    if (!this.ready) return;
    event.preventDefault();
    this.cancelIntro();
    const deltaMode = event.deltaMode;
    const rawY = event.deltaY;
    const pinching = event.ctrlKey;
    const now = performance.now();
    let delta = rawY;
    if (deltaMode === 1) delta *= LINE_PX;
    else if (deltaMode === 2) delta *= this.height;
    const gap = now - this.lastWheel;
    this.lastWheel = now;
    const level = this.levelAt(this.base);
    if (!level || this.pointers.size) return;
    const looksNotched = !pinching && (deltaMode !== 0 || (Math.abs(delta) >= 60 && Number.isInteger(rawY)));
    const notched = looksNotched && (gap > 24 || this.wheelNotched);
    this.wheelNotched = notched;
    if (this.reduced) {
      if (gap > 320) this.wheelAccum = 0;
      this.wheelAccum += pinching ? -rawY / 100 / Math.log(1 / level.scale) : notched ? Math.sign(delta) : delta * WHEEL_GAIN;
      if (Math.abs(this.wheelAccum) >= 0.35 && !this.cutting) {
        const to = this.clampTarget(Math.round(this.z) + Math.sign(this.wheelAccum));
        this.wheelAccum = 0;
        if (to !== Math.round(this.z)) this.cut(to);
      }
      return;
    }
    if (notched) {
      this.tailSign = 0;
      this.stepNotch(deltaMode, rawY, delta, gap);
      return;
    }
    if (this.tailSign) {
      if (!pinching && gap <= TAIL_GAP_MS && Math.sign(delta) === this.tailSign && Math.abs(delta) <= this.tailDelta) {
        this.tailDelta = Math.abs(delta);
        return;
      }
      this.tailSign = 0;
    }
    let dz = pinching ? -rawY / 100 / Math.log(1 / level.scale) : delta * WHEEL_GAIN;
    const entering = this.mode !== "free";
    const moving = this.mode === "tween" || this.mode === "spring";
    const carried = moving || (!entering && gap < INSTANT_GAP_MAX_MS) ? this.velocity : 0;
    if (entering) {
      this.gestureFrom = this.z;
      this.committed = moving ? this.target : null;
      this.freeEvents = 0;
      this.freePeak = 0;
      this.freeInput = 0;
      this.instants.fill(0);
      this.tween = null;
      this.setHover(false);
    }
    this.freeEvents += 1;
    const max = this.maxZ();
    if ((this.z < 0 && dz < 0) || (this.z > max && dz > 0)) dz *= 0.25;
    const previous = this.z;
    this.z = clamp(this.z + dz, -RUBBER, max + RUBBER);
    this.freeInput += this.z - previous;
    const instant = (this.z - previous) / (clamp(gap, 8, INSTANT_GAP_MAX_MS) / 1000);
    this.velocity = carried * 0.6 + instant * 0.4;
    this.mode = "free";
    this.syncBase();
    if (!pinching && this.momentumFading(Math.abs(instant))) {
      this.tailSign = Math.sign(delta);
      this.tailDelta = Math.abs(delta);
      this.commitFree(false);
      return;
    }
    this.requestFrame();
  }

  momentumFading(speed) {
    const { instants } = this;
    instants[0] = instants[1];
    instants[1] = instants[2];
    instants[2] = speed;
    if (speed > this.freePeak) this.freePeak = speed;
    if (this.freeEvents < TAIL_MIN_EVENTS || this.freePeak < TAIL_PEAK) return false;
    return instants[0] > instants[1] && instants[1] > instants[2] && instants[2] < TAIL_SPEED;
  }

  handleKeyDown(event) {
    if (!this.ready || event.metaKey || event.ctrlKey || event.altKey) return;
    const { key } = event;
    if (key === " " || key === "Enter" || key === "ArrowDown" || key === "PageDown") {
      event.preventDefault();
      this.dive(1);
    } else if (key === "Backspace" || key === "ArrowUp" || key === "PageUp") {
      event.preventDefault();
      this.dive(-1);
    }
  }

  handleWindowKeyDown(event) {
    const { target } = event;
    if (target !== document.body && target !== document.documentElement) return;
    this.handleKeyDown(event);
  }

  handleVisibility() {
    this.visible = !document.hidden;
    this.lastTime = 0;
    if (this.visible) this.requestFrame();
  }

  handleMotionPreference(event) {
    this.reduced = event.matches;
    if (this.reduced) this.cancelIntro();
  }

  handleResize() {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => this.applyResize(), 120);
  }

  applyResize() {
    if (!this.ready || this.destroyed) return;
    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    if (Math.abs(width - this.width) < 1 && Math.abs(height - this.height) < 1) return;
    if (this.coarse && Math.abs(width - this.frameW) < 1 && Math.abs(height - this.frameH) < SOFT_HEIGHT * this.frameH) {
      this.fitCanvas(width, Math.max(1, height));
      this.render();
      return;
    }
    if (this.mode !== "rest" || this.cutting || this.pointers.size) {
      this.resizePending = true;
      return;
    }
    this.resizePending = false;
    const level = Math.max(0, Math.round(this.z));
    const anchorEntry = this.levelAt(level);
    const anchor = anchorEntry ? anchorEntry.trackIndex : this.startIndex;
    const number = this.numberAt(level);
    for (let above = Math.max(0, level - ABOVE_MAX); above < level; above += 1) {
      const entry = this.levelAt(above);
      if (entry) this.above.push(entry.trackIndex);
    }
    if (this.above.length > ABOVE_MAX) this.above.splice(0, this.above.length - ABOVE_MAX);
    this.measureBox();
    if (!this.reroot(anchor, number)) return;
    this.render();
    this.land(0, false);
  }

  render() {
    const { ctx, width, height, pixelRatio } = this;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    const camera = this.camera();
    if (!camera) {
      ctx.fillStyle = this.paperColour;
      ctx.fillRect(0, 0, width, height);
      return;
    }
    const now = this.clock || performance.now();
    const progress = Math.max(0, camera.f);
    const baseEntry = this.levelAt(camera.base);
    const bloom = this.bloomFor(baseEntry);
    const shatter = bloom + PIXELATE_SPAN;
    const reveal = smoothstep(shatter - 0.04, Math.min(SHATTER_END - 0.05, shatter + 0.18), progress);
    let level = camera.base;
    let scale = camera.a;
    let offsetX = camera.tx;
    let offsetY = camera.ty;
    ctx.fillStyle = this.paperFor(baseEntry, now);
    ctx.fillRect(0, 0, width, height);
    ctx.textBaseline = "alphabetic";
    for (let depth = 0; depth < DEPTH; depth += 1) {
      const entry = this.levelAt(level);
      if (!entry) break;
      if (depth === 1) {
        if (reveal <= 0.001) break;
        ctx.globalAlpha = reveal;
      }
      const child = this.levelAt(level + 1);
      if (child) {
        if (depth === 0) this.drawLivePorthole(entry, child, scale, offsetX, offsetY, progress, bloom, now);
        else this.drawStillPorthole(entry, child, scale, offsetX, offsetY);
      }
      ctx.fillStyle = this.ink;
      drawLayout(ctx, entry.layout, this.family, scale, offsetX, offsetY, width, height, true, pixelRatio);
      if (!child) break;
      const nextScale = scale * entry.scale;
      if (nextScale * child.layout.size < 2.5) break;
      offsetX += scale * entry.shift.x;
      offsetY += scale * entry.shift.y;
      scale = nextScale;
      level += 1;
    }
    ctx.globalAlpha = 1;
  }

  popProgress(level, now) {
    const { pop } = this;
    if (pop.level !== level || pop.done) return 1;
    if (pop.start === Infinity) return 0;
    return clamp((now - pop.start) / POP_MS, 0, 1);
  }

  bloomFor(entry) {
    if (!entry) return BLOOM_MAX;
    const fill = Math.min(this.width, this.height) / Math.max(1e-3, 2 * entry.artHalf);
    return clamp(Math.log(fill) / Math.log(1 / entry.scale), BLOOM_MIN, BLOOM_MAX);
  }

  drawLivePorthole(entry, child, scale, offsetX, offsetY, progress, bloom, now) {
    const { ctx, width, height, pixelRatio } = this;
    const { box } = entry.porthole;
    const left = offsetX + scale * box.x;
    const top = offsetY + scale * box.y;
    const right = left + scale * box.w;
    const bottom = top + scale * box.h;
    const viewLeft = Math.max(0, left);
    const viewTop = Math.max(0, top);
    const viewRight = Math.min(width, right);
    const viewBottom = Math.min(height, bottom);
    if (viewRight <= viewLeft || viewBottom <= viewTop) return;
    const cropW = viewRight - viewLeft;
    const cropH = viewBottom - viewTop;
    const density = Math.min(pixelRatio, WORK_MAX / Math.max(cropW, cropH));
    const workW = Math.max(1, Math.ceil(cropW * density));
    const workH = Math.max(1, Math.ceil(cropH * density));
    if (this.work.width < workW || this.work.height < workH) {
      this.work.width = Math.min(WORK_MAX, Math.max(this.work.width, Math.ceil(workW / 128) * 128));
      this.work.height = Math.min(WORK_MAX, Math.max(this.work.height, Math.ceil(workH / 128) * 128));
    }
    const work = this.workCtx;
    work.setTransform(1, 0, 0, 1, 0, 0);
    work.globalCompositeOperation = "source-over";
    work.globalAlpha = 1;
    work.clearRect(0, 0, workW, workH);
    const cover = this.coverFor(child);
    work.fillStyle = cover ? cover.tint : this.paperColour;
    work.fillRect(0, 0, workW, workH);
    const unit = scale * density;
    const shiftX = (offsetX - viewLeft) * density;
    const shiftY = (offsetY - viewTop) * density;
    let blocky = false;
    if (cover) blocky = this.paintArt(work, cover, entry, unit, shiftX, shiftY, progress, bloom, now);
    work.globalCompositeOperation = "destination-in";
    work.imageSmoothingEnabled = true;
    work.drawImage(entry.porthole.canvas, box.x * unit + shiftX, box.y * unit + shiftY, box.w * unit, box.h * unit);
    work.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = !blocky;
    ctx.drawImage(this.work, 0, 0, workW, workH, viewLeft, viewTop, cropW, cropH);
    ctx.imageSmoothingEnabled = true;
  }

  paintArt(work, cover, entry, unit, shiftX, shiftY, progress, bloom, now) {
    const popU = this.popProgress(this.base, now);
    const focused = this.hover > 0.5 || this.mode === "press";
    const settling = Math.max(popU, progress / POP_TRAVEL);
    const popGrid = focused || settling >= 0.75 ? 0 : settling >= 0.5 ? 32 : settling >= 0.25 ? 16 : 8;
    const pixelStep = PIXELATE_SPAN / 3;
    const diveGrid = progress < bloom ? 0 : progress < bloom + pixelStep ? 32 : progress < bloom + 2 * pixelStep ? 16 : 8;
    const grid = popGrid && diveGrid ? Math.min(popGrid, diveGrid) : popGrid || diveGrid;
    const bump = popU > 0 && popU < 1 ? Math.sin(Math.PI * popU) * Math.pow(1 - popU, 0.6) : 0;
    const zoom = (1 + 0.06 * bump) * (1 + 0.06 * this.hover);
    const half = entry.artHalf * zoom;
    const side = half * 2 * unit;
    const x0 = (entry.centre.x - half) * unit + shiftX;
    const y0 = (entry.centre.y - half) * unit + shiftY;
    const shatterFrom = bloom + PIXELATE_SPAN;
    if (progress >= shatterFrom) {
      const cell = side / 8;
      const spread = Math.max(0, SHATTER_END - CELL_FADE - shatterFrom);
      for (let index = 0; index < 64; index += 1) {
        const fall = clamp((progress - shatterFrom - spread * DISSOLVE_ORDER[index]) / CELL_FADE, 0, 1);
        if (fall >= 1) continue;
        const column = index % 8;
        const row = (index - column) / 8;
        const inset = cell * CELL_SHRINK * 0.5 * fall;
        const cellLeft = Math.round(x0 + column * cell + inset);
        const cellTop = Math.round(y0 + row * cell + inset);
        const cellRight = Math.round(x0 + (column + 1) * cell - inset);
        const cellBottom = Math.round(y0 + (row + 1) * cell - inset);
        work.globalAlpha = 1 - fall;
        work.fillStyle = cover.cells[index];
        work.fillRect(cellLeft, cellTop, cellRight - cellLeft, cellBottom - cellTop);
      }
      work.globalAlpha = 1;
      return true;
    }
    if (grid) {
      work.imageSmoothingEnabled = false;
      work.drawImage(cover.pixels[grid], x0, y0, side, side);
      work.imageSmoothingEnabled = true;
      return true;
    }
    work.imageSmoothingEnabled = true;
    work.imageSmoothingQuality = "high";
    work.drawImage(cover.image, cover.crop.x, cover.crop.y, cover.crop.side, cover.crop.side, x0, y0, side, side);
    return false;
  }

  stillSprite(entry, child) {
    const cover = this.coverFor(child);
    const key = cover ? child.track.id : "paper";
    if (entry.sprite && entry.sprite.key === key) return entry.sprite.canvas;
    const { porthole } = entry;
    const shrink = Math.min(1, SPRITE_MAX / Math.max(porthole.width, porthole.height));
    const spriteW = Math.max(1, Math.round(porthole.width * shrink));
    const spriteH = Math.max(1, Math.round(porthole.height * shrink));
    const canvas = entry.sprite?.canvas ?? document.createElement("canvas");
    canvas.width = spriteW;
    canvas.height = spriteH;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = cover ? cover.tint : this.paperColour;
    ctx.fillRect(0, 0, spriteW, spriteH);
    if (cover) {
      const unit = porthole.scale * shrink;
      const half = entry.artHalf;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(cover.pixels[8], (entry.centre.x - half - porthole.box.x) * unit, (entry.centre.y - half - porthole.box.y) * unit, half * 2 * unit, half * 2 * unit);
    }
    ctx.globalCompositeOperation = "destination-in";
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(porthole.canvas, 0, 0, spriteW, spriteH);
    ctx.globalCompositeOperation = "source-over";
    entry.sprite = { key, canvas };
    return canvas;
  }

  drawStillPorthole(entry, child, scale, offsetX, offsetY) {
    const { box } = entry.porthole;
    const w = scale * box.w;
    const h = scale * box.h;
    if (w < 1.5 || h < 1.5) return;
    const left = offsetX + scale * box.x;
    const top = offsetY + scale * box.y;
    if (left > this.width || top > this.height || left + w < 0 || top + h < 0) return;
    this.ctx.drawImage(this.stillSprite(entry, child), left, top, w, h);
  }
}
