export const ICE_VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const ICE_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform vec2 uRes;
uniform vec2 uShift;
uniform vec3 uCamPos;
uniform mat3 uCamMat;
uniform float uFocal;
uniform vec4 uDims;
uniform vec4 uSleeveDims;
uniform vec3 uSleevePos;
uniform mat3 uSleeveRot;
uniform vec3 uRestPos;
uniform mat3 uRestRot;
uniform vec3 uSlotC;
uniform vec3 uSlotH;
uniform vec2 uExt;
uniform vec2 uFrost;
uniform float uSeed;
uniform vec3 uLabel;
uniform float uSleeveWet;
uniform float uFade;
uniform sampler2D uMelt;
uniform sampler2D uFace;
uniform sampler2D uPuddle;
uniform sampler2D uSleeve;

out vec4 outColor;

const float ETA = 1.31;
const vec3 KEY = vec3(-0.2723, 0.7464, -0.6072);
const vec3 KEY_COL = vec3(1.0, 0.985, 0.96);
const vec3 AMB = vec3(0.075, 0.09, 0.115);
const vec3 ICE_ABS = vec3(0.34, 0.11, 0.06);

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p) {
  vec3 p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), u.x);
  float b = mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), u.x);
  float c = mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), u.x);
  float d = mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), u.x);
  return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
}

float fbm2(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * noise2(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.31;
    a *= 0.5;
  }
  return s;
}

float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float smax(float a, float b, float k) {
  float h = clamp(0.5 - 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) + k * h * (1.0 - h);
}

vec3 safeDir(vec3 d) {
  return vec3(
    abs(d.x) < 1e-6 ? 1e-6 : d.x,
    abs(d.y) < 1e-6 ? 1e-6 : d.y,
    abs(d.z) < 1e-6 ? 1e-6 : d.z
  );
}

vec2 boxRange(vec3 ro, vec3 rd, vec3 lo, vec3 hi) {
  vec3 inv = 1.0 / safeDir(rd);
  vec3 t0 = (lo - ro) * inv;
  vec3 t1 = (hi - ro) * inv;
  vec3 tn = min(t0, t1);
  vec3 tf = max(t0, t1);
  return vec2(max(max(tn.x, tn.y), tn.z), min(min(tf.x, tf.y), tf.z));
}

vec2 meltUv(vec2 xz) {
  return xz / (2.0 * uExt.x) + 0.5;
}

vec4 cubicWeights(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  float w = 6.0 - x - y - z;
  return vec4(x, y, z, w) / 6.0;
}

float meltSmooth(vec2 xz) {
  vec2 size = vec2(textureSize(uMelt, 0));
  vec2 st = meltUv(xz) * size - 0.5;
  vec2 f = fract(st);
  st -= f;
  vec4 wx = cubicWeights(f.x);
  vec4 wy = cubicWeights(f.y);
  vec4 sx = vec4(wx.x + wx.y, wx.z + wx.w, wy.x + wy.y, wy.z + wy.w);
  vec4 off = st.xxyy + vec4(-0.5, 1.5, -0.5, 1.5) + vec4(wx.y / max(sx.x, 1e-5), wx.w / max(sx.y, 1e-5), wy.y / max(sx.z, 1e-5), wy.w / max(sx.w, 1e-5));
  off /= size.xxyy;
  float a = texture(uMelt, off.xz).r;
  float b = texture(uMelt, off.yz).r;
  float c = texture(uMelt, off.xw).r;
  float d = texture(uMelt, off.yw).r;
  float kx = sx.x / max(sx.x + sx.y, 1e-5);
  float ky = sx.z / max(sx.z + sx.w, 1e-5);
  return mix(mix(d, c, kx), mix(b, a, kx), ky);
}

float undulate(vec2 xz) {
  return noise2(xz * 2.1 + uSeed * 7.13) - 0.5;
}

float iceShape(vec3 p, float m) {
  float b = sdRoundBox(p - vec3(0.0, uDims.y * 0.5, 0.0), vec3(uDims.x, uDims.y * 0.5, uDims.z), uDims.w);
  b -= 0.0025 * undulate(p.xz) * smoothstep(0.0, uDims.y, p.y);
  float level = uDims.y + 0.05 - m - 0.05 * smoothstep(0.0, 0.04, m);
  float d = smax(b, (p.y - level) * 0.5, 0.02);
  if (uSlotH.x > 0.0) {
    vec3 q = transpose(uRestRot) * (p - uRestPos) - uSlotC;
    d = smax(d, -sdRoundBox(q, uSlotH, 0.008), 0.012);
  }
  return d;
}

float iceSdf(vec3 p) {
  return iceShape(p, texture(uMelt, meltUv(p.xz)).r);
}

float iceSdfSmooth(vec3 p) {
  return iceShape(p, meltSmooth(p.xz));
}

vec3 iceNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  float e = 0.004;
  vec3 n = k.xyy * iceSdfSmooth(p + k.xyy * e) + k.yyx * iceSdfSmooth(p + k.yyx * e) + k.yxy * iceSdfSmooth(p + k.yxy * e) + k.xxx * iceSdfSmooth(p + k.xxx * e);
  float l = length(n);
  return l > 1e-6 ? n / l : vec3(0.0, 1.0, 0.0);
}

bool traceIce(vec3 ro, vec3 rd, int steps, out float hit) {
  hit = -1.0;
  vec2 tb = boxRange(ro, rd, vec3(-uDims.x - 0.03, -0.01, -uDims.z - 0.03), vec3(uDims.x + 0.03, uDims.y + 0.03, uDims.z + 0.03));
  if (tb.x > tb.y || tb.y < 0.0) return false;
  float t = max(tb.x, 0.0);
  for (int i = 0; i < 128; i++) {
    if (i >= steps) break;
    float d = iceSdf(ro + rd * t);
    if (d < 0.00025 * (1.0 + t)) {
      hit = t;
      return true;
    }
    t += max(d, 0.0007);
    if (t > tb.y) break;
  }
  return false;
}

float traceInside(vec3 ro, vec3 rd) {
  float t = 0.0;
  float prev = 0.0;
  for (int i = 0; i < 56; i++) {
    float d = iceSdf(ro + rd * t);
    if (d > 0.0) break;
    prev = t;
    t += max(-d * 0.9, 0.004);
    if (t > 4.0) break;
  }
  float lo = prev;
  float hi = t;
  for (int i = 0; i < 5; i++) {
    float mid = 0.5 * (lo + hi);
    if (iceSdf(ro + rd * mid) > 0.0) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi);
}

float sleeveHit(vec3 ro, vec3 rd, out vec3 lp, out vec3 ln, out float kind) {
  mat3 rt = transpose(uSleeveRot);
  vec3 o = rt * (ro - uSleevePos);
  vec3 d = rt * rd;
  vec3 h = vec3(uSleeveDims.x, uSleeveDims.y, uSleeveDims.x);
  float best = 1e9;
  kind = 0.0;
  ln = vec3(0.0, 1.0, 0.0);
  vec3 inv = 1.0 / safeDir(d);
  vec3 t0 = (-h - o) * inv;
  vec3 t1 = (h - o) * inv;
  vec3 tn = min(t0, t1);
  vec3 tf = max(t0, t1);
  float near = max(max(tn.x, tn.y), tn.z);
  float far = min(min(tf.x, tf.y), tf.z);
  if (near < far && near > 0.0) {
    best = near;
    kind = 1.0;
    if (near == tn.y) ln = vec3(0.0, -sign(d.y), 0.0);
    else if (near == tn.x) ln = vec3(-sign(d.x), 0.0, 0.0);
    else ln = vec3(0.0, 0.0, -sign(d.z));
  }
  if (abs(d.y) > 1e-5) {
    float tp = -o.y / d.y;
    vec3 q = o + d * tp;
    vec2 dc = q.xz - vec2(uSleeveDims.w, 0.0);
    bool inside = abs(q.x) < h.x && abs(q.z) < h.z;
    if (tp > 0.0 && tp < best && !inside && length(dc) < uSleeveDims.z) {
      best = tp;
      kind = 2.0;
      ln = vec3(0.0, d.y < 0.0 ? 1.0 : -1.0, 0.0);
    }
  }
  lp = o + d * best;
  return kind > 0.0 ? best : -1.0;
}

vec3 env(vec3 d, float rough) {
  vec3 col = mix(vec3(0.010, 0.011, 0.014), vec3(0.020, 0.024, 0.031), smoothstep(-0.1, 0.9, d.y));
  col = mix(vec3(0.016, 0.017, 0.019), col, smoothstep(-0.25, 0.05, d.y));
  float soft = 0.015 + rough * 0.4;
  float spread = 1.0 / (1.0 + rough * 5.0);
  if (d.y > 0.04) {
    vec2 p = d.xz / d.y;
    vec2 c = p - vec2(-0.3, -1.0);
    vec2 q = vec2(dot(c, vec2(0.95, -0.31)), dot(c, vec2(-0.31, -0.95)));
    float strip = (1.0 - smoothstep(1.3 - soft, 1.3 + soft, abs(q.x))) * (1.0 - smoothstep(0.035 - soft * 0.2, 0.035 + soft, abs(q.y)));
    col += KEY_COL * strip * 16.0 * spread;
    float halo = exp(-dot(q * vec2(0.6, 2.2), q * vec2(0.6, 2.2)) * 2.0);
    col += vec3(0.5, 0.56, 0.64) * halo * 0.08;
  }
  if (d.z < -0.03) {
    vec2 p = d.xy / -d.z;
    float rim = (1.0 - smoothstep(2.4, 2.6 + soft, abs(p.x + 0.4))) * smoothstep(0.03 - soft * 0.3, 0.07 + soft * 0.5, p.y) * (1.0 - smoothstep(0.2, 0.26 + soft, p.y));
    col += vec3(0.62, 0.8, 1.0) * rim * 7.0 * spread;
  }
  if (d.x < -0.05) {
    vec2 p = d.zy / -d.x;
    float panel = (1.0 - smoothstep(0.5, 0.56 + soft, abs(p.x - 0.1))) * smoothstep(-0.05, 0.02 + soft, p.y) * (1.0 - smoothstep(0.55, 0.62 + soft, p.y));
    col += vec3(0.95, 0.93, 0.9) * panel * 2.2 * spread;
  }
  if (d.x > 0.05) {
    vec2 p = d.zy / d.x;
    float panel = (1.0 - smoothstep(0.7, 0.8 + soft, abs(p.x + 0.2))) * smoothstep(0.05, 0.1 + soft, p.y) * (1.0 - smoothstep(0.4, 0.5 + soft, p.y));
    col += vec3(0.55, 0.7, 0.95) * panel * 1.1 * spread;
  }
  return col;
}

float fresnel(float c, float f0) {
  float x = clamp(1.0 - c, 0.0, 1.0);
  float x2 = x * x;
  return f0 + (1.0 - f0) * x2 * x2 * x;
}

vec3 toLinear(vec3 c) {
  return pow(max(c, vec3(0.0)), vec3(2.2));
}

float caustic(vec2 p) {
  float a = noise2(p * 3.1 + uSeed * 1.7);
  float b = noise2(p * 6.3 - uSeed * 2.3 + a * 1.5);
  return smoothstep(0.45, 0.95, a * 0.6 + b * 0.5);
}

vec3 shadeVinyl(vec3 lp, vec3 n, vec3 rd, float lightK) {
  vec2 dc = lp.xz - vec2(uSleeveDims.w, 0.0);
  float r = length(dc);
  float R = uSleeveDims.z;
  vec3 tl = vec3(-dc.y, 0.0, dc.x) / max(r, 1e-4);
  vec3 t = normalize(uSleeveRot * tl + 1e-5);
  vec3 h = normalize(KEY - rd);
  float th = dot(t, h);
  float aniso = pow(sqrt(max(1.0 - th * th, 0.0)), 90.0);
  float grooves = 0.82 + 0.18 * sin(r * 1500.0);
  float band = smoothstep(R * 0.93, R * 0.94, r) * (1.0 - smoothstep(R * 0.985, R * 0.995, r));
  vec3 base = vec3(0.012, 0.012, 0.014);
  float lit = max(dot(n, KEY), 0.0) * lightK;
  vec3 col = base * (AMB * 3.0 + KEY_COL * lit);
  col += KEY_COL * aniso * grooves * (0.55 - band * 0.35) * lightK;
  col += env(reflect(rd, n), 0.15) * 0.05;
  float lip = smoothstep(R * 0.985, R, r);
  col += KEY_COL * lip * 0.06 * lightK;
  return col;
}

vec3 shadeSleeve(vec3 lp, vec3 ln, float kind, vec3 rd, float blur, float lightK, float wet) {
  vec3 n = uSleeveRot * ln;
  if (kind > 1.5) return shadeVinyl(lp, n, rd, lightK);
  float hx = uSleeveDims.x;
  vec3 albedo;
  float gloss = 0.05;
  if (ln.y > 0.5) {
    vec2 uv = vec2(lp.x, lp.z) / (2.0 * hx) + 0.5;
    albedo = toLinear(textureLod(uSleeve, uv, blur).rgb);
    float edge = max(abs(lp.x), abs(lp.z)) / hx;
    float wear = smoothstep(0.975, 1.0, edge) * (0.5 + 0.5 * noise2(lp.xz * 60.0));
    albedo = mix(albedo, vec3(0.62, 0.6, 0.56), wear * 0.5);
    gloss = 0.12;
  } else if (ln.y < -0.5) {
    albedo = vec3(0.5, 0.48, 0.44);
  } else {
    albedo = vec3(0.56, 0.54, 0.5);
  }
  albedo *= mix(1.0, 0.72, wet);
  float lit = max(dot(n, KEY), 0.0) * lightK;
  vec3 col = albedo * (KEY_COL * lit * 1.15 + AMB * 2.2);
  vec3 h = normalize(KEY - rd);
  float nh = max(dot(n, h), 0.0);
  col += KEY_COL * pow(nh, 40.0) * gloss * 0.25 * lightK * (1.0 - wet);
  float f = fresnel(max(dot(-rd, n), 0.0), 0.04);
  col += env(reflect(rd, n), mix(0.5, 0.02, wet)) * f * mix(0.35, 1.0, wet);
  if (wet > 0.01 && ln.y > 0.5) {
    vec2 g = lp.xz * 34.0 + uSeed * 9.0;
    vec2 id = floor(g);
    vec2 fr = fract(g);
    vec2 c = 0.25 + 0.5 * hash22(id);
    float rr = 0.08 + 0.22 * pow(hash12(id + 4.1), 3.0);
    float k = length(fr - c) / rr;
    if (hash12(id + 1.7) < 0.45 && k < 1.0) {
      float dome = sqrt(max(1.0 - k * k, 0.0));
      vec2 dir = (fr - c) / rr;
      vec3 bn = normalize(uSleeveRot * vec3(dir.x, dome + 0.2, dir.y));
      float bf = fresnel(max(dot(-rd, bn), 0.0), 0.02);
      vec3 bcol = col * mix(0.7, 1.0, dome) + env(reflect(rd, bn), 0.0) * bf * 1.2 + KEY_COL * pow(max(dot(bn, h), 0.0), 400.0) * 3.0 * lightK;
      col = mix(col, bcol, wet * smoothstep(1.0, 0.85, k));
    }
  }
  return col;
}

vec3 frostTint(vec3 n, vec3 rd) {
  float lit = max(dot(n, KEY), 0.0);
  float back = pow(max(dot(rd, KEY), 0.0), 3.0);
  return vec3(0.42, 0.5, 0.58) * (0.3 + 0.55 * lit) + vec3(0.6, 0.75, 0.95) * back * 0.5 + AMB * 1.5;
}

float blockShadow(vec2 p, out float edge) {
  vec2 lxz = KEY.xz / KEY.y;
  float vis = 1.0;
  edge = 0.0;
  for (int i = 0; i < 4; i++) {
    float hgt = uDims.y * (float(i) + 0.5) / 4.0;
    vec2 q = p + lxz * hgt;
    float d = sdRoundRect(q, uDims.xz, uDims.w);
    float pen = 0.01 + hgt * 0.22;
    vis = min(vis, smoothstep(-pen, pen, d));
    if (i == 3) edge = smoothstep(-0.25, -0.02, d) * (1.0 - smoothstep(-0.02, 0.05, d));
  }
  return vis;
}

float sleeveShadow(vec3 p) {
  mat3 rt = transpose(uSleeveRot);
  vec3 o = rt * (p - uSleevePos);
  vec3 d = rt * KEY;
  if (abs(d.y) < 1e-4) return 1.0;
  float tp = -o.y / d.y;
  if (tp < 0.0) return 1.0;
  vec3 q = o + d * tp;
  float sq = max(abs(q.x), abs(q.z)) - uSleeveDims.x;
  float disc = length(q.xz - vec2(uSleeveDims.w, 0.0)) - uSleeveDims.z;
  float sd = min(sq, disc);
  float pen = 0.004 + tp * 0.05;
  return mix(0.18, 1.0, smoothstep(-pen, pen, sd));
}

vec3 iceReflection(vec3 ro, vec3 rd) {
  float t;
  if (!traceIce(ro, rd, 40, t)) return vec3(-1.0);
  vec3 p = ro + rd * t;
  vec3 n = iceNormal(p);
  float c = max(dot(-rd, n), 0.0);
  float f = fresnel(c, 0.02);
  vec3 col = env(reflect(rd, n), 0.1) * f;
  float rim = pow(1.0 - c, 3.0);
  col += vec3(0.08, 0.1, 0.13) * (0.6 + rim * 2.0);
  vec3 lp;
  vec3 ln;
  float kind;
  float ts = sleeveHit(p, rd, lp, ln, kind);
  if (ts > 0.0 && kind > 0.5) col += shadeSleeve(lp, ln, kind, rd, 3.0, 0.8, 0.0) * 0.45;
  return col;
}

vec3 shadeSlate(vec3 p, vec3 rd, float dist) {
  vec2 xz = p.xz;
  float pixel = dist * 2.0 / (uFocal * uRes.y);
  float n1 = fbm2(xz * 0.8 + 11.0);
  vec2 cleave = vec2(xz.x * 0.35 + xz.y * 2.2, xz.y * 0.3 - xz.x * 0.15);
  float layers = fbm2(cleave * 3.0);
  float seams = smoothstep(0.62, 0.7, fbm2(cleave * 1.4 + 3.0)) * 0.5;
  float grain = (noise2(xz * 55.0) * 0.6 + noise2(xz * 130.0) * 0.4) * (1.0 - smoothstep(0.003, 0.012, pixel));
  vec3 albedo = vec3(0.019, 0.021, 0.025) * (0.86 + 0.24 * n1) * (0.92 + 0.16 * layers + seams * 0.3) * (0.88 + 0.24 * grain);
  float e = 0.02;
  float bc = noise2(xz * 6.0);
  float bx = (noise2((xz + vec2(e, 0.0)) * 6.0) - bc) * 0.6;
  float bz = (noise2((xz + vec2(0.0, e)) * 6.0) - bc) * 0.6;
  vec3 n = normalize(vec3(-bx * 0.18, 1.0, -bz * 0.18));

  vec2 puv = xz / (2.0 * uExt.y) + 0.5;
  float h = texture(uPuddle, puv).r;
  float damp = smoothstep(0.015, 0.06, h);
  float water = smoothstep(0.045, 0.085, h);

  float cedge;
  float vis = blockShadow(xz, cedge);
  float under = 1.0 - smoothstep(-0.02, 0.02, sdRoundRect(xz, uDims.xz, uDims.w));
  float sv = sleeveShadow(p);
  float fd = sdRoundRect(xz, uDims.xz, uDims.w);
  float ao = mix(0.55, 1.0, smoothstep(0.0, 0.16, fd));
  vec3 sl = transpose(uSleeveRot) * (p - uSleevePos);
  float sfd = max(abs(sl.x), abs(sl.z)) - uSleeveDims.x;
  float sao = mix(0.6, 1.0, smoothstep(0.0, 0.06, sfd + max(sl.y - uSleeveDims.y, 0.0) * 0.4));
  ao *= mix(1.0, sao, smoothstep(0.08, 0.0, uSleevePos.y));

  float light = mix(0.42, 1.0, vis) * sv;
  float caus = vis < 0.995 ? (1.0 - vis) * (caustic(xz) * 0.7 + cedge * 0.9) * sv : 0.0;
  albedo *= mix(1.0, 0.55, damp);
  float diff = max(dot(n, KEY), 0.0);
  vec3 col = albedo * (KEY_COL * diff * light * 1.2 + AMB * 1.2) * ao;
  col += vec3(0.5, 0.64, 0.8) * caus * 0.03 * (1.0 - under * 0.5);
  float sf = fresnel(max(dot(-rd, n), 0.0), 0.04);
  col += env(reflect(rd, n), 0.85) * sf * light * (1.0 - damp * 0.7) * ao * (0.8 + 0.25 * layers) * 0.9;

  if (damp > 0.001) {
    float s = 1.0 / float(textureSize(uPuddle, 0).x);
    float hx = texture(uPuddle, puv + vec2(s, 0.0)).r - texture(uPuddle, puv - vec2(s, 0.0)).r;
    float hz = texture(uPuddle, puv + vec2(0.0, s)).r - texture(uPuddle, puv - vec2(0.0, s)).r;
    vec3 nw = normalize(vec3(-hx * 0.08, 1.0, -hz * 0.08) + vec3(bx, 0.0, bz) * 0.02);
    vec3 rr = reflect(rd, nw);
    float f = fresnel(max(dot(-rd, nw), 0.0), 0.03);
    vec3 refl = env(rr, 0.0);
    vec3 ice = iceReflection(p + nw * 0.002, rr);
    if (ice.x >= 0.0) refl = ice * 3.0;
    col = mix(col, col * 0.7 + refl * f * 2.2, water);
    float meniscus = smoothstep(0.04, 0.07, h) * (1.0 - smoothstep(0.07, 0.11, h));
    col += vec3(0.5, 0.6, 0.7) * meniscus * 0.05 * light;
  }

  float far = smoothstep(4.0, 12.0, dist) * 0.8 + smoothstep(1.8, 5.5, length(xz - uRestPos.xz * 0.0)) * 0.55;
  col = mix(col, vec3(0.008, 0.009, 0.011), clamp(far, 0.0, 0.92));
  return col;
}

vec3 shadeGround(vec3 ro, vec3 rd, float dist) {
  vec3 lp;
  vec3 ln;
  float kind;
  float ts = sleeveHit(ro, rd, lp, ln, kind);
  float tg = rd.y < -1e-5 ? -ro.y / rd.y : -1.0;
  if (ts > 0.0 && (tg < 0.0 || ts < tg)) {
    vec3 wp = ro + rd * ts;
    float light = 1.0;
    float ce;
    light *= mix(0.5, 1.0, blockShadow(wp.xz, ce));
    return shadeSleeve(lp, ln, kind, rd, 0.0, light, uSleeveWet);
  }
  if (tg < 0.0) return env(rd, 0.0);
  return shadeSlate(ro + rd * tg, rd, dist + tg);
}

vec4 interior(vec3 ro, vec3 rd, float len, float pix) {
  vec3 scatter = vec3(0.0);
  float trans = 1.0;
  vec3 glow = vec3(0.55, 0.68, 0.82);

  for (int i = 0; i < 4; i++) {
    float k = rd.y < 0.0 ? float(i) : float(3 - i);
    float py = uDims.y * (0.86 - k * 0.21) + (k > 1.5 ? -0.02 : 0.0);
    float t = (py - ro.y) / (abs(rd.y) < 1e-5 ? 1e-5 : rd.y);
    if (t <= 0.0 || t >= len) continue;
    vec3 p = ro + rd * t;
    vec2 q = p.xz;
    float melt = texture(uMelt, meltUv(q)).r;
    float core = 1.0 - smoothstep(0.35, 0.68, max(abs(q.x) / uDims.x, abs(q.y) / uDims.z));
    float dens = smoothstep(0.42, 0.8, noise2(q * 2.4 + k * 3.1 + uSeed * 13.0)) * core * (1.0 - smoothstep(0.0, 0.05, melt));
    float cells = 30.0;
    vec2 g = q * cells + vec2(k * 17.3 + uSeed * 31.0);
    vec2 id = floor(g);
    vec2 f = fract(g);
    if (hash12(id + k * 7.0) < dens * 0.7) {
      float r = 0.07 + 0.2 * pow(hash12(id + 9.0), 4.0);
      vec2 c = 0.5 + (hash22(id * 1.7 + 3.0) - 0.5) * (1.0 - 2.0 * r);
      vec2 dv = (f - c) / r;
      float d = length(dv);
      float aa = clamp(pix * cells / r * 1.5, 0.02, 0.6);
      float disk = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
      float body = sqrt(max(1.0 - d * d, 0.0));
      float lit = clamp(0.55 + 0.45 * dot(dv, vec2(-0.6, 0.8)), 0.0, 1.0);
      float outline = smoothstep(0.7, 0.95, d);
      float spot = 1.0 - smoothstep(0.0, 0.3, length(dv - vec2(-0.3, 0.32)));
      vec3 b = mix(glow, vec3(1.0), 0.55) * (0.35 + 0.9 * lit * body) * (1.0 - outline * 0.7) + vec3(1.0) * spot * 1.5;
      scatter += trans * disk * b * 1.3;
      trans *= 1.0 - disk * 0.6;
    }
  }

  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float a = uSeed * 5.1 + fi * 2.3;
    vec3 np = normalize(vec3(sin(a) * 0.5, 0.85 + 0.15 * sin(a * 1.7), cos(a) * 0.5));
    vec3 c = vec3(sin(a * 2.9) * 0.4, uDims.y * (0.3 + 0.35 * fract(a * 0.37)), cos(a * 1.3) * 0.4);
    float dn = dot(rd, np);
    if (abs(dn) < 1e-4) continue;
    float t = dot(c - ro, np) / dn;
    if (t <= 0.0 || t >= len) continue;
    vec3 p = ro + rd * t;
    vec3 tu = normalize(cross(np, vec3(0.0, 1.0, 0.0)) + 1e-4);
    vec3 tv = cross(np, tu);
    vec2 q = vec2(dot(p - c, tu), dot(p - c, tv));
    float radius = 0.14 + 0.12 * fract(a * 1.37);
    float wob = fbm2(q * 5.0 + a);
    float edgeR = radius * (0.65 + 0.6 * wob);
    float rr = length(q * vec2(1.0, 1.35));
    float m = 1.0 - smoothstep(edgeR - 0.05, edgeR, rr);
    if (m <= 0.0) continue;
    float feather = pow(abs(sin(q.x * 70.0 + q.y * 25.0 + fbm2(q * 9.0 + a) * 9.0)), 10.0);
    float lip = smoothstep(edgeR - 0.05, edgeR - 0.012, rr) * m;
    float graze = 0.3 + 0.7 * pow(1.0 - abs(dn), 2.0);
    float veil = m * (0.03 + 0.3 * feather) * graze + lip * 0.18;
    scatter += trans * veil * mix(glow, vec3(1.0), 0.6) * 1.6;
    trans *= 1.0 - veil * 0.35;
  }

  float ds = len / 4.0;
  for (int i = 0; i < 4; i++) {
    vec3 p = ro + rd * ds * (float(i) + 0.5);
    float core = 1.0 - smoothstep(0.25, 0.7, max(abs(p.x) / uDims.x, abs(p.z) / uDims.z));
    float dens = smoothstep(0.55, 0.95, noise3(p * vec3(5.0, 3.0, 5.0) + uSeed * 4.0)) * core * 0.6;
    dens += smoothstep(0.08, 0.0, p.y) * 0.5 * core;
    scatter += trans * glow * dens * ds * 1.4;
    trans *= exp(-dens * ds * 3.0);
  }

  scatter += glow * 0.05 * len;
  return vec4(scatter, trans);
}

float frostCreep(vec3 p) {
  if (uFrost.x <= 0.0) return 0.0;
  float inward = min(uDims.x - abs(p.x), uDims.z - abs(p.z)) / uDims.x;
  inward = min(inward, (uDims.y - p.y) / uDims.x * 0.5 + 0.2);
  float dend = fbm2(p.xz * 6.0 + p.y * 4.0 + uSeed * 3.0);
  float fern = 1.0 - abs(noise2(p.xz * 18.0 + p.y * 9.0) * 2.0 - 1.0);
  float front = uFrost.x * 1.5 - inward * 1.9 - dend * 0.4 - fern * 0.08;
  float cover = smoothstep(0.0, 0.08, front);
  float thaw = smoothstep(0.0, 0.12, uFrost.y * 1.6 - (0.62 - inward) * 0.9 - dend * 0.5);
  return cover * (1.0 - thaw);
}

vec3 shadeIce(vec3 p, vec3 rd, float tCam) {
  vec3 n = iceNormal(p);
  vec2 mw = texture(uMelt, meltUv(p.xz)).rg;
  float melt = mw.x;
  float pool = smoothstep(0.03, 0.12, melt) * smoothstep(0.75, 0.95, n.y);
  float wall = smoothstep(0.004, 0.02, melt) * (1.0 - smoothstep(0.7, 0.97, n.y)) * step(0.0, n.y);
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), pool * 0.5));
  float side = 1.0 - smoothstep(0.35, 0.75, abs(n.y));

  float faceWet = 0.0;
  vec3 bump = vec3(0.0);
  if (side > 0.01) {
    float ax = abs(p.x) / uDims.x;
    float az = abs(p.z) / uDims.z;
    float face;
    float u;
    vec3 tu;
    if (ax > az) {
      face = p.x > 0.0 ? 1.0 : 3.0;
      u = (p.x > 0.0 ? -p.z : p.z) / (2.0 * uDims.z) + 0.5;
      tu = p.x > 0.0 ? vec3(0.0, 0.0, -1.0) : vec3(0.0, 0.0, 1.0);
    } else {
      face = p.z > 0.0 ? 0.0 : 2.0;
      u = (p.z > 0.0 ? p.x : -p.x) / (2.0 * uDims.x) + 0.5;
      tu = p.z > 0.0 ? vec3(1.0, 0.0, 0.0) : vec3(-1.0, 0.0, 0.0);
    }
    vec2 fuv = vec2((face + clamp(u, 0.003, 0.997)) / 4.0, clamp(p.y / uDims.y, 0.0, 1.0));
    vec2 ts = 1.0 / vec2(textureSize(uFace, 0));
    float w0 = texture(uFace, fuv).r;
    float wu = texture(uFace, fuv + vec2(ts.x, 0.0)).r - texture(uFace, fuv - vec2(ts.x, 0.0)).r;
    float wv = texture(uFace, fuv + vec2(0.0, ts.y)).r - texture(uFace, fuv - vec2(0.0, ts.y)).r;
    faceWet = w0 * side;
    bump = -(tu * wu * 0.3 + vec3(0.0, 1.0, 0.0) * wv * 0.08) * side;
  }

  float topWet = mw.y * smoothstep(-0.3, 0.5, n.y);
  float wet = clamp(max(topWet, faceWet), 0.0, 1.0);

  float ex = uDims.x - abs(p.x);
  float ez = uDims.z - abs(p.z);
  float ey = min(p.y, uDims.y - p.y);
  float lo = min(ex, min(ey, ez));
  float hi = max(ex, max(ey, ez));
  float mid = ex + ey + ez - lo - hi;
  float edgeFrost = (1.0 - smoothstep(0.0, 0.1, mid)) * (0.45 + 0.55 * noise2(p.xz * 11.0 + p.y * 7.0));
  edgeFrost = max(edgeFrost, smoothstep(0.07, 0.0, p.y) * 0.7);
  edgeFrost *= 0.42 * (1.0 - smoothstep(0.0, 0.03, melt));
  float creep = frostCreep(p);
  float frost = clamp(max(edgeFrost * (1.0 - wet), creep), 0.0, 1.0);

  vec3 nb = n;
  if (creep > 0.01) {
    vec3 g = vec3(noise3(p * 60.0), noise3(p * 60.0 + 17.0), noise3(p * 60.0 + 41.0)) - 0.5;
    nb = normalize(n + g * creep * 0.5);
  }
  if (wet > 0.01) {
    float rip = noise2(p.xz * 22.0 + uSeed) - 0.5;
    nb = normalize(nb + bump * 1.0 + vec3(rip, 0.0, -rip) * wet * 0.03);
  }

  float cosi = max(dot(-rd, nb), 0.0);
  float F = fresnel(cosi, 0.02);
  F = mix(F, fresnel(cosi, 0.024), wet);
  vec3 refl = env(reflect(rd, nb), frost * 0.8);

  vec3 rr = refract(rd, nb, 1.0 / ETA);
  if (dot(rr, rr) < 0.5) rr = reflect(rd, nb);
  vec3 ro2 = p - n * 0.004 + rr * 0.004;
  float pix = tCam * 2.0 / (uFocal * uRes.y);

  vec3 lp;
  vec3 ln;
  float kind;
  float ts = sleeveHit(ro2, rr, lp, ln, kind);
  float te = traceInside(ro2, rr);
  bool sleeveFirst = ts > 0.0 && ts < te;
  float len = sleeveFirst ? ts : te;

  vec4 vol = interior(ro2, rr, len, pix);
  vec3 absorb = exp(-ICE_ABS * len);
  float cloud = 1.0 - vol.a;

  vec3 trans;
  if (sleeveFirst) {
    vec3 wp = ro2 + rr * ts;
    float lk = 0.9;
    float blur = 0.6 + cloud * 5.0 + frost * 4.0 + len * 2.0;
    trans = shadeSleeve(lp, ln, kind, rr, blur, lk, 0.0);
  } else {
    vec3 pe = ro2 + rr * te;
    vec3 ne = iceNormal(pe);
    vec3 ro3 = refract(rr, -ne, ETA);
    if (pe.y < 0.012) {
      trans = shadeSlate(vec3(pe.x, 0.0, pe.z), rr, tCam + te) * 1.15;
    } else if (dot(ro3, ro3) < 0.5) {
      vec3 ir = reflect(rr, -ne);
      trans = env(ir, 0.25) * vec3(0.75, 0.88, 1.0) * 0.8 + vec3(0.06, 0.08, 0.1);
    } else {
      trans = shadeGround(pe + ne * 0.003, ro3, tCam + te);
    }
  }
  trans = trans * absorb * vol.a + vol.rgb * 0.1;

  vec3 col = refl * F + trans * (1.0 - F);
  vec3 wr = reflect(rd, nb);
  col += env(wr, 0.0) * wall * 0.12 + vec3(0.6, 0.75, 0.9) * wall * 0.05;
  col += vec3(0.7, 0.85, 1.0) * pow(max(dot(wr, normalize(vec3(-0.3, 0.6, -0.75))), 0.0), 60.0) * wall * 0.9;


  float rim = pow(1.0 - max(dot(-rd, n), 0.0), 4.0);
  col += vec3(0.35, 0.5, 0.7) * rim * 0.08 * (1.0 - frost);

  vec3 fcol = frostTint(nb, rd);
  float glint = step(0.985, hash13(floor(p * 260.0))) * pow(max(dot(reflect(rd, nb), KEY), 0.0), 4.0) * 2.5;
  col = mix(col, fcol, frost * 0.74) + KEY_COL * glint * creep;
  return col;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * uRes.y) - uShift;
  vec3 rd = normalize(uCamMat * vec3(uv, uFocal));
  vec3 ro = uCamPos;

  float tIce;
  bool iceHit = traceIce(ro, rd, 110, tIce);
  vec3 lp;
  vec3 ln;
  float kind;
  float ts = sleeveHit(ro, rd, lp, ln, kind);

  vec3 col;
  if (iceHit && !(ts > 0.0 && ts < tIce)) {
    col = shadeIce(ro + rd * tIce, rd, tIce);
  } else {
    col = shadeGround(ro, rd, 0.0);
  }

  vec2 sv = gl_FragCoord.xy / uRes - 0.5;
  col *= 1.0 - dot(sv, sv) * 0.55;
  col = aces(col * 1.35);
  col = pow(col, vec3(1.0 / 2.2));
  col += (hash12(gl_FragCoord.xy + uSeed) - 0.5) / 255.0;
  outColor = vec4(col * uFade, 1.0);
}
`;
