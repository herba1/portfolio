export const SCOPE_FULL_VERTEX = `#version 300 es
precision highp float;
void main() {
  float x = gl_VertexID == 1 ? 2.0 : 0.0;
  float y = gl_VertexID == 2 ? 2.0 : 0.0;
  gl_Position = vec4(vec2(x, y) * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SCOPE_DECAY = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform vec2 uSize;
uniform float uDecay;
uniform float uFloor;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float v = textureLod(uPrev, uv, 0.0).r;
  outColor = vec4(max(v * uDecay - uFloor, 0.0), 0.0, 0.0, 1.0);
}
`;

export const SCOPE_BEAM_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aSeg;
layout(location = 1) in float aEnergy;
uniform vec2 uRes;
uniform float uSigma;
out vec2 vLocal;
out float vLen;
out float vEnergy;
void main() {
  vec2 p0 = aSeg.xy;
  vec2 p1 = aSeg.zw;
  vec2 d = p1 - p0;
  float len = length(d);
  vec2 dir = len > 0.0001 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float r = uSigma * 3.2;
  int id = gl_VertexID;
  float along = (id == 1 || id == 4 || id == 5) ? 1.0 : 0.0;
  float side = (id == 2 || id == 3 || id == 5) ? 1.0 : -1.0;
  float lx = along > 0.5 ? len + r : -r;
  float ly = side * r;
  vec2 p = p0 + dir * lx + nrm * ly;
  vLocal = vec2(lx, ly);
  vLen = len;
  vEnergy = aEnergy;
  gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SCOPE_BEAM = `#version 300 es
precision highp float;
uniform float uSigma;
in vec2 vLocal;
in float vLen;
in float vEnergy;
out vec4 outColor;
float erfApprox(float x) {
  float s = sign(x);
  float a = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * a);
  float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return s * y;
}
void main() {
  float s = uSigma;
  float k = 0.70710678 / s;
  float g = exp(-vLocal.y * vLocal.y / (2.0 * s * s)) / (2.5066283 * s);
  float along;
  if (vLen < 0.08 * s) {
    along = exp(-vLocal.x * vLocal.x / (2.0 * s * s)) / (2.5066283 * s);
  } else {
    along = 0.5 * (erfApprox(vLocal.x * k) - erfApprox((vLocal.x - vLen) * k)) / vLen;
  }
  outColor = vec4(vEnergy * along * g, 0.0, 0.0, 1.0);
}
`;

export const SCOPE_DISPLAY = `#version 300 es
precision highp float;
uniform sampler2D uAccum;
uniform vec2 uRes;
uniform float uExposure;
uniform float uTime;
uniform float uDpr;
uniform float uRadius;
uniform float uRows;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float gridLine(float coord, float cells, float span, float width) {
  float g = coord * cells;
  float d = abs(fract(g + 0.5) - 0.5) * (span / cells);
  return 1.0 - smoothstep(width * 0.5, width * 0.5 + uDpr, d);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float v = textureLod(uAccum, uv, 0.0).r * uExposure;
  float b1 = textureLod(uAccum, uv, 1.5).r;
  float b2 = textureLod(uAccum, uv, 3.0).r;
  float b3 = textureLod(uAccum, uv, 4.5).r;
  float b4 = textureLod(uAccum, uv, 6.0).r;
  float bloom = (b1 * 0.35 + b2 * 0.5 + b3 * 0.7 + b4 * 0.9) * uExposure;
  vec3 phosphor = vec3(0.30, 1.0, 0.50);
  vec3 hot = vec3(0.86, 1.0, 0.90);
  float core = 1.0 - exp(-v * 1.25);
  vec3 col = phosphor * core * 0.92;
  col += hot * smoothstep(0.9, 4.0, v) * 0.55;
  col += phosphor * (1.0 - exp(-bloom * 0.5)) * 0.42;
  float gx = gridLine(uv.x, 10.0, uRes.x, uDpr);
  float gy = gridLine(uv.y, uRows, uRes.y, uDpr);
  vec2 c = uv - 0.5;
  float axisX = 1.0 - smoothstep(uDpr * 0.5, uDpr * 1.5, abs(c.y) * uRes.y);
  float axisY = 1.0 - smoothstep(uDpr * 0.5, uDpr * 1.5, abs(c.x) * uRes.x);
  float tickX = gridLine(uv.x, 50.0, uRes.x, uDpr) * (1.0 - smoothstep(uDpr * 3.0, uDpr * 4.0, abs(c.y) * uRes.y));
  float tickY = gridLine(uv.y, uRows * 5.0, uRes.y, uDpr) * (1.0 - smoothstep(uDpr * 3.0, uDpr * 4.0, abs(c.x) * uRes.x));
  float grid = max(max(gx, gy) * 0.55, max(max(axisX, axisY) * 0.7, max(tickX, tickY) * 0.7));
  float r = length(c * vec2(1.0, uRes.y / uRes.x) * 1.6);
  vec3 ground = vec3(0.020, 0.030, 0.026) * (1.0 - 0.45 * r * r);
  vec3 etch = vec3(0.09, 0.12, 0.105) + phosphor * (1.0 - exp(-bloom * 0.9)) * 0.22;
  vec3 base = mix(ground, etch, grid);
  vec3 outc = base + col;
  outc += (hash(gl_FragCoord.xy + fract(uTime * 7.13) * 91.0) - 0.5) * 0.012;
  vec2 q = abs(gl_FragCoord.xy - uRes * 0.5) - (uRes * 0.5 - uRadius);
  float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  float alpha = 1.0 - smoothstep(-uDpr, 0.0, dist);
  outColor = vec4(clamp(outc, 0.0, 1.0) * alpha, alpha);
}
`;
