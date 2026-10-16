export const FULL_VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const BAKE_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uCard;
uniform sampler2D uMask;
uniform sampler2D uBg;
uniform sampler2D uBody;
uniform vec2 uPatch;
uniform vec2 uSize;
uniform float uAspect;
uniform vec4 uArt;
uniform vec2 uPivot;
uniform vec2 uLimbPivot;
uniform vec4 uRoot;
uniform vec4 uLimb;
uniform vec4 uBall;
uniform vec2 uBallTail;
uniform float uBgShift;
uniform float uSeed;

out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(127.317, 311.703));
  p += dot(p, p + 47.113);
  return fract(p.x * p.y);
}

mat2 rot(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, s, -s, c);
}

vec2 toIso(vec2 uv) {
  return vec2(uv.x * uAspect, uv.y);
}

vec2 toUv(vec2 q) {
  return vec2(q.x / max(uAspect, 1e-3), q.y);
}

vec2 clampArt(vec2 uv) {
  return clamp(uv, uArt.xy + 0.002, uArt.zw - 0.002);
}

float bendWeight(float y) {
  return smoothstep(uPivot.y + 0.02, uPivot.y - 0.32, y);
}

vec2 unRoot(vec2 q) {
  float w = bendWeight(q.y);
  vec2 pivot = toIso(uPivot);
  float scale = max(mix(1.0, uRoot.w, w), 0.2);
  vec2 local = (q - pivot - uRoot.yz * mix(0.4, 1.0, w)) / scale;
  return pivot + rot(-uRoot.x * w) * local;
}

vec2 unLimb(vec2 q) {
  vec2 pivot = toIso(uLimbPivot);
  return pivot + rot(-uLimb.x) * (q - pivot - uLimb.yz);
}

float colorKey(vec3 a, vec3 b) {
  vec3 d = a - b;
  return smoothstep(0.05, 0.15, sqrt(dot(d * d, vec3(0.9, 1.2, 0.9))));
}

vec3 figureColor(vec2 uv, float hole, out float alpha) {
  vec2 suv = clampArt(uv);
  vec3 card = texture(uCard, suv).rgb;
  vec4 m = texture(uMask, suv);
  vec3 bg = texture(uBg, suv).rgb;
  float key = colorKey(card, bg);
  bool inside = all(greaterThan(uv, uArt.xy)) && all(lessThan(uv, uArt.zw));
  float h = smoothstep(0.05, 0.5, textureLod(uMask, suv, 1.2).g) * hole;
  alpha = inside ? m.r * max(m.b, key * (1.0 - h)) : 0.0;
  vec3 fill = texture(uBody, suv).rgb;
  vec2 puv = clampArt(suv + uPatch);
  vec3 detail = texture(uCard, puv).rgb - textureLod(uCard, puv, 3.0).rgb;
  float lum = dot(fill, vec3(0.299, 0.587, 0.114));
  vec3 cloth = fill + detail * 0.9 * smoothstep(0.15, 0.6, lum);
  return mix(card, cloth, h);
}

vec3 limbColor(vec2 uv, out float alpha) {
  vec2 suv = clampArt(uv);
  vec3 card = texture(uCard, suv).rgb;
  vec4 m = texture(uMask, suv);
  vec3 bg = texture(uBg, suv).rgb;
  float key = colorKey(card, bg);
  bool inside = all(greaterThan(uv, uArt.xy)) && all(lessThan(uv, uArt.zw));
  alpha = inside ? smoothstep(0.08, 0.6, m.g) * max(m.a, key) : 0.0;
  return card;
}

vec3 backdrop(vec2 uv) {
  vec2 suv = clampArt(uv + vec2(uBgShift, 0.0));
  vec3 card = texture(uCard, suv).rgb;
  vec4 m = textureLod(uMask, suv, 2.5);
  vec3 bg = texture(uBg, suv).rgb;
  float near = smoothstep(0.0, 0.06, max(textureLod(uMask, suv, 4.5).r, textureLod(uMask, suv, 4.5).g));
  float cover = max(smoothstep(0.02, 0.4, max(m.r, m.g)), colorKey(card, bg) * near);
  vec2 g = suv * uSize;
  float mottle = (hash21(floor(g * 0.5) + 3.1) - 0.5) * 0.05 + (fract(sin(dot(floor(g * 0.12), vec2(12.9, 78.2))) * 43758.5) - 0.5) * 0.03;
  return mix(card, bg + mottle, cover);
}

vec4 ball(vec2 q) {
  if (uBall.z <= 0.0) return vec4(0.0);
  vec2 c = vec2(uBall.x * uAspect, uBall.y);
  float r = uBall.z;
  vec4 acc = vec4(0.0);
  vec2 tail = uBallTail;
  float tl = dot(tail, tail);
  float h = tl > 1e-8 ? clamp(dot(q - c, tail) / tl, 0.0, 1.0) : 0.0;
  float ds = length(q - c - tail * h);
  float trail = (1.0 - smoothstep(r * 0.2, r * 0.95, ds)) * (1.0 - h) * (1.0 - h) * 0.55 * step(1e-8, tl);
  acc = vec4(vec3(0.95, 0.94, 0.9), trail);
  vec2 d = (q - c) / max(r, 1e-4);
  float rr = dot(d, d);
  float body = 1.0 - smoothstep(0.9, 1.0, sqrt(rr));
  if (body > 0.0) {
    float z = sqrt(max(1.0 - rr, 0.0));
    vec3 n = vec3(d.x, -d.y, z);
    float lit = 0.66 + 0.34 * max(dot(n, normalize(vec3(-0.5, 0.6, 0.65))), 0.0);
    vec3 col = vec3(0.95, 0.93, 0.87) * lit;
    float seamL = abs(length(d - vec2(-1.25, 0.0)) - 0.95);
    float seamR = abs(length(d - vec2(1.25, 0.0)) - 0.95);
    float seam = min(seamL, seamR);
    float ang = atan(d.y, abs(d.x) - 1.25);
    float stitch = step(0.5, fract(ang * 9.0)) * (1.0 - smoothstep(0.05, 0.12, seam));
    col = mix(col, vec3(0.72, 0.12, 0.1), stitch * 0.9 * smoothstep(0.0, 0.3, z));
    acc.rgb = mix(acc.rgb, col, body);
    acc.a = acc.a + body * (1.0 - acc.a);
  }
  return acc;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  bool inArt = all(greaterThan(uv, uArt.xy)) && all(lessThan(uv, uArt.zw));
  if (!inArt) {
    outColor = vec4(texture(uCard, uv).rgb, 1.0);
    return;
  }
  vec2 q = toIso(uv);
  vec2 bodyQ = unRoot(q);
  vec2 limbQ = unLimb(bodyQ);
  float bodyA;
  float moved = clamp(abs(uLimb.x) * 6.0 + length(uLimb.yz) * 40.0, 0.0, 1.0);
  vec3 body = figureColor(toUv(bodyQ), moved, bodyA);
  float limbA;
  vec3 limb = limbColor(toUv(limbQ), limbA);
  vec3 col = backdrop(uv);
  col = mix(col, body, bodyA);
  col = mix(col, limb, limbA);
  vec4 b = ball(q);
  col = mix(col, b.rgb, b.a);
  float edge = min(min(uv.x - uArt.x, uArt.z - uv.x), min(uv.y - uArt.y, uArt.w - uv.y));
  col = mix(texture(uCard, uv).rgb, col, smoothstep(0.0, 0.004, edge));
  outColor = vec4(col, 1.0);
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
    face = mix(face, vec3(0.94, 0.93, 0.9), wear * 0.75);
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
