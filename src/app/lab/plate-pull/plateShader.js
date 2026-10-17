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

const LIGHT = `
const vec3 LIGHT_DIR = vec3(-0.42, -0.56, 0.714);
const vec3 HALF_DIR = vec3(-0.2235, -0.298, 0.928);
`;

export const QUAD_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SCENE_VS = `#version 300 es
precision highp float;
uniform mat3 uClipToWorld;
out vec2 vWorld;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vec2 clip = corner * 2.0 - 1.0;
  vWorld = (uClipToWorld * vec3(clip, 1.0)).xy;
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

export const SCENE_FS = `#version 300 es
precision highp float;
uniform sampler2D uHeight;
uniform sampler2D uInk;
uniform sampler2D uShadow;
uniform vec4 uBlock;
uniform vec2 uTexel;
uniform vec2 uRes;
uniform float uPx;
uniform vec3 uBench;
in vec2 vWorld;
out vec4 outColor;
${NOISE}
${LIGHT}

float boxSdf(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

float heightAt(vec2 uv) {
  vec4 t = texture(uHeight, uv);
  return t.r + (1.0 - t.r) * (t.g * 0.09 - 0.04);
}

vec3 bench(vec2 p) {
  float grain = fbm(vec2(p.x * 3.0, p.y * 46.0)) - 0.5;
  float fine = vnoise(p * 900.0) - 0.5;
  float cloud = fbm(p * 1.6) - 0.5;
  vec3 col = uBench * (1.0 + grain * 0.022 + fine * 0.012 + cloud * 0.03);
  return col;
}

vec3 lino(vec2 p, vec2 uv) {
  vec4 h = texture(uHeight, uv);
  float raised = h.r;
  float hc = heightAt(uv);
  float hx = heightAt(uv + vec2(uTexel.x * 1.5, 0.0)) - heightAt(uv - vec2(uTexel.x * 1.5, 0.0));
  float hy = heightAt(uv + vec2(0.0, uTexel.y * 1.5)) - heightAt(uv - vec2(0.0, uTexel.y * 1.5));
  vec3 n = normalize(vec3(-hx * 1.6, -hy * 1.6, 1.0));
  float mottle = fbm(p * 7.0) - 0.5;
  float speck = vnoise(p * 520.0) - 0.5;
  vec3 top = vec3(0.46, 0.355, 0.27) * (1.0 + mottle * 0.08 + speck * 0.05);
  float scratch = vnoise(vec2(p.x * 40.0 + p.y * 12.0, p.y * 900.0)) - 0.5;
  vec3 cut = vec3(0.76, 0.62, 0.47) * (1.0 + scratch * 0.05 + speck * 0.04);
  float weaveA = sin(p.x * 620.0) * sin(p.y * 620.0);
  float weave = smoothstep(0.1, 0.9, weaveA * 0.5 + 0.5);
  vec3 hessian = mix(vec3(0.62, 0.5, 0.36), vec3(0.74, 0.62, 0.46), weave);
  cut = mix(cut, hessian, smoothstep(0.55, 0.95, h.b) * 0.5);
  float floorShade = mix(0.9, 1.0, h.g);
  vec3 base = mix(cut * floorShade, top, smoothstep(0.35, 0.8, raised));

  float lam = clamp(dot(n, LIGHT_DIR) / LIGHT_DIR.z, 0.0, 1.6);
  base *= 0.5 + 0.5 * lam;

  float ink = texture(uInk, uv).r * smoothstep(0.4, 0.85, raised);
  float tack = vnoise(p * 240.0) * 0.6 + vnoise(p * 700.0) * 0.4;
  float film = clamp(ink * (0.92 + 0.16 * tack), 0.0, 1.0);
  vec3 inkCol = vec3(0.045, 0.04, 0.038);
  float cover = smoothstep(0.0, 0.22, film);
  vec3 col = mix(base, mix(base * 0.42 + inkCol * 0.3, inkCol, smoothstep(0.15, 0.7, film)), cover);

  vec2 bump = vec2(vnoise(p * 260.0), vnoise(p * 260.0 + 13.7)) - 0.5;
  vec3 ni = normalize(n + vec3(bump * 0.16 * film, 0.0));
  float band = dot(p - uBlock.xy, normalize(vec2(1.0, 0.62)));
  float window = exp(-pow((band + 0.12) * 3.2, 2.0)) * 0.7 + exp(-pow((band - 0.32) * 9.0, 2.0)) * 0.25;
  float spec = pow(max(dot(ni, HALF_DIR), 0.0), 90.0);
  float gloss = 0.25 * smoothstep(0.02, 0.3, film) + 0.75 * smoothstep(0.35, 1.0, film);
  col += vec3(0.82, 0.85, 0.9) * gloss * (window * 0.2 * (0.8 + 0.4 * tack) + 0.035 + spec * 0.5);
  float edge = clamp(dot(n.xy, -LIGHT_DIR.xy) * 3.0, 0.0, 1.0);
  col += vec3(0.95, 0.9, 0.82) * edge * gloss * 0.18;
  return col;
}

void main() {
  vec2 p = vWorld;
  vec2 half_ = uBlock.zw * 0.5;
  vec2 local = p - uBlock.xy;
  vec3 col = bench(p);

  float castD = boxSdf(local - vec2(0.022, 0.03), half_, 0.012);
  float soft = smoothstep(0.12, -0.04, castD) * 0.16;
  float mid = smoothstep(0.04, -0.01, castD) * 0.14;
  float contact = smoothstep(0.012, -0.002, boxSdf(local - vec2(0.004, 0.022), half_, 0.008)) * 0.28;
  col *= 1.0 - (soft + mid + contact);

  float sideD = boxSdf(local - vec2(0.0, 0.011), half_ + vec2(0.0, 0.0), 0.01);
  float sideCover = clamp(0.5 - sideD / uPx, 0.0, 1.0);
  if (sideCover > 0.0) {
    float yLayer = (local.y - half_.y) / 0.022;
    float plies = 0.5 + 0.5 * sin(yLayer * 28.0 + vnoise(vec2(p.x * 30.0, yLayer)) * 1.5);
    vec3 ply = mix(vec3(0.66, 0.55, 0.42), vec3(0.79, 0.69, 0.55), plies);
    ply *= 0.86 + 0.14 * vnoise(vec2(p.x * 160.0, yLayer * 3.0));
    col = mix(col, ply, sideCover);
  }

  float blockD = boxSdf(local, half_, 0.006);
  float cover = clamp(0.5 - blockD / uPx, 0.0, 1.0);
  if (cover > 0.0) {
    vec2 uv = local / uBlock.zw + 0.5;
    vec3 face = lino(p, uv);
    float rim = smoothstep(-0.006, -0.0005, blockD);
    vec2 dir = normalize(local / half_ + 1e-4);
    float facing = dot(dir, -LIGHT_DIR.xy / length(LIGHT_DIR.xy));
    face *= 1.0 + rim * facing * 0.22;
    col = mix(col, face, cover);
  }

  float sh = texture(uShadow, gl_FragCoord.xy / uRes).r;
  col *= 1.0 - 0.42 * sh;
  outColor = vec4(col, 1.0);
}
`;

export const SHEET_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aUv;
uniform vec2 uPaper;
uniform mat3 uRest;
uniform vec4 uFold;
uniform vec4 uCurl;
uniform vec2 uPivot;
uniform mat3 uView;
uniform vec3 uCam;
uniform float uFace;
uniform vec4 uShadowMode;
uniform vec4 uBlock;
out vec2 vUv;
out vec3 vNormal;
out float vZ;
out vec2 vRest;
out float vS;

void main() {
  vec2 local = (aUv - 0.5) * uPaper;
  vec2 rest = (uRest * vec3(local, 1.0)).xy;
  vec2 n = uFold.zw;
  float s = dot(rest - uFold.xy, n);
  float r = max(uCurl.x, 0.0005);
  float phi = uCurl.y;
  float arc = r * phi;
  vec2 pos = rest;
  float z = 0.0;
  vec2 nz = vec2(0.0, 1.0);
  if (s > 0.0) {
    float along;
    if (s < arc) {
      float th = s / r;
      along = r * sin(th);
      z = r * (1.0 - cos(th));
      nz = vec2(-sin(th), cos(th));
    } else {
      float flat_ = s - arc;
      along = r * sin(phi) + flat_ * cos(phi);
      z = r * (1.0 - cos(phi)) + flat_ * sin(phi);
      nz = vec2(-sin(phi), cos(phi));
    }
    pos = rest + n * (along - s);
  }
  vec2 d = local - uPivot;
  float sag = uCurl.w;
  z += uCurl.z + sag * dot(d, d);
  vec2 grad = mat2(uRest) * (2.0 * sag * d);
  vec3 normal = normalize(vec3(n * nz.x - grad * nz.y, nz.y));
  normal *= uFace;
  z = max(z, 0.0);

  vec2 proj;
  if (uShadowMode.z > 0.5) {
    vec2 q = pos - uBlock.xy;
    vec2 outside = max(abs(q) - uBlock.zw * 0.5, 0.0);
    float drop = smoothstep(0.0, 0.01, max(outside.x, outside.y)) * 0.014;
    proj = pos + uShadowMode.xy * (z + drop);
    vZ = z + drop;
  } else {
    proj = uCam.xy + (pos - uCam.xy) * (uCam.z / max(uCam.z - z, 0.5));
    vZ = z;
  }
  vec2 clip = (uView * vec3(proj, 1.0)).xy;
  vUv = aUv;
  vNormal = normal;
  vRest = rest;
  vS = s;
  gl_Position = vec4(clip, clamp(-z * 1.5 + 0.5, -1.0, 1.0), 1.0);
}
`;

export const SHEET_FS = `#version 300 es
precision highp float;
uniform sampler2D uFibre;
uniform sampler2D uPrint;
uniform sampler2D uHeight;
uniform sampler2D uInk;
uniform sampler2D uShadow;
uniform vec4 uBlock;
uniform vec2 uFlip;
uniform vec2 uPrintTexel;
uniform float uContact;
uniform vec2 uRes;
uniform float uShadowOn;
uniform float uPart;
in vec2 vUv;
in vec3 vNormal;
in float vZ;
in vec2 vRest;
in float vS;
out vec4 outColor;
${NOISE}
${LIGHT}

float darkOf(float d) {
  return 1.0 - exp(-4.2 * clamp(d, 0.0, 2.0));
}

void main() {
  vec2 fuv = mix(vUv, 1.0 - vUv, uFlip);
  vec4 fib = texture(uFibre, fuv);
  float alpha = fib.g;
  if (alpha < 0.01) discard;
  if (uPart > 0.5 && vS <= 0.0) discard;
  if (uPart < -0.5 && vS > 0.0) discard;
  bool under = vNormal.z < 0.0;
  vec3 n = under ? -vNormal : vNormal;
  float lam = clamp(dot(n, LIGHT_DIR) / LIGHT_DIR.z, 0.0, 1.25);
  float shade = 0.42 + 0.58 * lam;
  float fibre = fib.r - 0.5;
  float cloud = fib.b - 0.5;
  vec3 col;
  if (under) {
    vec4 pr = texture(uPrint, vUv);
    float dark = darkOf(pr.r);
    float px = texture(uPrint, vUv + vec2(uPrintTexel.x, 0.0)).r - texture(uPrint, vUv - vec2(uPrintTexel.x, 0.0)).r;
    float py = texture(uPrint, vUv + vec2(0.0, uPrintTexel.y)).r - texture(uPrint, vUv - vec2(0.0, uPrintTexel.y)).r;
    vec3 paper = vec3(0.958, 0.945, 0.918) * (1.0 + fibre * 0.07 + cloud * 0.025);
    dark *= 0.93 + 0.07 * smoothstep(-0.3, 0.3, -fibre);
    vec3 ink = vec3(0.05, 0.046, 0.043) + vec3(0.03) * smoothstep(0.1, 0.4, fibre) * dark;
    col = mix(paper, ink, dark);
    vec3 nb = normalize(n + vec3(px, py, 0.0) * 0.5);
    float lamB = clamp(dot(nb, LIGHT_DIR) / LIGHT_DIR.z, 0.0, 1.3);
    col *= 0.42 + 0.58 * mix(lam, lamB, 0.8);
    float sheen = pow(max(dot(nb, HALF_DIR), 0.0), 36.0);
    col += vec3(0.5) * sheen * dark * 0.12;
  } else {
    vec3 paper = vec3(0.962, 0.952, 0.928) * (1.0 + fibre * 0.09 + cloud * 0.035);
    float through;
    vec4 pr = texture(uPrint, vUv);
    if (pr.g > 0.5) {
      float acc = pr.r * 0.4;
      acc += texture(uPrint, vUv + vec2(uPrintTexel.x * 1.6, 0.0)).r * 0.15;
      acc += texture(uPrint, vUv - vec2(uPrintTexel.x * 1.6, 0.0)).r * 0.15;
      acc += texture(uPrint, vUv + vec2(0.0, uPrintTexel.y * 1.6)).r * 0.15;
      acc += texture(uPrint, vUv - vec2(0.0, uPrintTexel.y * 1.6)).r * 0.15;
      through = darkOf(acc);
    } else {
      vec2 buv = (vRest - uBlock.xy) / uBlock.zw + 0.5;
      float inside = step(0.0, buv.x) * step(buv.x, 1.0) * step(0.0, buv.y) * step(buv.y, 1.0);
      float raised = texture(uHeight, buv).r;
      float ink = texture(uInk, buv).r;
      through = darkOf(ink * smoothstep(0.35, 0.85, raised) * 0.8) * inside * uContact * step(vS, 0.0);
    }
    float thin = 0.2 + 0.1 * cloud;
    col = paper * (1.0 - through * thin);
    col *= shade;
    vec2 q = vRest - uBlock.xy;
    vec2 outside = abs(q) - uBlock.zw * 0.5;
    float hang = smoothstep(-0.002, 0.012, max(outside.x, outside.y)) * uContact * step(vS, 0.0);
    float lip = exp(-pow(max(outside.x, outside.y) / 0.006, 2.0)) * uContact * step(vS, 0.0);
    col *= 1.0 - hang * 0.05 - lip * 0.05;
  }
  float spec = pow(max(dot(n, HALF_DIR), 0.0), 18.0) * smoothstep(0.003, 0.03, vZ);
  col += vec3(0.07) * spec;
  if (uShadowOn > 0.5) {
    float sh = texture(uShadow, gl_FragCoord.xy / uRes).r * (1.0 - smoothstep(0.002, 0.02, vZ));
    col *= 1.0 - 0.36 * sh;
  }
  outColor = vec4(col * alpha, alpha);
}
`;

export const SHADOW_FS = `#version 300 es
precision highp float;
uniform sampler2D uFibre;
uniform vec2 uFlip;
in vec2 vUv;
in vec3 vNormal;
in float vZ;
in vec2 vRest;
in float vS;
out vec4 outColor;
void main() {
  vec2 fuv = mix(vUv, 1.0 - vUv, uFlip);
  float alpha = texture(uFibre, fuv).g;
  float k = smoothstep(0.004, 0.09, vZ) * (1.0 - smoothstep(0.14, 0.5, vZ) * 0.4);
  outColor = vec4(k * alpha, 0.0, 0.0, 1.0);
}
`;

export const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uStep;
in vec2 vUv;
out vec4 outColor;
void main() {
  float acc = texture(uSrc, vUv).r * 0.2270;
  acc += texture(uSrc, vUv + uStep * 1.3846).r * 0.3162;
  acc += texture(uSrc, vUv - uStep * 1.3846).r * 0.3162;
  acc += texture(uSrc, vUv + uStep * 3.2308).r * 0.0703;
  acc += texture(uSrc, vUv - uStep * 3.2308).r * 0.0703;
  outColor = vec4(acc, 0.0, 0.0, 1.0);
}
`;

export const SKIRT_VS = `#version 300 es
precision highp float;
uniform vec2 uPaper;
uniform mat3 uRest;
uniform mat3 uView;
uniform vec4 uSkirt;
out vec2 vLocal;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 local = (corner - 0.5) * (uPaper + vec2(uSkirt.w * 2.0));
  vec2 world = (uRest * vec3(local, 1.0)).xy + uSkirt.xy;
  vLocal = local;
  gl_Position = vec4((uView * vec3(world, 1.0)).xy, 0.0, 1.0);
}
`;

export const SKIRT_FS = `#version 300 es
precision highp float;
uniform vec2 uPaper;
uniform vec4 uSkirt;
uniform vec2 uShade;
in vec2 vLocal;
out vec4 outColor;
float boxSdf(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}
void main() {
  float d = boxSdf(vLocal, uPaper * 0.5 - vec2(0.012), 0.02);
  float w = max(uSkirt.z, 0.002);
  float a = 1.0 - smoothstep(-w, w * 1.6, d);
  float tight = 1.0 - smoothstep(-0.004, 0.006, d + 0.004);
  outColor = vec4(0.0, 0.0, 0.0, clamp(a * uShade.x + tight * uShade.y, 0.0, 0.9));
}
`;

export const TRANSFER_FS = `#version 300 es
precision highp float;
uniform sampler2D uOld;
uniform sampler2D uInk;
uniform sampler2D uHeight;
uniform mat3 uRest;
uniform vec2 uPaper;
uniform vec4 uFold;
uniform vec4 uBlock;
uniform vec4 uPull;
in vec2 vUv;
out vec4 outColor;
${NOISE}
void main() {
  vec4 old = texture(uOld, vUv);
  if (old.g > 0.5) {
    outColor = old;
    return;
  }
  vec2 local = (vUv - 0.5) * uPaper;
  vec2 w = (uRest * vec3(local, 1.0)).xy;
  float s = dot(w - uFold.xy, uFold.zw);
  if (s <= 0.0) {
    outColor = old;
    return;
  }
  vec2 buv = (w - uBlock.xy) / uBlock.zw + 0.5;
  float inside = step(0.0, buv.x) * step(buv.x, 1.0) * step(0.0, buv.y) * step(buv.y, 1.0);
  float raised = texture(uHeight, buv).r;
  float ink = texture(uInk, buv).r;
  float avail = inside * ink * smoothstep(0.35, 0.85, raised);
  float starve = clamp(uPull.y, 0.0, 1.0);
  vec2 q = local * 120.0 + uPull.zw;
  float speck = vnoise(q) * 0.55 + vnoise(q * 2.7 + 5.1) * 0.45;
  float blot = fbm(local * 7.0 + uPull.zw * 0.01);
  float streak = vnoise(vec2(dot(local, uFold.zw) * 90.0, dot(local, vec2(-uFold.w, uFold.z)) * 4.0) + uPull.zw);
  float field = speck * 0.5 + blot * 0.32 + streak * 0.18;
  float edge = starve * 0.62;
  float coverage = smoothstep(edge - 0.16, edge + 0.08, field);
  coverage = mix(coverage, 1.0, (1.0 - starve) * 0.6);
  float fraction = clamp(uPull.x * coverage, 0.0, 1.0);
  outColor = vec4(avail * fraction, 1.0, fraction, 1.0);
}
`;

export const DEPLETE_FS = `#version 300 es
precision highp float;
uniform sampler2D uInkOld;
uniform sampler2D uPaperOld;
uniform sampler2D uPaperNew;
uniform mat3 uRestInv;
uniform vec2 uPaper;
uniform vec2 uPaperPx;
uniform vec4 uBlock;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 ink = texture(uInkOld, vUv);
  vec2 w = uBlock.xy + (vUv - 0.5) * uBlock.zw;
  vec2 local = (uRestInv * vec3(w, 1.0)).xy;
  vec2 puv = local / uPaper + 0.5;
  if (puv.x > 0.0 && puv.x < 1.0 && puv.y > 0.0 && puv.y < 1.0) {
    ivec2 t = ivec2(puv * uPaperPx);
    vec4 a = texelFetch(uPaperOld, t, 0);
    vec4 b = texelFetch(uPaperNew, t, 0);
    if (b.g > 0.5 && a.g < 0.5) ink.r *= 1.0 - b.b;
  }
  outColor = ink;
}
`;

export const ROLL_FS = `#version 300 es
precision highp float;
uniform sampler2D uInkOld;
uniform vec4 uBlock;
uniform vec4 uFrom;
uniform vec4 uTo;
uniform vec2 uRoller;
uniform mat3 uSheetInv;
uniform vec2 uPaper;
uniform vec4 uSheetFold;
uniform float uSheetDown;
in vec2 vUv;
out vec4 outColor;
${NOISE}

vec2 span(float q, float d, float halfW) {
  if (abs(d) < 1e-5) return abs(q) <= halfW ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
  float a = (q - halfW) / d;
  float b = (q + halfW) / d;
  return vec2(min(a, b), max(a, b));
}

void main() {
  vec4 ink = texture(uInkOld, vUv);
  vec2 w = uBlock.xy + (vUv - 0.5) * uBlock.zw;
  if (uSheetDown > 0.5) {
    vec2 local = (uSheetInv * vec3(w, 1.0)).xy;
    vec2 puv = local / uPaper + 0.5;
    vec2 rest = w;
    float s = dot(rest - uSheetFold.xy, uSheetFold.zw);
    if (puv.x > 0.0 && puv.x < 1.0 && puv.y > 0.0 && puv.y < 1.0 && s <= 0.0) {
      outColor = ink;
      return;
    }
  }
  vec2 axis = normalize(uFrom.zw + uTo.zw);
  vec2 across = vec2(-axis.y, axis.x);
  vec2 rel = w - uFrom.xy;
  vec2 move = uTo.xy - uFrom.xy;
  float qa = dot(rel, axis);
  float qm = dot(rel, across);
  float da = dot(move, axis);
  float dm = dot(move, across);
  vec2 tm = span(qm, dm, uRoller.y);
  vec2 ta = span(qa, da, uRoller.x + 0.02);
  float lo = max(max(tm.x, ta.x), 0.0);
  float hi = min(min(tm.y, ta.y), 1.0);
  if (hi < lo) {
    outColor = ink;
    return;
  }
  float t = 0.5 * (lo + hi);
  float alongEnd = abs(qa - t * da);
  float endFade = 1.0 - smoothstep(uRoller.x - 0.035, uRoller.x + 0.01, alongEnd);
  float tack = 0.9 + 0.1 * vnoise(w * 160.0 + uTo.xy * 3.0);
  float add = 0.62 * endFade;
  ink.r = mix(ink.r, tack, add);
  outColor = ink;
}
`;

export const BRAYER_VS = `#version 300 es
precision highp float;
uniform mat3 uPose;
uniform mat3 uView;
uniform vec4 uBox;
uniform vec3 uCam;
uniform float uLift;
uniform vec2 uOffset;
out vec2 vLocal;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 local = mix(uBox.xy, uBox.zw, corner);
  vec2 world = (uPose * vec3(local, 1.0)).xy + uOffset;
  world = uCam.xy + (world - uCam.xy) * (uCam.z / max(uCam.z - uLift, 0.5));
  vLocal = local;
  gl_Position = vec4((uView * vec3(world, 1.0)).xy, 0.0, 1.0);
}
`;

export const BRAYER_FS = `#version 300 es
precision highp float;
uniform vec2 uRoller;
uniform float uSpin;
uniform float uShadow;
uniform float uAngle;
uniform float uPx;
in vec2 vLocal;
out vec4 outColor;
${NOISE}
${LIGHT}

float capsule(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

float boxSdf(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

vec3 toWorld(vec3 n) {
  float c = cos(uAngle);
  float s = sin(uAngle);
  return vec3(c * n.x - s * n.y, s * n.x + c * n.y, n.z);
}

void main() {
  vec2 p = vLocal;
  float rl = uRoller.x;
  float rr = uRoller.y;
  float roller = boxSdf(p, vec2(rl, rr), rr * 0.35);
  vec2 ax = vec2(abs(p.x), p.y);
  float frame = min(capsule(ax, vec2(rl + 0.014, 0.0), vec2(rl + 0.014, 0.06), 0.0075), capsule(ax, vec2(rl + 0.014, 0.06), vec2(0.035, 0.17), 0.0075));
  frame = min(frame, capsule(p, vec2(-0.036, 0.17), vec2(0.036, 0.17), 0.008));
  float cap = length(vec2(abs(p.x) - rl - 0.012, p.y)) - 0.016;
  float ferrule = boxSdf(p - vec2(0.0, 0.19), vec2(0.026, 0.022), 0.006);
  float handle = capsule(p, vec2(0.0, 0.215), vec2(0.0, 0.43), 0.031);
  float metal = min(min(frame, cap), ferrule);
  float all_ = min(min(roller, metal), handle);
  if (uShadow > 0.5) {
    float blurW = 0.03;
    float a = 1.0 - smoothstep(-blurW, blurW * 1.4, all_);
    outColor = vec4(0.0, 0.0, 0.0, a * 0.26);
    return;
  }
  float aa = max(uPx, fwidth(all_));
  float cover = clamp(0.5 - all_ / aa, 0.0, 1.0);
  if (cover <= 0.0) discard;
  vec3 col;
  if (handle < min(roller, metal)) {
    float ny = clamp((p.x) / 0.031, -1.0, 1.0);
    vec3 n = toWorld(vec3(ny, 0.0, sqrt(max(0.0, 1.0 - ny * ny))));
    float grain = vnoise(vec2(p.x * 300.0, p.y * 22.0)) * 0.6 + vnoise(vec2(p.x * 90.0, p.y * 8.0)) * 0.4;
    vec3 wood = mix(vec3(0.55, 0.36, 0.2), vec3(0.72, 0.52, 0.32), grain);
    float lam = clamp(dot(n, LIGHT_DIR), 0.0, 1.0);
    col = wood * (0.35 + 0.75 * lam);
    col += vec3(0.4, 0.35, 0.3) * pow(max(dot(n, HALF_DIR), 0.0), 30.0) * 0.5;
  } else if (metal < roller) {
    float ny = clamp(-metal / 0.009, 0.0, 1.0);
    vec3 n = toWorld(normalize(vec3(sign(p.x) * 0.3, 0.3, 1.0)));
    float lam = clamp(dot(n, LIGHT_DIR), 0.0, 1.0);
    col = vec3(0.62, 0.63, 0.64) * (0.45 + 0.55 * lam) + vec3(0.35) * ny * ny;
  } else {
    float ny = clamp(p.y / rr, -1.0, 1.0);
    float nzv = sqrt(max(0.0, 1.0 - ny * ny));
    vec3 n = toWorld(vec3(0.0, ny, nzv));
    float endR = smoothstep(rl - rr * 0.35, rl, abs(p.x));
    n = normalize(n + toWorld(vec3(sign(p.x) * endR, 0.0, 0.0)));
    float around = uSpin + asin(ny) * rr;
    float tack = vnoise(vec2(p.x * 120.0, around * 160.0)) * 0.6 + vnoise(vec2(p.x * 300.0, around * 420.0)) * 0.4;
    vec3 rubber = vec3(0.035, 0.033, 0.032);
    float lam = clamp(dot(n, LIGHT_DIR), 0.0, 1.0);
    col = rubber * (0.6 + 0.6 * lam);
    float spec = pow(max(dot(n, HALF_DIR), 0.0), 60.0);
    float broad = pow(max(dot(n, HALF_DIR), 0.0), 8.0);
    col += vec3(0.85, 0.88, 0.92) * (spec * (0.35 + 0.65 * tack) * 0.7 + broad * 0.05);
    col *= 1.0 - endR * 0.25;
  }
  outColor = vec4(col * cover, cover);
}
`;
