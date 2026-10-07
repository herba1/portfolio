export const GRID_VERTEX = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const GRID_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uState;
uniform sampler2D uCover;
uniform sampler2D uCells;
uniform sampler2D uPicture;
uniform vec2 uGrid;
uniform float uCellPx;
uniform float uGap;
uniform vec3 uEmpty;
uniform vec3 uInk;
uniform vec4 uBrush;
uniform vec4 uPoke;
uniform float uLattice;
uniform float uFuse;
uniform float uDpr;
in vec2 vUv;
out vec4 outColor;

bool pictureAt(ivec2 cell) {
  if (cell.x < 0 || cell.y < 0 || cell.x >= int(uGrid.x) || cell.y >= int(uGrid.y)) return true;
  return texelFetch(uPicture, cell, 0).r > 0.5;
}

float roundedBox(vec2 q, float halfSize, float radius) {
  vec2 d = abs(q) - vec2(halfSize - radius);
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;
}

vec3 contrastInk(vec3 under) {
  float light = dot(under, vec3(0.2126, 0.7152, 0.0722));
  return light > 0.46 ? uInk : vec3(1.0);
}

void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uGrid;
  ivec2 cell = ivec2(floor(p));
  vec2 local = fract(p) - 0.5;
  float pixel = 1.0 / uCellPx;
  vec4 state = texelFetch(uState, cell, 0);
  int kind = int(state.b * 255.0 + 0.5);
  float brushDistance = length(p - uBrush.xy);
  float near = uBrush.w * (1.0 - smoothstep(uBrush.z * 0.2, uBrush.z * 1.15, brushDistance));
  vec3 colour = uEmpty;
  float beadHalf = 0.5 - uGap * 0.5;
  vec3 image = texture(uCover, p / uGrid.x).rgb;
  float beadShade = mix(1.045, 0.975, smoothstep(-0.3, 0.3, local.y));

  float pictureValue = texelFetch(uPicture, cell, 0).r;
  if (pictureValue > 0.5) {
    ivec2 sideX = ivec2(local.x < 0.0 ? -1 : 1, 0);
    ivec2 sideY = ivec2(0, local.y < 0.0 ? -1 : 1);
    bool openX = !pictureAt(cell + sideX);
    bool openY = !pictureAt(cell + sideY);
    float corner = (openX && openY) ? 0.38 : 0.0;
    float edge = roundedBox(local, 0.5, corner);
    float bead = roundedBox(local, beadHalf, 0.36 * beadHalf * 2.0);
    float lattice = uLattice + 0.62 * near;
    float seam = smoothstep(-0.16, 0.04, bead);
    float lift = mix(1.035, 0.985, smoothstep(-0.32, 0.32, local.y));
    vec3 grained = image * mix(1.0, lift, lattice) * (1.0 - lattice * seam * 0.34);
    float fuse = uFuse * step(pictureValue, 0.998);
    if (fuse > 0.0) {
      vec3 sand = texelFetch(uCells, cell, 0).rgb * beadShade;
      vec3 beaded = mix(uEmpty, sand, clamp(0.5 - bead / pixel, 0.0, 1.0));
      grained = mix(grained, beaded, fuse);
    }
    float inside = clamp(0.5 - edge / pixel, 0.0, 1.0);
    colour = mix(uEmpty, grained, inside);
  }

  if (kind == 2) {
    ivec2 home = ivec2(state.r * 255.0 + 0.5, state.g * 255.0 + 0.5);
    vec3 grain = texelFetch(uCells, home, 0).rgb * beadShade;
    float bead = roundedBox(local, beadHalf, 0.36 * beadHalf * 2.0);
    float inside = clamp(0.5 - bead / pixel, 0.0, 1.0);
    colour = mix(colour, grain, inside);
  }

  float ringPx = abs(brushDistance - uBrush.z) * uCellPx;
  float ringLine = 1.0 - smoothstep(0.7 * uDpr, 0.7 * uDpr + 1.0, ringPx);
  float dotPx = brushDistance * uCellPx;
  float centreDot = 1.0 - smoothstep(1.1 * uDpr, 1.1 * uDpr + 1.0, dotPx);
  colour = mix(colour, contrastInk(colour), max(ringLine * 0.72, centreDot * 0.9) * uBrush.w);

  float pokeAge = uPoke.z;
  float pokeRadius = uPoke.w * (0.25 + 0.75 * (1.0 - pow(1.0 - pokeAge, 3.0)));
  float pokePx = abs(length(p - uPoke.xy) - pokeRadius) * uCellPx;
  float pokeLine = (1.0 - smoothstep(0.7 * uDpr, 0.7 * uDpr + 1.0, pokePx)) * (1.0 - pokeAge) * step(pokeAge, 0.999);
  colour = mix(colour, contrastInk(colour), pokeLine * 0.6);

  outColor = vec4(colour, 1.0);
}
`;

export const FLIGHT_VERTEX = `#version 300 es
precision highp float;
in vec2 aCorner;
in vec4 aPath;
in vec2 aTiming;
in vec3 aColourFrom;
in vec3 aColourTo;
uniform vec2 uGrid;
uniform float uTime;
uniform float uDuration;
uniform float uPop;
uniform float uCellPx;
out vec2 vLocal;
out vec3 vColour;
out float vPixel;

float easeOutBack(float t) {
  float u = t - 1.0;
  return 1.0 + 2.2 * u * u * u + 1.2 * u * u;
}

float easeOutCubic(float t) {
  float u = 1.0 - t;
  return 1.0 - u * u * u;
}

void main() {
  float since = uTime - aTiming.x;
  float t = clamp(since / uDuration, 0.0, 1.0);
  float travel = easeOutBack(t);
  vec2 from = aPath.xy + 0.5;
  vec2 to = aPath.zw + 0.5;
  vec2 delta = to - from;
  float span = length(delta);
  float arc = clamp(travel, 0.0, 1.0);
  vec2 position = from + delta * travel;
  position.y -= 0.18 * span * 4.0 * arc * (1.0 - arc);

  float airborne = sin(3.14159265 * t);
  float scale = mix(1.0 + 0.22 * airborne, 0.84, smoothstep(0.72, 1.0, t));
  float landed = clamp((since - uDuration) / uPop, 0.0, 1.0);
  if (landed > 0.0) {
    scale = landed < 0.55
      ? mix(0.84, 1.02, easeOutCubic(landed / 0.55))
      : mix(1.02, 1.0, smoothstep(0.0, 1.0, (landed - 0.55) / 0.45));
  }

  vec2 world = position + aCorner * scale;
  vLocal = aCorner;
  vPixel = 1.0 / max(uCellPx * scale, 0.5);
  float shift = aTiming.y * 0.12 - 0.06;
  vColour = mix(aColourFrom, aColourTo, smoothstep(0.08 + shift, 0.86 + shift, t));
  gl_Position = vec4(world.x / uGrid.x * 2.0 - 1.0, 1.0 - world.y / uGrid.y * 2.0, 0.0, 1.0);
}
`;

export const FLIGHT_FRAGMENT = `#version 300 es
precision highp float;
uniform float uGap;
in vec2 vLocal;
in vec3 vColour;
in float vPixel;
out vec4 outColor;

float roundedBox(vec2 q, float halfSize, float radius) {
  vec2 d = abs(q) - vec2(halfSize - radius);
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;
}

void main() {
  float beadHalf = 0.5 - uGap * 0.5;
  float bead = roundedBox(vLocal, beadHalf, 0.36 * beadHalf * 2.0);
  float alpha = clamp(0.5 - bead / vPixel, 0.0, 1.0);
  vec3 colour = vColour * mix(1.045, 0.975, smoothstep(-0.3, 0.3, vLocal.y));
  outColor = vec4(colour * alpha, alpha);
}
`;
