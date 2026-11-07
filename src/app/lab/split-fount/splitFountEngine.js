import { createStage, clamp, damp } from "../_kit/stage";

// Split-fount inking on a proof press. Three inks sit side by side in one
// fountain; the oscillating roller smears their borders into a gradient that
// runs along the roller's axis, so across the direction of travel. Each pass
// pulls a proof: the last sheet is shingled onto the run under the bed, a
// fresh one is laid on top and the cylinder prints it under the pointer, and
// the inks have mixed further on the roller, so the borders wander, the blends
// widen and the hues slide toward a common mud from proof to proof. The run
// is kept: the last few proofs stay in view, their heads showing above the
// bed, so the drift reads sheet against sheet.
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
// Each one's head shows this share of the sheet's height above the next.
const STEP = 0.13;
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
uniform vec4 uST[${RUN + 1}];                       // offset xy from the bed, rotation
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
  // Fixed to the block: nicks and dents in the wood face, the same on
  // every proof.
  float nk = fbm(l * 0.06 + 31.0);
  float nick = smoothstep(0.80, 0.82, nk) * smoothstep(0.95, 0.99, m.b);
  float pin = smoothstep(0.93, 0.95, noise(l * 0.35 + 77.0)) * smoothstep(0.8, 0.98, m.b);
  a *= 1.0 - max(nick * 0.7, pin * 0.6);
  if (a * printed <= 0.0) return col;

  // Squeeze: ink pushed to the letter's edge sits thicker there.
  float rim = smoothstep(0.5, 0.6, m.g) * (1.0 - smoothstep(0.66, 0.95, m.g));

  // Coverage: streaks along the travel from the roller's tracks, the wood's
  // grain running up the letters, and a mottle of thin patches.
  float streak = fbm(vec2(dot(c, perp) * 0.06, along * 0.004) + seed);
  float grain = fbm(vec2(l.x * 0.22, l.y * 0.012) + 5.0);
  float mottle = fbm(l * 0.03 + seed * 1.7);
  float cov = 0.98 - (1.0 - streak) * 0.1 - grain * 0.06 - smoothstep(0.5, 0.8, mottle) * 0.08;
  // Speckle: where coverage runs thin, the paper's tooth breaks through,
  // as salt: fine points, never blotches. Just behind the nip the roller
  // has not yet laid its full film, so the salt is heavy there and the
  // streaks along the travel show.
  float thin = clamp((0.93 - cov) * 5.0, 0.0, 1.0);
  float sp = noise(l * 1.6 + seed * 3.1) * 0.7 + noise(l * 3.3 - seed) * 0.3;
  float th = max(thin * 0.16, starve * (0.42 + (streak - 0.5) * 0.5));
  float hole = smoothstep(0.8 - th, 0.84 - th, sp) * (1.0 - rim * ramp);
  float film = mix(0.3, 1.0, ramp * ramp);
  float d = a * printed * film * cov * (1.0 - hole * 0.9) * (1.0 + rim * 0.45 * ramp);

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
  vec3 A = (w0 * A0 + w1 * A1 + w2 * A2) / ws;
  // Pigments mixed on a roller sit between a dye's darkening and a plain
  // average of the inks, so a red and a blue blend to violet, not mud.
  vec3 T = (w0 * exp(-A0 * d) + w1 * exp(-A1 * d) + w2 * exp(-A2 * d)) / ws;
  return col * mix(exp(-A * d), T, 0.55);
}

float box(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// A sheet lying a hair above whatever is under it.
float lift(vec2 q){
  return 1.0 - 0.07 * exp(-max(box(q - vec2(0, 1.5), uHalf, 1.0), 0.0) / 5.0)
             - 0.035 * exp(-max(box(q - vec2(0, 8.0), uHalf, 8.0), 0.0) / 26.0);
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
    shade *= lift(qb);
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
      shade *= lift(q);
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

// Rasterise the word as wood type: each letter its own block, set tight,
// each sitting a hair off true, the line set to the head of the sheet.
function setForme(family, hw, hh, dpr) {
  const W = Math.round(hw * 2 * dpr);
  const H = Math.round(hh * 2 * dpr);
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const x = cv.getContext("2d", { willReadFrequently: true });
  const font = (px) => `400 ${px}px ${family}, Impact, "Arial Narrow", sans-serif`;
  x.font = font(100);
  const m = x.measureText(WORD);
  const cap = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  // Tracking by the law at this size, set as wood type is: near touching.
  const fitW = (hw * 2 * 0.86) / m.width;
  const fitH = (hh * 2 * 0.66) / cap;
  const size = 100 * Math.min(fitW, fitH);
  const track = -0.043 * (size - 12) * 0.12;
  x.font = font(size * dpr);
  const total = x.measureText(WORD).width + track * dpr * (WORD.length - 1);
  const mm = x.measureText(WORD);
  const ascent = mm.actualBoundingBoxAscent;
  const capH = mm.actualBoundingBoxAscent + mm.actualBoundingBoxDescent;
  const x0 = (W - total) / 2;
  // Set to the head of the sheet, tight under the top edge, so the head of
  // every proof in the run, showing above the next, carries type.
  const base = H * 0.05 + ascent;
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
    const px = x0 + x.measureText(WORD.slice(0, i)).width + track * dpr * i;
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
  const word = [0, (base - ascent + capH / 2) / dpr - hh, total / dpr / 2, capH / dpr / 2];
  return { W, H, out, word };
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

  // Press state. The run holds the proofs already pulled, newest first; each
  // eases from the bed into its place, one step further down the stack.
  const dirFrom = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  const start = Number.isFinite(qn) && qn > 0 ? qn : 4;
  const cur = { n: start, dir: dirFrom(Number.isFinite(qa) ? qa : 90), passing: false };
  // Each proof lands a few px off true and turned a little, the more so when
  // it was pulled from off centre.
  const landing = (n, spin) => ({
    rot: clamp(spin * 0.6 + (rnd(n * 7.1) - 0.5) * 0.045, -0.035, 0.035),
    jx: (rnd(n * 5.3) - 0.5) * 22,
  });
  // Each entry's slot s eases from where it was when the last proof was
  // pulled (s0) to its place in the run, over SHINGLE ms of wall clock.
  const run = [];
  for (let k = start - 1; k >= 1 && run.length < RUN; k--) {
    run.push({ n: k, dir: cur.dir, ...landing(k, 0), s: run.length + 1, s0: run.length + 1 });
  }
  let shingleT0 = -1e9;
  let prog01 = 1;
  let target = 1;
  let down = null; // { x, y, started }
  let released = true;
  let dirty = true;

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
    for (const e of run) e.s0 = e.s;
    run.unshift({ n: cur.n, dir: cur.dir, ...landing(cur.n, spin), s: 0, s0: 0 });
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

  let step = 0;
  stage.onResize((w, h, dpr) => {
    // The bed and the heads of the run under it make one block.
    const portrait = w / h < 1;
    const aspect = portrait ? 1 / 1.414 : 1.414;
    const tall = 1 + RUN * STEP;
    let sw = w * (portrait ? 0.84 : 0.6);
    let shh = sw / aspect;
    if (shh * tall > h * 0.9) {
      shh = (h * 0.9) / tall;
      sw = shh * aspect;
    }
    half = [Math.round(sw / 2), Math.round(shh / 2)];
    step = Math.round(half[1] * 2 * STEP);
    C = [w / 2, Math.round((h - (half[1] * 2 + RUN * step)) / 2 + RUN * step + half[1])];
    const f = setForme(family, half[0], half[1], dpr);
    word = f.word;
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
    // Shingle the run: each proof eases one step further down the stack.
    const st = (performance.now() - shingleT0) / SHINGLE;
    if (st < 1) {
      const e = 1 - Math.pow(1 - st, 3);
      run.forEach((r, i) => (r.s = r.s0 + (i + 1 - r.s0) * e));
      dirty = true;
    } else {
      run.forEach((r, i) => (r.s = i + 1));
      // The oldest is gone once the one above has slid over it.
      run.length = Math.min(run.length, RUN);
    }
    if (!dirty) return;
    dirty = false;

    const { width: w, height: h, dpr } = stage;
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
      // Leaving the bed it starts square under the fresh sheet; going under
      // the bottom of the run it squares up to the proof that covers it.
      let rot = e.rot * clamp(e.s, 0, 1);
      let jx = e.jx * clamp(e.s, 0, 1);
      if (i === RUN && run[RUN - 1]) {
        const f = clamp(e.s - RUN, 0, 1);
        rot += (run[RUN - 1].rot - rot) * f;
        jx += (run[RUN - 1].jx - jx) * f;
      }
      runT.set([jx, -Math.min(e.s, RUN) * step, rot, 0], i * 4);
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
