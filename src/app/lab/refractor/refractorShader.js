export const FULL_VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const CARD_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uBack;
uniform vec2 uRes;
uniform float uDpr;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform mat3 uRot;
uniform float uLift;
uniform float uDist;
uniform float uGround;
uniform float uThick;
uniform vec3 uKey;
uniform vec3 uFill;
uniform vec3 uFoil;
uniform float uData;
uniform float uReady;
uniform float uSeed;
uniform vec3 uGroundTint;

out vec4 outColor;

const float PI = 3.14159265;
const float HOLE = 0.125;
const float HUB = 0.31;
const float METAL_IN = 0.335;
const float DATA_IN = 0.385;
const float METAL_OUT = 0.978;

float hash21(vec2 p) {
  p = fract(p * vec2(127.317, 311.703));
  p += dot(p, p + 47.113);
  return fract(p.x * p.y);
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

float safeDiv(float a, float b) {
  return a / (abs(b) < 1e-5 ? (b < 0.0 ? -1e-5 : 1e-5) : b);
}

float bump(float x, float c, float w) {
  float t = (x - c) / w;
  float v = max(1.0 - t * t, 0.0);
  return v * v;
}

vec3 spectral(float nm) {
  float x = (nm - 380.0) / 330.0;
  return vec3(bump(x, 0.8, 0.27) + 0.22 * bump(x, 0.06, 0.12), bump(x, 0.5, 0.25), bump(x, 0.18, 0.22));
}

vec3 grating(vec2 s, vec2 k, float d, float spread) {
  float u = abs(dot(s, k));
  float w = dot(s, vec2(-k.y, k.x));
  float lobe = exp(-min(w * w * spread, 40.0));
  vec3 c = spectral(d * u) + 0.75 * spectral(d * u * 0.5) + 0.5 * spectral(d * u / 3.0);
  return c * lobe;
}

vec3 envAt(vec3 r, vec3 keyDir, vec3 fillDir) {
  vec3 col = mix(vec3(0.16, 0.165, 0.175), vec3(0.62, 0.625, 0.635), smoothstep(-0.7, 0.85, r.y));
  col *= 0.92 + 0.08 * smoothstep(-1.0, 1.0, r.x);
  float k = dot(r, keyDir);
  col += vec3(1.6, 1.58, 1.54) * smoothstep(0.9975, 0.9995, k);
  col += vec3(0.22) * smoothstep(0.9, 0.997, k);
  float f = dot(r, fillDir);
  col += vec3(1.1, 1.12, 1.15) * smoothstep(0.998, 0.9996, f) + vec3(0.12) * smoothstep(0.93, 0.998, f);
  float az = atan(r.x, r.z);
  float tall = smoothstep(0.9, 0.25, abs(r.y));
  float stripL = smoothstep(0.17, 0.05, abs(az + 0.9));
  float stripR = smoothstep(0.13, 0.04, abs(az - 0.82));
  col += vec3(1.25, 1.24, 1.2) * stripL * tall + vec3(0.8, 0.82, 0.86) * stripR * tall;
  return col;
}

vec3 discTint(float kind) {
  if (kind < 0.5) return vec3(0.93, 0.935, 0.95);
  if (kind < 1.5) return vec3(1.0, 0.8, 0.46);
  return vec3(0.07, 0.07, 0.08);
}

float rainbowGain(float kind) {
  if (kind < 1.5) return 1.0;
  return 0.75;
}

vec3 dataSide(float kind, vec2 q, float r, float aa, vec3 V, vec3 Lk, vec3 Lf, vec3 T, vec3 B, vec3 N) {
  vec3 tint = discTint(kind);
  vec2 k = q / max(r, 1e-4);
  float wob = (vnoise(vec2(r * 40.0, 3.0) + uSeed) - 0.5) * 0.004;
  vec3 Nw = normalize(N + (T * k.x + B * k.y) * wob);
  vec3 R = reflect(-V, Nw);
  vec3 mirror = envAt(R, Lk, Lf);
  vec3 hk = Lk + V;
  vec3 hf = Lf + V;
  vec2 sk = vec2(dot(hk, T), dot(hk, B));
  vec2 sf = vec2(dot(hf, T), dot(hf, B));
  float inData = smoothstep(DATA_IN, DATA_IN + 0.004, r);
  float lead = DATA_IN + (METAL_OUT - 0.02 - DATA_IN) * uData;
  float recorded = 1.0 - smoothstep(lead - 0.003, lead + 0.003, r);
  float tracks = inData * mix(0.72, 1.0, recorded);
  vec3 rainbow = (grating(sk, k, 1600.0, 320.0) * 2.1 + grating(sk, k, 1600.0, 36.0) * 0.32 + grating(sf, k, 1600.0, 120.0) * 0.7 + grating(sf, k, 1600.0, 10.0) * 0.1) * tracks;
  float sessions = smoothstep(0.0, 0.002, abs(r - lead)) * 0.06 + 0.94;
  float tex = 1.0 + 0.025 * (vnoise(vec2(r * 220.0, 0.5)) - 0.5) * smoothstep(0.6, 0.2, aa * 220.0);
  vec3 base = tint * (mirror * 0.82 + 0.12);
  if (kind > 1.5) base = tint + mirror * 0.07;
  vec3 col = base * tex * sessions + mix(tint, vec3(1.0), 0.55) * rainbow * rainbowGain(kind);
  float band = smoothstep(METAL_IN, METAL_IN + 0.003, r) * (1.0 - smoothstep(DATA_IN - 0.006, DATA_IN, r));
  float matrix = band * step(0.6, hash21(vec2(floor(atan(q.y, q.x) * 160.0), 2.0))) * smoothstep(0.355, 0.357, r) * (1.0 - smoothstep(0.363, 0.365, r));
  col *= 1.0 - matrix * 0.35;
  return col;
}

vec3 clearPoly(vec3 behind, float r, vec3 V, vec3 Nv, vec3 Lk, vec3 Lf, vec2 q) {
  float ring = smoothstep(0.272, 0.28, r) * (1.0 - smoothstep(0.292, 0.3, r));
  float slope = (smoothstep(0.272, 0.286, r) - smoothstep(0.286, 0.3, r));
  vec2 k = q / max(r, 1e-4);
  vec3 n = normalize(Nv + vec3(k * slope * 0.6, 0.0));
  vec3 R = reflect(-V, n);
  float fres = 0.04 + 0.96 * pow(clamp(1.0 - abs(dot(n, V)), 0.0, 1.0), 5.0);
  vec3 refl = envAt(R, Lk, Lf);
  vec3 col = behind * vec3(0.9, 0.915, 0.93) + refl * (0.07 + fres * 0.5);
  col += vec3(1.0) * smoothstep(0.93, 0.99, dot(R, Lk)) * (0.25 + ring * 0.6);
  col *= 1.0 - ring * 0.05;
  float edgeIn = 1.0 - smoothstep(HOLE, HOLE + 0.012, r);
  col = mix(col, col * 0.86 + 0.08, edgeIn);
  return col;
}

float discShadow(vec3 pg, vec3 n, vec3 c, vec3 l, float R, float spread, float base) {
  float denom = dot(n, l);
  float s = safeDiv(dot(n, c - pg), denom);
  vec3 hit = pg + l * s;
  vec3 local = transpose(uRot) * (hit - c);
  float rr = length(local.xy);
  float pw = base + max(s, 0.0) * spread;
  float outer = 1.0 - smoothstep(-pw, pw, rr - R);
  float hub = 0.35 + 0.65 * smoothstep(-pw, pw, rr - R * HUB);
  float hole = smoothstep(-pw, pw, rr - R * HOLE);
  return outer * hub * mix(1.0, hole, 0.8);
}

void main() {
  vec2 css = gl_FragCoord.xy / uDpr;
  css.y = uRes.y / uDpr - css.y;
  vec3 eye = vec3(0.0, 0.0, uDist);
  vec3 dir = normalize(vec3(css.x - uCenter.x, uCenter.y - css.y, 0.0) - eye);
  mat3 inv = transpose(uRot);
  vec3 T = uRot * vec3(1.0, 0.0, 0.0);
  vec3 B = uRot * vec3(0.0, 1.0, 0.0);
  vec3 N = uRot * vec3(0.0, 0.0, 1.0);
  vec3 c = vec3(0.0, 0.0, uLift);
  bool front = dot(N, dir) < 0.0;
  vec3 cf = c + N * (uThick * 0.5);
  vec3 cb = c - N * (uThick * 0.5);
  float tf = safeDiv(dot(N, cf - eye), dot(N, dir));
  float tb = safeDiv(dot(N, cb - eye), dot(N, dir));
  vec3 pf = eye + dir * tf;
  vec3 pb = eye + dir * tb;
  vec2 lf = (inv * (pf - cf)).xy;
  vec2 lb = (inv * (pb - cb)).xy;
  vec2 ln = front ? lf : lb;
  vec2 lfar = front ? lb : lf;
  vec3 pv = front ? pf : pb;
  float pxN = max(length(fwidth(ln)), 1e-3);
  float pxF = max(length(fwidth(lfar)), 1e-3);
  float R = uHalf.y;

  float rn = length(ln);
  float rf = length(lfar);
  float covN = clamp(0.5 - (rn - R) / pxN, 0.0, 1.0) * clamp(0.5 - (R * HOLE - rn) / pxN, 0.0, 1.0);
  float covF = clamp(0.5 - (rf - R) / pxF, 0.0, 1.0) * clamp(0.5 - (R * HOLE - rf) / pxF, 0.0, 1.0);
  float nearOk = step(pxN, R * 3.0);
  float farOk = step(pxF, R * 3.0);
  covN *= nearOk;
  covF *= farOk;

  vec2 q = ln / max(R, 1.0);
  float r = length(q);
  float aa = max(length(fwidth(q)), 1e-4);

  vec3 V = normalize(eye - pv);
  vec3 Lk = normalize(uKey - pv);
  vec3 Lf = normalize(uFill - pv);

  vec2 groundUv = css / max(uRes / uDpr, vec2(1.0));
  vec2 lamp = (groundUv - vec2(0.3, 0.16)) * vec2(1.0, 1.3);
  vec3 col = uGroundTint * (0.885 + 0.125 * exp(-min(dot(lamp, lamp) * 1.5, 30.0)));
  col *= 1.0 + (vnoise(css * 0.9) * 0.6 + vnoise(css * 2.3) * 0.4 - 0.5) * 0.022;
  float tg = safeDiv(-uGround - eye.z, dir.z);
  vec3 pg = eye + dir * tg;
  vec3 sun = normalize(uKey);
  float contact = discShadow(pg, N, c, sun, R, 0.1, 3.0);
  float soft = discShadow(pg + vec3(-4.0, 6.0, 0.0), N, c, normalize(vec3(-0.05, 0.2, 1.0)), R * 1.02, 0.85, 22.0);
  col *= 1.0 - (0.14 * contact + 0.16 * soft) * uReady;
  vec3 ground = col;

  if (uReady > 0.0 && covF > 0.0) {
    vec2 rad = lfar / max(rf, 1e-3);
    vec3 nEdge = uRot * normalize(vec3(rad, 0.0));
    float lit = max(dot(nEdge, Lk), 0.0);
    vec3 edgeCol = mix(ground * 0.8, vec3(0.86, 0.86, 0.85), 0.55) * (0.6 + 0.4 * lit);
    col = mix(col, edgeCol, covF * (1.0 - covN));
  }

  if (uReady > 0.0 && covN > 0.0) {
    vec3 Nv = front ? N : -N;
    float metal = smoothstep(METAL_IN - aa, METAL_IN, r) * (1.0 - smoothstep(METAL_OUT, METAL_OUT + aa, r));
    vec3 face;
    vec3 poly = clearPoly(ground, r, V, Nv, Lk, Lf, q);
    if (front) {
      vec3 data = dataSide(uFoil.x, q, r, aa, V, Lk, Lf, T, B, N);
      if (uFoil.z > 0.001) data = mix(data, dataSide(uFoil.y, q, r, aa, V, Lk, Lf, T, B, N), uFoil.z);
      face = mix(poly, data, metal);
    } else {
      vec2 uv = vec2(0.5 - q.x * 0.5, 0.5 - q.y * 0.5);
      vec2 gx = dFdx(uv);
      vec2 gy = dFdy(uv);
      vec4 label = textureGrad(uBack, uv, gx, gy);
      float lam = max(dot(Nv, Lk), 0.0);
      vec3 Rl = reflect(-V, Nv);
      vec3 silver = discTint(uFoil.x) * (envAt(Rl, Lk, Lf) * 0.55 + 0.25);
      vec3 printed = label.rgb * (0.8 + 0.26 * lam);
      printed *= 1.0 + (hash21(floor(uv * 900.0)) - 0.5) * 0.03;
      vec3 top = mix(silver, printed, label.a);
      top += vec3(1.0, 0.99, 0.97) * smoothstep(0.97, 0.996, dot(Rl, Lk)) * 0.08;
      face = mix(poly, top, metal);
    }
    float fres = 0.03 + 0.5 * pow(clamp(1.0 - dot(Nv, V), 0.0, 1.0), 5.0);
    face += vec3(1.0, 0.99, 0.97) * fres * 0.08 * metal;
    float rim = 1.0 - smoothstep(0.0, 1.6, R - rn);
    face = mix(face, face * 0.82 + 0.1, rim);
    col = mix(col, face, covN);
  }

  float grain = (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(col + grain, 1.0);
}
`;
