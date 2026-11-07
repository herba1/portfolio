import { createStage, clamp } from "../_kit/stage";
import { createNib } from "./penAudio";

// A three-pendulum harmonograph, the machine behind Whitney's Vertigo
// spirals. Two lateral pendulums swing a pen arm in x and y from a gimbal
// beside the table; a third, free to swing in any direction, carries the
// table and its paper in a slow circle underneath. Each is a damped harmonic
// oscillator stepped exactly (no integration drift), and the line is the
// pen's position relative to the moving paper.
//
// The pen is a thing on the table: take the nib and pull it out and let go,
// and the arm swings from where you dropped it; take the paper and throw it,
// and the table circles. Lifting the nib starts a new figure, and the old one
// settles back into the sheet as a ghost. The pen lifts itself once the
// swing has wound in, so the centre of every figure stays open.
//
// Ink is laid opaque on a transparent layer, so one continuous line never
// beads where its segments meet. Width and density follow the pen's speed:
// thin and a little grey where it races, wider and blacker where it slows,
// tapering away as the swing nears the lift.

const TAU = Math.PI * 2;
const H = 1 / 1600; // physics substep, seconds
const U = TAU * 0.9; // one ratio unit, rad/s

// Ratio sets, alternating per sheet. Detuning is what makes the figure
// precess as it winds in, instead of retracing one closed curve. ax and ay
// are each sheet's opening swing as a share of the pen's reach: the pair
// that runs near unison with the table adds to it in quadrature, so it takes
// the fuller swing, and the first loops come to within about 8% of the
// sheet's edges either way.
const SETS = [
  { x: 2, y: 3 * 1.0021, p: 2 * 0.9984, gx: 0.03, gy: 0.034, gp: 0.026, ax: 1, ay: 0.92 },
  { x: 3, y: 4 * 1.0018, p: 4 * 0.9986, gx: 0.031, gy: 0.035, gp: 0.027, ax: 0.92, ay: 1 },
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

// The pen lifts when the swing has wound in to this share of the reach, and
// comes down again on a push past DROP. The line tapers over the last stretch.
const LIFT = 0.16;
const DROP = 0.24;
const TAPER = 1.8;
// The table's share of the reach, and how pale a settled figure becomes.
const TABLE = 0.24;
const GHOST = 0.1;
const SETTLE_S = 1.6;
const NIB_GRAB = 26; // CSS px around the nib ring
const ROD_GRAB = 12; // CSS px either side of the rod
// The pen arm is drawn as a hairline from the nib toward its gimbal, and
// fades out over its last third long before it gets there.
const ROD_LEN = 0.3; // share of the sheet's side
const ROD_MIN = 0.14;
const RING = 4.5; // CSS px

const ease = (t) => 1 - (1 - t) ** 3;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const layer = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

export async function createHarmonograph(host) {
  // Three layers. The ground and the sheet are DOM: the sheet is its own
  // canvas that is only ever inked a stroke at a time, and the table moves
  // it with a compositor transform. Over them the stage canvas carries the
  // pen arm (repainted in its own small rectangle) and a sheet being torn.
  // The arm is only a hairline and a ring at the nib: the drawing is the
  // only figure on the sheet.
  const stage = createStage(host, { dpr: 2, alpha: true });
  const ctx = stage.ctx;
  const deck = document.createElement("div");
  deck.className = "kit-canvas";
  deck.style.background = GROUND;
  const comp = document.createElement("canvas");
  Object.assign(comp.style, {
    position: "absolute",
    left: "0px",
    top: "0px",
    background: `rgb(${PAPER.join(",")})`,
    boxShadow: "0 1px 2px rgba(40,32,20,0.07), 0 1px 0 rgba(60,48,30,0.05), 0 2px 0 rgba(60,48,30,0.035)",
    willChange: "transform",
  });
  deck.appendChild(comp);
  host.insertBefore(deck, stage.canvas);
  const compCtx = comp.getContext("2d");
  let shownOff = "";
  const params = new URLSearchParams(window.location.search);
  const preT = params.has("t") ? clamp(parseFloat(params.get("t")) || 0, 0, 1) : null;
  const preGhost = params.has("ghost");
  const preHold = params.has("hold");
  const nib = createNib();

  let setIndex = params.get("set") === "1" ? 1 : 0;
  const S0 = SETS[setIndex];
  const px = osc(S0.x * U, S0.gx);
  const py = osc(S0.y * U, S0.gy);
  const qx = osc(S0.p * U, S0.gp); // the table's rotary pendulum
  const qy = osc(S0.p * U, S0.gp);
  const all = [px, py, qx, qy];

  const applySet = (i) => {
    const s = SETS[i];
    retune(px, s.x * U, s.gx);
    retune(py, s.y * U, s.gy);
    retune(qx, s.p * U, s.gp);
    retune(qy, s.p * U, s.gp);
  };

  // Geometry, CSS px. sheetX/Y is the sheet at rest; the table carries it
  // by (qx, qy) from there.
  let W = 1;
  let Hh = 1;
  let side = 1;
  let R = 1;
  let sheetX = 0;
  let sheetY = 0;
  let pivotX = 0;
  let pivotY = 0;
  let dpr = 2;
  let paperTex = null;
  // The sheet in three layers: settled ghosts baked into the paper, the
  // figure now settling, and the live figure.
  let base = null;
  let baseCtx = null;
  let prev = null;
  let prevCtx = null;
  let cur = null;
  let curCtx = null;
  // What the screen shows of the sheet: all three composed. The pen inks it
  // directly, so a steady frame is one blit; it is recomposed only while a
  // figure is settling.
  let settleT = 1; // 0..1 while the previous figure fades into the paper
  let prevInk = false;
  let curInk = false;

  // Pen.
  let pen = "down"; // down | up
  let lift = 0; // 0 on the paper .. 1 lifted, eased
  let last = null; // last drawn point, paper coords
  let speedAvg = 0;
  let penSpeed = 0;

  // The hand: holding the pen arm, or the table.
  let hold = null; // { kind: "pen" | "table", ... }
  // After a lift, the nib comes down again for a hand's push, or on its own
  // only for a strong swing: a fresh sheet never gets a stray scrap.
  let armed = false;

  // Tear.
  let leaving = null; // { canvas, t, ox, oy }

  const preset = (i = setIndex) => {
    const s = R;
    const k = 1 - TABLE;
    px.x = 0;
    px.v = SETS[i].ax * k * s * px.wd;
    py.x = SETS[i].ay * k * s;
    py.v = 0;
    qx.x = TABLE * s;
    qx.v = 0;
    qy.x = 0;
    qy.v = TABLE * s * qy.wd;
  };

  const penPos = () => [side / 2 + px.x - qx.x, side / 2 + py.x - qy.x];
  const nibScreen = () => [sheetX + side / 2 + px.x, sheetY + side / 2 + py.x];
  const tableOff = () => [Math.round(qx.x * dpr) / dpr, Math.round(qy.x * dpr) / dpr];

  const wipe = (c) => {
    c.globalCompositeOperation = "source-over";
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  };
  const clearSheet = () => {
    baseCtx.setTransform(1, 0, 0, 1, 0, 0);
    baseCtx.globalAlpha = 1;
    baseCtx.drawImage(paperTex, 0, 0);
    wipe(prevCtx);
    wipe(curCtx);
    prevInk = false;
    curInk = false;
    settleT = 1;
    last = null;
    compose();
  };
  const compose = () => {
    compCtx.setTransform(1, 0, 0, 1, 0, 0);
    compCtx.globalAlpha = 1;
    compCtx.drawImage(base, 0, 0);
    if (prevInk) {
      compCtx.globalAlpha = GHOST + (1 - GHOST) * (1 - ease(settleT));
      compCtx.drawImage(prev, 0, 0);
      compCtx.globalAlpha = 1;
    }
    compCtx.drawImage(cur, 0, 0);
  };
  const inks = () => (settleT < 1 ? [curCtx] : [curCtx, compCtx]);

  // The settling figure goes into the paper for good: older ghosts fade a
  // little further each time, so the sheet never silts up.
  const bake = () => {
    if (!prevInk) return;
    baseCtx.setTransform(1, 0, 0, 1, 0, 0);
    baseCtx.globalAlpha = 0.3;
    baseCtx.drawImage(paperTex, 0, 0);
    baseCtx.globalAlpha = GHOST;
    baseCtx.drawImage(prev, 0, 0);
    baseCtx.globalAlpha = 1;
    wipe(prevCtx);
    prevInk = false;
    settleT = 1;
    compose();
  };
  // A new figure begins: the live one starts settling.
  const settle = () => {
    if (!curInk) return;
    bake();
    const t = prev;
    prev = cur;
    prevCtx = curCtx;
    cur = t;
    curCtx = t.getContext("2d");
    wipe(curCtx);
    prevInk = true;
    curInk = false;
    settleT = 0;
    compose();
  };

  const layout = (w, h, d) => {
    const prevR = R;
    W = w;
    Hh = h;
    dpr = d;
    side = Math.round(Math.min(h * 0.78, w * 0.54));
    sheetX = Math.round((w - side) / 2);
    sheetY = Math.round((h - side) / 2);
    R = side * 0.45;
    // The gimbal stands on the frame to the right of the table. It is never
    // drawn; the arm's hairline points toward it and fades out first.
    pivotX = Math.min(w - 24, sheetX + side + Math.max(36, (w - sheetX - side) * 0.5));
    pivotY = sheetY + side * 0.62;
    const n = Math.round(side * dpr);
    const keep = base ? [base, prev, cur] : null;
    base = layer(n, n);
    baseCtx = base.getContext("2d");
    prev = layer(n, n);
    prevCtx = prev.getContext("2d");
    cur = layer(n, n);
    curCtx = cur.getContext("2d");
    comp.width = n;
    comp.height = n;
    Object.assign(comp.style, { width: `${side}px`, height: `${side}px`, left: `${sheetX}px`, top: `${sheetY}px` });
    shownOff = "";
    dirtyAll = true;
    paperTex = makePaperTexture(n, n);
    const ink = { prevInk, curInk, settleT };
    clearSheet();
    if (keep) {
      baseCtx.drawImage(keep[0], 0, 0, n, n);
      prevCtx.drawImage(keep[1], 0, 0, n, n);
      curCtx.drawImage(keep[2], 0, 0, n, n);
      ({ prevInk, curInk, settleT } = ink);
      compose();
      for (const o of all) scaleOsc(o, R / prevR);
    }
  };

  const reach = () => Math.max(amp(px) + amp(qx), amp(py) + amp(qy));

  // Keep the figure on the sheet after a release: the hand sets where the
  // pendulum is; only its speed is trimmed if the swing would run off.
  const fit = (o, room) => {
    room = Math.max(0, room);
    if (Math.abs(o.x) > room) o.x = Math.sign(o.x) * room;
    const a = amp(o);
    if (a <= room) return;
    // amp^2 = x^2 + ((v + g x)/wd)^2; solve for v.
    const u = Math.sqrt(Math.max(0, room * room - o.x * o.x)) * o.wd;
    const s = Math.sign(o.v + o.g * o.x) || 1;
    o.v = s * u - o.g * o.x;
  };

  // Segments are batched into one path per ink level (width and density
  // quantised), so a frame strokes a handful of paths, not a hundred.
  let runLevel = -1;
  let runOpen = false;
  const flush = () => {
    if (runOpen) for (const c of inks()) c.stroke();
    runOpen = false;
  };
  const LEVELS = 12;
  const deposit = (x, y, speed, taper) => {
    if (!last) {
      last = { x, y };
      return;
    }
    const dx = x - last.x;
    const dy = y - last.y;
    if (dx * dx + dy * dy < 1.1) return;
    speedAvg += (speed - speedAvg) * 0.5;
    // Fast pen: ~0.5px, slightly grey. Slow pen: up to ~1.3px, near black.
    // Near the lift the nib eases off the paper and the line fines away.
    const f0 = Math.exp(-speedAvg / 70) * (0.35 + 0.65 * taper);
    const level = Math.round(f0 * LEVELS) * 4 + Math.round(taper * 3);
    if (level !== runLevel || !runOpen) {
      flush();
      runLevel = level;
      const f = Math.round(f0 * LEVELS) / LEVELS;
      const width = (0.5 + 0.35 * f + 0.45 * f * f * f) * (0.4 + 0.6 * (Math.round(taper * 3) / 3));
      const k = Math.min(1, f * 1.6);
      const r = INK_FAST[0] + (INK_DARK[0] - INK_FAST[0]) * k;
      const g = INK_FAST[1] + (INK_DARK[1] - INK_FAST[1]) * k;
      const b = INK_FAST[2] + (INK_DARK[2] - INK_FAST[2]) * k;
      for (const c of inks()) {
        c.strokeStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
        c.lineWidth = width * dpr;
        c.beginPath();
        c.moveTo(last.x * dpr, last.y * dpr);
      }
      runOpen = true;
    }
    for (const c of inks()) c.lineTo(x * dpr, y * dpr);
    curInk = true;
    last.x = x;
    last.y = y;
  };

  const simulate = (seconds) => {
    const n = Math.max(1, Math.round(seconds / H));
    for (const c of [curCtx, compCtx]) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = 1;
      c.lineCap = "round";
      c.lineJoin = "round";
    }
    const inking = pen === "down" && lift < 0.06;
    const held = hold && (hold.kind === "pen" || hold.taken) ? hold.kind : null;
    let [x0, y0] = penPos();
    let travelled = 0;
    for (let i = 0; i < n; i++) {
      if (held !== "pen") {
        step(px);
        step(py);
      }
      if (held !== "table") {
        step(qx);
        step(qy);
      }
      const [x, y] = penPos();
      const d = Math.hypot(x - x0, y - y0);
      travelled += d;
      x0 = x;
      y0 = y;
      if (!inking) continue;
      const rch = reach();
      deposit(x, y, d / H, smooth(LIFT * R, TAPER * LIFT * R, rch));
    }
    flush();
    penSpeed = travelled / Math.max(1e-6, n * H);

    // The swing has wound in: lift the nib and leave the centre open.
    const rch = reach();
    if (pen === "down" && (rch < LIFT * R || held === "pen" || leaving)) {
      pen = "up";
      last = null;
    } else if (pen === "up" && !held && !leaving && rch > DROP * R && (armed || rch > 0.45 * R)) {
      // Coming back down after a lift is a new figure.
      pen = "down";
      armed = false;
      last = null;
      settle();
    }
  };

  // The hand. Near the nib it takes the pen arm; anywhere on the sheet it
  // takes the table. Either way the pendulum follows the hand while held and
  // keeps the hand's velocity when let go.
  // Near the collar, or on the outer part of the rod: a swinging pen is
  // hard to catch, so the whole arm is a handle.
  // The arm as drawn: from the nib toward the gimbal, for as far as it runs
  // before it would leave the sheet (never shorter than ROD_MIN).
  const arm = () => {
    const [nx, ny] = nibScreen();
    const dx = pivotX - nx;
    const dy = pivotY - ny;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    const [ox, oy] = tableOff();
    const x0 = sheetX + ox;
    const y0 = sheetY + oy;
    const tx = ux > 0 ? (x0 + side - nx) / ux : ux < 0 ? (x0 - nx) / ux : Infinity;
    const ty = uy > 0 ? (y0 + side - ny) / uy : uy < 0 ? (y0 - ny) / uy : Infinity;
    const len = Math.min(d, side * ROD_LEN, Math.max(side * ROD_MIN, Math.min(tx, ty) - 8));
    return { nx, ny, ux, uy, len };
  };
  const onPen = (x, y) => {
    const { nx, ny, ux, uy, len } = arm();
    if (Math.hypot(x - nx, y - ny) < NIB_GRAB) return true;
    const f = (x - nx) * ux + (y - ny) * uy;
    if (f < 0 || f > len) return false;
    return Math.hypot(x - (nx + ux * f), y - (ny + uy * f)) < ROD_GRAB;
  };

  stage.on("down", (p) => {
    if (!params.has("nosound")) nib.unlock();
    const [nx, ny] = nibScreen();
    const [ox, oy] = tableOff();
    if (onPen(p.x, p.y)) {
      hold = { kind: "pen", dx: nx - p.x, dy: ny - p.y };
    } else if (p.x > sheetX + ox && p.x < sheetX + ox + side && p.y > sheetY + oy && p.y < sheetY + oy + side) {
      // The table is only taken once the hand moves, so a click (or the
      // double-click that tears the sheet) leaves its swing alone.
      hold = { kind: "table", taken: false, gx: p.x, gy: p.y, qx0: 0, qy0: 0 };
    }
    stage.canvas.style.cursor = hold?.kind === "pen" ? "grabbing" : "";
  });
  stage.on("move", (p) => {
    if (hold) return;
    stage.canvas.style.cursor = onPen(p.x, p.y) ? "grab" : "";
  });
  stage.on("up", (p) => {
    if (!hold) return;
    if (hold.kind === "table" && !hold.taken) {
      hold = null;
      return;
    }
    armed = true;
    if (hold.kind === "pen") {
      px.v = p.vx;
      py.v = p.vy;
      fit(px, R - amp(qx));
      fit(py, R - amp(qy));
    } else {
      qx.v = p.vx;
      qy.v = p.vy;
      fit(qx, R * 0.42);
      fit(qy, R * 0.42);
      fit(px, R - amp(qx));
      fit(py, R - amp(qy));
    }
    hold = null;
    stage.canvas.style.cursor = "";
  });

  const follow = (dt) => {
    if (!hold) return;
    const p = stage.pointer;
    const k = 1 - Math.exp(-36 * dt);
    if (hold.kind === "pen") {
      const reachX = R - amp(qx);
      const reachY = R - amp(qy);
      const tx = clamp(p.x + hold.dx - sheetX - side / 2, -reachX, reachX);
      const ty = clamp(p.y + hold.dy - sheetY - side / 2, -reachY, reachY);
      px.x += (tx - px.x) * k;
      py.x += (ty - py.x) * k;
      px.v = p.vx;
      py.v = p.vy;
    } else {
      if (!hold.taken) {
        if (Math.hypot(p.x - hold.gx, p.y - hold.gy) < 4) return;
        Object.assign(hold, { taken: true, gx: p.x, gy: p.y, qx0: qx.x, qy0: qy.x });
        stage.canvas.style.cursor = "grabbing";
      }
      const lim = R * 0.42;
      const tx = clamp(hold.qx0 + p.x - hold.gx, -lim, lim);
      const ty = clamp(hold.qy0 + p.y - hold.gy, -lim, lim);
      qx.x += (tx - qx.x) * k;
      qy.x += (ty - qy.x) * k;
      qx.v = p.vx;
      qy.v = p.vy;
    }
  };

  const tear = () => {
    if (leaving) return;
    const snap = layer(comp.width, comp.height);
    snap.getContext("2d").drawImage(comp, 0, 0);
    const [ox, oy] = tableOff();
    leaving = { canvas: snap, t: 0, ox, oy };
    clearSheet();
    pen = "up";
    setIndex = (setIndex + 1) % SETS.length;
    applySet(setIndex);
  };
  stage.canvas.addEventListener("dblclick", tear);

  let dirtyAll = true;
  let box = null; // the overlay rectangle painted last frame, CSS px
  const drawSheet = (layers, liftAmt) => {
    ctx.save();
    ctx.shadowColor = `rgba(40,32,20,${0.07 + 0.05 * liftAmt})`;
    ctx.shadowBlur = (2 + 26 * liftAmt) * dpr;
    ctx.shadowOffsetY = (1 + 14 * liftAmt) * dpr;
    ctx.fillStyle = `rgb(${PAPER.join(",")})`;
    ctx.fillRect(0, 0, side, side);
    ctx.restore();
    for (const [img, a] of layers) {
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(img, 0, 0, side, side);
    }
    ctx.globalAlpha = 1;
  };

  // The pen, seen from above: a ring of ink round the nib, and the arm as a
  // half-pixel hairline in the same ink that fades out over its last third.
  // The ring opens a touch as the nib lifts, and the dot of the nib on the
  // paper goes with it.
  const INK = `rgb(${INK_DARK.join(",")})`;
  const PAPER_INK = `rgb(${PAPER.join(",")})`;
  const drawPen = (a) => {
    const { nx, ny, ux, uy, len } = a;
    const r = RING + 0.75 * lift;
    const sx = nx + ux * r;
    const sy = ny + uy * r;
    const ex = nx + ux * len;
    const ey = ny + uy * len;
    const grad = ctx.createLinearGradient(sx, sy, ex, ey);
    const [ir, ig, ib] = INK_DARK;
    grad.addColorStop(0, `rgba(${ir},${ig},${ib},1)`);
    grad.addColorStop(0.667, `rgba(${ir},${ig},${ib},1)`);
    grad.addColorStop(1, `rgba(${ir},${ig},${ib},0)`);
    ctx.lineCap = "butt";
    ctx.strokeStyle = grad;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    // A paper knockout either side of the ring, as a printer would leave
    // round a mark laid over a dense tint, so it reads over the figure.
    ctx.beginPath();
    ctx.arc(nx, ny, r, 0, TAU);
    ctx.strokeStyle = PAPER_INK;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.75;
    ctx.stroke();
    if (lift < 0.98) {
      ctx.fillStyle = INK;
      ctx.globalAlpha = 1 - lift;
      ctx.beginPath();
      ctx.arc(nx, ny, 0.9, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  };

  stage.onResize((w, h, d) => {
    const first = !base;
    layout(w, h, d);
    if (first) {
      if (preGhost) {
        // A figure already drawn and settled into the sheet.
        applySet(1);
        preset(1);
        for (let t = 0; t < 70; t += 1 / 30) simulate(1 / 30);
        applySet(setIndex);
        settle();
        bake();
        pen = "up";
        for (const o of all) scaleOsc(o, 0);
      }
      preset();
      if (pen === "up") {
        pen = "down";
        last = null;
      }
      if (preT != null) {
        // Hold the figure partway into its decay, to the lift.
        const target = preT * (Math.log(reach() / R / LIFT) / 0.03);
        for (let t = 0; t < target; t += 1 / 30) simulate(1 / 30);
      }
      if (preHold) lift = 1;
    }
  });

  if (params.has("debug")) window.__harmonograph = { nib: () => nibScreen(), state: () => ({ pen, lift, reach: reach() / R, settleT }) };
  stage.onFrame((dt) => {
    follow(dt);
    simulate(dt);
    lift += ((pen === "up" ? 1 : 0) - lift) * (1 - Math.exp(-dt / (pen === "up" ? 0.06 : 0.09)));
    if (preHold) lift = 1;
    if (settleT < 1) {
      settleT = Math.min(1, settleT + dt / SETTLE_S);
      if (settleT >= 1) bake();
      else compose();
    }
    nib.level(pen === "down" && lift < 0.2 ? clamp(penSpeed / 2600, 0, 1) * (1 - lift * 4) : 0);

    if (leaving) {
      leaving.t += dt / 0.85;
      if (leaving.t >= 1) leaving = null;
    }

    // The pad rides the table.
    const [ox, oy] = tableOff();
    const off = `translate3d(${ox}px, ${oy}px, 0)`;
    if (off !== shownOff) {
      comp.style.transform = off;
      shownOff = off;
    }

    // The overlay: clear what was painted last frame, then the pen.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    if (dirtyAll || leaving) ctx.clearRect(0, 0, W, Hh);
    else if (box) ctx.clearRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
    dirtyAll = !!leaving;
    const a = arm();
    const ex = a.nx + a.ux * a.len;
    const ey = a.ny + a.uy * a.len;
    const m = 12;
    box = [Math.floor(Math.min(a.nx, ex) - m), Math.floor(Math.min(a.ny, ey) - m), Math.ceil(Math.max(a.nx, ex) + m), Math.ceil(Math.max(a.ny, ey) + m)];
    drawPen(a);

    // The torn sheet leaving: lifts, then is pulled up and away, over the pen.
    if (leaving) {
      const t = clamp(leaving.t, 0, 1);
      const l = Math.min(1, t / 0.25);
      const liftE = 1 - (1 - l) * (1 - l);
      const u = clamp((t - 0.08) / 0.92, 0, 1);
      const e = u * u * u * (u * (u * 6 - 15) + 10);
      const dy = -(sheetY + leaving.oy + side * 1.25) * e;
      const dx = side * 0.16 * e;
      const rot = ((-7 * Math.PI) / 180) * e;
      ctx.save();
      ctx.translate(sheetX + leaving.ox + side / 2 + dx, sheetY + leaving.oy + side / 2 + dy);
      ctx.rotate(rot);
      ctx.scale(1 + 0.012 * liftE, 1 + 0.012 * liftE);
      ctx.translate(-side / 2, -side / 2);
      drawSheet([[leaving.canvas, 1]], liftE);
      ctx.restore();
    }
  });

  return {
    destroy: () => {
      stage.canvas.removeEventListener("dblclick", tear);
      nib.close();
      stage.destroy();
      deck.remove();
    },
  };
}
