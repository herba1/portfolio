import { createStage, clamp, damp } from "../_kit/stage";
import { createOramicsSound } from "./oramicsSound";

// A loop of clear 35mm leader running leftward past a fixed reader, after
// Daphne Oram's Oramics machine: ink drawn on the film is read where it
// crosses the line of light. Each run of ink on the line is one voice; its
// height on the film is the pitch, its thickness on the line (what a
// photocell would see) is the level. Everything is in film coordinates
// (u along the loop, 0..1 per lap; v across the drawable band, 0 at the
// top), so the drawings survive any resize.

const GROUND = "#f2f0eb";
const BASE = "#e5e6e0";
const EDGE = "#a9a79f";
const PERF_EDGE = "#b1afa7";
const PRINT = "#97928a";
const INK = "#1b1916";
const READER = "#6d6961";

const VOICES = 6;
const SPAN = 26; // semitones from the bottom of the band to the top
const ROOT = 130.81; // C3 at the bottom
const SCALE = [0, 2, 4, 7, 9]; // major pentatonic
const W_MIN = 0.006; // brush width, fraction of strip height
const W_MAX = 0.058;

const frac = (x) => x - Math.floor(x);
const smooth = (t) => t * t * (3 - 2 * t);

// Height to pitch, pulled gently onto the pentatonic scale: flat plateaus
// on the notes, smooth glides between them.
function semisToHz(s) {
  const oct = Math.floor(s / 12);
  const r = s - oct * 12;
  let lo = SCALE[SCALE.length - 1] - 12;
  let hi = SCALE[0];
  for (let i = 0; i < SCALE.length; i += 1) {
    const a = SCALE[i];
    const b = i + 1 < SCALE.length ? SCALE[i + 1] : 12;
    if (r >= a && r < b) {
      lo = a;
      hi = b;
      break;
    }
  }
  const t = clamp((r - lo) / (hi - lo), 0, 1);
  const q = oct * 12 + lo + (hi - lo) * smooth(smooth(t));
  return ROOT * Math.pow(2, q / 12);
}

export function createOramics(host) {
  const stage = createStage(host, { dpr: 2 });
  const g = stage.ctx;
  const params = new URLSearchParams(window.location.search);
  const held = params.has("t") ? Math.max(0, parseFloat(params.get("t")) || 0) : null;
  const mono = getComputedStyle(host).getPropertyValue("--font-mono").trim() || "ui-monospace, monospace";
  const sound = createOramicsSound(VOICES);

  // Layout, in box pixels.
  let W = 1;
  let H = 1;
  let dpr = 1;
  let h = 1; // strip height (35mm)
  let mm = 1;
  let y0 = 0;
  let bandTop = 0;
  let bandH = 1;
  let L = 1; // one lap of the loop, in px (the box width, so it wraps off screen)
  let perfs = 8;
  let rx = 0; // the reader
  let speed = 0; // laps per second

  let phase = 0; // laps travelled; film u sits at screen x = (u - phase) * L
  let started = 0;
  let seeded = false;

  const strokes = [];
  let nextId = 1;
  let drawing = null;
  let brush = W_MIN;

  const voices = Array.from({ length: VOICES }, () => ({ on: false, y: 0, span: 0, sid: -1, lv: 0, amp: 0, fresh: false }));

  const layout = (w, hh, d) => {
    W = w;
    H = hh;
    dpr = d;
    h = Math.round(clamp(Math.min(H * 0.34, W * (W < 640 ? 0.42 : 0.24)), 96, 288));
    mm = h / 35;
    y0 = Math.round(H * 0.5 - h / 2);
    const inset = 2.01 * mm + 2.79 * mm + 1.5 * mm;
    bandTop = y0 + inset;
    bandH = h - inset * 2;
    L = W;
    perfs = Math.max(8, Math.round(L / (4.75 * mm)));
    rx = (Math.round(W * 0.36 * dpr) + 0.5) / dpr;
    speed = (h * 0.22) / L;
    for (const s of strokes) s.dirty = true;
    if (!seeded) {
      seeded = true;
      seed();
    }
  };
  stage.onResize(layout);

  // --- strokes -----------------------------------------------------------

  const newStroke = () => ({ id: nextId++, u: [], v: [], w: [], du: null, dv: null, dw: null, umin: 0, umax: 0, done: false, alpha: 1, dying: false, dirty: true, path: null });

  // Catmull-Rom through the raw points, in pixels, with tapered ends.
  const densify = (s) => {
    const n = s.u.length;
    const du = [];
    const dv = [];
    const dw = [];
    // The brush width is eased along the stroke so a jittery hand reads as
    // pressure, not as beads.
    const ws = s.w.map((_, i) => {
      let sum = 0;
      let wt = 0;
      for (let k = -3; k <= 3; k += 1) {
        const j = i + k;
        if (j < 0 || j >= n) continue;
        const f = 4 - Math.abs(k);
        sum += s.w[j] * f;
        wt += f;
      }
      return sum / wt;
    });
    const P = (i) => {
      const k = clamp(i, 0, n - 1);
      return [s.u[k] * L, s.v[k] * bandH, ws[k]];
    };
    if (n === 1) {
      du.push(s.u[0]);
      dv.push(s.v[0]);
      dw.push(s.w[0] * 0.7);
    }
    for (let i = 0; i < n - 1; i += 1) {
      const p0 = P(i - 1);
      const p1 = P(i);
      const p2 = P(i + 1);
      const p3 = P(i + 2);
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const k = Math.max(1, Math.ceil(len / 2.2));
      for (let j = 0; j < k; j += 1) {
        const t = j / k;
        const t2 = t * t;
        const t3 = t2 * t;
        const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        du.push(cr(p0[0], p1[0], p2[0], p3[0]) / L);
        dv.push(clamp(cr(p0[1], p1[1], p2[1], p3[1]) / bandH, 0, 1));
        dw.push(p1[2] + (p2[2] - p1[2]) * t);
      }
      if (i === n - 2) {
        du.push(p2[0] / L);
        dv.push(p2[1] / bandH);
        dw.push(p2[2]);
      }
    }
    // Taper: the brush lands and lifts.
    const m = du.length;
    const arc = new Float32Array(m);
    for (let i = 1; i < m; i += 1) arc[i] = arc[i - 1] + Math.hypot((du[i] - du[i - 1]) * L, (dv[i] - dv[i - 1]) * bandH);
    const total = arc[m - 1] || 0;
    const taper = Math.min(h * 0.07, total * 0.4);
    if (taper > 0) {
      for (let i = 0; i < m; i += 1) {
        let f = 0.18 + 0.82 * smooth(clamp(arc[i] / taper, 0, 1));
        if (s.done) f *= 0.18 + 0.82 * smooth(clamp((total - arc[i]) / taper, 0, 1));
        dw[i] *= f;
      }
    }
    s.du = du;
    s.dv = dv;
    s.dw = dw;
    let lo = Infinity;
    let hi = -Infinity;
    for (const x of du) {
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    s.umin = lo;
    s.umax = hi;
    s.path = buildPath(s);
    s.dirty = false;
  };

  // One fill: a quad per segment and a disc per point, all wound the same
  // way so the overlaps add instead of cancelling.
  const buildPath = (s) => {
    const p = new Path2D();
    const base = s.u[0];
    const m = s.du.length;
    const X = (i) => (s.du[i] - base) * L;
    const Y = (i) => bandTop + s.dv[i] * bandH;
    for (let i = 0; i < m; i += 1) {
      const r = (s.dw[i] * h) / 2;
      p.moveTo(X(i) + r, Y(i));
      p.arc(X(i), Y(i), r, 0, Math.PI * 2);
      if (i + 1 < m) {
        const ax = X(i);
        const ay = Y(i);
        const bx = X(i + 1);
        const by = Y(i + 1);
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 1e-6) continue;
        const nx = -(by - ay) / len;
        const ny = (bx - ax) / len;
        const ra = r;
        const rb = (s.dw[i + 1] * h) / 2;
        const q = [
          [ax + nx * ra, ay + ny * ra],
          [bx + nx * rb, by + ny * rb],
          [bx - nx * rb, by - ny * rb],
          [ax - nx * ra, ay - ny * ra],
        ];
        let area = 0;
        for (let k = 0; k < 4; k += 1) {
          const [x1, y1] = q[k];
          const [x2, y2] = q[(k + 1) % 4];
          area += x1 * y2 - x2 * y1;
        }
        if (area < 0) q.reverse();
        p.moveTo(q[0][0], q[0][1]);
        for (let k = 1; k < 4; k += 1) p.lineTo(q[k][0], q[k][1]);
        p.closePath();
      }
    }
    return p;
  };

  const addPoint = (s, u, v, w) => {
    s.u.push(u);
    s.v.push(v);
    s.w.push(w);
    s.dirty = true;
  };

  // The phrase on the loop when it arrives: a melody with a quiet line
  // under it and three short notes after, laid down like a brush would.
  function seed() {
    const sec = (t) => (rx + W * 0.05) / L + t * speed;
    const S = (s) => 1 - s / SPAN;
    const lay = (keys, wobble) => {
      const s = newStroke();
      let k = 0;
      for (const [t, semis, wf] of keys) {
        k += 1;
        const n = Math.sin(k * 12.9898) * 43758.5453;
        const jitter = (n - Math.floor(n) - 0.5) * wobble;
        addPoint(s, sec(t), clamp(S(semis) + jitter * 0.01, 0, 1), W_MIN + (W_MAX - W_MIN) * wf * (1 + jitter * 0.12));
      }
      s.done = true;
      strokes.push(s);
    };
    lay(
      [
        [0.0, 16, 0.3], [0.6, 16, 0.75], [1.4, 16.1, 0.88], [2.0, 21, 0.85], [2.8, 21, 1.0], [3.5, 20.9, 0.9],
        [3.9, 19, 0.72], [4.5, 19, 0.64], [5.3, 14, 0.5], [5.9, 14, 0.56], [6.5, 24, 0.78], [7.6, 24, 0.95],
        [8.2, 23.7, 0.7], [8.7, 21, 0.3],
      ],
      0.3,
    );
    lay([[2.2, 9, 0.22], [2.8, 9, 0.4], [4.1, 9, 0.38], [4.7, 7, 0.34], [6.1, 7, 0.3], [6.7, 12, 0.38], [8.1, 12, 0.42], [8.8, 12, 0.22]], 0.3);
    lay([[9.6, 19, 0.6], [9.9, 19, 0.85], [10.2, 19, 0.55]], 0.2);
    lay([[10.6, 16, 0.6], [10.9, 16, 0.85], [11.2, 16, 0.55]], 0.2);
    lay([[11.7, 12, 0.45], [12.4, 12, 0.85], [13.3, 12.1, 0.7], [14.0, 12.2, 0.35]], 0.3);
  }

  // --- input -------------------------------------------------------------

  const onStrip = (y) => y > y0 - 12 && y < y0 + h + 12;

  // The pen trails the pointer a little, like a loaded brush, so a few
  // coarse pointer events still lay down one smooth line; it is sampled once
  // a frame, because the film keeps moving under it even when the hand stops.
  const pen = { x: 0, y: 0 };
  const sample = (dt, exact = false) => {
    const p = stage.pointer;
    if (exact) {
      pen.x = p.x;
      pen.y = p.y;
    } else {
      pen.x = damp(pen.x, p.x, 30, dt);
      pen.y = damp(pen.y, p.y, 30, dt);
    }
    const u = phase + pen.x / L;
    const v = clamp((pen.y - bandTop) / bandH, 0, 1);
    // Ink pools when the pen is slow over the film and thins when it hurries.
    const rel = Math.hypot(p.vx + speed * L, p.vy);
    const target = W_MIN + (W_MAX - W_MIN) * Math.exp(-rel / (h * 2.6));
    brush = damp(brush, target, 9, dt);
    const last = drawing.u.length - 1;
    if (last >= 0 && Math.hypot((u - drawing.u[last]) * L, (v - drawing.v[last]) * bandH) < 0.8) return;
    addPoint(drawing, u, v, brush);
    if (drawing.u[drawing.u.length - 1] - drawing.u[0] > 0.92) {
      // Nearly a whole lap in one stroke: begin another so it never laps itself.
      drawing.done = true;
      drawing.dirty = true;
      begin();
    }
  };

  const begin = () => {
    drawing = newStroke();
    strokes.push(drawing);
    brush = W_MIN + (W_MAX - W_MIN) * 0.7;
    sample(0, true);
  };

  const finish = () => {
    if (!drawing) return;
    sample(0, true);
    drawing.done = true;
    drawing.dirty = true;
    drawing = null;
    // Keep the loop readable: the oldest drawings fade off past a limit.
    let points = 0;
    for (const s of strokes) points += s.u.length;
    for (const s of strokes) {
      if (points < 9000) break;
      if (s.dying) continue;
      s.dying = true;
      points -= s.u.length;
    }
  };

  stage.on("down", (p) => {
    sound?.start();
    if (onStrip(p.y)) begin();
  });
  stage.on("move", (p) => {
    stage.canvas.style.cursor = onStrip(p.y) ? "crosshair" : "";
  });
  stage.on("up", finish);

  // --- reading -----------------------------------------------------------

  const read = () => {
    const R = frac(phase + rx / L);
    const hits = [];
    for (const s of strokes) {
      if (s.dying || !s.du || s.du.length < 2) continue;
      for (let k = Math.ceil(s.umin - R); k <= Math.floor(s.umax - R); k += 1) {
        const Rk = R + k;
        const { du, dv, dw } = s;
        for (let i = 0; i < du.length - 1; i += 1) {
          const a = du[i] - Rk;
          const b = du[i + 1] - Rk;
          if ((a <= 0 && b > 0) || (a > 0 && b <= 0)) {
            const t = a / (a - b);
            const v = dv[i] + (dv[i + 1] - dv[i]) * t;
            const w = (dw[i] + (dw[i + 1] - dw[i]) * t) * h;
            const sx = (du[i + 1] - du[i]) * L;
            const sy = (dv[i + 1] - dv[i]) * bandH;
            // What the line sees: the ink's height where it crosses.
            const span = Math.min(w * 3, w * Math.hypot(1, sy / (Math.abs(sx) || 1e-6)));
            hits.push({ y: bandTop + v * bandH, span, sid: s.id });
          }
        }
      }
    }
    hits.sort((p, q) => p.y - q.y);
    // Runs that overlap on the line are one run of shadow to the cell.
    const runs = [];
    for (const c of hits) {
      const prev = runs[runs.length - 1];
      if (prev && c.y - c.span / 2 <= prev.y + prev.span / 2) {
        const top = Math.min(prev.y - prev.span / 2, c.y - c.span / 2);
        const bot = Math.max(prev.y + prev.span / 2, c.y + c.span / 2);
        prev.y = (top + bot) / 2;
        prev.span = bot - top;
      } else runs.push({ ...c });
    }
    return runs.slice(0, VOICES);
  };

  const assign = (runs) => {
    const used = new Array(VOICES).fill(false);
    const placed = new Array(runs.length).fill(-1);
    const near = (r, sameStroke, reach) => {
      let best = -1;
      let bestD = reach;
      voices.forEach((v, i) => {
        if (used[i] || !v.on || (sameStroke && v.sid !== r.sid)) return;
        const d = Math.abs(v.y - r.y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    };
    runs.forEach((r, j) => {
      const i = near(r, true, bandH * 0.4);
      if (i >= 0) {
        used[i] = true;
        placed[j] = i;
      }
    });
    runs.forEach((r, j) => {
      if (placed[j] >= 0) return;
      let i = near(r, false, bandH * 0.06);
      if (i < 0) {
        let quiet = Infinity;
        voices.forEach((v, k) => {
          if (!used[k] && !v.on && v.lv < quiet) {
            quiet = v.lv;
            i = k;
          }
        });
        if (i >= 0) voices[i].fresh = true;
      }
      if (i >= 0) {
        used[i] = true;
        placed[j] = i;
      }
    });
    voices.forEach((v, i) => {
      if (!used[i]) v.on = false;
    });
    runs.forEach((r, j) => {
      const v = voices[placed[j]];
      if (!v) return;
      v.on = true;
      v.y = r.y;
      v.span = r.span;
      v.sid = r.sid;
      v.amp = Math.pow(clamp((r.span / h - 0.004) / 0.07, 0, 1), 0.85);
    });
  };

  // --- drawing -----------------------------------------------------------

  const screenX = (u) => (u - phase) * L;

  const drawFilm = () => {
    g.fillStyle = BASE;
    g.fillRect(0, y0, W, h);

    // Perforations: clear holes, so the ground shows through them.
    const P = L / perfs;
    const pw = 1.98 * mm;
    const ph = 2.79 * mm;
    const r = 0.5 * mm;
    const off = frac(phase) * L;
    const first = Math.floor(off / P) - 1;
    const line = 1 / dpr;
    g.lineWidth = line;
    // The splice that makes it a loop: a butt cut under clear tape.
    for (const seam of [-off, L - off]) {
      if (seam < -P * 2 || seam > W + P * 2) continue;
      const tw = P * 2;
      g.fillStyle = "rgba(206, 196, 164, 0.16)";
      g.fillRect(seam - tw / 2, y0, tw, h);
      g.fillStyle = "rgba(150, 144, 128, 0.55)";
      g.fillRect(Math.round((seam - tw / 2) * dpr) / dpr, y0, line, h);
      g.fillRect(Math.round((seam + tw / 2) * dpr) / dpr, y0, line, h);
      g.fillStyle = EDGE;
      g.fillRect(Math.round(seam * dpr) / dpr, y0, line, h);
    }
    for (let i = first; i <= first + perfs + 2; i += 1) {
      const x = i * P - off + (P - pw) / 2;
      if (x > W || x + pw < 0) continue;
      for (const top of [y0 + 2.01 * mm, y0 + h - 2.01 * mm - ph]) {
        g.beginPath();
        g.roundRect(x, top, pw, ph, r);
        g.fillStyle = GROUND;
        g.fill();
        g.strokeStyle = PERF_EDGE;
        g.stroke();
      }
    }

    // Edge print: a foot number every sixteen perforations, a frame tick every four.
    const size = Math.max(6.5, 1.15 * mm);
    g.font = `500 ${size}px ${mono}`;
    g.fillStyle = PRINT;
    g.textBaseline = "middle";
    const printY = y0 + h - 1.0 * mm;
    const tickY = y0 + 0.55 * mm;
    for (let i = first; i <= first + perfs + 2; i += 1) {
      const idx = ((i % perfs) + perfs) % perfs;
      const x = i * P - off;
      if (x < -60 || x > W + 10) continue;
      if (idx % 4 === 0) g.fillRect(Math.round(x * dpr) / dpr, tickY, line, 0.9 * mm);
      if (idx % 16 === 2) {
        const foot = String(Math.floor(idx / 16) + 1).padStart(2, "0");
        g.fillText(`${foot}`, x + 0.4 * mm, printY);
        g.beginPath();
        g.arc(x + 0.4 * mm + g.measureText(foot).width + 1.1 * mm, printY, 0.32 * mm, 0, Math.PI * 2);
        g.fill();
      }
    }
  };

  const drawInk = () => {
    const pad = h * 0.1;
    for (const s of strokes) {
      if (s.dirty || !s.path) densify(s);
      g.fillStyle = INK;
      g.globalAlpha = s.alpha;
      for (let k = Math.ceil((-pad / L) - (s.umax - phase)); k <= Math.floor((W + pad) / L - (s.umin - phase)); k += 1) {
        g.save();
        g.translate(screenX(s.u[0] + k), 0);
        g.fill(s.path);
        g.restore();
      }
    }
    g.globalAlpha = 1;
  };

  const drawReader = () => {
    const ext = Math.round(h * 0.28);
    const line = 1 / dpr;
    g.fillStyle = READER;
    g.fillRect(rx - line / 2, y0 - ext, line, h + ext * 2);
    const tick = 2.4 * mm;
    g.fillRect(rx - tick / 2, y0 - ext, tick, line);
    g.fillRect(rx - tick / 2, y0 + h + ext - line, tick, line);

    // Light through the slit, where the ink is crossing it.
    for (const v of voices) {
      if (v.lv < 0.01) continue;
      const half = v.span / 2 + 1;
      const R = Math.max(h * 0.12, v.span * 1.9);
      g.globalCompositeOperation = "screen";
      const glow = g.createRadialGradient(rx, v.y, 0, rx, v.y, R);
      glow.addColorStop(0, `rgba(255, 196, 120, ${0.56 * v.lv})`);
      glow.addColorStop(0.35, `rgba(255, 176, 96, ${0.2 * v.lv})`);
      glow.addColorStop(1, "rgba(255, 170, 90, 0)");
      g.fillStyle = glow;
      g.fillRect(rx - R, v.y - R, R * 2, R * 2);
      g.globalCompositeOperation = "source-over";
      g.fillStyle = `rgba(255, 236, 196, ${v.lv})`;
      g.fillRect(rx - 0.75, v.y - half, 1.5, half * 2);
    }
  };

  const draw = () => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = GROUND;
    g.fillRect(0, 0, W, H);
    drawFilm();
    drawInk();
    g.fillStyle = EDGE;
    const line = 1 / dpr;
    g.fillRect(0, y0, W, line);
    g.fillRect(0, y0 + h - line, W, line);
    drawReader();
  };

  // --- frame -------------------------------------------------------------

  let lastFrame = performance.now();
  stage.onFrame((dt, t) => {
    lastFrame = performance.now();
    if (!started) started = t;
    if (held !== null) {
      phase = held * speed;
    } else {
      // The transport comes up to speed the way a motor does.
      const spin = 1 - Math.pow(1 - clamp((t - started) / 1.6, 0, 1), 3);
      phase += speed * spin * dt;
    }
    if (drawing) sample(dt);

    for (let i = strokes.length - 1; i >= 0; i -= 1) {
      const s = strokes[i];
      if (!s.dying) continue;
      s.alpha = damp(s.alpha, 0, 3, dt);
      if (s.alpha < 0.02) strokes.splice(i, 1);
    }

    for (const s of strokes) if (s.dirty) densify(s);
    assign(read());

    let active = 0;
    for (const v of voices) if (v.on) active += 1;
    const share = 1 / (1 + 0.3 * Math.max(0, active - 1));
    voices.forEach((v, i) => {
      const target = v.on ? 0.55 + 0.45 * v.amp : 0;
      v.lv = held !== null ? target : damp(v.lv, target, target > v.lv ? 30 : 9, dt);
      if (!sound) return;
      const vv = clamp((v.y - bandTop) / bandH, 0, 1);
      const level = v.on ? 0.24 * (0.12 + 0.88 * v.amp) * share : 0;
      sound.voice(i, semisToHz((1 - vv) * SPAN), level, (0.5 - vv) * 0.3, v.fresh);
      v.fresh = false;
    });
    draw();
  });

  // If frames stop (the tab hides, the box leaves the screen), the voices
  // must not hang on their last note.
  const watch = window.setInterval(() => {
    if (performance.now() - lastFrame > 180) sound?.silence();
    sound?.tick();
  }, 200);

  return {
    destroy() {
      window.clearInterval(watch);
      sound?.destroy();
      stage.destroy();
    },
  };
}
