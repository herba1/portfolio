export const vertex = `#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const fragment = `#version 300 es
precision highp float;
uniform sampler2D uField;
uniform sampler2D uLut;
uniform sampler2D uLutFixed;
uniform vec2 uRes;
uniform vec4 uPaper;
uniform vec2 uFieldSize;
uniform float uFix;
uniform float uDiffusion;
uniform float uHalation;
uniform float uWashout;
uniform float uRagged;
uniform float uGrain;
uniform float uSeed;
uniform float uScale;
uniform vec3 uTable;
out vec4 outColor;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  vec2 eased = local * local * (3.0 - 2.0 * local);
  float a = hash(cell);
  float b = hash(cell + vec2(1.0, 0.0));
  float c = hash(cell + vec2(0.0, 1.0));
  float d = hash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, eased.x), mix(c, d, eased.x), eased.y);
}

float sdBox(vec2 p, vec2 b) {
  vec2 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

float field(vec2 uv) {
  return texture(uField, uv).r;
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 center = uPaper.xy + uPaper.zw * 0.5;
  vec2 half_ = uPaper.zw * 0.5;
  float d = sdBox(frag - center, half_);
  vec2 tableP = frag / uScale;
  float linen = valueNoise(tableP * 0.9) * 0.5 + valueNoise(tableP * 0.23) * 0.5;
  vec3 table = uTable * (0.985 + 0.03 * linen);
  float shadow = exp(-max(sdBox(frag - center - vec2(1.0, 2.0) * uScale, half_), 0.0) / (5.0 * uScale)) * 0.12;
  table *= 1.0 - shadow;
  if (d > 0.5) {
    outColor = vec4(table, 1.0);
    return;
  }
  vec2 uv = (frag - uPaper.xy) / uPaper.zw;
  vec2 texel = 1.0 / uFieldSize;
  vec2 pixel = uv * uFieldSize;
  vec2 seedOffset = vec2(uSeed * 17.13, uSeed * -9.71);
  float centerTone = field(uv);
  float jitter = hash(frag + seedOffset + 3.7) * 6.2831853;
  float jc = cos(jitter);
  float js = sin(jitter);
  float blurSum = centerTone;
  float brightSum = smoothstep(0.6, 1.0, centerTone) * centerTone;
  float weightSum = 1.0;
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float r = sqrt((fi + 0.5) / 16.0);
    float a = fi * 2.399963229728653;
    vec2 tap = vec2(cos(a), sin(a)) * r;
    vec2 rotated = vec2(jc * tap.x - js * tap.y, js * tap.x + jc * tap.y);
    float t = field(uv + rotated * texel * 3.2);
    blurSum += t;
    brightSum += smoothstep(0.6, 1.0, t) * t;
    weightSum += 1.0;
  }
  float blurred = blurSum / weightSum;
  float bright = brightSum / weightSum;
  float tone = mix(centerTone, blurred, uDiffusion);
  tone = clamp((tone - 0.5) * 1.06 + 0.5, 0.0, 1.0);
  tone += bright * uHalation;
  float coarse = valueNoise(pixel / 7.0 * 3.0 + seedOffset) * 0.65 + valueNoise(pixel / 2.2 * 3.0 + seedOffset * 1.7) * 0.35;
  float washThreshold = 1.0 - uWashout * 0.85;
  float washed = smoothstep(washThreshold - 0.05, washThreshold + 0.05, tone + (coarse - 0.5) * uRagged * 0.6) * min(uWashout * 20.0, 1.0);
  tone = mix(tone, 1.0, washed);
  float shortSide = min(uFieldSize.x, uFieldSize.y);
  float edgeDistance = min(min(pixel.x, uFieldSize.x - pixel.x), min(pixel.y, uFieldSize.y - pixel.y)) / shortSide;
  float wobble = valueNoise(pixel / shortSide * 9.0 + seedOffset) * 0.12;
  float burn = (1.0 - smoothstep(0.0, 0.1 + wobble, edgeDistance)) * 0.55 * uFix;
  tone *= 1.0 - burn * 0.85;
  vec2 grainCoord = frag / (1.6 * uScale) + seedOffset * 3.1;
  float grain = valueNoise(grainCoord) * 0.6 + hash(floor(grainCoord * 1.9)) * 0.4 - 0.5;
  float midtones = 0.35 + tone * (1.0 - tone) * 2.6;
  tone = clamp(tone + grain * uGrain * midtones, 0.0, 1.0);
  vec3 live = texture(uLut, vec2(tone, 0.5)).rgb;
  vec3 fixedTone = texture(uLutFixed, vec2(tone, 0.5)).rgb;
  vec3 color = mix(live, fixedTone, uFix);
  float rim = smoothstep(-1.5 * uScale, 0.0, d);
  color = mix(color, color * 0.92, rim);
  float aa = clamp(0.5 - d, 0.0, 1.0);
  outColor = vec4(mix(table, color, aa), 1.0);
}
`;
