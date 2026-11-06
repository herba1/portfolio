import { createStage, clamp } from "../_kit/stage";

// A three-pendulum harmonograph, the machine behind Whitney's Vertigo
// spirals. Two lateral pendulums swing the pen in x and y; a third, free to
// swing in any direction, carries the paper in a slow circle underneath it.
// Each is a damped harmonic oscillator stepped exactly (no integration
// drift), and the line is the pen's position relative to the paper.
//
// Ink is laid opaque, so a single continuous line never beads where its
// segments meet. It goes onto the sheet (paper plus ink, kept for tearing and
// resizing) and straight onto the screen canvas, which is only repainted
// whole while a sheet is being torn away. Width and density follow the pen's speed: thin and a little grey
// where it races, wider and blacker where it slows, a small pool where the
// swing has died to a point and the nib rests.

const TAU = Math.PI * 2;
const H = 1 / 1600; // physics substep, seconds
const U = TAU * 0.9; // one ratio unit, rad/s

// Ratio sets, alternating per sheet. Detuning is what makes the figure
// precess as it winds in, instead of retracing one closed curve.
const SETS = [
  { x: 2, y: 3 * 1.0021, p: 2 * 0.9984, gx: 0.03, gy: 0.034, gp: 0.026 },
  { x: 3, y: 4 * 1.0018, p: 4 * 0.9986, gx: 0.031, gy: 0.035, gp: 0.027 },
];

const GROUND = "#ebe8e1";
const PAPER = [250, 248, 243];
const INK_DARK = [20, 23, 36];
const INK_FAST = [52, 56, 72];

function osc(w, g) {
  const o = { x: 0, v: 0, w, g, E: 0, C: 0, S: 0, wd: w };
  retune(o, w, g);
  return o;
}
function retune(o, w, g) {
  o.w = w;
  o.g = g;
  o.wd = Math.sqrt(Math.max(1e-6, w * w - g * g));
  o.E = Math.exp(-g * H);
  o.C = Math.cos(o.wd * H);
  o.S = Math.sin(o.wd * H);
}
function step(o) {
  const { x, v, g, wd, w, E, C, S } = o;
  o.x = E * (x * C + ((v + g * x) / wd) * S);
  o.v = E * (v * C - ((w * w * x + g * v) / wd) * S);
}
const amp = (o) => Math.hypot(o.x, (o.v + o.g * o.x) / o.wd);
const scaleOsc = (o, k) => {
  o.x *= k;
  o.v *= k;
};

function makePaperTexture(wPx, hPx, seed = 7) {
  const c = document.createElement("canvas");
  c.width = wPx;
  c.height = hPx;
  const g = c.getContext("2d");
  const img = g.createImageData(wPx, hPx);
  const d = img.data;
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Low-frequency cloud (the formation of the sheet) plus fine tooth.
  const cw = 48;
  const ch = Math.ceil((hPx / wPx) * cw);
  const cloud = new Float32Array((cw + 1) * (ch + 1)).map(() => rnd());
  for (let y = 0; y < hPx; y++) {
    const fy = (y / hPx) * ch;
    const iy = fy | 0;
    const ty = fy - iy;
    for (let x = 0; x < wPx; x++) {
      const fx = (x / wPx) * cw;
      const ix = fx | 0;
      const tx = fx - ix;
      const a = cloud[iy * (cw + 1) + ix];
      const b = cloud[iy * (cw + 1) + ix + 1];
      const c2 = cloud[(iy + 1) * (cw + 1) + ix];
      const e = cloud[(iy + 1) * (cw + 1) + ix + 1];
      const n = (a * (1 - tx) + b * tx) * (1 - ty) + (c2 * (1 - tx) + e * tx) * ty;
      const k = (n - 0.5) * 3.2 + (rnd() - 0.5) * 3.4;
      const i = (y * wPx + x) * 4;
      d[i] = PAPER[0] + k;
      d[i + 1] = PAPER[1] + k;
      d[i + 2] = PAPER[2] + k * 1.1;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export async function createHarmonograph(host) {
  const stage = createStage(host, { dpr: 2 });
  const ctx = stage.ctx;
  const params = new URLSearchParams(window.location.search);
  const preT = params.has("t") ? clamp(parseFloat(params.get("t")) || 0, 0, 1) : null;

  let setIndex = params.get("set") === "1" ? 1 : 0;
  const S0 = SETS[setIndex];
  const px = osc(S0.x * U, S0.gx);
  const py = osc(S0.y * U, S0.gy);
  const qx = osc(S0.p * U, S0.gp); // the paper's rotary pendulum
  const qy = osc(S0.p * U, S0.gp);
  const all = [px, py, qx, qy];

  const applySet = (i) => {
    const s = SETS[i];
    retune(px, s.x * U, s.gx);
    retune(py, s.y * U, s.gy);
    retune(qx, s.p * U, s.gp);
    retune(qy, s.p * U, s.gp);
  };

  // Geometry, CSS px.
  let side = 1;
  let R = 1;
  let sheetX = 0;
  let sheetY = 0;
  let dpr = 2;
  let paperTex = null;
  let ink = null; // the sheet: paper texture plus everything drawn on it
  let inkCtx = null;
  let dirty = true;

  // Pen.
  let penState = "down"; // down | pool | up
  let pool = 0;
  let last = null; // last drawn point { x, y }
  let speedAvg = 0;

  // Tear.
  let leaving = null; // { canvas, t }

  const preset = () => {
    const s = R;
    px.x = 0;
    px.v = 0.6 * s * px.wd;
    py.x = 0.56 * s;
    py.v = 0;
    qx.x = 0.3 * s;
    qx.v = 0;
    qy.x = 0;
    qy.v = 0.3 * s * qy.wd;
  };

  const penPos = () => [side / 2 + px.x - qx.x, side / 2 + py.x - qy.x];

  const clearInk = () => {
    inkCtx.globalCompositeOperation = "source-over";
    inkCtx.drawImage(paperTex, 0, 0);
    last = null;
    dirty = true;
    pool = 0;
  };

  const layout = (w, h, d) => {
    const prevR = R;
    dpr = d;
    side = Math.round(Math.min(h * 0.8, w * 0.56));
    sheetX = Math.round((w - side) / 2);
    sheetY = Math.round((h - side) / 2);
    R = side * 0.43;
    const keep = ink;
    ink = document.createElement("canvas");
    ink.width = Math.round(side * dpr);
    ink.height = Math.round(side * dpr);
    // CPU-backed: it is only read on a tear or a resize, never per frame.
    inkCtx = ink.getContext("2d", { willReadFrequently: true });
    paperTex = makePaperTexture(ink.width, ink.height);
    clearInk();
    if (keep) {
      inkCtx.drawImage(keep, 0, 0, ink.width, ink.height);
      for (const o of all) scaleOsc(o, R / prevR);
    }
  };

  // Keep the figure on the sheet: the pen's reach is the sum of the lateral
  // swing and the paper's circle.
  const cap = () => {
    const ex = amp(px) + amp(qx);
    const ey = amp(py) + amp(qy);
    if (ex > R) {
      const k = R / ex;
      scaleOsc(px, k);
      scaleOsc(qx, k);
    }
    if (ey > R) {
      const k = R / ey;
      scaleOsc(py, k);
      scaleOsc(qy, k);
    }
  };

  const reach = () => Math.max(amp(px) + amp(qx), amp(py) + amp(qy));

  // Segments are batched into one path per ink level (width and density
  // quantised), so a frame strokes a handful of paths, not a hundred.
  let runLevel = -1;
  let runOpen = false;
  const targets = () => (dirty ? [inkCtx] : [inkCtx, ctx]);
  const toSheet = () => ctx.setTransform(1, 0, 0, 1, sheetX * dpr, sheetY * dpr);
  const flush = () => {
    if (runOpen) for (const c of targets()) c.stroke();
    runOpen = false;
  };
  const LEVELS = 12;
  const deposit = (x, y, speed) => {
    if (!last) {
      last = { x, y };
      return;
    }
    const dx = x - last.x;
    const dy = y - last.y;
    if (dx * dx + dy * dy < 1.1) return;
    speedAvg += (speed - speedAvg) * 0.5;
    // Fast pen: ~0.5px, slightly grey. Slow pen: up to ~1.3px, near black.
    const level = Math.round(Math.exp(-speedAvg / 70) * LEVELS);
    if (level !== runLevel || !runOpen) {
      flush();
      runLevel = level;
      const f = level / LEVELS;
      const width = 0.5 + 0.35 * f + 0.45 * f * f * f;
      const k = Math.min(1, f * 1.6);
      const r = INK_FAST[0] + (INK_DARK[0] - INK_FAST[0]) * k;
      const g = INK_FAST[1] + (INK_DARK[1] - INK_FAST[1]) * k;
      const b = INK_FAST[2] + (INK_DARK[2] - INK_FAST[2]) * k;
      for (const c of targets()) {
        c.strokeStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
        c.lineWidth = width * dpr;
        c.beginPath();
        c.moveTo(last.x * dpr, last.y * dpr);
      }
      runOpen = true;
    }
    for (const c of targets()) c.lineTo(x * dpr, y * dpr);
    last.x = x;
    last.y = y;
  };

  const simulate = (seconds) => {
    const n = Math.round(seconds / H);
    toSheet();
    for (const c of [inkCtx, ctx]) {
      c.globalCompositeOperation = "source-over";
      c.lineCap = "round";
      c.lineJoin = "round";
    }
    let [x0, y0] = penPos();
    for (let i = 0; i < n; i++) {
      for (const o of all) step(o);
      if (penState !== "down") continue;
      const [x, y] = penPos();
      const sp = Math.hypot(x - x0, y - y0) / H;
      x0 = x;
      y0 = y;
      deposit(x, y, sp);
    }
    flush();
    // The nib comes to rest: the swing is below a pixel, ink pools.
    const rch = reach();
    if (penState === "down" && rch < 0.35) penState = "pool";
    if (penState === "pool") {
      pool = Math.min(1, pool + seconds / 1.6);
      const [x, y] = penPos();
      for (const c of targets()) {
        c.fillStyle = `rgb(${INK_DARK.join(",")})`;
        c.beginPath();
        c.arc(x * dpr, y * dpr, (0.7 + 0.9 * Math.sqrt(pool)) * dpr, 0, TAU);
        c.fill();
      }
      if (pool >= 1) penState = "up";
    }
    if (penState !== "down" && rch > 1.2 && !leaving) {
      penState = "down";
      pool = 0;
      last = null;
    }
  };

  // Drag pushes the pendulums: each relaxes toward the hand's velocity in its
  // axis, so direction and speed set swing and phase. A still hand (or a
  // click) does nothing; the pendulums are pushed, never held.
  const PUSH = 2.4;
  const push = (dt) => {
    const p = stage.pointer;
    if (!p.down) return;
    const s = Math.hypot(p.vx, p.vy);
    if (s < 30) return;
    const k = 1 - Math.exp(-14 * dt);
    const tx = p.vx * PUSH;
    const ty = p.vy * PUSH;
    px.v += (tx - px.v) * k;
    py.v += (ty - py.v) * k;
    qx.v += (-0.4 * ty - qx.v) * k * 0.6;
    qy.v += (0.4 * tx - qy.v) * k * 0.6;
    cap();
  };

  const tear = () => {
    if (leaving) return;
    const snap = document.createElement("canvas");
    snap.width = ink.width;
    snap.height = ink.height;
    snap.getContext("2d").drawImage(ink, 0, 0);
    leaving = { canvas: snap, t: 0 };
    clearInk();
    penState = "up";
    setIndex = (setIndex + 1) % SETS.length;
    applySet(setIndex);
  };
  stage.canvas.addEventListener("dblclick", tear);

  const drawSheet = (img, lift) => {
    ctx.save();
    ctx.shadowColor = `rgba(40,32,20,${0.07 + 0.05 * lift})`;
    ctx.shadowBlur = (2 + 26 * lift) * dpr;
    ctx.shadowOffsetY = (1 + 14 * lift) * dpr;
    ctx.fillStyle = `rgb(${PAPER.join(",")})`;
    ctx.fillRect(0, 0, side, side);
    ctx.restore();
    ctx.drawImage(img, 0, 0, side, side);
  };

  stage.onResize((w, h, d) => {
    const first = !ink;
    layout(w, h, d);
    dirty = true;
    if (first) {
      preset();
      if (preT != null) {
        // Hold the figure partway into its decay.
        const target = preT * (Math.log(R / 1.5) / 0.03);
        for (let t = 0; t < target; t += 1 / 30) simulate(1 / 30);
      }
    }
  });

  stage.onFrame((dt) => {
    push(dt);
    simulate(dt);
    if (!dirty && !leaving) return;
    if (leaving) {
      leaving.t += dt / 0.85;
      if (leaving.t >= 1) {
        leaving = null;
        dirty = true;
        if (reach() > 1.2) {
          penState = "down";
          last = null;
        }
      }
    }

    const W = stage.width;
    const Hh = stage.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, W, Hh);

    // The pad: a couple of sheet edges under the top one.
    ctx.save();
    ctx.translate(sheetX, sheetY);
    ctx.fillStyle = "rgba(60,48,30,0.05)";
    ctx.fillRect(0.5, side, side - 1, 1);
    ctx.fillStyle = "rgba(60,48,30,0.035)";
    ctx.fillRect(1.5, side + 1, side - 3, 1);

    // The current sheet and its ink.
    drawSheet(ink, 0);
    ctx.restore();
    dirty = !!leaving;

    // The torn sheet leaving: lifts, then is pulled up and away.
    if (leaving) {
      const t = clamp(leaving.t, 0, 1);
      const lift = Math.min(1, t / 0.25);
      const liftE = 1 - (1 - lift) * (1 - lift);
      const m = clamp((t - 0.08) / 0.92, 0, 1);
      const e = m * m * m * (m * (m * 6 - 15) + 10);
      const dy = -(sheetY + side * 1.25) * e;
      const dx = side * 0.16 * e;
      const rot = (-7 * Math.PI) / 180 * e;
      ctx.save();
      ctx.translate(sheetX + side / 2 + dx, sheetY + side / 2 + dy);
      ctx.rotate(rot);
      ctx.scale(1 + 0.012 * liftE, 1 + 0.012 * liftE);
      ctx.translate(-side / 2, -side / 2);
      drawSheet(leaving.canvas, liftE);
      ctx.restore();
    }
  });

  return {
    destroy: () => {
      stage.canvas.removeEventListener("dblclick", tear);
      stage.destroy();
    },
  };
}
