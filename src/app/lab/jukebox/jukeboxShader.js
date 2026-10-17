export const POST_VERTEX = `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const CLEAN_FRAGMENT = `
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uColor;
void main() {
  vec3 c = texture(uColor, vUv).rgb;
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  c = clamp(c, vec3(0.0), vec3(40.0));
  outColor = vec4(c, 1.0);
}
`;

export const POST_FRAGMENT = `
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform float uFocus;
uniform float uAperture;
uniform float uMaxBlur;
uniform float uTime;
uniform float uSeed;
uniform float uExposure;
uniform vec4 uView;
uniform float uDome;

const float GOLDEN = 2.39996323;

float viewDepth(vec2 uv) {
  float d = texture(uDepth, uv).r;
  float denom = max(1e-5, uFar - d * (uFar - uNear));
  return uNear * uFar / denom;
}

float coc(float z) {
  float c = abs(z - uFocus) / max(z, 1e-3);
  return clamp(c * uAperture, 0.0, 1.0);
}

vec3 aces(vec3 x) {
  x = max(x, vec3(0.0));
  vec3 a = x * (2.51 * x + 0.03);
  vec3 b = x * (2.43 * x + 0.59) + 0.14;
  return clamp(a / max(b, vec3(1e-4)), 0.0, 1.0);
}

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(1e-6)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

vec3 lens(vec2 uv) {
  float z = viewDepth(uv);
  float c = coc(z);
  float radius = c * uMaxBlur;
  if (radius < 0.6) return texture(uColor, uv).rgb;
  float lod = clamp(log2(radius / 2.5), 0.0, 5.0);
  vec2 px = 1.0 / uRes;
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  float spin = hash(uv * uRes) * 6.2831;
  for (int i = 0; i < 12; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / 12.0) * radius;
    float a = fi * GOLDEN + spin;
    vec2 o = vec2(cos(a), sin(a)) * r * px;
    vec2 suv = clamp(uv + o, vec2(0.001), vec2(0.999));
    float sc = coc(viewDepth(suv)) * uMaxBlur;
    float w = clamp(sc / max(r, 1e-3), 0.0, 1.0);
    w = max(w, 0.15);
    vec3 s = textureLod(uColor, suv, lod).rgb;
    acc += s * w;
    wsum += w;
  }
  return acc / max(wsum, 1e-4);
}

vec3 tubeColor(float t) {
  vec3 amber = vec3(1.0, 0.56, 0.18);
  vec3 rose = vec3(0.95, 0.24, 0.26);
  vec3 cream = vec3(1.0, 0.82, 0.55);
  vec3 jade = vec3(0.3, 0.75, 0.62);
  float k = fract(t);
  vec3 c = mix(rose, amber, smoothstep(0.0, 0.3, k));
  c = mix(c, cream, smoothstep(0.3, 0.5, k));
  c = mix(c, amber, smoothstep(0.5, 0.72, k));
  c = mix(c, jade, smoothstep(0.72, 0.86, k) * 0.55);
  c = mix(c, rose, smoothstep(0.86, 1.0, k));
  return c;
}

void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / max(uRes.y, 1.0);
  float viewTop = uView.x;
  float viewBottom = uView.y;
  float viewH = max(0.2, viewTop - viewBottom);
  vec2 center = vec2(0.5, viewBottom - viewH * 0.42);
  vec2 p = vec2((uv.x - center.x) * aspect, uv.y - center.y);
  float ax = max(0.5 * aspect * 1.12, viewH * 1.02);
  float ay = viewH * 1.5;
  vec2 q = p / vec2(ax, ay);
  float e = length(q);
  float ang = atan(q.x, q.y);
  float band = smoothstep(0.985, 1.005, e);
  float outer = smoothstep(1.06, 1.16, e);
  float ribs = 150.0;
  float ribPhase = ang * ribs / 3.14159265;
  float rib = sin(ribPhase * 3.14159265);
  float ribCrest = pow(max(0.0, cos(ribPhase * 3.14159265)), 24.0);
  vec2 tangent = normalize(vec2(q.y * ax, -q.x * ay) + 1e-5);
  tangent.x /= aspect;
  float refr = (0.0025 + 0.006 * outer) * uDome;
  vec2 bentUv = clamp(uv + tangent * rib * refr * band, vec2(0.001), vec2(0.999));

  vec3 sharp = lens(bentUv);
  vec3 glassBlur = textureLod(uColor, bentUv, 3.0).rgb;
  vec3 col = mix(sharp, glassBlur, band * (0.35 + 0.5 * outer));

  vec3 bloom = textureLod(uColor, uv, 4.0).rgb * 0.5 + textureLod(uColor, uv, 5.5).rgb * 0.35 + textureLod(uColor, uv, 7.0).rgb * 0.25;
  col += max(bloom - 0.12, vec3(0.0)) * 0.22;

  float hue = ang * 0.16 + 0.32 + uTime * 0.018;
  vec3 tint = tubeColor(hue);
  float topGlow = smoothstep(-0.2, 0.9, q.y);
  vec3 light = tint * (0.04 + 0.2 * topGlow) * (0.6 + 0.4 * sin(ribPhase * 0.25 + uTime * 0.35));
  col = mix(col, col * mix(vec3(1.0), tint * 1.25, 0.55) + light * 0.55, band * uDome);
  col += tint * ribCrest * band * (0.015 + 0.05 * topGlow) * uDome;
  col = mix(col, col * 0.42 * (tint * 0.7 + 0.3) + light * 0.35, outer * uDome);
  float lip = exp(-pow((e - 0.998) / 0.006, 2.0));
  col += vec3(1.0, 0.86, 0.66) * lip * 0.16 * smoothstep(-0.4, 0.6, q.y) * uDome;

  float sheen = exp(-pow((uv.x * 0.8 + uv.y * 0.55 - 1.02) / 0.035, 2.0)) * (1.0 - band) * smoothstep(0.35, 0.95, uv.y);
  col += vec3(1.0, 0.9, 0.75) * sheen * 0.035 * uDome;

  col *= uExposure;
  col = aces(col);
  vec2 vq = (uv - vec2(0.5, (viewTop + viewBottom) * 0.5)) * vec2(1.0, 1.15);
  float vig = 1.0 - smoothstep(0.32, 0.95, length(vq * vec2(aspect > 1.0 ? 1.0 : 1.3, 1.0)));
  col *= mix(0.72, 1.0, vig);
  col = col * vec3(1.02, 1.0, 0.95) + vec3(0.012, 0.007, 0.004);
  col = toSrgb(col);
  float g = hash(uv * uRes + uSeed) - 0.5;
  col += g * 0.022;
  outColor = vec4(col, 1.0);
}
`;
