export const FLAP_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 iA;
layout(location = 2) in vec4 iB;
layout(location = 3) in vec4 iC;
uniform vec2 uRes;
uniform vec4 uCell;
uniform float uPersp;
uniform vec2 uCenter;
out vec2 vLocal;
flat out float vKind;
flat out float vSlot;
flat out vec4 vB;
flat out vec4 vC;
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
    x0 = -1.5;
    x1 = w + 1.5;
    y0 = topH - 1.0;
    y1 = botY + 1.0;
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
  vSlot = iA.w;
  vB = iB;
  vC = iC;
}
`;

export const FLAP_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vLocal;
flat in float vKind;
flat in float vSlot;
flat in vec4 vB;
flat in vec4 vC;
uniform vec4 uCell;
uniform float uDpr;
uniform float uRadius;
uniform vec2 uGrid;
uniform vec2 uTile;
uniform sampler2DArray uTiles;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
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
    float inPinY = step(topH - 1.0, L.y) * step(L.y, botY + 1.0);
    float inPinX = max(step(-1.5, L.x) * step(L.x, 0.5), step(w - 0.5, L.x) * step(L.x, w + 1.5));
    float pin = inPinY * inPinX;
    float inside = step(0.0, L.x) * step(L.x, w);
    vec3 col = mix(vec3(0.012, 0.011, 0.010), vec3(0.2, 0.19, 0.18), pin);
    float alpha = max(inside, pin);
    outColor = vec4(col * alpha, alpha);
    return;
  }
  bool isTop = vKind < 1.5 || (vKind > 2.5 && vKind < 3.5);
  float y0 = isTop ? 0.0 : botY;
  float y1 = isTop ? topH : h;
  vec4 radii = isTop ? vec4(uRadius, uRadius, 0.6, 0.6) : vec4(0.6, 0.6, uRadius, uRadius);
  float d = roundedBox(L, vec2(0.0, y0), vec2(w, y1), radii);
  float alpha = clamp(0.5 - d / max(fwidth(d), 0.0001), 0.0, 1.0);
  if (alpha <= 0.0) discard;
  float v = clamp((L.y - y0) / max(y1 - y0, 1.0), 0.0, 1.0);
  vec2 uv = clamp(L / vec2(w, h), vec2(0.5) / uTile, vec2(1.0) - vec2(0.5) / uTile);
  vec2 st = (vC.xy + uv) / uGrid;
  vec3 photo = texture(uTiles, vec3(st, vSlot)).rgb;
  float grain = hash(floor(L * uDpr) + vC.z * 31.7) - 0.5;
  vec3 col = vec3(0.018) + photo * 0.94;
  col *= 1.0 + grain * 0.05;
  if (isTop) {
    col *= 1.0 - 0.3 * smoothstep(0.62, 1.0, v) * smoothstep(0.62, 1.0, v);
    col += 0.018 * (1.0 - v) * (1.0 - v);
  } else {
    col *= 1.0 - 0.5 * exp(-v * 12.0) - 0.16 * smoothstep(0.7, 1.0, v);
  }
  if (vKind > 2.5) {
    col = col * (1.0 - vB.y) + vec3(0.95, 0.9, 0.82) * vB.w * 0.16;
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

export const COPY_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec2 iCell;
uniform vec2 uGrid;
out vec2 vUv;
void main() {
  vec2 g = (iCell + aCorner) / uGrid;
  vUv = g;
  gl_Position = vec4(g * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const COPY_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec4 uCrop;
uniform float uCurve;
out vec4 outColor;
void main() {
  vec3 c = texture(uSrc, uCrop.xy + vUv * uCrop.zw).rgb;
  c = mix(c, smoothstep(0.0, 1.0, c), uCurve);
  outColor = vec4(c, 1.0);
}
`;
