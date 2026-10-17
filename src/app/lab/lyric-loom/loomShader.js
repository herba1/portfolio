export const LOOM_VERTEX = `#version 300 es
precision highp float;

in vec4 aDyn0;
in vec4 aDyn1;
in vec4 aStat0;
in vec4 aStat1;

uniform vec2 uRes;
uniform float uHalf;
uniform float uPass;
uniform vec2 uCount;
uniform vec3 uWeave;
uniform float uExt;
uniform float uSpacing;

out vec2 vTan;
out vec2 vNrm;
out vec2 vGrad;
out float vU;
out float vSide;
out float vAxis;
out float vIdx;
out float vRow;
out float vTile;
out float vTone;
out float vSpeed;
out float vCell;
out float vLift;
out float vZ;
out float vDz;
out float vFray;

float weftOver(float r, float c, float w) {
  float o;
  if (w < 0.5) o = mod(r + c, 2.0);
  else if (w < 1.5) o = step(1.5, mod(c - r + 400.0, 4.0));
  else o = mod(floor(r * 0.5) + floor(c * 0.5), 2.0);
  return o < 0.5 ? 1.0 : -1.0;
}

float selfOver(float axis, float idx, float k, float w) {
  float n = axis < 0.5 ? uCount.y : uCount.x;
  float kk = clamp(k, 0.0, n - 1.0);
  return axis < 0.5 ? weftOver(idx, kk, w) : -weftOver(kk, idx, w);
}

float overAt(float axis, float idx, float k) {
  return mix(selfOver(axis, idx, k, uWeave.x), selfOver(axis, idx, k, uWeave.y), uWeave.z);
}

void main() {
  vec2 center = aDyn0.xy;
  vec2 nrm = aDyn0.zw;
  float side = aStat0.x;
  float u = aStat0.y;
  float axis = aStat0.z;
  float idx = aStat0.w;
  float n = axis < 0.5 ? uCount.y : uCount.x;

  float k0 = floor(u);
  float t = clamp(u - k0, 0.0, 1.0);
  float o0 = overAt(axis, idx, k0);
  float o1 = overAt(axis, idx, k0 + 1.0);
  float s = t * t * (3.0 - 2.0 * t);
  float z = mix(o0, o1, s);
  float dz = (o1 - o0) * 6.0 * t * (1.0 - t);
  if (u < 0.0 || u > n - 1.0) dz = 0.0;

  float outside = max(-u, u - (n - 1.0));
  float fray = clamp(outside / max(uExt, 0.001), 0.0, 1.0);

  float neck = clamp(pow(clamp(uSpacing / max(aDyn1.x, 1.0), 0.05, 4.0), 0.75), 0.5, 1.04);
  float hw = uHalf * neck * (1.0 + 0.12 * fray * fray);
  vec2 offset = vec2(0.0);
  if (uPass > 0.5) {
    hw *= 1.22;
    offset = vec2(1.4, 2.8) * (1.0 + clamp(aDyn1.y, -0.5, 2.0) * 1.8);
  }
  vec2 pos = center + nrm * side * hw + offset;

  vec2 clip = pos / max(uRes, vec2(1.0)) * 2.0 - 1.0;
  float bias = axis * 0.02 + mod(idx, 2.0) * 0.01;
  float depth = -(z * 0.4 + bias) * 0.5;
  gl_Position = vec4(clip.x, -clip.y, depth, 1.0);

  vTan = vec2(nrm.y, -nrm.x);
  vNrm = nrm;
  vGrad = aDyn1.zw;
  vU = u;
  vSide = side;
  vAxis = axis;
  vIdx = idx;
  vRow = aStat1.x;
  vTile = aStat1.y;
  vTone = aStat1.z;
  vSpeed = aStat1.w;
  vCell = aDyn1.x;
  vLift = aDyn1.y;
  vZ = z;
  vDz = dz;
  vFray = fray;
}
`;

const COMMON = `#version 300 es
precision highp float;

in vec2 vTan;
in vec2 vNrm;
in vec2 vGrad;
in float vU;
in float vSide;
in float vAxis;
in float vIdx;
in float vRow;
in float vTile;
in float vTone;
in float vSpeed;
in float vCell;
in float vLift;
in float vZ;
in float vDz;
in float vFray;

out vec4 outColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

float strandMask(float across, float idx, float fray, float sPx, float hw) {
  if (fray < 0.02) return 1.0;
  float strands = max(4.0, floor(hw * 2.0 / 2.4));
  float lane = (across * 0.5 + 0.5) * strands;
  float id = floor(lane);
  float len = hash12(vec2(id, idx * 7.31 + 3.0));
  float wobble = vnoise(vec2(sPx * 0.08, id * 1.7 + idx)) * 0.35;
  float core = abs(fract(lane + wobble * fray) - 0.5);
  float width = mix(0.5, 0.34, smoothstep(0.3, 0.7, fray));
  float alive = step(fray, 0.42 + len * 0.58);
  float loose = smoothstep(0.3, 0.42, fray);
  return alive * mix(1.0, step(core, width), loose);
}
`;

export const LOOM_SHADOW_FRAGMENT = `${COMMON}
uniform float uHalf;
uniform float uSpacing;

void main() {
  float a = abs(vSide);
  float soft = 1.0 - smoothstep(0.35, 1.0, a);
  float sPx = vU * uSpacing;
  float strands = strandMask(vSide, vIdx, vFray, sPx, uHalf);
  float alpha = 0.3 * soft * (1.0 - smoothstep(0.0, 0.7, vFray)) * mix(1.0, strands, 0.6);
  outColor = vec4(vec3(0.09, 0.06, 0.035) * alpha, alpha);
}
`;

export const LOOM_FRAGMENT = `${COMMON}
uniform sampler2D uAtlas;
uniform float uAtlasRows;
uniform float uAtlasW;
uniform float uRowH;
uniform float uHalf;
uniform float uSpacing;
uniform float uScroll;
uniform vec2 uCount;
uniform vec3 uWeave;
uniform vec3 uTones[6];
uniform vec3 uInk;
uniform vec3 uInkAccent;
uniform vec3 uGlow;
uniform float uZAmp;

float weftOver(float r, float c, float w) {
  float o;
  if (w < 0.5) o = mod(r + c, 2.0);
  else if (w < 1.5) o = step(1.5, mod(c - r + 400.0, 4.0));
  else o = mod(floor(r * 0.5) + floor(c * 0.5), 2.0);
  return o < 0.5 ? 1.0 : -1.0;
}

float selfOver(float k, float w) {
  return vAxis < 0.5 ? weftOver(vIdx, k, w) : -weftOver(k, vIdx, w);
}

float overAt(float k) {
  return mix(selfOver(k, uWeave.x), selfOver(k, uWeave.y), uWeave.z);
}

vec3 toneOf(float t) {
  int i = int(clamp(floor(t + 0.5), 0.0, 5.0));
  return uTones[i];
}

void main() {
  float across = vSide;
  float aa = abs(across);
  float acrossPx = across * uHalf;
  float sPx = vU * uSpacing + uScroll * vSpeed;

  float strands = strandMask(across, vIdx, vFray, sPx, uHalf);
  if (strands < 0.5) discard;

  vec3 tape = toneOf(vTone);
  bool accent = vTone > 4.5;

  float streak = vnoise(vec2(sPx * 0.045 + vIdx * 13.0, acrossPx * 0.55));
  float grain = vnoise(vec2(sPx * 0.62, acrossPx * 0.62 + vIdx * 5.0));
  float slub = vnoise(vec2(sPx * 0.012 + vIdx * 3.7, vIdx));
  float phase = (sPx + abs(acrossPx) * 0.95) * 2.1;
  float fw = fwidth(phase);
  float twill = sin(phase) * (1.0 - smoothstep(0.6, 1.6, fw));
  float fibre = (streak - 0.5) * 0.045 + (grain - 0.5) * 0.07 + twill * 0.04 + (slub - 0.5) * 0.05;
  tape *= 1.0 + fibre;

  float border = smoothstep(0.7, 0.76, aa) * (1.0 - smoothstep(0.8, 0.86, aa));
  tape *= 1.0 - border * 0.07;

  float atlasPx = uRowH / max(2.0 * uHalf, 1.0);
  float ax = sPx * atlasPx;
  float tile = max(vTile, 1.0);
  float wrapped = ax - floor(ax / tile) * tile;
  float vr = across * 0.5 + 0.5;
  vec2 uv = vec2(wrapped / uAtlasW, (vRow + vr) / max(uAtlasRows, 1.0));
  vec2 ddx = vec2(dFdx(ax) / uAtlasW, dFdx(vr) / max(uAtlasRows, 1.0));
  vec2 ddy = vec2(dFdy(ax) / uAtlasW, dFdy(vr) / max(uAtlasRows, 1.0));
  float cov = textureGrad(uAtlas, uv, ddx, ddy).r;
  float soak = 0.74 + 0.26 * vnoise(vec2(sPx * 0.9, acrossPx * 0.9 + vIdx * 2.0));
  float ink = cov * soak * (1.0 - smoothstep(0.0, 0.5, vFray)) * (1.0 - smoothstep(0.8, 0.9, aa));
  vec3 inkColor = accent ? uInkAccent : uInk;
  vec3 col = mix(tape, inkColor, ink * 0.9);

  float slope = vDz * uZAmp / max(vCell, 4.0);
  vec2 grad = vTan * slope + vGrad;
  vec3 n = normalize(vec3(-grad - vNrm * across * 0.32, 1.0));
  vec3 L = normalize(vec3(-0.5, -0.78, 1.05));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float lit = 0.5 + 0.56 * diff;

  float ao = mix(0.74, 1.0, smoothstep(-1.0, 1.0, vZ));
  float rim = 1.0 - 0.16 * pow(clamp(aa, 0.0, 1.0), 6.0);

  float shade = 1.0;
  float n1 = vAxis < 0.5 ? uCount.y : uCount.x;
  float k = floor(vU + 0.5);
  if (k >= 0.0 && k <= n1 - 1.0 && vU >= -0.5 && vU <= n1 - 0.5) {
    float selfO = overAt(k);
    float under = 1.0 - smoothstep(-0.6, 0.2, selfO);
    float d = (vU - k) * vCell;
    vec2 dir = vTan * sign(d + 0.0001);
    float away = max(dot(dir, normalize(vec2(0.5, 0.78))), 0.0);
    float len = max(mix(2.5, 10.0, away) * (1.0 + clamp(vLift, 0.0, 2.0) * 1.2), 1.0);
    float e = abs(d) - uHalf;
    float sh = (1.0 - smoothstep(0.0, len, e)) * smoothstep(-4.0, -0.5, e);
    shade -= 0.44 * sh * under;
    float overO = smoothstep(-0.2, 0.6, selfO);
    float crown = 1.0 - smoothstep(0.0, uHalf * 1.4, abs(d));
    shade += 0.035 * crown * overO;
  }

  float stretch = clamp(vCell / max(uSpacing, 1.0), 0.5, 2.5);
  shade *= mix(0.93, 1.03, smoothstep(0.85, 1.15, stretch));
  shade *= 1.0 + clamp(vLift, -0.5, 1.5) * 0.06;

  col *= lit * ao * rim * shade;
  float glowEdge = smoothstep(0.82, 1.0, aa) * (0.4 + 0.6 * smoothstep(1.0, 1.4, stretch));
  col += uGlow * glowEdge * (accent ? 0.05 : 0.09);
  col = mix(col, toneOf(vTone) * (0.9 + 0.1 * grain), smoothstep(0.3, 0.9, vFray) * 0.6);

  outColor = vec4(col, 1.0);
}
`;
