import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";
import { createModal } from "./modal";
import { orientation, skyField, createSpace, strokes as layStrokes, P, META } from "./engrave";

// Poke: a still frame of a tree against a summer sky that you can pull.
//
// Image-space modal bases (Abe Davis, Justin G. Chen and Fredo Durand,
// "Image-Space Modal Bases for Plausible Manipulation of Objects in Video",
// SIGGRAPH Asia 2015; the method behind Interactive Dynamic Video). Twenty-six
// seconds of a locked-off clip of the tree moving in the wind were taken apart
// offline (tools/depth/bakes/poke): dense optical flow from one reference
// frame to every other, a spectral decomposition of all that motion at once
// (frequency domain decomposition), and the twelve strongest spatially
// coherent resonances kept as complex 2D displacement fields with their own
// measured frequency (0.36 to 1.27 Hz) and damping ratio (6 to 29%).
//
// Live, the reference frame is warped by the sum of those modes. Grab any
// part of the picture and it follows the hand through a stiff spring; every
// other part of the tree answers through the modes it shares with that spot,
// with its own lag. Let go and each mode rings down at its own frequency and
// damping. The modes are weighted toward the slow, crown-wide ones, so a pull
// swings the whole crown.
//
// The modes are also the image. No photograph is drawn: the whole print is
// one line engraving on a cobalt-shadow ground. The crown's lines are cut
// along the contours of the leaves' light (engrave.js), each as wide as the
// light under it; the sky (filled and regraded offline behind the matted
// tree) is ruled with the same renderer at the same pitch, long nearly level
// lines that drift with its falloff, finer than the crown's, swelling and
// closing up where a cloud brightens. The two hatchings share one
// separation grid, so where the crown's lines meet the sky's they stop
// against each other. The sky's lines hold still; every point of a crown
// line is carried by the modal field,
// so a pull bends the lines where the crown shears and draws their trailing
// ends out a little (never more than a line and a half), while each keeps the
// width of the light at its rest position, so the print stays an engraving
// under a hard pull; and each is tinted by where that point is in its swing relative to the
// pull (with it, leading, against, lagging), on a continuous hue wheel whose
// saturation rises with the amplitude. So even a frozen frame shows the
// measured vibration structure of the real tree. The frame is
// developed with the shared film kit (summer).
//
// Query: ?poke=x,y,amp[,deg] holds a pull at print uv (x, y) by amp (a
// fraction of the print's width, toward deg, default 180 = left); add
// &t=seconds for the moment that long after letting go. ?still=1 stops the
// breeze.

const BASE = "/lab/poke/";
const ASPECT = 1.5; // the print, 3:2
const VIEW_H = 0.95; // share of the plate's height the print shows
const VIEW_X = 0.985; // right edge of the print in the plate (the tree runs off it)
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
const LMAX = 240; // plate px: how far the pointer can lead the grabbed point (soft)
const DMAX = 260; // plate px: the most any part of the crown may travel under a hold
const HAND = 48; // plate px: radius of the patch of crown a hand takes hold of
const TILT = 2; // modal mass tilt toward the slow, crown-wide modes (see modal.js)
const BREEZE = 0.45; // idle forcing, in units of each mode's static response
const LINE = 6.5; // target px at DPR 2: separation of the engraving's lines
const WIDTH = 0.42; // widest stroke half-width, as a share of the separation
const TRAIL = 0.6; // share of the displacement a stroke's trailing end lags by
const TRAIL_CAP = 1.5; // longest lag, in line separations: an end draws out, the line is never smeared
const TRAIL_RAMP = 4; // how far along a stroke its trailing end's lag eases out, in separations
const CROWN_RUN = [14, 36]; // the crown's lines are cut into strokes this long, in separations
const CROWN_SHORTEST = 8; // a crown streamline shorter than this (separations) is not laid
const LUM = [0.04, 0.5]; // leaf light (sRGB luma) that starts and fills a stroke
const SHADE = 0.16; // the crown's hairline in deep shadow, as a share of its widest
const SPECK = 0.25; // a crown line on less matte than this (softened) is a speck in the sky: not laid
const SKY_WIDTH = 0.3; // the sky's widest half-width, as a share of the separation
const SKY_LUM = [0.36, 0.74]; // sky light (sRGB luma, softened) from its finest line to its widest
const SKY_THIN = 0.2; // the finest sky line, as a share of its widest
const SKY_RUN = [14, 24]; // the sky's lines are cut into runs this long, in separations
const SKY_INK = [0.84, 0.035, 4.3]; // OKLCH: a cool pale ink, so the crown stands off the sky
const SKY_UNDER = 70; // how far, in separations, the sky's lines run on beneath the crown
const MASK = [960, 540]; // the crown's cover, at rest and as it swings (plate, half resolution)
const COVER = 1.0; // how far the cover reaches past a crown line, in separations
const GROUND = [0.03, 0.055, 0.12]; // cobalt shadow: the print's ground
const REVEAL = 1.8;

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// The engraving. No photograph is drawn at all: the print is only these
// strokes on a cobalt-shadow ground, the crown's cut along the contours of
// the leaves' light and the sky's ruled nearly level (engrave.js). Each
// stroke is a ribbon through P spine points whose width at each point is the
// light there (the leaves', or the softened sky's on a finer scale), tapered
// at its ends, so at rest the print reads as a line engraving. The sky's
// strokes hold still and keep one cool ink; for the crown's: Every spine
// point is carried by the modal field at its own rest position, so a pull
// bends the strokes where the crown shears; only an end that trails its
// motion lags behind, by a share of its displacement capped at a line and a
// half, so a stroke draws out a little without ever smearing into a brush
// mark, and its width stays the leaves' light at its rest position. Its tint is the phase of the
// analytic signal sum_i phi_i (q_i - i v_i / omega_i) read in the frame of
// the pull, on a continuous hue wheel: gold swings with the hand, violet
// against it, teal leads it and rose lags it (or each swings off to one side of
// it), with the saturation set by how hard the point is swinging. At rest the
// ink is a warm paper white.
const strokeVert = (K, P, SPR, fieldTex) => `#version 300 es
precision highp float;
precision highp sampler2DArray;
${fieldTex ? "#define FIELD_TEX" : ""}
#define P ${P}
#define SPR ${SPR}
uniform highp sampler2D uSpine;  // per stroke: P spine points, plate px
uniform highp sampler2D uMeta;   // per stroke: kind (1 = sky), length (plate px), caps at start and end
uniform sampler2D uTree;
uniform sampler2D uSkyLum;       // the sky's softened light
#ifdef FIELD_TEX
uniform highp sampler2D uField;  // zr, zi (plate px), evaluated this frame
#else
uniform sampler2DArray uModes;
uniform vec2 uQ[${K}];
uniform vec2 uW[${K}];
#endif
uniform vec4 uView;
uniform vec2 uPlate;
uniform vec2 uRes;      // target px
uniform vec2 uRef;      // reference direction for the phase
uniform float uHalf;    // widest half-width, target px
uniform float uLod;
uniform float uTrail;   // share of the displacement the trailing end lags by
uniform float uCap;     // longest lag, plate px
uniform float uRamp;    // how far along the stroke the lag eases out, plate px
uniform vec2 uLum;      // luminance that starts and fills a stroke
uniform float uFloor;   // the crown's finest line in shadow, as a share of its widest
uniform float uSkyHalf; // the sky's widest half-width, target px
uniform vec3 uSkyLight; // sky light of its finest and widest line, finest share
uniform float uCapLen;  // a sky line's taper, plate px
uniform vec3 uSkyInk;   // OKLCH
uniform float uMove;    // 1: carried by the modal field, 0: at rest
uniform float uCover;   // > 0: the cover pass, every line this half-width (target px)
out float vKind;
out vec2 vPlate;
out float vAcross;
out float vHalf;
out vec3 vCol;

vec4 fieldAt(vec2 p) {
#ifdef FIELD_TEX
  return texture(uField, p / uPlate);
#else
  vec2 uv = p / uPlate;
  vec2 zr = vec2(0.0);
  vec2 zi = vec2(0.0);
  for (int i = 0; i < ${K}; i++) {
    vec4 m = texture(uModes, vec3(uv, float(i))) * 2.0 - 1.0;
    zr += m.xy * uQ[i].x - m.zw * uQ[i].y;
    zi -= m.xy * uW[i].x - m.zw * uW[i].y;
  }
  return vec4(zr, zi);
#endif
}

vec2 spine(int id, int j) {
  int row = id / SPR;
  vec4 t = texelFetch(uSpine, ivec2((id - row * SPR) * ${P / 2} + (j >> 1), row), 0);
  return (j & 1) == 0 ? t.xy : t.zw;
}

vec3 oklch(float L, float C, float h) {
  float a = C * cos(h);
  float b = C * sin(h);
  float l = L + 0.3963377774 * a + 0.2158037573 * b;
  float m = L - 0.1055613458 * a - 0.0638541728 * b;
  float s = L - 0.0894841775 * a - 1.2914855480 * b;
  l = l * l * l;
  m = m * m * m;
  s = s * s * s;
  vec3 rgb = vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
  return pow(clamp(rgb, 0.0, 1.0), vec3(1.0 / 2.2));
}

bool sky;
float lagA;   // how far the stroke's start trails its motion, plate px
float lagB;   // and its end
vec2 dirA;    // the way each end is moving (unit)
vec2 dirB;
float slen;   // the stroke's length, plate px

// A spine point is carried by the modal field at its own rest position, so
// the stroke bends where the crown shears but is never smeared: only an end
// that trails its motion lags behind, by at most uCap, eased out over the
// last uRamp of the stroke.
vec2 placed(int id, int j, out vec4 F, out vec2 b) {
  b = spine(id, j);
  F = sky ? vec4(0.0) : fieldAt(b) * uMove;
  float s = float(j) / float(P - 1) * slen;
  float wa = 1.0 - smoothstep(0.0, uRamp, s);
  float wb = 1.0 - smoothstep(0.0, uRamp, slen - s);
  return b + F.xy - dirA * lagA * wa - dirB * lagB * wb;
}

// how far an end trails: the share of its displacement uTrail, softly capped
// at uCap, and only as much as the end faces away from where it is going
float trailing(vec2 F, vec2 outward, out vec2 d) {
  float m = length(F);
  d = m > 1e-3 ? F / m : vec2(0.0);
  float back = clamp(-dot(normalize(outward), d), 0.0, 1.0);
  return uCap * (1.0 - exp(-m * uTrail / uCap)) * back;
}

vec2 toTarget(vec2 p) {
  return (p / uPlate - uView.xy) / uView.zw * uRes;
}

void main() {
  int id = gl_InstanceID;
  int j = gl_VertexID >> 1;
  float side = (gl_VertexID & 1) == 0 ? -1.0 : 1.0;
  vec4 meta = texelFetch(uMeta, ivec2(id - (id / SPR) * SPR, id / SPR), 0);
  sky = meta.x > 0.5;
  vec2 b0 = spine(id, 0);
  vec2 b1 = spine(id, P - 1);
  slen = meta.y;
  lagA = 0.0;
  lagB = 0.0;
  dirA = vec2(0.0);
  dirB = vec2(0.0);
  if (!sky && uMove > 0.0) {
    lagA = trailing(fieldAt(b0).xy, b0 - spine(id, 1), dirA);
    lagB = trailing(fieldAt(b1).xy, b1 - spine(id, P - 2), dirB);
  }

  vec4 F;
  vec2 b;
  vec4 Fx;
  vec2 bx;
  vec2 p = toTarget(placed(id, j, F, b));
  vec2 pa = toTarget(placed(id, max(j - 1, 0), Fx, bx));
  vec2 pb = toTarget(placed(id, min(j + 1, P - 1), Fx, bx));
  vec2 tg = pb - pa;
  tg = dot(tg, tg) > 1e-8 ? normalize(tg) : vec2(1.0, 0.0);
  vec2 nrm = vec2(-tg.y, tg.x);

  float tp = float(j) / float(P - 1);
  float hw;
  if (sky) {
    // width: the sky's light, so its falloff reads as the lines thinning
    // toward the top and a cloud as them swelling; a run tapers only where
    // its line ends, so the joins between runs don't show
    float sl = texture(uSkyLum, b / uPlate).r;
    float w = mix(uSkyLight.z, 1.0, pow(smoothstep(uSkyLight.x, uSkyLight.y, sl), 0.85));
    float s0 = tp * meta.y;
    float s1 = meta.y - s0;
    float c = min(meta.z > 0.5 ? s0 : 1e6, meta.w > 0.5 ? s1 : 1e6) / uCapLen;
    hw = uSkyHalf * w * pow(clamp(c, 0.0, 1.0), 0.6);
  } else {
    // width: the leaves' own light at this spine point's rest position
    vec4 t = textureLod(uTree, b / uPlate, uLod);
    // and a hairline floor inside the matte, so the crown's shadow is fine
    // lines on the ground rather than a hole cut out of the sky's ruling
    float cov = smoothstep(0.25, 0.7, t.a);
    float lum = dot(t.rgb, vec3(0.2126, 0.7152, 0.0722)) * cov;
    float w = max(pow(clamp((lum - uLum.x) / (uLum.y - uLum.x), 0.0, 1.0), 0.6), uFloor * cov);
    // tapered over a fixed length at each end, however long the line runs
    float taper = pow(clamp(min(tp, 1.0 - tp) * meta.y / uCapLen, 0.0, 1.0), 0.6);
    // (in the cover pass every line is as wide as the cover reaches, unless
    // it is barely there itself)
    hw = uCover > 0.0 ? uCover * smoothstep(0.0, 0.3, w) : uHalf * w * taper;
  }
  float e = hw + 1.0;
  vec2 px = p + nrm * side * e;
  gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0);
  vAcross = side * e;
  vHalf = hw;

  vKind = meta.x;
  vPlate = b / uPlate;
  if (sky) {
    vCol = oklch(uSkyInk.x, uSkyInk.y, uSkyInk.z);
    return;
  }
  // tint: the phase in the frame of the pull
  vec2 perp = vec2(-uRef.y, uRef.x);
  vec2 zr = F.xy;
  vec2 zi = F.zw;
  float th = atan(dot(zi, uRef) + dot(zr, perp), dot(zr, uRef));
  // saturation keeps climbing with the swing's amplitude, so how hard each
  // part of the crown answers reads as a gradient, not a threshold
  float sat = 1.0 - exp(-length(F) / 26.0);
  // (its lightness falls only a little, so the lit clumps still read as the
  // light of the print under a hard pull, not as a colour map)
  vCol = oklch(mix(0.95, 0.88, sat), mix(0.02, 0.17, sat), 1.66 + th);
}`;

const STROKE_FRAG = `#version 300 es
precision highp float;
in float vKind;
in vec2 vPlate;
in float vAcross;
in float vHalf;
in vec3 vCol;
out vec4 outColor;
uniform sampler2D uRestCover; // the plate the crown's lines cover at rest
uniform sampler2D uNowCover;  // and now
void main() {
  // an engraved line: hard-edged, its coverage antialiased across the width
  float a = clamp(vHalf + 0.5 - abs(vAcross), 0.0, 1.0) * clamp(vHalf * 2.0, 0.0, 1.0);
  // the sky's ruling is hidden where the crown swings over it and carries on
  // beneath it where the crown swings away
  if (vKind > 0.5) {
    // (the cover was drawn the way the print is, so its rows run bottom up)
    vec2 cv = vec2(vPlate.x, 1.0 - vPlate.y);
    float rest = smoothstep(0.3, 0.7, texture(uRestCover, cv).r);
    float now = smoothstep(0.3, 0.7, texture(uNowCover, cv).r);
    a *= vKind > 1.5 ? rest * (1.0 - now) : 1.0 - now * (1.0 - rest);
  }
  outColor = vec4(vCol * a, a);
}`;

// The crown's cover: its lines drawn wide enough to run together, carried
// as they are now or held at rest, into a coarse map of the plate.
const COVER_FRAG = `#version 300 es
precision highp float;
in float vAcross;
in float vHalf;
out vec4 outColor;
void main() {
  float a = clamp(vHalf + 0.5 - abs(vAcross), 0.0, 1.0);
  outColor = vec4(a);
}`;

// the modal field (displacement and its quarter-cycle on), once per frame on
// the mode grid, for the strokes to read
const fieldFrag = (K) => `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vUv;
out vec4 outColor;
uniform sampler2DArray uModes;
uniform vec2 uQ[${K}];
uniform vec2 uW[${K}];
void main() {
  vec2 zr = vec2(0.0);
  vec2 zi = vec2(0.0);
  for (int i = 0; i < ${K}; i++) {
    vec4 m = texture(uModes, vec3(vUv, float(i))) * 2.0 - 1.0;
    zr += m.xy * uQ[i].x - m.zw * uQ[i].y;
    zi -= m.xy * uW[i].x - m.zw * uW[i].y;
  }
  outColor = vec4(zr, zi);
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

async function loadBitmap(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  const blob = await res.blob();
  return createImageBitmap(blob, {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
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

function imageTexture(gl, img) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// the mode atlas (K tiles stacked vertically) as a texture array, and its
// exact bytes read back for the CPU side
function modeArray(gl, bmp, gw, gh, K) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, gw, gh, K, 0, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const layers = [];
  for (let i = 0; i < K; i++) {
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, t, 0, i);
    const px = new Uint8Array(gw * gh * 4);
    gl.readPixels(0, 0, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, px);
    layers.push(px);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  return { tex: t, layers };
}

function target(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}
const freeTarget = (gl, t) => {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
};

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

// a seeded generator, so a still is the same every time
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function createPoke(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const pokeQ = (q.get("poke") || "").split(",").map(Number).filter(Number.isFinite);
  const tQ = q.get("t") != null && q.get("t") !== "" && Number.isFinite(+q.get("t")) ? +q.get("t") : null;
  const posed = pokeQ.length >= 3;
  const still = posed || q.get("still") === "1";
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");

  const [meta, treeBmp, skyBmp, modesBmp] = await Promise.all([
    fetch(BASE + "modes.json").then((r) => r.json()),
    loadBitmap(BASE + "tree.webp"),
    loadBitmap(BASE + "sky.webp"),
    loadBitmap(BASE + "modes.png"),
  ]);
  const K = meta.modes.length;
  const [gw, gh] = meta.grid;
  const [PW, PH] = meta.plate;
  const tex = { tree: imageTexture(gl, treeBmp) };
  // the contour fields of the leaves' light and of the sky's, which the
  // engraving's lines follow
  const orient = orientation(treeBmp, PW, PH);
  const skyF = skyField(skyBmp, PW, PH);
  {
    // the sky's softened light, which sets the width of its lines
    const n = skyF.W * skyF.H;
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = Math.round(clamp(skyF.lum[i], 0, 1) * 255);
    tex.skyLum = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex.skyLum);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, skyF.W, skyF.H, 0, gl.RED, gl.UNSIGNED_BYTE, b);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  const ma = modeArray(gl, modesBmp, gw, gh, K);
  tex.modes = ma.tex;
  treeBmp.close?.();
  skyBmp.close?.();
  modesBmp.close?.();
  const modal = createModal(meta, ma.layers, { tilt: TILT });

  // the reference direction the strokes' phase is read against: the last pull
  const ref = [-1, 0];

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  // the modal field, evaluated once a frame on the mode grid, if the GPU can
  // render to half floats; otherwise the strokes evaluate it themselves
  let fieldT = null;
  if (gl.getExtension("EXT_color_buffer_float")) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, gw, gh, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (ok) fieldT = { tex: t, fbo, w: gw, h: gh };
    else {
      gl.deleteTexture(t);
      gl.deleteFramebuffer(fbo);
    }
  }
  const fieldP = fieldT ? program(gl, VERT, fieldFrag(K)) : null;
  const SPR = 170; // strokes per row of the spine texture
  const strokes = program(gl, strokeVert(K, P, SPR, !!fieldT), STROKE_FRAG);
  const coverP = program(gl, strokeVert(K, P, SPR, !!fieldT), COVER_FRAG);
  const restCover = target(gl, MASK[0], MASK[1]);
  const nowCover = target(gl, MASK[0], MASK[1]);
  let restDirty = true;
  const strokeVao = gl.createVertexArray(); // no attributes: all from gl_VertexID
  tex.spine = gl.createTexture();
  tex.meta = gl.createTexture();
  let lines = { count: 0, crown: 0, sep: 0 };
  const floats = (t, w, rows, data) => {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, rows, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  };
  // lay the lines out for this size: their separation is fixed on the print.
  // The crown is laid first and the sky after it into the same separation
  // grid, so the sky's lines stop where they come within reach of the crown's.
  const layLines = (sep) => {
    if (lines.sep && Math.abs(sep / lines.sep - 1) < 0.08) return;
    const space = createSpace(PW, PH, sep);
    const crown = layStrokes(orient, sep, mulberry(23), {
      space,
      lumLo: SHADE > 0 ? -1 : LUM[0],
      solidMin: SPECK,
      cut: CROWN_RUN,
      shortest: CROWN_SHORTEST,
      dtest: 0.45,
    });
    const sky = layStrokes(skyF, sep, mulberry(29), {
      space,
      sky: true,
      cut: SKY_RUN,
      reach: 800,
      shortest: 8,
      under: SKY_UNDER,
    });
    const count = crown.count + sky.count;
    const rows = Math.max(1, Math.ceil(count / SPR));
    const spine = new Float32Array(SPR * (P / 2) * rows * 4);
    spine.set(crown.data);
    spine.set(sky.data, crown.data.length);
    floats(tex.spine, SPR * (P / 2), rows, spine);
    const meta = new Float32Array(SPR * rows * META);
    meta.set(crown.meta);
    meta.set(sky.meta, crown.meta.length);
    floats(tex.meta, SPR, rows, meta);
    lines = { count, crown: crown.count, sep };
    restDirty = true;
  };
  const blit = program(gl, VERT, BLIT);
  const film = createFilm(gl, { width: 2, height: 2 });

  // --- layout: a 3:2 print on the paper; the print is a window on the plate ---
  const L = { x: 0, y: 0, w: 1, h: 1, view: [0, 0, 1, 1] };
  let sceneT = null;
  let filmT = null;
  let dirty = true;
  let scale = 1;
  let lastBox = null;
  const layout = (W, H, dpr) => {
    lastBox = [W, H, dpr];
    if (embedded) {
      Object.assign(L, { x: 0, y: 0, w: W, h: H });
    } else {
      // a phone gets a 4:5 print: the crown against the sky, the way it is held
      const aspect = W < 600 ? 0.8 : ASPECT;
      const side = W < 600 ? 16 : Math.max(24, W * 0.07);
      let h = H * (W < 600 ? 0.7 : 0.78);
      let w = h * aspect;
      if (w > W - side * 2) {
        w = W - side * 2;
        h = w / aspect;
      }
      Object.assign(L, {
        w,
        h,
        x: (W - w) / 2,
        y: (H - h) / 2 - (W < 600 ? 8 : 4),
      });
    }
    // window in the plate: full print height of VIEW_H, anchored at the right
    const a = L.w / L.h;
    let vh = VIEW_H;
    let vw = (vh * a * PH) / PW;
    if (vw > 0.97) {
      vw = 0.97;
      vh = (vw * PW) / (a * PH);
    }
    L.view = [VIEW_X - vw, 0.5 - vh / 2, vw, vh];
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
    sceneT = target(gl, L.rw, L.rh);
    filmT = target(gl, L.rw, L.rh);
    film.resize(L.rw, L.rh);
    layLines((LINE * (stage.dpr / 2) * (L.rw / Math.max(1, L.pw))) / (L.rw / (L.view[2] * PW)));
    dirty = true;
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  const toPlate = (x, y) => [
    (L.view[0] + ((x - L.x) / L.w) * L.view[2]) * PW,
    (L.view[1] + ((y - L.y) / L.h) * L.view[3]) * PH,
  ];
  const inPrint = (p) => p.x >= L.x && p.x <= L.x + L.w && p.y >= L.y && p.y <= L.y + L.h;
  const grabbable = (px, py) => modal.complianceAt(px, py) > 0.06;

  // --- the hand ---
  let held = null; // { x0, y0, dx0, dy0 }
  const rubber = (dx, dy, lmax) => {
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) return [0, 0];
    const s = (lmax * (1 - Math.exp(-l / lmax))) / l;
    return [dx * s, dy * s];
  };
  const pull = (held, px, py) => {
    const [ox, oy] = rubber(px - held.px0, py - held.py0, held.lmax);
    modal.setTarget(held.dx0 + ox, held.dy0 + oy);
    const l = Math.hypot(ox, oy);
    if (l > 4) {
      ref[0] = ox / l;
      ref[1] = oy / l;
    }
  };

  stage.on("down", (p) => {
    if (posed || !inPrint(p)) return;
    const [px, py] = toPlate(p.x, p.y);
    if (!grabbable(px, py)) return;
    const h = modal.grab(px, py, { dmax: DMAX, radius: HAND });
    // stiffer spots travel less: the limit scales with the spot's compliance
    held = {
      px0: px,
      py0: py,
      dx0: h.tx,
      dy0: h.ty,
      lmax: Math.min(LMAX, h.reach),
    };
    host.dataset.grab = "held";
    dirty = true;
  });
  stage.on("move", (p) => {
    const [px, py] = toPlate(p.x, p.y);
    if (held) {
      pull(held, px, py);
      dirty = true;
    } else if (!posed) {
      host.dataset.grab = inPrint(p) && grabbable(px, py) ? "open" : "";
    }
  });
  stage.on("up", (p) => {
    if (!held) return;
    held = null;
    modal.release();
    const [px, py] = toPlate(p.x, p.y);
    host.dataset.grab = inPrint(p) && grabbable(px, py) ? "open" : "";
  });

  // --- a posed still: pull, hold until it settles, let go, run t seconds ---
  let posedDone = false;
  const runPose = () => {
    posedDone = true;
    const [ux, uy, amp, deg = 180] = pokeQ;
    const [px, py] = [(L.view[0] + ux * L.view[2]) * PW, (L.view[1] + uy * L.view[3]) * PH];
    const h = modal.grab(px, py, { dmax: DMAX, radius: HAND });
    const tx0 = h.tx;
    const ty0 = h.ty;
    const len = amp * L.view[2] * PW;
    const r = (deg * Math.PI) / 180;
    const lmax = Math.min(LMAX, h.reach);
    const [ox, oy] = rubber(Math.cos(r) * len, -Math.sin(r) * len, lmax);
    ref[0] = Math.cos(r);
    ref[1] = -Math.sin(r);
    const steps = 240;
    for (let i = 0; i < steps; i++) {
      // ease the pull in over the first second, as a hand would
      const e = Math.min(1, (i / 60) * 1.0);
      const k = 1 - Math.pow(1 - e, 3);
      modal.setTarget(tx0 + ox * k, ty0 + oy * k);
      modal.step(1 / 60);
    }
    if (tQ != null && tQ >= 0) {
      modal.release();
      const n = Math.round(tQ * 120);
      for (let i = 0; i < n; i++) modal.step(1 / 120);
    }
  };

  // --- draw ---
  const uQ = new Float32Array(K * 2);
  const uW = new Float32Array(K * 2);
  let grainSeed = 0;
  const draw = (expoStops, fade) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    // the ground: cobalt shadow over the whole print
    const ex = 2 ** expoStops;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, L.rw, L.rh);
    gl.clearColor(GROUND[0] * ex, GROUND[1] * ex, GROUND[2] * ex, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // the engraving, over its ground, before the film
    for (let i = 0; i < K; i++) {
      uQ[i * 2] = modal.q[i * 2] * modal.scale[i];
      uQ[i * 2 + 1] = modal.q[i * 2 + 1] * modal.scale[i];
      uW[i * 2] = (modal.v[i * 2] * modal.scale[i]) / modal.omega[i];
      uW[i * 2 + 1] = (modal.v[i * 2 + 1] * modal.scale[i]) / modal.omega[i];
    }
    if (fieldT) {
      gl.useProgram(fieldP.p);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex.modes);
      gl.uniform1i(fieldP.u.uModes, 2);
      gl.uniform2fv(fieldP.u.uQ, uQ);
      gl.uniform2fv(fieldP.u.uW, uW);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fieldT.fbo);
      gl.viewport(0, 0, fieldT.w, fieldT.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
      gl.viewport(0, 0, L.rw, L.rh);
    }
    const sep = LINE * (stage.dpr / 2) * (L.rw / Math.max(1, L.pw)); // target px
    const k = L.rw / (L.view[2] * PW); // plate px -> target px
    const bindStrokes = (pr, view, rw, rh, kk, move, cover) => {
      const su = pr.u;
      gl.useProgram(pr.p);
      gl.bindVertexArray(strokeVao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex.tree);
      gl.uniform1i(su.uTree, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tex.skyLum);
      gl.uniform1i(su.uSkyLum, 1);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, tex.meta);
      gl.uniform1i(su.uMeta, 5);
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D, tex.spine);
      gl.uniform1i(su.uSpine, 6);
      if (fieldT) {
        gl.activeTexture(gl.TEXTURE7);
        gl.bindTexture(gl.TEXTURE_2D, fieldT.tex);
        gl.uniform1i(su.uField, 7);
      } else {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex.modes);
        gl.uniform1i(su.uModes, 2);
        gl.uniform2fv(su.uQ, uQ);
        gl.uniform2fv(su.uW, uW);
      }
      gl.uniform4f(su.uView, ...view);
      gl.uniform2f(su.uPlate, PW, PH);
      gl.uniform2f(su.uRes, rw, rh);
      gl.uniform2f(su.uRef, ref[0], ref[1]);
      gl.uniform1f(su.uHalf, sep * WIDTH);
      gl.uniform1f(su.uLod, Math.log2(Math.max(1, (sep / k) * 0.35)));
      gl.uniform1f(su.uTrail, TRAIL);
      gl.uniform1f(su.uCap, (sep / k) * TRAIL_CAP);
      gl.uniform1f(su.uRamp, (sep / k) * TRAIL_RAMP);
      gl.uniform2f(su.uLum, LUM[0], LUM[1]);
      gl.uniform1f(su.uFloor, SHADE);
      gl.uniform1f(su.uSkyHalf, sep * SKY_WIDTH);
      gl.uniform3f(su.uSkyLight, SKY_LUM[0], SKY_LUM[1], SKY_THIN);
      gl.uniform1f(su.uCapLen, (sep / k) * 1.5);
      gl.uniform3fv(su.uSkyInk, SKY_INK);
      gl.uniform1f(su.uMove, move);
      gl.uniform1f(su.uCover, cover * kk);
    };
    // the crown's cover, now and (once per layout) at rest, at the mask's scale
    const km = MASK[0] / PW;
    const covers = restDirty
      ? [
          [restCover, 0],
          [nowCover, 1],
        ]
      : [[nowCover, 1]];
    restDirty = false;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (const [t, move] of covers) {
      bindStrokes(coverP, [0, 0, 1, 1], MASK[0], MASK[1], km, move, (sep / k) * COVER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, MASK[0], MASK[1]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, P * 2, lines.crown);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, L.rw, L.rh);
    bindStrokes(strokes, L.view, L.rw, L.rh, k, 1, 0);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, restCover.tex);
    gl.uniform1i(strokes.u.uRestCover, 3);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, nowCover.tex);
    gl.uniform1i(strokes.u.uNowCover, 4);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, P * 2, lines.count);
    gl.disable(gl.BLEND);

    film.render(
      sceneT.tex,
      {
        ...FILM_PRESETS.summer,
        halation: 0.12,
        halationThreshold: 0.85,
        bloom: 0.1,
        softness: 0.12,
        contrast: 1.14,
        whitePoint: 1.25,
        toe: 0.06,
        blueDepth: 0.6,
        saturation: 0.97,
        warmth: 0.08,
        vignette: 0.22,
        grain: 0.3,
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

  let wall = 0;
  let t0 = -1;
  let grainClock = 0;
  let slow = 0;
  let lastNow = 0;
  const rand = mulberry(7);
  const breezeOn = !still && !reduce;
  stage.onFrame((dt) => {
    if (!sceneT) return;
    if (posed && !posedDone) runPose();
    const now = performance.now();
    const real = lastNow ? (now - lastNow) / 1000 : 1 / 60;
    lastNow = now;
    if (!still) {
      // drop the render scale on a slow machine
      const r = Math.min(real, 0.25);
      slow = real > 1 / 40 ? slow + r : Math.max(0, slow - r * 0.5);
      if (slow > 1.2 && scale > 0.5) {
        scale = scale > 0.8 ? 0.75 : 0.5;
        slow = 0;
        if (lastBox) layout(...lastBox);
      }
    }
    wall += dt;
    if (t0 < 0) t0 = wall;
    const age = still ? 99 : wall - t0;
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 2.2 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
    }

    let moving = false;
    if (!posed) {
      modal.step(dt, { breezeAmp: breezeOn ? BREEZE : 0, rand });
      if (!breezeOn && held == null && modal.restless() < 0.02) {
        if (modal.restless() > 0) {
          modal.reset();
          dirty = true;
        }
      } else moving = true;
    }
    if (!reduce && !still && moving) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        grainSeed = (grainSeed + 1) % 997;
      }
    }
    if (!dirty && !moving && age > REVEAL + 0.2) return;
    dirty = false;
    draw(expo, fade);
  });

  return {
    destroy() {
      film.destroy();
      freeTarget(gl, sceneT);
      freeTarget(gl, filmT);
      Object.values(tex).forEach((t) => gl.deleteTexture(t));
      gl.deleteProgram(blit.p);
      gl.deleteProgram(strokes.p);
      gl.deleteProgram(coverP.p);
      freeTarget(gl, restCover);
      freeTarget(gl, nowCover);
      if (fieldT) {
        gl.deleteProgram(fieldP.p);
        freeTarget(gl, fieldT);
      }
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      gl.deleteVertexArray(strokeVao);
      stage.destroy();
    },
  };
}
