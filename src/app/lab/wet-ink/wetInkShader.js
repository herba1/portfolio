export const MAX_STAMPS = 64;

export const QUAD_VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

export const STAMP_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uSimRes;
uniform vec4 uRange;
uniform float uQuantise;
uniform float uHalf;
uniform float uSeed;
uniform float uConcentration;
uniform float uPoolConcentration;
uniform float uSmear;
uniform int uCount;
uniform vec4 uSegments[64];
uniform vec4 uNibs[64];
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(mod(p, 289.0), vec2(127.1, 311.7))) * 43758.5453);
}

vec4 encodeState(vec4 value) {
  vec2 p = gl_FragCoord.xy + uSeed;
  vec4 dither = vec4(hash(p), hash(p.yx + 17.0), hash(p * 1.37 + 3.0), hash(p.yx * 0.71 + 9.0)) - 0.5;
  return value / uRange + dither * (uQuantise / 255.0 + uHalf * abs(value / uRange) / 1024.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uSimRes;
  vec2 point = vec2(gl_FragCoord.x, uSimRes.y - gl_FragCoord.y);
  vec4 state = texture(uState, uv) * uRange;
  for (int i = 0; i < 64; i++) {
    if (i >= uCount) break;
    vec4 segment = uSegments[i];
    vec4 nib = uNibs[i];
    vec2 a = segment.xy;
    vec2 b = segment.zw;
    float reach = max(nib.x, nib.y) + 1.5;
    vec2 low = min(a, b) - reach;
    vec2 high = max(a, b) + reach;
    if (point.x < low.x || point.y < low.y || point.x > high.x || point.y > high.y) continue;
    vec2 stroke = b - a;
    float along = clamp(dot(point - a, stroke) / max(dot(stroke, stroke), 0.0001), 0.0, 1.0);
    float radius = mix(nib.x, nib.y, along);
    float dist = length(point - a - stroke * along) - radius;
    float cover = 1.0 - smoothstep(-0.7, 0.7, dist);
    if (cover <= 0.0) continue;
    vec2 drag = vec2(stroke.x, -stroke.y) / uSimRes;
    vec4 behind = texture(uState, uv - drag * uSmear * cover) * uRange;
    float carry = cover * uSmear * smoothstep(0.02, 0.25, behind.r);
    state.rg = mix(state.rg, max(state.rg, behind.rg), carry);
    state.r = max(state.r, nib.w * cover) + cover * nib.z;
    state.g = max(state.g, nib.w * uConcentration * cover) + cover * nib.z * uConcentration * uPoolConcentration;
    state.a = max(state.a, state.r);
  }
  state.r = min(state.r, 2.0);
  state.g = min(state.g, 3.2);
  state.a = min(state.a, 2.0);
  fragColor = encodeState(state);
}`;

export const STEP_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform sampler2D uFibre;
uniform vec2 uSimRes;
uniform vec4 uRange;
uniform float uQuantise;
uniform float uHalf;
uniform float uSeed;
uniform float uDt;
uniform float uAbsorb;
uniform float uDry;
uniform float uPin;
uniform float uMobility;
uniform float uGranulation;
out vec4 fragColor;

vec4 centre;
float centreFibre;
float waterGain;
float pigmentGain;

float hash(vec2 p) {
  return fract(sin(dot(mod(p, 289.0), vec2(127.1, 311.7))) * 43758.5453);
}

vec4 encodeState(vec4 value) {
  vec2 p = gl_FragCoord.xy + uSeed;
  vec4 dither = vec4(hash(p), hash(p.yx + 17.0), hash(p * 1.37 + 3.0), hash(p.yx * 0.71 + 9.0)) - 0.5;
  return value / uRange + dither * (uQuantise / 255.0 + uHalf * abs(value / uRange) / 1024.0);
}

float exchange(vec2 offset, float weight, vec2 uv) {
  vec2 at = uv + offset / uSimRes;
  vec4 other = texture(uState, at) * uRange;
  float otherFibre = texture(uFibre, at).r;
  float fibreShare = 0.5 * (centreFibre + otherFibre);
  float delta = other.r - centre.r;
  float wetFloor = min(other.r, centre.r);
  float gap = 1.0 - fibreShare;
  float pinning = uPin * (1.0 - smoothstep(0.0, 0.05, wetFloor)) * (0.55 + 2.6 * gap * gap);
  float drive = sign(delta) * max(abs(delta) - pinning, 0.0);
  float flow = weight * uAbsorb * fibreShare * drive;
  float concentration = flow > 0.0 ? other.g / max(other.r, 0.001) : centre.g / max(centre.r, 0.001);
  waterGain += flow;
  pigmentGain += flow * min(concentration, 4.0) * uMobility;
  return other.r;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uSimRes;
  centre = texture(uState, uv) * uRange;
  vec4 fibre = texture(uFibre, uv);
  centreFibre = fibre.r;
  waterGain = 0.0;
  pigmentGain = 0.0;
  float east = exchange(vec2(1.0, 0.0), 0.11, uv);
  float west = exchange(vec2(-1.0, 0.0), 0.11, uv);
  float north = exchange(vec2(0.0, 1.0), 0.11, uv);
  float south = exchange(vec2(0.0, -1.0), 0.11, uv);
  float northEast = exchange(vec2(1.0, 1.0), 0.055, uv);
  float northWest = exchange(vec2(-1.0, 1.0), 0.055, uv);
  float southEast = exchange(vec2(1.0, -1.0), 0.055, uv);
  float southWest = exchange(vec2(-1.0, -1.0), 0.055, uv);
  float lowest = min(min(min(east, west), min(north, south)), min(min(northEast, northWest), min(southEast, southWest)));
  float highest = max(max(max(east, west), max(north, south)), max(max(northEast, northWest), max(southEast, southWest)));
  float water = max(centre.r + waterGain, 0.0);
  float pigment = max(centre.g + pigmentGain, 0.0);
  float deposit = centre.b;
  float depth = 0.35 + 0.65 * smoothstep(0.1, 0.6, max(highest, water));
  float rim = smoothstep(0.0, 0.1, water) * (1.0 - smoothstep(0.0, 0.06, lowest)) * depth;
  float evaporation = uDt * uDry * (0.05 + 0.2 * water + 1.1 * rim * smoothstep(0.18, 0.5, highest));
  water = max(water - evaporation, 0.0);
  float dryness = 1.0 - clamp(water / 0.6, 0.0, 1.0);
  float settle = uDt * (0.08 + 2.4 * dryness * dryness) * mix(1.0, 0.7 + 0.6 * fibre.g, uGranulation);
  float settled = pigment * min(settle, 1.0);
  if (water < 0.004) {
    settled = pigment;
    water = 0.0;
  }
  pigment -= settled;
  deposit = min(deposit + settled, 4.0);
  fragColor = encodeState(vec4(water, pigment, deposit, max(centre.a, water)));
}`;

export const LIFT_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform vec2 uSimRes;
uniform vec4 uSourceRange;
uniform vec4 uRange;
uniform float uQuantise;
uniform float uHalf;
uniform float uSeed;
uniform float uFront;
uniform float uFeather;
uniform vec4 uKeep;
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(mod(p, 289.0), vec2(127.1, 311.7))) * 43758.5453);
}

vec4 encodeState(vec4 value) {
  vec2 p = gl_FragCoord.xy + uSeed;
  vec4 dither = vec4(hash(p), hash(p.yx + 17.0), hash(p * 1.37 + 3.0), hash(p.yx * 0.71 + 9.0)) - 0.5;
  return value / uRange + dither * (uQuantise / 255.0 + uHalf * abs(value / uRange) / 1024.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uSimRes;
  vec4 state = texture(uSource, uv) * uSourceRange;
  float wobble = 0.018 * sin(uv.y * 7.0 + 1.3) + 0.009 * sin(uv.y * 19.0 + 4.1);
  float front = uFront + wobble;
  float lifted = 1.0 - smoothstep(front - uFeather, front, uv.x);
  fragColor = encodeState(state * mix(vec4(1.0), uKeep, lifted));
}`;

export const DISPLAY_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform sampler2D uFibre;
uniform sampler2D uTint;
uniform vec2 uResolution;
uniform vec2 uSimRes;
uniform vec4 uRange;
uniform vec3 uInk;
uniform vec3 uPaper;
uniform float uGranulation;
uniform float uSheen;
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(mod(p, 289.0), vec2(127.1, 311.7))) * 43758.5453);
}

const vec3 LIGHT_HALFWAY = vec3(-0.358, 0.418, 0.835);

float waterAt(vec2 uv) {
  return textureLod(uState, uv, 0.0).r * uRange.r;
}

float smoothedWater(vec2 uv, vec2 texel) {
  float corners = waterAt(uv + texel) + waterAt(uv - texel) + waterAt(uv + vec2(texel.x, -texel.y)) + waterAt(uv + vec2(-texel.x, texel.y));
  return 0.4 * waterAt(uv) + 0.15 * corners;
}

vec3 inkAt(vec2 uv) {
  vec4 tint = texture(uTint, uv);
  vec3 stored = tint.rgb / max(tint.a, 0.001);
  return mix(uInk, stored * stored, smoothstep(0.0, 0.08, tint.a));
}

vec3 shade(vec2 fragment, out float inkiness) {
  vec2 uv = fragment / uResolution;
  vec4 state = texture(uState, uv) * uRange;
  vec4 fibre = texture(uFibre, uv);
  vec3 ink = inkAt(uv);
  float grain = mix(fibre.g, hash(floor(fragment)), 0.5);
  float damp = smoothstep(0.0, 0.2, state.r);
  float deposit = state.b * mix(1.0, 0.55 + 0.9 * grain, uGranulation);
  float pigment = deposit + state.g * 0.8;
  inkiness = 1.0 - exp(-2.6 * pigment);
  float amount = 1.3 * inkiness * (1.0 + 0.3 * damp);
  float tide = smoothstep(0.004, 0.06, state.a);
  float tideLine = smoothstep(0.004, 0.03, state.a) * (1.0 - smoothstep(0.03, 0.14, state.a));
  float paperTone = 0.012 + 0.018 * fibre.r * (0.75 + 0.5 * grain);
  float paperShade = paperTone + tide * (0.01 + 0.016 * fibre.r) + tideLine * 0.03 + damp * (0.035 + 0.05 * fibre.r);
  vec3 paper = uPaper * (1.0 - paperShade);
  return paper * pow(ink, vec3(amount));
}

void main() {
  vec2 fragment = gl_FragCoord.xy;
  float inkA;
  float inkB;
  float inkC;
  float inkD;
  vec3 colour = shade(fragment + vec2(0.125, 0.375), inkA);
  colour += shade(fragment + vec2(-0.375, 0.125), inkB);
  colour += shade(fragment + vec2(0.375, -0.125), inkC);
  colour += shade(fragment + vec2(-0.125, -0.375), inkD);
  colour *= 0.25;
  float ink = 0.25 * (inkA + inkB + inkC + inkD);

  vec2 uv = fragment / uResolution;
  vec2 texel = 1.0 / uSimRes;
  float water = waterAt(uv);
  float bloom = ink * (1.0 - ink) * 4.0 * clamp(water, 0.0, 1.0) * uSheen;
  colour += sqrt(inkAt(uv)) * bloom * 0.07;
  float meniscus = smoothstep(0.03, 0.2, water) * uSheen;
  if (meniscus > 0.0) {
    float east = smoothedWater(uv + vec2(texel.x, 0.0), texel);
    float west = smoothedWater(uv - vec2(texel.x, 0.0), texel);
    float north = smoothedWater(uv + vec2(0.0, texel.y), texel);
    float south = smoothedWater(uv - vec2(0.0, texel.y), texel);
    vec3 normal = normalize(vec3((west - east) * 5.0, (south - north) * 5.0, 1.0));
    float glint = pow(max(dot(normal, LIGHT_HALFWAY), 0.0), 40.0);
    colour += vec3(glint * 0.5 * meniscus);
  }

  colour = pow(clamp(colour, 0.0, 1.0), vec3(1.0 / 2.2));
  colour += (hash(fragment + 7.0) - 0.5) / 255.0;
  fragColor = vec4(colour, 1.0);
}`;

export const OFFPRINT_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform sampler2D uFibre;
uniform sampler2D uTint;
uniform vec2 uSimRes;
uniform vec4 uRange;
uniform vec3 uInk;
uniform vec3 uBlotter;
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(mod(p, 289.0), vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 uv = 1.0 - gl_FragCoord.xy / uSimRes;
  float transfer = 0.0;
  float total = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 offset = vec2(float(x), float(y));
      float weight = exp(-dot(offset, offset) / 3.0);
      vec4 state = texture(uState, uv + offset * 1.2 / uSimRes) * uRange;
      transfer += weight * (state.g * smoothstep(0.0, 0.12, state.r) + 0.16 * state.b);
      total += weight;
    }
  }
  transfer /= total;
  float fibre = texture(uFibre, fract(uv.yx * vec2(2.3, 0.43) + 0.37)).r;
  float speck = hash(floor(gl_FragCoord.xy));
  transfer *= 0.55 + 0.7 * fibre + 0.2 * (speck - 0.5);
  float amount = 1.15 * (1.0 - exp(-2.4 * transfer));
  vec4 tint = texture(uTint, uv);
  vec3 stored = tint.rgb / max(tint.a, 0.001);
  vec3 ink = mix(uInk, stored * stored, smoothstep(0.0, 0.08, tint.a));
  vec3 colour = uBlotter * pow(ink, vec3(amount));
  colour = pow(clamp(colour, 0.0, 1.0), vec3(1.0 / 2.2));
  fragColor = vec4(colour + (speck - 0.5) / 255.0, 1.0);
}`;


export const TINT_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform sampler2D uTint;
uniform vec2 uSimRes;
uniform vec4 uRange;
uniform vec3 uInk;
uniform int uCount;
uniform vec4 uSegments[64];
uniform vec4 uNibs[64];
out vec4 fragColor;

void main() {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec2 point = vec2(gl_FragCoord.x, uSimRes.y - gl_FragCoord.y);
  vec4 tint = texelFetch(uTint, texel, 0);
  vec4 state = texelFetch(uState, texel, 0) * uRange;
  float bare = 1.0 - smoothstep(0.004, 0.04, state.g + state.b);
  vec4 fresh = vec4(sqrt(uInk), 1.0);
  for (int i = 0; i < 64; i++) {
    if (i >= uCount) break;
    vec4 segment = uSegments[i];
    vec4 nib = uNibs[i];
    vec2 a = segment.xy;
    vec2 b = segment.zw;
    float widest = max(nib.x, nib.y);
    float margin = 6.0 + 3.0 * widest;
    float reach = widest + margin + 1.5;
    vec2 low = min(a, b) - reach;
    vec2 high = max(a, b) + reach;
    if (point.x < low.x || point.y < low.y || point.x > high.x || point.y > high.y) continue;
    vec2 stroke = b - a;
    float along = clamp(dot(point - a, stroke) / max(dot(stroke, stroke), 0.0001), 0.0, 1.0);
    float radius = mix(nib.x, nib.y, along);
    float dist = length(point - a - stroke * along) - radius;
    float core = 1.0 - smoothstep(-0.7, 0.7, dist);
    float halo = (1.0 - smoothstep(margin - 2.0, margin, dist)) * bare;
    tint = mix(tint, fresh, max(core, halo));
  }
  fragColor = tint;
}`;

export const REDUCE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec4 uRange;
out vec4 fragColor;

void main() {
  ivec2 size = textureSize(uState, 0);
  ivec2 origin = ivec2(gl_FragCoord.xy) * 8;
  float deepest = 0.0;
  for (int y = 0; y < 8; y++) {
    for (int x = 0; x < 8; x++) {
      ivec2 at = min(origin + ivec2(x, y), size - 1);
      deepest = max(deepest, texelFetch(uState, at, 0).r * uRange.r);
    }
  }
  fragColor = vec4(sqrt(clamp(deepest * 0.5, 0.0, 1.0)), 0.0, 0.0, 1.0);
}`;

export const FIBRE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
out vec4 fragColor;

const float CELL = 24.0;
const int STRANDS_PER_CELL = 11;

uint mixBits(uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}

uint cellHash(ivec2 cell, uint salt) {
  return mixBits(uint(cell.x + 64) * 1597334677u ^ mixBits(uint(cell.y + 64) * 3812015801u ^ salt));
}

vec4 unpackBytes(uint h) {
  return vec4(float(h & 255u), float((h >> 8u) & 255u), float((h >> 16u) & 255u), float(h >> 24u)) / 255.0;
}

float lattice(ivec2 cell) {
  return unpackBytes(cellHash(cell, 4099u)).x;
}

float haze(vec2 p) {
  vec2 corner = floor(p);
  vec2 f = p - corner;
  vec2 s = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(corner);
  float bottom = mix(lattice(c), lattice(c + ivec2(1, 0)), s.x);
  float top = mix(lattice(c + ivec2(0, 1)), lattice(c + ivec2(1, 1)), s.x);
  return mix(bottom, top, s.y);
}

void main() {
  vec2 point = gl_FragCoord.xy;
  ivec2 home = ivec2(floor(point / CELL));
  float untouched = 1.0;
  for (int cy = -1; cy <= 1; cy++) {
    for (int cx = -1; cx <= 1; cx++) {
      ivec2 cell = home + ivec2(cx, cy);
      for (int i = 0; i < STRANDS_PER_CELL; i++) {
        uint salt = uint(i) * 2u;
        vec4 first = unpackBytes(cellHash(cell, salt + 1u));
        vec4 second = unpackBytes(cellHash(cell, salt + 2u));
        vec2 centre = (vec2(cell) + first.xy) * CELL;
        float angle = (first.z - 0.5) * 2.6;
        float halfSpan = 0.5 * (6.0 + first.w * second.x * 38.0);
        float bend = (second.y - 0.5) * 0.9;
        float opacity = 0.18 + second.z * 0.3;
        float thickness = 0.5 + second.w * 0.9;
        vec2 direction = vec2(cos(angle), sin(angle));
        vec2 offset = point - centre;
        float along = dot(offset, direction);
        float across = dot(offset, vec2(-direction.y, direction.x));
        float t = clamp(along / halfSpan, -1.0, 1.0);
        float curve = bend * halfSpan * (1.0 - t * t);
        float dist = length(vec2(along - t * halfSpan, across - curve));
        float cover = 1.0 - smoothstep(thickness * 0.5 - 0.5, thickness * 0.5 + 0.5, dist);
        untouched *= 1.0 - opacity * cover;
      }
    }
  }
  float strand = 1.0 - untouched;
  float cloud = haze(point / vec2(22.0, 9.0));
  float grain = unpackBytes(cellHash(ivec2(point), 977u)).x;
  float fibre = min(1.0, 0.22 + 0.3 * cloud + 0.62 * strand);
  fragColor = vec4(fibre, grain, strand, 1.0);
}`;
