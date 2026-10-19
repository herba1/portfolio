export const LIGHT_TABLE_VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const LIGHT_TABLE_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform vec2 uRes;
uniform float uDpr;
uniform float uScale;
uniform vec4 uGlass;
uniform float uBezel;
uniform float uPower;
uniform int uCount;
uniform vec4 uPose[8];
uniform vec4 uSize[8];
uniform vec4 uRect[8];
uniform float uTexel;
uniform sampler2D uAtlas;

out vec4 outColor;

const vec3 MASK = vec3(0.86, 0.36, 0.15);
const vec3 DENSITY = vec3(1.22, 1.16, 1.0);
const vec3 TUBE = vec3(1.0, 0.972, 0.925);

float hash21(vec2 p) {
  p = fract(p * vec2(127.317, 311.703));
  p += dot(p, p + 47.113);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float rectSd(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float glassSd(vec2 p) {
  vec2 c = (uGlass.xy + uGlass.zw) * 0.5;
  vec2 h = (uGlass.zw - uGlass.xy) * 0.5;
  return rectSd(p - c, h, 1.2 * uScale);
}

vec3 glassLight(vec2 p, float foot) {
  float sd = glassSd(p);
  float cover = clamp(0.5 - sd / max(foot, 1e-4), 0.0, 1.0);
  if (cover <= 0.0) return vec3(0.0);
  vec2 c = (uGlass.xy + uGlass.zw) * 0.5;
  vec2 h = (uGlass.zw - uGlass.xy) * 0.5;
  vec2 mm = (p - uGlass.xy) / uScale;
  vec2 q = (p - c) / max(h, vec2(1.0));
  vec2 dEdge = max(h - abs(p - c), vec2(0.0)) / uScale;
  vec2 fallXY = mix(vec2(0.96), vec2(1.0), smoothstep(vec2(0.0), vec2(60.0), dEdge));
  float fall = fallXY.x * fallXY.y;
  float hot = 1.0 + 0.05 * exp(-dot(q * vec2(0.9, 1.2), q * vec2(0.9, 1.2)) * 1.4);
  float tubes = 1.0 + 0.018 * cos(6.2831853 * (mm.y + 8.0) / 54.0);
  float mottle = 1.0 + 0.026 * (vnoise(mm * 0.045 + 3.1) - 0.5) + 0.012 * (vnoise(mm * 0.31) - 0.5);
  float frost = 1.0;
  float fineMm = foot / uScale;
  float frostVis = smoothstep(0.14, 0.04, fineMm);
  if (frostVis > 0.0) frost += frostVis * 0.035 * (vnoise(mm / 0.045) - 0.5);
  return TUBE * (fall * hot * tubes * mottle * frost * cover * uPower);
}

vec3 surround(vec2 p, float foot) {
  float sd = glassSd(p);
  float outside = max(sd, 0.0) / uScale;
  vec3 desk = vec3(0.0016, 0.0015, 0.0014);
  float spill = 0.12 * exp(-outside / 3.0) + 0.04 * exp(-outside / 14.0) + 0.008 * exp(-outside / 60.0);
  vec3 glow = vec3(1.0, 0.93, 0.82) * spill * uPower;
  vec2 c = (uGlass.xy + uGlass.zw) * 0.5;
  vec2 h = (uGlass.zw - uGlass.xy) * 0.5 + uBezel;
  float bezelSd = rectSd(p - c, h, 4.0 * uScale);
  float onBezel = clamp(0.5 - bezelSd / max(foot, 1e-4), 0.0, 1.0);
  float lip = exp(-outside / 0.9) * 0.22 + exp(-outside / 3.0) * 0.05;
  vec3 metal = vec3(0.026, 0.025, 0.024) + vec3(1.0, 0.96, 0.9) * lip * uPower;
  float outerEdge = exp(-max(-bezelSd, 0.0) / (0.6 * uScale));
  metal += vec3(0.02) * outerEdge;
  vec2 mm = p / uScale;
  metal *= 1.0 + 0.08 * (vnoise(vec2(mm.x * 0.4, mm.y * 9.0)) - 0.5);
  float bezelGlow = 0.6 * exp(-max(bezelSd, 0.0) / uScale / 3.0);
  vec3 room = desk + glow * mix(0.85, 1.0, bezelGlow);
  return mix(room, metal, onBezel);
}

vec3 frontLight(vec2 p) {
  float sd = glassSd(p);
  float outside = max(sd, 0.0) / uScale;
  float near = exp(-outside / 30.0);
  return vec3(0.34, 0.33, 0.315) * (0.3 + 0.7 * uPower) * mix(0.4, 1.0, near);
}

float grain(vec2 mm, float seed, float footMm) {
  float cell = 0.055;
  float vis = smoothstep(1.3, 0.45, footMm / cell);
  if (vis <= 0.0) return 0.0;
  vec2 q = mm / cell + seed * 131.7;
  float n = vnoise(q) + 0.55 * vnoise(q * 2.13 + 7.7) - 0.775;
  return n * 0.3 * vis;
}

float dust(vec2 mm, float seed, float footMm) {
  float total = 0.0;
  if (footMm > 0.16) return 0.0;
  float cellA = 2.6;
  vec2 qa = mm / cellA + seed * 17.3;
  vec2 ida = floor(qa);
  vec2 fa = fract(qa);
  float ha = hash21(ida + seed * 3.7);
  if (ha < 0.075) {
    vec2 cp = vec2(hash21(ida + 1.7), hash21(ida + 5.3)) * 0.7 + 0.15;
    float rad = mix(0.015, 0.06, hash21(ida + 9.1));
    float d = length((fa - cp) * cellA) - rad;
    float aa = max(footMm, 1e-4);
    float area = clamp(rad * 2.0 / aa, 0.0, 1.0);
    total = max(total, (1.0 - smoothstep(-aa * 0.5, aa * 0.5, d)) * area * 0.85);
  }
  float cellB = 11.0;
  vec2 qb = mm / cellB + seed * 5.1;
  vec2 idb = floor(qb);
  vec2 fb = fract(qb);
  if (hash21(idb + 2.2 + seed) < 0.09) {
    vec2 cen = vec2(hash21(idb + 4.4), hash21(idb + 6.6)) * 0.3 + 0.35;
    float rad = mix(0.12, 0.32, hash21(idb + 8.8));
    vec2 rel = (fb - cen);
    float ang = atan(rel.y, rel.x);
    float a0 = hash21(idb + 3.3) * 6.2831853;
    float span = mix(0.6, 1.6, hash21(idb + 7.1));
    float da = mod(ang - a0 + 6.2831853, 6.2831853);
    float wedge = smoothstep(0.0, 0.12, da) * smoothstep(span, span - 0.12, da);
    float d = abs(length(rel) - rad) * cellB;
    float w = 0.009;
    float width = max(w, footMm * 0.5);
    float k = w / width;
    total = max(total, (1.0 - smoothstep(width * 0.5, width * 1.5, d)) * k * wedge * 0.8);
  }
  return total;
}

vec3 scene(vec2 p, float foot) {
  vec3 below = glassLight(p, foot);
  vec3 c = below;
  float bare = 1.0 - clamp(below.g * 4.0, 0.0, 1.0);
  if (bare > 0.0) c += surround(p, foot) * bare;
  float footMm = foot / uScale;
  vec2 tableMm = (p - uGlass.xy) / uScale;
  c *= 1.0 - dust(tableMm, 0.0, footMm) * step(0.001, below.g) * 0.7;
  vec3 front = frontLight(p);
  float lod = max(log2(max(foot * uTexel / uScale, 1e-4)), 0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= uCount) break;
    vec4 pose = uPose[i];
    vec4 size = uSize[i];
    vec2 d = p - pose.xy;
    vec2 l = vec2(pose.z * d.x + pose.w * d.y, -pose.w * d.x + pose.z * d.y);
    float kind = size.z;
    float corner = (kind < 1.5 ? 1.6 : 0.5) * uScale;
    float sd = rectSd(l, size.xy, corner);
    float cov = clamp(0.5 - sd / max(foot, 1e-4), 0.0, 1.0);
    if (cov <= 0.0) continue;
    vec4 r = uRect[i];
    vec2 t = clamp(l / (2.0 * size.xy) + 0.5, 0.0, 1.0);
    vec4 tx = textureLod(uAtlas, mix(r.xy, r.zw, t), lod);
    float a = tx.a;
    float wFilm = clamp(a * 2.0 - 1.0, 0.0, 1.0);
    float wHole = clamp(1.0 - a * 2.0, 0.0, 1.0);
    float wOpq = max(1.0 - wFilm - wHole, 0.0);
    vec2 lm = l / uScale;
    float gr = grain(lm, size.w, footMm);
    float du = dust(lm, size.w + 0.37, footMm);
    vec3 x = clamp(tx.rgb, 0.0, 1.0);
    vec3 trans;
    if (kind > 1.5 && kind < 2.5) {
      vec3 xe = clamp(x + gr * 0.18, 0.0, 1.15);
      trans = MASK * exp2(-DENSITY * xe * 3.3219);
      trans *= 1.0 - du * 0.85;
    } else {
      trans = pow(x, vec3(2.2)) * (1.0 + gr);
      trans *= 1.0 - du * 0.85;
    }
    vec3 albedo = pow(x, vec3(2.2));
    vec3 lit = albedo * front;
    if (kind < 1.5) {
      vec2 win = vec2(28.0);
      float dWin = max(rectSd(lm, win, 0.6), 0.0);
      float dOut = max(-sd / uScale, 0.0);
      float halo = 0.07 * exp(-dWin / 0.7) + 0.05 * exp(-dOut / 0.6) + 0.03 * exp(-dOut / 3.0);
      lit += c * halo;
    } else {
      lit += c * 0.02;
    }
    vec3 next = c * (wFilm * trans + wHole) + wOpq * lit;
    c = mix(c, next, cov);
  }
  return c;
}

vec3 tonemap(vec3 c) {
  c *= 1.24;
  vec3 m = c * (1.0 + c / 1.9) / (1.0 + c);
  return pow(clamp(m, 0.0, 1.0), vec3(1.0 / 2.2));
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 p = frag / uDpr;
  float foot = 1.0 / uDpr;
  vec3 col = scene(p, foot);
  vec3 outc = tonemap(col);
  outc += (hash21(gl_FragCoord.xy + 0.5) - 0.5) / 255.0;
  outColor = vec4(outc, 1.0);
}
`;
