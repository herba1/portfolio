export const FULLSCREEN_VERTEX = `#version 300 es
out vec2 vUv;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const COCKLE_FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uGrid;
uniform float uSeed;
uniform float uAmount;
out vec4 outValue;

float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031 + uSeed);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  vec2 ease = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, ease.x), mix(c, d, ease.x), ease.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uGrid;
  float broad = valueNoise(uv * vec2(3.2, 4.0));
  float fine = valueNoise(uv * vec2(8.0, 10.0) + vec2(5.0, 3.0));
  outValue = vec4((broad * 0.65 + fine * 0.35 - 0.5) * uAmount, 0.0, 0.0, 1.0);
}
`;

export const RESET_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uCockle;
uniform vec2 uGrid;
uniform vec2 uLean;
uniform float uGain;
uniform float uLevel;
out vec4 outDepth;

float bedAt(ivec2 cell) {
  vec2 uv = (vec2(cell) + 0.5) / uGrid;
  return texelFetch(uCockle, cell, 0).r - uGain * (uLean.x * (uv.x - 0.5) * 0.8 + uLean.y * (uv.y - 0.5));
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  outDepth = vec4(max(uLevel - bedAt(cell), 0.0), 0.0, 0.0, 1.0);
}
`;

export const STILL_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uCockle;
uniform vec2 uGrid;
uniform vec2 uRest;
uniform vec2 uLean;
uniform float uGain;
uniform float uLevel;
uniform float uMaxShift;
uniform float uWetDepth;
out vec4 outDepth;

const float STILL_REACH = 0.6;
const float STILL_SOFTNESS = 0.035;

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec2 uv = (vec2(cell) + 0.5) / uGrid;
  float bed = texelFetch(uCockle, cell, 0).r - uGain * (uRest.x * (uv.x - 0.5) * 0.8 + uRest.y * (uv.y - 0.5));
  float pool = max(uLevel - bed, 0.0);
  vec2 shift = uLean - uRest;
  float strength = clamp(length(shift) / uMaxShift, 0.0, 1.0);
  vec2 downhill = vec2(shift.x * 0.8, shift.y);
  float size = length(downhill);
  vec2 direction = size > 0.00001 ? downhill / size : vec2(0.0, -1.0);
  float extent = 0.5 * (abs(direction.x) + abs(direction.y));
  float edge = extent * (1.0 - 2.0 * STILL_REACH * strength);
  float along = dot(uv - 0.5, direction);
  float mask = smoothstep(edge - STILL_SOFTNESS, edge + STILL_SOFTNESS, along) * smoothstep(0.02, 0.08, strength);
  outDepth = vec4(max(pool, uWetDepth * mask), 0.0, 0.0, 1.0);
}
`;

export const FLUX_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uFlux;
uniform sampler2D uHeight;
uniform sampler2D uCockle;
uniform vec2 uGrid;
uniform vec2 uLean;
uniform float uGain;
uniform float uDt;
uniform float uGravity;
uniform float uDamp;
uniform float uFriction;
uniform vec4 uPaddle;
uniform float uPaddleOn;
uniform float uPaddleRadius;
uniform float uPaddleMix;
out vec4 outFlux;

float bedAt(ivec2 cell) {
  vec2 uv = (vec2(cell) + 0.5) / uGrid;
  return texelFetch(uCockle, cell, 0).r - uGain * (uLean.x * (uv.x - 0.5) * 0.8 + uLean.y * (uv.y - 0.5));
}

float surfaceAt(ivec2 cell) {
  return texelFetch(uHeight, cell, 0).r + bedAt(cell);
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  ivec2 last = ivec2(uGrid) - 1;
  float depth = texelFetch(uHeight, cell, 0).r;
  float surface = depth + bedAt(cell);
  float keep = uDamp / (1.0 + uDt * uFriction / max(depth, 0.015));
  vec4 open = vec4(
    cell.x > 0 ? 1.0 : 0.0,
    cell.x < last.x ? 1.0 : 0.0,
    cell.y > 0 ? 1.0 : 0.0,
    cell.y < last.y ? 1.0 : 0.0
  );
  ivec2 left = max(cell - ivec2(1, 0), ivec2(0));
  ivec2 right = min(cell + ivec2(1, 0), last);
  ivec2 below = max(cell - ivec2(0, 1), ivec2(0));
  ivec2 above = min(cell + ivec2(0, 1), last);
  vec4 drop = surface - vec4(surfaceAt(left), surfaceAt(right), surfaceAt(below), surfaceAt(above));
  vec4 flux = max(texelFetch(uFlux, cell, 0) * keep + uDt * uGravity * drop, 0.0) * open;

  vec2 uv = (vec2(cell) + 0.5) / uGrid;
  vec2 offset = (uv - uPaddle.xy) * vec2(0.8, 1.0);
  float reach = uPaddleOn * exp(-dot(offset, offset) / (uPaddleRadius * uPaddleRadius));
  vec4 push = depth * vec4(max(-uPaddle.z, 0.0), max(uPaddle.z, 0.0), max(-uPaddle.w, 0.0), max(uPaddle.w, 0.0));
  flux = max(flux, mix(flux, push, reach * uPaddleMix)) * open;

  float total = flux.x + flux.y + flux.z + flux.w;
  flux *= min(1.0, depth / max(total * uDt, 0.000001));
  outFlux = flux;
}
`;

export const HEIGHT_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uFlux;
uniform sampler2D uHeight;
uniform vec2 uGrid;
uniform float uDt;
uniform float uScale;
out vec4 outDepth;

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  ivec2 last = ivec2(uGrid) - 1;
  vec4 outflow = texelFetch(uFlux, cell, 0);
  float inflow = 0.0;
  if (cell.x > 0) inflow += texelFetch(uFlux, cell - ivec2(1, 0), 0).y;
  if (cell.x < last.x) inflow += texelFetch(uFlux, cell + ivec2(1, 0), 0).x;
  if (cell.y > 0) inflow += texelFetch(uFlux, cell - ivec2(0, 1), 0).w;
  if (cell.y < last.y) inflow += texelFetch(uFlux, cell + ivec2(0, 1), 0).z;
  float depth = texelFetch(uHeight, cell, 0).r + uDt * (inflow - (outflow.x + outflow.y + outflow.z + outflow.w));
  outDepth = vec4(max(depth, 0.0) * uScale, 0.0, 0.0, 1.0);
}
`;

export const DEVELOP_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uDev;
uniform sampler2D uHeight;
uniform sampler2D uFlux;
uniform float uDt;
uniform float uRate;
uniform float uSoakDecay;
out vec4 outDev;

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec4 dev = texelFetch(uDev, cell, 0);
  float depth = texelFetch(uHeight, cell, 0).r;
  vec4 flux = texelFetch(uFlux, cell, 0);
  float wet = smoothstep(0.006, 0.03, depth);
  float speed = length(vec2(flux.y - flux.x, flux.w - flux.z)) / max(depth, 0.02);
  float agitation = 1.0 + 0.8 * clamp(speed / 60.0, 0.0, 1.0);
  float soak = max(dev.g * uSoakDecay, wet);
  float committed = dev.r;
  float pending = dev.a + uDt * soak * agitation * uRate;
  if (pending >= max(0.05, committed / 256.0)) {
    committed += pending;
    pending = 0.0;
  }
  outDev = vec4(committed, soak, max(dev.b, wet), pending);
}
`;

export const FIELD_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uDev;
uniform sampler2D uHeight;
uniform vec2 uGrid;
out vec4 outField;

float depthAt(ivec2 cell) {
  return texelFetch(uHeight, clamp(cell, ivec2(0), ivec2(uGrid) - 1), 0).r;
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  float edges = depthAt(cell + ivec2(1, 0)) + depthAt(cell - ivec2(1, 0)) + depthAt(cell + ivec2(0, 1)) + depthAt(cell - ivec2(0, 1));
  float corners = depthAt(cell + ivec2(1, 1)) + depthAt(cell - ivec2(1, 1)) + depthAt(cell + ivec2(1, -1)) + depthAt(cell + ivec2(-1, 1));
  float depth = (4.0 * depthAt(cell) + 2.0 * edges + corners) / 16.0;
  vec4 dev = texelFetch(uDev, cell, 0);
  outField = vec4(depth, dev.r + dev.a, dev.g, 1.0);
}
`;

export const STATS_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uDev;
uniform vec2 uGrid;
out vec4 outStats;

void main() {
  float total = 0.0;
  float touched = 0.0;
  for (int row = 0; row < 30; row++) {
    for (int column = 0; column < 24; column++) {
      vec2 at = (vec2(float(column), float(row)) + 0.5) / vec2(24.0, 30.0);
      vec4 dev = texelFetch(uDev, ivec2(at * uGrid), 0);
      float reached = step(0.5, dev.b);
      total += (dev.r + dev.a) * reached;
      touched += reached;
    }
  }
  float meanTime = total / max(touched, 1.0);
  float scaled = clamp(meanTime / 256.0, 0.0, 1.0) * 255.0;
  outStats = vec4(floor(scaled) / 255.0, fract(scaled), touched / 720.0, 1.0);
}
`;

export const PRINT_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uField;
uniform sampler2D uImage;
uniform vec2 uGrid;
uniform vec2 uImageSize;
uniform vec4 uCrop;
uniform vec2 uLevels;
uniform vec2 uPlatePx;
uniform vec2 uBorder;
uniform vec3 uPaper;
uniform vec3 uSilver;
uniform float uContrast;
uniform float uFog;
uniform float uLith;
uniform float uGrain;
uniform float uWater;
uniform float uSeed;
uniform float uHasImage;

const float DENSITY_MAX = 2.1;
const float DEVELOP_K = 1.2;
const float LN10 = 2.302585;

float hash21(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

vec4 splineWeights(float t) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - t;
  vec4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  float w = 6.0 - x - y - z;
  return vec4(x, y, z, w) * (1.0 / 6.0);
}

vec4 sampleSpline(sampler2D tex, vec2 uv, vec2 size) {
  vec2 coord = uv * size - 0.5;
  vec2 fraction = fract(coord);
  coord -= fraction;
  vec4 wx = splineWeights(fraction.x);
  vec4 wy = splineWeights(fraction.y);
  vec4 corner = coord.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 sums = vec4(wx.xz + wx.yw, wy.xz + wy.yw);
  vec4 offsets = (corner + vec4(wx.yw, wy.yw) / sums) / size.xxyy;
  vec4 a = texture(tex, offsets.xz);
  vec4 b = texture(tex, offsets.yz);
  vec4 c = texture(tex, offsets.xw);
  vec4 d = texture(tex, offsets.yw);
  float sx = sums.x / (sums.x + sums.y);
  float sy = sums.z / (sums.z + sums.w);
  return mix(mix(d, c, sx), mix(b, a, sx), sy);
}

void main() {
  vec2 cellStep = 1.0 / uGrid;
  float depth = max(sampleSpline(uField, vUv, uGrid).r, 0.0);
  vec2 slope = vec2(
    texture(uField, vUv + vec2(cellStep.x, 0.0)).r - texture(uField, vUv - vec2(cellStep.x, 0.0)).r,
    texture(uField, vUv + vec2(0.0, cellStep.y)).r - texture(uField, vUv - vec2(0.0, cellStep.y)).r
  ) * 0.5;
  float wet = smoothstep(0.006, 0.03, depth) * uWater;
  vec2 seenUv = vUv - clamp(slope * 0.04, -0.01, 0.01) * wet;

  vec4 field = sampleSpline(uField, seenUv, uGrid);
  float developTime = max(field.g, 0.0);
  float soak = clamp(field.b, 0.0, 1.0) * uWater;

  vec2 inner = (seenUv - uBorder) / (1.0 - 2.0 * uBorder);
  vec2 innerPx = min(inner, 1.0 - inner) * uPlatePx * (1.0 - 2.0 * uBorder);
  float inImage = clamp(min(innerPx.x, innerPx.y) + 0.5, 0.0, 1.0) * uHasImage;
  vec2 imageUv = uCrop.xy + clamp(inner, 0.0, 1.0) * uCrop.zw;
  float luma = dot(sampleSpline(uImage, imageUv, uImageSize).rgb, vec3(0.2126, 0.7152, 0.0722));
  float tone = clamp((luma - uLevels.x) / max(uLevels.y - uLevels.x, 0.05), 0.0, 1.0);
  tone = mix(1.0, tone, inImage);
  float exposure = 1.0 - tone;

  float targetDensity = min(-log(max(tone, 0.0079)) / LN10 * uContrast, DENSITY_MAX);
  float effectiveTime = developTime + uLith * developTime * developTime * 0.3;
  float progress = 1.0 - exp(-DEVELOP_K * effectiveTime * (0.08 + 1.1 * pow(exposure, 1.8)));
  float density = min(targetDensity * (progress + 0.004) + uFog * max(effectiveTime - 3.0, 0.0), DENSITY_MAX);
  float grainNoise = hash21(floor(vUv * uPlatePx * 1.5) + uSeed) - 0.5;
  density = max(density + grainNoise * uGrain * 2.0 * density * max(DENSITY_MAX - density, 0.0), 0.0);
  vec3 color = mix(uSilver, uPaper, pow(10.0, -density));

  float sheen = max(wet, soak * 0.55);
  color *= 1.0 - 0.035 * sheen;
  float tint = wet * (0.02 + 0.035 * smoothstep(0.0, 1.2, depth));
  color *= 1.0 - tint * vec3(0.0, 0.6, 1.6);

  vec3 halfway = normalize(normalize(vec3(-0.4, 0.6, 1.0)) + vec3(0.0, 0.0, 1.0));
  vec3 normal = normalize(vec3(-slope * 6.0, 1.0));
  float facing = max(dot(normal, halfway), 0.0);
  float broadGlint = max(pow(facing, 14.0) - pow(halfway.z, 14.0), 0.0) * 0.08;
  float glint = (pow(facing, 90.0) * 0.3 + broadGlint) * wet;
  color += glint * vec3(0.92, 0.96, 1.0);

  float frontStrength = smoothstep(0.004, 0.02, length(slope)) * uWater;
  float edgeDistance = (depth - 0.014) / max(fwidth(depth), 0.00001);
  float rim = exp(-edgeDistance * edgeDistance * 0.8) * frontStrength;
  float lip = exp(-(edgeDistance - 2.4) * (edgeDistance - 2.4) * 0.6) * frontStrength;
  color *= 1.0 - 0.08 * rim;
  color += 0.06 * lip;

  outColor = vec4(color + (hash21(gl_FragCoord.xy + 17.0) - 0.5) / 255.0, 1.0);
}
`;
