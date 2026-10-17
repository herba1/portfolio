import { FRAME_COUNT, TEX_H, TEX_W, drawCover, drawFrame } from "./riffleDraw";
import { createRiffleGL } from "./riffleGL";

const N = FRAME_COUNT;
const LAST = N - 1;
const TAU = 0.0085;
const BOARD = 0.03;
const SUB = 1 / 240;
const PI = Math.PI;
const BOOK_YAW = -4.5 * (PI / 180);
const ELEVATION = 63 * (PI / 180);
const FOV = 24 * (PI / 180);
const GROUND = [0.925, 0.918, 0.9];
const LIGHT = (() => {
  const v = [0.36, 0.24, 0.9];
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
})();
const MAX_SPEED = 30;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function hash(i, k) {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function mul4(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function lookAt(eye, target, up) {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  let l = Math.hypot(zx, zy, zz);
  zx /= l;
  zy /= l;
  zz /= l;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz);
  xx /= l;
  xy /= l;
  xz /= l;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1,
  ]);
}

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

function ortho(l, r, b, t, n, f) {
  return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
}

function transform(m, p) {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [x / w, y / w, z / w, w];
}

export function createRiffleEngine({ box, stage, canvas, insets, embedded, onReady, onFail, onFrame }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const view = { width: 1, height: 1, dpr: 1, wide: true };
  const geo = { ls: 1.4, lt: 1, map: null, mapOff: null, flipDet: 1, vp: null, lightVP: null, cam: [0, 0, 0], penScale: 1, bias: 0, corner: [0, 0, 0, 0], curlK: 1, axis: [-1, 0], pitch: 20, rect: [0, 0, 0, 0], foot: [0, 0, 0, 0] };
  const pages = Array.from({ length: N }, (_, i) => ({
    theta: 0,
    vtheta: 0,
    curl: 0,
    vcurl: 0,
    k: 0,
    released: false,
    js: (hash(i, 1) - 0.5) * 2,
    jt: (hash(i, 2) - 0.5) * 2,
    jr: (hash(i, 3) - 0.5) * 2,
    seed: hash(i, 4),
  }));
  const riffle = { p: 0, target: 0, v: 0, vs: 0, mode: "settle", goal: 0 };
  const pointer = { id: null, x: 0, y: 0, sx: 0, sy: 0, p0: 0, down: false };
  const instances = new Float32Array((N + 2) * 12);
  const shadowInstances = new Float32Array((N + 2) * 12);
  const shadowSize = window.matchMedia("(pointer: coarse)").matches ? 1024 : 1536;
  const drawn = new Array(N).fill(false);
  let drawnMask = 0;
  let gl = null;
  let failed = false;
  let visible = false;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let ready = false;
  let shownFrame = -1;
  let drawQueue = null;
  let paint = null;
  let card = null;

  function buildGeometry() {
    const wide = view.wide;
    const ls = wide ? 1.4 : 1.0;
    const lt = wide ? 1.0 : 1.4;
    geo.ls = ls;
    geo.lt = lt;
    const c = Math.cos(BOOK_YAW);
    const s = Math.sin(BOOK_YAW);
    const a = wide ? [1, 0, 0, 0, -1, 0, 0, 0, 1] : [0, -1, 0, 1, 0, 0, 0, 0, 1];
    const off = wide ? [0, lt / 2, 0] : [-lt / 2, 0, 0];
    const rot = (x, y) => [c * x - s * y, s * x + c * y];
    const cols = [];
    for (let k = 0; k < 3; k += 1) {
      const [x, y] = rot(a[k * 3], a[k * 3 + 1]);
      cols.push(x, y, a[k * 3 + 2]);
    }
    geo.map = new Float32Array(cols);
    const [ox, oy] = rot(off[0], off[1]);
    geo.mapOff = new Float32Array([ox, oy, off[2]]);
    geo.flipDet = 1;
    const n = [1, 0.85];
    const nl = Math.hypot(n[0], n[1]);
    const nx = n[0] / nl;
    const ny = n[1] / nl;
    const reach = 0.4 * Math.min(ls, lt);
    geo.corner = new Float32Array([nx, ny, ls * nx + lt * ny, reach]);
    geo.curlK = 1.75 / reach;
    geo.foot = new Float32Array(wide ? [0, 0, ls + 0.04, lt / 2 + 0.03] : [0, 0, lt / 2 + 0.03, ls + 0.04]);
    geo.footRot = new Float32Array([Math.cos(BOOK_YAW), Math.sin(BOOK_YAW)]);
  }

  function toWorld(sl, tl, z) {
    const m = geo.map;
    return [m[0] * sl + m[3] * tl + m[6] * z + geo.mapOff[0], m[1] * sl + m[4] * tl + m[7] * z + geo.mapOff[1], m[2] * sl + m[5] * tl + m[8] * z + geo.mapOff[2]];
  }

  function layout() {
    const pad = insets();
    const availW = Math.max(120, view.width - pad.side * 2);
    const availH = Math.max(120, view.height - pad.top - pad.bottom);
    view.wide = availW / availH > 1.08;
    buildGeometry();
    const { ls, lt } = geo;
    const target = [0, 0, 0.08];
    const aspect = view.width / view.height;
    const proj = perspective(FOV, aspect, 0.1, 60);
    const pts = [];
    const stackTop = BOARD + N * TAU;
    for (const sl of [-ls - 0.04, ls + 0.04]) for (const tl of [-0.03, lt + 0.03]) for (const z of [0, stackTop]) pts.push(toWorld(sl, tl, z));
    for (const tl of [0, lt]) pts.push(toWorld(0, tl, ls * 0.3));
    let dist = 7;
    let cx = 0;
    let cy = 0;
    let vpm = null;
    let eye = null;
    for (let it = 0; it < 4; it += 1) {
      eye = [target[0], target[1] - dist * Math.cos(ELEVATION), target[2] + dist * Math.sin(ELEVATION)];
      vpm = mul4(proj, lookAt(eye, target, [0, 0, 1]));
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of pts) {
        const q = transform(vpm, p);
        minX = Math.min(minX, q[0]);
        maxX = Math.max(maxX, q[0]);
        minY = Math.min(minY, q[1]);
        maxY = Math.max(maxY, q[1]);
      }
      const wNdc = (availW / view.width) * 2;
      const hNdc = (availH / view.height) * 2;
      const ratio = Math.max((maxX - minX) / wNdc, (maxY - minY) / hNdc);
      dist *= ratio;
      cx = (minX + maxX) / 2;
      cy = (minY + maxY) / 2;
    }
    const goalX = ((pad.side + availW / 2) / view.width) * 2 - 1;
    const goalY = 1 - ((pad.top + availH / 2) / view.height) * 2;
    const shift = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, goalX - cx, goalY - cy, 0, 1]);
    geo.vp = mul4(shift, vpm);
    geo.cam = eye;
    const lightEye = [LIGHT[0] * 6, LIGHT[1] * 6, LIGHT[2] * 6];
    const lview = lookAt(lightEye, [0, 0, 0], [0, 1, 0]);
    let lminX = Infinity;
    let lmaxX = -Infinity;
    let lminY = Infinity;
    let lmaxY = -Infinity;
    let lminZ = Infinity;
    let lmaxZ = -Infinity;
    const half = Math.max(ls, lt) + 0.25;
    for (const x of [-half, half]) {
      for (const y of [-half, half]) {
        for (const z of [0, ls + 0.1]) {
          const q = transform(lview, [x, y, z]);
          lminX = Math.min(lminX, q[0]);
          lmaxX = Math.max(lmaxX, q[0]);
          lminY = Math.min(lminY, q[1]);
          lmaxY = Math.max(lmaxY, q[1]);
          lminZ = Math.min(lminZ, q[2]);
          lmaxZ = Math.max(lmaxZ, q[2]);
        }
      }
    }
    const near = -lmaxZ - 0.1;
    const far = -lminZ + 0.1;
    geo.lightVP = mul4(ortho(lminX, lmaxX, lminY, lmaxY, near, far), lview);
    const range = far - near;
    const texelWorld = (lmaxX - lminX) / shadowSize;
    geo.penScale = (range * 0.07) / texelWorld;
    geo.bias = 0.0022 / range;
    const zTop = BOARD + N * TAU;
    const toScreen = (p) => {
      const q = transform(geo.vp, p);
      return [((q[0] + 1) / 2) * view.width, ((1 - q[1]) / 2) * view.height];
    };
    const corner = toScreen(toWorld(ls, lt, zTop));
    const hinge = toScreen(toWorld(0, lt, zTop));
    const dx = hinge[0] - corner[0];
    const dy = hinge[1] - corner[1];
    const len = Math.hypot(dx, dy) || 1;
    geo.axis = [dx / len, dy / len];
    geo.pitch = clamp((len * 0.92) / LAST, 7, 26);
    let rminX = Infinity;
    let rmaxX = -Infinity;
    let rminY = Infinity;
    let rmaxY = -Infinity;
    for (const sl of [-ls, ls]) {
      for (const tl of [0, lt]) {
        const q = toScreen(toWorld(sl, tl, zTop));
        rminX = Math.min(rminX, q[0]);
        rmaxX = Math.max(rmaxX, q[0]);
        rminY = Math.min(rminY, q[1]);
        rmaxY = Math.max(rmaxY, q[1]);
      }
    }
    geo.rect = [rminX, rminY, rmaxX, rmaxY];
  }

  function resize() {
    const rect = box.getBoundingClientRect();
    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    const budget = Math.sqrt(2800000 / Math.max(1, rect.width * rect.height));
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    view.dpr = Math.max(0.75, Math.min(dprCap, budget));
    layout();
    if (gl) gl.resize(Math.max(1, Math.round(view.width * view.dpr)), Math.max(1, Math.round(view.height * view.dpr)));
    if (gl && ready) render();
    wake();
  }

  function paintFrame(i) {
    if (drawn[i] || !gl) return;
    drawFrame(paint, i);
    gl.upload(i, paint.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, TEX_W, TEX_H).data);
    drawn[i] = true;
    drawnMask |= 1 << i;
  }

  function paintCover() {
    if (!gl) return;
    drawCover(paint, card);
    gl.upload(N, paint.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, TEX_W, TEX_H).data);
    drawnMask |= 1 << N;
    if (drawn.every(Boolean)) gl.finishMips();
  }

  function queueFrames() {
    const later = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 120 }) : window.setTimeout(fn, 16));
    const cancel = (id) => (window.cancelIdleCallback ? window.cancelIdleCallback(id) : window.clearTimeout(id));
    let id = 0;
    const next = () => {
      id = 0;
      if (destroyed || !gl) return;
      const i = drawn.indexOf(false);
      if (i < 0) {
        gl.finishMips();
        wake();
        return;
      }
      paintFrame(i);
      if (Math.abs(i - riffle.p) < 2.5) wake();
      id = later(next);
    };
    id = later(next);
    drawQueue = () => id && cancel(id);
  }

  function init() {
    if (gl || failed) return;
    try {
      gl = createRiffleGL(canvas, { instances: N + 2, layers: N + 1, texW: TEX_W, texH: TEX_H, shadowSize });
    } catch (error) {
      console.error(error);
      gl = null;
    }
    if (!gl) {
      failed = true;
      onFail();
      return;
    }
    paint = document.createElement("canvas");
    paint.width = TEX_W;
    paint.height = TEX_H;
    paint.getContext("2d", { willReadFrequently: true });
    resize();
    paintFrame(0);
    paintFrame(1);
    const img = new Image();
    img.decoding = "async";
    img.src = "/flyout/card-09.jpg";
    img
      .decode()
      .then(() => {
        if (destroyed) return;
        card = img;
        paintCover();
        wake();
      })
      .catch(() => {
        if (destroyed) return;
        paintCover();
        wake();
      });
    ready = true;
    onReady();
    queueFrames();
    wake();
  }

  function local(e) {
    const rect = box.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function inside(x, y) {
    const [x0, y0, x1, y1] = geo.rect;
    const m = 36;
    return x > x0 - m && x < x1 + m && y > y0 - m * 2 && y < y1 + m;
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (pointer.down || !ready) return;
    const [x, y] = local(e);
    if (!inside(x, y)) return;
    stage.setPointerCapture?.(e.pointerId);
    pointer.down = true;
    pointer.id = e.pointerId;
    pointer.x = pointer.sx = x;
    pointer.y = pointer.sy = y;
    pointer.p0 = riffle.p;
    riffle.target = riffle.p;
    riffle.mode = "hold";
    stage.dataset.grabbing = "";
    wake();
  }

  function onMove(e) {
    const [x, y] = local(e);
    if (!pointer.down) {
      if (e.pointerType === "mouse") {
        if (inside(x, y)) stage.dataset.over = "";
        else delete stage.dataset.over;
      }
      return;
    }
    if (e.pointerId !== pointer.id) return;
    pointer.x = x;
    pointer.y = y;
    const along = (x - pointer.sx) * geo.axis[0] + (y - pointer.sy) * geo.axis[1];
    riffle.target = clamp(pointer.p0 + along / geo.pitch, 0, LAST);
    wake();
  }

  function onUp(e) {
    if (!pointer.down || e.pointerId !== pointer.id) return;
    pointer.down = false;
    pointer.id = null;
    delete stage.dataset.grabbing;
    riffle.mode = reduced ? "settle" : "fling";
    riffle.v = clamp(riffle.v, -MAX_SPEED, MAX_SPEED);
    if (reduced) riffle.goal = Math.round(riffle.p);
    wake();
  }

  function go(goal) {
    riffle.goal = clamp(Math.round(goal), 0, LAST);
    riffle.mode = "settle";
    wake();
  }

  function onKey(e) {
    let handled = true;
    const base = riffle.mode === "settle" ? riffle.goal : Math.round(riffle.p);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") go(base + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") go(base - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(LAST);
    else if (e.key === " " || e.key === "Enter") go(base >= LAST ? 0 : LAST);
    else handled = false;
    if (handled) e.preventDefault();
  }

  function stepRiffle(dt) {
    const r = riffle;
    const before = r.p;
    if (r.mode === "hold") {
      const k = 1 - Math.exp(-dt / 0.014);
      r.p += (r.target - r.p) * k;
    } else if (r.mode === "fling") {
      r.p += r.v * dt;
      r.v *= Math.exp(-dt / 0.2);
      if (r.p <= 0 || r.p >= LAST) r.v = 0;
      if (Math.abs(r.v) < 2.5) {
        r.mode = "settle";
        const frac = r.p - Math.floor(r.p);
        r.goal = clamp(r.v > 0.6 ? Math.ceil(r.p) : r.v < -0.6 ? Math.floor(r.p) : frac > 0.5 ? Math.ceil(r.p) : Math.floor(r.p), 0, LAST);
      }
    } else {
      const omega = 15;
      const steps = Math.max(1, Math.ceil(dt / SUB));
      const h = dt / steps;
      for (let s = 0; s < steps; s += 1) {
        const a = omega * omega * (r.goal - r.p) - 2 * omega * r.vs;
        r.vs = clamp(r.vs + a * h, -MAX_SPEED * 0.5, MAX_SPEED * 0.5);
        r.p += r.vs * h;
      }
    }
    r.p = clamp(r.p, 0, LAST);
    if (r.mode !== "settle") r.vs = 0;
    if (r.mode !== "fling") {
      const inst = (r.p - before) / Math.max(dt, 1e-3);
      const k = 1 - Math.exp(-dt / 0.05);
      r.v += (inst - r.v) * k;
    }
  }

  function stepPages(dt) {
    const p = riffle.p;
    const base = Math.floor(p + 1e-6);
    const fr = clamp(p - base, 0, 1);
    const pressed = pointer.down;
    const steps = Math.max(1, Math.ceil(dt / SUB));
    const h = dt / steps;
    for (let i = 0; i < N; i += 1) {
      const pg = pages[i];
      const released = i < base && i < LAST;
      if (released && !pg.released) pg.vtheta = Math.max(pg.vtheta, reduced ? 5 : 10);
      if (!released && pg.released) pg.vtheta = Math.min(pg.vtheta, reduced ? -5 : -10);
      pg.released = released;
      const thetaGoal = released ? PI : 0;
      const j = i - p;
      const rest = j >= -0.5 && i < LAST ? 0.038 * Math.exp(-Math.max(0, j) / 2.4) : 0;
      const fan = pressed && j > 0 && i < LAST ? 0.16 * Math.exp(-(j - 0.2) / 1.3) * (0.5 + 0.5 * fr) : 0;
      const curlGoal = released ? 0 : (i === base && i < LAST ? fr : 0) + rest + fan;
      const follow = i === base && !released;
      for (let s = 0; s < steps; s += 1) {
        const w = 20;
        const a = w * w * (thetaGoal - pg.theta) - 2 * 0.92 * w * pg.vtheta;
        pg.vtheta += a * h;
        pg.theta += pg.vtheta * h;
        if (pg.theta > PI) {
          pg.theta = PI;
          if (pg.vtheta > 0) pg.vtheta = 0;
        }
        if (pg.theta < 0) {
          pg.theta = 0;
          if (pg.vtheta < 0) pg.vtheta = 0;
        }
        const cw = follow ? 46 : 30;
        const cz = follow ? 1 : 0.78;
        const ca = cw * cw * (curlGoal - pg.curl) - 2 * cz * cw * pg.vcurl;
        pg.vcurl += ca * h;
        pg.curl += pg.vcurl * h;
      }
      pg.curl = clamp(pg.curl, 0, 1.05);
      const kGoal = clamp(-pg.vtheta * 0.06, -0.75, 0.75) * Math.sin(Math.max(0, Math.min(PI, pg.theta)));
      pg.k += (kGoal - pg.k) * (1 - Math.exp(-dt / 0.035));
    }
    for (let i = 0; i < N - 1; i += 1) {
      const a = pages[i];
      const b = pages[i + 1];
      if (b.theta > a.theta) {
        b.theta = a.theta;
        if (b.vtheta > a.vtheta) b.vtheta = a.vtheta;
      }
    }
  }

  function sheetData(out, o, i) {
    const { ls, lt } = geo;
    if (i === -1 || i === -2) {
      out[o] = i === -1 ? PI : 0;
      out[o + 1] = BOARD;
      out[o + 2] = 0;
      out[o + 3] = 0;
      out[o + 4] = ls + 0.04;
      out[o + 5] = lt + 0.06;
      out[o + 6] = -0.03;
      out[o + 7] = 0;
      out[o + 8] = i === -1 ? N : 0;
      out[o + 9] = i === -1 ? 1 : 2;
      out[o + 10] = i === -1 ? 0.5 : 0.7;
      out[o + 11] = BOARD;
      return;
    }
    const pg = pages[i];
    const zR = BOARD + (N - i) * TAU;
    const zL = BOARD + (i + 1) * TAU;
    out[o] = pg.theta;
    out[o + 1] = zR + (zL - zR) * (pg.theta / PI);
    out[o + 2] = pg.curl;
    out[o + 3] = pg.k;
    out[o + 4] = ls * (1 + pg.js * 0.0035) - 0.005;
    out[o + 5] = lt;
    out[o + 6] = pg.jt * 0.004;
    out[o + 7] = pg.jr * 0.0028;
    out[o + 8] = i;
    out[o + 9] = 0;
    out[o + 10] = pg.seed;
    out[o + 11] = TAU * 0.8;
  }

  function fillInstances() {
    const active = [];
    const right = [];
    const left = [];
    for (let i = 0; i < N; i += 1) {
      const pg = pages[i];
      const moving = pg.theta > 0.002 && pg.theta < PI - 0.002;
      if (moving || pg.curl > 0.09) active.push(i);
      else if (pg.theta < 1) right.push(i);
      else left.push(i);
    }
    left.reverse();
    active.sort((a, b) => Math.abs(pages[b].theta - PI / 2) - Math.abs(pages[a].theta - PI / 2));
    const order = [...active, ...right, ...left, -1, -2];
    order.forEach((i, k) => sheetData(instances, k * 12, i));
    const casters = [...active, ...right.slice(0, 3), ...left.slice(0, 3), -1, -2];
    casters.forEach((i, k) => sheetData(shadowInstances, k * 12, i));
    return casters.length;
  }

  function render() {
    const casterCount = fillInstances();
    gl.draw({
      instances,
      count: N + 2,
      casters: shadowInstances,
      casterCount,
      vp: geo.vp,
      lightVP: geo.lightVP,
      map: geo.map,
      mapOff: geo.mapOff,
      corner: geo.corner,
      curlK: geo.curlK,
      flightD0: 0.12,
      halfT: geo.lt / 2,
      light: LIGHT,
      cam: geo.cam,
      swap: view.wide ? 0 : 1,
      penScale: geo.penScale,
      bias: geo.bias,
      coverLayer: N,
      flipDet: geo.flipDet,
      drawn: drawnMask,
      ground: GROUND,
      foot: geo.foot,
      footRot: geo.footRot,
    });
  }

  function settled() {
    const r = riffle;
    if (pointer.down || r.mode !== "settle") return false;
    if (Math.abs(r.p - r.goal) > 0.0005 || Math.abs(r.vs) > 0.002) return false;
    for (const pg of pages) {
      if (Math.abs(pg.vtheta) > 0.002 || Math.abs(pg.vcurl) > 0.002 || Math.abs(pg.k) > 0.0005) return false;
      if (pg.theta > 0.0005 && pg.theta < PI - 0.0005) return false;
    }
    return true;
  }

  function frame(now) {
    raf = 0;
    if (!gl || !visible || document.hidden || destroyed) return;
    const raw = last > 0 ? now - last : 16.7;
    const dt = clamp(raw / 1000, 0.001, 0.05);
    last = now;
    stepRiffle(dt);
    stepPages(dt);
    render();
    const current = Math.min(LAST, Math.floor(riffle.p + 1e-6));
    if (current !== shownFrame) {
      shownFrame = current;
      onFrame?.(current);
    }
    if (riffle.mode === "settle" && Math.abs(riffle.p - riffle.goal) < 0.0005) riffle.p = riffle.goal;
    if (!settled()) raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (raf || !gl || !ready || !visible || document.hidden || destroyed) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        init();
        wake();
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    { rootMargin: "120px" },
  );
  io.observe(box);
  const ro = new ResizeObserver(() => resize());
  ro.observe(box);
  const onVisibility = () => {
    if (!document.hidden) wake();
  };
  document.addEventListener("visibilitychange", onVisibility);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("keydown", onKey);

  return {
    go,
    wide: () => view.wide,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      drawQueue?.();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("keydown", onKey);
      if (gl) gl.destroy();
      gl = null;
    },
  };
}
