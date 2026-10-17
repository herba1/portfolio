export const NOISE = `
float lpHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float lpNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = lpHash(i);
  float b = lpHash(i + vec2(1.0, 0.0));
  float c = lpHash(i + vec2(0.0, 1.0));
  float d = lpHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float lpFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * lpNoise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return s;
}
float lpGrain(vec2 p, float seed) {
  float w = lpFbm(vec2(p.x * 3.0, p.y * 0.5) + seed * 7.13);
  float r = p.x * 21.0 + w * 6.0 + seed * 3.1;
  float g = abs(fract(r) - 0.5) * 2.0;
  return smoothstep(0.0, 0.42, g);
}
`;

const FRAME = `
varying vec2 vLp;
void lpFrame(out vec3 T, out vec3 B, out vec3 N) {
  N = normalize(vNormal);
  vec3 p = -vViewPosition;
  vec3 dp1 = dFdx(p);
  vec3 dp2 = dFdy(p);
  vec2 du1 = dFdx(vLp);
  vec2 du2 = dFdy(vLp);
  vec3 dp2perp = cross(dp2, N);
  vec3 dp1perp = cross(N, dp1);
  vec3 t = dp2perp * du1.x + dp1perp * du2.x;
  vec3 b = dp2perp * du1.y + dp1perp * du2.y;
  t -= N * dot(N, t);
  b -= N * dot(N, b);
  float lt = length(t);
  float lb = length(b);
  T = lt > 1e-10 ? t / lt : vec3(1.0, 0.0, 0.0);
  B = lb > 1e-10 ? b / lb : normalize(cross(N, T));
}
vec3 lpColor;
float lpRough;
float lpCoat;
float lpCoatRough;
vec3 lpNormal;
float lpSheen = 1.0;
`;

const VERTEX_HEAD = `
varying vec2 vLp;
`;

const SORT_HEAD = `
uniform sampler2D uGlyph;
uniform sampler2D uInkTex;
uniform vec4 uSlot;
uniform vec2 uSize;
uniform float uSeed;
uniform float uStain;
uniform vec3 uLightV;
uniform vec3 uInkCol;
${NOISE}
${FRAME}
vec3 lpGlyph(vec2 uv) {
  return texture2D(uGlyph, uSlot.xy + clamp(uv, vec2(0.002), vec2(0.998)) * uSlot.zw).rgb;
}
void lpEval() {
  vec3 T;
  vec3 B;
  vec3 N;
  lpFrame(T, B, N);
  vec3 V = normalize(vViewPosition);
  vec3 Vt = vec3(dot(V, T), dot(V, B), max(dot(V, N), 0.12));
  vec3 Lt = vec3(dot(uLightV, T), dot(uLightV, B), max(dot(uLightV, N), 0.12));
  vec2 uv = vLp;
  vec2 size = max(uSize, vec2(0.01));
  vec2 wp = uv * size;
  vec3 g = lpGlyph(uv);
  float face = smoothstep(0.36, 0.64, g.r);
  float grain = lpGrain(wp, uSeed);
  float fine = lpNoise(wp * 180.0 + uSeed) * 0.55 + lpNoise(wp * 64.0 + uSeed * 1.7) * 0.45;
  vec3 honey = vec3(0.50, 0.29, 0.12);
  vec3 wood = honey * (0.84 + 0.2 * grain + 0.08 * (fine - 0.5));
  float stainN = lpFbm(wp * 6.0 + uSeed * 3.3);
  vec3 aged = mix(wood, wood * 0.32 + vec3(0.012, 0.010, 0.010), uStain * smoothstep(0.25, 0.75, stainN + 0.25));

  float depth = 0.03;
  vec2 dive = -Vt.xy / Vt.z * depth / size;
  float wallMid = lpGlyph(uv + dive * 0.5).r;
  vec2 floorUv = uv + dive;
  vec3 gf = lpGlyph(floorUv);
  float wall = (1.0 - face) * smoothstep(0.4, 0.6, max(wallMid, gf.r));
  vec2 toLight = Lt.xy / Lt.z * depth / size;
  float shade = smoothstep(0.3, 0.7, lpGlyph(floorUv + toLight).r);
  float ao = 1.0 - 0.55 * gf.b;
  float routed = lpNoise(floorUv * size * vec2(90.0, 30.0) + uSeed);
  vec3 floorCol = honey * (0.42 + 0.12 * routed) * ao * (1.0 - 0.55 * shade);
  vec3 wallCol = honey * (0.62 + 0.16 * grain);

  float ink = texture2D(uInkTex, uSlot.xy + clamp(uv, vec2(0.002), vec2(0.998)) * uSlot.zw).r * 1.5;
  float cover = smoothstep(fine - 0.16, fine + 0.16, ink * 1.25 * (0.74 + 0.42 * grain));
  float wet = cover * smoothstep(0.25, 1.0, ink);
  float peelN = lpNoise(wp * 95.0 + uSeed * 4.0) - 0.5;
  float peelM = lpNoise(wp * 34.0 + uSeed * 2.0) - 0.5;
  vec3 top = mix(aged, uInkCol * (0.9 + 0.2 * fine), cover);

  vec2 e = vec2(1.5 / 256.0, 0.0);
  float hx = lpGlyph(uv + e.xy).g - lpGlyph(uv - e.xy).g;
  float hy = lpGlyph(uv + e.yx).g - lpGlyph(uv - e.yx).g;
  vec2 bevel = vec2(hx, hy) * (1.0 - smoothstep(0.75, 0.98, g.g)) * 1.4;
  float gx = lpGrain(wp + vec2(0.003, 0.0), uSeed) - grain;
  vec3 nTop = normalize(vec3(-bevel.x - gx * 0.06 * (1.0 - wet) + (peelN * 0.08 + peelM * 0.1) * wet, -bevel.y + (peelM * 0.08 - peelN * 0.06) * wet, 1.0));
  vec3 nWall = normalize(vec3(Vt.xy, 0.35));
  vec3 nFloor = vec3(0.0, 0.0, 1.0);

  vec3 nT = mix(mix(nFloor, nWall, wall), nTop, face);
  lpColor = mix(mix(floorCol, wallCol, wall), top, face);
  lpRough = mix(mix(0.85, 0.7, wall), mix(0.5, 0.24, cover), face);
  lpCoat = face * mix(0.25, 1.0, wet);
  lpCoatRough = mix(0.45, 0.07, wet);
  lpNormal = normalize(T * nT.x + B * nT.y + N * nT.z);
}
`;

const PAPER_HEAD = `
uniform sampler2D uPrint;
uniform float uHas;
uniform float uSeed;
uniform vec2 uSize;
uniform vec2 uTexel;
uniform float uBite;
uniform vec3 uInkCol;
uniform vec3 uPaper;
${NOISE}
${FRAME}
float lpAlpha;
float lpDepth(vec2 uv) {
  return texture2D(uPrint, uv).g * uHas;
}
void lpEval() {
  vec3 T;
  vec3 B;
  vec3 N;
  lpFrame(T, B, N);
  vec2 uv = vLp;
  vec2 wp = uv * uSize;
  float dx = min(wp.x, uSize.x - wp.x);
  float dy = min(wp.y, uSize.y - wp.y);
  float along = dx < dy ? wp.y : wp.x;
  float edgeD = min(dx, dy);
  lpAlpha = 1.0;
  if (edgeD < 0.03) {
    float deckle = 0.004 + 0.014 * lpFbm(vec2(along * 26.0, uSeed * 5.0)) + 0.004 * lpNoise(vec2(along * 260.0, uSeed));
    lpAlpha = step(deckle, edgeD);
  }
  float fib = lpNoise(wp * 70.0 + uSeed) * 0.55 + lpNoise(wp * 150.0 + uSeed * 1.3) * 0.3 + lpNoise(wp * 330.0 + uSeed * 0.7) * 0.15;
  float strand = lpNoise(vec2(wp.x * 900.0 + wp.y * 220.0, wp.y * 60.0 - wp.x * 30.0) + uSeed);
  float strand2 = lpNoise(vec2(wp.y * 860.0 - wp.x * 260.0, wp.x * 52.0) + uSeed * 2.0);
  float fibre = fib * 0.6 + max(strand, strand2) * 0.4;
  vec4 pr = texture2D(uPrint, uv) * uHas;
  float ink = clamp(pr.r, 0.0, 1.0);
  vec3 paper = uPaper * (0.975 + 0.05 * (fib - 0.5) + 0.015 * (max(strand, strand2) - 0.5));
  float edgeShade = 1.0 - 0.06 * (1.0 - smoothstep(0.0, 0.02, min(dx, dy)));
  bool front = gl_FrontFacing;
  float film = 1.0 - pow(1.0 - ink, 2.6);
  vec3 col = front ? mix(paper, uInkCol * (0.8 + 0.4 * fibre), film) : paper * (1.0 - 0.035 * ink);
  lpColor = col * edgeShade;
  vec2 e = uTexel;
  float hx = (lpDepth(uv + vec2(e.x, 0.0)) - lpDepth(uv - vec2(e.x, 0.0))) / (2.0 * e.x * uSize.x);
  float hy = (lpDepth(uv + vec2(0.0, e.y)) - lpDepth(uv - vec2(0.0, e.y))) / (2.0 * e.y * uSize.y);
  float f0 = lpNoise(wp * 300.0 + uSeed);
  float fx = lpNoise((wp + vec2(0.002, 0.0)) * 300.0 + uSeed) - f0;
  float fy = lpNoise((wp + vec2(0.0, 0.002)) * 300.0 + uSeed) - f0;
  vec2 grad = -vec2(hx, hy) * uBite + vec2(fx, fy) * 0.2 * (1.0 - ink * 0.6);
  vec3 n = normalize(N - T * grad.x - B * grad.y);
  lpNormal = front ? n : -n;
  lpRough = front ? mix(0.92, 0.86, film) : 0.94;
  lpSheen = front ? 1.0 - film : 1.0;
  lpCoat = 0.0;
  lpCoatRough = 0.5;
}
`;

function injectCommon(shader, head) {
  shader.vertexShader = VERTEX_HEAD + shader.vertexShader.replace("#include <uv_vertex>", "#include <uv_vertex>\n  vLp = uv;");
  shader.fragmentShader = shader.fragmentShader
    .replace("void main() {", head + "\nvoid main() {")
    .replace("#include <map_fragment>", "#include <map_fragment>\n  lpEval();\n  diffuseColor.rgb = lpColor;")
    .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n  roughnessFactor = lpRough;")
    .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n  normal = lpNormal;")
    .replace(
      "#include <lights_physical_fragment>",
      "#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\n  material.clearcoat = saturate(lpCoat);\n  material.clearcoatRoughness = min(max(lpCoatRough, 0.0525) + geometryRoughness, 1.0);\n#endif\n#ifdef USE_SHEEN\n  material.sheenColor *= lpSheen;\n#endif",
    );
}

export function injectSort(shader) {
  injectCommon(shader, SORT_HEAD);
}

export function injectPaper(shader) {
  injectCommon(shader, PAPER_HEAD);
  shader.fragmentShader = shader.fragmentShader.replace(
    "diffuseColor.rgb = lpColor;",
    "diffuseColor.rgb = lpColor;\n  if (lpAlpha < 0.5) discard;",
  );
}

export const PRINT_VERTEX = `
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
}
`;

export const PRINT_FRAGMENT = `
precision highp float;
in vec2 vUv;
uniform sampler2D uGlyph;
uniform sampler2D uInkTex;
uniform vec4 uRects[24];
uniform vec4 uInfo[24];
uniform int uCount;
uniform vec4 uSheet;
uniform vec4 uPress;
out vec4 outColor;
${NOISE}
void main() {
  vec2 P = uSheet.xy + vUv * uSheet.zw;
  float pl = uPress.x * (1.0 + uPress.y * P.x / 1.4 - uPress.z * P.y / 0.5 + 0.3 * (lpFbm(P * 1.6 + uPress.w) - 0.5));
  pl = clamp(pl, 0.0, 1.4);
  float deposit = 0.0;
  float depth = 0.0;
  for (int k = 0; k < 24; k++) {
    if (k >= uCount) break;
    vec4 r = uRects[k];
    vec4 info = uInfo[k];
    if (info.z < 0.5) continue;
    vec2 half_ = r.zw * 0.5;
    if (abs(P.x - r.x) > half_.x || abs(P.y - r.y) > half_.y) continue;
    float s = (P.x - (r.x - half_.x)) / max(r.z, 1e-4);
    float v = (r.y + half_.y - P.y) / max(r.w, 1e-4);
    float slot = info.x;
    vec2 origin = vec2(mod(slot, 8.0) / 8.0, floor(slot / 8.0) / 3.0);
    vec2 auv = origin + clamp(vec2(s, v), vec2(0.002), vec2(0.998)) * vec2(1.0 / 8.0, 1.0 / 3.0);
    vec3 g = texture(uGlyph, auv).rgb;
    float ink = texture(uInkTex, auv).r * 1.5;
    vec2 wp = vec2(s * r.z, v * r.w);
    float grain = mix(1.0, lpGrain(wp, info.y), 0.55 + 0.45 * smoothstep(0.45, 0.75, lpFbm(wp * vec2(4.0, 1.2) + info.y)));
    float n = lpNoise(P * 230.0 + uPress.w) * 0.5 + lpNoise(P * 80.0 + uPress.w * 1.9) * 0.5;
    float kiss = smoothstep(0.02, 0.38, pl);
    float transfer = ink * (0.5 + 0.38 * smoothstep(0.15, 0.95, pl)) * kiss;
    float cover = smoothstep(n - 0.17, n + 0.17, transfer * 1.5 * (0.7 + 0.5 * grain));
    float m = smoothstep(0.3, 0.7, g.r);
    float rim = 1.0 - smoothstep(0.55, 0.97, g.g);
    float big = smoothstep(0.35, 0.75, r.w);
    float mottle = smoothstep(0.55, 0.85, lpNoise(P * 38.0 + uPress.w * 3.0) * 0.6 + lpNoise(P * 110.0 + uPress.w) * 0.4);
    float density = 1.0 - (1.0 - grain) * (0.06 + 0.12 * big) * (1.0 - 0.5 * smoothstep(0.9, 1.4, ink)) - mottle * 0.22 * (1.0 - 0.6 * min(ink, 1.0));
    density *= 1.0 + 0.35 * rim * min(pl, 1.0);
    float body = m * cover * clamp(density, 0.0, 1.2) * (0.86 + 0.14 * min(transfer, 1.0));
    float spread = clamp(ink * pl, 0.0, 1.6);
    float halo = (1.0 - m) * smoothstep(0.5 - 0.1 * spread, 0.5, g.g) * smoothstep(0.1, 0.6, transfer) * 0.95;
    deposit = max(body, halo);
    depth = pl * (0.5 * smoothstep(0.12, 0.7, g.g) + 0.5 * smoothstep(0.03, 0.62, g.b));
    break;
  }
  outColor = vec4(clamp(deposit, 0.0, 1.0), clamp(depth * 0.72, 0.0, 1.0), 0.0, 1.0);
}
`;
