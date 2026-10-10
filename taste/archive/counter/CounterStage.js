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
const IN_SPEED = 7;
const OUT_SPEED = 6;
const SPEED_KNEE = 0.6;
const IN_BURST = 4;
const OUT_BURST = 3;
const BURST_SLACK = 0.3;
const FREE_BURST_S = 0.025;
const TRAVEL_SLICE_S = 0.008;
const FRAME_MS = 1000 / 60;
const FIRST_SLICE_MS = 1000 / 120;
const WALL_SOFT = 0.4;
const WALL_COMMIT = 0.04;
const STEADY_SHARE = 0.6;
const STEADY_WINDOW = 3;
const STEADY_TREND = 0.95;
const TAIL_GROWTH = 1.25;
const TAIL_HOLD = 0.98;
const TAIL_STEADY_EVENTS = 5;
const TAIL_STEADY_PX = 4;
const TAIL_SLOW_EVENTS = 45;
const NOTCH_GAP_MS = 24;
const NOTCH_QUICK_RUN = 2;
const RAMP_S = 0.1;
const LAND_LEVELS = 0.8;
const LAND_SHAPE_AREA = 2 / 5;
const DIVE_MS = 900;
const CARRY_MIN_VELOCITY = 0.6;
const CARRY_MIN_S = 0.32;
const CARRY_LEAD = 1.6;
const INTRO_MS = 1100;
const INTRO_DELAY_MS = 1300;
const REVEAL_MS = 420;
const HOVER_MS = 150;
const HOVER_ZOOM = 1.03;
const PRESS_ZOOM = 1.08;
const AIM_OMEGA = 7;
const AIM_DAMPING = 0.78;
const AIM_HANDOFF = 0.4;
const ARC_SHARE = 0.032;
const ARC_TWIST = 1.1;
const ARC_ANGLE = -0.6;
const ARC_CALM = 0.3;
const ARC_SPEED_FROM = 0.6;
const ARC_SPEED_TO = 4;
const ARC_RESPONSE = 6;
const MIN_SCALE = 1 / 40;
const NARROW_MIN_SCALE = 1 / 70;
const NARROW_PX = 640;
const RELAXED_MIN_SCALE = 1 / 90;
const PRIME_COUNT = 6;
const REROOT_PRIME = 3;
const IDLE_RETRY_MS = 120;
const IDLE_BUDGET_MS = 12;
const INTRO_QUIET_MS = 250;
const SURROUND_CACHE = 4;
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
const COVER_FADE_MS = 300;
const BLOOM_MIN = 0.5;
const BLOOM_MAX = 0.7;
const PIXELATE_SPAN = 0.1;
const SHATTER_END = 0.97;
const PIXEL_GRIDS = [32, 16];
const CELL_GRID = 8;
const CELL_COUNT = CELL_GRID * CELL_GRID;
const CELL_WINDOW = 0.5;
const DISSOLVE_RADIAL = 0.75;
const HOVER_ART = 0.06;

const DISSOLVE_ORDER = new Float32Array(CELL_COUNT);
for (let index = 0; index < CELL_COUNT; index += 1) {
  const middle = (CELL_GRID - 1) / 2;
  const column = index % CELL_GRID;
  const row = (index - column) / CELL_GRID;
  const radial = Math.hypot(column - middle, row - middle) / Math.hypot(middle, middle);
  const noise = Math.abs(Math.sin(index * 12.9898 + 78.233) * 43758.5453) % 1;
  DISSOLVE_ORDER[index] = DISSOLVE_RADIAL * radial + (1 - DISSOLVE_RADIAL) * noise;
}
const ORDER_LOW = Math.min(...DISSOLVE_ORDER);
const ORDER_SPAN = Math.max(...DISSOLVE_ORDER) - ORDER_LOW;
for (let index = 0; index < CELL_COUNT; index += 1) DISSOLVE_ORDER[index] = (DISSOLVE_ORDER[index] - ORDER_LOW) / ORDER_SPAN;

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

function cruisePlan(reach, launch, cap) {
  const rampTime = (peak) => (RAMP_S * Math.abs(peak - launch)) / cap;
  const rampTravel = (peak) => rampTime(peak) * (launch + (2 * (peak - launch)) / 3);
  const landTravel = (peak) => (LAND_LEVELS * peak) / cap;
  if (launch > 0 && landTravel(launch) >= reach) {
    return { launch, peak: launch, ramp: 0, cruise: 0, land: reach / (LAND_SHAPE_AREA * launch) };
  }
  const full = rampTravel(cap) + landTravel(cap);
  if (full <= reach) {
    return { launch, peak: cap, ramp: rampTime(cap), cruise: (reach - full) / cap, land: LAND_LEVELS / (LAND_SHAPE_AREA * cap) };
  }
  let low = Math.max(launch, 1e-3);
  let high = cap;
  for (let step = 0; step < 32; step += 1) {
    const middle = (low + high) / 2;
    if (rampTravel(middle) + landTravel(middle) > reach) high = middle;
    else low = middle;
  }
  return { launch, peak: low, ramp: rampTime(low), cruise: 0, land: (reach - rampTravel(low)) / (LAND_SHAPE_AREA * low) };
}

function cruiseTravel(plan, seconds) {
  const { launch, peak, ramp, cruise, land } = plan;
  if (seconds < ramp) {
    const u = seconds / ramp;
    return launch * seconds + (peak - launch) * ramp * (u * u - (u * u * u) / 3);
  }
  const ramped = ramp * (launch + (2 * (peak - launch)) / 3);
  if (seconds < ramp + cruise) return ramped + peak * (seconds - ramp);
  const left = 1 - clamp((seconds - ramp - cruise) / land, 0, 1);
  const left4 = left * left * left * left;
  return ramped + peak * cruise + peak * land * (LAND_SHAPE_AREA - left4 + (3 / 5) * left4 * left);
}

function softLimit(value, limit) {
  const knee = SPEED_KNEE * limit;
  if (value <= knee) return value;
  return knee + (limit - knee) * Math.tanh((value - knee) / (limit - knee));
}

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
  for (const grid of [...PIXEL_GRIDS, CELL_GRID]) {
    const canvas = document.createElement("canvas");
    canvas.width = grid;
    canvas.height = grid;
    const ctx = canvas.getContext("2d", { willReadFrequently: grid === CELL_GRID });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, crop.x, crop.y, side, side, 0, 0, grid, grid);
    pixels[grid] = canvas;
  }
  const cells = new Array(CELL_COUNT).fill(tint);
  try {
    const { data } = pixels[CELL_GRID].getContext("2d", { willReadFrequently: true }).getImageData(0, 0, CELL_GRID, CELL_GRID);
    for (let index = 0; index < CELL_COUNT; index += 1) cells[index] = `rgb(${data[index * 4]} ${data[index * 4 + 1]} ${data[index * 4 + 2]})`;
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
    this.scratch = document.createElement("canvas");
    this.surrounds = new Map();
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
    this.wallFrom = 0;
    this.committed = null;
    this.governed = false;
    this.travelBudget = 0;
    this.travelStamp = 0;
    this.frameZ = null;
    this.base = 0;
    this.aim = { x: 0, y: 0, vx: 0, vy: 0, base: -1 };
    this.arcEnergy = 0;
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
    this.quickGaps = 0;
    this.recentDeltas = new Float64Array(STEADY_WINDOW * 2);
    this.deltaPeak = 0;
    this.freeEvents = 0;
    this.freePeak = 0;
    this.freeInput = 0;
    this.instants = new Float64Array(3);
    this.tailSign = 0;
    this.tailDelta = 0;
    this.tailHeld = 0;
    this.arrivals = new Map();
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
    this.scratch.width = 1;
    this.scratch.height = 1;
    this.analyses = [];
    this.covers.clear();
    this.arrivals.clear();
    this.surrounds.clear();
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
    this.checkFirstCovers();
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
      if (result) entry = { ...result, layout, track, trackIndex: index };
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
    const fading = this.ready && !this.reduced;
    const now = performance.now();
    let matched = false;
    for (const item of items) {
      if (!item || !item.element || !this.trackIds.has(item.id)) continue;
      matched = true;
      if (this.covers.has(item.id)) continue;
      try {
        this.covers.set(item.id, prepareCover(item, this.paper));
        if (fading) this.arrivals.set(item.id, now);
      } catch {
        this.covers.delete(item.id);
      }
    }
    if (!matched) return;
    this.checkFirstCovers();
    this.requestFrame();
  }

  checkFirstCovers() {
    const first = this.levelAt(0);
    const second = this.levelAt(1);
    if (!first || !second) return;
    if (this.covers.has(first.track.id) && this.covers.has(second.track.id)) this.resolveCovers?.();
  }

  arrivalMix(id, now) {
    const start = this.arrivals.get(id);
    if (start === undefined) return 1;
    return smoothstep(0, COVER_FADE_MS, now - start);
  }

  settleArrivals(now) {
    for (const [id, start] of this.arrivals) {
      if (now - start > COVER_FADE_MS + FRAME_MS) this.arrivals.delete(id);
    }
  }

  paperFor(entry, now) {
    const cover = this.coverFor(entry);
    if (!cover) return this.paperColour;
    const arrival = this.arrivalMix(entry.track.id, now);
    if (arrival >= 1) return cover.tint;
    const { paper } = this;
    const mix = (index) => Math.round(paper[index] + (cover.rgb[index] - paper[index]) * arrival);
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
    const left = this.levelAt(rising ? base - 1 : base + 1);
    const entry = this.levelAt(base);
    this.base = base;
    const start = chained && left ? left.fixed : entry?.fixed;
    this.aim = start ? { x: start.x, y: start.y, vx: 0, vy: 0, base } : { x: 0, y: 0, vx: 0, vy: 0, base: -1 };
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
    let pivotX = level.fixed.x;
    let pivotY = level.fixed.y;
    if (!this.reduced && this.aim.base === base) {
      const hold = smoothstep(AIM_HANDOFF, 1, f);
      pivotX = this.aim.x + (level.fixed.x - this.aim.x) * hold;
      pivotY = this.aim.y + (level.fixed.y - this.aim.y) * hold;
    }
    const originX = pivotX * (1 - sigma);
    const originY = pivotY * (1 - sigma);
    const drift = this.reduced ? 0 : ARC_SHARE * Math.min(this.frameW, this.frameH) * (ARC_CALM + (1 - ARC_CALM) * this.arcEnergy) * Math.sin(Math.PI * z);
    const angle = ARC_ANGLE + ARC_TWIST * z;
    return {
      base,
      f,
      a: 1 / sigma,
      tx: -originX / sigma + Math.cos(angle) * drift,
      ty: -originY / sigma + this.frameOffsetY + Math.sin(angle) * drift,
    };
  }

  stepAim(dt) {
    const level = this.levelAt(this.base);
    if (!level) return;
    if (this.aim.base !== this.base) {
      this.aim = { x: level.fixed.x, y: level.fixed.y, vx: 0, vy: 0, base: this.base };
      return;
    }
    const stiffness = AIM_OMEGA * AIM_OMEGA;
    const friction = 2 * AIM_DAMPING * AIM_OMEGA;
    this.aim.vx += (stiffness * (level.fixed.x - this.aim.x) - friction * this.aim.vx) * dt;
    this.aim.vy += (stiffness * (level.fixed.y - this.aim.y) - friction * this.aim.vy) * dt;
    this.aim.x += this.aim.vx * dt;
    this.aim.y += this.aim.vy * dt;
    const speed = smoothstep(ARC_SPEED_FROM, ARC_SPEED_TO, Math.abs(this.velocity));
    this.arcEnergy += (speed - this.arcEnergy) * (1 - Math.exp(-dt * ARC_RESPONSE));
  }

  snapAim() {
    const level = this.levelAt(this.base);
    this.aim = level ? { x: level.fixed.x, y: level.fixed.y, vx: 0, vy: 0, base: this.base } : { x: 0, y: 0, vx: 0, vy: 0, base: -1 };
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
    if (this.introAt && now >= this.introAt) return true;
    if (this.arrivals.size) return true;
    return false;
  }

  tick(now) {
    this.frame = 0;
    if (this.destroyed || !this.visible || !this.onscreen) {
      this.lastTime = 0;
      this.frameZ = null;
      return;
    }
    const dt = this.lastTime ? clamp((now - this.lastTime) / 1000, 1 / 240, 1 / 20) : 1 / 60;
    this.lastTime = now;
    this.clock = now;
    this.step(now, dt);
    this.syncBase();
    this.stepAim(dt);
    if (this.hover !== this.hoverTarget) {
      const u = clamp((now - this.hoverStart) / HOVER_MS, 0, 1);
      this.hover = u >= 1 ? this.hoverTarget : this.hoverFrom + (this.hoverTarget - this.hoverFrom) * EASE_HOVER(u);
    }
    this.settleArrivals(now);
    if (this.introAt && now >= this.introAt && this.mode === "rest") {
      this.introAt = 0;
      this.startTween(this.z + 1, INTRO_MS, now);
    }
    this.render();
    this.frameZ = this.z;
    if (this.animating(now)) {
      this.requestFrame();
      return;
    }
    this.lastTime = 0;
    this.frameZ = null;
  }

  step(now, dt) {
    if (this.mode === "tween") {
      const { from, to, slope, start, duration, carry, plan, direction } = this.tween;
      const u = clamp((now - start) / duration, 0, 1);
      const previous = this.z;
      const u2 = u * u;
      const u3 = u2 * u;
      if (plan) this.z = from + direction * cruiseTravel(plan, Math.max(0, now - start) / 1000);
      else if (carry) this.z = from + (to - from) * (3 * u2 - 2 * u3) + slope * (u3 - 2 * u2 + u);
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
      const previous = this.z;
      this.z = this.target + (offset + drive * dt) * decay;
      this.velocity = (this.velocity - drive * omega * dt) * decay;
      if (this.governed && this.mode === "spring") this.governSpring(previous, dt);
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
      const wanted = this.velocity * dt;
      const moved = this.freeTravel(wanted, now, true);
      this.z += moved;
      if (Math.abs(moved) < Math.abs(wanted)) this.velocity = moved / dt;
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
    this.velocity = this.capVelocity(this.velocity);
    const committed = Math.abs(this.freeInput) >= FLOOR_INPUT ? this.committed : null;
    const target = this.commitTarget(this.velocity, decisive, committed);
    const direction = Math.sign(target - this.gestureFrom);
    let reach = this.burstLimit(this.wallFrom, direction);
    if (committed !== null && Math.sign(committed - this.gestureFrom) === direction) reach = direction > 0 ? Math.max(reach, committed) : Math.min(reach, committed);
    const limited = direction > 0 ? Math.min(target, reach) : direction < 0 ? Math.max(target, reach) : target;
    const gap = this.clampTarget(limited) - this.z;
    if (decisive && Math.abs(this.velocity) <= DIRECTION_SPEED && Math.abs(gap) > COMMIT_EDGE) {
      this.startTween(limited, DIVE_MS, performance.now(), true);
      return;
    }
    if (this.velocity * gap > 0) this.velocity = Math.sign(gap) * Math.min(Math.abs(this.velocity), SPRING_OMEGA * Math.abs(gap));
    this.startSpring(limited, true);
  }

  speedCap(direction) {
    return direction < 0 ? OUT_SPEED : IN_SPEED;
  }

  capVelocity(velocity) {
    return clamp(velocity, -OUT_SPEED, IN_SPEED);
  }

  burstLimit(origin, direction) {
    if (direction > 0) return Math.floor(origin + IN_BURST + BURST_SLACK);
    return Math.ceil(origin - OUT_BURST - BURST_SLACK);
  }

  wallRoom(direction) {
    const wall = this.burstLimit(this.wallFrom, direction);
    return direction > 0 ? wall - this.z : this.z - wall;
  }

  freeTravel(dz, now, coasting = false) {
    const direction = Math.sign(dz);
    if (!direction) return 0;
    const cap = this.speedCap(direction);
    const elapsed = clamp((now - this.travelStamp) / 1000, 0, FREE_BURST_S);
    this.travelStamp = now;
    this.travelBudget = Math.min(cap * Math.max(elapsed, TRAVEL_SLICE_S), this.travelBudget + cap * elapsed);
    const room = this.wallRoom(direction);
    const budget = this.travelBudget;
    if (room <= 0 || budget <= 1e-6) return 0;
    const wanted = Math.abs(dz) * Math.min(1, room / WALL_SOFT);
    const travel = Math.min(room, coasting ? Math.min(wanted, budget) : softLimit(wanted, budget));
    this.travelBudget -= travel;
    return direction * travel;
  }

  governSpring(previous, dt) {
    const moved = this.z - previous;
    const direction = Math.sign(moved) || Math.sign(this.velocity);
    const spent = this.frameZ === null ? 0 : Math.max(0, direction * (previous - this.frameZ));
    const allowed = Math.max(0, this.speedCap(direction) * dt - spent);
    this.velocity = this.capVelocity(this.velocity);
    if (Math.abs(moved) > allowed) this.z = previous + direction * allowed;
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
    this.governed = false;
    this.syncBase();
    this.snapAim();
    this.arcEnergy = 0;
    this.land(target, false);
    this.resumeResize();
    this.scheduleIdle();
  }

  resumeResize() {
    if (this.resizePending) this.handleResize();
  }

  startSpring(target, governed = false) {
    this.target = this.clampTarget(target);
    this.mode = "spring";
    this.tween = null;
    this.governed = governed;
    this.requestFrame();
  }

  startTween(to, duration, now = performance.now(), governed = false) {
    const target = this.clampTarget(to);
    const distance = target - this.z;
    const reach = Math.abs(distance);
    if (governed && reach > 1e-3) {
      const direction = Math.sign(distance);
      const launch = clamp(this.velocity * direction, -this.speedCap(-direction), this.speedCap(direction));
      const plan = cruisePlan(reach, launch, this.speedCap(direction));
      this.tween = { from: this.z, to: target, direction, plan, start: now, duration: (plan.ramp + plan.cruise + plan.land) * 1000 };
    } else {
      const velocity = clamp(this.velocity, -MAX_VELOCITY, MAX_VELOCITY);
      const carry = reach > 1e-3 && velocity * distance > 0 && Math.abs(velocity) > CARRY_MIN_VELOCITY;
      let seconds = duration / 1000;
      if (carry) {
        const longest = Math.max(CARRY_MIN_S, seconds * Math.min(2, 0.6 + 0.4 * reach));
        seconds = clamp((CARRY_LEAD * reach) / Math.abs(velocity), CARRY_MIN_S, longest);
      }
      const slope = carry ? clamp(velocity * seconds, -3 * reach, 3 * reach) : velocity * seconds;
      this.tween = { from: this.z, to: target, slope, start: now, duration: seconds * 1000, carry };
    }
    this.target = target;
    this.mode = "tween";
    this.governed = false;
    this.setHover(false);
    this.requestFrame();
  }

  land(level, initial) {
    if (level === this.landed && !initial) return;
    this.landed = level;
    const entry = this.levelAt(level);
    if (!entry) return;
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
    this.aim = { x: 0, y: 0, vx: 0, vy: 0, base: -1 };
    this.arcEnergy = 0;
    this.committed = null;
    this.tailSign = 0;
    this.drag = null;
    this.pinch = null;
    this.pointers.clear();
    this.hover = 0;
    this.hoverTarget = 0;
    this.root.style.cursor = "";
    this.landed = -1;
    return true;
  }

  climb(governed = false) {
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
    this.startTween(0, DIVE_MS, performance.now(), governed);
  }

  cancelIntro() {
    this.introAt = 0;
  }

  dive(delta, governed = false) {
    if (!this.ready || !delta) return;
    this.cancelIntro();
    const moving = this.mode === "tween" || this.mode === "spring";
    const from = moving ? this.target : delta > 0 ? Math.floor(this.z + 1e-3) : Math.ceil(this.z - 1e-3);
    let wanted = from + delta;
    if (governed) {
      const reach = this.burstLimit(this.z, Math.sign(delta));
      wanted = delta > 0 ? Math.min(wanted, Math.max(from, reach)) : Math.max(wanted, Math.min(from, reach));
    }
    const to = this.clampTarget(wanted);
    if (to === from) {
      if (delta < 0 && from === 0 && !moving && this.above.length) {
        this.climb(governed);
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
    this.startTween(to, DIVE_MS, performance.now(), governed);
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
    const steps = clamp(Math.round(Math.abs(this.notchAccum)), 1, direction > 0 ? IN_BURST : OUT_BURST);
    this.notchAccum = 0;
    this.dive(direction * steps, true);
  }

  handleWheel(event) {
    if (!this.ready) return;
    event.preventDefault();
    this.cancelIntro();
    const deltaMode = event.deltaMode;
    const rawY = event.deltaY;
    const pinching = event.ctrlKey;
    if (!rawY) return;
    const now = performance.now();
    let delta = rawY;
    if (deltaMode === 1) delta *= LINE_PX;
    else if (deltaMode === 2) delta *= this.height;
    const gap = now - this.lastWheel;
    this.lastWheel = now;
    const level = this.levelAt(this.base);
    if (!level || this.pointers.size) return;
    this.quickGaps = gap > NOTCH_GAP_MS ? 0 : this.quickGaps + 1;
    const looksNotched = !pinching && (deltaMode !== 0 || (Math.abs(delta) >= 60 && Number.isInteger(rawY)));
    const rapid = deltaMode === 0 && this.quickGaps >= NOTCH_QUICK_RUN;
    const notched = looksNotched && !rapid && this.mode !== "free" && (gap > NOTCH_GAP_MS || this.wheelNotched);
    this.wheelNotched = notched;
    if (!notched) this.notchAccum = 0;
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
      const size = Math.abs(delta);
      if (!pinching && gap <= TAIL_GAP_MS && Math.sign(delta) === this.tailSign && size <= this.tailDelta * TAIL_GROWTH) {
        this.tailHeld = size >= this.tailDelta ? this.tailHeld + 1 : 0;
        this.tailDelta = Math.max(size, this.tailDelta * TAIL_HOLD);
        if (this.tailHeld < (size >= TAIL_STEADY_PX ? TAIL_STEADY_EVENTS : TAIL_SLOW_EVENTS)) return;
      }
      this.tailSign = 0;
    }
    let dz = pinching ? -rawY / 100 / Math.log(1 / level.scale) : delta * WHEEL_GAIN;
    const entering = this.mode !== "free";
    const moving = this.mode === "tween" || this.mode === "spring";
    const carried = moving || (!entering && gap < INSTANT_GAP_MAX_MS) ? this.velocity : 0;
    if (entering) {
      this.gestureFrom = this.z;
      this.wallFrom = this.z;
      this.committed = moving ? this.target : null;
      this.freeEvents = 0;
      this.freePeak = 0;
      this.freeInput = 0;
      this.travelBudget = 0;
      this.travelStamp = now - Math.min(FRAME_MS, this.lastTime ? Math.max(0, now - this.lastTime) : FIRST_SLICE_MS);
      this.instants.fill(0);
      this.recentDeltas.fill(0);
      this.deltaPeak = 0;
      this.tween = null;
      this.setHover(false);
    }
    this.freeEvents += 1;
    const direction = Math.sign(dz);
    if (this.steadyInput(Math.abs(delta)) && this.wallRoom(direction) < WALL_SOFT) this.wallFrom = this.burstLimit(this.wallFrom, direction);
    const max = this.maxZ();
    if ((this.z < 0 && dz < 0) || (this.z > max && dz > 0)) dz *= 0.25;
    const previous = this.z;
    this.z = clamp(this.z + this.freeTravel(dz, now), -RUBBER, max + RUBBER);
    this.freeInput += this.z - previous;
    const instant = (this.z - previous) / (clamp(gap, 8, INSTANT_GAP_MAX_MS) / 1000);
    this.velocity = this.capVelocity(carried * 0.6 + instant * 0.4);
    this.mode = "free";
    this.syncBase();
    const fading = !pinching && this.momentumFading(Math.abs(instant));
    if (fading || this.wallRoom(direction) < WALL_COMMIT) {
      if (!pinching) {
        this.tailSign = Math.sign(delta);
        this.tailDelta = Math.abs(delta);
        this.tailHeld = 0;
      }
      this.commitFree(false);
      return;
    }
    this.requestFrame();
  }

  steadyInput(size) {
    const deltas = this.recentDeltas;
    deltas.copyWithin(0, 1);
    deltas[STEADY_WINDOW * 2 - 1] = size;
    if (size > this.deltaPeak) this.deltaPeak = size;
    if (!deltas[0] || size < STEADY_SHARE * this.deltaPeak) return false;
    let earlier = 0;
    let later = 0;
    for (let index = 0; index < STEADY_WINDOW; index += 1) {
      earlier += deltas[index];
      later += deltas[index + STEADY_WINDOW];
    }
    return later >= STEADY_TREND * earlier;
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
    this.frameZ = null;
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
    const entry = camera ? this.levelAt(camera.base) : null;
    if (!entry) {
      ctx.fillStyle = this.paperColour;
      ctx.fillRect(0, 0, width, height);
      return;
    }
    const now = this.clock || performance.now();
    ctx.fillStyle = this.paperFor(entry, now);
    ctx.fillRect(0, 0, width, height);
    ctx.textBaseline = "alphabetic";
    this.drawLevel(camera.base, camera.a, camera.tx, camera.ty, Math.max(0, camera.f), 1 + HOVER_ART * this.hover, now);
  }

  bloomFor(entry) {
    if (!entry) return BLOOM_MAX;
    const fill = Math.min(this.width, this.height) / Math.max(1e-3, 2 * entry.artHalf);
    return clamp(Math.log(fill) / Math.log(1 / entry.scale), BLOOM_MIN, BLOOM_MAX);
  }

  drawLevel(level, scale, offsetX, offsetY, progress, zoom, now) {
    const entry = this.levelAt(level);
    if (!entry) return;
    const child = this.levelAt(level + 1);
    if (child) this.drawPorthole(level, entry, child, scale, offsetX, offsetY, progress, zoom, now);
    const { ctx } = this;
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.ink;
    drawLayout(ctx, entry.layout, this.family, scale, offsetX, offsetY, this.width, this.height, true, this.pixelRatio);
  }

  drawPorthole(level, entry, child, scale, offsetX, offsetY, progress, zoom, now) {
    const { ctx, width, height } = this;
    const { box, inner } = entry.porthole;
    const left = offsetX + scale * box.x;
    const top = offsetY + scale * box.y;
    const boxW = scale * box.w;
    const boxH = scale * box.h;
    if (boxW < 1 || boxH < 1 || left > width || top > height || left + boxW < 0 || top + boxH < 0) return;
    const bloom = this.bloomFor(entry);
    const shatter = bloom + PIXELATE_SPAN;
    const dissolve = clamp((progress - shatter) / (SHATTER_END - shatter), 0, 1);
    const sheet = this.paperFor(child, now);
    ctx.save();
    ctx.beginPath();
    ctx.rect(offsetX + scale * inner.x, offsetY + scale * inner.y, scale * inner.w, scale * inner.h);
    ctx.clip();
    ctx.globalAlpha = 1;
    ctx.fillStyle = sheet;
    ctx.fillRect(0, 0, width, height);
    if (dissolve > 0) this.drawLevel(level + 1, scale * entry.scale, offsetX + scale * entry.shift.x, offsetY + scale * entry.shift.y, 0, 1, now);
    this.paintArt(entry, child, sheet, scale, offsetX, offsetY, progress, bloom, dissolve, zoom, now);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.surroundFor(entry, now), left, top, boxW, boxH);
  }

  paintArt(entry, child, sheet, scale, offsetX, offsetY, progress, bloom, dissolve, zoom, now) {
    const cover = this.coverFor(child);
    const arrival = cover ? this.arrivalMix(child.track.id, now) : 0;
    const half = entry.artHalf * zoom;
    const side = 2 * half * scale;
    const x0 = offsetX + scale * (entry.centre.x - half);
    const y0 = offsetY + scale * (entry.centre.y - half);
    if (dissolve > 0) {
      this.paintCells(cover, arrival < 1 ? sheet : null, arrival, x0, y0, side, dissolve);
      return;
    }
    if (arrival <= 0) return;
    const steps = PIXEL_GRIDS.length + 1;
    const stage = steps * clamp((progress - bloom) / PIXELATE_SPAN, 0, 1);
    const lower = Math.min(steps - 1, Math.floor(stage));
    const blend = smoothstep(0, 1, stage - lower);
    if (blend < 1) this.paintStage(cover, lower, x0, y0, side, arrival);
    if (blend > 0) this.paintStage(cover, lower + 1, x0, y0, side, arrival * blend);
  }

  paintStage(cover, stage, x0, y0, side, strength) {
    const { ctx } = this;
    if (stage > PIXEL_GRIDS.length) {
      this.paintCells(cover, null, strength, x0, y0, side, 0);
      return;
    }
    ctx.globalAlpha = strength;
    if (stage === 0) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(cover.image, cover.crop.x, cover.crop.y, cover.crop.side, cover.crop.side, x0, y0, side, side);
    } else {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(cover.pixels[PIXEL_GRIDS[stage - 1]], x0, y0, side, side);
      ctx.imageSmoothingEnabled = true;
    }
    ctx.globalAlpha = 1;
  }

  paintCells(cover, sheet, strength, x0, y0, side, dissolve) {
    const { ctx, pixelRatio, width, height } = this;
    const snap = (value) => Math.round(value * pixelRatio) / pixelRatio;
    const cell = side / CELL_GRID;
    for (let index = 0; index < CELL_COUNT; index += 1) {
      const start = DISSOLVE_ORDER[index] * (1 - CELL_WINDOW);
      const opacity = 1 - smoothstep(start, start + CELL_WINDOW, dissolve);
      if (opacity <= 0) continue;
      const column = index % CELL_GRID;
      const row = (index - column) / CELL_GRID;
      const left = snap(x0 + column * cell);
      const top = snap(y0 + row * cell);
      const right = snap(x0 + (column + 1) * cell);
      const bottom = snap(y0 + (row + 1) * cell);
      if (right <= left || bottom <= top || right <= 0 || bottom <= 0 || left >= width || top >= height) continue;
      if (sheet) {
        ctx.globalAlpha = opacity;
        ctx.fillStyle = sheet;
        ctx.fillRect(left, top, right - left, bottom - top);
      }
      if (cover && strength > 0) {
        ctx.globalAlpha = opacity * strength;
        ctx.fillStyle = cover.cells[index];
        ctx.fillRect(left, top, right - left, bottom - top);
      }
    }
    ctx.globalAlpha = 1;
  }

  surroundFor(entry, now) {
    const colour = this.paperFor(entry, now);
    const { surrounds } = this;
    const cached = surrounds.get(entry);
    if (cached) surrounds.delete(entry);
    let surround = cached;
    if (!surround || surround.colour !== colour) {
      const { porthole } = entry;
      const canvas = surround ? surround.canvas : document.createElement("canvas");
      if (!surround) {
        canvas.width = porthole.width;
        canvas.height = porthole.height;
      }
      const paint = canvas.getContext("2d");
      paint.globalCompositeOperation = "source-over";
      paint.fillStyle = colour;
      paint.fillRect(0, 0, porthole.width, porthole.height);
      paint.globalCompositeOperation = "destination-out";
      paint.drawImage(porthole.canvas, 0, 0, porthole.width, porthole.height);
      paint.globalCompositeOperation = "source-over";
      surround = { colour, canvas };
    }
    surrounds.set(entry, surround);
    if (surrounds.size > SURROUND_CACHE) surrounds.delete(surrounds.keys().next().value);
    return surround.canvas;
  }
}
