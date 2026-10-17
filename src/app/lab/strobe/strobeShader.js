export const STROBE_VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const STROBE_FRAGMENT = `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uFocal;
uniform vec3 uCamPos;
uniform vec3 uCamFwd;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec4 uPlat;
uniform vec4 uRowA;
uniform vec4 uRowD;
uniform vec4 uFader;
uniform vec4 uFlags;
uniform sampler2D uLabel;
uniform sampler2D uPrint;

out vec4 outColor;

const float PI = 3.14159265;
const float TAU = 6.2831853;
const float R_PLAT = 166.0;
const float Y_RIM0 = 3.0;
const float Y_RIM1 = 26.0;
const float R_LIP = 155.0;
const float R_REC = 152.4;
const float Y_MAT = 27.2;
const float Y_REC = 28.8;
const float R_LABEL = 50.0;
const vec4 PLINTH = vec4(-240.0, -215.0, 272.0, 226.0);
const float Y_TABLE = -64.0;
const vec2 LAMP_C = vec2(30.0, 198.0);
const float LAMP_R = 11.0;
const float LAMP_H = 19.0;
const vec3 LAMP_COL = vec3(1.0, 0.22, 0.045);
const float XF = 214.0;
const float ZF0 = 140.0;
const float HT = 50.0;
const vec3 CAP = vec3(11.5, 7.0, 8.5);
const vec2 LED_LOCK = vec2(192.0, 140.0);
const vec4 PRINT_RECT = vec4(168.0, 70.0, 266.0, 214.0);
const vec3 KEY_L = vec3(-420.0, 900.0, -520.0);
const vec3 FILL_L = vec3(700.0, 420.0, 600.0);

float fp;

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

float sdBox2(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float sdCap(vec3 q) {
  float k = clamp(q.y / CAP.y, -1.0, 1.0);
  vec3 b = vec3(CAP.x - 0.8 * max(k, 0.0), CAP.y, CAP.z - 0.6 * max(k, 0.0));
  return sdRoundBox(q, b, 2.6) * 0.9;
}

float cover(float d, float w) {
  return clamp(0.5 - d / max(w, 1e-4), 0.0, 1.0);
}

float hitCyl(vec3 o, vec3 d, vec2 c, float r, float y0, float y1) {
  vec2 oc = o.xz - c;
  float a = dot(d.xz, d.xz);
  if (a < 1e-8) return -1.0;
  float b = dot(oc, d.xz);
  float cc = dot(oc, oc) - r * r;
  float h = b * b - a * cc;
  if (h < 0.0) return -1.0;
  float t = (-b - sqrt(h)) / a;
  if (t <= 0.0) return -1.0;
  float y = o.y + d.y * t;
  if (y < y0 || y > y1) return -1.0;
  return t;
}

float hitPlane(vec3 o, vec3 d, float h) {
  if (abs(d.y) < 1e-6) return -1.0;
  float t = (h - o.y) / d.y;
  return t > 0.0 ? t : -1.0;
}

float hitBox(vec3 o, vec3 d, vec3 c, vec3 b, out vec3 n) {
  vec3 sd = vec3(d.x >= 0.0 ? 1.0 : -1.0, d.y >= 0.0 ? 1.0 : -1.0, d.z >= 0.0 ? 1.0 : -1.0);
  vec3 inv = sd / max(abs(d), vec3(1e-6));
  vec3 t0 = (c - b - o) * inv;
  vec3 t1 = (c + b - o) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  float tn = max(max(tmin.x, tmin.y), tmin.z);
  float tf = min(min(tmax.x, tmax.y), tmax.z);
  if (tn > tf || tf <= 0.0 || tn <= 0.0) return -1.0;
  if (tn == tmin.x) n = vec3(-sign(d.x), 0.0, 0.0);
  else if (tn == tmin.y) n = vec3(0.0, -sign(d.y), 0.0);
  else n = vec3(0.0, 0.0, -sign(d.z));
  return tn;
}

float aniso(vec3 h, vec3 n, vec3 t, float at, float ab) {
  vec3 b = normalize(cross(n, t));
  float ht = dot(h, t);
  float hb = dot(h, b);
  float hn = max(dot(h, n), 1e-3);
  float k = ht * ht / (at * at) + hb * hb / (ab * ab) + hn * hn;
  return min(1.0 / (PI * at * ab * max(k * k, 1e-5)), 600.0);
}

float ggx(vec3 n, vec3 h, float a) {
  float nh = max(dot(n, h), 0.0);
  float a2 = a * a;
  float d = nh * nh * (a2 - 1.0) + 1.0;
  return min(a2 / (PI * max(d * d, 1e-6)), 800.0);
}

float softbox(vec3 p, vec3 r, vec3 c, vec2 half_, float soft) {
  if (r.y < 0.02) return 0.0;
  float k = (c.y - p.y) / r.y;
  vec2 q = p.xz + r.xz * min(k, 1e5) - c.xz;
  vec2 e = smoothstep(half_ + soft, half_ - soft, abs(q));
  return e.x * e.y;
}

vec3 booth(vec3 d) {
  float az = atan(d.x, -d.z);
  float el = asin(clamp(d.y, -1.0, 1.0));
  vec3 c = mix(vec3(0.010, 0.008, 0.007), vec3(0.020, 0.016, 0.014), smoothstep(-0.2, 0.5, el));
  c += vec3(0.03, 0.018, 0.010) * exp(-pow((el - 0.05) / 0.12, 2.0)) * (0.6 + 0.4 * cos(az * 1.3));
  vec4 bk[7] = vec4[7](
    vec4(-0.62, 0.20, 0.050, 1.0),
    vec4(-0.38, 0.13, 0.034, 0.0),
    vec4(-0.18, 0.27, 0.060, 1.0),
    vec4(0.08, 0.16, 0.040, 2.0),
    vec4(0.30, 0.24, 0.052, 1.0),
    vec4(0.52, 0.11, 0.036, 0.0),
    vec4(0.74, 0.21, 0.046, 2.0)
  );
  for (int i = 0; i < 7; i++) {
    vec2 q = vec2((az - bk[i].x) * cos(el), el - bk[i].y);
    float rr = bk[i].z;
    float dd = length(q) / rr;
    float disc = smoothstep(1.0, 0.86, dd) * (0.75 + 0.25 * smoothstep(0.5, 0.97, dd));
    vec3 tint = bk[i].w < 0.5 ? vec3(1.0, 0.55, 0.22) : (bk[i].w < 1.5 ? vec3(1.0, 0.72, 0.42) : vec3(0.35, 0.55, 1.0));
    c += tint * disc * 0.055;
  }
  return c;
}

vec3 boothSoft(vec3 d) {
  float el = asin(clamp(d.y, -1.0, 1.0));
  float az = atan(d.x, -d.z);
  vec3 c = mix(vec3(0.010, 0.008, 0.007), vec3(0.020, 0.016, 0.014), smoothstep(-0.2, 0.5, el));
  c += vec3(0.03, 0.018, 0.010) * exp(-pow((el - 0.05) / 0.2, 2.0)) * (0.6 + 0.4 * cos(az * 1.3));
  return c;
}

vec3 envSoft(vec3 p, vec3 r) {
  vec3 c = boothSoft(r);
  float key = softbox(p, r, KEY_L, vec2(420.0, 280.0), 320.0);
  float fill = softbox(p, r, FILL_L, vec2(200.0, 340.0), 220.0);
  c += vec3(1.0, 0.86, 0.68) * key * 0.7 + vec3(0.55, 0.65, 0.9) * fill * 0.1;
  return c;
}

vec3 env(vec3 p, vec3 r) {
  vec3 c = booth(r);
  float key = softbox(p, r, KEY_L, vec2(360.0, 220.0), 220.0);
  float fill = softbox(p, r, FILL_L, vec2(160.0, 300.0), 160.0);
  c += vec3(1.0, 0.86, 0.68) * key * 0.9 + vec3(0.55, 0.65, 0.9) * fill * 0.12;
  return c;
}

vec3 lampPos() {
  vec2 w = -normalize(LAMP_C);
  vec2 q = LAMP_C + w * (LAMP_R + 0.5);
  return vec3(q.x, 11.0, q.y);
}

vec3 lampLight(vec3 p, vec3 n, out vec3 l) {
  vec3 lp = lampPos();
  vec3 dv = lp - p;
  float dist = length(dv);
  l = dv / max(dist, 1e-3);
  vec2 w = -normalize(LAMP_C);
  float cone = smoothstep(0.05, 0.6, dot(-l.xz / max(length(l.xz), 1e-3), w));
  float att = 1.0 / (1.0 + dist * dist / 900.0);
  return LAMP_COL * uPlat.w * cone * att * 9.0;
}

float keyShadow(vec3 p) {
  vec3 ld = normalize(KEY_L);
  float s = 1.0;
  if (p.y < Y_RIM1 + 1.0) {
    vec2 q = p.xz + ld.xz / ld.y * (Y_REC - p.y);
    float dPl = length(q) - R_PLAT;
    float pen = 1.6 + (Y_REC - p.y) * 0.25;
    if (length(p.xz) > R_PLAT + 0.5) s *= mix(1.0, 0.25, smoothstep(pen, -pen, dPl));
  }
  if (p.y < 1.0) {
    vec2 q = p.xz + ld.xz / ld.y * (14.0 - p.y);
    float zc = uFader.x;
    float dC = sdBox2(q - vec2(XF, zc), CAP.xz, 2.0);
    s *= mix(1.0, 0.4, smoothstep(5.0, -3.0, dC));
    vec2 ql = p.xz + ld.xz / ld.y * (LAMP_H - p.y);
    float dL = length(ql - LAMP_C) - LAMP_R;
    s *= mix(1.0, 0.35, smoothstep(5.0, -3.0, dL));
  }
  return s;
}

vec3 rowDots(vec3 p, float theta, vec3 lampC, float ndl, vec3 v, vec3 n, out float band) {
  vec4 rows = vec4(21.6, 16.6, 11.6, 6.6);
  vec4 counts = vec4(216.0, 180.0, 160.0, 133.0);
  vec3 lit = vec3(0.0);
  band = 0.0;
  float omega = uPlat.y;
  float ambBlur = abs(omega) * uFader.w;
  for (int i = 0; i < 4; i++) {
    float yc = rows[i];
    float dy = p.y - yc;
    if (abs(dy) > 2.6) continue;
    float N = counts[i];
    float pitch = TAU * R_PLAT / N;
    float hb = 1.0 - smoothstep(1.7, 1.7 + fp, abs(dy));
    band = max(band, hb);
    float hw = 0.62 + 0.12 * float(i == 0);
    float hh = 0.95;
    float smear = abs(omega) * 0.0024 * R_PLAT;
    float a = uRowA[i];
    float dlt = uRowD[i];
    float strobe = 0.0;
    for (int k = 0; k < 2; k++) {
      float cell = theta * N / TAU - (a - float(k) * dlt);
      float x = (fract(cell) - 0.5) * pitch;
      float wx = hw + smear * 0.5;
      float cx = clamp((wx - abs(x)) / fp + 0.5, 0.0, 1.0);
      float cy = clamp((hh - abs(dy)) / fp + 0.5, 0.0, 1.0);
      float core = 1.0 - smoothstep(0.0, wx, abs(x));
      strobe += cx * cy * (hw / wx) * (0.75 + 0.25 * core) * 0.5;
    }
    float trueCell = (theta - uPlat.x) * N / TAU;
    float xt = (fract(trueCell) - 0.5) * pitch;
    float blurMm = ambBlur * R_PLAT;
    float wt = hw + blurMm * 0.5;
    float duty = 2.0 * hw / pitch;
    float amb = clamp((wt - abs(xt)) / fp + 0.5, 0.0, 1.0) * clamp((hh - abs(dy)) / fp + 0.5, 0.0, 1.0) * (hw / wt);
    amb = mix(amb, duty * clamp((hh - abs(dy)) / fp + 0.5, 0.0, 1.0), smoothstep(pitch * 0.4, pitch * 1.2, blurMm));
    lit += vec3(strobe, amb, 0.0);
  }
  return lit;
}

vec3 shadeRim(vec3 p, vec3 v) {
  float r = length(p.xz);
  vec2 rr = p.xz / max(r, 1e-3);
  float theta = atan(p.z, p.x);
  vec3 n = vec3(rr.x, 0.0, rr.y);
  float top = smoothstep(24.2, Y_RIM1, p.y);
  float bot = smoothstep(4.6, Y_RIM0, p.y);
  n = normalize(n + vec3(0.0, top * 1.4 - bot * 0.9, 0.0));
  vec3 t = vec3(-rr.y, 0.0, rr.x);
  vec3 lk = normalize(KEY_L - p);
  vec3 lf = normalize(FILL_L - p);
  float lathe = vnoise(vec2(p.y * 6.0, 0.5)) * 0.6 + vnoise(vec2(p.y * 23.0, 4.0)) * 0.4;
  vec3 alu = vec3(0.60, 0.605, 0.615) * (0.94 + 0.12 * lathe);
  vec3 hk = normalize(lk + v);
  vec3 hf = normalize(lf + v);
  float spec = aniso(hk, n, vec3(0.0, 1.0, 0.0), 0.08, 0.5) * 0.05 + aniso(hf, n, vec3(0.0, 1.0, 0.0), 0.12, 0.5) * 0.01;
  float sh = keyShadow(p);
  vec3 c = alu * (0.010 + 0.05 * max(dot(n, lk), 0.0) * sh) + alu * spec * sh * 0.5;
  c += envSoft(p, reflect(-v, n)) * alu * 0.18;

  vec3 l;
  vec3 lampC = lampLight(p, n, l);
  float ndl = max(dot(n, l), 0.0);
  float band;
  vec3 dots = rowDots(p, theta, lampC, ndl, v, n, band);
  float recess = band * 0.6;
  c *= 1.0 - recess;
  vec3 hl = normalize(l + v);
  float glint = pow(max(dot(n, hl), 0.0), 18.0);
  vec3 lampRim = lampC * alu * (ndl * 0.16 + glint * 0.35) * (1.0 - recess * 0.85);
  vec3 dotLit = lampC * (0.32 * ndl + 0.5 * pow(max(dot(n, hl), 0.0), 4.0)) * vec3(1.0, 1.25, 1.6);
  c += lampRim;
  c += dotLit * dots.x;
  c += (alu * 0.02 + envSoft(p, reflect(-v, n)) * 0.14) * dots.y * sh;
  float ridge = 0.0;
  for (int i = 0; i < 3; i++) {
    float yr = 19.1 - float(i) * 5.0;
    ridge = max(ridge, 1.0 - smoothstep(0.0, 0.35 + fp, abs(p.y - yr)));
  }
  c += (lampC * 0.05 + envSoft(p, reflect(-v, vec3(n.x, 0.6, n.z))) * 0.1) * ridge;
  return c;
}

vec3 shadeLip(vec3 p, vec3 v) {
  float r = length(p.xz);
  vec2 rr = p.xz / max(r, 1e-3);
  float bev = smoothstep(R_PLAT - 2.4, R_PLAT, r);
  float inner = smoothstep(R_LIP + 1.2, R_LIP, r);
  vec3 n = normalize(vec3(rr.x * (bev * 1.1 - inner * 0.6), 1.0, rr.y * (bev * 1.1 - inner * 0.6)));
  vec3 t = vec3(-rr.y, 0.0, rr.x);
  vec3 lk = normalize(KEY_L - p);
  vec3 hk = normalize(lk + v);
  float lathe = vnoise(vec2(r * 8.0, 0.5)) * 0.6 + vnoise(vec2(r * 29.0, 3.0)) * 0.4;
  vec3 alu = vec3(0.62, 0.62, 0.63) * (0.95 + 0.1 * lathe);
  float spec = aniso(hk, n, t, 0.05, 0.4) * 0.06;
  vec3 c = alu * (0.02 + 0.08 * max(dot(n, lk), 0.0)) + alu * spec;
  c += env(p, reflect(-v, n)) * alu * 0.5;
  vec3 l;
  vec3 lampC = lampLight(p, n, l);
  c += lampC * alu * max(dot(n, l), 0.0) * 0.12;
  return c;
}

vec3 shadeRecord(vec3 p, vec3 v) {
  float r = length(p.xz);
  vec2 rr = p.xz / max(r, 1e-3);
  vec3 n = vec3(0.0, 1.0, 0.0);
  float edge = smoothstep(R_REC - 1.6, R_REC, r);
  n = normalize(n + vec3(rr.x, 0.0, rr.y) * edge * 1.2);
  vec3 t = vec3(-rr.y, 0.0, rr.x);
  vec3 lk = normalize(KEY_L - p);
  vec3 lf = normalize(FILL_L - p);
  vec3 hk = normalize(lk + v);
  vec3 hf = normalize(lf + v);
  float gap = 0.0;
  float bands[6] = float[6](146.5, 131.0, 117.5, 101.0, 86.0, 71.5);
  for (int i = 0; i < 6; i++) gap = max(gap, 1.0 - smoothstep(0.35, 0.9 + fp, abs(r - bands[i])));
  float lead = smoothstep(148.4, 148.0, r);
  float runout = smoothstep(62.0, 62.6, r);
  float groove = lead * runout * (1.0 - gap);
  float cosv = max(dot(n, v), 0.0);
  float fres = 0.045 + 0.955 * pow(1.0 - cosv, 5.0);
  vec3 refl = env(p, reflect(-v, n));
  float gloss = mix(0.9, 0.55, groove);
  vec3 c = vec3(0.004) + refl * fres * gloss;
  float sk = aniso(hk, n, t, mix(0.02, 0.05, groove), 0.6);
  float sf = aniso(hf, n, t, 0.06, 0.6);
  float mod_ = 0.85 + 0.15 * vnoise(vec2(r * 3.0, 1.0));
  c += vec3(1.0, 0.88, 0.72) * sk * groove * 0.012 * mod_ + vec3(0.6, 0.7, 1.0) * sf * groove * 0.002;
  float a = atan(p.z, p.x) - uPlat.x;
  float scratch = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float rc = 92.0 + fi * 21.0;
    float ac = fi * 2.1 + 0.7;
    float da = abs(mod(a - ac + PI, TAU) - PI);
    float along = smoothstep(0.32, 0.0, da);
    scratch += (1.0 - smoothstep(0.0, 0.12 + fp, abs(r - rc - da * 6.0))) * along;
  }
  c += refl * scratch * 0.25 * fres;
  vec3 l;
  vec3 lampC = lampLight(p, n, l);
  vec3 hl = normalize(l + v);
  c += lampC * aniso(hl, n, t, 0.05, 0.6) * groove * 0.0012;
  c += lampC * pow(max(dot(n, hl), 0.0), 60.0) * edge * 0.25;
  return c;
}

vec3 shadeLabel(vec3 p, vec3 v) {
  float r = length(p.xz);
  vec2 q = p.xz;
  float ca = cos(-uPlat.x);
  float sa = sin(-uPlat.x);
  vec2 lq = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y);
  vec3 col = vec3(0.0);
  if (uFlags.x < 0.5) col = vec3(0.70, 0.64, 0.56);
  else {
    float spread = uPlat.z;
    for (int i = 0; i < 4; i++) {
      float o = (float(i) - 1.5) / 3.0 * spread;
      float c2 = cos(o);
      float s2 = sin(o);
      vec2 qq = vec2(c2 * lq.x - s2 * lq.y, s2 * lq.x + c2 * lq.y);
      col += texture(uLabel, qq / (2.0 * R_LABEL) + 0.5).rgb;
    }
    col *= 0.25;
  }
  col = pow(col, vec3(2.2));
  vec3 n = vec3(0.0, 1.0, 0.0);
  vec3 lk = normalize(KEY_L - p);
  float lam = max(dot(n, lk), 0.0);
  vec3 c = col * (0.03 + 0.16 * lam);
  float cosv = max(dot(n, v), 0.0);
  c += env(p, reflect(-v, n)) * (0.03 + 0.2 * pow(1.0 - cosv, 5.0));
  if (r < 3.8) c = vec3(0.01);
  return c;
}

vec3 shadeSpindle(vec3 p, vec3 v, vec3 n) {
  vec3 refl = env(p, reflect(-v, n));
  vec3 l;
  vec3 lampC = lampLight(p, n, l);
  return vec3(0.02) + refl * 0.7 + lampC * pow(max(dot(n, normalize(l + v)), 0.0), 40.0) * 0.4;
}

vec4 printAt(vec2 xz) {
  vec2 uv = (xz - PRINT_RECT.xy) / (PRINT_RECT.zw - PRINT_RECT.xy);
  if (uFlags.y < 0.5 || any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0);
  return texture(uPrint, uv);
}

vec3 shadePlinth(vec3 p, vec3 v) {
  float r = length(p.xz);
  vec3 n = vec3(0.0, 1.0, 0.0);
  vec2 ctr = (PLINTH.xy + PLINTH.zw) * 0.5;
  vec2 hs = (PLINTH.zw - PLINTH.xy) * 0.5;
  float dEdge = sdBox2(p.xz - ctr, hs, 16.0);
  float bev = smoothstep(-4.0, 0.0, dEdge);
  vec2 ge = vec2(
    sdBox2(p.xz - ctr + vec2(0.5, 0.0), hs, 16.0) - sdBox2(p.xz - ctr - vec2(0.5, 0.0), hs, 16.0),
    sdBox2(p.xz - ctr + vec2(0.0, 0.5), hs, 16.0) - sdBox2(p.xz - ctr - vec2(0.0, 0.5), hs, 16.0)
  );
  vec2 outward = normalize(-ge + 1e-5);
  n = normalize(vec3(outward.x * sin(bev * 1.3), cos(bev * 1.3), outward.y * sin(bev * 1.3)));
  float grain = vnoise(p.xz * 1.7) * 0.5 + vnoise(p.xz * 5.3) * 0.3 + hash12(floor(p.xz * 6.0)) * 0.2;
  vec3 base = vec3(0.022, 0.021, 0.022) * (0.9 + 0.2 * grain);
  vec3 lk = normalize(KEY_L - p);
  vec3 hk = normalize(lk + v);
  float sh = keyShadow(p);
  float ao = 1.0 - 0.7 * exp(-max(r - R_PLAT, 0.0) / 4.0);
  vec3 c = base * (0.06 + 0.6 * max(dot(n, lk), 0.0) * sh) * ao;
  c += vec3(1.0, 0.9, 0.78) * ggx(n, hk, 0.42) * 0.010 * sh * ao;
  c += envSoft(p, reflect(-v, n)) * (0.02 + 0.3 * pow(1.0 - max(dot(n, v), 0.0), 5.0)) * ao;
  vec3 l;
  vec3 lampC = lampLight(p + vec3(0.0, 0.4, 0.0), n, l);
  float ndl = max(dot(n, l), 0.0);
  c += lampC * base * ndl * 3.0 * ao + lampC * ggx(n, normalize(l + v), 0.35) * 0.002 * ao;

  float gap = 1.0 - smoothstep(R_PLAT + 0.6, R_PLAT + 1.8, r);
  c *= 1.0 - 0.97 * gap;

  vec2 sl = p.xz - vec2(XF, ZF0);
  float dSlot = sdBox2(sl, vec2(1.8, HT + 9.0), 1.8);
  float plate = sdBox2(sl, vec2(16.0, HT + 14.0), 3.0);
  c *= 1.0 - 0.18 * cover(plate, fp) * (1.0 - cover(dSlot, fp));
  float plateEdge = 1.0 - smoothstep(0.0, 0.5 + fp, abs(plate));
  c += envSoft(p, reflect(-v, vec3(0.0, 1.0, 0.0))) * plateEdge * 0.12;
  c = mix(c, vec3(0.002), cover(dSlot, fp));

  vec4 pr = printAt(p.xz);
  vec3 ink = vec3(0.78, 0.76, 0.72);
  vec3 inkC = ink * (0.012 + 0.11 * max(dot(n, lk), 0.0) * sh) * ao + lampC * ink * ndl * 0.18;
  inkC += envSoft(p, reflect(-v, n)) * 0.02;
  c = mix(c, inkC, pr.a * (1.0 - cover(dSlot, fp)));

  vec2 kl = p.xz - LED_LOCK;
  float dLed = length(kl);
  float lockOn = uFader.z;
  c += vec3(0.12, 1.0, 0.42) * lockOn * exp(-dLed / 3.5) * 0.12;
  return c;
}

vec3 shadeLedLens(vec3 p, vec3 v, vec3 n, float on, vec3 col) {
  vec3 refl = env(p, reflect(-v, n));
  vec3 c = vec3(0.01) + refl * 0.25;
  c += col * on * 2.4 * (0.6 + 0.4 * max(dot(n, v), 0.0));
  return c;
}

vec3 shadeCap(vec3 p, vec3 v, vec3 n, vec3 c0) {
  vec3 q = p - c0;
  vec3 lk = normalize(KEY_L - p);
  float sh = 1.0;
  vec3 nn = n;
  float ridges = 0.0;
  if (n.y > 0.9) {
    float rib = sin(q.z * 2.6);
    ridges = 1.0 - smoothstep(4.0, 4.8, abs(q.z));
    nn = normalize(n + vec3(0.0, 0.0, rib * 0.3 * ridges));
  }
  float rim = 1.0 - abs(dot(n, normalize(vec3(sign(q.x), 0.0, 0.0)))) * (1.0 - abs(n.y));
  rim = clamp(1.0 - max(abs(n.x), max(abs(n.y), abs(n.z))), 0.0, 1.0) * 2.5;
  vec3 base = vec3(0.028);
  vec3 hk = normalize(lk + v);
  vec3 c = base * (0.08 + 0.55 * max(dot(nn, lk), 0.0)) + vec3(1.0, 0.9, 0.8) * ggx(nn, hk, 0.3) * 0.018;
  c += envSoft(p, reflect(-v, nn)) * (0.04 + 0.1 * rim);
  if (n.y > 0.9) {
    float line = 1.0 - smoothstep(0.35, 0.35 + fp, abs(q.z));
    c = mix(c, vec3(0.42, 0.41, 0.39) * (0.15 + 0.4 * max(dot(nn, lk), 0.0)), line * (1.0 - smoothstep(CAP.x - 1.6, CAP.x - 0.8, abs(q.x))));
  }
  vec3 l;
  vec3 lampC = lampLight(p, nn, l);
  c += lampC * base * max(dot(nn, l), 0.0) * 3.0;
  c *= 1.0 + uFader.y * 0.35;
  return c;
}

vec3 shadeLamp(vec3 p, vec3 v, vec3 n, bool top) {
  vec2 q = p.xz - LAMP_C;
  vec2 w = -normalize(LAMP_C);
  vec3 lk = normalize(KEY_L - p);
  vec3 base = vec3(0.03);
  vec3 c = base * (0.06 + 0.5 * max(dot(n, lk), 0.0));
  c += envSoft(p, reflect(-v, n)) * 0.12;
  if (top) {
    float rr = length(q) / LAMP_R;
    float slit = (1.0 - smoothstep(0.55, 0.62, rr)) * smoothstep(0.2, 0.28, rr);
    float vent = smoothstep(0.35, 0.0, abs(fract(dot(q, vec2(-w.y, w.x)) / 2.6) - 0.5)) * slit;
    c = mix(c, LAMP_COL * uPlat.w * 0.35, vent * 0.5);
    return c;
  }
  vec2 rd = q / LAMP_R;
  float facing = dot(rd, w);
  float win = smoothstep(0.30, 0.42, facing) * smoothstep(LAMP_H - 4.0, LAMP_H - 5.0, p.y) * smoothstep(4.0, 5.0, p.y);
  float flick = 0.94 + 0.06 * vnoise(vec2(uFlags.z * 37.0, p.y * 0.4));
  vec3 glow = LAMP_COL * uPlat.w * (1.6 + 2.0 * smoothstep(0.42, 0.95, facing)) * flick;
  c = mix(c, glow, win);
  float rimRing = 1.0 - smoothstep(0.0, 0.8 + fp, abs(p.y - (LAMP_H - 1.2)));
  c += envSoft(p, reflect(-v, normalize(n + vec3(0.0, 1.0, 0.0)))) * rimRing * 0.15;
  return c;
}

vec3 shadeFront(vec3 p, vec3 v, vec3 n) {
  float grain = vnoise(vec2(p.x * 0.05, p.y * 3.0));
  vec3 lk = normalize(KEY_L - p);
  vec3 c = vec3(0.012) * (0.4 + 0.6 * grain) * (0.3 + 0.7 * max(dot(n, lk), 0.0));
  c += envSoft(p, reflect(-v, n)) * 0.03;
  vec3 l;
  vec3 lampC = lampLight(p, n, l);
  c += lampC * 0.004 * max(dot(n, l), 0.0);
  float lipY = smoothstep(-3.0, 0.0, p.y);
  c += envSoft(p, reflect(-v, normalize(vec3(n.x, 1.0, n.z)))) * lipY * 0.2;
  return c;
}

vec3 shadeTable(vec3 p, vec3 v) {
  float wood = vnoise(vec2(p.x * 0.01, p.z * 0.2)) * 0.6 + vnoise(vec2(p.x * 0.04, p.z * 0.9)) * 0.4;
  vec3 c = vec3(0.016, 0.011, 0.008) * (0.7 + 0.6 * wood);
  vec2 ctr = (PLINTH.xy + PLINTH.zw) * 0.5;
  vec2 hs = (PLINTH.zw - PLINTH.xy) * 0.5;
  float d = sdBox2(p.xz - ctr, hs, 16.0);
  c *= 0.3 + 0.7 * smoothstep(0.0, 60.0, d);
  c += envSoft(p, reflect(-v, vec3(0.0, 1.0, 0.0))) * 0.05;
  return c;
}

vec3 haze(vec3 o, vec3 d, float tMax) {
  vec3 lp = lampPos();
  float s0 = dot(lp - o, d);
  vec3 closest = o + d * s0;
  float h = max(length(lp - closest), 2.0);
  float a = atan((min(tMax, 4000.0) - s0) / h) - atan(-s0 / h);
  return LAMP_COL * uPlat.w * a / h * 0.9;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 pc = vec2(frag.x - uCenter.x, frag.y - (uRes.y - uCenter.y));
  vec3 d = normalize(uCamFwd * uFocal + uCamRight * pc.x + uCamUp * pc.y);
  vec3 o = uCamPos;

  float best = 1e9;
  int id = 0;
  vec3 hn = vec3(0.0, 1.0, 0.0);
  vec3 hc = vec3(0.0);

  float t = hitPlane(o, d, 0.0);
  if (t > 0.0) {
    vec3 p = o + d * t;
    if (p.x > PLINTH.x && p.x < PLINTH.z && p.z > PLINTH.y && p.z < PLINTH.w) {
      vec2 ctr = (PLINTH.xy + PLINTH.zw) * 0.5;
      vec2 hs = (PLINTH.zw - PLINTH.xy) * 0.5;
      if (sdBox2(p.xz - ctr, hs, 16.0) < 0.0) { best = t; id = 1; }
    }
  }
  t = hitPlane(o, d, Y_TABLE);
  if (t > 0.0 && t < best) { best = t; id = 3; }
  if (d.z < 0.0) {
    float tf = (PLINTH.w - o.z) / d.z;
    vec3 p = o + d * tf;
    if (tf > 0.0 && tf < best && p.y < 0.0 && p.y > Y_TABLE && p.x > PLINTH.x + 16.0 && p.x < PLINTH.z - 16.0) { best = tf; id = 2; hn = vec3(0.0, 0.0, 1.0); }
  }
  if (d.x < 0.0) {
    float tf = (PLINTH.z - o.x) / d.x;
    vec3 p = o + d * tf;
    if (tf > 0.0 && tf < best && p.y < 0.0 && p.y > Y_TABLE && p.z > PLINTH.y + 16.0 && p.z < PLINTH.w - 16.0) { best = tf; id = 2; hn = vec3(1.0, 0.0, 0.0); }
  }
  {
    vec2 ctr = vec2(PLINTH.z - 16.0, PLINTH.w - 16.0);
    t = hitCyl(o, d, ctr, 16.0, Y_TABLE, 0.0);
    if (t > 0.0 && t < best) {
      vec3 p = o + d * t;
      vec2 rr = (p.xz - ctr) / 16.0;
      if (rr.x > 0.0 && rr.y > 0.0) { best = t; id = 2; hn = vec3(rr.x, 0.0, rr.y); }
    }
  }
  t = hitCyl(o, d, vec2(0.0), R_PLAT, Y_RIM0, Y_RIM1);
  if (t > 0.0 && t < best) { best = t; id = 4; }
  t = hitPlane(o, d, Y_RIM1);
  if (t > 0.0 && t < best) {
    vec3 p = o + d * t;
    float r = length(p.xz);
    if (r < R_PLAT && r > R_LIP) { best = t; id = 5; }
  }
  t = hitCyl(o, d, vec2(0.0), R_LIP, Y_RIM1, Y_MAT);
  if (t > 0.0 && t < best) { best = t; id = 6; }
  t = hitPlane(o, d, Y_MAT);
  if (t > 0.0 && t < best) {
    vec3 p = o + d * t;
    float r = length(p.xz);
    if (r < R_LIP && r > R_REC) { best = t; id = 6; }
  }
  t = hitCyl(o, d, vec2(0.0), R_REC, Y_MAT, Y_REC);
  if (t > 0.0 && t < best) { best = t; id = 8; }
  t = hitPlane(o, d, Y_REC);
  if (t > 0.0 && t < best) {
    vec3 p = o + d * t;
    float r = length(p.xz);
    if (r < R_REC) { best = t; id = r < R_LABEL ? 9 : 7; }
  }
  t = hitCyl(o, d, vec2(0.0), 3.6, Y_REC, Y_REC + 11.0);
  if (t > 0.0 && t < best) { best = t; id = 10; }
  t = hitPlane(o, d, Y_REC + 11.0);
  if (t > 0.0 && t < best) {
    vec3 p = o + d * t;
    if (length(p.xz) < 3.6) { best = t; id = 16; }
  }
  t = hitCyl(o, d, LAMP_C, LAMP_R, 0.0, LAMP_H);
  if (t > 0.0 && t < best) { best = t; id = 11; }
  t = hitPlane(o, d, LAMP_H);
  if (t > 0.0 && t < best) {
    vec3 p = o + d * t;
    if (length(p.xz - LAMP_C) < LAMP_R) { best = t; id = 12; }
  }
  vec3 bn;
  vec3 capC = vec3(XF, 2.0 + CAP.y, uFader.x);
  t = hitBox(o, d, capC, CAP + 0.05, bn);
  if (t > 0.0 && t < best) {
    float tm = t;
    bool hit = false;
    for (int i = 0; i < 40; i++) {
      float h = sdCap(o + d * tm - capC);
      if (h < 0.004) { hit = true; break; }
      tm += h;
      if (tm > t + 60.0) break;
    }
    if (hit && tm < best) {
      vec3 q = o + d * tm - capC;
      vec2 e = vec2(0.02, 0.0);
      hn = normalize(vec3(sdCap(q + e.xyy) - sdCap(q - e.xyy), sdCap(q + e.yxy) - sdCap(q - e.yxy), sdCap(q + e.yyx) - sdCap(q - e.yyx)));
      best = tm;
      id = 13;
      hc = capC;
    }
  }
  {
    vec3 lc = vec3(LED_LOCK.x, 0.0, LED_LOCK.y) - o;
    float b = dot(lc, d);
    float c = dot(lc, lc) - 2.4 * 2.4;
    float h = b * b - c;
    if (h > 0.0) {
      float ts = b - sqrt(h);
      vec3 p = o + d * ts;
      if (ts > 0.0 && ts < best && p.y > 0.0) { best = ts; id = 15; hn = normalize(p - vec3(LED_LOCK.x, 0.0, LED_LOCK.y)); }
    }
  }

  vec3 p = o + d * best;
  vec3 v = -d;
  fp = max(best / uFocal * 1.15, 0.02);
  vec3 c;
  if (id == 0) c = booth(d);
  else if (id == 1) c = shadePlinth(p, v);
  else if (id == 2) c = shadeFront(p, v, hn);
  else if (id == 3) c = shadeTable(p, v);
  else if (id == 4) c = shadeRim(p, v);
  else if (id == 5) c = shadeLip(p, v);
  else if (id == 6) {
    vec3 lk = normalize(KEY_L - p);
    float rib = 0.5 + 0.5 * sin(length(p.xz) * 6.0);
    c = vec3(0.012) * (0.3 + 0.7 * max(lk.y, 0.0)) * (0.8 + 0.2 * rib) + env(p, reflect(-v, vec3(0.0, 1.0, 0.0))) * 0.015;
  }
  else if (id == 7) c = shadeRecord(p, v);
  else if (id == 8) {
    vec2 rr = normalize(p.xz);
    float k = (p.y - (Y_MAT + Y_REC) * 0.5) / ((Y_REC - Y_MAT) * 0.5);
    vec3 n = normalize(vec3(rr.x, k * 0.9, rr.y));
    float fres = 0.05 + 0.95 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    vec3 l;
    vec3 lampC = lampLight(p, n, l);
    c = vec3(0.004) + env(p, reflect(-v, n)) * (0.08 + fres * 0.6) + lampC * pow(max(dot(n, normalize(l + v)), 0.0), 30.0) * 0.3;
  }
  else if (id == 9) c = shadeLabel(p, v);
  else if (id == 10) {
    vec2 rr = normalize(p.xz);
    c = shadeSpindle(p, v, vec3(rr.x, 0.0, rr.y));
  }
  else if (id == 11) {
    vec2 rr = (p.xz - LAMP_C) / LAMP_R;
    float topB = smoothstep(LAMP_H - 2.0, LAMP_H, p.y);
    c = shadeLamp(p, v, normalize(vec3(rr.x, topB * 1.2, rr.y)), false);
  }
  else if (id == 12) c = shadeLamp(p, v, vec3(0.0, 1.0, 0.0), true);
  else if (id == 13) c = shadeCap(p, v, hn, hc);
  else if (id == 16) {
    vec2 q = p.xz / 3.6;
    c = shadeSpindle(p, v, normalize(vec3(q.x * 0.9, 1.0, q.y * 0.9)));
  }
  else c = shadeLedLens(p, v, hn, uFader.z, vec3(0.12, 1.0, 0.42));

  c += haze(o, d, id == 0 ? 4000.0 : best) * 0.012;

  c *= 1.35;
  vec3 x = max(c, 0.0);
  c = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
  vec2 uvv = frag / uRes - 0.5;
  c *= 1.0 - 0.22 * dot(uvv, uvv);
  c += (hash12(frag + fract(uFlags.z) * 91.0) - 0.5) / 255.0;
  outColor = vec4(c, 1.0);
}
`;
