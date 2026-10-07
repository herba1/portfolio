export const MARBLE_VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const MARBLE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform highp sampler2D uOps;
uniform highp sampler2D uSheet;
uniform sampler2D uAtlas;
uniform int uMode;
uniform int uOpStart;
uniform int uOpEnd;
uniform int uHasSheet;
uniform int uSuper;
uniform vec2 uSheetSize;
uniform vec2 uViewSize;
uniform float uUnit;
uniform float uLambda;
uniform float uRimPx;
uniform float uGrain;
uniform float uSeed;
uniform vec3 uPaper;
uniform vec3 uAvg[16];
uniform vec3 uRim[16];
uniform float uTileReady[16];
uniform int uHighlight;
uniform float uHighlightMix;

out vec4 fragColor;

const float FACE_CROP = 0.94;
const float ATLAS_TEXELS = 2048.0;
const float MAX_GRADIENT_TEXELS = 6.0;
const float CODE_STRIDE = 32.0;
const float FAR_EDGE = 1.0;
const float MIN_RIM_RADIUS = 1e-4;
const vec4 PAPER_HIT = vec4(-1.0, 0.0, 0.0, 1.0);

float hash21(vec2 point) {
  point = fract(point * vec2(233.34, 851.73));
  point += dot(point, point + 23.45);
  return fract(point.x * point.y);
}

float coverOfCode(float code) {
  return floor((code + 0.5) / CODE_STRIDE) - 1.0;
}

float rimOfCode(float code) {
  return floor(code + 0.5) - (coverOfCode(code) + 1.0) * CODE_STRIDE - 1.0;
}

float encodeHit(float cover, float rimCover) {
  return (cover + 1.0) * CODE_STRIDE + rimCover + 1.0;
}

float sameCover(vec4 texel, float cover) {
  return abs(coverOfCode(texel.x) - cover) < 0.5 ? 1.0 : 0.0;
}

vec4 sheetAt(vec2 plate, out float rimCover) {
  rimCover = -1.0;
  vec2 sheetPx = plate * uUnit + 0.5 * uSheetSize - 0.5;
  vec2 base = floor(sheetPx);
  vec2 fraction = sheetPx - base;
  ivec2 corner = ivec2(base);
  ivec2 last = ivec2(uSheetSize) - 1;
  if (corner.x < -1 || corner.y < -1 || corner.x > last.x || corner.y > last.y) return PAPER_HIT;
  vec4 t00 = texelFetch(uSheet, clamp(corner, ivec2(0), last), 0);
  vec4 t10 = texelFetch(uSheet, clamp(corner + ivec2(1, 0), ivec2(0), last), 0);
  vec4 t01 = texelFetch(uSheet, clamp(corner + ivec2(0, 1), ivec2(0), last), 0);
  vec4 t11 = texelFetch(uSheet, clamp(corner + ivec2(1, 1), ivec2(0), last), 0);
  vec4 nearest = fraction.x < 0.5 ? (fraction.y < 0.5 ? t00 : t01) : (fraction.y < 0.5 ? t10 : t11);
  float cover = coverOfCode(nearest.x);
  rimCover = rimOfCode(nearest.x);
  float w00 = (1.0 - fraction.x) * (1.0 - fraction.y) * sameCover(t00, cover);
  float w10 = fraction.x * (1.0 - fraction.y) * sameCover(t10, cover);
  float w01 = (1.0 - fraction.x) * fraction.y * sameCover(t01, cover);
  float w11 = fraction.x * fraction.y * sameCover(t11, cover);
  float total = max(w00 + w10 + w01 + w11, 1e-5);
  vec2 face = (t00.yz * w00 + t10.yz * w10 + t01.yz * w01 + t11.yz * w11) / total;
  float edge = (abs(t00.w) * w00 + abs(t10.w) * w10 + abs(t01.w) * w01 + abs(t11.w) * w11) / total;
  return vec4(cover, face, nearest.w < 0.0 ? -edge : edge);
}

vec4 walkPlate(vec2 plate, out float rimCover) {
  float gap = FAR_EDGE;
  float gapCover = -1.0;
  for (int walked = 0; walked < 64; walked++) {
    int index = uOpEnd - 1 - walked;
    if (index < uOpStart) break;
    ivec2 at = ivec2((index % 64) * 3, index / 64);
    vec4 head = texelFetch(uOps, at, 0);
    vec4 axis = texelFetch(uOps, at + ivec2(1, 0), 0);
    vec4 body = texelFetch(uOps, at + ivec2(2, 0), 0);
    int kind = int(head.x + 0.5);
    float amount = body.w;
    if (kind == 1) {
      float radius = head.w * amount;
      vec2 offset = plate - head.yz;
      float distanceSq = dot(offset, offset);
      float distanceToCentre = sqrt(distanceSq);
      if (distanceSq < radius * radius) {
        vec2 discOffset = vec2(offset.x, -offset.y) / (2.0 * radius);
        vec2 face = axis.w > 0.0 ? axis.xy + discOffset * axis.w : 0.5 + discOffset * FACE_CROP;
        float inside = radius - distanceToCentre;
        if (gap < inside) {
          rimCover = gapCover;
          return vec4(body.z, face, -gap);
        }
        rimCover = body.z;
        return vec4(body.z, face, inside);
      }
      float outside = distanceToCentre - radius;
      if (radius > MIN_RIM_RADIUS && outside < gap) {
        gap = outside;
        gapCover = body.z;
      }
      plate = head.yz + offset * sqrt(max(1.0 - radius * radius / max(distanceSq, 1e-12), 0.0));
    } else if (kind == 2) {
      vec2 direction = axis.xy;
      vec2 across = vec2(-direction.y, direction.x);
      float offsetAcross = dot(plate - head.yz, across);
      float tines = max(body.y, 1.0);
      float spacing = max(axis.w, 1e-4);
      float middle = (tines - 1.0) * 0.5;
      float nearestTine = clamp(floor(offsetAcross / spacing + middle + 0.5), 0.0, tines - 1.0);
      float distanceToTine = abs(offsetAcross - (nearestTine - middle) * spacing);
      plate -= direction * body.x * amount * uLambda / (distanceToTine + uLambda);
    } else if (kind == 3) {
      vec2 offset = plate - head.yz;
      float distanceToCentre = length(offset);
      float angle = -body.x * amount * uLambda / (abs(distanceToCentre - head.w) + uLambda);
      float cosine = cos(angle);
      float sine = sin(angle);
      plate = head.yz + vec2(offset.x * cosine - offset.y * sine, offset.x * sine + offset.y * cosine);
    } else if (kind == 4) {
      vec2 direction = axis.xy;
      vec2 across = vec2(-direction.y, direction.x);
      float offsetAcross = dot(plate - head.yz, across);
      plate -= direction * body.x * amount * sin(offsetAcross * 6.2831853 / max(axis.w, 1e-4) + axis.z);
    }
  }
  if (uHasSheet == 1) {
    float sheetRim;
    vec4 sheet = sheetAt(plate, sheetRim);
    if (gap < abs(sheet.w)) {
      rimCover = gapCover;
      return vec4(sheet.xyz, -gap);
    }
    rimCover = sheetRim;
    return sheet;
  }
  rimCover = gapCover;
  return vec4(-1.0, 0.0, 0.0, -gap);
}

vec2 clampGradient(vec2 gradient) {
  float texels = length(gradient) * ATLAS_TEXELS;
  return texels > MAX_GRADIENT_TEXELS ? gradient * (MAX_GRADIENT_TEXELS / texels) : gradient;
}

vec3 coverColour(int cover, vec2 face, vec2 faceDx, vec2 faceDy) {
  vec2 tile = vec2(float(cover % 4), float(cover / 4));
  vec2 atlasUv = (tile + clamp(face, 0.002, 0.998)) * 0.25;
  vec3 sampled = textureGrad(uAtlas, atlasUv, clampGradient(faceDx * 0.25), clampGradient(faceDy * 0.25)).rgb;
  return mix(uAvg[cover], sampled, uTileReady[cover]);
}

float edgeSlope(float signedEdge, float rimCover) {
  float slopeX = dFdx(signedEdge);
  float slopeY = dFdy(signedEdge);
  bool steadyX = abs(dFdx(rimCover)) < 0.5;
  bool steadyY = abs(dFdy(rimCover)) < 0.5;
  float slope = 1.0;
  if (steadyX && steadyY) {
    slope = length(vec2(slopeX, slopeY)) * uUnit;
  } else if (steadyX) {
    slope = abs(slopeX) * 1.41421356 * uUnit;
  } else if (steadyY) {
    slope = abs(slopeY) * 1.41421356 * uUnit;
  }
  return clamp(slope, 0.25, 6.0);
}

vec3 shadePixel(vec2 fragmentPx) {
  vec2 plate = (fragmentPx - 0.5 * uViewSize) / uUnit;
  float rimCover;
  vec4 hit = walkPlate(plate, rimCover);
  vec2 faceDx = dFdx(hit.yz);
  vec2 faceDy = dFdy(hit.yz);
  float slope = edgeSlope(hit.w, rimCover);
  float edgePx = abs(hit.w) * uUnit / slope;
  vec3 colour = uPaper;
  int cover = int(hit.x + 0.5);
  if (hit.x > -0.5) colour = coverColour(cover, hit.yz, faceDx, faceDy);
  if (rimCover > -0.5) {
    float coverage = clamp(0.5 * uRimPx + 0.5 - edgePx, 0.0, min(uRimPx, 1.0));
    colour = mix(colour, uRim[int(rimCover + 0.5)], coverage);
  }
  if (hit.x > -0.5 && uHighlight >= 0 && cover != uHighlight) {
    float luma = dot(colour, vec3(0.2126, 0.7152, 0.0722));
    colour = mix(colour, mix(vec3(luma), uPaper, 0.35), 0.62 * uHighlightMix);
  }
  return colour;
}

void main() {
  if (uMode == 0) {
    vec2 plate = (gl_FragCoord.xy - 0.5 * uSheetSize) / uUnit;
    float rimCover;
    vec4 hit = walkPlate(plate, rimCover);
    fragColor = vec4(encodeHit(hit.x, rimCover), hit.yzw);
    return;
  }
  vec3 colour;
  if (uSuper == 2) {
    colour = shadePixel(gl_FragCoord.xy + vec2(0.125, 0.375));
    colour += shadePixel(gl_FragCoord.xy + vec2(-0.375, 0.125));
    colour += shadePixel(gl_FragCoord.xy + vec2(0.375, -0.125));
    colour += shadePixel(gl_FragCoord.xy + vec2(-0.125, -0.375));
    colour *= 0.25;
  } else if (uSuper == 1) {
    colour = shadePixel(gl_FragCoord.xy + vec2(0.25, -0.25));
    colour += shadePixel(gl_FragCoord.xy + vec2(-0.25, 0.25));
    colour *= 0.5;
  } else {
    colour = shadePixel(gl_FragCoord.xy);
  }
  vec2 grainCell = floor(gl_FragCoord.xy) + uSeed * 17.0;
  float grain = hash21(grainCell) - 0.5;
  float chroma = hash21(grainCell + 41.7) - 0.5;
  colour += grain * uGrain;
  colour.r += chroma * uGrain * 1.15;
  colour.b -= chroma * uGrain * 1.15;
  fragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}
`;
