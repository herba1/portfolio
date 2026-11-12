import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Kagerou: heat haze on an empty desert road at noon, seen from 30 cm off
// the tarmac.
//
// The plate is Poly Haven's nowhere_road (the Karoo, South Africa, unclipped
// 16k HDR): a ruler-straight two-lane road through scrub, mountains at its
// end and a bright bank of fair-weather cloud over it. It is looked at down
// the road with the camera lowered from the tripod's ~1.26 m to ~0.3 m: the
// road plane is resampled exactly (a lower camera squeezes the ground toward
// the horizon by h/h'), and the shoulder bushes, fence posts and poles rise
// whole by the distance of their foot (Depth Anything), with occlusion, so
// from down here they stand up past the horizon. The camera is tipped up a
// few degrees, so the sky and its cloud fill the top of the print and the
// posts lean in. `aux.png` carries, per pixel, that distance (log2 metres /
// 14, sky = far), the road, and the sky.
//
// Holding the pointer down heats the road. Two pieces of real optics follow:
//
//  - Shimmer. Air over hot asphalt is a turbulent, rising boundary layer of
//    varying refractive index. Each ray is bent by the cells it crosses, so
//    the angular jitter grows with the path it spends in the layer: rays that
//    graze the road toward the horizon cross hundreds of metres of it and
//    shimmer finely and fast; rays down at the asphalt
//    near the lens cross a few metres and only waver; rays climbing into the
//    sky leave the layer within a few metres and are left alone. The cells
//    are ~0.35 m and rise with the plumes, so the distortion rides upward and
//    its grain gets finer with distance.
//  - Inferior mirage. Hot air at the surface is thinner, so its index is lower
//    and rays bend upward. A ray that leaves the eye below a critical
//    depression α_c = √(2δ) (δ the index drop, ∝ the temperature excess)
//    turns before reaching the road and comes back up at the angle it went
//    down, so for anything far off the road is a mirror: the far road shows
//    the veld, the poles and the road itself flipped about the horizon,
//    squeezed thin toward the vanishing line at α_c. α_c is about half a
//    degree; that sliver is the "wet road". Its light has crossed hundreds
//    of metres of hot air, so it arrives pale and flat, mostly low sky. The
//    turbulence moves α_c from place to place, so the strip swells, thins and
//    flickers.
//
// Query: ?heat=0..1 holds the heat; ?t=seconds freezes the shimmer clock;
// ?still=1 skips the reveal.

const PLATE = "/lab/kagerou/plate.webp";
const AUX = "/lab/kagerou/aux.png";

// Plate geometry, image-plane units (tan of the angle), pitch 0, y up.
const PX = 0.28; // half width
const PB = -0.13; // bottom
const PT = 0.3; // top
const PLATE_W = 2900; // px across
// Log2 radiance encoding of the plate.
const LO = -6.5;
const HI = -0.5;
// Camera height above the road (m), the heated layer's top (m).
const CAM_H = 0.3;
const LAYER = 1.4;
// Critical depression at full heat (radians): ~0.5°, the real value for a road
// 30-40 K above the air. The mirage is a thin bright sliver on the last
// stretch of road before the vanishing point, not a pool.
const ALPHA_MAX = 0.009;
const AMBIENT = 0.1;
// The lens: visible height of the print in its own image plane (~20° tall,
// ~30° across a 3:2 print), tipped up PITCH radians; the horizon sits
// HORIZON of the way down.
// The grade's flare floor (plate radiance) and the width of its knee.
const FLARE = 0.022;
const FLARE_K = 0.01;
// The cloud's shoulder: how far above the clear blue it can climb, and how
// soon it rolls off.
const GLOW_TOP = 1.02;
const GLOW_S = 0.34;
const VIEW_H = 0.36;
const PITCH = (5 * Math.PI) / 180;
const HORIZON = 0.72; // from the top

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
uniform sampler2D uPlate;
uniform sampler2D uAux;
uniform vec4 uView;     // the lens's image plane: x0, y0 (bottom left), w, h
uniform vec2 uPitch;    // cos, sin of the camera's tilt up
uniform float uTime;
uniform float uHeat;    // 0..1
uniform float uAlphaC;  // critical depression, radians
uniform float uExpo;
uniform float uLodBias;
uniform float uPol;
uniform float uChroma; // midtone sky chroma lift

const float FLARE = ${FLARE.toFixed(4)};
const float FLARE_K = ${FLARE_K.toFixed(4)};
const float GLOW_TOP = ${GLOW_TOP.toFixed(3)};
const float GLOW_S = ${GLOW_S.toFixed(3)};
const vec4 PLATE = vec4(${PX.toFixed(4)}, ${PB.toFixed(4)}, ${PT.toFixed(4)}, 0.0);

vec2 plateUv(vec2 p) {
  return vec2((p.x + PLATE.x) / (2.0 * PLATE.x), (PLATE.z - p.y) / (PLATE.z - PLATE.y));
}
vec3 rawRadiance(vec2 p, float lod) {
  vec3 v = textureLod(uPlate, plateUv(p), lod).rgb;
  return exp2(v * ${(HI - LO).toFixed(3)} + ${LO.toFixed(3)});
}
vec3 radiance(vec2 p, float lod) {
  vec3 c = rawRadiance(p, lod);
  // A polariser on the lens: with the sun near the zenith the whole ring of
  // sky round the horizon is ~90° from it and strongly polarised, so the
  // clear (Rayleigh) blue darkens and deepens; terrain and haze-white keep.
  float A = clamp((0.85 * c.b - c.r) / 0.56, 0.0, c.b);
  return c - A * vec3(0.29, 0.58, 1.0) + A * vec3(0.06, 0.36, 1.0) * uPol;
}

// 3D gradient noise (value derivative free), hash by Dave Hoskins.
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
// The index field's gradient, in cell units: two octaves of rising cells.
vec2 bend(vec2 q, float t) {
  vec2 s = vec2(0.0);
  float e = 0.05;
  for (int o = 0; o < 2; o++) {
    float k = o == 0 ? 1.0 : 2.3;
    float a = o == 0 ? 1.0 : 0.45;
    vec3 p = vec3(q * k + vec2(t * 0.35, -t * 1.6 * k), t * 0.9 * k + float(o) * 7.1);
    float n0 = gnoise(p);
    s += a * vec2(gnoise(p + vec3(e, 0, 0)) - n0, gnoise(p + vec3(0, e, 0)) - n0) / e;
  }
  return s;
}

void main() {
  // The lens is tipped up: its ray, on the level plate's image plane.
  vec2 v = uView.xy + vUv * uView.zw;
  vec3 r = vec3(v.x, v.y * uPitch.x + uPitch.y, uPitch.x - v.y * uPitch.y);
  vec2 p = r.xy / r.z;
  vec4 aux = texture(uAux, plateUv(p));
  float Z = exp2(aux.r * 14.0);          // metres; sky ~16 km
  float road = aux.g;
  float sky = aux.b;
  float elev = atan(p.y, sqrt(1.0 + p.x * p.x));

  // Path through the heated layer.
  float L = elev <= 0.0 ? Z : min(Z, (${LAYER.toFixed(2)} - ${CAM_H.toFixed(2)}) / max(tan(elev), 1e-4));
  float Lc = min(L, 700.0);
  float w = pow(Lc / 700.0, 0.75);
  // Cells are ~0.35 m wide at the distance where the ray meets them.
  float Dn = clamp(Lc, 2.0, 260.0);
  vec2 q = p * Dn / 0.35;
  float amp = 0.0017 * uHeat * w;
  vec2 b = amp > 2e-6 ? bend(q, uTime) : vec2(0.0);
  vec2 d = b * amp * vec2(0.55, 1.0);
  // Fine shimmer also averages the far detail out a little.
  float lod = uLodBias + uHeat * w * 1.4;

  // The sky is read a touch softer so the plate's 8-bit dither melts into
  // the gradient (film grain textures it later); the cloud keeps its drawing.
  vec3 col = radiance(p + d, lod + 0.9 * sky);

  // Inferior mirage on the far road.
  if (elev < 0.0 && road > 0.001 && uAlphaC > 0.0) {
    float alpha = -elev;
    // The tarmac, read softly and pulled in from its edges: only the asphalt
    // is hot enough to bend the rays back, the gravel shoulders are not.
    float tm = 0.0;
    for (int i = -2; i <= 2; i++) tm += texture(uAux, plateUv(p + vec2(float(i) * 0.0022, 0.0))).g;
    tm = smoothstep(0.5, 0.95, tm / 5.0);
    // The critical line wanders with the plumes (broad, slow), so the strip
    // swells and thins along its length.
    float n = gnoise(vec3(p.x * 55.0, uTime * 0.45, 3.0)) + 0.45 * gnoise(vec3(p.x * 150.0 + uTime * 0.2, uTime * 0.9, 9.0));
    float ac = uAlphaC * (1.0 + 0.18 * n);
    float a = alpha + d.y * 0.6;
    // Reflectance: near-total at the horizon, where the rays graze the hot
    // skin at the shallowest angle, falling off over the last third of α_c as
    // the turning point dips into the cooler air above it. No hard cut.
    float u = clamp(a / ac, 0.0, 1.0);
    float R = 0.97 * (1.0 - smoothstep(0.66, 1.0, u)) * (1.0 - 0.15 * u);
    // Near the vanishing line the inverted image is squeezed: the rays that
    // dip closest to α_c all turn in the same thin skin of hot air, so the
    // mirrored veld and poles thin down into the edge instead of running on.
    float squeeze = 1.0 - 0.5 * smoothstep(0.4, 1.0, u);
    // The returning ray spends twice as long in the layer: double shimmer.
    vec2 pm = vec2(p.x, -p.y * squeeze) + d * 2.0;
    vec3 refl = radiance(pm, lod + 0.25);
    // The mirrored road crown (the far tarmac over the rise and its lane
    // dashes) would print as a white stripe and a smeared blob down the
    // strip. Its sample is clamped to the local level of the scene around it,
    // which takes the highlights out, and leans toward the low sky the hot
    // skin over it also mirrors.
    vec3 local = radiance(pm, lod + 3.5);
    refl = min(refl, local * 1.05);
    float crown = 0.0;
    for (int i = -2; i <= 2; i++) crown += texture(uAux, plateUv(vec2(pm.x + float(i) * 0.0065, -0.0012))).g;
    crown = smoothstep(0.0, 1.0, crown / 5.0);
    // The horizon sky the mirror mostly carries: the low sky over the saddle,
    // read without the polariser (the grazing mirror light is polarised the
    // other way and passes it) and paled by the haze of the last kilometres.
    vec3 hsky = rawRadiance(vec2(p.x * 0.5, 0.085), 5.5);
    hsky = mix(hsky, vec3(dot(hsky, vec3(0.2126, 0.7152, 0.0722))), 0.65) * 1.85;
    refl = mix(refl, hsky, crown * 0.45);
    // Light that came back through hundreds of metres of hot air arrives
    // lighter and flatter than it left: silver water, not brown mud.
    refl = mix(refl, hsky, 0.4) * 1.1;
    // The fine cells crossing the critical line fray it in brightness: thin
    // level glints that run along the strip and flicker, the way the far
    // "water" ripples, rather than a torn edge.
    float f = gnoise(vec3(p.x * 70.0, p.y * 2600.0 - uTime * 3.0, uTime * 1.3)) + 0.5 * gnoise(vec3(p.x * 420.0, p.y * 900.0, uTime * 1.7));
    refl *= 1.0 + 0.22 * f * (0.4 + u);
    col = mix(col, refl, clamp(R * tm, 0.0, 1.0));
  }

  // Flare floor: the plate's shadows carry the lens veil of the tripod shot
  // (nothing in it is darker than ~3% of the cloud). A soft knee takes that
  // flare back out, so pole bases and bush cores print near black while the
  // mids barely move. The sky keeps most of its own: there the floor is the
  // blue's red channel, and taking it out would turn cobalt into neon.
  // The far range keeps its aerial haze, which is air, not flare.
  float fl = FLARE * (1.0 - 0.75 * sky) * (1.0 - 0.45 * smoothstep(1500.0, 9000.0, Z));
  col = 0.5 * (col - fl + sqrt((col - fl) * (col - fl) + FLARE_K * FLARE_K));
  col *= uExpo;
  // Midtone sky chroma: the clear blue between the cloud, in the mids only,
  // is pushed out from grey and a touch toward cyan, so mid-sky prints a deep
  // cobalt; the cirrus (bright) and the shadowed blue (dark) are left alone.
  float yl = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float mid = sky * smoothstep(0.012, 0.03, yl) * (1.0 - smoothstep(0.2, 0.36, yl));
  float blue = smoothstep(0.02, 0.12, (col.b - col.r) / (col.b + 1e-4));
  vec3 lift = vec3(yl) + (col - vec3(yl)) * uChroma;
  col = mix(col, max(lift, 0.0), mid * blue);
  // Cloud glow: in the sky only, the light past the clear blue is expanded
  // onto a long exponential shoulder, so the cloud bank climbs well clear of
  // the sunlit road and its tops crowd up under paper white without clipping,
  // instead of sitting a half-step over the asphalt as flat grey.
  // It starts above the clear blue, so the blue's own fine noise is not
  // stretched with it.
  float yc = 0.26 + GLOW_TOP * (1.0 - exp(-max(yl - 0.26, 0.0) / GLOW_S));
  col *= mix(1.0, yc / max(yl, 1e-4), sky * smoothstep(0.24, 0.42, yl));
  yl = dot(col, vec3(0.2126, 0.7152, 0.0722));
  // Sunlit cloud tops lean warm-neutral as they climb into the shoulder (the
  // film's own highlight tint is left near neutral so the sky is not greyed).
  col *= mix(vec3(1.0), vec3(1.0, 0.975, 0.92), smoothstep(0.3, 0.95, yl));

  outColor = vec4(col, 1.0);
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
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

function imageTexture(gl, img, mips) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
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

// The grade. Exposed ~0.6 stop over the plain summer development so the
// tarmac and veld sit in the mids and the cloud tops ride the shoulder; the
// preset's whole-frame Pro-Mist (which lifted every shadow into a grey veil)
// is cut to a highlight-only halo, and its scan black brought down, so the
// pole bases and bush cores print near black and the fence reads sharp.
const EXPO = 2.3;
const FILM = {
  ...FILM_PRESETS.summer,
  bloom: 0.22,
  bloomThreshold: 0.8,
  softness: 0.45,
  toe: 0.012,
  contrast: 1.28,
  shoulder: 0.86,
  whitePoint: 1.12,
  vignette: 0.22,
  blueDepth: 0.6,
  grain: 0.22,
  highlightTint: [1.01, 1, 0.975],
  halation: 0.3,
};

const expoOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const PAPER = [0xf2 / 255, 0xf0 / 255, 0xeb / 255];

export async function createKagerou(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const heatQ = q.get("heat");
  const held = heatQ != null && heatQ !== "" && Number.isFinite(+heatQ);
  const timeQ = q.get("t");
  const frozen = timeQ != null && timeQ !== "" && Number.isFinite(+timeQ);
  const still = held || q.get("still") === "1";
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");
  const floatOk = !!gl.getExtension("EXT_color_buffer_float");

  const [plateImg, auxImg] = await Promise.all([loadImage(PLATE), loadImage(AUX)]);
  const plate = imageTexture(gl, plateImg, true);
  const aux = imageTexture(gl, auxImg, false);

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

  // Layout, in css px of the box.
  const L = { x: 0, y: 0, w: 1, h: 1 };
  let sceneT = null;
  let filmT = null;
  let dirty = true;
  // Render scale: drops (never rises) if the device can't hold ~40 fps, so a
  // weak phone renders the scene smaller and lets the blit scale it up.
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

  // Heat: the surface warms toward 1 while held (τ 1.3 s) and cools back to a
  // summer ambient when let go (τ 1.7 s). The air layer follows the surface
  // with its own lag, so the mirage arrives after the shimmer and leaves first.
  let heat = held ? clamp(+heatQ, 0, 1) : 0.55;
  let air = heat;
  let holding = false;
  let keyHold = false;
  let touched = held;

  const inPrint = (p) => p.x >= L.x && p.x <= L.x + L.w && p.y >= L.y && p.y <= L.y + L.h;
  stage.on("down", (p) => {
    if (!inPrint(p)) return;
    holding = true;
    touched = true;
  });
  stage.on("up", () => {
    holding = false;
  });

  host.tabIndex = embedded ? -1 : 0;
  const onKeyDown = (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    keyHold = true;
    touched = true;
  };
  const onKeyUp = (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    keyHold = false;
  };
  host.addEventListener("keydown", onKeyDown);
  host.addEventListener("keyup", onKeyUp);

  let time = frozen ? +timeQ : 0;
  let t0 = -1;
  let grainClock = 0;
  let grainSeed = 0;

  const draw = (expoStops, fade) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);

    // The lens: a fixed field, tipped up, horizon 72% down the print. A slow
    // breathing drift of a few arc-minutes (the camera is hand-held on the
    // asphalt).
    const aspect = L.pw / L.ph;
    let vh = VIEW_H;
    let vw = vh * aspect;
    if (vw > PX * 2 * 0.9) {
      vw = PX * 2 * 0.9;
      vh = vw / aspect;
    }
    const br = reduce || still ? [0, 0] : [Math.sin((time * 2 * Math.PI) / 11) * 0.0006, Math.sin((time * 2 * Math.PI) / 13.7 + 1.1) * 0.0004];
    // The horizon is the line y = -tan(pitch) on the tipped image plane.
    const top = vh * HORIZON - Math.tan(PITCH);
    const x0 = -vw / 2 + br[0];
    const y0 = top - vh + br[1];

    const u = scene.u;
    gl.useProgram(scene.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, plate);
    gl.uniform1i(u.uPlate, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, aux);
    gl.uniform1i(u.uAux, 1);
    gl.uniform4f(u.uView, x0, y0, vw, vh);
    gl.uniform2f(u.uPitch, Math.cos(PITCH), Math.sin(PITCH));
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uHeat, heat);
    const a = clamp((air - 0.16) / 0.84, 0, 1);
    gl.uniform1f(u.uAlphaC, ALPHA_MAX * Math.sqrt(a));
    gl.uniform1f(u.uExpo, EXPO * 2 ** expoStops);
    gl.uniform1f(u.uPol, 0.8);
    gl.uniform1f(u.uChroma, 1.12);
    // Match the plate's mip to the print.
    gl.uniform1f(u.uLodBias, Math.max(0, Math.log2((PLATE_W * (vw / (PX * 2))) / L.rw)));
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneT.fbo);
    gl.viewport(0, 0, L.rw, L.rh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    film.render(
      sceneT.tex,
      {
        ...FILM,
        input: floatOk && sceneT.ok ? "linear" : "srgb",
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

  // Reveal: the print comes up overexposed, a white-blue glare off a noon
  // road, and settles over two seconds while the last of a hot spell lifts
  // off the asphalt.
  const REVEAL = 2.0;

  let slow = 0;
  let lastNow = 0;
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
    if (!frozen) time += dt;
    if (t0 < 0) t0 = time;
    const age = frozen ? 99 : time - t0;
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
      const hot = holding || keyHold;
      const goal = hot ? 1 : AMBIENT;
      const tau = hot ? 1.3 : 1.7;
      // Before the first touch the opening heat drains away after the reveal.
      const k = !touched && age < REVEAL * 0.6 ? 0 : 1;
      heat += (goal - heat) * (1 - Math.exp((-dt * k) / tau));
      air += (heat - air) * (1 - Math.exp((-dt * k) / (hot ? 0.9 : 0.6)));
    } else {
      air = heat;
    }

    // Grain at 24 fps; the shimmer runs every frame.
    if (!reduce && !frozen) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        grainSeed = (grainSeed + 1) % 997;
      }
    }
    const moving = !frozen && !(reduce && heat < AMBIENT + 0.01);
    if (!dirty && !moving) return;
    dirty = false;
    draw(expo, fade);
  });

  return {
    destroy() {
      host.removeEventListener("keydown", onKeyDown);
      host.removeEventListener("keyup", onKeyUp);
      film.destroy();
      freeTarget(gl, sceneT);
      freeTarget(gl, filmT);
      gl.deleteTexture(plate);
      gl.deleteTexture(aux);
      gl.deleteProgram(scene.p);
      gl.deleteProgram(blit.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
