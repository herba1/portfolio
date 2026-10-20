export const WAVE_COUNT = 9;

const SURFACE = `
uniform sampler2D uSim;
uniform vec2 uSimSpan;
uniform vec4 uWaves[${WAVE_COUNT}];
uniform float uSimOn;

vec3 surface(vec2 p) {
  vec3 s = vec3(0.0);
  for (int i = 0; i < ${WAVE_COUNT}; i++) {
    vec4 w = uWaves[i];
    float ph = dot(w.xy, p) + w.w;
    s.x += w.z * sin(ph);
    s.yz += w.z * cos(ph) * w.xy;
  }
  if (uSimOn > 0.5) s += textureLod(uSim, p / uSimSpan, 0.0).xyz;
  return s;
}
`;

export const CAUSTIC_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aGrid;
uniform vec2 uStage;
uniform vec4 uMesh;
uniform vec3 uSun;
uniform float uEta;
uniform float uDepth;
${SURFACE}
out vec2 vOld;
out vec2 vNew;

void main() {
  vec2 p = uMesh.xy + aGrid * uMesh.zw;
  vec3 s = surface(p);
  vec3 n = normalize(vec3(-s.y, -s.z, 1.0));
  vec3 incident = -uSun;
  vec3 r0 = refract(incident, vec3(0.0, 0.0, 1.0), uEta);
  vec3 r = refract(incident, n, uEta);
  vOld = p + r0.xy * (uDepth / -r0.z);
  vec2 hit = p + r.xy * ((uDepth + s.x) / -r.z);
  vNew = hit;
  vec2 clip = hit / uStage * 2.0 - 1.0;
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

export const CAUSTIC_FS = `#version 300 es
precision highp float;
in vec2 vOld;
in vec2 vNew;
uniform float uGain;
out vec4 outColor;

void main() {
  float oldArea = length(dFdx(vOld)) * length(dFdy(vOld));
  float newArea = length(dFdx(vNew)) * length(dFdy(vNew));
  float ratio = oldArea / max(newArea, 1e-7);
  outColor = vec4(vec3(min(ratio, 48.0) * uGain), 1.0);
}
`;

export const QUAD_VS = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SURFACE_FS = `#version 300 es
precision highp float;
uniform float uCell;
${SURFACE}
out vec4 outColor;

void main() {
  vec3 s = surface(gl_FragCoord.xy * uCell);
  outColor = vec4(s * vec3(0.04, 0.5, 0.5) + 0.5, 1.0);
}
`;

export const COMPOSE_FS = `#version 300 es
precision highp float;
uniform sampler2D uSurf;
uniform vec2 uSurfSpan;
uniform sampler2D uFloor;
uniform sampler2D uCaustic;
uniform vec2 uStage;
uniform vec2 uRes;
uniform float uScale;
uniform vec3 uSun;
uniform float uEta;
uniform float uDepth;
uniform float uCausticNorm;
uniform vec3 uAbsorb;
uniform vec3 uAmbient;
uniform vec3 uSunColor;
uniform vec3 uSky;
uniform vec3 uGround;
uniform float uFade;
uniform float uDeck;
uniform vec3 uStone;
out vec4 outColor;

vec3 toSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  vec3 s = (texture(uSurf, p / uSurfSpan).xyz - 0.5) * vec3(25.0, 2.0, 2.0);
  vec3 n = normalize(vec3(-s.y, -s.z, 1.0));
  vec3 view = vec3(0.0, 0.0, -1.0);
  vec3 t = refract(view, n, uEta);
  float pathView = (uDepth + s.x) / -t.z;
  vec2 q = p + t.xy * pathView;
  vec2 uv = q / uStage;
  vec3 tile = texture(uFloor, uv).rgb;
  vec3 caustic = texture(uCaustic, uv).rgb * uCausticNorm;
  vec3 r0 = refract(-uSun, vec3(0.0, 0.0, 1.0), uEta);
  float pathLight = uDepth / -r0.z;
  vec3 absorb = exp(-uAbsorb * (pathView + pathLight));
  float dy = p.y - uDeck;
  float shade = uDeck > 0.0 ? 1.0 - 0.55 * exp(-max(dy, 0.0) / 12.0) : 1.0;
  float calm = uDeck > 0.0 ? mix(0.4, 1.0, smoothstep(0.0, 64.0, dy)) : 1.0;
  vec3 light = uAmbient * mix(0.72, 1.0, shade) + uSunColor * caustic * (-r0.z) * shade * calm;
  vec3 col = tile * light * absorb;
  float fres = 0.02 + 0.98 * pow(1.0 - clamp(n.z, 0.0, 1.0), 5.0);
  col = mix(col, uSky, fres);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float knee = 0.74;
  float mapped = lum < knee ? lum : knee + (1.0 - knee) * (1.0 - exp(-(lum - knee) / (1.0 - knee)));
  col *= mapped / max(lum, 1e-5);
  col = mix(col, vec3(mapped), smoothstep(0.8, 2.2, lum) * 0.7);
  if (uDeck > 0.0 && dy < 1.0) {
    float up = uDeck - p.y;
    float jx;
    float jy;
    float id;
    if (up < 40.0) {
      float lx = mod(p.x, 120.0);
      jx = min(lx, 120.0 - lx);
      jy = 40.0 - up;
      id = floor(p.x / 120.0);
    } else {
      float u2 = up - 40.0;
      float r = floor(u2 / 120.0);
      float ly = mod(u2, 120.0);
      float lx = mod(p.x + r * 120.0, 240.0);
      jx = min(lx, 240.0 - lx);
      jy = min(ly, 120.0 - ly);
      id = r * 31.0 + floor((p.x + r * 120.0) / 240.0) + 7.0;
    }
    float joint = 1.0 - smoothstep(0.5, 1.5, min(jx, jy));
    vec3 stone = uStone * (1.0 + (hash(vec2(id, 3.7)) - 0.5) * 0.022);
    stone *= 1.0 - 0.045 * joint;
    stone *= 1.0 + 0.04 * smoothstep(10.0, 3.0, up);
    stone *= 1.0 - 0.3 * smoothstep(2.0, 0.0, up);
    float edge = smoothstep(-0.75, 0.75, -dy * uScale);
    col = mix(col, stone, edge);
  }
  col = mix(uGround, col, uFade);
  vec3 srgb = toSrgb(clamp(col, 0.0, 1.0));
  srgb += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(srgb, 1.0);
}
`;
