import { createStage, clamp, damp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Rearrange: a summer photograph taken straight up a catenary mast at Ine,
// whose loose things come away from it. Pick up the maintenance platform,
// the lamp, the far pole or an insulator and slide it across the sky; let
// go and it settles. Double-tap and everything goes home.
//
// tools/depth/bakes/rearrange cut the photo offline: every loose object has
// its own matte (solved against the sky colour at its edge, so the railing's
// thin bars and the sky between the floor's slats survive and no blue fringe
// travels with it; where a cable crossed it, it is completed underneath),
// and the clean plate behind them was filled with LaMa, tile by tile at
// close to native resolution, the cables drawn back through each hole along
// their own lines. The plate is split into a front layer (mast, girder,
// cables, with their disparity) and the sky behind.
//
// Physics, in camera space (OpenCV axes, f from the lens, the up direction
// from the poles' vertical vanishing point, high above the frame: the lens
// looks up ~33 degrees):
//  - A moved object keeps its height above the ground. The point you hold
//    slides on that horizontal plane, so its distance, and the object's
//    size, follow from where it is on screen: it grows as it comes overhead
//    and shrinks as it slides down toward the horizon far below the frame,
//    exactly as the two poles converge. Each object is a vertical card
//    facing the camera, so the move is one homography
//    H = K (I + t n^T / d) K^-1, which also leans it toward the vertical
//    vanishing point wherever it goes.
//  - Occlusion is per pixel by disparity: the card's own depth against the
//    front layer's. Slide the far pole left and it passes behind the girder
//    and the cables; bring the platform across and it comes in front of
//    them.
//  - Shadows are cast, not drawn: from each lit surface a ray to the sun
//    (fitted from the shading of the two poles) is intersected with each
//    card and the card's matte looked up there, blurred by the distance
//    (the penumbra), plus a contact shadow where a card nearly touches a
//    surface. Only the change from the photo is applied, so at rest the
//    frame is the photograph exactly.
// The sky is regraded on its own (gradeSky): a dense cyan-cobalt that
// deepens toward the top of the frame, cloud warm-neutral with skylight-blue
// undersides. Then the frame goes through film.js (summer), with its global
// saturation and blue push off, and a black point that keeps the steel a
// near-black silhouette.
//
// Query: ?move=k,dx,dy holds object k (0 platform, 1 lamp, 2 far pole,
// 3 pull-off insulator, 4 insulator pair) lifted mid-move, dx/dy in photo
// widths/heights from where it was; several are joined with ";".
// &lift=0 shows them set down. &sunAz / &sunEl (deg) override the sun.
// &grade=0 shows the plate's own sky.

const ASSET = "/lab/rearrange/";
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
const MAXK = 5;
const LIFT = 0.045; // held: the card comes this share of its distance toward the lens
const S_MIN = 0.42; // smallest and largest size relative to where it was
const S_MAX = 1.75;
const SKYLIGHT = [0.4, 0.46, 0.6]; // what is left in a shadow on a clear day: the blue sky

const hex = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i + 1, i + 3), 16) / 255);
const lin = (c) => c.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
// The sky grade (see gradeSky): herb's cyan-cobalt, dense at the zenith and
// paler toward the horizon far below the frame; cloud warm-neutral, its
// shadowed undersides skylight blue.
const SKY = {
  // the film's curve lifts and spreads these a little: aimed so the print
  // lands near #1F62A8 at the top edge and #5A9BD0 at the bottom
  top: hex("#0E5AA2"),
  low: hex("#5A9BD0"),
  curve: 1.0,
  cloud: [0.26, 0.6],
  // #F2F0EA, warmed against the film's cool highlight tint (.95, 1, 1.05)
  warm: lin(hex("#F2F0EA")).map((v, i) => v * [1.05, 1, 0.95][i]),
  under: lin(hex("#A4C4E2")),
  underRange: [0.5, 0.8, 0.9],
};
// Black point of the print, after the film: the steel against the sky goes
// to a near-black silhouette instead of sitting on a lifted grey.
const BLACK = 0.012;

const FILM = {
  ...FILM_PRESETS.summer,
  headroom: 1.0,
  halation: 0.24,
  halationThreshold: 0.92,
  bloom: 0.1,
  softness: 0.45,
  contrast: 1.16,
  toe: 0.008,
  // colour density comes from the sky grade, not from a global push
  saturation: 1.0,
  blueDepth: 0,
  grain: 0.3,
  vignette: 0.12,
};

const QUAD_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos; gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0); }`;

// The print, drawn over the whole canvas: uv over the photo with y down,
// running past 0..1 outside the print, where the photo's edge is extended
// (and the coverage is 0) so the film's diffusion sees more of the photo at
// the print's edge rather than the paper, which would veil it white.
const PRINT_VS = `#version 300 es
layout(location=0) in vec2 aPos;
uniform vec4 uPrint;   // x, y, w, h in device px, y down
uniform vec2 uView;
out vec2 vUv;
void main() {
  vec2 px = vec2(aPos.x, 1.0 - aPos.y) * uView;
  vUv = (px - uPrint.xy) / uPrint.zw;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

const SCENE_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vUv;
uniform sampler2D uPlate;     // clean plate (sRGB texture: reads linear)
uniform sampler2D uFront;     // r coverage, g disparity, b shadow receiver
uniform sampler2D uSky;       // sky behind the front layer (sRGB)
uniform sampler2DArray uObj;  // the loose objects, straight alpha (sRGB)
uniform vec2 uSize;           // photo px
uniform float uF;
uniform vec2 uC;
uniform vec3 uN;              // card normal (horizontal, toward the lens)
uniform vec3 uSun;            // toward the sun
uniform float uSkyD;
uniform int uCount;
uniform int uOrder[${MAXK}];
uniform mat3 uHinv[${MAXK}];  // moved photo px -> original photo px
uniform float uDn[${MAXK}];   // card plane n.X = d, now
uniform float uDn0[${MAXK}];  // and at rest
uniform vec3 uT[${MAXK}];     // translation, camera space
uniform float uBias[${MAXK}];
uniform float uActive[${MAXK}];
uniform vec4 uRect[${MAXK}];  // crop rect in photo px
uniform vec2 uLayer;          // array layer size, px
uniform float uShadow;
uniform vec3 uSkylight;
uniform float uSeed;
uniform vec3 uSkyTop;         // sRGB, clear sky at the top edge
uniform vec3 uSkyLow;         // and at the bottom edge (toward the horizon)
uniform float uSkyCurve;
uniform sampler2D uClear;     // the plate's clear-sky luminance x2 (coarse)
uniform vec2 uCloudY;         // cloud starts this far above the clear sky; unmix contrast
uniform vec3 uWarmCloud;      // linear, relative
uniform vec3 uUnderBlue;      // linear, relative
uniform vec3 uUnder;          // luminance range of the underside tint, amount
uniform float uGrade;
out vec4 o;

vec4 objLod(int k, vec2 q, float lod) {
  vec2 t = (q - uRect[k].xy) / uLayer;
  vec2 hi = (uRect[k].zw - uRect[k].xy) / uLayer;
  float inside = step(0.0, t.x) * step(0.0, t.y) * step(t.x, hi.x) * step(t.y, hi.y);
  return textureLod(uObj, vec3(t, float(k)), lod) * inside;
}

// Matte of card k where the ray from P toward the sun crosses it, blurred
// by how far it travelled (the sun is a disc, not a point).
float castBy(int k, vec3 P, float dn, vec3 t) {
  float sd = dot(uN, uSun);
  if (abs(sd) < 1e-3) return 0.0;
  float s = (dn - dot(uN, P)) / sd;
  if (s <= 0.0) return 0.0;
  vec3 Q0 = P + s * uSun - t;
  if (Q0.z < 0.05) return 0.0;
  vec2 q = uF * Q0.xy / Q0.z + uC;
  float rpx = s * 0.022 * uF / Q0.z + 1.5;
  return objLod(k, q, log2(rpx)).a;
}

// Contact: a card close in front of a surface darkens it softly round its
// silhouette, fading with the gap.
float contactBy(int k, vec3 P, vec2 p, float dn, mat3 Hinv) {
  float gap = dn - dot(uN, P);   // > 0: the surface is behind the card
  if (gap <= 0.0) return 0.0;
  float z = P.z;
  float g = gap / (0.14 * z);
  vec3 h = Hinv * vec3(p, 1.0);
  // tight and dark where it nearly touches, wider and fainter further off
  float a = objLod(k, h.xy / h.z, 2.5 + 3.0 * clamp(g, 0.0, 1.0)).a;
  return a * exp(-g * 1.6);
}

vec3 toLin(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

// The sky's own density, in place of a global saturation push: wherever the
// plate is sky (the front layer's matte, the clean plate where it is empty),
// the clear blue is rebuilt as a dense cobalt that deepens with height in the
// frame, and the cloud keeps its luminance but goes warm-neutral, its
// undersides lit by that blue. Steel, cable and the loose objects never pass
// through here.
vec3 gradeSky(vec3 c, vec2 uv) {
  float Y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // How much of the pixel is cloud: a linear unmix on luminance between the
  // plate's own clear blue here and the dimmest cloud. (Luminance, not
  // chroma: the plate's colour is coarser than its drawing, and a chroma key
  // blotches.) A little contrast on it, so thin haze stays sky.
  float ySky = 0.5 * texture(uClear, uv).r;
  float yCl = ySky + uCloudY.x;
  float w = clamp((Y - ySky) / (yCl - ySky), 0.0, 1.0);
  w = mix(w, w * w * (3.0 - 2.0 * w), uCloudY.y);
  // clear sky: the ramp, deepest at the top, keeping a little of the plate's
  // own modulation
  vec3 tgt = toLin(mix(uSkyTop, uSkyLow, pow(uv.y, uSkyCurve)));
  vec3 S = tgt * clamp(pow(Y / ySky, 0.6), 0.75, 1.0);
  // cloud at its own luminance (within the unmix range it is the dimmest
  // cloud), warm-neutral where lit, skylight blue in its shadowed undersides
  float yc = max(Y, yCl);
  float under = (1.0 - smoothstep(uUnder.x, uUnder.y, yc)) * uUnder.z;
  vec3 tint = mix(uWarmCloud, uUnderBlue, under);
  vec3 C = yc * tint / dot(tint, vec3(0.2126, 0.7152, 0.0722));
  return mix(S, C, w);
}

vec3 toSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423) + uSeed);
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

void main() {
  vec2 uv = clamp(vUv, 0.0, 1.0);
  float cover = step(0.0, vUv.x) * step(0.0, vUv.y) * step(vUv.x, 1.0) * step(vUv.y, 1.0);
  vec2 p = uv * uSize;
  vec3 ray = vec3((p - uC) / uF, 1.0);
  vec4 fr = texture(uFront, uv);
  float aF = fr.r;
  float dF = fr.g;
  float recv = fr.b;
  vec3 plate = texture(uPlate, uv).rgb;
  vec3 skyc = texture(uSky, uv).rgb;
  bool thin = aF < 0.02;
  vec3 B = thin ? plate : skyc;
  B = mix(B, gradeSky(B, uv), uGrade);
  vec3 Fpm = thin ? vec3(0.0) : plate - (1.0 - aF) * skyc;

  // shadows that the moved objects now throw on the street (only what
  // changed from the photo: at rest this is zero)
  float zF = 1.0 / max(dF - uSkyD, 0.02);
  vec3 PF = ray * zF;
  float shF = 0.0;
  if (recv > 0.01) {
    for (int k = 0; k < ${MAXK}; k++) {
      if (k >= uCount) break;
      if (uActive[k] < 0.5) continue;
      float now = max(castBy(k, PF, uDn[k], uT[k]), 0.8 * contactBy(k, PF, p, uDn[k], uHinv[k]));
      float rest = max(castBy(k, PF, uDn0[k], vec3(0.0)), 0.8 * contactBy(k, PF, p, uDn0[k], mat3(1.0)));
      shF = 1.0 - (1.0 - shF) * (1.0 - max(now - rest, 0.0));
    }
  }
  // a surface already in shade has little sun left to lose
  float lumP = dot(plate, vec3(0.2126, 0.7152, 0.0722));
  float sunlit = smoothstep(0.03, 0.22, lumP);
  Fpm *= mix(vec3(1.0), uSkylight, clamp(shF * recv * sunlit * uShadow, 0.0, 1.0));

  vec3 col = B;
  float fDone = 0.0;
  for (int i = 0; i < ${MAXK}; i++) {
    if (i >= uCount) break;
    int k = uOrder[i];
    vec3 h = uHinv[k] * vec3(p, 1.0);
    vec2 q = h.xy / h.z;
    vec2 t = (q - uRect[k].xy) / uLayer;
    vec2 hi = (uRect[k].zw - uRect[k].xy) / uLayer;
    vec4 ob = textureGrad(uObj, vec3(t, float(k)), dFdx(t), dFdy(t));
    ob.a *= step(0.0, t.x) * step(0.0, t.y) * step(t.x, hi.x) * step(t.y, hi.y);
    // the card's own depth here
    float zk = uDn[k] / dot(uN, ray);
    float Dk = uSkyD + 1.0 / zk + uBias[k];
    if (fDone < 0.5 && Dk > dF) {
      col = Fpm + (1.0 - aF) * col;
      fDone = 1.0;
    }
    if (ob.a < 0.002) continue;
    // shadows the other cards throw on this one (change from the photo)
    float sh = 0.0;
    vec3 Pk = ray * zk;
    vec3 Pk0 = Pk - uT[k];
    for (int j = 0; j < ${MAXK}; j++) {
      if (j >= uCount) break;
      if (j == k || (uActive[j] < 0.5 && uActive[k] < 0.5)) continue;
      float now = castBy(j, Pk, uDn[j], uT[j]);
      float rest = castBy(j, Pk0, uDn0[j], vec3(0.0));
      sh = 1.0 - (1.0 - sh) * (1.0 - max(now - rest, 0.0));
    }
    float lo = dot(ob.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 c = ob.rgb * mix(vec3(1.0), uSkylight, clamp(sh * smoothstep(0.03, 0.22, lo) * uShadow, 0.0, 1.0));
    col = c * ob.a + (1.0 - ob.a) * col;
  }
  if (fDone < 0.5) col = Fpm + (1.0 - aF) * col;
  vec3 s = toSrgb(col);
  s += (hash(gl_FragCoord.xy) + hash(gl_FragCoord.yx + 7.3) - 1.0) / 255.0;
  o = vec4(s, cover);
}`;

const FINAL_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uFilm;
uniform sampler2D uScene;
uniform vec3 uPaper;
uniform float uBlack;
out vec4 o;
void main() {
  float cov = texture(uScene, vUv).a;
  vec3 f = texture(uFilm, vUv).rgb;
  f = max(f - uBlack, 0.0) / (1.0 - uBlack);
  o = vec4(mix(uPaper, f, cov), 1.0);
}`;

// ---------------------------------------------------------------- small math
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
function spring(x) {
  return { x, v: 0, to: x };
}
function stepSpring(s, omega, zeta, dt) {
  const n = Math.ceil(dt / (1 / 240));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const a = -omega * omega * (s.x - s.to) - 2 * zeta * omega * s.v;
    s.v += a * h;
    s.x += s.v * h;
  }
}
// Past a limit the hand meets resistance, like a held rubber band.
function rubber(v, lo, hi, k = 0.32) {
  if (v < lo) return lo - (lo - v) * k;
  if (v > hi) return hi + (v - hi) * k;
  return v;
}

function compile(gl, vs, fs) {
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

async function loadBitmap(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function pixels(bm) {
  const c = document.createElement("canvas");
  c.width = bm.width;
  c.height = bm.height;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(bm, 0, 0);
  return x.getImageData(0, 0, bm.width, bm.height).data;
}

// The plate's clear-sky luminance, as a coarse field: per cell the dim end of
// the sky's luminance (the blue between the clouds), spread from cells that
// are all cloud by a min, then smoothed. Linear luminance x2, in a byte.
function clearSky(px, w, h) {
  const C = 25;
  const gw = Math.ceil(w / C);
  const gh = Math.ceil(h / C);
  const L = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  let g = new Float32Array(gw * gh);
  const vals = [];
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      vals.length = 0;
      for (let y = gy * C; y < Math.min(h, gy * C + C); y += 2) {
        for (let x = gx * C; x < Math.min(w, gx * C + C); x += 2) {
          const i = (y * w + x) * 4;
          vals.push(0.2126 * L[px[i]] + 0.7152 * L[px[i + 1]] + 0.0722 * L[px[i + 2]]);
        }
      }
      vals.sort((a, b) => a - b);
      g[gy * gw + gx] = vals[Math.floor(vals.length * 0.1)];
    }
  }
  const pass = (f) => {
    const o = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const n = [];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) n.push(g[clamp(y + dy, 0, gh - 1) * gw + clamp(x + dx, 0, gw - 1)]);
        }
        o[y * gw + x] = f(n);
      }
    }
    g = o;
  };
  pass((n) => Math.min(...n));
  for (let i = 0; i < 3; i++) pass((n) => n.reduce((a, b) => a + b, 0) / n.length);
  const data = new Uint8Array(gw * gh);
  for (let i = 0; i < data.length; i++) data[i] = clamp(Math.round(g[i] * 2 * 255), 0, 255);
  return { data, w: gw, h: gh };
}

export async function createRearrange(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const num = (k) => {
    const v = q.get(k);
    return v != null && v !== "" && Number.isFinite(+v) ? +v : null;
  };
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  host.style.background = `rgb(${PAPER.map((c) => Math.round(c * 255)).join(",")})`;
  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");

  const meta = await (await fetch(`${ASSET}meta.json`)).json();
  const OBJ = meta.objects.slice(0, MAXK);
  const K = OBJ.length;
  const [PW, PH] = meta.size;
  const F = meta.f;
  const [CX, CY] = meta.c;
  const UP = meta.up;
  const N = meta.toward;
  let SUN = meta.sun;
  if (num("sunAz") != null || num("sunEl") != null) {
    // rebuild from azimuth (from the lens, toward the right) and elevation
    const fwd = N.map((v) => -v);
    const right = [fwd[1] * UP[2] - fwd[2] * UP[1], fwd[2] * UP[0] - fwd[0] * UP[2], fwd[0] * UP[1] - fwd[1] * UP[0]];
    const rl = Math.hypot(...right);
    const r = right.map((v) => -v / rl);
    const az = ((num("sunAz") ?? -60) * Math.PI) / 180;
    const el = ((num("sunEl") ?? 58) * Math.PI) / 180;
    SUN = [0, 1, 2].map((i) => Math.cos(el) * (Math.cos(az) * N[i] + Math.sin(az) * r[i]) + Math.sin(el) * UP[i]);
  }
  const SKYD = meta.skyD;

  const [plateBm, frontBm, skyBm, ...objBms] = await Promise.all([
    loadBitmap(`${ASSET}plate.webp`),
    loadBitmap(`${ASSET}front.webp`),
    loadBitmap(`${ASSET}sky.webp`),
    ...OBJ.map((_, k) => loadBitmap(`${ASSET}o${k}.webp`)),
  ]);
  // CPU copies for picking: each object's matte, and the front layer
  const objA = objBms.map((bm) => {
    const px = pixels(bm);
    const a = new Uint8Array(bm.width * bm.height);
    for (let i = 0; i < a.length; i++) a[i] = px[i * 4 + 3];
    return { a, w: bm.width, h: bm.height };
  });
  const frontPx = pixels(frontBm);
  const clear = clearSky(pixels(skyBm), skyBm.width, skyBm.height);

  // ---- textures
  const tex2d = (bm, internal, mips) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, gl.RGBA, gl.UNSIGNED_BYTE, bm);
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const plateTex = tex2d(plateBm, gl.SRGB8_ALPHA8, true);
  const frontTex = tex2d(frontBm, gl.RGBA8, false);
  const skyTex = tex2d(skyBm, gl.SRGB8_ALPHA8, false);
  const clearTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, clearTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, clear.w, clear.h, 0, gl.RED, gl.UNSIGNED_BYTE, clear.data);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const LW = Math.max(...objBms.map((b) => b.width));
  const LH = Math.max(...objBms.map((b) => b.height));
  const objTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, objTex);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.SRGB8_ALPHA8, LW, LH, K, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  objBms.forEach((bm, k) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, k, bm.width, bm.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, bm));
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  for (const bm of [plateBm, frontBm, skyBm, ...objBms]) bm.close?.();

  const scene = compile(gl, PRINT_VS, SCENE_FS);
  const fin = compile(gl, QUAD_VS, FINAL_FS);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const film = createFilm(gl, { width: stage.canvas.width, height: stage.canvas.height });
  const target = () => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, stage.canvas.width, stage.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo };
  };
  let sceneT = null;
  let filmT = null;
  let dirty = true;
  const build = () => {
    for (const t of [sceneT, filmT]) {
      if (!t) continue;
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    sceneT = target();
    filmT = target();
    film.resize(stage.canvas.width, stage.canvas.height);
    dirty = true;
  };
  stage.onResize(build);

  // ---- layout: one large print, centred, on the paper
  const layout = () => {
    const W = stage.width;
    const H = stage.height;
    const narrow = W < 700;
    const pw = Math.min(W - 2 * Math.max(16, W * (narrow ? 0.04 : 0.07)), (H * (narrow ? 0.62 : 0.8) * PW) / PH);
    const dpr = stage.dpr;
    // whole device pixels, so the print's edge is one crisp step
    const wd = Math.round(pw * dpr);
    const hd = Math.round((wd * PH) / PW);
    const xd = Math.round((W * dpr - wd) / 2);
    const yd = Math.round((H * dpr - hd) / 2);
    return { x: xd / dpr, y: yd / dpr, w: wd / dpr, h: hd / dpr, dev: [xd, yd, wd, hd], s: wd / dpr / PW };
  };

  // ---- camera
  const kinv = (u, v) => [(u - CX) / F, (v - CY) / F, 1];
  const proj = (X) => [(F * X[0]) / X[2] + CX, (F * X[1]) / X[2] + CY];
  const gOf = (u, v) => dot3(UP, kinv(u, v)); // > 0 above the horizon
  const gradG = [UP[0] / F, UP[1] / F];

  // per object: rest card plane, and the live state
  const objs = OBJ.map((o) => {
    const zA = 1 / Math.max(o.D - SKYD, 0.02);
    const XA = kinv(...o.anchor).map((v) => v * zA);
    return {
      meta: o,
      dn0: dot3(N, XA),
      t: [0, 0, 0],
      lift: spring(0),
      pos: { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 },
      ref: null, // the held point: its 3D position, height, t when grabbed
      held: false,
      moving: false,
    };
  });

  // the point of card k under photo point (u, v), and how it is held
  const refAt = (o, u, v) => {
    const r = kinv(u, v);
    const dn = o.dn0 + dot3(N, o.t);
    const z = dn / dot3(N, r);
    const X = r.map((c) => c * z);
    const X0 = [X[0] - o.t[0], X[1] - o.t[1], X[2] - o.t[2]];
    return { X, h: dot3(UP, X), t0: o.t.slice(), home: proj(X0), g0: gOf(...proj(X0)) };
  };

  // Keep the held point inside the print and its size within reason (both
  // with rubber), and the barrier's cut end below the frame.
  const constrain = (o, u, v) => {
    const g0 = o.ref.g0;
    const g = gOf(u, v);
    const sRel = g / g0;
    const sC = rubber(sRel, S_MIN, S_MAX);
    if (sC !== sRel) {
      const dg = sC * g0 - g;
      const gl2 = gradG[0] * gradG[0] + gradG[1] * gradG[1];
      u += (dg * gradG[0]) / gl2;
      v += (dg * gradG[1]) / gl2;
    }
    u = rubber(u, 6, PW - 6);
    v = rubber(v, 6, PH - 6);
    const cut = o.meta.cut;
    if (cut) {
      // its cut end (at the frame's bottom edge in the photo) must stay out
      // of the frame: walk the held point up until it does
      for (let i = 0; i < 6; i++) {
        const t = translation(o, u, v, 0);
        const e = mapPoint(o, t, cut);
        if (e[1] >= PH + 1) break;
        v -= (PH + 2 - e[1]) * 0.9;
      }
    }
    return [u, v];
  };

  const translation = (o, u, v, lift) => {
    const r = kinv(u, v);
    const g = dot3(UP, r);
    const X = r.map((c) => (c * o.ref.h) / Math.max(g, 1e-3) * (1 - lift));
    return [0, 1, 2].map((i) => o.ref.t0[i] + X[i] - o.ref.X[i]);
  };
  // where the original photo point (u, v) of card o lands under translation t
  const mapPoint = (o, t, [u, v]) => {
    const r = kinv(u, v);
    const z = o.dn0 / dot3(N, r);
    return proj([r[0] * z + t[0], r[1] * z + t[1], r[2] * z + t[2]]);
  };
  // H^-1 = K (I - t n^T / (d + n.t)) K^-1, column-major for GLSL
  const hinv = (o) => {
    const t = o.t;
    const d = o.dn0 + dot3(N, t);
    const M = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? 1 : 0) - (t[i] * N[j]) / d));
    const Kc = [
      [F, 0, CX],
      [0, F, CY],
      [0, 0, 1],
    ];
    const Ki = [
      [1 / F, 0, -CX / F],
      [0, 1 / F, -CY / F],
      [0, 0, 1],
    ];
    const mul = (A, B) => A.map((row, i) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
    const R = mul(mul(Kc, M), Ki);
    return [R[0][0], R[1][0], R[2][0], R[0][1], R[1][1], R[2][1], R[0][2], R[1][2], R[2][2]];
  };
  const applyH = (m, u, v) => {
    const x = m[0] * u + m[3] * v + m[6];
    const y = m[1] * u + m[4] * v + m[7];
    const w = m[2] * u + m[5] * v + m[8];
    return [x / w, y / w];
  };
  const cardD = (o, u, v) => SKYD + dot3(N, kinv(u, v)) / (o.dn0 + dot3(N, o.t)) + o.meta.bias;

  // The nearest object whose matte is under photo point (u, v) and that is
  // not hidden there by something in front of it.
  const pick = (u, v) => {
    const iu = clamp(Math.round(u), 0, PW - 1);
    const iv = clamp(Math.round(v), 0, PH - 1);
    const fi = (iv * PW + iu) * 4;
    const aF = frontPx[fi] / 255;
    const dF = frontPx[fi + 1] / 255;
    let best = -1;
    let bestD = -1;
    objs.forEach((o, k) => {
      const [qx, qy] = applyH(hinv(o), u, v);
      const r = o.meta.rect;
      const x = Math.round(qx - r[0]);
      const y = Math.round(qy - r[1]);
      const A = objA[k];
      if (x < 0 || y < 0 || x >= A.w || y >= A.h) return;
      if (A.a[y * A.w + x] < 110) return;
      const D = cardD(o, u, v);
      if (aF > 0.6 && dF > D) return;
      if (D > bestD) {
        bestD = D;
        best = k;
      }
    });
    return best;
  };

  const toPhoto = (p) => {
    const L = layout();
    return [(p.x - L.x) / L.s, (p.y - L.y) / L.s];
  };

  // ---- still: ?move=k,dx,dy[;k,dx,dy]
  const held = q.get("move");
  const liftQ = num("lift");
  const setMove = (o, du, dv, liftTo) => {
    o.ref = refAt(o, ...o.meta.anchor);
    const [u, v] = constrain(o, o.meta.anchor[0] + du, o.meta.anchor[1] + dv);
    Object.assign(o.pos, { x: u, y: v, vx: 0, vy: 0, tx: u, ty: v });
    o.lift.x = o.lift.to = liftTo;
    o.t = translation(o, u, v, o.lift.x);
    o.moving = true;
  };
  if (held) {
    for (const part of held.split(/[;|_]/)) {
      const [k, dx, dy] = part.split(",").map(Number);
      if (!objs[k] || !Number.isFinite(dx) || !Number.isFinite(dy)) continue;
      setMove(objs[k], dx * PW, dy * PH, liftQ ?? LIFT);
    }
  }

  // ---- input
  let grab = null;
  let lastDown = { t: -1e9, x: 0, y: 0 };
  let touched = !!held;
  let born = performance.now();

  const goHome = () => {
    for (const o of objs) {
      if (!o.ref) continue;
      o.held = false;
      o.pos.tx = o.ref.home[0];
      o.pos.ty = o.ref.home[1];
      o.lift.to = 0;
      o.moving = true;
    }
  };

  stage.on("down", (p, e) => {
    touched = true;
    // the event's own time: a busy frame must not stretch a double-tap
    const now = e?.timeStamp ?? performance.now();
    const dbl = now - lastDown.t < 320 && Math.hypot(p.x - lastDown.x, p.y - lastDown.y) < 28;
    lastDown = { t: now, x: p.x, y: p.y };
    if (dbl) {
      if (grab) objs[grab.k].held = false;
      grab = null;
      goHome();
      stage.canvas.style.cursor = "";
      return;
    }
    const [u, v] = toPhoto(p);
    const k = pick(u, v);
    if (k < 0) return;
    const o = objs[k];
    o.ref = refAt(o, u, v);
    Object.assign(o.pos, { x: u, y: v, vx: 0, vy: 0, tx: u, ty: v });
    o.held = true;
    o.moving = true;
    o.lift.to = LIFT;
    grab = { k, du: 0, dv: 0 };
    stage.canvas.style.cursor = "grabbing";
  });
  stage.on("up", (p) => {
    if (!grab) return;
    const o = objs[grab.k];
    grab = null;
    o.held = false;
    // carry a little of the hand's speed, then settle (friction ~0.2 s)
    const L = layout();
    const [tu, tv] = constrain(o, o.pos.x + (p.vx / L.s) * 0.2, o.pos.y + (p.vy / L.s) * 0.2);
    o.pos.tx = tu;
    o.pos.ty = tv;
    o.pos.vx = p.vx / L.s;
    o.pos.vy = p.vy / L.s;
    o.lift.to = 0;
    stage.canvas.style.cursor = "grab";
  });
  stage.on("move", (p) => {
    if (grab) return;
    const [u, v] = toPhoto(p);
    const k = u >= 0 && v >= 0 && u < PW && v < PH ? pick(u, v) : -1;
    stage.canvas.style.cursor = k >= 0 ? "grab" : "";
  });

  // ---- draw
  const order = new Int32Array(MAXK);
  const drawScene = () => {
    const L = layout();
    const w = stage.canvas.width;
    const h = stage.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.clearColor(PAPER[0], PAPER[1], PAPER[2], 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(scene.p);
    gl.bindVertexArray(vao);
    const U = scene.u;
    gl.uniform4f(U.uPrint, ...L.dev);
    gl.uniform2f(U.uView, w, h);
    gl.uniform2f(U.uSize, PW, PH);
    gl.uniform1f(U.uF, F);
    gl.uniform2f(U.uC, CX, CY);
    gl.uniform3fv(U.uN, N);
    gl.uniform3fv(U.uSun, SUN);
    gl.uniform1f(U.uSkyD, SKYD);
    gl.uniform1i(U.uCount, K);
    // far to near, by the card's disparity at its anchor
    const ds = objs.map((o, k) => [k, cardD(o, ...applyHInvPoint(o, o.meta.anchor))]);
    ds.sort((a, b) => a[1] - b[1]);
    ds.forEach(([k], i) => (order[i] = k));
    gl.uniform1iv(U.uOrder, order);
    const H = new Float32Array(9 * MAXK);
    const dn = new Float32Array(MAXK);
    const dn0 = new Float32Array(MAXK);
    const T = new Float32Array(3 * MAXK);
    const bias = new Float32Array(MAXK);
    const act = new Float32Array(MAXK);
    const rect = new Float32Array(4 * MAXK);
    objs.forEach((o, k) => {
      H.set(hinv(o), k * 9);
      dn[k] = o.dn0 + dot3(N, o.t);
      dn0[k] = o.dn0;
      T.set(o.t, k * 3);
      bias[k] = o.meta.bias;
      act[k] = Math.hypot(...o.t) > 1e-5 ? 1 : 0;
      rect.set(o.meta.rect, k * 4);
    });
    gl.uniformMatrix3fv(U.uHinv, false, H);
    gl.uniform1fv(U.uDn, dn);
    gl.uniform1fv(U.uDn0, dn0);
    gl.uniform3fv(U.uT, T);
    gl.uniform1fv(U.uBias, bias);
    gl.uniform1fv(U.uActive, act);
    gl.uniform4fv(U.uRect, rect);
    gl.uniform2f(U.uLayer, LW, LH);
    gl.uniform1f(U.uShadow, num("shadow") ?? 1);
    gl.uniform3fv(U.uSkylight, SKYLIGHT);
    gl.uniform1f(U.uSeed, 0.37);
    gl.uniform3fv(U.uSkyTop, SKY.top);
    gl.uniform3fv(U.uSkyLow, SKY.low);
    gl.uniform1f(U.uSkyCurve, SKY.curve);
    gl.uniform2fv(U.uCloudY, SKY.cloud);
    gl.uniform3fv(U.uWarmCloud, SKY.warm);
    gl.uniform3fv(U.uUnderBlue, SKY.under);
    gl.uniform3fv(U.uUnder, SKY.underRange);
    gl.uniform1f(U.uGrade, num("grade") ?? 1);
    const texs = [
      [gl.TEXTURE_2D, plateTex, U.uPlate],
      [gl.TEXTURE_2D, frontTex, U.uFront],
      [gl.TEXTURE_2D, skyTex, U.uSky],
      [gl.TEXTURE_2D, clearTex, U.uClear],
      [gl.TEXTURE_2D_ARRAY, objTex, U.uObj],
    ];
    texs.forEach(([type, t, loc], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(type, t);
      gl.uniform1i(loc, i);
    });
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  };
  // the moved position of an object's anchor (for depth sorting)
  function applyHInvPoint(o, a) {
    return mapPoint(o, o.t, a);
  }

  const present = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(fin.p);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, filmT.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sceneT.tex);
    gl.uniform1i(fin.u.uFilm, 0);
    gl.uniform1i(fin.u.uScene, 1);
    gl.uniform3f(fin.u.uPaper, PAPER[0], PAPER[1], PAPER[2]);
    gl.uniform1f(fin.u.uBlack, BLACK);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  };

  let lastKey = "";
  let lastGrain = -1;
  let hint = 0; // 0 waiting, 1 lifted, 2 done
  // A machine that cannot keep up (software GL, a starved tab) stops the
  // grain's 24 fps crawl rather than spend every frame on it: the print
  // then redraws only when something moves.
  let slow = 0;
  let still = false;
  let lastWall = 0;
  const frame = (dt, t) => {
    // the stage caps dt, so the wall clock says how slow frames really are
    const wall = performance.now();
    slow = lastWall && wall - lastWall > 200 ? slow + 1 : 0;
    lastWall = wall;
    if (slow >= 2) still = true;
    if (still && hint < 2 && !touched) {
      // and it skips the intro's lift: at seconds a frame it would take
      // minutes to settle, and the photograph is what should be there
      const o = objs[0];
      if (o.ref) {
        Object.assign(o.pos, { x: o.ref.home[0], y: o.ref.home[1], vx: 0, vy: 0, tx: o.ref.home[0], ty: o.ref.home[1] });
        Object.assign(o.lift, { x: 0, v: 0, to: 0 });
        o.moving = false;
        o.t = [0, 0, 0];
      }
      hint = 2;
    }
    if (!sceneT) return;
    const now = performance.now();
    const age = (now - born) / 1000;
    const p = stage.pointer;

    // Intro: the print develops out of an overexposed white-blue; then the
    // platform lifts a little off its mast and sets back, to show it is loose.
    if (!touched && !reduced && !held) {
      const o = objs[0];
      if (hint === 0 && age > 2.5) {
        o.ref = refAt(o, ...o.meta.anchor);
        Object.assign(o.pos, { x: o.meta.anchor[0], y: o.meta.anchor[1], vx: 0, vy: 0 });
        const [tu, tv] = constrain(o, o.meta.anchor[0] - 60, o.meta.anchor[1] - 40);
        o.pos.tx = tu;
        o.pos.ty = tv;
        o.lift.to = LIFT;
        o.moving = true;
        hint = 1;
      } else if (hint === 1 && age > 3.5) {
        o.pos.tx = o.ref.home[0];
        o.pos.ty = o.ref.home[1];
        o.lift.to = 0;
        hint = 2;
      }
    }
    const expT = reduced ? clamp(age / 0.3, 0, 1) : expoOut(clamp(age / 2.0, 0, 1));
    const exposure = (FILM.exposure ?? 0) + (held ? 0 : 2.4 * (1 - expT));

    for (const o of objs) {
      if (!o.moving || !o.ref) continue;
      if (o.held && grab) {
        // 1:1 under the hand
        const [u, v] = constrain(o, ...toPhoto(p));
        o.pos.vx = (u - o.pos.x) / Math.max(dt, 1e-3);
        o.pos.vy = (v - o.pos.y) / Math.max(dt, 1e-3);
        o.pos.x = u;
        o.pos.y = v;
        stepSpring(o.lift, 22, 0.9, dt);
      } else if (!held) {
        const sx = { x: o.pos.x, v: o.pos.vx, to: o.pos.tx };
        const sy = { x: o.pos.y, v: o.pos.vy, to: o.pos.ty };
        stepSpring(sx, 15, 0.86, dt);
        stepSpring(sy, 15, 0.86, dt);
        o.pos.x = sx.x;
        o.pos.vx = sx.v;
        o.pos.y = sy.x;
        o.pos.vy = sy.v;
        // set down: a soft landing, slightly under-damped
        stepSpring(o.lift, 16, 0.78, dt);
        const still = Math.hypot(o.pos.x - o.pos.tx, o.pos.y - o.pos.ty) < 0.05 && Math.hypot(o.pos.vx, o.pos.vy) < 0.5 && Math.abs(o.lift.x - o.lift.to) < 1e-5 && Math.abs(o.lift.v) < 1e-4;
        if (still) {
          o.pos.x = o.pos.tx;
          o.pos.y = o.pos.ty;
          o.lift.x = o.lift.to;
          o.moving = false;
        }
      }
      o.t = translation(o, o.pos.x, o.pos.y, o.lift.x);
      // back home exactly: drop the residue so the frame is the photograph
      if (!o.moving && Math.hypot(o.pos.x - o.ref.home[0], o.pos.y - o.ref.home[1]) < 0.05 && o.lift.x === 0) o.t = [0, 0, 0];
    }

    const key = `${objs.map((o) => o.t.map((v) => v.toFixed(6)).join(",")).join("|")}|${stage.canvas.width}`;
    if (key !== lastKey || dirty) {
      drawScene();
      lastKey = key;
      dirty = false;
      lastGrain = -1;
    }
    // film at 24 fps: the grain moves at the rate film did
    const tick = reduced || held || still ? 0 : Math.floor(t * 24);
    if (tick !== lastGrain || exposure > 1e-3) {
      film.render(sceneT.tex, { ...FILM, exposure, grainSeed: tick * 7.31 }, filmT.fbo);
      present();
      lastGrain = tick;
    }
  };
  stage.onFrame(frame);

  await new Promise((r) => requestAnimationFrame(() => r()));
  if (stage.canvas.width > 1) {
    if (!sceneT) build();
    frame(1 / 60, performance.now() / 1000);
  }
  born = performance.now();
  void embedded;

  return {
    destroy() {
      film.destroy();
      for (const t of [sceneT, filmT]) {
        if (!t) continue;
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
      }
      for (const t of [plateTex, frontTex, skyTex, clearTex, objTex]) gl.deleteTexture(t);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(scene.p);
      gl.deleteProgram(fin.p);
      stage.destroy();
    },
  };
}
