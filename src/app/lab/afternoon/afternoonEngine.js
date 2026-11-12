import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Afternoon: one photograph of a Kyoto intersection taken apart into material
// maps and lit again by a sun you move through the afternoon.
//
// The bake (tools/depth/bakes/afternoon) turns Richard Tao's photograph into:
//  - depth: metres, from Depth Anything fitted to the exact ground plane of a
//    level 35 mm camera 1.5 m off the road (horizon and focal length measured
//    from the crosswalk), with walls replaced by their planes;
//  - normals: the road plane, walls snapped to the street's axes by the
//    photo's own vanishing lines, foliage and the far hills softened;
//  - albedo: the de-graded photo divided by the shading the model gives under
//    the photo's own sun (13:00), so photo = albedo x shading there;
//  - the sun-shadow mask of that light, a sky and cloud matte, and a thickness
//    per occluder (a pole is ~0.3 m deep, a house ~10 m).
//
// Live: Lambert sun + hemispheric sky (with a little circumsolar lean and
// ground bounce), the sun's colour and strength from air mass, cast shadows
// by marching each pixel's ray toward the sun through the depth in screen
// space, cloud shadows projected through the photo's own cumulus at 1.6 km
// and drifting on a light wind. At the photo's sun the model hands over to the
// photo's own shadows, so the frame is the photograph.
//
// Query: ?sun=0..1 holds the sun (0 = 12:30, 1 = 18:25; the photo is 0.084);
// ?t=seconds freezes the cloud clock; ?still=1 skips the reveal; ?film=0
// shows the relit frame before the film (for checking against the photo);
// ?debug=vis shows the cast-shadow buffer, ?debug=light the sun term.

const BASE = "/lab/afternoon/";
const PW = 2400;
const PH = 1600;
// Camera (plate pixels, y down): focal, principal point (cy = horizon row).
const CAM = [2797, 1200, 1398];
const CAM_H = 1.5;
// Light model, same constants as tools/depth/bakes/afternoon/light.json.
const LAT = 35;
const DECL = 17.5;
const HEADING = 40;
const T0 = 13.0;
const T_START = 12.5;
const T_SPAN = 5.92;
const TAU = [0.08, 0.13, 0.26];
const SUN_K = 1.2;
const SKY_NOON = [0.17, 0.22, 0.3];
const SKY_WARM = [0.12, 0.02, -0.1];
const BOUNCE = 0.18;
const GRADE_LO = [0.115, 0.125, 0.0];
const GRADE_HI = [0.96, 0.95, 0.96];
const ALBEDO_MAX = 1.0;
const S_PHOTO = (T0 - T_START) / T_SPAN;
const S_OPEN = 0.78;

// Thin occluders, fitted by hand to the plate: the two lamp standards with
// their mast arms and signal heads, the utility poles and their crossarms,
// the signal and sign poles. Each structure stands where its foot meets the
// road (the ground row gives its exact depth), and its parts are capsules in
// the plane through that foot: [x0, y0, x1, y1, radius m] in plate pixels.
// Depth Anything only knows a pole's depth to about its own width, too loose
// for the march to catch a 0.3 m pole; these cast the long late shadows
// across the road sharply, the way the poles themselves would.
const POLES = [
  // left lamp standard, mast arm and signal head over the near lane
  { foot: 1505, parts: [[90, 1505, 100, 476, 0.2], [100, 536, 204, 508, 0.09], [168, 507, 228, 505, 0.2], [100, 983, 445, 983, 0.11], [458, 986, 534, 986, 0.26]] },
  // utility pole by the planter, two crossarms and the transformer
  { foot: 1497, parts: [[460, 1497, 440, 566, 0.21], [420, 662, 550, 662, 0.09], [376, 722, 510, 722, 0.09], [470, 842, 506, 826, 0.3]] },
  // the pole behind the bus stop
  { foot: 1492, parts: [[545, 1492, 555, 762, 0.17], [510, 834, 602, 834, 0.08]] },
  // right lamp standard and its mast arm out to the signal
  { foot: 1485, parts: [[2237, 1485, 2237, 466, 0.22], [2237, 526, 2150, 500, 0.09], [2120, 492, 2176, 495, 0.2], [1880, 995, 2237, 995, 0.11], [1862, 985, 1960, 985, 0.26]] },
  // signal pole with the swan-neck lamp
  { foot: 1480, parts: [[1945, 1480, 1945, 950, 0.15], [1945, 950, 1850, 880, 0.07], [1850, 880, 1770, 873, 0.07]] },
  // far-side pole with its sign gantry
  { foot: 1475, parts: [[1622, 1475, 1622, 1165, 0.15], [1415, 1174, 1622, 1174, 0.09], [1415, 1230, 1622, 1230, 0.09]] },
];
// And what the frame does not show: the photographer's own corner, just out
// of shot to the left: two utility poles, the corner house, and past a side
// street the narrow end of the next block. Camera space, metres (y up from
// the lens, the road at -CAM_H). At the photo's sun their shadows fall away
// out of frame; only once the sun swings round behind-left, in the last two
// hours, do they reach in: the block's shadow cuts diagonally across the
// crosswalk, the light through the side street lays a band over the near
// road with the poles' shadows raked across it, and the house's eave line
// climbs the foreground.
const offPole = (x, z, h) => [
  [x, -CAM_H, z, x + 0.1, h - CAM_H, z, 0.26],
  [x - 1.3, h - 2.8, z, x + 1.3, h - 2.8, z, 0.09],
  [x - 1.1, h - 3.8, z, x + 1.1, h - 3.8, z, 0.09],
  [x + 0.1, h - 5.6, z + 0.3, x + 0.4, h - 4.6, z + 0.3, 0.34],
];
const OFF_FRAME = [...offPole(-12, 20, 12), ...offPole(-15.5, 31, 12.5)];
// Min and max corners: the corner house (7.5 m to the eaves), the next
// block (11 m).
const BOXES = [
  [-40, -CAM_H, -30, -13, 7.5 - CAM_H, 6],
  [-40, -CAM_H, 22, -16, 11 - CAM_H, 27],
];
function occluders() {
  const out = [];
  for (const { foot, parts } of POLES) {
    const Z = (CAM[0] * CAM_H) / (foot - CAM[2]);
    const at = (x, y) => [((x - CAM[1]) * Z) / CAM[0], ((CAM[2] - y) * Z) / CAM[0], Z];
    for (const [x0, y0, x1, y1, r] of parts) out.push([...at(x0, y0), r, ...at(x1, y1), 0]);
  }
  for (const [ax, ay, az, bx, by, bz, r] of OFF_FRAME) out.push([ax, ay, az, r, bx, by, bz, 0]);
  return out;
}
const OCC = occluders();
const OCC_FLAT = new Float32Array(OCC.flat());
const BOX_FLAT = new Float32Array(BOXES.flatMap((b) => [b[0], b[1], b[2], 0, b[3], b[4], b[5], 0]));

const LUMA = [0.2126, 0.7152, 0.0722];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const rad = (d) => (d * Math.PI) / 180;

// Solar position for local solar time t (hours), as a direction in camera
// space (x right, y up, z forward), plus sun and sky irradiance colours.
function sunAt(t) {
  const lat = rad(LAT);
  const dec = rad(DECL);
  const h = rad(15 * (t - 12));
  const se = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h);
  const el = Math.asin(se);
  const az = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) + Math.PI;
  const rel = az - rad(HEADING);
  const L = [Math.sin(rel) * Math.cos(el), Math.sin(el), Math.cos(rel) * Math.cos(el)];
  const deg = (el * 180) / Math.PI;
  const m = 1 / (Math.sin(el) + 0.50572 * Math.pow(deg + 6.07995, -1.6364));
  const sun = TAU.map((k) => SUN_K * Math.exp(-k * m));
  const warm = clamp(1 - deg / 35, 0, 1);
  const g = 0.2 + 0.8 * Math.sqrt(Math.max(se, 0));
  const sky = SKY_NOON.map((v, i) => v * g * (1 + warm * SKY_WARM[i]));
  // How far into the late afternoon: 0 at the photo's high sun, 1 at the end.
  const late = clamp((62 - deg) / 56, 0, 1);
  // The fill the shadows get. The bake's hazy-noon sky is fitted to the photo
  // and stays exact there; as the sun drops the haze thins toward the clear
  // late sky, so the shade loses fill against the direct light and the long
  // shadows come up nearer two stops than one.
  const fill = sky.map((v) => v * (1 - 0.6 * late * late));
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
  // Long enough to clear the tallest roofs (30 m), never through the lens.
  float tmax = min(420.0, (30.0 - (P.y + ${CAM_H.toFixed(2)})) / max(Ld.y, 0.02));
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
    float d = rz - sz;
    // Depth Anything walls are bumpy at the metre scale: an occluder must
    // stand clear of the receiver by more than that, or a wall would shadow
    // itself. Thin occluders get the margin added to their thickness.
    // Thin occluders (poles, signs, wires) are taken as solid a little in
    // front of their surface too, since their estimated depth is only good to
    // about their own width.
    float bias = 0.1 + 0.006 * rz;
    if (d > -0.6 && length(s - s0) > 10.0) {
      float th = exp2(textureLod(uNrm, st, 0.0).b * 6.0 - 2.0);
      float lo = th < 2.0 && abs(sz - P.z) > 1.5 ? -0.4 * th : 0.6 + 0.012 * rz;
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
uniform float uW0;       // hand-over to the photo's own shadows near its sun
uniform float uExpo;
uniform float uSkyGain;
uniform float uWarm;
uniform vec2 uWind;      // cloud offset, metres
uniform float uCloud;
uniform vec3 uLo;
uniform vec3 uHi;
uniform float uDebug;
uniform float uLate;     // 0 at the photo's sun .. 1 at the last light
uniform vec4 uOcc[${OCC.length * 2}];
uniform vec4 uBox[${BOXES.length * 2}];
${COMMON}
vec3 s2l(vec3 c) { c = max(c, 0.0); return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 l2s(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

vec3 shading(vec3 N, float vis) {
  float ndl = max(dot(N, uL), 0.0);
  vec3 Lh = normalize(vec3(uL.x, 0.0, uL.z) + 1e-5);
  float circ = 1.0 + 0.35 * max(dot(N, Lh), 0.0);
  vec3 horiz = uSun * uL.y + uSky;
  return uSun * vis * ndl + uSky * (0.5 + 0.5 * N.y) * circ + ${BOUNCE.toFixed(3)} * horiz * (0.5 - 0.5 * N.y);
}

// Hard-edged thin occluders: the closest approach of the ray to the sun to
// each capsule, against its radius, softened by the sun's own disc (half a
// degree) so the shadow sharpens at the foot and blurs toward its tip.
float poleVis(vec3 P, vec2 px) {
  float v = 1.0;
  for (int i = 0; i < ${OCC.length}; i++) {
    vec3 A = uOcc[2 * i].xyz;
    float r = uOcc[2 * i].w;
    vec3 B = uOcc[2 * i + 1].xyz;
    vec3 E = B - A;
    // a pixel on (or right beside) the occluder itself is not its receiver
    if (A.z > 2.0 && B.z > 2.0) {
      vec2 a = proj(A);
      vec2 e = proj(B) - a;
      float h = clamp(dot(px - a, e) / max(dot(e, e), 1e-4), 0.0, 1.0);
      if (length(px - a - e * h) < r * uCam.x / A.z + 5.0) continue;
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
  // Boxes: where the ray crosses each face plane, how far inside the face it
  // is (metres, + inside); the largest is the ray's depth into the
  // silhouette, which the sun's disc turns into a soft edge.
  for (int i = 0; i < ${BOXES.length}; i++) {
    vec3 lo = uBox[2 * i].xyz;
    vec3 hi = uBox[2 * i + 1].xyz;
    vec3 c = 0.5 * (lo + hi);
    vec3 hw = 0.5 * (hi - lo);
    float best = -1e3;
    float tb = 0.0;
    for (int k = 0; k < 3; k++) {
      if (abs(uL[k]) < 1e-4) continue;
      for (int sgn = 0; sgn < 2; sgn++) {
        float plane = sgn == 0 ? lo[k] : hi[k];
        float t = (plane - P[k]) / uL[k];
        if (t <= 0.3) continue;
        vec3 q = abs(P + uL * t - c) - hw;
        q[k] = -1e3;
        float inside = -max(max(q.x, q.y), q.z);
        if (inside > best) { best = inside; tb = t; }
      }
    }
    float pen = 0.03 + 0.0042 * tb;
    v *= 1.0 - smoothstep(-pen, pen, best);
  }
  return v;
}

// Cloud shadow: follow the ray to the sun up to the cloud deck at 1.6 km and
// read the photo's own cumulus there (a mirrored tile of its cloud matte).
float cloudShadow(vec3 Pw) {
  vec2 hit = Pw.xz + uL.xz * (1600.0 - Pw.y) / max(uL.y, 0.05) + uWind;
  vec2 c = hit / vec2(1500.0, 900.0);
  vec2 m = abs(fract(c * 0.5) * 2.0 - 1.0);
  float d = textureLod(uMat, vec2(0.04 + m.x * 0.92, 0.05 + m.y * 0.55), 3.0).g;
  return 1.0 - uCloud * smoothstep(0.6, 0.82, d);
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
  float cs = Z < 3500.0 ? cloudShadow(P + vec3(0.0, ${CAM_H.toFixed(2)}, 0.0)) : 1.0;
  float pv = Z < 3500.0 && mt.r < 0.5 && dot(N, uL) > 0.0 ? mix(poleVis(P, px), 1.0, uW0) : 1.0;
  vec3 surf = base * ${ALBEDO_MAX.toFixed(3)} * shading(N, vis * cs * pv);

  // Sky, driven by the same sun. The clear blue deepens from the hazy
  // horizon to cobalt overhead, more so as the sun drops and the sky ahead
  // of us (90 degrees from it) polarises; low down it keeps a pale warm
  // haze. The cumulus take the sun's colour on the faces it reaches (it is
  // behind us, to the left late on), and their shaded undersides go to the
  // blue of the sky they are lit by.
  vec3 sunTint = uSun / max(dot(uSun, LUMA), 1e-4);
  vec3 vd = normalize(vec3((px.x - uCam.y) / uCam.x, (uCam.z - px.y) / uCam.x, 1.0));
  float zen = smoothstep(0.02, 0.5, vd.y);
  float hz = 1.0 - smoothstep(0.0, 0.16, vd.y);
  vec3 cobalt = vec3(0.2, 0.4, 1.18);
  vec3 clear = base * mix(vec3(1.0), cobalt, zen * (0.45 + 0.55 * uLate));
  clear *= mix(vec3(1.0), vec3(1.1, 1.0, 0.86), hz * uLate * 0.8);
  clear *= 1.0 - 0.22 * zen * uLate;
  // Which way a cloud pixel faces: bright in the photo means sunlit, and a
  // pixel with less cloud above it (or, late, to its left) is a top.
  float cy = dot(base, LUMA);
  vec2 tx = vec2(1.0 / uPlate.x, 1.0 / uPlate.y);
  float gUp = textureLod(uMat, t - vec2(0.0, 26.0) * tx, 2.0).g;
  float gLeft = textureLod(uMat, t - vec2(30.0, 8.0) * tx, 2.0).g;
  float lit = clamp(smoothstep(0.42, 0.86, cy) * 0.8 + (mt.g - gUp) * 1.6 + (mt.g - gLeft) * 1.2 * uLate, 0.0, 1.0);
  vec3 skyBlue = vec3(0.62, 0.92, 1.3);
  vec3 cloudLit = base * mix(vec3(1.0), sunTint * vec3(1.06, 1.0, 1.0), 0.95 * uLate);
  vec3 cloudShade = base * mix(vec3(1.0), skyBlue, 0.75 * uLate) * (1.0 - 0.3 * uLate);
  vec3 cloud = mix(cloudShade, cloudLit, lit);
  // Toward the low sun (off the frame to the left) the sky brightens and
  // warms: forward scattering by the haze.
  float glow = exp((dot(vd, uL) - 1.0) / 0.45) * uWarm;
  vec3 sky = (mix(clear, cloud, mt.g) + base * sunTint * glow * 0.45) * uSkyGain;

  vec3 col = mix(surf, sky, mt.r) * uExpo;
  if (uDebug > 0.5) col = vec3(vis * cs * pv * max(dot(N, uL), 0.0)) * (1.0 - mt.r) * 0.6;
  // Back through the photo's own scan grade (lifted, tinted black; rolled
  // white), unclamped above white so the film's shoulder gets the highlights.
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
  const lumH = (s) => dot3(s.sun, LUMA) * Math.max(s.L[1], 0) + dot3(s.fill, LUMA);

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

  let time = frozen ? timeQ : 0;
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
    // Exposure follows the light about half way, as a photographer would.
    const expo = Math.pow(lumH(photo) / lumH(sun), 0.6);
    gl.uniform1f(u.uExpo, expo * 2 ** expoStops);
    gl.uniform1f(u.uSkyGain, Math.pow(dot3(sun.sky, LUMA) / dot3(photo.sky, LUMA), 1.6));
    gl.uniform1f(u.uWarm, sun.warm);
    gl.uniform1f(u.uLate, sun.late);
    gl.uniform4fv(u["uOcc[0]"], OCC_FLAT);
    gl.uniform4fv(u["uBox[0]"], BOX_FLAT);
    // A light breeze, ~3 m/s from the west-south-west.
    gl.uniform2f(u.uWind, 420 + time * 2.6, -260 + time * 1.2);
    gl.uniform1f(u.uCloud, 0.78);
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

  // Reveal: the print comes up a stop and a half over, a white-blue summer
  // glare, and settles; then, untouched, the sun walks on from the
  // photographer's one o'clock into the late afternoon to show it can.
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

    // Clouds and grain step at 24 fps; nothing else changes while idle.
    let tick = false;
    if (!frozen && !reduce) {
      time += dt;
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
