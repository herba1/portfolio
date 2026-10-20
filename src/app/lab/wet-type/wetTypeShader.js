export const WET_VERTEX = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const WET_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uMask;
uniform sampler2D uField;
uniform vec2 uFieldTexel;
uniform vec2 uRes;
uniform float uWarp;
uniform float uPx;
uniform vec3 uPaper;
uniform vec3 uInk;
out vec4 outColor;

float bayer4(vec2 p) {
  vec2 c = mod(floor(p), 4.0);
  float i = c.x + c.y * 4.0;
  float v = 0.0;
  if (i < 0.5) v = 0.0;
  else if (i < 1.5) v = 8.0;
  else if (i < 2.5) v = 2.0;
  else if (i < 3.5) v = 10.0;
  else if (i < 4.5) v = 12.0;
  else if (i < 5.5) v = 4.0;
  else if (i < 6.5) v = 14.0;
  else if (i < 7.5) v = 6.0;
  else if (i < 8.5) v = 3.0;
  else if (i < 9.5) v = 11.0;
  else if (i < 10.5) v = 1.0;
  else if (i < 11.5) v = 9.0;
  else if (i < 12.5) v = 15.0;
  else if (i < 13.5) v = 7.0;
  else if (i < 14.5) v = 13.0;
  else v = 5.0;
  return (v + 0.5) / 16.0;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec4 field(vec2 uv) {
  vec2 r = uFieldTexel;
  vec4 s = texture(uField, uv) * 4.0;
  s += (texture(uField, uv + vec2(r.x, 0.0)) + texture(uField, uv - vec2(r.x, 0.0)) + texture(uField, uv + vec2(0.0, r.y)) + texture(uField, uv - vec2(0.0, r.y))) * 2.0;
  s += texture(uField, uv + r) + texture(uField, uv - r) + texture(uField, uv + vec2(r.x, -r.y)) + texture(uField, uv - vec2(r.x, -r.y));
  return s / 16.0;
}

void main() {
  vec2 uv = vUv;
  vec4 f = field(uv);
  vec2 flow = f.rg * uWarp;
  float speed = clamp(f.b, 0.0, 1.0);
  float flowLen = length(flow * uRes);
  float base = texture(uMask, uv).r;
  float density = base;
  if (flowLen > 0.5) {
    float best = 0.0;
    float sum = 0.0;
    for (int i = 0; i < 16; i++) {
      float t = float(i) / 15.0;
      float m = texture(uMask, uv - flow * t).r;
      float film = mix(0.42, 1.0, smoothstep(0.0, 0.7, t));
      best = max(best, m * film * (1.0 - t * speed * 0.55));
      sum += m;
    }
    float body = sum / 16.0;
    float smear = max(best, body * 0.9);
    density = mix(base, smear, smoothstep(0.5, 6.0, flowLen));
    density *= 1.0 - speed * 0.22;
  }
  density = clamp(density, 0.0, 1.0);
  vec2 px = gl_FragCoord.xy / uPx;
  float grain = hash12(floor(gl_FragCoord.xy)) - 0.5;
  float solid = smoothstep(0.82, 0.9, density);
  float dither = step(bayer4(px) * 0.86 + 0.07, density + grain * 0.06);
  float wet = smoothstep(0.0, 0.25, flowLen / 40.0 + speed);
  float on = mix(smoothstep(0.42, 0.58, density), max(solid, dither), wet);
  outColor = vec4(mix(uPaper, uInk, on), 1.0);
}
`;
