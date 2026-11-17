import { createStage, clamp } from "../_kit/stage";

// Overexpose. One linear HDR frame (a worm's-eye stereographic view of a Poly
// Haven HDRI, looking up through the pines; log-encoded so the radiance is
// real) developed live through a colour negative. Exposure is scene-referred:
// the sky, cloud and needle radiance is multiplied by 2^EV before anything
// else touches it, and only then meets the film. Each layer of the negative
// has its own characteristic curve in log exposure (a toe, a straight section
// up to about grey, then a long soft logarithmic shoulder, the blue record's
// placed so that on the print blue is the last channel to reach the paper's
// warm white), then a fixed printer light and the print paper's S-curve. Drag
// up and the exposure rises to +3 stops: the cobalt thins to a pale white-blue,
// the cumulus climb the shoulder towards cream and keep their edges, the
// shadows open, and nothing reaches 255.
//
// The optics (Pro-Mist diffusion and base-reflection halation) are blurs of the
// same radiance, baked once offline and shipped beside it. They are scaled by
// the same 2^EV, and each also has a part driven by the highlight energy
// above a knee, so the veil and the red halation ring grow faster than the
// exposure as the clouds and sky climb into the shoulder.
//
// The grade is written inside this piece rather than through _kit/film.js:
// film.js develops with one display curve for all channels, and this piece is
// about the negative + print pair itself. The parameter names (exposure,
// halation, halationColor, bloom, grain, grainSeed) match film.js.

const LO = -8.5; // log2 radiance range of the shipped encoding (see experiment.json)
const HI = 2.5;
const MIN_EV = -1;
const MAX_EV = 3;
const STOP = 0.225; // fraction of the print's height that is one stop of drag

export const FILM = {
  exposure: 0,
  norm: 0.92, // scene radiance to film exposure at 0 EV (metered for the sky)
  // The negative, per layer (red / green / blue records): density rises at
  // negGamma per log10 H from a soft toe negToe stops under grey, straight up to
  // shoulderX stops over grey, and past it the log exposure is bent onto a long
  // soft shoulder, x -> xs + w ln(1 + (x - xs) / w), so the slope halves w
  // stops in and never reaches zero: four stops over the knee still separate.
  // The blue record bends first, so on the print blue is the last channel to
  // reach the paper white and a bright neutral drifts warm-neutral (cream),
  // never flat white; green close behind it, so the lifted sky keeps its hue
  // instead of sliding to cyan as its blue compresses.
  negGamma: [0.445, 0.46, 0.49],
  negToe: -4.5,
  shoulderX: [0.6, 0.15, 0.0],
  shoulderW: 2.35,
  printComp: 0.15, // how much of the overexposure the printer light takes back
  paperGamma: 3.35,
  paperDmin: [0.042, 0.044, 0.052], // paper white, a touch warm: never 255
  paperDmax: [1.9, 1.8, 1.75], // the scanned black, lifted and cyan
  // The paper's dense end, past the midtones and the sky: the canopy (canopy.py)
  // is a near-black silhouette at 0 EV, about #141a18, and the scanned black above
  // would have lifted it to a muddy rgb(34,38,39). Past shadowX[0] on the paper's
  // logistic (the cobalt zenith's red sits at ~1.2, the needles at 2-5) each layer
  // takes up to shadowExt more density, easing in over shadowX[1].
  shadowExt: [0.36, 0.29, 0.34],
  shadowX: [1.6, 1.5],
  printGrey: 0.25,
  // Scan: summer sky leans cobalt (blueHue, and blueDepth more saturation on
  // blue). As the print's brightest channel climbs from blueFade[0] to
  // blueFade[1] the lean eases to blueHueHi and blueFadeK of the extra depth
  // goes, so a lifted sky thins to a white-blue at its own hue (~210) instead
  // of being pumped back to a saturated cyan.
  saturation: 1.15,
  blueDepth: 1.55,
  blueHue: [0.76, 0.85, 1.0],
  blueHueHi: [0.9, 0.9, 1.0],
  blueFade: [0.4, 0.8],
  blueFadeK: 0.65,
  hiDesat: 0.45,
  skyQ: [0.6, 1.5], // log2 blue/red of the scene where sky starts and is full
  // The normal print's open sky is lifted towards a luminous cobalt (zenith about
  // rgb(30,100,160) at 0 EV, hue ~208) rather than the dense navy the polarised dome
  // gives a straight print: the sky takes skyLift[0] more stops at 0 EV, easing out as
  // (1 - ev / skyLift[2]) ^ skyLift[1], so the sky still rises monotonically with the
  // drag and from skyLift[2] up the print is exactly the straight one. The lift is
  // added as light, the sky's share of the pixel (scene alpha) times the open-sky
  // field under it (sky.png, skyfield.py), so a cloud's thin edge, part sky, takes
  // the sky's part of the lift and never prints darker than the sky beside it.
  // The added light leans skyLiftTint (a touch of green), so the luminous sky
  // holds the hue a bright print gives it (~208) rather than the dense dome's 211.
  skyLift: [1.15, 1.5, 2],
  skyLiftTint: [1.0, 1.15, 1.0],
  // The paper white is approached per channel on a soft knee (from paperKnee of
  // it), never by scaling all three down together, so the brightest cloud
  // still has a channel with gradation in it and the sky's red keeps climbing.
  paperKnee: 0.85,
  hiWarm: 0.025,
  // The cumulus' sunlit tops roll off warm-neutral on the shoulder (towards
  // #fff6ea), not the scan's grey-white: on the bake's cloud share (alpha) and
  // off the sky, a highlight takes cloudWarm more red than blue before the
  // paper-white cap, which keeps it under 255 at every exposure (clouds.py).
  cloudWarm: 0.08,
  cloudWarmHue: [1.0, 0.45, -0.45],
  // The softness belongs to the sky. At low exposure the needles (keyed on the
  // scene's luminance, needleY) take only 1 - needleBloomCap of the Pro-Mist veil
  // and 1 - needleHalCap of the halation, and are sampled from the full-size
  // scene rather than the blurrier mip, so the silhouette stays crisp against
  // a diffused sky. The caps ease off by needleCapEV, where the overexposure
  // is meant to lift and soften the shadows.
  needleY: [0.02, 0.06],
  needleBloomCap: 0.85,
  needleHalCap: 0.6,
  needleCapEV: 2,
  // The pines are their own layer (foliage.py): the needles' own radiance on the
  // photograph's own sub-pixel coverage, laid over the sky after the Pro-Mist and
  // the halation, so no glow washes blue into the foliage and the sky shows only
  // through real gaps and thin sprays. At 0 EV the ink takes inkVeil of the veil
  // and inkHal of the halation; both ease up to the full amounts by needleCapEV,
  // where the overexposure is meant to lift and soften the shadows.
  inkVeil: 0,
  inkHal: 0.1,
  bloom: 0.08,
  halation: 0.15,
  halationColor: [1.0, 0.3, 0.08],
  // Highlight energy: the part of the exposed light above a soft knee (in
  // scene radiance after 2^EV; the cumulus' tops sit near 1.5 at 0 EV) spreads
  // further. bloomHi of the diffused light's excess is added as veil, halHi of
  // the halation source's excess over the pixel's own lands as the red ring.
  // At 0 EV almost nothing is over the knee; at +3 the banks are 8x over it.
  bloomHi: 0.05,
  bloomKnee: 1.5,
  inkHi: 0.4, // the crowns' share of that highlight veil, so they stay dense
  halHi: 0.035,
  halKnee: 2.0,
  grain: 0.03,
  grainSeed: 0,
};

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

const DECODE_FS = `#version 300 es
precision highp float;
uniform sampler2D uLog; uniform vec2 uSize;
out vec4 o;
void main(){
  vec4 c = texelFetch(uLog, ivec2(gl_FragCoord.xy), 0);
  o = vec4(exp2(c.rgb * ${(HI - LO).toFixed(4)} + ${LO.toFixed(4)}), c.a); // alpha: 1 - cloud share
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uScene;   // linear radiance (or log-encoded when uLogIn)
uniform sampler2D uOptics;  // left half: diffusion, right half: halation source
uniform sampler2D uTrees;   // the pines: rgb log radiance of the ink, alpha its matte
uniform sampler2D uSky;     // the open sky's own field (dome + aureole), log radiance
uniform vec2 uInk;          // the ink's share of the veil and of the halation
uniform float uInkHi;       // and of the highlight veil
uniform float uLogIn;
uniform vec4 uRect;         // square in device px: x, y, size, size
uniform float uExp;         // norm * 2^ev: scene radiance to film exposure
uniform vec3 uGamma; uniform vec3 uKnee; uniform float uKneeW; uniform float uToe;
uniform vec3 uGref;         // negative density of the printer-light grey
uniform vec3 uPk; uniform vec3 uPx0; uniform vec3 uDmin; uniform vec3 uDmax; uniform vec3 uShExt; uniform vec2 uShX;
uniform vec2 uNeedleY; uniform vec2 uNeedleCap; // luminance key; bloom and halation caps, already scaled by exposure
uniform float uLod;         // mip level the print is minified to
uniform float uSat; uniform float uBlueSat; uniform vec3 uBlueHue; uniform vec3 uBlueHueHi; uniform vec3 uBlueFade; uniform float uHiDesat; uniform float uHiWarm; uniform float uCloudWarm; uniform vec3 uCloudWarmHue;
uniform vec2 uSkyQ; uniform float uPaperKnee; uniform float uSkyLift; uniform vec3 uSkyLiftTint;
uniform float uBloom; uniform float uHal; uniform vec3 uHalColor;
uniform vec2 uBloomHi; uniform vec2 uHalHi; // amount, knee (scene radiance after 2^EV)
uniform float uGrain; uniform float uSeed; uniform float uGrainPx;
out vec4 o;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const mat3 XT = mat3(0.92, 0.04, 0.01,  0.07, 0.90, 0.07,  0.01, 0.06, 0.92); // layer cross-talk (columns)

vec3 dec(vec3 c){ return exp2(c * ${(HI - LO).toFixed(4)} + ${LO.toFixed(4)}); }
vec3 softplus(vec3 x, float k){ return log(1.0 + exp(-abs(x * k))) / k + max(x, 0.0); }
// Each layer's characteristic curve: toe, straight section, and past uKnee a
// long soft shoulder that bends the log exposure, xs + w ln(1 + (x - xs) / w).
vec3 negD(vec3 stops){
  vec3 u = softplus(stops - uKnee, 2.0);
  vec3 x = stops - u + uKneeW * log(1.0 + u / uKneeW);
  return uGamma * 0.30103 * softplus(x - uToe, 1.2);
}
// The exposed light above a soft knee: what spreads further as it overexposes.
vec3 hiE(vec3 x, float k){ return softplus((x - k) / k, 2.0) * k; }
float hiE(float x, float k){ return hiE(vec3(x), k).x; }
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
vec3 srgb(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

void main(){
  vec2 p = (gl_FragCoord.xy - uRect.xy) / uRect.zw;
  vec2 uv = vec2(p.x, 1.0 - p.y); // textures are uploaded top row first
  vec4 sc = texture(uScene, uv);
  // the needles and the cumulus are read from the full-size scene, the open sky from
  // the minified one: the cloud plate carries the photograph's own turret edges and
  // rims (cumulus.py), and the Pro-Mist veil below is the only softening it gets
  vec4 sc0 = textureLod(uScene, uv, 0.0);
  vec3 L0 = uLogIn > 0.5 ? dec(sc0.rgb) : sc0.rgb;
  float needle = 1.0 - smoothstep(log2(uNeedleY.x), log2(uNeedleY.y), log2(max(dot(L0, LUMA), 1e-6)));
  float cloud0 = smoothstep(0.0, 0.25, 1.0 - clamp((sc0.a * 255.0 - 3.0) / 252.0, 0.0, 1.0));
  sc = mix(sc, sc0, max(needle, cloud0) * step(0.01, uLod));
  // Exposure is a multiply on the scene's linear radiance, before anything else:
  // the sky, the cloud, the needles and the optics' blurs of them alike.
  vec3 L = uLogIn > 0.5 ? dec(sc.rgb) : sc.rgb;
  // The low-exposure sky lift, added as light in the sky's share: open sky lifts its
  // own pixel (grain and all), a cloud's edge only the sky field under its sky share.
  float skyS = clamp((sc.a * 255.0 - 3.0) / 252.0, 0.0, 1.0);
  vec3 skyPart = mix(skyS * dec(texture(uSky, uv).rgb), L, smoothstep(0.95, 1.0, skyS));
  float lift = exp2(uSkyLift) - 1.0;
  L = (L + lift * uSkyLiftTint * skyPart) * uExp;
  float ex = uExp * (1.0 + lift * skyS); // for reading the sky back off the lifted light
  float hx = clamp(uv.x, 0.002, 0.998) * 0.5;
  vec3 D = dec(texture(uOptics, vec2(hx, uv.y)).rgb) * uExp;
  float Yb = dec(texture(uOptics, vec2(hx + 0.5, uv.y)).rgb).g * uExp;
  // Highlight energy of the spread light, over the knee.
  vec3 Dhi = hiE(D, uBloomHi.y) * uBloomHi.x;
  float Ybhi = hiE(Yb, uHalHi.y);

  // Pro-Mist: a fixed share of all light lands spread out, and the highlight
  // energy over the knee spreads on top of it.
  float wv = 1.0 - uNeedleCap.x * needle;
  L = mix(L, D, uBloom * wv) + Dhi * wv;
  // Halation: light bounced off the base comes back through the red layer,
  // landing just outside bright areas (a ring, not a fill); its highlight part
  // grows with the energy over the knee.
  float Yl = dot(L, LUMA);
  L += uHalColor * (max(Yb - Yl, 0.0) * uHal + max(Ybhi - hiE(Yl, uHalHi.y), 0.0) * uHalHi.x) * (1.0 - uNeedleCap.y * needle);
  // The pines (foliage.py): the needles' own radiance on the photograph's own
  // sub-pixel coverage, composited over the diffused sky.
  vec4 tr = texture(uTrees, uv);
  vec3 ink = dec(tr.rgb) * uExp;
  ink = mix(ink, D, uBloom * uInk.x) + Dhi * uInk.x * uInkHi;
  float Yi = dot(ink, LUMA);
  ink += uHalColor * (max(Yb - Yi, 0.0) * uHal + max(Ybhi - hiE(Yi, uHalHi.y), 0.0) * uHalHi.x) * uInk.y;
  L = mix(L, ink, tr.a);

  // Negative: each layer on its own characteristic curve.
  vec3 H = XT * L;
  vec3 d = negD(log2(max(H, 1e-6) / 0.18));
  // Print: fixed printer light, then the paper's own S-curve.
  vec3 lp = -(d - uGref);
  vec3 px = uPk * lp + uPx0;
  vec3 dens = uDmin + (uDmax - uDmin) / (1.0 + exp(-px));
  vec3 xs = px - uShX.x;
  vec3 sp = log(1.0 + exp(-abs(xs * 4.0))) / 4.0 + max(xs, 0.0);
  dens += uShExt * (1.0 - exp(-sp / uShX.y));
  vec3 c = pow(vec3(10.0), -dens);

  // Scan: summer sky leans cobalt, colour sits in the midtones and bleaches
  // (a little warm) in the highlights. Saturation is a power on the channel
  // ratios, so no channel is ever pushed through zero.
  // Sky is read from the scene's own blue-over-red ratio, which no exposure
  // changes (and bright: a blue-black needle shadow is not sky).
  vec3 Ls = L / ex;
  float sky = smoothstep(uSkyQ.x, uSkyQ.y, log2(max(Ls.b, 1e-6) / max(Ls.r, 1e-6))) * smoothstep(0.02, 0.07, dot(Ls, LUMA));
  float blue = max(clamp((c.b - c.r) / (c.b + 1e-4), 0.0, 1.0), sky);
  // the cobalt lean eases as the print's brightest channel climbs: the red
  // comes back first, so a lifted sky whitens at its own hue, not towards cyan
  float hiB = smoothstep(uBlueFade.x, uBlueFade.y, max(c.r, max(c.g, c.b)));
  c *= 1.0 + (mix(uBlueHue, uBlueHueHi, hiB) - 1.0) * blue * blue;
  float blueS = blue * (1.0 - uBlueFade.z * hiB);
  float y = dot(c, LUMA);
  float hi = clamp((y - 0.45) / 0.4, 0.0, 1.0);
  float s = uSat * (1.0 - uHiDesat * hi) * (1.0 + (uBlueSat - 1.0) * blueS);
  vec3 r = max(c, 1e-5) / max(y, 1e-5);
  c = y * pow(r, vec3(s));
  c *= y / max(dot(c, LUMA), 1e-6);
  float cloud = 1.0 - clamp((sc.a * 255.0 - 3.0) / 252.0, 0.0, 1.0);
  c *= 1.0 + uCloudWarm * hi * cloud * (1.0 - sky) * uCloudWarmHue;
  // Never past the paper's own white: each channel eases onto it from uPaperKnee
  // of the way up, so a highlight keeps gradation in whatever channel is lowest.
  vec3 white = pow(vec3(10.0), -uDmin);
  vec3 t = c / white;
  float kn = uPaperKnee;
  t = mix(t, kn + (1.0 - kn) * (1.0 - exp(-(t - kn) / (1.0 - kn))), step(kn, t));
  c = t * white;
  c *= 1.0 + uHiWarm * hi * vec3(1.0, 0.3, -0.6);
  vec3 outc = srgb(c);

  // Grain after the curve, strongest in the mids; dither last.
  vec2 gp = gl_FragCoord.xy / uGrainPx + uSeed * vec2(17.13, 31.71);
  float g = vnoise(gp) * 0.65 + vnoise(gp * 2.13 + 7.7) * 0.35 - 0.5;
  vec3 gc = vec3(vnoise(gp + 41.0), vnoise(gp + 83.0), vnoise(gp + 127.0)) - 0.5;
  float ly = dot(outc, LUMA);
  outc += (vec3(g) + gc * 0.25) * uGrain * 4.0 * ly * (1.0 - ly) * 2.0;
  outc += (hash(gl_FragCoord.xy + uSeed) + hash(gl_FragCoord.yx + 3.1 + uSeed) - 1.0) / 255.0;
  o = vec4(clamp(outc, 0.0, 1.0), 1.0);
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

async function bitmap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  // Data, not a picture: no colour management, no premultiply.
  return createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

function upload(gl, img, mips) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
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

// The negative's density at a given exposure (stops from grey), per layer.
const softplus = (x, k) => Math.log1p(Math.exp(-Math.abs(x * k))) / k + Math.max(x, 0);
function negD(stops, c, F) {
  const u = softplus(stops - F.shoulderX[c], 2);
  const x = stops - u + F.shoulderW * Math.log1p(u / F.shoulderW);
  return F.negGamma[c] * 0.30103 * softplus(x - F.negToe, 1.2);
}

const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Rubber band past the ends of the dial.
const rubber = (v, lo, hi) => {
  const band = (x) => (1 - 1 / (x * 0.45 + 1)) / 0.45 * 0.35;
  if (v > hi) return hi + band(v - hi);
  if (v < lo) return lo - band(lo - v);
  return v;
};
const unrubber = (v, lo, hi) => {
  const inv = (y) => {
    const t = (y / 0.35) * 0.45;
    return t >= 0.999 ? 1e3 : 1 / (1 - t) / 0.45 - 1 / 0.45;
  };
  if (v > hi) return hi + inv(v - hi);
  if (v < lo) return lo - inv(lo - v);
  return v;
};

export async function createOverexpose(host, { embedded = false } = {}) {
  const params = new URLSearchParams(window.location.search);
  const fixed = params.has("ev") ? clamp(parseFloat(params.get("ev")) || 0, MIN_EV, MAX_EV) : null;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const still = fixed != null || params.has("still");

  const [sceneImg, opticsImg, treesImg, skyImg] = await Promise.all([
    bitmap("/lab/overexpose/scene.webp"),
    bitmap("/lab/overexpose/optics.png"),
    bitmap("/lab/overexpose/trees.webp"),
    bitmap("/lab/overexpose/sky.png"),
  ]);

  // Warm white paper around the print, whatever the site theme.
  host.style.background = "#f2f0eb";
  const stage = createStage(host, { webgl: true, dpr: 2, alpha: true });
  const gl = stage.ctx;
  if (!gl) throw new Error("no webgl2");
  const canvas = stage.canvas;
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "slider");
  canvas.setAttribute("aria-label", "Exposure");
  canvas.setAttribute("aria-valuemin", String(MIN_EV));
  canvas.setAttribute("aria-valuemax", String(MAX_EV));
  canvas.style.outline = "none";

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const prog = compile(gl, VS, FS);
  const logTex = upload(gl, sceneImg, false);
  const opticsTex = upload(gl, opticsImg, false);
  const treesTex = upload(gl, treesImg, true);
  const skyTex = upload(gl, skyImg, false);

  // Decode the radiance once into a half-float texture so the minified print
  // averages light, not logarithms. Without a renderable float format, sample
  // the log texture directly.
  let sceneTex = logTex;
  let logIn = 1;
  if (gl.getExtension("EXT_color_buffer_float")) {
    const w = sceneImg.width;
    const h = sceneImg.height;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(w, h))) + 1, gl.RGBA16F, w, h);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
      const dprog = compile(gl, VS, DECODE_FS);
      gl.useProgram(dprog.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, logTex);
      gl.uniform1i(dprog.u.uLog, 0);
      gl.viewport(0, 0, w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.deleteProgram(dprog.p);
      sceneTex = t;
      logIn = 0;
    } else gl.deleteTexture(t);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
  }
  const sceneW = sceneImg.width;
  sceneImg.close?.();
  opticsImg.close?.();
  treesImg.close?.();
  skyImg.close?.();

  // Paper constants: grey lands on printGrey, slope paperGamma at the middle.
  const F = FILM;
  const pk = [0, 1, 2].map((c) => (4 * F.paperGamma) / (F.paperDmax[c] - F.paperDmin[c]));
  const px0 = [0, 1, 2].map((c) => {
    const t0 = (-Math.log10(F.printGrey) - F.paperDmin[c]) / (F.paperDmax[c] - F.paperDmin[c]);
    return Math.log(t0 / (1 - t0));
  });

  // The print: a square, as large as the box allows with room around it.
  const rect = { x: 0, y: 0, s: 1 };
  const layout = (w, h) => {
    const gutter = Math.max(16, w * 0.06);
    const s = Math.floor(Math.min(w - gutter * 2, h * 0.8, 1400));
    rect.s = s;
    rect.x = Math.round((w - s) / 2);
    rect.y = Math.round((h - s) / 2);
  };

  // Exposure: the value shown, its velocity, and where it is heading.
  // The hero is the normal exposure: the first frame is the deep cobalt print.
  const ev = { v: fixed ?? 0, vel: 0, target: fixed ?? 0, mode: "spring" };
  let reveal = fixed == null && !reduced ? { t: 0, delay: 0.7, rise: 0.9, fall: 1.6, peak: 4 / 3 } : null;
  let drag = null;
  let dirty = true;
  let grainT = 0;
  let seed = 3;

  const snap = (x) => clamp(Math.round(x * 3) / 3, MIN_EV, MAX_EV); // a dial in thirds

  const inside = (p, slop = 24) => p.x > rect.x - slop && p.x < rect.x + rect.s + slop && p.y > rect.y - slop && p.y < rect.y + rect.s + slop;

  stage.on("down", (p) => {
    if (!inside(p)) return;
    reveal = null;
    drag = { y: p.y, raw: unrubber(ev.v, MIN_EV, MAX_EV) };
    ev.vel = 0;
    canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (drag) {
      const raw = drag.raw + (drag.y - p.y) / (rect.s * STOP);
      ev.v = rubber(raw, MIN_EV, MAX_EV);
      ev.target = ev.v;
      dirty = true;
    } else canvas.style.cursor = inside(p, 0) ? "grab" : "";
  });
  stage.on("up", (p) => {
    if (!drag) return;
    drag = null;
    canvas.style.cursor = inside(p, 0) ? "grab" : "";
    // Carry the hand's speed a little way, then settle into the nearest third.
    const vel = -p.vy / (rect.s * STOP);
    ev.vel = clamp(vel, -12, 12);
    ev.target = snap(ev.v + ev.vel * 0.22);
    dirty = true;
  });

  let wheelTimer = 0;
  const onWheel = (e) => {
    e.preventDefault();
    reveal = null;
    ev.target = clamp(ev.target - e.deltaY * 0.004, MIN_EV - 0.2, MAX_EV + 0.2);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      ev.target = snap(ev.target);
    }, 160);
    dirty = true;
  };
  canvas.addEventListener("wheel", onWheel, { passive: false });
  const onKey = (e) => {
    const step = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    reveal = null;
    ev.target = snap(ev.target + step / 3);
    dirty = true;
  };
  canvas.addEventListener("keydown", onKey);

  stage.onResize((w, h) => {
    layout(w, h);
    dirty = true;
  });

  const draw = () => {
    const dpr = stage.dpr;
    const cw = canvas.width;
    const ch = canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const x = Math.round(rect.x * dpr);
    const s = Math.round(rect.s * dpr);
    const y = ch - Math.round(rect.y * dpr) - s;
    gl.viewport(x, y, s, s);
    gl.useProgram(prog.p);
    gl.bindVertexArray(vao);
    const u = prog.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.uniform1i(u.uScene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, opticsTex);
    gl.uniform1i(u.uOptics, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, treesTex);
    gl.uniform1i(u.uTrees, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, skyTex);
    gl.uniform1i(u.uSky, 3);
    gl.uniform1f(u.uLogIn, logIn);
    gl.uniform4f(u.uRect, x, y, s, s);
    const e = ev.v;
    gl.uniform1f(u.uExp, F.norm * 2 ** e);
    gl.uniform3fv(u.uGamma, F.negGamma);
    gl.uniform3fv(u.uKnee, F.shoulderX);
    gl.uniform1f(u.uKneeW, F.shoulderW);
    gl.uniform1f(u.uToe, F.negToe);
    // The printer light is set for a normal negative and only partly follows
    // the overexposure, which is what leaves the print light and airy.
    gl.uniform3f(u.uGref, negD(e * F.printComp, 0, F), negD(e * F.printComp, 1, F), negD(e * F.printComp, 2, F));
    gl.uniform3fv(u.uPk, pk);
    gl.uniform3fv(u.uPx0, px0);
    gl.uniform3fv(u.uDmin, F.paperDmin);
    gl.uniform3fv(u.uDmax, F.paperDmax);
    gl.uniform3fv(u.uShExt, F.shadowExt);
    gl.uniform2fv(u.uShX, F.shadowX);
    gl.uniform2fv(u.uNeedleY, F.needleY);
    const capK = 1 - smoothstep(0, F.needleCapEV, e);
    gl.uniform2f(u.uNeedleCap, F.needleBloomCap * capK, F.needleHalCap * capK);
    gl.uniform2f(u.uInk, 1 - (1 - F.inkVeil) * capK, 1 - (1 - F.inkHal) * capK);
    gl.uniform1f(u.uLod, logIn ? 0 : Math.max(0, Math.log2(sceneW / s)));
    gl.uniform1f(u.uSat, F.saturation);
    gl.uniform1f(u.uBlueSat, F.blueDepth);
    gl.uniform3fv(u.uBlueHue, F.blueHue);
    gl.uniform3fv(u.uBlueHueHi, F.blueHueHi);
    gl.uniform3f(u.uBlueFade, F.blueFade[0], F.blueFade[1], F.blueFadeK);
    gl.uniform1f(u.uHiDesat, F.hiDesat);
    gl.uniform1f(u.uHiWarm, F.hiWarm);
    gl.uniform1f(u.uCloudWarm, F.cloudWarm);
    gl.uniform3fv(u.uCloudWarmHue, F.cloudWarmHue);
    gl.uniform2fv(u.uSkyQ, F.skyQ);
    gl.uniform1f(u.uSkyLift, F.skyLift[0] * Math.max(0, 1 - Math.max(e, 0) / F.skyLift[2]) ** F.skyLift[1]);
    gl.uniform3fv(u.uSkyLiftTint, F.skyLiftTint);
    gl.uniform1f(u.uPaperKnee, F.paperKnee);
    gl.uniform1f(u.uBloom, F.bloom);
    gl.uniform1f(u.uHal, F.halation);
    gl.uniform3fv(u.uHalColor, F.halationColor);
    gl.uniform2f(u.uBloomHi, F.bloomHi, F.bloomKnee);
    gl.uniform1f(u.uInkHi, F.inkHi);
    gl.uniform2f(u.uHalHi, F.halHi, F.halKnee);
    gl.uniform1f(u.uGrain, F.grain);
    gl.uniform1f(u.uSeed, seed);
    // Grain clumps sized to the print, about 1/1000 of its side.
    gl.uniform1f(u.uGrainPx, Math.max(1, s / 1000));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    canvas.setAttribute("aria-valuenow", e.toFixed(2));
    canvas.setAttribute("aria-valuetext", `${e >= 0 ? "+" : "−"}${Math.abs(Math.round(e * 3) / 3).toFixed(1)} stops`);
  };

  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

  stage.onFrame((dt) => {
    if (reveal) {
      // Opens on the normal print, then shows the gesture once: the frame
      // blooms up the shoulder by a stop and a third and settles back.
      reveal.t += dt;
      const t = reveal.t - reveal.delay;
      ev.v = t <= 0 ? 0 : t < reveal.rise ? reveal.peak * easeInOut(t / reveal.rise) : reveal.peak * (1 - easeInOut(Math.min(1, (t - reveal.rise) / reveal.fall)));
      ev.vel = 0;
      if (t >= reveal.rise + reveal.fall) reveal = null;
      dirty = true;
    } else if (!drag) {
      // Spring to the target: damping ratio 0.85, settles in about half a second.
      const w = 11;
      const z = 0.85;
      const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        const a = -2 * z * w * ev.vel - w * w * (ev.v - ev.target);
        ev.vel += a * h;
        ev.v += ev.vel * h;
      }
      if (Math.abs(ev.v - ev.target) < 1e-4 && Math.abs(ev.vel) < 1e-3) {
        if (ev.v !== ev.target) dirty = true;
        ev.v = ev.target;
        ev.vel = 0;
      } else dirty = true;
    }
    // Grain moves at 24 fps, like a projected strip, never at 60.
    if (!still && !reduced) {
      grainT += dt;
      if (grainT >= 1 / 24) {
        grainT %= 1 / 24;
        seed = (seed + 1.618) % 997;
        dirty = true;
      }
    }
    if (dirty) {
      dirty = false;
      draw();
    }
  });
  void embedded;

  return {
    destroy() {
      clearTimeout(wheelTimer);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKey);
      gl.deleteTexture(logTex);
      if (sceneTex !== logTex) gl.deleteTexture(sceneTex);
      gl.deleteTexture(opticsTex);
      gl.deleteTexture(treesTex);
      gl.deleteTexture(skyTex);
      gl.deleteProgram(prog.p);
      gl.deleteBuffer(quad);
      gl.deleteVertexArray(vao);
      stage.destroy();
    },
  };
}
