import { createStage, clamp } from "../_kit/stage";
import { VS, FS_ONE, FS_SURF, FS_MONO, FS_EASE, FS_PRINT, MAXB, MAXT, MAXC } from "./chromeLinesShader";

// A pool of mercury on acid paper, printed as a line engraving.
//
// The liquid is a set of metaballs, each on its own rest point in the pool.
// Mercury is not jelly: there are no springs between the balls, so nothing
// wobbles as a lump. Each ball glides home on a heavily damped, saturating
// pull (far away it drifts at a steady pace, as a loose drop rolls back),
// and close to home it is captured hard, which is the snap of a drop merging.
// The field does the rest: the neck between a pulled ball and the pool thins
// and breaks by itself when the kernels stop overlapping.

// Rest layout, grown once from a seed: a sheet that runs from off the left
// edge, low, to off the right edge, high, with a ragged outline and a few
// holes. Balls are scattered inside it with a minimum spacing, each as big as
// its depth inside the sheet allows, so the deep middle is a few broad swells
// and the margins are many small lobes. u, v in box fractions; r in scale
// units (visible radius of the ball alone); weight.
function mulberry(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function vn(x, y, seed) {
  const h = (i, j) => {
    const s = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
}
const SPINE = [[-0.15, 0.8], [0.12, 0.66], [0.38, 0.55], [0.62, 0.5], [0.86, 0.36], [1.15, 0.22]];
const HALF = [0.1, 0.13, 0.19, 0.2, 0.17, 0.2];
const HOLES = [[0.52, 0.52, 0.035], [0.76, 0.47, 0.03], [0.3, 0.61, 0.025], [0.92, 0.3, 0.03]];
function depth(u, v) {
  // Distance to the spine polyline, against a half-width that varies along it.
  let best = 1e9;
  let hw = 0.1;
  for (let i = 0; i < SPINE.length - 1; i++) {
    const [ax, ay] = SPINE[i];
    const [bx, by] = SPINE[i + 1];
    const dx = bx - ax, dy = by - ay;
    const t = clamp(((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy), 0, 1);
    const d = Math.hypot(u - ax - dx * t, (v - ay - dy * t) * 0.8);
    if (d < best) {
      best = d;
      hw = HALF[i] + (HALF[i + 1] - HALF[i]) * t;
    }
  }
  let m = hw - best + (vn(u * 6, v * 6, 1) - 0.5) * 0.14 + (vn(u * 13, v * 13, 2) - 0.5) * 0.06;
  for (const [hx, hy, hr] of HOLES) m = Math.min(m, Math.hypot(u - hx, (v - hy) * 0.8) - hr);
  return m;
}
function growLayout() {
  const rand = mulberry(20261106);
  const out = [];
  for (let k = 0; k < 9000 && out.length < 42; k++) {
    const u = -0.1 + rand() * 1.25;
    const v = 0.05 + rand() * 0.9;
    const m = depth(u, v);
    if (m < 0.012) continue;
    const r = clamp(m * 0.75 + 0.02, 0.03, 0.12);
    let ok = true;
    for (const b of out) if (Math.hypot(b[0] - u, (b[1] - v) * 0.8) < (b[2] + r) * 0.62) ok = false;
    if (ok) out.push([u, v, r, 1]);
  }
  // Loose drops thrown clear of the pool.
  // Each carries its own tilt of the studio (radians, about a horizontal
  // axis), so their reflections land in different places.
  out.push(
    [0.13, 0.24, 0.03, 1, 0.75, -0.3],
    [0.48, 0.14, 0.036, 1, -0.55, 0.45],
    [0.66, 0.79, 0.028, 1, 0.15, -0.85],
    [0.08, 0.47, 0.024, 1, -0.8, -0.35],
    [0.53, 0.84, 0.02, 1, 0.5, 0.7],
    [0.205, 0.33, 0.02, 1, -0.2, -0.75],
  );
  return out;
}
const LAYOUT = growLayout();

// Hollows in the body: u, v (box fractions); kernel radius (scale units);
// depth, as a share of what the field holds above the edge there at rest
// (past 1 the sheet opens through to the paper); sag of the sheet into it
// (scale units); long axis (rad); squash across it. Three go clean through,
// the rest are dimples and, drawn long across the swells, saddles.
const HOLLOWS = [
  [0.3, 0.56, 0.095, 1.8, 0.034, 0.3, 1.3],
  [0.51, 0.595, 0.07, 1.65, 0.03, -0.4, 1.7],
  [0.12, 0.53, 0.06, 1.5, 0.026, 0.0, 1.0],
  [0.43, 0.5, 0.11, 0.42, 0.03, 0.0, 1.0],
  [0.22, 0.71, 0.13, 0.32, 0.026, -0.42, 3.2],
  [0.6, 0.46, 0.1, 0.38, 0.028, 1.1, 2.4],
];

function program(gl, vs, fs) {
  const make = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

const easeOut = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);

export async function createChromeLines(host, { embedded = false } = {}) {
  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");

  const q = new URLSearchParams(location.search);
  const num = (k, d) => (q.has(k) && q.get(k) !== "" && Number.isFinite(+q.get(k)) ? +q.get(k) : d);
  const K = [num("gmin", 0.4), num("kr", 4.2), num("kl", 0.5), num("sp", 5.25)];
  const SH = [num("rel", 0.05), num("H", 0.035), num("a", 0.1), num("thr", 0.3)];
  // The knuckle swells (the per-ball undulation and the slow relief) are
  // kept well below the broad body (reach and height), which carries the
  // form, so the pool reads as one heavy liquid with a few large sweeping
  // reflections and calm between them, not a scatter of islands.
  const K2 = [num("H2", 0.015), num("Hr", 0.015), num("bw", 0.42), num("Hb", 0.12)];
  // (unused), the ripples' slope, how far the reflected ray turns the
  // screen, and the ripples' scale. The screen's pitch (sp, css px) is
  // coarse enough to hold a hairline in the lights at 1x.
  const E = [0, num("rip", 0.05), num("kx", 7), num("rk", 56)];
  // The studio: how far every normal leans out from the pool's middle (one
  // dome under the whole body), the horizon's tilt (radians) and offset,
  // and the width of every edge in it: a step, not a falloff.
  const G = [num("dome", 0.4), num("htilt", -0.22), num("hoff", 0.06), num("ew", 0.02)];
  // The neck: kernel radius at its waist before it thins (scale units), and
  // how fast it drains while a stretched drop is held.
  const TH = [num("waist", 0.036), num("drain", 0.6)];
  const still = q.has("t") || q.has("pull") || q.has("dent");
  const stillT = num("t", 2.4);
  // ?let=s lets go of the still's pull at s seconds.
  const letGo = num("let", 1e9);
  const pullAt = q.get("pull") ? q.get("pull").split(",").map(Number) : null;
  // ?dent=x,y holds a press still there from t = 0.2 (box fractions).
  const dentAt = q.get("dent") ? q.get("dent").split(",").map(Number) : null;

  // Two passes where a half-float target is renderable (nearly everywhere),
  // else one pass that does the surface per device pixel.
  const twoPass = !!gl.getExtension("EXT_color_buffer_float") || !!gl.getExtension("EXT_color_buffer_half_float");
  const NAMES = ["uB", "uD", "uN", "uTa", "uTr", "uTm", "uNT", "uC", "uCe", "uNC", "uRes", "uDpr", "uScale", "uTime", "uEnvRot", "uK", "uK2", "uS", "uE", "uG", "uSurfRes", "uSurf", "uMono"];
  const make = (fs) => {
    const p = program(gl, VS, fs);
    const u = {};
    for (const n of NAMES) u[n] = gl.getUniformLocation(p, n);
    return { p, u };
  };
  // Surface, then the pass that irons the line phase monotone, the pass
  // that eases what the ironing added across the screen, then the print.
  const progs = twoPass ? [make(FS_SURF), make(FS_MONO), make(FS_EASE), make(FS_PRINT)] : [make(FS_ONE)];
  const surfTex = [null, null, null];
  const surfFbo = [null, null, null];
  let surfW = 0;
  let surfH = 0;
  const freeSurf = () => {
    for (let i = 0; i < 3; i++) {
      if (surfTex[i]) gl.deleteTexture(surfTex[i]);
      if (surfFbo[i]) gl.deleteFramebuffer(surfFbo[i]);
    }
  };
  const ensureSurf = (w, h) => {
    if (!twoPass || (w === surfW && h === surfH)) return;
    surfW = w;
    surfH = h;
    freeSurf();
    for (let i = 0; i < 3; i++) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      surfTex[i] = t;
      surfFbo[i] = fb;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // The pool, plus free balls kept at zero weight. A press does not tear a
  // ball out of the pool (that would leave a hole mercury never has): it
  // raises a drop out of the surface where the hand is, joined to the pool
  // by a thread, a kernel swept along the segment from the root to the drop.
  // Drawn out, the thread drains: its waist, just short of the drop, thins
  // with the stretch and goes on thinning while the stretch is held, so the
  // drop hangs off the pool as a teardrop on a filament. When the waist is
  // gone it has pinched off: the root half recoils into the pool, the drop
  // half is swallowed by the drop, and a satellite droplet is left where it
  // broke. Let go before that and the drop and its thread run home.
  // Two such sets, so a second press can start while the last drop is
  // still on its way home: [drop, satellite].
  const SET = [[0, 0, 0.046, 0], [0, 0, 0.014, 0]];
  const FREE = SET.length * 2;
  const N = Math.min(MAXB, LAYOUT.length + FREE);
  const balls = [...LAYOUT.slice(0, N - FREE), ...SET, ...SET].map(([u, v, r, w, tx = 0, ty = 0], i) => ({
    u, v, r0: r, w, tx, ty, free: i >= N - FREE, wt: 0, held: false,
    x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, rx: 0, ry: 0, R: 0, hu: 0, hv: 0,
    ph: [i * 1.71 + 0.3, i * 2.39 + 1.1, i * 0.83 + 2.0],
  }));
  // Thread slots. A neck runs root -> drop; after the pinch its two halves
  // are stubs that shrink to their ends.
  const threads = Array.from({ length: MAXT }, () => ({ on: false, ax: 0, ay: 0, bx: 0, by: 0, ra: 0, rm: 0, rb: 0, tm: 0.7, w: 0, dx: 0, dy: 0 }));
  const TA = new Float32Array(MAXT * 4);
  const TR = new Float32Array(MAXT * 4);
  const TM = new Float32Array(MAXT * 4);
  const slot = () => threads.find((t) => !t.on) || threads[0];
  const B = new Float32Array(MAXB * 4);
  const C = new Float32Array(MAXC * 4);
  const CE = new Float32Array(MAXC * 4);
  const hollows = HOLLOWS.slice(0, MAXC - 1).map(([u, v, r, depth, sag, ang, sq], i) => ({
    u, v, r, depth, sag, ang, sq, x: 0, y: 0, R: 0, s: 0, h: 0, ox: 0, oy: 0, f0: -1,
    ph: [i * 2.13 + 0.7, i * 1.37 + 2.2, i * 0.91 + 1.3],
  }));
  // The dent a press drives into the mirror under the hand: it sinks while
  // the hand holds still (a long press goes through), gives way to the drop
  // once the hand draws out, and heals with a snap when it lets go.
  const dent = { u: 0, v: 0, r: 0.07, depth: 1.5, sag: 0.034, ang: 0, sq: 1, x: 0, y: 0, R: 0, s: 0, h: 0, ox: 0, oy: 0, f0: 0, amp: 0, ph: [0, 0, 0] };
  const D = new Float32Array(MAXB * 4);

  let W = 1;
  let H = 1;
  let scale = 1;
  let placed = false;
  const place = (w, h) => {
    const kx = placed ? w / W : 1;
    const ky = placed ? h / H : 1;
    W = w;
    H = h;
    scale = Math.min(w, h * 1.25);
    for (const b of balls) {
      b.rx = (b.free ? b.hu : b.u) * w;
      b.ry = (b.free ? b.hv : b.v) * h;
      if (placed) {
        b.x *= kx;
        b.y *= ky;
      } else {
        b.x = b.rx;
        b.y = b.ry;
      }
    }
    placed = true;
    for (const c of hollows) c.f0 = -1;
  };
  stage.onResize((w, h) => place(w, h));

  // The field at a point, in JS, to decide what a press takes hold of.
  const THR = SH[3];
  const kernel = (b, x, y) => {
    const d2 = ((x - b.x) ** 2 + (y - b.y) ** 2) / (b.R * b.R);
    return d2 < 1 ? b.w * (1 - d2) ** 3 : 0;
  };
  const tKernel = (t, x, y) => {
    if (!t.on || t.w <= 0) return 0;
    const abx = t.bx - t.ax;
    const aby = t.by - t.ay;
    const s = clamp(((x - t.ax) * abx + (y - t.ay) * aby) / Math.max(abx * abx + aby * aby, 1e-4), 0, 1);
    const sm = (u) => u * u * (3 - 2 * u);
    const R = s < t.tm ? t.ra + (t.rm - t.ra) * sm(s / t.tm) : t.rm + (t.rb - t.rm) * sm((s - t.tm) / (1 - t.tm));
    const d2 = ((x - t.ax - abx * s) ** 2 + (y - t.ay - aby * s) ** 2) / (R * R);
    return d2 < 1 ? t.w * (1 - d2) ** 3 : 0;
  };
  const fieldAt = (x, y) => balls.reduce((f, b) => f + kernel(b, x, y), 0) + threads.reduce((f, t) => f + tKernel(t, x, y), 0);

  // A press on the liquid raises a free drop there; the pool balls around
  // it are dragged a little, less the further the pull goes.
  let grab = null;
  const takeHold = (x, y) => {
    const f = fieldAt(x, y);
    if (f < 0.22) return null;
    const all = balls.filter((b) => b.free);
    const sets = [all.slice(0, SET.length), all.slice(SET.length)];
    const weight = (set) => set.reduce((a, b) => a + b.w, 0);
    const free = weight(sets[0]) <= weight(sets[1]) ? sets[0] : sets[1];
    for (const b of free) {
      b.hu = x / W;
      b.hv = y / H;
      b.rx = x;
      b.ry = y;
      b.x = x;
      b.y = y;
      b.vx = b.vy = 0;
      b.held = b === free[0];
      // The drop's weight comes in with the draw (see step).
      b.wt = 0;
      b.w = b === free[0] ? b.w : 0;
      b.R = b.r0 * 2.3 * scale;
    }
    const best = free[0];
    const neck = slot();
    Object.assign(neck, { on: true, kind: "neck", drop: best, toward: null, thin: 0, base: 0, drain: 0, ax: x, ay: y, bx: x, by: y, w: 0, tm: 0.62, ra: 0, rm: 0, rb: 0, dx: 0, dy: 0 });
    const near = balls
      .filter((b) => !b.free && b.w > 0)
      .map((b) => ({ b, s: Math.pow(clamp(kernel(b, x, y) / Math.max(f, 1e-3), 0, 1), 0.8) * 0.8, ox: b.x, oy: b.y }))
      .filter((e) => e.s > 0.05);
    return { best, sat: free[1], neck, broken: false, thin: 0, x0: x, y0: y, x, y, near };
  };
  // Pinch-off at the waist: the neck becomes two stubs, and the drop leaves
  // a satellite where it broke.
  const pinch = (g) => {
    g.broken = true;
    const n = g.neck;
    const px = n.ax + (n.bx - n.ax) * n.tm;
    const py = n.ay + (n.by - n.ay) * n.tm;
    const root = { ...n, kind: "stub", toward: null, bx: px, by: py, rb: n.rm * 0.8, rm: n.ra * 0.45 + n.rm * 0.55, tm: 0.5 };
    Object.assign(n, root);
    const tip = slot();
    Object.assign(tip, { on: true, kind: "stub", toward: g.best, drop: null, ax: px, ay: py, bx: g.best.x, by: g.best.y, ra: n.rb, rm: n.rb * 1.3, rb: g.best.R * 0.45, tm: 0.5, w: n.w, dx: n.dx, dy: n.dy });
    const s = g.sat;
    s.x = px;
    s.y = py;
    s.vx = (g.best.vx - 0) * 0.15;
    s.vy = (g.best.vy - 0) * 0.15;
    s.wt = 1;
    s.w = 0.6;
    s.held = false;
  };
  const press = (x, y) => {
    grab = takeHold(x, y);
    if (grab) {
      dent.u = x / W;
      dent.v = y / H;
      dent.f0 = fieldAt(x, y);
    }
    return grab;
  };
  stage.on("down", (p) => {
    if (still) return;
    press(p.x, p.y);
  });
  const release = (vx, vy) => {
    if (!grab) return;
    if (grab.best) {
      // Let go: the hand's speed stays in the drop.
      grab.best.vx += vx * 0.35;
      grab.best.vy += vy * 0.35;
    }
    for (const b of balls) if (b.free) b.held = false;
    grab = null;
  };
  stage.on("up", () => release(stage.pointer.vx, stage.pointer.vy));

  const OMEGA = 2 * Math.PI * 0.95;
  const step = (dt, t, pointer) => {
    const breathe = scale * 0.012;
    const g = grab && grab.best ? grab : null;
    // A press alone dents; the drop rises only as the hand draws out.
    const drawn = g ? Math.hypot(g.x - g.x0, g.y - g.y0) / scale : 0;
    if (g && !g.broken) g.best.wt = Math.max(g.best.wt, clamp((drawn - 0.01) / 0.05, 0, 1));
    for (const b of balls) {
      // At rest it breathes: each rest point drifts on a slow loop and the
      // pool swells and settles.
      b.ax = b.rx + breathe * (Math.sin(t * 0.31 + b.ph[0]) + 0.5 * Math.sin(t * 0.53 + b.ph[2]));
      b.ay = b.ry + breathe * (Math.cos(t * 0.27 + b.ph[1]) * 0.8);
      b.R = b.r0 * 2.3 * scale * (1 + 0.035 * Math.sin(t * 0.42 + b.ph[2]) + 0.02 * Math.sin(t * 0.17));
      if (b.free) {
        b.ax = b.rx;
        b.ay = b.ry;
        // A released drop, back home and nearly still, is absorbed.
        if (!b.held && Math.hypot(b.x - b.rx, b.y - b.ry) < b.R * 0.08 && Math.hypot(b.vx, b.vy) < scale * 0.05) b.wt = 0;
        b.w += (b.wt - b.w) * (1 - Math.exp(-dt * (b.wt > b.w ? 9 : 3)));
      }
    }
    // The threads.
    const ease = (r) => 1 - Math.exp(-dt * r);
    for (const th of threads) {
      if (!th.on) continue;
      if (th.kind === "neck") {
        const d = th.drop;
        th.bx = d.x;
        th.by = d.y;
        const s = Math.hypot(th.bx - th.ax, th.by - th.ay) / scale;
        // The neck drains while it is drawn out: thinning follows the
        // stretch, and creeps on while a stretched drop is held.
        // The drain only accumulates while it is held out, and heals
        // quickly once the drop is let go and runs home.
        th.base += (0.9 * clamp((s - 0.04) / 0.27, 0, 1) - th.base) * ease(5);
        th.drain = d.held ? th.drain + dt * TH[1] * Math.max(0, s - 0.12) : th.drain * Math.exp(-dt * 4);
        th.thin = clamp(th.base + th.drain, 0, 1);
        const k = th.thin;
        th.ra = scale * 0.062 * (1 - 0.3 * k);
        th.rm = scale * TH[0] * Math.pow(1 - k, 1.3);
        // The drop end reaches well into the drop, which draws it out into a
        // teardrop pointing back down the thread.
        th.rb = scale * 0.09 * (1 - 0.25 * k);
        // It fills in only as it is drawn out, so a press alone raises one
        // mound, and it goes with the drop when the drop is absorbed.
        th.w = d.w * clamp(s / 0.05, 0, 1);
        th.dx = d.x - d.rx;
        th.dy = d.y - d.ry;
        // Pinched once the waist is thinner than the surface can hold.
        if (th.rm < scale * 0.003 && th.w > 0.5) {
          if (g && g.neck === th && !g.broken) pinch(g);
          else th.on = false;
        } else if (!d.held && d.w < 0.01) th.on = false;
      } else {
        // A stub recoils into its end and drains.
        if (th.toward) {
          th.ax += (th.toward.x - th.ax) * ease(11);
          th.ay += (th.toward.y - th.ay) * ease(11);
          th.bx = th.toward.x;
          th.by = th.toward.y;
          th.ra *= Math.exp(-dt * 3);
        } else {
          th.bx += (th.ax - th.bx) * ease(9);
          th.by += (th.ay - th.by) * ease(9);
          th.rb *= Math.exp(-dt * 3);
        }
        th.rm = Math.min(th.rm, th.ra * 0.5 + th.rb * 0.5);
        th.w *= Math.exp(-dt * 2.5);
        if (Math.hypot(th.bx - th.ax, th.by - th.ay) < 2 || th.w < 0.02) th.on = false;
      }
    }
    for (const b of balls) {
      const dx = b.x - b.ax;
      const dy = b.y - b.ay;
      const dist = Math.hypot(dx, dy) || 1e-6;
      // Saturating return: a loose drop rolls home at a steady pace...
      const reach = b.R * 0.3;
      const pull = Math.min(dist, reach) / dist;
      let fx = -OMEGA * OMEGA * dx * pull;
      let fy = -OMEGA * OMEGA * dy * pull;
      // ...and is captured hard as it touches: the merge snaps. Damping
      // follows the local stiffness so the snap lands without ringing.
      const kc = (2 * Math.PI * 2.4) ** 2 * Math.exp(-((dist / (b.R * 0.32)) ** 2));
      fx -= kc * dx;
      fy -= kc * dy;
      let damp = 2 * 0.88 * Math.sqrt(OMEGA * OMEGA * pull + kc);
      if (g) {
        const ddx = g.x - g.x0;
        const ddy = g.y - g.y0;
        const len = Math.hypot(ddx, ddy);
        if (b === g.best) {
          const k = (2 * Math.PI * 3.2) ** 2;
          fx = (g.x - b.x) * k;
          fy = (g.y - b.y) * k;
          damp = 2 * 0.95 * 2 * Math.PI * 3.2;
        } else if (!b.free) {
          const e = g.near.find((n) => n.b === b);
          if (e) {
            // Neighbours follow for a while, then let go.
            const s = e.s * Math.exp(-len / (b.R * 0.55));
            const tx = e.ox + ddx * s * 0.9;
            const ty = e.oy + ddy * s * 0.9;
            const k = (2 * Math.PI * 2.0) ** 2 * s;
            fx += (tx - b.x) * k;
            fy += (ty - b.y) * k;
          }
        }
      }
      // A hand passing over stirs it.
      if (pointer && pointer.inside && !grab) {
        const sx = pointer.x - b.x;
        const sy = pointer.y - b.y;
        const fall = Math.exp(-(sx * sx + sy * sy) / (scale * 0.16) ** 2);
        const sp = Math.hypot(pointer.vx, pointer.vy);
        if (sp > 1) {
          const lim = Math.min(1, (scale * 2) / sp);
          fx += pointer.vx * lim * fall * 9;
          fy += pointer.vy * lim * fall * 9;
        }
      }
      b.vx += (fx - damp * b.vx) * dt;
      b.vy += (fy - damp * b.vy) * dt;
    }
    for (const b of balls) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    // The hollows: each drifts on the pool's own slow loops, and rides with
    // the liquid around it (the displacement of the balls it sits in).
    const ride = (c) => {
      let wx = 0, wy = 0, ws = 1e-6;
      for (const b of balls) {
        if (b.free || b.w <= 0) continue;
        const k = kernel(b, c.x, c.y);
        wx += k * (b.x - b.ax);
        wy += k * (b.y - b.ay);
        ws += k;
      }
      c.ox = wx / ws;
      c.oy = wy / ws;
    };
    const rest = (x, y) => balls.reduce((f, b) => (b.free ? f : f + (((x - b.ax) ** 2 + (y - b.ay) ** 2) < b.R * b.R ? b.w * (1 - ((x - b.ax) ** 2 + (y - b.ay) ** 2) / (b.R * b.R)) ** 3 : 0)), 0);
    const drift = scale * 0.03;
    for (const c of hollows) {
      const hx = c.u * W + drift * (Math.sin(t * 0.31 + c.ph[0]) + 0.5 * Math.sin(t * 0.53 + c.ph[2]));
      const hy = c.v * H + drift * Math.cos(t * 0.27 + c.ph[1]) * 0.8;
      if (c.f0 < 0) c.f0 = rest(c.u * W, c.v * H);
      c.x = hx;
      c.y = hy;
      ride(c);
      const br = 1 + 0.06 * Math.sin(t * 0.42 + c.ph[2]);
      c.R = c.r * scale * br;
      c.s = c.depth * Math.max(c.f0 - THR, 0.05) * br;
      c.h = c.sag;
    }
    // The dent sinks while the hand holds still and gives way as it draws out.
    const holding = grab && grab.best && !grab.broken;
    const target = holding ? clamp(1 - (drawn - 0.015) / 0.04, 0, 1) : 0;
    const rate = holding ? (target > dent.amp ? 1.6 : 6) : 7;
    dent.amp += (target - dent.amp) * (1 - Math.exp(-dt * rate));
    dent.x = dent.u * W;
    dent.y = dent.v * H;
    ride(dent);
    const sink = dent.amp * dent.amp * (3 - 2 * dent.amp);
    dent.R = dent.r * scale * (0.8 + 0.2 * sink);
    dent.s = dent.depth * Math.max(dent.f0 - THR, 0) * sink;
    dent.h = dent.sag * sink;
  };

  let simT = 0;
  let acc = 0;
  const SUB = 1 / 240;
  const advance = (dt, pointer) => {
    acc += dt;
    while (acc >= SUB) {
      step(SUB, simT, pointer);
      simT += SUB;
      acc -= SUB;
    }
  };

  // The still: run the same simulation to ?t=, with a scripted pull toward
  // ?pull=x,y (box fractions) held from t = 0.2.
  let stillDone = false;
  let drawnAt = 0;
  const runStill = () => {
    simT = 0;
    acc = 0;
    for (const b of balls) {
      b.x = b.rx;
      b.y = b.ry;
      b.vx = b.vy = 0;
    }
    for (const th of threads) Object.assign(th, { on: false, w: 0 });
    dent.amp = 0;
    step(0, 0, null);
    let start = null;
    const end = pullAt ? [pullAt[0] * W, pullAt[1] * H] : null;
    if (end) {
      // Take hold just inside the pool's edge on the way out from its middle
      // toward the target, so the pull draws liquid out of the pool.
      const cx = W * 0.5;
      const cy = H * 0.5;
      start = [cx, cy];
      for (let k = 0; k <= 80; k++) {
        const x = cx + (end[0] - cx) * (k / 80);
        const y = cy + (end[1] - cy) * (k / 80);
        const f = fieldAt(x, y);
        if (f < THR) break;
        if (f >= 0.5) start = [x, y];
      }
    }
    while (simT < stillT) {
      if (end && simT >= letGo && grab) {
        release(0, 0);
      } else if (end && simT >= 0.2 && simT < letGo) {
        if (!grab) grab = press(start[0], start[1]) || { best: null };
        const k = easeOut((simT - 0.2) / 1.3);
        if (grab.best) {
          grab.x = start[0] + (end[0] - start[0]) * k;
          grab.y = start[1] + (end[1] - start[1]) * k;
        }
      }
      if (dentAt && !end && simT >= 0.2 && simT < letGo && !grab) grab = press(dentAt[0] * W, dentAt[1] * H) || { best: null };
      if (dentAt && !end && simT >= letGo && grab) release(0, 0);
      step(SUB, simT, null);
      simT += SUB;
    }
    stillDone = true;
  };

  const render = (time) => {
    const cw = stage.canvas.width;
    const ch = stage.canvas.height;
    for (let i = 0; i < N; i++) {
      const b = balls[i];
      B[i * 4] = b.x;
      B[i * 4 + 1] = b.y;
      B[i * 4 + 2] = b.R;
      B[i * 4 + 3] = b.w;
      D[i * 4] = b.x - b.rx;
      D[i * 4 + 1] = b.y - b.ry;
      D[i * 4 + 2] = b.tx;
      D[i * 4 + 3] = b.ty;
    }
    threads.forEach((th, j) => {
      // A thread with no live pull is nothing: no dormant slot lingers in
      // the pool's field.
      const w = th.on && th.w > 1e-3 ? th.w : 0;
      TA.set([th.ax, th.ay, th.bx, th.by], j * 4);
      TR.set([Math.max(th.ra, 1), Math.max(th.rm, 0.5), Math.max(th.rb, 1), w], j * 4);
      TM.set([th.tm, th.dx, th.dy, 0], j * 4);
    });
    C.fill(0);
    CE.fill(0);
    [...hollows, dent].forEach((c, j) => {
      C.set([c.x + c.ox, c.y + c.oy, Math.max(c.R, 1), c.s], j * 4);
      CE.set([c.ang, c.sq, c.h, 0], j * 4);
    });
    const NC = hollows.length + 1;
    const envRot = 0.07 * Math.sin(time * 0.11) + 0.03 * Math.sin(time * 0.29);
    const bind = ({ p, u }) => {
      gl.useProgram(p);
      gl.uniform4fv(u.uB, B);
      gl.uniform4fv(u.uD, D);
      gl.uniform1i(u.uN, N);
      gl.uniform4fv(u.uTa, TA);
      gl.uniform4fv(u.uTr, TR);
      gl.uniform4fv(u.uTm, TM);
      gl.uniform1i(u.uNT, MAXT);
      gl.uniform4fv(u.uC, C);
      gl.uniform4fv(u.uCe, CE);
      gl.uniform1i(u.uNC, NC);
      gl.uniform2f(u.uRes, W, H);
      gl.uniform1f(u.uDpr, stage.dpr);
      gl.uniform1f(u.uScale, scale);
      gl.uniform1f(u.uTime, time);
      gl.uniform1f(u.uEnvRot, envRot);
      gl.uniform4f(u.uK, K[0], K[1], K[2], K[3]);
      gl.uniform4f(u.uK2, K2[0], K2[1], K2[2], K2[3]);
      gl.uniform4f(u.uS, SH[0], SH[1], SH[2], SH[3]);
      gl.uniform4f(u.uE, E[0], E[1], E[2], E[3]);
      gl.uniform4f(u.uG, G[0], G[1], G[2], G[3]);
      return u;
    };
    gl.bindVertexArray(vao);
    if (twoPass) {
      // One surface sample per css pixel.
      ensureSurf(Math.max(1, Math.round(W)), Math.max(1, Math.round(H)));
      gl.bindFramebuffer(gl.FRAMEBUFFER, surfFbo[0]);
      gl.viewport(0, 0, surfW, surfH);
      const u0 = bind(progs[0]);
      gl.uniform2f(u0.uSurfRes, surfW, surfH);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // The line phase, ironed monotone across the screen.
      gl.bindFramebuffer(gl.FRAMEBUFFER, surfFbo[1]);
      const um = bind(progs[1]);
      gl.uniform2f(um.uSurfRes, surfW, surfH);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, surfTex[0]);
      gl.uniform1i(um.uSurf, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // What the ironing added, eased across the screen.
      gl.bindFramebuffer(gl.FRAMEBUFFER, surfFbo[2]);
      const ue = bind(progs[2]);
      gl.uniform2f(ue.uSurfRes, surfW, surfH);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, surfTex[1]);
      gl.uniform1i(ue.uMono, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, surfTex[0]);
      gl.uniform1i(ue.uSurf, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, cw, ch);
      const u1 = bind(progs[3]);
      gl.bindTexture(gl.TEXTURE_2D, surfTex[2]);
      gl.uniform1i(u1.uSurf, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else {
      gl.viewport(0, 0, cw, ch);
      bind(progs[0]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  };

  stage.onFrame((dt) => {
    if (W < 2) return;
    if (still) {
      if (!stillDone) runStill();
      // A still is drawn once per size.
      if (drawnAt !== stage.canvas.width * 1e5 + stage.canvas.height) {
        drawnAt = stage.canvas.width * 1e5 + stage.canvas.height;
        render(stillT);
      }
      return;
    }
    const p = stage.pointer;
    if (grab) {
      grab.x = p.x;
      grab.y = p.y;
    }
    advance(dt, p);
    render(simT);
    void embedded;
  });

  return {
    destroy: () => {
      freeSurf();
      stage.destroy();
    },
  };
}
