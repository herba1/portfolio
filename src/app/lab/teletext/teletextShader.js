export const TELETEXT_VERTEX = `#version 300 es
precision highp float;
void main() {
  float x = gl_VertexID == 1 ? 2.0 : 0.0;
  float y = gl_VertexID == 2 ? 2.0 : 0.0;
  gl_Position = vec4(vec2(x, y) * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const TELETEXT_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec4 uBox;
uniform vec2 uSrc;
uniform float uTime;
uniform float uFade;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = (frag - uBox.xy) / uBox.zw;
  vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  float inBox = inside.x * inside.y;
  vec2 cuv = clamp(uv, vec2(0.0), vec2(1.0));
  float dx = 0.3 / uSrc.x;
  vec3 c = textureLod(uTex, cuv, 0.0).rgb * 0.5;
  c += textureLod(uTex, cuv + vec2(dx, 0.0), 0.0).rgb * 0.25;
  c += textureLod(uTex, cuv - vec2(dx, 0.0), 0.0).rgb * 0.25;
  float line = uv.y * uSrc.y * 0.5;
  float scan = 0.9 + 0.1 * cos(line * 6.2831853);
  c *= scan * inBox;
  vec3 bloom = textureLod(uTex, cuv, 2.0).rgb * 0.1 + textureLod(uTex, cuv, 3.5).rgb * 0.09 + textureLod(uTex, cuv, 5.0).rgb * 0.06;
  vec2 o = max(vec2(0.0), max(-uv, uv - 1.0)) * uBox.zw / uRes.y;
  float spill = exp(-length(o) * 260.0);
  c += bloom * spill;
  vec2 cc = uv * 2.0 - 1.0;
  c *= 1.0 - 0.12 * dot(cc, cc) * inBox;
  c = c * vec3(0.96, 0.97, 0.95);
  c = 1.0 - exp(-c * 1.55);
  c += (hash(frag + fract(uTime * 9.1) * 37.0) - 0.5) * 0.012 * inBox;
  outColor = vec4(max(c, 0.0) * uFade, 1.0);
}
`;
