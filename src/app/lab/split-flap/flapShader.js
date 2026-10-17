export const FLAP_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 iA;
layout(location = 2) in vec4 iB;
layout(location = 3) in vec4 iC;
layout(location = 4) in vec4 iD;
uniform vec2 uRes;
uniform vec4 uCell;
uniform float uPersp;
uniform vec2 uCenter;
out vec2 vLocal;
flat out float vKind;
flat out float vGlyph;
flat out vec4 vB;
flat out vec4 vC;
flat out vec4 vD;
void main() {
  float w = uCell.x;
  float h = uCell.y;
  float topH = uCell.z;
  float botY = uCell.w;
  float kind = iA.z;
  float x0 = 0.0;
  float x1 = w;
  float y0 = 0.0;
  float y1 = h;
  if (kind < 0.5) {
    x0 = -3.0;
    x1 = w + 3.0;
  } else if (kind < 1.5 || (kind > 2.5 && kind < 3.5)) {
    y1 = topH;
  } else {
    y0 = botY;
  }
  vec2 local = vec2(mix(x0, x1, aCorner.x), mix(y0, y1, aCorner.y));
  float hinge = (topH + botY) * 0.5;
  vec3 p = vec3(local, 0.0);
  if (kind > 2.5) {
    float th = radians(iB.x);
    float a = kind < 3.5 ? -th : 3.14159265 - th;
    float dy = local.y - hinge;
    p.y = hinge + dy * cos(a);
    p.z = dy * sin(a);
  }
  vec2 pivot = iA.xy + vec2(w * 0.5, hinge);
  vec2 o = pivot + (uCenter - pivot) * 0.16;
  float denom = max(uPersp - p.z, 1.0);
  float s = uPersp / denom;
  vec2 proj = o + (iA.xy + p.xy - o) * s;
  vec2 ndc = vec2(proj.x / max(uRes.x, 1.0) * 2.0 - 1.0, 1.0 - proj.y / max(uRes.y, 1.0) * 2.0);
  float cw = denom / max(uPersp, 1.0);
  gl_Position = vec4(ndc * cw, 0.0, cw);
  vLocal = local;
  vKind = kind;
  vGlyph = iA.w;
  vB = iB;
  vC = iC;
  vD = iD;
}
`;

export const FLAP_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vLocal;
flat in float vKind;
flat in float vGlyph;
flat in vec4 vB;
flat in vec4 vC;
flat in vec4 vD;
uniform vec4 uCell;
uniform float uDpr;
uniform float uRadius;
uniform sampler2D uAtlas;
uniform vec2 uAtlasCell;
uniform float uAtlasCols;
uniform vec2 uAtlasSize;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float roundedBox(vec2 p, vec2 b0, vec2 b1, vec4 r) {
  vec2 c = (b0 + b1) * 0.5;
  vec2 hs = (b1 - b0) * 0.5;
  vec2 q = p - c;
  float rr = q.x < 0.0 ? (q.y < 0.0 ? r.x : r.w) : (q.y < 0.0 ? r.y : r.z);
  vec2 d = abs(q) - hs + rr;
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - rr;
}

void main() {
  float w = uCell.x;
  float h = uCell.y;
  float topH = uCell.z;
  float botY = uCell.w;
  vec2 L = vLocal;
  if (vKind < 0.5) {
    float d = roundedBox(L, vec2(0.0), vec2(w, h), vec4(uRadius));
    float pa = clamp(0.5 - d / max(fwidth(d), 0.0001), 0.0, 1.0);
    float inPinY = step(topH - 1.0, L.y) * step(L.y, botY + 1.0);
    float inPinX = max(step(-1.5, L.x) * step(L.x, 1.0), step(w - 1.0, L.x) * step(L.x, w + 1.5));
    float pin = inPinY * inPinX;
    float t = clamp((L.y - topH + 1.0) / max(botY - topH + 2.0, 1.0), 0.0, 1.0);
    vec3 col = mix(vec3(0.014, 0.013, 0.012), mix(vec3(0.3, 0.29, 0.27), vec3(0.11, 0.105, 0.1), t), pin);
    float alpha = max(pa, pin);
    outColor = vec4(col * alpha, alpha);
    return;
  }
  bool isTop = vKind < 1.5 || (vKind > 2.5 && vKind < 3.5);
  float y0 = isTop ? 0.0 : botY;
  float y1 = isTop ? topH : h;
  vec4 radii = isTop ? vec4(uRadius, uRadius, 0.8, 0.8) : vec4(0.8, 0.8, uRadius, uRadius);
  float d = roundedBox(L, vec2(0.0, y0), vec2(w, y1), radii);
  float alpha = clamp(0.5 - d / max(fwidth(d), 0.0001), 0.0, 1.0);
  if (alpha <= 0.0) discard;
  float v = clamp((L.y - y0) / max(y1 - y0, 1.0), 0.0, 1.0);
  float seed = vC.a;
  float grain = hash(floor(L * uDpr) + seed * 31.7) - 0.5;
  float sheenBand = vnoise(vec2(L.x / max(w, 1.0) * 1.5 + seed * 5.0, L.y / max(h, 1.0) * 1.2));
  vec3 bg = vC.rgb * (1.0 + grain * 0.1 + (sheenBand - 0.5) * 0.12);
  float mul;
  float add;
  if (isTop) {
    mul = -0.32 * smoothstep(0.55, 1.0, v) * smoothstep(0.55, 1.0, v);
    add = 0.02 * (1.0 - v) * (1.0 - v);
  } else {
    mul = -0.62 * exp(-v * 11.0) - 0.22 * smoothstep(0.65, 1.0, v);
    add = 0.0;
  }
  vec3 col = bg * (1.0 + mul) + vec3(add * 0.9, add * 0.86, add * 0.8);
  vec2 cell = vec2(mod(vGlyph, uAtlasCols), floor(vGlyph / max(uAtlasCols, 1.0)));
  vec2 texel = cell * uAtlasCell + vec2(2.0) + clamp(L, vec2(0.0), vec2(w, h)) * uDpr;
  float ink = texture(uAtlas, texel / uAtlasSize).a;
  vec2 wp = L / max(h, 1.0) * 7.0 + vec2(seed * 13.1, seed * 7.7);
  float speck = smoothstep(0.8, 0.9, vnoise(wp * 3.4));
  float fine = step(0.975, hash(floor(L * uDpr * 0.75) + seed * 3.1));
  float patchy = smoothstep(0.5, 0.95, vnoise(wp * 0.7));
  float wear = clamp(1.0 - 0.42 * speck - 0.3 * fine - 0.1 * patchy, 0.0, 1.0);
  vec3 inkCol = vD.rgb * (1.0 + mul * 0.7) * (0.96 + grain * 0.06);
  col = mix(col, inkCol, ink * wear);
  if (vKind > 2.5) {
    col = col * (1.0 - vB.y) + vec3(0.95, 0.9, 0.82) * vB.w * 0.22;
  } else if (vKind < 1.5) {
    float g = 0.12 + 0.88 * v * v;
    col *= 1.0 - vB.z * g;
  } else {
    float k = max(vB.w, 0.01);
    float g = clamp(1.0 - v / k, 0.0, 1.0);
    col *= 1.0 - vB.z * g * g;
  }
  outColor = vec4(col * alpha, alpha);
}
`;
