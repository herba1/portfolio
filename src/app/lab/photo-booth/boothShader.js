export const STRIP_VERTEX = `#version 300 es
in vec2 aPos;
in vec2 aUv;
in float aBend;
uniform vec2 uRes;
uniform vec2 uOffset;
out vec2 vUv;
out float vBend;
out float vScreenY;
void main() {
  vec2 p = aPos + uOffset;
  vScreenY = p.y;
  vec2 c = p / uRes * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
  vUv = aUv;
  vBend = aBend;
}
`;

export const STRIP_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
in float vBend;
in float vScreenY;
uniform float uMouth;
uniform sampler2D uTex;
uniform float uW;
uniform float uLen;
uniform float uPerf;
uniform vec4 uCut;
uniform vec3 uTear;
uniform float uWet;
uniform float uSeed;
uniform float uGloss;
out vec4 outColor;

float hash1(float n) {
  return fract(sin(n * 12.9898 + uSeed * 78.233) * 43758.5453);
}

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed * 17.13) * 43758.5453);
}

float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash1(i), hash1(i + 1.0), u);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash2(i);
  float b = hash2(i + vec2(1.0, 0.0));
  float c = hash2(i + vec2(0.0, 1.0));
  float d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float jag(float x) {
  return (noise1(x * 0.7) - 0.5) * 1.8 + (noise1(x * 2.9 + 7.0) - 0.5) * 0.9;
}

float fibre(float x) {
  return smoothstep(0.72, 0.95, noise1(x * 3.7 + 21.0));
}

float holeSdf(vec2 p) {
  float pitch = max(4.0, uW / 15.0);
  float hx = mod(p.x + uW * 0.5 + pitch * 0.5, pitch) - pitch * 0.5;
  vec2 q = abs(vec2(hx, p.y - uPerf)) - vec2(pitch * 0.2, 0.55);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.55;
}

void main() {
  float x = vUv.x;
  float s = vUv.y;
  float aa = max(fwidth(s), 0.25) * 0.75;
  float cov = smoothstep(-aa, aa, uW * 0.5 - abs(x));
  cov *= smoothstep(-aa, aa, uLen - s);
  cov *= smoothstep(-aa, aa, s - uCut.x);
  cov *= smoothstep(-aa, aa, s);
  cov *= smoothstep(uMouth - 0.6, uMouth + 0.6, vScreenY);
  float edgeLine = uPerf + jag(x);
  float core = 0.0;

  if (uCut.y > 0.5) {
    float hair = fibre(x) * 1.1;
    float d = s - edgeLine;
    cov *= smoothstep(-aa - hair, aa, d);
    core = max(core, 1.0 - smoothstep(0.0, 1.6, abs(d)));
  }

  if (uCut.z > 0.5) {
    float hair = fibre(x + 3.0) * 1.1;
    float d = edgeLine - s;
    cov *= smoothstep(-aa - hair, aa, d);
    core = max(core, 1.0 - smoothstep(0.0, 1.6, abs(d)));
  }

  if (uTear.x > 0.0) {
    float across = clamp(x / max(uW, 1.0) + 0.5, 0.0, 1.0);
    float along = uTear.y > 0.5 ? 1.0 - across : across;
    float behind = uTear.x - along;
    if (behind > 0.0) {
      float gap = 0.25 + behind * uTear.z;
      float d = abs(s - edgeLine) - gap;
      float hair = fibre(x) * 0.9;
      cov *= smoothstep(-aa, aa + hair, d);
      core = max(core, 1.0 - smoothstep(0.0, 1.8, d));
    }
    float tip = 1.0 - smoothstep(0.0, 0.08, abs(behind));
    core = max(core, tip * (1.0 - smoothstep(0.0, 3.0, abs(s - edgeLine))) * 0.7);
  }

  cov *= smoothstep(-aa, aa, holeSdf(vUv));
  if (cov <= 0.002) discard;

  vec2 tuv = vec2(x / max(uW, 1.0) + 0.5, s / max(uLen, 1.0));
  vec3 col = texture(uTex, tuv).rgb;

  float edgeDist = min(uW * 0.5 - abs(x), min(s - uPerf, uLen - s)) / max(uW, 1.0);
  float order = clamp(edgeDist, 0.0, 0.5) * 2.0;
  float mottle = noise2(vUv * 0.045) * 0.55 + noise2(vUv * 0.16) * 0.2;
  float wetLocal = smoothstep(0.0, 0.18, uWet * 1.5 - (1.0 - order) * 0.55 - mottle * 0.45 + 0.05);
  wetLocal *= step(0.001, uWet);

  vec3 deep = col * col * 1.06;
  col = mix(col, deep, 0.32 * wetLocal);
  col *= mix(1.0, 0.965, wetLocal);
  col = mix(col, col * vec3(0.985, 0.995, 1.01), wetLocal);

  float tooth = noise2(vUv * 0.9) - 0.5;
  col += tooth * 0.022 * (1.0 - wetLocal);

  float ripple = (noise2(vUv * vec2(0.05, 0.03)) - 0.5) * 0.12;
  float phase = vBend * 1.9 + s / max(uLen, 1.0) * 0.85 + x / max(uW, 1.0) * 0.3 - 0.42 + ripple;
  float band = exp(-clamp(phase * phase / 0.012, 0.0, 40.0));
  float broad = exp(-clamp(phase * phase / 0.09, 0.0, 40.0));
  float sheen = (band * 0.24 + broad * 0.07) * wetLocal * uGloss;
  float satin = broad * 0.035 * (1.0 - wetLocal) * uGloss;
  col += vec3(sheen + satin);

  col *= 1.0 - uCut.w * 0.3 * (1.0 - smoothstep(uCut.x, uCut.x + 10.0, s));

  vec3 paperCore = vec3(0.995, 0.99, 0.975);
  col = mix(col, paperCore, core * 0.75);

  col = clamp(col, 0.0, 1.0);
  outColor = vec4(col * cov, cov);
}
`;

export const SHADOW_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
in float vBend;
in float vScreenY;
uniform float uMouth;
uniform float uW;
uniform float uLen;
uniform float uTop;
uniform float uClip;
uniform float uBlur;
uniform float uAlpha;
out vec4 outColor;

void main() {
  float mid = (uTop + uLen) * 0.5;
  float halfLen = (uLen - uTop) * 0.5;
  vec2 q = abs(vec2(vUv.x, vUv.y - mid)) - vec2(uW * 0.5, halfLen);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float blur = max(uBlur, 0.5);
  float a = 1.0 - smoothstep(-blur * 0.5, blur, d);
  a *= a;
  a *= smoothstep(-1.0, 1.0, vUv.y - uClip);
  a *= smoothstep(uMouth - 1.0, uMouth + 3.0, vScreenY);
  a *= uAlpha;
  if (a <= 0.002) discard;
  outColor = vec4(vec3(0.16, 0.12, 0.09) * a, a);
}
`;
