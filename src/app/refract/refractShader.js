export const REFRACT_VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const REFRACT_FRAGMENT = /* glsl */ `
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

uniform vec2  uWarpCentre;
uniform float uCurve;
uniform float uTiltX;
uniform float uTiltY;
uniform float uSpin;

uniform float uCell;
uniform float uCellAspect;
uniform float uCellPower;
uniform float uGridAngle;
uniform float uLensRadius;
uniform float uLensPower;

uniform float uRefract;
uniform float uDispersion;

uniform float uBlack;
uniform float uWhite;
uniform float uGamma;
uniform float uSweep;
uniform float uSweepAngle;
uniform float uImageMix;
uniform float uRelief;

uniform vec3  uC0;
uniform vec3  uC1;
uniform vec3  uC2;
uniform vec3  uC3;
uniform vec3  uC4;

uniform float uSpecStrength;
uniform float uSpecPower;
uniform float uLightAngle;
uniform vec3  uSpecColour;
uniform float uMetal;
uniform float uRimDark;

uniform float uGrain;
uniform float uGrainChroma;
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

float toneAt(vec2 plate) {
  if (uHasImage < 0.5) return 0.5;
  vec2 iuv = plate / (uFit * uZoom) + 0.5 + uOffset;
  if (uTile > 0.5) {
    iuv = abs(fract(iuv * 0.5) * 2.0 - 1.0);
  }
  iuv = clamp(iuv, 0.0, 1.0);
  vec3 c = texture2D(uImage, iuv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  l = clamp((l - uBlack) / max(uWhite - uBlack, 0.01), 0.0, 1.0);
  return pow(l, uGamma);
}

vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0);
  if (t < 0.25) return mix(uC0, uC1, smoothstep(0.0, 0.25, t));
  if (t < 0.5) return mix(uC1, uC2, smoothstep(0.25, 0.5, t));
  if (t < 0.75) return mix(uC2, uC3, smoothstep(0.5, 0.75, t));
  return mix(uC3, uC4, smoothstep(0.75, 1.0, t));
}

vec3 fieldAt(vec2 plate) {
  vec2 axis = vec2(cos(uSweepAngle), sin(uSweepAngle));
  float sweep = 0.5 + dot(plate, axis) * uSweep;
  float t = clamp(mix(sweep, toneAt(plate), uImageMix), 0.0, 1.0);
  return ramp(t);
}

vec3 shade(vec2 p) {
  vec2 plate = plateCoord(p);

  vec2 g = rot(plate, uGridAngle) * uCell;
  vec2 f = fract(g) - 0.5;

  vec2 shaped = vec2(f.x * uCellAspect, f.y);
  float n = uCellPower;
  float sd = pow(pow(abs(shaped.x), n) + pow(abs(shaped.y), n), 1.0 / n);
  float t = clamp(sd / max(uLensRadius, 0.001), 0.0, 1.0);
  float dome = pow(max(1.0 - t * t, 0.0), uLensPower);

  vec2 inCell = rot(f, -uGridAngle) / uCell;
  vec2 pull = inCell * uRefract * dome;

  vec3 col;
  col.r = fieldAt(plate - pull * (1.0 + uDispersion)).r;
  col.g = fieldAt(plate - pull).g;
  col.b = fieldAt(plate - pull * (1.0 - uDispersion)).b;

  float sl = length(shaped);
  vec2 dir = sl > 1e-5 ? rot(shaped / sl, -uGridAngle) : vec2(0.0, 0.0);
  float mag = t * dome;

  vec3 normal = normalize(vec3(-dir * mag * uRelief, 1.0));
  vec3 light = normalize(vec3(cos(uLightAngle), sin(uLightAngle), 0.7));
  float spec = pow(max(dot(normal, light), 0.0), uSpecPower);
  float diff = clamp(dot(normal, light), 0.0, 1.0);

  col *= mix(1.0, 0.45 + 0.75 * diff, uRimDark);
  col = mix(col, col * (0.5 + 1.1 * spec), uMetal);
  col += uSpecColour * spec * uSpecStrength;

  float mono = hash21(floor(p * uResolution) + uSeed * 71.0) - 0.5;
  float chroma = hash21(floor(p * uResolution) * 1.7 + uSeed * 13.0) - 0.5;
  col += uGrain * mono;
  col.r += uGrain * uGrainChroma * chroma;
  col.b -= uGrain * uGrainChroma * chroma;

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
