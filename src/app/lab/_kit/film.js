// Film: a shared WebGL2 post-process that makes a rendered frame read like a
// scanned colour negative (Portra 400, Superia, CineStill) rather than a filter.
// Everything optical happens in linear light, before the tone curve, the way
// the light would have reached the emulsion.
//
//   import { createFilm, FILM_PRESETS } from "../_kit/film";
//   const film = createFilm(gl, { width, height });      // device pixels
//   stage.onResize((w, h, dpr) => film.resize(w * dpr, h * dpr));
//   film.render(sceneTexture, FILM_PRESETS.summer);       // to the canvas
//   film.render(sceneTexture, { ...FILM_PRESETS.dusk, grain: 0.5 }, fbo);
//   film.destroy();
//
// `sceneTexture` is the frame to develop, width x height, GL orientation
// (uv 0,0 at the bottom left; pass `flipY: true` for an image texture uploaded
// top row first). By default it is read as sRGB-encoded (an RGBA8 render or a
// photo); pass `input: "linear"` for a half-float linear render.
//
// Params (all optional; missing ones fall back to FILM_DEFAULTS, which are
// the "summer" look; FILM_PRESETS holds summer, dusk and night):
//   exposure     stops, before the curve                                    0
//   headroom     0..3  how far near-clipped whites of an sRGB input are pushed
//                past 1.0 in the light that scatters (bloom, halation), so a
//                clipped cloud glows like the real one; 0 for linear HDR
//                input that already carries it.                           1.4
//   halation     0..1  red-orange fringe round bright highlights: light that
//                went through the emulsion, bounced off the film base and came
//                back through the red layer. Wide (1-3% of the frame) and
//                kept off the highlight itself, so it shows at its edges.  0.45
//   halationThreshold  scene luminance where halation starts               0.9
//   halationColor      [r,g,b] linear tint                      [1, .26, .1]
//   halationLocal      0..1  judge "already saturated" from the surround (1/4
//                res) instead of the pixel itself, so a hairline (a wire, a
//                twig) inside a bright field takes the field's halo in
//                proportion to its own light, not a red fringe of its own. 0
//   bloom        0..1  Pro-Mist diffusion: a share of all the light is spread
//                through a 6-level pyramid (energy conserving), so bright
//                areas veil softly into nearby shadows and lift them.     0.28
//   bloomThreshold  scene luminance (linear) where the diffusion starts: 0
//                spreads all the light; above 0 only the light past it (a
//                soft knee from half to 1.5x) leaves its pixel, so a
//                photographed sky keeps its own drawing and only the
//                highlights veil. The dye-cloud colour bleed then reads its
//                colour from a ~6 px spread of the input instead of the
//                pyramid.                                                     0
//   softness     0..1  optical softness and dye-cloud colour bleed: luma
//                spread over 1-2 px, the colour ratio (hue, saturation) over
//                ~8 px, so colour creeps across edges while drawing holds. 0.55
//   contrast     curve slope at mid grey (film is ~1.1-1.35)               1.2
//   shoulder     0.85..1  lower rolls the highlights off sooner           0.95
//   whitePoint   scene value that lands on paper white                     1.3
//   toe          0..0.1  lifted black of a scan, sRGB units               0.045
//   toeColor     [r,g,b] relative tint of that black            [.75, 1, 1.2]
//   shadowTint   [r,g,b] multiplier on the shadows (split tone)  [.9, 1, 1.08]
//   highlightTint [r,g,b] multiplier on the highlights           [.95, 1, 1.05]
//   saturation   1 = as shot; eased off towards the shoulder, so bright colour
//                bleaches instead of clipping into a flat hue             1.1
//   blueDepth    0..1  saturated blues go deeper and lose their violet, the
//                way Superia/Portra scans render a summer sky; white cloud,
//                grey and warm surfaces are left alone.                   0.85
//   warmth       -1..1 white balance, + is warmer                           0
//   grain        0..1  fine luminance-dependent grain, strongest in the mids,
//                sized to the frame (~1/1100 of its height), so DPR 2 is no
//                noisier than DPR 1.                                      0.35
//   grainSize    multiplier on that size                                    1
//   grainSeed    any number; change it per frame for moving grain           0
//   vignette     0..1  optical cos^4 falloff (1 is about -1 stop in the
//                corners); not a darkroom burn.                            0.3
//   input        "srgb" | "linear"                                     "srgb"
//   flipY        sample the input upside down                           false
//
// Cost, at 2560x1600 (a 1280x800 box at DPR 2): a half-res prep pass (4 taps),
// five downsamples (13 taps) and four upsamples (4 taps) on a 6-level pyramid
// (11 half-float targets, ~21 MB), then one full-res composite of 17 fetches
// plus curve and grain math. Roughly 1-1.5 ms on an M1 or Iris Xe, 3-4 ms on
// older Intel UHD; the composite is about 60% of it. Targets are allocated
// only on resize(). For a still frame, render once and stop.
//
// GL state: render() binds its own VAO, programs, framebuffers and texture
// units 0-3, sets the viewport and disables blending, depth and scissor;
// rebind your own state afterwards. Without EXT_color_buffer_float/half_float
// the pyramid falls back to RGBA8 storing scene/4 (some banding in the veil,
// no clipping).

export const FILM_DEFAULTS = {
  exposure: 0,
  headroom: 1.4,
  halation: 0.45,
  halationThreshold: 0.9,
  halationColor: [1, 0.26, 0.1],
  halationLocal: 0,
  bloom: 0.28,
  bloomThreshold: 0,
  softness: 0.55,
  contrast: 1.2,
  shoulder: 0.95,
  toe: 0.045,
  toeColor: [0.75, 1, 1.2],
  whitePoint: 1.3,
  shadowTint: [0.9, 1, 1.08],
  highlightTint: [0.95, 1, 1.05],
  saturation: 1.1,
  blueDepth: 0.85,
  warmth: 0,
  grain: 0.35,
  grainSize: 1,
  grainSeed: 0,
  vignette: 0.3,
  input: "srgb",
  flipY: false,
};

export const FILM_PRESETS = {
  // Superia / Portra 400 at noon: dense cobalt sky, neutral cloud that glows,
  // teal-lifted shadows. The defaults are this preset.
  summer: {},
  // Portra 400 at golden hour: warm highlights, more veil, the sky left soft.
  dusk: {
    exposure: -0.15,
    warmth: 0.45,
    bloom: 0.34,
    halation: 0.55,
    softness: 0.6,
    contrast: 1.12,
    saturation: 1.05,
    blueDepth: 0.35,
    shadowTint: [0.94, 1, 1.06],
    highlightTint: [1.05, 1, 0.92],
    toeColor: [0.9, 1, 1.1],
    vignette: 0.42,
    grain: 0.4,
  },
  // CineStill 800T after dark: tungsten-cool shadows, a strong red halo round
  // every light (no remjet), low threshold so streetlights and signs bleed,
  // open grain.
  night: {
    headroom: 2,
    halation: 0.9,
    halationThreshold: 0.55,
    halationColor: [1, 0.16, 0.05],
    bloom: 0.3,
    softness: 0.6,
    contrast: 1.25,
    shoulder: 0.93,
    whitePoint: 1.6,
    toe: 0.05,
    toeColor: [0.6, 0.95, 1.25],
    shadowTint: [0.86, 1, 1.14],
    highlightTint: [1.02, 1, 0.97],
    saturation: 1.05,
    blueDepth: 0.2,
    warmth: -0.25,
    grain: 0.6,
    grainSize: 1.2,
    vignette: 0.4,
  },
};

const LEVELS = 6; // half, 1/4, 1/8, 1/16, 1/32, 1/64 of the frame
// Per-level weights (finest first). rgb: the diffusion point spread, broad
// wings; a: halation, centred on 1/16-1/32 res (1-3% of the frame).
const BLOOM_W = [0.1, 0.14, 0.2, 0.22, 0.2, 0.14];
const HALO_W = [0.0, 0.06, 0.22, 0.34, 0.26, 0.12];

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const COMMON = `
uniform float uInSRGB;
uniform float uHeadroom;
uniform float uMistThr;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
// The share of a pixel's light the diffusion takes: all of it, or above a
// threshold only the highlights.
float mistShare(vec3 s) {
  if (uMistThr <= 0.0) return 1.0;
  return smoothstep(uMistThr * 0.5, uMistThr * 1.5, dot(s, LUMA));
}
vec3 srgbToLinear(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 decode(vec3 c) {
  return uInSRGB > 0.5 ? srgbToLinear(c) : max(c, 0.0);
}
// The light that scatters: an SDR input's near-white pushed back past 1.0 so a
// clipped cloud carries the energy the real one did. Only the scattered light
// gets it; the image itself keeps its tonality.
vec3 toScene(vec3 c) {
  c = decode(c);
  float m = max(c.r, max(c.g, c.b));
  float e = smoothstep(0.6, 1.0, m);
  return c * (1.0 + uHeadroom * e * e);
}
// 3x3 tent from four bilinear taps.
vec4 tent(sampler2D t, vec2 uv, vec2 texel) {
  vec2 o = texel * 0.5;
  return 0.25 * (texture(t, uv + vec2(-o.x, -o.y)) + texture(t, uv + vec2(o.x, -o.y)) + texture(t, uv + vec2(-o.x, o.y)) + texture(t, uv + vec2(o.x, o.y)));
}
`;

// Full res -> half res: scene light in rgb, halation source in a.
const PREP = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uIn;
uniform vec2 uInTexel;
uniform float uFlip;
uniform float uThreshold;
uniform float uEnc;
${COMMON}
void main() {
  vec2 uv = vUv;
  if (uFlip > 0.5) uv.y = 1.0 - uv.y;
  vec2 o = uInTexel;
  // Four bilinear taps cover a 4x4 block of the input: no shimmer on thin
  // bright edges.
  vec3 t0 = toScene(texture(uIn, uv + vec2(-o.x, -o.y)).rgb);
  vec3 t1 = toScene(texture(uIn, uv + vec2(o.x, -o.y)).rgb);
  vec3 t2 = toScene(texture(uIn, uv + vec2(-o.x, o.y)).rgb);
  vec3 t3 = toScene(texture(uIn, uv + vec2(o.x, o.y)).rgb);
  vec3 c = (t0 + t1 + t2 + t3) * 0.25;
  float l = dot(c, LUMA);
  // The light that diffuses (all of it unless there is a threshold).
  vec3 mist = (t0 * mistShare(t0) + t1 * mistShare(t1) + t2 * mistShare(t2) + t3 * mistShare(t3)) * 0.25;
  // Soft knee so the halo grows smoothly out of the threshold.
  float k = uThreshold * 0.5;
  float x = clamp(l - uThreshold + k, 0.0, 2.0 * k);
  float h = max(x * x / (4.0 * k + 1e-5), l - uThreshold);
  outColor = vec4(mist, h) * uEnc;
}`;

// 13-tap downsample (Jimenez, CoD: Advanced Warfare).
const DOWN = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;
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

// Tent upsample of the coarser sum, plus this level's weighted share. The
// weights over all levels sum to 1 per channel, so the result is a true
// (energy-conserving) blur.
const UP = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uLevel;
uniform sampler2D uCoarse;
uniform vec2 uTexel;
uniform vec4 uW;
uniform vec4 uWc;
${COMMON}
void main() {
  outColor = tent(uCoarse, vUv, uTexel) * uWc + texture(uLevel, vUv) * uW;
}`;

const COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uIn;
uniform sampler2D uBase;   // half res: scene, halation source
uniform sampler2D uL1;     // quarter res
uniform sampler2D uUp1;    // the pyramid sum from 1/4 res down
uniform vec2 uBaseTexel;
uniform vec2 uL1Texel;
uniform vec2 uUp1Texel;
uniform vec4 uW0;          // level-0 weights (rgb diffusion, a halation)
uniform float uDec;
uniform float uFlip;
uniform vec2 uRes;
uniform float uExposure;   // linear multiplier
uniform float uBloom;
uniform float uHal;
uniform vec3 uHalColor;
uniform float uHalLocal;
uniform float uSoft;
uniform float uSat;
uniform float uBlue;
uniform vec3 uWarm;
uniform vec4 uCurve;       // a, d, b, c
uniform vec3 uToe;
uniform vec3 uShadowTint;
uniform vec3 uHighTint;
uniform float uGrain;
uniform float uGrainPx;
uniform float uSeed;
uniform float uVignette;
${COMMON}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 curve(vec3 x) {
  // Lottes' filmic curve: a = contrast, d = shoulder; passes mid grey through
  // and lands the brightest scene value on 1.0 with a soft roll.
  vec3 xa = pow(x, vec3(uCurve.x));
  return xa / (pow(x, vec3(uCurve.x * uCurve.y)) * uCurve.z + uCurve.w);
}

void main() {
  vec2 uv = vUv;
  vec2 iuv = uFlip > 0.5 ? vec2(uv.x, 1.0 - uv.y) : uv;
  vec3 sharp = decode(texture(uIn, iuv).rgb);
  vec4 b0 = tent(uBase, uv, uBaseTexel) * uDec;
  vec3 b1 = tent(uL1, uv, uL1Texel).rgb * uDec;
  vec4 wide = tent(uUp1, uv, uUp1Texel) * uDec + b0 * uW0;

  // Optical softness and dye-cloud colour bleed: luma from a 1-2 px spread of
  // the input, the colour ratio (hue and saturation) from 1/4 res, so colour
  // creeps across edges while the drawing mostly holds.
  const float E = 0.004;
  vec2 o = (0.5 + 0.9 * uSoft) / uRes;
  vec3 near = 0.25 * (decode(texture(uIn, iuv + vec2(-o.x, -o.y)).rgb) + decode(texture(uIn, iuv + vec2(o.x, -o.y)).rgb)
            + decode(texture(uIn, iuv + vec2(-o.x, o.y)).rgb) + decode(texture(uIn, iuv + vec2(o.x, o.y)).rgb));
  float ys = dot(sharp, LUMA);
  float y = mix(ys, dot(near, LUMA), uSoft);
  vec3 hs = (sharp + E) / (ys + E);
  vec3 hb = (b1 + E) / (dot(b1, LUMA) + E);
  if (uMistThr > 0.0) {
    // The pyramid holds only the highlights: the colour bleed reads the
    // input itself, about as wide as the quarter-res level.
    vec2 q = 3.0 / uRes;
    vec3 cb = 0.25 * (decode(texture(uIn, iuv + vec2(-q.x, -q.y)).rgb) + decode(texture(uIn, iuv + vec2(q.x, -q.y)).rgb)
            + decode(texture(uIn, iuv + vec2(-q.x, q.y)).rgb) + decode(texture(uIn, iuv + vec2(q.x, q.y)).rgb));
    hb = (cb + E) / (dot(cb, LUMA) + E);
  }
  vec3 col = max(mix(hs, hb, uSoft * 0.8) * (y + E) - E, 0.0);

  // Pro-Mist: a share of the light (all of it, or the highlights past the
  // threshold) leaves the image and lands spread out.
  col = col * (1.0 - uBloom * mistShare(toScene(texture(uIn, iuv).rgb))) + wide.rgb * uBloom;

  // Halation: extra red exposure from light bounced off the base, kept off the
  // highlight itself (the source has already saturated there).
  float yl1 = dot(b1, LUMA);
  float yh = mix(ys, max(ys, yl1), uHalLocal);
  float halo = max(wide.a - b0.a * 0.7, 0.0) * (1.0 - smoothstep(0.12, 0.6, yh));
  // a hairline darker than its surround keeps its share of darkness
  halo *= mix(1.0, clamp((ys + 0.02) / (yl1 + 0.02), 0.0, 1.0), uHalLocal);
  col += uHalColor * halo * uHal;

  // Optical vignette, cos^4 of the field angle.
  vec2 r = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float t2 = dot(r, r) / (0.25 * (uRes.x * uRes.x / (uRes.y * uRes.y) + 1.0)) * uVignette * uVignette;
  col *= 1.0 / ((1.0 + t2) * (1.0 + t2));

  col *= uExposure * uWarm;

  // Summer blue: saturated blues go deeper, denser and lose their violet, the
  // way a negative renders a clear sky; cloud, grey and warm surfaces are
  // left alone.
  float sky = smoothstep(0.45, 0.9, (col.b - col.r) / (col.b + 1e-4)) * smoothstep(-0.02, 0.05, col.b - col.g) * smoothstep(0.004, 0.03, col.b);
  col = mix(col, col * vec3(0.26, 0.64, 0.66), sky * uBlue);

  // Split tone: the dye layers' crossover tints shadows and highlights apart.
  float yl = dot(col, LUMA);
  float zone = smoothstep(-3.0, 2.0, log2(max(yl, 1e-4) / 0.18));
  col *= mix(uShadowTint, uHighTint, zone);

  // Saturation, eased off as colour climbs into the shoulder.
  yl = dot(col, LUMA);
  float sat = mix(uSat, 1.0, smoothstep(0.4, 1.4, yl));
  col = max(mix(vec3(yl), col, sat), 0.0);

  // Per-channel film curve: bright colour bleaches towards white.
  col = curve(col);
  vec3 outc = linearToSrgb(col);

  // Lifted, tinted black of a scanned negative.
  outc = uToe + (1.0 - uToe) * outc;

  // Grain: clumps about 1/1100 of the frame tall, strongest in the mids and
  // shadows, cleaner in the highlights; mostly monochrome with a little dye.
  vec2 gp = gl_FragCoord.xy / uGrainPx + uSeed * vec2(17.13, 31.71);
  float g = vnoise(gp) * 0.65 + vnoise(gp * 2.13 + 7.7) * 0.35 - 0.5;
  vec3 gc = vec3(vnoise(gp + 41.0), vnoise(gp + 83.0), vnoise(gp + 127.0)) - 0.5;
  float ly = dot(outc, LUMA);
  float amp = uGrain * 0.2 * (0.2 + 0.8 * smoothstep(0.0, 0.3, ly) * (1.0 - smoothstep(0.45, 0.9, ly)));
  outc += (vec3(g) + gc * 0.3) * amp;

  // Dither so a smooth sky never bands on an 8-bit screen.
  outc += (hash12(gl_FragCoord.xy + uSeed) + hash12(gl_FragCoord.yx + 3.1 + uSeed) - 1.0) / 255.0;
  outColor = vec4(clamp(outc, 0.0, 1.0), 1.0);
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

// Lottes' curve constants for contrast a, shoulder d, mapping midIn -> midOut
// and hdrMax -> 1.
function curveConstants(a, d, hdrMax, midIn, midOut) {
  const ad = a * d;
  const den = (hdrMax ** ad - midIn ** ad) * midOut;
  const b = (-(midIn ** a) + hdrMax ** a * midOut) / den;
  const c = (hdrMax ** ad * midIn ** a - hdrMax ** a * midIn ** ad * midOut) / den;
  return [a, d, b, c];
}

const normalise = (w) => {
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / s);
};

export function createFilm(gl, { width = 1, height = 1 } = {}) {
  // Half-float pyramid where the GPU can render to it; RGBA8 otherwise.
  const half = !!(gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float"));
  gl.getExtension("OES_texture_float_linear");

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const P = {
    prep: compile(gl, VERT, PREP),
    down: compile(gl, VERT, DOWN),
    up: compile(gl, VERT, UP),
    composite: compile(gl, VERT, COMPOSITE),
  };

  let useHalf = half;
  const target = (w, h) => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const alloc = () => {
      if (useHalf) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    };
    alloc();
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (useHalf && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      // The extension lied (some mobile drivers): fall back for good.
      useHalf = false;
      alloc();
    }
    return { tex, fbo, w, h };
  };
  const free = (t) => {
    if (!t) return;
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fbo);
  };

  let W = 1;
  let H = 1;
  let down = [];
  let up = [];
  const resize = (w, h) => {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (w === W && h === H && down.length) return;
    W = w;
    H = h;
    [...down, ...up].forEach(free);
    down = [];
    up = [];
    let bw = Math.max(2, Math.ceil(w / 2));
    let bh = Math.max(2, Math.ceil(h / 2));
    for (let i = 0; i < LEVELS; i++) {
      down.push(target(bw, bh));
      // up[i] holds the sum of levels i..LEVELS-1; up[0] is folded into the
      // composite, and the coarsest level is its own sum.
      up.push(i === 0 || i === LEVELS - 1 ? null : target(bw, bh));
      bw = Math.max(2, Math.ceil(bw / 2));
      bh = Math.max(2, Math.ceil(bh / 2));
    }
  };
  resize(width, height);

  const bloomW = normalise(BLOOM_W);
  const haloW = normalise(HALO_W);

  const bind = (unit, tex) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  };
  const pass = (t) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const render = (input, params = {}, targetFbo = null) => {
    const p = { ...FILM_DEFAULTS, ...params };
    const enc = useHalf ? 1 : 0.25;
    const inSRGB = p.input === "linear" ? 0 : 1;
    const headroom = inSRGB ? p.headroom : 0;
    const flip = p.flipY ? 1 : 0;

    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.DEPTH_TEST);

    // 1. Prep: scene light and halation source at half res.
    gl.useProgram(P.prep.p);
    bind(0, input);
    gl.uniform1i(P.prep.u.uIn, 0);
    gl.uniform2f(P.prep.u.uInTexel, 1 / W, 1 / H);
    gl.uniform1f(P.prep.u.uFlip, flip);
    gl.uniform1f(P.prep.u.uThreshold, p.halationThreshold);
    gl.uniform1f(P.prep.u.uEnc, enc);
    gl.uniform1f(P.prep.u.uInSRGB, inSRGB);
    gl.uniform1f(P.prep.u.uHeadroom, headroom);
    gl.uniform1f(P.prep.u.uMistThr, Math.max(0, p.bloomThreshold));
    pass(down[0]);

    // 2. Down the pyramid.
    gl.useProgram(P.down.p);
    gl.uniform1i(P.down.u.uSrc, 0);
    for (let i = 1; i < LEVELS; i++) {
      bind(0, down[i - 1].tex);
      gl.uniform2f(P.down.u.uTexel, 1 / down[i - 1].w, 1 / down[i - 1].h);
      pass(down[i]);
    }

    // 3. Back up to quarter res, weighting each level.
    gl.useProgram(P.up.p);
    gl.uniform1i(P.up.u.uLevel, 0);
    gl.uniform1i(P.up.u.uCoarse, 1);
    const last = LEVELS - 1;
    for (let i = last - 1; i >= 1; i--) {
      const coarse = i === last - 1 ? down[last] : up[i + 1];
      bind(0, down[i].tex);
      bind(1, coarse.tex);
      gl.uniform2f(P.up.u.uTexel, 1 / coarse.w, 1 / coarse.h);
      gl.uniform4f(P.up.u.uW, bloomW[i], bloomW[i], bloomW[i], haloW[i]);
      if (i === last - 1) gl.uniform4f(P.up.u.uWc, bloomW[last], bloomW[last], bloomW[last], haloW[last]);
      else gl.uniform4f(P.up.u.uWc, 1, 1, 1, 1);
      pass(up[i]);
    }

    // 4. Composite at full res.
    const c = P.composite.u;
    gl.useProgram(P.composite.p);
    bind(0, input);
    bind(1, down[0].tex);
    bind(2, down[1].tex);
    bind(3, up[1].tex);
    gl.uniform1i(c.uIn, 0);
    gl.uniform1i(c.uBase, 1);
    gl.uniform1i(c.uL1, 2);
    gl.uniform1i(c.uUp1, 3);
    gl.uniform2f(c.uBaseTexel, 1 / down[0].w, 1 / down[0].h);
    gl.uniform2f(c.uL1Texel, 1 / down[1].w, 1 / down[1].h);
    gl.uniform2f(c.uUp1Texel, 1 / up[1].w, 1 / up[1].h);
    gl.uniform4f(c.uW0, bloomW[0], bloomW[0], bloomW[0], haloW[0]);
    gl.uniform1f(c.uDec, 1 / enc);
    gl.uniform1f(c.uFlip, flip);
    gl.uniform1f(c.uInSRGB, inSRGB);
    gl.uniform1f(c.uHeadroom, headroom);
    gl.uniform1f(c.uMistThr, Math.max(0, p.bloomThreshold));
    gl.uniform2f(c.uRes, W, H);
    gl.uniform1f(c.uExposure, 2 ** p.exposure);
    gl.uniform1f(c.uBloom, Math.min(1, Math.max(0, p.bloom)) * 0.45);
    gl.uniform1f(c.uHal, Math.max(0, p.halation) * 1.6);
    gl.uniform3fv(c.uHalColor, p.halationColor);
    gl.uniform1f(c.uHalLocal, Math.min(1, Math.max(0, p.halationLocal)));
    gl.uniform1f(c.uSoft, Math.min(1, Math.max(0, p.softness)));
    gl.uniform1f(c.uSat, p.saturation);
    gl.uniform1f(c.uBlue, Math.min(1, Math.max(0, p.blueDepth)));
    const w = Math.max(-1, Math.min(1, p.warmth)) * 0.08;
    gl.uniform3f(c.uWarm, 1 + w, 1, 1 - w);
    const hdrMax = p.whitePoint;
    gl.uniform4fv(c.uCurve, curveConstants(p.contrast, p.shoulder, hdrMax, 0.18, 0.18));
    gl.uniform3fv(c.uShadowTint, p.shadowTint);
    gl.uniform3fv(c.uHighTint, p.highlightTint);
    gl.uniform3f(c.uToe, p.toe * p.toeColor[0], p.toe * p.toeColor[1], p.toe * p.toeColor[2]);
    gl.uniform1f(c.uGrain, Math.max(0, p.grain));
    gl.uniform1f(c.uGrainPx, Math.max(0.75, (H / 1100) * p.grainSize));
    gl.uniform1f(c.uSeed, p.grainSeed % 997);
    gl.uniform1f(c.uVignette, Math.max(0, p.vignette));
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo);
    gl.viewport(0, 0, W, H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  };

  return {
    resize,
    render,
    get halfFloat() {
      return useHalf;
    },
    destroy() {
      [...down, ...up].forEach(free);
      down = [];
      up = [];
      for (const k of Object.keys(P)) gl.deleteProgram(P[k].p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
    },
  };
}
