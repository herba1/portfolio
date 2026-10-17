export const MAX_SEGMENTS = 48;
export const MAX_DRIP_UNIFORMS = 14;

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

export const RESAMPLE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uRes;
out vec4 outColor;
void main() {
  outColor = texture(uSource, gl_FragCoord.xy / uRes);
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
  for (int i = -7; i <= 7; i++) {
    float x = float(i);
    float w = exp(-x * x / 24.0);
    sum += texture(uSource, clamp(uv + stepUv * x, vec2(0.0), vec2(1.0))).rgb * w;
    total += w;
  }
  outColor = vec4(sum / max(total, 1e-4), 1.0);
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

export const FIELD_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform vec2 uRes;
uniform vec2 uBox;
uniform float uDt;
uniform float uBreathing;
uniform float uEvap;
uniform float uWaterEvap;
uniform float uResidueDecay;
uniform vec4 uBreath[2];
uniform vec2 uBreathSeed;
uniform int uCount;
uniform vec4 uSeg[${MAX_SEGMENTS}];
uniform vec4 uSegP[${MAX_SEGMENTS}];
out vec4 outColor;
${NOISE}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = vec2(uv.x, 1.0 - uv.y) * uBox;
  vec4 c = texture(uPrev, uv);
  float fog = c.r;
  float water = c.g;
  float residue = c.b;
  float warm = c.a;

  vec2 o = 2.0 / uRes;
  float near = (texture(uPrev, uv + vec2(o.x, 0.0)).r + texture(uPrev, uv - vec2(o.x, 0.0)).r + texture(uPrev, uv + vec2(0.0, o.y)).r + texture(uPrev, uv - vec2(0.0, o.y)).r) * 0.25;
  vec2 w = 7.0 / uRes;
  float wide = (texture(uPrev, uv + w).r + texture(uPrev, uv - w).r + texture(uPrev, uv + vec2(w.x, -w.y)).r + texture(uPrev, uv + vec2(-w.x, w.y)).r) * 0.25;

  float spread = clamp(warm * uDt * 7.0 * uBreathing, 0.0, 0.35);
  fog = mix(fog, near, spread);

  float grain = valueNoise(p * 0.016 + 3.1) * 0.65 + valueNoise(p * 0.061 + 9.4) * 0.35;
  float front = 1.0 - smoothstep(0.04, 0.75, min(wide, fog + 0.2));
  float rate = uEvap * (0.4 + 0.75 * min(fog, 1.0)) * (0.45 + 1.1 * grain) * (1.0 + 1.4 * front) * (1.0 - clamp(warm, 0.0, 1.0) * 0.85);
  fog = max(fog - rate, 0.0);

  for (int k = 0; k < 2; k++) {
    vec4 b = uBreath[k];
    if (b.w <= 0.0) continue;
    float seed = k == 0 ? uBreathSeed.x : uBreathSeed.y;
    vec2 d = p - b.xy;
    float len = length(d);
    vec2 dir = d / max(len, 1e-3);
    float wob = 1.0 + 0.34 * (valueNoise(dir * 1.7 + seed) - 0.5) + 0.22 * (valueNoise(p * 0.024 + seed * 1.3) - 0.5);
    float r = len / max(wob, 0.4);
    float sigma2 = max(2.0 * b.z * b.z, 1.0);
    float g = exp(-min(r * r / sigma2, 40.0));
    float add = b.w * g * (1.0 - residue * 0.66);
    fog = min(fog + add * max(1.0 - fog / 1.3, 0.0), 1.2);
    warm = max(warm, g * clamp(b.w * 60.0, 0.0, 1.0));
  }
  warm = max(warm - uDt / 1.3, 0.0);

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
    if (d > r * 1.5) continue;
    float wobble = 0.86 + 0.14 * valueNoise(p * 0.11 + sp.w) + 0.06 * valueNoise(p * 0.37 + sp.w * 2.0);
    float body = 1.0 - smoothstep(r * 0.4, r * wobble, d);
    float rim = smoothstep(r * 0.72, r * 1.02, d) * (1.0 - smoothstep(r * 1.06, r * 1.45, d));
    if (sp.z < 0.5) {
      water = min(water + rim * fog * 0.5 * sp.y, 1.3);
      water *= 1.0 - body * sp.y * 0.9;
      residue = max(residue, body * 0.92);
    } else {
      float film = 0.25 + 0.3 * valueNoise(p * 0.5 + sp.w);
      water = max(water, body * film);
      residue = max(residue, body * 0.5);
    }
    fog *= 1.0 - body * sp.y;
  }

  water = max(water - uWaterEvap * (0.7 + 0.6 * grain), 0.0);
  residue = max(residue - uResidueDecay, 0.0);
  outColor = vec4(fog, water, residue, warm);
}
`;

export const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uSharpA;
uniform sampler2D uBlurA;
uniform sampler2D uSharpB;
uniform sampler2D uBlurB;
uniform sampler2D uField;
uniform vec4 uCropA;
uniform vec4 uMapA;
uniform vec4 uGradeA;
uniform vec4 uTintA;
uniform float uLodA;
uniform vec4 uCropB;
uniform vec4 uMapB;
uniform vec4 uGradeB;
uniform vec4 uTintB;
uniform float uLodB;
uniform vec3 uLight;
uniform float uGlow;
uniform float uMix;
uniform vec2 uBox;
uniform float uDpr;
uniform int uDripCount;
uniform vec4 uDrip[${MAX_DRIP_UNIFORMS}];
out vec4 outColor;
${NOISE}
vec3 tinted(vec3 c, vec4 t) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(c, t.rgb * (l * 0.7 + max(c.r, max(c.g, c.b)) * 0.3), t.a);
}
vec3 gradeColor(vec3 c, vec4 g) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, g.x) * g.y;
  c += vec3(-0.5, -0.12, 0.6) * g.z * 0.06 * (1.0 - l);
  c = mix(vec3(0.5 * g.y), c, g.w);
  return clamp(c, 0.0, 1.0);
}
vec2 cropUv(vec2 p, vec4 map) {
  return clamp((p - map.xy) * map.zw, vec2(0.0), vec2(1.0));
}
vec3 sharpAt(vec2 p, float lod) {
  vec3 b = gradeColor(textureLod(uSharpB, uCropB.xy + cropUv(p, uMapB) * uCropB.zw, max(uLodB + lod, 0.0)).rgb, uGradeB);
  b = tinted(b, uTintB);
  if (uMix >= 0.999) return b;
  vec3 a = gradeColor(textureLod(uSharpA, uCropA.xy + cropUv(p, uMapA) * uCropA.zw, max(uLodA + lod, 0.0)).rgb, uGradeA);
  a = tinted(a, uTintA);
  return mix(a, b, uMix);
}
vec3 softAt(vec2 p) {
  vec3 b = tinted(gradeColor(texture(uBlurB, cropUv(p, uMapB)).rgb, uGradeB), uTintB);
  if (uMix >= 0.999) return b;
  vec3 a = tinted(gradeColor(texture(uBlurA, cropUv(p, uMapA)).rgb, uGradeA), uTintA);
  return mix(a, b, uMix);
}
vec4 speck(vec2 p, float cell, float seed, float amount, float bias) {
  float ang = seed * 1.37;
  vec2 cs = vec2(cos(ang), sin(ang));
  vec2 pr = vec2(p.x * cs.x - p.y * cs.y, p.x * cs.y + p.y * cs.x);
  vec2 id = floor(pr / cell);
  vec2 f = pr - id * cell;
  float h0 = hash12(id + seed);
  if (h0 > amount) return vec4(0.0);
  float h1 = hash12(id + seed + 17.13);
  float h2 = hash12(id + seed + 41.71);
  float h3 = hash12(id + seed + 73.37);
  float r = max(cell * (0.08 + 0.3 * h1 * h1) * (0.55 + 0.45 * bias), 0.45);
  float room = max(cell - 2.0 * (r + 0.5), 0.0);
  vec2 c = vec2(r + 0.5) + vec2(h2, h3) * room;
  vec2 v = f - c;
  float d = length(v);
  float aa = 0.6 / uDpr;
  float cov = 1.0 - smoothstep(r - aa, r + aa, d);
  if (cov <= 0.0) return vec4(0.0);
  vec2 n = v / max(r, 0.5);
  float nl = length(n);
  n = nl > 1.0 ? n / nl : n;
  return vec4(n.x * cs.x + n.y * cs.y, -n.x * cs.y + n.y * cs.x, r, cov);
}
vec3 lensShade(vec2 p, vec4 b, float reach, float lod, vec3 under, float shine) {
  vec2 n = b.xy;
  float rho2 = clamp(dot(n, n), 0.0, 1.0);
  vec3 refr = mix(sharpAt(p - n * (b.z * reach + 5.0), lod), under, 0.25);
  vec3 N = normalize(vec3(n * 0.9, sqrt(max(1.0 - rho2 * 0.81, 0.0)) + 1e-3));
  vec3 H = normalize(vec3(-0.3, -0.6, 1.3));
  float spec = pow(max(dot(N, H), 0.0), 36.0);
  float rim = smoothstep(0.45, 1.0, rho2);
  vec3 col = refr * (1.06 - rim * 0.46);
  col += vec3(1.0, 0.98, 0.95) * spec * shine;
  return col;
}
void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 res = uBox * uDpr;
  vec2 uv = fc / res;
  vec2 p = vec2(fc.x, res.y - fc.y) / uDpr;
  vec4 f = texture(uField, uv);
  float fog = f.r;
  float water = f.g;
  float film = f.b;
  float warm = f.a;

  float n1 = valueNoise(p * 0.045);
  float n2 = valueNoise(p * 0.17 + 7.0);
  float n3 = valueNoise(p * 0.55 + 3.0);
  float tex = n1 * 0.55 + n2 * 0.3 + n3 * 0.15;
  float present = smoothstep(0.0, 0.08, fog);
  float dens = clamp(fog * 1.12 + (tex - 0.5) * 0.5 * present * (1.0 - smoothstep(0.6, 1.1, fog)), 0.0, 1.0);
  float cov = mix((1.0 - exp(-dens * 2.4)) / (1.0 - exp(-2.4)), smoothstep(0.03, 0.24, dens), 0.3);
  cov *= 1.0 - 0.62 * smoothstep(0.1, 0.8, film);

  vec3 soft = softAt(p);
  vec3 sharp = sharpAt(p, cov * 2.6);
  vec3 view = mix(sharp, soft, smoothstep(0.04, 0.5, cov));
  float l = dot(soft, vec3(0.2126, 0.7152, 0.0722));
  vec3 lamp = mix(vec3(1.0), uLight, 0.6);
  float thick = clamp(fog - 0.55, 0.0, 0.6);
  vec3 scatter = mix(soft, vec3(l), 0.45) * 0.84 + lamp * (uGlow + 0.08 + l * 0.26 + thick * 0.06);
  float hot = clamp(warm, 0.0, 1.0);
  scatter = mix(scatter, scatter * vec3(1.03, 1.0, 0.96) + vec3(0.025), hot);
  vec3 col = mix(view, scatter, cov * (0.8 + 0.08 * hot));

  float edge = clamp(dens * (1.0 - dens) * 4.0, 0.0, 1.0);
  vec4 m1 = speck(p, 2.4, 1.7, 0.5 * present, 0.35 + 0.25 * dens);
  if (m1.w > 0.0) col = mix(col, lensShade(p, m1, 1.2, 2.2, scatter, 0.12), m1.w * cov * 0.1);
  vec4 m2 = speck(p + vec2(1.3, 2.1), 5.2, 5.3, 0.3 * edge * present, 0.4 + 0.4 * edge);
  if (m2.w > 0.0) col = mix(col, lensShade(p, m2, 1.8, 1.4, view, 0.25), m2.w * 0.36);

  float wet = smoothstep(0.06, 0.6, water);
  if (wet > 0.0) {
    vec4 b1 = speck(p, 6.0, 3.1, 0.42 * wet, 0.25 + 0.4 * wet);
    if (b1.w > 0.0) col = mix(col, lensShade(p, b1, 2.6, 0.5, view, 0.5), b1.w * 0.9);
    vec4 b2 = speck(p + vec2(3.7, 5.3), 13.0, 9.7, 0.3 * smoothstep(0.3, 1.0, water), 0.3 + 0.4 * wet);
    if (b2.w > 0.0) col = mix(col, lensShade(p, b2, 2.8, 0.4, view, 0.6), b2.w);
  }

  for (int i = 0; i < ${MAX_DRIP_UNIFORMS}; i++) {
    if (i >= uDripCount) break;
    vec4 d = uDrip[i];
    float r = d.z;
    if (r < 0.3) continue;
    vec2 q = p - d.xy;
    float tail = 1.0 + d.w * 1.9;
    if (abs(q.x) > r * 1.6 || q.y > r * 1.6 || q.y < -r * (1.6 + tail)) continue;
    q.y /= q.y < 0.0 ? tail : 1.0;
    float dd = length(q) / r;
    float aa = 0.9 / max(uDpr * r, 0.5);
    float halo = (1.0 - smoothstep(1.0, 1.35, dd)) * smoothstep(0.9, 1.0, dd);
    col *= 1.0 - halo * 0.12;
    float cv = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, dd);
    if (cv <= 0.0) continue;
    vec2 n = q / r;
    float nl = length(n);
    n = nl > 1.0 ? n / nl : n;
    col = mix(col, lensShade(p, vec4(n, r, cv), 3.4, 0.6, view, 0.8) * 1.02, cv);
  }

  col *= vec3(0.985, 0.995, 1.012);
  vec2 q = p / uBox - 0.5;
  float vig = smoothstep(0.35, 0.95, length(q * vec2(1.0, 0.86)) * 1.25);
  col *= 1.0 - vig * 0.16;
  col += vec3(0.85, 0.92, 1.0) * 0.025 * (1.0 - smoothstep(0.0, 0.9, length(p / uBox - vec2(0.9, -0.05))));
  col += (hash12(fc * 0.73 + 3.1) - 0.5) * (2.0 / 255.0);
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
