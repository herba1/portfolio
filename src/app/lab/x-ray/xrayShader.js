export const XRAY_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const NOISE = `
float rand(vec2 n) {
  return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 ip = floor(p);
  vec2 u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  float res = mix(mix(rand(ip), rand(ip + vec2(1.0, 0.0)), u.x), mix(rand(ip + vec2(0.0, 1.0)), rand(ip + vec2(1.0, 1.0)), u.x), u.y);
  return res * res;
}

float fbm(vec2 x) {
  float v = 0.0;
  float a = 0.5;
  vec2 shift = vec2(100.0);
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < 4; i++) {
    v += a * noise(x);
    x = rot * x * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}
`;

export const FLOOD_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform sampler2D uInput;
uniform vec2 uRes;
uniform vec2 uAspect;
uniform float uHeal;
out vec4 outColor;
${NOISE}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 disp = fbm(uv * 20.0) * uAspect * 0.01;
  vec3 flood = texture(uPrev, uv).rgb;
  flood = min(flood, texture(uPrev, vec2(uv.x + disp.x, uv.y)).rgb);
  flood = min(flood, texture(uPrev, vec2(uv.x - disp.x, uv.y)).rgb);
  flood = min(flood, texture(uPrev, vec2(uv.x, uv.y + disp.y)).rgb);
  flood = min(flood, texture(uPrev, vec2(uv.x, uv.y - disp.y)).rgb);
  vec3 stroke = texture(uInput, vec2(uv.x, 1.0 - uv.y)).rgb;
  vec3 combined = min(flood, stroke);
  outColor = vec4(min(vec3(1.0), combined + uHeal), 1.0);
}
`;

export const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uMask;
uniform sampler2D uExterior;
uniform sampler2D uXray;
uniform vec2 uRes;
uniform float uDpr;
out vec4 outColor;
${NOISE}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 st = vec2(uv.x, 1.0 - uv.y);
  float r = 1.0 - texture(uMask, uv).r;
  float grain = fbm(st * vec2(uRes.x / uRes.y, 1.0) * 7.0);
  float reveal = smoothstep(0.36, 0.5, r + (grain - 0.42) * 0.26);
  vec3 outside = texture(uExterior, st).rgb;
  vec3 inside = texture(uXray, st).rgb;
  float line = step(0.5, fract(gl_FragCoord.y / (3.0 * uDpr)));
  inside *= 1.0 - line * 0.035;
  float rim = smoothstep(0.26, 0.36, r) * (1.0 - smoothstep(0.36, 0.44, r));
  vec3 color = mix(outside, inside, reveal);
  color = mix(color, vec3(0.86, 0.92, 1.0), rim * 0.32);
  outColor = vec4(color, 1.0);
}
`;
