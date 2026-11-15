import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_DEFAULTS, FILM_PRESETS } from "../_kit/film";

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
// over it by the sun's own glare, so the sun burns through them as a
// point; a breath swings it clear (its drag grows with the square of a
// breeze) onto the thinner crown behind, a gust swings it further, and it
// swings back and closes. The disc itself is seen only through the gaps;
// what the lens and the film make of the light that gets through is the
// bloom, added over the scene and never a veil the print is pulled
// towards: a share of the sun's flux, in proportion to the energy that
// gets through (E) and how wide the hole round it stands (open, from the
// tuft's swing), spread by unit-energy lobes (see BLOOM). Shut, a hot
// point glowing in the needles' pinholes, the ink round it full; open, a
// burn some 2-3x the bare disc eating the needles in front of it, a
// red-orange halation bleeding from its edge into the needles round it,
// their rims beside a gap lit warm (light wrap), the pinholes round it
// glinting, and a long falloff that is pale cyan over the sky, so the
// cobalt round the sun brightens and never greys. The cumulus beside it
// are lit on the sun-facing edges of their bodies; their thin veils over
// the blue are left alone, so no slate smear spreads under the sun.
//
// The crowns are backlit: the sun is behind them, so from below they show
// their shaded undersides, dark and cool in the skylight, never tinted by
// the sun; its light reaches the print only through their gaps.
//
// The lower canopy, the cypresses and far pines against the low sky, was
// rebaked from the HDRI at full resolution (the capture's own sun stood
// among them, and its flare had cost them their edges), so they keep their
// real needle-sharp silhouettes; here they are pressed down into
// silhouette, so they frame the glowing sky as the sharp dark under it.
// That dark is a negative's, not a digital black: shot against the light,
// the film holds them at full density, a deep blue-green-black with its
// colour kept (no grey lift from the sky), climbing through each mass from
// a dense heart to where it thins against the sky, its sunlit needles
// green-gold, and where the needles thin against bright cloud a thin rim
// of warm green light comes through them. The nearest cypress spire is the
// one sharp anchor: printed from the sharp scene, without the film's
// softness or mist. The overhead crowns' shade takes a skylight fill
// reflected off their needles (carrying their relief), and their black is
// lifted and tinted towards the sky's cobalt, so they keep their green-teal
// needles.
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
// sat: the air it answers to before it saturates (a thin twig keeps
// answering a stronger gust after the boughs have stopped), so a firm
// breath swings it clear and a gust swings it further; open: the swing
// (tuft radii) over which the hole round the sun goes from shut to open.
// limb: radius (tuft radii) round the sun over which the near crown's own
// sway is held back by hold, so a gust swings the tuft off the disc rather
// than carrying the crown over it. pinhole, heart: how far the sun's glare
// thins the needles right over the disc and over the tuft's heart; behind:
// how much thinner the crown behind the tuft is round the disc.
const TUFT = {
  r: 0.026,
  amp: 0.4,
  hz: 1.3,
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
  sat: 10,
  open: [1, 3.6],
};
// Scene light is written at 1/16 so the sun fits a half float; film adds it back.
const GAIN = 1 / 16;
// Share of the measured radiance the disc keeps. Still ~100x past the clip,
// so it reads white; much more and the film's wide diffusion fogs the
// crown 100 px (DPR 2) away.
const SUN_ND = 0.001;
// The sun on the film, in scene light (before GAIN). Two things drive it:
// E, the share of the disc that reaches the lens through the needles, and
// open, how far the tuft has swung clear of it (0 at rest .. 1 in a full
// gust), which is how wide the hole in the crown round the sun stands.
// Everything the sun puts on the print is light behind the needles that
// gets through their gaps; nothing is laid over a crown.
// The disc goes onto the film capped (cap: its brightest, scene light):
// white past the clip, and hot enough that the film's halation rings it.
// covered: the share of the disc's cap, and of the bloom, that the sun
// keeps with the tuft over it, so at rest it is a source glowing in the
// needles' pinholes, not a sticker over them.
const SUN_CAP = 40;
const SUN_COVERED = 0.15;
// The bloom: the light the lens and the emulsion scatter out of the image
// of the disc, spread round it. It is additive and energy-conserving: a
// share (scatter) of the measured sun's flux on the film (before the ND
// the disc is printed through) is laid out by a point-spread function whose
// lobes are each normalised to unit energy and weighted by share (the
// shares sum to 1), so a wider hole brings more light, never a lerp of the
// print towards a colour. Lobes (reach in frame heights):
//   core: the burn, a gaussian past the clip out to about its reach: the
//     disc as the film draws it, some 2-3x the bare disc, eating every
//     needle in front of it;
//   glow: an exponential shoulder of warm-neutral light;
//   wide: a long exponential falloff, pale cyan where it is fainter than
//     the sky under it, so it brightens the cobalt without greying it
//     (warm-neutral only where it outshines the sky several times);
//   halation: the light that went through the emulsion and came back off
//     the base into the red layer, a red-orange bleed starting at the
//     burn's edge, landing on the needles (on open sky it is lost in the
//     blue and would only turn it pink).
// covered: the share of the flux that reaches the film with the tuft over
// the disc (its pinholes): the bloom is all in proportion to it.
// The needles take the glow by how open the sky round them is (light
// wrap: their rims beside a gap lit, the thick of a crown kept dark) and,
// near the sun, whatever their cover (eat: reach in frame heights), so the
// light floods through the parting crown and eats into its mattes.
const BLOOM = {
  scatter: 0.0045,
  covered: 0.006,
  core: { share: 0.25, reach: 0.017 },
  glow: { share: 0.32, reach: 0.03 },
  wide: { share: 0.24, reach: 0.11 },
  halation: { share: 0.26, reach: 0.028, from: 0.017 },
  coreColor: [1, 0.96, 0.86],
  warm: [1, 0.9, 0.74],
  // the glow as it lands on the needles: sunlight through them, warmer
  needles: [1, 0.72, 0.42],
  cyan: [0.1, 0.64, 1],
  halationColor: [1, 0.27, 0.06],
  // the glow over the needles: its share in the thick of a crown, the mip
  // and gap band the wrap is judged by, the reach of the eat
  body: 0.08,
  wrapMip: 2.5,
  wrapGap: [0.04, 0.45],
  eat: 0.035,
  // halation's share on the thick of a crown (on open sky: body)
  halationBody: 0.45,
};
// The bloom's lobes as unit-energy kernels in frame heights: the integral
// of each profile over the plane, so a share times the flux over it is the
// lobe's peak.
const lobeArea = {
  core: (s) => Math.PI * s * s,
  exp: (s) => 2 * Math.PI * s * s,
  // exp(-max(r - a, 0) / s) over r > a: 2 pi (a s + s^2) past a, pi a^2 inside
  halation: (s, a) => 2 * Math.PI * (a * s + s * s),
};
// Faint diffraction spikes, only once the disc is actually uncovered, and
// only where they cross a gap (peak, e-folding length and half-width in
// frame heights, the long rays' extra length, the first ray's angle).
const STAR = { peak: 1.2, length: 0.006, width: 0.0005, angle: 0.42, rays: [1.6, 0.75, 1.15, 0.55, 1.3, 0.7] };
// The cumulus by the sun scatter its light forward, their thin edges
// and the sides that face the sun lit warm (cloud: always, more as the sun
// opens; reach in asset widths; probe: how far towards the sun the facing
// edge is judged, asset widths).
// The pinholes in the crown round the sun glint (peak, e-folding reach in
// frame heights, share with the hole shut, the density round a gap past
// which it counts as a pinhole).
const GLINT = { peak: 1.6, reach: 0.03, rest: 0.12, dense: 0.4 };
const SPILL = { cloud: [0.3, 0.6], cloudColor: [1, 0.8, 0.54], cloudReach: 0.17, probe: 0.014 };
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
  // The film's own halation is kept faint, off the bright cloud: the sun's
  // is drawn in its bloom (BLOOM.halation), where it lands on the needles.
  halation: 0.03,
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
// Every film setting, for the anchor's sharp print.
const FILM_PRINT = { ...FILM_DEFAULTS, ...FILM };
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
// Backlit film density on the lower and side silhouettes (the cypresses, the
// far pines, the trunks). Shot against the light, a negative holds them as
// a deep blue-green-black with full colour, not a grey lift: the skylight
// fill keeps only fill of its share (and the cool of the needles, not the
// sky's pale), and the shade is a tonal gradient through each mass (shade:
// colour per unit luminance, lift: scene light where a mass thins towards
// the sky at its tops and edges, deep: share of that left in its heart and
// towards the ground; wide: the mip the mass is judged at). The capture's
// own sunlit needles keep their light, turned green-gold (gold). Where the
// needles thin against the bright cloud or sky behind them, light comes
// through: a 1-3 px rim of warm green (trans: colour, gain on the light
// behind, the luminance band it keys on, rim: the mip the rim is judged
// against). mist: the share of the film's mist off the bright cloud taken
// back inside them (their edges keep the film's softness), so they hold
// their density beside it.
const DENSITY = {
  fill: 0.12,
  shade: [0.12, 0.88, 0.8],
  lift: 0.0035,
  deep: 0.08,
  wide: 4.5,
  gold: [1.15, 1.05, 0.42],
  trans: [0.66, 1, 0.14],
  gain: 1.3,
  key: [0.12, 1.4],
  rim: 2,
  mist: 0.6,
};
// The print's black under them: a deep blue-green-black (sRGB), where the
// overhead crowns keep TREE_TOE.
const DENSITY_TOE = [10 / 255, 22 / 255, 24 / 255];
// The one sharp anchor: the nearest cypress spire, low in the middle of the
// print, printed without the film's softness so it is the crisp dark edge
// the soft frame is measured against (asset px: centre, half-size).
const ANCHOR = { x: 858, y: 1950, rx: 100, ry: 210 };
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
// Skylight fill and the film's toe on the trees. Seen from below, the
// crowns and trunks are lit only by the sky round them, so their shade is
// never black: each layer takes the sky's own colour (the steady climb from
// zenith to treeline, not the glow by the sun) at this share of its light,
// far trees most (the air between), the overhead crown least, reflected
// off the needles (albedo: their reflectance, in their own colour) and
// carrying their relief (relief: how much of the needles' local contrast,
// in stops, it keeps), so the shade still shows needles. The fill is paler
// than the blue overhead (pale), being the whole sky, and a share of it
// (leaf) has come through other needles on its way, taking their green
// (leafColor), so the shade is green-teal, never a slate veil. On the print
// the trees' black is a negative's: lifted to TREE_TOE (sRGB), tinted
// towards the sky's cobalt, where the matte is.
const FILL = { far: 0.12, mid: 0.1, near: 0.08, albedo: 0.45, pale: 0.5, leaf: 0.5, leafColor: [0.45, 1, 0.6], relief: 2 };
const TREE_TOE = [18 / 255, 28 / 255, 40 / 255];
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
uniform vec2 uSunCap;        // the disc's cap (scene light), its share with the disc covered
uniform vec4 uBloomP;        // bloom peaks at full flux: core, glow, wide, halation (scene light)
uniform vec4 uBloomR;        // their reach (frame heights)
uniform vec4 uBloomW;        // needles: share in a crown's body, wrap mip, gap band
uniform vec4 uBloomX;        // eat reach, halation from (frame heights), flux share covered, halation share on a crown's body
uniform vec3 uBloomCore;     // colours, per unit luminance
uniform vec3 uBloomWarm;
uniform vec3 uBloomNeedle;
uniform vec3 uBloomCyan;
uniform vec3 uBloomHal;
uniform vec3 uStar;          // spikes: peak, length, half-width (frame heights)
uniform float uStarL[6];     // each spike's length, in lengths
uniform vec2 uStarB;         // first spike's angle, share once the disc is uncovered
uniform float uOpen;         // how far the tuft has swung clear, 0..1
uniform vec4 uGlint;         // pinholes by the sun: peak, reach (frame heights), share at rest, density they key on
uniform vec4 uSpillC;        // cumulus by the sun: always, as it opens; reach; probe (asset widths)
uniform vec3 uSpillK;        // the colour it lights them
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
uniform vec4 uFill;          // skylight fill: far, mid, near share; needle reflectance
uniform float uRelief;       // share of the needles' relief the fill keeps
uniform float uFillPale;     // how much paler the fill is than the sky overhead
uniform vec4 uLeaf;          // the fill's green from other needles: rgb, share
uniform vec2 uBackRoll;      // highlight roll-off: knee, pivot (scene light)
uniform vec4 uDens;          // fill share kept, shade lift, share left deep, mip of the mass
uniform vec3 uDensShade;     // the shade's colour, per unit luminance
uniform vec3 uDensGold;      // the capture's sunlit needles, turned green-gold
uniform vec4 uTrans;         // transmission rim: rgb per unit luminance, a gain
uniform vec3 uTransK;        // luminance band behind it keys on, mip of the rim
uniform vec4 uAnchor;        // the sharp spire: asset uv centre, half-size
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
// Skylight on a layer's shade: the sky's light (skyF) reflected off the
// needles' own colour at k of it, keeping their relief against the
// surround, so the shade is lifted without going flat.
vec3 skyFill(vec2 u, vec3 c, vec3 skyF, float k) {
  vec3 cb = exp2(uLog.x + textureLod(uCanopyBlur, u, 3.0).rgb * (uLog.y - uLog.x));
  float yb = max(dot(cb, LUMA), 1e-6);
  float rel = clamp(log2(max(dot(c, LUMA), 1e-6) / yb), -2.0, 1.5);
  vec3 alb = uFill.w * cb / yb;
  return skyF * alb * exp2(rel * uRelief) * k;
}
// A lower silhouette at backlit film density. c: its needles' own light
// (already pressed down), f: the skylight fill it had, u: where it is read,
// ch: its matte channel, behind: the sky and cloud behind it. The fill keeps
// a share and its relief but loses the sky's pale, so it is the needles' own
// cool green; the shade climbs from a deep heart (and the ground) to where
// the mass thins against the sky; the capture's sunlit needles go
// green-gold; and where the needles thin against bright cloud or sky the
// light comes through them, a thin warm-green rim.
vec3 dense(vec3 c, vec3 f, vec2 u, int ch, float a, vec3 behind) {
  vec4 lw = textureLod(uLayersBlur, u, uDens.w);
  vec4 lr = textureLod(uLayersBlur, u, uTransK.z);
  float aw = ch == 0 ? lw.r : lw.g;
  float ar = ch == 0 ? lr.r : lr.g;
  float heart = smoothstep(0.45, 0.97, aw) * mix(0.6, 1.0, smoothstep(0.7, 1.0, u.y));
  // The anchor spire is the deepest of them: the nearest, with the least air.
  vec2 aq = (u - uAnchor.xy) / uAnchor.zw;
  float anc = (ch == 0 ? 1.0 : 0.0) * (1.0 - smoothstep(0.6, 1.0, length(aq)));
  vec3 shade = uDensShade * uDens.y * mix(1.0, uDens.z, heart) * (1.0 - 0.5 * anc);
  float yf = dot(f, LUMA);
  vec3 fill = withLuma(uDensShade, yf * uDens.x);
  float y = dot(c, LUMA);
  vec3 own = c * mix(vec3(1.0), uDensGold, smoothstep(0.003, 0.02, y)) * (1.0 - 0.6 * anc);
  // only through needles: a trunk's smooth wood, with no needle-scale
  // texture, lets none through
  float tex = abs(lumAt(u, 0.0) - lumAt(u, 2.0));
  float rim = smoothstep(0.25, 0.8, a) * (1.0 - smoothstep(0.55, 0.97, ar)) * smoothstep(0.012, 0.05, tex);
  float yb = dot(behind, LUMA);
  vec3 tr = uTrans.rgb * (uTrans.a * rim * yb * smoothstep(uTransK.x, uTransK.y, yb));
  return own + shade + fill + tr;
}
void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y);
  vec2 uv = uCrop.xy + p * uCrop.zw;
  float sd = length((uv - uSun) * vec2(1.0, 1.0 / ASPECT));

  // Sky: summer cyan-cobalt, deepening from the horizon (asset bottom) to
  // overhead (the asset's top is past the zenith), and luminous all the way.
  vec3 col = texture(uSky, uv).rgb;
  vec3 skyTint;
  vec3 skyF;
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
    // the skylight that fills the trees' shade: the steady sky, no glow,
    // paler than the blue overhead (it is the whole sky, the pale horizon
    // and the clouds in it), part of it come through other needles
    vec3 ft = mix(tint, vec3(1.0), uFillPale);
    ft /= dot(ft, LUMA);
    skyF = withLuma(mix(ft, uLeaf.rgb / dot(uLeaf.rgb, LUMA), uLeaf.a), fl);
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

  // The transmitted energy: the disc's share that reaches the lens, from
  // the centre and a ring of taps inside the limb, through every layer.
  float E = 0.0;
  for (int i = 0; i < 9; i++) {
    float ang = float(i) * 0.7853982;
    vec2 o = i == 0 ? vec2(0.0) : 0.6 * uSunR * vec2(cos(ang), sin(ang) * ASPECT);
    vec2 s = uSun + o;
    E += (1.0 - texture(uClouds, s).a) * (1.0 - coverAt(s, uDiff)) * (i == 0 ? 0.2 : 0.1);
  }
  // The light the open sun throws round the hole: E (the disc seen) by
  // how wide the hole stands.
  float Eo = E * uOpen;

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
    // The cumulus by the sun take its light on their thin edges and on the
    // sides that face it (where, a step towards the sun, the cloud thins),
    // forward-scattered: a little always, much more with the sun open.
    vec2 toSun = normalize((uSun - uv) * vec2(1.0, 1.0 / ASPECT)) * vec2(1.0, ASPECT);
    float aS = textureLod(uCloudsBlur, uv + toSun * uSpillC.w, 2.0).a;
    float facing = smoothstep(0.02, 0.35, cl.a - aS);
    float thin = smoothstep(0.02, 0.25, cl.a) * (1.0 - smoothstep(0.4, 0.95, cl.a));
    // The open sun's extra light only on a cloud's body: a thin veil of
    // cloud over the blue lit warm would print as a grey smear.
    float spill = exp(-sd / uSpillC.z) * ((facing + 0.6 * thin) * uSpillC.x + facing * smoothstep(0.35, 0.8, cl.a) * uSpillC.y * Eo);
    Y += spill;
    float lit = max(max(smoothstep(0.5, 1.9, Y), smoothstep(0.0, 0.9, 0.5 * uCGlow.y * fwd)), smoothstep(0.0, 0.5, spill));
    vec3 shade = mix(skyTint, vec3(1.0), uCGrade.x);
    vec3 tint = mix(shade, uCKey, lit);
    vec3 own = cP / max(dot(cP, LUMA), 1e-5);
    tint = mix(tint, own, uCGlow.x * smoothstep(0.3, 0.9, cl.a));
    tint = mix(tint, uSpillK, smoothstep(0.0, 0.9, spill) * 0.7);
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
  vec3 behind = col;
  vec3 c0 = canopy(u0);
  vec3 c1 = canopy(u1);
  vec3 f0 = skyFill(u0, c0, skyF, uFill.x);
  vec3 f1 = skyFill(u1, c1, skyF, uFill.y);
  c0 *= mix(vec3(1.0), c0 / (c0 + uSil.y), sil);
  c1 *= mix(vec3(1.0), c1 / (c1 + uSil.y), sil);
  // Above the band their shade is filled by the sky round them; in it they
  // print at backlit film density.
  // The far layer is all lower and side silhouettes: it takes the density
  // from higher up the print.
  c0 = mix(c0 + f0, dense(c0, f0, u0, 0, a0, behind), uSil.x * smoothstep(0.42, 0.75, uv.y));
  col = mix(col, c0, a0);
  // Backlit: the crowns between the lens and the sun show their shaded
  // undersides. The middle ones fade out of it into the silhouettes below.
  vec3 c1u = mix(c1, underside(c1, uBack.y, skyTint), 1.0 - sil) + f1;
  // (behind the middle layer: the sky, the cloud and the far trees)
  c1 = mix(c1u, dense(c1, f1, u1, 1, a1, col), sil);
  col = mix(col, c1, a1);
  if (a2 > 0.0) {
    vec3 c2 = (canopy(ub) * ab + canopy(ut) * at) / (ab + at);
    col = mix(col, underside(c2, uBack.x, skyTint) + skyFill(ub, c2, skyF, uFill.z), a2);
  }
  // How much of the print is tree here: the film's toe lifts it (blit).
  float trees = 1.0 - (1.0 - a0) * (1.0 - a1) * (1.0 - a2);

  // The sun is a source behind every needle, never laid over them: a small,
  // very hot disc seen only through the gaps in the mattes, at the crown's
  // own diffusion (the crown is soft at this scale, so a needle never cuts
  // the disc with an edge sharper than the needles round it). What the lens
  // and the film make of the light that gets through is the bloom: light
  // added over the scene, never a veil the print is pulled towards.
  float rh = length(dv) / px / uRes.y;
  float T = 1.0;
  if (d < 1.0 + 2.0 * edge) T = 1.0 - coverAt(uv, uDiff);
  // How much of the sun reaches the film: a covered share at rest, all of
  // it as the hole stands open.
  float flux = mix(uSunCap.y, 1.0, Eo);
  vec3 sv = sun * T * (1.0 - cl.a);
  float cap = uSunCap.x * flux;
  sv *= cap / (dot(sv, LUMA) + cap);
  vec3 sl = vec3(0.0);
  if (rh < 0.6) {
    float gapS = 1.0 - trees;
    // All of it in proportion to the light through the hole: at rest the
    // burn is under the clip and the disc is the star in the pinholes.
    float bf = mix(uBloomX.z, 1.0, Eo);
    float qc = rh / uBloomR.x;
    float core = uBloomP.x * bf * exp(-qc * qc);
    float glow = uBloomP.y * bf * exp(-rh / uBloomR.y);
    float wide = uBloomP.z * bf * exp(-rh / uBloomR.z);
    float hal = uBloomP.w * bf * exp(-max(rh - uBloomX.y, 0.0) / uBloomR.w) * smoothstep(0.4 * uBloomX.y, uBloomX.y, rh);
    // Light wrap: a needle beside open sky takes the glow on its rim, the
    // thick of a crown little of it, and close to the sun every needle,
    // eaten by the light flooding past it.
    float wrap = 1.0;
    if (trees > 0.0) {
      float gapN = 1.0 - coverAt(uv, uBloomW.y);
      // (mostly once the hole opens: at rest the tuft's needles hold their
      // dark round the star, which glints in their pinholes)
      float opened = smoothstep(0.2, 0.8, Eo);
      float rim = smoothstep(uBloomW.z, uBloomW.w, gapN) * mix(0.2, 1.0, opened);
      float eat = exp(-rh / uBloomX.x) * opened;
      wrap = mix(mix(uBloomW.x + (1.0 - uBloomW.x) * rim, 1.0, eat), 1.0, gapS);
      hal *= mix(1.0, mix(uBloomX.w, 1.0, max(rim, eat)), trees);
    }
    hal *= mix(1.0, uBloomW.x, gapS * (1.0 - smoothstep(0.5, 1.0, cl.a)));
    // The shoulder's colour: pale cyan where it is fainter than what lies
    // under it (the sky keeps its cobalt, brightened), warm-neutral where it
    // outshines it; warm on cloud and needles, which it lights as sunlight.
    float yb = max(dot(col, LUMA), 1e-3);
    float hot = smoothstep(1.5, 6.0, (glow + wide) / yb);
    vec3 tint = mix(mix(uBloomCyan, uBloomWarm, max(hot, 0.8 * cl.a)), uBloomNeedle, trees);
    sl = withLuma(uBloomCore, core) + withLuma(tint, (glow + wide) * wrap) + withLuma(uBloomHal, hal);
    // The pinholes in the crown round it glint: a gap with needles all
    // round it is lit far brighter than open sky the same distance off (the
    // sun's light eats the thin needles at its rim), so at rest the glare
    // is broken into sparks by the needles, not poured into the hole.
    if (rh < 1.6 * uGlint.y) {
      float dense = smoothstep(uGlint.w, 0.9, coverAt(uv, 3.0));
      sl += withLuma(uBloomWarm, uGlint.x * smoothstep(0.35, 0.9, gapS) * dense * exp(-rh / uGlint.y) * mix(uGlint.z, 1.0, Eo));
    }
    // Faint diffraction spikes, only when the disc itself is uncovered,
    // and only where they cross a gap.
    float on = uStarB.y * smoothstep(0.35, 0.9, Eo);
    if (on > 0.0 && rh < 0.08) {
      vec2 q = dv / px / uRes.y;
      float rays = 0.0;
      for (int k = 0; k < 6; k++) {
        float th = uStarB.x + float(k) * 1.0471976;
        vec2 dir = vec2(cos(th), sin(th));
        float al = dot(q, dir);
        if (al < 0.0) continue;
        float pe = abs(dot(q, vec2(-dir.y, dir.x)));
        float len = uStar.y * uStarL[k];
        float w = uStar.z * (1.0 + 0.6 * al / len);
        rays += exp(-al / len) * exp(-(pe / w) * (pe / w));
      }
      sl += uStar.x * on * rays * gapS * vec3(1.0, 0.96, 0.9);
    }
  }
  col += sv + sl;
  outColor = vec4(col * uGain, trees);
}`;

const BLIT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uFade;
uniform vec3 uPaper;
uniform float uHueMax;       // hue ceiling for blues, in sixths of a turn
uniform sampler2D uTrees;    // the scene: tree cover in a
uniform vec3 uToe;           // the trees' lifted black, over the film's own
uniform vec3 uToeLow;        // the lower silhouettes' black, over the film's own
uniform vec4 uCrop;          // asset uv origin xy, size zw
uniform vec4 uAnchor;        // the sharp spire: asset uv centre, half-size
uniform vec3 uSoft;          // the film's softness, its spread (px), contrast
// The film's own print, for the anchor printed from the sharp scene.
uniform float uExpo;         // linear exposure, as the film's
uniform vec4 uCurve;         // its curve: a, d, b, c
uniform vec4 uLook;          // saturation, blue depth, vignette, grain
uniform vec3 uShadowT;
uniform vec3 uHighT;
uniform vec3 uFilmToe;
uniform float uSeed;
uniform float uDensMist;     // share of the mist taken back inside the lower silhouettes
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 toLin(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
// The film's tone path (exposure, vignette, blue depth, split tone,
// saturation, curve, toe) with none of its optics: no softness, no colour
// bleed, no mist.
vec3 printSharp(vec3 x) {
  vec2 res = vec2(textureSize(uTrees, 0));
  vec2 r = (vUv - 0.5) * vec2(res.x / res.y, 1.0);
  float t2 = dot(r, r) / (0.25 * (res.x * res.x / (res.y * res.y) + 1.0)) * uLook.z * uLook.z;
  x = max(x, 0.0) * uExpo / ((1.0 + t2) * (1.0 + t2));
  float sky = smoothstep(0.45, 0.9, (x.b - x.r) / (x.b + 1e-4)) * smoothstep(-0.02, 0.05, x.b - x.g) * smoothstep(0.004, 0.03, x.b);
  x = mix(x, x * vec3(0.26, 0.64, 0.66), sky * uLook.y);
  float yl = dot(x, LUMA);
  x *= mix(uShadowT, uHighT, smoothstep(-3.0, 2.0, log2(max(yl, 1e-4) / 0.18)));
  yl = dot(x, LUMA);
  x = max(mix(vec3(yl), x, mix(uLook.x, 1.0, smoothstep(0.4, 1.4, yl))), 0.0);
  x = pow(x, vec3(uCurve.x)) / (pow(x, vec3(uCurve.x * uCurve.y)) * uCurve.z + uCurve.w);
  vec3 o = toSrgb(clamp(x, 0.0, 1.0));
  o = uFilmToe + (1.0 - uFilmToe) * o;
  // the same grain the film lays in its shadows
  vec2 gp = gl_FragCoord.xy / max(0.75, res.y / 1100.0) + uSeed * vec2(17.13, 31.71);
  float g = fract(sin(dot(floor(gp), vec2(127.1, 311.7))) * 43758.5453) - 0.5;
  float ly = dot(o, LUMA);
  return o + g * uLook.w * 0.2 * (0.2 + 0.8 * smoothstep(0.0, 0.3, ly)) * 0.6;
}
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  vec2 uv = uCrop.xy + vec2(vUv.x, 1.0 - vUv.y) * uCrop.zw;
  // The anchor: the nearest cypress spire is printed without the film's
  // optical softness. The film read its luma from a 1-2 px spread; here the
  // print takes back the ratio of the sharp scene to that spread (through
  // the curve's contrast), so its edge against the cloud is one pixel.
  vec2 aq = (uv - uAnchor.xy) / uAnchor.zw;
  float anc = 1.0 - smoothstep(0.75, 1.0, length(aq));
  if (anc > 0.0) {
    vec2 o = uSoft.y / vec2(textureSize(uTrees, 0));
    float ys = dot(texture(uTrees, vUv).rgb, LUMA);
    float yn = 0.25 * dot(texture(uTrees, vUv + vec2(-o.x, -o.y)).rgb + texture(uTrees, vUv + vec2(o.x, -o.y)).rgb
      + texture(uTrees, vUv + vec2(-o.x, o.y)).rgb + texture(uTrees, vUv + vec2(o.x, o.y)).rgb, LUMA);
    const float E = 0.004;
    float r = clamp((ys + E) / (mix(ys, yn, uSoft.x) + E), 0.25, 3.0);
    c = mix(c, clamp(toSrgb(toLin(clamp(c, 0.0, 1.0)) * pow(r, uSoft.z)), 0.0, 1.0), anc);
    // ...and the spire itself (the trees in it, by their sharp matte) is
    // printed straight from the sharp scene: no mist from the cloud beside
    // it veils it, so it is the one dark that is truly dark.
    vec4 sc = texture(uTrees, vUv);
    c = mix(c, printSharp(sc.rgb), anc * smoothstep(0.5, 1.0, sc.a));
  }
  // The trees' black is a scanned negative's: the overhead crowns' lifted
  // and tinted towards the sky's cobalt, so their shade keeps its needles;
  // the lower silhouettes' a deep blue-green-black, backlit density. The sky
  // is left as is.
  float tr = texture(uTrees, vUv).a;
  float band = smoothstep(0.45, 0.85, uv.y);
  // Inside the lower silhouettes (not at their edges, which keep the film's
  // softness) much of the mist the bright cloud lays over them is taken
  // back, so they hold their density beside it instead of greying.
  if (band > 0.0 && tr > 0.85) {
    vec3 sc = texture(uTrees, vUv).rgb;
    c = mix(c, min(c, printSharp(sc)), uDensMist * band * smoothstep(0.85, 1.0, tr));
  }
  vec3 toe = mix(uToe, uToeLow, band);
  c = mix(c, toe + (1.0 - toe) * c, tr);
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

// The film's curve constants (Lottes, mid grey through, whitePoint to 1), as
// the film computes them, for the anchor's sharp print.
function filmCurve(a, d, hdrMax, mid = 0.18) {
  const ad = a * d;
  const den = (hdrMax ** ad - mid ** ad) * mid;
  const b = (-(mid ** a) + hdrMax ** a * mid) / den;
  const c = (hdrMax ** ad * mid ** a - hdrMax ** a * mid ** ad * mid) / den;
  return [a, d, b, c];
}

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
  const sat = b.drag ? TUFT.sat : GUST_MAX;
  if (m > 1e-6) {
    const k = (sat * Math.tanh(m / sat)) / m;
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
    gl.uniform4f(u.uDens, DENSITY.fill, DENSITY.lift, DENSITY.deep, DENSITY.wide);
    gl.uniform3fv(u.uDensShade, DENSITY.shade.map((c, i, a) => c / (a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722)));
    gl.uniform3fv(u.uDensGold, DENSITY.gold);
    gl.uniform4f(u.uTrans, ...DENSITY.trans.map((c, i, a) => c / (a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722)), DENSITY.gain);
    gl.uniform3f(u.uTransK, DENSITY.key[0], DENSITY.key[1], DENSITY.rim);
    gl.uniform4f(u.uAnchor, ANCHOR.x / AW, ANCHOR.y / AH, ANCHOR.rx / AW, ANCHOR.ry / AH);
    gl.uniform4f(u.uFill, FILL.far, FILL.mid, FILL.near, FILL.albedo);
    gl.uniform1f(u.uRelief, FILL.relief);
    gl.uniform1f(u.uFillPale, FILL.pale);
    gl.uniform4f(u.uLeaf, ...FILL.leafColor, FILL.leaf);
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
    gl.uniform2f(u.uSunCap, SUN_CAP, SUN_COVERED);
    {
      // The sun's flux on the film before its ND, in scene light times
      // frame heights squared: radiance over the disc's area as printed.
      const rh = (SUN.r * L.pw) / (L.crop[2] * L.ph);
      const Y = SUN.L * (SUN.color[0] * 0.2126 + SUN.color[1] * 0.7152 + SUN.color[2] * 0.0722);
      const F = BLOOM.scatter * Y * Math.PI * rh * rh;
      const { core, glow, wide, halation: h } = BLOOM;
      gl.uniform4f(
        u.uBloomP,
        (F * core.share) / lobeArea.core(core.reach),
        (F * glow.share) / lobeArea.exp(glow.reach),
        (F * wide.share) / lobeArea.exp(wide.reach),
        (F * h.share) / lobeArea.halation(h.reach, h.from),
      );
      gl.uniform4f(u.uBloomR, core.reach, glow.reach, wide.reach, h.reach);
      gl.uniform4f(u.uBloomW, BLOOM.body, BLOOM.wrapMip, BLOOM.wrapGap[0], BLOOM.wrapGap[1]);
      gl.uniform4f(u.uBloomX, BLOOM.eat, h.from, BLOOM.covered, BLOOM.halationBody);
      const unit = (c) => c.map((v) => v / (c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722));
      gl.uniform3fv(u.uBloomCore, unit(BLOOM.coreColor));
      gl.uniform3fv(u.uBloomWarm, unit(BLOOM.warm));
      gl.uniform3fv(u.uBloomNeedle, unit(BLOOM.needles));
      gl.uniform3fv(u.uBloomCyan, unit(BLOOM.cyan));
      gl.uniform3fv(u.uBloomHal, unit(BLOOM.halationColor));
    }
    gl.uniform3f(u.uStar, STAR.peak, STAR.length, STAR.width);
    gl.uniform1fv(u.uStarL, STAR.rays);
    gl.uniform2f(u.uStarB, STAR.angle, 1);
    gl.uniform4f(u.uGlint, GLINT.peak, GLINT.reach, GLINT.rest, GLINT.dense);
    gl.uniform4f(u.uSpillC, SPILL.cloud[0], SPILL.cloud[1], SPILL.cloudReach, SPILL.probe);
    gl.uniform3fv(u.uSpillK, SPILL.cloudColor);
    const tx = tuft.x - tuft.sx + tuft.fx;
    const ty = tuft.y - tuft.sy + tuft.fy;
    gl.uniform2f(u.uSil, SILHOUETTE.strength, SILHOUETTE.knee);
    gl.uniform4f(u.uTuft, tx, ty * ASPECT, TUFT.r, TUFT.pinhole);
    gl.uniform4f(u.uTuftN, TUFT.holes, TUFT.soft, TUFT.core, TUFT.edge);
    // Value noise sits round 0.5: P(v > t) ~ 0.5 - 1.6 (t - 0.5).
    gl.uniform4f(u.uTuftH, TUFT.limb, TUFT.hold, TUFT.heart, TUFT.behind);
    const swing = Math.hypot(tx, ty) / TUFT.r;
    gl.uniform3f(u.uTuftS, TUFT.cell, 0.5 + (0.5 - TUFT.stay) / 1.6, smooth(0.3, 0.9, swing));
    const open = smooth(TUFT.open[0], TUFT.open[1], swing);
    gl.uniform1f(u.uOpen, open);
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
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sceneT.tex);
    gl.uniform1i(blit.u.uTrees, 1);
    // Over the film's own black, so the trees' black lands on TREE_TOE.
    const fb = FILM.toe;
    const overFilm = (t, i) => Math.max(0, (t - fb * FILM.toeColor[i]) / (1 - fb * FILM.toeColor[i]));
    gl.uniform3f(blit.u.uToe, ...TREE_TOE.map(overFilm));
    gl.uniform3f(blit.u.uToeLow, ...DENSITY_TOE.map(overFilm));
    gl.uniform4fv(blit.u.uCrop, L.crop);
    gl.uniform4f(blit.u.uAnchor, ANCHOR.x / AW, ANCHOR.y / AH, ANCHOR.rx / AW, ANCHOR.ry / AH);
    gl.uniform3f(blit.u.uSoft, FILM.softness, 0.5 + 0.9 * FILM.softness, FILM.contrast);
    gl.uniform1f(blit.u.uExpo, 2 ** (BASE_EXPOSURE + expoStops + Math.log2(1 / GAIN) + (sceneT.ok ? 0 : 6)));
    gl.uniform4fv(blit.u.uCurve, filmCurve(FILM.contrast, FILM.shoulder, FILM.whitePoint));
    gl.uniform4f(blit.u.uLook, FILM.saturation, FILM.blueDepth, FILM.vignette, FILM.grain);
    gl.uniform3fv(blit.u.uShadowT, FILM_PRINT.shadowTint);
    gl.uniform3fv(blit.u.uHighT, FILM_PRINT.highlightTint);
    gl.uniform3f(blit.u.uFilmToe, ...FILM.toeColor.map((t) => t * FILM.toe));
    gl.uniform1f(blit.u.uSeed, grainSeed % 997);
    gl.uniform1f(blit.u.uDensMist, DENSITY.mist);
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
