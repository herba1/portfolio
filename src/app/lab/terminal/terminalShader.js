export const TERMINAL_VERTEX = `#version 300 es
precision highp float;
void main() {
  float x = gl_VertexID == 1 ? 2.0 : 0.0;
  float y = gl_VertexID == 2 ? 2.0 : 0.0;
  gl_Position = vec4(vec2(x, y) * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const TERMINAL_PERSIST = `#version 300 es
precision highp float;
uniform sampler2D uSceneTex;
uniform sampler2D uPrev;
uniform vec2 uSize;
uniform float uDecay;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 cur = texture(uSceneTex, uv).rgb;
  vec3 prev = textureLod(uPrev, uv, 0.0).rgb;
  outColor = vec4(max(cur, prev * uDecay - 0.007), 1.0);
}
`;

export const TERMINAL_DISPLAY = `#version 300 es
precision highp float;
uniform sampler2D uAccum;
uniform vec2 uRes;
uniform vec2 uScene;
uniform float uTime;
uniform float uPower;
uniform float uFlicker;
uniform float uCurve;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 c = uv * 2.0 - 1.0;
  vec2 cs = c * (1.0 + uCurve * vec2(c.y * c.y, c.x * c.x));
  vec2 edge = 1.0 - abs(cs);
  float glass = smoothstep(0.0, 0.012, edge.x) * smoothstep(0.0, 0.018, edge.y);
  float sx = max(smoothstep(0.0, 0.32, uPower), 0.004);
  float sy = max(smoothstep(0.28, 1.0, uPower), 0.006);
  vec2 cp = cs / vec2(sx, sy);
  float inside = step(abs(cp.x), 1.0) * step(abs(cp.y), 1.0);
  vec2 su = clamp(cp * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = textureLod(uAccum, su, 0.0).rgb;
  vec3 bloom = textureLod(uAccum, su, 2.0).rgb * 0.28 + textureLod(uAccum, su, 3.5).rgb * 0.34 + textureLod(uAccum, su, 5.0).rgb * 0.42;
  float row = (1.0 - su.y) * uScene.y / 3.0;
  float scan = 0.5 + 0.5 * cos(row * 6.2831853);
  col *= mix(0.58, 1.0, scan);
  col += bloom * 0.85;
  col *= inside;
  col *= 1.0 + 2.2 * (1.0 - smoothstep(0.55, 1.0, uPower));
  col *= 1.0 - uFlicker;
  float r = length(cs * vec2(0.92, 1.0));
  vec3 base = vec3(0.034, 0.05, 0.042) * (1.0 - 0.55 * r * r);
  float rim = (1.0 - smoothstep(0.0, 0.05, min(edge.x, edge.y))) * smoothstep(0.0, 0.01, min(edge.x, edge.y));
  base += vec3(0.05, 0.065, 0.058) * rim * (0.4 + 0.6 * smoothstep(-0.2, 1.0, c.y - 0.3 * c.x));
  vec2 rp = (c - vec2(-0.5, 0.62)) * vec2(0.7, 1.4);
  vec3 refl = vec3(0.55, 0.7, 0.64) * 0.026 * (1.0 - smoothstep(0.0, 0.9, length(rp)));
  float vig = 1.0 - smoothstep(0.55, 1.45, r);
  col = base + col * mix(0.5, 1.0, vig) + refl;
  col += (hash(gl_FragCoord.xy + fract(uTime * 7.13) * 91.0) - 0.5) * 0.02;
  col = clamp(col, 0.0, 1.0);
  outColor = vec4(col * glass, glass);
}
`;
