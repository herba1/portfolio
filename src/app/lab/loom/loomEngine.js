import createResolutionGovernor from "@/app/experiments/resolutionGovernor";

import { createPluckBank, warpDegree, weftDegree } from "./loomAudio";
import { LOOM_FRAGMENT, LOOM_VERTEX } from "./loomShader";

const MAX_THREADS = 128;
const STATE_ROWS = 11;
const WEAVE_ROW = 4;
const WEFT_WINDOW_ROW = 5;
const WARP_WINDOW_ROW = 8;
const STEP_SECONDS = 1 / 480;
const MAX_FRAME_SECONDS = 1 / 30;
const MAX_SUBSTEPS = 16;
const RELATIVE_DAMPING = 6;
const ARM_WIDTHS = 0.022;
const STRENGTH_WIDTHS = 0.12;
const STAGE_RATIO = 1.16;
const AXIS_LOCK_PX = 8;
const RELEASE_WINDOW_MS = 90;
const RELEASE_STALE_MS = 70;
const MAX_RELEASE_SPEED = 14;
const TAP_IMPULSE = 2.4;
const KEY_PULL = 4.2;
const IMPULSE_SPREAD = 2.2;
const LANDING_ZETA = 0.66;
const LANDING_MS = 1100;
const LAND_NEAR = 0.03;
const LAND_SPEED = 0.6;
const LANDED_OFFSET = 5e-4;
const LANDED_SPEED = 0.004;
const REARM_RATIO = 0.6;
const REARM_DECAY = 1.5;
const PLUCK_QUIET_MS = 260;
const POP_MS = 440;
const POP_BACK = 1.9;
const POP_FROM = 0.84;
const SWELL_PEAK = 0.26;
const SWELL_SPREAD = 1.8;
const SWELL_RATE = 16;
const HOVER_RATE = 10;
const HOVER_REACH_CELLS = 3;
const SETTLE_SPEED = 1e-3;
const SETTLE_OFFSET = 5e-4;
const INTRO_HOLD_MS = 420;
const INTRO_LAPS = 2;
const INTRO_PULL_MS = 1700;
const HOME_SPEED = 0.6;
const TRANSIT_DONE_OFFSET = 1e-3;
const TRANSIT_DONE_SPEED = 0.02;
const FLOW_SPEED = 3;
const DRAG_TICK = 0.25;
const FLOW_PLUCK_GAP_MS = 38;
const LANDING_PLUCK_GAP_MS = 90;
const DRIVE_FROM = 0.18;
const DRIVE_GAIN = 10;
const DRIVE_MAX = 4;
const DRIVE_EASE = 0.1;
const COAST_FROM = 1;
const COAST_MAX = 8;
const COAST_SPREAD = 0.3;
const GLIDE_CATCH = 1.5;
const GLIDE_DAMPING = 0.6;
const GLIDE_REACH = 0.5;
const GATHER_DRIFT = 0.15;
const KEY_DRIVE_SPEED = 2.6;
const KEY_DRIVE_RAMP_MS = 320;
const COVER_SPREAD_MS = 640;
const WARP_POP_SPREAD_MS = 420;
const WARP_RELEASE_DELAY_MS = 170;
const WARP_RELEASE_SPREAD_MS = 380;
const THREADS_REBUILD_GAP_MS = 700;
const COVER_SIZE = 512;
const SUPERSAMPLE_BELOW_PX = 9;
const PAGE_DPR_CAP = 2;
const BLANK_RGB = [233, 237, 243];
const MAX_GRABS = 10;
const MAX_SWELLS = MAX_GRABS * 2;
const PRESS_SWELL = 0.5;
const NEIGHBOUR_WAIT_MS = 600;
const REEL_REACH = 2;
const SLIP_FLOOR = 0.004;
const RESTORE_WAIT_MS = 2500;
const IDLE_RETURN_MS = 3000;
const IDLE_POLL_MS = 250;
const CALM_MS = 400;
const INTRO_REST_MS = 1800;
const REVEAL_REST_MS = 1400;
const SWISH_REST_MS = 2400;
const SWISH_ROW_MS = 1150;
const SWISH_SPREAD_MS = 680;
const SWISH_FRONT_POWER = 1.6;
const SWISH_ORIGINS = [0.5, 0.24, 0.76, 0.5, 0.38, 0.62];
const SWISH_COLUMN_SPREAD_MS = 360;
const GATHER_NEAR = 0.25;
const VISIBLE_MARGIN_CELLS = 2.5;

export const LOST_CONTEXT = "lost-context";

function createChain() {
  return {
    x: new Float32Array(MAX_THREADS),
    v: new Float32Array(MAX_THREADS),
    acc: new Float32Array(MAX_THREADS),
    target: new Float32Array(MAX_THREADS),
    pinned: new Uint8Array(MAX_THREADS),
    heldUntil: new Float64Array(MAX_THREADS),
    rest: new Float32Array(MAX_THREADS),
    landUntil: new Float64Array(MAX_THREADS),
    armed: new Uint8Array(MAX_THREADS),
    swung: new Uint8Array(MAX_THREADS),
    armAt: new Float32Array(MAX_THREADS).fill(ARM_WIDTHS),
    peak: new Float32Array(MAX_THREADS),
    quietUntil: new Float64Array(MAX_THREADS),
    swell: new Float32Array(MAX_THREADS).fill(1),
    popStart: new Float64Array(MAX_THREADS).fill(-Infinity),
    thick: new Float32Array(MAX_THREADS).fill(1),
    lo: new Float32Array(MAX_THREADS),
    hi: new Float32Array(MAX_THREADS),
    shift: new Float32Array(MAX_THREADS),
    steerDelay: new Float32Array(MAX_THREADS),
    anchor: new Int32Array(MAX_THREADS),
    lastDir: new Int8Array(MAX_THREADS),
    homing: true,
    locked: false,
    open: false,
    glide: false,
    glideLap: 0,
    glidePull: 1,
    steer: false,
    steerStart: 0,
  };
}

function resetChain(chain) {
  chain.x.fill(0);
  chain.v.fill(0);
  chain.pinned.fill(0);
  chain.heldUntil.fill(0);
  chain.landUntil.fill(0);
  chain.armed.fill(0);
  chain.swung.fill(0);
  chain.peak.fill(0);
  chain.lo.fill(0);
  chain.hi.fill(0);
  chain.shift.fill(0);
  chain.anchor.fill(0);
  chain.lastDir.fill(0);
  chain.homing = true;
  chain.locked = false;
  chain.open = false;
  chain.glide = false;
  chain.steer = false;
  chain.popStart.fill(-Infinity);
}

function closeWindow(chain) {
  chain.lo.fill(0);
  chain.hi.fill(0);
  chain.shift.fill(0);
  chain.open = false;
}

function reelOnLap(chain, lap) {
  return Math.min(chain.hi[0], Math.max(chain.lo[0], lap - chain.shift[0]));
}

function lapShowing(chain, reel, near) {
  const lo = chain.lo[0];
  const hi = chain.hi[0];
  const shift = chain.shift[0];
  const nearest = Math.round(near);
  if (lo === hi) return nearest;
  if (reel <= lo) return Math.max(nearest, -lo - shift);
  if (reel >= hi) return Math.min(nearest, -hi - shift);
  return -reel - shift;
}

function frontReach(u) {
  return Math.acos(Math.min(1, Math.max(-1, 2 * u - 1))) / Math.PI;
}

function smoothstep(t) {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function glidePullAt(speed) {
  const ratio = speed / GLIDE_CATCH;
  return 1 / (1 + ratio * ratio);
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function easeInOutSine(t) {
  return (1 - Math.cos(Math.PI * t)) / 2;
}

function easeInOutSineSlope(t) {
  return (Math.PI / 2) * Math.sin(Math.PI * t);
}

function crossedDetent(before, after) {
  return Math.floor(before) !== Math.floor(after);
}

function popCurve(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const u = t - 1;
  return 1 + (POP_BACK + 1) * u * u * u + POP_BACK * u * u;
}

export function weftOver(weave, row, col) {
  if (weave === 0) return ((row + col) & 1) === 0;
  if (weave === 1) return ((row + col) & 3) < 2;
  return (col + 3 * row) % 5 !== 0;
}

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

function coverCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = COVER_SIZE;
  canvas.height = COVER_SIZE;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  if (image) {
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const sx = (image.naturalWidth - side) / 2;
    const sy = (image.naturalHeight - side) / 2;
    context.drawImage(image, sx, sy, side, side, 0, 0, COVER_SIZE, COVER_SIZE);
  } else {
    const gradient = context.createLinearGradient(0, 0, COVER_SIZE, COVER_SIZE);
    gradient.addColorStop(0, "#e2e8f0");
    gradient.addColorStop(0.18, "#dbe2ea");
    gradient.addColorStop(0.42, "#cbd5e1");
    gradient.addColorStop(0.68, "#b4c0ce");
    gradient.addColorStop(0.86, "#a3b0c0");
    gradient.addColorStop(1, "#94a3b8");
    context.fillStyle = gradient;
    context.fillRect(0, 0, COVER_SIZE, COVER_SIZE);
  }
  return canvas;
}

function loadImage(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      const done = () => resolve(image);
      if (image.decode) image.decode().then(done, done);
      else done();
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

export function createLoom({ canvas, covers, index, params, reducedMotion, onPainted, onError, onCover }) {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "high-performance",
  });
  if (!gl) {
    onError?.("webgl");
    return null;
  }
  if (gl.isContextLost()) return LOST_CONTEXT;

  let program = null;
  let vao = null;
  let quad = null;
  let stateTexture = null;
  let blankTexture = null;
  let uniforms = {};
  const stateData = new Float32Array(MAX_THREADS * STATE_ROWS);

  const buildGpu = () => {
    try {
      const next = gl.createProgram();
      if (!next) throw new Error("context lost");
      const vertex = compile(gl, gl.VERTEX_SHADER, LOOM_VERTEX);
      const fragment = compile(gl, gl.FRAGMENT_SHADER, LOOM_FRAGMENT);
      gl.attachShader(next, vertex);
      gl.attachShader(next, fragment);
      gl.bindAttribLocation(next, 0, "aPosition");
      gl.linkProgram(next);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(next, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(next) || "link failed");
      program = next;
    } catch (error) {
      onError?.("shader", String(error?.message ?? error).slice(0, 300));
      return false;
    }

    uniforms = {};
    const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let slot = 0; slot < uniformCount; slot += 1) {
      const info = gl.getActiveUniform(program, slot);
      uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }

    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    stateTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, stateTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, MAX_THREADS, STATE_ROWS, 0, gl.RED, gl.FLOAT, stateData);

    blankTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, blankTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([...BLANK_RGB, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return true;
  };

  if (!buildGpu()) return null;

  const weft = createChain();
  const warp = createChain();
  const chains = [weft, warp];
  const governor = createResolutionGovernor({ max: 1, min: 0.55 });
  const textures = new Map();
  const grabs = new Map();
  const count = covers.length;

  let destroyed = false;
  let threads = params.threads;
  let weave = params.weave;
  let tension = params.tension;
  let coupling = params.coupling;
  let damping = params.damping;
  let soundOn = params.sound;
  let current = index;
  let pending = null;
  let active = false;
  let running = false;
  let frameId = 0;
  let lastTime = 0;
  let accumulator = 0;
  let introPending = !reducedMotion;
  let painted = false;
  let cssWidth = 1;
  let cssHeight = 1;
  let rect = null;
  let clothPx = 1;
  let originX = 0;
  let originY = 0;
  let pointerCellX = -1000;
  let pointerCellY = -1000;
  let hover = 0;
  let hoverTarget = 0;
  let focusRow = -1;
  let audio = null;
  let pageVisible = true;
  let lastThreadsChange = -Infinity;
  let coverReady = false;
  let contextLost = false;
  let lostTimer = 0;
  let slipping = false;
  let grabCount = 0;
  const grabAxis = new Int8Array(MAX_SWELLS);
  const grabIndex = new Int16Array(MAX_SWELLS);
  const grabLift = new Float32Array(MAX_SWELLS);
  const grabLocked = new Uint8Array(MAX_SWELLS);
  const columnWeave = new Float32Array(MAX_THREADS).fill(params.weave);
  const neighbourTimers = [];
  let overrideSide = 0;
  let overrideCover = 0;
  let overrideReach = 1;
  let introDrive = null;
  let lastGatedPluck = -Infinity;
  let keyDrive = null;
  let swish = null;
  let swishCount = 0;
  let aim = 0;
  let lastInputAt = performance.now();
  let calmSince = 0;
  let restUntil = 0;
  let idleTimer = 0;

  const wrapIndex = (value) => ((value % count) + count) % count;
  const clampIndex = (value) => Math.min(threads - 1, Math.max(0, Math.floor(value)));

  const uploadCover = (entry) => {
    entry.ready = true;
    if (contextLost || !entry.source) return;
    const source = entry.source;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    entry.texture = texture;
  };

  const requestCover = (coverIndex) => {
    if (!count) return null;
    const key = wrapIndex(coverIndex);
    const existing = textures.get(key);
    if (existing) return existing;
    const entry = { texture: null, source: null, ready: false, failed: false, promise: null };
    textures.set(key, entry);
    entry.promise = loadImage(covers[key].image).then((image) => {
      if (destroyed || textures.get(key) !== entry) return entry;
      let source;
      try {
        source = coverCanvas(image);
        if (image) source.getContext("2d").getImageData(0, 0, 1, 1);
      } catch {
        source = coverCanvas(null);
      }
      if (!image) entry.failed = true;
      entry.source = source;
      uploadCover(entry);
      return entry;
    });
    return entry;
  };

  const ringDistance = (a, b) => {
    const d = Math.abs(a - b) % count;
    return Math.min(d, count - d);
  };

  const keepNeighbours = () => {
    if (!count) return;
    requestCover(current);
    requestCover(current + 1);
    requestCover(current - 1);
    for (const [key, entry] of textures) {
      const shown = overrideSide !== 0 && ringDistance(key, overrideCover) <= 1;
      if (!shown && ringDistance(key, current) > REEL_REACH) {
        if (entry.texture) gl.deleteTexture(entry.texture);
        textures.delete(key);
      }
    }
  };

  const textureFor = (coverIndex) => {
    if (!count) return blankTexture;
    const entry = textures.get(wrapIndex(coverIndex));
    if (entry?.ready && entry.texture) return entry.texture;
    const home = textures.get(wrapIndex(current));
    return home?.ready && home.texture ? home.texture : blankTexture;
  };

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, PAGE_DPR_CAP) * governor.scale;
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    clothPx = Math.min(width, height) / STAGE_RATIO;
    originX = Math.round((width - clothPx) / 2);
    originY = Math.round((height - clothPx) / 2);
  };

  const pluckFrom = (isWarp, row, strength, at, gapMs) => {
    if (!audio || !soundOn) return;
    if (gapMs) {
      if (at - lastGatedPluck < gapMs) return;
      lastGatedPluck = at;
    }
    const degree = isWarp ? warpDegree(row, threads) : weftDegree(row, threads);
    const pan = isWarp ? ((row + 0.5) / threads) * 1.4 - 0.7 : 0;
    audio.pluck(degree, isWarp, strength, pan);
  };

  const stepChain = (chain, isWarp, now, frameSeconds) => {
    const { x, v, acc, pinned, heldUntil, rest, landUntil, armed, swung, armAt, peak, quietUntil, target, anchor, lastDir } =
      chain;
    const n = threads;
    const homing = chain.homing;
    for (let i = 0; i < n; i += 1) {
      if (!pinned[i]) continue;
      const before = x[i];
      v[i] = (target[i] - before) / Math.max(frameSeconds, STEP_SECONDS);
      x[i] = before + v[i] * STEP_SECONDS;
      if (crossedDetent(before, x[i]) && now >= quietUntil[i]) {
        quietUntil[i] = now + 120;
        pluckFrom(isWarp, i, DRAG_TICK, now, FLOW_PLUCK_GAP_MS);
      }
    }
    const criticalDamping = 2 * Math.sqrt(tension);
    const baseDamping = reducedMotion ? Math.max(damping, criticalDamping) : damping;
    const landingDamping = Math.max(baseDamping, criticalDamping * LANDING_ZETA);
    const gliding = !homing && chain.glide;
    const glideFloor = baseDamping * GLIDE_DAMPING;
    const glideDamping = glideFloor + (landingDamping - glideFloor) * chain.glidePull;
    const glideTension = tension * chain.glidePull;
    const glideLap = chain.glideLap;
    const steering = chain.steer;
    const steerSeconds = SWISH_ROW_MS / 1000;
    for (let i = 0; i < n; i += 1) {
      if (pinned[i] || heldUntil[i] > now) {
        acc[i] = 0;
        continue;
      }
      const left = i > 0 ? i - 1 : i;
      const right = i < n - 1 ? i + 1 : i;
      if (steering) {
        const progress = (now - chain.steerStart - chain.steerDelay[i]) / SWISH_ROW_MS;
        const moving = progress > 0 && progress < 1;
        const goal = progress <= 0 ? 1 : progress >= 1 ? 0 : 1 - easeInOutSine(progress);
        const goalSpeed = moving ? -easeInOutSineSlope(progress) / steerSeconds : 0;
        acc[i] =
          -tension * (x[i] - goal) -
          landingDamping * (v[i] - goalSpeed) +
          coupling * (x[left] + x[right] - 2 * x[i]) +
          RELATIVE_DAMPING * (v[left] + v[right] - 2 * v[i]);
        continue;
      }
      if (gliding) {
        const drift = Math.max(-GLIDE_REACH, Math.min(GLIDE_REACH, x[i] - glideLap));
        acc[i] =
          -glideTension * drift -
          glideDamping * v[i] +
          coupling * (x[left] + x[right] - 2 * x[i]) +
          RELATIVE_DAMPING * (v[left] + v[right] - 2 * v[i]);
        continue;
      }
      const drift = homing ? x[i] : x[i] - Math.round(x[i]);
      const nearHome = swung[i] && Math.abs(drift) < LAND_NEAR && Math.abs(v[i]) < LAND_SPEED;
      const landing = nearHome || landUntil[i] > now;
      acc[i] =
        -tension * drift -
        (landing ? landingDamping : baseDamping) * v[i] +
        coupling * (x[left] + x[right] - 2 * x[i]) +
        RELATIVE_DAMPING * (v[left] + v[right] - 2 * v[i]);
    }
    for (let i = 0; i < n; i += 1) {
      if (pinned[i]) continue;
      if (heldUntil[i] > now) {
        x[i] = rest[i];
        v[i] = 0;
        continue;
      }
      v[i] += acc[i] * STEP_SECONDS;
      const before = x[i];
      x[i] = before + v[i] * STEP_SECONDS;
      if (steering) continue;
      const magnitude = Math.abs(homing ? x[i] : x[i] - Math.round(x[i]));
      if (magnitude > LAND_NEAR) swung[i] = 1;
      else if (swung[i] && magnitude < LANDED_OFFSET && Math.abs(v[i]) < LANDED_SPEED) {
        swung[i] = 0;
        lastDir[i] = 0;
      }
      if (magnitude > armAt[i]) {
        armed[i] = 1;
        if (magnitude > peak[i]) peak[i] = magnitude;
      }
      if (!crossedDetent(before, x[i])) continue;
      const direction = x[i] > before ? 1 : -1;
      const lap = direction > 0 ? Math.floor(x[i]) : Math.floor(before);
      const reversal = lastDir[i] !== 0 && lastDir[i] !== direction;
      const freshLap = !homing && lap !== anchor[i];
      lastDir[i] = direction;
      if (freshLap && !reversal) {
        armed[i] = 0;
        peak[i] = 0;
        continue;
      }
      anchor[i] = lap;
      if (armed[i]) {
        armed[i] = 0;
        if (now >= quietUntil[i]) {
          quietUntil[i] = now + 120;
          const flow = Math.min(1, FLOW_SPEED / Math.max(Math.abs(v[i]), FLOW_SPEED));
          const strength = Math.min(1, peak[i] / STRENGTH_WIDTHS) * flow;
          pluckFrom(isWarp, i, strength, now, freshLap ? LANDING_PLUCK_GAP_MS : 0);
        }
        armAt[i] = Math.max(ARM_WIDTHS, peak[i] * REARM_RATIO);
        peak[i] = 0;
      }
    }
    for (let i = 0; i < n; i += 1) {
      if (!pinned[i]) continue;
      const magnitude = Math.abs(homing ? x[i] : x[i] - Math.round(x[i]));
      if (magnitude > LAND_NEAR) swung[i] = 1;
      if (magnitude > ARM_WIDTHS) {
        armed[i] = 1;
        if (magnitude > peak[i]) peak[i] = magnitude;
      }
    }
  };

  const loosen = (chain) => {
    if (chain.locked || !chain.homing) return;
    for (let i = 0; i < threads; i += 1) chain.anchor[i] = Math.round(chain.x[i]);
    chain.lastDir.fill(0);
    chain.homing = false;
  };

  const effectiveDamping = () => {
    const criticalDamping = 2 * Math.sqrt(tension);
    return reducedMotion ? Math.max(damping, criticalDamping) : damping;
  };

  const startGlide = (chain, row, speed) => {
    if (chain.locked || chain.homing) return;
    const n = threads;
    for (let j = 0; j < n; j += 1) if (chain.pinned[j]) return;
    const magnitude = Math.abs(speed);
    const share = magnitude > COAST_FROM ? Math.sign(speed) * Math.min(COAST_MAX, magnitude) : 0;
    const reach = n * COAST_SPREAD;
    let sum = 0;
    let sumV = 0;
    for (let j = 0; j < n; j += 1) {
      if (share && j !== row && !chain.pinned[j]) {
        const falloff = (j - row) / reach;
        chain.v[j] += (share - chain.v[j]) * Math.exp(-falloff * falloff);
      }
      sum += chain.x[j];
      sumV += chain.v[j];
    }
    const mean = sum / n;
    const meanV = sumV / n;
    const coastLap = Math.round(mean + meanV / (effectiveDamping() * GLIDE_DAMPING));
    const rowLap = Math.round(chain.x[row]);
    glideTo(chain, chain.x[row] > mean ? Math.max(coastLap, rowLap) : Math.min(coastLap, rowLap), meanV);
  };

  const moveCurrent = (delta) => {
    current = wrapIndex(current + delta);
    aim -= delta;
    for (let c = 0; c < 2; c += 1) {
      const chain = chains[c];
      for (let i = 0; i < threads; i += 1) {
        chain.shift[i] += delta;
        chain.lo[i] -= delta;
        chain.hi[i] -= delta;
      }
    }
    keepNeighbours();
    if (!pending) onCover?.(current, Math.sign(delta));
  };

  const landWindow = (chain) => {
    const landed = reelOnLap(chain, 0);
    if (landed) moveCurrent(landed);
  };

  const meanOf = (chain) => {
    const n = threads;
    let sum = 0;
    let sumV = 0;
    for (let i = 0; i < n; i += 1) {
      sum += chain.x[i];
      sumV += chain.v[i];
    }
    return [sum / n, sumV / n];
  };

  const glideTo = (chain, lap, meanV) => {
    chain.glideLap = lap;
    chain.glidePull = glidePullAt(meanV);
    chain.glide = true;
  };

  const glideOn = (chain) => {
    const [mean, meanV] = meanOf(chain);
    glideTo(chain, Math.round(mean + meanV / (effectiveDamping() * GLIDE_DAMPING)), meanV);
  };

  const follow = (chain) => {
    if (!chain.open || chain.locked || chain.steer) return;
    for (let i = 0; i < threads; i += 1) if (chain.pinned[i]) return;
    const [mean, meanV] = meanOf(chain);
    const lap = lapShowing(chain, aim, mean + meanV / (effectiveDamping() * GLIDE_DAMPING));
    if (chain.homing) {
      if (lap === 0) return;
      loosen(chain);
    }
    glideTo(chain, lap, meanV);
  };

  const decide = (chain) => {
    if (!chain.open || chain.locked || chain.homing) return;
    let lap = chain.glideLap;
    if (!chain.glide) {
      const [mean, meanV] = meanOf(chain);
      lap = Math.round(mean + meanV / effectiveDamping());
    }
    aim = reelOnLap(chain, -lap);
    follow(chain === weft ? warp : weft);
  };

  const gatherHome = (chain, now) => {
    if (chain.homing || chain.steer) return;
    const n = threads;
    let fastest = 0;
    let sum = 0;
    let sumV = 0;
    for (let i = 0; i < n; i += 1) {
      if (chain.pinned[i] || chain.heldUntil[i] > now) return;
      fastest = Math.max(fastest, Math.abs(chain.v[i]));
      sum += chain.x[i];
      sumV += chain.v[i];
    }
    const mean = sum / n;
    const meanV = sumV / n;
    if (chain.glide) chain.glidePull = glidePullAt(meanV);
    if (fastest > HOME_SPEED || Math.abs(meanV) > GATHER_DRIFT) return;
    let home = chain.glide ? chain.glideLap : Math.round(mean + meanV / effectiveDamping());
    if (chain.open) home = lapShowing(chain, aim, home);
    if (Math.abs(mean - home) > GATHER_NEAR) {
      glideTo(chain, home, meanV);
      return;
    }
    if (home) {
      for (let i = 0; i < n; i += 1) {
        chain.x[i] -= home;
        chain.rest[i] -= home;
        if (chain.open) chain.shift[i] += home;
      }
    }
    chain.glide = false;
    chain.homing = true;
    if (chain.open) landWindow(chain);
  };

  const finishTransit = (chain, now) => {
    if (!chain.locked) return;
    const n = threads;
    for (let i = 0; i < n; i += 1) {
      if (chain.pinned[i] || chain.heldUntil[i] > now) return;
      if (Math.abs(chain.x[i]) > TRANSIT_DONE_OFFSET || Math.abs(chain.v[i]) > TRANSIT_DONE_SPEED) return;
    }
    closeWindow(chain);
    chain.locked = false;
  };

  const pushSwell = (axis, at, lift, locked) => {
    grabAxis[grabCount] = axis;
    grabIndex[grabCount] = at;
    grabLift[grabCount] = lift;
    grabLocked[grabCount] = locked;
    grabCount += 1;
  };

  const collectGrabs = () => {
    grabCount = 0;
    for (const grab of grabs.values()) {
      if (grab.dead || grabCount > MAX_SWELLS - 2) continue;
      if (grab.axis) {
        pushSwell(grab.axis, grab.index, 1, 1);
        continue;
      }
      const inside = grab.cellX >= 0 && grab.cellX < threads && grab.cellY >= 0 && grab.cellY < threads;
      if (!inside) continue;
      pushSwell(1, clampIndex(grab.cellY), PRESS_SWELL, 0);
      pushSwell(2, clampIndex(grab.cellX), PRESS_SWELL, 0);
    }
  };

  const updateLooks = (now, dt) => {
    const swellBlend = 1 - Math.exp(-dt * SWELL_RATE);
    const rearmBlend = Math.exp(-dt * REARM_DECAY);
    let busy = false;
    for (let c = 0; c < 2; c += 1) {
      const chain = chains[c];
      const axis = c + 1;
      const n = threads;
      for (let i = 0; i < n; i += 1) {
        let lift = 0;
        for (let g = 0; g < grabCount; g += 1) {
          if (grabAxis[g] !== axis) continue;
          const d = (i - grabIndex[g]) / SWELL_SPREAD;
          lift = Math.max(lift, SWELL_PEAK * grabLift[g] * Math.exp(-d * d));
        }
        if (c === 0 && focusRow >= 0) {
          const d = (i - focusRow) / SWELL_SPREAD;
          lift = Math.max(lift, SWELL_PEAK * Math.exp(-d * d));
        }
        const goal = 1 + lift;
        const swell = chain.swell[i] + (goal - chain.swell[i]) * swellBlend;
        chain.swell[i] = Math.abs(goal - swell) < 1e-4 ? goal : swell;
        if (Math.abs(goal - chain.swell[i]) > 1e-4) busy = true;
        const start = chain.popStart[i];
        let presence = 1;
        if (start > -Infinity) {
          const t = (now - start) / POP_MS;
          if (t >= 0) presence = POP_FROM + (1 - POP_FROM) * popCurve(t);
          if (t >= 1) chain.popStart[i] = -Infinity;
          else busy = true;
        }
        chain.thick[i] = presence * chain.swell[i];
        chain.armAt[i] = Math.max(ARM_WIDTHS, chain.armAt[i] * rearmBlend);
      }
    }
    const hoverBlend = 1 - Math.exp(-dt * HOVER_RATE);
    hover += (hoverTarget - hover) * hoverBlend;
    if (Math.abs(hoverTarget - hover) < 1e-3) hover = hoverTarget;
    else busy = true;
    return busy;
  };

  const writeState = (now) => {
    const n = threads;
    let slip = 0;
    for (let i = 0; i < n; i += 1) {
      if (!(warp.popStart[i] > now)) columnWeave[i] = weave;
      stateData[MAX_THREADS * WEAVE_ROW + i] = columnWeave[i];
      const weftX = weft.x[i];
      const warpX = warp.x[i];
      stateData[i] = weftX;
      stateData[MAX_THREADS + i] = warpX;
      stateData[MAX_THREADS * 2 + i] = weft.thick[i];
      stateData[MAX_THREADS * 3 + i] = warp.thick[i];
      stateData[MAX_THREADS * WEFT_WINDOW_ROW + i] = weft.lo[i];
      stateData[MAX_THREADS * (WEFT_WINDOW_ROW + 1) + i] = weft.hi[i];
      stateData[MAX_THREADS * (WEFT_WINDOW_ROW + 2) + i] = weft.shift[i];
      stateData[MAX_THREADS * WARP_WINDOW_ROW + i] = warp.lo[i];
      stateData[MAX_THREADS * (WARP_WINDOW_ROW + 1) + i] = warp.hi[i];
      stateData[MAX_THREADS * (WARP_WINDOW_ROW + 2) + i] = warp.shift[i];
      slip = Math.max(slip, Math.abs(weftX - Math.round(weftX)), Math.abs(warpX - Math.round(warpX)));
    }
    slipping = slip > SLIP_FLOOR;
    gl.bindTexture(gl.TEXTURE_2D, stateTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAX_THREADS, STATE_ROWS, gl.RED, gl.FLOAT, stateData);
  };

  const bindCover = (unit, location, coverIndex) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, textureFor(coverIndex));
    gl.uniform1i(location, unit);
  };

  const sideCover = (side, reach) =>
    overrideSide === side && reach >= overrideReach
      ? overrideCover + side * (reach - overrideReach)
      : current + side * reach;

  const draw = (now = performance.now()) => {
    if (destroyed || contextLost || gl.isContextLost()) return;
    writeState(now);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindVertexArray(vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTexture);
    gl.uniform1i(uniforms.uState, 0);
    bindCover(1, uniforms.uPrevFar, sideCover(-1, 2));
    bindCover(2, uniforms.uPrev, sideCover(-1, 1));
    bindCover(3, uniforms.uCurrent, current);
    bindCover(4, uniforms.uNext, sideCover(1, 1));
    bindCover(5, uniforms.uNextFar, sideCover(1, 2));

    gl.uniform2f(uniforms.uResolution, canvas.width, canvas.height);
    gl.uniform4f(uniforms.uCloth, originX, originY, clothPx, threads);
    gl.uniform3f(uniforms.uPointer, pointerCellX, pointerCellY, hover);
    gl.uniform1f(uniforms.uSlip, slipping ? 1 : 0);
    const cellPx = clothPx / threads;
    const naturalCellPx = cellPx / governor.scale;
    let taps = 1;
    if (naturalCellPx < SUPERSAMPLE_BELOW_PX) taps = governor.scale < 1 ? 2 : 4;
    gl.uniform1f(uniforms.uLod, Math.min(4, Math.max(0, Math.log2(COVER_SIZE / threads) - 1.2)));
    gl.uniform1f(uniforms.uSuper, taps);
    const twist = Math.min(1, Math.max(0, (cellPx - 6) / 8));
    gl.uniform1f(uniforms.uTwist, 0.035 * twist * twist * (3 - 2 * twist));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!painted && coverReady && !introPending) {
      painted = true;
      canvas.dataset.painted = "1";
      onPainted?.();
    }
  };

  const isSettled = (now) => {
    if (grabs.size || introDrive || keyDrive || swish) return false;
    for (let c = 0; c < 2; c += 1) {
      const chain = chains[c];
      if (!chain.homing) return false;
      for (let i = 0; i < threads; i += 1) {
        if (chain.pinned[i] || chain.heldUntil[i] > now) return false;
        if (Math.abs(chain.v[i]) > SETTLE_SPEED || Math.abs(chain.x[i]) > SETTLE_OFFSET) return false;
      }
    }
    return true;
  };

  const settle = () => {
    for (let c = 0; c < 2; c += 1) {
      const chain = chains[c];
      chain.x.fill(0);
      chain.v.fill(0);
      chain.armed.fill(0);
      chain.swung.fill(0);
      chain.peak.fill(0);
      chain.anchor.fill(0);
      chain.lastDir.fill(0);
      closeWindow(chain);
      chain.homing = true;
      chain.locked = false;
      chain.glide = false;
      chain.steer = false;
    }
    aim = 0;
  };

  const clothResting = (now) => !pending && isSettled(now);

  const idleOn = () => !reducedMotion && count > 1 && active && !destroyed && !contextLost;

  const idleDueAt = () =>
    calmSince ? Math.max(lastInputAt + IDLE_RETURN_MS, restUntil, calmSince + CALM_MS) : Infinity;

  const canSwish = (time) => {
    if (!idleOn() || swish || introPending || !coverReady) return false;
    if (time < idleDueAt() || !clothResting(time)) return false;
    const entry = textures.get(wrapIndex(current + 1));
    return Boolean(entry?.ready && entry.texture);
  };

  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = 0;
    if (!idleOn() || !calmSince) return;
    const wait = Math.max(IDLE_POLL_MS, idleDueAt() - performance.now());
    idleTimer = setTimeout(() => {
      idleTimer = 0;
      if (canSwish(performance.now())) wake();
      else armIdle();
    }, wait);
  };

  const noteInput = () => {
    lastInputAt = performance.now();
  };

  const startSwish = (time) => {
    settle();
    if (overrideSide) overrideSide = 0;
    const n = threads;
    const origin = SWISH_ORIGINS[swishCount % SWISH_ORIGINS.length] * (n - 1);
    const reach = Math.max(origin, n - 1 - origin, 1);
    current = wrapIndex(current + 1);
    aim = 0;
    let longest = 0;
    let rowDelays = 0;
    for (let i = 0; i < n; i += 1) {
      weft.steerDelay[i] = SWISH_SPREAD_MS * (Math.abs(i - origin) / reach) ** SWISH_FRONT_POWER;
      rowDelays += weft.steerDelay[i];
      longest = Math.max(longest, weft.steerDelay[i]);
    }
    const columnsFrom = Math.max(0, rowDelays / n - SWISH_COLUMN_SPREAD_MS / 2);
    for (let j = 0; j < n; j += 1) {
      warp.steerDelay[j] = columnsFrom + SWISH_COLUMN_SPREAD_MS * frontReach((j + 0.5) / n);
      longest = Math.max(longest, warp.steerDelay[j]);
    }
    for (let c = 0; c < 2; c += 1) {
      const chain = chains[c];
      for (let i = 0; i < n; i += 1) {
        chain.x[i] = 1;
        chain.target[i] = 1;
        chain.v[i] = 0;
        chain.pinned[i] = 0;
        chain.heldUntil[i] = 0;
        chain.landUntil[i] = 0;
        chain.lo[i] = -1;
        chain.hi[i] = 0;
        chain.shift[i] = 0;
        chain.anchor[i] = 1;
      }
      chain.open = true;
      chain.homing = false;
      chain.locked = false;
      chain.glide = false;
      chain.steer = true;
      chain.steerStart = time;
    }
    swish = { start: time, end: time + longest + SWISH_ROW_MS };
    swishCount += 1;
    calmSince = 0;
    keepNeighbours();
    onCover?.(current, 1);
  };

  const endSwish = (time) => {
    swish = null;
    const n = threads;
    for (let c = 0; c < 2; c += 1) {
      const chain = chains[c];
      for (let i = 0; i < n; i += 1) {
        chain.target[i] = chain.x[i];
        chain.landUntil[i] = time + LANDING_MS;
        chain.quietUntil[i] = time + LANDING_MS;
        chain.swung[i] = 1;
      }
      chain.armed.fill(0);
      chain.peak.fill(0);
      chain.anchor.fill(0);
      chain.lastDir.fill(0);
      chain.steer = false;
      chain.homing = true;
      chain.glide = false;
    }
    restUntil = time + SWISH_REST_MS;
  };

  const driveSwish = (time) => {
    if (time >= swish.end) endSwish(time);
  };

  const finishSwishNow = (time) => {
    swish = null;
    settle();
    restUntil = time + SWISH_REST_MS;
  };

  const stopSwish = () => {
    if (!swish) return;
    swish = null;
    const n = threads;
    for (let c = 0; c < 2; c += 1) {
      const chain = chains[c];
      for (let i = 0; i < n; i += 1) {
        chain.target[i] = chain.x[i];
        chain.armed[i] = 0;
        chain.peak[i] = 0;
        chain.anchor[i] = Math.round(chain.x[i]);
        chain.lastDir[i] = 0;
      }
      chain.steer = false;
      chain.homing = false;
    }
    glideOn(weft);
    decide(weft);
  };

  const interrupt = () => {
    noteInput();
    if (swish) stopSwish();
  };

  const startIntro = (time) => {
    introPending = false;
    if (reducedMotion) return;
    const row = Math.floor(threads / 2);
    if (weft.pinned[row]) return;
    loosen(weft);
    weft.glide = false;
    weft.pinned[row] = 1;
    weft.target[row] = weft.x[row];
    introDrive = { row, from: weft.x[row], start: time + INTRO_HOLD_MS };
  };

  const endIntroDrive = () => {
    if (!introDrive) return;
    const { row } = introDrive;
    introDrive = null;
    restUntil = performance.now() + INTRO_REST_MS;
    for (const grab of grabs.values()) if (grab.axis === 1 && grab.index === row) return;
    weft.pinned[row] = 0;
    startGlide(weft, row, weft.v[row]);
    decide(weft);
  };

  const driveGrabs = (dt) => {
    for (const grab of grabs.values()) {
      if (!grab.axis || grab.dead) continue;
      if (chains[grab.axis - 1].locked) continue;
      const excess = Math.abs(grab.pull) - DRIVE_FROM;
      if (excess <= 0) continue;
      const speed = Math.min(DRIVE_MAX, excess * DRIVE_GAIN) * smoothstep(excess / DRIVE_EASE);
      grab.driven += Math.sign(grab.pull) * speed * dt;
      const value = grab.base + grab.pull + grab.driven;
      chains[grab.axis - 1].target[grab.index] = value;
      record(grab, performance.now(), value);
    }
  };

  const keyDriveSpeed = (time) => KEY_DRIVE_SPEED * smoothstep((time - keyDrive.since) / KEY_DRIVE_RAMP_MS);

  const driveKeys = (time, dt) => {
    keyDrive.driven += keyDrive.direction * keyDriveSpeed(time) * dt;
    weft.target[keyDrive.row] = keyDrive.base + keyDrive.driven;
  };

  const releaseKeyDrive = () => {
    if (!keyDrive) return;
    const { row, direction } = keyDrive;
    const speed = direction * keyDriveSpeed(performance.now());
    keyDrive = null;
    weft.pinned[row] = 0;
    weft.v[row] = speed;
    startGlide(weft, row, speed);
    decide(weft);
    wake();
  };

  const startKeyDrive = (row, direction) => {
    if (keyDrive?.row === row && keyDrive.direction === direction) return;
    releaseKeyDrive();
    endIntroDrive();
    if (weft.pinned[row]) return;
    loosen(weft);
    weft.glide = false;
    weft.pinned[row] = 1;
    weft.heldUntil[row] = 0;
    weft.target[row] = weft.x[row];
    keyDrive = { row, direction, base: weft.x[row], driven: 0, since: performance.now() };
    wake();
  };

  const driveIntro = (time) => {
    const { row, from, start } = introDrive;
    const t = Math.min(1, Math.max(0, (time - start) / INTRO_PULL_MS));
    weft.target[row] = from + INTRO_LAPS * easeInOutCubic(t);
    if (t >= 1) endIntroDrive();
  };

  const frame = (time) => {
    frameId = 0;
    if (destroyed || !active || contextLost) {
      running = false;
      return;
    }
    if (introPending && coverReady) startIntro(time);
    const elapsed = lastTime ? time - lastTime : 16.7;
    lastTime = time;
    const dt = Math.min(Math.max(elapsed / 1000, 1 / 240), MAX_FRAME_SECONDS);
    if (governor.sample(elapsed)) resize();
    if (canSwish(time)) startSwish(time);
    if (swish) driveSwish(time);
    if (introDrive) driveIntro(time);
    if (keyDrive) driveKeys(time, dt);
    if (grabs.size) driveGrabs(dt);

    accumulator = Math.min(accumulator + dt, MAX_SUBSTEPS * STEP_SECONDS);
    let substeps = 0;
    while (accumulator >= STEP_SECONDS && substeps < MAX_SUBSTEPS) {
      const subNow = time - (accumulator - STEP_SECONDS) * 1000;
      stepChain(weft, false, subNow, dt);
      stepChain(warp, true, subNow, dt);
      accumulator -= STEP_SECONDS;
      substeps += 1;
    }
    collectGrabs();
    for (let g = 0; g < grabCount; g += 1) {
      if (!grabLocked[g]) continue;
      const chain = chains[grabAxis[g] - 1];
      chain.x[grabIndex[g]] = chain.target[grabIndex[g]];
    }

    gatherHome(weft, time);
    gatherHome(warp, time);
    finishTransit(weft, time);
    finishTransit(warp, time);

    const looksBusy = updateLooks(time, dt);
    draw(time);

    if (!clothResting(time)) calmSince = 0;
    else if (!calmSince) calmSince = time;

    if (!looksBusy && isSettled(time)) {
      settle();
      if (overrideSide) {
        overrideSide = 0;
        keepNeighbours();
      }
      draw(time);
      running = false;
      lastTime = 0;
      armIdle();
      return;
    }
    frameId = requestAnimationFrame(frame);
  };

  const wake = () => {
    if (destroyed || !active || running || contextLost) return;
    running = true;
    lastTime = 0;
    frameId = requestAnimationFrame(frame);
  };

  const rebase = (axis, i, delta) => {
    if (!delta) return;
    for (const grab of grabs.values()) if (grab.axis === axis && grab.index === i) grab.base += delta;
    if (axis === 1 && keyDrive?.row === i) keyDrive.base += delta;
  };

  const foldLaps = (chain, i) => {
    const position = chain.pinned[i] ? chain.target[i] : chain.x[i];
    const margin = VISIBLE_MARGIN_CELLS / threads;
    const lowLap = Math.floor(-margin - position) - chain.shift[i];
    const highLap = Math.floor(1 + margin - position) - chain.shift[i];
    if (highLap < chain.lo[i]) return highLap - chain.lo[i];
    if (lowLap > chain.hi[i]) return lowLap - chain.hi[i];
    return 0;
  };

  const shiftChain = (chain, axis, shift, limit, releaseAt) => {
    const n = threads;
    const clampReel = (value) => Math.max(-limit, Math.min(limit, value));
    if (chain.open) {
      for (let i = 0; i < n; i += 1) {
        const lapShift = chain.shift[i];
        if (!lapShift) continue;
        chain.x[i] += lapShift;
        chain.target[i] += lapShift;
        chain.rest[i] += lapShift;
        chain.shift[i] = 0;
        rebase(axis, i, lapShift);
      }
      chain.open = false;
    }
    for (let i = 0; i < n; i += 1) {
      const pinned = chain.pinned[i];
      const before = chain.target[i];
      if (chain.lo[i] === chain.hi[i]) {
        const lap = Math.round(pinned ? before : chain.x[i]);
        chain.x[i] += shift - lap;
        if (pinned) chain.target[i] = before - lap + shift;
      } else {
        const fold = foldLaps(chain, i);
        chain.x[i] = clampReel(chain.x[i] + fold) + shift;
        if (pinned) chain.target[i] = clampReel(before + fold) + shift;
      }
      if (pinned) rebase(axis, i, chain.target[i] - before);
    }
    chain.homing = true;
    chain.locked = true;
    chain.glide = false;
    chain.steer = false;
    for (let i = 0; i < n; i += 1) {
      chain.lo[i] = Math.max(-REEL_REACH, Math.min(chain.lo[i] - shift, 0));
      chain.hi[i] = Math.min(REEL_REACH, Math.max(chain.hi[i] - shift, 0));
      if (chain.pinned[i]) continue;
      chain.rest[i] = chain.x[i];
      chain.heldUntil[i] = releaseAt(i);
      chain.landUntil[i] = chain.heldUntil[i] + LANDING_MS;
      chain.v[i] = 0;
    }
  };

  const startCoverChange = (nextIndex, direction) => {
    if (swish) stopSwish();
    const forward = wrapIndex((nextIndex - current) * direction);
    const inReach = forward >= 1 && forward <= REEL_REACH;
    const steps = inReach ? forward : 1;
    const leavingCover = current;
    current = nextIndex;
    if (reducedMotion) {
      overrideSide = 0;
    } else if (!inReach) {
      overrideSide = -direction;
      overrideReach = 1;
      overrideCover = leavingCover;
    } else if (overrideSide === -direction && overrideReach + steps <= REEL_REACH) {
      overrideReach += steps;
    } else {
      overrideSide = 0;
    }
    keepNeighbours();
    if (reducedMotion) {
      draw();
      return;
    }
    endIntroDrive();
    aim = 0;
    const shift = direction * steps;
    const n = threads;
    const now = performance.now();
    const rowStagger = COVER_SPREAD_MS / n;
    const columnStagger = WARP_RELEASE_SPREAD_MS / n;
    shiftChain(weft, 1, shift, REEL_REACH - steps, (i) => now + i * rowStagger);
    shiftChain(warp, 2, shift, REEL_REACH - steps, (j) => {
      const order = direction > 0 ? n - 1 - j : j;
      return now + WARP_RELEASE_DELAY_MS + order * columnStagger;
    });
    for (let j = 0; j < n; j += 1) warp.quietUntil[j] = Math.max(warp.quietUntil[j], warp.landUntil[j]);
    wake();
  };

  const pointerCell = (clientX, clientY) => {
    if (!rect) rect = canvas.getBoundingClientRect();
    const scale = canvas.width / Math.max(rect.width, 1);
    const px = (clientX - rect.left) * scale;
    const py = (clientY - rect.top) * scale;
    return [((px - originX) / clothPx) * threads, ((py - originY) / clothPx) * threads];
  };

  const clothCss = () => {
    if (!rect) rect = canvas.getBoundingClientRect();
    return Math.min(rect.width, rect.height) / STAGE_RATIO;
  };

  const updateHover = (pointerType, pressed) => {
    const reach = HOVER_REACH_CELLS;
    const inside =
      pointerCellX > -reach && pointerCellX < threads + reach && pointerCellY > -reach && pointerCellY < threads + reach;
    hoverTarget = inside && (pressed || pointerType !== "touch") ? 1 : 0;
    if (grabs.size) hoverTarget = 1;
  };

  const primeAudio = () => {
    if (destroyed) return;
    if (!audio) {
      audio = createPluckBank();
      audio?.setEnabled(soundOn);
    }
    if (pageVisible) audio?.resume();
  };

  const ensureAudio = () => {
    if (soundOn) primeAudio();
  };

  const primeOnGesture = (force = false) => {
    if (force || soundOn) primeAudio();
  };

  const releaseGrab = (grab, withVelocity) => {
    if (!grab.axis) return;
    const chain = chains[grab.axis - 1];
    const i = grab.index;
    chain.pinned[i] = 0;
    let speed = 0;
    if (withVelocity && grab.sampleCount > 1) {
      const last = (grab.head - 1 + grab.times.length) % grab.times.length;
      const lastTime = grab.times[last];
      const lastValue = grab.values[last];
      let oldestTime = lastTime;
      let oldestValue = lastValue;
      for (let k = 1; k < grab.sampleCount; k += 1) {
        const slot = (last - k + grab.times.length) % grab.times.length;
        if (lastTime - grab.times[slot] > RELEASE_WINDOW_MS) break;
        oldestTime = grab.times[slot];
        oldestValue = grab.values[slot];
      }
      const span = lastTime - oldestTime;
      if (span > 8 && performance.now() - lastTime < RELEASE_STALE_MS) {
        speed = ((lastValue - oldestValue) / span) * 1000;
      }
    }
    const releaseSpeed = Math.max(-MAX_RELEASE_SPEED, Math.min(MAX_RELEASE_SPEED, speed));
    chain.v[i] = releaseSpeed;
    chain.heldUntil[i] = 0;
    chain.anchor[i] = Math.round(chain.x[i]);
    chain.lastDir[i] = 0;
    if (Math.abs(releaseSpeed) > COAST_FROM || grab.driven !== 0) startGlide(chain, i, releaseSpeed);
    decide(chain);
  };

  const kick = (chain, centre, amount, quietUntil) => {
    const reach = Math.ceil(IMPULSE_SPREAD * 3);
    loosen(chain);
    for (let d = -reach; d <= reach; d += 1) {
      const i = centre + d;
      if (i < 0 || i >= threads || chain.pinned[i]) continue;
      const falloff = d / IMPULSE_SPREAD;
      chain.v[i] += amount * Math.exp(-falloff * falloff);
      chain.heldUntil[i] = 0;
      if (quietUntil) chain.quietUntil[i] = quietUntil;
    }
  };

  const pluckThread = (isWarp, i, impulse, strength) => {
    kick(isWarp ? warp : weft, i, impulse, performance.now() + PLUCK_QUIET_MS);
    pluckFrom(isWarp, i, strength);
    wake();
  };

  const onPointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    interrupt();
    rect = canvas.getBoundingClientRect();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {}
    ensureAudio();
    endIntroDrive();
    releaseKeyDrive();
    const [cellX, cellY] = pointerCell(event.clientX, event.clientY);
    pointerCellX = cellX;
    pointerCellY = cellY;
    focusRow = -1;
    grabs.set(event.pointerId, {
      id: event.pointerId,
      type: event.pointerType,
      downX: event.clientX,
      downY: event.clientY,
      cellX,
      cellY,
      axis: 0,
      index: -1,
      base: 0,
      pull: 0,
      driven: 0,
      times: new Float64Array(12),
      values: new Float32Array(12),
      head: 0,
      sampleCount: 0,
    });
    updateHover(event.pointerType, true);
    canvas.dataset.pressed = "1";
    wake();
  };

  const record = (grab, time, value) => {
    grab.times[grab.head] = time;
    grab.values[grab.head] = value;
    grab.head = (grab.head + 1) % grab.times.length;
    grab.sampleCount = Math.min(grab.sampleCount + 1, grab.times.length);
  };

  const onPointerMove = (event) => {
    const grab = grabs.get(event.pointerId);
    if (grab && event.pointerType === "mouse" && event.buttons === 0) {
      finishPointer(event, true);
      return;
    }
    const [cellX, cellY] = pointerCell(event.clientX, event.clientY);
    pointerCellX = cellX;
    pointerCellY = cellY;
    updateHover(event.pointerType, Boolean(grab));
    if (grab || hoverTarget) noteInput();
    if (grab) {
      const dx = event.clientX - grab.downX;
      const dy = event.clientY - grab.downY;
      if (!grab.axis && !grab.dead && dx * dx + dy * dy >= AXIS_LOCK_PX * AXIS_LOCK_PX) {
        grab.axis = Math.abs(dx) >= Math.abs(dy) ? 1 : 2;
        grab.index = clampIndex(grab.axis === 1 ? grab.cellY : grab.cellX);
        const chain = chains[grab.axis - 1];
        for (const other of grabs.values()) {
          if (other !== grab && other.axis === grab.axis && other.index === grab.index) {
            other.axis = 0;
            other.index = -1;
            other.dead = true;
          }
        }
        grab.base = chain.x[grab.index];
        loosen(chain);
        chain.glide = false;
        chain.pinned[grab.index] = 1;
        chain.heldUntil[grab.index] = 0;
        canvas.dataset.axis = grab.axis === 1 ? "row" : "column";
      }
      if (grab.axis) {
        const chain = chains[grab.axis - 1];
        grab.pull = (grab.axis === 1 ? dx : dy) / clothCss();
        const value = grab.base + grab.pull + grab.driven;
        chain.target[grab.index] = value;
        record(grab, performance.now(), value);
      }
    }
    wake();
  };

  const finishPointer = (event, cancelled) => {
    const grab = grabs.get(event.pointerId);
    if (!grab) {
      if (!grabs.size) {
        delete canvas.dataset.pressed;
        delete canvas.dataset.axis;
      }
      return;
    }
    grabs.delete(event.pointerId);
    if (grab.axis) {
      releaseGrab(grab, !cancelled);
    } else if (!cancelled && !grab.dead) {
      const row = clampIndex(grab.cellY);
      const col = clampIndex(grab.cellX);
      const inside = grab.cellX >= 0 && grab.cellX < threads && grab.cellY >= 0 && grab.cellY < threads;
      if (inside) {
        const weftTop = weftOver(Math.round(columnWeave[col]), row, col);
        const sign = (row + col) & 1 ? -1 : 1;
        if (weftTop) pluckThread(false, row, TAP_IMPULSE * sign, 0.55);
        else pluckThread(true, col, TAP_IMPULSE * sign, 0.55);
      }
    }
    if (!grabs.size) {
      delete canvas.dataset.pressed;
      delete canvas.dataset.axis;
    }
    updateHover(event.pointerType, grabs.size > 0);
    wake();
  };

  const onPointerUp = (event) => {
    ensureAudio();
    finishPointer(event, false);
  };
  const onPointerCancel = (event) => finishPointer(event, true);
  const onPointerLeave = (event) => {
    if (grabs.has(event.pointerId)) return;
    hoverTarget = 0;
    wake();
  };
  const onPointerEnter = () => {
    rect = canvas.getBoundingClientRect();
  };

  const onKeyDown = (event) => {
    const arrow = event.key.startsWith("Arrow");
    if (arrow || event.key === " " || event.key === "Spacebar") interrupt();
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      ensureAudio();
      releaseKeyDrive();
      const step = event.key === "ArrowUp" ? -1 : 1;
      focusRow = focusRow < 0 ? Math.floor(threads / 2) : Math.min(threads - 1, Math.max(0, focusRow + step));
      pointerCellY = focusRow + 0.5;
      pointerCellX = threads / 2;
      wake();
      return;
    }
    if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      ensureAudio();
      if (focusRow < 0) focusRow = Math.floor(threads / 2);
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      if (event.repeat) startKeyDrive(focusRow, direction);
      else kick(weft, focusRow, KEY_PULL * direction, 0);
      wake();
      return;
    }
    if (keyDrive && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      releaseKeyDrive();
      return;
    }
    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      ensureAudio();
      if (focusRow < 0) focusRow = Math.floor(threads / 2);
      pluckThread(false, focusRow, TAP_IMPULSE, 0.6);
    }
  };

  const onKeyUp = (event) => {
    if (event.key === "Shift" || event.key === "ArrowLeft" || event.key === "ArrowRight") releaseKeyDrive();
  };

  const onBlur = () => {
    releaseKeyDrive();
    focusRow = -1;
    wake();
  };

  const onContextLost = (event) => {
    event.preventDefault();
    contextLost = true;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    running = false;
    for (const entry of textures.values()) entry.texture = null;
    clearTimeout(lostTimer);
    lostTimer = setTimeout(() => {
      if (!destroyed && contextLost) onError?.("lost");
    }, RESTORE_WAIT_MS);
  };

  const onContextRestored = () => {
    if (destroyed) return;
    clearTimeout(lostTimer);
    contextLost = false;
    if (!buildGpu()) return;
    for (const entry of textures.values()) uploadCover(entry);
    resize();
    draw();
    wake();
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("lostpointercapture", onPointerCancel);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("pointerenter", onPointerEnter);
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  keepNeighbours();
  const neighbourOrTimeout = (coverIndex) =>
    Promise.race([
      textures.get(wrapIndex(coverIndex))?.promise,
      new Promise((resolve) => neighbourTimers.push(setTimeout(resolve, NEIGHBOUR_WAIT_MS))),
    ]);
  const homePromise = textures.get(wrapIndex(current))?.promise;
  if (homePromise) {
    Promise.all([homePromise, neighbourOrTimeout(current - 1), neighbourOrTimeout(current + 1)]).then(() => {
      for (const timer of neighbourTimers) clearTimeout(timer);
      neighbourTimers.length = 0;
      if (destroyed) return;
      coverReady = true;
      draw();
      wake();
    });
  }

  const engine = {
    setSize(width, height) {
      cssWidth = width;
      cssHeight = height;
      rect = null;
      resize();
      draw();
      wake();
    },
    setActive(next) {
      active = next;
      if (active) {
        calmSince = 0;
        restUntil = Math.max(restUntil, performance.now() + REVEAL_REST_MS);
        wake();
        return;
      }
      clearTimeout(idleTimer);
      idleTimer = 0;
      if (swish) finishSwishNow(performance.now());
      if (frameId) {
        cancelAnimationFrame(frameId);
        frameId = 0;
        running = false;
      }
    },
    setPageVisible(visible) {
      pageVisible = visible;
      if (!audio) return;
      if (pageVisible) audio.resume();
      else audio.suspend();
    },
    goTo(nextIndex, direction) {
      if (!count) return;
      const target = wrapIndex(nextIndex);
      if (target === current) {
        pending = null;
        return;
      }
      interrupt();
      const entry = requestCover(target);
      if (entry.ready) {
        pending = null;
        startCoverChange(target, direction);
        return;
      }
      pending = { target, direction };
      entry.promise.then(() => {
        if (destroyed || !pending || pending.target !== target) return;
        pending = null;
        startCoverChange(target, direction);
      });
    },
    setParams(next) {
      const reshaped =
        next.tension !== tension ||
        next.coupling !== coupling ||
        next.damping !== damping ||
        next.weave !== weave ||
        next.threads !== threads;
      if (reshaped) noteInput();
      tension = next.tension;
      coupling = next.coupling;
      damping = next.damping;
      if (next.sound !== soundOn) {
        soundOn = next.sound;
        if (audio) audio.setEnabled(soundOn);
      }
      const now = performance.now();
      if (next.threads !== threads) {
        threads = next.threads;
        introDrive = null;
        keyDrive = null;
        swish = null;
        aim = 0;
        grabs.clear();
        focusRow = -1;
        resetChain(weft);
        resetChain(warp);
        columnWeave.fill(next.weave);
        if (!reducedMotion && now - lastThreadsChange > THREADS_REBUILD_GAP_MS) {
          const spread = WARP_POP_SPREAD_MS / threads;
          for (let j = 0; j < threads; j += 1) warp.popStart[j] = now + j * spread;
        }
        lastThreadsChange = now;
        resize();
      } else if (next.weave !== weave && !reducedMotion) {
        for (let j = 0; j < threads; j += 1) {
          warp.popStart[j] = now + j * (WARP_POP_SPREAD_MS / threads);
        }
      }
      weave = next.weave;
      draw();
      wake();
    },
    primeAudio: primeOnGesture,
    invalidateRect() {
      rect = null;
    },
    destroy() {
      destroyed = true;
      clearTimeout(lostTimer);
      clearTimeout(idleTimer);
      for (const timer of neighbourTimers) clearTimeout(timer);
      neighbourTimers.length = 0;
      if (frameId) cancelAnimationFrame(frameId);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("lostpointercapture", onPointerCancel);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("pointerenter", onPointerEnter);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      for (const entry of textures.values()) if (entry.texture) gl.deleteTexture(entry.texture);
      textures.clear();
      gl.deleteTexture(stateTexture);
      gl.deleteTexture(blankTexture);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      audio?.close();
      audio = null;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
    onKeyDown,
    onKeyUp,
    onBlur,
  };

  return engine;
}
