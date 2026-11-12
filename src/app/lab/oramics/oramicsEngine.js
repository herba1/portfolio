import { createStage, clamp, damp } from "../_kit/stage";
import { createOramicsSound } from "./oramicsSound";

// A loop of clear 35mm leader running leftward past a fixed reader, after
// Daphne Oram's Oramics machine: ink drawn on the film is read where it
// crosses the line of light. Everything is in film coordinates (u along the
// loop, 0..1 per lap; v across the drawable band, 0 at the top), so the
// drawings survive any resize.
//
// The ink is a dye, held as optical density in a buffer at device
// resolution, one lap wide. A slow, loaded brush lays dense ink that pools
// where it lingers and at its ends and dries to a darker rim; a quick one
// starves its bristles and leaves dry-brush streaks, each bristle running
// out in its own places (seeded per stroke, so a mark never changes once
// laid). What you see is that density as light through the clear base, and
// what you hear is the same light at the reader: the photocell integrates
// the density down the line through a narrow slit, each contiguous shadow
// is a voice, its centroid sets the pitch and its integrated density the
// level. A streaky stroke flutters; a pooled end swells.
//
// The reader also prints what it hears. Downstream of the light, between the
// picture and the lower perforations, the film carries a bilateral
// variable-area soundtrack: the summed voices, computed with the same model
// the oscillators play (sine plus a little detuned triangle, the same gains
// and glides), sampled once per device pixel of film travel and exposed as a
// clear slit in black, mirrored about its centre. The loop keeps its print,
// so the strip upstream of the reader shows the last lap's track until the
// reader writes over it.

const GROUND = "#f2f0eb";
const BASE = "#e5e6e0";
const EDGE = "#a9a79f";
const PERF_EDGE = "#b1afa7";
const PRINT = "#97928a";
const READER = "#6d6961";
const TRACK = "#1e1b17"; // the printed black of the soundtrack
const CLEAR = "#f4f3ee"; // its clear, modulated area

const VOICES = 6;
const SPAN = 26; // semitones from the bottom of the band to the top
const ROOT = 130.81; // C3 at the bottom
const SCALE = [0, 2, 4, 7, 9]; // major pentatonic
const W_MIN = 0.006; // brush width, fraction of strip height
const W_MAX = 0.058;
const TRACK_MM = 3; // soundtrack width
const SYNTH_NORM = 0.34; // one full voice (sine + 0.3 triangle at full level) fills the track

const frac = (x) => x - Math.floor(x);
const smooth = (t) => t * t * (3 - 2 * t);
const smoothstep = (a, b, x) => smooth(clamp((x - a) / (b - a), 0, 1));

// Integer hashes and value noise for the ink's material: everything keyed on
// film pixels or a stroke's seed, never on time.
const hash1 = (n) => {
  let x = (n | 0) ^ 0x2c1b3c6d;
  x = Math.imul(x ^ (x >>> 16), 0x297a2d39);
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};
const hash2 = (x, y) => hash1(Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663));
const vn1 = (x, sd) => {
  const i = Math.floor(x);
  const a = hash1(i + sd);
  return a + (hash1(i + 1 + sd) - a) * smooth(x - i);
};
const vn2 = (x, y) => {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = smooth(x - i);
  const fy = smooth(y - j);
  const a = hash2(i, j);
  const b = hash2(i + 1, j);
  const c = hash2(i, j + 1);
  const d = hash2(i + 1, j + 1);
  return a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fy;
};

// The dye: a warm black that holds back blue a little more than red, so
// thin ink reads umber and heavy ink goes to black. Transmission per
// channel for a density, as a lookup.
const DYE = [1.62, 1.85, 2.15];
const CELL = 1.85; // the photocell's response to the same density
const LUT_N = 2048;
const LUT_S = LUT_N / 5;
const LUT_R = new Uint8ClampedArray(LUT_N);
const LUT_G = new Uint8ClampedArray(LUT_N);
const LUT_B = new Uint8ClampedArray(LUT_N);
for (let q = 0; q < LUT_N; q += 1) {
  const D = q / LUT_S;
  LUT_R[q] = 255 * Math.exp(-D * DYE[0]);
  LUT_G[q] = 255 * Math.exp(-D * DYE[1]);
  LUT_B[q] = 255 * Math.exp(-D * DYE[2]);
}

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
  let trackTop = 0;
  let trackH = 1;
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
  let load = 0.7;
  let pool = 0;

  const voices = Array.from({ length: VOICES }, () => ({ on: false, y: 0, span: 0, lv: 0, amp: 0, fresh: false, snap: false }));

  const layout = (w, hh, d) => {
    W = w;
    H = hh;
    dpr = d;
    h = Math.round(clamp(Math.min(H * 0.34, W * (W < 640 ? 0.42 : 0.24)), 96, 288));
    mm = h / 35;
    y0 = Math.round(H * 0.5 - h / 2);
    const perfIn = 2.01 * mm + 2.79 * mm;
    bandTop = y0 + perfIn + 1.5 * mm;
    // The soundtrack sits between the picture and the lower perforations.
    trackH = TRACK_MM * mm;
    trackTop = y0 + h - perfIn - 0.45 * mm - trackH;
    bandH = trackTop - 0.45 * mm - bandTop;
    L = W;
    perfs = Math.max(8, Math.round(L / (4.75 * mm)));
    rx = (Math.round(W * 0.36 * dpr) + 0.5) / dpr;
    speed = (h * 0.22) / L;
    if (!seeded) {
      seeded = true;
      seed();
    }
    resizePrint(Math.max(64, Math.round(L * dpr)));
    resizeInk();
    // The reader's place is kept in laps; a new size moves it on screen, so
    // pick the reading up from wherever it now is rather than print the jump.
    readAt = null;
    if (held !== null) replay = true;
  };
  stage.onResize(layout);

  // --- strokes -----------------------------------------------------------

  // Raw points carry the brush as the hand left it: width (w), ink load (k,
  // 1 for a slow wet stroke, near 0 for a quick flick) and pool (p, ink that
  // collected while the pen dwelt).
  const newStroke = () => ({ id: nextId++, seed: 0, u: [], v: [], w: [], k: [], p: [], du: null, dv: null, dw: null, dk: null, dp: null, da: null, dd: null, segAt: null, umin: 0, umax: 0, done: false, alpha: 1, dying: false, dirty: true, tile: null });

  const kernel = (arr) => {
    const n = arr.length;
    return arr.map((_, i) => {
      let sum = 0;
      let wt = 0;
      for (let k = -3; k <= 3; k += 1) {
        const j = i + k;
        if (j < 0 || j >= n) continue;
        const f = 4 - Math.abs(k);
        sum += arr[j] * f;
        wt += f;
      }
      return sum / wt;
    });
  };

  // Catmull-Rom through the raw points, with the brush's load, pools and
  // dryness carried along; then the stroke is laid into the density buffer.
  const densify = (s) => {
    if (!s.seed) s.seed = Math.floor(hash1(s.id * 7919 + 13) * 0x3fffffff) + 1;
    const n = s.u.length;
    const du = [];
    const dv = [];
    const dw = [];
    const dk = [];
    const dp = [];
    const segAt = new Int32Array(n);
    // The brush width is eased along the stroke so a jittery hand reads as
    // pressure, not as beads; so are its load and its pools.
    const ws = kernel(s.w);
    const ks = kernel(s.k);
    const ps = kernel(s.p);
    const P = (i) => {
      const k = clamp(i, 0, n - 1);
      return [s.u[k] * L, s.v[k] * bandH, ws[k], ks[k], ps[k]];
    };
    if (n === 1) {
      du.push(s.u[0]);
      dv.push(s.v[0]);
      dw.push(s.w[0] * 0.7);
      dk.push(s.k[0]);
      dp.push(s.p[0]);
    }
    for (let i = 0; i < n - 1; i += 1) {
      segAt[i] = du.length;
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
        dk.push(p1[3] + (p2[3] - p1[3]) * t);
        dp.push(p1[4] + (p2[4] - p1[4]) * t);
      }
      if (i === n - 2) {
        segAt[n - 1] = du.length;
        du.push(p2[0] / L);
        dv.push(p2[1] / bandH);
        dw.push(p2[2]);
        dk.push(p2[3]);
        dp.push(p2[4]);
      }
    }
    // Taper where the brush lands and lifts dry; where it lands or lifts
    // wet, the ink pools into a swollen end instead.
    const m = du.length;
    const arc = new Float32Array(m);
    for (let i = 1; i < m; i += 1) arc[i] = arc[i - 1] + Math.hypot((du[i] - du[i - 1]) * L, (dv[i] - dv[i - 1]) * bandH);
    const total = arc[m - 1] || 0;
    // While the hand is still moving the start keeps one taper, so the ink
    // already laid down does not change under it.
    const taper = s.done ? Math.min(h * 0.07, total * 0.4) : h * 0.07;
    const wet0 = smoothstep(0.4, 0.9, dk[0]);
    const wet1 = s.done ? smoothstep(0.4, 0.9, dk[m - 1]) : 0;
    const r0 = (dw[0] * h) / 2 + 1;
    const r1 = (dw[m - 1] * h) / 2 + 1;
    const da = new Float32Array(m);
    const dd = new Float32Array(m);
    for (let i = 0; i < m; i += 1) {
      if (taper > 0) {
        let f = 0.18 + 0.82 * smooth(clamp(arc[i] / taper, 0, 1));
        f += (1 - f) * 0.72 * wet0;
        if (s.done) {
          let fe = 0.18 + 0.82 * smooth(clamp((total - arc[i]) / taper, 0, 1));
          fe += (1 - fe) * 0.72 * wet1;
          f *= fe;
        }
        dw[i] *= f;
      }
      const pe = wet0 * Math.exp(-arc[i] / (r0 * 1.6)) + wet1 * Math.exp(-(total - arc[i]) / (r1 * 1.6));
      dw[i] *= 1 + 0.3 * pe;
      dp[i] = Math.min(1.2, dp[i] + 0.9 * pe);
      da[i] = arc[i] * dpr;
      // Dryness: a quick stroke starves the bristles, and the brush runs
      // out the further it goes since it was loaded.
      const run = smooth(clamp(arc[i] / (h * 2.2), 0, 1));
      dd[i] = clamp(1.15 - 1.35 * dk[i] + 0.35 * (1 - dk[i]) * run - 0.9 * dp[i], 0, 1);
    }
    s.du = du;
    s.dv = dv;
    s.dw = dw;
    s.dk = dk;
    s.dp = dp;
    s.da = da;
    s.dd = dd;
    s.segAt = segAt;
    let lo = Infinity;
    let hi = -Infinity;
    for (const x of du) {
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    s.umin = lo;
    s.umax = hi;
    s.dirty = false;
    if (s.done || !s.tile) deposit(s, 0, true);
    else deposit(s, segAt[Math.max(0, n - 6)], false);
  };

  // --- the ink, as optical density ---------------------------------------

  // Every stroke keeps its own tile of density in film device pixels (x is
  // the unwrapped column, N to a lap; y the row from rowTop). Densities add,
  // as dyes do: the film's density is the sum of its strokes, and what the
  // eye and the photocell both see is the light that gets through it.
  let R = 1; // rows in the buffer
  let rowTop = 0; // box y of row 0
  let comp = new Float32Array(0); // the film's density, N x R
  let dirtyCols = new Uint8Array(0);
  let dirtyAny = false;
  let inkCanvas = null;
  let inkCtx = null;
  let inkImg = null;
  let shade = new Float32Array(0); // the cell's view down the line, per row

  const markCols = (a, b) => {
    if (b - a >= N) {
      dirtyCols.fill(1);
    } else {
      for (let x = a; x < b; x += 1) dirtyCols[((x % N) + N) % N] = 1;
    }
    dirtyAny = true;
  };
  const markTile = (s) => {
    if (s.tile) markCols(s.tile.x0, s.tile.x0 + s.tile.w);
  };

  const resizeInk = () => {
    rowTop = Math.floor((bandTop - 1.2 * mm) * dpr) / dpr;
    R = Math.max(8, Math.ceil((trackTop - 0.25 * mm - rowTop) * dpr));
    comp = new Float32Array(N * R);
    shade = new Float32Array(R);
    dirtyCols = new Uint8Array(N);
    if (!inkCanvas) {
      inkCanvas = document.createElement("canvas");
      inkCtx = inkCanvas.getContext("2d");
    }
    inkCanvas.width = N;
    inkCanvas.height = R;
    inkImg = inkCtx.createImageData(N, R);
    inkImg.data.fill(255);
    for (const s of strokes) {
      s.tile = null;
      s.dirty = true;
    }
    markCols(0, N);
  };

  // Make sure a stroke's tile covers [x0,x1) x [y0,y1), growing it with a
  // margin while the stroke is still being drawn.
  const tileFit = (s, x0, y0, x1, y1) => {
    y0 = Math.max(0, y0);
    y1 = Math.min(R, y1);
    if (y1 <= y0 || x1 <= x0) return false;
    const t = s.tile;
    if (t && x0 >= t.x0 && x1 <= t.x0 + t.w && y0 >= t.y0 && y1 <= t.y0 + t.h) return true;
    const gx = s.done ? 0 : 64;
    const gy = s.done ? 0 : 24;
    const nx0 = t ? Math.min(t.x0, x0 - gx) : x0 - gx;
    const nx1 = t ? Math.max(t.x0 + t.w, x1 + gx) : x1 + gx;
    const ny0 = Math.max(0, t ? Math.min(t.y0, y0 - gy) : y0 - gy);
    const ny1 = Math.min(R, t ? Math.max(t.y0 + t.h, y1 + gy) : y1 + gy);
    const nt = { x0: nx0, y0: ny0, w: nx1 - nx0, h: ny1 - ny0, dens: null, edge: null };
    nt.dens = new Float32Array(nt.w * nt.h);
    nt.edge = new Float32Array(nt.w * nt.h).fill(1e9);
    if (t && t.edge) {
      for (let y = 0; y < t.h; y += 1) {
        const src = y * t.w;
        const dst = (y + t.y0 - ny0) * nt.w + (t.x0 - nx0);
        nt.dens.set(t.dens.subarray(src, src + t.w), dst);
        nt.edge.set(t.edge.subarray(src, src + t.w), dst);
      }
    }
    s.tile = nt;
    return true;
  };

  // The density one stroke lays at one film pixel, given where the pixel
  // sits against the brush (e: distance past the edge, d: signed distance
  // from the spine, r: radius, all device px) and the brush's state there.
  const inkAt = (s, e, d, r, ld, pl, a, dry, gx, gy) => {
    const ad = Math.abs(d);
    const qa = Math.min(1, ad / r);
    // A dry brush's edge is ragged, not cut.
    const rag = dry > 0.02 ? dry * 1.6 * (vn1(a / 3.1, s.seed ^ 0x51ed) - 0.5) * (d < 0 ? 1 : -1) : 0;
    const cov = clamp(0.5 - e + rag, 0, 1);
    if (cov <= 0) return 0;
    // The wet body: heavier with load, heavier still where it pooled, and
    // as it dries the dye migrates from the middle out to a darker rim.
    const pc = Math.min(1, pl);
    let D = 0.22 + 0.9 * ld + 0.45 * pl;
    D *= 1 - (0.3 * ld + 0.22 * pc) * (1 - qa * qa) * (0.75 + 0.5 * vn1(a / 23, s.seed ^ 0x3c3));
    const rimW = Math.max(1.2, r * 0.12);
    const z = (r - ad) / rimW - 0.9;
    D += (0.45 * ld + 0.9 * pc) * Math.exp(-z * z * 1.2);
    // Dry brush: the bristles are lanes across the stroke, each with its
    // own reserve of ink, and each runs dry in its own places along it.
    // Neighbouring bristles clump, so gaps open in bands of a few lanes.
    const dg = smoothstep(0.12, 0.85, dry);
    if (dg > 0.001) {
      const lane = d / 2.2;
      const j = Math.floor(lane);
      const f = lane - j;
      const hj = hash1(s.seed + j * 977);
      const hj2 = hash1((s.seed ^ 0x2f6b) + j * 7919);
      const clump = Math.floor((d + 40) / 7.5);
      const nz = 0.62 * vn1(a / (16 + 46 * hj2) + j * 31.7, s.seed + j * 131) + 0.38 * vn1(a / 38 + clump * 17.3, (s.seed ^ 0x7a11) + clump * 59);
      const gt = dg * (0.1 + 0.62 * (1 - hj)) + dg * 0.45 * qa * qa * qa;
      const m = smoothstep(gt - 0.06, gt + 0.06, nz);
      const rest = 0.3 * (1 - dg);
      const sf = Math.sin(Math.PI * f);
      D *= (rest + (1 - rest) * m) * (1 - 0.5 * dg * (1 - sf * sf));
    }
    // The emulsion's own grain and the dye's clumping, fixed to the film.
    const cx = ((gx % N) + N) % N;
    const grain = 1 + (0.34 - 0.2 * ld) * (hash2(cx, gy) - 0.5) + 0.3 * (vn2(cx / 4.3, gy / 4.3) - 0.5);
    return cov * D * grain;
  };

  // Lay stroke segments from `from` on into its tile. `full` starts over.
  const deposit = (s, from, full) => {
    const { du, dv, dw, dk, dp, da, dd } = s;
    const m = du.length;
    const X = (i) => du[i] * N;
    const Y = (i) => (bandTop + dv[i] * bandH - rowTop) * dpr;
    const Rr = (i) => Math.max(0.35, (dw[i] * h * dpr) / 2);
    if (full) {
      markTile(s);
      s.tile = null;
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < m; i += 1) {
        const r = Rr(i) + 2;
        x0 = Math.min(x0, X(i) - r);
        x1 = Math.max(x1, X(i) + r);
        y0 = Math.min(y0, Y(i) - r);
        y1 = Math.max(y1, Y(i) + r);
      }
      if (!tileFit(s, Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1))) return;
    }
    const last = m === 1 ? 0 : m - 2;
    for (let i = Math.max(0, from); i <= last; i += 1) {
      const i2 = m === 1 ? 0 : i + 1;
      const ax = X(i);
      const ay = Y(i);
      const bx = X(i2);
      const by = Y(i2);
      const ra = Rr(i);
      const rb = Rr(i2);
      const bx0 = Math.floor(Math.min(ax - ra, bx - rb) - 2);
      const bx1 = Math.ceil(Math.max(ax + ra, bx + rb) + 2);
      const by0 = Math.floor(Math.min(ay - ra, by - rb) - 2);
      const by1 = Math.ceil(Math.max(ay + ra, by + rb) + 2);
      if (!tileFit(s, bx0, by0, bx1, by1)) continue;
      const t = s.tile;
      const ex = bx - ax;
      const ey = by - ay;
      const ll = ex * ex + ey * ey;
      const len = Math.sqrt(ll);
      const ya = Math.max(by0, t.y0);
      const yb = Math.min(by1, t.y0 + t.h);
      for (let y = ya; y < yb; y += 1) {
        const py = y + 0.5;
        const row = (y - t.y0) * t.w - t.x0;
        for (let x = bx0; x < bx1; x += 1) {
          const px = x + 0.5;
          const tt = ll > 1e-9 ? clamp(((px - ax) * ex + (py - ay) * ey) / ll, 0, 1) : 0;
          const dx = px - (ax + ex * tt);
          const dy = py - (ay + ey * tt);
          const dist = Math.sqrt(dx * dx + dy * dy);
          const r = ra + (rb - ra) * tt;
          const e = dist - r;
          if (e > 1.4) continue;
          const idx = row + x;
          if (e >= t.edge[idx]) continue;
          t.edge[idx] = e;
          // Which side of the spine: the bristle lanes run either side of it.
          const side = len > 1e-6 ? (ex * dy - ey * dx >= 0 ? 1 : -1) : dy >= 0 ? 1 : -1;
          const ld = dk[i] + (dk[i2] - dk[i]) * tt;
          const pl = dp[i] + (dp[i2] - dp[i]) * tt;
          const a = da[i] + (da[i2] - da[i]) * tt;
          const dry = dd[i] + (dd[i2] - dd[i]) * tt;
          t.dens[idx] = inkAt(s, e, side * dist, r, ld, pl, a, dry, x, y);
        }
      }
      markCols(bx0, bx1);
    }
    // A finished stroke never changes again: drop its working edges.
    if (s.done && s.tile) s.tile.edge = null;
  };

  // Sum the strokes into the film's density and print it as transmitted
  // light, wherever something changed.
  const flushInk = () => {
    if (!dirtyAny) return;
    dirtyAny = false;
    const data = inkImg.data;
    let a = 0;
    while (a < N) {
      if (!dirtyCols[a]) {
        a += 1;
        continue;
      }
      let b = a;
      while (b < N && dirtyCols[b]) b += 1;
      dirtyCols.fill(0, a, b);
      for (let y = 0; y < R; y += 1) comp.fill(0, y * N + a, y * N + b);
      for (const s of strokes) {
        const t = s.tile;
        if (!t || s.alpha <= 0.004) continue;
        const al = s.alpha;
        for (let k = Math.floor(t.x0 / N) - 1; k <= Math.floor((t.x0 + t.w) / N) + 1; k += 1) {
          const lo = Math.max(a + k * N, t.x0);
          const hi = Math.min(b + k * N, t.x0 + t.w);
          if (lo >= hi) continue;
          for (let y = t.y0; y < t.y0 + t.h; y += 1) {
            const src = (y - t.y0) * t.w - t.x0;
            const dst = y * N - k * N;
            for (let x = lo; x < hi; x += 1) comp[dst + x] += al * t.dens[src + x];
          }
        }
      }
      for (let y = 0; y < R; y += 1) {
        for (let x = a; x < b; x += 1) {
          const q = Math.min(LUT_N - 1, (comp[y * N + x] * LUT_S) | 0);
          const o = (y * N + x) * 4;
          data[o] = LUT_R[q];
          data[o + 1] = LUT_G[q];
          data[o + 2] = LUT_B[q];
        }
      }
      inkCtx.putImageData(inkImg, 0, 0, a, 0, b - a, R);
      a = b;
    }
  };

  const addPoint = (s, u, v, w, k, p) => {
    s.u.push(u);
    s.v.push(v);
    s.w.push(w);
    s.k.push(k);
    s.p.push(p);
    s.dirty = true;
  };

  // The phrase on the loop when it arrives: a melody with a quiet line
  // under it and three short notes after, laid down like a brush would:
  // the melody slow and wet, pooling where it lingers, the line under it
  // quick and dry.
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
        addPoint(s, sec(t), clamp(S(semis) + jitter * 0.01, 0, 1), W_MIN + (W_MAX - W_MIN) * wf * (1 + jitter * 0.12), clamp(wf * 1.05, 0, 1), Math.max(0, wf - 0.82) * 4);
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
  // Ink pools when the pen is slow over the film and thins when it hurries:
  // the brush widens and stays loaded at a crawl, starves when it flicks,
  // and where it all but stops on the film the ink collects in a pool. Felt
  // in real time on every pointer event as well as every frame, so a flick
  // dries the brush however few frames it spans.
  let felt = 0;
  const feel = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - felt) / 1000);
    felt = now;
    if (dt <= 0) return;
    const p = stage.pointer;
    const rel = Math.hypot(p.vx + speed * L, p.vy);
    brush = damp(brush, W_MIN + (W_MAX - W_MIN) * Math.exp(-rel / (h * 2.6)), 9, dt);
    load = damp(load, Math.exp(-rel / (h * 1.7)), 16, dt);
    pool = damp(pool, Math.exp(-rel / (h * 0.32)), rel < h * 0.4 ? 2.5 : 8, dt);
  };
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
    feel();
    const last = drawing.u.length - 1;
    if (last >= 0 && Math.hypot((u - drawing.u[last]) * L, (v - drawing.v[last]) * bandH) < 0.8) return;
    addPoint(drawing, u, v, brush, load, pool);
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
    load = 0.75;
    pool = 0.3;
    felt = performance.now();
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
    if (drawing) feel();
    stage.canvas.style.cursor = onStrip(p.y) ? "crosshair" : "";
  });
  stage.on("up", finish);

  // --- reading -----------------------------------------------------------

  // The photocell. The lamp's line of light crosses the film at the reader
  // and a slit a couple of device pixels wide passes it to the cell, which
  // sees the light that gets through the ink, row by row down the line.
  // Shadow that runs on (hairline gaps between bristles do not split it) is
  // one voice: its centroid is the pitch, its integrated density the level.
  const read = (at) => {
    const c = Math.floor(at * N + 1e-6);
    const c0 = (((c - 1) % N) + N) % N;
    const c1 = ((c % N) + N) % N;
    const c2 = (((c + 1) % N) + N) % N;
    for (let y = 0; y < R; y += 1) {
      const o = y * N;
      const T = 0.25 * Math.exp(-comp[o + c0] * CELL) + 0.5 * Math.exp(-comp[o + c1] * CELL) + 0.25 * Math.exp(-comp[o + c2] * CELL);
      shade[y] = 1 - T;
    }
    const on = 0.1;
    const bridge = Math.max(2, Math.round(0.7 * mm * dpr));
    const runs = [];
    let y = 0;
    let floor = 0;
    while (y < R) {
      if (shade[y] < on) {
        y += 1;
        continue;
      }
      let top = y;
      let bot = y;
      let sum = 0;
      let mom = 0;
      let k = y;
      while (k < R && k - bot <= bridge) {
        const sh = shade[k];
        if (sh >= on) bot = k;
        sum += sh;
        mom += sh * k;
        k += 1;
      }
      // Back off the bridge's tail, which counted only clear film.
      for (let j = bot + 1; j < k; j += 1) {
        sum -= shade[j];
        mom -= shade[j] * j;
      }
      // Include the soft edges either side of the threshold.
      while (top > floor && shade[top - 1] > 0.02) {
        top -= 1;
        sum += shade[top];
        mom += shade[top] * top;
      }
      let end = bot;
      while (end + 1 < R && shade[end + 1] > 0.02 && shade[end + 1] < on) {
        end += 1;
        sum += shade[end];
        mom += shade[end] * end;
      }
      const ink = sum / dpr; // integrated shadow, box px
      if (ink > h * 0.0015) {
        runs.push({ y: rowTop + (mom / sum + 0.5) / dpr, span: (bot - top + 1) / dpr, ink });
      }
      y = end + 1;
      floor = y;
    }
    if (runs.length > VOICES) {
      runs.sort((p, q) => q.ink - p.ink);
      runs.length = VOICES;
      runs.sort((p, q) => p.y - q.y);
    }
    return runs;
  };

  // Runs keep their voices by staying close on the line from one listen to
  // the next; a run with no voice near takes a quiet one and starts fresh.
  const pairs = [];
  const assign = (runs) => {
    const used = new Array(VOICES).fill(false);
    const placed = new Array(runs.length).fill(-1);
    pairs.length = 0;
    const reach = bandH * 0.14;
    runs.forEach((r, j) => {
      voices.forEach((v, i) => {
        if (!v.on) return;
        const d = Math.abs(v.y - r.y);
        if (d < reach) pairs.push([d, i, j]);
      });
    });
    pairs.sort((p, q) => p[0] - q[0]);
    for (const [, i, j] of pairs) {
      if (used[i] || placed[j] >= 0) continue;
      used[i] = true;
      placed[j] = i;
    }
    runs.forEach((r, j) => {
      if (placed[j] >= 0) return;
      let i = -1;
      let quiet = Infinity;
      voices.forEach((v, k) => {
        if (!used[k] && !v.on && v.lv < quiet) {
          quiet = v.lv;
          i = k;
        }
      });
      if (i >= 0) {
        voices[i].fresh = true;
        voices[i].snap = true;
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
      v.amp = Math.pow(clamp((r.ink / h - 0.0015) / 0.05, 0, 1), 0.85);
    });
  };

  // One listen at film position `at` (laps, the reader's place on the
  // loop): find the runs, hand them to voices, and set each voice's pitch
  // and level exactly as the oscillators will be asked to play them.
  const listen = (at, dt) => {
    assign(read(at));
    let active = 0;
    for (const v of voices) if (v.on) active += 1;
    const share = 1 / (1 + 0.3 * Math.max(0, active - 1));
    for (const v of voices) {
      const target = v.on ? 0.55 + 0.45 * v.amp : 0;
      v.lv = damp(v.lv, target, target > v.lv ? 30 : 9, dt);
      const vv = clamp((v.y - bandTop) / bandH, 0, 1);
      v.hz = semisToHz((1 - vv) * SPAN);
      v.level = v.on ? 0.24 * (0.12 + 0.88 * v.amp) * share : 0;
      v.pan = (0.5 - vv) * 0.3;
    }
  };

  // --- the print ---------------------------------------------------------

  // One column per device pixel of the lap; each holds the clear half-width
  // (0..1 of the track) the reader exposed there.
  let N = 0;
  let print = new Float32Array(0);
  let printed = new Uint8Array(0);
  let readAt = null; // the reader's film position at the last listen, in laps (unwrapped)
  let replay = false;
  let clock = 0;
  let bias = 0;
  let head = 0; // the clear half-width being exposed right now
  const synth = voices.map((_, i) => ({ f: 220, g: 0, a: 0, b: 0, cents: 3 + i * 0.7 }));

  const resizePrint = (n) => {
    if (n === N) return;
    const old = print;
    const oldOn = printed;
    const M = N;
    print = new Float32Array(n);
    printed = new Uint8Array(n);
    if (M) {
      for (let c = 0; c < n; c += 1) {
        const k = Math.floor((c * M) / n);
        print[c] = old[k];
        printed[c] = oldOn[k];
      }
    }
    N = n;
  };

  const TAU = Math.PI * 2;
  // The oscillator bank, in JS: per voice a sine and a triangle a few cents
  // sharp (its first three partials; the lowpass takes the rest), under the
  // same shared vibrato and drift, through gains that move with the same
  // time constants the audio graph uses. Returns the clear half-width.
  const synthStep = (dt) => {
    clock += dt;
    const wob = 4 * Math.sin(TAU * 4.7 * clock) + 3 * Math.sin(TAU * 0.17 * clock);
    let y = 0;
    let env = 0;
    voices.forEach((v, i) => {
      const o = synth[i];
      if (v.snap) {
        o.f = v.hz;
        v.snap = false;
      } else if (v.hz) o.f += (v.hz - o.f) * (1 - Math.exp(-dt / 0.03));
      const lvl = v.level || 0;
      o.g += (lvl - o.g) * (1 - Math.exp(-dt / (lvl > o.g ? 0.018 : 0.07)));
      const f = o.f * Math.pow(2, wob / 1200);
      o.a = frac(o.a + f * dt);
      o.b = frac(o.b + f * Math.pow(2, o.cents / 1200) * dt);
      const x = TAU * o.b;
      const tri = (8 / (Math.PI * Math.PI)) * (Math.sin(x) - Math.sin(3 * x) / 9 + Math.sin(5 * x) / 25);
      y += o.g * (Math.sin(TAU * o.a) + 0.3 * tri);
      env += o.g * 1.3;
    });
    // Noise reduction, as on a real track: the opening rides the envelope,
    // so silence prints as a hairline of clear and a loud note fills the
    // track edge to edge. Past full modulation it clips open.
    // The bias rides a little under the true peak (independent partials
    // rarely all crest together), so the troughs bite to the centre line.
    const want = Math.min(1, (0.8 * env) / SYNTH_NORM);
    bias += (want - bias) * (1 - Math.exp(-dt / (want > bias ? 0.01 : 0.08)));
    const yn = clamp(y / (SYNTH_NORM * 0.7), -1, 1);
    return 0.035 + 0.965 * clamp((bias + yn) / 2, 0, 1);
  };

  // Move the reader along the film to `to`, listening once per device pixel
  // crossed and printing each sample at the film column it was heard from.
  const advance = (to, dt) => {
    const from = readAt === null ? to : readAt;
    readAt = to;
    const c0 = Math.floor(from * N);
    const c1 = Math.floor(to * N);
    const n = Math.min(c1 - c0, N * 2);
    if (n <= 0) {
      listen(to, dt);
      head = synthStep(dt);
      return;
    }
    const ds = dt / n;
    for (let k = c1 - n + 1; k <= c1; k += 1) {
      listen(k / N, ds);
      head = synthStep(ds);
      const c = ((k % N) + N) % N;
      print[c] = head;
      printed[c] = 1;
    }
  };

  // A still (?t=…) is the loop as it would be after t seconds of running:
  // replay the whole run from a blank print.
  const replayTo = (t) => {
    for (const s of strokes) if (s.dirty) densify(s);
    flushInk();
    for (const v of voices) Object.assign(v, { on: false, lv: 0, amp: 0, level: 0, fresh: false, snap: false });
    for (const o of synth) Object.assign(o, { g: 0, a: 0, b: 0 });
    print.fill(0);
    printed.fill(0);
    clock = 0;
    bias = 0;
    readAt = rx / L;
    const step = 1 / (N * speed);
    let at = rx / L;
    const end = t * speed + rx / L;
    while (at + 1 / N <= end) {
      at += 1 / N;
      advance(at, step);
    }
    phase = t * speed;
    advance(end, 0);
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

  // The ink as the eye gets it: lamp light through the base, darkened by the
  // dye. Multiplied onto the film one device pixel to one film pixel.
  const drawInk = () => {
    if (!inkCanvas) return;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "multiply";
    g.imageSmoothingEnabled = false;
    const xo = Math.round(-frac(phase) * N);
    const yo = Math.round(rowTop * dpr);
    g.drawImage(inkCanvas, xo, yo);
    g.drawImage(inkCanvas, xo + N, yo);
    g.restore();
  };

  // The printed soundtrack: black where printed, opened by the signal in a
  // clear slit mirrored about the track's centre line.
  const drawTrack = () => {
    const mid = trackTop + trackH / 2;
    const half = (trackH / 2) * 0.94;
    const base = phase * N;
    const cFirst = Math.floor(base) - 1;
    const cLast = Math.ceil(base + W * dpr) + 1;
    const X = (c) => (c + 0.5 - base) / dpr;
    let c = cFirst;
    while (c <= cLast) {
      const at = (k) => ((k % N) + N) % N;
      if (!printed[at(c)]) {
        c += 1;
        continue;
      }
      let e = c;
      while (e + 1 <= cLast && printed[at(e + 1)]) e += 1;
      const x0 = (c - base) / dpr;
      const x1 = (e + 1 - base) / dpr;
      g.fillStyle = TRACK;
      g.fillRect(x0, trackTop, x1 - x0, trackH);
      g.beginPath();
      g.moveTo(x0, mid - print[at(c)] * half);
      for (let k = c; k <= e; k += 1) g.lineTo(X(k), mid - print[at(k)] * half);
      g.lineTo(x1, mid - print[at(e)] * half);
      g.lineTo(x1, mid + print[at(e)] * half);
      for (let k = e; k >= c; k -= 1) g.lineTo(X(k), mid + print[at(k)] * half);
      g.lineTo(x0, mid + print[at(c)] * half);
      g.closePath();
      g.fillStyle = CLEAR;
      g.fill();
      c = e + 1;
    }
  };

  // A lit segment of the slit: a hot core over a short warm bloom.
  const slit = (top, span, a, reach) => {
    g.globalCompositeOperation = "screen";
    const glow = g.createLinearGradient(rx - reach, 0, rx + reach, 0);
    glow.addColorStop(0, "rgba(255, 170, 90, 0)");
    glow.addColorStop(0.5, `rgba(255, 186, 110, ${0.62 * a})`);
    glow.addColorStop(1, "rgba(255, 170, 90, 0)");
    g.fillStyle = glow;
    g.fillRect(rx - reach, top - 1, reach * 2, span + 2);
    g.globalCompositeOperation = "source-over";
    g.fillStyle = `rgba(255, 245, 222, ${a})`;
    g.fillRect(rx - 1, top, 2, span);
  };

  const drawReader = () => {
    const ext = Math.round(h * 0.28);
    const line = 1 / dpr;
    g.fillStyle = READER;
    g.fillRect(rx - line / 2, y0 - ext, line, h + ext * 2);
    const tick = 2.4 * mm;
    g.fillRect(rx - tick / 2, y0 - ext, tick, line);
    g.fillRect(rx - tick / 2, y0 + h + ext - line, tick, line);

    // The line of light on the film, row by row, as the cell sees it:
    // bright through clear base, cut by the ink, leaking through its gaps.
    const c = Math.floor((phase + rx / L) * N + 1e-6);
    const cm = ((c % N) + N) % N;
    const rowH = 1 / dpr;
    for (let y = 0; y < R; y += 1) {
      const T = Math.exp(-comp[y * N + cm] * CELL);
      if (T > 0.985) continue;
      g.fillStyle = `rgba(255, 238, 205, ${0.2 + 0.75 * Math.sqrt(T)})`;
      g.fillRect(rx - 1, rowTop + y * rowH, 2, rowH);
    }
    // Where it sounds, the light blooms warm around the shadow it crossed.
    for (const v of voices) {
      if (v.lv < 0.01) continue;
      const a = clamp(v.lv / 0.55, 0, 1);
      const reach = 1.6 * mm;
      g.globalCompositeOperation = "screen";
      const glow = g.createLinearGradient(rx - reach, 0, rx + reach, 0);
      glow.addColorStop(0, "rgba(255, 170, 90, 0)");
      glow.addColorStop(0.5, `rgba(255, 186, 110, ${0.62 * a})`);
      glow.addColorStop(1, "rgba(255, 170, 90, 0)");
      g.fillStyle = glow;
      g.fillRect(rx - reach, v.y - v.span / 2 - 1, reach * 2, v.span + 2);
      g.globalCompositeOperation = "source-over";
    }
    // And the print head, exposing the track at this instant.
    if (readAt !== null && printed[((Math.floor(readAt * N) % N) + N) % N]) {
      const open = Math.max(1, head * (trackH / 2) * 0.94);
      const mid = trackTop + trackH / 2;
      // The lamp's spill on the film around the head, so it reads on clear base too.
      const spill = g.createRadialGradient(rx, mid, 0, rx, mid, trackH * 0.9);
      spill.addColorStop(0, "rgba(232, 150, 70, 0.34)");
      spill.addColorStop(1, "rgba(232, 150, 70, 0)");
      g.fillStyle = spill;
      g.fillRect(rx - trackH, mid - trackH, trackH * 2, trackH * 2);
      slit(mid - open, open * 2, 1, 1.1 * mm);
    }
  };

  const draw = () => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = GROUND;
    g.fillRect(0, 0, W, H);
    drawFilm();
    drawInk();
    drawTrack();
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
      if (replay) {
        replay = false;
        replayTo(held);
      }
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
      markTile(s);
      if (s.alpha < 0.02) strokes.splice(i, 1);
    }

    for (const s of strokes) if (s.dirty) densify(s);
    flushInk();
    advance(phase + rx / L, dt);

    if (sound) {
      voices.forEach((v, i) => {
        sound.voice(i, v.hz || 220, v.level || 0, v.pan || 0, v.fresh);
        v.fresh = false;
      });
    }
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
