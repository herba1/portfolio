export const PAPER_VERTEX_HEAD = `
attribute vec2 paper;
varying vec2 vPaper;
`;

export const PAPER_VERTEX_BODY = `
vPaper = paper;
`;

export const PAPER_FRAGMENT_HEAD = `
uniform sampler2D uAtlas;
uniform sampler2D uHeat;
uniform float uLead[64];
uniform float uTail[64];
uniform float uHasTail;
uniform float uSeed;
uniform float uFade;
uniform vec4 uRing;
uniform vec3 uHeatGrid;
varying vec2 vPaper;

float rHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float rNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = rHash(i);
  float b = rHash(i + vec2(1.0, 0.0));
  float c = rHash(i + vec2(0.0, 1.0));
  float d = rHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float edgeAt(float u, float lead) {
  float x = clamp(u, 0.0, 1.0) * 63.0;
  int i = int(min(floor(x), 62.0));
  float f = x - float(i);
  if (lead > 0.5) return mix(uLead[i], uLead[i + 1], f);
  return mix(uTail[i], uTail[i + 1], f);
}

float atlasInk(vec2 dots) {
  float t = mod(dots.y, uRing.x);
  float column = floor(t / uRing.y);
  float row = t - column * uRing.y;
  vec2 uv = vec2((column * uRing.z + clamp(dots.x, 0.5, uRing.z - 0.5)) / uRing.w, (row + 0.5) / uRing.y);
  return texture2D(uAtlas, uv).r;
}
`;

export const PAPER_FRAGMENT_BODY = `
float sigma = vPaper.y;
float uAcross = vPaper.x;
float lead = edgeAt(uAcross, 1.0);
float fringe = rHash(vec2(floor(uAcross * 520.0), floor(sigma * 9.0)) + uSeed);
float fromLead = sigma - lead;
if (fromLead < 0.0) discard;
if (fromLead < 0.32 && fringe > fromLead / 0.32) discard;
float fromTail = 1000.0;
if (uHasTail > 0.5) {
  fromTail = edgeAt(uAcross, 0.0) - sigma;
  if (fromTail < 0.0) discard;
  if (fromTail < 0.32 && fringe > fromTail / 0.32) discard;
}
if (uFade < 0.999 && rHash(gl_FragCoord.xy * 0.37 + uSeed) > uFade) discard;

vec2 mm = vec2(uAcross * 80.0, sigma);
float grain = rNoise(mm * vec2(3.1, 2.3)) * 0.6 + rNoise(mm * vec2(11.0, 7.0)) * 0.4;
float cloud = rNoise(mm * 0.11 + uSeed);
vec3 paperTone = vec3(0.958, 0.96, 0.952) * (0.985 + 0.02 * cloud) - grain * 0.012;
float torn = 1.0 - smoothstep(0.0, 0.7, min(fromLead, fromTail));
paperTone = mix(paperTone, vec3(0.985, 0.982, 0.97), torn * 0.6);

vec3 shade = paperTone;
if (gl_FrontFacing) {
  vec2 dots = vec2(uAcross * uRing.z, sigma * 5.0);
  float ink = atlasInk(dots);
  vec2 cell = fract(dots) - 0.5;
  float span = clamp(fwidth(dots.x) + fwidth(dots.y), 0.0, 2.0);
  float disc = 1.0 - smoothstep(0.3, 0.64, length(cell));
  float dotty = mix(0.5 + 0.5 * disc, 1.0, smoothstep(0.45, 1.1, span));
  float element = 1.0 - 0.2 * step(0.972, rHash(vec2(floor(dots.x), 7.0)));
  float strobe = 0.9 + 0.1 * rHash(vec2(3.0, floor(dots.y)) + uSeed);
  float band = 0.93 + 0.07 * sin(sigma * 0.41 + uSeed * 3.0) * (0.6 + 0.4 * rNoise(vec2(sigma * 0.05, uSeed)));
  float speck = 0.86 + 0.14 * rHash(floor(dots) + 0.5);
  float density = smoothstep(0.18, 0.82, ink) * dotty * element * strobe * band * speck;
  vec3 inkTone = vec3(0.115, 0.112, 0.13);
  shade = mix(shade, inkTone, clamp(density, 0.0, 1.0) * 0.94);

  float heatRow = mod(sigma / uHeatGrid.x, uHeatGrid.y);
  float heat = texture2D(uHeat, vec2(uAcross, (heatRow + 0.5) / uHeatGrid.y)).r * uHeatGrid.z;
  float mottle = rNoise(mm * 1.7 + 13.0) * 0.6 + rNoise(mm * 5.3) * 0.4;
  float smudge = smoothstep(0.22, 1.15, heat + (mottle - 0.5) * 0.3);
  smudge *= 0.78;
  vec3 burnt = vec3(0.24, 0.235, 0.26);
  shade = mix(shade, burnt, smudge * (1.0 - density * 0.85));
} else {
  shade *= vec3(0.965, 0.955, 0.94);
}
diffuseColor.rgb = shade;
`;
