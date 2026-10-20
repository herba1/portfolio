export const MAX_STAGES = 6;

export const amorphVertex = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aSeed;
layout(location = 2) in vec2 aCorner;

uniform sampler2D uSets;
uniform int uGrid;
uniform int uBase;
uniform int uStages;
uniform int uStageSet[${MAX_STAGES}];
uniform vec2 uStageOrigin[${MAX_STAGES}];
uniform float uStageTime[${MAX_STAGES}];
uniform float uSpeed;
uniform float uSwapOmega;
uniform float uKickOmega;
uniform float uPush;

uniform vec4 uView;
uniform float uDot;
uniform float uUnit;
uniform vec2 uCanvas;
uniform vec3 uInk;
uniform float uInkMix;

out vec4 vColor;
out float vPx;
out float vTrail;
out vec2 vLocal;

vec4 setColor(int set) {
  int index = gl_InstanceID;
  return texelFetch(uSets, ivec2(index % uGrid, index / uGrid + set * uGrid), 0);
}

float stepResponse(float t) {
  if (t <= 0.0) return 0.0;
  float w = uSwapOmega * t;
  return 1.0 - (1.0 + w) * exp(-w);
}

vec2 kick(float t) {
  if (t <= 0.0) return vec2(0.0);
  float w = uKickOmega * t;
  float e = exp(-w);
  return vec2(w * w * e, uKickOmega * w * (2.0 - w) * e);
}

float inkSize(float ink) {
  return 1.16 * sqrt(max(ink, 0.0));
}

void main() {
  vec4 base = setColor(uBase);
  vec4 color = base;
  vec4 previous = base;
  vec2 offset = vec2(0.0);
  vec2 velocity = vec2(0.0);
  float amp = uPush / (4.0 * exp(-2.0));

  for (int k = 0; k < ${MAX_STAGES}; k += 1) {
    if (k >= uStages) break;
    vec4 next = setColor(uStageSet[k]);
    vec2 rel = aPos - uStageOrigin[k];
    float dist = length(rel);
    vec2 dir = dist > 1e-4 ? rel / dist : vec2(1.0, 0.0);
    float t = uStageTime[k] - dist / uSpeed - aSeed.x * 0.03;
    color += (next - previous) * stepResponse(t);
    previous = next;
    vec2 kv = kick(t) * amp * (0.6 + 0.4 * aSeed.y);
    offset += dir * kv.x;
    velocity += dir * kv.y;
  }

  float swell = clamp(length(offset) / uPush, 0.0, 1.4);
  float size = inkSize(color.a) * (1.0 + 0.26 * swell);
  float px = size * uDot;
  float alpha = 0.94;
  if (px < 1.4) {
    alpha *= (px * px) / (1.4 * 1.4);
    px = 1.4;
  }

  float speed = length(velocity);
  vec2 dir = speed > 1e-5 ? velocity / speed : vec2(1.0, 0.0);
  float trailPx = min(speed * uUnit * 0.028, px * 1.6);

  vec3 photo = clamp(color.rgb, 0.0, 1.0);
  vec3 dyed = pow(photo, vec3(1.32)) * 0.94;
  vec3 inked = mix(uInk, uInk * 0.86, clamp(color.a, 0.0, 1.0));
  vec3 rgb = mix(dyed, inked, uInkMix);

  vec2 local = aCorner * vec2(px + trailPx + 2.0, px + 2.0) * 0.5;
  vColor = vec4(rgb, alpha);
  vPx = px;
  vTrail = trailPx;
  vLocal = local;
  vec2 along = local - vec2(trailPx * 0.5, 0.0);
  vec2 rotated = vec2(along.x * dir.x - along.y * dir.y, along.x * dir.y + along.y * dir.x);
  gl_Position = vec4(uView.xy + (aPos + offset) * uView.zw + rotated * 2.0 / uCanvas, 0.0, 1.0);
}
`;

export const amorphFragment = `#version 300 es
precision highp float;

in vec4 vColor;
in float vPx;
in float vTrail;
in vec2 vLocal;
out vec4 outColor;

void main() {
  vec2 p = vLocal;
  float head = vTrail * 0.5;
  float tail = -vTrail * 0.5;
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
