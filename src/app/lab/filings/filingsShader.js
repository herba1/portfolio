export const FILING_VERTEX = `
precision highp float;

attribute vec2 aCorner;
attribute vec2 aHome;
attribute vec4 aShape;
attribute vec3 aColourFrom;
attribute vec3 aColourTo;
attribute vec2 aTiming;
attribute vec3 aState;

uniform float uPlate;
uniform float uDpr;
uniform float uIntro;
uniform float uIntroSpan;
uniform float uMorph;
uniform float uMorphSpan;
uniform float uLength;

varying vec2 vLocal;
varying vec2 vHalf;
varying vec3 vColour;
varying float vPresence;

float easeOutBack(float t, float overshoot) {
  float u = clamp(t, 0.0, 1.0) - 1.0;
  return 1.0 + (overshoot + 1.0) * u * u * u + overshoot * u * u;
}

void main() {
  float growT = clamp((uIntro - aTiming.x) / uIntroSpan, 0.0, 1.0);
  float grow = growT <= 0.0 ? 0.0 : easeOutBack(growT, 1.70158);
  float morphT = clamp((uMorph - aTiming.y) / uMorphSpan, 0.0, 1.0);
  float morph = morphT <= 0.0 ? 0.0 : easeOutBack(morphT, 1.1);
  vec2 shape = mix(aShape.xy, aShape.zw, morph) * uPlate;
  float halfLength = 0.5 * shape.x * uLength * grow;
  float halfWidth = 0.5 * max(shape.y, 0.55) * grow;
  float pad = grow > 0.0 ? 1.25 / uDpr : 0.0;
  vec2 local = aCorner * vec2(halfLength + halfWidth + pad, halfWidth + pad);
  float c = cos(aState.x);
  float s = sin(aState.x);
  vec2 turned = vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  vec2 world = (aHome + aState.yz) * uPlate + turned;
  vec2 clip = world / uPlate * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vLocal = local;
  vHalf = vec2(halfLength, halfWidth);
  vColour = mix(aColourFrom, aColourTo, clamp(morph, 0.0, 1.0));
  vPresence = clamp(growT * 3.0, 0.0, 1.0);
}
`;

export const FILING_FRAGMENT = `
precision highp float;

uniform float uDpr;

varying vec2 vLocal;
varying vec2 vHalf;
varying vec3 vColour;
varying float vPresence;

void main() {
  vec2 p = vLocal;
  float along = p.x - clamp(p.x, -vHalf.x, vHalf.x);
  float d = length(vec2(along, p.y)) - vHalf.y;
  float alpha = clamp(0.5 - d * uDpr, 0.0, 1.0) * vPresence;
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(vColour * alpha, alpha);
}
`;

export const PAPER_VERTEX = `
precision highp float;

attribute vec2 aCorner;

varying vec2 vUv;

void main() {
  vUv = aCorner * 0.5 + 0.5;
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`;

export const PAPER_FRAGMENT = `
precision highp float;

uniform vec3 uPaper;
uniform float uDpr;
uniform float uGrain;

varying vec2 vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy / max(uDpr, 1.0));
  float grain = hash21(cell) - 0.5;
  float chroma = hash21(cell + 17.13) - 0.5;
  vec2 centred = vUv - 0.5;
  float radius = length(centred) * 1.41421;
  float shade = 0.022 * smoothstep(0.35, 0.8, radius) + 0.018 * smoothstep(0.7, 1.0, radius) + 0.01 * smoothstep(0.9, 1.05, radius);
  vec3 colour = uPaper * (1.0 - shade) + grain * uGrain;
  colour.r += chroma * uGrain * 0.45;
  colour.b -= chroma * uGrain * 0.45;
  gl_FragColor = vec4(colour, 1.0);
}
`;
