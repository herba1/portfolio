import createResolutionGovernor from "@/app/experiments/resolutionGovernor";

import { DEBRIS_FLOATS, DEBRIS_SLOTS, createDebris } from "./scorchDebris";
import { detachIslands } from "./scorchIslands";
import { BLEED, CURL, DEBRIS, DETACH, FLAME, SCORCH_DEFAULTS, SIM } from "./scorchParams";
import { fuelAt, loadPhoto } from "./scorchPhotos";
import {
  SCORCH_DEBRIS_FRAGMENT,
  SCORCH_DEBRIS_VERTEX,
  SCORCH_DISPLAY,
  SCORCH_FUEL,
  SCORCH_GLOW,
  SCORCH_MASK,
  SCORCH_SIM,
  SCORCH_STATS,
  SCORCH_VERTEX,
} from "./scorchShader";

const GLOW_SIZE = 64;
const STATS_SIZE = 16;
const STATS_EVERY = 20;
const MAX_SOURCES = 8;
const MAX_STEPS_PER_FRAME = 16;
const PRESIM_STEPS_PER_FRAME = 160;
const PRESIM_STEPS_PER_FRAME_SMALL = 80;
const INTRO_ID = "intro";
const CRACKLE_FULL = 0.45;
export const DOUSE_SECONDS = 0.6;
const DOUSE_RATE = 6;
const HEAT_ALIVE = SIM.thresholdFloor * 0.85;
const WIND_REST = 0.002;
const PAPER = [0.925, 0.906, 0.871];
const LOOKAHEAD = 3;
const HALF_FLOAT_MIN_DELTA = 0.0008;
const CORNER_PX = 4;
const BREAK_GAP_MS = 380;
const MASK_TAP = 0.3;
const LATE_FADE_MS = 420;
const FLAME_GONE = 0.005;
const FLAME_VELOCITY_EASE = 0.3;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader: ${log}`);
  }
  return shader;
}

function link(gl, vertex, fragmentSource) {
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`program: ${log}`);
  }
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let index = 0; index < count; index += 1) {
    const info = gl.getActiveUniform(program, index);
    const name = info.name.replace(/\[0\]$/, "");
    uniforms[name] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms };
}

function makeSurface(gl, width, height, internalFormat) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, width, height);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer, size: width, width, height, complete };
}

function makeTarget(gl, size, internalFormat) {
  return makeSurface(gl, size, size, internalFormat);
}

function releaseSurface(gl, surface) {
  if (!surface) return;
  gl.deleteTexture(surface.texture);
  gl.deleteFramebuffer(surface.framebuffer);
}

function makeCurlGrid(cells) {
  const side = cells + 1;
  const layerVertices = side * side;
  const vertices = new Float32Array(layerVertices * 2 * 3);
  const indices = new Uint16Array(cells * cells * 6 * 2);
  let cursor = 0;
  for (let layer = 0; layer < 2; layer += 1) {
    for (let row = 0; row < side; row += 1) {
      for (let column = 0; column < side; column += 1) {
        vertices[cursor] = (column / cells) * 2 - 1;
        vertices[cursor + 1] = (row / cells) * 2 - 1;
        vertices[cursor + 2] = layer;
        cursor += 3;
      }
    }
  }
  cursor = 0;
  for (let layer = 0; layer < 2; layer += 1) {
    const base = layer * layerVertices;
    for (let row = 0; row < cells; row += 1) {
      for (let column = 0; column < cells; column += 1) {
        const corner = base + row * side + column;
        indices[cursor] = corner;
        indices[cursor + 1] = corner + 1;
        indices[cursor + 2] = corner + side;
        indices[cursor + 3] = corner + 1;
        indices[cursor + 4] = corner + side + 1;
        indices[cursor + 5] = corner + side;
        cursor += 6;
      }
    }
  }
  return { vertices, indices };
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function clampUv(value) {
  return Math.min(0.94, Math.max(0.06, value));
}

function seedFor(index) {
  const value = Math.sin(index * 91.7 + 13.1) * 43758.5453;
  return (value - Math.floor(value)) * 10;
}

export function createScorchEngine(canvas, options) {
  const { sheets, gridSize, dprCap, reducedMotion, onSheet, onBurnt, onReady, onError, onActivity, onIgnite, onBreak } = options;

  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: true,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  if (!gl) {
    onError("webgl2");
    return null;
  }
  const fullFloat = gl.getExtension("EXT_color_buffer_float");
  const halfFloat = fullFloat ? null : gl.getExtension("EXT_color_buffer_half_float");
  if (!fullFloat && !halfFloat) {
    onError("float");
    return null;
  }
  const floatLinear = gl.getExtension("OES_texture_float_linear");
  const anisotropy = gl.getExtension("EXT_texture_filter_anisotropic");

  let vertex;
  let debrisVertex;
  let fuelPass;
  let simPass;
  let glowPass;
  let statsPass;
  let displayPass;
  let maskPass;
  let debrisPass;
  try {
    vertex = compile(gl, gl.VERTEX_SHADER, SCORCH_VERTEX);
    debrisVertex = compile(gl, gl.VERTEX_SHADER, SCORCH_DEBRIS_VERTEX);
    fuelPass = link(gl, vertex, SCORCH_FUEL);
    simPass = link(gl, vertex, SCORCH_SIM);
    glowPass = link(gl, vertex, SCORCH_GLOW);
    statsPass = link(gl, vertex, SCORCH_STATS);
    displayPass = link(gl, vertex, SCORCH_DISPLAY);
    maskPass = link(gl, vertex, SCORCH_MASK);
    debrisPass = link(gl, debrisVertex, SCORCH_DEBRIS_FRAGMENT);
  } catch {
    onError("shader");
    return null;
  }

  const size = gridSize;
  const presimSteps = size > 256 ? PRESIM_STEPS_PER_FRAME : PRESIM_STEPS_PER_FRAME_SMALL;
  let stateFormat = fullFloat && floatLinear ? gl.RGBA32F : gl.RGBA16F;
  const makeStates = (count) => Array.from({ length: count }, () => makeTarget(gl, size, stateFormat));
  let stateTargets = makeStates(2);
  if (stateFormat === gl.RGBA32F && stateTargets.some((target) => !target.complete)) {
    for (const target of stateTargets) releaseSurface(gl, target);
    stateFormat = gl.RGBA16F;
    stateTargets = makeStates(2);
  }
  const minDelta = stateFormat === gl.RGBA32F ? 0 : HALF_FLOAT_MIN_DELTA;
  const relicStates = makeStates(DEBRIS_SLOTS);
  const fuelTarget = makeTarget(gl, size, gl.RGBA8);
  const glowTarget = makeTarget(gl, GLOW_SIZE, gl.RGBA16F);
  const statsTarget = makeTarget(gl, STATS_SIZE, gl.RGBA8);
  const maskSize = Math.min(DEBRIS.maskSize, size);
  const maskTarget = makeTarget(gl, maskSize, gl.RGBA8);
  const layers = Array.from({ length: DEBRIS_SLOTS }, () => null);
  const allTargets = () => [...stateTargets, ...relicStates, fuelTarget, glowTarget, statsTarget, maskTarget];
  if (allTargets().some((target) => !target.complete)) {
    onError("float");
    for (const target of allTargets()) releaseSurface(gl, target);
    return null;
  }

  const vao = gl.createVertexArray();
  const debris = createDebris({ reducedMotion });
  const debrisVao = gl.createVertexArray();
  gl.bindVertexArray(debrisVao);
  const debrisBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, debrisBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, debris.instances.byteLength, gl.DYNAMIC_DRAW);
  const instanceAttributes = DEBRIS_FLOATS / 4;
  for (let attribute = 0; attribute < instanceAttributes; attribute += 1) {
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute, 4, gl.FLOAT, false, DEBRIS_FLOATS * 4, attribute * 16);
    gl.vertexAttribDivisor(attribute, 1);
  }
  const curlGrid = makeCurlGrid(CURL.grid);
  const gridBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, gridBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, curlGrid.vertices, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(instanceAttributes);
  gl.vertexAttribPointer(instanceAttributes, 3, gl.FLOAT, false, 0, 0);
  const gridIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gridIndexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, curlGrid.indices, gl.STATIC_DRAW);
  const gridIndexCount = curlGrid.indices.length;
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  gl.bindVertexArray(vao);

  const blank = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([236, 231, 222, 255]));

  const labelTextures = Array.from({ length: DEBRIS_SLOTS }, () => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, maskSize, maskSize);
    return texture;
  });
  const labelCells = Array.from({ length: DEBRIS_SLOTS }, () => new Uint8Array(maskSize * maskSize));
  const nextLabels = Array.from({ length: DEBRIS_SLOTS }, () => 1);
  const islandOptions = {
    holeAt: DEBRIS.holeAt,
    minTexels: DEBRIS.minTexels,
    fleckTexels: DEBRIS.fleckTexels,
    dilate: DEBRIS.dilate,
    lastLabel: DEBRIS.lastLabel,
    room: DEBRIS.maxPieces,
  };
  const maskPixels = new Uint8Array(maskSize * maskSize * 4);
  const maskBuffer = gl.createBuffer();
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, maskBuffer);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, maskPixels.byteLength, gl.STREAM_READ);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);

  const statsPixels = new Uint8Array(STATS_SIZE * STATS_SIZE * 4);
  const statsBuffer = gl.createBuffer();
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, statsBuffer);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, statsPixels.byteLength, gl.STREAM_READ);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const sourceData = new Float32Array(MAX_SOURCES * 4);
  const flameSegments = new Float32Array(FLAME.max * 4);
  const flameShapes = new Float32Array(FLAME.max * 4);
  const sources = [];
  const flames = new Map();
  const governor = createResolutionGovernor({ max: 1, min: 0.55 });
  const sheetCount = sheets.length;
  const slots = new Map();
  const uploads = [];

  let params = { ...SCORCH_DEFAULTS };
  let current = 0;
  let disposed = false;
  let raf = 0;
  let visible = true;
  let lastTime = 0;
  let clock = 0;
  let accumulator = 0;
  let frameCount = 0;
  let heatAlive = false;
  let burnt = 0;
  let presimLeft = 0;
  let ready = false;
  let sheetIndex = -1;
  let underIndex = -1;
  let douseUntil = -1;
  let smotherUntil = -1;
  let statsFence = null;
  let statsSheet = -1;
  let idleChecked = false;
  let maskFence = null;
  let maskSheet = -1;
  let lastMaskAt = -Infinity;
  let lastBurnAt = -Infinity;
  let simSinceMask = false;
  let attachedShare = 1;
  let finishPending = false;
  let lastFinishAt = -Infinity;
  let sheetSlot = 0;
  let cssWidth = 1;
  let cssHeight = 1;
  let dpr = 1;
  let coverX = 0;
  let coverY = 0;
  let coverW = 1;
  let coverH = 1;
  let spotCursor = 0;
  let introGuard = false;
  const spentFlames = new Set();
  const wind = { x: 0, y: 0, tx: 0, ty: 0, at: [0.5, 0.5], driven: false };

  const positionOf = (index) => ((index % sheetCount) + sheetCount) % sheetCount;

  function slotFor(index) {
    const position = positionOf(index);
    let slot = slots.get(position);
    if (!slot) {
      slot = { position, status: "idle", data: null, texture: null };
      slots.set(position, slot);
    }
    return slot;
  }

  function request(index) {
    const slot = slotFor(index);
    if (slot.status !== "idle") return slot;
    slot.status = "loading";
    loadPhoto(sheets[slot.position]).then((data) => {
      if (disposed) return;
      if (!data) {
        slot.status = "failed";
        if ([...slots.values()].filter((entry) => entry.status === "failed").length >= sheetCount) onError("sheets");
        else wake();
        return;
      }
      slot.data = data;
      slot.status = "decoded";
      uploads.push(slot);
      wake();
    });
    return slot;
  }

  function usableFrom(index) {
    for (let step = 0; step < sheetCount; step += 1) {
      const slot = request(index + step);
      if (slot.status !== "failed") return index + step;
    }
    return index;
  }

  function uploadOne() {
    const slot = uploads.shift();
    if (!slot || slot.texture) return;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, slot.data.image);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (anisotropy) gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    slot.data.image = null;
    slot.readyAt = performance.now();
    slot.texture = texture;
    slot.status = "ready";
  }

  function trimSlots() {
    const keep = new Set();
    for (let step = 0; step < LOOKAHEAD; step += 1) keep.add(positionOf(sheetIndex + step));
    if (underIndex >= 0) keep.add(positionOf(underIndex));
    for (const slot of slots.values()) {
      if (keep.has(slot.position) || !slot.texture) continue;
      gl.deleteTexture(slot.texture);
      slot.texture = null;
      slot.data = null;
      slot.status = "idle";
    }
  }

  function prefetch() {
    const base = sheetIndex < 0 ? current : sheetIndex;
    for (let step = 0; step < LOOKAHEAD; step += 1) request(base + step);
    if (underIndex >= 0) request(underIndex);
  }

  function bindTexture(unit, texture) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  function drawInto(target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.size, target.size);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function clearState() {
    for (const target of stateTargets) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, size, size);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function writeFuel() {
    const slot = slotFor(sheetIndex);
    const data = slot.data;
    if (!data || !slot.texture) return;
    const { program, uniforms } = fuelPass;
    gl.useProgram(program);
    bindTexture(0, slot.texture);
    gl.uniform1i(uniforms.uCover, 0);
    gl.uniform4fv(uniforms.uCrop, data.crop);
    gl.uniform1f(uniforms.uLo, data.lo);
    gl.uniform1f(uniforms.uHi, data.hi);
    gl.uniform1f(uniforms.uFuse, params.fuse);
    gl.uniform1f(uniforms.uPaperFloor, SIM.paperFloor);
    gl.uniform1f(uniforms.uSeed, seedFor(sheetIndex));
    drawInto(fuelTarget);
  }

  function stepSeconds() {
    const diffusion = SIM.diffusion * params.heatSpread;
    return Math.min(1 / 120, 0.2 / (diffusion * size * size));
  }

  function sourceRadius(source, age) {
    const grow = reducedMotion ? 1 : easeOutBack(Math.min(1, age / SIM.sourceGrow));
    const base = SIM.sourceRadius * source.reach * grow;
    if (source.id === INTRO_ID) return Math.max(0, base + SIM.introGrow * age);
    const held = Math.max(0, Math.min(age, source.end - source.start) - SIM.sourceGrow);
    return Math.min(SIM.sourceRadius * SIM.holdReachMax, base + SIM.holdSpread * held);
  }

  function activeSources() {
    let count = 0;
    for (let index = sources.length - 1; index >= 0; index -= 1) {
      const source = sources[index];
      if (source.waiting) continue;
      const age = clock - source.start;
      const until = Math.min(source.start + source.life, Math.max(source.start + SIM.sourceHold, source.end));
      if (clock > until) {
        sources.splice(index, 1);
        continue;
      }
      if (age < 0 || count >= MAX_SOURCES) continue;
      sourceData[count * 4] = source.u;
      sourceData[count * 4 + 1] = source.v;
      sourceData[count * 4 + 2] = sourceRadius(source, age);
      sourceData[count * 4 + 3] = SIM.sourceHeat;
      count += 1;
    }
    for (let index = count * 4; index < sourceData.length; index += 1) sourceData[index] = 0;
    return count;
  }

  function flameLive(flame, now) {
    return flame.on || flame.startedAt < 0 || now - flame.startedAt < FLAME.tapMs;
  }

  function flamesBusy(now) {
    for (const flame of flames.values()) if (flame.strength > FLAME_GONE || flameLive(flame, now)) return true;
    return false;
  }

  function flameRadius(flame) {
    return FLAME.radius * (1 + Math.min(FLAME.growMax, flame.held * FLAME.growRate));
  }

  function updateFlames(now, dt) {
    const heldLimit = FLAME.growMax / FLAME.growRate;
    for (const [id, flame] of flames) {
      if (flame.startedAt < 0) flame.startedAt = now;
      const live = flameLive(flame, now);
      const target = live ? 1 : 0;
      const rate = target > flame.strength ? FLAME.rise : FLAME.fall;
      flame.strength += (target - flame.strength) * (1 - Math.exp(-dt * rate));
      const still = 1 / (1 + Math.hypot(flame.vx, flame.vy) / FLAME.stillSpeed);
      flame.held = live ? Math.min(heldLimit, Math.max(0, flame.held + dt * (still - 0.5) * 2)) : Math.max(0, flame.held - dt * 3);
      flame.vx += ((flame.u - flame.lastU) / dt - flame.vx) * FLAME_VELOCITY_EASE;
      flame.vy += ((flame.v - flame.lastV) / dt - flame.vy) * FLAME_VELOCITY_EASE;
      flame.lastU = flame.u;
      flame.lastV = flame.v;
      if (!live && flame.strength < FLAME_GONE) flames.delete(id);
    }
  }

  function dropFaintest() {
    let faintestId = null;
    let faintest = Infinity;
    for (const [id, flame] of flames) {
      if (flame.on || flame.strength >= faintest) continue;
      faintest = flame.strength;
      faintestId = id;
    }
    if (faintestId !== null) flames.delete(faintestId);
  }

  function writeFlames(step, planned, stepDt) {
    let count = 0;
    for (const flame of flames.values()) {
      if (count >= FLAME.max) break;
      if (flame.strength < FLAME_GONE) continue;
      const start = step / planned;
      const end = (step + 1) / planned;
      const fromU = flame.fromU + (flame.u - flame.fromU) * start;
      const fromV = flame.fromV + (flame.v - flame.fromV) * start;
      const toU = flame.fromU + (flame.u - flame.fromU) * end;
      const toV = flame.fromV + (flame.v - flame.fromV) * end;
      const radius = flameRadius(flame);
      const dwell = (2 * radius) / (2 * radius + Math.hypot(toU - fromU, toV - fromV));
      const dose = flame.strength * stepDt * dwell;
      flameSegments[count * 4] = fromU;
      flameSegments[count * 4 + 1] = fromV;
      flameSegments[count * 4 + 2] = toU;
      flameSegments[count * 4 + 3] = toV;
      flameShapes[count * 4] = radius;
      flameShapes[count * 4 + 1] = FLAME.heatRate * dose;
      flameShapes[count * 4 + 2] = FLAME.cap;
      flameShapes[count * 4 + 3] = FLAME.char * dose;
      count += 1;
    }
    return count;
  }

  function settleFlames() {
    for (const flame of flames.values()) {
      flame.fromU = flame.u;
      flame.fromV = flame.v;
    }
  }

  function startWaiting() {
    const started = [];
    for (const source of sources) {
      if (!source.waiting) continue;
      source.waiting = false;
      const released = source.end !== Infinity;
      source.start = clock;
      if (released) source.end = clock;
      started.push(source.id);
    }
    if (!started.length) return;
    introGuard = false;
    douseUntil = -1;
    smotherUntil = -1;
    heatAlive = true;
    idleChecked = false;
    for (const id of started) onIgnite?.(id);
  }

  function requestFinish() {
    if (!ready || presimLeft > 0 || finishPending) return;
    finishPending = true;
    idleChecked = false;
    wake();
  }

  function bindGone(unit, uniforms) {
    bindTexture(unit, labelTextures[sheetSlot]);
    gl.uniform1i(uniforms.uGone, unit);
    gl.uniform1f(uniforms.uMaskSize, maskSize);
  }

  let readIndex = 0;

  function simulate(dt, sourceCount, flameCount) {
    const { program, uniforms } = simPass;
    gl.useProgram(program);
    const diffusion = SIM.diffusion * params.heatSpread;
    const dousing = clock < douseUntil;
    const smothering = clock < smotherUntil;
    let cooling = 0;
    if (dousing) cooling = DOUSE_RATE;
    else if (smothering) cooling = DOUSE_RATE * SIM.introSmotherRate;
    gl.uniform1i(uniforms.uState, 0);
    gl.uniform1i(uniforms.uFuel, 1);
    gl.uniform2f(uniforms.uTexel, 1 / size, 1 / size);
    gl.uniform1f(uniforms.uDt, dt);
    gl.uniform1f(uniforms.uDiffuse, Math.min(0.24, diffusion * size * size * dt));
    gl.uniform1f(uniforms.uRateBase, SIM.rateBase);
    gl.uniform1f(uniforms.uRateInk, SIM.rateInk);
    gl.uniform1f(uniforms.uGain, SIM.gain);
    gl.uniform1f(uniforms.uKeep, Math.exp(-SIM.loss * dt) * Math.exp((-cooling / params.burnRate) * dt));
    gl.uniform1f(uniforms.uThresholdBase, SIM.thresholdBase);
    gl.uniform1f(uniforms.uThresholdFuel, SIM.thresholdFuel);
    gl.uniform1f(uniforms.uThresholdFloor, SIM.thresholdFloor);
    gl.uniform1f(uniforms.uFibre, SIM.fibreThreshold * params.fibre * 2);
    gl.uniform1f(uniforms.uLinger, params.linger);
    gl.uniform1f(uniforms.uMinDelta, minDelta);
    gl.uniform1f(uniforms.uFuse, params.fuse);
    gl.uniform2f(uniforms.uWind, wind.x, wind.y);
    gl.uniform2f(uniforms.uWindAt, wind.at[0], wind.at[1]);
    gl.uniform1f(uniforms.uWindReach, SIM.windReach);
    gl.uniform1f(uniforms.uWindGlobal, SIM.windGlobal);
    gl.uniform1f(uniforms.uWindCool, SIM.windCool);
    gl.uniform4fv(uniforms.uSources, sourceData);
    gl.uniform1i(uniforms.uSourceCount, dousing ? 0 : sourceCount);
    gl.uniform4fv(uniforms.uFlames, flameSegments);
    gl.uniform4fv(uniforms.uFlameShapes, flameShapes);
    gl.uniform1i(uniforms.uFlameCount, dousing ? 0 : flameCount);
    gl.uniform1f(uniforms.uHoleHeat, DETACH.holeHeat);
    bindGone(2, uniforms);
    bindTexture(1, fuelTarget.texture);
    const from = stateTargets[readIndex];
    const to = stateTargets[1 - readIndex];
    bindTexture(0, from.texture);
    drawInto(to);
    readIndex = 1 - readIndex;
  }

  function writeGlow() {
    const { program, uniforms } = glowPass;
    gl.useProgram(program);
    bindTexture(0, stateTargets[readIndex].texture);
    gl.uniform1i(uniforms.uState, 0);
    const tap = size / GLOW_SIZE / 4 / size;
    gl.uniform2f(uniforms.uTapStep, tap, tap);
    bindGone(1, uniforms);
    drawInto(glowTarget);
  }

  function requestStats() {
    if (statsFence) return;
    const { program, uniforms } = statsPass;
    gl.useProgram(program);
    bindTexture(0, glowTarget.texture);
    gl.uniform1i(uniforms.uGlow, 0);
    gl.uniform2f(uniforms.uGlowTexel, 1 / GLOW_SIZE, 1 / GLOW_SIZE);
    drawInto(statsTarget);
    gl.bindFramebuffer(gl.FRAMEBUFFER, statsTarget.framebuffer);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, statsBuffer);
    gl.readPixels(0, 0, STATS_SIZE, STATS_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    statsSheet = sheetIndex;
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) {
      collectStats();
      return;
    }
    statsFence = fence;
    gl.flush();
  }

  function pollStats() {
    if (!statsFence) return;
    const status = gl.clientWaitSync(statsFence, 0, 0);
    if (status === gl.TIMEOUT_EXPIRED) return;
    gl.deleteSync(statsFence);
    statsFence = null;
    collectStats();
  }

  function collectStats() {
    if (statsSheet !== sheetIndex) return;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, statsBuffer);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, statsPixels);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    let burntSum = 0;
    let hottest = 0;
    let heatSum = 0;
    const cells = STATS_SIZE * STATS_SIZE;
    for (let index = 0; index < cells; index += 1) {
      burntSum += statsPixels[index * 4];
      hottest = Math.max(hottest, statsPixels[index * 4 + 1]);
      heatSum += statsPixels[index * 4 + 2];
    }
    const hottestHeat = (hottest / 255) * 2;
    burnt = burntSum / cells / 255;
    heatAlive = hottestHeat > HEAT_ALIVE;
    onActivity(heatAlive ? (heatSum / cells / 255) * smoothstep(HEAT_ALIVE, CRACKLE_FULL, hottestHeat) : 0);
    if (introGuard && burnt > SIM.introLimit) {
      introGuard = false;
      smotherIntro();
    }
  }

  function requestMask(now) {
    if (maskFence) return;
    const { program, uniforms } = maskPass;
    gl.useProgram(program);
    bindTexture(0, stateTargets[readIndex].texture);
    gl.uniform1i(uniforms.uState, 0);
    gl.uniform1f(uniforms.uSeed, seedFor(sheetIndex));
    gl.uniform1f(uniforms.uTap, MASK_TAP / maskSize);
    drawInto(maskTarget);
    gl.bindFramebuffer(gl.FRAMEBUFFER, maskTarget.framebuffer);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, maskBuffer);
    gl.readPixels(0, 0, maskSize, maskSize, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    maskSheet = sheetIndex;
    lastMaskAt = now;
    simSinceMask = false;
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) {
      collectMask(now);
      return;
    }
    maskFence = fence;
    gl.flush();
  }

  function pollMask(now) {
    if (!maskFence) return;
    const status = gl.clientWaitSync(maskFence, 0, 0);
    if (status === gl.TIMEOUT_EXPIRED) return;
    gl.deleteSync(maskFence);
    maskFence = null;
    collectMask(now);
  }

  function collectMask(now) {
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, maskBuffer);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, maskPixels);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    if (maskSheet !== sheetIndex) return;
    const final = finishPending && finishReady(now);
    const slot = sheetSlot;
    const found = detachIslands(maskPixels, maskSize, labelCells[slot], {
      ...islandOptions,
      final,
      firstLabel: nextLabels[slot],
    });
    if (found.changed) {
      nextLabels[slot] = found.nextLabel;
      uploadLabels(slot);
      if (found.islands.length) {
        drawSheet(ensureLayer(slot), found.firstLabel, found.nextLabel - 1);
        debris.spawn(slot, found, maskSize, final);
      }
    }
    if (final) {
      finishSheet(now);
      return;
    }
    attachedShare = found.attachedShare;
    onBurnt(1 - attachedShare);
    if (found.looseShare > DETACH.quietShare) onBreak?.(Math.min(1, 0.35 + Math.sqrt(found.looseShare) * 1.6));
    if (attachedShare < DETACH.goneShare) requestFinish();
  }

  function uploadLabels(slot) {
    gl.bindTexture(gl.TEXTURE_2D, labelTextures[slot]);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, maskSize, maskSize, gl.RED, gl.UNSIGNED_BYTE, labelCells[slot]);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  function finishReady(now) {
    const resolved = usableFrom(underIndex);
    if (resolved !== underIndex) {
      underIndex = resolved;
      onSheet(positionOf(sheetIndex), positionOf(underIndex));
    }
    if (slotFor(underIndex).status !== "ready") return false;
    if (now - lastFinishAt < BREAK_GAP_MS) return false;
    const following = (sheetSlot + 1) % DEBRIS_SLOTS;
    if (debris.liveIn(following)) {
      debris.hurry(following);
      return false;
    }
    return true;
  }

  function smotherIntro() {
    for (let index = sources.length - 1; index >= 0; index -= 1) if (sources[index].id === INTRO_ID) sources.splice(index, 1);
    smotherUntil = clock + SIM.introSmother;
    wake();
  }

  function ensureLayer(slot) {
    const existing = layers[slot];
    if (existing && ((existing.width === coverW && existing.height === coverH) || debris.liveIn(slot))) return existing;
    releaseSurface(gl, existing);
    layers[slot] = makeSurface(gl, coverW, coverH, gl.RGBA8);
    return layers[slot];
  }

  function underFade(now) {
    const under = slotFor(underIndex);
    if (under.status !== "ready" || !under.texture) return 0;
    return smoothstep(0, LATE_FADE_MS, now - under.readyAt);
  }

  function drawSheet(layer, freshFrom = 0, freshTo = 0) {
    const sheet = slotFor(sheetIndex);
    const under = slotFor(underIndex);
    const underReady = layer ? 0 : underFade(performance.now());
    const width = layer ? layer.width : coverW;
    const height = layer ? layer.height : coverH;
    const { program, uniforms } = displayPass;
    gl.useProgram(program);
    bindTexture(0, stateTargets[readIndex].texture);
    bindTexture(1, glowTarget.texture);
    bindTexture(2, sheet.texture ?? blank);
    bindTexture(3, underReady > 0 ? under.texture : blank);
    gl.uniform1i(uniforms.uState, 0);
    gl.uniform1i(uniforms.uGlow, 1);
    gl.uniform1i(uniforms.uSheet, 2);
    gl.uniform1i(uniforms.uUnder, 3);
    bindGone(4, uniforms);
    gl.uniform1f(uniforms.uFreshFrom, freshFrom);
    gl.uniform1f(uniforms.uFreshTo, freshTo);
    gl.uniform4fv(uniforms.uSheetCrop, sheet.data?.crop ?? [1, 1, 0, 0]);
    gl.uniform4fv(uniforms.uUnderCrop, underReady > 0 ? under.data.crop : [1, 1, 0, 0]);
    gl.uniform2f(uniforms.uResolution, width, height);
    gl.uniform2f(uniforms.uGlowTexel, 1 / GLOW_SIZE, 1 / GLOW_SIZE);
    gl.uniform1f(uniforms.uTime, clock);
    gl.uniform1f(uniforms.uEmber, params.ember);
    gl.uniform1f(uniforms.uCharTone, params.charTone);
    gl.uniform1f(uniforms.uHalo, params.halo);
    gl.uniform1f(uniforms.uFlicker, reducedMotion ? 0 : 1);
    gl.uniform1f(uniforms.uSeed, seedFor(sheetIndex));
    gl.uniform1f(uniforms.uUnderReady, underReady);
    gl.uniform3fv(uniforms.uPaper, PAPER);
    gl.uniform1f(uniforms.uLayer, layer ? 1 : 0);
    gl.uniform1f(uniforms.uCorner, CORNER_PX * dpr);
    gl.uniform1f(uniforms.uCurlShift, CURL.sheetShift);
    gl.uniform1f(uniforms.uCurlSlope, CURL.sheetSlope);
    gl.uniform1f(uniforms.uCurlShade, CURL.sheetShade);
    gl.uniform1f(uniforms.uCurlShadow, CURL.shadow);
    gl.uniform1f(uniforms.uShadowReach, CURL.shadowReach);
    if (layer) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      gl.viewport(0, 0, width, height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(coverX, coverY, coverW, coverH);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function drawDebris() {
    const count = debris.write();
    if (!count) return;
    const { program, uniforms } = debrisPass;
    gl.useProgram(program);
    bindTexture(0, layers[0]?.texture ?? blank);
    bindTexture(1, layers[1]?.texture ?? blank);
    bindTexture(2, stateFor(0).texture);
    bindTexture(3, stateFor(1).texture);
    bindTexture(4, labelTextures[0]);
    bindTexture(5, labelTextures[1]);
    gl.uniform1i(uniforms.uLayerA, 0);
    gl.uniform1i(uniforms.uLayerB, 1);
    gl.uniform1i(uniforms.uRelicA, 2);
    gl.uniform1i(uniforms.uRelicB, 3);
    gl.uniform1i(uniforms.uLabelsA, 4);
    gl.uniform1i(uniforms.uLabelsB, 5);
    gl.uniform1f(uniforms.uWarmReach, 0.5 / GLOW_SIZE);
    gl.uniform1f(uniforms.uMaskSize, maskSize);
    gl.uniform4f(uniforms.uBleed, coverX / coverW, coverY / coverH, canvas.width / coverW, canvas.height / coverH);
    gl.uniform1f(uniforms.uAspect, coverW / coverH);
    gl.uniform1f(uniforms.uCamera, CURL.camera);
    gl.uniform1f(uniforms.uTime, clock);
    gl.uniform1f(uniforms.uEmber, params.ember);
    gl.uniform1f(uniforms.uCharTone, params.charTone);
    gl.uniform1f(uniforms.uFlicker, reducedMotion ? 0 : 1);
    gl.uniform3fv(uniforms.uPaper, PAPER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.bindVertexArray(debrisVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, debrisBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, debris.instances, 0, count * DEBRIS_FLOATS);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawElementsInstanced(gl.TRIANGLES, gridIndexCount, gl.UNSIGNED_SHORT, 0, count);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(vao);
  }

  function render() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawSheet(null);
    drawDebris();
  }

  function stateFor(slot) {
    return slot === sheetSlot ? stateTargets[readIndex] : relicStates[slot];
  }

  function retire(slot) {
    const spareState = relicStates[slot];
    relicStates[slot] = stateTargets[readIndex];
    stateTargets[readIndex] = spareState;
  }

  function spendFlames() {
    for (const id of flames.keys()) spentFlames.add(id);
    flames.clear();
  }

  function finishSheet(now) {
    finishPending = false;
    lastFinishAt = now;
    retire(sheetSlot);
    sheetSlot = (sheetSlot + 1) % DEBRIS_SLOTS;
    labelCells[sheetSlot].fill(0);
    nextLabels[sheetSlot] = 1;
    uploadLabels(sheetSlot);
    installNext();
    onBreak?.(1);
  }

  function installNext() {
    sheetIndex = underIndex;
    underIndex = usableFrom(sheetIndex + 1);
    introGuard = false;
    burnt = 0;
    attachedShare = 1;
    simSinceMask = false;
    lastMaskAt = -Infinity;
    lastBurnAt = -Infinity;
    heatAlive = false;
    douseUntil = -1;
    smotherUntil = -1;
    wind.x = 0;
    wind.y = 0;
    spotCursor = 0;
    for (let index = sources.length - 1; index >= 0; index -= 1) if (!sources[index].waiting) sources.splice(index, 1);
    spendFlames();
    clearState();
    writeFuel();
    writeGlow();
    trimSlots();
    prefetch();
    onBurnt(0);
    onSheet(positionOf(sheetIndex), positionOf(underIndex));
  }

  function tryStart() {
    if (ready) return;
    const first = usableFrom(current);
    const sheet = slotFor(first);
    if (sheet.status !== "ready") return;
    const second = usableFrom(first + 1);
    if (slotFor(second).status !== "ready") return;
    sheetIndex = first;
    underIndex = second;
    clearState();
    writeFuel();
    const quiet = sheet.data.quiet;
    const settle = clock + SIM.presimSeconds + SIM.introLinger;
    sources.push({ id: INTRO_ID, u: quiet.u, v: quiet.v, reach: SIM.introReach, start: clock, end: settle, life: Infinity, waiting: false });
    sources.push({
      id: INTRO_ID,
      u: clampUv(quiet.u + SIM.introSecondOffset[0]),
      v: clampUv(quiet.v + SIM.introSecondOffset[1]),
      reach: SIM.introSecondReach,
      start: clock + SIM.introSecondDelay,
      end: settle + SIM.introSecondDelay * 0.4,
      life: Infinity,
      waiting: false,
    });
    introGuard = true;
    presimLeft = SIM.presimSeconds;
    ready = true;
    onSheet(positionOf(sheetIndex), positionOf(underIndex));
  }

  function updateWind(dt) {
    const easing = 1 - Math.exp(-dt * SIM.windEase);
    if (wind.driven) {
      wind.x += (wind.tx - wind.x) * easing;
      wind.y += (wind.ty - wind.y) * easing;
    } else {
      const decay = Math.exp(-dt / SIM.windDecay);
      wind.x *= decay;
      wind.y *= decay;
    }
    if (Math.hypot(wind.x, wind.y) < WIND_REST * 0.5 && !wind.driven) {
      wind.x = 0;
      wind.y = 0;
    }
  }

  function needsFrames(now) {
    if (!ready) return uploads.length > 0;
    return (
      presimLeft > 0 ||
      uploads.length > 0 ||
      heatAlive ||
      sources.length > 0 ||
      finishPending ||
      maskFence !== null ||
      (slotFor(underIndex).status === "ready" && underFade(now) < 1) ||
      (simSinceMask && now - lastBurnAt <= DETACH.tailMs) ||
      debris.count > 0 ||
      flamesBusy(now) ||
      wind.driven ||
      Math.hypot(wind.x, wind.y) > WIND_REST ||
      clock < Math.max(douseUntil, smotherUntil) + 0.2
    );
  }

  function frame(now) {
    raf = 0;
    if (disposed || !visible) return;
    const elapsed = lastTime ? now - lastTime : 16;
    lastTime = now;
    const dt = Math.min(1 / 30, Math.max(1 / 240, elapsed / 1000));
    uploadOne();
    if (!ready) {
      tryStart();
      if (!ready) {
        if (needsFrames(now)) schedule();
        else lastTime = 0;
        return;
      }
    }

    const stepDt = stepSeconds();
    if (presimLeft > 0) {
      let steps = 0;
      while (presimLeft > 0 && steps < presimSteps) {
        clock += stepDt;
        simulate(stepDt, activeSources(), 0);
        presimLeft -= stepDt;
        steps += 1;
      }
      writeGlow();
      if (presimLeft <= 0) {
        settleFlames();
        startWaiting();
        render();
        requestStats();
        onReady();
      }
      schedule();
      return;
    }

    pollStats();
    pollMask(now);
    updateWind(dt);
    updateFlames(now, dt);
    if (heatAlive || flamesBusy(now) || sources.some((source) => !source.waiting)) lastBurnAt = now;

    accumulator += dt * params.burnRate;
    const planned = Math.min(MAX_STEPS_PER_FRAME, Math.floor(accumulator / stepDt));
    for (let step = 0; step < planned; step += 1) {
      clock += stepDt / params.burnRate;
      simulate(stepDt, activeSources(), writeFlames(step, planned, stepDt));
      accumulator -= stepDt;
    }
    if (planned >= MAX_STEPS_PER_FRAME) accumulator = 0;
    if (planned === 0) clock += dt;
    else {
      settleFlames();
      simSinceMask = true;
    }
    writeGlow();
    debris.step(dt, flames);
    render();
    scheduleMask(now);
    frameCount += 1;
    if (frameCount % STATS_EVERY === 0) requestStats();
    if (governor.sample(elapsed)) {
      applySize();
      render();
    }
    if (needsFrames(now)) {
      idleChecked = false;
      schedule();
    } else if (statsFence) {
      schedule();
    } else if (!idleChecked) {
      idleChecked = true;
      requestStats();
      schedule();
    } else {
      idleChecked = false;
      onActivity(0);
      lastTime = 0;
    }
  }

  function scheduleMask(now) {
    if (maskFence) return;
    if (finishPending) {
      if (finishReady(now)) requestMask(now);
      return;
    }
    if (!simSinceMask || now - lastMaskAt < DETACH.everyMs || now - lastBurnAt > DETACH.tailMs) return;
    requestMask(now);
  }

  function schedule() {
    if (raf || disposed || !visible) return;
    raf = requestAnimationFrame(frame);
  }

  function wake() {
    schedule();
  }

  function applySize() {
    const ratio = Math.min(window.devicePixelRatio || 1, dprCap) * governor.scale;
    dpr = ratio;
    coverW = Math.max(1, Math.round(cssWidth * ratio));
    coverH = Math.max(1, Math.round(cssHeight * ratio));
    coverX = Math.round(cssWidth * BLEED.left * ratio);
    coverY = Math.round(cssHeight * BLEED.bottom * ratio);
    const width = Math.max(1, Math.round(cssWidth * (1 + BLEED.left + BLEED.right) * ratio));
    const height = Math.max(1, Math.round(cssHeight * (1 + BLEED.top + BLEED.bottom) * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function douse() {
    if (!ready) return;
    sources.length = 0;
    douseUntil = clock + DOUSE_SECONDS;
    wind.driven = false;
    wind.tx = 0;
    wind.ty = 0;
    wake();
  }

  function redraw() {
    if (!ready || presimLeft > 0 || disposed) return;
    render();
  }

  const handleLost = (event) => {
    event.preventDefault();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    onError("lost");
  };
  canvas.addEventListener("webglcontextlost", handleLost);

  prefetch();
  schedule();

  return {
    setParams(next) {
      const fuseChanged = next.fuse !== params.fuse;
      params = { ...next };
      if (fuseChanged && ready) writeFuel();
      redraw();
      wake();
    },
    resize(width, height) {
      cssWidth = width;
      cssHeight = height;
      applySize();
      redraw();
    },
    setVisible(next) {
      visible = next;
      if (!next) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        lastTime = 0;
        return;
      }
      wake();
    },
    isReady() {
      return ready && presimLeft <= 0;
    },
    fuelAt(u, v) {
      if (sheetIndex < 0) return 0.5;
      return fuelAt(slotFor(sheetIndex).data, u, v);
    },
    darkestSpot() {
      if (sheetIndex < 0) return { u: 0.5, v: 0.5 };
      const spots = slotFor(sheetIndex).data?.spots ?? [];
      if (!spots.length) return { u: 0.5, v: 0.5 };
      const spot = spots[spotCursor % spots.length];
      spotCursor += 1;
      return spot;
    },
    ignite(id, u, v) {
      if (!ready || disposed) return null;
      for (let index = sources.length - 1; index >= 0; index -= 1) if (sources[index].id === id) sources.splice(index, 1);
      const waiting = presimLeft > 0;
      sources.push({ id, u, v, reach: 1, start: clock, end: Infinity, life: Infinity, waiting });
      idleChecked = false;
      if (!waiting) {
        introGuard = false;
        douseUntil = -1;
        smotherUntil = -1;
        heatAlive = true;
      }
      wake();
      return waiting ? "queued" : "lit";
    },
    release(id) {
      for (let index = sources.length - 1; index >= 0; index -= 1) {
        const source = sources[index];
        if (source.id !== id || source.end !== Infinity) continue;
        if (source.waiting) sources.splice(index, 1);
        else source.end = clock;
      }
    },
    flame(id, u, v) {
      if (disposed || spentFlames.has(id)) return;
      let flame = flames.get(id);
      if (!flame) {
        if (flames.size >= FLAME.max) dropFaintest();
        flame = { u, v, fromU: u, fromV: v, lastU: u, lastV: v, vx: 0, vy: 0, strength: 0, held: 0, on: true, startedAt: -1 };
        flames.set(id, flame);
      }
      flame.u = u;
      flame.v = v;
      flame.on = true;
      introGuard = false;
      idleChecked = false;
      wake();
    },
    flameOut(id) {
      spentFlames.delete(id);
      const flame = flames.get(id);
      if (!flame) return;
      flame.on = false;
      wake();
    },
    blow(u, v, vx, vy) {
      const scale = SIM.windScale * params.wind;
      let x = vx * scale;
      let y = vy * scale;
      const length = Math.hypot(x, y);
      const limit = SIM.windMax * Math.max(0.2, params.wind);
      if (length > limit) {
        x = (x / length) * limit;
        y = (y / length) * limit;
      }
      wind.tx = x;
      wind.ty = y;
      wind.at[0] = u;
      wind.at[1] = v;
      wind.driven = length > 0;
      wake();
    },
    calm() {
      wind.driven = false;
      wind.tx = 0;
      wind.ty = 0;
      wake();
    },
    douse,
    skip() {
      requestFinish();
    },
    get dpr() {
      return dpr;
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      canvas.removeEventListener("webglcontextlost", handleLost);
      for (const slot of slots.values()) {
        if (slot.texture) gl.deleteTexture(slot.texture);
        slot.texture = null;
        slot.data = null;
      }
      for (const target of allTargets()) releaseSurface(gl, target);
      for (const layer of layers) releaseSurface(gl, layer);
      gl.deleteTexture(blank);
      if (statsFence) gl.deleteSync(statsFence);
      statsFence = null;
      if (maskFence) gl.deleteSync(maskFence);
      maskFence = null;
      for (const texture of labelTextures) gl.deleteTexture(texture);
      gl.deleteBuffer(maskBuffer);
      gl.deleteBuffer(statsBuffer);
      gl.deleteBuffer(debrisBuffer);
      gl.deleteBuffer(gridBuffer);
      gl.deleteBuffer(gridIndexBuffer);
      for (const pass of [fuelPass, simPass, glowPass, statsPass, displayPass, maskPass, debrisPass]) gl.deleteProgram(pass.program);
      gl.deleteShader(vertex);
      gl.deleteShader(debrisVertex);
      gl.deleteVertexArray(vao);
      gl.deleteVertexArray(debrisVao);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
