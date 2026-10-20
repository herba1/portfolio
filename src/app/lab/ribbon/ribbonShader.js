export const RIBBON_VERTEX = `#version 300 es
in vec2 aUV;
uniform mat4 uViewProj;
uniform float uRadius;
uniform float uBand;
uniform float uTwist;
uniform float uRoll;
uniform float uYaw;
uniform float uLean;
uniform vec3 uEye;
out vec2 vUV;
out float vDepth;
out float vEdge;

vec3 yaw(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

vec3 lean(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}

void main() {
  float u = aUV.x;
  float th = 6.28318530718 * u;
  vec3 radial = vec3(sin(th), 0.0, cos(th));
  vec3 tangent = vec3(cos(th), 0.0, -sin(th));
  float phi = 3.14159265359 * uTwist * u + uRoll;
  vec3 across = cos(phi) * vec3(0.0, 1.0, 0.0) + sin(phi) * radial;
  vec3 p = radial * uRadius + (aUV.y - 0.5) * uBand * across;
  vec3 n = cross(tangent, across);
  p = lean(yaw(p, uYaw), uLean);
  n = lean(yaw(n, uYaw), uLean);
  vec3 toEye = normalize(uEye - p);
  vEdge = abs(dot(normalize(n), toEye));
  vUV = aUV;
  vDepth = dot(p, normalize(uEye));
  gl_Position = uViewProj * vec4(p, 1.0);
}
`;

export const RIBBON_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUV;
in float vDepth;
in float vEdge;
uniform sampler2D uText;
uniform float uScroll;
uniform float uRadius;
uniform vec3 uInk;
uniform vec3 uFar;
out vec4 outColor;

void main() {
  float s = vUV.x + uScroll;
  float t = gl_FrontFacing ? vUV.y : 1.0 - vUV.y;
  float raw = texture(uText, vec2(s, t)).r;
  float w = max(fwidth(raw), 0.0001);
  float a = clamp((raw - 0.5) / w + 0.5, 0.0, 1.0);
  a = mix(raw, a, smoothstep(0.08, 0.35, vEdge));
  if (a < 0.02) discard;
  float far = smoothstep(uRadius * 0.9, -uRadius * 0.95, vDepth);
  vec3 ink = mix(uInk, uFar, far);
  outColor = vec4(ink, a);
}
`;
