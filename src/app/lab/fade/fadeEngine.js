import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Fade: a lane in Cinque Terre seen from the cobbles, looking straight up
// between painted houses into a summer sky, and the thirty years of sun that
// come after it. Drag forward and every wall ages by the light it actually
// receives: the top floors, open to the whole sky, bleach and chalk first;
// the low storeys, which see only the slot of sky between the eaves, keep
// their colour longest.
//
// The bake (tools/depth/bakes/fade) takes Victor Rosario's photograph apart:
//  - light.webp R: the annual solar dose per pixel. MoGe-2's metric point map
//    is marched toward 144 sun positions over a year at 44 N (12 days x 12
//    hours, clear-sky beam x the Ligurian coast's sunshine fraction) plus the
//    sky-view factor x diffuse, normalised so an open south wall is 1. The
//    camera looks almost straight up, so world up is recovered from the walls
//    themselves (every facade is vertical), and the lane's orientation from
//    the photo's own sun, fitted on the walls' shading one paint at a time.
//    The houses across the lane carve the shade out of it. Then the thin
//    things that have hung there for decades (the open shutter leaves, the
//    lanterns and their brackets, the gelato sign, the drying lines, hooks
//    and rods: SAM masks and black-hat lines, stood off their walls) are
//    marched again at half the plate's resolution, each wall pixel along
//    72 suns over the year (six days by twelve hours, weighted by their beam
//    on its plane) and over its sky, so each takes the share of the sun's
//    path it covers: a shutter leaf or a lantern leaves a firm tan of its own
//    shape, the "something hung here for thirty years" mark, while a drying
//    cord a few cm off the plaster, whose shadow sweeps a hand's width either
//    way through the day (and is marched at its own 5 mm, not the width of
//    the black-hat line that found it), leaves only a faint soft trace.
//    The march only sees what is in the frame, and the frame holds almost
//    none of the low storeys across the lane, so it was generous to the low
//    storeys of every wall. The far wall is put back analytically (canyon.py):
//    each pixel's height above the lane from MoGe-2, a lane a few metres
//    wide whose far wall stands as high as the skyline above it, and the
//    share of the beam and the sky that wall takes, 1 - sin of its
//    elevation: the slot of sky.
//  - light.webp G: the photo's own illumination: the lane is in high sun, so
//    one sun level (the white trim reflecting 0.85) plus a sky share by view
//    factor, and albedo = photo / S.
//  - light.webp B: the share of the dose those thin occluders take (the tan
//    lines), which also keeps the wash's wear off the paint behind them.
//  - light.webp A: 1 - sign / 2, the gelato sign's SAM mask: enamelled metal
//    standing in the lane, which no ledge sheds water down, so it fades
//    evenly, with no runoff tails, drips or patches.
//  - mat.webp: how each pixel ages: the render fades per pigment and its
//    lime binder chalks, the one bare stone wall barely moves, the sky and
//    its cloud are inert.
//
// Live, per pixel, with e = years x dose x susceptibility, where the dose is
// the baked one on a cubic curve: paint holds below a threshold and fails
// fast above it, so in thirty years the top floors in the whole sky give up
// most of their colour (pink to chalk, orange to pale apricot, yellow to
// cream) while the low storeys in their slot of it and the coral wall facing
// north keep theirs:
//  - ink: albedo -> optical density per channel; the neutral part is carbon
//    black, the rest is cyan (absorbs red), magenta (green) and yellow (blue),
//    each fading exponentially, yellow and magenta about 4x faster than cyan,
//    so reds and yellows go first (dark shutter green is mostly neutral
//    density, which barely moves); what the inks' differential rates do to a
//    coat's hue is capped at a few degrees (in Oklab), and a residual tint of
//    the paint always stays, so a coat loses chroma and gains value but
//    keeps its family;
//  - wood: lignin breaks down and brown wood goes silver grey (unused here:
//    every surface in this photo is painted or stone);
//  - chalk: the binder erodes and the white pigment powders out, lifting the
//    paint towards a lime render's white (#EEE8DD: neutral, a touch warm,
//    never paper white), most of the way on the top floors, which keep a
//    residual tint at their own hue under the bloom (pale dusty pink, pale
//    apricot, not one cream for every house),
//    and hardly at all on what is dark in the photo (window voids, the gaps
//    behind shutters), which is not render. It comes in with the dose on a
//    soft knee and climbs slowly, so a wall grades from bloom under its eave
//    to its own colour down its storeys instead of saturating into patches;
//  - and the dose itself is taken down to the scale of a ledge, baked once at
//    load in the wall's own frame (up is toward the verticals' vanishing
//    point, across is the angle around it): every sill, cornice and eave (an
//    edge across the vertical) shelters a ragged strip below it that keeps
//    its paint; the water it collects leaves it at its ends, at the feet of
//    window frames and at drip points along an eave, and bleaches a thin
//    runoff tail down the wall below, fading over a few hundred px; and the
//    open wall weathers in thin drips along its vertical, not in patches;
// then photo + S x (aged albedo - albedo), its chalk lift capped near L* 85
// and the plate's own fine texture multiplied back over the lime (chalk is a
// matte powder, not a highlight), developed by the shared film kit, twice
// once a coat has chalked: the chalked walls take the development without
// the diffusion and the halation, which stay on the cloud tops.
//
// The sky, last: the photo's own is a pale, hazy powder blue, which leaves
// the bleached walls nothing to read against. A polariser, turned to the
// sky's 90 degrees from the sun (here the whole frame: the sun is high and
// the lens looks straight up), cuts the polarised skylight and the haze but
// not the cloud. So, on MoGe-2's sky only (mat.webp carries it: the sky is
// 1 - (2 R - B / 0.85)), each pixel is split into clear sky and cloud by how
// much of the clear sky's blue chroma it still holds; the clear part is
// re-shot as a deep cyan-cobalt that deepens radially toward the zenith at
// the frame's centre (dithered, so the 8-bit scene target never bands), and
// the cloud keeps its own light, its thin edges and undersides taking
// skylight blue, its tops rolled softly under paper white. After the film,
// the scan's lifted black is taken back out over the sky alone.
//
// Query: ?years=0..30 holds the clock; ?still=1 skips the reveal; ?film=0
// shows the aged frame before the film; ?debug=dose shows the dose map;
// ?debug=local shows the dose with its ledge shelter, tails and drips;
// ?debug=runoff shows the bake (R shelter, G runoff tails, B drips); ?sky=0
// shows the sky as shot.

const BASE = "/lab/fade/";
const PW = 2000;
const PH = 1500;
const YEARS = 30;
const OPEN_AT = 3.2;
// Fade rates per unit dose-year (1 = a year on an open south wall).
// Each surface first spends an induction dose (its UV absorbers and
// stabilisers are used up), so what stays in shade never really starts.
const K_INK = [0.03, 0.13, 0.16]; // cyan, magenta, yellow
const K_BLACK = 0.004;
const K_WOOD = 0.1;
const K_CHALK = 0.1;
// Most of the most exposed surface powders to bare lime: the top floor goes to
// pale plaster, a trace of its own hue still under the bloom (mat.webp's B
// is 0.85 on render, so this is a bloom of about 0.9 on open paint).
const CHALK_MAX = 1.05;
const INDUCTION = 2.5;
// Chalking needs the film itself to erode: only well-exposed paint gets there.
const CHALK_INDUCTION = 6;
// Fading is not linear in dose: below a threshold the UV absorbers and the
// binder hold, above it the film erodes and each year takes more. The dose
// that feeds the clock is the baked one on a power curve about DOSE_PIVOT, so
// the sky-open top floors run far ahead of the low storeys in their slot of
// sky (the bake's dose differs by three to five between them; the paint's
// clock, by thirty to a hundred), and the coral wall facing north, at a tenth
// of an open south wall, hardly starts. The pivot puts the open top floors
// (a baked dose of a quarter to a third) at thirty to seventy dose-years by
// year thirty, so they reach eighty to ninety per cent of the way to lime.
const DOSE_GAMMA = 3;
const DOSE_PIVOT = 0.12;
// Where the fade ends up: a lime render's white, measured off sun-bleached
// Ligurian plaster as a neutral, slightly warm off-white (#EEE8DD), never
// paper white and never cream. The pigment's loss climbs to it and the
// chalk's bloom powders over it.
const LIME = [0xee, 0xe8, 0xdd];
// What the chalked coat keeps of its own paint: a small share of the
// original chroma, at the original hue, so a pink wall bleaches to chalk with
// a breath of pink and an orange one to a pale apricot, not all to one cream.
const RESIDUAL = 0.15;
// The differential fade (the inks' own rates, the lime's warmth) may turn a
// coat's hue by at most this much (Oklab hue, degrees): it loses chroma and
// gains value, and keeps its family.
const HUE_CAP = 3;
// Where the light falls at the scale of a ledge. Every sill, cornice and eave
// shelters a strip of wall below it from sun and driving rain, out to about
// its own depth; world up is toward the verticals' vanishing point, which the
// photo puts above the frame (the corner of the yellow house and the left
// edge of the orange one meet there), in plate pixels.
const VANISH = [940, -1650];
const SHELTER = 0.85;
// Rain runs down a wall, not across it: the wash weathers in thin drips along
// the verticals (a few px across, twenty times as long), and hardest in the
// tails below every sill end, window corner and eave, where the water that
// collects on a ledge leaves it. The dose multiplier under the strongest tail.
const STREAK = 0.45;
const RUNOFF = 2.4;
// What is left of the old isotropic patches: the wash's uneven coats, the
// wall's own stains off the plate, kept faint.
const MOTTLE = 0.2;
// The polarised sky, as sRGB hue (deg), saturation, value: the zenith at the
// frame's centre, and the rim of the slot down by the eaves.
const SKY_ZENITH = [206, 0.85, 0.51];
const SKY_RIM = [203, 0.68, 0.71];
// The photo's own clearest sky (95th percentile of saturation in the mask),
// the reference for how much of a pixel is still clear sky.
const SKY_CLEAR = [206, 0.49, 0.87];
// Chalk is a matte powder, not a highlight. The lime blend flattens a coat's
// lightness toward one value, so the plate's own fine texture (the render's
// grain, its cracks, the drip lines, the cables' shadows) is put back on top
// of it: the ratio of the plate to its own wall-only, edge-aware blur (sigma
// DETAIL_SIGMA plate px, about 8 to 16 px across), multiplied back in with
// an exponent that climbs with the chalk, past 1 on a fully chalked coat, as
// a powdered surface shows every pit of the wall under it. The ratio is held
// under DETAIL_CLIP (log units) so a void or a hard shadow never punches out.
const DETAIL_SIGMA = 6;
const DETAIL_RANGE = 0.3;
const DETAIL_GAIN = 2.6;
const DETAIL_CLIP = 0.45;
// And it never reaches paper white: the bloom may lift a coat's value only to
// about L* 85 (scene luminance, before the film), on a soft shoulder, so the
// chalked top floors stay below the clouds' tops. A coat already lighter than
// that in the photo (the white trim) keeps its own.
const CHALK_CAP = 0.74;
// The scan's lifted black (the film's toe x toe colour), removed over the sky.
const FILM_TOE = 0.035;
const FILM_TOE_COLOR = [0.75, 1, 1.2];

const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hsvLin = ([h, s, v]) => {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)].map(srgbToLin);
};

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Shared by the live shader and the bakes: colour, noise and the plate's log
// luminance (needs uPlate and uPlateSize declared before it).
const NOISE = `vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// log luminance of the plate, at plate pixel P, read soft at a mip level
float logY(vec2 P, float lod) {
  return log(dot(toLin(textureLod(uPlate, P / uPlateSize, lod).rgb), LUMA) + 0.02);
}
// The wall's own frame: up is toward the verticals' vanishing point, and the
// angle around it, scaled to plate px at the frame, runs across the walls.
vec2 wallFrame(vec2 P) {
  vec2 toV = uVanish - P;
  return vec2(atan(toV.x, -toV.y) * 2400.0, length(toV));
}`;

// Bake 1, once at load, at plate resolution: the edges a runoff starts from.
// R: a ledge (an edge across the wall's vertical: a sill, a cornice, a string
// course, an eave against the sky). G: where water leaves it: the end of a
// sill or a cornice, the corner where a window's jamb meets its sill or
// lintel, and the drip points spaced along an eave or a cornice.
const SEED = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPlate;
uniform sampler2D uMat;
uniform vec2 uPlateSize;
uniform vec2 uVanish;
${NOISE}
// log-luminance gradient up the wall (x) and across it (y), read soft enough
// that the plaster's own grain does not count
vec2 grad(vec2 P, vec2 up, vec2 side) {
  const float H = 3.0;
  return vec2(abs(logY(P + up * H, 2.0) - logY(P - up * H, 2.0)), abs(logY(P + side * H, 2.0) - logY(P - side * H, 2.0)));
}
float across(vec2 g) { return smoothstep(0.2, 0.5, g.x) * smoothstep(0.55, 0.8, g.x / (g.x + g.y + 1e-3)); }
float along(vec2 g) { return smoothstep(0.2, 0.5, g.y) * smoothstep(0.55, 0.8, g.y / (g.x + g.y + 1e-3)); }
// a ledge at P, allowing it to run a little off the wall's horizontal
float ledgeNear(vec2 P, vec2 up, vec2 side) {
  return max(across(grad(P, up, side)), max(across(grad(P + up * 4.0, up, side)), across(grad(P - up * 4.0, up, side))));
}
void main() {
  vec2 P = vUv * uPlateSize;
  vec2 up = normalize(uVanish - P);
  vec2 side = vec2(-up.y, up.x);
  float wall = smoothstep(0.005, 0.03, max(textureLod(uMat, vUv, 1.0).a, textureLod(uMat, (P - up * 6.0) / uPlateSize, 1.0).a));
  if (wall <= 0.0) {
    outColor = vec4(0.0);
    return;
  }
  float hC = across(grad(P, up, side));
  // a ledge that runs on for a hand's width to one side and stops on the
  // other: its end
  float l = min(ledgeNear(P - side * 8.0, up, side), ledgeNear(P - side * 16.0, up, side));
  float r = min(ledgeNear(P + side * 8.0, up, side), ledgeNear(P + side * 16.0, up, side));
  float lo = max(ledgeNear(P - side * 8.0, up, side), ledgeNear(P - side * 16.0, up, side));
  float ro = max(ledgeNear(P + side * 8.0, up, side), ledgeNear(P + side * 16.0, up, side));
  float end = hC * max(l * (1.0 - ro), r * (1.0 - lo));
  // a ledge met by a jamb that runs on up the wall: the foot of a window's
  // frame or of a shutter
  float jamb = min(along(grad(P + up * 7.0, up, side)), along(grad(P + up * 14.0, up, side)));
  float corner = hC * jamb;
  // drip points spaced along a long ledge (an eave, a cornice, a string
  // course), by the wash's own unevenness
  float x = wallFrame(P).x;
  float drip = smoothstep(0.6, 0.85, 0.7 * vnoise(vec2(x / 9.0, 3.3)) + 0.3 * vnoise(vec2(x / 3.5, 9.1)));
  float seed = max(min(2.0 * max(end, corner), 1.0), 0.3 * hC * min(l, r) * drip);
  outColor = vec4(hC, seed, 0.0, 1.0) * wall;
}`;

// Bake 2, once at load, at plate resolution: the dose at the scale of a ledge.
// R: the shelter under a ledge. G: the runoff tail below a seed: march up the
// wall a few hundred px; the strip right under the ledge keeps its paint, then
// the water that leaves it bleaches a tail that widens a little and fades out
// down the wall; a lower ledge catches the water from those above and sheds it
// again from its own ends, so the march through a ledge loses most of what is
// above. B: the thin drips everywhere else, noise across the wall stretched
// twenty times along it (0.5 is no change).
const LOCAL = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPlate;
uniform sampler2D uMat;
uniform sampler2D uSeed;
uniform vec2 uPlateSize;
uniform vec2 uVanish;
${NOISE}
// How sheltered a pixel is by a ledge above it. March up the wall (toward
// the verticals' vanishing point) at a fixed pitch and look for an edge that
// crosses the march: a sill, a cornice, a string course, an eave against the
// sky. Only an edge whose gradient points up the wall counts; one running
// along the march (a shutter's stile, a drainpipe, a cable) is not a ledge.
// The strip a ledge protects reaches about its own depth below it, ragged
// where the rain drips off it.
float shelterAt(vec2 P) {
  vec2 up = normalize(uVanish - P);
  vec2 side = vec2(-up.y, up.x);
  // nearer walls (out toward the frame's edges) are larger in the frame
  float near = clamp(length(P - 0.5 * uPlateSize) / (0.5 * length(uPlateSize)), 0.0, 1.0);
  float ang = wallFrame(P).x;
  float drip = 0.65 * vnoise(vec2(ang / 11.0, 0.5)) + 0.35 * vnoise(vec2(ang / 4.0, 7.5));
  float reach = min(mix(16.0, 36.0, near) * (0.5 + drip), 48.0);
  // three columns a hand's width apart: a ledge runs across all of them, a
  // nail or a hook in the wall does not
  const float H = 3.0;
  const float W = 6.0;
  float s = 0.0;
  vec3 y0 = vec3(logY(P - side * W, 1.5), logY(P, 1.5), logY(P + side * W, 1.5));
  vec2 Q1 = P + up * H;
  vec3 y1 = vec3(logY(Q1 - side * W, 1.5), logY(Q1, 1.5), logY(Q1 + side * W, 1.5));
  for (int i = 1; i <= 16; i++) {
    float d = float(i) * H;
    if (d > reach) break;
    vec2 Q = P + up * d;
    vec2 Q2 = Q + up * H;
    vec3 y2 = vec3(logY(Q2 - side * W, 1.5), logY(Q2, 1.5), logY(Q2 + side * W, 1.5));
    vec3 g = abs(y2 - y0);
    float gu = min(g.x, min(g.y, g.z));
    float gs = abs(logY(Q + side * H, 1.5) - logY(Q - side * H, 1.5));
    float ledge = smoothstep(0.18, 0.45, gu) * smoothstep(0.5, 0.8, gu / (gu + gs + 1e-3));
    s = max(s, ledge * (1.0 - smoothstep(0.4 * reach, reach, d)));
    y0 = y1;
    y1 = y2;
  }
  return s;
}
// thin drips: across the wall a few px, along it twenty times that
float streakAt(vec2 P) {
  vec2 f = wallFrame(P);
  float n = 0.6 * vnoise(vec2(f.x / 10.0, f.y / 220.0)) + 0.28 * vnoise(vec2(f.x / 5.0 + 17.0, f.y / 150.0)) + 0.12 * vnoise(vec2(f.x / 3.5 + 5.0, f.y / 140.0));
  // most of the wall is even; the drips are the few lines the water picks
  return smoothstep(0.55, 0.85, n) * 1.4 - 0.3;
}
float runoffAt(vec2 P) {
  vec2 up = normalize(uVanish - P);
  float tail = 0.0;
  float flow = 1.0;
  for (int i = 1; i <= 110; i++) {
    float d = float(i) * 3.0;
    vec2 Q = P + up * d;
    vec2 uv = Q / uPlateSize;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0) break;
    // the tail spreads a little as it runs down
    float lod = clamp(1.4 + log2(1.0 + d / 90.0), 1.4, 2.6);
    vec2 sd = textureLod(uSeed, uv, lod).rg * (1.0 + 0.7 * lod);
    float fall = exp(-d / 210.0) * smoothstep(14.0, 40.0, d);
    tail = max(tail, min(sd.g, 1.0) * fall * flow);
    if (d > 12.0) flow = min(flow, 1.0 - 0.7 * min(sd.r, 1.0));
    if (textureLod(uMat, uv, 0.0).a < 0.005) break;
  }
  return tail;
}
void main() {
  vec2 P = vUv * uPlateSize;
  if (textureLod(uMat, vUv, 0.0).a <= 0.01) {
    outColor = vec4(0.0, 0.0, 0.5, 1.0);
    return;
  }
  float st = streakAt(P);
  // the tail is itself made of drips, not a smooth wash
  float tail = runoffAt(P) * (0.7 + 0.5 * st);
  outColor = vec4(shelterAt(P), clamp(tail, 0.0, 1.0), 0.5 + 0.5 * st, 1.0);
}`;

// Bake 3, once at load, at plate resolution, four passes: the wall's own
// local level, for the chalk's texture. Log luminance is stored packed in two
// bytes (R + G / 255), which a bilinear read interpolates exactly. Only wall
// samples count (the sky beside an eave never pulls the wall's level up).
// Passes 1 and 2 (across, then down) are a plain Gaussian, G. Passes 3 and 4
// repeat it twice over, with each sample weighted by how near it lies to a
// reference: in RG to G, so a cable, a crack or a hook (an outlier against its
// wall) is left out of the level and stands dark in the ratio; in BA to the
// pixel itself (a bilateral), so the render beside a window's void or a
// shutter, a whole other level, keeps its own and takes no bright halo. The
// live shader takes the darker of the two ratios.
const DETAIL_PACK = `float unpackLog(vec2 v) { return (v.x + v.y / 255.0) * 4.1 - 4.0; }
vec2 packLog(float l) {
  float v = clamp((l + 4.0) / 4.1, 0.0, 1.0) * 255.0;
  float h = floor(v);
  return vec2(h / 255.0, v - h);
}`;
const DETAIL = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPlate;
uniform sampler2D uMat;
uniform sampler2D uSrc;
uniform sampler2D uRef;
uniform vec2 uPlateSize;
uniform vec2 uVanish;
uniform vec2 uDir;
uniform float uFromPlate;
uniform float uRange;
uniform float uSigma;
${NOISE}
${DETAIL_PACK}
void main() {
  float refG = uRange > 0.0 ? unpackLog(texture(uRef, vUv).rg) : 0.0;
  float refC = logY(vUv * uPlateSize, 0.0);
  vec2 sum = vec2(0.0);
  vec2 wsum = vec2(0.0);
  for (int i = -15; i <= 15; i++) {
    vec2 uv = vUv + uDir * float(i);
    vec4 src = textureLod(uSrc, uv, 0.0);
    float lp = logY(uv * uPlateSize, 0.0);
    vec2 l = uFromPlate > 0.5 ? vec2(lp) : vec2(unpackLog(src.rg), unpackLog(src.ba));
    float w = exp(-float(i * i) / (2.0 * uSigma * uSigma)) * (smoothstep(0.005, 0.03, textureLod(uMat, uv, 0.0).a) + 1e-3);
    vec2 wr = vec2(w);
    if (uRange > 0.0) {
      vec2 dd = (vec2(l.x, lp) - vec2(refG, refC)) / uRange;
      wr *= exp(-dd * dd) + 1e-3;
    }
    sum += wr * l;
    wsum += wr;
  }
  vec2 b = sum / wsum;
  outColor = vec4(packLog(b.x), packLog(b.y));
}`;

const AGE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPlate;
uniform sampler2D uMat;
uniform sampler2D uLight;
uniform sampler2D uSkyPlate;
uniform sampler2D uLocal;
uniform float uYears;
uniform vec3 uKInk;
uniform float uKBlack;
uniform float uKWood;
uniform float uKChalk;
uniform float uChalkMax;
uniform float uInduction;
uniform float uChalkInduction;
uniform float uDoseGamma;
uniform float uDosePivot;
uniform vec3 uLime;
uniform float uResidual;
uniform float uHueCap;
uniform float uDebug;
uniform float uPolar;
uniform vec3 uZenith;
uniform vec3 uRim;
uniform vec3 uClear;
uniform vec4 uCrop;
uniform vec2 uPlateSize;
uniform vec2 uVanish;
uniform float uShelter;
uniform float uStreak;
uniform float uRunoff;
uniform float uMottle;
uniform sampler2D uDetail;
uniform float uDetailGain;
uniform float uDetailClip;
uniform float uChalkCap;
${NOISE}
${DETAIL_PACK}
vec3 toSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
const float LN10 = 2.302585;
const float CHALK_KNEE = 3.0;
// Oklab, to fade a colour along lightness and chroma while holding its hue
vec3 oklab(vec3 c) {
  vec3 lms = mat3(0.4122214708, 0.2119034982, 0.0883024619, 0.5363325363, 0.6806995451, 0.2817188376, 0.0514459929, 0.1073969566, 0.6299787005) * max(c, 0.0);
  lms = pow(lms, vec3(1.0 / 3.0));
  return mat3(0.2104542553, 1.9779984951, 0.0259040371, 0.7936177850, -2.4285922050, 0.7827717662, -0.0040720468, 0.4505937099, -0.8086757660) * lms;
}
vec3 oklabToLin(vec3 o) {
  vec3 lms = mat3(1.0, 1.0, 1.0, 0.3963377774, -0.1055613458, -0.0894841775, 0.2158037573, -0.0638541728, -1.2914855480) * o;
  lms = lms * lms * lms;
  return mat3(4.0767416621, -1.2684380046, -0.0041960863, -3.3077115913, 2.6097574011, -0.7034186147, 0.2309699292, -0.3413193965, 1.7076147010) * lms;
}
// the hue of ab turned back to within uHueCap of the hue h0
float capHue(vec2 ab, float h0) {
  float d = atan(ab.y, ab.x) - h0;
  d = mod(d + 3.14159265, 6.2831853) - 3.14159265;
  return h0 + clamp(d, -uHueCap, uHueCap);
}
float skyMask(vec4 m, vec3 lin) {
  return clamp(1.0 - (2.0 * m.r - m.b / 0.85), 0.0, 1.0) * smoothstep(-0.03, 0.01, (lin.b - lin.r) / max(lin.b, 1e-3));
}
// Patches: the wash's own unevenness (two octaves of noise at the scale of a
// few hand-widths) and the wall's own stains and repairs, read off the plate
// as how much lighter or darker it is than its surround.
// Both are read low-passed (no octave finer than a hand, the plate's own
// stains at a few hand-widths), so the wear they feed grades across the wall
// instead of breaking into hard-edged islands at the steep end of the fade.
float mottleAt(vec2 P) {
  float n = vnoise(P / 46.0) * 0.68 + vnoise(P / 17.0 + 13.1) * 0.32 - 0.5;
  float own = clamp((logY(P, 3.5) - logY(P, 5.5)) * 1.4, -0.5, 0.5);
  return clamp(n * 2.4 + own * 0.8, -1.0, 1.0);
}
// The sky through a polariser. Clouds are near neutral, so the share of the
// clear sky's blue chroma (b - r) a pixel still holds is how much of it is
// clear sky; the rest is cloud, whose own light is what is left over. The
// plate's chroma is stored at half resolution in 8x8 blocks, so it is read
// soft, and the detail (a filament finer than that) comes from luminance,
// which the plate keeps sharp: brighter than its surround is more cloud.
// The soft read is of the sky alone (uSkyPlate is the plate premultiplied by
// the sky mask), so a wall beside it never bleeds in as a pale rim.
vec3 polarise(vec3 lin, vec2 uv) {
  vec4 sp = textureLod(uSkyPlate, uv, 2.5);
  vec3 soft = sp.a > 0.02 ? toLin(sp.rgb / sp.a) : lin;
  float cc = max(uClear.b - uClear.r, 1e-3);
  float yc = dot(uClear, LUMA);
  float cloud = 1.0 - clamp((soft.b - soft.r) / cc, 0.0, 1.0);
  cloud = clamp(cloud + (dot(lin, LUMA) - dot(soft, LUMA)) / max(0.9 - yc, 0.1), 0.0, 1.0);
  float clear = 1.0 - cloud;
  // the cloud's own light: the pixel minus the clear sky it sits in
  vec3 cl = max(lin - clear * uClear, 0.0) / max(cloud, 0.04);
  float cy = dot(cl, LUMA);
  // tops roll softly under paper white instead of lifting into it
  float cy2 = cy * 1.08 / (1.0 + 0.08 * cy);
  vec3 cw = cl * (cy2 / max(cy, 1e-4));
  // radial depth: the zenith sits at the frame's centre
  vec2 d = (uv - 0.5) * vec2(uPlateSize.x / uPlateSize.y, 1.0);
  float r = length(d) / (0.5 * length(vec2(uPlateSize.x / uPlateSize.y, 1.0)));
  float t = smoothstep(0.05, 1.0, r);
  vec3 skyCol = mix(uZenith, uRim, t);
  // thin cloud and cloud shadow are lit by the sky around them: skylight blue
  float thin = 1.0 - smoothstep(0.25, 0.75, cy);
  cw = mix(cw, cw * normalize(skyCol + 0.25) * 1.73, 0.35 * thin);
  // the clear part, its haze cut; the cloud mixes in over it
  float a = smoothstep(0.0, 1.0, cloud);
  return mix(skyCol, cw, a);
}
void main() {
  // the part of the plate the screen shows (uCrop: offset, size)
  vec2 uv = uCrop.xy + uCrop.zw * vec2(vUv.x, 1.0 - vUv.y);
  vec3 lin = toLin(texture(uPlate, uv).rgb);
  vec4 m = texture(uMat, uv);
  vec4 L = texture(uLight, uv);
  // the dose map's tan lines are baked crisp at half the plate, one texel
  // in or out of a shadow; the dose curve and the chalk make that edge a
  // hard one, so eight taps (a diagonal ring 1.5 plate px off, a straight one
  // 3 px off) round the texel steps of a slanting line away, and the ghost
  // still stays sharp beside the soft drips and tails
  vec2 lt = 0.75 / vec2(textureSize(uLight, 0));
  vec2 lw = 1.5 / vec2(textureSize(uLight, 0));
  vec2 tl = 0.15 * (texture(uLight, uv + lt).rb + texture(uLight, uv - lt).rb
    + texture(uLight, uv + vec2(lt.x, -lt.y)).rb + texture(uLight, uv + vec2(-lt.x, lt.y)).rb)
    + 0.1 * (texture(uLight, uv + vec2(lw.x, 0.0)).rb + texture(uLight, uv - vec2(lw.x, 0.0)).rb
    + texture(uLight, uv + vec2(0.0, lw.y)).rb + texture(uLight, uv - vec2(0.0, lw.y)).rb);
  float dose = tl.x * 2.0;
  // the share of the dose a thin occluder took: its tan line
  float tanLine = tl.y;
  // the clock runs on the dose's power curve: the top floors far ahead
  dose = uDosePivot * pow(max(dose, 0.0) / uDosePivot, uDoseGamma);
  // the gelato sign (A = 1 - sign / 2) is enamelled sheet metal standing in
  // the lane: no ledge sheds water down it, so it fades evenly
  float sign = clamp(2.0 - 2.0 * L.a, 0.0, 1.0);
  float S = max(L.g * L.g * 1.5, 0.02);
  if (uDebug > 0.5 && uDebug < 1.5) {
    outColor = vec4(toSrgb(vec3(dose * 0.5) * vec3(1.0, 0.97, 0.9)), 1.0);
    return;
  }
  // the dose at the scale of a ledge, off the bake: the strip under every
  // sill and cornice keeps its paint, the water that leaves the ledge's ends
  // and corners bleaches a tail below it, and the open wall weathers in thin
  // drips down its vertical (a faint trace of patches under them)
  vec2 P = uv * uPlateSize;
  vec3 lc = texture(uLocal, uv).rgb;
  if (uDebug > 2.5 && uDebug < 3.5) {
    outColor = vec4(lc * m.a, 1.0);
    return;
  }
  float local = 1.0;
  float wear = 0.0;
  if (m.a > 0.01) {
    float st = lc.b * 2.0 - 1.0;
    float mot = mottleAt(P);
    local = exp(uMottle * mot + uStreak * st) * (1.0 + uRunoff * lc.g) * (1.0 - uShelter * lc.r);
    // how worn the coat is, for how much colour it can give up and how it
    // chalks: the same drips and tails, the sheltered strip least
    wear = clamp(uMottle * mot + 0.4 * st + 2.2 * lc.g - 1.0 * lc.r, -1.0, 1.0);
    // behind a leaf or a lantern the wall is out of the driving rain too:
    // its tan line keeps its colour like the strip under a sill
    wear = mix(wear, -1.0, clamp(tanLine * 1.6, 0.0, 1.0));
    local = mix(local, 1.0, sign);
    wear = mix(wear, 0.0, sign);
  }
  if (uDebug > 1.5 && uDebug < 2.5) {
    outColor = vec4(toSrgb(vec3(dose * m.a * local * 0.5) * vec3(1.0, 0.97, 0.9)), 1.0);
    return;
  }
  // effective dose after induction, with a soft knee (softplus)
  float e0 = uYears * dose * m.a * local;
  float e = uInduction * log(1.0 + exp(e0 / uInduction - 1.0)) - uInduction * log(1.0 + exp(-1.0));
  e = max(e, 0.0);

  // albedo and optical density per channel
  vec3 a = clamp(lin / S, 0.004, 1.0);
  vec3 dens = -log(a) / LN10;
  float k = min(min(dens.r, dens.g), dens.b) * 0.9;
  vec3 cmy = dens - k;
  // dye loss: each ink by its own rate; carbon black barely moves
  // no coat gives up all its colour, and one the water has not worked on
  // (under a ledge, between the drips) holds a good part of it
  // The curve is wide: wear only tilts how much a coat gives up, it never
  // switches it, so the open wall grades with its dose and only the strip
  // under a ledge and a tan line (wear near -1) hold their colour firmly.
  float keep = mix(0.4, 1.0, smoothstep(-2.0, 1.6, wear));
  vec3 lost = cmy * keep * (1.0 - exp(-uKInk * e)) + k * (1.0 - exp(-uKBlack * e));
  // what the pigment leaves behind is the lime render's own off-white, not
  // paper white: a fading colour climbs to it and stops (a surface that is
  // already lighter, like the white trim, keeps its own albedo)
  vec3 aInk = min(a * exp(lost * LN10), max(a, uLime));
  // and it keeps its family: the inks' differential rates and the lime's
  // warmth take chroma and give value, but turn the hue by at most uHueCap
  // (a near-neutral surface has no hue to hold)
  vec3 o0 = oklab(a);
  float C0 = length(o0.yz);
  float h0 = atan(o0.z, o0.y);
  float held = smoothstep(0.012, 0.035, C0);
  // and no coat gives up all of its colour: a residual tint of the paint
  // stays at its own hue under whatever the sun takes
  vec3 oi = oklab(aInk);
  float hi = capHue(oi.yz, h0);
  float Ci = max(length(oi.yz), uResidual * C0);
  oi.yz = mix(oi.yz, Ci * vec2(cos(hi), sin(hi)), held);
  aInk = oklabToLin(oi);

  // wood: lignin goes, cellulose stays: silver grey, a touch lighter
  float y = dot(a, LUMA);
  vec3 silver = vec3(y * 1.15 + 0.045) * vec3(1.01, 1.0, 0.97);
  vec3 aWood = mix(a, silver, 0.8 * (1.0 - exp(-uKWood * e)));

  vec3 aged = a + m.r * (aInk - a) + m.g * (aWood - a);
  // chalk: the binder erodes and the white pigment powders the surface
  // with a soft knee (softplus, a few dose-years wide): the bloom comes in
  // with the dose, never at a contour
  float ec = max(CHALK_KNEE * (log(1.0 + exp((e0 - uChalkInduction) / CHALK_KNEE)) - log(1.0 + exp(-uChalkInduction / CHALK_KNEE))), 0.0);
  // to the lime white, heavier where the water runs. What is
  // dark in the photo is mostly not render at all (a window's void, the
  // gap behind a shutter, a shadow), so it barely blooms and keeps its depth
  float ya = dot(a, LUMA);
  float c = min(m.b * uChalkMax * (1.0 - exp(-uKChalk * ec)) * (1.0 + 0.8 * wear), 0.92) * smoothstep(0.02, 0.2, ya);
  if (uDebug > 3.5) {
    // R: how worn the coat is, G: the chalk, B: the ink's clock
    outColor = vec4(0.5 + 0.5 * wear, c, 1.0 - exp(-0.1 * e), 1.0);
    return;
  }
  // The bloom only lifts: lightness climbs to the lime's, chroma falls to
  // the lime's own warmth plus a residual tint of the paint, and the hue
  // stays the paint's (within uHueCap), so a pink wall chalks to a pale dusty
  // pink and an orange one to pale apricot, never to one cream.
  vec3 oa = oklab(aged);
  vec3 ol = oklab(uLime * min(0.4 + 0.6 * dot(aged, LUMA) / 0.5, 1.0));
  float Ca = length(oa.yz);
  vec2 abMix = mix(oa.yz, ol.yz, c);
  float Cc = mix(Ca, min(Ca, length(ol.yz) + uResidual * C0), c);
  float hc = capHue(abMix, h0);
  vec2 abHeld = Cc * vec2(cos(hc), sin(hc));
  aged = oklabToLin(vec3(mix(oa.x, max(oa.x, ol.x), c), mix(abMix, abHeld, held)));

  vec3 outLin = max(lin + S * (aged - a), 0.0);
  // The bloom lifts a coat only to the chalk's own value, rolled off on a
  // soft shoulder under the clouds' paper white; what the photo already has
  // brighter than that (the white trim) it keeps.
  float chalked = smoothstep(0.0, 0.3, c);
  float Y0 = dot(lin, LUMA);
  float Y1 = dot(outLin, LUMA);
  float knee = 0.7 * uChalkCap;
  float Yc = Y1 < knee ? Y1 : knee + (uChalkCap - knee) * (1.0 - exp(-(Y1 - knee) / (uChalkCap - knee)));
  outLin *= mix(1.0, min(max(Y0, Yc) / max(Y1, 1e-5), 1.0), chalked);
  // and the plate's own grain, cracks and drip lines go back on top of the
  // lime, harder the more it has chalked: a powdered coat is matte and shows
  // every pit of the render under it
  vec4 lv = texture(uDetail, uv);
  float ly = logY(P, 0.0);
  float dt = min(ly - unpackLog(lv.rg), ly - unpackLog(lv.ba));
  dt = uDetailClip * tanh(dt / uDetailClip);
  outLin *= exp(uDetailGain * c * dt);
  // the sky is inert to the clock (A = 0), so its grade is the same every year
  float sky = skyMask(m, lin) * uPolar;
  if (sky > 0.001) outLin = mix(outLin, polarise(lin, uv), sky);
  // triangular dither over the graded sky, so its gradient never bands in the
  // 8-bit scene target
  float n = hash12(gl_FragCoord.xy) + hash12(gl_FragCoord.yx + 7.3) - 1.0;
  // alpha: where the coat has chalked, which the film develops without its
  // diffusion, so the powder stays matte and drawn instead of glowing
  outColor = vec4(toSrgb(outLin) + n * sky / 255.0, chalked * (1.0 - sky));
}`;

// The plate premultiplied by the sky mask, mipmapped once at load, so the
// polariser can read the sky's own soft colour beside the eaves.
const SKY_PREMUL = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPlate;
uniform sampler2D uMat;
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
void main() {
  vec3 c = texture(uPlate, vUv).rgb;
  vec3 lin = toLin(c);
  vec4 m = texture(uMat, vUv);
  float w = clamp(1.0 - (2.0 * m.r - m.b / 0.85), 0.0, 1.0) * smoothstep(-0.03, 0.01, (lin.b - lin.r) / max(lin.b, 1e-3));
  outColor = vec4(c * w, w);
}`;

const BLIT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform sampler2D uSharp;
uniform sampler2D uScene;
uniform float uSharpOn;
uniform sampler2D uMat;
uniform float uFade;
uniform vec3 uPaper;
uniform vec3 uToe;
uniform vec4 uCrop;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  // the chalked walls, developed without the diffusion and the halation
  if (uSharpOn > 0.5) c = mix(c, texture(uSharp, vUv).rgb, texture(uScene, vUv).a);
  // the scan's lifted black, taken back out over the sky alone
  vec4 m = texture(uMat, uCrop.xy + uCrop.zw * vec2(vUv.x, 1.0 - vUv.y));
  float sky = clamp(1.0 - (2.0 * m.r - m.b / 0.85), 0.0, 1.0);
  vec3 toe = uToe * sky;
  c = max((c - toe) / (1.0 - toe), 0.0);
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

function imageTexture(gl, img, mips) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
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
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
const num = (q, k) => {
  const v = q.get(k);
  return v != null && v !== "" && Number.isFinite(+v) ? +v : null;
};

export async function createFade(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const yearsQ = num(q, "years");
  const held = yearsQ != null;
  const still = held || q.get("still") === "1";
  const raw = q.get("film") === "0";
  const debugQ = q.get("debug");
  const debugDose = debugQ === "dose" || debugQ === "local" || debugQ === "runoff" || debugQ === "wear";
  const polar = q.get("sky") === "0" ? 0 : 1;
  const zenith = hsvLin(SKY_ZENITH);
  const rim = hsvLin(SKY_RIM);
  const clearSky = hsvLin(SKY_CLEAR);
  const lime = LIME.map((c) => srgbToLin(c / 255));
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");

  const [plateImg, matImg, lightImg] = await Promise.all(["plate.webp", "mat.webp", "light.webp"].map((f) => loadImage(BASE + f)));
  const plate = imageTexture(gl, plateImg, true);
  const mat = imageTexture(gl, matImg, true);
  const light = imageTexture(gl, lightImg, false);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const P = {
    age: program(gl, VERT, AGE),
    blit: program(gl, VERT, BLIT),
    premul: program(gl, VERT, SKY_PREMUL),
    seed: program(gl, VERT, SEED),
    local: program(gl, VERT, LOCAL),
    detail: program(gl, VERT, DETAIL),
  };

  // the sky-only plate, once: render, then mipmap
  const skyPlate = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, skyPlate);
  gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(PW, PH))) + 1, gl.RGBA8, PW, PH);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, skyPlate, 0);
    gl.viewport(0, 0, PW, PH);
    gl.disable(gl.BLEND);
    gl.useProgram(P.premul.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, plate);
    gl.uniform1i(P.premul.u.uPlate, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, mat);
    gl.uniform1i(P.premul.u.uMat, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.bindTexture(gl.TEXTURE_2D, skyPlate);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  // The ledge-scale dose, once: the runoff seeds (mipmapped, so a tail can
  // read them wider as it runs down), then shelter, tails and drips.
  const plateTarget = (mips) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, mips ? Math.floor(Math.log2(Math.max(PW, PH))) + 1 : 1, gl.RGBA8, PW, PH);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const bake = (prog, tex, inputs) => {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, PW, PH);
    gl.useProgram(prog.p);
    inputs.forEach(([name, t], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(prog.u[name], i);
    });
    gl.uniform2f(prog.u.uPlateSize, PW, PH);
    gl.uniform2f(prog.u.uVanish, VANISH[0], VANISH[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
  };
  const seedTex = plateTarget(true);
  bake(P.seed, seedTex, [
    ["uPlate", plate],
    ["uMat", mat],
  ]);
  gl.bindTexture(gl.TEXTURE_2D, seedTex);
  gl.generateMipmap(gl.TEXTURE_2D);
  const localTex = plateTarget(false);
  bake(P.local, localTex, [
    ["uPlate", plate],
    ["uMat", mat],
    ["uSeed", seedTex],
  ]);
  // The wall's own level for the chalk's texture: a plain wall-only blur
  // (across, then down), then the same weighted by nearness to it.
  const detailPass = (dst, dx, dy, fromPlate, src, ref) => {
    const u = P.detail.u;
    gl.useProgram(P.detail.p);
    gl.uniform2f(u.uDir, dx / PW, dy / PH);
    gl.uniform1f(u.uFromPlate, fromPlate ? 1 : 0);
    gl.uniform1f(u.uRange, ref ? DETAIL_RANGE : 0);
    gl.uniform1f(u.uSigma, DETAIL_SIGMA);
    bake(P.detail, dst, [
      ["uPlate", plate],
      ["uMat", mat],
      ["uSrc", src || plate],
      ["uRef", ref || plate],
    ]);
  };
  const detailA = plateTarget(false);
  const detailRef = plateTarget(false);
  const detailTex = plateTarget(false);
  detailPass(detailA, 1, 0, true, null, null);
  detailPass(detailRef, 0, 1, false, detailA, null);
  detailPass(detailA, 1, 0, true, null, detailRef);
  detailPass(detailTex, 0, 1, false, detailA, detailRef);
  gl.deleteTexture(detailA);
  gl.deleteTexture(detailRef);
  const film = createFilm(gl, { width: 2, height: 2 });

  // The view fills the box: looking up from the cobbles reads at full size,
  // not as a print on a mount. The 4:3 plate covers the box about its centre
  // (the zenith stays mid-frame), cropping at most a fifth of either side;
  // past that (a tall phone) it runs edge to edge across and sits on the
  // paper above and below. Embedded, it fills the tile's height.
  const L = { x: 0, y: 0, w: 1, h: 1, pw: 2, ph: 2, u0: 0, v0: 0, us: 1, vs: 1, fitW: 1 };
  const T = { scene: null, film: null, sharp: null };
  let dirty = true;
  const layout = (W, H, dpr) => {
    const ar = PW / PH;
    // the drag's scale stays that of the print as it sat on its mount
    L.fitW = W / H < 0.9 ? Math.min(W - 2 * Math.max(16, Math.round(W * 0.06)), H * 0.84 * ar) : Math.min(H - 2 * Math.max(24, H * 0.07), (W - 48) / ar) * ar;
    let dw;
    let dh;
    if (embedded) {
      dh = H;
      dw = dh * ar;
    } else {
      const s = Math.min(Math.max(W / PW, H / PH), 1.25 * Math.min(W / PW, H / PH));
      dw = PW * s;
      dh = PH * s;
    }
    const w = Math.min(W, dw);
    const h = Math.min(H, dh);
    L.x = Math.round(((W - w) / 2) * dpr) / dpr;
    L.y = Math.round(((H - h) / 2) * dpr) / dpr;
    L.w = w;
    L.h = h;
    L.pw = Math.max(2, Math.round(L.w * dpr));
    L.ph = Math.max(2, Math.round(L.h * dpr));
    L.us = L.pw / (dw * dpr);
    L.vs = L.ph / (dh * dpr);
    L.u0 = (1 - L.us) / 2;
    L.v0 = (1 - L.vs) / 2;
    Object.values(T).forEach((t) => freeTarget(gl, t));
    T.scene = target(gl, L.pw, L.ph);
    T.film = target(gl, L.pw, L.ph);
    T.sharp = target(gl, L.pw, L.ph);
    film.resize(L.pw, L.ph);
    dirty = true;
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  const bindTex = (unit, tex, loc) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  };

  // The clock: a goal the hand sets 1:1, and the shown years following it on
  // a critically-damped-ish spring. Release carries the hand's velocity.
  let goal = held ? clamp(yearsQ, 0, YEARS) : 0;
  let years = goal;
  let yearsV = 0;
  let goalV = 0;
  let dragging = false;
  let dragX = 0;
  let dragGoal = 0;
  let touched = held;
  let seed = 0;
  const span = () => Math.max(L.fitW * 1.6, Math.min(stage.width * 0.7, 900));

  stage.on("down", (p) => {
    dragging = true;
    touched = true;
    dragX = p.x;
    dragGoal = goal;
    goalV = 0;
    host.dataset.dragging = "";
  });
  stage.on("move", (p) => {
    if (!dragging) return;
    let g = dragGoal + ((p.x - dragX) / span()) * YEARS;
    const band = (o) => 2.4 * (1 - Math.exp((-0.4 * o) / 2.4));
    if (g < 0) g = -band(-g);
    if (g > YEARS) g = YEARS + band(g - YEARS);
    goal = g;
  });
  stage.on("up", (p) => {
    if (!dragging) return;
    dragging = false;
    delete host.dataset.dragging;
    goalV = clamp((p.vx / span()) * YEARS, -60, 60);
  });

  host.tabIndex = embedded ? -1 : 0;
  const onKey = (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    touched = true;
    goal = clamp(goal + d * (e.shiftKey ? 5 : 1), 0, YEARS);
  };
  host.addEventListener("keydown", onKey);

  const draw = (expoStops, fade) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.DEPTH_TEST);

    const u = P.age.u;
    gl.useProgram(P.age.p);
    bindTex(0, plate, u.uPlate);
    bindTex(1, mat, u.uMat);
    bindTex(2, light, u.uLight);
    bindTex(3, skyPlate, u.uSkyPlate);
    bindTex(4, localTex, u.uLocal);
    gl.uniform1f(u.uYears, clamp(years, 0, YEARS + 2));
    gl.uniform3fv(u.uKInk, K_INK);
    gl.uniform1f(u.uKBlack, K_BLACK);
    gl.uniform1f(u.uKWood, K_WOOD);
    gl.uniform1f(u.uKChalk, K_CHALK);
    gl.uniform1f(u.uChalkMax, CHALK_MAX);
    gl.uniform1f(u.uInduction, INDUCTION);
    gl.uniform1f(u.uChalkInduction, CHALK_INDUCTION);
    gl.uniform1f(u.uDoseGamma, DOSE_GAMMA);
    gl.uniform1f(u.uDosePivot, DOSE_PIVOT);
    gl.uniform3fv(u.uLime, lime);
    gl.uniform1f(u.uResidual, RESIDUAL);
    gl.uniform1f(u.uHueCap, (HUE_CAP * Math.PI) / 180);
    gl.uniform2f(u.uPlateSize, PW, PH);
    gl.uniform2f(u.uVanish, VANISH[0], VANISH[1]);
    gl.uniform1f(u.uShelter, SHELTER);
    gl.uniform1f(u.uStreak, STREAK);
    gl.uniform1f(u.uRunoff, RUNOFF);
    gl.uniform1f(u.uMottle, MOTTLE);
    bindTex(5, detailTex, u.uDetail);
    gl.uniform1f(u.uDetailGain, DETAIL_GAIN);
    gl.uniform1f(u.uDetailClip, DETAIL_CLIP);
    gl.uniform1f(u.uChalkCap, CHALK_CAP);
    gl.uniform1f(u.uDebug, debugQ === "wear" ? 4 : debugQ === "runoff" ? 3 : debugQ === "local" ? 2 : debugDose ? 1 : 0);
    gl.uniform1f(u.uPolar, polar);
    gl.uniform3fv(u.uZenith, zenith);
    gl.uniform3fv(u.uRim, rim);
    gl.uniform3fv(u.uClear, clearSky);
    gl.uniform4f(u.uCrop, L.u0, L.v0, L.us, L.vs);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene.fbo);
    gl.viewport(0, 0, T.scene.w, T.scene.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // nothing has chalked in the first years: the second development waits
    const sharpOn = !raw && !debugDose && years > 1;
    if (!raw && !debugDose) {
      const look = {
        ...FILM_PRESETS.summer,
        exposure: 0.12 + expoStops,
        headroom: 0.6,
        halation: 0.22,
        bloom: 0.2,
        softness: 0.5,
        contrast: 1.06,
        toe: FILM_TOE,
        saturation: 1.02,
        blueDepth: 0.4,
        shadowTint: [0.95, 1, 1.05],
        highlightTint: [1.0, 1, 0.99],
        vignette: 0.18,
        whitePoint: 1.2,
        grain: 0.32,
        grainSeed: seed,
      };
      film.render(T.scene.tex, look, T.film.fbo);
      // and again without the diffusion, the halation and the optical
      // softness (same grain), for the chalked walls: the Pro-Mist stays on
      // the cloud tops and the paint that has not yet gone
      if (sharpOn) film.render(T.scene.tex, { ...look, bloom: 0, halation: 0, softness: 0 }, T.sharp.fbo);
      gl.bindVertexArray(vao);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.clearColor(PAPER[0], PAPER[1], PAPER[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const dpr = stage.dpr;
    const vx = Math.round(L.x * dpr);
    const vy = stage.canvas.height - Math.round(L.y * dpr) - L.ph;
    gl.viewport(vx, vy, L.pw, L.ph);
    gl.useProgram(P.blit.p);
    bindTex(0, raw || debugDose ? T.scene.tex : T.film.tex, P.blit.u.uTex);
    bindTex(2, T.sharp.tex, P.blit.u.uSharp);
    bindTex(3, T.scene.tex, P.blit.u.uScene);
    gl.uniform1f(P.blit.u.uSharpOn, sharpOn ? 1 : 0);
    gl.uniform1f(P.blit.u.uFade, fade);
    gl.uniform3fv(P.blit.u.uPaper, PAPER);
    bindTex(1, mat, P.blit.u.uMat);
    const toe = raw || debugDose || !polar ? 0 : FILM_TOE;
    gl.uniform3f(P.blit.u.uToe, toe * FILM_TOE_COLOR[0], toe * FILM_TOE_COLOR[1], toe * FILM_TOE_COLOR[2]);
    gl.uniform4f(P.blit.u.uCrop, L.u0, L.v0, L.us, L.vs);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // Reveal: the print opens overexposed, an airy white-blue, and settles to
  // exposure; then the clock eases a few years forward to show it can move.
  const REVEAL = 2.0;
  const WALK_AT = 1.5;
  const WALK = 2.4;
  let t0 = -1;
  let grainClock = 0;

  stage.onFrame((dt) => {
    if (!T.scene) return;
    const now = performance.now() / 1000;
    if (t0 < 0) t0 = now;
    const age = still ? 99 : now - t0;
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 2.2 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
    }

    if (!held && !touched) {
      goal = reduce ? 0 : OPEN_AT * expoOut(clamp((age - WALK_AT) / WALK, 0, 1));
    } else if (!held && !dragging) {
      if (Math.abs(goalV) > 1e-3) {
        goal += goalV * dt;
        goalV *= Math.exp(-dt / 0.22);
      }
      if (goal < 0) goal += (0 - goal) * (1 - Math.exp(-dt * 14));
      if (goal > YEARS) goal += (YEARS - goal) * (1 - Math.exp(-dt * 14));
    }

    let moving = false;
    if (held) years = goal;
    else {
      const w = 14;
      const z = 0.86;
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const a = w * w * (goal - years) - 2 * z * w * yearsV;
        yearsV += a * h;
        years += yearsV * h;
      }
      moving = Math.abs(goal - years) > 1e-3 || Math.abs(yearsV) > 1e-3;
      if (!moving) {
        years = goal;
        yearsV = 0;
      }
    }

    let tick = false;
    if (!reduce && !held) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        seed = (seed + 1) % 997;
        tick = true;
      }
    }
    const revealing = !still && age < REVEAL + 0.1;
    if (!dirty && !moving && !tick && !revealing) return;
    dirty = false;
    draw(expo, fade);
  });

  return {
    destroy() {
      host.removeEventListener("keydown", onKey);
      film.destroy();
      Object.values(T).forEach((t) => freeTarget(gl, t));
      [plate, mat, light, skyPlate, seedTex, localTex, detailTex].forEach((t) => gl.deleteTexture(t));
      Object.values(P).forEach((p) => gl.deleteProgram(p.p));
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
