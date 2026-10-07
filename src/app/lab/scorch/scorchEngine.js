import createResolutionGovernor from "@/app/experiments/resolutionGovernor";

import { fuelAt, loadCover } from "./scorchCovers";
import { SCORCH_DEFAULTS, SIM } from "./scorchParams";
import { SCORCH_DISPLAY, SCORCH_FUEL, SCORCH_GLOW, SCORCH_SIM, SCORCH_STATS, SCORCH_VERTEX } from "./scorchShader";

const GLOW_SIZE = 64;
const STATS_SIZE = 16;
const STATS_EVERY = 20;
const MAX_SOURCES = 4;
const MAX_STEPS_PER_FRAME = 16;
const PRESIM_STEPS_PER_FRAME = 160;
const SOURCE_LIFE = 1.4;
const DOUSE_SECONDS = 0.6;
const DOUSE_RATE = 6;
const FINISH_SECONDS = 1.1;
const SKIP_SECONDS = 0.7;
const REDUCED_FINISH_SECONDS = 0.45;
const HEAT_ALIVE = 0.08;
const WIND_REST = 0.002;
const PAPER = [0.925, 0.906, 0.871];
const LOOKAHEAD = 3;
const HALF_FLOAT_MIN_DELTA = 0.0008;

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

function makeTarget(gl, size, internalFormat) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, size, size);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer, size, complete };
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function seedFor(index) {
  const value = Math.sin(index * 91.7 + 13.1) * 43758.5453;
  return (value - Math.floor(value)) * 10;
}

export function createScorchEngine(canvas, options) {
  const { covers, gridSize, dprCap, reducedMotion, onSheet, onBurnt, onReady, onError, onActivity } = options;

  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
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
  let fuelPass;
  let simPass;
  let glowPass;
  let statsPass;
  let displayPass;
  try {
    vertex = compile(gl, gl.VERTEX_SHADER, SCORCH_VERTEX);
    fuelPass = link(gl, vertex, SCORCH_FUEL);
    simPass = link(gl, vertex, SCORCH_SIM);
    glowPass = link(gl, vertex, SCORCH_GLOW);
    statsPass = link(gl, vertex, SCORCH_STATS);
    displayPass = link(gl, vertex, SCORCH_DISPLAY);
  } catch {
    onError("shader");
    return null;
  }

  const size = gridSize;
  let stateFormat = fullFloat && floatLinear ? gl.RGBA32F : gl.RGBA16F;
  let stateTargets = [makeTarget(gl, size, stateFormat), makeTarget(gl, size, stateFormat)];
  if (stateFormat === gl.RGBA32F && stateTargets.some((target) => !target.complete)) {
    for (const target of stateTargets) {
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.framebuffer);
    }
    stateFormat = gl.RGBA16F;
    stateTargets = [makeTarget(gl, size, stateFormat), makeTarget(gl, size, stateFormat)];
  }
  const minDelta = stateFormat === gl.RGBA32F ? 0 : HALF_FLOAT_MIN_DELTA;
  const fuelTarget = makeTarget(gl, size, gl.RGBA8);
  const glowTarget = makeTarget(gl, GLOW_SIZE, gl.RGBA16F);
  const statsTarget = makeTarget(gl, STATS_SIZE, gl.RGBA8);
  const targets = [...stateTargets, fuelTarget, glowTarget, statsTarget];
  if (targets.some((target) => !target.complete)) {
    onError("float");
    for (const target of targets) {
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.framebuffer);
    }
    return null;
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const blank = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([236, 231, 222, 255]));

  const statsPixels = new Uint8Array(STATS_SIZE * STATS_SIZE * 4);
  const sourceData = new Float32Array(MAX_SOURCES * 4);
  const sources = [];
  const governor = createResolutionGovernor({ max: 1, min: 0.55 });
  const coverCount = covers.length;
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
  let finish = 0;
  let finishSeconds = FINISH_SECONDS;
  let finishing = false;
  let douseUntil = -1;
  let cssWidth = 1;
  let cssHeight = 1;
  let dpr = 1;
  let spotCursor = 0;
  const wind = { x: 0, y: 0, tx: 0, ty: 0, at: [0.5, 0.5], driven: false };

  const positionOf = (index) => ((index % coverCount) + coverCount) % coverCount;

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
    loadCover(covers[slot.position]).then((data) => {
      if (disposed) return;
      if (!data) {
        slot.status = "failed";
        if ([...slots.values()].filter((entry) => entry.status === "failed").length >= coverCount) onError("covers");
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
    for (let step = 0; step < coverCount; step += 1) {
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
    slot.texture = texture;
    slot.status = "ready";
  }

  function trimSlots() {
    const keep = new Set();
    for (let step = 0; step < LOOKAHEAD; step += 1) keep.add(positionOf(sheetIndex + step));
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
  }

  function bindTexture(unit, texture) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  function drawInto(target) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
    if (target) gl.viewport(0, 0, target.size, target.size);
    else gl.viewport(0, 0, canvas.width, canvas.height);
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

  function activeSources() {
    let count = 0;
    for (let index = sources.length - 1; index >= 0; index -= 1) {
      const source = sources[index];
      const age = clock - source.start;
      const until = Math.min(source.start + SOURCE_LIFE, Math.max(source.start + SIM.sourceHold, source.end));
      if (clock > until) {
        sources.splice(index, 1);
        continue;
      }
      if (count >= MAX_SOURCES) continue;
      const grow = reducedMotion ? 1 : easeOutBack(Math.min(1, age / SIM.sourceGrow));
      sourceData[count * 4] = source.u;
      sourceData[count * 4 + 1] = source.v;
      sourceData[count * 4 + 2] = Math.max(0, SIM.sourceRadius * grow);
      sourceData[count * 4 + 3] = SIM.sourceHeat;
      count += 1;
    }
    return count;
  }

  let readIndex = 0;

  function simulate(dt, sourceCount) {
    const { program, uniforms } = simPass;
    gl.useProgram(program);
    const diffusion = SIM.diffusion * params.heatSpread;
    const dousing = clock < douseUntil;
    gl.uniform1i(uniforms.uState, 0);
    gl.uniform1i(uniforms.uFuel, 1);
    gl.uniform2f(uniforms.uTexel, 1 / size, 1 / size);
    gl.uniform1f(uniforms.uDt, dt);
    gl.uniform1f(uniforms.uDiffuse, Math.min(0.24, diffusion * size * size * dt));
    gl.uniform1f(uniforms.uRateBase, SIM.rateBase);
    gl.uniform1f(uniforms.uRateInk, SIM.rateInk);
    gl.uniform1f(uniforms.uGain, SIM.gain);
    gl.uniform1f(uniforms.uKeep, Math.exp(-SIM.loss * dt) * (dousing ? Math.exp((-DOUSE_RATE / params.burnRate) * dt) : 1));
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
    gl.uniform4fv(uniforms.uSources, sourceData);
    gl.uniform1i(uniforms.uSourceCount, dousing ? 0 : sourceCount);
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
    drawInto(glowTarget);
  }

  function readStats() {
    const { program, uniforms } = statsPass;
    gl.useProgram(program);
    bindTexture(0, glowTarget.texture);
    gl.uniform1i(uniforms.uGlow, 0);
    gl.uniform2f(uniforms.uGlowTexel, 1 / GLOW_SIZE, 1 / GLOW_SIZE);
    drawInto(statsTarget);
    gl.bindFramebuffer(gl.FRAMEBUFFER, statsTarget.framebuffer);
    gl.readPixels(0, 0, STATS_SIZE, STATS_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, statsPixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let burntSum = 0;
    let hottest = 0;
    let heatSum = 0;
    const cells = STATS_SIZE * STATS_SIZE;
    for (let index = 0; index < cells; index += 1) {
      burntSum += statsPixels[index * 4];
      hottest = Math.max(hottest, statsPixels[index * 4 + 1]);
      heatSum += statsPixels[index * 4 + 2];
    }
    burnt = burntSum / cells / 255;
    heatAlive = (hottest / 255) * 2 > HEAT_ALIVE;
    onBurnt(finishing ? Math.max(burnt, SIM.turnoverAt) : burnt);
    onActivity(heatSum / cells / 255);
    if (!finishing && burnt >= SIM.turnoverAt) beginFinish(reducedMotion ? REDUCED_FINISH_SECONDS : FINISH_SECONDS);
  }

  function render() {
    const sheet = slotFor(sheetIndex);
    const under = slotFor(underIndex);
    const underReady = under.status === "ready" && under.texture ? 1 : 0;
    const { program, uniforms } = displayPass;
    gl.useProgram(program);
    bindTexture(0, stateTargets[readIndex].texture);
    bindTexture(1, glowTarget.texture);
    bindTexture(2, sheet.texture ?? blank);
    bindTexture(3, underReady ? under.texture : blank);
    gl.uniform1i(uniforms.uState, 0);
    gl.uniform1i(uniforms.uGlow, 1);
    gl.uniform1i(uniforms.uSheet, 2);
    gl.uniform1i(uniforms.uUnder, 3);
    gl.uniform4fv(uniforms.uSheetCrop, sheet.data?.crop ?? [1, 1, 0, 0]);
    gl.uniform4fv(uniforms.uUnderCrop, underReady ? under.data.crop : [1, 1, 0, 0]);
    gl.uniform2f(uniforms.uResolution, canvas.width, canvas.height);
    gl.uniform2f(uniforms.uGlowTexel, 1 / GLOW_SIZE, 1 / GLOW_SIZE);
    gl.uniform1f(uniforms.uTime, clock);
    gl.uniform1f(uniforms.uEmber, params.ember);
    gl.uniform1f(uniforms.uCharTone, params.charTone);
    gl.uniform1f(uniforms.uHalo, params.halo);
    gl.uniform1f(uniforms.uFinish, finish);
    gl.uniform1f(uniforms.uFlicker, reducedMotion ? 0 : 1);
    gl.uniform1f(uniforms.uSeed, seedFor(sheetIndex));
    gl.uniform1f(uniforms.uUnderReady, underReady);
    gl.uniform3fv(uniforms.uPaper, PAPER);
    drawInto(null);
  }

  function beginFinish(seconds) {
    finishing = true;
    finish = 0;
    finishSeconds = seconds;
    sources.length = 0;
    wake();
  }

  function turnOver() {
    sheetIndex = underIndex;
    underIndex = usableFrom(sheetIndex + 1);
    finishing = false;
    finish = 0;
    burnt = 0;
    heatAlive = false;
    douseUntil = -1;
    wind.x = 0;
    wind.y = 0;
    wind.tx = 0;
    wind.ty = 0;
    spotCursor = 0;
    clearState();
    writeFuel();
    writeGlow();
    trimSlots();
    prefetch();
    onBurnt(0);
    onActivity(0);
    onSheet(positionOf(sheetIndex), positionOf(underIndex));
  }

  function tryStart() {
    if (ready) return;
    const first = usableFrom(current);
    const sheet = slotFor(first);
    if (sheet.status !== "ready") return;
    const second = usableFrom(first + 1);
    const under = slotFor(second);
    if (under.status !== "ready" && under.status !== "failed") return;
    sheetIndex = first;
    underIndex = second;
    clearState();
    writeFuel();
    const picks = introSpots(sheet.data.spots);
    for (const pick of picks) sources.push({ id: `intro-${pick.u}`, u: pick.u, v: pick.v, start: clock, end: clock + 0.9 });
    presimLeft = SIM.presimSeconds;
    ready = true;
    onSheet(positionOf(sheetIndex), positionOf(underIndex));
  }

  function introSpots(spots) {
    const lowerLeft = spots.filter((spot) => spot.u < 0.55 && spot.v < 0.55);
    const pool = lowerLeft.length >= 2 ? lowerLeft : spots;
    const picks = [];
    for (const spot of pool) {
      if (picks.length >= 2) break;
      if (picks.some((pick) => Math.hypot(pick.u - spot.u, pick.v - spot.v) < 0.16)) continue;
      picks.push(spot);
    }
    if (picks.length === 0) picks.push({ u: 0.22, v: 0.24 }, { u: 0.36, v: 0.13 });
    if (picks.length === 1) picks.push({ u: Math.min(0.9, picks[0].u + 0.18), v: Math.max(0.1, picks[0].v - 0.12) });
    return picks;
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

  function needsFrames() {
    if (!ready) return uploads.length > 0;
    return (
      presimLeft > 0 ||
      uploads.length > 0 ||
      heatAlive ||
      sources.length > 0 ||
      wind.driven ||
      Math.hypot(wind.x, wind.y) > WIND_REST ||
      finishing ||
      clock < douseUntil + 0.2
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
        if (needsFrames()) schedule();
        else lastTime = 0;
        return;
      }
    }

    const stepDt = stepSeconds();
    if (presimLeft > 0) {
      let steps = 0;
      while (presimLeft > 0 && steps < PRESIM_STEPS_PER_FRAME) {
        clock += stepDt;
        simulate(stepDt, activeSources());
        presimLeft -= stepDt;
        steps += 1;
      }
      writeGlow();
      if (presimLeft <= 0) {
        render();
        readStats();
        onReady();
      }
      schedule();
      return;
    }

    updateWind(dt);
    if (finishing) {
      finish = Math.min(1, finish + dt / finishSeconds);
      const under = slotFor(underIndex);
      if (finish >= 1 && (under.status === "ready" || under.status === "failed")) turnOver();
    }

    accumulator += dt * params.burnRate;
    let steps = 0;
    while (accumulator >= stepDt && steps < MAX_STEPS_PER_FRAME) {
      clock += stepDt / params.burnRate;
      simulate(stepDt, activeSources());
      accumulator -= stepDt;
      steps += 1;
    }
    if (steps >= MAX_STEPS_PER_FRAME) accumulator = 0;
    if (steps === 0) clock += dt;
    writeGlow();
    render();
    frameCount += 1;
    if (frameCount % STATS_EVERY === 0) readStats();
    if (governor.sample(elapsed)) {
      applySize();
      render();
    }
    if (needsFrames()) schedule();
    else {
      readStats();
      lastTime = 0;
      if (needsFrames()) schedule();
    }
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
    const width = Math.max(1, Math.round(cssWidth * ratio));
    const height = Math.max(1, Math.round(cssHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
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
      if (!ready || finishing) return false;
      for (let index = sources.length - 1; index >= 0; index -= 1) if (sources[index].id === id) sources.splice(index, 1);
      sources.push({ id, u, v, start: clock, end: Infinity });
      douseUntil = -1;
      heatAlive = true;
      wake();
      return true;
    },
    release(id) {
      for (const source of sources) if (source.id === id) source.end = clock;
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
      wind.driven = true;
      wake();
    },
    calm() {
      wind.driven = false;
      wind.tx = 0;
      wind.ty = 0;
      wake();
    },
    douse() {
      if (!ready) return;
      sources.length = 0;
      douseUntil = clock + DOUSE_SECONDS;
      wind.driven = false;
      wind.tx = 0;
      wind.ty = 0;
      wake();
    },
    skip() {
      if (!ready || finishing || presimLeft > 0) return;
      beginFinish(reducedMotion ? REDUCED_FINISH_SECONDS : SKIP_SECONDS);
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
      for (const target of targets) {
        gl.deleteTexture(target.texture);
        gl.deleteFramebuffer(target.framebuffer);
      }
      gl.deleteTexture(blank);
      for (const pass of [fuelPass, simPass, glowPass, statsPass, displayPass]) gl.deleteProgram(pass.program);
      gl.deleteShader(vertex);
      gl.deleteVertexArray(vao);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
