import { DISPLAY_FROM, MAX_LINES, POP_IN_STAGGER_MS, bandFor, baselineDrop, lawTracking, sizeAt } from "./strumScale";

const HARMONICS = 6;
const SAMPLES = 72;
const MEASURE_SIZE = 100;
const WEIGHT_STOPS = [400, 600, 900];
const WEIGHT_FLOOR = 400;
const WEIGHT_STEP = 20;
const MAX_WEIGHT = 900;
const WEIGHT_LEVELS = (MAX_WEIGHT - WEIGHT_FLOOR) / WEIGHT_STEP + 1;
const SWELL = 260;
const SWELL_REFERENCE_SIZE = 48;
const SWELL_FLOOR = 0.45;
const SWELL_REACH = 0.25;
const DISPLAY_WEIGHT = 600;
const BODY_WEIGHT = 440;
const GAMMA = 1.6;
const ALIAS_HZ = 25;
const ALIAS_DAMPING = 30;
const VISUAL_LOW_HZ = 2;
const VISUAL_HIGH_HZ = 7;
const VISUAL_LOW_PITCH = 65;
const VISUAL_OCTAVES = 5;
const TILT_DEADBAND = 0.01;
const TILT_STEP = 0.0087;
const SPRING_STIFFNESS = 170;
const SPRING_DAMPING = 22;
const SPRING_STEP = 1 / 240;
const LINE_STAGGER_MS = 30;
const POP_IN_MS = 440;
const POP_OUT_MS = 260;
const INTRO_DELAY_MS = 380;
const INTRO_GAP_MS = 70;
const STRUM_GAP_MS = 55;
const SYMPATHY_DELAY_MS = 35;
const SYMPATHY_STRENGTH = 0.18;
const SYMPATHY_LEVEL = 0.1;
const SYMPATHY_MAX_TERM = 8;
const SYMPATHY_MAX_PRODUCT = 12;
const SYMPATHY_CENTS = 12;
const STRUM_STRENGTH = 0.62;
const CHORD_DEBOUNCE_MS = 220;
const CHORD_STRENGTH = 0.45;
const CHORD_GAP_MS = 40;
const CHORD_STALE_MS = 2400;
const LANDED_DISTANCE = 0.5;
const LANDED_SPEED = 6;
const PIN_X = 8;
const TEXT_X = 16;
const PLUCK_SHARE = 0.35;
const BEND_SHARE = 0.6;
const SLIP_FACTOR = 1.6;
const REST_ENERGY = 0.05;
const HOVER_MIN_SPEED = 0.12;
const PLUCK_COOLDOWN_MS = 45;
const TAP_SLOP = 6;
const TAP_MS = 320;
const FLASH_SECONDS = 0.3;
const FLASH_WEIGHT = 200;
const MAX_GLYPHS = 64;
const CACHE_PAD = 8;
const CACHE_ASCENT = 1.2;
const CACHE_DESCENT = 0.45;
const BLUR_STEPS = 32;
const BLUR_FILTERS = Array.from({ length: BLUR_STEPS + 1 }, (_, step) => `blur(${step / 2}px)`);
export const CANVAS_BLEED_TOP = 40;
export const CANVAS_BLEED_BOTTOM = 120;
const WIDE_GUTTER = 124;
const NARROW_GUTTER = 56;
const NARROW_WIDTH = 640;
const READOUT_BASELINE = 13;

const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);
const greatestDivisor = (a, b) => (b === 0 ? a : greatestDivisor(b, a % b));
const SIMPLE_RATIOS = [];
for (let upper = 1; upper <= SYMPATHY_MAX_TERM; upper += 1) {
  for (let lower = 1; lower <= SYMPATHY_MAX_TERM; lower += 1) {
    if (upper * lower > SYMPATHY_MAX_PRODUCT || greatestDivisor(upper, lower) !== 1) continue;
    SIMPLE_RATIOS.push({ upper, lower, cents: 1200 * Math.log2(upper / lower), consonance: 1 / (upper * lower) });
  }
}
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInQuad = (t) => t * t;
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const restWeightFor = (size) => (size < DISPLAY_FROM ? BODY_WEIGHT : DISPLAY_WEIGHT);
const levelFor = (weight) => clamp(Math.round((weight - WEIGHT_FLOOR) / WEIGHT_STEP), 0, WEIGHT_LEVELS - 1);
const weightAt = (level) => WEIGHT_FLOOR + level * WEIGHT_STEP;
const visualHzFor = (frequency) =>
  VISUAL_LOW_HZ + (VISUAL_HIGH_HZ - VISUAL_LOW_HZ) * clamp(Math.log2(frequency / VISUAL_LOW_PITCH) / VISUAL_OCTAVES, 0, 1);

function advanceAt(table, base, weight) {
  if (weight <= WEIGHT_STOPS[1]) {
    const t = (weight - WEIGHT_STOPS[0]) / (WEIGHT_STOPS[1] - WEIGHT_STOPS[0]);
    return table[base] + (table[base + 1] - table[base]) * t;
  }
  const t = (weight - WEIGHT_STOPS[1]) / (WEIGHT_STOPS[2] - WEIGHT_STOPS[1]);
  return table[base + 1] + (table[base + 2] - table[base + 1]) * t;
}

function makeLine(index, text) {
  const glyphs = Array.from(text).slice(0, MAX_GLYPHS - 1);
  return {
    index,
    text,
    glyphs,
    advances: new Float32Array(Math.max(1, glyphs.length) * 3),
    ellipsis: new Float32Array(3),
    visibleCount: 0,
    truncated: false,
    size: 12,
    velocity: 0,
    target: 12,
    delay: 0,
    moving: false,
    mode: "hidden",
    modeAt: 0,
    modeDelay: 0,
    alpha: 0,
    scale: 1,
    blur: 0,
    re: new Float64Array(HARMONICS + 1),
    im: new Float64Array(HARMONICS + 1),
    mag: new Float64Array(HARMONICS + 1),
    energy: 0,
    held: false,
    heldHeight: 0,
    heldAt: 0.5,
    flash: 0,
    weight: BODY_WEIGHT,
    frequency: 440,
    visualHz: 4,
    lastPluck: -1e9,
    top: 0,
    band: bandFor(12),
    baseline: 0,
    rowY: Number.NaN,
    rowShown: false,
    ringing: false,
    fonts: new Array(WEIGHT_LEVELS).fill(null),
    fontSize: -1,
    fontVersion: -1,
    cache: null,
  };
}

export default class StrumHarp {
  constructor({ stage, canvas, rows, titles, ratio, frequencies, reducedMotion, onPluck, onSettle, onRunning }) {
    this.stage = stage;
    this.canvas = canvas;
    this.rows = rows;
    this.context = canvas.getContext("2d");
    this.canFilter = typeof this.context.filter === "string";
    this.ratio = ratio;
    this.reducedMotion = reducedMotion;
    this.onPluck = onPluck;
    this.onSettle = onSettle;
    this.onRunning = onRunning;
    this.lines = Array.from({ length: MAX_LINES }, (_, index) => makeLine(index, titles[index % Math.max(1, titles.length)] ?? ""));
    this.consonance = new Float32Array(MAX_LINES * MAX_LINES);
    this.sympatheticHarmonic = new Uint8Array(MAX_LINES * MAX_LINES);
    this.tune(frequencies);
    this.count = 0;
    this.startY = 0;
    this.startVelocity = 0;
    this.startTarget = 0;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.raf = 0;
    this.last = 0;
    this.inTick = false;
    this.pendingKick = false;
    this.visible = !document.hidden;
    this.onscreen = true;
    this.disposed = false;
    this.live = false;
    this.queue = [];
    this.chordDue = 0;
    this.gestures = new Map();
    this.grabbing = false;
    this.hover = null;
    this.hoverLine = null;
    this.rect = null;
    this.currentFont = null;
    this.cacheVersion = 0;
    this.sampleY = 0;
    this.sampleSlope = 0;
    this.sampleEnvelope = 0;
    this.curve = new Float32Array(SAMPLES + 1);
    this.envelope = new Float32Array(SAMPLES + 1);
    this.glyphX = new Float32Array(MAX_GLYPHS);
    this.glyphY = new Float32Array(MAX_GLYPHS);
    this.glyphAngle = new Float32Array(MAX_GLYPHS);
    this.glyphLevel = new Uint8Array(MAX_GLYPHS);
    this.readColours();
    this.family = getComputedStyle(canvas).fontFamily || "sans-serif";
    this.measure();

    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    this.handleVisibility = this.handleVisibility.bind(this);
    this.markRectDirty = this.markRectDirty.bind(this);
    this.handleResolution = this.handleResolution.bind(this);
    this.tick = this.tick.bind(this);
    this.resolutionQuery = null;
    this.resolutionValue = 0;

    stage.addEventListener("pointerdown", this.handlePointerDown);
    stage.addEventListener("pointermove", this.handlePointerMove);
    stage.addEventListener("pointerup", this.handlePointerUp);
    stage.addEventListener("pointercancel", this.handlePointerUp);
    stage.addEventListener("lostpointercapture", this.handlePointerUp);
    stage.addEventListener("pointerleave", this.handlePointerLeave);
    stage.addEventListener("pointerenter", this.markRectDirty);
    document.addEventListener("visibilitychange", this.handleVisibility);
    window.addEventListener("scroll", this.markRectDirty, { passive: true });

    this.resizeObserver = new ResizeObserver(() => this.resize(false));
    this.resizeObserver.observe(stage);
    this.intersectionObserver = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      this.onscreen = entry.isIntersecting;
      this.updateRunning();
    });
    this.intersectionObserver.observe(stage);

    this.entrance = this.readEntrance();
    this.resize(true);
    this.entrance = null;
    this.intro();

    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (this.disposed) return;
        this.family = getComputedStyle(canvas).fontFamily || this.family;
        this.measure();
        this.retruncate();
        this.draw();
        this.kick();
      });
    }
  }

  tune(frequencies) {
    for (const line of this.lines) {
      line.frequency = frequencies[line.index];
      line.visualHz = visualHzFor(line.frequency);
    }
    for (const source of this.lines) {
      for (const responder of this.lines) {
        const slot = source.index * MAX_LINES + responder.index;
        let best = 0;
        let harmonic = 0;
        if (responder !== source) {
          const cents = 1200 * Math.log2(responder.frequency / source.frequency);
          for (const ratio of SIMPLE_RATIOS) {
            if (Math.abs(cents - ratio.cents) >= SYMPATHY_CENTS || ratio.consonance <= best) continue;
            best = ratio.consonance;
            harmonic = ratio.lower;
          }
        }
        this.consonance[slot] = best;
        this.sympatheticHarmonic[slot] = harmonic;
      }
    }
  }

  readEntrance() {
    const phases = new Float64Array(MAX_LINES).fill(-1);
    const rows = this.stage.querySelectorAll(".strum__ghost-type");
    for (let index = 0; index < Math.min(rows.length, MAX_LINES); index += 1) {
      const animation = rows[index].getAnimations?.()[0];
      if (!animation || animation.playState === "finished") continue;
      const played = Number(animation.currentTime);
      phases[index] = Number.isFinite(played) ? Math.max(0, played) : 0;
    }
    return phases;
  }

  readColours() {
    const style = getComputedStyle(this.stage);
    const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    this.ink = read("--color-ink", "#1a1a1a");
    this.hairline = read("--color-line-strong", "#cbd5e1");
    this.accent = read("--color-accent", "#3b82f6");
    this.cacheVersion += 1;
  }

  measure() {
    const context = this.context;
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    for (let stop = 0; stop < WEIGHT_STOPS.length; stop += 1) {
      context.font = `${WEIGHT_STOPS[stop]} ${MEASURE_SIZE}px ${this.family}`;
      for (const line of this.lines) {
        let previous = 0;
        let prefix = "";
        for (let index = 0; index < line.glyphs.length; index += 1) {
          prefix += line.glyphs[index];
          const width = context.measureText(prefix).width;
          line.advances[index * 3 + stop] = (width - previous) / MEASURE_SIZE;
          previous = width;
        }
        line.ellipsis[stop] = context.measureText("…").width / MEASURE_SIZE;
      }
    }
    context.restore();
    this.currentFont = null;
    this.cacheVersion += 1;
  }

  glyphsThatFit(line, size) {
    const available = this.textRight - TEXT_X;
    const tracking = lawTracking(size);
    const weight = restWeightFor(size);
    const total = line.glyphs.length;
    const ellipsis = advanceAt(line.ellipsis, 0, weight) * size;
    let pen = 0;
    let best = 0;
    for (let index = 0; index < total; index += 1) {
      const advance = advanceAt(line.advances, index * 3, weight) * size;
      if (pen + advance > available) {
        let count = best;
        while (count > 0 && line.glyphs[count - 1] === " ") count -= 1;
        return count;
      }
      pen += advance + tracking;
      if (pen + ellipsis <= available) best = index + 1;
    }
    return total;
  }

  applyTruncation(line) {
    let count = this.glyphsThatFit(line, line.target);
    if (Math.abs(line.size - line.target) > 1e-6) count = Math.min(count, this.glyphsThatFit(line, line.size));
    line.visibleCount = count;
    line.truncated = count < line.glyphs.length;
  }

  retruncate() {
    for (const line of this.lines) this.applyTruncation(line);
  }

  watchResolution() {
    const raw = window.devicePixelRatio || 1;
    if (this.resolutionQuery && this.resolutionValue === raw) return;
    this.resolutionQuery?.removeEventListener("change", this.handleResolution);
    this.resolutionValue = raw;
    this.resolutionQuery = window.matchMedia(`(resolution: ${raw}dppx)`);
    this.resolutionQuery.addEventListener("change", this.handleResolution);
  }

  handleResolution() {
    this.resize(false);
  }

  resize(initial) {
    const width = this.stage.clientWidth;
    const height = this.stage.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.watchResolution();
    if (!initial && width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width * this.dpr));
    this.canvas.height = Math.max(1, Math.round((height + CANVAS_BLEED_TOP + CANVAS_BLEED_BOTTOM) * this.dpr));
    this.currentFont = null;
    this.rect = null;
    this.x0 = PIN_X;
    this.x1 = Math.max(PIN_X + 1, width - PIN_X);
    this.textRight = width - TEXT_X - (width < NARROW_WIDTH ? NARROW_GUTTER : WIDE_GUTTER);
    this.layout(true, initial);
    this.draw();
    this.kick();
  }

  linesThatFit() {
    const available = this.height - 8;
    const maxSize = Math.min(this.width / 3.2, 220);
    let sum = 0;
    let count = 0;
    for (let index = 0; index < MAX_LINES; index += 1) {
      const size = sizeAt(this.ratio, index);
      const band = bandFor(size);
      if (size > maxSize || sum + band > available) break;
      sum += band;
      count += 1;
    }
    return { count: Math.max(1, count), sum };
  }

  layout(instant, intro) {
    const { count, sum } = this.linesThatFit();
    const now = performance.now();
    let appearing = 0;
    for (const line of this.lines) {
      const target = sizeAt(this.ratio, line.index);
      const present = line.mode === "in" || line.mode === "shown";
      if (line.index < count) {
        if (!present) {
          line.size = target;
          line.target = target;
          line.velocity = 0;
          line.moving = false;
          line.delay = 0;
          line.weight = restWeightFor(target);
          const played = intro && this.entrance ? this.entrance[line.index] : 0;
          if (played < 0 || (intro && this.reducedMotion)) {
            line.mode = "shown";
            line.alpha = 1;
            line.scale = 1;
            line.blur = 0;
          } else {
            line.mode = "in";
            line.modeAt = now - played;
            line.modeDelay = intro ? line.index * POP_IN_STAGGER_MS : appearing * POP_IN_STAGGER_MS + (instant ? 0 : 120);
            appearing += 1;
            this.entranceAt(line, now);
          }
          this.applyTruncation(line);
          this.onSettle?.(line.index, target);
        } else if (Math.abs(target - line.target) > 1e-6 || instant) {
          line.target = target;
          if (instant || this.reducedMotion) {
            const changed = Math.abs(line.size - target) > 1e-6;
            line.size = target;
            line.velocity = 0;
            line.moving = false;
            if (changed) this.onSettle?.(line.index, target);
          } else {
            line.delay = line.index * LINE_STAGGER_MS;
            line.moving = true;
          }
          this.applyTruncation(line);
        }
      } else {
        if (present) {
          line.mode = "out";
          line.modeAt = now;
          line.modeDelay = 0;
          line.moving = false;
          line.held = false;
          this.dropGesturesOn(line);
        }
        if (line.mode === "hidden") {
          line.target = target;
          line.size = target;
        }
      }
    }
    this.count = count;
    this.startTarget = Math.max(0, (this.height - 8 - sum) / 2);
    if (instant || this.reducedMotion) {
      this.startY = this.startTarget;
      this.startVelocity = 0;
    }
    this.positionLines();
  }

  intro() {
    if (this.reducedMotion) return;
    const now = performance.now();
    for (let index = 0; index < this.count; index += 1) {
      this.queue.push({
        due: now + INTRO_DELAY_MS + index * INTRO_GAP_MS,
        line: this.lines[index],
        position: 0.26 + 0.07 * (index % 3),
        strength: 0.46,
        harmonic: 0,
      });
    }
    this.kick();
  }

  setTuning(ratio, frequencies, chord) {
    this.tune(frequencies);
    if (Math.abs(ratio - this.ratio) < 1e-9) return;
    this.ratio = ratio;
    this.layout(false, false);
    if (chord) this.chordDue = performance.now() + CHORD_DEBOUNCE_MS;
    this.kick();
  }

  setReducedMotion(reduced) {
    this.reducedMotion = reduced;
    if (reduced) {
      for (const line of this.lines) {
        if (line.held) continue;
        line.re.fill(0);
        line.im.fill(0);
        line.energy = 0;
      }
    }
    this.kick();
  }

  markRectDirty() {
    this.rect = null;
  }

  local(event) {
    if (!this.rect) this.rect = this.stage.getBoundingClientRect();
    return { x: event.clientX - this.rect.left, y: event.clientY - this.rect.top, time: event.timeStamp };
  }

  isPresent(line) {
    return line.mode === "shown" || (line.mode === "in" && line.alpha > 0.2);
  }

  lineAt(y) {
    for (const line of this.lines) {
      if (!this.isPresent(line)) continue;
      if (y >= line.top && y < line.top + line.band) return line;
    }
    return null;
  }

  coefficients(line, height, position) {
    const at = clamp(position, 0.04, 0.96);
    const denominator = Math.PI * Math.PI * at * (1 - at);
    for (let harmonic = 1; harmonic <= HARMONICS; harmonic += 1) {
      line.mag[harmonic] = (2 * height * Math.sin(harmonic * Math.PI * at)) / (harmonic * harmonic * denominator);
    }
  }

  hold(line, height, position) {
    line.held = true;
    line.heldHeight = height;
    line.heldAt = clamp(position, 0.04, 0.96);
    this.coefficients(line, height, line.heldAt);
    for (let harmonic = 1; harmonic <= HARMONICS; harmonic += 1) {
      line.re[harmonic] = line.mag[harmonic];
      line.im[harmonic] = 0;
    }
    this.kick();
  }

  emit(line, strength, position, delay) {
    this.onPluck?.({
      index: line.index,
      frequency: line.frequency,
      amplitude: Math.min(1, Math.abs(strength)),
      position,
      pan: (position - 0.5) * 0.7,
      delay,
    });
  }

  limitAmplitude(line) {
    let total = 0;
    for (let harmonic = 1; harmonic <= HARMONICS; harmonic += 1) total += Math.hypot(line.re[harmonic], line.im[harmonic]);
    const limit = BEND_SHARE * line.band;
    if (total <= limit) return;
    const shrink = limit / total;
    for (let harmonic = 1; harmonic <= HARMONICS; harmonic += 1) {
      line.re[harmonic] *= shrink;
      line.im[harmonic] *= shrink;
    }
  }

  strike(line, position, strength, time) {
    line.lastPluck = time;
    if (this.reducedMotion) {
      line.flash = 1;
      this.kick();
      return;
    }
    const height = strength * PLUCK_SHARE * line.band;
    this.coefficients(line, height, position);
    for (let harmonic = 1; harmonic <= HARMONICS; harmonic += 1) line.re[harmonic] += line.mag[harmonic];
    this.limitAmplitude(line);
    this.kick();
  }

  resonate(line, harmonic, strength) {
    if (this.reducedMotion) return;
    line.re[harmonic] += strength * PLUCK_SHARE * line.band;
    this.limitAmplitude(line);
    this.kick();
  }

  sympathize(source, strength, position, time) {
    const force = Math.min(1, Math.abs(strength));
    if (force < 0.05) return;
    const sign = strength < 0 ? -1 : 1;
    const touch = 0.4 + 0.6 * force;
    const row = source.index * MAX_LINES;
    for (const line of this.lines) {
      if (line === source || line.held || !this.isPresent(line)) continue;
      const consonance = this.consonance[row + line.index];
      if (consonance === 0) continue;
      const harmonic = this.sympatheticHarmonic[row + line.index];
      if (harmonic <= HARMONICS) {
        this.queue.push({
          due: time + SYMPATHY_DELAY_MS,
          line,
          position,
          strength: sign * SYMPATHY_STRENGTH * Math.sqrt(consonance) * touch,
          harmonic,
        });
      }
      this.onPluck?.({
        index: line.index,
        frequency: line.frequency * harmonic,
        amplitude: SYMPATHY_LEVEL * Math.sqrt(consonance) * touch,
        position: 0.5,
        pan: (position - 0.5) * 0.7,
        delay: SYMPATHY_DELAY_MS / 1000,
        sympathetic: true,
      });
    }
    this.kick();
  }

  pluck(line, position, strength, time, delay = 0) {
    this.strike(line, position, strength, time);
    this.emit(line, strength, position, delay);
    this.sympathize(line, strength, position, time);
  }

  pluckLine(index) {
    const line = this.lines[index];
    if (!line || !this.isPresent(line) || line.held) return;
    this.pluck(line, 0.5, 0.72, performance.now());
  }

  strum(direction, strength = STRUM_STRENGTH, gap = STRUM_GAP_MS) {
    const present = this.lines.filter((line) => this.isPresent(line) && !line.held);
    if (direction < 0) present.reverse();
    const now = performance.now();
    present.forEach((line, order) => {
      const position = 0.42 + 0.05 * (order % 3);
      const signed = strength * direction;
      this.queue.push({ due: now + order * gap, line, position, strength: signed, harmonic: 0 });
      this.emit(line, signed, position, (order * gap) / 1000);
    });
    this.kick();
  }

  landed() {
    for (const line of this.lines) {
      if (line.mode === "out") return false;
      if (line.mode === "in" && !this.isPresent(line)) return false;
      if (!line.moving) continue;
      if (line.delay > 0) return false;
      if (Math.abs(line.size - line.target) > LANDED_DISTANCE || Math.abs(line.velocity) > LANDED_SPEED) return false;
    }
    return Math.abs(this.startY - this.startTarget) < 2;
  }

  release(line, time) {
    if (!line.held) return;
    line.held = false;
    line.lastPluck = time;
    const height = line.heldHeight;
    const reach = BEND_SHARE * line.band;
    const strength = Math.min(1, Math.abs(height) / reach);
    if (this.reducedMotion) {
      line.re.fill(0);
      line.im.fill(0);
      if (strength > 0.04) line.flash = 1;
    }
    if (strength > 0.04) {
      this.emit(line, strength, line.heldAt, 0);
      this.sympathize(line, height < 0 ? -strength : strength, line.heldAt, time);
    }
    this.kick();
  }

  crossLines(from, to, pressed) {
    const dy = to.y - from.y;
    if (dy === 0) return;
    const elapsed = Math.max(1, to.time - from.time);
    const speed = Math.hypot(to.x - from.x, dy) / elapsed;
    if (!pressed && Math.abs(dy) / elapsed < HOVER_MIN_SPEED) return;
    const strength = clamp(0.12 + 0.42 * Math.log2(1 + speed), pressed ? 0.2 : 0.15, 1) * Math.sign(dy);
    const span = this.x1 - this.x0;
    for (const line of this.lines) {
      if (line.held || !this.isPresent(line)) continue;
      const baseline = line.baseline;
      if ((from.y - baseline) * (to.y - baseline) > 0 || from.y === baseline) continue;
      const t = (baseline - from.y) / dy;
      const x = from.x + t * (to.x - from.x);
      if (x < this.x0 || x > this.x1) continue;
      const time = from.time + t * elapsed;
      if (time - line.lastPluck < PLUCK_COOLDOWN_MS) continue;
      this.pluck(line, (x - this.x0) / span, strength, time);
    }
  }

  updateGrabbing() {
    let grabbing = false;
    for (const gesture of this.gestures.values()) {
      if (gesture.kind === "bend") grabbing = true;
    }
    if (grabbing === this.grabbing) return;
    this.grabbing = grabbing;
    this.stage.dataset.grabbing = grabbing ? "true" : "false";
  }

  dropGesturesOn(line) {
    for (const gesture of this.gestures.values()) {
      if (gesture.line !== line) continue;
      gesture.kind = "strum";
      gesture.line = null;
    }
    this.updateGrabbing();
  }

  finishGesture(gesture, point, completed) {
    if (gesture.kind !== "bend") return;
    const line = gesture.line;
    const tap = completed && gesture.moved < TAP_SLOP && point.time - gesture.start.time < TAP_MS;
    if (tap) {
      line.held = false;
      line.re.fill(0);
      line.im.fill(0);
      this.pluck(line, (point.x - this.x0) / (this.x1 - this.x0), 0.6, point.time);
    } else {
      this.release(line, point.time);
    }
  }

  handlePointerDown(event) {
    if (event.button > 0) return;
    this.rect = null;
    const point = this.local(event);
    const previous = this.gestures.get(event.pointerId);
    if (previous) {
      this.gestures.delete(event.pointerId);
      this.finishGesture(previous, point, false);
    }
    if (event.pointerType !== "touch") {
      this.hover = null;
      this.setHoverLine(null);
    }
    const target = this.lineAt(point.y);
    const line = target && !target.held ? target : null;
    try {
      this.stage.setPointerCapture(event.pointerId);
    } catch {
      this.rect = null;
    }
    this.gestures.set(event.pointerId, { kind: line ? "bend" : "strum", line, start: point, last: point, moved: 0 });
    if (line) this.hold(line, 0, (point.x - this.x0) / (this.x1 - this.x0));
    this.updateGrabbing();
  }

  handlePointerMove(event) {
    const gesture = this.gestures.get(event.pointerId);
    const samples = event.getCoalescedEvents ? event.getCoalescedEvents() : null;
    const list = samples && samples.length ? samples : [event];
    for (const sample of list) {
      const point = this.local(sample);
      if (gesture) {
        gesture.moved = Math.max(gesture.moved, Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y));
        if (gesture.kind === "bend") {
          const line = gesture.line;
          const reach = BEND_SHARE * line.band;
          const pull = point.y - gesture.start.y;
          if (Math.abs(pull) > reach * SLIP_FACTOR) {
            this.release(line, point.time);
            gesture.kind = "strum";
            gesture.line = null;
            this.updateGrabbing();
          } else {
            this.hold(line, reach * Math.tanh(pull / reach), (point.x - this.x0) / (this.x1 - this.x0));
          }
        } else {
          this.crossLines(gesture.last, point, true);
        }
        gesture.last = point;
      } else if (sample.pointerType === "mouse" || sample.pointerType === "pen") {
        if (this.hover) this.crossLines(this.hover, point, false);
        this.hover = point;
        this.setHoverLine(this.lineAt(point.y));
      }
    }
  }

  handlePointerUp(event) {
    const gesture = this.gestures.get(event.pointerId);
    if (!gesture) return;
    this.gestures.delete(event.pointerId);
    const point = this.local(event);
    this.finishGesture(gesture, point, event.type === "pointerup");
    if (event.type !== "lostpointercapture") {
      try {
        this.stage.releasePointerCapture(event.pointerId);
      } catch {
        this.rect = null;
      }
    }
    this.updateGrabbing();
    this.hover = event.pointerType === "mouse" && event.type === "pointerup" ? point : null;
  }

  handlePointerLeave(event) {
    if (event.pointerType === "mouse" && !this.gestures.has(event.pointerId)) {
      this.hover = null;
      this.setHoverLine(null);
    }
  }

  setHoverLine(line) {
    if (line === this.hoverLine) return;
    this.hoverLine = line;
    this.kick();
  }

  handleVisibility() {
    this.visible = !document.hidden;
    this.updateRunning();
  }

  get running() {
    return this.visible && this.onscreen && !this.disposed;
  }

  updateRunning() {
    const running = this.running;
    if (!running && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.onRunning?.(running);
    if (running) this.kick();
  }

  kick() {
    if (this.inTick) {
      this.pendingKick = true;
      return;
    }
    if (this.raf || !this.running) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stepSprings(dt, dtMs) {
    let busy = false;
    let remaining = dt;
    while (remaining > 1e-6) {
      const step = Math.min(SPRING_STEP, remaining);
      remaining -= step;
      const force = -SPRING_STIFFNESS * (this.startY - this.startTarget) - SPRING_DAMPING * this.startVelocity;
      this.startVelocity += force * step;
      this.startY += this.startVelocity * step;
    }
    if (Math.abs(this.startY - this.startTarget) < 0.05 && Math.abs(this.startVelocity) < 0.05) {
      this.startY = this.startTarget;
      this.startVelocity = 0;
    } else {
      busy = true;
    }

    for (const line of this.lines) {
      if (!line.moving) continue;
      busy = true;
      if (line.delay > 0) {
        line.delay -= dtMs;
        if (line.delay > 0) continue;
      }
      let left = dt;
      while (left > 1e-6) {
        const step = Math.min(SPRING_STEP, left);
        left -= step;
        const force = -SPRING_STIFFNESS * (line.size - line.target) - SPRING_DAMPING * line.velocity;
        line.velocity += force * step;
        line.size += line.velocity * step;
      }
      if (Math.abs(line.size - line.target) < 0.02 && Math.abs(line.velocity) < 0.05) {
        line.size = line.target;
        line.velocity = 0;
        line.moving = false;
        this.onSettle?.(line.index, line.target);
      }
      this.applyTruncation(line);
    }
    return busy;
  }

  stepLines(now, dt) {
    let busy = false;
    const blend = 1 - Math.exp(-dt * 12);
    for (const line of this.lines) {
      const restWeight = restWeightFor(line.size);
      if (Math.abs(line.weight - restWeight) > 0.5) {
        line.weight += (restWeight - line.weight) * blend;
        busy = true;
      } else {
        line.weight = restWeight;
      }

      if (line.mode === "in") {
        busy = true;
        this.entranceAt(line, now);
      } else if (line.mode === "out") {
        const t = Math.min(1, (now - line.modeAt) / POP_OUT_MS);
        const eased = easeInQuad(t);
        line.alpha = 1 - eased;
        line.scale = this.reducedMotion ? 1 : 1 - 0.12 * eased;
        line.blur = this.reducedMotion ? 0 : 2 * eased;
        busy = true;
        if (t >= 1) {
          line.mode = "hidden";
          line.alpha = 0;
          line.re.fill(0);
          line.im.fill(0);
          line.energy = 0;
          line.flash = 0;
        }
      } else if (line.mode === "shown") {
        line.alpha = 1;
        line.scale = 1;
        line.blur = 0;
      }

      if (!line.held && line.energy > 0) {
        for (let harmonic = 1; harmonic <= HARMONICS; harmonic += 1) {
          const hz = harmonic * line.visualHz;
          const angle = 2 * Math.PI * hz * dt;
          const damping = harmonic * GAMMA + (hz > ALIAS_HZ ? ALIAS_DAMPING : 0);
          const decay = Math.exp(-damping * dt);
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const re = line.re[harmonic];
          const im = line.im[harmonic];
          line.re[harmonic] = (re * cos - im * sin) * decay;
          line.im[harmonic] = (re * sin + im * cos) * decay;
        }
      }
      let energy = 0;
      for (let harmonic = 1; harmonic <= HARMONICS; harmonic += 1) {
        const magnitude = Math.hypot(line.re[harmonic], line.im[harmonic]);
        line.mag[harmonic] = magnitude;
        energy += magnitude;
      }
      if (!line.held && energy < REST_ENERGY) {
        if (energy > 0) {
          line.re.fill(0);
          line.im.fill(0);
          line.mag.fill(0);
        }
        energy = 0;
      }
      line.energy = energy;
      if (energy > 0 || line.held) busy = true;

      if (line.flash > 0) {
        line.flash = Math.max(0, line.flash - dt / FLASH_SECONDS);
        busy = true;
      }

      const ringing = line.held || energy > 1 || line.flash > 0.15;
      if (ringing !== line.ringing) {
        line.ringing = ringing;
        const row = this.rows[line.index];
        if (row) row.dataset.ringing = ringing ? "true" : "false";
      }
    }
    return busy;
  }

  entranceAt(line, now) {
    const elapsed = now - line.modeAt - line.modeDelay;
    if (elapsed < 0) {
      line.alpha = 0;
      line.scale = this.reducedMotion ? 1 : 0.84;
      line.blur = this.reducedMotion ? 0 : 6;
      return;
    }
    const t = Math.min(1, elapsed / POP_IN_MS);
    if (this.reducedMotion) {
      line.scale = 1;
      line.blur = 0;
    } else {
      line.scale = t < 0.62 ? 0.84 + 0.18 * easeOutCubic(t / 0.62) : 1.02 - 0.02 * easeInOutSine((t - 0.62) / 0.38);
      line.blur = 6 * (1 - easeOutCubic(t));
    }
    line.alpha = easeOutCubic(Math.min(1, t / 0.55));
    if (t >= 1) {
      line.mode = "shown";
      line.scale = 1;
      line.blur = 0;
      line.alpha = 1;
    }
  }

  positionLines() {
    let y = this.startY;
    for (const line of this.lines) {
      if (line.mode === "hidden") continue;
      line.band = bandFor(line.size);
      line.top = y;
      line.baseline = y + baselineDrop(line.size);
      y += line.band;
    }
    for (const line of this.lines) {
      const row = this.rows[line.index];
      if (!row) continue;
      const shown = (line.mode === "in" && line.alpha > 0) || line.mode === "shown";
      if (shown !== line.rowShown) {
        line.rowShown = shown;
        row.dataset.shown = shown ? "true" : "false";
      }
      if (line.mode === "hidden") continue;
      const rowY = Math.round((line.baseline - READOUT_BASELINE) * 2) / 2;
      if (rowY !== line.rowY) {
        line.rowY = rowY;
        row.style.transform = `translate3d(0, ${rowY}px, 0)`;
      }
    }
  }

  displacementAt(line, u) {
    const angle = Math.PI * u;
    const sinOne = Math.sin(angle);
    const cosOne = Math.cos(angle);
    let sinPrevious = 0;
    let sinCurrent = sinOne;
    let cosPrevious = 1;
    let cosCurrent = cosOne;
    let y = 0;
    let slope = 0;
    let envelope = 0;
    for (let harmonic = 1; harmonic <= HARMONICS; harmonic += 1) {
      y += line.re[harmonic] * sinCurrent;
      slope += line.re[harmonic] * harmonic * Math.PI * cosCurrent;
      envelope += line.mag[harmonic] * Math.abs(sinCurrent);
      const sinNext = 2 * cosOne * sinCurrent - sinPrevious;
      const cosNext = 2 * cosOne * cosCurrent - cosPrevious;
      sinPrevious = sinCurrent;
      sinCurrent = sinNext;
      cosPrevious = cosCurrent;
      cosCurrent = cosNext;
    }
    this.sampleY = y;
    this.sampleSlope = slope;
    this.sampleEnvelope = envelope;
  }

  drawString(line) {
    const context = this.context;
    const dpr = this.dpr;
    const baseline = line.baseline;
    const x0 = this.x0;
    const x1 = this.x1;
    const span = x1 - x0;
    context.setTransform(dpr, 0, 0, dpr, 0, CANVAS_BLEED_TOP * dpr);
    context.lineCap = "round";
    context.lineJoin = "round";
    const alpha = line.alpha;
    const pinColour = line.held ? this.accent : this.hairline;

    if (line.energy === 0 && !line.held) {
      context.globalAlpha = alpha;
      context.strokeStyle = this.hairline;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x0, baseline);
      context.lineTo(x1, baseline);
      context.stroke();
      if (line === this.hoverLine) {
        context.globalAlpha = alpha * 0.32;
        context.strokeStyle = this.ink;
        context.stroke();
      }
    } else {
      for (let index = 0; index <= SAMPLES; index += 1) {
        this.displacementAt(line, index / SAMPLES);
        this.curve[index] = this.sampleY;
        this.envelope[index] = this.sampleEnvelope;
      }
      const ring = line.held ? 0 : clamp(line.energy / 5, 0, 1);
      if (ring > 0) {
        context.beginPath();
        context.moveTo(x0, baseline);
        for (let index = 0; index <= SAMPLES; index += 1) context.lineTo(x0 + (index / SAMPLES) * span, baseline - this.envelope[index]);
        for (let index = SAMPLES; index >= 0; index -= 1) context.lineTo(x0 + (index / SAMPLES) * span, baseline + this.envelope[index]);
        context.closePath();
        context.globalAlpha = alpha * 0.08 * ring;
        context.fillStyle = this.accent;
        context.fill();
        context.beginPath();
        for (let index = 0; index <= SAMPLES; index += 1) {
          const x = x0 + (index / SAMPLES) * span;
          if (index === 0) context.moveTo(x, baseline - this.envelope[index]);
          else context.lineTo(x, baseline - this.envelope[index]);
        }
        for (let index = 0; index <= SAMPLES; index += 1) {
          const x = x0 + (index / SAMPLES) * span;
          if (index === 0) context.moveTo(x, baseline + this.envelope[index]);
          else context.lineTo(x, baseline + this.envelope[index]);
        }
        context.globalAlpha = alpha * 0.34 * ring;
        context.strokeStyle = this.accent;
        context.lineWidth = 1;
        context.stroke();
      }
      context.beginPath();
      for (let index = 0; index <= SAMPLES; index += 1) {
        const x = x0 + (index / SAMPLES) * span;
        if (index === 0) context.moveTo(x, baseline + this.curve[index]);
        else context.lineTo(x, baseline + this.curve[index]);
      }
      if (line.held) {
        context.globalAlpha = alpha;
        context.strokeStyle = this.accent;
        context.lineWidth = 1.5;
        context.stroke();
      } else {
        context.globalAlpha = alpha * (1 - ring);
        context.strokeStyle = this.hairline;
        context.lineWidth = 1;
        context.stroke();
        context.globalAlpha = alpha * 0.7 * ring;
        context.strokeStyle = this.ink;
        context.stroke();
      }
    }

    context.globalAlpha = alpha;
    context.fillStyle = pinColour;
    context.beginPath();
    context.arc(x0, baseline, 2, 0, Math.PI * 2);
    context.arc(x1, baseline, 2, 0, Math.PI * 2);
    context.fill();
  }

  fontFor(line, level, fontSize) {
    if (line.fontSize !== fontSize || line.fontVersion !== this.cacheVersion) {
      line.fonts.fill(null);
      line.fontSize = fontSize;
      line.fontVersion = this.cacheVersion;
    }
    let font = line.fonts[level];
    if (!font) {
      font = `${weightAt(level)} ${fontSize}px ${this.family}`;
      line.fonts[level] = font;
    }
    return font;
  }

  setFont(font) {
    if (font === this.currentFont) return;
    this.currentFont = font;
    this.context.font = font;
  }

  canBlit(line) {
    return !line.held && line.energy === 0 && line.flash === 0 && line.weight === restWeightFor(line.size);
  }

  ensureCache(line) {
    const dpr = this.dpr;
    const size = line.moving ? line.target : line.size;
    const level = levelFor(line.weight);
    let cache = line.cache;
    if (
      cache &&
      cache.size === size &&
      cache.level === level &&
      cache.visibleCount === line.visibleCount &&
      cache.truncated === line.truncated &&
      cache.dpr === dpr &&
      cache.version === this.cacheVersion
    ) {
      return cache;
    }
    if (!cache) {
      const canvas = document.createElement("canvas");
      cache = { canvas, context: canvas.getContext("2d"), size: -1, level: -1, visibleCount: -1, truncated: false, dpr: 0, version: -1, width: 0, height: 0, ascent: 0 };
      line.cache = cache;
    }
    const weight = weightAt(level);
    const tracking = lawTracking(size);
    const count = line.visibleCount + (line.truncated ? 1 : 0);
    let extent = 0;
    for (let index = 0; index < count; index += 1) {
      const isEllipsis = line.truncated && index === line.visibleCount;
      extent += advanceAt(isEllipsis ? line.ellipsis : line.advances, isEllipsis ? 0 : index * 3, weight) * size + tracking;
    }
    const ascentPixels = Math.ceil((size * CACHE_ASCENT + 4) * dpr);
    const descentPixels = Math.ceil((size * CACHE_DESCENT + 4) * dpr);
    const widthPixels = Math.max(1, Math.ceil((extent + CACHE_PAD * 2) * dpr));
    const heightPixels = ascentPixels + descentPixels;
    cache.canvas.width = widthPixels;
    cache.canvas.height = heightPixels;
    const context = cache.context;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, widthPixels, heightPixels);
    context.font = `${weight} ${Math.round(size * 100) / 100}px ${this.family}`;
    context.fillStyle = this.ink;
    context.textBaseline = "alphabetic";
    context.textAlign = "left";
    const ascent = ascentPixels / dpr;
    let pen = CACHE_PAD;
    for (let index = 0; index < count; index += 1) {
      const isEllipsis = line.truncated && index === line.visibleCount;
      const glyph = isEllipsis ? "…" : line.glyphs[index];
      if (glyph !== " ") context.fillText(glyph, pen, ascent);
      pen += advanceAt(isEllipsis ? line.ellipsis : line.advances, isEllipsis ? 0 : index * 3, weight) * size + tracking;
    }
    cache.size = size;
    cache.level = level;
    cache.visibleCount = line.visibleCount;
    cache.truncated = line.truncated;
    cache.dpr = dpr;
    cache.version = this.cacheVersion;
    cache.width = widthPixels / dpr;
    cache.height = heightPixels / dpr;
    cache.ascent = ascent;
    return cache;
  }

  blitLine(line) {
    const cache = this.ensureCache(line);
    const context = this.context;
    const dpr = this.dpr;
    const scale = line.scale * (line.size / cache.size);
    const originY = (line.baseline + CANVAS_BLEED_TOP) * dpr;
    const blurred = this.canFilter && line.blur > 0.25;
    context.globalAlpha = line.alpha;
    if (blurred) context.filter = BLUR_FILTERS[Math.min(BLUR_STEPS, Math.round(line.blur * dpr * 2))];
    context.setTransform(scale * dpr, 0, 0, scale * dpr, TEXT_X * dpr, scale === 1 ? Math.round(originY) : originY);
    context.drawImage(cache.canvas, -CACHE_PAD, -cache.ascent, cache.width, cache.height);
    if (blurred) context.filter = "none";
  }

  drawLive(line) {
    const context = this.context;
    const dpr = this.dpr;
    const size = line.size;
    const fontSize = Math.round(size * 100) / 100;
    const tracking = lawTracking(size);
    const span = this.x1 - this.x0;
    const reach = SWELL_REACH * line.band;
    const scale = line.scale;
    const baseline = line.baseline;
    const swelling = line.energy > 0 || line.held;
    const flashWeight = line.flash > 0 ? FLASH_WEIGHT * Math.sin(Math.PI * Math.min(1, line.flash)) : 0;
    const restWeight = weightAt(levelFor(line.weight));
    const swell = SWELL * clamp(SWELL_REFERENCE_SIZE / size, SWELL_FLOOR, 1);
    const tilt = size >= DISPLAY_FROM;
    const count = Math.min(MAX_GLYPHS, line.visibleCount + (line.truncated ? 1 : 0));
    const glyphX = this.glyphX;
    const glyphY = this.glyphY;
    const glyphAngle = this.glyphAngle;
    const glyphLevel = this.glyphLevel;

    let pen = TEXT_X;
    let lowest = WEIGHT_LEVELS;
    let highest = -1;
    for (let index = 0; index < count; index += 1) {
      const isEllipsis = line.truncated && index === line.visibleCount;
      const restAdvance = advanceAt(isEllipsis ? line.ellipsis : line.advances, isEllipsis ? 0 : index * 3, restWeight) * size;
      const centre = pen + restAdvance / 2;
      let y = 0;
      let angle = 0;
      let weight = restWeight + flashWeight;
      if (swelling) {
        this.displacementAt(line, clamp((centre - this.x0) / span, 0, 1));
        y = this.sampleY;
        if (tilt) {
          const exact = Math.atan(this.sampleSlope / span);
          angle = Math.abs(exact) < TILT_DEADBAND ? 0 : Math.round(exact / TILT_STEP) * TILT_STEP;
        }
        const drive = line.held ? Math.abs(y) : this.sampleEnvelope;
        weight += swell * Math.min(1, drive / reach);
      }
      const level = levelFor(Math.min(MAX_WEIGHT, weight));
      glyphLevel[index] = level;
      glyphX[index] = TEXT_X + (centre - TEXT_X) * scale;
      glyphY[index] = (baseline + y * scale + CANVAS_BLEED_TOP) * dpr;
      glyphAngle[index] = angle;
      if (level < lowest) lowest = level;
      if (level > highest) highest = level;
      pen += restAdvance + tracking;
    }

    context.globalAlpha = line.alpha;
    context.fillStyle = this.ink;
    for (let level = lowest; level <= highest; level += 1) {
      const weight = weightAt(level);
      let fontReady = false;
      for (let index = 0; index < count; index += 1) {
        if (glyphLevel[index] !== level) continue;
        const isEllipsis = line.truncated && index === line.visibleCount;
        const glyph = isEllipsis ? "…" : line.glyphs[index];
        if (glyph === " ") continue;
        if (!fontReady) {
          this.setFont(this.fontFor(line, level, fontSize));
          fontReady = true;
        }
        const advance = advanceAt(isEllipsis ? line.ellipsis : line.advances, isEllipsis ? 0 : index * 3, weight) * size;
        const angle = glyphAngle[index];
        const x = glyphX[index] * dpr;
        if (angle === 0) {
          context.setTransform(scale * dpr, 0, 0, scale * dpr, x, glyphY[index]);
        } else {
          const cos = Math.cos(angle) * scale * dpr;
          const sin = Math.sin(angle) * scale * dpr;
          context.setTransform(cos, sin, -sin, cos, x, glyphY[index]);
        }
        context.fillText(glyph, -advance / 2, 0);
      }
    }
  }

  draw() {
    const context = this.context;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.textBaseline = "alphabetic";
    context.textAlign = "left";
    let drawn = false;
    for (const line of this.lines) {
      if (line.mode === "hidden" || line.alpha <= 0.001) continue;
      this.drawString(line);
      drawn = true;
    }
    for (const line of this.lines) {
      if (line.mode === "hidden" || line.alpha <= 0.001) continue;
      if (this.canBlit(line)) this.blitLine(line);
      else this.drawLive(line);
    }
    context.globalAlpha = 1;
    if (drawn && !this.live) {
      this.live = true;
      this.stage.dataset.live = "true";
    }
  }

  stepChord(now) {
    if (!this.chordDue) return false;
    if (now - this.chordDue > CHORD_STALE_MS) {
      this.chordDue = 0;
      return false;
    }
    if (now < this.chordDue || !this.landed()) return true;
    this.chordDue = 0;
    this.strum(1, CHORD_STRENGTH, CHORD_GAP_MS);
    return true;
  }

  tick(now) {
    this.raf = 0;
    if (!this.running) return;
    this.inTick = true;
    this.pendingKick = false;
    const dtMs = clamp(now - this.last, 0, 34);
    this.last = now;
    const dt = dtMs / 1000;
    let busy = this.stepChord(now);

    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const item = this.queue[index];
      if (now < item.due) continue;
      this.queue.splice(index, 1);
      if (!this.isPresent(item.line) || item.line.held) continue;
      if (item.harmonic) this.resonate(item.line, item.harmonic, item.strength);
      else this.strike(item.line, item.position, item.strength, now);
    }
    if (this.queue.length) busy = true;

    if (this.stepSprings(dt, dtMs)) busy = true;
    if (this.stepLines(now, dt)) busy = true;
    this.positionLines();
    this.draw();

    this.inTick = false;
    if ((busy || this.pendingKick) && !this.raf && this.running) this.raf = requestAnimationFrame(this.tick);
    this.pendingKick = false;
  }

  dispose() {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stage.removeEventListener("pointerdown", this.handlePointerDown);
    this.stage.removeEventListener("pointermove", this.handlePointerMove);
    this.stage.removeEventListener("pointerup", this.handlePointerUp);
    this.stage.removeEventListener("pointercancel", this.handlePointerUp);
    this.stage.removeEventListener("lostpointercapture", this.handlePointerUp);
    this.stage.removeEventListener("pointerleave", this.handlePointerLeave);
    this.stage.removeEventListener("pointerenter", this.markRectDirty);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    window.removeEventListener("scroll", this.markRectDirty);
    this.resolutionQuery?.removeEventListener("change", this.handleResolution);
    this.resolutionQuery = null;
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    for (const line of this.lines) {
      if (!line.cache) continue;
      line.cache.canvas.width = 0;
      line.cache.canvas.height = 0;
      line.cache = null;
    }
    this.queue = [];
    this.chordDue = 0;
    this.gestures.clear();
  }
}
