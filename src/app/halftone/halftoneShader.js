export const HALFTONE_VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const HALFTONE_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uImage;
uniform vec2  uResolution;
uniform vec2  uFit;
uniform vec2  uOffset;
uniform float uZoom;
uniform float uAspect;
uniform float uHasImage;
uniform float uTile;
uniform float uChroma;

uniform vec2  uWarpCentre;
uniform float uCurve;
uniform float uTiltX;
uniform float uTiltY;
uniform float uSpin;

uniform float uCell;
uniform float uCellAspect;
uniform float uCellPower;
uniform float uDotScale;
uniform float uDotGamma;

uniform float uBlack;
uniform float uWhite;
uniform float uGamma;

uniform vec3  uPaper;
uniform vec3  uInkA;
uniform vec3  uInkB;
uniform vec3  uInkC;
uniform vec3  uAngles;
uniform vec3  uGains;
uniform vec3  uSlips;

uniform float uGrain;
uniform float uGrainChroma;
uniform float uBloom;
uniform float uSeed;
uniform float uSuper;

float hash21(vec2 p) {
  p = fract(p * vec2(127.317, 311.703));
  p += dot(p, p + 47.113);
  return fract(p.x * p.y);
}

vec2 rot(vec2 p, float a) {
  float s = sin(a);
  float c = cos(a);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

float warpRadius(float r) {
  if (uCurve <= 0.001) return r;
  float t = r * uCurve;
  float knee = 1.2;
  if (t <= knee) return tan(t) / uCurve;
  float v = tan(knee);
  return (v + (1.0 + v * v) * (t - knee)) / uCurve;
}

vec2 plateCoord(vec2 p) {
  vec2 q = (p - uWarpCentre) * vec2(uAspect, 1.0);
  float r = length(q);

  float norm = 0.75 / max(warpRadius(0.75), 1e-4);
  vec2 dir = r > 1e-5 ? q / r : vec2(0.0, 0.0);
  vec2 plate = dir * warpRadius(r) * norm;

  float w = 1.0 + uTiltX * plate.x + uTiltY * plate.y;
  plate /= max(w, 0.08);

  return rot(plate, uSpin);
}

vec3 sourceAt(vec2 plate) {
  if (uHasImage < 0.5) return vec3(0.5);
  vec2 iuv = plate / (uFit * uZoom) + 0.5 + uOffset;
  if (uTile > 0.5) {
    iuv = abs(fract(iuv * 0.5) * 2.0 - 1.0);
  } else if (iuv.x < 0.0 || iuv.x > 1.0 || iuv.y < 0.0 || iuv.y > 1.0) {
    return vec3(1.0);
  }
  vec3 c = texture2D(uImage, clamp(iuv, 0.0, 1.0)).rgb;
  c = clamp((c - uBlack) / max(uWhite - uBlack, 0.01), 0.0, 1.0);
  return pow(c, vec3(uGamma));
}

float screenDot(vec2 plate, float angle, float cover) {
  vec2 g = rot(plate, angle) * uCell;
  vec2 f = fract(g) - 0.5;
  f.x *= uCellAspect;

  float n = uCellPower;
  float sd = pow(pow(abs(f.x), n) + pow(abs(f.y), n), 1.0 / n);

  float radius = 0.5 * uDotScale * pow(clamp(cover, 0.0, 1.0), uDotGamma);
  float aa = fwidth(sd) + 1e-4;
  return smoothstep(radius + aa, radius - aa, sd);
}

vec3 shade(vec2 p) {
  vec2 plate = plateCoord(p);

  vec3 col = uPaper;
  vec3 bloom = vec3(0.0);

  vec3 inks[3];
  inks[0] = uInkA;
  inks[1] = uInkB;
  inks[2] = uInkC;

  for (int i = 0; i < 3; i++) {
    float angle = uAngles[i];
    float slip = uSlips[i];
    vec2 nudge = rot(vec2(slip, 0.0), angle);

    vec3 src = sourceAt(plate + nudge);
    float lum = dot(src, vec3(0.2126, 0.7152, 0.0722));
    float band = i == 0 ? src.r : (i == 1 ? src.g : src.b);
    float channel = mix(lum, band, uChroma);
    float cover = clamp((1.0 - channel) * uGains[i], 0.0, 1.0);

    float a = screenDot(plate + nudge, angle, cover);
    col = mix(col, inks[i], a);
    bloom += inks[i] * a;
  }

  col += bloom * uBloom * 0.16;

  float g = hash21(floor(p * uResolution) + uSeed * 71.0) - 0.5;
  float gc = hash21(floor(p * uResolution) * 1.7 + uSeed * 13.0) - 0.5;
  col += uGrain * g;
  col.r += uGrain * uGrainChroma * gc;
  col.b -= uGrain * uGrainChroma * gc;

  return clamp(col, 0.0, 1.0);
}

void main() {
  vec2 px = 1.0 / uResolution;

  vec3 col;
  if (uSuper > 0.5) {
    col  = shade(vUv + vec2( 0.25,  0.75) * px);
    col += shade(vUv + vec2(-0.75,  0.25) * px);
    col += shade(vUv + vec2( 0.75, -0.25) * px);
    col += shade(vUv + vec2(-0.25, -0.75) * px);
    col *= 0.25;
  } else {
    col = shade(vUv);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;
