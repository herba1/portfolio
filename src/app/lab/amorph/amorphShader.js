export const amorphVertex = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aFrom;
layout(location = 1) in vec2 aTo;
layout(location = 2) in vec4 aFromColor;
layout(location = 3) in vec4 aToColor;
layout(location = 4) in vec2 aSeed;
layout(location = 5) in vec2 aCorner;

uniform vec4 uView;
uniform float uDot;
uniform float uUnit;
uniform float uMorph;
uniform float uMaxTrail;
uniform vec2 uCanvas;
uniform vec3 uInk;
uniform float uInkMix;
uniform vec2 uOrigin;
uniform float uReach;
uniform float uPush;

out vec4 vColor;
out float vPx;
out float vTrail;
out float vDir;
out vec2 vLocal;

const float PI = 3.14159265;

float inkSize(float ink) {
  return 1.16 * sqrt(ink);
}

void main() {
  vec2 rel = aFrom - uOrigin;
  float dist = length(rel);
  vec2 dir = dist > 1e-4 ? rel / dist : vec2(1.0, 0.0);
  float delay = (dist / uReach) * 0.74 + aSeed.x * 0.02;
  float p = clamp((uMorph - delay) / 0.24, 0.0, 1.0);
  float wave = sin(PI * p);
  float swap = smoothstep(0.28, 0.72, p);
  float push = wave * wave * uPush * (0.55 + 0.45 * aSeed.y);
  vec2 position = mix(aFrom, aTo, swap) + dir * push;

  float size = mix(inkSize(aFromColor.a), inkSize(aToColor.a), swap) * (1.0 + 0.28 * wave * wave);
  float px = size * uDot;
  float alpha = 0.94;
  if (px < 1.4) {
    alpha *= (px * px) / (1.4 * 1.4);
    px = 1.4;
  }

  float speed = sin(2.0 * PI * p);
  float trailPx = min(abs(speed) * wave * uPush * uUnit * 0.5, px * 1.6);
  float sgn = speed >= 0.0 ? 1.0 : -1.0;
  float shift = trailPx * 0.5;

  vec3 photo = mix(aFromColor.rgb, aToColor.rgb, swap);
  vec3 dyed = pow(photo, vec3(1.32)) * 0.94;
  float tone = mix(aFromColor.a, aToColor.a, swap);
  vec3 inked = mix(uInk, uInk * 0.86, tone);
  vec3 color = mix(dyed, inked, uInkMix);

  vec2 local = aCorner * vec2(px + trailPx + 2.0, px + 2.0) * 0.5;
  vColor = vec4(color, alpha);
  vPx = px;
  vTrail = trailPx;
  vDir = sgn;
  vLocal = local;
  vec2 alongPx = local - vec2(sgn * shift, 0.0);
  vec2 rotated = vec2(alongPx.x * dir.x - alongPx.y * dir.y, alongPx.x * dir.y + alongPx.y * dir.x);
  gl_Position = vec4(uView.xy + position * uView.zw + rotated * 2.0 / uCanvas, 0.0, 1.0);
}
`;

export const amorphFragment = `#version 300 es
precision highp float;

in vec4 vColor;
in float vPx;
in float vTrail;
in float vDir;
in vec2 vLocal;
out vec4 outColor;

void main() {
  vec2 p = vLocal;
  float head = vDir * vTrail * 0.5;
  float tail = -head;
  float along = vTrail > 0.5 ? clamp((p.x - head) / (tail - head), 0.0, 1.0) : 0.0;
  vec2 nearest = vec2(mix(head, tail, along), 0.0);
  float radius = vPx * 0.5 * (1.0 - 0.7 * along);
  float d = length(p - nearest);
  float cover = clamp(radius - d + 0.5, 0.0, 1.0);
  float fade = pow(1.0 - along, 1.6);
  float alpha = cover * vColor.a * fade;
  if (alpha < 0.004) discard;
  outColor = vec4(vColor.rgb * alpha, alpha);
}
`;
