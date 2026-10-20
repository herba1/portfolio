export const screenVertex = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const flowFragment = `
precision highp float;
uniform sampler2D uPrev;
uniform float uFalloff;
uniform float uDissipation;
uniform float uAspect;
uniform vec2 uMouse;
uniform vec2 uVelocity;
uniform float uRise;
varying vec2 vUv;
void main() {
  vec4 color = texture2D(uPrev, vUv - vec2(0.0, uRise)) * uDissipation;
  vec2 cursor = vUv - uMouse;
  cursor.x *= uAspect;
  vec3 stamp = vec3(uVelocity * vec2(1.0, -1.0), 1.0 - pow(1.0 - min(1.0, length(uVelocity)), 3.0));
  float falloff = smoothstep(uFalloff, 0.0, length(cursor));
  color.rgb = mix(color.rgb, stamp, vec3(falloff));
  gl_FragColor = color;
}
`;

export const compositeFragment = `
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uFlow;
uniform sampler2D uNoise;
uniform vec2 uRes;
uniform vec2 uSource;
uniform float uRadius;
uniform float uHeight;
uniform float uTime;
uniform float uPush;
uniform vec3 uSteam;
varying vec2 vUv;

float noise(vec2 p) {
  return texture2D(uNoise, p).r;
}

float plume(vec2 q, float seed, float offset, float t) {
  float h = (q.y - uSource.y) / uHeight;
  if (h < -0.04 || h > 1.05) return 0.0;
  float hh = max(h, 0.0);
  float sway = (noise(vec2(seed * 0.173 + t * 0.021, hh * 0.32 - t * 0.043)) - 0.5) * 2.0;
  float sway2 = (noise(vec2(seed * 0.311 - t * 0.017, hh * 0.9 - t * 0.09 + 0.5)) - 0.5) * 2.0;
  float lean = pow(hh * 1.6, 2.0);
  float cx = uSource.x + offset * uRadius + (sway * 0.9 + sway2 * 0.35) * uRadius * lean;
  float width = uRadius * (0.2 + 0.62 * hh);
  float dx = (q.x - cx) / width;
  float body = exp(-dx * dx * 1.6);
  vec2 nuv = vec2(dx * 0.11 + seed * 0.37, hh * 0.62 - t * 0.16);
  float n = noise(nuv) * 0.62 + noise(nuv * 2.3 + vec2(0.31, -t * 0.07)) * 0.38;
  float puffs = smoothstep(0.38, 0.86, n);
  float edge = min((dx + 2.2) * 0.9, (2.2 - dx) * 0.9);
  return body * puffs * clamp(edge, 0.0, 1.0);
}

void main() {
  vec4 scene = texture2D(uScene, vUv);
  vec3 color = scene.rgb;
  vec2 p = gl_FragCoord.xy;
  if (p.y > uSource.y - uRadius && abs(p.x - uSource.x) < uRadius * 5.0) {
    vec3 flow = texture2D(uFlow, vUv).rgb;
    float push = clamp(length(flow.xy), 0.0, 3.0);
    vec2 off = flow.xy * uPush;
    off *= min(1.0, uRadius * 1.6 / max(length(off), 0.001));
    vec2 q = p - off;
    float swirl = (noise(q / uRadius * 0.35 + uTime * 0.05) - 0.5) * min(push, 1.2) * uRadius * 0.4;
    q += vec2(swirl, -swirl * 0.5);
    float t = uTime;
    float d = plume(q, 1.0, -0.22, t) * 0.8 + plume(q, 2.7, 0.08, t + 13.0) * 1.0 + plume(q, 4.1, 0.3, t + 29.0) * 0.7;
    float h = (q.y - uSource.y) / uHeight;
    d *= smoothstep(0.0, 0.16, h) * (1.0 - smoothstep(0.5, 1.0, h));
    d *= 0.44 * (1.0 - 0.45 * clamp(flow.z, 0.0, 1.0));
    float side = clamp(0.5 - (q.x - uSource.x) / (uRadius * 6.0), 0.0, 1.0);
    vec3 steam = uSteam * (0.86 + 0.28 * side);
    color = mix(color, steam, clamp(d, 0.0, 0.9));
  }
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
