import { BLUR_FS, BLUR_VS, RESIDUE_FS, RESIDUE_VS, SCENE_FS, SCENE_VS, SHADOW_FS, STICKER_FS, STICKER_VS, STRAND_FS, STRAND_VS } from "./peelShader";
import { SLEEVE_PHOTO, STICKERS, loadImage, readyFonts, shapeContains, sleeveArt, stickerArt } from "./peelArt";

const ROT = -0.026;
const DISC = [0.15, 0.004, 0.486];
const VIEW = { minX: -0.56, maxX: 0.69, minY: -0.55, maxY: 0.56 };
const MASK_MIN = -0.9;
const MASK_SIZE = 1.8;
const MASK_PX = 1024;
const CAM_Z = 3.4;
const GRID = 56;
const LIGHT_SHIFT = [0.3, 0.48];
const PHI_IN = 0.8 * Math.PI;
const PHI_OUT = 0.56 * Math.PI;
const PHI_HELD = 0.3 * Math.PI;
const PRESS_PEEL = 0.02;
const HOVER_PEEL = 0.014;
const HELD_LIFT = 0.05;
const NODES = 12;
const MAX_PARTS = 40;
const GROUND = [0.945, 0.957, 0.969];
const TAU = Math.PI * 2;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angleDiff = (a, b) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
const radiusFor = (peel) => Math.min(0.026, 0.008 + 0.2 * Math.max(0, peel));

function tipOffset(peel, phi) {
  const r = radiusFor(peel);
  if (peel <= 0) return 0;
  if (peel < r * phi) return peel - r * Math.sin(peel / r);
  return peel - r * Math.sin(phi) - (peel - r * phi) * Math.cos(phi);
}

function solvePeel(reach, phi) {
  if (reach <= 0) return 0;
  let lo = 0;
  let hi = 3;
  for (let i = 0; i < 28; i += 1) {
    const mid = (lo + hi) / 2;
    if (tipOffset(mid, phi) < reach) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function curlPoint(st, fx, fy, out) {
  const s = (fx - st.p0x) * st.dx + (fy - st.p0y) * st.dy;
  const sigma = st.peel - s;
  out.x = fx;
  out.y = fy;
  out.z = st.lift;
  if (sigma <= 0) return out;
  const r = radiusFor(st.peel);
  const arc = r * st.phi;
  let t;
  let z;
  if (sigma < arc) {
    const th = sigma / r;
    t = st.peel - r * Math.sin(th);
    z = r * (1 - Math.cos(th));
  } else {
    const rest = sigma - arc;
    t = st.peel - r * Math.sin(st.phi) - rest * Math.cos(st.phi);
    z = r * (1 - Math.cos(st.phi)) + rest * Math.sin(st.phi);
  }
  out.x = fx + st.dx * (t - s);
  out.y = fy + st.dy * (t - s);
  out.z = z + st.lift;
  return out;
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
  gl.bindAttribLocation(program, 0, "aUv");
  gl.bindAttribLocation(program, 0, "aPos");
  gl.bindAttribLocation(program, 1, "aAcross");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link");
  gl.deleteShader(v);
  gl.deleteShader(f);
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i += 1) {
    const info = gl.getActiveUniform(program, i);
    uniforms[info.name] = gl.getUniformLocation(program, info.name);
  }
  return { program, u: uniforms };
}

function texture(gl, source, mip) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
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

function gridMesh(gl) {
  const verts = new Float32Array((GRID + 1) * (GRID + 1) * 2);
  let k = 0;
  for (let j = 0; j <= GRID; j += 1) {
    for (let i = 0; i <= GRID; i += 1) {
      verts[k++] = i / GRID;
      verts[k++] = j / GRID;
    }
  }
  const idx = new Uint16Array(GRID * GRID * 6);
  k = 0;
  for (let j = 0; j < GRID; j += 1) {
    for (let i = 0; i < GRID; i += 1) {
      const a = j * (GRID + 1) + i;
      const b = a + 1;
      const c = a + GRID + 1;
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

function makeSticker(def, index) {
  return {
    def,
    index,
    layer: index,
    ox: def.x,
    oy: def.y,
    ang: def.angle,
    p0x: def.x,
    p0y: def.y,
    nx: 1,
    ny: 0,
    dirA: 0,
    dirT: 0,
    dx: 1,
    dy: 0,
    peel: 0,
    peelV: 0,
    peelT: 0,
    phi: PHI_IN,
    phiV: 0,
    phiT: PHI_IN,
    lift: 0,
    liftV: 0,
    liftT: 0,
    rest: 0,
    mode: "stuck",
    grabbed: false,
    omega: 12,
    adhesion: def.adhesion,
    tear: def.tear,
    seed: index * 1.37 + 0.4,
    spawn: 0,
    lastPeel: 0,
    speed: 0,
    key: null,
    relX: 0,
    relY: 0,
    relAng: 0,
    dirHome: 0,
    offX: 0,
    offY: 0,
    tex: null,
  };
}

function toLocal(st, x, y) {
  const c = Math.cos(st.ang);
  const s = Math.sin(st.ang);
  const rx = x - st.ox;
  const ry = y - st.oy;
  return [rx * c + ry * s, -rx * s + ry * c];
}

function toWorld(st, lx, ly) {
  const c = Math.cos(st.ang);
  const s = Math.sin(st.ang);
  return [st.ox + lx * c - ly * s, st.oy + lx * s + ly * c];
}

function grabPoint(st, x, y) {
  const [lx, ly] = toLocal(st, x, y);
  const a = st.def.w / 2;
  const b = st.def.h / 2;
  let px;
  let py;
  let key;
  if (st.def.shape === "rect") {
    px = lx < 0 ? -a : a;
    py = ly < 0 ? -b : b;
    key = (lx < 0 ? 0 : 1) + (ly < 0 ? 0 : 2);
  } else {
    const t = Math.atan2(ly / b, lx / a);
    const step = Math.round(t / (Math.PI / 6));
    const snapped = step * (Math.PI / 6);
    px = a * Math.cos(snapped);
    py = b * Math.sin(snapped);
    key = step;
  }
  const ex = st.def.shape === "rect" ? px : px / (a * a);
  const ey = st.def.shape === "rect" ? py : py / (b * b);
  const len = Math.hypot(ex, ey) || 1;
  const [wx, wy] = toWorld(st, px, py);
  const c = Math.cos(st.ang);
  const s = Math.sin(st.ang);
  const inx = -ex / len;
  const iny = -ey / len;
  return { x: wx, y: wy, nx: inx * c - iny * s, ny: inx * s + iny * c, key };
}

function extentAlong(st) {
  const c = Math.cos(st.ang);
  const s = Math.sin(st.ang);
  const a = st.def.w / 2;
  const b = st.def.h / 2;
  const base = (st.ox - st.p0x) * st.dx + (st.oy - st.p0y) * st.dy;
  const ldx = st.dx * c + st.dy * s;
  const ldy = -st.dx * s + st.dy * c;
  if (st.def.shape === "rect") return base + Math.abs(ldx) * a + Math.abs(ldy) * b;
  return base + Math.hypot(a * ldx, b * ldy);
}

function setAnchor(st, g) {
  st.p0x = g.x;
  st.p0y = g.y;
  st.nx = g.nx;
  st.ny = g.ny;
  st.key = g.key;
  st.dirA = Math.atan2(g.ny, g.nx);
  st.dirT = st.dirA;
  st.dx = Math.cos(st.dirA);
  st.dy = Math.sin(st.dirA);
}

export async function createPeel(stage, canvas, options = {}) {
  const { embedded = false, onChange = () => {} } = options;
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl) throw new Error("webgl2 unavailable");
  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = reducedQuery.matches;

  const [photo, fonts] = await Promise.all([loadImage(SLEEVE_PHOTO), readyFonts()]);
  if (gl.isContextLost()) return { destroy() {} };

  const dprNow = () => Math.min(2, window.devicePixelRatio || 1);
  const sceneProg = compile(gl, SCENE_VS, SCENE_FS);
  const stickerProg = compile(gl, STICKER_VS, STICKER_FS);
  const shadowProg = compile(gl, STICKER_VS, SHADOW_FS);
  const blurProg = compile(gl, BLUR_VS, BLUR_FS);
  const residueProg = compile(gl, RESIDUE_VS, RESIDUE_FS);
  const strandProg = compile(gl, STRAND_VS, STRAND_FS);
  const mesh = gridMesh(gl);
  const emptyVao = gl.createVertexArray();

  const strandData = new Float32Array(MAX_PARTS * (NODES - 1) * 6 * 5);
  const strandVao = gl.createVertexArray();
  gl.bindVertexArray(strandVao);
  const strandBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, strandBuf);
  gl.bufferData(gl.ARRAY_BUFFER, strandData.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
  gl.bindVertexArray(null);

  const sleeveTex = texture(gl, sleeveArt(photo, fonts), true);
  const mask = target(gl, MASK_PX, MASK_PX);
  let shadowRaw = null;
  let shadowMid = null;
  let shadowOut = null;
  let base = null;
  let baseDirty = true;

  let stickers = [];
  let strands = [];
  let topLayer = STICKERS.length;
  let view = { w: 1, h: 1, dpr: 1, k: 1, cx: 0, cy: 0, toClip: new Float32Array(9), fromClip: new Float32Array(9) };
  const pointer = { x: 0, y: 0, vx: 0, vy: 0, t: 0, inside: false };
  let grab = null;
  let hover = null;
  let focusIndex = -1;
  let kb = null;
  let raf = 0;
  let last = 0;
  let visible = true;
  let destroyed = false;
  let quality = 1;
  const slow = [];
  const scratch = { x: 0, y: 0, z: 0 };

  function artFor(def) {
    return texture(gl, stickerArt(def, fonts, dprNow()), true);
  }
  const arts = new Map(STICKERS.map((def) => [def.id, artFor(def)]));

  function residuePass(st, ghost) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, mask.fbo);
    gl.viewport(0, 0, MASK_PX, MASK_PX);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(residueProg.program);
    const u = residueProg.u;
    gl.uniform2f(u.uOrigin, st.ox, st.oy);
    gl.uniform2f(u.uAxis, Math.cos(st.ang), Math.sin(st.ang));
    gl.uniform2f(u.uSize, st.def.w, st.def.h);
    gl.uniform2f(u.uMaskRange, MASK_MIN, MASK_SIZE);
    gl.uniform2f(u.uP0, st.p0x, st.p0y);
    gl.uniform2f(u.uDir, st.dx, st.dy);
    gl.uniform1f(u.uPeel, st.peel);
    const fast = clamp(st.speed / 0.9, 0, 1);
    gl.uniform3f(u.uGlue, st.adhesion * (0.55 + 0.45 * (1 - fast)), st.tear * st.adhesion * (0.35 + 0.65 * fast), st.seed);
    gl.uniform1f(u.uGhost, ghost ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, arts.get(st.def.id));
    gl.uniform1i(u.uArt, 0);
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
    gl.blendEquation(gl.FUNC_ADD);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function spawnStrand(st, s, seedRandom) {
    if (strands.length >= MAX_PARTS - 4) return;
    if (strands.filter((part) => part.st === st && part.kind === "whole").length >= 4) return;
    const qx = -st.dy;
    const qy = st.dx;
    const options = [];
    for (let l = -0.3; l <= 0.3; l += 0.008) {
      const bx = st.p0x + st.dx * s + qx * l;
      const by = st.p0y + st.dy * s + qy * l;
      const [lx, ly] = toLocal(st, bx, by);
      if (shapeContains(st.def, lx * 1.06, ly * 1.06)) options.push([bx, by, lx, ly]);
    }
    if (!options.length) return;
    const pick = options[Math.floor(seedRandom() * options.length)];
    const fast = clamp(st.speed / 1.1, 0, 1);
    const nodes = new Float32Array(NODES * 3);
    for (let i = 0; i < NODES; i += 1) {
      nodes[i * 3] = pick[0];
      nodes[i * 3 + 1] = pick[1];
      nodes[i * 3 + 2] = 0;
    }
    strands.push({
      kind: "whole",
      st,
      bx: pick[0],
      by: pick[1],
      lx: pick[2],
      ly: pick[3],
      nodes,
      prev: nodes.slice(),
      count: NODES,
      rest: 0,
      span: 0,
      breakAt: (0.06 + 0.07 * seedRandom()) * (1.15 - 0.65 * fast) * (0.55 + 0.45 * st.adhesion),
      w0: 0.0046 + 0.002 * seedRandom(),
      width: 0.0024,
    });
  }

  function topOf(strand, out) {
    const [fx, fy] = toWorld(strand.st, strand.lx, strand.ly);
    return curlPoint(strand.st, fx, fy, out);
  }

  function snap(strand) {
    const cut = 3 + Math.floor(Math.random() * (strand.count - 6));
    const parts = [];
    const lower = { from: 0, to: cut, anchor: "base" };
    const upper = { from: strand.count - 1, to: cut + 1, anchor: "top" };
    for (const part of [lower, upper]) {
      const n = Math.abs(part.to - part.from) + 1;
      const nodes = new Float32Array(n * 3);
      const prev = new Float32Array(n * 3);
      const dir = part.to >= part.from ? 1 : -1;
      for (let i = 0; i < n; i += 1) {
        const src = part.from + i * dir;
        for (let c = 0; c < 3; c += 1) {
          nodes[i * 3 + c] = strand.nodes[src * 3 + c];
          prev[i * 3 + c] = strand.prev[src * 3 + c];
        }
      }
      parts.push({
        kind: "tail",
        anchor: part.anchor,
        st: strand.st,
        bx: strand.bx,
        by: strand.by,
        lx: strand.lx,
        ly: strand.ly,
        nodes,
        prev,
        count: n,
        rest: strand.rest,
        width: strand.width,
        w0: strand.width,
        span: strand.span,
      });
    }
    return parts;
  }

  function stepChain(part, ax, ay, az, bx, by, bz, dt, damping) {
    const { nodes, prev, count } = part;
    const g = 0.4 * dt * dt;
    let moved = 0;
    for (let i = 0; i < count; i += 1) {
      const o = i * 3;
      const vx = (nodes[o] - prev[o]) * damping;
      const vy = (nodes[o + 1] - prev[o + 1]) * damping;
      const vz = (nodes[o + 2] - prev[o + 2]) * damping;
      prev[o] = nodes[o];
      prev[o + 1] = nodes[o + 1];
      prev[o + 2] = nodes[o + 2];
      nodes[o] += vx;
      nodes[o + 1] += vy;
      nodes[o + 2] += vz - g;
      if (nodes[o + 2] < 0) nodes[o + 2] = 0;
      moved = Math.max(moved, Math.abs(vx) + Math.abs(vy) + Math.abs(vz));
    }
    const pin = () => {
      nodes[0] = ax;
      nodes[1] = ay;
      nodes[2] = az;
      if (bx !== null) {
        const o = (count - 1) * 3;
        nodes[o] = bx;
        nodes[o + 1] = by;
        nodes[o + 2] = bz;
      }
    };
    pin();
    for (let it = 0; it < 8; it += 1) {
      for (let i = 0; i < count - 1; i += 1) {
        const o = i * 3;
        const q = o + 3;
        const dx = nodes[q] - nodes[o];
        const dy = nodes[q + 1] - nodes[o + 1];
        const dz = nodes[q + 2] - nodes[o + 2];
        const len = Math.hypot(dx, dy, dz) || 1e-9;
        const diff = ((len - part.rest) / len) * 0.5;
        nodes[o] += dx * diff;
        nodes[o + 1] += dy * diff;
        nodes[o + 2] += dz * diff;
        nodes[q] -= dx * diff;
        nodes[q + 1] -= dy * diff;
        nodes[q + 2] -= dz * diff;
      }
      pin();
    }
    return moved;
  }

  function stepStrands(dt) {
    let moving = false;
    const next = [];
    for (const part of strands) {
      if (part.kind === "whole") {
        const top = topOf(part, scratch);
        const span = Math.hypot(top.x - part.bx, top.y - part.by, top.z);
        part.span = span;
        if (span > part.breakAt || part.st.mode === "held" || part.st.mode === "laying") {
          next.push(...snap(part));
          moving = true;
          continue;
        }
        if (span < 0.0012 && !part.st.grabbed) {
          moving = true;
          continue;
        }
        const target = span / (part.count - 1);
        part.rest += (target - part.rest) * Math.min(1, dt * 12);
        const restBefore = part.rest;
        const moved = stepChain(part, part.bx, part.by, 0, top.x, top.y, top.z, dt, 0.9);
        part.width = part.w0 * clamp((0.012 / Math.max(span, 0.012)) ** 0.35, 0.45, 1);
        next.push(part);
        if (moved > 1e-6 || Math.abs(part.rest - restBefore) > 1e-7) moving = true;
        continue;
      }
      part.rest *= Math.exp(-dt * 8);
      part.width = Math.min(part.w0 * 1.5, part.width * (1 + dt * 1.2));
      if (part.anchor === "base") stepChain(part, part.bx, part.by, 0, null, null, null, dt, 0.84);
      else {
        const top = topOf(part, scratch);
        stepChain(part, top.x, top.y, top.z, null, null, null, dt, 0.84);
      }
      moving = true;
      if (part.rest * (part.count - 1) > 0.0005) next.push(part);
    }
    strands = next;
    return moving;
  }

  function writeStrands() {
    const minW = 1.05 / view.k;
    let k = 0;
    for (const part of strands) {
      const n = part.count;
      const len = part.rest * (n - 1);
      const fade = part.kind === "tail" ? clamp(len / 0.004, 0, 1) : clamp(part.span / 0.002, 0, 1);
      let px = 1;
      let py = 0;
      for (let i = 0; i < n - 1; i += 1) {
        for (let side = 0; side < 2; side += 1) {
          const idx = i + side;
          const o = idx * 3;
          const a = Math.max(0, idx - 1) * 3;
          const b = Math.min(n - 1, idx + 1) * 3;
          let tx = part.nodes[b] - part.nodes[a];
          let ty = part.nodes[b + 1] - part.nodes[a + 1];
          const tl = Math.hypot(tx, ty);
          if (tl > 1e-7) {
            px = -ty / tl;
            py = tx / tl;
          }
          const u = idx / (n - 1);
          const ends = part.kind === "whole" ? 1 + 2.2 * Math.exp(-u * 10) + 1.8 * Math.exp(-(1 - u) * 10) : 1 + 2 * Math.exp(-u * 6);
          const width = part.width * ends;
          const drawW = Math.max(width, minW);
          const cover = Math.min(1, width / minW) * fade;
          const hw = drawW / 2;
          const x = part.nodes[o];
          const y = part.nodes[o + 1];
          const z = part.nodes[o + 2];
          const verts = side === 0 ? "a" : "b";
          if (verts === "a") {
            part._ax = [x + px * hw, y + py * hw, z, x - px * hw, y - py * hw, z, cover];
          } else {
            const [lx0, ly0, lz0, rx0, ry0, rz0, c0] = part._ax;
            const lx1 = x + px * hw;
            const ly1 = y + py * hw;
            const rx1 = x - px * hw;
            const ry1 = y - py * hw;
            const quad = [
              [lx0, ly0, lz0, -1, c0],
              [rx0, ry0, rz0, 1, c0],
              [lx1, ly1, z, -1, cover],
              [rx0, ry0, rz0, 1, c0],
              [rx1, ry1, z, 1, cover],
              [lx1, ly1, z, -1, cover],
            ];
            for (const vtx of quad) {
              if (k + 5 > strandData.length) break;
              strandData[k++] = vtx[0];
              strandData[k++] = vtx[1];
              strandData[k++] = vtx[2];
              strandData[k++] = vtx[3];
              strandData[k++] = vtx[4];
            }
          }
        }
      }
    }
    return k / 5;
  }

  function seedRandomFor(st) {
    let state = Math.floor((st.seed * 9973 + strands.length * 131 + st.peel * 1e5) >>> 0) || 1;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function initScene() {
    stickers = STICKERS.map((def, i) => makeSticker(def, i));
    strands = [];
    topLayer = STICKERS.length;
    gl.bindFramebuffer(gl.FRAMEBUFFER, mask.fbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (const st of stickers) residuePass(st, true);
    for (const st of stickers) {
      const home = toWorld(st, 0, 0);
      setAnchor(st, grabPoint(st, home[0] * 0.4, home[1] * 0.4));
      const rest = st.def.rest;
      if (!rest) continue;
      const a = st.def.w / 2;
      const b = st.def.h / 2;
      const corners = [[-a, -b], [a, -b], [-a, b], [a, b]];
      const [cx, cy] = corners[rest.corner];
      const [wx, wy] = toWorld(st, cx, cy);
      const len = Math.hypot(cx, cy);
      const c = Math.cos(st.ang);
      const s = Math.sin(st.ang);
      setAnchor(st, { x: wx, y: wy, nx: (-cx / len) * c - (-cy / len) * s, ny: (-cx / len) * s + (-cy / len) * c, key: rest.corner });
      st.rest = rest.peel;
      st.peel = rest.peel;
      st.peelT = rest.peel;
      st.lastPeel = rest.peel;
      st.speed = 0.2;
      residuePass(st, false);
      const random = seedRandomFor(st);
      for (const f of [0.42, 0.7]) spawnStrand(st, rest.peel * f, random);
      for (const part of strands) {
        if (part.st !== st) continue;
        const top = topOf(part, scratch);
        part.span = Math.hypot(top.x - part.bx, top.y - part.by, top.z);
        part.rest = part.span / (part.count - 1);
        part.width = part.w0 * clamp(Math.sqrt(0.006 / Math.max(part.span, 0.006)), 0.2, 1);
        for (let i = 0; i < part.count; i += 1) {
          const t = i / (part.count - 1);
          part.nodes[i * 3] = part.bx + (top.x - part.bx) * t;
          part.nodes[i * 3 + 1] = part.by + (top.y - part.by) * t;
          part.nodes[i * 3 + 2] = top.z * t;
        }
        part.prev.set(part.nodes);
      }
    }
  }

  function fit() {
    const rect = stage.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const dpr = Math.max(0.5, dprNow() * quality);
    const narrow = w < 900;
    const bw = VIEW.maxX - VIEW.minX;
    const bh = VIEW.maxY - VIEW.minY;
    const place = (top, bottom, side) => {
      const aw = Math.max(40, w - side * 2);
      const ah = Math.max(40, h - top - bottom);
      const k = Math.min(aw / bw, ah / bh, 760);
      return { k, cx: side + aw / 2 - k * (VIEW.minX + bw / 2), cy: top + ah / 2 - k * (VIEW.minY + bh / 2) };
    };
    let p;
    if (embedded) p = place(16, 16, 16);
    else if (narrow) {
      const aw = w - 32;
      const ah = h - 184 - 24;
      const k = Math.min(aw / 1.14, ah / bh, 760);
      p = { k, cx: w / 2, cy: 184 + Math.min((ah - bh * k) * 0.3, 40) + k * 0.55 };
    }
    else if (w >= 1100) {
      const aw = w - 348;
      const ah = h - 128;
      const k = Math.min(aw / bw, ah / bh, 760);
      p = { k, cx: 300 + aw / 2 - k * (VIEW.minX + bw / 2), cy: 88 + ah / 2 - k * (VIEW.minY + bh / 2) };
    } else p = place(176, 40, 48);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const c = Math.cos(ROT);
    const s = Math.sin(ROT);
    const a = (2 * p.k * c) / w;
    const b = (-2 * p.k * s) / w;
    const cc = (2 * p.cx) / w - 1;
    const d = (-2 * p.k * s) / h;
    const e = (-2 * p.k * c) / h;
    const f = 1 - (2 * p.cy) / h;
    const toClip = new Float32Array([a, d, 0, b, e, 0, cc, f, 1]);
    const det = a * e - b * d;
    const ia = e / det;
    const ib = -b / det;
    const id = -d / det;
    const ie = a / det;
    const fromClip = new Float32Array([ia, id, 0, ib, ie, 0, -(ia * cc + ib * f), -(id * cc + ie * f), 1]);
    view = { w, h, dpr, k: p.k, cx: p.cx, cy: p.cy, toClip, fromClip };
    const sw = Math.max(8, Math.ceil(w / 3));
    const sh = Math.max(8, Math.ceil(h / 3));
    if (!base || base.w !== canvas.width || base.h !== canvas.height) {
      freeTarget(gl, base);
      base = target(gl, canvas.width, canvas.height);
    }
    baseDirty = true;
    if (!shadowRaw || shadowRaw.w !== sw || shadowRaw.h !== sh) {
      freeTarget(gl, shadowRaw);
      freeTarget(gl, shadowMid);
      freeTarget(gl, shadowOut);
      shadowRaw = target(gl, sw, sh);
      shadowMid = target(gl, sw, sh);
      shadowOut = target(gl, sw, sh);
    }
  }

  function toScene(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const sx = (clientX - rect.left - view.cx) / view.k;
    const sy = (clientY - rect.top - view.cy) / view.k;
    const c = Math.cos(ROT);
    const s = Math.sin(ROT);
    return [sx * c + sy * s, -sx * s + sy * c];
  }

  function sorted() {
    return [...stickers].sort((a, b) => a.layer - b.layer);
  }

  function pick(x, y) {
    const list = sorted().reverse();
    for (const st of list) {
      if (st.mode === "held") return st;
    }
    for (const st of list) {
      const [lx, ly] = toLocal(st, x, y);
      if (shapeContains(st.def, lx * 0.96, ly * 0.96)) return st;
      if (st.peel > 0.004) {
        const tip = tipOffset(st.peel, st.phi);
        const tx = st.p0x + st.dx * tip;
        const ty = st.p0y + st.dy * tip;
        if (Math.hypot(x - tx, y - ty) < 0.05) return st;
      }
    }
    return null;
  }

  function aimTargets(st, x, y) {
    const vx = x - grab.downX;
    const vy = y - grab.downY;
    const r = Math.hypot(vx, vy);
    const vi = vx * st.nx + vy * st.ny;
    let mx = vx;
    let my = vy;
    if (vi < 0) {
      mx -= 2 * vi * st.nx;
      my -= 2 * vi * st.ny;
    }
    const bias = 0.035;
    st.dirT = Math.atan2(my + st.ny * bias, mx + st.nx * bias);
    const frac = r > 1e-4 ? vi / r : 1;
    st.phiT = PHI_OUT + ((PHI_IN - PHI_OUT) * (frac + 1)) / 2;
    st.peelT = Math.max(PRESS_PEEL, solvePeel(r, st.phiT));
  }

  function startGrab(st, x, y, id) {
    if (st.mode === "held") {
      grab = { st, id, downX: x, downY: y };
      return;
    }
    if (st.peel > 0.0015) {
      const reach = tipOffset(st.peel, st.phi);
      grab = { st, id, downX: x - st.dx * reach, downY: y - st.dy * reach };
    } else {
      setAnchor(st, grabPoint(st, x, y));
      grab = { st, id, downX: x, downY: y };
    }
    st.mode = "peeling";
    st.grabbed = true;
    st.omega = 30;
    st.liftT = 0;
    st.lastPeel = st.peel;
    aimTargets(st, x, y);
  }

  function detach(st) {
    st.mode = "held";
    st.layer = ++topLayer;
    st.relX = (st.ox - st.p0x) * st.dx + (st.oy - st.p0y) * st.dy;
    st.relY = -(st.ox - st.p0x) * st.dy + (st.oy - st.p0y) * st.dx;
    st.relAng = st.ang - st.dirA;
    st.dirHome = st.dirA;
    const tip = tipOffset(st.peel, st.phi);
    st.offX = pointer.x - (st.p0x + st.dx * tip);
    st.offY = pointer.y - (st.p0y + st.dy * tip);
    st.peelT = extentAlong(st) + 0.02;
    st.phiT = PHI_HELD;
    st.liftT = HELD_LIFT;
    st.omega = 16;
    st.rest = 0;
    onChange({ held: st.def.label });
  }

  function release(st) {
    st.grabbed = false;
    if (st.mode === "held") {
      st.mode = "laying";
      st.peelT = 0;
      st.liftT = 0;
      st.omega = reduced ? 16 : 9.5;
      onChange({ held: null });
    } else {
      st.peelT = 0;
      st.rest = 0;
      st.omega = reduced ? 18 : 10.5;
    }
  }

  function springStep(st, key, targetValue, omega, dt) {
    const v = `${key}V`;
    const a = omega * omega * (targetValue - st[key]) - 2 * omega * st[v];
    st[v] += a * dt;
    st[key] += st[v] * dt;
  }

  function stepSticker(st, dt) {
    const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / sub;
    const prevPeel = st.peel;
    for (let i = 0; i < sub; i += 1) {
      springStep(st, "peel", st.peelT, st.omega, h);
      springStep(st, "phi", st.phiT, st.mode === "held" ? 48 : st.omega * 0.7, h);
      springStep(st, "lift", st.liftT, st.mode === "held" ? 14 : st.omega, h);
    }
    if (st.peel < 0) {
      st.peel = 0;
      st.peelV = Math.max(0, st.peelV);
    }
    if (st.lift < 0) {
      st.lift = 0;
      st.liftV = 0;
    }
    if (st.mode === "held") {
      const speed = Math.hypot(pointer.vx, pointer.vy);
      if (!reduced && speed > 0.12) {
        const want = Math.atan2(pointer.vy, pointer.vx);
        st.dirT = st.dirA + angleDiff(want, st.dirA) * Math.min(1, (speed - 0.12) * 0.5);
      } else st.dirT = st.dirA;
      st.dirA += angleDiff(st.dirT, st.dirA) * Math.min(1, dt * 3);
      const drift = angleDiff(st.dirA, st.dirHome);
      if (Math.abs(drift) > 0.35) st.dirA = st.dirHome + Math.sign(drift) * 0.35;
    } else if (st.mode === "peeling") {
      st.dirA += angleDiff(st.dirT, st.dirA) * Math.min(1, dt * (st.grabbed ? 16 : 6));
    }
    st.dx = Math.cos(st.dirA);
    st.dy = Math.sin(st.dirA);
    if (st.mode === "held") {
      const decay = Math.exp(-dt * 9);
      st.offX *= decay;
      st.offY *= decay;
      const tip = tipOffset(st.peel, st.phi);
      st.p0x = pointer.x - st.offX - st.dx * tip;
      st.p0y = pointer.y - st.offY - st.dy * tip;
      st.ox = st.p0x + st.dx * st.relX - st.dy * st.relY;
      st.oy = st.p0y + st.dy * st.relX + st.dx * st.relY;
      st.ang = st.dirA + st.relAng;
    }
    const dPeel = st.peel - prevPeel;
    st.speed += (Math.max(0, dPeel) / Math.max(dt, 1e-4) - st.speed) * Math.min(1, dt * 10);
    if (st.mode === "peeling") {
      if (st.grabbed && st.peelT > extentAlong(st) * 0.86 && st.peel > extentAlong(st) * 0.82) detach(st);
      else if (dPeel > 0) {
        residuePass(st, false);
        st.spawn += dPeel * 60 * (0.5 + 0.5 * st.adhesion);
        const random = seedRandomFor(st);
        while (st.spawn >= 1) {
          st.spawn -= 1;
          spawnStrand(st, st.peel - 0.0015, random);
        }
      }
    }
    st.lastPeel = st.peel;
    const settled =
      Math.abs(st.peel - st.peelT) < 1e-4 &&
      Math.abs(st.peelV) < 2e-3 &&
      Math.abs(st.lift - st.liftT) < 1e-4 &&
      Math.abs(st.liftV) < 2e-3 &&
      Math.abs(st.phi - st.phiT) < 2e-3 &&
      Math.abs(angleDiff(st.dirT, st.dirA)) < 1e-3;
    if (settled && !st.grabbed) {
      st.peel = st.peelT;
      st.lift = st.liftT;
      st.peelV = 0;
      st.liftV = 0;
      if (st.mode === "laying") {
        st.mode = "stuck";
        st.peel = 0;
        st.adhesion = Math.max(0.35, st.adhesion * 0.85);
        st.tear *= 0.6;
      } else if (st.mode === "peeling") st.mode = "stuck";
      return st.mode === "held";
    }
    return true;
  }

  function stepKeyboard(dt) {
    if (!kb) return false;
    kb.t = Math.min(1, kb.t + dt / kb.dur);
    const e = kb.t < 0.5 ? 4 * kb.t ** 3 : 1 - (-2 * kb.t + 2) ** 3 / 2;
    pointer.x = kb.fx + (kb.tx - kb.fx) * e;
    pointer.y = kb.fy + (kb.ty - kb.fy) * e;
    const st = kb.st;
    if (st.mode === "peeling" && st.grabbed) aimTargets(st, pointer.x, pointer.y);
    if (kb.t >= 1) {
      pointer.vx = 0;
      pointer.vy = 0;
      kb = null;
    } else {
      pointer.vx = ((kb.tx - kb.fx) / kb.dur) * 0.4;
      pointer.vy = ((kb.ty - kb.fy) / kb.dur) * 0.4;
    }
    return true;
  }

  function step(dt) {
    let active = stepKeyboard(dt);
    if (!grab || !grab.st || grab.st.mode !== "held") {
      pointer.vx *= Math.exp(-dt * 8);
      pointer.vy *= Math.exp(-dt * 8);
    } else if (performance.now() - pointer.t > 60) {
      pointer.vx *= Math.exp(-dt * 10);
      pointer.vy *= Math.exp(-dt * 10);
    }
    for (const st of stickers) if (stepSticker(st, dt)) active = true;
    if (stepStrands(dt)) active = true;
    return active;
  }

  function bindSticker(prog, st) {
    const u = prog.u;
    gl.uniform2f(u.uOrigin, st.ox, st.oy);
    gl.uniform2f(u.uAxis, Math.cos(st.ang), Math.sin(st.ang));
    gl.uniform2f(u.uSize, st.def.w, st.def.h);
    gl.uniform2f(u.uP0, st.p0x, st.p0y);
    gl.uniform2f(u.uDir, st.dx, st.dy);
    gl.uniform4f(u.uCurl, Math.max(0, st.peel), radiusFor(st.peel), st.phi, st.lift);
    gl.uniform1f(u.uLayer, st.layer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, arts.get(st.def.id));
    gl.uniform1i(u.uArt, 0);
  }

  function common(prog, shadowMode) {
    const u = prog.u;
    gl.uniformMatrix3fv(u.uSceneToClip, false, view.toClip);
    gl.uniform3f(u.uCam, (VIEW.minX + VIEW.maxX) / 2, 0, CAM_Z);
    gl.uniform2f(u.uLightShift, LIGHT_SHIFT[0], LIGHT_SHIFT[1]);
    gl.uniform1f(u.uShadowMode, shadowMode);
  }

  function sceneUniforms(composeMode) {
    const su = sceneProg.u;
    gl.uniformMatrix3fv(su.uClipToScene, false, view.fromClip);
    gl.uniform2f(su.uRes, canvas.width, canvas.height);
    gl.uniform3f(su.uGround, GROUND[0], GROUND[1], GROUND[2]);
    gl.uniform3f(su.uDisc, DISC[0], DISC[1], DISC[2]);
    gl.uniform2f(su.uMaskRange, MASK_MIN, MASK_SIZE);
    gl.uniform1f(su.uPxPerUnit, view.k * view.dpr);
    gl.uniform1f(su.uCompose, composeMode);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sleeveTex);
    gl.uniform1i(su.uPhoto, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, mask.tex);
    gl.uniform1i(su.uMask, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, shadowOut.tex);
    gl.uniform1i(su.uShadow, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, composeMode ? base.tex : null);
    gl.uniform1i(su.uBase, 3);
  }

  function render() {
    if (gl.isContextLost()) return;
    const order = sorted();
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowRaw.fbo);
    gl.viewport(0, 0, shadowRaw.w, shadowRaw.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(shadowProg.program);
    common(shadowProg, 1);
    gl.bindVertexArray(mesh.vao);
    for (const st of order) {
      bindSticker(shadowProg, st);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
    gl.useProgram(blurProg.program);
    gl.bindVertexArray(emptyVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(blurProg.u.uSrc, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowMid.fbo);
    gl.bindTexture(gl.TEXTURE_2D, shadowRaw.tex);
    gl.uniform2f(blurProg.u.uStep, 1 / shadowRaw.w, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowOut.fbo);
    gl.bindTexture(gl.TEXTURE_2D, shadowMid.tex);
    gl.uniform2f(blurProg.u.uStep, 0, 1 / shadowRaw.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(sceneProg.program);
    if (baseDirty) {
      baseDirty = false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, base.fbo);
      gl.viewport(0, 0, base.w, base.h);
      sceneUniforms(0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(GROUND[0], GROUND[1], GROUND[2], 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    sceneUniforms(1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const strandVerts = strands.length ? writeStrands() : 0;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (strandVerts) {
      gl.bindBuffer(gl.ARRAY_BUFFER, strandBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, strandData, 0, strandVerts * 5);
      gl.useProgram(strandProg.program);
      common(strandProg, 1);
      gl.bindVertexArray(strandVao);
      gl.drawArrays(gl.TRIANGLES, 0, strandVerts);
    }

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.useProgram(stickerProg.program);
    common(stickerProg, 0);
    gl.uniform2f(stickerProg.u.uRes, canvas.width, canvas.height);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, shadowOut.tex);
    gl.uniform1i(stickerProg.u.uShadow, 1);
    gl.bindVertexArray(mesh.vao);
    for (const st of order) {
      bindSticker(stickerProg, st);
      gl.uniform3f(stickerProg.u.uBacking, st.def.backing[0], st.def.backing[1], st.def.backing[2]);
      gl.uniform4f(stickerProg.u.uMaterial, st.def.gloss, st.def.shine, st.def.translucent, st.def.h / st.def.w);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    }
    if (strandVerts) {
      gl.depthMask(false);
      gl.useProgram(strandProg.program);
      common(strandProg, 0);
      gl.bindVertexArray(strandVao);
      gl.drawArrays(gl.TRIANGLES, 0, strandVerts);
      gl.depthMask(true);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  function frame(now) {
    raf = 0;
    if (destroyed) return;
    const gap = last ? now - last : 0;
    const dt = last ? Math.min(1 / 30, Math.max(1 / 240, gap / 1000)) : 1 / 60;
    last = now;
    const active = step(dt);
    render();
    govern(gap);
    if (active) kick();
    else last = 0;
  }

  function govern(gap) {
    if (gap <= 0) return;
    slow.push(gap);
    if (slow.length < 12) return;
    const median = [...slow].sort((x, y) => x - y)[slow.length >> 1];
    slow.length = 0;
    if (median > 45 && quality > 0.5) {
      quality = Math.max(0.5, quality * 0.7);
      fit();
    } else if (median < 22 && quality < 1) {
      quality = Math.min(1, quality / 0.7);
      fit();
    }
  }

  function kick() {
    if (destroyed || raf || !visible || document.hidden) return;
    raf = requestAnimationFrame(frame);
  }

  function setCursor() {
    if (grab) canvas.style.cursor = "grabbing";
    else canvas.style.cursor = hover ? "grab" : "default";
  }

  function hoverTo(st, x, y) {
    if (hover && hover !== st && hover.mode === "stuck" && !hover.grabbed) hover.peelT = hover.rest;
    hover = st;
    if (st && st.mode === "stuck" && !st.grabbed) {
      if (st.rest > 0) st.peelT = st.rest + 0.006;
      else {
        const g = grabPoint(st, x, y);
        if (g.key !== st.key) {
          if (st.peel < 0.0012) {
            setAnchor(st, g);
            st.phi = PHI_IN;
            st.phiT = PHI_IN;
            st.peelT = HOVER_PEEL;
          } else st.peelT = 0;
        } else st.peelT = HOVER_PEEL;
        st.omega = reduced ? 22 : 14;
      }
    }
    setCursor();
    kick();
  }

  function onPointerDown(event) {
    if (grab || event.button > 0) return;
    const [x, y] = toScene(event.clientX, event.clientY);
    pointer.x = x;
    pointer.y = y;
    pointer.vx = 0;
    pointer.vy = 0;
    pointer.t = performance.now();
    kb = null;
    const st = pick(x, y);
    if (!st) return;
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {}
    startGrab(st, x, y, event.pointerId);
    hover = st;
    setCursor();
    kick();
  }

  function onPointerMove(event) {
    const [x, y] = toScene(event.clientX, event.clientY);
    const now = performance.now();
    const dtp = Math.max(1, now - pointer.t) / 1000;
    const nvx = (x - pointer.x) / dtp;
    const nvy = (y - pointer.y) / dtp;
    const blend = Math.min(1, dtp * 14);
    pointer.vx += (nvx - pointer.vx) * blend;
    pointer.vy += (nvy - pointer.vy) * blend;
    pointer.x = clamp(x, VIEW.minX - 0.1, VIEW.maxX + 0.1);
    pointer.y = clamp(y, VIEW.minY - 0.05, VIEW.maxY + 0.05);
    pointer.t = now;
    if (grab && grab.id === event.pointerId) {
      if (grab.st.mode === "peeling") aimTargets(grab.st, pointer.x, pointer.y);
      kick();
      return;
    }
    if (event.pointerType === "touch") return;
    hoverTo(pick(x, y), x, y);
  }

  function onPointerUp(event) {
    if (!grab || grab.id !== event.pointerId) return;
    const st = grab.st;
    grab = null;
    release(st);
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {}
    if (event.pointerType === "touch") hover = null;
    setCursor();
    kick();
  }

  function onPointerLeave() {
    if (grab) return;
    if (hover && hover.mode === "stuck") hover.peelT = hover.rest;
    hover = null;
    setCursor();
    kick();
  }

  function onTouchStart(event) {
    const t = event.touches[0];
    if (!t) return;
    const [x, y] = toScene(t.clientX, t.clientY);
    if (pick(x, y)) event.preventDefault();
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
  canvas.addEventListener("pointerleave", onPointerLeave);
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

  initScene();
  fit();
  render();

  function focusSticker(delta) {
    if (grab) return;
    const n = stickers.length;
    focusIndex = focusIndex < 0 ? (delta > 0 ? 0 : n - 1) : (focusIndex + delta + n) % n;
    const st = stickers[focusIndex];
    const centre = toWorld(st, 0, 0);
    hoverTo(st, centre[0] * 0.5, centre[1] * 0.5);
    onChange({ focus: st.def.label });
  }

  function keyPeel() {
    if (grab && grab.st.mode === "held") {
      const st = grab.st;
      grab = null;
      kb = null;
      release(st);
      setCursor();
      kick();
      return;
    }
    if (grab) return;
    if (focusIndex < 0) focusSticker(1);
    const st = stickers[focusIndex];
    if (st.peel <= 0.0015) setAnchor(st, grabPoint(st, 0, 0));
    pointer.x = st.p0x + st.dx * tipOffset(st.peel, st.phi);
    pointer.y = st.p0y + st.dy * tipOffset(st.peel, st.phi);
    startGrab(st, pointer.x, pointer.y, "keyboard");
    const ext = extentAlong(st) + 0.05;
    const reach = tipOffset(ext, PHI_IN) + 0.02;
    kb = { st, t: 0, dur: reduced ? 0.35 : 1.1, fx: pointer.x, fy: pointer.y, tx: grab.downX + st.nx * reach, ty: grab.downY + st.ny * reach };
    kick();
  }

  function keyMove(dx, dy) {
    if (!grab || grab.st.mode !== "held") return false;
    const fx = pointer.x;
    const fy = pointer.y;
    const c = Math.cos(-ROT);
    const s = Math.sin(-ROT);
    const sx = dx * c - dy * s;
    const sy = dx * s + dy * c;
    const base = kb ? { x: kb.tx, y: kb.ty } : { x: fx, y: fy };
    kb = {
      st: grab.st,
      t: 0,
      dur: 0.22,
      fx,
      fy,
      tx: clamp(base.x + sx, VIEW.minX, VIEW.maxX),
      ty: clamp(base.y + sy, VIEW.minY, VIEW.maxY),
    };
    kick();
    return true;
  }

  function keyCancel() {
    if (grab && grab.id === "keyboard") {
      const st = grab.st;
      grab = null;
      kb = null;
      release(st);
      setCursor();
      kick();
      return true;
    }
    return false;
  }

  function blur() {
    if (grab && grab.id === "keyboard") keyCancel();
    focusIndex = -1;
    if (hover && hover.mode === "stuck") hover.peelT = hover.rest;
    hover = null;
    kick();
  }

  function reset() {
    grab = null;
    kb = null;
    hover = null;
    initScene();
    baseDirty = true;
    setCursor();
    render();
    onChange({ held: null });
  }

  return {
    reset,
    focusSticker,
    keyPeel,
    keyMove,
    keyCancel,
    blur,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("visibilitychange", onVisibility);
      reducedQuery.removeEventListener("change", onReduced);
      resizeObserver.disconnect();
      io.disconnect();
      for (const tex of arts.values()) gl.deleteTexture(tex);
      gl.deleteTexture(sleeveTex);
      freeTarget(gl, mask);
      freeTarget(gl, shadowRaw);
      freeTarget(gl, shadowMid);
      freeTarget(gl, shadowOut);
      freeTarget(gl, base);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
