import { createStage, clamp } from "../_kit/stage";
import { readWebm } from "./webm";

// Datamosh: a video codec run live, so its reference frame can be lost.
//
// Nine seconds of a rail journey in two shots and a hard cut. Six seconds
// out of a train window on a summer afternoon: cumulus over a low belt of
// trees, wires and poles, then a stand of oaks running in from the right
// until their leaves fill the frame, all of it one lateral pan. Then three
// seconds down the line in winter, the track coming at the camera out of a
// vanishing point between pines: close, fast, and every vector radial. The
// clip ships twice over: once as a plain VP9 file (the pictures), and once
// as what an encoder would have written about it, a motion vector for every
// macroblock of every frame, found offline by block matching
// (tools/depth/bakes/datamosh/mv.py: 16x16 macroblocks split into 8x8
// partitions where that pays, half-pel vectors, a rate cost toward the
// neighbours' median, the zero vector where standing still does as well,
// intra where nothing matches).
//
// The browser then runs both halves of a codec, frame by frame, on the GPU.
//
// The encoder E predicts each frame from its own last reconstruction by
// moving every block along its vector, takes the residual against the real
// frame, puts it through an 8x8 DCT, quantises it with a dead zone (so
// most blocks whose prediction was good enough send nothing at all), and
// adds the dequantised residual back: a closed loop, with an I-frame (the
// plain picture) every three seconds and on the cut, where the encoder put
// its own keyframe, and intra blocks where the bake said so.
//
// The decoder D receives exactly what E sent: the I-frames, the vectors,
// the intra blocks and the quantised residuals, and rebuilds the picture
// from its own last frame. While nothing goes wrong D is E, bit for bit.
// It is starved one macroblock at a time, under the hand. A starved block
// gets no intra blocks: each intra block is turned into an inter block
// along the median of its neighbours' vectors, the way a datamosher strips
// them (ffglitch's mb_type rewrite, Murata's I-frame and intra removal), so
// the error stays one continuous smear instead of squares of the true
// picture. Until the next I-frame its P-frames still arrive whole, residual
// and all, so the picture under the hand stays itself; that I-frame never
// arrives, and from then on the block gets no residual and no new vectors
// either and repeats one P-frame, the classic P-frame duplication: the
// first P-frame after the lost I-frame, every 8x8 partition keeping its
// own vector, applied to the block's own moshed picture frame after frame,
// read in whole pels, nearest, with no half-pel filter (see mcHeld), so the
// smear stays hard-edged however long the hold runs. Whatever sits near the
// centre of that frame's motion is dragged out along its rays again and
// again into long stepped streaks. One block past the starved ones the
// edge of the tear repeats the same P-frame but still takes the I-frame,
// so the new shot is torn into the strips there and the strips out across
// it. Every other block is fed and decodes the true frame, so the mosh is a
// tear in an intact picture.
//
// It tunes in the way a set joins a broadcast: between I-frames, with no
// picture. Until the first I-frame arrives (three seconds) it builds what it
// can on blank paper from the vectors and the residuals, so only what
// moves or changes appears: the tree line, the fence, a pole, set into the
// paper.
//
// Press and drag and the hand paints a mask of starved macroblocks, a soft
// brush a few blocks across dragged along its path, each block tearing at
// its own level so the edge breaks raggedly on the grid. Under it the
// next I-frame does not arrive, and after it nothing but one P-frame's
// vectors. In the first shot they still fit the picture they move, so the
// tear barely shows. The real event is the cut. Its I-frame (and the loop
// seam's, the cut back) is the one that matters to drop: the winter shot
// arrives everywhere else, while inside the stroke the first winter
// P-frame is latched and repeated, its radial vectors finding nothing of
// their own to move and pushing the summer picture instead: the oak
// branches and the sky between them by the vanishing point are pulled out
// of it, a little further every frame, in long stepped radial streaks on
// the macroblock grid that run from the intact leaves out into strip. And while the hand stays down the tear spreads the way
// the smear does, downstream along the vectors, fastest where the picture
// moves fastest: a held stroke blooms outward over seconds until it has
// taken most of the ground below the vanishing point, while the sky and
// the verges it has not reached stay whole around it. How long the hand
// holds is how far it has gone. Over the seam it runs the other way. Drag
// while holding and the clip is fed faster than real time, so it reaches
// the cut sooner. Let go and the mask fades from its edges in; a block fed
// again carries its mosh along the true vectors (an honest decode of a
// damaged reference) until a column of intra blocks sweeps the macroblock
// columns, as a periodic intra refresh does, and it is clean behind it.
//
// Query (stills): ?t=seconds stops the stream at that clip time (decoded
// frame by frame from the start, as fast as it can); ?hold=seconds holds it
// for that long before t; ?release=seconds lets go that long before t (the
// refresh mid-sweep); ?join=1 shows the opening (?join=0 skips it live);
// ?qp= sets the encoder's quantiser. A still's hold paints a fixed stroke
// (STROKE) down the lower third, out of the vanishing point both ways.
// ?t=8&hold=4 holds it over the cut (6 s): the hero still; ?t=6.3&hold=0.6
// is the cut a moment after.

const ASSET = "/lab/datamosh/";
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
const GOP = 90; // frames between I-frames (the cut, frame 180, is one too)
const QP0 = 30; // encoder quantiser (H.264 scale)
const FOE_C = 0.01; // a frozen field diverging faster than this per px is a zoom, weighted by REACH
const REACH = 500; // px from the centre of the motion at which a frozen vector steps at its own length
// (the weight grows with the square of the distance: a quarter of it at half the reach)
const REACH_MAX = 1.3; // and at most this many times it
const GROW = 0.3; // spread of the starved field per frame, per 16 px of vector
const GROW_MAX = 0.5; // and at most this much of the upstream block's level
const REFRESH = 14; // frames for the intra refresh to sweep the picture
const BRUSH = 6; // brush radius, macroblocks (about five torn across)
const FADE = 1.6; // s: time constant of the starved mask once the hand lifts
// The hero stroke a still paints while its hold runs: a V through the lower
// third, up from the fence at the left to the winter shot's vanishing point
// (0.385, 0.33) and down again to the fence at the right, both arms along
// the streamlines of its vectors (traced back from the bottom edge through
// the mean field of the first two seconds), where they run longest (frame
// fractions, top-left origin). Under it at the cut is the oak stand, leaves
// and the sky between them, so the vectors drag high-frequency texture into
// the strips. A stroke that stops short of the vanishing point tears
// nothing that lasts: its vectors pull the true winter picture in from
// behind it within a few frames, and in this stretch of track the whole
// field drifts down a little as the line crests, so even the ground just
// under the vanishing point is fed from above it. The apex has to sit on
// the vanishing point, where nothing moves, so the leaves there are the
// ones that run.
const STROKE = [
  [0.05, 0.95],
  [0.2, 0.68],
  [0.32, 0.44],
  [0.385, 0.33],
  [0.45, 0.44],
  [0.58, 0.68],
  [0.74, 0.95],
];
const STROKE_S = 0.3; // s the still's hand takes to draw it

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main() { gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0); }`;

const COMMON = `#version 300 es
precision highp float;
precision highp int;
vec3 toYcc(vec3 c) {
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return vec3(y, (c.b - y) / 1.8556, (c.r - y) / 1.5748);
}
vec3 toRgb(vec3 v) {
  return vec3(v.x + 1.5748 * v.z, v.x - 0.1873 * v.y - 0.4681 * v.z, v.x + 1.8556 * v.y);
}
`;

// motion compensation: the 8x8 partition's vector (half-pel), read the way
// H.264 reads its reference: whole-pel positions exactly, half-pel ones
// through the six-tap filter (1, -5, 20, 20, -5, 1) / 32, the centre
// position through it twice; edges extended. A bilinear read would soften
// the picture a little every frame, and a held picture is read hundreds of
// times.
const MC = `
uniform sampler2D uMv;   // 160x90: mode, dx, dy (half-pel)
vec4 mvAt(vec2 p) { return texelFetch(uMv, ivec2(floor(p / 8.0)), 0); }
const float TAP[6] = float[6](1.0, -5.0, 20.0, 20.0, -5.0, 1.0);
vec3 px(sampler2D ref, ivec2 q) {
  return texelFetch(ref, clamp(q, ivec2(0), textureSize(ref, 0) - 1), 0).rgb;
}
vec3 hrow(sampler2D ref, ivec2 q) {
  vec3 a = vec3(0.0);
  for (int k = 0; k < 6; k++) a += TAP[k] * px(ref, q + ivec2(k - 2, 0));
  return a / 32.0;
}
vec3 mc(sampler2D ref, vec2 p, vec4 m) {
  ivec2 v = ivec2(m.yz);
  ivec2 q = ivec2(floor(p)) + (v >> 1);   // floor division by 2
  ivec2 h = v & 1;                          // half-pel phase
  if (h.x == 0 && h.y == 0) return px(ref, q);
  if (h.y == 0) return hrow(ref, q);
  vec3 a = vec3(0.0);
  for (int k = 0; k < 6; k++) {
    ivec2 r = q + ivec2(0, k - 2);
    a += TAP[k] * (h.x == 1 ? hrow(ref, r) : px(ref, r));
  }
  return a / 32.0;
}
// A held decoder duplicates one P-frame instead, the way a datamosher
// does: each starved partition keeps the vector it latched (see below) and
// applies it again on every frame of the hold, a whole-pel copy out of its
// own moshed picture, nearest, no filter, no residual. The vector is kept
// fractional and each partition carries its own rounding remainder from
// frame to frame (error diffusion), so a 0.4 px vector moves a whole pixel
// two frames in five, always the same way, and every pixel of the
// partition steps together: what it drags is pulled out into one long
// stepped streak instead of being dithered back and forth by half-pels
// rounded alternately up and down. Copied whole, the
// photo's grain and the 16x16 and 8x8 block edges stay as sharp on the
// three hundredth frame as on the first, and where two partitions' vectors
// part, the column or row between them is drawn out again every frame.
// A vector that reaches past the frame edge is read mirrored back into the
// picture, not edge-extended: an edge-extended copy repeats the last row or
// column, and a held block re-reading it every frame combs out into
// one-pixel streaks along the edge.
uniform sampler2D uLatch;   // 160x90: the latched vector (px), this frame's whole-pel step
ivec2 mirror(ivec2 q, ivec2 n) {
  q = ivec2(q.x < 0 ? -q.x - 1 : q.x, q.y < 0 ? -q.y - 1 : q.y);   // -1 -> 0, -2 -> 1
  q = ivec2(q.x >= n.x ? 2 * n.x - 1 - q.x : q.x, q.y >= n.y ? 2 * n.y - 1 - q.y : q.y);
  return clamp(q, ivec2(0), n - 1);
}
vec3 mcHeld(sampler2D ref, vec2 p) {
  ivec2 q = ivec2(floor(p)) + ivec2(texelFetch(uLatch, ivec2(floor(p / 8.0)), 0).zw);
  return texelFetch(ref, mirror(q, textureSize(ref, 0)), 0).rgb;
}
`;

// residual against the encoder's own prediction
const RESID_FS = `${COMMON}${MC}
uniform sampler2D uSrc;   // the decoded frame, RGB
uniform sampler2D uE;     // encoder reconstruction, YCbCr
out vec4 o;
void main() {
  vec2 p = gl_FragCoord.xy;
  vec4 m = mvAt(p);
  vec3 s = toYcc(texelFetch(uSrc, ivec2(p), 0).rgb);
  o = vec4(s - mc(uE, p, m), 1.0);
}`;

const DCT_TABLE = (() => {
  const v = [];
  for (let u = 0; u < 8; u++) for (let k = 0; k < 8; k++) v.push(((u === 0 ? Math.SQRT1_2 : 1) * 0.5 * Math.cos(((2 * k + 1) * u * Math.PI) / 16)).toFixed(8));
  return `const float CT[64] = float[64](${v.join(", ")});`;
})();

// separable 8x8 DCT-II (orthonormal). uDir: 0 rows, 1 columns.
// uInv: inverse. uQuant: quantise the coefficients after this pass.
const DCT_FS = `${COMMON}
uniform sampler2D uIn;
uniform int uDir;
uniform int uInv;
uniform int uQuant;
uniform vec3 uStep;      // Y, Cb, Cr quantiser step (0..1 scale)
out vec4 o;
// CT[u * 8 + k] = a(u) cos((2k + 1) u pi / 16)
${DCT_TABLE}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int i = uDir == 0 ? p.x : p.y;
  int base = i - (i & 7);
  int u = i & 7;
  vec3 acc = vec3(0.0);
  for (int k = 0; k < 8; k++) {
    ivec2 q = uDir == 0 ? ivec2(base + k, p.y) : ivec2(p.x, base + k);
    float w = uInv == 0 ? CT[u * 8 + k] : CT[k * 8 + u];
    acc += w * texelFetch(uIn, q, 0).rgb;
  }
  if (uQuant == 1) {
    // dead-zone quantiser (H.264's inter rounding: 1/6), then dequantise
    vec3 l = floor(abs(acc) / uStep + 1.0 / 6.0);
    acc = sign(acc) * l * uStep;
  }
  o = vec4(acc, 1.0);
}`;

// the step: encoder and decoder reconstructions, side by side (MRT)
//
// The decoder is starved one macroblock at a time. uState holds, per
// macroblock, what reaches it this frame: 0 fed (it decodes the true
// frame, the encoder's reconstruction), 1 fed again after being starved
// (it decodes honestly from its own picture, so the damage drifts along the
// true vectors until an intra block, an I-frame or the refresh column
// reaches it), 2 starved (no I-frame, no intra blocks, no
// residual: one latched P-frame duplicated, see mcHeld), 3 the edge of the
// starved field, one macroblock wide (the I-frame lands, then the same
// duplicated P-frame as its starved neighbours), so the tear has no clean
// cut-out edge: the winter picture is dragged into the strips from it and
// the strips are dragged out across it.
const STEP_FS = `${COMMON}${MC}
uniform sampler2D uSrc;
uniform sampler2D uE;
uniform sampler2D uD;
uniform sampler2D uRes;     // dequantised residual
uniform sampler2D uState;   // MW x MH: x 0 fed, 1 drifting, 2 starved, 3 edge, 4 held, waiting
uniform int uIframe;        // this frame is an I-frame
uniform int uJoin;          // the decoder has not had an I-frame yet
uniform float uRefresh;     // macroblock columns refreshed (intra), 0..80
layout(location=0) out vec4 oE;
layout(location=1) out vec4 oD;
void main() {
  vec2 p = gl_FragCoord.xy;
  vec4 m = mvAt(p);
  vec3 s = toYcc(texelFetch(uSrc, ivec2(p), 0).rgb);
  vec3 r = texelFetch(uRes, ivec2(p), 0).rgb;
  bool intra = m.x > 1.5;
  vec3 e = (uIframe == 1 || intra) ? s : mc(uE, p, m) + r;
  e = clamp(e, vec3(0.0, -0.5, -0.5), vec3(1.0, 0.5, 0.5));
  vec4 st = texelFetch(uState, ivec2(floor(p / 16.0)), 0);
  int state = int(st.x + 0.5);
  bool fresh = floor(p.x / 16.0) < uRefresh;
  vec3 d;
  if (uJoin == 1) {
    // tuning in: vectors and residuals onto paper, intra stripped, until the
    // first I-frame arrives
    d = uIframe == 1 ? texelFetch(uD, ivec2(p), 0).rgb : mc(uD, p, m) + (intra ? vec3(0.0) : r);
  } else if (state == 2) {
    // starved: the I-frame never arrives (the block keeps its old picture),
    // and every other frame is the latched P-frame again, a whole-pel copy
    // of the moshed picture along the frozen vector with no residual
    d = uIframe == 1 ? texelFetch(uD, ivec2(p), 0).rgb : mcHeld(uD, p);
  } else if (state == 4) {
    // held, but no I-frame missed yet: the P-frames still arrive whole,
    // residual and all, only stripped of their intra blocks, so the picture
    // under the hand stays itself until the I-frame it will lose
    d = mc(uD, p, m) + r;
  } else if (state == 3) {
    // the edge of the tear: the I-frame lands, nothing else does; every
    // other frame repeats the latched P-frame out of the moshed picture
    d = uIframe == 1 ? e : mcHeld(uD, p);
  } else if (state == 1) {
    // fed again, still carrying the mosh: an honest decode drifts it along
    // the true vectors until something intra lands on it
    d = (uIframe == 1 || intra || fresh) ? e : mc(uD, p, m) + r;
  } else {
    d = e;
  }
  d = clamp(d, vec3(0.0, -0.5, -0.5), vec3(1.0, 0.5, 0.5));
  oE = vec4(e, 1.0);
  oD = vec4(d, 1.0);
}`;

const SHOW_FS = `${COMMON}
uniform sampler2D uD;
uniform vec4 uPrint;     // device px: x, y, w, h (top-left origin)
uniform float uCanvasH;
uniform vec3 uPaper;
uniform float uOn;
out vec4 o;
void main() {
  vec2 dpx = vec2(gl_FragCoord.x, uCanvasH - gl_FragCoord.y);
  vec2 l = (dpx - uPrint.xy) / uPrint.zw;
  if (any(lessThan(l, vec2(0.0))) || any(greaterThanEqual(l, vec2(1.0)))) { o = vec4(uPaper, 1.0); return; }
  // sharp bilinear: each codec pixel is a flat square on the print, blended
  // only across its own edge, so block edges stay hard at any print scale
  vec2 sz = vec2(textureSize(uD, 0));
  vec2 t = l * sz - 0.5;
  vec2 k = clamp((fract(t) - 0.5) * (uPrint.zw / sz) + 0.5, 0.0, 1.0);
  vec3 c = toRgb(texture(uD, (floor(t) + 0.5 + k) / sz).rgb);
  o = vec4(mix(uPaper, clamp(c, 0.0, 1.0), uOn), 1.0);
}`;

function compile(gl, vs, fs) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link");
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

// ---- the vectors, as mv.py packed them: per frame one mode per macroblock
// (0 one vector, 1 four 8x8 vectors, 2 intra), then every vector as a
// difference from the median of its left, top and top-right neighbours'
// first vectors, int16 split into low and high byte planes.
async function readVectors(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  let buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    buf = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== "DMV2") throw new Error("datamosh: vectors");
  const MW = dv.getUint16(4, true);
  const MH = dv.getUint16(6, true);
  const N = dv.getUint16(8, true);
  const fps = dv.getUint16(10, true) / 100;
  const K = dv.getUint32(12, true);
  const modes = buf.subarray(16, 16 + N * MW * MH);
  const at = 16 + N * MW * MH;
  const lx = buf.subarray(at, at + K);
  const ly = buf.subarray(at + K, at + 2 * K);
  const hx = buf.subarray(at + 2 * K, at + 3 * K);
  const hy = buf.subarray(at + 3 * K, at + 4 * K);
  const s16 = (lo, hi) => ((hi << 8) | lo) << 16 >> 16;
  // where each frame's vectors start
  const start = new Uint32Array(N + 1);
  for (let f = 0, k = 0; f < N; f++) {
    start[f] = k;
    const m = modes.subarray(f * MW * MH, (f + 1) * MW * MH);
    for (let i = 0; i < m.length; i++) k += m[i] === 0 ? 1 : m[i] === 1 ? 4 : 0;
    start[f + 1] = k;
  }
  const GW = MW * 2;
  const fx = new Int16Array(MW * MH);
  const fy = new Int16Array(MW * MH);
  // unpack frame f into an RGBA float field on the 8x8 grid
  const unpack = (f, out) => {
    const m = modes.subarray(f * MW * MH, (f + 1) * MW * MH);
    let k = start[f];
    const med = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
    for (let j = 0; j < MH; j++) {
      for (let i = 0; i < MW; i++) {
        const id = j * MW + i;
        const mode = m[id];
        let vx = [0, 0, 0, 0];
        let vy = [0, 0, 0, 0];
        if (mode !== 2) {
          const ok = (jj, ii) => jj >= 0 && ii >= 0 && ii < MW && m[jj * MW + ii] !== 2;
          const ax = ok(j, i - 1) ? fx[id - 1] : 0;
          const ay = ok(j, i - 1) ? fy[id - 1] : 0;
          const bx = ok(j - 1, i) ? fx[id - MW] : 0;
          const by = ok(j - 1, i) ? fy[id - MW] : 0;
          const cx = ok(j - 1, i + 1) ? fx[id - MW + 1] : 0;
          const cy = ok(j - 1, i + 1) ? fy[id - MW + 1] : 0;
          const px = med(ax, bx, cx);
          const py = med(ay, by, cy);
          const parts = mode === 0 ? 1 : 4;
          for (let q = 0; q < parts; q++, k++) {
            vx[q] = px + s16(lx[k], hx[k]);
            vy[q] = py + s16(ly[k], hy[k]);
          }
          if (parts === 1) {
            vx = [vx[0], vx[0], vx[0], vx[0]];
            vy = [vy[0], vy[0], vy[0], vy[0]];
          }
          fx[id] = vx[0];
          fy[id] = vy[0];
        }
        // partitions in order TL, TR, BL, BR
        for (let q = 0; q < 4; q++) {
          const o = (((j * 2 + (q >> 1)) * GW) + i * 2 + (q & 1)) * 4;
          out[o] = mode;
          out[o + 1] = vx[q];
          out[o + 2] = vy[q];
          out[o + 3] = 0;
        }
      }
    }
    conceal(m, out);
  };
  // Every intra macroblock also gets a vector of its own, the way a mosher
  // strips intra blocks out of a P-frame (ffglitch's mb_type rewrite): the
  // component-wise median of its eight neighbours' partition vectors, filled
  // inward over clusters of intra blocks, zero (a skip) where there is
  // nothing around it to borrow. A decoder that is being fed honestly never
  // reads it; a held one predicts the block from its own picture along it.
  const done = new Uint8Array(MW * MH);
  const xs = [];
  const ys = [];
  const median = (a) => {
    a.sort((p, q) => p - q);
    const h = a.length >> 1;
    return a.length & 1 ? a[h] : Math.round((a[h - 1] + a[h]) / 2);
  };
  const conceal = (m, out) => {
    let left = 0;
    for (let id = 0; id < MW * MH; id++) {
      done[id] = m[id] === 2 ? 0 : 1;
      if (!done[id]) left++;
    }
    for (let pass = 0; left > 0 && pass < 12; pass++) {
      const filled = [];
      for (let j = 0; j < MH; j++) {
        for (let i = 0; i < MW; i++) {
          if (done[j * MW + i]) continue;
          xs.length = 0;
          ys.length = 0;
          for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
              const jj = j + dj;
              const ii = i + di;
              if ((!di && !dj) || jj < 0 || ii < 0 || jj >= MH || ii >= MW || !done[jj * MW + ii]) continue;
              for (let q = 0; q < 4; q++) {
                const o = (((jj * 2 + (q >> 1)) * GW) + ii * 2 + (q & 1)) * 4;
                xs.push(out[o + 1]);
                ys.push(out[o + 2]);
              }
            }
          }
          if (xs.length) filled.push(j * MW + i, median(xs), median(ys));
        }
      }
      if (!filled.length) break;
      for (let k = 0; k < filled.length; k += 3) {
        const id = filled[k];
        const i = id % MW;
        const j = (id - i) / MW;
        for (let q = 0; q < 4; q++) {
          const o = (((j * 2 + (q >> 1)) * GW) + i * 2 + (q & 1)) * 4;
          out[o + 1] = filled[k + 1];
          out[o + 2] = filled[k + 2];
        }
        done[id] = 1;
        left--;
      }
    }
  };
  return { MW, MH, GW, GH: MH * 2, N, fps, unpack };
}

// ---- the stream: VP9 chunks fed to WebCodecs in order, looped, with a short
// queue of decoded frames waiting for the codec clock
function openStream(webm, config, onError) {
  const queue = [];
  let fed = 0;
  let closed = false;
  const decoder = new VideoDecoder({
    output: (frame) => {
      if (closed) frame.close();
      else queue.push(frame);
    },
    error: (e) => onError(e),
  });
  decoder.configure(config);
  const n = webm.frames.length;
  const pump = (ahead = 6) => {
    while (!closed && queue.length + decoder.decodeQueueSize < ahead) {
      const i = fed % n;
      const f = webm.frames[i];
      // VP9 keyframes as the muxer flagged them: libvpx put one on the cut
      decoder.decode(new EncodedVideoChunk({ type: i === 0 || f.key ? "key" : "delta", timestamp: fed * 1000, data: f.data }));
      fed++;
    }
  };
  return {
    queue,
    pump,
    close() {
      closed = true;
      for (const f of queue) f.close();
      queue.length = 0;
      try {
        decoder.close();
      } catch {
        /* already closed */
      }
    },
  };
}

export async function createDatamosh(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const num = (k) => {
    const v = q.get(k);
    return v != null && v !== "" && Number.isFinite(+v) ? +v : null;
  };
  const stillT = num("t");
  const holdQ = num("hold");
  const releaseQ = num("release");
  const qp = num("qp") ?? QP0;

  host.style.background = `rgb(${PAPER.map((c) => Math.round(c * 255)).join(",")})`;
  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");
  if (!gl.getExtension("EXT_color_buffer_float") && !gl.getExtension("EXT_color_buffer_half_float")) throw new Error("datamosh: no float targets");
  if (typeof VideoDecoder === "undefined") throw new Error("datamosh: no WebCodecs");

  const [mv, webmBuf] = await Promise.all([
    readVectors(`${ASSET}clip.mv`),
    fetch(`${ASSET}clip.webm`).then((r) => {
      if (!r.ok) throw new Error(`clip.webm: ${r.status}`);
      return r.arrayBuffer();
    }),
  ]);
  const webm = readWebm(webmBuf);
  const vp9 = { codec: "vp09.00.40.08", codedWidth: webm.width, codedHeight: webm.height };
  const ok = await VideoDecoder.isConfigSupported(vp9).catch(() => ({ supported: false }));
  if (!ok.supported) throw new Error("datamosh: no VP9 decoder");
  const W = webm.width;
  const H = webm.height;
  const N = Math.min(mv.N, webm.frames.length);
  const FPS = mv.fps;

  // ---- GL resources
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  const tex = (internal, w, h, filter) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const F16 = gl.RGBA16F;
  const srcTex = tex(gl.RGBA8, W, H, gl.NEAREST);
  const mvTex = tex(gl.RGBA32F, mv.GW, mv.GH, gl.NEAREST);
  const E = [tex(F16, W, H, gl.LINEAR), tex(F16, W, H, gl.LINEAR)];
  const D = [tex(F16, W, H, gl.LINEAR), tex(F16, W, H, gl.LINEAR)];
  const R = [tex(F16, W, H, gl.NEAREST), tex(F16, W, H, gl.NEAREST)];
  const mvField = new Float32Array(mv.GW * mv.GH * 4);
  const MW = mv.MW;
  const MH = mv.MH;
  const stateTex = tex(gl.RGBA32F, MW, MH, gl.NEAREST);
  const stateField = new Float32Array(MW * MH * 4);
  const latchTex = tex(gl.RGBA32F, mv.GW, mv.GH, gl.NEAREST);
  const latchField = new Float32Array(mv.GW * mv.GH * 4);

  const fbos = new Map();
  let texIds = 0;
  const idOf = (t) => (t ? (t.dmId ??= ++texIds) : 0);
  const target = (a, b) => {
    const key = `${idOf(a)}:${idOf(b)}`;
    let f = fbos.get(key);
    if (f) return f;
    f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, a, 0);
    if (b) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, b, 0);
    gl.drawBuffers(b ? [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1] : [gl.COLOR_ATTACHMENT0]);
    fbos.set(key, f);
    return f;
  };

  const resid = compile(gl, QUAD_VS, RESID_FS);
  const dct = compile(gl, QUAD_VS, DCT_FS);
  const step = compile(gl, QUAD_VS, STEP_FS);
  const show = compile(gl, QUAD_VS, SHOW_FS);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const bindTex = (prog, unit, t, name) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(prog.u[name], unit);
  };
  const draw = (fbo, w, h) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  // H.264's step size, 0.625 * 2^(QP / 6) on the 8-bit scale; chroma a
  // little coarser, as its QP table runs ahead of luma's
  const qstep = (qpv) => (0.625 * 2 ** (qpv / 6)) / 255;
  const steps = [qstep(qp), qstep(qp + 3), qstep(qp + 3)];

  // ---- one frame through the codec
  let cur = 0; // E[cur], D[cur] hold the last reconstruction
  const codecStep = (idx, { iframe, join, refresh }) => {
    gl.bindTexture(gl.TEXTURE_2D, mvTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, mv.GW, mv.GH, gl.RGBA, gl.FLOAT, mvField);
    gl.bindTexture(gl.TEXTURE_2D, latchTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, mv.GW, mv.GH, gl.RGBA, gl.FLOAT, latchField);
    gl.bindTexture(gl.TEXTURE_2D, stateTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MW, MH, gl.RGBA, gl.FLOAT, stateField);
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    // residual against the encoder's prediction
    gl.useProgram(resid.p);
    bindTex(resid, 0, srcTex, "uSrc");
    bindTex(resid, 1, E[cur], "uE");
    bindTex(resid, 2, mvTex, "uMv");
    draw(target(R[0], null), W, H);
    // DCT rows, columns (+ quantise), inverse columns, inverse rows
    gl.useProgram(dct.p);
    gl.uniform3f(dct.u.uStep, steps[0], steps[1], steps[2]);
    const pass = (from, to, dir, inv, quant) => {
      bindTex(dct, 0, R[from], "uIn");
      gl.uniform1i(dct.u.uDir, dir);
      gl.uniform1i(dct.u.uInv, inv);
      gl.uniform1i(dct.u.uQuant, quant);
      draw(target(R[to], null), W, H);
    };
    pass(0, 1, 0, 0, 0);
    pass(1, 0, 1, 0, 1);
    pass(0, 1, 1, 1, 0);
    pass(1, 0, 0, 1, 0);
    // reconstruct, encoder and decoder
    const nxt = 1 - cur;
    gl.useProgram(step.p);
    bindTex(step, 0, srcTex, "uSrc");
    bindTex(step, 1, E[cur], "uE");
    bindTex(step, 2, D[cur], "uD");
    bindTex(step, 3, R[0], "uRes");
    bindTex(step, 4, mvTex, "uMv");
    bindTex(step, 5, stateTex, "uState");
    bindTex(step, 6, latchTex, "uLatch");
    gl.uniform1i(step.u.uIframe, iframe ? 1 : 0);
    gl.uniform1i(step.u.uJoin, join ? 1 : 0);
    gl.uniform1f(step.u.uRefresh, refresh);
    draw(target(E[nxt], D[nxt]), W, H);
    cur = nxt;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  };

  // ---- layout
  let L = null;
  const layout = () => {
    const w = stage.width;
    const h = stage.height;
    const dpr = stage.dpr;
    const narrow = w < 700;
    const margin = Math.max(16, Math.min(w, h) * (narrow ? 0.04 : 0.09));
    const printW = Math.min(w - margin * 2, (h - margin * 2) * (W / H));
    const pw = Math.round(printW * dpr);
    const ph = Math.round((printW * H * dpr) / W);
    return { pw, ph, px: Math.round((w * dpr - pw) / 2), py: Math.round((h * dpr - ph) / 2) };
  };
  stage.onResize(() => {
    L = layout();
  });

  let on = 0;
  const present = () => {
    if (!L) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.bindVertexArray(vao);
    gl.useProgram(show.p);
    bindTex(show, 0, D[cur], "uD");
    gl.uniform4f(show.u.uPrint, L.px, L.py, L.pw, L.ph);
    gl.uniform1f(show.u.uCanvasH, stage.canvas.height);
    gl.uniform3f(show.u.uPaper, PAPER[0], PAPER[1], PAPER[2]);
    gl.uniform1f(show.u.uOn, on);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  };

  // ---- the stream and the clock
  let failed = null;
  const stream = openStream(webm, vp9, (e) => {
    failed = e;
    console.warn("datamosh: decoder", e);
  });
  stream.pump();

  let seq = 0; // frames through the codec
  let acc = 0;
  let press = false;
  let refreshAt = -1; // frame the running refresh sweep began, -1 none
  const still = stillT != null;
  const stopAt = still ? Math.max(1, Math.round(stillT * FPS)) : Infinity;
  const holdFrom = still && holdQ != null ? stopAt - Math.round(holdQ * FPS) : Infinity;
  const releaseFrom = still && releaseQ != null ? stopAt - Math.round(releaseQ * FPS) : Infinity;
  // The decoder joins the stream the way a set tunes into a broadcast: with
  // no picture, between I-frames. Until the first one arrives it builds what
  // it can from paper, the vectors and the residuals.
  const joinQ = q.get("join");
  let joining = still ? joinQ === "1" : joinQ !== "0";
  const warmFrom = still && !joining ? Math.max(0, Math.min(stopAt, holdFrom) - 4) : 0;
  if (joining) {
    const y = 0.2126 * PAPER[0] + 0.7152 * PAPER[1] + 0.0722 * PAPER[2];
    const paperYcc = new Float32Array([y, (PAPER[2] - y) / 1.8556, (PAPER[0] - y) / 1.5748, 1]);
    for (const t of D) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target(t, null));
      gl.clearBufferfv(gl.COLOR, 0, paperYcc);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---- the starved mask: one value per macroblock, painted by the hand while
  // it is held (a soft brush dragged along its path), fading after it lifts
  const mask = new Float32Array(MW * MH);
  const age = new Uint16Array(MW * MH);
  const dirty = new Uint8Array(MW * MH);
  // each block starves at its own level, so the edge of a stroke tears
  // raggedly along the macroblock grid instead of tracing a smooth outline
  const thresh = new Float32Array(MW * MH);
  for (let id = 0; id < MW * MH; id++) {
    const h = Math.sin(id * 12.9898 + 78.233) * 43758.5453;
    thresh[id] = 0.3 + 0.32 * (h - Math.floor(h));
  }
  const stamp = (cx, cy) => {
    const r = BRUSH;
    for (let j = Math.max(0, Math.floor(cy - r)); j < Math.min(MH, Math.ceil(cy + r)); j++) {
      for (let i = Math.max(0, Math.floor(cx - r)); i < Math.min(MW, Math.ceil(cx + r)); i++) {
        const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cy) / r;
        if (d >= 1) continue;
        const v = 1 - d * d * (3 - 2 * d);
        const id = j * MW + i;
        if (v > mask[id]) mask[id] = v;
      }
    }
  };
  let brushLast = null;
  const paintTo = (pt) => {
    if (!pt) return;
    const from = brushLast ?? pt;
    const n = Math.max(1, Math.ceil(Math.hypot(pt[0] - from[0], pt[1] - from[1]) / 0.5));
    for (let k = 1; k <= n; k++) stamp(from[0] + ((pt[0] - from[0]) * k) / n, from[1] + ((pt[1] - from[1]) * k) / n);
    brushLast = pt;
  };
  // the pointer, in macroblocks
  const brushAt = () => {
    if (!L) return null;
    const p = stage.pointer;
    return [((p.x * stage.dpr - L.px) / L.pw) * MW, ((p.y * stage.dpr - L.py) / L.ph) * MH];
  };
  // the still's stroke, drawn as far as k (0..1) along its length
  const paintPath = (path, k) => {
    const pts = path.map(([x, y]) => [x * MW, y * MH]);
    const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
    let left = k * lens.reduce((a, b) => a + b, 0);
    brushLast = null;
    paintTo(pts[0]);
    for (let i = 0; i < lens.length && left > 0; i++) {
      const f = Math.min(1, left / lens[i]);
      paintTo([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]);
      left -= lens[i];
    }
  };

  // The P-frame a starved block duplicates. Until it misses an I-frame it
  // follows the stream's own vectors (still a whole-pel copy with no
  // residual); the first I-frame it misses is the one a datamosher deletes,
  // and from then on it repeats the P-frame after it, exactly: each 8x8
  // partition keeps its own vector from that one frame, at full magnitude,
  // with no averaging over frames and no smoothing between neighbours, so
  // the field keeps the radial divergence that pulls one partition away
  // from the next. Averaged or median-filtered, neighbouring partitions
  // step nearly alike, their copies chase each other round and the picture
  // compounds into a uniform mottle; left as encoded, each partition reads
  // a little further in toward the centre of the motion than the one inside
  // it, so whatever sits near that centre is copied out along its ray again
  // every frame, one partition further each time, and is pulled out into a
  // long stepped streak that still carries the picture it came from: a
  // trunk stays a dark ray, a gap of sky a pale one. Intra blocks have
  // their concealed vector here.
  //
  // The frozen field is also weighted by distance from the centre of its
  // own motion (the point the frame's vectors diverge from, fitted to the
  // field: see foeOf), so the outer partitions step further each frame than
  // the encoder's vector alone would take them and the inner ones hardly at
  // all. What is near the centre stays itself; further out the same
  // content is drawn out faster than it is fed, so a ray thins from intact
  // picture into strip with distance, the way the street in ref 2 grades
  // from the photo into its smear. A field with no centre (the summer pan,
  // over the seam) is left at its own magnitude.
  const latched = new Uint8Array(MW * MH);
  const starved = new Uint8Array(MW * MH);
  const frozen = new Uint8Array(MW * MH);
  const latchRaw = new Float32Array(mv.GW * mv.GH * 2);
  // the centre of this frame's motion: v = -c (p - centre) + noise, least
  // squares over the inter partitions; c > FOE_C is a zoom (the forward run),
  // anything less is a pan and gets no weighting
  const foeOf = (field) => {
    const GW = mv.GW;
    let n = 0;
    let mx = 0;
    let my = 0;
    let ux = 0;
    let uy = 0;
    for (let y = 0; y < mv.GH; y++) {
      for (let x = 0; x < GW; x++) {
        const o = (y * GW + x) * 4;
        if (field[o] === 2) continue;
        n++;
        mx += x * 8 + 4;
        my += y * 8 + 4;
        ux += field[o + 1] / 2;
        uy += field[o + 2] / 2;
      }
    }
    mx /= n;
    my /= n;
    ux /= n;
    uy /= n;
    let pv = 0;
    let pp = 0;
    for (let y = 0; y < mv.GH; y++) {
      for (let x = 0; x < GW; x++) {
        const o = (y * GW + x) * 4;
        if (field[o] === 2) continue;
        const dx = x * 8 + 4 - mx;
        const dy = y * 8 + 4 - my;
        pv += dx * (field[o + 1] / 2 - ux) + dy * (field[o + 2] / 2 - uy);
        pp += dx * dx + dy * dy;
      }
    }
    const c = -pv / pp;
    return c > FOE_C ? { c, x: mx + ux / c, y: my + uy / c } : { c: 0 };
  };
  // the duplicated P-frame: the first one after the I-frame a held block
  // missed, kept whole, so a block the tear takes over later repeats the
  // same frame as the blocks around it (not whatever the stream is sending
  // by then) and its rays run on from theirs
  const dupField = new Float32Array(mv.GW * mv.GH * 4);
  let dupFoe = { c: 0 };
  let dupDue = false;
  // In a zoom the bake's zero vectors are skips, not motion: it writes
  // zero wherever standing still predicts about as well (featureless
  // ballast, snow, overcast), and a decoder repeating the frame would hold
  // those partitions still for the whole hold, scattered squares of the
  // old picture sitting in the rays. Repeated, a skip is read the way
  // H.264 reads P_Skip, along the predicted vector: here the median of the
  // partitions around it. Every partition that carries a vector keeps its
  // own.
  const skipX = [];
  const skipY = [];
  const skipped = new Uint8Array(mv.GW * mv.GH);
  const skipToPredicted = (field) => {
    const GW = mv.GW;
    const GH = mv.GH;
    for (let g = 0; g < GW * GH; g++) skipped[g] = field[g * 4] !== 2 && field[g * 4 + 1] === 0 && field[g * 4 + 2] === 0 ? 1 : 0;
    const out = [];
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const g = y * GW + x;
        if (!skipped[g]) continue;
        skipX.length = 0;
        skipY.length = 0;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(GH - 1, y + 1); yy++) {
          for (let xx = Math.max(0, x - 1); xx <= Math.min(GW - 1, x + 1); xx++) {
            if (xx === x && yy === y) continue;
            skipX.push(field[(yy * GW + xx) * 4 + 1]);
            skipY.push(field[(yy * GW + xx) * 4 + 2]);
          }
        }
        skipX.sort((p, q) => p - q);
        skipY.sort((p, q) => p - q);
        out.push(g, skipX[skipX.length >> 1], skipY[skipY.length >> 1]);
      }
    }
    for (let k = 0; k < out.length; k += 3) {
      field[out[k] * 4 + 1] = out[k + 1];
      field[out[k] * 4 + 2] = out[k + 2];
    }
  };
  // latch block id from a field: weighted when it is the duplicated frame
  const latchFrom = (id, field, f) => {
    const i = id % MW;
    const j = (id - i) / MW;
    for (let q = 0; q < 4; q++) {
      const gx = i * 2 + (q & 1);
      const gy = j * 2 + (q >> 1);
      const g = gy * mv.GW + gx;
      const w = f && f.c ? Math.min(REACH_MAX, ((gx * 8 + 4 - f.x) ** 2 + (gy * 8 + 4 - f.y) ** 2) / REACH ** 2) : 1;
      latchRaw[g * 2] = (field[g * 4 + 1] / 2) * w;
      latchRaw[g * 2 + 1] = (field[g * 4 + 2] / 2) * w;
    }
  };
  // each partition's whole-pel step this frame: the fractional vector with
  // its own rounding remainder carried from frame to frame
  const carry = new Float32Array(mv.GW * mv.GH * 2);
  const stepOf = (g, k, v) => {
    const r = carry[g * 2 + k] + v;
    const d = Math.round(r);
    carry[g * 2 + k] = r - d;
    return d;
  };
  const stepLatch = () => {
    for (let g = 0; g < mv.GW * mv.GH; g++) {
      latchField[g * 4] = latchRaw[g * 2];
      latchField[g * 4 + 1] = latchRaw[g * 2 + 1];
      latchField[g * 4 + 2] = stepOf(g, 0, latchRaw[g * 2]);
      latchField[g * 4 + 3] = stepOf(g, 1, latchRaw[g * 2 + 1]);
    }
  };
  // While the hand holds, the starved field is carried along the vectors
  // the way the smear is: each fed block takes on its upstream neighbour's
  // starvation (the block its vector reads from, one macroblock along it)
  // at a rate that grows with the vector, so the tear blooms outward with
  // the motion, fastest where the picture moves fastest, and not at all
  // where it stands still (the winter sky). The longer the hold, the
  // further it has spread.
  const grown = new Float32Array(MW * MH);
  const maskAt = (x, y) => {
    x -= 0.5;
    y -= 0.5;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const g = (a, b) => (a < 0 || b < 0 || a >= MW || b >= MH ? 0 : mask[b * MW + a]);
    return (g(i, j) * (1 - fx) + g(i + 1, j) * fx) * (1 - fy) + (g(i, j + 1) * (1 - fx) + g(i + 1, j + 1) * fx) * fy;
  };
  const grow = () => {
    for (let j = 0; j < MH; j++) {
      for (let i = 0; i < MW; i++) {
        const id = j * MW + i;
        grown[id] = mask[id];
        let vx = 0;
        let vy = 0;
        for (let q = 0; q < 4; q++) {
          const o = ((j * 2 + (q >> 1)) * mv.GW + i * 2 + (q & 1)) * 4;
          vx += mvField[o + 1] / 8;
          vy += mvField[o + 2] / 8;
        }
        const v = Math.hypot(vx, vy);
        if (v < 1) continue;
        const up = maskAt(i + 0.5 + vx / v, j + 0.5 + vy / v);
        if (up > mask[id]) grown[id] = mask[id] + Math.min(GROW_MAX, (v / 16) * GROW) * (up - mask[id]);
      }
    }
    mask.set(grown);
  };

  const tick = () => {
    const frame = stream.queue.shift();
    if (!frame) return false;
    // a still only needs the stream from shortly before its hold: frames
    // before that are decoded and dropped, and the codec starts on an I-frame
    if (still && seq < warmFrom) {
      frame.close();
      seq++;
      return true;
    }
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    frame.close();
    const idx = seq % N;
    let held = press;
    if (still) held = seq >= holdFrom && seq < releaseFrom;
    if (held && still) {
      // the still's hand draws the hero stroke over its first STROKE_S
      const k = clamp((seq - holdFrom + 1) / Math.max(1, Math.round(STROKE_S * FPS)), 0, 1);
      paintPath(STROKE, k);
    } else if (held) paintTo(brushAt());
    else {
      brushLast = null;
      const f = Math.exp(-1 / FPS / FADE);
      for (let id = 0; id < MW * MH; id++) mask[id] *= f;
    }
    const iframe = idx % GOP === 0 || webm.frames[idx].key || seq === 0 || (still && seq === warmFrom);
    if (joining && iframe && seq > 0) joining = false;
    mv.unpack(idx, mvField);
    if (held && !iframe) grow();
    // the frame after an I-frame is the one a held block will duplicate
    if (iframe) dupDue = true;
    else if (dupDue) {
      dupField.set(mvField);
      dupFoe = foeOf(dupField);
      if (dupFoe.c) skipToPredicted(dupField);
      dupDue = false;
    }
    // per macroblock: starved where the mask is over its (ragged) threshold,
    // and one block past it the edge: stripped and starved the same way
    // (it repeats the same P-frame from the moshed picture) but still taking
    // the I-frame, so the winter picture lands there and is then dragged
    // across the seam, and the strips read winter back in from it; drifting
    // where it was held and nothing intra has reached it since
    for (let id = 0; id < MW * MH; id++) starved[id] = mask[id] > thresh[id] ? 1 : 0;
    let dirtyN = 0;
    for (let id = 0; id < MW * MH; id++) {
      const i = id % MW;
      const j = (id - i) / MW;
      let edge = 0;
      if (!starved[id]) {
        for (let jj = Math.max(0, j - 1); jj <= Math.min(MH - 1, j + 1) && !edge; jj++) {
          for (let ii = Math.max(0, i - 1); ii <= Math.min(MW - 1, i + 1); ii++) {
            if (starved[jj * MW + ii]) {
              edge = 1;
              break;
            }
          }
        }
      }
      const on = starved[id] || edge;
      // a block the spreading tear takes over joins the P-frame its
      // neighbours are repeating, if they are already repeating one
      if (on && age[id] === 0) {
        frozen[id] = (i > 0 && frozen[id - 1] && age[id - 1]) || (i < MW - 1 && frozen[id + 1] && age[id + 1]) || (id >= MW && frozen[id - MW] && age[id - MW]) || (id < MW * (MH - 1) && frozen[id + MW] && age[id + MW]) ? 1 : 0;
        latched[id] = 0;
      }
      if (on && iframe) {
        frozen[id] = 1;
        latched[id] = 0;
      }
      age[id] = on ? age[id] + 1 : 0;
      if (on) {
        dirty[id] = 1;
        if (frozen[id] && !iframe && !dupDue && !latched[id]) {
          latchFrom(id, dupField, dupFoe);
          latched[id] = 1;
        }
      } else if (dirty[id]) dirtyN++;
      stateField[id * 4] = on && !frozen[id] ? 4 : starved[id] ? 2 : edge ? 3 : dirty[id] ? 1 : 0;
    }
    // Once the hand lifts, an intra refresh column sweeps the macroblock
    // columns, quick then settling, and goes round again while anything fed
    // is still carrying the mosh.
    if (refreshAt < 0 && dirtyN > 0 && !held) refreshAt = seq;
    let refresh = 0;
    if (refreshAt >= 0) {
      const k = (seq - refreshAt + 1) / REFRESH;
      refresh = Math.ceil((1 - (1 - Math.min(k, 1)) ** 2) * MW);
      if (k >= 1) refreshAt = -1;
    }
    stepLatch();
    codecStep(idx, { iframe, join: joining, refresh });
    // what landed: an I-frame, an intra block or the refresh column cleans a
    // fed block
    if (dirtyN > 0) {
      for (let j = 0; j < MH; j++) {
        for (let i = 0; i < MW; i++) {
          const id = j * MW + i;
          if (stateField[id * 4] !== 1) continue;
          if (iframe || i < refresh || mvField[(j * 2 * mv.GW + i * 2) * 4] === 2) dirty[id] = 0;
        }
      }
    }
    seq++;
    return true;
  };

  stage.on("down", () => {
    press = true;
  });
  stage.on("up", () => {
    press = false;
  });

  let destroyed = false;
  let readyDone = false;
  let shown = 0;
  // A still is built as fast as the GPU goes, but never further ahead of
  // it than a few codec steps: a fence per batch, and no new batch until
  // the last has landed. Queuing a whole hold at once on a software GL
  // stalls the page for minutes and can take the GPU process down.
  let fence = null;
  const gpuBusy = () => {
    if (!fence) return false;
    if (gl.clientWaitSync(fence, 0, 0) === gl.TIMEOUT_EXPIRED) return true;
    gl.deleteSync(fence);
    fence = null;
    return false;
  };
  const fenced = () => {
    fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  };
  const frame = (dt) => {
    if (destroyed || failed) return;
    if (still && gpuBusy()) return;
    if (seq > 0 && on < 1) on = joining ? 1 : Math.min(1, on + dt / 0.6);
    if (still) {
      // decode straight through to the still, then hold it: dropped frames
      // are free, codec steps go a few to a batch
      const from = Math.max(seq, warmFrom);
      for (let i = 0; i < 48 && seq < stopAt && seq < from + 3; i++) if (!tick()) break;
      if (seq >= stopAt) on = 1;
    } else {
      // dragging while held feeds the decoder faster: the clip runs under
      // the hand and its motion pushes harder
      const p = stage.pointer;
      const speed = press ? Math.hypot(p.vx, p.vy) : 0;
      const rate = 1 + clamp(speed / 450, 0, 3);
      acc = Math.min(acc + dt * rate, 5 / FPS);
      while (acc >= 1 / FPS) {
        if (!tick()) {
          acc = 0;
          break;
        }
        acc -= 1 / FPS;
      }
    }
    if (seq < stopAt) stream.pump(still ? 24 : 10);
    if (seq > 0 && !readyDone) {
      readyDone = true;
      host.dataset.playing = "";
    }
    if (!still) present();
    else if (seq >= stopAt && shown < 3) {
      // a still is drawn a few times, then left alone; it is marked done
      // once the GPU has caught up with the last of it
      present();
      shown++;
    } else if (seq >= stopAt && host.dataset.still == null) {
      stream.close();
      host.dataset.still = "";
    }
    if (still && seq > 0 && host.dataset.still == null) fenced();
  };
  stage.onFrame(frame);
  void embedded;

  return {
    destroy() {
      destroyed = true;
      stream.close();
      for (const t of [srcTex, mvTex, stateTex, latchTex, ...E, ...D, ...R]) gl.deleteTexture(t);
      for (const f of fbos.values()) gl.deleteFramebuffer(f);
      if (fence) gl.deleteSync(fence);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      for (const s of [resid, dct, step, show]) gl.deleteProgram(s.p);
      stage.destroy();
    },
  };
}
