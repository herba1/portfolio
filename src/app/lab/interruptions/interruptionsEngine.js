import { createStage, clamp, damp } from "../_kit/stage";
import { createPen } from "./pen";

// Vera Molnar's Interruptions (1968-69) as one rule: a square grid of short
// lines of equal length, each turned from the vertical by a small random
// amount, with irregular patches where no line was drawn. The pointer is a
// second interruption. Passing over the sheet lifts the lines it touches:
// each is erased to a faint ghost of itself, so the hole the hand made reads
// apart from the holes Molnar left. The pen then comes back for them as a
// plotter would, one line at a time, always travelling to the nearest lifted
// line next, so the hole closes along a path. Dragging raises the variance
// under the hand all the way, so the ordered weave turns into a tangle of
// lines at any angle, pushed off the grid, which then springs home.
//
// ?seed=n draws a different sheet. ?t=0..1 plays a fixed gesture to that
// point and holds it, so a still shows the holes and the disorder.

const PAPER = [242, 240, 235];
const INK = "rgb(30, 29, 27)";
const GHOST = "rgba(30, 29, 27, 0.2)"; // what an erased line leaves on the sheet
const REST_VAR = 0.4; // the drawing's own variance, radians either side of vertical
const DRIFT = 2; // how far, in cells end to end, full chaos can carry a line off the grid
const LIFT_WAIT = 0.9; // seconds a lifted line stays lifted before the pen may return
const PEN_LINE = 0.03; // seconds the pen takes to draw one line, at constant speed
const PEN_TRAVEL = 100; // cells per second the pen moves between lines, up
const SCRIPT_SECONDS = 7;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise(seed) {
  const h = (i, j) => {
    const v = Math.sin(i * 127.1 + j * 311.7 + seed * 17.13) * 43758.5453;
    return v - Math.floor(v);
  };
  return (x, y) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
  };
}

export async function createInterruptions(host, { embedded = false } = {}) {
  // The paper is its own layer, made once per size; the ink canvas above it
  // is cleared and restroked only on frames where something moved.
  const sheet = document.createElement("canvas");
  sheet.className = "kit-canvas";
  host.appendChild(sheet);
  const stage = createStage(host, { dpr: 2, alpha: true });
  const ctx = stage.ctx;
  const params = new URLSearchParams(window.location.search);
  const seed = Number.parseInt(params.get("seed") ?? "", 10) || 1968;
  const hold = params.has("t") ? clamp(Number.parseFloat(params.get("t")) || 0, 0, 1) : null;
  const pen = createPen();

  // The sheet: one drawing per seed, independent of the box size.
  const N = 50;
  const count = N * N;
  const rest = new Float32Array(count); // the drawing's angle for each line
  const wild = new Float32Array(count); // where full chaos would turn it
  const present = new Uint8Array(count); // drawn at all (Molnar's holes are 0)
  const edge = new Float32Array(count); // ragged reach of the pointer, per line
  const from = new Uint8Array(count); // which end the pen redraws from
  const drift = new Float32Array(count * 2); // where chaos would push it off the grid
  {
    const rand = rng(seed);
    const n1 = valueNoise(seed);
    const n2 = valueNoise(seed + 7);
    for (let i = 0; i < count; i++) {
      // Triangular and small: the weave stays near vertical, which is what
      // lets a disturbance in it show.
      rest[i] = (rand() + rand() - 1) * REST_VAR;
      wild[i] = (rand() - 0.5) * Math.PI;
      edge[i] = 0.75 + rand() * 0.5;
      from[i] = rand() < 0.5 ? 1 : 0;
      drift[i * 2] = (rand() - 0.5) * DRIFT;
      drift[i * 2 + 1] = (rand() - 0.5) * DRIFT;
      const gx = i % N;
      const gy = (i / N) | 0;
      // Holes: a coarse field with a finer one eating at its edges, so the
      // gaps come in a few sizes and never as circles.
      const f = n1(gx / 5.5, gy / 5.5) * 0.66 + n2(gx / 2.2, gy / 2.2) * 0.34;
      present[i] = f > 0.74 || rand() < 0.015 ? 0 : 1;
    }
  }

  // Live state per line.
  const len = new Float32Array(count).fill(1); // 0..1 of its length
  const drawing = new Float32Array(count).fill(-1); // >=0: redraw progress
  const liftedAt = new Float32Array(count).fill(-1); // >=0: lifted, last touched then
  let lifted = 0; // how many lines are waiting for the pen or under it
  // The pen: where it is (in cells), the line it is drawing or heading for,
  // and how long until it reaches that line.
  let penX = 0;
  let penY = 0;
  let penLine = -1;
  let penTravel = 0;
  const chaos = new Float32Array(count); // 0..1 of the way to wild
  const calmAt = new Float32Array(count); // sim time chaos may start to fall
  const ang = new Float32Array(count);
  const angV = new Float32Array(count);
  const off = new Float32Array(count); // how far off the grid, sprung toward chaos
  const offV = new Float32Array(count);
  // Only the parts of the sheet that changed are restroked: the grid is cut
  // into tiles, and a frame clears and redraws just the tiles that moved.
  const TILE = 5;
  const NT = Math.ceil(N / TILE);
  const tileOf = (i) => (((i / N) | 0) / TILE | 0) * NT + ((i % N) / TILE | 0);
  const tileDirty = new Uint8Array(NT * NT);
  ang.set(rest);

  let simT = 0;
  let W = 1;
  let H = 1;
  let S = 1; // field side, css px
  let ox = 0;
  let oy = 0;
  let cell = 1;
  let dirty = true;

  stage.onResize((w, h, dpr) => {
    W = w;
    H = h;
    // A print: the square sits in a wide margin of bare paper.
    S = Math.min(w * 0.82, h * (embedded ? 0.8 : 0.76));
    cell = S / N;
    ox = (w - S) / 2;
    oy = (h - S) / 2;
    makePaper(sheet, w, h, dpr, seed);
    dirty = true;
  });

  // One simulation step; ptr is in css px, or null when the pointer is away.
  const step = (dt, ptr) => {
    simT += dt;
    let moving = false;
    tileDirty.fill(0);
    const hover = ptr && !ptr.down;
    const drag = ptr && ptr.down;
    const speed = ptr ? Math.hypot(ptr.vx, ptr.vy) : 0;
    const gx = ptr ? (ptr.x - ox) / cell - 0.5 : 0;
    const gy = ptr ? (ptr.y - oy) / cell - 0.5 : 0;
    const liftR = 2.3;
    const chaosR = 7;
    const push = drag ? clamp(speed / 900, 0, 1.4) * dt * 7 : 0;
    const k = 70;
    const c = 2 * Math.sqrt(k) * 0.55; // a little under critical: settles with one soft overshoot

    for (let i = 0; i < count; i++) {
      if (!present[i]) continue;
      const x = i % N;
      const y = (i / N) | 0;
      let mv = false;
      let d2 = Infinity;
      if (ptr) d2 = (x - gx) ** 2 + (y - gy) ** 2;

      // The interruption: lines under a passing pointer are lifted, and stay
      // lifted while the pointer is over them.
      if (hover && d2 < (liftR * edge[i]) ** 2) {
        if (liftedAt[i] < 0) lifted++;
        if (drawing[i] >= 0) {
          len[i] = Math.min(1, drawing[i]);
          drawing[i] = -1;
        }
        if (penLine === i) penLine = -1;
        liftedAt[i] = simT;
        mv = true;
      }
      // Erasing is quick and leaves no stub: the ink pulls in about its
      // middle over its ghost, and is gone before it can read as a dot.
      if (liftedAt[i] >= 0 && drawing[i] < 0 && len[i] > 0) {
        len[i] = damp(len[i], 0, 22, dt);
        if (len[i] < 0.3) len[i] = 0;
        mv = true;
      }

      // Dragging: the variance rises under the hand, then falls back.
      if (push > 0 && d2 < chaosR * chaosR) {
        const f = Math.exp(-d2 / (chaosR * chaosR * 0.42));
        chaos[i] = Math.min(1, chaos[i] + push * f);
        calmAt[i] = simT + 0.5 + Math.random() * 0.6;
      } else if (chaos[i] > 0 && simT > calmAt[i]) {
        chaos[i] = damp(chaos[i], 0, 0.9, dt);
        if (chaos[i] < 0.002) chaos[i] = 0;
      }
      // Full chaos turns a line from its own lean to any angle in the half
      // turn, so a scrubbed patch is a plain tangle against the weave.
      const target = rest[i] + chaos[i] * (wild[i] - rest[i]);
      const a = k * (target - ang[i]) - c * angV[i];
      angV[i] += a * dt;
      ang[i] += angV[i] * dt;
      offV[i] += ((k * 0.6) * (chaos[i] - off[i]) - c * 0.8 * offV[i]) * dt;
      off[i] += offV[i] * dt;
      if (Math.abs(target - ang[i]) > 0.0004 || Math.abs(angV[i]) > 0.002 || chaos[i] > 0 || Math.abs(off[i]) > 0.001) mv = true;
      else if (angV[i] !== 0 || off[i] !== 0) {
        mv = true;
        ang[i] = target;
        angV[i] = 0;
        off[i] = 0;
        offV[i] = 0;
      }
      if (mv) {
        moving = true;
        tileDirty[tileOf(i)] = 1;
      }
    }
    // The pen: draw the current line at constant speed, then travel to the
    // nearest line that has waited long enough, like a plotter working
    // through its path.
    if (penLine >= 0) {
      if (penTravel > 0) penTravel -= dt;
      else {
        if (drawing[penLine] < 0) {
          drawing[penLine] = 0;
          len[penLine] = 0;
          if (hold === null) pen.down();
        }
        drawing[penLine] += dt / PEN_LINE;
        if (drawing[penLine] >= 1) {
          drawing[penLine] = -1;
          liftedAt[penLine] = -1;
          len[penLine] = 1;
          lifted--;
          penX = penLine % N;
          penY = (penLine / N) | 0;
          penLine = -1;
        }
        tileDirty[tileOf(penLine >= 0 ? penLine : penY * N + penX)] = 1;
        moving = true;
      }
    }
    if (penLine < 0 && lifted > 0) {
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < count; i++) {
        if (liftedAt[i] < 0 || len[i] > 0 || simT - liftedAt[i] < LIFT_WAIT) continue;
        const d = ((i % N) - penX) ** 2 + (((i / N) | 0) - penY) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (best >= 0) {
        penLine = best;
        penTravel = Math.sqrt(bd) / PEN_TRAVEL;
      }
    }
    return moving;
  };

  // A line reaches about 1.8 cells from its own centre (its half length,
  // stretched under chaos, and its drift), so a dirty tile is cleared with a
  // 2 cell margin, and every
  // line in it or a neighbouring tile is redrawn inside that clip.
  const draw = (full = true) => {
    const dpr = stage.dpr;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let near = null;
    if (full) ctx.clearRect(0, 0, W, H);
    else {
      near = new Uint8Array(NT * NT);
      ctx.beginPath();
      const m = 2 * cell;
      for (let t = 0; t < NT * NT; t++) {
        if (!tileDirty[t]) continue;
        const tx = t % NT;
        const ty = (t / NT) | 0;
        ctx.rect(ox + tx * TILE * cell - m, oy + ty * TILE * cell - m, TILE * cell + 2 * m, TILE * cell + 2 * m);
        for (let v = Math.max(0, ty - 1); v <= Math.min(NT - 1, ty + 1); v++)
          for (let u = Math.max(0, tx - 1); u <= Math.min(NT - 1, tx + 1); u++) near[v * NT + u] = 1;
      }
      ctx.clip();
      ctx.clearRect(0, 0, W, H);
    }
    ctx.lineWidth = clamp(cell * 0.085, 0.5, 0.8);
    ctx.lineCap = "butt"; // round caps cost 4x to raster and vanish at this width
    const half = cell * 0.68; // length a touch over the cell, as in the prints
    const e = [0, 0, 0, 0]; // centre and half extent of the line in hand
    const ends = (i) => {
      e[0] = ox + ((i % N) + 0.5 + off[i] * drift[i * 2]) * cell;
      e[1] = oy + (((i / N) | 0) + 0.5 + off[i] * drift[i * 2 + 1]) * cell;
      // Chaos stretches a line a little too, so the tangle crosses itself.
      const h = half * (1 + 0.35 * Math.min(1, Math.abs(off[i])));
      e[2] = Math.sin(ang[i]) * h;
      e[3] = -Math.cos(ang[i]) * h;
      return e;
    };
    // The ghosts of lifted lines, under the ink.
    ctx.strokeStyle = GHOST;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      if (liftedAt[i] < 0 || (near && !near[tileOf(i)])) continue;
      const [cx, cy, sx, sy] = ends(i);
      ctx.moveTo(cx - sx, cy - sy);
      ctx.lineTo(cx + sx, cy + sy);
    }
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      if (!present[i] || (near && !near[tileOf(i)])) continue;
      const g = drawing[i] >= 0 ? Math.min(1, drawing[i]) : len[i];
      if (g <= 0.002) continue;
      const [cx, cy, sx, sy] = ends(i);
      if (drawing[i] >= 0) {
        // The pen draws it again from one end.
        const s = from[i] ? 1 : -1;
        const ax = cx - sx * s;
        const ay = cy - sy * s;
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + 2 * sx * s * g, ay + 2 * sy * s * g);
      } else {
        ctx.moveTo(cx - sx * g, cy - sy * g);
        ctx.lineTo(cx + sx * g, cy + sy * g);
      }
    }
    ctx.stroke();
    ctx.restore();
  };

  // ?t: a fixed gesture, simulated in fixed steps and held.
  if (hold !== null) {
    let ready = false;
    stage.onFrame(() => {
      if (ready || W <= 1) return;
      ready = true;
      const end = hold * SCRIPT_SECONDS;
      const dt = 1 / 120;
      const p = { x: 0, y: 0, vx: 0, vy: 0, down: false };
      const at = (u, v) => [ox + u * S, oy + v * S];
      let prev = null;
      const rand = rng(seed + 3);
      for (let t = 0; t < end; t += dt) {
        let q = null;
        if (t < 2.4) {
          // A slow pass across the sheet, wandering down from the upper left.
          const u = t / 2.4;
          q = at(0.08 + u * 0.66, 0.2 + u * 0.22 + Math.sin(u * Math.PI * 1.6) * 0.1);
          p.down = false;
        } else if (t > 2.8 && t < 4.4) {
          // A quick scrub low on the sheet.
          const u = (t - 2.8) / 1.6;
          q = at(0.62 + Math.sin(u * Math.PI * 3) * 0.12, 0.72 + Math.sin(u * Math.PI * 1.5) * 0.06 + (rand() - 0.5) * 0.002);
          p.down = true;
        }
        if (q) {
          if (prev) {
            p.vx = (q[0] - prev[0]) / dt;
            p.vy = (q[1] - prev[1]) / dt;
          }
          [p.x, p.y] = q;
          prev = q;
        } else prev = null;
        step(dt, q ? p : null);
      }
      dirty = true;
    });
    stage.onFrame(() => {
      if (!ready || !dirty) return;
      draw();
      dirty = false;
    });
    return {
      destroy: () => {
        pen.destroy();
        stage.destroy();
        sheet.remove();
      },
    };
  }

  stage.on("down", () => pen.unlock());

  stage.onFrame((dt) => {
    const p = stage.pointer;
    const active = p.inside || p.down;
    const moving = step(dt, active ? p : null);
    if (moving || dirty) {
      draw(dirty);
      dirty = false;
    }
  });

  return {
    destroy: () => {
      pen.destroy();
      stage.destroy();
      sheet.remove();
    },
  };
}

// Warm cotton paper: flat colour, a faint mottle and a fine tooth, made once
// per size at device resolution.
function makePaper(c, w, h, dpr, seed) {
  const cw = Math.round(w * dpr);
  const ch = Math.round(h * dpr);
  c.width = cw;
  c.height = ch;
  const g = c.getContext("2d");
  const img = g.createImageData(cw, ch);
  const d = img.data;
  const n = valueNoise(seed + 11);
  const rand = rng(seed + 5);
  const sc = 1 / (90 * dpr);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const m = (n(x * sc, y * sc) - 0.5) * 3.2;
      const t = (rand() - 0.5) * 3.4;
      const o = (y * cw + x) * 4;
      d[o] = PAPER[0] + m + t;
      d[o + 1] = PAPER[1] + m + t;
      d[o + 2] = PAPER[2] + m * 1.1 + t;
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}
