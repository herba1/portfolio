export const SHEET_VERTEX = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aGrid;
layout(location = 1) in vec2 aOut;
layout(location = 2) in vec4 iA;
layout(location = 3) in vec4 iB;
layout(location = 4) in vec4 iC;

uniform mat4 uVP;
uniform mat3 uMap;
uniform vec3 uMapOff;
uniform vec4 uCorner;
uniform float uCurlK;
uniform float uFlightD0;
uniform float uHalfT;

out vec3 vWorld;
out vec3 vNormal;
out vec2 vGrid;
out vec2 vLocal;
out float vSide;
flat out vec4 vInfo;
flat out float vWall;

vec3 bendSheet(vec2 st) {
  vec3 p = vec3(st, 0.0);
  float c = iA.z;
  if (c > 0.0005) {
    vec2 n = uCorner.xy;
    float reach = uCorner.w * c;
    float d0 = uCorner.z - reach;
    float d = dot(st, n) - d0;
    if (d > 0.0) {
      float kc = uCurlK;
      float amax = 1.75 * min(c, 1.0);
      float dw = min(d, amax / kc);
      float a = kc * dw;
      float along = sin(a) / kc + (d - dw) * cos(a);
      float up = (1.0 - cos(a)) / kc + (d - dw) * sin(a);
      p.xy = st + n * (along - d);
      p.z = up;
    }
  }
  float k = iA.w;
  float df = p.x - uFlightD0;
  if (df > 0.0 && abs(k) > 0.0001) {
    float dw = min(df, 1.25 / abs(k));
    float a = k * dw;
    float sa = sin(a);
    float ca = cos(a);
    float along = sa / k + (df - dw) * ca;
    float up = (1.0 - ca) / k + (df - dw) * sa;
    float nx = along - p.z * sa;
    float nz = up + p.z * ca;
    p.x = uFlightD0 + nx;
    p.z = nz;
  }
  float th = iA.x;
  float s = p.x * cos(th) - p.z * sin(th);
  float z = p.x * sin(th) + p.z * cos(th);
  return vec3(s, p.y, iA.y + z);
}

vec2 sheetPoint(vec2 grid) {
  vec2 st = vec2(grid.x * iB.x, grid.y * iB.y + iB.z);
  float r = iB.w;
  vec2 c = vec2(0.0, uHalfT);
  vec2 q = st - c;
  float cr = cos(r);
  float sr = sin(r);
  return c + vec2(q.x * cr - q.y * sr, q.x * sr + q.y * cr) * vec2(1.0, 1.0);
}

void main() {
  vec2 st = sheetPoint(aGrid.xy);
  float e = 0.004;
  vec3 p0 = bendSheet(st);
  vec3 ps = bendSheet(st + vec2(e, 0.0));
  vec3 pt = bendSheet(st + vec2(0.0, e));
  vec3 n = normalize(cross(ps - p0, pt - p0));
  float wall = step(0.5, abs(aOut.x) + abs(aOut.y));
  if (wall > 0.5) {
    vec3 po = bendSheet(st + aOut * e);
    vec3 o = po - p0;
    n = normalize(o - n * dot(o, n));
  }
  vec3 local = p0 - vec3(0.0, 0.0, iC.w * aGrid.z);
  vec3 world = uMap * local + uMapOff;
  vec3 wn = normalize(uMap * n);
  vWorld = world;
  vNormal = wn;
  vGrid = aGrid.xy;
  vLocal = st;
  vSide = aGrid.z;
  vInfo = iC;
  vWall = wall;
  gl_Position = uVP * vec4(world, 1.0);
}
`;

export const SHEET_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec3 vWorld;
in vec3 vNormal;
in vec2 vGrid;
in vec2 vLocal;
in float vSide;
flat in vec4 vInfo;
flat in float vWall;

uniform sampler2DArray uFrames;
uniform sampler2D uShadow;
uniform mat4 uLightVP;
uniform vec3 uLight;
uniform vec3 uCam;
uniform float uSwap;
uniform float uShadowTexel;
uniform float uPenScale;
uniform float uBias;
uniform float uCoverLayer;
uniform float uFlipDet;
uniform int uDrawn;

out vec4 outColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

const vec2 DISK[12] = vec2[12](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598)
);

vec2 depthSlope(vec3 sc) {
  vec3 dx = dFdx(sc);
  vec3 dy = dFdy(sc);
  float det = dx.x * dy.y - dy.x * dx.y;
  if (abs(det) < 1e-12) return vec2(0.0);
  vec2 g = vec2(dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z) / det;
  return clamp(g, vec2(-40.0), vec2(40.0));
}

float shadowAt(vec3 world, vec3 n) {
  vec4 lp = uLightVP * vec4(world + n * 0.009, 1.0);
  vec3 sc = lp.xyz / max(lp.w, 0.0001) * 0.5 + 0.5;
  vec2 slope = depthSlope(sc);
  if (sc.x <= 0.0 || sc.x >= 1.0 || sc.y <= 0.0 || sc.y >= 1.0 || sc.z >= 1.0) return 1.0;
  float recv = sc.z - uBias;
  float ang = hash12(gl_FragCoord.xy) * 6.2831853;
  mat2 rot = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
  float blockSum = 0.0;
  float blockCount = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 o = rot * DISK[i] * uShadowTexel * 12.0;
    float d = texture(uShadow, sc.xy + o).r;
    float r = recv + dot(slope, o) - uBias * 2.0;
    if (d < r) {
      blockSum += r - d;
      blockCount += 1.0;
    }
  }
  if (blockCount < 0.5) return 1.0;
  float gap = blockSum / blockCount;
  float pen = clamp(gap * uPenScale, 1.0, 24.0);
  float lit = 0.0;
  for (int i = 0; i < 12; i++) {
    vec2 o = rot * DISK[i] * uShadowTexel * pen;
    float d = texture(uShadow, sc.xy + o).r;
    lit += step(recv + dot(slope, o), d);
  }
  return lit / 12.0;
}

vec3 frameUV(vec2 g) {
  return uSwap > 0.5 ? vec3(g.y, g.x, 0.0) : vec3(g.x, g.y, 0.0);
}

void main() {
  float layer = vInfo.x;
  float kind = vInfo.y;
  float seed = vInfo.z;
  vec3 n = normalize(vNormal) * uFlipDet;
  vec3 toCam = normalize(uCam - vWorld);
  bool front = dot(n, toCam) >= 0.0;
  if (vWall > 0.5) {
    front = true;
    n = normalize(vNormal);
    if (dot(n, toCam) < 0.0) n = -n;
  } else if (!front) {
    n = -n;
  }
  vec3 albedo;
  float grainScale = 900.0;
  float grain = vnoise(vLocal * grainScale) * 0.6 + vnoise(vLocal * grainScale * 0.23 + seed * 7.0) * 0.4;
  vec3 cream = vec3(0.957, 0.93, 0.866) * (0.985 + 0.03 * fract(seed * 13.17));
  if (vWall > 0.5) {
    vec3 edge = kind > 1.5 ? vec3(0.56, 0.52, 0.46) : kind > 0.5 ? vec3(0.44, 0.24, 0.2) : cream * (0.9 + 0.08 * fract(seed * 7.31));
    float lip = smoothstep(0.0, 1.0, vSide);
    albedo = edge * mix(1.0, 0.72, lip) * (0.94 + 0.08 * grain);
  } else if (kind < 0.5) {
    vec3 uv = frameUV(vGrid);
    uv.z = layer;
    bool has = ((uDrawn >> int(layer + 0.5)) & 1) == 1;
    vec3 tex = has ? texture(uFrames, uv).rgb : cream;
    if (front) {
      albedo = tex;
      albedo *= 1.0 - 0.1 * exp(-vLocal.x / 0.035);
    } else {
      float ink = dot(tex, vec3(0.333));
      albedo = cream * (0.97 + 0.04 * grain) * mix(1.0, ink / 0.9, 0.05);
    }
  } else if (kind < 1.5) {
    if (front) {
      albedo = vec3(0.42, 0.21, 0.17) * (0.9 + 0.2 * vnoise(vLocal * 300.0));
    } else {
      vec2 g = vec2(1.0 - vGrid.x, vGrid.y);
      vec3 uv = frameUV(g);
      uv.z = uCoverLayer;
      bool hasCover = ((uDrawn >> int(uCoverLayer + 0.5)) & 1) == 1;
      albedo = hasCover ? texture(uFrames, uv).rgb : vec3(0.7, 0.64, 0.55);
    }
  } else {
    albedo = vec3(0.6, 0.56, 0.5) * (0.9 + 0.2 * grain);
  }
  vec3 L = normalize(uLight);
  float sh = shadowAt(vWorld, n);
  float diff = max(dot(n, L), 0.0);
  vec3 h = normalize(L + toCam);
  float spec = pow(max(dot(n, h), 0.0), 28.0) * 0.035 * sh;
  float sky = 0.5 + 0.5 * n.z;
  vec3 col = albedo * (0.5 + 0.1 * sky + 0.42 * diff * sh) + spec;
  outColor = vec4(col, 1.0);
}
`;

export const DEPTH_FRAGMENT = `#version 300 es
precision highp float;
out vec4 outColor;
void main() {
  outColor = vec4(1.0);
}
`;

export const TABLE_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
uniform mat4 uVP;
uniform float uExtent;
out vec3 vWorld;
void main() {
  vec3 w = vec3(aPos * uExtent, 0.0);
  vWorld = w;
  gl_Position = uVP * vec4(w, 1.0);
}
`;

export const TABLE_FRAGMENT = `#version 300 es
precision highp float;
in vec3 vWorld;
uniform sampler2D uShadow;
uniform mat4 uLightVP;
uniform float uShadowTexel;
uniform float uPenScale;
uniform float uBias;
uniform vec3 uGround;
uniform vec4 uFoot;
uniform vec2 uFootRot;
out vec4 outColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

const vec2 DISK[12] = vec2[12](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598)
);

vec2 depthSlope(vec3 sc) {
  vec3 dx = dFdx(sc);
  vec3 dy = dFdy(sc);
  float det = dx.x * dy.y - dy.x * dx.y;
  if (abs(det) < 1e-12) return vec2(0.0);
  vec2 g = vec2(dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z) / det;
  return clamp(g, vec2(-40.0), vec2(40.0));
}

float shadowAt(vec3 world, bool skip) {
  vec4 lp = uLightVP * vec4(world, 1.0);
  vec3 sc = lp.xyz / max(lp.w, 0.0001) * 0.5 + 0.5;
  vec2 slope = depthSlope(sc);
  if (skip || sc.x <= 0.0 || sc.x >= 1.0 || sc.y <= 0.0 || sc.y >= 1.0 || sc.z >= 1.0) return 1.0;
  float recv = sc.z - uBias;
  float ang = hash12(gl_FragCoord.xy) * 6.2831853;
  mat2 rot = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
  float blockSum = 0.0;
  float blockCount = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 o = rot * DISK[i] * uShadowTexel * 18.0;
    float d = texture(uShadow, sc.xy + o).r;
    float r = recv + dot(slope, o) - uBias * 2.0;
    if (d < r) {
      blockSum += r - d;
      blockCount += 1.0;
    }
  }
  if (blockCount < 0.5) return 1.0;
  float gap = blockSum / blockCount;
  float pen = clamp(gap * uPenScale, 2.0, 30.0);
  float lit = 0.0;
  for (int i = 0; i < 12; i++) {
    vec2 o = rot * DISK[i] * uShadowTexel * pen;
    float d = texture(uShadow, sc.xy + o).r;
    lit += step(recv + dot(slope, o), d);
  }
  return lit / 12.0;
}

float boxDist(vec2 p, vec2 c, vec2 h) {
  vec2 q = abs(p - c) - h;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

void main() {
  vec2 p = vWorld.xy;
  vec2 lp = vec2(p.x * uFootRot.x + p.y * uFootRot.y, -p.x * uFootRot.y + p.y * uFootRot.x);
  float d = max(boxDist(lp, uFoot.xy, uFoot.zw), 0.0);
  float ao = 1.0 - 0.32 * exp(-d / 0.012) - 0.1 * exp(-d / 0.12);
  float sh = shadowAt(vWorld, d > 1.2);
  float n = vnoise(p * 260.0) * 0.5 + vnoise(p * 41.0) * 0.3 + vnoise(p * 6.0) * 0.2;
  vec3 col = uGround * (0.985 + 0.03 * n);
  col *= mix(0.8, 1.0, sh) * ao;
  outColor = vec4(col, 1.0);
}
`;
