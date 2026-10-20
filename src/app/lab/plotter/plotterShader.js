export const QUAD_VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const DOT_VERTEX = `#version 300 es
in vec2 aPoint;
in vec2 aInfo;
uniform float uRadius;
uniform float uFeather;
out float vRadius;
out float vAccent;
out float vSpan;
void main() {
  vRadius = uRadius * aInfo.x;
  vAccent = aInfo.y;
  vSpan = ceil(vRadius + uFeather + 1.0) * 2.0;
  gl_PointSize = vSpan;
  gl_Position = vec4(aPoint.x * 2.0 - 1.0, 1.0 - aPoint.y * 2.0, 0.0, 1.0);
}
`;

export const DOT_FRAGMENT = `#version 300 es
precision highp float;
uniform float uFeather;
in float vRadius;
in float vAccent;
in float vSpan;
out vec4 outColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * vSpan;
  float a = 1.0 - smoothstep(vRadius - uFeather, vRadius + uFeather, d);
  outColor = vAccent > 0.5 ? vec4(0.0, a, 0.0, 1.0) : vec4(a, 0.0, 0.0, 1.0);
}
`;

export const PLOT_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uMask;
uniform sampler2D uRows;
uniform vec2 uRes;
uniform float uDpr;
uniform vec4 uRect;
uniform float uGantry;
uniform vec2 uTarget;
uniform float uActive;
uniform float uBand;
uniform float uLift;
uniform vec3 uPaper;
uniform vec3 uInks[3];
uniform vec3 uAccents[3];
out vec4 outColor;

const float BLEED = 0.3;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  vec2 eased = local * local * (3.0 - 2.0 * local);
  float a = hash(cell);
  float b = hash(cell + vec2(1.0, 0.0));
  float c = hash(cell + vec2(0.0, 1.0));
  float d = hash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, eased.x), mix(c, d, eased.x), eased.y);
}

void main() {
  vec2 css = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 pixel = css - uRect.xy;
  float grain = (valueNoise(css * uDpr / 1.3) - 0.5) * 0.016;
  float tooth = (valueNoise(css * 0.35 + 11.0) - 0.5) * 0.018;
  vec3 paper = clamp(uPaper + grain + tooth, 0.0, 1.0);
  vec3 color = paper;
  bool inside = pixel.x >= 0.0 && pixel.y >= 0.0 && pixel.x <= uRect.z && pixel.y <= uRect.w;
  if (inside) {
    float rowIndex = clamp(floor(pixel.y / uRect.w * 1024.0), 0.0, 1023.0);
    vec2 row = floor(texelFetch(uRows, ivec2(0, int(rowIndex)), 0).rg * 255.0 + 0.5);
    float fade = 1.0;
    if (uActive > 0.5) {
      float ragged = valueNoise(vec2(pixel.x * 0.09, floor(pixel.y / 3.0) * 0.7));
      float front = uGantry - uBand * (0.25 + 0.75 * ragged);
      if (pixel.y < front && pixel.y > uGantry - uBand - 4.0) {
        row = uTarget;
      } else if (pixel.y >= front && (abs(row.x - uTarget.x) > 0.5 || abs(row.y - uTarget.y) > 0.5)) {
        fade = smoothstep(uGantry, uGantry + uLift, pixel.y);
      }
    }
    int pen = int(clamp(row.y, 0.0, 2.0));
    vec3 ink = uInks[pen];
    vec3 accentInk = uAccents[pen];
    vec2 uv = vec2(pixel.x / uRect.z, 1.0 - pixel.y / uRect.w);
    vec2 dots = row.x > 2.5 && row.x < 3.5 ? texture(uMask, uv).rg : vec2(0.0);
    dots *= fade;
    float variation = valueNoise(pixel / 4.2 + 41.2) * BLEED * 0.35 + (1.0 - BLEED * 0.2);
    color = mix(color, color * accentInk, clamp(dots.y * variation, 0.0, 1.0));
    color = mix(color, color * ink, clamp(dots.x * variation * 1.04, 0.0, 1.0));
  }
  outColor = vec4(color, 1.0);
}
`;
