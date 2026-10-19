export const cardVertex = `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = -mv.xyz;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`;

export const cardFragment = `
uniform sampler2D map;
uniform float uHolo;
uniform float uReveal;
uniform float uGlow;
uniform float uTime;
uniform vec2 uTilt;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;

vec3 hue(float h) {
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec4 tex = texture2D(map, vUv);
  if (tex.a < 0.5) discard;
  vec3 col = tex.rgb;
  vec3 n = normalize(vN);
  vec3 v = normalize(vV);
  vec2 view = v.xy - n.xy;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float win = step(0.07, vUv.x) * step(vUv.x, 0.93) * step(0.4214, vUv.y) * step(vUv.y, 0.8881);
  float inner = step(0.0367, vUv.x) * step(vUv.x, 0.9633) * step(0.0262, vUv.y) * step(vUv.y, 0.9738);
  float rim = 1.0 - inner;
  float phase = vUv.x * 1.2 + vUv.y * 0.8 + view.x * 2.6 + view.y * 1.8 + uTilt.x * 1.8 - uTilt.y * 1.3;
  vec3 rainbow = hue(fract(phase));
  float bands = 0.8 + 0.2 * sin((vUv.x - vUv.y) * 60.0 + uTilt.x * 14.0);
  float holo = uHolo * (win * (0.08 + 0.42 * smoothstep(0.15, 0.8, lum)) * bands + rim * 0.75);
  col = mix(col, col * 0.82 + rainbow * 0.5, clamp(holo, 0.0, 1.0));
  vec2 grid = vUv * vec2(48.0, 67.2);
  vec2 cell = floor(grid);
  vec2 f = fract(grid) - 0.5;
  float h = hash(cell);
  vec2 jit = vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5;
  vec2 q = abs(f - jit * 0.5);
  float star = max(0.0, 1.0 - length(q) * 7.0) + max(0.0, 1.0 - q.x * 22.0) * max(0.0, 1.0 - q.y * 4.0) * 0.5 + max(0.0, 1.0 - q.y * 22.0) * max(0.0, 1.0 - q.x * 4.0) * 0.5;
  float tw = step(0.93, h) * pow(0.5 + 0.5 * sin(uTime * 2.4 + h * 40.0 + (uTilt.x - uTilt.y) * 18.0), 8.0) * star;
  col += uHolo * win * tw * smoothstep(0.2, 0.6, lum) * vec3(1.0, 0.96, 0.85);
  float sheen = exp(-pow((vUv.x * 0.7 + vUv.y * 0.5 - 0.6 - uTilt.x * 1.4 + uTilt.y * 1.0) * 3.0, 2.0));
  col += sheen * (0.05 + 0.1 * uHolo) + rim * sheen * 0.08;
  float s = vUv.x * 0.55 + (1.0 - vUv.y) * 0.45;
  float d = s - (uReveal * 1.6 - 0.3);
  float live = step(0.001, uReveal) * step(uReveal, 0.999);
  col += exp(-d * d * 80.0) * vec3(1.0, 0.88, 0.6) * 0.8 * live;
  float diffuse = 0.9 + 0.1 * max(dot(n, normalize(vec3(0.3, 0.5, 1.0))), 0.0);
  col *= diffuse * (1.0 + uGlow * 0.1);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;
