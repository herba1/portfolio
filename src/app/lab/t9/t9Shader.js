export const T9_VERTEX = `#version 300 es
precision highp float;
void main() {
  float x = gl_VertexID == 1 ? 2.0 : 0.0;
  float y = gl_VertexID == 2 ? 2.0 : 0.0;
  gl_Position = vec4(vec2(x, y) * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const T9_DISPLAY = `#version 300 es
precision highp float;
uniform sampler2D uLcd;
uniform vec2 uRes;
uniform vec2 uGrid;
uniform float uDpr;
uniform float uRadius;
uniform float uGlow;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float lit(vec2 g) {
  vec2 id = floor(g);
  if (id.x < 0.0 || id.y < 0.0 || id.x >= uGrid.x || id.y >= uGrid.y) return 0.0;
  return texelFetch(uLcd, ivec2(id), 0).r;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float cell = uRes.x / (uGrid.x + 6.0);
  vec2 g = p / cell - 3.0;
  vec2 f = fract(g);
  float aa = 0.7 / cell;
  float gap = 0.075;
  float bx = smoothstep(gap - aa, gap + aa, f.x) * (1.0 - smoothstep(1.0 - gap - aa, 1.0 - gap + aa, f.x));
  float by = smoothstep(gap - aa, gap + aa, f.y) * (1.0 - smoothstep(1.0 - gap - aa, 1.0 - gap + aa, f.y));
  float box = bx * by;
  float v = lit(g);
  vec2 so = vec2(0.32, 0.3);
  vec2 sg = g - so;
  vec2 sf = fract(sg);
  float sbox = smoothstep(0.0, 0.25, sf.x) * smoothstep(0.0, 0.25, sf.y) * smoothstep(1.0, 0.75, sf.x) * smoothstep(1.0, 0.75, sf.y);
  float shade = lit(sg) * mix(0.55, 1.0, sbox);
  vec2 uv = p / uRes;
  vec2 c = uv - vec2(0.5, 0.56);
  float r = length(c * vec2(1.0, uRes.y / uRes.x) * 1.7);
  vec3 lightCol = vec3(0.70, 0.82, 0.50);
  vec3 edgeCol = vec3(0.55, 0.67, 0.39);
  vec3 bg = mix(lightCol, edgeCol, smoothstep(0.0, 1.1, r));
  bg *= mix(0.62, 1.0, uGlow);
  bg += vec3(0.03, 0.035, 0.02) * (1.0 - smoothstep(0.0, 0.4, uv.y));
  vec3 ink = vec3(0.075, 0.11, 0.085);
  vec3 col = bg * (1.0 - shade * 0.17);
  vec3 off = col * 0.962;
  vec3 pix = mix(off, ink, clamp(v, 0.0, 1.0) * 0.93);
  float inGrid = step(0.0, g.x) * step(0.0, g.y) * step(g.x, uGrid.x) * step(g.y, uGrid.y);
  col = mix(col, pix, box * inGrid);
  col += (hash(gl_FragCoord.xy) - 0.5) * 0.018;
  vec2 q = abs(gl_FragCoord.xy - uRes * 0.5) - (uRes * 0.5 - uRadius);
  float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  float alpha = 1.0 - smoothstep(-uDpr, 0.0, dist);
  float rim = 1.0 - smoothstep(0.0, cell * 1.6, -dist);
  col *= 1.0 - rim * 0.22;
  outColor = vec4(clamp(col, 0.0, 1.0) * alpha, alpha);
}
`;
