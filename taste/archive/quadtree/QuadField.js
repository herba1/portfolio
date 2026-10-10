import createResolutionGovernor from "@/app/experiments/resolutionGovernor";

import { MAX_LEVEL, NODE_COUNT, buildRestTree, nodeIndex, regionStats } from "./quadTree";
import { QUAD_FRAGMENT, QUAD_VERTEX, SPRING_SAMPLES } from "./quadtreeShader";

const MAX_TILES = 65536;
const FLOATS = 12;
const STRIDE = FLOATS * 4;
const KIND_SPLIT = 0;
const KIND_RETIRE = 1;
const KIND_MERGE_CHILD = 2;
const KIND_MERGE_PARENT = 3;
const KIND_RECOLOUR = 4;
const SPRING_SPAN = 0.7;
const SPRING_DURATION = 0.42;
const SPRING_BOUNCE = 0.4;
const SPLIT_GATE = 0.07;
const STAGGER = 0.024;
const RETIRE_AFTER = 0.072 + 0.18;
const MERGE_SHRINK = 0.22;
const MERGE_PARENT_DELAY = 0.2;
const SETTLE_AGE = 0.32;
const ANIMATION_TAIL = 0.8;
const WAVE_INTRO = 0.8;
const WAVE_MORPH = 1.6;
const INTRO_HOLD = 0.36;
const PAD_PX = 16;
const CANDIDATE_CAP = 32768;
const NEVER = -1e9;
const STATS_INTERVAL = 0.12;
const DEMO_DELAY = 0.5;
const DEMO_DURATION = 2.4;
const DEMO_REACH = 0.3;
const LENS_REFRESH = 0.25;
const LOOK_DURATION = 0.28;
const LENS_FOLLOW = 0.06;
const LENS_FADE_IN = 0.14;
const LENS_FADE_OUT = 0.32;
const LENS_GROW = 0.12;
const SETTLED = 0.0005;
const CHILD_X = [0, 1, 1, 0];
const CHILD_Y = [0, 0, 1, 1];
const SURFACE = [241 / 255, 245 / 255, 249 / 255];
const INK = [26 / 255, 26 / 255, 26 / 255];
const PAPER = [248 / 255, 250 / 255, 252 / 255];

function springTable() {
  const table = new Float32Array(SPRING_SAMPLES);
  const damping = 1 - SPRING_BOUNCE;
  const omega = (Math.PI * 2) / SPRING_DURATION;
  const damped = omega * Math.sqrt(1 - damping * damping);
  for (let i = 0; i < SPRING_SAMPLES; i += 1) {
    const time = (i / (SPRING_SAMPLES - 1)) * SPRING_SPAN;
    const envelope = Math.exp(-damping * omega * time);
    table[i] = 1 - envelope * (Math.cos(damped * time) + ((damping * omega) / damped) * Math.sin(damped * time));
  }
  table[SPRING_SAMPLES - 1] = 1;
  return table;
}

function bezierEase(x1, y1, x2, y2) {
  const ax = 1 + 3 * x1 - 3 * x2;
  const bx = 3 * x2 - 6 * x1;
  const cx = 3 * x1;
  const ay = 1 + 3 * y1 - 3 * y2;
  const by = 3 * y2 - 6 * y1;
  const cy = 3 * y1;
  return (progress) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    let t = progress;
    for (let i = 0; i < 8; i += 1) {
      const miss = ((ax * t + bx) * t + cx) * t - progress;
      if (Math.abs(miss) < 1e-5) break;
      const slope = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(slope) < 1e-6) break;
      t = Math.min(1, Math.max(0, t - miss / slope));
    }
    return ((ay * t + by) * t + cy) * t;
  };
}

const houseEase = bezierEase(0.22, 1, 0.36, 1);

function lookOf(params, out) {
  out[0] = params.gap;
  out[1] = params.radius;
  out[2] = params.shape === 1 ? 1 : 0;
  out[3] = params.shape === 2 ? 1 : 0;
  return out;
}

function smoothstep(edge0, edge1, value) {
  const k = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return k * k * (3 - 2 * k);
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(message || "shader failed to compile");
  }
  return shader;
}

export default class QuadField {
  constructor(canvas, { onStats, onReady, ring, lens, cover, reducedMotion = false, compact = false } = {}) {
    this.canvas = canvas;
    this.onStats = onStats;
    this.onReady = onReady;
    this.ring = ring;
    this.lens = lens;
    this.cover = cover;
    this.demo = null;
    this.demoPlayed = false;
    this.touched = false;
    this.userInside = false;
    this.compact = compact;
    this.reduced = reducedMotion;

    this.state = new Uint8Array(NODE_COUNT);
    this.slotOf = new Int32Array(NODE_COUNT).fill(-1);
    this.bornAt = new Float32Array(NODE_COUNT);
    this.wantedAt = new Float32Array(NODE_COUNT).fill(NEVER);
    this.pinned = new Uint8Array(NODE_COUNT);
    this.restSplit = new Uint8Array(NODE_COUNT);
    this.errorCache = new Float32Array(NODE_COUNT).fill(-1);

    this.data = new Float32Array(MAX_TILES * FLOATS);
    this.freeStack = new Int32Array(MAX_TILES);
    this.freeTop = 0;
    this.highWater = 0;
    this.releaseSlot = new Int32Array(MAX_TILES);
    this.releaseAt = new Float32Array(MAX_TILES);
    this.releaseCount = 0;
    this.dirtyMin = MAX_TILES;
    this.dirtyMax = -1;

    this.candidateLevel = new Uint8Array(CANDIDATE_CAP);
    this.candidateX = new Uint16Array(CANDIDATE_CAP);
    this.candidateY = new Uint16Array(CANDIDATE_CAP);
    this.candidateScore = new Float32Array(CANDIDATE_CAP);
    this.candidateOrder = new Uint32Array(CANDIDATE_CAP);
    this.candidateCount = 0;
    this.mergeLevel = new Uint8Array(CANDIDATE_CAP);
    this.mergeX = new Uint16Array(CANDIDATE_CAP);
    this.mergeY = new Uint16Array(CANDIDATE_CAP);
    this.mergeScore = new Float32Array(CANDIDATE_CAP);
    this.mergeOrder = new Uint32Array(CANDIDATE_CAP);
    this.mergeCount = 0;
    this.byCandidateScore = (a, b) => this.candidateScore[b] - this.candidateScore[a];
    this.byMergeScore = (a, b) => this.mergeScore[b] - this.mergeScore[a];

    this.stats = new Float64Array(4);
    this.parentColour = new Float32Array(3);
    this.springs = springTable();

    this.params = null;
    this.lookNow = new Float32Array(4);
    this.lookFrom = new Float32Array(4);
    this.lookTo = new Float32Array(4);
    this.lookStart = NEVER;
    this.source = null;
    this.leafCount = 0;
    this.carved = 0;
    this.carveDirty = false;
    this.reportedLeaves = -1;
    this.reportedCarved = -1;
    this.lastReport = 0;
    this.maxLevel = 1;
    this.coverPx = 0;
    this.dprCap = 2;
    this.dpr = 1;
    this.wave = null;
    this.reconcilePending = false;
    this.animUntil = 0;
    this.needsDraw = true;
    this.painted = false;

    this.pointerX = 0.5;
    this.pointerY = 0.5;
    this.lastPointerX = 0.5;
    this.lastPointerY = 0.5;
    this.inside = false;
    this.pressed = false;
    this.moved = false;
    this.speed = 0;
    this.focus = 0;
    this.shownFocus = -1;
    this.lastLensVisit = 0;
    this.lensBusy = false;
    this.lensCore = 16;
    this.lensRadius = 0.16;
    this.lensMaxLevel = 1;
    this.visitTime = 0;
    this.pending = false;
    this.reconcileRest = 0;
    this.mergeDelay = 1.4;
    this.restBuiltFor = "";
    this.lensX = 0.5;
    this.lensY = 0.5;
    this.lensVelocityX = 0;
    this.lensVelocityY = 0;
    this.lensAmount = 0;
    this.shownLensRadius = 0.16;
    this.lensSettling = false;

    this.active = false;
    this.lost = false;
    this.raf = 0;
    this.epoch = performance.now();
    this.lastFrame = 0;
    this.governor = createResolutionGovernor({ max: 1, min: 0.6 });

    this.frame = this.frame.bind(this);
    this.handleLost = this.handleLost.bind(this);
    this.handleRestored = this.handleRestored.bind(this);

    this.gl = this.openWebGL();
    this.context2d = this.gl ? null : this.canvas.getContext("2d");
    this.motion = this.reduced || !this.gl ? 0 : 1;
    this.canvas.addEventListener("webglcontextlost", this.handleLost);
    this.canvas.addEventListener("webglcontextrestored", this.handleRestored);
  }

  openWebGL() {
    const gl = this.canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) return null;
    this.gl = gl;
    try {
      this.createResources();
      return gl;
    } catch {
      this.deleteResources();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      this.gl = null;
      this.replaceCanvas();
      return null;
    }
  }

  replaceCanvas() {
    const stale = this.canvas;
    const fresh = document.createElement("canvas");
    fresh.className = stale.className;
    if (stale.parentNode) stale.replaceWith(fresh);
    this.canvas = fresh;
  }

  get usesWebGL() {
    return Boolean(this.gl);
  }

  now() {
    return (performance.now() - this.epoch) / 1000;
  }

  createResources() {
    const gl = this.gl;
    const vertex = compile(gl, gl.VERTEX_SHADER, QUAD_VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, QUAD_FRAGMENT);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(message || "program failed to link");
    }
    this.program = program;
    this.uniforms = {};
    const total = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < total; i += 1) {
      const info = gl.getActiveUniform(program, i);
      const name = info.name.replace(/\[0\]$/, "");
      this.uniforms[name] = gl.getUniformLocation(program, info.name);
    }

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.cornerBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.tileBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tileBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    for (let attribute = 1; attribute <= 4; attribute += 1) {
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribPointer(attribute, 3, gl.FLOAT, false, STRIDE, (attribute - 1) * 12);
      gl.vertexAttribDivisor(attribute, 1);
    }
    gl.bindVertexArray(null);

    gl.useProgram(program);
    gl.uniform1fv(this.uniforms.uSpring, this.springs);
    gl.uniform1f(this.uniforms.uSpringSpan, SPRING_SPAN);
    gl.uniform3f(this.uniforms.uInk, INK[0], INK[1], INK[2]);
    gl.uniform3f(this.uniforms.uPaper, PAPER[0], PAPER[1], PAPER[2]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    if (this.highWater > 0) this.markDirty(0, this.highWater - 1);
  }

  deleteResources() {
    const gl = this.gl;
    if (!gl) return;
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.cornerBuffer) gl.deleteBuffer(this.cornerBuffer);
    if (this.tileBuffer) gl.deleteBuffer(this.tileBuffer);
    if (this.program) gl.deleteProgram(this.program);
    this.vao = null;
    this.cornerBuffer = null;
    this.tileBuffer = null;
    this.program = null;
  }

  handleLost(event) {
    event.preventDefault();
    this.lost = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  handleRestored() {
    this.lost = false;
    this.vao = null;
    this.cornerBuffer = null;
    this.tileBuffer = null;
    this.program = null;
    try {
      this.createResources();
    } catch {
      return;
    }
    this.needsDraw = true;
    this.wake();
  }

  setReduced(reduced) {
    this.reduced = reduced;
    this.motion = reduced || !this.gl ? 0 : 1;
    this.needsDraw = true;
    this.wake();
  }

  setActive(active) {
    this.active = active;
    if (active) {
      this.lastFrame = this.now();
      this.needsDraw = true;
      this.wake();
    } else if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  wake() {
    if (this.raf || !this.active || this.lost) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  resize(coverPx, dprCap) {
    if (!(coverPx > 0)) return;
    this.coverPx = coverPx;
    this.dprCap = dprCap;
    this.applyResolution(true);
    this.refreshLevels();
    this.needsDraw = true;
    this.wake();
  }

  applyResolution(paintNow) {
    const ratio = Math.min(window.devicePixelRatio || 1, this.dprCap) * this.governor.scale;
    this.dpr = Math.max(0.5, ratio);
    const cssSide = this.coverPx + PAD_PX * 2;
    const side = Math.max(1, Math.round(cssSide * this.dpr));
    if (this.canvas.width === side && this.canvas.height === side) return;
    this.canvas.width = side;
    this.canvas.height = side;
    this.needsDraw = true;
    const drawable = this.gl ? Boolean(this.program) && !this.lost : Boolean(this.context2d);
    if (paintNow && drawable && this.coverPx > 0) this.draw(this.now());
  }

  refreshLevels() {
    if (!this.params || !(this.coverPx > 0)) return;
    const smallest = this.params.minTile * (this.compact ? 1.5 : 1);
    const level = Math.min(MAX_LEVEL, Math.max(1, Math.floor(Math.log2(this.coverPx / smallest))));
    if (level === this.maxLevel && this.restBuiltFor === this.restKey()) return;
    this.maxLevel = level;
    this.rebuildRest();
  }

  restKey() {
    const params = this.params;
    return `${params.restSplits}|${params.areaPower}|${this.maxLevel}|${this.source?.src ?? ""}`;
  }

  rebuildRest() {
    if (!this.source || !this.params) return;
    buildRestTree(this.source.tables, this.restSplit, {
      splits: this.params.restSplits,
      areaPower: this.params.areaPower,
      maxLevel: Math.max(1, this.maxLevel - 1),
    });
    this.restBuiltFor = this.restKey();
    this.reconcilePending = true;
    this.carveDirty = true;
    this.wake();
  }

  setParams(params) {
    const previous = this.params;
    this.params = { ...params };
    this.retargetLook(previous);
    this.refreshLevels();
    if (this.source && this.restBuiltFor !== this.restKey()) this.rebuildRest();
    this.reconcilePending = true;
    this.needsDraw = true;
    this.wake();
  }

  retargetLook(previous) {
    const time = this.now();
    const shapeChanged = !previous || previous.shape !== this.params.shape;
    const changedKeys = previous ? Number(previous.gap !== this.params.gap) + Number(previous.radius !== this.params.radius) : 0;
    this.sampleLook(time);
    lookOf(this.params, this.lookTo);
    if (!previous || !this.motion || (!shapeChanged && changedKeys < 2)) {
      this.lookNow.set(this.lookTo);
      this.lookStart = NEVER;
      return;
    }
    this.lookFrom.set(this.lookNow);
    this.lookStart = time;
    if (time + LOOK_DURATION + 0.04 > this.animUntil) this.animUntil = time + LOOK_DURATION + 0.04;
  }

  sampleLook(time) {
    const progress = (time - this.lookStart) / LOOK_DURATION;
    if (progress >= 1) {
      this.lookNow.set(this.lookTo);
      return;
    }
    const eased = houseEase(progress);
    for (let i = 0; i < 4; i += 1) this.lookNow[i] = this.lookFrom[i] + (this.lookTo[i] - this.lookFrom[i]) * eased;
  }

  setPointer(x, y) {
    this.pointerX = x;
    this.pointerY = y;
    this.moved = true;
    this.wake();
  }

  setInside(inside) {
    if (inside) {
      this.touched = true;
      this.stopDemo();
    }
    this.userInside = inside;
    this.inside = inside;
    if (inside) {
      this.lastPointerX = this.pointerX;
      this.lastPointerY = this.pointerY;
      this.speed = 0;
    }
    this.reconcilePending = true;
    this.wake();
  }

  setPressed(pressed) {
    this.pressed = pressed;
    this.moved = true;
    this.wake();
  }

  releaseCarve() {
    this.pinned.fill(0);
    this.carveDirty = true;
    this.reconcilePending = true;
    this.wake();
  }

  alloc() {
    if (this.freeTop > 0) {
      this.freeTop -= 1;
      return this.freeStack[this.freeTop];
    }
    if (this.highWater >= MAX_TILES) return -1;
    const slot = this.highWater;
    this.highWater += 1;
    return slot;
  }

  hasRoom(count) {
    return this.freeTop + (MAX_TILES - this.highWater) >= count;
  }

  markDirty(from, to) {
    if (from < this.dirtyMin) this.dirtyMin = from;
    if (to > this.dirtyMax) this.dirtyMax = to;
  }

  release(slot) {
    const at = slot * FLOATS;
    this.data.fill(0, at, at + FLOATS);
    this.markDirty(slot, slot);
    this.freeStack[this.freeTop] = slot;
    this.freeTop += 1;
  }

  releaseLater(slot, at) {
    this.releaseSlot[this.releaseCount] = slot;
    this.releaseAt[this.releaseCount] = at;
    this.releaseCount += 1;
  }

  releaseDue(time) {
    let kept = 0;
    for (let i = 0; i < this.releaseCount; i += 1) {
      if (this.releaseAt[i] <= time) {
        this.release(this.releaseSlot[i]);
      } else {
        this.releaseSlot[kept] = this.releaseSlot[i];
        this.releaseAt[kept] = this.releaseAt[i];
        kept += 1;
      }
    }
    this.releaseCount = kept;
  }

  writeTile(slot, level, x, y, red, green, blue, fromRed, fromGreen, fromBlue, startAt, kind) {
    const size = 1 / (1 << level);
    const at = slot * FLOATS;
    const data = this.data;
    data[at] = x * size;
    data[at + 1] = y * size;
    data[at + 2] = size;
    data[at + 3] = red;
    data[at + 4] = green;
    data[at + 5] = blue;
    data[at + 6] = fromRed;
    data[at + 7] = fromGreen;
    data[at + 8] = fromBlue;
    data[at + 9] = startAt;
    data[at + 10] = kind;
    data[at + 11] = level;
    this.markDirty(slot, slot);
    if (startAt + ANIMATION_TAIL > this.animUntil) this.animUntil = startAt + ANIMATION_TAIL;
  }

  errorOf(level, x, y, node) {
    const cached = this.errorCache[node];
    if (cached >= 0) return cached;
    regionStats(this.source.tables, level, x, y, this.stats);
    this.errorCache[node] = this.stats[3];
    return this.stats[3];
  }

  resetTree() {
    this.state.fill(0);
    this.slotOf.fill(-1);
    this.bornAt.fill(0);
    this.data.fill(0);
    this.freeTop = 0;
    this.highWater = 0;
    this.releaseCount = 0;
    this.leafCount = 0;
    this.dirtyMin = MAX_TILES;
    this.dirtyMax = -1;
  }

  setCover(source, originX = 0.5, originY = 0.5) {
    if (this.source === source) return;
    this.stopDemo();
    const time = this.now();
    const first = !this.source || this.leafCount === 0;
    this.source = source;
    this.errorCache.fill(-1);
    this.pinned.fill(0);
    this.wantedAt.fill(NEVER);
    this.refreshLevels();
    if (this.restBuiltFor !== this.restKey()) this.rebuildRest();
    const [red, green, blue] = source.mean;
    if (first) {
      this.resetTree();
      const slot = this.alloc();
      const startAt = time + 0.04;
      this.writeTile(slot, 0, 0, 0, red, green, blue, SURFACE[0], SURFACE[1], SURFACE[2], startAt, KIND_SPLIT);
      this.state[0] = 1;
      this.slotOf[0] = slot;
      this.bornAt[0] = startAt;
      this.leafCount = 1;
      this.wave = { x: 0.5, y: 0.5, start: time + INTRO_HOLD * this.motion, speed: this.motion ? WAVE_INTRO : 1e6, intro: true };
    } else {
      this.wave = { x: originX, y: originY, start: time, speed: this.motion ? WAVE_MORPH : 1e6, intro: false };
      this.recolour(0, 0, 0);
    }
    this.carveDirty = true;
    this.reconcilePending = true;
    this.needsDraw = true;
    this.wake();
  }

  waveDistance(level, x, y) {
    const wave = this.wave;
    if (!wave) return 0;
    const size = 1 / (1 << level);
    const left = x * size;
    const top = y * size;
    const dx = Math.max(left - wave.x, 0, wave.x - left - size);
    const dy = Math.max(top - wave.y, 0, wave.y - top - size);
    return Math.sqrt(dx * dx + dy * dy);
  }

  waveDelay(level, x, y) {
    const wave = this.wave;
    if (!wave) return 0;
    return this.waveDistance(level, x, y) / wave.speed;
  }

  centreDelay(level, x, y) {
    const wave = this.wave;
    if (!wave) return 0;
    const size = 1 / (1 << level);
    const dx = (x + 0.5) * size - wave.x;
    const dy = (y + 0.5) * size - wave.y;
    return Math.sqrt(dx * dx + dy * dy) / wave.speed;
  }

  recolour(level, x, y) {
    const node = nodeIndex(level, x, y);
    const state = this.state[node];
    if (state === 2) {
      const childLevel = level + 1;
      for (let i = 0; i < 4; i += 1) this.recolour(childLevel, x * 2 + CHILD_X[i], y * 2 + CHILD_Y[i]);
      return;
    }
    if (state !== 1) return;
    const slot = this.slotOf[node];
    const at = slot * FLOATS;
    const data = this.data;
    regionStats(this.source.tables, level, x, y, this.stats);
    this.errorCache[node] = this.stats[3];
    const startAt = this.wave.start + this.centreDelay(level, x, y) * this.motion;
    this.writeTile(slot, level, x, y, this.stats[0], this.stats[1], this.stats[2], data[at + 3], data[at + 4], data[at + 5], startAt, KIND_RECOLOUR);
  }

  split(level, x, y, time, pin) {
    if (!this.hasRoom(4)) return false;
    const node = nodeIndex(level, x, y);
    const slot = this.slotOf[node];
    const at = slot * FLOATS;
    const data = this.data;
    const colour = this.parentColour;
    colour[0] = data[at + 3];
    colour[1] = data[at + 4];
    colour[2] = data[at + 5];
    const retireAt = time + RETIRE_AFTER * this.motion;
    data[at + 9] = retireAt;
    data[at + 10] = KIND_RETIRE;
    this.markDirty(slot, slot);
    this.releaseLater(slot, retireAt + 0.02);

    this.state[node] = 2;
    this.slotOf[node] = -1;
    if (pin) this.pinned[node] = 1;
    const wanted = this.wantedAt[node];
    const childLevel = level + 1;
    const tables = this.source.tables;
    const stats = this.stats;
    for (let i = 0; i < 4; i += 1) {
      const childX = x * 2 + CHILD_X[i];
      const childY = y * 2 + CHILD_Y[i];
      const child = nodeIndex(childLevel, childX, childY);
      regionStats(tables, childLevel, childX, childY, stats);
      const childSlot = this.alloc();
      const startAt = time + i * STAGGER * this.motion;
      this.writeTile(childSlot, childLevel, childX, childY, stats[0], stats[1], stats[2], colour[0], colour[1], colour[2], startAt, KIND_SPLIT);
      this.state[child] = 1;
      this.slotOf[child] = childSlot;
      this.bornAt[child] = startAt;
      this.wantedAt[child] = wanted;
      this.pinned[child] = 0;
      this.errorCache[child] = stats[3];
    }
    this.leafCount += 3;
    if (pin) this.carveDirty = true;
    return true;
  }

  merge(level, x, y, time) {
    if (!this.hasRoom(1)) return false;
    const node = nodeIndex(level, x, y);
    const stats = regionStats(this.source.tables, level, x, y, this.stats);
    const red = stats[0];
    const green = stats[1];
    const blue = stats[2];
    const childLevel = level + 1;
    const shrinkEnd = time + MERGE_SHRINK * this.motion;
    const data = this.data;
    for (let i = 0; i < 4; i += 1) {
      const child = nodeIndex(childLevel, x * 2 + CHILD_X[i], y * 2 + CHILD_Y[i]);
      const childSlot = this.slotOf[child];
      const at = childSlot * FLOATS;
      data[at + 6] = red;
      data[at + 7] = green;
      data[at + 8] = blue;
      data[at + 9] = time;
      data[at + 10] = KIND_MERGE_CHILD;
      this.markDirty(childSlot, childSlot);
      this.releaseLater(childSlot, shrinkEnd + 0.02);
      this.state[child] = 0;
      this.slotOf[child] = -1;
      this.pinned[child] = 0;
    }
    const slot = this.alloc();
    const startAt = time + MERGE_PARENT_DELAY * this.motion;
    this.writeTile(slot, level, x, y, red, green, blue, red, green, blue, startAt, KIND_MERGE_PARENT);
    if (shrinkEnd + ANIMATION_TAIL > this.animUntil) this.animUntil = shrinkEnd + ANIMATION_TAIL;
    this.state[node] = 1;
    this.slotOf[node] = slot;
    this.bornAt[node] = startAt;
    this.pinned[node] = 0;
    this.leafCount -= 3;
    this.carveDirty = true;
    return true;
  }

  pushCandidate(level, x, y, score) {
    if (this.candidateCount >= CANDIDATE_CAP) return;
    const i = this.candidateCount;
    this.candidateLevel[i] = level;
    this.candidateX[i] = x;
    this.candidateY[i] = y;
    this.candidateScore[i] = score;
    this.candidateOrder[i] = i;
    this.candidateCount += 1;
  }

  pushMerge(level, x, y, score) {
    if (this.mergeCount >= CANDIDATE_CAP) return;
    const i = this.mergeCount;
    this.mergeLevel[i] = level;
    this.mergeX[i] = x;
    this.mergeY[i] = y;
    this.mergeScore[i] = score;
    this.mergeOrder[i] = i;
    this.mergeCount += 1;
  }

  splitCandidates(budget, time, pin) {
    const count = this.candidateCount;
    if (!count) return 0;
    const order = this.candidateOrder.subarray(0, count);
    if (count > budget) order.sort(this.byCandidateScore);
    const limit = Math.min(count, budget);
    let done = 0;
    for (let k = 0; k < limit; k += 1) {
      const i = order[k];
      const level = this.candidateLevel[i];
      const x = this.candidateX[i];
      const y = this.candidateY[i];
      if (this.state[nodeIndex(level, x, y)] !== 1) continue;
      if (!this.split(level, x, y, time, pin)) break;
      done += 1;
    }
    return done;
  }

  lensStep(time, dt) {
    const ring = this.ring;
    if (!this.source || !this.inside) {
      this.speed = 0;
      this.focus = Math.max(0, this.focus - dt * 4);
      this.lensBusy = false;
      return;
    }
    const dx = this.pointerX - this.lastPointerX;
    const dy = this.pointerY - this.lastPointerY;
    this.lastPointerX = this.pointerX;
    this.lastPointerY = this.pointerY;
    const instant = Math.sqrt(dx * dx + dy * dy) / dt;
    this.speed += (instant - this.speed) * (1 - Math.exp(-dt / 0.08));
    const target = this.pressed ? 1 : 1 - smoothstep(0.35, 2.2, this.speed);
    const rate = target > this.focus ? 0.42 : 0.1;
    this.focus = this.reduced ? target : this.focus + (target - this.focus) * (1 - Math.exp(-dt / rate));
    if (ring && Math.abs(this.focus - this.shownFocus) > 0.01) {
      this.shownFocus = this.focus;
      ring.style.setProperty("--qt-focus", this.focus.toFixed(3));
    }

    const settled = Math.abs(target - this.focus) < 0.01;
    if (!this.moved && !this.lensBusy && settled && time - this.lastLensVisit < LENS_REFRESH) return;
    this.moved = false;
    this.lastLensVisit = time;

    const params = this.params;
    const lensScale = this.compact ? 1.25 : 1;
    this.lensRadius = params.lens * lensScale * (this.pressed ? 1.25 : 1);
    this.lensCore = 16 + (3.5 - 16) * this.focus;
    const smallest = params.minTile * (this.compact ? 1.5 : 1) * Math.pow(2, (1 - this.focus) * 2.4);
    this.lensMaxLevel = Math.min(this.maxLevel, Math.max(1, Math.floor(Math.log2(this.coverPx / smallest))));
    this.visitTime = time;
    this.candidateCount = 0;
    this.lensBusy = false;
    this.visitLens(0, 0, 0);
    const frames = Math.min(2, Math.max(0.5, dt * 60));
    const budget = Math.round(params.budget * (this.pressed ? 2 : 1) * frames);
    const done = this.splitCandidates(budget, time, this.pressed);
    if (this.candidateCount > 0) this.lensBusy = true;
    if (done > 0 || this.pressed) this.reconcilePending = true;
  }

  visitLens(level, x, y) {
    const node = nodeIndex(level, x, y);
    const state = this.state[node];
    if (state === 0) return;
    const size = 1 / (1 << level);
    const left = x * size;
    const top = y * size;
    const px = this.pointerX;
    const py = this.pointerY;
    const radius = this.lensRadius;
    const outX = Math.max(left - px, 0, px - left - size);
    const outY = Math.max(top - py, 0, py - top - size);
    if (outX * outX + outY * outY > radius * radius) return;
    this.wantedAt[node] = this.visitTime;
    if (state === 2) {
      if (this.pressed && !this.pinned[node]) {
        this.pinned[node] = 1;
        this.carveDirty = true;
      }
      const childLevel = level + 1;
      for (let i = 0; i < 4; i += 1) this.visitLens(childLevel, x * 2 + CHILD_X[i], y * 2 + CHILD_Y[i]);
      return;
    }
    if (level >= this.lensMaxLevel) return;
    if (this.visitTime - this.bornAt[node] < SPLIT_GATE) {
      this.lensBusy = true;
      return;
    }
    const cx = left + size * 0.5 - px;
    const cy = top + size * 0.5 - py;
    const distance = Math.sqrt(cx * cx + cy * cy);
    const threshold = this.lensCore + (26 - this.lensCore) * smoothstep(0, radius, distance);
    const error = this.errorOf(level, x, y, node);
    if (error <= threshold) return;
    this.pushCandidate(level, x, y, (error / threshold) * Math.sqrt(size * this.coverPx));
  }

  reconcileStep(time) {
    if (!this.reconcilePending || !this.source) return;
    if (this.reconcileRest > 0) {
      this.reconcileRest -= 1;
      return;
    }
    this.candidateCount = 0;
    this.mergeCount = 0;
    this.pending = false;
    this.visitTime = time;
    this.mergeDelay = this.params.mergeDelay;
    this.visitReconcile(0, 0, 0);

    const morphing = this.wave && !this.wave.intro;
    const splitBudget = this.wave ? (morphing ? 64 : 16) : 32;
    this.splitCandidates(splitBudget, time, false);

    const mergeCount = this.mergeCount;
    if (mergeCount > 0) {
      const order = this.mergeOrder.subarray(0, mergeCount);
      order.sort(this.byMergeScore);
      const limit = Math.min(mergeCount, morphing ? 96 : 24);
      for (let k = 0; k < limit; k += 1) {
        const i = order[k];
        const level = this.mergeLevel[i];
        const x = this.mergeX[i];
        const y = this.mergeY[i];
        const node = nodeIndex(level, x, y);
        if (this.state[node] !== 2) continue;
        if (!this.merge(level, x, y, time)) break;
      }
    }

    const quiet = this.candidateCount === 0 && mergeCount === 0;
    this.reconcileRest = quiet && !this.wave ? 3 : 0;
    if (!this.pending && quiet) {
      this.reconcileRest = 0;
      this.reconcilePending = false;
      if (this.wave?.intro) this.queueDemo(time);
      this.wave = null;
    }
  }

  queueDemo(time) {
    if (this.demoPlayed || this.touched || !this.motion) return;
    this.demoPlayed = true;
    const stats = this.stats;
    let bestX = 0.5;
    let bestY = 0.5;
    let bestError = -1;
    const level = 3;
    const cells = 1 << level;
    for (let y = 1; y < cells - 1; y += 1) {
      for (let x = 1; x < cells - 1; x += 1) {
        regionStats(this.source.tables, level, x, y, stats);
        if (stats[3] > bestError) {
          bestError = stats[3];
          bestX = (x + 0.5) / cells;
          bestY = (y + 0.5) / cells;
        }
      }
    }
    const fromX = Math.min(0.92, Math.max(0.08, bestX - DEMO_REACH));
    const toX = Math.min(0.92, Math.max(0.08, bestX + DEMO_REACH));
    this.demo = { start: time + DEMO_DELAY, fromX, toX, y: bestY };
  }

  stopDemo() {
    if (!this.demo) return;
    this.demo = null;
    this.cover?.removeAttribute("data-demo");
    if (!this.userInside) this.inside = false;
  }

  runDemo(time) {
    const demo = this.demo;
    if (!demo || time < demo.start) return;
    const progress = (time - demo.start) / DEMO_DURATION;
    if (progress >= 1) {
      this.stopDemo();
      this.reconcilePending = true;
      return;
    }
    const eased = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    const x = demo.fromX + (demo.toX - demo.fromX) * eased;
    const y = Math.min(0.92, Math.max(0.08, demo.y + Math.sin(progress * Math.PI) * -0.08));
    if (!this.inside) {
      this.inside = true;
      this.lastPointerX = x;
      this.lastPointerY = y;
      this.cover?.setAttribute("data-demo", "");
    }
    this.pointerX = x;
    this.pointerY = y;
    this.moved = true;
    if (this.lens) this.lens.style.transform = `translate3d(${x * this.coverPx}px, ${y * this.coverPx}px, 0)`;
  }

  followLens(dt) {
    const params = this.params;
    if (!params) return;
    const target = this.inside ? 1 : 0;
    const amountBefore = this.lensAmount;
    const radiusTarget = params.lens * (this.compact ? 1.25 : 1) * (this.pressed ? 1.25 : 1);
    const xBefore = this.lensX;
    const yBefore = this.lensY;
    const radiusBefore = this.shownLensRadius;
    if (this.reduced || amountBefore < 0.02) {
      this.lensX = this.pointerX;
      this.lensY = this.pointerY;
      this.lensVelocityX = 0;
      this.lensVelocityY = 0;
    } else {
      const omega = 2 / LENS_FOLLOW;
      const reach = omega * dt;
      const decay = 1 / (1 + reach + 0.48 * reach * reach + 0.235 * reach * reach * reach);
      const offsetX = this.lensX - this.pointerX;
      const carryX = (this.lensVelocityX + omega * offsetX) * dt;
      this.lensVelocityX = (this.lensVelocityX - omega * carryX) * decay;
      this.lensX = this.pointerX + (offsetX + carryX) * decay;
      const offsetY = this.lensY - this.pointerY;
      const carryY = (this.lensVelocityY + omega * offsetY) * dt;
      this.lensVelocityY = (this.lensVelocityY - omega * carryY) * decay;
      this.lensY = this.pointerY + (offsetY + carryY) * decay;
    }
    if (this.reduced) {
      this.lensAmount = target;
      this.shownLensRadius = radiusTarget;
    } else {
      const fade = target > amountBefore ? LENS_FADE_IN : LENS_FADE_OUT;
      this.lensAmount += (target - amountBefore) * (1 - Math.exp(-dt / fade));
      if (Math.abs(target - this.lensAmount) < SETTLED) this.lensAmount = target;
      this.shownLensRadius += (radiusTarget - radiusBefore) * (1 - Math.exp(-dt / LENS_GROW));
      if (Math.abs(radiusTarget - this.shownLensRadius) < SETTLED) this.shownLensRadius = radiusTarget;
    }
    const drift = Math.abs(this.lensX - this.pointerX) + Math.abs(this.lensY - this.pointerY);
    this.lensSettling = this.lensAmount !== target || this.shownLensRadius !== radiusTarget || (this.lensAmount > 0 && drift > SETTLED * 0.2);
    if (this.lensAmount === 0 && amountBefore === 0) return;
    const change = Math.abs(this.lensX - xBefore) + Math.abs(this.lensY - yBefore) + Math.abs(this.lensAmount - amountBefore) + Math.abs(this.shownLensRadius - radiusBefore);
    if (change > 1e-5) this.needsDraw = true;
  }

  waveReached(level, x, y) {
    const wave = this.wave;
    if (!wave) return true;
    return this.visitTime >= wave.start && this.waveDelay(level, x, y) <= this.visitTime - wave.start;
  }

  visitReconcile(level, x, y) {
    const node = nodeIndex(level, x, y);
    const state = this.state[node];
    const time = this.visitTime;
    if (state === 1) {
      if (!this.restSplit[node] || level >= this.maxLevel) return;
      this.pending = true;
      if (time - this.bornAt[node] < SPLIT_GATE || !this.waveReached(level, x, y)) return;
      const span = 512 / (1 << level);
      const distance = this.waveDistance(level, x, y);
      const priority = this.errorOf(level, x, y, node) * Math.pow(span * span, this.params.areaPower);
      this.pushCandidate(level, x, y, priority / (1 + distance * 6));
      return;
    }
    if (state !== 2) return;
    const childLevel = level + 1;
    let leaves = 0;
    let quiet = true;
    for (let i = 0; i < 4; i += 1) {
      const childX = x * 2 + CHILD_X[i];
      const childY = y * 2 + CHILD_Y[i];
      const child = nodeIndex(childLevel, childX, childY);
      this.visitReconcile(childLevel, childX, childY);
      if (this.state[child] === 1) {
        leaves += 1;
        if (time - this.wantedAt[child] <= this.mergeDelay || time - this.bornAt[child] < SETTLE_AGE) quiet = false;
      }
    }
    const tooDeep = level >= this.maxLevel;
    const excess = !this.restSplit[node] || tooDeep;
    if (!excess || (this.pinned[node] && !tooDeep)) return;
    this.pending = true;
    if (leaves < 4 || !quiet) return;
    if (time - this.wantedAt[node] <= this.mergeDelay && !tooDeep) return;
    if (!this.waveReached(level, x, y)) return;
    this.pushMerge(level, x, y, level * 4 - this.waveDelay(level, x, y));
  }

  countCarved(level, x, y) {
    const node = nodeIndex(level, x, y);
    if (this.state[node] !== 2) return 0;
    const childLevel = level + 1;
    const held = this.pinned[node] && !this.restSplit[node];
    let total = 0;
    for (let i = 0; i < 4; i += 1) {
      const childX = x * 2 + CHILD_X[i];
      const childY = y * 2 + CHILD_Y[i];
      const child = nodeIndex(childLevel, childX, childY);
      if (this.state[child] === 1) total += held ? 1 : 0;
      else total += this.countCarved(childLevel, childX, childY);
    }
    return total;
  }

  reportStats(time, force) {
    if (!force && time - this.lastReport < STATS_INTERVAL) return;
    if (this.carveDirty && this.source) {
      this.carved = this.countCarved(0, 0, 0);
      this.carveDirty = false;
    }
    if (this.leafCount === this.reportedLeaves && this.carved === this.reportedCarved) return;
    this.lastReport = time;
    this.reportedLeaves = this.leafCount;
    this.reportedCarved = this.carved;
    this.onStats?.(this.leafCount, this.carved);
  }

  frame() {
    this.raf = 0;
    if (!this.active || this.lost) return;
    const time = this.now();
    const elapsed = time - this.lastFrame;
    const dt = Math.min(1 / 20, Math.max(1 / 240, elapsed));
    this.lastFrame = time;

    this.releaseDue(time);
    this.runDemo(time);
    this.lensStep(time, dt);
    this.followLens(dt);
    this.reconcileStep(time);
    this.reportStats(time, false);

    const animating = time < this.animUntil;
    if (animating || this.needsDraw || this.dirtyMax >= 0) {
      if (this.gl && this.governor.sample(elapsed * 1000)) this.applyResolution(false);
      this.draw(time);
    }

    const statsWaiting = this.leafCount !== this.reportedLeaves || this.carveDirty;
    const busy = animating || this.reconcilePending || this.releaseCount > 0 || this.inside || this.demo || statsWaiting || this.lensSettling;
    if (busy && !this.raf && this.active && !this.lost) this.raf = requestAnimationFrame(this.frame);
  }

  draw(time) {
    this.needsDraw = false;
    this.sampleLook(time);
    if (this.gl) this.drawWebGL(time);
    else this.drawCanvas(time);
    if (!this.painted && this.leafCount > 0) {
      this.painted = true;
      this.onReady?.();
    }
  }

  drawWebGL(time) {
    const gl = this.gl;
    if (!this.program || gl.isContextLost()) return;
    const params = this.params;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(SURFACE[0], SURFACE[1], SURFACE[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.highWater || !params) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.tileBuffer);
    if (this.dirtyMax >= this.dirtyMin) {
      const from = this.dirtyMin;
      const count = this.dirtyMax - from + 1;
      gl.bufferSubData(gl.ARRAY_BUFFER, from * STRIDE, this.data, from * FLOATS, count * FLOATS);
      this.dirtyMin = MAX_TILES;
      this.dirtyMax = -1;
    }

    const scale = this.canvas.width / (this.coverPx + PAD_PX * 2);
    const uniforms = this.uniforms;
    gl.useProgram(this.program);
    gl.uniform1f(uniforms.uTime, time);
    gl.uniform1f(uniforms.uCoverPx, this.coverPx);
    gl.uniform2f(uniforms.uOffsetPx, PAD_PX, PAD_PX);
    gl.uniform2f(uniforms.uCanvasPx, this.coverPx + PAD_PX * 2, this.coverPx + PAD_PX * 2);
    gl.uniform1f(uniforms.uDpr, scale);
    const look = this.lookNow;
    gl.uniform1f(uniforms.uGap, look[0]);
    gl.uniform1f(uniforms.uRadius, look[1]);
    gl.uniform1f(uniforms.uDisc, look[2]);
    gl.uniform1f(uniforms.uOutline, look[3]);
    gl.uniform2f(uniforms.uPointer, this.lensX, this.lensY);
    gl.uniform1f(uniforms.uLensRadius, this.shownLensRadius);
    gl.uniform1f(uniforms.uLensAmount, this.lensAmount);
    gl.uniform1f(uniforms.uReduced, this.reduced ? 1 : 0);
    gl.bindVertexArray(this.vao);
    gl.uniform1f(uniforms.uPass, 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.highWater);
    gl.uniform1f(uniforms.uPass, 1);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.highWater);
    gl.bindVertexArray(null);
  }

  drawCanvas(time) {
    const context = this.context2d;
    if (!context) return;
    const params = this.params;
    const scale = this.canvas.width / (this.coverPx + PAD_PX * 2);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = "rgb(241 245 249)";
    context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.dirtyMin = MAX_TILES;
    this.dirtyMax = -1;
    if (!params) return;
    context.setTransform(scale, 0, 0, scale, PAD_PX * scale, PAD_PX * scale);
    const data = this.data;
    const look = this.lookNow;
    const outline = look[3] > 0.5;
    const disc = look[2] > 0.5;
    for (let slot = 0; slot < this.highWater; slot += 1) {
      const at = slot * FLOATS;
      const size = data[at + 2] * this.coverPx;
      if (size <= 0) continue;
      const kind = data[at + 10];
      const startAt = data[at + 9];
      if (kind === KIND_MERGE_CHILD) continue;
      if (kind === KIND_RETIRE && time >= startAt) continue;
      if ((kind === KIND_SPLIT || kind === KIND_MERGE_PARENT) && time < startAt) continue;
      const before = kind === KIND_RECOLOUR && time < startAt;
      const red = Math.round((before ? data[at + 6] : data[at + 3]) * 255);
      const green = Math.round((before ? data[at + 7] : data[at + 4]) * 255);
      const blue = Math.round((before ? data[at + 8] : data[at + 5]) * 255);
      const tiny = size < 4;
      const gap = tiny ? 0 : look[0] * size;
      const side = size - gap;
      const left = data[at] * this.coverPx + gap / 2;
      const top = data[at + 1] * this.coverPx + gap / 2;
      if (outline) {
        context.strokeStyle = "rgb(26 26 26)";
        context.lineWidth = 0.5;
        context.strokeRect(left + 0.25, top + 0.25, side - 0.5, side - 0.5);
        continue;
      }
      context.fillStyle = `rgb(${red} ${green} ${blue})`;
      const corner = disc ? side / 2 : tiny ? 0 : Math.min(look[1] * size, 12);
      if (corner > 0.5 && context.roundRect) {
        context.beginPath();
        context.roundRect(left, top, side, side, corner);
        context.fill();
      } else {
        context.fillRect(left, top, side, side);
      }
    }
  }

  capture() {
    this.draw(this.now());
    const scale = this.canvas.width / (this.coverPx + PAD_PX * 2);
    const side = Math.round(this.coverPx * scale);
    const offset = Math.round(PAD_PX * scale);
    const output = document.createElement("canvas");
    output.width = side;
    output.height = side;
    const context = output.getContext("2d");
    context.drawImage(this.canvas, offset, offset, side, side, 0, 0, side, side);
    return output.toDataURL("image/png");
  }

  destroy() {
    this.active = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.canvas.removeEventListener("webglcontextlost", this.handleLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleRestored);
    if (this.gl) {
      this.deleteResources();
      this.gl.getExtension("WEBGL_lose_context")?.loseContext();
      this.gl = null;
    }
    this.source = null;
    this.onStats = null;
    this.onReady = null;
  }
}
