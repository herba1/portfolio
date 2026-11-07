import { createStage, clamp } from "../_kit/stage";
import { createFilm, FILM_PRESETS } from "../_kit/film";

// Fade: a lane in Cinque Terre seen from the cobbles, looking straight up
// between painted houses into a summer sky, and the thirty years of sun that
// come after it. Drag forward and every wall ages by the light it actually
// receives: the top floors, open to the whole sky, bleach and chalk first;
// the low storeys, which see only the slot of sky between the eaves, keep
// their colour longest.
//
// The bake (tools/depth/bakes/fade) takes Victor Rosario's photograph apart:
//  - light.webp R: the annual solar dose per pixel. MoGe-2's metric point map
//    is marched toward 144 sun positions over a year at 44 N (12 days x 12
//    hours, clear-sky beam x the Ligurian coast's sunshine fraction) plus the
//    sky-view factor x diffuse, normalised so an open south wall is 1. The
//    camera looks almost straight up, so world up is recovered from the walls
//    themselves (every facade is vertical), and the lane's orientation from
//    the photo's own sun, fitted on the walls' shading one paint at a time.
//    The houses across the lane carve the shade out of it.
//  - light.webp G: the photo's own illumination: the lane is in high sun, so
//    one sun level (the white trim reflecting 0.85) plus a sky share by view
//    factor, and albedo = photo / S.
//  - mat.webp: how each pixel ages: the render fades per pigment and its
//    lime binder chalks, the one bare stone wall barely moves, the sky and
//    its cloud are inert.
//
// Live, per pixel, with e = years x dose x susceptibility:
//  - ink: albedo -> optical density per channel; the neutral part is carbon
//    black, the rest is cyan (absorbs red), magenta (green) and yellow (blue),
//    each fading exponentially, yellow and magenta about 4x faster than cyan,
//    so reds and yellows go first (dark shutter green is mostly neutral
//    density, which barely moves);
//  - wood: lignin breaks down and brown wood goes silver grey (unused here:
//    every surface in this photo is painted or stone);
//  - chalk: the binder erodes and the white pigment powders out, lifting the
//    paint towards the lime's own warm cream (never paper white), at most a
//    quarter of the way, so the top floors keep a trace of their hue;
//  - and the dose itself is taken down to the scale of a ledge: every sill,
//    cornice and eave (an edge across the wall's vertical, found by marching
//    up the plate toward the verticals' vanishing point) shelters a ragged
//    strip below it that keeps its paint, and the open wall weathers in
//    patches (the wash's uneven coats, the wall's own stains off the plate);
// then photo + S x (aged albedo - albedo), developed by the shared film kit.
//
// The sky, last: the photo's own is a pale, hazy powder blue, which leaves
// the bleached walls nothing to read against. A polariser, turned to the
// sky's 90 degrees from the sun (here the whole frame: the sun is high and
// the lens looks straight up), cuts the polarised skylight and the haze but
// not the cloud. So, on MoGe-2's sky only (mat.webp carries it: the sky is
// 1 - (2 R - B / 0.85)), each pixel is split into clear sky and cloud by how
// much of the clear sky's blue chroma it still holds; the clear part is
// re-shot as a deep cyan-cobalt that deepens radially toward the zenith at
// the frame's centre (dithered, so the 8-bit scene target never bands), and
// the cloud keeps its own light, its thin edges and undersides taking
// skylight blue, its tops rolled softly under paper white. After the film,
// the scan's lifted black is taken back out over the sky alone.
//
// Query: ?years=0..30 holds the clock; ?still=1 skips the reveal; ?film=0
// shows the aged frame before the film; ?debug=dose shows the dose map;
// ?debug=local shows the dose with its ledge shelter and patches; ?sky=0
// shows the sky as shot.

const BASE = "/lab/fade/";
const PW = 2000;
const PH = 1500;
const YEARS = 30;
const OPEN_AT = 3.2;
// Fade rates per unit dose-year (1 = a year on an open south wall).
// Each surface first spends an induction dose (its UV absorbers and
// stabilisers are used up), so what stays in shade never really starts.
const K_INK = [0.03, 0.13, 0.16]; // cyan, magenta, yellow
const K_BLACK = 0.004;
const K_WOOD = 0.1;
const K_CHALK = 0.07;
// At most a quarter of the surface powders to bare lime: even the most exposed
// top floor keeps a trace of its own hue under the bloom.
const CHALK_MAX = 0.25;
const INDUCTION = 2.5;
// Chalking needs the film itself to erode: only well-exposed paint gets there.
const CHALK_INDUCTION = 7;
// The render under the pigment, and what the binder powders to: lime and
// sand, a warm cream (sRGB hue, saturation, value), never paper white.
const RENDER = [35, 0.12, 0.86];
// Where the light falls at the scale of a ledge. Every sill, cornice and eave
// shelters a strip of wall below it from sun and driving rain, out to about
// its own depth; world up is toward the verticals' vanishing point, which the
// photo puts above the frame (the corner of the yellow house and the left
// edge of the orange one meet there), in plate pixels.
const VANISH = [940, -1650];
const SHELTER = 0.85;
// Lime wash goes in patches: coats of uneven thickness, a wall's own stains.
const MOTTLE = 0.75;
// The polarised sky, as sRGB hue (deg), saturation, value: the zenith at the
// frame's centre, and the rim of the slot down by the eaves.
const SKY_ZENITH = [206, 0.85, 0.51];
const SKY_RIM = [203, 0.68, 0.71];
// The photo's own clearest sky (95th percentile of saturation in the mask),
// the reference for how much of a pixel is still clear sky.
const SKY_CLEAR = [206, 0.49, 0.87];
// The scan's lifted black (the film's toe x toe colour), removed over the sky.
const FILM_TOE = 0.035;
const FILM_TOE_COLOR = [0.75, 1, 1.2];

const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hsvLin = ([h, s, v]) => {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)].map(srgbToLin);
};

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const AGE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPlate;
uniform sampler2D uMat;
uniform sampler2D uLight;
uniform sampler2D uSkyPlate;
uniform float uYears;
uniform vec3 uKInk;
uniform float uKBlack;
uniform float uKWood;
uniform float uKChalk;
uniform float uChalkMax;
uniform float uInduction;
uniform float uChalkInduction;
uniform vec3 uBase;
uniform float uDebug;
uniform float uPolar;
uniform vec3 uZenith;
uniform vec3 uRim;
uniform vec3 uClear;
uniform vec2 uRes;
uniform vec2 uPlateSize;
uniform vec2 uVanish;
uniform float uShelter;
uniform float uMottle;
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float LN10 = 2.302585;
float skyMask(vec4 m, vec3 lin) {
  return clamp(1.0 - (2.0 * m.r - m.b / 0.85), 0.0, 1.0) * smoothstep(-0.03, 0.01, (lin.b - lin.r) / max(lin.b, 1e-3));
}
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
// log luminance of the plate, at plate pixel P, read soft at a mip level
float logY(vec2 P, float lod) {
  return log(dot(toLin(textureLod(uPlate, P / uPlateSize, lod).rgb), LUMA) + 0.02);
}
// How sheltered a pixel is by a ledge above it. March up the wall (toward
// the verticals' vanishing point) at a fixed pitch and look for an edge that
// crosses the march: a sill, a cornice, a string course, an eave against the
// sky. Only an edge whose gradient points up the wall counts; one running
// along the march (a shutter's stile, a drainpipe, a cable) is not a ledge.
// The strip a ledge protects reaches about its own depth below it, ragged
// where the rain drips off it.
float shelterAt(vec2 P) {
  vec2 toV = uVanish - P;
  vec2 up = normalize(toV);
  vec2 side = vec2(-up.y, up.x);
  // nearer walls (out toward the frame's edges) are larger in the frame
  float near = clamp(length(P - 0.5 * uPlateSize) / (0.5 * length(uPlateSize)), 0.0, 1.0);
  float ang = atan(toV.x, -toV.y) * 2400.0;
  float drip = 0.65 * vnoise(vec2(ang / 11.0, 0.5)) + 0.35 * vnoise(vec2(ang / 4.0, 7.5));
  float reach = min(mix(16.0, 36.0, near) * (0.5 + drip), 48.0);
  // three columns a hand's width apart: a ledge runs across all of them, a
  // nail or a hook in the wall does not
  const float H = 3.0;
  const float W = 6.0;
  float s = 0.0;
  vec3 y0 = vec3(logY(P - side * W, 1.5), logY(P, 1.5), logY(P + side * W, 1.5));
  vec2 Q1 = P + up * H;
  vec3 y1 = vec3(logY(Q1 - side * W, 1.5), logY(Q1, 1.5), logY(Q1 + side * W, 1.5));
  for (int i = 1; i <= 16; i++) {
    float d = float(i) * H;
    if (d > reach) break;
    vec2 Q = P + up * d;
    vec2 Q2 = Q + up * H;
    vec3 y2 = vec3(logY(Q2 - side * W, 1.5), logY(Q2, 1.5), logY(Q2 + side * W, 1.5));
    vec3 g = abs(y2 - y0);
    float gu = min(g.x, min(g.y, g.z));
    float gs = abs(logY(Q + side * H, 1.5) - logY(Q - side * H, 1.5));
    float ledge = smoothstep(0.18, 0.45, gu) * smoothstep(0.5, 0.8, gu / (gu + gs + 1e-3));
    s = max(s, ledge * (1.0 - smoothstep(0.4 * reach, reach, d)));
    y0 = y1;
    y1 = y2;
  }
  return s;
}
// Patches: the wash's own unevenness (two octaves of noise at the scale of a
// few hand-widths) and the wall's own stains and repairs, read off the plate
// as how much lighter or darker it is than its surround.
float mottleAt(vec2 P) {
  float n = vnoise(P / 46.0) * 0.6 + vnoise(P / 17.0 + 13.1) * 0.28 + vnoise(P / 7.0 + 41.7) * 0.12 - 0.5;
  float own = clamp((logY(P, 2.5) - logY(P, 5.0)) * 1.4, -0.5, 0.5);
  return clamp(n * 2.4 + own * 0.8, -1.0, 1.0);
}
// The sky through a polariser. Clouds are near neutral, so the share of the
// clear sky's blue chroma (b - r) a pixel still holds is how much of it is
// clear sky; the rest is cloud, whose own light is what is left over. The
// plate's chroma is stored at half resolution in 8x8 blocks, so it is read
// soft, and the detail (a filament finer than that) comes from luminance,
// which the plate keeps sharp: brighter than its surround is more cloud.
// The soft read is of the sky alone (uSkyPlate is the plate premultiplied by
// the sky mask), so a wall beside it never bleeds in as a pale rim.
vec3 polarise(vec3 lin, vec2 uv) {
  vec4 sp = textureLod(uSkyPlate, uv, 2.5);
  vec3 soft = sp.a > 0.02 ? toLin(sp.rgb / sp.a) : lin;
  float cc = max(uClear.b - uClear.r, 1e-3);
  float yc = dot(uClear, LUMA);
  float cloud = 1.0 - clamp((soft.b - soft.r) / cc, 0.0, 1.0);
  cloud = clamp(cloud + (dot(lin, LUMA) - dot(soft, LUMA)) / max(0.9 - yc, 0.1), 0.0, 1.0);
  float clear = 1.0 - cloud;
  // the cloud's own light: the pixel minus the clear sky it sits in
  vec3 cl = max(lin - clear * uClear, 0.0) / max(cloud, 0.04);
  float cy = dot(cl, LUMA);
  // tops roll softly under paper white instead of lifting into it
  float cy2 = cy * 1.08 / (1.0 + 0.08 * cy);
  vec3 cw = cl * (cy2 / max(cy, 1e-4));
  // radial depth: the zenith sits at the frame's centre
  vec2 d = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float r = length(d) / (0.5 * length(vec2(uRes.x / uRes.y, 1.0)));
  float t = smoothstep(0.05, 1.0, r);
  vec3 skyCol = mix(uZenith, uRim, t);
  // thin cloud and cloud shadow are lit by the sky around them: skylight blue
  float thin = 1.0 - smoothstep(0.25, 0.75, cy);
  cw = mix(cw, cw * normalize(skyCol + 0.25) * 1.73, 0.35 * thin);
  // the clear part, its haze cut; the cloud mixes in over it
  float a = smoothstep(0.0, 1.0, cloud);
  return mix(skyCol, cw, a);
}
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 lin = toLin(texture(uPlate, uv).rgb);
  vec4 m = texture(uMat, uv);
  vec3 L = texture(uLight, uv).rgb;
  float dose = L.r * 2.0;
  float S = max(L.g * L.g * 1.5, 0.02);
  if (uDebug > 0.5 && uDebug < 1.5) {
    outColor = vec4(toSrgb(vec3(dose * 0.5) * vec3(1.0, 0.97, 0.9)), 1.0);
    return;
  }
  // the dose at the scale of a ledge: sheltered strips under every sill and
  // cornice keep their paint; the open wall fades in patches
  vec2 P = uv * uPlateSize;
  float mot = 0.0;
  float local = 1.0;
  if (m.a > 0.01) {
    mot = mottleAt(P);
    local = exp(uMottle * mot) * (1.0 - uShelter * shelterAt(P));
  }
  if (uDebug > 1.5) {
    outColor = vec4(toSrgb(vec3(dose * m.a * local * 0.5) * vec3(1.0, 0.97, 0.9)), 1.0);
    return;
  }
  // effective dose after induction, with a soft knee (softplus)
  float e0 = uYears * dose * m.a * local;
  float e = uInduction * log(1.0 + exp(e0 / uInduction - 1.0)) - uInduction * log(1.0 + exp(-1.0));
  e = max(e, 0.0);

  // albedo and optical density per channel
  vec3 a = clamp(lin / S, 0.004, 1.0);
  vec3 dens = -log(a) / LN10;
  float k = min(min(dens.r, dens.g), dens.b) * 0.9;
  vec3 cmy = dens - k;
  // dye loss: each ink by its own rate; carbon black barely moves
  // no coat gives up all its colour, and a thick one (a patch that weathers
  // slower) holds a good part of it
  float keep = mix(0.25, 0.92, smoothstep(-0.7, 0.7, mot));
  vec3 lost = cmy * keep * (1.0 - exp(-uKInk * e)) + k * (1.0 - exp(-uKBlack * e));
  // what the pigment leaves behind is the lime render's own warm off-white,
  // not paper white: a fading colour climbs to it and stops (a surface that
  // is already lighter, like the white trim, keeps its own albedo)
  vec3 aInk = min(a * exp(lost * LN10), max(a, uBase));

  // wood: lignin goes, cellulose stays: silver grey, a touch lighter
  float y = dot(a, LUMA);
  vec3 silver = vec3(y * 1.15 + 0.045) * vec3(1.01, 1.0, 0.97);
  vec3 aWood = mix(a, silver, 0.8 * (1.0 - exp(-uKWood * e)));

  vec3 aged = a + m.r * (aInk - a) + m.g * (aWood - a);
  // chalk: the binder erodes and the white pigment powders the surface
  float ec = max(e0 - uChalkInduction, 0.0);
  // to the lime's own warm cream, in patches, the bloom heavier where the
  // wash was thin
  float c = m.b * uChalkMax * (1.0 - exp(-uKChalk * ec)) * (1.0 + 0.8 * mot);
  aged = mix(aged, max(aged, uBase * min(0.55 + 0.45 * dot(aged, LUMA) / 0.6, 1.0)), c);

  vec3 outLin = max(lin + S * (aged - a), 0.0);
  // the sky is inert to the clock (A = 0), so its grade is the same every year
  float sky = skyMask(m, lin) * uPolar;
  if (sky > 0.001) outLin = mix(outLin, polarise(lin, uv), sky);
  // triangular dither over the graded sky, so its gradient never bands in the
  // 8-bit scene target
  float n = hash12(gl_FragCoord.xy) + hash12(gl_FragCoord.yx + 7.3) - 1.0;
  outColor = vec4(toSrgb(outLin) + n * sky / 255.0, 1.0);
}`;

// The plate premultiplied by the sky mask, mipmapped once at load, so the
// polariser can read the sky's own soft colour beside the eaves.
const SKY_PREMUL = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPlate;
uniform sampler2D uMat;
vec3 toLin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
void main() {
  vec3 c = texture(uPlate, vUv).rgb;
  vec3 lin = toLin(c);
  vec4 m = texture(uMat, vUv);
  float w = clamp(1.0 - (2.0 * m.r - m.b / 0.85), 0.0, 1.0) * smoothstep(-0.03, 0.01, (lin.b - lin.r) / max(lin.b, 1e-3));
  outColor = vec4(c * w, w);
}`;

const BLIT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform sampler2D uMat;
uniform float uFade;
uniform vec3 uPaper;
uniform vec3 uToe;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  // the scan's lifted black, taken back out over the sky alone
  vec4 m = texture(uMat, vec2(vUv.x, 1.0 - vUv.y));
  float sky = clamp(1.0 - (2.0 * m.r - m.b / 0.85), 0.0, 1.0);
  vec3 toe = uToe * sky;
  c = max((c - toe) / (1.0 - toe), 0.0);
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

function target(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
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

export async function createFade(host, { embedded = false } = {}) {
  const q = new URLSearchParams(window.location.search);
  const yearsQ = num(q, "years");
  const held = yearsQ != null;
  const still = held || q.get("still") === "1";
  const raw = q.get("film") === "0";
  const debugQ = q.get("debug");
  const debugDose = debugQ === "dose" || debugQ === "local";
  const polar = q.get("sky") === "0" ? 0 : 1;
  const zenith = hsvLin(SKY_ZENITH);
  const rim = hsvLin(SKY_RIM);
  const clearSky = hsvLin(SKY_CLEAR);
  const render = hsvLin(RENDER);
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const stage = createStage(host, { webgl: true, dpr: 2, antialias: false });
  const gl = stage.ctx;
  if (!gl) throw new Error("webgl2 unavailable");

  const [plateImg, matImg, lightImg] = await Promise.all(["plate.webp", "mat.webp", "light.webp"].map((f) => loadImage(BASE + f)));
  const plate = imageTexture(gl, plateImg, true);
  const mat = imageTexture(gl, matImg, true);
  const light = imageTexture(gl, lightImg, false);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const P = { age: program(gl, VERT, AGE), blit: program(gl, VERT, BLIT), premul: program(gl, VERT, SKY_PREMUL) };

  // the sky-only plate, once: render, then mipmap
  const skyPlate = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, skyPlate);
  gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(PW, PH))) + 1, gl.RGBA8, PW, PH);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, skyPlate, 0);
    gl.viewport(0, 0, PW, PH);
    gl.disable(gl.BLEND);
    gl.useProgram(P.premul.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, plate);
    gl.uniform1i(P.premul.u.uPlate, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, mat);
    gl.uniform1i(P.premul.u.uMat, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.bindTexture(gl.TEXTURE_2D, skyPlate);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
  const film = createFilm(gl, { width: 2, height: 2 });

  // The print: 4:3, alone on the paper, as large as the box allows.
  const L = { x: 0, y: 0, w: 1, h: 1, pw: 2, ph: 2 };
  const T = { scene: null, film: null };
  let dirty = true;
  const layout = (W, H, dpr) => {
    const ar = PW / PH;
    if (embedded) {
      const h = H;
      const w = h * ar;
      Object.assign(L, { w, h, x: (W - w) / 2, y: 0 });
    } else if (W / H < 0.9) {
      const side = Math.max(16, Math.round(W * 0.06));
      const w = Math.min(W - side * 2, H * 0.84 * ar);
      const h = w / ar;
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 });
    } else {
      const top = Math.max(24, H * 0.07);
      const h = Math.min(H - top * 2, (W - 48) / ar);
      const w = h * ar;
      Object.assign(L, { w, h, x: (W - w) / 2, y: (H - h) / 2 });
    }
    L.x = Math.round(L.x * dpr) / dpr;
    L.y = Math.round(L.y * dpr) / dpr;
    L.pw = Math.max(2, Math.round(L.w * dpr));
    L.ph = Math.max(2, Math.round(L.h * dpr));
    Object.values(T).forEach((t) => freeTarget(gl, t));
    T.scene = target(gl, L.pw, L.ph);
    T.film = target(gl, L.pw, L.ph);
    film.resize(L.pw, L.ph);
    dirty = true;
  };
  stage.onResize((w, h, dpr) => layout(w, h, dpr));

  const bindTex = (unit, tex, loc) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  };

  // The clock: a goal the hand sets 1:1, and the shown years following it on
  // a critically-damped-ish spring. Release carries the hand's velocity.
  let goal = held ? clamp(yearsQ, 0, YEARS) : 0;
  let years = goal;
  let yearsV = 0;
  let goalV = 0;
  let dragging = false;
  let dragX = 0;
  let dragGoal = 0;
  let touched = held;
  let seed = 0;
  const span = () => Math.max(L.w * 1.6, Math.min(stage.width * 0.7, 900));

  stage.on("down", (p) => {
    dragging = true;
    touched = true;
    dragX = p.x;
    dragGoal = goal;
    goalV = 0;
    host.dataset.dragging = "";
  });
  stage.on("move", (p) => {
    if (!dragging) return;
    let g = dragGoal + ((p.x - dragX) / span()) * YEARS;
    const band = (o) => 2.4 * (1 - Math.exp((-0.4 * o) / 2.4));
    if (g < 0) g = -band(-g);
    if (g > YEARS) g = YEARS + band(g - YEARS);
    goal = g;
  });
  stage.on("up", (p) => {
    if (!dragging) return;
    dragging = false;
    delete host.dataset.dragging;
    goalV = clamp((p.vx / span()) * YEARS, -60, 60);
  });

  host.tabIndex = embedded ? -1 : 0;
  const onKey = (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    touched = true;
    goal = clamp(goal + d * (e.shiftKey ? 5 : 1), 0, YEARS);
  };
  host.addEventListener("keydown", onKey);

  const draw = (expoStops, fade) => {
    gl.bindVertexArray(vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.DEPTH_TEST);

    const u = P.age.u;
    gl.useProgram(P.age.p);
    bindTex(0, plate, u.uPlate);
    bindTex(1, mat, u.uMat);
    bindTex(2, light, u.uLight);
    bindTex(3, skyPlate, u.uSkyPlate);
    gl.uniform1f(u.uYears, clamp(years, 0, YEARS + 2));
    gl.uniform3fv(u.uKInk, K_INK);
    gl.uniform1f(u.uKBlack, K_BLACK);
    gl.uniform1f(u.uKWood, K_WOOD);
    gl.uniform1f(u.uKChalk, K_CHALK);
    gl.uniform1f(u.uChalkMax, CHALK_MAX);
    gl.uniform1f(u.uInduction, INDUCTION);
    gl.uniform1f(u.uChalkInduction, CHALK_INDUCTION);
    gl.uniform3fv(u.uBase, render);
    gl.uniform2f(u.uPlateSize, PW, PH);
    gl.uniform2f(u.uVanish, VANISH[0], VANISH[1]);
    gl.uniform1f(u.uShelter, SHELTER);
    gl.uniform1f(u.uMottle, MOTTLE);
    gl.uniform1f(u.uDebug, debugQ === "local" ? 2 : debugDose ? 1 : 0);
    gl.uniform1f(u.uPolar, polar);
    gl.uniform3fv(u.uZenith, zenith);
    gl.uniform3fv(u.uRim, rim);
    gl.uniform3fv(u.uClear, clearSky);
    gl.uniform2f(u.uRes, T.scene.w, T.scene.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.scene.fbo);
    gl.viewport(0, 0, T.scene.w, T.scene.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!raw && !debugDose) {
      film.render(
        T.scene.tex,
        {
          ...FILM_PRESETS.summer,
          exposure: 0.12 + expoStops,
          headroom: 0.6,
          halation: 0.22,
          bloom: 0.2,
          softness: 0.5,
          contrast: 1.06,
          toe: FILM_TOE,
          saturation: 1.02,
          blueDepth: 0.4,
          shadowTint: [0.95, 1, 1.05],
          highlightTint: [1.0, 1, 0.99],
          vignette: 0.18,
          whitePoint: 1.2,
          grain: 0.32,
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
    bindTex(0, raw || debugDose ? T.scene.tex : T.film.tex, P.blit.u.uTex);
    gl.uniform1f(P.blit.u.uFade, fade);
    gl.uniform3fv(P.blit.u.uPaper, PAPER);
    bindTex(1, mat, P.blit.u.uMat);
    const toe = raw || debugDose || !polar ? 0 : FILM_TOE;
    gl.uniform3f(P.blit.u.uToe, toe * FILM_TOE_COLOR[0], toe * FILM_TOE_COLOR[1], toe * FILM_TOE_COLOR[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  // Reveal: the print opens overexposed, an airy white-blue, and settles to
  // exposure; then the clock eases a few years forward to show it can move.
  const REVEAL = 2.0;
  const WALK_AT = 1.5;
  const WALK = 2.4;
  let t0 = -1;
  let grainClock = 0;

  stage.onFrame((dt) => {
    if (!T.scene) return;
    const now = performance.now() / 1000;
    if (t0 < 0) t0 = now;
    const age = still ? 99 : now - t0;
    let expo = 0;
    let fade = 1;
    if (!still) {
      if (reduce) fade = clamp(age / 0.3, 0, 1);
      else {
        expo = 2.2 * (1 - expoOut(clamp(age / REVEAL, 0, 1)));
        fade = clamp(age / 0.25, 0, 1);
      }
    }

    if (!held && !touched) {
      goal = reduce ? 0 : OPEN_AT * expoOut(clamp((age - WALK_AT) / WALK, 0, 1));
    } else if (!held && !dragging) {
      if (Math.abs(goalV) > 1e-3) {
        goal += goalV * dt;
        goalV *= Math.exp(-dt / 0.22);
      }
      if (goal < 0) goal += (0 - goal) * (1 - Math.exp(-dt * 14));
      if (goal > YEARS) goal += (YEARS - goal) * (1 - Math.exp(-dt * 14));
    }

    let moving = false;
    if (held) years = goal;
    else {
      const w = 14;
      const z = 0.86;
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const a = w * w * (goal - years) - 2 * z * w * yearsV;
        yearsV += a * h;
        years += yearsV * h;
      }
      moving = Math.abs(goal - years) > 1e-3 || Math.abs(yearsV) > 1e-3;
      if (!moving) {
        years = goal;
        yearsV = 0;
      }
    }

    let tick = false;
    if (!reduce && !held) {
      grainClock += dt;
      if (grainClock >= 1 / 24) {
        grainClock %= 1 / 24;
        seed = (seed + 1) % 997;
        tick = true;
      }
    }
    const revealing = !still && age < REVEAL + 0.1;
    if (!dirty && !moving && !tick && !revealing) return;
    dirty = false;
    draw(expo, fade);
  });

  return {
    destroy() {
      host.removeEventListener("keydown", onKey);
      film.destroy();
      Object.values(T).forEach((t) => freeTarget(gl, t));
      [plate, mat, light, skyPlate].forEach((t) => gl.deleteTexture(t));
      Object.values(P).forEach((p) => gl.deleteProgram(p.p));
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
