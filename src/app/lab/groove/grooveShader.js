export const GROOVE_VS = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const GROOVE_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uFocal;
uniform float uTilt;
uniform float uDist;
uniform float uTheta;
uniform float uSweep;
uniform int uSamples;
uniform vec3 uLight;
uniform vec2 uBox;
uniform float uThick;
uniform sampler2D uPhotos;
uniform sampler2D uLabels;
uniform float uSlots;
uniform vec2 uSlot;
uniform float uMix;
uniform vec3 uToneA;
uniform vec3 uToneB;
uniform vec3 uGround;
uniform float uPhotoOn;
uniform float uKappa;
uniform vec2 uLobe;
uniform float uGain;

out vec4 outColor;

const float PI = 3.14159265;
const float R_HOLE = 0.022;
const float R_LABEL = 0.335;
const float R_LEADOUT = 0.405;
const float R_LEADIN = 0.962;
const float R_BEAD = 0.984;
const vec3 LIGHT_TINT = vec3(1.0, 0.972, 0.93);

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 s = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

vec3 toLinear(vec3 c) {
  return pow(max(c, vec3(0.0)), vec3(2.2));
}

vec3 eyePos() {
  return vec3(0.0, -uDist * sin(uTilt), uDist * cos(uTilt));
}

vec3 viewRay(vec2 frag) {
  vec2 s = (frag - uCenter) / max(uFocal, 1.0);
  vec3 f = vec3(0.0, sin(uTilt), -cos(uTilt));
  vec3 u = vec3(0.0, cos(uTilt), sin(uTilt));
  return normalize(f + vec3(s.x, 0.0, 0.0) + u * s.y);
}

float gapLine(float r, float c, float aa) {
  float w = 0.0035 + aa;
  return (1.0 - smoothstep(0.0, w, abs(r - c))) * min(1.0, 0.0045 / w);
}

float gapMask(float r, float aa) {
  float g = gapLine(r, 0.528, aa);
  g = max(g, gapLine(r, 0.648, aa));
  g = max(g, gapLine(r, 0.762, aa));
  g = max(g, gapLine(r, 0.866, aa));
  return g;
}

float softbox(vec3 p, vec3 dir) {
  if (dir.z <= 0.02) return 0.0;
  float t = (uLight.z - p.z) / dir.z;
  vec2 q = p.xy + dir.xy * t - uLight.xy;
  vec2 half_ = vec2(0.42, 0.3);
  vec2 d = abs(q) - half_ + 0.12;
  float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - 0.12;
  return 1.0 - smoothstep(-0.05, 0.05, sd);
}

vec3 photoAt(vec2 p, float slot) {
  vec2 uv = clamp(p * 0.47 + 0.5, vec2(0.002), vec2(0.998));
  uv.y = 1.0 - uv.y;
  return texture(uPhotos, vec2((slot + uv.x) / uSlots, uv.y)).rgb;
}

vec3 labelAt(vec2 p, float slot) {
  vec2 uv = clamp(p / R_LABEL * 0.5 + 0.5, vec2(0.001), vec2(0.999));
  uv.y = 1.0 - uv.y;
  return texture(uLabels, vec2((slot + uv.x) / uSlots, uv.y)).rgb;
}

vec2 rot2(vec2 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

float lobe(vec3 h, vec3 n, vec3 t, vec2 alpha) {
  vec3 b = normalize(cross(n, t));
  vec3 tt = cross(b, n);
  float hn = max(dot(h, n), 0.05);
  float st = dot(h, tt) / hn;
  float sb = dot(h, b) / hn;
  float e = st * st / max(alpha.x * alpha.x, 1e-5) + sb * sb / max(alpha.y * alpha.y, 1e-5);
  return exp(-min(e, 60.0));
}

vec3 shadeVinyl(vec3 P, vec3 V, float theta, float ringAA, float tone, float ringWave, float loud, float rPix) {
  vec2 p = rot2(P.xy, -theta);
  float r = length(P.xy);
  vec3 Lv = uLight - P;
  float dl2 = max(dot(Lv, Lv), 1e-3);
  vec3 L = Lv * inversesqrt(dl2);
  vec3 H = normalize(L + V);
  float Li = uGain / dl2;
  vec3 radial = vec3(P.xy / max(r, 1e-4), 0.0);
  vec3 tang = vec3(-radial.y, radial.x, 0.0);
  vec3 up = vec3(0.0, 0.0, 1.0);
  float fres = 0.04 + 0.96 * pow(clamp(1.0 - max(dot(V, H), 0.0), 0.0, 1.0), 5.0);

  vec3 R = reflect(-V, up);
  float env = 0.018 + 0.03 * smoothstep(-0.2, 0.9, R.y);
  vec3 base = vec3(0.0042, 0.004, 0.0042) + env * 0.03;

  float grooved = smoothstep(R_LEADOUT, R_LEADOUT + 0.004 + rPix, r) * (1.0 - smoothstep(R_LEADIN - 0.004 - rPix, R_LEADIN, r));
  grooved *= 1.0 - gapMask(r, rPix);
  float smooth_ = 1.0 - grooved;

  float box = softbox(P, R);
  vec3 col = base + LIGHT_TINT * box * 1.7 * fres * smooth_;
  col += LIGHT_TINT * box * 0.35 * fres * grooved;

  float music = lobe(H, up, tang, vec2(0.02, 0.8));
  float halo = lobe(H, up, tang, vec2(0.11, 0.9));
  float ringTex = mix(1.0, ringWave, ringAA) * loud;
  float diffract = clamp(dot(H, tang) / max(H.z, 0.05) / 0.03, -2.0, 2.0);
  vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + diffract * 0.18));
  vec3 sheen = mix(LIGHT_TINT, LIGHT_TINT * rainbow * 1.15, 0.12 * smoothstep(0.4, 1.6, abs(diffract)));

  vec3 tiltDir = vec3(rot2(vec2(0.0, 1.0), theta + 0.785), 0.0);
  vec3 nImg = normalize(up + tiltDir * uKappa);
  float picture = lobe(H, nImg, tang, uLobe);
  float wide = lobe(H, nImg, tang, uLobe * 2.4);

  float img = tone * uPhotoOn;
  float conc = 0.6 * (1.0 - 0.6 * img);
  vec3 spec = sheen * (music * conc + halo * 0.006) * ringTex;
  spec += LIGHT_TINT * (picture * img * 1.15 + wide * img * 0.012) * mix(1.0, ringWave, ringAA * 0.6) * mix(1.0, loud, 0.35);
  col += spec * Li * grooved;

  float runout = smoothstep(R_LABEL + 0.006, R_LABEL + 0.012, r) * (1.0 - smoothstep(R_LEADOUT - 0.004, R_LEADOUT, r));
  float runoutGroove = 1.0 - smoothstep(0.0, 0.18, abs(fract(r * 140.0) - 0.5));
  col += sheen * music * 0.12 * runout * mix(0.5, runoutGroove, ringAA) * Li;

  float bead = smoothstep(R_BEAD, 0.996, r);
  vec3 nb = normalize(up + radial * bead * 1.6);
  vec3 Rb = reflect(-V, nb);
  col += LIGHT_TINT * softbox(P, Rb) * bead * 1.4;
  float hb = pow(max(dot(nb, H), 0.0), 220.0);
  col += LIGHT_TINT * hb * bead * Li * 0.4;
  return col;
}

vec3 shadeLabel(vec3 P, float theta) {
  vec2 p = rot2(P.xy, -theta);
  vec3 la = toLinear(labelAt(p, uSlot.x));
  vec3 lb = toLinear(labelAt(p, uSlot.y));
  vec3 alb = mix(la, lb, uMix);
  vec3 Lv = uLight - P;
  float dl2 = max(dot(Lv, Lv), 1e-3);
  float lam = max(Lv.z, 0.0) * inversesqrt(dl2);
  float irr = 0.7 + 0.35 * lam * (uGain / dl2) * 0.22;
  float fibre = noise2(p * 420.0) * 0.06 + noise2(p * 90.0) * 0.04;
  return alb * irr * (0.95 + fibre);
}

vec3 groundAt(vec3 G) {
  vec3 Lv = uLight - G;
  float dl2 = max(dot(Lv, Lv), 1e-3);
  float lam = max(Lv.z, 0.0) * inversesqrt(dl2);
  float pool = lam * (uGain / dl2) * 0.012;
  vec3 g = uGround * (0.93 + pool);
  vec2 lxy = uLight.xy;
  vec2 away = -lxy / max(length(uLight), 1.0);
  float d0 = length(G.xy);
  float d1 = length(G.xy - away * 0.06);
  float contact = 1.0 - smoothstep(0.995, 1.03, d0);
  float soft = 1.0 - smoothstep(0.96, 1.16, d1);
  float occl = 1.0 - 0.32 * contact - 0.12 * soft;
  float grain = (noise2(G.xy * 900.0) - 0.5) * 0.012 + (noise2(G.xy * 140.0) - 0.5) * 0.01;
  return g * occl * (1.0 + grain);
}

vec3 tonemap(vec3 c) {
  vec3 k = vec3(0.82);
  vec3 over = max(c - k, 0.0);
  return min(c, k) + (1.0 - k) * (1.0 - exp(-over / (1.0 - k)));
}

void main() {
  vec2 sc = gl_FragCoord.xy * (uBox / uRes);
  vec2 centerUp = vec2(uCenter.x, uBox.y - uCenter.y);
  vec2 s = (sc - centerUp) / max(uFocal, 1.0);
  vec3 f = vec3(0.0, sin(uTilt), -cos(uTilt));
  vec3 u = vec3(0.0, cos(uTilt), sin(uTilt));
  vec3 dir = normalize(f + vec3(s.x, 0.0, 0.0) + u * s.y);
  vec3 C = eyePos();

  float tTop = (uThick - C.z) / min(dir.z, -1e-4);
  vec3 P = C + dir * tTop;
  float r = length(P.xy);
  float rPix = max(length(fwidth(P.xy)), 1e-5);
  float tG = -C.z / min(dir.z, -1e-4);
  vec3 G = C + dir * tG;
  float rG = length(G.xy);
  float gPix = max(fwidth(rG), 1e-5);
  vec3 groundCol = groundAt(G);
  vec3 col = groundCol;

  float sideCover = clamp((1.0 - rG) / gPix + 0.5, 0.0, 1.0);
  if (sideCover > 0.0) {
    vec3 n = vec3(G.xy / max(rG, 1e-4), 0.0);
    vec3 S = vec3(n.xy, uThick * 0.5);
    vec3 V = normalize(C - S);
    vec3 Lv = uLight - S;
    vec3 H = normalize(normalize(Lv) + V);
    float sp = pow(max(dot(n, H), 0.0), 40.0) * (uGain / max(dot(Lv, Lv), 1e-3)) * 0.04;
    vec3 side = vec3(0.006) + LIGHT_TINT * sp;
    col = mix(col, side, sideCover);
  }

  float topCover = clamp((1.0 - r) / rPix + 0.5, 0.0, 1.0);
  if (topCover > 0.0) {
    vec3 V = normalize(C - P);
    float ringScale = 300.0;
    float ringAA = clamp(1.6 - rPix * ringScale * 1.8, 0.0, 1.0);
    float idx = floor(r * ringScale);
    float fr = fract(r * ringScale);
    float wall = 1.0 - smoothstep(0.0, 0.42, abs(fr - 0.5));
    float amp = 0.55 + 0.9 * hash11(idx + 17.0);
    float loud = 0.6 + 0.8 * noise2(vec2(r * 70.0, 3.1)) * (0.7 + 0.6 * noise2(vec2(r * 11.0, 7.7)));
    loud = mix(1.0, loud, clamp(1.6 - rPix * 70.0 * 1.6, 0.0, 1.0));
    float ringWave = mix(0.35, 1.45, wall) * mix(1.0, amp, 0.5);
    float labelEdge = smoothstep(R_LABEL - rPix, R_LABEL + rPix, r);
    vec3 acc = vec3(0.0);
    int n = max(uSamples, 1);
    for (int i = 0; i < 6; i += 1) {
      if (i >= n) break;
      float k = n > 1 ? float(i) / float(n - 1) - 0.5 : 0.0;
      float th = uTheta - uSweep * k;
      vec2 p = rot2(P.xy, -th);
      float ya = dot(toLinear(photoAt(p, uSlot.x)), vec3(0.2126, 0.7152, 0.0722));
      float yb = dot(toLinear(photoAt(p, uSlot.y)), vec3(0.2126, 0.7152, 0.0722));
      float ta = pow(clamp((ya - uToneA.x) / (abs(uToneA.y - uToneA.x) < 0.01 ? 0.01 : uToneA.y - uToneA.x), 0.0, 1.0), uToneA.z);
      float tb = pow(clamp((yb - uToneB.x) / (abs(uToneB.y - uToneB.x) < 0.01 ? 0.01 : uToneB.y - uToneB.x), 0.0, 1.0), uToneB.z);
      float tone = mix(ta, tb, uMix);
      vec3 c = vec3(0.0);
      if (labelEdge < 1.0) c += shadeLabel(P, th) * (1.0 - labelEdge);
      if (labelEdge > 0.0) c += shadeVinyl(P, V, th, ringAA, tone, ringWave, loud, rPix) * labelEdge;
      acc += c;
    }
    vec3 top = acc / float(n);
    float holeCover = clamp((r - R_HOLE) / rPix + 0.5, 0.0, 1.0);
    top = mix(groundCol * 0.3, top, holeCover);
    col = mix(col, top, topCover);
  }
  col = tonemap(col);
  col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));
  col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}
`;
