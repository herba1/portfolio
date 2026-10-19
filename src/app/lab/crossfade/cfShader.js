export const CF_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const CF_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uA0;
uniform sampler2D uA1;
uniform sampler2D uB0;
uniform sampler2D uB1;
uniform float uFadeA;
uniform float uFadeB;
uniform float uMix;

vec3 deckA(vec2 uv, float lod) {
  return mix(textureLod(uA0, uv, lod).rgb, textureLod(uA1, uv, lod).rgb, uFadeA);
}

vec3 deckB(vec2 uv, float lod) {
  return mix(textureLod(uB0, uv, lod).rgb, textureLod(uB1, uv, lod).rgb, uFadeB);
}

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 c = uv - 0.5;
  float e = uMix * uMix * (3.0 - 2.0 * uMix);
  vec2 uvA = 0.5 + c / (1.0 + 0.06 * e);
  vec2 uvB = 0.5 + c / (1.06 - 0.06 * e);
  vec3 a = deckA(uvA, 0.0);
  vec3 b = deckB(uvB, 0.0);
  float soft = 0.5 * (luma(deckB(uvB, 4.5)) + luma(deckB(uvB, 6.0)));
  float softA = 0.5 * (luma(deckA(uvA, 4.5)) + luma(deckA(uvA, 6.0)));
  float key = clamp(0.64 * soft + 0.36 * (1.0 - softA), 0.0, 1.0);
  float middle = 4.0 * uMix * (1.0 - uMix);
  float m = smoothstep(0.0, 1.0, (uMix - 0.5) * 1.2 + 0.5 + (key - 0.5) * 0.7 * middle);
  vec3 color = mix(a, b, m);
  outColor = vec4(color, 1.0);
}
`;
