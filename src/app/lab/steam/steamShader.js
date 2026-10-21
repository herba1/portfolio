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
uniform float uRise;
uniform vec2 uMouse;
uniform vec2 uVelocity;
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

export const steamFragment = `
precision highp float;
uniform sampler2D uFlow;
uniform sampler2D uNoise;
uniform sampler2D uMaskA;
uniform sampler2D uMaskB;
uniform vec2 uRes;
uniform float uTime;
uniform float uPush;
uniform float uInA;
uniform float uOutA;
uniform float uInB;
uniform float uOutB;
uniform float uLift;
uniform float uDepth;
uniform vec2 uTilt;
uniform vec3 uGround;
uniform vec3 uSteam;
varying vec2 vUv;

float noise(vec2 p) {
  return texture2D(uNoise, p).r;
}

float fbm(vec2 p) {
  return noise(p) * 0.6 + noise(p * 2.03 + 0.37) * 0.28 + noise(p * 4.1 + 0.71) * 0.12;
}

vec2 vapour(sampler2D mask, vec2 uv, float inAmt, float outAmt, float seed, float blown) {
  if (inAmt <= 0.0 || outAmt >= 1.0) return vec2(0.0, 1.0);
  float t = uTime;
  float aspect = uRes.x / uRes.y;
  vec2 st = vec2(uv.x * aspect, uv.y);
  float rise = outAmt * outAmt * uLift;
  vec2 warp = vec2(fbm(st * 1.6 + vec2(seed, -t * 0.05)), fbm(st * 1.6 + vec2(seed + 4.3, -t * 0.05 + 2.1))) - 0.5;
  float churn = 0.011 + 0.05 * outAmt + 0.05 * (1.0 - inAmt);
  vec2 base = uv + warp * vec2(churn / aspect, churn) - vec2(0.0, rise);
  vec3 m = texture2D(mask, base).rgb;
  float flowA = fbm(st * vec2(1.7, 0.9) + vec2(seed, -t * 0.12));
  float flowB = fbm(st * vec2(3.4, 1.8) + vec2(seed + 1.7, -t * 0.22));
  float vap = smoothstep(0.28, 0.82, flowA * 0.6 + flowB * 0.4);
  float gather = inAmt * (1.0 - outAmt * 0.8) * (1.0 - blown * 0.75);
  float body = smoothstep(0.04, 0.8, mix(m.b * 0.8, m.g, gather));
  float letter = body * (0.22 + 0.5 * vap) + m.r * (0.3 + 0.2 * vap) * gather;
  vec2 e = vec2(2.0) / uRes;
  float hx = texture2D(mask, base + vec2(e.x, 0.0)).g - texture2D(mask, base - vec2(e.x, 0.0)).g;
  float hy = texture2D(mask, base + vec2(0.0, e.y)).g - texture2D(mask, base - vec2(0.0, e.y)).g;
  vec3 n = normalize(vec3(-hx * 1.5, -hy * 1.5, 1.0));
  vec3 light = normalize(vec3(-0.55, 0.62, 0.58));
  float shade = clamp(mix(1.0, dot(n, light) / light.z, 0.5 * gather), 0.78, 1.14);
  vec2 dir = normalize(vec2(0.62, -0.78) + uTilt);
  vec2 stepUv = dir * uDepth / uRes;
  float side = 0.0;
  for (int i = 1; i <= 5; i++) {
    float fi = float(i);
    float layer = smoothstep(0.3, 0.75, texture2D(mask, base - stepUv * fi).g);
    side = max(side, layer * (1.0 - fi * 0.07));
  }
  side *= gather * (0.3 + 0.36 * vap);
  float env = 0.0;
  for (int k = 1; k <= 6; k++) {
    float fk = float(k);
    float lean = (fbm(vec2(st.x * 0.7 + seed, st.y * 0.5 - t * 0.06 - fk * 0.03)) - 0.5) * fk * 0.02;
    float src = texture2D(mask, base - vec2(lean / aspect, fk * 0.018)).b;
    env = max(env, src * smoothstep(0.0, 1.6, fk) * pow(1.0 - fk / 7.0, 1.5));
  }
  float bend = fbm(vec2(st.x * 0.9 + seed, st.y * 0.6 - t * 0.07)) - 0.5;
  vec2 fp = vec2(st.x + bend * 0.22, st.y * 0.32 - t * 0.075);
  float fil = fbm(fp * vec2(9.0, 2.2) + vec2(seed * 2.3, 0.0)) * 0.7 + fbm(fp * vec2(17.0, 3.0) + vec2(seed, 1.3)) * 0.3;
  float strands = smoothstep(0.5, 0.8, fil);
  float wisps = env * (0.14 + 0.86 * strands) * 1.0;
  float w = wisps * 0.85 * (1.0 - 0.75 * m.r);
  float solid = max(letter, side);
  float front = clamp((letter - side * 0.85) * 6.0 + 0.5, 0.0, 1.0);
  float faceLit = mix(0.5, shade, front);
  float d = 1.0 - (1.0 - solid) * (1.0 - w);
  float lit = (solid * faceLit + w) / max(solid + w, 0.0001);
  float appear = smoothstep(0.0, 1.0, inAmt);
  float leave = 1.0 - smoothstep(0.0, 0.8, outAmt);
  return vec2(d * appear * leave, lit);
}

void main() {
  vec2 uv = vUv;
  vec3 flow = texture2D(uFlow, uv).rgb;
  vec2 off = flow.xy * uPush / uRes;
  float len = length(off);
  off *= min(1.0, 0.09 / max(len, 0.0001));
  float push = clamp(length(flow.xy), 0.0, 2.0);
  vec2 q = uv - off;
  float swirl = (noise(q * vec2(uRes.x / uRes.y, 1.0) * 2.2 + uTime * 0.04) - 0.5) * push * 0.02;
  q += vec2(swirl, -swirl * 0.4);
  float thin = 1.0 - 0.55 * clamp(flow.z, 0.0, 1.0);
  float blown = clamp(push * 0.7, 0.0, 1.0);
  vec2 va = vapour(uMaskA, q, uInA, uOutA, 1.3, blown);
  vec2 vb = vapour(uMaskB, q, uInB, uOutB, 7.9, blown);
  float lit = (va.x * va.y + vb.x * vb.y) / max(va.x + vb.x, 0.0001);
  float d = clamp((va.x + vb.x) * thin, 0.0, 1.0);
  vec2 c = uv - 0.5;
  c.x *= uRes.x / uRes.y;
  float vignette = 1.0 - 0.5 * smoothstep(0.25, 1.05, length(c));
  float grain = (noise(uv * uRes / 256.0 + fract(uTime * 7.31) * vec2(0.37, 0.71)) - 0.5) * 0.018;
  vec3 ground = uGround * vignette + grain;
  vec3 steam = uSteam * (0.9 + 0.1 * smoothstep(0.0, 1.0, uv.y));
  vec3 color = mix(ground, steam * lit, d * 0.92);
  color += uSteam * 0.05 * smoothstep(0.0, 0.4, d);
  gl_FragColor = vec4(color, 1.0);
}
`;
