import { buildAtlas, measureAdvance } from "./stirAtlas";
import { createFluid } from "./stirFluid";
import * as P from "./stirParams";
import { STIR_FRAGMENT, STIR_VERTEX } from "./stirShader";
import { glyphsOf, layoutWall } from "./stirTracks";

const RING_SLOTS = 4;
const GUST_SLOTS = 6;
const FALLBACK_PAPER = [241 / 255, 245 / 255, 249 / 255];
const FALLBACK_INK = [26 / 255, 26 / 255, 26 / 255];
const FALLBACK_FAMILY = "ui-monospace, SFMono-Regular, Menlo, monospace";
const ARROW_SIDES = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "top", ArrowDown: "bottom" };
const GHOST_ID = "ghost";
const UNIFORMS = [
  "uAtlas",
  "uText",
  "uDye",
  "uOrigin",
  "uCell",
  "uGrid",
  "uAtlasSize",
  "uAtlasColumns",
  "uGlyphRows",
  "uMasters",
  "uMasterBase",
  "uMasterStep",
  "uCanvasHeight",
  "uReveal",
  "uRestWeight",
  "uEntryWeight",
  "uWeightRange",
  "uRevealSweep",
  "uRevealJitter",
  "uRevealCell",
  "uRings",
  "uInk",
  "uPaper",
];

function parseRgb(text, fallback) {
  if (!text || !text.startsWith("rgb")) return fallback;
  const parts = text.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return fallback;
  return [Number(parts[0]) / 255, Number(parts[1]) / 255, Number(parts[2]) / 255];
}

function easeOutCubic(t) {
  const inverse = 1 - t;
  return 1 - inverse * inverse * inverse;
}

function smooth(t) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(log || "shader compile failed");
  }
  return shader;
}

function makeTexture(gl, unit, filter) {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function brush(force, grip, dye, cap, size) {
  return { force, grip, dye, cap, size };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createStirWall({ stage, tracks, onWeight, onFail }) {
  let destroyed = false;
  let gl = null;
  let gpu = null;
  let family = FALLBACK_FAMILY;
  let advanceRatio = 0.6;
  let paper = FALLBACK_PAPER;
  let ink = FALLBACK_INK;
  let layout = null;
  let fluid = null;
  let atlas = null;
  let glyphKey = "";
  let rect = null;
  let rafId = 0;
  let resizeRaf = 0;
  let lastTime = 0;
  let revealStart = -1;
  let revealSeconds = 0;
  let introPending = true;
  let onscreen = true;
  let contextLost = false;
  let calmStart = -1;
  let lastArrow = -Infinity;
  let laneCursor = 0;
  let lastReadoutAt = -Infinity;
  let readout = P.REST_WEIGHT;
  let iterations = P.PRESSURE_ITERATIONS;
  let simCost = 0;
  let painted = false;
  let ringPeak = 0;
  let observers = [];
  let dprQuery = null;

  const canvas = document.createElement("canvas");
  canvas.className = "stir__canvas";
  canvas.setAttribute("aria-hidden", "true");
  stage.prepend(canvas);
  const atlasCanvas = document.createElement("canvas");
  const hoverBrush = brush(P.HOVER_FORCE, P.HOVER_GRIP, P.DYE_PER_SPLAT, P.HOVER_DYE_CAP, 1);
  const pressBrush = brush(P.FORCE, P.PRESS_GRIP, P.DYE_PER_SPLAT * 2, P.PRESS_DYE_CAP, 1);
  const ghostBrush = brush(P.FORCE, P.PRESS_GRIP, 0, P.PRESS_DYE_CAP, P.GHOST_SIZE);
  const gustBrush = brush(P.FORCE, P.PRESS_GRIP, 0, P.GUST_DYE_CAP, 1);
  const ghost = { active: false, lifting: false, age: 0, cx: 0, cy: 0, reach: 0 };
  const stirrers = new Map();
  const gusts = Array.from({ length: GUST_SLOTS }, () => ({ active: false, x: 0, y: 0, dirX: 0, dirY: 0, speed: 0, age: 0 }));
  const rings = Array.from({ length: RING_SLOTS }, () => ({ active: false, x: 0, y: 0, age: 0, reach: 0 }));
  const ringUniform = new Float32Array(RING_SLOTS * 4);
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = motionQuery.matches;
  const stepOptions = {
    velocityTau: P.VELOCITY_TAU,
    dyeTau: P.DYE_TAU,
    vorticity: 0,
    iterations: P.PRESSURE_ITERATIONS,
    maxSpeed: P.MAX_SPEED,
  };

  function canRun() {
    return !destroyed && gl && gpu && layout && fluid && !contextLost && onscreen && !document.hidden;
  }

  function stop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    lastTime = 0;
  }

  function wake() {
    if (rafId || !canRun()) return;
    lastTime = 0;
    rafId = requestAnimationFrame(frame);
  }

  function setupGpu() {
    const program = gl.createProgram();
    const vertex = compile(gl, gl.VERTEX_SHADER, STIR_VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, STIR_FRAGMENT);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(log || "program link failed");
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.useProgram(program);
    const uniforms = {};
    for (const name of UNIFORMS) uniforms[name] = gl.getUniformLocation(program, name);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const atlasTexture = makeTexture(gl, 0, gl.NEAREST);
    const textTexture = makeTexture(gl, 1, gl.NEAREST);
    const dyeTexture = makeTexture(gl, 2, gl.LINEAR);
    gl.uniform1i(uniforms.uAtlas, 0);
    gl.uniform1i(uniforms.uText, 1);
    gl.uniform1i(uniforms.uDye, 2);
    gl.uniform1f(uniforms.uRestWeight, P.REST_WEIGHT);
    gl.uniform1f(uniforms.uEntryWeight, P.ENTRY_WEIGHT);
    gl.uniform1f(uniforms.uWeightRange, P.PEAK_WEIGHT - P.REST_WEIGHT);
    gl.uniform1f(uniforms.uRevealSweep, P.REVEAL_SWEEP);
    gl.uniform1f(uniforms.uRevealJitter, P.REVEAL_JITTER);
    gl.uniform1f(uniforms.uRevealCell, P.REVEAL_CELL);
    gpu = { program, vao, uniforms, atlasTexture, textTexture, dyeTexture, maxSize: Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 8192) };
  }

  function readColours() {
    const style = getComputedStyle(stage);
    paper = parseRgb(style.backgroundColor, FALLBACK_PAPER);
    ink = parseRgb(style.color, FALLBACK_INK);
  }

  function measure() {
    const box = stage.getBoundingClientRect();
    const cssW = box.width;
    const cssH = box.height;
    if (!cssW || !cssH) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, P.DPR_CAP);
    const narrow = cssW < P.NARROW_PX;
    const nominalCss = cssW >= P.WIDE_PX ? P.WIDE_FONT_PX : narrow ? P.NARROW_FONT_PX : P.BASE_FONT_PX;
    const lineCss = narrow ? 16 : 20;
    const lawSlope = advanceRatio + P.TRACKING_PER_PX;
    const lawOffset = -P.TRACKING_PER_PX * P.TRACKING_ZERO_PX;
    const cellWDev = Math.max(3, Math.round((nominalCss * lawSlope + lawOffset) * dpr));
    const fontCss = (cellWDev / dpr - lawOffset) / lawSlope;
    const cellHDev = Math.max(4, Math.round(lineCss * dpr));
    const widthDev = Math.max(1, Math.round(cssW * dpr));
    const heightDev = Math.max(1, Math.round(cssH * dpr));
    const padXDev = Math.round((narrow ? 16 : 24) * dpr);
    const padYDev = Math.round(8 * dpr);
    const cols = Math.max(8, Math.floor((widthDev - padXDev * 2) / cellWDev));
    const rows = Math.max(4, Math.floor((heightDev - padYDev * 2) / cellHDev));
    const originXDev = Math.max(0, Math.floor((widthDev - cols * cellWDev) / 2));
    const originYDev = Math.max(0, Math.floor((heightDev - rows * cellHDev) / 2));
    return {
      cssW,
      cssH,
      dpr,
      fontDev: fontCss * dpr,
      lineCss,
      cellWDev,
      cellHDev,
      widthDev,
      heightDev,
      cols,
      rows,
      originXDev,
      originYDev,
      cellW: cellWDev / dpr,
      cellH: cellHDev / dpr,
      originX: originXDev / dpr,
      originY: originYDev / dpr,
      gridW: (cols * cellWDev) / dpr,
      gridH: (rows * cellHDev) / dpr,
      radius: P.SPLAT_LINES * lineCss,
    };
  }

  function resize() {
    if (!gl || !gpu) return;
    const next = measure();
    if (!next) return;
    if (canvas.width !== next.widthDev) canvas.width = next.widthDev;
    if (canvas.height !== next.heightDev) canvas.height = next.heightDev;
    rect = stage.getBoundingClientRect();
    const previous = layout;
    const gridChanged = !previous || previous.cols !== next.cols || previous.rows !== next.rows;
    const tileChanged = !previous || previous.cellWDev !== next.cellWDev || previous.cellHDev !== next.cellHDev || previous.fontDev !== next.fontDev;
    layout = next;
    const { uniforms } = gpu;

    if (gridChanged || tileChanged || !fluid) {
      const lines = layoutWall(tracks, next.cols, next.rows);
      const glyphs = glyphsOf(lines);
      const nextKey = glyphs.join("");
      const slots = new Map(glyphs.map((glyph, index) => [glyph, index + 1]));
      const bytes = new Uint8Array(next.cols * next.rows);
      lines.forEach((line, row) => {
        for (let col = 0; col < next.cols; col += 1) bytes[row * next.cols + col] = slots.get(line[col]) ?? 0;
      });
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, gpu.textTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, next.cols, next.rows, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
      fluid = createFluid(next.cols, next.rows, next.cellW, next.cellH);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, gpu.dyeTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, next.cols, next.rows, 0, gl.RED, gl.FLOAT, fluid.dye);
      for (const gust of gusts) gust.active = false;
      for (const ring of rings) ring.active = false;
      endGhost();
      if (tileChanged || nextKey !== glyphKey || !atlas) {
        glyphKey = nextKey;
        atlas = buildAtlas({
          canvas: atlasCanvas,
          glyphs,
          family,
          fontPx: next.fontDev,
          tileW: next.cellWDev,
          tileH: next.cellHDev,
          maxSize: gpu.maxSize,
          restWeight: P.REST_WEIGHT,
          floorWeight: P.MASTER_FLOOR,
          fineStep: P.MASTER_STEP_FINE,
          coarseStep: P.MASTER_STEP_COARSE,
        });
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, gpu.atlasTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
        atlasCanvas.width = 1;
        atlasCanvas.height = 1;
        gl.uniform2f(uniforms.uAtlasSize, atlas.width, atlas.height);
        gl.uniform1f(uniforms.uAtlasColumns, atlas.columns);
        gl.uniform1f(uniforms.uGlyphRows, atlas.glyphRows);
        gl.uniform1f(uniforms.uMasters, atlas.masters);
        gl.uniform1f(uniforms.uMasterBase, atlas.masterBase);
        gl.uniform1f(uniforms.uMasterStep, atlas.masterStep);
      }
    }

    gl.viewport(0, 0, next.widthDev, next.heightDev);
    gl.uniform2f(uniforms.uOrigin, next.originXDev, next.originYDev);
    gl.uniform2f(uniforms.uCell, next.cellWDev, next.cellHDev);
    gl.uniform2f(uniforms.uGrid, next.cols, next.rows);
    gl.uniform1f(uniforms.uCanvasHeight, next.heightDev);
    gl.uniform3f(uniforms.uInk, ink[0], ink[1], ink[2]);
    gl.uniform3f(uniforms.uPaper, paper[0], paper[1], paper[2]);
    syncRings();
    draw();
  }

  function scheduleResize() {
    if (resizeRaf || destroyed) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      if (destroyed || contextLost) return;
      resize();
      wake();
    });
  }

  function draw() {
    if (!gl || !gpu || !layout || !fluid || contextLost) return;
    const { uniforms } = gpu;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, gpu.dyeTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, layout.cols, layout.rows, gl.RED, gl.FLOAT, fluid.dye);
    gl.uniform1f(uniforms.uReveal, reduced ? P.REVEAL_SECONDS : revealSeconds);
    gl.uniform4fv(uniforms.uRings, ringUniform);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!painted && revealStart >= 0) {
      painted = true;
      canvas.dataset.painted = "true";
    }
  }

  function stamp(x0, y0, x1, y1, vx, vy, dt, tool) {
    const radius = layout.radius * tool.size;
    const spacing = radius * 0.5;
    const distance = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.min(48, Math.max(1, Math.ceil(distance / spacing)));
    const frameGrip = reduced ? 0 : 1 - Math.exp(-dt * tool.grip);
    const grip = frameGrip > 0 ? 1 - Math.pow(1 - frameGrip, 1 / steps) : 0;
    const dyeAmount = tool.dye * Math.min(1, distance / steps / spacing);
    const forceX = vx * tool.force;
    const forceY = vy * tool.force;
    for (let index = 1; index <= steps; index += 1) {
      const t = index / steps;
      fluid.splat(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, forceX, forceY, grip, dyeAmount, tool.cap, radius, P.SPLAT_REACH);
    }
  }

  function brushOf(stirrer) {
    if (stirrer.tool) return stirrer.tool;
    return stirrer.pressed ? pressBrush : hoverBrush;
  }

  function stirStep(stirrer, dt, follow) {
    const dx = stirrer.x - stirrer.lastX;
    const dy = stirrer.y - stirrer.lastY;
    const moved = dx * dx + dy * dy > 1e-4;
    if (stirrer.tool) {
      stirrer.vx = dx / dt;
      stirrer.vy = dy / dt;
    } else {
      stirrer.vx += (dx / dt - stirrer.vx) * follow;
      stirrer.vy += (dy / dt - stirrer.vy) * follow;
    }
    const speed = Math.hypot(stirrer.vx, stirrer.vy);
    if (speed > P.MAX_SPEED) {
      stirrer.vx *= P.MAX_SPEED / speed;
      stirrer.vy *= P.MAX_SPEED / speed;
    }
    let busy = false;
    if (moved) {
      stamp(stirrer.lastX, stirrer.lastY, stirrer.x, stirrer.y, stirrer.vx, stirrer.vy, dt, brushOf(stirrer));
      busy = true;
    } else if (stirrer.pressed && !stirrer.tool) {
      const brake = reduced ? 0 : 1 - Math.exp(-dt * P.HOVER_GRIP);
      fluid.splat(stirrer.x, stirrer.y, 0, 0, brake, dt * P.WELL_RATE, P.PRESS_DYE_CAP, layout.radius * 0.7, P.SPLAT_REACH);
      busy = true;
    }
    stirrer.lastX = stirrer.x;
    stirrer.lastY = stirrer.y;
    return busy;
  }

  function driveStirrers(dt) {
    let busy = false;
    const follow = 1 - Math.exp(-dt * P.POINTER_FOLLOW);
    for (const stirrer of stirrers.values()) busy = stirStep(stirrer, dt, follow) || busy;
    return busy;
  }

  function placeGhost(stirrer) {
    const progress = Math.min(1, ghost.age / P.GHOST_SECONDS);
    const eased = P.GHOST_LINEAR_SHARE * progress + (1 - P.GHOST_LINEAR_SHARE) * smooth(progress);
    const angle = P.GHOST_START_ANGLE + eased * P.GHOST_TURN;
    const radius = ghost.reach * (P.GHOST_OUTER - P.GHOST_INWARD * eased);
    stirrer.x = ghost.cx + Math.cos(angle) * radius;
    stirrer.y = ghost.cy + Math.sin(angle) * radius;
    ghostBrush.dye = P.DYE_PER_SPLAT * 2 * (P.GHOST_DYE_TAIL + (1 - P.GHOST_DYE_TAIL) * smooth(progress / P.GHOST_DYE_RAMP));
  }

  function launchGhost() {
    if (!layout || reduced) return;
    const { gridW, gridH } = layout;
    ghost.active = true;
    ghost.lifting = false;
    ghost.age = 0;
    ghost.cx = gridW * P.GHOST_X;
    ghost.cy = gridH * P.GHOST_Y;
    ghost.reach = Math.min(P.GHOST_MAX_PX, Math.max(P.GHOST_MIN_PX, Math.min(gridW, gridH) * P.GHOST_SHARE));
    const stirrer = { x: 0, y: 0, lastX: 0, lastY: 0, vx: 0, vy: 0, pressed: true, tool: ghostBrush, downX: 0, downY: 0, downAt: 0, travel: 0 };
    placeGhost(stirrer);
    stirrer.lastX = stirrer.x;
    stirrer.lastY = stirrer.y;
    stirrers.set(GHOST_ID, stirrer);
  }

  function endGhost() {
    ghost.active = false;
    ghost.lifting = false;
    stirrers.delete(GHOST_ID);
  }

  function driveGhost(dt) {
    if (!ghost.active) return false;
    const stirrer = stirrers.get(GHOST_ID);
    if (!stirrer || ghost.lifting || reduced) {
      endGhost();
      return true;
    }
    ghost.age += dt;
    placeGhost(stirrer);
    if (ghost.age >= P.GHOST_SECONDS) ghost.lifting = true;
    return true;
  }

  function driveGusts(dt) {
    let busy = false;
    for (const gust of gusts) {
      if (!gust.active) continue;
      const speed = gust.speed * Math.exp(-gust.age / P.GUST_TAU);
      const nextX = gust.x + gust.dirX * speed * dt;
      const nextY = gust.y + gust.dirY * speed * dt;
      gustBrush.dye = P.DYE_PER_SPLAT * 2 * smooth((gust.age / P.GUST_LIFE - P.GUST_DYE_FROM) / P.GUST_DYE_RAMP);
      stamp(gust.x, gust.y, nextX, nextY, gust.dirX * speed, gust.dirY * speed, dt, gustBrush);
      gust.x = nextX;
      gust.y = nextY;
      gust.age += dt;
      if (gust.age >= P.GUST_LIFE) gust.active = false;
      busy = true;
    }
    return busy;
  }

  function syncRings() {
    ringPeak = 0;
    rings.forEach((ring, index) => {
      const at = index * 4;
      if (!ring.active || !layout) {
        ringUniform[at] = 0;
        ringUniform[at + 1] = 0;
        ringUniform[at + 2] = 0;
        ringUniform[at + 3] = 0;
        return;
      }
      const progress = Math.min(1, ring.age / P.RING_SECONDS);
      const strength = P.RING_STRENGTH * Math.pow(1 - progress, 1.6) * Math.min(1, progress / 0.06);
      ringUniform[at] = ring.x * layout.dpr;
      ringUniform[at + 1] = ring.y * layout.dpr;
      ringUniform[at + 2] = ring.reach * easeOutCubic(progress) * layout.dpr;
      ringUniform[at + 3] = strength;
      if (strength > ringPeak) ringPeak = strength;
    });
  }

  function driveRings(dt) {
    let busy = false;
    const band = layout.radius * P.RING_BAND_SIZE;
    for (const ring of rings) {
      if (!ring.active) continue;
      const progress = Math.min(1, ring.age / P.RING_SECONDS);
      const front = ring.reach * easeOutCubic(progress);
      const remaining = 1 - progress;
      const crestSpeed = (ring.reach * 3 * remaining * remaining) / P.RING_SECONDS;
      if (!reduced) fluid.impulse(ring.x, ring.y, crestSpeed * P.RING_CARRY, band, front, P.SPLAT_REACH);
      ring.age += dt;
      if (ring.age >= P.RING_SECONDS) ring.active = false;
      else busy = true;
    }
    syncRings();
    return busy;
  }

  function launchGust(side, lane, reach) {
    if (!layout) return;
    const { gridW, gridH, radius } = layout;
    let slot = gusts.find((gust) => !gust.active);
    if (!slot) slot = gusts.reduce((oldest, gust) => (gust.age > oldest.age ? gust : oldest), gusts[0]);
    const horizontal = side === "left" || side === "right";
    const distance = (horizontal ? gridW : gridH) * reach;
    slot.active = true;
    slot.age = 0;
    slot.speed = Math.min(P.MAX_SPEED / P.FORCE, distance / (P.GUST_TAU * (1 - Math.exp(-P.GUST_LIFE / P.GUST_TAU))));
    slot.dirX = side === "left" ? 1 : side === "right" ? -1 : 0;
    slot.dirY = side === "top" ? 1 : side === "bottom" ? -1 : 0;
    slot.x = horizontal ? (side === "left" ? -radius * 0.5 : gridW + radius * 0.5) : lane * gridW;
    slot.y = horizontal ? lane * gridH : side === "top" ? -radius * 0.5 : gridH + radius * 0.5;
  }

  function dropRing(x, y) {
    if (!layout || !fluid) return;
    fluid.splat(x, y, 0, 0, 0, 0.9, P.PRESS_DYE_CAP, layout.radius * 0.6, P.SPLAT_REACH);
    if (reduced) return;
    let slot = rings.find((ring) => !ring.active);
    if (!slot) slot = rings.reduce((oldest, ring) => (ring.age > oldest.age ? ring : oldest), rings[0]);
    slot.active = true;
    slot.age = 0;
    slot.x = x;
    slot.y = y;
    slot.reach = Math.min(P.RING_REACH_MAX, Math.max(P.RING_REACH_MIN, Math.min(layout.gridW, layout.gridH) * P.RING_REACH_SHARE));
  }

  function calm() {
    calmStart = performance.now();
    for (const gust of gusts) gust.active = false;
    for (const ring of rings) ring.active = false;
    endGhost();
    introPending = false;
    wake();
  }

  function adapt(cost) {
    simCost += (cost - simCost) * 0.1;
    if (simCost > P.SIM_BUDGET_MS) iterations = P.PRESSURE_ITERATIONS_LEAN;
    else if (simCost < P.SIM_BUDGET_MS * 0.5) iterations = P.PRESSURE_ITERATIONS;
  }

  function report(now, settled) {
    let weight = P.REST_WEIGHT;
    if (!settled) {
      if (now - lastReadoutAt < P.READOUT_MS) return;
      const peak = Math.max(fluid.maxDye, ringPeak);
      weight = P.REST_WEIGHT + (P.PEAK_WEIGHT - P.REST_WEIGHT) * smooth(peak);
      weight = Math.round(weight / P.READOUT_STEP) * P.READOUT_STEP;
    }
    lastReadoutAt = now;
    if (weight === readout) return;
    readout = weight;
    onWeight(weight);
  }

  function frame(now) {
    rafId = 0;
    if (!canRun()) return;
    const elapsed = lastTime ? now - lastTime : 1000 / 60;
    lastTime = now;
    const dt = Math.min(Math.max(elapsed, 4), 48) / 1000;
    if (revealStart < 0) revealStart = now;
    revealSeconds = (now - revealStart) / 1000;

    if (introPending && (reduced || revealSeconds >= P.GHOST_AT)) {
      introPending = false;
      launchGhost();
    }

    let busy = driveGhost(dt);
    busy = driveStirrers(dt) || busy;
    busy = driveGusts(dt) || busy;
    busy = driveRings(dt) || busy;

    if (calmStart >= 0) {
      busy = true;
      const keep = Math.exp(-dt / P.CALM_TAU);
      fluid.fade(keep, keep);
      if (now - calmStart >= P.CALM_MS) {
        fluid.clear();
        calmStart = -1;
      }
    }

    const simStart = performance.now();
    stepOptions.velocityTau = reduced ? P.REDUCED_VELOCITY_TAU : P.VELOCITY_TAU;
    stepOptions.dyeTau = reduced ? P.REDUCED_DYE_TAU : P.DYE_TAU;
    stepOptions.vorticity = reduced ? 0 : P.VORTICITY * layout.lineCss * P.VORTICITY_RATE;
    stepOptions.iterations = iterations;
    fluid.step(dt, stepOptions);
    adapt(performance.now() - simStart);

    const revealing = !reduced && revealSeconds < P.REVEAL_SECONDS;
    const settled = !busy && !revealing && !introPending && fluid.maxDye < P.SLEEP_DYE && fluid.maxSpeed < P.SLEEP_SPEED;
    if (settled) fluid.clear();
    draw();
    report(now, settled);
    if (!settled) rafId = requestAnimationFrame(frame);
    else lastTime = 0;
  }

  function pointAt(event) {
    if (!rect) rect = stage.getBoundingClientRect();
    return [event.clientX - rect.left - layout.originX, event.clientY - rect.top - layout.originY];
  }

  function stirrerFor(event, x, y) {
    let stirrer = stirrers.get(event.pointerId);
    if (!stirrer) {
      stirrer = { x, y, lastX: x, lastY: y, vx: 0, vy: 0, pressed: false, tool: null, mouse: event.pointerType === "mouse", downX: x, downY: y, downAt: 0, travel: 0 };
      stirrers.set(event.pointerId, stirrer);
    }
    return stirrer;
  }

  function capture(pointerId) {
    try {
      stage.setPointerCapture(pointerId);
      return true;
    } catch {
      return false;
    }
  }

  function onPointerDown(event) {
    if (!layout || (event.pointerType === "mouse" && event.button !== 0)) return;
    rect = stage.getBoundingClientRect();
    capture(event.pointerId);
    const [x, y] = pointAt(event);
    const stirrer = stirrerFor(event, x, y);
    stirrer.pressed = true;
    stirrer.x = x;
    stirrer.y = y;
    stirrer.downX = x;
    stirrer.downY = y;
    stirrer.downAt = event.timeStamp;
    stirrer.travel = 0;
    stage.dataset.pressed = "true";
    if (fluid) fluid.splat(x, y, 0, 0, 0, 1, P.PRESS_BLOOM_CAP, layout.radius * P.PRESS_BLOOM_SIZE, P.SPLAT_REACH);
    if (document.activeElement !== stage) stage.focus({ preventScroll: true });
    wake();
  }

  function onPointerMove(event) {
    if (!layout) return;
    if (!stirrers.has(event.pointerId) && event.pointerType !== "mouse") return;
    const [x, y] = pointAt(event);
    const stirrer = stirrerFor(event, x, y);
    if (!stirrer.pressed && Math.hypot(x - stirrer.x, y - stirrer.y) > layout.radius * 4) {
      stirrer.lastX = x;
      stirrer.lastY = y;
      stirrer.vx = 0;
      stirrer.vy = 0;
    }
    stirrer.x = x;
    stirrer.y = y;
    if (stirrer.pressed) stirrer.travel = Math.max(stirrer.travel, Math.hypot(x - stirrer.downX, y - stirrer.downY));
    wake();
  }

  function flush(stirrer) {
    if (!layout || !fluid || (stirrer.x === stirrer.lastX && stirrer.y === stirrer.lastY)) return;
    const since = lastTime ? performance.now() - lastTime : 0;
    const dt = since > 0 ? Math.min(Math.max(since, 4), 48) / 1000 : P.FLUSH_SECONDS;
    stirStep(stirrer, dt, 1 - Math.exp(-dt * P.POINTER_FOLLOW));
  }

  function syncPressed() {
    let anyPressed = false;
    for (const other of stirrers.values()) if (other.pressed && !other.tool) anyPressed = true;
    if (!anyPressed) delete stage.dataset.pressed;
  }

  function release(event, cancelled) {
    const stirrer = stirrers.get(event.pointerId);
    if (!stirrer) return;
    if (!cancelled && layout && stirrer.pressed) {
      const [x, y] = pointAt(event);
      stirrer.x = x;
      stirrer.y = y;
    }
    if (stirrer.pressed) flush(stirrer);
    if (!cancelled && stirrer.pressed && stirrer.travel < P.TAP_SLOP_PX && event.timeStamp - stirrer.downAt < P.TAP_MS) {
      dropRing(stirrer.x, stirrer.y);
    }
    stirrer.pressed = false;
    if (cancelled || event.pointerType !== "mouse") stirrers.delete(event.pointerId);
    if (stage.hasPointerCapture?.(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    syncPressed();
    wake();
  }

  function onLostCapture(event) {
    if (stirrers.get(event.pointerId)?.pressed) release(event, true);
  }

  function onBlur() {
    for (const [id, stirrer] of stirrers) {
      if (stirrer.tool) continue;
      stirrer.pressed = false;
      if (!stirrer.mouse) stirrers.delete(id);
    }
    syncPressed();
    wake();
  }

  function onPointerUp(event) {
    release(event, false);
  }

  function onPointerCancel(event) {
    release(event, true);
  }

  function onPointerLeave(event) {
    const stirrer = stirrers.get(event.pointerId);
    if (stirrer && !stirrer.pressed) stirrers.delete(event.pointerId);
  }

  function typingInto(target) {
    if (!target || target === stage || !(target instanceof HTMLElement)) return false;
    return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName);
  }

  function onKeyDown(event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typingInto(event.target)) return;
    const side = ARROW_SIDES[event.key];
    if (side) {
      event.preventDefault();
      const now = performance.now();
      if (now - lastArrow < P.ARROW_GAP_MS) return;
      lastArrow = now;
      calmStart = -1;
      launchGust(side, P.GUST_LANES[laneCursor % P.GUST_LANES.length], P.KEY_REACH);
      laneCursor += 1;
      wake();
      return;
    }
    if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      calm();
    }
  }

  function onScroll() {
    rect = null;
  }

  function onVisibility() {
    if (document.hidden) stop();
    else wake();
  }

  function onMotionChange(event) {
    reduced = event.matches;
    wake();
  }

  function onDprChange() {
    watchDpr();
    scheduleResize();
  }

  function watchDpr() {
    dprQuery?.removeEventListener("change", onDprChange);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener("change", onDprChange);
  }

  function onContextLost(event) {
    event.preventDefault();
    contextLost = true;
    stop();
    gpu = null;
  }

  function onContextRestored() {
    contextLost = false;
    try {
      setupGpu();
      layout = null;
      atlas = null;
      glyphKey = "";
      resize();
      wake();
    } catch {
      onFail();
    }
  }

  function attach() {
    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", onPointerUp);
    stage.addEventListener("pointercancel", onPointerCancel);
    stage.addEventListener("pointerleave", onPointerLeave);
    stage.addEventListener("lostpointercapture", onLostCapture);
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKeyDown);
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", scheduleResize);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    motionQuery.addEventListener("change", onMotionChange);
    watchDpr();
    const resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(stage);
    const intersectionObserver = new IntersectionObserver((entries) => {
      onscreen = entries[entries.length - 1].isIntersecting;
      if (onscreen) wake();
      else stop();
    });
    intersectionObserver.observe(stage);
    observers = [resizeObserver, intersectionObserver];
  }

  function detach() {
    stage.removeEventListener("pointerdown", onPointerDown);
    stage.removeEventListener("pointermove", onPointerMove);
    stage.removeEventListener("pointerup", onPointerUp);
    stage.removeEventListener("pointercancel", onPointerCancel);
    stage.removeEventListener("pointerleave", onPointerLeave);
    stage.removeEventListener("lostpointercapture", onLostCapture);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("keydown", onKeyDown);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    canvas.removeEventListener("webglcontextrestored", onContextRestored);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("resize", scheduleResize);
    window.removeEventListener("scroll", onScroll, { capture: true });
    motionQuery.removeEventListener("change", onMotionChange);
    dprQuery?.removeEventListener("change", onDprChange);
    dprQuery = null;
    for (const observer of observers) observer.disconnect();
    observers = [];
  }

  async function start() {
    const declared = getComputedStyle(stage).getPropertyValue("--font-geist-mono").trim();
    if (declared) family = `${declared}, ${FALLBACK_FAMILY}`;
    const fontsReady = document.fonts?.load ? document.fonts.load(`${P.REST_WEIGHT} 20px ${family}`, "Ab0").catch(() => null) : Promise.resolve();
    await Promise.race([fontsReady, wait(P.FONT_WAIT_MS)]);
    if (destroyed) return;
    gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) {
      onFail();
      return;
    }
    try {
      setupGpu();
    } catch {
      onFail();
      return;
    }
    readColours();
    const probe = atlasCanvas.getContext("2d");
    advanceRatio = measureAdvance(probe, family, P.REST_WEIGHT);
    attach();
    resize();
    wake();
  }

  start();

  return {
    destroy() {
      destroyed = true;
      stop();
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = 0;
      detach();
      stirrers.clear();
      if (gl && gpu && !contextLost) {
        gl.deleteTexture(gpu.atlasTexture);
        gl.deleteTexture(gpu.textTexture);
        gl.deleteTexture(gpu.dyeTexture);
        gl.deleteVertexArray(gpu.vao);
        gl.deleteProgram(gpu.program);
      }
      gpu = null;
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      gl = null;
      atlasCanvas.width = 0;
      atlasCanvas.height = 0;
      canvas.remove();
    },
  };
}
