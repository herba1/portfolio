import { createStage, clamp, damp } from "../_kit/stage";
import { createOramicsSound } from "./oramicsSound";
import { GESTURES } from "./gestures";

// Daphne Oram's machine: several loops of clear 35mm film, run in step on
// one transport past one line of light, each strip holding one control of
// the sound. Here there are four, stacked to fill the frame:
//
//   1  pitch     each run of shadow on the line is a voice; its height is
//                the note, its integrated density how loud
//   2  amplitude the shadow integrated down the whole strip is a VCA on
//                every voice: a swelling ribbon is a swell, a gap a gate
//   3  timbre    the density profile down the strip is one cycle of the
//                waveform, read as it is and turned into harmonics by a DFT
//   4  vibrato   how much shadow is vibrato depth; how high it sits, the
//                send to the room
//
// Everything is in film coordinates (u along the loop, 0..1 per lap; v
// across a strip's drawable band, 0 at the top), so drawings survive any
// resize.
//
// A stroke is nothing but the hand's samples (where, when, how hard), and
// the score the loop arrives with is real hands too: recorded pen and mouse
// traces (./gestures) with their own tremor, hesitations and accelerations.
// The ink is a dye a brush deposits from those samples, held as optical
// density in one buffer at device resolution, one lap wide and as tall as
// the stack. Pigment goes down in proportion to how long the brush dwelt,
// so a slow hand lays dense ink that pools where it lingers and beads where
// it lands; a quick one splits the nib into its bristles and leaves
// dry-brush streaks, each bristle starving in its own places (seeded per
// stroke, so a mark never changes once laid). As a stroke dries, its wet
// pigment wicks to the edge: a darker rim round a paler wash. The loops lie on a lightbox, black where there
// is no film: what you see is the lamp through the clear base, cut by the
// dye as 10^-D, so a pool goes black, a thin wash passes amber and the gaps
// a dry brush leaves between its bristles let the lamp through. What the
// cells hear is the same light through one hard slit at the reader, which
// is drawn as that light: white through clear base, cut or coloured by
// whatever ink crosses it.
//
// The reader also prints what the machine plays, onto a fifth loop below
// the four, a wide print stock run in step with them and given over almost
// edge to edge to one bilateral variable-area track of the shaped output:
// every voice through the waveform, the VCA and the vibrato, computed with
// the same model the oscillators play. The film crawls, so the print is
// slowed: one cycle at the bottom note spans a couple of hundred device
// pixels of film, a higher note packs its cycles tighter, and each cycle
// prints as the shape the timbre strip draws, swelled by the amplitude
// strip, so a change of drawing is a change of print. The loop keeps its
// print, so the track upstream of the reader is last lap's until the reader
// writes over it; it arrives already printed by the lap before. Fresh from
// the head the print is crisp, dense black; last lap's has gone to a duller
// grey-black, so the reader is the line where the new print begins.

// The loops lie on a lightbox: black where there is no film, and the film
// lit from beneath, so everything on it is seen as transmitted light.
const GROUND = "#090807";
const LAMP = [255, 238, 208]; // the lightbox, a warm white
const BASE_T = 0.9; // the clear base's own transmission
const TRACK = "#060504"; // the printed black of the soundtrack, fresh
const STALE = [44, 41, 38]; // the same black a lap on, gone dull
const STALE_CLEAR = [192, 184, 170]; // and its clear, multiplied down
const SLIT_K = 96; // device px either side of the slit its light reaches

const STRIPS = 4;
const PITCH = 0;
const AMP = 1;
const WAVE = 2;
const VIB = 3;
const LAP_S = 24; // seconds for the loop to come round
const VOICES = 6;
const SPAN = 26; // semitones from the bottom of the pitch band to the top
const ROOT = 130.81; // C3 at the bottom
const SCALE = [0, 2, 4, 7, 9]; // major pentatonic
const W_MAX = 0.058; // the nib's width at full press, fraction of strip height
// Each strip has its own pen: the control strips take a broader nib, so a
// hand can lay an envelope or a ramp, as Oram did with a mask.
const NIB = [1, 3.2, 1.5, 2.4];
const PRINT_FRAC = 0.27; // the print loop's share of the frame's height
const SYNTH_NORM = 0.34; // one full voice at full level fills the track
const VCA_FLOOR = 0.1; // clear film on the amplitude strip still leaks a little
const HARM = 32; // harmonics read off the waveform strip
const WAVE_N = 128; // samples down the strip for one cycle
const TABLE_N = 256;
const PRINT_CYCLE = 224; // device px of film per cycle of the bottom note, in the print

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

// The dye: a warm black that holds back blue more than red, so a thin wash
// passes amber and a pool goes to black. Its optical density D transmits
// 10^-(D k) per channel, as a lookup.
const DYE = [0.62, 1.05, 1.9];
const CELL = 1.85; // the photocell's response to the same density
const LUT_N = 2048;
const LUT_S = LUT_N / 5;
const LUT_R = new Uint8ClampedArray(LUT_N);
const LUT_G = new Uint8ClampedArray(LUT_N);
const LUT_B = new Uint8ClampedArray(LUT_N);
for (let q = 0; q < LUT_N; q += 1) {
  const D = q / LUT_S;
  LUT_R[q] = 255 * Math.pow(10, -D * DYE[0]);
  LUT_G[q] = 255 * Math.pow(10, -D * DYE[1]);
  LUT_B[q] = 255 * Math.pow(10, -D * DYE[2]);
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
  const sound = createOramicsSound(VOICES);

  // Layout, in box pixels.
  let W = 1;
  let H = 1;
  let dpr = 1;
  let h = 1; // strip height (35mm)
  let mm = 1;
  let printY0 = 0; // the print loop's top edge, and its height
  let printH = 1;
  let trackTop = 0;
  let trackH = 1;
  let pad = 0;
  let L = 1; // one lap of the loop, in px (the box width, so it wraps off screen)
  let perfs = 8;
  let rx = 0; // the reader
  let seamU = 0; // where the loop is spliced, in laps
  const speed = 1 / LAP_S; // laps per second
  // y0: the strip's top edge; top, bh: its drawable band; rA..rB its rows
  // in the density buffer (with margins), bA..bB the band's own rows.
  const strips = Array.from({ length: STRIPS }, (_, k) => ({ k, y0: 0, top: 0, bh: 1, rA: 0, rB: 1, bA: 0, bB: 1 }));

  let phase = 0; // laps travelled; film u sits at screen x = (u - phase) * L
  let started = 0;
  let seeded = false;

  const strokes = [];
  let nextId = 1;
  let drawing = null;

  const voices = Array.from({ length: VOICES }, () => ({ on: false, y: 0, span: 0, lv: 0, amp: 0, fresh: false, snap: false }));
  // What the three control strips say at the reader, as targets.
  const ctl = { env: VCA_FLOOR, vib: 0, send: 0.3 };

  const layout = (w, hh, d) => {
    W = w;
    H = hh;
    dpr = d;
    pad = Math.round(clamp(H * 0.03, 8, 32));
    const gap = Math.round(clamp(H * 0.016, 6, 16));
    // The print loop takes its share first; the four control strips split
    // the rest. All five share one gauge of perforation.
    printH = Math.round(H * PRINT_FRAC);
    h = Math.max(40, Math.floor((H - pad * 2 - printH - gap * STRIPS) / STRIPS));
    mm = h / 35;
    const top0 = Math.round((H - (h * STRIPS + gap * STRIPS + printH)) / 2);
    const perfIn = 2.01 * mm + 2.79 * mm;
    for (const st of strips) {
      st.y0 = top0 + st.k * (h + gap);
      st.top = st.y0 + perfIn + 1.5 * mm;
      st.bh = h - 2 * (perfIn + 1.5 * mm);
    }
    printY0 = top0 + STRIPS * (h + gap);
    trackTop = Math.round((printY0 + perfIn + 0.9 * mm) * d) / d;
    trackH = Math.round((printH - 2 * (perfIn + 0.9 * mm)) * d) / d;
    L = W;
    perfs = Math.max(8, Math.round(L / (4.75 * mm)));
    rx = (Math.round(W * 0.36 * dpr) + 0.5) / dpr;
    seamU = 0.36 - 0.012;
    if (!seeded) {
      seeded = true;
      seed();
    }
    resizePrint(Math.max(64, Math.round(L * dpr)));
    resizeInk();
    gradients();
    // The reader's place is kept in laps; a new size moves it on screen, so
    // pick the reading up from wherever it now is rather than print the jump.
    readAt = null;
    if (held !== null) replay = true;
  };
  stage.onResize(layout);

  // --- strokes -----------------------------------------------------------

  // A stroke is the hand's own samples and nothing else: u along the loop
  // (laps), v across the band (0..1), t when it was taken (seconds) and p
  // the pen's pressure (1 for a mouse). Every mark on the film is laid from
  // those by the brush below, so how fast and how hesitantly the hand moved
  // is what the ink shows, and what the cells then hear.
  const newStroke = (k = 0) => ({ id: nextId++, strip: k, seed: 0, u: [], v: [], t: [], p: [], load: 1, done: false, alpha: 1, dying: false, dirty: true, tile: null, lay: null });

  const addPoint = (s, u, v, t, p = 1) => {
    s.u.push(u);
    s.v.push(v);
    s.t.push(t);
    s.p.push(p);
    s.dirty = true;
  };

  // --- the ink, as optical density ---------------------------------------

  // Every stroke keeps its own tile in film device pixels (x the unwrapped
  // column, N to a lap; y the row from rowTop): the pigment the brush has
  // put down (P), the water still carrying it (Wt), and, once developed,
  // its optical density (dens). Densities add, as dyes do: the film's
  // density is the sum of its strokes, and what the eye and the photocell
  // both see is the light that gets through it.
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
    rowTop = Math.floor((strips[0].top - 1.2 * mm) * dpr) / dpr;
    const last = strips[STRIPS - 1];
    R = Math.max(8, Math.ceil((last.top + last.bh + 1.2 * mm - rowTop) * dpr));
    // Each strip's rows in the buffer: its band, and the margin a brush
    // laid at the band's edge spills into.
    for (const st of strips) {
      st.rA = clamp(Math.floor((st.top - 1.2 * mm - rowTop) * dpr), 0, R);
      st.rB = clamp(Math.ceil((st.top + st.bh + 1.2 * mm - rowTop) * dpr), st.rA, R);
      st.bA = clamp(Math.round((st.top - rowTop) * dpr), 0, R);
      st.bB = clamp(Math.round((st.top + st.bh - rowTop) * dpr), st.bA + 1, R);
    }
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
      s.lay = null;
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
    const gx = s.done ? 0 : 96;
    const gy = s.done ? 0 : 32;
    const nx0 = t ? Math.min(t.x0, x0 - gx) : x0 - gx;
    const nx1 = t ? Math.max(t.x0 + t.w, x1 + gx) : x1 + gx;
    const ny0 = Math.max(0, t ? Math.min(t.y0, y0 - gy) : y0 - gy);
    const ny1 = Math.min(R, t ? Math.max(t.y0 + t.h, y1 + gy) : y1 + gy);
    const n = (nx1 - nx0) * (ny1 - ny0);
    const nt = { x0: nx0, y0: ny0, w: nx1 - nx0, h: ny1 - ny0, P: new Float32Array(n), Wt: new Float32Array(n), dens: new Float32Array(n) };
    if (t && t.P) {
      for (let y = 0; y < t.h; y += 1) {
        const src = y * t.w;
        const dst = (y + t.y0 - ny0) * nt.w + (t.x0 - nx0);
        nt.P.set(t.P.subarray(src, src + t.w), dst);
        nt.Wt.set(t.Wt.subarray(src, src + t.w), dst);
        nt.dens.set(t.dens.subarray(src, src + t.w), dst);
      }
    }
    s.tile = nt;
    return true;
  };

  // --- the brush -----------------------------------------------------------

  // The brush is run along the hand's samples, a device pixel or so at a
  // time, and at every step it leaves pigment in proportion to how long it
  // dwelt there: the time between the two samples it sits between, shared
  // along the gap. So where the hand crawls the dye piles up, where it
  // stops it pools and spreads, and where it flies the film barely gets
  // any. Slow, it is pressed: the hairs splay and the mark widens. Fast, the
  // nib splits into its bristles, each its own lane with its own reserve,
  // and each starves in its own places, so a quick stroke breaks into dry
  // streaks with bare base between them. It lands loaded, dumping a bead,
  // and spends its reserve as it goes, drying toward the end of a long
  // stroke; it lifts off by dragging its last hairs out ragged.
  //
  // All in device px of film and seconds, scaled to the strip's height so
  // the same hand lays the same mark on any screen.
  const DSAT = 3.4; // density at which a pool stops getting any darker
  const DWELL = 8.4; // pigment flow, per px of nib radius, per strip-height of travel
  const POOL = 2.2; // areal density in one step past which the pool spreads
  const brushOf = (s) => {
    const hd = h * dpr;
    return { hd, R0: (W_MAX * hd * NIB[s.strip]) / 2, M: 5 + Math.floor(hash1(s.seed ^ 0x1b7) * 5) };
  };

  // One dab of the brush: a disc of pigment `q` spread over radius `re`,
  // its edge ragged a little either side of the spine (`ra`, `rb`), combed
  // by the hairs into faint lanes along the stroke (`hair`, indexed by
  // lateral offset), and carrying `wet` of water per unit of pigment.
  const HAIR = new Float32Array(160);
  const dab = (s, cx, cy, re, q, wet, nx, ny, hair, ra, rb, box, blob = 0, ph = 0) => {
    const t = s.tile;
    const area = Math.PI * Math.max(re, 0.7) ** 2 * 0.92;
    const k = q / area;
    const reach = re * (1 + Math.max(ra, rb, 0) + blob) + 1.5;
    const xa = Math.max(t.x0, Math.floor(cx - reach));
    const xb = Math.min(t.x0 + t.w, Math.ceil(cx + reach));
    const ya = Math.max(t.y0, Math.floor(cy - reach));
    const yb = Math.min(t.y0 + t.h, Math.ceil(cy + reach));
    if (xa >= xb || ya >= yb) return;
    const P = t.P;
    const Wt = t.Wt;
    const r2a = (re * (1 + ra)) ** 2;
    const r2b = (re * (1 + rb)) ** 2;
    for (let y = ya; y < yb; y += 1) {
      const dy = y + 0.5 - cy;
      const row = (y - t.y0) * t.w - t.x0;
      for (let x = xa; x < xb; x += 1) {
        const dx = x + 0.5 - cx;
        const d2 = dx * dx + dy * dy;
        const lat = dx * nx + dy * ny;
        let rr2 = lat >= 0 ? r2a : r2b;
        if (blob > 0) {
          // A pool is not a disc: it spreads further where the film takes it.
          const a = Math.atan2(dy, dx);
          const g = 1 + blob * (0.55 * Math.sin(3 * a + ph) + 0.3 * Math.sin(5 * a + ph * 2.3) + 0.15 * Math.sin(8 * a + ph * 3.1));
          rr2 *= g * g;
        }
        if (d2 > rr2 + 2 * Math.sqrt(rr2) + 1) continue;
        const rr = Math.sqrt(rr2);
        const d = Math.sqrt(d2);
        const cov = smooth(clamp((rr + 0.5 - d) / Math.max(1.2, 0.25 * rr), 0, 1));
        if (cov <= 0) continue;
        let w = cov;
        if (hair) w *= HAIR[clamp(Math.floor(lat / 1.6) + 80, 0, 159)];
        const o = row + x;
        P[o] += k * w;
        Wt[o] += k * w * wet;
      }
    }
    if (xa < box[0]) box[0] = xa;
    if (xb > box[1]) box[1] = xb;
    if (ya < box[2]) box[2] = ya;
    if (yb > box[3]) box[3] = yb;
  };

  // One bristle's trace over one step, from (ax, ay) to (bx, by): fine dabs
  // close enough to merge, so a lane is a continuous streak, not a row of
  // dots, and bends with the stroke without seams.
  const streak = (s, ax, ay, bx, by, rl, q, wet, box) => {
    const t = s.tile;
    const len = Math.hypot(bx - ax, by - ay);
    const m = Math.max(1, Math.ceil(len / Math.max(0.4, 0.5 * rl)));
    const k = q / m / (Math.PI * Math.max(rl, 0.6) ** 2);
    for (let j = 0; j < m; j += 1) {
      const f = (j + 0.5) / m;
      const cx = ax + (bx - ax) * f;
      const cy = ay + (by - ay) * f;
      const xa = Math.max(t.x0, Math.floor(cx - rl - 1));
      const xb = Math.min(t.x0 + t.w, Math.ceil(cx + rl + 1));
      const ya = Math.max(t.y0, Math.floor(cy - rl - 1));
      const yb = Math.min(t.y0 + t.h, Math.ceil(cy + rl + 1));
      if (xa >= xb || ya >= yb) continue;
      for (let y = ya; y < yb; y += 1) {
        const dy = y + 0.5 - cy;
        const row = (y - t.y0) * t.w - t.x0;
        for (let x = xa; x < xb; x += 1) {
          const dx = x + 0.5 - cx;
          const cov = clamp(rl + 0.5 - Math.sqrt(dx * dx + dy * dy), 0, 1);
          if (cov <= 0) continue;
          const o = row + x;
          t.P[o] += k * cov;
          t.Wt[o] += k * cov * wet;
        }
      }
      if (xa < box[0]) box[0] = xa;
      if (xb > box[1]) box[1] = xb;
      if (ya < box[2]) box[2] = ya;
      if (yb > box[3]) box[3] = yb;
    }
  };

  // One step of the brush at (x, y), heading (dx, dy), having taken `tau`
  // seconds over `dl` px. `force` holds the nib split open (the lift-off),
  // `scale` thins what it lays.
  const step = (s, B, x, y, dx, dy, tau, dl, box, force = 0, scale = 1) => {
    const S = s.lay;
    const { hd, R0, M } = B;
    const nx = -dy;
    const ny = dx;
    const r = S.r;
    const res = S.res;
    // The nib opens and closes over a couple of its own widths of travel,
    // not at once, so the bristles part one by one.
    const want = Math.max(smoothstep(20 * hd, 46 * hd, S.v), 0.8 * smoothstep(0.42, 0.1, res));
    S.split += (want - S.split) * (1 - Math.exp(-dl / Math.max(12, 5 * r)));
    const split = Math.max(force, S.split);
    const q = DWELL * hd * r * tau * clamp(0.3 + 0.7 * res, 0.2, 1.5) * scale;
    const wet = clamp(res, 0, 1.2) * (1 - 0.85 * split);
    const ragK = 0.1 + 0.35 * split;
    const ra = ragK * (vn1(S.arc / 2.6, s.seed ^ 0x51ed) - 0.5) * 2;
    const rb = ragK * (vn1(S.arc / 2.6 + 41.3, s.seed ^ 0x51ed) - 0.5) * 2;
    let spent = 0;
    const qr = q * (1 - split);
    if (qr > 1e-5) {
      // Where the step lays more than the film can take up in one place,
      // the pool spreads instead of piling higher.
      const lam = qr / (Math.PI * r * r);
      const sp = clamp(Math.sqrt(lam / POOL), 1, 2.4);
      const re = r * sp;
      const b0 = Math.floor(-re / 1.6) + 80;
      const b1 = Math.floor(re / 1.6) + 80;
      for (let b = Math.max(0, b0 - 1); b <= Math.min(159, b1 + 1); b += 1) {
        HAIR[b] = 1 + 0.55 * (vn1(S.arc / (12 + 30 * hash1(s.seed + b * 31)) + b * 17.3, s.seed + b * 113) - 0.5);
      }
      // Where the hand dawdles the ink spreads unevenly: the slower, the
      // more a pool lobes out instead of keeping the nib's round.
      const blob = 0.34 * Math.max(smoothstep(0.25, 1.3, lam / POOL), smoothstep(0.3, 0.75, Math.exp(-S.v / (6 * hd))));
      dab(s, x, y, re, qr, wet, nx, ny, true, ra, rb, box, blob, hash1((s.seed ^ 0x9e37) + Math.floor(S.arc / 40)) * 6.283 + S.arc * 0.02);
      spent += qr;
    }
    if (split > 0.02) {
      // The bristles: lanes across the nib, each with its own reserve, each
      // running dry in its own places along the stroke. The dry ones save
      // their ink; the ones still touching wipe what they carry onto the
      // film as they pass, however fast.
      const rl = Math.max(0.5, (0.85 * r) / M);
      for (let j = 0; j < M; j += 1) {
        const hj = hash1(s.seed + j * 977);
        // Lanes wander a little against each other as the hairs clump.
        // Lanes sit unevenly across the nib, clumped and parted, and
        // wander a little against each other as the hairs clump.
        const off = (hash1(s.seed + j * 61) - 0.5) * 2 * r * 0.95 + 0.9 * (vn1(S.arc / 47 + j * 13.1, s.seed ^ 0x4c1) - 0.5) * ((0.9 * r) / M);
        const nz = 0.78 * vn1(S.arc / (9 + 30 * hash1(s.seed + j * 7919)) + j * 31.7, s.seed + j * 131) + 0.22 * vn1(S.arc / 3.7 + j * 7.3, (s.seed ^ 0x2f6b) + j * 17);
        const th = clamp(Math.pow(split, 0.6) * (0.46 + 0.5 * hj) + 0.35 * split * (1 - clamp(res, 0, 1)) + 0.5 * force, 0, 0.97);
        const on = smoothstep(th - 0.06, th + 0.06, nz);
        if (on <= 0.01) continue;
        const ql = (((q * split) / M) * 0.6 + 0.32 * dl * 2 * rl * scale * Math.min(1, split * 1.4)) * on;
        const lx = x + nx * off;
        const ly = y + ny * off;
        streak(s, lx - dx * dl, ly - dy * dl, lx, ly, rl * (0.5 + 0.9 * hash1(s.seed + j * 211)), ql, wet * 0.4, box);
        spent += ql;
      }
    }
    S.res = Math.max(0.12, res - spent / (DWELL * hd * R0 * 3));
    S.arc += dl;
  };

  const lay = (s) => {
    s.dirty = false;
    if (!s.seed) s.seed = Math.floor(hash1(s.id * 7919 + 13) * 0x3fffffff) + 1;
    const n = s.u.length;
    if (!n) return;
    const st = strips[s.strip];
    const B = brushOf(s);
    const { hd, R0 } = B;
    const X = (i) => s.u[clamp(i, 0, n - 1)] * N;
    const Y = (i) => (st.top + s.v[clamp(i, 0, n - 1)] * st.bh - rowTop) * dpr;
    if (!s.lay) {
      markTile(s);
      s.tile = null;
      s.lay = { i: 0, res: s.load, r: 0, v: 0, split: 0, arc: 0, dx: 1, dy: 0, landed: false, lifted: false };
    }
    const S = s.lay;
    // While the hand is still moving the last two samples wait, so the
    // curve through them is known.
    const end = s.done ? n - 1 : n - 3;
    let pmax = 0.5;
    for (let i = Math.max(0, S.i - 1); i < n; i += 1) pmax = Math.max(pmax, s.p[i]);
    const margin = R0 * pmax * 4.5 + 10;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = Math.max(0, S.i - 1); i < n; i += 1) {
      x0 = Math.min(x0, X(i));
      x1 = Math.max(x1, X(i));
      y0 = Math.min(y0, Y(i));
      y1 = Math.max(y1, Y(i));
    }
    if (!tileFit(s, Math.floor(x0 - margin), Math.floor(y0 - margin), Math.ceil(x1 + margin), Math.ceil(y1 + margin))) return;
    const box = [Infinity, -Infinity, Infinity, -Infinity];
    const nib = (i, v) => R0 * s.p[clamp(i, 0, n - 1)] * (0.62 + 0.45 * Math.exp(-v / (12 * hd)));
    if (!S.landed) {
      // It lands loaded: the brush's surplus goes down at once as a bead.
      S.landed = true;
      S.r = nib(0, 0);
      step(s, B, X(0), Y(0), 1, 0, 0.045 * s.load, 0, box);
    }
    for (; S.i < end; S.i += 1) {
      const i = S.i;
      const ax = X(i - 1);
      const ay = Y(i - 1);
      const bx = X(i);
      const by = Y(i);
      const cx = X(i + 1);
      const cy = Y(i + 1);
      const ex = X(i + 2);
      const ey = Y(i + 2);
      const len = Math.hypot(cx - bx, cy - by);
      const dt = clamp(s.t[i + 1] - s.t[i], 1e-4, 0.6);
      const v = len / dt;
      S.v = S.v ? S.v + (v - S.v) * (1 - Math.exp(-dt / 0.03)) : v;
      const target = nib(i, S.v);
      const k = Math.max(1, Math.ceil(len / clamp(S.r * 0.4, 0.6, 6)));
      const tau = dt / k;
      for (let j = 0; j < k; j += 1) {
        const t = (j + 0.5) / k;
        const t2 = t * t;
        const t3 = t2 * t;
        const x = 0.5 * (2 * bx + (-ax + cx) * t + (2 * ax - 5 * bx + 4 * cx - ex) * t2 + (-ax + 3 * bx - 3 * cx + ex) * t3);
        const y = 0.5 * (2 * by + (-ay + cy) * t + (2 * ay - 5 * by + 4 * cy - ey) * t2 + (-ay + 3 * by - 3 * cy + ey) * t3);
        const tx = 0.5 * (-ax + cx + 2 * (2 * ax - 5 * bx + 4 * cx - ex) * t + 3 * (-ax + 3 * bx - 3 * cx + ex) * t2);
        const ty = 0.5 * (-ay + cy + 2 * (2 * ay - 5 * by + 4 * cy - ey) * t + 3 * (-ay + 3 * by - 3 * cy + ey) * t2);
        const tl = Math.hypot(tx, ty);
        if (tl > 1e-6) {
          S.dx = tx / tl;
          S.dy = ty / tl;
        }
        S.r += (target - S.r) * (1 - Math.exp(-tau / 0.07));
        step(s, B, x, y, S.dx, S.dy, tau, len / k, box);
      }
    }
    if (s.done && !S.lifted) {
      // It lifts off: the nib opens and its last hairs drag out past the
      // final sample, thinning to nothing.
      S.lifted = true;
      const run = S.r * (1.4 + 2.2 * clamp(S.v / (24 * hd), 0, 1));
      const k = Math.max(2, Math.ceil(run));
      const r0 = S.r;
      for (let j = 0; j < k; j += 1) {
        const f = (j + 0.5) / k;
        S.r = r0 * (1 - 0.65 * f);
        step(s, B, X(n - 1) + S.dx * run * f, Y(n - 1) + S.dy * run * f, S.dx, S.dy, (run / k) / Math.max(S.v, hd), run / k, box, 0.6 + 0.4 * f, 1 - f);
      }
    }
    if (s.done) dry(s);
    else if (box[0] < box[1]) develop(s, box[0], box[2], box[1], box[3]);
  };

  // The pigment as the film keeps it: optical density, saturating where a
  // pool can take no more, and settled unevenly into the emulsion's grain.
  const develop = (s, xa, ya, xb, yb) => {
    const t = s.tile;
    xa = Math.max(xa, t.x0);
    xb = Math.min(xb, t.x0 + t.w);
    ya = Math.max(ya, t.y0);
    yb = Math.min(yb, t.y0 + t.h);
    for (let y = ya; y < yb; y += 1) {
      const row = (y - t.y0) * t.w - t.x0;
      for (let x = xa; x < xb; x += 1) {
        const o = row + x;
        const p = t.P[o];
        if (p <= 0) {
          t.dens[o] = 0;
          continue;
        }
        const cx = ((x % N) + N) % N;
        const gr = 1 + 0.22 * (hash2(cx, y) - 0.5) + 0.2 * (vn2(cx / 6.3, y / 6.3) - 0.5);
        const pe = p * gr * smoothstep(0.035, 0.15, p * gr);
        t.dens[o] = DSAT * (1 - Math.exp(-pe / DSAT));
      }
    }
    markCols(xa, xb);
  };

  // Separable box blur of a tile-sized field, `rad` either side, in place.
  const boxBlur = (a, w, hh, rad, tmp) => {
    for (let y = 0; y < hh; y += 1) {
      const o = y * w;
      let acc = 0;
      for (let x = -rad; x <= rad; x += 1) acc += x >= 0 && x < w ? a[o + x] : 0;
      for (let x = 0; x < w; x += 1) {
        tmp[o + x] = acc / (2 * rad + 1);
        const xo = x - rad;
        const xi = x + rad + 1;
        if (xo >= 0) acc -= a[o + xo];
        if (xi < w) acc += a[o + xi];
      }
    }
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      for (let y = -rad; y <= rad; y += 1) acc += y >= 0 && y < hh ? tmp[y * w + x] : 0;
      for (let y = 0; y < hh; y += 1) {
        a[y * w + x] = acc / (2 * rad + 1);
        const yo = y - rad;
        const yi = y + rad + 1;
        if (yo >= 0) acc -= tmp[yo * w + x];
        if (yi < hh) acc += tmp[yi * w + x];
      }
    }
  };

  // The stroke dries. Water evaporates fastest at the wet edge, and the
  // flow that replaces it carries pigment out from the middle, so a wash
  // dries to a darker rim round a paler interior (pigment conserved), and a
  // little dye wicks past the edge into the base as a faint warm fringe.
  // Dry-brush streaks carried almost no water and stay as they fell.
  const dry = (s) => {
    const t = s.tile;
    const { w, h: th, P, Wt } = t;
    const n = w * th;
    const wetAt = 0.1;
    const mask = new Float32Array(n);
    const tmp = new Float32Array(n);
    let any = false;
    for (let o = 0; o < n; o += 1) {
      if (Wt[o] > wetAt) {
        mask[o] = 1;
        any = true;
      }
    }
    if (any) {
      boxBlur(mask, w, th, 3, tmp);
      boxBlur(mask, w, th, 3, tmp);
      // What the wet pigment nearby could bring to each edge pixel.
      const fr = new Float32Array(n);
      for (let o = 0; o < n; o += 1) if (Wt[o] > wetAt) fr[o] = P[o];
      boxBlur(fr, w, th, 5, tmp);
      boxBlur(fr, w, th, 3, tmp);
      let added = 0;
      let inner = 0;
      const gain = new Float32Array(n);
      for (let o = 0; o < n; o += 1) {
        if (Wt[o] <= wetAt) continue;
        const wl = Math.min(1, Wt[o] / 0.25);
        const rim = smoothstep(0.12, 0.42, 1 - mask[o]);
        gain[o] = rim * 2.2 * fr[o] * wl;
        added += gain[o];
        inner += P[o] * wl * (1 - rim) * (1 - rim);
      }
      const take = inner > 1e-6 ? Math.min(0.55, added / inner) : 0;
      for (let o = 0; o < n; o += 1) {
        if (Wt[o] > wetAt) {
          const wl = Math.min(1, Wt[o] / 0.25);
          const rim = smoothstep(0.12, 0.42, 1 - mask[o]);
          P[o] += gain[o] - take * P[o] * wl * (1 - rim) * (1 - rim);
        } else if (fr[o] > 0) {
          // and a little wicks past the edge into the base, a faint fringe.
          P[o] += 0.06 * fr[o];
        }
      }
    }
    develop(s, t.x0, t.y0, t.x0 + w, t.y0 + th);
    // Dry, a stroke never changes again: keep only its density.
    t.P = null;
    t.Wt = null;
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

  // The score on the loop when it arrives, one phrase across all four
  // strips, laid down by real hands: every mark is one of the recorded
  // traces in ./gestures, stretched along the film onto the path the score
  // asks for, with its own wobble, hesitations and timing kept. In three
  // sections:
  //   a chord held over a low D whose inner voices cross, under a swell
  //   scrubbed in with a zigzag, the vibrato ramping up and the room opening;
  //   the bottom note alone, held long enough to print cycle after cycle,
  //   under two scrubbed swells, while the waveform strip changes its
  //   drawing under it: one broad band (a square, printed as clear blocks)
  //   gives way to a comb of five lines, a flick to a slow drag (five
  //   teeth a cycle, growing);
  //   a drone with an arpeggio stacking into a chord over it and folding
  //   into unison, under a long slow squiggle swelling to a crescendo, the
  //   vibrato a wave that widens as it falls.
  function seed() {
    const U0 = seamU + 0.016;
    const at = (f) => U0 + f * 0.966;
    // Lay trace G between f0 and f1 of the lap. In "line" mode the trace's
    // own straight-line fit is replaced by path(f) and what is left (the
    // hand's wobble) rides on it at the trace's own scale; in "fill" mode
    // its height is fitted to amp(f) either side of path(f). The pitch
    // strip's path is in semitones. Time keeps the hand's own speed: the
    // trace is replayed as if drawn at the scale it lands at.
    const lay1 = (k, f0, f1, G, { path, amp = null, p = () => 1, gain = 1, load = 1 }) => {
      const s = newStroke(k);
      s.load = load;
      const n = G.x.length;
      let xa = Infinity;
      let xb = -Infinity;
      let ya = Infinity;
      let yb = -Infinity;
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let sxy = 0;
      for (let i = 0; i < n; i += 1) {
        const x = G.x[i];
        const y = G.y[i];
        xa = Math.min(xa, x);
        xb = Math.max(xb, x);
        ya = Math.min(ya, y);
        yb = Math.max(yb, y);
        sx += x;
        sy += y;
        sxx += x * x;
        sxy += x * y;
      }
      const slope = (n * sxy - sx * sy) / Math.max(1e-6, n * sxx - sx * sx);
      const icpt = (sy - slope * sx) / n;
      const bh = strips[k].bh;
      const scale = ((f1 - f0) * 0.966 * L) / Math.max(1, xb - xa); // box px per trace px
      for (let i = 0; i < n; i += 1) {
        const f = (G.x[i] - xa) / Math.max(1, xb - xa);
        let v = path(f);
        if (k === PITCH) v = 1 - v / SPAN;
        if (amp) v += ((G.y[i] - (ya + yb) / 2) / Math.max(1, (yb - ya) / 2)) * amp(f);
        else v += ((G.y[i] - (icpt + slope * G.x[i])) * scale * gain) / bh;
        addPoint(s, at(f0 + (f1 - f0) * f), clamp(v, 0, 1), (G.t[i] / 1000) * scale, p(f));
      }
      s.done = true;
      strokes.push(s);
    };
    const flat = (val) => () => val;
    const lerp = (a, b) => (f) => a + (b - a) * f;
    const G = GESTURES;

    // 1  a chord over a low D
    lay1(PITCH, 0.0, 0.235, G.lineSlowFlat, { path: flat(1.6), p: () => 1.15, load: 1.2 });
    lay1(PITCH, 0.014, 0.228, G.lineRising, { path: (f) => 9 + 10 * smooth(smoothstep(0.12, 0.88, f)), p: () => 0.85 });
    lay1(PITCH, 0.021, 0.231, G.lineFalling, { path: (f) => 19 - 10 * smooth(smoothstep(0.1, 0.86, f)), p: () => 0.8 });
    lay1(PITCH, 0.05, 0.175, G.lineFlick, { path: flat(24), p: () => 0.7 });
    lay1(AMP, 0.0, 0.235, G.zigSaw, { path: flat(0.5), amp: (f) => 0.04 + 0.3 * smoothstep(0, 0.4, f) - 0.2 * smoothstep(0.62, 1, f), p: () => 0.9 });
    lay1(VIB, 0.01, 0.235, G.lineDiagonal, { path: lerp(0.86, 0.32), p: (f) => 0.3 + 1.5 * Math.pow(f, 1.4), load: 1.2 });

    // 2  the bottom note alone, under two swells
    lay1(PITCH, 0.255, 0.64, G.lineSlowLong, { path: flat(0.3), p: () => 1.3, load: 1.3 });
    lay1(AMP, 0.262, 0.452, G.zigRound, { path: flat(0.5), amp: (f) => 0.05 + 0.32 * smoothstep(0, 0.3, f) * (1 - 0.75 * smoothstep(0.72, 1, f)), p: () => 1 });
    lay1(AMP, 0.462, 0.636, G.zigSlow, { path: flat(0.5), amp: (f) => 0.05 + 0.34 * smoothstep(0, 0.3, f) * (1 - 0.75 * smoothstep(0.72, 1, f)), p: () => 0.85 });
    lay1(VIB, 0.27, 0.63, G.lineQuick, { path: flat(0.88), p: () => 0.6 });
    lay1(VIB, 0.47, 0.63, G.lineRising, { path: lerp(0.74, 0.46), p: (f) => 0.4 + 1.3 * f * f });

    // 3  timbre: one broad band, laid in two slow passes, then a comb of
    // five lines across the top half, a flick to a slow drag, so the five
    // teeth of each printed cycle grow light to heavy.
    lay1(WAVE, 0.0, 0.452, G.lineSteady, { path: flat(0.5), p: () => 2.5, load: 1.3, gain: 0.6 });
    lay1(WAVE, 0.01, 0.445, G.lineSlowFlat, { path: flat(0.48), p: () => 2.1, gain: 0.6 });
    [G.lineFlick, G.lineQuick, G.lineRising, G.lineFalling, G.lineSlowLong].forEach((tr, j) => {
      lay1(WAVE, 0.458 + j * 0.003, 0.985, tr, { path: flat(0.07 + j * 0.115), p: () => 0.45 + 0.17 * j, gain: 0.5 });
    });

    // 4  a drone, an arpeggio stacking into a chord over it
    lay1(PITCH, 0.655, 0.985, G.lineHooked, { path: flat(0.5), p: () => 1.3, load: 1.25 });
    [G.lineSteady, G.lineQuick, G.lineFalling, G.lineDiagonal, G.lineSlowLong].forEach((tr, j) => {
      const n = [7, 9, 12, 16, 19][j];
      const f0 = 0.75 + j * 0.04;
      lay1(PITCH, f0, 0.975, tr, {
        path: (f) => {
          const fold = smoothstep(0.9, 0.97, f0 + (0.975 - f0) * f);
          return n + (12 - n) * fold;
        },
        p: () => (j % 2 ? 0.65 : 0.95),
        gain: 0.7,
      });
    });
    lay1(AMP, 0.655, 0.978, G.squigGrowing, { path: flat(0.5), amp: (f) => 0.06 + 0.36 * Math.pow(smoothstep(0, 0.92, f), 1.2), p: () => 0.9, load: 1.1 });
    lay1(VIB, 0.66, 0.982, G.squigWave, { path: (f) => 0.84 - 0.6 * Math.pow(f, 0.8), amp: (f) => 0.03 + 0.12 * f, p: (f) => 0.5 + 1.4 * f, load: 1.2 });
  }

  // --- input -------------------------------------------------------------

  const stripAt = (y) => {
    for (const st of strips) if (y > st.y0 - 8 && y < st.y0 + h + 8) return st.k;
    return -1;
  };

  // The live pen records the same thing the score's traces did: every
  // pointer event as it arrives, at the time it arrived, in film
  // coordinates, and once a frame besides, because the film keeps moving
  // under the pen even when the hand stops; a pen held still on the
  // moving film lays a slow, heavy line. A stylus's pressure presses the
  // nib; a mouse is pressed evenly.
  let penP = 1;
  const sample = (x, y) => {
    const st = strips[drawing.strip];
    const u = phase + x / L;
    const v = clamp((y - st.top) / st.bh, 0, 1);
    const n = drawing.u.length;
    if (n && Math.hypot((u - drawing.u[n - 1]) * L, (v - drawing.v[n - 1]) * st.bh) < 0.75) return;
    addPoint(drawing, u, v, performance.now() / 1000, penP);
    if (drawing.u[drawing.u.length - 1] - drawing.u[0] > 0.92) {
      // Nearly a whole lap in one stroke: begin another so it never laps itself.
      drawing.done = true;
      drawing.dirty = true;
      begin(st.k);
    }
  };
  const pressOf = (e) => (e && e.pointerType === "pen" && e.pressure > 0 ? 0.35 + 1.3 * e.pressure : 1);

  const begin = (k) => {
    drawing = newStroke(k);
    strokes.push(drawing);
    sample(stage.pointer.x, stage.pointer.y);
  };

  const finish = () => {
    if (!drawing) return;
    sample(stage.pointer.x, stage.pointer.y);
    drawing.done = true;
    drawing.dirty = true;
    drawing = null;
    // Keep the loop readable: the oldest drawings fade off past a limit.
    let points = 0;
    for (const s of strokes) points += s.u.length;
    for (const s of strokes) {
      if (points < 16000) break;
      if (s.dying) continue;
      s.dying = true;
      points -= s.u.length;
    }
  };

  stage.on("down", (p, e) => {
    sound?.start();
    penP = pressOf(e);
    const k = stripAt(p.y);
    if (k >= 0) begin(k);
  });
  stage.on("move", (p, e) => {
    if (drawing) {
      penP = pressOf(e);
      sample(p.x, p.y);
    }
    stage.canvas.style.cursor = stripAt(p.y) >= 0 ? "crosshair" : "";
  });
  stage.on("up", finish);

  // --- reading -----------------------------------------------------------

  // The photocells. The lamp's line of light crosses every strip at the
  // reader and a slit a couple of device pixels wide passes it on, so the
  // cells see the light that gets through the ink, row by row down the line.
  const cellView = (at) => {
    const c = Math.floor(at * N + 1e-6);
    const c0 = (((c - 1) % N) + N) % N;
    const c1 = ((c % N) + N) % N;
    const c2 = (((c + 1) % N) + N) % N;
    for (let y = 0; y < R; y += 1) {
      const o = y * N;
      const T = 0.25 * Math.exp(-comp[o + c0] * CELL) + 0.5 * Math.exp(-comp[o + c1] * CELL) + 0.25 * Math.exp(-comp[o + c2] * CELL);
      shade[y] = 1 - T;
    }
  };

  // Strip 1. Shadow that runs on (hairline gaps between bristles do not
  // split it) is one voice: its centroid is the pitch, its integrated
  // density the level.
  const readPitch = () => {
    const st = strips[PITCH];
    const on = 0.1;
    const bridge = Math.max(2, Math.round(0.7 * mm * dpr));
    const runs = [];
    let y = st.rA;
    let floor = st.rA;
    while (y < st.rB) {
      if (shade[y] < on) {
        y += 1;
        continue;
      }
      let top = y;
      let bot = y;
      let sum = 0;
      let mom = 0;
      let k = y;
      while (k < st.rB && k - bot <= bridge) {
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
      while (end + 1 < st.rB && shade[end + 1] > 0.02 && shade[end + 1] < on) {
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

  // Strips 2 and 4: the whole band's shadow, integrated, and where it sits.
  const integ = { cover: 0, cv: 0.5 };
  const integrate = (st) => {
    let s = 0;
    let m = 0;
    for (let y = st.bA; y < st.bB; y += 1) {
      s += shade[y];
      m += shade[y] * (y - st.bA + 0.5);
    }
    const n = st.bB - st.bA;
    integ.cover = s / n;
    integ.cv = s > 1e-3 ? m / s / n : 0.5;
    return integ;
  };

  // Strip 3: the density down the slit is one cycle of the waveform, top to
  // bottom. The cell's aperture blurs it a little; the mean is the DC the
  // ear never hears; a DFT turns the rest into harmonics, and those build
  // both the oscillators' wave and the print's wavetable. Rebuilt only when
  // the profile has changed, and at most every 100ms of film.
  // lo, hi: the table's own trough and crest, so the print can open a
  // single voice from closed to full whatever the waveform's symmetry.
  const wave = { re: new Float32Array(HARM + 1), im: new Float32Array(HARM + 1), table: new Float32Array(TABLE_N + 1), lo: -1, hi: 1, version: 0, at: -1e9 };
  for (let i = 0; i <= TABLE_N; i += 1) wave.table[i] = Math.sin((Math.PI * 2 * i) / TABLE_N);
  const prof = new Float32Array(WAVE_N);
  const blur = new Float32Array(WAVE_N);
  const heard = new Float32Array(WAVE_N).fill(-1);
  const COS = new Float32Array(TABLE_N);
  const SIN = new Float32Array(TABLE_N);
  for (let i = 0; i < TABLE_N; i += 1) {
    COS[i] = Math.cos((Math.PI * 2 * i) / TABLE_N);
    SIN[i] = Math.sin((Math.PI * 2 * i) / TABLE_N);
  }
  const KER = [];
  for (let k = -6; k <= 6; k += 1) KER.push(Math.exp(-(k * k) / (2 * 2.2 * 2.2)));
  const kerSum = KER.reduce((a, b) => a + b, 0);
  const hearWave = () => {
    const st = strips[WAVE];
    const n = st.bB - st.bA;
    for (let j = 0; j < WAVE_N; j += 1) {
      const a = st.bA + Math.floor((j * n) / WAVE_N);
      const b = Math.max(a + 1, st.bA + Math.floor(((j + 1) * n) / WAVE_N));
      let s = 0;
      for (let y = a; y < b; y += 1) s += shade[y];
      blur[j] = s / (b - a);
    }
    for (let j = 0; j < WAVE_N; j += 1) {
      let s = 0;
      for (let k = -6; k <= 6; k += 1) s += KER[k + 6] * blur[(j + k + WAVE_N) % WAVE_N];
      prof[j] = s / kerSum;
    }
    let diff = 0;
    for (let j = 0; j < WAVE_N; j += 1) diff += Math.abs(prof[j] - heard[j]);
    if (diff / WAVE_N < 0.006 || clock - wave.at < 0.1) return;
    heard.set(prof);
    wave.at = clock;
    let mean = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of prof) {
      mean += p;
      lo = Math.min(lo, p);
      hi = Math.max(hi, p);
    }
    mean /= WAVE_N;
    wave.re.fill(0);
    wave.im.fill(0);
    if (hi - lo < 0.03) {
      // Clear film: a plain sine.
      wave.im[1] = 1;
    } else {
      const step = TABLE_N / WAVE_N;
      for (let h2 = 1; h2 <= HARM; h2 += 1) {
        let a = 0;
        let b = 0;
        for (let j = 0; j < WAVE_N; j += 1) {
          const q = ((h2 * j) % WAVE_N) * step;
          const p = prof[j] - mean;
          a += p * COS[q];
          b += p * SIN[q];
        }
        wave.re[h2] = (2 * a) / WAVE_N;
        wave.im[h2] = (2 * b) / WAVE_N;
      }
    }
    let peak = 1e-6;
    for (let i = 0; i < TABLE_N; i += 1) {
      let x = 0;
      for (let h2 = 1; h2 <= HARM; h2 += 1) {
        const q = (h2 * i) % TABLE_N;
        x += wave.re[h2] * COS[q] + wave.im[h2] * SIN[q];
      }
      wave.table[i] = x;
      peak = Math.max(peak, Math.abs(x));
    }
    let tLo = 0;
    let tHi = 0;
    for (let i = 0; i < TABLE_N; i += 1) {
      wave.table[i] /= peak;
      tLo = Math.min(tLo, wave.table[i]);
      tHi = Math.max(tHi, wave.table[i]);
    }
    wave.table[TABLE_N] = wave.table[0];
    wave.lo = tLo;
    wave.hi = Math.max(tHi, tLo + 1e-3);
    wave.version += 1;
  };

  // Runs keep their voices by staying close on the line from one listen to
  // the next; a run with no voice near takes a quiet one and starts fresh.
  const pairs = [];
  const assign = (runs) => {
    const used = new Array(VOICES).fill(false);
    const placed = new Array(runs.length).fill(-1);
    pairs.length = 0;
    const reach = strips[PITCH].bh * 0.14;
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
  // loop): read all four strips and set each stage exactly as the audio
  // graph will be asked to play it.
  const listen = (at, dt) => {
    cellView(at);
    assign(readPitch());
    const sp = strips[PITCH];
    let active = 0;
    for (const v of voices) if (v.on) active += 1;
    const share = 1 / (1 + 0.3 * Math.max(0, active - 1));
    for (const v of voices) {
      const target = v.on ? 0.55 + 0.45 * v.amp : 0;
      v.lv = damp(v.lv, target, target > v.lv ? 30 : 9, dt);
      const vv = clamp((v.y - sp.top) / sp.bh, 0, 1);
      v.hz = semisToHz((1 - vv) * SPAN);
      v.level = v.on ? 0.24 * (0.12 + 0.88 * v.amp) * share : 0;
      v.pan = (0.5 - vv) * 0.3;
    }
    const a = integrate(strips[AMP]);
    ctl.env = VCA_FLOOR + (1 - VCA_FLOOR) * Math.pow(clamp(a.cover / 0.5, 0, 1), 0.85);
    const b = integrate(strips[VIB]);
    ctl.vib = clamp(b.cover / 0.34, 0, 1);
    ctl.send = b.cover > 0.01 ? 0.12 + 0.88 * (1 - b.cv) : 0.3;
    hearWave();
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
  const shaped = { env: VCA_FLOOR, vib: 0 };

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
  const tab = (p) => {
    const x = p * TABLE_N;
    const i = x | 0;
    return wave.table[i] + (wave.table[i + 1] - wave.table[i]) * (x - i);
  };
  // The machine, in JS: per voice the strip-3 waveform and its twin a few
  // cents sharp, under the strip-4 vibrato and the drift, through gains that
  // move with the same time constants the audio graph uses, then the
  // strip-2 VCA. `col` advances the oscillators by one column of print, at
  // the print's slowed rate. Returns the clear half-width.
  const synthStep = (dt, col) => {
    clock += dt;
    shaped.env += (ctl.env - shaped.env) * (1 - Math.exp(-dt / 0.015));
    shaped.vib += (ctl.vib - shaped.vib) * (1 - Math.exp(-dt / 0.1));
    const wob = (2 + 38 * shaped.vib) * Math.sin(TAU * 4.7 * clock) + 3 * Math.sin(TAU * 0.17 * clock);
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
      if (col) {
        const f = (o.f * Math.pow(2, wob / 1200)) / (PRINT_CYCLE * ROOT);
        o.a = frac(o.a + f);
        o.b = frac(o.b + f * Math.pow(2, o.cents / 1200));
      }
      y += o.g * (tab(o.a) + 0.3 * tab(o.b));
      env += o.g * 1.3;
    });
    y *= shaped.env;
    env *= shaped.env;
    // Noise reduction, as on a real track: the opening rides the envelope,
    // so silence prints as a hairline of clear and a loud note swings the
    // track from closed to near full. The bias sits at the waveform's own
    // trough scaled by the envelope, so one voice's cycle is printed whole,
    // trough on the centre line and crest at the envelope's height; a
    // chord's crests can pile past full modulation, where it clips open.
    bias += (env - bias) * (1 - Math.exp(-dt / (env > bias ? 0.01 : 0.08)));
    const open = (y - bias * wave.lo) / ((wave.hi - wave.lo) * SYNTH_NORM);
    return 0.035 + 0.965 * clamp(open, 0, 1);
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
      head = synthStep(dt, false);
      return;
    }
    const ds = dt / n;
    for (let k = c1 - n + 1; k <= c1; k += 1) {
      listen(k / N, ds);
      head = synthStep(ds, true);
      const c = ((k % N) + N) % N;
      print[c] = head;
      printed[c] = 1;
    }
  };

  // Run the reader from one film position to another at transport speed,
  // listening and printing every column, from a quiet machine and a blank
  // print. The loop arrives printed by the lap before it, so a run starts
  // one lap upstream of the reader.
  const runFrom = (end) => {
    for (const s of strokes) if (s.dirty) lay(s);
    flushInk();
    for (const v of voices) Object.assign(v, { on: false, lv: 0, amp: 0, level: 0, fresh: false, snap: false });
    for (const o of synth) Object.assign(o, { g: 0, a: 0, b: 0 });
    Object.assign(shaped, { env: VCA_FLOOR, vib: 0 });
    wave.at = -1e9;
    heard.fill(-1);
    print.fill(0);
    printed.fill(0);
    clock = 0;
    bias = 0;
    const step = 1 / (N * speed);
    let at = rx / L - 1;
    readAt = at;
    while (at + 1 / N <= end) {
      at += 1 / N;
      advance(at, step);
    }
    advance(end, 0);
  };
  let warmed = false;

  // A still (?t=…) is the loop as it would be after t seconds of running.
  const replayTo = (t) => {
    phase = t * speed;
    runFrom(t * speed + rx / L);
  };

  // --- drawing -----------------------------------------------------------

  // Every loop on the transport, as [top edge, height]: the four control
  // strips and the print below them.
  const films = () => [...strips.map((st) => [st.y0, h]), [printY0, printH]];

  // The lightbox under the film: a warm white, brightest under the reader's
  // housing and falling away a little toward either end of the bed.
  const illum = (x) => 0.8 + 0.2 * Math.exp(-(((x - rx) / (W * 0.34)) ** 2));
  const rgb = (c) => `rgb(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0})`;
  // The print loses its edge with time: how stale the print under screen x
  // is, from just written (0) to a whole lap old (1). Downstream of the
  // reader it was printed this lap, upstream it is last lap's.
  const staleAt = (x) => {
    const age = x < rx ? (rx - x) / L : 1 - (x - rx) / L;
    return smoothstep(0.08, 1, age);
  };
  let baseFill = GROUND;
  let staleMul = "#fff";
  let staleLift = "#000";
  const gradients = () => {
    baseFill = g.createLinearGradient(0, 0, W, 0);
    staleMul = g.createLinearGradient(0, 0, W, 0);
    staleLift = g.createLinearGradient(0, 0, W, 0);
    const n = 48;
    const stops = [];
    for (let i = 0; i <= n; i += 1) stops.push(i / n);
    const cut = rx / W;
    stops.push(cut - 1e-4, cut);
    stops.sort((p, q) => p - q);
    for (const f of stops) {
      const x = f * W;
      const li = illum(x) * BASE_T;
      baseFill.addColorStop(f, rgb(LAMP.map((c) => c * li)));
      const x2 = f >= cut ? Math.max(x, rx + 0.01) : Math.min(x, rx - 0.01);
      const st = staleAt(x2);
      staleMul.addColorStop(f, rgb(STALE_CLEAR.map((c) => 255 + (c - 255) * st)));
      staleLift.addColorStop(f, rgb(STALE.map((c) => c * st)));
    }
  };

  // The film on the box: clear base, lit. Its perforations are holes, so
  // the bare lamp shows through them, a shade brighter than the base.
  const drawFilm = () => {
    const P = L / perfs;
    const pw = 1.98 * mm;
    const ph = 2.79 * mm;
    const r = 0.5 * mm;
    const off = frac(phase) * L;
    const first = Math.floor(off / P) - 1;
    for (const [y0, fh] of films()) {
      g.fillStyle = baseFill;
      g.fillRect(0, y0, W, fh);
      g.beginPath();
      for (let i = first; i <= first + perfs + 2; i += 1) {
        const x = i * P - off + (P - pw) / 2;
        if (x > W || x + pw < 0) continue;
        g.roundRect(x, y0 + 2.01 * mm, pw, ph, r);
        g.roundRect(x, y0 + fh - 2.01 * mm - ph, pw, ph, r);
      }
      g.fillStyle = "rgba(255, 248, 232, 0.17)";
      g.fill();
    }
  };

  // The ink as the eye gets it: the lamp through the base, cut by the dye.
  // Multiplied onto the film one device pixel to one film pixel.
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

  // The printed soundtrack: opaque where printed, opened by the signal in a
  // clear slit mirrored about the track's centre line. Fresh from the head
  // it is crisp, dense black against lit base; a lap on it has gone to a
  // duller grey-black.
  const drawTrack = () => {
    const mid = trackTop + trackH / 2;
    const half = (trackH / 2) * 0.94;
    const base = phase * N;
    const cFirst = Math.floor(base) - 1;
    const cLast = Math.ceil(base + W * dpr) + 1;
    const X = (c) => (c + 0.5 - base) / dpr;
    const at = (k) => ((k % N) + N) % N;
    let c = cFirst;
    while (c <= cLast) {
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
      g.fillStyle = baseFill;
      g.fill();
      c = e + 1;
    }
    g.globalCompositeOperation = "multiply";
    g.fillStyle = staleMul;
    g.fillRect(0, trackTop, W, trackH);
    g.globalCompositeOperation = "lighten";
    g.fillStyle = staleLift;
    g.fillRect(0, trackTop, W, trackH);
    g.globalCompositeOperation = "source-over";
  };

  // The reader: one slit of hard light under the whole transport. It is
  // the lamp concentrated, so the film over it is lit many times brighter
  // than the box, and what shows is that light through whatever is there:
  // white-hot through clear base and in the gaps between the loops, amber
  // through a thin wash, cut dead by a pool. Its spill reaches either side
  // of the slit, through the same ink. On the print loop it is the exposing
  // beam, through the opening the head is writing.
  let slitCanvas = null;
  let slitCtx = null;
  let slitImg = null;
  const SW = SLIT_K * 2 + 1;
  const core = new Float32Array(SW);
  const halo = new Float32Array(SW);
  // On the print, the track just exposed still glows downstream of the
  // head for a moment: the newest few millimetres of this lap's print.
  const after = new Float32Array(SW);
  for (let i = 0; i < SW; i += 1) {
    after[i] = i < SLIT_K ? 0.3 * Math.exp(-(SLIT_K - i) / 30) : 0;
    const dx = Math.abs(i - SLIT_K);
    core[i] = dx === 0 ? 2.8 : dx === 1 ? 1.9 : dx === 2 ? 0.45 : 0;
    halo[i] = 0.4 * Math.exp(-dx / 3.4) + 0.15 * Math.exp(-dx / 20);
  }
  const CORE_C = [255, 253, 248];
  const HALO_C = [255, 214, 158];
  const drawSlit = () => {
    const Hd = Math.round(H * dpr);
    if (!slitCanvas) {
      slitCanvas = document.createElement("canvas");
      slitCtx = slitCanvas.getContext("2d");
    }
    if (slitCanvas.height !== Hd) {
      slitCanvas.width = SW;
      slitCanvas.height = Hd;
      slitImg = slitCtx.createImageData(SW, Hd);
    }
    const data = slitImg.data;
    const px0 = Math.floor(rx * dpr);
    const xo = Math.round(-frac(phase) * N);
    const cInk = px0 - xo - SLIT_K;
    const cTrk = Math.floor(px0 + phase * N) - SLIT_K;
    const ext = Math.max(4, Math.round(pad * 0.7));
    const yA = strips[0].y0 - ext;
    const yB = printY0 + printH + ext;
    const mid = trackTop + trackH / 2;
    const half = (trackH / 2) * 0.94;
    const fl = films();
    for (let yd = 0; yd < Hd; yd += 1) {
      const y = (yd + 0.5) / dpr;
      const o0 = yd * SW * 4;
      // Where this row of the slit is: off the bed, a gap between loops,
      // a control strip (with ink), or the print.
      let kind = 0;
      let fade = 1;
      if (y >= yA && y <= yB) {
        kind = 1;
        for (let f = 0; f < fl.length; f += 1) {
          if (y >= fl[f][0] && y < fl[f][0] + fl[f][1]) kind = f < STRIPS ? 2 : 3;
        }
        if (kind === 1) fade = smoothstep(yA, strips[0].y0, y) * smoothstep(yB, printY0 + printH, y);
      }
      if (kind === 0 || fade <= 0) {
        data.fill(0, o0, o0 + SW * 4);
        continue;
      }
      const iy = Math.floor((y - rowTop) * dpr);
      const inInk = kind === 2 && iy >= 0 && iy < R;
      const inTrack = kind === 3 && y >= trackTop && y < trackTop + trackH;
      const dy = Math.abs(y - mid);
      for (let i = 0; i < SW; i += 1) {
        let tr = fade;
        let tg = fade;
        let tb = fade;
        if (kind > 1) {
          tr = tg = tb = BASE_T;
          if (inInk) {
            const cc = (((cInk + i) % N) + N) % N;
            const q = Math.min(LUT_N - 1, (comp[iy * N + cc] * LUT_S) | 0);
            tr *= LUT_R[q] / 255;
            tg *= LUT_G[q] / 255;
            tb *= LUT_B[q] / 255;
          } else if (inTrack) {
            const cc = (((cTrk + i) % N) + N) % N;
            if (printed[cc] && dy > print[cc] * half) tr = tg = tb = 0.004;
          }
        }
        const pc = core[i];
        const ph = inTrack ? halo[i] + after[i] : halo[i];
        const o = o0 + i * 4;
        data[o] = tr * (pc * CORE_C[0] + ph * HALO_C[0]);
        data[o + 1] = tg * (pc * CORE_C[1] + ph * HALO_C[1]);
        data[o + 2] = tb * (pc * CORE_C[2] + ph * HALO_C[2]);
        data[o + 3] = 255;
      }
    }
    slitCtx.putImageData(slitImg, 0, 0);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "lighter";
    g.drawImage(slitCanvas, px0 - SLIT_K, 0);
    g.restore();
  };

  const draw = () => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = GROUND;
    g.fillRect(0, 0, W, H);
    drawFilm();
    drawInk();
    drawTrack();
    drawSlit();
  };

  // --- frame -------------------------------------------------------------

  let lastFrame = performance.now();
  let sentWave = -1;
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
      if (!warmed) {
        warmed = true;
        runFrom(phase + rx / L);
      }
      // The transport comes up to speed the way a motor does.
      const spin = 1 - Math.pow(1 - clamp((t - started) / 1.6, 0, 1), 3);
      phase += speed * spin * dt;
    }
    if (drawing) sample(stage.pointer.x, stage.pointer.y);

    for (let i = strokes.length - 1; i >= 0; i -= 1) {
      const s = strokes[i];
      if (!s.dying) continue;
      s.alpha = damp(s.alpha, 0, 3, dt);
      markTile(s);
      if (s.alpha < 0.02) strokes.splice(i, 1);
    }

    for (const s of strokes) if (s.dirty) lay(s);
    flushInk();
    advance(phase + rx / L, dt);

    if (sound) {
      voices.forEach((v, i) => {
        sound.voice(i, v.hz || 220, v.level || 0, v.pan || 0, v.fresh);
        v.fresh = false;
      });
      sound.shape(ctl.env, ctl.vib, ctl.send);
      if (wave.version !== sentWave) {
        sentWave = wave.version;
        sound.wave(wave.re, wave.im);
      }
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
