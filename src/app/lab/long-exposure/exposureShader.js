export const MAX_LAMPS = 6;
export const MAX_TAPS = 24;

export const QUAD_VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const SCENE_COMMON = `
uniform sampler2D uPhoto;
uniform vec4 uLamps[${MAX_LAMPS}];
uniform vec3 uLampTint[${MAX_LAMPS}];
uniform float uAspect;

vec3 gradeScene(vec2 uv) {
  vec2 c = clamp(uv, vec2(0.002), vec2(0.998));
  float g = texture(uPhoto, c).r;
  g = clamp(g, 0.0, 1.0);
  float lift = g * g * (3.0 - 2.0 * g);
  vec3 shadow = vec3(0.30, 0.42, 0.78);
  vec3 high = vec3(1.0, 0.86, 0.80);
  vec3 tone = mix(shadow, high, smoothstep(0.25, 0.85, g));
  float hot = max(0.0, g - 0.74) * 3.2;
  float tintX = smoothstep(0.0, 1.0, c.x);
  vec3 glowTint = mix(vec3(1.0, 0.38, 0.72), vec3(0.42, 0.62, 1.0), tintX);
  return tone * mix(g, lift, 0.4) + glowTint * hot * hot;
}

vec3 lampLight(vec2 uv) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < ${MAX_LAMPS}; i++) {
    vec4 lamp = uLamps[i];
    vec2 d = (uv - lamp.xy) * vec2(uAspect, 1.0);
    float r = max(lamp.z, 1e-4);
    float q = dot(d, d) / (r * r);
    float core = exp(-min(q * 2.2, 40.0));
    float glow = exp(-min(q * 0.05, 40.0)) * 0.035;
    sum += uLampTint[i] * lamp.w * (core + glow);
  }
  return sum;
}
`;

export const RADIANCE_FRAGMENT = `#version 300 es
precision highp float;
${SCENE_COMMON}
uniform vec2 uRes;
uniform float uSceneRate;
uniform float uLampRate;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  uv.y = 1.0 - uv.y;
  vec3 c = gradeScene(uv) * uSceneRate + lampLight(uv) * uLampRate;
  outColor = vec4(max(c, vec3(0.0)), 1.0);
}
`;

export const SCENE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uRadiance;
uniform vec2 uRes;
uniform vec2 uShakes[${MAX_TAPS}];
uniform int uTaps;
uniform float uGain;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = vec3(0.0);
  for (int i = 0; i < ${MAX_TAPS}; i++) {
    if (i >= uTaps) break;
    vec2 s = clamp(uv + vec2(uShakes[i].x, -uShakes[i].y), vec2(0.001), vec2(0.999));
    c += texture(uRadiance, s).rgb;
  }
  outColor = vec4(max(c * uGain, vec3(0.0)), 1.0);
}
`;

export const STROKE_VERTEX = `#version 300 es
in vec2 aPosition;
in vec4 aSeg;
in vec4 aProp;
in vec3 aColor;
uniform vec2 uBox;
out vec2 vLocal;
out float vLen;
out float vSigma;
out float vEnergy;
out vec3 vColor;
void main() {
  vec2 a = aSeg.xy;
  vec2 b = aSeg.zw;
  vec2 d = b - a;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float sigma = max(aProp.x, 0.2);
  float reach = sigma * 4.2 * max(aProp.z, 1.0);
  float t = aPosition.x * 0.5 + 0.5;
  vec2 along = dir * mix(-reach, len + reach, t);
  vec2 across = nrm * aPosition.y * reach;
  vec2 p = a + along + across;
  vLocal = vec2(dot(p - a, dir), dot(p - a, nrm));
  vLen = len;
  vSigma = sigma;
  vEnergy = aProp.y;
  vColor = aColor;
  vec2 clip = p / uBox * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`;

export const STROKE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vLen;
in float vSigma;
in float vEnergy;
in vec3 vColor;
out vec4 outColor;

float erfApprox(float x) {
  float s = sign(x);
  float a = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * a);
  float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-min(a * a, 30.0));
  return s * y;
}

float lineProfile(float s, float h, float len, float sigma) {
  float across = exp(-min(h * h / (2.0 * sigma * sigma), 30.0));
  float alongGauss = exp(-min(s * s / (2.0 * sigma * sigma), 30.0)) / (sigma * 2.5066283);
  if (len < sigma * 0.25) return across * alongGauss;
  float k = 0.70710678 / sigma;
  float along = 0.5 * (erfApprox(s * k) - erfApprox((s - len) * k));
  return across * along / max(len, 1e-3);
}

void main() {
  float s = vLocal.x;
  float h = vLocal.y;
  float core = lineProfile(s, h, vLen, vSigma);
  float halo = lineProfile(s, h, vLen, vSigma * 2.8);
  vec3 coreColor = mix(vColor, vec3(1.0, 0.97, 0.92), 0.35);
  vec3 c = vEnergy * (coreColor * core + vColor * halo * 0.22);
  outColor = vec4(max(c, vec3(0.0)), 1.0);
}
`;

export const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uRadiance;
uniform sampler2D uAcc;
uniform sampler2D uGhost;
uniform float uGhostMix;
uniform vec2 uRes;
uniform float uPreview;
uniform float uAccMix;
uniform float uNoise;
uniform float uSeed;
uniform float uHot;
uniform float uBloom;
uniform float uLodBase;
out vec4 outColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 tone(vec3 x) {
  vec3 c = vec3(1.0) - exp(-max(x, vec3(0.0)) * 1.15);
  float peak = max(max(x.r, x.g), x.b);
  float burn = smoothstep(1.1, 4.5, peak);
  return mix(c, vec3(1.0, 0.985, 0.96), burn * 0.85);
}

vec3 developed(sampler2D acc, vec2 tex, vec2 off) {
  float ca = 0.0028;
  vec3 c;
  c.r = texture(acc, 0.5 + off * (1.0 + ca)).r;
  c.g = texture(acc, tex).g;
  c.b = texture(acc, 0.5 + off * (1.0 - ca)).b;
  vec3 b1 = textureLod(acc, tex, uLodBase + 1.0).rgb;
  vec3 b2 = textureLod(acc, tex, uLodBase + 2.5).rgb;
  vec3 b3 = textureLod(acc, tex, uLodBase + 4.0).rgb;
  vec3 bloom = b1 * 0.10 + b2 * 0.12 + b3 * 0.10;
  float halL = dot(b2, vec3(0.3, 0.5, 0.2));
  vec3 halation = vec3(1.0, 0.32, 0.12) * halL * 0.09;
  return c + (bloom + halation) * uBloom;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 tex = uv;
  vec2 off = (uv - 0.5);
  vec3 exposure = developed(uAcc, tex, off) * uAccMix;
  if (uGhostMix > 0.001) exposure += developed(uGhost, tex, off) * uGhostMix;
  vec3 live = texture(uRadiance, tex).rgb * uPreview;
  vec3 signal = exposure + live;
  vec2 px = floor(gl_FragCoord.xy);
  float n1 = hash12(px + uSeed * 17.0) - 0.5;
  float n2 = hash12(px * 1.37 + uSeed * 31.0 + 7.0) - 0.5;
  float n3 = hash12(px * 0.91 + uSeed * 13.0 + 3.0) - 0.5;
  float lum = dot(signal, vec3(0.3, 0.55, 0.15));
  float shot = sqrt(max(lum, 0.0) + 0.004);
  vec3 grain = vec3(n1) * (0.5 + 0.5 * shot) + vec3(n2, n3 * 0.4, -n2) * 0.45;
  signal += grain * uNoise;
  float hot = hash12(px * 0.613 + uSeed);
  float hotMask = step(1.0 - uHot, hot);
  signal += hotMask * mix(vec3(0.9, 0.2, 0.25), vec3(0.3, 0.45, 1.0), hash12(px + 3.1)) * 0.5;
  vec3 c = tone(signal);
  float vig = 1.0 - 0.35 * smoothstep(0.35, 0.95, length(off * vec2(1.0, 1.1)) * 1.25);
  c *= vig;
  c = pow(max(c, vec3(0.0)), vec3(0.94));
  outColor = vec4(c, 1.0);
}
`;
