import { createStage, clamp } from "../_kit/stage";

// Fog: a worm's-eye view up between the Canary Wharf towers into a summer
// cumulus sky, with real air applied per pixel through its real distance.
// Drag sets the visibility, from a clear 50 km day down to a 150 m haze,
// through air that is swept clearer close to the eye.
//
// The plate is two Poly Haven HDRIs (CC0, both from their 16k captures) rendered
// at 3840 through the same stereographic rays: the towers from canary_wharf, the
// sky from docklands_01: a radial cobalt, pale cyan where it meets the towers,
// under cumulus unmixed from the capture's own blue and split-toned cyan-grey in
// the folds to warm-neutral on the sunlit tops, unclipped. Depth Anything V2 gives
// relative inverse depth, turned into metres offline (the glass corner ~30 m,
// the far tower down the street ~380 m), with the distance and the sky matte
// both stopped on the towers' silhouettes (no bleed band of sky distance
// inside a tower's edge). The matte is sub-pixel coverage on the plate's own
// edges, and the tower's distance runs out across them, so an edge pixel is
// its tower's air and the sky's by coverage, never a per-pixel switch.
// tools/depth/bakes/fog/ builds both (auxmap.py the distance and matte).
//
//   visibility V   the control (Koschmieder: beta = 3.912 / V at 550 nm)
//   haze layer     density falls off with height, scale height HS, so the air
//                  along a ray climbing at elevation e to distance d is
//                  L = HS / sin e * (1 - exp(-d sin e / HS)): low rays to the
//                  far towers cross the most air, the zenith the least
//   extinction     per channel, Rayleigh-leaning (blue goes first):
//                  T = exp(-beta * K_RGB * L)
//   in-scatter     the air is lit by the sky, so its colour is the sky's own
//                  light: in front of a tower, the open sky at that tower's
//                  elevation (mid-sky blue, never the pale rim or a cloud),
//                  so far towers go blue and keep their glass; in front of
//                  the sky, the sky blurred wide (a normalised blur of the sky
//                  pixels only), clamped to a clear cyan, through the sky's
//                  airmass, with the clouds' local detail kept through the veil;
//                  plus the sun's light scattered forward (Henyey-Greenstein,
//                  g 0.6, warm-white), strong toward the sun past the top edge
//                  and next to nothing in the low sky, which looks away from it;
//                  held off the deepest shadows of what is still clearly seen
//   cumulus        unmixed from the open blue under them and laid out again on
//                  a long ramp (skylight-blue undersides at ~0.55 display, a
//                  grey body, cream only on the top tenth), their cover
//                  feathered by the cover around it, so margins dissolve into
//                  the cobalt and lone flecks drop out
//   split grade    after the haze, by the luminance it left, weighted by how
//                  much of the light is the sun's: veiled cumulus tops still
//                  roll off warm, the open sky keeps the air's cyan
//   breath         the haze gathers a little thicker where the pointer rests,
//                  and banks of it drift slowly through the street

const COLOR_SRC = "/lab/fog/plate.webp";
const AUX_SRC = "/lab/fog/aux.png"; // r log distance, g sky coverage, b elevation
const ASPECT = 3 / 2;
const PLATE_W = 3840; // plate.webp width; the forward-scatter blur is tuned in its levels
const D_MIN = 10;
const D_MAX = 4000;
const HS = 500; // haze scale height, metres
// Everything along the line of sight is veiled, the sky and its cumulus too.
// A ray that leaves the towers behind crosses the haze by airmass: the column
// overhead is this deep in full haze, and a ray at elevation e crosses 1 / sin e
// of it (floored at 0.15, about 8.6 degrees, where the flat-layer law stops
// being true). Overhead the veil stays thin, so the zenith keeps its cobalt;
// down the street, at 20 degrees, the ray crosses three times as much, so at
// fog 0.55 (~280 m) the low cloud gaps are half haze, at 0.9 three quarters.
const HS_SKY = 30;
const AIRMASS_FLOOR = 0.15;
// The haze's own light, which every veiled ray takes on: low down the street,
// the pale grey-blue of horizon haze (sky light scattered many times over in a
// long column, so it has lost most of the blue's saturation); higher up it
// eases into the sky's own light, the cobalt overhead, so the zenith deepens.
const HAZE_COL = "#A9C3D6";
const HAZE_TOP = [26, 58]; // degrees: horizon haze below, the sky's own light above
// The air in the canyon sees less of the sky than the open column does (the
// towers hide most of it), so the light it scatters in front of a tower is a
// little dimmer than the sky's veil at the same elevation: a tower lost in the
// haze sits just under the sky behind it, a silhouette, never a lighter slab.
const CANYON = 0.82;
const V_CLEAR = 50000; // visibility at fog 0, metres
const V_THICK = 150; // visibility at fog 1
// The hand moves log V so that what you see changes evenly along the drag. In a
// frame whose far tower is 400 m off, the clear day's kilometres change little,
// so log V runs fast at the front and slows toward the thick end: 50 km at 0,
// ~1.3 km at 0.3 (the far towers half blue), ~350 m at 0.5 (they are cobalt
// silhouettes, the low sky veiled), ~180 m at 0.7. Past that the visibility
// barely moves; what the last stretch takes is the clear pocket around the
// viewer (below), so the near towers go last.
const V_CURVE = 2.8;
const visibility = (f) => V_CLEAR * Math.pow(V_THICK / V_CLEAR, 1 - Math.pow(1 - f, V_CURVE));
// The street is swept: the air in the canyon around the viewer is clearer, the
// haze lying out along the street. Density rises from nothing at the eye to
// full beyond about this distance (rho = s / (s + d0), so a ray to d crosses
// d - d0 ln(1 + d / d0) of full haze): the glass corner 30 m off sees a fifth
// of its straight-line air, the far tower at 380 m two thirds. The pocket
// holds until the far towers are gone (fog 0.5) and closes over the second
// half of the drag, which is when the near towers fade.
const D_CLEAR = 60;
const clearPocket = (f) => {
  const t = clamp((f - 0.5) / 0.5, 0, 1);
  return D_CLEAR * (1 - t * t * (3 - 2 * t));
};
const K_RGB = [0.82, 1.0, 1.24];
const K_SKY = [1.04, 1.0, 0.98];
const REST = 0.95; // arrival: a white-blue field of haze (~150 m, the pocket closed)
const ROLL = 0.25; // it clears to here (~2 km: the far towers turning blue)
const LEVELS = 6;
// The sky's light at the scale of a cumulus' forms (a normalised blur of the
// sky pixels, levels 3 and 4 of the pyramid, ~100-200 plate px): the plate minus
// this is the cloud's local detail, which the veil keeps.
const DETAIL_W = [0, 0, 0, 1];
const DETAIL_K = 0.65;
// The open blue under the clouds: the gaps' light alone, a normalised blur
// at a cumulus' scale and wider (levels 3 and 4, ~50-100 plate px, and the
// whole), so a cloud's cover can be read against the cobalt it is laid over.
const GAP_W = [0, 0, 0, 1, 1];
// The cumulus' own light, on a long ramp. The plate holds their folds, but
// over a narrow range (display luminance ~0.74 to 0.91, p5 to p99), which
// the film's shoulder lifted into one cream. Ranked on the plate's own spread
// of cloud light (linear, p1 0.49 to p99 0.82), each cloud is laid out again
// from a skylight-blue shade at 0.55 to the cream top at about 0.93 (display),
// so the median fold sits at ~0.72 and only the top tenth reaches the warm end.
const CLOUD_Y = [0.49, 0.82];
const CLOUD_RAMP = [0.55, 0.38, 1.25]; // display: floor, span, curve
// Cover, against the open blue, is feathered by its own surroundings: a
// cumulus' thin margin dissolves into the cobalt over the width of a wisp,
// and a fleck with no cloud around it (sub-threshold cover a few pixels
// across) drops out into the sky it sits in.
const FEATHER = [0.1, 0.6]; // cover over ~32 plate px: gone below, whole above
const FEATHER_LOD = 5;
const EDGE_LOD = 3; // and its margin eased out over ~8 plate px
// The in-scatter over the sky keeps the open sky's own saturation at each
// elevation: below about 36 deg it is the open blue measured between the
// clouds (uSkyLow, ~#5a9fcc, deepening to uSkyMid, ~#2f7fb8), easing into the
// wide blur only higher up, where that blur is the cobalt itself. Nothing
// lifts it toward white, so the low sky veils to a deep cyan-blue, not milk.
const AIR_OPEN_TOP = [36, 58]; // degrees: open-sky colour below, the blur above
const hex = (h) => [1, 3, 5].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(4)).join(", ");
// A display colour as a tint: scaled to unit luminance, so a grade toward it
// sets the hue at a pixel's own luminance and lifts nothing.
const tint = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const y = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  return c.map((v) => (v / y).toFixed(4)).join(", ");
};
const DRIFT_FPS = 20;
// The air is lit twice: by the sky (the ambient term above) and by the sun,
// which haze scatters mostly forward (Henyey-Greenstein, g ~0.6), so the air
// toward the sun glows warm-white and the air away from it stays the sky's.
// The sun is docklands_01's, behind thin cloud at azimuth ~37 deg, elevation
// ~29 deg in the capture; the sky was rendered at yaw 8 + 192, pitch -62,
// through a 118 deg stereographic frame (tools/depth/bakes/fog/render.py), so
// it sits just past the top edge of the plate, a little left of centre.
const SUN = { lon: 37.5, lat: 28.8, yaw: 200, pitch: -62 };
const HFOV = 118;
const SUN_G = 0.6;
const SUN_COL = "#FFF1E2";
const SUN_K = 0.13; // the lobe's strength against the sky's light (its mean over the sphere)
const SUN_SKY = 0.4; // over the open sky, in the sky's own colour
// The deepest shadows keep their black: the air's light is held off what is
// darker than this (linear) on a solid that is still clearly seen, so the
// near glass keeps its blacks while a far tower still fades to the sky.
const SHADOW_LIN = 0.18;
const SHADOW_K = 0.9;
// The sun's direction in the plate's camera frame (x right, y down, z forward).
const sunDir = () => {
  const r = Math.PI / 180;
  const [lo, la, t, p] = [SUN.lon * r, SUN.lat * r, SUN.yaw * r, SUN.pitch * r];
  const d = [Math.cos(la) * Math.sin(lo), -Math.sin(la), Math.cos(la) * Math.cos(lo)];
  // camera = (Ry(yaw) Rx(pitch))^T d
  const v = [Math.cos(t) * d[0] - Math.sin(t) * d[2], d[1], Math.sin(t) * d[0] + Math.cos(t) * d[2]];
  return [v[0], Math.cos(p) * v[1] - Math.sin(p) * v[2], Math.sin(p) * v[1] + Math.cos(p) * v[2]];
};

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  // Offscreen buffers store row 0 = top of the photograph, like the textures.
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMMON = `
uniform sampler2D uAux;
uniform float uBeta;      // extinction at 550 nm, per metre (3.912 / V)
uniform float uClear;     // the clear pocket around the viewer, metres (d0)
uniform vec3 uBreath;     // xy in print uv, z strength
uniform float uAspect;    // print w / h
uniform float uTime;

float distAt(vec4 aux) {
  return ${D_MIN.toFixed(1)} * exp(aux.r * ${Math.log(D_MAX / D_MIN).toFixed(5)});
}
float hash3(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
// Extinction along a ray at elevation sine s through haze at log-distance
// depth z (the noise lives at depths), weighted w by the pointer's breath.
float betaAt(vec2 uv, float z, float w) {
  // Banks of haze: low-frequency noise, advected sideways, living at depths.
  vec3 q = vec3(uv.x * uAspect * 1.4 - uTime * 0.012, uv.y * 1.2, z * 0.4);
  float n = vnoise(q) * 0.64 + vnoise(q * 2.03 + vec3(uTime * 0.008, 0.0, 3.1)) * 0.36;
  float b = uBeta * mix(0.7, 1.3, n);
  // It gathers where the pointer rests.
  vec2 p = (uv - uBreath.xy) * vec2(uAspect, 1.0);
  return b * (1.0 + uBreath.z * w * exp(-dot(p, p) / 0.06));
}
// Optical depth, per channel, along the ray to the tower this pixel is (or,
// in the band along a silhouette, the tower it partly is: aux.r carries the
// tower's distance out across its edge).
vec3 tauTower(vec2 uv, vec4 aux) {
  float d = distAt(aux);
  float s = max(sin(radians(aux.b * 90.0)), 0.06);
  // Air in a haze layer that thins with height, along the ray to a tower.
  float L = ${HS.toFixed(1)} / s * (1.0 - exp(-d * s / ${HS.toFixed(1)}));
  // Less of it near the eye: the swept street, d - d0 ln(1 + d / d0) of d.
  L *= 1.0 - uClear / d * log(1.0 + d / max(uClear, 1e-3));
  // Blue goes first along the street.
  return betaAt(uv, log(d), 1.0) * L * vec3(${K_RGB.map((k) => k.toFixed(2)).join(", ")});
}
// And to the sky through it.
vec3 tauSky(vec2 uv, vec4 aux) {
  float s = max(sin(radians(aux.b * 90.0)), 0.06);
  // The sky is looked at through the whole column, by airmass: a thin one
  // overhead, so the zenith stays clear, thickening gradually toward the
  // low sky down the street (1 / cos of the zenith angle, floored).
  float L = ${HS_SKY.toFixed(1)} / max(s, ${AIRMASS_FLOOR.toFixed(2)});
  // Over the sky it gathers at half strength: a breath, not a bank. The
  // column is short and the light it takes away is the cloud's warm-white,
  // which a Rayleigh spread turns lilac under the blue veil; there the haze
  // is near-grey and the veil keeps the skylight's cyan.
  return betaAt(uv, ${Math.log(D_MAX).toFixed(4)}, 0.5) * L * vec3(${K_SKY.map((k) => k.toFixed(2)).join(", ")});
}
`;

// The sky's light, premultiplied by the sky matte, for a normalised blur:
// rgb = sky light (display-encoded, so an 8-bit fallback target holds it
// without banding) * matte, a = matte.
const AIR = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uColor;
uniform sampler2D uAux;
uniform float uLod;
uniform float uOpen; // 1: the open gaps between the clouds only
void main() {
  vec3 c = textureLod(uColor, vUv, uLod).rgb;
  float m = textureLod(uAux, vUv, 0.0).g;
  m = smoothstep(0.5, 1.0, m);
  // Open blue: clearly bluer than it is red, in linear light (a cumulus is
  // near-neutral, and its thin margins sit in between).
  vec3 l = pow(c, vec3(2.2));
  float open = smoothstep(0.6, 0.75, (l.b - l.r) / max(l.b, 1e-3));
  m *= mix(1.0, open * open, uOpen);
  outColor = vec4(c * m, m);
}`;

// 13-tap downsample (Jimenez, CoD: Advanced Warfare).
const DOWN = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform vec2 uTexel; // of the source
void main() {
  vec2 t = uTexel;
  vec4 a = texture(uSrc, vUv + t * vec2(-2, -2));
  vec4 b = texture(uSrc, vUv + t * vec2(0, -2));
  vec4 c = texture(uSrc, vUv + t * vec2(2, -2));
  vec4 d = texture(uSrc, vUv + t * vec2(-1, -1));
  vec4 e = texture(uSrc, vUv + t * vec2(1, -1));
  vec4 f = texture(uSrc, vUv + t * vec2(-2, 0));
  vec4 g = texture(uSrc, vUv);
  vec4 h = texture(uSrc, vUv + t * vec2(2, 0));
  vec4 i = texture(uSrc, vUv + t * vec2(-1, 1));
  vec4 j = texture(uSrc, vUv + t * vec2(1, 1));
  vec4 k = texture(uSrc, vUv + t * vec2(-2, 2));
  vec4 l = texture(uSrc, vUv + t * vec2(0, 2));
  vec4 m = texture(uSrc, vUv + t * vec2(2, 2));
  outColor = (d + e + i + j) * 0.125 + (a + c + k + m) * 0.03125 + (b + f + h + l) * 0.0625 + g * 0.125;
}`;

// Tent upsample of the coarser sum, plus this level's own share.
const UP = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uLevel;
uniform sampler2D uCoarse;
uniform vec2 uTexel; // of the coarse
uniform float uW;
void main() {
  vec2 t = uTexel;
  vec4 s = texture(uCoarse, vUv) * 4.0;
  s += (texture(uCoarse, vUv + t * vec2(-1, 0)) + texture(uCoarse, vUv + t * vec2(1, 0)) + texture(uCoarse, vUv + t * vec2(0, -1)) + texture(uCoarse, vUv + t * vec2(0, 1))) * 2.0;
  s += texture(uCoarse, vUv + t * vec2(-1, -1)) + texture(uCoarse, vUv + t * vec2(1, -1)) + texture(uCoarse, vUv + t * vec2(-1, 1)) + texture(uCoarse, vUv + t * vec2(1, 1));
  outColor = s / 16.0 + texture(uLevel, vUv) * uW;
}`;

const COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uColor;
uniform sampler2D uAir;
uniform sampler2D uDetail; // the sky's light at the scale of the cumulus' forms
uniform sampler2D uGap;    // the open gaps' light alone, filled in under the clouds
uniform vec4 uRect;     // print rect in device px (x, y, w, h), y from top
uniform vec2 uCanvas;
uniform vec3 uSkyMean;  // display-encoded, the fallback where the blur saw no sky
uniform vec3 uSkyLow;   // display-encoded: the open sky low over the street (~20 deg)
uniform vec3 uSkyMid;   // and at mid height (~32 deg), before it deepens to cobalt
uniform vec3 uSun;      // the sun's direction in the plate's camera frame
${COMMON}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// How blue a linear colour is: the open sky ~0.6 to 1, a cumulus near 0.
float blueness(vec3 l) { return (l.b - l.r) / max(l.b, 1e-3); }
// This pixel's ray, through the plate's stereographic projection (zenith of
// the lens at the plate's centre, y down).
vec3 rayDir(vec2 uv) {
  vec2 p = vec2(uv.x - 0.5, (uv.y - 0.5) / ${ASPECT.toFixed(4)});
  float r = length(p);
  float th = 2.0 * atan(r / (2.0 * ${(0.25 / Math.tan(((HFOV / 4) * Math.PI) / 180)).toFixed(5)}));
  return vec3(r > 0.0 ? p * sin(th) / r : vec2(0.0), cos(th));
}
// Henyey-Greenstein, normalised to a mean of 1 over the sphere.
float phase(float c) {
  float g = ${SUN_G.toFixed(2)};
  float k = 1.0 + g * g - 2.0 * g * c;
  return (1.0 - g * g) / (k * sqrt(k));
}

// The plate, linear. It is larger than most screens draw it, so the sharp
// level is a box over this pixel's footprint (four bilinear taps of level 0)
// rather than a trilinear blend toward the half-size level, which would soften
// the glass; extra levels only for the haze's forward scatter.
vec3 plate(vec2 uv, float lod) {
  vec2 q = 0.25 / uRect.zw;
  vec3 c = textureLod(uColor, uv + vec2(-q.x, -q.y), lod).rgb + textureLod(uColor, uv + vec2(q.x, -q.y), lod).rgb
    + textureLod(uColor, uv + vec2(-q.x, q.y), lod).rgb + textureLod(uColor, uv + vec2(q.x, q.y), lod).rgb;
  return pow(c * 0.25, vec3(2.2));
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 uv = clamp((frag - uRect.xy) / uRect.zw, 0.0, 1.0);
  vec4 aux = texture(uAux, uv);
  // How much of this pixel is open sky: the aux coverage, boxed over the
  // pixel's footprint like the plate (the aux map is drawn smaller than 1:1,
  // and one bilinear tap of it would alias the silhouettes again).
  vec2 q = 0.25 / uRect.zw;
  float cov = 0.25 * (texture(uAux, uv + vec2(-q.x, -q.y)).g + texture(uAux, uv + vec2(q.x, -q.y)).g
    + texture(uAux, uv + vec2(-q.x, q.y)).g + texture(uAux, uv + vec2(q.x, q.y)).g);
  // Two rays share an edge pixel: one stops on the tower, one goes on to the
  // sky. Each has its own air, and the pixel is the two by coverage.
  vec3 Tt = exp(-tauTower(uv, aux));
  vec3 Ts = exp(-tauSky(uv, aux));

  // Forward scatter softens what the air has nearly taken: the towers only.
  // The sky behind the haze is veiled by the in-scatter below, never blurred
  // (convolving the clouds reads as a lens, not as air).
  float soft = (1.0 - Tt.g) * (1.0 - Tt.g) * (1.0 - cov);
  vec3 scene = plate(uv, soft * ${(1.6 + Math.log2(PLATE_W / 2400)).toFixed(3)});
  vec3 scene0 = scene;

  // The cumulus, given their volume back. Their cover is read against the
  // open blue under them (how much of its blueness is gone), and their own
  // light unmixed from it; then laid out again on a long ramp, ranked on the
  // plate's spread of cloud light: folds and undersides down in a
  // skylight-blue shade, the body a quiet grey, the sunlit tops alone up at
  // the cream end. Thin margins sit in the shade (light passes through them,
  // little scatters back), and their cover is feathered by the cover around
  // them, so a margin dissolves into the cobalt and a lone fleck in the open
  // blue, with no cloud around it, drops out.
  vec4 gp = texture(uGap, uv);
  vec3 gapL = pow((gp.rgb + uSkyMean * 0.002) / (gp.a + 0.002), vec3(2.2));
  float bgap = max(blueness(gapL), 0.5);
  float a0 = 1.0 - smoothstep(0.22, 0.97, blueness(scene) / bgap);
  vec3 wide = pow(textureLod(uColor, uv, ${FEATHER_LOD.toFixed(1)}).rgb, vec3(2.2));
  float aw = 1.0 - smoothstep(0.22, 0.97, blueness(wide) / bgap);
  vec3 near = pow(textureLod(uColor, uv, ${EDGE_LOD.toFixed(1)}).rgb, vec3(2.2));
  float ae = 1.0 - smoothstep(0.22, 0.97, blueness(near) / bgap);
  float af = min(a0, ae) * smoothstep(${FEATHER[0].toFixed(2)}, ${FEATHER[1].toFixed(2)}, aw);
  vec3 ownL = max(scene - gapL * (1.0 - a0), 0.0) / max(a0, 0.35);
  float Ycl = max(luma(ownL), 1e-4);
  float rank = clamp(log(Ycl / ${CLOUD_Y[0].toFixed(3)}) / ${Math.log(CLOUD_Y[1] / CLOUD_Y[0]).toFixed(4)}, 0.0, 1.0);
  rank *= mix(0.7, 1.0, smoothstep(0.3, 0.9, a0));
  float yc = ${CLOUD_RAMP[0].toFixed(3)} + ${CLOUD_RAMP[1].toFixed(3)} * pow(rank, ${CLOUD_RAMP[2].toFixed(2)});
  vec3 cloudL = mix(vec3(1.0), ownL / Ycl, 0.25) * pow(yc, 2.2);
  // Between the clouds the plate's own blue, except what stands off the gap's
  // light by more than its gentle variation (a fleck, a dot), which takes it.
  float off = abs(log(max(luma(scene), 1e-4) / max(luma(gapL), 1e-4)));
  float fill = max(smoothstep(0.12, 0.3, off), 1.0 - (1.0 - a0) * (1.0 - a0));
  vec3 rebuilt = cloudL * af + mix(scene, gapL, fill) * (1.0 - af);
  scene = mix(scene, rebuilt, smoothstep(0.7, 1.0, cov));

  // The air is lit by the sky, and it is one medium: every ray, to a tower or
  // on past them to the sky and its cumulus, takes on the same haze light at
  // its elevation, by how much of the haze it crossed (the towers by their
  // distance, the sky by its airmass). Low down the street that light is the
  // pale grey-blue of horizon haze, so the low sky and the gaps between the
  // low cumulus lift and lose their saturation toward it; higher it eases into
  // the sky's own light, the cobalt overhead, so the zenith stays deep and
  // the sky deepens toward it instead of away.
  float elev = aux.b * 90.0;
  float up = smoothstep(${HAZE_TOP[0].toFixed(1)}, ${HAZE_TOP[1].toFixed(1)}, elev);
  vec3 hazeD = vec3(${hex(HAZE_COL)});
  // The sky's own light higher up: low and mid, the open sky measured between
  // the clouds at that elevation (clamped to the mid sky).
  vec3 openD = mix(uSkyLow, uSkyMid, smoothstep(18.0, 34.0, elev));
  // In front of the sky, the open blue low and mid, and only high up, where
  // the blur is the cobalt opening itself, the blur as it is: held to the
  // open blue's luminance where the two meet, so a cloud bank averaged into
  // it cannot pale the band above the low sky.
  vec4 a = texture(uAir, uv);
  vec3 blur = (a.rgb + uSkyMean * 0.02) / (a.a + 0.02);
  float hi = smoothstep(${AIR_OPEN_TOP[0].toFixed(1)}, ${AIR_OPEN_TOP[1].toFixed(1)}, elev);
  vec3 held = blur * min(1.0, luma(openD) / max(luma(blur), 1e-3));
  vec3 air = pow(mix(hazeD, mix(openD, mix(held, blur, hi), hi), up), vec3(2.2));
  // The canyon's air, in front of a tower: the same haze light at the tower's
  // elevation, in the open sky's blue and never brighter than the sky's light
  // there (the wide blur beside a high tower is mostly cumulus, and would turn
  // it to milk or to the clouds' grey), and dimmed by the sky the towers hide
  // from it, so a tower the haze has taken sits just under the sky behind it:
  // pale grey-blue down the street, blue going to cobalt overhead.
  vec3 openHi = openD * mix(1.0, luma(held) / max(luma(openD), 1e-3), hi);
  vec3 open = pow(mix(hazeD, openHi, up), vec3(2.2)) * ${CANYON.toFixed(2)};
  // And the sun's light, scattered forward: strongest toward the sun, just
  // past the top of the frame, and next to nothing in the low sky down the
  // street, which looks away from it.
  float lobe = ${SUN_K.toFixed(3)} * phase(dot(rayDir(uv), uSun));
  vec3 sun = pow(vec3(${hex(SUN_COL)}), vec3(2.2)) * lobe;
  // Over the open sky and the towers the lobe is the haze's own light,
  // brightened toward the sun, and lighter: a warm-white laid over cobalt
  // reads lilac, not as glare. Over a cumulus (bright and near-neutral in the
  // plate) it is the sun's warm-white, so a veiled top keeps its warmth
  // instead of taking the haze's blue.
  vec3 pd = pow(scene0, vec3(1.0 / 2.2));
  float cloud = smoothstep(0.42, 0.66, luma(pd)) * (1.0 - smoothstep(0.06, 0.2, pd.b - pd.r));
  vec3 sunSky = mix(air / max(luma(air), 1e-3) * lobe * ${SUN_SKY.toFixed(2)}, sun, cloud);
  vec3 sunTower = open / max(luma(open), 1e-3) * lobe * ${SUN_SKY.toFixed(2)} * ${CANYON.toFixed(2)};

  // The deepest shadows of a solid still clearly seen keep their black: the
  // air's light is held off them (the near glass stays inked; a far tower,
  // its transmittance gone, still fades whole into the haze).
  float deep = (1.0 - smoothstep(0.0, ${SHADOW_LIN.toFixed(3)}, luma(scene))) * Tt.g;
  vec3 tower = scene * Tt + (open + sunTower) * (1.0 - Tt) * (1.0 - ${SHADOW_K.toFixed(2)} * deep);
  vec3 sky = scene * Ts + (air + sunSky) * (1.0 - Ts);
  // The veil over the sky keeps the cumulus' forms: their local detail (the
  // plate less its blur at the scale of a cloud's forms) comes back over the
  // in-scatter, so at least ${Math.round(DETAIL_K * 100)}% of it survives any depth of haze and
  // the low cloud reads as cloud through the air, not as a flat wash.
  vec4 dtl = texture(uDetail, uv);
  vec3 forms = pow(dtl.rgb / max(dtl.a, 1e-3), vec3(2.2));
  vec3 kept = ${DETAIL_K.toFixed(2)} * (1.0 - Ts) * (scene0 - forms) * smoothstep(0.05, 0.3, dtl.a);
  sky += kept;
  // How much of the sky's light is still the cloud's own: what the air lets
  // through, and the sunlit detail the veil keeps over the air's blue.
  // Squared, so the warmth falls away with the veil: the cumulus overhead,
  // through a thin column, keep their cream tops, while the low cloud down
  // the street, half haze, takes the haze's cool grey-blue.
  float own = clamp(luma(scene * Ts + max(kept, 0.0)) / max(luma(sky), 1e-4), 0.0, 1.0);
  own *= own;
  vec3 col = mix(tower, sky, cov);
  // How much of this pixel's light is the sun's, for the split grade the
  // finish runs over the composite: a cumulus' own light (sunlit, near-neutral
  // in the plate) as far as the air lets it through, and the sun's share of
  // the air in front of it. So a veiled top still lands on the warm end of the
  // grade, by its luminance after the haze, while the open sky, cyan in the
  // plate and lit by the sky alone, takes none of it. On a tower, the clear
  // air in front of its light stone and glints, as before.
  float share = luma(sun) / (luma(sun) + luma(air) + 1e-4);
  float warm = mix(smoothstep(0.35, 0.85, Tt.g), cloud * (own + (1.0 - own) * mix(0.1, 1.0, share)), cov);
  // Display-encoded and untoned, for the film finish. Alpha packs two
  // sixteenths (it survives an 8-bit target): how much of this pixel is a solid
  // tower still seen through the air (the glass grade's weight, so far towers
  // keep the blue the haze gave them), and the split grade's weight above.
  float solid = Tt.g * (1.0 - cov);
  outColor = vec4(pow(max(col, 0.0), vec3(1.0 / 2.2)), (floor(solid * 15.0 + 0.5) * 16.0 + floor(warm * 15.0 + 0.5)) / 255.0);
}`;

// The film's response, shared by the halation threshold and the finish. In
// display terms: the mids and the sky are left where the plate put them, the
// upper range opens so the cumulus tops come up to a warm white, and a soft
// shoulder lands everything under 0.985 (the film never clips). The top of
// that shoulder is warm: above about 0.9 in luminance the light rolls off
// toward cream #FFF1E2 at its own (slightly compressed) luminance, so the
// brightest cumulus tops and glints print cream, never neutral paper-white.
const SHOULDER_COL = "#FFF1E2";
const TONE = `
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// lift: how much the upper range opens. None on a cumulus, whose light the
// composite has already laid out on its own long ramp (lifted, it all lands
// in one cream band again).
vec3 tone(vec3 x, float lift) {
  vec3 y = x + 0.11 * lift * smoothstep(0.5, 0.88, x);
  vec3 k = vec3(0.9);
  y = min(y, k) + 0.085 * (1.0 - exp(-max(y - k, 0.0) / 0.085));
  float l = luma(y);
  float top = l - 0.4 * max(l - 0.9, 0.0);
  return mix(y, top * vec3(${tint(SHOULDER_COL)}), smoothstep(0.86, 0.96, l));
}
// What exposes the halation: the toned highlights, above about 0.8, that are
// light rather than sky: the sunlit cumulus and glints, near-neutral to warm.
// The pale cyan of the low sky in haze is bright too, but it is a cool field,
// not a highlight, and a ring of red round every tower against it reads as a
// chroma fringe.
float highlight(vec3 display, float lift) {
  float cool = smoothstep(0.03, 0.1, display.b - display.r);
  return smoothstep(0.8, 0.94, luma(tone(display, lift))) * (1.0 - cool);
}
// The composite packs two weights in alpha: how much of the pixel is a solid
// tower, and how much of its light is the sun's (a cumulus, mostly). The lift
// is off by the second, on the sky.
float liftOf(float a) {
  float packed = floor(a * 255.0 + 0.5);
  return 1.0 - (mod(packed, 16.0) / 15.0) * (1.0 - floor(packed / 16.0) / 15.0);
}
`;

// The finish's sources at half size: rgb the scene, linear, for the diffusion
// bloom; a the highlights that expose the halation.
const BRIGHT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
${TONE}
void main() {
  vec4 s = texture(uScene, vUv); // one bilinear tap: the 2x2 box below it
  outColor = vec4(pow(max(s.rgb, 0.0), vec3(2.2)), highlight(s.rgb, liftOf(s.a)));
}`;

// The last stage: the scene as summer film, scanned. A diffusion bloom and
// scan softness, a filmic shoulder whose top end is warm-neutral, cloud shade
// toward skylight blue, glass graded away from the sky's blue, a thin amber
// halation under the highlight edges, and 24 fps grain at scan scale.
const FINISH = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
uniform sampler2D uHal;
uniform sampler2D uBloom;
uniform vec2 uNorm;    // halation, bloom chain weight sums
uniform float uGrain;  // grain seed, a new frame of grain every 2 frames at 24 fps
uniform float uGrainPx; // grain size in device pixels
${TONE}
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
// Value noise at the scan's sampling pitch: soft clumps, not square cells.
float grain(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y) - 0.5;
}

void main() {
  vec4 s = texture(uScene, vUv);
  float packed = floor(s.a * 255.0 + 0.5);
  float solid = floor(packed / 16.0) / 15.0;
  float warm = mod(packed, 16.0) / 15.0;
  vec3 lin = pow(max(s.rgb, 0.0), vec3(2.2));

  // Diffusion: the emulsion and the scanner both spread a little light, so the
  // image sits in a faint glow of itself and the finest edges go soft.
  vec3 bloom = texture(uBloom, vUv).rgb / uNorm.y;
  lin = mix(lin, bloom, 0.12) + max(bloom - lin, 0.0) * 0.1;
  vec3 c = pow(lin, vec3(1.0 / 2.2));

  // Glass, in its midtones, away from the sky's blue toward a cool green; its
  // light stone and lit mullions a touch warm.
  float l = luma(c);
  float mid = smoothstep(0.08, 0.3, l) * (1.0 - smoothstep(0.45, 0.75, l));
  float top = smoothstep(0.45, 0.8, l);
  c *= mix(vec3(1.0), vec3(0.96, 1.03, 0.945), mid * solid);
  c *= mix(vec3(1.0), vec3(1.05, 1.0, 0.92), top * solid);

  // The film's shoulder, per channel.
  float lift = liftOf(s.a);
  c = tone(c, lift);

  // The split grade, after the haze and the shoulder, by the luminance the
  // composite left, along the cumulus' long ramp: skylight blue #A2BDD3 in the
  // undersides and the folds facing away (~0.55 to 0.62), cyan-grey #B7C5C5
  // through the shade, #DFE1DE across the body, and warm-neutral #FFF1E2 only
  // on the sunlit tops (above ~0.84, the top tenth), each at its own luminance
  // (a tint, not a lift). Weighted by how much of the light is the sun's, so a
  // cumulus top seen through the haze still rolls off warm, and the open sky
  // keeps the colour the air gave it.
  l = luma(c);
  vec3 tint = mix(vec3(${tint("#A2BDD3")}), vec3(${tint("#B7C5C5")}), smoothstep(0.56, 0.68, l));
  tint = mix(tint, vec3(${tint("#DFE1DE")}), smoothstep(0.68, 0.8, l));
  tint = mix(tint, vec3(${tint("#FFF1E2")}), smoothstep(0.82, 0.93, l));
  // On a tower only the top end, as the glass grade above owns its mids.
  c = mix(c, l * tint, mix(smoothstep(0.3, 0.5, l), smoothstep(0.72, 0.95, l), solid) * mix(0.95, 0.85, solid) * warm);
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  float shade = smoothstep(0.5, 0.68, l) * (1.0 - smoothstep(0.78, 0.92, l)) * (1.0 - smoothstep(0.1, 0.3, sat)) * (1.0 - solid);
  c *= mix(vec3(1.0), vec3(0.97, 1.0, 0.99), shade);

  // Halation: light through the base bouncing back into the red layer, just
  // outside each highlight edge.
  float hal = max(texture(uHal, vUv).a / uNorm.x - highlight(s.rgb, lift), 0.0);
  // A warm amber: red with half as much green, so over the cyan sky it warms
  // the ring toward the cloud's white instead of printing magenta.
  c += hal * vec3(0.3, 0.15, 0.02);

  // A little toe, then grain: luminance only, strongest in the midtones.
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.1);
  l = luma(c);
  vec2 g = gl_FragCoord.xy / uGrainPx + uGrain * vec2(37.0, 17.0);
  float n = grain(g) * 0.75 + grain(g * 1.7 + 11.0) * 0.45;
  c += n * 0.075 * (0.25 + 2.6 * l * (1.0 - l)) * (1.0 - 0.7 * smoothstep(0.85, 1.0, l));
  c += (hash(gl_FragCoord.xy + 17.0) - 0.5) / 255.0;
  // Grain rides on the shoulder, never through it: the print does not clip.
  outColor = vec4(clamp(c, 0.0, 0.99), 1.0);
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
  }
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

function imageTexture(gl, img, mip) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// The mean (display-encoded) colour of the sky pixels, for where the blur sees none.
function skyMean(colorImg, auxImg) {
  const w = 48;
  const h = 32;
  const read = (img) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0, w, h);
    return x.getImageData(0, 0, w, h).data;
  };
  const col = read(colorImg);
  const aux = read(auxImg);
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    const m = aux[i * 4 + 1] / 255;
    if (m < 0.9) continue;
    for (let k = 0; k < 3; k++) sum[k] += col[i * 4 + k] / 255;
    n++;
  }
  return n ? sum.map((s) => s / n) : [0.25, 0.45, 0.7];
}

// The open sky (not cloud) at two elevations, display-encoded: the colour the
// air takes in front of the towers.
function openSky(colorImg, auxImg) {
  const w = 240;
  const h = 160;
  const read = (img) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0, w, h);
    return x.getImageData(0, 0, w, h).data;
  };
  const col = read(colorImg);
  const aux = read(auxImg);
  const band = (lo, hi, fallback) => {
    const ch = [[], [], []];
    for (let i = 0; i < w * h; i++) {
      const e = (aux[i * 4 + 2] / 255) * 90;
      if (aux[i * 4 + 1] < 242 || e < lo || e >= hi) continue;
      // open sky only: clearly bluer than it is red (cloud is near-neutral)
      if (col[i * 4 + 2] - col[i * 4] < 76) continue;
      for (let k = 0; k < 3; k++) ch[k].push(col[i * 4 + k] / 255);
    }
    if (ch[0].length < 20) return fallback;
    return ch.map((v) => v.sort((a, b) => a - b)[v.length >> 1]);
  };
  return { low: band(16, 24, [0.35, 0.62, 0.8]), mid: band(28, 36, [0.18, 0.5, 0.72]) };
}

// A critically damped spring: interruptible, lands without overshoot.
function spring(x) {
  return { x, v: 0, target: x };
}
function stepSpring(s, dt, k) {
  const c = 2 * Math.sqrt(k);
  const a = k * (s.target - s.x) - c * s.v;
  s.v += a * dt;
  s.x += s.v * dt;
  return Math.abs(s.target - s.x) > 1e-4 || Math.abs(s.v) > 1e-4;
}

export async function createFog(host, { embedded = false } = {}) {
  const stage = createStage(host, { dpr: 2, webgl: true, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");

  const [colorImg, auxImg] = await Promise.all([loadImage(COLOR_SRC), loadImage(AUX_SRC)]);
  const colorTex = imageTexture(gl, colorImg, true);
  const auxTex = imageTexture(gl, auxImg, false);
  const skyLin = skyMean(colorImg, auxImg);
  const skyOpen = openSky(colorImg, auxImg);
  const sun = sunDir();

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const P = {
    air: compile(gl, VERT, AIR),
    down: compile(gl, VERT, DOWN),
    up: compile(gl, VERT, UP),
    composite: compile(gl, VERT, COMPOSITE),
    bright: compile(gl, VERT, BRIGHT),
    finish: compile(gl, VERT, FINISH),
  };

  const float = !!gl.getExtension("EXT_color_buffer_float");
  const target = (w, h) => {
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
    return { tex, fbo, w, h };
  };
  const free = (t) => {
    if (!t) return;
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fbo);
  };

  // The sky's light, blurred wide once: the colour of the air. It depends on
  // the plate only, so its pyramid has a fixed size.
  const down = [];
  const up = [];
  const upDetail = [];
  const gapDown = [];
  const gapUp = [];
  {
    let bw = 600;
    let bh = 400;
    for (let i = 0; i < LEVELS; i++) {
      down.push(target(bw, bh));
      gapDown.push(target(bw, bh));
      up.push(i === LEVELS - 1 ? null : target(bw, bh));
      gapUp.push(i === LEVELS - 1 ? null : target(bw, bh));
      if (i < DETAIL_W.length) upDetail.push(target(bw, bh));
      bw = Math.max(2, Math.round(bw / 2));
      bh = Math.max(2, Math.round(bh / 2));
    }
  }

  let rect = { x: 0, y: 0, w: 1, h: 1 };
  let dirty = true;
  const params = new URLSearchParams(window.location.search);
  // Full bleed: the plate covers the box, held a little up and left of centre so the
  // towers' meeting point and the glass corner stay in view on tall screens.
  const layout = (w, h) => {
    const s = Math.max(w / ASPECT, h);
    const pw = s * ASPECT;
    const ph = s;
    rect = { x: (w - pw) * 0.45, y: (h - ph) * 0.42, w: pw, h: ph };
    dirty = true;
  };

  // --- state ---------------------------------------------------------------
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const qFog = params.get("fog");
  const held = qFog != null && Number.isFinite(+qFog);
  const qx = params.get("x");
  const qy = params.get("y");
  const fog = spring(held ? clamp(+qFog, 0, 1) : reduced ? ROLL : REST);
  const bx = spring(qx != null ? clamp(+qx, 0, 1) : 0.56);
  const by = spring(qy != null ? clamp(+qy, 0, 1) : 0.4);
  const breath = spring(held || qx != null ? 1 : 0.5);
  let time = Number.isFinite(+params.get("t")) && params.get("t") != null ? +params.get("t") : 0;
  let touched = held;
  let drag = null;
  let intro = !held && !reduced;
  let sinceDraw = 1;

  stage.onResize(layout);

  const toPrint = (p) => [(p.x - rect.x) / rect.w, (p.y - rect.y) / rect.h];
  const breatheAt = (p) => {
    const [u, v] = toPrint(p);
    bx.target = clamp(u, -0.1, 1.1);
    by.target = clamp(v, -0.1, 1.1);
    breath.target = 1;
  };

  stage.on("move", (p) => {
    touched = true;
    breatheAt(p);
    if (drag) {
      // Drag up to thicken the air (shorter visibility), down to clear it.
      fog.target = clamp(drag.f + ((drag.y - p.y) / Math.max(240, stage.height)) * 1.4, 0, 1);
    }
  });
  stage.on("down", (p) => {
    touched = true;
    intro = false;
    breatheAt(p);
    drag = { y: p.y, f: fog.target };
  });
  stage.on("up", () => {
    drag = null;
  });
  const onLeave = () => {
    breath.target = 0.5;
  };
  stage.canvas.addEventListener("pointerleave", onLeave);
  const onWheel = (e) => {
    e.preventDefault();
    touched = true;
    intro = false;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    fog.target = clamp(fog.target + dy / 900, 0, 1);
    breatheAt({ x: e.offsetX, y: e.offsetY });
  };
  if (!embedded) stage.canvas.addEventListener("wheel", onWheel, { passive: false });

  // On arrival the haze lifts off the street, and the sky deepens into blue.
  const introTimer = intro
    ? window.setTimeout(() => {
        if (!touched) fog.target = ROLL;
      }, 350)
    : 0;

  // --- passes --------------------------------------------------------------
  const quadDraw = (t) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    if (t) gl.viewport(0, 0, t.w, t.h);
    else gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const bind = (unit, tex) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  };
  // Down a pyramid from level 0 (already written).
  const descend = (dn) => {
    gl.useProgram(P.down.p);
    gl.uniform1i(P.down.u.uSrc, 0);
    for (let i = 1; i < dn.length; i++) {
      bind(0, dn[i - 1].tex);
      gl.uniform2f(P.down.u.uTexel, 1 / dn[i - 1].w, 1 / dn[i - 1].h);
      quadDraw(dn[i]);
    }
  };
  // Back up from level n - 1 (whole) through the finer levels, each adding its
  // own share by weight. The result sums to 1 + the weights.
  const ascend = (dn, ups, weights) => {
    const n = weights.length + 1;
    gl.useProgram(P.up.p);
    gl.uniform1i(P.up.u.uLevel, 0);
    gl.uniform1i(P.up.u.uCoarse, 2);
    for (let i = n - 2; i >= 0; i--) {
      const coarse = i === n - 2 ? dn[n - 1] : ups[i + 1];
      bind(0, dn[i].tex);
      bind(2, coarse.tex);
      gl.uniform2f(P.up.u.uTexel, 1 / coarse.w, 1 / coarse.h);
      gl.uniform1f(P.up.u.uW, weights[i]);
      quadDraw(ups[i]);
    }
    return ups[0];
  };

  gl.bindVertexArray(vao);
  gl.disable(gl.BLEND);
  gl.useProgram(P.air.p);
  bind(0, colorTex);
  bind(1, auxTex);
  gl.uniform1i(P.air.u.uColor, 0);
  gl.uniform1i(P.air.u.uAux, 1);
  gl.uniform1f(P.air.u.uLod, Math.log2(colorImg.naturalHeight / down[0].h));
  // First the open gaps alone, filled in under the clouds: the cobalt each
  // cumulus is laid over, for the cover the composite unmixes and feathers.
  gl.uniform1f(P.air.u.uOpen, 1);
  quadDraw(gapDown[0]);
  descend(gapDown);
  const gap = ascend(gapDown, gapUp, GAP_W);
  gl.useProgram(P.air.p);
  bind(0, colorTex);
  bind(1, auxTex);
  gl.uniform1f(P.air.u.uOpen, 0);
  quadDraw(down[0]);
  // Broadest only: the air is lit by the whole sky and which part of it is
  // brighter, never by one cloud. Any finer level prints a blurred copy of the
  // cumulus into the haze: in thick air that copy is what you see where the
  // clouds were, soft white blobs, and the sky behind reads as lens-blurred,
  // not veiled. The veil over the sky is this field alone, so the cumulus
  // under it lose contrast with their edges as sharp as the plate's.
  descend(down);
  const air = ascend(down, up, [0, 0, 0, 0, 0]);
  // And at the scale of the cumulus' forms, for the detail the veil keeps.
  const detail = ascend(down, upDetail, DETAIL_W);

  // The film finish works on the whole frame, so its targets follow the canvas:
  // the scene at full size, and a pyramid from half size for the halation
  // (its three finest levels, about 0.4% of the frame) and the bloom (all).
  const FX_LEVELS = 6;
  const HAL_W = [0.5, 1.0];
  const BLOOM_W = [0.6, 0.4, 0.4, 0.6, 0.8];
  const sum = (w) => 1 + w.reduce((a, b) => a + b, 0);
  let fx = null;
  const fxTargets = () => {
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (fx && fx.w === w && fx.h === h) return fx;
    if (fx) [fx.scene, ...fx.down, ...fx.hal, ...fx.bloom].forEach(free);
    const dn = [];
    let bw = Math.max(2, Math.round(w / 2));
    let bh = Math.max(2, Math.round(h / 2));
    for (let i = 0; i < FX_LEVELS; i++) {
      dn.push(target(bw, bh));
      bw = Math.max(2, Math.round(bw / 2));
      bh = Math.max(2, Math.round(bh / 2));
    }
    fx = {
      w,
      h,
      scene: target(w, h),
      down: dn,
      hal: HAL_W.map((_, i) => target(dn[i].w, dn[i].h)),
      bloom: BLOOM_W.map((_, i) => target(dn[i].w, dn[i].h)),
    };
    return fx;
  };

  const draw = () => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    const t = fxTargets();
    const vis = visibility(fog.x);
    const dpr = stage.dpr;
    gl.useProgram(P.composite.p);
    bind(0, colorTex);
    bind(1, auxTex);
    bind(2, air.tex);
    bind(3, detail.tex);
    bind(4, gap.tex);
    const cu = P.composite.u;
    gl.uniform1i(cu.uGap, 4);
    gl.uniform1i(cu.uColor, 0);
    gl.uniform1i(cu.uAux, 1);
    gl.uniform1i(cu.uAir, 2);
    gl.uniform1i(cu.uDetail, 3);
    gl.uniform1f(cu.uBeta, 3.912 / vis);
    gl.uniform1f(cu.uClear, clearPocket(fog.x));
    gl.uniform3f(cu.uBreath, bx.x, by.x, breath.x * 0.9);
    gl.uniform1f(cu.uAspect, ASPECT);
    gl.uniform1f(cu.uTime, time);
    gl.uniform3f(cu.uSkyMean, skyLin[0], skyLin[1], skyLin[2]);
    gl.uniform3f(cu.uSkyLow, skyOpen.low[0], skyOpen.low[1], skyOpen.low[2]);
    gl.uniform3f(cu.uSkyMid, skyOpen.mid[0], skyOpen.mid[1], skyOpen.mid[2]);
    gl.uniform3f(cu.uSun, sun[0], sun[1], sun[2]);
    gl.uniform4f(cu.uRect, rect.x * dpr, rect.y * dpr, rect.w * dpr, rect.h * dpr);
    gl.uniform2f(cu.uCanvas, gl.drawingBufferWidth, gl.drawingBufferHeight);
    quadDraw(t.scene);

    // The finish: its sources at half size, blurred twice, then the frame.
    gl.useProgram(P.bright.p);
    bind(0, t.scene.tex);
    gl.uniform1i(P.bright.u.uScene, 0);
    quadDraw(t.down[0]);
    descend(t.down);
    const hal = ascend(t.down, t.hal, HAL_W);
    const bloom = ascend(t.down, t.bloom, BLOOM_W);

    gl.useProgram(P.finish.p);
    bind(0, t.scene.tex);
    bind(1, hal.tex);
    bind(2, bloom.tex);
    const fu = P.finish.u;
    gl.uniform1i(fu.uScene, 0);
    gl.uniform1i(fu.uHal, 1);
    gl.uniform1i(fu.uBloom, 2);
    gl.uniform2f(fu.uNorm, sum(HAL_W), sum(BLOOM_W));
    // 24 fps grain, each frame of it held for 2 (a new one every 1/12 s).
    gl.uniform1f(fu.uGrain, reduced ? 0 : Math.floor(time * 12) % 97);
    gl.uniform1f(fu.uGrainPx, 0.75 * dpr);
    quadDraw(null);
  };

  const stillTime = params.get("t") != null || reduced;
  stage.onFrame((dt) => {
    // Arrival lifts slowly (about two seconds); the hand gets a quick spring.
    const k = drag ? 120 : intro ? 8 : 26;
    const moving = stepSpring(fog, dt, k) | stepSpring(bx, dt, 30) | stepSpring(by, dt, 30) | stepSpring(breath, dt, 10);
    if (intro && Math.abs(fog.x - ROLL) < 0.01) intro = false;
    sinceDraw += dt;
    if (!stillTime) time += dt;
    // The haze drifts on its own, drawn at a capped rate.
    const drift = !stillTime && sinceDraw >= 1 / DRIFT_FPS;
    if (!moving && !dirty && !drift) return;
    dirty = false;
    sinceDraw = 0;
    draw();
  });

  return {
    destroy() {
      window.clearTimeout(introTimer);
      stage.canvas.removeEventListener("pointerleave", onLeave);
      stage.canvas.removeEventListener("wheel", onWheel);
      [...down, ...up, ...upDetail, ...gapDown, ...gapUp].forEach(free);
      if (fx) [fx.scene, ...fx.down, ...fx.hal, ...fx.bloom].forEach(free);
      stage.destroy();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
