import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Denchuka (無電柱化): Japan's slow programme of putting the overhead lines
// underground, run forward under one concrete pole.
//
// The bake (tools/depth/bakes/denchuka) takes ky kim's worm's-eye photograph
// of a pole head apart element by element: fourteen wires (the sky matte's
// sub-pixel alpha; Hough segments grown into whole spans, and the bundle that
// runs up out of the top of the frame; each carries its own tail, the grip,
// connector and jumper or drop leads past its span, so it leaves nothing
// hanging off the hardware), the hardware in three pieces (the two lower
// transformers with their brackets and loops, the upper transformer, the
// crossarms with their insulators, strain clamps and cutouts; SAM 2.1 for the
// transformers), and the
// shaft (a cone fitted to SAM's mask). The clean plates: no wires; no wires or
// hardware, the bare shaft standing; nothing overhead at all. Against the sky
// every hole is a membrane of the sky round it; the bare shaft is rebuilt from
// its own clean run below the hardware (shading across it, brightness along it,
// its concrete mirrored up), with a rounded end. So every in-between state is
// two neighbouring clean plates that agree everywhere but under the element.
//
// Live: drag sideways through the years. Each element has its year. A wire
// loses its tension and sags, then falls out of the frame under gravity (a
// thin line with a short shutter streak behind it); then the hardware is lowered down
// the pole, bottom piece first; then the pole itself goes down its own axis
// into the ground below the frame. Gravity is the camera's: the frame looks
// ~55 degrees up, so "down" is away from the zenith's vanishing point above the
// frame, where the pole's axis meets it (MoGe-2's gravity from the pole's own
// normals, snapped onto that axis), and each wire falls along the converging
// verticals where it hangs. Pulled back, everything returns the way it went. A
// moving piece is drawn from its own plate, unmixed against the plate behind
// it (photo = a x object + (1 - a) x plate), so it carries no sky with it.
//
// The scan's sky is a pale cyan-azure, the same from the bottom of the frame to
// the top. It is regraded live, through the sky matte (sky.png R: the photo's
// matte plus every hole the plates fill with sky, times whatever still stands
// in front), to a summer cobalt that deepens with elevation (sky.png G: how far
// up the sky each pixel looks, from the camera), with skylight-blue shade and
// warm sunlit tops on the cloud; the film then adds only its optics: a thin
// diffusion and a warm halation ring keyed on luminance (GLOW), laid in the
// sky's own hue where it lands on the open cobalt round the cumulus, then its
// curve. The shaft, hardware and
// wires are graded as their own element (solidGrade): the concrete stands in
// the same sun as the cloud, its lit flank a warm grey, its shade side the
// skylight blue of the cloud's own shade, a bright rim where the sun grazes
// the shaft, a step below the crowns so its sharp silhouette is still the
// frame's anchor. Its edge is redrawn from a clean, choked matte (solid.py)
// over the regraded sky, its colour read from inside it, so it carries no
// fringe of the scan's sky.
//
// Behind the pole stands a real towering cumulus, rising out of the bottom of
// the frame behind the shaft and filling the right half of it, its crown up
// behind the transformers, clear cobalt over it (cloud.py: Poly Haven's Skidpan HDRI,
// CC0, cut at its own resolution and placed under this camera so its
// verticals converge with the pole's), laid into the same regrade through
// the same matte (sky.png B its soft coverage, cloud.webp its light, from
// its deepest shade pocket to its brightest crown): its sunlit crowns
// warm-neutral and rolled off below white, its shade pockets a saturated
// skylight blue, keeping the billows' own relief, deepening up the sky with
// the cobalt. Each removal
// uncovers more of it; at the end it is the subject of the clean sky.
//
// Query: ?year=0..1 holds the years (elements caught mid-motion, as a still);
// ?film=0 shows the plates before the film.

const BASE = "/lab/denchuka/";
const PW = 2400;
const PH = 1600;
const MAX_W = 24;
const MAX_P = 8;

// seconds each kind of element takes to go
const DUR = { wire: 0.95, hw: 1.25, pole: 1.9 };
// the still: how much of the year axis one element's motion spans
const STILL_SPAN = { wire: 0.035, hw: 0.04, pole: 0.05 };
// A falling wire is drawn where it is, crisp, at its own matte and full ink,
// with a short streak behind it: what a 180-degree shutter at 24 fps sees
// (half a frame of its travel), but never longer than about two and a half of
// its own widths, so it stays a line that falls and never becomes a band.
const FRAME = 1 / 24;
const SHUTTER = 0.5;
// a wire's width in the plate (its matte summed across it: 1.8 to 3 px)
const WIRE_W = 2.6;
const WIRE_STREAK = (2.5 * WIRE_W).toFixed(2);
// the streak is sampled half a pixel apart
const STREAK_SAMPLES = 14;
// the emulsion's light (GLOW): how much of the highlights' light spreads, and
// how much comes back warm off the base as a ring
// how much of the highlights' light spreads, and how much comes back warm off
// the base as a ring; solid: the same two on the shaft and hardware (not sky),
// so the concrete takes a thin warm ring and no white glow; cloudDiff,
// cloudRing: the same two off the cumulus. Its spread white light on the
// cobalt reads as a pale matte fringe round the tower, so it is kept low, and
// what lands on the open sky takes the sky's hue (GLOW: SKY_LIT).
const OPTIC = { diffusion: 0.2, halation: 0.75, halationThin: 0.05, halationColor: [1, 0.66, 0.32], solid: [0.05, 0.3], cloudRing: 0.55, cloudDiff: 0.3 };

// The pole's rebuilt top meets its clean run at plate row SEAM; the run below
// it (to row 1590) is mirrored up over the rebuild, and the cone's half-width
// across a row is POLE_HW[0] * y + POLE_HW[1] px (fitted to alpha.png B).
const POLE_SEAM = 1060;
const POLE_MIRROR = ((1590 - POLE_SEAM) / (POLE_SEAM - 335)).toFixed(4);
const POLE_HW = [0.0514, 0.94];

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMP = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uP0;
uniform sampler2D uP1;
uniform sampler2D uP2;
uniform sampler2D uP3;
uniform highp sampler2D uIds;
uniform sampler2D uAlpha;
uniform sampler2D uSky;           // r: the sky with everything overhead gone (1 = sky); g: elevation; b: the cumulus
uniform sampler2D uCloud;         // the cumulus's own colour (cloud.py)
uniform sampler2D uClean;         // r: the hardware, g: the shaft: clean, choked coverage (solid.py)
uniform sampler2D uScatter;       // the cumulus's light, blurred: r wide (~3.5% of the frame), g tight (~0.5%)
uniform highp sampler2D uState;   // x: id, row 0 wires / 1 hardware / 2 poles: 1 = in place
uniform vec2 uPlate;
uniform int uNW;
uniform vec4 uW[${MAX_W}];        // span start, end (x, or y for a steep wire), sag, fall
uniform vec4 uW2[${MAX_W}];       // id, y0, y1, this pole's end (1: at the span's end, 0: its start)
uniform vec4 uW3[${MAX_W}];       // sag, fall when the shutter opened; fall slant dx/dy; steep
uniform vec4 uW4[${MAX_W}];       // the far end's fall, now and when the shutter opened
uniform int uNP;
uniform vec4 uPo[${MAX_P}];       // id, k, c, offset
uniform vec4 uPo2[${MAX_P}];      // top, base, reach from the axis, how far the last hardware has gone
uniform int uNH;
uniform vec4 uHw[${MAX_P}];       // id, k, c, offset
uniform vec4 uHw2[${MAX_P}];      // top, base, reach from the axis, bottom

ivec4 ids(ivec2 p) {
  vec3 v = texelFetch(uIds, clamp(p, ivec2(0), ivec2(uPlate) - 1), 0).rgb * 255.0 + 0.5;
  int w = int(v.r);
  int g = int(v.g);
  int b = int(v.b);
  return ivec4(w, g / 16, g - (g / 16) * 16, b);
}
bool rest(int row, int id) {
  return texelFetch(uState, ivec2(id, row), 0).r > 0.5;
}
vec3 plate(int s, vec2 px, int rk) {
  vec2 uv = px / uPlate;
  if (s == 0 || rk == 0 || s < rk) return texture(uP0, uv).rgb;
  if (s == 1) return texture(uP1, uv).rgb;
  if (s == 2) return texture(uP2, uv).rgb;
  return texture(uP3, uv).rgb;
}
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-6)), d / (q.x + 1e-6), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
// The scan's sky is a pale cyan-azure (hue ~206, value ~0.8), flat from the
// bottom of the frame to the top, and hazed toward its upper right, where its
// own thin cloud stands (saturation down to ~0.35 there). A summer sky seen
// almost straight up is a deep, clean cobalt that darkens toward the zenith,
// so the clear sky is not moved from the scan's colour but laid down whole:
// one hue (~207, turning a touch bluer going up), one saturation, and a value
// set by how deep into the sky the pixel looks (deep: 0 at the frame's lower
// edge, 1 at the zenith, over the top of the frame where the pole's verticals
// converge), so after the film it runs from ~0.64 at the bottom to ~0.50 up
// there, the depth that makes the cumulus's crowns glow against it. What of
// the scan's sky is its own cloud is read off its saturation against the
// clean scan sky's (~0.74), unmixed: thin haze (the grey veil round the
// upper right, a < ~0.5) goes to the cobalt with the open sky, and only real cloud
// keeps its own grade over it. Its cloud is lit from high right: its shadow
// sides take the blue of the sky that lights them, its sunlit tops go
// warm-neutral.
const vec3 COBALT = vec3(207.0, 0.78, 0.69);
// the scan's own cloud's share of a pixel of its bare sky
float scanCloud(vec3 h) {
  float deg = h.x * 360.0;
  // the scan's clear sky is in the azure band; anything else is its cloud
  float band = smoothstep(168.0, 184.0, deg) * (1.0 - smoothstep(236.0, 250.0, deg));
  float a = mix(1.0, clamp(1.0 - h.y / 0.74, 0.0, 1.0), band);
  // its cloud's share, with the thin haze over the sky (a < ~0.5) taken out
  return smoothstep(0.5, 0.95, a);
}
vec3 skyGrade(vec3 c, float deep) {
  vec3 h = rgb2hsv(c);
  float cloudA = scanCloud(h);
  vec3 sky = hsv2rgb(vec3((COBALT.x + 3.0 * deep) / 360.0, COBALT.y, COBALT.z * mix(1.0, 0.77, deep)));
  // cloud: more range; shade sides to skylight blue, sunlit tops to warm white
  float v = clamp(0.86 + (h.z - 0.86) * 1.5, 0.0, 1.0);
  float shade = smoothstep(0.94, 0.76, h.z);
  float top = smoothstep(0.88, 0.97, h.z);
  vec3 shadeC = hsv2rgb(vec3(213.0 / 360.0, 0.1 + 0.14 * shade, v * mix(1.0, 0.94, shade)));
  vec3 sunC = hsv2rgb(vec3(36.0 / 360.0, 0.08, v));
  vec3 cloud = mix(shadeC, sunC, top);
  return mix(sky, cloud, cloudA);
}
// The towering cumulus (cloud.py: a photographed tower, unclipped, placed
// under this camera) graded into the same light, so it glows and carries the
// frame: the bright subject the dark pole cuts across. The bake carries one
// number, the tower's light t (its own log radiance over its own range, 0 its
// deepest shade pocket, 1 its brightest crown, across all 8 bits), and this
// turns it into the whole relief on one curve, so no lobe's edge steps or
// rings: the shade pockets, lit only by a whole bright summer sky, a clearly
// saturated skylight blue (hue ~205, sat ~0.42, value ~0.70); the shaded body
// a clear blue paling as each billow catches more light; the sunlit flanks
// and crowns in the sun's own warm neutral at ~0.92-0.97, the top percent or
// two rolled off just under white (~250 on screen), none of it clipped. So
// the tower has volume, luminous crowns stepping down into blue shade, and is
// never a milky grey wash. A little deeper and bluer the higher up the sky it
// is (the cobalt ramp, zen). The sun on the crowns is the same sun as the
// concrete, a warm neutral (#fff9f3) that the film's own warmth carries the
// rest of the way.
const vec3 SUN = vec3(1.0, 0.978, 0.952);
vec3 cloudGrade(vec3 c, float zen) {
  float t = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // lightness: the pockets ~0.70, the body ~0.78-0.85, the crowns ~0.92-0.97,
  // the brightest percent or two rolled off toward ~0.98-0.99
  float L = min(0.70 + 0.27 * t + 0.03 * smoothstep(0.55, 0.95, t), 0.99);
  // how much of the sun this face sees: its colour only, wide and soft
  float top = smoothstep(0.5, 0.86, t);
  // skylight: saturated in the pockets, falling as a billow catches more
  // light, a touch more up the sky; never pale cyan, never a dead grey
  float ss = mix(0.4, 0.05, smoothstep(0.08, 0.8, t)) * mix(0.95, 1.06, zen);
  vec3 shadeC = hsv2rgb(vec3((205.0 + 3.0 * zen) / 360.0, ss, L * mix(1.0, 0.975, zen)));
  vec3 sunC = SUN * L;
  return mix(shadeC, sunC, top);
}
// The cumulus's edge, in the air (cloud.py: the edge). Its coverage (sky.png
// B) falls off over ~10-14 plate px, reaching into its silhouette, and what
// is left of the cloud in that falloff is thin cloud lit by the same air as
// the cobalt round it. Laid over the cobalt as a straight mix of the two, the
// falloff passed through their average, a darker, greyed blue (as dark as the
// cobalt, half its saturation): a navy rim all along the crowns, the cloud
// cut out and pasted. So the falloff is built in the sky's own hue instead,
// its light leading its colour: as the coverage rises the edge first
// brightens (value, most of the way by b ~0.6) in the local sky's hue at
// nearly the sky's saturation, and only then pales toward the cloud's own
// colour, which takes over from b ~0.5 to 1. The edge is lit air, a lighter
// blue of the sky round it brightening into the crown, never darker or
// greyer than either side of it.
vec3 cloudEdge(vec3 c, vec3 sky, float b) {
  vec3 ch = rgb2hsv(c);
  vec3 sh = rgb2hsv(sky);
  float lightUp = smoothstep(0.0, 0.8, b);
  float pale = smoothstep(0.15, 1.0, b);
  vec3 air = hsv2rgb(vec3(sh.x, mix(sh.y, ch.y, pale), mix(sh.z, ch.z, lightUp)));
  return mix(air, c, smoothstep(0.5, 1.0, b));
}
// The concrete, in the same light as the cumulus. The scan has the shaft and
// its cans in sun from the right (their lit flanks ~0.66-0.90, the shade
// third and the cans' undersides ~0.27-0.37), and the tower behind is lit from
// the right too, so the scan's own light is kept and only its colour and range
// are moved into the regrade's: the lit flank a warm grey (hue ~35, low
// chroma, ~0.55-0.65), the shade side the skylight blue the cloud's own shade
// pockets take (hue ~205, sat ~0.25, ~0.25-0.30), and the bolts, wires and
// clamps that are darker than the shade keep their own darks. Sunlit concrete
// standing in the air in front of the cloud, a step darker than the crowns so
// the silhouette still cuts across them, never a pasted navy cutout. Only a
// trace of the scan's own chroma stays, so its stains and seams are still in
// it. Wires take the same grade without the lift (near black, they stay so).
const vec3 SUN_RIM = vec3(0.88, 0.86, 0.82);
const vec3 SHADE_TINT = vec3(0.8, 0.909, 1.0);    // hue 205, sat 0.2
const vec3 LIT_TINT = vec3(1.0, 0.972, 0.93);     // hue 42, sat 0.07
// lift: 1 on the concrete and the cans, whose undersides (~0.07 in the scan,
// facing away from the sky) are lifted to a deep skylight shade (~0.2) and
// only the bolts and seams under ~0.04 keep their black; 0 on a wire, which
// stays a dark line
vec3 solidGrade(vec3 c, float lift) {
  float v = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float g = v < 0.3 ? mix(v * 0.9, 0.16 + v * 0.4, lift * smoothstep(0.0, 0.09, v)) : 0.28 + (v - 0.3) * 0.58;
  float lit = smoothstep(0.38, 0.72, v);
  vec3 tint = mix(SHADE_TINT, LIT_TINT, lit);
  tint /= dot(tint, vec3(0.2126, 0.7152, 0.0722));
  vec3 chroma = (c - vec3(v)) * (g / max(v, 0.05));
  return clamp(g * tint + 0.12 * chroma, 0.0, 1.0);
}
vec3 solidGrade(vec3 c) {
  return solidGrade(c, 0.0);
}
// The sun grazing the shaft's lit flank: a thin bright rim, the last few
// pixels in from its right edge (u, across the cone: 1 at its edge), only
// where the scan has that flank in sun (lum), so a wire or a bracket across
// it keeps its own dark.
vec3 sunRim(vec3 obj, float u, float lum) {
  float r = smoothstep(0.8, 0.93, u) * smoothstep(0.62, 0.8, lum);
  return mix(obj, SUN_RIM, r * 0.75);
}
// A wire's matte at a plate point, filtered bilinearly over its own texels
// only, so a wire moved by a fraction of a pixel keeps its sub-pixel width
// instead of snapping to the grid. best: its densest texel there (for colour).
float wireMatte(vec2 src, int id, out ivec2 best) {
  vec2 q = src - 0.5;
  ivec2 i0 = ivec2(floor(q));
  vec2 f = q - vec2(i0);
  float a = 0.0;
  float top = 0.0;
  best = ivec2(-1);
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    ivec2 p = i0 + o;
    if (p.x < 0 || p.y < 0 || p.x >= int(uPlate.x) || p.y >= int(uPlate.y)) continue;
    if (ids(p).x != id) continue;
    float m = texelFetch(uAlpha, p, 0).r;
    a += m * (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y);
    if (m > top) {
      top = m;
      best = p;
    }
  }
  return a;
}
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
// the shaft's matte (alpha.png B) filtered bilinearly over its texels
float shaftMatte(vec2 p) {
  vec2 q = p - 0.5;
  ivec2 i0 = ivec2(floor(q));
  vec2 f = q - vec2(i0);
  ivec2 hi = ivec2(uPlate) - 1;
  float a00 = texelFetch(uAlpha, clamp(i0, ivec2(0), hi), 0).b;
  float a10 = texelFetch(uAlpha, clamp(i0 + ivec2(1, 0), ivec2(0), hi), 0).b;
  float a01 = texelFetch(uAlpha, clamp(i0 + ivec2(0, 1), ivec2(0), hi), 0).b;
  float a11 = texelFetch(uAlpha, clamp(i0 + ivec2(1, 1), ivec2(0), hi), 0).b;
  return mix(mix(a00, a10, f.x), mix(a01, a11, f.x), f.y);
}
// the cone's half-width across a plate row (alpha.png B, fitted)
float poleHw(float y) {
  return ${POLE_HW[0]} * y + ${POLE_HW[1]};
}
// the object alone: photo = a * object + (1 - a) * behind
vec3 unmix(vec3 withIt, vec3 behind, float a) {
  return clamp((withIt - (1.0 - a) * behind) / max(a, 0.2), 0.0, 1.0);
}

// The cumulus's light, as baked. (Its shade once lived in some 25 steps of 8
// bits and was debanded here by averaging each pixel with the cloud round
// it, which smeared the billows; the bake now spreads the light across all
// 256 steps, so it is drawn at its own resolution, as crisp as the wires.)
vec3 cloudTex(vec2 pp) {
  return texture(uCloud, pp / uPlate).rgb;
}

// how much of a plate pixel is still covered by a standing piece (a wire,
// the hardware, the shaft), for the light wrap round a wire's edges
float standCov(ivec2 p) {
  ivec2 q = clamp(p, ivec2(0), ivec2(uPlate) - 1);
  ivec4 e = ids(q);
  float c = 0.0;
  if (e.x > 0 && rest(0, e.x)) c = texelFetch(uAlpha, q, 0).r;
  vec2 m = texelFetch(uClean, q, 0).rg;
  if (e.y > 0 && rest(1, e.y)) c = max(c, m.r);
  if (e.z > 0 && rest(2, e.z)) c = max(c, m.g);
  return c;
}
// where a plate point is across a standing shaft (pole id): -1 its left
// edge, 1 its right
float shaftU(vec2 pp, int id) {
  for (int j = 0; j < ${MAX_P}; j++) {
    if (j >= uNP) break;
    if (int(uPo[j].x + 0.5) != id) continue;
    return (pp.x - (uPo[j].y * pp.y + uPo[j].z)) / poleHw(pp.y);
  }
  return 0.0;
}
// The standing solid (hardware, shaft) at a plate texel: its clean coverage
// (solid.py) and the plate that shows it without the wires in front (pl: 1
// while its hardware stands, 2 the bare shaft, 3 nothing).
float solidAt(ivec2 p, out int pl) {
  ivec2 q = clamp(p, ivec2(0), ivec2(uPlate) - 1);
  ivec4 e = ids(q);
  vec2 m = texelFetch(uClean, q, 0).rg;
  float a = 0.0;
  pl = 3;
  if (e.z > 0 && rest(2, e.z)) {
    a = m.g;
    pl = 2;
  }
  if (e.y > 0 && rest(1, e.y)) {
    a = max(a, m.r);
    pl = 1;
  }
  return a;
}
// The solid's colour at a plate point, premultiplied properly: an edge pixel
// of the photograph is the object and the scan's pale sky mixed, and
// unmixing it against the plate's sky amplifies the matte's noise into a
// stippled pale fringe. So the colour is never read from the edge: it is read
// at the nearest texel within two that the solid covers whole (the nearer
// ring first), and the edge is that colour at the edge's coverage over the
// regraded sky.
vec3 solidColour(vec2 pp, ivec2 ip, int rk) {
  int pl;
  float ca = solidAt(ip, pl);
  if (ca >= 0.98) return plate(pl, pp, rk);
  ivec2 cq = ip;
  int cpl = pl;
  for (int r = 1; r <= 2; r++) {
    for (int k = 0; k < 8; k++) {
      ivec2 o = ivec2(k == 0 || k == 3 || k == 5 ? -1 : (k == 2 || k == 4 || k == 7 ? 1 : 0),
        k < 3 ? -1 : (k > 4 ? 1 : 0)) * r;
      int pl2;
      float a2 = solidAt(ip + o, pl2);
      if (a2 > ca + 0.02) {
        ca = a2;
        cq = ip + o;
        cpl = pl2;
      }
    }
    if (ca >= 0.98) break;
  }
  if (cq == ip) return plate(pl, pp, rk);
  return plate(cpl, vec2(cq) + 0.5, ids(cq).w / 64);
}

// The cumulus in the air, not on it (scatterMap). A real tower is seen
// through a few kilometres of lit air: its light scatters forward round its
// own silhouette, so the cobalt pales toward cyan for a good way out from
// every crown (the wide term, mostly green, a little blue, almost no red:
// the sky's own hue lifted toward the white, ~(3,95,160) to ~(34,135,181)
// over the last few percent of the frame before the edge), and the emulsion
// lays a thin warm-neutral halation right at the rim (the tight term, red a
// touch over green and blue), so the crowns roll off warm into the sky
// instead of being cut out of it. Both are read off the cloud's own light,
// blurred, so they follow every billow; both fade to a trace on the deep
// zenith cobalt far from any cloud, and neither reaches into the cloud's own
// relief (they are laid where its coverage falls below 1).
const vec3 AIR_LIFT = vec3(0.03, 0.2, 0.1);
const vec3 HALO_C = vec3(1.0, 0.94, 0.88);
// b: the cloud's own coverage here (the cumulus's, or the scan's own cloud's)
vec3 cloudAir(vec3 g, vec2 pp, float b, float deep) {
  vec2 sc = texture(uScatter, pp / uPlate).rg;
  float open = 1.0 - smoothstep(0.15, 0.8, b);
  // dark (zenith) sky far from any cloud takes only a trace of it
  float gate = mix(1.0, 0.6, deep) * smoothstep(0.008, 0.1, sc.r);
  g += AIR_LIFT * pow(sc.r, 0.8) * gate * open;
  // the tight ring: on the open sky beside the rim and on the rim itself,
  // its light and its colour both: the saturated cyan the edge's air would
  // otherwise brighten into is turned part way to the warm neutral
  float ring = smoothstep(0.03, 0.5, sc.g) * (1.0 - smoothstep(0.6, 0.98, b)) * mix(1.0, 0.7, deep);
  float y = dot(g, vec3(0.2126, 0.7152, 0.0722));
  vec3 warm = HALO_C * (y / dot(HALO_C, vec3(0.2126, 0.7152, 0.0722)));
  g = mix(g, warm, 0.35 * ring) + HALO_C * ring * 0.11;
  return g;
}
// the same thin ring on what stands in front of the cloud (the shaft, the
// hardware, a wire): the tower's light round its edge. open: how much of a
// short neighbourhood is open air (so only the silhouette's edge takes it)
vec3 cloudHalo(vec3 col, vec2 pp, float open, float k) {
  float t = texture(uScatter, pp / uPlate).g;
  return col + HALO_C * smoothstep(0.1, 0.8, t) * open * k;
}

void main() {
  vec2 pp = vec2(vUv.x, 1.0 - vUv.y) * uPlate;
  ivec2 ip = ivec2(floor(pp));
  ivec4 e = ids(ip);
  int rk = e.w / 64;

  int s = 3;
  if (e.z > 0 && rest(2, e.z)) s = 2;
  if (e.y > 0 && rest(1, e.y)) s = 1;
  if (e.x > 0 && rest(0, e.x)) s = 0;
  vec3 col = plate(s, pp, rk);
  vec3 al0 = texelFetch(uAlpha, ip, 0).rgb;
  // the standing wire's share of the pixel
  float cw = e.x > 0 && s == 0 ? al0.r : 0.0;
  // the standing hardware and shaft: their clean coverage, filtered
  bool hwUp = e.y > 0 && rest(1, e.y);
  bool shUp = e.z > 0 && rest(2, e.z);
  vec2 cl = texture(uClean, pp / uPlate).rg;
  float cs = max(hwUp ? cl.r : 0.0, shUp ? cl.g : 0.0);
  // The sky is regraded under whatever still stands in front of it, not
  // through it: a standing piece's rim is a mix of it and the scan's teal sky
  // (photo = a x object + (1 - a) x sky), so only the sky's share is moved,
  // by the grade of the sky behind everything (p3). Grading the mixed rim
  // pixel itself leaves the teal in it: a green outline round every shaft.
  // The cumulus stands in that same sky, behind everything: wherever the sky
  // shows, the cloud is laid over the regraded sky at its own coverage (b).
  vec3 sk = texture(uSky, pp / uPlate).rgb;
  vec3 behind = plate(3, pp, rk);
  // how deep into the sky this pixel looks: its elevation (sky.png G, 1 near
  // the zenith over the top of the frame), and toward the top edge as a whole,
  // whose upper right the pole's verticals run up into as well
  float deep = clamp(0.73 * sk.g + 0.5 * (1.0 - pp.y / uPlate.y), 0.0, 1.0);
  vec3 graded = skyGrade(behind, deep);
  if (sk.b > 0.002) graded = cloudEdge(cloudGrade(cloudTex(pp), sk.g), graded, sk.b);
  graded = clamp(cloudAir(graded, pp, max(sk.b, scanCloud(rgb2hsv(behind))), deep), 0.0, 1.0);
  float skyA;
  if (hwUp || shUp) {
    // Over the hardware and the shaft the pixel is built again from its
    // parts: the regraded sky behind, the solid at its clean coverage in its
    // own light, and any standing wire over both (unmixed against the plate
    // without it). Nothing of the photograph's mixed edge survives, so the
    // silhouette is cut clean against the cobalt and the cloud alike.
    vec3 bg = behind + sk.r * (graded - behind);
    vec3 sc = solidColour(pp, ip, rk);
    vec3 obj = solidGrade(sc, 1.0);
    if (shUp && (!hwUp || cl.r < 0.5)) obj = sunRim(obj, shaftU(pp, e.z), dot(sc, LUMA));
    col = mix(bg, obj, cs);
    // the cumulus's thin ring round the solid's silhouette: a few texels in
    // from where the open air is, fading inward
    if (cs > 0.01) {
      float open = 0.0;
      for (int k = 0; k < 8; k++) {
        ivec2 o = ivec2(k == 0 || k == 3 || k == 5 ? -1 : (k == 2 || k == 4 || k == 7 ? 1 : 0),
          k < 3 ? -1 : (k > 4 ? 1 : 0));
        int pl2;
        open += (1.0 - solidAt(ip + o * 2, pl2)) + 0.6 * (1.0 - solidAt(ip + o * 4, pl2)) + 0.3 * (1.0 - solidAt(ip + o * 7, pl2));
      }
      open = clamp(open / 5.0, 0.0, 1.0) * sk.r;
      col = clamp(cloudHalo(col, pp, open * cs, 0.16), 0.0, 1.0);
    }
    if (cw > 0.002) {
      vec3 under = plate(hwUp ? 1 : 2, pp, rk);
      col = mix(col, solidGrade(unmix(plate(0, pp, rk), under, cw)), cw);
    }
    skyA = sk.r * (1.0 - cs) * (1.0 - cw);
  } else {
    // a standing wire alone over the sky, graded as its own share only
    if (cw > 0.002) {
      vec3 obj = unmix(col, behind, cw);
      col += cw * (solidGrade(obj) - obj);
    }
    col = clamp(col, 0.0, 1.0);
    skyA = sk.r * (1.0 - cw);
    if (skyA > 0.002) col = clamp(col + skyA * (graded - behind), 0.0, 1.0);
  }
  // Light wrap on the wires: the sky behind a standing wire spills a little
  // round its edge (the share of the open sky in a 2 px neighbourhood), so the
  // line sits in the same light as what is behind it. Only a little: a wire,
  // 2-3 px across, is all edge, and it stays a dark line. The solids take
  // none: their edge is cut by their clean coverage, and a wrap there is the
  // pale double contour a dirty matte leaves.
  if (cw > 0.002 && sk.r > 0.002) {
    float openSky = 0.0;
    for (int k = 0; k < 8; k++) {
      ivec2 o = ivec2(k == 0 || k == 3 || k == 5 ? -1 : (k == 2 || k == 4 || k == 7 ? 1 : 0),
        k < 3 ? -1 : (k > 4 ? 1 : 0));
      openSky += (1.0 - standCov(ip + o)) + 0.5 * (1.0 - standCov(ip + o * 2));
    }
    openSky /= 12.0;
    col = mix(col, graded, clamp(0.18 * openSky * cw * (1.0 - cs) * sk.r, 0.0, 1.0));
    col = clamp(cloudHalo(col, pp, openSky * cw * (1.0 - cs) * sk.r, 0.08), 0.0, 1.0);
  }
  // what of this pixel is still sky (skyW) and of that the cumulus (cloudW),
  // after everything moving in front of it: the optics' keys (GLOW)
  float skyW = max(skyA, 0.0);
  float cloudW = skyW * sk.b;

  // poles going down their own axes, into the ground. The top of the shaft
  // (above POLE_SEAM) is the plate's rebuild where the hardware hid it: its
  // silhouette, rounded end and all, is right, but its surface is smooth, so
  // once it is all that is left standing it reads as a grey CG cylinder. Its
  // surface is read instead from the shaft's own clean run below the seam,
  // mirrored up about it (so the two meet with no step) and scaled across to
  // the cone's width there: the concrete's stains and the step bolts go down
  // with it. The matte is filtered over its own texels, so the slanted edges
  // never stair-step as the pole slides through the pixel grid.
  for (int j = 0; j < ${MAX_P}; j++) {
    if (j >= uNP) break;
    vec4 a = uPo[j];
    vec4 b = uPo2[j];
    float ax = a.y * pp.y + a.z;
    if (abs(pp.x - ax) > b.z || pp.y > b.y) continue;
    vec2 dir = normalize(vec2(a.y, 1.0));
    vec2 src = pp - dir * a.w;
    if (src.y < b.x - 2.0) continue;
    // standing: only over its rebuild, only what the plates show of it (no
    // wire or hardware still in front), and its bolts off it only as the
    // last of the hardware goes (b.w), so the photograph keeps its own pole
    bool standing = a.w <= 0.0;
    if (standing && (s < 2 || pp.y >= ${POLE_SEAM}.0)) continue;
    float alR = shaftMatte(src);
    float al = standing && rk != 2 ? 0.0 : alR;
    vec2 tex = src;
    vec2 csrc = src;
    if (src.y < ${POLE_SEAM}.0) {
      float ty = ${POLE_SEAM}.0 + (${POLE_SEAM}.0 - src.y) * ${POLE_MIRROR};
      float u = (src.x - (a.y * src.y + a.z)) / poleHw(src.y);
      tex = vec2(a.y * ty + a.z + u * poleHw(ty), ty);
      // the bolts stand off the shaft: where the run has one, it is drawn
      // (not on the rounded end); inside the silhouette the colour is read a
      // little in from the run's own edge, where its unmixing is sound
      // (not the run's first bolt, at row ~1120: a wire hugs the shaft
      // there and stands between it and the bolt's foot)
      float bolt = shaftMatte(tex) * smoothstep(b.x + 30.0, b.x + 70.0, src.y) * step(1170.0, ty);
      if (standing) bolt *= b.w * (1.0 - alR);
      if (bolt > al) {
        al = bolt;
        csrc = tex;
      } else {
        csrc = vec2(a.y * ty + a.z + clamp(u, -0.92, 0.92) * poleHw(ty), ty);
      }
    } else if (ids(ivec2(floor(src))).z != int(a.x + 0.5)) continue;
    if (al <= 0.003) continue;
    int srk = ids(ivec2(floor(csrc))).w / 64;
    float ca = max(texelFetch(uAlpha, ivec2(floor(csrc)), 0).b, 0.35);
    vec3 obj = solidGrade(unmix(plate(2, csrc, srk), plate(3, csrc, srk), ca), 1.0);
    float l0 = dot(plate(2, csrc, srk), LUMA);
    obj = sunRim(obj, (src.x - (a.y * src.y + a.z)) / poleHw(src.y), l0);
    // the grade compresses the concrete's own marks (stains, pour lines,
    // pitting) with its value: they are put back, read along the axis (never
    // across it, where the sky is)
    float lb = 0.25 * (dot(plate(2, csrc + dir * 3.0, srk), LUMA) + dot(plate(2, csrc - dir * 3.0, srk), LUMA)
      + dot(plate(2, csrc + dir * 7.0, srk), LUMA) + dot(plate(2, csrc - dir * 7.0, srk), LUMA));
    obj = clamp(obj + clamp(l0 - lb, -0.12, 0.12) * 0.3, 0.0, 1.0);
    col = mix(col, obj, al);
    skyW *= 1.0 - al;
    cloudW *= 1.0 - al;
  }

  // transformers, crossarms and cutouts lowered down the pole
  for (int j = 0; j < ${MAX_P}; j++) {
    if (j >= uNH) break;
    vec4 a = uHw[j];
    vec4 b = uHw2[j];
    float ax = a.y * pp.y + a.z;
    if (abs(pp.x - ax) > b.z || pp.y > b.y) continue;
    // locked to the axis: the piece keeps its offset from the shaft at every
    // row it passes, so it slides down the pole and never off it
    float dy = a.w / sqrt(1.0 + a.y * a.y);
    float sy = pp.y - dy;
    vec2 src = vec2(pp.x - (ax - (a.y * sy + a.z)), sy);
    if (src.y < b.x - 2.0 || src.y > b.w + 2.0) continue;
    ivec4 se = ids(ivec2(floor(src)));
    if (se.y != int(a.x + 0.5)) continue;
    // its clean coverage, and its colour from the nearest texel it covers
    // whole (as the standing solid's, solidColour)
    ivec2 is = ivec2(floor(src));
    float al = texture(uClean, src / uPlate).r;
    ivec2 cq = is;
    float ca = texelFetch(uClean, is, 0).r;
    for (int r = 1; r <= 2; r++) {
      if (ca >= 0.98) break;
      for (int k = 0; k < 8; k++) {
        ivec2 o = ivec2(k == 0 || k == 3 || k == 5 ? -1 : (k == 2 || k == 4 || k == 7 ? 1 : 0),
          k < 3 ? -1 : (k > 4 ? 1 : 0)) * r;
        ivec2 q = clamp(is + o, ivec2(0), ivec2(uPlate) - 1);
        float a2 = texelFetch(uClean, q, 0).r;
        if (a2 > ca + 0.02 && ids(q).y == se.y) {
          ca = a2;
          cq = q;
        }
      }
    }
    vec3 obj = solidGrade(cq == is ? plate(1, src, se.w / 64) : plate(1, vec2(cq) + 0.5, ids(cq).w / 64), 1.0);
    col = mix(col, obj, al);
    skyW *= 1.0 - al;
    cloudW *= 1.0 - al;
  }

  // wires: slack, then the swing, both along gravity where the wire hangs
  // (dx/dy = slant: away from the zenith's vanishing point). Let go at this
  // pole, a wire swings from its far end: that end holds, this end falls, and
  // every point between falls in proportion to how far it is from the far
  // end, with the slack bow on top. The wire is drawn where it is now, at its
  // own matte (bilinear, so a sub-pixel drop moves it smoothly) and full ink: a
  // thin dark arc. Behind it, back toward where it was when the shutter
  // opened, a short streak whose density runs down from the wire to nothing;
  // its sides are the wire's own soft matte edges.
  for (int j = 0; j < ${MAX_W}; j++) {
    if (j >= uNW) break;
    vec4 a = uW[j];
    vec4 b = uW2[j];
    vec4 c = uW3[j];
    vec4 e = uW4[j];
    float g = c.z;
    bool steep = c.w > 0.5;
    // where along its span this pixel's wire came from: the point s whose own
    // fall dy(s) carries it here, s + k dy(s) = here. Each point falls by a
    // different amount now, so it is solved, by bisection (the engine keeps
    // the swing short of folding the wire over, so there is one root).
    float k = steep ? 1.0 : g;
    float here = steep ? pp.y : pp.x;
    float span = a.y - a.x;
    float reach = abs(k) * (abs(a.z) + max(a.w, e.x)) + 2.0;
    float lo = here - reach;
    float hi = here + reach;
    for (int it = 0; it < 20; it++) {
      float s = 0.5 * (lo + hi);
      float us = clamp((s - a.x) / span, 0.0, 1.0);
      float ls = b.w > 0.5 ? us : 1.0 - us;
      float h = s + k * (a.z * 4.0 * us * (1.0 - us) + a.w * ls + e.x * (1.0 - ls)) - here;
      if (h > 0.0) hi = s;
      else lo = s;
    }
    float u = clamp((0.5 * (lo + hi) - a.x) / span, 0.0, 1.0);
    float bow = 4.0 * u * (1.0 - u);
    // 0 at the far end, which holds; 1 at this pole, where it was let go
    float lead = b.w > 0.5 ? u : 1.0 - u;
    float dy1 = a.z * bow + a.w * lead + e.x * (1.0 - lead);
    float dy0 = c.x * bow + c.y * lead + e.y * (1.0 - lead);
    // the streak, in rows of drop: the shutter's travel, capped in length
    float slantL = sqrt(1.0 + g * g);
    float path = abs(dy1 - dy0) * slantL;
    float back = (dy1 - dy0) * min(1.0, ${WIRE_STREAK} / max(path, 1e-4));
    float dyB = dy1 - back;
    if (pp.y - min(dyB, dy1) < b.y - 3.0 || pp.y - max(dyB, dy1) > b.z + 3.0) continue;
    int id = int(b.x + 0.5);
    ivec2 bestP;
    float A = wireMatte(vec2(pp.x - g * dy1, pp.y - dy1), id, bestP);
    float bestK = A;
    float n = min(ceil(abs(back) * slantL * 2.0), ${STREAK_SAMPLES}.0);
    for (int t = 1; t <= ${STREAK_SAMPLES}; t++) {
      if (float(t) > n) break;
      float f = float(t) / n;
      float d = dy1 - back * f;
      ivec2 bp;
      float m = wireMatte(vec2(pp.x - g * d, pp.y - d), id, bp);
      float k = m * (1.0 - f) * (1.0 - f * 0.35);
      if (k > A) A = k;
      if (m > bestK) {
        bestK = m;
        bestP = bp;
      }
    }
    if (A <= 0.003 || bestP.x < 0) continue;
    // its ink: the wire unmixed against the plate behind it, at its densest texel
    int srk = ids(bestP).w / 64;
    vec2 bc = vec2(bestP) + 0.5;
    float ba = texelFetch(uAlpha, bestP, 0).r;
    vec3 ink = solidGrade(unmix(plate(0, bc, srk), plate(1, bc, srk), ba));
    col = mix(col, ink, A);
    skyW *= 1.0 - A;
    cloudW *= 1.0 - A;
  }

  // alpha carries the two shares to the optics, packed: 3 bits of sky, 5 of
  // cumulus (read back with texelFetch, never filtered)
  outColor = vec4(col, (floor(clamp(skyW, 0.0, 1.0) * 7.0 + 0.5) * 32.0 + floor(clamp(cloudW, 0.0, 1.0) * 31.0 + 0.5)) / 255.0);
}`;

// The film's own light, before its curve: what the emulsion does with the
// brightest things in the frame. Two keys:
// - the highlights (luminance): the sunlit crowns and the lit face of the
//   shaft. Their light is spread a short way (diffusion) and, through the
//   base, comes back warm (halation: the sun's colour with the blue taken out,
//   a thin ring outside every bright edge, never on the highlight itself). On
//   anything solid (the shaft, the hardware: what is not sky) the key is
//   turned well down, so the concrete's edge takes a thin warm ring and not a
//   white glow.
// - the cumulus's own share (sky.png B, as the comp left it after everything
//   in front) turns its spread light down (uCloudDiff) and its ring partly
//   (uCloudRing): white light spread off the tower's edge onto the cobalt
//   reads as a pale matte fringe, so what is left round it is mostly the
//   ring, and on the open sky both take the sky's own hue (SKY_LIT).
const LIN = `
vec3 toLin(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
float hiKey(vec3 l) {
  return smoothstep(0.42, 0.9, dot(l, vec3(0.2126, 0.7152, 0.0722)));
}
// the comp's packed alpha: x the sky's share, y the cumulus's
vec2 shares(float a) {
  float v = floor(a * 255.0 + 0.5);
  float s = floor(v / 32.0);
  return vec2(s / 7.0, (v - s * 32.0) / 31.0);
}`;

// full res -> half res: the highlights' light (rgb) and their key (a), with
// solid things (not sky) weighed down: uSolid.x their light, .y their ring;
// the cumulus's light spreads only by uCloudDiff, its crowns ring by uCloudRing
const GLOW_KEY = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uSolid;
uniform float uCloudRing;
uniform float uCloudDiff;
${LIN}
void main() {
  ivec2 sz = textureSize(uTex, 0) - 1;
  ivec2 b = ivec2(gl_FragCoord.xy) * 2;
  vec4 acc = vec4(0.0);
  for (int k = 0; k < 4; k++) {
    vec4 t = texelFetch(uTex, min(b + ivec2(k & 1, k >> 1), sz), 0);
    vec3 l = toLin(t.rgb);
    float h = hiKey(l);
    vec2 sh = shares(t.a);
    acc += vec4(l * h * mix(uSolid.x, 1.0, sh.x) * mix(1.0, uCloudDiff, sh.y), h * mix(uSolid.y, 1.0, sh.x) * mix(1.0, uCloudRing, sh.y));
  }
  outColor = acc * 0.25;
}`;

// separable gaussian, sigma ~4 texels (half res: ~8 device px; quarter res:
// ~16), 9 taps paired into bilinear fetches
const GLOW_BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uStep;
void main() {
  vec4 c = texture(uTex, vUv) * 0.1370;
  c += (texture(uTex, vUv + uStep * 1.4612) + texture(uTex, vUv - uStep * 1.4612)) * 0.2399;
  c += (texture(uTex, vUv + uStep * 3.4078) + texture(uTex, vUv - uStep * 3.4078)) * 0.1437;
  c += (texture(uTex, vUv + uStep * 5.3561) + texture(uTex, vUv - uStep * 5.3561)) * 0.0532;
  c += (texture(uTex, vUv + uStep * 7.3077) + texture(uTex, vUv - uStep * 7.3077)) * 0.0121;
  c += (texture(uTex, vUv + uStep * 9.2625) + texture(uTex, vUv - uStep * 9.2625)) * 0.0017;
  outColor = c / 0.9322;
}`;

const GLOW = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform sampler2D uGlow;
uniform vec2 uTexel;
uniform float uDiff;
uniform float uHal;
uniform vec3 uHalC;
uniform float uHalThin;
${LIN}
vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
// how much of the optics' light on the open sky takes the sky's hue
const float SKY_LIT = 0.9;
float lumAt(vec2 uv) {
  return dot(toLin(texture(uTex, uv).rgb), vec3(0.2126, 0.7152, 0.0722));
}
void main() {
  vec4 t = texelFetch(uTex, ivec2(gl_FragCoord.xy), 0);
  vec3 l = toLin(t.rgb);
  vec4 g = texture(uGlow, vUv);
  float self = hiKey(l);
  float y = dot(l, vec3(0.2126, 0.7152, 0.0722));
  // a hairline (a wire across the cloud) is darker than both its sides; an
  // edge only than one. A hairline keeps its darkness: the emulsion under it
  // got no light of its own to scatter back, so it takes no ring.
  float hair = 0.0;
  for (int k = 0; k < 4; k++) {
    float a = float(k) * 0.7853982;
    vec2 o = vec2(cos(a), sin(a)) * 3.0 * uTexel;
    hair = max(hair, min(lumAt(vUv + o), lumAt(vUv - o)) - y);
  }
  float keep = 1.0 - smoothstep(0.04, 0.25, hair);
  vec2 sh = shares(t.a);
  float sx = sh.x;
  // What the optics lay on the open sky round the cumulus (its spread light
  // and its ring) is light in the sky's own air: added as the crowns' white
  // and the sun's orange, it greyed the cobalt beside every crown (orange on
  // blue is grey), a dull slate-navy band between the deep blue and the white
  // that cut the tower out. On the open sky it is laid in the sky's own hue
  // instead (the pixel's colour at unit luminance, at the added light's
  // luminance), so the cobalt brightens into the crown and the edge stays the
  // sky's. Inside the cloud's coverage, and on anything solid, it keeps its
  // own colour.
  float onSky = sx * (1.0 - smoothstep(0.0, 0.6, sh.y)) * SKY_LIT;
  vec3 tone = min(l / max(y, 1e-4), vec3(4.0));
  // diffusion: the highlights' own light, spread; it lands off them, so the
  // billows inside a crown keep their shadows, and hardly at all on the
  // concrete, whose edge against the crowns stays cut (a white veil there
  // reads as a halo round a pasted layer)
  l += mix(g.rgb, tone * dot(g.rgb, vec3(0.2126, 0.7152, 0.0722)), onSky) * uDiff * (1.0 - self) * mix(1.0, keep, 0.6) * mix(0.12, 1.0, sx);
  // halation: the ring outside the bright edge, in the sun's warm colour, on
  // what is darker than the cloud's shade (the cobalt), never filling the
  // cloud's own folds. On the shaft, the hardware and the wires (not sky) the
  // wide ring is gone: what is left is a thin one, a texel or two in from an
  // edge that has the brightest of the sky (the sunlit crowns, nothing less)
  // right beside it, so the dark silhouette stays dark and crisp and carries
  // no second warm accent.
  float wide = max(g.a - self, 0.0) * (1.0 - smoothstep(0.2, 0.5, y)) * keep * sx;
  float thin = 0.0;
  if (sx < 0.99) {
    for (int k = 0; k < 8; k++) {
      float a = float(k) * 0.7853982;
      vec2 d = vec2(cos(a), sin(a)) * uTexel;
      vec4 n1 = texture(uTex, vUv + d * 1.5);
      vec4 n2 = texture(uTex, vUv + d * 2.5);
      float k1 = smoothstep(0.72, 0.93, dot(toLin(n1.rgb), vec3(0.2126, 0.7152, 0.0722))) * shares(n1.a).x;
      float k2 = smoothstep(0.72, 0.93, dot(toLin(n2.rgb), vec3(0.2126, 0.7152, 0.0722))) * shares(n2.a).x;
      thin = max(thin, max(k1, 0.3 * k2));
    }
    thin *= (1.0 - sx) * (1.0 - smoothstep(0.1, 0.35, y));
  }
  l += mix(uHalC, tone * dot(uHalC, vec3(0.2126, 0.7152, 0.0722)), onSky) * wide * uHal + uHalC * thin * uHalThin;
  outColor = vec4(toSrgb(l), 1.0);
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
    u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

function texParams(gl, mips, nearest = false) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function imageTexture(gl, img, nearest = false) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  texParams(gl, false, nearest);
  return t;
}

// The cumulus's light in the air (COMP: cloudAir), built once at half the
// plate's size: its coverage (sky.png B) times its light (cloud.webp), and
// the scan's own cloud over the upper right the same way (its share and
// value off the bare-sky plate, as skyGrade reads them),
// blurred twice: r wide (sigma ~2.5% of the frame's width: the forward
// scatter round the tower; its deepest pocket still a third of its crowns),
// g tight (~0.3%: the emulsion's halation at its rim, keyed on the light
// squared, so the sunlit crowns ring and the dim shaded veil does not, and
// the ring is never brighter than the cloud it comes off). Blurred over a frame
// that is opaque only inside the plate and read back unpremultiplied, so the
// cloud running out of the frame's edges keeps its strength there.
const SCATTER = { w: 1200, h: 800, wide: 30, tight: 4 };
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
function scatterMap(sky, cloud, p0, p3, idsImg) {
  const { w, h } = SCATTER;
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return [c, c.getContext("2d", { willReadFrequently: true })];
  };
  const [src, sx] = mk();
  sx.drawImage(sky, 0, 0, w, h);
  const cov = sx.getImageData(0, 0, w, h).data;
  // the bare sky as COMP's plate(3) reads it: p3 where the ids give the
  // pixel a rank, p0 where they do not (p3 is a grey filler there)
  sx.imageSmoothingEnabled = false;
  sx.drawImage(idsImg, 0, 0, w, h);
  const rank = sx.getImageData(0, 0, w, h).data;
  sx.imageSmoothingEnabled = true;
  sx.drawImage(p0, 0, 0, w, h);
  const own = sx.getImageData(0, 0, w, h).data;
  sx.drawImage(p3, 0, 0, w, h);
  const own3 = sx.getImageData(0, 0, w, h).data;
  for (let i = 0; i < own.length; i += 4) {
    if (rank[i + 2] >= 64) for (let k = 0; k < 3; k++) own[i + k] = own3[i + k];
  }
  sx.drawImage(cloud, 0, 0, w, h);
  const lit = sx.getImageData(0, 0, w, h);
  const d = lit.data;
  for (let i = 0; i < d.length; i += 4) {
    const t = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    const b = cov[i + 2];
    // the scan's own cloud (COMP: skyGrade), off the bare-sky plate: its
    // share read from its saturation in the azure band, its light its value
    const [r, g, bl] = [own[i], own[i + 1], own[i + 2]];
    const mx = Math.max(r, g, bl);
    const c = mx - Math.min(r, g, bl);
    const hue = c === 0 ? 0 : mx === r ? 60 * (((g - bl) / c + 6) % 6) : mx === g ? 60 * ((bl - r) / c + 2) : 60 * ((r - g) / c + 4);
    const band = smooth(168, 184, hue) * (1 - smooth(236, 250, hue));
    const sat = mx > 0 ? c / mx : 0;
    const a = smooth(0.5, 0.95, 1 - band + band * clamp(1 - sat / 0.74, 0, 1));
    const v = mx / 255;
    d[i] = Math.max(b * (0.35 + 0.65 * t), a * 255 * (0.35 + 0.65 * v));
    d[i + 1] = Math.max(b * t * t, a * 255 * v * v);
    d[i + 3] = 255;
  }
  sx.putImageData(lit, 0, 0);
  const out = new ImageData(w, h);
  const o = out.data;
  [SCATTER.wide, SCATTER.tight].forEach((r, ch) => {
    const [, bx] = mk();
    bx.filter = `blur(${r}px)`;
    bx.drawImage(src, 0, 0);
    const b = bx.getImageData(0, 0, w, h).data;
    for (let i = 0; i < b.length; i += 4) o[i + ch] = b[i + ch];
  });
  for (let i = 3; i < o.length; i += 4) o[i] = 255;
  return out;
}

function target(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  texParams(gl, false);
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
const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
const num = (q, k) => {
  const v = q.get(k);
  return v != null && v !== "" && Number.isFinite(+v) ? +v : null;
};

// A wire's state at progress a (0 in place, 1 gone): first the tension goes
// and it bows, then it is let go at this pole and swings down from its far
// end, which holds, its slack deepening as it goes, until its loose end has
// gone out through the bottom of the frame. [sag, fall at this pole, fall at
// the far end (0 unless the far end has to let go too, see fitWires)]
const S0 = 0.32;
const SLACK_GROW = 2.2;
const slackOf = (w) => clamp(0.028 * (w.b - w.from), 8, 64);
function wireShape(w, a) {
  const slackMax = slackOf(w);
  if (a <= S0) {
    const k = a / S0;
    return [slackMax * (1 - (1 - k) * (1 - k)), 0, 0];
  }
  const t = (a - S0) / (1 - S0);
  const slack = slackMax * (1 + (SLACK_GROW - 1) * (1 - (1 - t) * (1 - t)));
  const fall = w.fall * t * t;
  return [slack, fall, Math.max(0, fall - w.hold)];
}

// Each wire's line in the plate, fitted to its own pixels in the id map (R:
// wire id), and from it which end of its span is at this pole (the end nearer
// the pole's axis; the other runs to a neighbouring pole off the frame), and
// how far that end has to fall for the whole wire to have gone out of the
// frame. A wire that cannot swing clear (its far end would leave it hanging
// across the frame, as the bundle running up out of the top would, or the
// swing would carry it over past its far end first) swings as far as it can,
// and then its far end lets go too and follows, so it still drops out.
function fitWires(img, wires, pole) {
  const cv = document.createElement("canvas");
  cv.width = PW;
  cv.height = PH;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const px = cx.getImageData(0, 0, PW, PH).data;
  // per id: n, sum along, sum across, sum along^2, sum along x across
  const acc = new Map(wires.map((w) => [w.id, { steep: w.steep, s: [0, 0, 0, 0, 0] }]));
  for (let y = 0, i = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++, i += 4) {
      const id = px[i];
      if (!id) continue;
      const e = acc.get(id);
      if (!e) continue;
      const al = e.steep ? y : x;
      const ac = e.steep ? x : y;
      const s = e.s;
      s[0]++;
      s[1] += al;
      s[2] += ac;
      s[3] += al * al;
      s[4] += al * ac;
    }
  }
  const M = 6;
  const inFrame = (p) => p[0] >= 0 && p[0] < PW && p[1] >= 0 && p[1] < PH;
  for (const w of wires) {
    // the span's own line: the bake's fit to the span without its tail (grip,
    // connector, leads), else the fit to every pixel of it in the id map
    const [n, sa, sc, saa, sac] = acc.get(w.id).s;
    const den = n * saa - sa * sa;
    let m = n > 1 && Math.abs(den) > 1e-6 ? (n * sac - sa * sc) / den : 0;
    let q = n > 0 ? (sc - m * sa) / n : 0;
    if (w.fit) [m, q] = w.fit;
    const span = w.b - w.from;
    const at = (u) => {
      const al = w.from + u * span;
      const ac = m * al + q;
      return w.steep ? [ac, al] : [al, ac];
    };
    const off = (p) => Math.abs(p[0] - (pole.k * p[1] + pole.c));
    w.pe = off(at(1)) < off(at(0)) ? 1 : 0;
    const k = w.steep ? 1 : w.g;
    const slack = slackOf(w) * SLACK_GROW;
    const N = 240;
    // where every point of the wire in the frame is with this pole's end
    // fallen fp and the far end ff; gone: none of it is left in the frame;
    // folded: some stretch of it has been carried past its neighbour along the
    // span (the swing has overshot the far end)
    const test = (fp, ff) => {
      let gone = true;
      let folded = false;
      let prev = null;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const lead = w.pe ? u : 1 - u;
        const d = slack * 4 * u * (1 - u) + fp * lead + ff * (1 - lead);
        const along = w.from + u * span + k * d;
        const p0 = at(u);
        if (!inFrame(p0)) {
          prev = null;
          continue;
        }
        if (prev != null && along - prev < 0.15 * (span / N)) folded = true;
        prev = along;
        const x = p0[0] + w.g * d;
        const y = p0[1] + d;
        if (x > -M && x < PW + M && y > -M && y < PH + M) gone = false;
      }
      return { gone, folded };
    };
    // a swing that only clears the frame by stretching the wire far past the
    // drop to the bottom edge is no swing: the far end lets go too
    const toBottom = PH - at(w.pe)[1] + 80;
    let fold = Infinity;
    w.hold = Infinity;
    w.fall = 0;
    for (let f = 0; f <= 1.75 * toBottom; f += 10) {
      const r = test(f, 0);
      if (r.folded) {
        fold = f;
        break;
      }
      if (r.gone) {
        w.fall = f + 80 + (w.rise || 0);
        break;
      }
    }
    if (!w.fall) {
      // swing as far as it can, then the far end follows, keeping the swing
      w.hold = Math.min(0.85 * fold, toBottom);
      let f = 0;
      while (f < 8000 && !test(f, Math.max(0, f - w.hold)).gone) f += 10;
      w.fall = f + 80 + (w.rise || 0);
    }
  }
}

export async function createDenchuka(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const yearQ = num(q, "year");
  const held = yearQ != null;
  const still = held || q.get("still") === "1";
  const raw = q.get("film") === "0";
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");

  const [els, ...imgs] = await Promise.all([
    fetch(BASE + "elements.json").then((r) => r.json()),
    ...["p0.webp", "p1.webp", "p2.webp", "p3.webp", "ids.png", "alpha.png", "sky.png", "cloud.webp", "solid.png"].map((f) =>
      loadImage(BASE + f),
    ),
  ]);
  const plates = imgs.slice(0, 4).map((im) => imageTexture(gl, im));
  const idsTex = imageTexture(gl, imgs[4], true);
  const alphaTex = imageTexture(gl, imgs[5], true);
  const skyTex = imageTexture(gl, imgs[6]);
  const cloudTex = imageTexture(gl, imgs[7]);
  const solidTex = imageTexture(gl, imgs[8]);
  const scatterTex = imageTexture(gl, scatterMap(imgs[6], imgs[7], imgs[0], imgs[3], imgs[4]));

  // Element table.
  // a is the element's progress here, so the span's start is kept as from
  const wires = els.wires.map((w) => ({ ...w, from: w.a, a: 0, prev: 0, kind: "wire" }));
  fitWires(imgs[4], wires, els.poles[0]);
  const hardware = els.hardware.map((h) => ({ ...h, a: 0, prev: 0 }));
  const poles = els.poles.map((p) => ({ ...p, a: 0, prev: 0 }));

  // State texture: rows wires / hardware / poles, 1 = in place.
  const SW = 256;
  const stateData = new Uint8Array(SW * 3 * 4);
  const stateTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, stateTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, SW, 3, 0, gl.RGBA, gl.UNSIGNED_BYTE, stateData);
  texParams(gl, false, true);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const P = {
    comp: program(gl, VERT, COMP),
    blit: program(gl, VERT, BLIT),
    key: program(gl, VERT, GLOW_KEY),
    blur: program(gl, VERT, GLOW_BLUR),
    glow: program(gl, VERT, GLOW),
  };
  const film = createFilm(gl, { width: 2, height: 2 });

  const L = { x: 0, y: 0, w: 1, h: 1 };
  const T = { scene: null, film: null, optic: null, g0: null, g1: null };
  let dirty = true;
  const layout = (W, H, dpr) => {
    const ar = PW / PH;
    if (embedded) {
      Object.assign(L, { x: 0, y: 0, w: W, h: H });
    } else if (W / H < 0.9) {
      const side = Math.max(16, Math.round(W * 0.06));
      const w = W - side * 2;
      Object.assign(L, { w, h: w / ar, x: side, y: (H - w / ar) / 2 - 12 });
    } else {
      const side = Math.max(24, W * 0.07);
      const w = Math.min(W - side * 2, H * 0.78 * ar);
      Object.assign(L, { w, h: w / ar, x: (W - w) / 2, y: (H - w / ar) / 2 - 12 });
    }
    L.x = Math.round(L.x * dpr) / dpr;
    L.y = Math.round(L.y * dpr) / dpr;
    L.pw = Math.max(2, Math.round(L.w * dpr));
    L.ph = Math.max(2, Math.round(L.h * dpr));
    Object.values(T).forEach((t) => freeTarget(gl, t));
    T.scene = target(gl, L.pw, L.ph);
    T.film = target(gl, L.pw, L.ph);
    T.optic = target(gl, L.pw, L.ph);
    T.g0 = target(gl, Math.max(2, Math.ceil(L.pw / 2)), Math.max(2, Math.ceil(L.ph / 2)));
    T.g1 = target(gl, T.g0.w, T.g0.h);
    film.resize(L.pw, L.ph);
    dirty = true;
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  const bindTex = (unit, tex, loc) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  };

  // The years: the drag sets a goal; what you see follows on a spring.
  let goal = held ? clamp(yearQ, 0, 1) : 0;
  let year = goal;
  let yearV = 0;
  let goalV = 0;
  let dragging = false;
  let dragX = 0;
  let dragGoal = 0;
  let touched = held;
  let seed = 0;

  const inPrint = (p) => p.x >= L.x && p.x <= L.x + L.w && p.y >= L.y && p.y <= L.y + L.h;
  stage.on("down", (p) => {
    if (!inPrint(p)) return;
    dragging = true;
    touched = true;
    dragX = p.x;
    dragGoal = goal;
    goalV = 0;
    host.dataset.dragging = "";
  });
  stage.on("move", (p) => {
    if (!dragging) return;
    let g = dragGoal + (p.x - dragX) / L.w;
    const band = (o) => 0.06 * (1 - Math.exp((-0.4 * o) / 0.06));
    if (g < 0) g = -band(-g);
    if (g > 1) g = 1 + band(g - 1);
    goal = g;
  });
  stage.on("up", (p) => {
    if (!dragging) return;
    dragging = false;
    delete host.dataset.dragging;
    goalV = clamp(p.vx / L.w, -2.5, 2.5);
  });
  host.tabIndex = embedded ? -1 : 0;
  const onKey = (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    touched = true;
    goal = clamp(goal + d * (e.shiftKey ? 0.1 : 0.025), 0, 1);
  };
  host.addEventListener("keydown", onKey);

  // Each element runs its own clock toward where the year says it should be.
  const step = (dt) => {
    let moving = false;
    const adv = (cur, target, dur) => {
      if (still) return target;
      if (reduce) return target >= 0.5 ? 1 : 0;
      const d = dt / dur;
      return target > cur ? Math.min(target, cur + d) : Math.max(target, cur - d);
    };
    const span = (y0, sp) => clamp((year - y0) / sp, 0, 1);
    for (const w of wires) {
      w.prev = w.a;
      const target = still ? span(w.year, STILL_SPAN.wire) : year >= w.year ? 1 : 0;
      w.a = adv(w.a, target, DUR.wire);
      if (w.a !== w.prev) moving = true;
    }
    for (const h of hardware) {
      h.prev = h.a;
      const target = still ? span(h.year, STILL_SPAN.hw) : year >= h.year ? 1 : 0;
      h.a = adv(h.a, target, DUR.hw);
      if (h.a !== h.prev) moving = true;
    }
    for (const p of poles) {
      p.prev = p.a;
      const target = still ? span(p.year, STILL_SPAN.pole) : year >= p.year ? 1 : 0;
      p.a = adv(p.a, target, DUR.pole);
      if (p.a !== p.prev) moving = true;
    }
    return moving;
  };

  const uW = new Float32Array(MAX_W * 4);
  const uW2 = new Float32Array(MAX_W * 4);
  const uW3 = new Float32Array(MAX_W * 4);
  const uW4 = new Float32Array(MAX_W * 4);
  const uPo = new Float32Array(MAX_P * 4);
  const uPo2 = new Float32Array(MAX_P * 4);
  const uHw = new Float32Array(MAX_P * 4);
  const uHw2 = new Float32Array(MAX_P * 4);

  const draw = (expoStops, fade) => {
    // state rows
    stateData.fill(0);
    for (const w of wires) if (w.a <= 0) stateData[w.id * 4] = 255;
    for (const h of hardware) if (h.a <= 0) stateData[(SW + h.id) * 4] = 255;
    for (const p of poles) if (p.a <= 0) stateData[(2 * SW + p.id) * 4] = 255;
    gl.bindTexture(gl.TEXTURE_2D, stateTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SW, 3, gl.RGBA, gl.UNSIGNED_BYTE, stateData);

    let nw = 0;
    for (const w of wires) {
      if (w.a <= 0 || w.a >= 1 || nw >= MAX_W) continue;
      const [s1, f1, q1] = wireShape(w, w.a);
      // where it was when the shutter opened: half a 24 fps frame back along
      // the way it is going (the still is always going forward)
      const dir = still ? 1 : Math.sign(w.a - w.prev);
      const back = clamp(w.a - dir * SHUTTER * (FRAME / DUR.wire), 0, 1);
      const [s0, f0, q0] = wireShape(w, back);
      uW.set([w.from, w.b, s1, f1], nw * 4);
      uW2.set([w.id, w.y0, w.y1, w.pe], nw * 4);
      uW3.set([s0, f0, w.g, w.steep ? 1 : 0], nw * 4);
      uW4.set([q1, q0, 0, 0], nw * 4);
      nw++;
    }
    let np = 0;
    let nh = 0;
    // down the axis until the top has gone under the bottom edge
    // (standing, at no offset: its rebuilt top takes the same surface as it
    // will going down, wherever the hardware no longer hides it)
    const bare = clamp((Math.min(...hardware.map((h) => h.a)) - 0.5) / 0.5, 0, 1);
    for (const p of poles) {
      if (p.a >= 1 || np >= MAX_P) continue;
      const travel = (p.base - p.top + 6) * Math.hypot(p.k, 1);
      uPo.set([p.id, p.k, p.c, easeInOut(p.a) * travel], np * 4);
      uPo2.set([p.top, p.base, p.reach, bare], np * 4);
      np++;
    }
    for (const h of hardware) {
      if (h.a <= 0 || h.a >= 1 || nh >= MAX_P) continue;
      const travel = (h.base - h.top + 6) * Math.hypot(h.k, 1);
      uHw.set([h.id, h.k, h.c, easeInOut(h.a) * travel], nh * 4);
      uHw2.set([h.top, h.base, h.reach, h.bottom], nh * 4);
      nh++;
    }

    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.DEPTH_TEST);
    const u = P.comp.u;
    gl.useProgram(P.comp.p);
    plates.forEach((t, i) => bindTex(i, t, u[`uP${i}`]));
    bindTex(4, idsTex, u.uIds);
    bindTex(5, alphaTex, u.uAlpha);
    bindTex(6, stateTex, u.uState);
    bindTex(7, skyTex, u.uSky);
    bindTex(8, cloudTex, u.uCloud);
    bindTex(9, solidTex, u.uClean);
    bindTex(10, scatterTex, u.uScatter);
    gl.uniform2f(u.uPlate, PW, PH);
    gl.uniform1i(u.uNW, nw);
    gl.uniform4fv(u.uW, uW);
    gl.uniform4fv(u.uW2, uW2);
    gl.uniform4fv(u.uW3, uW3);
    gl.uniform4fv(u.uW4, uW4);
    gl.uniform1i(u.uNP, np);
    gl.uniform4fv(u.uPo, uPo);
    gl.uniform4fv(u.uPo2, uPo2);
    gl.uniform1i(u.uNH, nh);
    gl.uniform4fv(u.uHw, uHw);
    gl.uniform4fv(u.uHw2, uHw2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene.fbo);
    gl.viewport(0, 0, T.scene.w, T.scene.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!raw) {
      // the emulsion's light: highlight key, a short blur, diffusion + halation
      const pass = (prog, out) => {
        gl.useProgram(prog.p);
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
        gl.viewport(0, 0, out.w, out.h);
      };
      pass(P.key, T.g0);
      bindTex(0, T.scene.tex, P.key.u.uTex);
      gl.uniform2fv(P.key.u.uSolid, OPTIC.solid);
      gl.uniform1f(P.key.u.uCloudRing, OPTIC.cloudRing);
      gl.uniform1f(P.key.u.uCloudDiff, OPTIC.cloudDiff);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      pass(P.blur, T.g1);
      bindTex(0, T.g0.tex, P.blur.u.uTex);
      gl.uniform2f(P.blur.u.uStep, 1 / T.g0.w, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      pass(P.blur, T.g0);
      bindTex(0, T.g1.tex, P.blur.u.uTex);
      gl.uniform2f(P.blur.u.uStep, 0, 1 / T.g0.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      pass(P.glow, T.optic);
      bindTex(0, T.scene.tex, P.glow.u.uTex);
      bindTex(1, T.g0.tex, P.glow.u.uGlow);
      gl.uniform2f(P.glow.u.uTexel, 1 / T.scene.w, 1 / T.scene.h);
      gl.uniform1f(P.glow.u.uDiff, OPTIC.diffusion);
      gl.uniform1f(P.glow.u.uHal, OPTIC.halation);
      gl.uniform3fv(P.glow.u.uHalC, OPTIC.halationColor);
      gl.uniform1f(P.glow.u.uHalThin, OPTIC.halationThin);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      film.render(
        T.optic.tex,
        {
          ...FILM_PRESETS.summer,
          // The scan already carries its grade; the film adds the optics.
          exposure: expoStops,
          contrast: 1.14,
          toe: 0.0,
          saturation: 1.1,
          blueDepth: 0.45,
          shadowTint: [0.97, 1, 1.03],
          highlightTint: [1, 1, 1],
          vignette: 0.22,
          // Diffusion keyed on luminance: only the light past the threshold
          // (the sunlit crowns, the lit face of the shaft) leaves its pixel
          // and veils, so the cobalt keeps its own drawing.
          bloom: 0.07,
          bloomThreshold: 0.6,
          // Halation from the same highlights, warm rather than red: the sun's
          // own colour come back through the red and green layers. The film's
          // is wide (1-3% of the frame), so it is kept to a trace off the very
          // brightest crowns: anything more lays a thick orange bloom over the
          // dark hardware in front of them and warms the shaft's edge, a second
          // warm accent on what should be the frame's one cool dark anchor.
          // The ring that shows is the optics' own (GLOW): off the cumulus
          // into the cobalt in the sky's hue, a warm texel or two on the concrete.
          halation: 0.06,
          halationThreshold: 0.92,
          halationColor: [1, 0.52, 0.24],
          // the crowns (~0.95 linear in the scene) land at ~250-252
          whitePoint: 1.0,
          grainSeed: seed,
        },
        T.film.fbo,
      );
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
    bindTex(0, raw ? T.scene.tex : T.film.tex, P.blit.u.uTex);
    gl.uniform1f(P.blit.u.uFade, fade);
    gl.uniform3fv(P.blit.u.uPaper, PAPER);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // Reveal: the print comes up over-exposed, a white-blue summer glare, and
  // settles; then, untouched, the first years run on by themselves and the
  // lowest wires come down, to show the street can be scrubbed.
  const REVEAL = 2.0;
  const WALK_AT = 2.2;
  const WALK = 3.2;
  const WALK_TO = 0.13;
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
        expo = 1.6 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
    }

    if (!held && !touched) {
      const k = reduce ? 0 : easeInOut(clamp((age - WALK_AT) / WALK, 0, 1));
      goal = WALK_TO * k;
    } else if (!held && !dragging) {
      if (Math.abs(goalV) > 1e-4) {
        goal += goalV * dt;
        goalV *= Math.exp(-dt / 0.22);
      }
      if (goal < 0) goal += (0 - goal) * (1 - Math.exp(-dt * 14));
      if (goal > 1) goal += (1 - goal) * (1 - Math.exp(-dt * 14));
    }
    let springing = false;
    if (held) year = goal;
    else {
      // spring, damping ratio 0.86
      const w = 11;
      const z = 0.86;
      const n = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const a = w * w * (goal - year) - 2 * z * w * yearV;
        yearV += a * h;
        year += yearV * h;
      }
      springing = Math.abs(goal - year) > 1e-4 || Math.abs(yearV) > 1e-4;
      if (!springing) {
        year = goal;
        yearV = 0;
      }
    }
    const moving = step(dt);

    let tick = false;
    if (!reduce && !still) {
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
      [...plates, idsTex, alphaTex, skyTex, cloudTex, solidTex, scatterTex, stateTex].forEach((t) => gl.deleteTexture(t));
      Object.values(P).forEach((p) => gl.deleteProgram(p.p));
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
