const SHADOW = `
uniform highp sampler2DShadow uShadow;
uniform mat4 uLightVP;
uniform vec2 uShadowTexel;
const vec2 POISSON[8] = vec2[8](
  vec2(-0.613, 0.617), vec2(0.17, -0.04), vec2(-0.299, -0.792), vec2(0.645, 0.493),
  vec2(-0.651, -0.177), vec2(0.421, -0.647), vec2(-0.021, 0.972), vec2(0.968, -0.135)
);
float shadowAt(vec3 wp, vec3 n, float radius, float bias, int taps) {
  vec4 lp = uLightVP * vec4(wp + n * 0.003, 1.0);
  vec3 c = lp.xyz / max(abs(lp.w), 1e-4) * 0.5 + 0.5;
  if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return 1.0;
  float s = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= taps) break;
    s += texture(uShadow, vec3(c.xy + POISSON[i] * radius * uShadowTexel, c.z - bias));
  }
  return s / float(taps);
}
`;

export const DEPTH_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uLightVP;
uniform vec3 uOffset;
void main() {
  gl_Position = uLightVP * vec4(aPos + uOffset, 1.0);
}
`;

export const DEPTH_FS = `#version 300 es
precision mediump float;
out vec4 o;
void main() {
  o = vec4(1.0);
}
`;

export const BG_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vNdc;
void main() {
  vNdc = aPos;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const BG_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform mat4 uInvVP;
uniform vec3 uEye;
uniform float uFloor;
uniform vec3 uWall;
uniform vec3 uGround;
uniform sampler2D uFibre;
${SHADOW}
out vec4 o;
void main() {
  vec4 a = uInvVP * vec4(vNdc, -1.0, 1.0);
  vec4 b = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 pa = a.xyz / max(abs(a.w), 1e-5) * sign(a.w);
  vec3 pb = b.xyz / max(abs(b.w), 1e-5) * sign(b.w);
  vec3 dir = normalize(pb - pa + vec3(0.0, 0.0, 1e-6));
  vec3 col = uWall;
  if (dir.y < -1e-3) {
    float th = (uFloor - uEye.y) / dir.y;
    vec3 p = uEye + dir * th;
    float r = length(p.xz * vec2(0.8, 1.0));
    float far = smoothstep(2.4, 11.0, th);
    vec3 g = mix(uGround, uWall, far);
    float pool = exp(-r * r * 0.22);
    g *= 0.975 + 0.04 * pool;
    float sh = shadowAt(p, vec3(0.0, 1.0, 0.0), 3.4, 0.002, 4);
    float foot = 0.0;
    for (int s = 0; s < 2; s++) {
      vec2 fp = vec2(s == 0 ? -0.9 : 0.9, 0.0);
      vec2 d = (p.xz - fp) / vec2(0.2, 0.26);
      foot += exp(-dot(d, d) * 1.6);
    }
    vec2 dm = p.xz / vec2(1.25, 0.5);
    float under = exp(-dot(dm, dm) * 1.2) * 0.07;
    float shade = mix(0.76, 1.0, sh) * (1.0 - 0.16 * foot) * (1.0 - under);
    g *= mix(1.0, shade, 1.0 - far);
    float grain = texture(uFibre, p.xz * 1.7).b - 0.5;
    g += grain * 0.006 * (1.0 - far);
    col = g;
  }
  o = vec4(col, 1.0);
}
`;

export const SOLID_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNrm;
layout(location = 2) in float aPart;
uniform mat4 uVP;
uniform vec3 uOffset;
out vec3 vPos;
out vec3 vNrm;
out float vPart;
void main() {
  vPos = aPos + uOffset;
  vNrm = aNrm;
  vPart = aPart;
  gl_Position = uVP * vec4(vPos, 1.0);
}
`;

export const SOLID_FS = `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vNrm;
in float vPart;
uniform vec3 uEye;
uniform vec3 uLight;
uniform vec3 uOffset;
uniform vec3 uMetal;
uniform vec3 uAccent;
uniform float uLed;
uniform float uPress;
uniform float uSlotZ;
uniform float uSlotX;
uniform vec2 uButton;
uniform float uPitch;
uniform sampler2D uFibre;
uniform sampler2D uLabel;
${SHADOW}
out vec4 o;
void main() {
  vec3 N = normalize(vNrm);
  vec3 V = normalize(uEye - vPos);
  vec3 L = uLight;
  vec3 lp = vPos - uOffset;
  float part = floor(vPart + 0.5);
  vec3 base = uMetal;
  if (part > 0.5 && part < 1.5) base *= 0.9;
  if (part > 1.5) base *= 0.96;
  float grain = texture(uFibre, lp.xy * 3.1 + lp.zz * 2.3).b;
  float grain2 = texture(uFibre, lp.xz * 5.7 + 0.31).b;
  base *= 0.985 + 0.03 * (grain * 0.6 + grain2 * 0.4);
  float sh = shadowAt(vPos, N, 1.8, 0.0015, 6);
  float ndl = dot(N, L);
  float diff = clamp((ndl + 0.3) / 1.3, 0.0, 1.0);
  float sky = 0.5 + 0.5 * N.y;
  vec3 col = base * (0.5 + 0.18 * sky + 0.42 * diff * mix(0.55, 1.0, sh));
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 22.0) * 0.16 * sh;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  col += vec3(spec) + fres * 0.08 * vec3(0.95, 0.96, 1.0);
  if (part < 0.5) {
    if (abs(N.y) < 0.6) {
      col *= mix(0.9, 1.03, smoothstep(-0.16, -0.01, lp.y));
      float gy = lp.y + 0.046;
      col *= 1.0 - 0.28 * smoothstep(0.0016, 0.0004, abs(gy));
      col += 0.035 * smoothstep(0.0022, 0.0008, abs(gy + 0.0024));
    }
    if (N.y > 0.85) {
      float dz = lp.z - uSlotZ;
      float inX = smoothstep(uSlotX + 0.004, uSlotX - 0.004, abs(lp.x));
      float w = 0.016;
      float hole = smoothstep(w + 0.0015, w - 0.0015, abs(dz)) * inX;
      float depth = clamp((dz + w) / (2.0 * w), 0.0, 1.0);
      vec3 dark = mix(vec3(0.018, 0.018, 0.02), vec3(0.075, 0.074, 0.072), depth * depth);
      float tooth = smoothstep(0.32, 0.0, abs(fract(lp.x / uPitch) - 0.5)) * smoothstep(0.009, 0.0, abs(dz + 0.004));
      dark += tooth * vec3(0.07, 0.07, 0.068);
      float lip = smoothstep(0.0028, 0.0, abs(dz + w + 0.0016)) * inX;
      float rear = smoothstep(0.0024, 0.0, abs(dz - w - 0.0014)) * inX;
      col = mix(col, dark, hole);
      col += lip * 0.05 - rear * 0.04;
      float gutter = smoothstep(0.03, 0.0, abs(dz)) * inX * (1.0 - hole);
      col *= 1.0 - gutter * 0.06;
    }
    if (N.z > 0.85) {
      vec2 uv = vec2((lp.x + 0.98) / 1.96, (-lp.y) / 0.16);
      float lab = texture(uLabel, uv).a;
      float labUp = texture(uLabel, uv + vec2(0.0, -0.012)).a;
      col *= 1.0 - lab * 0.34;
      col += (labUp - lab) * 0.07;
      vec2 bp = lp.xy - uButton;
      float r = length(bp);
      float rim = smoothstep(0.0365, 0.0345, r) * smoothstep(0.0295, 0.0315, r);
      float cap = smoothstep(0.031, 0.0295, r);
      vec2 g = bp / 0.03;
      float dome = clamp(1.0 - dot(g, g), 0.0, 1.0);
      vec3 capCol = base * (0.86 + 0.12 * dome + 0.08 * clamp(-g.y + g.x * 0.3, -1.0, 1.0)) * (1.0 - 0.1 * uPress);
      col = mix(col, capCol * (0.5 + 0.42 * diff + 0.18 * sky), cap);
      col *= 1.0 - rim * (0.55 + 0.2 * uPress);
      vec2 lpd = lp.xy - (uButton + vec2(-0.075, 0.0));
      float led = smoothstep(0.0062, 0.0045, length(lpd));
      float halo = exp(-dot(lpd, lpd) / 0.00022) * uLed;
      vec3 ledCol = mix(vec3(0.16, 0.16, 0.17), uAccent * 1.25 + 0.12, uLed);
      col = mix(col, ledCol, led);
      col += uAccent * halo * 0.22;
    }
  }
  o = vec4(col, 1.0);
}
`;

export const PAPER_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNrm;
layout(location = 2) in vec4 aUv;
uniform mat4 uVP;
out vec3 vPos;
out vec3 vNrm;
out vec4 vUv;
void main() {
  vPos = aPos;
  vNrm = aNrm;
  vUv = aUv;
  gl_Position = uVP * vec4(aPos, 1.0);
}
`;

export const PAPER_FS = `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vNrm;
in vec4 vUv;
uniform vec3 uEye;
uniform vec3 uLight;
uniform sampler2D uPhotoA;
uniform sampler2D uPhotoB;
uniform sampler2D uFuse;
uniform sampler2D uFibre;
uniform sampler2D uBack;
uniform float uN;
uniform float uK;
uniform float uExitY;
${SHADOW}
out vec4 o;
float fuseAt(float col, float t) {
  if (col < 0.0 || col > uN - 0.5) return 0.0;
  float x = clamp(t, 0.0, 1.0) * (uK - 1.0);
  float k0 = floor(x);
  float f = x - k0;
  int c = int(col + 0.5);
  float a = texelFetch(uFuse, ivec2(int(k0), c), 0).r;
  float b = texelFetch(uFuse, ivec2(int(min(k0 + 1.0, uK - 1.0)), c), 0).r;
  return mix(a, b, f);
}
void main() {
  float ug = vUv.x;
  float t = vUv.y;
  float ul = vUv.z;
  bool cut = ul >= -0.5;
  float col = cut ? vUv.w : clamp(floor(ug * uN), 0.0, uN - 1.0);
  vec3 V = normalize(uEye - vPos);
  vec3 n = normalize(vNrm);
  bool front = dot(n, V) >= 0.0;
  vec3 N = front ? n : -n;
  vec2 uv = vec2(clamp(ug, 0.001, 0.999), 1.0 - clamp(t, 0.0, 1.0));
  float fz = smoothstep(0.0, 1.0, fuseAt(col, t));
  vec3 photo = mix(texture(uPhotoA, uv).rgb, texture(uPhotoB, uv).rgb, fz);
  vec4 fib = texture(uFibre, vec2(ug * 3.0, t * 2.0));
  float alpha = 1.0;
  float core = 0.0;
  float seam = 0.0;
  float fw = max(fwidth(ul), 1e-5);
  float fu = max(fwidth(ug), 1e-5);
  float ft = max(fwidth(t), 1e-5);
  if (cut) {
    bool left = ul < 0.5;
    float nb = left ? col - 1.0 : col + 1.0;
    float outer = (nb < 0.0 || nb > uN - 1.0) ? 1.0 : 0.0;
    seam = (1.0 - outer) * fz * smoothstep(0.0, 1.0, fuseAt(nb, t));
    float dpx = (left ? ul : 1.0 - ul) / fw;
    float rag = texture(uFibre, vec2(t * 7.0, col * 0.137 + (left ? 0.0 : 0.53))).g - 0.5;
    float rag2 = texture(uFibre, vec2(t * 23.0, col * 0.071 + (left ? 0.21 : 0.77))).b - 0.5;
    float cutEdge = (1.0 - outer) * (1.0 - seam);
    alpha = clamp(dpx + 0.5 + (rag * 0.9 + rag2 * 0.5) * cutEdge, 0.0, 1.0);
    alpha = mix(alpha, 1.0, seam);
    core = (1.0 - smoothstep(0.6, 1.9 + rag * 1.2 + rag2 * 0.8, dpx)) * cutEdge;
  } else {
    float d = min(min(ug, 1.0 - ug) / fu, (1.0 - t) / ft);
    alpha = clamp(d + 0.5, 0.0, 1.0);
  }
  if (alpha < 0.01) discard;
  float sh = shadowAt(vPos, N, 1.5, 0.0012, 8);
  float ndl = dot(N, uLight);
  float diff = clamp((ndl + 0.45) / 1.45, 0.0, 1.0);
  float sky = 0.5 + 0.5 * N.y;
  vec3 H = normalize(uLight + V);
  float nv = max(dot(N, V), 0.0);
  float fres = pow(1.0 - nv, 5.0);
  float ao = cut ? mix(0.7, 1.0, smoothstep(0.0, 0.09, uExitY - vPos.y)) : mix(0.78, 1.0, smoothstep(0.0, 0.05, vPos.y));
  sh *= mix(0.6, 1.0, ao);
  vec3 c;
  if (front) {
    float lit = (0.66 + 0.1 * sky) * mix(0.82, 1.0, ao) + 0.38 * diff * mix(0.42, 1.0, sh);
    c = photo * lit;
    float peel = 0.85 + 0.3 * fib.b;
    float spec = pow(max(dot(N, H), 0.0), 80.0) * 0.38 * sh * peel;
    float sheen = pow(max(dot(N, H), 0.0), 24.0) * 0.09 * sh;
    vec3 R = reflect(-V, N);
    float box = smoothstep(0.15, 0.8, R.y) * (0.55 + 0.45 * smoothstep(0.5, -0.5, R.x));
    float fr = 0.04 + 0.96 * fres;
    c += vec3(spec + sheen) + fr * box * 0.9 * mix(0.5, 1.0, sh) * vec3(0.96, 0.97, 1.0);
    float glint = cut ? fz * (1.0 - fz) * 4.0 : 0.0;
    c += glint * 0.14 * vec3(1.0, 0.98, 0.94);
    vec3 paperCore = vec3(0.95, 0.945, 0.93) * (0.62 + 0.4 * diff);
    c = mix(c, paperCore, core * 0.62);
  } else {
    vec3 paper = vec3(0.985, 0.98, 0.965) * (0.97 + 0.05 * (fib.r - 0.5) + 0.03 * (fib.g - 0.5));
    float ink = texture(uBack, vec2((1.0 - ug) * 4.0, t * 2.4)).a;
    paper *= 1.0 - ink * 0.07;
    vec3 show = mix(paper, paper * (0.82 + 0.18 * photo), 0.35);
    float lit = (0.58 + 0.12 * sky) * mix(0.82, 1.0, ao) + 0.42 * diff * mix(0.45, 1.0, sh);
    c = show * lit;
    c += vec3(pow(max(dot(N, H), 0.0), 10.0) * 0.03 * sh);
    c = mix(c, paper * (0.6 + 0.4 * diff), core * 0.4);
  }
  o = vec4(c, alpha);
}
`;
