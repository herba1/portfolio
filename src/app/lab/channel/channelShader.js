export const CHANNEL_VERTEX = `#version 300 es
precision highp float;
void main() {
  float x = gl_VertexID == 1 ? 2.0 : 0.0;
  float y = gl_VertexID == 2 ? 2.0 : 0.0;
  gl_Position = vec4(vec2(x, y) * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const CHANNEL_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uCover;
uniform sampler2D uCaption;
uniform vec2 uRes;
uniform vec2 uScreen;
uniform float uTime;
uniform float uStatic;
uniform float uRoll;
uniform float uBar;
uniform float uDegauss;
uniform float uHasCover;
uniform vec4 uKen;
uniform float uCurve;
uniform float uFade;
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
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec3 picture(vec2 uv, float lod) {
  float aspect = uScreen.x / uScreen.y;
  vec2 cuv = aspect >= 1.0 ? vec2(uv.x, (uv.y - 0.5) / aspect + 0.5) : vec2((uv.x - 0.5) * aspect + 0.5, uv.y);
  cuv = (cuv - 0.5) / uKen.x + 0.5 + uKen.yz;
  vec3 c = textureLod(uCover, cuv, lod).rgb;
  return c * uHasCover;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  uv.y = 1.0 - uv.y;
  vec2 c = uv * 2.0 - 1.0;
  vec2 cs = c * (1.0 + uCurve * vec2(c.y * c.y, c.x * c.x));
  vec2 edge = 1.0 - abs(cs);
  float glass = smoothstep(0.0, 0.03, edge.x) * smoothstep(0.0, 0.04, edge.y);
  vec2 su = cs * 0.5 + 0.5;

  float wob = uDegauss * uDegauss;
  su.x += sin(su.y * 9.0 + uTime * 23.0) * 0.016 * wob + sin(su.y * 31.0 - uTime * 41.0) * 0.004 * wob;
  su.y += sin(su.x * 7.0 + uTime * 17.0) * 0.006 * wob;

  float line = floor(su.y * uScreen.y / 2.0);
  float tear = (hash(vec2(line, floor(uTime * 30.0))) - 0.5) * 0.03 * uStatic;
  su.x += tear;

  float ry = su.y + uRoll;
  float wrapped = fract(ry);
  float bar = smoothstep(0.0, 0.025, wrapped) * smoothstep(0.0, 0.025, 1.0 - wrapped);
  float barMix = mix(1.0, bar, uBar);
  vec2 pu = vec2(su.x, wrapped);

  float px = 1.0 / uScreen.x;
  vec3 col;
  col.r = picture(pu + vec2(px * 1.8, 0.0), 1.1).r;
  col.g = picture(pu, 1.1).g;
  col.b = picture(pu - vec2(px * 1.8, 0.0), 1.1).b;
  col = mix(col, picture(pu, 2.0), 0.25);
  vec3 bloom = picture(pu, 4.5) * 0.22;

  vec4 cap = textureLod(uCaption, pu, 0.0);
  vec4 capGlow = textureLod(uCaption, pu, 3.0);
  col = col * (1.0 - cap.a) + cap.rgb;
  col += capGlow.rgb * 0.35;

  col = pow(col, vec3(0.92)) * 1.06;
  col += bloom;

  float sn = hash(floor(gl_FragCoord.xy / 1.5) + floor(uTime * 60.0) * vec2(7.31, 3.17));
  float streak = vnoise(vec2(su.y * uScreen.y * 0.08, uTime * 40.0));
  vec3 snow = vec3(mix(sn, streak, 0.25)) * 0.95;
  col = mix(col, snow, uStatic);
  col += (hash(gl_FragCoord.xy + fract(uTime) * 311.0) - 0.5) * 0.035;

  float tintA = vnoise(su * 2.2 + vec2(uTime * 0.6, 0.0));
  float tintB = vnoise(su * 1.7 + vec2(3.1, uTime * 0.5));
  vec3 purity = vec3(tintA, tintB, 1.0 - tintA) - 0.5;
  col += purity * 0.85 * uDegauss * (0.6 + 0.4 * uDegauss);

  col *= barMix;

  float row = su.y * uScreen.y / 3.0;
  float scan = 0.5 + 0.5 * cos(row * 6.2831853);
  col *= mix(0.74, 1.0, scan);
  float trip = mod(gl_FragCoord.x, 3.0);
  vec3 mask = vec3(trip < 1.0 ? 1.0 : 0.82, trip >= 1.0 && trip < 2.0 ? 1.0 : 0.82, trip >= 2.0 ? 1.0 : 0.82);
  col *= mix(vec3(1.0), mask, 0.55);

  float r = length(cs * vec2(0.9, 1.0));
  col *= 1.0 - smoothstep(0.6, 1.5, r) * 0.6;
  vec2 rp = (c - vec2(-0.5, -0.62)) * vec2(0.8, 1.9);
  float refl = 1.0 - smoothstep(0.0, 0.9, length(rp));
  col += vec3(0.9, 0.93, 1.0) * refl * 0.035;
  float rim = (1.0 - smoothstep(0.0, 0.06, min(edge.x, edge.y))) * glass;
  col += vec3(0.6, 0.62, 0.66) * rim * 0.05 * (0.4 + 0.6 * (1.0 - smoothstep(-0.8, 0.4, c.y)));
  vec3 off = vec3(0.045, 0.05, 0.05) * (1.0 - 0.4 * r * r);
  col = max(col, off);
  col = clamp(col, 0.0, 1.0) * uFade;
  outColor = vec4(col * glass, glass);
}
`;
