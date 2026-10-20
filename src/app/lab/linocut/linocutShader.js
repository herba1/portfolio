export const POST_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const POST_FRAGMENT = `
precision highp float;
uniform sampler2D tScene;
uniform vec2 uSize;
uniform vec4 uImage;
uniform float uDpr;
uniform vec2 uCenter;
uniform float uScale;
uniform float uSwirl;
uniform float uNoise;
uniform float uSeed;
uniform vec3 uPaper;
uniform vec3 uInk;
varying vec2 vUv;

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

float carve(vec2 fragCoord, vec2 res, vec2 sceneUv, float lumaShift) {
  vec2 d = fragCoord - uCenter * res;
  float r = length(d) / (1000.0 / max(uScale, 0.01));
  float a = atan(d.y, d.x) + uSwirl * (0.5 - r) / 0.5;
  vec2 uvt = uCenter * res + r * vec2(cos(a), sin(a));
  float c = 0.75 + 0.25 * sin(uvt.x * 1000.0 * max(uScale, 0.01));
  vec3 color = texture2D(tScene, sceneUv).rgb;
  float l = mix(0.36, 1.04, pow(dot(color, vec3(0.299, 0.587, 0.114)), 1.15)) + lumaShift;
  l += uNoise * (valueNoise(fragCoord * 0.9) - 0.5);
  float f = smoothstep(0.5 * c, c, l);
  return smoothstep(0.0, 0.5, f);
}

void main() {
  vec2 css = vec2(vUv.x, 1.0 - vUv.y) * uSize;
  float grain = (valueNoise(css * uDpr / 1.3) - 0.5) * 0.03 + (valueNoise(css * 0.06) - 0.5) * 0.02;
  float fibre = smoothstep(0.8, 0.98, valueNoise(vec2(css.x * 0.03, css.y * 0.5) + 7.0));
  vec3 paper = uPaper + grain - fibre * 0.015;
  vec3 color = paper;
  vec2 local = css - uImage.xy;
  vec2 edgeNoise = vec2(valueNoise(vec2(css.y * 0.08, 3.0)), valueNoise(vec2(css.x * 0.08, 9.0))) * 2.5;
  bool inside = local.x > edgeNoise.x && local.y > edgeNoise.y && local.x < uImage.z - edgeNoise.y && local.y < uImage.w - edgeNoise.x;
  if (inside) {
    vec2 sceneUv = vec2(local.x / uImage.z, 1.0 - local.y / uImage.w);
    vec2 res = uImage.zw;
    vec2 frag = vec2(local.x, uImage.w - local.y);
    float white = carve(frag, res, sceneUv, 0.0);
    float pooled = carve(frag + vec2(0.5, -0.5), res, sceneUv, -0.03);
    float ink = 1.0 - min(white, mix(white, pooled, 0.6));
    float starve = smoothstep(0.25, 0.7, valueNoise(css * 0.025 + uSeed)) * 0.5 + smoothstep(0.62, 0.9, valueNoise(css * 0.4 + uSeed * 2.0)) * 0.6;
    float edgeFade = smoothstep(0.0, 26.0, min(min(local.x, uImage.z - local.x), min(local.y, uImage.w - local.y)));
    float density = clamp(0.97 - starve * 0.12 - (1.0 - edgeFade) * 0.12 * valueNoise(css * 0.3), 0.0, 1.0);
    float speck = step(0.998, hash(floor(css * uDpr * 0.6) + uSeed));
    density *= 1.0 - speck;
    color = mix(paper, uInk + grain * 0.3, ink * density);
  }
  gl_FragColor = vec4(color, 1.0);
}
`;

export const WAVE_CHUNK = `
uniform float uTime;
uniform vec4 uWaves[4];
uniform float uSpeeds[4];
vec3 wave(vec2 p) {
  float h = 0.0;
  vec2 d = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    vec4 w = uWaves[i];
    float phase = w.w * dot(w.xy, p) + uTime * uSpeeds[i];
    h += w.z * sin(phase);
    d += w.z * w.w * w.xy * cos(phase);
  }
  return vec3(h, d);
}
`;
