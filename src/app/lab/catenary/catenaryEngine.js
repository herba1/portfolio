import { createStage, clamp, damp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";
import { createPluckSound } from "./pluck";
import { NODES, createWorld, drawnY, locate, offsetAt, pitchView, pullShape, sampleY } from "./strings";

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
// is a fingertip pad, not a point: a pull is two straight legs and a small
// rounded crown, the shape of a taut wire pushed aside, never a V. The
// wires are drawn analytically (erf of a blurred box, the measured shade) in
// linear light at device resolution, along the fitted catenary evaluated
// exactly plus a cubic through the nodes' displacement, then the frame is
// haloed through the shared film kit (summer) and printed (PRINT_CURVE).
//
// Query: ?still=1 (no breeze), ?pluck=<wire 0-5>&t=<seconds after release>
// [&at=<0..1 along the visible run>&amp=<0..1.5>, 1.5 the fullest give of a
// taut wire], ?pull=<wire> holds the pull.
// ?pitch=<degrees> turns the camera (default PITCH; 0 is the photograph).
// Any numeric FILM key (exposure, whitePoint, ...), struct, structGain,
// structFloor, cloudLift, cloudFrom, sculpt, shadeTint, hal, halNarrow, halWide,
// diffuse, diffuseR, diffuseSteel, zenith, polar, polarSat, polarHue, vib, vibFloor, vibHue, vibV
// override the grade; halThr sets the HALO pass's threshold; print and
// printPin the PRINT curve.

const ASSET = "/lab/catenary/";
const WIDTH_TRIM = 0.6; // image px
// The view: a worm's-eye. The photograph looks up at about 30 degrees (its
// verticals meet some 7000 px above its centre); the virtual camera turns
// PITCH further up about its own centre (pitchView in strings.js: a pure
// rotation, so the homography H = K R K^-1 is exact without depth). The mast
// and the far pole then converge hard on a vanishing point just above the
// frame, the scene drops, and the droppers, hooks and caged platform low in
// the photograph fall out of the bottom. Everything drawn goes through the
// same H: the plate (per pixel, in PLATE), the wires (each sample of the
// fitted catenary plus its displacement, the profile across the projected
// tangent), the insulators (their corners, perspective-correct). The strings
// themselves stay in the photograph's plane: physics in image px.
// The crop sits inside the turned photograph (a trapezoid, narrow at the
// top), VIEW.zoom past cover on a 16:10 box, its top edge at the
// photograph's row VIEW.top and the mast top at poleAt of the width; it
// zooms further only if a corner would leave the plate. A box narrower than
// 16:10 keeps the crop's width down to its height (4:3 shows more sky below,
// not less mast); a portrait box covers at its height.
const PITCH = 18; // degrees
const VIEW = {
  zoom: 1.45, // past cover, on a 16:10 box
  top: 120, // the crop's top edge, a row of the photograph
  mast: [1915, 360], // the mast top, image px
  poleAt: 0.11, // the furthest left it may sit, as a share of the width
  inset: 4, // image px kept clear of the plate's edge
};


const FILM = {
  ...FILM_PRESETS.summer,
  exposure: 0,
  input: "linear",
  // A plate that is already a soft film scan: less extra veil. The sunlit
  // cloud is developed up to just under white (about 0.96, nothing at 255);
  // the print (PRINT_CURVE) then lays it down on ref 3's density, ~225.
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
  // where the steel and the wires cross bright cloud. (The piece's own,
  // thin halation pass, HALO, has its own threshold: HAL_THRESHOLD.)
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
//  - Cloud: modelled at low frequency, never per pixel (a per-pixel knee
//    steepened every edge into a hard rim). An S-curve over the cloud's own
//    range, driven by the blurred plate: the lit masses take CLOUD_LIFT of
//    the headroom left and draw toward warm-neutral paper (CLOUD_TOP,
//    #f2eee6), bending toward white and never reaching it; the shade masses
//    sink toward the blue of skylight (CLOUD_SHADE, #9db6cf). Each mass is
//    also read for which side faces the sun (SUN): its sun-facing flank is
//    lit and warmed with the cores, its far side and base sink to skylight,
//    so a cumulus has a sunlit top and a blue underside, not one grey value.
//  - Diffusion: the cloud light, bloomed wide (see DIFFUSE), screened in,
//    veils the cobalt round the cloud and bleeds softly over the steel. Halation is not in the plate: it is a pass of
//    its own over the finished scene (see HALO), so the steel, the live wires
//    and the insulators all bleed the same way.
const STRUCT = 0.88;
// Dark: the one silhouette has to stand off the cloud, about rgb(62,66,70)
// on its lit face after the print, its rust and banding still in it.
const STRUCT_GAIN = 0.45;
const STRUCT_FLOOR = 0.006;
const STRUCT_TINT = [1.06, 1, 0.9]; // linear, luminance-normalised
const CLOUD_TOP = [0xf2, 0xee, 0xe6];
// The print bleaches colour on its shoulder (saturation eases off toward
// white), so the plate aims this much warmer (linear) to land on CLOUD_TOP.
const CLOUD_AIM = [1.04, 1, 0.9];
const CLOUD_LIFT = 0.56;
// The cloud's modelling (see PLATE): where its range starts (blurred luma,
// gamma), how far the S-curve goes (0 straight, 1 the doubled smoothstep),
// and how far the shade masses draw toward CLOUD_SHADE, the blue-grey of a
// cumulus underside lit only by the sky.
const CLOUD_FROM = 0.6;
const SCULPT = 0.6;
const SHADE_TINT = 0.6;
const CLOUD_SHADE = [0x9d, 0xb6, 0xcf];
// Toward the sun, degrees in the photograph (0 right, 90 up): upper left,
// where the cumulus tops are brightest as shot.
const SUN = 125;
// Diffusion, a Pro-Mist bloom: the sunlit cloud light spread wide and
// screened in at DIFFUSE. The baked wide key (B, sigma ~1.4% of the width)
// is the bloom's core; two rings of it, DIFFUSE_RADIUS (fractions of the
// image width) out, are its long tail, so the cloud's light veils the cobalt
// a cloud's width round it and slips softly over the steel's edges. The
// steel takes DIFFUSE_STEEL of it: enough that the bloom overlaps a member
// beside the cloud, not so much that the one silhouette goes grey.
const DIFFUSE = 0.45;
const DIFFUSE_RADIUS = 1.3; // scale on the rings (0.022, 0.05 of the width)
const DIFFUSE_STEEL = 0.28;
// The cloud's edge (see PLATE): the warm tint is keyed tight on the modelled
// cloud light (gamma, WARM_KEY from-to), so only the sunlit cores warm; below
// the key, EDGE_BLUE of each fringe pixel's shortfall in blue is made up
// toward the local sky lifted to skylight. RELIEF is the gain of the wide
// unsharp mask that gives the cumulus back its lobes.
const WARM_KEY = [0.8, 0.93];
const EDGE_BLUE = 0.4;
const RELIEF = 0.2;
// Halation, the film's own optics rather than its grade: light that went
// through the emulsion, bounced off the base (no remjet) and came back
// through the red layer a little way off. Over the finished linear scene,
// plate, live wires and insulators together: the light past HAL_THRESHOLD
// (scene luminance, a soft knee) is blurred at two radii, HAL_NARROW and HAL_WIDE (gaussian sigma in device px at DPR 2,
// scaled with the DPR), weighted, tinted HAL_TINT and added at HAL, in
// proportion to how dark the pixel it lands on is (1 - its luma). So it
// shows where sunlit cloud meets dark steel: a 1-3 px warm orange-red fringe
// on the steel's side of the edge and a faint warm bleed into it, nothing on
// steel against plain sky (the sky never reaches the threshold), and almost
// nothing on the cloud itself. The wide radius stays low so it never reads
// as a glow or a chroma smear.
const HAL = 3.4;
// Measured on the scene: the open sky never passes 0.3, even beside cloud;
// the cumulus behind the truss sits at 0.38-0.55 and only its cores reach
// the film's own halationThreshold (0.6), the sunlit masses upper right and
// lower left 0.55-0.85. So the pass starts lower than the film's wide halo,
// low enough that the truss's cloud throws a fringe, with the sky still a
// full 0.07 below the knee.
const HAL_THRESHOLD = 0.42;
const HAL_TINT = [1, 0.5, 0.26]; // linear
const HAL_CAP = 0.62;
// The narrow radius carries the fringe; the wide one only a breath of warmth
// into the steel, so a 16 px feeder over the brightest cloud is lifted a few
// levels, not turned into a lit tube.
const HAL_NARROW = [1.8, 1]; // sigma (device px at DPR 2), weight
const HAL_WIDE = [12, 0.03];
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

// The print: the film kit develops the negative; this is the paper it is
// printed on, a last pass over the finished frame (see PRINT_F). One curve on
// the frame's luma (Rec. 709 weights on the display values, the way a
// densitometer reads a print), monotone cubic through PRINT_CURVE (film in,
// print out, 0-255), pinned at PRINT_PIN (the cobalt's own luma, ~100) so
// the sky keeps its mean and hue. Measured against herb ref 3:
//  - Shoulder: the sunlit cloud tops land at about #dfe1de-#e3e4e0 (top 1%
//    ~225), not hot cream near paper white. A long shoulder from just over
//    the sky: the light sky stays near slope 1, the cloud bodies give, and
//    the cores (film 205-242) take a slope a little over 1, so the lobes and
//    grain the plate's veil had flattened into a cream plateau come back;
//    only the last dozen levels roll hard, and nothing reaches 255. Above
//    the pin each pixel is scaled by the curve's ratio (hue and saturation
//    kept), and its colour eased toward the paper's neutral, PRINT_WB, from
//    PRINT_NEUTRAL[0] to [1] of print luma: the warm-cream cores come out
//    neutral-cool.
//  - Toe: a scan's lifted black, not a crushed one. Below the pin the lift
//    is added, tinted PRINT_TOE (slightly cyan, luma 1), so the darkest steel
//    sits near rgb(40,48,56) and p5 near 60: the mast a soft silhouette, its
//    rust and banding still in it. The cobalt is as dark as the steel's
//    lit faces but far more saturated (S 0.8-0.9 against the steel's ~0.4), so
//    the lift eases out over PRINT_TOE_SAT (saturation): the zenith keeps
//    its polariser depth instead of greying toward the toe.
// ?print=x:y,x:y,... overrides the curve.
const PRINT_CURVE = [
  [0, 22],
  [28, 50],
  [38, 61],
  [55, 72],
  [70, 81],
  [85, 91],
  [100, 100],
  [120, 119],
  [150, 142],
  [180, 162],
  [205, 182],
  [225, 204],
  [242, 225],
  [250, 230],
  [255, 233],
];
const PRINT_PIN = 100;
const PRINT_TOE = [0.94, 1, 1.06];
const PRINT_TOE_SAT = [0.6, 0.8];
// Warm cream (245,241,231 as the film leaves it) to the paper's neutral
// (#dfe1de), luminance-normalised.
const PRINT_WB = [0.98, 1.003, 1.028];
const PRINT_NEUTRAL = [185, 222];

// Structure toward graphite: luminance kept, lifted out of the black, a
// slight warm bias. Shared by the plate and the live wires.
const GRAPHITE = `const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 graphite(vec3 c) {
  float y = dot(c, LUMA);
  return (y * uStruct.y + uStruct.z) * uStructTint / dot(uStructTint, LUMA);
}`;

// The bloom's spread (see DIFFUSE): the wide key at the pixel, then two
// rings of it further out. Sampled at the resting image position, so the
// plate and the live wires take the same veil.
const MIST = `uniform vec3 uMist;   // ring radius scale, steel share, unused
float mist(sampler2D k, vec2 uv) {
  vec2 r = vec2(1.0, float(textureSize(k, 0).x) / float(textureSize(k, 0).y)) * uMist.x;
  float m1 = 0.0, m2 = 0.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5235988;
    m1 += texture(k, uv + vec2(cos(a), sin(a)) * r * 0.022).b;
  }
  for (int i = 0; i < 16; i++) {
    float a = float(i) * 0.3926991 + 0.19635;
    m2 += texture(k, uv + vec2(cos(a), sin(a)) * r * 0.05).b;
  }
  return 0.3 * texture(k, uv).b + 0.4 * m1 / 12.0 + 0.3 * m2 / 16.0;
}`;

const VERT_FULL = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const PLATE = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uPlate;
uniform vec2 uRes;   // device px
uniform vec3 uMap;   // ox, oy, k (device px per view px)
uniform mat3 uHom;   // view px -> image px: the turned camera
uniform vec2 uImg;   // image px
uniform sampler2D uKey; // R structure, G cloud light thin, B cloud light wide
uniform vec4 uStruct;  // amount, gain, floor, zenith
uniform vec3 uStructTint;
uniform vec3 uCloudTop; // linear
uniform vec2 uGlow;     // cloud lift, diffusion
uniform vec3 uSculpt;   // cloud range floor (gamma), S-curve amount, shade tint
uniform vec3 uCloudShade; // linear
uniform vec2 uSun;     // toward the sun, image px direction (unit)
uniform vec3 uPolar;   // value loss at the top, saturation gain, hue (0..1)
uniform vec4 uVib;     // amount, saturation floor, hue (0..1), value loss
uniform vec4 uEdge;    // warm key from, to (gamma); relief gain; skylight edge amount
${MIST}
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
  vec3 hq = uHom * vec3((p - uMap.xy) / uMap.z, 1.0);
  vec2 uv = hq.xy / hq.z / uImg;
  vec3 c = texture(uPlate, uv).rgb;
  vec3 key = texture(uKey, uv).rgb;

  // Polariser. The mask reads the plate a mip up (about 2 image px, under a
  // device px here) so the film grain in thin cloud does not speckle it.
  vec3 g = pow(c, vec3(1.0 / 2.2));
  // The saturation gate is wide (S 0.08 to 0.44, about linear between): a
  // cloud's fringe is cloud and sky mixed, so it takes the grade in
  // proportion. A narrow gate (it was 0.26-0.38) graded the whole fringe as
  // sky and let go of it all at once a few px further in, a darkened,
  // over-saturated cobalt ring hard against every cumulus: the HDR rim.
  vec3 hm = rgb2hsv(pow(texture(uPlate, uv, 1.5).rgb, vec3(1.0 / 2.2)));
  float hue = hm.x * 360.0;
  float sky = smoothstep(0.08, 0.44, hm.y) * smoothstep(188.0, 198.0, hue) * (1.0 - smoothstep(218.0, 228.0, hue))
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

  // Cloud modelling, low frequency. The light is read off the plate a long
  // way down its mips (about 25 plate px of blur), so the curve shapes the
  // cloud's masses, not its edges or grain: each pixel takes the ratio the
  // blurred light earns, its own detail riding on it unchanged. Over the
  // cloud's own range (blurred luma, gamma, CLOUD_FROM to 0.94) a doubled
  // smoothstep: the shade masses sink toward blue-grey skylight, the sunlit
  // masses take CLOUD_LIFT of the headroom left toward warm-neutral paper
  // (CLOUD_TOP). At the fringe the blurred light is a sky-and-cloud mix
  // below the range, so the curve is identity there: no step, no rim.
  vec2 ts = vec2(24.0) / vec2(textureSize(uPlate, 0));
  vec3 lo = vec3(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      float wt = (i == 0 ? 2.0 : 1.0) * (j == 0 ? 2.0 : 1.0);
      lo += wt * textureLod(uPlate, uv + vec2(float(i), float(j)) * ts, 4.5).rgb;
    }
  }
  lo /= 16.0;
  float yl = dot(lo, LUMA);
  float ylg = pow(yl, 1.0 / 2.2);
  float lmx = max(lo.r, max(lo.g, lo.b));
  float lch = (lmx - min(lo.r, min(lo.g, lo.b))) / max(lmx, 1e-4);
  float mass = (1.0 - smoothstep(0.32, 0.55, lch)) * (1.0 - key.r);
  float s = clamp((ylg - uSculpt.x) / (0.94 - uSculpt.x), 0.0, 1.0);
  float s1 = s * s * (3.0 - 2.0 * s);
  float s2 = s1 * s1 * (3.0 - 2.0 * s1);
  // Which side of the mass faces the sun: the same blurred light, read a
  // cloud's width toward the sun and away from it. On the sun-facing side
  // the cloud lies behind the pixel (away) and open sky ahead (toward), so
  // the difference is positive there and negative on the shadowed base.
  // Low frequency like the rest: it shapes masses, never draws a rim.
  vec2 sd = uSun * ts * 2.5;
  float yAhead = pow(dot(textureLod(uPlate, uv + sd, 5.0).rgb, LUMA), 1.0 / 2.2);
  float yBehind = pow(dot(textureLod(uPlate, uv - sd, 5.0).rgb, LUMA), 1.0 / 2.2);
  float side = clamp((yBehind - yAhead) * 5.0, -1.0, 1.0);
  float body = mass * smoothstep(0.0, 0.3, s);
  float facing = body * smoothstep(0.0, 0.6, side);
  float away = body * smoothstep(0.0, 0.6, -side);
  // Sunlit: the bright cores, and the sun-facing flank of every mass.
  float lit = clamp(mass * s2 + facing * (0.2 + 0.8 * s1), 0.0, 1.0);
  // Shade: in from the fringe (it starts at s ~0.12), deepest mid-range,
  // and deepest of all on the side turned from the sun.
  float shade = clamp(mass * smoothstep(0.0, 0.25, s) * (1.0 - s2) * (0.6 + 0.8 * away) * (1.0 - 0.7 * facing), 0.0, 1.0);
  float yc = uSculpt.x + (0.94 - uSculpt.x) * mix(s, s2, uSculpt.y);
  yc += (1.0 - yc) * uGlow.x * lit;
  yc -= (yc - uSculpt.x) * 0.16 * uSculpt.y * away * (1.0 - s2);
  yc = mix(ylg, yc, mass * step(uSculpt.x, ylg));
  float ratio = pow(yc / max(ylg, 1e-4), 2.2);

  // Relief: the lobes of the cumulus, put back. A wide unsharp mask (about
  // 30 plate px) on the cloud's own light, at low gain and in gamma, so each
  // cauliflower lobe stands off its neighbour the way the diffusion and the
  // zoom had flattened it. The fine end is read a mip up, so it lifts the
  // lobes, not the grain. Cloud only: the open sky and the steel take none,
  // so no dark ring is drawn around a cloud.
  float yF = pow(dot(textureLod(uPlate, uv, 1.0).rgb, LUMA), 1.0 / 2.2);
  vec2 tr = vec2(12.0) / vec2(textureSize(uPlate, 0));
  float yB = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      float wt = (i == 0 ? 2.0 : 1.0) * (j == 0 ? 2.0 : 1.0);
      yB += wt * dot(textureLod(uPlate, uv + vec2(float(i), float(j)) * tr, 3.5).rgb, LUMA);
    }
  }
  yB = pow(yB / 16.0, 1.0 / 2.2);
  float cloudM = mass * smoothstep(0.05, 0.35, s);
  float dg = clamp(yF - yB, -0.12, 0.12) * uEdge.z * cloudM;
  float yFr = yF * pow(ratio, 1.0 / 2.2);
  // The lobes rise into the cores only as far as the shoulder allows: no
  // lifted pixel is pushed past the print's paper white.
  dg *= dg > 0.0 ? 1.0 - smoothstep(0.86, 0.97, yFr) : 1.0;
  ratio *= pow(clamp((yFr + dg) / max(yFr, 1e-3), 0.6, 1.25), 2.2);

  float y = dot(c, LUMA);
  float yt = y * ratio;
  c *= ratio;
  // The warm key: only the sunlit cores warm. Keyed tight on the modelled
  // cloud light a mip up (gamma, uEdge.xy, about 0.80-0.93): a fringe pixel
  // is cloud and cobalt mixed, and warm paper mixed into blue is khaki-grey.
  float yk = pow(clamp(dot(textureLod(uPlate, uv, 1.5).rgb, LUMA) * ratio, 0.0, 1.0), 1.0 / 2.2);
  float core = smoothstep(uEdge.x, uEdge.y, yk);
  c = mix(c, uCloudTop * (yt / dot(uCloudTop, LUMA)), lit * core);
  c = mix(c, uCloudShade * (yt / dot(uCloudShade, LUMA)), uSculpt.z * shade);

  // Below the key the edge goes blue, not grey. The local sky is read on a
  // ring a cloud's lobe out (about 50 plate px), weighted to its most
  // saturated, darkest reading, and lifted by the vibrance floor the open sky
  // gets. Each fringe pixel's chroma is drawn toward a target that runs from
  // that sky (at the sky's own light) to skylight blue (CLOUD_SHADE, at the
  // key) and on to neutral in the core: white, pale blue, cobalt, never
  // grey. Only the chroma moves (luminance kept), and only as far as the
  // pixel is short of the target's blue: a pixel already that blue is left.
  vec3 skyA = vec3(0.0);
  float skyW = 1e-4;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.7853982;
    vec2 o = vec2(cos(a), sin(a)) * vec2(52.0) / vec2(textureSize(uPlate, 0));
    vec3 q = rgb2hsv(pow(textureLod(uPlate, uv + o, 4.0).rgb, vec3(1.0 / 2.2)));
    float wq = pow(q.y, 4.0) * smoothstep(0.25, 0.4, q.z) + 1e-5;
    vec2 hv = vec2(cos(q.x * 6.2831853), sin(q.x * 6.2831853));
    skyA += wq * vec3(hv * q.y, q.z);
    skyW += wq;
  }
  skyA /= skyW;
  float skyS = length(skyA.xy);
  float skyH = fract(atan(skyA.y, skyA.x) / 6.2831853 + 1.0);
  float hueOk = smoothstep(170.0, 190.0, skyH * 360.0) * (1.0 - smoothstep(235.0, 250.0, skyH * 360.0));
  skyH = mix(uVib.z, skyH, hueOk);
  vec3 sl = rgb2hsv(pow(uCloudShade, vec3(1.0 / 2.2)));
  // The floor is skylight's own pale chroma, a little deeper toward the
  // sky's light, and never more than the local sky has: the target is the
  // sky seen through thin cloud, not the sky itself, so the cloud's shaded
  // body goes pale blue and the open cobalt (already bluer) is left alone.
  float t = smoothstep(min(skyA.z, uEdge.x - 0.15), uEdge.x, yk);
  float dhs = fract(sl.x - skyH + 0.5) - 0.5;
  float tS = min(mix(sl.y * 1.5, sl.y * 1.25, t), max(skyS, sl.y));
  vec3 tgt = pow(hsv2rgb(vec3(fract(skyH + dhs * (0.5 + 0.5 * t)), tS * (1.0 - core * core), 1.0)), vec3(2.2));
  vec3 tc = tgt * (yt / dot(tgt, LUMA)) - yt;
  vec3 cc = c - dot(c, LUMA);
  float tl = length(tc);
  float need = clamp(1.0 - dot(cc, tc) / max(tl * tl, 1e-6), 0.0, 1.0);
  float steel = 1.0 - key.r;
  float eAmt = uEdge.w * steel * steel * (1.0 - core) * smoothstep(0.3, 0.45, yk) * smoothstep(0.0, 0.3, need);
  c = max(dot(c, LUMA) + mix(cc, tc, eAmt), 0.0);

  // Wide diffusion: screened, so it lifts the cobalt and never clips. The
  // steel takes only its share (uMist.y): the bloom slips over a member's
  // edge beside the cloud, but the mast stays graphite where it crosses lit
  // cloud, one silhouette against the soft cloud light. (Halation is its own
  // pass, over the whole scene: HALO.)
  // The steel's mask is eased in over its first few px (the least of it and
  // its ring a few key px out), so at a member's edge the bloom fades over
  // the steel instead of stopping on a line.
  float rIn = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.7853982;
    rIn += texture(uKey, uv + vec2(cos(a), sin(a)) * vec2(5.0) / vec2(textureSize(uKey, 0))).r;
  }
  float bare = 1.0 - (1.0 - uMist.y) * min(key.r, rIn / 8.0);
  // Its colour follows the same key: warm paper off the sunlit cores,
  // skylight over the cobalt, so the veil never greys the blue it lifts.
  vec3 skyl = uCloudShade * (dot(uCloudTop, LUMA) / dot(uCloudShade, LUMA));
  vec3 veil = mix(skyl, uCloudTop, core) * mist(uKey, uv) * uGlow.y * bare;
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
uniform vec2 uGlow;
${GRAPHITE}
${MIST}
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
  // The same graphite as the steel. A live wire is steel too, but it was
  // painted out of the plate, so the key's steel mask (key.r) never reaches
  // it: hold it at the steel's residue directly. The cloud's veil then barely
  // touches the wire body (it stays a dark silhouette across lit cumulus);
  // its halation comes from the HALO pass over the finished scene, exactly
  // as the plate's steel takes it, wherever the wire has moved to.
  col = mix(col, graphite(col), uStruct.x);
  vec2 kuv = vRest / uImg;
  col = 1.0 - (1.0 - col) * (1.0 - uCloudTop * mist(uKey, kuv) * uGlow.y * uMist.y);
  outColor = vec4(col, a);
}`;

// The sprite's corners go through the homography; w is its divisor, so the
// atlas is interpolated perspective-correct, linear in the photograph.
const RIDER_V = `#version 300 es
layout(location = 0) in vec3 aPos;    // device px, homogeneous w
layout(location = 1) in vec2 aUv;     // atlas uv
uniform vec2 uRes;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos.x / uRes.x * 2.0 - 1.0, 1.0 - aPos.y / uRes.y * 2.0, 0.0, 1.0) * aPos.z;
}`;

const RIDER_F = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uAtlas;
void main() { outColor = texture(uAtlas, vUv); }`;

// HALO, 1: the light that reaches the base. The scene luminance (linear) of
// whatever is past the threshold, all of it, not just the excess (a cloud at
// 0.5 throws a halo in proportion to 0.5), gated with a soft knee so the halo
// grows in without a step, and held under HAL_CAP: the red layer saturates,
// so the sunlit masses (0.85) bleed only a little more than the cumulus
// behind the truss (0.5) and a wire crossing them keeps its silhouette. One
// channel, the red layer's exposure.
const HALO_SRC = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uScene;
uniform vec2 uThr;   // threshold, cap
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
void main() {
  float y = dot(max(texelFetch(uScene, ivec2(gl_FragCoord.xy), 0).rgb, 0.0), LUMA);
  outColor = vec4(min(y, uThr.y) * smoothstep(uThr.x - 0.05, uThr.x + 0.1, y), 0.0, 0.0, 1.0);
}`;

// Gaussian at two radii, separable. Narrow: a tap per px out to 3 sigma.
// Wide: pairs of px in one bilinear tap, weighted so the pair is exact.
const HALO_BLUR = `
uniform vec2 uSig;   // narrow, wide sigma, device px
uniform vec2 uStep;  // one px along the blur, uv
float gw(float i, float s) { return exp(-0.5 * i * i / (s * s)); }
vec2 blur(sampler2D t, vec2 uv, bool second) {
  float n = 0.0, nw = 0.0, m = 0.0, mw = 0.0;
  int rn = int(ceil(3.0 * uSig.x));
  for (int i = -rn; i <= rn; i++) {
    float w = gw(float(i), uSig.x);
    n += w * texture(t, uv + uStep * float(i)).r;
    nw += w;
  }
  int rw = int(ceil(3.0 * uSig.y));
  for (int i = -rw; i <= rw; i += 2) {
    float a = gw(float(i), uSig.y);
    float b = gw(float(i + 1), uSig.y);
    vec4 s = texture(t, uv + uStep * (float(i) + b / (a + b)));
    m += (a + b) * (second ? s.g : s.r);
    mw += a + b;
  }
  return vec2(n / nw, m / mw);
}`;

// 2: across. R narrow, G wide.
const HALO_H = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uSrc;
${HALO_BLUR}
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uSrc, 0));
  outColor = vec4(blur(uSrc, uv, false), 0.0, 1.0);
}`;

// 3: down, and onto the scene: tinted, weighted, and laid on in proportion
// to how dark the pixel is, so it shows on the dark side of a bright edge.
const HALO_C = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uScene;
uniform sampler2D uSrc;
uniform vec3 uHal;   // gain, narrow weight, wide weight
uniform vec3 uHalTint;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
${HALO_BLUR}
void main() {
  vec3 c = texelFetch(uScene, ivec2(gl_FragCoord.xy), 0).rgb;
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uSrc, 0));
  vec2 h = blur(uSrc, uv, true);
  // Laid on by how dark the pixel is (1 - luma, eased to nothing by 0.5):
  // dark steel beside the cloud (y ~0.03) takes all of it, the sky past a
  // cloud's edge (y ~0.25) half, the cloud itself (y 0.4 and up) next to
  // none, so it never warms the highlight it came from.
  float halo = uHal.x * (uHal.y * h.x + uHal.z * h.y);
  float y = clamp(dot(max(c, 0.0), LUMA), 0.0, 1.0);
  c += uHalTint * halo * (1.0 - smoothstep(0.0, 0.5, y));
  outColor = vec4(c, 1.0);
}`;

// PRINT: the paper. Film luma through the curve (a 1024-entry table, read
// with texelFetch and interpolated, so a float table needs no filtering).
const PRINT_F = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uFilm;
uniform sampler2D uLut;
uniform vec3 uToeTint;
uniform vec3 uWb;
uniform vec3 uPrint;   // pin, neutral from, to (0..1)
uniform vec2 uToeSat;  // the toe's lift eases out over this saturation
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
float paper(float y) {
  float x = clamp(y, 0.0, 1.0) * 1023.0;
  int i = int(floor(x));
  float a = texelFetch(uLut, ivec2(i, 0), 0).r;
  float b = texelFetch(uLut, ivec2(min(i + 1, 1023), 0), 0).r;
  return mix(a, b, x - float(i));
}
void main() {
  vec3 c = texelFetch(uFilm, ivec2(gl_FragCoord.xy), 0).rgb;
  float y = dot(c, LUMA);
  float t = paper(y);
  // Toe: the lift added, tinted, on the steel, not the cobalt. Shoulder: the
  // ratio, so colour holds.
  float mx = max(c.r, max(c.g, c.b));
  float sat = (mx - min(c.r, min(c.g, c.b))) / max(mx, 1e-4);
  float lift = (t - y) * (1.0 - smoothstep(uToeSat.x, uToeSat.y, sat));
  c = y < uPrint.x ? c + lift * uToeTint : c * (t / max(y, 1e-4));
  c *= mix(vec3(1.0), uWb, smoothstep(uPrint.y, uPrint.z, t));
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// Monotone cubic (Fritsch-Carlson) through [x, y] points, sampled n times
// over 0..255, out 0..1.
function printTable(pts, n) {
  const k = pts.length;
  const d = [];
  for (let i = 0; i < k - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
  const m = pts.map((_, i) => (i === 0 ? d[0] : i === k - 1 ? d[k - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < k - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      m[i] = (3 * a * d[i]) / Math.sqrt(h);
      m[i + 1] = (3 * b * d[i]) / Math.sqrt(h);
    }
  }
  const out = new Float32Array(n);
  let j = 0;
  for (let s = 0; s < n; s++) {
    const x = (s / (n - 1)) * 255;
    while (j < k - 2 && x > pts[j + 1][0]) j++;
    const [x0, y0] = pts[j];
    const [x1, y1] = pts[j + 1];
    const h = x1 - x0;
    const t = clamp((x - x0) / h, 0, 1);
    const t2 = t * t;
    const t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m[j] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m[j + 1];
    out[s] = y / 255;
  }
  return out;
}

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
  const glow = [clamp(num("cloudLift", CLOUD_LIFT), 0, 1), clamp(num("diffuse", DIFFUSE), 0, 1)];
  const mistU = [clamp(num("diffuseR", DIFFUSE_RADIUS), 0, 3), clamp(num("diffuseSteel", DIFFUSE_STEEL), 0, 1), 0];
  const halo = [
    clamp(num("hal", HAL), 0, 4),
    clamp(num("halNarrow", HAL_NARROW[1]), 0, 2),
    clamp(num("halWide", HAL_WIDE[1]), 0, 2),
  ];
  const halThr = clamp(num("halThr", HAL_THRESHOLD), 0.05, 4);
  const sculpt = [clamp(num("cloudFrom", CLOUD_FROM), 0.3, 0.9), clamp(num("sculpt", SCULPT), 0, 1), clamp(num("shadeTint", SHADE_TINT), 0, 1)];
  const cloudShade = CLOUD_SHADE.map((v) => toLin(v / 255));
  const sunA = (num("sun", SUN) * Math.PI) / 180;
  const sun = [Math.cos(sunA), -Math.sin(sunA)];
  const edge = [
    clamp(num("warmFrom", WARM_KEY[0]), 0, 1),
    clamp(num("warmTo", WARM_KEY[1]), 0, 1),
    clamp(num("relief", RELIEF), 0, 3),
    clamp(num("edgeBlue", EDGE_BLUE), 0, 1),
  ];
  const polar = clamp(num("polar", POLAR), 0, 0.6);
  const polarSat = num("polarSat", POLAR_SAT);
  const polarHue = num("polarHue", POLAR_HUE);
  const vib = [
    clamp(num("vib", VIB), 0, 1),
    clamp(num("vibFloor", VIB_FLOOR), 0, 1),
    num("vibHue", VIB_HUE) / 360,
    clamp(num("vibV", VIB_V), 0, 0.5),
  ];
  const printQ = (q.get("print") || "")
    .split(",")
    .map((v) => v.split(":").map(Number))
    .filter((v) => v.length === 2 && v.every(Number.isFinite))
    .sort((a, b) => a[0] - b[0]);
  const printLut = printTable(printQ.length > 1 ? printQ : PRINT_CURVE, 1024);
  const printU = [num("printPin", PRINT_PIN) / 255, PRINT_NEUTRAL[0] / 255, PRINT_NEUTRAL[1] / 255];
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
  const view = pitchView(IW, IH, clamp(num("pitch", PITCH), -10, 30));
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
  const haloSrcP = compile(gl, VERT_FULL, HALO_SRC);
  const haloHP = compile(gl, VERT_FULL, HALO_H);
  const haloCP = compile(gl, VERT_FULL, HALO_C);
  const printP = compile(gl, VERT_FULL, PRINT_F);
  const lutTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, lutTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1024, 1, 0, gl.RED, gl.FLOAT, printLut);
  for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
  const riderData = new Float32Array(6 * 5);
  const riderVao = gl.createVertexArray();
  gl.bindVertexArray(riderVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, riderBuf);
  gl.bufferData(gl.ARRAY_BUFFER, riderData.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
  gl.bindVertexArray(null);

  const half = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
  const film = createFilm(gl, { width: stage.canvas.width, height: stage.canvas.height });
  // Render targets, half float when the GPU can draw to it (linear light
  // with headroom), else 8 bit (sRGB for the colour, so it stays linear to
  // sample). The scene, then the HALO pass: its source (one channel), the
  // across blur (narrow, wide), and the scene with the halo on it; last the
  // developed film, display values, for the PRINT pass.
  const FORMATS = {
    rgba: [
      [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT],
      [gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE],
    ],
    disp: [
      [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT],
      [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE],
    ],
    rg: [
      [gl.RG16F, gl.RG, gl.HALF_FLOAT],
      [gl.RG8, gl.RG, gl.UNSIGNED_BYTE],
    ],
    r: [
      [gl.R16F, gl.RED, gl.HALF_FLOAT],
      [gl.R8, gl.RED, gl.UNSIGNED_BYTE],
    ],
  };
  const target = (w, h, kind) => {
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    for (const [fi, [internal, format, type]] of FORMATS[kind].entries()) {
      if (fi === 0 && !half) continue;
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) break;
    }
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo };
  };
  const free = (t) => {
    if (!t) return;
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fbo);
  };
  let scene = null;
  let haloSrc = null;
  let haloH = null;
  let haloed = null;
  let filmed = null;
  let lastKey = "";
  let map = { ox: 0, oy: 0, k: 1, kRef: 1 };
  const build = () => {
    const w = stage.canvas.width;
    const h = stage.canvas.height;
    [scene, haloSrc, haloH, haloed, filmed].forEach(free);
    scene = target(w, h, "rgba");
    haloSrc = target(w, h, "r");
    haloH = target(w, h, "rg");
    haloed = target(w, h, "rgba");
    filmed = target(w, h, "disp");
    film.resize(w, h);
    // Cover the box with the photograph, then crop in to the view, inside
    // the turned photograph. Rows stay rows under a pitch, so the plate's
    // outline in view px is a trapezoid with level top and bottom.
    const cover = Math.max(w / IW, h / IH);
    const e = VIEW.inset;
    const [tl, tr, bl, br] = [
      [e, e],
      [IW - e, e],
      [e, IH - e],
      [IW - e, IH - e],
    ].map(([x, y]) => view.view(x, y));
    const sideAt = (a, b, y) => a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]);
    const yT = Math.max(tl[1], tr[1]);
    const yB = Math.min(bl[1], br[1]);
    const top = view.view(VIEW.mast[0], VIEW.top)[1];
    const mastX = view.view(VIEW.mast[0], VIEW.mast[1])[0];
    let k = Math.max(cover, Math.min(cover * VIEW.zoom, (w * VIEW.zoom) / IW));
    let x0 = 0;
    let y0 = 0;
    for (let it = 0; it < 400; it++, k *= 1.01) {
      const vw = w / k;
      const vh = h / k;
      if (yB - vh < yT) continue;
      y0 = clamp(top, yT, yB - vh);
      const lo = Math.max(sideAt(tl, bl, y0), sideAt(tl, bl, y0 + vh));
      const hi = Math.min(sideAt(tr, br, y0), sideAt(tr, br, y0 + vh));
      if (hi - lo < vw) continue;
      x0 = clamp(mastX - VIEW.poleAt * vw, lo, hi - vw);
      break;
    }
    // kRef: the scale the motion is tuned at (cover, as before the crop), so
    // a pull, the breeze and the sound read the same against the photograph.
    map = { ox: -x0 * k, oy: -y0 * k, k, kRef: cover };
    lastKey = "";
  };
  stage.onResize(build);

  // css px -> image px, back through the turned camera
  const toImage = (x, y) => {
    const d = stage.dpr;
    return view.img((x * d - map.ox) / map.k, (y * d - map.oy) / map.k);
  };
  // image px -> device px [x, y, w]
  const toDevice = (x, y) => {
    const [vx, vy, vw] = view.view(x, y);
    return [map.ox + vx * map.k, map.oy + vy * map.k, vw];
  };
  // Device px per image px around an image point (the turned camera
  // magnifies the bottom of the frame more than the top).
  const scaleAt = (x, y) => {
    const [a, b, c, dd] = view.jac(x, y);
    return map.k * Math.sqrt(Math.abs(a * dd - b * c));
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
  const catchRadius = (x, y) => (5 * stage.dpr) / scaleAt(x, y);

  const release = (w, speed = 0) => {
    const cg = w.caught;
    if (!cg) return;
    w.caught = null;
    // How far the string was drawn, in device px: the sound follows it.
    const drawn = Math.abs(drawnY(w, cg.j)) * map.kRef;
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
        // Slide along with the hand; let go past the reach.
        w.caught.j = clamp(hit.j, jMin, w.jExit - 0.3);
        const off = offsetAt(w, w.caught.j, x, y);
        const reach = reachOf(w);
        if (Math.abs(off) > reach || !inRun) {
          w.caught.target = clamp(off, -reach, reach);
          release(w, Math.hypot(p.vx, p.vy));
          // The hand is now past the wire: only coming back crosses it.
          w.prevSide = off;
        } else w.caught.target = off;
        continue;
      }
      if (!p.down || !inRun) {
        w.prevSide = hit.side;
        continue;
      }
      const crossed = w.prevSide != null && Math.sign(w.prevSide) !== Math.sign(hit.side) && hit.dist < reachOf(w) * 3;
      if ((isDown && hit.dist < catchRadius(x, y)) || crossed) {
        w.caught = { j: hit.j, target: offsetAt(w, hit.j, x, y) };
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
    // `at` runs along the free, visible run (pin to frame edge); amp 1.5 is
    // the fullest pull a taut wire takes, w.give (a few percent of that run).
    const settle = () => {
      const jc = clamp(w.j0 + at * (w.jExit - w.j0), w.j0 + 1, w.N - 1);
      pullShape(w, jc, (w.give * amp) / 1.5);
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
    gl.uniform2fv(pr.u.uGlow, glow);
    gl.uniform3fv(pr.u.uMist, mistU);
    gl.uniform3fv(pr.u.uSculpt, sculpt);
    gl.uniform3fv(pr.u.uCloudShade, cloudShade);
  };
  const drawScene = () => {
    const W = stage.canvas.width;
    const H = stage.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
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
    gl.uniformMatrix3fv(plateP.u.uHom, true, view.toImg);
    gl.uniform2f(plateP.u.uImg, IW, IH);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, keyTex);
    gl.uniform1i(plateP.u.uKey, 1);
    gl.activeTexture(gl.TEXTURE0);
    setGrade(plateP);
    gl.uniform3f(plateP.u.uPolar, polar, polarSat, polarHue / 360);
    gl.uniform4fv(plateP.u.uVib, vib);
    gl.uniform2fv(plateP.u.uSun, sun);
    gl.uniform4fv(plateP.u.uEdge, edge);
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
        // simulation nodes, filleted where it is pinned (the photograph keeps
        // its wire up to there).
        const [rx, ry, nxx, nyy] = w.rest(s);
        const yy = drawnY(w, j);
        // The string's point in the photograph, through the turned camera.
        const ix = rx + nxx * yy;
        const iy = ry + nyy * yy;
        const [vx, vy] = view.view(ix, iy);
        const cx = map.ox + vx * k;
        const cy = map.oy + vy * k;
        // Across the drawn wire: perpendicular to its projected tangent, and
        // the width a strip of the photograph's wire takes there (area scale
        // over length scale of the local map).
        const [ja, jb, jc, jd] = view.jac(ix, iy);
        const tx = ja * nyy - jb * nxx;
        const ty = jc * nyy - jd * nxx;
        const tl = Math.hypot(tx, ty) || 1;
        const ux = -ty / tl;
        const uy = tx / tl;
        const across = (Math.abs(ja * jd - jb * jc) / tl) * k;
        // Fitted widths read ~0.6 px wide of the photograph at display size.
        const hw = ((w.knot(w.def.w, s) - WIDTH_TRIM) / 2) * across;
        const sig = w.knot(w.def.sig, s) * across;
        const o = w.knot(w.def.o, s);
        const r = ho[1] > ho[0] ? clamp((s - ho[0]) / (ho[1] - ho[0]), 0, 1) : 1;
        const ext = hw + 3 * sig + 2;
        for (const sgn of [-1, 1]) {
          const b = n * STRIDE;
          const ex = ux * ext * sgn;
          const ey = uy * ext * sgn;
          // The rest point under this vertex, in the photograph: the key and
          // the insulator mask are looked up there.
          const [qx, qy] = view.img(vx + ex / k, vy + ey / k);
          wireData[b] = cx + ex;
          wireData[b + 1] = cy + ey;
          wireData[b + 2] = ext * sgn;
          wireData[b + 3] = hw;
          wireData[b + 4] = sig;
          wireData[b + 5] = o;
          wireData[b + 6] = r;
          wireData[b + 7] = qx - nxx * yy;
          wireData[b + 8] = qy - nyy * yy;
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

      // Insulators that ride the wire move with it, and turn with it: an
      // in-line insulator is a rigid link in the wire, so it lies along the
      // local slope of the displaced wire and the wire leaves both its ends
      // straight, with no kink. The turn is about its centre on the wire, in
      // the photograph's plane (the corners then go through the homography).
      for (const r of w.def.riders) {
        const jc = r.sc / w.ds;
        const yy = sampleY(w, jc);
        const h = 0.5 * Math.max(r.s1 - r.s0, w.ds) / w.ds;
        const slope = (sampleY(w, jc + h) - sampleY(w, jc - h)) / (2 * h * w.ds);
        const [cx0, cy0, rnx, rny] = w.rest(r.sc);
        const ox = cx0 - 0.5;
        const oy = cy0 - 0.5;
        const cs = 1 / Math.sqrt(1 + slope * slope);
        const sn = slope * cs;
        const place = (x, y) => {
          const ux = x - ox;
          const uy = y - oy;
          return [ox + ux * cs - uy * sn + rnx * yy, oy + ux * sn + uy * cs + rny * yy];
        };
        const [x0, y0, x1, y1] = r.box;
        const [ax, ay, aw, ah] = r.atlas;
        const corners = [
          [...place(x0, y0), ax, ay],
          [...place(x1, y0), ax + aw, ay],
          [...place(x0, y1), ax, ay + ah],
          [...place(x1, y1), ax + aw, ay + ah],
        ];
        const order = [0, 1, 2, 2, 1, 3];
        order.forEach((ci, m) => {
          const c = corners[ci];
          const [px, py, pw] = toDevice(c[0], c[1]);
          riderData[m * 5] = px;
          riderData[m * 5 + 1] = py;
          riderData[m * 5 + 2] = pw;
          riderData[m * 5 + 3] = c[2] / meta.atlas[0];
          riderData[m * 5 + 4] = c[3] / meta.atlas[1];
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

  // HALO over the finished scene: source, across, then down and onto it.
  const halation = () => {
    const W = stage.canvas.width;
    const H = stage.canvas.height;
    const d = stage.dpr / 2;
    const sig = [Math.max(0.5, HAL_NARROW[0] * d), Math.max(1, HAL_WIDE[0] * d)];
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, W, H);
    gl.bindVertexArray(quadVao);
    gl.activeTexture(gl.TEXTURE0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, haloSrc.fbo);
    gl.useProgram(haloSrcP.p);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(haloSrcP.u.uScene, 0);
    gl.uniform2f(haloSrcP.u.uThr, halThr, HAL_CAP);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, haloH.fbo);
    gl.useProgram(haloHP.p);
    gl.bindTexture(gl.TEXTURE_2D, haloSrc.tex);
    gl.uniform1i(haloHP.u.uSrc, 0);
    gl.uniform2fv(haloHP.u.uSig, sig);
    gl.uniform2f(haloHP.u.uStep, 1 / W, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, haloed.fbo);
    gl.useProgram(haloCP.p);
    gl.bindTexture(gl.TEXTURE_2D, haloH.tex);
    gl.uniform1i(haloCP.u.uSrc, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(haloCP.u.uScene, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2fv(haloCP.u.uSig, sig);
    gl.uniform2f(haloCP.u.uStep, 0, 1 / H);
    gl.uniform3fv(haloCP.u.uHal, halo);
    gl.uniform3fv(haloCP.u.uHalTint, HAL_TINT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
  };

  // PRINT: the developed frame onto the paper, to the canvas.
  const printPass = () => {
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.bindVertexArray(quadVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(printP.p);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lutTex);
    gl.uniform1i(printP.u.uLut, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, filmed.tex);
    gl.uniform1i(printP.u.uFilm, 0);
    gl.uniform3fv(printP.u.uToeTint, PRINT_TOE);
    gl.uniform3fv(printP.u.uWb, PRINT_WB);
    gl.uniform3fv(printP.u.uPrint, printU);
    gl.uniform2fv(printP.u.uToeSat, PRINT_TOE_SAT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
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
        if (hit && hit.dist < catchRadius(x, y) * 1.4 && hit.j > Math.max(0.6, w.jGrip) && hit.j < w.jExit - 0.3) near = w;
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
      halation();
      film.render(haloed.tex, { ...film0, exposure, grainSeed: tick * 7.31 }, filmed.fbo);
      printPass();
      lastKey = key;
      lastGrain = tick;
    }
  };
  stage.onFrame(frame);

  await new Promise((r) => requestAnimationFrame(() => r()));
  if (stage.canvas.width > 1) {
    if (!scene) build();
    frame(1 / 60, performance.now() / 1000);
  }
  born = performance.now();
  void embedded;

  return {
    destroy() {
      sound.destroy();
      film.destroy();
      [scene, haloSrc, haloH, haloed, filmed].forEach(free);
      gl.deleteTexture(plateTex);
      gl.deleteTexture(lutTex);
      gl.deleteTexture(atlasTex);
      gl.deleteTexture(keyTex);
      for (const b of [quad, wireBuf, riderBuf]) gl.deleteBuffer(b);
      for (const v of [quadVao, wireVao, riderVao]) gl.deleteVertexArray(v);
      for (const pr of [plateP, wireP, riderP, haloSrcP, haloHP, haloCP, printP]) gl.deleteProgram(pr.p);
      stage.destroy();
    },
  };
}
