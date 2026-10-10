import createResolutionGovernor from "@/app/experiments/resolutionGovernor";

import { ADVECT_FRAGMENT, DISPLAY_FRAGMENT, ENCODE_FRAGMENT, TRIANGLE_VERTEX } from "./moshShader";

const REFERENCE_BUFFER = 512;
const SIGMA_BLOCKS = 1.6;
const INJECT_SHARE = 0.9;
const VECTOR_QUANTUM = 4;
const BLEED_PER_FRAME = 0.04;
const SNAP_SPEED = 0.25;
const REST_SPEED = 0.05;
const MAX_SPEED = 9;
const TEAR_DRAG = 0.35;
const MELT_SPEED = 0.75;
const DRAG_GAIN = 0.55;
const DRAG_SMOOTH_MS = 36;
const SCRIPT_GAIN = 0.4;
const SWEEP_MS = 260;
const RUNG_MS = 34;
const RUNGS = 4;
const CROSSFADE_MS = 200;
const FREEZE_BLOCKS = 2;
const PAN_HOLD_MS = 300;
const PAN_SPEED = 6;
const PAN_TAU = 0.35;
const REVEAL_MS = 900;
const PRESIM_FRAMES = 40;
const PRESIM_BATCH = 10;
const COUNTER_EVERY = 4;
const OVERLAY_RATE = 12;
const LENS_HOVER_BLOCKS = 3.4;
const LENS_PRESS_BLOCKS = 7.5;
const TICK_RADIUS_CSS = 0.85;
const RING_STEP = 20 / 255;
const RING_RATE = 0.22;
const TICK_FULL_SPEED = 4;
const LUMA_SHARE = 0.6;

const INTRO_SWIPE = { from: [0.08, 0.14], via: [0.38, 0.66], to: [0.94, 0.82], seconds: 0.5, gain: 0.24 };

export const SWIPES = [
  { from: [0.1, 0.18], via: [0.42, 0.62], to: [0.9, 0.8], seconds: 0.5, gain: SCRIPT_GAIN },
  { from: [0.9, 0.24], via: [0.5, 0.3], to: [0.12, 0.72], seconds: 0.44, gain: SCRIPT_GAIN },
  { from: [0.22, 0.9], via: [0.28, 0.38], to: [0.8, 0.1], seconds: 0.46, gain: SCRIPT_GAIN },
  { from: [0.06, 0.5], via: [0.5, 0.6], to: [0.94, 0.42], seconds: 0.4, gain: SCRIPT_GAIN },
];

function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

function bezierPoint(swipe, t, out) {
  const inverse = 1 - t;
  out[0] = inverse * inverse * swipe.from[0] + 2 * inverse * t * swipe.via[0] + t * t * swipe.to[0];
  out[1] = inverse * inverse * swipe.from[1] + 2 * inverse * t * swipe.via[1] + t * t * swipe.to[1];
  return out;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log || "Shader failed to compile");
  }
  return shader;
}

function buildProgram(gl, vertex, fragmentSource) {
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(log || "Program failed to link");
  }
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let index = 0; index < count; index += 1) {
    const active = gl.getActiveUniform(program, index);
    uniforms[active.name] = gl.getUniformLocation(program, active.name);
  }
  return { program, uniforms };
}

function setInt(gl, target, name, value) {
  const location = target.uniforms[name];
  if (location) gl.uniform1i(location, value);
}

function setFloat(gl, target, name, value) {
  const location = target.uniforms[name];
  if (location) gl.uniform1f(location, value);
}

function setVec2(gl, target, name, x, y) {
  const location = target.uniforms[name];
  if (location) gl.uniform2f(location, x, y);
}

function mipLevels(size) {
  return Math.floor(Math.log2(size)) + 1;
}

export default function createMoshEngine({ canvas, covers, bufferSize, dprCap, reducedMotion, callbacks }) {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  if (!gl) throw new Error("WebGL2 is not available");

  const size = bufferSize;
  const speedScale = size / REFERENCE_BUFFER;
  const maxSpeed = MAX_SPEED * speedScale;
  const meltSpeed = MELT_SPEED * speedScale;
  const governor = createResolutionGovernor({ max: 1, min: 0.6 });
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = size;
  cropCanvas.height = size;
  const cropContext = cropCanvas.getContext("2d");

  const records = covers.map((cover) => ({ url: cover.image, status: "idle", image: null }));
  const textures = new Map();
  const uploadQueue = [];
  const scratchPoint = [0, 0];

  const params = { block: 16, persistence: 1.4, residual: 0.035, ringing: 0.35, subsample: true, vectors: false };

  let gpu = null;
  let floatFrames = false;
  let lost = false;
  let disposed = false;

  let block = 16;
  let blockLevel = 4;
  let grid = size / block;
  let chromaGrid = grid / 2;
  let velocityX = new Float32Array(grid * grid);
  let velocityY = new Float32Array(grid * grid);
  let spareX = new Float32Array(grid * grid);
  let spareY = new Float32Array(grid * grid);
  let carryX = new Float32Array(grid * grid);
  let carryY = new Float32Array(grid * grid);
  let chromaCarryX = new Float32Array(chromaGrid * chromaGrid);
  let chromaCarryY = new Float32Array(chromaGrid * chromaGrid);
  let rungs = new Float32Array(grid * grid);
  let shiftData = new Float32Array(grid * grid * 4);
  let infoData = new Float32Array(grid * grid * 4);

  let current = 0;
  let target = records.length > 1 ? 1 : 0;
  let pending = -1;
  let seeded = false;
  let introPlayed = false;
  let presimRemaining = 0;
  let frameIndex = 0;
  let simFrame = 0;

  let energy = 0;
  let framesSinceKey = 0;
  let counterTick = 0;
  let key = null;
  let script = null;
  let freeze = null;
  let panX = 0;
  let panY = 0;
  let panHold = 0;
  let pressed = false;
  let dragVelocityX = 0;
  let dragVelocityY = 0;
  let engaged = false;
  let afterDrag = false;
  let pointerX = size / 2;
  let pointerY = size / 2;
  let lensTarget = 0;
  let lensShow = 0;
  let lensRadius = LENS_HOVER_BLOCKS;
  let fieldShow = 0;
  let reveal = reducedMotion ? 1 : 0;
  let revealStart = -1;
  let holdingCover = !reducedMotion;

  let cssSize = 0;
  let deviceRatio = 1;
  let active = false;
  let raf = 0;
  let last = 0;
  let dirty = true;

  function allocateField() {
    const previousBlock = block;
    const previousGrid = grid;
    const previousX = velocityX;
    const previousY = velocityY;
    block = params.block;
    blockLevel = Math.round(Math.log2(block));
    grid = size / block;
    chromaGrid = Math.max(1, grid / 2);
    const cells = grid * grid;
    velocityX = new Float32Array(cells);
    velocityY = new Float32Array(cells);
    let peak = 0;
    for (let y = 0; y < grid; y += 1) {
      const fromY = Math.min(previousGrid - 1, Math.floor(((y + 0.5) * block) / previousBlock));
      for (let x = 0; x < grid; x += 1) {
        const fromX = Math.min(previousGrid - 1, Math.floor(((x + 0.5) * block) / previousBlock));
        const from = fromY * previousGrid + fromX;
        const cell = y * grid + x;
        velocityX[cell] = previousX[from];
        velocityY[cell] = previousY[from];
        peak = Math.max(peak, Math.hypot(velocityX[cell], velocityY[cell]));
      }
    }
    spareX = new Float32Array(cells);
    spareY = new Float32Array(cells);
    carryX = new Float32Array(cells);
    carryY = new Float32Array(cells);
    chromaCarryX = new Float32Array(chromaGrid * chromaGrid);
    chromaCarryY = new Float32Array(chromaGrid * chromaGrid);
    rungs = new Float32Array(cells);
    shiftData = new Float32Array(cells * 4);
    infoData = new Float32Array(cells * 4);
    if (gpu) {
      gl.deleteTexture(gpu.shiftTexture);
      gl.deleteTexture(gpu.infoTexture);
      gpu.shiftTexture = fieldTexture();
      gpu.infoTexture = fieldTexture();
      uploadField();
    }
    energy = peak;
  }

  function fieldTexture() {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, grid, grid);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  function frameTexture(internalFormat) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, mipLevels(size), internalFormat, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  function buildFrames(internalFormat) {
    const frames = [frameTexture(internalFormat), frameTexture(internalFormat)];
    const framebuffers = frames.map((texture) => {
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      return framebuffer;
    });
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (complete) return { frames, framebuffers };
    frames.forEach((texture) => gl.deleteTexture(texture));
    framebuffers.forEach((framebuffer) => gl.deleteFramebuffer(framebuffer));
    return null;
  }

  function buildGpu() {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, TRIANGLE_VERTEX);
    const encode = buildProgram(gl, vertex, ENCODE_FRAGMENT);
    const advect = buildProgram(gl, vertex, ADVECT_FRAGMENT);
    const display = buildProgram(gl, vertex, DISPLAY_FRAGMENT);
    gl.deleteShader(vertex);

    const floatExtension = gl.getExtension("EXT_color_buffer_float");
    let built = floatExtension ? buildFrames(gl.RGBA16F) : null;
    floatFrames = Boolean(built);
    if (!built) built = buildFrames(gl.RGBA8);
    if (!built) throw new Error("No renderable frame format");

    const vertexArray = gl.createVertexArray();
    const blank = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    gpu = {
      encode,
      advect,
      display,
      frames: built.frames,
      framebuffers: built.framebuffers,
      vertexArray,
      blank,
      shiftTexture: null,
      infoTexture: null,
    };
    gpu.shiftTexture = fieldTexture();
    gpu.infoTexture = fieldTexture();
    uploadField();
  }

  function destroyGpu() {
    if (!gpu) return;
    gl.deleteProgram(gpu.encode.program);
    gl.deleteProgram(gpu.advect.program);
    gl.deleteProgram(gpu.display.program);
    gpu.frames.forEach((texture) => gl.deleteTexture(texture));
    gpu.framebuffers.forEach((framebuffer) => gl.deleteFramebuffer(framebuffer));
    gl.deleteVertexArray(gpu.vertexArray);
    gl.deleteTexture(gpu.blank);
    gl.deleteTexture(gpu.shiftTexture);
    gl.deleteTexture(gpu.infoTexture);
    textures.forEach((texture) => gl.deleteTexture(texture));
    textures.clear();
    gpu = null;
  }

  function uploadField() {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, gpu.shiftTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, grid, grid, gl.RGBA, gl.FLOAT, shiftData);
    gl.bindTexture(gl.TEXTURE_2D, gpu.infoTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, grid, grid, gl.RGBA, gl.FLOAT, infoData);
  }

  function nextIndex(from) {
    for (let step = 1; step <= records.length; step += 1) {
      const candidate = (from + step) % records.length;
      if (records[candidate].status !== "failed") return candidate;
    }
    return from;
  }

  function requestCover(index) {
    const record = records[index];
    if (!record) return;
    if (record.status === "ready") {
      if (!textures.has(index) && !uploadQueue.includes(index)) uploadQueue.push(index);
      return;
    }
    if (record.status !== "idle") return;
    record.status = "loading";
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.src = record.url;
    image
      .decode()
      .then(() => {
        if (disposed) return;
        record.status = "ready";
        record.image = image;
        uploadQueue.push(index);
        wake();
      })
      .catch(() => {
        if (disposed) return;
        record.status = "failed";
        handleFailure(index);
      });
  }

  function handleFailure(index) {
    if (records.every((record) => record.status === "failed")) {
      callbacks.onError?.("None of the covers would load.");
      return;
    }
    if (!seeded && index === current) {
      current = nextIndex(current);
      target = nextIndex(current);
      requestCover(current);
      requestCover(target);
      callbacks.onCovers?.({ current, target });
      return;
    }
    if (index === target || index === pending) {
      target = nextIndex(index);
      pending = pending === index ? target : pending;
      requestCover(target);
      callbacks.onCovers?.({ current, target });
    }
  }

  function uploadCover(index) {
    const record = records[index];
    if (!record?.image || textures.has(index) || !gpu) return;
    const image = record.image;
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const side = Math.min(width, height);
    cropContext.imageSmoothingEnabled = true;
    cropContext.imageSmoothingQuality = "high";
    cropContext.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, size, size);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, mipLevels(size), gl.RGBA8, size, size);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, cropCanvas);
    } catch {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.deleteTexture(texture);
      record.status = "failed";
      handleFailure(index);
      return;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    textures.set(index, texture);
  }

  function evictTextures() {
    const keep = new Set([target, nextIndex(target)]);
    if (pending >= 0) keep.add(pending);
    if (!seeded || holdingCover) keep.add(current);
    textures.forEach((texture, index) => {
      if (keep.has(index)) return;
      gl.deleteTexture(texture);
      textures.delete(index);
    });
  }

  function drainUploads(limit) {
    let done = 0;
    while (uploadQueue.length && done < limit) {
      const index = uploadQueue.shift();
      const record = records[index];
      if (record.status !== "ready") continue;
      const wanted = index === current || index === target || index === pending || index === nextIndex(target);
      if (!wanted) continue;
      uploadCover(index);
      done += 1;
    }
    if (!seeded && textures.has(current) && (textures.has(target) || records[target].status === "failed")) seed();
    if (seeded && pending >= 0 && textures.has(pending)) {
      const queued = pending;
      pending = -1;
      beginKey(queued);
    }
  }

  function seed() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.framebuffers[frameIndex]);
    gl.viewport(0, 0, size, size);
    gl.useProgram(gpu.encode.program);
    gl.bindVertexArray(gpu.vertexArray);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures.get(current));
    setInt(gl, gpu.encode, "uCover", 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, gpu.frames[frameIndex]);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    seeded = true;
    evictTextures();
    records.forEach((record, index) => requestCover(index));

    if (!introPlayed) {
      introPlayed = true;
      script = { swipe: INTRO_SWIPE, elapsed: 0, previous: bezierPoint(INTRO_SWIPE, 0, [0, 0]) };
      afterDrag = true;
      presimRemaining = PRESIM_FRAMES;
    }
    dirty = true;
    wake();
  }

  function runPresim() {
    const step = 1 / 60;
    const count = Math.min(PRESIM_BATCH, presimRemaining);
    for (let frame = 0; frame < count; frame += 1) {
      advanceScript(step);
      simulate(step);
    }
    presimRemaining -= count;
    if (presimRemaining > 0) return;
    if (reducedMotion) {
      script = null;
      settle();
    }
    revealStart = -1;
    callbacks.onReady?.();
    callbacks.onFrames?.(framesSinceKey, false);
  }

  function playable() {
    return seeded && presimRemaining === 0 && !key;
  }

  function inject(ax, ay, bx, by, wantX, wantY, frames) {
    let targetX = wantX;
    let targetY = wantY;
    const share = Math.min(1, Math.max(0.05, frames));
    const speed = Math.hypot(targetX, targetY);
    if (speed > maxSpeed) {
      targetX *= maxSpeed / speed;
      targetY *= maxSpeed / speed;
    }
    const sigma = SIGMA_BLOCKS * block;
    const reach = sigma * 2.6;
    const twoSigmaSquared = 2 * sigma * sigma;
    const minX = Math.max(0, Math.floor((Math.min(ax, bx) - reach) / block));
    const maxX = Math.min(grid - 1, Math.floor((Math.max(ax, bx) + reach) / block));
    const minY = Math.max(0, Math.floor((Math.min(ay, by) - reach) / block));
    const maxY = Math.min(grid - 1, Math.floor((Math.max(ay, by) + reach) / block));
    const segmentX = bx - ax;
    const segmentY = by - ay;
    const span = segmentX * segmentX + segmentY * segmentY;
    for (let y = minY; y <= maxY; y += 1) {
      const centerY = (y + 0.5) * block;
      for (let x = minX; x <= maxX; x += 1) {
        const centerX = (x + 0.5) * block;
        let t = span > 0 ? ((centerX - ax) * segmentX + (centerY - ay) * segmentY) / span : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const offsetX = centerX - ax - segmentX * t;
        const offsetY = centerY - ay - segmentY * t;
        const distanceSquared = offsetX * offsetX + offsetY * offsetY;
        if (distanceSquared > reach * reach) continue;
        const weight = 1 - Math.pow(1 - INJECT_SHARE * Math.exp(-distanceSquared / twoSigmaSquared), share);
        const cell = y * grid + x;
        velocityX[cell] = Math.round((velocityX[cell] + (targetX - velocityX[cell]) * weight) * VECTOR_QUANTUM) / VECTOR_QUANTUM;
        velocityY[cell] = Math.round((velocityY[cell] + (targetY - velocityY[cell]) * weight) * VECTOR_QUANTUM) / VECTOR_QUANTUM;
      }
    }
    energy = Math.max(energy, Math.hypot(targetX, targetY) * INJECT_SHARE);
  }

  function advanceScript(dt) {
    if (!script) return;
    script.elapsed += dt;
    const progress = Math.min(1, script.elapsed / script.swipe.seconds);
    const point = bezierPoint(script.swipe, easeInOutSine(progress), scratchPoint);
    const previous = script.previous;
    const frames = dt * 60;
    const ax = previous[0] * size;
    const ay = (1 - previous[1]) * size;
    const bx = point[0] * size;
    const by = (1 - point[1]) * size;
    const gain = script.swipe.gain / frames;
    inject(ax, ay, bx, by, (bx - ax) * gain, (by - ay) * gain, frames);
    previous[0] = point[0];
    previous[1] = point[1];
    if (progress >= 1) script = null;
  }

  function stepField(dt) {
    const frames = dt * 60;
    const decay = Math.exp(-dt / params.persistence);
    const tear = (TEAR_DRAG * frames) / maxSpeed;
    const bleed = 1 - Math.pow(1 - BLEED_PER_FRAME, frames);
    const edge = grid - 1;

    for (let y = 0; y < grid; y += 1) {
      const row = y * grid;
      const below = (y > 0 ? y - 1 : y) * grid;
      const above = (y < edge ? y + 1 : y) * grid;
      for (let x = 0; x < grid; x += 1) {
        const cell = row + x;
        const left = row + (x > 0 ? x - 1 : x);
        const right = row + (x < edge ? x + 1 : x);
        const averageX = (velocityX[left] + velocityX[right] + velocityX[below + x] + velocityX[above + x]) * 0.25;
        const averageY = (velocityY[left] + velocityY[right] + velocityY[below + x] + velocityY[above + x]) * 0.25;
        const mixedX = velocityX[cell] + (averageX - velocityX[cell]) * bleed;
        const mixedY = velocityY[cell] + (averageY - velocityY[cell]) * bleed;
        const excess = Math.max(0, Math.hypot(mixedX, mixedY) - meltSpeed);
        const damp = decay / (1 + tear * excess);
        spareX[cell] = mixedX * damp;
        spareY[cell] = mixedY * damp;
      }
    }
    const swapX = velocityX;
    const swapY = velocityY;
    velocityX = spareX;
    velocityY = spareY;
    spareX = swapX;
    spareY = swapY;

    if (panHold > 0) {
      panHold -= dt * 1000;
    } else {
      const panDecay = Math.exp(-dt / PAN_TAU);
      panX *= panDecay;
      panY *= panDecay;
      if (Math.hypot(panX, panY) < REST_SPEED) {
        panX = 0;
        panY = 0;
      }
    }

    if (freeze) {
      const radius = FREEZE_BLOCKS + 1;
      const centerX = freeze.x / block;
      const centerY = freeze.y / block;
      const minX = Math.max(0, Math.floor(centerX - radius));
      const maxX = Math.min(edge, Math.ceil(centerX + radius));
      const minY = Math.max(0, Math.floor(centerY - radius));
      const maxY = Math.min(edge, Math.ceil(centerY + radius));
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const distance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
          const keep = Math.min(1, Math.max(0, distance - FREEZE_BLOCKS));
          if (keep >= 1) continue;
          const cell = y * grid + x;
          velocityX[cell] *= keep;
          velocityY[cell] *= keep;
          carryX[cell] *= keep;
          carryY[cell] *= keep;
        }
      }
    }

    rungs.fill(0);
    if (key) {
      key.elapsed += dt * 1000;
      if (key.crossfade) {
        velocityX.fill(0);
        velocityY.fill(0);
        panX = 0;
        panY = 0;
      } else {
        const diagonal = Math.max(1, 2 * grid - 2);
        for (let y = 0; y < grid; y += 1) {
          for (let x = 0; x < grid; x += 1) {
            const order = (x + (edge - y)) / diagonal;
            const local = key.elapsed - order * SWEEP_MS;
            if (local < 0) continue;
            const cell = y * grid + x;
            velocityX[cell] = 0;
            velocityY[cell] = 0;
            carryX[cell] = 0;
            carryY[cell] = 0;
            const rung = Math.floor(local / RUNG_MS) + 1;
            if (rung <= RUNGS) rungs[cell] = rung;
          }
        }
      }
    }

    let peak = 0;
    for (let cell = 0; cell < grid * grid; cell += 1) {
      const totalX = velocityX[cell] + panX;
      const totalY = velocityY[cell] + panY;
      const speed = Math.hypot(totalX, totalY);
      const at = cell * 4;
      if (speed < SNAP_SPEED) {
        carryX[cell] = 0;
        carryY[cell] = 0;
        shiftData[at] = 0;
        shiftData[at + 1] = 0;
      } else {
        carryX[cell] += totalX * frames;
        carryY[cell] += totalY * frames;
        const wholeX = Math.round(carryX[cell]);
        const wholeY = Math.round(carryY[cell]);
        carryX[cell] -= wholeX;
        carryY[cell] -= wholeY;
        shiftData[at] = wholeX;
        shiftData[at + 1] = wholeY;
      }
      infoData[at] = totalX;
      infoData[at + 1] = totalY;
      infoData[at + 2] = rungs[cell];
      infoData[at + 3] = 0;
      if (speed > peak) peak = speed;
    }

    if (params.subsample && grid >= 2) {
      for (let y = 0; y < chromaGrid; y += 1) {
        for (let x = 0; x < chromaGrid; x += 1) {
          const a = 2 * y * grid + 2 * x;
          const b = a + 1;
          const c = a + grid;
          const d = c + 1;
          const averageX = (infoData[a * 4] + infoData[b * 4] + infoData[c * 4] + infoData[d * 4]) * 0.25;
          const averageY = (infoData[a * 4 + 1] + infoData[b * 4 + 1] + infoData[c * 4 + 1] + infoData[d * 4 + 1]) * 0.25;
          const chromaCell = y * chromaGrid + x;
          let wholeX = 0;
          let wholeY = 0;
          if (Math.hypot(averageX, averageY) < SNAP_SPEED) {
            chromaCarryX[chromaCell] = 0;
            chromaCarryY[chromaCell] = 0;
          } else {
            chromaCarryX[chromaCell] += averageX * frames;
            chromaCarryY[chromaCell] += averageY * frames;
            wholeX = Math.round(chromaCarryX[chromaCell]);
            wholeY = Math.round(chromaCarryY[chromaCell]);
            chromaCarryX[chromaCell] -= wholeX;
            chromaCarryY[chromaCell] -= wholeY;
          }
          shiftData[a * 4 + 2] = wholeX;
          shiftData[a * 4 + 3] = wholeY;
          shiftData[b * 4 + 2] = wholeX;
          shiftData[b * 4 + 3] = wholeY;
          shiftData[c * 4 + 2] = wholeX;
          shiftData[c * 4 + 3] = wholeY;
          shiftData[d * 4 + 2] = wholeX;
          shiftData[d * 4 + 3] = wholeY;
        }
      }
    } else {
      for (let cell = 0; cell < grid * grid; cell += 1) {
        shiftData[cell * 4 + 2] = shiftData[cell * 4];
        shiftData[cell * 4 + 3] = shiftData[cell * 4 + 1];
      }
    }

    if (peak < SNAP_SPEED && !script) {
      velocityX.fill(0);
      velocityY.fill(0);
      panX = 0;
      panY = 0;
      peak = 0;
    }
    energy = peak;
  }

  function advect(dt) {
    const frames = dt * 60;
    const next = 1 - frameIndex;
    const targetTexture = textures.get(target);
    const hasTarget = Boolean(targetTexture);
    let blend = 0;
    if (key?.crossfade) {
      const remaining = CROSSFADE_MS - (key.elapsed - dt * 1000);
      blend = remaining <= dt * 1000 ? 1 : Math.min(1, (dt * 1000) / remaining);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, gpu.framebuffers[next]);
    gl.viewport(0, 0, size, size);
    gl.useProgram(gpu.advect.program);
    gl.bindVertexArray(gpu.vertexArray);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gpu.frames[frameIndex]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, targetTexture ?? gpu.blank);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, gpu.shiftTexture);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, gpu.infoTexture);
    const program = gpu.advect;
    setInt(gl, program, "uPrev", 0);
    setInt(gl, program, "uTarget", 1);
    setInt(gl, program, "uShift", 2);
    setInt(gl, program, "uInfo", 3);
    setInt(gl, program, "uBlock", block);
    setInt(gl, program, "uBlockLevel", blockLevel);
    setInt(gl, program, "uChromaLevel", params.subsample ? blockLevel + 1 : blockLevel);
    setInt(gl, program, "uSize", size);
    setFloat(gl, program, "uHasTarget", hasTarget ? 1 : 0);
    setFloat(gl, program, "uResidual", 1 - Math.pow(1 - params.residual, frames));
    setFloat(gl, program, "uLumaShare", LUMA_SHARE);
    setFloat(gl, program, "uRingRate", (1 - Math.pow(1 - RING_RATE, frames)) * params.ringing);
    setFloat(gl, program, "uRingStep", floatFrames ? RING_STEP : RING_STEP * 1.2);
    setFloat(gl, program, "uBlend", hasTarget ? blend : 0);
    setInt(gl, program, "uFrameCount", simFrame);
    simFrame = (simFrame + 1) % 65536;
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gpu.frames[next]);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    frameIndex = next;
  }

  function simulate(dt) {
    stepField(dt);
    uploadField();
    advect(dt);
    if (energy >= SNAP_SPEED) {
      framesSinceKey += 1;
      counterTick += 1;
      if (counterTick >= COUNTER_EVERY) {
        counterTick = 0;
        callbacks.onFrames?.(framesSinceKey, false);
      }
    }
    if (key && key.elapsed >= (key.crossfade ? CROSSFADE_MS : SWEEP_MS + RUNGS * RUNG_MS)) completeKey();
    dirty = true;
  }

  function beginKey(index) {
    if (index !== target) {
      target = index;
      callbacks.onCovers?.({ current, target });
    }
    key = { elapsed: 0, crossfade: reducedMotion };
    script = null;
    afterDrag = false;
    freeze = null;
    panX = 0;
    panY = 0;
    panHold = 0;
    wake();
  }

  function completeKey() {
    key = null;
    afterDrag = false;
    current = target;
    target = nextIndex(current);
    framesSinceKey = 0;
    counterTick = 0;
    velocityX.fill(0);
    velocityY.fill(0);
    carryX.fill(0);
    carryY.fill(0);
    chromaCarryX.fill(0);
    chromaCarryY.fill(0);
    panX = 0;
    panY = 0;
    panHold = 0;
    energy = 0;
    requestCover(target);
    requestCover(nextIndex(target));
    evictTextures();
    callbacks.onCovers?.({ current, target });
    callbacks.onFrames?.(0, true);
  }

  function settle() {
    afterDrag = false;
    velocityX.fill(0);
    velocityY.fill(0);
    carryX.fill(0);
    carryY.fill(0);
    chromaCarryX.fill(0);
    chromaCarryY.fill(0);
    panX = 0;
    panY = 0;
    panHold = 0;
    energy = 0;
    shiftData.fill(0);
    infoData.fill(0);
    if (gpu) uploadField();
    dirty = true;
    wake();
  }

  function render(now) {
    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height || !seeded || !cssSize) return;
    if (revealStart < 0 && reveal < 1) revealStart = now;
    if (reveal < 1) reveal = Math.min(1, (now - revealStart) / REVEAL_MS);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(gpu.display.program);
    gl.bindVertexArray(gpu.vertexArray);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gpu.frames[frameIndex]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, gpu.infoTexture);
    const program = gpu.display;
    const pxPerTexel = width / size;
    setInt(gl, program, "uFrame", 0);
    setInt(gl, program, "uInfo", 1);
    setFloat(gl, program, "uSize", size);
    setFloat(gl, program, "uBlock", block);
    setInt(gl, program, "uBlockLevel", blockLevel);
    setInt(gl, program, "uMaxLevel", mipLevels(size) - 1);
    setFloat(gl, program, "uGrid", grid);
    setFloat(gl, program, "uPxPerTexel", pxPerTexel);
    setFloat(gl, program, "uTickRadius", TICK_RADIUS_CSS * (width / Math.max(1, cssSize)));
    setFloat(gl, program, "uTickFull", TICK_FULL_SPEED * speedScale);
    setVec2(gl, program, "uPointer", pointerX, pointerY);
    setFloat(gl, program, "uLens", lensRadius * block);
    setFloat(gl, program, "uLensShow", lensShow);
    setFloat(gl, program, "uFieldShow", fieldShow);
    setFloat(gl, program, "uReveal", reveal);
    const coverTexture = reveal < 1 ? textures.get(current) : null;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, coverTexture ?? gpu.blank);
    setInt(gl, program, "uCover", 2);
    setFloat(gl, program, "uHasCover", coverTexture ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    dirty = false;
    if (reveal >= 1 && holdingCover) {
      holdingCover = false;
      evictTextures();
    }
  }

  function easeOverlays(dt) {
    const blend = 1 - Math.exp(-dt * OVERLAY_RATE);
    const tailShowing = afterDrag && energy >= SNAP_SPEED;
    if (afterDrag && !pressed && !tailShowing) afterDrag = false;
    const fieldTarget = params.vectors || (pressed && engaged) || tailShowing ? 1 : 0;
    const radiusTarget = pressed ? LENS_PRESS_BLOCKS : LENS_HOVER_BLOCKS;
    const before = fieldShow + lensShow + lensRadius;
    fieldShow += (fieldTarget - fieldShow) * blend;
    lensShow += (lensTarget - lensShow) * blend;
    lensRadius += (radiusTarget - lensRadius) * blend;
    if (Math.abs(fieldShow - fieldTarget) < 0.002) fieldShow = fieldTarget;
    if (Math.abs(lensShow - lensTarget) < 0.002) lensShow = lensTarget;
    if (Math.abs(lensRadius - radiusTarget) < 0.01) lensRadius = radiusTarget;
    if (fieldShow + lensShow + lensRadius !== before) dirty = true;
    return fieldShow !== fieldTarget || lensShow !== lensTarget || lensRadius !== radiusTarget;
  }

  function applyResolution() {
    if (!cssSize) return;
    const ratio = Math.min(deviceRatio, dprCap) * governor.scale;
    const pixels = Math.max(1, Math.round(cssSize * ratio));
    if (canvas.width !== pixels || canvas.height !== pixels) {
      canvas.width = pixels;
      canvas.height = pixels;
    }
    dirty = true;
  }

  function frame(now) {
    raf = 0;
    if (!active || lost || disposed || !gpu) return;
    const elapsedMs = last ? now - last : 16.67;
    last = now;
    const dt = Math.min(1 / 30, Math.max(1 / 240, elapsedMs / 1000));

    drainUploads(1);

    if (presimRemaining > 0) {
      runPresim();
    } else if (seeded && (key || script || panHold > 0 || panX || panY || energy >= SNAP_SPEED)) {
      advanceScript(dt);
      simulate(dt);
      if (governor.sample(elapsedMs)) applyResolution();
    }
    const easing = easeOverlays(dt);
    const shown = seeded && presimRemaining === 0;
    if (shown && (dirty || reveal < 1)) render(now);

    const loading = uploadQueue.length > 0;
    const keepGoing = Boolean(presimRemaining > 0 || key || script || panHold > 0 || panX || panY || energy >= SNAP_SPEED || easing || (shown && reveal < 1) || loading);
    if (keepGoing || (seeded && dirty)) raf = requestAnimationFrame(frame);
    else last = 0;
  }

  function wake() {
    if (raf || !active || lost || disposed) return;
    raf = requestAnimationFrame(frame);
  }

  function handleLost(event) {
    event.preventDefault();
    lost = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    gpu = null;
    textures.clear();
  }

  function handleRestored() {
    lost = false;
    seeded = false;
    frameIndex = 0;
    try {
      buildGpu();
    } catch (error) {
      callbacks.onError?.(error.message);
      return;
    }
    records.forEach((record, index) => {
      if (record.status === "ready") requestCover(index);
    });
    drainUploads(3);
    wake();
  }

  canvas.addEventListener("webglcontextlost", handleLost);
  canvas.addEventListener("webglcontextrestored", handleRestored);

  try {
    buildGpu();
  } catch (error) {
    canvas.removeEventListener("webglcontextlost", handleLost);
    canvas.removeEventListener("webglcontextrestored", handleRestored);
    throw error;
  }
  allocateField();

  requestCover(current);
  requestCover(target);
  callbacks.onCovers?.({ current, target });
  callbacks.onFrames?.(0, true);

  return {
    bufferSize: size,
    get block() {
      return block;
    },
    setParams(next) {
      const blockChanged = next.block !== params.block;
      Object.assign(params, next);
      if (blockChanged) allocateField();
      dirty = true;
      wake();
    },
    resize(nextCssSize, nextRatio) {
      cssSize = nextCssSize;
      deviceRatio = nextRatio;
      applyResolution();
      if (active && gpu && !lost && seeded && presimRemaining === 0) render(performance.now());
      wake();
    },
    setActive(next) {
      if (active === next) return;
      active = next;
      if (!active && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      last = 0;
      if (active) {
        drainUploads(seeded ? 1 : 3);
        dirty = true;
        wake();
      }
    },
    hover(normalisedX, normalisedY) {
      pointerX = normalisedX * size;
      pointerY = (1 - normalisedY) * size;
      lensTarget = 1;
      dirty = true;
      wake();
    },
    leave() {
      lensTarget = 0;
      wake();
    },
    setPressed(next) {
      pressed = next;
      if (next) lensTarget = 1;
      if (!next) engaged = false;
      dragVelocityX = 0;
      dragVelocityY = 0;
      wake();
    },
    drag(fromX, fromY, toX, toY, elapsedMs) {
      if (!playable()) return;
      const ax = fromX * size;
      const ay = (1 - fromY) * size;
      const bx = toX * size;
      const by = (1 - toY) * size;
      pointerX = bx;
      pointerY = by;
      engaged = true;
      afterDrag = true;
      script = null;
      const frames = Math.max(0.1, elapsedMs / (1000 / 60));
      const follow = 1 - Math.exp(-elapsedMs / DRAG_SMOOTH_MS);
      dragVelocityX += (((bx - ax) / frames) * DRAG_GAIN - dragVelocityX) * follow;
      dragVelocityY += (((by - ay) / frames) * DRAG_GAIN - dragVelocityY) * follow;
      inject(ax, ay, bx, by, dragVelocityX, dragVelocityY, frames);
      dirty = true;
      wake();
    },
    freezeAt(normalisedX, normalisedY) {
      pointerX = normalisedX * size;
      pointerY = (1 - normalisedY) * size;
      if (freeze) {
        freeze.x = pointerX;
        freeze.y = pointerY;
      } else {
        freeze = { x: pointerX, y: pointerY };
      }
      engaged = true;
      dirty = true;
      wake();
    },
    releaseFreeze() {
      freeze = null;
      wake();
    },
    settle,
    pan(directionX, directionY) {
      if (!playable()) return;
      const speed = PAN_SPEED * speedScale;
      panX = directionX * speed;
      panY = -directionY * speed;
      panHold = PAN_HOLD_MS;
      wake();
    },
    playSwipe(index) {
      if (!playable() || reducedMotion) return;
      const swipe = SWIPES[((index % SWIPES.length) + SWIPES.length) % SWIPES.length];
      script = { swipe, elapsed: 0, previous: bezierPoint(swipe, 0, [0, 0]) };
      afterDrag = true;
      wake();
    },
    keyframe(index) {
      if (!playable()) return false;
      const to = index === undefined || index === null ? target : index;
      if (!records[to] || records[to].status === "failed") return false;
      if (to === current && index !== undefined && index !== null && energy < SNAP_SPEED) return false;
      if (!textures.has(to)) {
        pending = to;
        if (to !== target) {
          target = to;
          callbacks.onCovers?.({ current, target });
        }
        requestCover(to);
        wake();
        return true;
      }
      beginKey(to);
      return true;
    },
    get current() {
      return current;
    },
    get target() {
      return target;
    },
    dispose() {
      disposed = true;
      active = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      canvas.removeEventListener("webglcontextlost", handleLost);
      canvas.removeEventListener("webglcontextrestored", handleRestored);
      if (!lost) destroyGpu();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      records.forEach((record) => {
        record.image = null;
      });
    },
  };
}
