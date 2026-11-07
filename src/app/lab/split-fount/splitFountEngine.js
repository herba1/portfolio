import { createStage, clamp, damp } from "../_kit/stage";

// Split-fount inking on a proof press. Three inks sit side by side in one
// fountain; the oscillating roller smears their borders into a gradient that
// runs along the roller's axis, so across the direction of travel. Each pass
// pulls a proof: the last sheet is drawn off, the cylinder rolls a fresh one
// under the pointer, and the inks have mixed a little further on the roller,
// so the blends widen, wander and dull from proof to proof.
//
// The sheet is shaded per pixel: cream stock with fibre, a word mask (sharp,
// lightly blurred for ragged edges and the squeeze rim, broadly blurred for
// the impression), and ink as absorbance so mixed inks darken the way
// transparent inks do on paper.

const WORD = "PROOF";

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
// Old (top) sheet, being pulled off
uniform vec3 uB0, uB1, uB2;
uniform vec4 uOP; uniform vec4 uOQ;
uniform vec4 uOld;                              // offset xy, rotation, visible
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
  // How far the cylinder has rolled. Ink and impression exist behind it only.
  float printed = clamp(Q.z - along + 0.5, 0.0, 1.0);

  vec3 m = mask(l);
  // Impression: the type bit into the sheet. Shade the dent from the broad
  // blur's slope, lit from the upper left.
  float e = 1.5;
  float gx = mask(l + vec2(e, 0)).b - mask(l - vec2(e, 0)).b;
  float gy = mask(l + vec2(0, e)).b - mask(l - vec2(0, e)).b;
  col *= 1.0 - (gx + gy) * 0.16 * printed;

  // Ragged edge: threshold the light blur against noise, so the edge of the
  // ink wanders by a fraction of a pixel like ink on rag.
  float wob = (noise(l * 0.75 + seed) - 0.5) * 0.22 + (noise(l * 0.13 + seed * 0.3) - 0.5) * 0.14;
  float g = m.g + wob;
  float aa = max(fwidth(m.g), 0.002) * 0.9;
  float a = smoothstep(0.5 - aa, 0.5 + aa, g);
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
  // as salt: fine points, never blotches.
  float thin = clamp((0.93 - cov) * 5.0, 0.0, 1.0);
  float sp = noise(l * 1.6 + seed * 3.1) * 0.7 + noise(l * 3.3 - seed) * 0.3;
  float hole = smoothstep(0.8 - thin * 0.16, 0.84 - thin * 0.16, sp) * (1.0 - rim);
  float d = a * printed * cov * (1.0 - hole * 0.9) * (1.0 + rim * 0.45);

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

void main(){
  vec2 P = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;
  vec3 col;
  // Old sheet, in its own frame.
  vec2 qo = rot(-uOld.z) * (P - uC - uOld.xy);
  float dOld = box(qo, uHalf, 0.5);
  bool onOld = uOld.w > 0.5 && dOld < 0.5;
  float dNew = box(P - uC, uHalf, 0.5);
  if (onOld) {
    col = proof(qo + uHalf, uB0, uB1, uB2, uOP, uOQ);
    col *= mix(1.0, 0.94, smoothstep(-1.2, 0.5, dOld) * 0.5);
    col = mix(col, uGround, smoothstep(-0.5, 0.5, dOld) * 0.0);
  } else if (dNew < 0.5) {
    col = proof(P - uC + uHalf, uA0, uA1, uA2, uP, uQ);
    // The cylinder's shadow, just ahead of the nip while it rolls.
    if (uQ.w > 0.5) {
      float ahead = dot(P - uC, uQ.xy) - uQ.z;
      col *= 1.0 - 0.03 * smoothstep(0.0, 14.0, ahead) * exp(-max(ahead, 0.0) / 40.0);
    }
  } else {
    col = uGround;
    // The stack of sheets on the bed, a hair above it.
    col *= 1.0 - 0.07 * exp(-max(box(P - uC - vec2(0, 1.5), uHalf, 1.0), 0.0) / 5.0)
               - 0.035 * exp(-max(box(P - uC - vec2(0, 8.0), uHalf, 8.0), 0.0) / 26.0);
  }
  // The sheet being pulled away floats above everything else.
  if (uOld.w > 0.5 && !onOld) {
    vec2 qs = rot(-uOld.z) * (P - uC - uOld.xy - vec2(0, 6.0));
    float sd = box(qs, uHalf, 4.0);
    col *= 1.0 - 0.10 * exp(-max(sd, 0.0) / 16.0) - 0.05 * smoothstep(1.5, -1.0, sd);
  }
  if (dNew < 0.5 && dNew > -0.6 && !onOld) col *= 0.97;
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
// each sitting a hair off true.
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
  const base = H / 2 + ascent - capH / 2;
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

// Proof n's ink: the borders wander a little each pass and the blend widens
// as the inks work into each other on the roller, fast at first, then
// slower as the roller nears an even mix.
function proofInk(n) {
  const k = 1 - Math.exp(-(n - 1) / 6);
  let d1 = 0;
  let d2 = 0;
  for (let i = 1; i <= n; i++) {
    d1 = d1 * 0.8 + (rnd(i) - 0.5) * 0.06;
    d2 = d2 * 0.8 + (rnd(i + 91) - 0.5) * 0.06;
  }
  const b1 = -0.36 + d1 + k * 0.04;
  const b2 = 0.34 + d2 - k * 0.03;
  const w = 0.06 + 0.3 * k;
  const mixK = 0.55 * (1 - Math.exp(-(n - 1) / 10));
  const a0 = lerp3(A[0], A[1], mixK * 0.45);
  const a1 = lerp3(A[1], lerp3(A[0], A[2], 0.5), mixK * 0.35);
  const a2 = lerp3(A[2], A[1], mixK * 0.4);
  return { a: [a0, a1, a2], p: [b1, b2, w, rnd(n * 3.3) * 200] };
}

const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

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

  // Press state
  const dirFrom = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  const start = Number.isFinite(qn) && qn > 0 ? qn : 1;
  const cur = { n: start, dir: dirFrom(Number.isFinite(qa) ? qa : 90), front: 1e5, passing: false };
  let old = null; // { n, dir, t0, grab: torque sign, dist }
  let prog01 = 1;
  let target = 1;
  let down = null; // { x, y, started }
  let released = true;
  let dirty = true;

  const extent = (d) => Math.abs(d[0]) * half[0] * 2 + Math.abs(d[1]) * half[1] * 2;
  const frontAt = (p) => -extent(cur.dir) / 2 - 3 + p * (extent(cur.dir) + 6);

  if (held) {
    cur.n = start;
    cur.passing = true;
    prog01 = target = clamp(qt, 0, 1);
    released = false;
  }

  const beginPass = (dir, gx, gy) => {
    old = { n: cur.n, dir: cur.dir, front: 1e5, t0: performance.now(), dir2: dir, spin: 0 };
    // A sheet pulled from off centre turns a little as it goes.
    const cx = gx - C[0];
    const cy = gy - C[1];
    old.spin = clamp((cx * dir[1] - cy * dir[0]) / (half[0] + half[1]), -1, 1) * -0.05;
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
    const portrait = w / h < 1;
    const aspect = portrait ? 1 / 1.414 : 1.414;
    let sw = w * (portrait ? 0.84 : 0.7);
    let shh = sw / aspect;
    if (shh > h * 0.74) {
      shh = h * 0.74;
      sw = shh * aspect;
    }
    C = [w / 2, h / 2];
    half = [Math.round(sw / 2), Math.round(shh / 2)];
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

  const setProof = (ink, pre) => {
    gl.uniform3fv(U[pre[0] + "0"], ink.a[0]);
    gl.uniform3fv(U[pre[0] + "1"], ink.a[1]);
    gl.uniform3fv(U[pre[0] + "2"], ink.a[2]);
    gl.uniform4fv(U[pre[1]], ink.p);
  };

  stage.onFrame((dt) => {
    const now = performance.now();
    if (cur.passing && !held) {
      // The cylinder follows the hand with a little lag, and on release
      // rolls itself out with an ease-out.
      prog01 = damp(prog01, target, released ? 9 : 16, dt);
      if (released && prog01 > 0.998) commit();
      dirty = true;
    }
    let oldT = 0;
    if (old) {
      oldT = (now - old.t0) / 620;
      if (oldT >= 1) old = null;
      dirty = true;
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
    setProof(proofInk(cur.n), ["uA", "uP"]);
    gl.uniform4f(U.uQ, cur.dir[0], cur.dir[1], cur.passing ? frontAt(prog01) : 1e5, cur.passing ? 1 : 0);
    if (old) {
      setProof(proofInk(old.n), ["uB", "uOP"]);
      gl.uniform4f(U.uOQ, old.dir[0], old.dir[1], 1e5, 0);
      const e = easeOut(oldT);
      const dist = (w + h) * 1.1;
      gl.uniform4f(U.uOld, old.dir2[0] * dist * e, old.dir2[1] * dist * e, old.spin * e, 1);
    } else {
      gl.uniform4f(U.uOld, 0, 0, 0, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  });

  return {
    destroy() {
      stage.destroy();
    },
  };
}
