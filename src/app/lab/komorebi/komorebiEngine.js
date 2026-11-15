import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Komorebi: lying under the stone pines of Piazza Martin Lutero in Rome,
// looking up through the canopy towards a low sun.
//
// The frame is one capture: Poly Haven's piazza_martin_lutero, a 16K linear
// HDRI, reprojected offline to a stereographic view pitched 64° up. Offline,
// the lens's own veiling glare and diffraction spikes were taken out, the sky
// was rebuilt as a smooth field, and the trees were pulled apart from it into
// three depth layers (far pines and the cypresses low in the frame, the middle
// crowns, the crown overhead), each with its needle-scale matte, its hidden
// part filled in behind the nearer layers so a moving crown uncovers foliage
// or sky, never a hole.
//
// The cumulus come from a second capture, Poly Haven's
// kloofendal_48d_partly_cloudy_puresky, reprojected to the same upward view
// and turned so its sun lands on the drawn sun: every cloud keeps its true
// lighting, sunlit tops towards the sun and skylight-blue undersides, and the
// edge of the big cumulus beside the sun glows. Offline the clouds were
// separated from their own pale sky as a soft matte (cover and premultiplied
// light, consistent, so no edge carries a dark unmixing band), relit to this
// sun and skylight, and rolled off below the film's clip; here they lie over
// the deep Roman sky and behind every needle. The sky behind them is a clean
// smooth field (offline, the piazza's own ghost clouds and lens rings taken
// out of it).
//
// The grade, here in the shader: the rebuilt sky takes a Superia cobalt,
// pale cyan-blue at the horizon deepening overhead. The cumulus keep the
// capture's own light as their drawing, rolled off below the clip: sunlit
// tops warm-neutral, shade and undersides in the colour of the sky round
// them, and a forward-scatter gain on the cloud beside the sun.
//
// Wind: every layer is split into a few branches, each a damped spring with
// its own natural frequency (big near crowns slow and wide, far trees quick
// and small), driven by the drag of the air at its centre. At rest a breeze
// rolls through; the pointer is a breath of wind, a puff that travels with
// the hand and fades. Branches bend from their trunks, so trunks hold still.
//
// The sun is a source in the sky behind all of it, raised from the low sun
// of the capture into the heart of the overhead crown, where the eye goes
// first, always there at its full radiance; nothing switches it. It is
// seen through the canopy's matte at the crown's own diffusion: sky with
// sun times (1 - matte), the matte as soft as the needles look on the
// print, so no needle cuts the disc with an edge sharper than the crown.
// One tuft of needles hangs over it on a twig of its own, its stiff limb
// steady round the sun: at rest it covers the disc, the needles thinned
// over it by the sun's own glare, so the sun is a star through them; a
// gust swings it clear (its drag grows with the square of a breeze) onto
// the thinner crown behind, and it swings back and closes. Everything the
// sun puts on the film follows from the energy that gets through (E): the
// white core widens from a pinpoint, a warm bloom and a thin red-orange
// ring of halation come up and spread through the parted needles, and the
// film's own halation and diffusion take what is past their thresholds.
// The glare lands through the same soft matte, never as a veil over the
// crown, so the body of the crown keeps its own dark green against the
// glow. The film's pyramid has long wings, so the disc goes in heavily
// filtered.
//
// The crowns are backlit: the sun is behind them, so from below they show
// their shaded undersides, dark and cool in the skylight, never tinted by
// the sun; its light reaches the print only through their gaps.
//
// The lower canopy, the cypresses and far pines against the low sky, was
// rebaked from the HDRI at full resolution (the capture's own sun stood
// among them, and its flare had cost them their edges), so they keep their
// real needle-sharp silhouettes; here they are pressed to a true black and
// the scan's black kept low and neutral, so they frame the glowing sky as
// the sharp dark under it rather than a grey-teal veil.
//
// Query: ?t=seconds holds the simulation at that moment (deterministic);
// with ?wind=0..2 a breath of that strength sets off at t = 0.5 s (1 a
// firm breath, 2 a gust).

const ASSET = "/lab/komorebi/";
const AW = 1680;
const AH = 2100;
const ASPECT = AW / AH; // 0.8, a 4:5 print
const SKY = [210, 262];
const LOG = [-14, 2]; // canopy.webp: v = (log2(c) - LO) / (HI - LO)
// clouds.webp: rgb = log2(P + 2^LO) mapped LO..HI, P the cloud light
// premultiplied by its cover; a = cover.
const CLOUD_LOG = [-9, 6];

// Sun, in asset uv (y down): set behind the heart of the overhead crown,
// where the eye goes first, on clear sky (no cumulus, no farther crown in
// the way), so the only thing between it and the lens is one tuft of
// needles. (The capture's sun stood low, at (0.4502, 0.8798).)
const SUN = { x: 0.52, y: 0.362, r: 0.0028631, L: 194211, color: [1.0375, 1.006, 0.83] };
// The tuft over the sun: the near crown's needles within r (asset widths)
// of the disc hang on a twig of their own. At rest they cover the sun; the
// drag of the wind (quadratic in a breeze, linear in a gust) swings them
// clear, so a breath parts the needles over the disc and lets them close
// again. amp: deflection per unit wind, in tuft radii; settle: seconds over
// which its rest follows the slow breeze.
// The tuft is the whole of the near crown in its patch, cut from its own
// matte: edge is how far its rim wanders (tuft radii), by patches twice
// cell (asset px), softened over a cluster's width. What it leaves behind
// when it swings is a few of its clusters, the dark of the canopy's light
// at cluster scale (holes: the band in stops, soft its half-width, core how
// much fuller it is over the disc), on patches of cell, stay the share.
// limb: radius (tuft radii) round the sun over which the near crown's own
// sway is held back by hold, so a gust swings the tuft off the disc rather
// than carrying the crown over it. pinhole, heart: how far the sun's glare
// thins the needles right over the disc and over the tuft's heart; behind:
// how much thinner the crown behind the tuft is round the disc.
const TUFT = {
  r: 0.026,
  amp: 1.15,
  hz: 0.95,
  zeta: 0.16,
  flutter: 0.1,
  settle: 2.5,
  pinhole: 0.55,
  holes: 0.1,
  soft: 0.4,
  core: 0.6,
  edge: 0.4,
  cell: 9,
  stay: 0.2,
  limb: 2.5,
  hold: 0.75,
  heart: 0.1,
  behind: 0.85,
};
// Scene light is written at 1/16 so the sun fits a half float; film adds it back.
const GAIN = 1 / 16;
// Share of the measured radiance the disc keeps. Still ~100x past the clip,
// so it reads white; much more and the film's wide diffusion fogs the
// crown 100 px (DPR 2) away.
const SUN_ND = 0.001;
// Glare round the disc, in scene light (before GAIN), all of it driven by
// the energy that gets through the needles (E, the share of the disc that
// reaches the lens): core peak and colour at the sun's centre, e-folding
// width in frame heights, through a pinhole .. through an open gap. The film
// clips near 2.8, so the white core is a few pixels across through the
// needles and ~1.5% of the frame open. A warm bloom (peak, e-folding width)
// comes up as E^1.5, so it fills an open gap and stays off a star. The glare
// lands where the light can reach the lens, through the crown's soft matte:
// in full on a gap, a trace (body) on the body of a crown.
const GLARE = {
  peak: 30,
  color: [1, 0.9, 0.74],
  width: [0.0022, 0.0085],
  bloom: 0.9,
  bloomColor: [1, 0.7, 0.4],
  bloomWidth: [0.02, 0.075],
  body: 0.05,
};
// The thin red-orange ring of halation just outside the clipped core
// (radius in core widths), as E^3: next to none round the star, a warm
// ring round the open sun.
const HALO = { peak: 0.9, color: [1, 0.46, 0.16], radius: 3.4 };
// The crown's diffusion: the mip of the canopy's matte the sun is seen
// through. The crowns are this soft on the print (about 3 asset px), so the
// disc is never cut by an edge sharper than the needles round it.
const DIFFUSE = 1.6;

// Per layer: deflection per unit wind (asset widths), natural frequency,
// damping. The branch centres the wind is sampled at come with the
// weights, in branches.json (asset uv, one list per layer, channel order).
const LAYERS = [
  {
    amp: 0.0068,
    hz: 0.78,
    zeta: 0.16,
  },
  {
    amp: 0.0072,
    hz: 0.55,
    zeta: 0.14,
  },
  {
    amp: 0.0095,
    hz: 0.38,
    zeta: 0.12,
  },
];

const FILM = {
  ...FILM_PRESETS.summer,
  input: "linear",
  headroom: 0,
  whitePoint: 3.6,
  contrast: 1.2,
  shoulder: 0.95,
  // Halation only off the sun, judged from the surround: a narrow red-orange
  // fringe where the glare meets the needles, not a red veil on every twig;
  // scaled per frame by how far the tuft has swung off the disc.
  halation: 0.15,
  halationThreshold: 2.5 * GAIN,
  halationLocal: 0.6,
  // Pro-Mist only past the clip: the sky, cloud and shadows keep their own
  // drawing and are not lifted by the veil.
  bloom: 0.15,
  bloomThreshold: 1.25 * GAIN,
  softness: 0.42,
  saturation: 1.12,
  blueDepth: 0.7,
  // A scan's black, kept low so the lower canopy is a silhouette, not a
  // grey-teal veil.
  toe: 0.022,
  // ...and neutral, so the silhouettes sink to black, not to a navy.
  toeColor: [0.92, 1, 1.06],
  grain: 0.34,
  vignette: 0.22,
};
// The grade, in linear scene light before the film.
// Sky: a bright summer cyan-cobalt, saturated all the way up. The rebuilt
// field gives the circumsolar glow low behind the cypresses (rolled off);
// above it the sky climbs steadily from the zenith down to the treeline
// (floor: the zenith's luminance, scene light, and the stops it gains by
// the treeline), so the field's dip a fifth of the way down never reads as
// a dusky band. Chroma is per unit blue: printed, the zenith lands near
// hue 206 (rgb ~5, 82, 148), the treeline near hue 200 (~10, 118, 175).
// The film's corner fall-off is taken back out of the sky, so it holds its
// light into the corners; the trees keep it.
const SKY_GRADE = {
  horizon: [0.03, 0.44, 1],
  zenith: [0.012, 0.315, 1],
  depth: [0.6, 0.56], // luminance kept, horizon .. zenith
  knee: 1.1, // circumsolar roll-off: Y / (1 + Y / knee)
  floor: [0.075, 1.0], // zenith luminance, stops gained by the treeline
  pale: [0.42, 0.8, 1], // round the sun the sky pales to this, never grey
};
// Printed, any pale or desaturated blue (sky through a thin cloud edge, the
// pale sky by the sun under the film's warm bloom) is held to this hue,
// degrees, so nothing drifts to lavender.
const SKY_HUE_MAX = 215;
// Cloud: the capture's own light is the drawing. The matte is soft, from
// the puresky's own cloud-vs-sky separation (tools/depth/bakes/komorebi/
// softmatte.py), so the lobes, the wisps and the pale fringe where a cloud
// thins into the sky are the photograph's. Here it gets a touch of local
// contrast and skylight fill, a gain by the sun for the light scattered
// forward, a soft roll-off under the clip, and colour: sunlit tops warm,
// shade and undersides in the sky's own blue.
const CLOUD_GRADE = {
  key: [1, 0.89, 0.67], // sunlit tops, per unit red
  sky: 0.1, // the shade's colour: the sky round it, this far towards white
  fill: 0.05, // skylight under every part of a cloud, scene light
  gain: 1.3, // the capture's own light
  top: 2.2, // the ceiling: rolls off to it from knee, under the clip
  knee: 1.1,
  detail: 1.2, // local contrast against the cloud's own blur
  own: 0.6, // share of the capture's own colour kept in a cloud's body
  forward: 0.35, // gain on cloud by the sun, from the light it scatters forward
};
// The lower canopy's shadows sink by c / (c + knee): strength 0 off, 1 full.
// The cypresses and far pines are rebaked from the HDRI with needle-sharp
// mattes (tools/depth/bakes/komorebi/lowband.py); pressed this hard they go
// to a true black against the sky, their sunlit needles keeping a little
// light, so they are the sharp dark that frames the glow.
const SILHOUETTE = { strength: 1, knee: 0.1 };
// Backlight. The sun stands behind the crowns, so what the eye sees of
// them from below is their shaded underside, lit only by the sky: the
// overhead crown's needles go down by near stops (the middle crowns, a
// little further from the sun, by mid), cooled towards the skylight that
// fills them (the sky's own tint to the cool power, per unit luminance),
// and the capture's own sunlit needles roll off above a knee, pivoting on
// the crown's middle tone, so no part of the underside reads front-lit.
// The wood of the forks drops by bark stops and keeps its warmth.
// The light that comes through the needles is not a tint on the crown: it
// reaches the print only through their gaps, so the body of every crown,
// the thick of it round the sun included, keeps this cool dark green.
const BACKLIGHT = {
  near: 1.5,
  mid: 1.2,
  cool: 0.2,
  bark: 1.8,
  roll: [0.04, 0.014], // highlight knee and the pivot it keeps, scene light
};
const BASE_EXPOSURE = 0.35; // stops, artistic, on top of 1/GAIN

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
uniform sampler2D uCanopy;   // log-encoded foliage light, unpremultiplied
uniform sampler2D uLayers;   // r far, g mid, b near: coverage
uniform sampler2D uBranches; // three tiles stacked: per-layer branch weights
uniform sampler2D uSky;      // linear sky, no sun, no lens veil
uniform sampler2D uClouds;   // cumulus: log premultiplied light, cover in a
uniform vec2 uCLog;
uniform vec4 uCrop;          // asset uv origin xy, size zw
uniform vec2 uRes;           // target px
uniform vec2 uOff[12];       // branch offsets, asset widths (x) and widths (y)
uniform vec2 uSun;
uniform float uSunR;
uniform vec3 uSunL;
uniform float uGain;
uniform vec3 uGlare;         // core peak
uniform vec3 uBloom;         // the warm bloom over the crown, peak
uniform vec4 uGlareW;        // core width shut, open; bloom width shut, open
uniform float uBody;         // the glare's share on the body of a crown
uniform vec4 uHalo;          // halation ring: rgb peak, a radius (core widths)
uniform vec2 uSil;           // how far the lower canopy sinks into silhouette, knee
uniform vec4 uTuft;          // xy tuft offset (asset uv), z radius (asset widths), w pinhole
uniform vec4 uTuftN;         // gap band (stops), its half-width, fuller over the disc, rim raggedness
uniform vec3 uTuftS;         // patch cell (asset px), noise level past which clusters stay, how far it has swung (0..1)
uniform vec4 uTuftH;         // the limb: steady radius (tuft radii), share held; thinning: tuft heart, crown behind
uniform sampler2D uCanopyBlur; // canopy, mipmapped sampler
uniform sampler2D uLayersBlur; // layers, mipmapped sampler
uniform float uDiff;         // the crown's diffusion: the mip of its matte the sun is seen through
uniform vec2 uLog;
uniform sampler2D uCloudsBlur; // same texture, mipmapped sampler
uniform vec3 uSkyHor;
uniform vec3 uSkyZen;
uniform vec3 uSkyGrade;      // depth horizon, depth zenith, knee
uniform vec2 uSkyFloor;      // zenith luminance, stops gained by the treeline
uniform vec3 uSkyPale;       // the pale sky round the sun
uniform float uVig;          // the film's vignette, taken back out of the sky
uniform vec3 uCKey;          // sunlit tops
uniform vec4 uCGrade;        // sky share in the shade, fill, gain, detail
uniform vec4 uCRoll;         // knee, top, unused, unused
uniform vec2 uCGlow;         // own colour share, forward scatter
uniform vec4 uBack;          // stops down: near, mid; cool power; bark stops
uniform vec2 uBackRoll;      // highlight roll-off: knee, pivot (scene light)
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float ASPECT = ${ASPECT.toFixed(6)};

vec3 canopy(vec2 uv) {
  vec3 v = texture(uCanopy, uv).rgb;
  return exp2(uLog.x + v * (uLog.y - uLog.x));
}
vec2 disp(int k, vec2 uv) {
  vec4 w = texture(uBranches, vec2(uv.x, (uv.y + float(k)) / 3.0));
  vec2 d = w.r * uOff[k * 4] + w.g * uOff[k * 4 + 1] + w.b * uOff[k * 4 + 2] + w.a * uOff[k * 4 + 3];
  // Held at the print's edges, so a swing never reaches past the capture.
  vec2 e = smoothstep(0.0, 0.05, min(uv, 1.0 - uv));
  // The tuft's twig grows from a stiff limb: the near crown holds steadier
  // round the sun, so the gust swings the tuft off the disc rather than
  // carrying the whole crown over it.
  if (k == 2) {
    vec2 sq = (uv - uSun) * vec2(1.0, 1.0 / ASPECT) / (uTuftH.x * uTuft.z);
    e *= 1.0 - uTuftH.y * exp(-dot(sq, sq));
  }
  return vec2(d.x, d.y * ASPECT) * e.x * e.y;
}

// The tuft: the needles round the sun hang on their own twig, cut from the
// near crown's own matte. Its clusters are the dark of the foliage light at
// cluster scale and the bright gaps between them are sky, so the tuft is as
// ragged and as perforated as the crown round it (60-80% cover), and its rim
// follows the clusters, not a circle. A few patches of its clusters, and
// the lit needles behind its gaps, stay on the branch: at rest the two
// close back into the crown, and when it swings the needles part, a few
// strands still crossing the opening.
float lumAt(vec2 p, float lod) {
  return dot(textureLod(uCanopyBlur, p, lod).rgb, LUMA) * (uLog.y - uLog.x);
}
float hash(vec2 i) {
  return fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
}
float vnoise(vec2 x) {
  vec2 i = floor(x);
  vec2 f = x - i;
  vec2 w = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), w.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), w.x), w.y);
}
// The near crown's matte a at its rest point p: the tuft's part (x) and
// what stays on the branch (y). The tuft is the whole of the crown in its
// patch, so swung it is one piece of needles and slides into the crown
// beside it; its rim wanders by patches and runs round the clusters, soft
// over a cluster's width, so the opening it leaves has no edge sharper
// than the needles. Until it has swung clear of its own needles' width the
// crown under it stays whole (its flutter at rest never opens slivers);
// past that what is left is a few of its clusters, soft-edged strands
// still crossing the opening.
vec2 tuftSplit(vec2 p, float a) {
  float q = length((p - uSun) * vec2(1.0, 1.0 / ASPECT)) / uTuft.z;
  if (q > 1.5 || a <= 0.0) return vec2(0.0, a);
  float dm = lumAt(p, 1.0) - lumAt(p, 3.5);
  vec2 c = p * vec2(${AW}.0, ${AH}.0) / uTuftS.x;
  float rim = q + uTuftN.w * (2.0 * vnoise(0.5 * c + vec2(5.0, 23.0)) - 1.0) + 0.2 * clamp(dm, -1.0, 1.0);
  float m = 1.0 - smoothstep(0.45, 1.1, rim);
  float th = uTuftN.x + uTuftN.z * smoothstep(0.75, 0.0, q);
  float n = 1.0 - smoothstep(th - uTuftN.y, th + uTuftN.y, dm);
  float stay = smoothstep(-0.35, 0.35, vnoise(c) - uTuftS.y);
  return vec2(a * m, a * (1.0 - m) + a * m * mix(1.0, n * stay, uTuftS.z));
}
// Needle detail: the foliage light here against its surround, in stops.
float needles(vec2 p) {
  const vec2 o = vec2(7.0 / ${AW}.0, 7.0 / ${AH}.0);
  float v = dot(texture(uCanopy, p).rgb, LUMA);
  float m = dot(texture(uCanopy, p + vec2(o.x, 0.0)).rgb + texture(uCanopy, p - vec2(o.x, 0.0)).rgb
    + texture(uCanopy, p + vec2(0.0, o.y)).rgb + texture(uCanopy, p - vec2(0.0, o.y)).rgb, LUMA) * 0.25;
  return (v - m) * (uLog.y - uLog.x);
}
// The near crown, with the tuft riding on its branch and swung by its own
// offset. Its needles and the rest are cut from one matte, so at rest
// they close back into it.
float nearCover(vec2 uv, float lod, out vec2 ub, out vec2 ut, out float ab, out float at) {
  ub = uv - disp(2, uv);
  ut = ub - uTuft.xy;
  ab = tuftSplit(ub, textureLod(uLayersBlur, ub, lod).b).y;
  at = tuftSplit(ut, textureLod(uLayersBlur, ut, lod).b).x;
  // Over the disc the needles thin: the sun's own light eats the thin
  // ones in front of it (irradiation), whichever needles are there, so at
  // rest it is a star through the tuft and it never goes out behind a
  // passing cluster; their own gaps open, never a disc cut out. The crown
  // behind the tuft is thinner round the disc on its own branch, the
  // patch the tuft uncovers as it swings.
  vec2 hq = (uv - uSun) * vec2(1.0, 1.0 / ASPECT) / (1.9 * uSunR);
  vec2 pq = (uv - uSun) * vec2(1.0, 1.0 / ASPECT) / uTuft.z;
  float eat = max(uTuft.w * exp(-dot(hq, hq)), uTuftH.z * exp(-dot(pq, pq) / 0.2));
  float thinB = 1.0 - smoothstep(-1.2, 1.0, needles(ub));
  at *= 1.0 - eat * (1.0 - smoothstep(-1.2, 1.0, needles(ut)));
  vec2 bq = (ub - uSun) * vec2(1.0, 1.0 / ASPECT) / (5.0 * uSunR);
  ab *= (1.0 - eat * thinB) * (1.0 - uTuftH.w * exp(-dot(bq, bq)) * (0.5 + 0.5 * thinB));
  // One matte: where the swung tuft lies over the crown it does not add to
  // it, so at rest the two are exactly the crown.
  return max(ab, at);
}

// All the canopy between the sky and the lens at a point: every layer,
// bent as it stands this frame, its matte at mip lod.
float coverAt(vec2 s, float lod) {
  vec2 sb, st;
  float sab, sat;
  float c = (1.0 - textureLod(uLayersBlur, s - disp(0, s), lod).r) * (1.0 - textureLod(uLayersBlur, s - disp(1, s), lod).g);
  return 1.0 - c * (1.0 - nearCover(s, lod, sb, st, sab, sat));
}

vec3 withLuma(vec3 tint, float y) {
  return tint * (y / dot(tint, LUMA));
}

// A crown's shaded underside: down by its stops and cooled towards the
// skylight that is all that reaches it; the sunlit wood of the forks (warm,
// redder than it is green) drops less and keeps its colour.
vec3 underside(vec3 c, float stops, vec3 sky) {
  float bark = smoothstep(1.0, 1.2, c.r / max(c.g, 1e-5));
  vec3 cool = pow(sky / dot(sky, LUMA), vec3(uBack.z));
  // The capture's own sunlit needles (its sun stood low, under the crowns)
  // roll off, pivoting on the crown's middle tone, so the underside is
  // one even shade and nothing in it reads front-lit.
  float y = dot(c, LUMA);
  vec3 u = c * cool * exp2(-stops) * (1.0 + uBackRoll.y / uBackRoll.x) / (1.0 + y / uBackRoll.x);
  return mix(u, c * exp2(-uBack.w * stops / uBack.x), bark);
}
void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y);
  vec2 uv = uCrop.xy + p * uCrop.zw;
  float sd = length((uv - uSun) * vec2(1.0, 1.0 / ASPECT));

  // Sky: summer cyan-cobalt, deepening from the horizon (asset bottom) to
  // overhead (the asset's top is past the zenith), and luminous all the way.
  vec3 col = texture(uSky, uv).rgb;
  vec3 skyTint;
  {
    float Y = dot(col, LUMA);
    Y = Y / (1.0 + Y / uSkyGrade.z);
    float h = smoothstep(0.98, 0.2, uv.y);
    Y *= mix(uSkyGrade.x, uSkyGrade.y, h);
    // Never darker than a steady climb from the zenith to the treeline
    // (a smooth max, so the circumsolar glow joins it without a seam).
    float fl = uSkyFloor.x * exp2(uSkyFloor.y * smoothstep(0.0, 0.8, uv.y));
    Y = pow(pow(Y, 4.0) + pow(fl, 4.0), 0.25);
    vec3 tint = mix(uSkyHor, uSkyZen, h);
    // round the sun the sky pales a little, as it does, towards a pale cyan
    tint = mix(tint, uSkyPale, 0.45 * exp(-sd / 0.07));
    skyTint = tint;
    // The film darkens the print's corners; the sky keeps its light there.
    vec2 vr = (p - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    float t2 = dot(vr, vr) / (0.25 * (uRes.x * uRes.x / (uRes.y * uRes.y) + 1.0)) * uVig * uVig;
    col = withLuma(tint, Y * (1.0 + t2) * (1.0 + t2));
  }

  // The sun: a limb-darkened disc of the measured radiance. Smaller than a
  // pixel it is widened with the same energy, so it never aliases away. It
  // is part of the sky, always there, always at full radiance; it is laid in
  // after the trees, through their matte (below).
  vec2 dv = (uv - uSun) * vec2(1.0, 1.0 / ASPECT);
  float px = uCrop.z / uRes.x;
  float r = max(uSunR, 0.8 * px);
  float d = length(dv) / r;
  float edge = px / r;
  float mu = sqrt(max(1.0 - d * d, 0.0));
  vec3 sun = uSunL * (uSunR * uSunR) / (r * r) * (1.0 - smoothstep(1.0 - edge, 1.0 + edge, d)) * (0.4 + 0.6 * mu) / 0.8;

  // Cumulus, in front of the sky and behind every needle.
  vec4 cl = texture(uClouds, uv);
  vec3 cP = exp2(uCLog.x + cl.rgb * (uCLog.y - uCLog.x)) - exp2(uCLog.x);
  if (cl.a > 0.0) {
    // The capture's own light, unpremultiplied, with its local contrast
    // lifted a little against the blurred surround so the lobes survive the
    // shoulder. Thin edges carry little cover: their surround is mostly
    // sky, so they keep their own drawing.
    vec4 cb = textureLod(uCloudsBlur, uv, 4.5);
    vec3 bP = exp2(uCLog.x + cb.rgb * (uCLog.y - uCLog.x)) - exp2(uCLog.x);
    float Yc = max(dot(cP, LUMA) / max(cl.a, 1e-3), 1e-4);
    float Yb = max(dot(bP, LUMA) / max(cb.a, 1e-3), 1e-4);
    float body = smoothstep(0.35, 0.85, cl.a) * smoothstep(0.25, 0.65, cb.a);
    float near = exp(-sd / 0.22);
    // Close to the sun the light scattered forward fills the cloud, so its
    // dark cores are not deepened there.
    float detail = mix(1.0, mix(uCGrade.w, 1.0, near * near), body);
    float Y = uCGrade.y + uCGrade.z * Yb * pow(Yc / Yb, detail);
    // Cloud by the sun glows with the light it scatters forward: a gain on
    // its own light, so its lobes keep their drawing.
    float fwd = exp(-sd / 0.15) * (1.0 - 0.35 * smoothstep(0.4, 1.0, cl.a));
    Y *= 1.0 + uCGlow.y * fwd;
    // The sunlit tops roll off softly to a ceiling under the clip.
    if (Y > uCRoll.x) Y = uCRoll.x + (uCRoll.y - uCRoll.x) * (1.0 - exp(-(Y - uCRoll.x) / (uCRoll.y - uCRoll.x)));
    // Colour follows the light: the shade takes the sky round it, the sun
    // side the warm key, through a clean white between them; the bodies
    // keep much of the capture's own (offline relit) colour, the thin
    // edges fade into the sky through its pale skylight blue.
    float lit = max(smoothstep(0.5, 1.9, Y), smoothstep(0.0, 0.9, 0.5 * uCGlow.y * fwd));
    vec3 shade = mix(skyTint, vec3(1.0), uCGrade.x);
    vec3 tint = mix(shade, uCKey, lit);
    vec3 own = cP / max(dot(cP, LUMA), 1e-5);
    tint = mix(tint, own, uCGlow.x * smoothstep(0.3, 0.9, cl.a));
    cP = withLuma(tint, Y) * cl.a;
  }
  col = col * (1.0 - cl.a) + cP * smoothstep(0.0, 2.0 / 255.0, cl.a);

  // Back to front; each layer bends with its own branches.
  vec2 u0 = uv - disp(0, uv);
  vec2 u1 = uv - disp(1, uv);
  float a0 = texture(uLayers, u0).r;
  float a1 = texture(uLayers, u1).g;
  vec2 ub, ut;
  float ab, at;
  float a2 = nearCover(uv, 0.0, ub, ut, ab, at);
  // The lower canopy, the cypresses and far pines against the low sky, is
  // pressed down into silhouette: its shadows sink towards black, its lit
  // needles keep most of their light.
  float sil = uSil.x * smoothstep(0.5, 0.95, uv.y);
  vec3 c0 = canopy(u0);
  vec3 c1 = canopy(u1);
  c0 *= mix(vec3(1.0), c0 / (c0 + uSil.y), sil);
  c1 *= mix(vec3(1.0), c1 / (c1 + uSil.y), sil);
  col = mix(col, c0, a0);
  // Backlit: the crowns between the lens and the sun show their shaded
  // undersides. The middle ones fade out of it into the silhouettes below.
  c1 = mix(c1, underside(c1, uBack.y, skyTint), 1.0 - sil);
  col = mix(col, c1, a1);
  if (a2 > 0.0) {
    vec3 c2 = (canopy(ub) * ab + canopy(ut) * at) / (ab + at);
    col = mix(col, underside(c2, uBack.x, skyTint), a2);
  }

  // The sun is a source behind the crown, never switched by it: sky with
  // sun times what the canopy lets through, the canopy's matte taken at its
  // own diffusion (the crown is soft at this scale, so a needle never cuts
  // the disc with an edge sharper than the needles round it). Everything
  // the sun puts on the film follows from the light that gets through.
  float rh = length(dv) / px / uRes.y;
  float T = 1.0;
  if (rh < 0.4) T = 1.0 - coverAt(uv, uDiff);
  col += sun * T * (1.0 - cl.a);

  // The transmitted energy: the disc's share that reaches the lens, from
  // the centre and a ring of taps inside the limb, through every layer.
  float E = 0.0;
  for (int i = 0; i < 9; i++) {
    float ang = float(i) * 0.7853982;
    vec2 o = i == 0 ? vec2(0.0) : 0.6 * uSunR * vec2(cos(ang), sin(ang) * ASPECT);
    vec2 s = uSun + o;
    E += (1.0 - texture(uClouds, s).a) * (1.0 - coverAt(s, uDiff)) * (i == 0 ? 0.2 : 0.1);
  }

  // Glare from that energy: the light that scatters inside the lens and
  // off the emulsion right next to the disc. A white-hot core that clips, a
  // warm bloom and a thin red-orange ring of halation, all in proportion to
  // what comes through, and wider the more does: through a pinhole, a star;
  // with the needles parted, the sun in full. It lands where the light can
  // reach the lens, through the same soft matte, so it pours through the
  // gaps and leaves the body of a crown at its own dark green.
  float cw = mix(uGlareW.x, uGlareW.y, E);
  float bw = mix(uGlareW.z, uGlareW.w, E);
  float x = rh / cw;
  float lands = mix(uBody, 1.0, T);
  vec3 g = uGlare * exp(-x);
  g += uBloom * pow(E, 1.5) * exp(-rh / bw);
  col += g * E * lands;
  float hr = (rh / cw - uHalo.a) / (0.4 * uHalo.a);
  col += uHalo.rgb * E * E * E * exp(-hr * hr) * T;
  outColor = vec4(col * uGain, 1.0);
}`;

const BLIT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uFade;
uniform vec3 uPaper;
uniform float uHueMax;       // hue ceiling for blues, in sixths of a turn
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  // Blues past the ceiling (the pale veil by the sun, a thin cloud edge
  // under the warm bloom) are turned back to it at the same value and
  // chroma, so no pale sky reads lavender; deep blacks and real violets are
  // left alone.
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float d = mx - mn;
  if (c.b >= mx && d > 1.0 / 255.0) {
    float h = 4.0 + (c.r - c.g) / d;
    float w = step(uHueMax, h) * (1.0 - smoothstep(4.5, 5.0, h)) * smoothstep(0.06, 0.2, mx);
    float hn = mix(h, uHueMax, w);
    c = hn < 4.0 ? vec3(mn, mn + (4.0 - hn) * d, mx) : vec3(mn + (hn - 4.0) * d, mn, mx);
  }
  outColor = vec4(mix(uPaper, c, uFade), 1.0);
}`;

const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];

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

async function bitmap(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  return createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function imageTexture(gl, img) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  img.close?.();
  return t;
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

const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const TAU = Math.PI * 2;

// A small seeded generator, so a held moment is the same moment every time.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- The wind and the branches. Units: asset widths; y runs down.

function createCanopy(centres) {
  const rand = rng(7);
  const branches = [];
  LAYERS.forEach((L, k) => {
    centres[k].forEach(([cx, cy], c) => {
      const f = L.hz * (0.85 + rand() * 0.3);
      branches.push({
        k,
        c,
        cx,
        cy: cy / ASPECT,
        omega: TAU * f,
        zeta: L.zeta,
        amp: L.amp * (0.85 + rand() * 0.3),
        // flutter: the twigs' own quicker, smaller spring
        fOmega: TAU * (2.3 + rand() * 1.1),
        fAmp: L.amp * 0.22,
        ph: [rand() * TAU, rand() * TAU, rand() * TAU, rand() * TAU],
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        fx: 0,
        fy: 0,
        fvx: 0,
        fvy: 0,
      });
    });
  });
  // The tuft over the sun, last: a spring of its own, not a branch tile.
  branches.push({
    k: -1,
    c: 0,
    cx: SUN.x,
    cy: SUN.y / ASPECT,
    omega: TAU * TUFT.hz,
    zeta: TUFT.zeta,
    amp: TUFT.amp * TUFT.r,
    drag: true,
    sx: 0,
    sy: 0,
    fOmega: TAU * 3.1,
    fAmp: TUFT.flutter * TUFT.r,
    ph: [rand() * TAU, rand() * TAU, rand() * TAU, rand() * TAU],
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    fx: 0,
    fy: 0,
    fvx: 0,
    fvy: 0,
  });
  return branches;
}

// The resting breeze: mostly from the left, swelling and easing on slow,
// incommensurate periods, arriving at each branch a little later the further
// right it stands, so it reads as air rolling through the trees.
const GUST_MAX = 1.8;

function breeze(t, b, scale) {
  const lt = t - b.cx * 1.1;
  const g = 0.5 + 0.5 * (0.55 * Math.sin(TAU * 0.071 * lt) + 0.3 * Math.sin(TAU * 0.137 * lt + 1.3) + 0.15 * Math.sin(TAU * 0.29 * lt + 2.1));
  const s = (0.18 + 0.32 * g * g) * scale;
  // Turbulence: a slow wander in direction and a little lift.
  const tx = 0.22 * Math.sin(TAU * 0.43 * t + b.ph[0]) + 0.12 * Math.sin(TAU * 0.97 * t + b.ph[1]);
  const ty = 0.18 * Math.sin(TAU * 0.37 * t + b.ph[2]) + 0.1 * Math.sin(TAU * 1.13 * t + b.ph[3]);
  return [s * (0.92 + tx), s * (-0.3 + ty)];
}

// Wind at a branch: breeze plus every live puff of the hand.
function windAt(b, puffs, t, breezeScale) {
  const [bx, by] = breeze(t, b, breezeScale);
  let wx = 0;
  let wy = 0;
  for (const p of puffs) {
    const env = (1 - Math.exp(-p.age / 0.07)) * Math.exp(-p.age / 0.75);
    const R = 0.2 + 0.28 * p.age;
    const dx = b.cx - p.x;
    const dy = b.cy - p.y;
    const w = p.s * env * Math.exp(-(dx * dx + dy * dy) / (R * R));
    wx += p.dx * w;
    wy += p.dy * w;
  }
  // Overlapping puffs of one breath do not add without limit: the air
  // saturates at a strong gust however fast or long the hand moves.
  const m = Math.hypot(wx, wy);
  if (m > 1e-6) {
    const k = (GUST_MAX * Math.tanh(m / GUST_MAX)) / m;
    wx *= k;
    wy *= k;
  }
  return [wx + bx, wy + by];
}

function stepCanopy(branches, puffs, t, dt, breezeScale) {
  for (const b of branches) {
    let [wx, wy] = windAt(b, puffs, t, breezeScale);
    const speed = Math.hypot(wx, wy);
    // The tuft's drag grows with the square of a breeze, so it barely
    // stirs at rest and swings wide in a gust.
    if (b.drag) {
      const k = Math.min(speed, 1);
      wx *= k;
      wy *= k;
    }
    // Sway: damped spring towards the drag deflection.
    const o2 = b.omega * b.omega;
    const ax = o2 * (b.amp * wx - b.x) - 2 * b.zeta * b.omega * b.vx;
    const ay = o2 * (b.amp * wy - b.y) - 2 * b.zeta * b.omega * b.vy;
    b.vx += ax * dt;
    b.vy += ay * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    // The tuft settles into the slow swell of the breeze (its rest is
    // wherever the air has been leaning lately), so only a change in the
    // wind, a gust or a breath, swings it off the sun.
    if (b.drag) {
      b.sx += (b.x - b.sx) * Math.min(1, dt / TUFT.settle);
      b.sy += (b.y - b.sy) * Math.min(1, dt / TUFT.settle);
    }
    // Flutter: twigs shiver in proportion to the wind speed.
    const n1 = Math.sin(TAU * 1.7 * t + b.ph[1]) * 0.6 + Math.sin(TAU * 3.1 * t + b.ph[2]) * 0.4;
    const n2 = Math.sin(TAU * 2.3 * t + b.ph[3]) * 0.6 + Math.sin(TAU * 4.1 * t + b.ph[0]) * 0.4;
    const f2 = b.fOmega * b.fOmega;
    b.fvx += (f2 * (b.fAmp * speed * n1 - b.fx) - 2 * 0.3 * b.fOmega * b.fvx) * dt;
    b.fvy += (f2 * (b.fAmp * speed * n2 - b.fy) - 2 * 0.3 * b.fOmega * b.fvy) * dt;
    b.fx += b.fvx * dt;
    b.fy += b.fvy * dt;
  }
  for (const p of puffs) {
    p.age += dt;
    // The breath carries on a little past the hand.
    p.x += p.dx * p.drift * dt;
    p.y += p.dy * p.drift * dt;
  }
  for (let i = puffs.length - 1; i >= 0; i--) if (puffs[i].age > 3.5) puffs.splice(i, 1);
}

export async function createKomorebi(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const tq = q.get("t");
  const held = tq != null && tq !== "" && Number.isFinite(+tq);
  const windQ = clamp(Number.isFinite(+q.get("wind")) ? +q.get("wind") : 0, 0, 2);
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");

  const [canopyImg, layersImg, branchImg, skyBuf, branchMeta, cloudImg] = await Promise.all([
    bitmap(`${ASSET}canopy.webp`),
    bitmap(`${ASSET}layers.webp`),
    bitmap(`${ASSET}branches.png`),
    fetch(`${ASSET}sky.bin`).then((r) => {
      if (!r.ok) throw new Error(`sky.bin: ${r.status}`);
      return r.arrayBuffer();
    }),
    fetch(`${ASSET}branches.json`).then((r) => r.json()),
    bitmap(`${ASSET}clouds.webp`),
  ]);
  const texCanopy = imageTexture(gl, canopyImg);
  const texLayers = imageTexture(gl, layersImg);
  const texBranches = imageTexture(gl, branchImg);
  const texClouds = imageTexture(gl, cloudImg);
  gl.bindTexture(gl.TEXTURE_2D, texClouds);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindTexture(gl.TEXTURE_2D, texCanopy);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindTexture(gl.TEXTURE_2D, texLayers);
  gl.generateMipmap(gl.TEXTURE_2D);
  // The base fetch stays plain linear; the blur reads the mips through its
  // own sampler.
  const blurSampler = gl.createSampler();
  gl.samplerParameteri(blurSampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.samplerParameteri(blurSampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.samplerParameteri(blurSampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.samplerParameteri(blurSampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const texSky = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texSky);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, SKY[0], SKY[1], 0, gl.RGB, gl.HALF_FLOAT, new Uint16Array(skyBuf));
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const scene = program(gl, VERT, SCENE);
  const blit = program(gl, VERT, BLIT);
  const film = createFilm(gl, { width: 2, height: 2 });

  // ---- layout: a 4:5 print on warm paper; embedded, the box is the print.
  const L = { x: 0, y: 0, w: 1, h: 1, pw: 2, ph: 2, crop: [0, 0, 1, 1] };
  let sceneT = null;
  let filmT = null;
  let dirty = true;
  // A slow GPU renders the print at a lower internal resolution rather than
  // dropping frames; the blit scales it up (film grain hides the step).
  let quality = 1;
  let skip = 0;
  const perf = { ema: 0, frames: 0, last: 0 };
  const layout = (W, H, dpr) => {
    if (embedded) {
      Object.assign(L, { x: 0, y: 0, w: W, h: H });
    } else if (W / H < 0.9) {
      const side = Math.max(16, Math.round(W * 0.06));
      let w = W - side * 2;
      let h = w / ASPECT;
      if (h > H * 0.8) {
        h = H * 0.8;
        w = h * ASPECT;
      }
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 });
    } else {
      const h = Math.min(H * 0.86, (W - 48) / ASPECT);
      const w = h * ASPECT;
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 });
    }
    L.x = Math.round(L.x * dpr) / dpr;
    L.y = Math.round(L.y * dpr) / dpr;
    L.w = Math.round(L.w * dpr) / dpr;
    L.h = Math.round(L.h * dpr) / dpr;
    L.pw = Math.max(2, Math.round(L.w * dpr * quality));
    L.ph = Math.max(2, Math.round(L.h * dpr * quality));
    // Cover-fit the print into the box, keeping the sun low in the frame.
    const a = L.pw / L.ph;
    if (a >= ASPECT) {
      const hh = ASPECT / a;
      const y0 = clamp(SUN.y - 0.45 * hh, 0, 1 - hh);
      L.crop = [0, y0, 1, hh];
    } else {
      const ww = a / ASPECT;
      const x0 = clamp(SUN.x - 0.5 * ww, 0, 1 - ww);
      L.crop = [x0, 0, ww, 1];
    }
    freeTarget(gl, sceneT);
    freeTarget(gl, filmT);
    sceneT = target(gl, L.pw, L.ph, floatOk);
    if (!sceneT.ok) {
      freeTarget(gl, sceneT);
      sceneT = target(gl, L.pw, L.ph, false);
    }
    filmT = target(gl, L.pw, L.ph, false);
    film.resize(L.pw, L.ph);
    dirty = true;
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  // ---- wind state
  const branches = createCanopy(branchMeta.layers);
  const puffs = [];
  let simT = 0;
  const STEP = 1 / 240;
  const toAsset = (x, y) => [(x - L.x) / L.w * L.crop[2] + L.crop[0], ((y - L.y) / L.h * L.crop[3] + L.crop[1]) / ASPECT];

  const addPuff = (x, y, vx, vy) => {
    const speed = Math.hypot(vx, vy);
    if (speed < 0.05) return;
    const s = Math.min(2.6, speed * 1.1);
    const last = puffs[puffs.length - 1];
    // Merge with a fresh puff nearby, so a slow hand is one breath, not many.
    if (last && last.age < 0.03 && Math.hypot(last.x - x, last.y - y) < 0.03) {
      last.s = Math.max(last.s, s);
      return;
    }
    puffs.push({ x, y, dx: vx / speed, dy: vy / speed, s, drift: Math.min(speed, 1.4) * 0.3, age: 0 });
    if (puffs.length > 48) puffs.shift();
  };

  stage.on("move", (p) => {
    if (held) return;
    const [x, y] = toAsset(p.x, p.y);
    // Pointer speed in print heights per second.
    const k = L.crop[3] / ASPECT / Math.max(1, L.h);
    addPuff(x, y, p.vx * k, p.vy * k);
  });
  stage.on("down", () => requestOrientation());

  // Phones: tilting the device is a gust across the canopy, low-passed.
  const orient = { b: null, g: null, t: 0 };
  const onOrient = (e) => {
    if (e.beta == null || e.gamma == null) return;
    const now = performance.now();
    if (orient.b != null) {
      const dt = Math.max(16, now - orient.t) / 1000;
      const vx = (e.gamma - orient.g) / dt / 60;
      const vy = (e.beta - orient.b) / dt / 60;
      addPuff(0.5, 0.55 / ASPECT, clamp(vx, -2, 2), clamp(vy, -2, 2));
    }
    orient.b = e.beta;
    orient.g = e.gamma;
    orient.t = now;
  };
  let orientOn = false;
  function requestOrientation() {
    if (orientOn || typeof window.DeviceOrientationEvent === "undefined") return;
    if (!window.matchMedia?.("(pointer: coarse)").matches) return;
    orientOn = true;
    const ask = window.DeviceOrientationEvent.requestPermission;
    if (typeof ask === "function") ask().then((r) => r === "granted" && window.addEventListener("deviceorientation", onOrient)).catch(() => {});
    else window.addEventListener("deviceorientation", onOrient);
  }

  // A breath that passes on its own: right after the reveal (the motion is
  // the only hint), and for held stills.
  const scripted = [];
  const breath = (t0, strength) => {
    // From the left edge, low, sweeping up and right through the crown and
    // across the sun.
    for (let i = 0; i < 14; i++) {
      const u = i / 13;
      scripted.push({ at: t0 + u * 0.55, x: -0.05 + u * 0.75, y: (0.8 - u * 0.55) / ASPECT, vx: 1.3, vy: -0.8, s: strength });
    }
    scripted.sort((a, b) => a.at - b.at);
  };
  const runScript = () => {
    while (scripted.length && scripted[0].at <= simT) {
      const e = scripted.shift();
      const speed = Math.hypot(e.vx, e.vy);
      puffs.push({ x: e.x, y: e.y, dx: e.vx / speed, dy: e.vy / speed, s: e.s * 1.2, drift: 0.4, age: simT - e.at });
    }
  };

  const advance = (dt, breezeScale) => {
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(STEP, left);
      runScript();
      stepCanopy(branches, puffs, simT, h, breezeScale);
      simT += h;
      left -= h;
    }
  };

  // Held: run the deterministic simulation up to ?t, with a breath of
  // strength ?wind arriving a second before.
  const holdT = held ? Math.max(0, +tq) : 0;
  if (held) {
    // The canopy settles into the breeze for six seconds off the record.
    // ?t counts from then; a ?wind breath sets off half a second in.
    if (windQ > 0) breath(6.5, windQ);
    advance(holdT + 6, 1);
  } else if (!reduce) {
    breath(1.4, 0.55);
  }

  const offs = new Float32Array(24);
  const tuft = branches[branches.length - 1];
  const fillOffsets = () => {
    offs.fill(0);
    for (const b of branches) {
      if (b.k < 0) continue;
      const i = (b.k * 4 + b.c) * 2;
      offs[i] = b.x + b.fx;
      offs[i + 1] = b.y + b.fy;
    }
  };

  const draw = (expoStops, fade, grainSeed) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    fillOffsets();
    const u = scene.u;
    gl.useProgram(scene.p);
    const bind = (unit, tex, name) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(u[name], unit);
    };
    bind(0, texCanopy, "uCanopy");
    bind(1, texLayers, "uLayers");
    bind(2, texBranches, "uBranches");
    bind(3, texSky, "uSky");
    bind(4, texClouds, "uClouds");
    bind(5, texClouds, "uCloudsBlur");
    gl.bindSampler(5, blurSampler);
    bind(6, texCanopy, "uCanopyBlur");
    gl.bindSampler(6, blurSampler);
    bind(7, texLayers, "uLayersBlur");
    gl.bindSampler(7, blurSampler);
    gl.uniform1f(u.uDiff, DIFFUSE);
    gl.uniform4f(u.uBack, BACKLIGHT.near, BACKLIGHT.mid, BACKLIGHT.cool, BACKLIGHT.bark);
    gl.uniform2fv(u.uBackRoll, BACKLIGHT.roll);
    gl.uniform3fv(u.uSkyHor, SKY_GRADE.horizon);
    gl.uniform3fv(u.uSkyZen, SKY_GRADE.zenith);
    gl.uniform3f(u.uSkyGrade, SKY_GRADE.depth[0], SKY_GRADE.depth[1], SKY_GRADE.knee);
    gl.uniform2fv(u.uSkyFloor, SKY_GRADE.floor);
    gl.uniform3fv(u.uSkyPale, SKY_GRADE.pale);
    gl.uniform1f(u.uVig, FILM.vignette);
    gl.uniform3fv(u.uCKey, CLOUD_GRADE.key);
    gl.uniform4f(u.uCGrade, CLOUD_GRADE.sky, CLOUD_GRADE.fill, CLOUD_GRADE.gain, CLOUD_GRADE.detail);
    gl.uniform4f(u.uCRoll, CLOUD_GRADE.knee, CLOUD_GRADE.top, 0, 0);
    gl.uniform2f(u.uCGlow, CLOUD_GRADE.own, CLOUD_GRADE.forward);
    gl.uniform2f(u.uCLog, CLOUD_LOG[0], CLOUD_LOG[1]);
    gl.uniform4fv(u.uCrop, L.crop);
    gl.uniform2f(u.uRes, L.pw, L.ph);
    gl.uniform2fv(u.uOff, offs);
    gl.uniform2f(u.uSun, SUN.x, SUN.y);
    gl.uniform1f(u.uSunR, SUN.r);
    gl.uniform3f(u.uSunL, SUN.L * SUN_ND * SUN.color[0], SUN.L * SUN_ND * SUN.color[1], SUN.L * SUN_ND * SUN.color[2]);
    gl.uniform1f(u.uGain, sceneT.ok ? GAIN : GAIN / 64);
    gl.uniform3f(u.uGlare, GLARE.peak * GLARE.color[0], GLARE.peak * GLARE.color[1], GLARE.peak * GLARE.color[2]);
    gl.uniform3f(u.uBloom, GLARE.bloom * GLARE.bloomColor[0], GLARE.bloom * GLARE.bloomColor[1], GLARE.bloom * GLARE.bloomColor[2]);
    gl.uniform4f(u.uGlareW, GLARE.width[0], GLARE.width[1], GLARE.bloomWidth[0], GLARE.bloomWidth[1]);
    gl.uniform1f(u.uBody, GLARE.body);
    gl.uniform4f(u.uHalo, HALO.peak * HALO.color[0], HALO.peak * HALO.color[1], HALO.peak * HALO.color[2], HALO.radius);
    const tx = tuft.x - tuft.sx + tuft.fx;
    const ty = tuft.y - tuft.sy + tuft.fy;
    gl.uniform2f(u.uSil, SILHOUETTE.strength, SILHOUETTE.knee);
    gl.uniform4f(u.uTuft, tx, ty * ASPECT, TUFT.r, TUFT.pinhole);
    gl.uniform4f(u.uTuftN, TUFT.holes, TUFT.soft, TUFT.core, TUFT.edge);
    // Value noise sits round 0.5: P(v > t) ~ 0.5 - 1.6 (t - 0.5).
    gl.uniform4f(u.uTuftH, TUFT.limb, TUFT.hold, TUFT.heart, TUFT.behind);
    gl.uniform3f(u.uTuftS, TUFT.cell, 0.5 + (0.5 - TUFT.stay) / 1.6, smooth(0.3, 0.9, Math.hypot(tx, ty) / TUFT.r));
    gl.uniform2f(u.uLog, LOG[0], LOG[1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, L.pw, L.ph);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindSampler(5, null);
    gl.bindSampler(6, null);
    gl.bindSampler(7, null);

    film.render(
      sceneT.tex,
      {
        ...FILM,
        input: sceneT.ok ? "linear" : "srgb",
        exposure: BASE_EXPOSURE + expoStops + Math.log2(1 / GAIN) + (sceneT.ok ? 0 : 6),
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
    const vw = Math.round(L.w * dpr);
    const vh = Math.round(L.h * dpr);
    const vy = stage.canvas.height - Math.round(L.y * dpr) - vh;
    gl.viewport(vx, vy, vw, vh);
    gl.useProgram(blit.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, filmT.tex);
    gl.uniform1i(blit.u.uTex, 0);
    gl.uniform1f(blit.u.uFade, fade);
    gl.uniform3fv(blit.u.uPaper, PAPER);
    gl.uniform1f(blit.u.uHueMax, SKY_HUE_MAX / 60);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  };

  // Reveal: the print comes up overexposed, an airy white-blue, and settles
  // into the deep sky as the eye adjusts.
  const REVEAL = 2.0;
  let age = 0;
  let grainClock = 0;
  let grainSeed = 0;
  stage.onFrame((dt) => {
    if (!sceneT) return;
    age += dt;
    if (!held) {
      const now = performance.now();
      if (perf.last) {
        const ms = now - perf.last;
        const m = Math.min(ms, 1000);
        perf.ema = perf.ema ? perf.ema + (m - perf.ema) * 0.08 : m;
        perf.frames++;
        const slow = (perf.frames > 45 && perf.ema > 26) || (perf.frames > 4 && perf.ema > 120);
        if (slow && quality > 0.5) {
          quality = quality > 0.75 ? 0.75 : 0.5;
          perf.frames = 0;
          perf.ema = 0;
          layout(stage.width, stage.height, stage.dpr);
        }
      }
      perf.last = now;
    }
    let expo = 0;
    let fade = 1;
    if (!held) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 2.5 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
      // Reduced motion: no idle breeze, but the hand still moves the air.
      const breezeScale = reduce ? 0 : 1;
      const live = !reduce || puffs.length > 0 || branches.some((b) => Math.abs(b.vx) + Math.abs(b.vy) > 1e-6);
      if (live) {
        advance(dt, breezeScale);
        dirty = true;
      }
      if (age < REVEAL + 0.1) dirty = true;
      // Grain at 24 fps.
      if (!reduce) {
        grainClock += dt;
        if (grainClock >= 1 / 24) {
          grainClock %= 1 / 24;
          grainSeed = (grainSeed + 1) % 997;
          dirty = true;
        }
      }
    }
    if (!dirty) return;
    // A software renderer (no GPU) gets a frame now and then, not a stall.
    if (quality <= 0.5 && perf.ema > 120 && (skip = (skip + 1) % 4) !== 0) return;
    dirty = false;
    draw(expo, fade, grainSeed);
  });

  return {
    destroy() {
      window.removeEventListener("deviceorientation", onOrient);
      film.destroy();
      freeTarget(gl, sceneT);
      freeTarget(gl, filmT);
      for (const t of [texCanopy, texLayers, texBranches, texSky, texClouds]) gl.deleteTexture(t);
      gl.deleteSampler(blurSampler);
      gl.deleteProgram(scene.p);
      gl.deleteProgram(blit.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
