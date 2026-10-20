export const bakeVertex = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const bakeFragment = `
precision highp float;
uniform sampler2D uNoise;
uniform float uAspect;
uniform vec2 uRes;
uniform vec2 uLightDir;
uniform vec2 uSeedShift;
uniform float uRoughness;
uniform float uRoughnessSize;
uniform float uRoughnessRows;
uniform float uFiber;
uniform float uFiberSize;
varying vec2 vUv;

float getRoughness(vec2 p, vec2 lightDir, vec2 seedShift, float basePixel) {
  vec2 u = p / vec2(2.0, 4.0);
  float w = 100.0 * basePixel;
  float eps = 4.0 * w;
  float size = mix(3.2, 0.8, uRoughnessSize);
  float logLac = log2(2.1);
  float level = -log2(w + 1e-8) / logLac;
  float baseLevel = floor(level) - 2.0;
  float fade = fract(level);
  vec2 px = (u.x + vec2(eps, -eps)) * 0.1;
  float py = u.y * 0.1;
  vec2 sum = vec2(0.0);
  float norm = 0.0;
  float amp = 0.5;
  float freq = exp2(baseLevel * logLac);
  for (int i = 0; i < 4; i++) {
    float absIdx = baseLevel + float(i);
    vec2 qx = size * px * freq;
    float qy = size * py * freq;
    float wi = 1.0;
    if (i == 0) wi = 1.0 - fade;
    if (i == 3) wi = fade;
    vec2 fx = fract(qx);
    float fy = fract(qy);
    vec2 shift = 0.5 + absIdx * 0.3 + seedShift;
    float uvY = floor(qy) / 50.0 + shift.y;
    vec2 s0a = textureLod(uNoise, fract(vec2(floor(qx.x) / 50.0 + shift.x, uvY)), 0.0).rg;
    vec2 s1a = textureLod(uNoise, fract(vec2(ceil(qx.x) / 50.0 + shift.x, uvY)), 0.0).rg;
    vec2 s0b = textureLod(uNoise, fract(vec2(floor(qx.y) / 50.0 + shift.x, uvY)), 0.0).rg;
    vec2 s1b = textureLod(uNoise, fract(vec2(ceil(qx.y) / 50.0 + shift.x, uvY)), 0.0).rg;
    vec2 ny0 = mix(vec2(s0a.r, s0b.r), vec2(s0a.g, s0b.g), fy);
    vec2 ny1 = mix(vec2(s1a.r, s1b.r), vec2(s1a.g, s1b.g), fy);
    vec2 n = mix(ny0, ny1, fx);
    sum += amp * wi * n;
    norm += amp * wi;
    amp *= 0.8;
    freq *= 2.1;
  }
  vec2 r = sum / norm;
  float dx = 0.5 + r.x - r.y;
  float grain = 3.0 * dx * dx - 0.7;
  float rowBand = fract(dot(p, lightDir) * 0.05 * size);
  return grain + 0.6 * uRoughnessRows * (rowBand - 0.5);
}

float getFiber(vec2 p, vec2 seedShift, float basePixel) {
  float size = mix(4.0, 1.0, uFiberSize);
  float w = 50.0 * basePixel;
  float level = -log2(w + 1e-8);
  float baseLevel = floor(level) - 3.0;
  float fade = fract(level);
  vec2 grad = vec2(0.0);
  float scale = 1.0;
  float amp = 1.0;
  float freq = pow(1.7, baseLevel);
  for (int i = 0; i < 5; i++) {
    float absIdx = baseLevel + float(i);
    vec2 q = size * p * freq;
    float an = absIdx * 0.8;
    float rc = cos(an);
    float rs = sin(an);
    q = vec2(rc * q.x - rs * q.y, rs * q.x + rc * q.y);
    float wi = 1.0;
    if (i == 0) wi = 1.0 - fade;
    if (i == 4) wi = fade;
    vec2 iq = floor(q);
    vec2 fq = fract(q);
    float shift = absIdx * 0.3;
    vec4 cell = fract(vec4(iq, iq + 1.0) / 50.0 + 0.5 + shift + seedShift.xyxy);
    float aF = textureLod(uNoise, cell.xy, 0.0).b;
    float bF = textureLod(uNoise, cell.zy, 0.0).b;
    float cF = textureLod(uNoise, cell.xw, 0.0).b;
    float dF = textureLod(uNoise, cell.zw, 0.0).b;
    vec2 su = fq * fq * (3.0 - 2.0 * fq);
    vec2 du = 8.0 * fq * (1.0 - fq);
    float gx = du.x * mix(bF - aF, dF - cF, su.y);
    float gy = du.y * mix(cF - aF, dF - bF, su.x);
    grad += wi * amp * scale * vec2(rc * gx + rs * gy, -rs * gx + rc * gy);
    scale *= 1.7;
    amp *= 0.5;
    freq *= 1.7;
  }
  return clamp(0.333 * length(grad), 0.0, 1.0);
}

void main() {
  vec2 patternUV = (vUv - 0.5) * vec2(uAspect, 1.0);
  float basePixel = 1.0 / uRes.y;
  float rough = uRoughness * getRoughness(1000.0 * patternUV, uLightDir, uSeedShift, basePixel);
  float fiber = uFiber * getFiber(50.0 * patternUV, uSeedShift, basePixel);
  float pattern = clamp(rough + fiber, 0.0, 1.0);
  gl_FragColor = vec4(pattern, fiber, clamp(rough, 0.0, 1.0), 1.0);
}
`;

export const paperUniforms = `
uniform sampler2D uBack;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec2 uSheet;
uniform vec2 uMem;
uniform vec2 uFold;
uniform float uGrain;
`;

export const paperMap = `
vec2 sheetUv = vMapUv;
float creaseA = abs(sheetUv.x - 0.5) * uSheet.x;
float creaseB = abs(sheetUv.y - 0.5) * uSheet.y;
float hidden = max(uFold.x * (1.0 - smoothstep(0.006, 0.03, creaseA)), uFold.y * (1.0 - smoothstep(0.006, 0.03, creaseB)));
vec4 inkFront = texture2D(map, sheetUv);
vec4 inkBack = texture2D(uBack, vec2(1.0 - sheetUv.x, sheetUv.y));
inkFront.a *= 1.0 - hidden;
inkBack.a *= 1.0 - hidden;
float through = texture2D(map, sheetUv, 2.5).a * 0.07 * (1.0 - hidden);
vec3 surface = gl_FrontFacing ? mix(uPaper, inkFront.rgb, inkFront.a) : mix(mix(uPaper, uInk, through), inkBack.rgb, inkBack.a);
float broken = 0.06 * uMem.x * exp(-creaseA / 0.0016) + 0.06 * uMem.y * exp(-creaseB / 0.0016);
float grain = texture2D(bumpMap, sheetUv).r;
diffuseColor.rgb *= surface * (1.0 - broken) * (1.0 - uGrain * grain);
`;

export const paperNormal = `
{
  vec3 q0 = dFdx(-vViewPosition);
  vec3 q1 = dFdy(-vViewPosition);
  vec2 st0 = dFdx(vMapUv);
  vec2 st1 = dFdy(vMapUv);
  vec3 q1perp = cross(q1, normal);
  vec3 q0perp = cross(normal, q0);
  vec3 tu = q1perp * st0.x + q0perp * st1.x;
  vec3 tv = q1perp * st0.y + q0perp * st1.y;
  float lu = length(tu);
  float lv = length(tv);
  if (lu > 1e-8 && lv > 1e-8) {
    tu /= lu;
    tv /= lv;
    float facing = gl_FrontFacing ? 1.0 : -1.0;
    float dA = (vMapUv.x - 0.5) * uSheet.x;
    float dB = (vMapUv.y - 0.5) * uSheet.y;
    float senseA = (vMapUv.y > 0.5 ? -1.0 : 1.0) * facing;
    float senseB = -facing;
    float width = 0.011;
    float gA = -senseA * 0.42 * uMem.x * sign(dA) * exp(-abs(dA) / width);
    float gB = -senseB * 0.42 * uMem.y * sign(dB) * exp(-abs(dB) / width);
    normal = normalize(normal - gA * tu - gB * tv);
  }
}
`;

export const contactVertex = `
varying vec2 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xy;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const contactFragment = `
uniform vec4 uRect;
uniform float uStrength;
varying vec2 vWorld;
float sdBox(vec2 p, vec2 b) {
  vec2 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}
void main() {
  vec2 c = 0.5 * (uRect.xy + uRect.zw);
  vec2 h = 0.5 * (uRect.zw - uRect.xy);
  float d = sdBox(vWorld - c - vec2(0.004, -0.006), h);
  float a = uStrength * (exp(-max(d, 0.0) / 0.01) * 0.6 + exp(-max(d, 0.0) / 0.045) * 0.4);
  gl_FragColor = vec4(vec3(0.16, 0.13, 0.1) * a, a);
}
`;
