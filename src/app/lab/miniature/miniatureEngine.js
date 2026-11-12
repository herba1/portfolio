import { createStage, clamp } from "../_kit/stage";

// Miniature: Piazza del Popolo seen from the Pincio terrace on a clear
// morning, with its depth map, as a print on the warm ground. Looking down
// from forty metres at people the size of rice grains is what lets a wrong
// depth of field read as a model. The pointer is the plane of focus. Depth is relative
// inverse depth (white = near), and the circle of confusion of a thin lens is
// proportional to the gap in inverse depth, so |d - focus| is the physically
// right blur measure. The plane is reverse-tilted a little, so blur grows
// faster up and down the frame than any lens at this scale would allow: the
// tilt-shift miniature.
//
//   once    the depth map refined against the photograph's luminance with a
//           guided filter at the photograph's resolution, so a depth edge
//           sits on the silhouette the photograph draws, not a pixel or two
//           off it.
//   pass 1  near CoC at half CSS resolution, max-dilated by its own radius:
//           every buffer pixel learns the largest foreground disc that
//           reaches it (Jimenez's near field, as in the tuxedolabs bokeh).
//   pass 2  gather at half CSS resolution, two layers at once. Background:
//           golden-spiral scatter-as-gather of everything at or behind the
//           plane, occlusion-aware (a farther sample may not spread over a
//           nearer, sharper centre). Foreground: only samples nearer than the
//           plane, each spread over its own disc, written premultiplied with
//           its coverage as alpha, so a blurred pine has a soft rim.
//   pass 3  full resolution: a small disc for near-focus pixels, the
//           background buffer through a depth-aware joint upsample for the
//           rest, the foreground layer composited over it with no depth test
//           (it spills over whatever is behind it by its full CoC). Before
//           the foreground goes over, a depth-masked summer film sky grade
//           (deep blue at the top to an open haze line, real clouds kept and
//           toned), with a sharp silhouette's edge pixels unmixed into their
//           pine and their sky so only the sky share is graded; then a gentle contrast lift, a print toe that lifts black
//           to 40/255, a thin amber halation ring round the brightest stone
//           and a print shoulder that stops short of white.

const COLOR_SRC = "/lab/miniature/city.webp";
const DEPTH_SRC = "/lab/miniature/depth.png";
const ASPECT = 3 / 2; // print width / height
const GROUND = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];

const K_COC = 0.26; // circle of confusion, in print heights per unit of inverse depth
const DOF = 0.06; // inverse depth either side of the plane that still reads as sharp
const MAX_COC = 0.03; // cap, in print heights
const TILT = 0.16; // reverse tilt of the focal plane, inverse depth per print height
const BUF_SCALE = 0.5; // gather buffer pixels per CSS pixel
const TAPS = 88;
const NEAR_TAPS = 48;
const SNAP = 0.02; // near-field silhouette search, in print heights
const SNAP_TAPS = 16;
const DILATE_TAPS = 40;

// The depth map is baked so the piazza's middle distance sits at 0.76
// (tools/depth/bakes/miniature/bake.py): the obelisk and the crowd round it.
const HERO = { f: 0.76, y: 0.6 };

const FAR = { f: 0.634, y: 0.3 }; // St Peter's dome on the horizon

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  // Row 0 of every texture is the top of the photograph.
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMMON = `
uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform float uFocus;
uniform float uFocusY;
uniform float uTilt;
uniform float uK;     // coc per unit inverse depth, in output units
uniform float uMax;   // coc cap, in output units
uniform float uDof;
float planeAt(vec2 uv) {
  return uFocus - uTilt * (uv.y - uFocusY);
}
float cocAt(vec2 uv, out float d) {
  d = texture(uDepth, uv).r;
  return min(max(abs(d - planeAt(uv)) - uDof, 0.0) * uK, uMax);
}
// Circle of confusion of the near field only: zero for anything at or behind
// the plane (white = near, so nearer means larger d).
float nearCoc(vec2 uv, float d) {
  return min(max(d - planeAt(uv) - uDof, 0.0) * uK, uMax);
}
// Print white: everything above the knee rolls off towards 0.95 and never
// reaches it, so a bright roof or a windscreen keeps its texture as it opens
// into a disc instead of turning to flat paper.
vec3 shoulder(vec3 x) {
  const float k = 0.85;
  const float top = 0.95;
  vec3 over = max(x - k, 0.0);
  return min(x, vec3(k)) + (top - k) * (1.0 - exp(-over / (top - k)));
}
`;

// Depth refine, once at load: a guided filter (He, Sun and Tang) of the depth
// map against the photograph's luminance, at the photograph's resolution.
// Depth Anything draws a pine's top at half the photo's resolution and a
// pixel or two off; inside each 7 x 7 window the filter refits depth as a
// linear function of luminance, so where the window holds both pine and sky
// the depth edge is moved onto the luminance edge, and a pixel on the
// silhouette that is a quarter sky gets a quarter of the way to sky depth.
// Flat windows keep the map as it was. Pass one fits (a, b) per window and
// keeps the window's depth range; pass two averages the fits that cover each
// pixel and clamps to that range, so the refit never overshoots.
const REFINE_R = 3; // window radius, photograph pixels
const REFINE_FIT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outFit;
uniform sampler2D uColor;
uniform sampler2D uRaw;
uniform vec2 uSize;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  float mI = 0.0, mp = 0.0, mII = 0.0, mIp = 0.0;
  float lo = 1.0, hi = 0.0;
  for (int j = -${REFINE_R}; j <= ${REFINE_R}; j++) {
    for (int i = -${REFINE_R}; i <= ${REFINE_R}; i++) {
      vec2 uv = vUv + vec2(float(i), float(j)) / uSize;
      float I = luma(textureLod(uColor, uv, 0.0).rgb);
      float p = textureLod(uRaw, uv, 0.0).r;
      mI += I;
      mp += p;
      mII += I * I;
      mIp += I * p;
      lo = min(lo, p);
      hi = max(hi, p);
    }
  }
  const float n = float((2 * ${REFINE_R} + 1) * (2 * ${REFINE_R} + 1));
  mI /= n;
  mp /= n;
  // eps: needle texture inside the canopy (luminance variance about 0.003)
  // must not print into depth; the pine against the sky (0.02 and up) must.
  float a = (mIp / n - mI * mp) / (mII / n - mI * mI + 0.002);
  outFit = vec4(a, mp - a * mI, lo, hi);
}`;
const REFINE_APPLY = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outDepth;
uniform sampler2D uColor;
uniform sampler2D uFit;
uniform vec2 uSize;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  ivec2 top = ivec2(uSize) - 1;
  vec2 ab = vec2(0.0);
  for (int j = -${REFINE_R}; j <= ${REFINE_R}; j++) {
    for (int i = -${REFINE_R}; i <= ${REFINE_R}; i++) {
      ab += texelFetch(uFit, clamp(c + ivec2(i, j), ivec2(0), top), 0).rg;
    }
  }
  ab /= float((2 * ${REFINE_R} + 1) * (2 * ${REFINE_R} + 1));
  vec4 own = texelFetch(uFit, c, 0);
  float q = ab.x * luma(textureLod(uColor, vUv, 0.0).rgb) + ab.y;
  outDepth = vec4(clamp(q, own.z, own.w), 0.0, 0.0, 1.0);
}`;
// Without float render targets the fit cannot be stored: the raw map is
// carried over unrefined at the same resolution, so every LOD below still
// means the same thing.
const REFINE_COPY = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outDepth;
uniform sampler2D uRaw;
void main() { outDepth = vec4(textureLod(uRaw, vUv, 0.0).r, 0.0, 0.0, 1.0); }`;

// Near-field CoC, snapped to the photograph's silhouette. A monocular depth
// map draws a near object's edge a little inside it: the outermost foliage of
// the pine below the terrace still reads as mid distance. Taking the nearest
// depth within a short radius moves the foreground's edge out to where the
// photograph puts it, so its blur starts there and not a hand's width inside.
const SNAP_PASS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outCoc;
${COMMON}
uniform vec2 uBuf;
uniform float uSnap;  // buffer px
void main() {
  vec2 px = 1.0 / uBuf;
  float d = texture(uDepth, vUv).r;
  for (int i = 0; i < ${SNAP_TAPS}; i++) {
    float fi = float(i);
    float r = uSnap * sqrt((fi + 0.5) / ${SNAP_TAPS}.0);
    float a = fi * 2.39996323;
    d = max(d, texture(uDepth, vUv + vec2(cos(a), sin(a)) * r * px).r);
  }
  outCoc = vec4(nearCoc(vUv, d) / uMax, 0.0, 0.0, 1.0);
}`;

// Near-field CoC, max-dilated by its own radius: a pixel takes the largest
// near CoC whose disc reaches it. The foreground gather then searches that far,
// so a blurred pine's rim reaches out over the sharp ridge behind it.
// Fixed spiral, no per-pixel spin: the radius it hands on must not be noisy.
const DILATE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outCoc;
${COMMON}
uniform sampler2D uNear0;  // snapped near CoC / uMax
uniform vec2 uBuf;
float nearCocAt(vec2 uv) { return texture(uNear0, uv).r * uMax; }
void main() {
  vec2 px = 1.0 / uBuf;
  float best = nearCocAt(vUv);
  for (int i = 0; i < ${DILATE_TAPS}; i++) {
    float fi = float(i);
    float r = (uMax + 1.0) * sqrt((fi + 0.5) / ${DILATE_TAPS}.0);
    float a = fi * 2.39996323;
    float s = nearCocAt(vUv + vec2(cos(a), sin(a)) * r * px);
    if (s >= r - 1.0) best = max(best, s);
  }
  outCoc = vec4(best / uMax, 0.0, 0.0, 1.0);
}`;

const GATHER = `#version 300 es
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 outColor; // background: rgb, mean coc / uMax
layout(location = 1) out vec4 outNear;  // foreground: premultiplied rgb, coverage
${COMMON}
uniform sampler2D uNear0;    // snapped near CoC / uMax
uniform sampler2D uNearCoc;  // the same, dilated by its own radius
uniform vec2 uBuf;     // gather buffer size in pixels
float nearCocAt(vec2 uv) { return texture(uNear0, uv).r * uMax; }
uniform float uLod;
void main() {
  float d0;
  float s0 = cocAt(vUv, d0);
  float n0 = nearCocAt(vUv);
  bool nearC = n0 > 0.0;
  vec3 c0 = textureLod(uColor, vUv, uLod).rgb;
  vec3 acc = c0;
  float cacc = s0;
  float tot = 1.0;
  // What lies behind the foreground: the nearest non-foreground samples.
  vec3 hid = vec3(0.0);
  float nh = 0.0;
  vec2 px = 1.0 / uBuf;
  // Interleaved-gradient rotation per pixel: the spiral's structure turns to
  // fine grain instead of a visible pattern inside the discs.
  float spin = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  for (int i = 0; i < ${TAPS}; i++) {
    float fi = float(i);
    float r = uMax * sqrt((fi + 0.5) / ${TAPS}.0);
    float a = fi * 2.39996323 + spin;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r * px;
    float d;
    float s = cocAt(uv, d);
    // A sample behind the centre cannot spread over it further than the
    // centre's own blur: sharp foreground stays clean over a soft distance.
    if (d < d0 - 0.004) s = min(s, s0 * 1.6);
    float m = smoothstep(r - 1.1, r + 0.6, s);
    bool nearS = nearCocAt(uv) > 0.0;
    // Foreground spreads in its own layer, not into the background's.
    if (!nearC && nearS) m = 0.0;
    vec3 c = textureLod(uColor, uv, uLod).rgb;
    if (!nearS) {
      float w = 1.0 - r / (uMax + 1.0);
      hid += c * w;
      nh += w;
    }
    acc += mix(acc / tot, c, m);
    cacc += mix(cacc / tot, s, m);
    tot += 1.0;
  }
  vec3 bg = acc / tot;
  // Inside a defocused foreground object the background layer is what it
  // hides, filled in from the background around it. The foreground's rim is
  // then a true overlap: half pine and half the ridge behind on the
  // silhouette, all pine a CoC inside it, all ridge a CoC outside.
  if (nearC) bg = mix(bg, hid / max(nh, 1e-6), smoothstep(1.2, 2.5, n0) * smoothstep(0.0, 1.5, nh));
  outColor = vec4(bg, cacc / tot / uMax);

  // Foreground layer, Jimenez's near field. Each pixel gathers over the
  // dilated near CoC, so it searches as far as the widest foreground disc that
  // reaches it. A sample joins if its own dilated CoC spans the gap (a small
  // near object beside a big one keeps its own size), carrying its colour
  // premultiplied by how far it is into the near field. The covered share of
  // the disc is the coverage: one inside a blurred pine, a half on its
  // silhouette, falling to nothing a full CoC outside it.
  float R = texture(uNearCoc, vUv).r * uMax;
  vec3 fc = vec3(0.0);
  float fa = 0.0;
  if (R > 0.25) {
    for (int i = 0; i < ${NEAR_TAPS}; i++) {
      float fi = float(i);
      float r = R * sqrt((fi + 0.5) / ${NEAR_TAPS}.0);
      float a = fi * 2.39996323 + spin;
      vec2 uv = vUv + vec2(cos(a), sin(a)) * r * px;
      float reach = texture(uNearCoc, uv).r * uMax;
      float m = smoothstep(r - 1.1, r + 0.6, reach) * smoothstep(0.0, 1.5, nearCocAt(uv));
      fc += textureLod(uColor, uv, uLod).rgb * m;
      fa += m;
    }
  }
  float alpha = fa / ${NEAR_TAPS}.0;
  vec3 fcol = fc / max(fa, 1e-6);
  // Barely-defocused foreground is the full-resolution small disc's job.
  alpha *= smoothstep(0.9, 2.2, R);
  outNear = vec4(fcol * alpha, alpha);
}`;

const COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
${COMMON}
uniform sampler2D uBlur;
uniform sampler2D uNear;
uniform vec2 uBuf;
uniform vec2 uOut;      // print size in device pixels
uniform float uDpr;
uniform float uMaxCss;  // coc cap in css px (uMax / uK are in css px here)
uniform vec2 uView;     // viewport origin in device px
uniform vec4 uRect;     // print rect in device px (x, y, w, h), y from top
uniform vec2 uCanvas;
uniform vec3 uGround;
uniform vec2 uSrc;      // photograph (and refined depth) size in pixels

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
const vec3 HILLS = vec3(0.4, 0.45, 0.51);     // far hills along the horizon
const vec3 FOLIAGE = vec3(0.25, 0.26, 0.22);  // a typical pine, light and shadow
float hsvSat(vec3 c) { float m = max(c.r, max(c.g, c.b)); return (m - min(c.r, min(c.g, c.b))) / max(m, 1e-4); }

// The photograph's own clear sky down the frame (print height 0 at the top),
// measured off city.webp: a pale, flat baby blue.
vec3 skySource(float y) {
  vec3 a = vec3(125.0, 175.0, 231.0) / 255.0;
  vec3 b = vec3(138.0, 185.0, 232.0) / 255.0;
  vec3 c = vec3(161.0, 198.0, 230.0) / 255.0;
  vec3 d = vec3(175.0, 202.0, 226.0) / 255.0;
  float t = clamp(y, 0.0, 0.3) * 10.0;
  return t < 1.0 ? mix(a, b, t) : t < 2.0 ? mix(b, c, t - 1.0) : mix(c, d, t - 2.0);
}
// The summer film sky it is remapped to: deep at the top, open at the haze
// line, hue held between 205 and 212. The anchors are herb's measured
// #0a4f8c / #1f74ad / #5e9cc0 with green nudged up a touch, so that after
// the print curve's lifted toe (which raises red most) they land at hue
// 209 / 210 / 206 and saturation about 0.70 / 0.71 / 0.51 on screen. A
// quadratic through the three, so the gradient has no kink at mid-sky.
vec3 skyFilm(float y) {
  vec3 top = vec3(10.0, 90.0, 140.0) / 255.0;   // #0a5a8c
  vec3 mid = vec3(30.0, 113.0, 174.0) / 255.0;  // #1e71ae
  vec3 haze = vec3(94.0, 152.0, 195.0) / 255.0; // #5e98c3
  float t = clamp(y / 0.33, 0.0, 1.0);
  return top * (2.0 * (t - 0.5) * (t - 1.0)) + mid * (4.0 * t * (1.0 - t)) + haze * (2.0 * t * (t - 0.5));
}
// The grade itself, on one colour. far: the pixel is within a CoC of sky
// depth. ref: what else this colour may be besides sky (the far hills, or
// foliage for the foreground layer). clear: nothing near it, so a pale bright
// patch may be a cloud. up: how much brighter the image is just below than
// just above, which marks a cloud's sunlit top.
vec3 gradeSky(vec3 col, float y, float far, vec3 ref, float clear, float up) {
  vec3 src = skySource(y);
  float ls = luma(src);
  float lum = luma(col);
  // How much of this colour is sky, read as a mix of the clear sky at this
  // height and ref: its colour projected from ref onto the source sky, so a
  // colour that is half sky takes half the grade. In the blurred background
  // ref is the dull blue-grey of the far hills along the horizon (as far as
  // the sky, much darker), which keep their own tone. A sharp silhouette
  // against the sky is unmixed against its real neighbours instead (main).
  vec3 e = src - ref;
  float share = clamp(dot(col - ref, e) / dot(e, e) / 0.9, 0.0, 1.0);
  // Only bright, blue sky: warm stone stays out.
  float gate = smoothstep(0.3, 0.45, lum) * smoothstep(-0.01, 0.05, col.b - col.r);
  float sky = far * share * gate;
  // Shift, not replace: the photograph's own luminance detail rides on the
  // new gradient, so the real clouds and the haze keep their shape.
  vec3 graded = col + (skyFilm(y) - src) * sky;
  // Clouds: brighter than the clear sky at that height and paler than it,
  // and clear of anything near (the photograph's bright sharpening fringe
  // along the pine tops is not a cloud). A cloud is graded as an excess over
  // the sky, never as a colour of its own: the new sky at that height plus
  // the pixel's brightness above the source sky, carried toward a warm
  // neutral white. Brightness within the cloud, plus which way it brightens
  // down the frame, sets how far: the sunlit top goes most of the way, the
  // base and the shadowed flanks stay near the blue that lights them. With
  // no excess the cloud colour is the new sky itself, so a defocused flank
  // runs from the cobalt to a pale highlight, lighter at every step and
  // never through grey.
  float excess = max(lum - ls, 0.0);
  float cloud = clamp(excess / 0.05, 0.0, 1.0) * clamp((hsvSat(src) - hsvSat(col)) / 0.14, 0.0, 1.0) * clear;
  float lit = clamp(excess / (0.9 - ls) * clamp(1.0 + 5.0 * up, 0.6, 1.6), 0.0, 1.0);
  // The white it heads for is itself the sky's pale tint until the very top
  // of the climb, so the hue holds near 205 all the way up and turns warm
  // only where the saturation is already gone: a straight line from cobalt
  // to a warm white would cross cyan on the way.
  vec3 white = mix(vec3(0.8, 0.86, 0.93), vec3(0.89, 0.882, 0.858), lit * lit * lit);
  vec3 cloudCol = mix(skyFilm(y), white, lit);
  return mix(graded, cloudCol, cloud * sky);
}
// Highlight on the stone, for halation: the image as the composite shows it
// (sharp or through the blur buffer by its own CoC), sky and haze left out.
float stoneLight(vec2 q) {
  float d;
  float s = cocAt(q, d);
  vec3 c = mix(textureLod(uColor, q, 1.0).rgb, texture(uBlur, q).rgb, smoothstep(2.2, 5.0, s));
  return smoothstep(0.64, 0.86, luma(c)) * smoothstep(0.66, 0.7, d);
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 uv = (frag - uRect.xy) / uRect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    outColor = vec4(uGround, 1.0);
    return;
  }
  float d0;
  float s0 = cocAt(uv, d0); // css px

  // Near focus: a small full-resolution disc, depth-weighted so an edge
  // between two distances does not smear.
  vec3 small = texture(uColor, uv).rgb;
  float ws = 1.0;
  float rs = min(s0, 4.0) * uDpr;
  if (rs > 0.35) {
    for (int i = 0; i < 12; i++) {
      float fi = float(i);
      float r = rs * sqrt((fi + 0.5) / 12.0);
      float a = fi * 2.39996323 + 0.7;
      vec2 o = vec2(cos(a), sin(a)) * r / uOut;
      float d = texture(uDepth, uv + o).r;
      float w = exp(-abs(d - d0) * 40.0);
      small += texture(uColor, uv + o).rgb * w;
      ws += w;
    }
  }
  small /= ws;

  // Far from focus: depth-aware joint upsample of the gather buffer, over a
  // 4x4 texel footprint with a soft gaussian so the spiral's grain settles.
  vec2 p = uv * uBuf - 0.5;
  vec2 i0 = floor(p) - 1.0;
  vec4 big = vec4(0.0);
  float wb = 0.0;
  vec4 near = vec4(0.0);
  float wn = 0.0;
  float sharpness = 24.0 / (1.0 + s0 * 0.25);
  for (int j = 0; j < 16; j++) {
    vec2 t = i0 + vec2(float(j & 3), float(j >> 2));
    vec2 dv = t - p;
    t = clamp(t, vec2(0.0), uBuf - 1.0);
    vec2 tuv = (t + 0.5) / uBuf;
    float g = exp(-dot(dv, dv) * 0.7);
    float d = textureLod(uDepth, tuv, 2.0).r;
    float w = g * (exp(-abs(d - d0) * sharpness) + 0.002);
    big += texture(uBlur, tuv) * w;
    wb += w;
    // The foreground layer is upsampled with no depth test: it belongs over
    // whatever sits behind it.
    near += texture(uNear, tuv) * g;
    wn += g;
  }
  big /= wb;
  near /= wn;
  float spill = big.a * uMaxCss;
  float t = smoothstep(2.2, 5.0, max(s0, spill));
  vec3 col = mix(small, big.rgb, t);

  // Summer film sky, graded on the background layer before the foreground
  // goes over it, so a blurred pine's rim stays pine. The mask is the
  // farthest depth AND bright AND blue, all read off the image as the lens
  // already drew it, so it is feathered by the same blur as the sky itself.
  // Depth: the nearest-to-infinity value within one CoC cap, so the sky the
  // gather filled in behind a defocused pine counts as sky.
  vec2 cssUv = uDpr / uOut;
  float dFar = textureLod(uDepth, uv, 3.0).r;
  float dNear = dFar;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398 + 0.39;
    float dt = textureLod(uDepth, uv + vec2(cos(a), sin(a)) * uMaxCss * cssUv, 3.0).r;
    dFar = min(dFar, dt);
    dNear = max(dNear, dt);
  }
  float far = smoothstep(0.675, 0.645, dFar);
  // A sharp silhouette against the sky. Its edge pixels are a mix of the
  // pine and the sky behind it, and grading them as one colour (part sky,
  // part not) leaves a band darker than both. So they are unmixed. In a ring
  // a few photograph pixels out: fg, the nearest non-sky neighbours, read off
  // the refined depth and the photograph, counted only while they are drawn
  // sharp (a defocused pine is in the foreground layer, not in col) and
  // weighted hard towards the least sky-like of them, since the silhouette's
  // own pale fringe is already part sky; bg, the background beside it as the
  // lens drew it (the blur buffer at sky depth), which in clear sky is the
  // source sky at that height and at the horizon is the haze.
  vec3 fg = vec3(0.0);
  float fgSum = 0.0;
  float fw = 0.0;
  vec3 bg = vec3(0.0);
  float bw = 0.0;
  if (far > 0.0) {
    vec3 srcSky = skySource(uv.y);
    vec3 e = srcSky - FOLIAGE;
    for (int i = 0; i < 24; i++) {
      float fi = float(i);
      float ring = float(i / 12);
      float a = fi * 0.5235988 + ring * 0.2618;
      vec2 dir = vec2(cos(a), sin(a)) / uSrc;
      vec2 q = uv + dir * (4.0 + 4.0 * ring);
      float dq = textureLod(uDepth, q, 0.0).r;
      float sq = min(max(abs(dq - planeAt(q)) - uDof, 0.0) * uK, uMax);
      vec3 cq = textureLod(uColor, q, 0.0).rgb;
      float w = smoothstep(0.67, 0.71, dq) * (1.0 - smoothstep(2.2, 5.0, sq));
      float notSky = 1.0 - clamp(dot(cq - FOLIAGE, e) / dot(e, e), 0.0, 1.0);
      notSky *= notSky;
      fw += w;
      fg += cq * w * notSky * notSky;
      fgSum += w * notSky * notSky;
      // The background a little further out, clear of the silhouette.
      vec2 qb = uv + dir * (6.0 + 6.0 * ring);
      float wb = smoothstep(0.67, 0.65, textureLod(uDepth, qb, 0.0).r);
      bg += textureLod(uBlur, qb, 0.0).rgb * wb;
      bw += wb;
    }
  }
  float fgW = smoothstep(0.5, 3.0, fw) * smoothstep(0.0, 0.05, fgSum);
  fg /= max(fgSum, 1e-5);
  bg = bw > 0.5 ? bg / bw : skySource(uv.y);
  vec2 dy = vec2(0.0, 0.014);
  float up = luma(textureLod(uColor, uv + dy, 4.0).rgb) - luma(textureLod(uColor, uv - dy, 4.0).rgb);
  float clear = smoothstep(0.69, 0.655, dNear);
  vec3 alone = gradeSky(col, uv.y, far, HILLS, clear, up);
  if (fgW > 0.0) {
    // The pixel's background share: its colour projected onto the line from
    // the pine to the background. It takes exactly that share of the grade
    // the background beside it gets, so pine plus source sky becomes pine
    // plus film sky, and pine plus haze stays pine plus haze.
    vec3 e = bg - fg;
    float share = clamp(dot(col - fg, e) / max(dot(e, e), 1e-4), 0.0, 1.0);
    vec3 unmixed = col + (gradeSky(bg, uv.y, far, HILLS, clear, up) - bg) * share;
    col = mix(alone, unmixed, fgW);
  } else {
    col = alone;
  }
  // The foreground layer gets the same grade, against foliage and never as
  // cloud: its silhouette is snapped a little outward, so a blurred pine
  // against the sky carries some source sky in its rim, which would
  // otherwise come back as a pale baby-blue halo round the pine.
  if (near.a > 1e-3) near.rgb = gradeSky(near.rgb / near.a, uv.y, far, FOLIAGE, 0.0, 0.0) * near.a;

  col = col * (1.0 - near.a) + near.rgb;

  // The tilt-shift print: a touch more snap in the mids, no extra colour.
  col = clamp(col, 0.0, 1.0);
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.18);
  // Print curve: a toe that lifts black to 40/255 and leaves the mids almost
  // where they were, the way a print's paper never goes fully black.
  vec3 inv = 1.0 - col;
  col += (40.0 / 255.0) * inv * inv * inv * inv * inv * inv;
  // Halation: light from the brightest stone scattered back through the film
  // base, a thin amber ring about 0.6% of the print's width round it and
  // none on the stone itself.
  vec2 ringUv = vec2(0.006, 0.006 * uRect.z / uRect.w);
  float halo = 0.0;
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float r = 0.4 + 0.6 * float(i / 8) / 2.0;
    float a = fi * 0.785398 + float(i / 8) * 0.26;
    halo += stoneLight(uv + vec2(cos(a), sin(a)) * r * ringUv);
  }
  halo = min(halo / 24.0 * 2.5, 1.0) * (1.0 - stoneLight(uv));
  col += vec3(1.0, 0.62, 0.28) * 0.08 * halo;
  // The shoulder comes last so nothing on the print reaches white.
  col = shoulder(col);
  col += (hash(frag) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
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

function texture(gl, img, format, mip) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  if (format === "r") gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, img);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function target(gl, w, h, internal, format, type) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// The guided refine (REFINE_FIT, REFINE_APPLY) into an R8 depth texture at
// the photograph's size, mipmapped like the raw map was.
function refineDepth(gl, colorTex, rawTex, w, h, float, vao) {
  // Targets first: creating one binds it, and none may stay bound to a unit
  // a pass reads from while it is attached.
  const out = target(gl, w, h, gl.R8, gl.RED, gl.UNSIGNED_BYTE);
  const fitTex = float ? target(gl, w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT) : null;
  const fbo = gl.createFramebuffer();
  gl.bindVertexArray(vao);
  gl.disable(gl.BLEND);
  gl.viewport(0, 0, w, h);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, colorTex);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, rawTex);
  const programs = [];
  if (float) {
    const fit = compile(gl, VERT, REFINE_FIT);
    const apply = compile(gl, VERT, REFINE_APPLY);
    programs.push(fit, apply);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fitTex, 0);
    gl.useProgram(fit.p);
    gl.uniform1i(fit.u.uColor, 0);
    gl.uniform1i(fit.u.uRaw, 1);
    gl.uniform2f(fit.u.uSize, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, fitTex);
    gl.useProgram(apply.p);
    gl.uniform1i(apply.u.uColor, 0);
    gl.uniform1i(apply.u.uFit, 2);
    gl.uniform2f(apply.u.uSize, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteTexture(fitTex);
  } else {
    const copy = compile(gl, VERT, REFINE_COPY);
    programs.push(copy);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
    gl.useProgram(copy.p);
    gl.uniform1i(copy.u.uRaw, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  for (const { p } of programs) gl.deleteProgram(p);
  gl.bindTexture(gl.TEXTURE_2D, out);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return out;
}

// Depth as a CPU array too, so the pointer can ask "how far is this?"
function depthField(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const w = c.width;
  const h = c.height;
  return (u, v) => {
    // Median of a small neighbourhood: a pointer resting on an edge picks a
    // side instead of focusing on the halfway distance between them.
    const cx = Math.round(clamp(u, 0, 1) * (w - 1));
    const cy = Math.round(clamp(v, 0, 1) * (h - 1));
    const vals = [];
    for (let y = -3; y <= 3; y++) {
      for (let x = -3; x <= 3; x++) {
        const px = clamp(cx + x * 2, 0, w - 1);
        const py = clamp(cy + y * 2, 0, h - 1);
        vals.push(data[(py * w + px) * 4]);
      }
    }
    vals.sort((a, b) => a - b);
    return vals[vals.length >> 1] / 255;
  };
}

// A focus ring: a critically damped spring with a little extra mass, so a
// rack has weight and lands without overshoot.
function ring(x) {
  return { x, v: 0, target: x };
}
function stepRing(s, dt, k = 46) {
  const c = 2 * Math.sqrt(k) * 1.04;
  const a = k * (s.target - s.x) - c * s.v;
  s.v += a * dt;
  s.x += s.v * dt;
  return Math.abs(s.target - s.x) > 1e-4 || Math.abs(s.v) > 1e-4;
}

export async function createMiniature(host) {
  const stage = createStage(host, { dpr: 2, webgl: true, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");

  const [colorImg, depthImg] = await Promise.all([loadImage(COLOR_SRC), loadImage(DEPTH_SRC)]);
  const depthAt = depthField(depthImg);

  const colorTex = texture(gl, colorImg, "rgba", true);
  const rawDepthTex = texture(gl, depthImg, "r", false);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Half-float keeps the soft gradients of a deep defocus free of banding;
  // RGBA8 is the fallback.
  const float = !!gl.getExtension("EXT_color_buffer_float");

  // The depth map, refined against the photograph at its full resolution,
  // once. Everything after reads this texture, never the raw map.
  const depthTex = refineDepth(gl, colorTex, rawDepthTex, colorImg.naturalWidth, colorImg.naturalHeight, float, vao);
  gl.deleteTexture(rawDepthTex);

  const snap = compile(gl, VERT, SNAP_PASS);
  const dilate = compile(gl, VERT, DILATE);
  const gather = compile(gl, VERT, GATHER);
  const composite = compile(gl, VERT, COMPOSITE);

  const blurTex = gl.createTexture();
  const nearTex = gl.createTexture();
  const cocTex = gl.createTexture();
  const snapTex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  const cocFbo = gl.createFramebuffer();
  const snapFbo = gl.createFramebuffer();
  let buf = [1, 1];
  let rect = { x: 0, y: 0, w: 1, h: 1 };

  const params = new URLSearchParams(window.location.search);
  const qf = params.get("f");
  const qy = params.get("y");
  const held = qf != null && Number.isFinite(+qf);
  const start = held ? { f: clamp(+qf, 0, 1), y: qy != null ? clamp(+qy, 0, 1) : HERO.y } : FAR;
  const focus = ring(start.f);
  const focusY = ring(start.y);
  let locked = held;
  let dirty = true;
  let touched = held;

  const layout = (w, h) => {
    // The print: as large as the box allows with a generous margin.
    const m = Math.max(24, Math.min(w, h) * 0.08);
    let ph = h - 2 * m;
    let pw = ph * ASPECT;
    if (pw > w - 2 * m) {
      pw = w - 2 * m;
      ph = pw / ASPECT;
    }
    rect = { x: Math.round((w - pw) / 2), y: Math.round((h - ph) / 2), w: Math.round(pw), h: Math.round(ph) };
    buf = [Math.max(8, Math.round(rect.w * BUF_SCALE)), Math.max(8, Math.round(rect.h * BUF_SCALE))];
    for (const t of [blurTex, nearTex, cocTex, snapTex]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, buf[0], buf[1], 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, buf[0], buf[1], 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, snapFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, snapTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, cocFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cocTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, blurTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, nearTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    dirty = true;
  };
  stage.onResize(layout);

  const aim = (p) => {
    const u = (p.x - rect.x) / rect.w;
    const v = clamp((p.y - rect.y) / rect.h, 0, 1);
    // Off the print, the pointer still racks by height alone.
    focus.target = depthAt(clamp(u, 0.02, 0.98), v);
    focusY.target = v;
  };

  stage.on("move", (p) => {
    touched = true;
    if (!locked) aim(p);
  });
  stage.on("down", (p) => {
    touched = true;
    if (locked) {
      locked = false;
      aim(p);
    } else {
      aim(p);
      locked = true;
    }
  });

  // On arrival the lens is on the dome; then it racks down into the piazza,
  // and the square turns into a model of itself.
  const intro = held
    ? 0
    : window.setTimeout(() => {
        if (touched) return;
        focus.target = HERO.f;
        focusY.target = HERO.y;
      }, 1100);

  const draw = () => {
    const dpr = stage.dpr;
    const ph = rect.h; // css px
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, colorTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    // Uniforms shared by the two buffer passes (units: buffer pixels).
    const bufferUniforms = (u) => {
      gl.uniform1i(u.uColor, 0);
      gl.uniform1i(u.uDepth, 1);
      gl.uniform1f(u.uFocus, focus.x);
      gl.uniform1f(u.uFocusY, focusY.x);
      gl.uniform1f(u.uTilt, TILT);
      gl.uniform1f(u.uDof, DOF);
      gl.uniform1f(u.uK, K_COC * ph * BUF_SCALE);
      gl.uniform1f(u.uMax, MAX_COC * ph * BUF_SCALE);
      gl.uniform2f(u.uBuf, buf[0], buf[1]);
    };
    gl.viewport(0, 0, buf[0], buf[1]);

    // pass 1: near CoC, snapped to the silhouette
    gl.useProgram(snap.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, snapFbo);
    bufferUniforms(snap.u);
    gl.uniform1f(snap.u.uSnap, SNAP * ph * BUF_SCALE);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // pass 2: near CoC, dilated by its own radius
    gl.useProgram(dilate.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, cocFbo);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, snapTex);
    bufferUniforms(dilate.u);
    gl.uniform1i(dilate.u.uNear0, 4);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // pass 3: gather, background and foreground layers
    gl.useProgram(gather.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, cocTex);
    const gu = gather.u;
    bufferUniforms(gu);
    gl.uniform1i(gu.uNear0, 4);
    gl.uniform1i(gu.uNearCoc, 3);
    gl.uniform1f(gu.uLod, Math.max(0, Math.log2(colorImg.naturalHeight / buf[1])));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // pass 4: composite (units: css pixels)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(composite.p);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, blurTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, nearTex);
    const cu = composite.u;
    gl.uniform1i(cu.uColor, 0);
    gl.uniform1i(cu.uDepth, 1);
    gl.uniform1i(cu.uBlur, 2);
    gl.uniform1i(cu.uNear, 3);
    gl.uniform1f(cu.uFocus, focus.x);
    gl.uniform1f(cu.uFocusY, focusY.x);
    gl.uniform1f(cu.uTilt, TILT);
    gl.uniform1f(cu.uDof, DOF);
    gl.uniform1f(cu.uK, K_COC * ph);
    gl.uniform1f(cu.uMax, MAX_COC * ph);
    gl.uniform1f(cu.uMaxCss, MAX_COC * ph);
    gl.uniform2f(cu.uBuf, buf[0], buf[1]);
    gl.uniform2f(cu.uOut, rect.w * dpr, rect.h * dpr);
    gl.uniform1f(cu.uDpr, dpr);
    gl.uniform4f(cu.uRect, rect.x * dpr, rect.y * dpr, rect.w * dpr, rect.h * dpr);
    gl.uniform2f(cu.uCanvas, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform3f(cu.uGround, GROUND[0], GROUND[1], GROUND[2]);
    gl.uniform2f(cu.uSrc, colorImg.naturalWidth, colorImg.naturalHeight);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  stage.onFrame((dt) => {
    const moving = stepRing(focus, dt) | stepRing(focusY, dt, 40);
    if (!moving && !dirty) return;
    dirty = false;
    draw();
  });

  return {
    destroy() {
      window.clearTimeout(intro);
      stage.destroy();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
