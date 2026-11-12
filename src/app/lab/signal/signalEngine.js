// Signal: a real photograph through a composite NTSC camcorder-to-VHS-to-TV
// chain, in WebGL2. Every pass is a stage of the real chain:
//
//   scene radiance (HDR, sun included)
//   -> camera: lens glare, complementary-mosaic CCD wells, overflow bloom,
//      vertical-register smear, retained overflow (lag), gamma, knee, a hot
//      super-white clip (reference white is a quarter of the well)
//   -> encoder: Y 4.2 MHz, I 1.3 MHz, Q 0.4 MHz, 3.58 MHz subcarrier, sync, burst
//   -> VCR record: luma trap + LPF, chroma synchronously demodulated to a
//      +/-500 kHz colour-under band, RC pre-emphasis and clip, FM modulator
//      (3.4 MHz sync tip to 4.4 MHz white), phase run on from line to line
//   -> tape: RF from the head's own track and the same-azimuth track two over,
//      head-amp noise, spacing flutter, the channel's spacing loss and steep
//      top edge, dropouts, head switch, timebase error per line; limiter and
//      pulse-count discriminator; de-emphasis
//
// Noise is kept to its mechanisms: in track the picture is nearly clean. A
// carrier driven toward the top of the channel (super-white, pre-emphasis
// overshoot) sinks toward the limiter's slicing level, and only where a
// flutter, an asperity or crosstalk pushes it the rest of the way does the
// discriminator fail: crossings bunch, go missing, and white turns into
// short black comets that de-emphasis drags out to the right.
//   -> VCR playback: dropout compensator (1H substitution), 1H chroma comb,
//      chroma re-modulated with the AFC/APC phase error
//   -> TV: sync from the flywheel PLL, luma notch, chroma demod against the
//      TV's burst-locked oscillator, colour killer, YUV -> RGB
//   -> monitor: scan lines with brightness-dependent spot size.
//
// The per-line numbers (head position, RF levels, PLL states) come from
// signalModel.js.

import { createStage, clamp } from "../_kit/stage";
import { createModel, FS, LINE, FIELD_LINES, ACTIVE_X, ACTIVE_W, PARAM_COLS } from "./signalModel";

const CAM_W = ACTIVE_W;
const CAM_H = 480;
const GL_W = 256;
const GL_H = 192;
const SIG_W = LINE;
const SIG_H = FIELD_LINES * 2;

// ---------------------------------------------------------------- kernels

const gaussLP = (fc) => (f) => Math.pow(2, -0.5 * (f / fc) * (f / fc));
const butter = (fc, n) => (f) => 1 / Math.sqrt(1 + Math.pow(f / fc, 2 * n));
const notch = (fo, w, depth) => (f) => 1 - depth * Math.exp(-((f - fo) / w) * ((f - fo) / w));

// Linear-phase FIR from a target magnitude response (MHz -> gain), windowed.
function kernel(H, R) {
  const N = 1024;
  const h = new Float32Array(2 * R + 1);
  for (let k = 0; k <= R; k++) {
    let acc = 0;
    for (let j = 0; j < N; j++) {
      const f = (Math.min(j, N - j) * FS) / N;
      acc += H(f) * Math.cos((2 * Math.PI * j * k) / N);
    }
    const w = 0.5 + 0.5 * Math.cos((Math.PI * k) / (R + 1));
    h[R + k] = h[R - k] = (acc / N) * w;
  }
  let dc = 0;
  for (const v of h) dc += v;
  const target = H(0);
  for (let i = 0; i < h.length; i++) h[i] *= target / dc;
  return h;
}

// ---------------------------------------------------------------- shaders

const VS = `#version 300 es
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const float FS = ${FS.toFixed(5)};
const int LW = ${LINE};
const int FHL = ${FIELD_LINES};
const int AX = ${ACTIVE_X};
const int AW = ${ACTIVE_W};
uniform int uFrame;
uvec3 pcg(uvec3 v){ v = v * 1664525u + 1013904223u; v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y; v ^= v >> 16u; v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y; return v; }
vec2 hash2(int a, int b, int c){ uvec3 h = pcg(uvec3(uint(a + 4096), uint(b + 4096), uint(c))); return vec2(h.xy) * (1.0/4294967296.0); }
vec2 gauss2(int a, int b, int c){ vec2 u = hash2(a,b,c); float r = sqrt(-2.0*log(max(u.x, 1e-7))); return r * vec2(cos(TAU*u.y), sin(TAU*u.y)); }
// subcarrier phase in cycles, continuous along the stream (227.5 cycles a line)
float scPhase(float s, int l, int f){ return fract(0.25*s + 0.5*float(l & 1) + 0.75*float(f) + 0.5*float(uFrame & 1)); }
vec4 sfetch(sampler2D t, int row, int i){
  int fb = (row / FHL) * FHL;
  if (i < 0) { i += LW; row -= 1; } else if (i >= LW) { i -= LW; row += 1; }
  if (row < fb || row >= fb + FHL) return vec4(0.0);
  return texelFetch(t, ivec2(i, row), 0);
}
vec4 sinterp(sampler2D t, int row, float s){ float fl = floor(s); int i = int(fl); return mix(sfetch(t,row,i), sfetch(t,row,i+1), s - fl); }
float phaseAt(sampler2D t, int row, float s){ float fl = floor(s); int i = int(fl); float a = sfetch(t,row,i).x; float b = sfetch(t,row,i+1).x; float d = b - a; d -= floor(d + 0.5); return a + (s - fl) * d; }
layout(location = 0) out vec4 o;
`;

// Decode the stored scene (tone-coded 8-bit + log residual for the sun).
const FS_DECODE = `${HEAD}
uniform sampler2D uScene; uniform sampler2D uHi;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 y = texelFetch(uScene, p, 0).rgb;
  vec3 t = pow(y, vec3(2.2));
  vec3 x = 0.5 * t / max(1.0 - t, 1e-4);
  vec2 uv = (vec2(p) + 0.5) / vec2(textureSize(uScene, 0));
  vec3 h = texture(uHi, uv).rgb;
  x += exp2(h * 24.0) - 1.0;
  o = vec4(x / 16.0, 1.0);
}`;

// Light on the sensor, plus the overflow charge the last field left behind.
const FS_EXPOSE = `${HEAD}
uniform sampler2D uRad; uniform sampler2D uRes; uniform sampler2D uGl;
uniform vec4 uSway; uniform float uE; uniform float uGlare;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 uv = (vec2(p) + 0.5) / vec2(${CAM_W}.0, ${CAM_H}.0);
  vec2 d = (uv - 0.5) * vec2(4.0/3.0, 1.0) * 0.9 * uSway.w;
  float c = cos(uSway.z), s = sin(uSway.z);
  d = mat2(c, s, -s, c) * d;
  vec2 su = 0.5 + d / vec2(4.0/3.0, 1.0) + uSway.xy;
  vec3 r = textureLod(uRad, su, 0.35).rgb;
  // veiling glare: a heavy-tailed PSF as a sum over the pyramid
  r = r * (1.0 - uGlare) + texture(uGl, su).rgb * uGlare;
  vec3 q = r * 16.0 * uE + texelFetch(uRes, p, 0).rgb;
  o = vec4(q, 1.0);
}`;

// Lens PSF: veiling glare as a sum of Gaussians, built once at a quarter
// of the scene's resolution.
const FS_BLUR = `${HEAD}
uniform sampler2D uSrc; uniform vec2 uDir; uniform float uSigma; uniform float uLod; uniform float uW;
void main(){
  vec2 sz = vec2(textureSize(uSrc, int(uLod)));
  vec2 uv = gl_FragCoord.xy / vec2(${GL_W}.0, ${GL_H}.0);
  vec3 s = vec3(0.0); float ws = 0.0;
  int R = int(ceil(uSigma * 3.0));
  for (int k = -R; k <= R; k++) {
    float w = exp(-float(k * k) / (2.0 * uSigma * uSigma));
    s += w * textureLod(uSrc, uv + uDir * float(k) / vec2(${GL_W}.0, ${GL_H}.0), uLod).rgb;
    ws += w;
  }
  o = vec4(s / ws * uW, 1.0);
}`;

// Column integral of the charge image, for vertical-register smear.
const FS_COLUMN = `${HEAD}
uniform sampler2D uQ;
void main(){
  int x = int(gl_FragCoord.x);
  vec3 s = vec3(0.0);
  for (int y = 0; y < ${CAM_H}; y++) s += texelFetch(uQ, ivec2(x, y), 0).rgb;
  o = vec4(s, 1.0);
}`;

// Overflow charge runs up and down the vertical CCD channel; the
// anti-blooming drain takes most of it.
const FS_BLOOM = `${HEAD}
uniform sampler2D uQ; uniform float uBloom; uniform float uBloomL;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 b = vec3(0.0);
  for (int k = -40; k <= 40; k++) {
    int y = p.y + k;
    if (y < 0 || y >= ${CAM_H}) continue;
    vec3 e = max(texelFetch(uQ, ivec2(p.x, y), 0).rgb - 1.0, 0.0);
    b += e * exp(-abs(float(k)) / uBloomL);
  }
  // a little sideways spill through the channel stops
  for (int k = -3; k <= 3; k++) {
    if (k == 0) continue;
    int x = p.x + k * 2;
    if (x < 0 || x >= ${CAM_W}) continue;
    b += 0.25 * max(texelFetch(uQ, ivec2(x, p.y), 0).rgb - 1.0, 0.0) * exp(-abs(float(k)));
  }
  o = vec4(b * uBloom / (2.0 * uBloomL), 1.0);
}`;

// Readout and camera processing; second target keeps overflow for the next field.
// The CCD is a complementary mosaic (Ye, Cy, Mg wells): each well fills with a
// sum of two primaries, so at the edge of a blown highlight they clip one at a
// time and the matrix back to RGB swings into false colour, magenta first.
const FS_CAMOUT = `${HEAD}
uniform sampler2D uQ; uniform sampler2D uB; uniform sampler2D uCol;
uniform float uSmear; uniform float uLag; uniform float uLagCap; uniform float uWhite; uniform float uFalse;
layout(location = 1) out vec4 o2;
vec3 charge(int x, int y){
  x = clamp(x, 0, ${CAM_W - 1});
  vec3 q = texelFetch(uQ, ivec2(x, y), 0).rgb;
  return min(q, vec3(2.0)) + texelFetch(uB, ivec2(x, y), 0).rgb + uSmear * texelFetch(uCol, ivec2(x, 0), 0).rgb;
}
vec3 well(vec3 x){ return min(mix(x, 1.0 - 0.15 * exp(-(x - 0.85) / 0.15), step(0.85, x)), vec3(1.0)); }
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 q = texelFetch(uQ, p, 0).rgb;
  // the Ye, Cy and Mg sites sit side by side, a CCD cell (~2 samples) apart.
  // The optical low-pass makes them agree while the wells are linear; once a
  // well clips and its neighbour does not they disagree, and at a blown edge
  // the rising side decodes cyan and the falling side magenta-red
  vec3 cL = charge(p.x - 2, p.y), c = charge(p.x, p.y), cR = charge(p.x + 2, p.y);
  vec3 e0 = 0.5 * vec3(c.r + c.g, c.g + c.b, c.r + c.b); // Ye, Cy, Mg
  vec3 e1 = 0.5 * vec3(cL.r + cL.g, cR.g + cR.b, c.r + c.b);
  float clip = smoothstep(0.6, 1.0, max(max(max(e0.x, e0.y), e0.z), max(max(e1.x, e1.y), e1.z)));
  vec3 w = well(e0);
  vec3 wx = well(mix(e0, e1, clip));
  vec3 s = max(vec3(w.x + w.z - w.y, w.x + w.y - w.z, w.y + w.z - w.x), 0.0);
  vec3 sx = vec3(wx.x + wx.z - wx.y, wx.x + wx.y - wx.z, wx.y + wx.z - wx.x);
  // the colour-difference path never sees the luma's knee or white clip (no
  // highlight chroma suppression on a cheap camera), so the false colour
  // rides out of the blown edge at full strength
  vec3 fd = sx - s;
  fd -= dot(fd, vec3(0.3, 0.59, 0.11));
  // shot and amplifier noise: a few electrons' worth, not a texture
  vec2 n = gauss2(p.x, p.y, uFrame * 3 + 1);
  s += (sqrt(s * 0.00002) + 0.0004) * vec3(n.x, n.x * 0.7 + n.y * 0.3, n.y);
  // camera colour matrix: camcorders ran their primaries hot
  float ly = dot(s, vec3(0.3, 0.59, 0.11));
  // reference white is a quarter of the well: only the sun fills one
  vec3 v = max((ly + (s - ly) * 1.35) * 4.3, 0.0);
  // gamma with a linear toe (0.45), then the knee and a hot white clip
  vec3 g = mix(4.5 * v, 1.099 * pow(v, vec3(0.45)) - 0.099, step(0.018, v));
  g = mix(g, 0.86 + (g - 0.86) * 0.32, step(0.86, g));
  g = min(g, vec3(uWhite)) + uFalse * fd;
  o = vec4(g, 1.0);
  o2 = vec4(min(max(q - 1.0, 0.0), vec3(uLagCap)) * uLag, 1.0);
}`;

// Composite encoder.
const FS_ENCODE = `${HEAD}
uniform sampler2D uCam; uniform float uKY[29]; uniform float uKI[29]; uniform float uKQ[29]; uniform float uDetail;
vec3 cam(int x, int y){ if (x < 0 || x >= AW || y < 0 || y >= ${CAM_H}) return vec3(0.0); return texelFetch(uCam, ivec2(x, y), 0).rgb; }
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
void main(){
  int x = int(gl_FragCoord.x); int row = int(gl_FragCoord.y);
  int f = row / FHL; int l = row - f * FHL;
  float v = 0.0;
  float c = TAU * scPhase(float(x), l, f);
  bool vs = l >= 3 && l < 6; bool eq = (l < 3) || (l >= 6 && l < 9);
  if (vs) { v = ((x >= 388 && x < 455) || (x >= 843)) ? 0.0 : -40.0; }
  else if (eq) { v = (x < 33 || (x >= 455 && x < 488)) ? -40.0 : 0.0; }
  else {
    if (x < 67) v = -40.0;
    else if (x >= 76 && x < 112) v = -20.0 * sin(c);
    else if (x >= AX && x < AX + AW && l >= 21 && l < 261) {
      int cx = x - AX; int cy = (l - 21) * 2 + f;
      float Y = 0.0, I = 0.0, Q = 0.0;
      for (int k = -14; k <= 14; k++) {
        vec3 rgb = cam(cx + k, cy);
        Y += uKY[k + 14] * luma(rgb);
        I += uKI[k + 14] * dot(rgb, vec3(0.596, -0.274, -0.322));
        Q += uKQ[k + 14] * dot(rgb, vec3(0.211, -0.523, 0.312));
      }
      // camera aperture correction on luma, with coring
      float yc = luma(cam(cx, cy));
      float hd = yc - 0.5 * (luma(cam(cx - 2, cy)) + luma(cam(cx + 2, cy)));
      float vd = yc - 0.5 * (luma(cam(cx, cy - 2)) + luma(cam(cx, cy + 2)));
      float dt = hd + 0.6 * vd;
      dt = sign(dt) * max(abs(dt) - 0.012, 0.0);
      Y += uDetail * dt;
      float s33 = 0.544639, c33 = 0.838671;
      float U = -I * s33 + Q * c33;
      float V = I * c33 + Q * s33;
      v = 7.5 + 92.5 * Y + 92.5 * (U * sin(c) + V * cos(c));
      // the modulator's own headroom
      v = clamp(v, -30.0, 128.0);
    }
  }
  o = vec4(v, 0.0, 0.0, 1.0);
}`;

// VCR record electronics: luma through trap + LPF; chroma down to baseband.
const FS_RECSEP = `${HEAD}
uniform sampler2D uComp; uniform float uKYr[17]; uniform float uKCr[29];
float comp(int row, int i){ return texelFetch(uComp, ivec2(clamp(i, 0, LW - 1), row), 0).r; }
void main(){
  int x = int(gl_FragCoord.x); int row = int(gl_FragCoord.y);
  int f = row / FHL; int l = row - f * FHL;
  float Y = 0.0;
  for (int k = -8; k <= 8; k++) Y += uKYr[k + 8] * comp(row, x + k);
  vec2 uv = vec2(0.0);
  for (int k = -14; k <= 14; k++) {
    float c = TAU * scPhase(float(x + k), l, f);
    uv += uKCr[k + 14] * comp(row, x + k) * 2.0 * vec2(sin(c), cos(c));
  }
  o = vec4(Y, uv, 1.0);
}`;

// Pre-emphasis (an RC high-shelf, so causal: the overshoot sits just after a
// rising edge), white and dark clip, FM modulator frequency.
const FS_FM = `${HEAD}
uniform sampler2D uRec; uniform float uKE[33]; uniform vec2 uClip;
void main(){
  int x = int(gl_FragCoord.x); int row = int(gl_FragCoord.y);
  vec4 r = texelFetch(uRec, ivec2(x, row), 0);
  float y = 0.0;
  for (int k = 0; k < 33; k++) y += uKE[k] * texelFetch(uRec, ivec2(max(x - k, 0), row), 0).r;
  y = clamp(y, uClip.x, uClip.y);
  float fm = 3.4 + (y + 40.0) / 140.0;
  o = vec4(fm / FS, r.g, r.b, fm);
}`;

// FM phase: prefix sum along the line in two passes (blocks of 32). The
// first pass also keeps the carrier's mean frequency over the playback
// channel's memory (~0.6 us): a brief pre-emphasis spike is mostly sideband
// and gets through, a carrier parked up there does not.
const FS_PREFIX_A = `${HEAD}
uniform sampler2D uFm;
void main(){
  int x = int(gl_FragCoord.x); int row = int(gl_FragCoord.y);
  int b0 = (x >> 5) << 5;
  float s = 0.0;
  for (int i = b0; i <= x; i++) s += texelFetch(uFm, ivec2(i, row), 0).r;
  vec4 r = texelFetch(uFm, ivec2(x, row), 0);
  float fa = 0.0;
  for (int k = -4; k <= 4; k++) fa += texelFetch(uFm, ivec2(clamp(x + k, 0, LW - 1), row), 0).a;
  o = vec4(fract(s), r.g, r.b, fa / 9.0);
}`;
const FS_PREFIX_B = `${HEAD}
uniform sampler2D uA;
void main(){
  int x = int(gl_FragCoord.x); int row = int(gl_FragCoord.y);
  vec4 r = texelFetch(uA, ivec2(x, row), 0);
  float s = r.r;
  int nb = x >> 5;
  for (int b = 0; b < nb; b++) s += texelFetch(uA, ivec2(b * 32 + 31, row), 0).r;
  o = vec4(fract(s), r.g, r.b, r.a);
}`;

// The carrier's phase runs on through blanking from line to line: each row's
// starting phase is the sum of every whole line before it in the field.
const FS_ROWOFF = `${HEAD}
uniform sampler2D uPhi;
void main(){
  int row = int(gl_FragCoord.y);
  int fb = (row / FHL) * FHL;
  float s = 0.0;
  for (int r = fb; r < row; r++) s = fract(s + texelFetch(uPhi, ivec2(LW - 1, r), 0).r);
  o = vec4(s, 0.0, 0.0, 1.0);
}`;

// Head, tape and FM discriminator.
const FS_TAPE = `${HEAD}
uniform sampler2D uPhi; uniform sampler2D uP; uniform sampler2D uOff;
uniform float uHR; uniform float uCNoise; uniform float uCDelay;
uniform vec2 uEdge; uniform float uLim; uniform float uFlutter; uniform float uAsp;
vec4 par(int c, int row){ return texelFetch(uP, ivec2(c, row), 0); }
float dropMul(float x, vec4 d, float dep0, float dep1){
  float m = 1.0;
  if (d.x >= 0.0 && x >= d.x && x < d.x + d.y) m = min(m, dep0);
  if (d.z >= 0.0 && x >= d.z && x < d.z + d.w) m = min(m, dep1);
  return m;
}
vec2 cis(float a){ return vec2(cos(a), sin(a)); }
// continuous carrier phase (cycles) at stream position s of a row
float pc(int row, int i){
  int fb = (row / FHL) * FHL;
  if (i < 0) { i += LW; row -= 1; } else if (i >= LW) { i -= LW; row += 1; }
  if (row < fb || row >= fb + FHL) return 0.0;
  return texelFetch(uPhi, ivec2(i, row), 0).r + texelFetch(uOff, ivec2(0, row), 0).r;
}
float phaseC(int row, float s){ float fl = floor(s); int i = int(fl); float a = pc(row, i); float b = pc(row, i + 1); float d = b - a; d -= floor(d + 0.5); return a + (s - fl) * d; }
// the carrier's mean frequency over the channel's memory (see FS_PREFIX_A)
float fAvg(int row, float s){ return sinterp(uPhi, row, s).w; }
// playback response: spacing loss tilts it, then the top of the channel (head
// resonance, the luma band-pass skirt) closes steeply
float hrf(float f){ float r = max(f - 3.4, 0.0) / (uEdge.x - 3.4); return exp(-uHR * max(f - 3.4, 0.0)) * inversesqrt(1.0 + pow(r, 2.0 * uEdge.y)); }
void main(){
  int x = int(gl_FragCoord.x); int row = int(gl_FragCoord.y);
  int f = row / FHL; int l = row - f * FHL;
  vec4 p0 = par(0, row), p1 = par(1, row), p2 = par(2, row), p3 = par(3, row), p4 = par(4, row);
  float e = p0.x, A = p0.y, B = p0.z, dFar = p0.w;
  float sigma = p3.x, xs = p3.y, jump = p3.z;
  // the far track is another recording: its own field-start phase
  float phFar = hash2(f, 77, uFrame).y;
  // H-alignment: the same-azimuth track two over carries the picture three
  // field lines away at this point of the scan
  int rowF = clamp(row + 3, f * FHL, f * FHL + FHL - 1);
  vec2 rf[3];
  for (int q = 0; q < 3; q++) {
    float xp = float(x - 1 + q);
    float ee = (xs >= 0.0 && xp >= xs) ? e + jump : e;
    float xr = xp - ee;
    float phO = phaseC(row, xr);
    float phF = phaseC(rowF, xr - dFar) + phFar;
    float dm = dropMul(xp, p2, p3.w, p4.w);
    float a = A * hrf(fAvg(row, xr)) * dm;
    float b = B * hrf(fAvg(rowF, xr - dFar)) * dm;
    float sg = sigma * (1.0 + ((xs >= 0.0 && abs(xp - xs) < 14.0) ? 9.0 : 0.0));
    // head-to-tape spacing flutters with the tape's surface: a few dB of AM,
    // which FM shrugs off until the carrier is marginal
    float sp = xp / 9.0;
    float sf = floor(sp);
    float h0 = hash2(int(sf), row, uFrame * 13 + 5).x, h1 = hash2(int(sf) + 1, row, uFrame * 13 + 5).x;
    float fu = sp - sf;
    a *= 1.0 - uFlutter * mix(h0, h1, fu * fu * (3.0 - 2.0 * fu));
    // asperities: a speck of debris or an oxide bump lifts the head for a
    // fraction of a microsecond. Far too shallow for the dropout detector, and
    // FM rides over it, except where the carrier was already marginal
    float ap = xp / 7.0;
    float af = floor(ap);
    vec2 hA = hash2(int(af), row, uFrame * 17 + 9);
    float bu = sin(PI * (ap - af));
    if (hA.x < uAsp) a *= 1.0 - (0.5 + 0.25 * hA.y) * bu * bu;
    // head-amp noise, band-limited a little by the RF amplifier
    vec2 nz = gauss2(x - 1 + q, row, uFrame * 7 + 3) * 0.6 + gauss2(x + q, row, uFrame * 7 + 3) * 0.8;
    rf[q] = a * cis(TAU * phO) + b * cis(TAU * phF) + sg * nz;
  }
  // limiter + pulse-count discriminator: a pulse at every crossing of the
  // limiter's slicing level, and the pulse rate is the frequency. The level
  // sits a little off zero (offset, hysteresis), set against the RF the AGC
  // expects. A carrier that has sunk below it makes no crossings at all and
  // the output falls toward zero frequency: white goes black. Just above it
  // the crossings bunch into pairs and the carrier itself leaks through.
  float lim = uLim * (A + B) * exp(-uHR * 0.6);
  // The limiter's state is read off each sample's own value, so the two
  // intervals that share a sample always agree on it; between samples the
  // carrier is followed in quarter steps (a pair of crossings closer than
  // that is too short a pulse for the one-shot and is lost, as in the deck).
  float n = 0.0;
  for (int iv = 0; iv < 2; iv++) {
    vec2 z0 = rf[iv], z1 = rf[iv + 1];
    float a0 = length(z0), a1 = length(z1);
    float t0 = atan(z0.y, z0.x);
    float dth = atan(z1.y, z1.x) - t0;
    dth -= TAU * floor(dth / TAU + 0.5);
    float v = z0.x - lim;
    for (int j = 1; j <= 4; j++) {
      float u = float(j) * 0.25;
      float v1 = j == 4 ? z1.x - lim : mix(a0, a1, u) * cos(t0 + dth * u) - lim;
      if ((v > 0.0) != (v1 > 0.0)) {
        float uc = (float(j - 1) + v / (v - v1)) * 0.25;
        n += iv == 0 ? uc : 1.0 - uc;
      }
      v = v1;
    }
  }
  float fq = n * 0.5 * FS;
  float Y = (fq - 3.4) * 140.0 - 40.0;

  // colour-under: own track, the far track, and the adjacent track's
  // crosstalk (phase-rotated 90 degrees a line by PS, so the comb removes it)
  float xc = float(x) - e - uCDelay;
  float dm = dropMul(float(x), p2, p3.w, p4.w);
  float far = max(B - 0.04 * p4.z, 0.0);
  vec2 uvO = sinterp(uPhi, row, xc).yz;
  vec2 uvF = sinterp(uPhi, rowF, xc - dFar).yz;
  float ps = (l & 1) == 0 ? 1.0 : -1.0;
  vec2 uvA = ps * vec2(-uvO.y, uvO.x);
  vec2 uv = (A * uvO + far * uvF + 0.5 * p4.z * uvA) * dm;
  float acc = max(A + far + 0.3 * p4.z, 0.12);
  uv += uCNoise * gauss2(x, row, uFrame * 5 + 11);
  uv /= acc;
  float th = p1.y + p1.z * float(x);
  float ct = cos(th), st = sin(th);
  vec2 rot = vec2(uv.x * ct - uv.y * st, uv.y * ct + uv.x * st);
  float flag = dm < 0.1 ? 1.0 : 0.0;
  o = vec4(Y, rot, flag);
}`;

// Playback luma LPF and trap, then de-emphasis. De-emphasis is the inverse RC
// shelf, so it is causal too: a click leaves a tail running off to the right.
const FS_POST = `${HEAD}
uniform sampler2D uT; uniform float uKP[96]; uniform float uKCp[33];
void main(){
  int x = int(gl_FragCoord.x); int row = int(gl_FragCoord.y);
  float Y = 0.0; vec2 uv = vec2(0.0); float fl = 0.0;
  for (int j = 0; j < 96; j++) Y += uKP[j] * texelFetch(uT, ivec2(clamp(x + 16 - j, 0, LW - 1), row), 0).r;
  for (int k = -16; k <= 16; k++) {
    vec4 t = texelFetch(uT, ivec2(clamp(x + k, 0, LW - 1), row), 0);
    uv += uKCp[k + 16] * t.gb;
    if (k >= -8 && k <= -3) fl = max(fl, t.a);
  }
  Y = clamp(Y, -60.0, 135.0);
  o = vec4(Y, uv, fl);
}`;

// Dropout compensator, chroma comb, re-modulation.
const FS_PLAY = `${HEAD}
uniform sampler2D uPost;
void main(){
  int x = int(gl_FragCoord.x); int row = int(gl_FragCoord.y);
  int f = row / FHL; int l = row - f * FHL;
  vec4 cur = texelFetch(uPost, ivec2(x, row), 0);
  vec4 prev = l > 0 ? texelFetch(uPost, ivec2(x, row - 1), 0) : cur;
  float Y = cur.a > 0.5 ? prev.r : cur.r;
  vec2 uv = cur.a > 0.5 ? prev.gb : 0.5 * (cur.gb + prev.gb);
  float c = TAU * scPhase(float(x), l, f);
  o = vec4(Y + uv.x * sin(c) + uv.y * cos(c), Y, uv);
}`;

// The TV.
const FS_TV = `${HEAD}
uniform sampler2D uS; uniform sampler2D uP; uniform int uRoll;
uniform float uKN[21]; uniform float uKCt[21]; uniform float uSat;
void main(){
  int x = int(gl_FragCoord.x); int yd = int(gl_FragCoord.y);
  int f = yd & 1;
  int l = (21 + (yd >> 1) + uRoll) % FHL;
  int row = f * FHL + l;
  vec4 p1 = texelFetch(uP, ivec2(1, row), 0);
  vec4 p4 = texelFetch(uP, ivec2(4, row), 0);
  float s = float(AX + x) + p1.x;
  float Y = 0.0; vec2 uv = vec2(0.0);
  for (int k = -10; k <= 10; k++) {
    float sk = s + float(k);
    float v = sinterp(uS, row, sk).r;
    Y += uKN[k + 10] * v;
    float c = TAU * scPhase(sk, l, f) + p4.x;
    uv += uKCt[k + 10] * v * 2.0 * vec2(sin(c), cos(c));
  }
  uv *= p4.y * uSat;
  float yn = (Y - 7.5) / 92.5;
  vec2 cn = uv / 92.5;
  vec3 rgb = vec3(yn + 1.140 * cn.y, yn - 0.395 * cn.x - 0.581 * cn.y, yn + 2.032 * cn.x);
  o = vec4(max(rgb, 0.0), 1.0);
}`;

// The monitor: each line is a beam whose spot grows with current.
const FS_SHOW = `${HEAD}
uniform sampler2D uTv; uniform vec4 uRect; uniform vec2 uCanvas; uniform float uLinePx; uniform int uRaw;
void main(){
  vec2 px = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  if (uRaw == 1) { ivec2 q = ivec2(px); if (q.x >= ${CAM_W} || q.y >= ${CAM_H}) { o = vec4(0.0,0.0,0.0,1.0); return; } vec3 c = texelFetch(uTv, q, 0).rgb; o = vec4(pow(pow(min(c, vec3(1.0)), vec3(2.4)), vec3(1.0/2.2)), 1.0); return; }
  vec2 r = (px - uRect.xy) / uRect.zw;
  if (r.x < 0.0 || r.x > 1.0 || r.y < -0.01 || r.y > 1.01) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float v = r.y * 480.0;
  float u = r.x;
  float pxl = 1.0 / uLinePx; // one device pixel in line units
  vec3 acc = vec3(0.0);
  int L0 = int(floor(v)) - 2;
  for (int i = 0; i < 5; i++) {
    int L = L0 + i;
    if (L < 0 || L >= 480) continue;
    vec3 c = texture(uTv, vec2(u, (float(L) + 0.5) / 480.0)).rgb;
    vec3 I = pow(min(c, vec3(1.25)), vec3(2.4));
    vec3 sg = 0.2 + 0.2 * sqrt(min(I, vec3(1.5)));
    sg = sqrt(sg * sg + pxl * pxl / 12.0);
    float d = v - (float(L) + 0.5);
    acc += I * exp(-d * d / (2.0 * sg * sg)) / (sg * 2.5066);
  }
  acc *= 0.98;
  vec3 srgb = mix(acc * 12.92, 1.055 * pow(acc, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, acc));
  o = vec4(clamp(srgb, 0.0, 1.0), 1.0);
}`;

// ---------------------------------------------------------------- engine

export async function createSignal(host, { embedded = false } = {}) {
  const stage = createStage(host, { dpr: 2, webgl: true, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  if (!gl.getExtension("EXT_color_buffer_float")) throw new Error("float render targets unavailable");
  gl.getExtension("OES_texture_float_linear");

  const query = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
  const still = query.has("t") || query.has("track") || query.has("wear");
  const stillT = parseFloat(query.get("t") || "4");
  const raw = query.has("raw");
  const glare = parseFloat(query.get("glare") || "0.08");
  // The over-white failure, as numbers. The camcorder clips white at 114%
  // (super-white); the record side clips the pre-emphasised luma again at
  // 120 IRE, as real decks do, so no carrier is ever driven far past the top
  // of the channel; the camera's colour-difference gain at a blown edge; the top of
  // the playback channel (MHz) and how steeply it closes; and the limiter's
  // slicing level against the RF the AGC expects. Together they keep the
  // sun's parked super-white carrier about three times clear of the slicing
  // level, so the disc plays back blown white. Only the clipped overshoot at
  // its rim, and the moments where an asperity, flutter or crosstalk dips the
  // carrier, take it under: short black comets that de-emphasis drags off to
  // the right. 100 IRE white stays six times clear.
  const WHITE = 1.14;
  const REC_WHITE = 120;
  const FALSE_C = 10;
  const EDGE_F = 4.46;
  const EDGE_N = 16;
  const LIM = 0.12;

  // ---- GL helpers
  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) + "\n" + src.split("\n").map((l, i) => `${i + 1}: ${l}`).join("\n").slice(0, 4000));
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, VS);
  const program = (src) => {
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, src));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const loc = {};
    return {
      p,
      u(name) {
        if (!(name in loc)) loc[name] = gl.getUniformLocation(p, name);
        return loc[name];
      },
    };
  };
  let texIds = 0;
  const tex = (w, h, internal, format, type, filter = gl.NEAREST, data = null) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.LINEAR_MIPMAP_LINEAR ? gl.LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    t.w = w;
    t.h = h;
    t.id = ++texIds;
    return t;
  };
  const f32 = (w, h, filter) => tex(w, h, gl.RGBA32F, gl.RGBA, gl.FLOAT, filter);
  const f16 = (w, h, filter) => tex(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, filter);
  const fbos = new Map();
  const target = (...ts) => {
    const key = ts.map((t) => t.id).join(",");
    let fb = fbos.get(key);
    if (!fb) {
      fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      ts.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
      gl.drawBuffers(ts.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
      fbos.set(key, fb);
    }
    return fb;
  };
  const vao = gl.createVertexArray();
  const run = (prog, outs, bind) => {
    gl.useProgram(prog.p);
    let unit = 0;
    const api = {
      t(name, t) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.uniform1i(prog.u(name), unit++);
      },
      f(name, ...v) {
        const l = prog.u(name);
        if (v.length === 1 && v[0] instanceof Float32Array) gl.uniform1fv(l, v[0]);
        else gl[`uniform${v.length}f`](l, ...v);
      },
      i(name, v) {
        gl.uniform1i(prog.u(name), v);
      },
    };
    gl.uniform1i(prog.u("uFrame"), frameNo);
    bind(api);
    if (outs) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target(...outs));
      gl.viewport(0, 0, outs[0].w, outs[0].h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // ---- assets
  const loadImage = (src) =>
    new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = src;
    });
  const [sceneImg, hiImg] = await Promise.all([loadImage("/lab/signal/scene.webp"), loadImage("/lab/signal/hi.png")]);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  const sceneTex = tex(sceneImg.width, sceneImg.height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST, null);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, sceneImg);
  const hiTex = tex(hiImg.width, hiImg.height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR, null);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, hiImg);
  const radTex = f16(sceneImg.width, sceneImg.height, gl.LINEAR_MIPMAP_LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, sceneImg.width, sceneImg.height, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.generateMipmap(gl.TEXTURE_2D);

  const P = {
    decode: program(FS_DECODE),
    expose: program(FS_EXPOSE),
    column: program(FS_COLUMN),
    bloom: program(FS_BLOOM),
    camout: program(FS_CAMOUT),
    encode: program(FS_ENCODE),
    recsep: program(FS_RECSEP),
    fm: program(FS_FM),
    pa: program(FS_PREFIX_A),
    pb: program(FS_PREFIX_B),
    rowoff: program(FS_ROWOFF),
    tape: program(FS_TAPE),
    post: program(FS_POST),
    play: program(FS_PLAY),
    tv: program(FS_TV),
    show: program(FS_SHOW),
    blur: program(FS_BLUR),
  };

  let frameNo = 0;
  run(P.decode, [radTex], (a) => {
    a.t("uScene", sceneTex);
    a.t("uHi", hiTex);
  });
  gl.bindTexture(gl.TEXTURE_2D, radTex);
  gl.generateMipmap(gl.TEXTURE_2D);

  // glare: aureole, halo and veil
  const glTmp = f16(GL_W, GL_H, gl.LINEAR);
  const glTex = f16(GL_W, GL_H, gl.LINEAR);
  gl.bindFramebuffer(gl.FRAMEBUFFER, target(glTex));
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  for (const [sigma, w] of [[2.2, 0.55], [7, 0.3], [24, 0.15]]) {
    run(P.blur, [glTmp], (a) => {
      a.t("uSrc", radTex);
      a.f("uDir", 1, 0);
      a.f("uSigma", sigma);
      a.f("uLod", 2);
      a.f("uW", 1);
    });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    run(P.blur, [glTex], (a) => {
      a.t("uSrc", glTmp);
      a.f("uDir", 0, 1);
      a.f("uSigma", sigma);
      a.f("uLod", 0);
      a.f("uW", w);
    });
    gl.disable(gl.BLEND);
  }

  const qTex = f32(CAM_W, CAM_H);
  const colTex = f32(CAM_W, 1);
  const bloomTex = f32(CAM_W, CAM_H);
  const camTex = f16(CAM_W, CAM_H);
  const res = [f32(CAM_W, CAM_H), f32(CAM_W, CAM_H)];
  const S = [0, 1, 2, 3, 4].map(() => f32(SIG_W, SIG_H));
  const tvTex = f16(CAM_W, CAM_H, gl.LINEAR);
  const paramTex = f32(PARAM_COLS, SIG_H);
  const offTex = f32(1, SIG_H);

  // ---- fixed kernels
  const K = {
    Y: kernel(gaussLP(4.2), 14),
    I: kernel(gaussLP(1.3), 14),
    Q: kernel(gaussLP(0.4), 14),
    Yr: kernel((f) => gaussLP(3.1)(f) * notch(3.58, 0.45, 0.97)(f), 8),
    Cr: kernel(gaussLP(0.5), 14),
    N: kernel((f) => notch(3.58, 0.6, 0.96)(f) * gaussLP(3.8)(f) * (1 + 0.35 * Math.sin(Math.min(1, f / 2.6) * Math.PI)), 10),
    Ct: kernel(gaussLP(0.85), 10),
  };
  // VHS emphasis: a high-shelf of +10 dB with an RC corner near 0.45 MHz on
  // record, and its exact inverse on playback. Both are one-pole networks.
  const EMPH = 2.2;
  const EA = Math.exp((-2 * Math.PI * 0.45) / FS);
  const preEmph = new Float32Array(33);
  {
    let neg = 0;
    for (let k = 1; k < 33; k++) neg += (preEmph[k] = -EMPH * (1 - EA) * Math.pow(EA, k));
    preEmph[0] = 1 + EMPH - EMPH * (1 - EA);
    const sc = (preEmph[0] - 1) / -neg; // exact unity at DC after truncation
    for (let k = 1; k < 33; k++) preEmph[k] *= sc;
  }
  const deEmph = new Float64Array(64);
  {
    for (let n = 0; n < 64; n++) {
      let v = n === 0 ? 1 : 0;
      for (let k = 1; k <= Math.min(n, 32); k++) v -= preEmph[k] * deEmph[n - k];
      deEmph[n] = v / preEmph[0];
    }
    const sum = deEmph.reduce((a, b) => a + b, 0);
    for (let n = 0; n < 64; n++) deEmph[n] /= sum;
  }
  // a symmetric FIR (taps -16..16) followed by the causal de-emphasis, as one
  // kernel over delays -16..79
  const withDeEmph = (h) => {
    const out = new Float32Array(96);
    for (let i = 0; i < 33; i++) for (let n = 0; n < 64; n++) out[i + n] += h[i] * deEmph[n];
    return out;
  };
  let wearKernels = null;
  let wearKey = -1;
  const kernelsFor = (g) => {
    const key = Math.round(g * 40);
    if (key === wearKey) return wearKernels;
    wearKey = key;
    const fcY = 2.9 / Math.pow(g, 0.4);
    const fcC = 0.5 / Math.pow(g, 0.3);
    wearKernels = {
      // playback luma: LPF and a shallow 3.58 MHz trap (a cheap deck), then
      // de-emphasis. What the trap lets by, the TV decodes as colour.
      P: withDeEmph(kernel((f) => butter(fcY, 4)(f) * notch(3.58, 0.6, 0.75)(f), 16)),
      Cp: kernel(gaussLP(fcC), 16),
    };
    return wearKernels;
  };

  // ---- model and interaction
  const model = createModel(11);
  // `track` is the head's offset from the recorded tracks (0 is the sweet
  // spot). The tape was recorded on another deck, so the knob's centre click
  // sits half a pitch off it: the picture opens nearly, not quite, in track.
  const sweet = 0;
  const CENTRE_CLICK = 0.5;
  let trackUser = still ? sweet + parseFloat(query.get("track") || "0") : CENTRE_CLICK;
  let wearUser = still ? clamp(parseFloat(query.get("wear") || "0.35"), 0, 1) : 0.35;
  // the capstan servo answers the knob with a little hunting
  const servo = { x: trackUser, v: 0 };
  let wearS = wearUser;
  let drag = null;

  stage.on("down", (p) => {
    drag = { x: p.x, y: p.y, t0: trackUser, w0: wearUser };
  });
  stage.on("move", (p) => {
    if (!drag) return;
    const w = Math.max(240, stage.width);
    trackUser = drag.t0 + ((p.x - drag.x) / w) * 2.6;
    wearUser = clamp(drag.w0 + ((p.y - drag.y) / Math.max(200, stage.height)) * 1.4, 0, 1);
  });
  stage.on("up", () => {
    drag = null;
    // the knob has a centre click
    if (Math.abs(trackUser - CENTRE_CLICK) < 0.07) trackUser = CENTRE_CLICK;
  });

  // ---- layout
  let rect = [0, 0, 1, 1];
  let linePx = 2;
  const layout = (w, h, dpr) => {
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    const margin = embedded ? 0.04 : 0.1;
    let ih = H * (1 - 2 * margin);
    let iw = (ih * 4) / 3;
    if (iw > W * (1 - 2 * margin)) {
      iw = W * (1 - 2 * margin);
      ih = (iw * 3) / 4;
    }
    // whole device pixels per line where the box allows it, so every line
    // lands on the same pixel phase; give up a little margin to get there
    const per = ih / 480;
    const up = Math.round(per);
    if (per >= 2) ih = (up * 480 <= H * 0.97 && (up * 640) <= W * 0.97 ? up : Math.floor(per)) * 480;
    iw = (ih * 4) / 3;
    linePx = ih / 480;
    rect = [Math.round((W - iw) / 2), Math.round((H - ih) / 2), iw, ih];
  };
  stage.onResize(layout);

  // ---- one video frame through the chain
  let roll = 0;
  const swayAt = (t) => [
    0.006 * Math.sin(6.283 * 0.31 * t) + 0.0035 * Math.sin(6.283 * 0.73 * t + 1) + 0.0018 * Math.sin(6.283 * 1.9 * t + 2),
    0.005 * Math.sin(6.283 * 0.27 * t + 0.5) + 0.003 * Math.sin(6.283 * 0.81 * t + 2.2) + 0.0015 * Math.sin(6.283 * 2.3 * t),
    0.004 * Math.sin(6.283 * 0.19 * t + 0.3),
    1 + 0.004 * Math.sin(6.283 * 0.11 * t),
  ];

  const renderFrame = (t, gpu = true) => {
    const { params, roll: r, g } = model.step(t, servo.x, wearS, servo.v);
    roll = r;
    if (!gpu) {
      frameNo++;
      return;
    }
    gl.bindTexture(gl.TEXTURE_2D, paramTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PARAM_COLS, SIG_H, gl.RGBA, gl.FLOAT, params);
    const wk = kernelsFor(g);
    const sway = swayAt(t);
    const rIn = res[frameNo & 1];
    const rOut = res[(frameNo + 1) & 1];

    run(P.expose, [qTex], (a) => {
      a.t("uRad", radTex);
      a.t("uRes", rIn);
      a.f("uSway", ...sway);
      a.f("uE", 0.42 / 4);
      a.t("uGl", glTex);
      a.f("uGlare", glare);
    });
    run(P.column, [colTex], (a) => a.t("uQ", qTex));
    run(P.bloom, [bloomTex], (a) => {
      a.t("uQ", qTex);
      a.f("uBloom", 0.0035);
      a.f("uBloomL", 7);
    });
    run(P.camout, [camTex, rOut], (a) => {
      a.t("uQ", qTex);
      a.t("uB", bloomTex);
      a.t("uCol", colTex);
      a.f("uSmear", 1.1e-6);
      a.f("uLag", 0.55);
      a.f("uLagCap", 6);
      a.f("uWhite", WHITE);
      a.f("uFalse", FALSE_C);
    });
    run(P.encode, [S[0]], (a) => {
      a.t("uCam", camTex);
      a.f("uKY", K.Y);
      a.f("uKI", K.I);
      a.f("uKQ", K.Q);
      a.f("uDetail", 0.55);
    });
    run(P.recsep, [S[1]], (a) => {
      a.t("uComp", S[0]);
      a.f("uKYr", K.Yr);
      a.f("uKCr", K.Cr);
    });
    run(P.fm, [S[2]], (a) => {
      a.t("uRec", S[1]);
      a.f("uKE", preEmph);
      a.f("uClip", -40 - 38, REC_WHITE);
    });
    run(P.pa, [S[3]], (a) => a.t("uFm", S[2]));
    run(P.pb, [S[4]], (a) => a.t("uA", S[3]));
    run(P.rowoff, [offTex], (a) => a.t("uPhi", S[4]));
    run(P.tape, [S[0]], (a) => {
      a.t("uPhi", S[4]);
      a.t("uP", paramTex);
      a.t("uOff", offTex);
      a.f("uEdge", EDGE_F, EDGE_N);
      a.f("uLim", LIM);
      a.f("uFlutter", 0.45 + 0.3 * wearS);
      a.f("uAsp", 0.012 + 0.03 * wearS);
      a.f("uHR", 0.3 + 0.85 * wearS);
      a.f("uCNoise", 1.2 * g);
      a.f("uCDelay", 7 + 2.5 * (g - 1));
    });
    run(P.post, [S[1]], (a) => {
      a.t("uT", S[0]);
      a.f("uKP", wk.P);
      a.f("uKCp", wk.Cp);
    });
    run(P.play, [S[2]], (a) => a.t("uPost", S[1]));
    run(P.tv, [tvTex], (a) => {
      a.t("uS", S[2]);
      a.t("uP", paramTex);
      a.i("uRoll", roll);
      a.f("uKN", K.N);
      a.f("uKCt", K.Ct);
      a.f("uSat", 1.05 / Math.pow(g, 0.12));
    });
    frameNo++;
  };

  const show = () => {
    run(P.show, null, (a) => {
      a.t("uTv", tvTex);
      a.f("uRect", ...rect);
      a.f("uCanvas", gl.drawingBufferWidth, gl.drawingBufferHeight);
      a.f("uLinePx", linePx);
      a.i("uRaw", raw ? 1 : 0);
    });
  };

  // servo: spring toward the knob, a touch underdamped
  const servoStep = (dt) => {
    const k = 140;
    const c = 2 * 0.55 * Math.sqrt(k);
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      const h = dt / steps;
      servo.v += (k * (trackUser - servo.x) - c * servo.v) * h;
      servo.x += servo.v * h;
    }
  };

  // ---- time
  let clock = 0;
  let shownFor = "";
  let acc = 0;
  const FRAME = 1 / 29.97;

  if (still) {
    // run the line model from zero so every PLL has its history, then
    // put the last few frames through the GPU so the sensor lag settles
    // the knob is turned to its position `turn` seconds before the still,
    // so the servo (and everything locked to it) is caught mid-move
    const target = trackUser;
    const turn = parseFloat(query.get("turn") || "0");
    const n = Math.round(stillT / FRAME);
    servo.x = turn > 0 ? sweet : target;
    for (let i = 0; i < n; i++) {
      const t = i * FRAME;
      trackUser = turn > 0 && t < stillT - turn ? sweet : target;
      servoStep(FRAME);
      renderFrame(t, i >= n - 4);
    }
    clock = n * FRAME;
  }

  stage.onFrame((dt) => {
    if (still) {
      // a still is drawn once per size
      if (shownFor !== rect.join()) {
        shownFor = rect.join();
        show();
      }
      return;
    }
    servoStep(dt);
    wearS += (wearUser - wearS) * (1 - Math.exp(-dt * 6));
    acc += dt;
    let did = false;
    while (acc >= FRAME) {
      acc -= FRAME;
      clock += FRAME;
      renderFrame(clock);
      did = true;
      if (acc > FRAME * 3) acc = 0;
    }
    if (did) show();
  });

  return {
    destroy() {
      stage.destroy();
    },
  };
}
