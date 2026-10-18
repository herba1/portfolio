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
uniform vec4 uField;
uniform vec2 uGrid;
uniform float uDepth;
uniform vec3 uLight;
uniform sampler2D uHeight;

out vec4 outColor;

const float ROW = 0.8660254;
const float RADIUS = 0.43;

float pinHeight(vec2 cell) {
  if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= uGrid.x || cell.y >= uGrid.y) return 0.0;
  return texelFetch(uHeight, ivec2(cell), 0).r * uDepth;
}

float fieldHeight(vec2 q) {
  vec2 uv = vec2(q.x / uGrid.x, q.y / ROW / uGrid.y);
  return texture(uHeight, uv).r * uDepth;
}

vec3 tone(vec3 c) {
  vec3 m = vec3(1.0) - exp(-c * 1.4);
  return pow(m, vec3(1.0 / 2.2));
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  vec2 q = (px - uField.xy) / uField.z;
  float W = uGrid.x;
  float H = uGrid.y * ROW;
  float pad = 1.4;
  if (q.x < -pad || q.y < -pad || q.x > W + 0.5 + pad || q.y > H + pad) {
    outColor = vec4(0.925, 0.92, 0.91, 1.0);
    return;
  }
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 L = normalize(uLight);
  vec2 Lxy = normalize(L.xy);
  float rise = L.z / max(length(L.xy), 0.001);

  float j = floor(q.y / ROW);
  float shift = mod(j, 2.0) * 0.5;
  float i = floor(q.x - shift);
  vec2 cell = vec2(i, j);
  vec2 centre = vec2(i + 0.5 + shift, (j + 0.5) * ROW);
  vec2 d = q - centre;
  float r = length(d);
  float inside = cell.x >= 0.0 && cell.y >= 0.0 && cell.x < uGrid.x && cell.y < uGrid.y ? 1.0 : 0.0;

  float h = pinHeight(cell);
  float aa = fwidth(r) * 1.2;
  float head = (1.0 - smoothstep(RADIUS - aa, RADIUS + aa, r)) * inside;

  float k = clamp(r / RADIUS, 0.0, 1.0);
  float dome = sqrt(max(1.0 - k * k, 0.0));
  vec3 n = normalize(vec3(d / RADIUS * 0.85, dome + 0.15));
  float z = mix(h - 0.8, h + 0.2 + dome * 0.2, head);

  float shadow = 1.0;
  float t = 0.35;
  for (int s = 0; s < 18; s += 1) {
    vec2 sq = q + Lxy * t;
    float sh = fieldHeight(sq);
    float ray = z + t * rise;
    shadow = min(shadow, smoothstep(-0.7, 0.25, ray - sh));
    t += 0.45 + t * 0.08;
  }
  shadow = mix(0.1, 1.0, shadow);

  float nb = (pinHeight(cell + vec2(1.0, 0.0)) + pinHeight(cell - vec2(1.0, 0.0)) + pinHeight(cell + vec2(0.0, 1.0)) + pinHeight(cell - vec2(0.0, 1.0))) * 0.25;
  float ao = clamp(1.0 - max(nb - h, 0.0) * 0.12, 0.45, 1.0);

  vec3 Hv = normalize(L + V);
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, Hv), 0.0), 40.0) * 1.6;
  float sheen = pow(max(dot(n, Hv), 0.0), 12.0) * 0.25;
  vec3 steel = vec3(0.62, 0.64, 0.68);
  float lift = mix(0.22, 1.15, clamp(h / max(uDepth, 0.001), 0.0, 1.0));
  vec3 headCol = (steel * (0.14 + diff * 0.55) + vec3(spec + sheen)) * lift * shadow * ao;
  headCol += steel * 0.05 * (1.0 - n.z);

  float depthShade = clamp(0.25 + h / max(uDepth, 0.001) * 0.35, 0.0, 1.0);
  vec3 gap = vec3(0.04, 0.042, 0.048) * (0.6 + depthShade) * mix(0.5, 1.0, shadow) * inside;
  vec3 col = mix(gap, headCol, head);

  float frameIn = min(min(q.x + pad, W + 0.5 + pad - q.x), min(q.y + pad, H + pad - q.y));
  float rim = smoothstep(0.0, 0.25, frameIn) * (1.0 - smoothstep(pad - 0.6, pad - 0.2, frameIn));
  vec3 frame = vec3(0.1, 0.1, 0.11) + vec3(0.06) * smoothstep(0.0, pad, frameIn);
  col = mix(col, frame, rim * (1.0 - head));

  outColor = vec4(tone(col), 1.0);
}
`;
