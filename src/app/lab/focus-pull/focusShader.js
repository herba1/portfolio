export const FOCUS_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
uniform vec4 uRect;
uniform vec4 uUv;
uniform vec2 uRes;
out vec2 vUv;
void main() {
  vec2 px = uRect.xy + aCorner * uRect.zw;
  vUv = uUv.xy + aCorner * uUv.zw;
  vec2 clip = px / uRes * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`;

export const BAKE_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
out vec2 vUv;
void main() {
  vUv = aCorner;
  gl_Position = vec4(aCorner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const BAKE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uRadius;
out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  float count = clamp(floor(uRadius * uRadius * 0.5), 16.0, 64.0);
  float lod = max(0.0, log2(uRadius * 1.7725 / sqrt(count)) - 0.25);
  float spin = hash(gl_FragCoord.xy) * 6.2831853;
  vec4 a = vec4(0.0);
  float total = 0.0;
  for (int i = 0; i < 64; i++) {
    float fi = float(i);
    if (fi >= count) break;
    float r = sqrt((fi + 0.5) / count);
    float ang = fi * 2.3999632 + spin;
    vec2 off = vec2(cos(ang), sin(ang)) * r * uRadius;
    float w = 1.0 + 0.35 * smoothstep(0.7, 1.0, r);
    a += textureLod(uTex, vUv + off * uTexel, lod) * w;
    total += w;
  }
  outColor = a / total;
}
`;

export const FOCUS_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vUv;
uniform sampler2D uTex;
uniform sampler2DArray uStack;
uniform vec2 uTexel;
uniform float uLevel;
out vec4 outColor;

vec4 sharpAt(vec2 uv) {
  return textureLod(uTex, uv, 0.0);
}

vec4 levelAt(float k) {
  if (k < 0.5) return sharpAt(vUv);
  return texture(uStack, vec3(vUv, k - 1.0));
}

void main() {
  float base = floor(uLevel);
  float f = uLevel - base;
  vec4 c = levelAt(base);
  if (f > 0.001) c = mix(c, levelAt(base + 1.0), f);
  outColor = c;
}
`;
