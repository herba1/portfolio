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
uniform float uSwapDelay;
uniform float uKickOmega;
uniform float uKickZeta;
uniform float uKickRise;
uniform float uPush;

uniform vec4 uView;
uniform float uDot;
uniform float uUnit;
uniform vec2 uCanvas;
uniform vec3 uInk;
uniform float uInkMix;

out vec4 vColor;
out vec2 vAxes;
out vec2 vLocal;

const float TAU = 6.28318531;

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
  float a = uKickZeta * uKickOmega;
  float wd = uKickOmega * sqrt(1.0 - uKickZeta * uKickZeta);
  float rise = 1.0 - exp(-uKickRise * t);
  float env = rise * rise;
  float envD = 2.0 * rise * uKickRise * exp(-uKickRise * t);
  float decay = exp(-a * t);
  float osc = decay * sin(wd * t);
  float oscD = decay * (wd * cos(wd * t) - a * sin(wd * t));
  return vec2(env * osc, envD * osc + env * oscD);
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
  float lift = 0.0;
  float amp = uPush / 0.5;

  for (int k = 0; k < ${MAX_STAGES}; k += 1) {
    if (k >= uStages) break;
    vec4 next = setColor(uStageSet[k]);
    vec2 rel = aPos - uStageOrigin[k];
    float dist = length(rel);
    vec2 radial = dist > 1e-4 ? rel / dist : vec2(1.0, 0.0);
    float t = uStageTime[k] - dist / uSpeed - aSeed.x * 0.06;
    color += (next - previous) * stepResponse(t - uSwapDelay);
    previous = next;
    float spin = fract(aSeed.y * 13.7 + float(uStageSet[k]) * 0.381 + float(k) * 0.217);
    vec2 scatter = vec2(cos(spin * TAU), sin(spin * TAU));
    float swirl = mod(float(uStageSet[k]), 2.0) < 1.0 ? 1.0 : -1.0;
    vec2 dir = radial * 0.75 + scatter * 0.85 + vec2(-radial.y, radial.x) * swirl * 0.45;
    float strength = amp * (0.45 + 1.1 * fract(aSeed.x * 7.31 + float(k) * 0.53));
    vec2 kv = kick(t) * strength;
    offset += dir * kv.x;
    velocity += dir * kv.y;
    lift += abs(kv.x) / amp * (0.5 + fract(aSeed.y * 3.7));
  }

  float reach = length(offset);
  float soften = 1.0 / (1.0 + reach * 0.8);
  offset *= soften;
  velocity *= soften;

  float size = inkSize(color.a) * (1.0 + 0.55 * clamp(lift, 0.0, 1.6));
  float px = size * uDot;
  float alpha = 0.94;
  if (px < 1.4) {
    alpha *= (px * px) / (1.4 * 1.4);
    px = 1.4;
  }

  float speed = length(velocity);
  vec2 dir = speed > 1e-5 ? velocity / speed : vec2(1.0, 0.0);
  float stretch = clamp(speed * 0.9, 0.0, 2.6);
  float along = px * (1.0 + stretch);
  float across = px / sqrt(1.0 + stretch * 0.8);

  vec3 photo = clamp(color.rgb, 0.0, 1.0);
  vec3 dyed = pow(photo, vec3(1.32)) * 0.94;
  vec3 inked = mix(uInk, uInk * 0.86, clamp(color.a, 0.0, 1.0));
  vec3 rgb = mix(dyed, inked, uInkMix);

  vec2 local = aCorner * vec2(along + 2.0, across + 2.0) * 0.5;
  vColor = vec4(rgb, alpha);
  vAxes = vec2(along, across) * 0.5;
  vLocal = local;
  vec2 rotated = vec2(local.x * dir.x - local.y * dir.y, local.x * dir.y + local.y * dir.x);
  gl_Position = vec4(uView.xy + (aPos + offset) * uView.zw + rotated * 2.0 / uCanvas, 0.0, 1.0);
}
`;

export const amorphFragment = `#version 300 es
precision highp float;

in vec4 vColor;
in vec2 vAxes;
in vec2 vLocal;
out vec4 outColor;

void main() {
  vec2 q = vLocal / max(vAxes, vec2(0.5));
  float r = length(q);
  float edge = min(vAxes.x, vAxes.y);
  float cover = clamp((1.0 - r) * edge + 0.5, 0.0, 1.0);
  float alpha = cover * vColor.a;
  if (alpha < 0.004) discard;
  outColor = vec4(vColor.rgb * alpha, alpha);
}
`;
