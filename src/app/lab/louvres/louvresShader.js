export const MAX_BLADES = 32;

export const QUAD_VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const LOUVRE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uImage;
uniform vec2 uRes;
uniform float uAngles[32];
uniform int uCount;
uniform float uSpacing;
uniform float uFloor;
uniform float uCeiling;
uniform float uHorizon;
uniform float uDepth;
uniform float uThrow;
uniform float uSkew;
uniform float uDpr;
uniform float uSamples;
uniform vec4 uCover;
out vec4 outColor;

const float BLADE = 0.93;
const float THICK = 0.16;
const float BULGE = 0.03;
const float REEDS = 5.0;
const float REED_SIN = 0.34;

struct Pass {
  float base;
  float slope;
  float path;
  float kind;
  float fresnel;
  float dim;
  vec2 normal;
  vec2 macro;
};

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

float bladeAngle(int i) {
  return uAngles[clamp(i, 0, 31)];
}

float faceSlope(float a, float halfW, float side, float reeds) {
  float crown = BULGE * uSpacing;
  float slope = -2.0 * crown * a / max(halfW * halfW, 1.0);
  if (side < 0.0) {
    float period = 2.0 * halfW / REEDS;
    float phase = fract(a / max(period, 1e-3)) - 0.5;
    float q = phase * 2.0 * REED_SIN * reeds;
    slope += -q / sqrt(max(1.0 - q * q, 0.05));
  }
  return slope;
}

Pass traceBlade(float u, float theta, float ior, float reeds) {
  Pass r;
  r.base = 0.0;
  r.slope = 0.0;
  r.path = 0.0;
  r.kind = 0.0;
  r.fresnel = 0.0;
  r.dim = 1.0;
  r.normal = vec2(0.0, -1.0);
  r.macro = r.normal;
  float c = cos(theta);
  float s = sin(theta);
  float halfW = 0.5 * BLADE * uSpacing;
  float halfT = 0.5 * THICK * uSpacing;
  float z0 = -2.0 * uSpacing;
  vec2 lo = vec2(u * c + z0 * s, -u * s + z0 * c);
  vec2 ld = vec2(s, c);
  vec2 safe = vec2(abs(ld.x) < 1e-4 ? 1e-4 : ld.x, abs(ld.y) < 1e-4 ? 1e-4 : ld.y);
  vec2 inv = 1.0 / safe;
  vec2 t1 = (vec2(-halfW, -halfT) - lo) * inv;
  vec2 t2 = (vec2(halfW, halfT) - lo) * inv;
  vec2 tn = min(t1, t2);
  vec2 tf = max(t1, t2);
  float tNear = max(tn.x, tn.y);
  float tFar = min(tf.x, tf.y);
  if (tNear > tFar) return r;
  vec2 hit = lo + ld * tNear;
  if (tn.x > tn.y) {
    vec2 edgeNormal = vec2(-sign(safe.x), 0.0);
    float cosEdge = clamp(-dot(ld, edgeNormal), 0.0, 1.0);
    r.kind = 2.0;
    r.normal = vec2(edgeNormal.x * c, edgeNormal.x * s);
    r.macro = r.normal;
    r.fresnel = 0.04 + 0.96 * pow(1.0 - cosEdge, 5.0);
    r.path = clamp((hit.y + halfT) / max(2.0 * halfT, 1e-3), 0.0, 1.0);
    return r;
  }
  float side = -sign(safe.y);
  float slopeIn = faceSlope(hit.x, halfW, side, reeds);
  vec2 nIn = normalize(vec2(-slopeIn, side));
  float cosIn = clamp(-dot(ld, nIn), 0.0, 1.0);
  r.fresnel = 0.04 + 0.96 * pow(1.0 - cosIn, 5.0);
  vec2 d1 = refract(ld, nIn, 1.0 / ior);
  if (dot(d1, d1) < 1e-6) d1 = ld;
  float inward = max(abs(d1.y), 0.05);
  float travel = 2.0 * halfT / inward;
  float aExit = hit.x + d1.x * travel;
  float dim = 1.0;
  if (abs(aExit) > halfW) {
    float wall = sign(aExit) * halfW;
    aExit = 2.0 * wall - aExit;
    d1.x = -d1.x;
    dim = 0.66;
  }
  aExit = clamp(aExit, -halfW, halfW);
  float back = -side;
  float slopeOut = faceSlope(aExit, halfW, back, reeds);
  vec2 nOut = normalize(vec2(-slopeOut, back));
  vec2 d2 = refract(d1, -nOut, ior);
  if (dot(d2, d2) < 1e-6) {
    d2 = reflect(d1, -nOut);
    d2.y = -d2.y;
    dim *= 0.35;
  }
  vec2 pe = vec2(aExit, back * halfT);
  vec2 wp = vec2(pe.x * c - pe.y * s, pe.x * s + pe.y * c);
  vec2 wd = vec2(d2.x * c - d2.y * s, d2.x * s + d2.y * c);
  float dz = max(wd.y, 0.2);
  r.slope = clamp(wd.x / dz, -4.0, 4.0);
  r.base = wp.x - u - r.slope * wp.y;
  r.path = travel / max(2.0 * halfT, 1e-3);
  r.kind = 1.0;
  r.dim = dim * (1.0 - r.fresnel) * 0.96;
  r.normal = vec2(nIn.x * c - nIn.y * s, nIn.x * s + nIn.y * c);
  float crown = -2.0 * BULGE * uSpacing * hit.x / max(halfW * halfW, 1.0);
  vec2 nMacro = normalize(vec2(-crown, side));
  r.macro = vec2(nMacro.x * c - nMacro.y * s, nMacro.x * s + nMacro.y * c);
  return r;
}

vec3 scenery(vec2 p, float lod) {
  vec2 uv = uCover.xy + p * uCover.zw;
  vec3 col = textureLod(uImage, uv, lod).rgb;
  return col * 0.95 + vec3(0.035, 0.04, 0.045);
}

vec3 roomLight(vec2 n, float y) {
  float fromLeft = clamp(0.5 - 0.5 * n.x, 0.0, 1.0);
  float lower = smoothstep(0.0, uFloor, y);
  vec3 cool = vec3(0.78, 0.8, 0.82);
  vec3 warm = vec3(0.98, 0.96, 0.92);
  return mix(cool, warm, fromLeft * 0.7 + lower * 0.3);
}

float keyLight(vec2 n, vec2 macro, float y) {
  vec2 h = normalize(normalize(vec2(0.85, -1.0)) + vec2(0.0, -1.0));
  float facing = max(dot(n, h), 0.0);
  float broad = max(dot(macro, h), 0.0);
  float tall = 1.0 - 0.55 * smoothstep(uCeiling, uFloor * 1.1, y);
  float crisp = pow(facing, 2000.0) * 0.2 + smoothstep(0.9996, 0.9999, broad) * 0.5 + pow(broad, 900.0) * 0.04;
  return crisp * tall;
}

vec3 bladeAt(vec2 p, float u, float theta) {
  Pass g = traceBlade(u, theta, 1.515, 1.0);
  float lod = 0.35;
  if (g.kind > 1.5) {
    float glow = dot(scenery(p, 3.5), vec3(0.3, 0.55, 0.15));
    vec3 edge = mix(vec3(0.42, 0.62, 0.56), vec3(0.78, 0.92, 0.86), g.path) * (0.55 + 0.75 * glow);
    edge = mix(edge, roomLight(g.normal, p.y), g.fresnel * 0.6);
    return edge + vec3(keyLight(g.normal, g.macro, p.y)) * 0.7;
  }
  Pass pr = traceBlade(u, theta, 1.497, 1.0);
  Pass pb = traceBlade(u, theta, 1.538, 1.0);
  float shiftG = g.base + g.slope * uDepth;
  float shiftR = pr.kind > 0.5 && pr.kind < 1.5 ? pr.base + pr.slope * uDepth : shiftG;
  float shiftB = pb.kind > 0.5 && pb.kind < 1.5 ? pb.base + pb.slope * uDepth : shiftG;
  float soften = lod + min(abs(g.slope) * 1.6, 2.2);
  vec3 through = vec3(
    scenery(vec2(p.x + shiftR, p.y), soften).r,
    scenery(vec2(p.x + shiftG, p.y), soften).g,
    scenery(vec2(p.x + shiftB, p.y), soften).b
  );
  vec3 absorb = exp(-vec3(0.2, 0.05, 0.12) * clamp(g.path, 0.0, 8.0));
  vec3 col = through * absorb * g.dim;
  col = mix(col, vec3(0.86, 0.93, 0.92), 0.06);
  col += roomLight(g.normal, p.y) * g.fresnel;
  float hang = exp(-max(p.y - uCeiling, 0.0) / (22.0 * uDpr));
  col *= 1.0 - 0.18 * hang * step(0.5, uCeiling);
  col += vec3(keyLight(g.normal, g.macro, p.y));
  float sill = smoothstep(uFloor - 40.0 * uDpr, uFloor, p.y);
  col *= 1.0 - 0.12 * sill;
  return col;
}

vec3 wallAt(vec2 p) {
  float fi = floor(p.x / uSpacing);
  int i = int(fi);
  vec3 view = scenery(p, 0.0);
  if (i < 0 || i >= uCount) return view;
  float pivot = (fi + 0.5) * uSpacing;
  return bladeAt(p, p.x - pivot, bladeAngle(i));
}

float lightChannel(float x, float dist, float spread, float ior, float caustic) {
  float fi = floor(x / uSpacing);
  int i = int(fi);
  if (i < 0 || i >= uCount) return 1.0;
  float pivot = (fi + 0.5) * uSpacing;
  float u = x - pivot;
  float theta = -bladeAngle(i);
  Pass a = traceBlade(u, theta, ior, 0.3);
  if (a.kind < 0.5) return 1.0;
  if (a.kind > 1.5) return 0.62;
  Pass b = traceBlade(u + spread, theta, ior, 0.3);
  if (b.kind < 0.5 || b.kind > 1.5) return a.dim * 0.9;
  float shiftA = a.base + a.slope * dist;
  float shiftB = b.base + b.slope * dist;
  float stretch = 1.0 + (shiftB - shiftA) / spread;
  float focus = min(1.0 / max(abs(stretch), 0.3), 2.4);
  return a.dim * mix(1.0, focus, caustic);
}

vec3 floorAt(vec2 p) {
  float m = max((p.y - uHorizon) / max(uFloor - uHorizon, 1.0), 1.0);
  float depth = 1.0 - 1.0 / m;
  float cx = 0.5 * uRes.x;
  float wx = cx + (p.x - cx) / m + uSkew * depth;
  float dist = depth * uThrow;
  float spread = 0.18 * uSpacing + depth * 1.1 * uSpacing;
  float caustic = 0.45 * (1.0 - smoothstep(0.0, 0.3, depth));
  vec3 light = vec3(0.0);
  for (int k = -1; k <= 1; k++) {
    float at = wx + float(k) * spread * 0.6;
    light += vec3(
      lightChannel(at, dist, spread, 1.49, caustic),
      lightChannel(at, dist, spread, 1.515, caustic),
      lightChannel(at, dist, spread, 1.545, caustic)
    );
  }
  light /= 3.0;
  vec3 sun = vec3(1.0, 0.965, 0.9);
  vec2 grain = vec2(wx, depth * uRes.y * 2.4);
  float mottle = noise(grain / (34.0 * uDpr)) * 0.6 + noise(grain / (9.0 * uDpr)) * 0.4;
  vec3 stone = vec3(0.905, 0.885, 0.85) * (0.97 + 0.05 * mottle);
  vec3 col = stone * (0.72 + 0.3 * light * sun);
  vec2 mirror = vec2(wx, uFloor - (p.y - uFloor) * 1.6);
  vec3 bounce = scenery(mirror, 4.5);
  float gloss = 0.1 * (1.0 - smoothstep(0.0, 0.3, depth));
  col = mix(col, bounce, gloss);
  float contact = exp(-(p.y - uFloor) / (14.0 * uDpr));
  col *= 1.0 - 0.34 * contact;
  col *= 1.0 - 0.06 * smoothstep(0.1, 0.4, depth);
  return col;
}

vec3 ceilingAt(vec2 p) {
  float t = clamp(p.y / max(uCeiling, 1.0), 0.0, 1.0);
  vec3 plaster = vec3(0.925, 0.91, 0.885);
  float shade = 1.0 - 0.1 * smoothstep(0.55, 1.0, t);
  float rail = smoothstep(uCeiling - 7.0 * uDpr, uCeiling - 6.0 * uDpr, p.y);
  vec3 metal = mix(vec3(0.42, 0.4, 0.38), vec3(0.2, 0.19, 0.18), smoothstep(uCeiling - 6.0 * uDpr, uCeiling, p.y));
  return mix(plaster * shade, metal, rail);
}

vec3 trackAt(vec2 p, float top) {
  float t = (p.y - top) / max(uFloor - top, 1.0);
  vec3 metal = mix(vec3(0.36, 0.34, 0.32), vec3(0.16, 0.15, 0.145), smoothstep(0.0, 0.5, t));
  metal += vec3(0.32) * (1.0 - smoothstep(0.0, 0.25, t));
  return metal;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float trackTop = uFloor - 5.0 * uDpr;
  vec3 col;
  if (p.y < uCeiling) {
    col = ceilingAt(p);
  } else if (p.y >= uFloor) {
    col = floorAt(p);
  } else if (p.y >= trackTop) {
    col = trackAt(p, trackTop);
  } else if (uSamples > 1.5) {
    col = 0.5 * (wallAt(p + vec2(-0.25, 0.0)) + wallAt(p + vec2(0.25, 0.0)));
  } else {
    col = wallAt(p);
  }
  vec2 q = gl_FragCoord.xy / uRes - 0.5;
  col *= 1.0 - 0.1 * dot(q, q);
  col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
