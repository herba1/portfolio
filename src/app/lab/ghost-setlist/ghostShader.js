export const QUAD_VERTEX = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const DOWN_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uTexel;
out vec4 outColor;
void main() {
  vec2 h = uTexel;
  vec4 sum = texture(uSource, vUv) * 4.0;
  sum += texture(uSource, vUv - h);
  sum += texture(uSource, vUv + h);
  sum += texture(uSource, vUv + vec2(h.x, -h.y));
  sum += texture(uSource, vUv - vec2(h.x, -h.y));
  outColor = sum * 0.125;
}
`;

export const UP_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform sampler2D uBase;
uniform vec2 uTexel;
uniform float uCarry;
out vec4 outColor;
void main() {
  vec2 h = uTexel;
  vec4 sum = texture(uSource, vUv + vec2(-h.x * 2.0, 0.0));
  sum += texture(uSource, vUv + vec2(-h.x, h.y)) * 2.0;
  sum += texture(uSource, vUv + vec2(0.0, h.y * 2.0));
  sum += texture(uSource, vUv + vec2(h.x, h.y)) * 2.0;
  sum += texture(uSource, vUv + vec2(h.x * 2.0, 0.0));
  sum += texture(uSource, vUv + vec2(h.x, -h.y)) * 2.0;
  sum += texture(uSource, vUv + vec2(0.0, -h.y * 2.0));
  sum += texture(uSource, vUv + vec2(-h.x, -h.y)) * 2.0;
  vec4 up = sum / 12.0;
  outColor = mix(texture(uBase, vUv), up, uCarry);
}
`;

export const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uText;
uniform sampler2D uMid;
uniform sampler2D uCore;
uniform sampler2D uNear;
uniform sampler2D uWide;
uniform vec3 uNeon;
uniform vec3 uGhostWarm;
uniform vec3 uCool;
uniform float uGlow;
out vec4 outColor;

vec3 tint(vec4 s) {
  float cool = clamp(s.b / max(s.g, 1e-4), 0.0, 1.0);
  vec3 ghost = mix(uGhostWarm, uCool, cool);
  return uNeon * s.r + ghost * s.g * 0.9;
}

void main() {
  vec4 text = texture(uText, vUv);
  vec4 core = texture(uCore, vUv);
  vec3 near = tint(texture(uNear, vUv));
  vec3 wide = tint(texture(uWide, vUv));

  float solid = text.r;
  float body = mix(texture(uMid, vUv).r, core.r, 0.5);
  float fill = clamp(body / max(solid, 1e-3), 0.0, 1.0);
  float hot = smoothstep(0.66, 0.98, fill) * solid;
  vec3 tube = uNeon * solid * 1.1 + vec3(1.0, 0.92, 0.84) * hot * 0.5;
  float cool = clamp(text.b / max(text.g, 1e-4), 0.0, 1.0);
  vec3 ghost = mix(uGhostWarm, uCool, cool) * text.g * 1.2;

  vec3 color = tube + ghost + (near * 0.26 + wide * 0.1) * uGlow;
  color = vec3(1.0) - exp(-color * 1.4);
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
