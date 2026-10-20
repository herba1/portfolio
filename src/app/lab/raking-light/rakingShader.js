export const RAKING_VERTEX = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const RAKING_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform vec2 uRes;
uniform float uScale;
uniform vec4 uRect[3];
uniform float uLift[3];
uniform vec4 uLamp;
uniform float uBulb;
uniform float uFalloff;
uniform float uSteps;
uniform float uCell;
uniform sampler2D uAlbedo;
uniform sampler2D uHeight;
uniform sampler2D uMat;

out vec4 outColor;

const float PI = 3.14159265;

vec2 localOf(int i, vec2 p) {
  vec4 r = uRect[i];
  vec2 d = p - r.xy;
  float c = cos(r.w);
  float s = sin(r.w);
  return vec2(c * d.x + s * d.y, -s * d.x + c * d.y) / r.z;
}

vec2 atlasUv(int i, vec2 q) {
  return vec2((q.x * 0.5 + 0.5 + float(i)) / 3.0, q.y * 0.5 + 0.5);
}

float heightOf(int i, vec2 p, float spread) {
  vec2 q = localOf(i, p);
  if (abs(q.x) >= 1.0 || abs(q.y) >= 1.0) return 0.0;
  float lod = max(max(0.0, log2(uCell * 0.5 / max(uRect[i].z * uScale, 1.0))), log2(max(spread, 1.0)));
  return (textureLod(uHeight, atlasUv(i, q), lod).r + uLift[i]) * uRect[i].z / (uCell * 0.5);
}

float occlusion(int i, vec3 P, vec3 L) {
  vec4 r = uRect[i];
  vec2 seg = L.xy - P.xy;
  float segLen = max(length(seg), 0.001);
  vec2 dir = seg / segLen;
  float unit = r.z / (uCell * 0.5);
  float hMax = 14.0 * unit;
  float rise = max(L.z - P.z, 0.001);
  vec2 oc = P.xy - r.xy;
  float reach = hMax * segLen / max(rise - hMax, rise * 0.15);
  if (length(oc) > r.z * 1.42 + reach) return 1.0;
  float res = 1.0;
  float steps = uSteps;
  float prevT = 0.0;
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  for (float k = 0.0; k < 24.0; k += 1.0) {
    if (k >= steps) break;
    float h = hMax * (k + jitter) / steps;
    float t = min(h * segLen / max(rise - h, rise * 0.15), segLen);
    float above = P.z + h;
    float hf = heightOf(i, P.xy + dir * t, (t - prevT) / unit * 0.7);
    prevT = t;
    float pen = hMax / steps * 2.4 + t * uBulb * 0.5;
    res = min(res, 1.0 - smoothstep(0.0, pen, hf - above));
  }
  return res;
}

float hash2(vec2 v) {
  return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453);
}

vec3 room(vec3 r) {
  float up = clamp(r.z, 0.0, 1.0);
  vec3 c = mix(vec3(0.34, 0.33, 0.31), vec3(0.95, 0.96, 1.0), smoothstep(0.2, 0.95, up));
  float box = smoothstep(0.86, 0.97, dot(r, normalize(vec3(-0.45, -0.55, 0.7))));
  return c + vec3(1.6, 1.58, 1.52) * box;
}

vec3 toLinear(vec3 c) {
  return pow(max(c, vec3(0.0)), vec3(2.2));
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  int hit = -1;
  vec2 q = vec2(0.0);
  for (int i = 0; i < 3; i += 1) {
    vec2 lq = localOf(i, p);
    if (abs(lq.x) < 1.0 && abs(lq.y) < 1.0) {
      vec2 uv = atlasUv(i, lq);
      if (texture(uAlbedo, uv).a > 0.002) {
        hit = i;
        q = lq;
      }
    }
  }

  vec3 lampCol = vec3(1.0, 0.86, 0.68);
  vec3 L = uLamp.xyz;
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 ground = vec3(0.86, 0.835, 0.79);
  float h0 = 0.0;
  vec3 n = vec3(0.0, 0.0, 1.0);
  vec4 albedo = vec4(ground, 0.0);
  vec4 mat = vec4(0.0);
  float px = 1.0;
  vec2 stitchT = vec2(1.0, 0.0);
  float stitchAo = 1.0;
  float stitchVar = 1.0;
  float stitchSheen = 1.0;

  if (hit >= 0) {
    vec4 r = uRect[hit];
    float unit = r.z / (uCell * 0.5);
    vec2 uv = atlasUv(hit, q);
    float foot = max(1.0, uCell * 0.5 / max(r.z * uScale, 1.0));
    float lod = log2(foot);
    vec2 texel = vec2(1.0 / (3.0 * uCell), 1.0 / uCell) * foot;
    albedo = texture(uAlbedo, uv);
    mat = textureLod(uMat, uv, 0.0);
    float hl = textureLod(uHeight, uv - vec2(texel.x, 0.0), lod).r;
    float hr = textureLod(uHeight, uv + vec2(texel.x, 0.0), lod).r;
    float hu = textureLod(uHeight, uv - vec2(0.0, texel.y), lod).r;
    float hd = textureLod(uHeight, uv + vec2(0.0, texel.y), lod).r;
    h0 = (textureLod(uHeight, uv, lod).r + uLift[hit]) * unit;
    vec2 g = vec2(hr - hl, hd - hu) * 0.5 / foot;
    float c = cos(r.w);
    float s = sin(r.w);
    vec2 gs = vec2(c * g.x - s * g.y, s * g.x + c * g.y);
    gs *= mix(1.0, 7.0, smoothstep(0.97, 0.99, mat.g) * (1.0 - mat.r));
    float gl = length(gs);
    if (gl > 2.5) gs *= 2.5 / gl;
    n = normalize(vec3(-gs, 1.0));
    px = unit;
    float kind = floor(mat.a * 3.0 + 0.5);
    if (kind >= 2.0) {
      bool rim = kind > 2.5;
      bool satin = !rim && mat.g > 0.5;
      float theta = (mat.b * 255.0 - 1.0) / 253.0 * PI;
      vec2 dl = q * uCell * 0.5;
      float period = rim ? 8.0 : satin ? 4.6 : 5.0;
      vec2 Tl0 = vec2(cos(theta), sin(theta));
      float acrossC = dot(dl, vec2(-Tl0.y, Tl0.x)) / period;
      float row = floor(acrossC);
      float fa = fract(acrossC);
      float stitchLen = rim ? 1000.0 : satin ? 44.0 : 26.0;
      float stagger = rim ? 0.0 : fract(row * 0.29);
      float alongC = dot(dl, Tl0) / stitchLen + stagger;
      float stitch = floor(alongC);
      float fs = fract(alongC);
      float jit = (hash2(vec2(row, stitch)) - 0.5) * (rim ? 0.05 : 0.12);
      vec2 Tl = vec2(cos(theta + jit), sin(theta + jit));
      vec2 Ts = vec2(c * Tl.x - s * Tl.y, s * Tl.x + c * Tl.y);
      vec2 Bs = vec2(-Ts.y, Ts.x);
      float alias = smoothstep(1.4, 4.0, unit * uScale * period);
      float u2 = 2.0 * fa - 1.0;
      float prof = sqrt(max(1.0 - u2 * u2, 0.0));
      float slopeA = clamp(u2 / max(prof, 0.3), -3.0, 3.0);
      float ends = rim ? 1.0 : smoothstep(0.0, 0.07, fs) * smoothstep(1.0, 0.93, fs);
      float slopeL = rim ? 0.0 : (fs < 0.5 ? -1.0 : 1.0) * (1.0 - ends) * 0.9;
      n = normalize(n + vec3((Bs * slopeA * (rim ? 0.55 : 0.42) + Ts * slopeL * 0.5) * alias, 0.0));
      stitchT = Ts;
      stitchAo = mix(1.0, mix(0.5, 1.0, prof) * mix(0.62, 1.0, ends), alias);
      stitchVar = 1.0 + (hash2(vec2(stitch * 1.7 + 3.0, row)) - 0.5) * 0.16 * alias;
      float twist = sin((dot(dl, Tl) * 1.15 + fa * 2.2) * PI * 2.0);
      stitchSheen = 1.0 + 0.22 * twist * smoothstep(2.0, 5.0, unit * uScale * period) * prof;
      albedo.rgb *= stitchVar;
    }
  }

  vec3 P = vec3(p, h0);
  vec3 toL = L - P;
  float dist = length(toL);
  vec3 Lv = toL / dist;
  float atten = uLamp.w * uFalloff * uFalloff / (uFalloff * uFalloff + dist * dist);
  float shadow = 1.0;
  for (int i = 0; i < 3; i += 1) {
    if (shadow < 0.01) break;
    shadow *= occlusion(i, P + vec3(0.0, 0.0, 0.15), L);
  }
  float diff = max(dot(n, Lv), 0.0);
  vec3 H = normalize(Lv + V);
  float nh = max(dot(n, H), 0.0);
  vec3 base = toLinear(albedo.rgb);
  vec3 sky = vec3(0.94, 0.96, 1.0);
  float amb = 0.5;
  float lit = atten * shadow;
  vec3 col;
  vec3 groundCol = toLinear(ground) * (sky * amb + lampCol * lit * 0.95);
  if (hit < 0 || mat.a < 0.1) {
    col = groundCol;
  } else {
    float kind = floor(mat.a * 3.0 + 0.5);
    float tiltAmb = amb * (0.82 + 0.18 * n.z);
    vec3 R = reflect(-V, n);
    if (kind >= 2.0) {
      vec3 T = normalize(vec3(stitchT, 0.0));
      T = normalize(T - n * dot(T, n));
      float th = dot(T, H);
      float sheen = pow(sqrt(max(1.0 - th * th, 0.0)), mix(30.0, 110.0, mat.g)) * mix(0.14, 0.62, mat.g) * stitchSheen;
      float wrap = max((dot(n, Lv) + 0.25) / 1.25, 0.0);
      col = (base * sky * tiltAmb + (base * wrap * 1.5 + mix(base, vec3(1.0), 0.45) * sheen) * lit * lampCol) * stitchAo;
    } else if (mat.r > 0.5) {
      vec3 f0 = max(base, vec3(0.26));
      float e = mix(40.0, 900.0, mat.g);
      float spec = pow(nh, e) * (e + 8.0) / 60.0;
      float edge = smoothstep(0.995, 0.93, n.z);
      float broad = pow(nh, 10.0) * mix(0.12, 1.1, edge);
      col = base * sky * tiltAmb * 0.6 + f0 * room(R) * mix(0.025, 0.36, edge) + f0 * (spec * 1.6 + broad + diff * mix(0.12, 0.4, edge)) * lit * lampCol;
    } else {
      float e = mix(60.0, 1400.0, mat.g);
      float spec = pow(nh, e) * (e + 8.0) / 90.0;
      float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
      float glaze = pow(nh, 48.0) * smoothstep(0.97, 0.99, mat.g) * 0.32;
      vec3 refl = room(R) * (0.035 + fres * 0.6) * smoothstep(0.7, 0.95, mat.g);
      col = base * sky * tiltAmb + refl + (base * diff * 1.4 + vec3(spec + glaze) * (0.5 + fres)) * lit * lampCol;
    }
    col = mix(groundCol, col, smoothstep(0.0, 0.5, albedo.a));
  }

  vec3 mapped = vec3(1.0) - exp(-col * 1.9);
  vec3 display = pow(mapped, vec3(1.0 / 2.2));
  float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  display += grain * (1.5 / 255.0);
  outColor = vec4(display, 1.0);
}
`;
