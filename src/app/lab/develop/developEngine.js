import {
  COCKLE_FRAGMENT,
  DEVELOP_FRAGMENT,
  FIELD_FRAGMENT,
  FLUX_FRAGMENT,
  FULLSCREEN_VERTEX,
  HEIGHT_FRAGMENT,
  PRINT_FRAGMENT,
  RESET_FRAGMENT,
  STATS_FRAGMENT,
  STILL_FRAGMENT,
} from "./developShader";

export const PLATE_ASPECT = 0.8;
export const REST_LEAN_Y = -0.09;
export const MAX_LEAN = 0.16;
export const PRINT_BORDER = 0.055;

const SIM_RATE = 480;
const MAX_SUBSTEPS = 16;
const GRAVITY = 6000;
const FRICTION = 1.2;
const BED_GAIN = 62.5;
const COCKLE_AMOUNT = 0.08;
const SPRING_STIFFNESS = 90;
const SPRING_DAMPING = 13;
const SPRING_SUBSTEPS = 4;
const SOAK_TAU = 0.9;
const PADDLE_RADIUS = 0.085;
const PADDLE_RATE = 30;
const PADDLE_MAX_CELLS = 260;
const STATS_SECONDS_SCALE = 256;
const STILL_TAU = 0.2;
const STILL_WET_DEPTH = 0.1;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log || "shader failed to compile");
  }
  return shader;
}

function linkProgram(gl, vertexShader, fragmentSource) {
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.detachShader(program, fragmentShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(log || "program failed to link");
  }
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let index = 0; index < count; index += 1) {
    const info = gl.getActiveUniform(program, index);
    if (info) uniforms[info.name] = gl.getUniformLocation(program, info.name);
  }
  return { program, uniforms };
}

function pickFormats(gl) {
  const full = gl.getExtension("EXT_color_buffer_float");
  const half = full || gl.getExtension("EXT_color_buffer_half_float");
  if (!half) return null;
  return {
    scalar: full
      ? { internal: gl.R32F, format: gl.RED, type: gl.FLOAT, filter: gl.NEAREST }
      : { internal: gl.R16F, format: gl.RED, type: gl.HALF_FLOAT, filter: gl.NEAREST },
    vector: full
      ? { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: gl.NEAREST }
      : { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.NEAREST },
    field: { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.LINEAR },
    bytes: { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.NEAREST },
  };
}

function createTarget(gl, width, height, spec) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, spec.internal, width, height, 0, spec.format, spec.type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, spec.filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, spec.filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!complete) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    throw new Error("render target unsupported");
  }
  return { texture, framebuffer, width, height };
}

function createPair(gl, width, height, spec) {
  return { read: createTarget(gl, width, height, spec), write: createTarget(gl, width, height, spec) };
}

function swap(pair) {
  const read = pair.read;
  pair.read = pair.write;
  pair.write = read;
}

function hexToRgb(hex, out) {
  const value = Number.parseInt(String(hex).replace("#", ""), 16);
  if (!Number.isFinite(value)) return out;
  out[0] = ((value >> 16) & 255) / 255;
  out[1] = ((value >> 8) & 255) / 255;
  out[2] = (value & 255) / 255;
  return out;
}

export function imageAreaAspect() {
  return (PLATE_ASPECT * (1 - 2 * PRINT_BORDER)) / (1 - 2 * PRINT_BORDER * PLATE_ASPECT);
}

export function cropFor(width, height, focusX = 0.5, focusY = 0.5) {
  const area = imageAreaAspect();
  const aspect = width / Math.max(height, 1);
  if (aspect > area) {
    const scaleX = area / aspect;
    const left = Math.min(Math.max(focusX - scaleX / 2, 0), 1 - scaleX);
    return { x: left, y: 0, width: scaleX, height: 1 };
  }
  const scaleY = aspect / area;
  const top = Math.min(Math.max(focusY - scaleY / 2, 0), 1 - scaleY);
  return { x: 0, y: 1 - top - scaleY, width: 1, height: scaleY };
}

export function createDevelopEngine(canvas, { gridWidth }) {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;
  const formats = pickFormats(gl);
  if (!formats) return null;

  const gridW = gridWidth;
  const gridH = Math.round(gridWidth / PLATE_ASPECT);

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, FULLSCREEN_VERTEX);
  const programs = {
    cockle: linkProgram(gl, vertexShader, COCKLE_FRAGMENT),
    reset: linkProgram(gl, vertexShader, RESET_FRAGMENT),
    flux: linkProgram(gl, vertexShader, FLUX_FRAGMENT),
    height: linkProgram(gl, vertexShader, HEIGHT_FRAGMENT),
    develop: linkProgram(gl, vertexShader, DEVELOP_FRAGMENT),
    field: linkProgram(gl, vertexShader, FIELD_FRAGMENT),
    stats: linkProgram(gl, vertexShader, STATS_FRAGMENT),
    still: linkProgram(gl, vertexShader, STILL_FRAGMENT),
    print: linkProgram(gl, vertexShader, PRINT_FRAGMENT),
  };

  const flux = createPair(gl, gridW, gridH, formats.vector);
  const height = createPair(gl, gridW, gridH, formats.scalar);
  const dev = createPair(gl, gridW, gridH, formats.vector);
  const cockle = createTarget(gl, gridW, gridH, formats.scalar);
  const field = createTarget(gl, gridW, gridH, formats.field);
  const stats = createTarget(gl, 1, 1, formats.bytes);
  const vao = gl.createVertexArray();
  const statsPixel = new Uint8Array(4);
  const statsBuffer = gl.createBuffer();
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, statsBuffer);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, 4, gl.STREAM_READ);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const latestStats = { seconds: 0, coverage: 0 };
  let statsFence = null;
  const zero = new Float32Array(4);

  let imageTexture = null;
  let imageWidth = 1;
  let imageHeight = 1;
  const crop = { x: 0, y: 0, width: 1, height: 1 };
  const levels = { black: 0, white: 1 };
  const paper = [0.969, 0.961, 0.941];
  const silver = [0.102, 0.086, 0.071];
  const settings = { depth: 0.08, slosh: 0.997, speed: 1, contrast: 1, grain: 0.05, fog: 0.012, lith: 0 };

  const lean = [0, REST_LEAN_Y];
  const leanVelocity = [0, 0];
  const paddle = { on: 0, x: 0.5, y: 0.5, vx: 0, vy: 0 };
  let sheetSeed = 0.37;
  let fieldDirty = true;
  let platePxW = 1;
  let platePxH = 1;

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.bindVertexArray(vao);

  const bindTexture = (unit, texture, location) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(location, unit);
  };

  const begin = (program, target) => {
    gl.useProgram(program.program);
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, target.width, target.height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    return program.uniforms;
  };

  const draw = () => gl.drawArrays(gl.TRIANGLES, 0, 3);

  const clearTarget = (target) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.clearBufferfv(gl.COLOR, 0, zero);
  };

  const restLevel = () => {
    const pool = Math.sqrt(2 * settings.depth * BED_GAIN * Math.abs(REST_LEAN_Y));
    return pool + BED_GAIN * REST_LEAN_Y * 0.5;
  };

  const dropStats = () => {
    if (!statsFence) return;
    gl.deleteSync(statsFence);
    statsFence = null;
  };

  const resetSheet = (seed) => {
    dropStats();
    latestStats.seconds = 0;
    latestStats.coverage = 0;
    sheetSeed = seed;
    let u = begin(programs.cockle, cockle);
    gl.uniform2f(u.uGrid, gridW, gridH);
    gl.uniform1f(u.uSeed, seed);
    gl.uniform1f(u.uAmount, COCKLE_AMOUNT);
    draw();

    u = begin(programs.reset, height.read);
    bindTexture(0, cockle.texture, u.uCockle);
    gl.uniform2f(u.uGrid, gridW, gridH);
    gl.uniform2f(u.uLean, 0, REST_LEAN_Y);
    gl.uniform1f(u.uGain, BED_GAIN);
    gl.uniform1f(u.uLevel, restLevel());
    draw();

    clearTarget(flux.read);
    clearTarget(flux.write);
    clearTarget(dev.read);
    clearTarget(dev.write);
    lean[0] = 0;
    lean[1] = REST_LEAN_Y;
    leanVelocity[0] = 0;
    leanVelocity[1] = 0;
    fieldDirty = true;
  };

  const runFlux = (dt, damp) => {
    const u = begin(programs.flux, flux.write);
    bindTexture(0, flux.read.texture, u.uFlux);
    bindTexture(1, height.read.texture, u.uHeight);
    bindTexture(2, cockle.texture, u.uCockle);
    gl.uniform2f(u.uGrid, gridW, gridH);
    gl.uniform2f(u.uLean, lean[0], lean[1]);
    gl.uniform1f(u.uGain, BED_GAIN);
    gl.uniform1f(u.uDt, dt);
    gl.uniform1f(u.uGravity, GRAVITY);
    gl.uniform1f(u.uDamp, damp);
    gl.uniform1f(u.uFriction, FRICTION);
    gl.uniform4f(u.uPaddle, paddle.x, paddle.y, paddle.vx * gridW, paddle.vy * gridH);
    gl.uniform1f(u.uPaddleOn, paddle.on);
    gl.uniform1f(u.uPaddleRadius, PADDLE_RADIUS);
    gl.uniform1f(u.uPaddleMix, 1 - Math.exp(-dt * PADDLE_RATE));
    draw();
    swap(flux);
  };

  const runHeight = (dt, scale) => {
    const u = begin(programs.height, height.write);
    bindTexture(0, flux.read.texture, u.uFlux);
    bindTexture(1, height.read.texture, u.uHeight);
    gl.uniform2f(u.uGrid, gridW, gridH);
    gl.uniform1f(u.uDt, dt);
    gl.uniform1f(u.uScale, scale);
    draw();
    swap(height);
  };

  const stepSpring = (dt, targetX, targetY) => {
    const step = dt / SPRING_SUBSTEPS;
    for (let index = 0; index < SPRING_SUBSTEPS; index += 1) {
      const ax = SPRING_STIFFNESS * (targetX - lean[0]) - SPRING_DAMPING * leanVelocity[0];
      const ay = SPRING_STIFFNESS * (targetY - lean[1]) - SPRING_DAMPING * leanVelocity[1];
      leanVelocity[0] += ax * step;
      leanVelocity[1] += ay * step;
      lean[0] += leanVelocity[0] * step;
      lean[1] += leanVelocity[1] * step;
    }
    const size = Math.hypot(lean[0], lean[1]);
    if (size > MAX_LEAN) {
      lean[0] *= MAX_LEAN / size;
      lean[1] *= MAX_LEAN / size;
      const outward = (leanVelocity[0] * lean[0] + leanVelocity[1] * lean[1]) / MAX_LEAN;
      if (outward > 0) {
        leanVelocity[0] -= (outward * lean[0]) / MAX_LEAN;
        leanVelocity[1] -= (outward * lean[1]) / MAX_LEAN;
      }
    }
  };

  const simulate = (dt, targetX, targetY) => {
    stepSpring(dt, targetX, targetY);
    const substeps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt * SIM_RATE)));
    const subDt = dt / substeps;
    const damp = Math.pow(settings.slosh, subDt * 240);
    for (let index = 0; index < substeps; index += 1) {
      runFlux(subDt, damp);
      runHeight(subDt, 1);
    }
    fieldDirty = true;
  };

  const settle = (dt, targetX, targetY) => {
    const follow = 1 - Math.exp(-dt / STILL_TAU);
    lean[0] += (targetX - lean[0]) * follow;
    lean[1] += (targetY - lean[1]) * follow;
    leanVelocity[0] = 0;
    leanVelocity[1] = 0;
    const u = begin(programs.still, height.read);
    bindTexture(0, cockle.texture, u.uCockle);
    gl.uniform2f(u.uGrid, gridW, gridH);
    gl.uniform2f(u.uRest, 0, REST_LEAN_Y);
    gl.uniform2f(u.uLean, lean[0], lean[1]);
    gl.uniform1f(u.uGain, BED_GAIN);
    gl.uniform1f(u.uLevel, restLevel());
    gl.uniform1f(u.uMaxShift, MAX_LEAN - REST_LEAN_Y);
    gl.uniform1f(u.uWetDepth, STILL_WET_DEPTH);
    draw();
    clearTarget(flux.read);
    fieldDirty = true;
  };

  const develop = (dt) => {
    const u = begin(programs.develop, dev.write);
    bindTexture(0, dev.read.texture, u.uDev);
    bindTexture(1, height.read.texture, u.uHeight);
    bindTexture(2, flux.read.texture, u.uFlux);
    gl.uniform1f(u.uDt, dt);
    gl.uniform1f(u.uRate, settings.speed);
    gl.uniform1f(u.uSoakDecay, Math.exp(-dt / SOAK_TAU));
    draw();
    swap(dev);
    fieldDirty = true;
  };

  const buildField = () => {
    const u = begin(programs.field, field);
    bindTexture(0, dev.read.texture, u.uDev);
    bindTexture(1, height.read.texture, u.uHeight);
    gl.uniform2f(u.uGrid, gridW, gridH);
    draw();
    fieldDirty = false;
  };

  const render = (water) => {
    if (fieldDirty) buildField();
    const u = begin(programs.print, null);
    bindTexture(0, field.texture, u.uField);
    bindTexture(1, imageTexture, u.uImage);
    gl.uniform2f(u.uGrid, gridW, gridH);
    gl.uniform2f(u.uImageSize, imageWidth, imageHeight);
    gl.uniform4f(u.uCrop, crop.x, crop.y, crop.width, crop.height);
    gl.uniform2f(u.uLevels, levels.black, levels.white);
    gl.uniform2f(u.uPlatePx, platePxW, platePxH);
    gl.uniform2f(u.uBorder, PRINT_BORDER, PRINT_BORDER * PLATE_ASPECT);
    gl.uniform3f(u.uPaper, paper[0], paper[1], paper[2]);
    gl.uniform3f(u.uSilver, silver[0], silver[1], silver[2]);
    gl.uniform1f(u.uContrast, settings.contrast);
    gl.uniform1f(u.uFog, settings.fog);
    gl.uniform1f(u.uLith, settings.lith);
    gl.uniform1f(u.uGrain, settings.grain);
    gl.uniform1f(u.uWater, water);
    gl.uniform1f(u.uSeed, sheetSeed * 97);
    gl.uniform1f(u.uHasImage, imageTexture ? 1 : 0);
    draw();
  };

  const requestStats = () => {
    if (statsFence) return;
    const u = begin(programs.stats, stats);
    bindTexture(0, dev.read.texture, u.uDev);
    gl.uniform2f(u.uGrid, gridW, gridH);
    draw();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, statsBuffer);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    statsFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  };

  const pollStats = () => {
    if (!statsFence) return false;
    const status = gl.clientWaitSync(statsFence, 0, 0);
    if (status === gl.TIMEOUT_EXPIRED) return false;
    dropStats();
    if (status === gl.WAIT_FAILED) return false;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, statsBuffer);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, statsPixel);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    latestStats.seconds = ((statsPixel[0] + statsPixel[1] / 255) / 255) * STATS_SECONDS_SCALE;
    latestStats.coverage = statsPixel[2] / 255;
    return true;
  };

  const setImage = (image, nextCrop, nextLevels) => {
    if (!imageTexture) imageTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, imageTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    imageWidth = image.naturalWidth || image.width;
    imageHeight = image.naturalHeight || image.height;
    crop.x = nextCrop.x;
    crop.y = nextCrop.y;
    crop.width = nextCrop.width;
    crop.height = nextCrop.height;
    levels.black = nextLevels.black;
    levels.white = nextLevels.white;
  };

  const setSettings = (next) => {
    const previousDepth = settings.depth;
    settings.depth = next.depth;
    settings.slosh = next.slosh;
    settings.speed = next.speed;
    settings.contrast = next.contrast;
    settings.grain = next.grain;
    settings.fog = next.fog;
    settings.lith = next.lith;
    hexToRgb(next.paper, paper);
    hexToRgb(next.silver, silver);
    if (Math.abs(previousDepth - next.depth) > 1e-6 && previousDepth > 0) {
      runHeight(0, next.depth / previousDepth);
      fieldDirty = true;
    }
  };

  const setPaddle = (on, x, y, vx, vy) => {
    const speed = Math.hypot(vx * gridW, vy * gridH);
    const limit = speed > PADDLE_MAX_CELLS ? PADDLE_MAX_CELLS / speed : 1;
    paddle.on = on;
    paddle.x = x;
    paddle.y = y;
    paddle.vx = vx * limit;
    paddle.vy = vy * limit;
  };

  const kick = (vx, vy) => {
    leanVelocity[0] += vx;
    leanVelocity[1] += vy;
  };

  const resize = (cssWidth, cssHeight, pixelRatio) => {
    platePxW = Math.max(1, cssWidth);
    platePxH = Math.max(1, cssHeight);
    const width = Math.max(1, Math.round(cssWidth * pixelRatio));
    const heightPx = Math.max(1, Math.round(cssHeight * pixelRatio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== heightPx) canvas.height = heightPx;
  };

  const capture = (context, width, heightPx) => {
    render(0);
    context.drawImage(canvas, 0, 0, width, heightPx);
    render(1);
  };

  const motion = () =>
    Math.abs(leanVelocity[0]) + Math.abs(leanVelocity[1]);

  const destroy = () => {
    dropStats();
    gl.deleteBuffer(statsBuffer);
    for (const pair of [flux, height, dev]) {
      for (const target of [pair.read, pair.write]) {
        gl.deleteFramebuffer(target.framebuffer);
        gl.deleteTexture(target.texture);
      }
    }
    for (const target of [cockle, field, stats]) {
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }
    for (const program of Object.values(programs)) gl.deleteProgram(program.program);
    gl.deleteShader(vertexShader);
    gl.deleteVertexArray(vao);
    if (imageTexture) gl.deleteTexture(imageTexture);
    imageTexture = null;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };

  return {
    gl,
    lean,
    leanVelocity,
    resetSheet,
    simulate,
    settle,
    develop,
    render,
    requestStats,
    pollStats,
    stats: latestStats,
    setImage,
    setSettings,
    setPaddle,
    kick,
    resize,
    capture,
    motion,
    destroy,
    get hasImage() {
      return Boolean(imageTexture);
    },
    get statsPending() {
      return statsFence !== null;
    },
  };
}
