const FILM_COMMON = `
precision highp float;
const float PITCH = 38.0;
const float HALF = 17.5;
const float GRIDN = 4.0;

float roundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float shapeSdf(float f, float y) {
  float edge = mix(20.5, 35.0, smoothstep(55.0, 75.0, f));
  float d = max(-y, y - edge);
  d = max(d, -f);
  vec2 tipCorner = vec2(6.5, 14.0);
  if (f < 6.5 && y > 14.0) d = max(d, length(vec2(f, y) - tipCorner) - 6.5);
  vec2 lowCorner = vec2(1.6, 1.6);
  if (f < 1.6 && y < 1.6) d = max(d, length(vec2(f, y) - lowCorner) - 1.6);
  return d;
}

float perfSdf(float f, float y) {
  float xl = mod(f, 4.75) - 2.375;
  float lower = roundBox(vec2(xl, y - 2.99), vec2(1.397, 0.99), 0.5);
  float upper = roundBox(vec2(xl, y - 32.01), vec2(1.397, 0.99), 0.5);
  return min(lower, upper);
}

vec2 atlasUv(float tile, float x, float y) {
  float col = mod(tile, GRIDN);
  float row = floor(tile / GRIDN);
  float u = (col * PITCH + (PITCH - clamp(x, 0.05, PITCH - 0.05))) / (PITCH * GRIDN);
  float v = (row * 35.0 + clamp(y, 0.05, 34.95)) / (35.0 * GRIDN);
  return vec2(u, v);
}
`;

export const FILM_VERTEX = `
in vec2 aFilm;
out vec2 vFilm;
out vec3 vNormal;
out vec3 vWorld;
void main() {
  vFilm = aFilm;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const FILM_FRAGMENT = `
${FILM_COMMON}
uniform sampler2D uPhoto;
uniform sampler2D uDetail;
uniform float uFlip[16];
out vec4 fragOut;
in vec2 vFilm;
in vec3 vNormal;
in vec3 vWorld;

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0031308)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow(max((c + 0.055) / 1.055, vec3(0.0)), vec3(2.4)), step(0.04045, c));
}

vec3 density(vec3 e) {
  vec3 logE = log2(max(e, vec3(0.0)) + 0.002) * 0.30103;
  float logL = dot(logE, vec3(0.3, 0.5, 0.2));
  logE = mix(logE, vec3(logL), 0.3);
  vec3 mid = vec3(-0.5, -0.55, -0.62);
  vec3 arg = clamp(-1.9 * (logE - mid), -30.0, 30.0);
  return vec3(1.5, 1.55, 1.6) / (1.0 + exp(arg));
}

vec3 positive(vec3 e) {
  vec3 over = max(e - 0.82, vec3(0.0));
  return min(e, vec3(0.82)) + 0.18 * (1.0 - exp(-over * 4.0));
}

void main() {
  float f = vFilm.x;
  float y = vFilm.y + HALF;
  float shape = shapeSdf(f, y);
  float perf = perfSdf(f, y);
  float aaS = max(fwidth(shape), 1e-3);
  float aaP = max(fwidth(perf), 1e-3);
  float alpha = clamp(-shape / aaS + 0.5, 0.0, 1.0) * clamp(perf / aaP + 0.5, 0.0, 1.0);
  if (alpha <= 0.0) discard;

  float tile = clamp(floor(f / PITCH), 0.0, 15.0);
  float x = f - tile * PITCH;
  vec2 uv = atlasUv(tile, x, y);
  vec3 photo = toLinear(texture(uPhoto, uv).rgb);
  vec3 detail = texture(uDetail, uv).rgb;

  float gate = roundBox(vec2(x - 19.0, y - 17.5), vec2(18.0, 12.0), 0.7);
  float inImage = (1.0 - smoothstep(-0.12, 0.12, gate)) * step(1.5, tile);
  vec3 exposure = photo * inImage * 1.05;

  float fog = 1.0 - smoothstep(60.0, 88.0, f);
  exposure += vec3(7.0, 6.2, 5.0) * fog;

  float blown = smoothstep(566.0, 586.0, f);
  exposure += vec3(6.0, 4.6, 3.2) * blown;

  float leakRamp = smoothstep(498.0, 584.0, f);
  float reach = mix(1.2, 24.0, leakRamp * leakRamp);
  float fromEdge = max(35.0 - y, 0.0);
  float bleed = exp(-fromEdge / reach);
  float xl = mod(f, 4.75) - 2.375;
  float holeGlow = exp(-max(roundBox(vec2(xl, y - 32.01), vec2(1.397, 0.99), 0.5), 0.0) / (0.5 + 3.0 * leakRamp));
  float streak = exp(-pow(abs(y - 24.0 + 6.0 * sin(f * 0.04)) / (3.0 + 10.0 * leakRamp), 2.0)) * 0.35;
  float leak = leakRamp * (bleed + holeGlow * 0.7 * leakRamp + streak * leakRamp);
  exposure += vec3(4.2, 1.5, 0.32) * leak;

  exposure += vec3(1.7, 1.45, 1.05) * detail.r;

  vec3 mask = vec3(0.955, 0.5, 0.225);
  vec3 neg = mask * exp2(-density(exposure) * 3.3219);

  float tileFlip = uFlip[int(tile)];
  float band = (1.0 - smoothstep(12.6, 13.2, abs(y - 17.5)));
  float flip = tileFlip * band;
  vec3 pos = positive(exposure);
  vec3 trans = mix(neg, pos, flip);

  float dust = detail.g;
  trans *= 1.0 - dust * 0.85;
  trans = mix(trans, max(trans, mask * 0.9), detail.b * 0.55 * (1.0 - flip));

  vec3 view = normalize(cameraPosition - vWorld);
  float facing = abs(dot(normalize(vNormal), view));
  float path = mix(1.0, 1.0 / max(facing, 0.3), 0.55);
  trans = pow(max(trans, vec3(1e-4)), vec3(path));

  float rim = (1.0 - smoothstep(0.0, aaS * 1.5 + 0.06, -shape)) + (1.0 - smoothstep(0.0, aaP * 1.5 + 0.05, perf));
  trans *= 1.0 - 0.28 * clamp(rim, 0.0, 1.0);

  vec3 outColor = mix(vec3(1.0), toSrgb(trans), alpha);
  fragOut = vec4(outColor, 1.0);
}
`;

export const GLOSS_FRAGMENT = `
${FILM_COMMON}
uniform vec3 uBoxDir;
uniform vec3 uBoxU;
uniform vec3 uBoxV;
out vec4 fragOut;
in vec2 vFilm;
in vec3 vNormal;
in vec3 vWorld;

void main() {
  float f = vFilm.x;
  float y = vFilm.y + HALF;
  float shape = shapeSdf(f, y);
  float perf = perfSdf(f, y);
  float aaS = max(fwidth(shape), 1e-3);
  float aaP = max(fwidth(perf), 1e-3);
  float alpha = clamp(-shape / aaS + 0.5, 0.0, 1.0) * clamp(perf / aaP + 0.5, 0.0, 1.0);
  if (alpha <= 0.0) discard;

  vec3 n = normalize(vNormal);
  vec3 view = normalize(cameraPosition - vWorld);
  bool emulsion = dot(n, view) > 0.0;
  if (!emulsion) n = -n;
  float nv = clamp(dot(n, view), 0.0, 1.0);
  vec3 r = reflect(-view, n);
  float fres = 0.04 + 0.96 * pow(1.0 - nv, 5.0);

  float soft = emulsion ? 0.16 : 0.05;
  float facing = dot(r, uBoxDir);
  float denom = max(facing, 0.05);
  float bu = dot(r, uBoxU) / denom;
  float bv = dot(r, uBoxV) / denom;
  float box = (1.0 - smoothstep(0.34 - soft, 0.34 + soft, abs(bu))) * (1.0 - smoothstep(0.2 - soft, 0.2 + soft, abs(bv))) * step(0.0, facing);
  float tableSee = smoothstep(0.05, -0.45, r.y);
  float room = 0.05 + 0.1 * smoothstep(-0.2, 0.9, r.y);
  float sheen = emulsion ? 0.7 : 1.0;
  float graze = smoothstep(0.04, 0.22, nv);
  float spec = fres * graze * (box * 2.6 * sheen + tableSee * 0.9 + room);
  fragOut = vec4(vec3(spec) * vec3(1.0, 0.99, 0.97) * alpha, 1.0);
}
`;

export const SHADOW_VERTEX = `
in vec3 aShadow;
out vec3 vShadow;
void main() {
  vShadow = aShadow;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

export const SHADOW_FRAGMENT = `
precision highp float;
in vec3 vShadow;
out vec4 fragOut;
void main() {
  float h = vShadow.y;
  float lying = smoothstep(0.25, 0.7, vShadow.z);
  float spread = clamp(0.3 + h * 0.05, 0.3, 1.0);
  float edge = 1.0 - smoothstep(1.0 - spread, 1.0, abs(vShadow.x));
  float strength = 0.14 * smoothstep(0.4, 5.0, h) * (1.0 - smoothstep(5.0, 22.0, h));
  fragOut = vec4(vec3(1.0 - edge * strength * lying), 1.0);
}
`;

export const TABLE_VERTEX = `
out vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const TABLE_FRAGMENT = `
precision highp float;
uniform sampler2D uDust;
uniform vec2 uCenter;
uniform vec2 uShadowShift;
out vec4 fragOut;
in vec3 vWorld;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float boxSdf(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 p = vWorld.xz;
  float far = length(p - uCenter);
  vec3 base = vec3(0.962, 0.96, 0.952);
  base *= 1.0 - 0.07 * smoothstep(160.0, 900.0, far);
  base += (hash(floor(p * 3.0)) - 0.5) * 0.006;
  float dust = texture(uDust, p / 900.0 + 0.5).r;
  base *= 1.0 - dust * 0.12;
  float contact = boxSdf(p, vec2(12.0, 26.0), 10.0);
  float castD = boxSdf(p - uShadowShift, vec2(13.0, 26.0), 11.0);
  float shade = 0.2 * exp(-max(contact, 0.0) / 2.6) + 0.1 * exp(-max(castD, 0.0) / 12.0);
  base *= 1.0 - clamp(shade, 0.0, 0.3);
  fragOut = vec4(base, 1.0);
}
`;
