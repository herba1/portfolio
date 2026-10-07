import createResolutionGovernor from "@/app/experiments/resolutionGovernor";

import { MAX_GLYPHS, MAX_GRABS, MAX_SEGMENTS, TAFFY_BASE } from "./taffyParams";
import { layoutWord, rasterWord, sampleField } from "./taffyLayout";
import { BUILDER_DISPOSED, createFieldBuilder } from "./taffySdf";
import { TAFFY_FRAGMENT, TAFFY_VERTEX } from "./taffyShader";

const FIELD_BIAS = 0.4;
const HAIR_PX = 0.55;
const STRAND_RADIUS = 0.42;
const PREVIEW_RADIUS = 0.15;
const LEAN_REACH = 0.07;
const SNAP_IMPULSE_CAPS = 2.4;
const SETTLE_IMPULSE_CAPS = 0.55;
const INTRO_TILTS = [0.24, 0.55, 1, 1.8];
const SQUASH_PER_SPEED = 0.0006;
const SQUASH_LIMIT = 1.3;
const TAP_SLOP_PX = 6;
const KEY_STEP_PX = 24;
const HOVER_LIFT_PX = 2;
const INTRO_DELAY_MS = 120;
const INTRO_MS = 900;
const INTRO_SETTLE_MS = 280;
const MORPH_MS = 800;
const MORPH_REDUCED_MS = 360;
const MORPH_RETARGET_T = 0.2;
const MELT_CAPS = 0.8;
const GRAIN = 0.06;
const CHROMA = 0.6;
const VELOCITY_WINDOW_MS = 40;
const DESCENDERS = "yjgpq";
const RASTER_MAX = 352;
const RASTER_MIN = 72;
const CACHE_LIMIT = 4;
const PHYSICS_STEP = 1 / 240;
const SAG_RATIO = 0.2;
const SAG_TAUT_RELIEF = 0.55;
const MID_STIFFNESS = 170;
const MID_DAMPING = 8;
const BEND_LIMIT = 0.42;
const TIP_STIFFNESS = 360;
const TIP_DAMPING = 21;
const ELBOW_STIFFNESS = 520;
const ELBOW_DAMPING = 20;
const ELBOW_LIMIT = 0.6;
const WHIP_SPEED_LIMIT = 2400;
const PUDDLE_WIDTH = 0.95;
const PUDDLE_HEIGHT = 0.24;
const PUDDLE_SHRINK = 0.6;
const GRAB_FIELD_EM = 0.16;
const GRAB_FIELD_TOUCH_EM = 0.2;
const GRAB_BOX_EM = 0.08;
const PAPER_CLEAR_EM = 0.3;
const HAND_LAG = 0.28;
const LAG_RELAX = 0.6;
const LAG_ITERATIONS = 3;
const LURCH_STIFFNESS = 700;
const LURCH_DAMPING = 34;
const FREE_HOLD_MS = 110;
const SNAP_GAP_MS = 90;
const TENSION_STRETCH = 0.07;

function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < 1e-5) return sampleY(t);
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    let low = 0;
    let high = 1;
    t = x;
    for (let i = 0; i < 24; i += 1) {
      const value = sampleX(t);
      if (Math.abs(value - x) < 1e-5) break;
      if (value < x) low = t;
      else high = t;
      t = (low + high) / 2;
    }
    return sampleY(t);
  };
}

const easeEntrance = cubicBezier(0.16, 1, 0.3, 1);
const easeInOut = cubicBezier(0.7, 0, 0.3, 1);
const easeInQuad = (t) => t * t;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const clamp01 = (value) => Math.min(1, Math.max(0, value));
const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const halfToFloat = (bits) => {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 31;
  const mantissa = bits & 1023;
  if (!exponent) return sign * mantissa * 2 ** -24;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
};

function readColour(value, fallback) {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = fallback;
  context.fillStyle = value || fallback;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`taffy shader: ${log}`);
  }
  return shader;
}

const UNIFORMS = [
  "uResolution", "uPixelRatio",
  "uAtlasNew", "uAtlasSizeNew", "uScaleNew", "uPadNew", "uCountNew", "uTileNew", "uPlaceNew", "uMoveNew", "uWarpNew", "uDecodeNew",
  "uAtlasOld", "uAtlasSizeOld", "uScaleOld", "uPadOld", "uCountOld", "uTileOld", "uPlaceOld", "uDecodeOld",
  "uMorph", "uMelt", "uSlump",
  "uSegCount", "uSegLine", "uSegCtrl", "uSegShape", "uSegBody", "uFillet",
  "uFocus", "uFocusAmount",
  "uPaper", "uInk", "uAccent", "uGrain", "uChroma",
];

const makeHalf = () => ({ tipX: 0, tipY: 0, tipVX: 0, tipVY: 0, elbowX: 0, elbowY: 0, elbowVX: 0, elbowVY: 0 });

export function createTaffyEngine({ host, canvas, family, reducedMotion, dprCap = 2, onLayout, onReady, onPaperTap, onTitleShown, onSettled }) {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  let program = null;
  let buffer = null;
  let locations = {};

  const initGL = () => {
    const vertex = compile(gl, gl.VERTEX_SHADER, TAFFY_VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, TAFFY_FRAGMENT);
    program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, "aPosition");
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`taffy link: ${gl.getProgramInfoLog(program)}`);
    locations = {};
    for (const name of UNIFORMS) locations[name] = gl.getUniformLocation(program, name);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  };

  try {
    initGL();
  } catch (error) {
    if (program) gl.deleteProgram(program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    throw error;
  }

  const builder = createFieldBuilder();
  const governor = createResolutionGovernor({ max: 1, min: 0.55 });
  const cache = new Map();
  const styles = getComputedStyle(host);
  const colours = {
    paper: readColour(styles.getPropertyValue("--color-surface").trim(), "#f1f5f9"),
    ink: readColour(styles.getPropertyValue("--color-ink").trim(), "#1a1a1a"),
    accent: readColour(styles.getPropertyValue("--color-accent").trim(), "#3b82f6"),
  };

  const tileNew = new Float32Array(MAX_GLYPHS * 4);
  const placeNew = new Float32Array(MAX_GLYPHS * 4);
  const moveNew = new Float32Array(MAX_GLYPHS * 4);
  const warpNew = new Float32Array(MAX_GLYPHS * 4);
  const tileOld = new Float32Array(MAX_GLYPHS * 4);
  const placeOld = new Float32Array(MAX_GLYPHS * 4);
  const segLine = new Float32Array(MAX_SEGMENTS * 4);
  const segCtrl = new Float32Array(MAX_SEGMENTS * 4);
  const segShape = new Float32Array(MAX_SEGMENTS * 4);
  const segBody = new Float32Array(MAX_SEGMENTS * 4);
  const pointer = { x: 0, y: 0 };

  let contextLost = false;
  let disposed = false;

  let params = { ...TAFFY_BASE };
  let reduced = Boolean(reducedMotion);
  let width = 0;
  let height = 0;
  let visible = true;
  let onscreen = true;
  let frame = 0;
  let lastFrame = 0;
  let plateLeft = 0;
  let plateTop = 0;
  let rectStale = true;

  let current = null;
  let previous = null;
  let glyphs = [];
  let grabs = [];
  let morph = null;
  let intro = null;
  let introPlayed = false;
  let introTimer = 0;
  let settleAt = 0;
  let settledFired = false;
  let hover = -1;
  let hoverAmount = 0;
  let focus = -1;
  let focusShown = -1;
  let focusAmount = 0;
  let paperPress = null;
  let showToken = 0;
  let wanted = null;
  let queued = null;
  let readyFired = false;
  let queuedTimer = 0;
  let segmentCount = 0;

  const uploadField = (word) => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    while (gl.getError() !== gl.NO_ERROR && !gl.isContextLost());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, word.width, word.height, 0, gl.RED, gl.HALF_FLOAT, word.half);
    if (gl.getError() === gl.NO_ERROR) return { texture, decode: [1, -FIELD_BIAS] };
    const range = word.pad * 1.6;
    const packed = new Uint8Array(word.half.length);
    for (let i = 0; i < packed.length; i += 1) packed[i] = Math.round(clamp01(halfToFloat(word.half[i]) / (range * 2) + 0.5) * 255);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, word.width, word.height, 0, gl.RED, gl.UNSIGNED_BYTE, packed);
    return { texture, decode: [range * 2, -range - FIELD_BIAS] };
  };

  const makeGlyphs = (count) =>
    Array.from({ length: count }, () => ({
      x: 0, y: 0, vx: 0, vy: 0, leanX: 0, leanY: 0, lift: 0, held: false, stretch: 1, ux: 1, uy: 0, grabVX: 0, grabVY: 0, tension: 0,
    }));

  const writeStatic = (target, tiles, places) => {
    const { word, layout } = target;
    tiles.fill(0);
    places.fill(0);
    word.glyphs.forEach((glyph, i) => {
      if (i >= MAX_GLYPHS) return;
      const place = layout.placed[i];
      tiles.set(glyph.tile, i * 4);
      places[i * 4] = place.penX;
      places[i * 4 + 1] = place.penY;
      places[i * 4 + 2] = glyph.ox;
      places[i * 4 + 3] = glyph.oy;
    });
  };

  const summarise = () => {
    if (!current) return;
    const { layout, word } = current;
    onLayout?.({
      text: word.text,
      F: layout.F,
      capH: layout.capH,
      bottom: layout.bottom,
      lines: layout.lines,
      rows: layout.rows.map((row) => ({ text: row.text, x: row.x, baseline: row.baseline })),
      glyphs: layout.placed.map((place, i) => ({
        char: word.glyphs[i].char,
        left: place.left,
        top: place.penY - layout.capH * 1.02,
        width: Math.max(place.right - place.left, layout.F * 0.2),
        height: Math.max(place.bottom, place.penY) - (place.penY - layout.capH * 1.02),
      })),
    });
  };

  const sizeCanvas = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, dprCap) * governor.scale;
    const w = Math.max(1, Math.round(width * ratio));
    const h = Math.max(1, Math.round(height * ratio));
    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w;
    canvas.height = h;
    return true;
  };

  const settle = () => {
    settleAt = 0;
    if (settledFired) return;
    settledFired = true;
    onSettled?.();
  };

  const strandPoint = (strand, end) => {
    const anchorGlyph = end === "a" ? strand.bodyA : strand.bodyB;
    const local = end === "a" ? strand.anchorA : strand.anchorB;
    if (anchorGlyph < 0) {
      const home = current.layout.placed[strand.bodyB];
      strand.scratch.x = home.penX + local.x;
      strand.scratch.y = home.penY + local.y;
      return strand.scratch;
    }
    const place = current.layout.placed[anchorGlyph];
    const glyph = glyphs[anchorGlyph];
    strand.scratch.x = place.penX + glyph.x + local.x;
    strand.scratch.y = place.penY + glyph.y + glyph.lift + local.y;
    return strand.scratch;
  };

  const makeStrand = (g, side) => {
    const place = current.layout.placed[g];
    const anchors = current.layout.anchors;
    const neighbour = side < 0 ? place.prev : place.next;
    const anchorB = side < 0 ? anchors[g].left : anchors[g].right;
    const root = side < 0 ? anchors[g].rootLeft : anchors[g].rootRight;
    const anchorA = neighbour >= 0 ? (side < 0 ? anchors[neighbour].right : anchors[neighbour].left) : root;
    const strand = {
      bodyA: neighbour,
      bodyB: g,
      anchorA,
      anchorB,
      L0: 0,
      state: "intact",
      snapAt: 0,
      ext: 0,
      stretch: 0,
      length: 0,
      ax: 0,
      ay: 0,
      bx: 0,
      by: 0,
      mx: 0,
      my: 0,
      mvx: 0,
      mvy: 0,
      snapEnd: 0,
      snapMid: 0,
      rEnd: 0,
      rMid: 0,
      dirX: 0,
      dirY: 0,
      halves: [makeHalf(), makeHalf()],
      scratch: { x: 0, y: 0 },
    };
    const a = strandPoint(strand, "a");
    const ax = a.x;
    const ay = a.y;
    const b = strandPoint(strand, "b");
    strand.L0 = Math.hypot(b.x - ax, b.y - ay);
    strand.mx = (ax + b.x) / 2;
    strand.my = (ay + b.y) / 2;
    return strand;
  };

  const radiusAtRest = () => STRAND_RADIUS * current.layout.stem;

  const measureStrand = (strand) => {
    const layout = current.layout;
    const a = strandPoint(strand, "a");
    const ax = a.x;
    const ay = a.y;
    const b = strandPoint(strand, "b");
    const dx = b.x - ax;
    const dy = b.y - ay;
    const length = Math.hypot(dx, dy);
    const restVolume = Math.max(strand.L0, layout.capH * 0.6);
    strand.length = length;
    strand.ext = Math.max(0, length - strand.L0);
    strand.stretch = strand.ext / (params.snapLength * layout.capH);
    strand.rEnd = radiusAtRest() * Math.sqrt(restVolume / Math.max(length, restVolume));
    strand.rMid = strand.rEnd + (HAIR_PX - strand.rEnd) * Math.min(1, strand.stretch) ** 1.5;
    strand.dirX = length > 1e-3 ? dx / length : 0;
    strand.dirY = length > 1e-3 ? dy / length : 0;
    strand.ax = ax;
    strand.ay = ay;
    strand.bx = b.x;
    strand.by = b.y;
  };

  const advanceStrand = (strand, dt) => {
    const taut = Math.min(1, strand.stretch);
    const chordX = (strand.ax + strand.bx) / 2;
    const chordY = (strand.ay + strand.by) / 2;
    const sag = SAG_RATIO * params.sag * (1 - SAG_TAUT_RELIEF * taut) * strand.length;
    const stiffness = MID_STIFFNESS * (0.7 + 0.9 * taut);
    const damping = reduced ? 2 * Math.sqrt(stiffness) : MID_DAMPING;
    const steps = Math.max(1, Math.ceil(dt / PHYSICS_STEP));
    const h = dt / steps;
    for (let i = 0; i < steps; i += 1) {
      strand.mvx += (stiffness * (chordX - strand.mx) - damping * strand.mvx) * h;
      strand.mvy += (stiffness * (chordY + sag - strand.my) - damping * strand.mvy) * h;
      strand.mx += strand.mvx * h;
      strand.my += strand.mvy * h;
    }
    const offX = strand.mx - chordX;
    const offY = strand.my - chordY;
    const off = Math.hypot(offX, offY);
    const limit = BEND_LIMIT * strand.length;
    if (off > limit && off > 1e-3) {
      strand.mx = chordX + (offX / off) * limit;
      strand.my = chordY + (offY / off) * limit;
    }
  };

  const advanceHalf = (half, anchorX, anchorY, dt) => {
    const tipDamping = reduced ? 2 * Math.sqrt(TIP_STIFFNESS) : TIP_DAMPING;
    const steps = Math.max(1, Math.ceil(dt / PHYSICS_STEP));
    const h = dt / steps;
    for (let i = 0; i < steps; i += 1) {
      half.tipVX += (TIP_STIFFNESS * (anchorX - half.tipX) - tipDamping * half.tipVX) * h;
      half.tipVY += (TIP_STIFFNESS * (anchorY - half.tipY) - tipDamping * half.tipVY) * h;
      half.tipX += half.tipVX * h;
      half.tipY += half.tipVY * h;
      const targetX = (anchorX + half.tipX) / 2;
      const targetY = (anchorY + half.tipY) / 2;
      half.elbowVX += (ELBOW_STIFFNESS * (targetX - half.elbowX) - ELBOW_DAMPING * half.elbowVX) * h;
      half.elbowVY += (ELBOW_STIFFNESS * (targetY - half.elbowY) - ELBOW_DAMPING * half.elbowVY) * h;
      half.elbowX += half.elbowVX * h;
      half.elbowY += half.elbowVY * h;
    }
    const midX = (anchorX + half.tipX) / 2;
    const midY = (anchorY + half.tipY) / 2;
    const offX = half.elbowX - midX;
    const offY = half.elbowY - midY;
    const off = Math.hypot(offX, offY);
    const limit = ELBOW_LIMIT * Math.hypot(half.tipX - anchorX, half.tipY - anchorY) + 4;
    if (off > limit && off > 1e-3) {
      half.elbowX = midX + (offX / off) * limit;
      half.elbowY = midY + (offY / off) * limit;
    }
  };

  const seedHalf = (half, elbowT, strand, ctrlX, ctrlY, whipX, whipY) => {
    const s = 1 - elbowT;
    half.tipX = strand.mx;
    half.tipY = strand.my;
    half.tipVX = whipX;
    half.tipVY = whipY;
    half.elbowX = s * s * strand.ax + 2 * s * elbowT * ctrlX + elbowT * elbowT * strand.bx;
    half.elbowY = s * s * strand.ay + 2 * s * elbowT * ctrlY + elbowT * elbowT * strand.by;
    half.elbowVX = whipX * 0.5;
    half.elbowVY = whipY * 0.5;
  };

  const shudder = (origin, dirX, dirY, strength) => {
    for (let j = 0; j < glyphs.length; j += 1) {
      const glyph = glyphs[j];
      if (glyph.held) continue;
      const falloff = 0.5 ** Math.abs(j - origin);
      glyph.vx += dirX * strength * falloff;
      glyph.vy += dirY * strength * falloff;
    }
  };

  const buzz = () => {
    try {
      navigator.vibrate?.(6);
    } catch {
      return;
    }
  };

  const slip = (grab) => {
    grab.released = true;
    const glyph = glyphs[grab.glyph];
    glyph.held = false;
    const speed = Math.hypot(grab.vx, grab.vy);
    const limit = 2600;
    const scale = speed > limit ? limit / speed : 1;
    glyph.vx = grab.vx * scale;
    glyph.vy = grab.vy * scale;
  };

  const snapStrand = (grab, strand, now) => {
    strand.state = "snapped";
    strand.snapAt = now;
    grab.nextSnapAt = now + SNAP_GAP_MS;
    const chordX = (strand.ax + strand.bx) / 2;
    const chordY = (strand.ay + strand.by) / 2;
    const ctrlX = 2 * strand.mx - chordX;
    const ctrlY = 2 * strand.my - chordY;
    const speed = Math.hypot(strand.mvx, strand.mvy);
    const whip = speed > WHIP_SPEED_LIMIT ? WHIP_SPEED_LIMIT / speed : 1;
    const whipX = strand.mvx * whip * (reduced ? 0.3 : 1);
    const whipY = strand.mvy * whip * (reduced ? 0.3 : 1);
    seedHalf(strand.halves[0], 0.25, strand, ctrlX, ctrlY, whipX, whipY);
    seedHalf(strand.halves[1], 0.75, strand, ctrlX, ctrlY, whipX, whipY);
    strand.snapEnd = strand.rEnd;
    strand.snapMid = Math.max(strand.rMid, HAIR_PX);
    const impulse = SNAP_IMPULSE_CAPS * current.layout.capH * (reduced ? 0.35 : 1);
    if (strand.bodyA >= 0) shudder(strand.bodyA, -strand.dirX, -strand.dirY, impulse);
    if (grab.kind !== "intro") buzz();
    const severed = grab.strands.every((s) => s.state !== "intact");
    if (grab.kind === "pointer") {
      grab.lurching = true;
      grab.lurchVX = grab.holdVX;
      grab.lurchVY = grab.holdVY;
      if (severed) grab.freeAt = now;
    } else if (severed) {
      slip(grab);
    }
  };

  const removeGrabOn = (g) => {
    grabs = grabs.filter((grab) => grab.glyph !== g);
  };

  const startGrab = (g, kind, id, pointerX, pointerY, now) => {
    removeGrabOn(g);
    const glyph = glyphs[g];
    glyph.held = true;
    glyph.vx = 0;
    glyph.vy = 0;
    const grab = {
      glyph: g,
      kind,
      id,
      released: false,
      downX: pointerX,
      downY: pointerY,
      startX: glyph.x,
      startY: glyph.y,
      targetX: glyph.x,
      targetY: glyph.y,
      vx: 0,
      vy: 0,
      lastX: pointerX,
      lastY: pointerY,
      lastT: now,
      lag: 1,
      share: 0,
      lurching: false,
      lurchVX: 0,
      lurchVY: 0,
      holdVX: 0,
      holdVY: 0,
      freeAt: 0,
      nextSnapAt: 0,
      strands: [makeStrand(g, -1), makeStrand(g, 1)],
    };
    grabs.push(grab);
    return grab;
  };

  const releaseGrab = (grab) => {
    if (grab.released) return;
    grab.released = true;
    const glyph = glyphs[grab.glyph];
    glyph.held = false;
    glyph.vx = grab.vx * 0.6;
    glyph.vy = grab.vy * 0.6;
  };

  const cancelIntro = () => {
    if (introTimer) {
      window.clearTimeout(introTimer);
      introTimer = 0;
    }
    introPlayed = true;
    if (intro) {
      releaseGrab(intro.grab);
      intro = null;
    }
    settle();
  };

  const relayout = () => {
    if (!current || !width || !height) return;
    const before = current.layout.F;
    current.layout = layoutWord(current.word, width, height);
    writeStatic(current, tileNew, placeNew);
    if (previous) {
      previous.layout = layoutWord(previous.word, width, height);
      writeStatic(previous, tileOld, placeOld);
    }
    if (Math.abs(current.layout.F - before) < before * 0.01) {
      summarise();
      return;
    }
    if (introTimer || intro) cancelIntro();
    grabs = [];
    for (const glyph of glyphs) {
      glyph.held = false;
      glyph.x = 0;
      glyph.y = 0;
      glyph.vx = 0;
      glyph.vy = 0;
    }
    summarise();
  };

  const hitTest = (px, py, touch) => {
    if (!current) return -1;
    const { word, layout } = current;
    const reach = layout.F * (touch ? GRAB_FIELD_TOUCH_EM : GRAB_FIELD_EM);
    const inflate = layout.F * GRAB_BOX_EM;
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < word.glyphs.length; i += 1) {
      const place = layout.placed[i];
      const state = glyphs[i];
      const offsetX = state.x;
      const offsetY = state.y + state.lift;
      const d = sampleField(word, word.glyphs[i], layout.a, px - place.penX - offsetX, py - place.penY - offsetY);
      const inBox =
        px >= place.left + offsetX - inflate &&
        px <= place.right + offsetX + inflate &&
        py >= place.top + offsetY - inflate &&
        py <= place.bottom + offsetY + inflate;
      if ((d < reach || inBox) && d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    return best;
  };

  const nearWord = (px, py) => {
    if (!current) return false;
    const { layout } = current;
    const margin = layout.F * PAPER_CLEAR_EM;
    for (const box of layout.rowBoxes) {
      if (px >= box.left - margin && px <= box.right + margin && py >= box.top - margin && py <= box.bottom + margin) return true;
    }
    return false;
  };

  const tensionShare = (grab) => {
    let sum = 0;
    for (const strand of grab.strands) {
      if (strand.state !== "intact") continue;
      measureStrand(strand);
      const s = Math.min(1, strand.stretch);
      sum += s * s;
    }
    return sum / grab.strands.length;
  };

  const holdInHand = (grab, glyph, dt) => {
    const reachX = grab.targetX - grab.startX;
    const reachY = grab.targetY - grab.startY;
    if (grab.lurching) {
      grab.share = tensionShare(grab);
      grab.lag = 1 - HAND_LAG * grab.share;
      const goalX = grab.startX + reachX * grab.lag;
      const goalY = grab.startY + reachY * grab.lag;
      const damping = reduced ? 2 * Math.sqrt(LURCH_STIFFNESS) : LURCH_DAMPING;
      const steps = Math.max(1, Math.ceil(dt / PHYSICS_STEP));
      const h = dt / steps;
      for (let i = 0; i < steps; i += 1) {
        grab.lurchVX += (LURCH_STIFFNESS * (goalX - glyph.x) - damping * grab.lurchVX) * h;
        grab.lurchVY += (LURCH_STIFFNESS * (goalY - glyph.y) - damping * grab.lurchVY) * h;
        glyph.x += grab.lurchVX * h;
        glyph.y += grab.lurchVY * h;
      }
      grab.holdVX = grab.lurchVX;
      grab.holdVY = grab.lurchVY;
      const offset = Math.abs(goalX - glyph.x) + Math.abs(goalY - glyph.y);
      const speed = Math.abs(grab.lurchVX) + Math.abs(grab.lurchVY);
      if (offset < 0.5 && speed < 20) {
        grab.lurching = false;
        glyph.x = goalX;
        glyph.y = goalY;
      }
      return;
    }
    let factor = grab.lag;
    let share = grab.share;
    for (let i = 0; i < LAG_ITERATIONS; i += 1) {
      glyph.x = grab.startX + reachX * factor;
      glyph.y = grab.startY + reachY * factor;
      share = tensionShare(grab);
      factor += (1 - HAND_LAG * share - factor) * LAG_RELAX;
    }
    glyph.x = grab.startX + reachX * factor;
    glyph.y = grab.startY + reachY * factor;
    grab.lag = factor;
    grab.share = share;
    grab.holdVX = grab.vx * factor;
    grab.holdVY = grab.vy * factor;
  };

  const stepSpring = (glyph, dt) => {
    const stiffness = params.stiffness;
    const damping = reduced ? 2 * Math.sqrt(stiffness) : params.damping;
    const steps = Math.max(1, Math.ceil(dt / PHYSICS_STEP));
    const h = dt / steps;
    for (let i = 0; i < steps; i += 1) {
      const ax = -stiffness * (glyph.x - glyph.leanX) - damping * glyph.vx;
      const ay = -stiffness * (glyph.y - glyph.leanY) - damping * glyph.vy;
      glyph.vx += ax * h;
      glyph.vy += ay * h;
      glyph.x += glyph.vx * h;
      glyph.y += glyph.vy * h;
    }
  };

  const pushSegment = (ax, ay, cx, cy, bx, by, rA, rB, neck, bead, bodyA, bodyB, filletA, filletB, puddleX, puddleY) => {
    if (segmentCount >= MAX_SEGMENTS) return;
    const o = segmentCount * 4;
    segLine[o] = ax;
    segLine[o + 1] = ay;
    segLine[o + 2] = bx;
    segLine[o + 3] = by;
    segCtrl[o] = cx;
    segCtrl[o + 1] = cy;
    segCtrl[o + 2] = puddleX;
    segCtrl[o + 3] = puddleY;
    segShape[o] = rA;
    segShape[o + 1] = rB;
    segShape[o + 2] = neck;
    segShape[o + 3] = bead;
    segBody[o] = bodyA;
    segBody[o + 1] = bodyB;
    segBody[o + 2] = filletA;
    segBody[o + 3] = filletB;
    segmentCount += 1;
  };

  const pushHalf = (half, anchorX, anchorY, absorb, rAnchor, rTip, bead, body, puddleX, puddleY) => {
    const tipX = anchorX + (half.tipX - anchorX) * absorb;
    const tipY = anchorY + (half.tipY - anchorY) * absorb;
    const elbowX = anchorX + (half.elbowX - anchorX) * absorb;
    const elbowY = anchorY + (half.elbowY - anchorY) * absorb;
    const ctrlX = 2 * elbowX - (anchorX + tipX) / 2;
    const ctrlY = 2 * elbowY - (anchorY + tipY) / 2;
    pushSegment(anchorX, anchorY, ctrlX, ctrlY, tipX, tipY, rAnchor, rTip, 0, bead, body, -1, 1, 0, puddleX, puddleY);
  };

  const updateIntro = (now) => {
    const grab = intro.grab;
    const t = clamp01((now - intro.start) / INTRO_MS);
    const eased = easeEntrance(t);
    if (!grab.released) {
      grab.targetX = intro.dirX * intro.distance * eased;
      grab.targetY = intro.dirY * intro.distance * eased;
    }
    if (t >= 1 && !grab.released) {
      const pending = grab.strands.find((s) => s.state === "intact");
      if (pending && now - intro.lastForced > 70) {
        intro.lastForced = now;
        measureStrand(pending);
        snapStrand(grab, pending, now);
      }
    }
    if (grab.released) {
      intro = null;
      settleAt = now + INTRO_SETTLE_MS;
    }
  };

  const beginIntro = () => {
    introTimer = 0;
    if (!current || reduced || introPlayed || grabs.length || morph) {
      introPlayed = true;
      settle();
      return;
    }
    const { word, layout } = current;
    let g = -1;
    for (const char of DESCENDERS) {
      const index = word.glyphs.findIndex((glyph, i) => glyph.char === char && layout.placed[i].prev >= 0);
      if (index >= 0) {
        g = index;
        break;
      }
    }
    if (g < 0) {
      const middle = Math.floor(word.glyphs.length / 2);
      g = layout.placed[middle]?.prev >= 0 || word.glyphs.length === 1 ? middle : 0;
    }
    introPlayed = true;
    const now = performance.now();
    const grab = startGrab(g, "intro", "intro", 0, 0, now);
    for (const strand of grab.strands) measureStrand(strand);
    const side = layout.placed[g].next >= 0 ? 1 : -1;
    const room = height - layout.placed[g].bottom - 24;
    let choice = null;
    for (const tilt of INTRO_TILTS) {
      const length = Math.hypot(tilt, 1);
      const ux = (side * tilt) / length;
      const uy = 1 / length;
      let distance = 0;
      for (const strand of grab.strands) {
        const wx = strand.bx - strand.ax;
        const wy = strand.by - strand.ay;
        const along = wx * ux + wy * uy;
        const reach = strand.L0 + params.snapLength * layout.capH;
        const need = -along + Math.sqrt(Math.max(0, along * along - (wx * wx + wy * wy) + reach * reach));
        distance = Math.max(distance, need * 1.06);
      }
      choice = { ux, uy, distance };
      if (distance * uy <= room) break;
    }
    intro = { grab, start: now, dirX: choice.ux, dirY: choice.uy, distance: choice.distance, lastForced: 0 };
    requestFrame();
  };

  const finishMorph = () => {
    if (previous) {
      gl.deleteTexture(previous.texture);
      previous = null;
    }
    morph = null;
    if (queued) {
      const text = queued;
      queued = null;
      if (queuedTimer) window.clearTimeout(queuedTimer);
      queuedTimer = window.setTimeout(() => {
        queuedTimer = 0;
        if (!disposed) show(text);
      }, 0);
    }
    if (!reduced && current) {
      const kick = SETTLE_IMPULSE_CAPS * current.layout.capH;
      for (let i = 0; i < glyphs.length; i += 1) glyphs[i].vy += (i % 2 ? -1 : 1) * kick * (0.6 + 0.4 * Math.sin(i * 2.3));
    }
  };

  const step = (now, dt) => {
    let active = false;
    if (!current) return false;
    const layout = current.layout;

    if (intro) {
      updateIntro(now);
      active = true;
    }
    if (settleAt) {
      if (now >= settleAt) settle();
      else active = true;
    }

    if (morph) {
      const t = clamp01((now - morph.start) / morph.duration);
      morph.t = t;
      active = true;
      if (t >= 1) finishMorph();
    }

    for (const glyph of glyphs) {
      glyph.leanX = 0;
      glyph.leanY = 0;
    }

    for (const grab of grabs) {
      if (grab.released) continue;
      const glyph = glyphs[grab.glyph];
      const beforeX = glyph.x;
      const beforeY = glyph.y;
      if (grab.kind === "pointer") {
        if (now - grab.lastT > 48) {
          const decay = Math.exp((-dt * 1000) / 60);
          grab.vx *= decay;
          grab.vy *= decay;
        }
        holdInHand(grab, glyph, dt);
        if (grab.freeAt && now - grab.freeAt >= FREE_HOLD_MS) {
          slip(grab);
          active = true;
          continue;
        }
      } else {
        const follow = grab.kind === "intro" ? 1 : 1 - Math.exp(-dt * 22);
        glyph.x += (grab.targetX - glyph.x) * follow;
        glyph.y += (grab.targetY - glyph.y) * follow;
        grab.vx = (glyph.x - beforeX) / dt;
        grab.vy = (glyph.y - beforeY) / dt;
      }
      active = true;
    }

    const reach = LEAN_REACH * layout.capH;
    for (const grab of grabs) {
      for (const strand of grab.strands) {
        if (strand.state !== "intact") continue;
        measureStrand(strand);
        if (!grab.released && strand.stretch >= 1 && now >= grab.nextSnapAt) snapStrand(grab, strand, now);
        if (strand.state !== "intact" || grab.released || strand.bodyA < 0) continue;
        const tension = Math.min(1, strand.stretch) * reach;
        for (let j = 0; j < glyphs.length; j += 1) {
          const glyph = glyphs[j];
          if (glyph.held) continue;
          const falloff = 0.5 ** Math.abs(j - strand.bodyA);
          glyph.leanX += strand.dirX * tension * falloff;
          glyph.leanY += strand.dirY * tension * falloff;
        }
      }
    }

    for (const glyph of glyphs) {
      if (glyph.held) continue;
      stepSpring(glyph, dt);
      const offset = Math.abs(glyph.x - glyph.leanX) + Math.abs(glyph.y - glyph.leanY);
      const speed = Math.abs(glyph.vx) + Math.abs(glyph.vy);
      if (offset > 0.02 || speed > 0.4) active = true;
      else {
        glyph.x = glyph.leanX;
        glyph.y = glyph.leanY;
        glyph.vx = 0;
        glyph.vy = 0;
      }
    }

    const liftRate = 1 - Math.exp(-dt * 20);
    for (let i = 0; i < glyphs.length; i += 1) {
      const glyph = glyphs[i];
      const target = i === hover && !glyph.held && !morph ? -HOVER_LIFT_PX : 0;
      glyph.lift += (target - glyph.lift) * liftRate;
      if (Math.abs(target - glyph.lift) > 0.01) active = true;
      else glyph.lift = target;
      glyph.grabVX = 0;
      glyph.grabVY = 0;
      glyph.tension = 0;
    }
    for (const grab of grabs) {
      if (grab.released) continue;
      const glyph = glyphs[grab.glyph];
      const pointerHeld = grab.kind === "pointer";
      glyph.grabVX = pointerHeld ? grab.holdVX : grab.vx;
      glyph.grabVY = pointerHeld ? grab.holdVY : grab.vy;
      glyph.tension = pointerHeld ? grab.share : 0;
    }

    const squashRate = 1 - Math.exp(-dt * 28);
    for (let i = 0; i < glyphs.length; i += 1) {
      const glyph = glyphs[i];
      const vx = glyph.held ? glyph.grabVX : glyph.vx;
      const vy = glyph.held ? glyph.grabVY : glyph.vy;
      const speed = Math.hypot(vx, vy);
      let stretchX = 0;
      let stretchY = 0;
      if (!reduced && speed > 24) {
        const amount = Math.min(SQUASH_LIMIT - 1, speed * SQUASH_PER_SPEED) / speed;
        stretchX = vx * amount;
        stretchY = vy * amount;
      }
      if (!reduced && glyph.held && glyph.tension > 0) {
        const reach = Math.hypot(glyph.x, glyph.y);
        if (reach > 1) {
          const pull = (TENSION_STRETCH * glyph.tension) / reach;
          stretchX += glyph.x * pull;
          stretchY += glyph.y * pull;
        }
      }
      const total = Math.hypot(stretchX, stretchY);
      const target = 1 + Math.min(SQUASH_LIMIT - 1, total);
      if (total > 1e-4) {
        glyph.ux = stretchX / total;
        glyph.uy = stretchY / total;
      }
      glyph.stretch += (target - glyph.stretch) * squashRate;
      if (Math.abs(glyph.stretch - 1) > 0.002) active = true;
      else if (target === 1) glyph.stretch = 1;
    }

    const hoverTarget = hover >= 0 && !glyphs[hover]?.held && !morph ? 1 : 0;
    hoverAmount += (hoverTarget - hoverAmount) * (1 - Math.exp(-dt * 16));
    if (Math.abs(hoverTarget - hoverAmount) > 0.004) active = true;
    else hoverAmount = hoverTarget;

    if (focus >= 0) focusShown = focus;
    const focusTarget = focus >= 0 && !morph ? 1 : 0;
    focusAmount += (focusTarget - focusAmount) * (1 - Math.exp(-dt * 18));
    if (Math.abs(focusTarget - focusAmount) > 0.004) active = true;
    else focusAmount = focusTarget;

    segmentCount = 0;
    const rest = radiusAtRest();
    const puddleX = PUDDLE_WIDTH * layout.stem;
    const puddleY = PUDDLE_HEIGHT * layout.stem;
    for (const grab of grabs) {
      let alive = false;
      for (const strand of grab.strands) {
        if (strand.state === "intact") {
          measureStrand(strand);
          advanceStrand(strand, dt);
          const emerge = smoothstep(0, layout.capH * 0.12, strand.ext);
          const presence = grab.released ? emerge : Math.max(PREVIEW_RADIUS, emerge);
          const neck = strand.rEnd > 1e-3 ? 1 - strand.rMid / strand.rEnd : 0;
          if (presence > 0.002) {
            const ctrlX = 2 * strand.mx - (strand.ax + strand.bx) / 2;
            const ctrlY = 2 * strand.my - (strand.ay + strand.by) / 2;
            const pool = strand.bodyA < 0 ? presence * (1 - PUDDLE_SHRINK * Math.min(1, strand.stretch)) : 0;
            const radius = strand.rEnd * presence;
            pushSegment(strand.ax, strand.ay, ctrlX, ctrlY, strand.bx, strand.by, radius, radius, neck, 0, strand.bodyA, strand.bodyB, 1, 1, puddleX * pool, puddleY * pool);
            alive = true;
            if (Math.abs(strand.mvx) + Math.abs(strand.mvy) > 1) active = true;
          }
          if (!grab.released) alive = true;
        } else if (strand.state === "snapped") {
          const t = clamp01((now - strand.snapAt) / Math.max(40, params.retractMs));
          if (t >= 1) {
            strand.state = "gone";
            continue;
          }
          alive = true;
          const e = easeOutCubic(t);
          const absorb = 1 - easeInQuad(t);
          const bead = strand.snapEnd * 0.85 * Math.sin(Math.PI * e ** 0.7);
          const root = strand.bodyA < 0;
          const rootFade = root ? 1 - e : 1 - e * 0.5;
          const a = strandPoint(strand, "a");
          const ax = a.x;
          const ay = a.y;
          advanceHalf(strand.halves[0], ax, ay, dt);
          const pool = root ? 1 - e : 0;
          pushHalf(strand.halves[0], ax, ay, absorb, strand.snapEnd * rootFade, strand.snapMid, bead * rootFade, strand.bodyA, puddleX * pool * (1 - PUDDLE_SHRINK), puddleY * pool * (1 - PUDDLE_SHRINK));
          const b = strandPoint(strand, "b");
          const bx = b.x;
          const by = b.y;
          advanceHalf(strand.halves[1], bx, by, dt);
          pushHalf(strand.halves[1], bx, by, absorb, strand.snapEnd * (1 - e * 0.5), strand.snapMid, bead, strand.bodyB, 0, 0);
        }
      }
      const glyph = glyphs[grab.glyph];
      const settled = Math.abs(glyph.x) + Math.abs(glyph.y) < 0.5 && Math.abs(glyph.vx) + Math.abs(glyph.vy) < 4;
      grab.dead = grab.released && (!alive || settled) && grab.strands.every((s) => s.state !== "snapped");
      if (!grab.dead) active = true;
    }
    let deadCount = 0;
    for (const grab of grabs) if (grab.dead) deadCount += 1;
    if (deadCount) grabs = grabs.filter((grab) => !grab.dead);

    if (hover >= 0 && hoverAmount > 0.01 && !grabs.some((grab) => grab.glyph === hover)) {
      const place = layout.placed[hover];
      const anchors = layout.anchors;
      const glyph = glyphs[hover];
      const radius = rest * PREVIEW_RADIUS * hoverAmount;
      const bx = place.penX + glyph.x;
      const by = place.penY + glyph.y + glyph.lift;
      if (place.prev >= 0) {
        const n = layout.placed[place.prev];
        const ng = glyphs[place.prev];
        const anchor = anchors[place.prev].right;
        const ax = n.penX + ng.x + anchor.x;
        const ay = n.penY + ng.y + ng.lift + anchor.y;
        const tx = bx + anchors[hover].left.x;
        const ty = by + anchors[hover].left.y;
        pushSegment(ax, ay, (ax + tx) / 2, (ay + ty) / 2, tx, ty, radius, radius, 0, 0, place.prev, hover, 1, 1, 0, 0);
      }
      if (place.next >= 0) {
        const n = layout.placed[place.next];
        const ng = glyphs[place.next];
        const anchor = anchors[place.next].left;
        const ax = n.penX + ng.x + anchor.x;
        const ay = n.penY + ng.y + ng.lift + anchor.y;
        const tx = bx + anchors[hover].right.x;
        const ty = by + anchors[hover].right.y;
        pushSegment(ax, ay, (ax + tx) / 2, (ay + ty) / 2, tx, ty, radius, radius, 0, 0, place.next, hover, 1, 1, 0, 0);
      }
    }

    return active;
  };

  const render = () => {
    if (!current || contextLost || !program) return;
    const layout = current.layout;
    for (let i = 0; i < glyphs.length && i < MAX_GLYPHS; i += 1) {
      const glyph = glyphs[i];
      const place = layout.placed[i];
      const o = i * 4;
      moveNew[o] = glyph.x;
      moveNew[o + 1] = glyph.y + glyph.lift;
      moveNew[o + 2] = place.centreX;
      moveNew[o + 3] = place.centreY;
      warpNew[o] = glyph.ux;
      warpNew[o + 1] = glyph.uy;
      warpNew[o + 2] = glyph.stretch;
      warpNew[o + 3] = 0;
    }

    let morphMix = 1;
    let melt = 0;
    let slump = 0;
    if (morph && previous) {
      const t = morph.t ?? 0;
      const capH = previous.layout.capH + (layout.capH - previous.layout.capH) * clamp01((t - 0.2) / 0.6);
      const meltCurve = easeInOut(clamp01(t / 0.36)) * (1 - easeInQuad(clamp01((t - 0.64) / 0.36)));
      morphMix = easeInOut(clamp01((t - 0.2) / 0.6));
      melt = (reduced ? 0.2 : MELT_CAPS) * capH * meltCurve;
      slump = (reduced ? 0 : 0.08) * capH * meltCurve;
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const u = locations;
    gl.uniform2f(u.uResolution, canvas.width, canvas.height);
    gl.uniform1f(u.uPixelRatio, canvas.width / Math.max(1, width));

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, current.texture);
    gl.uniform1i(u.uAtlasNew, 0);
    gl.uniform2f(u.uAtlasSizeNew, current.word.width, current.word.height);
    gl.uniform1f(u.uScaleNew, layout.a);
    gl.uniform1f(u.uPadNew, current.word.pad);
    gl.uniform1i(u.uCountNew, Math.min(MAX_GLYPHS, current.word.glyphs.length));
    gl.uniform2f(u.uDecodeNew, current.decode[0], current.decode[1]);
    gl.uniform4fv(u.uTileNew, tileNew);
    gl.uniform4fv(u.uPlaceNew, placeNew);
    gl.uniform4fv(u.uMoveNew, moveNew);
    gl.uniform4fv(u.uWarpNew, warpNew);

    const old = morph && previous ? previous : current;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, old.texture);
    gl.uniform1i(u.uAtlasOld, 1);
    gl.uniform2f(u.uAtlasSizeOld, old.word.width, old.word.height);
    gl.uniform1f(u.uScaleOld, old.layout.a);
    gl.uniform1f(u.uPadOld, old.word.pad);
    gl.uniform1i(u.uCountOld, morph && previous ? Math.min(MAX_GLYPHS, previous.word.glyphs.length) : 0);
    gl.uniform2f(u.uDecodeOld, old.decode[0], old.decode[1]);
    gl.uniform4fv(u.uTileOld, tileOld);
    gl.uniform4fv(u.uPlaceOld, placeOld);

    gl.uniform1f(u.uMorph, morphMix);
    gl.uniform1f(u.uMelt, melt);
    gl.uniform1f(u.uSlump, slump);
    gl.uniform1i(u.uSegCount, segmentCount);
    gl.uniform4fv(u.uSegLine, segLine);
    gl.uniform4fv(u.uSegCtrl, segCtrl);
    gl.uniform4fv(u.uSegShape, segShape);
    gl.uniform4fv(u.uSegBody, segBody);
    gl.uniform1f(u.uFillet, params.fillet * layout.stem);
    gl.uniform1i(u.uFocus, focusAmount > 0.001 && focusShown >= 0 && focusShown < glyphs.length ? focusShown : -1);
    gl.uniform1f(u.uFocusAmount, focusAmount);
    gl.uniform3fv(u.uPaper, colours.paper);
    gl.uniform3fv(u.uInk, colours.ink);
    gl.uniform3fv(u.uAccent, colours.accent);
    gl.uniform1f(u.uGrain, GRAIN);
    gl.uniform1f(u.uChroma, CHROMA);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const tick = (now) => {
    frame = 0;
    if (disposed || contextLost) return;
    const elapsed = lastFrame ? now - lastFrame : 0;
    lastFrame = now;
    if (elapsed > 0 && elapsed < 120 && governor.sample(elapsed)) sizeCanvas();
    const dt = Math.min(Math.max((elapsed || 16.7) / 1000, 1 / 240), 1 / 30);
    const active = step(now, dt);
    render();
    if (active && visible && onscreen) frame = requestAnimationFrame(tick);
    else lastFrame = 0;
  };

  function requestFrame() {
    if (disposed || frame || !visible || !onscreen) return;
    frame = requestAnimationFrame(tick);
  }

  const readRect = () => {
    const rect = canvas.getBoundingClientRect();
    plateLeft = rect.left;
    plateTop = rect.top;
    rectStale = false;
  };

  const toPlate = (event) => {
    if (rectStale) readRect();
    pointer.x = event.clientX - plateLeft;
    pointer.y = event.clientY - plateTop;
    return pointer;
  };

  const markRectStale = () => {
    rectStale = true;
  };

  const evict = (keep) => {
    if (cache.size <= CACHE_LIMIT) return;
    const pinned = new Set([keep, wanted, queued, current?.word.text, previous?.word.text]);
    for (const key of cache.keys()) {
      if (cache.size <= CACHE_LIMIT) break;
      if (!pinned.has(key)) cache.delete(key);
    }
  };

  const prepare = (text) => {
    const cached = cache.get(text);
    if (cached) {
      cache.delete(text);
      cache.set(text, cached);
      return cached;
    }
    const job = (async () => {
      await document.fonts?.load?.(`600 100px ${family}`, text).catch(() => null);
      if (disposed) throw new Error(BUILDER_DISPOSED);
      const probe = document.createElement("canvas").getContext("2d");
      probe.font = `600 100px ${family}`;
      const em = probe.measureText(text).width / 100;
      const boxW = width || 1200;
      const boxH = height || 800;
      const single = Math.min((boxW * 0.7) / Math.max(em, 0.5), boxH * 0.3);
      const stacked = boxW < 640 ? Math.min((boxW * 0.9) / Math.max(em * 0.55, 0.5), boxH * 0.156) : 0;
      const ratio = Math.min(window.devicePixelRatio || 1, dprCap);
      const rasterSize = Math.min(RASTER_MAX, Math.max(RASTER_MIN, Math.max(single, stacked) * ratio));
      let word = rasterWord(text, family, rasterSize);
      let encoded = null;
      try {
        encoded = await builder.build({ alpha: word.alpha, width: word.width, height: word.height, tiles: word.tiles });
      } catch (error) {
        if (disposed) throw error;
        word = rasterWord(text, family, rasterSize);
        encoded = await builder.build({ alpha: word.alpha, width: word.width, height: word.height, tiles: word.tiles });
      }
      if (disposed) throw new Error(BUILDER_DISPOSED);
      word.half = encoded.half;
      word.coarse = encoded.coarse;
      word.coarseWidth = encoded.coarseWidth;
      word.alpha = null;
      return word;
    })();
    cache.set(text, job);
    evict(text);
    job.catch(() => cache.delete(text));
    return job;
  };

  const adopt = (word) => {
    const uploaded = uploadField(word);
    return { word, layout: layoutWord(word, width, height), texture: uploaded.texture, decode: uploaded.decode };
  };

  const replaceCurrent = (next, text) => {
    current = next;
    glyphs = makeGlyphs(next.word.glyphs.length);
    grabs = [];
    hover = -1;
    writeStatic(current, tileNew, placeNew);
    summarise();
    onTitleShown?.(text);
  };

  function show(text) {
    wanted = text;
    showToken += 1;
    const token = showToken;
    return prepare(text).then((word) => {
      if (disposed || token !== showToken || contextLost) return;
      if (!width || !height) return;
      if (current && current.word === word) {
        queued = null;
        return;
      }
      if (!current) {
        current = adopt(word);
        glyphs = makeGlyphs(word.glyphs.length);
        writeStatic(current, tileNew, placeNew);
        summarise();
        sizeCanvas();
        render();
        onTitleShown?.(text);
        if (!readyFired) {
          readyFired = true;
          onReady?.();
        }
        return;
      }
      if (morph) {
        const t = (performance.now() - morph.start) / morph.duration;
        if (t < MORPH_RETARGET_T) {
          const replaced = current;
          replaceCurrent(adopt(word), text);
          gl.deleteTexture(replaced.texture);
        } else {
          queued = text;
        }
        requestFrame();
        return;
      }
      if (introTimer || intro) cancelIntro();
      if (previous) gl.deleteTexture(previous.texture);
      previous = current;
      writeStatic(previous, tileOld, placeOld);
      replaceCurrent(adopt(word), text);
      morph = { start: performance.now(), duration: reduced ? MORPH_REDUCED_MS : MORPH_MS, t: 0 };
      requestFrame();
    }, (error) => {
      if (disposed) return;
      throw error;
    });
  }

  const handleResize = (entries) => {
    const box = entries[0]?.contentRect;
    if (!box) return;
    rectStale = true;
    const nextWidth = Math.round(box.width);
    const nextHeight = Math.round(box.height);
    if (nextWidth === width && nextHeight === height) return;
    width = nextWidth;
    height = nextHeight;
    sizeCanvas();
    if (!current && wanted) show(wanted);
    relayout();
    render();
    requestFrame();
  };

  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(host);
  const rect = host.getBoundingClientRect();
  width = Math.round(rect.width);
  height = Math.round(rect.height);
  sizeCanvas();

  const intersection = new IntersectionObserver((entries) => {
    onscreen = entries[entries.length - 1]?.isIntersecting ?? true;
    if (onscreen) {
      render();
      requestFrame();
    }
  });
  intersection.observe(host);

  const handleVisibility = () => {
    visible = !document.hidden;
    if (visible) requestFrame();
  };
  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("scroll", markRectStale, { passive: true, capture: true });

  const handleLost = (event) => {
    event.preventDefault();
    contextLost = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };
  const handleRestored = () => {
    contextLost = false;
    initGL();
    if (current) {
      const uploaded = uploadField(current.word);
      current.texture = uploaded.texture;
      current.decode = uploaded.decode;
    }
    if (previous) {
      previous = null;
      morph = null;
    }
    render();
  };
  canvas.addEventListener("webglcontextlost", handleLost);
  canvas.addEventListener("webglcontextrestored", handleRestored);

  return {
    show,
    prefetch(text) {
      prepare(text).catch(() => null);
    },
    playIntro() {
      if (introTimer || intro || settledFired) return;
      if (introPlayed || reduced) {
        introPlayed = true;
        settle();
        return;
      }
      introTimer = window.setTimeout(beginIntro, INTRO_DELAY_MS);
    },
    setParams(next) {
      params = { ...TAFFY_BASE, ...next };
      if (current) {
        render();
        requestFrame();
      }
    },
    setReducedMotion(value) {
      reduced = Boolean(value);
    },
    pointerDown(event) {
      if (!current || morph) return false;
      readRect();
      const { x, y } = toPlate(event);
      const now = event.timeStamp || performance.now();
      const g = hitTest(x, y, event.pointerType === "touch");
      if (g < 0) {
        if (!nearWord(x, y)) paperPress = { id: event.pointerId, x, y };
        return false;
      }
      cancelIntro();
      const active = grabs.filter((grab) => !grab.released);
      if (active.length >= MAX_GRABS || glyphs[g].held) return false;
      startGrab(g, "pointer", event.pointerId, x, y, now);
      hover = -1;
      requestFrame();
      return true;
    },
    pointerMove(event) {
      if (!current) return;
      const { x, y } = toPlate(event);
      const grab = grabs.find((candidate) => candidate.kind === "pointer" && candidate.id === event.pointerId && !candidate.released);
      if (grab) {
        const now = event.timeStamp || performance.now();
        const elapsed = Math.max(1, now - grab.lastT);
        const instantX = ((x - grab.lastX) / elapsed) * 1000;
        const instantY = ((y - grab.lastY) / elapsed) * 1000;
        const blend = 1 - Math.exp(-elapsed / VELOCITY_WINDOW_MS);
        grab.vx += (instantX - grab.vx) * blend;
        grab.vy += (instantY - grab.vy) * blend;
        grab.lastX = x;
        grab.lastY = y;
        grab.lastT = now;
        grab.targetX = grab.startX + (x - grab.downX);
        grab.targetY = grab.startY + (y - grab.downY);
        requestFrame();
        return;
      }
      if (event.pointerType === "touch" || grabs.some((candidate) => candidate.kind === "pointer" && !candidate.released)) return;
      const next = morph ? -1 : hitTest(x, y);
      if (next !== hover) {
        hover = next;
        host.dataset.hover = next >= 0 ? "glyph" : "paper";
        requestFrame();
      }
    },
    pointerUp(event, cancelled) {
      const grab = grabs.find((candidate) => candidate.kind === "pointer" && candidate.id === event.pointerId);
      if (grab) {
        releaseGrab(grab);
        requestFrame();
      }
      if (paperPress && paperPress.id === event.pointerId) {
        const { x, y } = toPlate(event);
        const moved = Math.hypot(x - paperPress.x, y - paperPress.y);
        paperPress = null;
        if (!cancelled && moved < TAP_SLOP_PX && !grabs.some((candidate) => !candidate.released)) onPaperTap?.();
      }
    },
    pointerLeave() {
      if (hover >= 0) {
        hover = -1;
        host.dataset.hover = "paper";
        requestFrame();
      }
    },
    hasGrab() {
      return grabs.some((grab) => grab.kind === "pointer" && !grab.released);
    },
    keyPull(g, dx, dy, repeat) {
      if (!current || morph || g < 0 || g >= glyphs.length) return;
      cancelIntro();
      let grab = grabs.find((candidate) => candidate.glyph === g && candidate.kind === "key" && !candidate.released);
      if (!grab) {
        if (repeat || glyphs[g].held) return;
        grab = startGrab(g, "key", "key", 0, 0, performance.now());
      }
      grab.targetX += dx * KEY_STEP_PX;
      grab.targetY += dy * KEY_STEP_PX;
      requestFrame();
    },
    keyRelease(g) {
      const grab = grabs.find((candidate) => candidate.glyph === g && candidate.kind === "key" && !candidate.released);
      if (grab) {
        releaseGrab(grab);
        requestFrame();
      }
    },
    setFocus(g) {
      focus = g;
      requestFrame();
    },
    dispose() {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      if (introTimer) window.clearTimeout(introTimer);
      introTimer = 0;
      if (queuedTimer) window.clearTimeout(queuedTimer);
      queuedTimer = 0;
      queued = null;
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("scroll", markRectStale, { capture: true });
      canvas.removeEventListener("webglcontextlost", handleLost);
      canvas.removeEventListener("webglcontextrestored", handleRestored);
      builder.dispose();
      if (current) gl.deleteTexture(current.texture);
      if (previous) gl.deleteTexture(previous.texture);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      current = null;
      previous = null;
      cache.clear();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
