export const VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const FRAGMENT = `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform float uDpr;
uniform vec3 uEye;
uniform vec3 uCenter;
uniform mat3 uRot;
uniform float uRadius;
uniform float uSpin;
uniform float uBlur;
uniform sampler2D uLabel;
uniform sampler2D uEtch;
uniform vec3 uKey;
uniform vec3 uFill;
uniform float uAlpha;
uniform float uLabelReady;
uniform float uEnd;
uniform float uWell;
uniform vec2 uView;
uniform vec2 uEnvShift;

out vec4 outColor;

const float MM = 1.0 / 60.0;

vec3 bump3(vec3 x, vec3 y0) {
  vec3 y = 1.0 - x * x;
  return clamp(y - y0, 0.0, 1.0);
}

vec3 spectral(float w) {
  float x = clamp((w - 400.0) / 300.0, 0.0, 1.0);
  if (w < 395.0 || w > 705.0) return vec3(0.0);
  vec3 c1 = vec3(3.54585104, 2.93225262, 2.41593945);
  vec3 x1 = vec3(0.69549072, 0.49228336, 0.27699880);
  vec3 y1 = vec3(0.02312639, 0.15225084, 0.52607955);
  vec3 c2 = vec3(3.90307140, 3.21182957, 3.96587128);
  vec3 x2 = vec3(0.11748627, 0.86755042, 0.66077860);
  vec3 y2 = vec3(0.84897130, 0.88445281, 0.73949448);
  return bump3(c1 * (x - x1), y1) + bump3(c2 * (x - x2), y2);
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

vec3 env(vec3 rd) {
  float z = max(rd.z, 0.04);
  vec2 q = rd.xy / z - uEnvShift;
  float lq = length(q * vec2(1.0, 1.2));
  vec3 col = mix(vec3(0.56, 0.555, 0.545), vec3(0.16, 0.16, 0.165), smoothstep(0.0, 0.32, lq));
  col *= 1.0 - 0.55 * smoothstep(0.08, 0.0, length((q - vec2(0.05, 0.05)) * vec2(1.0, 0.8)));
  vec2 b = q - vec2(-0.034, -0.04);
  vec2 rb = vec2(b.x * 0.866 + b.y * 0.5, -b.x * 0.5 + b.y * 0.866);
  float band = sdBox(rb, vec2(0.34, 0.005)) - 0.003;
  float soft = smoothstep(0.004, -0.004, band);
  float falloff = 0.8 + 0.2 * smoothstep(0.3, -0.3, rb.x);
  col = mix(col, vec3(1.5, 1.48, 1.44) * falloff, soft);
  float wide = sdBox(q - vec2(-0.32, -0.2), vec2(0.12, 0.16)) - 0.04;
  col += vec3(0.7, 0.69, 0.66) * smoothstep(0.03, -0.03, wide);
  float strip = sdBox(q - vec2(0.3, 0.02), vec2(0.025, 0.34)) - 0.01;
  col += vec3(0.55, 0.57, 0.6) * smoothstep(0.015, -0.01, strip);
  float floorShade = smoothstep(0.1, -0.4, rd.z);
  col = mix(col, vec3(0.1), floorShade);
  return col;
}

vec3 diffract(vec3 L, vec3 V, vec3 R, vec3 T, float sigma) {
  vec3 h = L + V;
  float u = abs(dot(h, R));
  float w = dot(h, T);
  float lobe = exp(-(w * w) / (sigma * sigma));
  vec3 c = vec3(0.0);
  for (int n = 1; n <= 4; n++) {
    float fn = float(n);
    c += spectral(1600.0 * u / fn) / (0.6 + fn * 0.55);
  }
  return c * lobe;
}

float band(float r, float a, float b, float aa) {
  return smoothstep(a - aa, a + aa, r) * (1.0 - smoothstep(b - aa, b + aa, r));
}

vec4 sampleBlur(sampler2D tex, vec2 p, bool mirror) {
  int count = uBlur > 0.004 ? (uBlur > 0.25 ? 18 : 9) : 1;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 18; i++) {
    if (i >= count) break;
    float o = count == 1 ? 0.0 : (float(i) / float(count - 1) - 0.5) * uBlur;
    float a = -uSpin + o;
    float c = cos(a);
    float s = sin(a);
    vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    if (mirror) q.x = -q.x;
    acc += texture(tex, q * 0.5 + 0.5);
  }
  return acc / float(count);
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec3 eye = uEye;
  vec3 dir = normalize(vec3(frag, 0.0) - eye);
  vec3 U = uRot[0];
  vec3 V = uRot[1];
  vec3 N = uRot[2];

  float shadow = 0.0;
  {
    vec3 T0 = vec3(frag, 0.0);
    vec3 sd = normalize(uKey - T0);
    float den = dot(sd, N);
    if (abs(den) > 1e-4) {
      float s = dot(uCenter - T0, N) / den;
      vec3 P = T0 + s * sd - uCenter;
      float rr = length(vec2(dot(P, U), dot(P, V))) / uRadius;
      float soft = 0.012 + max(s, 0.0) / uRadius * 0.16;
      float disc = smoothstep(1.0 + soft, 1.0 - soft, rr) * smoothstep(0.125 - soft, 0.125 + soft, rr);
      float clear = 1.0 - 0.85 * band(rr, 0.125, 0.28, soft);
      shadow += disc * clear * mix(0.2, 0.34, uWell);
    }
    vec2 c2 = uCenter.xy + (uCenter.xy - uKey.xy) * (uCenter.z / max(uKey.z - uCenter.z, 1.0)) * 0.9;
    float dc = length(frag - c2) / uRadius;
    float spread = 0.06 + uCenter.z / uRadius * 0.5;
    shadow += 0.1 * smoothstep(1.0 + spread, 0.9 - spread * 0.5, dc) * (1.0 - smoothstep(0.0, uRadius * 0.6, uCenter.z));
    shadow = min(shadow, 0.5);
  }

  vec4 surface = vec4(0.0);
  float den = dot(dir, N);
  if (abs(den) > 1e-5) {
    float t = dot(uCenter - eye, N) / den;
    vec3 H = eye + t * dir;
    vec3 d = H - uCenter;
    vec2 l = vec2(dot(d, U), dot(d, V));
    float r = length(l) / uRadius;
    float aa = max(fwidth(r), 1e-4) * 0.75;
    if (r < 1.0 + aa * 2.0 && t > 0.0) {
      vec2 p = l / uRadius;
      vec3 Vv = normalize(eye - H);
      bool labelSide = dot(N, Vv) > 0.0;
      vec3 Nf = labelSide ? N : -N;
      vec3 Rw = r > 1e-4 ? normalize(d) : U;
      vec3 Tw = cross(Nf, Rw);
      vec3 Lk = normalize(uKey - H);
      vec3 Lf = normalize(uFill - H);
      vec3 rd = reflect(-Vv, Nf);
      vec3 E = env(rd);
      float fres = 0.04 + 0.5 * pow(1.0 - max(dot(Nf, Vv), 0.0), 5.0);
      float ndk = max(dot(Nf, Lk), 0.0);
      float ndf = max(dot(Nf, Lf), 0.0);

      float rim = smoothstep(1.0 + aa, 1.0 - aa, r);
      float hole = smoothstep(7.5 * MM - aa, 7.5 * MM + aa, r);
      float metal = band(r, 17.6 * MM, 59.2 * MM, aa);
      float clearHub = band(r, 7.5 * MM, 17.6 * MM, aa);
      float clearEdge = band(r, 59.2 * MM, 1.0, aa);

      vec3 col = vec3(0.0);
      float alpha = 0.0;

      vec3 glass = E * 0.55 + vec3(0.9) * pow(max(dot(rd, normalize(uKey - H)), 0.0), 60.0);
      float stack = band(r, 16.2 * MM, 17.0 * MM, aa);
      float holeEdge = band(r, 7.5 * MM, 8.1 * MM, aa);
      float hubA = 0.05 + 0.3 * stack + 0.42 * holeEdge + fres * 0.5;
      vec3 hubC = glass * (0.9 + 0.3 * stack) + vec3(0.1) * holeEdge;

      if (labelSide) {
        vec4 lab = sampleBlur(uLabel, p, false);
        vec3 print = mix(vec3(0.86, 0.855, 0.84), lab.rgb, uLabelReady);
        float printMask = mix(metal, lab.a * metal, uLabelReady);
        vec3 lit = print * (0.7 + 0.28 * ndk + 0.12 * ndf);
        lit += E * 0.05 + vec3(1.0) * pow(max(dot(reflect(-Lk, Nf), Vv), 0.0), 24.0) * 0.08;
        vec3 under = E * vec3(0.86, 0.86, 0.88);
        vec3 metalCol = mix(under, lit, printMask);
        col = metalCol * metal;
        alpha = metal;
      } else {
        vec4 etch = sampleBlur(uEtch, p, true);
        float mirrorBand = band(r, 17.6 * MM, 23.0 * MM, aa);
        float lead = band(r, 23.0 * MM, uEnd, aa);
        float outer = band(r, uEnd, 59.2 * MM, aa);
        vec3 alum = vec3(0.92, 0.915, 0.9);
        vec3 base = E * alum;
        float density = 0.9 + 0.2 * etch.a;
        vec3 data = E * vec3(0.78, 0.77, 0.75) * density;
        data += diffract(Lk, Vv, Rw, Tw, 0.17) * 1.0;
        data += diffract(Lf, Vv, Rw, Tw, 0.12) * 0.5;
        vec3 mirror = base * (1.0 - 0.32 * etch.r) + etch.r * vec3(0.05);
        float edgeLine = band(r, 22.6 * MM, 23.2 * MM, aa) + band(r, uEnd - 0.002, uEnd + 0.004, aa) * 0.6;
        col = mirror * (mirrorBand + outer) + data * lead;
        col *= 1.0 - edgeLine * 0.14;
        float spark = etch.g * pow(max(dot(rd, Lk), 0.0), 6.0);
        col += vec3(spark * 0.7);
        col *= 1.0 - etch.b * 0.5;
        alpha = metal;
      }

      col += E * fres * 0.4 * metal;
      vec3 edgeC = glass + vec3(0.12);
      col = col + hubC * hubA * clearHub + edgeC * (0.35 + fres) * clearEdge;
      alpha = alpha + hubA * clearHub + (0.35 + fres) * clearEdge;
      alpha *= rim * hole;
      col *= rim * hole;
      surface = vec4(col, clamp(alpha, 0.0, 1.0));
    }
  }

  float sa = shadow * (1.0 - surface.a);
  vec3 rgb = surface.rgb;
  float a = surface.a + sa;
  vec3 over = max(rgb - 0.82, 0.0);
  rgb = min(rgb, 0.82) + over / (1.0 + over * 5.5);
  outColor = vec4(rgb, a) * uAlpha;
}
`;
