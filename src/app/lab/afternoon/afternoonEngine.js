import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Afternoon: one photograph of a Tokyo intersection, shot straight up past the
// signal gantry into the sky, taken apart into material maps and lit again by
// a sun you move through the afternoon.
//
// The bake (tools/depth/bakes/afternoon/bake.py) turns Patrick Beznoska's
// photograph into:
//  - depth: metres, from MoGe-2's metric point map (camera pitched 29 degrees
//    up, 71 degree lens; up from the vanishing point of the plumb building
//    edges and the pole);
//  - normals: MoGe-2's, with the walls snapped to their two azimuths around
//    that up;
//  - albedo: the de-graded photo divided by the shading the model gives under
//    the photo's own sun (fitted to the walls: low, from the left, ~16:30 on
//    the engine's early-February clock), so photo = albedo x shading there;
//  - the sun mask of that light, a sky and cloud matte, and a thickness per
//    occluder.
//
// Live: Lambert sun + hemispheric sky about the true up (with a little
// circumsolar lean and ground bounce), the sun's colour and strength from air
// mass, cast shadows by marching each pixel's ray toward the sun through the
// depth in screen space plus exact capsules for the pole, its lamp and the
// mast arm. The sky is drawn by a small analytic model (a cyan-cobalt zenith
// that holds its hue at every sun, lightening to a pale cobalt at the roofs, a
// warm band laid on only in the sun's azimuth once it is low, a circumsolar
// glow); the cloud keeps the photo's drawing and is graded white on its sunlit
// side and skylight blue in its shade. The buildings are the photograph at
// the photo's sun.
//
// Query: ?sun=0..1 holds the sun (0 = 12:30, 1 = 17:00, the last light; the
// photo is 0.424, 14:25);
// ?t=seconds freezes the grain; ?still=1 skips the reveal; ?film=0 shows the
// relit frame before the film (for checking against the photo); ?debug=vis
// shows the cast-shadow buffer, ?debug=light the sun term.

const BASE = "/lab/afternoon/";
const PW = 2400;
const PH = 1600;
// Camera (plate pixels, y down): focal, principal point. From the bake's meta.
const CAM = [1690.85, 1199.5, 799.3];
// True up in camera space (x right, y up, z forward): the plumb edges' zenith.
const UP = [-0.07068, 0.86894, 0.48984];
const CAM_H = 1.5;
// Light model, same constants as tools/depth/bakes/afternoon/light.json.
const LAT = 35.7;
// Early February (the photo went up on the 5th): a low winter sun.
const DECL = -16;
const HEADING = 304.0;
const T0 = 14.41;
const T_START = 12.5;
const T_SPAN = 4.5;
const TAU = [0.07, 0.15, 0.3];
const SUN_K = 1.2;
const SKY_NOON = [0.17, 0.22, 0.3];
const SKY_WARM = [0.12, 0.02, -0.1];
const BOUNCE = 0.18;
const GRADE_LO = [0.0, 0.07, 0.07];
const GRADE_HI = [0.86, 0.88, 0.9];
const PHOTO_EXPO = 1.6;
// The drawn sky, in print sRGB before the film: overhead and at the roofline,
// each hue (deg), saturation, value under a high sun, value at the last light.
// Set so they come out of the film at about 210 deg / 0.8 / 0.5 overhead and
// a pale cobalt at the roofs.
const SKY_ZEN = [211, 0.8, 0.55, 0.5];
const SKY_HOR = [207, 0.44, 0.87, 0.85];
const SKY_CURVE = 1.7;
const SKY_WARMC = [1.0, 0.92, 0.8];
const SKY_WARM_AMT = 1.0;
const S_PHOTO = (T0 - T_START) / T_SPAN;
const S_OPEN = 0.86;

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return a.map((v) => v / l);
};
const FWD = norm([-UP[0] * UP[2], -UP[1] * UP[2], 1 - UP[2] * UP[2]]);
const RIGHT = cross(UP, FWD);

// Thin occluders the depth only knows to about their own width: the utility
// pole (ground to its 12 m top), its lamp arm, and the signal mast arm out
// over the road. Camera-space metres from the bake's MoGe points, each a
// capsule [ax, ay, az, bx, by, bz, radius]; the pole and arm are extended
// past the frame to where they really end.
const height = (p) => p[0] * UP[0] + p[1] * UP[1] + p[2] * UP[2] + CAM_H;
const extend = (a, b, h0, h1) => {
  const ha = height(a);
  const hb = height(b);
  const at = (h) => a.map((v, i) => v + ((b[i] - v) * (h - ha)) / (hb - ha));
  return [...at(h0), ...at(h1)];
};
const along = (a, b, t0, t1) => [...a.map((v, i) => v + (b[i] - v) * t0), ...a.map((v, i) => v + (b[i] - v) * t1)];
const CAPS = [
  [...extend([5.372, 0.317, 13.628], [7.147, -5.951, 13.228], 0, 12), 0.16],
  [...along([6.309, -2.772, 13.756], [5.972, -1.907, 14.477], -0.2, 1.1), 0.05],
  [...along([-3.575, 2.448, 5.599], [-1.665, 1.071, 7.832], -1.6, 1.5), 0.1],
];
const OCC_FLAT = new Float32Array(CAPS.flatMap((c) => [c[0], c[1], c[2], c[6], c[3], c[4], c[5], 0]));

const LUMA = [0.2126, 0.7152, 0.0722];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const rad = (d) => (d * Math.PI) / 180;

// Solar position for local solar time t (hours), as a direction in camera
// space (through the true up and the camera's heading), plus sun and sky
// irradiance colours.
function sunAt(t) {
  const lat = rad(LAT);
  const dec = rad(DECL);
  const h = rad(15 * (t - 12));
  const se = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h);
  const el = Math.asin(se);
  const az = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) + Math.PI;
  const rel = az - rad(HEADING);
  const Lw = [Math.sin(rel) * Math.cos(el), Math.sin(el), Math.cos(rel) * Math.cos(el)];
  const L = [0, 1, 2].map((i) => RIGHT[i] * Lw[0] + UP[i] * Lw[1] + FWD[i] * Lw[2]);
  const deg = (el * 180) / Math.PI;
  const m = 1 / (Math.sin(el) + 0.50572 * Math.pow(deg + 6.07995, -1.6364));
  const sun = TAU.map((k) => SUN_K * Math.exp(-k * m));
  const warm = clamp(1 - deg / 35, 0, 1);
  const g = 0.2 + 0.8 * Math.sqrt(Math.max(se, 0));
  const sky = SKY_NOON.map((v, i) => v * g * (1 + warm * SKY_WARM[i]));
  // How far past the photo's sun (28 degrees) toward the last light (4).
  const late = clamp((28 - deg) / 24, 0, 1);
  // The fill the shadows get. The bake's sky is fitted to the photo and stays
  // exact there; as the sun drops the shade loses fill against the direct
  // light and goes to the blue of the open dome, so the long shadows come up
  // nearer two stops than one and cool, while the sunlit faces take the gold.
  const cool = late * late;
  const fill = sky.map((v, i) => (v / (1 + warm * SKY_WARM[i])) * (1 - 0.45 * cool) * (1 + cool * [-0.18, -0.02, 0.3][i]));
  return { L, sun, sky, fill, el: deg, warm, late };
}

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMMON = `
uniform vec2 uPlate;
uniform vec3 uCam;   // f, cx, cy
uniform vec4 uView;  // plate window x0, y0, w, h (pixels, y down)
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const vec3 UP = vec3(${UP.map((v) => v.toFixed(5)).join(", ")});
vec2 platePx(vec2 uv) { return uView.xy + vec2(uv.x, 1.0 - uv.y) * uView.zw; }
vec3 viewPos(vec2 px, float Z) { return Z * vec3((px.x - uCam.y) / uCam.x, (uCam.z - px.y) / uCam.x, 1.0); }
vec2 proj(vec3 P) { return vec2(uCam.y + uCam.x * P.x / P.z, uCam.z - uCam.x * P.y / P.z); }
vec3 octDec(vec2 e) {
  e = e * 2.0 - 1.0;
  vec3 n = vec3(e, 1.0 - abs(e.x) - abs(e.y));
  if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  return normalize(n);
}
`;

// Cast shadows: march toward the sun through the depth, in screen space.
const VIS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uDep;   // RG16F: metres, photo sun mask
uniform sampler2D uNrm;   // oct normal, thickness
uniform vec3 uL;
uniform float uCone;
uniform float uSeed;
${COMMON}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  vec2 px = platePx(vUv);
  vec2 t = px / uPlate;
  float Z = texture(uDep, t).r;
  if (Z > 3000.0) { outColor = vec4(1.0); return; }
  vec3 N = octDec(texture(uNrm, t).xy);
  if (dot(N, uL) <= 0.0) { outColor = vec4(1.0); return; }
  vec3 P = viewPos(px, Z) + N * (0.04 + 0.003 * Z);
  float j = ign(gl_FragCoord.xy + uSeed * 5.588238);
  float j2 = ign(gl_FragCoord.yx * 1.37 + 11.0 + uSeed);
  // The sun is a disc, and the air spreads it: jitter inside a small cone.
  vec3 T = normalize(cross(uL, vec3(0.0, 0.0, 1.0)));
  vec3 B = cross(uL, T);
  float a = 6.2831853 * j2;
  vec3 Ld = normalize(uL + uCone * sqrt(j) * (T * cos(a) + B * sin(a)));
  // Long enough to clear the tallest roofs (40 m), never through the lens.
  float tmax = min(420.0, (40.0 - (dot(P, UP) + ${CAM_H.toFixed(2)})) / max(dot(Ld, UP), 0.02));
  if (Ld.z < 0.0) tmax = min(tmax, (P.z - 1.5) / -Ld.z);
  if (tmax <= 0.05) { outColor = vec4(1.0); return; }
  vec3 Q = P + Ld * tmax;
  vec2 s0 = proj(P);
  vec2 s1 = proj(Q);
  float iz0 = 1.0 / P.z;
  float iz1 = 1.0 / Q.z;
  // Clip the projected ray to the plate. Inverse depth is linear in screen
  // space along the segment, so the clipped end stays exact.
  vec2 dv = s1 - s0;
  vec2 lim = vec2(dv.x > 0.0 ? (uPlate.x - s0.x) / dv.x : dv.x < 0.0 ? -s0.x / dv.x : 1e9,
                  dv.y > 0.0 ? (uPlate.y - s0.y) / dv.y : dv.y < 0.0 ? -s0.y / dv.y : 1e9);
  float uc = clamp(min(lim.x, lim.y), 0.0, 1.0);
  s1 = s0 + dv * uc;
  iz1 = mix(iz0, iz1, uc);
  float len = length(s1 - s0);
  float n = clamp(len / 4.0, 6.0, 140.0);
  float occ = 0.0;
  for (int i = 0; i < 140; i++) {
    float fi = float(i);
    if (fi >= n) break;
    // Steps bunch up near the surface, where contact shadows live.
    float u = pow((fi + j) / n, 1.35);
    vec2 s = mix(s0, s1, u);
    if (s.x < 0.0 || s.y < 0.0 || s.x > uPlate.x || s.y > uPlate.y) break;
    float rz = 1.0 / mix(iz0, iz1, u);
    vec2 st = s / uPlate;
    float sz = textureLod(uDep, st, 0.0).r;
    if (sz > 3000.0) continue;
    float d = rz - sz;
    // MoGe walls are smooth to a few centimetres, but an occluder must still
    // stand clear of the receiver, or a wall would shadow itself; thin
    // occluders (signals, the sign, wires) are taken as solid a little in
    // front of their surface too, since their depth is only good to about
    // their own width.
    float bias = 0.1 + 0.006 * rz;
    if (d > -0.6 && length(s - s0) > 10.0) {
      float th = exp2(textureLod(uNrm, st, 0.0).b * 6.0 - 2.0);
      float lo = th < 2.0 && abs(sz - P.z) > 1.5 ? -0.4 * th : 0.3 + 0.008 * rz;
      if (d > lo && d < th + bias) { occ = 1.0; break; }
    }
  }
  outColor = vec4(vec3(1.0 - occ), 1.0);
}`;

// Depth-aware blur of the visibility (two separable passes).
const BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uVis;
uniform sampler2D uDep;
uniform vec2 uDir;      // texel step in the vis target
${COMMON}
void main() {
  float zc = log2(texture(uDep, platePx(vUv) / uPlate).r);
  float acc = 0.0;
  float wsum = 0.0;
  for (int i = -4; i <= 4; i++) {
    vec2 uv = vUv + uDir * float(i);
    float z = log2(texture(uDep, platePx(uv) / uPlate).r);
    float dz = (z - zc) / 0.08;
    float w = exp(-float(i * i) / 5.0) * exp(-dz * dz);
    acc += texture(uVis, uv).r * w;
    wsum += w;
  }
  outColor = vec4(vec3(acc / wsum), 1.0);
}`;

const SHADE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uAlb;
uniform sampler2D uNrm;
uniform sampler2D uDep;
uniform sampler2D uMat;
uniform sampler2D uVis;
uniform vec3 uL;
uniform vec3 uSun;
uniform vec3 uSky;
uniform float uEl;
uniform float uW0;       // hand-over to the photo's own shadows near its sun
uniform float uExpo;
uniform float uStops;    // the reveal's push alone
uniform vec4 uZen;       // sky overhead: hue (deg), saturation, value high sun, value last light
uniform vec4 uHor;       // sky at the roofline, the same
uniform float uSkyCurve; // how low the lightening sits
uniform vec3 uWarmC;     // the warm white the band ramps to
uniform float uWarmAmt;
uniform vec3 uLo;
uniform vec3 uHi;
uniform float uDebug;
uniform vec4 uOcc[${CAPS.length * 2}];
${COMMON}
vec3 s2l(vec3 c) { c = max(c, 0.0); return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 l2s(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

vec3 shading(vec3 N, float vis) {
  float ndl = max(dot(N, uL), 0.0);
  float ny = dot(N, UP);
  vec3 Lh = normalize(uL - dot(uL, UP) * UP + 1e-5);
  float circ = 1.0 + 0.35 * max(dot(N, Lh), 0.0);
  vec3 horiz = uSun * dot(uL, UP) + uSky;
  return uSun * vis * ndl + uSky * (0.5 + 0.5 * ny) * circ + ${BOUNCE.toFixed(3)} * horiz * (0.5 - 0.5 * ny);
}

// Hard-edged thin occluders: the closest approach of the ray to the sun to
// each capsule, against its radius, softened by the sun's own disc (half a
// degree) so the shadow sharpens at the foot and blurs toward its tip.
float poleVis(vec3 P, vec2 px) {
  float v = 1.0;
  for (int i = 0; i < ${CAPS.length}; i++) {
    vec3 A = uOcc[2 * i].xyz;
    float r = uOcc[2 * i].w;
    vec3 B = uOcc[2 * i + 1].xyz;
    vec3 E = B - A;
    // a pixel on (or right beside) the occluder itself is not its receiver
    if (A.z > 0.5 && B.z > 0.5) {
      vec2 a = proj(A);
      vec2 e = proj(B) - a;
      float h = clamp(dot(px - a, e) / max(dot(e, e), 1e-4), 0.0, 1.0);
      if (length(px - a - e * h) < r * uCam.x / mix(A.z, B.z, h) + 5.0) continue;
    }
    vec3 w0 = P - A;
    float b = dot(uL, E);
    float c = dot(E, E);
    float d = dot(uL, w0);
    float e2 = dot(E, w0);
    float den = c - b * b;
    float u = den > 1e-5 ? clamp((e2 - b * d) / den, 0.0, 1.0) : 0.0;
    float t = max(dot(A + E * u - P, uL), 0.0);
    u = clamp(dot(P + uL * t - A, E) / c, 0.0, 1.0);
    t = max(dot(A + E * u - P, uL), 0.0);
    if (t < 0.3) continue;
    float dist = length(P + uL * t - A - E * u);
    float pen = 0.03 + 0.0042 * t;
    float occ = clamp((r + pen - dist) / (2.0 * pen), 0.0, 1.0) * min(1.0, r / pen);
    v *= 1.0 - occ;
  }
  return v;
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// The clear sky, as it should print (sRGB, before the film). The scan's own
// sky is a flat teal that no ratio can turn into a winter sky, so the sky is
// drawn here outright and only the cloud keeps the photo's drawing.
// Overhead it holds a deep cyan-cobalt at every sun (the hue does not drift,
// only the value deepens a little as the sun drops); down toward the roofs it
// lightens and opens to a pale cobalt, never to grey. The warm band is a
// separate term, laid on only in the sun's azimuth and only low, and only
// once the sun is low: it ramps the pale cobalt to a warm white, so the side
// away from the sun stays blue. Then a soft glow round the sun.
vec3 skyTarget(vec3 vd, vec3 L, float el) {
  float h = clamp(dot(vd, UP), 0.0, 1.0);
  float low = 1.0 - smoothstep(3.0, 40.0, el);
  // 0 at the roofline (about 8 degrees up), 1 at the top of the frame (55)
  float tz = clamp((h - 0.14) / 0.68, 0.0, 1.0);
  float hz = pow(1.0 - tz, uSkyCurve);
  vec3 zen = vec3(uZen.x / 360.0, uZen.y, mix(uZen.z, uZen.w, low));
  vec3 hor = vec3(uHor.x / 360.0, uHor.y, mix(uHor.z, uHor.w, low));
  vec3 c = hsv2rgb(mix(zen, hor, hz));
  vec3 vh = normalize(vd - dot(vd, UP) * UP + 1e-5);
  vec3 lh = normalize(L - dot(L, UP) * UP + 1e-5);
  float az = smoothstep(0.2, 1.0, dot(vh, lh));
  az *= az;
  float band = pow(1.0 - tz, 5.0);
  c += uWarmAmt * low * low * az * band * (uWarmC - c);
  float cg = dot(vd, L);
  c += vec3(0.10, 0.08, 0.05) * (0.25 + 0.75 * low) * exp((cg - 1.0) / 0.2);
  return c;
}

void main() {
  vec2 px = platePx(vUv);
  vec2 t = px / uPlate;
  vec3 base = s2l(texture(uAlb, t).rgb);
  vec4 mt = textureLod(uMat, t, 0.0);
  vec2 dz = texture(uDep, t).rg;
  float Z = dz.r;
  vec3 N = octDec(texture(uNrm, t).xy);
  float vis = mix(texture(uVis, vUv).r, dz.g, uW0);
  vec3 P = viewPos(px, Z);
  float pv = Z < 3500.0 && dot(N, uL) > 0.0 ? mix(poleVis(P, px), 1.0, uW0) : 1.0;
  vec3 surf = base * ${PHOTO_EXPO.toFixed(3)} * shading(N, vis * pv);

  // Sky, drawn as it should print.
  vec3 vd = normalize(vec3((px.x - uCam.y) / uCam.x, (uCam.z - px.y) / uCam.x, 1.0));
  vec3 clear = skyTarget(vd, uL, uEl);
  // The cloud keeps the photo's drawing (its own light, normalised to its
  // white) and takes the colour of what lights it: the face toward the sun a
  // white that warms only a little as the sun drops, the rest the pale blue
  // of the sky that fills it. Both stay under paper white, so the sunlit edge
  // rolls off instead of clipping, and nothing in it goes orange.
  float cy = smoothstep(0.78, 0.96, l2s(vec3(dot(base, LUMA))).r);
  vec2 tx = vec2(1.0 / uPlate.x, 1.0 / uPlate.y);
  // toward the sun on the plate: a pixel with less cloud that way is a face it reaches
  vec2 sdir = normalize(proj(vd * 10.0 + uL) - proj(vd * 10.0) + 1e-5);
  float gSun = textureLod(uMat, t + sdir * 20.0 * tx, 2.0).g;
  float gAway = textureLod(uMat, t - sdir * 20.0 * tx, 2.0).g;
  float lit = clamp(0.45 + (gAway - gSun) * 1.2 + (cy - 0.5) * 0.5, 0.0, 1.0);
  float low = 1.0 - smoothstep(3.0, 40.0, uEl);
  vec3 cloudLit = mix(vec3(0.91, 0.92, 0.93), vec3(0.95, 0.9, 0.83), low);
  vec3 cloudShade = hsv2rgb(vec3(212.0 / 360.0, mix(0.26, 0.34, low), mix(0.74, 0.66, low)));
  vec3 cloud = mix(cloudShade, cloudLit, smoothstep(0.0, 1.0, lit));
  // a soft matte (a little wider than the photo's), so the edge is the
  // cloud thinning out, not a cut
  float ca = smoothstep(0.03, 0.9, textureLod(uMat, t, 1.8).g);
  vec3 skyS = mix(clear, cloud, ca);
  // back through the scan grade below, so the sky lands where it was drawn;
  // the reveal's push lifts it with everything else
  vec3 sky = s2l((skyS - uLo) / (uHi - uLo)) * uStops;

  vec3 col = mix(surf * uExpo, sky, mt.r);
  if (uDebug > 0.5) col = vec3(vis * pv * max(dot(N, uL), 0.0)) * (1.0 - mt.r) * 0.6;
  // Back through the photo's own scan grade (lifted black; rolled white),
  // unclamped above white so the film's shoulder gets the highlights.
  vec3 s = uLo + (uHi - uLo) * l2s(col);
  outColor = vec4(s2l(s) + max(s - 1.0, 0.0) * 2.4, 1.0);
}`;

const BLIT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uFade;
uniform vec3 uPaper;
uniform float uRaw;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  if (uRaw > 0.5) c = mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
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

function texParams(gl, mips, nearest = false) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function imageTexture(gl, img, mips) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  texParams(gl, mips);
  return t;
}

// depth.png holds log2(metres)/12 in 16 bits (R hi, G lo) and the photo's
// sun-shadow mask in B. Decode once into a filterable RG16F texture.
function depthTexture(gl, img) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const cx = c.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
  cx.drawImage(img, 0, 0);
  const src = cx.getImageData(0, 0, img.width, img.height).data;
  const n = img.width * img.height;
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const q = (src[i * 4] * 256 + src[i * 4 + 1]) / 65535;
    out[i * 2] = Math.pow(2, q * 12);
    out[i * 2 + 1] = src[i * 4 + 2] / 255;
  }
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, img.width, img.height, 0, gl.RG, gl.FLOAT, out);
  texParams(gl, false);
  return t;
}

function target(gl, w, h, float) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  texParams(gl, false);
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
const num = (q, k) => {
  const v = q.get(k);
  return v != null && v !== "" && Number.isFinite(+v) ? +v : null;
};

export async function createAfternoon(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const sunQ = num(q, "sun");
  const timeQ = num(q, "t");
  const held = sunQ != null;
  const frozen = timeQ != null;
  const still = held || q.get("still") === "1";
  const debugVis = q.get("debug") === "vis";
  const debugLight = q.get("debug") === "light";
  const raw = q.get("film") === "0" || debugVis;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");

  const [albImg, nrmImg, depImg, matImg] = await Promise.all(["albedo.webp", "normal.png", "depth.png", "matte.png"].map((f) => loadImage(BASE + f)));
  const alb = imageTexture(gl, albImg, true);
  const nrm = imageTexture(gl, nrmImg, false);
  const mat = imageTexture(gl, matImg, true);
  const dep = depthTexture(gl, depImg);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const P = {
    vis: program(gl, VERT, VIS),
    blur: program(gl, VERT, BLUR),
    shade: program(gl, VERT, SHADE),
    blit: program(gl, VERT, BLIT),
  };
  const film = createFilm(gl, { width: 2, height: 2 });

  const L = { x: 0, y: 0, w: 1, h: 1 };
  const T = { scene: null, film: null, vis: null, visB: null };
  let scale = 1;
  let lastBox = null;
  let visDirty = true;
  let dirty = true;
  const layout = (W, H, dpr) => {
    lastBox = [W, H, dpr];
    const ar = PW / PH;
    if (embedded) {
      Object.assign(L, { x: 0, y: 0, w: W, h: H });
    } else if (W / H < 0.9) {
      const side = Math.max(16, Math.round(W * 0.06));
      const w = W - side * 2;
      const h = w / ar;
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 - 12 });
    } else {
      const side = Math.max(24, W * 0.07);
      const w = Math.min(W - side * 2, H * 0.78 * ar);
      const h = w / ar;
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 - 12 });
    }
    L.x = Math.round(L.x * dpr) / dpr;
    L.y = Math.round(L.y * dpr) / dpr;
    L.pw = Math.max(2, Math.round(L.w * dpr));
    L.ph = Math.max(2, Math.round(L.h * dpr));
    L.rw = Math.max(2, Math.round(L.pw * scale));
    L.rh = Math.max(2, Math.round(L.ph * scale));
    L.vw = Math.max(2, Math.round(L.rw / 2));
    L.vh = Math.max(2, Math.round(L.rh / 2));
    Object.values(T).forEach((t) => freeTarget(gl, t));
    T.scene = target(gl, L.rw, L.rh, floatOk);
    if (!T.scene.ok) {
      freeTarget(gl, T.scene);
      T.scene = target(gl, L.rw, L.rh, false);
    }
    T.film = target(gl, L.rw, L.rh, false);
    T.vis = target(gl, L.vw, L.vh, false);
    T.visB = target(gl, L.vw, L.vh, false);
    film.resize(L.rw, L.rh);
    visDirty = true;
    dirty = true;
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  // The plate window: the whole photograph (the print is cut to its 3:2).
  const VIEW = [0, 0, PW, PH];
  const common = (prog) => {
    gl.uniform2f(prog.u.uPlate, PW, PH);
    gl.uniform3f(prog.u.uCam, CAM[0], CAM[1], CAM[2]);
    gl.uniform4f(prog.u.uView, VIEW[0], VIEW[1], VIEW[2], VIEW[3]);
  };
  const bindTex = (unit, tex, loc) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  };
  const to = (t) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
  };

  const photo = sunAt(T0);
  // Horizontal irradiance: what a light meter pointed at the sky would read.
  const lumH = (s) => dot3(s.sun, LUMA) * Math.max(dot3(s.L, UP), 0) + dot3(s.fill, LUMA);

  // Sun: the drag sets a goal; what you see follows on a spring.
  let goal = held ? clamp(sunQ, 0, 1) : S_PHOTO;
  let sunS = goal;
  let sunV = 0;
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
    // rubber band past the ends of the afternoon
    const band = (o) => 0.08 * (1 - Math.exp((-0.4 * o) / 0.08));
    if (g < 0) g = -band(-g);
    if (g > 1) g = 1 + band(g - 1);
    goal = g;
  });
  stage.on("up", (p) => {
    if (!dragging) return;
    dragging = false;
    delete host.dataset.dragging;
    goalV = clamp(p.vx / L.w, -3, 3);
  });

  host.tabIndex = embedded ? -1 : 0;
  const onKey = (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    touched = true;
    goal = clamp(goal + d * (e.shiftKey ? 0.1 : 0.03), 0, 1);
  };
  host.addEventListener("keydown", onKey);

  let t0 = -1;
  let grainClock = 0;
  let lastVisS = -1;

  const draw = (expoStops, fade) => {
    const s = clamp(sunS, -0.03, 1.03);
    const sun = sunAt(T_START + s * T_SPAN);
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.DEPTH_TEST);

    // 1. Cast shadows (only when the sun moved).
    if (visDirty || Math.abs(s - lastVisS) > 1e-5) {
      lastVisS = s;
      visDirty = false;
      gl.useProgram(P.vis.p);
      common(P.vis);
      bindTex(0, dep, P.vis.u.uDep);
      bindTex(1, nrm, P.vis.u.uNrm);
      gl.uniform3fv(P.vis.u.uL, sun.L);
      gl.uniform1f(P.vis.u.uCone, 0.016);
      gl.uniform1f(P.vis.u.uSeed, 0);
      to(T.vis);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.useProgram(P.blur.p);
      common(P.blur);
      bindTex(1, dep, P.blur.u.uDep);
      bindTex(0, T.vis.tex, P.blur.u.uVis);
      gl.uniform2f(P.blur.u.uDir, 1 / L.vw, 0);
      to(T.visB);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      bindTex(0, T.visB.tex, P.blur.u.uVis);
      gl.uniform2f(P.blur.u.uDir, 0, 1 / L.vh);
      to(T.vis);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // 2. Light the material maps.
    const u = P.shade.u;
    gl.useProgram(P.shade.p);
    common(P.shade);
    bindTex(0, alb, u.uAlb);
    bindTex(1, nrm, u.uNrm);
    bindTex(2, dep, u.uDep);
    bindTex(3, mat, u.uMat);
    bindTex(4, T.vis.tex, u.uVis);
    gl.uniform3fv(u.uL, sun.L);
    gl.uniform3fv(u.uSun, sun.sun);
    gl.uniform3fv(u.uSky, sun.fill);
    const ang = Math.acos(clamp(dot3(sun.L, photo.L), -1, 1));
    gl.uniform1f(u.uW0, Math.exp(-((ang / 0.09) ** 2)));
    // Exposure follows the light a third of the way, as a photographer would
    // who wants the late light to look late.
    const expo = Math.pow(lumH(photo) / lumH(sun), 0.35);
    gl.uniform1f(u.uExpo, expo * 2 ** expoStops);
    gl.uniform1f(u.uStops, 2 ** expoStops);
    gl.uniform1f(u.uEl, sun.el);
    gl.uniform4fv(u.uZen, SKY_ZEN);
    gl.uniform4fv(u.uHor, SKY_HOR);
    gl.uniform1f(u.uSkyCurve, SKY_CURVE);
    gl.uniform3fv(u.uWarmC, SKY_WARMC);
    gl.uniform1f(u.uWarmAmt, SKY_WARM_AMT);
    gl.uniform4fv(u["uOcc[0]"], OCC_FLAT);
    gl.uniform3fv(u.uLo, GRADE_LO);
    gl.uniform3fv(u.uHi, GRADE_HI);
    gl.uniform1f(u.uDebug, debugLight ? 1 : 0);
    to(T.scene);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3. Develop.
    const linear = floatOk && T.scene.ok;
    if (!raw) {
      film.render(
        T.scene.tex,
        {
          ...FILM_PRESETS.summer,
          // The scan already carries its grade; the film adds the optics.
          // and late, the low sun's harder light: a touch more contrast, the
          // shade cooler and the sunlit side warmer.
          contrast: 1.08 + 0.1 * sun.late,
          toe: 0.0,
          saturation: 1.04,
          blueDepth: 0.35,
          shadowTint: [0.97 - 0.02 * sun.late, 1, 1.03 + 0.03 * sun.late],
          highlightTint: [0.99 + 0.03 * sun.late, 1, 1.01 - 0.05 * sun.late],
          vignette: 0.22,
          whitePoint: 1.25,
          input: linear ? "linear" : "srgb",
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
    bindTex(0, debugVis ? T.vis.tex : raw ? T.scene.tex : T.film.tex, P.blit.u.uTex);
    gl.uniform1f(P.blit.u.uFade, fade);
    gl.uniform1f(P.blit.u.uRaw, raw && linear && !debugVis ? 1 : 0);
    gl.uniform3fv(P.blit.u.uPaper, PAPER);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // Reveal: the print comes up a stop and a half over, a white-blue winter
  // glare, and settles; then, untouched, the sun walks on from the
  // photographer's half past two into the late afternoon to show it can.
  const REVEAL = 2.0;
  const WALK_AT = 1.4;
  const WALK = 2.8;

  let slow = 0;
  let lastNow = 0;
  stage.onFrame((dt) => {
    if (!T.scene) return;
    const now = performance.now();
    const real = lastNow ? (now - lastNow) / 1000 : 1 / 60;
    lastNow = now;
    if (!still) {
      const r = Math.min(real, 0.25);
      slow = real > 1 / 36 ? slow + r : Math.max(0, slow - r * 0.5);
      if (slow > 1.5 && scale > 0.5) {
        scale = scale > 0.8 ? 0.75 : 0.5;
        slow = 0;
        if (lastBox) layout(...lastBox);
      }
    }
    if (t0 < 0) t0 = now / 1000;
    const age = still ? 99 : now / 1000 - t0;
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 1.6 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
    }

    // Goal: the opening walk, then the hand, then inertia.
    if (!held && !touched) {
      const k = reduce ? 1 : expoOut(clamp((age - WALK_AT) / WALK, 0, 1));
      goal = S_PHOTO + (S_OPEN - S_PHOTO) * (reduce ? 0 : k);
    } else if (!held && !dragging) {
      if (Math.abs(goalV) > 1e-4) {
        goal += goalV * dt;
        goalV *= Math.exp(-dt / 0.22);
      }
      // ends of the afternoon pull the goal back in
      if (goal < 0) goal += (0 - goal) * (1 - Math.exp(-dt * 14));
      if (goal > 1) goal += (1 - goal) * (1 - Math.exp(-dt * 14));
    }
    let moving = false;
    if (held) sunS = goal;
    else {
      // spring, damping ratio 0.86, ~0.4 s settle
      const w = 13;
      const z = 0.86;
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const a = w * w * (goal - sunS) - 2 * z * w * sunV;
        sunV += a * h;
        sunS += sunV * h;
      }
      moving = Math.abs(goal - sunS) > 1e-4 || Math.abs(sunV) > 1e-4;
      if (!moving) {
        sunS = goal;
        sunV = 0;
      }
    }

    // Grain steps at 24 fps; nothing else changes while idle.
    let tick = false;
    if (!frozen && !reduce) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        seed = (seed + 1) % 997;
        tick = true;
      }
    }
    const revealing = !still && age < REVEAL + 0.1;
    if (!dirty && !moving && !tick && !revealing && Math.abs(sunS - lastVisS) < 1e-5) return;
    dirty = false;
    draw(expo, fade);
  });

  return {
    destroy() {
      host.removeEventListener("keydown", onKey);
      film.destroy();
      Object.values(T).forEach((t) => freeTarget(gl, t));
      [alb, nrm, mat, dep].forEach((t) => gl.deleteTexture(t));
      Object.values(P).forEach((p) => gl.deleteProgram(p.p));
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
