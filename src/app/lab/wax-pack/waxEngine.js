import { CARD_FS, CARD_VS, FLAP_FS, FLAP_VS, SHADE_FS, SHADE_VS, TABLE_FS, TABLE_VS } from "./waxShader";
import { CARDS, GUM, PACK, backArt, creaseCanvas, drawBaseCreases, gumArt, loadImage, mulberry, readyFonts, stampCrease, wrapperArt } from "./waxArt";

const GU = 120;
const GV = 200;
const PATH_N = 96;
const FOV = (26 * Math.PI) / 180;
const GROUND = [0.902, 0.89, 0.864];
const VMIN = -PACK.TAB_H / PACK.H;
const CARD_T = 0.0042;
const STACK_BASE = 0.012;
const HELD_Z = 0.11;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function springStep(x, v, target, omega, zeta, dt) {
  const f = 1 + 2 * dt * zeta * omega;
  const oo = omega * omega;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const inv = 1 / (f + hhoo);
  return [(f * x + dt * v + hhoo * target) * inv, (v + hoo * (target - x)) * inv];
}

function qmul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function qaxis(x, y, z, angle) {
  const len = Math.hypot(x, y, z) || 1;
  const s = Math.sin(angle / 2) / len;
  return [x * s, y * s, z * s, Math.cos(angle / 2)];
}

function qnorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

function qmat(q, out) {
  const [x, y, z, w] = q;
  out[0] = 1 - 2 * (y * y + z * z);
  out[1] = 2 * (x * y + z * w);
  out[2] = 2 * (x * z - y * w);
  out[3] = 2 * (x * y - z * w);
  out[4] = 1 - 2 * (x * x + z * z);
  out[5] = 2 * (y * z + x * w);
  out[6] = 2 * (x * z + y * w);
  out[7] = 2 * (y * z - x * w);
  out[8] = 1 - 2 * (x * x + y * y);
  return out;
}

function hash1(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function noise1(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const w = f * f * (3 - 2 * f);
  return hash1(i + seed * 57.3) * (1 - w) + hash1(i + 1 + seed * 57.3) * w;
}

function fbm1(x, seed) {
  let sum = 0;
  let amp = 0.5;
  let p = x;
  for (let k = 0; k < 4; k += 1) {
    sum += amp * noise1(p, seed + k * 3.7);
    p *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

function noiseTexture(gl) {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const random = mulberry(9);
  const lattice = (cells) => {
    const g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i += 1) g[i] = random();
    return (x, y) => {
      const fx = (x / N) * cells;
      const fy = (y / N) * cells;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const wx = tx * tx * (3 - 2 * tx);
      const wy = ty * ty * (3 - 2 * ty);
      const at = (a, b) => g[((b + cells) % cells) * cells + ((a + cells) % cells)];
      const top = at(ix, iy) * (1 - wx) + at(ix + 1, iy) * wx;
      const bot = at(ix, iy + 1) * (1 - wx) + at(ix + 1, iy + 1) * wx;
      return top * (1 - wy) + bot * wy;
    };
  };
  const base = lattice(64);
  const octaves = [lattice(64), lattice(128), lattice(256)];
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const i = (y * N + x) * 4;
      const r = base(x, y);
      const f = 0.5 * octaves[0](x + 0.5, y + 0.5) + 0.25 * octaves[1](x, y) + 0.125 * octaves[2](x, y) + 0.0625 * random();
      data[i] = Math.round(r * 255);
      data[i + 1] = Math.round(random() * 255);
      data[i + 2] = Math.round((f / 0.9375) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return tex;
}

function ragTexture(gl) {
  const N = 2048;
  const data = new Uint8Array(N * 2 * 4);
  for (let row = 0; row < 2; row += 1) {
    const side = row === 0 ? 1 : 2;
    for (let x = 0; x < N; x += 1) {
      const v = VMIN + (x / (N - 1)) * (1 - VMIN);
      const vy = v * PACK.H;
      const rag = (fbm1(vy * 13, 0) - 0.5) * 0.03 + (noise1(vy * 95, 5) - 0.5) * 0.008;
      const band = fbm1(vy * 22, side * 11);
      const hairId = noise1(vy * 300, side * 23);
      const hair = hairId > 0.52 ? Math.min(1, (hairId - 0.52) / 0.18) : 0;
      const len = 0.4 + 0.6 * hash1(Math.floor(vy * 300) + side * 91);
      const i = (row * N + x) * 4;
      data[i] = Math.round(Math.max(0, Math.min(1, 0.5 + rag / 0.04)) * 255);
      data[i + 1] = Math.round(Math.max(0, Math.min(1, band)) * 255);
      data[i + 2] = Math.round(len * 255);
      data[i + 3] = Math.round(hair * 255);
    }
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
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
    u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(program, info.name);
  }
  return { program, u };
}

function makeTexture(gl, source, { mip = true, premultiply = false, aniso = null } = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (aniso && mip) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
  return tex;
}

function gridMesh(gl) {
  const verts = new Float32Array((GU + 1) * (GV + 1) * 2);
  let k = 0;
  for (let j = 0; j <= GV; j += 1) {
    for (let i = 0; i <= GU; i += 1) {
      verts[k++] = i / GU;
      verts[k++] = j / GV;
    }
  }
  const idx = new Uint16Array(GU * GV * 6);
  k = 0;
  for (let j = 0; j < GV; j += 1) {
    for (let i = 0; i < GU; i += 1) {
      const a = j * (GU + 1) + i;
      const b = a + 1;
      const c = a + GU + 1;
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

function quadMesh(gl) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { vao, vb };
}

function layoutFor(aspect) {
  const slots = [];
  const jitter = mulberry(77);
  if (aspect >= 1.05) {
    for (let i = 0; i < 12; i += 1) {
      const row = i < 6 ? 0 : 1;
      const k = i % 6;
      slots.push({ x: 1.72 + k * 0.66 + (row ? 0.3 : 0), y: row ? 0.48 : -0.5, yaw: (k - 2.5) * 0.018 + (jitter() - 0.5) * 0.07 });
    }
    return {
      slots,
      gum: { x: 0.98, y: 0.86, yaw: 0.36 },
      open: { x0: -1.28, x1: 1.72 + 5 * 0.66 + 0.3 + 0.56, y0: -1.48, y1: 1.46 },
    };
  }
  for (let i = 0; i < 12; i += 1) {
    const row = i < 6 ? 0 : 1;
    const k = i % 6;
    slots.push({ x: -1.05 + k * 0.42 + (row ? 0.1 : -0.1), y: row ? 3.12 : 2.18, yaw: (k - 2.5) * 0.02 + (jitter() - 0.5) * 0.07 });
  }
  return {
    slots,
    gum: { x: 0.92, y: 0.84, yaw: 0.36 },
    open: { x0: -1.7, x1: 1.7, y0: -1.14, y1: 4.08 },
  };
}

const SEALED = { x0: -0.74, x1: 0.74, y0: -1.2, y1: 1.12 };

export async function createWaxPack(stage, canvas, options = {}) {
  const { embedded = false, onChange = () => {}, insets = () => ({ top: 20, bottom: 20, left: 20, right: 20 }) } = options;
  const gl = canvas.getContext("webgl2", { antialias: true, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl) throw new Error("webgl2 unavailable");
  const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = reducedQuery.matches;
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");

  const fonts = await readyFonts();
  const images = await Promise.all(CARDS.map((c) => loadImage(c.src)));
  if (gl.isContextLost()) return { destroy() {}, reset() {}, key() {} };

  const tableProg = compile(gl, TABLE_VS, TABLE_FS);
  const cardProg = compile(gl, CARD_VS, CARD_FS);
  const flapProg = compile(gl, FLAP_VS, FLAP_FS);
  const shadeProg = compile(gl, SHADE_VS, SHADE_FS);
  const noiseTex = noiseTexture(gl);
  const ragTex = ragTexture(gl);
  const grid = gridMesh(gl);
  const quad = quadMesh(gl);
  const emptyVao = gl.createVertexArray();

  const artTex = makeTexture(gl, wrapperArt(fonts), { aniso });
  const crease = creaseCanvas();
  const creaseTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, creaseTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const frontTex = images.map((img) => makeTexture(gl, img, { aniso }));
  const backTex = CARDS.map(() => null);
  let gumTex = null;
  const dummy = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, dummy);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

  let hmap = null;
  let shade = null;
  let width = 1;
  let height = 1;
  let dpr = 1;
  let destroyed = false;
  let visible = true;
  let raf = 0;
  let last = 0;
  let layout = layoutFor(1.6);
  let creaseDirty = true;
  let seed = 1;
  let rand = mulberry(seed);

  const cam = { x: 0, y: 0, s: 200, vx: 0, vy: 0, vs: 0, tx: 0, ty: 0, ts: 200, ox: 0, oy: 0 };
  const pointer = { cx: 0, cy: 0, has: false, px: 0, py: 0, vx: 0, vy: 0, wx: 0, wy: 0, down: false, type: "mouse", id: null, hold: 0, travel: 0 };
  let grab = null;
  let pendingRelease = false;
  let hoverTab = false;
  let fade = { value: 1, target: 1, then: null };
  const rot = new Float32Array(9);

  const pack = { x: 0, y: 0, yaw: -0.035 };
  let tear;
  let items;
  let stack;
  let dealt;
  let layerTop;
  let phase;
  let script = null;
  let scrap = null;

  function packCos() {
    return [Math.cos(pack.yaw), Math.sin(pack.yaw)];
  }

  function toPack(x, y) {
    const [c, s] = packCos();
    const dx = x - pack.x;
    const dy = y - pack.y;
    return [dx * c + dy * s, -dx * s + dy * c];
  }

  function fromPack(lx, ly) {
    const [c, s] = packCos();
    return [pack.x + lx * c - ly * s, pack.y + lx * s + ly * c];
  }

  function buildScene() {
    seed = (seed * 16807 + 11) % 2147483647;
    rand = mulberry(seed);
    tear = {
      started: false,
      tipU: 0.5,
      tipV: VMIN - 0.02,
      targetU: 0.5,
      targetV: VMIN - 0.02,
      path: new Float32Array(PATH_N).fill(0.5),
      curl: 0,
      curlV: 0,
      flip: 0,
      flipV: 0,
      flipT: 0,
      tab: 0,
      tabV: 0,
      creaseAcc: 0,
      done: false,
    };
    const order = CARDS.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    items = [];
    stack = [];
    order.forEach((ci, k) => {
      const data = CARDS[ci];
      const h = 1 / data.aspect;
      const lx = (rand() - 0.5) * 0.022;
      const ly = (rand() - 0.5) * 0.026 + (h < 1.5 ? -0.12 : 0);
      const [x, y] = fromPack(lx, ly);
      const yaw = pack.yaw + (rand() - 0.5) * 0.03;
      const it = {
        kind: "card",
        ci,
        number: ci + 1,
        w: 1,
        h,
        x,
        y,
        z: STACK_BASE + k * CARD_T,
        vx: 0,
        vy: 0,
        vz: 0,
        yaw,
        yawV: 0,
        home: { x, y, z: STACK_BASE + k * CARD_T, yaw },
        mode: "stack",
        tx: x,
        ty: y,
        tyaw: yaw,
        restZ: STACK_BASE + k * CARD_T,
        q: [0, 0, 0, 1],
        flipA: 0,
        flipV: 0,
        flipT: 0,
        axis: [0, 1],
        dust: 0,
        dustRect: [0, 0, 0, 0],
        d0: 1,
        prog: 0,
        apex: 0.1,
        slot: -1,
        seed: rand() * 100,
      };
      items.push(it);
      stack.push(it);
    });
    const top = stack[stack.length - 1];
    const glx = (rand() - 0.5) * 0.05;
    const gly = -0.18 + (rand() - 0.5) * 0.08;
    const [gx, gy] = fromPack(glx, gly);
    const gyaw = pack.yaw + (rand() - 0.5) * 0.05;
    const gz = STACK_BASE + stack.length * CARD_T + GUM.t;
    const gum = {
      kind: "gum",
      w: GUM.w,
      h: GUM.h,
      x: gx,
      y: gy,
      z: gz,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: gyaw,
      yawV: 0,
      home: { x: gx, y: gy, z: gz, yaw: gyaw },
      mode: "stack",
      tx: gx,
      ty: gy,
      tyaw: gyaw,
      restZ: gz,
      q: [0, 0, 0, 1],
      flipA: 0,
      flipV: 0,
      flipT: 0,
      axis: [0, 1],
      d0: 1,
      prog: 0,
      apex: 0.08,
      slot: -1,
      seed: 3,
    };
    const [tlx, tly] = toPack(top.x, top.y);
    const ux = (glx - tlx) / top.w + 0.5;
    const uy = (gly - tly) / top.h + 0.5;
    top.dust = 1;
    top.dustRect = [ux - GUM.w / top.w / 2, uy - GUM.h / top.h / 2, ux + GUM.w / top.w / 2, uy + GUM.h / top.h / 2];
    items.push(gum);
    stack.push(gum);
    const [sx, sy] = fromPack(0, -PACK.H / 2 - PACK.TAB_H / 2 + 0.015);
    scrap = {
      kind: "scrap",
      w: PACK.TAB_W,
      h: PACK.TAB_H + 0.03,
      x: sx,
      y: sy,
      z: 0.03,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: pack.yaw,
      yawV: 0,
      home: { x: sx, y: sy, z: 0.03, yaw: pack.yaw },
      mode: "hidden",
      tx: sx,
      ty: sy,
      tyaw: pack.yaw,
      restZ: 0.003,
      q: [0, 0, 0, 1],
      flipA: 0,
      flipV: 0,
      flipT: 0,
      axis: [0, 1],
      d0: 1,
      prog: 0,
      apex: 0.05,
      slot: -1,
      seed: 5,
    };
    items.push(scrap);
    if (gumTex) gl.deleteTexture(gumTex);
    gumTex = makeTexture(gl, gumArt(seed), { premultiply: true, aniso });
    dealt = [];
    layerTop = 0;
    phase = "sealed";
    script = null;
    drawBaseCreases(crease, seed);
    creaseDirty = true;
  }

  function dprNow() {
    return Math.min(2, window.devicePixelRatio || 1);
  }

  function frame0(bounds) {
    const ins = insets();
    const availW = Math.max(40, width - ins.left - ins.right);
    const availH = Math.max(40, height - ins.top - ins.bottom);
    const bw = bounds.x1 - bounds.x0;
    const bh = bounds.y1 - bounds.y0;
    const s = Math.min(availW / bw, availH / bh, 360);
    const ox = (ins.left - ins.right) / 2;
    const oy = (ins.top - ins.bottom) / 2;
    return { x: (bounds.x0 + bounds.x1) / 2 - ox / s, y: (bounds.y0 + bounds.y1) / 2 - oy / s, s };
  }

  function openBounds() {
    const b = { x0: -1.3, x1: 1.3, y0: -1.2, y1: 1.16 };
    const cards = dealt.filter((d) => d.kind === "card");
    const reach = Math.min(layout.slots.length - 1, cards.length + 1);
    const grow = (x0, y0, x1, y1) => {
      b.x0 = Math.min(b.x0, x0);
      b.y0 = Math.min(b.y0, y0);
      b.x1 = Math.max(b.x1, x1);
      b.y1 = Math.max(b.y1, y1);
    };
    for (let i = 0; i <= reach; i += 1) {
      const sl = layout.slots[i];
      grow(sl.x - 0.58, sl.y - 0.96, sl.x + 0.58, sl.y + 0.96);
    }
    for (const it of dealt) {
      if (it.kind === "card" && it.slot >= 0) continue;
      grow(it.tx - it.w / 2 - 0.1, it.ty - it.h / 2 - 0.1, it.tx + it.w / 2 + 0.1, it.ty + it.h / 2 + 0.1);
    }
    return b;
  }

  function aimCamera(snap) {
    const opened = phase === "open" || tear.flipT > 0;
    const f = frame0(opened ? openBounds() : SEALED);
    cam.tx = f.x;
    cam.ty = f.y;
    cam.ts = f.s;
    if (snap) {
      cam.x = f.x;
      cam.y = f.y;
      cam.s = f.s;
      cam.vx = 0;
      cam.vy = 0;
      cam.vs = 0;
    }
  }

  function fit() {
    const rect = stage.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    dpr = dprNow();
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    layout = layoutFor(width / height);
    for (const it of dealt) {
      if (it.kind === "card" && it.slot >= 0) {
        const sl = layout.slots[it.slot];
        it.tx = sl.x;
        it.ty = sl.y;
        it.tyaw = sl.yaw;
        if (it.mode === "rest") it.mode = "fly";
        it.prog = 1;
      } else if (it.kind === "gum" && it.mode === "rest") {
        it.tx = clamp(it.tx, layout.open.x0, layout.open.x1);
        it.ty = clamp(it.ty, layout.open.y0, layout.open.y1);
        it.mode = "fly";
        it.prog = 1;
      }
    }
    const hw = clamp(Math.round(w / 3), 64, 900);
    const hh = clamp(Math.round(h / 3), 64, 900);
    if (!hmap || hmap.w !== hw || hmap.h !== hh) {
      if (hmap) {
        gl.deleteTexture(hmap.tex);
        gl.deleteFramebuffer(hmap.fbo);
      }
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(hw, hh))) + 1, gl.RGBA8, hw, hh);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      hmap = { tex, fbo, w: hw, h: hh };
      if (shade) {
        gl.deleteTexture(shade.tex);
        gl.deleteFramebuffer(shade.fbo);
      }
      const stex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, stex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, hw, hh);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const sfbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, sfbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      shade = { tex: stex, fbo: sfbo };
    }
    aimCamera(!fitted);
    fitted = true;
  }
  let fitted = false;

  function view() {
    const fpx = height / 2 / Math.tan(FOV / 2);
    const D = fpx / cam.s;
    const near = Math.max(0.2, D - 1.4);
    const far = D + 0.4;
    const A = (far + near) / (far - near);
    const B = (-2 * far * near) / (far - near);
    const hw = width / 2 / cam.s + 0.7;
    const hh = height / 2 / cam.s + 0.7;
    return {
      cam: [cam.x, cam.y, D],
      focal: [fpx / (width / 2), fpx / (height / 2)],
      depth: [A, B],
      hrect: [cam.x - hw, cam.y - hh, hw * 2, hh * 2],
      hpx: hmap ? hmap.w / (hw * 2) : 50,
    };
  }

  function unproject(clientX, clientY, z, v) {
    const rect = stage.getBoundingClientRect();
    const nx = ((clientX - rect.left) / width) * 2 - 1;
    const ny = 1 - ((clientY - rect.top) / height) * 2;
    const d = v.cam[2] - z;
    return [v.cam[0] + (nx * d) / v.focal[0], v.cam[1] - (ny * d) / v.focal[1]];
  }

  function inRect(it, x, y, pad = 0) {
    const c = Math.cos(it.yaw);
    const s = Math.sin(it.yaw);
    const dx = x - it.x;
    const dy = y - it.y;
    const lx = dx * c + dy * s;
    const ly = -dx * s + dy * c;
    return Math.abs(lx) <= it.w / 2 + pad && Math.abs(ly) <= it.h / 2 + pad;
  }

  function onPack(x, y, pad = 0.06) {
    const [lx, ly] = toPack(x, y);
    return Math.abs(lx) <= PACK.W / 2 + pad && ly >= -PACK.H / 2 - PACK.TAB_H - pad && ly <= PACK.H / 2 + pad;
  }

  function onTab(x, y) {
    const [lx, ly] = toPack(x, y);
    return Math.abs(lx) < PACK.TAB_W * 0.9 && ly < -PACK.H / 2 + 0.16 && ly > -PACK.H / 2 - PACK.TAB_H - 0.08;
  }

  function opened() {
    return tear.flip > 0.55;
  }

  function pick(x, y) {
    if (fade.target < 1) return null;
    if (!opened()) {
      if (tear.done) return null;
      if (onPack(x, y)) return { type: "tear" };
      return null;
    }
    const candidates = items.filter((it) => it.mode !== "stack" && it.mode !== "hidden" && it.kind !== "scrap" && inRect(it, x, y, 0.02)).sort((a, b) => b.z - a.z);
    if (candidates.length) {
      const it = candidates[0];
      if (it.kind === "card" && (it.mode === "rest" || it.mode === "flip")) return { type: "flip", it };
      return { type: "move", it };
    }
    if (stack.length && onPack(x, y, 0.04)) return { type: "move", it: stack[stack.length - 1], fromStack: true };
    return null;
  }

  function nextFreeSlot() {
    const used = new Set(dealt.filter((d) => d.kind === "card").map((d) => d.slot));
    for (let i = 0; i < layout.slots.length; i += 1) if (!used.has(i)) return i;
    return -1;
  }

  function nearestFreeSlot(x, y) {
    const used = new Set(dealt.filter((d) => d.kind === "card" && d.slot >= 0).map((d) => d.slot));
    let best = -1;
    let bestD = Infinity;
    layout.slots.forEach((sl, i) => {
      if (used.has(i)) return;
      const d = Math.hypot(sl.x - x, sl.y - y) + i * 0.12;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  function restHeightAt(it, x, y) {
    let z = it.kind === "gum" ? GUM.t + 0.003 : 0.0026;
    for (const o of dealt) {
      if (o === it || o.mode === "stack") continue;
      if (Math.abs(o.x - x) < (o.w + it.w) / 2 && Math.abs(o.y - y) < (o.h + it.h) / 2) z = Math.max(z, o.restZ + (it.kind === "gum" ? GUM.t : CARD_T));
    }
    if (it.kind === "gum" && Math.abs(toPack(x, y)[0]) < PACK.W / 2 + 0.7) z = Math.max(z, 0.012 + GUM.t);
    return z;
  }

  function launch(it, vx, vy, tap) {
    const idx = stack.indexOf(it);
    if (idx >= 0) stack.splice(idx, 1);
    if (!dealt.includes(it)) dealt.push(it);
    let tx;
    let ty;
    let tyaw;
    if (it.kind === "card") {
      const slot = tap ? nextFreeSlot() : nearestFreeSlot(it.x + vx * 0.32, it.y + vy * 0.32);
      it.slot = slot < 0 ? 0 : slot;
      const sl = layout.slots[it.slot];
      tx = sl.x;
      ty = sl.y;
      tyaw = sl.yaw;
    } else {
      const speed = Math.hypot(vx, vy);
      if (tap || (speed < 0.5 && onPack(it.x, it.y, 0.1))) {
        tx = layout.gum.x;
        ty = layout.gum.y;
        tyaw = layout.gum.yaw;
      } else {
        tx = clamp(it.x + vx * 0.3, layout.open.x0 + 0.5, layout.open.x1 - 0.5);
        ty = clamp(it.y + vy * 0.3, layout.open.y0 + 0.4, layout.open.y1 - 0.4);
        if (onPack(tx, ty, 0.3)) {
          tx = layout.gum.x;
          ty = layout.gum.y;
        }
        tyaw = it.yaw + clamp(vx * 0.05, -0.5, 0.5);
      }
    }
    layerTop += 1;
    it.layer = layerTop;
    it.tx = tx;
    it.ty = ty;
    it.tyaw = tyaw;
    it.restZ = restHeightAt(it, tx, ty);
    const dx = tx - it.x;
    const dy = ty - it.y;
    const d = Math.hypot(dx, dy) || 1e-4;
    const omega = it.kind === "gum" ? 4.4 : 5.2;
    if (tap) {
      it.vx = (dx / d) * omega * d * 0.95;
      it.vy = (dy / d) * omega * d * 0.95;
    } else {
      it.vx = vx;
      it.vy = vy;
    }
    const cross = (it.vx * dy - it.vy * dx) / d;
    it.yawV += clamp(-cross * 0.18, -2.4, 2.4);
    it.d0 = d;
    it.prog = 0;
    it.apex = reduced ? 0 : clamp(0.04 + d * 0.045, 0.05, 0.2) * (it.kind === "gum" ? 0.6 : 1);
    it.mode = "fly";
    aimCamera(false);
    announce();
  }

  function returnHome(it) {
    it.mode = "home";
    it.tx = it.home.x;
    it.ty = it.home.y;
    it.tyaw = it.home.yaw;
  }

  function ensureBack(it) {
    if (it.kind !== "card" || backTex[it.ci]) return;
    backTex[it.ci] = makeTexture(gl, backArt(CARDS[it.ci], it.number, fonts), { aniso });
  }

  function startFlip(it, nx, ny) {
    ensureBack(it);
    const len = Math.hypot(nx, ny) || 1;
    it.axis = [nx / len, ny / len];
    it.flipA = 0;
    it.flipV = 0;
    it.mode = "flip";
  }

  function commitFlip(it) {
    const [nx, ny] = it.axis;
    const qa = qaxis(-ny, nx, 0, Math.PI);
    const qy = qaxis(0, 0, 1, it.yaw);
    const qyi = qaxis(0, 0, 1, -it.yaw);
    it.q = qnorm(qmul(qyi, qmul(qa, qmul(qy, it.q))));
    it.flipA = 0;
    it.flipV = 0;
    it.flipT = 0;
    it.mode = "rest";
  }

  function flipExtent(it) {
    const [nx, ny] = it.axis;
    const c = Math.cos(it.yaw);
    const s = Math.sin(it.yaw);
    return Math.abs(nx * c + ny * s) * it.w + Math.abs(-nx * s + ny * c) * it.h;
  }

  function fillPath(oldV, oldU, newV, newU) {
    const span = newV - oldV;
    for (let r = 0; r < PATH_N; r += 1) {
      const v = r / (PATH_N - 1);
      if (v > oldV && v <= newV + 1e-6) {
        const t = span > 1e-6 ? (v - oldV) / span : 1;
        tear.path[r] = oldU + (newU - oldU) * t;
      }
    }
    if (oldV < 0) tear.path[0] = Math.max(0, newV) === 0 ? newU : tear.path[0];
  }

  function stampAround(u, v) {
    const W = PACK.W;
    const H = PACK.H;
    for (let k = 0; k < 2; k += 1) {
      const side = k === 0 ? -1 : 1;
      const off = (0.03 + rand() * 0.12) * side;
      const uu = clamp(u + off / W, 0.02, 0.98);
      const vv = clamp(v - (0.02 + rand() * 0.18) / H, 0.0, 1);
      const angle = Math.PI / 2 - side * (0.5 + rand() * 0.75);
      stampCrease(crease, rand, uu, vv, angle, 0.06 + rand() * rand() * 0.34, 0.8 + rand() * 1.2);
    }
    if (rand() < 0.45) {
      const side = rand() > 0.5 ? 1 : -1;
      stampCrease(crease, rand, clamp(u + side * (0.02 + rand() * 0.05) / W, 0, 1), clamp(v - rand() * 0.25, 0, 1), Math.PI / 2 + (rand() - 0.5) * 0.4, 0.05 + rand() * 0.12, 1 + rand());
    }
    creaseDirty = true;
  }

  function holdScrap(px, py) {
    scrap.mode = "held";
    scrap.gx = scrap.x - px;
    scrap.gy = scrap.y - py;
    scrap.tx = scrap.x;
    scrap.ty = scrap.y;
    scrap.tyaw = pack.yaw + 0.12;
  }

  function dropScrap(vx, vy) {
    if (scrap.mode !== "held") return;
    let tx = scrap.x + vx * 0.22;
    let ty = scrap.y + vy * 0.22;
    const [lx, ly] = toPack(tx, ty);
    if (Math.abs(lx) < PACK.W / 2 + 0.35 && Math.abs(ly) < PACK.H / 2 + 0.35) {
      const [ox, oy] = fromPack(-PACK.W / 2 - 0.3, -PACK.H / 2 + 0.2);
      tx = ox;
      ty = oy;
    }
    tx = clamp(tx, cam.x - width / 2 / cam.s + 0.3, cam.x + width / 2 / cam.s - 0.3);
    ty = clamp(ty, cam.y - height / 2 / cam.s + 0.3, cam.y + height / 2 / cam.s - 0.3);
    scrap.tx = tx;
    scrap.ty = ty;
    scrap.tyaw = scrap.yaw + clamp(vx * 0.08, -0.9, 0.9) + 0.4;
    scrap.restZ = 0.0016;
    scrap.d0 = Math.hypot(tx - scrap.x, ty - scrap.y) || 1e-3;
    scrap.prog = 0;
    scrap.apex = reduced ? 0 : 0.05;
    scrap.vx = vx;
    scrap.vy = vy;
    scrap.mode = "fly";
  }

  function startTear() {
    if (tear.started) return;
    tear.started = true;
    tear.tipV = VMIN - 0.005;
    tear.tipU = 0.5;
    tear.path.fill(0.5 + (rand() - 0.5) * 0.01);
    phase = "torn";
    stampCrease(crease, rand, 0.5 - 0.08 / PACK.W, 0.01, Math.PI / 2 + 0.6, 0.18, 1.4);
    stampCrease(crease, rand, 0.5 + 0.08 / PACK.W, 0.01, Math.PI / 2 - 0.6, 0.18, 1.4);
    creaseDirty = true;
    onChange({ phase });
  }

  function advanceTear(dt, targetU, targetV, rateCap) {
    const W = PACK.W;
    const H = PACK.H;
    const dxw = (targetU - tear.tipU) * W;
    const dyw = (targetV - tear.tipV) * H;
    if (dyw <= 0.003) return false;
    let ang = Math.atan2(dxw, dyw);
    ang = clamp(ang, -0.6, 0.6);
    const dist = Math.hypot(dxw, dyw);
    const step = Math.min(dist * (1 - Math.exp(-dt * 16)), rateCap * dt);
    if (step < 1e-5) return false;
    const oldU = tear.tipU;
    const oldV = tear.tipV;
    const wob = (rand() - 0.5) * 0.18;
    let nv = oldV + (step * Math.cos(ang + wob)) / H;
    let nu = oldU + (step * Math.sin(ang + wob)) / W;
    nu = clamp(nu, 0.22, 0.78);
    if (nv >= 0.985) nv = 1.03;
    tear.tipU = nu;
    tear.tipV = nv;
    fillPath(oldV, oldU, Math.min(1, nv), nu);
    tear.creaseAcc += step;
    while (tear.creaseAcc > 0.07) {
      tear.creaseAcc -= 0.07;
      stampAround(nu, Math.min(1, nv));
    }
    if (nv >= 1) {
      tear.done = true;
      tear.flipT = 1;
      tear.flipV = Math.max(tear.flipV, 0.4 + Math.min(1.2, step / dt / 6));
      if (grab && grab.type === "tear") grab = null;
      if (scrap.mode === "held") dropScrap(pointer.vx / cam.s, pointer.vy / cam.s);
      script = null;
      for (let r = 0; r < PATH_N; r += 1) if (r / (PATH_N - 1) > oldV) tear.path[r] = nu;
      aimCamera(false);
      announce("The wrapper falls open.");
    }
    return true;
  }

  function announce(text) {
    onChange({ phase: opened() || tear.done ? "open" : phase, dealt: dealt.filter((d) => d.kind === "card").length, message: text });
  }

  function stepPointer(dt, v) {
    if (!pointer.has) return;
    const z = grab && grab.it ? grab.it.z : 0.05;
    const [wx, wy] = unproject(pointer.cx, pointer.cy, z, v);
    if (pointer.down || pendingRelease) {
      const instX = (pointer.cx - pointer.px) / dt;
      const instY = (pointer.cy - pointer.py) / dt;
      const k = 1 - Math.exp(-dt * 22);
      pointer.vx += (instX - pointer.vx) * k;
      pointer.vy += (instY - pointer.vy) * k;
      pointer.hold += dt;
      pointer.travel += Math.hypot(wx - pointer.wx, wy - pointer.wy);
    } else {
      pointer.vx = 0;
      pointer.vy = 0;
    }
    pointer.px = pointer.cx;
    pointer.py = pointer.cy;
    pointer.wx = wx;
    pointer.wy = wy;
  }

  function releaseGrab() {
    if (!grab) return;
    const g = grab;
    grab = null;
    const vx = pointer.vx / cam.s;
    const vy = pointer.vy / cam.s;
    const speed = Math.hypot(vx, vy);
    const cap = 9;
    const scale = speed > cap ? cap / speed : 1;
    const tap = pointer.travel < 0.03 && pointer.hold < 0.35;
    if (g.type === "tear") {
      dropScrap(vx * scale, vy * scale);
      const [lx, ly] = toPack(pointer.wx + vx * scale * 0.16, pointer.wy + vy * scale * 0.16);
      tear.targetU = lx / PACK.W + 0.5;
      tear.targetV = Math.max(tear.tipV, ly / PACK.H + 0.5);
      if (tap && !tear.done && tear.tipV < 0.1) {
        tear.targetV = Math.max(tear.targetV, 0.16);
        tear.targetU = 0.5 + (rand() - 0.5) * 0.08;
      }
      return;
    }
    if (g.type === "move") {
      const it = g.it;
      const wasStack = it.mode === "held" && g.fromStack;
      if (wasStack && !tap && speed < 0.7 && onPack(it.x, it.y, -0.12)) {
        returnHome(it);
        return;
      }
      if (it.kind === "card" && it.slot >= 0 && !wasStack) {
        dealt.splice(dealt.indexOf(it), 1);
        it.slot = -1;
      }
      launch(it, vx * scale, vy * scale, tap && wasStack);
      return;
    }
    if (g.type === "flip") {
      const it = g.it;
      if (!g.chosen) {
        const c = Math.cos(it.yaw);
        const s = Math.sin(it.yaw);
        startFlip(it, c, s);
        it.flipT = Math.PI;
        it.flipV = 2;
        return;
      }
      const vn = vx * it.axis[0] + vy * it.axis[1];
      const reach = Math.max(it.flipA, it.flipT);
      it.flipT = reach > Math.PI / 2 || (vn > 1.1 && reach > 0.08) ? Math.PI : 0;
      if (vn < -1.1 && reach < Math.PI * 0.8) it.flipT = 0;
    }
  }

  function stepGrab(dt) {
    if (!grab) return;
    if (grab.type === "tear") {
      const [lx, ly] = toPack(pointer.wx, pointer.wy);
      tear.targetU = lx / PACK.W + 0.5;
      tear.targetV = ly / PACK.H + 0.5;
      if (scrap.mode === "held") {
        scrap.tx = pointer.wx + scrap.gx;
        scrap.ty = pointer.wy + scrap.gy;
      }
      return;
    }
    if (grab.type === "move") {
      const it = grab.it;
      it.tx = pointer.wx + grab.gx;
      it.ty = pointer.wy + grab.gy;
      return;
    }
    if (grab.type === "flip") {
      const it = grab.it;
      const dx = pointer.wx - grab.dx;
      const dy = pointer.wy - grab.dy;
      if (!grab.chosen && Math.hypot(dx, dy) > 0.04) {
        grab.chosen = true;
        startFlip(it, dx, dy);
      }
      if (grab.chosen) {
        const s = (dx * it.axis[0] + dy * it.axis[1]) / Math.max(0.3, flipExtent(it));
        it.flipT = Math.PI * clamp(s * 1.05, 0, 1);
      }
    }
    void dt;
  }

  function stepTear(dt) {
    let active = false;
    if (!tear.started) {
      const tabT = hoverTab ? 1 : 0;
      [tear.tab, tear.tabV] = springStep(tear.tab, tear.tabV, tabT, 14, 1, dt);
      return Math.abs(tear.tab - tabT) > 1e-3 || Math.abs(tear.tabV) > 1e-3;
    }
    if (script) {
      script.t += dt;
      tear.targetU = 0.5 + Math.sin(script.t * 2.1) * 0.06 + script.t * 0.02;
      tear.targetV = Math.min(1.1, VMIN + script.t * (reduced ? 2.4 : 0.85));
      if (scrap.mode === "held") {
        const [tx, ty] = fromPack((tear.tipU - 0.5) * PACK.W, (tear.tipV - 0.5) * PACK.H - 0.02);
        scrap.tx = tx;
        scrap.ty = ty;
      }
    }
    if (!tear.done) {
      const moved = advanceTear(dt, tear.targetU, tear.targetV, reduced ? 9 : 6.5);
      active = active || moved || Boolean(grab && grab.type === "tear") || Boolean(script);
    }
    const curlT = tear.done ? 1 : grab && grab.type === "tear" ? 1 : script ? 1 : 0.8;
    [tear.curl, tear.curlV] = springStep(tear.curl, tear.curlV, curlT, reduced ? 20 : 9, 1, dt);
    [tear.tab, tear.tabV] = springStep(tear.tab, tear.tabV, 1, 14, 1, dt);
    const flipOmega = reduced ? 9 : 3.6;
    [tear.flip, tear.flipV] = springStep(tear.flip, tear.flipV, tear.flipT, flipOmega, 1, dt);
    if (tear.flipT > 0 && tear.flip > 0.55 && phase !== "open") {
      phase = "open";
      announce("Flick the cards out of the pack.");
    }
    if (tear.flipT > 0 && Math.abs(tear.flip - tear.flipT) < 2e-4 && Math.abs(tear.flipV) < 2e-3) {
      tear.flip = tear.flipT;
      tear.flipV = 0;
    } else if (tear.flipT > 0) active = true;
    if (Math.abs(tear.curl - curlT) > 1e-4 || Math.abs(tear.curlV) > 1e-3) active = true;
    return active;
  }

  function stepItem(it, dt) {
    let active = false;
    if (it.mode === "hidden") return false;
    if (it.mode === "held") {
      [it.x, it.vx] = springStep(it.x, it.vx, it.tx, 34, 1, dt);
      [it.y, it.vy] = springStep(it.y, it.vy, it.ty, 34, 1, dt);
      [it.z, it.vz] = springStep(it.z, it.vz, it.kind === "scrap" ? 0.13 : HELD_Z, 18, 1, dt);
      const lean = clamp(it.vx * 0.012, -0.12, 0.12);
      [it.yaw, it.yawV] = springStep(it.yaw, it.yawV, it.tyaw + lean, 10, 1, dt);
      return true;
    }
    if (it.mode === "fly" || it.mode === "home") {
      const omega = it.kind === "gum" ? 4.4 : it.kind === "scrap" ? 6 : 5.2;
      const sub = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / sub;
      for (let k = 0; k < sub; k += 1) {
        [it.x, it.vx] = springStep(it.x, it.vx, it.tx, omega, 1, h);
        [it.y, it.vy] = springStep(it.y, it.vy, it.ty, omega, 1, h);
        [it.yaw, it.yawV] = springStep(it.yaw, it.yawV, it.tyaw, reduced ? 8 : 4.2, 0.82, h);
      }
      const dist = Math.hypot(it.tx - it.x, it.ty - it.y);
      const targetZ = it.mode === "home" ? it.home.z : it.restZ;
      if (it.mode === "home") {
        [it.z, it.vz] = springStep(it.z, it.vz, targetZ, 14, 1, dt);
      } else {
        it.prog = Math.max(it.prog, 1 - dist / Math.max(it.d0, 1e-3));
        const air = it.prog < 0.68 ? Math.sin((Math.PI * it.prog) / 0.68) : 0;
        const zT = targetZ + it.apex * Math.pow(air, 0.8);
        [it.z, it.vz] = springStep(it.z, it.vz, zT, 16, 1, dt);
      }
      const settled = dist < 6e-4 && Math.hypot(it.vx, it.vy) < 0.004 && Math.abs(it.yaw - it.tyaw) < 6e-4 && Math.abs(it.yawV) < 0.004 && Math.abs(it.z - targetZ) < 3e-4;
      if (settled) {
        it.x = it.tx;
        it.y = it.ty;
        it.yaw = it.tyaw;
        it.z = targetZ;
        it.vx = 0;
        it.vy = 0;
        it.vz = 0;
        it.yawV = 0;
        if (it.mode === "home") {
          it.mode = "stack";
          it.restZ = it.home.z;
        } else it.mode = "rest";
      } else active = true;
      return active;
    }
    if (it.mode === "flip") {
      const held = grab && grab.it === it;
      [it.flipA, it.flipV] = springStep(it.flipA, it.flipV, it.flipT, held ? 26 : reduced ? 20 : 11, 1, dt);
      const ext = flipExtent(it) / 2;
      it.z = it.restZ + Math.sin(clamp(it.flipA, 0, Math.PI)) * ext * 1.01 + 0.004 * Math.sin(clamp(it.flipA, 0, Math.PI));
      if (!held) {
        if (it.flipT >= Math.PI && it.flipA > Math.PI - 0.004) {
          commitFlip(it);
          it.z = it.restZ;
          announce(`Card turned over.`);
          return false;
        }
        if (it.flipT <= 0 && it.flipA < 0.002 && Math.abs(it.flipV) < 0.01) {
          it.flipA = 0;
          it.flipV = 0;
          it.mode = "rest";
          it.z = it.restZ;
          return false;
        }
      }
      return true;
    }
    return false;
  }

  function stepCamera(dt) {
    const o = reduced ? 8 : 2.6;
    [cam.x, cam.vx] = springStep(cam.x, cam.vx, cam.tx, o, 1, dt);
    [cam.y, cam.vy] = springStep(cam.y, cam.vy, cam.ty, o, 1, dt);
    let ls = Math.log(cam.s);
    [ls, cam.vs] = springStep(ls, cam.vs, Math.log(cam.ts), o, 1, dt);
    cam.s = Math.exp(ls);
    const done = Math.abs(cam.x - cam.tx) * cam.s < 0.05 && Math.abs(cam.y - cam.ty) * cam.s < 0.05 && Math.abs(cam.s / cam.ts - 1) < 2e-4 && Math.abs(cam.vx) * cam.s < 0.05 && Math.abs(cam.vy) * cam.s < 0.05;
    if (done) {
      cam.x = cam.tx;
      cam.y = cam.ty;
      cam.s = cam.ts;
      cam.vx = 0;
      cam.vy = 0;
      cam.vs = 0;
      return false;
    }
    return true;
  }

  function stepFade(dt) {
    if (fade.value === fade.target) return false;
    const rate = fade.target < fade.value ? 1 / 0.2 : 1 / 0.42;
    if (fade.target < fade.value) fade.value = Math.max(fade.target, fade.value - rate * dt);
    else fade.value = Math.min(fade.target, fade.value + rate * dt);
    if (fade.value === fade.target && fade.then) {
      const then = fade.then;
      fade.then = null;
      then();
    }
    return true;
  }

  function step(dt) {
    const v = view();
    stepPointer(dt, v);
    if (pendingRelease) {
      pendingRelease = false;
      releaseGrab();
    }
    stepGrab(dt);
    let active = Boolean(grab) || pointer.down;
    active = stepTear(dt) || active;
    for (const it of items) active = stepItem(it, dt) || active;
    active = stepCamera(dt) || active;
    active = stepFade(dt) || active;
    return active;
  }

  function setView(prog, v, heightPass) {
    const u = prog.u;
    if (u.uCam) gl.uniform3fv(u.uCam, v.cam);
    if (u.uFocal) gl.uniform2fv(u.uFocal, v.focal);
    if (u.uDepth) gl.uniform2fv(u.uDepth, v.depth);
    if (u.uHeightPass) gl.uniform1f(u.uHeightPass, heightPass ? 1 : 0);
    if (u.uHRect) gl.uniform4fv(u.uHRect, v.hrect);
    if (u.uHPx) gl.uniform1f(u.uHPx, v.hpx);
    if (u.uShadowFade) gl.uniform1f(u.uShadowFade, fade.value);
    if (u.uHeight) gl.uniform1i(u.uHeight, 2);
    if (u.uNoise) gl.uniform1i(u.uNoise, 3);
  }

  function drawItems(v, heightPass, list) {
    const u = cardProg.u;
    gl.useProgram(cardProg.program);
    setView(cardProg, v, heightPass);
    gl.uniform1i(u.uFront, 0);
    gl.uniform1i(u.uBack, 1);
    gl.uniform1f(u.uAlpha, fade.value);
    gl.bindVertexArray(quad.vao);
    for (const it of list) {
      if (it.mode === "hidden") continue;
      if (it === "tray") {
        qmat(qaxis(0, 0, 1, pack.yaw), rot);
        gl.uniformMatrix3fv(u.uRot, false, rot);
        gl.uniform3f(u.uPos, pack.x, pack.y, 0.006);
        gl.uniform2f(u.uSize, PACK.W - 0.02, PACK.H - 0.02);
        gl.uniform1f(u.uRadius, 0.03);
        gl.uniform1f(u.uMode, 2);
        gl.uniform1f(u.uDust, 0);
        gl.uniform1f(u.uSeed, 1);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        continue;
      }
      let q = qmul(qaxis(0, 0, 1, it.yaw), it.q);
      if (it.mode === "flip" && it.flipA !== 0) q = qmul(qaxis(-it.axis[1], it.axis[0], 0, it.flipA), q);
      qmat(q, rot);
      gl.uniformMatrix3fv(u.uRot, false, rot);
      gl.uniform3f(u.uPos, it.x, it.y, it.z);
      gl.uniform2f(u.uSize, it.w, it.h);
      gl.uniform1f(u.uSeed, it.seed);
      if (it.kind === "scrap") {
        gl.uniform1f(u.uMode, 3);
        gl.uniform1f(u.uRadius, 0.02);
        gl.uniform1f(u.uDust, 0);
        gl.uniform4f(u.uScrap, PACK.TAB_W / PACK.W, it.h / PACK.H, VMIN, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, artTex);
        gl.uniform1f(u.uHasBack, 0);
      } else if (it.kind === "gum") {
        gl.uniform1f(u.uMode, 1);
        gl.uniform1f(u.uRadius, 0.02);
        gl.uniform1f(u.uDust, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, gumTex);
        gl.uniform1f(u.uHasBack, 0);
      } else {
        gl.uniform1f(u.uMode, 0);
        gl.uniform1f(u.uRadius, 0.045);
        gl.uniform1f(u.uDust, it.dust);
        gl.uniform4fv(u.uDustRect, it.dustRect);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, frontTex[it.ci]);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, backTex[it.ci] || dummy);
        gl.uniform1f(u.uHasBack, backTex[it.ci] ? 1 : 0);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  function drawFlaps(v, heightPass) {
    const u = flapProg.u;
    gl.useProgram(flapProg.program);
    setView(flapProg, v, heightPass);
    const [c, s] = packCos();
    gl.uniform4f(u.uPack, pack.x, pack.y, c, s);
    gl.uniform3f(u.uDims, PACK.W, PACK.H, PACK.h);
    gl.uniform1f(u.uVMin, VMIN);
    gl.uniform1f(u.uTip, tear.started ? tear.tipV : VMIN - 0.05);
    gl.uniform1f(u.uCurl, tear.curl);
    gl.uniform1f(u.uFlip, tear.flip);
    gl.uniform1f(u.uTabLift, tear.tab);
    gl.uniform1fv(u.uPath, tear.path);
    gl.uniform1f(u.uGrid, GU);
    gl.uniform1f(u.uTabW, PACK.TAB_W);
    gl.uniform1f(u.uTabCut, tear.started ? 1 : 0);
    gl.uniform1f(u.uAlpha, fade.value);
    gl.uniform1i(u.uArt, 0);
    gl.uniform1i(u.uCrease, 1);
    gl.uniform1i(u.uRag, 4);
    gl.uniform2f(u.uCreaseTexel, 1.2 / crease.canvas.width, 1.2 / crease.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, artTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, creaseTex);
    gl.bindVertexArray(grid.vao);
    let lo = 1;
    let hi = 0;
    for (let i = 0; i < PATH_N; i += 1) {
      lo = Math.min(lo, tear.path[i]);
      hi = Math.max(hi, tear.path[i]);
    }
    for (const side of [-1, 1]) {
      gl.uniform1f(u.uSide, side);
      if (side < 0) gl.uniform2f(u.uRange, 0, Math.min(1, hi + 0.045));
      else gl.uniform2f(u.uRange, Math.max(0, lo - 0.045), 1);
      gl.drawElements(gl.TRIANGLES, grid.count, gl.UNSIGNED_SHORT, 0);
    }
  }

  function render() {
    if (destroyed || gl.isContextLost()) return;
    if (creaseDirty) {
      gl.bindTexture(gl.TEXTURE_2D, creaseTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, crease.canvas);
      creaseDirty = false;
    }
    const v = view();
    const sorted = [...items].sort((a, b) => a.z - b.z);
    const flapsFirst = tear.flip > 0.5;

    gl.bindFramebuffer(gl.FRAMEBUFFER, hmap.fbo);
    gl.viewport(0, 0, hmap.w, hmap.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, noiseTex);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, ragTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, dummy);
    drawItems(v, true, ["tray", ...sorted]);
    drawFlaps(v, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.blendEquation(gl.FUNC_ADD);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, hmap.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shade.fbo);
    gl.viewport(0, 0, hmap.w, hmap.h);
    gl.useProgram(shadeProg.program);
    setView(shadeProg, v, false);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, shade.tex);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(GROUND[0], GROUND[1], GROUND[2], 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.useProgram(tableProg.program);
    setView(tableProg, v, false);
    gl.uniform3fv(tableProg.u.uGround, GROUND);
    gl.uniform1i(tableProg.u.uShade, 5);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (flapsFirst) {
      drawItems(v, false, ["tray"]);
      drawFlaps(v, false);
      drawItems(v, false, sorted);
    } else {
      drawItems(v, false, ["tray", ...sorted]);
      drawFlaps(v, false);
    }
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  function frame(now) {
    raf = 0;
    if (destroyed) return;
    const dt = last ? clamp((now - last) / 1000, 1 / 240, 1 / 30) : 1 / 60;
    last = now;
    const active = step(dt);
    render();
    if (active) kick();
    else last = 0;
  }

  function kick() {
    if (destroyed || raf || !visible || document.hidden) return;
    raf = requestAnimationFrame(frame);
  }

  function setCursor(target) {
    if (grab) canvas.style.cursor = "grabbing";
    else canvas.style.cursor = target ? "grab" : "default";
  }

  function onPointerDown(event) {
    if (grab || event.button > 0) return;
    const v = view();
    const [x, y] = unproject(event.clientX, event.clientY, 0.05, v);
    const target = pick(x, y);
    if (!target) return;
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {}
    script = null;
    pointer.cx = event.clientX;
    pointer.cy = event.clientY;
    pointer.px = event.clientX;
    pointer.py = event.clientY;
    pointer.has = true;
    pointer.down = true;
    pointer.id = event.pointerId;
    pointer.type = event.pointerType;
    pointer.vx = 0;
    pointer.vy = 0;
    pointer.hold = 0;
    pointer.travel = 0;
    pointer.wx = x;
    pointer.wy = y;
    if (target.type === "tear") {
      if (!tear.started) holdScrap(x, y);
      startTear();
      grab = { type: "tear" };
    } else if (target.type === "move") {
      const it = target.it;
      if (it.kind === "card" && it.mode === "flip") return;
      grab = { type: "move", it, gx: it.x - x, gy: it.y - y, fromStack: it.mode === "stack" || target.fromStack };
      if (it.mode === "stack") {
        it.tyaw = it.yaw;
      } else it.tyaw = it.yaw;
      it.mode = "held";
      it.tx = it.x;
      it.ty = it.y;
    } else if (target.type === "flip") {
      const it = target.it;
      grab = { type: "flip", it, dx: x, dy: y, chosen: it.mode === "flip" };
      if (it.mode !== "flip") {
        it.axis = [Math.cos(it.yaw), Math.sin(it.yaw)];
      }
    }
    setCursor(true);
    kick();
  }

  function onPointerMove(event) {
    if (grab && pointer.id === event.pointerId) {
      pointer.cx = event.clientX;
      pointer.cy = event.clientY;
      kick();
      return;
    }
    if (event.pointerType === "touch") return;
    const v = view();
    const [x, y] = unproject(event.clientX, event.clientY, 0.05, v);
    const target = pick(x, y);
    const overTab = !tear.started && onTab(x, y);
    if (overTab !== hoverTab) {
      hoverTab = overTab;
      kick();
    }
    setCursor(Boolean(target));
  }

  function onPointerUp(event) {
    if (pointer.id !== event.pointerId) return;
    pointer.cx = event.clientX;
    pointer.cy = event.clientY;
    pointer.down = false;
    pointer.id = null;
    if (grab) pendingRelease = true;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {}
    setCursor(false);
    kick();
  }

  function onPointerLeave() {
    if (grab) return;
    if (hoverTab) {
      hoverTab = false;
      kick();
    }
  }

  function onTouchStart(event) {
    const t = event.touches[0];
    if (!t) return;
    const [x, y] = unproject(t.clientX, t.clientY, 0.05, view());
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
    kick();
  });
  resizeObserver.observe(stage);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) kick();
  });
  io.observe(stage);

  buildScene();
  fit();
  render();
  onChange({ phase, dealt: 0 });

  function reset() {
    if (fade.target === 0) return;
    grab = null;
    pendingRelease = false;
    fade.target = 0;
    fade.then = () => {
      buildScene();
      aimCamera(false);
      fade.target = 1;
      onChange({ phase, dealt: 0, message: "A fresh pack." });
    };
    kick();
  }

  function key(name) {
    if (fade.target < 1) return false;
    if (name === "next") {
      if (!tear.started) {
        holdScrap(scrap.x, scrap.y);
        startTear();
        script = { t: 0 };
        kick();
        return true;
      }
      if (!tear.done) {
        script = script || { t: Math.max(0, (tear.tipV - VMIN) / 0.85) };
        kick();
        return true;
      }
      if (!opened()) return true;
      const top = stack[stack.length - 1];
      if (!top) return false;
      if (top.mode !== "stack") return true;
      launch(top, 0, 0, true);
      kick();
      return true;
    }
    if (name === "flip") {
      const cards = dealt.filter((d) => d.kind === "card" && d.mode === "rest");
      const it = cards[cards.length - 1];
      if (!it) return false;
      startFlip(it, Math.cos(it.yaw), Math.sin(it.yaw));
      it.flipT = Math.PI;
      it.flipV = 2;
      kick();
      return true;
    }
    return false;
  }

  return {
    reset,
    key,
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
      for (const tex of frontTex) gl.deleteTexture(tex);
      for (const tex of backTex) if (tex) gl.deleteTexture(tex);
      gl.deleteTexture(artTex);
      gl.deleteTexture(creaseTex);
      gl.deleteTexture(dummy);
      gl.deleteTexture(noiseTex);
      gl.deleteTexture(ragTex);
      if (shade) {
        gl.deleteTexture(shade.tex);
        gl.deleteFramebuffer(shade.fbo);
      }
      if (gumTex) gl.deleteTexture(gumTex);
      if (hmap) {
        gl.deleteTexture(hmap.tex);
        gl.deleteFramebuffer(hmap.fbo);
      }
      gl.deleteBuffer(grid.vb);
      gl.deleteBuffer(grid.ib);
      gl.deleteBuffer(quad.vb);
      gl.deleteVertexArray(grid.vao);
      gl.deleteVertexArray(quad.vao);
      gl.deleteVertexArray(emptyVao);
      gl.deleteProgram(tableProg.program);
      gl.deleteProgram(cardProg.program);
      gl.deleteProgram(flapProg.program);
      gl.deleteProgram(shadeProg.program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

