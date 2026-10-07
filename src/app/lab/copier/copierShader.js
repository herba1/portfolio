export const COPIER_VERTEX = `#version 300 es
out vec2 vUv;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const PRINT_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uSource;
uniform sampler2D uLedger;
uniform vec2 uSheet;
uniform vec2 uSourceSize;
uniform vec2 uSourceBase;
uniform float uPrinted;
uniform float uFlip;
uniform float uLid;
uniform float uThreshold;
uniform float uContrast;
uniform float uGrain;
uniform float uStreaks;
uniform float uGeneration;
uniform float uPreset;
uniform float uSeed;
uniform float uDrum;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uInkB;

in vec2 vUv;
out vec4 fragColor;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), u);
}

float fbm1(float x) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * noise1(x);
    x = x * 2.03 + 17.1;
    amplitude *= 0.5;
  }
  return value;
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm2(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    value += amplitude * noise2(p);
    p = p * 2.07 + vec2(11.3, 7.9);
    amplitude *= 0.5;
  }
  return value;
}

vec2 toLocal(vec2 p, vec4 pose) {
  vec2 d = p - pose.xy;
  float c = cos(pose.z);
  float s = sin(pose.z);
  return vec2(c * d.x + s * d.y, -s * d.x + c * d.y) / max(pose.w, 1e-3);
}

float edgeDistance(vec2 local, float scale) {
  vec2 e = abs(local) - uSourceBase * 0.5;
  return (length(max(e, 0.0)) + min(max(e.x, e.y), 0.0)) * scale;
}

float lumaLocal(vec2 local, float scale, float lod) {
  vec2 uv = local / uSourceBase + 0.5;
  vec3 c = textureLod(uSource, uv, lod).rgb;
  float inside = 1.0 - smoothstep(-0.75, 0.75, edgeDistance(local, scale));
  return mix(1.0, dot(c, vec3(0.299, 0.587, 0.114)), inside);
}

vec4 ledgerAt(float y) {
  float last = max(uPrinted - 1.0, 0.0);
  float r = clamp(y - 0.5, 0.0, last);
  float r0 = floor(r);
  float r1 = min(r0 + 1.0, floor(last));
  vec4 a = texelFetch(uLedger, ivec2(0, int(r0)), 0);
  vec4 b = texelFetch(uLedger, ivec2(0, int(r1)), 0);
  return mix(a, b, r - r0);
}

vec2 skewSheet(vec2 p) {
  vec2 centre = uSheet * 0.5;
  float angle = 0.0052;
  float c = cos(angle);
  float s = sin(angle);
  vec2 d = p - centre;
  return centre + vec2(c * d.x - s * d.y, s * d.x + c * d.y) + vec2(0.0, 1.5);
}

float darknessAt(vec2 p, vec4 pose, float lod) {
  vec2 local = toLocal(p, pose);
  float c = cos(pose.z);
  float s = sin(pose.z);
  float spread = 0.9 / max(pose.w, 1e-3);
  vec2 stepX = vec2(c, -s) * spread;
  vec2 stepY = vec2(s, c) * spread;
  float centre = lumaLocal(local, pose.w, lod);
  float ring = lumaLocal(local + stepX, pose.w, lod)
    + lumaLocal(local - stepX, pose.w, lod)
    + lumaLocal(local + stepY, pose.w, lod)
    + lumaLocal(local - stepY, pose.w, lod);
  float darkness = 1.0 - (centre * 0.4 + ring * 0.15);
  float edge = edgeDistance(local, pose.w);
  float lidLine = exp(-pow((edge - 1.4) / 1.1, 2.0)) * uLid;
  return max(darkness, lidLine * 0.82);
}

float tonerDensity(float darkness, vec2 p, float shift, float salt) {
  float gen = min(uGeneration, 12.0);
  vec2 cell = floor(p / 1.5);
  float grain = hash12(cell + uSeed * 13.7 + salt) - 0.5;
  float width = mix(0.24, 0.022, uContrast);
  float threshold = uThreshold - 0.028 * gen + shift;
  float drift = smoothstep(0.56, 0.86, fbm1(p.x * 0.03 + uDrum)) * 0.5;
  float scratch = step(0.9965, hash11(floor(p.x / 1.5) + uDrum * 7.0));
  float streak = (drift + scratch) * uStreaks * (0.12 + 0.05 * gen);
  float d = darkness + grain * uGrain * (0.17 + 0.035 * gen) + streak;
  float density = smoothstep(threshold - width, threshold + width, d);
  float speck = step(1.0 - (0.0022 + 0.0018 * gen) * uGrain, hash12(cell + uSeed * 3.1 + salt));
  density = max(density, speck * 0.86);
  float mottle = noise2(p * 0.09 + uSeed + salt);
  density *= 0.9 + 0.1 * mottle;
  return clamp(density, 0.0, 1.0);
}

vec3 paperAt(vec2 p) {
  float fibre = fbm2(p * vec2(0.05, 0.012) + uDrum) - 0.47;
  float tooth = hash12(floor(p) + 91.0) - 0.5;
  return uPaper * (1.0 + fibre * 0.034 + tooth * 0.012);
}

vec3 copyColour(vec2 p) {
  vec4 pose = ledgerAt(p.y);
  vec2 sp = skewSheet(p);
  if (uPreset > 1.5 && uPreset < 2.5) {
    sp.y = (floor(sp.y / 3.0) + 0.5) * 3.0;
  }
  float lod = max(log2(uSourceSize.x / (uSourceBase.x * max(pose.w, 1e-3))), 0.0) + 0.55 + 0.32 * min(uGeneration, 8.0);
  vec3 paper = paperAt(p);

  if (uPreset > 0.5 && uPreset < 1.5) {
    float blueDark = darknessAt(sp + vec2(0.75, 0.0), pose, lod);
    float pinkDark = darknessAt(sp - vec2(0.75, 0.5), pose, lod);
    float blue = tonerDensity(blueDark, p, 0.02, 0.0);
    float pink = tonerDensity(pinkDark, p, -0.2, 41.0);
    vec3 colour = paper * mix(vec3(1.0), uInk, blue * 0.94);
    return colour * mix(vec3(1.0), uInkB, pink * 0.9);
  }

  float darkness = darknessAt(sp, pose, lod);
  float density = tonerDensity(darkness, p, 0.0, 0.0);

  if (uPreset > 1.5 && uPreset < 2.5) {
    float band = hash11(floor(p.y / 3.0) + uSeed);
    float dropout = step(0.985, hash11(floor(p.y / 3.0) * 1.7 + uDrum));
    density *= (0.8 + 0.2 * band) * (1.0 - dropout * 0.7);
    vec3 thermal = paper * (1.0 - 0.025 * band);
    return mix(thermal, uInk, density * 0.92);
  }

  if (uPreset > 2.5) {
    vec3 haze = mix(paper, uInk, 0.05 + 0.04 * fbm2(p * 0.01 + uSeed));
    return mix(haze, uInk, density * 0.9);
  }

  return mix(paper, uInk, density);
}

void main() {
  vec2 p = vec2(vUv.x, mix(1.0 - vUv.y, vUv.y, uFlip)) * uSheet;
  fragColor = vec4(clamp(copyColour(p), 0.0, 1.0), 1.0);
}
`;

export const DISPLAY_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uSource;
uniform sampler2D uPrint;
uniform vec2 uSheet;
uniform vec2 uSourceBase;
uniform vec4 uPose;
uniform float uPrinted;
uniform float uLamp;
uniform float uLampGlow;
uniform float uPxPerCss;
uniform float uAppear;
uniform float uGrab;
uniform float uFresh;
uniform vec3 uPaper;
uniform vec3 uPlaten;
uniform vec3 uInkRing;

in vec2 vUv;
out vec4 fragColor;

vec2 toLocal(vec2 p, vec4 pose) {
  vec2 d = p - pose.xy;
  float c = cos(pose.z);
  float s = sin(pose.z);
  return vec2(c * d.x + s * d.y, -s * d.x + c * d.y) / max(pose.w, 1e-3);
}

float edgeDistance(vec2 local, float scale) {
  vec2 e = abs(local) - uSourceBase * 0.5;
  return (length(max(e, 0.0)) + min(max(e.x, e.y), 0.0)) * scale;
}

vec3 platenColour(vec2 p) {
  vec2 local = toLocal(p, uPose);
  vec2 uv = local / uSourceBase + 0.5;
  vec3 picture = texture(uSource, uv).rgb;
  float edge = edgeDistance(local, uPose.w);
  float inside = (1.0 - smoothstep(-0.8, 0.8, edge)) * uAppear;
  vec3 colour = mix(uPlaten, picture, inside);
  float ringOffset = 4.0 * uPxPerCss;
  float ringHalf = 0.75 * uPxPerCss;
  float ring = 1.0 - smoothstep(ringHalf - 0.8, ringHalf + 0.8, abs(edge - ringOffset));
  return mix(colour, uInkRing, ring * uGrab * uAppear * 0.9);
}

vec3 applyLamp(vec3 colour, vec2 p) {
  float dy = (p.y - uLamp) / uPxPerCss;
  float halo = exp(-dy * dy / (2.0 * 10.0 * 10.0));
  float core = exp(-dy * dy / (2.0 * 1.4 * 1.4));
  float spill = exp(-max(dy, 0.0) / 36.0) * step(0.0, dy);
  colour *= mix(vec3(1.0), vec3(0.8, 0.965, 0.9), halo * 0.8 * uLampGlow);
  colour = mix(colour, vec3(1.0), core * 0.96 * uLampGlow);
  colour += vec3(0.03, 0.07, 0.05) * spill * uLampGlow;
  return colour;
}

void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uSheet;
  vec3 colour = platenColour(p);
  if (p.y < uPrinted) {
    vec3 printed = texelFetch(uPrint, ivec2(gl_FragCoord.xy), 0).rgb;
    float fresh = clamp((uPrinted - p.y) / max(uFresh, 0.001), 0.0, 1.0);
    fresh = mix(0.5, 1.0, fresh * fresh * (3.0 - 2.0 * fresh));
    colour = mix(uPaper, printed, fresh);
  }
  colour = applyLamp(colour, p);
  fragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}
`;
