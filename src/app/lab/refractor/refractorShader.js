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

vec3 gKu;
vec3 gKv;
vec3 gFu;
vec3 gFv;

void lightBasis(vec3 d, out vec3 u, out vec3 v) {
  u = normalize(cross(vec3(0.0, 1.0, 0.0), d));
  v = cross(d, u);
}

float softbox(vec3 r, vec3 d, vec3 u, vec3 v, vec2 size, float soft) {
  float c = dot(r, d);
  if (c <= 0.05) return 0.0;
  vec2 p = vec2(dot(r, u), dot(r, v)) / c;
  vec2 e = abs(p) - size;
  float box = (1.0 - smoothstep(-soft, soft, e.x)) * (1.0 - smoothstep(-soft, soft, e.y));
  vec2 f = p / size;
  return box * (0.75 + 0.35 * exp(-dot(f, f) * 1.2));
}

vec3 envRoom(vec3 r) {
  float y = r.y - 0.12 * r.x;
  vec3 col = mix(vec3(0.42, 0.41, 0.405), vec3(1.0, 1.02, 1.06), smoothstep(-0.6, 0.12, y));
  col *= 0.9 + 0.1 * smoothstep(-0.6, 0.6, r.x);
  col += vec3(0.22, 0.22, 0.23) * exp(-pow((y + 0.02) / 0.2, 2.0));
  vec3 flagD = normalize(vec3(0.0, 0.08, 1.0));
  col *= 1.0 - 0.15 * smoothstep(0.985, 0.997, dot(r, flagD));
  col = mix(col, vec3(0.62, 0.61, 0.59), smoothstep(-0.35, -0.7, r.y) * 0.5);
  return col;
}

vec3 envLights(vec3 r, vec3 keyDir, vec3 fillDir) {
  return vec3(4.0, 3.93, 3.8) * softbox(r, keyDir, gKu, gKv, vec2(0.2, 0.13), 0.09)
    + vec3(0.9, 0.93, 0.98) * softbox(r, fillDir, gFu, gFv, vec2(0.04, 0.5), 0.05);
}

vec3 envAt(vec3 r, vec3 keyDir, vec3 fillDir) {
  return envRoom(r) + envLights(r, keyDir, fillDir);
}

vec3 envLabel(vec3 r, vec3 keyDir, vec3 fillDir) {
  vec3 col = mix(vec3(0.46, 0.465, 0.475), vec3(0.92, 0.925, 0.935), smoothstep(-0.45, 0.5, r.y));
  col *= 0.85 + 0.15 * smoothstep(-0.8, 0.8, r.x);
  vec3 flagD = normalize(vec3(0.08, -0.12, 1.0));
  col *= 1.0 - 0.2 * smoothstep(0.975, 0.995, dot(r, flagD));
  col = mix(col, vec3(0.52, 0.51, 0.49), smoothstep(-0.4, -0.8, r.y) * 0.6);
  col += vec3(6.4, 6.3, 6.05) * softbox(r, keyDir, gKu, gKv, vec2(0.12, 0.09), 0.035);
  col += vec3(1.1, 1.14, 1.2) * softbox(r, fillDir, gFu, gFv, vec2(0.03, 0.5), 0.03);
  return col;
}

vec3 diffracted(vec3 R, vec3 N, vec3 kW, vec3 Lk, vec3 Lf) {
  vec3 rt = R - N * dot(R, N);
  vec3 acc = vec3(0.0);
  vec3 wsum = vec3(0.0);
  for (int i = 0; i < 12; i += 1) {
    float nm = 402.0 + float(i) * 26.0;
    vec3 w = spectral(nm);
    wsum += w;
    for (int m = -2; m <= 2; m += 1) {
      if (m == 0) continue;
      vec3 t = rt + kW * (float(m) * nm / 1600.0);
      float t2 = dot(t, t);
      if (t2 >= 0.99) continue;
      vec3 Rd = t + N * sqrt(1.0 - t2);
      acc += w * (envLights(Rd, Lk, Lf) + envRoom(Rd) * 0.05) * (abs(m) == 1 ? 1.0 : 0.25);
    }
  }
  return acc / max(wsum, vec3(1e-3));
}

vec3 discTint(float kind) {
  if (kind < 0.5) return vec3(0.9, 0.905, 0.92);
  if (kind < 1.5) return vec3(0.98, 0.84, 0.56);
  return vec3(0.05, 0.05, 0.055);
}

vec3 diffTint(float kind) {
  if (kind < 0.5) return vec3(1.0);
  if (kind < 1.5) return vec3(0.98, 0.84, 0.56);
  return vec3(0.2, 0.2, 0.21);
}

float scuffs(vec2 q, float aa, vec2 hT) {
  float acc = 0.0;
  for (int i = 0; i < 14; i += 1) {
    float fi = float(i) + uSeed * 0.013;
    float rr = mix(0.4, 0.95, hash21(vec2(fi, 1.3)));
    float aI = hash21(vec2(fi, 2.7)) * 6.2832;
    vec2 cI = vec2(cos(aI), sin(aI)) * rr;
    float dA = hash21(vec2(fi, 4.1)) * 3.1416;
    vec2 dI = vec2(cos(dA), sin(dA));
    float len = mix(0.03, 0.14, hash21(vec2(fi, 5.9)));
    vec2 rel = q - cI;
    float along = clamp(dot(rel, dI), -len, len);
    float dist = length(rel - dI * along);
    float line = (1.0 - smoothstep(aa * 0.15, aa * 0.8, dist)) * 0.7;
    float taper = 1.0 - smoothstep(len * 0.6, len, abs(dot(rel, dI)));
    float glint = 0.03 + 0.97 * (1.0 - smoothstep(0.0, 0.3, abs(dot(dI, hT))));
    acc += line * taper * glint * mix(0.4, 1.0, hash21(vec2(fi, 7.7)));
  }
  float wipe = vnoise(vec2(length(q) * 2600.0, atan(q.y, q.x) * 1.5 + uSeed));
  acc += smoothstep(0.82, 0.97, wipe) * 0.25 * smoothstep(0.6, 0.15, aa * 2600.0);
  return min(acc, 1.0);
}

float grime(vec2 q, float aa) {
  float acc = 0.0;
  for (int i = 0; i < 2; i += 1) {
    float fi = float(i) * 3.7 + uSeed * 0.021;
    float ang = hash21(vec2(fi, 8.3)) * 6.2832;
    vec2 c = vec2(cos(ang), sin(ang)) * mix(0.5, 0.82, hash21(vec2(fi, 9.1)));
    float rot = hash21(vec2(fi, 10.7)) * 3.1416;
    vec2 d = q - c;
    d = vec2(d.x * cos(rot) - d.y * sin(rot), d.x * sin(rot) + d.y * cos(rot)) / vec2(0.095, 0.17);
    float e = length(d);
    float warp = vnoise(q * 70.0 + fi) * 3.0;
    float ridge = 0.5 + 0.5 * sin(e * 60.0 + warp);
    float fineOk = smoothstep(0.012, 0.004, aa);
    float mask = (1.0 - smoothstep(0.35, 1.0, e)) * (0.6 + 0.4 * vnoise(q * 22.0 + fi * 5.0)) * 0.5;
    acc += mask * mix(0.55, 0.25 + 0.75 * ridge, fineOk);
  }
  vec2 g = q * 160.0 + uSeed;
  vec2 cell = floor(g);
  float pick = step(0.976, hash21(cell));
  float dotD = length(fract(g) - vec2(hash21(cell + 3.1), hash21(cell + 5.3)) * 0.6 - 0.2);
  acc += pick * (1.0 - smoothstep(0.04, 0.1, dotD)) * 1.6;
  return min(acc, 1.6);
}

vec3 dataSide(float kind, vec2 q, float r, float aa, vec3 V, vec3 Lk, vec3 Lf, vec3 T, vec3 B, vec3 N) {
  vec3 tint = discTint(kind);
  vec2 k = q / max(r, 1e-4);
  vec3 kW = T * k.x + B * k.y;
  float wob = (vnoise(vec2(r * 40.0, 3.0) + uSeed) - 0.5) * 0.003;
  vec3 Nw = normalize(N + kW * wob);
  vec3 R = reflect(-V, Nw);
  vec3 mirror = envAt(R, Lk, Lf);
  float inData = smoothstep(DATA_IN - aa * 0.5, DATA_IN + max(0.003, aa), r);
  float lead = DATA_IN + (METAL_OUT - 0.02 - DATA_IN) * uData;
  float lw = max(0.0015, aa * 0.75);
  float recorded = 1.0 - smoothstep(lead - lw, lead + lw, r);
  float tracks = inData * recorded;
  vec3 orders = tracks > 0.0 ? diffracted(R, Nw, kW, Lk, Lf) : vec3(0.0);
  float leadRing = 1.0 - (1.0 - smoothstep(0.0, max(0.0025, aa), abs(r - lead))) * 0.04 * inData;
  vec3 col = tint * mirror * mix(0.95, 0.84, tracks) + orders * diffTint(kind) * tracks * 0.46;
  col *= leadRing;
  float band = smoothstep(METAL_IN, METAL_IN + 0.003, r) * (1.0 - smoothstep(DATA_IN - 0.006, DATA_IN, r));
  float ang = atan(q.y, q.x);
  float matrix = band * step(0.55, hash21(vec2(floor(ang * 220.0), 2.0))) * step(0.3, fract(ang * 1.2)) * smoothstep(0.355, 0.357, r) * (1.0 - smoothstep(0.362, 0.364, r));
  col = mix(col, col * 0.55 + mirror * 0.05, matrix);
  vec3 H = normalize(Lk + V);
  vec2 hT = normalize(vec2(dot(H, T), dot(H, B)) + 1e-4);
  float sc = scuffs(q, aa, hT);
  float keyFacing = 0.35 + 0.65 * smoothstep(0.6, 0.98, dot(N, H));
  col += vec3(0.2, 0.2, 0.21) * sc * keyFacing;
  float haze = grime(q, aa);
  float scatter = 0.5 + 0.7 * keyFacing;
  col = col * (1.0 - 0.16 * haze) + vec3(0.9, 0.9, 0.92) * haze * 0.2 * scatter;
  col = col * 0.93 + vec3(0.05, 0.05, 0.055);
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
  vec3 col = behind * vec3(0.85, 0.862, 0.875) + vec3(0.075, 0.077, 0.08) + refl * (0.05 + fres * 0.45);
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

  vec3 V = normalize(vec3(0.0, R * 0.25, uLift + R * 3.2) - pv);
  vec3 Lk = normalize(uKey - pv);
  vec3 Lf = normalize(uFill - pv);
  lightBasis(Lk, gKu, gKv);
  lightBasis(Lf, gFu, gFv);

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
      float fresF = 0.04 + 0.96 * pow(clamp(1.0 - dot(Nv, V), 0.0, 1.0), 5.0);
      data += envAt(reflect(-V, Nv), Lk, Lf) * fresF * 0.6;
      float peak = max(max(data.r, data.g), data.b);
      data *= (1.0 - exp(-peak * 1.85)) / max(peak, 1e-4);
      face = mix(poly, data, metal);
    } else {
      vec2 uv = vec2(0.5 - q.x * 0.5, 0.5 - q.y * 0.5);
      vec2 gx = dFdx(uv);
      vec2 gy = dFdy(uv);
      vec4 label = textureGrad(uBack, uv, gx, gy);
      float lam = max(dot(Nv, Lk), 0.0);
      vec3 Rl = reflect(-V, Nv);
      vec3 silver = discTint(uFoil.x) * (envLabel(Rl, Lk, Lf) * 0.55 + 0.25);
      vec3 printed = label.rgb * (0.8 + 0.26 * lam);
      printed *= 1.0 + (hash21(floor(uv * 900.0)) - 0.5) * 0.03;
      vec3 top = mix(silver, printed, label.a);
      top += vec3(1.0, 0.99, 0.97) * smoothstep(0.97, 0.996, dot(Rl, Lk)) * 0.08;
      face = mix(poly, top, metal);
    }
    if (!front) {
      float fres = 0.04 + 0.96 * pow(clamp(1.0 - dot(Nv, V), 0.0, 1.0), 5.0);
      face += envLabel(reflect(-V, Nv), Lk, Lf) * fres * 0.6 * metal;
      face = 1.0 - exp(-face * 1.6);
    }
    vec3 radW = uRot * vec3(ln / max(rn, 1e-3), 0.0);
    float edgeLit = max(dot(radW, Lk), 0.0) + 0.4 * max(dot(radW, Lf), 0.0);
    float rim = 1.0 - smoothstep(0.0, 1.1, R - rn);
    face = mix(face, vec3(0.98, 0.98, 0.97), rim * clamp(0.3 + 0.8 * edgeLit, 0.0, 0.95));
    col = mix(col, face, covN);
  }

  float grain = (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(col + grain, 1.0);
}
`;
