export const SPRING_SAMPLES = 64;

export const QUAD_VERTEX = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec3 aRect;
layout(location = 2) in vec3 aColour;
layout(location = 3) in vec3 aFrom;
layout(location = 4) in vec3 aTiming;

uniform float uTime;
uniform float uCoverPx;
uniform vec2 uOffsetPx;
uniform vec2 uCanvasPx;
uniform float uDpr;
uniform float uGap;
uniform float uRadius;
uniform float uDisc;
uniform float uOutline;
uniform vec2 uPointer;
uniform float uLensRadius;
uniform float uLensAmount;
uniform float uReduced;
uniform float uSpring[64];
uniform float uSpringSpan;
uniform float uPass;

out vec2 vLocal;
out vec2 vHalf;
out float vCorner;
out vec3 vColour;
out float vAlpha;
out float vSoft;
out float vHard;

float springAt(float age) {
  if (uReduced > 0.5 || age >= uSpringSpan) return 1.0;
  float f = clamp(age / uSpringSpan, 0.0, 1.0) * 63.0;
  int i = int(floor(f));
  int j = min(i + 1, 63);
  return mix(uSpring[i], uSpring[j], fract(f));
}

void main() {
  float age = uTime - aTiming.x;
  int kind = int(aTiming.y + 0.5);
  float layer = (kind == 1 || kind == 3) ? 0.0 : 1.0;
  float scale = 1.0;
  float visible = 1.0;
  float fade = 1.0;
  float soft = 0.0;
  vec3 colour = aColour;

  if (kind == 0) {
    visible = step(0.0, age);
    scale = mix(0.84, 1.0, springAt(age));
    float blend = uReduced > 0.5 ? 1.0 : smoothstep(0.0, 0.18, age);
    colour = mix(aFrom, aColour, blend);
    soft = uReduced > 0.5 ? 0.0 : 1.0 - smoothstep(0.0, 0.16, age);
    fade = uReduced > 0.5 ? 1.0 : smoothstep(0.0, 0.07, age);
  } else if (kind == 1) {
    visible = 1.0 - step(0.0, age);
  } else if (kind == 2) {
    float k = uReduced > 0.5 ? 1.0 : clamp(age / 0.22, 0.0, 1.0);
    float eased = k * k;
    visible = 1.0 - step(uReduced > 0.5 ? 0.0 : 0.22, age);
    scale = 1.0 - 0.08 * eased;
    colour = mix(aColour, aFrom, eased);
  } else if (kind == 3) {
    visible = step(0.0, age);
    scale = mix(0.96, 1.0, springAt(age));
  } else {
    if (age < 0.0) {
      colour = aFrom;
    } else {
      float k = uReduced > 0.5 ? 1.0 : clamp(age / 0.2, 0.0, 1.0);
      colour = mix(aFrom, aColour, k * k * (3.0 - 2.0 * k));
      scale = mix(0.93, 1.0, springAt(age));
    }
  }

  float sizePx = aRect.z * uCoverPx;
  if (visible < 0.5 || sizePx <= 0.0 || abs(layer - uPass) > 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vAlpha = 0.0;
    return;
  }

  bool tiny = sizePx < 4.0;
  vec2 tileCentre = aRect.xy + aRect.z * 0.5;
  vec2 fromPointer = tileCentre - uPointer;
  float pointerDistance = length(fromPointer);
  float press = tiny ? 0.0 : (1.0 - smoothstep(0.0, max(uLensRadius, 0.001), pointerDistance)) * uLensAmount;
  vec2 pushDirection = fromPointer / max(pointerDistance, 0.0001);

  float gapPx = tiny ? 0.0 : uGap * sizePx + 0.06 * sizePx * press;
  float halfPx = max(sizePx * 0.5 - gapPx * 0.5, 0.25) * scale;
  float cornerPx = tiny ? 0.0 : min(uRadius * sizePx, 12.0) * scale;
  cornerPx = mix(cornerPx, halfPx, uDisc);
  cornerPx = mix(cornerPx, halfPx, 0.35 * press);
  cornerPx = min(cornerPx, halfPx);

  bool hard = uOutline < 0.01 && gapPx < 0.5 && cornerPx < 0.5 && soft < 0.01 && scale > 0.999;
  float expand = hard ? 0.0 : (1.5 + soft * 6.0) / uDpr;

  vec2 corner = aCorner * 2.0 - 1.0;
  vec2 local = corner * (halfPx + expand);
  vec2 centre = uOffsetPx + tileCentre * uCoverPx + pushDirection * (0.02 * sizePx * press);
  vec2 pixel = centre + local;
  vec2 clip = pixel / uCanvasPx * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);

  vLocal = local;
  vHalf = vec2(halfPx);
  vCorner = cornerPx;
  vColour = colour;
  vAlpha = fade;
  vSoft = soft;
  vHard = hard ? 1.0 : 0.0;
}
`;

export const QUAD_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vLocal;
in vec2 vHalf;
in float vCorner;
in vec3 vColour;
in float vAlpha;
in float vSoft;
in float vHard;

uniform float uDpr;
uniform float uOutline;
uniform vec3 uInk;
uniform vec3 uPaper;

out vec4 fragColor;

float roundedBox(vec2 p, vec2 halfSize, float corner) {
  vec2 q = abs(p) - halfSize + corner;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  float dither = (hash21(gl_FragCoord.xy) - 0.5) * 1.5 / 255.0;
  if (vHard > 0.5) {
    fragColor = vec4(vColour + dither, vAlpha);
    return;
  }
  float feather = (1.0 + vSoft * 7.0) / uDpr;
  float distanceToEdge = roundedBox(vLocal, vHalf, vCorner);
  float inside = 1.0 - smoothstep(-feather * 0.5, feather * 0.5, distanceToEdge);
  vec3 colour = vColour;
  if (uOutline > 0.001) {
    float rule = 0.5;
    float ruleDistance = abs(distanceToEdge + rule * 0.5) - rule * 0.5;
    float ink = 1.0 - smoothstep(-0.5 / uDpr, 0.5 / uDpr, ruleDistance);
    colour = mix(vColour, mix(uPaper, uInk, ink), uOutline);
  }
  float alpha = inside * vAlpha;
  if (alpha < 0.004) discard;
  fragColor = vec4(colour + dither, alpha);
}
`;
