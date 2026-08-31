export const INK_VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const INK_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D uImage;
uniform vec2  uResolution;
uniform vec2  uFit;
uniform vec2  uOffset;
uniform float uZoom;
uniform float uAspect;
uniform float uHasImage;

uniform float uBrightness;
uniform float uContrast;
uniform float uGamma;
uniform float uInvert;

uniform float uAngle;
uniform float uLineCount;
uniform float uWeight;
uniform float uBleed;

uniform float uWaver;
uniform float uWaverScale;
uniform float uRagged;
uniform float uRaggedScale;
uniform float uBreakup;
uniform float uBreakScale;
uniform float uDry;
uniform float uDryScale;

uniform float uPressure;
uniform float uPressureScale;
uniform float uFibre;
uniform float uFibreScale;
uniform float uTooth;
uniform float uPaperGrain;
uniform float uHalo;
uniform float uHaloBlur;
uniform float uSheen;

uniform vec3  uPaper;
uniform vec3  uInk;
uniform float uSeed;
uniform float uSuper;

float hash21(vec2 p) {
  p = fract(p * vec2(127.317, 311.703));
  p += dot(p, p + 47.113);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm2(vec2 p) {
  float v = vnoise(p) * 0.6667;
  v += vnoise(p * 2.07 + 19.1) * 0.3333;
  return v;
}

float fbm4(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + 13.7;
    a *= 0.5;
  }
  return v / 0.9375;
}

vec2 rot(vec2 p, float a) {
  float s = sin(a);
  float c = cos(a);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

vec2 aspectFwd(vec2 p) { return vec2((p.x - 0.5) * uAspect, p.y - 0.5); }
vec2 aspectInv(vec2 q) { return vec2(q.x / uAspect + 0.5, q.y + 0.5); }

vec2 sourceUv(vec2 p) {
  return (p - 0.5 - uOffset) / (uFit * uZoom) + 0.5;
}

float tone(float l) {
  l = mix(l, 1.0 - l, uInvert);
  l = (l - 0.5) * uContrast + 0.5 + uBrightness;
  l = clamp(l, 0.0, 1.0);
  return pow(l, uGamma);
}

float coverageAt(vec2 p) {
  if (uHasImage < 0.5) return 0.0;
  vec2 iuv = sourceUv(p);
  if (iuv.x < 0.0 || iuv.x > 1.0 || iuv.y < 0.0 || iuv.y > 1.0) return 0.0;
  vec3 c = texture2D(uImage, iuv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return 1.0 - tone(l);
}

float soakAt(vec2 p) {
  if (uHasImage < 0.5) return 0.0;
  vec2 iuv = sourceUv(p);
  vec2 clamped = clamp(iuv, 0.0, 1.0);
  float outside = step(0.0005, distance(iuv, clamped));
  vec3 c = texture2D(uImage, clamped, uHaloBlur).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return (1.0 - tone(l)) * (1.0 - outside);
}

float inkAt(vec2 p, float aa) {
  vec2 paperSpace = aspectFwd(p);
  vec2 r = rot(paperSpace, uAngle);

  float row = (r.y + 0.5) * uLineCount;
  float wander = fbm4(vec2(r.x * uWaverScale, floor(row) * 4.13 + uSeed)) - 0.5;
  row += wander * uWaver;

  float li = floor(row);
  float d = abs(fract(row) - 0.5) * 2.0;

  vec2 centreR = vec2(r.x, (li + 0.5) / uLineCount - 0.5);
  vec2 centre = aspectInv(rot(centreR, -uAngle));

  float cov = coverageAt(centre);

  cov *= 1.0 + (fbm4(paperSpace * uPressureScale + uSeed * 3.1) - 0.5) * 2.0 * uPressure;

  float gate = smoothstep(0.0, 0.06, cov);

  float fibre = fbm4(vec2(paperSpace.x * uFibreScale, paperSpace.y * uFibreScale * 0.72) + uSeed);
  cov += (fibre - 0.5) * uFibre * gate;

  cov = clamp(cov, 0.0, 1.25);

  float body = cov * uWeight;
  float fray = (fbm2(vec2(r.x * uRaggedScale, li * 13.77 + uSeed * 7.9)) - 0.5) * uRagged;
  float swell = (fbm2(vec2(r.x * uRaggedScale * 0.17, li * 5.31 + uSeed * 3.3)) - 0.5) * uRagged * 1.7;
  float halfWidth = max(body + (fray + swell) * gate, body * 0.25);

  float soft = uBleed + aa;
  float ink = smoothstep(halfWidth + soft, halfWidth - soft, d) * gate;

  float contact = fbm2(vec2(r.x * uBreakScale, li * 9.71 + uSeed * 5.3));
  contact += (fbm2(vec2(r.x * uBreakScale * 9.0, li * 3.77 + uSeed * 2.1)) - 0.5) * 0.16;
  float need = uBreakup * (1.0 - smoothstep(0.12, 0.9, cov));
  ink *= smoothstep(need - 0.08, need + 0.08, contact);

  float edgeBand = smoothstep(halfWidth * 0.5, halfWidth + soft, d);
  float dry = fbm2(paperSpace * uDryScale + uSeed * 11.4);
  ink *= 1.0 - uDry * smoothstep(0.42, 0.95, dry) * (0.3 + 0.7 * edgeBand);

  return clamp(ink, 0.0, 1.0);
}

vec3 shade(vec2 p, float aa) {
  vec2 paperSpace = aspectFwd(p);

  float ink = inkAt(p, aa);

  vec3 paper = uPaper;
  float tooth = fbm4(vec2(paperSpace.x * uFibreScale * 1.7, paperSpace.y * uFibreScale * 0.6) + 31.4);
  paper *= 1.0 - uTooth * (tooth - 0.5) * 2.0;
  float speck = hash21(floor(p * uResolution) + uSeed * 97.0);
  paper *= 1.0 - uPaperGrain * (speck - 0.5) * 2.0;

  paper = mix(paper, uInk, uHalo * 0.16 * smoothstep(0.04, 0.85, soakAt(p)));

  vec3 col = mix(paper, uInk, ink);

  float rim = ink * (1.0 - ink) * 4.0;
  col += uSheen * rim * vec3(-0.05, 0.015, 0.2);

  return clamp(col, 0.0, 1.0);
}

void main() {
  float aa = uLineCount * (2.0 / uResolution.y) * mix(1.0, 0.5, step(0.5, uSuper));
  vec2 px = 1.0 / uResolution;

  vec3 col;
  if (uSuper > 0.5) {
    col  = shade(vUv + vec2( 0.25,  0.75) * px, aa);
    col += shade(vUv + vec2(-0.75,  0.25) * px, aa);
    col += shade(vUv + vec2( 0.75, -0.25) * px, aa);
    col += shade(vUv + vec2(-0.25, -0.75) * px, aa);
    col *= 0.25;
  } else {
    col = shade(vUv, aa);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;
