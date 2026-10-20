export const MARQUEE_VERTEX = `#version 300 es
precision highp float;
void main() {
  float x = gl_VertexID == 1 ? 2.0 : 0.0;
  float y = gl_VertexID == 2 ? 2.0 : 0.0;
  gl_Position = vec4(vec2(x, y) * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const MARQUEE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uDots;
uniform vec2 uRes;
uniform vec2 uOrigin;
uniform vec2 uGrid;
uniform float uPitch;
uniform float uFade;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float level(ivec2 c) {
  if (c.x < 0 || c.y < 0 || c.x >= int(uGrid.x) || c.y >= int(uGrid.y)) return 0.0;
  return texelFetch(uDots, c, 0).r;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) - uOrigin;
  vec2 g = p / uPitch;
  vec2 cell = floor(g);
  vec2 f = g - cell - 0.5;
  ivec2 ic = ivec2(cell);
  float aa = 1.2 / uPitch;
  vec2 outside = max(vec2(-0.5) - g, g - uGrid - 0.5);
  float panelD = max(outside.x, outside.y);
  float panel = 1.0 - smoothstep(0.0, 0.2, panelD);
  bool inGrid = ic.x >= 0 && ic.y >= 0 && ic.x < int(uGrid.x) && ic.y < int(uGrid.y);

  float n = hash(cell + 3.7);
  float d = length(f);
  float r = 0.39;
  float lens = inGrid ? 1.0 - smoothstep(r - aa, r + aa, d) : 0.0;
  float v = inGrid ? level(ic) : 0.0;
  float gain = 0.9 + 0.16 * n;

  vec3 amber = vec3(1.0, 0.47, 0.07);
  vec3 hot = vec3(1.0, 0.8, 0.5);
  vec3 deep = vec3(1.0, 0.3, 0.03);

  float core = 1.0 - smoothstep(0.0, r * 0.95, d);
  vec3 lit = mix(amber, hot, core * core) * (0.75 + 0.6 * core);
  vec3 col = lit * lens * v * gain * 1.25;

  vec2 hl = f - vec2(-0.11, -0.13);
  float spec = (1.0 - smoothstep(0.0, 0.11, length(hl * vec2(1.0, 1.6)))) * lens;
  float rim = smoothstep(r - 0.1, r, d) * lens;
  vec3 off = vec3(0.07, 0.035, 0.015) * (0.55 + 0.45 * (1.0 - d / r)) + vec3(0.03, 0.022, 0.016) * rim + vec3(0.07, 0.06, 0.05) * spec;
  col += off * lens * (1.0 - v * 0.9);

  float halo = 0.0;
  for (int dy = -2; dy <= 2; dy++) {
    for (int dx = -2; dx <= 2; dx++) {
      ivec2 q = ic + ivec2(dx, dy);
      float lq = level(q);
      if (lq <= 0.0) continue;
      vec2 c = vec2(q) + 0.5;
      vec2 dv = g - c;
      halo += lq * exp(-dot(dv, dv) * 2.4);
    }
  }
  col += deep * halo * 0.3 * (1.0 - lens * 0.5);

  vec2 uv = g / uGrid;
  float wide = textureLod(uDots, uv, 0.8).r * 0.7 + textureLod(uDots, uv, 1.8).r * 0.45;
  float edge = exp(-max(panelD, 0.0) * 1.6);
  col += deep * wide * 0.2 * edge;

  vec3 ground = vec3(0.018, 0.012, 0.009) * panel;
  col += ground;
  col = 1.0 - exp(-col * 1.35);
  col += (hash(gl_FragCoord.xy) - 0.5) * 0.006;
  outColor = vec4(col * uFade, 1.0);
}
`;
