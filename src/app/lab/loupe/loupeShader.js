export const LOUPE_VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const LOUPE_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform vec2 uRes;
uniform vec2 uBox;
uniform float uDpr;
uniform float uTableMm;
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform vec4 uCardA;
uniform vec4 uCardB;
uniform vec4 uPoseA;
uniform vec4 uPoseB;
uniform vec4 uWearA;
uniform vec4 uWearB;
uniform vec4 uLens;
uniform float uLift;
uniform float uShowB;
uniform float uLensOn;
uniform vec4 uSun;

out vec4 outColor;

const float CELL = 0.13;
const vec3 PAPER = vec3(0.968, 0.952, 0.912);
const vec3 INK_C = vec3(0.16, 0.6, 0.8);
const vec3 INK_M = vec3(0.86, 0.2, 0.5);
const vec3 INK_Y = vec3(0.99, 0.88, 0.12);
const vec3 INK_K = vec3(0.11, 0.105, 0.115);

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

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.3;
    a *= 0.5;
  }
  return s / 0.9375;
}

vec2 rot(vec2 p, float a) {
  float s = sin(a);
  float c = cos(a);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

float boxSdf(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float fibres(vec2 mm) {
  vec2 warp = vec2(vnoise(mm * 3.0), vnoise(mm * 3.0 + 7.3)) * 2.2;
  float n1 = vnoise(mm * 16.0 + warp * 3.0);
  float n2 = vnoise(mm * 9.0 - warp * 2.0 + 4.1);
  float r1 = pow(1.0 - abs(2.0 * n1 - 1.0), 12.0);
  float r2 = pow(1.0 - abs(2.0 * n2 - 1.0), 16.0);
  return r1 * 0.6 + r2 * 0.5;
}

float fineFibres(vec2 mm) {
  float s = 0.0;
  for (int i = 0; i < 2; i++) {
    vec2 cell = floor(mm * 6.0 + float(i) * 0.5);
    float a = hash21(cell + float(i) * 7.0) * 3.14159;
    vec2 q = rot(mm * 6.0 + float(i) * 0.5 - cell - 0.5, a);
    float len = 0.25 + 0.2 * hash21(cell + 3.1);
    float line = (1.0 - smoothstep(0.0, 0.05, abs(q.y + (hash21(cell + 9.7) - 0.5) * 0.4))) * (1.0 - smoothstep(len - 0.1, len, abs(q.x)));
    s += line * (0.5 + 0.5 * hash21(cell + 5.3));
  }
  return s * 0.6;
}

vec3 table(vec2 p, float foot, float inLens) {
  vec2 uv = p / uBox;
  vec2 sunUv = vec2(0.5) - uSun.xy * 0.42;
  vec2 lamp = (uv - sunUv) * vec2(1.0, 1.3);
  float pool = exp(-dot(lamp, lamp) * 3.2);
  vec3 col = vec3(0.012, 0.012, 0.013) + vec3(0.034, 0.026, 0.018) * pool;
  vec2 mm = p * uTableMm;
  float vis = smoothstep(1.5, 5.0, 0.3 / (uTableMm * foot)) * inLens;
  if (vis > 0.001) {
    float tooth = fbm(mm * 5.0);
    col *= 1.0 + (tooth - 0.5) * 0.3 * vis;
    float speck = smoothstep(0.82, 0.9, vnoise(mm * 3.1 + 2.0));
    col += vec3(0.04, 0.036, 0.032) * speck * vis;
  }
  return col;
}

vec3 sunlight(vec3 col, vec2 p, float outside) {
  if (uLensOn < 0.5) return col;
  float radius = uLens.z;
  vec2 dir = uSun.xy;
  vec2 ax = vec2(-dir.y, dir.x);
  float reachD = radius * (1.32 + uLift * 0.45);
  vec2 c = uLens.xy + dir * reachD;
  float q = length(p - c) / radius;
  float disc = 1.0 - smoothstep(0.7, 1.12, q);
  col *= 1.0 - disc * 0.14;
  float sigma = mix(0.15, 0.045, uSun.z) * (1.0 + uLift * 0.5);
  float peak = min(5.0, 0.7 * pow(0.15 / sigma, 1.2));
  float core = exp(-q * q / (2.0 * sigma * sigma));
  float ringR = sigma * 2.1;
  vec3 fringe = vec3(
    exp(-pow((q - ringR * 1.07) / (sigma * 0.4), 2.0)),
    exp(-pow((q - ringR) / (sigma * 0.4), 2.0)),
    exp(-pow((q - ringR * 0.93) / (sigma * 0.4), 2.0))
  ) * 0.3;
  vec3 warm = vec3(1.0, 0.84, 0.6);
  float bloom = exp(-q * q / (2.0 * sigma * sigma * 10.0));
  vec3 light = warm * (core * peak * 1.3 + bloom * peak * 0.16) + fringe * peak * 0.6;
  vec2 rel = p - uLens.xy;
  float along = dot(rel, dir) / reachD;
  float across = dot(rel, ax);
  float half0 = radius * 0.9;
  float half1 = radius * sigma;
  float halfW = mix(half0, half1, clamp(along, 0.0, 1.0));
  float cone = smoothstep(0.0, 0.35, along) * (1.0 - smoothstep(0.92, 1.04, along)) * exp(-pow(across / max(halfW, 1.0), 2.0) * 2.4);
  float spokes = 0.55 + 0.45 * vnoise(vec2(across / max(halfW, 1.0) * 5.0, 0.5) + 3.1);
  vec3 rays = warm * cone * spokes * (0.1 + 0.14 * uSun.z) * outside;
  return col * (1.0 + light * 1.6) + light * 0.62 + rays;
}

vec4 cmyk(vec3 c) {
  float k = 1.0 - max(max(c.r, c.g), c.b);
  vec3 cmy = clamp(1.0 - c / max(1.0 - k, 0.02), 0.0, 1.0) * (1.0 - 0.45 * k);
  float total = cmy.x + cmy.y + cmy.z + k;
  cmy *= min(1.0, max(2.6 - k, 0.0) / max(total - k, 1e-3));
  return vec4(cmy, k);
}

float screenPlate(vec2 mm, float ang, float cover, float aa, float rough) {
  vec2 f = fract(rot(mm, ang) / CELL) - 0.5;
  float t = 0.5 - 0.25 * (cos(6.2831853 * f.x) + cos(6.2831853 * f.y));
  return smoothstep(cover + aa, cover - aa, t + rough);
}

float gain(float c, float n) {
  return clamp(c + 0.24 * c * (1.0 - c) * (0.5 + n), 0.0, 1.0);
}

float threshold(float a) {
  float t = (((( -4.3856 * a + 10.9641) * a - 8.0923) * a + 1.1743) * a + 1.3292) * a + 0.0052;
  return clamp(t, 0.0, 1.0);
}

vec3 printed(sampler2D tex, vec2 uv, vec2 mm, vec2 sizeMm, float footMm, float lod, float seed, float fv, out vec3 average) {
  vec2 offC = vec2(0.034, -0.021) * (0.6 + seed);
  vec2 offM = vec2(-0.028, 0.026) * (0.6 + seed);
  vec2 offY = vec2(0.055, 0.038) * (0.6 + seed);
  vec4 sc = cmyk(textureLod(tex, uv - offC / sizeMm, lod).rgb);
  vec4 sm = cmyk(textureLod(tex, uv - offM / sizeMm, lod).rgb);
  vec4 sy = cmyk(textureLod(tex, uv - offY / sizeMm, lod).rgb);
  vec4 sk = cmyk(textureLod(tex, uv, lod).rgb);
  float n = vnoise(mm * 3.0 + seed * 40.0);
  float c = gain(sc.x, n);
  float m = gain(sm.y, n);
  float y = gain(sy.z, n);
  float k = gain(sk.w, n);
  average = PAPER * mix(vec3(1.0), INK_C, c) * mix(vec3(1.0), INK_M, m) * mix(vec3(1.0), INK_Y, y) * mix(vec3(1.0), INK_K, k);

  float aa = footMm / CELL * 1.7 + 0.012;
  float edge = 0.09 * fv;
  float fib = fineFibres(mm + seed * 5.0);
  float bleed = (fib - 0.15) * 0.06 * fv;
  float rc = (vnoise(mm * 34.0 + 1.3) - 0.5) * edge + (vnoise(mm * 110.0) - 0.5) * edge * 0.7 - bleed;
  float rm = (vnoise(mm * 34.0 + 7.9) - 0.5) * edge + (vnoise(mm * 110.0 + 3.0) - 0.5) * edge * 0.7 - bleed;
  float ry = (vnoise(mm * 34.0 + 4.4) - 0.5) * edge + (vnoise(mm * 110.0 + 6.0) - 0.5) * edge * 0.7 - bleed;
  float rk = (vnoise(mm * 34.0 + 9.2) - 0.5) * edge + (vnoise(mm * 110.0 + 9.0) - 0.5) * edge * 0.7 - bleed;
  float ac = screenPlate(mm - offC, 0.2618, threshold(c), aa, rc);
  float am = screenPlate(mm - offM, 1.3090, threshold(m), aa, rm);
  float ay = screenPlate(mm - offY, 0.0, threshold(y), aa, ry);
  float ak = screenPlate(mm, 0.7854, threshold(k), aa, rk);

  float tooth = fbm(mm * 14.0 + seed * 9.0);
  float skip = (1.0 - fv * 0.42 * smoothstep(0.5, 0.18, tooth)) * (1.0 - fv * 0.16 * vnoise(mm * 22.0 + 5.0));
  vec3 col = PAPER;
  col *= mix(vec3(1.0), INK_Y, ay * skip);
  col *= mix(vec3(1.0), INK_M, am * skip * 0.97);
  col *= mix(vec3(1.0), INK_C, ac * skip * 0.97);
  col *= mix(vec3(1.0), INK_K, ak * skip);
  return col;
}

vec3 layCard(vec3 under, vec2 p, float foot, float inLens, sampler2D tex, vec4 card, vec4 pose, vec4 wear) {
  if (pose.z < 0.5) return under;
  vec2 halfPx = card.zw;
  float mmPx = pose.y;
  float lift = pose.w;
  float scale = halfPx.x / 160.0;
  vec2 lightDir = vec2(-0.55, -0.83);

  vec2 dropOff = vec2(3.0, 7.0) * scale * (1.0 + lift * 3.0);
  float dropBlur = 16.0 * scale * (1.0 + lift * 1.6);
  float dDrop = boxSdf(rot(p - card.xy - dropOff, -pose.x), halfPx, 4.0 * scale);
  float drop = 1.0 - smoothstep(-dropBlur, dropBlur * 1.4, dDrop);
  vec2 contactOff = vec2(0.6, 1.4) * scale * (1.0 + lift * 6.0);
  float contactBlur = 1.8 * scale * (1.0 + lift * 6.0);
  float dContact = boxSdf(rot(p - card.xy - contactOff, -pose.x), halfPx, 2.0 * scale);
  float contact = 1.0 - smoothstep(-contactBlur, contactBlur, dContact);
  vec3 col = under * (1.0 - drop * (0.2 - lift * 0.06) - contact * (0.26 - lift * 0.18));

  vec2 local = rot(p - card.xy, -pose.x);
  vec2 mm = local * mmPx;
  vec2 halfMm = halfPx * mmPx;
  float footMm = foot * mmPx;
  float seed = wear.w;

  float cornerX = smoothstep(halfMm.x - 3.5, halfMm.x, abs(mm.x));
  float cornerY = smoothstep(halfMm.y - 3.5, halfMm.y, abs(mm.y));
  float corner = cornerX * cornerY;
  float rim = max(cornerX, cornerY);
  float d = boxSdf(mm, halfMm, 0.7 + corner * 0.4);
  if (d > 0.6 + footMm * 2.0) return col;
  bool nearEdge = d > -1.6;
  if (nearEdge) {
    d += (fbm(mm * 1.8 + seed * 31.0) - 0.45) * (0.08 + 0.55 * corner);
    d += (vnoise(mm * 26.0 + seed) - 0.5) * 0.045 * rim;
    d += (vnoise(mm * 90.0) - 0.5) * 0.02 * rim;
  }
  if (d > footMm * 2.0) return col;
  float alpha = smoothstep(footMm * 0.8, -footMm * 0.8, d);

  vec2 uv = local / (2.0 * halfPx) + 0.5;
  float texPx = float(textureSize(tex, 0).x);
  float sizeX = 2.0 * halfMm.x;
  float lod = log2(max(footMm * texPx / sizeX, 1e-4));
  vec3 photo = textureLod(tex, uv, max(lod, 0.0)).rgb;

  float cellPx = CELL / max(footMm, 1e-5);
  float zoom = uLens.w;
  float resolve = 0.3 * smoothstep(3.0, 4.0, zoom);
  float w = resolve * smoothstep(2.2, 4.0, cellPx) * inLens;
  float fv = smoothstep(10.0, 19.0, zoom) * smoothstep(8.0, 16.0, cellPx) * inLens;
  vec3 surface = photo;
  if (w > 0.001) {
    vec3 average;
    vec3 ink = printed(tex, uv, mm, 2.0 * halfMm, footMm, max(lod, 0.7), seed, fv, average);
    vec3 ratio = clamp(photo / max(average, vec3(0.03)), 0.6, 1.6);
    ink *= mix(vec3(1.0), ratio, 0.7 - 0.35 * fv);
    surface = mix(photo, ink, w);
  }

  if (fv > 0.001) {
    float fib = fineFibres(mm + seed * 5.0);
    float bump = vnoise(mm * 38.0) - vnoise(mm * 38.0 + vec2(0.32, 0.46));
    float shade = 1.0 + fv * (bump * 0.07 + (fib - 0.15) * 0.05);
    surface *= shade;
    surface = mix(surface, PAPER * 1.03, fv * fib * 0.06);
  }

  vec2 cn = vec2(cos(wear.x), sin(wear.x));
  float dc = dot(mm, cn) - wear.y;
  float crease = wear.z;
  if (crease > 0.001 && abs(dc) < 0.6 + footMm * 4.0) {
    float along = dot(mm, vec2(-cn.y, cn.x));
    float wd = max(0.16, footMm * 1.4);
    float z = dc / wd;
    float ridge = z * exp(-z * z) * 1.4;
    surface *= 1.0 + ridge * 0.22 * crease;
    float cw = max(0.045, footMm * 1.2);
    float core = exp(-pow(dc / cw, 2.0)) * (0.045 / cw);
    float crack = smoothstep(0.38, 0.62, vnoise(vec2(along * 7.0, dc * 18.0) + seed * 3.0));
    float flake = smoothstep(0.55, 0.8, vnoise(vec2(along * 2.2, dc * 6.0) + seed * 11.0)) * exp(-pow(dc / max(0.14, footMm), 2.0));
    surface = mix(surface, PAPER * 1.01, clamp((core * (0.35 + 0.65 * crack) + flake * 0.55) * crease, 0.0, 0.9));
  }

  if (nearEdge) {
    float worn = smoothstep(-0.9, 0.05, d + (fbm(mm * 4.0 + seed * 7.0) - 0.5) * 0.7);
    surface = mix(surface, vec3(0.93, 0.91, 0.86), worn * (0.22 + 0.6 * corner));
  }

  vec2 edgeN = abs(mm.x / halfMm.x) > abs(mm.y / halfMm.y) ? vec2(sign(mm.x), 0.0) : vec2(0.0, sign(mm.y));
  vec2 lightLocal = rot(lightDir, -pose.x);
  vec2 sunAx = vec2(-uSun.y, uSun.x);
  float band = dot(local / max(halfPx, vec2(1.0)), sunAx) * 0.7 + dot(local / max(halfPx, vec2(1.0)), uSun.xy) * 0.3 + mix(-0.6, 0.6, uSun.w);
  surface += vec3(1.0, 0.94, 0.86) * exp(-band * band * 9.0) * 0.07;
  float bevelW = max(0.1, footMm * 1.2);
  float bevel = exp(-pow((d + bevelW * 0.7) / bevelW, 2.0));
  surface += bevel * dot(edgeN, -lightLocal) * 0.10;
  surface *= 0.985 + 0.03 * exp(-dot(uv - vec2(0.28, 0.2), uv - vec2(0.28, 0.2)) * 3.0);

  return mix(col, surface, alpha);
}

vec3 scene(vec2 p, float foot, float inLens) {
  vec3 col = table(p, foot, inLens);
  if (uShowB > 0.5) col = layCard(col, p, foot, inLens, uTexB, uCardB, uPoseB, uWearB);
  col = layCard(col, p, foot, inLens, uTexA, uCardA, uPoseA, uWearA);
  return sunlight(col, p, 1.0 - inLens);
}

vec3 glass(vec2 dl, float r, float radius, float zoom, float foot0) {
  vec2 L = uLens.xy;
  vec2 dir = dl / max(length(dl), 1e-4);
  float rr = min(r, 1.0);
  float r2 = rr * rr;
  float r8 = r2 * r2 * r2 * r2;
  float m = 1.0 + 0.04 * r2 + 0.12 * r8;
  float dm = 1.0 + 0.12 * r2 + 1.08 * r8;
  float band = smoothstep(0.8, 1.0, rr);
  float bend = band * band * (3.0 - 2.0 * band);
  vec2 inner = dl / zoom * m;
  vec2 outer = dir * radius * mix(0.9, 1.22, bend);
  vec2 s = mix(inner, outer, bend);
  float foot = foot0 * (dm / zoom + bend * 6.0);
  vec3 seen = scene(L + s, foot, 1.0 - bend);
  float ca = 0.035 * pow(max(rr - 0.6, 0.0) / 0.4, 2.0) + 0.03 * bend;
  if (ca > 0.002) {
    seen.r = scene(L + s * (1.0 + ca), foot, 1.0 - bend).r;
    seen.b = scene(L + s * (1.0 - ca), foot, 1.0 - bend).b;
  }
  vec2 nd = dl / radius;
  vec2 sb = rot(nd + uSun.xy * 0.42, atan(uSun.y, uSun.x) + 1.5708) / vec2(0.34, 0.1);
  float softbox = smoothstep(1.0, 0.4, length(sb));
  seen = mix(seen, vec3(1.0, 0.96, 0.9), softbox * 0.16);
  float toSun = max(dot(dir, -uSun.xy), 0.0);
  float away = max(dot(dir, uSun.xy), 0.0);
  float fresnel = pow(rr, 14.0);
  seen += vec3(0.9, 0.93, 1.0) * fresnel * (0.05 + 0.16 * toSun);
  float glint = exp(-pow((rr - 0.986) / 0.01, 2.0)) * (0.12 + 0.88 * pow(toSun, 3.0));
  float lip = exp(-pow((rr - 0.955) / 0.02, 2.0)) * pow(away, 4.0);
  float caustic = exp(-pow((rr - 0.9) / 0.05, 2.0)) * pow(away, 3.0);
  seen += vec3(1.0, 0.97, 0.92) * glint * 0.75 + vec3(1.0, 0.9, 0.74) * lip * 0.22 + caustic * vec3(0.3, 0.24, 0.16);
  return seen;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float foot0 = 1.0 / uDpr;
  vec2 dl = p - uLens.xy;
  float radius = uLens.z;
  float r = length(dl) / radius;
  float aa = foot0 / radius;

  vec3 col = vec3(0.0);
  if (uLensOn < 0.5 || r > 1.0 - aa * 1.5) {
    col = scene(p, foot0, 0.0);
  }

  if (uLensOn > 0.5 && r < 1.0 + aa * 1.5) {
    vec3 lens = glass(dl, r, radius, uLens.w, foot0);
    float a = smoothstep(1.0 + aa, 1.0 - aa, r);
    col = mix(col, lens, a);
  }

  col += (hash21(floor(gl_FragCoord.xy) + 0.5) - 0.5) * 0.012;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
