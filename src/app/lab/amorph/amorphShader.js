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

out vec4 vColor;
out float vPx;
out float vTrail;
out float vDir;
out vec2 vLocal;

float inkSize(float ink) {
  return 1.16 * sqrt(ink);
}

float ease(float t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float progress(float morph) {
  float row = 1.0 - (aFrom.y * 0.5 + 0.5);
  float delay = row * 0.42 + aSeed.x * 0.05;
  return clamp((morph - delay) / 0.5, 0.0, 1.0);
}

void main() {
  float t = progress(uMorph);
  float eased = ease(t);
  float ahead = ease(progress(uMorph + 0.012));
  float travel = aTo.x - aFrom.x;
  float x = aFrom.x + travel * eased;
  float y = mix(aFrom.y, aTo.y, eased);
  float speed = travel * (ahead - eased) / 0.012;

  float size = mix(inkSize(aFromColor.a), inkSize(aToColor.a), eased);
  float px = size * uDot;
  float alpha = 0.94;
  if (px < 1.4) {
    alpha *= (px * px) / (1.4 * 1.4);
    px = 1.4;
  }

  float trailUnits = min(abs(speed) * 0.09, 0.6);
  float trailPx = min(trailUnits * uUnit, uMaxTrail);
  float dir = speed >= 0.0 ? 1.0 : -1.0;
  float shift = (trailPx * 0.5) / uUnit;

  vec3 photo = mix(aFromColor.rgb, aToColor.rgb, eased);
  vec3 dyed = pow(photo, vec3(1.32)) * 0.94;
  float tone = mix(aFromColor.a, aToColor.a, eased);
  vec3 inked = mix(uInk, uInk * 0.86, tone);
  vec3 color = mix(dyed, inked, uInkMix);

  vec2 local = aCorner * vec2(px + trailPx + 2.0, px + 2.0) * 0.5;
  vColor = vec4(color, alpha);
  vPx = px;
  vTrail = trailPx;
  vDir = dir;
  vLocal = local;
  vec2 position = vec2(x - dir * shift, y);
  gl_Position = vec4(uView.xy + position * uView.zw + local * 2.0 / uCanvas, 0.0, 1.0);
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
