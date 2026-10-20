export const HALFTONE_VERTEX = `#version 300 es
precision highp float;
void main() {
  float x = gl_VertexID == 1 ? 2.0 : 0.0;
  float y = gl_VertexID == 2 ? 2.0 : 0.0;
  gl_Position = vec4(vec2(x, y) * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const HALFTONE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uPlateA;
uniform sampler2D uPlateB;
uniform sampler2D uDisp;
uniform vec2 uRes;
uniform vec2 uOrigin;
uniform float uScale;
uniform vec4 uArt;
uniform vec2 uDispCell;
uniform vec2 uDispCount;
uniform float uCell;
uniform float uAngle;
uniform float uShape;
uniform float uClean;
uniform float uMix;
uniform float uTime;
uniform float uFade;
uniform vec3 uPaper;
uniform vec3 uInk;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec2 disp(vec2 q) {
  vec2 uv = (q / uDispCell + 0.5) / uDispCount;
  return texture(uDisp, uv).rg;
}

float tone(vec2 q) {
  vec2 uv = (q - uArt.xy) / uArt.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  float a = texture(uPlateA, uv).r;
  float b = texture(uPlateB, uv).r;
  return 1.0 - mix(a, b, uMix);
}

float shapeSdf(vec2 v, float t, float shape) {
  float r = sqrt(max(t, 0.0) / 3.14159) * (1.0 + 0.27 * smoothstep(0.45, 1.0, t));
  float round_ = length(v) - r;
  float line_ = max(abs(v.y) - t * 0.5, abs(v.x) - 0.52);
  float a = 0.2 + 0.32 * sqrt(t);
  float w = 0.06 + 0.26 * t;
  float cross_ = max(min(abs(v.x), abs(v.y)) - w, max(abs(v.x), abs(v.y)) - a);
  float s0 = floor(shape);
  float f = smoothstep(0.32, 0.68, fract(shape));
  float sa = s0 < 0.5 ? round_ : (s0 < 1.5 ? line_ : cross_);
  float sb = s0 < 0.5 ? line_ : (s0 < 1.5 ? cross_ : round_);
  float s = mix(sa, sb, f);
  return mix(s, -0.8, smoothstep(0.9, 1.0, t));
}

void main() {
  vec2 q = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  vec2 dq = disp(q);
  vec2 q0 = q - dq;
  float ca = cos(uAngle);
  float sa = sin(uAngle);
  mat2 toGrid = mat2(ca, -sa, sa, ca);
  mat2 fromGrid = mat2(ca, sa, -sa, ca);
  vec2 g = toGrid * (q0 - uOrigin) / uCell;
  vec2 base = floor(g) + 0.5;
  float cellPx = uCell * uScale;
  float rough = (vnoise(q * 0.9) - 0.5) * 0.07 + (vnoise(q * 3.1) - 0.5) * 0.04;
  float cover = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 n = base + vec2(float(i), float(j));
      vec2 cc = uOrigin + fromGrid * (n * uCell);
      vec2 dc = cc + disp(cc);
      vec2 v = toGrid * (q - dc) / uCell;
      vec2 tp = q - (dc - cc);
      float t = tone(tp);
      if (t < 0.012) continue;
      float s = shapeSdf(v, t, uShape) + rough;
      cover = max(cover, clamp(0.5 - s * cellPx, 0.0, 1.0));
    }
  }
  float tc = tone(q0);
  float grain = (vnoise(q * 1.7 + 11.0) - 0.5) * 0.08;
  float clean = clamp(pow(tc, 0.9) * 1.1 * (1.0 + grain), 0.0, 1.0);
  float ink = mix(cover, clean, uClean) * uFade;

  float fib = vnoise(q * vec2(0.08, 0.5)) * 0.6 + vnoise(q * 0.35) * 0.4;
  float speck = step(0.9985, hash(floor(q * 0.9))) * 0.08;
  vec3 paper = uPaper * (0.985 + (fib - 0.5) * 0.035) - speck;
  vec2 c = gl_FragCoord.xy / uRes - 0.5;
  paper *= 1.0 - dot(c, c) * 0.06;
  float mottle = vnoise(q * 0.22) * 0.5 + vnoise(q * 0.06) * 0.5;
  vec3 inkCol = uInk + (mottle - 0.5) * 0.05;
  vec3 col = mix(paper, inkCol, ink * (0.93 + mottle * 0.07));
  col += (hash(gl_FragCoord.xy + fract(uTime) * 37.0) - 0.5) * 0.012;
  outColor = vec4(col, 1.0);
}
`;
