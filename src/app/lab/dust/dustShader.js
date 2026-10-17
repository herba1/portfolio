export const MAX_SEGMENTS = 24;

const COMMON = `
float hash11(float x) {
  return fract(sin(x * 127.1 + 11.7) * 43758.5453);
}
float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), u);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm2(vec2 p) {
  float s = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    s += noise2(p) * amp;
    p = p * 2.03 + vec2(1.7, 9.2);
    amp *= 0.5;
  }
  return s / 0.9375;
}
vec3 filmic(vec3 x) {
  x = max(x, vec3(0.0));
  vec3 y = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return pow(clamp(y, 0.0, 1.0), vec3(1.0 / 2.2));
}
vec3 lampColor() {
  return vec3(1.0, 0.88, 0.74);
}
float lampIrradiance(vec3 lamp, vec2 p) {
  vec3 lv = lamp - vec3(p, 0.0);
  float len = max(length(lv), 1.0);
  float cosT = clamp(lamp.z / len, 0.0, 1.0);
  float falloff = cosT * cosT * cosT * cosT;
  float cone = mix(0.45, 1.0, smoothstep(0.42, 0.86, cosT));
  return falloff * cone;
}
`;

export const QUAD_VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const SEED_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uBase;
uniform sampler2D uFelt;
uniform vec4 uPrint[3];
uniform vec4 uPrintB[3];
uniform float uRes;
uniform float uStore;
out vec4 outColor;
${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float d = texture(uBase, uv).r;
  vec4 felt = texture(uFelt, uv * 2.0);
  float blot = texture(uFelt, uv * 0.7 + 0.31).b;
  d *= 0.84 + 0.28 * blot + 0.1 * (felt.g - 0.5);
  for (int i = 0; i < 3; i++) {
    vec4 p = uPrint[i];
    vec4 q = uPrintB[i];
    vec2 dd = uv - p.xy;
    vec2 l = vec2(q.x * dd.x + q.y * dd.y, -q.y * dd.x + q.x * dd.y) / max(p.zw, vec2(1e-4));
    float r = length(l);
    if (r < 1.0) {
      float wob = texture(uFelt, uv * 3.0).b;
      float core = length(l * vec2(1.0, 0.86) + vec2(0.06, 0.2));
      float ridge = sin((core + 0.07 * wob + 0.02 * felt.r) * 64.0);
      float mask = (1.0 - smoothstep(0.45, 1.0, r)) * (0.55 + 0.45 * noise2(l * 3.0 + p.xy * 40.0));
      float carve = smoothstep(-0.1, 0.8, ridge);
      d *= 1.0 - mask * q.z * carve * 0.6;
    }
  }
  outColor = vec4(d / uStore, 0.0, 0.0, 1.0);
}
`;

export const SIM_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform sampler2D uRest;
uniform sampler2D uFelt;
uniform float uRes;
uniform float uStore;
uniform vec4 uSeg[${MAX_SEGMENTS}];
uniform vec4 uSegP[${MAX_SEGMENTS}];
uniform int uCount;
uniform float uSettle;
out vec4 outColor;
${COMMON}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float d = texture(uPrev, uv).r * uStore;
  float cover = 0.0;
  float rim = 0.0;
  vec2 inward = vec2(0.0);
  for (int i = 0; i < ${MAX_SEGMENTS}; i++) {
    if (i >= uCount) break;
    vec4 s = uSeg[i];
    vec4 q = uSegP[i];
    vec2 a = s.xy;
    vec2 ab = s.zw - s.xy;
    float len2 = dot(ab, ab);
    float t = len2 > 1e-12 ? clamp(dot(uv - a, ab) / len2, 0.0, 1.0) : 0.0;
    vec2 off = uv - (a + ab * t);
    float dist = length(off);
    vec2 dir = len2 > 1e-12 ? ab / sqrt(len2) : vec2(1.0, 0.0);
    float width = max(q.x, 1e-5);
    float across = (dir.x * (uv.y - a.y) - dir.y * (uv.x - a.x)) / width;
    float r = dist / width;
    float env = 1.0 - smoothstep(0.42, 1.0, r);
    float along = dot(uv, dir) / width;
    float lanes = noise1(across * 5.0 + q.z) * 0.5 + noise2(vec2(across * 15.0 + q.z * 1.7, along * 0.35)) * 0.35 + noise1(across * 38.0 + q.z * 3.1) * 0.15;
    float streak = 0.4 + 0.6 * smoothstep(0.18, 0.78, lanes);
    float c = env * streak * q.y;
    cover = max(cover, c);
    float rw = (r - 1.02) / 0.18;
    float ridge = exp(-min(rw * rw, 30.0)) * q.w;
    if (ridge > rim) {
      rim = ridge;
      inward = -off / max(dist, 1e-6) * width * 0.6;
    }
  }
  float next = d * (1.0 - clamp(cover, 0.0, 1.0));
  if (rim > 0.001) {
    float inner = texture(uPrev, uv + inward).r * uStore;
    next += inner * rim;
  }
  if (uSettle >= 0.0) {
    float rest = texture(uRest, uv).r * uStore;
    float order = texture(uFelt, uv * 0.9 + 0.13).b * 0.75 + texture(uFelt, uv * 3.7).g * 0.25;
    float m = smoothstep(order - 0.3, order + 0.02, uSettle * 1.35 - 0.12);
    next = max(next, rest * m);
  }
  outColor = vec4(clamp(next, 0.0, 1.8) / uStore, 0.0, 0.0, 1.0);
}
`;

export const BG_FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uBox;
uniform float uDpr;
uniform vec2 uCenter;
uniform float uSize;
uniform vec2 uRot;
uniform vec3 uLamp;
uniform float uExposure;
out vec4 outColor;
${COMMON}
float boxDist(vec2 p, vec2 hs, float r) {
  vec2 q = abs(p) - hs + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  vec2 frag = gl_FragCoord.xy / uDpr;
  vec2 p = vec2(frag.x, uBox.y - frag.y);
  float ph = max(120.0, uSize * 0.36);
  float shift = uCenter.y - uSize * 0.21;
  float row = floor((p.y - shift) / ph);
  float fy = (p.y - shift) / ph - row;
  float seed = hash11(row * 3.1 + 1.0) * 40.0;
  vec2 wp = vec2(p.x / ph, fy);
  float warp = fbm2(vec2(wp.x * 0.35 + seed, wp.y * 2.0));
  float bands = sin((fy * 5.0 + warp * 3.2 + wp.x * 0.06) * 6.2831);
  float fine = fbm2(vec2(p.x * 0.004 + seed, p.y * 0.22));
  float pores = noise2(vec2(p.x * 0.05, p.y * 1.4) + seed);
  float tone = hash11(row * 7.7 + 3.0);
  vec3 light = mix(vec3(0.5, 0.32, 0.17), vec3(0.58, 0.39, 0.21), tone);
  vec3 dark = vec3(0.3, 0.16, 0.07);
  float grainMix = clamp(0.28 + 0.2 * bands + 0.35 * (fine - 0.5) + 0.12 * (pores - 0.5), 0.0, 1.0);
  vec3 wood = mix(light, dark, grainMix * 0.7);
  float knotD = length((wp - vec2(1.7 + tone * 3.0, 0.55)) * vec2(1.0, 3.0));
  wood = mix(wood, dark * 0.8, 0.5 * (1.0 - smoothstep(0.02, 0.09, knotD)));
  float edgeD = min(fy, 1.0 - fy) * ph;
  float gap = smoothstep(0.6, 2.4, edgeD);
  float bevel = 1.0 - 0.18 * (1.0 - smoothstep(2.0, 7.0, fy * ph)) + 0.1 * (1.0 - smoothstep(2.0, 6.0, (1.0 - fy) * ph));
  wood *= mix(0.12, 1.0, gap) * bevel;
  float haze = fbm2(p * 0.006 + 4.0);
  wood = mix(wood, vec3(0.42, 0.38, 0.33), 0.1 + 0.12 * haze);

  vec2 d = p - uCenter;
  vec2 local = vec2(uRot.x * d.x + uRot.y * d.y, -uRot.y * d.x + uRot.x * d.y);
  vec2 away = normalize(uCenter - uLamp.xy + vec2(1e-3));
  vec2 awayLocal = vec2(uRot.x * away.x + uRot.y * away.y, -uRot.y * away.x + uRot.x * away.y);
  vec2 halfSize = vec2(uSize * 0.5);
  float soft = boxDist(local - awayLocal * uSize * 0.03, halfSize, uSize * 0.02);
  float shadow = 1.0 - smoothstep(-uSize * 0.05, uSize * 0.07, soft);
  float tight = boxDist(local - awayLocal * uSize * 0.006, halfSize, 3.0);
  float contact = 1.0 - smoothstep(-1.0, uSize * 0.016, tight);
  float occl = 1.0 - 0.42 * shadow - 0.4 * contact;

  float e = lampIrradiance(uLamp, p);
  vec3 lit = wood * (lampColor() * e * uExposure * occl + vec3(0.07, 0.075, 0.085) * mix(0.6, 1.0, occl));
  vec2 vq = (p / uBox - 0.5);
  lit *= 1.0 - 0.55 * smoothstep(0.2, 0.9, length(vq * vec2(1.0, uBox.y / uBox.x) * 1.3));
  vec3 col = filmic(lit);
  col += (hash21(gl_FragCoord.xy) - 0.5) * 0.018;
  outColor = vec4(col, 1.0);
}
`;

export const COVER_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uBg;
uniform sampler2D uArt;
uniform sampler2D uSurf;
uniform sampler2D uDust;
uniform sampler2D uFelt;
uniform vec2 uBox;
uniform float uDpr;
uniform vec2 uCenter;
uniform float uSize;
uniform vec2 uRot;
uniform vec3 uLamp;
uniform vec3 uEye;
uniform float uStore;
uniform float uExposure;
uniform float uDustTexel;
out vec4 outColor;
${COMMON}
float boxDist(vec2 p, vec2 hs, float r) {
  vec2 q = abs(p) - hs + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float ggx(float ndh, float a) {
  float a2 = a * a;
  float d = ndh * ndh * (a2 - 1.0) + 1.0;
  return a2 / (3.14159 * max(d * d, 1e-6));
}
vec2 toLocal(vec2 v) {
  return vec2(uRot.x * v.x + uRot.y * v.y, -uRot.y * v.x + uRot.x * v.y);
}
float surfaceHeight(vec2 uv) {
  vec4 s = texture(uSurf, uv);
  float warp = texture(uFelt, uv * 0.9 + 0.5).b;
  return s.g * 0.55 + s.r * 0.35 + warp * uSize * 0.0025;
}
float dustAt(vec2 uv) {
  return texture(uDust, uv).r * uStore;
}
void main() {
  vec2 bgUv = gl_FragCoord.xy / (uBox * uDpr);
  vec3 bg = texture(uBg, bgUv).rgb;
  vec2 frag = gl_FragCoord.xy / uDpr;
  vec2 p = vec2(frag.x, uBox.y - frag.y);
  vec2 local = toLocal(p - uCenter);
  float sd = boxDist(local, vec2(uSize * 0.5), 2.5);
  float aa = 0.75 / uDpr + 0.25;
  float inside = 1.0 - smoothstep(-aa, aa, sd);
  if (inside <= 0.0) {
    outColor = vec4(bg, 1.0);
    return;
  }
  vec2 uv = clamp(local / uSize + 0.5, vec2(0.0), vec2(1.0));
  vec4 surf = texture(uSurf, uv);
  vec3 art = pow(texture(uArt, uv).rgb, vec3(2.2));

  float ts = 1.6 / 1024.0;
  float hC = surfaceHeight(uv);
  float hX = surfaceHeight(uv + vec2(ts, 0.0));
  float hY = surfaceHeight(uv + vec2(0.0, ts));
  float pxPerTex = uSize * ts;
  vec3 n = normalize(vec3(-(hX - hC) / pxPerTex, -(hY - hC) / pxPerTex, 1.0));

  vec3 lv = uLamp - vec3(p, 0.0);
  vec3 L = normalize(lv);
  L = vec3(toLocal(L.xy), L.z);
  vec3 V = normalize(uEye - vec3(p, 0.0));
  V = vec3(toLocal(V.xy), V.z);
  vec3 H = normalize(L + V);
  float e = lampIrradiance(uLamp, p);
  float flatNl = max(L.z, 0.2);

  float edgeIn = -sd;
  vec2 corner = abs(local) / (uSize * 0.5);
  float cornerness = smoothstep(0.86, 1.0, min(corner.x, corner.y));
  float wearNoise = noise2(local * 0.35) * 0.6 + noise2(local * 1.3) * 0.4;
  float boardWear = (1.0 - smoothstep(0.0, 2.5 + 9.0 * cornerness, edgeIn * (0.6 + wearNoise)));
  boardWear = clamp(boardWear * (0.55 + 0.6 * wearNoise + 0.5 * cornerness), 0.0, 1.0);

  float ringWear = surf.r;
  vec3 albedo = mix(art, vec3(0.52, 0.5, 0.46), ringWear * 0.42);
  albedo = mix(albedo, vec3(0.62, 0.58, 0.5), boardWear);
  float nl = max(dot(n, L), 0.0) / flatNl;
  vec3 ambient = vec3(0.07, 0.075, 0.085);
  vec3 coverLit = albedo * (lampColor() * e * nl * uExposure + ambient);

  float ndh = max(dot(n, H), 0.0);
  float smudge = surf.a;
  float rough = mix(0.05, 0.2, max(smudge, ringWear * 0.8));
  float spec = ggx(ndh, rough) * 0.5 + ggx(ndh, rough * 3.0) * 0.14 + ggx(ndh, 0.45) * 0.05;
  spec += surf.b * ggx(ndh, 0.22) * 0.5;
  float fres = 0.045 + 0.4 * pow(1.0 - clamp(dot(V, H), 0.0, 1.0), 5.0);
  float gloss = (1.0 - surf.g) * (1.0 - boardWear) * (1.0 - 0.35 * smudge);
  vec3 specCol = lampColor() * spec * fres * e * uExposure * 0.9 * max(dot(n, L), 0.0) / flatNl;

  float dRaw = dustAt(uv);
  vec4 felt = texture(uFelt, uv * 2.3);
  float felt2 = texture(uFelt, uv * 5.3 + 0.37).r;
  float hair = max(felt.r, felt2 * 0.85);
  float thick = smoothstep(0.04, 0.5, dRaw);
  float clump = texture(uFelt, uv * 0.6 + 0.4).b;
  float dEff = dRaw * mix(0.15 + 2.6 * hair, 0.8 + 0.5 * hair, thick) * (0.86 + 0.28 * felt.g) * (0.8 + 0.4 * clump);
  float alpha = 1.0 - exp(-4.8 * dEff);

  float o = uDustTexel * 1.5;
  float gx = (dustAt(uv + vec2(o, 0.0)) - dustAt(uv - vec2(o, 0.0))) / (2.0 * o * uSize);
  float gy = (dustAt(uv + vec2(0.0, o)) - dustAt(uv - vec2(0.0, o))) / (2.0 * o * uSize);
  float hairX = (texture(uFelt, uv * 2.3 + vec2(1.0 / 512.0, 0.0)).r - felt.r);
  float hairY = (texture(uFelt, uv * 2.3 + vec2(0.0, 1.0 / 512.0)).r - felt.r);
  vec3 nd = normalize(vec3(-gx * 3.2 - hairX * 2.2 * thick + n.x, -gy * 3.2 - hairY * 2.2 * thick + n.y, 1.0));
  float dnl = max(dot(nd, L), 0.0) / flatNl;
  float grime = texture(uFelt, uv * 1.3 + 0.21).b;
  vec3 dustAlb = mix(vec3(0.27, 0.27, 0.265), vec3(0.4, 0.395, 0.385), grime) * (0.76 + 0.55 * hair) * (0.9 + 0.14 * min(dRaw, 1.4));
  vec3 dustLit = dustAlb * (lampColor() * e * (0.3 + 0.7 * dnl) * uExposure + ambient * 1.4);

  vec3 col = mix(coverLit, dustLit, alpha);
  col += specCol * gloss * exp(-dEff * 4.0);
  vec3 outCol = filmic(col);
  outCol += (hash21(gl_FragCoord.xy + 7.0) - 0.5) * 0.014;
  outColor = vec4(mix(bg, outCol, inside), 1.0);
}
`;

export const SPECK_VERTEX = `#version 300 es
in vec4 aState;
in vec4 aLook;
uniform vec2 uBox;
uniform float uDpr;
uniform float uCam;
uniform vec3 uLamp;
uniform float uExposure;
out vec4 vColor;
out float vSoft;
${COMMON}
void main() {
  float z = max(aState.z, 0.0);
  float k = uCam / max(uCam - z, 1.0);
  vec2 mid = uBox * 0.5;
  vec2 sp = mid + (aState.xy - mid) * k;
  vec2 clip = sp / uBox * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  float base = aLook.x * k;
  float coc = z * 0.06;
  float size = sqrt(base * base + coc * coc);
  gl_PointSize = clamp(size * uDpr + 1.0, 1.0, 64.0);
  float spread = min(1.0, (base * base + 0.6) / max(size * size, 1e-3));
  float e = lampIrradiance(uLamp, sp);
  float glint = 0.7 + 2.6 * smoothstep(3.0, 110.0, z) * (0.5 + 0.5 * aLook.z);
  vec3 lit = vec3(0.46, 0.45, 0.43) * aLook.y * (lampColor() * e * uExposure * glint + vec3(0.08));
  vColor = vec4(filmic(lit), aState.w * spread);
  vSoft = smoothstep(1.5, 9.0, size);
}
`;

export const SPECK_FRAGMENT = `#version 300 es
precision highp float;
in vec4 vColor;
in float vSoft;
out vec4 outColor;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float hard = 1.0 - smoothstep(0.35, 1.0, r);
  float disc = (1.0 - smoothstep(0.7, 1.0, r)) * (0.75 + 0.25 * r);
  float a = mix(hard, disc, vSoft) * vColor.a;
  outColor = vec4(vColor.rgb * a, a * 0.82);
}
`;

export const FIBRE_VERTEX = `#version 300 es
in vec4 aVert;
in vec2 aLook;
uniform vec2 uBox;
uniform vec3 uLamp;
uniform float uExposure;
uniform float uShadow;
out float vAcross;
out vec4 vColor;
${COMMON}
void main() {
  vec2 clip = aVert.xy / uBox * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vAcross = aVert.z;
  float e = lampIrradiance(uLamp, aVert.xy);
  vec3 lit = vec3(0.62, 0.61, 0.58) * aLook.x * (lampColor() * e * uExposure * (1.15 + aLook.y) + vec3(0.12));
  vec3 col = uShadow > 0.5 ? vec3(0.0) : filmic(lit);
  vColor = vec4(col, aVert.w);
}
`;

export const FIBRE_FRAGMENT = `#version 300 es
precision highp float;
in float vAcross;
in vec4 vColor;
out vec4 outColor;
void main() {
  float a = (1.0 - smoothstep(0.25, 1.0, abs(vAcross))) * vColor.a;
  outColor = vec4(vColor.rgb * a, a);
}
`;
