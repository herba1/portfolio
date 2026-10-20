export const CF_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const CF_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uA0;
uniform sampler2D uA1;
uniform sampler2D uB0;
uniform sampler2D uB1;
uniform float uFadeA;
uniform float uFadeB;
uniform float uMix;
uniform float uCells;
uniform float uTime;

vec3 deckA(vec2 uv) {
  return mix(texture(uA0, uv).rgb, texture(uA1, uv).rgb, uFadeA);
}

vec3 deckB(vec2 uv) {
  return mix(texture(uB0, uv).rgb, texture(uB1, uv).rgb, uFadeB);
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 a = deckA(uv);
  vec3 b = deckB(uv);
  mat2 rot = mat2(0.7071, 0.7071, -0.7071, 0.7071);
  vec2 q = rot * (uv * uCells);
  vec2 cell = floor(q) + 0.5;
  vec2 f = q - cell;
  vec2 centerUv = clamp((transpose(rot) * cell) / uCells, 0.0, 1.0);
  float lum = dot(deckB(centerUv), vec3(0.299, 0.587, 0.114));
  float lumA = dot(deckA(centerUv), vec3(0.299, 0.587, 0.114));
  float middle = 1.0 - abs(2.0 * uMix - 1.0);
  float t = clamp(uMix * 1.32 - 0.16 + (lum - lumA) * 0.42 * middle, 0.0, 1.0);
  float r = t * 0.74;
  float d = length(f);
  float aa = fwidth(d) * 1.2;
  float m = 1.0 - smoothstep(r - aa, r + aa, d);
  vec3 color = mix(a, b, m);
  float rim = (smoothstep(r - 0.1, r, d) - smoothstep(r, r + 0.06, d)) * middle;
  color += rim * mix(b, vec3(1.0), 0.5) * 0.22;
  float shimmer = 0.5 + 0.5 * sin(uTime * 1.3 + (cell.x - cell.y) * 0.35);
  color += rim * shimmer * 0.06;
  outColor = vec4(color, 1.0);
}
`;
