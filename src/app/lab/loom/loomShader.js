export const LOOM_VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const LOOM_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uState;
uniform sampler2D uPrevFar;
uniform sampler2D uPrev;
uniform sampler2D uCurrent;
uniform sampler2D uNext;
uniform sampler2D uNextFar;
uniform vec2 uResolution;
uniform vec4 uCloth;
uniform vec3 uPointer;
uniform float uLod;
uniform float uSuper;
uniform float uTwist;
uniform float uSlip;

out vec4 outColor;

const float GAP = 0.12;
const float FRINGE = 1.5;
const float SHIFT_REACH = 1.2;
const float UNDER_SHADE = 0.8;
const float GROUND_SHADE = 0.78;
const float GROUND_LIFT = 0.35;
const vec3 WARP_ROOM = vec3(0.93, 0.94, 0.95);
const float HOVER_SWELL = 0.14;
const float SWELL_GLOW = 0.28;
const float SWELL_GLOW_LIMIT = 0.3;
const float LIFT_FROM = 0.004;
const float LIFT_TO = 0.03;
const float RADIUS_LIMIT = 0.49;

int weaveAt(int col) {
  return int(texelFetch(uState, ivec2(col, 5), 0).r + 0.5);
}

bool weftOver(int row, int col) {
  int weave = weaveAt(col);
  if (weave == 0) return ((row + col) & 1) == 0;
  if (weave == 1) return ((row + col) & 3) < 2;
  return ((col + 3 * row) % 5) != 0;
}

float weftOffsetAt(int row) {
  return texelFetch(uState, ivec2(row, 0), 0).r;
}

float warpOffsetAt(int col) {
  return texelFetch(uState, ivec2(col, 1), 0).r;
}

float slip(float offset) {
  return abs(offset - floor(offset + 0.5));
}

float liftOver(float mine, float other) {
  return smoothstep(LIFT_FROM, LIFT_TO, slip(mine) - slip(other));
}

bool weftRidesOver(int row, int col, float weftOffset) {
  bool woven = weftOver(row, col);
  if (uSlip < 0.5) return woven;
  float warpOffset = warpOffsetAt(col);
  return woven ? liftOver(warpOffset, weftOffset) < 0.5 : liftOver(weftOffset, warpOffset) > 0.5;
}

bool warpRidesOver(int row, int col, float warpOffset) {
  bool woven = !weftOver(row, col);
  if (uSlip < 0.5) return woven;
  float weftOffset = weftOffsetAt(row);
  return woven ? liftOver(weftOffset, warpOffset) < 0.5 : liftOver(warpOffset, weftOffset) > 0.5;
}

vec3 coverAt(float reel, vec2 uv) {
  if (reel < -1.5) return textureLod(uPrevFar, uv, uLod).rgb;
  if (reel < -0.5) return textureLod(uPrev, uv, uLod).rgb;
  if (reel > 1.5) return textureLod(uNextFar, uv, uLod).rgb;
  if (reel > 0.5) return textureLod(uNext, uv, uLod).rgb;
  return textureLod(uCurrent, uv, uLod).rgb;
}

vec3 weftColour(int row, float clothX, float offset, float count) {
  float along = clothX - offset;
  float reel = floor(along);
  return coverAt(reel, vec2(along - reel, (float(row) + 0.5) / count));
}

vec3 warpColour(int col, float clothY, float offset, float reelShift, float count) {
  float along = clothY - offset;
  float reel = floor(along);
  return coverAt(reel + reelShift, vec2((float(col) + 0.5) / count, along - reel));
}

float hoverSwell(float across, float along) {
  float acrossBell = exp(-(across * across) / 3.24);
  float alongBell = exp(-(along * along) / 81.0);
  return 1.0 + HOVER_SWELL * uPointer.z * acrossBell * alongBell;
}

float fringeShift(float offset, float count) {
  return SHIFT_REACH * tanh(offset * count / 8.0);
}

float capsule(float along, float across, float start, float end, float radius) {
  float centre = 0.5 * (start + end);
  float halfLength = max(0.5 * (end - start) - radius, 0.0);
  vec2 d = vec2(max(abs(along - centre) - halfLength, 0.0), across);
  return length(d) - radius;
}

float swellGlow(float radius) {
  return 1.0 + SWELL_GLOW * clamp(radius / (0.5 - GAP) - 1.0, 0.0, SWELL_GLOW_LIMIT);
}

vec3 threadShade(vec3 colour, float across, float radius, float along, float start, float end, float slide) {
  float t = clamp(across / max(radius, 1e-4), -1.0, 1.0);
  float roundness = 0.9 + 0.1 * sqrt(max(1.0 - t * t, 0.0));
  float tail = min(along - start, end - along);
  float dive = mix(0.92, 1.0, smoothstep(0.0, 0.45, tail));
  float twist = sin(6.2831853 * 1.6 * (along - slide - across * 0.577));
  return colour * (roundness * dive + uTwist * twist) * swellGlow(radius);
}

vec4 over(vec4 below, vec3 colour, float cover) {
  return vec4(colour, 1.0) * cover + below * (1.0 - cover);
}

vec4 ground(vec3 under, float weftThick, float warpThick) {
  float presence = clamp(max(weftThick, warpThick), 0.0, 1.0);
  return vec4(mix(under, WARP_ROOM, GROUND_LIFT) * GROUND_SHADE, 1.0) * presence;
}

vec4 weftAbove(vec2 g, int row, int col, int n, float count, float aa, vec3 weft, vec3 warp, float weftOffset, float weftAcross, float warpAcross, float weftRadius, float warpRadius, float weftThick, float warpThick) {
  vec4 acc = ground(warp, weftThick, warpThick);
  float underCover = clamp(0.5 - (abs(warpAcross) - warpRadius) / aa, 0.0, 1.0) * step(0.001, warpThick);
  acc = over(acc, warp * UNDER_SHADE, underCover);

  float start = float(col);
  float end = float(col + 1);
  for (int k = 1; k <= 4; k++) {
    int c = col - k;
    if (c < 0) { start = -FRINGE + fringeShift(weftOffset, count); break; }
    if (!weftRidesOver(row, c, weftOffset)) break;
    start -= 1.0;
  }
  for (int k = 1; k <= 4; k++) {
    int c = col + k;
    if (c >= n) { end = count + FRINGE + fringeShift(weftOffset, count); break; }
    if (!weftRidesOver(row, c, weftOffset)) break;
    end += 1.0;
  }
  float sd = capsule(g.x, weftAcross, start + GAP * 0.5, end - GAP * 0.5, weftRadius);
  float topCover = clamp(0.5 - sd / aa, 0.0, 1.0) * step(0.001, weftThick);
  vec3 top = threadShade(weft, weftAcross, weftRadius, g.x, start, end, weftOffset * count);
  return over(acc, top, topCover);
}

vec4 warpAbove(vec2 g, int row, int col, int n, float count, float aa, vec3 weft, vec3 warp, float warpOffset, float weftAcross, float warpAcross, float weftRadius, float warpRadius, float weftThick, float warpThick) {
  vec4 acc = ground(weft, weftThick, warpThick);
  float underCover = clamp(0.5 - (abs(weftAcross) - weftRadius) / aa, 0.0, 1.0) * step(0.001, weftThick);
  acc = over(acc, weft * UNDER_SHADE, underCover);

  float start = float(row);
  float end = float(row + 1);
  for (int k = 1; k <= 4; k++) {
    int r = row - k;
    if (r < 0) { start = -FRINGE + fringeShift(warpOffset, count); break; }
    if (!warpRidesOver(r, col, warpOffset)) break;
    start -= 1.0;
  }
  for (int k = 1; k <= 4; k++) {
    int r = row + k;
    if (r >= n) { end = count + FRINGE + fringeShift(warpOffset, count); break; }
    if (!warpRidesOver(r, col, warpOffset)) break;
    end += 1.0;
  }
  float sd = capsule(g.y, warpAcross, start + GAP * 0.5, end - GAP * 0.5, warpRadius);
  float topCover = clamp(0.5 - sd / aa, 0.0, 1.0) * step(0.001, warpThick);
  vec3 top = threadShade(warp, warpAcross, warpRadius, g.y, start, end, warpOffset * count);
  return over(acc, top, topCover);
}

vec4 shadeAt(vec2 pixel) {
  float count = uCloth.w;
  int n = int(count);
  vec2 cloth = (pixel - uCloth.xy) / uCloth.z;
  vec2 g = cloth * count;
  int col = int(floor(g.x));
  int row = int(floor(g.y));
  bool rowIn = row >= 0 && row < n;
  bool colIn = col >= 0 && col < n;
  if (!rowIn && !colIn) return vec4(0.0);

  float aa = count / uCloth.z * (uSuper > 1.5 ? 0.6 : 0.9);
  float baseRadius = 0.5 - GAP;

  if (rowIn && !colIn) {
    float offset = weftOffsetAt(row);
    float thick = texelFetch(uState, ivec2(row, 2), 0).r;
    float shift = fringeShift(offset, count);
    float start = -FRINGE + shift;
    float end = count + FRINGE + shift;
    float across = g.y - (float(row) + 0.5);
    float radius = min(baseRadius * thick * hoverSwell(float(row) + 0.5 - uPointer.y, g.x - uPointer.x), RADIUS_LIMIT);
    float sd = capsule(g.x, across, start, end, radius);
    float cover = clamp(0.5 - sd / aa, 0.0, 1.0) * step(0.001, thick);
    vec3 colour = weftColour(row, clamp(cloth.x, 0.0, 1.0), offset, count);
    colour = threadShade(colour, across, radius, g.x, start, end, offset * count);
    return vec4(colour, 1.0) * cover;
  }

  if (colIn && !rowIn) {
    float offset = warpOffsetAt(col);
    float thick = texelFetch(uState, ivec2(col, 3), 0).r;
    float reelShift = texelFetch(uState, ivec2(col, 4), 0).r;
    float shift = fringeShift(offset, count);
    float start = -FRINGE + shift;
    float end = count + FRINGE + shift;
    float across = g.x - (float(col) + 0.5);
    float radius = min(baseRadius * thick * hoverSwell(float(col) + 0.5 - uPointer.x, g.y - uPointer.y), RADIUS_LIMIT);
    float sd = capsule(g.y, across, start, end, radius);
    float cover = clamp(0.5 - sd / aa, 0.0, 1.0) * step(0.001, thick);
    vec3 colour = warpColour(col, clamp(cloth.y, 0.0, 1.0), offset, reelShift, count);
    colour = threadShade(colour, across, radius, g.y, start, end, offset * count);
    return vec4(colour, 1.0) * cover;
  }

  float weftOffset = weftOffsetAt(row);
  float warpOffset = warpOffsetAt(col);
  float weftThick = texelFetch(uState, ivec2(row, 2), 0).r;
  float warpThick = texelFetch(uState, ivec2(col, 3), 0).r;
  float warpReel = texelFetch(uState, ivec2(col, 4), 0).r;

  float weftAcross = g.y - (float(row) + 0.5);
  float warpAcross = g.x - (float(col) + 0.5);
  float weftRadius = min(baseRadius * weftThick * hoverSwell(float(row) + 0.5 - uPointer.y, g.x - uPointer.x), RADIUS_LIMIT);
  float warpRadius = min(baseRadius * warpThick * hoverSwell(float(col) + 0.5 - uPointer.x, g.y - uPointer.y), RADIUS_LIMIT);

  vec3 weft = weftColour(row, cloth.x, weftOffset, count);
  vec3 warp = warpColour(col, cloth.y, warpOffset, warpReel, count);

  bool woven = weftOver(row, col);
  float weftTop = woven ? 1.0 : 0.0;
  if (uSlip > 0.5) {
    weftTop = woven ? 1.0 - liftOver(warpOffset, weftOffset) : liftOver(weftOffset, warpOffset);
  }

  if (weftTop > 0.999) {
    return weftAbove(g, row, col, n, count, aa, weft, warp, weftOffset, weftAcross, warpAcross, weftRadius, warpRadius, weftThick, warpThick);
  }
  if (weftTop < 0.001) {
    return warpAbove(g, row, col, n, count, aa, weft, warp, warpOffset, weftAcross, warpAcross, weftRadius, warpRadius, weftThick, warpThick);
  }
  vec4 weftLayer = weftAbove(g, row, col, n, count, aa, weft, warp, weftOffset, weftAcross, warpAcross, weftRadius, warpRadius, weftThick, warpThick);
  vec4 warpLayer = warpAbove(g, row, col, n, count, aa, weft, warp, warpOffset, weftAcross, warpAcross, weftRadius, warpRadius, weftThick, warpThick);
  return mix(warpLayer, weftLayer, weftTop);
}

void main() {
  vec2 pixel = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec4 colour;
  if (uSuper > 2.5) {
    colour = shadeAt(pixel + vec2(0.125, 0.375));
    colour += shadeAt(pixel + vec2(-0.375, 0.125));
    colour += shadeAt(pixel + vec2(0.375, -0.125));
    colour += shadeAt(pixel + vec2(-0.125, -0.375));
    colour *= 0.25;
  } else if (uSuper > 1.5) {
    colour = shadeAt(pixel + vec2(0.25, 0.25));
    colour += shadeAt(pixel + vec2(-0.25, -0.25));
    colour *= 0.5;
  } else {
    colour = shadeAt(pixel);
  }
  outColor = colour;
}
`;
