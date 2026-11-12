import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Joiner: after David Hockney's photo joiners. Lie on the quay, look up, and
// take the sky one Polaroid at a time.
//
// The sky is one 360 capture (Poly Haven's Docklands 01, CC0), baked offline
// into a zenith-centred disk of log radiance with a sky matte and a sky-only
// plate. The table is a stereographic map of that sky: every point on it is a
// direction, the zenith in the middle. A print aimed at a point is a real
// rectilinear camera pointed along that direction, its focal length matched
// to the map's local scale there, so neighbouring prints fit together. Each
// one is still its own camera and its own moment, the way Hockney's are:
//   - its aim and roll are off by a degree or so, like a hand-held shot;
//   - its electric eye meters its own patch of sky, so a print full of wall
//     comes out brighter than one full of cloud, plus a little batch scatter
//     in exposure, white balance and dye;
//   - its clouds are where they were at the moment it was taken: the sky is
//     advected on a cloud deck by a gentle wind (and a little shear), so the
//     cumulus disagree across the borders while walls and lamp posts do not.
// Each frame is developed through the shared film kit (summer preset, a
// polariser deepening the open blue, blacks barely lifted), then its sky is
// re-graded from the plate's dull overcast to a June sky: sunlit cumulus on a
// warm shoulder just under paper white, skylight-blue cloud shadow, and a
// clear sky that deepens to cobalt towards the zenith (see SKY_GRADE).
//
// Drag to shoot prints where you point. Long-press to sweep the table.
// Query: ?prints=N&seed=S lays down a pre-built joiner of N prints;
// ?t=seconds freezes the newest print that long into its fall; ?sweep=seconds
// holds a long-press sweep; ?ev= and any film parameter override the film;
// ?grade=0..1 and the other SKY_GRADE keys override the sky grade.

const ASSET = "/lab/joiner/";
const THMAX = (120 * Math.PI) / 180; // disk rim, from the zenith
const LO = -8;
const HI = 5; // log2 radiance range of the 8-bit disk

// Polaroid SX-70 integral print, mm: 88 x 107 frame, 79 mm square image.
const FW = 88 / 79;
const FH = 107 / 79;
const TOP = 6 / 79;
const IMG_OFF = -FH / 2 + TOP + 0.5; // image centre from frame centre, in image widths (y down)

const FIELD = 0.64; // radians across one print at the zenith (about 37 degrees, an SX-70's 116 mm on 79 mm)
const WIND = [0.79, 0.61]; // cloud-deck drift direction (disk frame)
const GUST = 0.04; // cloud-deck displacement per unit of moment (x deck height)
const MAX_PRINTS = 160;

const TABLE = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];

const FILM_BASE = {
  ...FILM_PRESETS.summer,
  input: "linear",
  toe: 0.04,
  toeColor: [0.92, 1, 1.06],
  contrast: 1.4,
  shoulder: 0.85,
  whitePoint: 4,
  saturation: 1.45,
  blueDepth: 1,
  warmth: 0.4,
  highlightTint: [1.06, 0.96, 0.92],
  shadowTint: [0.82, 0.92, 1.12],
  bloom: 0.18,
  halation: 0.34,
  halationThreshold: 3,
  softness: 0.36,
  vignette: 0.2,
  grain: 0.32,
};

// A polariser on the lens: open blue sky goes deeper and loses its green
// (cyan to cobalt), white cloud and everything off the sky matte are left alone.
// Per channel, in scene light, scaled by how blue the sky is.
const POLARIZER = [0.44, 0.5, 0.78];

// Without float targets the raw view is stored 8-bit; it keeps this much gain
// (stops) so cloud has headroom there, and the film adds the rest back.
const RAW8_EV = -1.7;

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// One print's view: a rectilinear camera into the disk.
const VIEW = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
uniform sampler2D uMask;
uniform sampler2D uSky;
uniform vec3 uC;
uniform vec3 uR;
uniform vec3 uD;
uniform float uF;      // focal length, in the same units as uHalf
uniform float uHalf;   // half the image width
uniform vec2 uWind;    // cloud-deck displacement (x deck height)
uniform vec3 uShear;   // amplitude, phase x, phase y
uniform float uGain;   // 1 for a float target; < 1 for the RGBA8 fallback
uniform float uSrgb;
const float THMAX = ${THMAX.toFixed(6)};
const float LO = ${LO.toFixed(1)};
const float HI = ${HI.toFixed(1)};
const vec3 POL = vec3(${POLARIZER.map((v) => v.toFixed(3)).join(", ")});

vec2 diskUv(vec3 d) {
  float th = acos(clamp(d.z, -1.0, 1.0));
  float l = length(d.xy);
  vec2 dir = l > 1e-6 ? d.xy / l : vec2(1.0, 0.0);
  return 0.5 + 0.5 * (th / THMAX) * dir;
}
vec3 rad(vec3 v) { return exp2(LO + v * (HI - LO)); }

void main() {
  vec2 s = vec2(vUv.x - 0.5, 0.5 - vUv.y) * 2.0 * uHalf;   // y down
  vec3 d = normalize(uC * uF + uR * s.x + uD * s.y);
  vec2 uv = diskUv(d);
  vec3 base = rad(texture(uScene, uv).rgb);
  float m = texture(uMask, uv).r;

  vec3 col = base;
  float key = 0.0;
  if (m > 0.002 && d.z > 0.01) {
    // The same sky a moment earlier or later: move the cloud deck under the
    // wind, with a little shear so the shapes have evolved too.
    vec2 P = d.xy / d.z;
    vec2 shear = uShear.x * vec2(sin(P.y * 1.9 + uShear.y), sin(P.x * 1.6 + uShear.z));
    float k = smoothstep(0.02, 0.2, d.z);
    vec2 P2 = P - (uWind + shear) * k;
    vec3 d2 = normalize(vec3(P2, 1.0));
    vec2 uv2 = diskUv(d2);
    vec3 moved = rad(texture(uScene, uv2).rgb);
    vec3 fill = rad(texture(uSky, uv2).rgb);
    float m2 = texture(uMask, uv2).r;
    vec3 sky = mix(fill, moved, smoothstep(0.55, 0.98, m2));
    col = mix(base, sky, m);
    float blue = smoothstep(0.4, 0.85, (col.b - col.r) / (col.b + 1e-4));
    col *= mix(vec3(1.0), POL, blue * m);
    key = m * smoothstep(0.01, 0.06, d.z);
  }
  col *= uGain;
  if (uSrgb > 0.5) col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  // the sky matte rides along in alpha for the sky grade after the film
  outColor = vec4(col, key);
}`;

// The sky grade, the last step of each print's develop. The Docklands plate
// was shot under a dull, broken overcast; a June print of it should be sunlit
// cumulus on cobalt. That is a matter of cloud tonality, not exposure (more
// exposure only pales the blue while the cloud stays grey), so the grade works
// on the developed print, keyed on the sky matte (carried in the view's alpha)
// and on how blue the scene light is there:
//   - cloud: its luminance goes through a filmic shoulder with a toe, so the
//     sunlit tops climb to a warm-neutral paper white (#F4F1EA, never past it)
//     while the undersides keep their depth; the shadow side is toned
//     towards skylight blue (hue 208, sat 0.40), the colour of shade under an
//     open sky, in proportion to how far the cloud sits below the shoulder;
//   - clear sky: recoloured along a zenith gradient, deep cobalt (#0E5FB0)
//     straight up, opening towards the rim, carrying the print's own exposure,
//     vignette and grain as a ratio so every print still meters for itself.
const srgbHex = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i + 1, i + 3), 16) / 255);
const SKY_GRADE = {
  cloudGain: 5.5, // gain on cloud luminance (linear) into the shoulder
  cloudToe: 1.6, // power on cloud luminance before the shoulder: deepens the undersides
  splitTone: 1, // 0 leaves cloud neutral, 1 is the full skylight split
  keep: 0.5, // share of the print's own dye cast kept in the cloud
  skyKeep: 0.7, // power of the print's own exposure ratio kept in the clear sky
  grade: 1, // overall strength
};
const CLOUD_HI = srgbHex("#F4F1EA");
const CLOUD_SHADE = [0.552, 0.7483, 0.92]; // HSV(208, 0.40, 0.92)
const CLOUD_SHADE_DEPTH = 0.84; // cloud luminance kept at full shade, past SHADE's V
const SKY_ZENITH = srgbHex("#0E5FB0");
const SKY_RIM = srgbHex("#3F8AD0");
const SKY_VREF = 0.34; // clear-sky peak channel (linear) the film lays down at the zenith
const vec3 = (v) => `vec3(${v.map((x) => x.toFixed(4)).join(", ")})`;

const GRADE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uDev;  // the developed print (sRGB)
uniform sampler2D uRaw;  // the camera's view, scene light; alpha = sky matte
uniform float uRawSrgb;
uniform vec3 uC;
uniform vec3 uR;
uniform vec3 uD;
uniform float uF;
uniform float uHalf;
uniform vec4 uCloud;     // gain, toe, split, keep
uniform vec2 uSky;       // keep, strength
uniform float uSeed;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const vec3 HI = ${vec3(CLOUD_HI)};
const vec3 SHADE = ${vec3(CLOUD_SHADE)};
const vec3 ZEN = ${vec3(SKY_ZENITH)};
const vec3 RIM = ${vec3(SKY_RIM)};
const float SHADE_V = ${Math.max(...CLOUD_SHADE).toFixed(4)};
const float SHADE_DEPTH = ${CLOUD_SHADE_DEPTH.toFixed(4)};
const float VREF = ${SKY_VREF.toFixed(4)};

vec3 toLin(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec4 dev = texture(uDev, vUv);
  vec4 raw = texture(uRaw, vUv);

  // how blue the scene light is: open sky against cloud. Read over a few
  // pixels, so the plate's compressed chroma blocks never reach the key. The
  // same ring dilates the matte by those few pixels (light pixels only), so
  // its soft rim and any hairline left in it are graded with the sky around
  // them instead of standing out as an ungraded fringe.
  vec2 rt = 3.0 / vec2(textureSize(uRaw, 0));
  vec3 sc = raw.rgb * 0.2;
  float ring = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398 + 0.39;
    vec4 t = texture(uRaw, vUv + rt * vec2(cos(a), sin(a)));
    sc += t.rgb * 0.1;
    ring = max(ring, t.a);
  }
  float Y0 = dot(toLin(dev.rgb), LUMA);
  float m = max(raw.a, ring * smoothstep(0.08, 0.3, Y0));
  m = smoothstep(0.0, 0.6, m) * uSky.y;
  if (m < 0.002) { outColor = dev; return; }
  if (uRawSrgb > 0.5) sc = pow(sc, vec3(2.2));
  float clear = smoothstep(0.28, 0.62, (sc.b - sc.r) / (sc.b + 1e-4));

  vec3 lin = toLin(dev.rgb);
  float Y = dot(lin, LUMA);

  // cloud: toe, then an exponential shoulder that lands on HI and stays there.
  // The curve is steep in the mids, so it reads a grain-free luminance (a
  // little blur of the print) and the grain rides back on as a plain ratio
  // instead of being stretched with the cloud.
  vec2 tx = 1.5 / vec2(textureSize(uDev, 0));
  float Yb = 0.5 * Y + 0.125 * (dot(toLin(texture(uDev, vUv + vec2(tx.x, 0.0)).rgb), LUMA)
    + dot(toLin(texture(uDev, vUv - vec2(tx.x, 0.0)).rgb), LUMA)
    + dot(toLin(texture(uDev, vUv + vec2(0.0, tx.y)).rgb), LUMA)
    + dot(toLin(texture(uDev, vUv - vec2(0.0, tx.y)).rgb), LUMA));
  vec3 hiL = toLin(HI);
  float W = dot(hiL, LUMA);
  float x = pow(max(Yb, 0.0), uCloud.y) * uCloud.x;
  float Yc = W * (1.0 - exp(-x / W)) * pow(clamp((Y + 0.004) / (Yb + 0.004), 0.8, 1.25), 0.75);
  vec3 shadeL = toLin(SHADE);
  shadeL /= dot(shadeL, LUMA);
  // skylight shade by inverse cloud luminance, read before the shoulder (past
  // it every cloud body is within a few percent of HI and the undersides
  // would be lost): full in the undersides, gone on the sunlit tops. The
  // shade sits lower as well as cooler (SHADE's V, then the shadow depth), so
  // the body is modelled in value and the blue side never reads as clear sky.
  float shade = (1.0 - smoothstep(0.8, 3.2, x / W)) * uCloud.z;
  vec3 tint = mix(hiL / W, shadeL * SHADE_V * SHADE_DEPTH, shade);
  vec3 own = mix(vec3(1.0), (lin + 0.002) / (Y + 0.002), uCloud.w);
  vec3 cloud = min(tint * Yc * own, hiL);

  // clear sky: a zenith gradient carrying the print's own exposure
  vec2 s = vec2(vUv.x - 0.5, 0.5 - vUv.y) * 2.0 * uHalf;
  vec3 d = normalize(uC * uF + uR * s.x + uD * s.y);
  float th = acos(clamp(d.z, -1.0, 1.0));
  vec3 tgt = toLin(mix(ZEN, RIM, smoothstep(0.0, 1.35, th)));
  float V = max(lin.r, max(lin.g, lin.b));
  vec3 sky = tgt * pow(clamp(V / VREF, 0.55, 1.25), uSky.x);

  vec3 g = mix(cloud, sky, clear);
  // Low over the roofs the plate is haze and push-pull fill round every
  // structure, which a full grade would outline; ease it off towards the
  // horizon, where a real sky pales anyway.
  m *= mix(1.0, 0.4, smoothstep(0.9, 1.45, th));
  vec3 outc = toSrgb(mix(lin, g, m));
  outc += (hash12(gl_FragCoord.xy + uSeed) + hash12(gl_FragCoord.yx + 5.3 + uSeed) - 1.0) / 255.0;
  outColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
}`;

// A print on the table: paper, image, and its shadow, drawn in one quad.
const PRINT_VS = `#version 300 es
in vec2 aPos;
uniform vec2 uCenter;   // css px, box frame
uniform vec2 uExt;      // quad half extent, css px (axis aligned, covers shadow)
uniform vec2 uRes;      // box css px
out vec2 vW;
void main() {
  vW = uCenter + aPos * uExt;
  vec2 c = vW / uRes * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;

const PRINT_FS = `#version 300 es
precision highp float;
in vec2 vW;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uCenter;
uniform vec2 uCS;       // cos, sin of rotation
uniform float uScale;
uniform float uImg;     // image side, css px (at scale 1)
uniform float uLift;    // 0 on the table .. 1 held up
uniform float uAlpha;
uniform float uDpr;
uniform float uDevelop; // 0 = fresh grey-green, 1 = developed
const float FW = ${FW.toFixed(6)};
const float FH = ${FH.toFixed(6)};
const float IMG_OFF = ${IMG_OFF.toFixed(6)};

vec2 toLocal(vec2 w) {
  vec2 p = w - uCenter;
  return vec2(uCS.x * p.x + uCS.y * p.y, -uCS.y * p.x + uCS.x * p.y) / uScale;
}
float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
// erf approximation (Abramowitz-Stegun 7.1.26 grade, plenty for a shadow)
float erf1(float x) {
  float s = sign(x); x = abs(x);
  float t = 1.0 / (1.0 + 0.47047 * x);
  float y = 1.0 - (0.3480242 * t - 0.0958798 * t * t + 0.7478556 * t * t * t) * exp(-x * x);
  return s * y;
}
float boxBlur(vec2 p, vec2 b, float sigma) {
  float k = 0.70710678 / sigma;
  float x = 0.5 * (erf1((b.x - p.x) * k) + erf1((b.x + p.x) * k));
  float y = 0.5 * (erf1((b.y - p.y) * k) + erf1((b.y + p.y) * k));
  return x * y;
}

void main() {
  float img = uImg;
  vec2 half_ = vec2(FW, FH) * img * 0.5;
  float px = 1.0 / (uDpr * uScale); // one device px in local css units

  // Shadows: a tight contact shadow while it lies flat, a soft drop shadow
  // that spreads and drifts away from the light as it is lifted.
  float h = uLift;
  vec2 offA = vec2(0.12, 0.55) * (1.0 + 18.0 * h);
  float sA = 1.4 + 13.0 * h;
  float aA = 0.2 * (1.0 - 0.45 * h);
  float shA = aA * boxBlur(toLocal(vW - offA), half_ - 0.5, sA / uScale);
  float shC = 0.30 * (1.0 - smoothstep(0.0, 0.08, h)) * boxBlur(toLocal(vW - vec2(0.0, 0.45)), half_, 0.75);
  float sh = 1.0 - (1.0 - shA) * (1.0 - shC);

  vec2 q = toLocal(vW);
  float sd = sdBox(q, half_, img * 0.02);
  float cov = clamp(0.5 - sd / px, 0.0, 1.0);

  // Paper: the white frame, a hair cooler under the light when lifted.
  vec3 paper = vec3(0.972, 0.968, 0.952) + 0.006 * h;
  vec2 qi = q - vec2(0.0, IMG_OFF * img);
  float sdi = sdBox(qi, vec2(img * 0.5), img * 0.006);
  float inImg = clamp(0.5 - sdi / px, 0.0, 1.0);
  vec2 uv = vec2(qi.x / img + 0.5, 0.5 - qi.y / img);
  vec3 photo = texture(uTex, uv).rgb;
  // Undeveloped integral film is an opaque blue-grey that clears.
  vec3 raw = vec3(0.36, 0.42, 0.42);
  photo = mix(raw, photo, uDevelop);
  // the frame's mask sits a hair proud of the image: a faint inner line
  float rim = 1.0 - 0.07 * (1.0 - smoothstep(0.0, 1.4 * px + 0.35, abs(sdi)));
  vec3 col = mix(paper * rim, photo, inImg);

  vec3 shadowCol = vec3(0.16, 0.13, 0.10);
  vec3 rgb = col * cov + shadowCol * sh * (1.0 - cov);
  float a = cov + sh * (1.0 - cov);
  outColor = vec4(rgb, a) * uAlpha;
}`;

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

async function loadBitmap(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  return createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function mulberry(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rnd) => {
  const u = Math.max(1e-9, rnd());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
};

// Damped spring, semi-implicit Euler in small steps.
function stepSpring(s, omega, zeta, dt) {
  const n = Math.ceil(dt / (1 / 240));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const a = -omega * omega * (s.x - s.to) - 2 * zeta * omega * s.v;
    s.v += a * h;
    s.x += s.v * h;
  }
}
const spring = (x, to = x, v = 0) => ({ x, to, v });

// --- the table's map: stereographic, zenith at the centre (units of f) -----
function dirOf(x, y) {
  const r = Math.hypot(x, y);
  const th = 2 * Math.atan(r / 2);
  const s = Math.sin(th);
  const c = r > 1e-9 ? 1 / r : 0;
  return [s * x * c, s * y * c, Math.cos(th)];
}
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export async function createJoiner(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const qn = q.get("prints");
  const still = qn != null && qn !== "" && Number.isFinite(+qn);
  const seed0 = Number.isFinite(+q.get("seed")) && q.get("seed") !== null ? +q.get("seed") : 7;
  const qt = q.get("t");
  const freezeT = qt != null && qt !== "" && Number.isFinite(+qt) ? +qt : null;
  const ev0 = Number.isFinite(+q.get("ev")) && q.get("ev") !== null ? +q.get("ev") : -0.5;
  // Any numeric film parameter can be overridden from the query for stills.
  const film0 = { ...FILM_BASE };
  for (const key of Object.keys(FILM_BASE)) {
    const v = q.get(key);
    if (typeof FILM_BASE[key] === "number" && v != null && v !== "" && Number.isFinite(+v)) film0[key] = +v;
  }
  const grade0 = { ...SKY_GRADE };
  for (const key of Object.keys(SKY_GRADE)) {
    const v = q.get(key);
    if (v != null && v !== "" && Number.isFinite(+v)) grade0[key] = +v;
  }
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  host.style.background = "#f2f0eb";
  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false, alpha: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");

  const [sceneBm, maskBm, skyBm] = await Promise.all([
    loadBitmap(`${ASSET}scene.webp`),
    loadBitmap(`${ASSET}mask.webp`),
    loadBitmap(`${ASSET}sky.webp`),
  ]);

  // A small copy of the disk for the prints' electric eye.
  const METER_N = 128;
  const meterLum = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = METER_N;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(sceneBm, 0, 0, METER_N, METER_N);
    const d = x.getImageData(0, 0, METER_N, METER_N).data;
    const out = new Float32Array(METER_N * METER_N);
    for (let i = 0; i < out.length; i++) {
      const r = d[i * 4] / 255;
      const g = d[i * 4 + 1] / 255;
      const b = d[i * 4 + 2] / 255;
      // log2 luminance, roughly (the channels are log-encoded)
      out[i] = LO + (0.2 * r + 0.7 * g + 0.1 * b) * (HI - LO);
    }
    return out;
  })();
  const meterAt = (d) => {
    const th = Math.acos(clamp(d[2], -1, 1));
    const l = Math.hypot(d[0], d[1]) || 1;
    const r = (0.5 * th) / THMAX;
    const u = clamp(Math.floor((0.5 + (r * d[0]) / l) * METER_N), 0, METER_N - 1);
    const v = clamp(Math.floor((0.5 + (r * d[1]) / l) * METER_N), 0, METER_N - 1);
    return meterLum[v * METER_N + u];
  };

  // A print's electric eye, in log2 luminance. Centre-weighted, but it reads
  // highlights first: the reading is the brighter of the weighted mean and the
  // 80th percentile, so the brightest sky in frame sets the exposure and a
  // dark wall cannot talk it into blowing that sky out.
  const meterPrint = (c, R, D, F, span) => {
    const k = 3;
    const v = [];
    let m = 0;
    let wsum = 0;
    for (let j = -k; j <= k; j++)
      for (let i = -k; i <= k; i++) {
        const sx = (i / k) * 0.45 * span;
        const sy = (j / k) * 0.45 * span;
        const d = norm([c[0] * F + R[0] * sx + D[0] * sy, c[1] * F + R[1] * sx + D[1] * sy, c[2] * F + R[2] * sx + D[2] * sy]);
        const l = meterAt(d);
        const w = 1 / (1 + 0.6 * ((i * i + j * j) * 4) / (k * k));
        m += l * w;
        wsum += w;
        v.push(l);
      }
    v.sort((x, y) => x - y);
    return Math.max(m / wsum, v[Math.floor(0.8 * (v.length - 1))]);
  };

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
  const upload = (bm, mip) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bm);
    if (mip) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    bm.close?.();
    return t;
  };
  const texScene = upload(sceneBm, true);
  const texMask = upload(maskBm, true);
  const texSky = upload(skyBm, true);

  const half = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
  const view = compile(gl, VERT, VIEW);
  const printP = compile(gl, PRINT_VS, PRINT_FS);
  const gradeP = compile(gl, VERT, GRADE);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const film = createFilm(gl, { width: 2, height: 2 });

  // --- layout ---------------------------------------------------------------
  let W = 1;
  let H = 1;
  let dpr = 1;
  let img = 120; // image side, css px
  let f = 245; // stereographic f, css px
  let cell = 256; // print texture side, device px
  let rawTex = null;
  let rawFbo = null;
  let rawLinear = true;
  let devTex = null; // the film's output, before the sky grade
  let devFbo = null;

  const allocRaw = () => {
    if (rawTex) gl.deleteTexture(rawTex);
    if (rawFbo) gl.deleteFramebuffer(rawFbo);
    rawTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, rawTex);
    rawFbo = gl.createFramebuffer();
    let ok = false;
    if (half) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, cell, cell, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, rawFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rawTex, 0);
      ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    }
    if (!ok) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cell, cell, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, rawFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rawTex, 0);
    }
    rawLinear = ok;
    if (devTex) gl.deleteTexture(devTex);
    if (devFbo) gl.deleteFramebuffer(devFbo);
    devTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, devTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cell, cell, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
    devFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, devFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, devTex, 0);
    gl.bindTexture(gl.TEXTURE_2D, rawTex);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    film.resize(cell, cell);
  };

  // --- prints ---------------------------------------------------------------
  const prints = [];
  let serial = 0;
  let zenithMeter = 0;
  const clock0 = performance.now();

  // Everything about a print that is decided when it is taken. Positions are
  // in units of f, so the joiner survives a resize.
  const makePrint = (ix, iy, opts = {}) => {
    const rnd = mulberry((opts.seed ?? seed0 * 7919 + serial * 104729) >>> 0);
    const rot = clamp(gauss(rnd) * 0.075, -0.16, 0.16);
    // the frame centre sits below the image centre the pointer aimed at
    const offY = IMG_OFF * (img / f);
    const cx = ix + Math.sin(rot) * offY;
    const cy = iy - Math.cos(rot) * offY;
    const moment = opts.moment ?? 0;
    const p = {
      id: serial++,
      ix,
      iy,
      cx,
      cy,
      rot,
      roll: gauss(rnd) * 0.018,
      aim: [gauss(rnd) * 0.016, gauss(rnd) * 0.016],
      dev: gauss(rnd) * 0.12,
      warm: gauss(rnd) * 0.1,
      dye: gauss(rnd) * 0.022,
      wind: (moment + gauss(rnd) * 0.22) * GUST,
      shear: [0.006 + rnd() * 0.006, rnd() * 6.283, rnd() * 6.283],
      grain: rnd() * 997,
      tex: null,
      fbo: null,
      // motion
      x: spring(cx),
      y: spring(cy),
      r: spring(rot),
      h: spring(0),
      born: opts.born ?? -1e9,
      alpha: 1,
      develop: 1,
      sweep: null,
    };
    return p;
  };

  const renderPrint = (p) => {
    if (!p.tex) {
      p.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, p.tex);
      p.fbo = gl.createFramebuffer();
    }
    if (p.cell !== cell) {
      gl.bindTexture(gl.TEXTURE_2D, p.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cell, cell, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, p.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, p.tex, 0);
      p.cell = cell;
    }
    // the camera: aimed at the image centre, its frame turned with the paper
    const e = 1e-3;
    const c0 = dirOf(p.ix, p.iy);
    const a = dirOf(p.ix + e, p.iy);
    const b = dirOf(p.ix - e, p.iy);
    let right = norm([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
    let down = norm(cross(c0, right));
    right = norm(cross(down, c0));
    const th = 2 * Math.atan(Math.hypot(p.ix, p.iy) / 2);
    const F = 1 / Math.cos(th / 2) ** 2; // local scale of the map, f units per radian
    const c = norm([
      c0[0] + right[0] * p.aim[0] + down[0] * p.aim[1],
      c0[1] + right[1] * p.aim[0] + down[1] * p.aim[1],
      c0[2] + right[2] * p.aim[0] + down[2] * p.aim[1],
    ]);
    const ang = p.rot + p.roll;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    let R = [ca * right[0] + sa * down[0], ca * right[1] + sa * down[1], ca * right[2] + sa * down[2]];
    let D = [-sa * right[0] + ca * down[0], -sa * right[1] + ca * down[1], -sa * right[2] + ca * down[2]];
    D = norm(cross(c, R));
    R = norm(cross(D, c));

    gl.bindFramebuffer(gl.FRAMEBUFFER, rawFbo);
    gl.viewport(0, 0, cell, cell);
    gl.disable(gl.BLEND);
    gl.useProgram(view.p);
    gl.bindVertexArray(vao);
    const u = view.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texScene);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texMask);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, texSky);
    gl.uniform1i(u.uScene, 0);
    gl.uniform1i(u.uMask, 1);
    gl.uniform1i(u.uSky, 2);
    gl.uniform3fv(u.uC, c);
    gl.uniform3fv(u.uR, R);
    gl.uniform3fv(u.uD, D);
    gl.uniform1f(u.uF, F);
    gl.uniform1f(u.uHalf, (0.5 * img) / f);
    gl.uniform2f(u.uWind, WIND[0] * p.wind, WIND[1] * p.wind);
    gl.uniform3fv(u.uShear, p.shear);
    gl.uniform1f(u.uGain, rawLinear ? 1 : 2 ** RAW8_EV);
    gl.uniform1f(u.uSrgb, rawLinear ? 0 : 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // the electric eye, against the zenith print: it opens up for a darker
    // frame by a third of the difference but never past a quarter stop, so a
    // print that is mostly wall keeps the cloud in its strip of sky; it closes
    // down harder for a brighter one (the sun side of the street), to a floor
    const m = meterPrint(c, R, D, F, img / f) - zenithMeter;
    const ev = ev0 + clamp(-(m > 0 ? 0.45 : 0.3) * m, -1.25, 0.25) + p.dev;
    film.render(
      rawTex,
      {
        ...film0,
        input: rawLinear ? "linear" : "srgb",
        exposure: rawLinear ? ev : ev - RAW8_EV,
        warmth: film0.warmth + p.warm,
        highlightTint: [film0.highlightTint[0] + p.dye, film0.highlightTint[1], film0.highlightTint[2] - p.dye],
        shadowTint: [film0.shadowTint[0] - p.dye * 0.6, film0.shadowTint[1], film0.shadowTint[2] + p.dye * 0.6],
        grainSize: 1100 / cell,
        grainSeed: p.grain,
      },
      devFbo,
    );

    // the sky grade, into the print
    gl.bindFramebuffer(gl.FRAMEBUFFER, p.fbo);
    gl.viewport(0, 0, cell, cell);
    gl.disable(gl.BLEND);
    gl.useProgram(gradeP.p);
    gl.bindVertexArray(vao);
    const g = gradeP.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, devTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, rawTex);
    gl.uniform1i(g.uDev, 0);
    gl.uniform1i(g.uRaw, 1);
    gl.uniform1f(g.uRawSrgb, rawLinear ? 0 : 1);
    gl.uniform3fv(g.uC, c);
    gl.uniform3fv(g.uR, R);
    gl.uniform3fv(g.uD, D);
    gl.uniform1f(g.uF, F);
    gl.uniform1f(g.uHalf, (0.5 * img) / f);
    gl.uniform4f(g.uCloud, grade0.cloudGain, grade0.cloudToe, grade0.splitTone, grade0.keep);
    gl.uniform2f(g.uSky, grade0.skyKeep, grade0.grade);
    gl.uniform1f(g.uSeed, p.grain);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  const freePrint = (p) => {
    if (p.tex) gl.deleteTexture(p.tex);
    if (p.fbo) gl.deleteFramebuffer(p.fbo);
    p.tex = null;
    p.fbo = null;
  };

  // Moment: a slow clock, folded so the deck wanders rather than leaves.
  const momentNow = () => {
    const t = (performance.now() - clock0) / 1000 / 70;
    return 2 * Math.abs(((t + 0.25) % 2) - 1) - 1; // triangle, -1..1
  };

  // A pre-built joiner: a loose Hockney grid, nearest cells to the zenith,
  // shot row by row so each print lies over the white bottom margin of the
  // one above and the side margin of the one before it, and the sky, not the
  // paper, fills the table. The image centres sit a hair above the zenith so
  // the frames, not the images, are centred.
  const layout = (n, seed, centre = [0, IMG_OFF * FIELD]) => {
    const rnd = mulberry(seed * 31 + 5);
    const s = img / f;
    const sx = FW * s * 0.78;
    const sy = FH * s * 0.74;
    const cells = [];
    for (let j = -5; j <= 5; j++)
      for (let i = -7; i <= 7; i++) {
        const x = centre[0] + i * sx + (j % 2 ? sx * 0.18 : 0);
        const y = centre[1] + j * sy;
        // near circular, so the ring stays in the sky and tall facades and
        // never reaches the pavement towards the disk's rim
        const dx = (x - centre[0]) / 1.1;
        const dy = y - centre[1];
        // a print shot mostly off the edge of the table is a print wasted:
        // those cells only fill in once the table itself is covered
        const off = Math.abs(x) > W / 2 / f - 0.05 * s || Math.abs(y) > H / 2 / f - 0.05 * s;
        cells.push({ i, j, x, y, d: Math.hypot(dx, dy) + rnd() * sx * 0.35 + (off ? 100 : 0) });
      }
    cells.sort((a, b) => a.d - b.d);
    const pick = cells.slice(0, n);
    pick.sort((a, b) => a.j - b.j || (a.j % 2 ? b.i - a.i : a.i - b.i));
    return pick.map((c, k) => ({
      ix: c.x + gauss(rnd) * sx * 0.09,
      iy: c.y + gauss(rnd) * sy * 0.07,
      moment: -1 + (2 * k) / Math.max(1, n - 1),
      seed: seed * 1009 + k * 7 + 1,
    }));
  };

  const resize = (w, h, d) => {
    W = w;
    H = h;
    dpr = d;
    img = clamp(Math.min(w, h) * (Math.min(w, h) < 600 ? 0.24 : 0.25), 60, 200);
    f = img / FIELD;
    const nc = Math.min(512, Math.ceil((img * d) / 8) * 8);
    if (nc !== cell || !rawTex) {
      cell = nc;
      allocRaw();
      for (const p of prints) renderPrint(p);
    }
    dirty = true;
  };

  let dirty = true;

  // --- shooting ---------------------------------------------------------------
  const toF = (x, y) => [(x - W / 2) / f, (y - H / 2) / f];
  const shoot = (x, y, vx = 0, vy = 0, t = performance.now()) => {
    const [ix, iy] = toF(x, y);
    const p = makePrint(ix, iy, { moment: momentNow(), born: t });
    renderPrint(p);
    const rnd = mulberry(p.id * 977 + 3);
    // It leaves the hand carrying a little of the drag, a little turned, and
    // falls the last few centimetres on to the pile.
    const carry = 0.07;
    p.x.x = p.cx - (vx * carry) / f;
    p.y.x = p.cy - (vy * carry) / f;
    p.x.v = (vx * 0.35) / f;
    p.y.v = (vy * 0.35) / f;
    p.r.x = p.rot + (rnd() - 0.5) * 0.16 + clamp(vx / 6000, -0.08, 0.08);
    p.h.x = reduced ? 0 : 1;
    p.alpha = 0;
    p.develop = 0.35;
    prints.push(p);
    while (prints.length > MAX_PRINTS) freePrint(prints.shift());
    dirty = true;
    return p;
  };

  const advance = (p, dt) => {
    if (p.sweep) {
      const s = p.sweep;
      s.t += dt;
      const k = Math.max(0, s.t - s.delay);
      const v = s.speed * Math.min(1, k / 0.32) ** 2;
      p.x.x += s.dx * v * dt;
      p.y.x += s.dy * v * dt;
      p.r.x += s.spin * v * dt;
      p.h.x = Math.min(0.1, k * 0.6) * (k > 0 ? 1 : 0);
      return true;
    }
    const age = (performance.now() - p.born) / 1000;
    let moving = false;
    if (p.alpha < 1) {
      p.alpha = Math.min(1, p.alpha + dt / (reduced ? 0.22 : 0.045));
      moving = true;
    }
    if (p.develop < 1) {
      p.develop = Math.min(1, p.develop + dt / 1.4);
      moving = true;
    }
    stepSpring(p.h, 2 * Math.PI * 2.1, 0.6, dt);
    stepSpring(p.x, 2 * Math.PI * 2.4, 0.86, dt);
    stepSpring(p.y, 2 * Math.PI * 2.4, 0.86, dt);
    stepSpring(p.r, 2 * Math.PI * 2.0, 0.8, dt);
    const settled =
      Math.abs(p.h.x) < 2e-4 && Math.abs(p.h.v) < 2e-3 && Math.abs(p.x.x - p.x.to) < 1e-5 && Math.abs(p.y.x - p.y.to) < 1e-5 && Math.abs(p.r.x - p.r.to) < 1e-5 && Math.abs(p.x.v) + Math.abs(p.y.v) + Math.abs(p.r.v) < 1e-4;
    if (settled) {
      p.h.x = 0;
      p.h.v = 0;
      p.x.x = p.x.to;
      p.y.x = p.y.to;
      p.r.x = p.r.to;
    }
    return moving || !settled || age < 0.05;
  };

  // --- drawing --------------------------------------------------------------
  const draw = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, stage.canvas.width, stage.canvas.height);
    gl.clearColor(TABLE[0], TABLE[1], TABLE[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(printP.p);
    gl.bindVertexArray(vao);
    const u = printP.u;
    gl.uniform2f(u.uRes, W, H);
    gl.uniform1f(u.uDpr, dpr);
    gl.uniform1f(u.uImg, img);
    gl.uniform1i(u.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    for (const p of prints) {
      const h = Math.min(1, Math.abs(p.h.x));
      const scale = 1 + 0.06 * h;
      const cx = W / 2 + p.x.x * f;
      const cy = H / 2 + p.y.x * f;
      const ext = 0.5 * Math.hypot(FW, FH) * img * scale + 4 + 3 * (1.4 + 13 * h) + 20 * h;
      if (cx + ext < 0 || cx - ext > W || cy + ext < 0 || cy - ext > H) continue;
      gl.bindTexture(gl.TEXTURE_2D, p.tex);
      gl.uniform2f(u.uCenter, cx, cy);
      gl.uniform2f(u.uExt, ext, ext);
      gl.uniform2f(u.uCS, Math.cos(p.r.x), Math.sin(p.r.x));
      gl.uniform1f(u.uScale, scale);
      gl.uniform1f(u.uLift, h);
      gl.uniform1f(u.uAlpha, p.alpha);
      gl.uniform1f(u.uDevelop, 1 - (1 - p.develop) ** 2.2);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  };

  // --- input ------------------------------------------------------------------
  let last = null;
  let downAt = 0;
  let downXY = [0, 0];
  let travel = 0;
  let pressing = false;
  let swept = false;

  const sweep = (x, y) => {
    swept = true;
    // An arm across the table: everything slides off away from the hand,
    // the nearest first.
    const dir = x < W / 2 ? 1 : -1;
    for (const p of prints) {
      const px = W / 2 + p.x.x * f;
      const py = H / 2 + p.y.x * f;
      const rnd = mulberry(p.id * 131 + 17);
      const dist = Math.hypot(px - x, py - y) / Math.hypot(W, H);
      const ang = Math.atan2(py - y, (px - x) * 0.25 + dir * 60) * 0.35;
      p.sweep = {
        t: 0,
        delay: dist * 0.35 + rnd() * 0.05,
        speed: (Math.hypot(W, H) * 1.6) / f,
        dx: Math.cos(ang) * dir,
        dy: Math.sin(ang) * 0.9 + 0.12,
        spin: (rnd() - 0.5) * 0.5 * f / Math.hypot(W, H),
      };
    }
    dirty = true;
  };

  stage.on("down", (pt) => {
    pressing = true;
    swept = false;
    downAt = performance.now();
    downXY = [pt.x, pt.y];
    travel = 0;
    last = [pt.x, pt.y];
    shoot(pt.x, pt.y, 0, 0);
  });
  stage.on("move", (pt) => {
    if (!pressing || swept) return;
    travel = Math.max(travel, Math.hypot(pt.x - downXY[0], pt.y - downXY[1]));
    const step = FW * img * 0.8;
    const dx = pt.x - last[0];
    const dy = pt.y - last[1];
    const dl = Math.hypot(dx, dy);
    if (dl >= step) {
      // a fast drag still spaces its prints like a careful one
      const n = Math.min(3, Math.floor(dl / step));
      for (let i = 1; i <= n; i++) {
        const x = last[0] + (dx * step * i) / dl;
        const y = last[1] + (dy * step * i) / dl;
        shoot(x, y, pt.vx, pt.vy);
      }
      last = [last[0] + (dx * step * n) / dl, last[1] + (dy * step * n) / dl];
      if (n === 3) last = [pt.x, pt.y];
    }
  });
  stage.on("up", () => {
    pressing = false;
  });

  // --- start ----------------------------------------------------------------
  // Size first so the opening prints are cut for this box.
  await new Promise((r) => stage.onResize((w, h, d) => (resize(w, h, d), r())));
  // calibrate the meter on a print aimed straight up
  zenithMeter = meterPrint([0, 0, 1], [1, 0, 0], [0, 1, 0], 1, FIELD);

  const lay = (n, seed, centre, animate) => {
    const L = layout(n, seed, centre);
    const t0 = performance.now();
    L.forEach((c, k) => {
      const p = makePrint(c.ix, c.iy, { seed: c.seed, moment: c.moment, born: t0 });
      renderPrint(p);
      if (animate && !reduced) {
        p.born = t0 + 380 + k * 170;
        p.h.x = 1;
        p.alpha = 0;
        p.x.x = p.cx - 0.05;
        p.y.x = p.cy + 0.02;
        p.r.x = p.rot - 0.05;
        p.pending = true;
      }
      prints.push(p);
    });
  };

  if (still) {
    lay(clamp(Math.round(+qn), 0, MAX_PRINTS), seed0, undefined, false);
    if (freezeT != null && prints.length) {
      // replay the newest print's fall to t seconds and hold it there
      const p = prints[prints.length - 1];
      p.h.x = 1;
      p.x.x = p.cx - 0.06;
      p.y.x = p.cy - 0.03;
      p.x.v = 0.35;
      p.y.v = 0.15;
      p.r.x = p.rot + 0.07;
      p.alpha = 0;
      p.develop = 0.35;
      p.born = performance.now();
      const dt = 1 / 240;
      for (let t = 0; t < freezeT; t += dt) {
        p.alpha = Math.min(1, p.alpha + dt / 0.045);
        p.develop = Math.min(1, p.develop + dt / 1.4);
        stepSpring(p.h, 2 * Math.PI * 2.1, 0.6, dt);
        stepSpring(p.x, 2 * Math.PI * 2.4, 0.86, dt);
        stepSpring(p.y, 2 * Math.PI * 2.4, 0.86, dt);
        stepSpring(p.r, 2 * Math.PI * 2.0, 0.8, dt);
      }
      p.frozen = true;
    }
    const qs = q.get("sweep");
    if (qs != null && qs !== "" && Number.isFinite(+qs)) {
      // a still of the sweep, s seconds after a long press at the left
      sweep(W * 0.2, H * 0.52);
      const dt = 1 / 120;
      for (let t = 0; t < +qs; t += dt) for (const p of prints) advance(p, dt);
      for (const p of prints) p.frozen = true;
    }
  } else {
    lay(3, seed0, undefined, true);
  }

  stage.onFrame((dt) => {
    const now = performance.now();
    if (pressing && !swept && travel < 8 && now - downAt > 560 && prints.length) {
      sweep(downXY[0], downXY[1]);
    }
    let active = false;
    for (let i = prints.length - 1; i >= 0; i--) {
      const p = prints[i];
      if (p.frozen) continue;
      if (p.pending) {
        if (now < p.born) {
          active = true;
          continue;
        }
        p.pending = false;
      }
      if (advance(p, dt)) active = true;
      if (p.sweep) {
        const px = W / 2 + p.x.x * f;
        const py = H / 2 + p.y.x * f;
        const r = img * 1.2;
        if (px < -r || px > W + r || py < -r || py > H + r) {
          freePrint(p);
          prints.splice(i, 1);
        }
      }
    }
    if (active || dirty) {
      draw();
      dirty = false;
    }
  });

  await new Promise((r) => requestAnimationFrame(() => r()));
  draw();

  return {
    destroy() {
      for (const p of prints) freePrint(p);
      film.destroy();
      gl.deleteTexture(texScene);
      gl.deleteTexture(texMask);
      gl.deleteTexture(texSky);
      if (rawTex) gl.deleteTexture(rawTex);
      if (rawFbo) gl.deleteFramebuffer(rawFbo);
      if (devTex) gl.deleteTexture(devTex);
      if (devFbo) gl.deleteFramebuffer(devFbo);
      gl.deleteProgram(view.p);
      gl.deleteProgram(gradeP.p);
      gl.deleteProgram(printP.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
