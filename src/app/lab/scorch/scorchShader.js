export const SCORCH_VERTEX = `#version 300 es
out vec2 vUv;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SCORCH_FUEL = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uCover;
uniform vec4 uCrop;
uniform float uLo;
uniform float uHi;
uniform float uFuse;
uniform float uPaperFloor;
uniform float uSeed;
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float total = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    total += amplitude * valueNoise(p);
    p = p * 2.03 + 11.0;
    amplitude *= 0.5;
  }
  return total;
}
void main() {
  vec3 cover = texture(uCover, uCrop.zw + vUv * uCrop.xy).rgb;
  float lum = dot(cover, vec3(0.2126, 0.7152, 0.0722));
  float top = max(cover.r, max(cover.g, cover.b));
  float bottom = min(cover.r, min(cover.g, cover.b));
  float saturation = top > 0.0 ? (top - bottom) / top : 0.0;
  float raw = 0.7 * (1.0 - lum) + 0.3 * saturation;
  float level = clamp((raw - uLo) / max(0.08, uHi - uLo), 0.0, 1.0);
  float paperFuel = uPaperFloor + (1.0 - uPaperFloor) * level;
  float inkFuel = max(0.0, (level - 0.55) / 0.45);
  float fuel = mix(paperFuel, inkFuel, uFuse);
  vec2 q = vUv + uSeed;
  float warp = fbm(q * 5.0);
  float fibre = fbm(vec2(q.x * 46.0, q.y * 30.0) + warp * 2.4);
  fibre = clamp((fibre - 0.5) * 1.9 + 0.5, 0.0, 1.0);
  outColor = vec4(fuel, fibre, lum, 1.0);
}
`;

export const SCORCH_SIM = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uState;
uniform sampler2D uFuel;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDiffuse;
uniform float uRateBase;
uniform float uRateInk;
uniform float uGain;
uniform float uKeep;
uniform float uThresholdBase;
uniform float uThresholdFuel;
uniform float uThresholdFloor;
uniform float uFibre;
uniform float uLinger;
uniform float uMinDelta;
uniform float uFuse;
uniform vec2 uWind;
uniform vec2 uWindAt;
uniform float uWindReach;
uniform float uWindGlobal;
uniform vec4 uSources[4];
uniform int uSourceCount;

float heatAt(vec2 p) {
  return textureLod(uState, p, 0.0).g;
}

void main() {
  vec4 state = textureLod(uState, vUv, 0.0);
  vec2 toWind = vUv - uWindAt;
  float windFall = exp(-dot(toWind, toWind) / (uWindReach * uWindReach));
  vec2 wind = uWind * (windFall + uWindGlobal);
  vec2 from = vUv - wind * uDt;
  float centre = heatAt(from);
  float around = heatAt(from + vec2(uTexel.x, 0.0)) + heatAt(from - vec2(uTexel.x, 0.0)) + heatAt(from + vec2(0.0, uTexel.y)) + heatAt(from - vec2(0.0, uTexel.y));
  float heat = centre + (around - 4.0 * centre) * uDiffuse;
  float burn = state.r;
  vec4 fuelSample = textureLod(uFuel, vUv, 0.0);
  float fuel = fuelSample.r;
  float threshold = max(uThresholdFloor, uThresholdBase - uThresholdFuel * fuel + uFibre * (fuelSample.g - 0.5));
  threshold += uFuse * step(fuel, 0.04) * 99.0;
  if (heat > threshold && burn < 1.0) {
    float linger = 1.0 - (1.0 - uLinger) * smoothstep(0.55, 0.9, burn);
    float oxygen = 1.0 + 0.6 * clamp(length(wind) * 2.0, 0.0, 1.0);
    float delta = min(1.0 - burn, max(uMinDelta, (uRateBase + uRateInk * fuel * fuel) * linger * oxygen * uDt));
    burn += delta;
    heat += uGain * delta;
  }
  for (int index = 0; index < 4; index++) {
    if (index >= uSourceCount) break;
    vec4 source = uSources[index];
    float reach = max(source.z, 0.0001);
    float d = distance(vUv, source.xy);
    heat = max(heat, source.w * (1.0 - smoothstep(reach * 0.45, reach, d)));
  }
  heat = clamp(heat * uKeep, 0.0, 2.0);
  outColor = vec4(burn, heat, 0.0, max(state.a, heat));
}
`;

export const SCORCH_GLOW = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uState;
uniform vec2 uTapStep;

void main() {
  vec4 sum = vec4(0.0);
  float hottest = 0.0;
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      vec2 offset = vec2(float(x), float(y)) - 1.5;
      vec4 s = textureLod(uState, vUv + offset * uTapStep, 0.0);
      sum += vec4(s.r, s.g, 0.0, smoothstep(0.5, 0.92, s.r));
      hottest = max(hottest, s.g);
    }
  }
  sum *= 0.0625;
  outColor = vec4(sum.r, sum.g, hottest, sum.a);
}
`;

export const SCORCH_STATS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uGlow;
uniform vec2 uGlowTexel;

void main() {
  float burnt = 0.0;
  float heat = 0.0;
  float hottest = 0.0;
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      vec2 offset = vec2(float(x), float(y)) - 1.5;
      vec4 g = textureLod(uGlow, vUv + offset * uGlowTexel, 0.0);
      burnt += g.a;
      heat += g.g;
      hottest = max(hottest, g.b);
    }
  }
  outColor = vec4(burnt * 0.0625, clamp(hottest * 0.5, 0.0, 1.0), clamp(heat * 0.0625 * 4.0, 0.0, 1.0), 1.0);
}
`;

export const SCORCH_DISPLAY = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uState;
uniform sampler2D uGlow;
uniform sampler2D uSheet;
uniform sampler2D uUnder;
uniform vec4 uSheetCrop;
uniform vec4 uUnderCrop;
uniform vec2 uResolution;
uniform vec2 uGlowTexel;
uniform float uTime;
uniform float uEmber;
uniform float uCharTone;
uniform float uHalo;
uniform float uFinish;
uniform float uFlicker;
uniform float uSeed;
uniform float uUnderReady;
uniform vec3 uPaper;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const vec3 TOAST = vec3(0.851, 0.725, 0.541);
const vec3 UMBER = vec3(0.420, 0.271, 0.157);
const vec3 CHAR = vec3(0.110, 0.090, 0.078);
const vec3 CHAR_PALE = vec3(0.318, 0.282, 0.255);
const vec3 EMBER_DEEP = vec3(1.0, 0.416, 0.102);
const vec3 EMBER_HOT = vec3(1.0, 0.769, 0.420);
const vec3 ASH = vec3(0.788, 0.761, 0.722);
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float total = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    total += amplitude * valueNoise(p);
    p = p * 2.03 + 11.0;
    amplitude *= 0.5;
  }
  return total;
}
float finishBurn(vec2 uv) {
  if (uFinish <= 0.0) return 0.0;
  float order = valueNoise(uv * 3.0 + uSeed) * 0.7 + valueNoise(uv * 9.0 - uSeed) * 0.3;
  return clamp(uFinish * 2.0 - order * 0.85, 0.0, 1.0);
}

float burnAt(vec2 uv) {
  float b = min(1.0, textureLod(uState, uv, 0.0).r + finishBurn(uv));
  if (b < 0.25) return b;
  float fray = (valueNoise(uv * 140.0 + uSeed) - 0.5) * 0.07 + (valueNoise(uv * 38.0 - uSeed) - 0.5) * 0.08;
  return b + fray * smoothstep(0.25, 0.85, b);
}

vec4 glowAt(vec2 uv) {
  vec2 spread = uGlowTexel * 0.75;
  vec4 total = texture(uGlow, uv) * 0.4;
  total += texture(uGlow, uv + vec2(spread.x, spread.y)) * 0.15;
  total += texture(uGlow, uv + vec2(-spread.x, spread.y)) * 0.15;
  total += texture(uGlow, uv + vec2(spread.x, -spread.y)) * 0.15;
  total += texture(uGlow, uv + vec2(-spread.x, -spread.y)) * 0.15;
  return total;
}

void main() {
  vec2 uv = vUv;
  vec2 pixel = 1.0 / uResolution;
  float bc = burnAt(uv);
  float slope = max(fwidth(bc), 0.0001);
  float aa = slope * 0.6;
  float hole = 0.0;
  hole += smoothstep(0.92 - aa, 0.92 + aa, burnAt(uv + vec2(0.25, 0.75) * pixel));
  hole += smoothstep(0.92 - aa, 0.92 + aa, burnAt(uv + vec2(-0.75, 0.25) * pixel));
  hole += smoothstep(0.92 - aa, 0.92 + aa, burnAt(uv + vec2(0.75, -0.25) * pixel));
  hole += smoothstep(0.92 - aa, 0.92 + aa, burnAt(uv + vec2(-0.25, -0.75) * pixel));
  hole *= 0.25;

  vec4 state = textureLod(uState, uv, 0.0);
  float finish = finishBurn(uv);
  float b = min(1.0, state.r + finish);
  float heat = max(state.g, 0.95 * smoothstep(0.0, 0.3, finish) * (1.0 - smoothstep(0.7, 1.0, finish)));
  float exposure = state.a;
  vec4 glow = glowAt(uv);

  vec3 cover = texture(uSheet, uSheetCrop.zw + uv * uSheetCrop.xy).rgb;
  float lum = dot(cover, LUMA);
  float scorch = clamp(max(smoothstep(0.0, 0.18, b), smoothstep(0.04, 0.42, exposure) * 0.75 * uHalo), 0.0, 1.0);
  vec3 toasted = mix(cover * vec3(0.93, 0.8, 0.62), TOAST * (0.55 + 0.6 * lum), 0.35);
  vec3 sheet = mix(cover, toasted, scorch);
  sheet = mix(sheet, UMBER * (0.78 + 0.45 * lum), smoothstep(0.18, 0.42, b));
  float crackle = 0.0;
  if (b > 0.4) crackle = 1.0 - smoothstep(0.0, 0.05, abs(fbm(uv * 120.0 + uSeed) - 0.5));
  vec3 charColour = mix(CHAR, CHAR_PALE, uCharTone) + crackle * 0.06;
  sheet = mix(sheet, charColour, smoothstep(0.42, 0.7, b));
  float speck = step(0.985, hash21(floor(gl_FragCoord.xy / 1.5) + uSeed * 17.0)) * smoothstep(0.72, 0.86, b);
  sheet = mix(sheet, ASH, speck * 0.7);

  float flicker = 1.0 + uFlicker * 0.08 * (hash21(floor(uv * 28.0) + floor(uTime * 12.0)) * 2.0 - 1.0);
  float rim = smoothstep(0.45, 0.85, heat) * smoothstep(0.22, 0.4, b) * (1.0 - smoothstep(0.55, 0.75, b));
  vec3 ember = min(mix(EMBER_DEEP, EMBER_HOT, smoothstep(0.7, 1.4, heat)) * 1.4 * flicker, vec3(1.0));
  sheet = mix(sheet, ember, clamp(rim * uEmber, 0.0, 1.0));

  float glowHeat = glow.g * uEmber;
  float sheetLum = dot(sheet, LUMA);
  sheet += EMBER_DEEP * glowHeat * 0.16 * 2.2 * (1.0 - sheetLum);
  sheet *= mix(vec3(1.0), vec3(1.0, 0.86, 0.7), clamp(glowHeat * 0.35, 0.0, 0.5));

  float lipDistance = (0.92 - bc) / slope;
  float lip = 1.0 - smoothstep(0.6, 1.8, lipDistance);
  sheet = mix(sheet, CHAR * 0.6, lip * 0.85);

  vec3 under = mix(uPaper, texture(uUnder, uUnderCrop.zw + uv * uUnderCrop.xy).rgb, uUnderReady);
  float soot = (1.0 - smoothstep(0.7, 0.98, glow.r)) * 0.22;
  under *= 1.0 - soot;
  under += EMBER_DEEP * glowHeat * 0.12;

  vec3 colour = mix(sheet, under, hole);
  float grain = hash21(gl_FragCoord.xy + uSeed * 31.0) - 0.5;
  colour += grain * 0.035 * (1.0 - hole * 0.6);
  colour += (hash21(gl_FragCoord.yx * 1.31 + 7.0) - 0.5) / 255.0;
  outColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}
`;
