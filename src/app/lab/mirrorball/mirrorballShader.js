export const SCENE_VS = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SCENE_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform vec2 uRes;
uniform vec2 uBox;
uniform vec4 uBall;
uniform vec3 uCam;
uniform float uWall;
uniform vec4 uRoom;
uniform float uMix;
uniform mat3 uRot;
uniform vec3 uLight;
uniform vec3 uGel;
uniform float uRings;
uniform sampler2D uFacets;
uniform sampler2D uAtlas;
uniform sampler2D uAtlasPrev;
uniform sampler2D uMask;
uniform sampler2D uSpecks;
uniform sampler2D uGlow;
uniform sampler2D uNoise;
uniform float uTime;
uniform float uLightInv;
uniform float uFrag;
uniform float uEnvLod;
uniform float uHaze;
uniform float uSeed;
uniform float uMaskOn;
uniform float uPhotoOn;
uniform float uFade;

out vec4 outColor;

const float PI = 3.14159265;
const float TAU = 6.28318531;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec4 roomHit(vec3 o, vec3 d, out vec3 nrm) {
  float best = 1e9;
  nrm = vec3(0.0, 0.0, 1.0);
  float t;
  if (d.x > 1e-5) { t = (uRoom.x - o.x) / d.x; if (t < best) { best = t; nrm = vec3(-1.0, 0.0, 0.0); } }
  if (d.x < -1e-5) { t = (-uRoom.x - o.x) / d.x; if (t < best) { best = t; nrm = vec3(1.0, 0.0, 0.0); } }
  if (d.y > 1e-5) { t = (uRoom.z - o.y) / d.y; if (t < best) { best = t; nrm = vec3(0.0, -1.0, 0.0); } }
  if (d.y < -1e-5) { t = (-uRoom.y - o.y) / d.y; if (t < best) { best = t; nrm = vec3(0.0, 1.0, 0.0); } }
  if (d.z < -1e-5) { t = (-uRoom.w - o.z) / d.z; if (t < best) { best = t; nrm = vec3(0.0, 0.0, 1.0); } }
  return vec4(o + d * best, best);
}

vec2 toScreen(vec3 q) {
  float s = uBall.w / max(uBall.w - q.z, 1.0);
  vec2 p = uCam.xy + (q.xy - uCam.xy) * s;
  return vec2(uBall.x + p.x, uBall.y - p.y);
}

vec3 photoEnv(vec3 r) {
  float az = atan(r.x, -r.z);
  float u = az / TAU + 0.5;
  float e = asin(clamp(r.y, -1.0, 1.0));
  float v = (e + 0.74) / 1.6;
  float band = smoothstep(-0.02, 0.32, v) * smoothstep(1.02, 0.78, v);
  vec2 auv = vec2(u, 1.0 - clamp(v, 0.0, 1.0));
  vec3 cover = mix(textureLod(uAtlasPrev, auv, uEnvLod).rgb, textureLod(uAtlas, auv, uEnvLod).rgb, uMix);
  vec3 lum = pow(max(cover, vec3(0.0)), vec3(2.2)) * 1.4;
  vec3 room = lum * band * mix(vec3(1.0), uGel, 0.25) * 0.5 * uPhotoOn;
  room += vec3(0.004, 0.0035, 0.003);
  return room;
}

vec3 lampEnv(vec3 r) {
  float g = min(dot(r, uLight), 1.0);
  vec3 c = uGel * (smoothstep(0.9965, 0.9992, g) * 22.0 + exp((g - 1.0) * 70.0) * 1.1 + exp((g - 1.0) * 7.0) * 0.08);
  float g1 = min(dot(r, normalize(vec3(0.82, 0.2, -0.54))), 1.0);
  c += vec3(0.16, 0.42, 1.0) * exp((g1 - 1.0) * 900.0) * 1.6;
  float g2 = min(dot(r, normalize(vec3(-0.7, -0.16, -0.7))), 1.0);
  c += vec3(1.0, 0.18, 0.1) * exp((g2 - 1.0) * 1400.0) * 1.2;
  return c;
}

vec3 aces(vec3 x) {
  x = clamp(x, 0.0, 64.0);
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 css = vec2(fc.x, uRes.y - fc.y) * (uBox.x / uRes.x);
  float pxPerCss = uRes.x / uBox.x;
  float R = uBall.z;
  vec3 w0 = vec3(css.x - uBall.x, uBall.y - css.y, 0.0);
  vec3 rd = normalize(w0 - uCam);
  float b = dot(uCam, rd);
  float camSq = dot(uCam, uCam);
  float perp = sqrt(max(camSq - b * b, 0.0));
  float cov = clamp((R - perp) * pxPerCss * 0.9 + 0.5, 0.0, 1.0);

  vec3 nR;
  vec4 rh = roomHit(uCam, rd, nR);
  vec3 hw = rh.xyz;
  vec3 specks = texelFetch(uSpecks, ivec2(fc), 0).rgb * uLightInv;
  vec3 glow = texelFetch(uGlow, ivec2(fc), 0).rgb * uLightInv;
  vec2 uvBox = css / uBox;
  float mask = 0.0;
  if (uMaskOn > 0.5) mask = texture(uMask, vec2(fc.x / uRes.x, 1.0 - fc.y / uRes.y)).a;
  vec3 wall = specks * 0.055 * (1.0 - clamp(mask * 1.6, 0.0, 0.92));

  float rodHalf = max(R * 0.009, 1.1);
  float rodX = abs(css.x - uBall.x);
  float rodTop = uBall.y - R * 0.96;
  float rod = smoothstep(rodHalf + 0.8 / pxPerCss, rodHalf - 0.4 / pxPerCss, rodX) * step(css.y, rodTop);
  float rodShade = 0.012 + 0.08 * smoothstep(rodHalf, -rodHalf, css.x - uBall.x + rodHalf * 0.4);
  vec3 rodCol = vec3(0.03 + rodShade) * mix(0.4, 1.0, smoothstep(0.0, max(rodTop / uBox.y, 0.01), uvBox.y));
  wall = mix(wall, rodCol, rod);
  wall += glow;

  vec3 color = wall;
  if (cov > 0.0) {
    float h = max(b * b - (camSq - R * R), 0.0);
    vec3 hit = uCam + rd * (-b - sqrt(h));
    vec3 nW = normalize(hit);
    vec3 nL = transpose(uRot) * nW;
    float d = PI / uRings;
    float lat = asin(clamp(nL.y, -1.0, 1.0));
    float fj = (lat + 0.5 * PI) / d;
    float j = clamp(floor(fj), 0.0, uRings - 1.0);
    float v = clamp(fj - j, 0.0, 1.0);
    float k = texelFetch(uFacets, ivec2(0, int(j)), 0).w;
    float lon = atan(nL.z, nL.x);
    if (lon < 0.0) lon += TAU;
    float dl = TAU / max(k, 1.0);
    float fi = lon / dl;
    float i = min(floor(fi), k - 1.0);
    float u = clamp(fi - i, 0.0, 1.0);
    vec3 facet = texelFetch(uFacets, ivec2(int(i), int(j)), 0).xyz;
    vec3 nF = normalize(uRot * facet);
    float eu = min(u, 1.0 - u) * dl * max(cos(lat), 0.02) / d;
    float ev = min(v, 1.0 - v);
    float edge = min(eu, ev);
    float aa = clamp(fwidth(edge), 0.004, 0.25);
    float groutW = 0.055;
    float grout = 1.0 - smoothstep(groutW - aa * 0.5, groutW + aa, edge);
    float th = hash12(vec2(i, j) + 3.1);
    vec3 rv = reflect(rd, nF);
    vec3 tU = uRot * vec3(-sin(lon), 0.0, cos(lon));
    vec3 tV = uRot * vec3(-sin(lat) * cos(lon), cos(lat), -sin(lat) * sin(lon));
    vec3 rvF = normalize(rv + (tU * (u - 0.5) + tV * (v - 0.5)) * uFrag);
    float fres = 0.66 + 0.3 * pow(1.0 - clamp(dot(-rd, nF), 0.0, 1.0), 5.0);
    vec3 glass = mix(vec3(1.0), vec3(0.9, 0.97, 0.94), th) * (0.62 + 0.42 * hash12(vec2(j, i) + 5.3)) * fres;
    vec3 tile = (photoEnv(rvF) + lampEnv(rv) + vec3(0.016) * (0.55 + 0.45 * rvF.y)) * glass;
    float lam = max(dot(nW, uLight), 0.0);
    float bevel = smoothstep(groutW + 0.14, groutW, edge) * (1.0 - grout);
    tile += uGel * bevel * lam * 0.03;
    tile += uGel * lam * 0.004;
    vec3 groutCol = vec3(0.003) + uGel * lam * 0.012;
    vec3 ballCol = mix(tile, groutCol, grout);
    float capMask = smoothstep(0.9805, 0.9835, nL.y);
    vec3 rn = reflect(rd, nW);
    float capSpec = pow(max(dot(rn, uLight), 0.0), 24.0);
    vec3 capCol = vec3(0.012) + uGel * (lam * 0.05 + capSpec * 0.9) + photoEnv(rn) * 0.5;
    float collar = smoothstep(0.9805, 0.9815, nL.y) - smoothstep(0.9815, 0.983, nL.y);
    capCol *= 1.0 - collar * 0.7;
    ballCol = mix(ballCol, capCol, capMask);
    float limb = clamp(dot(-rd, nW), 0.0, 1.0);
    ballCol *= mix(0.55, 1.0, smoothstep(0.0, 0.35, limb));
    color = mix(wall, ballCol, cov);
  }

  vec3 mapped = aces(color * 1.15);
  vec3 display = pow(max(mapped, vec3(0.0)), vec3(1.0 / 2.2));
  float n = hash12(fc + fract(uSeed) * 517.0) - 0.5;
  float n2 = hash12(fc * 1.37 + fract(uSeed * 1.7) * 311.0) - 0.5;
  display += (n + n2) * (1.0 / 255.0) * step(0.004, dot(display, vec3(0.33)));
  outColor = vec4(display * uFade, 1.0);
}
`;

export const SPECK_VS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec2 aFacet;

uniform sampler2D uFacets;
uniform mat3 uRot;
uniform mat3 uRotPrev;
uniform vec3 uLight;
uniform vec3 uCam;
uniform vec4 uBall;
uniform vec2 uBox;
uniform float uWall;
uniform vec4 uRoom;
uniform float uMix;
uniform sampler2D uTint;
uniform sampler2D uTintPrev;
uniform float uRings;
uniform float uSpread;
uniform int uMode;

out vec2 vLocal;
flat out vec2 vMotion;
out float vPower;
out float vAlong;
out float vSoft;
out vec3 vTint;

const float PI = 3.14159265;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 toScreen(vec3 q) {
  float s = uBall.w / max(uBall.w - q.z, 1.0);
  vec2 p = uCam.xy + (q.xy - uCam.xy) * s;
  return vec2(uBall.x + p.x, uBall.y - p.y);
}

vec4 roomHit(vec3 o, vec3 d, out vec3 nrm) {
  float best = 1e9;
  nrm = vec3(0.0, 0.0, 1.0);
  float t;
  if (d.x > 1e-5) { t = (uRoom.x - o.x) / d.x; if (t < best) { best = t; nrm = vec3(-1.0, 0.0, 0.0); } }
  if (d.x < -1e-5) { t = (-uRoom.x - o.x) / d.x; if (t < best) { best = t; nrm = vec3(1.0, 0.0, 0.0); } }
  if (d.y > 1e-5) { t = (uRoom.z - o.y) / d.y; if (t < best) { best = t; nrm = vec3(0.0, -1.0, 0.0); } }
  if (d.y < -1e-5) { t = (-uRoom.y - o.y) / d.y; if (t < best) { best = t; nrm = vec3(0.0, 1.0, 0.0); } }
  if (d.z < -1e-5) { t = (-uRoom.w - o.z) / d.z; if (t < best) { best = t; nrm = vec3(0.0, 0.0, 1.0); } }
  return vec4(o + d * best, best);
}

vec4 toClip(vec2 css) {
  return vec4(css.x / uBox.x * 2.0 - 1.0, 1.0 - css.y / uBox.y * 2.0, 0.0, 1.0);
}

void main() {
  vLocal = aCorner;
  vMotion = vec2(0.0);
  vPower = 0.0;
  vAlong = 0.0;
  vSoft = 0.2;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vec4 texel = texelFetch(uFacets, ivec2(aFacet), 0);
  float d = PI / uRings;
  float lat = -0.5 * PI + (aFacet.y + 0.5) * d;
  float lon = (aFacet.x + 0.5) * 2.0 * PI / max(texel.w, 1.0);
  vec3 ng = uRot * vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
  vec3 n = normalize(uRot * texel.xyz);
  float th = hash12(aFacet + 3.1);
  float th2 = hash12(aFacet * 1.7 + 11.0);
  vec3 cover = mix(texelFetch(uTintPrev, ivec2(aFacet), 0).rgb, texelFetch(uTint, ivec2(aFacet), 0).rgb, uMix);
  vTint = cover * (0.62 + 0.5 * th2 * th2);
  float R = uBall.z;
  float tile = R * d;
  vec3 P = ng * R;
  float lit = dot(ng, uLight);
  float polar = smoothstep(1.39, 1.3, abs(lat));
  if (polar <= 0.0) return;

  if (uMode == 2) {
    vec3 V = normalize(uCam - P);
    float facing = dot(ng, V);
    if (facing < 0.1 || lit <= 0.0) return;
    vec3 rv = reflect(-V, n);
    float g = dot(rv, uLight);
    float glint = smoothstep(0.986, 0.9985, g);
    if (glint < 0.003) return;
    float s = uBall.w / max(uBall.w - P.z, 1.0);
    float fade = smoothstep(0.1, 0.4, facing);
    float rad = tile * s * (1.6 + 3.4 * glint) * mix(0.6, 1.0, fade);
    vPower = glint * fade * smoothstep(0.0, 0.12, lit) * polar;
    gl_Position = toClip(toScreen(P) + aCorner * rad);
    return;
  }

  if (lit <= 0.0) return;
  vec3 r = reflect(-uLight, n);
  vec3 N;
  vec4 hit = roomHit(P, r, N);
  vec3 H = hit.xyz;
  float t = hit.w;
  if (t > 1e8 || N.z < 0.5) return;
  vec2 onScreen = toScreen(H) / uBox;
  if (onScreen.x < -0.15 || onScreen.x > 1.15 || onScreen.y < -0.15 || onScreen.y > 1.15) return;
  float pen = t * uSpread;
  float rad = tile * 0.42 + pen;
  float cosI = abs(dot(r, N));
  float stretch = min(1.0 / max(cosI, 0.2), 5.0);
  vec3 a1w = r - N * dot(r, N);
  float al = length(a1w);
  a1w = al > 0.0001 ? a1w / al : (abs(N.y) > 0.5 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0));
  vec3 a2w = cross(N, a1w);
  float power = sqrt(lit) * (tile * tile * 0.18) / max(rad * rad * stretch, 0.0001);
  power = min(power, 2.4) * smoothstep(0.0, 0.22, lit) * polar;
  vPower = power;
  vSoft = clamp(pen / rad, 0.06, 0.9);

  if (uMode == 0) {
    vec2 s1 = toScreen(H);
    vec2 ax1 = toScreen(H + a1w * rad * stretch) - s1;
    vec2 ax2 = toScreen(H + a2w * rad) - s1;
    vec2 motion = vec2(0.0);
    vec3 nPrev = normalize(uRotPrev * texel.xyz);
    vec3 ngPrev = uRotPrev * vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
    vec3 rPrev = reflect(-uLight, nPrev);
    vec3 nPrevHit;
    vec4 hp = roomHit(ngPrev * R, rPrev, nPrevHit);
    if (hp.w < 1e8 && dot(nPrevHit, N) > 0.5) {
      vec2 m = toScreen(hp.xyz) - s1;
      float det = ax1.x * ax2.y - ax1.y * ax2.x;
      if (abs(det) > 0.0001) motion = vec2(m.x * ax2.y - m.y * ax2.x, ax1.x * m.y - ax1.y * m.x) / det;
      float ml = length(motion);
      if (ml > 14.0) motion *= 14.0 / ml;
    }
    vec2 L = aCorner * 1.6;
    if (dot(aCorner, motion) > 0.0) L += motion;
    vMotion = motion;
    vPower = power / (1.0 + length(motion) * 0.55);
    gl_Position = toClip(s1 + ax1 * L.x + ax2 * L.y);
    vLocal = L;
    return;
  }

  vec3 P0 = P + r * tile * 0.4;
  vec2 ps = toScreen(P0);
  vec2 hs = toScreen(H);
  vec2 dir = hs - ps;
  float len = length(dir);
  if (len < 2.0) return;
  vec2 dn = dir / len;
  vec2 nn = vec2(-dn.y, dn.x);
  float along = aCorner.x * 0.5 + 0.5;
  float reach = 0.4;
  float s0 = uBall.w / max(uBall.w - P0.z, 1.0);
  float s1 = uBall.w / max(uBall.w - H.z, 1.0);
  float w = max(mix(tile * 0.4 * s0, rad * s1, along * reach), 0.8);
  vAlong = along;
  gl_Position = toClip(mix(ps, hs, along * reach) + nn * aCorner.y * w);
}
`;

export const SPECK_FS = `#version 300 es
precision highp float;
precision highp int;

in vec2 vLocal;
flat in vec2 vMotion;
in float vPower;
in float vAlong;
in float vSoft;
in vec3 vTint;

uniform int uMode;
uniform vec3 uGel;
uniform float uRayGain;
uniform float uSpeckGain;
uniform float uLightScale;

layout(location = 0) out vec4 oLight;
layout(location = 1) out vec4 oGlow;

void main() {
  if (vPower <= 0.0) discard;
  if (uMode == 0) {
    float mm = dot(vMotion, vMotion);
    float st = mm > 0.0001 ? clamp(dot(vLocal, vMotion) / mm, 0.0, 1.0) : 0.0;
    vec2 q = abs(vLocal - vMotion * st);
    float shape = mix(3.4, 2.0, vSoft);
    float dd = pow(max(pow(q.x, shape) + pow(q.y, shape), 0.000001), 1.0 / shape);
    float body = 1.0 - smoothstep(1.0 - vSoft * 0.7, 1.0 + vSoft * 0.35, dd);
    float halo = exp(-dd * dd * 2.2) * 0.07;
    vec3 c = uGel * vTint * vPower * (body + halo) * uSpeckGain;
    oLight = vec4(c * uLightScale, 1.0);
    oGlow = vec4(0.0);
    return;
  }
  float across = 1.0 - clamp(abs(vLocal.y), 0.0, 1.0);
  across *= across;
  float fade = smoothstep(0.0, 0.08, vAlong) * pow(clamp(1.0 - vAlong, 0.0, 1.0), 1.8);
  vec3 c = uGel * vTint * min(vPower, 1.0) * across * fade * uRayGain;
  oLight = vec4(0.0);
  oGlow = vec4(c * uLightScale, 1.0);
}
`;

export const GLINT_FS = `#version 300 es
precision highp float;
precision highp int;

in vec2 vLocal;
flat in vec2 vMotion;
in float vPower;
in float vAlong;
in float vSoft;
in vec3 vTint;

uniform vec3 uGel;
uniform float uGlintGain;
uniform float uFade;

out vec4 outColor;

void main() {
  if (vPower <= 0.0) discard;
  float d2 = dot(vLocal, vLocal);
  if (d2 > 1.0) discard;
  float core = exp(-d2 * 60.0);
  float halo = exp(-d2 * 7.0) * 0.3 + (1.0 - d2) * (1.0 - d2) * 0.04;
  float streak = exp(-vLocal.y * vLocal.y * 900.0) * (1.0 - abs(vLocal.x)) * 0.12;
  vec3 tint = mix(uGel, vec3(1.0), core * 0.8);
  vec3 c = tint * (core + halo + streak) * vPower * uGlintGain * uFade;
  outColor = vec4(c, 1.0);
}
`;
