import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Komorebi: lying under the stone pines of Piazza Martin Lutero in Rome,
// looking up through the canopy towards a low sun.
//
// The frame is one capture: Poly Haven's piazza_martin_lutero, a 16K linear
// HDRI, reprojected offline to a stereographic view pitched 64° up. Offline,
// the lens's own veiling glare and diffraction spikes were taken out, the sky
// was rebuilt as a smooth field, and the trees were pulled apart from it into
// three depth layers (far pines and the cypresses round the sun, the middle
// crowns, the crown overhead), each with its needle-scale matte, its hidden
// part filled in behind the nearer layers so a moving crown uncovers foliage
// or sky, never a hole.
//
// The cumulus come from a second capture, Poly Haven's
// kloofendal_48d_partly_cloudy_puresky, reprojected to the same upward view
// and turned so its sun lands on the drawn sun: every cloud keeps its true
// lighting, sunlit tops towards the sun and skylight-blue undersides, and the
// edge of the big cumulus beside the sun glows. Offline the clouds were
// unmixed from their own pale sky (cover and premultiplied light), relit to
// this sun and skylight, and rolled off below the film's clip; here they lie
// over the deep Roman sky and behind every needle.
//
// The grade, here in the shader: the rebuilt sky takes a Superia cobalt,
// pale cyan-blue at the horizon deepening overhead; the cloud shade takes
// the skylight, the tops facing the sun roll off to cream, and the cumulus
// by the sun gets back the local contrast the film's shoulder would eat.
//
// Wind: every layer is split into a few branches, each a damped spring with
// its own natural frequency (big near crowns slow and wide, far trees quick
// and small), driven by the drag of the air at its centre. At rest a breeze
// rolls through; the pointer is a breath of wind, a puff that travels with
// the hand and fades. Branches bend from their trunks, so trunks hold still.
//
// The sun is drawn behind all of it, about four degrees left of where it
// stood in the capture so it sits on a cypress's ragged edge: a gust bends
// the needles across it but never buries it. What leaks through the gaps is
// the only bright thing in the scene. Round it sits a steep glare, a white
// core and a thin warm ring within 2% of the frame, scaled by how much of
// the disc the needles leave open, so it flickers as the gaps open and
// close. The film only diffuses what is past its thresholds and adds a
// narrow halation fringe where the light meets the cypress edge; its
// pyramid has long wings, so the disc goes in heavily filtered, or it fogs
// the whole lower canopy maroon.
//
// Query: ?t=seconds holds the simulation at that moment (deterministic);
// with ?wind=0..1 a breath of that strength sets off at t = 0.5 s.

const ASSET = "/lab/komorebi/";
const AW = 1680;
const AH = 2100;
const ASPECT = AW / AH; // 0.8, a 4:5 print
const SKY = [210, 262];
const LOG = [-14, 2]; // canopy.webp: v = (log2(c) - LO) / (HI - LO)
// clouds.webp: rgb = log2(P + 2^LO) mapped LO..HI, P the cloud light
// premultiplied by its cover; a = cover.
const CLOUD_LOG = [-9, 6];

// Sun, in asset uv (y down): placed on the ragged edge of the cypress,
// where a gust bends needles across it but never buries it; the capture's
// sun was at (0.4502, 0.8798).
const SUN = { x: 0.4094, y: 0.89429, r: 0.0028631, L: 194211, color: [1.0375, 1.006, 0.83] };
// Scene light is written at 1/16 so the sun fits a half float; film adds it back.
const GAIN = 1 / 16;
// Share of the measured radiance the disc keeps. Still ~100x past the clip,
// so it reads white; much more and the film's wide diffusion lifts the
// cypresses 100 px (DPR 2) away.
const SUN_ND = 0.001;
// Glare round the disc, in scene light (before GAIN): core peak and colour at
// the sun's centre, e-folding width in frame heights; the warm ring is a
// band 3.6 widths out. The film clips near 2.8, so the white core is ~2.4
// widths across and the ring is gone by ~6 (about 2% of the frame).
const GLARE = { peak: 28, color: [1, 0.9, 0.74], width: 0.004, ring: 0.7, ringColor: [1, 0.5, 0.24] };

// Per layer: deflection per unit wind (asset widths), natural frequency,
// damping. The branch centres the wind is sampled at come with the
// weights, in branches.json (asset uv, one list per layer, channel order).
const LAYERS = [
  {
    amp: 0.0042,
    hz: 0.78,
    zeta: 0.16,
  },
  {
    amp: 0.0036,
    hz: 0.55,
    zeta: 0.14,
  },
  {
    amp: 0.005,
    hz: 0.38,
    zeta: 0.12,
  },
];

const FILM = {
  ...FILM_PRESETS.summer,
  input: "linear",
  headroom: 0,
  whitePoint: 3.6,
  contrast: 1.2,
  shoulder: 0.95,
  // Halation only off the sun, judged from the surround: a narrow red-orange
  // fringe where the glare meets the cypress, not a red veil on every twig.
  halation: 0.15,
  halationThreshold: 2.5 * GAIN,
  halationLocal: 0.6,
  // Pro-Mist only past the clip: the sky, cloud and shadows keep their own
  // drawing and are not lifted by the veil.
  bloom: 0.15,
  bloomThreshold: 1.25 * GAIN,
  softness: 0.42,
  saturation: 1.12,
  blueDepth: 0.7,
  toe: 0.045,
  grain: 0.34,
  vignette: 0.22,
};
// The grade, in linear scene light before the film.
// Sky: the rebuilt field keeps its own brightness (rolled off round the sun)
// but takes the chroma of a Superia summer sky, a pale cyan-blue at the
// horizon deepening to cobalt overhead. Chroma is per unit blue.
const SKY_GRADE = {
  horizon: [0.12, 0.36, 1],
  zenith: [0.02, 0.235, 1],
  depth: [0.92, 0.55], // luminance kept, horizon .. zenith
  knee: 1.1, // circumsolar roll-off: Y / (1 + Y / knee)
};
// Cloud: shade takes the skylight, tops facing the sun roll off to cream;
// local contrast is lifted so the cumulus by the sun keeps its drawing.
const CLOUD_GRADE = {
  shade: [0.44, 0.63, 1],
  mid: [0.8, 0.87, 1],
  cream: [1, 0.8, 0.52],
  shadeDepth: 0.68, // the shade sits this far below its own light
  knee: 0.9, // highlight shoulder: above it, Y * (knee / Y)^roll
  roll: 0.4,
  detail: 1.3, // local contrast against the cloud's own blur
};
const BASE_EXPOSURE = 0.35; // stops, artistic, on top of 1/GAIN

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
uniform sampler2D uCanopy;   // log-encoded foliage light, unpremultiplied
uniform sampler2D uLayers;   // r far, g mid, b near: coverage
uniform sampler2D uBranches; // three tiles stacked: per-layer branch weights
uniform sampler2D uSky;      // linear sky, no sun, no lens veil
uniform sampler2D uClouds;   // cumulus: log premultiplied light, cover in a
uniform vec2 uCLog;
uniform vec4 uCrop;          // asset uv origin xy, size zw
uniform vec2 uRes;           // target px
uniform vec2 uOff[12];       // branch offsets, asset widths (x) and widths (y)
uniform vec2 uSun;
uniform float uSunR;
uniform vec3 uSunL;
uniform float uGain;
uniform vec4 uGlare;         // rgb peak, a: width (frame heights)
uniform vec3 uGlareRing;     // the warm band round the core
uniform vec2 uLog;
uniform sampler2D uCloudsBlur; // same texture, mipmapped sampler
uniform vec3 uSkyHor;
uniform vec3 uSkyZen;
uniform vec3 uSkyGrade;      // depth horizon, depth zenith, knee
uniform vec3 uCShade;
uniform vec3 uCMid;
uniform vec3 uCCream;
uniform vec4 uCGrade;        // knee, roll, detail, shade depth
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float ASPECT = ${ASPECT.toFixed(6)};

vec3 canopy(vec2 uv) {
  vec3 v = texture(uCanopy, uv).rgb;
  return exp2(uLog.x + v * (uLog.y - uLog.x));
}
vec2 disp(int k, vec2 uv) {
  vec4 w = texture(uBranches, vec2(uv.x, (uv.y + float(k)) / 3.0));
  vec2 d = w.r * uOff[k * 4] + w.g * uOff[k * 4 + 1] + w.b * uOff[k * 4 + 2] + w.a * uOff[k * 4 + 3];
  return vec2(d.x, d.y * ASPECT);
}

vec3 withLuma(vec3 tint, float y) {
  return tint * (y / dot(tint, LUMA));
}

void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y);
  vec2 uv = uCrop.xy + p * uCrop.zw;
  float sd = length((uv - uSun) * vec2(1.0, 1.0 / ASPECT));

  // Sky: Superia cobalt, deepening from the horizon (asset bottom) to
  // overhead (the asset's top is past the zenith).
  vec3 col = texture(uSky, uv).rgb;
  {
    float Y = dot(col, LUMA);
    Y = Y / (1.0 + Y / uSkyGrade.z);
    float h = smoothstep(0.98, 0.2, uv.y);
    vec3 tint = mix(uSkyHor, uSkyZen, h);
    // round the sun the sky pales a little, as it does
    tint = mix(tint, vec3(0.5, 0.72, 1.0), 0.6 * exp(-sd / 0.07));
    col = withLuma(tint, Y * mix(uSkyGrade.x, uSkyGrade.y, h));
  }

  // The sun: a limb-darkened disc of the measured radiance. Smaller than a
  // pixel it is widened with the same energy, so it never aliases away.
  vec2 dv = (uv - uSun) * vec2(1.0, 1.0 / ASPECT);
  float px = uCrop.z / uRes.x;
  float r = max(uSunR, 0.8 * px);
  float d = length(dv) / r;
  float edge = px / r;
  float cover = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, d);
  float mu = sqrt(max(1.0 - d * d, 0.0));
  col += uSunL * (uSunR * uSunR) / (r * r) * cover * (0.4 + 0.6 * mu) / 0.8;

  // Cumulus, in front of the sky and behind every needle.
  vec4 cl = texture(uClouds, uv);
  vec3 cP = exp2(uCLog.x + cl.rgb * (uCLog.y - uCLog.x)) - exp2(uCLog.x);
  if (cl.a > 0.0) {
    // Relight: the cloud's own light, unpremultiplied, judged against its
    // blurred surround so the drawing survives the shoulder.
    vec4 cb = textureLod(uCloudsBlur, uv, 4.5);
    vec3 bP = exp2(uCLog.x + cb.rgb * (uCLog.y - uCLog.x)) - exp2(uCLog.x);
    float Yc = max(dot(cP, LUMA) / max(cl.a, 1e-3), 1e-4);
    float Yb = max(dot(bP, LUMA) / max(cb.a, 1e-3), 1e-4);
    // Thin edges carry little cover: their light is noisy and their
    // surround is mostly sky, so they keep their own drawing and colour.
    float body = smoothstep(0.35, 0.85, cl.a) * smoothstep(0.25, 0.65, cb.a);
    float near = exp(-sd / 0.22);
    float detail = mix(1.0, mix(uCGrade.z, uCGrade.z + 0.45, near), body);
    float Y = Yb * pow(Yc / Yb, detail);
    if (Y > uCGrade.x) Y *= pow(uCGrade.x / Y, uCGrade.y);
    float lit = smoothstep(-2.2, 0.1, log2(mix(Yb, Yc, 0.5 + 0.5 * body)));
    Y *= mix(uCGrade.w, 1.0, max(lit, 1.0 - body));
    vec3 tint = mix(uCShade, uCMid, smoothstep(0.3, 0.8, lit));
    tint = mix(tint, uCCream, smoothstep(0.7, 1.0, lit) * (0.65 + 0.35 * near) * smoothstep(0.55, 0.95, cl.a));
    cP = withLuma(tint, Y) * cl.a;
  }
  col = col * (1.0 - cl.a) + cP * smoothstep(0.0, 2.0 / 255.0, cl.a);

  // Back to front; each layer bends with its own branches.
  vec2 d0 = disp(0, uv);
  vec2 d1 = disp(1, uv);
  vec2 d2 = disp(2, uv);
  vec2 u0 = uv - d0;
  vec2 u1 = uv - d1;
  vec2 u2 = uv - d2;
  float a0 = texture(uLayers, u0).r;
  float a1 = texture(uLayers, u1).g;
  float a2 = texture(uLayers, u2).b;
  col = mix(col, canopy(u0), a0);
  col = mix(col, canopy(u1), a1);
  col = mix(col, canopy(u2), a2);

  // Glare: the light that scatters inside the lens and off the emulsion
  // right next to the disc. Steep, a ring of a few percent of the frame, in
  // front of everything; it tracks how much of the disc the needles leave
  // open, so it flickers with them. (The film's own scatter is far wider:
  // fed the full disc it fogs the whole lower canopy.)
  float rh = length(dv) / px / uRes.y;
  float x = rh / uGlare.a;
  if (x < 12.0) {
    float open = 0.0;
    for (int i = 0; i < 5; i++) {
      vec2 o = i == 0 ? vec2(0.0) : 1.6 * r * vec2(i == 1 ? 1.0 : i == 2 ? -1.0 : 0.0, i == 3 ? ASPECT : i == 4 ? -ASPECT : 0.0);
      vec2 s = uSun + o;
      float c = 1.0 - texture(uClouds, s).a * 0.6;
      c *= 1.0 - texture(uLayers, s - disp(0, s)).r;
      c *= 1.0 - texture(uLayers, s - disp(1, s)).g;
      c *= 1.0 - texture(uLayers, s - disp(2, s)).b;
      open += c * (i == 0 ? 0.4 : 0.15);
    }
    // A white-hot core that clips, then a narrow warm band just outside it.
    float ring = (x - 3.6) / 1.4;
    vec3 g = uGlare.rgb * exp(-x) + uGlareRing * exp(-ring * ring);
    col += g * open;
  }

  outColor = vec4(col * uGain, 1.0);
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

const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];

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

async function bitmap(src) {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  return createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function imageTexture(gl, img) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  img.close?.();
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
const TAU = Math.PI * 2;

// A small seeded generator, so a held moment is the same moment every time.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- The wind and the branches. Units: asset widths; y runs down.

function createCanopy(centres) {
  const rand = rng(7);
  const branches = [];
  LAYERS.forEach((L, k) => {
    centres[k].forEach(([cx, cy], c) => {
      const f = L.hz * (0.85 + rand() * 0.3);
      branches.push({
        k,
        c,
        cx,
        cy: cy / ASPECT,
        omega: TAU * f,
        zeta: L.zeta,
        amp: L.amp * (0.85 + rand() * 0.3),
        // flutter: the twigs' own quicker, smaller spring
        fOmega: TAU * (2.3 + rand() * 1.1),
        fAmp: L.amp * 0.22,
        ph: [rand() * TAU, rand() * TAU, rand() * TAU, rand() * TAU],
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        fx: 0,
        fy: 0,
        fvx: 0,
        fvy: 0,
      });
    });
  });
  return branches;
}

// The resting breeze: mostly from the left, swelling and easing on slow,
// incommensurate periods, arriving at each branch a little later the further
// right it stands, so it reads as air rolling through the trees.
const GUST_MAX = 1.8;

function breeze(t, b, scale) {
  const lt = t - b.cx * 1.1;
  const g = 0.5 + 0.5 * (0.55 * Math.sin(TAU * 0.071 * lt) + 0.3 * Math.sin(TAU * 0.137 * lt + 1.3) + 0.15 * Math.sin(TAU * 0.29 * lt + 2.1));
  const s = (0.18 + 0.32 * g * g) * scale;
  // Turbulence: a slow wander in direction and a little lift.
  const tx = 0.22 * Math.sin(TAU * 0.43 * t + b.ph[0]) + 0.12 * Math.sin(TAU * 0.97 * t + b.ph[1]);
  const ty = 0.18 * Math.sin(TAU * 0.37 * t + b.ph[2]) + 0.1 * Math.sin(TAU * 1.13 * t + b.ph[3]);
  return [s * (0.92 + tx), s * (-0.3 + ty)];
}

function stepCanopy(branches, puffs, t, dt, breezeScale) {
  // Wind at each branch: breeze plus every live puff of the hand.
  for (const b of branches) {
    const [bx, by] = breeze(t, b, breezeScale);
    let wx = 0;
    let wy = 0;
    for (const p of puffs) {
      const env = (1 - Math.exp(-p.age / 0.07)) * Math.exp(-p.age / 0.75);
      const R = 0.2 + 0.28 * p.age;
      const dx = b.cx - p.x;
      const dy = b.cy - p.y;
      const w = p.s * env * Math.exp(-(dx * dx + dy * dy) / (R * R));
      wx += p.dx * w;
      wy += p.dy * w;
    }
    // Overlapping puffs of one breath do not add without limit: the air
    // saturates at a strong gust however fast or long the hand moves.
    const m = Math.hypot(wx, wy);
    if (m > 1e-6) {
      const k = (GUST_MAX * Math.tanh(m / GUST_MAX)) / m;
      wx *= k;
      wy *= k;
    }
    wx += bx;
    wy += by;
    const speed = Math.hypot(wx, wy);
    // Sway: damped spring towards the drag deflection.
    const o2 = b.omega * b.omega;
    const ax = o2 * (b.amp * wx - b.x) - 2 * b.zeta * b.omega * b.vx;
    const ay = o2 * (b.amp * wy - b.y) - 2 * b.zeta * b.omega * b.vy;
    b.vx += ax * dt;
    b.vy += ay * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    // Flutter: twigs shiver in proportion to the wind speed.
    const n1 = Math.sin(TAU * 1.7 * t + b.ph[1]) * 0.6 + Math.sin(TAU * 3.1 * t + b.ph[2]) * 0.4;
    const n2 = Math.sin(TAU * 2.3 * t + b.ph[3]) * 0.6 + Math.sin(TAU * 4.1 * t + b.ph[0]) * 0.4;
    const f2 = b.fOmega * b.fOmega;
    b.fvx += (f2 * (b.fAmp * speed * n1 - b.fx) - 2 * 0.3 * b.fOmega * b.fvx) * dt;
    b.fvy += (f2 * (b.fAmp * speed * n2 - b.fy) - 2 * 0.3 * b.fOmega * b.fvy) * dt;
    b.fx += b.fvx * dt;
    b.fy += b.fvy * dt;
  }
  for (const p of puffs) {
    p.age += dt;
    // The breath carries on a little past the hand.
    p.x += p.dx * p.drift * dt;
    p.y += p.dy * p.drift * dt;
  }
  for (let i = puffs.length - 1; i >= 0; i--) if (puffs[i].age > 3.5) puffs.splice(i, 1);
}

export async function createKomorebi(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const tq = q.get("t");
  const held = tq != null && tq !== "" && Number.isFinite(+tq);
  const windQ = clamp(Number.isFinite(+q.get("wind")) ? +q.get("wind") : 0, 0, 1);
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");

  const [canopyImg, layersImg, branchImg, skyBuf, branchMeta, cloudImg] = await Promise.all([
    bitmap(`${ASSET}canopy.webp`),
    bitmap(`${ASSET}layers.webp`),
    bitmap(`${ASSET}branches.png`),
    fetch(`${ASSET}sky.bin`).then((r) => {
      if (!r.ok) throw new Error(`sky.bin: ${r.status}`);
      return r.arrayBuffer();
    }),
    fetch(`${ASSET}branches.json`).then((r) => r.json()),
    bitmap(`${ASSET}clouds.webp`),
  ]);
  const texCanopy = imageTexture(gl, canopyImg);
  const texLayers = imageTexture(gl, layersImg);
  const texBranches = imageTexture(gl, branchImg);
  const texClouds = imageTexture(gl, cloudImg);
  gl.bindTexture(gl.TEXTURE_2D, texClouds);
  gl.generateMipmap(gl.TEXTURE_2D);
  // The base fetch stays plain linear; the blur reads the mips through its
  // own sampler.
  const blurSampler = gl.createSampler();
  gl.samplerParameteri(blurSampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.samplerParameteri(blurSampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.samplerParameteri(blurSampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.samplerParameteri(blurSampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const texSky = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texSky);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, SKY[0], SKY[1], 0, gl.RGB, gl.HALF_FLOAT, new Uint16Array(skyBuf));
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const scene = program(gl, VERT, SCENE);
  const blit = program(gl, VERT, BLIT);
  const film = createFilm(gl, { width: 2, height: 2 });

  // ---- layout: a 4:5 print on warm paper; embedded, the box is the print.
  const L = { x: 0, y: 0, w: 1, h: 1, pw: 2, ph: 2, crop: [0, 0, 1, 1] };
  let sceneT = null;
  let filmT = null;
  let dirty = true;
  // A slow GPU renders the print at a lower internal resolution rather than
  // dropping frames; the blit scales it up (film grain hides the step).
  let quality = 1;
  let skip = 0;
  const perf = { ema: 0, frames: 0, last: 0 };
  const layout = (W, H, dpr) => {
    if (embedded) {
      Object.assign(L, { x: 0, y: 0, w: W, h: H });
    } else if (W / H < 0.9) {
      const side = Math.max(16, Math.round(W * 0.06));
      let w = W - side * 2;
      let h = w / ASPECT;
      if (h > H * 0.8) {
        h = H * 0.8;
        w = h * ASPECT;
      }
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 });
    } else {
      const h = Math.min(H * 0.86, (W - 48) / ASPECT);
      const w = h * ASPECT;
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 });
    }
    L.x = Math.round(L.x * dpr) / dpr;
    L.y = Math.round(L.y * dpr) / dpr;
    L.w = Math.round(L.w * dpr) / dpr;
    L.h = Math.round(L.h * dpr) / dpr;
    L.pw = Math.max(2, Math.round(L.w * dpr * quality));
    L.ph = Math.max(2, Math.round(L.h * dpr * quality));
    // Cover-fit the print into the box, keeping the sun low in the frame.
    const a = L.pw / L.ph;
    if (a >= ASPECT) {
      const hh = ASPECT / a;
      const y0 = clamp(SUN.y - 0.82 * hh, 0, 1 - hh);
      L.crop = [0, y0, 1, hh];
    } else {
      const ww = a / ASPECT;
      const x0 = clamp(SUN.x - 0.5 * ww, 0, 1 - ww);
      L.crop = [x0, 0, ww, 1];
    }
    freeTarget(gl, sceneT);
    freeTarget(gl, filmT);
    sceneT = target(gl, L.pw, L.ph, floatOk);
    if (!sceneT.ok) {
      freeTarget(gl, sceneT);
      sceneT = target(gl, L.pw, L.ph, false);
    }
    filmT = target(gl, L.pw, L.ph, false);
    film.resize(L.pw, L.ph);
    dirty = true;
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  // ---- wind state
  const branches = createCanopy(branchMeta.layers);
  const puffs = [];
  let simT = 0;
  const STEP = 1 / 240;
  const toAsset = (x, y) => [(x - L.x) / L.w * L.crop[2] + L.crop[0], ((y - L.y) / L.h * L.crop[3] + L.crop[1]) / ASPECT];

  const addPuff = (x, y, vx, vy) => {
    const speed = Math.hypot(vx, vy);
    if (speed < 0.05) return;
    const s = Math.min(2.6, speed * 1.1);
    const last = puffs[puffs.length - 1];
    // Merge with a fresh puff nearby, so a slow hand is one breath, not many.
    if (last && last.age < 0.03 && Math.hypot(last.x - x, last.y - y) < 0.03) {
      last.s = Math.max(last.s, s);
      return;
    }
    puffs.push({ x, y, dx: vx / speed, dy: vy / speed, s, drift: Math.min(speed, 1.4) * 0.3, age: 0 });
    if (puffs.length > 48) puffs.shift();
  };

  stage.on("move", (p) => {
    if (held) return;
    const [x, y] = toAsset(p.x, p.y);
    // Pointer speed in print heights per second.
    const k = L.crop[3] / ASPECT / Math.max(1, L.h);
    addPuff(x, y, p.vx * k, p.vy * k);
  });
  stage.on("down", () => requestOrientation());

  // Phones: tilting the device is a gust across the canopy, low-passed.
  const orient = { b: null, g: null, t: 0 };
  const onOrient = (e) => {
    if (e.beta == null || e.gamma == null) return;
    const now = performance.now();
    if (orient.b != null) {
      const dt = Math.max(16, now - orient.t) / 1000;
      const vx = (e.gamma - orient.g) / dt / 60;
      const vy = (e.beta - orient.b) / dt / 60;
      addPuff(0.5, 0.55 / ASPECT, clamp(vx, -2, 2), clamp(vy, -2, 2));
    }
    orient.b = e.beta;
    orient.g = e.gamma;
    orient.t = now;
  };
  let orientOn = false;
  function requestOrientation() {
    if (orientOn || typeof window.DeviceOrientationEvent === "undefined") return;
    if (!window.matchMedia?.("(pointer: coarse)").matches) return;
    orientOn = true;
    const ask = window.DeviceOrientationEvent.requestPermission;
    if (typeof ask === "function") ask().then((r) => r === "granted" && window.addEventListener("deviceorientation", onOrient)).catch(() => {});
    else window.addEventListener("deviceorientation", onOrient);
  }

  // A breath that passes on its own: right after the reveal (the motion is
  // the only hint), and for held stills.
  const scripted = [];
  const breath = (t0, strength) => {
    // From the left edge, low, sweeping up and right through the sun's trees.
    for (let i = 0; i < 14; i++) {
      const u = i / 13;
      scripted.push({ at: t0 + u * 0.55, x: -0.05 + u * 0.75, y: (0.95 - u * 0.35) / ASPECT, vx: 1.3, vy: -0.6, s: strength });
    }
    scripted.sort((a, b) => a.at - b.at);
  };
  const runScript = () => {
    while (scripted.length && scripted[0].at <= simT) {
      const e = scripted.shift();
      const speed = Math.hypot(e.vx, e.vy);
      puffs.push({ x: e.x, y: e.y, dx: e.vx / speed, dy: e.vy / speed, s: e.s * 1.2, drift: 0.4, age: simT - e.at });
    }
  };

  const advance = (dt, breezeScale) => {
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(STEP, left);
      runScript();
      stepCanopy(branches, puffs, simT, h, breezeScale);
      simT += h;
      left -= h;
    }
  };

  // Held: run the deterministic simulation up to ?t, with a breath of
  // strength ?wind arriving a second before.
  const holdT = held ? Math.max(0, +tq) : 0;
  if (held) {
    // The canopy settles into the breeze for six seconds off the record.
    // ?t counts from then; a ?wind breath sets off half a second in.
    if (windQ > 0) breath(6.5, windQ);
    advance(holdT + 6, 1);
  } else if (!reduce) {
    breath(1.4, 0.55);
  }

  const offs = new Float32Array(24);
  const fillOffsets = () => {
    offs.fill(0);
    for (const b of branches) {
      const i = (b.k * 4 + b.c) * 2;
      offs[i] = b.x + b.fx;
      offs[i + 1] = b.y + b.fy;
    }
  };

  const draw = (expoStops, fade, grainSeed) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    fillOffsets();
    const u = scene.u;
    gl.useProgram(scene.p);
    const bind = (unit, tex, name) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(u[name], unit);
    };
    bind(0, texCanopy, "uCanopy");
    bind(1, texLayers, "uLayers");
    bind(2, texBranches, "uBranches");
    bind(3, texSky, "uSky");
    bind(4, texClouds, "uClouds");
    bind(5, texClouds, "uCloudsBlur");
    gl.bindSampler(5, blurSampler);
    gl.uniform3fv(u.uSkyHor, SKY_GRADE.horizon);
    gl.uniform3fv(u.uSkyZen, SKY_GRADE.zenith);
    gl.uniform3f(u.uSkyGrade, SKY_GRADE.depth[0], SKY_GRADE.depth[1], SKY_GRADE.knee);
    gl.uniform3fv(u.uCShade, CLOUD_GRADE.shade);
    gl.uniform3fv(u.uCMid, CLOUD_GRADE.mid);
    gl.uniform3fv(u.uCCream, CLOUD_GRADE.cream);
    gl.uniform4f(u.uCGrade, CLOUD_GRADE.knee, CLOUD_GRADE.roll, CLOUD_GRADE.detail, CLOUD_GRADE.shadeDepth);
    gl.uniform2f(u.uCLog, CLOUD_LOG[0], CLOUD_LOG[1]);
    gl.uniform4fv(u.uCrop, L.crop);
    gl.uniform2f(u.uRes, L.pw, L.ph);
    gl.uniform2fv(u.uOff, offs);
    gl.uniform2f(u.uSun, SUN.x, SUN.y);
    gl.uniform1f(u.uSunR, SUN.r);
    gl.uniform3f(u.uSunL, SUN.L * SUN_ND * SUN.color[0], SUN.L * SUN_ND * SUN.color[1], SUN.L * SUN_ND * SUN.color[2]);
    gl.uniform1f(u.uGain, sceneT.ok ? GAIN : GAIN / 64);
    gl.uniform4f(u.uGlare, GLARE.peak * GLARE.color[0], GLARE.peak * GLARE.color[1], GLARE.peak * GLARE.color[2], GLARE.width);
    gl.uniform3f(u.uGlareRing, GLARE.ring * GLARE.ringColor[0], GLARE.ring * GLARE.ringColor[1], GLARE.ring * GLARE.ringColor[2]);
    gl.uniform2f(u.uLog, LOG[0], LOG[1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, L.pw, L.ph);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindSampler(5, null);

    film.render(
      sceneT.tex,
      {
        ...FILM,
        input: sceneT.ok ? "linear" : "srgb",
        exposure: BASE_EXPOSURE + expoStops + Math.log2(1 / GAIN) + (sceneT.ok ? 0 : 6),
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
    const vw = Math.round(L.w * dpr);
    const vh = Math.round(L.h * dpr);
    const vy = stage.canvas.height - Math.round(L.y * dpr) - vh;
    gl.viewport(vx, vy, vw, vh);
    gl.useProgram(blit.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, filmT.tex);
    gl.uniform1i(blit.u.uTex, 0);
    gl.uniform1f(blit.u.uFade, fade);
    gl.uniform3fv(blit.u.uPaper, PAPER);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  };

  // Reveal: the print comes up overexposed, an airy white-blue, and settles
  // into the deep sky as the eye adjusts.
  const REVEAL = 2.0;
  let age = 0;
  let grainClock = 0;
  let grainSeed = 0;
  stage.onFrame((dt) => {
    if (!sceneT) return;
    age += dt;
    if (!held) {
      const now = performance.now();
      if (perf.last) {
        const ms = now - perf.last;
        const m = Math.min(ms, 1000);
        perf.ema = perf.ema ? perf.ema + (m - perf.ema) * 0.08 : m;
        perf.frames++;
        const slow = (perf.frames > 45 && perf.ema > 26) || (perf.frames > 4 && perf.ema > 120);
        if (slow && quality > 0.5) {
          quality = quality > 0.75 ? 0.75 : 0.5;
          perf.frames = 0;
          perf.ema = 0;
          layout(stage.width, stage.height, stage.dpr);
        }
      }
      perf.last = now;
    }
    let expo = 0;
    let fade = 1;
    if (!held) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 2.5 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
      // Reduced motion: no idle breeze, but the hand still moves the air.
      const breezeScale = reduce ? 0 : 1;
      const live = !reduce || puffs.length > 0 || branches.some((b) => Math.abs(b.vx) + Math.abs(b.vy) > 1e-6);
      if (live) {
        advance(dt, breezeScale);
        dirty = true;
      }
      if (age < REVEAL + 0.1) dirty = true;
      // Grain at 24 fps.
      if (!reduce) {
        grainClock += dt;
        if (grainClock >= 1 / 24) {
          grainClock %= 1 / 24;
          grainSeed = (grainSeed + 1) % 997;
          dirty = true;
        }
      }
    }
    if (!dirty) return;
    // A software renderer (no GPU) gets a frame now and then, not a stall.
    if (quality <= 0.5 && perf.ema > 120 && (skip = (skip + 1) % 4) !== 0) return;
    dirty = false;
    draw(expo, fade, grainSeed);
  });

  return {
    destroy() {
      window.removeEventListener("deviceorientation", onOrient);
      film.destroy();
      freeTarget(gl, sceneT);
      freeTarget(gl, filmT);
      for (const t of [texCanopy, texLayers, texBranches, texSky, texClouds]) gl.deleteTexture(t);
      gl.deleteSampler(blurSampler);
      gl.deleteProgram(scene.p);
      gl.deleteProgram(blit.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
