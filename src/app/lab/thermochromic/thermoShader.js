export const THERMO_VERTEX = `#version 300 es
out vec2 vUv;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const THERMO_SIM = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uField;
uniform float uDiff;
uniform float uCool;
uniform float uH;
uniform vec4 uSegA[5];
uniform vec4 uSegB[5];
uniform int uCount;
uniform vec4 uStamp;
uniform float uStampAmp;

float capsule(vec2 p, vec2 a, vec2 b, float r, out float along) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  along = t;
  return length(pa - ba * t) - r;
}

float roundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float touchOf(float sd) {
  return 1.0 - smoothstep(-0.01, 0.01, sd);
}

float handHeat(vec2 uv) {
  vec2 d = uv - uStamp.xy;
  float c = cos(uStamp.z);
  float s = sin(uStamp.z);
  vec2 p = vec2(c * d.x + s * d.y, -s * d.x + c * d.y) / max(uStamp.w, 0.05);
  float along;
  vec2 palmC = vec2(0.0, 0.1);
  float palm = roundBox(p - palmC, vec2(0.104, 0.1), 0.06);
  float arch = 0.55 + 0.45 * smoothstep(0.025, 0.1, length((p - palmC - vec2(0.012, -0.012)) * vec2(1.0, 1.25)));
  float heat = touchOf(palm) * arch;
  float f = capsule(p, vec2(-0.068, -0.03), vec2(-0.118, -0.212), 0.021, along);
  heat = max(heat, touchOf(f) * (0.7 + 0.3 * smoothstep(0.55, 0.85, along)));
  f = capsule(p, vec2(-0.02, -0.04), vec2(-0.03, -0.248), 0.022, along);
  heat = max(heat, touchOf(f) * (0.7 + 0.3 * smoothstep(0.55, 0.85, along)));
  f = capsule(p, vec2(0.03, -0.035), vec2(0.062, -0.222), 0.021, along);
  heat = max(heat, touchOf(f) * (0.7 + 0.3 * smoothstep(0.55, 0.85, along)));
  f = capsule(p, vec2(0.075, -0.01), vec2(0.136, -0.15), 0.018, along);
  heat = max(heat, touchOf(f) * (0.7 + 0.3 * smoothstep(0.5, 0.85, along)));
  f = capsule(p, vec2(-0.072, 0.13), vec2(-0.21, 0.01), 0.025, along);
  heat = max(heat, touchOf(f) * (0.8 + 0.2 * smoothstep(0.45, 0.9, along)));
  return heat;
}

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float l = dot(ab, ab);
  float t = l > 1e-9 ? clamp(dot(p - a, ab) / l, 0.0, 1.0) : 0.0;
  return length(p - a - ab * t);
}

void main() {
  ivec2 size = textureSize(uField, 0);
  ivec2 q = ivec2(gl_FragCoord.xy);
  ivec2 hi = size - 1;
  float c = texelFetch(uField, q, 0).r;
  float n = texelFetch(uField, clamp(q + ivec2(0, 1), ivec2(0), hi), 0).r;
  float s = texelFetch(uField, clamp(q + ivec2(0, -1), ivec2(0), hi), 0).r;
  float e = texelFetch(uField, clamp(q + ivec2(1, 0), ivec2(0), hi), 0).r;
  float w = texelFetch(uField, clamp(q + ivec2(-1, 0), ivec2(0), hi), 0).r;
  float ne = texelFetch(uField, clamp(q + ivec2(1, 1), ivec2(0), hi), 0).r;
  float nw = texelFetch(uField, clamp(q + ivec2(-1, 1), ivec2(0), hi), 0).r;
  float se = texelFetch(uField, clamp(q + ivec2(1, -1), ivec2(0), hi), 0).r;
  float sw = texelFetch(uField, clamp(q + ivec2(-1, -1), ivec2(0), hi), 0).r;
  float lap = (4.0 * (n + s + e + w) + (ne + nw + se + sw) - 20.0 * c) / 6.0;
  vec2 uv = (vec2(q) + 0.5) / vec2(size);
  float t = c + uDiff * lap - uCool * c;
  for (int i = 0; i < 5; i++) {
    if (i >= uCount) break;
    vec4 a = uSegA[i];
    vec4 b = uSegB[i];
    float r = max(b.x, 1e-4);
    float d = segDist(uv, a.xy, a.zw);
    float g = exp(-min(d * d / (r * r), 30.0));
    float k = clamp(uH * b.y * g, 0.0, 0.9);
    t += k * (b.z - t);
  }
  if (uStampAmp > 0.0) t = max(t, uStampAmp * handHeat(uv));
  outColor = vec4(clamp(t, 0.0, 4.0), 0.0, 0.0, 1.0);
}
`;

export const THERMO_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;

out vec4 outColor;

uniform vec2 uBox;
uniform float uDpr;
uniform vec3 uGround;
uniform vec2 uLight;
uniform vec4 uPoseA;
uniform vec4 uPoseB;
uniform vec4 uMiscA;
uniform vec4 uMiscB;
uniform sampler2D uPhotoA;
uniform sampler2D uPhotoB;
uniform sampler2D uHeatA;
uniform sampler2D uHeatB;
uniform sampler2D uMaskA;
uniform sampler2D uMaskB;
uniform sampler2D uGrainA;
uniform sampler2D uGrainB;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float sq(float v) {
  return v * v;
}

vec3 film(float t) {
  return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
}

vec3 photoAt(sampler2D tex, vec2 uv) {
  vec2 size = vec2(textureSize(tex, 0));
  vec2 st = uv * size;
  vec2 t1 = floor(st - 0.5) + 0.5;
  vec2 f = st - t1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 safe = max(w12, vec2(1e-4));
  vec2 t0 = (t1 - 1.0) / size;
  vec2 t3 = (t1 + 2.0) / size;
  vec2 t12 = (t1 + w2 / safe) / size;
  vec3 c = vec3(0.0);
  c += texture(tex, vec2(t0.x, t0.y)).rgb * w0.x * w0.y;
  c += texture(tex, vec2(t12.x, t0.y)).rgb * w12.x * w0.y;
  c += texture(tex, vec2(t3.x, t0.y)).rgb * w3.x * w0.y;
  c += texture(tex, vec2(t0.x, t12.y)).rgb * w0.x * w12.y;
  c += texture(tex, vec2(t12.x, t12.y)).rgb * w12.x * w12.y;
  c += texture(tex, vec2(t3.x, t12.y)).rgb * w3.x * w12.y;
  c += texture(tex, vec2(t0.x, t3.y)).rgb * w0.x * w3.y;
  c += texture(tex, vec2(t12.x, t3.y)).rgb * w12.x * w3.y;
  c += texture(tex, vec2(t3.x, t3.y)).rgb * w3.x * w3.y;
  return clamp(c, 0.0, 1.0);
}

float heatAt(sampler2D tex, vec2 uv) {
  vec2 size = vec2(textureSize(tex, 0));
  vec2 st = uv * size - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = max(w0 + w1, 1e-4);
  vec2 g1 = max(w2 + w3, 1e-4);
  vec2 h0 = (i - 0.5 + w1 / g0) / size;
  vec2 h1 = (i + 1.5 + w3 / g1) / size;
  float a = texture(tex, vec2(h0.x, h0.y)).r;
  float b = texture(tex, vec2(h1.x, h0.y)).r;
  float c = texture(tex, vec2(h0.x, h1.y)).r;
  float d = texture(tex, vec2(h1.x, h1.y)).r;
  return g0.y * (g0.x * a + g1.x * b) + g1.y * (g0.x * c + g1.x * d);
}

vec2 toLocal(vec2 p, vec4 pose) {
  vec2 d = p - pose.xy;
  float c = cos(pose.w);
  float s = sin(pose.w);
  return vec2(c * d.x + s * d.y, -s * d.x + c * d.y);
}

float boxSd(vec2 l, float hs, float r) {
  vec2 q = abs(l) - vec2(hs) + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float shadowOf(vec2 p, vec4 pose, vec4 misc) {
  if (misc.z < 0.5) return 0.0;
  float hs = pose.z;
  float lift = misc.x;
  vec2 l = toLocal(p - vec2(hs * 0.004, hs * (0.02 + lift * 0.07)), pose);
  float blur = hs * (0.07 + lift * 0.12);
  float far = 1.0 - smoothstep(-blur * 0.7, blur * 1.3, boxSd(l, hs, 2.0));
  vec2 l2 = toLocal(p - vec2(0.0, 1.0 + lift * hs * 0.02), pose);
  float near = 1.0 - smoothstep(-1.5, 2.5 + lift * hs * 0.08, boxSd(l2, hs, 2.0));
  return far * (0.22 - lift * 0.06) + near * 0.34 * (1.0 - lift);
}

vec4 sleeve(vec2 p, vec4 pose, vec4 misc, sampler2D photoTex, sampler2D heatTex, sampler2D maskTex, sampler2D grainTex) {
  if (misc.z < 0.5) return vec4(0.0);
  float hs = pose.z;
  vec2 l = toLocal(p, pose);
  float sd = boxSd(l, hs, 1.5);
  float aa = 0.75 / uDpr;
  float alpha = clamp(0.5 - sd / aa, 0.0, 1.0);
  if (alpha <= 0.0) return vec4(0.0);
  vec2 uv = l / (2.0 * hs) + 0.5;
  float px = 2.0 * hs;
  float seed = misc.y;

  vec3 photo = photoAt(photoTex, uv);
  float luma = dot(photo, vec3(0.299, 0.587, 0.114));
  photo = mix(vec3(luma), photo, 0.86);
  photo = clamp((photo - 0.5) * 1.08 + 0.5, 0.0, 1.0);
  photo *= vec3(1.03, 1.0, 0.95);
  photo = pow(max(photo, vec3(0.0)), vec3(1.06));
  photo += (hash(floor(uv * px * 0.75) + seed) - 0.5) * 0.045;

  float heat = heatAt(heatTex, uv);
  vec4 grain = texture(grainTex, uv);
  float drift = grain.r;
  float speck = grain.g;
  float pigment = noise(uv * px * 0.5 + seed);
  float thr = heat + (drift - 0.5) * 0.3 + (speck - 0.5) * 0.14;
  float x = smoothstep(0.18, 0.82, thr);

  float dens = pow(max(1.0 - x, 0.0), 1.6) * 10.0;
  vec3 sigma = mix(vec3(0.72, 1.0, 1.03), vec3(0.96, 0.98, 0.99), smoothstep(0.35, 0.95, x));
  vec3 trans = exp(-min(dens * sigma, vec3(30.0)));
  float maroon = smoothstep(0.0, 0.22, x) * (1.0 - smoothstep(0.22, 0.6, x));
  float teal = smoothstep(0.2, 0.42, x) * (1.0 - smoothstep(0.42, 0.66, x));

  vec2 dir = normalize(vec2(0.62, 0.78));
  vec2 lc = uv - 0.5 - uLight * 0.22;
  float along = dot(lc, dir);
  float across = dot(lc, vec2(-dir.y, dir.x));
  float broad = exp(-sq((along + 0.16) / 0.36));
  float gloss = exp(-sq((along - 0.03) / 0.085)) * (0.45 + 0.55 * exp(-sq(across / 0.42)));

  vec3 velvet = vec3(0.034, 0.033, 0.036) * (0.9 + 0.2 * pigment);
  float phase = along * 1.1 + drift * 0.6 + uLight.x * 0.12 + 0.48;
  vec3 tint = mix(vec3(0.62, 0.66, 0.7), film(phase), 0.22);
  vec3 sheen = tint * (0.004 + 0.032 * broad) * (0.8 + 0.4 * pigment);

  float r = length(uv - vec2(0.505, 0.5));
  float scuff = 0.35 + 0.65 * grain.b;
  float ring = exp(-sq((r - 0.462) / 0.012)) * scuff + 0.35 * exp(-sq((r - 0.168) / 0.008)) * scuff;

  float e = 1.0 / px;
  float m = texture(maskTex, uv).r;
  float mx = texture(maskTex, uv + vec2(e, 0.0)).r - texture(maskTex, uv - vec2(e, 0.0)).r;
  float my = texture(maskTex, uv + vec2(0.0, e)).r - texture(maskTex, uv - vec2(0.0, e)).r;
  float relief = dot(vec2(mx, my), normalize(vec2(0.55, 0.85) + uLight * 0.4));

  vec3 inkCol = velvet + sheen * (1.0 - m) + vec3(0.016) * ring * (1.0 - m) * (0.4 + broad);
  inkCol *= 1.0 - m * 0.45;
  inkCol += vec3(0.062, 0.014, 0.02) * maroon + vec3(0.004, 0.036, 0.04) * teal * (0.6 + 0.4 * film(phase + 0.3));

  vec3 col = photo * trans + inkCol * (1.0 - x);
  col += vec3(0.92, 0.95, 1.0) * gloss * m * 0.15;
  col += vec3(0.92, 0.95, 1.0) * m * broad * 0.035;
  col += vec3(0.92, 0.95, 1.0) * max(relief, 0.0) * (0.035 + 0.18 * gloss + 0.05 * x);
  col -= vec3(1.0) * max(-relief, 0.0) * 0.02 * (0.4 + x);

  float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)) * px;
  float cut = 1.0 - smoothstep(0.0, 1.6, edge);
  float wear = smoothstep(0.55, 0.9, noise(uv * 70.0 + seed) * (1.0 - smoothstep(0.0, 4.0, edge)) + noise(uv * 240.0) * 0.2);
  col = mix(col, vec3(0.2, 0.195, 0.19), wear * 0.4);
  col = mix(col, vec3(0.16, 0.155, 0.15), cut * 0.6);
  col += (hash(gl_FragCoord.xy + seed) - 0.5) * 0.01;
  return vec4(clamp(col, 0.0, 1.0), alpha);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uBox.y * uDpr - gl_FragCoord.y) / uDpr;
  vec2 g = p / max(uBox, vec2(1.0));
  vec3 col = uGround * (1.0 - 0.035 * sq(length(g - vec2(0.55, 0.45))));
  col += (hash(gl_FragCoord.xy * 0.5) - 0.5) * 0.008;
  float sh = max(shadowOf(p, uPoseA, uMiscA), shadowOf(p, uPoseB, uMiscB));
  col *= 1.0 - sh;
  vec4 b = sleeve(p, uPoseB, uMiscB, uPhotoB, uHeatB, uMaskB, uGrainB);
  col = mix(col, b.rgb, b.a);
  if (uMiscB.z > 0.5) col *= 1.0 - shadowOf(p, uPoseA, uMiscA) * b.a * 0.6;
  vec4 a = sleeve(p, uPoseA, uMiscA, uPhotoA, uHeatA, uMaskA, uGrainA);
  col = mix(col, a.rgb, a.a);
  outColor = vec4(col, 1.0);
}
`;
