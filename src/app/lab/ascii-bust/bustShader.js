export const NG = 24;
export const SUB_X = 4;
export const SUB_Y = 6;

export const BUST_VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const BUST_SCENE = `#version 300 es
precision highp float;
uniform vec2 uOrigin;
uniform vec2 uCell;
uniform vec3 uFrame;
uniform float uYaw;
uniform vec3 uLight;
uniform sampler2D uPhoto;
out vec4 outColor;

const float FLOOR_Y = -0.93;
const float CAM_D = 6.0;
const float CAM_Y = 0.42;
const float WORLD_CY = 0.02;
float gDetail = 1.0;
float gExact = 1.0;

float hash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y);
  float b = mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y);
  return mix(a, b, f.z);
}

float sdEll(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-4);
}

float sdCap(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

float sdCyl(vec3 p, float r, float y0, float y1, float round) {
  vec2 d = vec2(length(p.xz) - r + round, abs(p.y - (y0 + y1) * 0.5) - (y1 - y0) * 0.5 + round);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - round;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float smax(float a, float b, float k) {
  return -smin(-a, -b, k);
}

float lum(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

vec2 photoUv(vec3 p) {
  return vec2(0.56 + p.x * 1.2, 0.43 - (p.y - 0.35) * 1.2);
}

float frontMask(vec3 p) {
  vec2 uv = photoUv(p);
  float inside = smoothstep(0.0, 0.08, uv.x) * smoothstep(1.0, 0.92, uv.x) * smoothstep(0.0, 0.1, uv.y) * smoothstep(1.02, 0.96, uv.y);
  return inside * smoothstep(-0.05, 0.16, p.z) * (1.0 - smoothstep(0.27, 0.4, abs(p.x)));
}

float relief(vec3 p) {
  float m = frontMask(p);
  if (m <= 0.0) return 0.0;
  vec2 uv = photoUv(p);
  float hi = lum(textureLod(uPhoto, uv, 0.4).rgb) - lum(textureLod(uPhoto, uv, 3.5).rgb);
  return hi * m;
}

vec3 objectSpace(vec3 p) {
  float c = cos(uYaw);
  float s = sin(uYaw);
  return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
}

float bustHead(vec3 p, out float idOut) {
  vec3 q = vec3(abs(p.x), p.y, p.z);
  float skull = sdEll(p - vec3(0.0, 0.49, -0.03), vec3(0.32, 0.37, 0.37));
  float face = sdEll(p - vec3(0.0, 0.3, 0.07), vec3(0.265, 0.36, 0.29));
  float skin = smin(skull, face, 0.08);
  skin = smin(skin, sdEll(p - vec3(0.0, 0.43, 0.24), vec3(0.23, 0.055, 0.1)), 0.05);
  skin = smin(skin, sdEll(q - vec3(0.15, 0.25, 0.19), vec3(0.1, 0.08, 0.1)), 0.06);
  float socket = length(q - vec3(0.112, 0.352, 0.33)) - 0.066;
  skin = smax(skin, -socket, 0.035);
  skin = smin(skin, length(q - vec3(0.112, 0.345, 0.235)) - 0.06, 0.03);
  float nose = sdCap(p, vec3(0.0, 0.39, 0.315), vec3(0.0, 0.255, 0.43), 0.026);
  nose = smin(nose, length(p - vec3(0.0, 0.243, 0.425)) - 0.036, 0.02);
  nose = smin(nose, length(q - vec3(0.038, 0.232, 0.375)) - 0.03, 0.025);
  skin = smin(skin, nose, 0.035);
  skin = smin(skin, sdEll(p - vec3(0.0, 0.118, 0.33), vec3(0.055, 0.018, 0.03)), 0.015);

  float beard = sdEll(p - vec3(0.0, 0.1, 0.07), vec3(0.275, 0.245, 0.29));
  beard = smax(beard, p.y - (0.17 + 2.2 * q.x * q.x), 0.04);
  float stache = sdCap(q, vec3(0.0, 0.182, 0.362), vec3(0.085, 0.152, 0.325), 0.026);
  stache = smin(stache, sdCap(q, vec3(0.085, 0.152, 0.325), vec3(0.11, 0.075, 0.29), 0.022), 0.02);
  beard = smin(beard, stache, 0.02);
  beard = smax(beard, -sdEll(p - vec3(0.0, 0.128, 0.36), vec3(0.048, 0.014, 0.05)), 0.01);
  if (gDetail > 0.5) {
    float curl = vnoise(p * 34.0) - 0.5;
    float comb = sin(p.x * 70.0 + p.y * 18.0 + vnoise(p * 9.0) * 4.0);
    beard += curl * 0.012 + comb * 0.0035;
  }

  float cap = sdEll(p - vec3(0.0, 0.48, -0.05), vec3(0.37, 0.385, 0.405));
  float hairline = (0.64 - 0.95 * q.x) - p.y;
  cap = smax(cap, -smax(-hairline, 0.05 - p.z, 0.05), 0.05);
  float curtain = sdEll(p - vec3(0.0, 0.2, -0.1), vec3(0.44, 0.56, 0.37));
  float window = sdEll(p - vec3(0.0, 0.2, 0.32), vec3(0.275, 0.5, 0.36));
  curtain = smax(curtain, -window, 0.05);
  curtain = smax(curtain, -0.32 - p.y + 0.12 * q.x, 0.06);
  float hair = smin(cap, curtain, 0.07);
  if (gDetail > 0.5) {
    float part = smoothstep(0.035, 0.0, abs(p.x)) * smoothstep(0.55, 0.85, p.y);
    float phase = atan(q.x + 0.03, max(1.02 - p.y, 0.02)) * 34.0 + p.z * 5.0 + vnoise(p * 5.0) * 3.0;
    float groove = 0.5 + 0.5 * sin(phase);
    hair -= groove * 0.009 - part * 0.012 + (vnoise(p * 22.0) - 0.5) * 0.006;
  }

  float rim = length(vec2(length(q.xy - vec2(0.114, 0.352)) - 0.074, q.z - 0.338)) - 0.0085;
  float bridge = sdCap(p, vec3(-0.042, 0.37, 0.352), vec3(0.042, 0.37, 0.352), 0.0065);
  float temple = sdCap(q, vec3(0.186, 0.36, 0.332), vec3(0.3, 0.37, 0.06), 0.0075);
  float glasses = min(min(rim, bridge), temple);

  if (gDetail > 0.5) {
    float rel = relief(p);
    skin -= rel * 0.012;
    beard -= rel * 0.008;
  }

  float d = skin;
  float id = 0.0;
  if (beard < d) { d = beard; id = 2.0; }
  float joined = smin(skin, beard, 0.03);
  d = joined;
  if (hair < d + 0.004) id = 1.0;
  d = smin(d, hair, 0.025);
  if (glasses < d) id = 3.0;
  d = min(d, glasses);
  idOut = id;
  return d;
}

float bustBody(vec3 p) {
  vec3 q = vec3(abs(p.x), p.y, p.z);
  float neck = sdCap(p, vec3(0.0, -0.22, -0.04), vec3(0.0, 0.16, -0.01), 0.135);
  float torso = sdEll(p - vec3(0.0, -0.46, -0.05), vec3(0.4, 0.3, 0.215));
  float shoulder = sdCap(q, vec3(0.1, -0.2, -0.05), vec3(0.4, -0.3, -0.07), 0.12);
  torso = smin(torso, shoulder, 0.14);
  torso = smin(torso, sdEll(q - vec3(0.13, -0.4, 0.08), vec3(0.16, 0.14, 0.12)), 0.1);
  float cut = (-0.66 + 0.75 * p.x * p.x) - p.y;
  torso = smax(torso, cut, 0.02);
  torso = smax(torso, q.x - 0.5, 0.03);
  float body = smin(neck, torso, 0.1);
  float stem = sdCyl(p, 0.1, -0.84, -0.6, 0.01);
  stem = smin(stem, length(vec2(length(p.xz) - 0.105, p.y + 0.74)) - 0.02, 0.012);
  float base = sdCyl(p, 0.24, FLOOR_Y, -0.875, 0.012);
  base = smin(base, sdCyl(p, 0.185, -0.885, -0.835, 0.012), 0.015);
  return min(smin(body, stem, 0.035), base);
}

float sceneId(vec3 pw, out float id) {
  vec3 p = objectSpace(pw);
  float bound = length(p - vec3(0.0, 0.02, 0.0)) - 1.05;
  id = 4.0;
  gExact = 0.0;
  if (bound > 0.1) return bound;
  float body = bustBody(p);
  float hid = 0.0;
  float head = length(p - vec3(0.0, 0.29, 0.0)) - 0.74;
  if (head < 0.04) {
    head = bustHead(p, hid);
    gExact = 1.0;
  } else if (body < head) {
    gExact = 1.0;
  }
  float d = smin(head, body, 0.05);
  id = head < body ? hid : 4.0;
  return d;
}

float map(vec3 pw) {
  float id;
  return sceneId(pw, id);
}

vec3 calcNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.0015;
  return normalize(k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e) + k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e));
}

float softShadow(vec3 ro, vec3 rd) {
  gDetail = 0.0;
  float res = 1.0;
  float t = 0.02;
  for (int i = 0; i < 30; i++) {
    float h = map(ro + rd * t);
    if (gExact > 0.5) res = min(res, 6.0 * h / max(t, 1e-3));
    t += clamp(h, 0.012, 0.14);
    if (res < 0.004 || t > 2.4) break;
  }
  gDetail = 1.0;
  res = clamp(res, 0.0, 1.0);
  return res * res * (3.0 - 2.0 * res);
}

float calcAO(vec3 p, vec3 n) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 1; i <= 5; i++) {
    float h = 0.012 + 0.05 * float(i);
    occ += (h - map(p + n * h)) * sca;
    sca *= 0.72;
  }
  return clamp(1.0 - 2.4 * occ, 0.0, 1.0);
}

vec2 sphereHit(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float cc = dot(oc, oc) - r * r;
  float h = b * b - cc;
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

void main() {
  vec2 css = uOrigin + gl_FragCoord.xy / vec2(4.0, 6.0) * uCell;
  vec2 q = vec2((css.x - uFrame.x) / uFrame.z, (uFrame.y - css.y) / uFrame.z + WORLD_CY);
  vec3 ro = vec3(0.0, CAM_Y, CAM_D);
  vec3 rd = normalize(vec3(q, 0.0) - ro);
  vec3 L = normalize(uLight);

  float ink = 0.0;
  float depth = 1.0;
  float mask = 0.0;
  bool hit = false;
  vec2 span = sphereHit(ro, rd, vec3(0.0, 0.02, 0.0), 1.08);
  float t = 0.0;
  if (span.y > 0.0) {
    t = max(span.x, 0.0);
    for (int i = 0; i < 110; i++) {
      float d = map(ro + rd * t);
      if (d < 0.0006 * t) { hit = true; break; }
      t += d * 0.82;
      if (t > span.y) break;
    }
  }

  if (hit) {
    vec3 p = ro + rd * t;
    float id;
    sceneId(p, id);
    vec3 n = calcNormal(p);
    float ao = calcAO(p, n);
    float sh = softShadow(p + n * 0.03, L);
    float wrap = 0.32;
    float ndl = dot(n, L);
    float dif = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0);
    float sss = smoothstep(-0.35, 0.25, ndl) * (1.0 - smoothstep(0.25, 0.8, ndl)) * 0.12;
    float sky = 0.5 + 0.5 * n.y;
    float rim = pow(clamp(1.0 + dot(rd, n), 0.0, 1.0), 3.0);
    vec3 po = objectSpace(p);
    float albedo = 0.97;
    if (id < 0.5) albedo = 0.98;
    else if (id < 1.5) albedo = 0.8 - 0.1 * vnoise(po * 30.0);
    else if (id < 2.5) albedo = 0.6 - 0.12 * vnoise(po * 40.0);
    else if (id < 3.5) albedo = 0.3;
    vec3 no = objectSpace(n);
    float fm = frontMask(po) * smoothstep(0.05, 0.55, no.z);
    if (fm > 0.0) {
      float pl = lum(textureLod(uPhoto, photoUv(po), 0.5).rgb);
      pl = smoothstep(0.08, 0.56, pl);
      albedo = mix(albedo, 0.14 + 0.94 * pl, 0.85 * fm);
    }
    float light = 0.8 * dif * mix(0.3, 1.0, sh) + 0.2 * sky * ao + sss * sh + 0.08 * rim * ao;
    float shade = albedo * light * mix(0.6, 1.0, ao);
    ink = clamp(1.0 - shade * 1.04, 0.0, 1.0);
    ink = smoothstep(0.03, 0.97, ink);
    depth = clamp((t - 4.6) / 2.8, 0.0, 1.0);
    mask = 1.0;
  } else if (rd.y < 0.0) {
    float tf = (FLOOR_Y - ro.y) / rd.y;
    vec3 p = ro + rd * tf;
    float r = length(p.xz);
    if (r < 1.5) {
      float sh = softShadow(p + vec3(0.0, 0.01, 0.0), L);
      float contact = 1.0 - smoothstep(0.25, 0.4, r);
      float fade = 1.0 - smoothstep(0.3, 0.68, r);
      ink = clamp((1.0 - sh) * 0.5 * fade + contact * 0.22, 0.0, 1.0);
      mask = 0.5;
      depth = clamp((tf - 4.6) / 2.8, 0.0, 1.0);
    }
  }

  float dq = floor(depth * 255.0) / 255.0;
  outColor = vec4(ink, dq, (depth - dq) * 255.0, mask);
}
`;

export const BUST_MATCH = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uG;
uniform sampler2D uState;
uniform vec4 uGlyph[144];
uniform float uMean[24];
uniform float uDt;
uniform float uInit;
uniform float uFade;
uniform float uContrast;
out vec4 outColor;

ivec2 gSize;

float depthAt(ivec2 c) {
  vec4 g = texelFetch(uG, clamp(c, ivec2(0), gSize - 1), 0);
  return g.g + g.b / 255.0;
}

float inkAt(ivec2 c) {
  vec4 g = texelFetch(uG, c, 0);
  float d = g.g + g.b / 255.0;
  float lap = depthAt(c + ivec2(1, 0)) + depthAt(c - ivec2(1, 0)) + depthAt(c + ivec2(0, 1)) + depthAt(c - ivec2(0, 1)) - 4.0 * d;
  float edge = smoothstep(0.012, 0.045, lap) * step(0.75, g.a);
  return pow(max(g.r, edge * 0.92), 1.32);
}

float dist(int gi, vec4 e[6]) {
  float s = 0.0;
  for (int k = 0; k < 6; k++) {
    vec4 diff = e[k] - uGlyph[gi * 6 + k];
    s += dot(diff, diff);
  }
  return s;
}

void main() {
  gSize = textureSize(uG, 0);
  ivec2 cell = ivec2(gl_FragCoord.xy);
  ivec2 base = cell * ivec2(4, 6);
  vec4 e[6];
  float mx = 0.0;
  float sum = 0.0;
  for (int j = 0; j < 6; j++) {
    vec4 row = vec4(inkAt(base + ivec2(0, j)), inkAt(base + ivec2(1, j)), inkAt(base + ivec2(2, j)), inkAt(base + ivec2(3, j)));
    e[j] = row;
    mx = max(mx, max(max(row.x, row.y), max(row.z, row.w)));
    sum += row.x + row.y + row.z + row.w;
  }
  float mean = sum / 24.0;
  float around = 0.0;
  for (int k = 0; k < 8; k++) {
    float ang = float(k) * 0.7853982;
    ivec2 off = ivec2(round(vec2(cos(ang), sin(ang)) * vec2(12.0, 14.0)));
    around += texelFetch(uG, clamp(base + ivec2(2, 3) + off, ivec2(0), gSize - 1), 0).r;
  }
  around /= 8.0;
  float lift = (mean - around) * uContrast;
  for (int j = 0; j < 6; j++) e[j] = clamp(e[j] + lift * (0.4 + 0.6 * step(0.02, e[j])), 0.0, 1.2);
  mx = 0.0;
  sum = 0.0;
  for (int j = 0; j < 6; j++) {
    mx = max(mx, max(max(e[j].x, e[j].y), max(e[j].z, e[j].w)));
    sum += e[j].x + e[j].y + e[j].z + e[j].w;
  }
  mean = sum / 24.0;
  if (mx > 0.001) {
    for (int j = 0; j < 6; j++) {
      vec4 shaped = pow(clamp(e[j] / mx, 1e-4, 1.0), vec4(1.7)) * mx;
      e[j] = mix(e[j], shaped, 0.65);
    }
  }

  vec4 st = texelFetch(uState, cell, 0);
  int cur = int(st.r * 255.0 + 0.5);
  int prev = int(st.g * 255.0 + 0.5);
  float t = st.b;
  float w = st.a;

  int best = 0;
  float bestD = 1e9;
  float curD = 1e9;
  for (int g = 0; g < 24; g++) {
    float tone = mean - uMean[g];
    float dg = dist(g, e) + tone * tone * 9.0;
    if (dg < bestD) { bestD = dg; best = g; }
    if (g == cur) curD = dg;
  }

  float target = clamp(0.5 + (mean - uMean[best]) * 2.6, 0.0, 1.0);
  if (uInit > 0.5) {
    cur = best;
    prev = best;
    t = 1.0;
    w = target;
  } else {
    if (best != cur && bestD < curD * 0.86 - 0.004) {
      if (best == prev && t < 1.0) {
        prev = cur;
        cur = best;
        t = 1.0 - t;
      } else {
        prev = cur;
        cur = best;
        t = 0.0;
      }
    }
    t = min(1.0, t + uDt * uFade);
    w = mix(w, target, 1.0 - exp(-uDt * 9.0));
  }
  outColor = vec4(float(cur) / 255.0, float(prev) / 255.0, t, w);
}
`;

export const BUST_FINAL = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uState;
uniform sampler2D uAtlas;
uniform vec2 uRes;
uniform float uDpr;
uniform vec2 uOrigin;
uniform vec2 uCell;
uniform vec4 uTile;
uniform vec2 uAtlasSize;
uniform vec3 uPaper;
uniform vec3 uInk;
out vec4 outColor;

float hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}

float glyph(int idx, float row, vec2 local, vec2 gx, vec2 gy) {
  if (idx <= 0) return 0.0;
  vec2 lc = clamp(local, vec2(-0.12), vec2(1.12));
  vec2 px = vec2(float(idx) * uTile.x, row * uTile.y) + vec2(uTile.z, uTile.w) + lc * vec2(uTile.x - 2.0 * uTile.z, uTile.y - 2.0 * uTile.w);
  return textureGrad(uAtlas, px / uAtlasSize, gx, gy).a;
}

float weighted(int idx, float w, vec2 local, vec2 gx, vec2 gy) {
  float r = clamp(w, 0.0, 1.0) * 2.0;
  float r0 = min(floor(r), 1.0);
  float f = r - r0;
  return mix(glyph(idx, r0, local, gx, gy), glyph(idx, r0 + 1.0, local, gx, gy), f);
}

void main() {
  vec2 css = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float mottle = noise2(css * 0.012) * 0.6 + noise2(css * 0.05) * 0.4;
  float fibre = noise2(css * vec2(0.9, 0.22) + 7.0) * 0.5 + noise2(css * vec2(0.25, 1.1) + 3.0) * 0.5;
  float grain = hash2(floor(gl_FragCoord.xy));
  vec3 paper = uPaper * (0.985 + 0.02 * mottle) - 0.012 * smoothstep(0.62, 0.95, fibre) + (grain - 0.5) * 0.012;

  vec2 g = (css - uOrigin) / uCell;
  ivec2 cell = ivec2(floor(g));
  ivec2 grid = textureSize(uState, 0);
  float a = 0.0;
  if (cell.x >= 0 && cell.y >= 0 && cell.x < grid.x && cell.y < grid.y) {
    vec4 st = texelFetch(uState, cell, 0);
    int cur = int(st.r * 255.0 + 0.5);
    int prev = int(st.g * 255.0 + 0.5);
    float t = smoothstep(0.0, 1.0, st.b);
    vec2 cf = vec2(cell);
    vec2 jitter = (vec2(hash2(cf + 0.37), hash2(cf + 17.1)) - 0.5) * vec2(0.07, 0.06);
    vec2 local = fract(g) - jitter;
    vec2 inner = vec2(uTile.x - 2.0 * uTile.z, uTile.y - 2.0 * uTile.w);
    float devW = max(uCell.x * uDpr, 1.0);
    float devH = max(uCell.y * uDpr, 1.0);
    vec2 gx = vec2(inner.x / devW / uAtlasSize.x, 0.0);
    vec2 gy = vec2(0.0, inner.y / devH / uAtlasSize.y);
    float ac = weighted(cur, st.a, local, gx, gy);
    float ap = cur == prev ? ac : weighted(prev, st.a, local, gx, gy);
    a = mix(ap, ac, t);
    float ribbon = 0.9 + 0.1 * noise2(vec2(cf.x * 0.07, cf.y * 0.9) + 4.0);
    float strike = 0.95 + 0.05 * hash2(cf + 5.3);
    a *= ribbon * strike;
  }
  float tooth = (grain - 0.5) * 0.22 + (fibre - 0.5) * 0.12;
  a = clamp(a * (1.0 + tooth), 0.0, 1.0);
  vec3 col = mix(paper, uInk, a);
  outColor = vec4(col, 1.0);
}
`;
