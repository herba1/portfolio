export const QUAD_VS = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SCENE_FS = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform vec3 uCamPos;
uniform vec3 uCamF;
uniform vec3 uCamR;
uniform vec3 uCamU;
uniform float uFocal;
uniform vec2 uCenter;
uniform vec3 uSun;
uniform vec3 uLight;
uniform vec3 uShadow;
uniform float uTint;
uniform float uAmbient;
uniform vec3 uFog0;
uniform vec3 uFog1;
uniform float uBounce;
uniform float uRays;
uniform float uDrift;
uniform float uFade;
uniform vec3 uPaper;
uniform vec4 uWin;
uniform float uWinZ;
uniform int uRaySteps;
out vec4 outColor;

const vec3 WALL = vec3(0.84, 0.79, 0.72);
const vec3 TABLE = vec3(0.74, 0.6, 0.42);
const vec3 CLAY = vec3(0.56, 0.13, 0.05);
const vec3 CUP = vec3(0.88, 0.85, 0.79);
const vec3 FRUIT = vec3(0.87, 0.26, 0.03);

const vec2 BOTTLE = vec2(-1.2, 1.0);
const float BOTTLE_R = 0.46;
const float BOTTLE_H = 1.22;
const float NECK_R = 0.135;
const float NECK_H = 2.32;
const vec2 CUPC = vec2(0.32, 1.55);
const float CUP_R = 0.4;
const float CUP_H = 0.8;
const vec4 ORANGE = vec4(1.3, 0.34, 1.95, 0.34);

struct Hit {
  float t;
  vec3 n;
  float id;
  float edge;
  float inner;
};

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash1(float n) {
  return fract(sin(n * 91.345 + 3.17) * 43758.5453);
}

float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash1(i), hash1(i + 1.0), u);
}

void cylinder(vec3 ro, vec3 rd, vec2 c, float r, float y0, float y1, float id, bool cap, inout Hit h) {
  vec2 o = ro.xz - c;
  vec2 d = rd.xz;
  float a = dot(d, d);
  float b = dot(o, d);
  float k = dot(o, o) - r * r;
  float disc = b * b - a * k;
  if (disc < 0.0) return;
  float s = sqrt(disc);
  float t = (-b - s) / a;
  float y = ro.y + t * rd.y;
  float tc = -b / a;
  float dc = length(o + d * tc);
  if (t > 0.0 && y >= y0 && y <= y1 && t < h.t) {
    vec2 p = o + d * t;
    h.t = t;
    h.n = vec3(p.x / r, 0.0, p.y / r);
    h.id = id;
    h.edge = min(r - dc, y0 < 0.001 ? y - y0 : 1e9);
    h.inner = 0.0;
    return;
  }
  if (cap && rd.y < 0.0) {
    float tt = (y1 - ro.y) / rd.y;
    vec2 p = o + d * tt;
    float q = length(p);
    if (tt > 0.0 && q < r && tt < h.t) {
      h.t = tt;
      h.n = vec3(0.0, 1.0, 0.0);
      h.id = id;
      h.edge = (r - q) * max(0.25, -rd.y);
      h.inner = q / r;
    }
  }
}

void sphere(vec3 ro, vec3 rd, vec4 sp, float id, float yMin, inout Hit h) {
  vec3 o = ro - sp.xyz;
  float b = dot(o, rd);
  float k = dot(o, o) - sp.w * sp.w;
  float disc = b * b - k;
  if (disc < 0.0) return;
  float t = -b - sqrt(disc);
  vec3 p = ro + rd * t;
  if (t > 0.0 && t < h.t && p.y >= yMin) {
    h.t = t;
    h.n = (p - sp.xyz) / sp.w;
    h.id = id;
    h.edge = sp.w - length(o - rd * b);
    h.inner = 0.0;
  }
}

Hit traceObjects(vec3 ro, vec3 rd) {
  Hit h;
  h.t = 1e9;
  h.n = vec3(0.0);
  h.id = 0.0;
  h.edge = 1e9;
  h.inner = 0.0;
  cylinder(ro, rd, BOTTLE, BOTTLE_R, 0.0, BOTTLE_H, 1.0, false, h);
  sphere(ro, rd, vec4(BOTTLE.x, BOTTLE_H, BOTTLE.y, BOTTLE_R), 1.0, BOTTLE_H, h);
  cylinder(ro, rd, BOTTLE, NECK_R, BOTTLE_H, NECK_H, 1.0, true, h);
  cylinder(ro, rd, CUPC, CUP_R, 0.0, CUP_H, 2.0, true, h);
  sphere(ro, rd, ORANGE, 3.0, -1.0, h);
  return h;
}

Hit traceRoom(vec3 ro, vec3 rd) {
  Hit h;
  h.t = 1e9;
  h.n = vec3(0.0, 0.0, 1.0);
  h.id = 4.0;
  h.edge = 1e9;
  h.inner = 0.0;
  if (rd.z < 0.0) {
    float t = -ro.z / rd.z;
    vec3 p = ro + rd * t;
    if (p.y >= 0.0) {
      h.t = t;
    }
  }
  if (rd.y < 0.0) {
    float t = -ro.y / rd.y;
    vec3 p = ro + rd * t;
    if (p.z >= 0.0 && t < h.t) {
      h.t = t;
      h.n = vec3(0.0, 1.0, 0.0);
      h.id = 5.0;
    }
  }
  return h;
}

float windowMask(vec2 w, float soft) {
  float m = smoothstep(uWin.x - soft, uWin.x + soft, w.x) * smoothstep(uWin.y + soft, uWin.y - soft, w.x);
  m *= smoothstep(uWin.z - soft, uWin.z + soft, w.y) * smoothstep(uWin.w + soft, uWin.w - soft, w.y);
  float mx = 0.5 * (uWin.x + uWin.y);
  float my = mix(uWin.z, uWin.w, 0.7);
  m *= smoothstep(0.055 - soft, 0.055 + soft, abs(w.x - mx));
  m *= smoothstep(0.055 - soft, 0.055 + soft, abs(w.y - my));
  return m;
}

float windowLight(vec3 p, out float s) {
  s = (uWinZ - p.z) / max(uSun.z, 0.02);
  vec3 w = p + uSun * s;
  return windowMask(w.xy, 0.012 * s + 0.012);
}

float occSphere(vec3 p, vec4 sp) {
  vec3 v = sp.xyz - p;
  float tc = dot(v, uSun);
  if (tc <= 0.0) return 0.0;
  float d = length(v - uSun * tc);
  float w = 0.014 * tc + 0.006;
  return smoothstep(sp.w + w, sp.w - w, d);
}

float occCylinder(vec3 p, vec2 c, float r, float y0, float y1) {
  vec2 o = p.xz - c;
  vec2 dh = uSun.xz;
  float a = max(dot(dh, dh), 1e-4);
  float tc = -dot(o, dh) / a;
  if (tc <= 0.0) return 0.0;
  float dmin = length(o + dh * tc);
  float w = 0.014 * tc + 0.006;
  float half_ = sqrt(max(r * r - dmin * dmin, 0.0) / a);
  float yc = p.y + uSun.y * tc;
  float lo = yc - uSun.y * half_;
  float hi = yc + uSun.y * half_;
  float vert = smoothstep(y0 - w, y0 + w, hi) * smoothstep(y1 + w, y1 - w, lo);
  return smoothstep(r + w, r - w, dmin) * vert;
}

float sunVisibility(vec3 p, float self) {
  if (uSun.z <= 0.02) return 0.0;
  float s;
  float m = windowLight(p, s);
  if (m <= 0.001) return 0.0;
  float v = 1.0;
  if (self != 1.0) {
    v *= 1.0 - occCylinder(p, BOTTLE, BOTTLE_R, 0.0, BOTTLE_H);
    v *= 1.0 - occSphere(p, vec4(BOTTLE.x, BOTTLE_H, BOTTLE.y, BOTTLE_R));
    v *= 1.0 - occCylinder(p, BOTTLE, NECK_R, BOTTLE_H, NECK_H);
  }
  if (self != 2.0) v *= 1.0 - occCylinder(p, CUPC, CUP_R, 0.0, CUP_H);
  if (self != 3.0) v *= 1.0 - occSphere(p, ORANGE);
  return m * v;
}

vec3 albedo(float id, vec3 p, float inner) {
  if (id == 1.0) return CLAY;
  if (id == 2.0) return inner > 0.88 ? CUP : CUP * 0.74;
  if (id == 3.0) return FRUIT;
  if (id == 5.0) return TABLE;
  return WALL;
}

float occlusion(vec3 p, float id) {
  float ao = 1.0;
  if (id >= 4.0) {
    float crease = id == 4.0 ? p.y : p.z;
    ao *= 1.0 - 0.2 * exp(-crease / 0.22);
  }
  if (id == 5.0) {
    float db = length(p.xz - BOTTLE) - BOTTLE_R;
    float dc = length(p.xz - CUPC) - CUP_R;
    float dor = length(p.xz - ORANGE.xz) - ORANGE.w * 0.4;
    ao *= 1.0 - 0.34 * exp(-max(db, 0.0) / 0.1);
    ao *= 1.0 - 0.34 * exp(-max(dc, 0.0) / 0.1);
    ao *= 1.0 - 0.36 * exp(-max(dor, 0.0) / 0.12);
  }
  if (id == 4.0) {
    float db = length(vec2(p.x - BOTTLE.x, p.z - BOTTLE.y)) - BOTTLE_R;
    ao *= 1.0 - 0.08 * exp(-max(db, 0.0) / 0.4) * smoothstep(NECK_H + 0.6, 0.0, p.y);
  }
  return ao;
}

vec3 shade(vec3 p, vec3 n, float id, float inner, vec2 uv) {
  vec3 a = albedo(id, p, inner);
  float ndl = dot(n, uSun);
  float body = id < 4.0 ? smoothstep(-0.04, 0.22, ndl) : smoothstep(0.0, 0.05, ndl);
  float lit = body * sunVisibility(p + n * 0.002, id);
  if (id == 2.0 && inner > 0.0 && inner < 0.88) lit *= smoothstep(0.86, 0.5, inner) * 0.6;
  vec3 bounce = mix(mix(uFog0, uFog1, uv.x), mix(uFog1, uFog0, uv.x), uv.y);
  vec3 tint = mix(vec3(1.0), uShadow, uTint);
  float form = id < 4.0 ? 0.8 + 0.2 * n.y + 0.16 * n.z - 0.1 * n.x : 1.0;
  vec3 ambient = a * uAmbient * tint * mix(vec3(1.0), bounce, uBounce) * occlusion(p, id) * form;
  float wrap_ = id < 4.0 ? 0.5 + 0.5 * max(ndl, 0.0) : 0.55 + 0.45 * max(ndl, 0.0);
  vec3 sunlit = a * uLight * wrap_ * 1.25;
  vec3 lighten = max(ambient, sunlit + ambient * 0.18);
  return mix(ambient, lighten, lit);
}

float rays(vec3 ro, vec3 rd, float tEnd, float jitter) {
  if (uRays <= 0.001 || uSun.z <= 0.02) return 0.0;
  float t0 = rd.z < 0.0 ? max(0.0, (uWinZ - ro.z) / rd.z) : 0.0;
  if (t0 >= tEnd) return 0.0;
  float acc = 0.0;
  float span = tEnd - t0;
  for (int i = 0; i < 20; i++) {
    if (i >= uRaySteps) break;
    float f = (float(i) + jitter) / float(uRaySteps);
    vec3 q = ro + rd * (t0 + span * f);
    float s = (uWinZ - q.z) / max(uSun.z, 0.02);
    vec3 w = q + uSun * s;
    float m = windowMask(w.xy, 0.04 * s + 0.07);
    float streak = smoothstep(0.22, 0.86, noise1(w.x * 4.6 + w.y * 1.3 + uDrift));
    float near = mix(0.55, 1.0, exp(-s * 0.32));
    acc += m * (0.3 + 0.7 * streak) * near;
  }
  return acc / float(uRaySteps) * span;
}

vec3 toSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;
  vec2 sp = frag - uCenter;
  vec3 rd = normalize(uCamF * uFocal + uCamR * sp.x + uCamU * sp.y);
  vec3 ro = uCamPos;
  Hit room = traceRoom(ro, rd);
  Hit obj = traceObjects(ro, rd);
  vec2 suv = vec2(uv.x, 1.0 - uv.y);
  vec3 col;
  float tEnd = room.t;
  vec3 back = shade(ro + rd * room.t, room.n, room.id, 0.0, suv);
  if (obj.t < room.t) {
    vec3 p = ro + rd * obj.t;
    vec3 front = shade(p, obj.n, obj.id, obj.inner, suv);
    float px = obj.t / uFocal;
    float cover = clamp(obj.edge / px + 0.5, 0.0, 1.0);
    col = mix(back, front, cover);
    tEnd = mix(room.t, obj.t, cover);
  } else {
    col = back;
  }
  float jitter = fract(52.9829189 * fract(dot(frag, vec2(0.06711056, 0.00583715))));
  float r = rays(ro, rd, tEnd, jitter);
  col += uLight * r * uRays * 0.34;
  col = col / (1.0 + max(col - 0.82, 0.0) * 0.9);
  vec3 srgb = toSrgb(clamp(col, 0.0, 1.0));
  srgb += (hash(frag + 7.13) - 0.5) / 255.0;
  outColor = vec4(mix(uPaper, srgb, uFade), 1.0);
}
`;
