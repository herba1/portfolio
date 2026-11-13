import { createStage, clamp, damp } from "../_kit/stage";
import { createFilm, FILM_DEFAULTS, FILM_PRESETS } from "../_kit/film";
import { createCloth, drift, PHANTOM, PX, ROPE } from "./cloth";

// Sentaku (laundry): a washing line seen from underneath against a cobalt
// sky, the sun behind a sheer polka-dot dress. Every garment was cut out of
// the photograph (SAM 2.1, guided-filter mattes, colour unmixed against the
// plate), the sky behind them filled (LaMa, with the sun under the dress
// modelled back in from the glow around it), and each one hangs here as
// cloth on its pegs (cloth.js). The pointer is the wind: how fast it crosses
// the frame sets the gust, which way sets where it comes from, and the gust
// runs down the line from that side. Left alone, a breeze breathes.
//
// Light: each vertex is lit by the sun behind the line and the sky, from the
// cloth's own normal now against its normal at rest, so the frame at rest is
// the photograph and a fold that turns to the sun brightens. The dress is
// see-through: the bake split it into its fabric and a share of whatever is
// behind it, so the sun shows through it wherever the sun really is. Turned
// edge-on it is looked through along a longer path (tau^(1/mu), from the view
// cosine against the photograph's), so billows and rolled hems go denser and
// rose; where it folds over itself the doubled layer is multiplied in.
//
// The sun: each frame samples how much of the disc the cloth leaves in view.
// That share scales a lens veil over everything, lights the rims of the dress
// and the black-and-white top that face it, and pulls the exposure down most
// of a stop on a spring, so a gust that uncovers it flares, the garments
// sink toward rim-lit silhouettes against it, and the exposure breathes back
// as the dress covers it again.
//
// The view: the lens looks much further up than the photographer did, from
// further down and further in. The camera pitches toward the zenith, and as
// it does the eye drops (along the garments' hang, the world's gravity) and
// moves in toward the line, until it is under the line in front of the
// dress, at about the height of its hem. The sky is at infinity, the same
// from any eye, so it stays on the rotation's exact map. The cloth and the
// line are drawn by full perspective from the eye: each vertex is placed in
// 3D, on the photograph's own ray to it (so from the photograph's eye it is
// the photograph) on a plane turned so the line recedes to the right, plus the
// cloth's displacement. From below, gravity points at the lens: the pegs
// and the line recede and converge, the garments' sides converge on the
// zenith above the frame, and the hems come toward the lens and loom. It all
// goes out through a stereographic lens about 100 degrees across: conformal,
// so nothing stretches toward the edges as through a rectilinear lens that
// wide. The sky the photograph never held (above its top edge, and the wedges
// either side) is its smooth fit carried on by angle. Everything is lit in
// the photograph's own pixels (a vertex's are where its ray from the eye
// meets the photograph's image plane, which is where the sky behind it is),
// so the sun, its halo, the disc's coverage and the cloth's light stay
// registered. On load the camera tilts up on a spring, the lens easing from
// the photograph's own to the stereographic and the eye moving in as it goes.
//
// Query: ?gust=0..1 holds a steady gust (with ?dir=-1|1 and ?t=seconds of it,
// default 2.4), simulated deterministically and frozen, for stills.
// ?still=1 is the photograph with no wind. ?tilt=degrees sets the pitch (0 is
// the photograph's own view, and its own eye); ?drop, ?fwd and ?yaw move the
// eye and turn the line's plane. Numeric FILM keys override the grade.

const ASSET = "/lab/sentaku/";
const PAPER = [0xf2, 0xf0, 0xeb];
const GUST_MAX = 3.6; // m/s, a full swipe
const BREEZE = 0.95; // m/s, the idle air at its strongest
const FRONT = 3.2; // m/s, how fast a gust runs along the line
const SUN = (() => {
  const s = [-0.08, 0.86, 0.5];
  const l = Math.hypot(...s);
  return s.map((v) => v / l);
})();

const FILM = {
  ...FILM_DEFAULTS,
  ...FILM_PRESETS.summer,
  exposure: 0.15,
  toe: 0.08, // the natsu scan's lifted cyan black
  // a photograph already: less veil than a render, the sun kept off paper white
  bloom: 0.16,
  bloomThreshold: 0.5,
  softness: 0.4,
  halation: 0.38,
  // low, so the blown disc's light reaches the red layer; inside the bright
  // aureole the kit keeps halation off, so the plate paints the disc's thin
  // warm ring itself
  halationThreshold: 0.6,
  whitePoint: 1.25,
  contrast: 1.15,
  saturation: 1.04,
  blueDepth: 0, // the photograph's sky is already deep at the top
  grain: 0.32,
  vignette: 0.18,
  highlightTint: [1, 1, 1],
};

// The sun. The plate's own glow is the photograph's: a grey-white veil over
// the sky, with the disc the bake modelled back under the dress as a hard dot.
// HALO is that glow's excess over the smooth sky (linear rgb, mean over 8 px
// rings about meta.sun), measured off plate.webp against the bake's far-field
// quadratic sky. The plate pass lifts it off and puts back an aureole that
// glows cyan, a warm disc that blows out and rolls off, and a lens veil that
// is only there when the disc is in view.
const HALO_STEP = 8;
const HALO = new Float32Array([
  0.895, 0.851, 0.687, 0.689, 0.771, 0.638, 0.589, 0.668, 0.556, 0.562, 0.637, 0.529, 0.537, 0.608, 0.501,
  0.507, 0.576, 0.478, 0.477, 0.543, 0.453, 0.449, 0.509, 0.426, 0.422, 0.476, 0.399, 0.396, 0.447, 0.373,
  0.371, 0.421, 0.349, 0.342, 0.393, 0.325, 0.308, 0.365, 0.303, 0.28, 0.339, 0.284, 0.255, 0.315, 0.266, 0.234,
  0.295, 0.249, 0.217, 0.277, 0.236, 0.2, 0.26, 0.223, 0.185, 0.244, 0.211, 0.171, 0.23, 0.2, 0.159, 0.217,
  0.19, 0.147, 0.204, 0.178, 0.137, 0.193, 0.17, 0.127, 0.182, 0.16, 0.118, 0.173, 0.153, 0.11, 0.165, 0.147,
  0.102, 0.155, 0.139, 0.096, 0.146, 0.134, 0.091, 0.139, 0.127, 0.086, 0.132, 0.121, 0.082, 0.126, 0.116,
  0.077, 0.119, 0.11, 0.072, 0.113, 0.103, 0.067, 0.107, 0.097, 0.063, 0.1, 0.092, 0.06, 0.096, 0.089, 0.055,
  0.09, 0.084, 0.052, 0.085, 0.08, 0.049, 0.081, 0.077, 0.045, 0.077, 0.075, 0.042, 0.072, 0.072, 0.04, 0.069,
  0.069, 0.037, 0.065, 0.067, 0.035, 0.062, 0.064, 0.033, 0.059, 0.061, 0.031, 0.056, 0.058, 0.029, 0.053,
  0.055, 0.027, 0.05, 0.052, 0.025, 0.048, 0.049, 0.024, 0.046, 0.047, 0.022, 0.044, 0.044, 0.021, 0.041, 0.042,
  0.019, 0.038, 0.04, 0.018, 0.036, 0.038, 0.017, 0.034, 0.036, 0.016, 0.033, 0.035, 0.014, 0.031, 0.033, 0.014,
  0.029, 0.031, 0.013, 0.028, 0.029, 0.012, 0.027, 0.028, 0.011, 0.025, 0.027, 0.011, 0.024, 0.025, 0.011,
  0.023, 0.024, 0.01, 0.022, 0.022, 0.009, 0.021, 0.021, 0.009, 0.02, 0.021, 0.008, 0.019, 0.02, 0.008, 0.018,
  0.019, 0.007, 0.017, 0.018, 0.007, 0.016, 0.017, 0.007, 0.015, 0.016, 0.006, 0.014, 0.015, 0.005, 0.013,
  0.015, 0.005, 0.012, 0.014, 0.005, 0.011, 0.012, 0.004, 0.01, 0.011, 0.004, 0.009, 0.011, 0.004, 0.009, 0.01,
  0.003, 0.008, 0.009, 0.003, 0.007, 0.008, 0.003, 0.006, 0.007, 0.002, 0.006, 0.006, 0.002, 0.005, 0.006,
  0.002, 0.004, 0.005, 0.001, 0.004, 0.004, 0.001, 0.003, 0.003, 0.001, 0.002, 0.002, 0.001, 0.002, 0.002,
  0.001, 0.001, 0.001, 0, 0.001, 0.001, 0, 0, 0
]);
const DISC = 20; // px, the disc the coverage is sampled over
const DRESS_T = 0.3; // the share of the sun the sheer dress lets through to the lens
const ADAPT = 0.7; // stops the exposure gives back with the disc in clear view
const RIM = { 3: 0.9, 4: 1.0 }; // the dress and the black-and-white top catch the sun at the edge
const EDGE_GLOW = 1; // every garment's clean edge, lit warm from the sun behind it
const VS = 13; // floats per cloth vertex
const MU_MIN = 0.15; // the view cosine's floor: edge-on is dense, not opaque
// The dress's belt tie, in photograph px: a strip cut square at its end, so
// its matte is rounded there, or a flipped tie reads as a paper tab.
const TIE = [748, 1296, 852, 1492];

// The photograph's lens: the library copy is 2667 x 4000 (a 24 x 36 frame on
// its side), worked at 1400 px wide, so the 24 mm side is 1400 px and a 26 mm
// equivalent lens is about 1550 px; its optical centre is the middle of the
// uncropped frame (the crop keeps the top 3080 of 4000 rows).
const LENS_F = 1550;
const LENS_C = [700, 1050];
const TILT = 40; // degrees the camera pitches up past the photographer's view
const WIDEN = 1.8; // and the lens widens by this much as it does
const LENS_OY = 700; // the optical centre's row in the tilted frame: the line across the upper third, the hem low
const TILT_W = 5.2; // the tilt's spring: rad/s, about 1.2 s to settle
const TILT_Z = 0.82;
const TILT_AT = 0.35; // s after load before it starts
// The eye. A rotation alone only moves the line down the frame: nothing nears
// the lens. So as it tilts the eye also moves, down (along the garments' hang,
// the world's gravity) by EYE_DROP of the dress's hang and toward the line by
// EYE_FWD of its distance, under the line and in front of it. The cloth is
// drawn by full perspective from there; the sky, at infinity, is the same
// from any eye, and stays on the rotation's exact map. It goes no further
// than this because the sun is low behind the dress: from here its ray still
// meets the skirt just above the hem, so at rest the sun stays behind it.
const EYE_DROP = 0.45;
const EYE_FWD = 0.66;
const YAW = 20; // degrees the line's plane turns from square to the photograph's lens, its right end away
// the photograph's plane: the garments hang this far along its axis, where a
// metre reads as PX px through its lens
const Z0 = LENS_F / PX;

// The photograph's pixels to the tilted frame's: back through the lens to a
// ray, turned by the pitch about the lens's x axis (image y points down, so up
// is -y), and out through a stereographic lens about the new centre: a ray
// theta off the axis lands 2 fo tan(theta / 2) out, not fo tan(theta). It is
// conformal, so the wide view keeps every garment's shape where a rectilinear
// lens would stretch it toward the edges, and straight lines bow. The lens is
// the azimuthal family seen from kappa behind the sphere's centre,
// r = fo (1 + kappa) sin(theta) / (kappa + cos(theta)): kappa 0 is the
// photograph's own rectilinear lens, 1 the stereographic, so the tilt eases
// from the one to the other and ?tilt=0 is still the photograph.
const viewOf = (deg, widen, oy, kappa) => {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const f = LENS_F;
  const fo = f / widen;
  const [cx, cy] = LENS_C;
  const K = clamp(kappa, 0, 1);
  const R = [1, 0, 0, 0, c, s, 0, -s, c];
  const fwd = (u, v) => {
    const y = (v - cy) / f;
    const dx = (u - cx) / f;
    const dy = c * y + s;
    const dz = c - s * y;
    const k = (fo * (1 + K)) / (K * Math.hypot(dx, dy, dz) + dz);
    return [cx + dx * k, oy + dy * k];
  };
  return { R, lens: [f, cx, cy, fo], out: [oy, K], fwd };
};
// The same lens in GLSL: forward for the cloth's vertices, inverse for the
// full-frame plate. uR turns the photograph's rays into the frame's.
const LENS_GLSL = `
uniform mat3 uR;
uniform vec4 uLens; // the photograph's focal length and centre, the frame's focal length
uniform vec2 uOut;  // the frame's optical centre row, and kappa
// a ray, in the photograph's camera's axes, to the frame's px
vec2 rayToFrame(vec3 r) {
  vec3 d = uR * r;
  float K = uOut.y;
  return vec2(uLens.y, uOut.x) + d.xy * (uLens.w * (1.0 + K) / (K * length(d) + d.z));
}
vec2 toFrame(vec2 p) { return rayToFrame(vec3((p - uLens.yz) / uLens.x, 1.0)); }
// The frame's px back to the photograph's: the ray from kappa behind the
// sphere through the pixel meets it at t, and is turned back into the
// photograph's lens. Inside the photograph that is its own pixel. Past its
// edges a tangent plane runs off to infinity as the ray nears 90 degrees from
// its axis, and the wide lens sees well past that: so out there the pixel is
// carried on from the edge by the ray's angle instead (its angle in the
// x-z and y-z planes past the edge's), matched in value and slope at the
// edge and easing to a slow, steady run, so the sky the photograph never
// held stays a smooth gradient however far the lens looks.
float runOn(float e) { return 0.82 * 0.22 * (1.0 - exp(-e / 0.22)) + 0.18 * e; }
float carry(float a, float c, float n) {
  float f = uLens.x;
  float lo = atan(-c / f), hi = atan((n - c) / f);
  if (a < lo) return c + f * tan(lo) - f / (cos(lo) * cos(lo)) * runOn(lo - a);
  if (a > hi) return c + f * tan(hi) + f / (cos(hi) * cos(hi)) * runOn(a - hi);
  return c + f * tan(a);
}
vec2 toPhoto(vec2 q) {
  float K = uOut.y;
  vec3 w = vec3((q - vec2(uLens.y, uOut.x)) / uLens.w, 1.0 + K);
  float ww = dot(w, w);
  float t = (K * (1.0 + K) + sqrt(K * K * (1.0 + K) * (1.0 + K) - ww * (K * K - 1.0))) / ww;
  vec3 d = transpose(uR) * (vec3(0.0, 0.0, -K) + t * w);
  return vec2(carry(atan(d.x, d.z), uLens.y, uSize.x), carry(atan(d.y, d.z), uLens.z, uSize.y));
}`;

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

const VERT_FULL = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const SRGB = `
vec3 encode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}`;

// Lens veil: flare scattered in the lens, over the sky and the cloth alike, in
// proportion to how much of the disc the cloth leaves in view. Behind the
// dress the sun is a soft patch of lit fabric, and its veil is the small one:
// a pale cyan lobe about a third of the frame across and a tighter, whiter
// one. Uncovered, it is the sun itself, and the veil is the lens's: a warm
// lobe about the disc, a little wider than the dress's shoulders, with only a
// short, faint skirt. It never lifts the frame: a flat lift across the sky
// greys the cobalt to milk and takes the cloth's contrast with it. The
// exposure pulling down (ADAPT) is what the open sun does to the rest of the
// frame, so the sky deepens while the disc blooms.
const SUN_GLSL = `
uniform vec2 uSun;    // image px
uniform float uGlare; // the disc in view, the dress counting for a little
uniform float uOpen;  // the share of the disc in clear view
vec3 veil(vec2 p) {
  vec2 d = p - uSun;
  float r2 = dot(d, d);
  vec3 soft = vec3(0.13, 0.25, 0.29) * exp(-r2 / (240.0 * 240.0)) + vec3(0.06, 0.08, 0.075) * exp(-r2 / (64.0 * 64.0));
  vec3 lens = vec3(0.34, 0.27, 0.18) * (exp(-r2 / (180.0 * 180.0)) + 0.08 / (1.0 + r2 / (120.0 * 120.0)));
  return uGlare * mix(soft, lens, uOpen);
}`;

const PLATE_F = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uPlate;
uniform sampler2D uBlur;
uniform vec2 uSize;
${LENS_GLSL}
uniform vec3 uSkyQ[6]; // the sky's quadratic, log linear rgb, per basis term
uniform vec3 uHalo[${HALO.length / 3}];
${SUN_GLSL}
${SRGB}
const int NH = ${HALO.length / 3 - 1};
vec3 haloAt(float r) {
  float f = clamp(r / ${HALO_STEP.toFixed(1)} - 0.5, 0.0, float(NH));
  int i = int(f);
  return mix(uHalo[i], uHalo[min(i + 1, NH)], f - float(i));
}
// The sky's smooth fit, carried past the frame. Above the top its luminance
// deepens on toward the zenith, eased to a hold a fifth of the frame up;
// past the sides and the foot it holds at the edge.
float ease(float x, float lo, float hi, float k) {
  if (x < lo) return lo - k * (1.0 - exp((x - lo) / k));
  if (x > hi) return hi + k * (1.0 - exp(-(x - hi) / k));
  return x;
}
vec2 skyN(vec2 p) {
  vec2 n = p / uSize;
  n.x = ease(n.x, 0.0, 1.0, 0.08);
  n.y = n.y < 0.0 ? ease(n.y, 0.0, 1.0, 0.35) : min(n.y, 1.0);
  return n;
}
vec3 skyLog(vec2 n) {
  return uSkyQ[0] + uSkyQ[1] * n.x + uSkyQ[2] * n.y + uSkyQ[3] * n.x * n.x + uSkyQ[4] * n.y * n.y + uSkyQ[5] * n.x * n.y;
}
vec3 skyFit(vec2 p) { return exp(skyLog(skyN(p))); }
// The zenith. Carried on channel by channel, the fit's green falls off
// faster than its blue, so the sky the tilt adds went navy and purple. So
// the top of the sky is split into value and chroma. Its value (blue, which
// sets it in a sky this deep) deepens from ZEN_Y up at the fit's own rate at
// first, easing to ZEN_A of it, so the zenith is a deep cyan-cobalt that
// still deepens toward the top but never goes navy; going up, the columns
// even out to the middle one's (held under where each started), so the
// corners do not sink either. Its chroma (red and green against blue) blends
// from the fit's toward a fixed zenith's, cobalt with a touch of cyan. It is a gain on the sky, photograph and fit alike, 1 below ZEN_Y and
// continuous in value and slope there, so there is no seam at the old edge,
// and the grain and the photograph's own variation carry through it.
const float ZEN_Y = 0.32;
const float ZEN_A = 0.4;
const float ZEN_D = 0.3;
const vec3 ZEN = vec3(-3.1, -0.994, 0.0); // log r/b, g/b, b/b: about sRGB 8, 62, 124
float zenB(float x, float y) {
  float l1 = skyLog(vec2(x, ZEN_Y)).b;
  float d = skyLog(vec2(x, y)).b - l1;
  return l1 + d * mix(ZEN_A, 1.0, exp(d / ZEN_D));
}
vec3 zenith(vec2 p) {
  vec2 n = skyN(p);
  if (n.y >= ZEN_Y) return vec3(1.0);
  vec3 l = skyLog(n);
  float s = smoothstep(ZEN_Y, -0.3, n.y); // slow enough that the lift never outruns the deepening
  // the darker columns at the sides are lifted toward the middle's, but
  // held under where they started, deepening by a share of the middle's
  // drop, so they too only ever deepen going up
  float drop = zenB(0.5, n.y) - skyLog(vec2(0.5, ZEN_Y)).b;
  float b = min(mix(zenB(n.x, n.y), zenB(0.5, n.y), s), skyLog(vec2(n.x, ZEN_Y)).b + 0.2 * drop);
  return exp(b + mix(l - l.b, ZEN, s) - l);
}
// The plate, and past its edge the fit, carried on as the fit times the
// plate's mean departure from it along the top (as a ratio, so there is no
// seam), and the plate's grain mirrored back out.
vec3 edgeRatio(vec2 pc) {
  vec3 at = texture(uBlur, pc / uSize).rgb;
  vec3 fit = skyFit(pc) + haloAt(distance(pc, uSun));
  return log(max(at, 1e-4) / max(fit, 1e-4));
}
float fallOff(vec2 p) { return exp(-min(min(p.x, uSize.x - p.x), p.y) / 200.0); }
vec3 plateAt(vec2 p, float r) {
  vec2 lo = vec2(0.5);
  vec2 hi = uSize - 0.5;
  // one ratio for the whole far sky, the mean along the photograph's top
  vec3 mean = vec3(0.0);
  for (int k = 0; k <= 8; k++) mean += edgeRatio(vec2(lo.x + (hi.x - lo.x) * float(k) / 8.0, lo.y));
  mean /= 9.0;
  if (p.x >= lo.x && p.y >= lo.y && p.x <= hi.x && p.y <= hi.y) {
    // The photograph's own lens darkens its top corners and sides. Its edges
    // used to be the frame's; the wide lens shows them mid-sky, where that
    // fall-off would read as a dark shelf. So near its top and sides the
    // plate's departure from the fit eases to the far sky's, over 200 px.
    return texture(uPlate, p / uSize).rgb * exp((mean - edgeRatio(p)) * fallOff(p));
  }
  vec2 pc = clamp(p, lo, hi);
  // matched to the plate as eased at the foot; the top and sides already
  // meet the mean
  float w = p.y > hi.y ? exp(-distance(p, pc) / 220.0) : 0.0;
  vec3 foot = mix(edgeRatio(pc), mean, fallOff(pc));
  vec3 sky = skyFit(p) * exp(mix(mean, foot, w)) + haloAt(r);
  // mirrored back and forth, so far out it is still grain, not a smear of
  // one edge row; kept off the disc and its ring wherever it lands
  vec2 pm = clamp(uSize - abs(mod(p, 2.0 * uSize) - uSize), lo, hi);
  vec3 bm = texture(uBlur, pm / uSize).rgb;
  vec3 grain = (texture(uPlate, pm / uSize).rgb - bm) * smoothstep(120.0, 260.0, distance(pm, uSun));
  return max(sky + grain * sky / max(bm, 1e-3), 0.0);
}
void main() {
  vec2 q = vec2(vUv.x, 1.0 - vUv.y) * uSize;
  vec2 p = toPhoto(q);
  float r = distance(p, uSun);
  vec3 h = haloAt(r);
  // the sky with the photograph's grey veil lifted off
  vec3 c = max(plateAt(p, r) - h, 0.0) * zenith(p);
  // the aureole put back: the same falloff, pale cyan, eased off close in so
  // the disc stands out of it; in clear view it stays cyan, only a touch paler
  c += h.g * mix(mix(0.45, 0.2, uOpen), 1.0, smoothstep(24.0, 360.0, r)) * mix(vec3(0.5, 1.0, 1.1), vec3(0.62, 0.97, 1.04), uOpen);
  // the disc: warm-neutral, rolling off through a hot shoulder. Seen through
  // the dress it is a hard dot about 15 px across; in clear view it is the
  // sun, blown out to about 40 px and still falling away, never a flat plate.
  // A thin warm ring at its foot, where the sky is too bright for the film's
  // own halation to show.
  float core = mix(15.0, 24.0, uOpen);
  c += mix(vec3(1.0, 0.93, 0.8), vec3(1.0, 0.95, 0.86), uOpen) * (2.4 + 5.0 * uOpen) * exp(-r * r / (core * core));
  c += vec3(1.0, 0.8, 0.6) * 1.1 / (1.0 + r * r / (20.0 * 20.0));
  c += vec3(1.0, 0.95, 0.86) * 0.6 * uOpen / (1.0 + r * r / (40.0 * 40.0));
  float ring = (r - mix(30.0, 72.0, uOpen)) / mix(7.0, 20.0, uOpen);
  float wr = exp(-ring * ring);
  c = mix(c, c * vec3(1.0, 0.84, 0.7) + vec3(0.1, 0.035, 0.0), mix(0.75, 0.35, uOpen) * wr);
  c += veil(p);
  o = vec4(encode(c), 1.0);
}`;

const BLIT_F = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uTex;
uniform sampler2D uScene; // the scene before the film
uniform vec2 uSunUv;  // the disc, in the print's uv
uniform vec2 uRes;    // the print, device px
uniform float uScale; // device px per image px
uniform float uBlow;  // 0 for the raw view
uniform float uOpen;  // the disc in clear view: the blown core is wider
// The negative's shoulder: the disc is a hundred thousand times the sky, so
// whatever the grade leaves near white at the sun goes to paper white, warm.
// In clear view the exposure pulls down most of a stop, which would print the
// disc a flat grey: so where the scene itself ran past white, it is still
// the sun, and goes to paper white whatever the exposure, through a warm-
// neutral shoulder at its edge.
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  float d = length((vUv - uSunUv) * uRes) / uScale;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float blow = smoothstep(0.76, 0.97, l) * (1.0 - smoothstep(20.0, 40.0, d));
  // the sun's own shoulder: white to about 40 px, then a long fall, held
  // back wherever the scene there is not bright (cloth across it)
  float sl = dot(texture(uScene, vUv).rgb, vec3(0.2126, 0.7152, 0.0722));
  float x = max(d - 34.0, 0.0) / 48.0;
  float sun = smoothstep(0.55, 0.97, sl) / (1.0 + x * x);
  blow = max(blow, uOpen * sun) * uBlow;
  vec3 hot = mix(vec3(1.0, 0.95, 0.86), vec3(1.0, 0.982, 0.95), smoothstep(0.75, 1.0, blow));
  o = vec4(mix(c, hot, blow), 1.0);
}`;

// Cloth and rope: drawn where they are now, textured from where they were.
const CLOTH_V = `#version 300 es
in vec2 aPos;
in vec2 aRest;
in vec3 aShade;
in vec3 aStrain;
in vec3 aRay; // from the eye to the vertex, in the photograph's camera's axes
uniform vec2 uSize;
${LENS_GLSL}
out vec2 vRest;
out vec2 vPos;
out vec3 vShade;
out vec3 vStrain;
void main() {
  vRest = aRest;
  vPos = aPos;
  vShade = aShade;
  vStrain = aStrain;
  // each vertex by full perspective from the eye, through the same
  // stereographic lens as the sky; a cell is small enough (30 px of the
  // photograph) that the map is near affine across it
  vec2 h = rayToFrame(aRay);
  gl_Position = vec4(h.x / uSize.x * 2.0 - 1.0, 1.0 - h.y / uSize.y * 2.0, 0.0, 1.0);
}`;

const CLOTH_F = `#version 300 es
precision highp float;
in vec2 vRest;
in vec2 vPos;
in vec3 vShade; // light, how far from rest, view cosine against the photograph's
in vec3 vStrain; // J^T J of the photograph-to-frame map: xx, xy, yy (1, 0, 1 at rest)
out vec4 o;
uniform sampler2D uLayers;
uniform sampler2D uIds;
uniform sampler2D uBlur;
uniform vec2 uSize;
uniform float uId;
uniform vec3 uTau;
uniform vec2 uBand; // mirror width past the left and right frame edge, 0 = not cut there
uniform float uRim;  // how strongly this garment's edge catches the sun
uniform float uEdge; // the thin warm rim on a garment's clean edge, 0 for the rope
uniform int uPass;   // 0 the cloth, 1 the second layer of a sheer fold, multiplied in
uniform vec4 uTie;   // a strip whose square-cut matte is rounded, in photograph px
uniform vec4 uRope;  // the line's curve (a, b, c of y = a x^2 + b x + c), and 1 for the rope
uniform vec3 uRopeX; // past these the line is read from a clear stretch: left end, right end, the clear stretch's right end
${SUN_GLSL}
${SRGB}
const float INSET = 6.0; // the matte softens in the last pixels at the frame
const float SHEAR = 0.8; // px of drop per px past the edge, for the print only
float tri(float d, float b) { return b - abs(mod(d, 2.0 * b) - b); }
float ropeY(float x) { return (uRope.x * x + uRope.y) * x + uRope.z; }
float idAt(vec2 s) { return texelFetch(uIds, clamp(ivec2(s), ivec2(0), ivec2(uSize) - 1), 0).r * 255.0; }
float alphaAt(vec2 s) { return abs(idAt(s) - uId) < 0.5 ? texture(uLayers, s / uSize).a : 0.0; }
// A sheer fabric's light through k times the photograph's thickness: its own
// colour f, the blurred sky B behind it, and dye, the hue the single layer
// has in the photograph. Thicker, the fabric's light takes on that hue (the
// rose of the dress against the sky, not the peach of its threads) and is
// filtered by it again, and dims.
vec3 fabric(vec3 f, vec3 B, vec3 dye, float k) {
  vec3 t = uTau * pow(max(uTau, 1e-4), vec3(k - 1.0));
  float th = clamp(k, 1.0, 5.0);
  vec3 W = vec3(0.2126, 0.7152, 0.0722);
  vec3 fh = mix(f, dye * dot(f, W) / max(dot(dye, W), 1e-4), 1.0 - 1.0 / th);
  return (fh * pow(dye, vec3(0.8 * (th - 1.0))) + t * B) * (1.0 - 0.4 * (1.0 - 1.0 / th)) + 0.35 * (uTau - t) * B;
}
// Folds, per pixel. The cloth grid is coarse (a cell is 30 px of the
// photograph), and its own normals light it smoothly across a cell: a skirt
// gathered by the wind would read as its print squeezed. So the gradient of
// the drawn displacement (J = I + dD/drest, smoothed per vertex, as its
// metric J^T J) says where the cloth is drawn in, along which axis, and by
// how much; the length it has lost there has gone into folds across that
// axis, at the scale of fabric (FOLD px of the photograph), and their slope
// is what shades them. They meander along their length, and they are only
// there where the cloth has moved. Returns the folds' slope (signed), its
// amplitude, how deep in a trough this pixel is, and the slope's lean
// toward the sun (sd, the frame's direction to it).
const float FOLD = 34.0;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
vec4 folds(vec2 r, vec2 sd) {
  float a = vStrain.x, b = vStrain.y, c = vStrain.z;
  float h = 0.5 * (a + c), q = sqrt(max(0.25 * (a - c) * (a - c) + b * b, 0.0));
  float lmin = max(h - q, 1e-4);
  // the axis it is drawn in along, in the photograph, with a fixed sign;
  // drawn in about evenly, the axis means nothing, and the folds hang
  // (across X) as cloth's do
  vec2 e = abs(b) > 1e-5 ? normalize(vec2(b, lmin - a)) : (a < c ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  if (e.x + 0.4 * e.y < 0.0) e = -e;
  e = normalize(mix(vec2(1.0, 0.0), e, smoothstep(0.06, 0.3, q / max(h, 1e-4))));
  // turning edge-on to the lens draws the cloth in too, without folding it:
  // the view cosine (against the photograph's) accounts for that much
  float s = sqrt(lmin) / clamp(vShade.z, 0.3, 1.0);
  float amt = smoothstep(0.97, 0.75, s) * vShade.y;
  if (amt < 0.002) return vec4(0.0);
  vec2 along = vec2(-e.y, e.x);
  float wob = vnoise(vec2(dot(r, along) / 110.0, dot(r, e) / 140.0)) + 0.35 * vnoise(vec2(dot(r, along) / 55.0, dot(r, e) / 80.0) + 7.3);
  float ph = 6.2832 * (dot(r, e) / FOLD + 0.55 * wob);
  // the slope a sinusoid needs to take up 1/s of length in 1
  float m = min(2.2 * sqrt(max(1.0 / s - 1.0, 0.0)), 1.5) * amt;
  float g = m * cos(ph);
  return vec4(g, m, 0.5 - 0.5 * sin(ph), g * dot(e, sd));
}
// The matte's mean over a disc; cut at a half, its corners are rounded. A
// straight edge stays where it is; a corner, where less than half the disc
// is inside, pulls in to an arc of about the disc's radius.
float discMean(vec2 s, float r) {
  float m = 0.0;
  for (int i = 0; i < 12; i++) {
    float t = float(i) * 0.5236;
    vec2 d = vec2(cos(t), sin(t));
    m += alphaAt(s + d * r) + alphaAt(s + d * r * 0.5);
  }
  return m / 24.0;
}
void main() {
  // Cloth the frame cut off has no pixels of its own: it is textured from
  // the band just inside the edge, mirrored back and forth, matte included,
  // so a garment swinging inward carries on past where the photograph ended.
  // The silhouette is the plain mirror (the hem carries on as a hem); the
  // print is read from a sheared mirror, so it does not fold into a
  // symmetric blot about the frame line.
  vec2 s = vRest;
  if (uRope.w > 0.0) {
    // The tilted lens sees the line run on past both ends of the photograph:
    // past them it is read from a clear stretch of it, carried along its curve.
    float nx = s.x;
    if (s.x < uRopeX.x) nx = uRopeX.x + tri(uRopeX.x - s.x, 48.0);
    else if (s.x > uRopeX.y) nx = uRopeX.z - tri(s.x - uRopeX.y, 48.0);
    s = vec2(nx, s.y + ropeY(nx) - ropeY(s.x));
  }
  float lo = INSET, hi = uSize.x - INSET;
  float d = 0.0;
  if (uBand.x > 0.0 && s.x < lo) { d = lo - s.x; s.x = lo + tri(d, uBand.x); }
  else if (uBand.y > 0.0 && s.x > hi) { d = s.x - hi; s.x = hi - tri(d, uBand.y); }
  if (s.x < 0.5 || s.y < 0.5 || s.x > uSize.x - 0.5 || s.y > uSize.y - 0.5) discard;
  float id = idAt(s);
  if (d > 0.0 && abs(id - uId) > 0.5) {
    // the mirror ran into a neighbour on this row: hold the edge column
    s.x = vRest.x < lo ? lo : hi;
    id = idAt(s);
  }
  if (abs(id - uId) > 0.5) discard;
  vec4 L = texture(uLayers, s / uSize);
  if (d > 0.0) {
    vec2 w = vec2(s.x, s.y + SHEAR * d);
    vec4 Lw = texture(uLayers, w / uSize);
    float keep = abs(idAt(w) - uId) < 0.5 ? smoothstep(0.6, 0.95, Lw.a) : 0.0;
    L.rgb = mix(L.rgb, Lw.rgb, keep);
  }
  float edge = 1.0; // the tie's cross-section: 1 at its middle, less to its edges
  if (uTie.z > uTie.x && s.x > uTie.x && s.x < uTie.z && s.y > uTie.y && s.y < uTie.w) {
    // the tie's end widens: round it harder there than up its thin stem
    float m = discMean(s, mix(4.0, 11.0, smoothstep(uTie.y + 60.0, uTie.w - 40.0, s.y)));
    L.a *= mix(1.0, smoothstep(0.3, 0.7, m), vShade.y);
    // and a tie is a strip folded and sewn, not a cut sheet: its edges roll,
    // so they are looked through at a slant even where it faces the lens
    // (both only once it moves: at rest the frame is the photograph)
    edge = mix(1.0, mix(0.45, 1.0, smoothstep(0.5, 0.95, m)), vShade.y);
  }
  if (L.a < 0.002) discard;
  vec3 B = texture(uBlur, clamp(vPos / uSize, 0.0, 1.0)).rgb;
  // Seen at a slant the light crosses more fabric: k = 1/mu times the
  // photograph's. The direct transmission goes as tau^k and the matte closes
  // as 1 - (1 - a)^k. What the fabric stops is not all lost: the fabric's
  // own light passes the dye more times, filtered again by the colour the
  // single layer has in the photograph and dimmed a little, and a share of
  // the sky it no longer lets straight through comes out diffused. A billow
  // turned edge-on goes denser, darker and a deeper rose, not paler.
  // a fold's flanks are seen at a slant, and turn to the sun or from it
  vec4 fd = folds(s, normalize(uSun - vPos + vec2(1e-3)));
  float lean = fd.w;
  float k = sqrt(1.0 + fd.x * fd.x) / max(vShade.z * edge, ${MU_MIN.toFixed(2)});
  bool sheer = uTau.b > 0.0;
  // opaque cloth: the flank toward the sun lit through, the trough shaded;
  // sheer cloth mostly thickens on the flanks (above), and dims a little in
  // the trough
  float shade = sheer ? 1.0 - 0.22 * fd.y * fd.z + 0.12 * lean : 1.0 - 0.34 * fd.y * fd.z + 0.22 * lean;
  vec3 f = L.rgb * vShade.x * max(shade, 0.4);
  vec3 dye = vec3(1.0);
  if (sheer) {
    L.a = 1.0 - pow(1.0 - L.a, max(k, 1.0));
    vec3 one = f + uTau * B;
    dye = one / max(max(one.r, max(one.g, one.b)), 1e-4);
  }
  vec3 col = sheer ? fabric(f, B, dye, k) : f;
  if (uPass == 1) {
    // A fold of the sheer dress, seen through itself: what lies behind this
    // layer is not the sky but the dress again, which the plain pass drew as
    // if the sky were there. Two layers are twice the thickness: the ratio
    // between that and one layer is multiplied in, so the fold reads as a
    // darker, warmer band.
    vec3 one = encode(col);
    vec3 two = encode(fabric(f, B, dye, 2.0 * k));
    vec3 r = clamp(two / max(one, vec3(1e-3)), 0.0, 1.0);
    o = vec4(mix(vec3(1.0), r, L.a), 1.0);
    return;
  }
  vec2 ts = uSun - vPos;
  float ds = length(ts);
  vec2 dir = ts / max(ds, 1.0);
  if (uEdge > 0.0) {
    // The edge's own light. The bake took the photograph's pale ring off
    // every matte (it read as a sticker's border once the cloth moved); what
    // it stood for is the sun behind the line coming through the last fibres.
    // So the pixel or two of edge that faces the sun warms: its own colour
    // pushed toward amber (red up, blue down) with a touch of sunlight, never
    // toward white, more the nearer the sun, wherever the cloth is now.
    float thin = clamp(L.a - 0.5 * (alphaAt(s + dir * 1.5) + alphaAt(s + dir * 3.0)), 0.0, 1.0);
    float w = thin * uEdge * (0.45 + 1.2 * exp(-ds / 420.0));
    col = max(col + w * (col * vec3(0.5, 0.08, -0.3) + vec3(0.03, 0.011, 0.0)), 0.0);
  }
  if (uRim * uOpen > 0.0) {
    // Rim: the edge that faces the sun, where the matte falls away towards
    // it, catches the light coming round it; strongest close to the disc.
    float edge = clamp(L.a - 0.5 * (alphaAt(s + dir * 3.0) + alphaAt(s + dir * 9.0)), 0.0, 1.0);
    col += vec3(1.0, 0.84, 0.62) * edge * exp(-ds / 380.0) * uOpen * uRim;
  }
  col += veil(vPos);
  o = vec4(encode(col) * L.a, L.a);
}`;

function compile(gl, vs, fs, attribs) {
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
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

async function bitmap(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  return createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function upload(gl, bm, { srgb = true, nearest = false, mips = false } = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const levels = mips ? Math.floor(Math.log2(Math.max(bm.width, bm.height))) + 1 : 1;
  gl.texStorage2D(gl.TEXTURE_2D, levels, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, bm.width, bm.height);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bm);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  const f = nearest ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function target(gl, w, h, { stencil = false } = {}) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  let rb = null;
  if (stencil) {
    rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, rb);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, rb, w, h };
}

export async function createSentaku(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const num = (k, d) => {
    const v = q.get(k);
    return v != null && v !== "" && Number.isFinite(+v) ? +v : d;
  };
  const holdGust = q.get("gust") != null ? clamp(num("gust", 0.7), 0, 1) : null;
  const still = q.get("still") != null;
  const rawView = q.get("raw") != null; // the scene before the film, for checking
  const held = holdGust != null || still;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const tiltTo = clamp(num("tilt", TILT), -10, 60);
  const widenTo = clamp(num("widen", WIDEN), 0.6, 3);
  const oyTo = num("oy", LENS_OY);
  const film0 = { ...FILM };
  for (const key of Object.keys(FILM)) if (typeof FILM[key] === "number") film0[key] = num(key, FILM[key]);

  host.style.background = `rgb(${PAPER.join(",")})`;
  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");

  const [meta, plateBm, layersBm, idsBm, blurBm] = await Promise.all([
    fetch(`${ASSET}meta.json`).then((r) => r.json()),
    bitmap(`${ASSET}plate.webp`),
    bitmap(`${ASSET}layers.webp`),
    bitmap(`${ASSET}ids.png`),
    bitmap(`${ASSET}plate-blur.webp`),
  ]);
  const [IW, IH] = meta.size;
  const ASPECT = IW / IH;
  const plateTex = upload(gl, plateBm, { mips: true });
  const layersTex = upload(gl, layersBm, { mips: true });
  const idsTex = upload(gl, idsBm, { srgb: false, nearest: true });
  const blurTex = upload(gl, blurBm);
  // ids on the CPU too, to size each frame-cut garment's mirror band
  const idPx = (() => {
    const c = new OffscreenCanvas(IW, IH);
    const x2 = c.getContext("2d", { willReadFrequently: true });
    x2.drawImage(idsBm, 0, 0);
    return x2.getImageData(0, 0, IW, IH).data;
  })();
  for (const b of [plateBm, layersBm, idsBm, blurBm]) b.close?.();

  const cloth = createCloth(meta);
  // The widest band inside a cut edge that is the garment's own on (nearly)
  // every row it meets the frame: the phantom cloth mirrors it.
  const bandOf = (id, right) => {
    const e = right ? IW - 3 : 2;
    const rows = [];
    for (let y = 0; y < IH; y++) if (idPx[(y * IW + e) * 4] === id) rows.push(y);
    if (!rows.length) return 0;
    for (let B = 120; B >= 12; B -= 6) {
      let bad = 0;
      for (const y of rows) {
        for (let d = 6; d <= 6 + B; d += 2) {
          const xx = right ? IW - 1 - d : d;
          if (idPx[(y * IW + xx) * 4] !== id) {
            bad++;
            break;
          }
        }
      }
      if (bad <= rows.length * 0.02) return B;
    }
    return 12;
  };
  cloth.settle(2.5);
  const { N, rest, x, x0, nrm, nrm0, mu, mu0, gid, garments } = cloth;
  // each vertex's grid neighbours (left, right, up, down; itself where the
  // cloth ends), for the drawn map's gradient
  const nbr = new Int32Array(N * 4);
  for (const gm of garments) {
    const { nx, ny, vid } = gm.plan;
    const at = (i, j) => (i < 0 || j < 0 || i > nx || j > ny ? -1 : vid[j * (nx + 1) + i]);
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        const k = at(i, j);
        if (k < 0) continue;
        const n4 = [at(i - 1, j), at(i + 1, j), at(i, j - 1), at(i, j + 1)];
        for (let m = 0; m < 4; m++) nbr[k * 4 + m] = n4[m] < 0 ? k : n4[m];
      }
  }
  const ropeY = (u) => meta.rope.poly[0] * u * u + meta.rope.poly[1] * u + meta.rope.poly[2];

  // ---- GL
  const plateP = compile(gl, VERT_FULL, PLATE_F, ["aPos"]);
  const blitP = compile(gl, VERT_FULL, BLIT_F, ["aPos"]);
  const clothP = compile(gl, CLOTH_V, CLOTH_F, ["aPos", "aRest", "aShade", "aStrain", "aRay"]);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // cloth: one dynamic buffer [pos.xy, rest.xy, shade.xyz] per vertex: the
  // light, how far it has moved, and the view cosine against the rest's
  const ROPE_STEP = 12;
  // the line runs on well past the photograph's ends, for the tilted lens
  const ropeU0 = -2400;
  const ropeN = Math.ceil((IW + 4800) / ROPE_STEP) + 1;
  const NV = N + ropeN * 2;
  const vdata = new Float32Array(NV * VS);
  for (let k = 0; k < N; k++) {
    vdata[k * VS + 2] = rest[k * 2];
    vdata[k * VS + 3] = rest[k * 2 + 1];
    vdata[k * VS + 4] = 1;
    vdata[k * VS + 5] = 0;
    vdata[k * VS + 6] = 1;
    vdata[k * VS + 7] = 1;
    vdata[k * VS + 9] = 1;
  }
  const ropeRest = [];
  for (let i = 0; i < ropeN; i++) {
    const u = ropeU0 + i * ROPE_STEP;
    const y = ropeY(u);
    for (const [s, dv] of [
      [0, -16],
      [1, 32],
    ]) {
      const k = N + i * 2 + s;
      vdata[k * VS + 2] = u;
      vdata[k * VS + 3] = y + dv;
      vdata[k * VS + 4] = 1;
      vdata[k * VS + 5] = 0;
      vdata[k * VS + 6] = 1;
      vdata[k * VS + 7] = 1;
      vdata[k * VS + 9] = 1;
      ropeRest.push(u);
    }
  }
  const idx = [];
  const ranges = [];
  for (const gm of garments) {
    const start = idx.length;
    for (let t = 0; t < cloth.nT; t++) {
      const a = cloth.tris[t * 4] | 0;
      if (gid[a] !== gm.id) continue;
      idx.push(a, cloth.tris[t * 4 + 1] | 0, cloth.tris[t * 4 + 2] | 0);
    }
    const band = [gm.plan.padL ? bandOf(gm.id, false) : 0, gm.plan.padR ? bandOf(gm.id, true) : 0];
    ranges.push({ id: gm.id, start, count: idx.length - start, tau: gm.tau, band, sheer: Math.max(...gm.tau) > 0 });
  }
  {
    const start = idx.length;
    for (let i = 0; i < ropeN - 1; i++) {
      const a = N + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    ranges.push({ id: 6, start, count: idx.length - start, tau: [0, 0, 0], band: [0, 0], sheer: false });
  }
  const vbuf = gl.createBuffer();
  const ibuf = gl.createBuffer();
  const clothVao = gl.createVertexArray();
  gl.bindVertexArray(clothVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
  gl.bufferData(gl.ARRAY_BUFFER, vdata.byteLength, gl.DYNAMIC_DRAW);
  for (let i = 0; i < 3; i++) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, i < 2 ? 2 : 3, gl.FLOAT, false, VS * 4, i * 8);
  }
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 3, gl.FLOAT, false, VS * 4, 7 * 4);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 3, gl.FLOAT, false, VS * 4, 10 * 4);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  // per-garment light: ambient sky, sun reflected off the front, sun through
  const lightOf = (gm) => (Math.max(...gm.tau) > 0 ? { ka: 0.35, kr: 0.5, kt: 1.0 } : { ka: 0.6, kr: 0.95, kt: 0.3 });
  const lightById = new Map(garments.map((g) => [g.id, lightOf(g)]));
  const lit = (L, nx, ny, nz) => {
    const ns = nx * SUN[0] + ny * SUN[1] + nz * SUN[2];
    return L.ka * (0.62 + 0.38 * ny) + L.kr * Math.max(0, ns) + L.kt * Math.max(0, -ns);
  };

  // ---- the sun in view: sample the disc against the cloth where it is now
  const sunPx = meta.sun;
  const discPts = [];
  for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) if (i * i + j * j <= 10) discPts.push([sunPx[0] + (i * DISC) / 3, sunPx[1] + (j * DISC) / 3]);
  const clothTris = idx.length - (ropeN - 1) * 6; // the rope is last, and ignored
  const discT = new Float32Array(discPts.length);
  let open = 0; // share of the disc no cloth covers
  let glare = 0; // the same, the dress letting DRESS_T through
  const coverage = () => {
    const bx0 = sunPx[0] - DISC - 1;
    const bx1 = sunPx[0] + DISC + 1;
    const by0 = sunPx[1] - DISC - 1;
    const by1 = sunPx[1] + DISC + 1;
    discT.fill(1);
    for (let t = 0; t < clothTris; t += 3) {
      const a = idx[t] * VS;
      const b = idx[t + 1] * VS;
      const c = idx[t + 2] * VS;
      const ax = vdata[a], ay = vdata[a + 1], bx = vdata[b], by = vdata[b + 1], cx = vdata[c], cy = vdata[c + 1];
      if (Math.max(ax, bx, cx) < bx0 || Math.min(ax, bx, cx) > bx1 || Math.max(ay, by, cy) < by0 || Math.min(ay, by, cy) > by1) continue;
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-6) continue;
      const id = gid[idx[t]];
      for (let p = 0; p < discPts.length; p++) {
        const [px, py] = discPts[p];
        const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den;
        const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        // where on the photograph this point of cloth came from: is it the
        // garment's own matte there, or the empty corner of a grid cell?
        const ru = Math.round(w0 * vdata[a + 2] + w1 * vdata[b + 2] + w2 * vdata[c + 2]);
        const rv = Math.round(w0 * vdata[a + 3] + w1 * vdata[b + 3] + w2 * vdata[c + 3]);
        if (ru < 0 || rv < 0 || ru >= IW || rv >= IH || idPx[(rv * IW + ru) * 4] !== id) continue;
        // the dress lets less through where it is seen at a slant
        const m = Math.max(MU_MIN, w0 * vdata[a + 6] + w1 * vdata[b + 6] + w2 * vdata[c + 6]);
        discT[p] = Math.min(discT[p], id === 3 ? Math.pow(DRESS_T, 1 / m) : 0);
      }
    }
    let o = 0;
    let g = 0;
    for (const v of discT) {
      o += v === 1 ? 1 : 0;
      g += v;
    }
    open = o / discT.length;
    glare = g / discT.length;
  };
  // The exposure adapts to the disc on a spring, a beat behind the flare.
  let adapt = 0;
  let adaptV = 0;
  const stepAdapt = (dt) => {
    const w = 4.5;
    const z = 0.72;
    const n = Math.max(1, Math.ceil(dt * 60));
    for (let i = 0; i < n; i++) {
      adaptV += (w * w * (-ADAPT * open - adapt) - 2 * z * w * adaptV) * (dt / n);
      adapt += adaptV * (dt / n);
    }
  };

  // ---- the wind
  const HIST = 240;
  const histA = new Float32Array(HIST);
  const histD = new Float32Array(HIST);
  let histI = 0;
  let simT = 0;
  let gustA = 0;
  let gustDir = 1;
  let breezeOn = held ? 1 : 0;
  const Xmax = IW / PX;
  const windFn = (X, Y, t, out, o) => {
    // the breeze, travelling down the line
    const tb = simT - X / FRONT;
    let b = 0.5 + 0.3 * Math.sin(0.37 * tb) + 0.22 * Math.sin(0.83 * tb + 1.3) + 0.12 * Math.sin(1.9 * tb + 0.4);
    b = Math.max(0.08, b) * BREEZE * breezeOn * (reduced ? 0.4 : 1) * (still ? 0 : 1);
    const bx = 0.32 * Math.sin(0.11 * simT + 0.6);
    // the gust, as it was when its front left the near end
    const dirNow = histD[(histI - 1 + HIST) % HIST] || 1;
    const delay = dirNow >= 0 ? X / FRONT : (Xmax - X) / FRONT;
    const back = Math.min(HIST - 1, Math.round(delay * 60));
    const hi = (histI - 1 - back + HIST * 2) % HIST;
    const A = histA[hi] * GUST_MAX;
    const D = histD[hi] || 1;
    // turbulence: eddies carried along with the air
    const tt = simT * (1.6 + 0.5 * A);
    const amp = 0.28 * b + 0.32 * A;
    const e1 = Math.sin(3.1 * X + 1.7 * Y - 2.3 * tt + 0.7) * Math.sin(2.3 * Y - 1.3 * X + 1.9 * tt);
    const e2 = Math.sin(2.7 * X - 2.1 * Y + 2.9 * tt + 2.1) * Math.sin(1.1 * Y + 3.3 * X - 1.4 * tt + 0.3);
    const e3 = Math.sin(4.3 * X + 2.9 * Y - 3.7 * tt + 1.1);
    out[o] = b * bx + A * 0.62 * D + amp * e2;
    out[o + 1] = A * 0.06 + amp * 0.5 * e3;
    out[o + 2] = b + A * 0.78 + amp * e1;
    void t;
  };
  const pushGust = (A, D) => {
    histA[histI] = A;
    histD[histI] = D;
    histI = (histI + 1) % HIST;
  };

  // ---- layout: one print, centred on the paper
  let scene = null;
  let developed = null;
  let rect = { x: 0, y: 0, w: 1, h: 1 };
  const film = createFilm(gl, { width: 1, height: 1 });
  const build = () => {
    const W = stage.canvas.width;
    const H = stage.canvas.height;
    const d = stage.dpr;
    const side = Math.max(16 * d, W * 0.06);
    let h = Math.min(H * 0.86, (W - 2 * side) / ASPECT);
    let w = Math.round(h * ASPECT);
    h = Math.round(h);
    w = Math.max(2, w);
    h = Math.max(2, h);
    rect = { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h };
    for (const t of [scene, developed]) {
      if (!t) continue;
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
      if (t.rb) gl.deleteRenderbuffer(t.rb);
    }
    scene = target(gl, w, h, { stencil: true });
    developed = target(gl, w, h);
    film.resize(w, h);
    dirty = true;
  };
  let dirty = true;

  // ---- the view: the tilt, 0 the photograph's own and 1 the tilted lens's
  let tiltP = held || reduced ? (still ? 0 : 1) : 0;
  let tiltV = 0;
  const skyQ = new Float32Array(18);
  for (let k = 0; k < 6; k++) for (let c = 0; c < 3; c++) skyQ[k * 3 + c] = meta.sky.quad[c][k];
  // The dress's hang, from the line to its hem, in metres: the eye drops by a
  // share of it.
  const dressG = meta.garments.find((g) => g.name === "dress") ?? meta.garments[0];
  const HANG = (dressG.bbox[3] - ropeY((dressG.bbox[0] + dressG.bbox[2]) / 2)) / PX;
  const eyeTo = [0, num("drop", EYE_DROP) * HANG, num("fwd", EYE_FWD) * Z0];
  // the framing (lens, centre and eye) goes with the angle, so ?tilt=0 is the
  // photograph, seen from where it was taken
  const viewNow = () => {
    const k = (tiltP * tiltTo) / TILT;
    const view = viewOf(tiltTo * tiltP, 1 + (widenTo - 1) * k, LENS_C[1] + (oyTo - LENS_C[1]) * k, k);
    view.eye = eyeTo.map((e) => e * clamp(k, 0, 1.5));
    return view;
  };
  const stepTilt = (dt, age) => {
    const n = Math.max(1, Math.ceil(dt * 120));
    const goal = age > TILT_AT ? 1 : 0;
    for (let i = 0; i < n; i++) {
      tiltV += (TILT_W * TILT_W * (goal - tiltP) - 2 * TILT_Z * TILT_W * tiltV) * (dt / n);
      tiltP += tiltV * (dt / n);
    }
  };

  // ---- per frame: positions, light, draw
  // Each vertex is placed in the photograph's camera's frame (x across, y
  // down its frame, which is the garments' hang and the world's gravity, z
  // along its axis): its rest is its pixel on the photograph's plane, Z0 out,
  // and the cloth's displacement is added in metres (drift()). It is drawn by
  // full perspective from the eye: the ray to it goes to the lens (aRay),
  // and where that ray meets the photograph's image plane is its place in the
  // photograph's px (aPos), the frame the sky, the sun and the disc's
  // coverage live in, since the sky is at infinity and the same from any eye.
  const dv3 = [0, 0, 0];
  const disp = [0, 0, 0];
  // where each vertex is as the photograph's own eye sees it: the cloth's
  // folds are read off this (below), as they were tuned on it
  const seen = new Float32Array(N * 2);
  const toPhotoPx = (X, Y, Z, out, o) => {
    const z = Math.max(Z, 0.05 * Math.hypot(X, Y, Z));
    out[o] = LENS_C[0] + (LENS_F * X) / z;
    out[o + 1] = LENS_C[1] + (LENS_F * Y) / z;
  };
  // The line's plane is not square to the photograph's lens: it turns about
  // the vertical through the lens's axis by YAW, so the line recedes toward
  // one end. Each pixel stays on its own ray, at the depth where that ray
  // meets the turned plane, and the cloth's motion there is scaled with it,
  // so the photograph's eye still sees exactly the photograph.
  const yawK = Math.tan((num("yaw", YAW) * Math.PI) / 180);
  const place = (u0, v0, dx, dy, dz, view, o, so) => {
    const { eye } = view;
    const rx = (u0 - LENS_C[0]) / LENS_F;
    const t = Z0 / Math.max(0.25, 1 - rx * yawK); // the plane's depth on this ray
    const m = t / Z0;
    drift(dx, dy, dz, dv3);
    const X = rx * t + m * dv3[0];
    const Y = ((v0 - LENS_C[1]) / LENS_F) * t + m * dv3[1];
    const Z = t * (1 + dv3[2]);
    if (so >= 0) toPhotoPx(X, Y, Z, seen, so);
    const ex = X - eye[0], ey = Y - eye[1], ez = Z - eye[2];
    const l = Math.hypot(ex, ey, ez) || 1;
    vdata[o + 10] = ex / l;
    vdata[o + 11] = ey / l;
    vdata[o + 12] = ez / l;
    toPhotoPx(ex, ey, ez, vdata, o);
  };
  const writeVerts = (view) => {
    cloth.computeNormals();
    for (let k = 0; k < N; k++) {
      const i = k * 3;
      place(rest[k * 2], rest[k * 2 + 1], x[i] - x0[i], x[i + 1] - x0[i + 1], x[i + 2] - x0[i + 2], view, k * VS, k * 2);
      const L = lightById.get(gid[k]);
      const g = lit(L, nrm[i], nrm[i + 1], nrm[i + 2]) / lit(L, nrm0[i], nrm0[i + 1], nrm0[i + 2]);
      vdata[k * VS + 4] = clamp(g, 0.5, 1.8);
      // the view cosine, against the photograph's own: at rest the frame is
      // the photograph, so the slant the dress was shot at is already in its
      // bake. Turning further edge-on thickens it; turning squarer to the
      // lens than it was shot thins it a little, as far as square on.
      // how far it has moved from the photograph, 0 at rest and 1 by 6 cm
      vdata[k * VS + 5] = Math.min(1, Math.hypot(x[i] - x0[i], x[i + 1] - x0[i + 1], x[i + 2] - x0[i + 2]) / 0.06);
      vdata[k * VS + 6] = Math.min(1.18, 1 / Math.max(0.05, mu0[k]), mu[k] / Math.max(0.05, mu0[k]));
    }
    // The gradient of the cloth's map at each vertex, as its metric J^T J,
    // as the photograph's eye sees it (1, 0, 1 at rest). Seen from the moved
    // eye, cloth carried toward or away from it grows or shrinks a lot, and
    // that is perspective, not the cloth gathering into folds; the folds are
    // the cloth's own, and the perspective carries them where it draws it.
    for (let k = 0; k < N; k++) {
      const [l, r, u, d] = [nbr[k * 4], nbr[k * 4 + 1], nbr[k * 4 + 2], nbr[k * 4 + 3]];
      const du = rest[r * 2] - rest[l * 2], dv = rest[d * 2 + 1] - rest[u * 2 + 1];
      let jx0 = 1, jx1 = 0, jy0 = 0, jy1 = 1;
      if (du > 0) {
        jx0 = (seen[r * 2] - seen[l * 2]) / du;
        jx1 = (seen[r * 2 + 1] - seen[l * 2 + 1]) / du;
      }
      if (dv > 0) {
        jy0 = (seen[d * 2] - seen[u * 2]) / dv;
        jy1 = (seen[d * 2 + 1] - seen[u * 2 + 1]) / dv;
      }
      vdata[k * VS + 7] = jx0 * jx0 + jx1 * jx1;
      vdata[k * VS + 8] = jx0 * jy0 + jx1 * jy1;
      vdata[k * VS + 9] = jy0 * jy0 + jy1 * jy1;
    }
    for (let i = 0; i < ropeN * 2; i++) {
      const k = N + i;
      const u = vdata[k * VS + 2];
      const v = vdata[k * VS + 3];
      cloth.ropeDisp(clamp((u - ROPE.left) / (ROPE.right - ROPE.left), 0, 1), disp);
      place(u, v, disp[0], disp[1], disp[2], view, k * VS, -1);
    }
    void ropeRest;
  };

  const drawScene = (view) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, scene.w, scene.h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(plateP.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, plateTex);
    gl.uniform1i(plateP.u.uPlate, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, blurTex);
    gl.uniform1i(plateP.u.uBlur, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniformMatrix3fv(plateP.u.uR, true, view.R);
    gl.uniform4fv(plateP.u.uLens, view.lens);
    gl.uniform2fv(plateP.u.uOut, view.out);
    gl.uniform3fv(plateP.u["uSkyQ[0]"], skyQ);
    gl.uniform2f(plateP.u.uSize, IW, IH);
    gl.uniform2f(plateP.u.uSun, sunPx[0], sunPx[1]);
    gl.uniform1f(plateP.u.uGlare, glare);
    gl.uniform1f(plateP.u.uOpen, open);
    gl.uniform3fv(plateP.u["uHalo[0]"], HALO);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(clothP.p);
    gl.uniform2f(clothP.u.uSize, IW, IH);
    gl.uniformMatrix3fv(clothP.u.uR, true, view.R);
    gl.uniform4fv(clothP.u.uLens, view.lens);
    gl.uniform2fv(clothP.u.uOut, view.out);
    gl.uniform3f(clothP.u.uRopeX, 12, IW + PHANTOM * meta.cell - 20, 1250);
    gl.uniform2f(clothP.u.uSun, sunPx[0], sunPx[1]);
    gl.uniform1f(clothP.u.uGlare, glare);
    gl.uniform1f(clothP.u.uOpen, open);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, layersTex);
    gl.uniform1i(clothP.u.uLayers, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, idsTex);
    gl.uniform1i(clothP.u.uIds, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, blurTex);
    gl.uniform1i(clothP.u.uBlur, 2);
    gl.bindVertexArray(clothVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vdata);
    gl.uniform1i(clothP.u.uPass, 0);
    for (const r of ranges) {
      gl.uniform1f(clothP.u.uId, r.id);
      gl.uniform3f(clothP.u.uTau, r.tau[0], r.tau[1], r.tau[2]);
      gl.uniform2f(clothP.u.uBand, r.band[0], r.band[1]);
      gl.uniform1f(clothP.u.uRim, RIM[r.id] ?? 0);
      gl.uniform1f(clothP.u.uEdge, r.id < 6 ? EDGE_GLOW : 0);
      gl.uniform4f(clothP.u.uRope, meta.rope.poly[0], meta.rope.poly[1], meta.rope.poly[2], r.id === 6 ? 1 : 0);
      if (r.id === 3) gl.uniform4f(clothP.u.uTie, TIE[0], TIE[1], TIE[2], TIE[3]);
      else gl.uniform4f(clothP.u.uTie, 0, 0, 0, 0);
      const draw = () => gl.drawElements(gl.TRIANGLES, r.count, gl.UNSIGNED_INT, r.start * 4);
      if (!r.sheer) {
        draw();
        continue;
      }
      // The sheer dress in two layers. Its triangles keep the photograph's
      // winding (clockwise on screen, GL's back faces) until the cloth folds
      // over: then the flipped part is a second layer lying over the first.
      // The first layer marks the stencil; the flipped one is drawn over it,
      // then drawn again where the two overlap, multiplied in.
      gl.enable(gl.CULL_FACE);
      gl.enable(gl.STENCIL_TEST);
      gl.clear(gl.STENCIL_BUFFER_BIT);
      gl.cullFace(gl.FRONT);
      gl.stencilFunc(gl.ALWAYS, 1, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      draw();
      gl.cullFace(gl.BACK);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      draw();
      // once per pixel: a third layer is rare, and would only darken twice
      gl.stencilFunc(gl.EQUAL, 1, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.ZERO);
      gl.blendFunc(gl.DST_COLOR, gl.ZERO);
      gl.uniform1i(clothP.u.uPass, 1);
      draw();
      gl.uniform1i(clothP.u.uPass, 0);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.STENCIL_TEST);
      gl.disable(gl.CULL_FACE);
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  };

  let born = performance.now();
  let tick = 0;
  const render = (exposure = film0.exposure) => {
    if (!scene) build();
    const view = viewNow();
    writeVerts(view);
    coverage();
    drawScene(view);
    if (!rawView) film.render(scene.tex, { ...film0, exposure: exposure + adapt, grainSeed: tick * 7.31 }, developed.fbo);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(PAPER[0] / 255, PAPER[1] / 255, PAPER[2] / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(rect.x, stage.canvas.height - rect.y - rect.h, rect.w, rect.h);
    gl.useProgram(blitP.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, rawView ? scene.tex : developed.tex);
    gl.uniform1i(blitP.u.uTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(blitP.u.uScene, 1);
    gl.activeTexture(gl.TEXTURE0);
    // the disc where the lens puts it, and how much it magnifies there
    const [sx, sy] = view.fwd(sunPx[0], sunPx[1]);
    const [ax, ay] = view.fwd(sunPx[0] + 1, sunPx[1]);
    const [bx, by] = view.fwd(sunPx[0], sunPx[1] + 1);
    const mag = Math.sqrt(Math.abs((ax - sx) * (by - sy) - (ay - sy) * (bx - sx)));
    gl.uniform2f(blitP.u.uSunUv, sx / IW, 1 - sy / IH);
    gl.uniform2f(blitP.u.uRes, rect.w, rect.h);
    gl.uniform1f(blitP.u.uScale, (rect.w / IW) * mag);
    gl.uniform1f(blitP.u.uBlow, rawView ? 0 : 1);
    gl.uniform1f(blitP.u.uOpen, open);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    dirty = false;
  };

  stage.onResize(() => {
    build();
    if (held) render();
  });

  // A held gust: run it from rest, deterministically, and keep that frame.
  if (holdGust != null) {
    const dir = num("dir", 1) >= 0 ? 1 : -1;
    const T = clamp(num("t", 2.4), 0, 20);
    for (let i = 0; i < Math.round(T * 60); i++) {
      pushGust(holdGust, dir);
      cloth.step(1 / 60, windFn);
      simT += 1 / 60;
      writeVerts(viewNow());
      coverage();
      stepAdapt(1 / 60);
    }
  }

  let acc = 0;
  const STEP = 1 / 60;
  const frame = (dt, t) => {
    const age = (performance.now() - born) / 1000;
    if (!held) {
      const p = stage.pointer;
      const W = Math.max(320, stage.width);
      const g = clamp(Math.abs(p.vx) / (1.4 * W), 0, 1);
      if (g > 0.06) gustDir = p.vx >= 0 ? 1 : -1;
      gustA = g > gustA ? damp(gustA, g, 10, dt) : damp(gustA, g, 0.7, dt);
      breezeOn = damp(breezeOn, age > 1.2 ? 1 : 0, 0.9, dt);
      acc = Math.min(acc + dt, STEP * 4);
      while (acc >= STEP) {
        pushGust(gustA, gustDir);
        cloth.step(STEP, windFn);
        simT += STEP;
        acc -= STEP;
      }
    }
    if (!held) stepAdapt(Math.min(dt, 0.1));
    if (!held && !reduced) stepTilt(Math.min(dt, 0.05), age);
    const reveal = held || reduced ? 1 : expoOut(clamp(age / 2.1, 0, 1));
    const exposure = film0.exposure + 2.5 * (1 - reveal);
    const nextTick = held ? 0 : Math.floor(t * 24);
    if (!held || dirty || reveal < 1 || nextTick !== tick) {
      tick = nextTick;
      if (held && !dirty) return;
      render(exposure);
    }
  };
  stage.onFrame(frame);

  await new Promise((r) => requestAnimationFrame(() => r()));
  if (stage.canvas.width > 1) render(held ? film0.exposure : film0.exposure + 2.5);
  born = performance.now();
  void embedded;

  return {
    destroy() {
      film.destroy();
      for (const t of [scene, developed]) {
        if (!t) continue;
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
        if (t.rb) gl.deleteRenderbuffer(t.rb);
      }
      for (const t of [plateTex, layersTex, idsTex, blurTex]) gl.deleteTexture(t);
      for (const b of [quad, vbuf, ibuf]) gl.deleteBuffer(b);
      for (const v of [quadVao, clothVao]) gl.deleteVertexArray(v);
      for (const pr of [plateP, blitP, clothP]) gl.deleteProgram(pr.p);
      stage.destroy();
    },
  };
}
