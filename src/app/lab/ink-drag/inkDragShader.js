export const MAX_SEGMENTS = 12;

export const QUAD_VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const NOISE = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * valueNoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    amp *= 0.5;
  }
  return sum;
}
`;

export const PAPER_FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uPx;
out vec4 outColor;
${NOISE}
void main() {
  vec2 p = gl_FragCoord.xy / uPx;
  vec2 q = mat2(0.8, 0.6, -0.6, 0.8) * p;
  float tooth = fbm(q * 0.32) * 0.75 + valueNoise(q * 1.3 + 7.0) * 0.25;
  float speck = hash12(floor(p));
  vec2 fa = mat2(0.94, 0.34, -0.34, 0.94) * p;
  vec2 fb = mat2(0.5, -0.87, 0.87, 0.5) * p;
  float fibreA = smoothstep(0.72, 0.95, valueNoise(vec2(fa.x * 0.03, fa.y * 0.7) + 11.0));
  float fibreB = smoothstep(0.76, 0.97, valueNoise(vec2(fb.x * 0.025, fb.y * 0.6) + 37.0));
  float sparse = smoothstep(0.35, 0.75, valueNoise(p * 0.01 + 5.0));
  float fibre = max(fibreA, fibreB * 0.7) * (0.35 + 0.65 * sparse);
  float mottle = fbm(p * 0.006 + 3.0) * 0.65 + fbm(p * 0.03) * 0.35;
  outColor = vec4(tooth, fibre, mottle, speck);
}
`;

export const PRINT_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uMask;
uniform vec2 uRes;
uniform float uProgress;
uniform float uGain;
out vec4 outColor;
${NOISE}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 t = 1.0 / uRes;
  float m = texture(uMask, uv).r;
  float wide = 0.0;
  wide += texture(uMask, uv + vec2(2.5, 0.0) * t).r;
  wide += texture(uMask, uv - vec2(2.5, 0.0) * t).r;
  wide += texture(uMask, uv + vec2(0.0, 2.5) * t).r;
  wide += texture(uMask, uv - vec2(0.0, 2.5) * t).r;
  wide *= 0.25;
  float squeeze = clamp(m - wide, 0.0, 1.0);
  float grain = valueNoise(gl_FragCoord.xy * 0.18) * 0.6 + valueNoise(gl_FragCoord.xy * 0.035) * 0.4;
  float body = m * (uGain + squeeze * 0.18) * (0.97 + grain * 0.05);
  float fine = valueNoise(gl_FragCoord.xy * 0.45);
  float front = uv.x * 0.82 + (1.0 - uv.y) * 0.06 + (fine - 0.5) * 0.05 + grain * 0.04;
  float bite = smoothstep(front, front + 0.14, uProgress * 1.12);
  float density = body * bite;
  outColor = vec4(density, m > 0.02 ? 1.0 : 0.0, 0.0, 1.0);
}
`;

export const VELOCITY_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uVelocity;
uniform vec2 uRes;
uniform float uDt;
uniform float uDecay;
uniform float uViscosity;
uniform float uUnit;
uniform int uCount;
uniform vec4 uSeg[${MAX_SEGMENTS}];
uniform vec4 uSegV[${MAX_SEGMENTS}];
out vec4 outColor;
${NOISE}
void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 t = 1.0 / uRes;
  vec2 uv = frag * t;
  vec2 v = texture(uVelocity, uv).xy;
  vec2 back = uv - v * uUnit * uDt * t;
  vec2 adv = texture(uVelocity, back).xy;
  vec2 around = texture(uVelocity, back + vec2(t.x, 0.0)).xy + texture(uVelocity, back - vec2(t.x, 0.0)).xy + texture(uVelocity, back + vec2(0.0, t.y)).xy + texture(uVelocity, back - vec2(0.0, t.y)).xy;
  vec2 next = mix(adv, around * 0.25, uViscosity) * uDecay;
  for (int i = 0; i < ${MAX_SEGMENTS}; i++) {
    if (i >= uCount) break;
    vec4 seg = uSeg[i];
    vec4 sv = uSegV[i];
    vec2 a = seg.xy;
    vec2 b = seg.zw;
    vec2 ab = b - a;
    float len2 = max(dot(ab, ab), 1e-4);
    float h = clamp(dot(frag - a, ab) / len2, 0.0, 1.0);
    vec2 closest = a + ab * h;
    float radius = sv.z;
    float dist = length(frag - closest);
    if (dist > radius) continue;
    vec2 dir = length(sv.xy) > 1e-3 ? normalize(sv.xy) : vec2(1.0, 0.0);
    float across = dot(frag - closest, vec2(-dir.y, dir.x));
    float along = dot(frag, dir);
    float fast = sv.w;
    float ridgeNoise = valueNoise(vec2(across * 0.22, along * 0.012));
    float ridge = mix(1.0, smoothstep(0.25, 0.75, ridgeNoise) * 0.85 + 0.15, fast);
    float core = 1.0 - smoothstep(radius * mix(0.45, 0.2, fast), radius, dist);
    float w = core * ridge;
    next = mix(next, sv.xy, w * 0.92);
  }
  outColor = vec4(next, 0.0, 1.0);
}
`;

export const INK_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uInk;
uniform sampler2D uVelocity;
uniform vec2 uRes;
uniform float uDt;
uniform float uDrying;
uniform float uDryThin;
uniform float uDryThick;
uniform float uRewet;
uniform float uLevel;
out vec4 outColor;
float mobility(float wet) {
  return smoothstep(0.02, 0.4, wet);
}
void main() {
  vec2 t = 1.0 / uRes;
  vec2 uv = gl_FragCoord.xy * t;
  vec4 here = texture(uInk, uv);
  vec2 v = texture(uVelocity, uv).xy;
  vec2 back = uv - v * uDt * t;
  vec4 moved = texture(uInk, back);
  float mob = mobility(moved.g);
  float fixedInk = here.r * (1.0 - mobility(here.g));
  float arriving = moved.r * mob;
  vec4 ink = vec4(fixedInk + arriving, (fixedInk * here.g + arriving * moved.g) / max(fixedInk + arriving, 1e-4), 0.0, 1.0);
  vec2 vt = vec2(1.0) / vec2(textureSize(uVelocity, 0));
  float vr = texture(uVelocity, uv + vec2(vt.x, 0.0)).x;
  float vl = texture(uVelocity, uv - vec2(vt.x, 0.0)).x;
  float vu = texture(uVelocity, uv + vec2(0.0, vt.y)).y;
  float vd = texture(uVelocity, uv - vec2(0.0, vt.y)).y;
  float div = 0.5 * (vr - vl + vu - vd) * mob * (t.x / vt.x);
  float density = ink.r * exp(-clamp(div * uDt, -0.35, 0.35));
  float speed = length(v) * mob;
  float stir = smoothstep(4.0, 120.0, speed);
  float n = texture(uInk, uv + vec2(t.x, 0.0)).r + texture(uInk, uv - vec2(t.x, 0.0)).r + texture(uInk, uv + vec2(0.0, t.y)).r + texture(uInk, uv - vec2(0.0, t.y)).r;
  density = mix(density, n * 0.25, uLevel * stir * mob);
  density = clamp(density, 0.0, 2.6);
  float wet = ink.g;
  float thin = 1.0 - smoothstep(0.15, 1.3, density);
  float rate = mix(uDryThick, uDryThin, thin);
  wet -= uDrying * uDt * rate;
  wet += uRewet * stir * uDt * step(0.04, wet) * (1.0 - wet);
  wet = density < 0.004 ? 0.0 : clamp(wet, 0.0, 1.0);
  outColor = vec4(density, wet, 0.0, 1.0);
}
`;

export const DISPLAY_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uInk;
uniform sampler2D uMask;
uniform sampler2D uPaper;
uniform vec2 uRes;
uniform vec2 uSimRes;
uniform vec3 uPaperColor;
uniform vec3 uInkColor;
uniform vec3 uThinTint;
uniform float uGloss;
uniform float uPx;
out vec4 outColor;
float lift(vec4 s) {
  return min(s.r, 1.1) * (0.35 + 0.65 * smoothstep(0.0, 0.6, s.g));
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 st = 1.0 / uSimRes;
  vec4 paperTex = texture(uPaper, uv);
  float tooth = paperTex.r;
  vec4 c = texture(uInk, uv);
  float d = c.r;
  float wet = c.g;
  vec4 e1 = texture(uInk, uv + vec2(2.0, 0.0) * st);
  vec4 e2 = texture(uInk, uv - vec2(2.0, 0.0) * st);
  vec4 e3 = texture(uInk, uv + vec2(0.0, 2.0) * st);
  vec4 e4 = texture(uInk, uv - vec2(0.0, 2.0) * st);
  float far = 0.25 * (e1.r + e2.r + e3.r + e4.r);
  float wetNear = max(max(max(e1.g, e2.g), max(e3.g, e4.g)), wet);
  vec4 g1 = texture(uInk, uv + vec2(3.5, 0.0) * st);
  vec4 g2 = texture(uInk, uv - vec2(3.5, 0.0) * st);
  vec4 g3 = texture(uInk, uv + vec2(0.0, 3.5) * st);
  vec4 g4 = texture(uInk, uv - vec2(0.0, 3.5) * st);
  vec2 grad = (vec2(lift(e1) - lift(e2), lift(e3) - lift(e4)) * 0.5 + vec2(lift(g1) - lift(g2), lift(g3) - lift(g4)) * 0.5) / 5.5;
  float rim = clamp(d - far, 0.0, 0.5) * smoothstep(0.2, 0.8, d);
  float m = texture(uMask, uv).r;
  float mx = texture(uMask, uv + vec2(1.5, 0.0) * st).r - texture(uMask, uv - vec2(1.5, 0.0) * st).r;
  float my = texture(uMask, uv + vec2(0.0, 1.5) * st).r - texture(uMask, uv - vec2(0.0, 1.5) * st).r;
  float tx = dFdx(tooth) / uPx;
  float ty = dFdy(tooth) / uPx;
  vec2 screen = uv;
  float light = 1.0 - 0.06 * length((screen - vec2(0.3, 0.85)) * vec2(1.0, 0.8));
  vec3 paper = uPaperColor * (0.965 + 0.05 * paperTex.b) * light;
  paper -= vec3(0.03, 0.026, 0.018) * paperTex.g;
  paper += clamp((ty - tx) * 0.22, -0.012, 0.012);
  paper *= 0.988 + 0.024 * paperTex.a;
  float deboss = clamp(my - mx, -1.0, 1.0) * 0.5;
  paper *= 1.0 - m * 0.03;
  paper += vec3(0.05, 0.046, 0.04) * deboss;
  float dry = 1.0 - smoothstep(0.0, 0.3, wet);
  float breakup = smoothstep(tooth - 0.35, tooth + 0.1, d * 2.2);
  float film = d * mix(1.0, breakup, 1.0 - smoothstep(0.15, 0.8, d));
  film *= mix(1.0, 0.9 + 0.2 * tooth, dry * smoothstep(0.5, 1.0, d));
  film += rim * 0.1;
  vec3 absorb = vec3(1.0, 1.06, 1.16) * 4.4;
  vec3 trans = exp(-absorb * film);
  float tintAmount = 0.6 * smoothstep(0.0, 0.3, film) * (1.0 - smoothstep(0.35, 0.9, film));
  vec3 color = paper * trans * mix(vec3(1.0), uThinTint, tintAmount);
  color = max(color, uInkColor * smoothstep(0.35, 1.0, film));
  float wetMask = smoothstep(0.05, 0.5, wetNear) * smoothstep(0.06, 0.45, d);
  color = mix(color, (uInkColor * 1.7 + vec3(0.022)) * (0.92 + 0.16 * tooth), dry * smoothstep(0.6, 1.2, film) * 0.45);
  color *= 1.0 - min(0.3, 0.24 * uGloss) * wetMask;
  vec3 n = normalize(vec3(-grad * 1.5, 1.0));
  vec3 keyDir = normalize(vec3(-0.6, 0.7, 0.3));
  vec3 halfV = normalize(keyDir + vec3(0.0, 0.0, 1.0));
  float flatSpec = pow(halfV.z, 22.0);
  float spec = max(pow(max(dot(n, halfV), 0.0), 22.0) - flatSpec, 0.0);
  vec2 r = n.xy * 1.6 + (screen - 0.5) * vec2(0.8, 0.55);
  float band = smoothstep(0.26, 0.03, abs(r.x * 0.8 + r.y + 0.12));
  float sheen = uGloss * wetMask * (spec * 0.15 + band * 0.05 + 0.01);
  color += vec3(0.97, 0.95, 0.91) * sheen;
  float vig = smoothstep(1.2, 0.3, length((screen - 0.5) * vec2(1.0, 1.15)));
  color *= mix(0.92, 1.0, vig);
  color += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  outColor = vec4(color, 1.0);
}
`;
