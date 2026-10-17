const HEAD = `#version 300 es
precision highp float;
precision highp int;
`;

const VIEW = `
uniform vec3 uCam;
uniform vec2 uFocal;
uniform vec2 uDepth;
uniform float uHeightPass;
uniform vec4 uHRect;

vec4 projectP(vec3 p) {
  if (uHeightPass > 0.5) {
    vec2 q = (p.xy - uHRect.xy) / max(uHRect.zw, vec2(1e-4));
    return vec4(q * 2.0 - 1.0, 0.0, 1.0);
  }
  float d = max(uCam.z - p.z, 0.05);
  return vec4((p.x - uCam.x) * uFocal.x, -(p.y - uCam.y) * uFocal.y, uDepth.x * d + uDepth.y, d);
}
`;

const NOISE = `
float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float vnoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  float a = hash12(cell);
  float b = hash12(cell + vec2(1.0, 0.0));
  float c = hash12(cell + vec2(0.0, 1.0));
  float d = hash12(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int k = 0; k < 4; k++) {
    sum += amp * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    amp *= 0.5;
  }
  return sum;
}
`;

const TEXNOISE = `
uniform sampler2D uNoise;
float tn(vec2 p) {
  return texture(uNoise, p * 0.015625).r;
}
float tw(vec2 p) {
  return texture(uNoise, p * 0.00390625).g;
}
float tf(vec2 p) {
  return texture(uNoise, p * 0.015625).b;
}
`;

const LIGHT = `
uniform sampler2D uHeight;
uniform float uHPx;
uniform float uShadowFade;
const float HMAX = 0.5;
const vec3 LIGHT_DIR = vec3(-0.3612, -0.6020, 0.7120);

vec2 hUv(vec2 p) {
  return (p - uHRect.xy) / max(uHRect.zw, vec2(1e-4));
}

float shadowAt(vec3 p) {
  vec2 dir = normalize(LIGHT_DIR.xy);
  float rise = LIGHT_DIR.z / max(length(LIGHT_DIR.xy), 1e-3);
  float occ = 0.0;
  for (int i = 1; i <= 7; i++) {
    float t = float(i) * float(i) * 0.0085 + 0.006;
    vec2 q = p.xy + dir * t;
    float lod = log2(max(1.0, t * uHPx * 0.55));
    float h = textureLod(uHeight, hUv(q), lod).r * HMAX;
    float ray = p.z + t * rise + 0.003;
    occ = max(occ, clamp((h - ray) / (0.006 + t * 0.2), 0.0, 1.0));
  }
  return occ * uShadowFade;
}

float aoAt(vec3 p) {
  float near = textureLod(uHeight, hUv(p.xy), log2(max(1.0, uHPx * 0.05))).r * HMAX;
  float far = textureLod(uHeight, hUv(p.xy), log2(max(1.0, uHPx * 0.16))).r * HMAX;
  float a = clamp((near - p.z) * 9.0, 0.0, 1.0) * 0.6 + clamp((far - p.z) * 4.0, 0.0, 1.0) * 0.4;
  return a * uShadowFade;
}

vec3 envGlint(vec3 r) {
  vec3 w = normalize(vec3(-0.42, -0.66, 0.62));
  float k = dot(r, w);
  float win = smoothstep(0.9, 0.985, k);
  float halo = smoothstep(0.55, 0.95, k) * 0.25;
  return vec3(1.0, 0.985, 0.95) * (win + halo);
}
`;

export const TABLE_VS = `${HEAD}
uniform vec3 uCam;
uniform vec2 uFocal;
out vec2 vWorld;
out vec2 vNdc;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vec2 clip = corner * 2.0 - 1.0;
  vNdc = clip;
  vWorld = vec2(uCam.x + clip.x * uCam.z / max(uFocal.x, 1e-4), uCam.y - clip.y * uCam.z / max(uFocal.y, 1e-4));
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

export const TABLE_FS = `${HEAD}
uniform vec3 uCam;
uniform vec4 uHRect;
uniform vec3 uGround;
uniform sampler2D uShade;
in vec2 vWorld;
in vec2 vNdc;
out vec4 outColor;
${TEXNOISE}
void main() {
  vec2 suv = (vWorld - uHRect.xy) / max(uHRect.zw, vec2(1e-4));
  vec2 shade = texture(uShade, suv).rg;
  float grain = tw(vWorld * 1200.0) * 0.5 + tn(vWorld * 900.0) * 0.5;
  float mottle = tf(vWorld * 1.8);
  vec3 col = uGround * (0.985 + (grain - 0.5) * 0.03 + (mottle - 0.5) * 0.035);
  float light = 1.0 - 0.04 * (vNdc.x * 0.5 - vNdc.y * 0.6) - 0.025 * dot(vNdc, vNdc);
  col *= light;
  col *= 1.0 - shade.r * 0.5;
  col *= 1.0 - shade.g * 0.32;
  outColor = vec4(col, 1.0);
}
`;

export const SHADE_VS = `${HEAD}
uniform vec4 uHRect;
out vec2 vWorld;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vWorld = uHRect.xy + corner * uHRect.zw;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SHADE_FS = `${HEAD}
${VIEW}
in vec2 vWorld;
out vec4 outColor;
${LIGHT}
void main() {
  vec3 p = vec3(vWorld, 0.0);
  outColor = vec4(shadowAt(p), aoAt(p), 0.0, 1.0);
}
`;

export const CARD_VS = `${HEAD}
layout(location = 0) in vec2 aPos;
uniform mat3 uRot;
uniform vec3 uPos;
uniform vec2 uSize;
${VIEW}
out vec2 vLocal;
out vec3 vWorld;
out vec3 vN;
void main() {
  vLocal = aPos;
  vec3 local = vec3(aPos * uSize, 0.0);
  vec3 world = uPos + uRot * local;
  vWorld = world;
  vN = uRot * vec3(0.0, 0.0, 1.0);
  gl_Position = projectP(world);
}
`;

export const CARD_FS = `${HEAD}
uniform sampler2D uFront;
uniform sampler2D uBack;
uniform vec2 uSize;
uniform float uRadius;
uniform float uMode;
uniform float uAlpha;
uniform float uDust;
uniform vec4 uDustRect;
uniform float uSeed;
uniform float uHasBack;
uniform vec4 uScrap;
${VIEW}
in vec2 vLocal;
in vec3 vWorld;
in vec3 vN;
out vec4 outColor;
${TEXNOISE}
${LIGHT}

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float boxSdf(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 p = vLocal * uSize;
  vec2 uv = vLocal + 0.5;
  float alpha = 1.0;
  vec4 tex = vec4(1.0);
  float tornBand = 0.0;
  if (uMode > 0.5 && uMode < 1.5) {
    tex = texture(uFront, uv);
    alpha = tex.a;
    if (alpha < 0.01) discard;
    tex.rgb /= max(tex.a, 1e-3);
  } else if (uMode > 2.5) {
    float sd = boxSdf(p + vec2(0.0, 0.02), uSize * 0.5 + vec2(0.0, 0.02), 0.022);
    float aa = max(fwidth(sd), 1e-5);
    float rag = (tn(vec2(p.x * 90.0, 7.0)) - 0.5) * 0.016 + (tw(vec2(p.x * 900.0, 3.0)) - 0.5) * 0.004;
    float edge = uSize.y * 0.5 - 0.008 + rag - p.y;
    float ea = max(fwidth(edge), 1e-5);
    alpha = (1.0 - smoothstep(-aa, aa, sd)) * smoothstep(-ea, ea, edge);
    tornBand = 1.0 - smoothstep(0.002, 0.009 + rag * 0.3, edge);
    if (alpha < 0.01) discard;
  } else {
    float sd = boxSdf(p, uSize * 0.5, uRadius);
    float aa = max(fwidth(sd), 1e-5);
    alpha = 1.0 - smoothstep(-aa, aa, sd);
    if (alpha < 0.01) discard;
  }
  if (uHeightPass > 0.5) {
    if (alpha < 0.5) discard;
    outColor = vec4(clamp(vWorld.z / HMAX, 0.0, 1.0), 0.0, 0.0, 1.0);
    return;
  }
  vec3 camPos = vec3(uCam.x, uCam.y, uCam.z);
  vec3 V = normalize(camPos - vWorld);
  vec3 Ng = normalize(vN);
  bool front = dot(Ng, V) >= 0.0;
  vec3 N = front ? Ng : -Ng;
  vec3 col;
  float gloss = 0.0;
  float sheen = 0.0;
  if (uMode < 0.5) {
    if (front) {
      col = texture(uFront, uv).rgb;
      float dot1 = hash12(floor(uv * vec2(900.0, 1600.0)) + uSeed);
      col *= 0.965 + dot1 * 0.05;
      float fib = tf(uv * vec2(60.0, 110.0) + uSeed);
      col *= 0.985 + fib * 0.03;
      vec2 e = min(uv, 1.0 - uv) * uSize;
      float rim = 1.0 - smoothstep(0.0, 0.012, min(e.x, e.y));
      col = mix(col, vec3(0.93, 0.9, 0.84), rim * 0.35);
      if (uDust > 0.001) {
        vec2 c = (uDustRect.xy + uDustRect.zw) * 0.5;
        vec2 hs = (uDustRect.zw - uDustRect.xy) * 0.5;
        vec2 q = (uv - c) * uSize;
        float d = boxSdf(q, hs * uSize, 0.02);
        float n = tf(uv * vec2(18.0, 30.0) + uSeed * 3.1);
        float fine = hash12(floor(uv * vec2(700.0, 1250.0)));
        float inside = 1.0 - smoothstep(-0.05, 0.025 + n * 0.04, d);
        float edgeBand = exp(-abs(d) * 50.0) * 0.6;
        float powder = clamp(inside * (0.25 + n * 0.6) + edgeBand * n, 0.0, 1.0);
        float specks = step(0.999 - 0.012 * exp(-max(d, 0.0) * 20.0), fine) * 0.5;
        float dust = clamp(powder * (0.35 + 0.65 * n) * 0.55 + specks, 0.0, 1.0) * uDust;
        col = mix(col, vec3(0.97, 0.92, 0.92), dust * 0.5);
        col = mix(col, col * vec3(1.03, 0.94, 0.96), inside * uDust * 0.35);
      }
      gloss = 0.12;
      sheen = 0.05;
    } else {
      vec2 buv = vec2(1.0 - uv.x, uv.y);
      col = uHasBack > 0.5 ? texture(uBack, buv).rgb : vec3(0.8, 0.76, 0.68);
      float fib = tf(buv * vec2(80.0, 140.0) + uSeed);
      col *= 0.97 + fib * 0.05;
      gloss = 0.03;
      sheen = 0.02;
    }
  } else if (uMode < 1.5) {
    col = tex.rgb;
    float l0 = dot(texture(uFront, uv + vec2(0.0025, 0.0)).rgb, vec3(0.33));
    float l1 = dot(texture(uFront, uv - vec2(0.0025, 0.0)).rgb, vec3(0.33));
    float l2 = dot(texture(uFront, uv + vec2(0.0, 0.003)).rgb, vec3(0.33));
    float l3 = dot(texture(uFront, uv - vec2(0.0, 0.003)).rgb, vec3(0.33));
    N = normalize(N + vec3(l1 - l0, l3 - l2, 0.0) * 2.2);
    vec2 e = min(uv, 1.0 - uv);
    float bevel = 1.0 - smoothstep(0.0, 0.06, min(e.x * uSize.x, e.y * uSize.y) * 4.0);
    col *= 1.0 - bevel * 0.12;
    gloss = 0.0;
    sheen = 0.015;
  } else {
    vec2 e = min(uv, 1.0 - uv) * uSize;
    float edgeD = min(e.x, e.y);
    float fold = smoothstep(0.0, 0.05, edgeD);
    col = vec3(0.93, 0.915, 0.87) * (0.94 + 0.06 * tf(uv * vec2(20.0, 40.0)));
    col *= 0.9 + 0.1 * fold;
    gloss = 0.06;
    sheen = 0.08;
    if (uMode > 2.5) {
      vec2 auv = vec2(0.5 + vLocal.x * uScrap.x, (uScrap.z + (vLocal.y + 0.5) * uScrap.y - uScrap.z) / max(1.0 - uScrap.z, 1e-4));
      vec3 art = texture(uFront, auv).rgb;
      col = front ? mix(art, vec3(0.99, 0.975, 0.94), 0.07) : mix(vec3(0.95, 0.94, 0.91), art, 0.15);
      col = mix(col, vec3(0.955, 0.945, 0.915) * (0.93 + 0.07 * tn(p * vec2(900.0, 140.0))), tornBand);
      gloss = 0.4;
      sheen = 0.3;
    }
  }
  float sh = shadowAt(vWorld);
  float ao = aoAt(vWorld);
  float diff = max(dot(N, LIGHT_DIR), 0.0);
  vec3 lit = col * (0.48 + 0.6 * diff * (1.0 - sh * 0.82)) * (1.0 - ao * 0.22);
  vec3 H = normalize(LIGHT_DIR + V);
  float spec = pow(max(dot(N, H), 0.0), 36.0) * gloss * (1.0 - sh);
  vec3 R = reflect(-V, N);
  lit += envGlint(R) * sheen * (1.0 - sh * 0.8) + spec;
  outColor = vec4(lit * alpha * uAlpha, alpha * uAlpha);
}
`;

export const FLAP_VS = `${HEAD}
layout(location = 0) in vec2 aUv;
uniform float uSide;
uniform vec4 uPack;
uniform vec3 uDims;
uniform float uVMin;
uniform float uTip;
uniform float uCurl;
uniform float uFlip;
uniform float uTabLift;
uniform float uPath[96];
uniform float uGrid;
uniform vec2 uRange;
${VIEW}
${NOISE}
out vec2 vUv;
out vec3 vWorld;
out vec3 vN;
out vec3 vTu;
out vec3 vTv;

float pathAt(float v) {
  float f = clamp(v, 0.0, 1.0) * 95.0;
  int i = int(floor(f));
  int j = min(i + 1, 95);
  return mix(uPath[i], uPath[j], f - float(i));
}

float pillow(float u, float v) {
  float W = uDims.x;
  float H = uDims.y;
  float h = uDims.z;
  if (v < 0.0) {
    float t = clamp(-v * H / 0.075, 0.0, 1.4);
    return h * 0.26 + pow(t, 1.7) * (0.016 + 0.03 * uTabLift);
  }
  float ex = clamp(min(u, 1.0 - u) * W / 0.085, 0.0, 1.0);
  float ey = clamp(min(v, 1.0 - v) * H / 0.06, 0.0, 1.0);
  float rx = sqrt(max(1.0 - (1.0 - ex) * (1.0 - ex), 0.0));
  float ry = sqrt(max(1.0 - (1.0 - ey) * (1.0 - ey), 0.0));
  float endT = min(v, 1.0 - v) * H;
  float crimp = mix(0.8, 1.0, smoothstep(0.06, 0.085, endT));
  float sag = 1.0 - 0.06 * (1.0 - abs(u - 0.5) * 2.0) * (1.0 - abs(v - 0.5) * 2.0);
  return h * (0.26 + 0.74 * rx * ry) * crimp * sag;
}

float flipAt(float v) {
  float f = clamp((uFlip * 1.5 - 0.5 * clamp(v, 0.0, 1.0)), 0.0, 1.0);
  return f * f * (3.0 - 2.0 * f);
}

vec3 deform(float u, float v) {
  float W = uDims.x;
  float H = uDims.y;
  float h = uDims.z;
  float s = uSide;
  float pu = pathAt(v);
  float crack = v < uTip ? 1.0 : 0.0;
  float fl = flipAt(v);
  float behind = clamp(uTip - v, 0.0, 2.0);
  float open = crack * smoothstep(0.0, 0.28, behind);
  float wob = 0.75 + 0.5 * vnoise(vec2(v * 7.0, s * 5.0 + 3.0));
  float p = uCurl * (1.0 - 0.6 * fl) * 0.135 * open * wob;
  float e = s * (u - pu) * W;
  float en = e;
  float zc = 0.0;
  if (p > 1e-5 && e < p) {
    float r = 0.016 + p * 0.22;
    float phi = 1.25 + 0.55 * smoothstep(0.0, 0.12, p);
    float sigma = p - e;
    float arc = r * phi;
    if (sigma < arc) {
      float th = sigma / r;
      en = p - r * sin(th);
      zc = r * (1.0 - cos(th));
    } else {
      float rest = sigma - arc;
      en = p - r * sin(phi) - rest * cos(phi);
      zc = r * (1.0 - cos(phi)) + rest * sin(phi);
    }
  }
  float un = pu + s * en / W;
  float zb = pillow(clamp(un, 0.0, 1.0), v) + zc;
  vec3 local = vec3((un - 0.5) * W, (v - 0.5) * H, zb);
  if (fl > 1e-4) {
    float theta = 3.14159265 * fl;
    float zh = h * 0.3;
    float a = (s > 0.0 ? (1.0 - un) : un) * W;
    float zr = zb - zh;
    float R = 0.045;
    float along;
    float up;
    vec2 nrm;
    if (a < R * theta) {
      float ph = a / R;
      along = R * sin(ph);
      up = R * (1.0 - cos(ph));
      nrm = vec2(-sin(ph), cos(ph));
    } else {
      along = R * sin(theta) + (a - R * theta) * cos(theta);
      up = R * (1.0 - cos(theta)) + (a - R * theta) * sin(theta);
      nrm = vec2(-sin(theta), cos(theta));
    }
    along += nrm.x * zr;
    up += nrm.y * zr;
    float z = zh + up;
    float droop = smoothstep(1.4, 3.14159265, theta) * smoothstep(0.0, 0.16, -along);
    z = mix(z, 0.004 + 0.006 * (1.0 - smoothstep(0.0, 0.3, -along)) + max(zc, 0.0) * 0.5, droop);
    float hx = s * 0.5 * W;
    local = vec3(hx - s * along, (v - 0.5) * H, z);
  }
  return local;
}

void main() {
  float eps = (uRange.y - uRange.x) / max(uGrid, 1.0);
  float u = mix(uRange.x, uRange.y, aUv.x);
  float v = mix(uVMin, 1.0, aUv.y);
  vec3 p0 = deform(u, v);
  vec3 pu = deform(u + eps * 0.5, v);
  vec3 pv = deform(u, v + eps * 0.5);
  vec3 tu = pu - p0;
  vec3 tv = pv - p0;
  vec2 cs = uPack.zw;
  mat3 rot = mat3(cs.x, cs.y, 0.0, -cs.y, cs.x, 0.0, 0.0, 0.0, 1.0);
  vec3 world = vec3(uPack.xy, 0.0) + rot * p0;
  vUv = vec2(u, v);
  vWorld = world;
  vTu = normalize(rot * tu + vec3(1e-6, 0.0, 0.0));
  vTv = normalize(rot * tv + vec3(0.0, 1e-6, 0.0));
  vN = normalize(cross(vTu, vTv) + vec3(0.0, 0.0, 1e-6));
  gl_Position = projectP(world);
}
`;

export const FLAP_FS = `${HEAD}
uniform sampler2D uArt;
uniform sampler2D uCrease;
uniform vec2 uCreaseTexel;
uniform float uSide;
uniform vec3 uDims;
uniform float uVMin;
uniform float uTip;
uniform float uAlpha;
uniform float uPath[96];
uniform float uTabW;
uniform float uTabCut;
uniform sampler2D uRag;
${VIEW}
${TEXNOISE}
${LIGHT}

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
in vec2 vUv;
in vec3 vWorld;
in vec3 vN;
in vec3 vTu;
in vec3 vTv;
out vec4 outColor;

float pathAt(float v) {
  float f = clamp(v, 0.0, 1.0) * 95.0;
  int i = int(floor(f));
  int j = min(i + 1, 95);
  return mix(uPath[i], uPath[j], f - float(i));
}

float boxSdf(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  float W = uDims.x;
  float H = uDims.y;
  float u = vUv.x;
  float v = vUv.y;
  float alpha = 1.0;
  if (v < 0.0) {
    if (uTabCut > 0.5) discard;
    vec2 tp = vec2((u - 0.5) * W, v * H + 0.0375 - 0.01);
    float sd = boxSdf(tp, vec2(uTabW * 0.5, 0.0375 + 0.01), 0.022);
    float aa = max(fwidth(sd), 1e-5);
    alpha *= 1.0 - smoothstep(-aa, aa, sd);
  }
  float pu = pathAt(v);
  float dRaw = (u - pu) * W;
  float fringe = 0.0;
  float hairMix = 0.0;
  if (v < uTip) {
    float tipFade = smoothstep(0.0, 0.035, uTip - v);
    vec4 rg = texture(uRag, vec2((v - uVMin) / max(1.0 - uVMin, 1e-4), uSide > 0.0 ? 0.75 : 0.25));
    float rag = (rg.r - 0.5) * 0.04 * (0.35 + 0.65 * tipFade);
    float d = uSide * (dRaw - rag);
    float band = (0.003 + rg.g * 0.011) * (0.4 + 0.6 * tipFade);
    float hairLen = band * 1.7 * rg.b;
    float aa = max(fwidth(d), 1e-5);
    float body = smoothstep(-aa * 0.7, aa * 0.7, d);
    float hairs = d < 0.0 ? (1.0 - smoothstep(hairLen * 0.6, hairLen + 1e-5, -d)) * rg.a : 0.0;
    alpha *= max(body, hairs * 0.8);
    hairMix = d < 0.0 ? 1.0 : 0.0;
    fringe = 1.0 - smoothstep(band * 0.55, band, d);
  } else {
    if (uSide > 0.0 ? dRaw < 0.0 : dRaw >= 0.0) discard;
  }
  if (alpha < 0.01) discard;
  if (uHeightPass > 0.5) {
    if (alpha < 0.5) discard;
    outColor = vec4(clamp(vWorld.z / HMAX, 0.0, 1.0), 0.0, 0.0, 1.0);
    return;
  }
  vec2 auv = vec2(u, (v - uVMin) / max(1.0 - uVMin, 1e-4));
  vec3 art = texture(uArt, auv).rgb;
  float c0 = texture(uCrease, auv).r;
  float cx = texture(uCrease, auv + vec2(uCreaseTexel.x, 0.0)).r - texture(uCrease, auv - vec2(uCreaseTexel.x, 0.0)).r;
  float cy = texture(uCrease, auv + vec2(0.0, uCreaseTexel.y)).r - texture(uCrease, auv - vec2(0.0, uCreaseTexel.y)).r;
  float micro = tn(vec2(u * W, v * H) * 260.0) - 0.5;
  vec3 camPos = vec3(uCam.x, uCam.y, uCam.z);
  vec3 V = normalize(camPos - vWorld);
  vec3 Ng = normalize(vN);
  bool front = dot(Ng, V) >= 0.0;
  vec3 bump = (vTu * (cx + micro * 0.012) + vTv * (cy + micro * 0.008)) * 3.4;
  vec3 N = normalize(Ng - bump);
  if (!front) N = -N;
  vec3 paper = vec3(0.955, 0.945, 0.915);
  vec3 col;
  float gloss;
  float env;
  if (front) {
    col = mix(art, vec3(0.99, 0.975, 0.94), 0.07);
    float screen = hash12(floor(auv * vec2(1100.0, 2000.0)));
    col *= 0.975 + screen * 0.04;
    gloss = 0.55;
    env = 0.6;
  } else {
    col = mix(paper, art * 0.85 + 0.12, 0.16);
    col *= 0.97 + 0.03 * tn(auv * 300.0);
    gloss = 0.25;
    env = 0.32;
  }
  float streak = tn(vec2(dRaw * 900.0, v * H * 140.0));
  vec3 fibre = paper * (0.93 + 0.07 * streak);
  col = mix(col, fibre, clamp(fringe, 0.0, 1.0));
  col = mix(col, paper * 0.98, hairMix);
  float sh = shadowAt(vWorld + vec3(0.0, 0.0, 0.002));
  float ao = aoAt(vWorld);
  float diff = max(dot(N, LIGHT_DIR), 0.0);
  float through = max(dot(-N, LIGHT_DIR), 0.0);
  vec3 lit = col * (0.46 + 0.62 * diff * (1.0 - sh * 0.8)) * (1.0 - ao * 0.2);
  lit += col * through * 0.22 * (front ? 0.6 : 1.0);
  vec3 Hh = normalize(LIGHT_DIR + V);
  float nh = max(dot(N, Hh), 0.0);
  float spec = (pow(nh, 22.0) * 0.16 + pow(nh, 140.0) * 0.5) * gloss * (1.0 - sh * 0.9);
  vec3 R = reflect(-V, N);
  float creaseGain = 0.6 + clamp(abs(cx) * 40.0 + abs(cy) * 40.0, 0.0, 1.6);
  lit += envGlint(R) * env * 0.42 * creaseGain * (1.0 - sh * 0.8) * (1.0 - fringe * 0.6) + spec;
  lit += (c0 - 0.5) * 0.04;
  outColor = vec4(lit * alpha * uAlpha, alpha * uAlpha);
}
`;
