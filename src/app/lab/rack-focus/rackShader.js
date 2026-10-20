export const QUAD_VS = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uSize;
uniform vec2 uSourceSize;
uniform float uRadius;
uniform float uBreath;
uniform int uAlpha;
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  uv = 0.5 + (uv - 0.5) / uBreath;
  vec2 texel = 1.0 / uSourceSize;
  float spacing = uRadius * 0.28;
  float lod = log2(max(spacing, 1.0));
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 44; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / 44.0) * uRadius;
    float a = fi * 2.39996323;
    vec2 o = vec2(cos(a), sin(a)) * r * texel;
    acc += textureLod(uSource, uv + o, lod);
  }
  acc /= 44.0;
  if (uAlpha == 1) outColor = vec4(acc.a, 0.0, 0.0, 1.0);
  else outColor = vec4(acc.rgb, 1.0);
}
`;

export const SPRITE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aLight;
layout(location = 2) in vec4 aColor;
uniform vec2 uStage;
uniform float uPhi;
uniform float uK;
uniform float uBreath;
uniform float uPx;
out vec2 vLocal;
out float vR;
out float vStreak;
out vec3 vColor;
out float vBehind;
out vec2 vEdge;
out vec3 vBase;

void main() {
  vec2 center = uStage * 0.5;
  vec2 pos = center + (aLight.xy - center) * uBreath;
  float inv = 1.0 / aLight.z;
  float coc = uK * abs(inv - uPhi);
  float streak = aColor.w;
  float r = max(coc, streak > 0.0 ? 2.2 + streak * 0.05 : 1.15 / uPx);
  float halo = 12.0 + r * 0.5;
  vec2 half_ = vec2(r + halo, r + halo + streak);
  vec2 local = aCorner * half_;
  vec2 p = pos + local;
  vLocal = local;
  vR = r;
  vStreak = streak;
  float area = 3.14159 * r * r + 4.0 * r * streak;
  vColor = aColor.rgb * aLight.w / max(area, 1.0);
  vBehind = inv < uPhi ? 1.0 : 0.0;
  vec2 halfDiag = center * 1.04;
  vEdge = (pos - center) / length(halfDiag);
  vBase = aColor.rgb * aLight.w;
  vec2 clip = p / uStage * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`;

export const SPRITE_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vR;
in float vStreak;
in vec3 vColor;
in float vBehind;
in vec2 vEdge;
in vec3 vBase;
uniform float uBlades;
uniform float uRot;
uniform float uPx;
uniform float uOut;
out vec4 outColor;

void main() {
  vec2 p = vLocal;
  p.y = sign(p.y) * max(abs(p.y) - vStreak, 0.0);
  vec2 q = p / vR;
  float ang = atan(q.y, q.x) - uRot;
  float sector = 6.2831853 / uBlades;
  float local = mod(ang, sector) - sector * 0.5;
  float polyR = cos(3.14159265 / uBlades) / cos(local);
  float big = smoothstep(2.5, 12.0, vR);
  float d = length(q) / mix(1.0, polyR, 0.42 * big);
  float edge2 = dot(vEdge, vEdge);
  vec2 cat = vEdge * 0.62 * edge2 * big;
  float d2 = length(q + cat);
  float aa = (vStreak > 0.0 ? 0.35 : 1.3 / max(vR * uPx, 1.0));
  float disc = smoothstep(1.0, 1.0 - aa, d) * smoothstep(1.0, 1.0 - aa, d2);
  float rim = smoothstep(0.5, 0.98, max(d, d2));
  float shape = vBehind > 0.5 ? mix(0.8, 1.42, rim) : mix(1.12, 0.72, rim);
  shape = mix(1.0, shape, big);
  float ripple = 1.0 + 0.045 * big * sin(d * vR * 0.75);
  vec3 tint = vBehind > 0.5 ? vec3(0.78, 1.06, 1.18) : vec3(1.18, 0.84, 1.06);
  vec3 fringe = mix(vec3(1.0), tint, rim * 0.7 * smoothstep(5.0, 24.0, vR));
  vec3 col = vColor * disc * shape * ripple * fringe;
  float dist = length(p);
  float reach = vR + 12.0 + vR * 0.5;
  float window_ = 1.0 - smoothstep(0.45, 1.0, dist / reach);
  float glow = 0.0007 / (1.0 + vR * 0.15) * exp(-max(dist - vR * 0.8, 0.0) / (3.0 + vR * 0.16)) * window_;
  col += vBase * glow * vec3(1.0, 0.8, 0.72);
  outColor = vec4(col * uOut, 1.0);
}
`;

export const COMPOSE_FS = `#version 300 es
precision highp float;
uniform sampler2D uBg;
uniform sampler2D uBgBlur;
uniform sampler2D uType;
uniform sampler2D uTypeBlur;
uniform sampler2D uLights;
uniform vec2 uRes;
uniform float uBreath;
uniform float uBgRadius;
uniform float uTypeRadius;
uniform float uLightScale;
uniform float uExposure;
uniform float uFade;
out vec4 outColor;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 toSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 uvT = vec2(uv.x, 1.0 - uv.y);
  vec2 bUv = 0.5 + (uvT - 0.5) / uBreath;
  vec3 bgSharp = texture(uBg, bUv).rgb;
  vec3 bgSoft = texture(uBgBlur, uvT).rgb;
  vec3 bg = mix(bgSharp, bgSoft, smoothstep(0.6, 2.2, uBgRadius));
  float tSharp = texture(uType, bUv).a;
  float tSoft = texture(uTypeBlur, uvT).r;
  float soft = smoothstep(0.6, 2.2, uTypeRadius);
  float typeA = mix(tSharp, tSoft, soft);
  float melt = smoothstep(4.0, 40.0, uTypeRadius);
  vec3 lights = texture(uLights, uv).rgb * uLightScale;
  vec3 col = bg * 0.9 + lights;
  col *= uExposure;
  col = aces(col);
  vec3 typeCol = vec3(0.86, 0.85, 0.83);
  col = mix(col, typeCol, typeA * mix(1.0, 0.4, melt));
  col = min(col + typeCol * typeA * 0.1 * melt, vec3(1.0));
  vec2 c = uv - 0.5;
  col *= 1.0 - 0.32 * smoothstep(0.25, 0.85, length(c * vec2(uRes.x / uRes.y, 1.0)) * 0.9);
  vec3 srgb = toSrgb(col);
  float g = hash(gl_FragCoord.xy) + hash(gl_FragCoord.xy + 17.31) - 1.0;
  float lum = dot(srgb, vec3(0.299, 0.587, 0.114));
  srgb += g * mix(0.05, 0.018, lum);
  srgb *= uFade;
  outColor = vec4(srgb, 1.0);
}
`;
