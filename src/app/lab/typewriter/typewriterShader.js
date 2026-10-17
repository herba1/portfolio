export const PAPER_VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const MATERIAL_FRAGMENT = `#version 300 es
precision highp float;

uniform float uTile;
uniform float uPeriod;

out vec4 outColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

vec3 noised(vec2 x, float period) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = hash12(mod(i, period));
  float b = hash12(mod(i + vec2(1.0, 0.0), period));
  float c = hash12(mod(i + vec2(0.0, 1.0), period));
  float d = hash12(mod(i + vec2(1.0, 1.0), period));
  float k1 = b - a;
  float k2 = c - a;
  float k3 = a - b - c + d;
  float v = a + k1 * u.x + k2 * u.y + k3 * u.x * u.y;
  vec2 g = du * vec2(k1 + k3 * u.y, k2 + k3 * u.x);
  return vec3(v * 2.0 - 1.0, g * 2.0);
}

vec4 fibres(vec2 q, float width, float period) {
  vec2 cell = floor(q);
  float value = 0.0;
  float tint = 0.0;
  vec2 grad = vec2(0.0);
  float w2 = width * width;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      vec2 cw = mod(c, period);
      vec2 h = hash22(cw);
      vec2 h2 = hash22(cw + 17.31);
      vec2 center = c + h;
      float ang = (h2.x - 0.5) * 1.3 + (h2.y > 0.82 ? 1.5708 * (h.x - 0.5) * 2.0 : 0.0);
      vec2 dir = vec2(cos(ang), sin(ang));
      float half_len = 0.32 + 0.4 * h2.y;
      vec2 rel = q - center;
      float t = clamp(dot(rel, dir), -half_len, half_len);
      vec2 off = rel - dir * t;
      float dist2 = dot(off, off);
      float ends = 1.0 - smoothstep(half_len * 0.55, half_len, abs(t));
      float f = exp(-dist2 / max(w2, 1e-5)) * ends;
      float sgn = h.y > 0.42 ? 1.0 : -0.7;
      value += f * sgn;
      tint += f * step(0.93, h.x) * step(h.y, 0.42);
      grad += f * (-2.0 / max(w2, 1e-5)) * off * sgn;
    }
  }
  return vec4(value, grad, tint);
}

void main() {
  vec2 q = gl_FragCoord.xy / max(uTile, 1.0) * uPeriod;
  vec3 n1 = noised(q * 0.75, uPeriod * 0.75);
  vec3 n2 = noised(q * 2.1, uPeriod * 2.1);
  vec3 n3 = noised(q * 5.6, uPeriod * 5.6);
  float form = n1.x * 0.55 + n2.x * 0.3 + n3.x * 0.15;
  vec2 formG = n1.yz * 0.75 * 0.55 + n2.yz * 2.1 * 0.3 + n3.yz * 5.6 * 0.15;
  vec4 fb = fibres(q * 1.7, 0.075, uPeriod * 1.7);
  vec4 fb2 = fibres(q * 0.85, 0.06, uPeriod * 0.85);
  float fib = fb.x + fb2.x * 0.6;
  vec2 fibG = fb.yz * 1.7 + fb2.yz * 0.85 * 0.6;
  float tint = clamp(fb.w + fb2.w, 0.0, 1.0);
  vec2 hg = formG * 0.035 + fibG * 0.0045;
  float m = clamp(form * 0.4 + fib * 0.32 - tint * 0.5, -1.0, 1.0);
  outColor = vec4(0.5 + 0.5 * m, clamp(0.5 + hg * 6.0, 0.0, 1.0), clamp(max(fb.x, 0.0), 0.0, 1.0));
}
`;

export const PAPER_FRAGMENT = `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform vec2 uBox;
uniform float uDpr;
uniform vec2 uPrint;
uniform float uPitch;
uniform vec2 uHead;
uniform float uPlatenR;
uniform float uA1;
uniform float uRc;
uniform vec4 uSheet;
uniform vec2 uCarriage;
uniform float uKnob;
uniform float uRoll;
uniform sampler2D uInk;
uniform vec4 uInkMap;
uniform vec2 uInkTexel;
uniform vec3 uEnamel;
uniform sampler2D uMaterial;
uniform float uPeriod;

out vec4 outColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float edge(float x, float w) {
  return smoothstep(-w, w, x);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float d = uPrint.y - p.y;
  float R = max(uPlatenR, 1.0);
  float X = uHead.x + (p.x - uPrint.x) / max(uPitch, 1.0);
  vec3 L = normalize(vec3(-0.66, 0.34, 0.67));

  float s = 0.0;
  float phi = 0.0;
  float below = 0.0;
  float sA1 = sin(uA1);
  if (d >= 0.0) {
    float dA = R * sA1;
    if (d <= dA) {
      phi = asin(clamp(d / R, 0.0, 1.0));
      s = R * phi;
    } else {
      float arg = sA1 + (d - dA) / max(uRc, 1.0);
      float ang = asin(clamp(arg, 0.0, 0.995));
      s = R * uA1 + uRc * (ang - uA1);
      phi = ang;
    }
  } else {
    float qd = clamp(-d / R, 0.0, 0.999);
    below = qd;
    phi = -asin(qd);
    s = R * phi;
  }
  float Y = uHead.y - s / max(uPitch, 1.0);

  float fwX = max(fwidth(X), 1e-4);
  float fwY = max(fwidth(Y), 1e-4);
  float onWrap = 1.0 - smoothstep(0.9, 0.985, below);
  float covX = edge(X - uSheet.x, fwX) * edge(uSheet.z - X, fwX);
  float covY = edge(Y - uSheet.y, fwY) * edge(uSheet.w - Y, fwY);
  float cover = covX * covY * onWrap;

  vec2 q = vec2(X, Y);
  vec4 mat = texture(uMaterial, q / uPeriod);
  float m = mat.r * 2.0 - 1.0;
  vec2 hg = (mat.gb * 2.0 - 1.0) / 6.0;
  float skip = mat.a;

  vec2 inkUv = vec2((X - uInkMap.x) * uInkMap.z, (Y - uInkMap.y) * uInkMap.w);
  vec4 ink = texture(uInk, inkUv);
  float bl = texture(uInk, inkUv - vec2(uInkTexel.x, 0.0)).g;
  float br = texture(uInk, inkUv + vec2(uInkTexel.x, 0.0)).g;
  float bt = texture(uInk, inkUv - vec2(0.0, uInkTexel.y)).g;
  float bb = texture(uInk, inkUv + vec2(0.0, uInkTexel.y)).g;
  vec2 bite = vec2(br - bl, bb - bt);

  vec3 nb = normalize(vec3(-hg.x + bite.x * 0.55, hg.y - bite.y * 0.55, 1.0));
  float cp = cos(phi);
  float sp = sin(phi);
  vec3 n = normalize(vec3(nb.x, nb.y * cp + nb.z * sp, nb.z * cp - nb.y * sp));
  float diff = max(dot(n, L), 0.0);
  float shade = 0.44 + 0.56 * diff / L.z;
  shade *= 1.0 - 0.1 * smoothstep(0.35, 0.8, phi);
  shade *= 1.0 - 0.72 * smoothstep(0.15, 0.97, below);

  vec3 cream = vec3(0.958, 0.934, 0.874);
  vec3 albedo = cream * (1.0 + m * 0.05);
  albedo *= 1.0 + (hash12(floor(p * uDpr) + 0.5) - 0.5) * 0.012;
  vec3 paperLit = albedo * shade;

  float raw = ink.r + m * 0.12;
  float a = smoothstep(0.05, 0.78, raw);
  a *= 1.0 - skip * 0.22;
  float heavy = smoothstep(0.82, 1.0, ink.r);
  vec3 inkCol = mix(vec3(0.135, 0.13, 0.15), vec3(0.05, 0.05, 0.065), heavy);
  vec3 inkLit = inkCol * (0.72 + 0.28 * shade);
  vec3 paper = mix(paperLit, inkLit, clamp(a, 0.0, 1.0) * 0.96 * cover);

  float inCar = edge(X - uCarriage.x, fwX) * edge(uCarriage.y - X, fwX);
  vec3 back = uEnamel * 0.74 * (1.0 - 0.18 * smoothstep(R, R * 9.0, d));
  vec3 bg = back * (1.0 - 0.25 * (1.0 - smoothstep(-R, R * 0.4, d)));

  float cylY = clamp(d / R, -1.0, 1.0);
  float ph = asin(cylY);
  float onCyl = 1.0 - smoothstep(0.96, 1.0, abs(d / R));
  float knobL = 1.0 - edge(X - (uCarriage.x + uKnob), fwX);
  float knobR = edge(X - (uCarriage.y - uKnob), fwX);
  float knob = clamp(knobL + knobR, 0.0, 1.0);
  float turn = ph + uRoll;
  float knurl = cos(turn * 38.0);
  vec3 cn = normalize(vec3(0.0, sin(ph) + knurl * 0.18 * knob, cos(ph)));
  float cd = max(dot(cn, L), 0.0);
  vec3 hv = normalize(L + vec3(0.0, 0.0, 1.0));
  vec3 hv2 = normalize(vec3(0.0, 0.36, 1.0));
  float spec = pow(max(dot(cn, hv2), 0.0), mix(70.0, 50.0, knob)) * mix(0.6, 0.45, knob) + pow(max(dot(cn, hv), 0.0), 8.0) * 0.05;
  vec3 rimN = normalize(vec3(0.0, sin(ph), cos(ph)));
  float sheen = pow(1.0 - abs(rimN.z), 3.0) * 0.06;
  float speck = step(0.988, hash12(floor(vec2(X * 5.0, turn * R / max(uPitch, 1.0) * 5.0))));
  vec3 rubber = vec3(0.07, 0.068, 0.072) * (1.0 + speck * 1.6);
  vec3 bakelite = vec3(0.13, 0.1, 0.085) * (1.0 + 0.12 * knurl);
  vec3 cylAlbedo = mix(rubber, bakelite, knob);
  vec3 cyl = cylAlbedo * (0.3 + 0.7 * cd / L.z) + spec + sheen;
  cyl *= 0.35 + 0.65 * (1.0 - smoothstep(0.55, 1.0, abs(cylY)));
  float ring = (1.0 - smoothstep(0.0, 0.18, abs(X - (uCarriage.x + uKnob)))) + (1.0 - smoothstep(0.0, 0.18, abs(X - (uCarriage.y - uKnob))));
  cyl = mix(cyl, vec3(0.72, 0.73, 0.74) * (0.35 + 0.65 * cd / L.z) + spec * 1.5, clamp(ring, 0.0, 1.0) * 0.85);

  vec3 under = mix(bg, cyl, onCyl * inCar);

  float paperRow = covY * onWrap;
  float rightGap = (X - uSheet.z) * uPitch;
  float leftGap = (uSheet.x - X) * uPitch;
  float drop = (1.0 - smoothstep(0.0, 26.0, rightGap)) * step(0.0, rightGap) * 0.42 + (1.0 - smoothstep(0.0, 7.0, leftGap)) * step(0.0, leftGap) * 0.16;
  under *= 1.0 - drop * paperRow;
  float topGap = (uSheet.y - Y) * uPitch;
  under *= 1.0 - (1.0 - smoothstep(0.0, 10.0, topGap)) * step(0.0, topGap) * 0.2 * covX;

  vec3 col = mix(under, paper, cover);
  float thick = (1.0 - smoothstep(0.0, 1.4, abs(X - uSheet.x) * uPitch)) * covY * onWrap;
  col = mix(col, vec3(1.0, 0.99, 0.95) * shade, thick * 0.35);

  vec2 lampAt = vec2(-0.18, -0.3) * uBox;
  float lampD = length(p - lampAt) / max(length(uBox), 1.0);
  col *= mix(1.05, 0.84, smoothstep(0.3, 1.3, lampD));

  col += (hash12(gl_FragCoord.xy + 0.37) - 0.5) / 255.0;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
