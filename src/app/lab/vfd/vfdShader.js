export const VFD_VERTEX = `#version 300 es
precision highp float;
void main() {
  float x = gl_VertexID == 1 ? 2.0 : 0.0;
  float y = gl_VertexID == 2 ? 2.0 : 0.0;
  gl_Position = vec4(vec2(x, y) * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const VFD_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uMask;
uniform vec2 uRes;
uniform float uMesh;
uniform float uTime;
uniform float uFade;
uniform vec4 uFil;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float hexEdge(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec2 a = mod(p, s) - s * 0.5;
  vec2 b = mod(p - s * 0.5, s) - s * 0.5;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  vec2 q = abs(gv);
  return max(dot(q, normalize(s)), q.x);
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = frag / uRes;
  vec2 tuv = uv;
  vec3 s = textureLod(uScene, tuv, 0.0).rgb;
  vec3 soft = textureLod(uScene, tuv, 1.0).rgb;
  vec3 bloom = textureLod(uScene, tuv, 2.5).rgb * 0.5 + textureLod(uScene, tuv, 4.0).rgb * 0.55 + textureLod(uScene, tuv, 5.5).rgb * 0.6;
  float mask = textureLod(uMask, tuv, 0.0).r;

  float e = hexEdge(frag / uMesh);
  float w = 0.1;
  float aa = 1.2 / uMesh;
  float line = smoothstep(0.5 - w - aa, 0.5 - w + aa * 0.5, e);

  float fil = 0.0;
  for (int i = 0; i < 4; i++) {
    float y = uFil[i];
    if (y <= 0.0) continue;
    float d = abs(frag.y - y);
    fil += 1.0 - smoothstep(0.0, 0.9, d);
  }

  vec3 lit = mix(s, soft, 0.35);
  vec3 col = lit * (1.0 - 0.5 * line * mask) * (1.0 - 0.35 * fil * mask);
  col += bloom * 0.55;
  col += vec3(0.5, 0.62, 0.66) * 0.022 * line * mask;
  col += vec3(0.6, 0.45, 0.35) * 0.012 * fil * mask;

  vec2 c = uv * 2.0 - 1.0;
  vec3 glass = vec3(0.006, 0.012, 0.014) * (1.0 - 0.4 * dot(c, c));
  vec2 rp = (c - vec2(-0.35, -0.9)) * vec2(0.55, 1.6);
  glass += vec3(0.5, 0.62, 0.66) * 0.035 * (1.0 - smoothstep(0.0, 1.0, length(rp)));
  glass += vec3(0.5, 0.62, 0.66) * 0.012 * smoothstep(0.3, 1.0, -c.y) * (0.5 + 0.5 * c.x);
  col += glass;
  col = 1.0 - exp(-col * 1.25);
  col += (hash(frag + fract(uTime * 7.1) * 51.0) - 0.5) * 0.008;
  outColor = vec4(col * uFade, 1.0);
}
`;
