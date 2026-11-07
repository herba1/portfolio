import { createStage, clamp } from "../_kit/stage";
import { VS, FS_ONE, FS_SURF, FS_MONO, FS_PRINT, MAXB } from "./chromeLinesShader";

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
  out.push([0.31, 0.27, 0.03, 1], [0.44, 0.23, 0.036, 1], [0.66, 0.79, 0.028, 1], [0.08, 0.47, 0.024, 1], [0.53, 0.84, 0.02, 1], [0.205, 0.33, 0.02, 1]);
  return out;
}
const LAYOUT = growLayout();

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
  const K = [num("gmin", 0.3), num("kr", 4.2), num("kl", 0.5), num("sp", 6.1)];
  const SH = [num("rel", 0.1), num("H", 0.035), num("a", 0.1), num("thr", 0.3)];
  const K2 = [num("H2", 0.07), num("Hr", 0.14), 0, 0];
  const still = q.has("t") || q.has("pull");
  const stillT = num("t", 2.4);
  // ?let=s lets go of the still's pull at s seconds.
  const letGo = num("let", 1e9);
  const pullAt = q.get("pull") ? q.get("pull").split(",").map(Number) : null;

  // Two passes where a half-float target is renderable (nearly everywhere),
  // else one pass that does the surface per device pixel.
  const twoPass = !!gl.getExtension("EXT_color_buffer_float") || !!gl.getExtension("EXT_color_buffer_half_float");
  const NAMES = ["uB", "uD", "uN", "uRes", "uDpr", "uScale", "uTime", "uEnvRot", "uK", "uK2", "uS", "uSurfRes", "uSurf"];
  const make = (fs) => {
    const p = program(gl, VS, fs);
    const u = {};
    for (const n of NAMES) u[n] = gl.getUniformLocation(p, n);
    return { p, u };
  };
  // Surface, then the pass that irons the line phase monotone, then the print.
  const progs = twoPass ? [make(FS_SURF), make(FS_MONO), make(FS_PRINT)] : [make(FS_ONE)];
  const surfTex = [null, null];
  const surfFbo = [null, null];
  let surfW = 0;
  let surfH = 0;
  const freeSurf = () => {
    for (let i = 0; i < 2; i++) {
      if (surfTex[i]) gl.deleteTexture(surfTex[i]);
      if (surfFbo[i]) gl.deleteFramebuffer(surfFbo[i]);
    }
  };
  const ensureSurf = (w, h) => {
    if (!twoPass || (w === surfW && h === surfH)) return;
    surfW = w;
    surfH = h;
    freeSurf();
    for (let i = 0; i < 2; i++) {
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

  // The pool, plus four free balls kept at zero weight. A press does not
  // tear a ball out of the pool (that would leave a hole mercury never
  // has): it raises a drop out of the surface where the hand is, and three
  // smaller balls string out behind it as the neck, thinnest in the middle,
  // until it is stretched too far and snaps back into the pool.
  // Two such sets, so a second press can start while the last drop is
  // still on its way home.
  const SET = [[0, 0, 0.068, 0], [0, 0, 0.04, 0], [0, 0, 0.03, 0], [0, 0, 0.034, 0]];
  const FREE = SET.length * 2;
  const TRAIL = [0.26, 0.52, 0.76];
  const N = Math.min(MAXB, LAYOUT.length + FREE);
  const balls = [...LAYOUT.slice(0, N - FREE), ...SET, ...SET].map(([u, v, r, w], i) => ({
    u, v, r0: r, w, free: i >= N - FREE, wt: 0, held: false,
    x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0, rx: 0, ry: 0, R: 0, hu: 0, hv: 0,
    ph: [i * 1.71 + 0.3, i * 2.39 + 1.1, i * 0.83 + 2.0],
  }));
  const B = new Float32Array(MAXB * 4);
  const D = new Float32Array(MAXB * 2);

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
  };
  stage.onResize((w, h) => place(w, h));

  // The field at a point, in JS, to decide what a press takes hold of.
  const kernel = (b, x, y) => {
    const d2 = ((x - b.x) ** 2 + (y - b.y) ** 2) / (b.R * b.R);
    return d2 < 1 ? b.w * (1 - d2) ** 3 : 0;
  };

  // A press on the liquid raises a free drop there; the pool balls around
  // it are dragged a little, less the further the pull goes (the neck).
  let grab = null;
  const fieldAt = (x, y) => balls.reduce((f, b) => f + kernel(b, x, y), 0);
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
      b.held = true;
      b.wt = b === free[0] ? 1 : 0;
      b.R = b.r0 * 2.3 * scale;
    }
    const best = free[0];
    const near = balls
      .filter((b) => !b.free && b.w > 0)
      .map((b) => ({ b, s: Math.pow(clamp(kernel(b, x, y) / Math.max(f, 1e-3), 0, 1), 0.8) * 0.8, ox: b.x, oy: b.y }))
      .filter((e) => e.s > 0.05);
    return { best, trail: free.slice(1), broken: false, ox: 0, oy: 0, x0: x, y0: y, x, y, near };
  };
  stage.on("down", (p) => {
    if (still) return;
    grab = takeHold(p.x, p.y);
  });
  stage.on("up", () => {
    if (!grab) return;
    // Let go: the hand's speed stays in the drop.
    const v = stage.pointer;
    grab.best.vx += v.vx * 0.35;
    grab.best.vy += v.vy * 0.35;
    for (const b of balls) if (b.free) b.held = false;
    grab = null;
  });

  const OMEGA = 2 * Math.PI * 0.95;
  const step = (dt, t, pointer) => {
    const breathe = scale * 0.012;
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
      if (grab && grab.best) {
        const ddx = grab.x - grab.x0;
        const ddy = grab.y - grab.y0;
        const len = Math.hypot(ddx, ddy);
        if (b === grab.best) {
          const tx = grab.x;
          const ty = grab.y;
          const k = (2 * Math.PI * 3.2) ** 2;
          fx = (tx - b.x) * k;
          fy = (ty - b.y) * k;
          damp = 2 * 0.95 * 2 * Math.PI * 3.2;
        } else if (b.free && b.held) {
          // The neck: strung between the pool and the drop until it is
          // stretched past what surface tension holds, then it snaps home.
          const i = grab.trail.indexOf(b);
          if (!grab.broken && len > scale * 0.3) {
            grab.broken = true;
            for (const t of grab.trail) t.held = false;
          }
          if (i >= 0 && !grab.broken) {
            // The neck only fills in as it is drawn out, so a press alone
            // raises one mound, not a stack.
            b.wt = clamp(len / (scale * 0.1), 0, 1);
            const f = TRAIL[i];
            const tx = grab.x0 + (grab.best.x - grab.x0) * f;
            const ty = grab.y0 + (grab.best.y - grab.y0) * f;
            const k = (2 * Math.PI * 2.6) ** 2;
            fx = (tx - b.x) * k;
            fy = (ty - b.y) * k;
            damp = 2 * 0.9 * 2 * Math.PI * 2.6;
          }
        } else {
          const e = grab.near.find((n) => n.b === b);
          if (e) {
            // Neighbours follow for a while, then let go: the neck.
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
    step(0, 0, null);
    let start = null;
    const end = pullAt ? [pullAt[0] * W, pullAt[1] * H] : null;
    if (end) {
      // Take hold at the deepest liquid on the way from the pool toward the
      // target: march from the target back toward the pool's middle.
      const cx = W * 0.5;
      const cy = H * 0.5;
      start = [cx, cy];
      for (let k = 0; k <= 60; k++) {
        const x = end[0] + (cx - end[0]) * (k / 60);
        const y = end[1] + (cy - end[1]) * (k / 60);
        if (fieldAt(x, y) > 0.55) {
          start = [x, y];
          break;
        }
      }
    }
    while (simT < stillT) {
      if (end && simT >= letGo && grab) {
        for (const b of balls) if (b.free) b.held = false;
        grab = null;
      } else if (end && simT >= 0.2 && simT < letGo) {
        if (!grab) grab = takeHold(start[0], start[1]) || { best: null };
        const k = easeOut((simT - 0.2) / 1.3);
        if (grab.best) {
          grab.x = start[0] + (end[0] - start[0]) * k;
          grab.y = start[1] + (end[1] - start[1]) * k;
        }
      }
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
      D[i * 2] = b.x - b.rx;
      D[i * 2 + 1] = b.y - b.ry;
    }
    const envRot = 0.07 * Math.sin(time * 0.11) + 0.03 * Math.sin(time * 0.29);
    const bind = ({ p, u }) => {
      gl.useProgram(p);
      gl.uniform4fv(u.uB, B);
      gl.uniform2fv(u.uD, D);
      gl.uniform1i(u.uN, N);
      gl.uniform2f(u.uRes, W, H);
      gl.uniform1f(u.uDpr, stage.dpr);
      gl.uniform1f(u.uScale, scale);
      gl.uniform1f(u.uTime, time);
      gl.uniform1f(u.uEnvRot, envRot);
      gl.uniform4f(u.uK, K[0], K[1], K[2], K[3]);
      gl.uniform4f(u.uK2, K2[0], K2[1], K2[2], K2[3]);
      gl.uniform4f(u.uS, SH[0], SH[1], SH[2], SH[3]);
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
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, cw, ch);
      const u1 = bind(progs[2]);
      gl.bindTexture(gl.TEXTURE_2D, surfTex[1]);
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
