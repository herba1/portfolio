export const MAX_TINES = 5;

export const QUAD_VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FETCH = `
uniform highp sampler2D uHeight;
uniform vec2 uCells;
float hAt(ivec2 c) {
  ivec2 m = ivec2(uCells) - 1;
  return texelFetch(uHeight, clamp(c, ivec2(0), m), 0).r;
}
float hLerp(vec2 c) {
  vec2 q = c - 0.5;
  vec2 f = fract(q);
  ivec2 i = ivec2(floor(q));
  float a = hAt(i);
  float b = hAt(i + ivec2(1, 0));
  float d = hAt(i + ivec2(0, 1));
  float e = hAt(i + ivec2(1, 1));
  return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}
`;

export const CARVE_FRAGMENT = `#version 300 es
precision highp float;
${FETCH}
uniform vec2 uA;
uniform vec2 uB;
uniform vec2 uNA;
uniform vec2 uNB;
uniform int uTines;
uniform float uSpacing;
uniform float uRadius;
uniform float uDepth;
uniform float uReach;
uniform float uOuterShare;
uniform float uLower;
out vec4 outColor;
void main() {
  vec2 p = gl_FragCoord.xy;
  float h = hAt(ivec2(p));
  vec2 seg = uB - uA;
  float segLen2 = max(dot(seg, seg), 1e-6);
  float tt = clamp(dot(p - uA, seg) / segLen2, 0.0, 1.0);
  if (length(p - (uA + seg * tt)) > uReach) {
    outColor = vec4(h, 0.0, 0.0, 1.0);
    return;
  }
  float r = max(uRadius, 0.5);
  float sigma = r * 0.42;
  float shaped = h;
  bool claimed = false;
  float berm = 0.0;
  float half_ = float(uTines - 1) * 0.5;
  for (int k = 0; k < ${MAX_TINES}; k++) {
    if (k >= uTines) break;
    float off = (float(k) - half_) * uSpacing;
    vec2 a = uA + uNA * off;
    vec2 b = uB + uNB * off;
    vec2 ab = b - a;
    float len2 = dot(ab, ab);
    if (len2 < 1e-4) continue;
    float t = dot(p - a, ab) / len2;
    if (t < 0.0 || t >= 1.0) continue;
    vec2 c = a + ab * t;
    vec2 tan_ = ab * inversesqrt(len2);
    vec2 nrm = vec2(-tan_.y, tan_.x);
    float d = dot(p - c, nrm);
    float band = max(uSpacing * 0.5, r * 1.3);
    float dc = d + off;
    float outerC = half_ * uSpacing + band + r * 0.9;
    float sigmaO = r * 0.75;
    bool near = abs(d) <= r * 2.6;
    bool outerNear = (uOuterShare > 0.0 || uLower > 0.0) && abs(abs(dc) - outerC) < sigmaO * 3.5;
    if (!near && !outerNear) continue;
    float mean = 0.0;
    float samples[7];
    for (int s = 0; s < 7; s++) {
      float ds = (float(s) / 3.0 - 1.0) * band;
      samples[s] = hLerp(c + nrm * ds);
      mean += samples[s];
    }
    mean /= 7.0;
    float lower = min(uLower, mean);
    float meanLow = mean - lower;
    float depth = min(uDepth, meanLow);
    float removed = 0.0;
    float lowered = 0.0;
    for (int s = 0; s < 7; s++) {
      float u = (float(s) / 3.0 - 1.0) * band / r;
      float level = meanLow - depth * max(0.0, 1.0 - u * u);
      float flat_ = mix(samples[s], mean, 0.9);
      float drop_ = min(lower, flat_);
      lowered += drop_;
      removed += max(0.0, flat_ - drop_ - level);
    }
    removed *= band / 3.0;
    lowered *= band / 3.0;
    if (abs(d) < band) {
      float u = d / r;
      float level = max(0.0, meanLow - depth * max(0.0, 1.0 - u * u));
      float edgeK = smoothstep(band, band * 0.7, abs(d));
      float flat_ = max(0.0, mix(h, mean, 0.9 * edgeK) - lower * edgeK);
      if (!claimed) {
        shaped = min(flat_, level);
        claimed = true;
      }
    }
    float ampO = (removed * uOuterShare + lowered) * 0.5 / (sigmaO * 2.5066);
    float o1 = (dc - outerC) / sigmaO;
    float o2 = (dc + outerC) / sigmaO;
    berm += ampO * (exp(-0.5 * o1 * o1) + exp(-0.5 * o2 * o2));
    float amp = removed * (1.0 - uOuterShare) * 0.5 / (sigma * 2.5066);
    float e1 = (d - r * 1.3) / sigma;
    float e2 = (d + r * 1.3) / sigma;
    berm += amp * (exp(-0.5 * e1 * e1) + exp(-0.5 * e2 * e2));
  }
  outColor = vec4(max(0.0, shaped + berm), 0.0, 0.0, 1.0);
}
`;

export const RELAX_FRAGMENT = `#version 300 es
precision highp float;
${FETCH}
uniform float uTalus;
uniform float uRate;
out vec4 outColor;
float flow(float here, float there, float talus) {
  float diff = there - here;
  float excess = max(0.0, abs(diff) - talus);
  return sign(diff) * excess;
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  ivec2 m = ivec2(uCells) - 1;
  float h = hAt(c);
  float net = 0.0;
  float td = uTalus * 1.41421;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      if (i == 0 && j == 0) continue;
      ivec2 q = c + ivec2(i, j);
      if (q.x < 0 || q.y < 0 || q.x > m.x || q.y > m.y) continue;
      float n = texelFetch(uHeight, q, 0).r;
      bool diag = i != 0 && j != 0;
      net += flow(h, n, diag ? td : uTalus) * (diag ? 0.5 : 1.0);
    }
  }
  outColor = vec4(max(0.0, h + net * uRate), 0.0, 0.0, 1.0);
}
`;

export const BOARD_FRAGMENT = `#version 300 es
precision highp float;
${FETCH}
uniform highp sampler2D uTarget;
uniform float uFront;
uniform float uBand;
uniform float uBulge;
out vec4 outColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float h = hAt(c);
  float target = texelFetch(uTarget, c, 0).r;
  float x = gl_FragCoord.x;
  if (x < uFront) {
    outColor = vec4(target, 0.0, 0.0, 1.0);
    return;
  }
  float ahead = (x - uFront) / max(uBand, 1.0);
  if (ahead < 1.0) {
    float k = (1.0 - ahead);
    float push = mix(h, target, k * k * 0.85) + uBulge * k * k * (1.0 - k * 0.4);
    outColor = vec4(max(h * (1.0 - k * k), push), 0.0, 0.0, 1.0);
    return;
  }
  outColor = vec4(h, 0.0, 0.0, 1.0);
}
`;

export const RESAMPLE_FRAGMENT = `#version 300 es
precision highp float;
${FETCH}
uniform vec2 uDst;
uniform float uScale;
out vec4 outColor;
void main() {
  vec2 c = gl_FragCoord.xy / uDst * uCells;
  outColor = vec4(hLerp(c) * uScale, 0.0, 0.0, 1.0);
}
`;

export const BAKE_FRAGMENT = `#version 300 es
precision highp float;
${FETCH}
uniform vec2 uLight;
uniform float uTanE;
uniform float uWall;
out vec4 outColor;
float hRay(vec2 c) {
  if (c.x < 0.0 || c.y < 0.0 || c.x > uCells.x || c.y > uCells.y) return uWall;
  return hLerp(c);
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  float h = hAt(c);
  float tl = hAt(c + ivec2(-1, -1));
  float tc = hAt(c + ivec2(0, -1));
  float tr = hAt(c + ivec2(1, -1));
  float ml = hAt(c + ivec2(-1, 0));
  float mr = hAt(c + ivec2(1, 0));
  float bl = hAt(c + ivec2(-1, 1));
  float bc = hAt(c + ivec2(0, 1));
  float br = hAt(c + ivec2(1, 1));
  float gx = ((tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl)) / 8.0;
  float gy = ((bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr)) / 8.0;
  vec2 p = gl_FragCoord.xy;
  float reach = min(140.0, (uWall + 2.0) / max(uTanE, 0.05));
  float occ = 0.0;
  for (int i = 1; i <= 30; i++) {
    float f = float(i) / 30.0;
    float s = reach * f * f + 0.35 * f;
    vec2 q = p + uLight * s;
    float ray = h + s * uTanE + 0.04;
    float above = hRay(q) - ray;
    occ = max(occ, clamp(above / (0.3 + s * 0.07), 0.0, 1.0));
  }
  float lit = 1.0 - occ * occ * (3.0 - 2.0 * occ);
  outColor = vec4(h, gx, gy, lit);
}
`;

export const STAT_FRAGMENT = `#version 300 es
precision highp float;
${FETCH}
uniform vec4 uTile;
uniform float uLimit;
out vec4 outColor;
void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  float open = 0.0;
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 uv = (cell * 4.0 + vec2(float(i), float(j)) + 0.5) / 128.0;
      vec2 c = uTile.xy + uv * uTile.zw;
      open += hLerp(c) < uLimit ? 1.0 : 0.0;
    }
  }
  outColor = vec4(open / 16.0, 0.0, 0.0, 1.0);
}
`;

export const RENDER_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uBake;
uniform sampler2D uCoverA;
uniform sampler2D uCoverB;
uniform vec2 uBox;
uniform float uDpr;
uniform vec4 uOuter;
uniform vec4 uBed;
uniform vec2 uCellPx;
uniform vec2 uCells;
uniform vec4 uTile;
uniform vec4 uCropA;
uniform vec4 uCropB;
uniform vec3 uSandA;
uniform vec3 uSandB;
uniform vec3 uDeepA;
uniform vec3 uDeepB;
uniform float uFront;
uniform float uBoardOn;
uniform vec2 uLight;
uniform float uSinE;
uniform float uCosE;
uniform vec2 uHead;
uniform vec2 uHeadDir;
uniform float uHeadLift;
uniform float uHeadAlpha;
uniform float uHeadHalf;
uniform float uHeadR;
uniform float uTineGap;
uniform float uTineCount;
uniform float uTool;
uniform float uRelief;
out vec4 outColor;

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
vec2 hash22(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.103, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
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
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return v;
}
float sdRound(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
vec3 shoulder(vec3 c) {
  vec3 over = max(c - 0.74, 0.0);
  return min(c, 0.74) + 0.25 * (1.0 - exp(-over / 0.25));
}
vec3 wood(float u, float v, float seed, vec3 dark, vec3 light) {
  float warp = fbm(vec2(u * 0.004 + seed, v * 0.06)) * 10.0;
  float rings = 0.5 + 0.5 * sin(v * 0.42 + warp + seed * 3.0);
  float streak = vnoise(vec2(u * 0.02 + seed * 5.0, v * 1.4));
  float fleck = vnoise(vec2(u * 0.3, v * 3.0 + seed));
  float t = clamp(rings * 0.55 + streak * 0.35 + fleck * 0.1, 0.0, 1.0);
  return mix(dark, light, t);
}

void main() {
  float px = 1.0 / uDpr;
  vec2 p = vec2(gl_FragCoord.x, uBox.y * uDpr - gl_FragCoord.y) * px;
  vec3 L = normalize(vec3(uLight * uCosE, uSinE));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 Hv = normalize(L + V);
  vec3 sun = vec3(1.0, 0.86, 0.68) * 1.45;
  vec3 sky = vec3(0.66, 0.65, 0.65);

  vec2 boxUv = p / uBox;
  vec3 col = vec3(0.905, 0.893, 0.868);
  col *= 1.0 + 0.035 * (1.0 - boxUv.x * 0.6 - boxUv.y * 0.8);
  col *= 0.985 + 0.03 * vnoise(p * 0.7);

  vec2 oc = uOuter.xy + uOuter.zw * 0.5;
  vec2 oh = uOuter.zw * 0.5;
  float frameW = uBed.x - uOuter.x;
  vec2 drop = -uLight;
  float sdNear = sdRound(p - oc - drop * 4.0, oh, 8.0);
  float sdFar = sdRound(p - oc - drop * 26.0, oh - 6.0, 24.0);
  float shade = 1.0 - 0.32 * (1.0 - smoothstep(-4.0, 10.0, sdNear)) - 0.2 * (1.0 - smoothstep(-30.0, 70.0, sdFar));
  col *= shade;

  float dOuter = sdRound(p - oc, oh, 7.0);
  if (dOuter < px) {
    vec2 q = p - oc;
    float ax = oh.x - abs(q.x);
    float ay = oh.y - abs(q.y);
    bool vertical = ax < ay;
    float u = vertical ? q.y : q.x;
    float v = vertical ? ax : ay;
    vec2 inward = vertical ? vec2(-sign(q.x), 0.0) : vec2(0.0, -sign(q.y));
    float side = vertical ? (q.x < 0.0 ? 1.0 : 2.0) : (q.y < 0.0 ? 3.0 : 4.0);
    float slope = 0.0;
    float outerR = min(5.0, frameW * 0.3);
    if (v < outerR) slope = 1.3 * (1.0 - v / outerR);
    float innerR = min(3.5, frameW * 0.25);
    if (v > frameW - innerR) slope = -1.1 * (v - (frameW - innerR)) / innerR;
    vec3 n = normalize(vec3(-inward * slope, 1.0));
    vec3 base = wood(u + side * 211.0, v + side * 37.0, side * 1.7, vec3(0.13, 0.078, 0.05), vec3(0.3, 0.185, 0.11));
    float diff = max(dot(n, L), 0.0);
    float spec = pow(max(dot(n, Hv), 0.0), 70.0) * 0.22 + pow(max(dot(n, Hv), 0.0), 9.0) * 0.05;
    vec3 fc = base * (sky * 0.78 + sun * diff * 0.9) + spec * vec3(1.0, 0.92, 0.8);
    float seam = 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.9, abs(ax - ay)));
    fc *= mix(seam, 1.0, step(frameW + 1.0, min(ax, ay)));
    float frameA = 1.0 - smoothstep(-px, px, dOuter);
    col = mix(col, fc, frameA);
  }

  vec2 bedLocal = p - uBed.xy;
  vec2 bedUv = bedLocal / uBed.zw;
  float inBed = step(0.0, bedUv.x) * step(bedUv.x, 1.0) * step(0.0, bedUv.y) * step(bedUv.y, 1.0);
  if (inBed > 0.5) {
    vec4 b = texture(uBake, bedUv);
    vec2 texel = 1.0 / uCells;
    float hn = texture(uBake, bedUv + vec2(0.0, -2.0) * texel).r;
    float hs = texture(uBake, bedUv + vec2(0.0, 2.0) * texel).r;
    float he = texture(uBake, bedUv + vec2(2.0, 0.0) * texel).r;
    float hw = texture(uBake, bedUv + vec2(-2.0, 0.0) * texel).r;
    float lap = (hn + hs + he + hw - 4.0 * b.r);
    float cellPx = 0.5 * (uCellPx.x + uCellPx.y);
    float hpx = b.r * cellPx;
    bool behind = bedLocal.x < uFront;
    vec3 sandC = behind ? uSandB : uSandA;
    vec3 deepC = behind ? uDeepB : uDeepA;

    vec2 gp = bedLocal * 0.85;
    vec2 gi = floor(gp);
    vec2 gf = fract(gp);
    float r1 = hash12(gi);
    float r2 = hash12(gi + 71.3);
    float r3 = hash12(gi + 13.9);
    vec2 gc = hash22(gi + 5.7) * 0.5 + 0.25;
    vec2 gd = gf - gc;
    float spot = exp(-dot(gd, gd) * 16.0);
    float tone = vnoise(bedLocal * 0.55) * 0.42 + vnoise(bedLocal * 0.19 + 4.0) * 0.38 + 0.2 + (r1 - 0.5) * 0.55 * spot;
    vec3 albedo = mix(deepC, sandC, clamp(0.3 + 0.7 * tone, 0.0, 1.1));
    albedo *= 0.965 + 0.07 * fbm(bedLocal * 0.012);
    if (r2 > 0.986) albedo *= mix(1.0, mix(0.58, 0.78, r3), spot);
    else if (r2 > 0.94) albedo = mix(albedo, albedo * vec3(1.04, 0.9, 0.8), spot);
    else if (r2 < 0.05) albedo = mix(albedo, vec3(0.97, 0.96, 0.93), 0.5 * spot);
    float e = 0.5;
    vec2 bp = bedLocal * 0.9;
    float nx = vnoise(bp + vec2(e, 0.0)) - vnoise(bp - vec2(e, 0.0)) + gd.x * spot * 0.35;
    float ny = vnoise(bp + vec2(0.0, e)) - vnoise(bp - vec2(0.0, e)) + gd.y * spot * 0.35;
    vec3 N = normalize(vec3(-b.g * uRelief - nx * 0.16, -b.b * uRelief - ny * 0.16, 1.0));
    float lit = b.a;
    float diff = max(dot(N, L), 0.0);
    float ao = clamp(1.0 - lap * 0.2, 0.7, 1.06);
    vec3 light = sky * ao + sun * diff * lit;
    vec3 sandLit = albedo * light;
    vec2 tilt = hash22(gi + 19.3) - 0.5;
    vec3 facet = normalize(N + vec3(tilt * 1.4, 0.0));
    float glint = pow(max(dot(facet, Hv), 0.0), 220.0);
    float pin = exp(-dot(gd, gd) * 40.0);
    sandLit += vec3(1.0, 0.95, 0.86) * glint * pin * lit * step(0.45, r3) * 2.2;

    float th = 0.2 + vnoise(bedLocal * 0.6) * 0.8;
    float cover = smoothstep(th, th + 0.55, hpx + spot * 0.3);
    vec3 bedCol = sandLit;
    if (cover < 0.999) {
      vec2 tileUv = (bedLocal - uTile.xy) / uTile.zw;
      bool inTile = all(greaterThanEqual(tileUv, vec2(0.0))) && all(lessThanEqual(tileUv, vec2(1.0)));
      vec3 floorC;
      if (inTile) {
        float border = 0.032;
        vec2 photoUv = (tileUv - border) / (1.0 - 2.0 * border);
        vec4 crop = behind ? uCropB : uCropA;
        vec3 glaze = vec3(0.935, 0.925, 0.9);
        vec3 print = behind ? texture(uCoverB, crop.xy + clamp(photoUv, 0.0, 1.0) * crop.zw).rgb : texture(uCoverA, crop.xy + clamp(photoUv, 0.0, 1.0) * crop.zw).rgb;
        print = mix(print, glaze, 0.04);
        bool inPhoto = all(greaterThanEqual(photoUv, vec2(0.0))) && all(lessThanEqual(photoUv, vec2(1.0)));
        floorC = inPhoto ? print : glaze;
        vec2 edgeDist = min(tileUv, 1.0 - tileUv) * uTile.zw;
        float edge = min(edgeDist.x, edgeDist.y);
        floorC *= 0.78 + 0.22 * smoothstep(0.0, 1.6, edge);
        float sheen = smoothstep(0.2, 1.0, 1.0 - abs(tileUv.x - tileUv.y - 0.15) * 1.6) * 0.05;
        floorC += sheen;
      } else {
        floorC = wood(bedLocal.x, bedLocal.y * 0.6, 9.1, vec3(0.16, 0.1, 0.065), vec3(0.27, 0.17, 0.105));
      }
      vec3 floorLit = floorC * (sky * ao + sun * uSinE * lit);
      float dust = smoothstep(0.0, 1.4, hpx) * 0.2 + step(0.988, hash12(gi + 3.1)) * spot * 0.6 * (1.0 - cover);
      floorLit = mix(floorLit, albedo * (sky + sun * uSinE * lit), dust);
      bedCol = mix(floorLit, sandLit, cover);
    }

    if (uBoardOn > 0.5) {
      float plankC = uFront - 11.0;
      float ds = abs(bedLocal.x - drop.x * 12.0 - plankC) - 11.0;
      bedCol *= 1.0 - 0.34 * (1.0 - smoothstep(-6.0, 12.0, ds));
    }
    col = bedCol;
    float lipD = min(min(bedLocal.x, bedLocal.y), min(uBed.z - bedLocal.x, uBed.w - bedLocal.y));
    col *= 0.7 + 0.3 * smoothstep(0.0, 1.5, lipD);
  }

  if (uBoardOn > 0.5) {
    float plankC = uBed.x + uFront - 11.0;
    float dx = p.x - plankC;
    float yTop = uOuter.y - 10.0;
    float yBot = uOuter.y + uOuter.w + 10.0;
    float dy = max(yTop - p.y, p.y - yBot);
    float sd = max(abs(dx) - 11.0, dy);
    if (inBed < 0.5) {
      vec2 ps = p - drop * 12.0;
      float sds = max(abs(ps.x - plankC) - 11.0, max(yTop - ps.y, ps.y - yBot));
      col *= 1.0 - 0.3 * (1.0 - smoothstep(-6.0, 12.0, sds));
    }
    if (sd < px) {
      float k = clamp(dx / 11.0, -1.0, 1.0);
      vec3 n = normalize(vec3(k * 0.55, 0.0, 1.0));
      vec3 base = wood(p.y, dx + 40.0, 4.2, vec3(0.5, 0.36, 0.22), vec3(0.74, 0.58, 0.39));
      float diff = max(dot(n, L), 0.0);
      vec3 pc = base * (sky * 0.85 + sun * diff * 0.95) + pow(max(dot(n, Hv), 0.0), 40.0) * 0.12;
      pc *= 0.82 + 0.18 * smoothstep(0.0, 1.4, -sd);
      col = mix(col, pc, 1.0 - smoothstep(-px, px, sd));
    }
  }

  if (uHeadAlpha > 0.001) {
    vec2 q = p - uHead;
    vec2 axis = vec2(-uHeadDir.y, uHeadDir.x);
    float height = mix(3.0, 20.0, uHeadLift);
    vec2 off = drop * height * 1.5;
    if (uTool < 0.5) {
      vec2 qs = q - off;
      float sdS = sdRound(vec2(dot(qs, axis), dot(qs, uHeadDir) + 2.0), vec2(uHeadHalf, 6.0), 6.0);
      float blur = 1.5 + height * 0.45;
      col *= 1.0 - uHeadAlpha * (0.34 - uHeadLift * 0.1) * (1.0 - smoothstep(-blur, blur, sdS));
      vec2 lq = vec2(dot(q, axis), dot(q, uHeadDir) + 2.0);
      float mid = (uTineCount - 1.0) * 0.5;
      float slot = clamp(floor(lq.x / max(uTineGap, 1.0) + mid + 0.5), 0.0, uTineCount - 1.0);
      vec2 tq = vec2(lq.x - (slot - mid) * uTineGap, lq.y + 7.0 + 3.0 * (1.0 - uHeadLift));
      vec2 tqs = tq - vec2(dot(off, axis), dot(off, uHeadDir)) * 0.7;
      float sdTs = sdRound(tqs, vec2(1.6, 5.0), 1.6);
      col *= 1.0 - uHeadAlpha * 0.36 * (1.0 - smoothstep(-1.5, 2.5, sdTs));
      float sdT = sdRound(tq, vec2(1.6, 5.0), 1.6);
      if (sdT < px) {
        float kk = clamp(tq.x / 1.6, -1.0, 1.0);
        vec3 tc = vec3(0.5, 0.36, 0.22) * (0.75 + 0.35 * (0.5 - 0.5 * kk));
        tc *= 0.8 + 0.25 * smoothstep(-5.0, 5.0, -tq.y);
        col = mix(col, tc, uHeadAlpha * (1.0 - smoothstep(-px, px, sdT)));
      }
      float sdB = sdRound(lq, vec2(uHeadHalf, 6.0), 6.0);
      if (sdB < px) {
        float k = clamp(lq.y / 6.0, -1.0, 1.0);
        vec3 n = normalize(vec3(uHeadDir * k * 0.95, sqrt(max(0.0, 1.0 - k * k)) + 0.15));
        vec3 base = wood(lq.x * 2.0 + 300.0, lq.y * 3.0 + 20.0, 6.3, vec3(0.48, 0.34, 0.2), vec3(0.72, 0.56, 0.37));
        float diff = max(dot(n, L), 0.0);
        vec3 hc = base * (sky * 0.85 + sun * diff) + pow(max(dot(n, Hv), 0.0), 50.0) * 0.18;
        float endCap = smoothstep(uHeadHalf - 3.0, uHeadHalf, abs(lq.x));
        hc *= 1.0 - endCap * 0.18;
        col = mix(col, hc, uHeadAlpha * (1.0 - smoothstep(-px, px, sdB)));
      }
    } else {
      float dS = length(q - off) - uHeadR * 0.9;
      float blur = 2.0 + height * 0.5;
      col *= 1.0 - uHeadAlpha * 0.2 * uHeadLift * (1.0 - smoothstep(-blur, blur, dS));
      float ring = abs(length(q) - uHeadR - 1.5) - 0.6;
      col = mix(col, col * 0.55, uHeadAlpha * (0.35 + 0.35 * uHeadLift) * (1.0 - smoothstep(-px, px, ring)));
    }
  }

  col = mix(col, shoulder(col), 1.0 - smoothstep(-1.0, 1.0, dOuter));
  col += (hash12(gl_FragCoord.xy + 0.37) - 0.5) / 255.0;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
