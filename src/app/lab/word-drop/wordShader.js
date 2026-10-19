export const FULL_VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const BRIGHT_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = textureLod(uTex, vUv, 3.0).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = smoothstep(0.62, 1.0, l);
  outColor = vec4(c * c * k, 1.0);
}
`;

export const BLUR_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uStep;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 sum = texture(uTex, vUv) * 0.2270270270;
  sum += texture(uTex, vUv + uStep * 1.3846153846) * 0.3162162162;
  sum += texture(uTex, vUv - uStep * 1.3846153846) * 0.3162162162;
  sum += texture(uTex, vUv + uStep * 3.2307692308) * 0.0702702703;
  sum += texture(uTex, vUv - uStep * 3.2307692308) * 0.0702702703;
  outColor = sum;
}
`;

export const FINAL_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform sampler2D uBloom;
uniform vec2 uRes;
uniform vec2 uCover;
uniform vec2 uFocus;
uniform vec4 uCam;
uniform float uFrame;
uniform float uFade;
uniform float uGrainScale;
uniform float uBlur;
in vec2 vUv;
out vec4 outColor;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 toImage(vec2 suv) {
  vec2 p = (suv - 0.5) * uRes;
  float c = cos(uCam.z);
  float s = sin(uCam.z);
  p = mat2(c, -s, s, c) * p;
  p /= uCam.w;
  p += uCam.xy * uRes;
  return p / uRes * uCover + uFocus;
}

void main() {
  vec2 suv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 iuv = toImage(suv);
  vec2 fromCentre = suv - 0.5;
  vec2 ca = fromCentre * 0.002 * uCover;
  float bias = 0.6 + uBlur;
  vec3 img;
  img.r = texture(uImage, iuv + ca, bias).r;
  img.g = texture(uImage, iuv, bias).g;
  img.b = texture(uImage, iuv - ca, bias).b;
  vec3 bloom = texture(uBloom, iuv).rgb;

  vec3 lin = img * img;
  lin *= 1.04;
  lin += bloom * vec3(1.08, 1.02, 0.92) * 0.55;
  float lum = dot(lin, vec3(0.2126, 0.7152, 0.0722));
  lin = mix(vec3(lum), lin, 0.86);
  lin *= vec3(1.04, 1.0, 0.95);
  vec3 toned = (lin * (2.51 * lin + 0.03)) / (lin * (2.43 * lin + 0.59) + 0.14);
  vec3 col = sqrt(clamp(toned, 0.0, 1.0));
  col = col * 0.96 + vec3(0.03, 0.03, 0.035);

  float aspect = uRes.x / uRes.y;
  float vig = length(fromCentre * vec2(aspect, 1.0) / max(aspect, 1.0) * 1.1);
  col *= mix(1.0, smoothstep(1.1, 0.3, vig), 0.32);

  vec2 gp = floor(gl_FragCoord.xy / uGrainScale);
  float n = hash(gp + uFrame * 17.31) + hash(gp * 1.7 + uFrame * 3.17) - 1.0;
  float l2 = dot(col, vec3(0.299, 0.587, 0.114));
  col += n * 0.045 * (0.5 + 0.5 * (1.0 - abs(l2 - 0.45) * 1.6));

  col *= uFade;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
