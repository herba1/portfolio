export const TAFFY_VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const TAFFY_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uResolution;
uniform float uPixelRatio;

uniform sampler2D uAtlasNew;
uniform vec2 uAtlasSizeNew;
uniform float uScaleNew;
uniform float uPadNew;
uniform int uCountNew;
uniform vec4 uTileNew[20];
uniform vec4 uPlaceNew[20];
uniform vec4 uMoveNew[20];
uniform vec4 uWarpNew[20];
uniform vec2 uDecodeNew;

uniform sampler2D uAtlasOld;
uniform vec2 uAtlasSizeOld;
uniform float uScaleOld;
uniform float uPadOld;
uniform int uCountOld;
uniform vec4 uTileOld[20];
uniform vec4 uPlaceOld[20];
uniform vec2 uDecodeOld;

uniform float uMorph;
uniform float uMelt;
uniform float uSlump;

uniform int uSegCount;
uniform vec4 uSegLine[14];
uniform vec4 uSegCtrl[14];
uniform vec4 uSegShape[14];
uniform vec4 uSegBody[14];
uniform float uFillet;

uniform int uFocus;
uniform float uFocusAmount;

uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uAccent;
uniform float uGrain;
uniform float uChroma;

out vec4 fragColor;

float smin(float a, float b, float k) {
  if (k < 0.001) return min(a, b);
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float glyphField(sampler2D atlas, vec2 atlasSize, vec2 decode, float scale, float pad, vec4 tile, vec4 place, vec2 q) {
  vec2 texel = place.zw + q * scale;
  vec2 inside = clamp(texel, vec2(0.5), tile.zw - 0.5);
  float outside = length(texel - inside);
  if (outside > pad * 1.5) return (outside + pad) / scale;
  float d = texture(atlas, (tile.xy + inside) / atlasSize).r * decode.x + decode.y;
  return (d + outside) / scale;
}

vec2 warpLocal(vec2 q, vec4 move, vec4 warp) {
  vec2 r = q - move.zw;
  vec2 u = warp.xy;
  vec2 n = vec2(-u.y, u.x);
  float s = max(warp.z, 0.2);
  float along = dot(r, u) / s;
  float across = dot(r, n) * s;
  return u * along + n * across + move.zw;
}

float strandField(vec2 p, vec4 line, vec4 ctrl, vec4 shape) {
  vec2 a = line.xy;
  vec2 b = line.zw;
  vec2 lean = ctrl.xy - a;
  vec2 bow = a - 2.0 * ctrl.xy + b;
  vec2 chord = b - a;
  float t = clamp(dot(p - a, chord) / max(dot(chord, chord), 1e-4), 0.0, 1.0);
  for (int k = 0; k < 3; k++) {
    vec2 offset = a + (2.0 * lean + bow * t) * t - p;
    vec2 tangent = 2.0 * (lean + bow * t);
    float slope = dot(tangent, tangent);
    float curvature = max(slope + 2.0 * dot(offset, bow), 0.5 * slope + 1e-4);
    t = clamp(t - dot(offset, tangent) / curvature, 0.0, 1.0);
  }
  vec2 nearest = a + (2.0 * lean + bow * t) * t;
  float neck = 1.0 - shape.z * sin(3.14159265 * t);
  float r = mix(shape.x, shape.y, t) * neck;
  float d = length(p - nearest) - r;
  if (shape.w > 0.0) {
    float bead = length(p - b) - shape.w;
    d = smin(d, bead, shape.w * 0.9);
  }
  if (ctrl.z > 0.01 && ctrl.w > 0.01) {
    vec2 local = p - a;
    float reach = length(local / ctrl.zw);
    float pull = max(length(local / (ctrl.zw * ctrl.zw)), 1e-4);
    float puddle = reach * (reach - 1.0) / pull;
    d = smin(d, puddle, ctrl.z * 0.6);
  }
  return d;
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y) / uPixelRatio;
  vec2 slumped = vec2(p.x, p.y - uSlump);

  float glyphD[20];
  float word = 1e5;
  for (int i = 0; i < 20; i++) {
    glyphD[i] = 1e5;
    if (i >= uCountNew) continue;
    vec4 move = uMoveNew[i];
    vec2 q = slumped - uPlaceNew[i].xy - move.xy;
    q = warpLocal(q, move, uWarpNew[i]);
    float d = glyphField(uAtlasNew, uAtlasSizeNew, uDecodeNew, uScaleNew, uPadNew, uTileNew[i], uPlaceNew[i], q);
    glyphD[i] = d;
    word = smin(word, d, uMelt);
  }

  for (int j = 0; j < 14; j++) {
    if (j >= uSegCount) break;
    float ds = strandField(p, uSegLine[j], uSegCtrl[j], uSegShape[j]);
    vec4 body = uSegBody[j];
    float joined = ds;
    int ia = int(body.x + 0.5);
    int ib = int(body.y + 0.5);
    if (body.x > -0.5) joined = min(joined, smin(ds, glyphD[ia], uFillet * body.z));
    if (body.y > -0.5) joined = min(joined, smin(ds, glyphD[ib], uFillet * body.w));
    word = min(word, joined);
  }

  if (uMorph < 0.999) {
    float old = 1e5;
    for (int i = 0; i < 20; i++) {
      if (i >= uCountOld) continue;
      vec2 q = slumped - uPlaceOld[i].xy;
      float d = glyphField(uAtlasOld, uAtlasSizeOld, uDecodeOld, uScaleOld, uPadOld, uTileOld[i], uPlaceOld[i], q);
      old = smin(old, d, uMelt);
    }
    word = mix(old, word, uMorph);
  }

  float fw = max(fwidth(word), 1e-4);
  float ink = clamp(0.5 - word / fw, 0.0, 1.0);

  vec3 col = mix(uPaper, uInk, ink);
  float sheen = ink * (1.0 - ink) * 4.0;
  col = mix(col, uAccent, sheen * 0.06);

  if (uFocus >= 0 && uFocusAmount > 0.001) {
    float gd = glyphD[uFocus];
    float ring = abs(gd - 5.0) - 1.0;
    float rw = max(fwidth(gd), 1e-4);
    float ringInk = clamp(0.5 - ring / rw, 0.0, 1.0) * uFocusAmount * (1.0 - ink);
    col = mix(col, uAccent, ringInk);
  }

  float g = hash21(floor(gl_FragCoord.xy)) - 0.5;
  float grainAmount = uGrain * mix(1.0, 0.45, ink);
  col += g * grainAmount;
  col.r += g * grainAmount * uChroma;
  col.b -= g * grainAmount * uChroma;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
