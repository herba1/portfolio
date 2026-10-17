const COMMON = `
uniform vec3 uLight;
uniform vec3 uCam;

vec3 toneMap(vec3 x) {
  x = max(x, vec3(0.0));
  vec3 a = x * (2.51 * x + 0.03);
  vec3 b = x * (2.43 * x + 0.59) + 0.14;
  return clamp(a / max(b, vec3(1e-4)), 0.0, 1.0);
}

vec3 toScreen(vec3 linear, vec2 frag) {
  vec3 mapped = pow(toneMap(linear), vec3(1.0 / 2.2));
  float n = fract(sin(dot(frag, vec2(12.9898, 78.233))) * 43758.5453);
  return mapped + (n - 0.5) / 255.0;
}

vec3 studio(vec3 r, float rough) {
  float up = smoothstep(-0.35, 0.85, r.y);
  vec3 c = mix(vec3(0.012, 0.012, 0.014), vec3(0.09, 0.09, 0.095), up);
  float wall = smoothstep(-0.2, 0.6, -r.z) * 0.1;
  c += vec3(0.5, 0.49, 0.47) * wall * (0.6 + 0.4 * up);
  vec3 fill = normalize(vec3(-0.75, 0.25, 0.6));
  c += vec3(0.16, 0.17, 0.19) * pow(max(dot(r, fill), 0.0), mix(24.0, 4.0, rough));
  return c;
}

vec3 keyLobe(vec3 r, float rough) {
  float k = max(dot(r, uLight), 0.0);
  float tight = mix(70.0, 5.0, clamp(rough * 1.6, 0.0, 1.0));
  return vec3(2.4, 2.3, 2.1) * pow(k, tight) * mix(1.0, 0.4, rough);
}

float ggx(vec3 n, vec3 v, vec3 l, float rough) {
  vec3 h = normalize(v + l);
  float a = max(rough * rough, 0.002);
  float a2 = a * a;
  float nh = max(dot(n, h), 0.0);
  float nl = max(dot(n, l), 0.0);
  float nv = max(dot(n, v), 1e-3);
  float d = nh * nh * (a2 - 1.0) + 1.0;
  float dist = a2 / max(3.14159 * d * d, 1e-5);
  float k = a * 0.5;
  float vis = 1.0 / max((nl * (1.0 - k) + k) * (nv * (1.0 - k) + k), 1e-4);
  return min(dist * vis * 0.25 * nl, 60.0);
}
`;

const SHADOW = `
uniform highp sampler2DShadow uShadow;
uniform mat4 uLightVP;
uniform vec2 uShadowTexel;

float shadowAt(vec3 world) {
  vec4 p = uLightVP * vec4(world, 1.0);
  vec3 s = p.xyz / max(p.w, 1e-4) * 0.5 + 0.5;
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) return 1.0;
  float z = s.z - 0.0006;
  float sum = texture(uShadow, vec3(s.xy, z)) * 2.0;
  sum += texture(uShadow, vec3(s.xy + vec2(1.2, 0.4) * uShadowTexel, z));
  sum += texture(uShadow, vec3(s.xy + vec2(-0.4, 1.2) * uShadowTexel, z));
  sum += texture(uShadow, vec3(s.xy + vec2(-1.2, -0.4) * uShadowTexel, z));
  sum += texture(uShadow, vec3(s.xy + vec2(0.4, -1.2) * uShadowTexel, z));
  return sum / 6.0;
}
`;

const GRID = `
uniform sampler2D uHeights;
uniform vec4 uGrid;
uniform vec4 uBed;

vec2 pinCenter(int c, int r) {
  return vec2((float(c) + 0.25 + 0.5 * float(r & 1)) * uGrid.z, (float(r) + 0.5) * uGrid.z * 0.8660254) - uBed.xy;
}
`;

export const BG_VERTEX = `#version 300 es
layout(location = 0) in vec2 aPosition;
out vec2 vNdc;
void main() {
  vNdc = aPosition;
  gl_Position = vec4(aPosition, 0.9999, 1.0);
}
`;

export const BG_FRAGMENT = `#version 300 es
precision highp float;
${COMMON}
uniform mat4 uInvViewProj;
uniform mat4 uModelInv;
uniform vec4 uOuter;
uniform float uWall;
in vec2 vNdc;
out vec4 outColor;

float boxSdf(vec2 p, vec2 half_) {
  vec2 d = abs(p) - half_;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

void main() {
  vec4 a = uInvViewProj * vec4(vNdc, -1.0, 1.0);
  vec4 b = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 ro = a.xyz / a.w;
  vec3 rd = normalize(b.xyz / b.w - ro);
  float t = (uWall - ro.z) / (abs(rd.z) > 1e-5 ? rd.z : -1e-5);
  vec3 p = ro + rd * max(t, 0.0);
  vec3 pm = (uModelInv * vec4(p, 1.0)).xyz;
  vec3 lm = normalize(mat3(uModelInv) * uLight);
  float shade = 1.0;
  float reach = (uOuter.w - pm.z) / max(lm.z, 0.05);
  vec2 hit = pm.xy + lm.xy * reach;
  float soft = 0.02 + 0.14 * max(reach, 0.0);
  float body = boxSdf(hit, uOuter.xy - uOuter.z);
  float rim = boxSdf(hit, uOuter.xy);
  shade -= 0.24 * (1.0 - smoothstep(-soft, soft, body));
  shade -= 0.1 * (1.0 - smoothstep(-soft, soft, rim));
  float near = (uOuter.w + 0.1 - pm.z) / max(lm.z, 0.05);
  vec2 hitNear = pm.xy + lm.xy * near;
  float contact = boxSdf(hitNear, uOuter.xy);
  shade -= 0.08 * (1.0 - smoothstep(-0.18, 0.3, contact));
  vec2 q = p.xy;
  float key = 0.92 + 0.11 * smoothstep(1.6, -1.2, q.x * 0.8 - q.y * 0.6);
  float fall = 1.0 - 0.1 * smoothstep(0.6, 2.2, length(q * vec2(0.7, 0.9)));
  vec3 wall = vec3(0.857, 0.85, 0.83) * key * fall;
  float lit = clamp(shade, 0.0, 1.0);
  wall *= mix(vec3(0.46, 0.48, 0.52), vec3(1.0), lit);
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  outColor = vec4(wall + (n - 0.5) / 255.0, 1.0);
}
`;

export const PIN_VERTEX = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in float aRide;
${GRID}
uniform mat4 uModel;
uniform mat4 uViewProj;
uniform vec2 uPin;
out vec3 vWorld;
out vec3 vNormal;
out float vZ;
out float vNbr;
out float vCap;
out float vSeed;

void main() {
  int cols = int(uGrid.x);
  int c = gl_InstanceID % cols;
  int r = gl_InstanceID / cols;
  vec2 hv = texelFetch(uHeights, ivec2(c, r), 0).rg;
  float top = hv.r * uGrid.w;
  vec2 base = pinCenter(c, r);
  float z = aRide > 0.5 ? top + aPosition.z * uPin.x : -uPin.y;
  vec3 local = vec3(base + aPosition.xy * uPin.x, z);
  vec4 world = uModel * vec4(local, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  vZ = z;
  vNbr = hv.g * uGrid.w;
  vCap = aPosition.z > 0.001 ? 1.0 : 0.0;
  vSeed = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);
  gl_Position = uViewProj * world;
}
`;

export const PIN_FRAGMENT = `#version 300 es
precision highp float;
${COMMON}
${SHADOW}
uniform vec4 uGrid;
in vec3 vWorld;
in vec3 vNormal;
in float vZ;
in float vNbr;
in float vCap;
in float vSeed;
out vec4 outColor;

void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uCam - vWorld);
  if (dot(n, v) < 0.0) n = normalize(n - v * dot(n, v) * 1.02);
  vec3 l = uLight;
  float depth = max(vNbr - vZ, 0.0);
  float ao = 1.0 - 0.72 * smoothstep(0.0, uGrid.w * 0.55, depth);
  ao *= mix(0.55, 1.0, smoothstep(-uGrid.w * 0.02, uGrid.w * 0.1, vZ));
  float baseRough = mix(0.42, 0.2, vCap) + (vSeed - 0.5) * 0.06;
  vec3 dn = fwidth(n);
  float rough = sqrt(baseRough * baseRough + min(dot(dn, dn) * 0.6, 0.25));
  vec3 f0 = mix(vec3(0.6, 0.61, 0.63), vec3(0.66, 0.65, 0.63), vSeed);
  float nv = max(dot(n, v), 0.0);
  vec3 fres = f0 + (1.0 - f0) * pow(1.0 - nv, 5.0);
  float sh = shadowAt(vWorld + n * 0.0012);
  float nl = max(dot(n, l), 0.0);
  vec3 spec = vec3(5.0, 4.85, 4.5) * ggx(n, v, l, rough) * fres * sh;
  vec3 r = reflect(-v, n);
  vec3 env = (studio(r, rough) * ao + keyLobe(r, rough) * sh) * fres;
  vec3 sheen = f0 * (mix(1.1, 0.16, vCap) * pow(nl, 1.4) * sh + 0.006 * ao);
  vec3 color = (spec + env + sheen) * 1.25;
  outColor = vec4(toScreen(color, gl_FragCoord.xy), 1.0);
}
`;

export const DEPTH_FRAGMENT = `#version 300 es
precision mediump float;
void main() {
}
`;

export const PLATE_VERTEX = `#version 300 es
layout(location = 0) in vec3 aPosition;
uniform mat4 uModel;
uniform mat4 uViewProj;
out vec3 vWorld;
out vec2 vLocal;
void main() {
  vLocal = aPosition.xy;
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  gl_Position = uViewProj * world;
}
`;

export const PLATE_FRAGMENT = `#version 300 es
precision highp float;
${COMMON}
${SHADOW}
${GRID}
uniform mat4 uModel;
uniform vec2 uPin;
in vec3 vWorld;
in vec2 vLocal;
out vec4 outColor;

void main() {
  vec2 p = vLocal + uBed.xy;
  float rowF = p.y / (uGrid.z * 0.8660254) - 0.5;
  int r0 = int(floor(rowF));
  float best = 1e9;
  float bestH = 0.0;
  for (int dr = 0; dr <= 1; dr += 1) {
    int r = clamp(r0 + dr, 0, int(uGrid.y) - 1);
    float shift = 0.25 + 0.5 * float(r & 1);
    float cf = p.x / uGrid.z - shift;
    for (int dc = 0; dc <= 1; dc += 1) {
      int c = clamp(int(floor(cf)) + dc, 0, int(uGrid.x) - 1);
      vec2 center = pinCenter(c, r) + uBed.xy;
      float d = length(p - center);
      if (d < best) {
        best = d;
        bestH = texelFetch(uHeights, ivec2(c, r), 0).g;
      }
    }
  }
  vec3 n = normalize(mat3(uModel) * vec3(0.0, 0.0, 1.0));
  vec3 v = normalize(uCam - vWorld);
  vec3 l = uLight;
  float hole = smoothstep(uPin.x * 1.2, uPin.x * 1.5, best);
  float lip = smoothstep(uPin.x * 1.35, uPin.x * 1.55, best) * (1.0 - smoothstep(uPin.x * 1.55, uPin.x * 1.9, best));
  float occl = smoothstep(0.0, 0.7, bestH);
  float ao = 1.0 - 0.75 * occl;
  float sh = shadowAt(vWorld + n * 0.0015);
  float nl = max(dot(n, l), 0.0);
  vec3 albedo = vec3(0.03, 0.031, 0.034);
  vec3 diffuse = albedo * (nl * 2.4 * sh + 0.05) * ao;
  float nv = max(dot(n, v), 0.0);
  float fres = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
  vec3 refl = (studio(reflect(-v, n), 0.22) + keyLobe(reflect(-v, n), 0.22) * sh) * fres * 0.6 * mix(0.6, 1.0, ao);
  vec3 keySpec = vec3(4.0) * ggx(n, v, l, 0.22) * fres * sh;
  vec3 color = (diffuse + refl + keySpec) * hole + vec3(0.004) * (1.0 - hole);
  color += vec3(0.05, 0.05, 0.052) * lip * (nl * sh * 2.0 + 0.2) * ao;
  outColor = vec4(toScreen(color, gl_FragCoord.xy), 1.0);
}
`;

export const SOLID_VERTEX = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aEdge;
uniform mat4 uModel;
uniform mat4 uViewProj;
out vec3 vWorld;
out vec3 vNormal;
out vec4 vEdge;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  vEdge = aEdge;
  gl_Position = uViewProj * world;
}
`;

export const HOUSING_FRAGMENT = `#version 300 es
precision highp float;
${COMMON}
in vec3 vWorld;
in vec3 vNormal;
in vec4 vEdge;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uCam - vWorld);
  float nl = max(dot(n, uLight), 0.0);
  vec3 color = vec3(0.045, 0.045, 0.048) * (0.5 + nl * 2.0);
  color += studio(reflect(-v, n), 0.5) * 0.05;
  outColor = vec4(toScreen(color, gl_FragCoord.xy), 1.0);
}
`;

export const ACRYLIC_FRAGMENT = `#version 300 es
precision highp float;
${COMMON}
in vec3 vWorld;
in vec3 vNormal;
in vec4 vEdge;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uCam - vWorld);
  vec2 uv = vEdge.xy;
  vec2 size = vEdge.zw;
  vec2 dist = min(uv, 1.0 - uv) * size;
  float edge = min(dist.x, dist.y);
  float nv = clamp(dot(n, v), 0.0, 1.0);
  float fres = 0.045 + 0.955 * pow(1.0 - nv, 5.0);
  vec3 r = reflect(-v, n);
  vec3 refl = (studio(r, 0.06) + keyLobe(r, 0.06)) * fres * 0.45;
  vec3 h = normalize(v + uLight);
  float glint = pow(max(dot(n, h), 0.0), 400.0) * 3.0;
  float rimLine = exp(-edge / 0.0011);
  float rimSoft = exp(-edge / 0.008);
  float lit = 0.4 + 0.6 * max(dot(n, uLight), 0.0);
  vec3 rim = vec3(1.0, 0.99, 0.97) * (rimLine * 0.22 + rimSoft * 0.015) * lit;
  vec3 add = refl + rim + vec3(glint);
  float alpha = 0.03 + 0.08 * fres + rimLine * 0.1;
  vec3 glow = pow(toneMap(add), vec3(1.0 / 2.2));
  outColor = vec4(glow + vec3(0.5, 0.54, 0.53) * alpha * 0.3, alpha);
}
`;
