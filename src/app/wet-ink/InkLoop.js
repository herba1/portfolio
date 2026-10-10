import FlatInk from "./flatInk";
import InkSim from "./InkSim";
import { LOOP_TEMPO, PIECE_COUNT, buildPiece, pieceNibScale } from "./brushPieces";
import { BRUSH, INK_HEX, PAPER_HEX, hexToLinear } from "./wetInkParams";

const SUBSTEP = 1 / 180;
const MAX_SUBSTEPS = 9;
const NIB_ANGLE = (40 * Math.PI) / 180;
const WASH_MS = 1600;
const WASH_FLOOD_SHARE = 0.46;
const WASH_DRAIN_FROM = 0.6;
const WASH_TOP = 1.16;
const WASH_FLOOD_BOTTOM = -0.22;
const WASH_DRAIN_BOTTOM = -0.3;
const WASH_LEVEL = 0.42;
const WASH_LIP = 0.36;
const WASH_FLOW = 1.15;
const WASH_BLEED = 14;
const WASH_DISSOLVE = 5;
const WASH_FADE = 6.5;
const QUEUE_LIMIT = 2048;
const STILL_AFTER_MS = 30;
const WET_MIN_MS = 600;
const DRY_SAFETY_MS = 30000;
const DRY_READING = 0.002;
const DRY_ENOUGH = 0.05;
const PROBE_EVERY = 20;
const BEAD_GROW_S = 1.2;
const FIRST_PIECE_DELAY_MS = 560;
const INSTANT_DRY_STEPS = 1600;
const INSTANT_DRY_PER_FRAME = 160;
const INSTANT_DRY_MIN_PER_FRAME = 24;
const INSTANT_DRY_REFERENCE_AREA = 640 * 260;
const LOOP_DRY_CAP_MS = 1500;
const VISITOR_DRY_CAP_MS = 3400;
const REST_MS = 350;
const REDUCED_REST_MS = 3400;
const REST_AFTER_VISITOR_MS = 400;
const VISITOR_IDLE_MS = 2600;
const GAP_MS = 160;
const USER_NIB_REFERENCE = 600;
const USER_NIB_MIN = 0.8;
const USER_NIB_MAX = 1.35;
const POOL_SCALE_LIMIT = 1.3;
const VISITOR_PIECE_SHARE = 0.85;
const SCRIPTED_DWELL_LIMIT_MS = 50;
const RESTING_PRESSURE = 0.95;
const FLICK_PRESSURE_DROP = 0.6;
const FLICK_SPEED = 1.6;
const CLEARED = [0, 0, 0, 0];

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function easeInOutSine(t) {
  return (1 - Math.cos(Math.PI * t)) / 2;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function speedPressure(speed) {
  return RESTING_PRESSURE - FLICK_PRESSURE_DROP * smoothstep(0, FLICK_SPEED, speed);
}

export default class InkLoop {
  constructor({ surface, host, nib, callbacks }) {
    this.surface = surface;
    this.host = host;
    this.canvas = null;
    this.nib = nib;
    this.callbacks = callbacks;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    this.sim = null;
    this.raf = 0;
    this.last = 0;
    this.accumulator = 0;
    this.cssWidth = 0;
    this.cssHeight = 0;
    this.simScale = 1;
    this.rect = null;
    this.queueSegments = new Float32Array(QUEUE_LIMIT * 4);
    this.queueNibs = new Float32Array(QUEUE_LIMIT * 4);
    this.queueCount = 0;
    this.pen = { down: false, id: -1, x: 0, y: 0, t: 0, r: 1, speed: 0, shape: 1, still: 0, lastMoveAt: 0, isPen: false, pressure: 0.5 };
    this.script = { active: false, events: null, index: 0, start: 0, instant: false, width: 0, height: 0, nibScale: 1 };
    this.wash = { active: false, start: 0, then: null };
    this.washFrame = { dt: 0, clock: 0, flood: WASH_TOP, drain: WASH_TOP, flow: 0, bleed: 0, dissolve: 0, fade: 0, level: WASH_LEVEL, lip: WASH_LIP };
    this.loop = { mode: "waiting", index: -1, pending: false, restMs: REST_MS, dryCap: LOOP_DRY_CAP_MS, dryingSince: 0 };
    this.cue = { fn: null, timer: 0, deadline: 0, remaining: 0 };
    this.nibScale = 1;
    this.userNibScale = 1;
    this.inkLength = 0;
    this.instantDry = 0;
    this.wetUntil = 0;
    this.stampGeneration = 0;
    this.water = { wet: false, deadline: 0, frames: 0, generation: -1, level: Infinity };
    this.visible = !document.hidden;
    this.onscreen = true;
    this.pausedAt = 0;
    this.lost = false;
    this.destroyed = false;
    this.painted = false;
    this.governor = { scale: 1, ema: 16, frames: 0 };
    this.inkTarget = hexToLinear(INK_HEX);
    this.renderSettings = { ink: new Float32Array(this.inkTarget), paper: hexToLinear(PAPER_HEX), granulation: BRUSH.sim.granulation, sheen: this.reducedMotion ? 0 : 1 };
    this.stepSettings = { absorb: BRUSH.absorb, dry: BRUSH.dry, ...BRUSH.sim };
    this.stampSettings = { concentration: BRUSH.sim.concentration, poolConcentration: BRUSH.sim.poolConcentration, smear: BRUSH.nib.smear, ink: this.inkTarget };
    this.nibSettings = { ...BRUSH.nib };
    this.dry = BRUSH.dry;
    this.frame = this.frame.bind(this);
    this.handlers = {
      down: (e) => this.onPointerDown(e),
      move: (e) => this.onPointerMove(e),
      up: (e) => this.onPointerUp(e),
      enter: (e) => this.onPointerEnter(e),
      leave: (e) => this.onPointerLeave(e),
      scroll: () => {
        this.rect = null;
      },
      visibility: () => this.setVisible(!document.hidden),
      lost: (e) => {
        e.preventDefault();
        this.lost = true;
        this.cancelCue();
        if (this.script.active) this.endScript(true);
        this.stop();
      },
      restored: () => this.restore(),
    };
  }

  start() {
    this.createSim();
    if (!this.sim) return;
    this.callbacks.onEngine?.(this.sim.kind);
    const surface = this.surface;
    surface.addEventListener("pointerdown", this.handlers.down);
    surface.addEventListener("pointermove", this.handlers.move);
    surface.addEventListener("pointerup", this.handlers.up);
    surface.addEventListener("pointercancel", this.handlers.up);
    surface.addEventListener("pointerenter", this.handlers.enter);
    surface.addEventListener("pointerleave", this.handlers.leave);
    window.addEventListener("scroll", this.handlers.scroll, { passive: true, capture: true });
    document.addEventListener("visibilitychange", this.handlers.visibility);
    this.canvas.addEventListener("webglcontextlost", this.handlers.lost);
    this.canvas.addEventListener("webglcontextrestored", this.handlers.restored);
    this.resizeObserver = new ResizeObserver(() => this.measure());
    this.resizeObserver.observe(surface);
    this.intersection = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      this.setOnscreen(entry.isIntersecting);
    });
    this.intersection.observe(surface);
    this.measure();
    this.setMode("waiting");
    this.cueLater(this.reducedMotion ? 0 : FIRST_PIECE_DELAY_MS, () => this.playPiece(0));
  }

  freshCanvas() {
    this.canvas?.remove();
    this.canvas = document.createElement("canvas");
    this.canvas.className = "wi-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.host.appendChild(this.canvas);
  }

  createSim() {
    this.freshCanvas();
    this.sim = InkSim.create(this.canvas);
    if (this.sim) return;
    this.freshCanvas();
    this.sim = FlatInk.create(this.canvas);
  }

  setMode(mode) {
    if (this.loop.mode === mode && this.surface.hasAttribute("data-mode")) return;
    this.loop.mode = mode;
    this.surface.setAttribute("data-mode", mode);
  }

  active() {
    return this.visible && this.onscreen && !this.destroyed;
  }

  cueLater(ms, fn) {
    this.cancelCue();
    this.cue.fn = fn;
    this.cue.remaining = ms;
    if (this.active()) this.armCue();
  }

  armCue() {
    const cue = this.cue;
    cue.deadline = performance.now() + cue.remaining;
    cue.timer = window.setTimeout(
      () => {
        cue.timer = 0;
        const fn = cue.fn;
        cue.fn = null;
        fn?.();
      },
      Math.max(0, cue.remaining),
    );
  }

  pauseCue() {
    const cue = this.cue;
    if (!cue.timer) return;
    window.clearTimeout(cue.timer);
    cue.timer = 0;
    cue.remaining = Math.max(0, cue.deadline - performance.now());
  }

  cancelCue() {
    window.clearTimeout(this.cue.timer);
    this.cue.timer = 0;
    this.cue.fn = null;
  }

  measure() {
    if (!this.sim) return;
    const width = this.surface.clientWidth;
    const height = this.surface.clientHeight;
    if (!width || !height) return;
    const narrow = width < 600;
    const maxWidth = narrow ? 480 : 800;
    const maxHeight = narrow ? 480 : 560;
    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    const simWidth = Math.max(8, Math.round(width * scale));
    const simHeight = Math.max(8, Math.round(height * scale));
    const current = this.sim.simWidth;
    const drift = current > 0 ? Math.abs(simWidth - current) / current : 1;
    if (drift > 0.06 || Math.abs(simHeight - this.sim.simHeight) / Math.max(1, this.sim.simHeight) > 0.06) this.sim.resize(simWidth, simHeight);
    this.simScale = this.sim.simWidth / width;
    this.userNibScale = Math.min(USER_NIB_MAX, Math.max(USER_NIB_MIN, width / USER_NIB_REFERENCE));
    const previousWidth = this.cssWidth;
    const previousHeight = this.cssHeight;
    this.cssWidth = width;
    this.cssHeight = height;
    this.rect = null;
    this.applyDisplaySize();
    if (previousWidth > 0 && previousHeight > 0 && this.pen.down) {
      this.pen.x *= width / previousWidth;
      this.pen.y *= height / previousHeight;
    }
    if (this.script.active && this.script.width > 0) {
      this.nibScale = this.script.nibScale * Math.min(width / this.script.width, height / this.script.height);
    }
    const jump = previousWidth > 0 ? width / previousWidth : 1;
    if ((jump > 1.5 || jump < 0.67) && this.loop.mode !== "yours" && this.inkLength > 0) {
      this.clearNow();
      this.playPiece(this.loop.index);
    } else if (this.loop.pending) {
      this.playPiece(this.loop.index);
    }
    this.paint();
  }

  applyDisplaySize() {
    const cap = this.cssWidth < 600 ? 1.5 : 1.75;
    const ratio = Math.min(window.devicePixelRatio || 1, cap) * this.governor.scale;
    this.sim.setDisplaySize(Math.max(1, Math.round(this.cssWidth * ratio)), Math.max(1, Math.round(this.cssHeight * ratio)));
  }

  paint() {
    if (!this.sim || this.lost) return;
    this.sim.render(this.renderSettings);
    if (!this.painted) {
      this.painted = true;
      this.callbacks.onPainted?.();
    }
  }

  local(e) {
    if (!this.rect) this.rect = this.surface.getBoundingClientRect();
    return { x: e.clientX - this.rect.left, y: e.clientY - this.rect.top };
  }

  place(element, point) {
    if (!element) return;
    element.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
  }

  onPointerEnter(e) {
    this.rect = null;
    if (e.pointerType === "touch" || !this.finePointer) return;
    this.place(this.nib, this.local(e));
    this.nib?.setAttribute("data-visible", "true");
  }

  onPointerLeave(e) {
    if (e.pointerType === "touch") return;
    this.nib?.setAttribute("data-visible", "false");
  }

  onPointerDown(e) {
    if (this.lost || !this.sim || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (this.script.active) this.endScript(true);
    if (this.pen.down) return;
    e.preventDefault();
    this.cancelCue();
    if (this.wash.active) this.haltWash();
    this.rect = null;
    this.surface.setPointerCapture(e.pointerId);
    const point = this.local(e);
    if (e.pointerType !== "touch" && this.finePointer) {
      this.place(this.nib, point);
      this.nib?.setAttribute("data-visible", "true");
      this.nib?.setAttribute("data-down", "true");
    }
    this.pen.id = e.pointerId;
    this.nibScale = this.visitorNibScale();
    this.setMode("yours");
    this.penDown(point.x, point.y, e.timeStamp, e.pointerType === "pen", e.pressure);
  }

  onPointerMove(e) {
    const point = this.local(e);
    if (e.pointerType !== "touch") this.place(this.nib, point);
    if (!this.pen.down || e.pointerId !== this.pen.id) return;
    const isPen = e.pointerType === "pen";
    const samples = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : null;
    if (samples && samples.length) {
      for (const sample of samples) {
        this.penMove(sample.clientX - this.rect.left, sample.clientY - this.rect.top, sample.timeStamp, isPen, sample.pressure);
      }
    } else {
      this.penMove(point.x, point.y, e.timeStamp, isPen, e.pressure);
    }
  }

  onPointerUp(e) {
    if (!this.pen.down || e.pointerId !== this.pen.id || this.script.active) return;
    if (this.surface.hasPointerCapture?.(e.pointerId)) this.surface.releasePointerCapture(e.pointerId);
    this.nib?.setAttribute("data-down", "false");
    this.penUp(e.timeStamp);
    this.cueLater(VISITOR_IDLE_MS, () => this.awaitDry(REST_AFTER_VISITOR_MS, VISITOR_DRY_CAP_MS));
  }

  visitorNibScale() {
    if (!this.cssWidth || !this.cssHeight) return this.userNibScale;
    const piece = pieceNibScale(Math.max(0, this.loop.index), this.cssWidth, this.cssHeight);
    return Math.max(this.userNibScale, piece * VISITOR_PIECE_SHARE);
  }

  inkTempo() {
    return this.script.active ? LOOP_TEMPO : 1;
  }

  nibRadius(shape) {
    const nib = this.nibSettings;
    return (nib.min + (nib.max - nib.min) * Math.min(1.3, Math.max(0, shape))) * this.nibScale;
  }

  penDown(x, y, t, isPen, pressure) {
    const pen = this.pen;
    pen.down = true;
    pen.x = x;
    pen.y = y;
    pen.t = t;
    pen.speed = 0;
    pen.isPen = isPen;
    pen.pressure = isPen ? pressure : RESTING_PRESSURE;
    pen.shape = 0.55;
    pen.still = 0;
    pen.r = this.nibRadius(pen.shape * this.pressureShape(pen.pressure));
    pen.lastMoveAt = performance.now();
    this.enqueue(x, y, x, y, pen.r, pen.r, this.poolVolume() * 0.016);
    this.wake();
  }

  poolVolume() {
    const scale = Math.min(this.nibScale, POOL_SCALE_LIMIT);
    return this.nibSettings.pool * scale * scale;
  }

  beadReach(seconds) {
    return this.nibSettings.bead * this.nibScale * Math.sqrt(Math.min(seconds, BEAD_GROW_S));
  }

  pressureShape(pressure) {
    const weight = this.nibSettings.pressure;
    const p = Math.min(1, Math.max(0, pressure || 0.5));
    if (this.script.active) return 1 - weight + weight * (0.06 + 1.24 * Math.pow(p, 1.35));
    return 1 - 0.6 * weight + 0.95 * weight * p;
  }

  penMove(x, y, t, isPen, pressure) {
    const pen = this.pen;
    const nib = this.nibSettings;
    const dx = x - pen.x;
    const dy = y - pen.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.4 || (pen.still > 0 && dist < 1.5)) return;
    const elapsed = Math.max(0.5, t - pen.t) * this.inkTempo();
    const dwellLimit = pen.still > 0 ? STILL_AFTER_MS : this.script.active && !this.script.instant ? SCRIPTED_DWELL_LIMIT_MS : Infinity;
    const dwellMs = Math.min(elapsed, dwellLimit);
    pen.speed += (dist / elapsed - pen.speed) * 0.35;
    const p = isPen ? pressure : speedPressure(pen.speed);
    const angle = Math.atan2(-dy, dx);
    const across = Math.abs(Math.sin(angle - NIB_ANGLE));
    const nibShape = 1 - nib.contrast + nib.contrast * (0.1 + 0.9 * across * across);
    pen.shape += (nibShape - pen.shape) * 0.5;
    const speedShape = 1 - (1 - nib.thinAtSpeed) * smoothstep(0, 2.4, pen.speed);
    const radius = pen.r + (this.nibRadius(pen.shape * speedShape * this.pressureShape(p)) - pen.r) * 0.45;
    const dwell = (dwellMs / 1000) * Math.min(1, (2 * radius) / dist);
    this.enqueue(pen.x, pen.y, x, y, pen.r, radius, this.poolVolume() * dwell);
    pen.x = x;
    pen.y = y;
    pen.t = t;
    pen.r = radius;
    pen.pressure = p;
    pen.still = 0;
    pen.lastMoveAt = performance.now();
    this.inkLength += dist;
  }

  penStill(dt) {
    const pen = this.pen;
    const inkDt = dt * this.inkTempo();
    pen.speed *= Math.exp(-inkDt * 8);
    if (!pen.isPen) pen.pressure = speedPressure(pen.speed);
    const target = this.nibRadius(pen.shape * this.pressureShape(pen.pressure));
    pen.r += (target - pen.r) * (1 - Math.exp(-inkDt * 6));
    pen.still += inkDt;
    const bead = pen.r + this.beadReach(pen.still);
    this.enqueue(pen.x, pen.y, pen.x, pen.y, bead, bead, this.poolVolume() * inkDt * Math.exp(-pen.still));
    this.inkLength += inkDt * 40;
  }

  penUp(t) {
    const pen = this.pen;
    if (this.script.instant) {
      const held = (Math.max(0, t - pen.t) / 1000) * this.inkTempo();
      const bead = pen.r + this.beadReach(held);
      if (held > 0.03) this.enqueue(pen.x, pen.y, pen.x, pen.y, bead, bead, this.poolVolume() * (1 - Math.exp(-held)));
      this.inkLength += held * 40;
    }
    pen.down = false;
    pen.id = -1;
  }

  markWet() {
    const now = performance.now();
    const water = this.water;
    this.stampGeneration += 1;
    this.wetUntil = now + WET_MIN_MS;
    water.wet = true;
    water.level = Infinity;
    water.deadline = now + DRY_SAFETY_MS;
  }

  probeWater() {
    const sim = this.sim;
    const water = this.water;
    if (!sim.probesWater) {
      water.wet = false;
      return;
    }
    const reading = sim.readWaterProbe();
    if (reading >= 0 && water.generation === this.stampGeneration) {
      water.level = reading;
      if (reading < DRY_READING) water.wet = false;
    }
    if (!water.wet) return;
    water.frames += 1;
    if (water.frames < PROBE_EVERY) return;
    if (sim.requestWaterProbe()) {
      water.frames = 0;
      water.generation = this.stampGeneration;
    }
  }

  enqueue(ax, ay, bx, by, ra, rb, water) {
    if (this.queueCount >= QUEUE_LIMIT) this.flush();
    const scale = this.simScale;
    const i = this.queueCount * 4;
    this.queueSegments[i] = ax * scale;
    this.queueSegments[i + 1] = ay * scale;
    this.queueSegments[i + 2] = bx * scale;
    this.queueSegments[i + 3] = by * scale;
    this.queueNibs[i] = ra * scale;
    this.queueNibs[i + 1] = rb * scale;
    this.queueNibs[i + 2] = water;
    this.queueNibs[i + 3] = this.nibSettings.base;
    this.queueCount += 1;
    this.markWet();
  }

  flush() {
    if (!this.queueCount || !this.sim) return;
    this.sim.stamp(this.queueSegments, this.queueNibs, this.queueCount, this.stampSettings);
    this.queueCount = 0;
  }

  playPiece(index) {
    this.cancelCue();
    if (!this.sim || this.destroyed || this.lost) return;
    const loop = this.loop;
    loop.index = ((index % PIECE_COUNT) + PIECE_COUNT) % PIECE_COUNT;
    if (!this.cssWidth || this.cssWidth < 120) {
      loop.pending = true;
      return;
    }
    loop.pending = false;
    if (this.script.active) this.endScript(true);
    const { events, nibScale } = buildPiece(loop.index, this.cssWidth, this.cssHeight);
    const script = this.script;
    script.events = events;
    script.index = 0;
    script.active = true;
    script.instant = this.reducedMotion;
    script.start = this.pausedAt || performance.now();
    script.width = this.cssWidth;
    script.height = this.cssHeight;
    script.nibScale = nibScale;
    this.nibScale = nibScale;
    this.setMode("drawing");
    if (script.instant) {
      this.feedScript(Infinity);
      this.flush();
      this.instantDry = INSTANT_DRY_STEPS;
    }
    this.wake();
  }

  feedScript(now) {
    const script = this.script;
    const events = script.events;
    const elapsed = now - script.start;
    const sx = script.width > 0 ? this.cssWidth / script.width : 1;
    const sy = script.height > 0 ? this.cssHeight / script.height : 1;
    while (script.index < events.length && events[script.index].t <= elapsed) {
      const event = events[script.index];
      script.index += 1;
      const stamp = script.start + event.t;
      const x = event.x * sx;
      const y = event.y * sy;
      if (event.kind === "down") this.penDown(x, y, stamp, true, event.p);
      else if (event.kind === "move") this.penMove(x, y, stamp, true, event.p);
      else this.penUp(stamp);
    }
    if (script.index >= events.length) this.endScript(false);
  }

  endScript(interrupted) {
    const script = this.script;
    if (!script.active) return;
    script.active = false;
    script.instant = false;
    script.events = null;
    if (this.pen.down) this.penUp(performance.now());
    if (!interrupted) this.awaitDry(this.reducedMotion ? REDUCED_REST_MS : REST_MS, LOOP_DRY_CAP_MS);
  }

  awaitDry(restMs, dryCap) {
    this.loop.restMs = restMs;
    this.loop.dryCap = dryCap;
    this.loop.dryingSince = this.pausedAt || performance.now();
    this.setMode("drying");
    this.wake();
  }

  settle() {
    this.setMode("resting");
    this.cueLater(this.loop.restMs, () => this.washToNext());
  }

  advance() {
    this.cueLater(GAP_MS, () => this.playPiece(this.loop.index + 1));
  }

  washToNext() {
    this.setMode("clearing");
    this.clear(() => this.advance());
  }

  next() {
    if (!this.sim || this.lost) return;
    if (this.pen.down && !this.script.active) return;
    this.cancelCue();
    if (this.script.active) this.endScript(true);
    if (this.wash.active) {
      this.wash.then = () => this.advance();
      return;
    }
    if (this.inkLength > 0) {
      this.washToNext();
      return;
    }
    this.playPiece(this.loop.index + 1);
  }

  wipe() {
    if (!this.sim || this.lost) return;
    if (this.pen.down && !this.script.active) return;
    this.cancelCue();
    if (this.script.active) this.endScript(true);
    const handBack = () => {
      this.setMode("yours");
      this.cueLater(VISITOR_IDLE_MS, () => this.playPiece(this.loop.index + 1));
    };
    this.setMode("clearing");
    if (this.wash.active) {
      this.wash.then = handBack;
      return;
    }
    this.clear(handBack);
  }

  clearNow() {
    if (this.script.active) this.endScript(true);
    this.pen.down = false;
    this.queueCount = 0;
    this.inkLength = 0;
    this.instantDry = 0;
    this.wash.active = false;
    this.wash.then = null;
    this.sim.lift(4, 0.01, CLEARED);
    this.sim.clearTint();
  }

  clear(then) {
    if (!this.sim) return;
    if (this.script.active) this.endScript(true);
    this.pen.down = false;
    this.queueCount = 0;
    this.instantDry = 0;
    if (this.reducedMotion) {
      this.clearNow();
      this.paint();
      then?.();
      return;
    }
    this.wash.active = true;
    this.wash.start = this.pausedAt || performance.now();
    this.wash.then = then ?? null;
    this.wake();
  }

  haltWash() {
    this.wash.active = false;
    this.wash.then = null;
  }

  setVisible(visible) {
    this.visible = visible;
    this.updateRunning();
  }

  setOnscreen(onscreen) {
    this.onscreen = onscreen;
    this.updateRunning();
  }

  updateRunning() {
    if (!this.active()) {
      if (!this.pausedAt) this.pausedAt = performance.now();
      this.pauseCue();
      this.stop();
      return;
    }
    if (this.pausedAt) {
      const shift = performance.now() - this.pausedAt;
      this.pausedAt = 0;
      this.wetUntil += shift;
      this.water.deadline += shift;
      this.script.start += shift;
      this.wash.start += shift;
      this.loop.dryingSince += shift;
      this.pen.t += shift;
      this.pen.lastMoveAt += shift;
    }
    if (this.cue.fn && !this.cue.timer) this.armCue();
    this.wake();
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  wake() {
    if (this.raf || this.destroyed || this.lost || !this.sim || !this.visible || !this.onscreen) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  restore() {
    this.sim = InkSim.create(this.canvas);
    if (!this.sim) return;
    this.lost = false;
    this.haltWash();
    this.inkLength = 0;
    this.instantDry = 0;
    this.water.wet = false;
    this.cssWidth = 0;
    this.measure();
    if (this.loop.mode !== "yours") this.advance();
    this.wake();
  }

  washSettings(elapsed, dt) {
    const t = Math.min(1, elapsed / WASH_MS);
    const flood = easeInOutSine(Math.min(1, t / WASH_FLOOD_SHARE));
    const drain = easeInOutCubic(Math.max(0, (t - WASH_DRAIN_FROM) / (1 - WASH_DRAIN_FROM)));
    const settings = this.washFrame;
    settings.dt = dt;
    settings.clock = elapsed / 1000;
    settings.flood = WASH_TOP + (WASH_FLOOD_BOTTOM - WASH_TOP) * flood;
    settings.drain = WASH_TOP + (WASH_DRAIN_BOTTOM - WASH_TOP) * drain;
    settings.flow = WASH_FLOW * smoothstep(0.04, 0.4, t);
    settings.bleed = WASH_BLEED * smoothstep(0, 0.2, t);
    settings.dissolve = WASH_DISSOLVE * smoothstep(0, 0.24, t);
    settings.fade = WASH_FADE * smoothstep(0.26, 0.7, t);
    return settings;
  }

  runWash(now, dt) {
    const wash = this.wash;
    const elapsed = Math.max(0, now - wash.start);
    this.sim.wash(this.washSettings(elapsed, dt));
    if (elapsed < WASH_MS) return;
    this.sim.lift(4, 0.01, CLEARED);
    this.sim.clearTint();
    this.inkLength = 0;
    wash.active = false;
    const then = wash.then;
    wash.then = null;
    then?.();
  }

  instantDryBatch() {
    const area = Math.max(1, this.sim.simWidth * this.sim.simHeight);
    return Math.min(INSTANT_DRY_PER_FRAME, Math.max(INSTANT_DRY_MIN_PER_FRAME, Math.round((INSTANT_DRY_PER_FRAME * INSTANT_DRY_REFERENCE_AREA) / area)));
  }

  sampleGovernor(dt) {
    const governor = this.governor;
    if (dt > 0.12 || dt <= 0 || this.instantDry > 0) return;
    governor.ema = governor.ema * 0.92 + dt * 1000 * 0.08;
    governor.frames += 1;
    if (governor.frames > 40 && governor.ema > 22 && governor.scale > 0.6) {
      governor.scale = Math.max(0.6, governor.scale * 0.85);
      governor.frames = 0;
      this.applyDisplaySize();
    } else if (governor.frames > 300 && governor.ema < 13 && governor.scale < 1) {
      governor.scale = Math.min(1, governor.scale / 0.85);
      governor.frames = 0;
      this.applyDisplaySize();
    }
  }

  frame(now) {
    this.raf = 0;
    if (!this.sim || this.lost) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.script.active && !this.script.instant) this.feedScript(now);
    if (this.pen.down && now - this.pen.lastMoveAt > STILL_AFTER_MS) this.penStill(dt);
    this.flush();
    if (this.wash.active) this.runWash(now, dt);
    this.stepSettings.dry = this.dry;
    if (this.instantDry > 0) {
      const batch = Math.min(this.instantDryBatch(), this.instantDry);
      for (let i = 0; i < batch; i += 1) this.sim.step(SUBSTEP, this.stepSettings);
      this.instantDry -= batch;
      if (!this.instantDry) this.wetUntil = 0;
    }
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= SUBSTEP && steps < MAX_SUBSTEPS) {
      this.sim.step(SUBSTEP, this.stepSettings);
      this.accumulator -= SUBSTEP;
      steps += 1;
    }
    if (steps === MAX_SUBSTEPS) this.accumulator = Math.min(this.accumulator, SUBSTEP);
    this.sampleGovernor(dt);
    this.paint();
    this.probeWater();
    const wet = (this.water.wet && now < this.water.deadline) || now < this.wetUntil;
    const dryEnough = now >= this.wetUntil && (!wet || this.water.level < DRY_ENOUGH);
    if (this.loop.mode === "drying" && !this.pen.down && this.instantDry === 0 && (dryEnough || now - this.loop.dryingSince > this.loop.dryCap)) this.settle();
    const busy = this.pen.down || this.script.active || this.wash.active || this.instantDry > 0 || wet || this.loop.mode === "drying";
    if (busy && !this.raf && this.active()) this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.destroyed = true;
    this.stop();
    this.cancelCue();
    const surface = this.surface;
    surface.removeEventListener("pointerdown", this.handlers.down);
    surface.removeEventListener("pointermove", this.handlers.move);
    surface.removeEventListener("pointerup", this.handlers.up);
    surface.removeEventListener("pointercancel", this.handlers.up);
    surface.removeEventListener("pointerenter", this.handlers.enter);
    surface.removeEventListener("pointerleave", this.handlers.leave);
    window.removeEventListener("scroll", this.handlers.scroll, { capture: true });
    document.removeEventListener("visibilitychange", this.handlers.visibility);
    this.canvas?.removeEventListener("webglcontextlost", this.handlers.lost);
    this.canvas?.removeEventListener("webglcontextrestored", this.handlers.restored);
    this.resizeObserver?.disconnect();
    this.intersection?.disconnect();
    this.sim?.destroy();
    this.sim = null;
    this.canvas?.remove();
    this.canvas = null;
  }
}
