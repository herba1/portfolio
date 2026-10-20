export const BRISTLES = 16;

export const QUAD_VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const STATE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform sampler2D uPaint;
uniform vec2 uSize;
uniform vec4 uSeg[${BRISTLES}];
uniform float uPickup;
out vec4 outColor;

vec3 mixPigment(vec3 a, vec3 b, float t) {
  vec3 m = mix(a, b, t);
  float strength = mix(max(a.r, max(a.g, a.b)), max(b.r, max(b.g, b.b)), t);
  float peak = max(m.r, max(m.g, m.b));
  return peak > 0.0001 ? m * (strength / peak) : m;
}

void main() {
  int i = int(gl_FragCoord.x);
  vec4 carried = texelFetch(uState, ivec2(i, 0), 0);
  vec2 at = uSeg[i].zw;
  vec4 under = texture(uPaint, at / uSize);
  float wet = smoothstep(0.08, 0.9, under.a);
  carried.rgb = mixPigment(carried.rgb, under.rgb, uPickup * wet);
  outColor = carried;
}
`;

export const SPLAT_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uPaint;
uniform sampler2D uState;
uniform vec2 uSize;
uniform vec4 uSeg[${BRISTLES}];
uniform vec2 uBristle[${BRISTLES}];
uniform vec2 uMotion;
uniform float uLoad;
uniform float uScrape;
uniform float uSmear;
uniform float uTop;
out vec4 outColor;

vec3 mixPigment(vec3 a, vec3 b, float t) {
  vec3 m = mix(a, b, t);
  float strength = mix(max(a.r, max(a.g, a.b)), max(b.r, max(b.g, b.b)), t);
  float peak = max(m.r, max(m.g, m.b));
  return peak > 0.0001 ? m * (strength / peak) : m;
}

float segment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float len = dot(ab, ab);
  float t = len > 0.0001 ? clamp(dot(p - a, ab) / len, 0.0, 1.0) : 0.0;
  return distance(p, a + ab * t);
}

void main() {
  vec2 p = gl_FragCoord.xy;
  vec4 here = texture(uPaint, p / uSize);
  float cover = 0.0;
  float deposit = 0.0;
  float weight = 0.0;
  vec3 tint = vec3(0.0);
  for (int i = 0; i < ${BRISTLES}; i++) {
    float d = segment(p, uSeg[i].xy, uSeg[i].zw);
    float c = clamp(1.0 - d / uBristle[i].x, 0.0, 1.0);
    cover = max(cover, c);
    deposit = max(deposit, c * uBristle[i].y);
    tint += texelFetch(uState, ivec2(i, 0), 0).rgb * c;
    weight += c;
  }
  if (cover <= 0.0) {
    outColor = here;
    return;
  }
  tint /= max(weight, 0.0001);
  vec4 dragged = texture(uPaint, (p - uMotion * uSmear * cover) / uSize);
  vec4 old = mix(here, dragged, smoothstep(0.0, 0.6, cover));
  float kept = old.a * (1.0 - uScrape * deposit);
  float laid = deposit * uLoad;
  float total = kept + laid;
  float top = min(kept, uTop);
  vec3 pigment = top + laid > 0.0001 ? mixPigment(old.rgb, tint, laid / (top + laid)) : old.rgb;
  outColor = vec4(pigment, total);
}
`;

export const COPY_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uSource;
out vec4 outColor;
void main() {
  outColor = texelFetch(uSource, ivec2(gl_FragCoord.xy), 0);
}
`;

export const PAINT_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uPaint;
uniform vec2 uSize;
uniform vec2 uOutput;
uniform float uTexel;
uniform float uNormalScale;
uniform vec3 uLight;
uniform float uRoughness;
uniform float uF0;
uniform float uDiffuse;
uniform float uSpecular;
uniform vec3 uGround;
out vec4 outColor;

const float PI = 3.14159265;

vec3 trilinear(vec3 p, vec3 v000, vec3 v100, vec3 v010, vec3 v001, vec3 v101, vec3 v011, vec3 v110, vec3 v111) {
  return v000 * (1.0 - p.x) * (1.0 - p.y) * (1.0 - p.z) +
    v100 * p.x * (1.0 - p.y) * (1.0 - p.z) +
    v010 * (1.0 - p.x) * p.y * (1.0 - p.z) +
    v001 * (1.0 - p.x) * (1.0 - p.y) * p.z +
    v101 * p.x * (1.0 - p.y) * p.z +
    v011 * (1.0 - p.x) * p.y * p.z +
    v110 * p.x * p.y * (1.0 - p.z) +
    v111 * p.x * p.y * p.z;
}

vec3 rybToRgb(vec3 ryb) {
  return trilinear(clamp(ryb, 0.0, 1.0),
    vec3(1.0, 1.0, 1.0),
    vec3(1.0, 0.0, 0.0),
    vec3(0.12, 0.26, 0.58),
    vec3(1.0, 1.0, 0.0),
    vec3(1.0, 0.5, 0.0),
    vec3(0.0, 0.66, 0.2),
    vec3(0.5, 0.0, 0.5),
    vec3(0.2, 0.094, 0.0));
}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float weave(vec2 texel) {
  vec2 q = texel / uTexel;
  vec2 cell = floor(q / 3.0);
  float warp = sin(q.x * 2.0944) * 0.5 + 0.5;
  float weft = sin(q.y * 2.0944) * 0.5 + 0.5;
  float over = mod(cell.x + cell.y, 2.0);
  return mix(warp * 0.7 + weft * 0.3, weft * 0.7 + warp * 0.3, over) * 0.09 + hash(floor(q)) * 0.03;
}

vec4 sampleAt(vec2 texel) {
  return texture(uPaint, texel / uSize);
}

float heightAt(vec2 texel) {
  float h = sampleAt(texel).a;
  return h + weave(texel) * (1.0 - smoothstep(0.0, 0.8, h));
}

float ggx(float alpha, float nDotH) {
  float a2 = alpha * alpha;
  float k = nDotH * nDotH * (a2 - 1.0) + 1.0;
  return a2 / (PI * k * k);
}

float smith(float alpha, float nDotL, float nDotV) {
  float a2 = alpha * alpha;
  float gl = nDotL + sqrt(a2 + (1.0 - a2) * nDotL * nDotL);
  float gv = nDotV + sqrt(a2 + (1.0 - a2) * nDotV * nDotV);
  return 1.0 / (gl * gv);
}

float fresnel(float f0, float lDotH) {
  return (1.0 - f0) * pow(1.0 - lDotH, 5.0) + f0;
}

void main() {
  vec2 texel = gl_FragCoord.xy / uOutput * uSize;
  vec4 value = sampleAt(texel);
  float tl = heightAt(texel + vec2(-1.0, 1.0));
  float t = heightAt(texel + vec2(0.0, 1.0));
  float tr = heightAt(texel + vec2(1.0, 1.0));
  float l = heightAt(texel + vec2(-1.0, 0.0));
  float r = heightAt(texel + vec2(1.0, 0.0));
  float bl = heightAt(texel + vec2(-1.0, -1.0));
  float b = heightAt(texel + vec2(0.0, -1.0));
  float br = heightAt(texel + vec2(1.0, -1.0));
  vec2 gradient = vec2(
    tl - tr + 2.0 * l - 2.0 * r + bl - br,
    -tl + bl - 2.0 * t + 2.0 * b - tr + br
  );
  vec3 normal = normalize(vec3(gradient, uNormalScale));
  vec3 light = normalize(uLight);
  vec3 eye = vec3(0.0, 0.0, 1.0);
  vec3 halfway = normalize(light + eye);
  float nDotH = clamp(dot(normal, halfway), 0.0, 1.0);
  float nDotL = clamp(dot(normal, light), 0.0, 1.0);
  float nDotV = clamp(dot(normal, eye), 0.0, 1.0);
  float lDotH = clamp(dot(light, halfway), 0.0, 1.0);
  float body = smoothstep(0.0, 0.7, value.a);
  float gloss = ggx(uRoughness, nDotH) * smith(uRoughness, nDotL, nDotV) * fresnel(uF0, lDotH);
  float diffuse = 1.0 + uDiffuse * (nDotL - light.z);
  vec3 pigment = mix(uGround, rybToRgb(value.rgb) * mix(vec3(1.0), uGround, 0.08), body);
  vec3 color = pigment * diffuse + gloss * uSpecular * mix(0.35, 1.0, body);
  outColor = vec4(color, 1.0);
}
`;

export const RESAMPLE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uSize;
out vec4 outColor;
void main() {
  outColor = texture(uSource, gl_FragCoord.xy / uSize);
}
`;
