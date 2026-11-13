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
// diffusion and a warm halation ring keyed on luminance (GLOW), so the crowns
// and the sunlit shaft bleed into the cobalt beside them, then its curve.
//
// Behind the pole, rising from the lower right behind the shaft, stands a
// real towering cumulus (cloud.py: Poly Haven's Skidpan HDRI, CC0, placed
// under this camera so its verticals converge with the pole's), laid into the
// same regrade through the same matte (sky.png B its coverage, cloud.webp its
// colour): its sunlit tops warm-neutral and rolled off below white, its shade
// the skylight's blue, deepening up the sky with the cobalt. Each removal
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
const OPTIC = { diffusion: 0.2, halation: 0.75, halationColor: [1, 0.6, 0.3] };

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
uniform highp sampler2D uState;   // x: id, row 0 wires / 1 hardware / 2 poles: 1 = in place
uniform vec2 uPlate;
uniform int uNW;
uniform vec4 uW[${MAX_W}];        // span start, end (x, or y for a steep wire), sag, fall
uniform vec4 uW2[${MAX_W}];       // id, y0, y1, this pole's end (1: at the span's end, 0: its start)
uniform vec4 uW3[${MAX_W}];       // sag, fall when the shutter opened; fall slant dx/dy; steep
uniform vec4 uW4[${MAX_W}];       // the far end's fall, now and when the shutter opened
uniform int uNP;
uniform vec4 uPo[${MAX_P}];       // id, k, c, offset
uniform vec4 uPo2[${MAX_P}];      // top, base, reach from the axis, 0
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
// The scan's sky is a pale cyan-azure (hue ~206, value ~0.8) and flat from the
// bottom of the frame to the top. A summer sky is cobalt and deepens toward the
// zenith: the clear blue is turned to ~210 and, going up the sky (zen: 0 at 30
// degrees elevation, 1 at 85), toward ~216 and gains saturation and loses
// value. The cloud is lit from high right: its shadow sides take the blue of
// the sky that lights them, its sunlit tops go warm-neutral.
vec3 skyGrade(vec3 c, float zen) {
  vec3 h = rgb2hsv(c);
  float deg = h.x * 360.0;
  // clear sky: the azure band, turned
  float band = smoothstep(168.0, 184.0, deg) * (1.0 - smoothstep(236.0, 250.0, deg));
  float blue = smoothstep(0.12, 0.34, h.y) * band;
  float hue = mix(deg, 209.0 + (deg - 206.0) * 0.5 + 5.0 * zen, band);
  float sat = clamp(h.y * mix(0.96, 1.08, zen), 0.0, 0.9);
  float val = h.z * mix(1.0, 0.86, zen);
  vec3 sky = hsv2rgb(vec3(hue / 360.0, sat, val));
  // cloud: more range; shade sides to skylight blue, sunlit tops to warm white
  float v = clamp(0.86 + (h.z - 0.86) * 1.5, 0.0, 1.0);
  float shade = smoothstep(0.94, 0.76, h.z);
  float top = smoothstep(0.88, 0.97, h.z);
  vec3 shadeC = hsv2rgb(vec3(213.0 / 360.0, 0.1 + 0.14 * shade, v * mix(1.0, 0.94, shade)));
  vec3 sunC = hsv2rgb(vec3(36.0 / 360.0, 0.08, v));
  vec3 cloud = mix(shadeC, sunC, top);
  return mix(cloud, sky, blue);
}
// The towering cumulus (cloud.py: a photographed tower, unclipped, placed
// under this camera) graded into the same light, so it glows: its sunlit
// crowns lit by the sun's own warm neutral and lifted to just under white
// (the film's shoulder lands them at ~250-252, never clipped); its body, in its own shade, lit only by
// the sky, takes the skylight's blue (~205, s ~0.35, ~0.6 of the crowns'
// value), a little deeper and bluer the higher up the sky it is (the cobalt
// ramp, zen). Value comes from the bake, so the billows carry through.
vec3 toLin(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
// The sun on the crowns: the same sun as the concrete, so their lit faces are
// its colour (#fff6ea, a warm neutral) at ~0.95 linear, reached through a soft
// shoulder from the bake's own value, so every billow keeps its drawing and
// none of it clips; the film's shoulder then lands them at ~250-252.
const vec3 SUN = vec3(1.0, 0.922, 0.823);
vec3 cloudGrade(vec3 c, float zen) {
  float v = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float top = smoothstep(0.75, 0.96, v);
  float shade = 1.0 - smoothstep(0.5, 0.86, v);
  float val = min(v * mix(1.03, mix(1.1, 1.05, zen), shade), 1.0);
  vec3 shadeC = hsv2rgb(vec3((205.0 + 4.0 * zen) / 360.0, mix(0.07, mix(0.33, 0.38, zen), shade), val));
  // linear light through a shoulder that runs out at 0.95: lifts the crowns,
  // leaves the lit flanks below them their gradation
  float vl = toLin(vec3(v)).x * 1.04;
  float lit = vl < 0.84 ? vl : 0.84 + 0.11 * (1.0 - exp(-(vl - 0.84) / 0.11));
  vec3 sunC = toSrgb(SUN * lit);
  return mix(shadeC, sunC, top);
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
// the object alone: photo = a * object + (1 - a) * behind
vec3 unmix(vec3 withIt, vec3 behind, float a) {
  return clamp((withIt - (1.0 - a) * behind) / max(a, 0.2), 0.0, 1.0);
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
  // how much of what stands in front of the sky is still there
  vec3 al0 = texelFetch(uAlpha, ip, 0).rgb;
  float cov = 0.0;
  if (e.x > 0 && s == 0) cov = max(cov, al0.r);
  if (e.y > 0 && rest(1, e.y)) cov = max(cov, al0.g);
  if (e.z > 0 && rest(2, e.z)) cov = max(cov, al0.b);
  // The sky is regraded under whatever still stands in front of it, not
  // through it: a standing piece's rim is a mix of it and the scan's teal sky
  // (photo = a x object + (1 - a) x sky), so only the sky's share is moved,
  // by the grade of the sky behind everything (p3). Grading the mixed rim
  // pixel itself leaves the teal in it: a green outline round every shaft.
  // The cumulus stands in that same sky, behind everything: wherever the sky
  // shows, the cloud is laid over the regraded sky at its own coverage (b).
  vec3 sk = texture(uSky, pp / uPlate).rgb;
  float skyA = sk.r * (1.0 - cov);
  if (skyA > 0.002) {
    vec3 behind = plate(3, pp, rk);
    vec3 graded = skyGrade(behind, sk.g);
    if (sk.b > 0.002) graded = mix(graded, cloudGrade(texture(uCloud, pp / uPlate).rgb, sk.g), sk.b);
    col = clamp(col + skyA * (graded - behind), 0.0, 1.0);
  }

  // poles going down their own axes, into the ground
  for (int j = 0; j < ${MAX_P}; j++) {
    if (j >= uNP) break;
    vec4 a = uPo[j];
    vec4 b = uPo2[j];
    float ax = a.y * pp.y + a.z;
    if (abs(pp.x - ax) > b.z || pp.y > b.y) continue;
    vec2 dir = normalize(vec2(a.y, 1.0));
    vec2 src = pp - dir * a.w;
    if (src.y < b.x - 2.0) continue;
    ivec4 se = ids(ivec2(floor(src)));
    if (se.z != int(a.x + 0.5)) continue;
    float al = texelFetch(uAlpha, ivec2(floor(src)), 0).b;
    int srk = se.w / 64;
    vec3 obj = unmix(plate(2, src, srk), plate(3, src, srk), al);
    col = mix(col, obj, al);
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
    float al = texelFetch(uAlpha, ivec2(floor(src)), 0).g;
    int srk = se.w / 64;
    vec3 obj = unmix(plate(1, src, srk), plate(2, src, srk), al);
    col = mix(col, obj, al);
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
    vec3 ink = unmix(plate(0, bc, srk), plate(1, bc, srk), ba);
    col = mix(col, ink, A);
  }

  outColor = vec4(col, 1.0);
}`;

// The film's own light, before its curve: what the emulsion does with the
// brightest things in the frame. Keyed on luminance, so only the sunlit crowns
// and the lit face of the shaft take part. Their light is spread a short way
// (diffusion: a thin veil of their own colour over their edges) and, through
// the base, comes back warm (halation: the sun's colour with the blue taken
// out, a thin ring outside every bright edge, never on the highlight itself).
// Both bleed into the cobalt beside them, the way the cloud and the concrete
// would on the negative, so the two read as lit by one sun.
const LIN = `
vec3 toLin(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
float hiKey(vec3 l) {
  return smoothstep(0.42, 0.9, dot(l, vec3(0.2126, 0.7152, 0.0722)));
}`;

// full res -> half res: the highlights' light (rgb) and their key (a)
const GLOW_KEY = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uTexel;
${LIN}
void main() {
  vec4 acc = vec4(0.0);
  for (int k = 0; k < 4; k++) {
    vec2 o = (vec2(k & 1, k >> 1) - 0.5) * uTexel;
    vec3 l = toLin(texture(uTex, vUv + o).rgb);
    float h = hiKey(l);
    acc += vec4(l * h, h);
  }
  outColor = acc * 0.25;
}`;

// separable gaussian at half res, sigma ~4 texels (~8 device px), 9 taps
// paired into bilinear fetches
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
${LIN}
vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
float lumAt(vec2 uv) {
  return dot(toLin(texture(uTex, uv).rgb), vec3(0.2126, 0.7152, 0.0722));
}
void main() {
  vec3 l = toLin(texture(uTex, vUv).rgb);
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
  // diffusion: the highlights' own light, spread; it lands off them, so the
  // billows inside a crown keep their shadows
  l += g.rgb * uDiff * (1.0 - self) * mix(1.0, keep, 0.6);
  // halation: the ring outside the bright edge, in the sun's warm colour, on
  // what is darker than the cloud's shade (the cobalt, the hardware), never
  // filling the cloud's own folds
  float ring = max(g.a - self, 0.0) * (1.0 - smoothstep(0.2, 0.5, y)) * keep;
  l += uHalC * ring * uHal;
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
    ...["p0.webp", "p1.webp", "p2.webp", "p3.webp", "ids.png", "alpha.png", "sky.png", "cloud.webp"].map((f) =>
      loadImage(BASE + f),
    ),
  ]);
  const plates = imgs.slice(0, 4).map((im) => imageTexture(gl, im));
  const idsTex = imageTexture(gl, imgs[4], true);
  const alphaTex = imageTexture(gl, imgs[5], true);
  const skyTex = imageTexture(gl, imgs[6]);
  const cloudTex = imageTexture(gl, imgs[7]);

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
    for (const p of poles) {
      if (p.a <= 0 || p.a >= 1 || np >= MAX_P) continue;
      const travel = (p.base - p.top + 6) * Math.hypot(p.k, 1);
      uPo.set([p.id, p.k, p.c, easeInOut(p.a) * travel], np * 4);
      uPo2.set([p.top, p.base, p.reach, 0], np * 4);
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
      gl.uniform2f(P.key.u.uTexel, 1 / T.scene.w, 1 / T.scene.h);
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
          bloom: 0.14,
          bloomThreshold: 0.6,
          // Halation from the same highlights, warm rather than red: the sun's
          // own colour come back through the red and green layers, a thin
          // ring bleeding off the cloud's edge and the shaft into the blue.
          halation: 0.3,
          halationThreshold: 0.8,
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
      [...plates, idsTex, alphaTex, skyTex, cloudTex, stateTex].forEach((t) => gl.deleteTexture(t));
      Object.values(P).forEach((p) => gl.deleteProgram(p.p));
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
