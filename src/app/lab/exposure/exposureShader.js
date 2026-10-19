export const FULL_VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const SCENE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uLod;
uniform float uKnee;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = textureLod(uTex, vUv, uLod).rgb;
  vec3 lin = pow(c, vec3(2.2));
  vec3 hdr = lin / max(vec3(1.0) - lin * 0.86, vec3(0.08));
  outColor = vec4(max(hdr - uKnee, 0.0) * 0.125, 1.0);
}
`;

export const TEXT_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uLod;
in vec2 vUv;
out vec4 outColor;
void main() {
  float a = textureLod(uTex, vUv, uLod).a;
  outColor = vec4(a, a, a, 1.0);
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
uniform sampler2D uHalo;
uniform sampler2D uText;
uniform sampler2D uTextBloom;
uniform sampler2D uTextHalo;
uniform vec2 uRes;
uniform vec2 uCover;
uniform vec2 uFocus;
uniform vec4 uCam;
uniform float uEv;
uniform float uFrame;
uniform float uFade;
uniform float uGrainScale;
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

vec3 tone(vec3 x) {
  float white = 3.2;
  vec3 m = x * (1.0 + x / (white * white)) / (1.0 + x);
  return clamp(m, 0.0, 1.0);
}

void main() {
  vec2 suv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 iuv = toImage(suv);
  vec3 c = texture(uImage, iuv, 0.5).rgb;
  vec3 lin = pow(c, vec3(2.2));
  vec3 hdr = lin / max(vec3(1.0) - lin * 0.86, vec3(0.08));
  vec3 bloom = texture(uBloom, iuv).rgb * 8.0;
  vec3 halo = texture(uHalo, iuv).rgb * 8.0;

  float over = clamp(uEv / 3.0, 0.0, 1.0);
  float under = clamp(-uEv / 3.0, 0.0, 1.0);
  float gain = exp2(uEv * (1.0 + 0.45 * under));
  vec3 scene = hdr * gain;
  scene += bloom * gain * (0.07 + 0.2 * over);
  scene += halo * gain * vec3(1.0, 0.3, 0.07) * (0.14 + 0.5 * over);

  float text = texture(uText, suv).a;
  float tBloom = texture(uTextBloom, suv).r;
  float tHalo = texture(uTextHalo, suv).r;
  float capI = 1.25 * exp2(max(uEv, 0.0) * 1.1 + min(uEv, 0.0) * 0.62);
  scene = mix(scene, vec3(capI), text);
  scene += tBloom * capI * vec3(1.0, 0.96, 0.9) * (0.26 + 0.95 * over);
  scene += tHalo * max(capI - 1.0, 0.0) * vec3(1.0, 0.34, 0.08) * 0.85;

  vec2 gp = floor(gl_FragCoord.xy / uGrainScale);
  float n = hash(gp + uFrame * 17.31) + hash(gp * 1.7 + uFrame * 3.17) - 1.0;
  vec3 chroma = vec3(hash(gp + uFrame * 5.1), hash(gp + uFrame * 7.7 + 3.0), hash(gp + uFrame * 9.3 + 7.0)) - 0.5;
  float shadowNoise = 0.0035 * pow(gain, 0.9);
  scene += (n + chroma * 0.8) * shadowNoise;
  scene += vec3(0.006, 0.0045, 0.004) * gain * over;
  scene = max(scene, 0.0);

  vec3 col = pow(tone(scene), vec3(1.0 / 2.2));
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.18 + 0.3 * under);
  col = pow(col, vec3(1.0 + under * 0.9));

  float aspect = uRes.x / uRes.y;
  vec2 fromCentre = suv - 0.5;
  float vig = length(fromCentre * vec2(aspect, 1.0) / max(aspect, 1.0) * 1.1);
  col *= mix(1.0, smoothstep(1.1, 0.25, vig), 0.45 * (1.0 - over * 0.6));

  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col += n * 0.05 * (0.35 + 0.65 * (1.0 - abs(l - 0.45) * 1.6));

  col *= uFade;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
