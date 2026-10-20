export const FULL_VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const CARD_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray uArt;
uniform vec2 uRes;
uniform float uDpr;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform mat3 uRot;
uniform float uLift;
uniform float uDist;
uniform float uGround;
uniform float uRidges;
uniform float uFrames;
uniform float uGain;
uniform float uRadius;
uniform float uThick;
uniform float uReady;
uniform vec3 uKey;
uniform float uSeed;
uniform vec3 uGroundTint;

out vec4 outColor;

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

float boxSdf(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float safeDiv(float a, float b) {
  return a / (abs(b) < 1e-5 ? (b < 0.0 ? -1e-5 : 1e-5) : b);
}

vec3 frameAt(vec2 uv, float layer, vec2 gx, vec2 gy) {
  return textureGrad(uArt, vec3(uv, mod(layer, uFrames)), gx, gy).rgb;
}

vec3 groundColor(vec2 p) {
  vec2 uv = p / max(uRes / uDpr, vec2(1.0));
  vec2 lamp = (uv - vec2(0.32, 0.18)) * vec2(1.0, 1.25);
  float pool = exp(-min(dot(lamp, lamp) * 1.6, 30.0));
  vec3 col = uGroundTint * (0.88 + 0.13 * pool);
  float tooth = vnoise(p * 0.9) * 0.6 + vnoise(p * 2.3) * 0.4;
  col *= 1.0 + (tooth - 0.5) * 0.025;
  return col;
}

float shadowAt(vec3 pg, vec3 n, vec3 c, vec3 l, float spread, float base) {
  float denom = dot(n, l);
  float s = safeDiv(dot(n, c - pg), denom);
  vec3 hit = pg + l * s;
  vec3 local = transpose(uRot) * (hit - c);
  float sd = boxSdf(local.xy, uHalf, uRadius);
  float pw = base + max(s, 0.0) * spread;
  return 1.0 - smoothstep(-pw, pw, sd);
}

void main() {
  vec2 css = gl_FragCoord.xy / uDpr;
  css.y = uRes.y / uDpr - css.y;
  vec3 eye = vec3(0.0, 0.0, uDist);
  vec3 onScreen = vec3(css.x - uCenter.x, uCenter.y - css.y, 0.0);
  vec3 dir = normalize(onScreen - eye);
  vec3 n = uRot * vec3(0.0, 0.0, 1.0);
  vec3 c = vec3(0.0, 0.0, uLift);
  float facing = dot(n, -dir);
  float t = safeDiv(dot(n, c - eye), dot(n, dir));
  vec3 p = eye + dir * t;
  vec3 local = transpose(uRot) * (p - c);
  float sd = boxSdf(local.xy, uHalf, uRadius);
  float tb = safeDiv(dot(n, c - n * uThick - eye), dot(n, dir));
  vec3 lb = transpose(uRot) * (eye + dir * tb - c);
  float sdb = boxSdf(lb.xy, uHalf, uRadius);
  float px = max(length(fwidth(local.xy)), 1e-3);
  float pxb = max(length(fwidth(lb.xy)), 1e-3);
  float fwx = max(fwidth(local.x), 1e-3);
  vec2 uv = vec2(local.x / (2.0 * uHalf.x) + 0.5, 0.5 - local.y / (2.0 * uHalf.y));
  vec2 gx = dFdx(uv);
  vec2 gy = dFdy(uv);

  float tg = safeDiv(-uGround - eye.z, dir.z);
  vec3 pg = eye + dir * tg;
  vec3 col = groundColor(css);
  vec3 sun = normalize(uKey + vec3(0.0, 0.0, 0.35));
  float contact = shadowAt(pg, n, c, sun, 0.12, 4.0);
  float soft = shadowAt(pg + vec3(-4.0, 6.0, 0.0), n, c, normalize(vec3(-0.06, 0.22, 1.0)), 0.9, 26.0);
  col *= 1.0 - (0.13 * contact + 0.16 * soft) * uReady;

  float coverBack = clamp(0.5 - sdb / pxb, 0.0, 1.0);
  float coverFront = clamp(0.5 - sd / px, 0.0, 1.0) * step(0.0, facing);
  vec3 edgeCol = vec3(0.86, 0.845, 0.81) * (0.72 + 0.28 * max(dot(n, uKey), 0.0));
  col = mix(col, edgeCol, coverBack * uReady);

  if (coverFront > 0.0 && uReady > 0.0) {
    float cell = uv.x * uRidges;
    float ci = floor(cell);
    float fu = fract(cell);
    float ridgeCss = (2.0 * uHalf.x) / max(uRidges, 1.0);
    float ridgeDev = ridgeCss / fwx;
    float ridgeVis = smoothstep(2.0, 4.0, ridgeDev);

    vec3 vWorld = normalize(eye - p);
    vec3 vOrtho = transpose(uRot) * vec3(0.0, 0.0, 1.0);
    float thetaO = atan(vOrtho.x, max(vOrtho.z, 1e-3));
    float theta = thetaO;
    float jitter = (uv.x - 0.5) * (0.55 / max(uFrames, 1.0)) + 0.006 * sin(uv.y * 4.0 + uSeed);
    float s = 0.5 + uGain * tan(clamp(theta, -1.2, 1.2)) + jitter;
    float fr = s * uFrames - 0.5;
    float i0 = floor(fr);
    float tf = fr - i0;
    float sharp = 0.05;
    float tR = smoothstep(0.5 - sharp, 0.5 + sharp, tf + 0.012);
    float tG = smoothstep(0.5 - sharp, 0.5 + sharp, tf);
    float tB = smoothstep(0.5 - sharp, 0.5 + sharp, tf - 0.012);
    float squeeze = mix(1.0, 0.5, ridgeVis);
    vec2 suv = vec2((ci + 0.5 + (fu - 0.5) * squeeze) / max(uRidges, 1.0), uv.y);
    vec3 a = frameAt(suv, i0, gx, gy);
    vec3 b = frameAt(suv, i0 + 1.0, gx, gy);
    vec3 art = vec3(mix(a.r, b.r, tR), mix(a.g, b.g, tG), mix(a.b, b.b, tB));
    vec3 ghost = mix(b, a, tG);
    art = mix(art, ghost, 0.02);

    float lam = max(dot(n, uKey), 0.0);
    art *= 0.86 + 0.16 * lam;
    art = art * 0.94 + vec3(0.03, 0.026, 0.016);

    float phi = (fu - 0.5) * 2.0;
    float bend = phi * 0.95 * ridgeVis;
    vec3 nl = normalize(vec3(sin(bend), 0.0, cos(bend)));
    vec3 nr = uRot * nl;
    float valley = 1.0 - 0.2 * ridgeVis * smoothstep(0.5, 1.0, abs(phi)) + 0.05 * ridgeVis * (1.0 - smoothstep(0.0, 0.3, abs(phi + 0.4)));
    art *= valley;

    vec3 rFlat = reflect(-vWorld, n);
    vec2 across = local.xy / max(uHalf.y, 1.0);
    float sweep = dot(across, vec2(0.55, 0.42)) + rFlat.x * 3.2 + rFlat.y * 2.1 - 0.12;
    float band = exp(-min(sweep * sweep * 9.0, 30.0));
    float band2 = exp(-min((sweep + 0.55) * (sweep + 0.55) * 40.0, 30.0));
    float wide = exp(-min(sweep * sweep * 1.4, 30.0));
    vec3 rr = reflect(-vWorld, nr);
    float lineX = rr.x - (0.16 + 0.05 * sin(across.y * 2.0));
    float glint = exp(-min(lineX * lineX * 260.0, 30.0)) * smoothstep(-0.2, 0.4, rr.y + 0.3);
    float window = smoothstep(0.15, 0.7, rr.y) * smoothstep(0.95, 0.2, abs(rr.x + 0.2));
    float fres = 0.04 + 0.96 * pow(clamp(1.0 - dot(nr, vWorld), 0.0, 1.0), 5.0);

    vec2 sc = uv * vec2(uHalf.x / max(uHalf.y, 1.0), 1.0) * 46.0;
    vec2 sCell = floor(sc);
    float sAng = hash21(sCell + 7.0) * 3.14159;
    vec2 sq = sc - sCell - 0.5;
    float sAlong = sq.x * cos(sAng) + sq.y * sin(sAng);
    float sAcross = -sq.x * sin(sAng) + sq.y * cos(sAng);
    float scratch = step(0.94, hash21(sCell)) * (1.0 - smoothstep(0.0, 0.035, abs(sAcross))) * (1.0 - smoothstep(0.25, 0.45, abs(sAlong)));

    vec3 spec = vec3(1.0, 0.99, 0.965) * (glint * (0.015 + 0.42 * band + 0.12 * band2) * ridgeVis + band * 0.13 + band2 * 0.05 + wide * 0.035 + window * fres * 0.35 + scratch * band * 0.18);
    vec3 face = art + spec;

    float edgeIn = -sd;
    float wearN = vnoise(local.xy * 0.35 + uSeed) * 0.7 + vnoise(local.xy * 1.3) * 0.3;
    vec2 cq = abs(local.xy) - (uHalf - uRadius * 2.2);
    float corner = smoothstep(0.0, uRadius * 2.0, min(cq.x, cq.y));
    float wearWidth = 1.2 + 2.6 * wearN + corner * 2.5;
    float wear = (1.0 - smoothstep(wearWidth * 0.4, wearWidth, edgeIn)) * smoothstep(0.35, 0.75, wearN + corner * 0.3);
    face = mix(face, vec3(0.94, 0.93, 0.9), wear * 0.4);
    float rim = (1.0 - smoothstep(0.4, 1.6, edgeIn)) * 0.18 * (0.5 + lam);
    face += rim;
    float innerShade = 1.0 - 0.06 * (1.0 - smoothstep(0.0, 10.0, edgeIn));
    face *= innerShade;
    col = mix(col, face, coverFront);
  }
  float grain = (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(col + grain, 1.0);
}
`;
