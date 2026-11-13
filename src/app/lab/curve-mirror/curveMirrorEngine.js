import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_DEFAULTS, FILM_PRESETS } from "../_kit/film";

// Curve mirror (カーブミラー): a roadside convex traffic mirror on an orange
// pole, standing in a real photograph of a Kyoto level crossing. Drag to turn
// it on its bracket (as far as a real one turns, against sprung stops) and
// the reflection sweeps the street behind you, the house, the crossing and
// the sky; at one angle it catches the sun.
//
// The photograph is measured: MoGe-2 gives every pixel a metric position, the
// poles' vanishing point gives the true vertical (the lens is tilted up 22.6
// degrees), the house's shading gives the sun. Offline, everything the mirror
// can see is gathered into one panorama centred on it: in front of the lens,
// the photograph's own pixels re-projected from where the mirror stands; behind
// the lens and below the frame, a 360 of a Japanese residential street, poles
// and wires, given the photo's summer sky (bake: tools/depth/bakes/curve-mirror).
//
// Every frame, per pixel:
//  - the mirror is traced exactly: a sphere cap, 800 mm across with a 1.6 m
//    radius of curvature (a real acrylic road mirror's), the view ray
//    reflected off it, corrected for parallax across the face with the
//    panorama's distances, filtered by its own spread (ray differentials);
//  - the frame (a deep band with a visor over its top), back shell, bracket
//    and pole are signed distance fields,
//    lit as the crossing's own poles are: the measured sun at full strength
//    with a hard terminator, and on the shade side only a dim, cyan skylight
//    fill (the panorama's SH9 cut to the sky's share), an order of magnitude
//    down, as the crossbuck pole's lit and shaded halves measure;
//    their paint is the road mirror's vermilion enamel, chipped to dark steel,
//    streaked by rain and dirtied where the AO says it is sheltered, its fine
//    tooth taken from the photo's own plaster, with a roughness map that
//    breaks up the sun's anisotropic streak down the pole; the head's paint
//    is chalked matte (rough dielectric, its sheen the prefiltered panorama,
//    no sun lobe), and all of it rolls off on the plate's shoulder, so a
//    sunlit face stays orange and never bleaches;
//  - the object takes the plate's grain at the photo's pixel pitch, so the
//    film develops it and the photograph alike;
//  - the street the glass shows is under the same sun: the 360's surfaces
//    (shot under cloud) are developed in the bake to the photo's own sunlit
//    walls (a Lab colour transfer by luminance band, the road's highlights
//    rolled off warm, the greens taken to the plate's foliage, its tone-mapped
//    crispness let down), and read a third of a mip softer than their pixel
//    footprint, the plate's scan MTF; what the glass shows is then graded to
//    the plate (lifted for the aluminium's loss, black point held, a shoulder
//    at the plate's sunlit white), since an acrylic mirror returns ~85 % of
//    it, and goes through the same Pro-Mist and halation as the plate; its
//    sky is taken to the cobalt round the mirror by reflected elevation,
//    never a stop under or greyer than the street it stands in;
//  - the face is a second-surface acrylic dome standing proud of the frame
//    on its own wall: a Schlick sheen of cool sky that climbs toward the rim,
//    the zenith's broad gloss over the upper bulge, the hood's underside
//    reflected at its crown and its shadow on it, a dark contact band where
//    the lip holds it, a little waviness, dust and one thumb smudge, which
//    scatter the sun when it is in the glass;
//  - the assembly's shadow falls on the photograph through its point map;
//  - it is composited with real coverage: a geometry pass classifies every
//    pixel centre, and wherever that changes from one pixel to the next (its
//    silhouette, the glass meeting the frame, the hood seen in the glass)
//    eight rays are traced and shaded across the pixel and resolved
//    premultiplied over the photo; that edge band alone then takes the
//    photo's own edge spread and a thin warm halation from bright sky.
// The shared film kit develops the result, and develops the photograph alone
// beside it: the print is the bare photograph's development wherever the
// object does not reach, so the film's colour bleed cannot carry the orange
// into the sky round the frame and leave a pale rim there.
//
// Query: ?aim=yaw,pitch (degrees) holds the mirror still, no reveal;
// ?aim=sun holds it on the sun.

const BASE = "/lab/curve-mirror/";
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];
const DEG = Math.PI / 180;

// mirror geometry, metres
const A = 0.4; // face radius (800 mm)
const RC = 1.6; // radius of curvature
// The mount, as real ones are built: the pole ends in a capped top with a
// clamp band; a bracket arm runs forward from the band, rising a little, to a
// yoke that holds the hinge knuckle bolted to the shell's back. The head
// pitches about that knuckle and turns (yaw) with the arm round the pole, so
// the pole stands ARM behind the shell's back and stops below the hinge: the
// lower rim, swinging back as the head tips down, clears it (the frame's back
// edge by about 5 cm at the lower limit), and nothing ever passes through the
// glass.
const HINGE = 0.18; // hinge axis behind the face apex (just behind the shell's back)
const ARM = 0.3; // pole axis behind the hinge, horizontally
const POLE_DROP = 0.05; // pole top below the hinge
const POLE_R = 0.0381; // 76.3 mm pipe
// The head's profile, as the real ones are pressed: the acrylic dome's sag
// at its rim, then a short straight wall of the same sheet standing PROUD of
// the frame's front; the frame a deep steel band (FRAME_D deep, FRAME_W
// across its front face) closed by a shallow back shell; and a visor (フード)
// over the top, HOOD long at its crown, swept back to nothing HOOD_ARC
// degrees either side.
const SAG = RC - Math.sqrt(RC * RC - A * A);
const PROUD = 0.012;
const FRAME_D = 0.07;
const FRAME_W = 0.036;
const HOOD = 0.11;
const HOOD_ARC = 80;
// rest aim (relative to facing the lens) and limits, degrees
const REST = [20, -15];
// What the bracket can do. The arm's clamp band turns on the pole, but the
// yoke's stops (and the street the mirror is bolted to watch) hold the face
// within 65 degrees of the lens either way, so its back, the bare pressed
// steel, is never turned to it; the knuckle tips it 35 degrees down toward
// the road and 15 up, where the visor's rear lip meets the yoke. Hard
// limits, never passed.
const YAW_LIM = [-65, 65];
const PITCH_LIM = [-35, 15];
// The end-stops are rubber-bushed springs, not walls: a soft spring takes up
// from SOFT, a stiffer one from FIRM, each pushing the head back toward the
// open range; under the hand the head lags the drag more and more as the
// stop nears and creeps up to the limit asymptotically, and let go it eases
// back off the bushing to where the soft spring balances. Degrees, and the
// springs' stiffness as a multiple of the follow spring's.
const STOP = {
  yaw: { soft: [-45, 45], firm: [-55, 55] },
  pitch: { soft: [-26, 6], firm: [-31, 10] },
  kSoft: 0.35,
  kFirm: 2.2,
};

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const SCENE = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
#ifndef GEO
// the photograph alone (its shadow included) for the second development
layout(location = 1) out vec4 outPhoto;
#endif

uniform sampler2D uPhoto;  // sRGB
uniform sampler2D uEnv;    // sRGB equirect, centred on the mirror
uniform sampler2D uEnvD;   // log distance code
uniform sampler2D uAux;    // r: log z code, g: sunlit, b: sky
uniform sampler2D uGrade;  // the plate's enamels: r yellow, g orange-red, b green (grade.py)
uniform vec4 uView;        // photo px: x0, y0 (top), w, h
uniform vec2 uPhotoSize;
uniform float uF;
uniform vec2 uC;
uniform mat3 uR;           // world = uR * camera
uniform vec3 uM;           // panorama centre (the mirror at rest)
uniform vec3 uFace;        // face apex
uniform vec3 uN;           // face axis (outward)
uniform vec3 uU;           // face up
uniform vec3 uX;           // face right
uniform vec3 uPivot;       // the pole top, on its axis
uniform vec3 uHinge;       // the hinge knuckle's axis centre
uniform vec3 uHz;          // the arm's direction, pole to hinge (horizontal)
uniform float uGround;     // road y
uniform vec3 uSun;
uniform float uSunE;       // sun irradiance (scene units)
uniform float uSunDisc;    // gain on the sun's disc in the glass
uniform vec3 uSunTone;     // the sun's shoulder, scene units: knee, ceiling, core
uniform vec3 uHiTint;      // the film's highlight tint, which the shoulder is judged through
uniform vec3 uSunW;        // the sun's colour in scene units, so it develops warm-neutral
uniform vec3 uCloudW;      // a sunlit cumulus top in scene units, so it develops warm-neutral
uniform vec3 uSH[9];
uniform vec2 uDist;        // log2 range of the distance code
uniform float uEnvW;
uniform float uExpo;
uniform float uPx;         // angular size of one render pixel (rad)

const float A = ${A.toFixed(4)};
const float RC = ${RC.toFixed(4)};
const float HINGE = ${HINGE.toFixed(4)};
const float ARM = ${ARM.toFixed(4)};
const float POLE_DROP = ${POLE_DROP.toFixed(4)};
const float POLE_R = ${POLE_R.toFixed(4)};
const float SAG = ${SAG.toFixed(5)};
const float ZF = ${(-SAG - PROUD).toFixed(5)};  // the frame's front face, face-local z
const float FRAME_D = ${FRAME_D.toFixed(4)};
const float FRAME_W = ${FRAME_W.toFixed(4)};
const float HOOD = ${HOOD.toFixed(4)};
const float HOOD_C0 = ${Math.cos(HOOD_ARC * DEG).toFixed(5)};
const float HOOD_C1 = ${Math.cos(HOOD_ARC * 0.45 * DEG).toFixed(5)};
const float PI = 3.14159265;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 srgb2lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }

// ---------------------------------------------------------------- noise
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

// ---------------------------------------------------------------- panorama
vec2 envUv(vec3 d) {
  return vec2(0.5 + atan(d.x, -d.z) / (2.0 * PI), 0.5 - asin(clamp(d.y, -1.0, 1.0)) / PI);
}
vec3 env(vec3 d, float lod) { return textureLod(uEnv, envUv(d), lod).rgb; }
// The glass's own footprint in the panorama, as uv gradients across a pixel
// (taken in main from the exact cap's reflection). A turned mirror is seen
// side on and squeezes the street across but not up and down; filtered
// anisotropically, the trunks and leaves keep their drawing along the
// squeeze instead of the whole footprint being blurred to its widest axis.
vec2 gEnvGx = vec2(0.0), gEnvGy = vec2(0.0);
vec3 envGrad(vec3 d, float k) { return textureGrad(uEnv, envUv(d), gEnvGx * k, gEnvGy * k).rgb; }
float envDist(vec3 d) {
  float c = textureLod(uEnvD, envUv(d), 0.0).r;
  return exp2(mix(uDist.x, uDist.y, c));
}
vec3 irradiance(vec3 n) {
  float x = n.x, y = n.y, z = n.z;
  vec3 e = uSH[0] * 0.282095 + uSH[1] * 0.488603 * y + uSH[2] * 0.488603 * z + uSH[3] * 0.488603 * x
    + uSH[4] * 1.092548 * x * y + uSH[5] * 1.092548 * y * z + uSH[6] * 0.315392 * (3.0 * y * y - 1.0)
    + uSH[7] * 1.092548 * x * z + uSH[8] * 0.546274 * (x * x - z * z);
  return max(e, 0.0);
}

// ---------------------------------------------------------------- the object
float sdRoundBox2(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-6);
}
float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
vec3 toLocal(vec3 p) { vec3 d = p - uFace; return vec3(dot(d, uX), dot(d, uU), dot(d, uN)); }

// The frame and its visor, face-local. The frame is a revolved section: a
// band FRAME_D deep and FRAME_W across, its inner edge tucked 2 mm over the
// acrylic's wall. The visor is the band's outer skin carried forward, a 5 mm
// sheet, HOOD long over the crown and swept back to the frame at HOOD_ARC.
float sdHead(vec3 q) {
  float rho = length(q.xy);
  vec2 sec = vec2(rho - (A + 0.5 * (FRAME_W - 0.002)), q.z - (ZF - 0.5 * FRAME_D));
  float frame = sdRoundBox2(sec, vec2(0.5 * (FRAME_W + 0.002), 0.5 * FRAME_D), 0.007);
  float cphi = q.y / max(rho, 1e-4);
  float reach = HOOD * smoothstep(HOOD_C0, HOOD_C1, cphi);
  float hood = max(abs(rho - (A + FRAME_W - 0.0025)) - 0.0025, max(q.z - ZF - reach, ZF - 0.02 - q.z));
  return min(frame, hood * 0.85 - 0.0006);
}

// part ids: 1 frame band and visor, 2 back shell, 3 bracket, 4 pole, 5 clamp, 6 face
// nf: the distance to everything but the acrylic
vec2 sdSceneNF(vec3 p, out float nf) {
  vec3 q = toLocal(p);
  float rho = length(q.xy);
  // frame band and visor
  float ring = sdHead(q);
  // the acrylic, as a solid (its true surface is traced exactly): the dome,
  // and below its rim the sheet's straight wall, PROUD of the frame's face
  float face = max(rho - A, max(q.z - (RC - sqrt(max(RC * RC - rho * rho, 0.0))) * -1.0, ZF - 0.006 - q.z));
  // back shell: a shallow half ellipsoid closing the band
  float zb = ZF - FRAME_D + 0.01;
  float shell = max(sdEllipsoid(q - vec3(0.0, 0.0, zb), vec3(A + FRAME_W - 0.004, A + FRAME_W - 0.004, 0.045)), q.z - zb);
  // the mounting plate bolted to the shell's back, under the knuckle
  shell = min(shell, max(rho - 0.1, abs(q.z + HINGE - 0.0185) - 0.0045) - 0.002);
  // the bracket, in the arm's frame (s toward the head, w across, y up from
  // the hinge): knuckle (round its own axis, so it ignores the pitch), the
  // yoke that holds it, and the arm back and down to the pole's clamp band
  vec3 b = p - uHinge;
  vec3 m = vec3(dot(b, uHz), dot(b, uX), b.y);
  float knuckle = max(length(m.xz) - 0.021, abs(m.y) - 0.082);
  float yoke = sdBox(m - vec3(-0.04, 0.0, 0.0), vec3(0.019, 0.067, 0.021)) - 0.003;
  float arm = min(knuckle, min(yoke, sdCapsule(m, vec3(-ARM, 0.0, -POLE_DROP - 0.05), vec3(-0.045, 0.0, 0.0), 0.02)));
  // pole with its cap, clamp band round the top (world vertical)
  vec3 pp = p - uPivot;
  float pr = length(pp.xz);
  float pole = max(pr - POLE_R, max(pp.y, uGround - p.y));
  pole = min(pole, max(pr - POLE_R - 0.003, abs(pp.y - 0.004) - 0.006) - 0.002);
  float clampB = max(pr - POLE_R - 0.012, abs(pp.y + 0.055) - 0.045) - 0.003;
  vec2 r = vec2(ring, 1.0);
  if (shell < r.x) r = vec2(shell, 2.0);
  if (arm < r.x) r = vec2(arm, 3.0);
  if (pole < r.x) r = vec2(pole, 4.0);
  if (clampB < r.x) r = vec2(clampB, 5.0);
  nf = r.x;
  if (face < r.x) r = vec2(face, 6.0);
  return r;
}
vec2 sdScene(vec3 p) { float nf; return sdSceneNF(p, nf); }
float sdf(vec3 p) { return sdScene(p).x; }
vec3 sdNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.0006;
  return normalize(k.xyy * sdf(p + k.xyy * h) + k.yyx * sdf(p + k.yyx * h) + k.yxy * sdf(p + k.yxy * h) + k.xxx * sdf(p + k.xxx * h));
}
float softShadow(vec3 ro, vec3 rd, float tmin, float tmax, float k) {
  float res = 1.0, t = tmin;
  for (int i = 0; i < 40; i++) {
    float h = sdf(ro + rd * t);
    res = min(res, k * h / t);
    t += clamp(h, 0.006, 0.12);
    if (res < 0.002 || t > tmax) break;
  }
  return clamp(res, 0.0, 1.0);
}
float ao(vec3 p, vec3 n) {
  float o = 0.0, s = 1.0;
  for (int i = 1; i <= 4; i++) {
    float h = 0.012 * float(i * i);
    o += (h - sdf(p + n * h)) * s;
    s *= 0.6;
  }
  return clamp(1.0 - 2.2 * o, 0.0, 1.0);
}
// ray vs a sphere: entry/exit
vec2 sphereHit(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float h = b * b - dot(oc, oc) + r * r;
  if (h < 0.0) return vec2(1e9, -1e9);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
// ray vs the pole's bounding cylinder (vertical), entry/exit
vec2 cylHit(vec3 ro, vec3 rd, vec3 c, float r) {
  vec2 o = ro.xz - c.xz, d = rd.xz;
  float a = dot(d, d), b = dot(o, d), cc = dot(o, o) - r * r;
  float h = b * b - a * cc;
  if (h < 0.0 || a < 1e-9) return vec2(1e9, -1e9);
  h = sqrt(h);
  return vec2((-b - h) / a, (-b + h) / a);
}

// ---------------------------------------------------------------- paint
// the paint's grain: the direction the highlight smears along (a pole's
// axis, the rim's circumference, the arm), or zero for none
vec3 grainDir(vec3 p, float id) {
  if (id == 4.0 || id == 5.0) return vec3(0.0, 1.0, 0.0);
  if (id == 3.0) return uHz;
  if (id == 1.0) {
    vec3 q = toLocal(p);
    vec3 rad = uX * q.x + uU * q.y;
    return cross(uN, rad / max(length(rad), 1e-4));
  }
  return vec3(0.0);
}

// One warm accent, and it is the mirror. The plate's own enamels (the
// crossbuck's yellow, the barrier pole's orange-red, the green sign) stood at
// full chroma against the cobalt and pulled the eye off the glass. They are
// graded down here, in OKLCh, as sun-faded enamel: the yellow to 45 % chroma,
// turned 8 deg toward ochre and half a stop down; the orange-red to 30 %,
// turned 15 deg toward a dusty brick-brown and half a stop down, so the
// barrier's stripes no longer rhyme with the vermilion; the green to half.
// Where each enamel is comes from the bake (grade.py: the object's
// footprint, its enamel-coloured pixels grown over the edge and feathered); how much of a pixel is that enamel is told here,
// by a hue window feathered 20 deg either side and a chroma floor, so the
// house's sunlit boards, the fence and the black stripes are not touched,
// and nothing steps at a mask's edge. The vermilion paint is the object's,
// never the plate's, and keeps its full colour.
vec3 toOk(vec3 c) {
  vec3 l = mat3(0.4122214708, 0.2119034982, 0.0883024619, 0.5363325363, 0.6806995451, 0.2817188376, 0.0514459929, 0.1073969566, 0.6299787005) * c;
  l = pow(max(l, 0.0), vec3(1.0 / 3.0));
  return mat3(0.2104542553, 1.9779984951, 0.0259040371, 0.7936177850, -2.4285922050, 0.7827717662, -0.0040720468, 0.4505937099, -0.8086757660) * l;
}
vec3 fromOk(vec3 k) {
  vec3 l = mat3(1.0, 1.0, 1.0, 0.3963377774, -0.1055613458, -0.0894841775, 0.2158037573, -0.0638541728, -1.2914855480) * k;
  l = l * l * l;
  return mat3(4.0767416621, -1.2684380046, -0.0041960863, -3.3077115913, 2.6097574011, -0.7034186147, 0.2309699292, -0.3413193965, 1.7076147010) * l;
}
float hueWin(float h, float lo, float hi) { return smoothstep(lo - 20.0, lo, h) * smoothstep(hi + 20.0, hi, h); }
vec3 enamel(vec3 c, vec2 uv) {
  vec3 z = texture(uGrade, uv).rgb;
  if (z.r + z.g + z.b < 0.004) return c;
  vec3 k = toOk(c);
  float ch = length(k.yz);
  float h = degrees(atan(k.z, k.y));
  float cw = smoothstep(0.015, 0.045, ch);
  float wy = z.r * hueWin(h, 50.0, 108.0) * cw;
  float wo = z.g * hueWin(h, 30.0, 85.0) * cw;
  float wg = z.b * hueWin(h, 115.0, 150.0) * cw;
  float sc = max(1.0 - 0.55 * wy - 0.7 * wo - 0.5 * wg, 0.0);
  float a = radians(-8.0 * wy - 15.0 * wo);
  k.yz = mat2(cos(a), sin(a), -sin(a), cos(a)) * k.yz * sc;
  return max(fromOk(k), 0.0) * exp2(-0.5 * (wy + wo));
}

// The photograph's own dirt. The sunlit plaster under the house's eave
// (photo px 95..265 x 1285..1405) is shot at 2.7 mm a pixel from 4.3 m, the
// scale the mirror's paint is seen at, so its stipple and stains, high-passed
// against their own 16 px mean, are the grime's fine texture: the same tooth
// as the wall the pole stands in front of. Mirrored to tile; > 0 is darker.
float photoDirt(vec2 m) {
  vec2 px = m * 370.0;
  const vec2 R = vec2(170.0, 120.0);
  vec2 t = abs(mod(px, 2.0 * R) - R);
  vec2 uv = (vec2(95.0, 1285.0) + t) / uPhotoSize;
  float l = dot(textureLod(uPhoto, uv, 0.6).rgb, LUMA);
  float l4 = dot(textureLod(uPhoto, uv, 4.0).rgb, LUMA);
  return clamp(1.0 - l / max(l4, 1e-3), -1.0, 1.0);
}

// The plate's shoulder, for paint in sun. The film's curve would take a
// vermilion's red channel alone over white (1.3 in full sun against a white
// point of 1.2) and bleach the lit side toward pink-white; so it is judged,
// as the glass's sun is, on the brightest channel through the film's
// highlight tint, and past the knee (what develops to 0.8) the whole colour
// is scaled down on an exponential toward a ceiling well under white (half
// way to what develops to 0.97). Its channels keep their ratio: the lit side
// rolls off as a warm orange, never past about 240.
vec3 paintShoulder(vec3 c) {
  float m = max(max(c.r * uHiTint.r, c.g * uHiTint.g), c.b * uHiTint.b);
  float kn = uSunTone.x, top = mix(uSunTone.x, uSunTone.y, 0.5);
  if (m <= kn) return c;
  float m2 = kn + (top - kn) * (1.0 - exp(-(m - kn) / (top - kn)));
  return c * (m2 / m);
}

vec3 paint(vec3 p, vec3 n, float id, vec3 v) {
  vec3 q = toLocal(p);
  float occ = ao(p, n);
  // カーブミラー vermilion: the road mirror's baked enamel, #E8541E as
  // linear albedo (before the film's grade). It holds its chroma: only the
  // faces turned to the sky carry a thin chalk bloom, and grime and chips
  // below darken it rather than wash it toward tan.
  vec3 alb = vec3(0.807, 0.089, 0.0123);
  float upF = clamp(n.y, 0.0, 1.0);
  float chalk = 0.015 + 0.06 * upF;
  alb = mix(alb, vec3(dot(alb, LUMA)) * vec3(1.6, 1.0, 0.75), chalk);

  // surface coordinates in metres: on the pole and band its unrolled
  // circumference and height, on the arm along it, on the frame ring its
  // unrolled circumference and the section (radius, then depth round the
  // lip, so a chip on the lip is not a stripe drawn straight through it), on
  // the shell face-local with its depth folded in
  bool tube = id == 4.0 || id == 5.0;
  float rq = length(q.xy);
  vec2 wc = tube ? vec2(atan(p.x - uPivot.x, p.z - uPivot.z) * POLE_R, p.y)
    : id == 3.0 ? vec2(dot(p - uHinge, uHz) + dot(p - uHinge, uX), p.y)
    : id == 1.0 ? vec2(atan(q.y, q.x) * (A + 0.02), rq - q.z)
    : q.xy + q.z;
  // which way is down on this surface (rain runs that way)
  float down = tube ? p.y : q.y;
  float dirt = photoDirt(wc + vec2(id * 0.37, 0.0));
  float n1 = fbm(wc * 22.0);
  // Grime. Rain runs down off the frame and the clamp and leaves streaks a
  // centimetre or two wide and tens long; dust and soot sit in what the AO
  // says is sheltered (under the rim, in the band's seam, the back of the
  // shell); road splash climbs the pole's lower two metres.
  float run = fbm(vec2(wc.x * 55.0, down * 2.2) + 5.0 + id);
  float streak = smoothstep(0.5, 0.78, run);
  if (id == 1.0 || id == 2.0) streak *= smoothstep(0.25, -0.3, q.y / A);   // below the top of the head
  if (id == 4.0) streak *= 0.45 + 0.55 * smoothstep(0.9, 0.0, uPivot.y - p.y); // freshest under the clamp
  float sheltered = 1.0 - occ;
  float under = id == 1.0 ? smoothstep(0.1, -0.9, dot(n, uU)) * 0.45 : 0.0;
  float splash = id == 4.0 ? smoothstep(2.1, 0.0, p.y - uGround) * 0.55 : 0.0;
  float band = id == 5.0 ? 0.55 : id == 3.0 ? 0.4 : 0.0;
  // run-off from the clamp: the band's bolts bleed a thin brown stain down the pole
  float bleed = id == 4.0 ? smoothstep(0.012, 0.0, abs(wc.x - 0.035 + 0.006 * sin(p.y * 9.0))) * smoothstep(0.75, 0.0, uPivot.y - p.y) : 0.0;
  float grime = clamp(0.5 * streak + under + splash + band + 1.2 * sheltered + 1.5 * max(dirt, 0.0) + 0.15 * smoothstep(0.5, 0.8, n1), 0.0, 1.0);
  alb = mix(alb, alb * vec3(0.62, 0.5, 0.45) + vec3(0.012, 0.009, 0.006), grime * 0.4);
  alb = mix(alb, vec3(0.12, 0.06, 0.035), bleed * 0.55);
  // and the plaster's own stipple, faintly, everywhere: the paint is not a
  // flat colour but has the wall's tooth
  alb *= 1.0 - 0.6 * clamp(dirt, -0.25, 0.25);

  // Chips: paint knocked off to dark, weathered steel, a few millimetres to
  // two centimetres, with a rust-brown rim where it lifts; most at exposed
  // edges (the frame's outer lip, the band) and low on the pole where things
  // hit it, never on a sheltered face.
  float edge = id == 1.0 ? smoothstep(0.3, 0.9, abs(dot(n, uN))) * 0.3 + smoothstep(A + FRAME_W - 0.008, A + FRAME_W, length(q.xy)) : 0.0;
  float chipBias = id == 4.0 ? 0.25 * smoothstep(1.4, 0.0, p.y - uGround) + 0.12 : id == 5.0 ? 0.4 : id == 3.0 ? 0.3 : id == 1.0 ? 0.06 + 0.16 * edge : 0.08;
  vec2 cw = wc * 48.0;
  cw += vec2(fbm(cw * 0.7 + 3.1), fbm(cw * 0.7 + 8.4)) * 1.4;
  float cn = fbm(cw) + 0.35 * dirt + chipBias * 0.45;
  float chip = smoothstep(0.775, 0.8, cn) * occ;
  float chipRim = smoothstep(0.725, 0.775, cn) * (1.0 - chip) * occ;
  alb = mix(alb, alb * vec3(0.55, 0.42, 0.35), chipRim * 0.6);
  alb = mix(alb, vec3(0.07, 0.058, 0.05) * (0.8 + 0.4 * n1), chip);
  // the clamp band and bracket: castings, painted with the pole but worn darker
  if (id == 5.0 || id == 3.0) alb = mix(alb, vec3(0.13, 0.12, 0.11), 0.3);
  // the black rubber gasket where the frame meets the acrylic
  float gasket = id == 1.0 ? smoothstep(A + 0.009, A + 0.004, length(q.xy)) : 0.0;
  alb = mix(alb, vec3(0.035, 0.034, 0.033), gasket);

  // Lit as the crossing is: the measured sun at full strength, a hard Lambert
  // terminator (the wall's own shadow edges are crisp, so no wrap and a sharp
  // self-shadow). Its strength is the plate's: the sunlit plaster under the
  // eave reads 0.57 linear facing the sun at 60 degrees, which for lime
  // plaster puts the direct sun at 1.45x the glass's nominal figure.
  float sunE = uSunE * 1.45;
  float ndl = max(dot(n, uSun), 0.0);
  float sh = ndl > 0.0 ? softShadow(p + n * 0.003, uSun, 0.004, 3.0, 64.0) : 0.0;
  // The shade side is lit by the sky alone, and it is dim and cold: the
  // crossbuck pole's yellow reads 0.25-0.9 linear red on its sun side and
  // 0.085 in its shade, an order of magnitude, so the panorama's irradiance
  // (which still holds the lit street's bounce) is cut to the open sky's
  // share and cooled toward its cyan. Vermilion in that light is near black.
  vec3 Ei = irradiance(n);
  vec3 Es = irradiance(normalize(n + vec3(0.0, 1.1, 0.0)));
  vec3 Esky = Es * (dot(Ei, LUMA) / max(dot(Es, LUMA), 1e-4));
  const vec3 FILL = vec3(0.4, 0.56, 0.78);
  vec3 amb = mix(Ei, Esky, 0.5) * FILL * occ;
  // under the visor the paint faces the dome, and the dome throws the sky
  // back up into it: the hood's underside is the frame's colour in shade,
  // not a black slot
  if (id == 1.0) {
    vec3 rad = normalize(uX * q.x + uU * q.y + vec3(1e-5));
    float inner = smoothstep(0.2, -0.7, dot(n, rad)) * smoothstep(ZF - 0.01, ZF + 0.015, q.z);
    amb += irradiance(uN) * FILL * 0.45 * inner;
  }
  vec3 sunC = vec3(1.0, 0.96, 0.88);
  vec3 diff = alb * (sunC * sunE / PI * ndl * sh + amb / PI);

  // The head (frame, visor and shell) is twenty years of roadside sun on
  // baked enamel: the binder chalked, the gloss gone, a rough dielectric.
  // Roughness 0.55..0.65 (a little higher on bare steel), F0 0.04, and its
  // specular is the panorama prefiltered to that lobe's width, a mip read and
  // weighted by the split-sum's analytic fit (Karis), not a sun lobe: the sky
  // and street lay a faint sheen across it, and the sunlit side is simply
  // paint in sun, so a head turned to the light reads as matte steel, never a
  // flashlight spot. The pole and bracket below keep their rain-polished
  // streak.
  if (id == 1.0 || id == 2.0) {
    float rH = clamp(0.6 + 0.08 * (n1 - 0.5) + 0.1 * max(dirt, 0.0) + 0.12 * chip, 0.55, 0.72);
    float ndvH = max(dot(n, v), 1e-3);
    const vec4 C0 = vec4(-1.0, -0.0275, -0.572, 0.022);
    const vec4 C1 = vec4(1.0, 0.0425, 1.04, -0.04);
    vec4 rr = rH * C0 + C1;
    float a004 = min(rr.x * rr.x, exp2(-9.28 * ndvH)) * rr.x + rr.y;
    vec2 AB = vec2(-1.04, 1.04) * a004 + rr.zw;
    // the lobe's width in the 4096 px panorama: about 60 degrees across at
    // this roughness, a mip of 8 to 9
    vec3 rH3 = reflect(-v, n);
    vec3 specH = env(rH3, 5.2 + 5.5 * rH) * (0.04 * AB.x + AB.y) * occ * (1.0 - gasket);
    return paintShoulder(diff + specH);
  }

  // The roughness map: the enamel keeps its gloss only where it is intact.
  // Chalk, grime, the plaster-tooth dirt and every chip take it away, so the
  // sun's streak breaks up along the pole instead of running like chrome.
  float rough = clamp(0.3 + 0.35 * grime + 0.6 * chalk + 0.5 * chip + 0.25 * chipRim + 1.2 * max(dirt, 0.0) + 0.12 * (n1 - 0.5), 0.2, 1.0);
  float gloss = 1.0 - smoothstep(0.35, 0.85, rough);
  float a = rough * rough;
  float F0 = 0.04;
  float ndv = max(dot(n, v), 1e-3);
  float Fr = F0 + (max(1.0 - rough, F0) - F0) * pow(1.0 - ndv, 5.0);
  // and the chalk's own masking: at grazing a powdery film shows no gloss,
  // so the silhouette stays the paint's colour, darkening into the plate
  float Gv = 2.0 * ndv / (ndv + sqrt(a * a + (1.0 - a * a) * ndv * ndv)) * smoothstep(0.04, 0.4, ndv);
  vec3 r = reflect(-v, n);
  vec3 spec = env(r, 4.0 + 4.0 * rough) * Fr * Gv * occ * (0.25 + 0.75 * gloss) * 0.35;

  // The sun's highlight. Pipe and rim are drawn and brushed along their
  // length, and rain has worn them the same way: the lobe is anisotropic,
  // long along the grain and narrow across it, so on the pole it is a streak
  // running down the sun side of the cylinder and on the rim it lies along
  // the top curve, broken wherever the roughness map says the gloss is gone.
  vec3 h = normalize(uSun + v);
  float ndh = max(dot(n, h), 0.0);
  float vdh = max(dot(v, h), 0.0);
  vec3 g = grainDir(p, id);
  float D;
  if (dot(g, g) > 0.0) {
    vec3 T = normalize(g - n * dot(g, n) + vec3(1e-5));
    vec3 B = cross(n, T);
    // the rim's section is only 13 mm round: a wider lobe across it, so the
    // highlight lies along its top as a band, not a hairline on the silhouette
    float at = 0.55 + 0.25 * (1.0 - gloss), ab = (id == 1.0 ? 0.13 : 0.07) + 0.1 * (1.0 - gloss);
    float th = dot(T, h) / at, bh = dot(B, h) / ab;
    float k = th * th + bh * bh + ndh * ndh;
    D = 1.0 / (PI * at * ab * k * k);
  } else {
    float a2 = a * a;
    D = a2 / (PI * pow(ndh * ndh * (a2 - 1.0) + 1.0, 2.0));
  }
  // Its strength is set against the plate, not the enamel's 4 % Fresnel
  // alone: the crossing's own poles carry a sun-side band clearly brighter
  // than their paint, the binder's glaze where rain has polished it, so the
  // lobe is given 2x (and a dirtier, matte patch still loses most of it):
  // a narrow white streak on the vermilion, not a pink wash across it.
  float Fs = F0 + (1.0 - F0) * pow(1.0 - vdh, 5.0);
  float Gl = 2.0 * ndl / (ndl + sqrt(a * a + (1.0 - a * a) * ndl * ndl));
  spec += sunC * sunE * sh * D * Fs * Gv * Gl / (4.0 * ndv) * (0.15 + 0.85 * gloss) * (1.0 - gasket) * 2.0;
  return paintShoulder(diff + spec);
}

// ---------------------------------------------------------------- the glass
// dust and one smudge on the face, in face-local metres
float dustAt(vec2 q) {
  float specks = smoothstep(0.78, 0.95, vnoise(q * 900.0)) * 0.6 + smoothstep(0.7, 0.9, vnoise(q * 2300.0 + 7.0)) * 0.4;
  float film = fbm(q * 9.0) * 0.5 + 0.35 * smoothstep(0.1, -0.4, q.y / A);   // settles low
  float rim = smoothstep(A - 0.08, A, length(q));
  return clamp(0.25 * film + 0.5 * specks * (0.4 + film) + 0.25 * rim * film, 0.0, 1.0);
}
float smudgeAt(vec2 q) {
  vec2 c = vec2(0.17, -0.13);
  mat2 rt = mat2(0.86, 0.5, -0.5, 0.86);
  vec2 d = rt * (q - c);
  float oval = exp(-dot(d / vec2(0.042, 0.03), d / vec2(0.042, 0.03)));
  // a wipe drags it into a short comet toward the rim
  vec2 w = rt * (q - c - vec2(0.05, -0.035));
  float wipe = exp(-dot(w / vec2(0.075, 0.016), w / vec2(0.075, 0.016))) * 0.6;
  float ridges = 0.7 + 0.3 * sin(length(d * vec2(1.0, 1.3)) * 2400.0);
  return clamp((oval * ridges + wipe) * (0.7 + 0.6 * fbm(q * 60.0)), 0.0, 1.0);
}

// The visor's underside and the frame, as the glass sees them: the same
// faded, grimed paint in shade, lit by what reaches under the hood: the
// ground's bounce, and the sky the dome itself throws back up into it
vec3 headSeen(vec3 nl) {
  vec3 n = normalize(uX * nl.x + uU * nl.y + uN * nl.z);
  vec3 alb = vec3(0.807, 0.089, 0.0123) * 0.7;
  vec3 E = (irradiance(n) * 0.6 + irradiance(uN) * 0.45) * vec3(0.4, 0.56, 0.78);
  return alb * (E + vec3(1.0, 0.96, 0.88) * uSunE * 1.45 * max(dot(n, uSun), 0.0) * 0.5) / PI;
}

// How much of the hood a reflected ray r from face-local q meets, over a
// footprint of spread (rad); xh where it met (or passed closest).
// gHoodK narrows the footprint for one of several rays across a pixel, so
// that the pixel's coverage of the hood comes from the rays themselves.
float gHoodK = 1.0;
// how far into its shoulder the glass's last pixel took the sun (0..1), the
// source of the halation the optics pass spreads round it
float gSunX = 0.0;
float hoodSeen(vec3 q, vec3 r, float spread, out vec3 xh) {
  vec3 rl = vec3(dot(r, uX), dot(r, uU), dot(r, uN));
  float th = 0.003, bestA = 1e9, bestT = th;
  float sp = max(spread, 5e-5);
  bool hh = false;
  for (int i = 0; i < 48; i++) {
    float h = sdHead(q + rl * th);
    if (h / th < bestA) { bestA = h / th; bestT = th; }
    if (h < 0.25 * sp * th) { hh = true; break; }
    th += max(h, 0.0004);
    if (th > 0.32) break;
  }
  if (!hh) th = bestT;
  xh = q + rl * th;
  return hh ? 1.0 : 1.0 - smoothstep(0.25 * sp, 1.55 * sp, bestA);
}

// The plate's graded clear sky by elevation (sky_grade.py's target, the
// same HSV stops), and the sky the glass is given: the same gradient from
// where it stands round the mirror (about 30 degrees up) to the zenith.
vec3 hsv2lin(float h, float s, float v) {
  vec3 k = clamp(abs(mod(h / 60.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return srgb2lin(v * mix(vec3(1.0), k, s));
}
vec3 skyT(float el) {
  const float E[8] = float[8](-5.0, 0.0, 10.0, 20.0, 35.0, 50.0, 70.0, 90.0);
  const float Hh[8] = float[8](212.0, 212.0, 211.5, 211.0, 210.0, 209.5, 209.0, 209.0);
  const float Ss[8] = float[8](0.28, 0.30, 0.36, 0.42, 0.49, 0.55, 0.60, 0.63);
  const float Vv[8] = float[8](0.91, 0.90, 0.88, 0.84, 0.76, 0.67, 0.60, 0.56);
  el = clamp(el, -5.0, 90.0);
  int i = 0;
  for (int k = 0; k < 6; k++) if (el > E[k + 1]) i = k + 1;
  float f = clamp((el - E[i]) / (E[i + 1] - E[i]), 0.0, 1.0);
  return hsv2lin(mix(Hh[i], Hh[i + 1], f), mix(Ss[i], Ss[i + 1], f), mix(Vv[i], Vv[i + 1], f));
}
vec3 skyG(float el) { return skyT(32.0 + 0.64 * max(el, 0.0)); }

// spread: the angular footprint of a pixel in the reflection; aa: of the face
// in metres; both taken in main, where every pixel of the quad runs them
vec3 glass(vec3 P, vec3 d, vec3 S, float spread, float aa) {
  vec3 Ng = normalize(P - S);
  vec3 q = toLocal(P);
  // acrylic is thermoformed, never perfect: a slow waviness of the normal
  vec2 w = vec2(sin(q.x * 31.0 + q.y * 7.0) + 0.6 * sin(q.y * 47.0 - q.x * 13.0), sin(q.y * 29.0 - q.x * 11.0) + 0.6 * sin(q.x * 53.0 + q.y * 5.0));
  vec3 Nn = normalize(Ng + (uX * w.x + uU * w.y) * 0.0009);
  vec3 r = reflect(d, Nn);
  // parallax: the panorama is centred on the mirror at rest, the face is 0.8 m wide
  vec3 o = P - uM;
  vec3 dir = r;
  for (int i = 0; i < 2; i++) {
    float t = envDist(dir);
    dir = normalize(o + r * t);
  }
  // footprint of this pixel in the panorama (ray differentials), opened a
  // third of a mip past the box footprint: the plate is a scan of film, its
  // finest edge spread over a couple of pixels, and a reflection drawn any
  // sharper than the photograph round it reads as an inset, not as glass in
  // this street. (A wire is still one dark line, as the plate's own are.)
  float dust = dustAt(q.xy);
  float smudge = smudgeAt(q.xy);
  vec3 c = envGrad(dir, exp2(0.35 + 2.5 * smudge));
  // The 360 behind the lens is developed in the bake (develop.py): under the
  // photo's sun, colour-transferred band by band to the plate's sunlit walls
  // and paving, its road's highlights rolled off warm, its greens taken to
  // the plate's foliage, its tone-mapped crispness let down. So the whole
  // panorama, the photograph's own pixels and the 360 alike, is graded here
  // the one way. Where it is the photograph is still told (fromPhoto), and,
  // above the horizon, where the 360 is surface rather than sky (above): the
  // 360's distances only hold below it, so there the two are told by their
  // neighbourhood, warm or grey, not blue and bright.
  float dE = envDist(dir);
  vec3 cam = transpose(uR) * (uM + dir * dE);
  vec2 ppx = uC + uF * vec2(cam.x, -cam.y) / max(-cam.z, 1e-4);
  float pin = min(min(ppx.x, uPhotoSize.x - ppx.x), min(ppx.y, uPhotoSize.y - ppx.y));
  float fromPhoto = cam.z < 0.0 ? smoothstep(0.0, 160.0, pin) : 0.0;
  // the plate's enamels graded as the plate's are, where the glass shows them
  if (fromPhoto > 0.0) c = mix(c, enamel(c, ppx / uPhotoSize), fromPhoto);
  vec3 nb = env(dir, 5.0);
  float nbC = (nb.b - nb.r) / max(nb.b, 1e-3);
  float above = smoothstep(0.28, 0.15, nbC) * smoothstep(0.62, 0.4, dot(nb, LUMA));

  // The sky. The panorama's sky (and the photograph's, re-projected) is the
  // plate's graded clear sky by elevation, which near the horizon is the
  // milky band over the roofs: in the glass, under the old veil, it read as a
  // pale grey-blue strip, not the sky the mirror stands in. It is taken to
  // the cobalt the plate shows round the mirror itself, still by the
  // reflected elevation (skyG), as sky_grade.py does it: the clear sky
  // rescaled to the new colour, a cloud given the difference so it keeps its
  // own light, a wire across it its darkness.
  float el = degrees(asin(clamp(dir.y, -1.0, 1.0)));
  vec3 T0 = skyT(el);
  vec3 T1 = skyG(el);
  float wPhoto = fromPhoto * texture(uAux, ppx / uPhotoSize).b;
  float wPano = (1.0 - fromPhoto) * smoothstep(0.14, 0.26, nbC) * smoothstep(-1.0, 4.0, el) * (1.0 - above);
  float lr = dot(c, LUMA) / max(dot(T0, LUMA), 1e-4);
  float wSky = max(wPhoto, wPano) * smoothstep(0.35, 0.7, lr);
  float cloud = smoothstep(1.03, 1.35, lr);
  vec3 sk = mix(c * T1 / T0, c + 0.35 * (T1 - T0), cloud);
  c = mix(c, max(sk, 0.0), wSky);

  // The plate's grade. The glass returns ~85 % of this, so what it shows
  // has to stand at the plate's own exposure, not a stop under it: lifted
  // only to make up the aluminium's loss (the panorama carries the sun
  // already, the 360 from its development), the black point held, then
  // rolled on a shoulder toward the plate's sunlit white (the photo's sunlit
  // plaster reaches 0.70 linear at its 98th percentile), so a white wall in
  // the glass lands where the wall beside it does and nothing clips.
  float lift = mix(exp2(0.2), 1.12, wSky);
  float cl = max(dot(c, LUMA), 1e-5);
  float lb = cl * lift;
  // the shoulder is judged on luminance or, for a vivid sign or a flower,
  // its strongest channel, so a red does not clip on its own
  float mxc = max(max(c.r, c.g), c.b) / cl;
  float yb = lb * max(1.0, 0.72 * mxc);
  const float KN = 0.44, WC = 0.9;
  float yt = yb < KN ? yb : KN + (WC - KN) * (1.0 - exp(-(yb - KN) / (WC - KN)));
  c *= (lb / cl) * (yt / max(yb, 1e-6));
  // the plate's own slight vibrance, nothing more: the street was given its
  // colour in the bake, and a vibrance here lifted a grey curtain behind a
  // window to a pastel green and pink
  c = max(mix(vec3(dot(c, LUMA)), c, 1.06), 0.0);

  // The mirror sees its own head. A reflected ray that runs up under the
  // visor (or, from the very rim, back across the frame's face) meets paint,
  // not sky: traced against the frame and hood, anti-aliased by its closest
  // pass against this pixel's spread, so the crown of the reflection carries
  // the hood's dark underside, as every real one does.
  vec3 xh;
  float hoodC = hoodSeen(q, r, spread * gHoodK, xh);
  if (hoodC > 0.0) {
    const vec2 k = vec2(1.0, -1.0);
    const float e = 0.0008;
    vec3 nl = normalize(k.xyy * sdHead(xh + k.xyy * e) + k.yyx * sdHead(xh + k.yyx * e) + k.yxy * sdHead(xh + k.yxy * e) + k.xxx * sdHead(xh + k.xxx * e));
    c = mix(c, headSeen(nl), hoodC);
  }

  // How much of the sun reaches this point of the face: the visor and the
  // frame's lip throw their shadow onto the top of the dome.
  float lit = max(dot(Nn, uSun), 0.0);
  float sunVis = lit > 0.0 ? softShadow(P + Ng * 0.003, uSun, 0.006, 0.6, 24.0) : 0.0;

  // The lip. Where the dome meets the frame the sheet turns into its wall,
  // the aluminising stops and the gasket holds it: a dark contact band 3 mm
  // wide; and inside it the frame and visor take sky from the glass, a soft
  // occlusion over the outer centimetres, deepest under the hood.
  float rq = length(q.xy);
  float rr = rq / A;
  float edgeM = A - rq;
  float topW = smoothstep(-0.3, 0.75, q.y / A);
  float cw = max(0.003, 1.2 * aa);
  float contact = mix(0.2, 1.0, smoothstep(cw * 0.4, cw + aa, edgeM));
  float lipAO = 1.0 - (0.14 + 0.3 * topW) * exp(-edgeM / 0.016);

  // Second-surface acrylic, n 1.49: the aluminised back returns ~92 % of
  // what gets through the front, twice through 3 mm of faintly cool acrylic,
  // a little dimmer toward the rim where the path through the sheet is longer.
  float cosi = max(dot(-d, Nn), 0.0);
  float F = 0.039 + 0.961 * pow(1.0 - cosi, 5.0);
  float cost = sqrt(1.0 - (1.0 - cosi * cosi) / (1.49 * 1.49));
  vec3 absorb = exp(-vec3(0.03, 0.02, 0.012) * 2.0 / cost);
  float vig = 1.0 - 0.12 * smoothstep(0.3, 1.0, rr * rr);
  vec3 back = c * 0.92 * (1.0 - F) * (1.0 - F) * absorb * vig * mix(1.0, lipAO, 0.5);

  // The front face is a dome, and it has to read as one. Its own reflection
  // is Schlick-weighted on the dome's curvature: the face's 14 degrees of
  // tilt at the rim, read three times over (the weathered surface's haze
  // spreads the grazing lobe inward), so the reflectance climbs toward the
  // rim, most on the side turned away from the eye, as a faint, cool sheen
  // of the sky over the image, the brightening a curved sheet has and a
  // flat print does not. Head on, the front face's 4 % is the same sharp
  // image as the back's, not a blurred sky laid over it: the sheen has no
  // floor, so the middle of the glass carries no grey veil.
  vec3 tilt = Ng - uN * dot(Ng, uN);
  vec3 Nb = normalize(uN + tilt * 3.0);
  float cb = max(dot(-d, Nb), 0.0);
  float Fb = 0.04 + 0.96 * pow(1.0 - cb, 5.0);
  vec3 skyC = irradiance(normalize(Nb + vec3(0.0, 0.8, 0.0))) / PI * vec3(0.9, 1.0, 1.1);
  vec3 sheenL = mix(env(r, 6.5), skyC, 0.45);
  float rimF = 1.6 * (Fb - 0.04) + 0.06 * pow(smoothstep(0.6, 1.0, rr), 2.0);
  float fr = 0.88 * (1.0 - F) * (1.0 - F) * vig + F;
  c = back + c * F + sheenL * rimF * 0.9 * (0.5 + 0.5 * smoothstep(-0.3, 0.6, Nb.y)) * lipAO * (1.0 - 0.85 * hoodC);

  // The zenith's broad specular: the bright sky overhead laid across the
  // upper bulge as one soft gloss lobe (GGX, alpha 0.7, on the dome's
  // curvature), so the dome is lit from above like any rounded thing
  // outdoors: a gloss over the upper half that fades down the face, sliding
  // over it as it tips, cut off where the visor hangs over it.
  vec3 zen = env(vec3(0.0, 1.0, 0.0), 7.5);
  vec3 hz = normalize(vec3(0.0, 1.0, 0.0) - d);
  float nz = max(dot(Nb, hz), 0.0);
  const float ZA2 = 0.3;
  float zl = ZA2 * ZA2 / pow(nz * nz * (ZA2 - 1.0) + 1.0, 2.0);
  float upper = smoothstep(-0.6, 0.7, q.y / A);
  c += mix(zen, skyC, 0.3) * zl * upper * (0.12 + 2.0 * (Fb - 0.04)) * lipAO * (1.0 - hoodC);

  // The shoulder: the last centimetre of the dome, where the thermoformed
  // sheet rolls over into its wall. Its normal turns out toward the rim, so
  // at near-grazing it catches whatever is beside the mirror, sky mostly, in
  // a thin bright line just inside the dark contact band: the edge of a sheet
  // with thickness, not the edge of a print.
  vec3 radial = (uX * q.x + uU * q.y) / max(rq, 1e-4);
  float roll = smoothstep(0.011, 0.0035, edgeM);
  float shoulder = roll * smoothstep(cw * 0.6, cw * 1.5 + aa, edgeM);
  vec3 nS = normalize(Ng + radial * 2.2 * roll);
  vec3 rS = reflect(d, nS);
  float cS = max(dot(-d, nS), 0.0);
  float FS = 0.04 + 0.96 * pow(1.0 - cS, 5.0);
  vec3 lS = mix(env(rS, 3.5), skyC, 0.35);
  c += lS * (0.12 + FS) * shoulder * (1.0 - 0.75 * topW);

  // dust and smudge scatter the sky a little into what the face returns
  vec3 sky = irradiance(Nn) / PI;
  c = c * (1.0 - 0.06 * dust - 0.12 * smudge) + (dust * 0.006 + smudge * 0.035) * sky * lipAO;

  // The sun. Everything it puts on the face is gathered apart from the
  // glass's image of the world, so it is developed as light instead of added
  // on top: added linearly, its disc ran four orders past white, clipped to a
  // flat plate, and the film's diffusion spread that into a cold white blot
  // ten times the sun's size. Its colour is the sun's own warm-neutral as it
  // should come out of the development, 1 : 0.96 : 0.88, worked back through
  // the film's cool highlight tint and its per-channel shoulder (which would
  // otherwise bleach it to grey-white).
  vec3 SUNW = uSunW;
  float lv = sunVis * (1.0 - hoodC);
  // the haze's broad lobe of it: a soft glow that sits where the dome turns
  // toward it and slides across the face as it turns
  vec3 hv = normalize(uSun - d);
  float nh = max(dot(Nn, hv), 0.0);
  const float HA2 = 0.035;
  float lobe = HA2 / (PI * pow(nh * nh * (HA2 - 1.0) + 1.0, 2.0));
  vec3 sunC = SUNW * uSunE * lit * sunVis * lobe * F * 0.3;
  // its disc, never smaller than a pixel, energy kept, its edge soft; round
  // it an aureole, the light the acrylic's micro-roughness and its weathered
  // haze throw a few disc widths wide (falling as the cube of the angle, as
  // a rough surface's near-specular tail does), which is what makes a sun in
  // a mirror a glow with a hot centre, not a coin
  float ang = acos(clamp(dot(r, uSun), -1.0, 1.0));
  float sunR = 0.00465;
  float rEff = max(sunR, spread * 0.75);
  float disc = smoothstep(rEff * 1.2, rEff * 0.3, ang) * (sunR * sunR) / (rEff * rEff);
  float sunL = uSunE / (PI * sunR * sunR);    // radiance of the disc
  float xa = ang / sunR;
  float aureole = 160.0 * pow(1.0 + xa * xa, -1.5);
  sunC += SUNW * (sunL * disc + aureole) * fr * uSunDisc * lv * (1.0 - 0.6 * smudge) * (1.0 - 0.1 * dust - 0.15 * smudge);
  // dust and smudge scatter it a lot when it is near the mirrored direction,
  // and the weathered face as a whole a little: a glare a few degrees wide
  // round the disc, with a long faint skirt, which carries the sun's
  // brightness out across the glass the way a lens sees it
  float fwd = exp(-ang / 0.035) * 10.0 + exp(-ang / 0.12) * 1.5 + exp(-ang / 0.4) * 0.25 + 0.03;
  sunC += SUNW * (dust * 0.25 + smudge * 0.5) * uSunE / PI * lit * sunVis * fwd * 0.12;
  sunC += SUNW * (2.4 * exp(-ang / 0.02) + 1.0 * exp(-ang / 0.075) + 0.25 * exp(-ang / 0.26)) * lit * lv;

  // The shoulder. A soft knee, judged on the brightest channel as the film
  // will see it: below the knee the sun adds as light does; past it the sum
  // rolls on an exponential toward a ceiling just under the paper's white, and
  // as it rolls its colour goes to the sun's own. Only the sun's share is
  // compressed: the glass's image under it keeps its values. Only the disc's
  // own centre, a pinpoint, is let through past white.
  vec3 tot = c + sunC;
  float mb = max(max(c.r * uHiTint.r, c.g * uHiTint.g), c.b * uHiTint.b);
  float mt = max(max(tot.r * uHiTint.r, tot.g * uHiTint.g), tot.b * uHiTint.b);
  float kn = uSunTone.x, kw = uSunTone.y - uSunTone.x;
  gSunX = 0.0;
  if (mt > kn && mt > mb + 1e-5) {
    float roll = 1.0 - exp(-(mt - kn) / kw);
    float m2 = kn + kw * roll;
    tot = c + sunC * clamp((m2 - mb) / (mt - mb), 0.0, 1.0);
    float mn = max(max(tot.r * uHiTint.r, tot.g * uHiTint.g), tot.b * uHiTint.b);
    tot = mix(tot, SUNW * mn, roll * roll);
    gSunX = roll;
  }
  float core = smoothstep(rEff * 1.3, rEff * 0.3, ang) * lv * fr;
  tot = mix(tot, SUNW * uSunTone.z, clamp(core, 0.0, 1.0));
  gSunX = max(gSunX, core);
  return tot * contact;
}

// The acrylic's wall, standing proud of the frame: clear sheet seen side on.
// A glossy Fresnel reflection, the frame's dark throat through it, and the
// light the sheet pipes along itself escaping at the bend into the dome, a
// thin bright line that draws the dome's edge.
vec3 acrylicWall(vec3 p, vec3 n, vec3 v) {
  vec3 q = toLocal(p);
  float ndv = max(dot(n, v), 0.0);
  float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
  vec3 refl = env(reflect(-v, n), 3.0);
  vec3 E = irradiance(n) / PI;
  vec3 throat = E * vec3(0.12, 0.13, 0.13);
  float bend = smoothstep(-SAG - 0.005, -SAG - 0.0005, q.z);
  vec3 glow = (E * 0.5 + irradiance(uU) / PI * 0.3) * vec3(0.8, 0.95, 0.92) * bend;
  float lit = max(dot(n, uSun), 0.0);
  vec3 sun = vec3(1.0, 0.96, 0.9) * uSunE / PI * lit * 0.12 * (0.4 + bend);
  vec3 c = refl * F + (throat + glow + sun) * (1.0 - F);
  // where the wall turns edge-on it is thinner than a pixel, and its grazing
  // sheen would only alias into a dotted line: it goes to the gasket's dark
  // there, which is also what the eye sees of a sheet's edge at that angle
  // and a ray that only skims the dome's rim from its far side meets the
  // corner, not the wall: that is the dark contact line too
  float side = smoothstep(0.45, 0.2, abs(dot(n, uN)));
  return mix(vec3(0.02, 0.021, 0.022), c, smoothstep(0.08, 0.4, ndv) * side);
}

// ---------------------------------------------------------------- coverage
// the geometry pass's record of a pixel centre: x the distance along its ray,
// y what it meets (0 the photo, 1..5 the painted parts, 6 the acrylic's wall,
// 7 the glass, 8 the glass where it shows the hood)
uniform sampler2D uGeo;
uniform vec2 uRes;         // render target size
vec2 geoAt(ivec2 ip) {
  vec4 g = texelFetch(uGeo, ip, 0);
  return vec2((g.g * 255.0 * 256.0 + g.b * 255.0) / 65535.0 * 16.0, floor(g.r * 8.0 + 0.5));
}

// One ray against the assembly, hit or miss, nothing in between: x the
// distance, y the part (0 for none). Coverage is counted from many of these,
// never guessed from how close one passed.
vec2 trace(vec3 d) {
  vec3 hc = uFace - uN * 0.09;
  vec2 hs = sphereHit(vec3(0.0), d, hc, A + 0.08);
  vec2 hp = cylHit(vec3(0.0), d, uPivot, POLE_R + 0.03);
  float t0 = min(max(hs.x, 0.0), max(hp.x, 0.0));
  float t1 = max(hs.y, hp.y);
  if (t1 <= t0) return vec2(0.0);
  float t = t0;
  vec2 r = vec2(1e9, 0.0);
  for (int i = 0; i < 128; i++) {
    r = sdScene(d * t);
    if (r.x < 0.05 * uPx * t) return vec2(t, r.y);
    t += max(r.x, 0.0004);
    if (t > t1) return vec2(0.0);
  }
  // a ray still creeping along a grazing face when the steps run out
  return r.x < 0.5 * uPx * t ? vec2(t, r.y) : vec2(0.0);
}
// what a traced ray sees: the glass where the exact cap is in front (its
// solid's field is a depth, not a distance, so at grazing the march stops
// short of the dome; only outside the rim is it the wall), else the paint or
// the wall, premultiplied by whether it hit at all
vec4 objectRay(vec3 d, vec2 tr, float spread, float capAA) {
  gSunX = 0.0;
  if (tr.y < 0.5) return vec4(0.0);
  vec3 S = uFace - uN * RC;
  vec2 sh = sphereHit(vec3(0.0), d, S, RC);
  vec3 Pf = d * sh.x;
  if (sh.x > 0.0 && length(toLocal(Pf).xy) < A && (tr.y == 6.0 || sh.x < tr.x + 0.003)) return vec4(glass(Pf, d, S, spread, capAA), 1.0);
  vec3 x = d * tr.x;
  vec3 n = sdNormal(x);
  return vec4(tr.y == 6.0 ? acrylicWall(x, n, -d) : paint(x, n, tr.y, -d), 1.0);
}

void main() {
  vec2 p = vec2(uView.x + vUv.x * uView.z, uView.y + (1.0 - vUv.y) * uView.w);
  vec3 dc = normalize(vec3((p.x - uC.x) / uF, -(p.y - uC.y) / uF, -1.0));
  vec3 d = uR * dc;

  // the exact sphere cap, and its derivatives, here where every pixel of a
  // quad takes them (inside a branch they would be undefined at the rim)
  vec3 S = uFace - uN * RC;
  vec2 sh = sphereHit(vec3(0.0), d, S, RC);
  vec3 Pf = d * sh.x;
  float capRho = length(toLocal(Pf).xy);
  vec3 rCap = reflect(d, normalize(Pf - S));
  float spread = max(length(dFdx(rCap)), length(dFdy(rCap)));
  float capAA = max(fwidth(capRho), 1e-5);
  vec2 euv = envUv(rCap);
  gEnvGx = dFdx(euv);
  gEnvGy = dFdy(euv);
  // across the panorama's seam, and never wider than a few degrees (off the
  // cap's rim the differences mean nothing)
  gEnvGx.x -= floor(gEnvGx.x + 0.5);
  gEnvGy.x -= floor(gEnvGy.x + 0.5);
  gEnvGx = gEnvGx * min(1.0, 0.02 / max(length(gEnvGx), 1e-6));
  gEnvGy = gEnvGy * min(1.0, 0.02 / max(length(gEnvGy), 1e-6));

#ifdef GEO
  // the geometry pass: what the pixel centre meets, and how far; on the
  // glass, whether it shows the hood's underside (that boundary is an edge
  // as hard as any silhouette)
  vec2 tr = trace(d);
  float idc = tr.y;
  if (tr.y > 0.5 && sh.x > 0.0 && capRho < A && (tr.y == 6.0 || sh.x < tr.x + 0.003)) {
    vec3 xh;
    idc = hoodSeen(toLocal(Pf), rCap, spread * 0.3, xh) > 0.5 ? 8.0 : 7.0;
    tr.x = sh.x;
  }
  float tq = floor(clamp(tr.x / 16.0, 0.0, 1.0) * 65535.0 + 0.5);
  outColor = vec4(idc / 8.0, floor(tq / 256.0) / 255.0, mod(tq, 256.0) / 255.0, 1.0);
#else

  // the photograph
  vec3 col = enamel(texture(uPhoto, p / uPhotoSize).rgb, p / uPhotoSize);
  vec4 aux = texture(uAux, p / uPhotoSize);
  // The cumulus' sunlit tops. clouds.py lights them in the bake (tops a
  // warm neutral, its TOP; sides and bellies 0.9 stop under, toward the
  // skylight's blue), but the plate is 8-bit: its whitest white develops through the
  // film's shoulder and cool highlight tint to a blue-grey ~228, no brighter
  // than the plaster. A sunlit cumulus top is the brightest thing in a
  // summer sky, so, in the open sky only, the plate's cloud is carried past
  // 1 by its own luminance: the belly as it is (the lift starts above it,
  // so the shade between a heap's towers keeps its stop), the top to
  // uCloudW, which develops to a warm neutral of about 246, R over G over B.
  const vec3 CLOUD_TOP = vec3(0.93, 0.885, 0.80);  // clouds.py's TOP
  // (a warm-neutral top passes; a board's yellow edge, blue under half its
  // red, does not)
  float cTop = aux.b * smoothstep(0.42, 0.86, dot(col, LUMA)) * smoothstep(-0.45, -0.25, (col.b - col.r) / max(col.r, 1e-3));
  col = mix(col, col * uCloudW / CLOUD_TOP, cTop);
  // the assembly's shadow on it, through the point map
  if (aux.r < 0.995) {
    float z = exp2(mix(uDist.x, uDist.y, aux.r));
    vec3 P = d * (z / -dc.z);
    // reject quickly: far from the head and from the pole's line
    vec3 hc = uFace - uN * 0.08;
    vec3 ph = P - hc;
    float th = max(dot(ph, -uSun), 0.0);
    bool nearHead = length(ph + uSun * th) < 0.62 && dot(ph, uSun) < 0.0;
    vec2 o2 = P.xz - uPivot.xz, s2 = uSun.xz;
    float t2 = -dot(o2, s2) / max(dot(s2, s2), 1e-6);
    vec3 cp = P + uSun * max(t2, 0.0);
    bool nearPole = t2 > 0.0 && length(cp.xz - uPivot.xz) < 0.12 && cp.y < uPivot.y + 0.2;
    if (aux.g > 0.01 && (nearHead || nearPole)) {
      float s = softShadow(P + uSun * 0.02, uSun, 0.02, 8.0, 14.0);
      float k = (1.0 - s) * aux.g;
      // what is left is skylight: about a third, and bluer
      col *= mix(vec3(1.0), vec3(0.30, 0.33, 0.40), k);
    }
  }


  // The assembly, with real coverage. The geometry pass has classified every
  // pixel centre (what it meets, and how far). Where the centre and its eight
  // neighbours agree, the pixel lies inside one surface or out in the photo,
  // and one ray shades it. Where they disagree (a silhouette against the
  // photo, the glass meeting the frame, the visor over the shell, the pole
  // past the clamp), the pixel straddles an edge: eight rays across its
  // area, each traced and shaded on its own, resolved premultiplied, so the
  // photo shows through exactly the share the object leaves uncovered, and
  // no colour from either side bleeds into the other's.
  ivec2 ip = ivec2(gl_FragCoord.xy);
  ivec2 hi = ivec2(uRes) - 1;
  vec2 g0 = geoAt(ip);
  bool edge = false;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      if (i == 0 && j == 0) continue;
      vec2 gn = geoAt(clamp(ip + ivec2(i, j), ivec2(0), hi));
      // a different surface, or the same part folding behind itself
      if (gn.y != g0.y || (g0.y > 0.5 && g0.y < 6.5 && abs(gn.x - g0.x) > 0.025)) edge = true;
    }
  }
  vec4 obj = vec4(0.0);
  float sunX = 0.0;
  if (edge) {
    // rotated eight-rooks pattern: eight distinct offsets on either axis, so
    // an edge at any angle resolves to eight levels
    const vec2 SS[8] = vec2[8](vec2(1, -3), vec2(-1, 3), vec2(5, 1), vec2(-3, -5), vec2(-5, 5), vec2(-7, -1), vec2(3, 7), vec2(7, -7));
    float k = uView.z / uRes.x;
    gHoodK = 0.3;
    for (int s = 0; s < 8; s++) {
      vec2 ps = p + SS[s] / 16.0 * k;
      vec3 ds = uR * normalize(vec3((ps.x - uC.x) / uF, -(ps.y - uC.y) / uF, -1.0));
      obj += objectRay(ds, trace(ds), spread, capAA);
      sunX += gSunX;
    }
    obj /= 8.0;
    sunX /= 8.0;
  } else if (g0.y > 0.5) {
    // inside one surface: its stored depth, polished by a few steps
    vec2 tr = vec2(g0.x, g0.y);
    if (g0.y > 6.5) tr = vec2(sh.x, 6.0);
    else for (int i = 0; i < 4; i++) tr.x += sdf(d * tr.x);
    obj = objectRay(d, tr, spread, capAA);
    sunX = gSunX;
  }
  if (obj.a > 0.0) {
    // The plate's tooth. The photograph carries its sensor's noise and
    // its resample's softness at its own pixel pitch, and a render is clean:
    // the object takes the same, a luminance grain correlated over about
    // two photo pixels (value noise at the photo's pitch), at the level
    // measured on the plate's flat sunlit plaster and sky, rising in the
    // shadows as a sensor's does, so the film's grain lands on both alike.
    float gl = vnoise(p * 0.62) + vnoise(p * 0.62 + vec2(41.3, 17.9)) - 1.0;
    vec3 gc = vec3(vnoise(p * 0.5 + 3.7), vnoise(p * 0.5 + 9.1), vnoise(p * 0.5 + 23.3)) - 0.5;
    float ol = dot(obj.rgb, LUMA) / obj.a;
    obj.rgb *= 1.0 + (0.05 + 0.05 * smoothstep(0.2, 0.02, ol)) * gl + 0.025 * gc;
  }
  // the photograph alone; its alpha (which no development reads) carries
  // the sun's shoulder for the optics pass's halation
  outPhoto = vec4(col * uExpo, sunX);
  // premultiplied over
  col = col * (1.0 - obj.a) + obj.rgb;
  // alpha carries the coverage, and whether this pixel straddles an edge,
  // for the optics pass
  outColor = vec4(col * uExpo, (edge ? 0.5 : 0.0) + 0.49 * obj.a);
#endif
}`;

// The optics pass: only the band the scene pass flagged as straddling an
// edge. The photograph's own edges (the crossing's poles and crossbuck against
// the sky) are measured: a one-pixel step in the plate, which its resample
// and the texture filter spread to about 0.6 photo px (sigma) on screen. A
// supersampled edge is a one-render-pixel box; this adds the rest, a small
// Gaussian, so the object's outline has the plate's MTF. And where paint
// meets bright sky, a little of that sky spills into it, warm (the light the
// emulsion scatters at an edge, red layer first): a thin halation inside the
// outline that dissolves it into the sky the way the real poles are.
// The sun in the glass gets the same, from its own light: wherever the scene
// pass took it into its shoulder, the emulsion's back-scatter lays a thin warm
// ring round it, a couple of css px, kept off the hot centre itself (that
// layer has already saturated there), and running over whatever is next to
// it, the frame's inner rim included.
const OPTICS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uIn;
uniform float uSig;   // edge spread to add, render px (sigma)
uniform float uHalR;  // halation reach, render px (sigma)
uniform float uHal;   // halation strength
uniform vec3 uHalC;   // its tint
uniform sampler2D uSunX;  // a: how far into its shoulder the scene pass took the sun
uniform vec4 uSunBox;     // render px (x0, y0, x1, y1) the glass can reach
uniform float uSunHalR;   // the sun's halation, render px (sigma)
uniform float uSunHal;    // its strength
uniform vec3 uSunHalC;    // its tint
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
float cover(float a) { return clamp((a >= 0.495 ? a - 0.5 : a) / 0.49, 0.0, 1.0); }
// how much of the sun's halation lands here (0..1)
float sunHalation(ivec2 ip, ivec2 hi) {
  vec2 fc = gl_FragCoord.xy;
  if (uSunHal <= 0.0 || fc.x < uSunBox.x || fc.y < uSunBox.y || fc.x > uSunBox.z || fc.y > uSunBox.w) return 0.0;
  float x0 = smoothstep(0.88, 0.97, texelFetch(uSunX, ip, 0).a);
  int R = int(ceil(2.5 * uSunHalR));
  float ih2 = 0.5 / max(uSunHalR * uSunHalR, 1e-4);
  float h = 0.0, hw = 0.0;
  for (int j = -8; j <= 8; j++) {
    if (abs(j) > R) continue;
    for (int i = -8; i <= 8; i++) {
      if (abs(i) > R) continue;
      float w = exp(-float(i * i + j * j) * ih2);
      float x = texelFetch(uSunX, clamp(ip + ivec2(i, j), ivec2(0), hi), 0).a;
      h += w * smoothstep(0.88, 0.97, x);
      hw += w;
    }
  }
  return clamp(uSunHal * (h / hw) * (1.0 - x0), 0.0, 1.0);
}
// The red layer's extra exposure. Laid on light already in its shoulder it
// cannot brighten it, only turn it: the ring shows as a shift of hue toward
// amber at nearly the same value, plus a little red light where the
// surround is darker (the frame's rim, say).
vec3 halate(vec3 c, float k) {
  return c * mix(vec3(1.0), uSunHalC, k) + vec3(0.12, 0.05, 0.02) * k;
}
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  ivec2 hi = textureSize(uIn, 0) - 1;
  vec4 c0 = texelFetch(uIn, ip, 0);
  float sunH = sunHalation(ip, hi);
  bool band = false;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++)
      if (texelFetch(uIn, clamp(ip + ivec2(i, j), ivec2(0), hi), 0).a >= 0.495) band = true;
  if (!band) { outColor = vec4(halate(c0.rgb, sunH), 1.0); return; }
  vec3 acc = vec3(0.0);
  float ws = 0.0, halo = 0.0, hw = 0.0;
  float is2 = 0.5 / max(uSig * uSig, 1e-4), ih2 = 0.5 / max(uHalR * uHalR, 1e-4);
  for (int j = -3; j <= 3; j++) {
    for (int i = -3; i <= 3; i++) {
      vec4 cn = texelFetch(uIn, clamp(ip + ivec2(i, j), ivec2(0), hi), 0);
      float r2 = float(i * i + j * j);
      float w = r2 <= 4.0 ? exp(-r2 * is2) : 0.0;
      acc += cn.rgb * w;
      ws += w;
      // the bright photo round the edge (sky, a lit wall), not the object
      float L = dot(cn.rgb, LUMA);
      float wh = exp(-r2 * ih2);
      halo += wh * (1.0 - cover(cn.a)) * L * smoothstep(0.04, 0.15, L);
      hw += wh;
    }
  }
  vec3 col = acc / ws;
  col += uHalC * uHal * cover(c0.a) * halo / hw;
  outColor = vec4(halate(col, sunH), 1.0);
}`;

// Two developments meet here. The film's dye-cloud bleed carries colour a
// few pixels across every edge, and its summer blue deepens only a sky that
// is still saturated: developed over the mirror, the sky round the orange
// frame took its colour, lost the deepening and came up as a pale rim, the
// tell of an overlay. So the photograph is developed on its own as well, and
// the print is that photograph everywhere the object does not reach; where
// it does, including its antialiased edge (whose share of photo is already
// in it, premultiplied), it is the development with the object in it, which
// carries the sky's light into the paint the way the film does at any edge.
const BLIT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;    // developed with the object
uniform sampler2D uPhotoT; // the photograph developed alone
uniform sampler2D uCov;    // scene pass: alpha carries the object's coverage
uniform sampler2D uRing;   // the halation ring (MIST_RING)
uniform float uHal;        // its strength on the print
uniform vec3 uHalC;        // its tint
uniform float uFade;
uniform vec3 uPaper;
float cover(vec2 uv) {
  float a = texture(uCov, uv).a;
  return clamp((a >= 0.495 ? a - 0.5 : a) / 0.49, 0.0, 1.0);
}
void main() {
  vec2 px = 1.0 / vec2(textureSize(uCov, 0));
  float w = 0.0;
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) w = max(w, cover(vUv + vec2(i, j) * px));
  w = smoothstep(0.0, 0.2, w);
  vec3 c = mix(texture(uPhotoT, vUv).rgb, texture(uTex, vUv).rgb, w);
  // the red layer's bleed, screened on: the grain under it still shows
  c = 1.0 - (1.0 - c) * (1.0 - uHalC * (uHal * texture(uRing, vUv).r));
  outColor = vec4(mix(uPaper, c, uFade), 1.0);
}`;

// The diffusion. A Black Pro-Mist in front of the lens, over the photograph
// and the mirror alike: one optic, so the glass and the plate it stands in
// share one softness and the mirror stops reading as a sharp inset. Only the
// top 15% of the frame's luminance scatters (MIST_K), taken down to a quarter
// of the frame, spread wide and low (a quarter-res and a sixteenth-res
// Gaussian), and screened back over everything at about a quarter, under a
// ceiling that develops just short of white, so the clouds glow and roll off
// into the sky instead of standing cut out, without one more pixel clipping.
// All of it in scene light, before development, so the film's grain lands on
// top of the glow, as it would on the negative. Then the emulsion's
// halation: the red layer's own highlights, spread a couple of device px and
// kept only where they fall outward onto something whose red is darker, a
// thin warm ring, so the sky at a cloud's edge, a wire or an eave across it
// picks up a soft orange bleed. That one is laid on the developed print
// (BLIT), screened, because the film's dye-cloud bleed would spread a ring
// this thin to nothing; the grain under it still shows.
const MIST_COMMON = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform float uSRGB;   // the scene targets store sRGB (no float targets)
uniform vec2 uKey;     // scene luminance: the knee's foot and shoulder
uniform vec2 uRed;     // red-channel scene value: the same for the red layer
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 dec(vec3 c) {
  if (uSRGB < 0.5) return max(c, 0.0);
  c = clamp(c, 0.0, 1.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 enc(vec3 c) {
  if (uSRGB < 0.5) return c;
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
// the red layer's highlights: bright in red, and bright (a cloud, a lit wall,
// the yellow board), not merely red (the paint)
float redMask(vec3 c) {
  return smoothstep(uRed.x, uRed.y, c.r) * smoothstep(uKey.x * 0.8, uKey.y, dot(c, LUMA));
}
`;

// full res -> 1/4: the light that scatters, keyed on luminance
const MIST_KEY = `${MIST_COMMON}
uniform sampler2D uIn;
void main() {
  vec2 t = 1.0 / vec2(textureSize(uIn, 0));
  vec3 s = vec3(0.0);
  for (int j = 0; j < 2; j++)
    for (int i = 0; i < 2; i++) {
      vec3 c = dec(texture(uIn, vUv + (vec2(i, j) - 0.5) * 2.0 * t).rgb);
      s += c * smoothstep(uKey.x, uKey.y, dot(c, LUMA));
    }
  outColor = vec4(s * 0.25, 1.0);
}`;

// 1/4 -> 1/16, a 4x4 box from four bilinear taps
const MIST_DOWN = `${MIST_COMMON}
uniform sampler2D uIn;
void main() {
  vec2 t = 1.0 / vec2(textureSize(uIn, 0));
  vec3 s = vec3(0.0);
  for (int j = 0; j < 2; j++)
    for (int i = 0; i < 2; i++) s += texture(uIn, vUv + (vec2(i, j) - 0.5) * 2.0 * t).rgb;
  outColor = vec4(s * 0.25, 1.0);
}`;

// one axis of a Gaussian, sigma in the target's px
const MIST_BLUR = `${MIST_COMMON}
uniform sampler2D uIn;
uniform vec2 uDir;
uniform float uSigma;
void main() {
  vec2 t = uDir / vec2(textureSize(uIn, 0));
  float k = 0.5 / (uSigma * uSigma);
  int R = int(ceil(3.0 * uSigma));
  vec3 s = texture(uIn, vUv).rgb;
  float ws = 1.0;
  for (int i = 1; i <= 40; i++) {
    if (i > R) break;
    float w = exp(-float(i * i) * k);
    s += w * (texture(uIn, vUv + float(i) * t).rgb + texture(uIn, vUv - float(i) * t).rgb);
    ws += 2.0 * w;
  }
  outColor = vec4(s / ws, 1.0);
}`;

// full res, horizontal: the red layer's highlight mask, spread along x
const MIST_RED = `${MIST_COMMON}
uniform sampler2D uIn;
uniform float uSigma;
float m(ivec2 p, ivec2 hi) { return redMask(dec(texelFetch(uIn, clamp(p, ivec2(0), hi), 0).rgb)); }
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  ivec2 hi = textureSize(uIn, 0) - 1;
  float k = 0.5 / (uSigma * uSigma);
  float s = m(ip, hi), ws = 1.0;
  for (int i = 1; i <= 8; i++) {
    float w = exp(-float(i * i) * k);
    s += w * (m(ip + ivec2(i, 0), hi) + m(ip - ivec2(i, 0), hi));
    ws += 2.0 * w;
  }
  outColor = vec4(s / ws, 0.0, 0.0, 1.0);
}`;

// full res: the frame through the filter and onto the emulsion
const MIST = `${MIST_COMMON}
uniform sampler2D uIn;     // the frame to diffuse (the composite, or the photograph alone)
uniform sampler2D uNear;   // the glow, 1/4 res
uniform sampler2D uFar;    // the glow, 1/16 res
uniform float uFarW;
uniform float uGain;       // screen strength
uniform float uCeil;       // scene value the screen rolls toward
void main() {
  vec4 c0 = texelFetch(uIn, ivec2(gl_FragCoord.xy), 0);
  vec3 c = dec(c0.rgb);
  // the glow, screened under the ceiling: it lifts the dark round a highlight
  // and cannot carry anything past what develops just short of white
  vec3 B = mix(texture(uNear, vUv).rgb, texture(uFar, vUv).rgb, uFarW);
  vec3 a = clamp(c / uCeil, 0.0, 1.0);
  vec3 b = clamp(uGain * B / uCeil, 0.0, 1.0);
  vec3 o = c + uCeil * b * (1.0 - a);
  outColor = vec4(enc(o), c0.a);
}`;

// full res, vertical: the halation ring. The spread red mask, kept only on
// what is darker than the light it came from, so it lies outward from the
// highlight's edge, a few px wide.
const MIST_RING = `${MIST_COMMON}
uniform sampler2D uIn;     // the composite
uniform sampler2D uRedH;   // the red mask, spread along x
uniform float uSigma;
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  ivec2 hi = textureSize(uIn, 0) - 1;
  float k = 0.5 / (uSigma * uSigma);
  float s = texelFetch(uRedH, ip, 0).r, ws = 1.0;
  for (int j = 1; j <= 8; j++) {
    float w = exp(-float(j * j) * k);
    s += w * (texelFetch(uRedH, clamp(ip + ivec2(0, j), ivec2(0), hi), 0).r + texelFetch(uRedH, clamp(ip - ivec2(0, j), ivec2(0), hi), 0).r);
    ws += 2.0 * w;
  }
  vec3 c = dec(texelFetch(uIn, ip, 0).rgb);
  // a pixel whose red layer sits well below the highlight's: the blue sky
  // round a cloud, a wire across it, an eave under a lit wall; the highlight
  // itself (already in its red shoulder) and the orange paint take none
  float dark = 1.0 - smoothstep(0.2, 0.7, c.r / uRed.y);
  outColor = vec4(s / ws * dark, 0.0, 0.0, 1.0);
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

function imageTexture(gl, img, { srgb = false, mips = false, wrapS = gl.CLAMP_TO_EDGE } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function target(gl, w, h, float) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, float ? gl.RGBA16F : gl.RGBA8, w, h);
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

// the film kit's curve (Lottes'), contrast a and shoulder d, mid grey held,
// hdrMax landing on white: the same constants the kit derives
function filmCurve(a, d, hdrMax, mid = 0.18) {
  const ad = a * d;
  const den = (hdrMax ** ad - mid ** ad) * mid;
  const b = (-(mid ** a) + hdrMax ** a * mid) / den;
  const c = (hdrMax ** ad * mid ** a - hdrMax ** a * mid ** ad * mid) / den;
  return (x) => x ** a / (x ** ad * b + c);
}
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

const freeTarget = (gl, t) => {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
};

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

export async function createCurveMirror(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const aimQ = q.get("aim");
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");

  const [scene, photoImg, envImg, envdImg, auxImg, gradeImg] = await Promise.all([
    fetch(BASE + "scene.json").then((r) => r.json()),
    loadImage(BASE + "photo.webp"),
    loadImage(BASE + "env.webp"),
    loadImage(BASE + "envd.png"),
    loadImage(BASE + "aux.png"),
    loadImage(BASE + "grade.png"),
  ]);
  const photo = imageTexture(gl, photoImg, { srgb: true, mips: true });
  const envT = imageTexture(gl, envImg, { srgb: true, mips: true, wrapS: gl.REPEAT });
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  const envD = imageTexture(gl, envdImg, { wrapS: gl.REPEAT });
  const aux = imageTexture(gl, auxImg);
  const gradeT = imageTexture(gl, gradeImg);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const sceneP = program(gl, VERT, SCENE);
  const geoP = program(gl, VERT, SCENE.replace("precision highp float;", "#define GEO\nprecision highp float;"));
  const opticsP = program(gl, VERT, OPTICS);
  const blit = program(gl, VERT, BLIT);
  const mistKeyP = program(gl, VERT, MIST_KEY);
  const mistDownP = program(gl, VERT, MIST_DOWN);
  const mistBlurP = program(gl, VERT, MIST_BLUR);
  const mistRedP = program(gl, VERT, MIST_RED);
  const mistP = program(gl, VERT, MIST);
  const mistRingP = program(gl, VERT, MIST_RING);
  const film = createFilm(gl, { width: 2, height: 2 });
  const filmP = createFilm(gl, { width: 2, height: 2 });
  const LOOK = {
    ...FILM_DEFAULTS,
    ...FILM_PRESETS.summer,
    // the scan carries its own grade; the film adds the optics
    contrast: 1.1,
    toe: 0.025,
    saturation: 1.06,
    blueDepth: 0.65,
    whitePoint: 1.2,
    vignette: 0.2,
    halation: 0.22,
    halationThreshold: 1.4,
    // wires in the glass take the sky's halo, not a red fringe of their own
    halationLocal: 1,
  };
  // The sun's shoulder in scene units, found through the film's own curve:
  // the knee where the development reaches 0.8 of white, the ceiling it
  // rolls toward at 0.97, and the pinpoint core, past white. The film's
  // diffusion and vignette take about 7% from a highlight this small
  // (measured), so both are set that much higher.
  const curve = filmCurve(LOOK.contrast, LOOK.shoulder, LOOK.whitePoint);
  const sceneFor = (out) => {
    const y = srgbToLinear(out);
    let lo = 0;
    let hi = 8;
    for (let i = 0; i < 48; i++) {
      const m = (lo + hi) / 2;
      if (curve(m) < y) lo = m;
      else hi = m;
    }
    return lo;
  };
  const TONE = [sceneFor(0.8) * 1.07, sceneFor(0.97) * 1.07, LOOK.whitePoint * 4];
  // The diffusion, in scene light. The key: the top 15% of the frame's
  // luminance scatters, a soft knee across the 85th percentile (measured on
  // the scene target: 0.44, what develops to about 0.68), so the cumulus,
  // the lit plaster and the yellow board glow and the sky does not. The red
  // layer's highlights, which halate, are keyed the same way from their own
  // channel (the clouds' red sits near 0.41, the sky's near 0.09). The glow
  // is screened at 0.35 toward a ceiling that develops to 0.975, two spreads
  // of it: 0.5% of the frame's width (about 5 css px, the roll-off at a
  // cloud's edge) and 3% (the veil), 65/35. The halation ring is a css px
  // (sigma) of reach, 2-4 device px, screened onto the print at 0.5, amber.
  const MIST_K = {
    key: [sceneFor(0.62), sceneFor(0.74)],
    red: [sceneFor(0.5), sceneFor(0.66)],
    ceil: sceneFor(0.975),
    gain: 0.35,
    near: 0.005,
    far: 0.03,
    farW: 0.35,
    hal: 0.5,
    halC: [1.0, 0.55, 0.18],
  };
  // the warm-neutral the roll-off should develop to, in scene units: each
  // channel taken back through the curve and the highlight tint, scaled so
  // its brightest channel, as the film sees it, is 1
  const SUN_W = (() => {
    const y = srgbToLinear(0.97);
    const w = [1, 0.96, 0.88].map((k, i) => sceneFor(linearToSrgb(y * k)) / LOOK.highlightTint[i]);
    const m = Math.max(...w.map((v, i) => v * LOOK.highlightTint[i]));
    return w.map((v) => v / m);
  })();
  // a sunlit cumulus top (clouds.py's TOP), the same way: the scene
  // colour that develops to a warm neutral just under white, R over G over B.
  // The curve alone undershoots it: the film's Pro-Mist takes a share of a
  // highlight's light away and the vignette a little more, so it is set
  // over (by less now the tops are a heap's broad sunlit cap, not its rim),
  // and a touch warmer, measured on the render (?aim=45,-30: the tops land
  // at about #F4EEE2, the bellies about a stop under, toward #A9BCD3)
  const CLOUD_W = [0.957, 0.933, 0.886].map((v, i) => (1.07 * [1, 0.985, 0.95][i] * sceneFor(v)) / LOOK.highlightTint[i]);
  // without a float target the scene is stored as the film's sRGB input
  const sunTone = () => (linear ? TONE : TONE.map((v) => linearToSrgb(Math.min(v, 1))));

  const [PW, PH] = scene.photo;
  const M = scene.mirror;
  const SUN = scene.sun;
  const ground = -scene.camH;
  // uR: world = R * camera; scene.R rows are the world axes in camera space,
  // so world = Rrows @ cam, and GLSL's column-major mat3 wants the transpose's columns
  const R = scene.R;
  const Rmat = new Float32Array([R[0][0], R[1][0], R[2][0], R[0][1], R[1][1], R[2][1], R[0][2], R[1][2], R[2][2]]);

  // the bracket: azimuth from the mirror toward the lens; yaw and pitch are
  // relative to facing it squarely, level
  const az0 = Math.atan2(-M[0], -M[2]);
  const axis = (yaw, pitch) => {
    const a = az0 + yaw * DEG;
    const p = pitch * DEG;
    return [Math.cos(p) * Math.sin(a), Math.sin(p), Math.cos(p) * Math.cos(a)];
  };
  const restN = axis(REST[0], REST[1]);
  // at rest the face apex sits at M (the panorama's centre): the hinge HINGE
  // behind it, the pole ARM further back along the arm, its top POLE_DROP below
  const hingeRest = add(M, restN, -HINGE);
  const hz = norm([restN[0], 0, restN[2]]);
  const pivot = [hingeRest[0] - hz[0] * ARM, hingeRest[1] - POLE_DROP, hingeRest[2] - hz[2] * ARM];

  // the aim that puts the sun in the middle of the glass: the face's normal
  // halves the angle between the sun and the lens
  const toCam = norm([-M[0], -M[1], -M[2]]);
  const sunN = norm(add(SUN, toCam));
  const sunAim = [
    (Math.atan2(sunN[0], sunN[2]) - az0) / DEG,
    Math.asin(sunN[1]) / DEG,
  ];

  let held = false;
  let aimInit = [...REST];
  if (aimQ === "sun") {
    held = true;
    aimInit = sunAim;
    console.log("curve-mirror sunAim", sunAim.map((x) => x.toFixed(1)).join(","));
  } else if (aimQ) {
    const v = aimQ.split(",").map(Number);
    if (v.length === 2 && v.every(Number.isFinite)) {
      held = true;
      // held within what the bracket can do
      aimInit = [clamp(v[0], YAW_LIM[0], YAW_LIM[1]), clamp(v[1], PITCH_LIM[0], PITCH_LIM[1])];
    }
  }
  const still = held || q.get("still") === "1";

  // ---------------------------------------------------------------- layout
  const L = { x: 0, y: 0, w: 1, h: 1, pw: 2, ph: 2, rw: 2, rh: 2 };
  const V = { x: 0, y: 0, w: PW, h: PH };
  let geoT = null;
  let sceneT = null;
  let opticsT = null;
  let filmT = null;
  let photoT = null;
  let filmPT = null;
  let diffT = null;
  let diffPT = null;
  let redT = null;
  let ringT = null;
  let mq = [null, null];
  let ms = [null, null];
  let linear = false;
  let scale = 1;
  let lastBox = null;
  const layout = (W, H, dpr) => {
    lastBox = [W, H, dpr];
    let aspect;
    if (embedded) {
      Object.assign(L, { x: 0, y: 0, w: W, h: H });
      aspect = W / H;
    } else if (W / H < 0.9) {
      aspect = 4 / 5;
      const side = Math.max(16, Math.round(W * 0.06));
      let w = W - side * 2;
      let h = w / aspect;
      if (h > H * 0.76) {
        h = H * 0.76;
        w = h * aspect;
      }
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 - 12 });
    } else {
      aspect = 3 / 2;
      const side = Math.max(24, W * 0.07);
      const w = Math.min(W - side * 2, H * 0.8 * aspect);
      const h = w / aspect;
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 - 12 });
    }
    // the window onto the photo: all of it at 3:2; narrower prints crop
    // round the mirror
    if (aspect >= PW / PH) {
      const h = PW / aspect;
      Object.assign(V, { x: 0, y: (PH - h) * 0.4, w: PW, h });
    } else {
      const w = PH * aspect;
      Object.assign(V, { x: clamp(640 - w * 0.45, 0, PW - w), y: 0, w, h: PH });
    }
    L.x = Math.round(L.x * dpr) / dpr;
    L.y = Math.round(L.y * dpr) / dpr;
    L.w = Math.round(L.w * dpr) / dpr;
    L.h = Math.round(L.h * dpr) / dpr;
    L.pw = Math.max(2, Math.round(L.w * dpr));
    L.ph = Math.max(2, Math.round(L.h * dpr));
    L.rw = Math.max(2, Math.round(L.pw * scale));
    L.rh = Math.max(2, Math.round(L.ph * scale));
    for (const t of [geoT, sceneT, opticsT, filmT, photoT, filmPT, diffT, diffPT, redT, ringT, ...mq, ...ms]) freeTarget(gl, t);
    geoT = target(gl, L.rw, L.rh, false);
    sceneT = target(gl, L.rw, L.rh, floatOk);
    linear = floatOk && sceneT.ok;
    if (!linear) {
      freeTarget(gl, sceneT);
      sceneT = target(gl, L.rw, L.rh, false);
    }
    // the photograph alone, a second colour attachment of the scene pass
    photoT = target(gl, L.rw, L.rh, linear);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, photoT.tex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    opticsT = target(gl, L.rw, L.rh, linear);
    filmT = target(gl, L.rw, L.rh, false);
    filmPT = target(gl, L.rw, L.rh, false);
    diffT = target(gl, L.rw, L.rh, linear);
    diffPT = target(gl, L.rw, L.rh, linear);
    redT = target(gl, L.rw, L.rh, false);
    ringT = target(gl, L.rw, L.rh, false);
    const qw = Math.max(2, Math.ceil(L.rw / 4));
    const qh = Math.max(2, Math.ceil(L.rh / 4));
    mq = [target(gl, qw, qh, linear), target(gl, qw, qh, linear)];
    ms = [target(gl, Math.max(2, Math.ceil(qw / 4)), Math.max(2, Math.ceil(qh / 4)), linear), target(gl, Math.max(2, Math.ceil(qw / 4)), Math.max(2, Math.ceil(qh / 4)), linear)];
    film.resize(L.rw, L.rh);
    filmP.resize(L.rw, L.rh);
    dirty = true;
  };

  // the render-px box (gl_FragCoord, y up) round the head's face, padded:
  // as far as the glass, and so the sun's light in it, can reach on screen
  const headBox = (face, xr, up, pad) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * 2 * Math.PI;
      const w = add(add(face, xr, Math.cos(t) * A * 1.15), up, Math.sin(t) * A * 1.15);
      const cam = [0, 1, 2].map((j) => R[0][j] * w[0] + R[1][j] * w[1] + R[2][j] * w[2]);
      if (cam[2] >= -1e-3) return [0, 0, L.rw, L.rh];
      const px = scene.c[0] + (scene.f * cam[0]) / -cam[2];
      const py = scene.c[1] - (scene.f * cam[1]) / -cam[2];
      const rx = ((px - V.x) / V.w) * L.rw;
      const ry = (1 - (py - V.y) / V.h) * L.rh;
      x0 = Math.min(x0, rx);
      x1 = Math.max(x1, rx);
      y0 = Math.min(y0, ry);
      y1 = Math.max(y1, ry);
    }
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  };

  // ---------------------------------------------------------------- state
  // The aim (yaw, pitch in degrees) follows a goal on a spring, like a head
  // on a bracket with some play: 1:1 under the hand in the open range, the
  // hand's speed carried on release, sprung at the bracket's stops.
  const aim = [...aimInit];
  const vel = [0, 0];
  const goal = [...aimInit];
  let dragging = false;
  let drag0 = null;
  let touched = held;
  let dirty = true;

  const inPrint = (p) => p.x >= L.x && p.x <= L.x + L.w && p.y >= L.y && p.y <= L.y + L.h;
  // degrees per css px: half the print's width turns it ~100 degrees
  const gain = () => 100 / Math.max(240, L.w * 0.5);
  // The hand's drag sets a goal that may run past the stops (by up to 40
  // degrees, so a fling has somewhere to go); the head follows it on its
  // spring, and the stops' springs push back on the head: none in the open
  // range, the soft one past SOFT, the firm one on top past FIRM, so it lags
  // the hand more and more and reaches the hard limit only under a long
  // pull, and there it is held.
  const LIM = [YAW_LIM, PITCH_LIM];
  const FIRM = [STOP.yaw.firm, STOP.pitch.firm];
  const SOFT = [STOP.yaw.soft, STOP.pitch.soft];
  const reach = (v, i) => clamp(v, LIM[i][0] - 40, LIM[i][1] + 40);
  // the stops' push on the head, as a multiple of the follow spring's w^2
  const stopForce = (x, i) => {
    const [slo, shi] = SOFT[i];
    const [flo, fhi] = FIRM[i];
    let f = 0;
    if (x > shi) f -= STOP.kSoft * (x - shi);
    if (x < slo) f -= STOP.kSoft * (x - slo);
    if (x > fhi) f -= STOP.kFirm * (x - fhi);
    if (x < flo) f -= STOP.kFirm * (x - flo);
    return f;
  };
  // where the head balances against the stops for a goal g
  const balance = (g, i) => {
    const [slo, shi] = SOFT[i];
    const [flo, fhi] = FIRM[i];
    const ks = STOP.kSoft;
    const kf = STOP.kFirm;
    let x = g;
    if (g > shi) {
      x = (g + ks * shi) / (1 + ks);
      if (x > fhi) x = (g + ks * shi + kf * fhi) / (1 + ks + kf);
    } else if (g < slo) {
      x = (g + ks * slo) / (1 + ks);
      if (x < flo) x = (g + ks * slo + kf * flo) / (1 + ks + kf);
    }
    return clamp(x, LIM[i][0], LIM[i][1]);
  };
  // let go: the clamp band's friction holds the head where the hand left it
  // in the open range and on the soft spring, but the firm bushing pushes it
  // back off to where it takes up
  const letGo = (g, i) => clamp(balance(g, i), FIRM[i][0], FIRM[i][1]);
  stage.on("down", (p) => {
    if (held || !inPrint(p)) return;
    dragging = true;
    touched = true;
    drag0 = { x: p.x, y: p.y, yaw: goal[0], pitch: goal[1] };
    stage.canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (!dragging) {
      stage.canvas.style.cursor = !held && inPrint(p) ? "grab" : "";
      return;
    }
    const g = gain();
    // push the face: right turns it right, up tilts it up
    goal[0] = reach(drag0.yaw - (p.x - drag0.x) * g, 0);
    goal[1] = reach(drag0.pitch - (p.y - drag0.y) * g, 1);
  });
  stage.on("up", (p) => {
    if (!dragging) return;
    dragging = false;
    stage.canvas.style.cursor = inPrint(p) ? "grab" : "";
    const g = gain();
    goal[0] = letGo(goal[0] - p.vx * g * 0.2, 0);
    goal[1] = letGo(goal[1] - p.vy * g * 0.2, 1);
  });

  host.tabIndex = embedded ? -1 : 0;
  const onKey = (e) => {
    if (held) return;
    const step = e.shiftKey ? 10 : 2;
    if (e.key === "ArrowLeft") goal[0] = letGo(goal[0] + step, 0);
    else if (e.key === "ArrowRight") goal[0] = letGo(goal[0] - step, 0);
    else if (e.key === "ArrowUp") goal[1] = letGo(goal[1] + step, 1);
    else if (e.key === "ArrowDown") goal[1] = letGo(goal[1] - step, 1);
    else return;
    e.preventDefault();
    touched = true;
  };
  host.addEventListener("keydown", onKey);

  const bindTex = (unit, tex, loc) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  };
  const shFlat = new Float32Array(scene.sh.flat());

  const drawScene = (expoStops, sway) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    const yaw = aim[0] + sway[0];
    const pitch = aim[1] + sway[1];
    const n = axis(yaw, pitch);
    const xr = norm(cross([0, 1, 0], n));
    const up = cross(n, xr);
    // the arm turns about the pole (yaw), the head about its hinge (pitch)
    const hzY = norm([n[0], 0, n[2]]);
    const hinge = [pivot[0] + hzY[0] * ARM, pivot[1] + POLE_DROP, pivot[2] + hzY[2] * ARM];
    const face = add(hinge, n, HINGE);
    // three passes: what each pixel centre meets; the scene, supersampled
    // where that changes; the plate's optics on the edge band
    for (const [P, T] of [
      [geoP, geoT],
      [sceneP, sceneT],
    ]) {
      gl.useProgram(P.p);
      const u = P.u;
      gl.uniform4f(u.uView, V.x, V.y, V.w, V.h);
      gl.uniform2f(u.uPhotoSize, PW, PH);
      gl.uniform1f(u.uF, scene.f);
      gl.uniform2f(u.uC, scene.c[0], scene.c[1]);
      gl.uniformMatrix3fv(u.uR, false, Rmat);
      gl.uniform3fv(u.uM, M);
      gl.uniform3fv(u.uFace, face);
      gl.uniform3fv(u.uN, n);
      gl.uniform3fv(u.uU, up);
      gl.uniform3fv(u.uX, xr);
      gl.uniform3fv(u.uPivot, pivot);
      gl.uniform3fv(u.uHinge, hinge);
      gl.uniform3fv(u.uHz, hzY);
      gl.uniform1f(u.uGround, ground);
      gl.uniform3fv(u.uSun, SUN);
      gl.uniform1f(u.uSunE, 3.6);
      gl.uniform1f(u.uSunDisc, 1.0);
      gl.uniform3fv(u.uSunTone, sunTone());
      gl.uniform3fv(u.uHiTint, LOOK.highlightTint);
      gl.uniform3fv(u.uSunW, SUN_W);
      gl.uniform3fv(u.uCloudW, CLOUD_W);
      gl.uniform3fv(u.uSH, shFlat);
      gl.uniform2f(u.uDist, Math.log2(scene.dist[0]), Math.log2(scene.dist[1]));
      gl.uniform1f(u.uEnvW, scene.env[0]);
      gl.uniform1f(u.uExpo, 2 ** expoStops);
      gl.uniform1f(u.uPx, V.w / L.rw / scene.f);
      bindTex(0, photo, u.uPhoto);
      bindTex(1, envT, u.uEnv);
      bindTex(2, envD, u.uEnvD);
      bindTex(3, aux, u.uAux);
      if (P === sceneP) bindTex(4, geoT.tex, u.uGeo);
      if (P === sceneP) bindTex(5, gradeT, u.uGrade);
      gl.uniform2f(u.uRes, L.rw, L.rh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
      gl.viewport(0, 0, L.rw, L.rh);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.useProgram(opticsP.p);
    const o = opticsP.u;
    // render px per photo px; the photo's edge is ~0.6 photo px (sigma) on
    // screen, a supersampled one a 1 px box (0.29)
    const k = L.rw / V.w;
    gl.uniform1f(o.uSig, Math.sqrt(Math.max((0.6 * k) ** 2 - 0.29 ** 2, 0.01)));
    gl.uniform1f(o.uHalR, Math.max(0.9, 1.1 * k));
    gl.uniform1f(o.uHal, 0.3);
    gl.uniform3f(o.uHalC, 1.0, 0.62, 0.38);
    // the sun's: about a css px (sigma), so it reads as a ring of two or three
    const kc = L.rw / L.w;
    const box = headBox(face, xr, up, kc * 4);
    gl.uniform4fv(o.uSunBox, box);
    gl.uniform1f(o.uSunHalR, Math.min(3.2, Math.max(0.8, 1.0 * kc)));
    gl.uniform1f(o.uSunHal, 1.6);
    gl.uniform3f(o.uSunHalC, 1.0, 0.8, 0.62);
    bindTex(0, sceneT.tex, o.uIn);
    bindTex(1, photoT.tex, o.uSunX);
    gl.bindFramebuffer(gl.FRAMEBUFFER, opticsT.fbo);
    gl.viewport(0, 0, L.rw, L.rh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    mist();
  };

  // the Pro-Mist and the halation (MIST): the composite's light, keyed and
  // spread, laid over the composite and over the photograph developed alone
  const pass = (P) => {
    gl.useProgram(P.p);
    gl.uniform1f(P.u.uSRGB, linear ? 0 : 1);
    return P.u;
  };
  const run = (T) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
    gl.viewport(0, 0, T.w, T.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const blur = (pair, sigma) => {
    for (const [from, to, dir] of [
      [pair[0], pair[1], [1, 0]],
      [pair[1], pair[0], [0, 1]],
    ]) {
      const u = pass(mistBlurP);
      bindTex(0, from.tex, u.uIn);
      gl.uniform2fv(u.uDir, dir);
      gl.uniform1f(u.uSigma, sigma);
      run(to);
    }
  };
  const mist = () => {
    const ceil = linear ? MIST_K.ceil : Math.min(MIST_K.ceil, 1);
    const fw = L.rw;
    let u = pass(mistKeyP);
    bindTex(0, opticsT.tex, u.uIn);
    gl.uniform2fv(u.uKey, MIST_K.key);
    run(mq[0]);
    u = pass(mistDownP);
    bindTex(0, mq[0].tex, u.uIn);
    run(ms[0]);
    // the two spreads (sigma) as shares of the frame's width
    blur(mq, (MIST_K.near * fw) / 4);
    blur(ms, (MIST_K.far * fw) / 16);
    // the halation's reach: about a css px (sigma), 2-4 device px of ring
    const kc = L.rw / L.w;
    const sig = Math.max(0.7, 0.9 * kc);
    u = pass(mistRedP);
    bindTex(0, opticsT.tex, u.uIn);
    gl.uniform2fv(u.uRed, MIST_K.red);
    gl.uniform2fv(u.uKey, MIST_K.key);
    gl.uniform1f(u.uSigma, sig);
    run(redT);
    u = pass(mistRingP);
    bindTex(0, opticsT.tex, u.uIn);
    bindTex(1, redT.tex, u.uRedH);
    gl.uniform2fv(u.uRed, MIST_K.red);
    gl.uniform2fv(u.uKey, MIST_K.key);
    gl.uniform1f(u.uSigma, sig);
    run(ringT);
    for (const [src, dst] of [
      [opticsT, diffT],
      [photoT, diffPT],
    ]) {
      u = pass(mistP);
      bindTex(0, src.tex, u.uIn);
      bindTex(1, mq[0].tex, u.uNear);
      bindTex(2, ms[0].tex, u.uFar);
      gl.uniform1f(u.uFarW, MIST_K.farW);
      gl.uniform1f(u.uGain, MIST_K.gain);
      gl.uniform1f(u.uCeil, ceil);
      run(dst);
    }
  };

  let grainSeed = 0;
  const develop = (fade) => {
    const look = {
      ...LOOK,
      input: linear ? "linear" : "srgb",
      headroom: linear ? 0.6 : 1.4,
      grainSeed,
    };
    film.render(diffT.tex, look, filmT.fbo);
    filmP.render(diffPT.tex, look, filmPT.fbo);
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
    bindTex(0, filmT.tex, blit.u.uTex);
    bindTex(1, filmPT.tex, blit.u.uPhotoT);
    bindTex(2, sceneT.tex, blit.u.uCov);
    bindTex(3, ringT.tex, blit.u.uRing);
    gl.uniform1f(blit.u.uHal, MIST_K.hal);
    gl.uniform3fv(blit.u.uHalC, MIST_K.halC);
    gl.uniform1f(blit.u.uFade, fade);
    gl.uniform3fv(blit.u.uPaper, PAPER);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  // Reveal: the print comes up overexposed and settles, while the mirror
  // swings in from a little off its rest, showing that it turns.
  const REVEAL = 2.0;
  if (!still && !reduce) {
    aim[0] = REST[0] + 16;
    aim[1] = REST[1] - 3;
  }
  let time = 0;
  let t0 = -1;
  let grainClock = 0;
  let grainDirty = true;
  let slow = 0;
  let lastNow = 0;
  let lastExpo = -1;
  let lastFade = -1;
  let lastSway = [0, 0];
  stage.onFrame((dt) => {
    if (!sceneT) return;
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
      // spring: ζ 0.82; stiffer while held (the hand), softer after (the bracket)
      // under the hand the stops push back on the head (let go, the goal
      // has already been brought back inside them)
      const w = 2 * Math.PI * (dragging ? 2.4 : 1.1);
      const z = 0.82;
      const h = Math.min(dt, 1 / 30);
      for (let i = 0; i < 2; i++) {
        const push = dragging ? w * w * stopForce(aim[i], i) : 0;
        const acc = w * w * (goal[i] - aim[i]) + push - 2 * z * w * vel[i];
        vel[i] += acc * h;
        aim[i] += vel[i] * h;
        const [lo, hi] = LIM[i];
        if (aim[i] > hi || aim[i] < lo) {
          aim[i] = clamp(aim[i], lo, hi);
          vel[i] = 0;
        }
        if (Math.abs(goal[i] - aim[i]) < 1e-3 && Math.abs(vel[i]) < 1e-3) {
          aim[i] = goal[i];
          vel[i] = 0;
        } else dirty = true;
      }
    }
    // a breath of wind in the head: a few tenths of a degree, slow
    let sway = [0, 0];
    if (!still && !reduce && !dragging) {
      const k = clamp(age / 3, 0, 1);
      sway = [k * 0.35 * (Math.sin(time * 0.71) + 0.4 * Math.sin(time * 1.93 + 1.2)), k * 0.18 * Math.sin(time * 0.53 + 0.7)];
    }
    if (Math.abs(sway[0] - lastSway[0]) + Math.abs(sway[1] - lastSway[1]) > 0.02) dirty = true;

    if (!reduce && !still) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        grainSeed = (grainSeed + 1) % 997;
        grainDirty = true;
      }
    }
    if (expo !== lastExpo || fade !== lastFade) dirty = true;
    if (!dirty && !grainDirty) return;
    if (dirty) {
      drawScene(expo, sway);
      lastSway = sway;
    }
    develop(fade);
    dirty = false;
    grainDirty = false;
    lastExpo = expo;
    lastFade = fade;
  });

  return {
    destroy() {
      host.removeEventListener("keydown", onKey);
      film.destroy();
      filmP.destroy();
      for (const t of [geoT, sceneT, opticsT, filmT, photoT, filmPT, diffT, diffPT, redT, ringT, ...mq, ...ms]) freeTarget(gl, t);
      for (const t of [photo, envT, envD, aux, gradeT]) gl.deleteTexture(t);
      for (const pr of [sceneP, geoP, opticsP, blit, mistKeyP, mistDownP, mistBlurP, mistRedP, mistP, mistRingP]) gl.deleteProgram(pr.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
