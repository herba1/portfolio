import createResolutionGovernor from "@/app/experiments/resolutionGovernor";

import { createPluckBank, warpDegree, weftDegree } from "./loomAudio";
import { LOOM_FRAGMENT, LOOM_VERTEX } from "./loomShader";

const MAX_THREADS = 128;
const STATE_ROWS = 5;
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
const MAX_RELEASE_SPEED = 8;
const TAP_IMPULSE = 2.4;
const KEY_PULL = 4.2;
const IMPULSE_SPREAD = 2.2;
const LANDING_ZETA = 0.66;
const LANDING_MS = 1100;
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
const INTRO_STAGGER_MS = 9;
const INTRO_HOLD_MS = 420;
const INTRO_AMPLITUDE = 0.15;
const COVER_SPREAD_MS = 640;
const WARP_POP_DELAY_MS = 280;
const WARP_POP_SPREAD_MS = 420;
const THREADS_REBUILD_GAP_MS = 700;
const COVER_SIZE = 512;
const SUPERSAMPLE_BELOW_PX = 9;
const PAGE_DPR_CAP = 2;
const BLANK_RGB = [233, 237, 243];
const MAX_GRABS = 10;
const REEL_REACH = 2;
const SLIP_FLOOR = 0.004;
const RESTORE_WAIT_MS = 2500;

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
    armAt: new Float32Array(MAX_THREADS).fill(ARM_WIDTHS),
    peak: new Float32Array(MAX_THREADS),
    quietUntil: new Float64Array(MAX_THREADS),
    swell: new Float32Array(MAX_THREADS).fill(1),
    popStart: new Float64Array(MAX_THREADS).fill(-Infinity),
    thick: new Float32Array(MAX_THREADS).fill(1),
    reel: new Float32Array(MAX_THREADS),
  };
}

function resetChain(chain) {
  chain.x.fill(0);
  chain.v.fill(0);
  chain.pinned.fill(0);
  chain.heldUntil.fill(0);
  chain.landUntil.fill(0);
  chain.armed.fill(0);
  chain.peak.fill(0);
  chain.reel.fill(0);
  chain.popStart.fill(-Infinity);
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

export function createLoom({ canvas, covers, index, params, reducedMotion, onPainted, onError }) {
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
  const grabAxis = new Int8Array(MAX_GRABS);
  const grabIndex = new Int16Array(MAX_GRABS);

  const wrapIndex = (value) => ((value % count) + count) % count;

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
      if (ringDistance(key, current) > REEL_REACH) {
        if (entry.texture) gl.deleteTexture(entry.texture);
        textures.delete(key);
      }
    }
  };

  const textureFor = (coverIndex) => {
    if (!count) return blankTexture;
    const entry = textures.get(wrapIndex(coverIndex));
    return entry?.ready && entry.texture ? entry.texture : blankTexture;
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
    originX = (width - clothPx) / 2;
    originY = (height - clothPx) / 2;
  };

  const pluckFrom = (isWarp, row, strength) => {
    if (!audio || !soundOn) return;
    const degree = isWarp ? warpDegree(row, threads) : weftDegree(row, threads);
    const pan = isWarp ? ((row + 0.5) / threads) * 1.4 - 0.7 : 0;
    audio.pluck(degree, isWarp, strength, pan);
  };

  const stepChain = (chain, isWarp, now, frameSeconds) => {
    const { x, v, acc, pinned, heldUntil, rest, landUntil, armed, armAt, peak, quietUntil, target } = chain;
    const n = threads;
    for (let i = 0; i < n; i += 1) {
      if (!pinned[i]) continue;
      v[i] = (target[i] - x[i]) / Math.max(frameSeconds, STEP_SECONDS);
      x[i] += v[i] * STEP_SECONDS;
    }
    const criticalDamping = 2 * Math.sqrt(tension);
    const baseDamping = reducedMotion ? Math.max(damping, criticalDamping) : damping;
    const landingDamping = Math.max(baseDamping, criticalDamping * LANDING_ZETA);
    for (let i = 0; i < n; i += 1) {
      if (pinned[i]) {
        acc[i] = 0;
        continue;
      }
      const home = heldUntil[i] > now ? rest[i] : 0;
      const left = i > 0 ? i - 1 : i;
      const right = i < n - 1 ? i + 1 : i;
      acc[i] =
        -tension * (x[i] - home) -
        (landUntil[i] > now ? landingDamping : baseDamping) * v[i] +
        coupling * (x[left] + x[right] - 2 * x[i]) +
        RELATIVE_DAMPING * (v[left] + v[right] - 2 * v[i]);
    }
    for (let i = 0; i < n; i += 1) {
      if (pinned[i]) continue;
      v[i] += acc[i] * STEP_SECONDS;
      const before = x[i];
      x[i] = before + v[i] * STEP_SECONDS;
      if (heldUntil[i] > now) continue;
      const magnitude = Math.abs(x[i]);
      if (magnitude > armAt[i]) {
        armed[i] = 1;
        if (magnitude > peak[i]) peak[i] = magnitude;
      }
      if (armed[i] && before * x[i] <= 0 && before !== 0) {
        armed[i] = 0;
        if (now >= quietUntil[i]) {
          quietUntil[i] = now + 120;
          pluckFrom(isWarp, i, Math.min(1, peak[i] / STRENGTH_WIDTHS));
        }
        armAt[i] = Math.max(ARM_WIDTHS, peak[i] * REARM_RATIO);
        peak[i] = 0;
      }
    }
    for (let i = 0; i < n; i += 1) {
      if (!pinned[i]) continue;
      const magnitude = Math.abs(x[i]);
      if (magnitude > ARM_WIDTHS) {
        armed[i] = 1;
        if (magnitude > peak[i]) peak[i] = magnitude;
      }
    }
  };

  const collectGrabs = () => {
    grabCount = 0;
    for (const grab of grabs.values()) {
      if (!grab.axis || grabCount >= MAX_GRABS) continue;
      grabAxis[grabCount] = grab.axis;
      grabIndex[grabCount] = grab.index;
      grabCount += 1;
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
          lift = Math.max(lift, SWELL_PEAK * Math.exp(-d * d));
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
          if (t >= 0) {
            chain.reel[i] = 0;
            presence = POP_FROM + (1 - POP_FROM) * popCurve(t);
          }
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

  const writeState = () => {
    const n = threads;
    let slip = 0;
    for (let i = 0; i < n; i += 1) {
      const weftX = weft.x[i];
      const warpX = warp.x[i];
      stateData[i] = weftX;
      stateData[MAX_THREADS + i] = warpX;
      stateData[MAX_THREADS * 2 + i] = weft.thick[i];
      stateData[MAX_THREADS * 3 + i] = warp.thick[i];
      stateData[MAX_THREADS * 4 + i] = warp.reel[i];
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

  const draw = () => {
    if (destroyed || contextLost || gl.isContextLost()) return;
    writeState();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.bindVertexArray(vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, stateTexture);
    gl.uniform1i(uniforms.uState, 0);
    bindCover(1, uniforms.uPrevFar, current - 2);
    bindCover(2, uniforms.uPrev, current - 1);
    bindCover(3, uniforms.uCurrent, current);
    bindCover(4, uniforms.uNext, current + 1);
    bindCover(5, uniforms.uNextFar, current + 2);

    gl.uniform2f(uniforms.uResolution, canvas.width, canvas.height);
    gl.uniform4f(uniforms.uCloth, originX, originY, clothPx, threads);
    gl.uniform1i(uniforms.uWeave, weave);
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
    if (grabs.size) return false;
    for (let c = 0; c < 2; c += 1) {
      const chain = chains[c];
      for (let i = 0; i < threads; i += 1) {
        if (chain.heldUntil[i] > now) return false;
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
      chain.peak.fill(0);
    }
  };

  const holdCascade = (now, from, to, stagger, offsetFor) => {
    for (let i = from; i < to; i += 1) {
      const amount = offsetFor(i);
      if (amount === null) continue;
      weft.x[i] = amount;
      weft.rest[i] = amount;
      weft.v[i] = 0;
      weft.heldUntil[i] = now + (i - from) * stagger;
    }
  };

  const startIntro = (time) => {
    introPending = false;
    if (reducedMotion) return;
    const n = threads;
    const from = Math.round(n * 0.21);
    const to = Math.round(n * 0.73);
    const span = to - from;
    holdCascade(time + INTRO_HOLD_MS, from, to, INTRO_STAGGER_MS * (96 / n), (i) => {
      const t = (i - from) / span;
      return INTRO_AMPLITUDE * Math.sin(2 * Math.PI * t) * Math.sin(Math.PI * t) ** 0.35;
    });
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
      const chain = chains[grabAxis[g] - 1];
      chain.x[grabIndex[g]] = chain.target[grabIndex[g]];
    }

    const looksBusy = updateLooks(time, dt);
    draw();

    if (!looksBusy && isSettled(time)) {
      settle();
      draw();
      running = false;
      lastTime = 0;
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

  const startCoverChange = (nextIndex, direction) => {
    const forward = wrapIndex((nextIndex - current) * direction);
    const steps = forward >= 1 && forward <= REEL_REACH ? forward : 1;
    current = nextIndex;
    keepNeighbours();
    if (reducedMotion) {
      draw();
      return;
    }
    const shift = direction * steps;
    const limit = REEL_REACH - steps;
    const clampReel = (value) => Math.max(-limit, Math.min(limit, value));
    for (const grab of grabs.values()) {
      if (grab.axis !== 1) continue;
      const before = weft.target[grab.index];
      grab.base += clampReel(before) - before + shift;
    }
    const n = threads;
    const now = performance.now();
    const stagger = COVER_SPREAD_MS / n;
    for (let i = 0; i < n; i += 1) {
      weft.x[i] = clampReel(weft.x[i]) + shift;
      if (weft.pinned[i]) {
        weft.target[i] = clampReel(weft.target[i]) + shift;
        continue;
      }
      weft.rest[i] = weft.x[i];
      weft.heldUntil[i] = now + i * stagger;
      weft.landUntil[i] = weft.heldUntil[i] + LANDING_MS;
      weft.v[i] = 0;
    }
    const warpStagger = WARP_POP_SPREAD_MS / n;
    for (let j = 0; j < n; j += 1) {
      const order = direction > 0 ? j : n - 1 - j;
      warp.reel[j] = Math.max(-REEL_REACH, Math.min(REEL_REACH, warp.reel[j] - shift));
      warp.popStart[j] = now + WARP_POP_DELAY_MS + order * warpStagger;
    }
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

  const clampIndex = (value) => Math.min(threads - 1, Math.max(0, Math.floor(value)));

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
    chain.v[i] = Math.max(-MAX_RELEASE_SPEED, Math.min(MAX_RELEASE_SPEED, speed));
    chain.heldUntil[i] = 0;
  };

  const kick = (chain, centre, amount, quietUntil) => {
    const reach = Math.ceil(IMPULSE_SPREAD * 3);
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
    rect = canvas.getBoundingClientRect();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {}
    ensureAudio();
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
    const [cellX, cellY] = pointerCell(event.clientX, event.clientY);
    pointerCellX = cellX;
    pointerCellY = cellY;
    updateHover(event.pointerType, Boolean(grab));
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
        chain.pinned[grab.index] = 1;
        chain.heldUntil[grab.index] = 0;
        canvas.dataset.axis = grab.axis === 1 ? "row" : "column";
      }
      if (grab.axis) {
        const chain = chains[grab.axis - 1];
        const value = grab.base + (grab.axis === 1 ? dx : dy) / clothCss();
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
        const weftTop = weftOver(weave, row, col);
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
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      ensureAudio();
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
      kick(weft, focusRow, KEY_PULL * direction, 0);
      wake();
      return;
    }
    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      ensureAudio();
      if (focusRow < 0) focusRow = Math.floor(threads / 2);
      pluckThread(false, focusRow, TAP_IMPULSE, 0.6);
    }
  };

  const onBlur = () => {
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
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("pointerenter", onPointerEnter);
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  keepNeighbours();
  textures.get(wrapIndex(current))?.promise?.then(() => {
    if (destroyed) return;
    coverReady = true;
    draw();
    wake();
  });

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
        wake();
      } else if (frameId) {
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
        grabs.clear();
        focusRow = -1;
        resetChain(weft);
        resetChain(warp);
        if (!reducedMotion && now - lastThreadsChange > THREADS_REBUILD_GAP_MS) {
          const spread = WARP_POP_SPREAD_MS / threads;
          for (let j = 0; j < threads; j += 1) warp.popStart[j] = now + j * spread;
        }
        lastThreadsChange = now;
        resize();
      } else if (next.weave !== weave && !reducedMotion) {
        for (let j = 0; j < threads; j += 1) warp.popStart[j] = now + j * (WARP_POP_SPREAD_MS / threads);
      }
      weave = next.weave;
      draw();
      wake();
    },
    primeAudio: primeOnGesture,
    destroy() {
      destroyed = true;
      clearTimeout(lostTimer);
      if (frameId) cancelAnimationFrame(frameId);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
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
    onBlur,
  };

  return engine;
}
