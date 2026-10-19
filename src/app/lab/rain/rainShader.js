export const MAX_SEGMENTS = 64;
export const FIELD_EDGE = 0.226;

export const QUAD_VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const COPY_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform vec4 uCrop;
uniform vec2 uRes;
uniform float uLod;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  outColor = vec4(textureLod(uImage, uCrop.xy + uv * uCrop.zw, uLod).rgb, 1.0);
}
`;

export const BLUR_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uRes;
uniform vec2 uDir;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 stepUv = uDir / uRes;
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = -6; i <= 6; i++) {
    float x = float(i);
    float w = exp(-x * x / 18.0);
    sum += texture(uSource, clamp(uv + stepUv * x, vec2(0.0), vec2(1.0))).rgb * w;
    total += w;
  }
  outColor = vec4(sum / max(total, 1e-4), 1.0);
}
`;

export const DROP_VERTEX = `#version 300 es
in vec2 aPosition;
in vec4 aDrop;
uniform vec2 uBox;
out vec2 vLocal;
out float vRadius;
out float vStretch;
void main() {
  float r = max(aDrop.z, 0.0);
  float st = clamp(aDrop.w, 0.0, 1.0);
  vec2 ext = vec2(r * 1.6 + 2.0, r * 1.6 * (1.0 + st) + 2.0);
  vec2 center = aDrop.xy + vec2(0.0, -r * 0.45 * st);
  vec2 p = center + aPosition * ext;
  vLocal = p - aDrop.xy;
  vRadius = r;
  vStretch = st;
  gl_Position = vec4(p.x / uBox.x * 2.0 - 1.0, 1.0 - p.y / uBox.y * 2.0, 0.0, 1.0);
}
`;

export const DROP_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vRadius;
in float vStretch;
uniform vec2 uStore;
out vec4 outColor;
void main() {
  float r = max(vRadius, 0.001);
  vec2 q = vLocal;
  q.y /= q.y < 0.0 ? 1.0 + vStretch * 1.1 : 1.0 + vStretch * 0.15;
  float d = length(q) / (1.6 * r);
  float s = clamp(1.0 - d * d, 0.0, 1.0);
  float g = s * s * s;
  outColor = vec4(g * uStore.x, g * r * uStore.y, 0.0, 0.0);
}
`;

export const MASK_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform vec2 uRes;
uniform vec2 uBox;
uniform float uDecay;
uniform int uCount;
uniform vec4 uSeg[${MAX_SEGMENTS}];
uniform vec4 uSegP[${MAX_SEGMENTS}];
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = vec2(uv.x, 1.0 - uv.y) * uBox;
  vec4 prev = texture(uPrev, uv);
  float clearness = max(prev.r - uDecay, 0.0);
  float wet = max(prev.g - uDecay * 5.0, 0.0);
  for (int i = 0; i < ${MAX_SEGMENTS}; i++) {
    if (i >= uCount) break;
    vec4 sg = uSeg[i];
    vec4 sp = uSegP[i];
    vec2 a = sg.xy;
    vec2 ba = sg.zw - sg.xy;
    float len2 = dot(ba, ba);
    float t = len2 > 1e-4 ? clamp(dot(p - a, ba) / len2, 0.0, 1.0) : 0.0;
    float d = length(p - a - ba * t);
    float r = max(sp.x, 0.5);
    if (d > r) continue;
    float len = sqrt(max(len2, 0.0));
    vec2 nrm = len > 1e-3 ? vec2(-ba.y, ba.x) / len : vec2(0.0, 1.0);
    float across = dot(p - a, nrm);
    float streak = 0.92 + 0.08 * sin(across * 1.7 + sp.w) * sin(across * 0.47 + sp.w * 1.7);
    float wobble = 0.86 + 0.14 * sin(dot(p, vec2(0.093, 0.061)) + sp.w) * sin(dot(p, vec2(-0.047, 0.118)) * 1.3 + sp.w * 0.7);
    float body = 1.0 - smoothstep(r * 0.3, r * wobble, d);
    clearness = max(clearness, body * sp.y * mix(1.0, streak, sp.z));
    wet = max(wet, body * sp.z * streak);
  }
  outColor = vec4(clearness, wet, 0.0, 1.0);
}
`;

const NOISE = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

export const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uSharpA;
uniform sampler2D uBlurA;
uniform sampler2D uSharpB;
uniform sampler2D uBlurB;
uniform sampler2D uHeight;
uniform sampler2D uMask;
uniform vec4 uCropA;
uniform vec4 uMapA;
uniform vec4 uGradeA;
uniform vec4 uFogA;
uniform float uLodA;
uniform vec4 uCropB;
uniform vec4 uMapB;
uniform vec4 uGradeB;
uniform vec4 uFogB;
uniform float uLodB;
uniform float uMix;
uniform vec2 uBox;
uniform float uDpr;
uniform vec2 uStore;
uniform float uFogAmount;
uniform float uEdge;
uniform float uMag;
uniform float uMagBase;
out vec4 outColor;
${NOISE}
vec3 gradeColor(vec3 c, vec4 g) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, g.x) * g.y;
  c += vec3(-0.6, -0.1, 0.7) * g.z * 0.05;
  c = mix(vec3(0.5), c, g.w);
  return clamp(c, 0.0, 1.0);
}
vec2 cropUv(vec2 p, vec4 map) {
  return clamp((p - map.xy) * map.zw, vec2(0.0), vec2(1.0));
}
vec3 sharpAt(vec2 p, float lod) {
  vec3 b = gradeColor(textureLod(uSharpB, uCropB.xy + cropUv(p, uMapB) * uCropB.zw, uLodB + lod).rgb, uGradeB);
  if (uMix >= 0.999) return b;
  vec3 a = gradeColor(textureLod(uSharpA, uCropA.xy + cropUv(p, uMapA) * uCropA.zw, uLodA + lod).rgb, uGradeA);
  return mix(a, b, uMix);
}
vec3 hazeOf(vec3 c, vec4 fog) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 milky = mix(c, vec3(l), 0.5);
  milky = mix(milky, fog.rgb, fog.a);
  return clamp(milky, 0.0, 1.0);
}
vec3 hazeAt(vec2 p) {
  vec3 b = hazeOf(gradeColor(texture(uBlurB, cropUv(p, uMapB)).rgb, uGradeB), uFogB);
  if (uMix >= 0.999) return b;
  vec3 a = hazeOf(gradeColor(texture(uBlurA, cropUv(p, uMapA)).rgb, uGradeA), uFogA);
  return mix(a, b, uMix);
}
vec4 bead(vec2 p, float cell, float seed, float fog, float density) {
  vec2 id = floor(p / cell);
  vec2 f = p - id * cell;
  float h0 = hash12(id + seed);
  if (h0 > density) return vec4(0.0);
  float h1 = hash12(id + seed + 17.13);
  float h2 = hash12(id + seed + 41.71);
  float h3 = hash12(id + seed + 73.37);
  float h4 = hash12(id + seed + 11.9);
  float r0 = cell * (0.1 + 0.2 * h1 * h1);
  float room = max(cell - 2.0 * (r0 + 1.0), 0.0);
  vec2 c = vec2(r0 + 1.0) + vec2(h2, h3) * room;
  float th = 0.34 + h4 * 0.5;
  float grow = smoothstep(th, th + 0.22, fog);
  float r = r0 * grow;
  if (r < 0.35) return vec4(0.0);
  vec2 v = f - c;
  float d = length(v);
  float aa = 0.7 / uDpr;
  float cov = 1.0 - smoothstep(r - aa, r + aa * 0.6, d);
  if (cov <= 0.0) return vec4(0.0);
  vec2 n = v / r;
  return vec4(n, r, cov);
}
vec3 shadeBead(vec2 p, vec4 b) {
  vec2 n = b.xy;
  float rho2 = clamp(dot(n, n), 0.0, 1.0);
  vec3 refr = hazeAt(p - n * (b.z * 3.0 + 9.0));
  vec3 N = vec3(n * 0.9, sqrt(max(1.0 - rho2 * 0.81, 0.0)));
  vec3 H = normalize(vec3(-0.22, -0.55, 1.35));
  float spec = pow(max(dot(N, H), 0.0), 40.0);
  float rim = smoothstep(0.5, 1.0, rho2);
  vec3 col = refr * (1.04 - rim * 0.42);
  col += vec3(1.0, 0.99, 0.96) * spec * 0.55;
  return col;
}
void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 res = uBox * uDpr;
  vec2 uv = fc / res;
  vec2 p = vec2(fc.x, res.y - fc.y) / uDpr;
  vec2 texel = 1.0 / res;
  vec2 h0 = texture(uHeight, uv).rg;
  float field = h0.r / uStore.x;
  float hx1 = texture(uHeight, uv + vec2(texel.x, 0.0)).r;
  float hx0 = texture(uHeight, uv - vec2(texel.x, 0.0)).r;
  float hy1 = texture(uHeight, uv + vec2(0.0, texel.y)).r;
  float hy0 = texture(uHeight, uv - vec2(0.0, texel.y)).r;
  vec2 grad = vec2(hx1 - hx0, hy0 - hy1) * (0.5 * uDpr / uStore.x);
  float meanR = (h0.g / uStore.y) / max(field, 1e-3);
  float aa = max(fwidth(field), 1e-3) * 0.85;
  float drop = smoothstep(uEdge - aa, uEdge + aa, field);

  vec4 m = texture(uMask, uv);
  float clearness = m.r;
  float wet = m.g;
  float creep = valueNoise(p * 0.03) * 0.65 + valueNoise(p * 0.11) * 0.35;
  float fog = clamp((1.0 - clearness) * 1.3 + (creep - 0.62) * 0.55, 0.0, 1.0);
  fog = fog * fog * (3.0 - 2.0 * fog);
  float fogged = fog * uFogAmount;

  vec3 glass = sharpAt(p, fogged * 2.2);
  vec3 haze = hazeAt(p);
  glass = mix(glass, haze, smoothstep(0.05, 0.95, fogged) * 0.9);
  float smear = valueNoise(vec2(p.x * 0.08, p.y * 0.9)) * valueNoise(p * 0.21);
  glass += wet * smear * 0.05;

  float beadFog = fog * (1.0 - smoothstep(uEdge * 0.35, uEdge, field));
  vec4 b1 = bead(p, 8.0, 3.1, beadFog, 0.82);
  vec4 b2 = bead(p + vec2(3.7, 5.3), 14.0, 9.7, beadFog, 0.46);
  if (b1.w > 0.0) glass = mix(glass, shadeBead(p, b1), b1.w);
  if (b2.w > 0.0) glass = mix(glass, shadeBead(p, b2), b2.w);

  float halo = smoothstep(uEdge * 0.5, uEdge, field) * (1.0 - drop);
  glass *= 1.0 - halo * 0.16;

  vec3 col = glass;
  if (drop > 0.0) {
    float rho2 = clamp((1.0 - pow(max(field, 1e-4), 1.0 / 3.0)) / 0.39, 0.0, 1.0);
    float rho = sqrt(rho2);
    float gl = length(grad);
    vec2 dir = gl > 1e-5 ? -grad / gl : vec2(0.0);
    vec2 n = dir * rho * 0.94;
    float k = meanR * uMag + uMagBase;
    float minify = max(0.94 * k / max(meanR, 0.6) - 1.0, 1.0);
    vec3 refr = sharpAt(p - n * k, log2(minify) * 0.85 + 0.4);
    float rl = dot(refr, vec3(0.2126, 0.7152, 0.0722));
    refr = mix(vec3(rl), refr, 1.12) * 1.02;
    vec3 N = vec3(n, sqrt(max(1.0 - dot(n, n), 0.0)));
    vec3 L = normalize(vec3(-0.32, -0.78, 0.62));
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float ndh = max(dot(N, H), 0.0);
    float spec = pow(ndh, 140.0) * 1.4 + pow(ndh, 22.0) * 0.1;
    float rim = smoothstep(0.55, 1.0, rho);
    float topRim = rim * (0.55 + 0.45 * clamp(-n.y * 1.2 + 0.2, 0.0, 1.0));
    vec2 away = -normalize(L.xy);
    float caustic = smoothstep(0.35, 0.9, rho) * pow(max(dot(dir, away), 0.0), 2.0) * (1.0 - smoothstep(0.92, 1.0, rho));
    vec3 dcol = refr * (1.0 - topRim * 0.62);
    dcol += refr * caustic * 0.55 + vec3(0.06) * caustic;
    dcol += vec3(1.0, 0.99, 0.97) * spec;
    float edgeLine = 1.0 - smoothstep(0.0, aa * 2.5 + 0.02, field - uEdge);
    dcol *= 1.0 - edgeLine * 0.35;
    col = mix(glass, dcol, drop);
  }

  vec2 q = p / uBox - 0.5;
  float vig = smoothstep(0.35, 0.95, length(q * vec2(1.0, 0.86)) * 1.25);
  col *= 1.0 - vig * 0.13;
  col += vec3(0.9, 0.95, 1.0) * 0.03 * (1.0 - smoothstep(0.0, 0.85, length(p / uBox - vec2(0.12, -0.05))));
  col += (hash12(fc * 0.73 + 3.1) - 0.5) * (2.0 / 255.0);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
