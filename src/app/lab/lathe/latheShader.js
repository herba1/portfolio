export const LATHE_VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const LATHE_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform vec2 uRes;
uniform float uDpr;
uniform vec3 uView;
uniform vec3 uEye;
uniform float uRot;
uniform vec4 uPlat;
uniform vec4 uCut;
uniform vec4 uArm;
uniform vec4 uLens;
uniform vec4 uGroove;
uniform vec4 uChip[32];
uniform vec4 uChipInfo;
uniform vec4 uChipBox;
uniform vec4 uHose[14];
uniform vec4 uHoseBox;
uniform sampler2D uData;

out vec4 outColor;

const float PI = 3.14159265;
const float TAU = 6.2831853;
const float R_LAC = 178.0;
const float R_PLAT = 186.0;
const vec4 DECK = vec4(-250.0, -238.0, 374.0, 238.0);
const vec3 KEY = vec3(-560.0, -720.0, 1250.0);
const vec3 FILL = vec3(900.0, 380.0, 1100.0);
const vec3 BOX = vec3(-230.0, -300.0, 1250.0);
const vec2 ARM_P = vec2(-205.0, -190.0);
const vec2 MIC_B = vec2(342.0, -206.0);
const vec2 MIC_L = vec2(176.0, -132.0);
const float MIC_R = 44.0;
const float GLASS_R = 36.0;
const vec3 WARM = vec3(1.0, 0.88, 0.74);
const vec3 LAMP = vec3(1.0, 0.82, 0.6);
const float RAIL_Y = 40.0;
const float RAIL_X0 = 186.0;
const float RAIL_X1 = 372.0;

float pxs;
float gSoft = 70.0;

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
  return clamp(0.5 - d / pxs, 0.0, 1.0);
}

float coverW(float d, float w) {
  return clamp(0.5 - d / max(w, 1e-4), 0.0, 1.0);
}

float band(float lo, float hi, float x) {
  return 1.0 - smoothstep(lo, hi, x);
}

vec2 band2(vec2 lo, vec2 hi, vec2 x) {
  return vec2(1.0) - smoothstep(lo, hi, x);
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

float sdTaper(vec2 p, vec2 a, vec2 b, float ra, float rb) {
  vec2 ba = b - a;
  float l = max(length(ba), 1e-4);
  vec2 u = ba / l;
  vec2 q = p - a;
  q = vec2(abs(dot(q, vec2(-u.y, u.x))), dot(q, u));
  float bb = (ra - rb) / l;
  float aa = sqrt(max(1.0 - bb * bb, 0.0));
  float k = dot(q, vec2(-bb, aa));
  if (k < 0.0) return length(q) - ra;
  if (k > aa * l) return length(q - vec2(0.0, l)) - rb;
  return dot(q, vec2(aa, bb)) - ra;
}

vec2 rot(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

float softbox(vec3 pos, vec3 r, vec3 light, vec2 hs, float soft) {
  if (r.z < 0.02) return 0.0;
  float k = (light.z - pos.z) / r.z;
  vec2 q = pos.xy + r.xy * min(k, 1e5) - light.xy;
  vec2 e = band2(hs - soft, hs + soft, abs(q));
  return e.x * e.y;
}

vec3 env(vec3 pos, vec3 r) {
  float sky = 0.025 + 0.045 * clamp(r.z, 0.0, 1.0);
  float key = softbox(pos, r, BOX, vec2(250.0, 140.0), gSoft);
  float fill = softbox(pos, r, FILL, vec2(200.0, 360.0), 170.0);
  return vec3(1.0, 0.95, 0.88) * sky + WARM * key * 5.0 + vec3(0.9, 0.95, 1.0) * fill * 1.1;
}

float ward(vec3 n, vec3 t, vec3 l, vec3 v, float at, float ab) {
  float nl = dot(n, l);
  float nv = dot(n, v);
  if (nl <= 0.0 || nv <= 0.0) return 0.0;
  vec3 h = normalize(l + v);
  vec3 b = normalize(cross(n, t));
  vec3 tt = cross(b, n);
  float hn = max(dot(h, n), 1e-3);
  float ht = dot(h, tt) / at;
  float hb = dot(h, b) / ab;
  float e = (ht * ht + hb * hb) / (hn * hn);
  return exp(-min(e, 60.0)) * nl / (4.0 * PI * at * ab * sqrt(max(nl * nv, 1e-3)));
}

vec3 metalShade(vec3 n, vec3 t, vec3 pos, vec3 v, vec3 tint, float at, float ab, float diffuse) {
  vec3 lk = normalize(KEY - pos);
  vec3 lf = normalize(FILL - pos);
  float sk = ward(n, t, lk, v, at, ab);
  float sf = ward(n, t, lf, v, at, ab);
  vec3 c = tint * (0.06 + diffuse * max(dot(n, lk), 0.0));
  c += tint * (WARM * sk * 2.4 + vec3(0.9, 0.95, 1.0) * sf * 0.7) * 0.25;
  c += env(pos, reflect(-v, n)) * tint * 0.05;
  return c;
}

vec3 paintShade(vec3 n, vec3 pos, vec3 v, vec3 alb, float gloss) {
  vec3 lk = normalize(KEY - pos);
  vec3 lf = normalize(FILL - pos);
  float dk = max(dot(n, lk), 0.0);
  float df = max(dot(n, lf), 0.0);
  vec3 c = alb * (WARM * dk * 0.82 + vec3(0.9, 0.95, 1.0) * df * 0.2 + 0.1);
  vec3 h = normalize(lk + v);
  c += WARM * pow(max(dot(n, h), 0.0), 60.0) * gloss;
  return c;
}

vec4 fetchD(float i) {
  float W = uGroove.y;
  float row = floor(i / W);
  float col = i - row * W;
  return texelFetch(uData, ivec2(int(col), int(row)), 0);
}

vec4 groove(float u, float r, float smear, out float slope) {
  slope = 0.0;
  float W = uGroove.y;
  if (u < 0.0 || u * W >= uGroove.x * W - 1.0) return vec4(0.0);
  float s = u * W;
  float i0 = floor(s);
  float f = s - i0;
  vec4 a = fetchD(i0);
  vec4 b = fetchD(i0 + 1.0);
  float depth = mix(a.w, b.w, f);
  if (depth < 0.001) return vec4(0.0);
  float dp = mod(b.z - a.z, 64.0);
  float w = mix(a.x, b.x, f);
  float g = mix(a.y, b.y, f);
  float ph = a.z + dp * f;
  float P = uGroove.w;
  float A1 = 0.24 * P;
  float A2 = 0.15 * P * g * (1.0 - smear);
  float off = w * A1 + A2 * sin(TAU * ph);
  float dsdu = TAU * max(r, 1.0);
  float dwdu = (b.x - a.x) * W;
  float dfine = A2 * TAU * cos(TAU * ph) * dp * W;
  slope = clamp((dwdu * A1 + dfine) / dsdu, -1.5, 1.5);
  float hw = (P * (0.19 + 0.11 * g) + smear * 0.15 * P * g) * depth;
  return vec4(off, hw, depth, g);
}

vec3 wallNormal(float side, float slope, vec2 rad, vec2 tng) {
  vec2 nh = side * (-rad + slope * tng);
  nh /= max(length(nh), 1e-4);
  return normalize(vec3(nh * 0.62, 1.0));
}

vec3 wallMain(float side, float slope, float g, vec2 rad, vec2 tng, vec3 pos, vec3 v) {
  vec3 n = wallNormal(side, slope, rad, tng);
  vec3 t = normalize(vec3(tng + slope * rad, 0.0));
  float at = 0.07 + 0.2 * g;
  vec3 lk = normalize(KEY - pos);
  vec3 lf = normalize(FILL - pos);
  float sk = ward(n, t, lk, v, at, 0.42);
  float sf = ward(n, t, lf, v, at, 0.42);
  vec3 c = vec3(0.004, 0.0038, 0.0042);
  float fr = 0.04 + 0.96 * pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 5.0);
  c += env(pos, reflect(-v, n)) * fr * 0.35;
  c += (WARM * sk * 1.8 + vec3(0.9, 0.95, 1.0) * sf * 0.45) * (0.9 - 0.2 * g);
  return c;
}

vec3 wallLens(float side, float slope, float g, vec2 rad, vec2 tng, float x, float hw) {
  vec3 n = wallNormal(side, slope, rad, tng);
  vec3 l = normalize(vec3(-0.5, -0.66, 0.56));
  vec3 h = normalize(l + vec3(0.0, 0.0, 1.0));
  float nh = max(dot(n, h), 0.0);
  float s = pow(nh, 30.0) * 2.2 + pow(nh, 4.0) * 0.28;
  float d = max(dot(n, l), 0.0) * 0.05;
  float bottom = smoothstep(0.0, 0.16, abs(x) / max(hw, 1e-3));
  float lip = smoothstep(0.72, 1.0, abs(x) / max(hw, 1e-3));
  return vec3(0.006) + LAMP * (s + d) * (0.35 + 0.65 * bottom) + LAMP * lip * 0.05;
}

vec3 lacquer(vec2 q, vec3 pos, vec3 v, float lensMode, float smear, float px) {
  float r = length(q);
  vec2 rad = q / max(r, 1e-3);
  vec2 tng = vec2(-rad.y, rad.x);
  vec3 land;
  if (lensMode < 0.5) {
    float wav = vnoise(q * 0.035) - 0.5;
    vec3 n = normalize(vec3(rad * wav * 0.006, 1.0));
    float fr = 0.04 + 0.96 * pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 5.0);
    land = vec3(0.0035, 0.0034, 0.0038) + env(pos, reflect(-v, n)) * fr;
  } else {
    float grain = vnoise(q * 9.0) * 0.6 + vnoise(q * 27.0) * 0.4;
    land = vec3(0.012, 0.011, 0.011) * (0.8 + 0.4 * grain) + LAMP * 0.012;
  }
  float P = uGroove.w;
  float alpha = atan(q.y, q.x) - uPlat.x;
  float fa = fract(-alpha / TAU);
  float ur = (uGroove.z - r) / P;
  float u0 = floor(ur - fa) + fa;
  float ua = smoothstep(0.12, 0.55, px / P);
  float covSum = 0.0;
  vec3 gsum = vec3(0.0);
  for (int k = 0; k < 2; k++) {
    float u = u0 + float(k);
    float sl;
    vec4 gd = groove(u, r, lensMode < 0.5 ? 1.0 : smear, sl);
    if (gd.z < 0.001) continue;
    float rc = uGroove.z - P * u + gd.x;
    float x = r - rc;
    float covS = clamp((gd.y - abs(x)) / px + 0.5, 0.0, 1.0);
    float cov = mix(covS, gd.y / P, ua);
    if (cov <= 0.0) continue;
    vec3 sc;
    if (lensMode < 0.5) {
      vec3 wa = wallMain(1.0, sl, gd.w, rad, tng, pos, v);
      vec3 wb = wallMain(-1.0, sl, gd.w, rad, tng, pos, v);
      sc = mix(x >= 0.0 ? wa : wb, (wa + wb) * 0.5, max(ua, 1.0 - clamp(abs(x) / px, 0.0, 1.0)));
    } else {
      sc = wallLens(x >= 0.0 ? 1.0 : -1.0, sl, gd.w, rad, tng, x, gd.y);
    }
    gsum += sc * cov;
    covSum += cov;
  }
  vec3 c = land;
  if (covSum > 0.0) c = mix(land, gsum / covSum, min(covSum, 1.0));
  if (lensMode < 0.5) {
    float lip = smoothstep(R_LAC - 2.4, R_LAC - 0.4, r);
    if (lip > 0.0) {
      vec3 n = normalize(vec3(rad * sin(lip * 1.1), cos(lip * 1.1)));
      float fr = 0.04 + 0.96 * pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 5.0);
      vec3 rim = vec3(0.0035) + env(pos, reflect(-v, n)) * fr;
      c = mix(c, rim, lip);
      float core = smoothstep(R_LAC - 0.9, R_LAC - 0.3, r);
      vec3 alu = metalShade(normalize(vec3(rad * 0.7, 0.7)), vec3(tng, 0.0), pos, v, vec3(0.75, 0.75, 0.76), 0.08, 0.4, 0.5);
      c = mix(c, alu, core * 0.9);
    }
    float hub = 1.0 - smoothstep(9.0, 9.0 + px, r);
    float ringD = abs(r - 9.0);
    c *= 1.0 - 0.5 * band(0.0, 0.5 + px, ringD);
    c = mix(c, c * 0.8 + env(pos, vec3(0.0, 0.0, 1.0)) * 0.004, hub * 0.3);
  }
  return c;
}

vec3 platterTop(vec2 p, float r, vec3 pos, vec3 v) {
  vec2 rad = p / max(r, 1e-3);
  vec2 tng = vec2(-rad.y, rad.x);
  float turn = vnoise(vec2(r * 7.0, 0.5)) * 0.6 + vnoise(vec2(r * 29.0, 3.0)) * 0.4;
  vec3 n = vec3(0.0, 0.0, 1.0);
  float bev = smoothstep(R_PLAT - 3.0, R_PLAT, r);
  n = normalize(vec3(rad * sin(bev * 1.1), cos(bev * 1.1)));
  vec3 c = metalShade(n, vec3(tng, 0.0), pos, v, vec3(0.7, 0.705, 0.71) * (0.95 + 0.1 * turn), 0.04 + 0.03 * turn, 0.5, 0.42);
  for (int i = 0; i < 4; i++) {
    float rr = 44.0 + float(i) * 36.0;
    float d = abs(r - rr);
    c *= 1.0 - 0.7 * band(0.6, 0.6 + pxs, d);
    c += vec3(0.06) * band(0.0, 0.5, abs(r - rr - 1.0)) * max(dot(normalize(KEY.xy), -rad), 0.0);
  }
  float holeA = fract((atan(p.y, p.x) - uPlat.x) / TAU * 24.0) - 0.5;
  float hole = length(vec2(holeA * TAU * 62.0 / 24.0, r - 62.0)) - 1.1;
  c *= 1.0 - 0.8 * cover(hole);
  return c;
}

vec3 spindle(vec2 p, vec3 base, vec3 pos, vec3 v) {
  float r = length(p);
  if (r > 3.4 + pxs) return base;
  vec3 n = normalize(vec3(p / 3.4 * 0.95, 1.0));
  vec3 c = vec3(0.12) + env(pos + vec3(0.0, 0.0, 10.0), reflect(-v, n)) * 0.6;
  return mix(base, c, cover(r - 3.4));
}

float shadowSoft(float d, float blur) {
  return 1.0 - smoothstep(-blur, blur, d);
}

vec2 hoseHit(vec2 p) {
  float best = 1e9;
  float along = 0.0;
  for (int i = 0; i < 13; i++) {
    vec4 a = uHose[i];
    vec4 b = uHose[i + 1];
    vec2 pa = p - a.xy;
    vec2 ba = b.xy - a.xy;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    float d = length(pa - ba * h);
    if (d < best) {
      best = d;
      along = mix(a.z, b.z, h);
    }
  }
  return vec2(best, along);
}

vec4 chipHit(vec2 p) {
  float best = 1e9;
  float tw = 0.0;
  float hwOut = 0.0;
  int n = int(uChipInfo.x);
  for (int i = 0; i < 31; i++) {
    if (i + 1 >= n) break;
    vec4 a = uChip[i];
    vec4 b = uChip[i + 1];
    vec2 pa = p - a.xy;
    vec2 ba = b.xy - a.xy;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    float d = length(pa - ba * h);
    float t = mix(a.w, b.w, h);
    float hw = mix(a.z, b.z, h) * (0.3 + 0.7 * abs(cos(t)));
    if (d - hw < best) {
      best = d - hw;
      tw = t;
      hwOut = hw;
    }
  }
  return vec4(best, tw, hwOut, 0.0);
}

vec3 chipColor(float tw, float face, vec3 pos, vec3 v) {
  float glint = pow(max(cos(tw - 0.7), 0.0), 18.0);
  float soft = pow(max(cos(tw - 0.7), 0.0), 3.0);
  vec3 c = vec3(0.008) + WARM * (glint * 1.6 + soft * 0.08) + env(pos, vec3(0.0, 0.0, 1.0)) * 0.012 * abs(cos(tw));
  return c * (0.7 + 0.3 * face);
}

vec2 stylusTip() {
  return vec2(uCut.x + uCut.z, 0.0);
}

vec2 armDir() {
  return vec2(cos(uArm.x), sin(uArm.x));
}

vec2 headDir() {
  return rot(armDir(), 0.42);
}

float occluders(vec2 p, float zs) {
  vec2 L = KEY.xy / KEY.z;
  float s = 1.0;
  float sr = uCut.x;
  float lift = uCut.y;
  {
    float h = 34.0 - zs;
    vec2 q = p + L * h;
    float d = min(sdSeg(q, vec2(RAIL_X0, -RAIL_Y), vec2(RAIL_X1, -RAIL_Y)), sdSeg(q, vec2(RAIL_X0, RAIL_Y), vec2(RAIL_X1, RAIL_Y))) - 4.5;
    d = min(d, sdSeg(q, vec2(RAIL_X0, 0.0), vec2(RAIL_X1, 0.0)) - 3.5);
    s *= 1.0 - 0.38 * shadowSoft(d, 1.0 + h * 0.04);
  }
  {
    float h = 48.0 - zs;
    vec2 q = p + L * h;
    float d = sdBox(q - vec2(sr + 156.0, 0.0), vec2(31.0, 58.0), 6.0);
    d = min(d, sdBox(q - vec2(sr + 108.0, 0.0), vec2(22.0, 13.0), 3.0));
    s *= 1.0 - 0.42 * shadowSoft(d, 1.0 + h * 0.05);
  }
  {
    float h = 70.0 + lift * 7.0 - zs;
    vec2 q = p + L * h;
    float d = sdBox(q - vec2(sr + 57.0, 0.0), vec2(35.0, 27.0), 9.0);
    float hn = 26.0 + lift * 7.0 - zs;
    vec2 qn = p + L * hn;
    float dn = sdTaper(qn, vec2(sr + 3.0, 0.0), vec2(sr + 26.0, 0.0), 1.6, 9.0);
    s *= 1.0 - 0.45 * shadowSoft(d, 1.2 + h * 0.05);
    s *= 1.0 - 0.45 * shadowSoft(dn, 0.5 + hn * 0.06);
    float hs = 3.0 + lift * 7.0;
    vec2 qs = p + L * hs - stylusTip();
    s *= 1.0 - 0.5 * shadowSoft(length(qs) - 0.7, 0.3 + hs * 0.08);
  }
  if (p.x > uHoseBox.x - 30.0 && p.y > uHoseBox.y - 30.0 && p.x < uHoseBox.z + 30.0 && p.y < uHoseBox.w + 30.0) {
    float h = 22.0 - zs;
    vec2 hh = hoseHit(p + L * max(h, 0.0));
    s *= 1.0 - 0.3 * shadowSoft(hh.x - 4.4, 1.0 + max(h, 0.0) * 0.06);
  }
  {
    float h = 56.0 + uArm.y * 12.0 - zs;
    vec2 q = p + L * h;
    vec2 u = armDir();
    vec2 S = uArm.zw;
    vec2 hd = headDir();
    float d = sdSeg(q, ARM_P, S - hd * 14.0) - 3.2;
    d = min(d, sdOriented(q, S - hd * 17.0, S + hd * 3.0, 5.5, 1.5));
    d = min(d, sdOriented(q, ARM_P - u * 20.0, ARM_P - u * 50.0, 11.0, 3.0));
    d = min(d, length(q - ARM_P) - 13.0);
    s *= 1.0 - 0.36 * shadowSoft(d, 1.2 + h * 0.05);
  }
  {
    float h = 150.0 - zs;
    vec2 q = p + L * h;
    vec2 ab = normalize(MIC_L - MIC_B);
    vec2 pr = vec2(-ab.y, ab.x) * 6.0;
    float d = min(sdSeg(q, MIC_B + pr, MIC_L + pr), sdSeg(q, MIC_B - pr, MIC_L - pr)) - 3.0;
    d = min(d, length(q - MIC_L) - MIC_R);
    s *= 1.0 - 0.28 * shadowSoft(d, 2.0 + h * 0.05);
  }
  return s;
}

vec3 deck(vec2 p, vec3 pos, vec3 v) {
  vec2 ctr = (DECK.xy + DECK.zw) * 0.5;
  vec2 hs = (DECK.zw - DECK.xy) * 0.5;
  float d = sdBox(p - ctr, hs, 22.0);
  vec3 ground = vec3(0.855, 0.846, 0.815);
  float drop = sdBox(p - ctr + KEY.xy / KEY.z * 60.0, hs, 22.0);
  ground *= 1.0 - 0.26 * (1.0 - smoothstep(-30.0, 46.0, drop));
  ground *= 1.0 - 0.3 * (1.0 - smoothstep(-2.0, 7.0, d));
  if (d > 2.0 * pxs + 0.5) return ground;
  vec2 g = vec2(
    sdBox(p - ctr + vec2(0.5, 0.0), hs, 22.0) - sdBox(p - ctr - vec2(0.5, 0.0), hs, 22.0),
    sdBox(p - ctr + vec2(0.0, 0.5), hs, 22.0) - sdBox(p - ctr - vec2(0.0, 0.5), hs, 22.0)
  );
  vec2 outward = normalize(-g + 1e-5);
  float bev = smoothstep(-6.0, 0.0, d);
  float peel = vnoise(p * 0.9) * 0.6 + vnoise(p * 2.7) * 0.4;
  vec3 n = normalize(vec3(-outward * sin(bev * 1.25) + (vec2(vnoise(p * 1.3), vnoise(p * 1.3 + 9.0)) - 0.5) * 0.04, cos(bev * 1.25)));
  vec3 alb = vec3(0.15, 0.152, 0.146) * (0.96 + 0.08 * peel);
  vec3 c = paintShade(n, pos, v, alb, 0.08);
  c += env(pos, reflect(-v, n)) * 0.02;
  float inset = abs(sdBox(p - ctr, hs - 12.0, 12.0));
  c *= 1.0 - 0.25 * band(0.2, 0.2 + pxs, inset);
  c += vec3(0.04) * band(0.0, 0.4 + pxs, abs(sdBox(p - ctr, hs - 12.6, 11.4)));
  return mix(ground, c, cover(d));
}

vec3 restPost(vec2 p, vec3 c, vec3 pos, vec3 v) {
  vec2 S = vec2(37.0, -204.0);
  vec2 q = p - S;
  float d = sdBox(q, vec2(9.0, 6.0), 3.0);
  float sh = shadowSoft(sdBox(q + KEY.xy / KEY.z * 14.0, vec2(9.0, 6.0), 3.0), 2.0);
  c *= 1.0 - 0.3 * sh * step(0.0, d);
  if (d > pxs) return c;
  vec3 n = normalize(vec3(clamp(q / vec2(9.0, 6.0), -1.0, 1.0) * smoothstep(-2.0, 0.0, d) * 0.8, 1.0));
  vec3 col = paintShade(n, pos + vec3(0.0, 0.0, 14.0), v, vec3(0.035), 0.4);
  float notch = sdBox(q, vec2(1.6, 6.5), 0.8);
  col *= 1.0 - 0.6 * cover(notch);
  return mix(c, col, cover(d));
}

vec3 rails(vec2 p, vec3 c, vec3 pos, vec3 v) {
  if (p.x < RAIL_X0 - 12.0 || abs(p.y) > RAIL_Y + 18.0) return c;
  for (int i = 0; i < 2; i++) {
    float y = i == 0 ? -RAIL_Y : RAIL_Y;
    float dy = p.y - y;
    float d = max(abs(dy) - 4.5, max(RAIL_X0 - p.x, p.x - RAIL_X1));
    if (d < pxs) {
      float a = clamp(dy / 4.5, -1.0, 1.0);
      vec3 n = normalize(vec3(0.0, a * 0.55, 1.0));
      vec3 col = vec3(0.16) * (0.3 + 0.5 * max(dot(n, normalize(KEY - pos)), 0.0)) + env(pos + vec3(0.0, 0.0, 34.0), reflect(-v, n)) * 0.65;
      c = mix(c, col, cover(d));
    }
  }
  {
    float dy = p.y;
    float d = max(abs(dy) - 3.5, max(RAIL_X0 - p.x, p.x - RAIL_X1));
    if (d < pxs) {
      float a = clamp(dy / 3.5, -1.0, 1.0);
      vec3 n = normalize(vec3(0.0, a * 0.55, 1.0));
      float thread = abs(fract(p.x / 1.5) - 0.5) * 2.0;
      n = normalize(n + vec3((thread - 0.5) * 0.8, 0.0, 0.0));
      vec3 col = metalShade(n, vec3(0.0, 1.0, 0.0), pos + vec3(0.0, 0.0, 30.0), v, vec3(0.62, 0.6, 0.56), 0.12, 0.3, 0.5);
      c = mix(c, col, cover(d));
    }
  }
  for (int i = 0; i < 2; i++) {
    float x = i == 0 ? RAIL_X0 - 4.0 : RAIL_X1 - 6.0;
    vec2 q = p - vec2(x, 0.0);
    float d = sdBox(q, vec2(7.0, RAIL_Y + 12.0), 3.0);
    if (d < pxs) {
      vec3 n = normalize(vec3(clamp(q / vec2(7.0, RAIL_Y + 12.0), -1.0, 1.0) * smoothstep(-2.5, 0.0, d) * 0.9, 1.0));
      float mill = vnoise(vec2(q.x * 0.5, q.y * 6.0));
      vec3 col = metalShade(n, vec3(1.0, 0.0, 0.0), pos + vec3(0.0, 0.0, 40.0), v, vec3(0.66, 0.66, 0.66) * (0.96 + 0.08 * mill), 0.25, 0.6, 0.55);
      float bolt = min(length(q - vec2(0.0, -RAIL_Y - 4.0)), length(q - vec2(0.0, RAIL_Y + 4.0))) - 2.0;
      col = mix(col, vec3(0.08) + env(pos, vec3(0.0, 0.0, 1.0)) * 0.03, cover(bolt));
      c = mix(c, col, cover(d));
    }
  }
  return c;
}

vec3 carriage(vec2 p, vec3 c, vec3 pos, vec3 v) {
  float sr = uCut.x;
  vec2 q = p - vec2(sr + 156.0, 0.0);
  if (abs(q.x) > 50.0 && p.x > sr + 210.0) return c;
  float d = sdBox(q, vec2(31.0, 58.0), 6.0);
  if (d < pxs) {
    float bev = smoothstep(-3.0, 0.0, d);
    vec2 gq = clamp(q / vec2(31.0, 58.0), -1.0, 1.0);
    vec3 n = normalize(vec3(gq * bev * 0.9, 1.0));
    vec2 fly = q - vec2(-60.0, 0.0);
    float fr = length(fly);
    vec2 ft = vec2(-fly.y, fly.x) / max(fr, 1e-3);
    float mill = vnoise(vec2(fr * 2.2, 0.3)) * 0.6 + vnoise(vec2(fr * 7.0, 1.7)) * 0.4;
    vec3 col = metalShade(n, vec3(ft, 0.0), pos + vec3(0.0, 0.0, 48.0), v, vec3(0.74, 0.74, 0.735) * (0.95 + 0.1 * mill), 0.06 + 0.04 * mill, 0.45, 0.5);
    for (int i = 0; i < 4; i++) {
      vec2 bp = vec2(i < 2 ? -21.0 : 21.0, mod(float(i), 2.0) < 0.5 ? -46.0 : 46.0);
      float bd = length(q - bp);
      float head = bd - 3.2;
      float hex = sdBox(rot(q - bp, 0.5), vec2(1.2), 0.2);
      vec3 bc = vec3(0.1) + env(pos, reflect(-v, normalize(vec3((q - bp) / 3.2 * 0.6, 1.0)))) * 0.25;
      bc *= 1.0 - 0.8 * cover(hex);
      col *= 1.0 - 0.3 * band(0.0, 0.8, head) * step(0.0, head);
      col = mix(col, bc, cover(head));
    }
    c = mix(c, col, cover(d));
  }
  vec2 qb = p - vec2(sr + 108.0, 0.0);
  float db = sdBox(qb, vec2(22.0, 13.0), 3.0);
  if (db < pxs) {
    float a = clamp(qb.y / 13.0, -1.0, 1.0);
    vec3 n = normalize(vec3(0.0, a * smoothstep(0.6, 1.0, abs(a)), 1.0));
    vec3 col = metalShade(n, vec3(1.0, 0.0, 0.0), pos + vec3(0.0, 0.0, 40.0), v, vec3(0.62, 0.62, 0.62), 0.05, 0.5, 0.5);
    c = mix(c, col, cover(db));
  }
  return c;
}

vec3 cutterHead(vec2 p, vec3 c, vec3 pos, vec3 v) {
  float sr = uCut.x;
  float lift = uCut.y;
  vec2 q = p - vec2(sr + 57.0, 0.0);
  if (abs(q.x) > 64.0 || abs(q.y) > 40.0) return c;
  vec3 lk = normalize(KEY - pos);
  float dn = sdTaper(p, vec2(sr + 3.0, 0.0), vec2(sr + 26.0, 0.0), 1.6, 9.0);
  if (dn < pxs) {
    float a = clamp(p.y / max(1.6 + (p.x - sr - 3.0) / 23.0 * 7.4, 0.5), -1.0, 1.0);
    vec3 n = normalize(vec3(-0.25, a, sqrt(max(1.0 - a * a, 0.04))));
    vec3 col = vec3(0.03) * (0.4 + 0.6 * max(dot(n, lk), 0.0)) + env(pos + vec3(0.0, 0.0, 26.0), reflect(-v, n)) * 0.08;
    for (int i = 0; i < 2; i++) {
      float y = i == 0 ? -1.3 : 1.3;
      float wd = sdSeg(p, vec2(sr + 7.0, y * 0.6), vec2(sr + 24.0, y * 2.6)) - 0.28;
      col = mix(col, vec3(0.5, 0.22, 0.08) * (0.4 + 0.6 * lk.z) + WARM * 0.08, cover(wd) * 0.9);
    }
    c = mix(c, col, cover(dn));
  }
  float d = sdBox(q, vec2(35.0, 27.0), 9.0);
  if (d < pxs) {
    float bev = smoothstep(-4.0, 0.0, d);
    vec2 g = vec2(
      sdBox(q + vec2(0.4, 0.0), vec2(35.0, 27.0), 9.0) - sdBox(q - vec2(0.4, 0.0), vec2(35.0, 27.0), 9.0),
      sdBox(q + vec2(0.0, 0.4), vec2(35.0, 27.0), 9.0) - sdBox(q - vec2(0.0, 0.4), vec2(35.0, 27.0), 9.0)
    );
    vec2 outward = normalize(-g + 1e-5);
    vec3 n = normalize(vec3(-outward * sin(bev * 1.2), cos(bev * 1.2)));
    float grain = vnoise(q * 1.7) * 0.5 + vnoise(q * 5.0) * 0.5;
    vec3 col = paintShade(n, pos + vec3(0.0, 0.0, 70.0), v, vec3(0.055, 0.056, 0.06) * (0.95 + 0.1 * grain), 0.18);
    col += env(pos + vec3(0.0, 0.0, 70.0), reflect(-v, n)) * 0.02;
    vec2 cq = q - vec2(3.0, 0.0);
    float cr = length(cq);
    float cap = cr - 16.5;
    if (cap < pxs) {
      vec2 ct = vec2(-cq.y, cq.x) / max(cr, 1e-3);
      float cb = smoothstep(14.5, 16.5, cr);
      vec3 cn = normalize(vec3(cq / max(cr, 1e-3) * sin(cb * 1.1), cos(cb * 1.1)));
      float turn = vnoise(vec2(cr * 5.0, 0.2));
      vec3 cc = metalShade(cn, vec3(ct, 0.0), pos + vec3(0.0, 0.0, 76.0), v, vec3(0.78, 0.78, 0.79) * (0.96 + 0.08 * turn), 0.05, 0.5, 0.45);
      cc *= 1.0 - 0.35 * band(0.0, 0.5 + pxs, abs(cr - 10.5));
      float slot = sdBox(rot(cq, 0.7), vec2(3.4, 0.55), 0.3);
      float screw = cr - 3.6;
      vec3 sc = vec3(0.3) + env(pos, reflect(-v, normalize(vec3(cq / 3.6 * 0.7, 1.0)))) * 0.25;
      sc *= 1.0 - 0.85 * cover(slot);
      cc = mix(cc, sc, cover(screw));
      col *= 1.0 - 0.4 * band(0.0, 1.2, cap) * step(0.0, cap);
      col = mix(col, cc, cover(cap));
    }
    vec2 kq = q - vec2(26.0, -17.0);
    float knob = length(kq) - 4.2;
    vec3 kc = vec3(0.03) + env(pos, reflect(-v, normalize(vec3(kq / 4.2 * 0.8, 1.0)))) * 0.1;
    kc += vec3(0.6, 0.18, 0.06) * cover(sdBox(rot(kq, 0.6), vec2(0.4, 3.0), 0.2)) * 0.6;
    col = mix(col, kc, cover(knob));
    vec2 lq = q - vec2(26.0, 17.0);
    float lampD = length(lq) - 1.8;
    vec3 lampC = mix(vec3(0.05, 0.02, 0.01), vec3(1.4, 0.45, 0.12), uCut.w);
    col = mix(col, lampC, cover(lampD));
    col += vec3(1.0, 0.35, 0.1) * uCut.w * 0.12 * exp(-max(length(lq) - 1.8, 0.0) / 2.0);
    c = mix(c, col, cover(d));
  }
  return c;
}

vec3 stylusMain(vec2 p, vec3 c, vec3 pos, vec3 v) {
  vec2 S = stylusTip();
  vec2 q = p - S;
  if (dot(q, q) > 36.0) return c;
  float d = sdTaper(p, S, S + vec2(4.0, 0.0), 0.35, 1.2);
  vec3 col = vec3(0.35, 0.42, 0.85) * 0.3 + WARM * 0.5 * pow(max(dot(normalize(vec3(-q, 1.0)), normalize(KEY - pos)), 0.0), 8.0);
  c = mix(c, col, coverW(d, max(pxs, 0.4)));
  c += vec3(1.0, 0.45, 0.15) * uCut.w * 0.07 * exp(-length(q) / 1.6);
  return c;
}

vec3 hose(vec2 p, vec3 c, vec3 pos, vec3 v) {
  if (p.x < uHoseBox.x - 6.0 || p.y < uHoseBox.y - 6.0 || p.x > uHoseBox.z + 6.0 || p.y > uHoseBox.w + 6.0) return c;
  vec2 hh = hoseHit(p);
  float d = hh.x - 4.4;
  vec2 m = uHose[0].xy;
  vec2 md = normalize(uHose[0].xy - uHose[1].xy);
  float nozzle = sdOriented(p, m - md * 6.0, m + md * 1.2, 1.9, 0.6);
  if (nozzle < pxs) {
    float a = clamp(dot(p - m, vec2(-md.y, md.x)) / 1.9, -1.0, 1.0);
    vec3 n = normalize(vec3(vec2(-md.y, md.x) * a, sqrt(max(1.0 - a * a, 0.03))));
    vec3 col = vec3(0.2) * 0.3 + env(pos + vec3(0.0, 0.0, 8.0), reflect(-v, n)) * 0.55;
    float mouth = length(p - m - md * 0.6) - 1.0;
    col = mix(col, vec3(0.005), cover(mouth));
    c = mix(c, col, cover(nozzle));
  }
  if (d > pxs) return c;
  float across = 0.0;
  {
    vec2 bestA = uHose[0].xy;
    vec2 bestB = uHose[1].xy;
    float bd = 1e9;
    for (int i = 0; i < 13; i++) {
      vec2 a = uHose[i].xy;
      vec2 b = uHose[i + 1].xy;
      float sd = sdSeg(p, a, b);
      if (sd < bd) {
        bd = sd;
        bestA = a;
        bestB = b;
      }
    }
    vec2 dir = normalize(bestB - bestA + 1e-5);
    across = clamp(dot(p - bestA, vec2(-dir.y, dir.x)) / 4.4, -1.0, 1.0);
    vec3 n = normalize(vec3(vec2(-dir.y, dir.x) * across, sqrt(max(1.0 - across * across, 0.03))));
    float thick = 1.0 / max(sqrt(max(1.0 - across * across, 0.0)), 0.25);
    vec3 tint = vec3(0.86, 0.84, 0.76);
    vec3 col = mix(c * tint * 0.75, vec3(0.42, 0.4, 0.36), 0.18) * mix(1.0, 0.75, clamp(0.3 * thick - 0.3, 0.0, 1.0));
    float rim = smoothstep(0.62, 0.95, abs(across));
    col = mix(col, col * vec3(0.5, 0.48, 0.42), rim * 0.8);
    float fr = 0.04 + 0.96 * pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 5.0);
    col += env(pos + vec3(0.0, 0.0, 22.0), reflect(-v, n)) * fr * 0.9;
    float line = band(0.0, 0.18, abs(across + 0.42));
    col += WARM * line * 0.3;
    float flow = uChipInfo.z;
    if (flow > 0.001) {
      float ph = hh.y - uChipInfo.y * 160.0;
      float wav = sin(ph * 0.21) * 0.38 + sin(ph * 0.067 + 1.7) * 0.22;
      float thread = band(0.05, 0.14, abs(across - wav)) * flow;
      col = mix(col, vec3(0.02), thread * 0.85);
    }
    c = mix(c, col, cover(d));
  }
  return c;
}

vec3 chip(vec2 p, vec3 c, vec3 pos, vec3 v, float px) {
  if (uChipInfo.x < 2.0) return c;
  if (p.x < uChipBox.x - 2.0 || p.y < uChipBox.y - 2.0 || p.x > uChipBox.z + 2.0 || p.y > uChipBox.w + 2.0) return c;
  vec4 h = chipHit(p);
  float w = max(px, 1e-3);
  float thin = clamp(h.z * 2.0 / w, 0.0, 1.0);
  float a = clamp(0.5 - (h.x - min(0.0, 0.5 * w - h.z)) / w, 0.0, 1.0) * mix(0.6, 1.0, thin);
  if (a <= 0.0) return c;
  vec3 col = chipColor(h.y, thin, pos, v);
  return mix(c, col, a);
}

vec3 playArm(vec2 p, vec3 c, vec3 pos, vec3 v) {
  vec2 S = uArm.zw;
  vec2 u = armDir();
  vec2 hd = headDir();
  vec2 J = S - hd * 14.0;
  if (sdSeg(p, ARM_P - u * 54.0, S) > 22.0) return c;
  vec3 lk = normalize(KEY - pos - vec3(0.0, 0.0, 56.0));
  float dCw = sdOriented(p, ARM_P - u * 20.0, ARM_P - u * 50.0, 11.0, 3.0);
  if (dCw < pxs) {
    float along = -dot(p - ARM_P, u);
    float a = clamp(dot(p - ARM_P, vec2(-u.y, u.x)) / 11.0, -1.0, 1.0);
    vec3 n = normalize(vec3(vec2(-u.y, u.x) * a, sqrt(max(1.0 - a * a, 0.02))));
    float knurl = band(0.3, 0.8, abs(fract(along * 0.6) - 0.5) * 2.0) * step(along, 28.0);
    vec3 col = vec3(0.09) * (0.4 + 0.6 * max(dot(n, lk), 0.0)) + env(pos + vec3(0.0, 0.0, 56.0), reflect(-v, n)) * 0.18 * (1.0 - 0.5 * knurl);
    c = mix(c, col, cover(dCw));
  }
  float dB = length(p - ARM_P) - 13.0;
  if (dB < pxs) {
    vec2 q = p - ARM_P;
    float s = clamp(length(q) / 13.0, 0.0, 1.0);
    vec3 n = normalize(vec3(q / max(length(q), 1e-3) * s * 0.85, 1.0));
    vec3 col = vec3(0.45) * (0.25 + 0.45 * max(dot(n, lk), 0.0)) + env(pos + vec3(0.0, 0.0, 56.0), reflect(-v, n)) * 0.5;
    col *= 1.0 - 0.4 * band(0.0, 0.6, abs(length(q) - 8.0));
    c = mix(c, col, cover(dB));
  }
  float dT = sdSeg(p, ARM_P, J) - 3.2;
  if (dT < pxs) {
    vec2 nr = vec2(-u.y, u.x);
    vec2 dir = normalize(J - ARM_P);
    nr = vec2(-dir.y, dir.x);
    float a = clamp(dot(p - ARM_P, nr) / 3.2, -1.0, 1.0);
    vec3 n = normalize(vec3(nr * a * 0.5, 1.0));
    vec3 col = vec3(0.45) * (0.1 + 0.3 * max(dot(n, lk), 0.0)) + env(pos + vec3(0.0, 0.0, 60.0), reflect(-v, n)) * 0.55;
    c = mix(c, col, cover(dT));
  }
  float dH = sdOriented(p, S - hd * 17.0, S + hd * 3.0, 5.5, 1.5);
  vec2 side = vec2(-hd.y, hd.x);
  vec2 lf = S - hd * 12.0;
  float dL = sdSeg(p, lf, lf - side * 13.0 - hd * 2.0) - 1.2;
  if (min(dH, dL) < pxs) {
    float bev = smoothstep(-1.2, 0.0, dH);
    vec3 col = vec3(0.02) + env(pos + vec3(0.0, 0.0, 60.0), vec3(0.0, 0.0, 1.0)) * 0.012;
    col += vec3(0.07) * bev * max(dot(normalize(p - S + hd * 7.0 + 1e-4), -lk.xy), 0.0);
    vec3 cart = vec3(0.62, 0.16, 0.06) * (0.3 + 0.4 * lk.z);
    float dc = sdOriented(p, S - hd * 9.0, S + hd * 1.5, 3.6, 1.0);
    col = mix(col, cart, cover(dc));
    vec3 lcol = vec3(0.4) * 0.3 + env(pos, vec3(0.0, 0.0, 1.0)) * 0.05;
    col = mix(col, lcol, cover(dL));
    c = mix(c, col, cover(min(dH, dL)));
  }
  return c;
}

vec3 lensScene(vec2 q, float px) {
  vec2 lq = q - vec2(0.0, uPlat.z);
  float r = length(lq);
  vec3 c;
  if (r < R_LAC - 0.5) {
    c = lacquer(lq, vec3(lq, 16.0), vec3(0.0, 0.0, 1.0), 1.0, uLens.w, px);
  } else if (length(q) < R_PLAT) {
    float t = vnoise(vec2(length(q) * 6.0, 0.4));
    c = vec3(0.1) * (0.7 + 0.5 * t) * LAMP;
  } else {
    c = vec3(0.08, 0.075, 0.07);
  }
  vec2 L = vec2(-0.5, -0.66) / 0.56;
  if (uLens.z > 0.5) {
    vec2 S = uArm.zw;
    vec2 hd = headDir();
    float h = 0.4 + uArm.y * 6.0;
    float sh = length(q + L * h - S) - 0.4;
    c *= 1.0 - 0.6 * shadowSoft(sh, 0.15 + h * 0.08);
    float dc = sdTaper(q, S + hd * 0.2, S - hd * 7.0, 0.22, 0.45);
    float blur = px * (1.0 + uArm.y * 6.0);
    vec3 cc = vec3(0.12, 0.11, 0.1) + LAMP * 0.35 * band(0.0, 0.4, abs(dot(q - S, vec2(-hd.y, hd.x)) + 0.12));
    c = mix(c, cc, coverW(dc, blur));
    float tip = length(q - S) - 0.25;
    c = mix(c, vec3(0.9, 0.86, 0.8), coverW(tip, blur) * 0.9);
  } else {
    vec2 S = stylusTip();
    float lift = uCut.y;
    float h = 0.2 + lift * 3.0;
    float blur = px * (1.0 + lift * 2.5);
    float sh = sdTaper(q + L * h, S, S + vec2(5.0, 0.0), 0.5, 1.0);
    c *= 1.0 - 0.55 * shadowSoft(sh, 0.15 + h * 0.08);
    float shank = sdBox(q - S - vec2(5.2, 0.0), vec2(3.4, 0.62), 0.3);
    vec3 shc = vec3(0.08) + LAMP * 0.5 * band(0.0, 0.35, abs(q.y - 0.32));
    c = mix(c, shc, coverW(shank, blur));
    vec2 sq = q - S;
    float gem = (abs(sq.x - 0.95) / 1.15 + abs(sq.y) / 0.62) - 1.0;
    gem *= 0.55;
    float facet = step(0.0, sq.y) * 0.6 + step(sq.x, 0.9) * 0.4;
    vec3 gc = vec3(0.18, 0.24, 0.62) * (0.4 + 0.8 * facet) + LAMP * 0.9 * pow(max(1.0 - length(sq - vec2(0.6, -0.2)) / 0.6, 0.0), 2.0);
    c = mix(c, gc, coverW(gem, blur));
    c += vec3(1.0, 0.42, 0.12) * uCut.w * 0.22 * exp(-length(sq) / 0.9);
    c = chip(q, c, vec3(q, 18.0), vec3(0.0, 0.0, 1.0), px);
  }
  return c;
}

vec3 microscope(vec2 p, vec3 c, vec3 pos, vec3 v) {
  vec2 ab = MIC_L - MIC_B;
  float alen = length(ab);
  vec2 ad = ab / alen;
  vec2 pr = vec2(-ad.y, ad.x);
  if (sdSeg(p, MIC_B, MIC_L) > MIC_R + 26.0) return c;
  vec3 lk = normalize(KEY - pos - vec3(0.0, 0.0, 140.0));
  float dBase = length(p - MIC_B) - 19.0;
  if (dBase < pxs) {
    vec2 q = p - MIC_B;
    float s = clamp(length(q) / 19.0, 0.0, 1.0);
    vec3 n = normalize(vec3(q / max(length(q), 1e-3) * smoothstep(0.75, 1.0, s) * 0.9, 1.0));
    vec2 tq = vec2(-q.y, q.x) / max(length(q), 1e-3);
    vec3 col = metalShade(n, vec3(tq, 0.0), pos + vec3(0.0, 0.0, 60.0), v, vec3(0.7, 0.7, 0.71), 0.06, 0.5, 0.5);
    col *= 1.0 - 0.4 * band(0.0, 0.6, abs(length(q) - 12.0));
    float pin = length(q) - 6.0;
    col = mix(col, vec3(0.03) + env(pos, reflect(-v, normalize(vec3(q / 6.0 * 0.7, 1.0)))) * 0.1, cover(pin));
    c = mix(c, col, cover(dBase));
  }
  for (int i = 0; i < 2; i++) {
    vec2 o = pr * (i == 0 ? -6.0 : 6.0);
    float d = sdSeg(p, MIC_B + o, MIC_L + o) - 3.0;
    if (d < pxs) {
      float a = clamp(dot(p - MIC_B - o, pr) / 3.0, -1.0, 1.0);
      vec3 n = normalize(vec3(pr * a * 0.5, 1.0));
      vec3 col = vec3(0.2) * (0.2 + 0.4 * max(dot(n, lk), 0.0)) + env(pos + vec3(0.0, 0.0, 140.0), reflect(-v, n)) * 0.6;
      c = mix(c, col, cover(d));
    }
  }
  vec2 q = p - MIC_L;
  float rq = length(q);
  float dH = rq - MIC_R;
  if (dH < pxs) {
    float ang = atan(q.y, q.x);
    float knurl = abs(fract(ang / TAU * 90.0) - 0.5) * 2.0;
    float outer = smoothstep(MIC_R - 4.0, MIC_R, rq);
    vec2 rad = q / max(rq, 1e-3);
    vec3 n = normalize(vec3(rad * (outer * 0.9 + (knurl - 0.5) * 0.3 * outer), 1.0));
    vec3 col = vec3(0.022) * (0.5 + 0.5 * max(dot(n, lk), 0.0)) + env(pos + vec3(0.0, 0.0, 140.0), reflect(-v, n)) * 0.07;
    float brass = band(0.0, 0.7 + pxs, abs(rq - GLASS_R - 1.6));
    col = mix(col, metalShade(normalize(vec3(rad * 0.3, 1.0)), vec3(-rad.y, rad.x, 0.0), pos + vec3(0.0, 0.0, 140.0), v, vec3(0.78, 0.6, 0.36), 0.05, 0.4, 0.6), brass);
    if (rq < GLASS_R + pxs) {
      float m = 7.0;
      vec2 fq = uLens.xy + q / m;
      float px = pxs / m;
      vec3 view = lensScene(fq, px);
      float vig = band(GLASS_R * 0.55, GLASS_R, rq);
      view *= 0.25 + 0.75 * vig;
      vec2 rq2 = q / GLASS_R;
      float ret = 0.0;
      ret += band(0.0, pxs * 0.6, abs(q.x)) * step(abs(q.y), GLASS_R * 0.82) * step(3.0, abs(q.y));
      ret += band(0.0, pxs * 0.6, abs(q.y)) * step(abs(q.x), GLASS_R * 0.82) * step(3.0, abs(q.x));
      float tickX = abs(fract(q.x / m / 0.5 + 0.5) - 0.5) * 0.5 * m;
      float tickLen = mod(floor(q.x / m / 0.5 + 0.5), 2.0) < 0.5 ? 3.2 : 1.8;
      ret += band(0.0, pxs * 0.6, tickX) * step(abs(q.y + 0.0), tickLen) * step(abs(q.x), GLASS_R * 0.82) * step(1.0, abs(q.x));
      view = mix(view, vec3(0.95, 0.78, 0.5), clamp(ret, 0.0, 1.0) * 0.4 * vig);
      vec3 gn = normalize(vec3(rq2 * 0.35, 1.0));
      vec3 refl = env(pos + vec3(0.0, 0.0, 150.0), reflect(-v, gn));
      view += refl * 0.035;
      float glint = band(0.0, 0.08, abs(length(q - vec2(-10.0, -12.0)) - 22.0) / GLASS_R) * band(-0.5, 0.2, dot(normalize(q - vec2(-10.0, -12.0) + 1e-4), vec2(0.6, 0.8)));
      view += WARM * glint * 0.06;
      view *= 1.0 - 0.6 * band(0.0, 1.4, GLASS_R - rq);
      col = mix(col, view, cover(rq - GLASS_R));
    }
    c *= 1.0 - 0.35 * band(0.0, 1.0, dH) * step(0.0, dH);
    c = mix(c, col, cover(dH));
  }
  return c;
}

void main() {
  vec2 css = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 p = (css - uView.xy) / uView.z;
  if (uRot > 0.5) p = vec2(p.y, -p.x);
  pxs = 1.0 / uView.z;
  vec3 pos = vec3(p, 0.0);
  vec3 v = normalize(uEye - pos);
  float r = length(p);

  vec3 c = deck(p, pos, v);
  c = restPost(p, c, pos, v);
  float zs = 0.0;

  vec2 lc = vec2(0.0, uPlat.z);
  float lift = uPlat.w;
  vec2 lq = p - lc;
  float lr = length(lq);

  if (r < R_PLAT + 6.0) {
    float well = r - R_PLAT;
    c *= 1.0 - 0.55 * band(0.0, 3.5, well) * step(0.0, well);
    if (r < R_PLAT + pxs) {
      vec3 plat = platterTop(p, r, pos + vec3(0.0, 0.0, 14.0), v);
      if (lift > 0.001 || lr > R_LAC - 2.0) {
        vec2 L = KEY.xy / KEY.z;
        float lsh = length(p - lc + L * (2.0 + lift * 26.0)) - R_LAC;
        plat *= 1.0 - 0.55 * shadowSoft(lsh, 0.8 + lift * 6.0);
      }
      plat = spindle(p, plat, pos + vec3(0.0, 0.0, 14.0), v);
      c = mix(c, plat, cover(r - R_PLAT));
      zs = 14.0;
    }
  }
  if (lift > 0.001 && r >= R_PLAT) {
    vec2 L = KEY.xy / KEY.z;
    float lsh = length(p - lc + L * (16.0 + lift * 26.0)) - R_LAC;
    c *= 1.0 - 0.4 * shadowSoft(lsh, 3.0 + lift * 8.0);
  }
  if (lr < R_LAC + pxs) {
    vec3 lac = lacquer(lq, pos + vec3(0.0, 0.0, 16.0 + lift * 26.0), v, 0.0, 0.0, pxs);
    float a = cover(lr - R_LAC) * (1.0 - cover(lr - 3.7));
    c = mix(c, lac, a);
    if (a > 0.5) zs = 16.0 + lift * 26.0;
  }

  gSoft = 240.0;
  float onDeck = 1.0 - smoothstep(-2.0, 2.0, sdBox(p - (DECK.xy + DECK.zw) * 0.5, (DECK.zw - DECK.xy) * 0.5, 22.0));
  c *= mix(1.0, occluders(p, zs), onDeck);
  c = rails(p, c, pos, v);
  c = carriage(p, c, pos, v);
  c = stylusMain(p, c, pos + vec3(0.0, 0.0, 16.0), v);
  c = chip(p, c, pos + vec3(0.0, 0.0, 18.0), v, pxs);
  c = cutterHead(p, c, pos, v);
  c = hose(p, c, pos, v);
  c = playArm(p, c, pos, v);
  c = microscope(p, c, pos, v);

  vec3 over = max(c - 0.86, 0.0);
  c = min(c, 0.86) + 0.14 * (1.0 - exp(-over / 0.14));
  c = pow(max(c, 0.0), vec3(1.0 / 2.2));
  c += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;
