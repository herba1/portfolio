export const QUAD_VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const POSTER_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTone;
uniform sampler2D uWord0;
uniform sampler2D uWord1;
uniform sampler2D uRows;
uniform vec2 uRes;
uniform float uDpr;
uniform vec4 uRect;
uniform vec4 uImage;
uniform vec4 uBand;
uniform float uSqueegee;
uniform float uActive;
uniform vec4 uTarget;
uniform vec3 uInks[12];
uniform vec3 uPage;
uniform vec3 uStock;
out vec4 outColor;

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

float simplexish(vec2 p) {
  return valueNoise(p) * 2.0 - 1.0;
}

float fbm3(vec2 p) {
  float r = simplexish(p);
  r += simplexish(p * 2.0) / 2.0;
  r += simplexish(p * 4.0) / 4.0;
  return r / 1.75;
}

float shadeLevel(vec2 uv, float low, float high) {
  float shade = 1.0;
  for (int i = 0; i < 5; i++) {
    float f = float(i) / 5.0;
    float s = mix(1.0, 4.0, f) * 6.0;
    vec2 offset = 0.006 * vec2(fbm3(s * uv + 1.0), fbm3(s * uv.yx + 7.0));
    float l = texture(uTone, clamp(uv + offset, vec2(0.0), vec2(1.0))).r;
    l = smoothstep(low, high, l);
    l = floor(l * 5.0 + 0.5) / 5.0;
    if (l <= f) {
      shade = f;
      break;
    }
  }
  return shade;
}

float borderAt(vec2 uv) {
  vec2 offset = 0.004 * vec2(fbm3(9.0 * uv + 3.0), fbm3(9.0 * uv.yx + 5.0));
  float g = texture(uTone, clamp(uv + offset, vec2(0.0), vec2(1.0))).g;
  return smoothstep(0.5, 0.62, g);
}

vec2 jitter(float seed, float layer) {
  return (vec2(hash(vec2(seed, layer)), hash(vec2(layer, seed + 3.7))) - 0.5) * 2.4;
}

void main() {
  vec2 css = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 local = css - uRect.xy;
  float grain = (valueNoise(css * uDpr / 1.4) - 0.5) * 0.018 + (valueNoise(css * 0.08) - 0.5) * 0.012;
  vec3 color = uPage + grain * 0.6;
  bool inside = local.x >= 0.0 && local.y >= 0.0 && local.x <= uRect.z && local.y <= uRect.w;
  if (inside) {
    vec3 stock = uStock + grain;
    float fibre = smoothstep(0.78, 0.98, valueNoise(vec2(css.x * 0.04, css.y * 0.6) + 11.0));
    stock -= fibre * 0.012;
    color = stock;
    float rowIndex = clamp(floor(local.y / uRect.w * 1024.0), 0.0, 1023.0);
    vec4 row = texelFetch(uRows, ivec2(0, int(rowIndex)), 0);
    float flood = 0.0;
    if (uActive > 0.5) {
      float u = local.x / uRect.z * 2.0 - 1.0;
      float edge = uSqueegee - (1.0 - u * u) * 3.0;
      if (local.y < edge) row = uTarget;
      flood = smoothstep(edge + 7.0, edge + 1.0, local.y) * step(edge, local.y);
    }
    float exposure = row.r;
    int palette = int(floor(row.g * 255.0 + 0.5));
    float seed = floor(row.b * 255.0 + 0.5);
    float wordSlot = row.a;
    vec3 navy = uInks[palette * 4 + 0];
    vec3 red = uInks[palette * 4 + 1];
    vec3 blue = uInks[palette * 4 + 2];
    vec3 cream = uInks[palette * 4 + 3];
    float low = mix(-0.12, 0.3, exposure);
    float high = mix(0.72, 1.12, exposure);
    float mottle = valueNoise(css * 0.35 + seed) * 0.5 + valueNoise(css * 1.7 + seed * 3.0) * 0.5;
    float pin = step(0.999, hash(floor(css * uDpr * 0.8) + seed)) * step(0.55, valueNoise(css * 0.05 + seed));
    float inkBody = (1.0 - pin) * (0.93 + 0.07 * mottle);

    vec2 imageLocal = local - uImage.xy;
    bool inImage = imageLocal.x >= 0.0 && imageLocal.y >= 0.0 && imageLocal.x <= uImage.z && imageLocal.y <= uImage.w;
    vec2 bandLocal = local - uBand.xy;
    bool inBand = bandLocal.x >= 0.0 && bandLocal.y >= 0.0 && bandLocal.x <= uBand.z && bandLocal.y <= uBand.w;

    if (inImage || inBand) {
      color = mix(color, min(color, cream * (0.98 + 0.04 * mottle)), inkBody);
    }
    if (inImage) {
      vec2 uvBlue = (imageLocal + jitter(seed, 1.0)) / uImage.zw;
      vec2 uvRed = (imageLocal + jitter(seed, 2.0)) / uImage.zw;
      vec2 uvNavy = (imageLocal + jitter(seed, 3.0)) / uImage.zw;
      float sBlue = shadeLevel(uvBlue, low, high);
      float stripes = mod(local.y, 7.0) > 3.5 ? 1.0 : 0.0;
      float blueMask = sBlue < 0.5 ? 1.0 : (sBlue < 0.7 ? stripes : 0.0);
      float sRed = shadeLevel(uvRed, low, high);
      float redMask = sRed < 0.3 ? 1.0 : 0.0;
      float sNavy = shadeLevel(uvNavy, low, high);
      float navyMask = max(sNavy < 0.1 ? 1.0 : 0.0, borderAt(uvNavy));
      color = mix(color, blue * (0.97 + 0.05 * mottle), blueMask * inkBody);
      color = mix(color, red * (0.97 + 0.05 * mottle), redMask * inkBody);
      color = mix(color, navy * (0.96 + 0.06 * mottle), navyMask * inkBody);
    }
    if (inBand) {
      vec2 wordUv = (bandLocal + jitter(seed, 3.0)) / uBand.zw;
      float word0 = texture(uWord0, wordUv).r;
      float word1 = texture(uWord1, wordUv).r;
      float word = wordSlot > 0.5 ? word1 : word0;
      color = mix(color, navy * (0.96 + 0.06 * mottle), (1.0 - word) * inkBody);
    }
    vec3 wet = mix(uInks[int(floor(uTarget.g * 255.0 + 0.5)) * 4], vec3(1.0), 0.08);
    color = mix(color, wet, flood * 0.9);
    float shine = smoothstep(0.0, 1.0, flood) * (0.5 + 0.5 * valueNoise(vec2(local.x * 0.15, uSqueegee * 0.2)));
    color += shine * 0.07;
  } else {
    vec2 d = max(vec2(0.0), max(uRect.xy - css, css - (uRect.xy + uRect.zw)));
    float dist = length(d);
    vec2 below = css - vec2(uRect.x + uRect.z * 0.5, uRect.y + uRect.w);
    float drop = exp(-dist / 10.0) * 0.07 + exp(-dist / 34.0) * 0.05 * smoothstep(-uRect.w * 0.5, 0.0, below.y + uRect.w * 0.2);
    color *= 1.0 - drop;
  }
  outColor = vec4(color, 1.0);
}
`;
