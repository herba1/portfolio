import { createStage, clamp } from "../_kit/stage";

// Fog: a worm's-eye view up between the Canary Wharf towers into a summer
// cumulus sky, with real air applied per pixel through its real distance.
// Drag sets the visibility, from a clear 50 km day down to a 200 m haze.
//
// The plate is two Poly Haven HDRIs (CC0, both from their 16k captures) rendered
// at 3840 through the same stereographic rays: the towers from canary_wharf, the
// sky from docklands_01: a radial cobalt, pale cyan where it meets the towers,
// under cumulus unmixed from the capture's own blue and split-toned cyan-grey in
// the folds to warm-neutral on the sunlit tops, unclipped. Depth Anything V2 gives
// relative inverse depth, edge-snapped and turned into metres offline (the
// glass corner ~30 m, the far tower down the street ~380 m); the sky sits at
// the far end through its matte. tools/depth/bakes/fog/ builds both.
//
//   visibility V   the control (Koschmieder: beta = 3.912 / V at 550 nm)
//   haze layer     density falls off with height, scale height HS, so the air
//                  along a ray climbing at elevation e to distance d is
//                  L = HS / sin e * (1 - exp(-d sin e / HS)): low rays to the
//                  far towers cross the most air, the zenith the least
//   extinction     per channel, Rayleigh-leaning (blue goes first):
//                  T = exp(-beta * K_RGB * L)
//   in-scatter     the air is lit by the sky, so its colour is the sky's own
//                  light, blurred wide (a normalised blur of the sky pixels
//                  only): far towers go blue, clouds dissolve into the field
//                  they sit in, and nothing ever turns grey
//   breath         the haze gathers a little thicker where the pointer rests,
//                  and banks of it drift slowly through the street

const COLOR_SRC = "/lab/fog/plate.webp";
const AUX_SRC = "/lab/fog/aux.png"; // r log distance, g sky matte, b elevation
const ASPECT = 3 / 2;
const PLATE_W = 3840; // plate.webp width; the forward-scatter blur is tuned in its levels
const D_MIN = 10;
const D_MAX = 4000;
const HS = 500; // haze scale height, metres
const HS_SKY = 140; // the column the sky is seen through
const V_CLEAR = 50000; // visibility at fog 0, metres
const V_THICK = 200; // visibility at fog 1
// The drag moves the transmittance of a 130 m sight line evenly, not log V:
// air's response to log V is an S that spends half the range on nothing and
// the last third on everything. Over this frame's distances an even step in
// that transmittance is an even step in the haze you see, and the first half
// of the gesture is the far towers turning blue.
const D_REF = 130;
const T_CLEAR = Math.exp((-3.912 * D_REF) / V_CLEAR);
const T_THICK = Math.exp((-3.912 * D_REF) / V_THICK);
const visibility = (f) => (-3.912 * D_REF) / Math.log(T_CLEAR + (T_THICK - T_CLEAR) * f);
const K_RGB = [0.82, 1.0, 1.24];
const K_SKY = [1.04, 1.0, 0.98];
const REST = 0.88; // arrival: a white-blue field of haze (~370 m)
const ROLL = 0.2; // it clears to here (~2.4 km: the far towers already blue)
const LEVELS = 6;
const DRIFT_FPS = 20;

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  // Offscreen buffers store row 0 = top of the photograph, like the textures.
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMMON = `
uniform sampler2D uAux;
uniform float uBeta;      // extinction at 550 nm, per metre (3.912 / V)
uniform vec3 uBreath;     // xy in print uv, z strength
uniform float uAspect;    // print w / h
uniform float uTime;

float distAt(vec4 aux) {
  return ${D_MIN.toFixed(1)} * exp(aux.r * ${Math.log(D_MAX / D_MIN).toFixed(5)});
}
float hash3(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
// Optical depth along the ray through this pixel, per channel.
vec3 tauAt(vec2 uv, vec4 aux) {
  float d = distAt(aux);
  float s = max(sin(radians(aux.b * 90.0)), 0.06);
  // Air in a haze layer that thins with height. The street's own haze sits
  // lower than the layer the towers stand in, so the sky above is looked at
  // through a thinner column: it is veiled, and still there overhead when the
  // towers are going.
  float hs = mix(${HS.toFixed(1)}, ${HS_SKY.toFixed(1)}, aux.g);
  float L = hs / s * (1.0 - exp(-d * s / hs));
  // Banks of haze: low-frequency noise, advected sideways, living at depths.
  vec3 q = vec3(uv.x * uAspect * 1.4 - uTime * 0.012, uv.y * 1.2, log(d) * 0.4);
  float n = vnoise(q) * 0.64 + vnoise(q * 2.03 + vec3(uTime * 0.008, 0.0, 3.1)) * 0.36;
  float b = uBeta * mix(0.7, 1.3, n);
  // It gathers where the pointer rests.
  vec2 p = (uv - uBreath.xy) * vec2(uAspect, 1.0);
  b *= 1.0 + uBreath.z * exp(-dot(p, p) / 0.06);
  // Blue goes first along the street. Over the sky the column is short and
  // the light it takes away is the cloud's warm-white, which a Rayleigh
  // spread turns lilac under the blue veil; there the haze is near-grey and
  // the veil keeps the skylight's cyan.
  vec3 k = mix(vec3(${K_RGB.map((k) => k.toFixed(2)).join(", ")}), vec3(${K_SKY.map((k) => k.toFixed(2)).join(", ")}), aux.g);
  return b * L * k;
}
`;

// The sky's light, premultiplied by the sky matte, for a normalised blur:
// rgb = sky light (display-encoded, so an 8-bit fallback target holds it
// without banding) * matte, a = matte.
const AIR = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uColor;
uniform sampler2D uAux;
uniform float uLod;
void main() {
  vec3 c = textureLod(uColor, vUv, uLod).rgb;
  float m = textureLod(uAux, vUv, 0.0).g;
  m = smoothstep(0.5, 1.0, m);
  outColor = vec4(c * m, m);
}`;

// 13-tap downsample (Jimenez, CoD: Advanced Warfare).
const DOWN = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform vec2 uTexel; // of the source
void main() {
  vec2 t = uTexel;
  vec4 a = texture(uSrc, vUv + t * vec2(-2, -2));
  vec4 b = texture(uSrc, vUv + t * vec2(0, -2));
  vec4 c = texture(uSrc, vUv + t * vec2(2, -2));
  vec4 d = texture(uSrc, vUv + t * vec2(-1, -1));
  vec4 e = texture(uSrc, vUv + t * vec2(1, -1));
  vec4 f = texture(uSrc, vUv + t * vec2(-2, 0));
  vec4 g = texture(uSrc, vUv);
  vec4 h = texture(uSrc, vUv + t * vec2(2, 0));
  vec4 i = texture(uSrc, vUv + t * vec2(-1, 1));
  vec4 j = texture(uSrc, vUv + t * vec2(1, 1));
  vec4 k = texture(uSrc, vUv + t * vec2(-2, 2));
  vec4 l = texture(uSrc, vUv + t * vec2(0, 2));
  vec4 m = texture(uSrc, vUv + t * vec2(2, 2));
  outColor = (d + e + i + j) * 0.125 + (a + c + k + m) * 0.03125 + (b + f + h + l) * 0.0625 + g * 0.125;
}`;

// Tent upsample of the coarser sum, plus this level's own share.
const UP = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uLevel;
uniform sampler2D uCoarse;
uniform vec2 uTexel; // of the coarse
uniform float uW;
void main() {
  vec2 t = uTexel;
  vec4 s = texture(uCoarse, vUv) * 4.0;
  s += (texture(uCoarse, vUv + t * vec2(-1, 0)) + texture(uCoarse, vUv + t * vec2(1, 0)) + texture(uCoarse, vUv + t * vec2(0, -1)) + texture(uCoarse, vUv + t * vec2(0, 1))) * 2.0;
  s += texture(uCoarse, vUv + t * vec2(-1, -1)) + texture(uCoarse, vUv + t * vec2(1, -1)) + texture(uCoarse, vUv + t * vec2(-1, 1)) + texture(uCoarse, vUv + t * vec2(1, 1));
  outColor = s / 16.0 + texture(uLevel, vUv) * uW;
}`;

const COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uColor;
uniform sampler2D uAir;
uniform vec4 uRect;     // print rect in device px (x, y, w, h), y from top
uniform vec2 uCanvas;
uniform vec3 uSkyMean;  // display-encoded, the fallback where the blur saw no sky
${COMMON}

// The plate, linear. It is larger than most screens draw it, so the sharp
// level is a box over this pixel's footprint (four bilinear taps of level 0)
// rather than a trilinear blend toward the half-size level, which would soften
// the glass; extra levels only for the haze's forward scatter.
vec3 plate(vec2 uv, float lod) {
  vec2 q = 0.25 / uRect.zw;
  vec3 c = textureLod(uColor, uv + vec2(-q.x, -q.y), lod).rgb + textureLod(uColor, uv + vec2(q.x, -q.y), lod).rgb
    + textureLod(uColor, uv + vec2(-q.x, q.y), lod).rgb + textureLod(uColor, uv + vec2(q.x, q.y), lod).rgb;
  return pow(c * 0.25, vec3(2.2));
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 uv = clamp((frag - uRect.xy) / uRect.zw, 0.0, 1.0);
  vec4 aux = texture(uAux, uv);
  vec3 T = exp(-tauAt(uv, aux));

  // Forward scatter softens what the air has nearly taken: the towers only.
  // The sky behind the haze is veiled by the in-scatter below, never blurred
  // (convolving the clouds reads as a lens, not as air).
  float soft = (1.0 - T.g) * (1.0 - T.g) * (1.0 - smoothstep(0.02, 0.5, aux.g));
  vec3 scene = plate(uv, soft * ${(1.6 + Math.log2(PLATE_W / 2400)).toFixed(3)});

  // The air is lit by the sky: its colour is the sky's own light nearby.
  vec4 a = texture(uAir, uv);
  vec3 air = pow((a.rgb + uSkyMean * 0.02) / (a.a + 0.02), vec3(2.2));
  // Thick haze scatters more often and lifts toward the brighter horizon.
  float thick = 1.0 - T.g;
  air *= 1.0 + 0.18 * thick;

  vec3 col = scene * T + air * (1.0 - T);
  // Display-encoded and untoned, for the film finish. Alpha packs two
  // sixteenths (it survives an 8-bit target): how much of this pixel is a solid
  // tower still seen through the air (the glass grade's weight, so far towers
  // keep the blue the haze gave them), and how clear the air in front of it is
  // (the warm top end is the sun on the cumulus, not on the haze).
  float solid = T.g * (1.0 - smoothstep(0.02, 0.5, aux.g));
  outColor = vec4(pow(max(col, 0.0), vec3(1.0 / 2.2)), (floor(solid * 15.0 + 0.5) * 16.0 + floor(T.g * 15.0 + 0.5)) / 255.0);
}`;

// The film's response, shared by the halation threshold and the finish. In
// display terms: the mids and the sky are left where the plate put them, the
// upper range opens so the cumulus tops come up to a warm white, and a soft
// shoulder lands everything under 0.985 (the film never clips).
const TONE = `
vec3 tone(vec3 x) {
  vec3 y = x + 0.11 * smoothstep(0.5, 0.88, x);
  vec3 k = vec3(0.9);
  return min(y, k) + 0.085 * (1.0 - exp(-max(y - k, 0.0) / 0.085));
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// What exposes the halation: the toned highlights, above about 0.8.
float highlight(vec3 display) { return smoothstep(0.8, 0.94, luma(tone(display))); }
`;

// The finish's sources at half size: rgb the scene, linear, for the diffusion
// bloom; a the highlights that expose the halation.
const BRIGHT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
${TONE}
void main() {
  vec3 c = texture(uScene, vUv).rgb; // one bilinear tap: the 2x2 box below it
  outColor = vec4(pow(max(c, 0.0), vec3(2.2)), highlight(c));
}`;

// The last stage: the scene as summer film, scanned. A diffusion bloom and
// scan softness, a filmic shoulder whose top end is warm-neutral, cloud shade
// toward skylight blue, glass graded away from the sky's blue, a thin red
// halation under the highlight edges, and 24 fps grain at scan scale.
const FINISH = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
uniform sampler2D uHal;
uniform sampler2D uBloom;
uniform vec2 uNorm;    // halation, bloom chain weight sums
uniform float uGrain;  // grain seed, a new frame of grain every 2 frames at 24 fps
uniform float uGrainPx; // grain size in device pixels
${TONE}
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
// Value noise at the scan's sampling pitch: soft clumps, not square cells.
float grain(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y) - 0.5;
}

void main() {
  vec4 s = texture(uScene, vUv);
  float packed = floor(s.a * 255.0 + 0.5);
  float solid = floor(packed / 16.0) / 15.0;
  float clear = mod(packed, 16.0) / 15.0;
  vec3 lin = pow(max(s.rgb, 0.0), vec3(2.2));

  // Diffusion: the emulsion and the scanner both spread a little light, so the
  // image sits in a faint glow of itself and the finest edges go soft.
  vec3 bloom = texture(uBloom, vUv).rgb / uNorm.y;
  lin = mix(lin, bloom, 0.12) + max(bloom - lin, 0.0) * 0.1;
  vec3 c = pow(lin, vec3(1.0 / 2.2));

  // Glass, in its midtones, away from the sky's blue toward a cool green; its
  // light stone and lit mullions a touch warm.
  float l = luma(c);
  float mid = smoothstep(0.08, 0.3, l) * (1.0 - smoothstep(0.45, 0.75, l));
  float top = smoothstep(0.45, 0.8, l);
  c *= mix(vec3(1.0), vec3(0.96, 1.03, 0.945), mid * solid);
  c *= mix(vec3(1.0), vec3(1.05, 1.0, 0.92), top * solid);

  // The film's shoulder, per channel.
  c = tone(c);

  // Its top end is warm-neutral: the cumulus tops land near #FFF1E2, in clear
  // air only (veiled, a warm top under blue haze goes lilac). The shade in the
  // clouds leans to the skylight's cyan-grey, #B7C5C5.
  l = luma(c);
  float hi = smoothstep(0.72, 0.95, l);
  c = mix(c, l * vec3(1.05, 0.993, 0.931), hi * 0.85 * smoothstep(0.35, 0.85, clear));
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  float shade = smoothstep(0.5, 0.68, l) * (1.0 - smoothstep(0.78, 0.92, l)) * (1.0 - smoothstep(0.1, 0.3, sat)) * (1.0 - solid);
  c *= mix(vec3(1.0), vec3(0.97, 1.0, 0.99), shade);

  // Halation: light through the base bouncing back into the red layer, just
  // outside each highlight edge.
  float hal = max(texture(uHal, vUv).a / uNorm.x - highlight(s.rgb), 0.0);
  // Red, with the little green that makes it read red-orange over the blue.
  c += hal * vec3(0.42, 0.08, 0.0);

  // A little toe, then grain: luminance only, strongest in the midtones.
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.1);
  l = luma(c);
  vec2 g = gl_FragCoord.xy / uGrainPx + uGrain * vec2(37.0, 17.0);
  float n = grain(g) * 0.75 + grain(g * 1.7 + 11.0) * 0.45;
  c += n * 0.075 * (0.25 + 2.6 * l * (1.0 - l)) * (1.0 - 0.7 * smoothstep(0.85, 1.0, l));
  c += (hash(gl_FragCoord.xy + 17.0) - 0.5) / 255.0;
  // Grain rides on the shoulder, never through it: the print does not clip.
  outColor = vec4(clamp(c, 0.0, 0.99), 1.0);
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

function imageTexture(gl, img, mip) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// The mean (display-encoded) colour of the sky pixels, for where the blur sees none.
function skyMean(colorImg, auxImg) {
  const w = 48;
  const h = 32;
  const read = (img) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0, w, h);
    return x.getImageData(0, 0, w, h).data;
  };
  const col = read(colorImg);
  const aux = read(auxImg);
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    const m = aux[i * 4 + 1] / 255;
    if (m < 0.9) continue;
    for (let k = 0; k < 3; k++) sum[k] += col[i * 4 + k] / 255;
    n++;
  }
  return n ? sum.map((s) => s / n) : [0.25, 0.45, 0.7];
}

// A critically damped spring: interruptible, lands without overshoot.
function spring(x) {
  return { x, v: 0, target: x };
}
function stepSpring(s, dt, k) {
  const c = 2 * Math.sqrt(k);
  const a = k * (s.target - s.x) - c * s.v;
  s.v += a * dt;
  s.x += s.v * dt;
  return Math.abs(s.target - s.x) > 1e-4 || Math.abs(s.v) > 1e-4;
}

export async function createFog(host, { embedded = false } = {}) {
  const stage = createStage(host, { dpr: 2, webgl: true, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");

  const [colorImg, auxImg] = await Promise.all([loadImage(COLOR_SRC), loadImage(AUX_SRC)]);
  const colorTex = imageTexture(gl, colorImg, true);
  const auxTex = imageTexture(gl, auxImg, false);
  const skyLin = skyMean(colorImg, auxImg);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const P = {
    air: compile(gl, VERT, AIR),
    down: compile(gl, VERT, DOWN),
    up: compile(gl, VERT, UP),
    composite: compile(gl, VERT, COMPOSITE),
    bright: compile(gl, VERT, BRIGHT),
    finish: compile(gl, VERT, FINISH),
  };

  const float = !!gl.getExtension("EXT_color_buffer_float");
  const target = (w, h) => {
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
    return { tex, fbo, w, h };
  };
  const free = (t) => {
    if (!t) return;
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fbo);
  };

  // The sky's light, blurred wide once: the colour of the air. It depends on
  // the plate only, so its pyramid has a fixed size.
  const down = [];
  const up = [];
  {
    let bw = 600;
    let bh = 400;
    for (let i = 0; i < LEVELS; i++) {
      down.push(target(bw, bh));
      up.push(i === LEVELS - 1 ? null : target(bw, bh));
      bw = Math.max(2, Math.round(bw / 2));
      bh = Math.max(2, Math.round(bh / 2));
    }
  }

  let rect = { x: 0, y: 0, w: 1, h: 1 };
  let dirty = true;
  const params = new URLSearchParams(window.location.search);
  // Full bleed: the plate covers the box, held a little up and left of centre so the
  // towers' meeting point and the glass corner stay in view on tall screens.
  const layout = (w, h) => {
    const s = Math.max(w / ASPECT, h);
    const pw = s * ASPECT;
    const ph = s;
    rect = { x: (w - pw) * 0.45, y: (h - ph) * 0.42, w: pw, h: ph };
    dirty = true;
  };

  // --- state ---------------------------------------------------------------
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const qFog = params.get("fog");
  const held = qFog != null && Number.isFinite(+qFog);
  const qx = params.get("x");
  const qy = params.get("y");
  const fog = spring(held ? clamp(+qFog, 0, 1) : reduced ? ROLL : REST);
  const bx = spring(qx != null ? clamp(+qx, 0, 1) : 0.56);
  const by = spring(qy != null ? clamp(+qy, 0, 1) : 0.4);
  const breath = spring(held || qx != null ? 1 : 0.5);
  let time = Number.isFinite(+params.get("t")) && params.get("t") != null ? +params.get("t") : 0;
  let touched = held;
  let drag = null;
  let intro = !held && !reduced;
  let sinceDraw = 1;

  stage.onResize(layout);

  const toPrint = (p) => [(p.x - rect.x) / rect.w, (p.y - rect.y) / rect.h];
  const breatheAt = (p) => {
    const [u, v] = toPrint(p);
    bx.target = clamp(u, -0.1, 1.1);
    by.target = clamp(v, -0.1, 1.1);
    breath.target = 1;
  };

  stage.on("move", (p) => {
    touched = true;
    breatheAt(p);
    if (drag) {
      // Drag up to thicken the air (shorter visibility), down to clear it.
      fog.target = clamp(drag.f + ((drag.y - p.y) / Math.max(240, stage.height)) * 1.4, 0, 1);
    }
  });
  stage.on("down", (p) => {
    touched = true;
    intro = false;
    breatheAt(p);
    drag = { y: p.y, f: fog.target };
  });
  stage.on("up", () => {
    drag = null;
  });
  const onLeave = () => {
    breath.target = 0.5;
  };
  stage.canvas.addEventListener("pointerleave", onLeave);
  const onWheel = (e) => {
    e.preventDefault();
    touched = true;
    intro = false;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    fog.target = clamp(fog.target + dy / 900, 0, 1);
    breatheAt({ x: e.offsetX, y: e.offsetY });
  };
  if (!embedded) stage.canvas.addEventListener("wheel", onWheel, { passive: false });

  // On arrival the haze lifts off the street, and the sky deepens into blue.
  const introTimer = intro
    ? window.setTimeout(() => {
        if (!touched) fog.target = ROLL;
      }, 350)
    : 0;

  // --- passes --------------------------------------------------------------
  const quadDraw = (t) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    if (t) gl.viewport(0, 0, t.w, t.h);
    else gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const bind = (unit, tex) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  };
  // Down a pyramid from level 0 (already written).
  const descend = (dn) => {
    gl.useProgram(P.down.p);
    gl.uniform1i(P.down.u.uSrc, 0);
    for (let i = 1; i < dn.length; i++) {
      bind(0, dn[i - 1].tex);
      gl.uniform2f(P.down.u.uTexel, 1 / dn[i - 1].w, 1 / dn[i - 1].h);
      quadDraw(dn[i]);
    }
  };
  // Back up from level n - 1 (whole) through the finer levels, each adding its
  // own share by weight. The result sums to 1 + the weights.
  const ascend = (dn, ups, weights) => {
    const n = weights.length + 1;
    gl.useProgram(P.up.p);
    gl.uniform1i(P.up.u.uLevel, 0);
    gl.uniform1i(P.up.u.uCoarse, 2);
    for (let i = n - 2; i >= 0; i--) {
      const coarse = i === n - 2 ? dn[n - 1] : ups[i + 1];
      bind(0, dn[i].tex);
      bind(2, coarse.tex);
      gl.uniform2f(P.up.u.uTexel, 1 / coarse.w, 1 / coarse.h);
      gl.uniform1f(P.up.u.uW, weights[i]);
      quadDraw(ups[i]);
    }
    return ups[0];
  };
  const chain = (weights) => {
    descend(down);
    return ascend(down, up, weights);
  };

  gl.bindVertexArray(vao);
  gl.disable(gl.BLEND);
  gl.useProgram(P.air.p);
  bind(0, colorTex);
  bind(1, auxTex);
  gl.uniform1i(P.air.u.uColor, 0);
  gl.uniform1i(P.air.u.uAux, 1);
  gl.uniform1f(P.air.u.uLod, Math.log2(colorImg.naturalHeight / down[0].h));
  quadDraw(down[0]);
  // Broadest only: the air is lit by the whole sky and which part of it is
  // brighter, never by one cloud. Any finer level prints a blurred copy of the
  // cumulus into the haze: in thick air that copy is what you see where the
  // clouds were, soft white blobs, and the sky behind reads as lens-blurred,
  // not veiled. The veil over the sky is this field alone, so the cumulus
  // under it lose contrast with their edges as sharp as the plate's.
  const air = chain([0, 0, 0, 0, 0]);

  // The film finish works on the whole frame, so its targets follow the canvas:
  // the scene at full size, and a pyramid from half size for the halation
  // (its three finest levels, about 0.4% of the frame) and the bloom (all).
  const FX_LEVELS = 6;
  const HAL_W = [0.5, 1.0];
  const BLOOM_W = [0.6, 0.4, 0.4, 0.6, 0.8];
  const sum = (w) => 1 + w.reduce((a, b) => a + b, 0);
  let fx = null;
  const fxTargets = () => {
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (fx && fx.w === w && fx.h === h) return fx;
    if (fx) [fx.scene, ...fx.down, ...fx.hal, ...fx.bloom].forEach(free);
    const dn = [];
    let bw = Math.max(2, Math.round(w / 2));
    let bh = Math.max(2, Math.round(h / 2));
    for (let i = 0; i < FX_LEVELS; i++) {
      dn.push(target(bw, bh));
      bw = Math.max(2, Math.round(bw / 2));
      bh = Math.max(2, Math.round(bh / 2));
    }
    fx = {
      w,
      h,
      scene: target(w, h),
      down: dn,
      hal: HAL_W.map((_, i) => target(dn[i].w, dn[i].h)),
      bloom: BLOOM_W.map((_, i) => target(dn[i].w, dn[i].h)),
    };
    return fx;
  };

  const draw = () => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    const t = fxTargets();
    const vis = visibility(fog.x);
    const dpr = stage.dpr;
    gl.useProgram(P.composite.p);
    bind(0, colorTex);
    bind(1, auxTex);
    bind(2, air.tex);
    const cu = P.composite.u;
    gl.uniform1i(cu.uColor, 0);
    gl.uniform1i(cu.uAux, 1);
    gl.uniform1i(cu.uAir, 2);
    gl.uniform1f(cu.uBeta, 3.912 / vis);
    gl.uniform3f(cu.uBreath, bx.x, by.x, breath.x * 0.9);
    gl.uniform1f(cu.uAspect, ASPECT);
    gl.uniform1f(cu.uTime, time);
    gl.uniform3f(cu.uSkyMean, skyLin[0], skyLin[1], skyLin[2]);
    gl.uniform4f(cu.uRect, rect.x * dpr, rect.y * dpr, rect.w * dpr, rect.h * dpr);
    gl.uniform2f(cu.uCanvas, gl.drawingBufferWidth, gl.drawingBufferHeight);
    quadDraw(t.scene);

    // The finish: its sources at half size, blurred twice, then the frame.
    gl.useProgram(P.bright.p);
    bind(0, t.scene.tex);
    gl.uniform1i(P.bright.u.uScene, 0);
    quadDraw(t.down[0]);
    descend(t.down);
    const hal = ascend(t.down, t.hal, HAL_W);
    const bloom = ascend(t.down, t.bloom, BLOOM_W);

    gl.useProgram(P.finish.p);
    bind(0, t.scene.tex);
    bind(1, hal.tex);
    bind(2, bloom.tex);
    const fu = P.finish.u;
    gl.uniform1i(fu.uScene, 0);
    gl.uniform1i(fu.uHal, 1);
    gl.uniform1i(fu.uBloom, 2);
    gl.uniform2f(fu.uNorm, sum(HAL_W), sum(BLOOM_W));
    // 24 fps grain, each frame of it held for 2 (a new one every 1/12 s).
    gl.uniform1f(fu.uGrain, reduced ? 0 : Math.floor(time * 12) % 97);
    gl.uniform1f(fu.uGrainPx, 0.75 * dpr);
    quadDraw(null);
  };

  const stillTime = params.get("t") != null || reduced;
  stage.onFrame((dt) => {
    // Arrival lifts slowly (about two seconds); the hand gets a quick spring.
    const k = drag ? 120 : intro ? 8 : 26;
    const moving = stepSpring(fog, dt, k) | stepSpring(bx, dt, 30) | stepSpring(by, dt, 30) | stepSpring(breath, dt, 10);
    if (intro && Math.abs(fog.x - ROLL) < 0.01) intro = false;
    sinceDraw += dt;
    if (!stillTime) time += dt;
    // The haze drifts on its own, drawn at a capped rate.
    const drift = !stillTime && sinceDraw >= 1 / DRIFT_FPS;
    if (!moving && !dirty && !drift) return;
    dirty = false;
    sinceDraw = 0;
    draw();
  });

  return {
    destroy() {
      window.clearTimeout(introTimer);
      stage.canvas.removeEventListener("pointerleave", onLeave);
      stage.canvas.removeEventListener("wheel", onWheel);
      [...down, ...up].forEach(free);
      if (fx) [fx.scene, ...fx.down, ...fx.hal, ...fx.bloom].forEach(free);
      stage.destroy();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
