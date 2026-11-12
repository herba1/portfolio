import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Develop. A photograph (a railway mast in Ine, Kyoto, from below, against
// summer cumulus) comes up like a print in a darkroom tray, but the
// developer runs through the scene's depth, not across the paper.
//
// Offline (tools/depth/bakes/develop/bake.py) the photo is taken apart into
// two layers: the sky with every pole, girder and wire painted out, and the
// structure as a premultiplied matte over it, with a depth key for each.
//  - Sky key (baked, key.png B): mostly the cloud itself, density from the
//    fill's whiteness and light blurred to the scale of the masses (sigma 3%
//    of the width), so a cumulus mass is nearer than its edge and its edge
//    nearer than the blue; a third from distance (cloud at a fixed height is
//    nearer overhead, ~ 1 / sin(elevation)). Rank-equalised, so the front
//    covers the sky at an even pace. Low-frequency on purpose: read at the
//    scale of the curds, the front was an iso-contour round every puff, a
//    tide line round dozens of islands; at this scale it is a few large
//    lobes threading the cumulus.
//  - Structure key: Depth Anything V2, percentile-normalised, median-
//    filtered, near values dilated, half rank-equalised so the front spends
//    its time evenly along the girder.
//
// A front sweeps that key, far to near (press on the sky) or near to far
// (press on the mast). Behind it, the photograph. Ahead of it, per layer:
//  - defocus, a real disc gather (scatter-as-gather, cat's-eye towards the
//    corners) whose circle of confusion grows with the depth still to cover.
//    On the structure bright taps weigh more, so its specular hardware
//    (insulator rims, hangers) opens into discs; the sky is a plain energy-
//    conserving average, because cloud is a diffuse source, not a highlight,
//    and out of focus it only softens, it never sparkles;
//  - the latent image: the scene itself, faint and low in contrast. On the
//    sky it holds the developed sky's own chroma: the blue is lifted, not
//    greyed, the cloud left as it is, so it comes up from a soft, light field
//    of the same blue into the deep one. Never brighter than the finished
//    print (the lift is held under the developed cloud's luminance round each
//    pixel), and none of the sky's latent terms (lift, halation) inside the
//    structure's matte, dilated a few pixels, so wires, hangers and
//    insulators never pick them up;
//  - the strata lifted towards you in z (a scale about the principal point
//    in proportion to nearness), held clean by the fill behind them.
// On the structure the front is a thin band of light, which the film's
// halation turns warm. On the sky it is a soft band (an eighth of the sky's
// key, never narrower on screen than a few dozen pixels where the key is
// steep) with no light of its own, only a faint amber halation in its middle
// where it crosses cloud, so the edge glows instead of being drawn. Release
// and it carries the hand's speed with friction; the strata,
// stirred by that speed, settle on a spring.
//
// The painted sky is graded towards a deep cobalt in log light, darkest at
// the zenith (the top of the print), keyed off the cloud so the cores stay
// white and their shadow sides take the skylight's blue (gradeSky).
//
// Everything renders through _kit/film.js (summer) in linear light.
//
// Query: ?front=0..1 holds the front (0 blank, 1 developed); ?from=far runs
// it from the far sky in (the default is from the mast outward); ?still=1
// skips the opening.

const BASE = "/lab/develop/";
const ASPECT = 1.5;

// Key layout: sky 0..SKY_SPAN, structure FG_LO..1.
const SKY_SPAN = 0.5;
const FG_LO = 0.54;
const SKY_COC = 1.55; // the sky's circle of confusion over the structure's
const AHEAD = 0.36; // key distance over which a layer goes from just-ahead to fully latent
const SIGMA = 0.016; // structure band half-width in key units
const SKY_BAND = 0.12; // sky band width, in the sky's own key (0..1)
const SKY_PX = 80; // ...and never narrower on screen than this, in print px
const HALO = 0.07; // amber halation in the middle of the sky's band, linear
const F_START = -0.1;
const F_END = 1.06;

// Drag progress to the front. The key runs structure 1..FG_LO and sky
// SKY_SPAN..0 (from the mast) or the other way (from the far sky). From the
// mast the structure takes the first SPLIT of the drag and the sky the rest,
// at an even pace (the sky key is rank-equalised, so its share developed is
// t^SKY_GAMMA): by mid-drag about three tenths of the sky has developed,
// by three quarters nearly two thirds, rather than a pale sheet that rushes in
// at the end. The last few hundredths carry the band off the far edge.
const SPLIT = 0.25;
const SKY_GAMMA = 1.1;
const GAP = 0.52; // between the layers, from the far sky
const knotOf = (dir) => (dir < 0 ? [SPLIT, 1 - SKY_SPAN] : [1 - SPLIT, GAP]);
const frontOf = (p, dir) => {
  const [k, fk] = knotOf(dir);
  if (p <= k) return F_START + (fk - F_START) * (p / k);
  const t = (p - k) / (1 - k);
  if (dir > 0) return fk + (F_END - fk) * t;
  return fk + SKY_SPAN * Math.pow(t, SKY_GAMMA) + (F_END - 1) * t ** 8;
};
// The opening stops partway through the first layer, handing over.
const OPEN_FRONT = 0.29;

const Z = 0.05; // strata lift at full: 5% scale for the nearest stratum
const COC = 15; // max circle of confusion, half-res px of the print
const BAND = 0.62; // light in the front, linear

const FILM = {
  ...FILM_PRESETS.summer,
  input: "linear",
  bloom: 0.2,
  halation: 0.55,
  halationThreshold: 0.95,
  vignette: 0.16,
  grain: 0.32,
};

const f = (x) => x.toFixed(6);

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMMON = `
uniform sampler2D uPlate;  // sRGB texture: reads linear
uniform sampler2D uFill;   // sRGB texture
uniform sampler2D uAlpha;
uniform sampler2D uKey;    // r structure key, b g sky key (16 bit)
uniform float uFront;
uniform float uDir;
uniform float uZ;
uniform float uCoC;
uniform float uTime;
uniform float uDrift;
const float SKY_SPAN = ${f(SKY_SPAN)};
const float FG_LO = ${f(FG_LO)};
const float AHEAD = ${f(AHEAD)};
const float SKY_COC = ${f(SKY_COC)};
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

// Sky key, 0 far .. 1 near (baked: cloud masses and distance, rank-equalised),
// 16 bit across b (high byte) and g (low). Linear filtering is linear in the
// value, so filtering the bytes apart and joining them is exact.
float skyKey(vec2 iuv) {
  vec2 hl = texture(uKey, iuv).bg;
  return SKY_SPAN * dot(hl, vec2(65280.0, 255.0) / 65535.0);
}
float toFg(float k8) { return FG_LO + (1.0 - FG_LO) * k8; }
// Where the structure is, dilated by a few pixels (a coarser mip of the
// matte, pushed up), so a two-pixel wire, a hanger or an insulator rim is
// fully inside it: nothing of the latent sky's treatment may land there.
float cover(vec2 uv) {
  float a0 = texture(uAlpha, uv).r;
  float a1 = textureLod(uAlpha, uv, 1.5).r;
  return clamp(max(a0, 3.0 * a1), 0.0, 1.0);
}
float ahead(float k) { return (uDir > 0.0 ? k : 1.0 - k) - uFront; }
float cocOf(float d) {
  float t = smoothstep(0.0, AHEAD, d);
  return uCoC * t * (0.35 + 0.65 * t);
}
// Strata lifted towards the camera: a point at depth z brought nearer by dz
// grows by z / (z - dz) about the principal point, more the nearer it is.
// Inverse-mapped by fixed-point iteration (the lift is a few percent).
vec2 fgWarp(vec2 iuv) {
  vec2 q = iuv;
  for (int i = 0; i < 3; i++) {
    float k8 = textureLod(uKey, q, 0.0).r;
    float d = ahead(toFg(k8));
    float near = 0.12 + 0.88 * k8 * k8;
    float s = uZ * smoothstep(0.0, AHEAD * 0.8, d) * near * (1.0 + uDrift * sin(uTime * 0.6 + k8 * 7.0));
    q = 0.5 + (iuv - 0.5) / (1.0 + s);
  }
  return q;
}
`;

// Half res, two targets: the layer's light, and its circle of confusion / 32.
const PREP_BG = `#version 300 es
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
${COMMON}
void main() {
  vec2 iuv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 c = texture(uFill, iuv).rgb;
  float d = ahead(skyKey(iuv));
  // The sky's light as it is: cloud is a diffuse source with no highlights
  // past paper white, so the lens only spreads it, it makes no discs.
  o0 = vec4(c, 1.0);
  o1 = vec4(min(31.0, SKY_COC * cocOf(d)) / 32.0, 0.0, 0.0, 1.0);
}`;

const PREP_FG = `#version 300 es
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
${COMMON}
void main() {
  vec2 iuv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 q = fgWarp(iuv);
  float a = texture(uAlpha, q).r;
  vec3 pm = max(texture(uPlate, q).rgb - (1.0 - a) * texture(uFill, q).rgb, 0.0);
  pm = min(pm, vec3(a)) * step(0.004, a);
  o0 = vec4(pm, a);
  o1 = vec4(cocOf(ahead(toFg(texture(uKey, q).r))) / 32.0, 0.0, 0.0, 1.0);
}`;

// Disc defocus as a gather: each tap counts if its own circle reaches this
// pixel; towards the corners the aperture is cut by the barrel into a cat's
// eye. On the structure bright taps weigh more (a highlight's disc is what
// you see), and its bright points are real specular hardware: insulator
// rims, hangers. The sky (uSky) has no highlights. Cloud is a broad diffuse
// source, so it is a plain normalised average (its light conserved), and
// through a soft-edged aperture (weight (1 - u^2)^2, spread to keep the same
// width): a hard disc stamps every small curd as a flat round blotch, a
// polka-dot over the blue, where out-of-focus cloud only melts.
const GATHER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uCol;
uniform sampler2D uCocT;
uniform vec2 uTexel;
uniform float uAspect;
uniform float uSky;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const int N = __N__;
void main() {
  vec4 c0 = texture(uCol, vUv);
  float r0 = texture(uCocT, vUv).r * 32.0;
  if (r0 < 0.6) { o = c0; return; }
  float spread = 1.0 + 0.35 * uSky;
  r0 *= spread;
  float lod = max(0.0, log2(r0 * 1.7725 / sqrt(float(N))) - 0.6);
  vec2 fpos = (vUv - 0.5) * vec2(uAspect, 1.0) * 0.55;
  vec4 acc = vec4(0.0);
  float ws = 0.0;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) / float(N);
    float r = sqrt(t) * r0;
    float an = float(i) * 2.39996323;
    vec2 off = vec2(cos(an), sin(an)) * r;
    if (length(off / r0 + fpos) > 1.0) continue;
    vec2 uv = vUv + off * uTexel;
    vec4 s = textureLod(uCol, uv, lod);
    float cs = textureLod(uCocT, uv, lod).r * 32.0 * spread;
    float w = smoothstep(r - 1.0, r + 0.5, cs + 0.5);
    float l = dot(s.rgb, LUMA) / max(s.a, 0.08);
    float u = 1.0 - t;
    w *= mix(1.0 + 3.0 * l * l, u * u, uSky);
    acc += s * w;
    ws += w;
  }
  o = ws > 1e-4 ? acc / ws : c0;
}`;

const COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uBgBlur;
uniform sampler2D uFgBlur;
uniform float uSig;
uniform float uBand;
${COMMON}
const float SIGMA = ${f(SIGMA)};
const float SKY_BAND = ${f(SKY_BAND)};
const float SKY_PX = ${f(SKY_PX)};
const float BAND = ${f(BAND)};
const float HALO = ${f(HALO)};
// The cool white-blue an overexposed sky washes out to (linear).
const vec3 WASH = vec3(0.66, 0.77, 0.92);
// The level the latent sky's blue is lifted towards (linear luminance).
const float SKY_LAT = 0.2;
const vec3 LEAK = vec3(1.0, 0.8, 0.58);
// Halation: the red layer's glow, amber-orange (linear).
const vec3 AMBER = vec3(1.0, 0.5, 0.12);
const vec3 WARM = vec3(1.04, 0.9, 0.66); // its filter on the light under it

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 toLin(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

// The sky graded towards a deep summer cobalt, the way a polariser and a
// Superia scan render a sky straight overhead. The photograph's sky is a pale,
// washed cerulean; here the clear blue is pulled, in log light, towards a
// target that is darkest and most saturated at the top of the print (the
// zenith) and eases lighter towards the bottom (nearer the horizon). It is a
// gain per channel, target over the photo's typical clear blue, so the sky's
// own drawing and grain ride on it unchanged. Keyed by how much of a pixel is
// clear sky: cloud cores (white, little chroma, bright) keep their light, and
// the shadow sides between, grey and a little blue, take part of the gain, so
// they pick up the skylight's blue instead of going grey.
const vec3 SKY_REF = vec3(0.205, 0.347, 0.571);  // the photo's clear blue, linear
const vec3 SKY_TOP = vec3(0.055, 0.118, 0.34);   // through the film: ~hue 212, sat .8, value .58
const vec3 SKY_BOT = vec3(0.095, 0.2, 0.5);      // ...easing to ~sat .72, value .7
float skyness(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float white = mn / max(mx, 1e-4);
  float l = dot(c, LUMA);
  // clear blue: low whiteness, blue over red, not bright
  float m = 1.0 - smoothstep(0.42, 0.78, white);
  m *= smoothstep(0.0, 0.08, c.b - c.r);
  m *= 1.0 - smoothstep(0.42, 0.7, l);
  return m;
}
vec3 gradeSky(vec3 c, vec2 iuv) {
  float y = smoothstep(0.0, 1.0, iuv.y);
  vec3 lg = mix(log(SKY_TOP), log(SKY_BOT), y) - log(SKY_REF);
  return c * exp(lg * skyness(c));
}

// The latent image: the scene itself, a positive at low contrast on a
// cool white-blue wash, fainter the further it is from the developer.
// Clouds stay the brightest thing in it, so the cores that develop first
// come up as cloud, not as grey on a paler sheet. Density builds (it is not
// a cross-fade): interpolate in log light, so the darks come up through
// clean tones rather than a grey mix.
vec3 latent(vec3 c, float d, float dev, vec3 wash) {
  float an = clamp(d / AHEAD, 0.0, 1.0);
  vec3 lat = mix(wash, c, mix(0.55, 0.3, an));
  return exp(mix(log(max(lat, 1e-4)), log(max(c, 1e-4)), dev));
}

// The sky's latent image holds the developed sky's chroma: its luminance
// is drawn up towards a light level (low contrast, fainter the further from
// the developer) and the colour scaled with it, so the blue stays blue at
// the same saturation instead of washing to grey-white; the cloud, already
// above that level, is left as it is. Density builds in log light, so at
// every stage it is c times one factor: the chroma never moves. The level
// sits well under the cloud's white, so the latent sky never outshines the
// finished print, and it needs no local cap: a cap drawn from the cloud
// round each pixel lifted the blue only near cloud, in round patches the
// shape of its samples, a polka-dot over the clear sky.
vec3 latentSky(vec3 c, float d, float dev, float y) {
  float an = clamp(d / AHEAD, 0.0, 1.0);
  float lc = max(dot(c, LUMA), 1e-4);
  // the level follows the graded sky's own fall-off, deeper towards the zenith
  float lat = SKY_LAT * mix(0.72, 1.25, smoothstep(0.0, 1.0, y));
  float lt = max(lc, mix(lat, lc, mix(0.55, 0.3, an)));
  return c * pow(lt / lc, 1.0 - dev);
}

// The developed cloud round a pixel: the brightest of the print within a
// mass's reach of it (32 px cells, on two rings, smoothly filtered so the
// level never steps), the level its whites come up to.
float cloudWhite(vec2 iuv) {
  vec2 px = vec2(1.0 / 2400.0, 1.0 / 1600.0);
  float m = dot(gradeSky(textureLod(uFill, iuv, 5.0).rgb, iuv), LUMA);
  for (int i = 0; i < 6; i++) {
    float an = float(i) * 1.047198 + 0.4;
    vec2 dir = vec2(cos(an), sin(an)) * px;
    vec2 u1 = iuv + dir * 70.0;
    vec2 u2 = iuv + dir.yx * vec2(1.5, 0.667) * 170.0;
    m = max(m, dot(gradeSky(textureLod(uFill, u1, 5.0).rgb, u1), LUMA));
    m = max(m, dot(gradeSky(textureLod(uFill, u2, 5.5).rgb, u2), LUMA));
  }
  return m;
}

// Never brighter than the finished print: the latent lift (from the
// developed light c to lat) goes only as far as keeps its luminance at or
// under cap. It is the lift that is held, not the light: over cap the
// latent tone falls back towards the print's own, never towards grey.
vec3 liftUnder(vec3 c, vec3 lat, float cap) {
  float lc = dot(c, LUMA);
  float ll = dot(lat, LUMA);
  float t = ll > lc + 1e-4 ? clamp((max(cap, lc) - lc) / (ll - lc), 0.0, 1.0) : 1.0;
  return c + (lat - c) * t;
}

// The sky at key distance d past the front. A soft band, SKY_BAND of the
// sky's key wide, widened by the key's gradient on screen so it stays soft
// where the key is steep; no light of its own, only a faint amber halation
// in its middle where it crosses cloud, warming what is under it. c is the sky as the lens sees it
// (developed light, defocused); every undeveloped term (the latent lift,
// the halation) is gated by 1 - cov, the dilated structure.
vec3 developSky(vec3 c, float d, vec2 iuv, float cov) {
  float w = max(SKY_BAND * SKY_SPAN * uSig / SIGMA, SKY_PX * fwidth(d));
  float dev = 1.0 - smoothstep(-0.5 * w, 0.5 * w, d);
  float open = 1.0 - cov;
  vec3 r = mix(c, latentSky(c, d, dev, iuv.y), open);
  float h = 4.0 * dev * (1.0 - dev);
  float leak = 0.7 + 0.3 * vnoise(iuv * vec2(2.6, 1.8) + vec2(uTime * 0.04, -uTime * 0.03));
  // Halation is the red layer's own glow: on a cool sky it has to take a
  // little blue out as well as add amber, or it reads as lilac, not warm.
  // It is light scattered back from what is bright, so it glows where the
  // band crosses cloud and all but vanishes over the blue: laid evenly along
  // the band, amber over blue reads as a pale grey strip, and where the key's
  // contours run straight (left of the pole, the top right) a seam.
  float glow = mix(0.15, 1.0, smoothstep(0.32, 0.7, dot(c, LUMA)));
  float g = h * (uBand / BAND) * leak * open * glow;
  r = mix(r, r * WARM, 0.32 * g);
  return r + AMBER * (g * HALO);
}

// The structure at key distance d past the front (d < 0: developed).
vec3 develop(vec3 c, float d, vec2 iuv, float cap, vec3 wash) {
  float sig = uSig;
  float dev = 1.0 - smoothstep(-0.3 * sig, 0.7 * sig, d);
  // the latent steel may come up towards the sky's tone, never past it
  vec3 r = liftUnder(c, latent(c, d, dev, wash), cap);
  // The front: light where developer meets paper, trailing a little behind.
  float w = d >= 0.0 ? sig : sig * 1.3;
  float b = exp(-(d * d) / (w * w));
  float leak = 0.78 + 0.22 * vnoise(iuv * vec2(2.6, 1.8) + vec2(uTime * 0.04, -uTime * 0.03));
  // Light adds, but the paper is near white already: let it roll off there.
  float room = 1.0 - 0.5 * smoothstep(0.5, 1.1, dot(r, LUMA));
  return r + LEAK * (b * uBand * leak * room);
}

void main() {
  vec2 iuv = vec2(vUv.x, 1.0 - vUv.y);

  // Structure, lifted: premultiplied, with its own matte.
  vec2 q = fgWarp(iuv);
  float a = texture(uAlpha, q).r;
  vec3 pm = max(texture(uPlate, q).rgb - (1.0 - a) * texture(uFill, q).rgb, 0.0);
  pm = min(pm, vec3(a)) * step(0.004, a);
  float dF = ahead(toFg(texture(uKey, q).r));
  vec4 fg = mix(vec4(pm, a), texture(uFgBlur, vUv), smoothstep(0.25, 1.25, cocOf(dF)));
  // where the structure is on screen and where it was baked, dilated
  float cov = max(cover(q), cover(iuv));

  // Sky, as the lens sees it. The cap, for the latent steel: the developed
  // cloud's luminance here, the brightest the finished print reaches round
  // this pixel, so the steel's wash never outshines the sky behind it.
  float dB = ahead(skyKey(iuv));
  float rB = SKY_COC * cocOf(dB);
  vec3 skyDev = gradeSky(texture(uFill, iuv).rgb, iuv);
  float cap = max(dot(skyDev, LUMA), cloudWhite(iuv));
  vec3 sky = mix(skyDev, gradeSky(texture(uBgBlur, vUv).rgb, iuv), smoothstep(0.25, 1.25, rB));
  sky = developSky(sky, dB, iuv, cov);

  // The latent steel's wash: the graded sky round it, a little cooler and
  // paler, so ahead of the front the steel is a faint density in the sky's
  // own blue rather than a white cut-out on it (a constant pale wash read as
  // a negative, light-on-blue, once the sky went deep).
  vec3 skyHere = gradeSky(textureLod(uFill, iuv, 4.0).rgb, iuv);
  vec3 wash = 1.15 * mix(skyHere, WASH * dot(skyHere, LUMA) / dot(WASH, LUMA), 0.3);
  vec3 fgP = develop(fg.rgb / max(fg.a, 1e-3), dF, iuv, cap, wash) * fg.a;
  o = vec4(fgP + sky * (1.0 - fg.a), 1.0);
}`;

const BLIT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uSrc;
void main() { o = texture(uSrc, vUv); }`;

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
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

async function bitmap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function upload(gl, img, srgb, red = false) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  if (red) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, img);
  else gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// Rubber band past the ends.
const rubber = (v, lo, hi) => {
  const r = (x) => 0.35 * (1 - 1 / (1 + x / 0.35 * 0.55));
  if (v > hi) return hi + r(v - hi);
  if (v < lo) return lo - r(lo - v);
  return v;
};

const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

export async function createDevelop(host, { embedded = false } = {}) {
  const params = new URLSearchParams(window.location.search);
  const fixed = params.has("front") ? clamp(parseFloat(params.get("front")) || 0, 0, 1) : null;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const still = fixed != null || params.has("still");

  const [plateImg, fillImg, alphaImg, keyImg] = await Promise.all(["plate.webp", "fill.webp", "alpha.png", "key.png"].map((n) => bitmap(BASE + n)));

  // A small copy of the matte, to know whether a press landed on the mast.
  const probe = (() => {
    const c = new OffscreenCanvas(240, 160);
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(alphaImg, 0, 0, 240, 160);
    return x.getImageData(0, 0, 240, 160).data;
  })();
  const alphaAt = (u, v) => probe[(clamp(Math.floor(v * 160), 0, 159) * 240 + clamp(Math.floor(u * 240), 0, 239)) * 4] / 255;

  host.style.background = "#f2f0eb";
  const stage = createStage(host, { webgl: true, dpr: 2, alpha: true, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");
  const canvas = stage.canvas;
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "slider");
  canvas.setAttribute("aria-label", "Development");
  canvas.setAttribute("aria-valuemin", "0");
  canvas.setAttribute("aria-valuemax", "100");
  canvas.style.outline = "none";

  const floatOk = !!gl.getExtension("EXT_color_buffer_float");
  gl.getExtension("OES_texture_float_linear");

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const P = {
    bg: compile(gl, VERT, PREP_BG),
    fg: compile(gl, VERT, PREP_FG),
    gather: compile(gl, VERT, GATHER.replace("__N__", "72")),
    comp: compile(gl, VERT, COMPOSITE),
    blit: compile(gl, VERT, BLIT),
  };

  const tex = {
    plate: upload(gl, plateImg, true),
    fill: upload(gl, fillImg, true),
    alpha: upload(gl, alphaImg, false, true),
    key: upload(gl, keyImg, false),
  };
  for (const im of [plateImg, fillImg, alphaImg, keyImg]) im.close?.();

  const film = createFilm(gl, { width: 2, height: 2 });

  // Render targets, sized to the print.
  const target = (w, h, { mips = false, half = true, red = false } = {}) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    const levels = mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
    const fmt = red ? (floatOk ? gl.R16F : gl.R8) : half && floatOk ? gl.RGBA16F : gl.RGBA8;
    gl.texStorage2D(gl.TEXTURE_2D, levels, fmt, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { t, w, h };
  };
  const fbo = (...ts) => {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    ts.forEach((x, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, x.t, 0));
    gl.drawBuffers(ts.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    return fb;
  };
  let T = null;
  const freeTargets = () => {
    if (!T) return;
    for (const k of Object.keys(T)) {
      const x = T[k];
      if (x instanceof WebGLFramebuffer) gl.deleteFramebuffer(x);
      else if (x && x.t) gl.deleteTexture(x.t);
    }
    T = null;
  };
  const makeTargets = (w, h) => {
    freeTargets();
    const hw = Math.max(2, Math.ceil(w / 2));
    const hh = Math.max(2, Math.ceil(h / 2));
    const t = {
      bgCol: target(hw, hh, { mips: true }),
      bgCoc: target(hw, hh, { mips: true, red: true }),
      fgCol: target(hw, hh, { mips: true }),
      fgCoc: target(hw, hh, { mips: true, red: true }),
      bgBlur: target(hw, hh),
      fgBlur: target(hw, hh),
      scene: target(w, h),
      out: target(w, h, { half: false }),
    };
    t.bgFb = fbo(t.bgCol, t.bgCoc);
    t.fgFb = fbo(t.fgCol, t.fgCoc);
    t.bgBlurFb = fbo(t.bgBlur);
    t.fgBlurFb = fbo(t.fgBlur);
    t.sceneFb = fbo(t.scene);
    t.outFb = fbo(t.out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    T = t;
    film.resize(w, h);
  };

  // The print: 3:2, as large as the box allows with paper round it.
  const rect = { x: 0, y: 0, w: 1, h: 1 };
  let pw = 0;
  let ph = 0;
  const layout = (w, h) => {
    const gutter = Math.max(16, w * 0.06);
    const pwCss = Math.floor(Math.min(w - gutter * 2, h * 0.78 * ASPECT, 1560));
    rect.w = pwCss;
    rect.h = Math.round(pwCss / ASPECT);
    rect.x = Math.round((w - rect.w) / 2);
    rect.y = Math.round((h - rect.h) / 2);
    const dpr = stage.dpr;
    const nw = Math.round(rect.w * dpr);
    const nh = Math.round(rect.h * dpr);
    if (nw !== pw || nh !== ph) {
      pw = nw;
      ph = nh;
      makeTargets(pw, ph);
    }
  };

  // State: progress 0 (blank) .. 1 (developed), its velocity, which way the
  // front runs through depth, the axis a drag moves it along, and how
  // stirred the strata are.
  const st = {
    p: fixed ?? 0,
    v: 0,
    // The opening runs as a print comes up: the darkest, nearest steel first.
    dir: params.get("from") === "far" ? 1 : -1,
    axis: null,
    stir: 0,
    stirV: 0,
    speed: 0,
  };
  let opening = fixed == null && !still ? { t: -0.5, dur: 2.6 } : null;
  // where the opening leaves the front (the inverse of frontOf's first leg)
  const openTo = () => {
    const [k, fk] = knotOf(st.dir);
    return ((OPEN_FRONT - F_START) / (fk - F_START)) * k;
  };
  if (fixed == null && (still || reduced)) st.p = openTo();
  let drag = null;
  let dirty = true;
  let grainT = 0;
  let seed = 7;
  let time = 0;

  const inside = (p, slop = 24) => p.x > rect.x - slop && p.x < rect.x + rect.w + slop && p.y > rect.y - slop && p.y < rect.y + rect.h + slop;
  const span = () => Math.max(220, Math.min(rect.w, rect.h * 1.25) * 0.85);

  stage.on("down", (p) => {
    if (!inside(p)) return;
    opening = null;
    if (st.p < 0.015 && Math.abs(st.v) < 0.05) {
      // From blank, where you press decides the order: the sky, and the
      // developer comes in from the far sky towards you; the mast, and it
      // spreads from the nearest steel outward.
      const u = (p.x - rect.x) / rect.w;
      const v = (p.y - rect.y) / rect.h;
      st.dir = alphaAt(u, v) > 0.4 ? -1 : 1;
      st.axis = null;
    }
    drag = { x: p.x, y: p.y, p0: st.p, t: performance.now() };
    st.v = 0;
    canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (!drag) {
      canvas.style.cursor = inside(p, 0) ? "grab" : "";
      return;
    }
    const dx = p.x - drag.x;
    const dy = p.y - drag.y;
    if (!st.axis) {
      const m = Math.hypot(dx, dy);
      if (m < 6) return;
      st.axis = [dx / m, dy / m];
    }
    const raw = drag.p0 + (dx * st.axis[0] + dy * st.axis[1]) / span();
    const prev = st.p;
    st.p = rubber(raw, 0, 1);
    const now = performance.now();
    const dt = Math.max(0.008, (now - drag.t) / 1000);
    drag.t = now;
    st.speed += ((st.p - prev) / dt - st.speed) * Math.min(1, dt / 0.05);
    dirty = true;
  });
  stage.on("up", (p) => {
    if (!drag) return;
    drag = null;
    canvas.style.cursor = inside(p, 0) ? "grab" : "";
    if (st.axis) st.v = clamp((p.vx * st.axis[0] + p.vy * st.axis[1]) / span(), -5, 5);
    dirty = true;
  });

  const onKey = (e) => {
    const step = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    opening = null;
    st.v += step * 0.55;
    dirty = true;
  };
  canvas.addEventListener("keydown", onKey);

  stage.onResize((w, h) => {
    layout(w, h);
    dirty = true;
  });

  const bindTex = (unit, t) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
  };
  const common = (prog) => {
    const u = prog.u;
    gl.uniform1i(u.uPlate, 0);
    gl.uniform1i(u.uFill, 1);
    gl.uniform1i(u.uAlpha, 2);
    gl.uniform1i(u.uKey, 3);
    gl.uniform1f(u.uFront, frontOf(st.p, st.dir));
    gl.uniform1f(u.uDir, st.dir);
    gl.uniform1f(u.uZ, Z * (1 + 1.3 * st.stir));
    gl.uniform1f(u.uCoC, (COC * pw) / 2 / 1100);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uDrift, still || reduced ? 0 : 0.14);
  };

  const begin = () => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    bindTex(0, tex.plate);
    bindTex(1, tex.fill);
    bindTex(2, tex.alpha);
    bindTex(3, tex.key);
  };

  // 1. Layers at half res: light + circle of confusion.
  const drawLayers = () => {
    begin();
    gl.viewport(0, 0, T.bgCol.w, T.bgCol.h);
    for (const [prog, fb] of [
      [P.bg, T.bgFb],
      [P.fg, T.fgFb],
    ]) {
      gl.useProgram(prog.p);
      common(prog);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    for (const x of [T.bgCol, T.bgCoc, T.fgCol, T.fgCoc]) {
      gl.bindTexture(gl.TEXTURE_2D, x.t);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
  };

  // 2. Defocus one layer (0 sky, 1 structure), optionally one band of rows.
  const drawGather = (layer, band = 0, bands = 1) => {
    const hw = T.bgCol.w;
    const hh = T.bgCol.h;
    gl.bindVertexArray(vao);
    gl.viewport(0, 0, hw, hh);
    gl.useProgram(P.gather.p);
    gl.uniform1i(P.gather.u.uCol, 4);
    gl.uniform1i(P.gather.u.uCocT, 5);
    gl.uniform2f(P.gather.u.uTexel, 1 / hw, 1 / hh);
    gl.uniform1f(P.gather.u.uAspect, ASPECT);
    gl.uniform1f(P.gather.u.uSky, layer === 0 ? 1 : 0);
    const [col, coc, fb] = layer === 0 ? [T.bgCol, T.bgCoc, T.bgBlurFb] : [T.fgCol, T.fgCoc, T.fgBlurFb];
    bindTex(4, col.t);
    bindTex(5, coc.t);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    if (bands > 1) {
      const y0 = Math.floor((hh * band) / bands);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, y0, hw, Math.floor((hh * (band + 1)) / bands) - y0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
  };

  const drawFinal = () => {
    begin();
    // 3. Composite at full res, in linear light.
    gl.useProgram(P.comp.p);
    common(P.comp);
    bindTex(0, tex.plate);
    bindTex(1, tex.fill);
    bindTex(2, tex.alpha);
    bindTex(3, tex.key);
    bindTex(4, T.bgBlur.t);
    bindTex(5, T.fgBlur.t);
    gl.uniform1i(P.comp.u.uBgBlur, 4);
    gl.uniform1i(P.comp.u.uFgBlur, 5);
    gl.uniform1f(P.comp.u.uSig, SIGMA * (1 + 0.9 * Math.min(1, Math.abs(st.speed) * 0.8)));
    const ends = clamp(st.p / 0.03, 0, 1) * clamp((1 - st.p) / 0.03, 0, 1);
    gl.uniform1f(P.comp.u.uBand, BAND * ends * ends * (3 - 2 * ends));
    gl.viewport(0, 0, pw, ph);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.sceneFb);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 4. Develop the frame on film, then lay the print on the paper.
    film.render(T.scene.t, { ...FILM, grainSeed: seed }, T.outFb);
    gl.bindVertexArray(vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const dpr = stage.dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const x = Math.round(rect.x * dpr);
    const y = canvas.height - Math.round(rect.y * dpr) - ph;
    gl.viewport(x, y, pw, ph);
    gl.useProgram(P.blit.p);
    bindTex(0, T.out.t);
    gl.uniform1i(P.blit.u.uSrc, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    canvas.setAttribute("aria-valuenow", String(Math.round(clamp(st.p, 0, 1) * 100)));
  };

  const draw = () => {
    if (!T) return;
    drawLayers();
    drawGather(0);
    drawGather(1);
    drawFinal();
  };

  stage.onFrame((dt) => {
    time += dt;
    const before = st.p;
    if (opening) {
      // Opens on the blank sheet; the sky comes up out of it, far to near,
      // and the front stops partway, handing over.
      opening.t += dt;
      const k = easeOutExpo(clamp(opening.t / opening.dur, 0, 1));
      st.p = openTo() * k;
      if (opening.t >= opening.dur) opening = null;
      dirty = true;
    } else if (!drag) {
      // Carry the hand's speed with friction (tau 240 ms), and spring back
      // inside the ends.
      const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        st.v *= Math.exp(-h / 0.24);
        let a = 0;
        if (st.p > 1) a = -120 * (st.p - 1) - 2 * 0.85 * 11 * st.v;
        else if (st.p < 0) a = -120 * st.p - 2 * 0.85 * 11 * st.v;
        st.v += a * h;
        st.p += st.v * h;
      }
      if (Math.abs(st.v) < 1e-3 && st.p >= 0 && st.p <= 1) st.v = 0;
      if (st.v !== 0) dirty = true;
      if (st.p < 0.004 && st.v === 0 && st.axis) {
        // Back to blank: the next press chooses again.
        st.p = 0;
        st.axis = null;
      }
    }
    const rate = (st.p - before) / Math.max(dt, 1e-3);
    if (!drag) st.speed += (rate - st.speed) * Math.min(1, dt / 0.06);
    else if (performance.now() - drag.t > 60) st.speed *= Math.exp(-dt / 0.08);
    // The strata are stirred by the front's speed and settle on a spring
    // (damping ratio 0.85).
    const target = Math.min(1, Math.abs(st.speed) * 0.9);
    {
      const w = 7;
      const z = 0.85;
      const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        st.stirV += (-2 * z * w * st.stirV - w * w * (st.stir - target)) * h;
        st.stir += st.stirV * h;
      }
      if (Math.abs(st.stir - target) > 1e-4 || Math.abs(st.stirV) > 1e-4) dirty = true;
      else {
        st.stir = target;
        st.stirV = 0;
      }
    }
    if (Math.abs(st.speed) > 1e-4) dirty = true;
    else st.speed = 0;
    // Grain and the strata's slow drift move at 24 fps, never at 60.
    if (!still && !reduced) {
      grainT += dt;
      if (grainT >= 1 / 24) {
        grainT %= 1 / 24;
        seed = (seed + 1.618) % 997;
        dirty = true;
      }
    }
    if (dirty && !busy) {
      dirty = false;
      if (still) {
        busy = drawSlow().then(() => {
          busy = null;
        });
      } else draw();
    }
  });
  void embedded;
  // Stills (and software GL in CI) get the defocus in small pieces, each in
  // its own task, so no one task runs long; capture() reads the print back
  // in the same task as its last draw (the drawing buffer is not kept).
  let busy = null;
  const drawSlow = async () => {
    const wait = () => new Promise((r) => setTimeout(r, 20));
    if (!T) return;
    drawLayers();
    gl.finish();
    await wait();
    for (let l = 0; l < 2; l++) {
      for (let b = 0; b < 16; b++) {
        if (!T) return;
        drawGather(l, b, 16);
        gl.finish();
        await wait();
      }
    }
    if (T) drawFinal();
  };
  if (still) {
    canvas.capture = async () => {
      while (busy) await busy;
      busy = drawSlow();
      await busy;
      busy = null;
      return canvas.toDataURL("image/png");
    };
  }

  return {
    destroy() {
      canvas.removeEventListener("keydown", onKey);
      freeTargets();
      film.destroy();
      for (const k of Object.keys(tex)) gl.deleteTexture(tex[k]);
      for (const k of Object.keys(P)) gl.deleteProgram(P[k].p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
