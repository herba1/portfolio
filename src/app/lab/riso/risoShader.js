export const RISO_VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const RISO_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform vec2 uRes;
uniform vec2 uBox;
uniform float uDpr;
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform vec4 uPoseA;
uniform vec4 uPoseB;
uniform vec4 uOffA;
uniform vec4 uOffB;
uniform vec3 uInkA0;
uniform vec3 uInkA1;
uniform vec3 uInkB0;
uniform vec3 uInkB1;
uniform vec4 uScreenA;
uniform vec4 uScreenB;
uniform vec3 uMiscA;
uniform vec3 uMiscB;
uniform float uShowB;

out vec4 outColor;

const float ASPECT = 1.41421356;
const float SHEET_MM = 297.0;
const float TAU = 6.28318530;
const vec3 PAPER = vec3(0.962, 0.949, 0.918);
const vec3 GROUND = vec3(0.868, 0.861, 0.845);

float hash21(vec2 p) {
  p = mod(p, 1024.0);
  p = fract(p * vec2(0.1031, 0.1137));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.3);
    a *= 0.5;
  }
  return v;
}

float sdBox(vec2 p, vec2 b) {
  vec2 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

float inSheet(vec2 q) {
  vec2 e = step(vec2(0.0), q) * step(q, vec2(1.0, ASPECT));
  return e.x * e.y;
}

float halftone(vec2 q, float tone, float ang, float devPerUnit) {
  float lines = 104.0;
  float ca = cos(ang);
  float sa = sin(ang);
  vec2 r = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y) * lines;
  vec2 f = fract(r) - 0.5;
  float spot = 0.5 - 0.25 * (cos(TAU * f.x) + cos(TAU * f.y));
  float w = fwidth(spot) * 0.85 + 0.035;
  float t = clamp(tone + 0.14 * tone * (1.0 - tone), 0.0, 1.0);
  float c = 1.0 - smoothstep(t - w, t + w, spot);
  float cellPx = devPerUnit / lines;
  float k = smoothstep(2.0, 3.6, cellPx);
  return mix(t, c, k) * step(0.006, tone);
}

float grain(vec2 q, float tone, float seed, float devPerUnit) {
  float scale = 165.0;
  vec2 g = q * scale + seed * 31.0;
  float n = vnoise(g) * 0.68 + vnoise(g * 2.37 + 41.0) * 0.32;
  float u = 0.5 + 0.5 * tanh(clamp((n - 0.5) * 7.2, -8.0, 8.0));
  float w = fwidth(u) * 0.7 + 0.05;
  float t = clamp(tone + 0.1 * tone * (1.0 - tone), 0.0, 1.0);
  float c = 1.0 - smoothstep(t - w, t + w, u);
  float px = devPerUnit / scale;
  float k = smoothstep(0.9, 1.8, px);
  return mix(t, c, k) * step(0.006, tone);
}

float screenCov(vec2 q, float tone, float mode, float ang, float seed, float devPerUnit) {
  float a = halftone(q, tone, ang, devPerUnit);
  float b = grain(q, tone, seed, devPerUnit);
  return mix(a, b, step(0.5, mode));
}

float drum(vec2 q, float seed) {
  float lo = fbm(q * vec2(2.6, 1.8) + seed) - 0.5;
  float mid = vnoise(q * vec2(11.0, 6.0) + seed * 1.7) - 0.5;
  float streak = vnoise(vec2(q.x * 170.0 + seed * 13.0, q.y * 0.8)) - 0.5;
  float bold = smoothstep(0.66, 0.92, vnoise(vec2(q.x * 34.0 + seed * 7.0, q.y * 0.35 + seed)));
  float tail = smoothstep(0.5, 1.45, q.y);
  float side = smoothstep(0.0, 1.0, q.x);
  float d = 0.95 + lo * 0.16 + mid * 0.07 + streak * 0.11 - bold * 0.12 - tail * 0.09 - side * 0.035;
  return clamp(d, 0.42, 1.0);
}

vec3 inkLayer(vec3 ink, float d) {
  vec3 base = max(ink, vec3(0.004));
  return exp2(log2(base) * clamp(d, 0.0, 1.2));
}

vec4 poster(vec2 s, sampler2D tex, vec4 pose, vec4 off, vec3 ink0, vec3 ink1, vec4 scr, vec3 misc, out float shade) {
  float c = cos(pose.w);
  float sn = sin(pose.w);
  vec2 d = s - pose.xy;
  vec2 l = vec2(c * d.x + sn * d.y, -sn * d.x + c * d.y);
  float hw = max(pose.z, 1.0);
  float hh = hw * ASPECT;
  float lift = misc.x;
  float press = misc.z;

  float sd1 = sdBox(l - vec2(0.0, 1.5 + lift * 5.0), vec2(hw, hh) - 0.5);
  float sd2 = sdBox(l - vec2(0.0, 9.0 + lift * 22.0), vec2(hw, hh) - 4.0);
  float contact = 1.0 - smoothstep(-1.5, 2.5 + lift * 5.0, sd1);
  float wide = 1.0 - smoothstep(-14.0, 30.0 + lift * 36.0, sd2);
  shade = contact * (0.2 - lift * 0.08) + wide * wide * (0.15 + lift * 0.05);

  float edge = sdBox(l, vec2(hw, hh));
  float alpha = clamp(0.5 - edge * uDpr, 0.0, 1.0);

  float unitPx = 2.0 * hw;
  float devPerUnit = unitPx * uDpr;
  vec2 p = (l + vec2(hw, hh)) / unitPx;
  vec2 pm = p * SHEET_MM;
  float pxPerMm = devPerUnit / SHEET_MM;
  float toothF = clamp(pxPerMm * 0.42, 0.4, 9.0);

  float tooth = vnoise(pm * toothF) * 0.62 + vnoise(pm * toothF * 2.1 + 7.0) * 0.38;
  float fibre = vnoise(vec2(pm.x * toothF * 0.18 + pm.y * toothF * 0.05, pm.y * toothF * 0.9)) - 0.5;
  float cloud = fbm(pm * 0.045 + misc.y) - 0.5;
  vec3 paper = PAPER * (1.0 + cloud * 0.03 + fibre * 0.016 + (tooth - 0.5) * 0.03);
  float fleck = step(0.9993, hash21(floor(pm * 1.6) + misc.y));
  paper *= 1.0 - fleck * 0.12;

  vec2 q0 = p - off.xy;
  vec2 q1 = p - off.zw;
  vec4 t0 = texture(tex, vec2(q0.x, q0.y / ASPECT));
  vec4 t1 = texture(tex, vec2(q1.x, q1.y / ASPECT));
  float m0 = inSheet(q0);
  float m1 = inSheet(q1);

  float solid0 = smoothstep(0.08, 0.92, t0.b) * m0;
  float solid1 = smoothstep(0.08, 0.92, t1.a) * m1;
  float cov0 = max(screenCov(q0, t0.r * m0, scr.x, scr.z, misc.y, devPerUnit), solid0);
  float cov1 = max(screenCov(q1, t1.g * m1, scr.y, scr.w, misc.y + 5.3, devPerUnit), solid1);

  float valley = smoothstep(0.35, 0.95, 1.0 - tooth);
  float pin0 = step(0.9965, hash21(floor(pm * toothF * 0.7) + 3.0));
  float pin1 = step(0.9965, hash21(floor(pm * toothF * 0.7) + 91.0));

  float d0 = cov0 * drum(q0, misc.y);
  d0 *= 1.0 - valley * valley * 0.42 * cov0;
  d0 *= 1.0 - pin0 * solid0 * 0.6;
  float ghost0 = smoothstep(0.8, 0.98, vnoise(vec2(q0.x * 22.0 + misc.y, q0.y * 1.6))) * 0.018 * m0;
  d0 = max(d0, ghost0);

  float d1 = cov1 * drum(q1, misc.y + 9.1);
  d1 *= 1.0 - valley * valley * 0.42 * cov1;
  d1 *= 1.0 - pin1 * solid1 * 0.6;
  float ghost1 = smoothstep(0.8, 0.98, vnoise(vec2(q1.x * 19.0 + misc.y * 2.0, q1.y * 1.4 + 4.0))) * 0.015 * m1;
  d1 = max(d1, ghost1);
  d1 *= 1.0 - 0.08 * d0;

  vec3 col = paper * inkLayer(ink0, d0) * inkLayer(ink1, d1);
  float light = 1.0 + (0.5 - p.y / ASPECT) * 0.03 + (0.5 - p.x) * 0.015;
  float rim = smoothstep(0.0, 2.0, -edge);
  col *= light * mix(0.94, 1.0, rim) * (1.0 - press * 0.012);
  return vec4(col, alpha);
}

void main() {
  vec2 s = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 g = s / max(uBox, vec2(1.0));
  float vig = 1.0 - 0.06 * dot(g - vec2(0.5, 0.45), g - vec2(0.5, 0.45)) * 2.0;
  vec3 col = GROUND * vig * (1.0 + (vnoise(s * 0.9) - 0.5) * 0.012);

  float shadeB = 0.0;
  vec4 pb = vec4(0.0);
  if (uShowB > 0.5) {
    pb = poster(s, uTexB, uPoseB, uOffB, uInkB0, uInkB1, uScreenB, uMiscB, shadeB);
  }
  col *= 1.0 - shadeB;
  col = mix(col, pb.rgb, pb.a);

  float shadeA = 0.0;
  vec4 pa = poster(s, uTexA, uPoseA, uOffA, uInkA0, uInkA1, uScreenA, uMiscA, shadeA);
  col *= 1.0 - shadeA;
  col = mix(col, pa.rgb, pa.a);

  col += (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
