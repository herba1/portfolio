import { createStage, clamp, damp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";
import { createPluckSound } from "./pluck";
import { NODES, createWorld, locate, offsetAt, pullShape, sampleY } from "./strings";

// Catenary: the overhead wires of a Japanese railway mast, photographed from
// underneath against summer cumulus, are real strings.
//
// Offline (tools/depth/bakes/catenary), six wires were found
// in the 6000 x 4000 photograph, each fitted as a catenary in image space
// from its insulator to where it leaves the frame (sub-pixel ridge, robust
// least squares, 0.05-0.4 px rms), and painted out of the plate: the low
// frequencies are bridged across the band from its two banks, the grain and
// cloud detail are borrowed from a parallel strip just outside. Each wire's
// optical profile was measured against that clean plate: width (along the
// span, perspective), blur and opacity (regressed on the depth map, so the
// far end softens with distance), and a shade across the cable (it is a lit
// cylinder: a sky-blue rim, a dark core, a glint). Recomposited at rest the
// wires land within 2-3 levels of the photograph at display size.
//
// Here each wire is a damped string of 97 nodes over its whole span (the far
// support is off frame): c = 2 L f1, a Kelvin-Voigt term that kills the high
// modes first, and both ends fixed, so a pluck splits into two pulses that
// run out, reflect at the insulators upside down and ring down into the low
// modes. The supports are not rigid: each structure (the mast, the far pole)
// is a stiff damped mass the wires pull on, so a hard pluck shows faintly in
// the neighbours. A slow, zero-mean breeze keeps them alive at rest. A hand
// is a pad, not a point, so a pull rounds into a crown instead of a V. The
// wires are drawn analytically (erf of a blurred box, the measured shade) in
// linear light at device resolution, along the fitted catenary evaluated
// exactly plus a cubic through the nodes' displacement, then the frame is
// developed through the shared film kit (summer).
//
// Query: ?still=1 (no breeze), ?pluck=<wire 0-5>&t=<seconds after release>
// [&at=<0..1 along the visible run>&amp=<0..1>], ?pull=<wire> holds the pull.
// Any numeric FILM key (exposure, whitePoint, ...), struct, structGain,
// structFloor, cloudLift, hal, diffuse, zenith, polar, polarSat, polarHue,
// vib, vibFloor, vibHue, vibV override the grade.

const ASSET = "/lab/catenary/";
const WIDTH_TRIM = 0.6; // image px
// The view: one anchor. The plate is shown VIEW.zoom past cover and pinned to
// the photograph's upper right, so the mast top stands in the left third,
// the truss is the single diagonal and the big sunlit cumulus fills the upper
// right; the caged platform, the transformer, the far pole's foot and the
// tangle of wires low on the left fall off the edges. Image px of the
// 6000 x 4000 photograph. A box narrower than the 16:10 crop keeps the
// crop's width down to its height (4:3 shows more sky below, not less mast);
// a portrait box covers at its height and still holds the mast top at
// poleAt of the width, running the rest up the truss into the feeder.
const VIEW = {
  zoom: 1.3, // past cover, on a 16:10 box
  left: 1385, // the widest crop's left edge: the mast top with a margin
  top: 120, // the crop's top edge
  pole: 1915, // the mast top
  poleAt: 0.11, // the furthest left it may sit, as a share of the width
};


const FILM = {
  ...FILM_PRESETS.summer,
  exposure: 0,
  input: "linear",
  // A plate that is already a soft film scan: less extra veil. The sunlit
  // cloud is printed up to just under paper white (about 0.96, nothing at
  // 255) so it glows; the shoulder still rolls it off instead of clipping.
  bloom: 0.2,
  softness: 0.4,
  halation: 0.32,
  whitePoint: 1.1,
  contrast: 1.25,
  blueDepth: 0.85,
  saturation: 1.06,
  grain: 0.38,
  vignette: 0.2,
  // Low enough that the sunlit cloud (scene luma ~0.75-0.85) feeds the halo,
  // high enough that the polarised sky (~0.2) does not: a thin warm ring
  // where the steel and the wires cross bright cloud.
  halationThreshold: 0.6,
  // The summer preset cools its highlights; the plate lifts the cloud tops to
  // warm-neutral itself, so the print leaves them as they come.
  highlightTint: [1, 1, 1],
};
// The plate is split three ways before the film (see PLATE), on a baked key
// (tools/depth/bakes/catenary/key.py): R is the structure, the depth map's
// near field snapped to the steel's edges; G and B are the sunlit cloud,
// blurred thin and wide.
//  - Structure (mast, truss, platform, poles, and the live wires): as shot it
//    carries the sky's cyan-cobalt, so the anchor sinks into it. It is drawn
//    toward graphite, STRUCT of the way, keeping its own luminance texture,
//    lifted (y * STRUCT_GAIN + STRUCT_FLOOR) and given a slight warm bias
//    that the film's cool toe and shadow tint bring back to near neutral.
//  - Cloud: past a knee the lit masses take CLOUD_LIFT of the headroom left
//    and draw toward warm-neutral paper (CLOUD_TOP, #f3eee4); a share of the
//    headroom, so it bends toward white and never reaches it.
//  - Halation and diffusion: the cloud light, blurred thin, minus the cloud
//    itself, is laid on in a warm tint at HAL (a fine glow where cloud meets
//    sky and where steel and wires cross it); blurred wide, screened in at
//    DIFFUSE, it veils the cobalt near the cloud.
const STRUCT = 0.88;
// Dark: the one silhouette has to stand off the cloud, about rgb(62,66,70)
// on its lit face after the print, its rust and banding still in it.
const STRUCT_GAIN = 0.45;
const STRUCT_FLOOR = 0.006;
const STRUCT_TINT = [1.06, 1, 0.9]; // linear, luminance-normalised
const CLOUD_TOP = [0xf3, 0xee, 0xe4];
// The print bleaches colour on its shoulder (saturation eases off toward
// white), so the plate aims this much warmer (linear) to land on CLOUD_TOP.
const CLOUD_AIM = [1.03, 1, 0.9];
const CLOUD_LIFT = 0.4;
const HAL = 0.7;
const HAL_TINT = [1, 0.7, 0.45]; // linear
const DIFFUSE = 0.18;
// The open sky deepens toward the zenith (the top edge): on top of the
// polariser, it loses up to ZENITH of its value there.
const ZENITH = 0.1;
// Graduated sky density, the way a polariser deepens a summer sky toward the
// zenith (here the top and upper right of the frame). Only the open blue
// sky takes it: a chroma mask (saturation over ~0.3, hue 190-220 in the
// plate's own sRGB) leaves cloud, steel and wires as shot. At the top edge
// the sky loses POLAR of its value, easing to nothing at the bottom, with a
// little more saturation and its hue drawn to about 208.
const POLAR = 0.22;
const POLAR_SAT = 0.08;
const POLAR_HUE = 208;
// Sky vibrance floor, after the polariser and before the film. The plate's
// lower sky is a hazy powder blue (S ~0.46 as shot); a real summer sky under
// a polariser holds its cyan-cobalt down to the horizon. Through the same
// chroma mask, ungraduated, low-saturation sky is drawn toward VIB_FLOOR
// (S' = max(S, mix(S, VIB_FLOOR, VIB))), its hue held at VIB_HUE, and the
// brightest of it (V over ~0.7) loses up to VIB_V of its value. The
// polariser's top-to-bottom deepening rides on top of this.
const VIB = 0.4;
const VIB_FLOOR = 0.85;
const VIB_HUE = 208;
const VIB_V = 0.045;

// Structure toward graphite: luminance kept, lifted out of the black, a
// slight warm bias. Shared by the plate and the live wires.
const GRAPHITE = `const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 graphite(vec3 c) {
  float y = dot(c, LUMA);
  return (y * uStruct.y + uStruct.z) * uStructTint / dot(uStructTint, LUMA);
}`;

const VERT_FULL = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const PLATE = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uPlate;
uniform vec2 uRes;   // device px
uniform vec3 uMap;   // ox, oy, k (device px per image px)
uniform vec2 uImg;   // image px
uniform sampler2D uKey; // R structure, G cloud light thin, B cloud light wide
uniform vec4 uStruct;  // amount, gain, floor, zenith
uniform vec3 uStructTint;
uniform vec3 uCloudTop; // linear
uniform vec3 uGlow;     // cloud lift, halation, diffusion
uniform vec3 uHalTint;
uniform vec3 uPolar;   // value loss at the top, saturation gain, hue (0..1)
uniform vec4 uVib;     // amount, saturation floor, hue (0..1), value loss
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
${GRAPHITE}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = (p - uMap.xy) / uMap.z / uImg;
  vec3 c = texture(uPlate, uv).rgb;
  vec3 key = texture(uKey, uv).rgb;

  // Polariser. The mask reads the plate a mip up (about 2 image px, under a
  // device px here) so the film grain in thin cloud does not speckle it.
  vec3 g = pow(c, vec3(1.0 / 2.2));
  vec3 hm = rgb2hsv(pow(texture(uPlate, uv, 1.0).rgb, vec3(1.0 / 2.2)));
  float hue = hm.x * 360.0;
  float sky = smoothstep(0.26, 0.38, hm.y) * smoothstep(188.0, 198.0, hue) * (1.0 - smoothstep(218.0, 228.0, hue))
            * smoothstep(0.25, 0.4, hm.z) * (1.0 - key.r);
  // Toward the zenith: the top edge, leaning to the upper right.
  vec2 f = p / uRes;
  float z = clamp(0.82 * (1.0 - f.y) + 0.18 * f.x, 0.0, 1.0);
  z = z * z * (3.0 - 2.0 * z);
  float w = sky * z;
  vec3 h = rgb2hsv(g);
  float dh = fract(uPolar.z - h.x + 0.5) - 0.5;
  h.x = fract(h.x + dh * 0.6 * w);
  h.y = clamp(h.y * (1.0 + uPolar.y * w), 0.0, 1.0);
  h.z *= 1.0 - uPolar.x * w;
  // Zenith: straight top-down, so the sky is deepest at the top edge.
  float zt = 1.0 - f.y;
  h.z *= 1.0 - uStruct.w * sky * zt * zt;
  // Vibrance floor: the whole open sky, not graduated.
  float dv = fract(uVib.z - h.x + 0.5) - 0.5;
  h.x = fract(h.x + dv * 0.8 * sky);
  h.y = mix(h.y, max(h.y, mix(h.y, uVib.y, uVib.x)), sky);
  h.z *= 1.0 - uVib.w * sky * smoothstep(0.6, 0.8, h.z);
  c = pow(hsv2rgb(h), vec3(2.2));

  // Structure: graphite, not cobalt.
  c = mix(c, graphite(c), key.r * uStruct.x);

  // Sunlit cloud: past the knee, a share of the headroom left, drawn toward
  // warm-neutral paper. Blue sky (chroma), the shade side of the cloud
  // (luminance) and the steel are left alone.
  float y = dot(c, LUMA);
  float yg = pow(y, 1.0 / 2.2);
  float mx = max(c.r, max(c.g, c.b));
  float chroma = (mx - min(c.r, min(c.g, c.b))) / max(mx, 1e-4);
  float top = smoothstep(0.6, 0.92, yg) * (1.0 - smoothstep(0.3, 0.5, chroma)) * (1.0 - key.r);
  float yt = y + (1.0 - y) * uGlow.x * top;
  c = mix(c * (yt / max(y, 1e-5)), uCloudTop * (yt / dot(uCloudTop, LUMA)), top);

  // Halation: the thin cloud light past the cloud's own edge, warm. Wide
  // diffusion: screened, so it lifts the cobalt and never clips.
  float self = smoothstep(0.62, 0.9, yg) * (1.0 - key.r);
  float rim = max(key.g - self, 0.0);
  // Both masked off the steel: the mast stays graphite where it crosses lit
  // cloud, one sharp silhouette against the soft cloud light.
  float bare = 1.0 - 0.85 * key.r;
  c += uHalTint * uGlow.y * rim * (1.0 - top) * 0.35 * bare;
  vec3 veil = uCloudTop * key.b * key.b * uGlow.z * bare;
  c = 1.0 - (1.0 - c) * (1.0 - veil);
  outColor = vec4(c, 1.0);
}`;

// One strip per wire. Positions arrive in device px (top-left origin); the
// across offset carries the analytic profile.
const WIRE_V = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in float aAcross;
layout(location = 2) in vec4 aProf;   // half width, blur, opacity, hand-off
layout(location = 3) in vec2 aRest;   // image px of the resting wire here
uniform vec2 uRes;
out float vD;
out vec4 vProf;
out vec2 vRest;
void main() {
  vD = aAcross;
  vProf = aProf;
  vRest = aRest;
  gl_Position = vec4(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0, 0.0, 1.0);
}`;

const WIRE_F = `#version 300 es
precision highp float;
in float vD;
in vec4 vProf;
in vec2 vRest;
out vec4 outColor;
uniform vec3 uShade[25];
uniform sampler2D uAtlas;
uniform vec2 uAtlasSize;
uniform vec4 uRiderBox;   // image px; zero size when none
uniform vec2 uRiderAt;    // atlas px of the box's corner
uniform sampler2D uKey;
uniform vec2 uImg;
uniform vec4 uStruct;
uniform vec3 uStructTint;
uniform vec3 uCloudTop;
uniform vec3 uGlow;
uniform vec3 uHalTint;
${GRAPHITE}
float erf_(float x) {
  float s = sign(x);
  x = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * x);
  float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x);
  return s * y;
}
void main() {
  float hw = vProf.x;
  // Optical blur plus the pixel's own footprint.
  float sig = sqrt(vProf.y * vProf.y + 0.085);
  float k = 0.70710678 / sig;
  float a = vProf.z * 0.5 * (erf_((vD + hw) * k) - erf_((vD - hw) * k));
  // Near its insulator the photograph keeps its own wire; the live one takes
  // over along a ramp so the sum stays exactly the photograph.
  float r = vProf.w;
  a = r * a / max(1.0 - a + r * a, 1e-4);
  // Where an insulator rides the wire, the insulator sprite carries it.
  if (uRiderBox.z > uRiderBox.x) {
    vec2 q = vRest - uRiderBox.xy;
    if (q.x >= 0.0 && q.y >= 0.0 && vRest.x <= uRiderBox.z && vRest.y <= uRiderBox.w) {
      a *= 1.0 - texture(uAtlas, (uRiderAt + q) / uAtlasSize).a;
    }
  }
  float u = clamp((vD / max(hw, 0.25) + 1.25) / 2.5 * 25.0 - 0.5, 0.0, 24.0);
  int i0 = int(floor(u));
  int i1 = min(i0 + 1, 24);
  vec3 col = mix(uShade[i0], uShade[i1], fract(u));
  // The same graphite as the steel; where the wire crosses lit cloud, the
  // cloud's halation and veil lie over it too, masked off the steel exactly
  // as the plate masks them, so a live wire matches the plate's own.
  col = mix(col, graphite(col), uStruct.x);
  vec3 key = texture(uKey, vRest / uImg).rgb;
  float bare = 1.0 - 0.85 * key.r;
  col += uHalTint * uGlow.y * key.g * 0.35 * bare;
  col = 1.0 - (1.0 - col) * (1.0 - uCloudTop * key.b * key.b * uGlow.z * bare);
  outColor = vec4(col, a);
}`;

const RIDER_V = `#version 300 es
layout(location = 0) in vec2 aPos;    // device px
layout(location = 1) in vec2 aUv;     // atlas uv
uniform vec2 uRes;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0, 0.0, 1.0);
}`;

const RIDER_F = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uAtlas;
void main() { outColor = texture(uAtlas, vUv); }`;

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

function compile(gl, vs, fs, attribs = ["aPos"]) {
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
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
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

async function bitmap(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  return createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function upload(gl, bm, { mips = true, linear = false } = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const levels = mips ? Math.floor(Math.log2(Math.max(bm.width, bm.height))) + 1 : 1;
  gl.texStorage2D(gl.TEXTURE_2D, levels, linear ? gl.RGBA8 : gl.SRGB8_ALPHA8, bm.width, bm.height);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bm);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  return tex;
}

export async function createCatenary(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const num = (k, d) => {
    const v = q.get(k);
    return v != null && v !== "" && Number.isFinite(+v) ? +v : d;
  };
  const pluckQ = q.get("pluck") ?? q.get("pull");
  const holdPull = q.get("pull") != null;
  const held = pluckQ != null || q.get("still") != null;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const struct = [
    clamp(num("struct", STRUCT), 0, 1),
    clamp(num("structGain", STRUCT_GAIN), 0, 4),
    clamp(num("structFloor", STRUCT_FLOOR), 0, 0.1),
    clamp(num("zenith", ZENITH), 0, 0.5),
  ];
  const cloudTop = CLOUD_TOP.map((v, i) => toLin(v / 255) * CLOUD_AIM[i]);
  const glow = [clamp(num("cloudLift", CLOUD_LIFT), 0, 1), clamp(num("hal", HAL), 0, 2), clamp(num("diffuse", DIFFUSE), 0, 1)];
  const polar = clamp(num("polar", POLAR), 0, 0.6);
  const polarSat = num("polarSat", POLAR_SAT);
  const polarHue = num("polarHue", POLAR_HUE);
  const vib = [
    clamp(num("vib", VIB), 0, 1),
    clamp(num("vibFloor", VIB_FLOOR), 0, 1),
    num("vibHue", VIB_HUE) / 360,
    clamp(num("vibV", VIB_V), 0, 0.5),
  ];
  const film0 = { ...FILM };
  for (const key of Object.keys(FILM)) {
    if (typeof FILM[key] === "number") film0[key] = num(key, FILM[key]);
  }

  // The colour field the frame opens from: the sky, overexposed.
  host.style.background = "#dfe8ef";

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");

  const [meta, plateBm, atlasBm, keyBm] = await Promise.all([
    fetch(`${ASSET}wires.json`).then((r) => r.json()),
    bitmap(`${ASSET}plate.webp`),
    bitmap(`${ASSET}riders.png`),
    bitmap(`${ASSET}key.webp`),
  ]);
  const [IW, IH] = meta.image;
  const plateTex = upload(gl, plateBm);
  const atlasTex = upload(gl, atlasBm);
  const keyTex = upload(gl, keyBm, { mips: false, linear: true });
  plateBm.close?.();
  atlasBm.close?.();
  keyBm.close?.();

  const world = createWorld(meta.wires);
  const { wires, groups } = world;

  const sound = createPluckSound();

  // ---- GL
  const plateP = compile(gl, VERT_FULL, PLATE);
  const wireP = compile(gl, WIRE_V, WIRE_F, ["aPos", "aAcross", "aProf", "aRest"]);
  const riderP = compile(gl, RIDER_V, RIDER_F, ["aPos", "aUv"]);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Render samples per node segment: ~2.5 device px apart on the feeder, so
  // the strip follows the curve, not a polyline.
  const SUB = 8;
  const STRIDE = 9;
  const maxVerts = (NODES * SUB + 2) * 2;
  const wireBuf = gl.createBuffer();
  const wireData = new Float32Array(maxVerts * STRIDE);
  const wireVao = gl.createVertexArray();
  gl.bindVertexArray(wireVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, wireBuf);
  gl.bufferData(gl.ARRAY_BUFFER, wireData.byteLength, gl.DYNAMIC_DRAW);
  const F = 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIDE * F, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, STRIDE * F, 2 * F);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, STRIDE * F, 3 * F);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 2, gl.FLOAT, false, STRIDE * F, 7 * F);

  const riderBuf = gl.createBuffer();
  const riderData = new Float32Array(6 * 4);
  const riderVao = gl.createVertexArray();
  gl.bindVertexArray(riderVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, riderBuf);
  gl.bufferData(gl.ARRAY_BUFFER, riderData.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
  gl.bindVertexArray(null);

  const half = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
  const film = createFilm(gl, { width: stage.canvas.width, height: stage.canvas.height });
  let sceneTex = null;
  let sceneFbo = null;
  let lastKey = "";
  let map = { ox: 0, oy: 0, k: 1, kRef: 1 };
  const build = () => {
    const w = stage.canvas.width;
    const h = stage.canvas.height;
    if (sceneTex) gl.deleteTexture(sceneTex);
    if (sceneFbo) gl.deleteFramebuffer(sceneFbo);
    sceneTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    sceneFbo = gl.createFramebuffer();
    let ok = false;
    if (half) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
      ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    }
    if (!ok) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
    }
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    film.resize(w, h);
    // Cover the box with the photograph, then crop in to the view.
    const cover = Math.max(w / IW, h / IH);
    const k = Math.max(cover, Math.min(cover * VIEW.zoom, w / (IW - VIEW.left)));
    const vw = w / k;
    const vh = h / k;
    const x0 = clamp(Math.min(IW - vw, VIEW.pole - VIEW.poleAt * vw), 0, IW - vw);
    const y0 = clamp(VIEW.top, 0, IH - vh);
    // kRef: the scale the motion is tuned at (cover, as before the crop), so
    // a pull, the breeze and the sound read the same against the photograph.
    map = { ox: -x0 * k, oy: -y0 * k, k, kRef: cover };
    lastKey = "";
  };
  stage.onResize(build);

  // css px -> image px
  const toImage = (x, y) => {
    const d = stage.dpr;
    return [(x * d - map.ox) / map.k, (y * d - map.oy) / map.k];
  };
  // A reach measured on a 1280 px box showing the whole photograph, in image
  // px for this box: the same draw against the wire whatever the crop.
  const reachOf = (w) => (w.tune.reach * stage.dpr * clamp(stage.width / 1280, 0.6, 1.4)) / map.kRef;

  // ---- physics
  const STEP = 1 / 720;
  let wind = 0; // 0..1 breeze strength (fades in after the reveal)
  const step = (h) => world.step(h, { wind, k: map.kRef });

  // ---- interaction
  let hoverWire = null;
  const catchRadius = () => (5 * stage.dpr) / map.k;

  const release = (w, speed = 0) => {
    const cg = w.caught;
    if (!cg) return;
    w.caught = null;
    // How far the string was drawn, in device px: the sound follows it.
    const drawn = Math.abs(sampleY(w, cg.j) * w.lead(cg.j * w.ds)) * map.kRef;
    sound.pluck({ wire: w.index, drawn, at: cg.j / w.N, f1: w.tune.f1, speed });
  };

  const track = (p, isDown) => {
    const [x, y] = toImage(p.x, p.y);
    for (const w of wires) {
      const hit = locate(w, x, y);
      if (!hit) continue;
      const jMin = Math.max(0.6, w.jGrip);
      const inRun = hit.j > jMin && hit.j < w.jExit - 0.3;
      if (w.caught) {
        // Slide along with the hand; let go past the reach. The hand sets
        // where the wire is drawn; the string under a drawing ease (the
        // feeder's clamp) is pulled that much further.
        w.caught.j = clamp(hit.j, jMin, w.jExit - 0.3);
        const off = offsetAt(w, w.caught.j, x, y);
        const reach = reachOf(w);
        const gain = 1 / Math.max(0.2, w.lead(w.caught.j * w.ds));
        if (Math.abs(off) > reach || !inRun) {
          w.caught.target = clamp(off, -reach, reach) * gain;
          release(w, Math.hypot(p.vx, p.vy));
          // The hand is now past the wire: only coming back crosses it.
          w.prevSide = off;
        } else w.caught.target = off * gain;
        continue;
      }
      if (!p.down || !inRun) {
        w.prevSide = hit.side;
        continue;
      }
      const crossed = w.prevSide != null && Math.sign(w.prevSide) !== Math.sign(hit.side) && hit.dist < reachOf(w) * 3;
      if ((isDown && hit.dist < catchRadius()) || crossed) {
        w.caught = { j: hit.j, target: offsetAt(w, hit.j, x, y) / Math.max(0.2, w.lead(hit.j * w.ds)) };
        sound.wake();
      }
      w.prevSide = hit.side;
    }
  };

  stage.on("down", (p) => {
    for (const w of wires) w.prevSide = null;
    track(p, true);
    // Seed sides so the first move can register a crossing.
    const [x, y] = toImage(p.x, p.y);
    for (const w of wires) {
      const hit = locate(w, x, y);
      if (hit && !w.caught) w.prevSide = hit.side;
    }
  });
  stage.on("move", (p) => track(p, false));
  stage.on("up", (p) => {
    for (const w of wires) if (w.caught) release(w, Math.hypot(p.vx, p.vy));
  });

  // ---- still: a pluck held at a moment
  const still = held;
  if (pluckQ != null) {
    const w = wires[clamp(Math.round(+pluckQ) || 0, 0, wires.length - 1)];
    const at = num("at", 0.42);
    const amp = clamp(num("amp", 1), 0, 1.5);
    const tAfter = holdPull ? 0 : num("t", 0.18);
    const settle = () => {
      const jc = clamp(at * w.jExit, 1, w.N - 1);
      pullShape(w, jc, reachOf(w) * amp);
      let t = 0;
      while (t < tAfter) {
        step(STEP);
        t += STEP;
      }
    };
    stage.onResize(() => settle());
  }

  // ---- render
  const setGrade = (pr) => {
    gl.uniform4fv(pr.u.uStruct, struct);
    gl.uniform3fv(pr.u.uStructTint, STRUCT_TINT);
    gl.uniform3fv(pr.u.uCloudTop, cloudTop);
    gl.uniform3fv(pr.u.uGlow, glow);
    gl.uniform3fv(pr.u.uHalTint, HAL_TINT);
  };
  const drawScene = () => {
    const W = stage.canvas.width;
    const H = stage.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(plateP.p);
    gl.bindVertexArray(quadVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, plateTex);
    gl.uniform1i(plateP.u.uPlate, 0);
    gl.uniform2f(plateP.u.uRes, W, H);
    gl.uniform3f(plateP.u.uMap, map.ox, map.oy, map.k);
    gl.uniform2f(plateP.u.uImg, IW, IH);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, keyTex);
    gl.uniform1i(plateP.u.uKey, 1);
    gl.activeTexture(gl.TEXTURE0);
    setGrade(plateP);
    gl.uniform3f(plateP.u.uPolar, polar, polarSat, polarHue / 360);
    gl.uniform4fv(plateP.u.uVib, vib);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    const k = map.k;
    for (const w of wires) {
      // Strip over the visible run (plus a little past the frame edge).
      let n = 0;
      const jEnd = w.jExit;
      const ho = w.def.handoff;
      for (let js = 0; js <= jEnd * SUB; js++) {
        const j = js / SUB;
        const s = j * w.ds;
        // Rest: the catenary itself at s; displacement: a cubic through the
        // simulation nodes, eased in where the photograph keeps its wire.
        const [rx, ry, nxx, nyy] = w.rest(s);
        const yy = sampleY(w, j) * w.lead(s);
        // Fitted widths read ~0.6 px wide of the photograph at display size.
        const hw = ((w.knot(w.def.w, s) - WIDTH_TRIM) / 2) * k;
        const sig = w.knot(w.def.sig, s) * k;
        const o = w.knot(w.def.o, s);
        const r = ho[1] > ho[0] ? clamp((s - ho[0]) / (ho[1] - ho[0]), 0, 1) : 1;
        const ext = hw + 3 * sig + 2;
        const cx = map.ox + (rx + nxx * yy) * k;
        const cy = map.oy + (ry + nyy * yy) * k;
        for (const sgn of [-1, 1]) {
          const b = n * STRIDE;
          wireData[b] = cx + nxx * ext * sgn;
          wireData[b + 1] = cy + nyy * ext * sgn;
          wireData[b + 2] = ext * sgn;
          wireData[b + 3] = hw;
          wireData[b + 4] = sig;
          wireData[b + 5] = o;
          wireData[b + 6] = r;
          wireData[b + 7] = rx + (nxx * ext * sgn) / k;
          wireData[b + 8] = ry + (nyy * ext * sgn) / k;
          n++;
        }
      }
      gl.useProgram(wireP.p);
      gl.uniform2f(wireP.u.uRes, W, H);
      gl.uniform3fv(wireP.u.uShade, w.shade);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.uniform1i(wireP.u.uAtlas, 0);
      gl.uniform2f(wireP.u.uAtlasSize, meta.atlas[0], meta.atlas[1]);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, keyTex);
      gl.uniform1i(wireP.u.uKey, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform2f(wireP.u.uImg, IW, IH);
      setGrade(wireP);
      const rd = w.def.riders[0];
      if (rd) {
        gl.uniform4f(wireP.u.uRiderBox, rd.box[0], rd.box[1], rd.box[2], rd.box[3]);
        gl.uniform2f(wireP.u.uRiderAt, rd.atlas[0], rd.atlas[1]);
      } else gl.uniform4f(wireP.u.uRiderBox, 0, 0, 0, 0);
      gl.bindVertexArray(wireVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, wireBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, wireData, 0, n * STRIDE);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, n);

      // Insulators that ride the wire move with it.
      for (const r of w.def.riders) {
        const jc = r.sc / w.ds;
        const yy = sampleY(w, jc) * w.lead(r.sc);
        const [, , rnx, rny] = w.rest(r.sc);
        const dx = rnx * yy;
        const dy = rny * yy;
        const [x0, y0, x1, y1] = r.box;
        const [ax, ay, aw, ah] = r.atlas;
        const corners = [
          [x0, y0, ax, ay],
          [x1, y0, ax + aw, ay],
          [x0, y1, ax, ay + ah],
          [x1, y1, ax + aw, ay + ah],
        ];
        const order = [0, 1, 2, 2, 1, 3];
        order.forEach((ci, m) => {
          const c = corners[ci];
          riderData[m * 4] = map.ox + (c[0] + dx) * k;
          riderData[m * 4 + 1] = map.oy + (c[1] + dy) * k;
          riderData[m * 4 + 2] = c[2] / meta.atlas[0];
          riderData[m * 4 + 3] = c[3] / meta.atlas[1];
        });
        gl.useProgram(riderP.p);
        gl.uniform2f(riderP.u.uRes, W, H);
        gl.uniform1i(riderP.u.uAtlas, 0);
        gl.bindVertexArray(riderVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, riderBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, riderData);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  };

  let born = performance.now();
  let acc = 0;
  let lastGrain = -1;
  const frame = (dt, t) => {
    const age = (performance.now() - born) / 1000;
    if (!still) {
      // Breeze comes up once the frame has settled.
      wind = reduced ? 0 : damp(wind, age > 1.6 ? 1 : 0, 0.7, dt);
      acc += dt;
      while (acc >= STEP) {
        step(STEP);
        acc -= STEP;
      }
    }
    // Cursor: a grab hand only over a live wire.
    const p = stage.pointer;
    if (p.inside && !p.down) {
      const [x, y] = toImage(p.x, p.y);
      let near = null;
      for (const w of wires) {
        const hit = locate(w, x, y);
        if (hit && hit.dist < catchRadius() * 1.4 && hit.j > Math.max(0.6, w.jGrip) && hit.j < w.jExit - 0.3) near = w;
      }
      if (near !== hoverWire) {
        hoverWire = near;
        stage.canvas.style.cursor = near ? "grab" : "";
      }
    } else if (p.down) {
      const any = wires.some((w) => w.caught);
      const cur = any ? "grabbing" : "";
      if (stage.canvas.style.cursor !== cur) stage.canvas.style.cursor = cur;
    }

    const expT = still || reduced ? 1 : expoOut(clamp(age / 2.1, 0, 1));
    const exposure = film0.exposure + 2.5 * (1 - expT);
    let key = `${exposure.toFixed(4)}`;
    for (const w of wires) key += `|${w.y[Math.round(w.N / 3)].toFixed(3)}|${w.y[Math.round(w.N / 2)].toFixed(3)}`;
    const tick = still ? 0 : Math.floor(t * 24);
    if (key !== lastKey || tick !== lastGrain) {
      drawScene();
      film.render(sceneTex, { ...film0, exposure, grainSeed: tick * 7.31 });
      lastKey = key;
      lastGrain = tick;
    }
  };
  stage.onFrame(frame);

  await new Promise((r) => requestAnimationFrame(() => r()));
  if (stage.canvas.width > 1) {
    if (!sceneTex) build();
    frame(1 / 60, performance.now() / 1000);
  }
  born = performance.now();
  void embedded;

  return {
    destroy() {
      sound.destroy();
      film.destroy();
      if (sceneTex) gl.deleteTexture(sceneTex);
      if (sceneFbo) gl.deleteFramebuffer(sceneFbo);
      gl.deleteTexture(plateTex);
      gl.deleteTexture(atlasTex);
      gl.deleteTexture(keyTex);
      for (const b of [quad, wireBuf, riderBuf]) gl.deleteBuffer(b);
      for (const v of [quadVao, wireVao, riderVao]) gl.deleteVertexArray(v);
      for (const pr of [plateP, wireP, riderP]) gl.deleteProgram(pr.p);
      stage.destroy();
    },
  };
}
