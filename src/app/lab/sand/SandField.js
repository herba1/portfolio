import createResolutionGovernor from "@/app/experiments/resolutionGovernor";
import { haptic } from "@/lib/haptics";
import { loadCover, sampleCells } from "./sandCovers";
import {
  LANDED,
  LOOSE,
  createGrid,
  createRandom,
  fillIntact,
  hashCell,
  loosenDisc,
  plowDisc,
  pokeDisc,
  releaseCascade,
  stepGrid,
} from "./sandGrid";
import { FLIGHT_FRAGMENT, FLIGHT_VERTEX, GRID_FRAGMENT, GRID_VERTEX } from "./sandShader";

const TRAY_RATIO = 0.7;
const GRID_CAP_FINE_POINTER = 240;
const GRID_CAP_COARSE_POINTER = 160;
const DPR_CAP_FINE_POINTER = 2;
const DPR_CAP_COARSE_POINTER = 1.5;
const STEP_MS = 1000 / 120;
const MAX_STEPS_PER_FRAME = 4;
const SETTLE_STEPS = 30;

const BRUSH_PX = 22;
const BRUSH_PRESSED_PX = 34;
const BRUSH_FULL_SPEED = 1.2;
const BRUSH_MIN_SPEED = 0.03;
const BRUSH_EASE_RATE = 16;
const LATTICE_BASE = 0.07;

const HOLD_STILL_PX = 8;
const HOLD_DELAY_MS = 140;
const HOLD_FILL_MS = 500;
const HOLD_POP_MS = 240;
const TAP_MS = 260;
const TAP_SLOP_PX = 6;
const POKE_PX = 30;
const POKE_MS = 460;

const FLIGHT_S = 0.7;
const POP_S = 0.18;
const REBUILD_RADIAL_S = 0.25;
const SCATTER_S = 0.15;
const ERUPT_DEPTH_S = 0.4;
const AIRBORNE_SCATTER_S = 0.06;
const HAPTIC_AT = 0.86;
const FUSE_MS = 340;

const CASCADE_MS = 420;
const CASCADE_JITTER_MS = 120;
const CASCADE_GRAVITY = 1.6;
const ERUPT_SETTLED_STEPS = 8;
const ERUPT_BEAT_MS = 150;
const SETTLE_LIMIT_MS = 2600;
const COVER_DEADLINE_MS = CASCADE_MS + CASCADE_JITTER_MS + 2500;

const INTRO_DELAY_MS = 400;
const INTRO_MS = 600;
const INTRO_BRUSH_PX = 44;
const INTRO_CHANCE = 0.78;
const LOOSE_REPORT_MS = 120;

const EMPTY_FALLBACK = [248 / 255, 250 / 255, 252 / 255];
const INK_FALLBACK = [26 / 255, 26 / 255, 26 / 255];
const INTRO_PATH = [
  [1.02, 0.02],
  [0.6, 0.1],
  [0.88, 0.4],
];

const ATTRIBUTES = { aCorner: 0, aPath: 1, aTiming: 2, aColourFrom: 3, aColourTo: 4 };

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log || "shader failed");
  }
  return shader;
}

function link(gl, vertexSource, fragmentSource) {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  for (const [name, location] of Object.entries(ATTRIBUTES)) gl.bindAttribLocation(program, location, name);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(log || "program failed");
  }
  const uniforms = {};
  const total = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let index = 0; index < total; index += 1) {
    const info = gl.getActiveUniform(program, index);
    uniforms[info.name] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms };
}

function makeTexture(gl, filter) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.LINEAR_MIPMAP_LINEAR ? gl.LINEAR : filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function readRgb(text, fallback) {
  const match = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(text || "");
  if (!match) return fallback;
  return [Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255];
}

const easeInOutSine = (t) => 0.5 - Math.cos(Math.PI * t) / 2;

function isAirborne(cells, index, width) {
  const below = index + width;
  return below < cells.length && cells[below] === 0;
}

function bezierPoint(path, t, out) {
  const [a, b, c] = path;
  const u = 1 - t;
  out[0] = u * u * a[0] + 2 * u * t * b[0] + t * t * c[0];
  out[1] = u * u * a[1] + 2 * u * t * b[1] + t * t * c[1];
  return out;
}

export default class SandField {
  constructor({ surface, ring, covers, grainPx, embedded, onCover, onLoose, onReady, onBusy, onError }) {
    const canvas = document.createElement("canvas");
    canvas.className = "sand__canvas";
    canvas.setAttribute("aria-hidden", "true");
    surface.insertBefore(canvas, ring);
    this.canvas = canvas;
    this.surface = surface;
    this.ring = ring;
    this.covers = covers;
    this.grainPx = grainPx;
    this.embedded = embedded;
    this.callbacks = { onCover, onLoose, onReady, onBusy, onError };

    this.coarse = window.matchMedia("(pointer: coarse)").matches;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.dprCap = this.coarse ? DPR_CAP_COARSE_POINTER : DPR_CAP_FINE_POINTER;
    this.gridCap = this.coarse ? GRID_CAP_COARSE_POINTER : GRID_CAP_FINE_POINTER;
    const surfaceStyle = window.getComputedStyle(surface);
    this.emptyRgb = readRgb(surfaceStyle.backgroundColor, EMPTY_FALLBACK);
    this.inkRgb = readRgb(surfaceStyle.color, INK_FALLBACK);
    this.governor = createResolutionGovernor({ max: 1, min: 0.6 });
    this.random = createRandom(0x51ab ^ Math.floor(Math.random() * 0xffffff));

    this.loaded = new Map();
    this.coverIndex = 0;
    this.current = null;
    this.currentCells = null;
    this.coverSlot = 0;

    this.grid = null;
    this.flightPath = null;
    this.flightColour = null;
    this.dirty = true;
    this.stillSteps = 0;
    this.simDebt = 0;
    this.flight = null;
    this.fuse = null;
    this.cascade = null;
    this.script = null;
    this.pokeAt = { x: 0, y: 0, radius: 0, start: -Infinity };
    this.brush = { radius: BRUSH_PX, live: 0 };
    this.pointer = {
      id: -1,
      type: "mouse",
      inside: false,
      down: false,
      x: 0,
      y: 0,
      previousX: 0,
      previousY: 0,
      downX: 0,
      downY: 0,
      downTime: 0,
      travel: 0,
      speed: 0,
      moveTime: 0,
      anchorX: 0,
      anchorY: 0,
      anchorTime: 0,
      holdDone: false,
    };
    this.ringState = "idle";
    this.ringProgress = -1;
    this.scratch = [0, 0];
    this.lastLooseReport = 0;
    this.reportedLoose = -1;
    this.busy = false;
    this.landBeat = 0;

    this.frame = 0;
    this.lastFrame = 0;
    this.onscreen = true;
    this.pageVisible = !document.hidden;
    this.lost = false;
    this.destroyed = false;
    this.timers = new Set();

    this.tick = this.tick.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerCancel = this.handlePointerCancel.bind(this);
    this.handlePointerLeave = this.handlePointerLeave.bind(this);
    this.handleDoubleClick = this.handleDoubleClick.bind(this);
    this.handleContextMenu = this.handleContextMenu.bind(this);
    this.handleVisibility = this.handleVisibility.bind(this);
    this.handleContextLost = this.handleContextLost.bind(this);
    this.handleContextRestored = this.handleContextRestored.bind(this);

    try {
      this.initGl();
    } catch (error) {
      this.destroyed = true;
      queueMicrotask(() => this.callbacks.onError?.(error));
      return;
    }

    surface.addEventListener("pointerdown", this.handlePointerDown);
    surface.addEventListener("pointermove", this.handlePointerMove);
    surface.addEventListener("pointerup", this.handlePointerUp);
    surface.addEventListener("pointercancel", this.handlePointerCancel);
    surface.addEventListener("pointerleave", this.handlePointerLeave);
    surface.addEventListener("dblclick", this.handleDoubleClick);
    surface.addEventListener("contextmenu", this.handleContextMenu);
    document.addEventListener("visibilitychange", this.handleVisibility);
    canvas.addEventListener("webglcontextlost", this.handleContextLost);
    canvas.addEventListener("webglcontextrestored", this.handleContextRestored);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(surface);
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.onscreen = entry.isIntersecting;
      if (this.onscreen) this.wake();
    });
    this.intersectionObserver.observe(surface);

    this.start();
  }

  async start() {
    const first = await this.ensureCover(0);
    if (this.destroyed) return;
    if (!first) {
      this.callbacks.onError?.(new Error("no cover could be loaded"));
      return;
    }
    this.current = first;
    const [red, green, blue] = sampleCells(first, 16).average;
    this.surface.style.setProperty("--sand-average", `rgb(${red} ${green} ${blue})`);
    this.buildGrid();
    this.resize();
    this.uploadCover(this.coverSlot, first);
    this.callbacks.onCover?.(first, 0);
    this.ensureCover(1);
    if (this.reducedMotion) {
      this.runScriptInstantly(INTRO_PATH, INTRO_BRUSH_PX);
      this.settleInstantly();
    }
    this.resize();
    this.render(0);
    this.callbacks.onReady?.();
    this.reportLoose(0, true);
    if (!this.reducedMotion) this.later(INTRO_DELAY_MS, () => this.startScript(INTRO_PATH, INTRO_BRUSH_PX, INTRO_MS));
    this.wake();
  }

  later(ms, run) {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (!this.destroyed) run();
    }, ms);
    this.timers.add(id);
  }

  ensureCover(index) {
    const list = this.covers;
    const wrapped = ((index % list.length) + list.length) % list.length;
    let entry = this.loaded.get(wrapped);
    if (!entry) {
      entry = { ready: null, failed: false, promise: null };
      entry.promise = loadCover(list[wrapped]).then(
        (cover) => {
          entry.ready = cover;
          return cover;
        },
        () => {
          entry.failed = true;
          return null;
        },
      );
      this.loaded.set(wrapped, entry);
    }
    return entry.promise;
  }

  readyCover(index) {
    const list = this.covers;
    const wrapped = ((index % list.length) + list.length) % list.length;
    const entry = this.loaded.get(wrapped);
    if (entry?.failed) return this.current;
    return entry?.ready ?? null;
  }

  initGl() {
    const gl = this.canvas.getContext("webgl2", {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("webgl2 unavailable");
    this.gl = gl;
    this.gridProgram = link(gl, GRID_VERTEX, GRID_FRAGMENT);
    this.flightProgram = link(gl, FLIGHT_VERTEX, FLIGHT_FRAGMENT);
    this.gridVao = gl.createVertexArray();

    this.flightVao = gl.createVertexArray();
    gl.bindVertexArray(this.flightVao);
    this.cornerBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(ATTRIBUTES.aCorner);
    gl.vertexAttribPointer(ATTRIBUTES.aCorner, 2, gl.FLOAT, false, 0, 0);

    this.pathBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pathBuffer);
    gl.enableVertexAttribArray(ATTRIBUTES.aPath);
    gl.vertexAttribPointer(ATTRIBUTES.aPath, 4, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(ATTRIBUTES.aPath, 1);
    gl.enableVertexAttribArray(ATTRIBUTES.aTiming);
    gl.vertexAttribPointer(ATTRIBUTES.aTiming, 2, gl.FLOAT, false, 24, 16);
    gl.vertexAttribDivisor(ATTRIBUTES.aTiming, 1);

    this.colourBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colourBuffer);
    gl.enableVertexAttribArray(ATTRIBUTES.aColourFrom);
    gl.vertexAttribPointer(ATTRIBUTES.aColourFrom, 3, gl.UNSIGNED_BYTE, true, 8, 0);
    gl.vertexAttribDivisor(ATTRIBUTES.aColourFrom, 1);
    gl.enableVertexAttribArray(ATTRIBUTES.aColourTo);
    gl.vertexAttribPointer(ATTRIBUTES.aColourTo, 3, gl.UNSIGNED_BYTE, true, 8, 4);
    gl.vertexAttribDivisor(ATTRIBUTES.aColourTo, 1);
    gl.bindVertexArray(null);

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.stateTexture = makeTexture(gl, gl.NEAREST);
    this.pictureTexture = makeTexture(gl, gl.NEAREST);
    this.coverTextures = [makeTexture(gl, gl.LINEAR_MIPMAP_LINEAR), makeTexture(gl, gl.LINEAR_MIPMAP_LINEAR)];
    this.cellTextures = [makeTexture(gl, gl.NEAREST), makeTexture(gl, gl.NEAREST)];
    this.instanceCapacity = 0;
  }

  gridWidthFor(cssWidth) {
    return Math.max(24, Math.min(this.gridCap, Math.round(cssWidth / this.grainPx)));
  }

  buildGrid() {
    const cssWidth = this.surface.clientWidth || 360;
    const width = this.gridWidthFor(cssWidth);
    const height = Math.round(width / TRAY_RATIO);
    this.grid = createGrid(width, height);
    fillIntact(this.grid);
    const capacity = width * width;
    this.flightPath = new Float32Array(capacity * 6);
    this.flightColour = new Uint8Array(capacity * 8);
    this.flightCells = new Int32Array(capacity);
    this.flightHomes = new Int32Array(capacity);
    this.flightKeys = new Float64Array(capacity);
    this.homeKeys = new Float64Array(capacity);
    this.allocateGpuGrid();
    if (this.current) {
      this.currentCells = sampleCells(this.current, width);
      this.uploadCells(this.coverSlot, this.currentCells);
    }
    this.dirty = true;
    this.stillSteps = 0;
  }

  allocateGpuGrid() {
    const { gl, grid } = this;
    if (!gl || !grid) return;
    gl.bindTexture(gl.TEXTURE_2D, this.stateTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, grid.width, grid.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, grid.bytes);
    gl.bindTexture(gl.TEXTURE_2D, this.pictureTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, grid.width, grid.height, 0, gl.RED, gl.UNSIGNED_BYTE, grid.glued);
    const capacity = grid.cover * grid.cover;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pathBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * 24, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colourBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * 8, gl.DYNAMIC_DRAW);
    this.instanceCapacity = capacity;
  }

  uploadCover(slot, cover) {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.coverTextures[slot]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, cover.canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (this.grid) {
      const cells = sampleCells(cover, this.grid.cover);
      if (cover === this.current) this.currentCells = cells;
      this.uploadCells(slot, cells);
    }
  }

  uploadCells(slot, cells) {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.cellTextures[slot]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cells.size, cells.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, cells.rgba);
  }

  setGrain(px) {
    if (px === this.grainPx) return;
    this.grainPx = px;
    if (!this.grid || this.destroyed) return;
    if (this.flight) this.finishFlight();
    this.cascade = null;
    this.script = null;
    this.fuse = null;
    this.simDebt = 0;
    this.setBusy(false);
    this.buildGrid();
    this.resize();
    this.reportLoose(0, true);
    if (this.reducedMotion) {
      this.runScriptInstantly(INTRO_PATH, INTRO_BRUSH_PX);
      this.settleInstantly();
    } else {
      this.startScript(INTRO_PATH, INTRO_BRUSH_PX, INTRO_MS);
    }
    this.wake();
  }

  handleResize() {
    if (!this.grid || this.destroyed) return;
    const wanted = this.gridWidthFor(this.surface.clientWidth);
    if (Math.abs(wanted - this.grid.width) / this.grid.width > 0.25 && !this.flight && !this.cascade) {
      this.buildGrid();
      this.reportLoose(0, true);
    }
    this.resize();
    this.render(performance.now());
    this.wake();
  }

  resize() {
    const { canvas, surface, grid } = this;
    if (!grid) return;
    const cssWidth = surface.clientWidth;
    const cssHeight = surface.clientHeight;
    if (!cssWidth || !cssHeight) return;
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap) * this.governor.scale;
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    this.dpr = width / cssWidth;
    this.cellCss = cssWidth / grid.width;
    this.cellPx = width / grid.width;
    const gapCss = this.cellCss >= 4 ? 1 : 0.5;
    this.gapCells = (gapCss * this.dpr) / this.cellPx;
    this.dirty = true;
  }

  localPoint(event) {
    const surface = this.surface;
    const rect = surface.getBoundingClientRect();
    return [event.clientX - rect.left - surface.clientLeft, event.clientY - rect.top - surface.clientTop];
  }

  toGridX(x) {
    return x / this.cellCss;
  }

  toGridY(y) {
    return y / this.cellCss;
  }

  handlePointerDown(event) {
    if (!this.grid || (event.pointerType === "mouse" && event.button !== 0)) return;
    const [x, y] = this.localPoint(event);
    const pointer = this.pointer;
    const now = performance.now();
    if (event.pointerType !== "touch") this.surface.setPointerCapture(event.pointerId);
    pointer.id = event.pointerId;
    pointer.type = event.pointerType;
    pointer.down = true;
    pointer.inside = true;
    pointer.x = x;
    pointer.y = y;
    pointer.previousX = x;
    pointer.previousY = y;
    pointer.downX = x;
    pointer.downY = y;
    pointer.downTime = now;
    pointer.travel = 0;
    pointer.speed = 0;
    pointer.moveTime = now;
    pointer.anchorX = x;
    pointer.anchorY = y;
    pointer.anchorTime = now;
    pointer.holdDone = false;
    this.wake();
  }

  handlePointerMove(event) {
    if (!this.grid) return;
    const pointer = this.pointer;
    if (pointer.down && event.pointerId !== pointer.id) return;
    const [x, y] = this.localPoint(event);
    const now = performance.now();
    const distance = Math.hypot(x - pointer.x, y - pointer.y);
    const elapsed = Math.max(4, now - pointer.moveTime);
    if (pointer.inside) pointer.speed = pointer.speed * 0.55 + (distance / elapsed) * 0.45;
    pointer.type = event.pointerType;
    pointer.travel += distance;
    pointer.x = x;
    pointer.y = y;
    pointer.moveTime = now;
    if (!pointer.inside) {
      pointer.previousX = x;
      pointer.previousY = y;
    }
    pointer.inside = true;
    this.wake();
  }

  handlePointerUp(event) {
    const pointer = this.pointer;
    if (!pointer.down || event.pointerId !== pointer.id) return;
    const now = performance.now();
    pointer.down = false;
    if (this.surface.hasPointerCapture?.(event.pointerId)) this.surface.releasePointerCapture(event.pointerId);
    if (event.pointerType !== "mouse") pointer.inside = false;
    const tapped = now - pointer.downTime < TAP_MS && pointer.travel < TAP_SLOP_PX && !pointer.holdDone;
    if (tapped) {
      if (this.embedded) this.rebuild(pointer.x, pointer.y);
      else this.poke(pointer.x, pointer.y);
    }
    if (!pointer.holdDone) this.setRing("idle", 0);
    this.wake();
  }

  handlePointerCancel() {
    this.pointer.down = false;
    this.pointer.inside = false;
    this.setRing("idle", 0);
    this.wake();
  }

  handlePointerLeave(event) {
    if (event.pointerType === "mouse" && !this.pointer.down) {
      this.pointer.inside = false;
      this.wake();
    }
  }

  handleDoubleClick(event) {
    const [x, y] = this.localPoint(event);
    this.rebuild(x, y);
  }

  handleContextMenu(event) {
    if (this.pointer.type !== "mouse") event.preventDefault();
  }

  handleVisibility() {
    this.pageVisible = !document.hidden;
    if (this.pageVisible) this.wake();
  }

  handleContextLost(event) {
    event.preventDefault();
    this.lost = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  handleContextRestored() {
    if (this.destroyed) return;
    this.lost = false;
    try {
      this.initGl();
    } catch (error) {
      this.callbacks.onError?.(error);
      return;
    }
    if (this.flight) this.finishFlight();
    if (this.cascade) this.cascade.stage = 0;
    this.allocateGpuGrid();
    if (this.current) this.uploadCover(this.coverSlot, this.current);
    this.resize();
    this.wake();
  }

  setBusy(busy) {
    if (busy === this.busy) return;
    this.busy = busy;
    this.callbacks.onBusy?.(busy);
  }

  setRing(state, progress) {
    const ring = this.ring;
    if (!ring) return;
    if (state !== this.ringState) {
      this.ringState = state;
      ring.dataset.state = state;
    }
    if (progress !== this.ringProgress) {
      this.ringProgress = progress;
      ring.style.setProperty("--sand-hold", progress.toFixed(3));
    }
  }

  placeRing(x, y) {
    if (this.ring) this.ring.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
  }

  startScript(path, brushPx, duration) {
    if (!this.grid || this.flight || this.cascade) return;
    this.script = { path, brushPx, duration, start: performance.now(), lastX: null, lastY: null };
    this.wake();
  }

  runScriptInstantly(path, brushPx) {
    const grid = this.grid;
    const radius = brushPx / this.grainPxCss();
    const point = this.scratch;
    for (let index = 0; index <= 48; index += 1) {
      bezierPoint(path, index / 48, point);
      loosenDisc(grid, point[0] * grid.cover, point[1] * grid.cover, radius, INTRO_CHANCE, this.random);
    }
    this.dirty = true;
  }

  grainPxCss() {
    return this.cellCss || this.grainPx;
  }

  settleInstantly() {
    let quiet = 0;
    for (let step = 0; step < 4000 && quiet < 12; step += 1) {
      quiet = stepGrid(this.grid, this.random) ? 0 : quiet + 1;
    }
    this.dirty = true;
  }

  updateScript(now) {
    const script = this.script;
    if (!script) return;
    const grid = this.grid;
    const progress = Math.min(1, (now - script.start) / script.duration);
    const point = bezierPoint(script.path, easeInOutSine(progress), this.scratch);
    const x = point[0] * grid.cover;
    const y = point[1] * grid.cover;
    const radius = script.brushPx / this.grainPxCss();
    this.loosenAlong(script.lastX ?? x, script.lastY ?? y, x, y, radius, INTRO_CHANCE);
    script.lastX = x;
    script.lastY = y;
    if (progress >= 1) this.script = null;
  }

  loosenAlong(fromX, fromY, toX, toY, radius, chance) {
    const length = Math.hypot(toX - fromX, toY - fromY);
    const samples = Math.max(1, Math.ceil(length / Math.max(1, radius * 0.5)));
    let freed = 0;
    for (let index = 1; index <= samples; index += 1) {
      const t = index / samples;
      freed += loosenDisc(this.grid, fromX + (toX - fromX) * t, fromY + (toY - fromY) * t, radius, chance, this.random);
    }
    if (freed) {
      this.dirty = true;
      this.stillSteps = 0;
    }
    return freed;
  }

  updatePointer(now) {
    const pointer = this.pointer;
    const grid = this.grid;
    if (now - pointer.moveTime > 60) pointer.speed *= 0.5;
    if (!pointer.down) {
      pointer.previousX = pointer.x;
      pointer.previousY = pointer.y;
      return;
    }
    const idle = this.flight || this.cascade;
    if (!idle && pointer.speed > BRUSH_MIN_SPEED) {
      const chance = Math.min(0.9, Math.max(0.1, pointer.speed / BRUSH_FULL_SPEED));
      const radius = BRUSH_PRESSED_PX / this.cellCss;
      const fromX = this.toGridX(pointer.previousX);
      const fromY = this.toGridY(pointer.previousY);
      const toX = this.toGridX(pointer.x);
      const toY = this.toGridY(pointer.y);
      this.loosenAlong(fromX, fromY, toX, toY, radius, chance);
      const dx = toX - fromX;
      const dy = toY - fromY;
      const length = Math.hypot(dx, dy);
      if (length > 0.3) {
        const stepX = Math.abs(dx) > length * 0.38 ? Math.sign(dx) : 0;
        const stepY = Math.abs(dy) > length * 0.38 ? Math.sign(dy) : 0;
        if (plowDisc(grid, toX, toY, radius * 0.72, stepX, stepY)) {
          this.dirty = true;
          this.stillSteps = 0;
        }
      }
    }
    pointer.previousX = pointer.x;
    pointer.previousY = pointer.y;

    if (Math.hypot(pointer.x - pointer.anchorX, pointer.y - pointer.anchorY) > HOLD_STILL_PX) {
      pointer.anchorX = pointer.x;
      pointer.anchorY = pointer.y;
      pointer.anchorTime = now;
    }
    if (pointer.holdDone) return;
    const held = now - pointer.anchorTime - HOLD_DELAY_MS;
    const canRebuild = !idle && grid.loose > 0;
    if (!canRebuild || held <= 0) {
      if (this.ringState === "hold") this.setRing("idle", 0);
      return;
    }
    const progress = Math.min(1, held / HOLD_FILL_MS);
    this.placeRing(pointer.anchorX, pointer.anchorY);
    this.setRing("hold", progress);
    if (progress >= 1) {
      pointer.holdDone = true;
      this.setRing("pop", 1);
      this.later(HOLD_POP_MS, () => {
        if (this.ringState === "pop") this.setRing("idle", 0);
      });
      this.rebuild(pointer.anchorX, pointer.anchorY);
    }
  }

  updateCascade(now) {
    const cascade = this.cascade;
    if (!cascade) return;
    const grid = this.grid;
    const elapsed = now - cascade.start;
    if (releaseCascade(grid, elapsed, CASCADE_MS, CASCADE_JITTER_MS)) {
      this.dirty = true;
      this.stillSteps = 0;
    }
    if (!cascade.target) {
      cascade.target = this.readyCover(cascade.index) ?? (elapsed >= COVER_DEADLINE_MS ? this.current : null);
    }
    if (cascade.target && cascade.stage < 3) {
      this.prepareStage(cascade);
      return;
    }
    if (elapsed < CASCADE_MS + CASCADE_JITTER_MS) return;
    if (!cascade.releasedAt) cascade.releasedAt = now;
    if (this.stillSteps < ERUPT_SETTLED_STEPS) {
      cascade.settledAt = 0;
      if (now - cascade.releasedAt < SETTLE_LIMIT_MS) return;
    } else if (!cascade.settledAt) {
      cascade.settledAt = now;
    }
    if (cascade.settledAt && now - cascade.settledAt < ERUPT_BEAT_MS) return;
    if (!cascade.target) return;
    this.cascade = null;
    this.erupt(cascade);
  }

  prepareStage(cascade) {
    const { gl, grid } = this;
    const slot = 1 - this.coverSlot;
    const target = cascade.target;
    if (cascade.stage === 0) {
      gl.bindTexture(gl.TEXTURE_2D, this.coverTextures[slot]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, target.canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
    } else if (cascade.stage === 1) {
      cascade.toCells = sampleCells(target, grid.cover);
      this.uploadCells(slot, cascade.toCells);
    } else {
      const { cover } = grid;
      const light = cascade.toCells.light;
      const homeKeys = this.homeKeys;
      const homes = cover * cover;
      for (let home = 0; home < homes; home += 1) {
        homeKeys[home] = light[home] * 16777216 + (home % cover) * 65536 + home;
      }
      homeKeys.subarray(0, homes).sort();
    }
    cascade.stage += 1;
  }

  poke(x, y) {
    if (!this.grid || this.flight || this.cascade) return;
    const gridX = this.toGridX(x);
    const gridY = this.toGridY(y);
    const radius = POKE_PX / this.cellCss;
    pokeDisc(this.grid, gridX, gridY, radius, this.random);
    this.pokeAt = { x: gridX, y: gridY, radius, start: performance.now() };
    this.dirty = true;
    this.stillSteps = 0;
    haptic("tap");
    this.wake();
  }

  crumble() {
    if (!this.grid || this.flight || this.cascade) return;
    const random = this.random;
    const fromLeft = random.unit() < 0.5;
    const edgeX = fromLeft ? -0.02 : 1.02;
    const startY = 0.04 + random.unit() * 0.5;
    const path = [
      [edgeX, startY],
      [0.5 + (random.unit() - 0.5) * 0.3, startY + 0.1 + random.unit() * 0.2],
      [fromLeft ? 0.2 + random.unit() * 0.3 : 0.5 + random.unit() * 0.3, Math.min(0.96, startY + 0.3 + random.unit() * 0.2)],
    ];
    if (this.reducedMotion) {
      this.runScriptInstantly(path, INTRO_BRUSH_PX);
      this.stillSteps = 0;
      this.wake();
      return;
    }
    this.startScript(path, INTRO_BRUSH_PX, INTRO_MS);
  }

  rebuild(x, y) {
    const grid = this.grid;
    if (!grid || this.flight || this.cascade || grid.loose === 0) return false;
    this.script = null;
    if (this.reducedMotion) {
      fillIntact(grid);
      this.dirty = true;
      this.land();
      this.reportLoose(performance.now(), true);
      this.wake();
      return true;
    }
    const originX = x === undefined ? grid.width / 2 : this.toGridX(x);
    const originY = y === undefined ? grid.height : this.toGridY(y);
    const reach = Math.max(
      Math.hypot(originX, originY),
      Math.hypot(grid.width - originX, originY),
      Math.hypot(originX, grid.height - originY),
      Math.hypot(grid.width - originX, grid.height - originY),
    );
    const { cells, width } = grid;
    const path = this.flightPath;
    const colour = this.flightColour;
    const rgba = this.currentCells.rgba;
    const cover = grid.cover;
    let count = 0;
    let latest = 0;
    for (let index = 0; index < cells.length && count < this.instanceCapacity; index += 1) {
      const value = cells[index];
      if (value >>> 16 !== LOOSE) continue;
      const x0 = index % width;
      const y0 = (index - x0) / width;
      const homeX = value & 255;
      const homeY = (value >>> 8) & 255;
      const scatter = hashCell(homeX, homeY);
      const delay = isAirborne(cells, index, width)
        ? scatter * AIRBORNE_SCATTER_S
        : (REBUILD_RADIAL_S * Math.hypot(x0 - originX, y0 - originY)) / reach + scatter * SCATTER_S;
      if (delay > latest) latest = delay;
      const at = count * 6;
      path[at] = x0;
      path[at + 1] = y0;
      path[at + 2] = homeX;
      path[at + 3] = homeY;
      path[at + 4] = delay;
      path[at + 5] = scatter;
      const source = (homeY * cover + homeX) * 4;
      const tint = count * 8;
      colour[tint] = rgba[source];
      colour[tint + 1] = rgba[source + 1];
      colour[tint + 2] = rgba[source + 2];
      colour[tint + 4] = rgba[source];
      colour[tint + 5] = rgba[source + 1];
      colour[tint + 6] = rgba[source + 2];
      cells[index] = 0;
      count += 1;
    }
    grid.velocity.fill(0);
    this.launch(count, latest, "rebuild", null, -1);
    return true;
  }

  next() {
    if (!this.grid || this.flight || this.cascade || this.busy || this.destroyed) return;
    const index = (this.coverIndex + 1) % this.covers.length;
    this.ensureCover(index);
    this.ensureCover(index + 1);
    this.script = null;
    if (this.reducedMotion) {
      this.setBusy(true);
      this.ensureCover(index).then((loaded) => {
        if (this.destroyed || !this.grid) return;
        const cover = loaded ?? this.current;
        this.swapCover(cover, index);
        fillIntact(this.grid);
        this.dirty = true;
        this.setBusy(false);
        this.reportLoose(performance.now(), true);
        this.wake();
      });
      return;
    }
    this.cascade = { start: performance.now(), index, target: null, toCells: null, stage: 0, releasedAt: 0, settledAt: 0 };
    this.setBusy(true);
    haptic("press");
    this.wake();
  }

  swapCover(cover, index) {
    const slot = 1 - this.coverSlot;
    this.uploadCover(slot, cover);
    this.coverSlot = slot;
    this.current = cover;
    this.currentCells = sampleCells(cover, this.grid.cover);
    this.coverIndex = index;
    this.callbacks.onCover?.(cover, index);
  }

  erupt(cascade) {
    const grid = this.grid;
    const { cells, glued, width, cover } = grid;
    const nextCover = cascade.target;
    const fromCells = this.currentCells;
    const toCells = cascade.toCells;
    const grainCells = this.flightCells;
    const grainHomes = this.flightHomes;
    const grainKeys = this.flightKeys;
    const capacity = this.instanceCapacity;
    let count = 0;
    let top = Infinity;
    let bottom = -Infinity;
    for (let index = 0; index < cells.length && count < capacity; index += 1) {
      const value = cells[index];
      const pinned = glued[index] !== 0;
      if (value === 0 && !pinned) continue;
      const x0 = index % width;
      const y0 = (index - x0) / width;
      const home = value !== 0 ? ((value >>> 8) & 255) * cover + (value & 255) : y0 * cover + x0;
      grainCells[count] = index;
      grainHomes[count] = home;
      grainKeys[count] = fromCells.light[home] * 16777216 + x0 * 65536 + count;
      if (value === 0 || !isAirborne(cells, index, width)) {
        if (y0 < top) top = y0;
        if (y0 > bottom) bottom = y0;
      }
      count += 1;
      if (value !== 0 && pinned && count < capacity) {
        grainCells[count] = index;
        grainHomes[count] = y0 * cover + x0;
        grainKeys[count] = fromCells.light[y0 * cover + x0] * 16777216 + x0 * 65536 + count;
        count += 1;
      }
    }
    const homes = cover * cover;
    const sortedGrains = grainKeys.subarray(0, count).sort();
    const sortedHomes = this.homeKeys;
    const pairs = Math.min(count, homes);
    const path = this.flightPath;
    const colour = this.flightColour;
    const depth = Math.max(1, bottom - top);
    let latest = 0;
    for (let rank = 0; rank < pairs; rank += 1) {
      const grain = sortedGrains[rank] % 65536;
      const destination = sortedHomes[rank] % 65536;
      const index = grainCells[grain];
      const x0 = index % width;
      const y0 = (index - x0) / width;
      const fromHome = grainHomes[grain];
      const homeX = destination % cover;
      const homeY = (destination - homeX) / cover;
      const scatter = hashCell(homeX, homeY);
      const airborne = cells[index] !== 0 && glued[index] === 0 && isAirborne(cells, index, width);
      const delay = airborne
        ? scatter * AIRBORNE_SCATTER_S
        : (ERUPT_DEPTH_S * Math.max(0, y0 - top)) / depth + scatter * SCATTER_S;
      if (delay > latest) latest = delay;
      const at = rank * 6;
      path[at] = x0;
      path[at + 1] = y0;
      path[at + 2] = homeX;
      path[at + 3] = homeY;
      path[at + 4] = delay;
      path[at + 5] = scatter;
      const source = fromHome * 4;
      const target = destination * 4;
      const tint = rank * 8;
      colour[tint] = fromCells.rgba[source];
      colour[tint + 1] = fromCells.rgba[source + 1];
      colour[tint + 2] = fromCells.rgba[source + 2];
      colour[tint + 4] = toCells.rgba[target];
      colour[tint + 5] = toCells.rgba[target + 1];
      colour[tint + 6] = toCells.rgba[target + 2];
    }
    cells.fill(0);
    glued.fill(0);
    grid.velocity.fill(0);
    this.callbacks.onCover?.(nextCover, cascade.index);
    this.launch(pairs, latest, "next", nextCover, cascade.index);
  }

  launch(count, latest, mode, cover, index) {
    const { gl } = this;
    if (count) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pathBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.flightPath, 0, count * 6);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colourBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.flightColour, 0, count * 8);
    }
    this.flight = {
      start: performance.now(),
      count,
      total: count ? latest + FLIGHT_S + POP_S : 0,
      buzzed: false,
      mode,
      cover,
      index,
    };
    this.dirty = true;
    this.setBusy(true);
    this.wake();
  }

  updateFlight(now) {
    const flight = this.flight;
    if (!flight) return;
    const elapsed = (now - flight.start) / 1000;
    if (!flight.buzzed && elapsed >= flight.total * HAPTIC_AT) {
      flight.buzzed = true;
      haptic("land");
    }
    if (elapsed >= flight.total) this.finishFlight();
  }

  finishFlight() {
    const flight = this.flight;
    if (!flight) return;
    this.flight = null;
    if (flight.mode === "next" && flight.cover) {
      this.coverSlot = 1 - this.coverSlot;
      this.current = flight.cover;
      this.currentCells = sampleCells(flight.cover, this.grid.cover);
      this.coverIndex = flight.index;
      this.ensureCover(flight.index + 1);
    }
    this.fuseLanded(flight.count);
    this.dirty = true;
    this.stillSteps = 0;
    this.land();
    this.setBusy(false);
    this.reportLoose(performance.now(), true);
  }

  fuseLanded(count) {
    const grid = this.grid;
    fillIntact(grid);
    if (!count) return;
    const { glued, width } = grid;
    const path = this.flightPath;
    for (let rank = 0; rank < count; rank += 1) {
      const at = rank * 6;
      glued[path[at + 3] * width + path[at + 2]] = LANDED;
    }
    this.fuse = { start: performance.now() };
  }

  land() {
    this.landBeat = 1 - this.landBeat;
    this.surface.dataset.land = String(this.landBeat);
  }

  reportLoose(now, force) {
    if (!this.grid) return;
    if (!force && now - this.lastLooseReport < LOOSE_REPORT_MS) return;
    const loose = this.grid.loose;
    if (loose === this.reportedLoose) return;
    this.lastLooseReport = now;
    this.reportedLoose = loose;
    this.callbacks.onLoose?.(loose);
  }

  canRun() {
    return !this.destroyed && !this.lost && this.onscreen && this.pageVisible && this.grid;
  }

  wake() {
    if (this.frame || !this.canRun()) return;
    this.frame = requestAnimationFrame(this.tick);
  }

  needsFrame(now) {
    const pointer = this.pointer;
    const brushTarget = this.brushTarget();
    return Boolean(
      this.dirty ||
        this.flight ||
        this.fuse ||
        this.cascade ||
        this.script ||
        pointer.down ||
        this.stillSteps < SETTLE_STEPS ||
        Math.abs(this.brush.live - brushTarget.live) > 0.004 ||
        Math.abs(this.brush.radius - brushTarget.radius) > 0.05 ||
        now - this.pokeAt.start < POKE_MS ||
        this.reportedLoose !== this.grid.loose,
    );
  }

  brushTarget() {
    const pointer = this.pointer;
    const visible = pointer.down || (pointer.inside && pointer.type === "mouse");
    return { live: visible ? 1 : 0, radius: pointer.down ? BRUSH_PRESSED_PX : BRUSH_PX };
  }

  tick(now) {
    this.frame = 0;
    if (!this.canRun()) {
      this.lastFrame = 0;
      return;
    }
    const consecutive = this.lastFrame !== 0;
    const dt = consecutive ? Math.min(48, Math.max(1, now - this.lastFrame)) : 16;
    this.lastFrame = now;
    if (consecutive && this.governor.sample(dt)) this.resize();

    this.updatePointer(now);
    this.updateScript(now);
    this.updateCascade(now);
    if (this.flight) this.simDebt = 0;
    else this.advance(dt);
    this.updateFlight(now);

    const target = this.brushTarget();
    const ease = 1 - Math.exp((-BRUSH_EASE_RATE * dt) / 1000);
    this.brush.live += (target.live - this.brush.live) * ease;
    this.brush.radius += (target.radius - this.brush.radius) * ease;

    this.render(now);
    this.reportLoose(now, false);

    if (this.needsFrame(now)) this.frame = requestAnimationFrame(this.tick);
    else this.lastFrame = 0;
  }

  advance(dt) {
    const gravityScale = this.cascade ? CASCADE_GRAVITY : 1;
    this.simDebt = Math.min(this.simDebt + dt, STEP_MS * MAX_STEPS_PER_FRAME);
    while (this.simDebt >= STEP_MS) {
      this.simDebt -= STEP_MS;
      if (stepGrid(this.grid, this.random, gravityScale)) {
        this.stillSteps = 0;
        this.dirty = true;
      } else {
        this.stillSteps += 1;
      }
    }
  }

  fuseAmount(now) {
    const fuse = this.fuse;
    if (!fuse) return 0;
    const progress = (now - fuse.start) / FUSE_MS;
    if (progress >= 1) {
      this.fuse = null;
      return 0;
    }
    const remaining = 1 - Math.max(0, progress);
    return remaining * remaining * remaining;
  }

  render(now) {
    const { gl, grid } = this;
    if (!gl || !grid || this.lost || !this.cellPx) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    if (this.dirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.stateTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, grid.width, grid.height, gl.RGBA, gl.UNSIGNED_BYTE, grid.bytes);
      gl.bindTexture(gl.TEXTURE_2D, this.pictureTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, grid.width, grid.height, gl.RED, gl.UNSIGNED_BYTE, grid.glued);
      this.dirty = false;
    }

    const gridProgram = this.gridProgram;
    const uniforms = gridProgram.uniforms;
    gl.useProgram(gridProgram.program);
    gl.bindVertexArray(this.gridVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.stateTexture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.coverTextures[this.coverSlot]);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.cellTextures[this.coverSlot]);
    gl.uniform1i(uniforms.uState, 0);
    gl.uniform1i(uniforms.uCover, 1);
    gl.uniform1i(uniforms.uCells, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.pictureTexture);
    gl.uniform1i(uniforms.uPicture, 3);
    gl.uniform2f(uniforms.uGrid, grid.width, grid.height);
    gl.uniform1f(uniforms.uCellPx, this.cellPx);
    gl.uniform1f(uniforms.uGap, this.gapCells);
    gl.uniform1f(uniforms.uDpr, this.dpr);
    gl.uniform1f(uniforms.uLattice, LATTICE_BASE);
    gl.uniform1f(uniforms.uFuse, this.fuseAmount(now));
    gl.uniform3f(uniforms.uEmpty, this.emptyRgb[0], this.emptyRgb[1], this.emptyRgb[2]);
    gl.uniform3f(uniforms.uInk, this.inkRgb[0], this.inkRgb[1], this.inkRgb[2]);
    const pointer = this.pointer;
    gl.uniform4f(
      uniforms.uBrush,
      this.toGridX(pointer.x),
      this.toGridY(pointer.y),
      this.brush.radius / this.cellCss,
      this.brush.live,
    );
    const pokeAge = Math.min(1, (now - this.pokeAt.start) / POKE_MS);
    gl.uniform4f(uniforms.uPoke, this.pokeAt.x, this.pokeAt.y, pokeAge, this.pokeAt.radius);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const flight = this.flight;
    if (flight) {
      const flightProgram = this.flightProgram;
      const flightUniforms = flightProgram.uniforms;
      gl.useProgram(flightProgram.program);
      gl.bindVertexArray(this.flightVao);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform2f(flightUniforms.uGrid, grid.width, grid.height);
      gl.uniform1f(flightUniforms.uTime, (now - flight.start) / 1000);
      gl.uniform1f(flightUniforms.uDuration, FLIGHT_S);
      gl.uniform1f(flightUniforms.uPop, POP_S);
      gl.uniform1f(flightUniforms.uCellPx, this.cellPx);
      gl.uniform1f(flightUniforms.uGap, this.gapCells);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, flight.count);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }

  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const id of this.timers) window.clearTimeout(id);
    this.timers.clear();
    if (this.torn) return;
    this.torn = true;
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    const surface = this.surface;
    surface.removeEventListener("pointerdown", this.handlePointerDown);
    surface.removeEventListener("pointermove", this.handlePointerMove);
    surface.removeEventListener("pointerup", this.handlePointerUp);
    surface.removeEventListener("pointercancel", this.handlePointerCancel);
    surface.removeEventListener("pointerleave", this.handlePointerLeave);
    surface.removeEventListener("dblclick", this.handleDoubleClick);
    surface.removeEventListener("contextmenu", this.handleContextMenu);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
    const gl = this.gl;
    this.canvas.remove();
    if (!gl) return;
    gl.deleteProgram(this.gridProgram?.program);
    gl.deleteProgram(this.flightProgram?.program);
    gl.deleteVertexArray(this.gridVao);
    gl.deleteVertexArray(this.flightVao);
    gl.deleteBuffer(this.cornerBuffer);
    gl.deleteBuffer(this.pathBuffer);
    gl.deleteBuffer(this.colourBuffer);
    gl.deleteTexture(this.stateTexture);
    gl.deleteTexture(this.pictureTexture);
    for (const texture of this.coverTextures ?? []) gl.deleteTexture(texture);
    for (const texture of this.cellTextures ?? []) gl.deleteTexture(texture);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
  }
}
