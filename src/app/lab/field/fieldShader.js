export const FIELD_VERTEX = `#version 300 es
precision highp float;
const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  gl_Position = vec4(corners[gl_VertexID], 0.0, 1.0);
}
`;

export const FIELD_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform highp usampler2D uCells;
uniform sampler2D uAtlas;
uniform vec2 uOrigin;
uniform vec2 uCell;
uniform vec2 uGrid;
uniform float uHeight;
uniform float uAtlasCols;
uniform vec3 uGround;
uniform vec3 uInk;
uniform vec3 uHot;
uniform float uFade;
out vec4 outColor;
void main() {
  vec2 p = vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y) - uOrigin;
  vec3 color = uGround;
  vec2 cellF = floor(p / uCell);
  if (p.x >= 0.0 && p.y >= 0.0 && cellF.x < uGrid.x && cellF.y < uGrid.y) {
    uvec4 c = texelFetch(uCells, ivec2(cellF), 0);
    float glyph = float(c.r);
    float level = float(c.g) / 255.0;
    if (glyph > 0.0 && level > 0.0) {
      ivec2 local = ivec2(p - cellF * uCell);
      float gx = mod(glyph, uAtlasCols);
      float gy = floor(glyph / uAtlasCols);
      ivec2 texel = ivec2(int(gx * uCell.x) + local.x, int(gy * uCell.y) + local.y);
      vec4 a = texelFetch(uAtlas, texel, 0);
      float core = a.r * level;
      float halo = a.g * level * level * 0.55;
      vec3 ink = mix(uInk, uHot, smoothstep(0.72, 1.0, level) * a.r * 0.7);
      color = uGround + ink * core + uInk * halo * 0.5;
    }
  }
  outColor = vec4(mix(uGround, color, uFade), 1.0);
}
`;
