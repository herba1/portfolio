import { COVER_SLOTS, MAX_OPS, OP_DROP, OP_ROWS, OP_TEXELS, OPS_PER_ROW, packOp } from "./marbleOps";
import { MARBLE_FRAGMENT, MARBLE_VERTEX } from "./marbleShader";

const TILE = 512;
const ATLAS = 2048;
const ATLAS_LEVELS = 12;
const SHEET_MARGIN = 0.1;
const PIXEL_BUDGET = 4.4e6;
const LIVE_KEEP = 4;
const LIVE_LIMIT = 10;
const PASS_OPS = 64;
const SETTLE_MS = 150;
const TWO_TAP_PIXELS = 2.5e6;
const FOLLOW_EPSILON = 1e-5;
const CHANGE_THROTTLE_MS = 120;
const FOLLOW_KEYS = ["alpha", "radius", "x", "y", "dx", "dy", "spacing"];

export const EASE = {
  entrance: cubicBezier(0.16, 1, 0.3, 1),
  standard: cubicBezier(0.4, 0, 0.2, 1),
  inOut: cubicBezier(0.7, 0, 0.3, 1),
  hover: cubicBezier(0.26, 0.08, 0.25, 1),
  linear: (t) => t,
};

function cubicBezier(x1, y1, x2, y2) {
  const sample = (a1, a2, t) => ((1 - 3 * a2 + 3 * a1) * t + (3 * a2 - 6 * a1)) * t * t + 3 * a1 * t;
  const slope = (a1, a2, t) => 3 * (1 - 3 * a2 + 3 * a1) * t * t + 2 * (3 * a2 - 6 * a1) * t + 3 * a1;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let iteration = 0; iteration < 6; iteration += 1) {
      const error = sample(x1, x2, t) - x;
      const gradient = slope(x1, x2, t);
      if (Math.abs(error) < 1e-6 || Math.abs(gradient) < 1e-6) break;
      t -= error / gradient;
    }
    return sample(y1, y2, Math.min(1, Math.max(0, t)));
  };
}

export function dropBloom(t) {
  const area = t < 0.7 ? 1.06 * EASE.entrance(t / 0.7) : 1.06 - 0.06 * EASE.standard((t - 0.7) / 0.3);
  return Math.sqrt(Math.max(area, 0));
}

function parseRgb(text) {
  const parts = String(text).match(/[\d.]+/g);
  if (!parts || parts.length < 3) return [0.5, 0.5, 0.5];
  return [Number(parts[0]) / 255, Number(parts[1]) / 255, Number(parts[2]) / 255];
}

function hexToRgb(hex) {
  const value = parseInt(String(hex).replace("#", ""), 16);
  if (!Number.isFinite(value)) return [0.96, 0.95, 0.92];
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function compile(gl, type, source) {
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

function createProgram(gl) {
  const vertex = compile(gl, gl.VERTEX_SHADER, MARBLE_VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, MARBLE_FRAGMENT);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(log || "program failed to link");
  }
  const locations = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let index = 0; index < count; index += 1) {
    const info = gl.getActiveUniform(program, index);
    const name = info.name.replace(/\[0\]$/, "");
    locations[name] = gl.getUniformLocation(program, info.name);
  }
  return { program, locations };
}

export function createMarbleEngine(canvas, { onPainted, onChange, onError } = {}) {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  if (!gl) throw new Error("WebGL2 is not available");

  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
  const floatTargets = Boolean(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
  const { program, locations } = createProgram(gl);
  const vao = gl.createVertexArray();

  const opData = new Float32Array(OPS_PER_ROW * OP_TEXELS * OP_ROWS * 4);
  const opTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, opTexture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, OPS_PER_ROW * OP_TEXELS, OP_ROWS);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const atlas = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, atlas);
  gl.texStorage2D(gl.TEXTURE_2D, ATLAS_LEVELS, gl.RGBA8, ATLAS, ATLAS);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const anisotropic = gl.getExtension("EXT_texture_filter_anisotropic");
  if (anisotropic) {
    const limit = gl.getParameter(anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    gl.texParameterf(gl.TEXTURE_2D, anisotropic.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, limit));
  }

  const tileCanvas = document.createElement("canvas");
  tileCanvas.width = TILE;
  tileCanvas.height = TILE;
  const tileContext = tileCanvas.getContext("2d");
  tileContext.imageSmoothingQuality = "high";

  const avg = new Float32Array(COVER_SLOTS * 3).fill(0.6);
  const rimBase = new Float32Array(COVER_SLOTS * 3).fill(0.2);
  const rim = new Float32Array(COVER_SLOTS * 3);
  const tileReady = new Float32Array(COVER_SLOTS);
  const uploadQueue = [];
  const paper = [0.96, 0.95, 0.92];

  const sheets = [null, null];
  let sheetCurrent = 0;
  let sheetWidth = 1;
  let sheetHeight = 1;
  let viewWidth = 1;
  let viewHeight = 1;
  let unit = 1;
  let deviceRatio = 1;

  const ops = [];
  const animations = [];
  let baked = 0;
  let rebuildTo = -1;
  let opsDirtyFrom = 0;
  let opsDirtyTo = 0;

  const settings = { lambda: 0.035, rimPx: 1.2, rimDark: 0.55, grain: 0.035, seed: 1 };
  const highlight = { index: -1, shown: -1, mix: 0, progress: 0 };

  let frame = 0;
  let lastTick = 0;
  let paused = false;
  let destroyed = false;
  let painted = false;
  let settleTimer = 0;
  let pendingSuper = false;
  let followRate = 70;
  let coversSet = false;
  let changeTimer = 0;
  const growers = new Set();

  function markOps(from, to = from + 1) {
    if (opsDirtyTo <= opsDirtyFrom) {
      opsDirtyFrom = from;
      opsDirtyTo = to;
      return;
    }
    opsDirtyFrom = Math.min(opsDirtyFrom, from);
    opsDirtyTo = Math.max(opsDirtyTo, to);
  }

  function uploadOps() {
    if (opsDirtyTo <= opsDirtyFrom) return;
    const from = Math.max(0, opsDirtyFrom);
    const to = Math.min(ops.length, MAX_OPS);
    for (let index = from; index < to; index += 1) packOp(opData, index, ops[index]);
    const rowFrom = Math.floor(from / OPS_PER_ROW);
    const rowTo = Math.max(rowFrom + 1, Math.ceil(Math.max(to, opsDirtyTo) / OPS_PER_ROW));
    const rowFloats = OPS_PER_ROW * OP_TEXELS * 4;
    gl.bindTexture(gl.TEXTURE_2D, opTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      rowFrom,
      OPS_PER_ROW * OP_TEXELS,
      Math.min(OP_ROWS, rowTo) - rowFrom,
      gl.RGBA,
      gl.FLOAT,
      opData,
      rowFrom * rowFloats,
    );
    opsDirtyFrom = 0;
    opsDirtyTo = 0;
  }

  function destroySheets() {
    for (let index = 0; index < 2; index += 1) {
      if (!sheets[index]) continue;
      gl.deleteFramebuffer(sheets[index].framebuffer);
      gl.deleteTexture(sheets[index].texture);
      sheets[index] = null;
    }
  }

  function createSheets() {
    destroySheets();
    if (!floatTargets) return false;
    for (let index = 0; index < 2; index += 1) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, sheetWidth, sheetHeight);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      sheets[index] = { texture, framebuffer };
      if (!complete) {
        destroySheets();
        return false;
      }
    }
    return true;
  }

  let sheetsUsable = false;

  function bindCommon() {
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, opTexture);
    gl.uniform1i(locations.uOps, 0);
    gl.uniform1i(locations.uSheet, 1);
    gl.uniform1i(locations.uAtlas, 2);
    gl.uniform1f(locations.uUnit, unit);
    gl.uniform1f(locations.uLambda, settings.lambda);
    gl.uniform2f(locations.uSheetSize, sheetWidth, sheetHeight);
    gl.uniform2f(locations.uViewSize, viewWidth, viewHeight);
  }

  function bakePass(from, to) {
    const target = 1 - sheetCurrent;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sheets[target].framebuffer);
    gl.viewport(0, 0, sheetWidth, sheetHeight);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sheets[sheetCurrent].texture);
    gl.uniform1i(locations.uMode, 0);
    gl.uniform1i(locations.uOpStart, from);
    gl.uniform1i(locations.uOpEnd, to);
    gl.uniform1i(locations.uHasSheet, from > 0 ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    sheetCurrent = target;
  }

  function bakeRange(from, to) {
    let start = from;
    while (start < to) {
      const end = Math.min(to, start + PASS_OPS);
      bakePass(start, end);
      start = end;
    }
    baked = to;
  }

  function isSettled(op) {
    return !op.follow && !op.animating && !op.removing;
  }

  function firstUnsettled() {
    for (let index = baked; index < ops.length; index += 1) if (!isSettled(ops[index])) return index;
    return ops.length;
  }

  function maintainSheet() {
    if (!sheetsUsable) {
      baked = 0;
      return;
    }
    if (rebuildTo >= 0) {
      baked = 0;
      bakeRange(0, Math.max(0, Math.min(rebuildTo, firstUnsettled())));
      rebuildTo = -1;
      return;
    }
    if (ops.length - baked <= LIVE_LIMIT) return;
    const limit = Math.min(firstUnsettled(), ops.length - LIVE_KEEP);
    if (limit > baked) bakeRange(baked, limit);
  }

  function drawView(supersample) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, viewWidth, viewHeight);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sheetsUsable ? sheets[sheetCurrent].texture : null);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    const start = sheetsUsable ? baked : Math.max(0, ops.length - PASS_OPS);
    gl.uniform1i(locations.uMode, 1);
    gl.uniform1i(locations.uOpStart, start);
    gl.uniform1i(locations.uOpEnd, ops.length);
    gl.uniform1i(locations.uHasSheet, sheetsUsable && baked > 0 ? 1 : 0);
    gl.uniform1i(locations.uSuper, supersample ? 2 : viewWidth * viewHeight <= TWO_TAP_PIXELS ? 1 : 0);
    gl.uniform1f(locations.uRimPx, settings.rimPx * deviceRatio);
    gl.uniform1f(locations.uGrain, settings.grain);
    gl.uniform1f(locations.uSeed, settings.seed);
    gl.uniform3f(locations.uPaper, paper[0], paper[1], paper[2]);
    for (let index = 0; index < rim.length; index += 1) rim[index] = rimBase[index] * settings.rimDark;
    gl.uniform3fv(locations.uAvg, avg);
    gl.uniform3fv(locations.uRim, rim);
    gl.uniform1fv(locations.uTileReady, tileReady);
    gl.uniform1i(locations.uHighlight, highlight.mix > 0.001 ? highlight.shown : -1);
    gl.uniform1f(locations.uHighlightMix, highlight.mix);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function render(supersample = false) {
    if (destroyed || viewWidth < 2) return;
    uploadOps();
    bindCommon();
    maintainSheet();
    bindCommon();
    drawView(supersample);
  }

  function uploadNextTile() {
    const next = uploadQueue.shift();
    if (!next) return false;
    const { slot, element } = next;
    const width = element.naturalWidth || element.width;
    const height = element.naturalHeight || element.height;
    if (!width || !height) return true;
    const side = Math.min(width, height);
    tileContext.clearRect(0, 0, TILE, TILE);
    tileContext.drawImage(element, (width - side) / 2, (height - side) / 2, side, side, 0, 0, TILE, TILE);
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, (slot % 4) * TILE, Math.floor(slot / 4) * TILE, gl.RGBA, gl.UNSIGNED_BYTE, tileCanvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      tileReady[slot] = 1;
    } catch {
      tileReady[slot] = 0;
    }
    return true;
  }

  function coversReady() {
    return coversSet && uploadQueue.length === 0;
  }

  function stepAnimations(now) {
    let active = false;
    for (let index = animations.length - 1; index >= 0; index -= 1) {
      const animation = animations[index];
      if (animation.start < 0) animation.start = now;
      const progress = animation.duration > 0 ? Math.min(1, (now - animation.start) / animation.duration) : 1;
      animation.apply(progress);
      if (progress >= 1) {
        animations.splice(index, 1);
        animation.finish?.();
      } else {
        active = true;
      }
    }
    return active;
  }

  function stepFollow(dt) {
    let active = false;
    const blend = followRate <= 0 ? 1 : 1 - Math.exp(-(dt * 1000) / followRate);
    for (let index = baked; index < ops.length; index += 1) {
      const op = ops[index];
      const target = op.follow;
      if (!target) continue;
      let moving = false;
      for (let keyIndex = 0; keyIndex < FOLLOW_KEYS.length; keyIndex += 1) {
        const key = FOLLOW_KEYS[keyIndex];
        if (target[key] === undefined) continue;
        const delta = target[key] - op[key];
        if (Math.abs(delta) > FOLLOW_EPSILON) {
          op[key] += delta * blend;
          moving = true;
        } else {
          op[key] = target[key];
        }
      }
      if (moving) {
        markOps(index);
        active = true;
      } else if (target.release) {
        markOps(index);
        op.follow = null;
        target.release();
      }
    }
    return active;
  }

  function stepHighlight(dt) {
    if (highlight.index >= 0) highlight.shown = highlight.index;
    const goal = highlight.index >= 0 ? 1 : 0;
    const delta = goal - highlight.progress;
    if (Math.abs(delta) < 1e-3) {
      highlight.progress = goal;
      highlight.mix = goal;
      if (!goal) highlight.shown = -1;
      return false;
    }
    highlight.progress += Math.sign(delta) * Math.min(Math.abs(delta), dt / 0.16);
    highlight.mix = EASE.hover(highlight.progress);
    return true;
  }

  function tick(now) {
    frame = 0;
    if (destroyed) return;
    const dt = lastTick ? Math.min(1 / 30, Math.max(1 / 240, (now - lastTick) / 1000)) : 1 / 60;
    lastTick = now;
    const uploading = uploadNextTile();
    const animating = stepAnimations(now);
    const following = stepFollow(dt);
    const highlighting = stepHighlight(dt);
    const growing = growers.size > 0;
    for (const grow of growers) grow(now);
    render(false);
    if (!painted && coversReady()) {
      painted = true;
      onPainted?.();
    }
    if (animating || following || highlighting || growing || uploading) {
      schedule();
    } else {
      lastTick = 0;
      scheduleSettle();
    }
  }

  function schedule() {
    if (destroyed || paused || frame) return;
    clearTimeout(settleTimer);
    settleTimer = 0;
    frame = requestAnimationFrame(tick);
  }

  function scheduleSettle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = 0;
      if (destroyed || paused || frame) {
        pendingSuper = true;
        return;
      }
      render(true);
    }, SETTLE_MS);
  }

  function emitChange() {
    if (changeTimer) return;
    changeTimer = setTimeout(flushChange, CHANGE_THROTTLE_MS);
  }

  function flushChange() {
    changeTimer = 0;
    if (destroyed) return;
    let drops = 0;
    let pulls = 0;
    for (const op of ops) {
      if (op.removing || !op.user) continue;
      if (op.type === OP_DROP) drops += 1;
      else pulls += 1;
    }
    onChange?.({ drops, pulls, canUndo: ops.some((op) => !op.removing) });
  }

  function animate(op, duration, apply, finish) {
    op.animating = (op.animating || 0) + 1;
    const index = ops.indexOf(op);
    const animation = {
      start: -1,
      duration,
      apply: (progress) => {
        apply(progress);
        const at = ops.indexOf(op);
        if (at >= 0) markOps(at);
      },
      finish: () => {
        op.animating -= 1;
        finish?.();
      },
    };
    if (index >= 0) markOps(index);
    animations.push(animation);
    schedule();
    return animation;
  }

  const engine = {
    get ops() {
      return ops;
    },
    get floatTargets() {
      return sheetsUsable;
    },
    resize(cssWidth, cssHeight, dprCap) {
      const ratio = Math.min(window.devicePixelRatio || 1, dprCap);
      const budget = Math.sqrt(PIXEL_BUDGET / Math.max(1, cssWidth * cssHeight));
      const shortSide = Math.min(cssWidth, cssHeight) * SHEET_MARGIN * 2;
      const textureFit = maxTextureSize / Math.max(1, Math.max(cssWidth, cssHeight) + shortSide);
      const scale = Math.max(0.25, Math.min(ratio, budget, textureFit));
      const width = Math.max(2, Math.round(cssWidth * scale));
      const height = Math.max(2, Math.round(cssHeight * scale));
      if (width === viewWidth && height === viewHeight) return;
      deviceRatio = width / Math.max(1, cssWidth);
      viewWidth = width;
      viewHeight = height;
      canvas.width = width;
      canvas.height = height;
      unit = Math.min(width, height);
      sheetWidth = Math.round(width + unit * SHEET_MARGIN * 2);
      sheetHeight = Math.round(height + unit * SHEET_MARGIN * 2);
      sheetsUsable = createSheets();
      sheetCurrent = 0;
      baked = 0;
      rebuildTo = ops.length;
      markOps(0, ops.length);
      render(false);
      schedule();
    },
    setCovers(items) {
      coversSet = true;
      uploadQueue.length = 0;
      items.slice(0, COVER_SLOTS).forEach((item, slot) => {
        avg.set([item.red / 255, item.green / 255, item.blue / 255], slot * 3);
        const palette = item.palette?.length ? item.palette.map(parseRgb) : [[item.red / 255, item.green / 255, item.blue / 255]];
        let darkest = palette[0];
        for (const colour of palette) {
          const light = colour[0] * 0.2126 + colour[1] * 0.7152 + colour[2] * 0.0722;
          const best = darkest[0] * 0.2126 + darkest[1] * 0.7152 + darkest[2] * 0.0722;
          if (light < best) darkest = colour;
        }
        rimBase.set(darkest, slot * 3);
        tileReady[slot] = 0;
        if (item.element) uploadQueue.push({ slot, element: item.element });
      });
      schedule();
    },
    setSettings(next) {
      const lambdaChanged = next.lambda !== undefined && next.lambda !== settings.lambda;
      Object.assign(settings, next);
      if (next.paper) {
        const rgb = hexToRgb(next.paper);
        paper[0] = rgb[0];
        paper[1] = rgb[1];
        paper[2] = rgb[2];
      }
      if (next.followMs !== undefined) followRate = next.followMs;
      if (lambdaChanged) rebuildTo = ops.length;
      schedule();
    },
    setHighlight(index) {
      highlight.index = index;
      schedule();
    },
    push(op) {
      if (ops.length >= MAX_OPS) return -1;
      if (ops.length - baked >= PASS_OPS - 1 && firstUnsettled() <= baked) return -1;
      ops.push(op);
      markOps(ops.length - 1);
      emitChange();
      schedule();
      return ops.length - 1;
    },
    pushMany(list) {
      const from = ops.length;
      for (const op of list) {
        if (ops.length >= MAX_OPS) break;
        ops.push(op);
      }
      markOps(from, ops.length);
      emitChange();
      schedule();
    },
    touch(op) {
      const index = ops.indexOf(op);
      if (index < 0) return;
      if (index < baked) rebuildTo = rebuildTo >= 0 ? Math.min(rebuildTo, index) : index;
      markOps(index);
      schedule();
    },
    remove(op) {
      const index = ops.indexOf(op);
      if (index < 0) return;
      if (index < baked) rebuildTo = rebuildTo >= 0 ? Math.min(rebuildTo, index) : index;
      ops.splice(index, 1);
      markOps(index, ops.length + 1);
      emitChange();
      schedule();
    },
    animate,
    grow(fn) {
      growers.add(fn);
      schedule();
      return () => growers.delete(fn);
    },
    undo(duration) {
      let index = ops.length - 1;
      while (index >= 0 && ops[index].removing) index -= 1;
      if (index < 0) return null;
      const op = ops[index];
      op.removing = true;
      op.follow = null;
      if (index < baked) {
        rebuildTo = Math.max(0, index - LIVE_KEEP);
        baked = Math.min(baked, rebuildTo);
      }
      emitChange();
      const from = op.amount;
      animate(
        op,
        duration,
        (progress) => {
          op.amount = from * (1 - EASE.standard(progress));
        },
        () => engine.remove(op),
      );
      return op;
    },
    clear() {
      for (const animation of animations) animation.finish?.();
      animations.length = 0;
      growers.clear();
      ops.length = 0;
      baked = 0;
      rebuildTo = -1;
      opsDirtyFrom = 0;
      opsDirtyTo = 0;
      emitChange();
      schedule();
    },
    renderNow(supersample = false) {
      render(supersample);
    },
    snapshot(target) {
      render(true);
      const context = target.getContext("2d");
      target.width = viewWidth;
      target.height = viewHeight;
      context.drawImage(canvas, 0, 0);
    },
    capture() {
      const out = document.createElement("canvas");
      engine.snapshot(out);
      return out;
    },
    setPaused(next) {
      paused = next;
      if (paused) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        lastTick = 0;
        return;
      }
      schedule();
      if (pendingSuper) {
        pendingSuper = false;
        scheduleSettle();
      }
    },
    destroy() {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      clearTimeout(settleTimer);
      clearTimeout(changeTimer);
      growers.clear();
      animations.length = 0;
      destroySheets();
      gl.deleteTexture(opTexture);
      gl.deleteTexture(atlas);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    if (!destroyed) onError?.(new Error("context lost"));
  });

  return engine;
}
