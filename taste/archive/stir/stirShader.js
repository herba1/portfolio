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
uniform sampler2D uField;
uniform sampler2D uTint;
uniform sampler2D uLanes;
uniform vec4 uStrokeSlots;
uniform float uStainLift;
uniform float uTintFrom;
uniform float uTintFull;
uniform float uTintStrength;
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
uniform float uPeakWeight;
uniform vec2 uRevealCentre;
uniform float uRevealSpan;
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
  vec2 inside = clamp(local, vec2(0.5), uCell - 0.5);
  return textureLod(uAtlas, (tile + inside) / uAtlasSize, 0.0).a;
}

void main() {
  vec2 pixel = vec2(gl_FragCoord.x, uCanvasHeight - gl_FragCoord.y) - uOrigin;
  float row = floor(pixel.y / uCell.y);
  vec3 colour = uPaper;

  if (pixel.x >= 0.0 && row >= 0.0 && row < uGrid.y) {
    vec2 lane = texelFetch(uLanes, ivec2(int(row), 0), 0).rg;
    float stripLength = max(lane.y, 1.0);
    float stripX = pixel.x + lane.x;
    float stripCell = floor(stripX / uCell.x);
    float column = stripCell - stripLength * floor((stripCell + 0.5) / stripLength);
    float glyphX = (stripCell + 0.5) * uCell.x - lane.x;
    vec2 glyphCentre = vec2(glyphX, (row + 0.5) * uCell.y);
    ivec2 home = ivec2(int(clamp(floor(glyphX / uCell.x), 0.0, uGrid.x - 1.0)), int(row));
    float code = floor(texelFetch(uText, ivec2(int(column), int(row)), 0).r * 255.0 + 0.5);
    vec4 flow = texelFetch(uField, home, 0);
    float core = textureLod(uField, glyphCentre / uCell / uGrid, 0.0).g;
    if (code > 0.5 || core > 0.35) {
      vec2 fieldUv = vec2(pixel.x / uCell.x, row + 0.5) / uGrid;
      float dye = textureLod(uField, fieldUv, 0.0).r;
      vec4 wash = textureLod(uTint, fieldUv, 0.0);
      float stain = clamp(wash.a, 0.0, 1.0);
      float ring = 0.0;
      float ringWidth = uCell.y * 1.4;
      for (int index = 0; index < 4; index++) {
        vec4 wave = uRings[index];
        float band = (length(pixel - wave.xy) - wave.z) / ringWidth;
        ring += wave.w * exp(-band * band);
      }

      float seed = hash21(vec2(column, row));
      float spread = length(glyphCentre - uRevealCentre) / uRevealSpan;
      float arrive = clamp((uReveal - spread * uRevealSweep - seed * uRevealJitter) / uRevealCell, 0.0, 1.0);
      float settle = 1.0 - pow(1.0 - arrive, 3.0);

      float swapT = smoothstep(0.35, 0.65, core);
      float swapDip = 4.0 * swapT * (1.0 - swapT);
      float stir = smoothstep(0.0, 1.0, clamp(dye + ring, 0.0, 1.0));
      float linger = smoothstep(0.0, 1.0, stain) * uStainLift * (1.0 - stir);
      float weight = mix(mix(uEntryWeight, uRestWeight, settle), uPeakWeight, stir) + linger - uMasterStep * swapDip;
      float master = clamp((weight - uMasterBase) / uMasterStep, 0.0, uMasters - 1.0);
      float lower = floor(master);
      float upper = min(lower + 1.0, uMasters - 1.0);
      float blend = master - lower;
      vec2 local = vec2(stripX - stripCell * uCell.x, pixel.y - row * uCell.y);
      float ink = 0.0;
      if (code > 0.5) {
        float slot = code - 1.0;
        ink = mix(coverage(slot, lower, local), coverage(slot, upper, local), blend);
      }
      if (swapT > 0.0) {
        float strokeSlot = uStrokeSlots[int(flow.b + 0.5) & 3];
        float stroke = mix(coverage(strokeSlot, lower, local), coverage(strokeSlot, upper, local), blend);
        float turning = smoothstep(0.0, 1.0, fract(flow.a));
        if (turning > 0.0) {
          float fromSlot = uStrokeSlots[int(floor(flow.a) + 0.5) & 3];
          float fromStroke = mix(coverage(fromSlot, lower, local), coverage(fromSlot, upper, local), blend);
          stroke = mix(stroke, fromStroke, turning);
        }
        ink = max(ink * (1.0 - swapT), stroke * swapT);
      }
      ink *= smoothstep(0.0, 0.4, arrive);

      vec3 hue = clamp(wash.rgb / max(wash.a, 1e-3), 0.0, 1.0);
      float tint = smoothstep(uTintFrom, uTintFull, stain) * uTintStrength;
      colour = mix(uPaper, mix(uInk, hue, tint), ink);
    }
  }

  float dither = (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
  fragColor = vec4(colour + dither, 1.0);
}
`;
