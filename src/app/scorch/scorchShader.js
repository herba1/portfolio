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
uniform float uWindCool;
uniform vec4 uSources[8];
uniform int uSourceCount;
uniform vec4 uFlames[4];
uniform vec4 uFlameShapes[4];
uniform int uFlameCount;
uniform sampler2D uGone;
uniform float uMaskSize;
uniform float uHoleHeat;

float heatAt(vec2 p) {
  return textureLod(uState, p, 0.0).g;
}

float goneAt(vec2 p) {
  int last = int(uMaskSize) - 1;
  ivec2 cell = clamp(ivec2(floor(p * uMaskSize)), ivec2(0), ivec2(last));
  return step(0.5 / 255.0, texelFetch(uGone, cell, 0).r);
}

float neighbourHeat(vec2 p, float centre) {
  return mix(heatAt(p), centre, goneAt(p));
}

void main() {
  vec4 state = textureLod(uState, vUv, 0.0);
  if (goneAt(vUv) > 0.5) {
    outColor = state;
    return;
  }
  vec2 toWind = vUv - uWindAt;
  float windFall = exp(-dot(toWind, toWind) / (uWindReach * uWindReach));
  vec2 wind = uWind * (windFall + uWindGlobal);
  vec2 from = vUv - wind * uDt;
  float centre = mix(heatAt(from), state.g, goneAt(from));
  float around = neighbourHeat(from + vec2(uTexel.x, 0.0), centre) + neighbourHeat(from - vec2(uTexel.x, 0.0), centre) + neighbourHeat(from + vec2(0.0, uTexel.y), centre) + neighbourHeat(from - vec2(0.0, uTexel.y), centre);
  float heat = centre + (around - 4.0 * centre) * uDiffuse;
  float burn = state.r;
  float holeDamp = mix(1.0, uHoleHeat, smoothstep(0.85, 0.95, burn));
  float burnEast = textureLod(uState, vUv + vec2(uTexel.x, 0.0), 0.0).r;
  float burnWest = textureLod(uState, vUv - vec2(uTexel.x, 0.0), 0.0).r;
  float burnNorth = textureLod(uState, vUv + vec2(0.0, uTexel.y), 0.0).r;
  float burnSouth = textureLod(uState, vUv - vec2(0.0, uTexel.y), 0.0).r;
  vec2 burnSlope = vec2(burnEast - burnWest, burnNorth - burnSouth);
  float slopeLength = length(burnSlope);
  float windAlong = dot(wind, burnSlope / (slopeLength + 1e-5));
  float headwind = max(0.0, windAlong) * step(1e-3, slopeLength);
  heat *= exp(-uWindCool * headwind * uDt);
  float tailwind = step(windAlong, 0.0) * step(1e-3, slopeLength);
  vec4 fuelSample = textureLod(uFuel, vUv, 0.0);
  float fuel = fuelSample.r;
  float threshold = max(uThresholdFloor, uThresholdBase - uThresholdFuel * fuel + uFibre * (fuelSample.g - 0.5));
  threshold += uFuse * step(fuel, 0.04) * 99.0;
  if (heat > threshold && burn < 1.0) {
    float linger = 1.0 - (1.0 - uLinger) * smoothstep(0.55, 0.9, burn);
    float oxygen = 1.0 + 0.6 * tailwind * clamp(-windAlong * 2.0, 0.0, 1.0);
    float delta = min(1.0 - burn, max(uMinDelta, (uRateBase + uRateInk * fuel * fuel) * linger * oxygen * uDt));
    burn += delta;
    heat += uGain * (0.3 + 0.7 * fuel) * delta;
  }
  for (int index = 0; index < 8; index++) {
    if (index >= uSourceCount) break;
    vec4 source = uSources[index];
    vec2 toSource = vUv - source.xy;
    float lobe = (atan(toSource.y, toSource.x) + 3.14159265) * 2.2281692;
    float lobeCell = mod(floor(lobe), 14.0);
    float lobeSeed = dot(source.xy, vec2(91.7, 37.3));
    float lobeNear = fract(sin(lobeCell + lobeSeed) * 43758.5453);
    float lobeFar = fract(sin(mod(lobeCell + 1.0, 14.0) + lobeSeed) * 43758.5453);
    float lobeBlend = fract(lobe);
    lobeBlend = lobeBlend * lobeBlend * (3.0 - 2.0 * lobeBlend);
    float ragged = (0.78 + 0.44 * mix(lobeNear, lobeFar, lobeBlend)) * mix(0.9, 1.1, fuelSample.g);
    float reach = max(source.z * ragged, 0.0001);
    float d = length(toSource);
    heat = max(heat, source.w * (1.0 - smoothstep(reach * 0.45, reach, d)));
  }
  for (int index = 0; index < 4; index++) {
    if (index >= uFlameCount) break;
    vec4 segment = uFlames[index];
    vec4 shape = uFlameShapes[index];
    vec2 span = segment.zw - segment.xy;
    vec2 fromStart = vUv - segment.xy;
    float along = clamp(dot(fromStart, span) / max(dot(span, span), 1e-8), 0.0, 1.0);
    float gap = length(fromStart - span * along);
    float flameReach = shape.x * mix(0.8, 1.2, fuelSample.g);
    float touch = 1.0 - smoothstep(flameReach * 0.3, flameReach, gap);
    heat += max(0.0, min(shape.z - heat, shape.y * touch * holeDamp));
    burn = min(1.0, burn + shape.w * touch);
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
uniform sampler2D uGone;
uniform float uMaskSize;

float goneAt(vec2 p) {
  int last = int(uMaskSize) - 1;
  ivec2 cell = clamp(ivec2(floor(p * uMaskSize)), ivec2(0), ivec2(last));
  return step(0.5 / 255.0, texelFetch(uGone, cell, 0).r);
}

void main() {
  vec4 sum = vec4(0.0);
  float hottest = 0.0;
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      vec2 offset = vec2(float(x), float(y)) - 1.5;
      vec2 tap = vUv + offset * uTapStep;
      vec4 s = textureLod(uState, tap, 0.0);
      float gone = goneAt(tap);
      float heat = s.g * (1.0 - gone);
      sum += vec4(s.r, heat, 0.0, smoothstep(0.5, 0.92, s.r));
      hottest = max(hottest, heat);
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
uniform float uFlicker;
uniform float uSeed;
uniform float uUnderReady;
uniform vec3 uPaper;
uniform sampler2D uGone;
uniform float uMaskSize;
uniform float uFreshFrom;
uniform float uFreshTo;
uniform float uLayer;
uniform float uCorner;
uniform float uCurlShift;
uniform float uCurlSlope;
uniform float uCurlShade;
uniform float uCurlShadow;
uniform float uShadowReach;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const vec3 TOAST = vec3(0.851, 0.725, 0.541);
const vec3 UMBER = vec3(0.420, 0.271, 0.157);
const vec3 CHAR = vec3(0.110, 0.090, 0.078);
const vec3 CHAR_PALE = vec3(0.318, 0.282, 0.255);
const vec3 EMBER_DEEP = vec3(1.0, 0.416, 0.102);
const vec3 EMBER_HOT = vec3(1.0, 0.769, 0.420);
const vec3 ASH = vec3(0.788, 0.761, 0.722);
const vec3 LIGHT = vec3(-0.3814, 0.5220, 0.7629);
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
float burnAt(vec2 uv) {
  float b = textureLod(uState, uv, 0.0).r;
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

float labelAt(ivec2 cell) {
  int last = int(uMaskSize) - 1;
  return floor(texelFetch(uGone, clamp(cell, ivec2(0), ivec2(last)), 0).r * 255.0 + 0.5);
}

float goneCover(vec2 uv) {
  vec2 grid = uv * uMaskSize - 0.5;
  vec2 base = floor(grid);
  vec2 f = grid - base;
  ivec2 cell = ivec2(base);
  float a = step(0.5, labelAt(cell));
  float b = step(0.5, labelAt(cell + ivec2(1, 0)));
  float c = step(0.5, labelAt(cell + ivec2(0, 1)));
  float d = step(0.5, labelAt(cell + ivec2(1, 1)));
  return smoothstep(0.2, 0.8, mix(mix(a, b, f.x), mix(c, d, f.x), f.y));
}

float liftAt(vec2 uv) {
  vec4 g = texture(uGlow, uv);
  return smoothstep(0.04, 0.65, mix(g.r, g.a, 0.5)) * (0.7 + 0.3 * smoothstep(0.1, 0.7, g.g));
}

void main() {
  vec2 flatUv = vUv;
  float liftEast = liftAt(flatUv + vec2(uGlowTexel.x, 0.0));
  float liftWest = liftAt(flatUv - vec2(uGlowTexel.x, 0.0));
  float liftNorth = liftAt(flatUv + vec2(0.0, uGlowTexel.y));
  float liftSouth = liftAt(flatUv - vec2(0.0, uGlowTexel.y));
  vec2 lean = 0.5 * vec2(liftEast - liftWest, liftNorth - liftSouth);
  vec2 uv = flatUv + lean * uCurlShift;
  vec3 bendNormal = normalize(vec3(-lean * uCurlSlope, 1.0));
  float bendLight = clamp(dot(bendNormal, LIGHT) / LIGHT.z, 0.6, 1.2);
  float bendShade = mix(1.0, bendLight, uCurlShade);
  vec2 casterUv = flatUv + LIGHT.xy * uShadowReach;
  float casterHole = texture(uGlow, casterUv).a;
  float casterLift = smoothstep(0.02, 0.6, casterHole) * (1.0 - smoothstep(0.55, 0.95, casterHole));
  float castShadow = uCurlShadow * casterLift;
  vec2 pixel = 1.0 / uResolution;
  vec2 halfSize = uResolution * 0.5;
  vec2 cornerOffset = abs(flatUv * uResolution - halfSize) - (halfSize - uCorner);
  float cornerDistance = length(max(cornerOffset, 0.0)) + min(max(cornerOffset.x, cornerOffset.y), 0.0) - uCorner;
  float corner = clamp(0.5 - cornerDistance, 0.0, 1.0);
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
  float b = state.r;
  float heat = state.g;
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

  float lipDistance = (0.92 - bc) / slope;
  float lip = 1.0 - smoothstep(0.6, 1.8, lipDistance);
  float grain = hash21(gl_FragCoord.xy + uSeed * 31.0) - 0.5;
  float dither = (hash21(gl_FragCoord.yx * 1.31 + 7.0) - 0.5) / 255.0;
  sheet *= bendShade;
  if (uLayer > 0.5) {
    float owner = labelAt(ivec2(floor(flatUv * uMaskSize)));
    if (owner > 0.5 && (owner < uFreshFrom - 0.5 || owner > uFreshTo + 0.5)) discard;
    vec3 layerColour = mix(sheet, CHAR * 0.6, lip * 0.85) + grain * 0.035 + dither;
    outColor = vec4(clamp(layerColour, 0.0, 1.0), (1.0 - hole) * corner);
    return;
  }

  float flicker = 1.0 + uFlicker * 0.08 * (hash21(floor(uv * 28.0) + floor(uTime * 12.0)) * 2.0 - 1.0);
  float rim = smoothstep(0.3, 0.7, heat) * smoothstep(0.22, 0.4, b) * (1.0 - smoothstep(0.55, 0.75, b));
  vec3 ember = min(mix(EMBER_DEEP, EMBER_HOT, smoothstep(0.7, 1.4, heat)) * 1.4 * flicker, vec3(1.0));
  sheet = mix(sheet, ember, clamp(rim * uEmber, 0.0, 1.0));

  float glowHeat = glow.g * uEmber;
  float sheetLum = dot(sheet, LUMA);
  sheet += EMBER_DEEP * glowHeat * 0.16 * 2.2 * (1.0 - sheetLum);
  sheet *= mix(vec3(1.0), vec3(1.0, 0.86, 0.7), clamp(glowHeat * 0.35, 0.0, 0.5));

  sheet = mix(sheet, CHAR * 0.6, lip * 0.85);

  vec3 under = mix(uPaper, texture(uUnder, uUnderCrop.zw + flatUv * uUnderCrop.xy).rgb, uUnderReady);
  under *= 1.0 - castShadow;

  float shown = hole + (1.0 - hole) * goneCover(flatUv);
  vec3 colour = mix(sheet, under, shown);
  colour += grain * 0.035 * (1.0 - shown * 0.6);
  colour += dither;
  outColor = vec4(clamp(colour, 0.0, 1.0) * corner, corner);
}
`;

export const SCORCH_MASK = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uState;
uniform float uSeed;
uniform float uTap;

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

float burnAt(vec2 uv) {
  float b = textureLod(uState, uv, 0.0).r;
  if (b < 0.25) return b;
  float fray = (valueNoise(uv * 140.0 + uSeed) - 0.5) * 0.07 + (valueNoise(uv * 38.0 - uSeed) - 0.5) * 0.08;
  return b + fray * smoothstep(0.25, 0.85, b);
}

void main() {
  vec4 state = textureLod(uState, vUv, 0.0);
  float burnt = max(max(burnAt(vUv + vec2(uTap, uTap)), burnAt(vUv + vec2(-uTap, uTap))), max(burnAt(vUv + vec2(uTap, -uTap)), burnAt(vUv + vec2(-uTap, -uTap))));
  outColor = vec4(clamp(max(burnt, burnAt(vUv)), 0.0, 1.0), clamp(state.g * 0.5, 0.0, 1.0), clamp(state.r, 0.0, 1.0), 1.0);
}
`;

export const SCORCH_DEBRIS_VERTEX = `#version 300 es
layout(location = 0) in vec4 aBox;
layout(location = 1) in vec4 aPose;
layout(location = 2) in vec4 aTurn;
layout(location = 3) in vec4 aBend;
layout(location = 4) in vec4 aMeta;
layout(location = 5) in vec4 aLook;
layout(location = 6) in vec3 aGrid;
uniform vec4 uBleed;
uniform float uAspect;
uniform float uCamera;
out vec2 vSheetUv;
out vec2 vCanvasUv;
out vec3 vNormal;
out float vAlpha;
out float vHeat;
out float vSnap;
out float vAsh;
flat out float vLabel;
flat out int vSlot;
flat out int vLayer;
flat out float vCurlSign;

const float PI = 3.14159265;

vec3 turn(vec4 q, vec3 v) {
  vec3 twist = 2.0 * cross(q.xyz, v);
  return v + q.w * twist + cross(q.xyz, twist);
}

void main() {
  vec2 extent = aBox.zw * vec2(uAspect, 1.0);
  vec2 local = aGrid.xy * extent;
  vec2 along = vec2(cos(aBend.x), sin(aBend.x));
  vec2 across = vec2(-along.y, along.x);
  float reach = max(abs(along.x) * extent.x + abs(along.y) * extent.y, 1e-4);
  float span = max(abs(across.x) * extent.x + abs(across.y) * extent.y, 1e-4);
  float s = dot(local, along);
  float t = dot(local, across);
  float curvature = aBend.y / reach;
  float bend = curvature * s;
  float run = s;
  float rise = 0.5 * curvature * s * s;
  float settle = curvature * reach * reach / 6.0;
  if (abs(curvature) > 1e-3) {
    run = sin(bend) / curvature;
    rise = (1.0 - cos(bend)) / curvature;
    settle = (1.0 - sin(aBend.y) / aBend.y) / curvature;
  }
  float waveAngle = aLook.y * PI * t / span + aBend.w;
  rise += aBend.z * span * sin(waveAngle) - settle;
  vec3 surface = vec3(along * run + across * t, rise);
  vec3 tangentAlong = vec3(along * cos(bend), sin(bend));
  vec3 tangentAcross = vec3(across, aBend.z * aLook.y * PI * cos(waveAngle));
  vec3 normal = normalize(cross(tangentAlong, tangentAcross));

  vec3 placed = turn(aTurn, surface) * aPose.z;
  float depth = uCamera - placed.z;
  vec2 projected = placed.xy * (uCamera / depth);
  projected.x /= uAspect;
  vec2 plate = aBox.xy + aPose.xy + projected;
  vCanvasUv = (plate + uBleed.xy) / uBleed.zw;
  float w = depth / uCamera;
  gl_Position = vec4((vCanvasUv * 2.0 - 1.0) * w, 0.0, w);
  vSheetUv = aBox.xy + aGrid.xy * aBox.zw;
  vNormal = turn(aTurn, normal);
  vAlpha = aPose.w;
  vHeat = aLook.x;
  vLabel = aMeta.x;
  vSlot = int(aMeta.y + 0.5);
  vSnap = aMeta.z;
  vAsh = aMeta.w;
  vLayer = int(aGrid.z + 0.5);
  vCurlSign = aLook.z;
}
`;

export const SCORCH_DEBRIS_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vSheetUv;
in vec2 vCanvasUv;
in vec3 vNormal;
in float vAlpha;
in float vHeat;
in float vSnap;
in float vAsh;
flat in float vLabel;
flat in int vSlot;
flat in int vLayer;
flat in float vCurlSign;
out vec4 outColor;
uniform sampler2D uLayerA;
uniform sampler2D uLayerB;
uniform sampler2D uRelicA;
uniform sampler2D uRelicB;
uniform float uWarmReach;
uniform sampler2D uLabelsA;
uniform sampler2D uLabelsB;
uniform float uMaskSize;
uniform float uTime;
uniform float uEmber;
uniform float uCharTone;
uniform float uFlicker;
uniform vec3 uPaper;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const vec3 TOAST = vec3(0.851, 0.725, 0.541);
const vec3 UMBER = vec3(0.420, 0.271, 0.157);
const vec3 CHAR = vec3(0.110, 0.090, 0.078);
const vec3 CHAR_PALE = vec3(0.318, 0.282, 0.255);
const vec3 EMBER_DEEP = vec3(1.0, 0.416, 0.102);
const vec3 EMBER_HOT = vec3(1.0, 0.769, 0.420);
const vec3 ASH = vec3(0.612, 0.588, 0.561);
const vec3 LIGHT = vec3(-0.3814, 0.5220, 0.7629);

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float labelAt(ivec2 cell, bool first) {
  ivec2 clamped = clamp(cell, ivec2(0), ivec2(int(uMaskSize) - 1));
  float raw = first ? texelFetch(uLabelsA, clamped, 0).r : texelFetch(uLabelsB, clamped, 0).r;
  return floor(raw * 255.0 + 0.5);
}

float ownedAt(ivec2 cell, bool first) {
  return 1.0 - step(0.5, abs(labelAt(cell, first) - vLabel));
}

float heatTap(vec2 uv, bool first) {
  return first ? textureLod(uRelicA, uv, 0.0).g : textureLod(uRelicB, uv, 0.0).g;
}

float warmthAt(vec2 uv, bool first) {
  float total = heatTap(uv + vec2(uWarmReach, uWarmReach), first);
  total += heatTap(uv + vec2(-uWarmReach, uWarmReach), first);
  total += heatTap(uv + vec2(uWarmReach, -uWarmReach), first);
  total += heatTap(uv + vec2(-uWarmReach, -uWarmReach), first);
  return total * 0.25;
}

float membership(vec2 uv, bool first) {
  vec2 grid = uv * uMaskSize - 0.5;
  vec2 base = floor(grid);
  vec2 f = grid - base;
  ivec2 cell = ivec2(base);
  float a = ownedAt(cell, first);
  float b = ownedAt(cell + ivec2(1, 0), first);
  float c = ownedAt(cell + ivec2(0, 1), first);
  float d = ownedAt(cell + ivec2(1, 1), first);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  bool printSide = gl_FrontFacing;
  bool hollowSide = (vCurlSign >= 0.0) == printSide;
  if ((vLayer == 0) != hollowSide) discard;
  vec2 uv = vSheetUv;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
  bool first = vSlot == 0;
  float owned = membership(uv, first);
  if (owned < 0.02) discard;

  vec4 layer = first ? textureLod(uLayerA, uv, 0.0) : textureLod(uLayerB, uv, 0.0);
  vec4 relic = first ? textureLod(uRelicA, uv, 0.0) : textureLod(uRelicB, uv, 0.0);
  float b = relic.r;
  float heat = relic.g * vHeat;
  float seam = 1.0 - owned;

  vec3 colour = layer.rgb;
  if (!printSide) {
    vec3 back = uPaper * 0.97;
    back = mix(back, TOAST * 0.92, smoothstep(0.02, 0.3, b) * 0.7);
    back = mix(back, UMBER * 0.9, smoothstep(0.2, 0.45, b));
    colour = mix(back, mix(CHAR, CHAR_PALE, uCharTone), smoothstep(0.42, 0.72, b));
  }
  colour = mix(colour, colour * vec3(0.86, 0.72, 0.56), smoothstep(0.0, 0.45, seam) * 0.55);
  colour = mix(colour, CHAR * 0.7, smoothstep(0.2, 0.6, seam) * 0.85);

  float flicker = 1.0 + uFlicker * 0.08 * (hash21(floor(uv * 28.0) + floor(uTime * 12.0)) * 2.0 - 1.0);
  float rim = smoothstep(0.3, 0.7, heat) * smoothstep(0.22, 0.4, b) * (1.0 - smoothstep(0.55, 0.75, b));
  float snapGlow = smoothstep(0.1, 0.5, seam) * vSnap;
  vec3 ember = min(mix(EMBER_DEEP, EMBER_HOT, smoothstep(0.7, 1.4, heat + snapGlow * 0.6)) * 1.4 * flicker, vec3(1.0));
  colour = mix(colour, ember, clamp((rim + snapGlow) * uEmber, 0.0, 1.0));
  float glowHeat = warmthAt(uv, first) * uEmber * vHeat;
  colour += EMBER_DEEP * glowHeat * 0.16 * 2.2 * (1.0 - dot(colour, LUMA));
  colour *= mix(vec3(1.0), vec3(1.0, 0.86, 0.7), clamp(glowHeat * 0.35, 0.0, 0.5));
  float speck = hash21(floor(uv * 900.0));
  colour = mix(colour, mix(ASH, CHAR_PALE, speck * 0.6), vAsh);

  vec3 facing = normalize(vNormal) * (printSide ? 1.0 : -1.0);
  float diffuse = max(dot(facing, LIGHT), 0.0);
  float shade = clamp(0.48 + 0.52 * diffuse / LIGHT.z, 0.48, 1.12);
  float graze = 1.0 - clamp(facing.z, 0.0, 1.0);
  colour *= shade * (1.0 - 0.12 * graze * graze);
  vec2 border = min(vCanvasUv, 1.0 - vCanvasUv);
  float bleedFade = smoothstep(0.0, 0.05, border.x) * smoothstep(0.0, 0.05, border.y);
  float alpha = layer.a * vAlpha * smoothstep(0.2, 0.8, owned) * bleedFade;
  outColor = vec4(clamp(colour, 0.0, 1.0) * alpha, alpha);
}
`;
