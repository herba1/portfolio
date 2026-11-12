import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Train Window: looking out of a local train on a summer day.
//
// The view is from a low seat, looking up and out through the window: a
// worm's-eye look-up. The camera is pitched ~32° up, so the horizon sits at
// the very bottom of the print (bowing up into its lower corners) and the sky
// fills nearly all of it, through a 110° Panini lens with a stereographic
// vertical squeeze. The poles, seen from below, converge hard on a vanishing
// point overhead, their crossarms against the cumulus. Each pixel's ray is
// levelled back into a square-out pinhole's image plane (tan of the angle,
// horizon at y = 0, camera 1.7 m up), where the layers live. Moving along the track by s metres moves
// everything at distance D by s / D in that plane, so each layer slides at its
// own speed:
//
//  - the field is a flat plane: a row y below the horizon is at D = h / -y,
//    so the ground is not one layer but a continuous shear, each row sliding
//    at V·(-y)/h (Poly Haven `rural_asphalt_road`, reprojected square out of
//    the road onto the plane, made periodic with a noise-masked crossfade);
//  - the hedge, barn and trees at the far edge of the field (~70 m), cut from
//    the same plate with Depth Anything V2 and a colour key, tiled with a
//    mirror and a gap so the open country behind shows through;
//  - the far tree line and farmland (~900 m), a mirrored strip;
//  - cumulus at a few kilometres (Poly Haven `kloofendal_48d_partly_cloudy`
//    pure sky, rotated so its sun agrees with the plate's, baked up to the
//    zenith by tools/depth/bakes/train-window/sky.py), which barely move;
//  - distribution poles every 11-19 m, 8 m out, so one nearly always stands
//    in the window and climbs into the sky from below its bottom edge
//    (Poly Haven `modular_electricity_poles`, scaled to an 11.5 m pole, rendered in
//    perspective from this camera and lit by the plate's own HDRI), with their
//    conductors drawn as catenaries.
//
// Motion blur is the shutter: every layer is integrated along x over 1/40 s
// at its own screen velocity, so the near grass streaks, the poles smear into
// soft bars, the hedge softens and the clouds stay sharp. The pole is the
// print's one sharp anchor: at a crawl it is opaque and crisp, and the poles
// and conductors are taken from a second development of the same frame with
// no diffusion (no Pro-Mist veil, no film halation), so their only blur is
// velocity x shutter. The field and hedge read horizontally box-filtered
// pyramids; the poles, which carry the idea,
// read per-row summed-area tables of their premultiplied radiance, so their
// smear is the exact box integral over the shutter's path (two reads a row at
// any length, no taps to band). Either way a long streak keeps its vertical
// detail the way a real one does.
//
// Drag sideways to set the train's speed and direction; let go and it coasts
// down to a crawl. Query: ?v=m/s holds a speed (blur visible), ?s=metres sets
// the position along the track, ?still=1 skips the reveal, ?dbg=1/2/4 hides
// the far tree line / hedge / poles.

const BASE = "/lab/train-window/";
const LO = -8.0;
const HI = 1.5;

const CAM_H = 1.7; // camera height above the field (m)
const D_HEDGE = 120; // hedge and barn
const HEDGE_SCALE = 0.55; // the plate's hedge, set back to that distance
const D_DIST = 900; // far tree line
const D_SKY = 3000; // cumulus
const D_POLE = 8; // pole line, just past the ballast
const POLE_SCALE = 1.88; // model units -> metres (an 11.5 m pole)
const POLE_CELL = 15; // mean spacing (m): one is nearly always in the window
const POLE_JITTER = 8; // spacing varies by this much (m)
const SHUTTER = 1 / 40;
const V_MAX = 34; // m/s, a fast local
const V_CRUISE = 2.4; // the crawl it coasts down to
const HFOV = 110; // degrees across a landscape print
const PAN_W = 4 * Math.tan(((HFOV / 4) * Math.PI) / 180); // Panini (d = 1) plane width
const HORIZON = 0.98; // horizon height at the centre, as a share of the print from the top
const TILT = 0.92; // share of the look-up done by pitching the camera (the rest is lens shift)
const TOP_EL = 84; // highest elevation (deg) the print's top may reach (a tall portrait zooms in)

// Asset geometry (from the bake).
const SKY = { el0: 90, el1: -2.5, yaw: -112 };
const DIST = { yaw0: -10, yaw1: 44, el0: 6, el1: -1 };
const HEDGE = { yaw0: 43, yaw1: 120.5, el0: 15, el1: -1.4, gap: 62 };
const GROUND = { y0: -0.004, y1: -0.335, x0: -0.95, period: 1.65 };
const POLE = { l: -0.18, r: 0.18, b: -0.23, t: 1.44, n: 4, rot: [1.22, 1.22, -1.22, -1.22] };
const LEVELS = 7;
const POLE_TEX_H = 1670; // poles.webp height (texels)
const POLE_CELL_W = 360; // poles.webp cell width (texels): four sprites side by side
// The poles are seen from below, against a sky the polariser holds down: the
// faces toward the lens are mostly shaded undersides. The wood keeps its own
// radiance up to a knee; above it the sunlit steel and glaze roll off under a
// ceiling (linear, under the darkest clear blue the poles cross), so a pole is
// darker than the sky behind it, sharp or smeared, and still has its form.
const POLE_TONE = { knee: 0.016, ceil: 0.036 };
// Sky grade (see the shader): cloud highlight push in stops, how much local
// form and top-lit relief steer it, the warm-neutral shoulder, and the
// luminance the push eases toward (x the print exposure, just under white).
const SKY_GRADE = { push: 1.1, form: 0.45, relief: 0.7, warm: 1, tint: [1.1, 1.0, 0.8], top: 2.35 };

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

uniform sampler2D uSky;
uniform sampler2D uDist;
uniform sampler2D uGround;  // horizontal box pyramid atlas, premultiplied linear
uniform sampler2D uHedge;
uniform highp sampler2D uPoles; // per-row prefix sums, premultiplied linear, one run per cell
uniform vec4 uGroundLv[${LEVELS}]; // x offset (texels), width (texels), atlas width, unused
uniform vec4 uHedgeLv[${LEVELS}];

uniform vec4 uView;     // x0, y0, w, h in Panini-plane units
uniform vec2 uPitch;    // cos, sin of the camera's upward tilt
uniform float uS;       // metres along the track
uniform float uV;       // m/s
uniform float uShutter;
uniform float uSkyDrift;
uniform float uExpo;
uniform float uGrad;
uniform float uPol;
uniform vec4 uSkyPush;   // highlight push (stops), local form, relief, warm share
uniform vec3 uSkyWarm;   // the sunlit-top tint (luminance 1)
uniform float uSkyTop;   // the pushed cloud's luminance ceiling
uniform vec4 uPole[8];  // per candidate pole: screen x, sprite index, attach flip, unused
uniform int uPoleN;
uniform int uDbg;
uniform vec3 uHalo;     // pole-edge halation, linear

const float LO = ${LO.toFixed(2)};
const float HI = ${HI.toFixed(2)};
const float H = ${CAM_H.toFixed(3)};
const float DEG = 57.29578;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 dec(vec3 v) { return exp2(v * (HI - LO) + LO); }

// One tap of a horizontal-box pyramid: level l, u in [0,1) (wrapped by the
// caller), v in [0,1].
vec4 tapLv(sampler2D t, vec4 lv, float u, float v) {
  float x = lv.x + u * lv.y;
  return texture(t, vec2(x / lv.z, v));
}

// Box blur of width 'len' texels (level 0) centred on u, from the pyramid.
// wrap: 1 periodic, 0 clamp.
#define BLUR(NAME, TEX, LV, N) \
vec4 NAME(float u, float v, float len, float wrap) { \
  if (len < 1.0) { \
    float uu = wrap > 0.5 ? fract(u) : clamp(u, 0.0, 1.0); \
    return tapLv(TEX, LV[0], uu, v); \
  } \
  float sp = len / float(N); \
  float lf = clamp(log2(max(sp, 1.0)) + 0.7, 0.0, float(${LEVELS - 1}) - 0.001); \
  int l0 = int(floor(lf)); \
  float f = lf - float(l0); \
  vec4 a = vec4(0.0), b = vec4(0.0); \
  float w0 = LV[0].y; \
  for (int i = 0; i < N; i++) { \
    float o = ((float(i) + 0.5) / float(N) - 0.5) * len / w0; \
    float uu = u + o; \
    uu = wrap > 0.5 ? fract(uu) : clamp(uu, 0.0, 1.0); \
    a += tapLv(TEX, LV[l0], uu, v); \
    b += tapLv(TEX, LV[min(l0 + 1, ${LEVELS - 1})], uu, v); \
  } \
  return mix(a, b, f) / float(N); \
}
BLUR(blurGround, uGround, uGroundLv, 10)

// Pole sprites as per-row prefix sums: texel i of a cell's run holds the sum
// of the premultiplied texels left of i, so the integral of the row from 0 to
// a continuous X is a lerp of two neighbours, and a box of any length is the
// difference of two of those: exact, with nothing to band or step.
const int PCW = ${POLE_CELL_W};
const int PH = ${POLE_TEX_H};
vec4 poleS(int base, float X, int row) {
  X = clamp(X, 0.0, float(PCW));
  float fx = floor(X);
  int i = int(fx);
  vec4 a = texelFetch(uPoles, ivec2(base + i, row), 0);
  vec4 b = texelFetch(uPoles, ivec2(base + min(i + 1, PCW), row), 0);
  return mix(a, b, X - fx);
}
// Mean premultiplied colour and coverage over [X - len/2, X + len/2] (cell
// texels, outside the cell is clear), linear between rows at Y (texels from
// the top). len is at least one texel, which is plain linear filtering.
vec4 poleBox(int cell, float X, float Y, float len) {
  len = max(len, 1.0);
  int base = cell * (PCW + 1);
  float x0 = X - 0.5 * len, x1 = X + 0.5 * len;
  float yy = clamp(Y - 0.5, 0.0, float(PH - 1));
  int r0 = int(floor(yy));
  int r1 = min(r0 + 1, PH - 1);
  vec4 s0 = poleS(base, x1, r0) - poleS(base, x0, r0);
  vec4 s1 = poleS(base, x1, r1) - poleS(base, x0, r1);
  return max(mix(s0, s1, yy - floor(yy)) / len, vec4(0.0));
}

// The hedge is tiled H | mirror(H) | gap; every tap finds its own tile.
vec4 hedgeAt(float yawDeg, float v, float lenDeg, float lv) {
  float L = ${(HEDGE.yaw1 - HEDGE.yaw0).toFixed(3)};
  float P = 2.0 * L + ${HEDGE.gap.toFixed(3)};
  const int N = 8;
  int n = lenDeg * uHedgeLv[0].y / L < 1.0 ? 1 : N;
  int l = int(lv);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < N; i++) {
    if (i >= n) break;
    float o = n == 1 ? 0.0 : ((float(i) + 0.5) / float(N) - 0.5) * lenDeg;
    float p = mod(yawDeg + o, P);
    if (p < 2.0 * L) {
      float u = p < L ? p / L : 1.0 - (p - L) / L;
      acc += tapLv(uHedge, uHedgeLv[l], clamp(u, 0.0, 1.0), v);
    }
  }
  return acc / float(n);
}

float hash11(float n) { return fract(sin(n * 127.1) * 43758.5453); }

void main() {
  // Panini (d = 1) back to a ray, its vertical squeezed stereographically
  // (qv = 2·tan(t/2) of the angle t above the lens's equator, so the arms at
  // the top of a pole are not stretched the way a rectilinear 75° would),
  // tilted up by the camera's pitch, then levelled into the square-out
  // pinhole's image plane.
  vec2 q = uView.xy + vUv * uView.zw;
  float phi = 2.0 * atan(0.5 * q.x);
  float qv = 0.5 * q.y * (1.0 + cos(phi));
  vec3 rc = vec3(sin(phi), qv / (1.0 - 0.25 * qv * qv), cos(phi));
  vec3 r = normalize(vec3(rc.x, rc.y * uPitch.x + rc.z * uPitch.y, rc.z * uPitch.x - rc.y * uPitch.y));
  float rz = max(r.z, 1e-3);
  float x = r.x / rz, y = r.y / rz;
  float yaw = atan(r.x, rz) * DEG;
  float el = asin(clamp(r.y, -1.0, 1.0)) * DEG;
  // one render pixel, in image-plane units, for the conductors' coverage
  float pxY = max(length(vec2(dFdx(y), dFdy(y))), 1e-6);
  float aV = abs(uV);

  // Sky: cumulus a few km off, rotating past very slowly.
  float skyYaw = yaw + ${SKY.yaw.toFixed(2)} + (uS / ${D_SKY.toFixed(1)}) * DEG + uSkyDrift;
  vec2 su = vec2(skyYaw / 360.0 + 0.5, (${SKY.el0.toFixed(2)} - el) / ${(SKY.el0 - SKY.el1).toFixed(2)});
  // The clear blue is read from a coarse mip (an 8-bit ramp has no business
  // showing its steps once the polariser deepens it); cloud edges, where the
  // fine and coarse reads disagree, stay sharp.
  vec3 sf = texture(uSky, su).rgb;
  vec3 sc = textureLod(uSky, su, 4.0).rgb;
  float edge = smoothstep(0.012, 0.035, length(sf - sc));
  vec3 col = dec(mix(sc, sf, edge));
  // Polariser on the lens, sun ~60° off the view: the clear (Rayleigh) blue
  // darkens and deepens, cloud white keeps.
  float A = clamp((0.9 * col.b - col.r) / 0.5, 0.0, col.b);
  col = col - A * vec3(0.30, 0.45, 0.9) * uPol + A * vec3(0.0, 0.30, 0.66) * uPol;

  // Sky grade, before the film. The plate's cumulus sit a stop under where a
  // print wants them and carry the HDRI's blue cast, so the film's shoulder
  // squeezes them to a dull blue-grey. Cloud (not the clear blue) gets a
  // highlight-only exposure push, scaled by its local form: brighter than its
  // ~3° neighbourhood and with darker sky above than below (a sunlit top)
  // pushes more; the reverse (a base or a fold) holds back. Then the top of
  // the push rolls off to warm-neutral sunlight while undersides and shadows
  // keep the skylight blue they are lit by.
  {
    float sl = dot(col, LUMA);
    // Whiteness: the clear blue is ~0.3 after the polariser, cloud 0.75-0.9.
    // The thin blue-white margin of a puff is only half cloud, so it gets
    // little push and none of the warm tint (blue plus warm is mauve).
    float wr = col.r / max(col.b, 1e-4);
    float cloud = smoothstep(0.45, 0.78, wr);
    cloud *= cloud;
    float core = smoothstep(0.68, 0.86, wr);
    float ml = dot(dec(textureLod(uSky, su, 6.0).rgb), LUMA);
    // top-lit relief at two scales: a puff's own top, and the top of the
    // low bank behind the tree line (which otherwise has no form at all)
    float up = dot(dec(textureLod(uSky, su - vec2(0.0, 0.022), 5.0).rgb), LUMA);
    float dn = dot(dec(textureLod(uSky, su + vec2(0.0, 0.022), 5.0).rgb), LUMA);
    float upC = dot(dec(textureLod(uSky, su - vec2(0.0, 0.05), 6.0).rgb), LUMA);
    float dnC = dot(dec(textureLod(uSky, su + vec2(0.0, 0.05), 6.0).rgb), LUMA);
    float relief = clamp(0.6 * (dn - up) / (dn + up + 1e-3) + 0.8 * (dnC - upC) / (dnC + upC + 1e-3), -1.0, 1.0);
    float st = log2(max(sl, 1e-4));
    float lift = uSkyPush.x * smoothstep(-1.6, 0.4, st)
               + uSkyPush.y * clamp(log2(max(sl, 1e-4) / max(ml, 1e-4)), -1.0, 1.0)
               + uSkyPush.z * relief;
    col *= exp2(cloud * lift);
    // Soft shoulder on the pushed cloud: luminance eases toward uSkyTop
    // instead of running into the film's white, so the brightest tops glow
    // without clipping (and without a halation hot spot).
    float sl2 = dot(col, LUMA);
    float knee = 0.55 * uSkyTop;
    float over = max(sl2 - knee, 0.0);
    float sl3 = sl2 > knee ? knee + over / (1.0 + over / (uSkyTop - knee)) : sl2;
    col *= mix(1.0, sl3 / max(sl2, 1e-4), cloud);
    sl2 = dot(col, LUMA);
    float warm = core * smoothstep(0.65, 1.6, sl2);
    col = mix(col, sl2 * uSkyWarm, warm * uSkyPush.w);
    float shade = cloud * (1.0 - smoothstep(0.4, 1.15, sl2));
    col = mix(col, sl2 * vec3(0.74, 0.96, 1.38), shade * 0.6);
  }

  // Far tree line and farmland, mirrored.
  float dYaw = yaw + 6.0 + (uS / ${D_DIST.toFixed(1)}) * DEG;
  vec2 du = vec2(dYaw / ${(DIST.yaw1 - DIST.yaw0).toFixed(2)}, (${DIST.el0.toFixed(2)} - el) / ${(DIST.el0 - DIST.el1).toFixed(2)});
  vec4 dt = texture(uDist, du);
  if ((uDbg & 1) == 0) col = mix(col, dec(dt.rgb), dt.a);

  // Ground: a flat field, each row at its own distance h / -y.
  vec4 g = vec4(0.0);
  float gFar = 0.0, gNear = 0.0;
  if (y < -0.0006) {
    float k = -y / H;                           // 1 / D at this row
    // The plate's field rises to a crest at y = -0.05 (the hedge base hides
    // behind it). Rows above that are read from below the crest, scaled
    // horizontally to the row's own distance, so the field runs flat out to
    // the far hedge.
    float ys = mix(-0.050, ${GROUND.y1.toFixed(4)}, (y - ${GROUND.y0.toFixed(4)}) / ${(GROUND.y1 - GROUND.y0).toFixed(4)});
    float r = ys / y;
    float ux = (x + uS * k) * r;
    float u = (ux - ${GROUND.x0.toFixed(3)}) / ${GROUND.period.toFixed(4)};
    float v = (${GROUND.y0.toFixed(4)} - ys) / ${(GROUND.y0 - GROUND.y1).toFixed(4)};
    float len = aV * k * r * uShutter / ${GROUND.period.toFixed(4)} * uGroundLv[0].y;
    g = blurGround(u, v, len, 1.0);
    g.rgb = mix(vec3(dot(g.rgb, vec3(0.2126, 0.7152, 0.0722))), g.rgb, 0.86);
    gFar = smoothstep(-0.0006, -0.0018, y);
    gNear = smoothstep(-0.0095, -0.0150, y);
  }
  col = mix(col, g.rgb, gFar);

  // Hedge, barn and trees at the far edge of the field.
  float hel = el / ${HEDGE_SCALE.toFixed(3)};
  if (hel < ${HEDGE.el0.toFixed(1)} && hel > ${HEDGE.el1.toFixed(1)}) {
    float hYaw = (yaw + (uS / ${D_HEDGE.toFixed(1)}) * DEG) / ${HEDGE_SCALE.toFixed(3)} + 18.0;
    float v = (${HEDGE.el0.toFixed(2)} - hel) / ${(HEDGE.el0 - HEDGE.el1).toFixed(2)};
    float lenDeg = aV / ${D_HEDGE.toFixed(1)} * uShutter * DEG / ${HEDGE_SCALE.toFixed(3)};
    float texels = lenDeg / ${(HEDGE.yaw1 - HEDGE.yaw0).toFixed(3)} * uHedgeLv[0].y;
    float lv = clamp(floor(log2(max(texels / 8.0, 1.0))), 0.0, float(${LEVELS - 1}));
    vec4 h = hedgeAt(hYaw, v, lenDeg, lv);
    if ((uDbg & 2) == 0) col = col * (1.0 - h.a) + h.rgb;
  }
  col = mix(col, g.rgb, gNear);

  // Conductors: catenaries between consecutive poles, each at its own height
  // and depth. Along the track they ride with the pole sprites (which shift as
  // one piece at the pole line's distance), so every wire meets its insulator.
  float sp = uS + x * ${D_POLE.toFixed(1)};
  float wireA = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i + 1 >= uPoleN) break;
    vec4 a = uPole[i], b = uPole[i + 1];
    // a.x, b.x: along-track positions (m); a.z / b.z: orientation (+1 / -1)
    if (sp < a.x - 3.0 || sp > b.x + 3.0) continue;
    for (int w = 0; w < 4; w++) {
      float side = (w == 0 || w == 2) ? 1.0 : -1.0;     // far / near conductor
      float hz = w < 2 ? ${(5.76 * POLE_SCALE).toFixed(3)} : ${(4.66 * POLE_SCALE).toFixed(3)};
      float zr = 0.43 * ${POLE_SCALE.toFixed(3)};
      // arm end along local z: rotated by the pole's yaw, it lands off the
      // pole along the track by zr·sin r and off it in depth by zr·cos r
      float sr = sin(1.22), cr = cos(1.22);
      float dz = side * zr * cr;
      float axA = -side * zr * sr * a.z;
      float axB = -side * zr * sr * b.z;
      float Dw = ${D_POLE.toFixed(1)} + dz;
      float k = ${D_POLE.toFixed(1)} / Dw;
      float A0 = a.x + axA * k, B0 = b.x + axB * k;
      float t = (sp - A0) / (B0 - A0);
      if (t < -0.02 || t > 1.02) continue;
      float sag = 0.018 * (B0 - A0);
      float z = hz - sag * 4.0 * t * (1.0 - t);
      float yw = (z - H) / Dw;
      float slope = -4.0 * sag * (1.0 - 2.0 * t) / (B0 - A0);
      float d = abs(y - yw) / sqrt(1.0 + slope * slope * k * k);
      float hw = 0.011 / Dw;
      float smear = abs(slope) * aV * uShutter / Dw;
      float e = max(hw, 0.5 * pxY) + 0.5 * smear;
      float cov = smoothstep(e + 0.6 * pxY, e - 0.6 * pxY, d) * min(1.0, (2.0 * hw) / (2.0 * e));
      wireA = max(wireA, cov);
    }
  }
  col = mix(col, vec3(0.012, 0.013, 0.015), wireA * 0.92);
  // How much of this pixel is the line itself (poles and conductors): the
  // print takes those from a second development without the diffusion.
  float lineA = wireA * 0.92;

  // Poles: sprites rendered from this very camera, smeared by the shutter.
  float lenM = aV * uShutter;                      // metres the train moved
  for (int i = 0; i < 8; i++) {
    if (i >= uPoleN) break;
    vec4 pl = uPole[i];
    float px = (pl.x - uS) / ${D_POLE.toFixed(1)};
    float lx = x - px;
    float hb = 0.5 * lenM / ${D_POLE.toFixed(1)};
    if (lx < ${POLE.l.toFixed(3)} - hb || lx > ${POLE.r.toFixed(3)} + hb) continue;
    if (y < ${POLE.b.toFixed(3)} || y > ${POLE.t.toFixed(4)}) continue;
    int cell = int(pl.y + 0.5);
    // sprite texels: X across the cell, Y down from its top
    float X = (lx - ${POLE.l.toFixed(3)}) / ${(POLE.r - POLE.l).toFixed(3)} * float(PCW);
    float Y = (${POLE.t.toFixed(4)} - y) / ${(POLE.t - POLE.b).toFixed(4)} * float(PH);
    // the shutter's path, in texels: the train moved lenM, the pole line is
    // D_POLE off, so the sprite slid lenM / D_POLE of the image plane
    float lenTex = (lenM / ${D_POLE.toFixed(1)}) / ${(POLE.r - POLE.l).toFixed(3)} * float(PCW);
    vec4 pc = poleBox(cell, X, Y, lenTex);
    if ((uDbg & 4) == 0) {
      // Halation: where the dark pole crosses bright cloud, light that went
      // through the emulsion and bounced off the film base comes back
      // through the red layer just inside the pole's edge, a thin warm ring.
      // The edge is where the pole's coverage over a ~12-texel neighbourhood
      // (along the smear, and a few texels above and below for the arms)
      // falls short of its coverage here.
      float bgL = dot(col, LUMA);
      float hot = smoothstep(0.6, 1.7, bgL);
      col = col * (1.0 - pc.a) + pc.rgb;
      lineA = 1.0 - (1.0 - lineA) * (1.0 - pc.a);
      if (hot > 0.0 && pc.a > 0.01) {
        float nA = 0.5 * poleBox(cell, X, Y, lenTex + 12.0).a
                 + 0.25 * poleBox(cell, X, Y - 5.0, 8.0).a
                 + 0.25 * poleBox(cell, X, Y + 5.0, 8.0).a;
        float ring = pc.a * clamp(2.2 * (pc.a - nA) + 0.6 * (1.0 - nA), 0.0, 1.0);
        col += uHalo * ring * hot;
      }
    }
  }

  // A soft graduated ND over the sky, then exposure.
  col *= exp2(-uGrad * smoothstep(0.0, 0.3, y));
  outColor = vec4(col * uExpo, clamp(lineA, 0.0, 1.0));
}`;

const BLIT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform sampler2D uLine;   // the same frame developed without diffusion
uniform sampler2D uMask;   // the scene: line (pole, conductor) coverage in a
uniform float uFade;
uniform vec3 uPaper;
void main() {
  vec3 c = mix(texture(uTex, vUv).rgb, texture(uLine, vUv).rgb, texture(uMask, vUv).a);
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

function imageTexture(gl, img, { wrap = gl.CLAMP_TO_EDGE, mips = true } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// float32 -> float16 bits.
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function toHalf(v) {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let e = ((x >>> 23) & 0xff) - 127 + 15;
  const m = x & 0x7fffff;
  if (e <= 0) {
    if (e < -10) return sign;
    return sign | ((m | 0x800000) >> (1 - e + 13));
  }
  if (e >= 31) return sign | 0x7bff;
  return sign | (e << 10) | (m >> 13);
}

// Decode a log-encoded image to premultiplied linear RGBA, then build a
// pyramid that halves only the width (a horizontal box of 2^l texels per
// level), packed side by side in one half-float texture. Motion blur reads it
// so a long streak keeps its full vertical resolution.
function hPyramid(gl, img, { wrap, alpha }) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const cx = cv.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
  cx.drawImage(img, 0, 0);
  const src = cx.getImageData(0, 0, w, h).data;
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = 2 ** ((i / 255) * (HI - LO) + LO);

  const PAD = 2;
  const widths = [];
  let tw = w;
  for (let l = 0; l < LEVELS; l++) {
    widths.push(tw);
    tw = Math.max(1, Math.ceil(tw / 2));
  }
  const offsets = [];
  let total = 0;
  for (let l = 0; l < LEVELS; l++) {
    offsets.push(total + PAD);
    total += widths[l] + PAD * 2;
  }
  const out = new Uint16Array(total * h * 4);
  let lvl = new Float32Array(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    const a = alpha ? src[i * 4 + 3] / 255 : 1;
    lvl[i * 4] = lut[src[i * 4]] * a;
    lvl[i * 4 + 1] = lut[src[i * 4 + 1]] * a;
    lvl[i * 4 + 2] = lut[src[i * 4 + 2]] * a;
    lvl[i * 4 + 3] = a;
  }
  for (let l = 0; l < LEVELS; l++) {
    const lw = widths[l];
    const ox = offsets[l];
    for (let y = 0; y < h; y++) {
      for (let x = -PAD; x < lw + PAD; x++) {
        let sx = x;
        if (wrap) sx = ((x % lw) + lw) % lw;
        else sx = x < 0 ? 0 : x >= lw ? lw - 1 : x;
        const si = (y * lw + sx) * 4;
        const di = (y * total + ox + x) * 4;
        out[di] = toHalf(lvl[si]);
        out[di + 1] = toHalf(lvl[si + 1]);
        out[di + 2] = toHalf(lvl[si + 2]);
        out[di + 3] = toHalf(lvl[si + 3]);
      }
    }
    if (l + 1 < LEVELS) {
      const nw = widths[l + 1];
      const next = new Float32Array(nw * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < nw; x++) {
          const x0 = x * 2;
          let x1 = x0 + 1;
          if (x1 >= lw) x1 = wrap ? 0 : lw - 1;
          const a = (y * lw + x0) * 4;
          const b = (y * lw + x1) * 4;
          const d = (y * nw + x) * 4;
          next[d] = (lvl[a] + lvl[b]) * 0.5;
          next[d + 1] = (lvl[a + 1] + lvl[b + 1]) * 0.5;
          next[d + 2] = (lvl[a + 2] + lvl[b + 2]) * 0.5;
          next[d + 3] = (lvl[a + 3] + lvl[b + 3]) * 0.5;
        }
      }
      lvl = next;
    }
  }
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, total, h, 0, gl.RGBA, gl.HALF_FLOAT, out);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const lv = new Float32Array(LEVELS * 4);
  for (let l = 0; l < LEVELS; l++) {
    lv[l * 4] = offsets[l];
    lv[l * 4 + 1] = widths[l];
    lv[l * 4 + 2] = total;
  }
  return { tex: t, lv };
}

// The pole sprites as per-row prefix sums (RGBA32F, one run of cellW + 1
// texels per cell, each starting at zero) of premultiplied linear radiance,
// rolled off from 'knee' toward 'ceil' first. Read with texelFetch only: float32 linear
// filtering is optional in WebGL2, and the shader interpolates itself.
function rowSAT(gl, img, { cells, knee, ceil }) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const cw = Math.floor(w / cells);
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const cx = cv.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
  cx.drawImage(img, 0, 0);
  const src = cx.getImageData(0, 0, w, h).data;
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = 2 ** ((i / 255) * (HI - LO) + LO);
  const tw = cells * (cw + 1);
  const out = new Float32Array(tw * h * 4);
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < cells; c++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let d = (y * tw + c * (cw + 1)) * 4;
      // out[d..d+3] stays 0: the run starts at zero
      for (let i = 0; i < cw; i++) {
        const si = (y * w + c * cw + i) * 4;
        const al = src[si + 3] / 255;
        if (al > 0) {
          const R = lut[src[si]];
          const G = lut[src[si + 1]];
          const B = lut[src[si + 2]];
          const l = 0.2126 * R + 0.7152 * G + 0.0722 * B;
          const o = l - knee;
          const k = o > 0 ? (al * (knee + o / (1 + o / (ceil - knee)))) / l : al;
          r += R * k;
          g += G * k;
          b += B * k;
          a += al;
        }
        d += 4;
        out[d] = r;
        out[d + 1] = g;
        out[d + 2] = b;
        out[d + 3] = a;
      }
    }
  }
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, tw, h, 0, gl.RGBA, gl.FLOAT, out);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
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

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];

// Poles stand on a jittered 15 m grid: spacing 11-19 m, never regular.
const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const polePos = (n) => n * POLE_CELL + (hash(n) - 0.5) * POLE_JITTER;
const poleSprite = (n) => Math.floor(hash(n * 3.17 + 9.1) * POLE.n) % POLE.n;

const numParam = (q, k) => {
  const v = q.get(k);
  return v != null && v !== "" && Number.isFinite(+v) ? +v : null;
};

export async function createTrainWindow(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const heldV = numParam(q, "v");
  const startS = numParam(q, "s");
  const held = heldV != null;
  const dbg = numParam(q, "dbg") || 0;
  const still = held || q.get("still") === "1";
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");

  const [skyImg, distImg, hedgeImg, groundImg, polesImg] = await Promise.all(
    ["sky", "distant", "hedge", "ground", "poles"].map((n) => loadImage(`${BASE}${n}.webp`)),
  );
  const sky = imageTexture(gl, skyImg, { wrap: gl.REPEAT });
  // Near the top of the look-up the strip's columns crowd together (yaw runs
  // fast at 70° up), so an isotropic mip would blur the cumulus overhead.
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  if (aniso) {
    const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    gl.bindTexture(gl.TEXTURE_2D, sky);
    gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
  }
  const dist = imageTexture(gl, distImg, { wrap: gl.MIRRORED_REPEAT });
  const ground = hPyramid(gl, groundImg, { wrap: true, alpha: false });
  const hedge = hPyramid(gl, hedgeImg, { wrap: false, alpha: true });
  const poles = rowSAT(gl, polesImg, { cells: POLE.n, ...POLE_TONE });

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

  // Layout, in css px of the box: a 3:2 print, the window.
  const L = { x: 0, y: 0, w: 1, h: 1 };
  let sceneT = null;
  let filmT = null;
  let lineT = null;
  let scale = 1;
  let lastBox = null;
  const layout = (W, H, dpr) => {
    lastBox = [W, H, dpr];
    if (embedded) {
      Object.assign(L, { x: 0, y: 0, w: W, h: H });
    } else if (W / H < 0.9) {
      const side = Math.max(16, Math.round(W * 0.06));
      let w = W - side * 2;
      let h = w * 1.25;
      if (h > H * 0.74) {
        h = H * 0.74;
        w = h / 1.25;
      }
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 - 12 });
    } else {
      const side = Math.max(24, W * 0.07);
      const w = Math.min(W - side * 2, H * 0.76 * 1.5);
      const h = w / 1.5;
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 - 12 });
    }
    L.x = Math.round(L.x * dpr) / dpr;
    L.y = Math.round(L.y * dpr) / dpr;
    L.w = Math.round(L.w * dpr) / dpr;
    L.h = Math.round(L.h * dpr) / dpr;
    L.pw = Math.max(2, Math.round(L.w * dpr));
    L.ph = Math.max(2, Math.round(L.h * dpr));
    L.rw = Math.max(2, Math.round(L.pw * scale));
    L.rh = Math.max(2, Math.round(L.ph * scale));
    freeTarget(gl, sceneT);
    freeTarget(gl, filmT);
    freeTarget(gl, lineT);
    sceneT = target(gl, L.rw, L.rh, floatOk);
    if (!sceneT.ok) {
      freeTarget(gl, sceneT);
      sceneT = target(gl, L.rw, L.rh, false);
    }
    filmT = target(gl, L.rw, L.rh, false);
    lineT = target(gl, L.rw, L.rh, false);
    film.resize(L.rw, L.rh);
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  // The lens: 110° across a landscape print (Panini plane units); a portrait
  // print keeps a little more height and narrows. The horizon sits HORIZON
  // down the print at its centre, so the sky is the picture. On the centre
  // line y = 2·tan(angle / 2) (the stereographic squeeze), so a pure tilt
  // would be 2·atan((HORIZON - 0.5)·vh / 2); the camera pitches by TILT of
  // that, a real look-up whose verticals rush to a vanishing point overhead,
  // and a little rising front makes up the rest. A tall print would pitch
  // past the zenith: it zooms in until its top edge stays under TOP_EL.
  const view = () => {
    const aspect = L.pw / L.ph;
    let vw = PAN_W;
    let vh = vw / aspect;
    if (vh > PAN_W / 1.15) {
      vh = PAN_W / 1.15;
      vw = vh * aspect;
    }
    const at = (k) => {
      const h = vh * k;
      const pitch = TILT * 2 * Math.atan(((HORIZON - 0.5) * h) / 2);
      const y0 = -2 * Math.tan(pitch / 2) - (1 - HORIZON) * h;
      return { pitch, y0, top: pitch + 2 * Math.atan((y0 + h) / 2) };
    };
    let k = 1;
    while (k > 0.3 && at(k).top > (TOP_EL * Math.PI) / 180) k *= 0.98;
    const { pitch, y0 } = at(k);
    return { vw: vw * k, vh: vh * k, pitch, y0 };
  };

  // A Panini-plane point to the level pinhole's image plane, for culling.
  const toPlane = (qx, qy, pitch) => {
    const phi = 2 * Math.atan(qx / 2);
    const rx = Math.sin(phi);
    const qv = (qy * (1 + Math.cos(phi))) / 2;
    const ry = qv / (1 - (qv * qv) / 4);
    const rz = Math.cos(phi);
    const c = Math.cos(pitch);
    const sn = Math.sin(pitch);
    const z = Math.max(1e-3, rz * c - ry * sn);
    return [rx / z, (ry * c + rz * sn) / z];
  };

  // Train state. s in metres along the track, v in m/s (+ = scenery moves
  // left, the train runs to the right of the view).
  let s = startS != null ? startS : polePos(2) + 3;
  let v = held ? clamp(heldV, -V_MAX, V_MAX) : reduce ? 0 : 13;
  let dir = Math.sign(v) || 1;
  let throttle = null; // { x0, v0 } while dragging

  const inPrint = (p) => p.x >= L.x && p.x <= L.x + L.w && p.y >= L.y && p.y <= L.y + L.h;
  stage.on("down", (p) => {
    if (held || !inPrint(p)) return;
    throttle = { x0: p.x, v0: v };
    stage.canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (!throttle) {
      stage.canvas.style.cursor = inPrint(p) && !held ? "grab" : "";
      return;
    }
  });
  stage.on("up", () => {
    throttle = null;
    stage.canvas.style.cursor = "";
  });

  // Keyboard: arrows nudge the throttle the way a drag would.
  host.tabIndex = embedded ? -1 : 0;
  let keyDir = 0;
  const onKeyDown = (e) => {
    if (e.key === "ArrowLeft") keyDir = 1;
    else if (e.key === "ArrowRight") keyDir = -1;
    else return;
    e.preventDefault();
  };
  const onKeyUp = (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") keyDir = 0;
  };
  host.addEventListener("keydown", onKeyDown);
  host.addEventListener("keyup", onKeyUp);

  let time = 0;
  let t0 = -1;
  let grainClock = 0;
  let grainSeed = 0;
  const poleBuf = new Float32Array(8 * 4);

  const draw = (expoStops, fade, bob) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    const { vw, vh, pitch: p0, y0 } = view();
    const pitch = p0 + bob;
    const x0 = -vw / 2;

    // Poles that could touch the print this frame (with the shutter smear):
    // the print is widest, in the image plane, along its top edge.
    let xl = Infinity;
    let xr = -Infinity;
    for (const [qx, qy] of [
      [x0, y0],
      [x0, y0 + vh / 2],
      [x0, y0 + vh],
      [-x0, y0],
      [-x0, y0 + vh / 2],
      [-x0, y0 + vh],
    ]) {
      const [px] = toPlane(qx, qy, pitch);
      xl = Math.min(xl, px);
      xr = Math.max(xr, px);
    }
    const sL = s + (xl - 0.25) * D_POLE;
    const sR = s + (xr + 0.25) * D_POLE;
    let n0 = Math.floor(sL / POLE_CELL) - 1;
    while (polePos(n0 + 1) < sL) n0++;
    let count = 0;
    for (let n = n0; count < 8; n++) {
      const pos = polePos(n);
      const sp = poleSprite(n);
      poleBuf[count * 4] = pos;
      poleBuf[count * 4 + 1] = sp;
      poleBuf[count * 4 + 2] = POLE.rot[sp] > 0 ? 1 : -1;
      poleBuf[count * 4 + 3] = 0;
      count++;
      if (pos > sR) break;
    }

    const u = scene.u;
    gl.useProgram(scene.p);
    const bind = (unit, tex, name) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(u[name], unit);
    };
    bind(0, sky, "uSky");
    bind(1, dist, "uDist");
    bind(2, ground.tex, "uGround");
    bind(3, hedge.tex, "uHedge");
    bind(4, poles, "uPoles");
    gl.uniform4fv(u.uGroundLv, ground.lv);
    gl.uniform4fv(u.uHedgeLv, hedge.lv);
    gl.uniform4f(u.uView, x0, y0, vw, vh);
    gl.uniform2f(u.uPitch, Math.cos(pitch), Math.sin(pitch));
    gl.uniform1f(u.uS, s);
    gl.uniform1f(u.uV, v);
    gl.uniform1f(u.uShutter, SHUTTER);
    gl.uniform1f(u.uSkyDrift, reduce || still ? 0 : time * 0.04);
    gl.uniform1f(u.uExpo, 1.15 * 2 ** expoStops);
    gl.uniform1f(u.uGrad, 0.35);
    gl.uniform1f(u.uPol, 0.85);
    gl.uniform4f(u.uSkyPush, SKY_GRADE.push, SKY_GRADE.form, SKY_GRADE.relief, SKY_GRADE.warm);
    gl.uniform3fv(u.uSkyWarm, SKY_GRADE.tint);
    gl.uniform1f(u.uSkyTop, SKY_GRADE.top);
    gl.uniform4fv(u.uPole, poleBuf);
    gl.uniform1i(u.uPoleN, count);
    gl.uniform1i(u.uDbg, dbg);
    gl.uniform3f(u.uHalo, 0.34, 0.12, 0.035);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, L.rw, L.rh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const stock = {
      ...FILM_PRESETS.summer,
      input: floatOk && sceneT.ok ? "linear" : "srgb",
      whitePoint: 2.2,
      halation: 0.22,
      halationColor: [1, 0.42, 0.18],
      grainSeed,
    };
    film.render(sceneT.tex, stock, filmT.fbo);
    // The pole is the one sharp thing in the print: the same frame developed
    // again with no Pro-Mist veil, no film halation (the scene draws its own
    // edge ring) and little optical softness, used wherever the pole or a
    // conductor covers the pixel. Its only blur is the shutter's smear.
    film.render(sceneT.tex, { ...stock, bloom: 0, halation: 0, softness: 0.12 }, lineT.fbo);

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
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lineT.tex);
    gl.uniform1i(blit.u.uLine, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, sceneT.tex);
    gl.uniform1i(blit.u.uMask, 2);
    gl.uniform1f(blit.u.uFade, fade);
    gl.uniform3fv(blit.u.uPaper, PAPER);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // Reveal: the print comes up overexposed, a white-blue summer glare, and
  // settles over two seconds while the train is already rolling.
  const REVEAL = 2.0;
  let slow = 0;
  let lastNow = 0;
  let phase = 0;
  let drawnFor = null;
  stage.onFrame((dt) => {
    if (!sceneT) return;
    // A held still renders once per layout and then rests (headless GL is slow).
    if (still && drawnFor === sceneT) return;
    const now = performance.now();
    const real = lastNow ? (now - lastNow) / 1000 : 1 / 60;
    lastNow = now;
    if (!still) {
      const r = Math.min(real, 0.25);
      slow = real > 1 / 40 ? slow + r : Math.max(0, slow - r * 0.5);
      if (slow > 1.2 && scale > 0.5) {
        scale = scale > 0.8 ? 0.75 : 0.5;
        slow = 0;
        if (lastBox) layout(...lastBox);
      }
    }
    time += dt;
    if (t0 < 0) t0 = time;
    const age = still ? 99 : time - t0;
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 2.5 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
    }

    if (!held) {
      if (throttle) {
        // Drag offset sets the speed: a third of the print is full speed.
        const dx = stage.pointer.x - throttle.x0;
        const goal = clamp(throttle.v0 - (dx / (L.w * 0.34)) * V_MAX, -V_MAX, V_MAX);
        v += (goal - v) * (1 - Math.exp(-dt / 0.35));
        if (Math.abs(v) > 0.3) dir = Math.sign(v);
      } else if (keyDir) {
        v = clamp(v + keyDir * 14 * dt, -V_MAX, V_MAX);
        if (Math.abs(v) > 0.3) dir = Math.sign(v);
      } else {
        // Coasting: a train sheds speed slowly, down to a crawl.
        const goal = reduce ? 0 : dir * V_CRUISE;
        v += (goal - v) * (1 - Math.exp(-dt / 2.8));
      }
      s += v * dt;
    }
    phase += Math.abs(v) * dt;

    // Grain at 24 fps.
    if (!reduce && !still) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        grainSeed = (grainSeed + 1) % 997;
      }
    }
    // The carriage rides the rail joints: a soft vertical bob that grows with
    // speed, plus a slow breath.
    const sp = clamp(Math.abs(v) / V_MAX, 0, 1);
    const bob =
      reduce || still
        ? 0
        : sp * 0.0016 * Math.sin(phase * 0.42) + sp * sp * 0.0007 * Math.sin(phase * 1.31 + 1.7) + 0.0006 * Math.sin((time * 2 * Math.PI) / 11);
    draw(expo, fade, bob);
    drawnFor = sceneT;
  });

  return {
    destroy() {
      host.removeEventListener("keydown", onKeyDown);
      host.removeEventListener("keyup", onKeyUp);
      film.destroy();
      freeTarget(gl, sceneT);
      freeTarget(gl, filmT);
      freeTarget(gl, lineT);
      for (const t of [sky, dist, ground.tex, hedge.tex, poles]) gl.deleteTexture(t);
      gl.deleteProgram(scene.p);
      gl.deleteProgram(blit.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
