import { createStage, clamp } from "../_kit/stage";
import { readWebm } from "./webm";

// Datamosh: a video codec run live, so its reference frame can be lost.
//
// Nine seconds of a rail journey in two shots and a hard cut. Six seconds
// out of a train window on a summer afternoon: cumulus, wires, poles, a
// belt of trees running past, all of it one slow lateral pan. Then three
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
// gets no I-frame, no residual and no intra blocks: each intra block is
// turned into an inter block along the median of its neighbours' vectors,
// the way a datamosher strips them (ffglitch's mb_type rewrite, Murata's
// I-frame and intra removal), so the error stays one continuous smear
// instead of squares of the true picture, and it reads its own picture in
// whole pels, nearest, with no half-pel filter (see mcPel), so the smear
// stays hard-edged however long the hold runs. Every other block is fed
// and decodes the true frame, so the mosh is a tear in an intact picture.
//
// It tunes in the way a set joins a broadcast: between I-frames, with no
// picture. Until the first I-frame arrives (three seconds) it builds what it
// can on blank paper from the vectors and the residuals, so only what
// moves or changes appears: the tree line, the edges of the
// drifting cloud, a pole, set into the paper.
//
// Press and drag and the hand paints a mask of starved macroblocks, a soft
// brush a few blocks across dragged along its path, each block tearing at
// its own level so the edge breaks raggedly on the grid. Under it the
// I-frames stop, and within a fifth of a second the residuals too. Only the
// vectors are left. In the first shot they still fit the picture they move,
// so the tear barely shows. The real event is the cut. Its I-frame (and the
// loop seam's, the cut back) is the one that matters to drop: the winter
// shot arrives everywhere else, while inside the stroke its vectors find
// nothing of their own to move and push the summer picture instead, sky and
// tree line streaming out of the vanishing point in stepped strips on the
// macroblock grid, cut into a winter frame that stays whole around it. Over
// the seam it runs the other way. Drag while holding and the clip is fed
// faster than real time, so it reaches the cut sooner. Let go and the mask
// fades from its edges in; a block fed again carries its mosh along the
// true vectors (an honest decode of a damaged reference) until a column of
// intra blocks sweeps the macroblock columns, as a periodic intra refresh
// does, and it is clean behind it.
//
// Query (stills): ?t=seconds stops the stream at that clip time (decoded
// frame by frame from the start, as fast as it can); ?hold=seconds holds it
// for that long before t; ?release=seconds lets go that long before t (the
// refresh mid-sweep); ?join=1 shows the opening (?join=0 skips it live);
// ?qp= sets the encoder's quantiser. A still's hold paints a fixed stroke
// (STROKE) through the centre left. ?t=8&hold=4 holds it over the cut
// (6 s): the hero still; ?t=6.3&hold=0.6 is the cut a moment after.

const ASSET = "/lab/datamosh/";
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
const GOP = 90; // frames between I-frames (the cut, frame 180, is one too)
const QP0 = 30; // encoder quantiser (H.264 scale)
const LET_GO = 0.2; // s over which a hold lets the residual go
const REFRESH = 14; // frames for the intra refresh to sweep the picture
const BRUSH = 6; // brush radius, macroblocks (about five torn across)
const FADE = 1.6; // s: time constant of the starved mask once the hand lifts
// The hero stroke a still paints while its hold runs: through the centre
// left, from the fence up across the tree line and the sky, through where
// the winter shot's vanishing point will sit and a little past it, so the
// bloom streams out of it both ways (frame fractions, top-left origin).
const STROKE = [
  [0.06, 0.97],
  [0.16, 0.76],
  [0.27, 0.57],
  [0.38, 0.4],
  [0.47, 0.25],
  [0.55, 0.12],
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
// A held decoder copies whole pels instead: every vector rounded to the
// pixel grid and the block lifted straight out of the reference, nearest,
// no filter. The six-tap read is right for a decoder whose residual mends
// it every frame, but a held picture is read again on every frame of the
// hold, and hundreds of half-pel passes low-pass a bloom into airbrush.
// Copied whole, the photo's grain and the 16x16 and 8x8 block edges stay
// as sharp on the three hundredth frame as on the first, and the smear
// moves in hard stepped strips that tear on the macroblock grid. An odd
// (half-pel) vector rounds down on even frames and up on odd ones, so a
// half-pixel drift still moves a whole pixel every other frame.
// A vector that reaches past the frame edge is read mirrored back into the
// picture, not edge-extended: an edge-extended copy repeats the last row or
// column, and a held block re-reading it every frame combs out into
// one-pixel streaks along the edge.
ivec2 mirror(ivec2 q, ivec2 n) {
  q = ivec2(q.x < 0 ? -q.x - 1 : q.x, q.y < 0 ? -q.y - 1 : q.y);   // -1 -> 0, -2 -> 1
  q = ivec2(q.x >= n.x ? 2 * n.x - 1 - q.x : q.x, q.y >= n.y ? 2 * n.y - 1 - q.y : q.y);
  return clamp(q, ivec2(0), n - 1);
}
vec3 mcPel(sampler2D ref, vec2 p, vec4 m, int phase) {
  ivec2 v = ivec2(m.yz);
  ivec2 q = ivec2(floor(p)) + ((v + phase) >> 1);
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
// reaches it), 2 starved (no I-frame, no intra, the residual gone within
// LET_GO: stripped intra, whole-pel copies), with .y the residual a
// starved block still gets.
const STEP_FS = `${COMMON}${MC}
uniform sampler2D uSrc;
uniform sampler2D uE;
uniform sampler2D uD;
uniform sampler2D uRes;     // dequantised residual
uniform sampler2D uState;   // MW x MH: x 0 fed, 1 drifting, 2 starved; y gain
uniform int uIframe;        // this frame is an I-frame
uniform int uJoin;          // the decoder has not had an I-frame yet
uniform int uPhase;         // frame parity, for rounding half-pel vectors
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
    // an intra block is turned into an inter one along its neighbours'
    // median vector with no residual, and everything else is a whole-pel
    // copy of the moshed picture with the residual running out
    vec3 dm = mcPel(uD, p, m, uPhase);
    if (uIframe == 1) d = texelFetch(uD, ivec2(p), 0).rgb;
    else if (intra) d = dm;
    else d = dm + st.y * r;
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
  const codecStep = (idx, { iframe, join, phase, refresh }) => {
    gl.bindTexture(gl.TEXTURE_2D, mvTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, mv.GW, mv.GH, gl.RGBA, gl.FLOAT, mvField);
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
    gl.uniform1i(step.u.uIframe, iframe ? 1 : 0);
    gl.uniform1i(step.u.uJoin, join ? 1 : 0);
    gl.uniform1i(step.u.uPhase, phase);
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
    // per macroblock: starved where the mask is over its (ragged) threshold,
    // drifting where it was starved and nothing intra has reached it since
    let dirtyN = 0;
    for (let id = 0; id < MW * MH; id++) {
      const on = mask[id] > thresh[id];
      age[id] = on ? age[id] + 1 : 0;
      if (on) {
        dirty[id] = 1;
      } else if (dirty[id]) dirtyN++;
      stateField[id * 4] = on ? 2 : dirty[id] ? 1 : 0;
      stateField[id * 4 + 1] = 1 - clamp(age[id] / FPS / LET_GO, 0, 1);
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
    codecStep(idx, { iframe, join: joining, phase: seq & 1, refresh });
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
      for (const t of [srcTex, mvTex, stateTex, ...E, ...D, ...R]) gl.deleteTexture(t);
      for (const f of fbos.values()) gl.deleteFramebuffer(f);
      if (fence) gl.deleteSync(fence);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      for (const s of [resid, dct, step, show]) gl.deleteProgram(s.p);
      stage.destroy();
    },
  };
}
