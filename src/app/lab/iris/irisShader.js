export const QUAD_VS = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const PREP_FS = `#version 300 es
precision highp float;

uniform sampler2D uBase;
uniform sampler2D uDepth;
uniform float uRadius;
uniform vec2 uSize;
out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  if (uRadius < 0.01) {
    outColor = vec4(textureLod(uBase, uv, 0.0).rgb, 1.0);
    return;
  }
  float dc = texture(uDepth, uv).r;
  float lod = log2(max(uRadius * 0.2368, 1.0));
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 56; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / 56.0) * uRadius;
    float a = fi * 2.39996323;
    vec2 su = uv + vec2(cos(a), sin(a)) * r / uSize;
    float ds = texture(uDepth, su).r;
    float w = smoothstep(-0.16, -0.05, ds - dc) + 0.02;
    acc += textureLod(uBase, su, lod).rgb * w;
    wsum += w;
  }
  outColor = vec4(acc / max(wsum, 1e-4), 1.0);
}
`;

export const SPRITE_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aLight;
layout(location = 2) in vec4 aExtra;

uniform vec2 uRes;
uniform vec4 uMap;
uniform vec2 uCenter;
uniform float uOpenMax;
uniform float uOpenVis;
uniform float uCoc;
uniform float uFocus;
uniform float uK;
uniform float uBoost;
uniform float uSpike;
uniform float uSpikeLen;

out vec2 vLocal;
out vec2 vEdge;
out float vCoc;
out float vCore;
out float vEnergy;
out float vSpikeAmp;
out float vSpikeLen;
out float vSeed;
out float vTint;
out float vHue;

float cocOf(float d) {
  return clamp((d - uFocus) / 0.72, 0.0, 1.0);
}

void main() {
  vec2 c = uMap.xy + aLight.xy * uMap.zw;
  float coc = cocOf(aLight.w) * uCoc;
  float core = aExtra.x * uK * 0.55 + 0.5;
  float energy = aLight.z * uK * uK * uBoost;
  float amp = energy * uSpike * 0.008;
  float len = uSpikeLen * (0.75 + 0.5 * aExtra.y);
  float reach = amp > 0.0 ? len * log(max(amp / 0.006, 1.0)) : 0.0;
  float half_ = max(max(coc, core * 2.6) * 1.25 + 2.0, min(reach, 150.0));
  float distC = length(c - uCenter);
  vLocal = aCorner * half_;
  vEdge = (c - uCenter) / max(uOpenMax, 1.0);
  vCoc = coc;
  vCore = core;
  vEnergy = energy;
  vSpikeAmp = amp;
  vSpikeLen = len;
  vSeed = aExtra.y;
  vTint = aExtra.z;
  vHue = aExtra.w;
  if (distC > uOpenVis + max(coc, core * 2.6) * 1.25 + 2.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 p = c + vLocal;
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
}
`;

export const SPRITE_FS = `#version 300 es
precision highp float;

in vec2 vLocal;
in vec2 vEdge;
in float vCoc;
in float vCore;
in float vEnergy;
in float vSpikeAmp;
in float vSpikeLen;
in float vSeed;
in float vTint;
in float vHue;

uniform float uRot;
uniform float uCat;
uniform float uAA;
uniform float uLightScale;
uniform vec2 uShape[9];
uniform float uShapeRb;
out vec4 outColor;

const float PI = 3.14159265;
const float TAU = 6.28318531;

float aperture(vec2 q) {
  float m = -1e4;
  for (int i = 0; i < 9; i++) {
    m = max(m, length(q - uShape[i]) - uShapeRb);
  }
  return m;
}

void main() {
  vec2 d = vLocal;
  float r = length(d);
  vec3 warm = mix(vec3(1.0, 0.7, 0.42), vec3(1.0, 0.84, 0.64), vTint);
  warm = mix(warm, vec3(1.0, 0.52, 0.5), step(0.5, vHue) * step(vHue, 1.5));
  warm = mix(warm, vec3(0.62, 0.78, 1.0), step(1.5, vHue));
  vec3 col = vec3(0.0);

  float coc = max(vCoc, 0.001);
  float sigma = max(vCore * 0.62, 0.45);
  float discMix = smoothstep(vCore * 0.9, vCore * 2.4, vCoc);

  if (discMix > 0.0) {
    vec2 q = d / coc;
    float sdf = aperture(q);
    float aa = 0.7 * uAA + coc * 0.035;
    float inside = clamp(0.5 - sdf * coc / aa, 0.0, 1.0);
    vec2 o = vEdge * 0.78 * uCat;
    float rv = 1.22 * uCat;
    float cat = clamp(0.5 - (length(q - o) - rv) * coc / aa, 0.0, 1.0);
    float rn = clamp(1.0 + sdf, 0.0, 1.0);
    float rim = 0.78 + 0.5 * smoothstep(0.5, 0.97, rn);
    float onion = 1.0 + 0.07 * sin(rn * 34.0 + vSeed * 19.0) * smoothstep(5.0, 14.0, coc) * (0.4 + 0.6 * rn);
    float lobe = 1.0 - 0.18 * dot(q, (vEdge / max(length(vEdge), 1e-3))) * min(length(vEdge), 1.0);
    float area = PI * coc * coc;
    float level = vEnergy / max(area, 1.0);
    vec3 fringe = mix(vec3(1.0), vec3(0.86, 1.0, 0.92), smoothstep(0.82, 1.0, rn) * 0.6);
    col += warm * fringe * level * inside * cat * rim * onion * lobe * discMix;
  }

  if (discMix < 1.0) {
    float g = exp(-min(r * r / (2.0 * sigma * sigma), 40.0));
    col += warm * g * vEnergy / (TAU * sigma * sigma) * (1.0 - discMix);
  }

  if (vSpikeAmp > 0.0 && r > 0.2) {
    float a = atan(d.y, d.x) - uRot;
    float sector = PI / 9.0;
    float k = floor(a / sector + 0.5);
    float da = a - k * sector;
    float perp = abs(sin(da)) * r;
    float w = 0.45 * uAA + r * 0.014;
    float along = exp(-min(r / max(vSpikeLen, 0.5), 40.0)) * smoothstep(0.0, 1.5, r);
    float alt = mod(k, 2.0) < 0.5 ? 1.0 : 0.82;
    float sp = vSpikeAmp * exp(-min(perp * perp / (w * w), 40.0)) * along * alt / w;
    vec3 spikeTint = mix(warm, vec3(1.0, 0.72, 0.6), smoothstep(0.0, vSpikeLen * 4.0, r) * 0.5);
    col += spikeTint * sp;
  }

  outColor = vec4(col * uLightScale, 1.0);
}
`;

export const COMPOSE_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;

uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uRl;
uniform float uPx;
uniform float uRing;
uniform vec2 uBladeC[9];
uniform vec2 uBladeN[9];
uniform float uRb;
uniform float uSpriteScale;
uniform vec4 uMap;
uniform float uK;
uniform float uCoc;
uniform float uFocus;
uniform float uExposure;
uniform float uVig;
uniform float uFade;
uniform float uLightInv;
uniform vec3 uSpill;
uniform float uRadii[6];
uniform sampler2DArray uLevels;
uniform sampler2D uDepth;
uniform sampler2D uSprites;
out vec4 outColor;

const float PI = 3.14159265;
const float TAU = 6.28318531;
const vec3 LIGHT = vec3(-0.5, -0.62, 0.6);

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

float cocOf(float d) {
  return clamp((d - uFocus) / 0.72, 0.0, 1.0);
}

vec3 photo(vec2 p) {
  vec2 uv = clamp((p - uMap.xy) / uMap.zw, vec2(0.001), vec2(0.999));
  float d = texture(uDepth, uv).r;
  float cocPh = cocOf(d) * uCoc / max(uK, 0.01);
  float layer = 5.0;
  float f = 0.0;
  for (int i = 0; i < 5; i++) {
    if (cocPh < uRadii[i + 1]) {
      layer = float(i);
      f = (cocPh - uRadii[i]) / max(uRadii[i + 1] - uRadii[i], 1e-3);
      break;
    }
  }
  vec3 a = texture(uLevels, vec3(uv, layer)).rgb;
  vec3 b = texture(uLevels, vec3(uv, min(layer + 1.0, 5.0))).rgb;
  vec3 col = mix(a, b, clamp(f, 0.0, 1.0));
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col * vec3(0.97, 0.985, 1.02), col * vec3(1.04, 1.0, 0.94), smoothstep(0.02, 0.5, lum));
  vec3 lights = texture(uSprites, gl_FragCoord.xy * uSpriteScale / uRes).rgb * uLightInv;
  vec2 rel = (p - uCenter) / max(uRl * 0.645, 1.0);
  float vig = 1.0 - uVig * smoothstep(0.25, 1.1, dot(rel, rel));
  return (col + lights) * uExposure * vig;
}

float spec(vec3 n, float power) {
  vec3 h = normalize(normalize(LIGHT) + vec3(0.0, 0.0, 1.0));
  return pow(max(dot(n, h), 0.0), power);
}

vec3 bladeShade(int j, vec2 q, float e, vec2 grad, float rr, float toOpen) {
  vec2 n = uBladeN[j];
  vec2 t = vec2(-n.y, n.x);
  vec2 rhat = q / max(length(q), 1e-3);
  float fj = float(j);
  vec3 N = normalize(vec3(t * 0.11 * sin(fj * 2.3 + 1.0) - rhat * 0.42 * (rr - 0.47) + n * 0.05, 1.0));
  float sheen = spec(N, 14.0);
  float broad = pow(max(dot(N, normalize(LIGHT)), 0.0), 2.0);
  vec2 local = vec2(dot(q, t), e) / max(uPx, 0.5);
  float grain = hash(floor(local * 1.1) + fj * 17.0) - 0.5;
  float streak = hash(vec2(floor(local.y * 0.7), fj)) - 0.5;
  vec3 base = vec3(0.0034, 0.0035, 0.0039) * (1.0 + 0.16 * grain);
  vec3 col = base + vec3(0.6, 0.62, 0.68) * (sheen * 0.04 + broad * 0.003) * (1.0 + 0.12 * grain + 0.1 * streak);
  col += uSpill * 0.05 * exp(-toOpen / (0.05 * uRl));
  float cw = 1.5 * uPx;
  float ch = 1.0 - smoothstep(cw * 0.55, cw, e);
  if (ch > 0.0) {
    vec3 Nc = normalize(vec3(-grad * 0.8, 0.6));
    float glint = spec(Nc, 14.0) * 0.6 + max(dot(Nc, normalize(LIGHT)), 0.0) * 0.012;
    float back = max(dot(grad, rhat), 0.0);
    col += (vec3(0.88, 0.9, 0.96) * glint + uSpill * back * back * 0.5 * exp(-toOpen / (0.03 * uRl))) * ch;
  }
  return col;
}

vec3 metalRing(vec2 q, float rr, float rpx, float lo, float hi, float sheenAmt, float lathe) {
  vec2 rhat = q / max(length(q), 1e-3);
  vec2 L2 = normalize(LIGHT.xy);
  float aniso = pow(abs(dot(rhat, L2)), 14.0);
  float lines = hash(vec2(floor(rpx * 0.9 / max(uPx, 0.5)), 3.0)) - 0.5;
  float g = hash(floor(q / max(uPx, 0.5))) - 0.5;
  vec3 base = vec3(0.009, 0.0092, 0.0098) * (1.0 + 0.2 * g);
  vec3 col = base + vec3(0.55, 0.57, 0.62) * aniso * sheenAmt * (1.0 + lathe * lines);
  float edgeO = 1.0 - smoothstep(0.6 * uPx, 1.6 * uPx, (hi - rr) * uRl);
  float edgeI = 1.0 - smoothstep(0.6 * uPx, 1.6 * uPx, (rr - lo) * uRl);
  float lit = dot(rhat, -normalize(LIGHT.xy));
  col += vec3(0.75, 0.77, 0.82) * edgeO * pow(max(lit, 0.0), 2.0) * 0.16;
  col += vec3(0.75, 0.77, 0.82) * edgeI * pow(max(-lit, 0.0), 2.0) * 0.07;
  col *= 1.0 - 0.6 * edgeI * max(lit, 0.0);
  return col;
}

vec3 knurl(vec2 q, float rr, float rpx) {
  float theta = atan(q.y, q.x) - uRing;
  float ribs = 120.0;
  float period = TAU * rpx / ribs;
  float ph = theta * ribs / TAU;
  float slope = cos(ph * TAU);
  float sharp = clamp(period / (5.0 * uPx), 0.0, 1.0);
  vec2 rhat = q / max(length(q), 1e-3);
  vec2 tang = vec2(-rhat.y, rhat.x);
  vec3 N = normalize(vec3(tang * slope * 0.75 * sharp + rhat * 0.12 * (rr - 0.945) / 0.055, 1.0));
  float s = spec(N, 26.0);
  float valley = 0.55 + 0.45 * (0.5 + 0.5 * sin(ph * TAU)) ;
  vec3 col = vec3(0.008, 0.0082, 0.009) * valley + vec3(0.6, 0.62, 0.68) * s * 0.16;
  float lit = dot(rhat, -normalize(LIGHT.xy));
  float edgeO = 1.0 - smoothstep(0.5 * uPx, 2.2 * uPx, (1.0 - rr) * uRl);
  float edgeI = 1.0 - smoothstep(0.5 * uPx, 1.6 * uPx, (rr - 0.89) * uRl);
  col += vec3(0.8, 0.82, 0.88) * edgeO * pow(max(lit, 0.0), 1.5) * 0.2;
  col += vec3(0.8, 0.82, 0.88) * edgeI * pow(max(-lit, 0.0), 1.5) * 0.06;
  return col;
}

vec3 tonemap(vec3 x) {
  float l = max(max(x.r, x.g), x.b);
  vec3 c = x;
  float knee = 0.72;
  if (l > knee) {
    float m = knee + (1.0 - knee) * (1.0 - exp(-min((l - knee) / (1.0 - knee), 30.0)));
    c = x * (m / l);
    float burn = smoothstep(1.0, 6.0, l);
    c = mix(c, vec3(m), burn * 0.85);
  }
  return c;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 q = p - uCenter;
  float rpx = length(q);
  float rr = rpx / max(uRl, 1.0);
  vec3 col;
  vec2 rhat = q / max(rpx, 1e-3);

  float bg = 0.0009;
  float shadow = smoothstep(1.32, 0.96, length((q - vec2(0.0, uRl * 0.05)) / uRl));
  vec3 ground = vec3(bg * 1.05, bg, bg * 0.95) * (1.0 - 0.6 * shadow);
  ground += vec3(0.012, 0.009, 0.006) * exp(-max(rr - 1.0, 0.0) * 9.0) * (0.3 + 0.7 * max(dot(rhat, vec2(0.0, -1.0)), 0.0)) * 0.4;

  if (rr > 1.0 + 2.0 * uPx / uRl) {
    col = ground;
  } else {
    if (rr > 0.89) {
      col = knurl(q, rr, rpx);
    } else if (rr > 0.77) {
      col = metalRing(q, rr, rpx, 0.77, 0.89, 0.075, 0.5);
    } else if (rr > 0.705) {
      col = metalRing(q, rr, rpx, 0.705, 0.77, 0.035, 0.25) * 0.92;
    } else if (rr > 0.685) {
      float k = (rr - 0.685) / 0.02;
      col = vec3(0.004, 0.0042, 0.0046) * (0.4 + 0.6 * k);
      float lit = dot(rhat, normalize(LIGHT.xy));
      col += vec3(0.6, 0.62, 0.68) * (1.0 - smoothstep(0.6 * uPx, 1.8 * uPx, (0.705 - rr) * uRl)) * max(lit, 0.0) * 0.08;
    } else {
      float rb = uRb;
      float e[9];
      float maxE = -1e5;
      for (int i = 0; i < 9; i++) {
        e[i] = length(q - uBladeC[i]) - rb;
        maxE = max(maxE, e[i]);
      }
      vec3 bladeCol = vec3(0.0);
      if (maxE > -1.5 * uPx) {
        int top = 0;
        float best = -1e5;
        for (int i = 0; i < 9; i++) {
          int prev = i == 0 ? 8 : i - 1;
          if (e[i] > 0.0 && e[prev] <= 0.0 && e[i] > best) {
            best = e[i];
            top = i;
          }
        }
        if (best < -1e4) {
          for (int i = 0; i < 9; i++) {
            if (e[i] > best) {
              best = e[i];
              top = i;
            }
          }
        }
        int prevTop = top == 0 ? 8 : top - 1;
        vec2 gv = q - uBladeC[top];
        vec2 grad = gv / max(length(gv), 1e-3);
        bladeCol = bladeShade(top, q, max(e[top], 0.0), grad, rr, max(maxE, 0.0));
        float sd = -e[prevTop];
        float shade = 1.0 - 0.75 * exp(-max(sd, 0.0) / (3.0 * uPx)) - 0.25 * exp(-max(sd, 0.0) / (14.0 * uPx));
        bladeCol *= max(shade, 0.0);
        float edge = clamp(0.5 + e[prevTop] / uPx, 0.0, 1.0);
        if (edge > 0.0) {
          vec3 over = bladeShade(prevTop, q, max(e[prevTop], 0.0), (q - uBladeC[prevTop]) / max(length(q - uBladeC[prevTop]), 1e-3), rr, max(maxE, 0.0));
          bladeCol = mix(bladeCol, over, edge);
        }
        float ao = smoothstep(0.685, 0.63, rr);
        bladeCol *= 0.45 + 0.55 * ao;
      }
      float open = clamp(0.5 - maxE / uPx, 0.0, 1.0);
      vec3 ph = open > 0.0 ? photo(p) * uFade : vec3(0.0);
      float lip = exp(-max(-maxE, 0.0) / (1.6 * uPx)) * 0.3;
      ph *= 1.0 - lip;
      col = mix(bladeCol, ph, open);
    }
    float outerAA = clamp((1.0 - rr) * uRl / uPx + 0.5, 0.0, 1.0);
    col = mix(ground, col, outerAA);
  }

  col = tonemap(col);
  vec3 srgb = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));
  srgb += (hash(gl_FragCoord.xy + 0.37) - 0.5) / 255.0;
  outColor = vec4(srgb, 1.0);
}
`;
