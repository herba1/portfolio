export const STRAP_POINTS = 16;

export const wallVertex = `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const wallFragment = `
uniform mat4 uCardInv;
uniform vec3 uCardN;
uniform vec3 uCardC;
uniform vec3 uLight;
uniform vec2 uHalf;
uniform float uRadius;
uniform vec3 uStrap[${STRAP_POINTS}];
uniform float uStrapHalf;
uniform vec3 uShade;
varying vec3 vWorld;

float sdRound(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec3 p = vWorld;
  float card = 0.0;
  float facing = dot(uLight, uCardN);
  if (abs(facing) > 0.02) {
    float t = dot(uCardC - p, uCardN) / facing;
    if (t > 0.0) {
      vec3 hit = p + uLight * t;
      vec2 q = (uCardInv * vec4(hit, 1.0)).xy;
      float d = sdRound(q, uHalf, uRadius);
      float blur = 0.035 + t * 0.15;
      card = (1.0 - smoothstep(-blur, blur, d)) * 0.3 * exp(-t * 0.3) * smoothstep(0.02, 0.25, abs(facing));
    }
  }
  float best = 1e3;
  float depth = 1.0;
  for (int i = 0; i < ${STRAP_POINTS - 1}; i++) {
    vec2 a = uStrap[i].xy;
    vec2 b = uStrap[i + 1].xy;
    vec2 pa = p.xy - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    float dd = length(pa - ba * h);
    if (dd < best) {
      best = dd;
      depth = mix(uStrap[i].z, uStrap[i + 1].z, h);
    }
  }
  float sb = 0.03 + depth * 0.15;
  float strap = (1.0 - smoothstep(uStrapHalf - sb, uStrapHalf + sb, best)) * 0.22 * exp(-depth * 0.3);
  float a = 1.0 - (1.0 - card) * (1.0 - strap);
  gl_FragColor = vec4(uShade * a, a);
}
`;

export const shadeVertex = `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const shadeFragment = `
uniform sampler2D uShadow;
uniform vec2 uSize;
void main() {
  gl_FragColor = texture2D(uShadow, gl_FragCoord.xy / uSize);
}
`;
