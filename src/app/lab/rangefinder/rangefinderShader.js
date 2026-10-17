export const QUAD_VS = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

const HEAD = `#version 300 es
precision highp float;

uniform sampler2D uPhoto;
uniform sampler2D uDepth;
uniform sampler2D uStatic;
uniform vec2 uRes;
uniform float uScale;
uniform vec4 uWin;
uniform float uWinR;
uniform float uBezel;
uniform float uPlate;
uniform vec4 uCrop;
uniform vec4 uFrame;
uniform vec4 uPatch;
uniform float uFocus;
uniform float uGhostK;
uniform float uLock;
uniform float uBlink;
uniform float uFade;
uniform vec2 uEye;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 hash2(vec2 p) {
  float n = hash(p);
  return vec2(n, hash(p + n + 17.17));
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

float ramp(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float sdRound(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float sdBox(vec2 p, vec2 b) {
  vec2 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

float pebble(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash2(i + g) * 0.76 + 0.12;
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash(i + g + 3.1);
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  float edge = sqrt(d2) - sqrt(d1);
  return ramp(0.0, 0.42, edge) * (0.78 + 0.22 * id);
}

vec3 leather(vec2 p) {
  float cell = 2.3 * uScale;
  vec2 q = p / cell;
  float h = pebble(q);
  float hx = pebble(q + vec2(0.18, 0.0));
  float hy = pebble(q + vec2(0.0, 0.18));
  vec3 n = normalize(vec3((h - hx) * 2.4, (h - hy) * 2.4, 1.0));
  vec3 l = normalize(vec3(-0.25, -0.7, 0.66));
  float diff = clamp(dot(n, l), 0.0, 1.0);
  float spec = pow(clamp(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 18.0);
  float mottled = 0.9 + 0.2 * vnoise(p / (38.0 * uScale));
  float base = 0.0105 * mottled;
  float shade = base * (0.35 + 0.95 * diff) * mix(0.55, 1.0, h) + spec * 0.018 * h;
  float top = ramp(uPlate + 26.0 * uScale, uPlate, p.y);
  shade *= 1.0 - 0.55 * ramp(uPlate + 7.0 * uScale, uPlate, p.y);
  shade += top * 0.004;
  return vec3(shade) * vec3(1.0, 0.97, 0.93);
}

float envChrome(vec3 r) {
  float sky = ramp(0.35, -0.85, r.y);
  float band = ramp(0.08, 0.0, abs(r.y + 0.42)) * 0.55;
  float low = ramp(0.55, 0.95, r.y) * 0.18;
  float side = ramp(0.2, 0.9, r.x) * 0.1;
  return 0.035 + 0.62 * sky * sky + band + low + side;
}

vec3 plate(vec2 p) {
  float t = clamp(p.y / max(uPlate, 1.0), 0.0, 1.0);
  float g = 0.32;
  g = mix(g, 0.78, ramp(0.0, 0.05, t));
  g = mix(g, 0.6, ramp(0.05, 0.22, t));
  g = mix(g, 0.4, ramp(0.22, 0.6, t));
  g = mix(g, 0.52, ramp(0.6, 0.82, t));
  g = mix(g, 0.2, ramp(0.86, 0.97, t));
  g = mix(g, 0.03, ramp(0.96, 1.0, t));
  float brush = vnoise(vec2(p.x / (90.0 * uScale), p.y / (0.7 * uScale))) - 0.5;
  float fine = hash(vec2(floor(p.y / max(uScale * 0.6, 0.5)), floor(p.x / (40.0 * uScale)))) - 0.5;
  g *= 1.0 + 0.09 * brush + 0.035 * fine;
  float sweep = 0.06 * ramp(0.0, 0.5, 1.0 - abs(p.x / uRes.x - 0.32) * 2.0);
  return vec3(g + sweep * (1.0 - t)) * vec3(0.94, 0.95, 0.97);
}

vec3 bezel(vec2 rel, vec2 hb, float d) {
  float t = clamp(d / max(uBezel, 1.0), 0.0, 1.0);
  float e = 1.0 * uScale;
  vec2 grad = vec2(
    sdRound(rel + vec2(e, 0.0), hb, uWinR) - sdRound(rel - vec2(e, 0.0), hb, uWinR),
    sdRound(rel + vec2(0.0, e), hb, uWinR) - sdRound(rel - vec2(0.0, e), hb, uWinR)
  );
  grad /= max(length(grad), 1e-4);
  float x = t * 2.0 - 1.0;
  float z = sqrt(max(1.0 - x * x, 0.02));
  float slope = clamp(-x / z, -3.0, 3.0);
  vec3 n = normalize(vec3(grad * slope * 0.9, 1.0));
  vec3 r = reflect(vec3(0.0, 0.0, -1.0), n);
  float c = envChrome(r);
  c *= 0.75 + 0.25 * z;
  float brushed = vnoise(vec2(atan(rel.y, rel.x) * 60.0, t * 3.0)) - 0.5;
  c *= 1.0 + 0.06 * brushed;
  return vec3(c) * vec3(0.95, 0.96, 0.98);
}

vec3 scene(vec2 uv) {
  return texture(uPhoto, uv).rgb;
}

float depthAt(vec2 uv) {
  return texture(uDepth, uv).r;
}

float dust(vec2 p) {
  float cell = 64.0 * uScale;
  vec2 g = floor(p / cell);
  float acc = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 c = g + vec2(float(x), float(y));
      float h = hash(c + 7.7);
      if (h > 0.3) continue;
      vec2 pos = (c + hash2(c + 1.3)) * cell;
      float soft = hash(c + 4.1);
      float r = mix(0.7, 2.6, soft * soft) * uScale;
      float blur = mix(0.8, 6.0, soft) * uScale;
      float d = length(p - pos);
      float k = 1.0 - ramp(r - blur * 0.2, r + blur, d);
      acc = max(acc, k * mix(0.36, 0.1, soft));
    }
  }
  return acc;
}

vec3 finderView(vec2 wp, float dEdge) {
  vec2 size = uWin.zw;
  vec2 fp = wp / size;
  vec2 c = fp - 0.5;
  vec2 ca = c * vec2(size.x / size.y, 1.0);
  float r2 = dot(ca, ca);
  vec2 fpd = 0.5 + c * (1.0 - 0.03 * r2);
  vec2 uv = uCrop.xy + fpd * uCrop.zw;
  vec2 shiftUv = uCrop.zw / size;
  float caAmt = 0.0016 * r2;
  vec3 col;
  col.r = scene(uv + c * caAmt).r;
  col.g = scene(uv).g;
  col.b = scene(uv - c * caAmt).b;
  col = col * 1.22 + 0.004;
  col *= vec3(0.985, 1.0, 1.02);

  vec2 pc = wp - uPatch.xy;
  float sdp = sdRound(pc, uPatch.zw * 0.5, 2.4 * uScale);
  float inPatch = 1.0 - ramp(-0.8 * uScale, 0.8 * uScale, sdp);
  if (inPatch > 0.0) {
    float s0 = uGhostK * (depthAt(uv) - uFocus);
    vec2 g0 = uv - vec2(s0 * shiftUv.x, 0.0);
    float s1 = uGhostK * (depthAt(g0) - uFocus);
    vec2 guv = uv - vec2(s1 * shiftUv.x, 0.0);
    vec3 ghost = scene(guv) * 1.22 + 0.004;
    vec3 tint = vec3(1.0, 0.82, 0.52);
    vec3 split = col * 0.6 + ghost * tint * 0.64 + vec3(0.006, 0.005, 0.002);
    vec3 merged = col * vec3(1.1, 1.05, 0.92) + vec3(0.003, 0.002, 0.0);
    vec3 inside = mix(split, merged, uLock * 0.85);
    float rimOut = ramp(1.4 * uScale, 0.0, abs(sdp + 0.5 * uScale));
    float rimIn = ramp(1.2 * uScale, 0.0, abs(sdp + 1.8 * uScale));
    float rimK = 1.0 - uLock * 0.88;
    inside *= 1.0 - rimOut * 0.5 * rimK;
    inside += vec3(0.05, 0.04, 0.02) * rimIn * rimK;
    col = mix(col, inside, inPatch);
  }

  vec2 fc = uFrame.xy + uFrame.zw * 0.5 + uEye;
  float fd = abs(sdBox(wp - fc, uFrame.zw * 0.5));
  float th = 0.62 * uScale;
  float line = 1.0 - ramp(th - 0.5 * uScale, th + 0.7 * uScale, fd);
  float glow = exp(-fd / (2.6 * uScale)) * 0.2;
  vec3 lineCol = vec3(1.0, 0.72, 0.32);
  col = col * (1.0 - line * 0.35) + lineCol * (line * 1.05 + glow * 0.45);

  float edge = ramp(0.0, 0.16 * min(size.x, size.y), -dEdge);
  col *= mix(0.3, 1.0, edge);
  col *= 1.0 - 0.16 * clamp(r2 * 1.6, 0.0, 1.0);
  float sheen = ramp(0.55, 0.0, length((fp - vec2(0.18, 0.08)) * vec2(1.0, 1.8)));
  col += vec3(0.012, 0.013, 0.016) * sheen;
  col *= 1.0 - 0.92 * uBlink;
  return col * uFade;
}

`;

export const STATIC_FS = HEAD + `void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 hb = uWin.zw * 0.5;
  vec2 rel = p - (uWin.xy + hb);
  float d = sdRound(rel, hb, uWinR);
  if (d <= 0.0) {
    outColor = vec4(1.0 - dust(rel + hb), 0.0, 0.0, 1.0);
    return;
  }
  vec3 col;
  if (p.y < uPlate) {
    col = plate(p);
  } else {
    col = leather(p);
  }
  float side = ramp(0.0, 26.0 * uScale, min(p.x, uRes.x - p.x));
  col *= mix(0.55, 1.0, side);
  float bottom = ramp(0.0, 14.0 * uScale, uRes.y - p.y);
  col *= mix(0.6, 1.0, bottom);
  float ao = ramp(uBezel + 10.0 * uScale, uBezel, d);
  col *= 1.0 - 0.6 * ao;
  if (d < uBezel) {
    float aa = ramp(uBezel, uBezel - 1.0 * uScale, d);
    col = mix(col, bezel(rel, hb, d), aa);
  }
  outColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

export const FINDER_FS = HEAD + `void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 hb = uWin.zw * 0.5;
  vec2 rel = p - (uWin.xy + hb);
  float d = sdRound(rel, hb, uWinR);
  vec4 baked = texelFetch(uStatic, ivec2(gl_FragCoord.xy), 0);
  vec3 col;
  if (d > 0.0) {
    col = baked.rgb;
  } else {
    float gasket = ramp(-2.2 * uScale, -1.2 * uScale, d);
    vec3 view = finderView(rel + hb, d) * baked.r;
    vec3 rubber = vec3(0.006);
    col = mix(view, rubber, gasket);
    float lip = ramp(-0.2 * uScale, -1.0 * uScale, d) * ramp(-2.4 * uScale, -1.4 * uScale, d);
    col += vec3(0.05) * lip * ramp(0.0, -hb.y, rel.y);
  }
  col = max(col, vec3(0.0));
  outColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}
`;


export const PRINT_FS = `#version 300 es
precision highp float;

uniform sampler2D uPhoto;
uniform sampler2D uDepth;
uniform vec4 uRegion;
uniform vec2 uSize;
uniform float uFocus;
uniform float uCocK;
uniform float uCocMax;
uniform float uSeed;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float cocAt(float depth) {
  return min(uCocMax, uCocK * abs(depth - uFocus));
}

void main() {
  vec2 q = gl_FragCoord.xy / uSize;
  vec2 uv = uRegion.xy + q * uRegion.zw;
  vec2 pxUv = uRegion.zw / uSize;
  float d0 = texture(uDepth, uv).r;
  float c0 = cocAt(d0);
  vec3 acc = texture(uPhoto, uv).rgb;
  float wsum = 1.0;
  float spin = hash(gl_FragCoord.xy + uSeed) * 6.2831853;
  for (int i = 0; i < 80; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / 80.0) * uCocMax;
    float a = fi * 2.39996323 + spin;
    vec2 off = vec2(cos(a), sin(a)) * r;
    vec2 suv = uv + off * pxUv;
    float sd = texture(uDepth, suv).r;
    float sc = cocAt(sd);
    if (sd < d0) sc = min(sc, c0 * 2.0);
    float w = clamp(sc - r + 1.0, 0.0, 1.0);
    float lod = log2(max(sc * 0.5, 1.0));
    acc += textureLod(uPhoto, suv, lod).rgb * w;
    wsum += w;
  }
  vec3 col = acc / max(wsum, 1e-4);
  float y = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float yp = pow(max(y, 0.0), 1.0 / 2.2);
  yp = mix(yp, smoothstep(0.03, 0.97, yp), 0.55);
  vec2 c = q - 0.5;
  yp *= 1.0 - 0.16 * dot(c, c) * 2.2;
  float g1 = hash(gl_FragCoord.xy + uSeed * 1.7) - 0.5;
  float g2 = hash(floor(gl_FragCoord.xy * 0.5) + uSeed * 3.1) - 0.5;
  float mid = 1.0 - abs(yp * 2.0 - 1.0) * 0.55;
  yp += (g1 * 0.05 + g2 * 0.045) * mid;
  yp = clamp(yp, 0.0, 1.0);
  vec3 black = vec3(0.035, 0.033, 0.031);
  vec3 paper = vec3(0.945, 0.93, 0.895);
  outColor = vec4(mix(black, paper, yp), 1.0);
}
`;
