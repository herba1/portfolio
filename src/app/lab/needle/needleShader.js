export const NEEDLE_VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const NEEDLE_FRAGMENT = `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform float uDpr;
uniform vec3 uView;
uniform vec3 uEye;
uniform vec4 uRec;
uniform vec4 uStrobe;
uniform vec4 uArmA;
uniform vec4 uArmB;
uniform vec4 uArmC;
uniform vec4 uSeg[16];
uniform vec4 uSide;
uniform vec4 uFlags;
uniform sampler2D uLabel;
uniform sampler2D uGroove;

out vec4 outColor;

const float PI = 3.14159265;
const float TAU = 6.2831853;
const float R_REC = 152.4;
const float R_MAT = 156.0;
const float R_PLAT = 168.0;
const float R_LABEL = 50.0;
const float R_LEAD = 147.5;
const float R_LOCK = 56.5;
const vec3 KEY = vec3(-430.0, -560.0, 1150.0);
const vec3 FILL = vec3(820.0, -380.0, 1300.0);
const vec2 PIVOT = vec2(190.0, -101.0);
const vec2 LAMP = vec2(-128.0, 128.0);
const vec4 KEYCAP = vec4(-163.0, 151.0, 22.0, 11.0);
const vec4 PLINTH = vec4(-190.0, -176.5, 263.0, 176.5);
const vec3 LAMP_COL = vec3(1.0, 0.36, 0.12);

float pxmm;

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float cover(float d) {
  return clamp(0.5 - d / pxmm, 0.0, 1.0);
}

float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

float sdOriented(vec2 p, vec2 a, vec2 b, float hw, float r) {
  vec2 d = b - a;
  float len = max(length(d), 1e-4);
  vec2 u = d / len;
  vec2 q = p - (a + b) * 0.5;
  vec2 l = vec2(dot(q, u), dot(q, vec2(-u.y, u.x)));
  return sdBox(l, vec2(len * 0.5, hw), r);
}

vec2 rot(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

float softbox(vec3 pos, vec3 r, vec3 light, vec2 half_, float soft) {
  if (r.z < 0.02) return 0.0;
  float k = (light.z - pos.z) / r.z;
  vec2 q = pos.xy + r.xy * min(k, 1e5) - light.xy;
  vec2 e = smoothstep(half_ + soft, half_ - soft, abs(q));
  return e.x * e.y;
}

vec3 env(vec3 pos, vec3 r) {
  float sky = 0.05 + 0.05 * clamp(r.z, 0.0, 1.0);
  float key = softbox(pos, r, KEY, vec2(520.0, 360.0), 220.0);
  float fill = softbox(pos, r, FILL, vec2(260.0, 420.0), 180.0);
  return vec3(sky) + vec3(1.0, 0.985, 0.96) * key * 6.0 + vec3(0.92, 0.96, 1.0) * fill * 1.6;
}

float aniso(vec3 h, vec2 t, float at, float ar, float tilt) {
  vec2 rr = vec2(-t.y, t.x);
  float ht = dot(h.xy, t) + tilt * h.z;
  float hr = dot(h.xy, rr);
  float hz = max(h.z, 1e-3);
  float k = ht * ht / (at * at) + hr * hr / (ar * ar) + hz * hz;
  return min(1.0 / (PI * at * ar * max(k * k, 1e-4)), 400.0);
}

vec3 lightDir(vec3 pos, vec3 l) {
  return normalize(l - pos);
}

float shadowOf(vec2 p, float height, float radius) {
  vec2 off = -KEY.xy / KEY.z * height;
  float d = length(p - off) - radius;
  return smoothstep(height * 0.5 + 2.0, -height * 0.25, d);
}

vec4 segFor(float r) {
  vec4 s = uSeg[0];
  for (int i = 1; i < 16; i++) {
    if (r <= uSeg[i].x) s = uSeg[i];
  }
  return s;
}

vec2 grooveSample(float t, vec4 s) {
  float x = (t - s.z) / max(uSide.x, 1e-3);
  return texture(uGroove, vec2(x, 0.5)).rg;
}

vec3 vinyl(vec2 p, float r, vec3 pos, vec3 v, float theta) {
  vec2 t2 = vec2(-p.y, p.x) / max(r, 1e-3);
  vec2 rr = p / max(r, 1e-3);
  vec3 lk = lightDir(pos, KEY);
  vec3 lf = lightDir(pos, FILL);
  vec3 hk = normalize(lk + v);
  vec3 hf = normalize(lf + v);
  vec3 base = vec3(0.0022, 0.0022, 0.0025);
  float a = fract((uRec.x - theta) / TAU);

  if (r > R_REC - 1.5) {
    float s = clamp((r - (R_REC - 1.5)) / 1.5, 0.0, 1.0);
    float ang = s * 1.15;
    vec3 n = normalize(vec3(rr * sin(ang), cos(ang)));
    float f = 0.045 + 0.6 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    return base + env(pos, reflect(-v, n)) * f;
  }
  if (r > R_LEAD || (r < R_LOCK - 0.6 && r > R_LABEL + 1.2)) {
    vec3 n = vec3(0.0, 0.0, 1.0);
    float ring = 0.0;
    if (r < R_LOCK) {
      float fr = abs(r - (R_LOCK - 0.8));
      ring = (1.0 - smoothstep(0.0, 0.25 + pxmm, fr)) * 0.6;
    }
    vec3 c = base + env(pos, reflect(-v, n)) * 0.047;
    c += vec3(0.5) * ring * aniso(hk, t2, 0.03, 0.4, 0.0) * 0.01;
    return c;
  }
  if (r <= R_LABEL + 1.2) {
    float lip = smoothstep(R_LABEL, R_LABEL + 1.2, r);
    vec3 n = normalize(vec3(rr * (1.0 - lip) * 0.5, 1.0));
    return base + env(pos, reflect(-v, n)) * 0.05;
  }

  vec4 seg = segFor(r);
  float u = (seg.z + (seg.x - r) / max(seg.y, 1e-3) * uSide.y) / uSide.y;
  float g = u - a;
  float k0 = floor(g);
  float fr = g - k0;
  float t0 = (k0 + a) * uSide.y;
  float t1 = t0 + uSide.y;
  float pitchPx = seg.y / pxmm;
  float blurA = clamp(uRec.z / TAU, 0.0, 0.08);
  vec2 g0 = vec2(0.0, 0.5);
  vec2 g1 = vec2(0.0, 0.5);
  if (seg.w > 0.5) {
    g0 = grooveSample(t0, seg);
    g1 = grooveSample(t1, seg);
    if (blurA > 0.012) {
      float dt = blurA * uSide.y * 0.5;
      g0 = (g0 + grooveSample(t0 - dt, seg) + grooveSample(t0 + dt, seg)) / 3.0;
      g1 = (g1 + grooveSample(t1 - dt, seg) + grooveSample(t1 + dt, seg)) / 3.0;
    }
  }
  float sharp = clamp((pitchPx - 1.5) / 3.0, 0.0, 1.0);
  float w = mix(fr, step(0.5, fr), sharp * 0.5);
  vec2 gs = mix(g0, g1, w);
  if (uFlags.y < 0.5) gs = vec2(0.35, 0.5);
  float e = seg.w > 0.5 ? gs.x : 0.0;
  float slope = (gs.y - 0.5) * 2.0 * e;
  float at = mix(0.018, 0.065, e);
  float tilt = slope * 0.07;
  float sk = aniso(hk, t2, at, 0.55, tilt);
  float sf = aniso(hf, t2, at * 1.3, 0.55, tilt);
  float line = 1.0 + 0.3 * sharp * cos(TAU * fr);
  float spec = (sk * 0.05 * 5.0 + sf * 0.05 * 1.3) * 0.25 * line * (1.0 - 0.25 * e);
  vec3 c = base + vec3(spec) * vec3(0.98, 0.985, 1.0);
  c += vec3(0.0015 + 0.005 * e) * (0.7 + 0.3 * dot(lk.xy, -rr));
  return c;
}

vec3 label(vec2 p, float r, vec3 pos, vec3 v) {
  vec2 q = rot(p, -uRec.x);
  vec3 col;
  float px = R_LABEL * uRec.z * uView.z;
  if (uFlags.x < 0.5) {
    col = vec3(0.86, 0.82, 0.74);
  } else if (px > 0.8) {
    col = vec3(0.0);
    for (int i = 0; i < 5; i++) {
      float o = (float(i) - 2.0) / 4.0 * uRec.z * 0.5;
      vec2 qq = rot(q, o);
      col += texture(uLabel, qq / (2.0 * R_LABEL) + 0.5).rgb;
    }
    col /= 5.0;
  } else {
    col = texture(uLabel, q / (2.0 * R_LABEL) + 0.5).rgb;
  }
  col = pow(col, vec3(2.2));
  float fib = vnoise(q * 3.1) * 0.5 + vnoise(q * 9.0) * 0.5;
  col *= 0.94 + 0.08 * fib;
  vec3 lk = lightDir(pos, KEY);
  float lam = 0.55 + 0.45 * lk.z;
  vec3 h = normalize(lk + v);
  float sheen = pow(max(h.z, 0.0), 220.0) * 0.12;
  col = col * lam * 1.12 + sheen + env(pos, vec3(0.0, 0.0, 1.0)) * 0.006;
  if (r < 3.7) {
    float s = r / 3.7;
    vec3 n = normalize(vec3(p / max(r, 1e-3) * s * 0.9, 1.0));
    vec3 m = vec3(0.30) + env(pos, reflect(-v, n)) * 0.55;
    col = mix(col, m, cover(r - 3.6));
  }
  float hole = smoothstep(3.6 + pxmm, 3.6 + 0.9, r);
  col *= 1.0 - 0.45 * hole * smoothstep(3.6, 4.4, r);
  return col;
}

vec3 felt(vec2 p, float r, float theta) {
  float tl = theta - uRec.y;
  float smear = 1.0 + uRec.w * r * 1.6;
  vec2 q = vec2(r * 2.4, tl * r * 2.4 / smear);
  float n = vnoise(q) * 0.55 + vnoise(q * 2.7 + 7.0) * 0.3 + vnoise(q * 6.1 + 3.0) * 0.15;
  vec3 c = vec3(0.032, 0.031, 0.033) * (0.7 + 0.6 * n);
  float edge = smoothstep(R_MAT - 0.9, R_MAT, r);
  c *= 1.0 - 0.5 * edge;
  return c;
}

vec3 platterRim(vec2 p, float r, vec3 pos, vec3 v, float theta) {
  vec2 rr = p / max(r, 1e-3);
  vec2 t2 = vec2(-rr.y, rr.x);
  vec3 lk = lightDir(pos, KEY);
  vec3 lf = lightDir(pos, FILL);
  vec3 n = vec3(0.0, 0.0, 1.0);
  float bev = smoothstep(R_PLAT - 2.6, R_PLAT, r);
  float ang = bev * 1.0;
  n = normalize(vec3(rr * sin(ang), cos(ang)));
  float stepIn = smoothstep(R_MAT + 1.2, R_MAT, r);
  n = normalize(n + vec3(-rr * stepIn * 0.8, 0.0));
  vec3 hk = normalize(lk + v);
  vec3 hf = normalize(lf + v);
  float lathe = vnoise(vec2(r * 9.0, 0.5)) * 0.6 + vnoise(vec2(r * 31.0, 3.0)) * 0.4;
  float spec = aniso(hk, t2, 0.16, 0.45, (lathe - 0.5) * 0.03) * 6.0 + aniso(hf, t2, 0.2, 0.45, 0.0) * 1.3;
  float lam = max(dot(n, lk), 0.0);
  vec3 metal = vec3(0.62, 0.625, 0.635);
  vec3 c = metal * (0.12 + 0.28 * lam) * (0.96 + 0.08 * lathe) + metal * spec * 0.05;
  c += env(pos, reflect(-v, n)) * 0.08 * metal;
  c *= 1.0 - 0.55 * stepIn;

  float lampA = atan(LAMP.y, LAMP.x);
  float dA = abs(mod(theta - lampA + PI, TAU) - PI);
  float zone = exp(-dA * dA / (2.0 * 0.26 * 0.26)) * uStrobe.z;
  for (int row = 0; row < 2; row++) {
    float rowR = row == 0 ? 159.6 : 163.0;
    float count = row == 0 ? 108.0 : 104.0;
    float spacing = TAU / count;
    float dr = r - rowR;
    if (abs(dr) > 1.6) continue;
    float phTrue = uRec.y;
    float phStrobe = row == 0 ? uStrobe.x : uStrobe.y;
    float dotR = 0.75;
    float cellT = (theta - phTrue) / spacing;
    float arcT = (fract(cellT) - 0.5) * spacing * rowR;
    float dT = length(vec2(arcT, dr)) - dotR;
    float smear = clamp(uRec.w * rowR / (spacing * rowR), 0.0, 1.0);
    float mT = mix(cover(dT), (1.0 - smoothstep(dotR - pxmm, dotR + pxmm, abs(dr))) * 0.45, smear);
    float cellS = (theta - phStrobe) / spacing;
    float arcS = (fract(cellS) - 0.5) * spacing * rowR;
    float dS = length(vec2(arcS, dr)) - dotR;
    float mS = cover(dS);
    vec3 dimple = c * 0.35;
    c = mix(c, dimple, mT * (1.0 - zone));
    vec3 lit = LAMP_COL * (1.2 + 1.6 * (1.0 - smoothstep(0.0, dotR, length(vec2(arcS, dr)))));
    c = mix(c, lit, mS * zone);
  }
  c += LAMP_COL * zone * 0.05 * (1.0 - bev);
  return c;
}

vec3 plinth(vec2 p, vec3 pos, vec3 v) {
  vec2 ctr = (PLINTH.xy + PLINTH.zw) * 0.5;
  vec2 hs = (PLINTH.zw - PLINTH.xy) * 0.5;
  float d = sdBox(p - ctr, hs, 14.0);
  vec3 lk = lightDir(pos, KEY);
  vec3 lf = lightDir(pos, FILL);
  vec3 ground = vec3(0.79, 0.785, 0.765);
  float gsh = 1.0 - 0.32 * smoothstep(26.0, -10.0, sdBox(p - ctr + KEY.xy / KEY.z * 30.0, hs, 14.0));
  gsh *= 1.0 - 0.25 * smoothstep(5.0, -1.0, d);
  ground *= gsh;
  if (d > 2.0 * pxmm + 0.5) return ground;
  vec2 gradE = vec2(0.0, -1.0);
  if (d > -4.5) gradE = vec2(
    sdBox(p - ctr + vec2(0.5, 0.0), hs, 14.0) - sdBox(p - ctr - vec2(0.5, 0.0), hs, 14.0),
    sdBox(p - ctr + vec2(0.0, 0.5), hs, 14.0) - sdBox(p - ctr - vec2(0.0, 0.5), hs, 14.0)
  );
  vec2 outward = normalize(-gradE + 1e-5);
  float bev = smoothstep(-4.0, 0.0, d);
  vec3 n = normalize(vec3(outward * sin(bev * 1.2), cos(bev * 1.2)));
  float brush = vnoise(vec2(p.x * 0.04, p.y * 7.0)) * 0.6 + vnoise(vec2(p.x * 0.12, p.y * 23.0)) * 0.4;
  vec3 hk = normalize(lk + v);
  vec3 hf = normalize(lf + v);
  float spec = aniso(hk, vec2(1.0, 0.0), 0.32, 0.75, (brush - 0.5) * 0.05) * 6.0 + aniso(hf, vec2(1.0, 0.0), 0.32, 0.75, 0.0) * 1.3;
  vec3 alu = vec3(0.80, 0.80, 0.795);
  float lam = max(dot(n, lk), 0.0);
  vec3 c = alu * (0.30 + 0.42 * lam) * (0.975 + 0.05 * brush) + alu * spec * 0.022;
  c += env(pos, reflect(-v, n)) * 0.025;
  return mix(ground, c, cover(d));
}

vec3 keycap(vec2 p, vec3 base, vec3 pos, vec3 v) {
  vec2 q = p - KEYCAP.xy;
  if (abs(q.x) > KEYCAP.z + 12.0 || abs(q.y) > KEYCAP.w + 12.0) return base;
  float press = uStrobe.w;
  float d = sdBox(q, KEYCAP.zw, 3.0);
  float sh = smoothstep(4.0, -1.0, sdBox(q + KEY.xy / KEY.z * (4.0 - 3.0 * press), KEYCAP.zw, 3.0));
  base *= 1.0 - 0.32 * sh * (1.0 - cover(d));
  float well = smoothstep(1.4, 0.0, abs(d + 0.0));
  base *= 1.0 - 0.25 * well * (1.0 - cover(d));
  if (d > pxmm) return base;
  vec3 lk = lightDir(pos, KEY);
  float bev = smoothstep(-1.8, 0.0, d);
  vec2 gd = normalize(vec2(
    sdBox(q + vec2(0.4, 0.0), KEYCAP.zw, 3.0) - sdBox(q - vec2(0.4, 0.0), KEYCAP.zw, 3.0),
    sdBox(q + vec2(0.0, 0.4), KEYCAP.zw, 3.0) - sdBox(q - vec2(0.0, 0.4), KEYCAP.zw, 3.0)
  ) + 1e-5);
  vec3 n = normalize(vec3(-gd * sin(bev * 1.1), cos(bev * 1.1)));
  float brush = vnoise(vec2(q.x * 0.1, q.y * 9.0));
  vec3 hk = normalize(lk + v);
  float spec = aniso(hk, vec2(1.0, 0.0), 0.3, 0.7, 0.0) * 6.0;
  vec3 alu = vec3(0.36, 0.36, 0.365) * (1.0 - 0.15 * press);
  vec3 c = alu * (0.26 + 0.42 * max(dot(n, lk), 0.0)) * (0.97 + 0.06 * brush) + alu * spec * 0.02;
  c += env(pos, reflect(-v, n)) * 0.03;
  return mix(base, c, cover(d));
}

vec3 lamp(vec2 p, vec3 base, vec3 pos, vec3 v) {
  vec2 q = p - LAMP;
  float d = length(q);
  if (d > 60.0) return base;
  float sh = smoothstep(9.0, 5.0, length(q + KEY.xy / KEY.z * 8.0));
  base *= 1.0 - 0.3 * sh * step(7.5, d);
  float glow = exp(-max(d - 4.0, 0.0) / 9.0) * uStrobe.z;
  base += LAMP_COL * glow * 0.12;
  if (d > 7.5 + pxmm) return base;
  float s = clamp(d / 7.5, 0.0, 1.0);
  vec3 n = normalize(vec3(q / max(d, 1e-3) * s * 0.8, 1.0));
  vec3 c = vec3(0.25) * (0.3 + 0.5 * max(dot(n, lightDir(pos, KEY)), 0.0)) + env(pos, reflect(-v, n)) * 0.12;
  vec3 lens = LAMP_COL * (0.5 + 2.2 * uStrobe.z * (1.0 - smoothstep(0.0, 4.2, d)));
  c = mix(c, lens, cover(d - 4.4));
  return mix(base, c, cover(d - 7.5));
}

vec3 armBase(vec2 p, vec3 base, vec3 pos, vec3 v) {
  vec2 q = p - PIVOT;
  if (p.x < 140.0 || p.y > 50.0 || p.y < -150.0) return base;
  float d = length(q) - 33.0;
  float sh = smoothstep(6.0, -2.0, length(q + KEY.xy / KEY.z * 6.0) - 33.0);
  base *= 1.0 - 0.28 * sh * step(0.0, d);
  vec2 rest = vec2(190.0, 32.0) - p;
  float dr = sdBox(rest, vec2(8.0, 5.0), 2.0);
  float shr = smoothstep(5.0, -1.0, sdBox(rest - KEY.xy / KEY.z * 10.0, vec2(8.0, 5.0), 2.0));
  base *= 1.0 - 0.3 * shr * step(0.0, dr);
  vec3 lk = lightDir(pos, KEY);
  vec3 restC = vec3(0.05) + env(pos, vec3(0.0, 0.0, 1.0)) * 0.01 + vec3(0.05) * smoothstep(-1.5, 0.0, dr) * max(dot(normalize(-rest + 1e-4), -lk.xy), 0.0);
  base = mix(base, restC, cover(dr));
  vec2 cue = rot(p - vec2(230.0, -44.0), 0.35);
  float dc = sdBox(cue, vec2(3.0, 14.0), 2.0);
  float dk = length(cue - vec2(0.0, 13.0)) - 4.2;
  float shc = smoothstep(5.0, -1.0, min(sdBox(cue + rot(KEY.xy, 0.35) / KEY.z * 9.0, vec2(3.0, 14.0), 2.0), length(cue + rot(KEY.xy, 0.35) / KEY.z * 9.0 - vec2(0.0, 13.0)) - 4.2));
  base *= 1.0 - 0.28 * shc * step(0.0, min(dc, dk));
  vec3 cueC = vec3(0.55) * (0.3 + 0.5 * lk.z) + env(pos, vec3(0.0, 0.0, 1.0)) * 0.02;
  base = mix(base, cueC, cover(dc));
  vec2 kn = cue - vec2(0.0, 13.0);
  vec3 kN = normalize(vec3(kn / 4.2 * 0.8, 1.0));
  vec3 knob = vec3(0.03) + env(pos, reflect(-v, kN)) * 0.05;
  base = mix(base, knob, cover(dk));
  if (d > pxmm) return base;
  float s = clamp(length(q) / 33.0, 0.0, 1.0);
  float bev = smoothstep(0.86, 1.0, s);
  vec3 n = normalize(vec3(q / max(length(q), 1e-3) * sin(bev * 1.1), cos(bev * 1.1)));
  vec2 t2 = vec2(-q.y, q.x) / max(length(q), 1e-3);
  vec3 hk = normalize(lk + v);
  float spec = aniso(hk, t2, 0.14, 0.5, 0.0) * 6.0;
  vec3 alu = vec3(0.72, 0.72, 0.725);
  float ring = smoothstep(0.6, 0.0, abs(length(q) - 24.0));
  vec3 c = alu * (0.22 + 0.4 * max(dot(n, lk), 0.0)) + alu * spec * 0.03;
  c *= 1.0 - 0.3 * ring;
  return mix(base, c, cover(d));
}

float armSdf(vec2 p, out float which) {
  vec2 P = uArmA.xy;
  vec2 J = uArmA.zw;
  vec2 S = uArmB.xy;
  vec2 hd = uArmC.xy;
  vec2 u = normalize(J - P + 1e-5);
  float dTube = sdSeg(p, P, J) - 4.0;
  float dHead = sdOriented(p, J - hd * 5.0, S + hd * 9.0, 8.5, 2.5);
  vec2 side = vec2(-hd.y, hd.x) * uArmC.z;
  vec2 lf = S - hd * 15.0;
  float dLift = sdSeg(p, lf, lf + side * 17.0 - hd * 3.0) - 1.6;
  float dCart = sdOriented(p, S - hd * 21.0, S + hd * 4.0, 7.0, 1.6);
  float dCw = sdOriented(p, P - u * 22.0, P - u * 56.0, 15.5, 3.5);
  float dBear = length(p - P) - 15.0;
  float d = min(min(min(dTube, dHead), min(dLift, dCart)), min(dCw, dBear));
  which = 0.0;
  return d;
}

vec4 tonearm(vec2 p, vec3 pos, vec3 v) {
  vec2 P = uArmA.xy;
  vec2 J = uArmA.zw;
  vec2 S = uArmB.xy;
  vec2 hd = uArmC.xy;
  vec2 u = normalize(J - P + 1e-5);
  vec3 lk = lightDir(pos + vec3(0.0, 0.0, 20.0), KEY);
  vec3 col = vec3(0.0);
  float a = 0.0;

  float dCw = sdOriented(p, P - u * 22.0, P - u * 56.0, 15.5, 3.5);
  if (dCw < pxmm) {
    vec2 q = p - P;
    float along = -dot(q, u);
    float across = dot(q, vec2(-u.y, u.x)) / 15.5;
    vec3 n = normalize(vec3(vec2(-u.y, u.x) * across, sqrt(max(1.0 - across * across, 0.02))));
    float knurl = smoothstep(0.3, 0.9, abs(fract(along * 0.5) - 0.5) * 2.0) * step(along, 30.0);
    vec3 c = vec3(0.10) * (0.4 + 0.6 * max(dot(n, lk), 0.0)) + env(pos, reflect(-v, n)) * 0.12 * (1.0 - 0.6 * knurl);
    float m = cover(dCw);
    col = mix(col, c, m);
    a = max(a, m);
  }
  float dBear = length(p - P) - 15.0;
  if (dBear < pxmm) {
    vec2 q = p - P;
    float s = clamp(length(q) / 15.0, 0.0, 1.0);
    vec3 n = normalize(vec3(q / max(length(q), 1e-3) * s * 0.85, 1.0));
    float ring = smoothstep(0.5, 0.0, abs(length(q) - 10.0));
    vec3 c = vec3(0.5) * (0.25 + 0.45 * max(dot(n, lk), 0.0)) + env(pos, reflect(-v, n)) * 0.5 * vec3(0.9);
    c *= 1.0 - 0.4 * ring;
    float m = cover(dBear);
    col = mix(col, c, m);
    a = max(a, m);
  }
  float dTube = sdSeg(p, P, J) - 4.0;
  if (dTube < pxmm) {
    vec2 nrm = vec2(-u.y, u.x);
    float across = clamp(dot(p - P, nrm) / 4.0, -1.0, 1.0);
    vec3 n = normalize(vec3(nrm * across, sqrt(max(1.0 - across * across, 0.02))));
    vec3 c = vec3(0.5) * (0.12 + 0.3 * max(dot(n, lk), 0.0)) + env(pos + vec3(0.0, 0.0, 22.0), reflect(-v, n)) * 0.5;
    float m = cover(dTube);
    col = mix(col, c, m);
    a = max(a, m);
  }
  vec2 side = vec2(-hd.y, hd.x) * uArmC.z;
  vec2 lf = S - hd * 15.0;
  float dLift = sdSeg(p, lf, lf + side * 17.0 - hd * 3.0) - 1.6;
  float dHead = sdOriented(p, J - hd * 5.0, S + hd * 9.0, 8.5, 2.5);
  if (min(dHead, dLift) < pxmm) {
    float bev = smoothstep(-1.5, 0.0, dHead);
    vec3 c = vec3(0.022) * (0.6 + 0.4 * lk.z) + env(pos, vec3(0.0, 0.0, 1.0)) * 0.01;
    c += vec3(0.08) * bev * max(dot(normalize(p - (J + S) * 0.5 + 1e-4), -lk.xy), 0.0);
    float acr = clamp(dot(p - lf, normalize(side * 17.0 - hd * 3.0)), 0.0, 17.0);
    float liftAcross = clamp((dot(p - lf, vec2(-side.y, side.x))) / 1.6, -1.0, 1.0);
    vec3 nl = normalize(vec3(vec2(-side.y, side.x) * liftAcross, sqrt(max(1.0 - liftAcross * liftAcross, 0.02))));
    vec3 cl = vec3(0.5) * 0.3 + env(pos, reflect(-v, nl)) * 0.5;
    c = mix(c, cl, cover(dLift) * step(0.5, acr));
    float m = cover(min(dHead, dLift));
    col = mix(col, c, m);
    a = max(a, m);
  }
  float dCart = sdOriented(p, S - hd * 21.0, S + hd * 4.0, 7.0, 1.6);
  if (dCart < pxmm) {
    float bev = smoothstep(-1.4, 0.0, dCart);
    vec3 accent = vec3(0.045, 0.23, 0.92);
    vec3 c = accent * (0.35 + 0.4 * lk.z) * (1.0 - 0.35 * bev) + env(pos, vec3(0.0, 0.0, 1.0)) * 0.03;
    vec2 qc = p - S;
    float screw = min(length(qc + hd * 9.0 + vec2(-hd.y, hd.x) * 4.0), length(qc + hd * 9.0 - vec2(-hd.y, hd.x) * 4.0)) - 1.1;
    c = mix(c, vec3(0.5), cover(screw) * 0.8);
    float m = cover(dCart);
    col = mix(col, c, m);
    a = max(a, m);
  }
  return vec4(col, a);
}

void main() {
  vec2 css = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 p = (css - uView.xy) / uView.z;
  if (uFlags.z > 0.5) p = vec2(p.y, -p.x);
  pxmm = 1.0 / uView.z;
  vec3 pos = vec3(p, 0.0);
  vec3 v = normalize(uEye - pos);
  float r = length(p);
  float theta = atan(p.y, p.x);

  vec3 c = plinth(p, pos, v);
  if (r < R_PLAT + 26.0) {
    float sh = shadowOf(p, 16.0, R_PLAT);
    float ao = exp(-max(r - R_PLAT, 0.0) / 2.5);
    c *= (1.0 - 0.34 * sh) * (1.0 - 0.3 * ao * step(R_PLAT, r));
  }
  c = keycap(p, c, pos, v);
  c = lamp(p, c, pos, v);
  c = armBase(p, c, pos, v);

  if (r < R_PLAT + pxmm) {
    vec3 plat = vec3(0.0);
    if (r > R_MAT - 1.5) plat = platterRim(p, r, pos + vec3(0.0, 0.0, 16.0), v, theta);
    if (r < R_MAT + pxmm && r > R_REC - 1.0) {
      vec3 f = felt(p, r, theta);
      float recShadow = smoothstep(R_REC + 3.0, R_REC - 0.5, length(p + KEY.xy / KEY.z * 2.5));
      f *= 1.0 - 0.5 * recShadow;
      plat = mix(plat, f, cover(r - R_MAT));
    }
    if (r < R_REC + pxmm) {
      vec3 rec;
      if (r < R_LABEL) rec = label(p, r, pos + vec3(0.0, 0.0, 18.0), v);
      else rec = vinyl(p, r, pos + vec3(0.0, 0.0, 18.0), v, theta);
      plat = mix(plat, rec, cover(r - R_REC));
    }
    c = mix(c, plat, cover(r - R_PLAT));
  }

  float lift = uArmB.z;
  float height = 20.0 + 16.0 * lift;
  vec2 off = -KEY.xy / KEY.z * height;
  vec2 armBack = uArmA.xy - normalize(uArmA.zw - uArmA.xy) * 60.0;
  float blur = 1.4 + height * 0.09;
  if (sdSeg(p - off, armBack, uArmB.xy) < 24.0 + blur) {
    float wh;
    float ds = armSdf(p - off, wh);
    float armShadow = smoothstep(blur, -blur, ds) * (0.42 - 0.12 * lift);
    c *= 1.0 - armShadow;
  }

  float dBound = sdSeg(p, armBack, uArmB.xy) - 22.0;
  if (dBound < 0.0) {
    vec4 arm = tonearm(p, pos + vec3(0.0, 0.0, 30.0), v);
    c = mix(c, arm.rgb, arm.a);
  }

  vec3 over = max(c - 0.78, 0.0);
  c = min(c, 0.78) + 0.22 * (1.0 - exp(-over / 0.22));
  c = pow(max(c, 0.0), vec3(1.0 / 2.2));
  c += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;
