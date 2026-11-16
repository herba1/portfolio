import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Polariser: a circular polarising filter on a wide lens pointed almost
// straight up, between two Dublin quay buildings, into a March cumulus sky. Turning the ring turns the
// filter's transmission axis in the image plane, and every pixel answers it
// with real optics:
//
//  - Clear sky is Rayleigh-scattered light, polarised perpendicular to the
//    plane through the sun, the eye and the point looked at, with degree
//    P = Pmax sin²γ / (1 + cos²γ), γ the angle from the sun. Its E-vector is
//    projected into the frame per pixel, so a wide lens shows the uneven,
//    tilted dark band 90° from the sun that photographers know.
//  - Cumulus is Mie-scattered and unpolarised, so it holds while the blue
//    around it falls away.
//  - The glass curtain wall reflects with Fresnel s/p reflectances at its own
//    angle of incidence (each face has a measured normal), so its reflection
//    is partially polarised and fades on one face while the other holds.
//
// The plate is a fixed stereographic render of Poly Haven's docklands_01
// HDRI at 16k, its native maximum (linear, unclipped; sun at az 38°, alt
// 28.8°, found from its brightest point and checked against the time and
// place of capture), 2x2 supersampled to 3840x4800 so the print always
// downsamples it, then turned (tools/depth/bakes/polariser/turn.py) to a
// worm's-eye view 84° up, six degrees off the zenith toward the lightship,
// rolled so the towers wall three sides of the print: the big apartment block
// leans in face-on across the whole top, the pointed tower and the glass
// block come in from the left, the red mast stands up from the bottom left,
// and the convention centre's glass drum and the far quay close the foot.
// The dark band 90° from the sun arcs diagonally through the open sky those
// walls leave, from the mast toward the top right. The orphaned fragments
// the first framing had at its edges (the construction block and red tower
// crane, lamp arms) are filled with the plate's own sky
// (tools/depth/bakes/polariser/clean.py), so the mast is the print's only
// strong warm colour; and the street furniture on the quay under the camera
// (a banner pole, signal heads, signs, lamp poles), which hung soft across
// the block's corner at the top left, is filled with the block's facade, so
// the mast is the only sharp anchor too.
// The print is not that stereographic crop: a 140° stereographic field bowed
// every roofline into a circle round the frame. Each print pixel is instead a
// direction in a general perspective projection centred on the zenith
// (VIEW below, tools/depth/bakes/polariser/view.py), looked up in the plate
// through the plate's own projection. Centred on the zenith, every vertical
// edge lands as a straight line through the vanishing point, so the towers
// converge straight; the window is shifted off the axis toward the block and
// the tower, where the height is. γ comes from that direction, so it is exact.
//
// Query: ?pol=0..1 holds the filter angle (0..180°); ?still=1 skips the
// reveal; ?grain=0 for static grain.

const PLATE = "/lab/polariser/plate.jpg";
const AUX = "/lab/polariser/aux.png";
// The clear sky behind the clouds, a smooth field baked from the plate
// (tools/depth/bakes/polariser/clearsky.py), in the plate's encoding.
const CLEAR = "/lab/polariser/clearsky.png";

// Camera of the plate (plate.py renders at 17, 89, 119; turn.py re-aims it):
// stereographic, so a plane point p = 2 d⊥ / (1 + d·f), with the plate's
// horizontal edge at hfov / 2 from the axis.
const CAM = { yaw: 120, pitch: 84, roll: 50, hfov: 149.09834806856665, aspect: 4800 / 3840 };
// The print's projection (view.py): about the zenith, r = (k + 1) sin θ /
// (k + cos θ), k = 0 rectilinear .. 1 stereographic. k = 0.5 straightens most
// of the bow out of the block's edges and the quay while the corners still
// reach 90° out, and it magnifies the rim, where the towers stand, against the
// open sky in the middle. The 4:5 window is HALF plane units half-wide,
// centred SHIFT from the image of the plate's axis (toward the pointed tower
// and down toward the quay) and turned TURN degrees about the zenith, so the
// block's corner walls the top, the tower and the glass block the left, and
// the mast, the convention centre and its glass drum the foot, and the
// vanishing point sits right of and above the centre: the towers rush toward
// it from three sides.
const VIEW = { k: 0.5, half: 1.8, shift: [-0.2, -0.1], turn: -10 };
// Mip bias on the plate and aux lookups. The print minifies the plate over
// most of the frame, and plain trilinear filtering would blend in the next
// mip down, which is coarser than the print, so the towers would come out
// upscaled and soft. Biasing a level finer keeps every blended level at or
// above the print's own resolution; the mips are box-prefiltered, so the
// window grids do not alias.
const LOD_BIAS = -0.7;
const SUN = { lon: 38.12255859375, lat: 28.762207031249996 };
const GLASS_A = [-0.85284216, 0, 0.5221688];
const GLASS_B = [-0.54538212, 0, -0.83818754];
// Plate encoding: v = (x / (1 + x))^(1/2.2), x = L * K.
const K = 0.6;
// The filter angle that deepens this frame most (mean sky transmission is
// lowest there, tools/depth/bakes/polariser/view.py, through the print's own
// projection); the hero still and the end of the reveal.
const HERO = 0.183;
// Effective maximum degree of polarisation. A clean Rayleigh sky reaches about
// 0.75, but a March cumulus sky is multiply scattered off bright cloud and a
// real circular polariser does not extinguish fully, so the band 90° from the
// sun deepens to cobalt rather than to navy. Since the filter acts only on the
// clear sky each pixel lets through (see the sky in the shader), the veils no
// longer go slate as it rises, so it sits near the clean-sky end.
const P_MAX = 0.68;
// Clear-sky dye (linear, per unit of the plate's blue) and the white balance
// that takes the 5400 K capture's cloud to warm-neutral. The zenith the plate
// now looks at is the darkest blue in the dome, so the dye is lifted to keep
// the deepest frame in cobalt; its green is held back a touch so the washed
// angle stays cerulean, not electric cyan.
const SKY_DYE = [0.03 * 2, 0.37 * 2, 2];
// Film does not hold a clear sky at full chroma: the dye clouds bleed and the
// base fog greys it. A share of the dyed blue's luminance comes back as grey,
// lifting the band toward a soft grey-cobalt instead of a poster blue.
const SKY_GREY = 0.15;
// The deep band's floor. Taken straight, the filter's 1 - P at the band and
// the plate's own mottle under it (a gap darker than the clear-sky field
// keeps that darkness as a ratio) multiplied down through the print's steep
// toe to a crushed navy, #0e3057 at the darkest 2%, darker than a real
// polarised zenith on Fuji. Its transmission f = 1 + P cos 2(phi - psi) is
// eased onto a soft floor, sqrt(f^2 + F^2), which leaves the washed side
// within a few percent and lifts only the deepest band; the mottle ratio is
// taken to MOTTLE's power, so the band lands as one luminous cyan-cobalt sweep
// (#0b4a86 at the darkest 2%, #2f6db0 through its middle) instead of a
// navy blotch.
const SKY_FLOOR = 0.5;
const MOTTLE = 0.65;
// The clear sky's saturation on the print. With the filter turned in, the
// unpolarised haze left the lower sky milky (median saturation 0.56) beside
// the deepened band; a polariser cuts that glare and the blue under it comes
// up richer. It scales the open sky's saturation by up to SKY_CHROMA, as far
// as the filter darkens it (none at the washed angle) and more on the bright
// lower sky than in the band, which the floor above already carries. Only the
// sky a cloud lets through is touched, so the cumulus keeps its roll-off.
const SKY_CHROMA = 1.18;
// Cloud white against the clear sky behind it: an open-sky pixel this many
// times as bright as the local clear sky is opaque cloud. Measured on the
// plate (clearsky.py's field), the cumulus bodies sit at a median 3.3x it,
// the thin veils at 1.3-2x and the clear sky at 0.95-1.05x.
const CLOUD_WHITE = 3.0;
// Halation: a thin warm bleed on the dark side of an edge against bright
// sky (the mast, the tower outlines), the light that went through the
// emulsion and came back off the base. It is measured in print pixels, so it
// stays thin whatever the screen. Kept low: at 1.2 it traced every tower
// edge in a 3-4 px orange line that read as a drawn contour, not a glow.
// The ring sits 2 print px out (and 4 for the wide ring), so the bleed hugs
// the edge and falls off within a few pixels instead of filling a band.
const HALO = 0.6;
const HALO_PX = 2;
const HALO_TINT = [1.0, 0.42, 0.16];
const WB = [1.1, 0.97, 0.97];
// The print: 0.9 stops over the plate's old exposure, then a log-logistic
// negative-to-print curve (contrast n, half-density exposure s, in plate units
// after that exposure) reaching paper white at 8 plate units. The half-density
// point sits high enough that cloud bodies land on the steep middle of the
// curve, not its shoulder, so their lobes keep their modelling and only the
// sunlit tops roll off.
const PRINT_STOPS = 0.9;
const PRINT_WHITE = 8;
const PRINT_CURVE = [2.0, 1.1];
// Cloud split tone. A cumulus underside is lit only by the open sky round
// it, so it takes that sky's own colour: the shadow keeps its luminance
// (times SHADE_DEPTH) and its chroma is replaced by the local polarised clear
// sky's, eased to SHADE_CHROMA (the linear print's lowest channel sits that
// far under unit luminance, 0.3-0.35 saturation on the scan in the deepest
// shadows, #6e8bad beside the left tower tip). A fixed
// multiplier only tinted what was there, and round the sun the deflared,
// burned shadows came in warm, so the tint cancelled to a grey smudge
// (#808c93) beside the blue shadows on the far side of the frame. Where the
// clear sky is too pale to carry a hue (the aureole, the clipped glare) the
// shadow falls back to SHADE, a hue-205 skylight blue in linear light.
// Sunlit tops stay a warm-neutral multiplier.
const SHADE = [0.168, 0.29, 0.402];
const SHADE_DEPTH = 0.86;
const SHADE_CHROMA = 0.34;
const SUNLIT = [1.0, 0.965, 0.9];
const VIGNETTE = 0.28;
// Burning in round the sun. The sun sits behind the cumulus between the
// apartment block and the pointed tower, and the solar aureole lifts the sky
// floor there sevenfold (0.35 to 2.7 plate units within 5°, view.py's
// survey), so the clouds round it sat on the print's shoulder as a flat grey-
// cream haze. A printer gives that corner extra exposure under the enlarger:
// BURN stops at the sun, falling off as exp(-γ / BURN_DEG), less on the towers
// than on the sky so their silhouettes do not go to soot.
const BURN = 1.7;
const BURN_DEG = 13;
// Veiling glare. Round the sun a smooth additive sheet of light lay over the
// corner: nothing there could go darker than it, so the truss and the pointed
// tower's facade sat on a raised floor and the cumulus round the sun, their
// shadows lifted toward their tops, went to cream mush. A burn only scales,
// so it darkened the sheet with everything else instead of removing it.
// Light that adds is read off the darkest things in the frame and taken away
// before the print curve (tools/depth/bakes/polariser/veil.py): on a box-
// filtered mip of the plate, the 5th-percentile luminance per tile, the lower
// envelope of those floors against the angle from the sun, fitted to
// B + A exp(-γ / deg) over the far floor B, in plate units of luminance and
// in the sheet's own colour (normalised to unit luminance).
//  - VEIL, the lens's glare, from the towers and the truss. It is small (the
//    nearest solid is 9° out, where it adds 0.02 to a 0.03 floor) and is
//    taken off every pixel in full.
//  - AUREOLE, from the open sky's darkest pixels: the light the haze scatters
//    forward round the sun, along the whole line of sight, in front of the
//    cumulus as well as the gaps. It lifts the sky's floor from 0.35 to 2.5
//    within 5°, which the towers, a few hundred metres off, hardly see. Only
//    AUREOLE_TAKE of it comes off the sky, so the aureole survives as a glow
//    round the sun while the cloud shadows near it drop back under their
//    sunlit tops.
const VEIL = { a: 0.195, deg: 5.0, colour: [1.23, 0.932, 0.994] };
const AUREOLE = { a: 3.04, deg: 14.3, colour: [0.848, 1.04, 1.051] };
const AUREOLE_TAKE = 0.6;
// The clear sky round the sun, modelled rather than read (see the sky in the
// shader). Within AUR_ZONE[0] degrees of the sun the clear-sky field is the
// plate's glare more than its sky, so the field is read at AUR_ZONE[0] on the
// same great circle and carried in along γ, and the model's lobe fades out by
// AUR_ZONE[1]. The cyan-grey glare wedge between the block and the pointed
// tower is then re-dyed and turned by the filter like the rest. MIE is the
// aureole the glare removal leaves in the sky (1 - AUREOLE_TAKE of it), in
// the warm white of forward-scattered sunlight.
const AUR_ZONE = [24, 36];

const rad = (d) => (d * Math.PI) / 180;
const lumNorm = (c) => {
  const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return c.map((v) => v / y);
};
const MIE = { a: AUREOLE.a * (1 - AUREOLE_TAKE), deg: AUREOLE.deg, colour: lumNorm([1.0, 0.98, 0.93]) };
// SHADE as a chroma offset from unit luminance, its lowest channel at -1.
const shadeC = (() => {
  const c = lumNorm(SHADE).map((v) => v - 1);
  const d = -Math.min(...c);
  return c.map((v) => v / d);
})();
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return a.map((v) => v / l);
};

function cameraBasis({ yaw, pitch, roll = 0 }) {
  const y = rad(yaw);
  const p = rad(pitch);
  const f = [Math.cos(p) * Math.sin(y), Math.sin(p), Math.cos(p) * Math.cos(y)];
  const r0 = [Math.cos(y), 0, -Math.sin(y)];
  const u0 = cross(f, r0);
  // Roll turns right and up about the forward axis.
  const c = Math.cos(rad(roll));
  const s = Math.sin(rad(roll));
  const r = r0.map((v, i) => c * v + s * u0[i]);
  const u = u0.map((v, i) => -s * r0[i] + c * v);
  return { f, r, u };
}

// The print plane's basis, tangent to the sphere at the zenith: the plate's
// right and up laid flat, turned VIEW.turn about the zenith; and the window's
// centre on that plane (y up).
function viewFrame(cam) {
  const Z = [0, 1, 0];
  const r0 = unit(cam.r.map((v, i) => v - dot(cam.r, Z) * Z[i]));
  let u0 = cross(Z, r0);
  if (dot(u0, cam.u) < 0) u0 = u0.map((v) => -v);
  const c = Math.cos(rad(VIEW.turn));
  const s = Math.sin(rad(VIEW.turn));
  const r = r0.map((v, i) => c * v + s * u0[i]);
  const u = u0.map((v, i) => -s * r0[i] + c * v);
  const g = (VIEW.k + 1) / (VIEW.k + dot(cam.f, Z));
  const centre = [dot(cam.f, r) * g + VIEW.shift[0], dot(cam.f, u) * g + VIEW.shift[1]];
  return { r, u, centre };
}

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// The scene in linear light, as it reached the film through the filter.
const SCENE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPlate;
uniform sampler2D uAux;
uniform vec4 uWin;       // print plane point = (x, y) * win.xy + win.zw (y up)
uniform vec3 uVR, uVU;   // print plane basis, tangent to the zenith
uniform float uVK;       // general perspective: 0 rectilinear .. 1 stereographic
uniform vec3 uF, uR, uU; // plate camera basis
uniform float uX;        // 2 tan(hfov / 4): stereographic half-width
uniform float uAsp;      // plate h / w
uniform float uPlateW;   // plate width, px
uniform vec3 uSun;
uniform vec3 uNA, uNB;   // glass face normals
uniform float uPhi;      // filter transmission axis, image angle, y down
uniform float uPmax;
uniform float uExpo;
uniform float uLinearOut;
uniform vec3 uSkyDye;
uniform float uSkyGrey;
uniform vec2 uSkyFloor;  // filter transmission soft floor, mottle exponent
uniform float uSkyChroma;
uniform sampler2D uClear; // the clear sky behind the clouds (clearsky.py)
uniform float uCloudWhite; // cloud white, in units of the local clear sky
uniform float uHaloPx;   // halation ring radius, print px
uniform float uHalo;
uniform vec3 uHaloTint;
uniform vec3 uWB;
uniform vec2 uPrint;     // print curve: contrast n, half-density exposure s
uniform float uVignette; // lens cos^4 falloff, before the emulsion
uniform float uPrintAsp; // print w / h
uniform vec3 uShade;     // fallback shadow chroma (unit luminance, minus 1, lowest channel -1)
uniform vec2 uShadeTone; // shadow chroma, depth
uniform vec3 uSunlit;
uniform float uLodBias;
uniform vec2 uBurn;      // stops at the sun, falloff in radians
uniform vec4 uVeil;      // lens glare at the sun (rgb, plate units), falloff in radians
uniform vec4 uAureole;   // the share of the aureole taken off the sky, likewise
uniform vec4 uMie;       // the aureole left in the sky (rgb, plate units), falloff in radians
uniform vec2 uAurZone;   // the aureole model's reach: whole inside x, gone by y (radians)

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
// Negative to print. Print density is a sigmoid in log exposure, so the
// print's transmission is a log-logistic of scene light: a toe that holds
// the quay's shadows, a steep middle where cloud bodies sit, and a short
// shoulder that rolls the sunlit tops to paper white at 8 plate units
// instead of clipping them.
vec3 printCurve(vec3 x) {
  vec3 xn = pow(max(x, 0.0), vec3(uPrint.x));
  float sn = pow(uPrint.y, uPrint.x);
  float wn = pow(${PRINT_WHITE.toFixed(1)}, uPrint.x);
  return min(xn / (xn + sn) * ((wn + sn) / wn), 1.0);
}
vec3 srgbEncode(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// Takes an additive glare v off c. Where c stands well above the glare this
// is c - v; at and below it (a pixel darker than the fitted floor, or the
// fit's error) it rolls smoothly into c² / v instead of clipping to black,
// so the deepest shadows keep their texture.
vec3 deflare(vec3 c, vec3 v) {
  c = max(c, 0.0);
  return c * c / (c + v);
}
vec3 decode(vec3 v) {
  vec3 y = pow(v, vec3(2.2));
  return y / max(1.0 - y, 0.004) * ${(1 / K).toFixed(6)};
}
const vec3 ZEN = vec3(0.0, 1.0, 0.0);
// The print's projection of a direction to its plane (y down): general
// perspective about the zenith, r = (k + 1) sin θ / (k + cos θ).
vec2 project(vec3 d) {
  d = normalize(d);
  return (uVK + 1.0) / (uVK + dot(d, ZEN)) * vec2(dot(d, uVR), -dot(d, uVU));
}
// And back: a print plane point (y up) to its direction.
vec3 unproject(vec2 q) {
  float r = length(q);
  float k1 = uVK + 1.0;
  float th = atan(r, k1) + asin(r * uVK / sqrt(k1 * k1 + r * r));
  vec2 t = q / max(r, 1e-6);
  return cos(th) * ZEN + sin(th) * (t.x * uVR + t.y * uVU);
}
// Plate uv of a direction, through the plate's stereographic projection.
vec2 plateUv(vec3 d) {
  vec2 p = 2.0 * vec2(dot(d, uR), -dot(d, uU)) / (1.0 + dot(d, uF));
  return vec2(p.x / uX, p.y / (uX * uAsp)) * 0.5 + 0.5;
}
// Image angle (y down) of a direction e tangent to the sphere at d, through
// the print's own projection, so sky and glass E-vectors land true.
float imageAngle(vec3 d, vec3 e) {
  vec2 v = project(d + e * 0.02) - project(d);
  return atan(v.y, v.x);
}
// Degree of polarisation of light reflected off glass (n = 1.52) at
// incidence cos ci, and the image angle of its s (perpendicular) E-vector.
vec2 glass(vec3 d, vec3 n) {
  float ci = clamp(-dot(d, n), 0.0, 1.0);
  float si = sqrt(1.0 - ci * ci);
  float st = si / 1.52;
  float ct = sqrt(1.0 - st * st);
  float rs = (ci - 1.52 * ct) / (ci + 1.52 * ct);
  float rp = (ct - 1.52 * ci) / (ct + 1.52 * ci);
  float Rs = rs * rs, Rp = rp * rp;
  float P = (Rs - Rp) / max(Rs + Rp, 1e-5);
  return vec2(P, imageAngle(d, normalize(cross(d, n))));
}

void main() {
  vec3 d = unproject((vUv * 2.0 - 1.0) * uWin.xy + uWin.zw);
  vec2 puv = plateUv(d);
  vec3 enc = texture(uPlate, puv, uLodBias).rgb;
  vec3 aux = texture(uAux, puv, uLodBias).rgb;
  float cg = dot(d, uSun);
  float gam = acos(clamp(cg, -1.0, 1.0));
  // The plate's veiling glare, taken off first: everything below (the sky
  // unmix, the halation, the glass, the burn and the print curve) works on
  // the scene as it would have been without it.
  vec3 veil = uVeil.rgb * exp(-gam / uVeil.w);
  vec3 veilSky = veil + uAureole.rgb * exp(-gam / uAureole.w);
  vec3 C = deflare(decode(enc), mix(veil, veilSky, aux.r));

  // Sky: every open-sky pixel is cloud laid over clear sky. The clear sky
  // behind it, S, is the plate's clear-sky-only field (clearsky.py: the
  // cloud-free pixels spread under the clouds and blurred to the dome's own
  // gradient), and the cloud's opacity is how far the pixel's light rises
  // above it toward cloud white: alpha = (L - Ls) / (Lw - Ls). Only the sky
  // the cloud lets through is polarised:
  //   out = cloudLight * alpha + (1 - alpha) * polarisedSky.
  // The cloud's own light is what the pixel has over the sky it lets through,
  // L - (1 - alpha) Ls, in the pixel's own colour, so a veil stays a white
  // veil, its sky goes cobalt under it, and it darkens toward the band round
  // it in proportion to how transparent it is instead of freezing as grey
  // slate where a chroma unmix read it as neutral. The bodies step forward
  // whole. A pixel darker than the field is all sky, and keeps its own
  // darkness as a ratio of the polarised sky, so the deep band is the field's
  // one continuous sweep and the plate's mottle is not dyed into bruises.
  float P = uPmax * (1.0 - cg * cg) / (1.0 + cg * cg);
  float psi = imageAngle(d, normalize(cross(uSun, d)));
  // Near paper white the plate's encoding is too flat to read: a few code
  // values of difference decode to a tenfold change, so the aureole's
  // near-clipped sky round the sun is glare and cloud, not clear sky.
  float clipped = smoothstep(0.88, 0.96, max(enc.r, max(enc.g, enc.b)));
  // So round the sun the clear sky is modelled, not read: the field where it
  // is still sound, at uAurZone.x from the sun on the same great circle, its
  // Rayleigh part carried in by (1 + cos²γ), plus the forward-scattered Mie
  // lobe the glare removal leaves in the sky, warm white and unpolarised.
  // It is smooth in γ, so the glare streaks in the plate cannot get into the
  // sky behind them, and the filter's own P -> 0 at the sun, not a gate,
  // keeps the light nearest it unpolarised.
  float gR = max(gam, uAurZone.x);
  vec3 tS = d - cg * uSun;
  tS = dot(tS, tS) > 1e-8 ? normalize(tS) : uVR;
  float cR = cos(gR);
  vec3 veilR = uVeil.rgb * exp(-gR / uVeil.w) + uAureole.rgb * exp(-gR / uAureole.w);
  vec3 Sray = deflare(decode(texture(uClear, plateUv(cR * uSun + sin(gR) * tS)).rgb), veilR) * ((1.0 + cg * cg) / (1.0 + cR * cR));
  vec3 mie = uMie.rgb * exp(-gam / uMie.w);
  float zone = aux.r * (1.0 - smoothstep(uAurZone.x, uAurZone.y, gam));
  vec3 S = Sray + mie * zone;
  float Ls = dot(S, LUMA);
  float L = dot(C, LUMA);
  float alpha = clamp((L - Ls) / max((uCloudWhite - 1.0) * Ls, 1e-3), 0.0, 1.0);
  // The clear sky's Rayleigh part, by its chroma (the field is smooth, so the
  // unmix is too), re-dyed toward the cobalt a Fuji negative gives a clear
  // sky and turned by the filter; its neutral, unpolarised haze stays.
  float As = clamp((0.85 * Sray.b - Sray.r) / 0.56, 0.0, Sray.b);
  float f = 1.0 + P * cos(2.0 * (uPhi - psi));
  f = sqrt(f * f + uSkyFloor.x * uSkyFloor.x);
  vec3 dyed = As * uSkyDye * f;
  dyed = mix(dyed, vec3(dot(dyed, LUMA)), uSkyGrey);
  vec3 polSky = S - As * vec3(0.29, 0.58, 1.0) + dyed;
  // A cloud's own light is the sun's, scattered forward. Near the sun and
  // near paper white the plate's colour is the glare's (a cyan-grey cast),
  // so there the cloud takes the Mie lobe's warm white at its own luminance;
  // its shadowed bodies, darker, keep their own colour.
  float glare = zone * smoothstep(0.7, 0.88, max(enc.r, max(enc.g, enc.b)));
  vec3 cloudCol = mix(C / max(L, 1e-4), uMie.rgb / max(dot(uMie.rgb, LUMA), 1e-4), glare);
  vec3 cloudPart = cloudCol * max(L - (1.0 - alpha) * Ls, 0.0);
  vec3 skyOut = cloudPart + (1.0 - alpha) * pow(min(L / max(Ls, 1e-4), 1.0), uSkyFloor.y) * polSky;
  // Open sky only: the towers, the mast and, away from the sun, the clipped
  // cloud tops keep their own light. Round the sun the aureole model holds
  // the gate open.
  float gate = aux.r * (1.0 - clipped * (1.0 - zone));
  vec3 Cout = mix(C, skyOut, gate);
  // The share of the pixel that is open sky seen through the cloud.
  float t = (1.0 - alpha) * gate;

  // Halation: the surround's light, a few print pixels wide, where it is
  // brighter than the pixel itself (the dark side of an edge against sky).
  // Light reaches the base mostly through the red-sensitive layer, so the
  // spill is read on red: the sunlit red mast halates onto the sky beside it
  // as well as the bright sky onto the tower edges.
  // Eight taps on a ring HALO_PX print px out, each a mip about half that
  // wide, and a ring at twice the radius: a smooth surround, no mip blocks.
  // The print magnifies the plate unevenly, so the ring is laid out through
  // the local plate-per-print-pixel derivatives.
  vec2 jx = dFdx(puv) * uHaloPx;
  vec2 jy = dFdy(puv) * uHaloPx;
  float haloLod = max(0.0, log2(max(1.0, max(length(jx), length(jy)) * uPlateW * 0.5)));
  vec3 near = vec3(0.0);
  vec3 wide = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float t = float(i) * 0.785398 + 0.39;
    vec2 o = cos(t) * jx + sin(t) * jy;
    near += decode(textureLod(uPlate, puv + o, haloLod).rgb);
    wide += decode(textureLod(uPlate, puv + 2.0 * o, haloLod + 1.0).rgb);
  }
  // The surround is mostly sky; the glare comes off it as off the sky.
  near = deflare(near * 0.125, veilSky);
  wide = deflare(wide * 0.125, veilSky);
  vec3 sur = 0.6 * near + 0.4 * wide;
  float spill = max(sur.r - C.r, 0.0);
  // Only on the dark side of the edge (the towers). Spilled onto the sky it
  // read the bright cumulus as a surround and laid a warm veil over the blue
  // between the cloud lobes, which greyed the cloud edges into a smear.
  float halo = min(spill, 0.8) * (1.0 - aux.r);
  // The red mast is the one strongly red source in the frame: its own red
  // excess spreads out over the sky round it as a warm glow.
  // Only off the red itself, so the hull's own texture does not speckle.
  float exSur = max(sur.r - sur.b, 0.0);
  float exOwn = max(C.r - C.b, 0.0);
  halo += 12.0 * exSur * (1.0 - smoothstep(0.0, 0.5, exOwn / max(exSur, 1e-3)));
  Cout += uHaloTint * uHalo * halo;

  // Glass: the reflected share of the pixel, partially s-polarised.
  vec2 ga = glass(d, uNA);
  vec2 gb = glass(d, uNB);
  float refl = 0.82;
  Cout += C * refl * aux.g * ga.x * cos(2.0 * (uPhi - ga.y));
  Cout += C * refl * aux.b * gb.x * cos(2.0 * (uPhi - gb.y));

  Cout = max(Cout, 0.0) * uExpo * uWB;
  // Burned in round the sun.
  Cout *= exp2(-uBurn.x * exp(-gam / uBurn.y) * (0.45 + 0.55 * aux.r));
  // The lens's cos^4 falloff reaches the emulsion before the print curve, so
  // it compresses in the cloud tops the way it does on a real print.
  vec2 rv = (vUv - 0.5) * vec2(uPrintAsp, 1.0);
  float t2 = dot(rv, rv) / (0.25 * (uPrintAsp * uPrintAsp + 1.0)) * uVignette * uVignette;
  Cout /= (1.0 + t2) * (1.0 + t2);

  vec3 print = printCurve(Cout);
  // A saturated blue taken through a steep per-channel curve swings its hue:
  // blue reaches the shoulder while green is still on the straight line, so
  // a bright, washed sky would go electric cyan. Hold the clear sky's hue by
  // grading half its Rayleigh share on its brightest channel.
  float mc = max(Cout.r, max(Cout.g, Cout.b));
  vec3 held = Cout * (printCurve(vec3(mc)).r / max(mc, 1e-5));
  // The veils' sky is held too: let off the hold, the thin cloud edges over
  // the dyed sky swung to a cyan fringe.
  float rayleigh = t * As / max(S.b, 1e-4);
  print = mix(print, held, 0.5 * rayleigh);
  // The clear sky's chroma, lifted on the print as the scan encodes it:
  // every channel pushed away from the brightest, so the saturation scales
  // by SKY_CHROMA while the hue and the brightest channel hold. Pushed off
  // grey in the scene instead, the red fell faster than the green through
  // the curves and the sky swung toward electric cyan.
  vec3 e = pow(max(print, 0.0), vec3(1.0 / 2.2));
  float em = max(e.r, max(e.g, e.b));
  e = max(vec3(em) - (em - e) * mix(1.0, uSkyChroma, t * (1.0 - smoothstep(0.8, 1.4, f)) * mix(0.5, 1.0, smoothstep(0.1, 0.35, dot(print, LUMA)))), 0.0);
  print = pow(e, vec3(2.2));

  // Split tone the cumulus. A cloud's sunlit top is lit by the low sun; its
  // shadowed underside only by the open sky around it, so it goes blue-grey
  // (hue ~205) while the tops roll off warm. Only the neutral, non-Rayleigh
  // share of an open-sky pixel is cloud; the quay and the mast are left alone.
  // The gate opens only on near-opaque cloud: a linear gate pressed the dark
  // shade into every part-sky pixel too, so a translucent veil came out a
  // straight-edged slate smear between sky and cloud.
  float cloud = aux.r * smoothstep(0.45, 0.9, alpha);
  float Y = dot(print, LUMA);
  float lit = smoothstep(0.4, 0.85, Y);
  // The shadow side takes the local skylight: the polarised clear sky's
  // chroma at unit luminance, scaled so its lowest channel sits uShadeTone.x
  // under the rest, so the deep band and the pale sky by the horizon both
  // give a skylight blue of one strength in their own hue. It replaces the
  // shadow's chroma rather than multiplying it, so the warm cast the burn and
  // the glare removal leave round the sun cannot cancel it to grey.
  // The Rayleigh sky's, not the aureole's: the cloud's shadow sees the dome.
  vec3 polRay = polSky - mie * zone;
  vec3 skyC = polRay / max(dot(polRay, LUMA), 1e-4) - 1.0;
  float skyD = -min(skyC.r, min(skyC.g, skyC.b));
  vec3 shadeC = mix(uShade, skyC / max(skyD, 1e-3), smoothstep(0.15, 0.4, skyD));
  vec3 shadow = Y * uShadeTone.y * max(1.0 + uShadeTone.x * shadeC, 0.0);
  print = mix(print, shadow, (1.0 - lit) * cloud);
  print *= mix(vec3(1.0), uSunlit, lit * cloud);
  // Paper white: the print's base never scans as a full 255.
  print = clamp(print, 0.0, 1.0) * 0.985;

  outColor = vec4(uLinearOut > 0.5 ? print : srgbEncode(print), 1.0);
}`;

// The developed print on paper.
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
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

// The plate is 3840x4800; a GPU that caps textures below that gets it
// halved (or more) through a canvas rather than a failed upload.
function fitTexture(gl, img) {
  const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (Math.max(w, h) <= max) return img;
  let s = 1;
  while (Math.max(w, h) * s > max) s /= 2;
  const c = document.createElement("canvas");
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function imageTexture(gl, img, mips) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, fitTexture(gl, img));
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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

// Expo-out, the reveal curve.
const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const wrapPi = (a) => {
  // Shortest signed difference for an axis (period π).
  a %= Math.PI;
  if (a > Math.PI / 2) a -= Math.PI;
  if (a < -Math.PI / 2) a += Math.PI;
  return a;
};
const wrap2Pi = (a) => {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
};

const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];

export async function createPolariser(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const polQ = q.get("pol");
  const held = polQ != null && polQ !== "" && Number.isFinite(+polQ);
  const still = held || q.get("still") === "1";
  const grainOn = q.get("grain") !== "0";
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");
  stage.canvas.style.cursor = "grab";

  const [plateImg, auxImg, clearImg] = await Promise.all([loadImage(PLATE), loadImage(AUX), loadImage(CLEAR)]);
  const plate = imageTexture(gl, plateImg, true);
  const aux = imageTexture(gl, auxImg, true);
  const clear = imageTexture(gl, clearImg, false);

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

  const cam = cameraBasis(CAM);
  const view = viewFrame(cam);
  const sun = [Math.cos(rad(SUN.lat)) * Math.sin(rad(SUN.lon)), Math.sin(rad(SUN.lat)), Math.cos(rad(SUN.lat)) * Math.cos(rad(SUN.lon))];

  // The hairline index: the filter's axis as a diameter of a small ring,
  // under the print's right edge. It is the only mark on the page.
  const NS = "http://www.w3.org/2000/svg";
  const mark = document.createElementNS(NS, "svg");
  mark.setAttribute("class", "pol-mark");
  mark.setAttribute("viewBox", "-12 -12 24 24");
  mark.setAttribute("aria-hidden", "true");
  const ring = document.createElementNS(NS, "circle");
  ring.setAttribute("r", "9");
  const axis = document.createElementNS(NS, "line");
  axis.setAttribute("x1", "-9");
  axis.setAttribute("x2", "9");
  mark.append(ring, axis);
  host.appendChild(mark);

  // Layout, in css px of the box.
  const L = { x: 0, y: 0, w: 1, h: 1, cx: 0.5 };
  let sceneT = null;
  let filmT = null;
  const layout = (W, H, dpr) => {
    if (embedded) {
      Object.assign(L, { x: 0, y: 0, w: W, h: H });
    } else {
      // A 4:5 print on every screen: looking straight up is a vertical
      // picture, the quay at its foot and the sky opening above.
      const side = W / H < 0.9 ? Math.max(16, Math.round(W * 0.06)) : Math.max(24, W * 0.07);
      let w = W - side * 2;
      let h = w * 1.25;
      const hMax = H * (W / H < 0.9 ? 0.74 : 0.84);
      if (h > hMax) {
        h = hMax;
        w = h / 1.25;
      }
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 - 12 });
    }
    // Snap to device pixels so the print edge is crisp.
    L.x = Math.round(L.x * dpr) / dpr;
    L.y = Math.round(L.y * dpr) / dpr;
    L.w = Math.round(L.w * dpr) / dpr;
    L.h = Math.round(L.h * dpr) / dpr;
    L.pw = Math.max(2, Math.round(L.w * dpr));
    L.ph = Math.max(2, Math.round(L.h * dpr));
    freeTarget(gl, sceneT);
    freeTarget(gl, filmT);
    sceneT = target(gl, L.pw, L.ph, floatOk);
    if (!sceneT.ok) {
      freeTarget(gl, sceneT);
      sceneT = target(gl, L.pw, L.ph, false);
    }
    filmT = target(gl, L.pw, L.ph, false);
    film.resize(L.pw, L.ph);
    mark.style.display = embedded ? "none" : "";
    mark.style.left = `${L.x + L.w - 20}px`;
    mark.style.top = `${L.y + L.h + 16}px`;
    dirty = true;
  };

  // State.
  // ?still=1 without ?pol shows the hero; the reveal starts from the washed angle.
  let phi = held ? clamp(+polQ, 0, 1) * Math.PI : HERO * Math.PI + (still ? 0 : Math.PI / 2);
  let omega = 0; // rad/s, carried after release
  let dragging = false;
  let touched = held;
  let dirty = true;
  let t0 = -1;
  let time = 0;
  let grainClock = 0;
  let grainSeed = 0;
  let last = null;

  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  // The gesture is the ring: angular motion about the print's centre, with
  // a horizontal fallback near the centre where the angle is undefined.
  const angleDelta = (a, b) => {
    const cx = L.x + L.w / 2;
    const cy = L.y + L.h / 2;
    const ax = a.x - cx;
    const ay = a.y - cy;
    const bx = b.x - cx;
    const by = b.y - cy;
    const r = Math.hypot(bx, by);
    const ang = wrap2Pi(Math.atan2(by, bx) - Math.atan2(ay, ax));
    const lin = ((b.x - a.x) / Math.max(1, L.w)) * Math.PI * 0.9;
    const w = clamp(r / (Math.min(L.w, L.h) * 0.3), 0, 1);
    return ang * w + lin * (1 - w);
  };
  stage.on("down", (p) => {
    dragging = true;
    touched = true;
    omega = 0;
    last = { x: p.x, y: p.y, t: performance.now() };
    stage.canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (!dragging || !last) return;
    const now = performance.now();
    const dphi = angleDelta(last, p);
    phi += dphi;
    const dt = Math.max(1, now - last.t) / 1000;
    omega += (dphi / dt - omega) * Math.min(1, dt / 0.05);
    last = { x: p.x, y: p.y, t: now };
    dirty = true;
  });
  stage.on("up", () => {
    dragging = false;
    stage.canvas.style.cursor = "grab";
    if (last && performance.now() - last.t > 60) omega = 0;
    last = null;
  });

  // Keyboard: the arrow keys turn the ring a few degrees.
  host.tabIndex = embedded ? -1 : 0;
  const onKey = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    touched = true;
    omega += (e.key === "ArrowRight" ? 1 : -1) * 2.2;
    dirty = true;
  };
  host.addEventListener("keydown", onKey);

  const draw = (expoStops, fade) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);

    // Window: cover-fit the print aspect into the 4:5 window on the print
    // plane (every other aspect is a crop of it), breathing a few thousandths
    // of its width.
    const pa = L.pw / L.ph;
    let hx = VIEW.half;
    let hy = VIEW.half * 1.25;
    if (pa >= 0.8) hy = hx / pa;
    else hx = hy * pa;
    const b = reduce || still ? [0, 0] : [Math.sin(time * ((2 * Math.PI) / 11)) * 0.0028, Math.sin(time * ((2 * Math.PI) / 13.7) + 1.1) * 0.0022];

    const u = scene.u;
    gl.useProgram(scene.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, plate);
    gl.uniform1i(u.uPlate, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, aux);
    gl.uniform1i(u.uAux, 1);
    gl.uniform4f(u.uWin, hx, hy, view.centre[0] + b[0] * 2 * hx, view.centre[1] - b[1] * 2 * hy);
    gl.uniform3fv(u.uVR, view.r);
    gl.uniform3fv(u.uVU, view.u);
    gl.uniform1f(u.uVK, VIEW.k);
    gl.uniform1f(u.uPlateW, plateImg.naturalWidth);
    gl.uniform3fv(u.uF, cam.f);
    gl.uniform3fv(u.uR, cam.r);
    gl.uniform3fv(u.uU, cam.u);
    gl.uniform1f(u.uX, 2 * Math.tan(rad(CAM.hfov) / 4));
    gl.uniform1f(u.uAsp, CAM.aspect);
    gl.uniform3fv(u.uSun, sun);
    gl.uniform3fv(u.uNA, GLASS_A);
    gl.uniform3fv(u.uNB, GLASS_B);
    gl.uniform1f(u.uPhi, phi);
    gl.uniform1f(u.uPmax, P_MAX);
    gl.uniform1f(u.uExpo, 0.5 * 2 ** (PRINT_STOPS + expoStops));
    gl.uniform2fv(u.uPrint, PRINT_CURVE);
    gl.uniform1f(u.uVignette, VIGNETTE);
    gl.uniform1f(u.uPrintAsp, L.pw / L.ph);
    gl.uniform3fv(u.uShade, shadeC);
    gl.uniform2f(u.uShadeTone, SHADE_CHROMA, SHADE_DEPTH);
    gl.uniform3fv(u.uSunlit, SUNLIT);
    gl.uniform1f(u.uLodBias, LOD_BIAS);
    gl.uniform2f(u.uBurn, BURN, rad(BURN_DEG));
    gl.uniform4f(u.uVeil, ...VEIL.colour.map((v) => v * VEIL.a), rad(VEIL.deg));
    gl.uniform4f(u.uAureole, ...AUREOLE.colour.map((v) => v * AUREOLE.a * AUREOLE_TAKE), rad(AUREOLE.deg));
    gl.uniform4f(u.uMie, ...MIE.colour.map((v) => v * MIE.a), rad(MIE.deg));
    gl.uniform2f(u.uAurZone, rad(AUR_ZONE[0]), rad(AUR_ZONE[1]));
    gl.uniform3fv(u.uSkyDye, SKY_DYE);
    gl.uniform1f(u.uSkyGrey, SKY_GREY);
    gl.uniform2f(u.uSkyFloor, SKY_FLOOR, MOTTLE);
    gl.uniform1f(u.uSkyChroma, SKY_CHROMA);
    gl.uniform1f(u.uCloudWhite, CLOUD_WHITE);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, clear);
    gl.uniform1i(u.uClear, 2);
    gl.uniform1f(u.uHaloPx, HALO_PX);
    gl.uniform1f(u.uHalo, HALO);
    gl.uniform3fv(u.uHaloTint, HALO_TINT);
    gl.uniform3fv(u.uWB, WB);
    gl.uniform1f(u.uLinearOut, floatOk && sceneT.ok ? 1 : 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, L.pw, L.ph);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    film.render(
      sceneT.tex,
      {
        ...FILM_PRESETS.summer,
        // The scene pass hands over the finished print (display light, 0..1),
        // so the film's own curve is the identity: Lottes with contrast 1,
        // shoulder 1 and white at 1 is y = x. The film adds only what happens
        // in the emulsion and the scan: softness, Pro-Mist, halation, grain.
        // Pro-Mist and halation only take the highlights past a threshold, and
        // the halation judges saturation from its surround: spread from every
        // pixel, they veiled the bright cumulus near the sun into a flat grey
        // haze and fringed the tower edges orange.
        input: floatOk && sceneT.ok ? "linear" : "srgb",
        headroom: 0,
        exposure: 0,
        whitePoint: 1,
        contrast: 1,
        shoulder: 1,
        blueDepth: 0.25,
        highlightTint: [1, 0.99, 0.97],
        saturation: 1.05,
        halation: 0.1,
        halationThreshold: 0.9,
        halationLocal: 1,
        bloom: 0.06,
        bloomThreshold: 0.75,
        softness: 0.4,
        toe: 0.04,
        grain: 0.32,
        vignette: 0,
        grainSeed,
      },
      filmT.fbo,
    );

    // Paper, then the print.
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

    axis.setAttribute("transform", `rotate(${((phi * 180) / Math.PI).toFixed(2)})`);
  };

  // Reveal: the print comes up overexposed, an airy white-blue, and settles
  // over two seconds while the ring turns from the washed angle into the
  // deepest one, the way the eye adjusts to a bright sky.
  const REVEAL = 2.0;
  const TURN = 2.4;
  const TURN_DELAY = 0.35;
  const phiFrom = phi;
  const phiTo = phiFrom + wrapPi(HERO * Math.PI - phiFrom);

  stage.onFrame((dt) => {
    if (!sceneT) return;
    time += dt;
    if (t0 < 0) t0 = time;
    const age = time - t0;
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) {
        fade = clamp(age / 0.3, 0, 1);
        if (!touched) phi = phiTo;
      } else {
        expo = 2.5 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
        if (!touched) phi = phiFrom + (phiTo - phiFrom) * expoOut(clamp((age - TURN_DELAY) / TURN, 0, 1));
      }
      if (age < Math.max(REVEAL, TURN + TURN_DELAY) + 0.1) dirty = true;
    }

    // Inertia after release (friction, tau ≈ 220 ms).
    if (!dragging && Math.abs(omega) > 1e-3) {
      phi += omega * dt;
      omega *= Math.exp(-dt / 0.22);
      dirty = true;
    } else if (!dragging) omega = 0;

    // Grain moves at 24 fps; the camera breathes with it.
    if (grainOn && !reduce && !still) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        grainSeed = (grainSeed + 1) % 997;
        dirty = true;
      }
    }
    if (!dirty) return;
    dirty = false;
    draw(expo, fade);
  });

  return {
    destroy() {
      host.removeEventListener("keydown", onKey);
      mark.remove();
      film.destroy();
      freeTarget(gl, sceneT);
      freeTarget(gl, filmT);
      gl.deleteTexture(plate);
      gl.deleteTexture(aux);
      gl.deleteTexture(clear);
      gl.deleteProgram(scene.p);
      gl.deleteProgram(blit.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
