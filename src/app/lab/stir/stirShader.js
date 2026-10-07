export const STIR_VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const STIR_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uAtlas;
uniform sampler2D uText;
uniform sampler2D uDye;
uniform vec2 uOrigin;
uniform vec2 uCell;
uniform vec2 uGrid;
uniform vec2 uAtlasSize;
uniform float uAtlasColumns;
uniform float uGlyphRows;
uniform float uMasters;
uniform float uMasterBase;
uniform float uMasterStep;
uniform float uCanvasHeight;
uniform float uReveal;
uniform float uRestWeight;
uniform float uEntryWeight;
uniform float uWeightRange;
uniform float uRevealSweep;
uniform float uRevealJitter;
uniform float uRevealCell;
uniform vec4 uRings[4];
uniform vec3 uInk;
uniform vec3 uPaper;

out vec4 fragColor;

float hash21(vec2 p) {
  p = mod(p, 137.0);
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float coverage(float slot, float master, vec2 local) {
  float column = mod(slot, uAtlasColumns);
  float block = floor(slot / uAtlasColumns);
  vec2 tile = vec2(column, master * uGlyphRows + block) * uCell;
  return textureLod(uAtlas, (tile + local) / uAtlasSize, 0.0).a;
}

void main() {
  vec2 pixel = vec2(gl_FragCoord.x, uCanvasHeight - gl_FragCoord.y) - uOrigin;
  vec2 cellCoord = pixel / uCell;
  vec2 cell = floor(cellCoord);
  vec3 colour = uPaper;

  if (cell.x >= 0.0 && cell.y >= 0.0 && cell.x < uGrid.x && cell.y < uGrid.y) {
    float code = floor(texelFetch(uText, ivec2(cell), 0).r * 255.0 + 0.5);
    if (code > 0.5) {
      float dye = textureLod(uDye, cellCoord / uGrid, 0.0).r;
      float ring = 0.0;
      float ringWidth = uCell.y * 1.4;
      for (int index = 0; index < 4; index++) {
        vec4 wave = uRings[index];
        float band = (length(pixel - wave.xy) - wave.z) / ringWidth;
        ring += wave.w * exp(-band * band);
      }

      float seed = hash21(cell);
      float arrive = clamp((uReveal - (cell.x / uGrid.x) * uRevealSweep - seed * uRevealJitter) / uRevealCell, 0.0, 1.0);
      float settle = 1.0 - pow(1.0 - arrive, 3.0);

      float stir = smoothstep(0.0, 1.0, clamp(dye + ring, 0.0, 1.0));
      float weight = mix(uEntryWeight, uRestWeight, settle) + uWeightRange * stir;
      float master = clamp((weight - uMasterBase) / uMasterStep, 0.0, uMasters - 1.0);
      float lower = floor(master);
      float upper = min(lower + 1.0, uMasters - 1.0);
      vec2 local = pixel - cell * uCell;
      float slot = code - 1.0;
      float ink = mix(coverage(slot, lower, local), coverage(slot, upper, local), master - lower);
      ink *= smoothstep(0.0, 0.4, arrive);
      colour = mix(uPaper, uInk, ink);
    }
  }

  float dither = (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
  fragColor = vec4(colour + dither, 1.0);
}
`;
