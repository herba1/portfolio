export const MOIRE_VERTEX = `#version 300 es
precision highp float;
const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  gl_Position = vec4(corners[gl_VertexID], 0.0, 1.0);
}
`;

export const MOIRE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uImgA;
uniform sampler2D uImgB;
uniform float uMix;
uniform vec4 uRectA;
uniform vec4 uRectB;
uniform vec2 uRes;
uniform float uDpr;
uniform float uPeriod;
uniform float uTime;
uniform float uWarp;
uniform float uFreq;
uniform vec3 uTop;
uniform vec2 uCenter;
uniform float uMaskOn;
uniform vec2 uBand;
uniform float uFade;
out vec4 outColor;

const float TAU = 6.28318530718;

float warp(vec2 p) {
  float x = p.x * uFreq;
  float y = p.y * uFreq;
  float t = uTime;
  return uWarp * (sin(x * 1.0 + 1.3 * sin(y * 0.8 + t * 0.07)) + 0.6 * sin(y * 1.7 - 0.9 * sin(x * 1.3 - t * 0.05) + 2.0) + 0.35 * sin((x + y) * 2.3 + t * 0.04));
}

float image(sampler2D tex, vec4 rect, vec2 p) {
  vec2 uv = (p - rect.xy) / rect.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return texture(tex, uv).r;
}

float ink(float phase, float duty) {
  float s = phase / TAU;
  float f = fract(s);
  float w = max(fwidth(s), 1e-4) * 0.5;
  float a = smoothstep(-w, w, f) - smoothstep(duty - w, duty + w, f) + smoothstep(1.0 - w, 1.0 + w, f);
  return clamp(a, 0.0, 1.0) * step(0.002, duty);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float duty = 0.5;
  if (uMaskOn > 0.5) {
    duty *= step(uBand.x, p.y) * step(p.y, uBand.y);
  }
  float img = mix(image(uImgA, uRectA, p), image(uImgB, uRectB, p), uMix);
  float k = TAU / uPeriod;
  float base = p.y * k + warp(p) + 3.14159265 * img;
  float c = cos(uTop.z);
  float s = sin(uTop.z);
  vec2 r = p - uCenter - uTop.xy;
  vec2 q = vec2(c * r.x + s * r.y, -s * r.x + c * r.y) + uCenter;
  float top = q.y * k + warp(q);
  float t1 = 1.0 - ink(base, duty);
  float t2 = 1.0 - ink(top, duty);
  float v = t1 * t2;
  outColor = vec4(vec3(mix(1.0, v, uFade)), 1.0);
}
`;
