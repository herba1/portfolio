export const SMEAR_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
uniform vec2 uCanvas;
uniform vec4 uRect;
out vec2 vUv;
void main() {
  vec2 px = uRect.xy + aCorner * uRect.zw;
  vec2 clip = vec2(px.x / uCanvas.x * 2.0 - 1.0, 1.0 - px.y / uCanvas.y * 2.0);
  vUv = aCorner;
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

export const SMEAR_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec4 uRands;
uniform float uStrength;
uniform float uId;
uniform float uKind;
uniform vec4 uCover;
uniform vec3 uInk;
uniform vec3 uPaper;
uniform float uReveal;
in vec2 vUv;
out vec4 outColor;

vec4 hash43(vec3 p) {
  vec4 p4 = fract(vec4(p.xyzx) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}

void main() {
  float s = clamp(uStrength, 0.0, 1.0);
  vec4 noises = hash43(vec3(gl_FragCoord.xy, uId));
  vec4 rands = hash43(vec3(floor(sin(vUv.x * 2.0 + uRands.x * 6.283) * mix(3.0, 40.0, uRands.y)) * 30.0, uId, uRands.z));
  float gate = rands.y > 0.7 ? 1.0 : 0.0;
  float reach = uKind > 0.5 ? 0.9 : 0.5;
  vec2 offset = vec2(0.0, (rands.x - 0.5) * reach * gate) / 5.0 * (s * 0.32);
  vec2 uv = vUv + noises.xy * offset;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 5; i++) {
    vec2 st = uCover.xy + clamp(uv, 0.0, 1.0) * uCover.zw;
    acc += texture(uTex, st);
    uv += offset;
  }
  acc /= 5.0;
  float exposure = 1.0 + s * 1.8;
  if (uKind > 0.5) {
    float ink = acc.a * (1.0 - s * 0.62);
    vec3 color = mix(uInk, uPaper, s * 0.35);
    outColor = vec4(color * ink, ink) * uReveal;
  } else {
    vec3 lit = vec3(1.0) - pow(vec3(1.0) - clamp(acc.rgb, 0.0, 1.0), vec3(exposure));
    float lum = dot(lit, vec3(0.2126, 0.7152, 0.0722));
    vec3 color = mix(lit, vec3(lum), s * 0.5);
    color = mix(color, vec3(1.0, 0.996, 0.985), smoothstep(0.55, 1.0, lum) * s * 0.6);
    color = mix(uPaper, color, uReveal);
    outColor = vec4(color, 1.0);
  }
}
`;
