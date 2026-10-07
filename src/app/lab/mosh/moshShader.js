export const TRIANGLE_VERTEX = `#version 300 es
out vec2 vUv;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const ENCODE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uCover;
out vec4 outColor;

vec3 encodeYcc(vec3 rgb) {
  float luma = dot(rgb, vec3(0.299, 0.587, 0.114));
  float blueDiff = dot(rgb, vec3(-0.168736, -0.331264, 0.5));
  float redDiff = dot(rgb, vec3(0.5, -0.418688, -0.081312));
  return vec3(luma, blueDiff + 0.5, redDiff + 0.5);
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  outColor = vec4(encodeYcc(texelFetch(uCover, pixel, 0).rgb), 1.0);
}
`;

export const ADVECT_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uPrev;
uniform sampler2D uTarget;
uniform sampler2D uShift;
uniform sampler2D uInfo;
uniform int uBlock;
uniform int uBlockLevel;
uniform int uChromaLevel;
uniform int uSize;
uniform float uHasTarget;
uniform float uResidual;
uniform float uLumaShare;
uniform float uRingRate;
uniform float uRingStep;
uniform float uBlend;
uniform int uFrameCount;
out vec4 outColor;

vec3 encodeYcc(vec3 rgb) {
  float luma = dot(rgb, vec3(0.299, 0.587, 0.114));
  float blueDiff = dot(rgb, vec3(-0.168736, -0.331264, 0.5));
  float redDiff = dot(rgb, vec3(0.5, -0.418688, -0.081312));
  return vec3(luma, blueDiff + 0.5, redDiff + 0.5);
}

bool inside(ivec2 pixel) {
  return pixel.x >= 0 && pixel.y >= 0 && pixel.x < uSize && pixel.y < uSize;
}

float blockChance(ivec2 block, int frameCount) {
  uint mixed = uint(block.x) * 1664525u + uint(block.y) * 22695477u + uint(frameCount) * 2891336453u;
  mixed ^= mixed >> 16u;
  mixed *= 2246822519u;
  mixed ^= mixed >> 13u;
  mixed *= 3266489917u;
  mixed ^= mixed >> 16u;
  return float(mixed >> 8u) / 16777216.0;
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  ivec2 block = pixel / uBlock;
  vec4 shift = texelFetch(uShift, block, 0);
  vec4 info = texelFetch(uInfo, block, 0);
  int rung = int(info.z + 0.5);
  bool hasTarget = uHasTarget > 0.5;

  if (rung > 0 && hasTarget) {
    int level = rung >= 4 ? 0 : max(uBlockLevel - (rung - 1), 0);
    outColor = vec4(encodeYcc(texelFetch(uTarget, pixel >> level, level).rgb), 1.0);
    return;
  }

  vec3 intra = hasTarget ? encodeYcc(texelFetch(uTarget, pixel, 0).rgb) : texelFetch(uPrev, pixel, 0).rgb;
  ivec2 lumaFrom = pixel - ivec2(shift.xy);
  ivec2 chromaFrom = pixel - ivec2(shift.zw);
  float luma = inside(lumaFrom) ? texelFetch(uPrev, lumaFrom, 0).r : intra.r;
  vec2 chroma = inside(chromaFrom) ? texelFetch(uPrev, chromaFrom, 0).gb : intra.gb;
  vec3 ycc = vec3(luma, chroma);

  float speed = length(info.xy);
  float gate = hasTarget ? smoothstep(0.2, 2.0, speed) : 0.0;
  if (gate > 0.0) {
    ivec2 lumaCell = pixel >> uBlockLevel;
    ivec2 chromaCell = pixel >> uChromaLevel;
    vec3 targetLumaDc = encodeYcc(texelFetch(uTarget, lumaCell, uBlockLevel).rgb);
    vec3 targetChromaDc = encodeYcc(texelFetch(uTarget, chromaCell, uChromaLevel).rgb);
    vec3 currentLumaDc = texelFetch(uPrev, lumaCell, uBlockLevel).rgb;
    vec2 currentChromaDc = texelFetch(uPrev, chromaCell, uChromaLevel).gb;
    vec3 dcStep = vec3((targetLumaDc.r - currentLumaDc.r) * uLumaShare, targetChromaDc.gb - currentChromaDc);
    ycc += dcStep * uResidual * gate;

    float ringGate = smoothstep(3.0, 6.0, speed) * uRingRate;
    if (ringGate > 0.0 && blockChance(block, uFrameCount) < ringGate) {
      int acLevel = max(uBlockLevel - 2, 0);
      ivec2 acCell = pixel >> acLevel;
      vec3 targetAc = encodeYcc(texelFetch(uTarget, acCell, acLevel).rgb) - targetLumaDc;
      vec3 currentAc = texelFetch(uPrev, acCell, acLevel).rgb - currentLumaDc;
      vec3 acStep = round((targetAc - currentAc) * 0.5 / uRingStep) * uRingStep;
      ycc += acStep * vec3(1.0, 0.5, 0.5);
    }
  }

  ycc = mix(ycc, intra, uBlend);
  outColor = vec4(clamp(ycc, 0.0, 1.0), 1.0);
}
`;

export const DISPLAY_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uFrame;
uniform sampler2D uInfo;
uniform float uSize;
uniform float uBlock;
uniform int uBlockLevel;
uniform int uMaxLevel;
uniform float uGrid;
uniform float uPxPerTexel;
uniform float uTickRadius;
uniform float uTickFull;
uniform vec2 uPointer;
uniform float uLens;
uniform float uLensShow;
uniform float uFieldShow;
uniform float uReveal;
uniform vec3 uPaper;
in vec2 vUv;
out vec4 outColor;

vec3 decodeYcc(vec3 ycc) {
  float luma = ycc.x;
  float blueDiff = ycc.y - 0.5;
  float redDiff = ycc.z - 0.5;
  return vec3(luma + 1.402 * redDiff, luma - 0.344136 * blueDiff - 0.714136 * redDiff, luma + 1.772 * blueDiff);
}

float segmentDistance(vec2 point, vec2 start, vec2 end) {
  vec2 along = end - start;
  float span = dot(along, along);
  float t = span > 0.0 ? clamp(dot(point - start, along) / span, 0.0, 1.0) : 0.0;
  return length(point - start - along * t);
}

float hash21(vec2 point) {
  vec3 p3 = fract(vec3(point.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 sharpSample(vec2 texel) {
  if (uPxPerTexel <= 1.0) {
    return textureLod(uFrame, texel / uSize, -log2(max(uPxPerTexel, 0.0001))).rgb;
  }
  vec2 base = floor(texel - 0.5);
  vec2 offset = texel - 0.5 - base;
  float soft = clamp(0.8 / uPxPerTexel, 0.08, 0.5);
  offset = smoothstep(0.5 - soft, 0.5 + soft, offset);
  return textureLod(uFrame, (base + 0.5 + offset) / uSize, 0.0).rgb;
}

void main() {
  vec2 texel = vUv * uSize;
  ivec2 texelCell = ivec2(clamp(texel, vec2(0.0), vec2(uSize - 1.0)));

  float revealCell = 32.0;
  vec2 revealBlock = floor(texel / revealCell);
  float revealCount = uSize / revealCell;
  float order = (revealBlock.x + (revealCount - 1.0 - revealBlock.y)) / max(2.0 * revealCount - 2.0, 1.0);
  float revealLocal = clamp((uReveal - order * 0.55) / 0.45, 0.0, 1.0);

  vec3 ycc;
  if (revealLocal >= 1.0) {
    ycc = sharpSample(texel);
  } else {
    int level = revealLocal < 0.3 ? 5 : revealLocal < 0.55 ? 4 : revealLocal < 0.8 ? 3 : 2;
    level = min(level, uMaxLevel);
    ycc = texelFetch(uFrame, texelCell >> level, level).rgb;
  }
  vec3 rgb = decodeYcc(ycc);
  rgb = revealLocal <= 0.0 ? uPaper : rgb;

  vec2 blockCoord = floor(texel / uBlock);
  vec2 center = (blockCoord + 0.5) * uBlock;
  vec4 info = texelFetch(uInfo, ivec2(clamp(blockCoord, vec2(0.0), vec2(uGrid - 1.0))), 0);
  float speed = length(info.xy);
  vec2 heading = speed > 0.001 ? info.xy / speed : vec2(0.0);
  vec2 tip = center + heading * sqrt(clamp(speed / uTickFull, 0.0, 1.0)) * uBlock * 0.44;
  float distancePx = segmentDistance(texel, center, tip) * uPxPerTexel;
  float ink = 1.0 - smoothstep(uTickRadius - 0.7, uTickRadius + 0.7, distancePx);

  float pointerDistance = length(center - uPointer);
  float lens = (1.0 - smoothstep(uLens * 0.45, uLens, pointerDistance)) * uLensShow;
  float show = max(uFieldShow, lens) * step(0.999, revealLocal);
  float blockLuma = texelFetch(uFrame, ivec2(blockCoord), uBlockLevel).r;
  vec3 tickColour = blockLuma > 0.56 ? vec3(0.102) : vec3(0.985, 0.988, 0.992);
  rgb = mix(rgb, tickColour, ink * show);

  rgb += (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;
