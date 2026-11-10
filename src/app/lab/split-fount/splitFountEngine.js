import { createStage, clamp, damp } from "../_kit/stage";

// Split-fount inking on a proof press. Three inks sit side by side in one
// fountain; the oscillating roller smears their borders into a gradient that
// runs along the roller's axis, so across the direction of travel. Each pass
// pulls a proof: the last sheet is shingled onto the run under the bed, a
// fresh one is laid on top and the cylinder prints it under the pointer, and
// the inks have mixed further on the roller, so the borders wander, the blends
// widen and the hues slide toward a common mud from proof to proof. The run
// is kept: the last few proofs stay in view on the pile, each slid off the
// sheet above it along the way it was pulled, so the strip it shows always
// crosses the fount's bands: a sheet pulled down the bed shows its head above
// the next, one pulled across shows the edge it came in by, top to bottom.
// The word is set big, tight to the stock as poster shops set wood type: it
// runs nine tenths of the sheet's width, head and sides equal, and the foot
// just heavier than the head, so the word sits at the sheet's optical centre
// and every proof is a finished sheet, not a crop of one. The fresh proof
// lies whole in the frame, its four edges on the ground; above it the run
// climbs the frame as a column of strips, each a different fount, stacked
// like a specimen sheet. The pile is squared by hand, not by machine: each
// proof shows its head margin and about a third of the cap height above the
// next, give or take a fifth, and lies half a degree to a degree and a half
// off true, so the strips never line up like rows. The frame holds the fresh
// proof and three and a half strips of the run; the older ones run off the
// top of the frame.
//
// The cylinder inks, it does not reveal: right behind the nip the ink arrives
// starved and salted and builds to full over a short ramp, the nip line
// wavers with the roller's pressure, and the letters' leading edges slur a
// hair forward in the direction of travel.
//
// The sheet is shaded per pixel: cream stock with fibre, a word mask (sharp,
// lightly blurred for ragged edges and the squeeze rim, broadly blurred for
// the impression), and ink as absorbance so mixed inks darken the way
// transparent inks do on paper.

const WORD = "PROOF";

// Proofs of the run kept in view under the bed.
const RUN = 4;
// The word's share of the sheet's width; head and sides take what is left,
// equal, and the foot is at least this much heavier than the head.
const WORD_SHARE = 0.9;
const FOOT = 1.4;
// The sheet's height as a share of the frame's, and its cap: never more foot
// than this share of the cap height, so the foot stays just heavier than the
// head and the word sits at the sheet's optical centre, never above a slab of
// empty stock.
const SHEET_H = 0.45;
const FOOT_MAX = 0.25;
// The shingle's step: each proof shows its head margin and about this share
// of the cap height above the next, give or take STEP_VAR as a hand squares
// the pile.
const STEP = 1 / 3;
const STEP_VAR = 0.2;
// Strips of the run held in the frame beside the fresh proof; the rest run
// off its edge.
const FRAME = 3.5;
// The ramp behind the nip over which the ink builds to full, css px.
const RAMP = 22;
// How long a pulled proof takes to settle into the run, ms.
const SHINGLE = 560;

// Inks, sRGB on white. A chrome yellow, a warm red and a process blue.
const INKS = [
  [0.96, 0.73, 0.12],
  [0.86, 0.2, 0.19],
  [0.06, 0.36, 0.7],
];
const PAPER = [0.937, 0.905, 0.83];
const GROUND = [0.949, 0.941, 0.922];

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uDpr;
uniform vec2 uC; uniform vec2 uHalf;           // sheet centre and half size, css px
uniform sampler2D uMask;
uniform vec4 uWord;                             // word box: centre xy, half wh (sheet local, from centre)
uniform vec3 uPaper; uniform vec3 uGround;
// New (bottom) sheet
uniform vec3 uA0, uA1, uA2;                     // ink absorbances after mixing
uniform vec4 uP;                                // b1, b2, blend width, seed
uniform vec4 uQ;                                // dir.xy, front, passing
// The run of earlier proofs under the bed, newest first.
uniform int uSN;
uniform vec3 uSA[${(RUN + 1) * 3}];                   // inks, three per proof
uniform vec4 uSP[${RUN + 1}];                       // b1, b2, blend width, seed
uniform vec2 uSD[${RUN + 1}];                       // direction each was pulled in
uniform vec4 uST[${RUN + 1}];                       // offset xy from the bed, rotation, how high it lies
out vec4 o;

uint hh(uint x){ x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16; return x; }
float hash(vec2 p){ ivec2 i = ivec2(floor(p)); return float(hh(uint(i.x) * 1597334677U ^ hh(uint(i.y) + 0x9e3779b9U))) / 4294967295.0; }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.07 + 13.7; a *= 0.5; } return s / 0.9375; }

vec3 mask(vec2 l){ return texture(uMask, l / (uHalf * 2.0)).rgb; }

// Paper: cream stock with a fine tooth and a soft cloud of fibre.
vec3 paper(vec2 l){
  float tooth = noise(l * 1.1) - 0.5;
  float cloud = fbm(l * 0.018) - 0.5;
  float fib = noise(vec2(l.x * 0.35 + l.y * 0.11, l.y * 2.4 - l.x * 0.3)) - 0.5;
  return uPaper * (1.0 + tooth * 0.022 + cloud * 0.03 + fib * 0.012);
}

vec3 proof(vec2 l, vec3 A0, vec3 A1, vec3 A2, vec4 P, vec4 Q){
  vec3 col = paper(l);
  vec2 dir = Q.xy;
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 c = l - uHalf;                           // from sheet centre
  float along = dot(c, dir);
  float seed = P.w;
  float across = dot(c, perp);
  // How far behind the nip this point is. The nip line wavers a little with
  // the roller's pressure; impression exists behind it, and the ink builds
  // from starved to full over a short ramp.
  float wav = (noise(vec2(across * 0.018, seed)) - 0.5) * 7.0 + (noise(vec2(across * 0.09, seed + 5.0)) - 0.5) * 2.5;
  float behind = Q.z - along + wav;
  float printed = smoothstep(-0.5, 0.5, behind);
  float ramp = smoothstep(0.0, ${RAMP.toFixed(1)}, behind);
  float starve = 1.0 - ramp;
  // Slur: near the nip the sheet creeps on the forme, so the type's leading
  // edges smear forward along the travel, a pale ghost a few px long.
  float slur = 3.2 * (1.0 - smoothstep(0.0, ${(RAMP * 1.6).toFixed(1)}, behind));

  vec3 m = mask(l);
  // Impression: the type bit into the sheet. Shade the dent from the broad
  // blur's slope, lit from the upper left.
  float e = 1.5;
  float gx = mask(l + vec2(e, 0)).b - mask(l - vec2(e, 0)).b;
  float gy = mask(l + vec2(0, e)).b - mask(l - vec2(0, e)).b;
  col *= 1.0 - (gx + gy) * 0.16 * smoothstep(-2.0, 14.0, behind);

  // Ragged edge: threshold the light blur against noise, so the edge of the
  // ink wanders by a fraction of a pixel like ink on rag.
  float wob = (noise(l * 0.75 + seed) - 0.5) * 0.22 + (noise(l * 0.13 + seed * 0.3) - 0.5) * 0.14;
  float g = m.g + wob;
  float aa = max(fwidth(m.g), 0.002) * 0.9;
  float a = smoothstep(0.5 - aa, 0.5 + aa, g);
  float aS = 0.0;
  if (slur > 0.05) {
    float gs = mask(l - dir * slur).g + wob;
    aS = smoothstep(0.5 - aa * 2.0, 0.5 + aa * 2.0, gs) * (1.0 - a);
  }
  a += aS * 0.42;
  // Fixed to the block: wood type wears at its edges, never in its face.
  // Long, slow noise picks the stretches of contour that have taken knocks;
  // there the edge is bitten back by up to a couple of px, measured on the
  // broad blur so a convex corner (a bowl's shoulder, the foot of a stem, an
  // arm's tip) loses more than a straight run does. The face stays a flat
  // slab: any light in it comes from the ink, not the wood.
  // On a straight run the broad blur climbs about 0.6 as fast as the light
  // one going in from the edge; where it lags, the point sits on a convex
  // corner, and corners are where a block takes its knocks.
  float corner = smoothstep(0.03, 0.12, 0.5 + 0.6 * (m.g - 0.5) - m.b);
  float nk = fbm(l * vec2(0.034, 0.029) + vec2(31.0, 7.0));
  float nick = smoothstep(0.7 - corner * 0.34, 0.78 - corner * 0.34, nk);
  float lip = (noise(l * 0.4 + 57.0) - 0.5) * 0.09 + (noise(l * 1.2 + 19.0) - 0.5) * 0.025;
  float bite = smoothstep(-0.015, 0.015, 0.5 + nick * 0.22 + lip - m.b) * smoothstep(0.0, 0.2, nick);
  a *= 1.0 - bite;
  if (a * printed <= 0.0) return col;

  // Squeeze: ink pushed to the letter's edge sits thicker there.
  float rim = smoothstep(0.5, 0.6, m.g) * (1.0 - smoothstep(0.66, 0.95, m.g));

  // The fountain: three inks across the roller's axis, blended at their
  // borders by the oscillation, wider every pass.
  float span = abs(perp.x) * uWord.z + abs(perp.y) * uWord.w;
  float s = dot(c - uWord.xy, perp) / span;
  s += (fbm(vec2(along * 0.006, s * 2.0) + seed) - 0.5) * 0.05;
  float w = P.z;
  float w0 = 1.0 - smoothstep(P.x - w, P.x + w, s);
  float w2 = smoothstep(P.y - w, P.y + w, s);
  float w1 = max(0.0, 1.0 - w0 - w2);
  float ws = w0 + w1 + w2;

  // Coverage. A wood type solid off a well charged roller is flat and
  // dense: the film is full everywhere, with only the faintest grain of the
  // block running up the letters and the roller's tracks along the travel.
  // Thin ink, and the salt of paper tooth breaking through it, has a cause
  // and a place, never an even sprinkle over the whole solid:
  //  - the starved ramp just behind the nip, before the film is laid;
  //  - a thin band along each fount border, where the roller is still
  //    working two inks into each other and lays them a little short;
  //  - a slow patch where the roller ran short on this pull, a different
  //    place on every proof, drawn out along the travel.
  float streak = fbm(vec2(across * 0.06, along * 0.004) + seed);
  float grain = fbm(vec2(l.x * 0.22, l.y * 0.012) + 5.0);
  float bw = 0.03 + w * 0.22;
  float seam = exp(-pow((s - P.x) / bw, 2.0)) + exp(-pow((s - P.y) / bw, 2.0));
  seam *= smoothstep(0.2, 0.75, noise(vec2(along * 0.03, seed + 3.0)) * 0.7 + noise(vec2(along * 0.11, across * 0.4 + seed)) * 0.3);
  float shortN = fbm(vec2(across * 0.0045, along * 0.0016) + seed * 0.37 + 11.0);
  float short_ = smoothstep(0.58, 0.74, shortN);
  float cov = 1.0 - grain * 0.035 - (1.0 - streak) * 0.03 - short_ * (0.1 + (1.0 - streak) * 0.12) - seam * 0.04;
  // Salt: fine points of tooth, never blotches. Across the full body it is
  // capped to a stray point here and there; it is spent where the ink is short.
  float sp = noise(l * 1.6 + seed * 3.1) * 0.7 + noise(l * 3.3 - seed) * 0.3;
  float th = seam * 0.12 + short_ * (0.2 + (streak - 0.5) * 0.3);
  th = max(th, starve * (0.5 + (streak - 0.5) * 0.5));
  float hole = smoothstep(0.9 - th, 0.94 - th, sp) * (1.0 - rim * ramp);
  float film = mix(0.3, 1.0, ramp * ramp);
  float d = a * printed * film * cov * (1.0 - hole * 0.9) * (1.0 + rim * 0.45 * ramp);

  vec3 A = (w0 * A0 + w1 * A1 + w2 * A2) / ws;
  // Pigments mixed on a roller sit between a dye's darkening and a plain
  // average of the inks, so a red and a blue blend to violet, not mud.
  vec3 T = (w0 * exp(-A0 * d) + w1 * exp(-A1 * d) + w2 * exp(-A2 * d)) / ws;
  return col * mix(exp(-A * d), T, 0.55);
}

float box(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// A sheet lying a hair above whatever is under it; k is how far, as no two
// sheets on a pile lie quite flat.
float lift(vec2 q, float k){
  return 1.0 - 0.07 * k * exp(-max(box(q - vec2(0, 1.5 * k), uHalf, 1.0), 0.0) / (5.0 * k))
             - 0.035 * k * exp(-max(box(q - vec2(0, 8.0 * k), uHalf, 8.0), 0.0) / (26.0 * k));
}

void main(){
  vec2 P = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;
  vec3 col = uGround;
  float shade = 1.0;
  // The bed: the sheet being printed, on top of the run.
  vec2 qb = P - uC;
  float dB = box(qb, uHalf, 0.5);
  if (dB < 0.5) {
    col = proof(qb + uHalf, uA0, uA1, uA2, uP, uQ);
    // The cylinder's shade over the nip while it rolls: broad and soft, with
    // no edge of its own, so it never reads as a crease in the sheet.
    if (uQ.w > 0.5) {
      float ahead = dot(qb, uQ.xy) - uQ.z;
      col *= 1.0 - 0.02 * smoothstep(-90.0, 90.0, ahead) * (1.0 - smoothstep(90.0, 520.0, ahead));
    }
    if (dB > -0.6) col *= 0.97;
  } else {
    shade *= lift(qb, 1.0);
    // The run under it, newest first.
    for (int i = 0; i < ${RUN + 1}; i++) {
      if (i >= uSN) break;
      vec4 T = uST[i];
      vec2 q = rot(-T.z) * (P - uC - T.xy);
      float d = box(q, uHalf, 0.5);
      if (d < 0.5) {
        col = proof(q + uHalf, uSA[i * 3], uSA[i * 3 + 1], uSA[i * 3 + 2], uSP[i], vec4(uSD[i], 1e5, 0.0));
        // A proof's cut edge, seen edge-on in the stack.
        col *= mix(1.0, 0.955, smoothstep(-1.4, 0.5, d));
        break;
      }
      shade *= lift(q, T.w);
    }
  }
  col *= shade;
  // Dither the 8-bit output so the paper's shading never bands.
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(col, 1.0);
}`;

// ---------- the forme ----------------------------------------------------

// Separable box blur, run three times to approach a gaussian.
function boxBlur(src, w, h, r, passes) {
  let a = Float32Array.from(src);
  const b = new Float32Array(w * h);
  const col = new Float32Array(h);
  const inv = 1 / (2 * r + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[row + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc * inv;
        acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        col[y] = acc * inv;
        acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
      for (let y = 0; y < h; y++) a[y * w + x] = col[y];
    }
  }
  return a;
}

const formeFont = (family, px) => `400 ${px}px ${family}, Impact, "Arial Narrow", sans-serif`;
// Wood type is set near touching: tracking by the law at this size, eased.
const trackAt = (size) => -0.043 * (size - 12) * 0.12;
let meter = null;

// The forme's ink at a given size, css px: where each letter's pen sits from
// the ink's left edge, the ink's width, its cap height and its ascent.
function measureForme(family, size) {
  meter = meter || document.createElement("canvas").getContext("2d");
  meter.font = formeFont(family, size);
  const track = trackAt(size);
  const pens = [];
  let left = Infinity;
  let right = -Infinity;
  for (let i = 0; i < WORD.length; i++) {
    const px = meter.measureText(WORD.slice(0, i)).width + track * i;
    const g = meter.measureText(WORD[i]);
    pens.push(px);
    left = Math.min(left, px - g.actualBoundingBoxLeft);
    right = Math.max(right, px + g.actualBoundingBoxRight);
  }
  const m = meter.measureText(WORD);
  return {
    pens: pens.map((p) => p - left),
    inkW: right - left,
    capH: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
    ascent: m.actualBoundingBoxAscent,
  };
}

// The job at a given type size in a frame frameH tall: the sheet, its
// margins and the shingle's mean step, all whole css px.
function jobAt(family, size, frameH) {
  const f = measureForme(family, size);
  const margin = Math.round((f.inkW * (1 / WORD_SHARE - 1)) / 2);
  const hw = Math.round((f.inkW + 2 * margin) / 2);
  const short = margin * (1 + FOOT) + f.capH;
  const tall = clamp(frameH * SHEET_H, short, Math.max(short, margin + f.capH * (1 + FOOT_MAX)));
  const hh = Math.round(tall / 2);
  const step = margin + f.capH * STEP;
  return { size, f, margin, half: [hw, hh], step };
}

// Rasterise the word as wood type: each letter its own block, set tight,
// each sitting a hair off true, locked up with the head and side margins
// equal and the foot heavier.
function setForme(family, job, dpr) {
  const [hw, hh] = job.half;
  const { f, margin, size } = job;
  const W = Math.round(hw * 2 * dpr);
  const H = Math.round(hh * 2 * dpr);
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const x = cv.getContext("2d", { willReadFrequently: true });
  x.font = formeFont(family, size * dpr);
  // Side margins split whatever the trim's rounding left over.
  const x0 = (W - f.inkW * dpr) / 2;
  const base = (margin + f.ascent) * dpr;
  const ascent = f.ascent * dpr;
  const capH = f.capH * dpr;
  x.fillStyle = "#000";
  x.fillRect(0, 0, W, H);
  x.fillStyle = "#fff";
  const jit = [
    [0.4, -0.6, 0.003],
    [-0.3, 0.5, -0.002],
    [0.2, 0.9, 0.0025],
    [-0.5, -0.3, -0.0015],
    [0.3, 0.4, 0.002],
  ];
  for (let i = 0; i < WORD.length; i++) {
    const px = x0 + f.pens[i] * dpr;
    const [jx, jy, jr] = jit[i % jit.length];
    x.save();
    x.translate(px + jx * dpr, base + jy * dpr);
    x.rotate(jr);
    x.fillText(WORD[i], 0, 0);
    x.restore();
  }
  const img = x.getImageData(0, 0, W, H).data;
  const sharp = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) sharp[i] = img[i * 4] / 255;
  const light = boxBlur(sharp, W, H, Math.max(1, Math.round(1.1 * dpr)), 3);
  const broad = boxBlur(sharp, W, H, Math.max(1, Math.round(2.6 * dpr)), 3);
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = img[i * 4];
    out[i * 4 + 1] = Math.round(light[i] * 255);
    out[i * 4 + 2] = Math.round(broad[i] * 255);
    out[i * 4 + 3] = 255;
  }
  const word = [0, margin + f.capH / 2 - hh, f.inkW / 2, f.capH / 2];
  // How far in from each side edge the first column of type runs the full
  // height of the line (the P's stem, the F's), css px. A proof shingled out
  // sideways shows at least this much more than its strip, so the strip
  // always holds a full stem and with it the fount top to bottom.
  const y0 = Math.max(0, Math.round(base - ascent));
  const y1 = Math.min(H, Math.round(base - ascent + capH));
  const full = (cx) => {
    let k = 0;
    for (let y = y0; y < y1; y++) k += sharp[y * W + cx] > 0.5 ? 1 : 0;
    return k >= (y1 - y0) * 0.85;
  };
  let lx = 0;
  while (lx < W - 1 && !full(lx)) lx++;
  let rx = W - 1;
  while (rx > 0 && !full(rx)) rx--;
  const reach = [lx / dpr, (W - 1 - rx) / dpr];
  return { W, H, out, word, reach };
}

// ---------- the roller ---------------------------------------------------

const absorb = (c) => c.map((v) => -Math.log(Math.max(0.02, v)));
const A = INKS.map(absorb);
const lerp3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const rnd = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// Proof n's ink. Every pass the roller works the inks into each other:
// the borders between them wander as the fountain is fed, the blend widens
// quickly over the first few proofs, and the hues keep sliding toward one
// common mud long after the blend has stopped widening, each ink dirtied by
// its neighbour and all of them by the whole.
function proofInk(n) {
  const k = 1 - Math.exp(-(n - 1) / 2.5);
  let d1 = 0;
  let d2 = 0;
  for (let i = 1; i <= n; i++) {
    d1 = d1 * 0.8 + (rnd(i) - 0.5) * 0.15;
    d2 = d2 * 0.8 + (rnd(i + 91) - 0.5) * 0.15;
  }
  const b1 = -0.36 + d1 + k * 0.04;
  const b2 = Math.max(b1 + 0.3, 0.34 + d2 - k * 0.03);
  const w = 0.06 + 0.3 * k;
  const mixK = 1 - Math.exp(-(n - 1) / 7);
  const mud = lerp3(lerp3(A[0], A[1], 0.5), A[2], 1 / 3);
  const a0 = lerp3(lerp3(A[0], A[1], mixK * 0.4), mud, mixK * 0.45);
  const a1 = lerp3(lerp3(A[1], lerp3(A[0], A[2], 0.5), mixK * 0.35), mud, mixK * 0.45);
  const a2 = lerp3(lerp3(A[2], A[1], mixK * 0.35), mud, mixK * 0.45);
  return { a: [a0, a1, a2], p: [b1, b2, w, rnd(n * 3.3) * 200] };
}

export async function createSplitFount(host, { family = "sans-serif" } = {}) {
  try {
    await document.fonts.load(`400 100px ${family}`, WORD);
  } catch {}

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) return { destroy: () => stage.destroy() };

  const params = new URLSearchParams(location.search);
  const qn = parseInt(params.get("n"), 10);
  const qt = parseFloat(params.get("t"));
  const qa = parseFloat(params.get("a"));
  const held = Number.isFinite(qt);

  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.warn(gl.getProgramInfoLog(prog));
  const U = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i);
    U[info.name] = gl.getUniformLocation(prog, info.name);
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture();

  // Layout
  let C = [0, 0];
  let half = [1, 1];
  let word = [0, 0, 1, 1];
  // Type's reach in from the sheet's left and right edges, the shingle's
  // mean step and the head margin.
  let reach = [0, 0];
  let step = 64;
  let margin = 16;

  // Press state. The run holds the proofs already pulled, newest first; each
  // eases from the bed into its place on the pile.
  const dirFrom = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  const start = Number.isFinite(qn) && qn > 0 ? qn : 4;
  const cur = { n: start, dir: dirFrom(Number.isFinite(qa) ? qa : 90), passing: false };
  // Each proof lands turned 0.5 to 1.5 degrees one way or the other, a
  // little more when it was pulled from off centre, as sheets laid by hand.
  const landing = (n, spin) => {
    const turn = ((0.5 + rnd(n * 7.1)) * (rnd(n * 2.9) < 0.5 ? -1 : 1) * Math.PI) / 180;
    return { rot: clamp(turn + spin * 0.1, -0.03, 0.03) };
  };
  // Proof n's own step, squared by hand: the mean step give or take a fifth,
  // whole px.
  const stepOf = (n) => Math.max(4, Math.round(step * (1 + STEP_VAR * (2 * rnd(n * 8.3 + 1.7) - 1))));
  // Which way a proof slides off the one above it: along the way it was
  // pulled, so its exposed strip runs across the fount's bands. Pulled down
  // or up the bed it shows its head, where the type is set; pulled across, it
  // shows the side it came in by.
  const sideOf = (d) => (Math.abs(d[1]) >= Math.abs(d[0]) ? [0, -1] : [d[0] > 0 ? -1 : 1, 0]);
  // Its offset from the sheet above: its own step along that side, with a
  // little drift along the edge as a hand squares a pile.
  const shingleOf = (e) => {
    const [sx, sy] = sideOf(e.dir);
    let gap = stepOf(e.n);
    // Shown sideways, the strip is measured from the first full stem in
    // from that edge, so the F's arms never stand in for the whole fount.
    if (sx !== 0) gap += Math.max(0, reach[sx > 0 ? 1 : 0] - reach[0]);
    const j = (rnd(e.n * 5.3) - 0.5) * step * 0.16;
    return [sx * gap - sy * j, sy * gap + sx * j];
  };
  // Each entry eases from where it lay when the last proof was pulled
  // (x0, y0, r0) to its place on the pile, over SHINGLE ms of wall clock.
  const run = [];
  for (let k = start - 1; k >= 1 && run.length < RUN; k--) {
    run.push({ n: k, dir: cur.dir, ...landing(k, 0), x: 0, y: 0, r: 0, x0: 0, y0: 0, r0: 0 });
  }
  let shingleT0 = -1e9;
  let prog01 = 1;
  let target = 1;
  let down = null; // { x, y, started }
  let released = true;
  let dirty = true;

  // Ground left round the fresh proof, css px.
  const groundOf = (m) => Math.max(16, Math.round(m * 0.75));
  const extent = (d) => Math.abs(d[0]) * half[0] * 2 + Math.abs(d[1]) * half[1] * 2;
  // The nip starts just off the sheet and runs past its far edge by the
  // ramp, so the last of the sheet is inked to full before the pass ends.
  const frontAt = (p) => -extent(cur.dir) / 2 - 8 + p * (extent(cur.dir) + 16 + RAMP);

  if (held) {
    cur.passing = true;
    prog01 = target = clamp(qt, 0, 1);
    released = false;
  }

  const beginPass = (dir, gx, gy) => {
    // A sheet pulled from off centre turns a little as it goes.
    const cx = gx - C[0];
    const cy = gy - C[1];
    const spin = clamp((cx * dir[1] - cy * dir[0]) / (half[0] + half[1]), -1, 1) * -0.05;
    for (const e of run) Object.assign(e, { x0: e.x, y0: e.y, r0: e.r });
    run.unshift({ n: cur.n, dir: cur.dir, ...landing(cur.n, spin), x: 0, y: 0, r: 0, x0: 0, y0: 0, r0: 0 });
    run.length = Math.min(run.length, RUN + 1);
    shingleT0 = performance.now();
    cur.n += 1;
    cur.dir = dir;
    cur.passing = true;
    prog01 = 0;
    target = 0;
    released = false;
  };
  const commit = () => {
    cur.passing = false;
    prog01 = target = 1;
  };

  stage.on("down", (p) => {
    if (cur.passing && !held) commit();
    down = { x: p.x, y: p.y, started: false };
    dirty = true;
  });
  stage.on("move", (p) => {
    if (!down) return;
    const dx = p.x - down.x;
    const dy = p.y - down.y;
    if (!down.started) {
      if (Math.hypot(dx, dy) < 10) return;
      const l = Math.hypot(dx, dy);
      down.started = true;
      down.dir = [dx / l, dy / l];
      beginPass(down.dir, down.x, down.y);
    }
    const along = dx * down.dir[0] + dy * down.dir[1];
    target = Math.max(target, clamp(along / (0.5 * extent(down.dir)), 0, 1));
    dirty = true;
  });
  stage.on("up", () => {
    if (down?.started) {
      released = true;
      target = 1;
    }
    down = null;
    dirty = true;
  });

  stage.onResize((w, h, dpr) => {
    // The type size sets the sheet's width and the step. Find the largest
    // size at which the sheet fits the frame's width, and a pile pulled down
    // the bed holds the whole fresh proof, a little ground under its foot and
    // FRAME strips of the run above it.
    const fits = (size) => {
      const j = jobAt(family, size, h);
      return j.half[0] * 2 <= w * 0.92 && j.half[1] * 2 + FRAME * j.step + 2 * groundOf(j.margin) <= h;
    };
    let lo = 12;
    let hi = Math.max(lo, Math.min(w, h));
    for (let i = 0; i < 24 && hi - lo > 0.25; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    const job = jobAt(family, lo, h);
    half = job.half;
    step = job.step;
    margin = job.margin;
    const f = setForme(family, job, dpr);
    word = f.word;
    reach = f.reach;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, f.W, f.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, f.out);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    dirty = true;
  });

  const uLoc = (name) => gl.getUniformLocation(prog, name);
  const uRun = { n: uLoc("uSN"), a: uLoc("uSA"), p: uLoc("uSP"), d: uLoc("uSD"), t: uLoc("uST") };
  const runA = new Float32Array((RUN + 1) * 9);
  const runP = new Float32Array((RUN + 1) * 4);
  const runD = new Float32Array((RUN + 1) * 2);
  const runT = new Float32Array((RUN + 1) * 4);

  stage.onFrame((dt) => {
    if (cur.passing && !held) {
      // The cylinder follows the hand with a little lag, and on release
      // rolls itself out with an ease-out.
      prog01 = damp(prog01, target, released ? 9 : 16, dt);
      if (released && prog01 > 0.998) commit();
      dirty = true;
    }
    // Shingle the run: each proof's place on the pile is the sum of its own
    // offset and those of every proof above it, so a fresh proof pushes the
    // whole pile out by its own strip. The oldest, on its way out, squares up
    // under the proof that covers it.
    const st = (performance.now() - shingleT0) / SHINGLE;
    const ease = st < 1 ? 1 - Math.pow(1 - st, 3) : 1;
    let ox = 0;
    let oy = 0;
    let to = null;
    for (let i = 0; i < run.length; i++) {
      const e = run[i];
      if (i < RUN) {
        const v = shingleOf(e);
        ox += v[0];
        oy += v[1];
        to = [ox, oy, e.rot];
      }
      e.x = e.x0 + (to[0] - e.x0) * ease;
      e.y = e.y0 + (to[1] - e.y0) * ease;
      e.r = e.r0 + (to[2] - e.r0) * ease;
    }
    if (st < 1) dirty = true;
    // The oldest is gone once the one above has slid over it.
    else run.length = Math.min(run.length, RUN);
    if (!dirty) return;
    dirty = false;

    const { width: w, height: h, dpr } = stage;
    // Frame the fresh proof with the first FRAME strips of the run as one
    // block, centred; older proofs run off the frame's edge. Where the block
    // is bigger than the frame it bleeds off, but only the run does: the
    // fresh proof keeps its four edges and a little ground on the frame. It
    // settles with the pile as each proof goes onto it.
    let x0 = -half[0];
    let x1 = half[0];
    let y0 = -half[1];
    let y1 = half[1];
    let px = 0;
    let py = 0;
    for (let i = 0; i < run.length && i < FRAME; i++) {
      const e = run[i];
      const k = Math.min(1, FRAME - i);
      const x = px + (e.x - px) * k;
      const y = py + (e.y - py) * k;
      x0 = Math.min(x0, x - half[0]);
      x1 = Math.max(x1, x + half[0]);
      y0 = Math.min(y0, y - half[1]);
      y1 = Math.max(y1, y + half[1]);
      px = e.x;
      py = e.y;
    }
    const place = (S, lo, hi, wl, wr, tail) => Math.min(Math.max((S - lo - hi) / 2, tail - wl), S - tail - wr);
    const g = groundOf(margin);
    const cx = place(w, x0, x1, -half[0], half[0], g);
    const cy = place(h, y0, y1, -half[1], half[1], g);
    C = [Math.round(cx * dpr) / dpr, Math.round(cy * dpr) / dpr];
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(U.uMask, 0);
    gl.uniform2f(U.uRes, w, h);
    gl.uniform1f(U.uDpr, dpr);
    gl.uniform2fv(U.uC, C);
    gl.uniform2fv(U.uHalf, half);
    gl.uniform4fv(U.uWord, word);
    gl.uniform3fv(U.uPaper, PAPER);
    gl.uniform3fv(U.uGround, GROUND);
    const ink = proofInk(cur.n);
    gl.uniform3fv(U.uA0, ink.a[0]);
    gl.uniform3fv(U.uA1, ink.a[1]);
    gl.uniform3fv(U.uA2, ink.a[2]);
    gl.uniform4fv(U.uP, ink.p);
    gl.uniform4f(U.uQ, cur.dir[0], cur.dir[1], cur.passing ? frontAt(prog01) : 1e5, cur.passing ? 1 : 0);

    for (let i = 0; i < run.length; i++) {
      const e = run[i];
      const pk = proofInk(e.n);
      for (let j = 0; j < 3; j++) runA.set(pk.a[j], i * 9 + j * 3);
      runP.set(pk.p, i * 4);
      runD.set(e.dir, i * 2);
      runT.set([e.x, e.y, e.r, 0.7 + 0.6 * rnd(e.n * 4.1)], i * 4);
    }
    gl.uniform1i(uRun.n, run.length);
    gl.uniform3fv(uRun.a, runA);
    gl.uniform4fv(uRun.p, runP);
    gl.uniform2fv(uRun.d, runD);
    gl.uniform4fv(uRun.t, runT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  });

  return {
    destroy() {
      stage.destroy();
    },
  };
}
