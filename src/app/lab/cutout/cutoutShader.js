export const PRINT_VERTEX =`#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const PRINT_FRAGMENT =`#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uImage;
uniform vec2 uRes;
uniform float uCell;
uniform float uSeed;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21) + uSeed);
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
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
    p *= 2.03;
    amp *= 0.5;
  }
  return total;
}

float screenDot(vec2 px, float angle, float cover) {
  float s = sin(angle);
  float c = cos(angle);
  vec2 q = mat2(c, -s, s, c) * px / uCell;
  float d = length(fract(q) - 0.5);
  float radius = sqrt(clamp(cover, 0.0, 1.0)) * 0.74;
  float aa = 0.9 / uCell;
  return 1.0 - smoothstep(radius - aa, radius + aa, d);
}

void main() {
  vec2 px = vec2(vUv.x * uRes.x, (1.0 - vUv.y) * uRes.y);
  float lod = log2(max(uCell * 0.45, 1.0));
  vec3 src = textureLod(uImage, vec2(vUv.x, 1.0 - vUv.y), lod).rgb;
  vec3 sharp = texture(uImage, vec2(vUv.x, 1.0 - vUv.y)).rgb;
  float luma = dot(src, vec3(0.299, 0.587, 0.114));
  src = mix(vec3(luma), src, 0.82);

  float density = 0.7 + 0.1 * fbm(px / (uCell * 60.0) + 3.0);
  vec3 cmy = (1.0 - src) * density;
  cmy.y *= 0.8;
  cmy.x *= 1.04;
  float k = min(min(cmy.x, cmy.y), cmy.z) * 0.6;
  cmy -= k;
  cmy = clamp(cmy * 1.06, 0.0, 1.0);

  float wobble = 0.0;
  float dc = screenDot(px, 0.2618 + wobble, cmy.x);
  float dm = screenDot(px + 0.31 * uCell, 1.309 + wobble, cmy.y);
  float dy = screenDot(px + 0.17 * uCell, 0.0 + wobble, cmy.z);
  float dk = screenDot(px + 0.53 * uCell, 0.7854 + wobble, k * 1.1);

  vec3 paper = vec3(0.925, 0.918, 0.878);
  float mottle = fbm(px / (uCell * 22.0));
  paper *= 0.975 + 0.045 * mottle;
  float fibre = noise(vec2(px.x / (uCell * 0.9), px.y / (uCell * 7.0)) + 11.0);
  paper *= 0.988 + 0.02 * fibre;

  vec3 cyanInk = vec3(0.08, 0.62, 0.86);
  vec3 magentaInk = vec3(0.9, 0.24, 0.56);
  vec3 yellowInk = vec3(0.98, 0.9, 0.18);
  vec3 blackInk = vec3(0.13, 0.13, 0.15);

  vec3 dots = paper;
  dots *= mix(vec3(1.0), cyanInk, dc);
  dots *= mix(vec3(1.0), magentaInk, dm);
  dots *= mix(vec3(1.0), yellowInk, dy);
  dots *= mix(vec3(1.0), blackInk, dk);

  vec3 tone = paper;
  tone *= mix(vec3(1.0), cyanInk, cmy.x);
  tone *= mix(vec3(1.0), magentaInk, cmy.y);
  tone *= mix(vec3(1.0), yellowInk, cmy.z);
  tone *= mix(vec3(1.0), blackInk, k);

  vec3 color = mix(tone, dots, 0.5);
  float line = 1.0 - smoothstep(0.0, 0.35, dot(sharp, vec3(0.333)));
  color = mix(color, blackInk * paper, line * 0.55);

  float grain = hash(floor(px)) - 0.5;
  color += grain * 0.035;
  float speck = step(0.99985, hash(floor(px * 0.5) + 7.0));
  color = mix(color, vec3(0.97, 0.965, 0.94), speck * 0.7);
  color *= 1.03;
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
