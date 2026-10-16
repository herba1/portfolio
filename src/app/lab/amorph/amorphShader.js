export const amorphVertex = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aFrom;
layout(location = 1) in vec2 aTo;
layout(location = 2) in vec4 aFromColor;
layout(location = 3) in vec4 aToColor;
layout(location = 4) in vec2 aSeed;

uniform vec4 uView;
uniform float uDot;
uniform float uMorph;
uniform vec2 uOrigin;
uniform float uCurve;
uniform float uWave;
uniform float uGain;
uniform vec2 uHoldAt;
uniform float uSpread;
uniform float uTime;
uniform float uMotion;
uniform vec2 uPointer;
uniform float uPush;
uniform vec3 uInk;
uniform float uInkMix;

out vec4 vColor;
out float vPx;

float hash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

vec3 lattice(vec3 cell) {
  float z = hash(cell) * 2.0 - 1.0;
  float a = hash(cell + 19.19) * 6.2831853;
  float r = sqrt(max(0.0, 1.0 - z * z));
  return vec3(r * cos(a), r * sin(a), z);
}

float gradientNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(lattice(i), f);
  float n100 = dot(lattice(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));
  float n010 = dot(lattice(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));
  float n110 = dot(lattice(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));
  float n001 = dot(lattice(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));
  float n101 = dot(lattice(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));
  float n011 = dot(lattice(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));
  float n111 = dot(lattice(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, u.x);
  float nx10 = mix(n010, n110, u.x);
  float nx01 = mix(n001, n101, u.x);
  float nx11 = mix(n011, n111, u.x);
  return mix(mix(nx00, nx10, u.y), mix(nx01, nx11, u.y), u.z);
}

vec2 curl(vec3 p) {
  float e = 0.06;
  float up = gradientNoise(p + vec3(0.0, e, 0.0));
  float down = gradientNoise(p - vec3(0.0, e, 0.0));
  float right = gradientNoise(p + vec3(e, 0.0, 0.0));
  float left = gradientNoise(p - vec3(e, 0.0, 0.0));
  return vec2(up - down, left - right) / (2.0 * e);
}

float inkSize(float ink) {
  return 1.16 * sqrt(ink);
}

void main() {
  float lead = clamp(distance(aFrom, uOrigin) / 2.4, 0.0, 1.0);
  float delay = lead * 0.38 + aSeed.x * 0.12;
  float t = clamp((uMorph - delay) / 0.5, 0.0, 1.0);
  float skew = 1.0 - pow(1.0 - t, 1.4);
  float eased = skew * skew * skew * (skew * (skew * 6.0 - 15.0) + 10.0);

  vec2 travel = aTo - aFrom;
  vec2 across = vec2(-travel.y, travel.x);
  float bend = uCurve * (0.55 + 0.9 * aSeed.y);
  vec2 base = mix(aFrom, aTo, eased) + across * bend * sin(3.14159265 * eased);

  vec2 fromPointer = base - uPointer;
  float twirl = exp(-dot(fromPointer, fromPointer) / 0.05) * uPush;
  float c = cos(twirl);
  float s = sin(twirl);
  base = uPointer + vec2(c * fromPointer.x - s * fromPointer.y, s * fromPointer.x + c * fromPointer.y);

  float reach = distance(base, uHoldAt);
  float front = uWave * 3.3;
  float dissolve = 1.0 - smoothstep(front - 0.9, front + 0.05, reach);
  dissolve = dissolve * dissolve * (3.0 - 2.0 * dissolve) * uGain;
  float flight = sin(3.14159265 * t);

  float clock = uTime * uMotion;
  vec2 swirl = curl(vec3(base * 1.1, clock * 0.14)) * 0.75 + curl(vec3(base * 2.6 + 7.3, clock * 0.23 + 3.1)) * 0.3;
  float angle = aSeed.y * 6.2831853 + clock * (aSeed.x - 0.5) * 1.4;
  vec2 scatter = vec2(cos(angle), sin(angle)) * (0.3 + 0.7 * aSeed.x);
  vec2 outward = base - uHoldAt;

  vec2 drift = swirl * 0.95 + scatter * 0.45 + outward * (0.06 + 0.1 * aSeed.y) + vec2(0.0, 0.12 * aSeed.x);
  vec2 position = base + drift * uSpread * dissolve + (swirl * 0.07 + scatter * 0.02) * flight;

  vec2 over = max(abs(position) - 1.0, 0.0);
  position = sign(position) * (min(abs(position), 1.0) + 0.15 * tanh(over / 0.15));

  float size = mix(inkSize(aFromColor.a), inkSize(aToColor.a), eased);
  float loose = clamp(dissolve + flight * 0.6, 0.0, 1.0);
  float dust = 0.5 + 0.35 * aSeed.y;
  size = mix(size, max(dust, size * 0.72), loose * 0.75);

  vec3 photo = mix(aFromColor.rgb, aToColor.rgb, eased);
  vec3 dyed = pow(photo, vec3(1.32)) * 0.94;
  float tone = mix(aFromColor.a, aToColor.a, eased);
  vec3 inked = mix(uInk, uInk * 0.86, tone);
  vec3 color = mix(dyed, inked, uInkMix);

  float px = size * uDot;
  float alpha = 0.94 * mix(1.0, 0.86, loose);
  if (px < 1.4) {
    alpha *= (px * px) / (1.4 * 1.4);
    px = 1.4;
  }

  vColor = vec4(color, alpha);
  vPx = px;
  gl_PointSize = px + 1.0;
  gl_Position = vec4(uView.xy + position * uView.zw, 0.0, 1.0);
}
`;

export const amorphFragment = `#version 300 es
precision highp float;

in vec4 vColor;
in float vPx;
out vec4 outColor;

void main() {
  vec2 offset = gl_PointCoord - 0.5;
  float r = length(offset) * (vPx + 1.0);
  float cover = clamp(vPx * 0.5 - r + 0.5, 0.0, 1.0);
  float alpha = cover * vColor.a;
  if (alpha < 0.004) discard;
  outColor = vec4(vColor.rgb * alpha, alpha);
}
`;
