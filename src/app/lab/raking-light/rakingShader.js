export const RAKING_VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

const NOISE = `
float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 s = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += vnoise(p) * amp;
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.31;
    amp *= 0.5;
  }
  return sum / 0.9375;
}
`;

export const RAKING_BAKE = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uSrc;
uniform vec2 uSize;
uniform vec4 uDims;
uniform vec4 uPrint;
uniform vec4 uPrint2;

out vec4 outColor;
${NOISE}
float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec2 texel = 1.0 / uSize;
  float side = uDims.w;
  float seed = uDims.z;
  vec2 mm = vec2((side < 0.5 ? uv.x - 0.5 : 0.5 - uv.x) * 2.0 * uDims.x, (uv.y - 0.5) * 2.0 * uDims.y);
  vec2 tex = vec2(uv.x * 2.0 * uDims.x, uv.y * 2.0 * uDims.y);
  float h = 0.0;
  float gloss = side < 0.5 ? uPrint.w : 0.22;
  float damage = 0.0;

  if (side < 0.5) {
    vec3 src = texture(uSrc, uv).rgb;
    float lum = luma(src);
    float avg = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853982;
      avg += luma(texture(uSrc, uv + vec2(cos(a), sin(a)) * texel * 3.0).rgb);
    }
    avg *= 0.125;
    float ink = smoothstep(0.9, 0.18, lum);
    float edge = clamp((avg - lum) * 5.0, 0.0, 1.0);
    h += (ink * 0.5 + edge * 0.5) * uPrint.y;
  } else {
    vec4 m = texture(uSrc, uv);
    float mAvg = 0.0;
    for (int i = 0; i < 6; i++) {
      float a = float(i) * 1.0471976;
      mAvg += texture(uSrc, uv + vec2(cos(a), sin(a)) * texel * 1.5).r;
    }
    float inkR = mix(m.r, mAvg / 6.0, 0.5);
    h += inkR * 0.75 * uPrint.y;
    h -= m.g * 1.1;
    gloss = mix(gloss, 0.9, smoothstep(0.1, 0.7, m.g));
    float fib = fbm(tex * 6.0 + seed);
    float lossMask = smoothstep(0.15, 0.6, m.b);
    h += lossMask * ((fib - 0.62) * 1.6 - 0.25);
    damage = lossMask * (0.55 + 0.45 * fib);
    gloss *= 1.0 - lossMask * 0.85;
  }

  float c = cos(seed);
  float s = sin(seed);
  vec2 rmm = mat2(c, s, -s, c) * tex;
  float tooth = fbm(tex * 7.0 + seed * 3.1) - 0.5;
  float fibre = vnoise(rmm * vec2(2.6, 22.0)) - 0.5;
  float fibre2 = vnoise(mat2(c, -s, s, c) * tex * vec2(18.0, 3.0) + 4.0) - 0.5;
  h += (tooth * 0.75 + fibre * 0.45 + fibre2 * 0.3) * (side < 0.5 ? uPrint.x : 1.0);

  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    if (fi >= (side < 0.5 ? uPrint.z : floor(uPrint.z * 0.4))) break;
    float k = fi * 7.13 + seed * 3.7 + side * 31.0;
    vec2 p0 = (vec2(hash(vec2(k, 1.3)), hash(vec2(k, 8.9))) - 0.5) * 2.0 * uDims.xy * 0.9;
    float ang = hash(vec2(k, 4.1)) * 6.2831853;
    float len = 4.0 + hash(vec2(k, 2.7)) * 20.0;
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 q = mm - p0;
    float along = dot(q, dir);
    float bend = (hash(vec2(k, 5.5)) - 0.5) * 0.06;
    float across = dot(q, vec2(-dir.y, dir.x)) - bend * along * along * 0.5;
    float span = smoothstep(0.0, 2.0, along) * smoothstep(len, len - 4.0, along);
    float width = 0.05 + hash(vec2(k, 9.7)) * 0.035;
    float depth = 0.45 + hash(vec2(k, 3.3)) * 0.7;
    float groove = exp(-across * across / (width * width)) * span;
    float burr = exp(-pow(abs(across) - width * 1.8, 2.0) / (width * width)) * span;
    h += (burr * 0.3 - groove) * depth;
    damage += groove * 0.3 * depth;
    gloss += groove * 0.35;
  }

  if (side < 0.5 && uPrint2.w > 0.0) {
    vec2 q = mm - uPrint2.xy;
    float cs = cos(uPrint2.z);
    float sn = sin(uPrint2.z);
    q = mat2(cs, -sn, sn, cs) * q;
    vec2 e = q / vec2(6.2, 8.4);
    float r = length(e);
    float warp = (fbm(mm * 0.35 + seed) - 0.5) * 1.4;
    float core = length(q * vec2(1.0, 0.78) + vec2(0.0, 1.6));
    float ridge = 0.5 + 0.5 * cos(6.2831853 * (core + warp) / 0.46);
    ridge *= smoothstep(0.25, 0.6, vnoise(mm * 3.2 + seed));
    float press = smoothstep(1.0, 0.55, r) * smoothstep(0.2, 0.55, vnoise(mm * 0.55 + seed * 2.0) * 0.6 + 0.4 - r * 0.2);
    float mark = press * uPrint2.w;
    h += mark * (ridge - 0.3) * 0.22;
    gloss = mix(gloss, gloss * (0.25 + 0.9 * ridge), mark);
  }

  outColor = vec4(clamp(0.5 + h * 0.5, 0.0, 1.0), clamp(gloss, 0.0, 1.0), clamp(damage, 0.0, 1.0), 1.0);
}
`;

export const RAKING_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform vec2 uRes;
uniform vec4 uView;
uniform vec4 uCard;
uniform vec4 uShape;
uniform vec4 uWarp;
uniform vec4 uCrease;
uniform vec4 uFold;
uniform vec4 uCorners;
uniform vec4 uLamp;
uniform vec4 uLight;
uniform vec4 uMicro;
uniform vec4 uMat;
uniform vec4 uBounds;
uniform vec3 uInk;
uniform float uHasCard;
uniform sampler2D uFront;
uniform sampler2D uBack;
uniform sampler2D uFrontBake;
uniform sampler2D uBackBake;

out vec4 outColor;

float gCos;
float gSin;
float gCs;
float gRc;
float gRs;
float gLod;
bool gFront;
${NOISE}
vec2 toCard(vec2 w) {
  vec2 q = w - uCard.xy;
  return vec2(gRc * q.x + gRs * q.y, -gRs * q.x + gRc * q.y);
}

vec2 toBody(vec2 w) {
  vec2 c = toCard(w);
  return vec2(c.x / gCs, c.y);
}

float cornerRadius(vec2 b) {
  return b.x < 0.0 ? (b.y < 0.0 ? uCorners.x : uCorners.w) : (b.y < 0.0 ? uCorners.y : uCorners.z);
}

float cardSdf(vec2 b) {
  float r = cornerRadius(b);
  vec2 d = abs(b) - uShape.xy + r;
  float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
  float ragged = (vnoise(b * 2.1 + uWarp.z) - 0.5) * 0.12 + (vnoise(b * 8.0 + uWarp.z * 1.7) - 0.5) * 0.07;
  vec2 n = abs(b) / uShape.xy;
  float corner = smoothstep(0.75, 1.0, n.x) * smoothstep(0.85, 1.0, n.y);
  return sd + ragged * (1.0 + corner * 2.5);
}

float cheapSdf(vec2 b) {
  vec2 d = abs(b) - uShape.xy + 1.0;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - 1.0;
}

vec2 creaseFrame(vec2 b) {
  vec2 cd = vec2(cos(uCrease.z), sin(uCrease.z));
  vec2 r = b - uCrease.xy;
  return vec2(dot(r, cd), dot(r, vec2(-cd.y, cd.x)));
}

float macroH(vec2 b) {
  vec2 n = b / uShape.xy;
  float h = uShape.w * n.x * n.x + uWarp.x * n.x * n.y + 0.1 * sin(n.y * 2.3 + uWarp.z) * (0.7 + 0.3 * n.x) + 0.05 * sin(n.y * 5.1 + n.x * 1.3 + uWarp.z * 2.0);
  vec2 cf = creaseFrame(b);
  float span = smoothstep(uFold.x, uFold.x * 0.55, abs(cf.x));
  float ac = abs(cf.y);
  float wob = 1.0 + 0.35 * (vnoise(vec2(cf.x * 0.5, uWarp.z)) - 0.5);
  h += uCrease.w * span * wob * (0.7 * exp(-ac / uFold.y) + 0.12 * exp(-ac / (uFold.y * 0.3)) + 0.35 * exp(-ac / (uFold.y * 6.0)));
  float k = uFold.w;
  vec2 pc = vec2(k > 0.5 && k < 2.5 ? uShape.x : -uShape.x, k < 1.5 ? -uShape.y : uShape.y);
  vec2 dn = normalize(-sign(pc));
  float past = 5.5 - dot(b - pc, dn);
  float lifted = past > 0.0 ? past + log(1.0 + exp(-past * 4.0)) * 0.25 : log(1.0 + exp(max(past, -20.0) * 4.0)) * 0.25;
  h += uFold.z * lifted;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float t = hash(vec2(uWarp.z * 3.0 + fi, 2.0));
    float side = floor(hash(vec2(uWarp.z + fi, 5.0)) * 4.0);
    vec2 p = side < 1.0 ? vec2((t - 0.5) * 2.0 * uShape.x, -uShape.y + 0.6)
      : side < 2.0 ? vec2(uShape.x - 0.6, (t - 0.5) * 2.0 * uShape.y)
      : side < 3.0 ? vec2((t - 0.5) * 2.0 * uShape.x, uShape.y - 0.6)
      : vec2(-uShape.x + 0.6, (t - 0.5) * 2.0 * uShape.y);
    vec2 d = b - p;
    h -= 0.07 * exp(-dot(d, d) / 0.5);
  }
  return h;
}

float microH(vec2 b, bool front, float lod) {
  vec2 uv = vec2(b.x / (2.0 * uShape.x) + 0.5, b.y / (2.0 * uShape.y) + 0.5);
  float m = front ? textureLod(uFrontBake, uv, lod).r : textureLod(uBackBake, vec2(1.0 - uv.x, uv.y), lod).r;
  return (m - 0.5) * 2.0 * uMicro.x;
}

float cardZ(vec2 b, float lod, float sd) {
  float m = macroH(b);
  float bevel = smoothstep(0.0, 0.45, -sd);
  float mic = microH(b, gFront, lod) * bevel;
  float t = uShape.z * (0.35 + 0.65 * bevel);
  float wz = gFront ? m + t + mic : m + uShape.z - t - mic;
  return max(uWarp.y + b.x * gSin + wz * gCos, 0.0);
}

float sceneH(vec2 w) {
  vec2 b = toBody(w);
  float sd = cheapSdf(b);
  if (sd > 0.0) return 0.0;
  return cardZ(b, gLod + 1.0, sd);
}

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float shadow(vec3 P, vec3 lamp) {
  vec2 dxy = lamp.xy - P.xy;
  float D = length(dxy);
  if (D < 1e-3) return 1.0;
  vec2 dir = dxy / D;
  float slope = (lamp.z - P.z) / D;
  if (P.z >= uBounds.x) return 1.0;
  float tEnd = slope > 1e-4 ? min(D, (uBounds.x - P.z) / slope) : D;
  vec2 toC = uCard.xy - P.xy;
  float proj = clamp(dot(toC, dir), 0.0, tEnd);
  if (length(toC - dir * proj) > uBounds.y) return 1.0;
  float dist3 = length(lamp - P);
  float alpha = uLight.x / max(dist3, 1e-3);
  float cosE = D / max(dist3, 1e-3);
  float vis = 1.0;
  float jitter = ign(gl_FragCoord.xy);
  float tMin = uMicro.w * 1.5;
  for (int i = 0; i < 48; i++) {
    float fi = float(i);
    if (fi >= uLight.w) break;
    float f = (fi + jitter) / uLight.w;
    float t = tMin + (tEnd - tMin) * f * f;
    float h = sceneH(P.xy + dir * t);
    float rayZ = P.z + slope * t;
    float clear = (rayZ - h) * cosE;
    float spread = max(t / max(cosE, 0.05) * alpha, 1e-4);
    vis = min(vis, clamp(0.5 + 0.5 * clear / spread, 0.0, 1.0));
    if (vis <= 0.001) break;
  }
  return vis * vis * (3.0 - 2.0 * vis);
}

float ggx(float ndh, float a) {
  float a2 = a * a;
  float d = ndh * ndh * (a2 - 1.0) + 1.0;
  return a2 / max(3.14159 * d * d, 1e-5);
}

vec3 toLinear(vec3 c) {
  return pow(max(c, 0.0), vec3(2.2));
}

float deskGrain(vec2 w) {
  float warp = vnoise(vec2(w.x * 0.008, w.y * 0.035)) * 7.0 + vnoise(vec2(w.x * 0.03, w.y * 0.12)) * 1.2;
  float lines = vnoise(vec2(w.x * 0.06, (w.y + warp * 4.0) * 2.6));
  float pores = vnoise(vec2(w.x * 0.5, w.y * 9.0));
  return lines * 0.55 + pores * 0.45;
}

void main() {
  float scale = uView.w;
  vec2 css = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / scale;
  vec2 w = (css - uView.xy) / uView.z;
  float pix = 1.0 / (uView.z * scale);

  gCos = cos(uCard.w);
  gSin = sin(uCard.w);
  gCs = gCos >= 0.0 ? max(gCos, 0.035) : min(gCos, -0.035);
  gRc = cos(uCard.z);
  gRs = sin(uCard.z);
  gFront = gCos >= 0.0;
  gLod = max(uMicro.y, 0.0);

  vec3 lamp = uLamp.xyz;
  float power = uLamp.w;
  vec3 lampCol = mix(vec3(1.0, 0.42, 0.12), vec3(1.0, 0.78, 0.56), sqrt(clamp(power, 0.0, 1.0)));
  vec3 camera = vec3(0.0, 0.0, 520.0);
  vec3 ambient = vec3(0.5, 0.58, 0.75) * uMicro.z;

  vec2 body = toBody(w);
  float sd = uHasCard > 0.5 ? cardSdf(body) : 10.0;
  float cover = clamp(0.5 - sd * abs(gCs) / pix, 0.0, 1.0);

  vec3 desk = vec3(0.0);
  if (cover < 1.0) {
    float g0 = deskGrain(w);
    float e = 0.12;
    float gx = deskGrain(w + vec2(e, 0.0));
    float gy = deskGrain(w + vec2(0.0, e));
    vec3 N = normalize(vec3(-(gx - g0) / e * 0.006, -(gy - g0) / e * 0.006, 1.0));
    float rings = vnoise(vec2(w.x * 0.012, w.y * 0.22 + vnoise(vec2(w.x * 0.008, w.y * 0.035)) * 3.0));
    vec3 albedo = toLinear(mix(vec3(0.25, 0.16, 0.105), vec3(0.15, 0.09, 0.06), smoothstep(0.35, 0.7, rings))) * (0.85 + 0.3 * g0);
    vec3 P = vec3(w, 0.0);
    vec3 Lv = lamp - P;
    float d2 = dot(Lv, Lv);
    vec3 L = Lv * inversesqrt(max(d2, 1e-6));
    float E = power * uLight.z / (d2 + uLight.y * uLight.y) / (1.0 + d2 / 5200.0);
    float ndl = max(dot(N, L), 0.0);
    float vis = uHasCard > 0.5 && ndl > 0.0 ? shadow(P + vec3(0.0, 0.0, 0.002), lamp) : 1.0;
    float near = uHasCard > 0.5 ? cheapSdf(body) * abs(gCs) : 99.0;
    float lifted = 1.0 - smoothstep(0.0, 4.0, uWarp.y);
    float ao = mix(1.0, mix(0.3, 1.0, smoothstep(-0.2, 3.0, near)), lifted);
    vec3 V = normalize(camera - P);
    vec3 Hh = normalize(L + V);
    float ndh = max(dot(N, Hh), 0.0);
    float ndv = max(dot(N, V), 0.05);
    float F = 0.04 + 0.96 * pow(1.0 - max(dot(Hh, V), 0.0), 5.0);
    float spec = ggx(ndh, 0.45) * F / (4.0 * ndv) * 0.25;
    desk = (albedo * ndl + spec * ndl) * E * vis * lampCol * mix(0.55, 1.0, ao) + albedo * ambient * ao;
  }

  vec3 card = vec3(0.0);
  if (cover > 0.0) {
    float e = max(uMicro.w, pix) * 0.8;
    vec2 bx1 = toBody(w + vec2(e, 0.0));
    vec2 bx0 = toBody(w - vec2(e, 0.0));
    vec2 by1 = toBody(w + vec2(0.0, e));
    vec2 by0 = toBody(w - vec2(0.0, e));
    float h0 = cardZ(body, gLod, sd);
    float hx1 = cardZ(bx1, gLod, cardSdf(bx1));
    float hx0 = cardZ(bx0, gLod, cardSdf(bx0));
    float hy1 = cardZ(by1, gLod, cardSdf(by1));
    float hy0 = cardZ(by0, gLod, cardSdf(by0));
    vec3 N = normalize(vec3(-(hx1 - hx0) / (2.0 * e), -(hy1 - hy0) / (2.0 * e), 1.0));
    vec2 uv = vec2(body.x / (2.0 * uShape.x) + 0.5, body.y / (2.0 * uShape.y) + 0.5);
    vec2 tmm = vec2(uv.x * 2.0 * uShape.x, uv.y * 2.0 * uShape.y);
    vec4 bake;
    vec3 albedo;
    vec3 fibreCol = toLinear(vec3(0.86, 0.81, 0.7));
    float rough;
    float specW;
    if (gFront) {
      bake = textureLod(uFrontBake, uv, gLod);
      albedo = toLinear(textureLod(uFront, uv, gLod).rgb);
      rough = uMat.x;
      specW = uMat.y;
    } else {
      vec2 buv = vec2(1.0 - uv.x, uv.y);
      bake = textureLod(uBackBake, buv, gLod);
      vec4 art = textureLod(uBack, buv, gLod);
      float blot = fbm(tmm * 0.4 + uWarp.z);
      vec3 paper = toLinear(vec3(0.74, 0.67, 0.53)) * (0.86 + 0.24 * blot) * (0.94 + 0.12 * vnoise(tmm * 5.0));
      float inkAmt = smoothstep(0.08, 0.7, art.r) * (0.78 + 0.22 * vnoise(tmm * 3.0 + 2.0));
      albedo = mix(paper, toLinear(uInk), inkAmt);
      albedo = mix(albedo, toLinear(vec3(0.3, 0.3, 0.32)), smoothstep(0.1, 0.8, art.g) * 0.7);
      rough = mix(uMat.z, 0.3, smoothstep(0.1, 0.7, art.g));
      specW = mix(uMat.w, 0.6, smoothstep(0.1, 0.7, art.g));
    }
    albedo = mix(albedo, fibreCol * (0.85 + 0.25 * vnoise(tmm * 9.0)), bake.b * 0.85);
    vec2 cf = creaseFrame(body);
    float span = smoothstep(uFold.x, uFold.x * 0.7, abs(cf.x));
    float crack = span * (1.0 - smoothstep(0.0, 0.07, abs(cf.y))) * smoothstep(0.3, 0.7, vnoise(vec2(cf.x * 2.2, 3.0) + uWarp.z));
    albedo = mix(albedo, fibreCol, crack * 0.7);
    vec2 an = abs(body) / uShape.xy;
    float cornerness = smoothstep(0.7, 1.0, an.x) * smoothstep(0.82, 1.0, an.y);
    float edgeWear = smoothstep(-0.55 - cornerness * 0.9, 0.0, sd) * smoothstep(0.25, 0.75, vnoise(body * 4.5 + 9.0) + cornerness * 0.4);
    albedo = mix(albedo, fibreCol * 0.92, edgeWear * 0.85);
    specW *= bake.g * (1.0 - edgeWear);

    vec3 P = vec3(w, h0);
    vec3 Lv = lamp - P;
    float d2 = dot(Lv, Lv);
    vec3 L = Lv * inversesqrt(max(d2, 1e-6));
    float E = power * uLight.z / (d2 + uLight.y * uLight.y) / (1.0 + d2 / 5200.0);
    float ndl = max(dot(N, L), 0.0);
    float vis = ndl > 0.0 ? shadow(P + vec3(0.0, 0.0, 0.004), lamp) : 0.0;
    vec3 V = normalize(camera - P);
    vec3 Hh = normalize(L + V);
    float ndh = max(dot(N, Hh), 0.0);
    float ndv = max(dot(N, V), 0.05);
    float F = 0.04 + 0.96 * pow(1.0 - max(dot(Hh, V), 0.0), 5.0);
    float spec = ggx(ndh, rough) * F / (4.0 * ndv) * specW;
    float tilt = max(N.z, 0.0);
    card = (albedo * ndl + vec3(spec * ndl)) * E * vis * lampCol + albedo * ambient * tilt;
  }

  vec3 col = mix(desk, card, cover);
  col = 1.0 - exp(-col * uBounds.z);
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  float dither = (ign(gl_FragCoord.xy + 17.0) + ign(gl_FragCoord.yx + 3.0) - 1.0) / 255.0;
  outColor = vec4(col + dither, 1.0);
}
`;
