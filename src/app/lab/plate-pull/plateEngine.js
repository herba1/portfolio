import {
  BLUR_FS,
  BRAYER_FS,
  BRAYER_VS,
  DEPLETE_FS,
  QUAD_VS,
  ROLL_FS,
  SCENE_FS,
  SCENE_VS,
  SHADOW_FS,
  SHEET_FS,
  SHEET_VS,
  SKIRT_FS,
  SKIRT_VS,
  TRANSFER_FS,
} from "./plateShader";
import { FIBRE_H, FIBRE_W, PHOTO, blockArt, fibreArt, loadImage } from "./plateArt";
import { BLOCK_H, BLOCK_W, seeded } from "./plateCarve";

const BLOCK = { x: 0, y: 0, w: 1, h: 1.25 };
const PAPER = [1.2, 1.5];
const PAPER_PX = [512, 640];
const GRID_X = 60;
const GRID_Y = 75;
const CAM_Z = 4;
const LIGHT_SHIFT = [0.3, 0.4];
const ROLLER = [0.34, 0.052];
const BENCH = [0.93, 0.922, 0.905];
const PHI_FLAT = 0.99 * Math.PI;
const PHI_CURL = 0.42 * Math.PI;
const R_REST = 0.03;
const R_HELD = 0.05;
const DOG = 0.045;
const MAX_PRINTS = 7;
const TAU = Math.PI * 2;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const angleDiff = (a, b) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

function crit(x, v, target, omega, dt) {
  const delta = x - target;
  const e = Math.exp(-omega * dt);
  const k = v + omega * delta;
  return [target + (delta + k * dt) * e, (v - omega * k * dt) * e];
}

function compile(gl, vs, fs) {
  const make = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || "shader");
    return sh;
  };
  const program = gl.createProgram();
  const v = make(gl.VERTEX_SHADER, vs);
  const f = make(gl.FRAGMENT_SHADER, fs);
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link");
  gl.deleteShader(v);
  gl.deleteShader(f);
  const u = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i += 1) {
    const info = gl.getActiveUniform(program, i);
    u[info.name] = gl.getUniformLocation(program, info.name);
  }
  return { program, u };
}

function imageTexture(gl, source, mip) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function target(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

function freeTarget(gl, t) {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
}

function clearTarget(gl, t, r, g, b, a) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  gl.viewport(0, 0, t.w, t.h);
  gl.clearColor(r, g, b, a);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

function gridMesh(gl) {
  const verts = new Float32Array((GRID_X + 1) * (GRID_Y + 1) * 2);
  let k = 0;
  for (let j = 0; j <= GRID_Y; j += 1) {
    for (let i = 0; i <= GRID_X; i += 1) {
      verts[k++] = i / GRID_X;
      verts[k++] = j / GRID_Y;
    }
  }
  const idx = new Uint16Array(GRID_X * GRID_Y * 6);
  k = 0;
  for (let j = 0; j < GRID_Y; j += 1) {
    for (let i = 0; i < GRID_X; i += 1) {
      const a = j * (GRID_X + 1) + i;
      const b = a + 1;
      const c = a + GRID_X + 1;
      const d = c + 1;
      idx[k++] = a;
      idx[k++] = c;
      idx[k++] = b;
      idx[k++] = b;
      idx[k++] = c;
      idx[k++] = d;
    }
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, vb, ib, count: idx.length };
}

function restMatrix(tx, ty, a, mirror) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  if (mirror) return new Float32Array([-c, -s, 0, -s, c, 0, tx, ty, 1]);
  return new Float32Array([c, s, 0, -s, c, 0, tx, ty, 1]);
}

function restInverse(tx, ty, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return new Float32Array([c, -s, 0, s, c, 0, -(c * tx + s * ty), -(-s * tx + c * ty), 1]);
}

function applyPose(pose, lx, ly) {
  const c = Math.cos(pose.a);
  const s = Math.sin(pose.a);
  const x = pose.mirror ? -lx : lx;
  return [pose.x + c * x - s * ly, pose.y + s * x + c * ly];
}

function invertPose(pose, wx, wy) {
  const c = Math.cos(pose.a);
  const s = Math.sin(pose.a);
  const dx = wx - pose.x;
  const dy = wy - pose.y;
  const lx = c * dx + s * dy;
  const ly = -s * dx + c * dy;
  return [pose.mirror ? -lx : lx, ly];
}

function insidePaper(lx, ly, pad = 0) {
  return Math.abs(lx) <= PAPER[0] / 2 + pad && Math.abs(ly) <= PAPER[1] / 2 + pad;
}

function radiusFor(peel, hold) {
  const cap = R_REST + (R_HELD - R_REST) * hold;
  return Math.min(cap, 0.012 + 0.3 * Math.max(0, peel));
}

function phiFor(peel, hold, extent) {
  const r = radiusFor(peel, hold);
  const restPhi = PHI_CURL + (PHI_FLAT - PHI_CURL) * smooth(0.05, 0.3, peel);
  const flapLen = Math.max(peel - r * Math.PI * 0.5, 0.02);
  let held = Math.PI - Math.asin(Math.min(0.62, 0.15 / flapLen));
  held += (Math.PI - held) * smooth(extent - 0.32, extent - 0.02, peel);
  return restPhi + (held - restPhi) * hold;
}

function alongFor(s, r, phi) {
  if (s <= 0) return s;
  const arc = r * phi;
  if (s < arc) return r * Math.sin(s / r);
  return r * Math.sin(phi) + (s - arc) * Math.cos(phi);
}

function tipOffset(peel, hold, extent) {
  const r = radiusFor(peel, hold);
  const phi = phiFor(peel, hold, extent);
  return peel - alongFor(peel, r, phi);
}

function solvePeel(reach, hold, extent) {
  if (reach <= 0) return 0;
  let lo = 0;
  let hi = extent + 0.8;
  if (tipOffset(hi, hold, extent) < reach) return hi;
  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2;
    if (tipOffset(mid, hold, extent) < reach) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export async function createPlate(stage, canvas, options = {}) {
  const { embedded = false, onChange = () => {}, insets = () => ({ top: 16, bottom: 16, left: 16, right: 16 }) } = options;
  const gl = canvas.getContext("webgl2", { antialias: true, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false, depth: true });
  if (!gl) throw new Error("webgl2 unavailable");
  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = reducedQuery.matches;

  const photo = await loadImage(PHOTO);
  if (gl.isContextLost()) return { destroy() {} };
  const heightData = blockArt(photo);
  const fibreData = fibreArt();

  const dprNow = () => Math.min(2, window.devicePixelRatio || 1);
  const progs = {
    scene: compile(gl, SCENE_VS, SCENE_FS),
    sheet: compile(gl, SHEET_VS, SHEET_FS),
    shadow: compile(gl, SHEET_VS, SHADOW_FS),
    blur: compile(gl, QUAD_VS, BLUR_FS),
    skirt: compile(gl, SKIRT_VS, SKIRT_FS),
    transfer: compile(gl, QUAD_VS, TRANSFER_FS),
    deplete: compile(gl, QUAD_VS, DEPLETE_FS),
    roll: compile(gl, QUAD_VS, ROLL_FS),
    brayer: compile(gl, BRAYER_VS, BRAYER_FS),
  };
  const mesh = gridMesh(gl);
  const emptyVao = gl.createVertexArray();
  const heightTex = imageTexture(gl, heightData, true);
  const fibreTex = imageTexture(gl, fibreData, true);
  const inkTargets = [target(gl, BLOCK_W, BLOCK_H), target(gl, BLOCK_W, BLOCK_H)];
  let inkCur = 0;
  let shadowA = null;
  let shadowB = null;

  const rand = seeded(1234);
  let view = { w: 1, h: 1, dpr: 1, k: 1, cx: 0, cy: 0, toClip: new Float32Array(9), fromClip: new Float32Array(9), cam: [0, 0], wide: true };
  let layout = { wide: true, stack: [1.72, 0.03], brayerHome: { x: 0.86, y: 0.28, a: -Math.PI / 2 + 0.1 } };
  const pointer = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, down: false, sx: 0, sy: 0, moved: 0 };
  let grab = null;
  let active = null;
  let prints = [];
  let script = null;
  let layTimer = -1;
  let inkLevel = 1;
  let printCount = 0;
  let raf = 0;
  let last = 0;
  let visible = true;
  let destroyed = false;
  let quality = 1;
  const slow = [];
  let lastPhase = "";

  const brayer = { x: 0, y: 0, a: 0, vx: 0, vy: 0, va: 0, spin: 0, gx: 0, gy: 0, travel: 0, prev: null, settled: true };

  function placeLayout(wide) {
    if (wide) {
      layout = { wide, stack: [1.88, 0.02], brayerHome: { x: 1.0, y: 0.32, a: -Math.PI / 2 + 0.1 } };
    } else {
      layout = { wide, stack: [0.06, 1.74], brayerHome: { x: -0.06, y: 0.99, a: 0.05 } };
    }
  }

  function viewBounds() {
    if (layout.wide) return { minX: -0.72, maxX: 2.6, minY: -0.86, maxY: 0.9 };
    return { minX: -0.65, maxX: 0.9, minY: -0.84, maxY: 1.86 };
  }

  function fit() {
    const rect = stage.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const dpr = Math.max(0.5, dprNow() * quality);
    const ins = insets(w, h);
    const aw = Math.max(40, w - ins.left - ins.right);
    const ah = Math.max(40, h - ins.top - ins.bottom);
    const wide = aw / ah >= 1.15;
    if (wide !== layout.wide || !view.ready) {
      placeLayout(wide);
      for (const p of prints) {
        p.x = layout.stack[0] + p.rx;
        p.y = layout.stack[1] + p.ry;
      }
      if (!grab || grab.kind !== "brayer") {
        brayer.x = layout.brayerHome.x;
        brayer.y = layout.brayerHome.y;
        brayer.a = layout.brayerHome.a;
      }
    }
    const b = viewBounds();
    const bw = b.maxX - b.minX;
    const bh = b.maxY - b.minY;
    const k = Math.min(aw / bw, ah / bh, 520);
    const cx = ins.left + aw / 2 - k * (b.minX + bw / 2);
    const cy = ins.top + ah / 2 - k * (b.minY + bh / 2);
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const a = (2 * k) / w;
    const e = (-2 * k) / h;
    const c = (2 * cx) / w - 1;
    const f = 1 - (2 * cy) / h;
    const toClip = new Float32Array([a, 0, 0, 0, e, 0, c, f, 1]);
    const fromClip = new Float32Array([1 / a, 0, 0, 0, 1 / e, 0, -c / a, -f / e, 1]);
    view = { w, h, dpr, k, cx, cy, toClip, fromClip, cam: [(w / 2 - cx) / k, (h / 2 - cy) / k], wide, ready: true };
    const sw = Math.max(8, Math.ceil(canvas.width / 4));
    const sh = Math.max(8, Math.ceil(canvas.height / 4));
    if (!shadowA || shadowA.w !== sw || shadowA.h !== sh) {
      freeTarget(gl, shadowA);
      freeTarget(gl, shadowB);
      shadowA = target(gl, sw, sh);
      shadowB = target(gl, sw, sh);
    }
  }

  function toWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return [(clientX - rect.left - view.cx) / view.k, (clientY - rect.top - view.cy) / view.k];
  }

  function newSheet(jitter) {
    const maps = [target(gl, PAPER_PX[0], PAPER_PX[1]), target(gl, PAPER_PX[0], PAPER_PX[1])];
    clearTarget(gl, maps[0], 0, 0, 0, 0);
    clearTarget(gl, maps[1], 0, 0, 0, 0);
    const tx = jitter ? (rand() - 0.5) * 0.024 : 0;
    const ty = jitter ? (rand() - 0.5) * 0.024 : 0;
    const a0 = jitter ? (rand() - 0.5) * 0.018 : 0;
    return {
      maps,
      cur: 0,
      tx,
      ty,
      a0,
      mode: "down",
      cx: 0,
      cy: 0,
      nx: 1,
      ny: 0,
      axisX: 1,
      axisY: 0,
      peel: 0,
      vPeel: 0,
      hold: 0,
      vHold: 0,
      speed: 0,
      lastPeel: 0,
      lastNx: 1,
      lastNy: 0,
      dirty: false,
      flip: [rand() < 0.5 ? 1 : 0, rand() < 0.5 ? 1 : 0],
      seed: [rand() * 400, rand() * 400],
      pose: null,
      sum: 0,
      weight: 0,
      startInk: inkLevel,
      freeing: false,
      freeSpeed: 0,
    };
  }

  function sheetCorner(sheet, sx, sy) {
    const lx = (sx * PAPER[0]) / 2;
    const ly = (sy * PAPER[1]) / 2;
    const c = Math.cos(sheet.a0);
    const s = Math.sin(sheet.a0);
    const wx = sheet.tx + c * lx - s * ly;
    const wy = sheet.ty + s * lx + c * ly;
    const ox = sx * 0.6;
    const oy = sy * 0.62;
    const ol = Math.hypot(ox, oy);
    return { wx, wy, nx: (c * ox - s * oy) / ol, ny: (s * ox + c * oy) / ol };
  }

  function setCorner(sheet, sx, sy, nx, ny) {
    const corner = sheetCorner(sheet, sx, sy);
    sheet.cx = corner.wx;
    sheet.cy = corner.wy;
    const dx = nx ?? corner.nx;
    const dy = ny ?? corner.ny;
    const l = Math.hypot(dx, dy) || 1;
    sheet.nx = dx / l;
    sheet.ny = dy / l;
    sheet.axisX = sheet.nx;
    sheet.axisY = sheet.ny;
    sheet.cornerX = sx;
    sheet.cornerY = sy;
  }

  function extentOf(sheet) {
    let m = 0;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const c = sheetCorner(sheet, sx, sy);
        m = Math.max(m, (sheet.cx - c.wx) * sheet.nx + (sheet.cy - c.wy) * sheet.ny);
      }
    }
    return m;
  }

  function foldOf(sheet) {
    return [sheet.cx - sheet.nx * sheet.peel, sheet.cy - sheet.ny * sheet.peel];
  }

  function tipOf(sheet) {
    const ext = extentOf(sheet);
    const r = radiusFor(sheet.peel, sheet.hold);
    const phi = phiFor(sheet.peel, sheet.hold, ext);
    const al = alongFor(sheet.peel, r, phi);
    return [sheet.cx + sheet.nx * (al - sheet.peel), sheet.cy + sheet.ny * (al - sheet.peel)];
  }

  function bindQuad() {
    gl.bindVertexArray(emptyVao);
  }

  function bindTex(unit, tex, prog, name) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(prog.u[name], unit);
  }

  function blockUniform(prog) {
    gl.uniform4f(prog.u.uBlock, BLOCK.x, BLOCK.y, BLOCK.w, BLOCK.h);
  }

  function transferStep(sheet, speed) {
    const slowness = 1 - smooth(0.32, 2.3, speed);
    const jitter = speed > 0.6 ? (rand() - 0.5) * 0.24 * (1 - slowness) : 0;
    const base = clamp((0.3 + 0.56 * slowness) * (1 + jitter), 0.05, 0.95);
    const starve = Math.pow(1 - slowness, 0.85);
    const src = sheet.maps[sheet.cur];
    const dst = sheet.maps[1 - sheet.cur];
    const fold = foldOf(sheet);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    bindQuad();
    const tp = progs.transfer;
    gl.useProgram(tp.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.w, dst.h);
    bindTex(0, src.tex, tp, "uOld");
    bindTex(1, inkTargets[inkCur].tex, tp, "uInk");
    bindTex(2, heightTex, tp, "uHeight");
    gl.uniformMatrix3fv(tp.u.uRest, false, restMatrix(sheet.tx, sheet.ty, sheet.a0, false));
    gl.uniform2f(tp.u.uPaper, PAPER[0], PAPER[1]);
    gl.uniform4f(tp.u.uFold, fold[0], fold[1], sheet.nx, sheet.ny);
    blockUniform(tp);
    gl.uniform4f(tp.u.uPull, base, starve * 0.88, sheet.seed[0], sheet.seed[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const dp = progs.deplete;
    const inkSrc = inkTargets[inkCur];
    const inkDst = inkTargets[1 - inkCur];
    gl.useProgram(dp.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, inkDst.fbo);
    gl.viewport(0, 0, inkDst.w, inkDst.h);
    bindTex(0, inkSrc.tex, dp, "uInkOld");
    bindTex(1, src.tex, dp, "uPaperOld");
    bindTex(2, dst.tex, dp, "uPaperNew");
    gl.uniformMatrix3fv(dp.u.uRestInv, false, restInverse(sheet.tx, sheet.ty, sheet.a0));
    gl.uniform2f(dp.u.uPaper, PAPER[0], PAPER[1]);
    gl.uniform2f(dp.u.uPaperPx, PAPER_PX[0], PAPER_PX[1]);
    blockUniform(dp);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    sheet.cur = 1 - sheet.cur;
    inkCur = 1 - inkCur;
    return base * (1 - starve * 0.45);
  }

  function rollStep(fromX, fromY, fromA, toX, toY, toA) {
    const rp = progs.roll;
    const inkSrc = inkTargets[inkCur];
    const inkDst = inkTargets[1 - inkCur];
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    bindQuad();
    gl.useProgram(rp.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, inkDst.fbo);
    gl.viewport(0, 0, inkDst.w, inkDst.h);
    bindTex(0, inkSrc.tex, rp, "uInkOld");
    blockUniform(rp);
    gl.uniform4f(rp.u.uFrom, fromX, fromY, Math.cos(fromA), Math.sin(fromA));
    gl.uniform4f(rp.u.uTo, toX, toY, Math.cos(toA), Math.sin(toA));
    gl.uniform2f(rp.u.uRoller, ROLLER[0], 0.02);
    const down = active && active.mode === "down";
    gl.uniform1f(rp.u.uSheetDown, down ? 1 : 0);
    if (down) {
      const fold = foldOf(active);
      gl.uniformMatrix3fv(rp.u.uSheetInv, false, restInverse(active.tx, active.ty, active.a0));
      gl.uniform4f(rp.u.uSheetFold, fold[0], fold[1], active.nx, active.ny);
    } else {
      gl.uniformMatrix3fv(rp.u.uSheetInv, false, restInverse(0, 0, 0));
      gl.uniform4f(rp.u.uSheetFold, 0, 0, 1, 0);
    }
    gl.uniform2f(rp.u.uPaper, PAPER[0], PAPER[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    inkCur = 1 - inkCur;
  }

  function fillInk(level) {
    clearTarget(gl, inkTargets[inkCur], level, 0, 0, 1);
    inkLevel = level;
  }

  function simulatePull(sheet, upto, speedAt, steps) {
    sheet.peel = 0;
    let sum = 0;
    let weight = 0;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      sheet.peel = upto * t;
      const f = transferStep(sheet, speedAt(t));
      sum += f;
      weight += 1;
    }
    sheet.lastPeel = sheet.peel;
    sheet.sum = sum;
    sheet.weight = weight;
  }

  function sheetToPrint(sheet, pose, fresh) {
    const other = sheet.maps[1 - sheet.cur];
    freeTarget(gl, other);
    const map = sheet.maps[sheet.cur];
    gl.deleteFramebuffer(map.fbo);
    const p = {
      tex: map.tex,
      flip: sheet.flip,
      x: pose.x,
      y: pose.y,
      a: pose.a,
      vx: 0,
      vy: 0,
      va: 0,
      lift: pose.lift ?? 0,
      vLift: 0,
      sag: pose.sag ?? 0,
      vSag: 0,
      pivot: pose.pivot ?? [0, 0],
      mode: "rest",
      fresh,
      rx: pose.x - layout.stack[0],
      ry: pose.y - layout.stack[1],
      ta: pose.a,
      quality: sheet.weight ? sheet.sum / sheet.weight : 0.8,
      ghost: sheet.startInk < 0.5,
    };
    prints.push(p);
    while (prints.length > MAX_PRINTS) {
      const old = prints.shift();
      gl.deleteTexture(old.tex);
    }
    return p;
  }

  function initScene() {
    placeLayout(layout.wide);
    for (const p of prints) gl.deleteTexture(p.tex);
    prints = [];
    if (active) {
      freeTarget(gl, active.maps[0]);
      freeTarget(gl, active.maps[1]);
    }
    active = null;
    grab = null;
    script = null;
    layTimer = -1;

    const fanned = [
      { speed: () => 0.5, ink: true, at: [0.13, 0.085, 0.075] },
      { speed: (t) => 1.9 + Math.sin(t * 17) * 0.6, ink: true, at: [-0.075, 0.03, -0.045] },
      { speed: () => 0.4, ink: false, at: [0.01, -0.03, 0.018] },
    ];
    for (const spec of fanned) {
      if (spec.ink) fillInk(0.97);
      const sheet = newSheet(true);
      setCorner(sheet, 1, -1, 1, -0.2);
      simulatePull(sheet, extentOf(sheet) + 0.06, spec.speed, 36);
      sheet.startInk = spec.ink ? 1 : 0.2;
      inkLevel *= 1 - (sheet.sum / sheet.weight) * 0.95;
      sheetToPrint(sheet, { x: layout.stack[0] + spec.at[0], y: layout.stack[1] + spec.at[1], a: spec.at[2] }, false);
      printCount += 1;
    }
    prints = [prints[2], prints[0], prints[1]];

    fillInk(0.97);
    const sheet = newSheet(true);
    setCorner(sheet, -1, -1, -1, -0.06);
    simulatePull(sheet, 0.72, () => 0.2, 40);
    sheet.peel = 0.72;
    sheet.lastPeel = 0.72;
    sheet.hold = 0;
    active = sheet;
    inkLevel = 0.97;

    brayer.x = layout.brayerHome.x;
    brayer.y = layout.brayerHome.y;
    brayer.a = layout.brayerHome.a;
    brayer.vx = 0;
    brayer.vy = 0;
    brayer.va = 0;
    brayer.travel = 0;
    report();
  }

  function phase() {
    if (script) return "busy";
    if (!active) return "bare";
    if (active.mode === "down") return "sheet";
    return "busy";
  }

  function report(message) {
    const ph = phase();
    if (ph !== lastPhase || message) {
      lastPhase = ph;
      onChange({ phase: ph, message });
    }
  }

  function layFresh() {
    if (active) return;
    const sheet = newSheet(true);
    sheet.mode = "falling";
    sheet.startInk = inkLevel;
    sheet.pose = { x: sheet.tx + 0.05, y: sheet.ty - 0.09, a: sheet.a0 - 0.04, vx: 0, vy: 0, va: 0, lift: 0.3, vLift: 0, sag: 0.05, vSag: 0 };
    active = sheet;
    report(inkLevel > 0.6 ? "A fresh sheet lies on the inked block." : "A fresh sheet lies on the block. It will print a ghost.");
    kick();
  }

  function stepFalling(sheet, dt) {
    const p = sheet.pose;
    const om = reduced ? 10 : 6.4;
    [p.lift, p.vLift] = crit(p.lift, p.vLift, 0, om, dt);
    [p.sag, p.vSag] = crit(p.sag, p.vSag, 0, om * 1.2, dt);
    [p.x, p.vx] = crit(p.x, p.vx, sheet.tx, om * 1.1, dt);
    [p.y, p.vy] = crit(p.y, p.vy, sheet.ty, om * 1.1, dt);
    [p.a, p.va] = crit(p.a, p.va, sheet.a0, om * 1.1, dt);
    if (p.lift < 0.002 && Math.abs(p.x - sheet.tx) < 0.002 && Math.abs(p.y - sheet.ty) < 0.002 && Math.abs(p.a - sheet.a0) < 0.003) {
      sheet.mode = "down";
      sheet.pose = null;
      setCorner(sheet, -1, -1);
      sheet.peel = 0;
      sheet.lastPeel = 0;
      report();
    }
    return true;
  }

  function stepSheet(sheet, dt) {
    const held = grab && grab.kind === "sheet" && grab.sheet === sheet;
    let busy = false;
    [sheet.hold, sheet.vHold] = crit(sheet.hold, sheet.vHold, held ? 1 : 0, held ? 16 : 7, dt);
    if (held) {
      const dx = pointer.x - grab.ox;
      const dy = pointer.y - grab.oy;
      let vx = sheet.cx - dx;
      let vy = sheet.cy - dy;
      const len = Math.hypot(vx, vy);
      let reach = 0;
      if (len > 0.002) {
        let ang = Math.atan2(vy, vx);
        const axis = Math.atan2(sheet.axisY, sheet.axisX);
        const off = clamp(angleDiff(ang, axis), -1.15, 1.15);
        ang = axis + off;
        const tnx = Math.cos(ang);
        const tny = Math.sin(ang);
        reach = Math.max(0, vx * tnx + vy * tny);
        const cur = Math.atan2(sheet.ny, sheet.nx);
        const next = cur + angleDiff(ang, cur) * (1 - Math.exp(-dt * (reduced ? 30 : 13) * smooth(0.0, 0.08, reach)));
        sheet.nx = Math.cos(next);
        sheet.ny = Math.sin(next);
      }
      const extHeld = extentOf(sheet);
      let want = solvePeel(reach, sheet.hold, extHeld);
      if (sheet.peel > extHeld * 0.62 && !sheet.freeing) {
        sheet.freeing = true;
        sheet.freeSpeed = sheet.speed;
      }
      if (sheet.freeing) {
        const run = Math.max(sheet.freeSpeed, 0.6);
        want = Math.max(want, sheet.peel + run * dt * 1.2);
      }
      [sheet.peel, sheet.vPeel] = crit(sheet.peel, sheet.vPeel, want, reduced ? 40 : 24, dt);
      busy = true;
      const extNow = extentOf(sheet);
      const r = radiusFor(sheet.peel, sheet.hold);
      if (sheet.peel > extNow + r * Math.PI + 0.012 && sheet.hold > 0.9) {
        detach(sheet);
        return true;
      }
    } else if (sheet.freeing) {
      const extFree = extentOf(sheet);
      [sheet.hold, sheet.vHold] = [Math.min(1, sheet.hold + dt * 6), 0];
      sheet.peel += Math.max(sheet.freeSpeed, 0.6) * dt * 1.2;
      busy = true;
      if (sheet.peel > extFree + radiusFor(sheet.peel, sheet.hold) * Math.PI + 0.012) {
        detach(sheet);
        return true;
      }
    } else {
      const want = sheet.peel < 0.12 ? (sheet.cornerX ? DOG : 0) : sheet.peel;
      [sheet.peel, sheet.vPeel] = crit(sheet.peel, sheet.vPeel, want, 8, dt);
      busy = Math.abs(sheet.vPeel) > 1e-4 || Math.abs(sheet.peel - want) > 1e-4 || Math.abs(sheet.hold) > 1e-3 || Math.abs(sheet.vHold) > 1e-3;
      if (!busy) {
        sheet.hold = 0;
        sheet.vHold = 0;
      }
    }
    const inst = Math.max(0, sheet.peel - sheet.lastPeel) / dt;
    sheet.speed += (inst - sheet.speed) * (1 - Math.exp(-dt / 0.05));
    const turned = Math.abs(sheet.nx - sheet.lastNx) + Math.abs(sheet.ny - sheet.lastNy);
    if (sheet.peel > sheet.lastPeel + 1e-5 || turned > 1e-4) {
      const f = transferStep(sheet, sheet.freeing ? sheet.freeSpeed : sheet.speed);
      const dp = Math.max(0, sheet.peel - sheet.lastPeel);
      sheet.sum += f * dp;
      sheet.weight += dp;
    }
    sheet.lastPeel = sheet.peel;
    sheet.lastNx = sheet.nx;
    sheet.lastNy = sheet.ny;
    return busy;
  }

  function detach(sheet) {
    const r = radiusFor(sheet.peel, sheet.hold);
    const nx = sheet.nx;
    const ny = sheet.ny;
    const fold = foldOf(sheet);
    const fx = fold[0] + nx * (Math.PI * r) * 0.5;
    const fy = fold[1] + ny * (Math.PI * r) * 0.5;
    const d = fx * nx + fy * ny;
    const m00 = 1 - 2 * nx * nx;
    const m01 = -2 * nx * ny;
    const m11 = 1 - 2 * ny * ny;
    const c = Math.cos(sheet.a0);
    const s = Math.sin(sheet.a0);
    const l10 = m01 * c + m11 * s;
    const l11 = m01 * -s + m11 * c;
    const alpha = Math.atan2(-l10, l11);
    const tx = m00 * sheet.tx + m01 * sheet.ty + 2 * nx * d;
    const ty = m01 * sheet.tx + m11 * sheet.ty + 2 * ny * d;
    const pivotLocal = [(sheet.cornerX * PAPER[0]) / 2, (sheet.cornerY * PAPER[1]) / 2];
    const sheetStartInk = sheet.startInk;
    const print = sheetToPrint(sheet, { x: tx, y: ty, a: alpha, lift: 2 * r, pivot: pivotLocal }, true);
    print.ghost = sheetStartInk < 0.5;
    inkLevel *= 1 - clamp(sheet.weight ? sheet.sum / sheet.weight : 0.8, 0, 1) * 0.95;
    active = null;
    const held = grab && grab.kind === "sheet";
    if (held) {
      const pw = applyPose({ x: tx, y: ty, a: alpha, mirror: true }, pivotLocal[0], pivotLocal[1]);
      grab = { kind: "print", print, lx: pivotLocal[0], ly: pivotLocal[1], ox: pointer.x - pw[0], oy: pointer.y - pw[1], id: grab.id };
      print.mode = "carried";
    } else {
      print.lift = Math.max(print.lift, 0.06);
      releasePrint(print);
      print.vx = -sheet.nx * 0.6;
      print.vy = -sheet.ny * 0.6;
    }
    print.vLift = 0;
    report();
  }

  function slotFor(print) {
    const jx = (rand() - 0.5) * 0.05;
    const jy = (rand() - 0.5) * 0.05;
    const ta = (rand() - 0.5) * 0.09;
    print.rx = jx;
    print.ry = jy;
    print.ta = print.a + angleDiff(ta, print.a);
  }

  function releasePrint(print) {
    const sp = Math.hypot(pointer.vx, pointer.vy);
    const cap = sp > 3.2 ? 3.2 / sp : 1;
    print.vx = pointer.vx * cap;
    print.vy = pointer.vy * cap;
    if (print.fresh) {
      print.vx *= 0.55;
      print.vy *= 0.55;
      print.mode = "glide";
      print.fresh = false;
      slotFor(print);
      printCount += 1;
      const q = print.quality;
      const kind = print.ghost ? "a ghost" : q > 0.62 ? "rich and solid" : q > 0.45 ? "even, a little salty" : "starved and speckled";
      report(`Print ${printCount} pulled, ${kind}.`);
    } else {
      print.mode = "slide";
    }
  }

  function stepPrint(p, dt) {
    if (p.mode === "rest") return false;
    if (p.mode === "carried") {
      const c = Math.cos(p.a);
      const s = Math.sin(p.a);
      const lx = -p.pivot[0];
      const ly = p.pivot[1];
      const wantPx = pointer.x - grab.ox;
      const wantPy = pointer.y - grab.oy;
      if (!reduced) {
        const cxv = -(c * lx - s * ly);
        const cyv = -(s * lx + c * ly);
        const cl = Math.hypot(cxv, cyv);
        const sp = Math.hypot(pointer.vx, pointer.vy);
        if (cl > 0.05 && sp > 0.05) {
          const tx = -pointer.vx / sp;
          const ty = -pointer.vy / sp;
          const cross = (cxv / cl) * ty - (cyv / cl) * tx;
          const torque = cross * Math.min(sp, 2.2) * 2.6;
          p.va += (torque - p.va * 9) * dt;
        } else p.va *= Math.exp(-dt * 9);
        p.a += p.va * dt;
      }
      const c2 = Math.cos(p.a);
      const s2 = Math.sin(p.a);
      const tx = wantPx - (c2 * lx - s2 * ly);
      const ty = wantPy - (s2 * lx + c2 * ly);
      [p.x, p.vx] = crit(p.x, p.vx, tx, 34, dt);
      [p.y, p.vy] = crit(p.y, p.vy, ty, 34, dt);
      const maxD = Math.hypot(PAPER[0], PAPER[1]);
      [p.lift, p.vLift] = crit(p.lift, p.vLift, 0.1, 9, dt);
      [p.sag, p.vSag] = crit(p.sag, p.vSag, -(0.08 / (maxD * maxD)), 8, dt);
      return true;
    }
    if (p.mode === "glide") {
      const om = reduced ? 9 : 4.8;
      [p.x, p.vx] = crit(p.x, p.vx, layout.stack[0] + p.rx, om, dt);
      [p.y, p.vy] = crit(p.y, p.vy, layout.stack[1] + p.ry, om, dt);
      [p.a, p.va] = crit(p.a, p.va, p.ta, om, dt);
      [p.lift, p.vLift] = crit(p.lift, p.vLift, 0, om * 1.1, dt);
      [p.sag, p.vSag] = crit(p.sag, p.vSag, 0, om * 1.1, dt);
      const done =
        Math.abs(p.x - layout.stack[0] - p.rx) < 3e-4 &&
        Math.abs(p.y - layout.stack[1] - p.ry) < 3e-4 &&
        p.lift < 3e-4 &&
        Math.hypot(p.vx, p.vy) < 2e-3;
      if (done) {
        p.mode = "rest";
        p.lift = 0;
        p.sag = 0;
      }
      return true;
    }
    if (p.mode === "slide") {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const fr = Math.exp(-dt * 5.5);
      p.vx *= fr;
      p.vy *= fr;
      p.a += p.va * dt;
      p.va *= Math.exp(-dt * 6);
      [p.lift, p.vLift] = crit(p.lift, p.vLift, 0, 7, dt);
      [p.sag, p.vSag] = crit(p.sag, p.vSag, 0, 7, dt);
      const b = viewBounds();
      const minX = b.minX + 0.2;
      const maxX = b.maxX - 0.2;
      const minY = b.minY + 0.2;
      const maxY = b.maxY - 0.1;
      if (p.x < minX) p.vx += (minX - p.x) * 40 * dt;
      if (p.x > maxX) p.vx += (maxX - p.x) * 40 * dt;
      if (p.y < minY) p.vy += (minY - p.y) * 40 * dt;
      if (p.y > maxY) p.vy += (maxY - p.y) * 40 * dt;
      if (Math.hypot(p.vx, p.vy) < 0.002 && p.lift < 3e-4 && Math.abs(p.va) < 0.002) {
        p.mode = "rest";
        p.lift = 0;
        p.sag = 0;
        p.rx = p.x - layout.stack[0];
        p.ry = p.y - layout.stack[1];
      }
      return true;
    }
    return false;
  }

  function brayerPose() {
    const c = Math.cos(brayer.a);
    const s = Math.sin(brayer.a);
    return new Float32Array([c, s, 0, -s, c, 0, brayer.x, brayer.y, 1]);
  }

  function brayerLocal(wx, wy) {
    const c = Math.cos(brayer.a);
    const s = Math.sin(brayer.a);
    const dx = wx - brayer.x;
    const dy = wy - brayer.y;
    return [c * dx + s * dy, -s * dx + c * dy];
  }

  function stepBrayer(dt) {
    const held = grab && grab.kind === "brayer";
    const px = brayer.x;
    const py = brayer.y;
    const pa = brayer.a;
    if (held) {
      const sp = Math.hypot(pointer.vx, pointer.vy);
      if (sp > 0.12) {
        const want = Math.atan2(pointer.vy, pointer.vx) + Math.PI / 2;
        let d = angleDiff(want, brayer.a);
        if (d > Math.PI / 2) d -= Math.PI;
        if (d < -Math.PI / 2) d += Math.PI;
        brayer.a += d * (1 - Math.exp(-dt * (reduced ? 2 : 3.2) * Math.min(sp, 1.6)));
      }
      const c = Math.cos(brayer.a);
      const s = Math.sin(brayer.a);
      const tx = pointer.x - (c * brayer.gx - s * brayer.gy);
      const ty = pointer.y - (s * brayer.gx + c * brayer.gy);
      [brayer.x, brayer.vx] = crit(brayer.x, brayer.vx, tx, 40, dt);
      [brayer.y, brayer.vy] = crit(brayer.y, brayer.vy, ty, 40, dt);
    } else {
      const home = layout.brayerHome;
      const om = reduced ? 10 : 6.2;
      [brayer.x, brayer.vx] = crit(brayer.x, brayer.vx, home.x, om, dt);
      [brayer.y, brayer.vy] = crit(brayer.y, brayer.vy, home.y, om, dt);
      const ta = brayer.a + angleDiff(home.a, brayer.a);
      [brayer.a, brayer.va] = crit(brayer.a, brayer.va, ta, om, dt);
    }
    const mx = brayer.x - px;
    const my = brayer.y - py;
    brayer.spin += -mx * Math.sin(brayer.a) + my * Math.cos(brayer.a);
    if (held) {
      const overX = Math.abs(brayer.x - BLOCK.x) < BLOCK.w / 2 + ROLLER[0];
      const overY = Math.abs(brayer.y - BLOCK.y) < BLOCK.h / 2 + ROLLER[0];
      const moved = Math.hypot(mx, my);
      if (overX && overY && moved > 1e-5) {
        rollStep(px, py, pa, brayer.x, brayer.y, brayer.a);
        const inside = Math.abs(brayer.x - BLOCK.x) < BLOCK.w / 2 && Math.abs(brayer.y - BLOCK.y) < BLOCK.h / 2;
        if (inside) {
          brayer.travel += moved;
          inkLevel = Math.min(0.97, inkLevel + moved * 0.9);
        }
      }
    }
    const settled =
      !held &&
      Math.abs(brayer.vx) < 1e-4 &&
      Math.abs(brayer.vy) < 1e-4 &&
      Math.abs(brayer.va) < 1e-4 &&
      Math.abs(brayer.x - layout.brayerHome.x) < 1e-4 &&
      Math.abs(brayer.y - layout.brayerHome.y) < 1e-4;
    if (settled) {
      brayer.x = layout.brayerHome.x;
      brayer.y = layout.brayerHome.y;
      brayer.vx = 0;
      brayer.vy = 0;
      brayer.va = 0;
    }
    return !settled;
  }

  function stepScript(dt) {
    if (!script) return false;
    script.t += dt;
    const pts = script.points;
    let i = 0;
    while (i < pts.length - 1 && script.t > pts[i + 1].t) i += 1;
    if (i >= pts.length - 1) {
      pointer.x = pts[pts.length - 1].x;
      pointer.y = pts[pts.length - 1].y;
      const done = script;
      script = null;
      if (grab && grab.id === "script") endGrab();
      done.after?.();
      report();
      return true;
    }
    const a = pts[i];
    const b = pts[i + 1];
    const u = smooth(0, 1, (script.t - a.t) / Math.max(1e-3, b.t - a.t));
    const e = b.ease === "linear" ? (script.t - a.t) / Math.max(1e-3, b.t - a.t) : u;
    pointer.x = a.x + (b.x - a.x) * e;
    pointer.y = a.y + (b.y - a.y) * e;
    return true;
  }

  function measurePointer(dt) {
    const ivx = (pointer.x - pointer.px) / dt;
    const ivy = (pointer.y - pointer.py) / dt;
    const k = 1 - Math.exp(-dt / 0.035);
    pointer.vx += (ivx - pointer.vx) * k;
    pointer.vy += (ivy - pointer.vy) * k;
    pointer.px = pointer.x;
    pointer.py = pointer.y;
  }

  function step(dt) {
    let busy = false;
    if (stepScript(dt)) busy = true;
    measurePointer(dt);
    if (grab || Math.hypot(pointer.vx, pointer.vy) > 1e-3) busy = true;
    if (active) {
      if (active.mode === "falling") busy = stepFalling(active, dt) || busy;
      else if (active.mode === "down") busy = stepSheet(active, dt) || busy;
    }
    for (const p of prints) if (stepPrint(p, dt)) busy = true;
    if (stepBrayer(dt)) busy = true;
    if (layTimer >= 0) {
      layTimer -= dt;
      busy = true;
      if (layTimer < 0) {
        layTimer = -1;
        layFresh();
      }
    }
    return busy;
  }

  function sheetUniforms(prog, cfg) {
    gl.uniform2f(prog.u.uPaper, PAPER[0], PAPER[1]);
    gl.uniformMatrix3fv(prog.u.uRest, false, cfg.rest);
    gl.uniform4f(prog.u.uFold, cfg.fold[0], cfg.fold[1], cfg.fold[2], cfg.fold[3]);
    gl.uniform4f(prog.u.uCurl, cfg.curl[0], cfg.curl[1], cfg.curl[2], cfg.curl[3]);
    gl.uniform2f(prog.u.uPivot, cfg.pivot[0], cfg.pivot[1]);
    gl.uniformMatrix3fv(prog.u.uView, false, view.toClip);
    gl.uniform3f(prog.u.uCam, view.cam[0], view.cam[1], CAM_Z);
    gl.uniform1f(prog.u.uFace, cfg.face);
    blockUniform(prog);
    if (prog.u.uFlip) gl.uniform2f(prog.u.uFlip, cfg.flip[0], cfg.flip[1]);
  }

  const NO_FOLD = [1e4, 0, 1, 0];

  function activeCfg(sheet) {
    if (sheet.mode === "falling") {
      const p = sheet.pose;
      return {
        rest: restMatrix(p.x, p.y, p.a, false),
        fold: NO_FOLD,
        curl: [0.01, 0, p.lift, p.sag],
        pivot: [0, 0],
        face: 1,
        flip: sheet.flip,
        contact: 1 - smooth(0, 0.03, p.lift),
        tex: sheet.maps[sheet.cur].tex,
        lift: p.lift,
      };
    }
    const ext = extentOf(sheet);
    const fold = foldOf(sheet);
    return {
      rest: restMatrix(sheet.tx, sheet.ty, sheet.a0, false),
      fold: [fold[0], fold[1], sheet.nx, sheet.ny],
      curl: [radiusFor(sheet.peel, sheet.hold), phiFor(sheet.peel, sheet.hold, ext), 0, 0],
      pivot: [0, 0],
      face: 1,
      flip: sheet.flip,
      contact: 1,
      tex: sheet.maps[sheet.cur].tex,
      lift: 0,
    };
  }

  function printCfg(p) {
    return {
      rest: restMatrix(p.x, p.y, p.a, true),
      fold: NO_FOLD,
      curl: [0.01, 0, p.lift, p.sag],
      pivot: p.pivot,
      face: -1,
      flip: p.flip,
      contact: 0,
      tex: p.tex,
      lift: p.lift,
    };
  }

  function drawSkirt(cfg) {
    const sp = progs.skirt;
    gl.useProgram(sp.program);
    bindQuad();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform2f(sp.u.uPaper, PAPER[0], PAPER[1]);
    gl.uniformMatrix3fv(sp.u.uRest, false, cfg.rest);
    gl.uniformMatrix3fv(sp.u.uView, false, view.toClip);
    const lift = Math.max(0, cfg.lift);
    const h = lift + 0.006;
    gl.uniform4f(sp.u.uSkirt, LIGHT_SHIFT[0] * h, LIGHT_SHIFT[1] * h, 0.006 + lift * 0.45, 0.06 + lift * 0.6);
    gl.uniform2f(sp.u.uShade, 0.13 * (1 - smooth(0.05, 0.4, lift) * 0.45), 0.12 * (1 - smooth(0, 0.02, lift)));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function drawSheet(cfg, shadowOn, part = 0) {
    const sp = progs.sheet;
    gl.useProgram(sp.program);
    sheetUniforms(sp, cfg);
    gl.uniform4f(sp.u.uShadowMode, 0, 0, 0, 0);
    bindTex(0, fibreTex, sp, "uFibre");
    bindTex(1, cfg.tex, sp, "uPrint");
    bindTex(2, heightTex, sp, "uHeight");
    bindTex(3, inkTargets[inkCur].tex, sp, "uInk");
    bindTex(4, shadowA.tex, sp, "uShadow");
    gl.uniform2f(sp.u.uPrintTexel, 1 / PAPER_PX[0], 1 / PAPER_PX[1]);
    gl.uniform1f(sp.u.uContact, cfg.contact);
    gl.uniform2f(sp.u.uRes, canvas.width, canvas.height);
    gl.uniform1f(sp.u.uShadowOn, shadowOn ? 1 : 0);
    gl.uniform1f(sp.u.uPart, part);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  }

  function drawBrayer() {
    const bp = progs.brayer;
    gl.useProgram(bp.program);
    bindQuad();
    gl.uniformMatrix3fv(bp.u.uPose, false, brayerPose());
    gl.uniformMatrix3fv(bp.u.uView, false, view.toClip);
    gl.uniform3f(bp.u.uCam, view.cam[0], view.cam[1], CAM_Z);
    gl.uniform1f(bp.u.uLift, 0);
    gl.uniform2f(bp.u.uRoller, ROLLER[0], ROLLER[1]);
    gl.uniform1f(bp.u.uSpin, brayer.spin);
    gl.uniform1f(bp.u.uAngle, brayer.a);
    gl.uniform1f(bp.u.uPx, 1 / view.k);
    gl.enable(gl.BLEND);
    gl.uniform1f(bp.u.uShadow, 1);
    gl.uniform4f(bp.u.uBox, -0.47, -0.14, 0.47, 0.53);
    gl.uniform2f(bp.u.uOffset, LIGHT_SHIFT[0] * 0.07, LIGHT_SHIFT[1] * 0.07);
    gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.uniform1f(bp.u.uShadow, 0);
    gl.uniform4f(bp.u.uBox, -0.42, -0.08, 0.42, 0.48);
    gl.uniform2f(bp.u.uOffset, 0, 0);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function render() {
    if (gl.isContextLost() || !shadowA) return;
    const downSheet = active && active.mode === "down" ? active : null;
    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowA.fbo);
    gl.viewport(0, 0, shadowA.w, shadowA.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (downSheet) {
      const cfg = activeCfg(downSheet);
      const sp = progs.shadow;
      gl.useProgram(sp.program);
      sheetUniforms(sp, cfg);
      gl.uniform4f(sp.u.uShadowMode, LIGHT_SHIFT[0], LIGHT_SHIFT[1], 1, 0);
      bindTex(0, fibreTex, sp, "uFibre");
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
      gl.blendEquation(gl.FUNC_ADD);
      gl.disable(gl.BLEND);
      const bp = progs.blur;
      gl.useProgram(bp.program);
      bindQuad();
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(bp.u.uSrc, 0);
      for (let pass = 0; pass < 2; pass += 1) {
        const spread = pass === 0 ? 1 : 0.6;
        gl.bindFramebuffer(gl.FRAMEBUFFER, shadowB.fbo);
        gl.bindTexture(gl.TEXTURE_2D, shadowA.tex);
        gl.uniform2f(bp.u.uStep, spread / shadowA.w, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, shadowA.fbo);
        gl.bindTexture(gl.TEXTURE_2D, shadowB.tex);
        gl.uniform2f(bp.u.uStep, 0, spread / shadowA.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(BENCH[0], BENCH[1], BENCH[2], 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    const sc = progs.scene;
    gl.useProgram(sc.program);
    bindQuad();
    gl.uniformMatrix3fv(sc.u.uClipToWorld, false, view.fromClip);
    bindTex(0, heightTex, sc, "uHeight");
    bindTex(1, inkTargets[inkCur].tex, sc, "uInk");
    bindTex(2, shadowA.tex, sc, "uShadow");
    blockUniform(sc);
    gl.uniform2f(sc.u.uTexel, 1 / BLOCK_W, 1 / BLOCK_H);
    gl.uniform2f(sc.u.uRes, canvas.width, canvas.height);
    gl.uniform1f(sc.u.uPx, 1 / view.k);
    gl.uniform3f(sc.u.uBench, BENCH[0], BENCH[1], BENCH[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const low = [];
    const high = [];
    for (const p of prints) (p.mode === "rest" || p.lift < 0.004 ? low : high).push(p);
    for (const p of low) {
      const cfg = printCfg(p);
      drawSkirt(cfg);
      drawSheet(cfg, false);
    }
    const brayerHeld = grab && grab.kind === "brayer";
    if (!brayerHeld) drawBrayer();
    if (active) {
      const cfg = activeCfg(active);
      if (active.mode === "falling") {
        drawSkirt(cfg);
        drawSheet(cfg, false);
      } else {
        drawSheet(cfg, true, -1);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        drawSheet(cfg, true, 1);
        gl.disable(gl.DEPTH_TEST);
      }
    }
    for (const p of high) {
      const cfg = printCfg(p);
      drawSkirt(cfg);
      drawSheet(cfg, false);
    }
    if (brayerHeld) drawBrayer();
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  function frame(now) {
    raf = 0;
    if (destroyed) return;
    const gap = last ? now - last : 0;
    const dt = last ? Math.min(1 / 30, Math.max(1 / 240, gap / 1000)) : 1 / 60;
    last = now;
    const busy = step(dt);
    render();
    govern(gap);
    if (busy) kick();
    else last = 0;
  }

  function govern(gap) {
    if (gap <= 0) return;
    slow.push(gap);
    if (slow.length < 12) return;
    const median = [...slow].sort((x, y) => x - y)[slow.length >> 1];
    slow.length = 0;
    if (median > 45 && quality > 0.5) {
      quality = Math.max(0.5, quality * 0.75);
      fit();
      render();
    } else if (median < 22 && quality < 1) {
      quality = Math.min(1, quality / 0.75);
      fit();
      render();
    }
  }

  function kick() {
    if (destroyed || raf || !visible || document.hidden) return;
    raf = requestAnimationFrame(frame);
  }

  function hitFlap(sheet, wx, wy) {
    if (sheet.peel < 0.01) return false;
    const ext = extentOf(sheet);
    const r = radiusFor(sheet.peel, sheet.hold);
    const phi = phiFor(sheet.peel, sheet.hold, ext);
    const fold = foldOf(sheet);
    const nx = sheet.nx;
    const ny = sheet.ny;
    const mx = -ny;
    const my = nx;
    const along = (wx - fold[0]) * nx + (wy - fold[1]) * ny;
    const t = (wx - fold[0]) * mx + (wy - fold[1]) * my;
    const cp = Math.cos(phi);
    if (Math.abs(cp) < 0.05) return false;
    const s = r * phi + (along - r * Math.sin(phi)) / cp;
    if (s < -0.02 || s > sheet.peel + 0.03) return false;
    const rx = fold[0] + nx * s + mx * t;
    const ry = fold[1] + ny * s + my * t;
    const l = invertPose({ x: sheet.tx, y: sheet.ty, a: sheet.a0, mirror: false }, rx, ry);
    return insidePaper(l[0], l[1], 0.03);
  }

  function hitBrayer(wx, wy) {
    const [lx, ly] = brayerLocal(wx, wy);
    if (Math.abs(lx) < ROLLER[0] + 0.04 && Math.abs(ly) < ROLLER[1] + 0.03) return [lx, ly];
    if (Math.abs(lx) < 0.07 && ly > 0.12 && ly < 0.48) return [lx, ly];
    if (ly > -0.01 && ly < 0.2 && Math.abs(lx) < ROLLER[0] + 0.04) {
      const t = clamp((ly - 0.06) / 0.11, 0, 1);
      const armX = ROLLER[0] + 0.014 + (0.035 - ROLLER[0] - 0.014) * t;
      if (Math.abs(Math.abs(lx) - armX) < 0.04) return [lx, ly];
    }
    return null;
  }

  function hitTest(wx, wy) {
    const bl = hitBrayer(wx, wy);
    if (bl) return { kind: "brayer", lx: bl[0], ly: bl[1] };
    for (let i = prints.length - 1; i >= 0; i -= 1) {
      const p = prints[i];
      if (p.mode === "rest" || p.lift < 0.004) continue;
      const l = invertPose({ x: p.x, y: p.y, a: p.a, mirror: true }, wx, wy);
      if (insidePaper(l[0], l[1], 0.02)) return { kind: "print", print: p, lx: l[0], ly: l[1] };
    }
    if (active && active.mode === "down") {
      if (hitFlap(active, wx, wy)) return { kind: "sheet", flap: true };
      const l = invertPose({ x: active.tx, y: active.ty, a: active.a0, mirror: false }, wx, wy);
      const fold = foldOf(active);
      const s = (wx - fold[0]) * active.nx + (wy - fold[1]) * active.ny;
      if (insidePaper(l[0], l[1], 0.03) && s <= 0.02) return { kind: "sheet", flap: false, lx: l[0], ly: l[1] };
    }
    for (let i = prints.length - 1; i >= 0; i -= 1) {
      const p = prints[i];
      const l = invertPose({ x: p.x, y: p.y, a: p.a, mirror: true }, wx, wy);
      if (insidePaper(l[0], l[1], 0.01)) return { kind: "print", print: p, lx: l[0], ly: l[1] };
    }
    if (!active && Math.abs(wx - BLOCK.x) < BLOCK.w / 2 + 0.05 && Math.abs(wy - BLOCK.y) < BLOCK.h / 2 + 0.05) return { kind: "block" };
    return null;
  }

  function beginGrab(hit, id) {
    if (hit.kind === "brayer") {
      grab = { kind: "brayer", id };
      brayer.gx = hit.lx;
      brayer.gy = hit.ly;
      brayer.va = 0;
      brayer.travel = 0;
      layTimer = -1;
      return true;
    }
    if (hit.kind === "sheet") {
      const sheet = active;
      if (!hit.flap && sheet.peel < 0.14) {
        const sx = hit.lx >= 0 ? 1 : -1;
        const sy = hit.ly >= 0 ? 1 : -1;
        if (sx !== sheet.cornerX || sy !== sheet.cornerY) {
          setCorner(sheet, sx, sy);
          sheet.peel = 0;
          sheet.vPeel = 0;
          sheet.lastPeel = 0;
        }
      }
      sheet.axisX = sheet.nx;
      sheet.axisY = sheet.ny;
      const tip = tipOf(sheet);
      grab = { kind: "sheet", sheet, ox: pointer.x - tip[0], oy: pointer.y - tip[1], id };
      if (hit.flap) {
        grab.ox *= 0.5;
        grab.oy *= 0.5;
      }
      return true;
    }
    if (hit.kind === "print") {
      const p = hit.print;
      const i = prints.indexOf(p);
      if (i >= 0) {
        prints.splice(i, 1);
        prints.push(p);
      }
      p.pivot = [hit.lx, hit.ly];
      const pw = applyPose({ x: p.x, y: p.y, a: p.a, mirror: true }, hit.lx, hit.ly);
      grab = { kind: "print", print: p, ox: pointer.x - pw[0], oy: pointer.y - pw[1], id };
      p.mode = "carried";
      return true;
    }
    if (hit.kind === "block") {
      grab = { kind: "block", id };
      return true;
    }
    return false;
  }

  function endGrab() {
    if (!grab) return;
    const g = grab;
    grab = null;
    if (g.kind === "print") releasePrint(g.print);
    if (g.kind === "brayer") {
      if (brayer.travel > 0.6 && !active) layTimer = reduced ? 0.25 : 0.7;
    }
    if (g.kind === "block" && pointer.moved < 0.03 && !active) layFresh();
    setCursor();
    report();
    kick();
  }

  function setCursor(hover) {
    if (grab) canvas.style.cursor = grab.kind === "block" ? "default" : "grabbing";
    else canvas.style.cursor = hover ? (hover.kind === "block" ? "pointer" : "grab") : "default";
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (script) {
      script = null;
      if (grab) endGrab();
    }
    const [x, y] = toWorld(event.clientX, event.clientY);
    pointer.x = x;
    pointer.y = y;
    pointer.px = x;
    pointer.py = y;
    pointer.vx = 0;
    pointer.vy = 0;
    pointer.sx = x;
    pointer.sy = y;
    pointer.moved = 0;
    const hit = hitTest(x, y);
    if (!hit) return;
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {}
    beginGrab(hit, event.pointerId);
    setCursor();
    kick();
  }

  function onPointerMove(event) {
    const [x, y] = toWorld(event.clientX, event.clientY);
    pointer.x = x;
    pointer.y = y;
    if (grab) {
      pointer.moved = Math.max(pointer.moved, Math.hypot(x - pointer.sx, y - pointer.sy));
      kick();
      return;
    }
    if (event.pointerType === "touch") return;
    pointer.px = x;
    pointer.py = y;
    setCursor(hitTest(x, y));
  }

  function onPointerUp(event) {
    if (!grab || grab.id !== event.pointerId) return;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {}
    endGrab();
  }

  function onTouchStart(event) {
    const t = event.touches[0];
    if (!t) return;
    const [x, y] = toWorld(t.clientX, t.clientY);
    if (hitTest(x, y)) event.preventDefault();
  }

  const onVisibility = () => {
    if (!document.hidden) kick();
  };
  const onReduced = () => {
    reduced = reducedQuery.matches;
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  document.addEventListener("visibilitychange", onVisibility);
  reducedQuery.addEventListener("change", onReduced);
  const resizeObserver = new ResizeObserver(() => {
    fit();
    render();
  });
  resizeObserver.observe(stage);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) kick();
  });
  io.observe(stage);

  fit();
  initScene();
  render();

  function scriptPull(fast) {
    const sheet = active;
    const tip = tipOf(sheet);
    const ext = extentOf(sheet);
    const dist = ext * 2 + 0.25;
    const end = layout.wide ? [tip[0] - sheet.nx * dist, tip[1] - sheet.ny * dist] : [0.8, 1.7];
    const dur = reduced ? (fast ? 0.4 : 1.2) : fast ? 0.5 : 3.4;
    const start = [tip[0], tip[1]];
    pointer.x = start[0];
    pointer.y = start[1];
    pointer.px = start[0];
    pointer.py = start[1];
    pointer.vx = 0;
    pointer.vy = 0;
    sheet.axisX = sheet.nx;
    sheet.axisY = sheet.ny;
    grab = { kind: "sheet", sheet, ox: 0, oy: 0, id: "script" };
    const stack = layout.stack;
    script = {
      t: 0,
      points: [
        { x: start[0], y: start[1], t: 0 },
        { x: end[0], y: end[1], t: dur, ease: fast ? "linear" : "smooth" },
        { x: (end[0] + stack[0]) / 2, y: (end[1] + stack[1]) / 2 - 0.2, t: dur + 0.45 },
      ],
    };
  }

  function scriptInk() {
    const home = layout.brayerHome;
    const c = Math.cos(home.a);
    const s = Math.sin(home.a);
    const gx = 0;
    const gy = 0.33;
    const hx = home.x + (c * gx - s * gy);
    const hy = home.y + (s * gx + c * gy);
    pointer.x = hx;
    pointer.y = hy;
    pointer.px = hx;
    pointer.py = hy;
    pointer.vx = 0;
    pointer.vy = 0;
    beginGrab({ kind: "brayer", lx: gx, ly: gy }, "script");
    const top = BLOCK.y - BLOCK.h / 2 + 0.1 + gy;
    const bottom = BLOCK.y + BLOCK.h / 2 - 0.08 + gy;
    const speed = reduced ? 0.4 : 1;
    script = {
      t: 0,
      points: [
        { x: hx, y: hy, t: 0 },
        { x: BLOCK.x - 0.18, y: top, t: 0.55 * speed },
        { x: BLOCK.x - 0.18, y: bottom, t: 1.25 * speed },
        { x: BLOCK.x + 0.16, y: top, t: 1.95 * speed },
        { x: BLOCK.x + 0.16, y: bottom, t: 2.65 * speed },
      ],
    };
  }

  return {
    keyAction(fast) {
      if (script || grab) return;
      if (active && active.mode === "down") scriptPull(fast);
      else if (!active) scriptInk();
      else return;
      report();
      kick();
    },
    keyCancel() {
      if (!script) return false;
      script = null;
      if (grab) endGrab();
      return true;
    },
    blur() {
      if (grab && grab.id === "script") return;
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("visibilitychange", onVisibility);
      reducedQuery.removeEventListener("change", onReduced);
      resizeObserver.disconnect();
      io.disconnect();
      for (const p of prints) gl.deleteTexture(p.tex);
      if (active) {
        freeTarget(gl, active.maps[0]);
        freeTarget(gl, active.maps[1]);
      }
      freeTarget(gl, inkTargets[0]);
      freeTarget(gl, inkTargets[1]);
      freeTarget(gl, shadowA);
      freeTarget(gl, shadowB);
      gl.deleteTexture(heightTex);
      gl.deleteTexture(fibreTex);
      for (const p of Object.values(progs)) gl.deleteProgram(p.program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
