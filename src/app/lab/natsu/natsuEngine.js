import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Natsu: a fumikiri (railway crossing signal) and its catenary, in hard
// silhouette against a backlit cumulonimbus in deep summer blue.
//
// The photograph (Kanata, Unsplash) is taken apart offline into four real
// layers: the signal and its lamps (near), the overhead wires, masts and
// gantry (middle), the cloud, and the sky. Silhouettes come from a
// known-background matte (alpha = (I-B)·(F-B)/|F-B|², with B the sky and
// cloud inpainted behind them) so wires stay crisp at DPR 2; which layer a
// silhouette belongs to comes from a Depth Anything V2 map. The sky is a
// smooth fit to the visible blue, so the cloud is carried as its excess over
// the sky and can grow into blue that was never photographed.
//
// What runs here:
//  - One gesture, camera pitch. The pointer's height (or the device's tilt)
//    tips the camera up from level; a hold tips it all the way, to 58
//    degrees, a worm's-eye. Every layer goes through one map: the zenith
//    comes down from infinity to just over the top edge (as a pinhole would
//    put it to 40 degrees, then easing as the lens turns stereographic), the
//    photograph's columns become rays out of it (mast, ladder, droppers and
//    gantry all converge on it), its rows bow into arcs round it, and the
//    sky deepens to cobalt there. Depth comes in only as parallax along those
//    rays, per pixel from a smoothed disparity field, so near things climb
//    and swell about the same zenith and a lattice moves as one piece. Side
//    to side, the zenith follows the pointer a little. The frame is full
//    bleed and stays on the photograph; only sky lies past its top.
//  - The cloud evolves from its own texture. A slow growth field lifts and
//    spreads the tower; dozens of lobes on its outline swell one after
//    another, each once (nothing loops back); inside, two bands of detail
//    (lobes, then fine curd) are advected by their own curl flows and
//    re-seeded with a variance-preserving cross-fade, masked to the active
//    upper tower so the outline never doubles.
//  - The wires hang on three lightly damped springs driven by a little wind.
//  - Looking up is looking into the sun: past SUN_FROM of the pitch it swings
//    from low front-left (as photographed) round behind the tower. The lit
//    faces turn with it and the faces it leaves go to skylight blue without
//    losing any brightness, and a thin warm rim lights on the silhouette's
//    edges facing the sun; the film's halation and diffusion pick that up.
//  - The crossing lamps alternate now and then, as a train comes.
//
// Query: ?t=0..1 growth (0 = the photograph, 1 = five minutes on),
// ?light=0..1 sun (0 = as shot, 1 = behind the tower; else it follows the
// pitch), ?tilt=x[,y] in -1..1 (y: -1 looks highest, 0 is the resting look),
// ?pitch=0..58 degrees (overrides tilt's y), ?lamp=0|1|2, ?still=1 skips the
// reveal.

const BASE = "/lab/natsu/";
const PW = 2592;
const PH = 1728;
const DUR = 300; // seconds for the full growth
// Camera pitch: the gesture's one quantity. Level is the photograph; the
// pointer runs the look from PITCH_LO through PITCH_REST to PITCH_HI, a hold
// goes all the way, to a worm's-eye.
const PITCH_MAX_DEG = 58;
const PITCH_MAX = (PITCH_MAX_DEG * Math.PI) / 180;
const PITCH_LO = 0.03;
const PITCH_HI = 0.84;
const PITCH_REST = 0.34;
// The light comes round behind the tower as the look climbs past this.
const SUN_FROM = 0.6;
// Virtual lens: focal length in units of the half height (about 85 deg
// vertical). Up to PANINI_FROM the zenith sits where a pinhole of this focal
// would put it (FOCAL / tan pitch above the centre); past it the lens turns
// stereographic and the zenith eases down to ZENITH_MIN half heights, just
// over the top edge, instead of falling into the frame.
const FOCAL = 1.1;
const PANINI_FROM = (40 * Math.PI) / 180;
const ZENITH_MIN = 1.1;
// How far rows bow into arcs round the zenith: 0 keeps them straight, 1 is
// the stereographic arc. Low while the look is gentle, full at the top.
const BOW_LO = 0.3;
const BOW_HI = 0.85;
// Plate px kept clear of the photograph's edge.
const EDGE = 30;
// Parallax at the full pitch, in half heights per unit of disparity: the
// camera sinks as it tips up, so near things climb toward the zenith.
const PARALLAX = 0.1;
// Where the zenith sits above the centre of the frame (half heights).
function zenithY(th) {
  if (th < 1e-4) return 1e4;
  if (th <= PANINI_FROM) return Math.min(1e4, FOCAL / Math.tan(th));
  const y0 = FOCAL / Math.tan(PANINI_FROM);
  const slope = FOCAL / Math.sin(PANINI_FROM) ** 2;
  const k = slope / (y0 - ZENITH_MIN);
  return ZENITH_MIN + (y0 - ZENITH_MIN) * Math.exp(-k * (th - PANINI_FROM));
}
// Crossing lamp slits (plate px): x, y0, y1.
const LAMPS = [
  [434, 1062, 1182],
  [451, 1368, 1506],
];
const BULGES = [
  [0.80362, 0.2798, 0.02034, 0.0198, 0.1394, 0.166],
  [0.61594, 0.19889, 0.02522, 0.0389, 0.1275, 0.2],
  [0.51471, 0.27447, 0.01656, 0.0442, 0.0885, 0.142],
  [0.8493, 0.41678, 0.02684, 0.0522, 0.1115, 0.184],
  [0.91573, 0.63858, 0.01427, 0.0935, 0.0895, 0.162],
  [0.52546, 0.27894, 0.08037, 0.1344, 0.1901, 0.05],
  [0.80825, 0.50364, 0.02941, 0.1384, 0.1087, 0.147],
  [0.8534, 0.60605, 0.02704, 0.1502, 0.1324, 0.173],
  [0.71096, 0.54441, 0.01755, 0.1903, 0.1203, 0.143],
  [0.42193, 0.29966, 0.02481, 0.1917, 0.1304, 0.133],
  [0.6848, 0.25116, 0.07597, 0.2006, 0.2027, 0.062],
  [0.76145, 0.60802, 0.02009, 0.2054, 0.0756, 0.172],
  [0.73537, 0.6018, 0.02443, 0.2135, 0.1277, 0.169],
  [0.31431, 0.53059, 0.0246, 0.2438, 0.0997, 0.249],
  [0.82412, 0.4061, 0.01933, 0.2911, 0.1183, 0.24],
  [0.73842, 0.26832, 0.0248, 0.3355, 0.1095, 0.233],
  [0.32521, 0.61493, 0.0291, 0.3427, 0.1105, 0.246],
  [0.75392, 0.57062, 0.01484, 0.3501, 0.124, 0.186],
  [0.82095, 0.33837, 0.01603, 0.3872, 0.0771, 0.155],
  [0.74823, 0.64527, 0.01576, 0.4138, 0.1271, 0.153],
  [0.94218, 0.61965, 0.0137, 0.4218, 0.1138, 0.243],
  [0.5598, 0.32697, 0.06095, 0.4389, 0.245, 0.078],
  [0.78637, 0.26996, 0.01886, 0.4487, 0.111, 0.136],
  [0.7446, 0.27488, 0.07088, 0.4833, 0.1756, 0.055],
  [0.47149, 0.26139, 0.01518, 0.4898, 0.1364, 0.195],
  [0.44097, 0.27609, 0.02693, 0.5637, 0.1189, 0.214],
  [0.5787, 0.31308, 0.08688, 0.5953, 0.1572, 0.058],
  [0.54724, 0.23708, 0.01563, 0.5966, 0.0847, 0.178],
  [0.86263, 0.62666, 0.0257, 0.6094, 0.0782, 0.234],
  [0.77841, 0.65495, 0.02389, 0.6308, 0.0845, 0.221],
  [0.55131, 0.34028, 0.0843, 0.6316, 0.222, 0.076],
  [0.36187, 0.42362, 0.02143, 0.6326, 0.101, 0.177],
  [0.65572, 0.21833, 0.0249, 0.669, 0.0708, 0.253],
  [0.88588, 0.63005, 0.02874, 0.6715, 0.0888, 0.232],
  [0.56752, 0.30729, 0.07279, 0.6872, 0.1613, 0.058],
  [0.79381, 0.62894, 0.02085, 0.6918, 0.1381, 0.204],
  [0.33495, 0.46253, 0.02737, 0.7304, 0.1311, 0.236],
  [0.69043, 0.25528, 0.02817, 0.732, 0.1181, 0.191],
  [0.85538, 0.54265, 0.01479, 0.7359, 0.0991, 0.232],
  [0.29983, 0.6916, 0.02844, 0.7605, 0.1171, 0.158],
  [0.96588, 0.63641, 0.02837, 0.7794, 0.1312, 0.239],
  [0.77773, 0.57245, 0.02362, 0.7795, 0.0896, 0.143],
  [0.84192, 0.51853, 0.01931, 0.7849, 0.11, 0.17],
  [0.74486, 0.54697, 0.02809, 0.7874, 0.1246, 0.24],
  [0.415, 0.36062, 0.01415, 0.8168, 0.1377, 0.222],
  [0.82064, 0.29525, 0.01822, 0.8287, 0.0944, 0.187],
  [0.82172, 0.63363, 0.02309, 0.8524, 0.0807, 0.206]
];
const SKY = [[-0.004048, 0.02983, 0.004286, -0.029233, 0.003002, 0.014791], [0.065375, 0.115681, 0.092589, -0.113868, -0.022496, -0.070253], [0.23699, 0.125788, 0.107744, -0.132009, -0.037329, -0.177839]];

const NB = BULGES.length;

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
uniform sampler2D uPlate;   // sky + cloud, silhouettes removed (sRGB texture)
uniform sampler2D uLow4;    // the same, Gaussian sigma 4 px
uniform sampler2D uLow20;   // sigma 20 px
uniform sampler2D uCloud;   // normal xy, cloudness
uniform sampler2D uFields;  // activity, sway weight, not-sky
uniform sampler2D uLayers;  // near alpha, wire alpha, wire disparity
uniform sampler2D uFg;      // silhouette colour (sRGB texture)
uniform vec4 uProj;         // aspect, plate px per photo unit, plate y of photo Y 0, plate x of photo X 0
uniform vec4 uCam;          // pitch (rad), focal length (screen units), parallax (photo units per disparity), bow
uniform vec4 uMap;          // zenith column, zenith height R0, conformal scale c, photo Y at the zenith's radius R0
uniform float uGrow;        // 0..1
uniform float uTime;        // boil clock, s
uniform float uBoil;        // 0 with reduced motion
uniform vec4 uBul[${NB}];   // cx, cy (px), R (px), current amount
uniform vec4 uSway;         // three spring states (px) + gust
uniform vec3 uL;            // sun direction (x right, y up, z to viewer)
uniform vec2 uRimDir;
uniform float uBehind;
uniform vec2 uSunPx;
uniform float uAure;
uniform vec2 uLamp;
uniform float uExpo;

const vec2 PLATE = vec2(${PW}.0, ${PH}.0);
const vec3 L0 = normalize(vec3(-0.8, -0.12, 0.55));
const vec3 SUN = vec3(1.0, 0.84, 0.66);
const vec3 AMB = vec3(0.42, 0.52, 0.72);
// skylight at unit luminance
const vec3 SKYLIT = vec3(0.86, 1.0, 1.24);
// the sun through a thin edge
const vec3 RIM = vec3(1.0, 0.76, 0.5);
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
// Where the lens magnifies the photograph: how much the lobe band (4 px over
// 20 px smoothing) is deepened, and over how many of its texels the cloud's
// cut edge at the foot is feathered.
const float LOBE = 0.6;
const float FEATHER = 4.0;
// deep cobalt straight up (linear light, before the film)
const vec3 ZENITH = vec3(0.0006, 0.053, 0.29);

// The camera pitched up by uCam.x. Every layer goes through one and the same
// map, so all of them converge on one zenith and nothing tears between them:
// the photograph is read as a Mercator strip of the sky dome and seen through
// a stereographic lens centred on the zenith, which sits uMap.y half heights
// above the frame's centre. That map is conformal: a column of the
// photograph becomes a ray out of the zenith (the masts converge on it), a
// row becomes an arc round it (the wires fan and bow), and nothing is
// sheared, so the gantry's lattice keeps its angles. uCam.w (the bow) eases
// it toward a Panini-like lens at a low pitch, where rows stay nearly straight
// as through a rectilinear lens and only the columns converge; it is fully
// stereographic only at the worm's-eye. As the zenith goes to infinity
// (level) the map is the identity on the photograph.
// Returns photo coordinates: X, Y in half heights, Y up.
vec2 toPhoto(vec2 s) {
  float R0 = uMap.y;
  float vx = s.x - uMap.x;
  float vy = R0 - s.y;
  float phi = atan(vx, vy);
  // ln(r / R0), written so it stays exact as R0 grows without bound
  float e = (uCam.w * vx * vx + s.y * s.y - 2.0 * R0 * s.y) / (R0 * R0);
  float lr = 0.5 * (abs(e) < 0.01 ? e * (1.0 - e * (0.5 - e / 3.0)) : log(1.0 + e));
  return vec2(uMap.x + uMap.z * phi, uMap.w - uMap.z * lr);
}
vec2 toPlate(vec2 P) { return vec2(uProj.w + uProj.y * P.x, uProj.z - uProj.y * P.y); }
// A layer's disparity shifts it along the photograph's columns (in the frame:
// toward the zenith), so near things climb and swell about the same zenith.
vec2 parallax(vec2 P, float disp) { return toPlate(P - vec2(0.0, uCam.z * disp)); }

// Silhouettes: depth per pixel, smoothed so a lattice moves as one rigid
// piece. The wires, masts and gantry read the baked disparity field; the
// signal is nearest at its foot and recedes up the mast, and its bracket on
// the gantry takes the gantry's depth so the two stay joined.
float dWire(vec2 p) { return textureLod(uLayers, p / PLATE, 5.5).b; }
float dNear(vec2 p) {
  float dn = mix(0.5, 0.85, clamp(p.y / PLATE.y, 0.0, 1.0));
  float br = smoothstep(780.0, 1000.0, p.x) * (1.0 - smoothstep(320.0, 480.0, p.y));
  return mix(dn, dWire(p), br);
}
// sample position for a layer at photo point P: two fixed-point steps
vec2 layerAt(vec2 P, bool near) {
  vec2 q = toPlate(P);
  for (int i = 0; i < 2; i++) q = parallax(P, near ? dNear(q) : dWire(q));
  return q;
}
// Past the photograph's top the silhouettes go on along their own columns
// (which run into the zenith) and fade out; never mirrored.
float edgeFade(inout vec2 q) {
  vec2 c = clamp(q, vec2(1.0), PLATE - 1.0);
  float out1 = length(q - c);
  q = c;
  return exp(-out1 / 14.0);
}

vec3 sky(vec2 uv) {
  uv = clamp(uv, 0.0, 1.0);
  vec3 t1 = vec3(1.0, uv.x, uv.y);
  vec3 t2 = vec3(uv.x * uv.x, uv.x * uv.y, uv.y * uv.y);
  return max(vec3(
    dot(vec3(${SKY[0].slice(0, 3).join(", ")}), t1) + dot(vec3(${SKY[0].slice(3).join(", ")}), t2),
    dot(vec3(${SKY[1].slice(0, 3).join(", ")}), t1) + dot(vec3(${SKY[1].slice(3).join(", ")}), t2),
    dot(vec3(${SKY[2].slice(0, 3).join(", ")}), t1) + dot(vec3(${SKY[2].slice(3).join(", ")}), t2)), 0.0);
}

vec3 hash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return -1.0 + 2.0 * fract((p.xxy + p.yxx) * p.zyx);
}
float gnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(mix(dot(hash3(i), f), dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                 mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)), dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
             mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)), dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                 mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)), dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
}
// Divergence-free flow (curl of a slowly evolving stream function), px/s.
vec2 curl(vec2 q, float scale, float t) {
  vec3 p = vec3(q / scale, t);
  float e = 0.08;
  float n0 = gnoise(p);
  float nx = gnoise(p + vec3(e, 0.0, 0.0));
  float ny = gnoise(p + vec3(0.0, e, 0.0));
  return vec2(ny - n0, -(nx - n0)) / e;
}

// The tower rises and spreads about a point under its base; strongest at the
// top, nothing at the shelf.
vec2 growth(vec2 q) {
  vec2 o = vec2(0.62, 0.98) * PLATE;
  float f = smoothstep(0.88, 0.2, q.y / PLATE.y);
  float side = 1.0 - smoothstep(0.25, 0.55, abs(q.x / PLATE.x - 0.62));
  return (q - o) * 0.06 * uGrow * f * mix(0.45, 1.0, side);
}

// The plate through a Catmull-Rom kernel (nine bilinear taps): where the lens
// magnifies it, bilinear lays the texels down as flat diamonds; this keeps
// the photograph's own curvature between them.
vec3 plateCR(vec2 uv) {
  vec2 sp = uv * PLATE - 0.5;
  vec2 t1 = floor(sp) + 0.5;
  vec2 f = sp + 0.5 - t1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 o12 = w2 / w12;
  vec2 a = (t1 - 1.0) / PLATE, b = (t1 + o12) / PLATE, c = (t1 + 2.0) / PLATE;
  vec3 r = (textureLod(uPlate, vec2(a.x, a.y), 0.0).rgb * w0.x + textureLod(uPlate, vec2(b.x, a.y), 0.0).rgb * w12.x + textureLod(uPlate, vec2(c.x, a.y), 0.0).rgb * w3.x) * w0.y
         + (textureLod(uPlate, vec2(a.x, b.y), 0.0).rgb * w0.x + textureLod(uPlate, vec2(b.x, b.y), 0.0).rgb * w12.x + textureLod(uPlate, vec2(c.x, b.y), 0.0).rgb * w3.x) * w12.y
         + (textureLod(uPlate, vec2(a.x, c.y), 0.0).rgb * w0.x + textureLod(uPlate, vec2(b.x, c.y), 0.0).rgb * w12.x + textureLod(uPlate, vec2(c.x, c.y), 0.0).rgb * w3.x) * w3.y;
  return max(r, 0.0);
}

float capsule(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  // screen, in units of the half height, y up
  vec2 s = vec2((vUv.x - 0.5) * 2.0 * uProj.x, (vUv.y - 0.5) * 2.0);

  // --- sky (at infinity) ---
  vec2 P = toPhoto(s);
  vec2 pS = toPlate(P);
  vec3 sky0 = sky(pS / PLATE);
  // the photograph's blue deepens toward the zenith as the camera looks up
  float elev = atan(P.y / uCam.y) + 0.55 * uCam.x;
  float zen = smoothstep(0.05, 1.3, elev);
  vec3 skyN = mix(sky0, ZENITH, zen * zen * (3.0 - 2.0 * zen) * 0.92);
  vec3 col = skyN;

  // How many of the photograph's texels each pixel spans. High up, the lens
  // magnifies the photograph's lower cloud two- to threefold (fp 0.3-0.5):
  // there bilinear stretch already softens it, and any further diffusion
  // stacked on top smears it into paste, so the boil and its mist step aside
  // (mag -> 1) and the photograph is read sharp, with its curd restored.
  vec2 fdx = dFdx(pS), fdy = dFdy(pS);
  float fp = sqrt(max(dot(fdx, fdx), dot(fdy, fdy)));
  float mag = 1.0 - smoothstep(0.55, 0.85, fp);

  // --- cloud ---
  vec2 pc = pS;
  vec2 p1 = pc - growth(pc);
  float occ = 0.0;
  float thin = 0.0;
  // how far the sample has run toward the photograph's foot, high up only
  float foot = smoothstep(0.6, 0.95, uCam.x) * smoothstep(0.76, 0.97, pc.y / PLATE.y);
  // pure sky far from any cloud (or past the photograph): nothing to evolve
  if (pc.y > 0.0 && textureLod(uFields, p1 / PLATE, 3.0).b > 0.0) {
  vec2 d = vec2(0.0);
  for (int k = 0; k < ${NB}; k++) {
    vec4 b = uBul[k];
    if (b.w <= 0.0) continue;
    vec2 v = p1 - b.xy;
    float r2 = dot(v, v) / (b.z * b.z);
    if (r2 < 1.0) {
      float w = 1.0 - r2;
      d += b.w * v * w * w;
    }
  }
  vec2 q = p1 - d;
  vec2 qb = q / PLATE;
  vec4 fl = texture(uFields, qb);
  float act = fl.r * uBoil * (1.0 - foot) * (1.0 - mag);
  vec3 base = texture(uLow20, qb).rgb;

  // Lobes: curl flow at ~90 px, 11 s re-seed; curd: ~34 px, 6.5 s.
  float ph = gnoise(vec3(q / 260.0, 3.7)) * 0.6;
  vec2 up = vec2(0.0, -1.0);
  vec2 vM = (curl(q, 95.0, uTime * 0.022) * 0.9 + up * 0.45) * act;
  vec2 vF = (curl(q + 400.0, 34.0, uTime * 0.05 + 9.0) * 1.5 + up * 0.6) * act;
  float PM = 11.0, PF = 6.5;
  float fM0 = fract(uTime / PM + ph), fM1 = fract(fM0 + 0.5);
  float fF0 = fract(uTime / PF + ph * 1.7 + 0.25), fF1 = fract(fF0 + 0.5);
  float wM0 = 1.0 - abs(2.0 * fM0 - 1.0), wM1 = 1.0 - wM0;
  float wF0 = 1.0 - abs(2.0 * fF0 - 1.0), wF1 = 1.0 - wF0;
  vec2 qM0 = (q - vM * (fM0 - 0.5) * PM) / PLATE, qM1 = (q - vM * (fM1 - 0.5) * PM) / PLATE;
  vec2 qF0 = (q - vF * (fF0 - 0.5) * PF) / PLATE, qF1 = (q - vF * (fF1 - 0.5) * PF) / PLATE;
  vec3 mid0 = texture(uLow4, qM0).rgb - texture(uLow20, qM0).rgb;
  vec3 mid1 = texture(uLow4, qM1).rgb - texture(uLow20, qM1).rgb;
  vec3 fin0 = texture(uPlate, qF0).rgb - texture(uLow4, qF0).rgb;
  vec3 fin1 = texture(uPlate, qF1).rgb - texture(uLow4, qF1).rgb;
  // Two decorrelated samples averaged lose contrast; restore it in proportion
  // to how far apart they are relative to the band's feature size.
  float nM = mix(1.0, inversesqrt(wM0 * wM0 + wM1 * wM1), clamp(length(vM) * PM * 0.5 / 14.0, 0.0, 1.0));
  float nF = mix(1.0, inversesqrt(wF0 * wF0 + wF1 * wF1), clamp(length(vF) * PF * 0.5 / 5.0, 0.0, 1.0));
  vec3 cl = max(base + (wM0 * mid0 + wM1 * mid1) * nM + (wF0 * fin0 + wF1 * fin1) * nF, 0.0);
  if (mag > 0.0) {
    // Magnified: the boil has stepped aside, so cl is the plate itself. Read
    // it through the cubic, then give back the curd the stretch flattened:
    // its luma minus a three-tap blur ~1.5 texels wide, more the more each
    // texel is stretched. Luma only, so the colour stays the photograph's.
    vec3 sharp = plateCR(qb);
    // Behind where the silhouettes stood the plate is inpainted, and its
    // finest band there is streaks, not curd: those texels, stretched, are
    // the brush strokes. There the cloud is read from its 4 px smoothing and
    // takes only the lobes.
    vec2 sil = textureLod(uLayers, qb, 1.5).rg;
    float inp = smoothstep(0.04, 0.25, max(sil.r, sil.g));
    sharp = mix(sharp, texture(uLow4, qb).rgb, inp);
    vec2 r = 1.5 / PLATE;
    float yb = (dot(textureLod(uPlate, qb + r * vec2(0.0, 1.0), 0.0).rgb, LUMA)
              + dot(textureLod(uPlate, qb + r * vec2(0.866, -0.5), 0.0).rgb, LUMA)
              + dot(textureLod(uPlate, qb + r * vec2(-0.866, -0.5), 0.0).rgb, LUMA)) / 3.0;
    float ys = dot(sharp, LUMA);
    float det = (ys - yb) * 0.6 * clamp(1.0 - fp, 0.0, 1.0) * (1.0 - inp);
    // and the lobes: the band between the 4 px and 20 px smoothings, which the
    // inpainting behind the silhouettes never streaked
    det += (dot(texture(uLow4, qb).rgb - texture(uLow20, qb).rgb, LUMA)) * LOBE;
    sharp *= max(ys + det, 0.0) / max(ys, 1e-4);
    cl = mix(cl, sharp, mag);
  }

  // Relight: the photograph's own shading times new light over old.
  vec3 cn = textureLod(uCloud, qb, 3.2).rgb;
  float mRaw = texture(uCloud, qb).b;
  float m = smoothstep(0.18, 0.6, mRaw);
  vec2 nxy = cn.rg * 2.0 - 1.0;
  vec3 n = vec3(nxy, sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
  const float WR = 0.45;
  vec3 sh0 = AMB + SUN * max(0.0, (dot(n, L0) + WR) / (1.0 + WR));
  vec3 sh1 = AMB + SUN * max(0.0, (dot(n, uL) + WR) / (1.0 + WR));
  vec3 ratio = clamp(sh1 / sh0, 0.72, 1.35);
  // Never darker than photographed: a face the sun leaves keeps its
  // brightness and only changes colour. With the sun behind, the face we see
  // is lit by the sky alone, so it goes to skylight blue at the same
  // luminance, a shade brighter for the glare round it.
  float rl = dot(ratio, LUMA);
  ratio = ratio / max(rl, 1e-3) * max(rl, 1.0);
  ratio *= mix(vec3(1.0), SKYLIT * 1.06, uBehind);
  vec3 skyQ = sky(qb);
  // The cloud as it now stands: its light over the sky. The evolving detail
  // and the soft base reach a little past the baked cloudness, so the relight
  // follows this alpha as well, or the halo outside the mask keeps the old
  // light and stands off the darkened body as a second, ghostly rim.
  float exc = dot(cl - skyQ, LUMA);
  float aC = smoothstep(0.0, 0.1, exc);
  // relight the cloud's light, not the sky seen through its fringe
  vec3 R = mix(vec3(1.0), ratio, max(m, aC));
  float solid = smoothstep(0.62, 0.95, textureLod(uCloud, qb, 4.0).b) * smoothstep(0.45, 0.9, mRaw);
  // (only the cloud's light: where the plate dips a shade under the fitted
  // sky there is no cloud to relight, and scaling it would lift a pale rim)
  vec3 dC = cl - skyQ;
  vec3 lit = mix(skyQ + max(dC, 0.0) * R + min(dC, 0.0), cl * R, solid);
  // With the sun behind, the faces we see are lit by the sky alone. Scaling
  // the photograph's warm, sun-lit colour by a cool skylight only greys it to
  // lavender; instead keep the relit luminance and give it the sky's own hue:
  // the blue of the sky round it, a little thinned on the brightest lobes and
  // full in the shade, so the shadows read as skylight, not as haze.
  float yS = dot(skyQ, LUMA);
  vec3 skyHue = skyQ / max(yS, 1e-4);
  float yC = dot(cl * R, LUMA);
  float shade = 1.0 - smoothstep(0.18, 0.95, yC);
  vec3 tint = mix(vec3(1.0), skyHue, mix(0.1, 0.62, shade));
  tint /= dot(tint, LUMA);
  vec3 litSky = mix(skyQ + dot(max(dC, 0.0) * R, LUMA) * tint + min(dC, 0.0), yC * tint, solid);
  lit = mix(lit, litSky, uBehind);

  // Silver lining: thin edges facing the sun transmit it when it is behind.
  float thick = textureLod(uCloud, qb, 4.0).b;
  vec2 e = vec2(18.0) / PLATE;
  float gx = textureLod(uCloud, qb + vec2(e.x, 0.0), 4.5).b - textureLod(uCloud, qb - vec2(e.x, 0.0), 4.5).b;
  float gy = textureLod(uCloud, qb + vec2(0.0, e.y), 4.5).b - textureLod(uCloud, qb - vec2(0.0, e.y), 4.5).b;
  vec2 g = vec2(gx, -gy);
  vec2 out2 = -g / max(length(g), 1e-3);
  float edge = smoothstep(0.0, 0.6, 1.0 - thick) * smoothstep(0.0, 0.02, length(g));
  float tex = clamp(dot(cl, LUMA) / max(dot(base, LUMA), 1e-3), 0.55, 1.5);
  float bright = smoothstep(0.2, 0.55, dot(base, LUMA));
  // a thin band on the silhouette itself, seated on the cloud's own alpha:
  // eased in from its very edge, gone a little way inside
  float seat = smoothstep(0.03, 0.09, exc) * (1.0 - smoothstep(0.12, 0.32, exc));
  float toward = smoothstep(-0.2, 0.8, dot(out2, uRimDir));
  lit += RIM * (uBehind * 1.7 * edge * toward * seat * bright * tex);

  occ = m * max(clamp(exc / 0.12, 0.0, 1.0), solid);
  // The thin fringe round the silhouette (the cloud as it is seen now, not
  // the baked mask) scatters the sun's light forward rather than hiding it.
  // Blocking the aureole there left the fringe darker than the glowing sky
  // beside it: a teal ghost of a second outline off the cloud.
  thin = smoothstep(0.0, 0.04, exc) * (1.0 - smoothstep(0.08, 0.4, exc));
  // the cloud's own light stays as photographed; only the sky through it deepens
  col = max(skyN + lit - skyQ - (skyN - sky0) * occ, 0.0);
  // Toward the photograph's foot (only ever reached high up, where the lens
  // magnifies it two- to threefold and its texels smear into brush strokes,
  // over a base that was inpainted behind the signal) the cloud gives way to
  // the fitted sky, and the boil and its smear fade out with it. The dim,
  // soft base goes first and the bright lobes last, judged on the lightly
  // smoothed light (lobes, not curd) so they keep whole, crisp outlines.
  float exL = dot(texture(uLow4, qb).rgb * R - skyQ, LUMA) / 0.55;
  float thr = foot * 1.15 - 0.05;
  // Where the lens magnifies, an edge a texel or two wide on the plate is a
  // bright plateau stopping dead a few pixels on screen, a cut matte: feather
  // it over FEATHER of the photograph's texels (from the change in exL across
  // 1.5 of them), and never tighter than a lobe's own falloff, so the dim
  // base thins into the sky like the edge of a film image.
  vec2 r15 = 1.5 / PLATE;
  float kx = dot(textureLod(uLow4, qb + vec2(r15.x, 0.0), 0.0).rgb * R - skyQ, LUMA) / 0.55 - exL;
  float ky = dot(textureLod(uLow4, qb + vec2(0.0, r15.y), 0.0).rgb * R - skyQ, LUMA) / 0.55 - exL;
  float hw = mix(0.04, max(0.07, 0.5 * length(vec2(kx, ky)) * FEATHER / 1.5), mag);
  float keep = mix(1.0, smoothstep(thr - hw, thr + hw, exL), smoothstep(0.0, 0.2, foot));
  col = mix(skyN, col, keep);
  occ *= keep;
  thin *= keep;
  }
  // aureole round the hidden sun, only where there is sky
  float ds = length(pS - uSunPx) / PLATE.x;
  float hide = clamp(occ - thin, 0.0, 1.0);
  // (tight: a broad veil only greys the blue)
  col += vec3(1.0, 0.93, 0.82) * uAure * (0.09 * exp(-ds * ds / 0.006) + 0.01 * exp(-ds / 0.15)) * (1.0 - hide + thin * 0.8);

  // --- wires, masts, gantry: per-pixel disparity, springs ---
  vec2 pWp = layerAt(P, false);
  float fadeW = edgeFade(pWp);
  vec2 pW = pWp / PLATE;
  float swW = texture(uFields, pW).g;
  float sx = pW.x * 6.2832;
  float sy = pW.y * 6.2832;
  float sway = uSway.x * sin(sx * 1.3 + sy * 5.1 + 0.7)
             + uSway.y * sin(sx * 2.1 - sy * 7.3 + 2.1)
             + uSway.z * sin(sx * 0.7 + sy * 11.0 + 4.0);
  vec2 qw = (pWp - vec2(0.18, 1.0) * sway * swW) / PLATE;
  float aW = texture(uLayers, qw).g * fadeW;
  vec3 fW = texture(uFg, qw).rgb;
  col = mix(col, fW, aW);

  // --- the signal ---
  vec2 pn = layerAt(P, true);
  float fadeN = edgeFade(pn);
  vec2 qn = pn / PLATE;
  float aN = texture(uLayers, qn).r * fadeN;
  vec3 fN = texture(uFg, qn).rgb;
  col = mix(col, fN, aN);

  // --- crossing lamps: the red lens seen edge-on, and its spill in the hood ---
  vec3 RED = vec3(1.0, 0.1, 0.035);
  for (int k = 0; k < 2; k++) {
    float I = k == 0 ? uLamp.x : uLamp.y;
    if (I <= 0.001) continue;
    vec3 L = k == 0 ? vec3(${LAMPS[0].join(".0, ")}.0) : vec3(${LAMPS[1].join(".0, ")}.0);
    float dc = capsule(pn, vec2(L.x, L.y), vec2(L.x, L.z));
    float core = exp(-dc * dc / 3.5);
    float spill = exp(-dc / 11.0) * aN;
    float air = exp(-dc / 34.0) * (1.0 - aN);
    col += RED * I * (core * 1.1 + spill * 0.3 + air * 0.16);
  }

  outColor = vec4(col * uExpo, 1.0);
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

// srgb: decode in the sampler so filtering happens in linear light.
function imageTexture(gl, img, { srgb = false, mips = true } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  // mirrored: under the pitch the top corners may look a little past the
  // photograph's sides, where its sky, truss and cloud go on in reflection
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
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
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];

const norm3 = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
// Sun path: low front-left (as photographed) round over to behind the tower's
// upper right shoulder.
const L_A = norm3([-0.8, -0.12, 0.55]);
const L_B = norm3([0.42, 0.5, -0.76]);
function sunDir(t) {
  const dot = L_A[0] * L_B[0] + L_A[1] * L_B[1] + L_A[2] * L_B[2];
  const om = Math.acos(clamp(dot, -1, 1));
  const s = Math.sin(om);
  const a = Math.sin((1 - t) * om) / s;
  const b = Math.sin(t * om) / s;
  return norm3([L_A[0] * a + L_B[0] * b, L_A[1] * a + L_B[1] * b, L_A[2] * a + L_B[2] * b]);
}

export async function createNatsu(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const num = (k) => {
    const v = q.get(k);
    return v != null && v !== "" && Number.isFinite(+v) ? +v : null;
  };
  const tQ = num("t");
  const lightQ = num("light");
  const tiltRaw = q.get("tilt");
  const tiltQ = tiltRaw ? tiltRaw.split(",").map(Number).filter(Number.isFinite) : null;
  const lampQ = num("lamp");
  const pitchQ = num("pitch");
  const frozen = tQ != null || lightQ != null || pitchQ != null || (tiltQ && tiltQ.length > 0);
  const still = frozen || q.get("still") === "1";
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");

  const names = ["plate.webp", "low4.webp", "low20.webp", "cloud.png", "fields.png", "layers.png", "fg.webp"];
  const imgs = await Promise.all(names.map((n) => loadImage(BASE + n)));
  const tex = {
    plate: imageTexture(gl, imgs[0], { srgb: true }),
    low4: imageTexture(gl, imgs[1], { srgb: true, mips: false }),
    low20: imageTexture(gl, imgs[2], { srgb: true, mips: false }),
    cloud: imageTexture(gl, imgs[3]),
    fields: imageTexture(gl, imgs[4], { mips: false }),
    layers: imageTexture(gl, imgs[5]),
    fg: imageTexture(gl, imgs[6], { srgb: true }),
  };

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

  // Layout: full bleed, level on the photograph (the pitch refits it per
  // frame in draw); on a narrow screen the frame is kept on the signal and
  // the tower.
  const L = { x: 0, y: 0, w: 1, h: 1, aspect: 1.6, S: 791, cx: PW / 2 };
  let sceneT = null;
  let filmT = null;
  let dirty = true;
  let scale = 1;
  let lastBox = null;
  const layout = (W, H, dpr) => {
    lastBox = [W, H, dpr];
    Object.assign(L, { x: 0, y: 0, w: W, h: H });
    const aspect = W / H;
    L.aspect = aspect;
    L.cx = aspect < 1.2 ? PW * 0.38 : PW / 2;
    const half = Math.min(L.cx, PW - L.cx) - EDGE;
    L.S = Math.min(half / aspect, (PH - 2 * EDGE) / 2);
    L.pw = Math.max(2, Math.round(L.w * dpr));
    L.ph = Math.max(2, Math.round(L.h * dpr));
    L.rw = Math.max(2, Math.round(L.pw * scale));
    L.rh = Math.max(2, Math.round(L.ph * scale));
    freeTarget(gl, sceneT);
    freeTarget(gl, filmT);
    sceneT = target(gl, L.rw, L.rh, floatOk);
    if (!sceneT.ok) {
      freeTarget(gl, sceneT);
      sceneT = target(gl, L.rw, L.rh, false);
    }
    filmT = target(gl, L.rw, L.rh, false);
    film.resize(L.rw, L.rh);
    dirty = true;
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  // --- input ---
  let holding = false;
  let keyHold = false;
  let tilt = null; // device orientation, -1..1
  let tiltBase = null;
  const cam = { x: 0, y: 0 };
  if (tiltQ && tiltQ.length) {
    cam.x = clamp(tiltQ[0], -1, 1);
    cam.y = clamp(tiltQ[1] ?? 0, -1, 1);
  }
  const onOrient = (e) => {
    if (e.gamma == null || e.beta == null) return;
    if (!tiltBase) tiltBase = [e.gamma, e.beta];
    const gx = clamp((e.gamma - tiltBase[0]) / 12, -1, 1);
    const gy = clamp((e.beta - tiltBase[1]) / 12, -1, 1);
    tilt = tilt ? [tilt[0] + (gx - tilt[0]) * 0.2, tilt[1] + (gy - tilt[1]) * 0.2] : [gx, gy];
  };
  let orientAsked = false;
  const askOrient = () => {
    if (orientAsked || still) return;
    orientAsked = true;
    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === "function") {
      D.requestPermission()
        .then((r) => r === "granted" && window.addEventListener("deviceorientation", onOrient))
        .catch(() => {});
    } else if (D) window.addEventListener("deviceorientation", onOrient);
  };
  stage.on("down", (p, e) => {
    holding = true;
    if (e?.pointerType === "touch") askOrient();
  });
  stage.on("up", () => {
    holding = false;
  });
  host.tabIndex = embedded ? -1 : 0;
  const onKeyDown = (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    keyHold = true;
  };
  const onKeyUp = (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    keyHold = false;
  };
  host.addEventListener("keydown", onKeyDown);
  host.addEventListener("keyup", onKeyUp);

  // --- state ---
  let time = tQ != null ? clamp(tQ, 0, 1) * DUR : 0;
  // look: the camera's pitch as a share of PITCH_MAX; hold: 0..1 on a spring
  const lookOf = (cy) => (cy < 0 ? PITCH_REST - (PITCH_HI - PITCH_REST) * cy : PITCH_REST - (PITCH_REST - PITCH_LO) * cy);
  let look = pitchQ != null ? clamp(pitchQ / PITCH_MAX_DEG, 0, 1) : lookOf(cam.y);
  const lightOf = (lk) => smooth(SUN_FROM, 1, lk);
  let light = lightQ != null ? clamp(lightQ, 0, 1) : lightOf(look);
  let hold = 0;
  let holdV = 0;
  // wire springs: x, v per mode
  const springs = [
    { w: 2 * Math.PI * 0.43, x: 0, v: 0, amp: 1.0 },
    { w: 2 * Math.PI * 0.61, x: 0, v: 0, amp: 0.8 },
    { w: 2 * Math.PI * 0.86, x: 0, v: 0, amp: 0.55 },
  ];
  let gust = 0;
  let t0 = -1;
  let grainClock = 0;
  let grainSeed = 0;
  // A train every so often: the lamps flash for a while.
  const crossingAt = (s) => {
    const first = 6;
    if (s < first) return -1;
    const cyc = 52;
    const k = (s - first) % cyc;
    return k < 15 ? k : -1;
  };

  const bul = new Float32Array(NB * 4);
  const fillBulges = (g) => {
    for (let i = 0; i < NB; i++) {
      const b = BULGES[i];
      const a = b[5] * smooth(b[3], b[3] + b[4], g);
      bul[i * 4] = b[0] * PW;
      bul[i * 4 + 1] = b[1] * PH;
      bul[i * 4 + 2] = b[2] * PW;
      bul[i * 4 + 3] = a;
    }
  };

  const draw = (expoStops, fade, lamps) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    const u = scene.u;
    gl.useProgram(scene.p);
    const units = ["plate", "low4", "low20", "cloud", "fields", "layers", "fg"];
    const uni = ["uPlate", "uLow4", "uLow20", "uCloud", "uFields", "uLayers", "uFg"];
    units.forEach((k, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex[k]);
      gl.uniform1i(u[uni[i]], i);
    });
    // the camera: pitch, the zenith it puts over the frame, and the fit that
    // keeps the whole frame on the photograph (its sides and foot; only the
    // sky round the zenith lies past its top)
    const th = look * PITCH_MAX;
    const R0 = zenithY(th);
    const A = L.aspect;
    const zx = 0.15 + 0.3 * cam.x;
    const xr = (PW - EDGE - L.cx) / L.S;
    const xl = (L.cx - EDGE) / L.S;
    const yLim = (PH / 2 - EDGE) / L.S;
    const par = PARALLAX * smooth(0, 1, look);
    // the widest columns are read at the top corners
    const c = Math.min(R0, (xr - zx) / Math.atan2(A - zx, R0 - 1), (xl + zx) / Math.atan2(A + zx, R0 - 1));
    const bow = BOW_LO + (BOW_HI - BOW_LO) * smooth(PANINI_FROM / PITCH_MAX, 1, look);
    const bowR = (dx) => Math.sqrt((R0 + 1) ** 2 + bow * dx * dx);
    const lnB = Math.log(Math.max(bowR(A - zx), bowR(A + zx)) / R0);
    const yTop = yLim + c * Math.log((R0 - 1) / R0);
    const yBot = -yLim + c * lnB + par * 0.86;
    gl.uniform4f(u.uProj, A, L.S, PH / 2, L.cx);
    gl.uniform4f(u.uCam, th, FOCAL, par, bow);
    gl.uniform4f(u.uMap, zx, R0, c, Math.max(yTop, yBot));
    const g = 1 - Math.pow(1 - clamp(time / DUR, 0, 1), 1.6);
    gl.uniform1f(u.uGrow, g);
    fillBulges(g);
    gl.uniform4fv(u.uBul, bul);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uBoil, reduce && !still ? 0 : 1);
    gl.uniform4f(u.uSway, springs[0].x, springs[1].x, springs[2].x, 0);
    const Ld = sunDir(light);
    gl.uniform3f(u.uL, Ld[0], Ld[1], Ld[2]);
    const rl = Math.hypot(Ld[0], Ld[1]) || 1;
    gl.uniform2f(u.uRimDir, Ld[0] / rl, Ld[1] / rl);
    gl.uniform1f(u.uBehind, smooth(0.0, 0.7, -Ld[2]));
    // the hidden sun's place in the frame when it is behind (plate px)
    const sx = 0.62 + (Ld[0] / Math.max(0.35, -Ld[2] + 0.35)) * 0.32;
    const sy = 0.3 - (Ld[1] / Math.max(0.35, -Ld[2] + 0.35)) * 0.32;
    gl.uniform2f(u.uSunPx, sx * PW, sy * PH);
    gl.uniform1f(u.uAure, smooth(0.1, 0.8, -Ld[2]));
    gl.uniform2f(u.uLamp, lamps[0], lamps[1]);
    gl.uniform1f(u.uExpo, 1.12 * 2 ** expoStops);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, L.rw, L.rh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    film.render(
      sceneT.tex,
      {
        ...FILM_PRESETS.summer,
        input: floatOk && sceneT.ok ? "linear" : "srgb",
        halation: 0.3 + 0.3 * light,
        halationThreshold: 0.8,
        bloom: 0.2 + 0.08 * light,
        softness: 0.55,
        contrast: 1.14,
        whitePoint: 1.25,
        toe: 0.085,
        toeColor: [0.7, 1, 1.25],
        blueDepth: 0.3,
        saturation: 1.06,
        vignette: 0.22,
        grain: 0.3,
        grainSeed,
      },
      filmT.fbo,
    );

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
  };

  // Reveal: the print comes up as an overexposed white-blue and the cobalt
  // deepens over two seconds, the eye adjusting to a summer sky.
  const REVEAL = 2.0;
  let slow = 0;
  let lastNow = 0;
  let wall = 0;
  stage.onFrame((dt) => {
    if (!sceneT) return;
    const now = performance.now();
    const real = lastNow ? (now - lastNow) / 1000 : 1 / 60;
    lastNow = now;
    if (!frozen) {
      const r = Math.min(real, 0.25);
      slow = real > 1 / 40 ? slow + r : Math.max(0, slow - r * 0.5);
      if (slow > 1.2 && scale > 0.5) {
        scale = scale > 0.8 ? 0.75 : 0.5;
        slow = 0;
        if (lastBox) layout(...lastBox);
      }
    }
    wall += dt;
    if (t0 < 0) t0 = wall;
    const age = still ? 99 : wall - t0;
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 2.5 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
    }

    let lamps = [0, 0];
    if (frozen) {
      // a held still: springs at a fixed phase, lamps as asked
      springs.forEach((s, i) => (s.x = s.amp * 1.4 * Math.sin(s.w * time + i * 1.7)));
      if (lampQ === 1) lamps = [1, 0];
      if (lampQ === 2) lamps = [0, 1];
    } else {
      if (!reduce) time += dt;
      // camera: pointer (or tilt) with an exponential approach, idle breathing
      const p = stage.pointer;
      let tx = 0;
      let ty = 0;
      if (tilt) {
        tx = tilt[0];
        ty = tilt[1];
      } else if (p.inside) {
        tx = clamp((p.x - (L.x + L.w / 2)) / (L.w / 2), -1, 1);
        ty = clamp((p.y - (L.y + L.h / 2)) / (L.h / 2), -1, 1);
      }
      if (!reduce) {
        tx += 0.07 * Math.sin((wall * 2 * Math.PI) / 11);
        ty += 0.05 * Math.sin((wall * 2 * Math.PI) / 13.7 + 1.1);
      }
      const tau = p.inside || tilt ? 0.36 : 0.9;
      const k = 1 - Math.exp(-dt / tau);
      cam.x += (tx - cam.x) * k;
      cam.y += (ty - cam.y) * k;

      // the hold: a critically-ish damped spring toward held / let go; it
      // tips the look all the way up, and the sun comes round with the look
      const goal = holding || keyHold ? 1 : 0;
      const w = 2.6;
      const z = 0.92;
      const acc = w * w * (goal - hold) - 2 * z * w * holdV;
      holdV += acc * dt;
      hold += holdV * dt;
      hold = clamp(hold, -0.02, 1.02);
      look = lookOf(cam.y) + (1 - lookOf(cam.y)) * hold;
      light = clamp(lightOf(look), 0, 1);

      // wind on the wires: two incommensurate gust sines, and a nudge when the
      // pointer sweeps fast across the print
      gust *= Math.exp(-dt / 0.8);
      if (p.inside) gust += Math.min(1, Math.abs(p.vx) / 4000) * dt * 6;
      const wind = 0.55 * Math.sin(wall * 0.37) * Math.sin(wall * 0.11 + 1) + 0.25 * Math.sin(wall * 1.3 + 0.4);
      for (const s of springs) {
        const f = (wind + gust) * s.amp * 3.2;
        const a = s.w * s.w * (f / (s.w * 0.9) - s.x) - 2 * 0.07 * s.w * s.v;
        s.v += a * dt;
        s.x += s.v * dt;
        s.x = clamp(s.x, -3, 3);
      }
      if (reduce) springs.forEach((s) => (s.x = 0));

      const c = crossingAt(wall);
      if (c >= 0 && !reduce) {
        const fadeIn = smooth(0, 0.4, c) * (1 - smooth(14.2, 15, c));
        const ph = c % 1.2;
        const env = (o) => (o < 0.6 ? 1 - Math.exp(-o / 0.06) : 0.9975 * Math.exp(-(o - 0.6) / 0.12));
        lamps = [env(ph) * fadeIn, env((ph + 0.6) % 1.2) * fadeIn];
      }
    }

    if (!reduce && !frozen) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        grainSeed = (grainSeed + 1) % 997;
      }
    }
    const moving = !frozen && (!reduce || Math.abs(holdV) > 1e-4 || age < 0.5);
    if (!dirty && !moving) return;
    dirty = false;
    draw(expo, fade, lamps);
  });

  return {
    destroy() {
      host.removeEventListener("keydown", onKeyDown);
      host.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("deviceorientation", onOrient);
      film.destroy();
      freeTarget(gl, sceneT);
      freeTarget(gl, filmT);
      Object.values(tex).forEach((t) => gl.deleteTexture(t));
      gl.deleteProgram(scene.p);
      gl.deleteProgram(blit.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
