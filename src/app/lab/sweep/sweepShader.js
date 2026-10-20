export const SWEEP_VERTEX = `#version 300 es
precision highp float;
void main() {
  float x = gl_VertexID == 1 ? 2.0 : 0.0;
  float y = gl_VertexID == 2 ? 2.0 : 0.0;
  gl_Position = vec4(vec2(x, y) * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SWEEP_PERSIST = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uA0;
uniform float uDelta;
uniform float uDt;
uniform vec3 uDecay;
uniform float uFloor;
uniform float uTauR;
uniform float uTauG;
uniform float uStamp;
uniform float uSeed;
uniform float uScale;
uniform int uCount;
uniform vec4 uBlips[16];
uniform float uAmp[16];
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 p = gl_FragCoord.xy;
  vec3 acc = texelFetch(uPrev, ivec2(p), 0).rgb * uDecay - uFloor;
  acc = max(acc, vec3(0.0));
  vec2 d = p - uCenter;
  float r = length(d);
  float span = abs(uDelta);
  if (r < uRadius && span > 0.00001) {
    float th = atan(d.x, d.y);
    float off = mod((th - uA0) * sign(uDelta), 6.2831853);
    if (off <= span) {
      float tp = (1.0 - off / span) * uDt;
      float edge = 1.0 - smoothstep(uRadius - 2.0 * uScale, uRadius, r);
      float wake = exp(-tp / uTauR) * uStamp * edge;
      float field = 0.0;
      for (int i = 0; i < 16; i++) {
        if (i >= uCount) break;
        vec4 b = uBlips[i];
        vec2 q = p - b.xy;
        float br = length(b.xy - uCenter);
        vec2 radial = br > 0.5 ? (b.xy - uCenter) / br : vec2(0.0, 1.0);
        float dr = dot(q, radial);
        float dt = dot(q, vec2(radial.y, -radial.x));
        float g = exp(-(dr * dr) / (b.z * b.z) - (dt * dt) / (b.w * b.w));
        float core = exp(-(dr * dr) / (b.z * b.z * 0.18) - (dt * dt) / (b.w * b.w * 0.2));
        field = max(field, (g * 0.78 + core * 0.5) * uAmp[i]);
      }
      float blip = min(field, 1.25) * exp(-tp / uTauG);
      vec2 cell = floor(p / (1.6 * uScale));
      float h = hash(cell + uSeed);
      float near = 1.0 - smoothstep(0.0, uRadius * 0.34, r);
      float speck = step(0.988 - near * 0.05, h) * (0.12 + near * near * 0.55);
      float grain = step(0.9965, hash(cell * 1.7 + uSeed * 0.37)) * 0.16;
      float clutter = (speck + grain) * edge * exp(-tp / uTauR);
      acc = max(acc, vec3(wake, blip, clutter));
    }
  }
  outColor = vec4(acc, 1.0);
}
`;

export const SWEEP_DISPLAY = `#version 300 es
precision highp float;
uniform sampler2D uAccum;
uniform sampler2D uText;
uniform vec2 uRes;
uniform vec2 uScene;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uAngle;
uniform float uBeamW;
uniform float uScale;
uniform float uTime;
uniform float uPower;
uniform float uFlicker;
uniform float uCurve;
uniform vec4 uLock;
uniform int uBoxCount;
uniform float uDefault;
uniform vec4 uBoxes[24];
uniform float uBright[24];
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float line(float dist, float w) {
  return 1.0 - smoothstep(w * 0.5, w * 0.5 + 1.0, dist);
}

float tick(float deg, float step, float r) {
  float m = abs(fract(deg / step + 0.5) - 0.5) * step;
  return m * 0.0174533 * r;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 c = uv * 2.0 - 1.0;
  vec2 cs = c * (1.0 + uCurve * vec2(c.y * c.y, c.x * c.x));
  vec2 edge = 1.0 - abs(cs);
  float glass = smoothstep(0.0, 0.012, edge.x) * smoothstep(0.0, 0.018, edge.y);
  float sx = max(smoothstep(0.0, 0.32, uPower), 0.004);
  float sy = max(smoothstep(0.28, 1.0, uPower), 0.006);
  vec2 cp = cs / vec2(sx, sy);
  float inside = step(abs(cp.x), 1.0) * step(abs(cp.y), 1.0);
  vec2 su = clamp(cp * 0.5 + 0.5, 0.0, 1.0);
  vec2 px = su * uScene;

  vec3 green = vec3(0.30, 1.0, 0.52);
  vec3 hot = vec3(0.82, 1.0, 0.88);

  vec4 a = textureLod(uAccum, su, 0.0);
  vec3 bloom = textureLod(uAccum, su, 2.0).rgb * 0.3 + textureLod(uAccum, su, 3.5).rgb * 0.36 + textureLod(uAccum, su, 5.0).rgb * 0.42;

  vec2 d = px - uCenter;
  float r = length(d);
  float th = atan(d.x, d.y);
  float deg = mod(degrees(th), 360.0);
  float lw = 1.0 * uScale;
  float inR = 1.0 - smoothstep(uRadius - 0.5, uRadius + 0.5, r);

  float grat = 0.0;
  for (int k = 1; k < 4; k++) {
    grat = max(grat, line(abs(r - uRadius * float(k) * 0.25), lw) * 0.16);
  }
  grat = max(grat, line(abs(r - uRadius), lw * 1.3) * 0.34);
  float cross = min(line(abs(d.x), lw), 1.0) + min(line(abs(d.y), lw), 1.0);
  grat = max(grat, min(cross, 1.0) * 0.07 * inR);
  float band = step(uRadius - 16.0 * uScale, r) * inR;
  float t2 = line(tick(deg, 2.0, r), lw) * step(uRadius - 4.0 * uScale, r);
  float t10 = line(tick(deg, 10.0, r), lw) * step(uRadius - 9.0 * uScale, r);
  float t30 = line(tick(deg, 30.0, r), lw * 1.2) * step(uRadius - 16.0 * uScale, r);
  grat = max(grat, max(t2 * 0.26, max(t10 * 0.36, t30 * 0.5)) * band);
  float dot0 = 1.0 - smoothstep(1.2 * uScale, 2.4 * uScale, r);
  grat = max(grat, dot0 * 0.5);

  float wake = a.r;
  float blip = a.g;
  vec3 col = green * grat;
  col += green * (wake * wake * 0.5 + wake * 0.07) * inR;
  col += mix(green, hot, clamp(blip * blip, 0.0, 1.0)) * blip * 1.15;
  col += green * a.b * 0.55;

  vec2 dir = vec2(sin(uAngle), cos(uAngle));
  float along = dot(d, dir);
  float perp = abs(dot(d, vec2(dir.y, -dir.x)));
  float beam = (1.0 - smoothstep(uBeamW * 0.5, uBeamW * 0.5 + 1.2 * uScale, perp)) * step(0.0, along) * inR;
  col += mix(green, hot, 0.55) * beam * 0.75;

  if (uLock.w > 0.001) {
    vec2 q = abs(px - uLock.xy);
    float s = uLock.z;
    float L = max(s * 0.42, 5.0 * uScale);
    float bx = line(abs(q.x - s), lw * 1.2) * step(s - L, q.y) * step(q.y, s + 0.5);
    float by = line(abs(q.y - s), lw * 1.2) * step(s - L, q.x) * step(q.x, s + 0.5);
    col += mix(green, hot, 0.4) * max(bx, by) * uLock.w * 0.9;
  }

  vec4 t = texture(uText, su);
  if (t.a > 0.002) {
    vec2 tp = vec2(px.x, uScene.y - px.y);
    float b = uDefault;
    for (int i = 0; i < 24; i++) {
      if (i >= uBoxCount) break;
      vec4 bx = uBoxes[i];
      if (tp.x >= bx.x && tp.y >= bx.y && tp.x <= bx.z && tp.y <= bx.w) {
        b = uBright[i];
        break;
      }
    }
    col += mix(green, hot, smoothstep(0.75, 1.0, b) * 0.7) * t.a * b * 1.05;
  }

  col += green * (bloom.g * 0.95 + bloom.r * 0.22 + bloom.b * 0.3) * 0.6;

  float row = (1.0 - su.y) * uScene.y / (3.0 * uScale);
  float scan = 0.5 + 0.5 * cos(row * 6.2831853);
  col *= mix(0.7, 1.0, scan);
  col *= inside;
  col *= 1.0 + 2.2 * (1.0 - smoothstep(0.55, 1.0, uPower));
  col *= 1.0 - uFlicker;
  float rr = length(cs * vec2(0.92, 1.0));
  vec3 base = vec3(0.03, 0.046, 0.038) * (1.0 - 0.55 * rr * rr);
  float rim = (1.0 - smoothstep(0.0, 0.05, min(edge.x, edge.y))) * smoothstep(0.0, 0.01, min(edge.x, edge.y));
  base += vec3(0.05, 0.065, 0.058) * rim * (0.4 + 0.6 * smoothstep(-0.2, 1.0, c.y - 0.3 * c.x));
  vec2 rp = (c - vec2(-0.5, 0.62)) * vec2(0.7, 1.4);
  vec3 refl = vec3(0.55, 0.7, 0.64) * 0.024 * (1.0 - smoothstep(0.0, 0.9, length(rp)));
  float vig = 1.0 - smoothstep(0.55, 1.45, rr);
  col = base + col * mix(0.55, 1.0, vig) + refl;
  col += (hash(gl_FragCoord.xy + fract(uTime * 7.13) * 91.0) - 0.5) * 0.018;
  col = clamp(col, 0.0, 1.0);
  outColor = vec4(col * glass, glass);
}
`;
