export const CAM_VERTEX = `#version 300 es
precision highp float;
void main() {
  float x = gl_VertexID == 1 ? 2.0 : 0.0;
  float y = gl_VertexID == 2 ? 2.0 : 0.0;
  gl_Position = vec4(vec2(x, y) * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const CAM_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uPhoto;
uniform vec2 uRes;
uniform vec2 uPhotoSize;
uniform vec2 uCenter;
uniform float uZoom;
uniform float uDigital;
uniform float uBlur;
uniform float uEv;
uniform float uGain;
uniform vec2 uVel;
uniform float uTime;
uniform float uTrack;
uniform float uPlay;
uniform float uReady;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

vec2 toPhoto(vec2 s) {
  float aspect = uRes.x / uRes.y;
  float photoAspect = uPhotoSize.x / uPhotoSize.y;
  vec2 span = vec2(1.0, photoAspect / aspect) / uZoom;
  return uCenter + (s - 0.5) * span;
}

vec3 sampleAt(vec2 s, float lod) {
  vec2 p = toPhoto(s);
  return textureLod(uPhoto, p, lod).rgb;
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float sensor = uRes.x / 720.0;
  float block = sensor * pow(uDigital, 1.6) * mix(1.0, 1.3, step(1.001, uDigital));
  vec2 cell = block > 1.5 ? (floor(frag / block) + 0.5) * block : frag;
  vec2 s = cell / uRes;

  float line = floor(frag.y / max(1.0, sensor));
  float field = mod(line, 2.0);
  s -= uVel * field * 0.5;

  float rowHash = hash(vec2(floor(frag.y / 2.0), floor(uTime * 30.0)));
  float headZone = smoothstep(0.982, 1.0, frag.y / uRes.y) * uPlay;
  s.x += headZone * headZone * 0.035 + (rowHash - 0.5) * 0.004 * headZone;
  float streak = 0.0;
  if (uTrack > 0.0) {
    s.x += (rowHash - 0.5) * 0.003 * uTrack;
    float lineOn = step(1.0 - 0.07 * uTrack, rowHash);
    float startX = hash(vec2(rowHash * 31.0, floor(uTime * 30.0)));
    float lenX = 0.15 + 0.5 * hash(vec2(rowHash * 17.0, 3.0));
    float u = frag.x / uRes.x;
    streak = lineOn * step(startX, u) * (1.0 - smoothstep(startX + lenX * 0.6, startX + lenX, u)) * uTrack;
  }

  float texPerPx = uPhotoSize.x / (uZoom * uRes.x);
  float baseLod = max(0.0, log2(max(texPerPx, 0.001)));
  float lod = baseLod + 0.35 + uBlur * 2.2;
  vec3 col = sampleAt(s, lod);
  if (uBlur > 0.04) {
    float r = uBlur * 0.008;
    vec2 k = vec2(r, r * uRes.x / uRes.y);
    col += sampleAt(s + k * vec2(1.0, 0.0), lod);
    col += sampleAt(s + k * vec2(-1.0, 0.0), lod);
    col += sampleAt(s + k * vec2(0.0, 1.0), lod);
    col += sampleAt(s + k * vec2(0.0, -1.0), lod);
    col += sampleAt(s + k * vec2(0.7, 0.7), lod);
    col += sampleAt(s + k * vec2(-0.7, -0.7), lod);
    col /= 7.0;
  }
  vec3 glow = sampleAt(s, lod + 3.5);
  float e = exp2(uEv);
  col *= e;
  glow *= e;
  vec3 over = max(glow - 0.75, 0.0);
  col += over * vec3(1.0, 0.85, 0.75) * 0.9;
  col = col / (1.0 + max(col - 0.85, 0.0) * 1.6);
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(luma), col, 1.12);
  col = pow(max(col, 0.0), vec3(0.95, 0.97, 1.02));

  float grain = (hash(cell + fract(uTime * 13.7) * 97.0) - 0.5);
  float chroma = (hash(cell * 1.3 + fract(uTime * 7.3) * 53.0) - 0.5);
  col += grain * (0.018 + uGain * 0.09);
  col += vec3(chroma, -chroma * 0.5, chroma * 0.8) * uGain * 0.05;

  float sn = hash(vec2(floor(frag.x / 3.0), floor(frag.y / 2.0)) + floor(uTime * 60.0));
  col = mix(col, vec3(0.35 + sn * 0.65), streak * 0.7);
  col = mix(col, vec3(sn * 0.5), headZone * 0.55);
  col.rb += vec2(0.015, -0.015) * uPlay;

  vec2 vuv = frag / uRes - 0.5;
  col *= 1.0 - dot(vuv, vuv) * 0.45;
  col = mix(vec3(0.0), col, uReady);

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
