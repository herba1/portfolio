export const PINS_VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const PINS_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform vec2 uRes;
uniform float uScale;
uniform vec3 uField;
uniform vec2 uGrid;
uniform vec3 uPlate;
uniform sampler2D uHeight;

out vec4 outColor;

const float ROW = 0.8660254;
const float FLUSH = 0.13;
const float RAISED = 0.47;
const vec3 LOW = vec3(0.22, 0.225, 0.24);
const vec3 HIGH = vec3(0.965, 0.96, 0.95);
const vec2 LIGHT = vec2(-0.6, -0.8);

float pinHeight(vec2 cell) {
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= uGrid.x || cell.y >= uGrid.y) return -1.0;
  return texelFetch(uHeight, ivec2(cell), 0).r;
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  vec2 q = (px - uField.xy) / uField.z;
  float j0 = floor(q.y / ROW);

  float best = 1e3;
  vec2 bestD = vec2(0.0);
  float bestH = 0.0;
  float bestR = 1.0;
  for (int dj = -1; dj <= 1; dj += 1) {
    float j = j0 + float(dj);
    float shift = mod(j, 2.0) * 0.5;
    float i = floor(q.x - shift);
    vec2 cell = vec2(i, j);
    float h = pinHeight(cell);
    if (h < 0.0) continue;
    float e = smoothstep(0.0, 1.0, h);
    float r = mix(FLUSH, RAISED, e);
    vec2 d = q - vec2(i + 0.5 + shift, (j + 0.5) * ROW);
    float sd = length(d) - r;
    if (sd < best) {
      best = sd;
      bestD = d;
      bestH = e;
      bestR = r;
    }
  }

  float aa = max(fwidth(best), 1e-4) * 0.75;
  float head = 1.0 - smoothstep(-aa, aa, best);

  vec2 off = normalize(LIGHT) * bestR * 0.34;
  float crescent = smoothstep(-aa, aa, length(bestD - off) - bestR);
  vec3 face = mix(LOW, HIGH, pow(bestH, 0.85));
  vec3 shade = face * mix(0.78, 0.62, bestH);
  vec3 pin = mix(face, shade, crescent);

  vec3 col = mix(uPlate, pin, head);
  outColor = vec4(col, 1.0);
}
`;
