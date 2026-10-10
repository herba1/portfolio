import createResolutionGovernor from "@/app/experiments/resolutionGovernor";
import { haptic } from "@/lib/haptics";
import { loadCover, sampleCells } from "./sandCovers";
import {
  LANDED,
  LOOSE,
  PICTURE,
  createGrid,
  createRandom,
  fillIntact,
  hashCell,
  loosenDisc,
  plowDisc,
  pokeDisc,
  releaseCascade,
  stepGrid,
  strataHomes,
} from "./sandGrid";
import {
  PATH_STRIDE,
  REGION_COUNT,
  createFlightScratch,
  orderByLanding,
  regionOf,
  scheduleLandings,
} from "./sandFlight";
import { createMorphScratch, curveOrder, fieldNoise, pictureOrder, planMorph } from "./sandMorph";
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
const HOLD_RELEASE_MS = 380;
const TAP_MS = 260;
const TAP_SLOP_PX = 6;
const POKE_PX = 30;
const POKE_LIFT_PX = 18;
const POKE_MS = 460;
const DOUBLE_CLICK_MS = 320;

const MORPH_FLIGHT_MIN_S = 1.2;
const MORPH_FLIGHT_RANGE_S = 1.0;
const HOME_FLIGHT_MIN_S = 1.05;
const HOME_FLIGHT_RANGE_S = 0.75;
const REST_S = 0.12;
const CLUMP_SIZE = 0.075;
const SWIRL_REACH = 0.03;
const SWIRL_SIZE = 0.3;
const FLIGHT_LIFT = 0.06;
const FLIGHT_SWELL = 0.1;
const FRONT_NOISE_SIZE = 0.24;
const LOOSEN_MS = 420;
const STAGE_DELAY_MS = 900;
const STAGE_IDLE_TIMEOUT_MS = 2000;
const STAGE_IDLE_FALLBACK_MS = 32;
const LOOSEN_WAIT_MS = 1500;
const CLUMP_TILE = 0.08;
const CLUMP_WARP = 1.1;
const CLUMP_COHESION = 0.5;
const HAPTIC_AT = 0.86;
const FUSE_MS = 900;

const CASCADE_MS = 1000;
const CASCADE_JITTER_MS = 16;
const CASCADE_GRAVITY = 1.3;
const ERUPT_SETTLED_STEPS = 8;
const ERUPT_BEAT_MS = 240;
const SETTLE_LIMIT_MS = 2600;
const COVER_DEADLINE_MS = CASCADE_MS + CASCADE_JITTER_MS + 2500;

const INTRO_DELAY_MS = 1400;
const INTRO_MS = 1300;
const CRUMBLE_MS = 600;
const INTRO_BRUSH_PX = 44;
const INTRO_CHANCE = 0.72;
const LOOSE_REPORT_MS = 120;
const LANDING_BUCKETS = 48;

const EMPTY_FALLBACK = [248 / 255, 250 / 255, 252 / 255];
const INK_FALLBACK = [26 / 255, 26 / 255, 26 / 255];
const INTRO_PATH = [
  [1.02, 0.02],
  [0.6, 0.1],
  [0.88, 0.4],
];

const ATTRIBUTES = { aCorner: 0, aPath: 1, aTiming: 2, aColourFrom: 3, aColourTo: 4, aClump: 5, aClumpTime: 6 };

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
    this.flightData = null;
    this.dirty = true;
    this.stillSteps = 0;
    this.simDebt = 0;
    this.flight = null;
    this.fuse = null;
    this.cascade = null;
    this.loosen = null;
    this.staged = null;
    this.script = null;
    this.pokeAt = { x: 0, y: 0, radius: 0, start: -Infinity };
    this.lastMouseTap = -Infinity;
    this.landingBuckets = new Uint32Array(LANDING_BUCKETS);
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
      shift: false,
    };
    this.ringState = "idle";
    this.ringProgress = -1;
    this.scratch = [0, 0];
    this.lastLooseReport = 0;
    this.reportedLoose = -1;
    this.busy = false;

    this.frame = 0;
    this.lastFrame = 0;
    this.onscreen = true;
    this.pageVisible = !document.hidden;
    this.lost = false;
    this.destroyed = false;
    this.timers = new Set();
    this.idles = new Set();

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
    this.scheduleStage();
    if (this.reducedMotion) {
      this.runScriptInstantly(INTRO_PATH, INTRO_BRUSH_PX);
      this.settleInstantly();
    }
    this.resize();
    this.render(0);
    this.callbacks.onReady?.();
    this.reportLoose(0, true);
    if (!this.reducedMotion) this.later(INTRO_DELAY_MS, () => this.startIntro());
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
    gl.vertexAttribPointer(ATTRIBUTES.aPath, 4, gl.FLOAT, false, PATH_STRIDE * 4, 0);
    gl.vertexAttribDivisor(ATTRIBUTES.aPath, 1);
    gl.enableVertexAttribArray(ATTRIBUTES.aTiming);
    gl.vertexAttribPointer(ATTRIBUTES.aTiming, 3, gl.FLOAT, false, PATH_STRIDE * 4, 16);
    gl.vertexAttribDivisor(ATTRIBUTES.aTiming, 1);
    gl.enableVertexAttribArray(ATTRIBUTES.aClump);
    gl.vertexAttribPointer(ATTRIBUTES.aClump, 4, gl.FLOAT, false, PATH_STRIDE * 4, 28);
    gl.vertexAttribDivisor(ATTRIBUTES.aClump, 1);
    gl.enableVertexAttribArray(ATTRIBUTES.aClumpTime);
    gl.vertexAttribPointer(ATTRIBUTES.aClumpTime, 2, gl.FLOAT, false, PATH_STRIDE * 4, 44);
    gl.vertexAttribDivisor(ATTRIBUTES.aClumpTime, 1);

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
    this.flightCells = new Int32Array(capacity);
    this.flightHomes = new Int32Array(capacity);
    this.clumpTile = Math.max(4, Math.round(width * CLUMP_TILE));
    this.clumpAcross = Math.ceil(width / this.clumpTile) + 1;
    this.clumpDown = Math.ceil(height / this.clumpTile) + 1;
    this.clumpTiles = this.clumpAcross * this.clumpDown;
    this.airborneClumps = this.clumpTiles * REGION_COUNT;
    this.clumpSlots = this.airborneClumps * 2;
    this.flightData = createFlightScratch(capacity, this.clumpSlots);
    this.measureClumps(width, height);
    this.toneKeys = new Float64Array(capacity);
    this.spotKeys = new Float64Array(capacity);
    this.strataHomes = new Uint16Array(capacity);
    this.curve = curveOrder(width, height);
    this.homeOrder = pictureOrder(this.curve, width);
    this.morph = createMorphScratch(capacity);
    this.staged = null;
    this.allocateGpuGrid();
    if (this.current) {
      this.currentCells = sampleCells(this.current, width);
      this.uploadCells(this.coverSlot, this.currentCells);
    }
    this.dirty = true;
    this.stillSteps = 0;
  }

  measureClumps(width, height) {
    const size = this.clumpTile;
    const across = this.clumpAcross;
    const down = this.clumpDown;
    const warp = size * CLUMP_WARP;
    const tileScale = 1 / size;
    const noiseScale = 1 / Math.max(4, width * CLUMP_SIZE);
    const cellTile = new Int32Array(width * height);
    const cellNoise = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const warpedX = x + (fieldNoise(x * tileScale + 17.3, y * tileScale) - 0.5) * warp;
        const warpedY = y + (fieldNoise(x * tileScale, y * tileScale + 41.9) - 0.5) * warp;
        const column = Math.min(across - 1, Math.max(0, Math.floor(warpedX / size)));
        const row = Math.min(down - 1, Math.max(0, Math.floor(warpedY / size)));
        cellTile[index] = row * across + column;
        cellNoise[index] = fieldNoise(x * noiseScale, y * noiseScale);
      }
    }
    const coverHash = new Float32Array(width * width);
    const coverRegion = new Uint8Array(width * width);
    const frontNoise = new Float32Array(width * width);
    const frontScale = 1 / Math.max(4, width * FRONT_NOISE_SIZE);
    for (let y = 0; y < width; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const home = y * width + x;
        coverHash[home] = hashCell(x, y);
        coverRegion[home] = regionOf(x, y, width);
        frontNoise[home] = fieldNoise(x * frontScale + 7.1, y * frontScale + 3.7);
      }
    }
    this.cellTile = cellTile;
    this.cellNoise = cellNoise;
    this.coverHash = coverHash;
    this.coverRegion = coverRegion;
    this.frontNoise = frontNoise;
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
    gl.bufferData(gl.ARRAY_BUFFER, capacity * PATH_STRIDE * 4, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colourBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, capacity * 8, gl.DYNAMIC_DRAW);
    this.instanceCapacity = capacity;
  }

  uploadCoverTexture(slot, cover) {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.coverTextures[slot]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, cover.canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  uploadCover(slot, cover) {
    this.uploadCoverTexture(slot, cover);
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
    this.loosen = null;
    this.setRing("idle", 0);
    this.setBusy(false);
    this.resetTray();
  }

  resetTray() {
    this.script = null;
    this.fuse = null;
    this.simDebt = 0;
    this.buildGrid();
    this.resize();
    this.reportLoose(0, true);
    if (this.reducedMotion) {
      this.runScriptInstantly(INTRO_PATH, INTRO_BRUSH_PX);
      this.settleInstantly();
    } else {
      this.startScript(INTRO_PATH, INTRO_BRUSH_PX, INTRO_MS);
    }
    this.scheduleStage();
    this.wake();
  }

  occupied() {
    return Boolean(this.flight || this.cascade || this.loosen);
  }

  whenIdle(run) {
    if (typeof window.requestIdleCallback !== "function") {
      this.later(STAGE_IDLE_FALLBACK_MS, run);
      return;
    }
    const id = window.requestIdleCallback(
      () => {
        this.idles.delete(id);
        if (!this.destroyed) run();
      },
      { timeout: STAGE_IDLE_TIMEOUT_MS },
    );
    this.idles.add(id);
  }

  scheduleStage() {
    this.later(STAGE_DELAY_MS, () => this.whenIdle(() => this.stageNext(false)));
  }

  stageNext(urgent) {
    if (!this.grid || !this.gl || this.lost || this.destroyed) return;
    if (!urgent && this.occupied()) return;
    if (!urgent && this.pointer.down) {
      this.scheduleStage();
      return;
    }
    const index = this.nextIndex();
    const cover = this.readyCover(index);
    if (!cover) {
      if (urgent) return;
      this.ensureCover(index).then(() => {
        if (!this.destroyed && this.readyCover(index)) this.whenIdle(() => this.stageNext(false));
      });
      return;
    }
    const staged = this.staged;
    if (!this.stagedMatches(staged, index, cover)) {
      const slot = 1 - this.coverSlot;
      this.uploadCoverTexture(slot, cover);
      this.staged = { index, cover, slot, size: this.grid.cover, cells: null };
      if (!urgent) this.whenIdle(() => this.stageNext(false));
      return;
    }
    if (staged.cells) return;
    staged.cells = sampleCells(cover, staged.size);
    this.uploadCells(staged.slot, staged.cells);
  }

  stagedMatches(staged, index, cover) {
    if (!staged || !this.grid) return false;
    return (
      staged.index === index &&
      staged.cover === cover &&
      staged.slot === 1 - this.coverSlot &&
      staged.size === this.grid.cover
    );
  }

  stagedFor(index) {
    const staged = this.staged;
    if (!staged?.cells || !this.stagedMatches(staged, index, staged.cover)) return null;
    return staged;
  }

  handleResize() {
    if (!this.grid || this.destroyed) return;
    const wanted = this.gridWidthFor(this.surface.clientWidth);
    if (Math.abs(wanted - this.grid.width) / this.grid.width > 0.25 && !this.occupied()) {
      this.resetTray();
      return;
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
    pointer.shift = event.shiftKey;
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
    pointer.shift = event.shiftKey;
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
      const mouse = event.pointerType === "mouse";
      const repeat = mouse && (event.detail > 1 || now - this.lastMouseTap < DOUBLE_CLICK_MS);
      if (mouse) this.lastMouseTap = repeat ? -Infinity : now;
      if (this.embedded) this.rebuild(pointer.x);
      else if (!repeat) this.poke(pointer.x, pointer.y);
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
    const [x] = this.localPoint(event);
    this.pokeAt.start = -Infinity;
    this.rebuild(x);
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
    if (this.loosen) {
      this.loosen = null;
      this.setRing("idle", 0);
      this.setBusy(false);
    }
    this.staged = null;
    this.allocateGpuGrid();
    if (this.current) this.uploadCover(this.coverSlot, this.current);
    this.resize();
    if (!this.cascade) this.scheduleStage();
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

  startIntro() {
    if (this.pointer.down || !this.grid || this.grid.loose > 0) return;
    this.startScript(INTRO_PATH, INTRO_BRUSH_PX, INTRO_MS);
  }

  startScript(path, brushPx, duration) {
    if (!this.grid || this.occupied()) return;
    this.script = { path, brushPx, duration, start: null, lastX: null, lastY: null };
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
    if (script.start === null) script.start = now;
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
    const idle = this.occupied();
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
      if (pointer.shift) this.restore(pointer.anchorX);
      else this.rebuild(pointer.anchorX);
      if (!this.loosen?.waiting) this.releaseRing();
    }
  }

  releaseRing() {
    this.setRing("release", 1);
    this.later(HOLD_RELEASE_MS, () => {
      if (this.ringState === "release") this.setRing("idle", 0);
    });
  }

  updateCascade(now) {
    const cascade = this.cascade;
    if (!cascade) return;
    const grid = this.grid;
    const elapsed = now - cascade.start;
    if (!cascade.gathered && releaseCascade(grid, elapsed, CASCADE_MS, CASCADE_JITTER_MS, cascade.phase, this.strataHomes)) {
      this.dirty = true;
      this.stillSteps = 0;
    }
    if (!cascade.target) {
      cascade.target = this.readyCover(cascade.index) ?? (elapsed >= COVER_DEADLINE_MS ? this.current : null);
    }
    if (cascade.target && cascade.stage < 2) {
      this.prepareStage(cascade);
      return;
    }
    if (elapsed < CASCADE_MS + CASCADE_JITTER_MS || !cascade.target) return;
    if (!cascade.releasedAt) cascade.releasedAt = now;
    if (!cascade.gathered) {
      const settled = this.stillSteps >= ERUPT_SETTLED_STEPS;
      if (!settled && now - cascade.releasedAt < SETTLE_LIMIT_MS) return;
      this.gatherPile(cascade);
      if (settled) cascade.settledAt = now;
      return;
    }
    if (!cascade.plan) cascade.plan = this.createPlan(cascade.count, cascade.toCells, this.grid.width / 2);
    if (!cascade.plan.ready) {
      this.stepPlan(cascade.plan);
      return;
    }
    if (cascade.settledAt && now - cascade.settledAt < ERUPT_BEAT_MS) return;
    this.cascade = null;
    this.erupt(cascade);
  }

  gatherGrains() {
    const { cells, glued, cover } = this.grid;
    const curve = this.curve;
    const grainCells = this.flightCells;
    const grainHomes = this.flightHomes;
    const capacity = this.instanceCapacity;
    let count = 0;
    for (let rank = 0; rank < curve.length && count < capacity; rank += 1) {
      const index = curve[rank];
      const value = cells[index];
      const pinned = glued[index] !== 0;
      if (value === 0 && !pinned) continue;
      if (pinned) {
        grainCells[count] = index;
        grainHomes[count] = index;
        count += 1;
      }
      if (value !== 0 && count < capacity) {
        grainCells[count] = index;
        grainHomes[count] = ((value >>> 8) & 255) * cover + (value & 255);
        count += 1;
      }
    }
    return count;
  }

  matchGrains(count, toCells) {
    return planMorph(this.morph, count, this.flightHomes, this.currentCells.tone, this.homeOrder, toCells.tone);
  }

  gatherPile(cascade) {
    const count = this.gatherGrains();
    this.matchGrains(count, cascade.toCells);
    cascade.gathered = true;
    cascade.count = count;
    this.simDebt = 0;
  }

  prepareStage(cascade) {
    const target = cascade.target;
    const staged = this.staged;
    const matches = this.stagedMatches(staged, cascade.index, target);
    if (matches && staged.cells) {
      cascade.toCells = staged.cells;
      cascade.stage = 2;
      return;
    }
    if (matches && cascade.stage === 0) cascade.stage = 1;
    this.staged = null;
    const slot = 1 - this.coverSlot;
    if (cascade.stage === 0) {
      this.uploadCoverTexture(slot, target);
    } else {
      cascade.toCells = sampleCells(target, this.grid.cover);
      this.uploadCells(slot, cascade.toCells);
    }
    cascade.stage += 1;
  }

  poke(x, y) {
    if (!this.grid || this.occupied()) return;
    const gridX = this.toGridX(x);
    const gridY = this.toGridY(y);
    const radius = POKE_PX / this.cellCss;
    const lift = Math.max(2, Math.round(POKE_LIFT_PX / this.cellCss));
    pokeDisc(this.grid, gridX, gridY, radius, lift, this.random);
    this.pokeAt = { x: gridX, y: gridY, radius, start: performance.now() };
    this.dirty = true;
    this.stillSteps = 0;
    haptic("tap");
    this.wake();
  }

  crumble() {
    if (!this.grid || this.occupied()) return;
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
    this.startScript(path, INTRO_BRUSH_PX, CRUMBLE_MS);
  }

  nextIndex() {
    return (this.coverIndex + 1) % this.covers.length;
  }

  originFor(x) {
    return x === undefined ? this.grid.width / 2 : this.toGridX(x);
  }

  canPour() {
    const grid = this.grid;
    return Boolean(grid && !this.occupied() && !this.busy && !this.destroyed && grid.loose > 0);
  }

  rebuild(x) {
    if (!this.canPour()) return false;
    const grid = this.grid;
    this.script = null;
    const index = this.nextIndex();
    if (this.reducedMotion) {
      this.advanceInstantly(index);
      return true;
    }
    this.ensureCover(index);
    const originX = this.originFor(x);
    const staged = this.stagedFor(index);
    const { glued } = grid;
    const homes = grid.cover * grid.cover;
    for (let cell = 0; cell < homes; cell += 1) {
      if (glued[cell] === PICTURE) glued[cell] = LANDED;
    }
    this.fuse = null;
    this.loosen = { start: performance.now(), originX, index, staged, waiting: !staged, count: 0, plan: null };
    this.dirty = true;
    this.setBusy(true);
    haptic("press");
    this.wake();
    return true;
  }

  restore(x) {
    if (!this.canPour()) return false;
    this.script = null;
    if (this.reducedMotion) {
      fillIntact(this.grid);
      this.dirty = true;
      this.stillSteps = 0;
      this.reportLoose(performance.now(), true);
      this.wake();
      return true;
    }
    haptic("press");
    return this.returnHome(this.originFor(x));
  }

  updateLoosen(now) {
    const loosen = this.loosen;
    if (!loosen) return;
    if (loosen.waiting) {
      this.stageNext(true);
      loosen.staged = this.stagedFor(loosen.index);
      if (loosen.staged) {
        loosen.waiting = false;
        if (this.ringState === "hold") this.releaseRing();
      } else if (now - loosen.start >= LOOSEN_WAIT_MS) {
        this.loosen = null;
        this.fuse = { start: now };
        if (this.ringState === "hold") this.releaseRing();
        this.returnHome(loosen.originX);
        return;
      }
    }
    if (loosen.waiting || now - loosen.start < LOOSEN_MS) return;
    if (this.stagedFor(loosen.staged.index) !== loosen.staged) {
      this.loosen = null;
      this.fuse = { start: now };
      this.dirty = true;
      this.setBusy(false);
      return;
    }
    if (!loosen.count) {
      loosen.count = this.gatherGrains();
      this.matchGrains(loosen.count, loosen.staged.cells);
      return;
    }
    if (!loosen.plan) loosen.plan = this.createPlan(loosen.count, loosen.staged.cells, loosen.originX);
    if (!loosen.plan.ready) {
      this.stepPlan(loosen.plan);
      return;
    }
    this.loosen = null;
    this.morphInto(loosen);
  }

  loosenAmount(now) {
    return easeInOutSine(Math.min(1, Math.max(0, (now - this.loosen.start) / LOOSEN_MS)));
  }

  morphInto({ staged, plan }) {
    this.clearTray();
    this.callbacks.onCover?.(staged.cover, staged.index);
    this.launch(plan.written, plan.latest, "next", staged.cover, staged.index);
  }

  createPlan(count, toCells, originX) {
    return { count, toCells, originX, stage: 0, written: 0, latest: 0, ready: false };
  }

  stepPlan(plan) {
    if (plan.stage === 0) {
      plan.written = this.writeMorphFlight(plan.count, plan.toCells);
    } else if (plan.stage === 1) {
      plan.latest = this.scheduleFlight(plan.written, plan.originX, MORPH_FLIGHT_MIN_S, MORPH_FLIGHT_RANGE_S);
    } else {
      orderByLanding(this.flightData, plan.written, plan.latest);
      plan.ready = true;
    }
    plan.stage += 1;
  }

  scheduleFlight(count, originX, shortest, range) {
    const { width, height, cover } = this.grid;
    return scheduleLandings(this.flightData, count, {
      cover,
      diagonal: Math.hypot(width, height),
      originX,
      frontNoise: this.frontNoise,
      airborneFrom: this.airborneClumps,
      slots: this.clumpSlots,
      flightFor: (span) => shortest + range * Math.sqrt(Math.min(1, span)),
    });
  }

  clumpOf(index, home, airborne) {
    return (this.cellTile[index] + (airborne ? this.clumpTiles : 0)) * REGION_COUNT + this.coverRegion[home];
  }

  writeMorphFlight(count, toCells) {
    const { cells, width, cover } = this.grid;
    const targets = this.morph.targets;
    const grainCells = this.flightCells;
    const grainHomes = this.flightHomes;
    const { path, colour, clumps } = this.flightData;
    const cellNoise = this.cellNoise;
    const coverHash = this.coverHash;
    const fromRgba = this.currentCells.rgba;
    const toRgba = toCells.rgba;
    let written = 0;
    for (let grain = 0; grain < count; grain += 1) {
      const destination = targets[grain];
      if (destination < 0) continue;
      const index = grainCells[grain];
      const x0 = index % width;
      const homeX = destination % cover;
      const airborne = cells[index] !== 0 && isAirborne(cells, index, width);
      clumps[written] = this.clumpOf(index, destination, airborne);
      const at = written * PATH_STRIDE;
      path[at] = x0;
      path[at + 1] = (index - x0) / width;
      path[at + 2] = homeX;
      path[at + 3] = (destination - homeX) / cover;
      path[at + 4] = cellNoise[index];
      path[at + 5] = coverHash[destination];
      const source = grainHomes[grain] * 4;
      const target = destination * 4;
      const tint = written * 8;
      colour[tint] = fromRgba[source];
      colour[tint + 1] = fromRgba[source + 1];
      colour[tint + 2] = fromRgba[source + 2];
      colour[tint + 4] = toRgba[target];
      colour[tint + 5] = toRgba[target + 1];
      colour[tint + 6] = toRgba[target + 2];
      written += 1;
    }
    return written;
  }

  clearTray() {
    const grid = this.grid;
    grid.cells.fill(0);
    grid.glued.fill(0);
    grid.velocity.fill(0);
    grid.drift.fill(0);
  }

  returnHome(originX) {
    const grid = this.grid;
    const { cells, width, cover } = grid;
    const { path, colour, clumps } = this.flightData;
    const cellNoise = this.cellNoise;
    const coverHash = this.coverHash;
    const rgba = this.currentCells.rgba;
    let count = 0;
    for (let index = 0; index < cells.length && count < this.instanceCapacity; index += 1) {
      const value = cells[index];
      if (value >>> 16 !== LOOSE) continue;
      const x0 = index % width;
      const homeX = value & 255;
      const homeY = (value >>> 8) & 255;
      const home = homeY * cover + homeX;
      clumps[count] = this.clumpOf(index, home, isAirborne(cells, index, width));
      const at = count * PATH_STRIDE;
      path[at] = x0;
      path[at + 1] = (index - x0) / width;
      path[at + 2] = homeX;
      path[at + 3] = homeY;
      path[at + 4] = cellNoise[index];
      path[at + 5] = coverHash[home];
      const source = home * 4;
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
    const latest = this.scheduleFlight(count, originX, HOME_FLIGHT_MIN_S, HOME_FLIGHT_RANGE_S);
    orderByLanding(this.flightData, count, latest);
    this.launch(count, latest, "rebuild", null, -1);
    return true;
  }

  advanceInstantly(index) {
    this.setBusy(true);
    this.ensureCover(index).then((loaded) => {
      if (this.destroyed || !this.grid) return;
      const cover = loaded ?? this.current;
      this.swapCover(cover, index);
      fillIntact(this.grid);
      this.dirty = true;
      this.setBusy(false);
      this.reportLoose(performance.now(), true);
      this.scheduleStage();
      this.wake();
    });
  }

  next() {
    if (!this.grid || this.occupied() || this.busy || this.destroyed) return;
    const index = this.nextIndex();
    this.ensureCover(index);
    this.ensureCover(index + 1);
    this.script = null;
    if (this.reducedMotion) {
      this.advanceInstantly(index);
      return;
    }
    const phase = this.random.unit() * Math.PI * 2;
    strataHomes(this.currentCells.light, this.grid.cover, this.strataHomes, this.toneKeys, this.spotKeys, phase);
    this.cascade = {
      start: performance.now(),
      index,
      target: null,
      toCells: null,
      stage: 0,
      releasedAt: 0,
      settledAt: 0,
      phase,
      gathered: false,
      plan: null,
      count: 0,
    };
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
    this.staged = null;
    this.callbacks.onCover?.(cover, index);
  }

  erupt(cascade) {
    const { plan } = cascade;
    this.clearTray();
    this.callbacks.onCover?.(cascade.target, cascade.index);
    this.launch(plan.written, plan.latest, "next", cascade.target, cascade.index);
  }

  bucketLandings(count, latest) {
    const buckets = this.landingBuckets;
    const path = this.flightData.path;
    const span = Math.max(latest, 0.001);
    buckets.fill(0);
    for (let rank = 0; rank < count; rank += 1) {
      const at = rank * PATH_STRIDE;
      const bucket = Math.min(LANDING_BUCKETS - 1, Math.floor(((path[at + 4] + path[at + 6]) / span) * LANDING_BUCKETS));
      buckets[bucket] += 1;
    }
    for (let bucket = 1; bucket < LANDING_BUCKETS; bucket += 1) buckets[bucket] += buckets[bucket - 1];
  }

  launch(count, latest, mode, cover, index) {
    const { gl } = this;
    this.bucketLandings(count, latest);
    if (count) {
      const { path, colour } = this.flightData;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pathBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, path, 0, count * PATH_STRIDE);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colourBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, colour, 0, count * 8);
    }
    this.flight = {
      start: performance.now(),
      count,
      total: count ? latest + REST_S : 0,
      latest: Math.max(latest, 0.001),
      startLoose: this.grid.loose,
      buzzed: false,
      mode,
      cover,
      index,
      seed: this.random.unit() * 64,
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
    if (elapsed >= flight.total) {
      this.finishFlight();
      return;
    }
    if (!flight.count) return;
    const reached = Math.floor((elapsed / flight.latest) * LANDING_BUCKETS);
    const landed = reached <= 0 ? 0 : this.landingBuckets[Math.min(LANDING_BUCKETS, reached) - 1];
    this.grid.loose = Math.round(flight.startLoose * (1 - landed / flight.count));
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
      this.staged = null;
      this.ensureCover(flight.index + 1);
    }
    this.fuseLanded(flight.count);
    this.dirty = true;
    this.stillSteps = 0;
    this.setBusy(false);
    this.reportLoose(performance.now(), true);
    this.scheduleStage();
  }

  fuseLanded(count) {
    const grid = this.grid;
    fillIntact(grid);
    if (!count) return;
    const { glued, width } = grid;
    const path = this.flightData.path;
    for (let rank = 0; rank < count; rank += 1) {
      const at = rank * PATH_STRIDE;
      glued[path[at + 3] * width + path[at + 2]] = LANDED;
    }
    this.fuse = { start: performance.now() };
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
        this.loosen ||
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
    this.updateLoosen(now);
    if (this.flight || this.cascade?.gathered || this.loosen?.count) this.simDebt = 0;
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
    return 1 - easeInOutSine(Math.max(0, progress));
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
    gl.uniform1f(uniforms.uFuse, this.loosen ? this.loosenAmount(now) : this.fuseAmount(now));
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
      gl.uniform1f(flightUniforms.uLift, FLIGHT_LIFT);
      gl.uniform1f(flightUniforms.uSwell, FLIGHT_SWELL);
      gl.uniform1f(flightUniforms.uSwirl, grid.cover * SWIRL_REACH);
      gl.uniform1f(flightUniforms.uSwirlScale, grid.cover * SWIRL_SIZE);
      gl.uniform1f(flightUniforms.uSeed, flight.seed);
      gl.uniform1f(flightUniforms.uCohesion, CLUMP_COHESION);
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
    for (const id of this.idles) window.cancelIdleCallback?.(id);
    this.idles.clear();
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
