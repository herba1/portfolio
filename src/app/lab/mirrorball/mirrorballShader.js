export const SCENE_VS = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SCENE_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform vec2 uRes;
uniform sampler2D uMask;
uniform sampler2D uSpecks;
uniform sampler2D uBloom;
uniform float uLightInv;
uniform float uSeed;
uniform float uMaskOn;
uniform float uFade;
uniform vec2 uCenter;
uniform float uSwirl;
uniform float uBend;
uniform float uTime;
uniform float uBloomGain;

out vec4 outColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 aces(vec3 x) {
  x = clamp(x, 0.0, 64.0);
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec2 warp(vec2 fc, float k) {
  float m = min(uRes.x, uRes.y);
  vec2 p = (fc - uCenter) / m;
  float r = length(p);
  float a = uSwirl * k * exp(-r * r * 1.6) + uBend * 0.06 * sin(r * 7.0 - uTime * 0.9);
  float c = cos(a);
  float s = sin(a);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  p /= 1.0 + uBend * 0.32 * r * r * k;
  return (uCenter + p * m) / uRes;
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec3 specks = vec3(
    texture(uSpecks, warp(fc, 1.014)).r,
    texture(uSpecks, warp(fc, 1.0)).g,
    texture(uSpecks, warp(fc, 0.986)).b
  ) * uLightInv;
  vec3 bloom = texture(uBloom, warp(fc, 1.0)).rgb * uLightInv;
  float mask = 0.0;
  if (uMaskOn > 0.5) mask = texture(uMask, vec2(fc.x / uRes.x, 1.0 - fc.y / uRes.y)).a;
  float keep = 1.0 - clamp(mask * 1.6, 0.0, 0.92);
  vec3 color = (specks * 0.055 + bloom * 0.055 * uBloomGain) * keep;
  vec3 mapped = aces(color * 1.15);
  vec3 display = pow(max(mapped, vec3(0.0)), vec3(1.0 / 2.2));
  float n = hash12(fc + fract(uSeed) * 517.0) - 0.5;
  float n2 = hash12(fc * 1.37 + fract(uSeed * 1.7) * 311.0) - 0.5;
  display += (n + n2) * (1.0 / 255.0) * step(0.004, dot(display, vec3(0.33)));
  outColor = vec4(display * uFade, 1.0);
}
`;

export const DOWN_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uSrc;
uniform vec2 uSrcRes;
uniform vec2 uDstRes;
uniform float uKnee;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uDstRes;
  vec2 t = 1.0 / uSrcRes;
  vec3 c = texture(uSrc, uv + t * vec2(-1.0, -1.0)).rgb;
  c += texture(uSrc, uv + t * vec2(1.0, -1.0)).rgb;
  c += texture(uSrc, uv + t * vec2(-1.0, 1.0)).rgb;
  c += texture(uSrc, uv + t * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float w = l > 0.0 ? max(l - uKnee, 0.0) / l : 0.0;
  outColor = vec4(c * w, 1.0);
}
`;

export const BLUR_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform vec2 uDir;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 d = uDir / uRes;
  vec3 c = texture(uSrc, uv).rgb * 0.2270;
  c += (texture(uSrc, uv + d * 1.3846).rgb + texture(uSrc, uv - d * 1.3846).rgb) * 0.3162;
  c += (texture(uSrc, uv + d * 3.2308).rgb + texture(uSrc, uv - d * 3.2308).rgb) * 0.0703;
  outColor = vec4(c, 1.0);
}
`;

export const SPECK_VS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec2 aFacet;

uniform sampler2D uFacets;
uniform mat3 uRot;
uniform mat3 uRotPrev;
uniform vec3 uLight;
uniform vec3 uCam;
uniform vec4 uBall;
uniform vec2 uBox;
uniform float uWall;
uniform vec4 uRoom;
uniform float uMix;
uniform sampler2D uTint;
uniform sampler2D uTintPrev;
uniform float uRings;
uniform float uSpread;
uniform int uMode;

out vec2 vLocal;
flat out vec2 vMotion;
out float vPower;
out float vAlong;
out float vSoft;
out vec3 vTint;

const float PI = 3.14159265;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 toScreen(vec3 q) {
  float s = uBall.w / max(uBall.w - q.z, 1.0);
  vec2 p = uCam.xy + (q.xy - uCam.xy) * s;
  return vec2(uBall.x + p.x, uBall.y - p.y);
}

vec4 roomHit(vec3 o, vec3 d, out vec3 nrm) {
  float best = 1e9;
  nrm = vec3(0.0, 0.0, 1.0);
  float t;
  if (d.x > 1e-5) { t = (uRoom.x - o.x) / d.x; if (t < best) { best = t; nrm = vec3(-1.0, 0.0, 0.0); } }
  if (d.x < -1e-5) { t = (-uRoom.x - o.x) / d.x; if (t < best) { best = t; nrm = vec3(1.0, 0.0, 0.0); } }
  if (d.y > 1e-5) { t = (uRoom.z - o.y) / d.y; if (t < best) { best = t; nrm = vec3(0.0, -1.0, 0.0); } }
  if (d.y < -1e-5) { t = (-uRoom.y - o.y) / d.y; if (t < best) { best = t; nrm = vec3(0.0, 1.0, 0.0); } }
  if (d.z < -1e-5) { t = (-uRoom.w - o.z) / d.z; if (t < best) { best = t; nrm = vec3(0.0, 0.0, 1.0); } }
  return vec4(o + d * best, best);
}

vec4 toClip(vec2 css) {
  return vec4(css.x / uBox.x * 2.0 - 1.0, 1.0 - css.y / uBox.y * 2.0, 0.0, 1.0);
}

void main() {
  vLocal = aCorner;
  vMotion = vec2(0.0);
  vPower = 0.0;
  vAlong = 0.0;
  vSoft = 0.2;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vec4 texel = texelFetch(uFacets, ivec2(aFacet), 0);
  float d = PI / uRings;
  float lat = -0.5 * PI + (aFacet.y + 0.5) * d;
  float lon = (aFacet.x + 0.5) * 2.0 * PI / max(texel.w, 1.0);
  vec3 ng = uRot * vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
  vec3 n = normalize(uRot * texel.xyz);
  float th = hash12(aFacet + 3.1);
  float th2 = hash12(aFacet * 1.7 + 11.0);
  vec3 cover = mix(texelFetch(uTintPrev, ivec2(aFacet), 0).rgb, texelFetch(uTint, ivec2(aFacet), 0).rgb, uMix);
  vTint = cover * (0.62 + 0.5 * th2 * th2);
  float R = uBall.z;
  float tile = R * d;
  vec3 P = ng * R;
  float lit = dot(ng, uLight);
  float polar = smoothstep(1.39, 1.3, abs(lat));
  if (polar <= 0.0) return;

  if (lit <= 0.0) return;
  vec3 r = reflect(-uLight, n);
  vec3 N;
  vec4 hit = roomHit(P, r, N);
  vec3 H = hit.xyz;
  float t = hit.w;
  if (t > 1e8 || N.z < 0.5) return;
  vec2 onScreen = toScreen(H) / uBox;
  if (onScreen.x < -0.15 || onScreen.x > 1.15 || onScreen.y < -0.15 || onScreen.y > 1.15) return;
  float pen = t * uSpread;
  float rad = tile * 0.42 + pen;
  float cosI = abs(dot(r, N));
  float stretch = min(1.0 / max(cosI, 0.2), 5.0);
  vec3 a1w = r - N * dot(r, N);
  float al = length(a1w);
  a1w = al > 0.0001 ? a1w / al : (abs(N.y) > 0.5 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0));
  vec3 a2w = cross(N, a1w);
  float power = sqrt(lit) * (tile * tile * 0.18) / max(rad * rad * stretch, 0.0001);
  power = min(power, 2.4) * smoothstep(0.0, 0.22, lit) * polar;
  vPower = power;
  vSoft = clamp(pen / rad, 0.06, 0.9);

  {
    vec2 s1 = toScreen(H);
    vec2 ax1 = toScreen(H + a1w * rad * stretch) - s1;
    vec2 ax2 = toScreen(H + a2w * rad) - s1;
    vec2 motion = vec2(0.0);
    vec3 nPrev = normalize(uRotPrev * texel.xyz);
    vec3 ngPrev = uRotPrev * vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
    vec3 rPrev = reflect(-uLight, nPrev);
    vec3 nPrevHit;
    vec4 hp = roomHit(ngPrev * R, rPrev, nPrevHit);
    if (hp.w < 1e8 && dot(nPrevHit, N) > 0.5) {
      vec2 m = toScreen(hp.xyz) - s1;
      float det = ax1.x * ax2.y - ax1.y * ax2.x;
      if (abs(det) > 0.0001) motion = vec2(m.x * ax2.y - m.y * ax2.x, ax1.x * m.y - ax1.y * m.x) / det;
      float ml = length(motion);
      if (ml > 14.0) motion *= 14.0 / ml;
    }
    vec2 L = aCorner * 1.6;
    if (dot(aCorner, motion) > 0.0) L += motion;
    vMotion = motion;
    vPower = power / (1.0 + length(motion) * 0.55);
    gl_Position = toClip(s1 + ax1 * L.x + ax2 * L.y);
    vLocal = L;
    return;
  }

}
`;

export const SPECK_FS = `#version 300 es
precision highp float;
precision highp int;

in vec2 vLocal;
flat in vec2 vMotion;
in float vPower;
in float vAlong;
in float vSoft;
in vec3 vTint;

uniform int uMode;
uniform vec3 uGel;
uniform float uRayGain;
uniform float uSpeckGain;
uniform float uLightScale;

layout(location = 0) out vec4 oLight;
layout(location = 1) out vec4 oGlow;

void main() {
  if (vPower <= 0.0) discard;
  {
    float mm = dot(vMotion, vMotion);
    float st = mm > 0.0001 ? clamp(dot(vLocal, vMotion) / mm, 0.0, 1.0) : 0.0;
    vec2 q = abs(vLocal - vMotion * st);
    float shape = mix(3.4, 2.0, vSoft);
    float dd = pow(max(pow(q.x, shape) + pow(q.y, shape), 0.000001), 1.0 / shape);
    float body = 1.0 - smoothstep(1.0 - vSoft * 0.7, 1.0 + vSoft * 0.35, dd);
    float halo = exp(-dd * dd * 2.2) * 0.07;
    vec3 c = uGel * vTint * vPower * (body + halo) * uSpeckGain;
    oLight = vec4(c * uLightScale, 1.0);
    oGlow = vec4(0.0);
    return;
  }
}
`;
