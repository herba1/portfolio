export const QUAD_VS = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const GLASS_FS = `#version 300 es
precision highp float;
uniform sampler2D uPoster;
uniform vec2 uStage;
uniform vec2 uRes;
uniform vec4 uPane;
uniform float uRib;
uniform float uMode;
uniform float uFade;
uniform vec3 uPaper;
out vec4 outColor;

float hash1(float n) {
  return fract(sin(n * 127.1 + 11.3) * 43758.5453);
}

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash1(i), hash1(i + 1.0), u);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash2(i);
  float b = hash2(i + vec2(1.0, 0.0));
  float c = hash2(i + vec2(0.0, 1.0));
  float d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec3 poster(vec2 p, float lod) {
  return textureLod(uPoster, clamp(p / uStage, vec2(0.0005), vec2(0.9995)), lod).rgb;
}

void main() {
  float px = uStage.x / uRes.x;
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) * px;
  float x0 = uPane.x;
  float x1 = uPane.x + uPane.y;
  float y0 = uPane.z;
  float y1 = uPane.z + uPane.w;
  float inPane = smoothstep(x0 - px, x0 + px, p.x) * (1.0 - smoothstep(x1 - px, x1 + px, p.x));
  inPane *= smoothstep(y0 - px, y0 + px, p.y) * (1.0 - smoothstep(y1 - px, y1 + px, p.y));
  vec3 clear = poster(p, 0.0);
  vec2 nearest = clamp(p, vec2(x0, y0), vec2(x1, y1));
  float outside = length(p - nearest);
  float shadow = (1.0 - smoothstep(0.0, 22.0, outside)) * step(0.001, outside);
  clear *= 1.0 - 0.05 * shadow * shadow;
  if (inPane < 0.001) {
    outColor = vec4(mix(uPaper, clear, uFade), 1.0);
    return;
  }

  float local = (p.x - x0) / uRib;
  float band = floor(local);
  float warpA = (noise2(vec2(local * 0.22, p.y * 0.003)) - 0.5) * 0.12;
  float warpP = (noise2(vec2(local * 0.35, p.y * 0.0042)) - 0.5) * 0.7 + (noise1(band * 0.61 + p.y * 0.0016) - 0.5) * 0.55;
  float domain = local + mix(warpA, warpP, uMode);
  float cell = fract(domain);
  float u = cell * 2.0 - 1.0;
  float au = abs(u);
  float body = max(0.0, 1.0 - u * u);
  float normA = u * pow(body, 1.08) * 0.7;
  float shoulder = smoothstep(0.08, 0.52, au) * (1.0 - smoothstep(0.62, 0.98, au));
  float detail = noise2(vec2(domain * 1.7, p.y * 0.011)) - 0.5;
  float normP = u * (body * 0.38 + shoulder * 0.84) * (1.0 + detail * 0.5) + detail * body * 0.3;
  float normal = mix(normA, normP, uMode);
  float spread = mix(3.4, 4.6, uMode) * uRib;
  vec2 q = p + vec2(-normal * spread, 0.0);
  q.y += uMode * (noise2(vec2(floor(domain) * 0.37, p.y * 0.012)) - 0.5) * 9.0;
  float edge = smoothstep(0.55, 0.98, au);
  float ca = edge * sign(u) * mix(1.1, 1.2, uMode);
  float lod = mix(0.6, 1.1, uMode);
  vec3 glass;
  glass.r = poster(q + vec2(ca, 0.0), lod).r;
  glass.g = poster(q, lod).g;
  glass.b = poster(q - vec2(ca, 0.0), lod).b;
  float shade = 1.0 - 0.13 * pow(cell, 1.3) - 0.05 * edge;
  float lineW = 1.4 * px / uRib;
  float rim = 1.0 - smoothstep(0.0, lineW, cell);
  float glow = smoothstep(0.08, 0.0, abs(cell - 0.18)) * 0.5;
  vec3 tint = vec3(0.975, 0.99, 0.985);
  glass = glass * shade * tint + vec3(1.0) * (rim * 0.38 + glow * 0.06);
  float inner = min(min(p.x - x0, x1 - p.x), min(p.y - y0, y1 - p.y));
  float seam = smoothstep(4.0 * px, 0.0, inner);
  float seamLine = smoothstep(1.4 * px, 0.0, abs(inner - 1.0 * px));
  glass = mix(glass, glass * 0.8, seam * 0.5);
  glass += seamLine * 0.22;
  vec3 col = mix(clear, glass, inPane);
  col += (hash2(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(mix(uPaper, col, uFade), 1.0);
}
`;
