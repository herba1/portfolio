import FlatInk from "./flatInk";
import InkSim from "./InkSim";
import { buildSignature } from "./signaturePath";
import { BLOTTER_HEX, PAPER_HEX, hexToLinear } from "./wetInkParams";

const SUBSTEP = 1 / 180;
const MAX_SUBSTEPS = 9;
const NIB_ANGLE = (40 * Math.PI) / 180;
const SIGNED_LENGTH = 140;
const SWEEP_MS = 520;
const SWEEP_FEATHER = 0.14;
const QUEUE_LIMIT = 2048;
const STILL_AFTER_MS = 30;
const WET_MIN_MS = 600;
const DRY_SAFETY_MS = 30000;
const DRY_READING = 0.002;
const PROBE_EVERY = 20;
const BEAD_GROW_S = 1.2;
const INTRO_DELAY_MS = 920;
const INSTANT_DRY_STEPS = 1600;
const INSTANT_DRY_PER_FRAME = 160;
const DESKTOP_SIGNATURE_SCALE = 0.53;
const NIB_LINGER_MS = 200;
const GHOST_MS = 340;
const CLEARED = [0, 0, 0, 0];
const BLOTTED = [0.1, 0.32, 1, 1];

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function easeInOut(t) {
  return t < 0.5 ? 8 * t * t * t * t : 1 - 8 * Math.pow(1 - t, 4);
}

export default class SignaturePad {
  constructor({ surface, host, nib, callbacks }) {
    this.surface = surface;
    this.host = host;
    this.canvas = null;
    this.nib = nib;
    this.nibPlaced = false;
    this.nibScale = 1;
    this.introNib = false;
    this.nibTimer = 0;
    this.hovering = false;
    this.pointerAt = { x: 0, y: 0 };
    this.ghost = null;
    this.ghostTimer = 0;
    this.instantDry = 0;
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
    this.intro = { active: false, events: null, index: 0, start: 0, instant: false };
    this.sweep = { active: false, start: 0, then: null };
    this.inkLength = 0;
    this.userInk = false;
    this.signed = false;
    this.locked = false;
    this.wetUntil = 0;
    this.stampGeneration = 0;
    this.water = { wet: false, deadline: 0, frames: 0, generation: -1 };
    this.dryBoost = 1;
    this.visible = !document.hidden;
    this.onscreen = true;
    this.pausedAt = 0;
    this.lost = false;
    this.destroyed = false;
    this.painted = false;
    this.governor = { scale: 1, ema: 16, frames: 0 };
    this.inkTarget = hexToLinear("#1d2740");
    this.renderSettings = { ink: new Float32Array(this.inkTarget), paper: hexToLinear(PAPER_HEX), granulation: 0.5, sheen: this.reducedMotion ? 0 : 1 };
    this.stepSettings = { absorb: 1, dry: 1, pin: 0.12, mobility: 0.9, granulation: 0.55 };
    this.stampSettings = { concentration: 3.2, poolConcentration: 0.118, smear: 0.55, ink: this.inkTarget };
    this.nibSettings = { min: 0.4, max: 3, contrast: 1, thinAtSpeed: 0.42, base: 0.16, pool: 4, bead: 9, smear: 0.55, pressure: 0.6 };
    this.dry = 1;
    this.introTimer = 0;
    this.introPending = false;
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
    this.introTimer = window.setTimeout(() => {
      this.introTimer = 0;
      this.playIntro();
    }, this.reducedMotion ? 0 : INTRO_DELAY_MS);
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

  setParams({ pen, ink, absorb, dry }) {
    this.flush();
    Object.assign(this.nibSettings, pen.nib);
    this.stampSettings.concentration = pen.sim.concentration;
    this.stampSettings.poolConcentration = pen.sim.poolConcentration;
    this.stampSettings.smear = pen.nib.smear;
    this.stepSettings.pin = pen.sim.pin;
    this.stepSettings.mobility = pen.sim.mobility;
    this.stepSettings.granulation = pen.sim.granulation;
    this.stepSettings.absorb = absorb;
    this.dry = dry;
    this.stepSettings.dry = dry * this.dryBoost;
    this.renderSettings.granulation = pen.sim.granulation;
    this.inkTarget = hexToLinear(ink);
    this.renderSettings.ink.set(this.inkTarget);
    this.stampSettings.ink = this.inkTarget;
    this.wake();
  }

  measure() {
    if (!this.sim) return;
    const width = this.surface.clientWidth;
    const height = this.surface.clientHeight;
    if (!width || !height) return;
    const narrow = width < 600;
    const maxWidth = narrow ? 480 : 640;
    const maxHeight = narrow ? 200 : 260;
    const scale = Math.min(1, maxWidth / width, maxHeight / height);
    const simWidth = Math.max(8, Math.round(width * scale));
    const simHeight = Math.max(8, Math.round(height * scale));
    const current = this.sim.simWidth;
    const drift = current > 0 ? Math.abs(simWidth - current) / current : 1;
    if (drift > 0.06 || Math.abs(simHeight - this.sim.simHeight) / Math.max(1, this.sim.simHeight) > 0.06) this.sim.resize(simWidth, simHeight);
    this.simScale = this.sim.simWidth / width;
    const previousWidth = this.cssWidth;
    this.cssWidth = width;
    this.cssHeight = height;
    this.rect = null;
    this.applyDisplaySize();
    const jump = previousWidth > 0 ? width / previousWidth : 1;
    if ((jump > 1.5 || jump < 0.67) && !this.userInk && !this.locked && this.inkLength > 0) {
      this.clearNow();
      this.playIntro();
    } else if (this.introPending) {
      this.playIntro();
    }
    this.paint();
  }

  applyDisplaySize() {
    const cap = this.cssWidth < 600 ? 1.5 : 2;
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

  moveNib(point) {
    if (!this.nib) return;
    this.nibPlaced = true;
    this.nib.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
  }

  rememberPointer(point) {
    this.pointerAt.x = point.x;
    this.pointerAt.y = point.y;
  }

  onPointerEnter(e) {
    this.rect = null;
    if (e.pointerType === "touch" || !this.finePointer) return;
    this.hovering = true;
    const point = this.local(e);
    this.rememberPointer(point);
    if (this.introNib) return;
    this.moveNib(point);
    this.nib?.setAttribute("data-visible", this.locked ? "false" : "true");
  }

  onPointerLeave(e) {
    if (e.pointerType !== "touch") this.hovering = false;
    if (this.introNib) return;
    this.nib?.setAttribute("data-visible", "false");
  }

  showIntroNib() {
    window.clearTimeout(this.nibTimer);
    this.nibTimer = 0;
    this.introNib = true;
  }

  lingerIntroNib() {
    if (!this.introNib) return;
    this.nib?.setAttribute("data-down", "false");
    window.clearTimeout(this.nibTimer);
    this.nibTimer = window.setTimeout(() => {
      this.nibTimer = 0;
      this.introNib = false;
      const keep = this.hovering && !this.locked;
      if (keep) this.moveNib(this.pointerAt);
      this.nib?.setAttribute("data-visible", keep ? "true" : "false");
    }, NIB_LINGER_MS);
  }

  takeNib(isFine) {
    window.clearTimeout(this.nibTimer);
    this.nibTimer = 0;
    this.introNib = false;
    this.nib?.setAttribute("data-visible", isFine ? "true" : "false");
  }

  snapshotGhost() {
    if (!this.canvas || this.lost || !this.host) return;
    if (!this.ghost) {
      this.ghost = document.createElement("canvas");
      this.ghost.className = "wi-ghost";
      this.ghost.setAttribute("aria-hidden", "true");
      this.ghost.setAttribute("data-state", "off");
      this.host.appendChild(this.ghost);
    }
    const ghost = this.ghost;
    const context = ghost.getContext("2d");
    if (!context) return;
    this.paint();
    ghost.width = this.canvas.width;
    ghost.height = this.canvas.height;
    context.drawImage(this.canvas, 0, 0);
    ghost.setAttribute("data-state", "shown");
    ghost.getBoundingClientRect();
    ghost.setAttribute("data-state", "lifting");
    window.clearTimeout(this.ghostTimer);
    this.ghostTimer = window.setTimeout(() => {
      this.ghostTimer = 0;
      ghost.setAttribute("data-state", "off");
      ghost.width = 1;
      ghost.height = 1;
    }, GHOST_MS);
  }

  liftIntroInk() {
    this.queueCount = 0;
    this.snapshotGhost();
    this.clearNow();
    if (this.signed) {
      this.signed = false;
      this.callbacks.onSigned?.(false);
    }
  }

  onPointerDown(e) {
    if (this.locked || this.sweep.active || this.lost || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (this.intro.active) this.endIntro();
    if (this.pen.down) return;
    e.preventDefault();
    this.takeNib(e.pointerType !== "touch" && this.finePointer);
    this.skipIntroDelay();
    if (!this.userInk && this.inkLength > 0) this.liftIntroInk();
    this.rect = null;
    this.surface.setPointerCapture(e.pointerId);
    const point = this.local(e);
    this.moveNib(point);
    this.nib?.setAttribute("data-down", "true");
    this.pen.id = e.pointerId;
    this.userInk = true;
    this.penDown(point.x, point.y, e.timeStamp, e.pointerType === "pen", e.pressure);
  }

  onPointerMove(e) {
    const point = this.local(e);
    if (e.pointerType !== "touch") {
      this.rememberPointer(point);
      if (!this.introNib) this.moveNib(point);
    }
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
    if (!this.pen.down || e.pointerId !== this.pen.id) return;
    if (this.surface.hasPointerCapture?.(e.pointerId)) this.surface.releasePointerCapture(e.pointerId);
    this.nib?.setAttribute("data-down", "false");
    this.penUp(e.timeStamp);
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
    pen.pressure = isPen ? pressure : 0.5;
    pen.shape = 0.55;
    pen.still = 0;
    pen.r = this.nibRadius(pen.shape * this.pressureShape(isPen, pressure));
    pen.lastMoveAt = performance.now();
    this.enqueue(x, y, x, y, pen.r, pen.r, this.poolVolume() * 0.016);
    this.wake();
  }

  poolVolume() {
    return this.nibSettings.pool * this.nibScale * this.nibScale;
  }

  beadReach(seconds) {
    return this.nibSettings.bead * this.nibScale * Math.sqrt(Math.min(seconds, BEAD_GROW_S));
  }

  pressureShape(isPen, pressure) {
    if (!isPen) return 1;
    const weight = this.nibSettings.pressure;
    const p = Math.min(1, Math.max(0, pressure || 0.5));
    return 1 - 0.6 * weight + 0.95 * weight * p;
  }

  penMove(x, y, t, isPen, pressure) {
    const pen = this.pen;
    const nib = this.nibSettings;
    const dx = x - pen.x;
    const dy = y - pen.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.4 || (pen.still > 0 && dist < 1.5)) return;
    const elapsed = Math.max(0.5, t - pen.t);
    const dwellMs = pen.still > 0 ? Math.min(elapsed, STILL_AFTER_MS) : elapsed;
    pen.speed += (dist / elapsed - pen.speed) * 0.35;
    const angle = Math.atan2(-dy, dx);
    const across = Math.abs(Math.sin(angle - NIB_ANGLE));
    const nibShape = 1 - nib.contrast + nib.contrast * (0.1 + 0.9 * across * across);
    pen.shape += (nibShape - pen.shape) * 0.5;
    const speedShape = 1 - (1 - nib.thinAtSpeed) * smoothstep(0, 2.4, pen.speed);
    const radius = pen.r + (this.nibRadius(pen.shape * speedShape * this.pressureShape(isPen, pressure)) - pen.r) * 0.45;
    const dwell = (dwellMs / 1000) * Math.min(1, (2 * radius) / dist);
    this.enqueue(pen.x, pen.y, x, y, pen.r, radius, this.poolVolume() * dwell);
    pen.x = x;
    pen.y = y;
    pen.t = t;
    pen.r = radius;
    pen.pressure = pressure;
    pen.still = 0;
    pen.lastMoveAt = performance.now();
    this.addInk(dist);
  }

  penStill(dt) {
    const pen = this.pen;
    pen.speed *= Math.exp(-dt * 8);
    const target = this.nibRadius(pen.shape * this.pressureShape(pen.isPen, pen.pressure));
    pen.r += (target - pen.r) * (1 - Math.exp(-dt * 6));
    pen.still += dt;
    const bead = pen.r + this.beadReach(pen.still);
    this.enqueue(pen.x, pen.y, pen.x, pen.y, bead, bead, this.poolVolume() * dt * Math.exp(-pen.still));
    this.addInk(dt * 40);
  }

  penUp(t) {
    const pen = this.pen;
    if (this.intro.instant) {
      const held = Math.max(0, t - pen.t) / 1000;
      const bead = pen.r + this.beadReach(held);
      if (held > 0.03) this.enqueue(pen.x, pen.y, pen.x, pen.y, bead, bead, this.poolVolume() * (1 - Math.exp(-held)));
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
    if (reading >= 0 && water.generation === this.stampGeneration && reading < DRY_READING) water.wet = false;
    if (!water.wet) return;
    water.frames += 1;
    if (water.frames < PROBE_EVERY) return;
    if (sim.requestWaterProbe()) {
      water.frames = 0;
      water.generation = this.stampGeneration;
    }
  }

  addInk(amount) {
    this.inkLength += amount;
    if (!this.signed && this.inkLength > SIGNED_LENGTH) {
      this.signed = true;
      this.callbacks.onSigned?.(true);
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

  skipIntroDelay() {
    if (!this.introTimer && !this.introPending) return;
    window.clearTimeout(this.introTimer);
    this.introTimer = 0;
    this.introPending = false;
    this.callbacks.onIntroDone?.();
  }

  playIntro() {
    window.clearTimeout(this.introTimer);
    this.introTimer = 0;
    if (!this.sim || this.destroyed) return;
    if (!this.cssWidth || this.cssWidth < 120) {
      this.introPending = true;
      return;
    }
    this.introPending = false;
    const { events, scale } = buildSignature(this.cssWidth, this.cssHeight);
    const intro = this.intro;
    intro.events = events;
    intro.index = 0;
    intro.active = true;
    intro.instant = this.reducedMotion;
    intro.start = this.pausedAt || performance.now();
    this.nibScale = Math.min(1, Math.max(0.6, scale / DESKTOP_SIGNATURE_SCALE));
    if (intro.instant) {
      this.feedIntro(Infinity);
      this.flush();
      this.instantDry = INSTANT_DRY_STEPS;
      this.wake();
      return;
    }
    this.showIntroNib();
    this.wake();
  }

  feedIntro(now) {
    const intro = this.intro;
    const elapsed = now - intro.start;
    const events = intro.events;
    const instant = intro.instant;
    let latest = null;
    while (intro.index < events.length && events[intro.index].t <= elapsed) {
      const event = events[intro.index];
      intro.index += 1;
      const stamp = intro.start + event.t;
      if (event.kind === "down") {
        this.penDown(event.x, event.y, stamp, false, 0.5);
        if (!instant) {
          this.moveNib(event);
          this.nib?.setAttribute("data-visible", "true");
          this.nib?.setAttribute("data-down", "true");
        }
      } else if (event.kind === "move") {
        this.penMove(event.x, event.y, stamp, false, 0.5);
      } else {
        this.penUp(stamp);
        if (!instant) this.nib?.setAttribute("data-down", "false");
      }
      latest = event;
    }
    if (latest && !instant) this.moveNib(latest);
    if (intro.index >= events.length) this.endIntro();
  }

  endIntro() {
    const intro = this.intro;
    if (!intro.active) return;
    intro.active = false;
    intro.instant = false;
    intro.events = null;
    if (this.pen.down) this.penUp(performance.now());
    this.nibScale = 1;
    this.lingerIntroNib();
    this.callbacks.onIntroDone?.();
  }

  clearNow() {
    window.clearTimeout(this.introTimer);
    if (this.intro.active) this.endIntro();
    this.pen.down = false;
    this.queueCount = 0;
    this.inkLength = 0;
    this.instantDry = 0;
    this.sweep.active = false;
    this.sweep.then = null;
    this.sim.lift(4, 0.01, CLEARED);
    this.sim.clearTint();
  }

  clear(then) {
    if (!this.sim || this.sweep.active) return;
    this.skipIntroDelay();
    if (this.intro.active) this.endIntro();
    this.pen.down = false;
    this.queueCount = 0;
    this.inkLength = 0;
    this.instantDry = 0;
    this.userInk = false;
    if (this.signed) {
      this.signed = false;
      this.callbacks.onSigned?.(false);
    }
    if (this.reducedMotion) {
      this.sim.lift(4, 0.01, CLEARED);
      this.sim.clearTint();
      this.paint();
      then?.();
      return;
    }
    this.sweep.active = true;
    this.sweep.start = performance.now();
    this.sweep.then = then ?? null;
    this.wake();
  }

  signForMe() {
    if (this.locked || this.sweep.active || this.intro.active || this.pen.down) return;
    if (this.inkLength > 0) this.clear(() => this.playIntro());
    else this.playIntro();
  }

  blot() {
    if (!this.sim) return null;
    this.flush();
    const image = this.sim.offprint({ ink: this.renderSettings.ink, blotter: hexToLinear(BLOTTER_HEX) });
    this.sim.lift(4, 0.01, BLOTTED);
    this.dryBoost = 2.4;
    this.stepSettings.dry = this.dry * this.dryBoost;
    this.markWet();
    this.wake();
    return image;
  }

  lock(locked) {
    this.locked = locked;
    if (locked) {
      if (this.intro.active) this.endIntro();
      if (this.pen.down) this.penUp(performance.now());
      this.nib?.setAttribute("data-visible", "false");
      return;
    }
    if (this.finePointer && this.nibPlaced && this.surface.matches(":hover")) this.nib?.setAttribute("data-visible", "true");
  }

  reset() {
    this.locked = false;
    this.dryBoost = 1;
    this.stepSettings.dry = this.dry;
    this.clear();
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
    const active = this.visible && this.onscreen;
    if (!active) {
      if (!this.pausedAt) this.pausedAt = performance.now();
      this.stop();
      return;
    }
    if (this.pausedAt) {
      const shift = performance.now() - this.pausedAt;
      this.pausedAt = 0;
      this.wetUntil += shift;
      this.water.deadline += shift;
      this.intro.start += shift;
      this.sweep.start += shift;
    }
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
    this.inkLength = 0;
    this.instantDry = 0;
    this.water.wet = false;
    if (this.signed && !this.locked) {
      this.signed = false;
      this.callbacks.onSigned?.(false);
    }
    this.cssWidth = 0;
    this.measure();
    this.wake();
  }

  runSweep(now) {
    const sweep = this.sweep;
    const t = Math.min(1, (now - sweep.start) / SWEEP_MS);
    const front = -SWEEP_FEATHER + easeInOut(t) * (1 + SWEEP_FEATHER * 2);
    this.sim.lift(front, SWEEP_FEATHER, CLEARED);
    if (t < 1) return;
    this.sim.lift(4, 0.01, CLEARED);
    this.sim.clearTint();
    sweep.active = false;
    const then = sweep.then;
    sweep.then = null;
    then?.();
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
    if (this.intro.active && !this.intro.instant) this.feedIntro(now);
    if (this.pen.down && now - this.pen.lastMoveAt > STILL_AFTER_MS) this.penStill(dt);
    this.flush();
    if (this.sweep.active) this.runSweep(now);
    this.stepSettings.dry = this.dry * this.dryBoost;
    if (this.instantDry > 0) {
      const batch = Math.min(INSTANT_DRY_PER_FRAME, this.instantDry);
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
    const drying = this.water.wet && now < this.water.deadline;
    const busy = this.pen.down || this.intro.active || this.sweep.active || this.instantDry > 0 || drying || now < this.wetUntil;
    if (busy && !this.raf && this.visible && this.onscreen && !this.destroyed) this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    this.destroyed = true;
    this.stop();
    window.clearTimeout(this.introTimer);
    window.clearTimeout(this.nibTimer);
    window.clearTimeout(this.ghostTimer);
    const surface = this.surface;
    surface.removeEventListener("pointerdown", this.handlers.down);
    surface.removeEventListener("pointermove", this.handlers.move);
    surface.removeEventListener("pointerup", this.handlers.up);
    surface.removeEventListener("pointercancel", this.handlers.up);
    surface.removeEventListener("pointerenter", this.handlers.enter);
    surface.removeEventListener("pointerleave", this.handlers.leave);
    window.removeEventListener("scroll", this.handlers.scroll, { capture: true });
    document.removeEventListener("visibilitychange", this.handlers.visibility);
    this.canvas.removeEventListener("webglcontextlost", this.handlers.lost);
    this.canvas.removeEventListener("webglcontextrestored", this.handlers.restored);
    this.resizeObserver?.disconnect();
    this.intersection?.disconnect();
    this.sim?.destroy();
    this.sim = null;
    this.canvas?.remove();
    this.canvas = null;
    this.ghost?.remove();
    this.ghost = null;
  }
}
