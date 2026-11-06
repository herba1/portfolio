import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Train Window: looking out of a local train on a summer day.
//
// The view is a pinhole looking square out of the side of the carriage, in
// image-plane units (tan of the angle), horizon at y = 0, camera 1.7 m up.
// Moving along the track by s metres moves everything at distance D by s / D,
// so each layer slides at its own speed:
//
//  - the field is a flat plane: a row y below the horizon is at D = h / -y,
//    so the ground is not one layer but a continuous shear, each row sliding
//    at V·(-y)/h (Poly Haven `rural_asphalt_road`, reprojected square out of
//    the road onto the plane, made periodic with a noise-masked crossfade);
//  - the hedge, barn and trees at the far edge of the field (~70 m), cut from
//    the same plate with Depth Anything V2 and a colour key, tiled with a
//    mirror and a gap so the open country behind shows through;
//  - the far tree line and farmland (~900 m), a mirrored strip;
//  - cumulus at a few kilometres (Poly Haven `kloofendal_48d_partly_cloudy`
//    pure sky, rotated so its sun agrees with the plate's), which barely move;
//  - wooden distribution poles every 30-45 m, 20 m out (Poly Haven
//    `modular_electricity_poles`, rendered in perspective from this camera and
//    lit by the plate's own HDRI), with their conductors drawn as catenaries.
//
// Motion blur is the shutter: every layer is integrated along x over 1/50 s
// at its own screen velocity, so the near grass streaks, the poles smear into
// soft bars, the hedge softens and the clouds stay sharp. The integration
// reads horizontally box-filtered pyramids, so a long streak keeps its
// vertical detail the way a real one does.
//
// Drag sideways to set the train's speed and direction; let go and it coasts
// down to a crawl. Query: ?v=m/s holds a speed (blur visible), ?s=metres sets
// the position along the track, ?still=1 skips the reveal, ?dbg=1/2/4 hides
// the far tree line / hedge / poles.

const BASE = "/lab/train-window/";
const LO = -8.0;
const HI = 1.5;

const CAM_H = 1.7; // camera height above the field (m)
const D_HEDGE = 120; // hedge and barn
const HEDGE_SCALE = 0.55; // the plate's hedge, set back to that distance
const D_DIST = 900; // far tree line
const D_SKY = 3000; // cumulus
const D_POLE = 20; // pole line
const POLE_SCALE = 1.45; // model units -> metres
const POLE_CELL = 37; // mean spacing (m)
const SHUTTER = 1 / 50;
const V_MAX = 34; // m/s, a fast local
const V_CRUISE = 2.4; // the crawl it coasts down to
const HFOV = 0.9326; // 2·tan(25°): a 50° lens across the print

// Asset geometry (from the bake).
const SKY = { el0: 21.5, el1: -2.5, yaw: -112 };
const DIST = { yaw0: -10, yaw1: 44, el0: 6, el1: -1 };
const HEDGE = { yaw0: 43, yaw1: 120.5, el0: 15, el1: -1.4, gap: 62 };
const GROUND = { y0: -0.004, y1: -0.335, x0: -0.95, period: 1.65 };
const POLE = { l: -0.075, r: 0.075, b: -0.092, t: 0.369111, n: 4, rot: [1.22, 1.22, -1.22, -1.22] };
const LEVELS = 7;

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const SCENE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSky;
uniform sampler2D uDist;
uniform sampler2D uGround;  // horizontal box pyramid atlas, premultiplied linear
uniform sampler2D uHedge;
uniform sampler2D uPoles;
uniform vec4 uGroundLv[${LEVELS}]; // x offset (texels), width (texels), atlas width, unused
uniform vec4 uHedgeLv[${LEVELS}];
uniform vec4 uPolesLv[${LEVELS}];

uniform vec4 uView;     // x0, y0, w, h in image-plane units
uniform float uS;       // metres along the track
uniform float uV;       // m/s
uniform float uShutter;
uniform float uPx;      // one render pixel in image-plane units
uniform float uSkyDrift;
uniform float uExpo;
uniform float uGrad;
uniform float uPol;
uniform vec4 uPole[8];  // per candidate pole: screen x, sprite index, attach flip, unused
uniform int uPoleN;
uniform int uDbg;

const float LO = ${LO.toFixed(2)};
const float HI = ${HI.toFixed(2)};
const float H = ${CAM_H.toFixed(3)};
const float DEG = 57.29578;

vec3 dec(vec3 v) { return exp2(v * (HI - LO) + LO); }

// One tap of a horizontal-box pyramid: level l, u in [0,1) (wrapped by the
// caller), v in [0,1].
vec4 tapLv(sampler2D t, vec4 lv, float u, float v) {
  float x = lv.x + u * lv.y;
  return texture(t, vec2(x / lv.z, v));
}

// Box blur of width 'len' texels (level 0) centred on u, from the pyramid.
// wrap: 1 periodic, 0 clamp.
#define BLUR(NAME, TEX, LV, N) \
vec4 NAME(float u, float v, float len, float wrap) { \
  if (len < 1.0) { \
    float uu = wrap > 0.5 ? fract(u) : clamp(u, 0.0, 1.0); \
    return tapLv(TEX, LV[0], uu, v); \
  } \
  float sp = len / float(N); \
  float lf = clamp(log2(max(sp, 1.0)) + 0.7, 0.0, float(${LEVELS - 1}) - 0.001); \
  int l0 = int(floor(lf)); \
  float f = lf - float(l0); \
  vec4 a = vec4(0.0), b = vec4(0.0); \
  float w0 = LV[0].y; \
  for (int i = 0; i < N; i++) { \
    float o = ((float(i) + 0.5) / float(N) - 0.5) * len / w0; \
    float uu = u + o; \
    uu = wrap > 0.5 ? fract(uu) : clamp(uu, 0.0, 1.0); \
    a += tapLv(TEX, LV[l0], uu, v); \
    b += tapLv(TEX, LV[min(l0 + 1, ${LEVELS - 1})], uu, v); \
  } \
  return mix(a, b, f) / float(N); \
}
BLUR(blurGround, uGround, uGroundLv, 10)
BLUR(blurPoles, uPoles, uPolesLv, 16)

// The hedge is tiled H | mirror(H) | gap; every tap finds its own tile.
vec4 hedgeAt(float yawDeg, float v, float lenDeg, float lv) {
  float L = ${(HEDGE.yaw1 - HEDGE.yaw0).toFixed(3)};
  float P = 2.0 * L + ${HEDGE.gap.toFixed(3)};
  const int N = 8;
  int n = lenDeg * uHedgeLv[0].y / L < 1.0 ? 1 : N;
  int l = int(lv);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < N; i++) {
    if (i >= n) break;
    float o = n == 1 ? 0.0 : ((float(i) + 0.5) / float(N) - 0.5) * lenDeg;
    float p = mod(yawDeg + o, P);
    if (p < 2.0 * L) {
      float u = p < L ? p / L : 1.0 - (p - L) / L;
      acc += tapLv(uHedge, uHedgeLv[l], clamp(u, 0.0, 1.0), v);
    }
  }
  return acc / float(n);
}

float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453); }

void main() {
  vec2 p = uView.xy + vUv * uView.zw;
  float x = p.x, y = p.y;
  float yaw = atan(x) * DEG;
  float el = atan(y / sqrt(1.0 + x * x)) * DEG;
  float aV = abs(uV);

  // Sky: cumulus a few km off, rotating past very slowly.
  float skyYaw = yaw + ${SKY.yaw.toFixed(2)} + (uS / ${D_SKY.toFixed(1)}) * DEG + uSkyDrift;
  vec2 su = vec2(skyYaw / 360.0 + 0.5, (${SKY.el0.toFixed(2)} - el) / ${(SKY.el0 - SKY.el1).toFixed(2)});
  // The clear blue is read from a coarse mip (an 8-bit ramp has no business
  // showing its steps once the polariser deepens it); cloud edges, where the
  // fine and coarse reads disagree, stay sharp.
  vec3 sf = texture(uSky, su).rgb;
  vec3 sc = textureLod(uSky, su, 4.0).rgb;
  float edge = smoothstep(0.012, 0.035, length(sf - sc));
  vec3 col = dec(mix(sc, sf, edge));
  // Polariser on the lens, sun ~60° off the view: the clear (Rayleigh) blue
  // darkens and deepens, cloud white keeps.
  float A = clamp((0.9 * col.b - col.r) / 0.5, 0.0, col.b);
  col = col - A * vec3(0.30, 0.45, 0.9) * uPol + A * vec3(0.0, 0.30, 0.66) * uPol;

  // Far tree line and farmland, mirrored.
  float dYaw = yaw + 6.0 + (uS / ${D_DIST.toFixed(1)}) * DEG;
  vec2 du = vec2(dYaw / ${(DIST.yaw1 - DIST.yaw0).toFixed(2)}, (${DIST.el0.toFixed(2)} - el) / ${(DIST.el0 - DIST.el1).toFixed(2)});
  vec4 dt = texture(uDist, du);
  if ((uDbg & 1) == 0) col = mix(col, dec(dt.rgb), dt.a);

  // Ground: a flat field, each row at its own distance h / -y.
  vec4 g = vec4(0.0);
  float gFar = 0.0, gNear = 0.0;
  if (y < -0.0006) {
    float k = -y / H;                           // 1 / D at this row
    // The plate's field rises to a crest at y = -0.05 (the hedge base hides
    // behind it). Rows above that are read from below the crest, scaled
    // horizontally to the row's own distance, so the field runs flat out to
    // the far hedge.
    float ys = mix(-0.050, ${GROUND.y1.toFixed(4)}, (y - ${GROUND.y0.toFixed(4)}) / ${(GROUND.y1 - GROUND.y0).toFixed(4)});
    float r = ys / y;
    float ux = (x + uS * k) * r;
    float u = (ux - ${GROUND.x0.toFixed(3)}) / ${GROUND.period.toFixed(4)};
    float v = (${GROUND.y0.toFixed(4)} - ys) / ${(GROUND.y0 - GROUND.y1).toFixed(4)};
    float len = aV * k * r * uShutter / ${GROUND.period.toFixed(4)} * uGroundLv[0].y;
    g = blurGround(u, v, len, 1.0);
    g.rgb = mix(vec3(dot(g.rgb, vec3(0.2126, 0.7152, 0.0722))), g.rgb, 0.86);
    gFar = smoothstep(-0.0006, -0.0018, y);
    gNear = smoothstep(-0.0095, -0.0150, y);
  }
  col = mix(col, g.rgb, gFar);

  // Hedge, barn and trees at the far edge of the field.
  float hel = el / ${HEDGE_SCALE.toFixed(3)};
  if (hel < ${HEDGE.el0.toFixed(1)} && hel > ${HEDGE.el1.toFixed(1)}) {
    float hYaw = (yaw + (uS / ${D_HEDGE.toFixed(1)}) * DEG) / ${HEDGE_SCALE.toFixed(3)} + 18.0;
    float v = (${HEDGE.el0.toFixed(2)} - hel) / ${(HEDGE.el0 - HEDGE.el1).toFixed(2)};
    float lenDeg = aV / ${D_HEDGE.toFixed(1)} * uShutter * DEG / ${HEDGE_SCALE.toFixed(3)};
    float texels = lenDeg / ${(HEDGE.yaw1 - HEDGE.yaw0).toFixed(3)} * uHedgeLv[0].y;
    float lv = clamp(floor(log2(max(texels / 8.0, 1.0))), 0.0, float(${LEVELS - 1}));
    vec4 h = hedgeAt(hYaw, v, lenDeg, lv);
    if ((uDbg & 2) == 0) col = col * (1.0 - h.a) + h.rgb;
  }
  col = mix(col, g.rgb, gNear);

  // Conductors: catenaries between consecutive poles, at their own depth.
  float sp = uS + x * ${D_POLE.toFixed(1)};
  float wireA = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i + 1 >= uPoleN) break;
    vec4 a = uPole[i], b = uPole[i + 1];
    // a.x, b.x: along-track positions (m); a.z / b.z: orientation (+1 / -1)
    if (sp < a.x - 3.0 || sp > b.x + 3.0) continue;
    for (int w = 0; w < 4; w++) {
      float side = (w == 0 || w == 2) ? 1.0 : -1.0;     // far / near conductor
      float hz = w < 2 ? ${(5.76 * POLE_SCALE).toFixed(3)} : ${(4.66 * POLE_SCALE).toFixed(3)};
      float zr = 0.43 * ${POLE_SCALE.toFixed(3)};
      // arm end along local z: rotated by the pole's yaw, it lands off the
      // pole along the track by zr·sin r and off it in depth by zr·cos r
      float sr = sin(1.22), cr = cos(1.22);
      float dz = side * zr * cr;
      float axA = -side * zr * sr * a.z;
      float axB = -side * zr * sr * b.z;
      float Dw = ${D_POLE.toFixed(1)} + dz;
      float sw = uS + x * Dw;
      float A0 = a.x + axA, B0 = b.x + axB;
      float t = (sw - A0) / (B0 - A0);
      if (t < -0.02 || t > 1.02) continue;
      float sag = 0.55;
      float z = hz - sag * 4.0 * t * (1.0 - t);
      float yw = (z - H) / Dw;
      float slope = -4.0 * sag * (1.0 - 2.0 * t) / (B0 - A0);
      float d = abs(y - yw) / sqrt(1.0 + slope * slope);
      float hw = 0.011 / Dw;
      float smear = abs(slope) * aV * uShutter / Dw;
      float e = max(hw, 0.5 * uPx) + 0.5 * smear;
      float cov = smoothstep(e + 0.6 * uPx, e - 0.6 * uPx, d) * min(1.0, (2.0 * hw) / (2.0 * e));
      wireA = max(wireA, cov);
    }
  }
  col = mix(col, vec3(0.012, 0.013, 0.015), wireA * 0.92);

  // Poles: sprites rendered from this very camera, smeared by the shutter.
  float lenM = aV * uShutter;                      // metres the train moved
  for (int i = 0; i < 8; i++) {
    if (i >= uPoleN) break;
    vec4 pl = uPole[i];
    float px = (pl.x - uS) / ${D_POLE.toFixed(1)};
    float lx = x - px;
    float hb = 0.5 * lenM / ${D_POLE.toFixed(1)};
    if (lx < ${POLE.l.toFixed(3)} - hb || lx > ${POLE.r.toFixed(3)} + hb) continue;
    if (y < ${POLE.b.toFixed(3)} || y > ${POLE.t.toFixed(4)}) continue;
    float cell = pl.y;
    float uc = (lx - ${POLE.l.toFixed(3)}) / ${(POLE.r - POLE.l).toFixed(3)};
    float v = (${POLE.t.toFixed(4)} - y) / ${(POLE.t - POLE.b).toFixed(4)};
    float cellW = 1.0 / ${POLE.n.toFixed(1)};
    float lenTex = (lenM / ${D_POLE.toFixed(1)}) / ${(POLE.r - POLE.l).toFixed(3)} * cellW * uPolesLv[0].y;
    vec4 pc = blurPoles((cell + uc) * cellW, v, lenTex, 0.0);
    if ((uDbg & 4) == 0) col = col * (1.0 - pc.a) + pc.rgb;
  }

  // A soft graduated ND over the sky, then exposure.
  col *= exp2(-uGrad * smoothstep(0.0, 0.3, y));
  outColor = vec4(col * uExpo, 1.0);
}`;

const BLIT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uFade;
uniform vec3 uPaper;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  outColor = vec4(mix(uPaper, c, uFade), 1.0);
}`;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(p, s);
    gl.deleteShader(s);
  }
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

function imageTexture(gl, img, { wrap = gl.CLAMP_TO_EDGE, mips = true } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// float32 -> float16 bits.
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function toHalf(v) {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 127 + 15;
  const m = x & 0x7fffff;
  if (e <= 0) {
    if (e < -10) return sign;
    return sign | ((m | 0x800000) >> (1 - e + 13));
  }
  if (e >= 31) return sign | 0x7bff;
  return sign | (e << 10) | (m >> 13);
}

// Decode a log-encoded image to premultiplied linear RGBA, then build a
// pyramid that halves only the width (a horizontal box of 2^l texels per
// level), packed side by side in one half-float texture. Motion blur reads it
// so a long streak keeps its full vertical resolution.
function hPyramid(gl, img, { wrap, alpha }) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const cx = cv.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
  cx.drawImage(img, 0, 0);
  const src = cx.getImageData(0, 0, w, h).data;
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = 2 ** ((i / 255) * (HI - LO) + LO);

  const PAD = 2;
  const widths = [];
  let tw = w;
  for (let l = 0; l < LEVELS; l++) {
    widths.push(tw);
    tw = Math.max(1, Math.ceil(tw / 2));
  }
  const offsets = [];
  let total = 0;
  for (let l = 0; l < LEVELS; l++) {
    offsets.push(total + PAD);
    total += widths[l] + PAD * 2;
  }
  const out = new Uint16Array(total * h * 4);
  let lvl = new Float32Array(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    const a = alpha ? src[i * 4 + 3] / 255 : 1;
    lvl[i * 4] = lut[src[i * 4]] * a;
    lvl[i * 4 + 1] = lut[src[i * 4 + 1]] * a;
    lvl[i * 4 + 2] = lut[src[i * 4 + 2]] * a;
    lvl[i * 4 + 3] = a;
  }
  for (let l = 0; l < LEVELS; l++) {
    const lw = widths[l];
    const ox = offsets[l];
    for (let y = 0; y < h; y++) {
      for (let x = -PAD; x < lw + PAD; x++) {
        let sx = x;
        if (wrap) sx = ((x % lw) + lw) % lw;
        else sx = x < 0 ? 0 : x >= lw ? lw - 1 : x;
        const si = (y * lw + sx) * 4;
        const di = (y * total + ox + x) * 4;
        out[di] = toHalf(lvl[si]);
        out[di + 1] = toHalf(lvl[si + 1]);
        out[di + 2] = toHalf(lvl[si + 2]);
        out[di + 3] = toHalf(lvl[si + 3]);
      }
    }
    if (l + 1 < LEVELS) {
      const nw = widths[l + 1];
      const next = new Float32Array(nw * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < nw; x++) {
          const x0 = x * 2;
          let x1 = x0 + 1;
          if (x1 >= lw) x1 = wrap ? 0 : lw - 1;
          const a = (y * lw + x0) * 4;
          const b = (y * lw + x1) * 4;
          const d = (y * nw + x) * 4;
          next[d] = (lvl[a] + lvl[b]) * 0.5;
          next[d + 1] = (lvl[a + 1] + lvl[b + 1]) * 0.5;
          next[d + 2] = (lvl[a + 2] + lvl[b + 2]) * 0.5;
          next[d + 3] = (lvl[a + 3] + lvl[b + 3]) * 0.5;
        }
      }
      lvl = next;
    }
  }
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, total, h, 0, gl.RGBA, gl.HALF_FLOAT, out);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const lv = new Float32Array(LEVELS * 4);
  for (let l = 0; l < LEVELS; l++) {
    lv[l * 4] = offsets[l];
    lv[l * 4 + 1] = widths[l];
    lv[l * 4 + 2] = total;
  }
  return { tex: t, lv };
}

function target(gl, w, h, float) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h, ok };
}

const freeTarget = (gl, t) => {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
};

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];

// Poles stand on a jittered 37 m grid: spacing 28-46 m, never regular.
const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const polePos = (n) => n * POLE_CELL + (hash(n) - 0.5) * 18;
const poleSprite = (n) => Math.floor(hash(n * 3.17 + 9.1) * POLE.n) % POLE.n;

const numParam = (q, k) => {
  const v = q.get(k);
  return v != null && v !== "" && Number.isFinite(+v) ? +v : null;
};

export async function createTrainWindow(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const heldV = numParam(q, "v");
  const startS = numParam(q, "s");
  const held = heldV != null;
  const dbg = numParam(q, "dbg") || 0;
  const still = held || q.get("still") === "1";
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");

  const [skyImg, distImg, hedgeImg, groundImg, polesImg] = await Promise.all(
    ["sky", "distant", "hedge", "ground", "poles"].map((n) => loadImage(`${BASE}${n}.webp`)),
  );
  const sky = imageTexture(gl, skyImg, { wrap: gl.REPEAT });
  const dist = imageTexture(gl, distImg, { wrap: gl.MIRRORED_REPEAT });
  const ground = hPyramid(gl, groundImg, { wrap: true, alpha: false });
  const hedge = hPyramid(gl, hedgeImg, { wrap: false, alpha: true });
  const poles = hPyramid(gl, polesImg, { wrap: false, alpha: true });

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const scene = program(gl, VERT, SCENE);
  const blit = program(gl, VERT, BLIT);
  const film = createFilm(gl, { width: 2, height: 2 });

  // Layout, in css px of the box: a 3:2 print, the window.
  const L = { x: 0, y: 0, w: 1, h: 1 };
  let sceneT = null;
  let filmT = null;
  let scale = 1;
  let lastBox = null;
  const layout = (W, H, dpr) => {
    lastBox = [W, H, dpr];
    if (embedded) {
      Object.assign(L, { x: 0, y: 0, w: W, h: H });
    } else if (W / H < 0.9) {
      const side = Math.max(16, Math.round(W * 0.06));
      let w = W - side * 2;
      let h = w * 1.25;
      if (h > H * 0.74) {
        h = H * 0.74;
        w = h / 1.25;
      }
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 - 12 });
    } else {
      const side = Math.max(24, W * 0.07);
      const w = Math.min(W - side * 2, H * 0.76 * 1.5);
      const h = w / 1.5;
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 - 12 });
    }
    L.x = Math.round(L.x * dpr) / dpr;
    L.y = Math.round(L.y * dpr) / dpr;
    L.w = Math.round(L.w * dpr) / dpr;
    L.h = Math.round(L.h * dpr) / dpr;
    L.pw = Math.max(2, Math.round(L.w * dpr));
    L.ph = Math.max(2, Math.round(L.h * dpr));
    L.rw = Math.max(2, Math.round(L.pw * scale));
    L.rh = Math.max(2, Math.round(L.ph * scale));
    freeTarget(gl, sceneT);
    freeTarget(gl, filmT);
    sceneT = target(gl, L.rw, L.rh, floatOk);
    if (!sceneT.ok) {
      freeTarget(gl, sceneT);
      sceneT = target(gl, L.rw, L.rh, false);
    }
    filmT = target(gl, L.rw, L.rh, false);
    film.resize(L.rw, L.rh);
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  // The lens: 50° across a landscape print; a portrait print keeps the
  // height and narrows. Horizon 62% down: the sky is most of the window.
  const view = () => {
    const aspect = L.pw / L.ph;
    let vw = HFOV;
    let vh = vw / aspect;
    if (vh > 0.66) {
      vh = 0.66;
      vw = vh * aspect;
    }
    return { vw, vh };
  };

  // Train state. s in metres along the track, v in m/s (+ = scenery moves
  // left, the train runs to the right of the view).
  let s = startS != null ? startS : polePos(2) + 3;
  let v = held ? clamp(heldV, -V_MAX, V_MAX) : reduce ? 0 : 13;
  let dir = Math.sign(v) || 1;
  let throttle = null; // { x0, v0 } while dragging

  const inPrint = (p) => p.x >= L.x && p.x <= L.x + L.w && p.y >= L.y && p.y <= L.y + L.h;
  stage.on("down", (p) => {
    if (held || !inPrint(p)) return;
    throttle = { x0: p.x, v0: v };
    stage.canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (!throttle) {
      stage.canvas.style.cursor = inPrint(p) && !held ? "grab" : "";
      return;
    }
  });
  stage.on("up", () => {
    throttle = null;
    stage.canvas.style.cursor = "";
  });

  // Keyboard: arrows nudge the throttle the way a drag would.
  host.tabIndex = embedded ? -1 : 0;
  let keyDir = 0;
  const onKeyDown = (e) => {
    if (e.key === "ArrowLeft") keyDir = 1;
    else if (e.key === "ArrowRight") keyDir = -1;
    else return;
    e.preventDefault();
  };
  const onKeyUp = (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") keyDir = 0;
  };
  host.addEventListener("keydown", onKeyDown);
  host.addEventListener("keyup", onKeyUp);

  let time = 0;
  let t0 = -1;
  let grainClock = 0;
  let grainSeed = 0;
  const poleBuf = new Float32Array(8 * 4);

  const draw = (expoStops, fade, bob) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    const { vw, vh } = view();
    const top = Math.min(vh * 0.62, 0.378) + bob;
    const x0 = -vw / 2;
    const y0 = top - vh;

    // Poles that could touch the print this frame (with the shutter smear).
    const sL = s + (x0 - 0.1) * D_POLE;
    const sR = s + (x0 + vw + 0.1) * D_POLE;
    let n0 = Math.floor(sL / POLE_CELL) - 1;
    while (polePos(n0 + 1) < sL) n0++;
    let count = 0;
    for (let n = n0; count < 8; n++) {
      const pos = polePos(n);
      const sp = poleSprite(n);
      poleBuf[count * 4] = pos;
      poleBuf[count * 4 + 1] = sp;
      poleBuf[count * 4 + 2] = POLE.rot[sp] > 0 ? 1 : -1;
      poleBuf[count * 4 + 3] = 0;
      count++;
      if (pos > sR) break;
    }

    const u = scene.u;
    gl.useProgram(scene.p);
    const bind = (unit, tex, name) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(u[name], unit);
    };
    bind(0, sky, "uSky");
    bind(1, dist, "uDist");
    bind(2, ground.tex, "uGround");
    bind(3, hedge.tex, "uHedge");
    bind(4, poles.tex, "uPoles");
    gl.uniform4fv(u.uGroundLv, ground.lv);
    gl.uniform4fv(u.uHedgeLv, hedge.lv);
    gl.uniform4fv(u.uPolesLv, poles.lv);
    gl.uniform4f(u.uView, x0, y0, vw, vh);
    gl.uniform1f(u.uS, s);
    gl.uniform1f(u.uV, v);
    gl.uniform1f(u.uShutter, SHUTTER);
    gl.uniform1f(u.uPx, vw / L.rw);
    gl.uniform1f(u.uSkyDrift, reduce || still ? 0 : time * 0.04);
    gl.uniform1f(u.uExpo, 1.15 * 2 ** expoStops);
    gl.uniform1f(u.uGrad, 0.35);
    gl.uniform1f(u.uPol, 0.85);
    gl.uniform4fv(u.uPole, poleBuf);
    gl.uniform1i(u.uPoleN, count);
    gl.uniform1i(u.uDbg, dbg);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, L.rw, L.rh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    film.render(
      sceneT.tex,
      {
        ...FILM_PRESETS.summer,
        input: floatOk && sceneT.ok ? "linear" : "srgb",
        whitePoint: 2.2,
        grainSeed,
      },
      filmT.fbo,
    );

    gl.bindVertexArray(vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.clearColor(PAPER[0], PAPER[1], PAPER[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const dpr = stage.dpr;
    const vx = Math.round(L.x * dpr);
    const vy = stage.canvas.height - Math.round(L.y * dpr) - L.ph;
    gl.viewport(vx, vy, L.pw, L.ph);
    gl.useProgram(blit.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, filmT.tex);
    gl.uniform1i(blit.u.uTex, 0);
    gl.uniform1f(blit.u.uFade, fade);
    gl.uniform3fv(blit.u.uPaper, PAPER);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // Reveal: the print comes up overexposed, a white-blue summer glare, and
  // settles over two seconds while the train is already rolling.
  const REVEAL = 2.0;
  let slow = 0;
  let lastNow = 0;
  let phase = 0;
  let drawnFor = null;
  stage.onFrame((dt) => {
    if (!sceneT) return;
    // A held still renders once per layout and then rests (headless GL is slow).
    if (still && drawnFor === sceneT) return;
    const now = performance.now();
    const real = lastNow ? (now - lastNow) / 1000 : 1 / 60;
    lastNow = now;
    if (!still) {
      const r = Math.min(real, 0.25);
      slow = real > 1 / 40 ? slow + r : Math.max(0, slow - r * 0.5);
      if (slow > 1.2 && scale > 0.5) {
        scale = scale > 0.8 ? 0.75 : 0.5;
        slow = 0;
        if (lastBox) layout(...lastBox);
      }
    }
    time += dt;
    if (t0 < 0) t0 = time;
    const age = still ? 99 : time - t0;
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 2.5 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
    }

    if (!held) {
      if (throttle) {
        // Drag offset sets the speed: a third of the print is full speed.
        const dx = stage.pointer.x - throttle.x0;
        const goal = clamp(throttle.v0 - (dx / (L.w * 0.34)) * V_MAX, -V_MAX, V_MAX);
        v += (goal - v) * (1 - Math.exp(-dt / 0.35));
        if (Math.abs(v) > 0.3) dir = Math.sign(v);
      } else if (keyDir) {
        v = clamp(v + keyDir * 14 * dt, -V_MAX, V_MAX);
        if (Math.abs(v) > 0.3) dir = Math.sign(v);
      } else {
        // Coasting: a train sheds speed slowly, down to a crawl.
        const goal = reduce ? 0 : dir * V_CRUISE;
        v += (goal - v) * (1 - Math.exp(-dt / 2.8));
      }
      s += v * dt;
    }
    phase += Math.abs(v) * dt;

    // Grain at 24 fps.
    if (!reduce && !still) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        grainSeed = (grainSeed + 1) % 997;
      }
    }
    // The carriage rides the rail joints: a soft vertical bob that grows with
    // speed, plus a slow breath.
    const sp = clamp(Math.abs(v) / V_MAX, 0, 1);
    const bob =
      reduce || still
        ? 0
        : sp * 0.0016 * Math.sin(phase * 0.42) + sp * sp * 0.0007 * Math.sin(phase * 1.31 + 1.7) + 0.0006 * Math.sin((time * 2 * Math.PI) / 11);
    draw(expo, fade, bob);
    drawnFor = sceneT;
  });

  return {
    destroy() {
      host.removeEventListener("keydown", onKeyDown);
      host.removeEventListener("keyup", onKeyUp);
      film.destroy();
      freeTarget(gl, sceneT);
      freeTarget(gl, filmT);
      for (const t of [sky, dist, ground.tex, hedge.tex, poles.tex]) gl.deleteTexture(t);
      gl.deleteProgram(scene.p);
      gl.deleteProgram(blit.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
