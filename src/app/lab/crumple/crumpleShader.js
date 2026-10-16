export const bakeVertex = `
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const bakeFragment = `
precision highp float;
uniform sampler2D print;
uniform vec4 creaseA[96];
uniform vec4 creaseB[96];
uniform int creaseCount;
uniform vec2 sheet;
uniform vec2 texel;
uniform float mode;
uniform float relief;
uniform float seed;
in vec2 vUv;
out vec4 outColor;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

void main() {
  vec2 p = (vUv - 0.5) * sheet;
  vec2 grad = vec2(0.0);
  float crack = 0.0;
  float valley = 0.0;
  float ridge = 0.0;
  for (int i = 0; i < 96; i++) {
    if (i >= creaseCount) break;
    vec4 a = creaseA[i];
    vec4 b = creaseB[i];
    vec2 rel = p - a.xy;
    vec2 dir = a.zw;
    vec2 nrm = vec2(-dir.y, dir.x);
    float u = dot(rel, dir);
    float au = abs(u);
    float lo = b.y * 0.35;
    if (au >= b.y) continue;
    float x = clamp((au - lo) / max(b.y - lo, 1e-4), 0.0, 1.0);
    float fall = 1.0 - x * x * (3.0 - 2.0 * x);
    float dfall = au > lo ? -6.0 * x * (1.0 - x) / max(b.y - lo, 1e-4) * sign(u) : 0.0;
    float v = dot(rel, nrm);
    float av = abs(v);
    float w = b.x;
    float amp = b.z;
    if (av < w) {
      float k = (w - av) / w;
      float r = w * k * k;
      float dr = -2.0 * k * sign(v);
      grad += amp * (dr * fall * nrm + r * dfall * dir);
      float line = exp(-av / 0.0008) * fall * fall;
      crack += line * abs(amp) * (amp > 0.0 ? 1.0 : 0.3) * step(0.09, w);
      float near = exp(-av / (w * 0.22)) * fall * abs(amp);
      if (amp < 0.0) valley += near;
      else ridge += near;
    }
  }
  if (mode < 0.5) {
    vec2 o = texel;
    vec3 c = texture(print, vUv).rgb;
    vec3 n4 = texture(print, vUv + vec2(o.x, 0.0)).rgb + texture(print, vUv - vec2(o.x, 0.0)).rgb + texture(print, vUv + vec2(0.0, o.y)).rgb + texture(print, vUv - vec2(0.0, o.y)).rgb;
    c = clamp(c + (c - n4 * 0.25) * 0.22, 0.0, 1.0);
    float g = hash(floor(vUv / texel) + seed) - 0.5;
    float g2 = hash(floor(vUv / texel * 0.5) + seed * 1.7) - 0.5;
    c += (g * 0.028 + g2 * 0.02) * (0.4 + 0.6 * (1.0 - c));
    c *= 1.0 - clamp(valley, 0.0, 1.0) * 0.085;
    c = mix(c, vec3(0.93, 0.92, 0.9), clamp(crack, 0.0, 1.0) * 0.16);
    c = mix(c, c * vec3(1.02, 1.0, 0.97), clamp(ridge, 0.0, 1.0) * 0.4);
    outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  } else {
    vec3 n = normalize(vec3(-grad * relief, 1.0));
    outColor = vec4(n * 0.5 + 0.5, 1.0);
  }
}
`;
