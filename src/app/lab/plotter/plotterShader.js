export const QUAD_VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const PLOT_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTone;
uniform sampler2D uRows;
uniform vec2 uRes;
uniform float uDpr;
uniform vec4 uRect;
uniform float uGantry;
uniform vec2 uTarget;
uniform float uActive;
uniform float uBand;
uniform float uLift;
uniform float uScale;
uniform vec2 uCenter;
uniform vec3 uPaper;
uniform vec3 uInks[3];
uniform vec3 uAccents[3];
out vec4 outColor;

const float PI = 3.14159265;
const float TAU = 6.28318530;
const float THRESHOLD = 0.5;
const float WOBBLE = 0.3;
const float BLEED = 0.3;
const float PRESSURE = 1.0;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash2(vec2 p) {
  vec2 q = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(q) * 43758.5453);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  vec2 eased = local * local * (3.0 - 2.0 * local);
  float a = hash(cell);
  float b = hash(cell + vec2(1.0, 0.0));
  float c = hash(cell + vec2(0.0, 1.0));
  float d = hash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, eased.x), mix(c, d, eased.x), eased.y);
}

vec4 toneAt(vec2 p) {
  return texture(uTone, clamp(p / uRect.zw, vec2(0.0), vec2(1.0)));
}

float aa;

float stroke(float distance, float width) {
  float half_ = width * 0.5;
  float edge = aa + BLEED * 0.6 / uDpr;
  return 1.0 - smoothstep(half_ - edge, half_ + edge, distance);
}

float screenMix(float a, float b) {
  return 1.0 - (1.0 - a) * (1.0 - b);
}

float hatchLayer(vec2 p, float angle, float gap, float start, float field, float width, float shift) {
  vec2 n = vec2(cos(angle), sin(angle));
  float u = dot(p, n) / gap + shift;
  float distance = abs(fract(u) - 0.5) * gap;
  float on = smoothstep(start, start + 0.08, field);
  return stroke(distance, width) * on;
}

float contourLines(vec2 p, int channel, float levels, float width, float edgeGate) {
  float step_ = 2.0;
  vec4 c = toneAt(p);
  vec4 px = toneAt(p + vec2(step_, 0.0));
  vec4 nx = toneAt(p - vec2(step_, 0.0));
  vec4 py = toneAt(p + vec2(0.0, step_));
  vec4 ny = toneAt(p - vec2(0.0, step_));
  float v = channel == 0 ? c.g : c.a;
  float dx = ((channel == 0 ? px.g : px.a) - (channel == 0 ? nx.g : nx.a)) / (step_ * 2.0);
  float dy = ((channel == 0 ? py.g : py.a) - (channel == 0 ? ny.g : ny.a)) / (step_ * 2.0);
  float gradient = max(length(vec2(dx, dy)), 0.0005);
  float value = v * levels;
  float distance = abs(fract(value) - 0.5) / (gradient * levels);
  float gate = edgeGate > 0.0 ? smoothstep(edgeGate, edgeGate * 2.2, gradient) : 1.0;
  return stroke(distance, width) * smoothstep(0.5 / levels, 1.2 / levels, v) * gate;
}

vec2 plotHatch(vec2 p, float weight) {
  float gap = 4.4 * uScale;
  vec4 t = toneAt(p);
  float dark = t.r;
  float a1 = PI * 0.75;
  float a2 = PI * 0.25;
  float w1 = mix(weight * 0.4, gap * 0.8, pow(dark, 1.25));
  float l1 = hatchLayer(p, a1, gap, 0.1, dark, w1, 0.0);
  float deep = clamp((dark - 0.66) / 0.34, 0.0, 1.0);
  float w2 = mix(weight * 0.8, gap * 0.42, deep);
  float l2 = hatchLayer(p, a2, gap * 1.05, 0.66, dark, w2, 0.0);
  float outline = contourLines(p, 0, 3.0, weight * 1.15, 0.012);
  float ink = screenMix(screenMix(l1, l2), outline * 0.7);
  float warm = t.b;
  float accentWidth = mix(weight * 0.8, gap * 0.45, warm);
  float accent = hatchLayer(p, PI * 0.5, gap * 0.95, 0.14, warm, accentWidth, 0.5);
  return vec2(ink, accent);
}

float waveRow(vec2 p, float gap, float shift, int channel, float weight, float amp, out float rowField) {
  vec2 normal = vec2(0.0, 1.0);
  vec2 tangent = vec2(-1.0, 0.0);
  float along = dot(p, tangent);
  float across = dot(p, normal) / gap - shift;
  float row = floor(across + 0.5);
  vec2 rowCenter = (row + shift) * gap * normal + tangent * along;
  vec4 t = toneAt(rowCenter);
  float field = channel == 0 ? t.r : t.b;
  rowField = field;
  float frequency = 0.5 * TAU / gap;
  float amplitude = pow(field, 1.6) * amp * gap * 0.95;
  float phase = along * frequency + row * 1.7;
  float wave = sin(phase);
  float offset = (across - row) * gap - amplitude * wave;
  float slope = amplitude * frequency * cos(phase);
  float distance = abs(offset) / sqrt(1.0 + slope * slope);
  float width = mix(weight * 0.6, gap * 0.55, pow(field, 1.3));
  return stroke(distance, width);
}

vec2 plotWave(vec2 p, float weight) {
  float gap = 7.0 * uScale;
  float rowDark;
  float ink = waveRow(p, gap, 0.0, 0, weight, 0.45, rowDark);
  ink *= smoothstep(0.02, 0.12, rowDark + THRESHOLD * 0.1);
  float rowWarm;
  float accent = waveRow(p, gap, 0.5, 1, weight, 0.38, rowWarm);
  accent *= smoothstep(0.12, 0.3, rowWarm);
  return vec2(ink, accent);
}

vec2 plotContour(vec2 p, float weight) {
  vec4 t = toneAt(p);
  float width = mix(weight, weight * 1.9, PRESSURE * t.g);
  float ink = contourLines(p, 0, 9.0, width, 0.0);
  float accent = contourLines(p, 1, 6.0, weight * 1.3, 0.0);
  return vec2(ink, accent);
}

float stippleDots(vec2 p, float cellSize, int channel, float salt, float weight, float power) {
  vec2 base = floor(p / cellSize);
  float coverage = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cell = base + vec2(float(x), float(y));
      vec2 jitter = hash2(cell + salt);
      vec2 center = (cell + jitter) * cellSize;
      vec4 t = toneAt(center);
      float field = channel == 0 ? t.r : t.b;
      float keep = hash(cell + 9.1 + salt) < pow(field, power) ? 1.0 : 0.0;
      float radius = mix(weight * 1.3, weight * 2.8, field);
      coverage = max(coverage, stroke(length(p - center), radius) * keep);
    }
  }
  return coverage;
}

vec2 plotStipple(vec2 p, float weight) {
  float cellSize = 2.7 * uScale;
  float ink = stippleDots(p, cellSize, 0, 0.0, weight, 1.0);
  float accent = stippleDots(p, cellSize * 1.15, 1, 31.7, weight, 1.1);
  return vec2(ink, accent);
}

vec2 plotSpiral(vec2 p, float weight) {
  float gap = 5.0 * uScale;
  vec2 center = uCenter * uRect.zw;
  vec2 local = p - center;
  float radius = length(local);
  float turn = atan(local.y, local.x) / TAU;
  vec4 t = toneAt(p);
  float ring = radius / gap - turn;
  float distance = abs(fract(ring) - 0.5) * gap;
  float spiralWidth = mix(weight * 0.3, gap * 0.9, pow(t.r, 1.2));
  float ink = stroke(distance, spiralWidth) * smoothstep(0.01, 0.06, t.r);
  float accentDistance = abs(fract(ring + 0.5) - 0.5) * gap;
  float accentWidth = mix(weight * 0.2, gap * 0.7, pow(t.b, 1.1));
  float accent = stroke(accentDistance, accentWidth) * smoothstep(0.1, 0.24, t.b);
  return vec2(ink, accent);
}

vec2 plotMode(float mode, vec2 p, float weight) {
  if (mode < 0.5) return plotHatch(p, weight);
  if (mode < 1.5) return plotWave(p, weight);
  if (mode < 2.5) return plotContour(p, weight);
  if (mode < 3.5) return plotStipple(p, weight);
  if (mode < 4.5) return plotSpiral(p, weight);
  return vec2(0.0);
}

void main() {
  aa = 0.8 / uDpr;
  vec2 css = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 pixel = css - uRect.xy;
  float grain = (valueNoise(css * uDpr / 1.3) - 0.5) * 0.2 * 0.08;
  float tooth = (valueNoise(css * 0.35 + 11.0) - 0.5) * 0.018;
  vec3 paper = clamp(uPaper + grain + tooth, 0.0, 1.0);
  vec3 color = paper;
  bool inside = pixel.x >= 0.0 && pixel.y >= 0.0 && pixel.x <= uRect.z && pixel.y <= uRect.w;
  if (inside) {
    float gap = 6.0 * uScale;
    vec2 warp = (vec2(valueNoise(pixel / (gap * 3.0) + 3.1), valueNoise(pixel / (gap * 3.0) + 17.9)) - 0.5) * WOBBLE * gap * 0.6;
    vec2 p = pixel + warp;
    float weight = 0.62 * uScale;
    float rowIndex = clamp(floor(pixel.y / uRect.w * 1024.0), 0.0, 1023.0);
    vec2 row = floor(texelFetch(uRows, ivec2(0, int(rowIndex)), 0).rg * 255.0 + 0.5);
    float fade = 1.0;
    if (uActive > 0.5) {
      float ragged = valueNoise(vec2(pixel.x * 0.09, floor(pixel.y / 3.0) * 0.7));
      float front = uGantry - uBand * (0.25 + 0.75 * ragged);
      if (pixel.y < front && pixel.y > uGantry - uBand - 4.0) {
        row = uTarget;
      } else if (pixel.y >= front && (abs(row.x - uTarget.x) > 0.5 || abs(row.y - uTarget.y) > 0.5)) {
        fade = smoothstep(uGantry, uGantry + uLift, pixel.y);
      }
    }
    int pen = int(clamp(row.y, 0.0, 2.0));
    vec3 ink = uInks[pen];
    vec3 accentInk = uAccents[pen];
    vec2 pens = plotMode(row.x, p, weight) * fade;
    float variation = valueNoise(p / (gap * 0.7) + 41.2) * BLEED * 0.35 + (1.0 - BLEED * 0.2);
    color = mix(color, color * accentInk, clamp(pens.y * variation * 0.92, 0.0, 1.0));
    color = mix(color, color * ink, clamp(pens.x * variation, 0.0, 1.0));
  }
  outColor = vec4(color, 1.0);
}
`;
