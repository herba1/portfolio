export const SPLICE_VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SPLICE_FRAGMENT = `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform float uDpr;
uniform vec4 uView;
uniform vec4 uA;
uniform vec4 uB;
uniform vec4 uB2;
uniform vec4 uRazor;
uniform vec4 uRazor2;
uniform vec4 uPencil;
uniform vec4 uTab;
uniform vec4 uTab2;
uniform vec4 uPress[6];
uniform vec4 uBubble[10];
uniform vec4 uMisc;
uniform vec4 uWaveInfo;
uniform sampler2D uMarks;
uniform sampler2D uWave;

out vec4 outColor;

const float TH = 3.175;
const float V0 = 95.25;
const vec2 BLOCK = vec2(62.0, 15.0);
const float BLOCK_H = 9.0;
const float CH = 3.45;
const float HEAD_X = -94.0;
const vec2 CARD = vec2(-38.0, -33.0);
const vec2 CARD_HALF = vec2(16.0, 10.4);
const vec2 TAB_HALF = vec2(12.0, 2.8);
const float SLOT90 = 24.0;
const float PENCIL_LEN = 78.0;

float aa;
vec3 L;
vec2 SD;

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

mat2 rot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, s, -s, c);
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

float fill(float d) {
  return clamp(0.5 - d / aa, 0.0, 1.0);
}

float shade(float d, float blur) {
  return 1.0 - smoothstep(-blur, blur, d);
}

vec2 worldDir(vec2 s) {
  return uView.w > 0.5 ? vec2(s.y, -s.x) : s;
}

float sdBlock(vec2 p) {
  return sdRoundBox(p, BLOCK, 3.2);
}

float sdMount(vec2 p) {
  return sdRoundBox(p - vec2(HEAD_X, 0.0), vec2(13.0, 16.5), 2.6);
}

float sdHead(vec2 p) {
  return sdRoundBox(p - vec2(HEAD_X, 0.0), vec2(5.2, 10.5), 1.8);
}

float sdCard(vec2 p) {
  return sdRoundBox(p - CARD, CARD_HALF, 1.0);
}

vec2 razorLocal(vec2 p) {
  vec2 q = rot(-uRazor.z) * (p - uRazor.xy);
  float c = max(0.2, 1.0 - 0.74 * uRazor.w);
  q.y = 9.5 - (9.5 - q.y) / c;
  return q;
}

float sdRazor(vec2 p) {
  vec2 q = razorLocal(p);
  return sdRoundBox(q, vec2(19.0, 9.5), 1.0);
}

vec2 pencilAxis() {
  return vec2(cos(uPencil.z), sin(uPencil.z));
}

float sdPencil(vec2 p) {
  vec2 a = pencilAxis();
  return sdSeg(p, uPencil.xy + a * 3.0, uPencil.xy + a * (PENCIL_LEN - 3.8)) - 3.9;
}

vec2 bLocal(vec2 p) {
  vec2 d = vec2(cos(uB.z), sin(uB.z));
  vec2 n = vec2(-d.y, d.x);
  vec2 r = p - uB.xy;
  return vec2(dot(r, d), dot(r, n));
}

float bTwist(float s) {
  return 3.14159265 * smoothstep(24.0, 62.0, s) * (1.0 - uB2.y);
}

float sdTapeB(vec2 p) {
  vec2 q = bLocal(p);
  float hw = max(abs(cos(bTwist(q.x))), 0.06);
  return max(abs(q.y) - TH * hw, -(q.x + q.y / hw) * 0.7071);
}

float sdTapeA(vec2 p) {
  float d = abs(p.y) - TH;
  if (uA.y < 1e5) d = max(d, ((p.x - uA.x) + p.y - uA.y) * 0.7071);
  return d;
}

float sdTapeOut(vec2 p) {
  if (uA.w < 0.5) return 1e3;
  return max(abs(p.y) - TH, -((p.x - uA.z) + p.y - uA.y) * 0.7071);
}

vec2 tabCenter() {
  return uTab2.x > 1.5 ? vec2(uTab.x + uA.x, 0.0) : uTab.xy;
}

vec2 tabLocal(vec2 p) {
  return rot(-(uTab2.x > 1.5 ? 0.0 : uTab.z)) * (p - tabCenter());
}

float sdTab(vec2 p) {
  return sdRoundBox(tabLocal(p), TAB_HALF, 0.35);
}

float heightRazor() {
  return mix(0.45, 18.0, uRazor2.x) * (1.0 - 0.75 * uRazor.w) + uRazor.w * BLOCK_H * 0.9;
}

float heightPencil() {
  return mix(4.0, 22.0, uPencil.w);
}

float heightB() {
  return mix(mix(0.25, BLOCK_H, uB2.y), BLOCK_H + 7.0, uB.w);
}

float heightTab() {
  return mix(BLOCK_H + 0.05, BLOCK_H + 12.0, uTab.w);
}

float pressAt(float u) {
  float x = clamp((u + TAB_HALF.x) / (2.0 * TAB_HALF.x) * 23.0, 0.0, 23.0);
  int i0 = int(floor(x));
  int i1 = min(i0 + 1, 23);
  float f = x - float(i0);
  float a = uPress[i0 / 4][i0 - (i0 / 4) * 4];
  float b = uPress[i1 / 4][i1 - (i1 / 4) * 4];
  return mix(a, b, f);
}

vec3 ground(vec2 p, vec2 fp) {
  vec2 q = fp / max(uRes / uDpr, vec2(1.0));
  float pool = 1.0 - smoothstep(0.0, 1.25, length((q - vec2(0.28, 0.18)) * vec2(1.0, 1.15)));
  float g = vnoise(p * 1.9) * 0.5 + vnoise(p * 0.42 + 3.1) * 0.5;
  float fibre = vnoise(vec2(p.x * 0.6, p.y * 5.0) + 9.0);
  vec3 c = vec3(0.918, 0.912, 0.894);
  c *= 0.972 + 0.034 * pool + 0.014 * (g - 0.5) + 0.008 * (fibre - 0.5);
  return c;
}

float movableShadow(vec2 p, float recv) {
  float s = 1.0;
  float h = heightRazor() - recv;
  if (h > 0.05) {
    float d = sdRazor(p - SD * h);
    s *= 1.0 - shade(d, 0.25 + 0.16 * h) * mix(0.34, 0.16, clamp(h / 24.0, 0.0, 1.0));
  }
  h = heightPencil() - recv;
  if (h > 0.05) {
    float d = sdPencil(p - SD * h);
    s *= 1.0 - shade(d, 0.6 + 0.16 * h) * mix(0.3, 0.14, clamp(h / 28.0, 0.0, 1.0));
  }
  if (uB2.x > 0.5) {
    h = heightB() - recv;
    if (h > 0.05) {
      float d = sdTapeB(p - SD * h);
      s *= 1.0 - shade(d, 0.3 + 0.18 * h) * mix(0.3, 0.14, clamp(h / 20.0, 0.0, 1.0)) * uMisc.y;
    }
  }
  if (uTab2.x > 0.5 && uTab2.x < 1.5) {
    h = heightTab() - recv;
    if (h > 0.05) {
      float d = sdTab(p - SD * h);
      s *= 1.0 - shade(d, 0.3 + 0.16 * h) * mix(0.22, 0.1, clamp(h / 20.0, 0.0, 1.0));
    }
  }
  return s;
}

vec3 screw(vec2 p, vec2 c, float r, float ang, vec3 col) {
  vec2 q = p - c;
  float d = length(q);
  float sink = fill(d - r * 1.18);
  vec3 ring = col * (0.62 + 0.25 * clamp(dot(normalize(vec3(-q / max(d, 1e-3), 0.9)), L), 0.0, 1.0));
  col = mix(col, ring * 0.85, sink);
  float head = fill(d - r);
  vec2 n2 = q / r;
  vec3 n = normalize(vec3(n2 * 0.55, 1.0));
  float lit = clamp(dot(n, L), 0.0, 1.0);
  float grain = vnoise(rot(ang) * q * vec2(1.0, 18.0));
  vec3 metal = vec3(0.70, 0.705, 0.71) * (0.62 + 0.42 * lit) + (grain - 0.5) * 0.05;
  metal += pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0) * 0.18;
  vec2 sq = rot(-ang) * q;
  float slot = fill(abs(sq.y) - r * 0.13) * step(abs(sq.x), r * 0.92);
  metal = mix(metal, vec3(0.16, 0.16, 0.17), slot);
  float lip = fill(abs(sq.y + r * 0.16) - 0.06) * step(abs(sq.x), r * 0.85) * (1.0 - slot);
  metal = mix(metal, metal * 1.18, lip * 0.6);
  col = mix(col, metal, head);
  col *= 1.0 - 0.25 * exp(-max(d - r, 0.0) / 0.25) * (1.0 - head) * sink;
  return col;
}

vec3 slotGroove(vec3 c, float d) {
  float w = 0.26;
  float inside = fill(abs(d) - w);
  float t = clamp(d / w, -1.0, 1.0);
  vec3 deep = mix(vec3(0.2, 0.205, 0.215), vec3(0.42, 0.43, 0.44), smoothstep(-0.2, 1.0, t));
  deep *= 0.75 + 0.25 * (1.0 - t * t);
  vec3 g = mix(c, deep, inside);
  float lit = exp(-pow((d - w - 0.08) / 0.09, 2.0));
  float dark = exp(-pow((d + w + 0.06) / 0.08, 2.0));
  return g * (1.0 - 0.25 * dark) + vec3(0.09) * lit;
}

vec3 blockColor(vec2 p) {
  float d = sdBlock(p);
  float e = 0.04;
  vec2 g = vec2(sdBlock(p + vec2(e, 0.0)) - sdBlock(p - vec2(e, 0.0)), sdBlock(p + vec2(0.0, e)) - sdBlock(p - vec2(0.0, e))) / (2.0 * e);
  float t = clamp(1.0 + d / 1.6, 0.0, 1.0);
  float slope = t * t * 2.2;
  vec3 n = normalize(vec3(g * slope, 1.0));
  float streakA = vnoise(vec2(p.x * 0.035, p.y * 7.0));
  float streakB = vnoise(vec2(p.x * 0.12, p.y * 34.0));
  float streakC = hash12(vec2(floor(p.y * 90.0), floor(p.x * 0.4)));
  float streak = streakA * 0.45 + streakB * 0.4 + streakC * 0.15;
  vec3 base = vec3(0.735, 0.745, 0.758) + (streak - 0.5) * 0.085;
  float lit = clamp(dot(n, L), 0.0, 1.0);
  float band = exp(-pow((p.y + 4.0 + p.x * 0.05) / 10.5, 2.0));
  float band2 = exp(-pow((p.y - 9.5 - p.x * 0.03) / 3.2, 2.0));
  vec3 c = base * (0.62 + 0.42 * lit);
  c += vec3(0.06, 0.062, 0.066) * band * (0.5 + streak);
  c += vec3(0.035) * band2 * (0.4 + streakB);
  c = mix(c, c * 0.9, smoothstep(-BLOCK.x, BLOCK.x, p.x) * 0.25);
  float ch = abs(p.y);
  if (ch < CH + 0.6) {
    float cy = clamp(p.y / CH, -1.0, 1.0);
    vec3 nc = normalize(vec3(0.0, -cy * 1.1, 1.0));
    float litc = clamp(dot(nc, L), 0.0, 1.0);
    vec3 floorC = (base * 0.72) * (0.5 + 0.55 * litc) + vec3(0.03) * exp(-pow((p.y - 1.4) / 0.8, 2.0));
    float inside = fill(ch - CH);
    c = mix(c, floorC, inside);
    float lip = exp(-pow((ch - CH) / max(aa * 1.2, 0.06), 2.0));
    c *= 1.0 - 0.5 * lip;
    float catchLight = exp(-pow((p.y - CH - 0.25) / 0.18, 2.0));
    c += vec3(0.07) * catchLight;
  }
  c = slotGroove(c, (p.x + p.y) * 0.7071);
  c = slotGroove(c, p.x - SLOT90);
  c = screw(p, vec2(-54.0, 9.4), 2.1, 0.6, c);
  c = screw(p, vec2(-54.0, -9.4), 2.1, 2.2, c);
  c = screw(p, vec2(54.0, 9.4), 2.1, 1.3, c);
  c = screw(p, vec2(54.0, -9.4), 2.1, -0.4, c);
  float rim = smoothstep(-0.5, 0.0, d);
  c *= 1.0 - 0.18 * rim * clamp(dot(g, -L.xy * 2.0) + 0.3, 0.0, 1.0);
  return c;
}

vec3 mountColor(vec2 p, vec3 c) {
  float d = sdMount(p);
  float e = 0.04;
  vec2 g = vec2(sdMount(p + vec2(e, 0.0)) - sdMount(p - vec2(e, 0.0)), sdMount(p + vec2(0.0, e)) - sdMount(p - vec2(0.0, e))) / (2.0 * e);
  float t = clamp(1.0 + d / 1.1, 0.0, 1.0);
  vec3 n = normalize(vec3(g * t * t * 2.0, 1.0));
  float lit = clamp(dot(n, L), 0.0, 1.0);
  float grain = vnoise(p * 6.0) * 0.6 + hash12(floor(p * 14.0)) * 0.4;
  vec3 base = vec3(0.205, 0.207, 0.215) * (0.7 + 0.45 * lit) + (grain - 0.5) * 0.02;
  base += vec3(0.05) * exp(-pow((p.y + 10.0) / 6.0, 2.0));
  base = screw(p, vec2(HEAD_X - 8.4, -12.6), 1.7, 0.9, base);
  base = screw(p, vec2(HEAD_X + 8.4, 12.6), 1.7, 2.6, base);
  for (int i = 0; i < 4; i++) {
    vec2 pc = vec2(HEAD_X + (i < 2 ? -8.8 : 8.8), (i == 0 || i == 2) ? -(TH + 1.05) : TH + 1.05);
    vec2 r = p - pc;
    float dr = length(r);
    float sh = shade(length(r - SD * 3.0) - 0.85, 0.7);
    base *= 1.0 - 0.35 * sh * step(0.85, dr);
    vec3 pn = normalize(vec3(r / 0.85 * 0.8, 1.0));
    float pl = clamp(dot(pn, L), 0.0, 1.0);
    vec3 pin = vec3(0.74, 0.76, 0.79) * (0.45 + 0.65 * pl) + pow(max(dot(reflect(-L, pn), vec3(0.0, 0.0, 1.0)), 0.0), 30.0) * 0.4;
    pin *= 1.0 - 0.3 * smoothstep(0.55, 0.85, dr / 0.85) * (1.0 - pl);
    base = mix(base, pin, fill(dr - 0.85));
  }
  return mix(c, base, fill(d));
}

vec3 headColor(vec2 p, vec3 c) {
  float d = sdHead(p);
  float nx = clamp((p.x - HEAD_X) / 5.2, -1.0, 1.0);
  float ny = clamp(p.y / 10.5, -1.0, 1.0);
  float edgeY = smoothstep(0.82, 1.0, abs(ny));
  vec3 n = normalize(vec3(nx * 0.9, sign(ny) * edgeY * 0.8, sqrt(max(0.0, 1.0 - nx * nx * 0.81))));
  float env = 0.32;
  env += 0.62 * smoothstep(-0.95, -0.55, nx) * (1.0 - smoothstep(-0.4, -0.12, nx));
  env += 0.18 * smoothstep(-0.05, 0.25, nx) * (1.0 - smoothstep(0.35, 0.6, nx));
  env += 0.42 * smoothstep(0.62, 0.92, nx);
  env -= 0.18 * smoothstep(0.25, 0.4, nx) * (1.0 - smoothstep(0.45, 0.6, nx));
  float lit = clamp(dot(n, L), 0.0, 1.0);
  vec3 chrome = vec3(0.78, 0.8, 0.83) * (0.25 + 0.75 * env) * (0.75 + 0.3 * lit);
  chrome += vec3(0.02, 0.025, 0.035);
  float gap = fill(abs(p.x - HEAD_X) - 0.09);
  chrome = mix(chrome, vec3(0.1, 0.1, 0.11), gap * 0.9);
  float pole = fill(abs(abs(p.x - HEAD_X) - 1.1) - 0.05) * 0.25;
  chrome *= 1.0 - pole;
  float rim = smoothstep(-0.35, 0.0, d);
  chrome *= 1.0 - 0.35 * rim;
  return mix(c, chrome, fill(d));
}

float marksCover(vec2 q, int start, int count) {
  if (count <= 0) return 0.0;
  float d = 1e3;
  for (int i = 0; i < 128; i++) {
    if (i >= count) break;
    vec4 sg = texelFetch(uMarks, ivec2(start + i, 0), 0);
    d = min(d, sdSeg(q, sg.xy, sg.zw));
  }
  float r = 0.36;
  float cov = clamp(0.5 - (d - r) / max(aa, 0.03), 0.0, 1.0);
  float g = vnoise(q * 8.0) * 0.55 + hash12(floor(q * 24.0)) * 0.45;
  cov *= smoothstep(0.12, 0.42, g + (r - d) * 0.9);
  return cov;
}

vec3 tapeColor(float s, float v, float id, vec2 p) {
  vec3 base = id < 0.5 ? vec3(0.392, 0.228, 0.132) : vec3(0.318, 0.19, 0.118);
  float grain = hash12(floor(vec2(s * 14.0, v * 14.0)));
  float coat = vnoise(vec2(s * 0.05, v * 5.0) + id * 17.0);
  float fine = vnoise(vec2(s * 1.6, v * 22.0) + id * 5.0);
  base *= 0.92 + 0.09 * coat + 0.045 * (grain - 0.5) + 0.03 * (fine - 0.5);
  if (uWaveInfo.w > 0.5) {
    float t = s / V0 + (id < 0.5 ? uWaveInfo.y : uWaveInfo.z);
    float u = fract(t / max(uWaveInfo.x, 0.01));
    float env = texture(uWave, vec2(u, id < 0.5 ? 0.25 : 0.75)).r;
    float amp = TH * 0.84 * env;
    float inside = clamp(0.5 - (abs(v) - amp) / max(aa, 0.02), 0.0, 1.0);
    vec3 print = base * vec3(1.2, 1.15, 1.08) + vec3(0.022, 0.013, 0.004);
    base = mix(base, print, inside * 0.62);
    float crest = exp(-pow((abs(v) - amp) / max(aa * 1.2, 0.05), 2.0)) * step(0.04, env);
    base = mix(base, print * 1.05, crest * 0.18);
  }
  float edge = smoothstep(TH - 0.3, TH - 0.04, abs(v));
  base = mix(base, base * 1.3 + 0.01, edge * 0.45);
  float sheenPos = exp(-pow((p.x + 30.0) / 70.0, 2.0)) * (0.65 + 0.35 * (1.0 - v / TH * 0.5));
  base += vec3(0.05, 0.04, 0.032) * sheenPos * (0.6 + 0.8 * fine) * (1.0 - edge * 0.5);
  float mk = marksCover(vec2(s, v), id < 0.5 ? 0 : 128, int(id < 0.5 ? uMisc.z : uMisc.w));
  vec3 wax = vec3(0.95, 0.94, 0.905) * (0.94 + 0.08 * vnoise(vec2(s, v) * 20.0));
  base = mix(base, wax, mk * 0.9);
  return base;
}

vec3 cutShine(vec3 col, float dc, float v, float strength) {
  float line = 1.0 - smoothstep(0.0, 0.26, dc);
  float g = uMisc.x;
  float pos = mix(-TH - 2.0, TH + 2.0, g);
  float glint = exp(-pow((v - pos) / 1.1, 2.0)) * (1.0 - smoothstep(0.85, 1.0, g)) * step(0.001, g);
  return col + vec3(0.32, 0.29, 0.25) * line * (strength + glint * 1.6);
}

void paintTab(inout vec3 col, vec2 p, float alpha) {
  vec2 q = tabLocal(p);
  float d = sdRoundBox(q, TAB_HALF, 0.3);
  float cov = fill(d) * alpha;
  if (cov <= 0.0) return;
  bool laid = uTab2.x > 1.5;
  float pr = laid ? pressAt(q.x) : 0.0;
  float crinkle = vnoise(q * vec2(0.8, 2.2) + 4.0) * 0.55 + vnoise(q * vec2(3.0, 5.0) + 1.0) * 0.45;
  float frost = mix(0.8, 0.12, pr);
  frost *= 0.82 + 0.36 * crinkle * (1.0 - pr * 0.8);
  vec3 under = laid ? col : vec3(0.9, 0.89, 0.87);
  vec3 white = vec3(0.955, 0.958, 0.955);
  vec3 c = mix(under * (1.0 + 0.06 * pr) + vec3(0.025), white, clamp(frost, 0.0, 1.0));
  if (laid) {
    for (int i = 0; i < 10; i++) {
      vec4 b = uBubble[i];
      if (b.z <= 0.01) continue;
      vec2 r = (q - b.xy) / vec2(b.z * 1.3, b.z);
      float dl = length(r);
      if (dl > 1.35) continue;
      float inb = clamp(0.5 - (dl - 1.0) * b.z / max(aa, 0.02), 0.0, 1.0) * b.w;
      vec3 nb = normalize(vec3(r * 0.55 * smoothstep(0.35, 1.0, dl), 1.0));
      float lit = clamp(dot(nb, L), 0.0, 1.0);
      float spec = pow(max(dot(reflect(-L, nb), vec3(0.0, 0.0, 1.0)), 0.0), 26.0);
      vec3 bc = mix(under, white, 0.7) * (0.9 + 0.14 * lit) + vec3(0.4) * spec;
      float ring = exp(-pow((dl - 0.97) / 0.07, 2.0));
      bc *= 1.0 - 0.28 * ring * (1.0 - lit);
      bc += vec3(0.16) * ring * lit;
      c = mix(c, bc, inb);
    }
  }
  float gloss = exp(-pow((q.y + 0.9 + q.x * 0.04) / 0.9, 2.0));
  c += vec3(0.05) * gloss * (0.4 + 0.9 * pr);
  float edge = exp(-pow(d / max(aa * 0.9, 0.05), 2.0));
  c = mix(c, white * 1.02, edge * 0.5);
  col = mix(col, c, cov);
}

vec4 razorColor(vec2 p) {
  vec2 q = razorLocal(p);
  float d = sdRoundBox(q, vec2(19.0, 9.5), 1.0);
  float cov = fill(d * max(0.2, 1.0 - 0.74 * uRazor.w));
  if (cov <= 0.0) return vec4(0.0);
  float tilt = uRazor.w;
  vec3 n = normalize(vec3(rot(uRazor.z) * vec2(0.0, -tilt * 1.2), 1.0));
  float lit = clamp(dot(n, L), 0.0, 1.0);
  float brush = vnoise(vec2(q.x * 0.25, q.y * 14.0)) * 0.6 + vnoise(vec2(q.x * 1.3, q.y * 40.0)) * 0.4;
  vec3 face = vec3(0.6, 0.62, 0.655) + (brush - 0.5) * 0.07;
  float sheen = exp(-pow((q.x + q.y * 0.6 + 4.0) / 9.0, 2.0));
  face = face * (0.7 + 0.35 * lit) + vec3(0.12, 0.125, 0.13) * sheen * (0.5 + brush);
  vec3 c = face;
  if (q.y < -5.6) {
    float sy = (q.y + 7.55) / 1.95;
    vec3 sn = normalize(vec3(0.0, clamp(sy, -1.0, 1.0) * 0.8, 1.0));
    sn.xy = rot(uRazor.z) * sn.xy;
    float sl = clamp(dot(sn, L), 0.0, 1.0);
    float crimp = 0.5 + 0.5 * sin(q.x * 5.2);
    vec3 spine = vec3(0.34, 0.345, 0.365) * (0.62 + 0.55 * sl) + vec3(0.03) * crimp * step(abs(sy), 0.7);
    spine += vec3(0.1) * exp(-pow((sy + 0.35) / 0.25, 2.0));
    c = spine;
    float seam = exp(-pow((q.y + 5.6) / 0.12, 2.0));
    c *= 1.0 - 0.4 * seam;
  }
  if (q.y > 8.1) {
    float by = (q.y - 8.1) / 1.4;
    float grind = 0.5 + 0.5 * sin(q.x * 55.0 + vnoise(q * 3.0) * 4.0);
    vec3 bev = vec3(0.82, 0.84, 0.87) * (0.85 + 0.12 * grind) + vec3(0.06) * (1.0 - by);
    c = mix(c, bev, smoothstep(8.1, 8.3, q.y));
    c *= 1.0 - 0.45 * smoothstep(9.25, 9.5, q.y);
  }
  float rim = smoothstep(-0.25, 0.0, d);
  c *= 1.0 - 0.25 * rim;
  c *= 1.0 - 0.18 * tilt;
  return vec4(c, cov);
}

vec4 pencilColor(vec2 p) {
  vec2 a = pencilAxis();
  vec2 nrm = vec2(-a.y, a.x);
  vec2 r = p - uPencil.xy;
  float u = dot(r, a);
  float w = dot(r, nrm);
  if (u < -1.5 || u > PENCIL_LEN + 1.0 || abs(w) > 5.0) return vec4(0.0);
  float rad;
  if (u < 9.0) rad = mix(0.85, 3.55, smoothstep(0.0, 9.0, u) * 0.7 + u / 9.0 * 0.3);
  else rad = 3.95;
  float d = abs(w) - rad;
  if (u < 0.8) d = max(d, length(vec2(u - 0.8, w)) - 0.85);
  d = max(d, u - PENCIL_LEN);
  float cov = fill(d);
  if (cov <= 0.0) return vec4(0.0);
  float wr = clamp(w / rad, -1.0, 1.0);
  vec3 n = normalize(vec3(nrm * wr, sqrt(max(0.0, 1.0 - wr * wr))));
  float lit = clamp(dot(n, L), 0.0, 1.0);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 14.0);
  vec3 c;
  float paper = smoothstep(8.6, 9.4, u + (vnoise(vec2(w * 3.0, 1.0)) - 0.5) * 0.9);
  vec3 wax = vec3(0.93, 0.925, 0.9) * (0.62 + 0.45 * lit) + spec * 0.12;
  float worn = smoothstep(2.4, 0.4, u) * smoothstep(-0.2, 0.6, w / rad);
  wax = mix(wax, wax * 0.86, worn);
  float spiral = fract((u + w * 1.25) / 11.0);
  float seam = smoothstep(0.0, 0.012, spiral) * (1.0 - smoothstep(0.012, 0.04, spiral));
  float peel = smoothstep(0.0, 0.04, spiral) * (1.0 - smoothstep(0.04, 0.5, spiral));
  float sp = fract((u + w * 1.25) / 11.0 + 0.5);
  float string = (1.0 - smoothstep(0.0, 0.18, abs(sp - 0.5) * 11.0 - 0.16)) * step(18.0, u) * step(u, 70.0);
  vec3 wrap = vec3(0.965, 0.958, 0.94) * (0.6 + 0.45 * lit) + spec * 0.18;
  wrap *= 1.0 - 0.16 * seam;
  wrap *= 1.0 - 0.035 * peel;
  wrap = mix(wrap, vec3(0.62, 0.16, 0.12) * (0.6 + 0.5 * lit), string * 0.85);
  float cap = smoothstep(PENCIL_LEN - 1.2, PENCIL_LEN - 0.2, u);
  wrap = mix(wrap, wrap * 0.82, cap);
  c = mix(wax, wrap, paper);
  float rim = smoothstep(-0.3, 0.0, d);
  c *= 1.0 - 0.22 * rim;
  return vec4(c, cov);
}

void main() {
  vec2 fp = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 sp = (fp - uView.xy) / uView.z;
  vec2 p = uView.w > 0.5 ? vec2(sp.y, -sp.x) : sp;
  aa = 1.0 / max(uView.z * uDpr, 0.05);
  L = normalize(vec3(worldDir(vec2(-0.5, -0.78)), 1.05));
  SD = worldDir(vec2(0.3, 0.52));

  vec3 col = ground(p, fp);
  float recv = 0.0;

  float dCard = sdCard(p);
  {
    float sh = shade(sdCard(p - SD * 0.5), 0.5);
    col *= 1.0 - 0.14 * sh * (1.0 - fill(dCard));
    vec2 q = p - CARD;
    float gl = vnoise(q * vec2(0.2, 0.6)) * 0.5 + vnoise(q * 3.0) * 0.5;
    vec3 card = vec3(0.958, 0.953, 0.935) * (0.985 + 0.03 * gl);
    card += vec3(0.02) * exp(-pow((q.y + q.x * 0.3 + 3.0) / 6.0, 2.0));
    float border = fill(abs(sdRoundBox(q, CARD_HALF - 1.6, 0.4)) - 0.07);
    card = mix(card, vec3(0.62, 0.6, 0.56), border * 0.35);
    float rim = smoothstep(-0.3, 0.0, dCard);
    card *= 1.0 - 0.06 * rim;
    for (int i = 0; i < 3; i++) {
      vec2 tq = q - vec2(0.0, (float(i) - 1.0) * 6.2);
      float td = sdRoundBox(tq, TAB_HALF, 0.35);
      float present = mod(floor(uTab2.y / pow(2.0, float(i))), 2.0);
      float ghost = fill(td) * (1.0 - present);
      card = mix(card, card * 1.012 + 0.004, ghost);
      if (present > 0.5) {
        card *= 1.0 - 0.1 * shade(sdRoundBox(tq - SD * 0.25, TAB_HALF, 0.35), 0.18) * (1.0 - fill(td));
        float crink = vnoise(tq * vec2(0.8, 2.2) + 4.0 + float(i) * 7.0) * 0.55 + vnoise(tq * vec2(3.0, 5.0) + 1.0) * 0.45;
        vec3 tc = mix(card * 0.97, vec3(0.955, 0.958, 0.955), 0.66 + 0.29 * crink);
        tc += exp(-pow((tq.y + 1.2) / 1.0, 2.0)) * 0.05;
        tc *= 1.0 - 0.1 * smoothstep(-0.3, 0.0, td);
        card = mix(card, tc, fill(td));
      }
    }
    col = mix(col, card, fill(dCard));
    recv = mix(recv, 0.3, step(dCard, 0.0));
  }

  float dMount = sdMount(p);
  float dBlock = sdBlock(p);
  float dHead = sdHead(p);
  {
    float sb = shade(dBlock - 0.4 - 0.0 * aa, 0.4) ;
    float far = shade(sdBlock(p - SD * BLOCK_H), 3.4);
    float near = exp(-max(dBlock, 0.0) / 1.1);
    float sm = shade(sdMount(p - SD * 4.0), 1.8);
    float nm = exp(-max(dMount, 0.0) / 0.8);
    float shadow = (1.0 - 0.3 * far) * (1.0 - 0.22 * near) * (1.0 - 0.26 * sm) * (1.0 - 0.18 * nm);
    col *= mix(shadow, 1.0, sb * 0.0);
  }

  if (dMount < aa * 2.0) {
    col = mountColor(p, col);
    recv = mix(recv, 4.0, step(dMount, 0.0));
    float sh = shade(sdHead(p - SD * 5.0), 1.0);
    col *= 1.0 - 0.35 * sh * (1.0 - fill(dHead)) * fill(dMount);
  }
  if (dHead < aa * 2.0) {
    col = headColor(p, col);
    recv = mix(recv, BLOCK_H, step(dHead, 0.0));
  }
  if (dBlock < aa * 2.0) {
    col = mix(col, blockColor(p), fill(dBlock));
    recv = mix(recv, BLOCK_H, step(dBlock, 0.0));
  }

  float fade = uMisc.y;
  if (recv < BLOCK_H - 0.5) {
    float h = BLOCK_H - recv;
    vec2 ps = p - SD * h;
    float ta = min(sdTapeA(ps), sdTapeOut(ps));
    col *= 1.0 - shade(ta, 0.4 + 0.18 * h) * 0.2 * fade;
  }

  float dA = sdTapeA(p);
  if (dA < aa * 2.0) {
    float s = p.x - uA.x;
    vec3 tc = tapeColor(s, p.y, 0.0, p);
    if (uA.y < 1e5) {
      float dc = (uA.y - (s + p.y)) * 0.7071;
      tc = cutShine(tc, dc, p.y, 0.16);
    }
    float a = fill(dA) * fade;
    col = mix(col, tc, a);
    recv = mix(recv, BLOCK_H, step(dA, 0.0));
  }

  float dO = sdTapeOut(p);
  if (dO < aa * 2.0) {
    float s = p.x - uA.z;
    vec3 tc = tapeColor(s, p.y, 0.0, p);
    float dc = ((s + p.y) - uA.y) * 0.7071;
    tc = cutShine(tc, dc, p.y, 0.3);
    col = mix(col, tc, fill(dO) * fade);
    recv = mix(recv, BLOCK_H, step(dO, 0.0));
  }

  if (uB2.x > 0.5) {
    vec2 q = bLocal(p);
    float tw = bTwist(q.x);
    float cw = cos(tw);
    float hw = max(abs(cw), 0.06);
    float vt = q.y / hw;
    float dB = max(abs(q.y) - TH * hw, -(q.x + vt) * 0.7071);
    if (dB < aa * 2.0) {
      vec3 tc = tapeColor(q.x, vt * sign(cw + 1e-4), 1.0, p);
      float dc = (q.x + vt) * 0.7071;
      tc = cutShine(tc, dc, vt, 0.3);
      float sw = sin(tw);
      float bend = clamp(dot(normalize(vec3(rot(uB.z) * vec2(0.0, sw), abs(cw) + 0.05)), L), 0.0, 1.0);
      tc *= mix(1.0, 0.7 + 0.45 * bend, smoothstep(0.02, 0.3, abs(sw)));
      if (cw < 0.0) {
        float gl = vnoise(vec2(q.x * 0.08, vt * 3.0));
        vec3 back = vec3(0.13, 0.085, 0.06) * (0.85 + 0.25 * gl);
        float sheen = pow(clamp(bend, 0.0, 1.0), 6.0) * 0.5 + exp(-pow((sw - 0.45) / 0.18, 2.0)) * 0.28;
        back += vec3(0.62, 0.58, 0.54) * sheen * (0.7 + 0.3 * gl);
        back += vec3(0.05) * exp(-pow((abs(vt) - TH * 0.6) / 0.6, 2.0));
        tc = back;
      }
      float edgeT = smoothstep(TH * hw - 0.25, TH * hw, abs(q.y)) * smoothstep(0.1, 0.5, abs(sw));
      tc = mix(tc, tc * 0.75, edgeT * 0.5);
      tc *= 1.0 + 0.05 * uB.w;
      col = mix(col, tc, fill(dB) * fade);
      recv = mix(recv, heightB(), step(dB, 0.0));
    }
  }

  if (uTab2.x > 1.5) {
    paintTab(col, p, fade);
    recv = mix(recv, BLOCK_H + 0.05, step(sdTab(p), 0.0));
  }

  col *= movableShadow(p, recv);

  if (uTab2.x > 0.5 && uTab2.x < 1.5) paintTab(col, p, 1.0);

  vec4 pc = pencilColor(p);
  col = mix(col, pc.rgb, pc.a);
  vec4 rc = razorColor(p);
  col = mix(col, rc.rgb, rc.a);

  col += (hash12(fp * uDpr + 0.5) - 0.5) / 255.0;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
