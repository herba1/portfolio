export const VERTEX_HEAD = `
attribute float aKind;
varying float vKind;
varying vec2 vPaper;
`;

export const VERTEX_BODY = `
vPaper = uv;
vKind = aKind;
`;

export const FRAGMENT_HEAD = `
uniform sampler2D uFront;
uniform sampler2D uBack;
uniform sampler2D uFibre;
uniform sampler2D uCrease;
uniform vec2 uCreaseTexel;
uniform vec2 uFibreRepeat;
uniform vec2 uFibreTexel;
uniform float uCreaseDepth;
uniform float uFibreDepth;
uniform vec3 uCore;
varying float vKind;
varying vec2 vPaper;

float creaseHeight(vec2 at, float face) {
  vec3 c = texture2D(uCrease, at).rgb;
  return (c.b - c.g) * face;
}

float fibreHeight(vec2 at) {
  return texture2D(uFibre, at * uFibreRepeat).g;
}

vec3 paperPerturb(vec3 pos, vec3 nrm, vec2 slope, float face) {
  vec3 sx = dFdx(pos);
  vec3 sy = dFdy(pos);
  vec3 r1 = cross(sy, nrm);
  vec3 r2 = cross(nrm, sx);
  float det = dot(sx, r1) * face;
  vec3 grad = sign(det) * (slope.x * r1 + slope.y * r2);
  vec3 bent = abs(det) * nrm - grad;
  float len = length(bent);
  return len > 1e-12 ? bent / len : nrm;
}
`;

export const FRAGMENT_MAP = `
vec4 fibreSample = texture2D(uFibre, vPaper * uFibreRepeat);
vec4 creaseSample = texture2D(uCrease, vPaper);
vec3 paperColor = gl_FrontFacing ? texture2D(uFront, vPaper).rgb : texture2D(uBack, vPaper).rgb;
float mountainSide = gl_FrontFacing ? creaseSample.b : creaseSample.g;
float valleySide = gl_FrontFacing ? creaseSample.g : creaseSample.b;
float fibreLift = clamp(0.35 + 1.3 * (fibreSample.r - 0.42), 0.0, 1.0);
float crack = creaseSample.r * mix(0.6, 1.0, clamp(mountainSide * 2.2, 0.0, 1.0)) * (0.45 + 0.55 * fibreLift);
vec3 bareFibre = vec3(0.93, 0.9, 0.84);
paperColor = mix(paperColor, bareFibre, clamp(crack * 1.15, 0.0, 1.0) * 0.88);
paperColor *= 1.0 - clamp(valleySide, 0.0, 1.0) * 0.24;
if (vKind > 0.5) paperColor = uCore * (0.86 + 0.28 * fibreSample.r);
diffuseColor.rgb *= paperColor;
`;

export const FRAGMENT_NORMAL = `
if (vKind < 0.5) {
  float face = gl_FrontFacing ? 1.0 : -1.0;
  vec2 cx = vec2(uCreaseTexel.x, 0.0);
  vec2 cy = vec2(0.0, uCreaseTexel.y);
  float dCu = (creaseHeight(vPaper + cx, face) - creaseHeight(vPaper - cx, face)) / max(2.0 * uCreaseTexel.x, 1e-6);
  float dCv = (creaseHeight(vPaper + cy, face) - creaseHeight(vPaper - cy, face)) / max(2.0 * uCreaseTexel.y, 1e-6);
  vec2 fx = vec2(uFibreTexel.x, 0.0);
  vec2 fy = vec2(0.0, uFibreTexel.y);
  float dFu = (fibreHeight(vPaper + fx) - fibreHeight(vPaper - fx)) / max(2.0 * uFibreTexel.x, 1e-6);
  float dFv = (fibreHeight(vPaper + fy) - fibreHeight(vPaper - fy)) / max(2.0 * uFibreTexel.y, 1e-6);
  float dHu = dCu * uCreaseDepth + dFu * uFibreDepth;
  float dHv = dCv * uCreaseDepth + dFv * uFibreDepth;
  vec2 du = dFdx(vPaper);
  vec2 dv = dFdy(vPaper);
  vec2 slope = vec2(dHu * du.x + dHv * du.y, dHu * dv.x + dHv * dv.y);
  normal = paperPerturb(-vViewPosition, normal, slope, faceDirection);
}
`;
