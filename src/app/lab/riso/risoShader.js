export const RISO_VERTEX = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const RISO_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uCover;
uniform sampler2D uPlate;
uniform vec2 uSize;
uniform vec4 uImg;
uniform vec2 uOff[3];
uniform float uRot[3];
uniform float uProg[3];
uniform vec3 uInk[3];
uniform float uAngle[3];
uniform float uPitch;
uniform float uSeed;
uniform float uDevice;
uniform float uHasCover;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
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
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}

vec3 separate(vec3 c) {
  c = clamp((c - 0.03) / 0.9, 0.0, 1.0);
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = clamp(mix(vec3(lum), c, 1.45), 0.0, 1.0);
  c = smoothstep(0.0, 1.0, c) * 0.35 + c * 0.65;
  vec3 l = log(max(c, vec3(0.025)));
  float b = clamp(l.r / -2.53, 0.0, 1.0);
  float r1 = l.g + 0.755 * b;
  float r2 = l.b + 0.288 * b;
  float det = 3.763;
  float p = (r1 * -3.0 - (-0.094) * r2) / det;
  float y = (-1.266 * r2 - (-0.371) * r1) / det;
  return clamp(vec3(y, p, b), 0.0, 1.0);
}

float pick(vec3 v, int i) {
  return i == 0 ? v.x : (i == 1 ? v.y : v.z);
}

vec2 density(int i, vec2 p) {
  vec2 c = uSize * 0.5;
  float r = -uRot[i];
  vec2 q = p - c;
  q = mat2(cos(r), sin(r), -sin(r), cos(r)) * q + c;
  q -= uOff[i];
  float d = 0.0;
  float t = 0.0;
  vec2 iu = (q - uImg.xy) / uImg.zw;
  if (uHasCover > 0.5 && iu.x >= 0.0 && iu.y >= 0.0 && iu.x <= 1.0 && iu.y <= 1.0) {
    d = pick(separate(texture(uCover, iu).rgb), i);
  }
  vec2 pu = q / uSize;
  if (pu.x >= 0.0 && pu.y >= 0.0 && pu.x <= 1.0 && pu.y <= 1.0) {
    t = pick(texture(uPlate, pu).rgb, i);
  }
  return vec2(d, t);
}

float screenAt(float d, vec2 p, float ang, float k) {
  float s = sin(ang);
  float co = cos(ang);
  vec2 q = mat2(co, -s, s, co) * p / uPitch;
  float spot = 0.5 + 0.25 * (cos(6.2831853 * q.x) + cos(6.2831853 * q.y));
  float grain = (noise(p * 0.85 + k * 31.7 + uSeed) - 0.5) * 0.26 + (hash(floor(p * uDevice * 0.7) + k * 7.3 + uSeed) - 0.5) * 0.16;
  float t = spot + grain - (1.0 - d * 1.04);
  float aa = fwidth(spot) * 0.9 + 0.035;
  float cov = smoothstep(-aa, aa, t);
  cov *= smoothstep(0.015, 0.06, d) * 0.92 + 0.08 * step(0.995, spot + grain * 0.4);
  return cov;
}

void main() {
  vec2 p = vUv * uSize;
  float tooth = fbm(p * 0.42 + uSeed * 0.1);
  float fiber = noise(vec2(p.x * 0.05, p.y * 1.6) + uSeed);
  vec3 col = vec3(0.958, 0.945, 0.916) * (0.972 + 0.03 * tooth + 0.008 * fiber);
  for (int i = 0; i < 3; i++) {
    float prog = uProg[i];
    if (prog <= 0.0) continue;
    float front = prog * (uSize.y + 60.0) - 30.0;
    float wipe = clamp((front - p.y) / 26.0, 0.0, 1.0);
    if (wipe <= 0.0) continue;
    float k = float(i) + 1.0;
    vec2 dd = density(i, p);
    float cov = screenAt(dd.x, p, uAngle[i], k);
    float edge = (noise(p * 1.7 + k * 9.0 + uSeed) - 0.5) * 0.5;
    float solid = smoothstep(0.38, 0.62, dd.y + edge * (1.0 - dd.y) * 0.9);
    cov = max(cov, solid);
    float mottle = fbm(p * 0.018 + k * 13.0 + uSeed * 0.37);
    float strength = 0.88 + 0.12 * mottle;
    float starve = smoothstep(0.62, 0.8, fbm(p * 0.09 + k * 5.1 + uSeed));
    strength *= 1.0 - starve * 0.2;
    strength *= 0.9 + 0.1 * tooth;
    float fresh = 1.0 + 0.06 * smoothstep(60.0, 0.0, front - p.y) * step(prog, 0.999);
    col *= mix(vec3(1.0), uInk[i], clamp(cov * strength * wipe * fresh, 0.0, 1.0));
  }
  outColor = vec4(col, 1.0);
}
`;
