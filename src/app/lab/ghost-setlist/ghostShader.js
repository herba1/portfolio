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

export const MATERIAL_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uBox;
uniform float uHorizon;
uniform vec2 uSign;
out vec4 outColor;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float total = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    total += amp * noise(p);
    p = p * 2.07 + vec2(3.1, 7.7);
    amp *= 0.5;
  }
  return total;
}

void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uBox;
  float aboveFloor = uHorizon - px.y;
  if (aboveFloor >= 0.0) {
    float broad = fbm(px / 220.0);
    float fine = fbm(px / 15.0);
    float e = 2.0;
    float fx = fbm((px + vec2(e, 0.0)) / 15.0) - fine;
    float fy = fbm((px + vec2(0.0, e)) / 15.0) - fine;
    vec3 n = normalize(vec3(-fx * 4.5, -fy * 4.5, 1.0));
    vec3 l = normalize(vec3(uSign - px, 220.0));
    float lit = clamp(dot(n, l), 0.0, 1.0);
    float albedo = 0.64 + 0.36 * broad + 0.08 * (fine - 0.5);
    float occlusion = mix(0.55, 1.0, smoothstep(0.0, 56.0, aboveFloor));
    outColor = vec4((0.7 + 0.6 * broad) * occlusion * 0.5, albedo * (0.35 + 0.75 * lit) * occlusion * 0.5, 0.0, 1.0);
  } else {
    float d = -aboveFloor;
    float boards = noise(vec2(px.x * 0.0025, px.y * 0.09)) * 0.5 + noise(vec2(px.x * 0.02, px.y * 0.6)) * 0.5;
    float occlusion = mix(0.5, 1.0, smoothstep(0.0, 28.0, d));
    float wobble = noise(vec2(px.x * 0.018, px.y * 0.0035));
    outColor = vec4(occlusion * 0.5, boards, wobble, 0.0);
  }
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
uniform sampler2D uMaterial;
uniform vec2 uBox;
uniform float uHorizon;
uniform vec3 uNeon;
uniform vec3 uGhostWarm;
uniform vec3 uCool;
uniform float uGlow;
uniform float uSeed;
out vec4 outColor;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

vec2 uvAt(vec2 px) {
  return vec2(px.x / uBox.x, 1.0 - px.y / uBox.y);
}

vec3 tint(vec4 s) {
  float cool = clamp(s.b / max(s.g, 1e-4), 0.0, 1.0);
  vec3 ghost = mix(uGhostWarm, uCool, cool);
  return uNeon * s.r + ghost * s.g * 0.9;
}

void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uBox;
  vec2 uv = uvAt(px);

  vec4 text = texture(uText, uv);
  vec4 core = texture(uCore, uv);
  vec4 material = texture(uMaterial, uv);
  vec3 near = tint(texture(uNear, uv));
  vec3 wide = tint(texture(uWide, uv));

  float solid = text.r;
  float body = mix(texture(uMid, uv).r, core.r, 0.5);
  float fill = clamp(body / max(solid, 1e-3), 0.0, 1.0);
  float hot = smoothstep(0.66, 0.98, fill) * solid;
  vec3 tube = uNeon * solid * 1.05 + vec3(1.0, 0.9, 0.8) * hot * 0.45;
  float cool = clamp(text.b / max(text.g, 1e-4), 0.0, 1.0);
  vec3 ghost = mix(uGhostWarm, uCool, cool) * text.g * 1.25;

  vec3 color;
  float aboveFloor = uHorizon - px.y;

  if (aboveFloor >= 0.0) {
    vec3 base = vec3(0.05, 0.034, 0.028) * material.r * 2.0;
    vec3 spill = (wide * 1.8 + near * 0.4) * uGlow;
    color = base + spill * material.g * 2.0;
  } else {
    float d = -aboveFloor;
    float rough = smoothstep(0.0, uBox.y * 0.28, d);
    float wobble = (material.b - 0.5) * d * 0.08;
    vec2 m = vec2(px.x + wobble, uHorizon - d);
    vec3 sharp = tint(texture(uMid, uvAt(m)));
    vec3 soft = tint(texture(uNear, uvAt(m)));
    vec3 refl = mix(sharp, soft, 0.25 + 0.75 * rough);
    float fade = exp(-d / (uBox.y * 0.2));
    float boards = material.g;
    vec3 base = vec3(0.022, 0.016, 0.014) * (0.8 + 0.4 * boards);
    vec3 spillAbove = tint(texture(uWide, uvAt(vec2(px.x, uHorizon - 24.0))));
    vec3 spill = spillAbove * exp(-d / (uBox.y * 0.14)) * 0.7 * uGlow;
    color = (base + spill * (0.7 + 0.3 * boards)) * material.r * 2.0 + refl * fade * 0.62 * uGlow * (0.86 + 0.28 * boards);
  }

  color += tube + ghost;
  color += (near * 0.5 + wide * 0.32) * uGlow;

  vec2 q = px / uBox - 0.5;
  float vig = smoothstep(1.05, 0.2, length(q * vec2(1.05, 1.25)));
  color *= mix(0.42, 1.0, vig);

  color = vec3(1.0) - exp(-color * 1.3);
  float grain = hash(gl_FragCoord.xy + uSeed * 61.0) - 0.5;
  color += grain * 0.018;
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
