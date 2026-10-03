import * as THREE from "three";

import { HYBRID, SURFEL } from "./splatVideoParams";

const DEG = Math.PI / 180;
const LEVELS = 255;

const LAYER_VERTEX = `
precision highp float;

uniform sampler2D uMap;
uniform vec4 uDepthRect;
uniform vec2 uDepthTexel;
uniform vec2 uGridStep;
uniform vec2 uTanHalf;
uniform vec2 uDisparity;
uniform float uTearRelative;
uniform float uTearMinStep;

in vec2 aGrid;

out vec2 vGrid;
out float vTear;

const float MIN_DISPARITY = 0.01;

vec2 inside(vec2 grid, vec2 texel) {
  return clamp(grid, 0.5 * texel, 1.0 - 0.5 * texel);
}

float levelAt(vec2 grid) {
  vec2 local = inside(grid, uDepthTexel);
  return textureLod(uMap, uDepthRect.xy + local * uDepthRect.zw, 0.0).r;
}

float disparityOf(float level) {
  return max(mix(uDisparity.x, uDisparity.y, level), MIN_DISPARITY);
}

float jumpTo(vec2 grid, float level, float disparity) {
  float otherLevel = levelAt(grid);
  float otherDisparity = disparityOf(otherLevel);
  float relative = abs(otherDisparity - disparity) / min(otherDisparity, disparity);
  return step(uTearMinStep, abs(otherLevel - level)) * relative / uTearRelative;
}

void main() {
  float level = levelAt(aGrid);
  float disparity = disparityOf(level);
  float depth = 1.0 / disparity;
  vec3 point = vec3((aGrid - 0.5) * 2.0 * uTanHalf * depth, depth);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
  vGrid = aGrid;

  vec2 across = vec2(uGridStep.x, 0.0);
  vec2 down = vec2(0.0, uGridStep.y);
  vTear = max(
    max(jumpTo(aGrid - across, level, disparity), jumpTo(aGrid + across, level, disparity)),
    max(jumpTo(aGrid - down, level, disparity), jumpTo(aGrid + down, level, disparity))
  );
}
`;

const LAYER_FRAGMENT = `
precision highp float;

uniform sampler2D uMap;
uniform vec4 uColorRect;
uniform vec4 uAlphaRect;
uniform vec2 uColorTexel;
uniform vec2 uAlphaTexel;
uniform vec2 uAlphaRamp;
uniform float uAlphaCutoff;
uniform float uCore;
uniform float uBorderFeather;

in vec2 vGrid;
in float vTear;

out vec4 fragColor;

vec2 inside(vec2 grid, vec2 texel) {
  return clamp(grid, 0.5 * texel, 1.0 - 0.5 * texel);
}

void main() {
  if (vTear > 1.0) discard;
  float coverage = texture(uMap, uAlphaRect.xy + inside(vGrid, uAlphaTexel) * uAlphaRect.zw).r;
  vec2 edges = min(vGrid, 1.0 - vGrid);
  float border = smoothstep(0.0, uBorderFeather, min(edges.x, edges.y));
  float alpha = smoothstep(uAlphaRamp.x, uAlphaRamp.y, coverage) * border;
#ifdef CORE
  if (alpha < uCore) discard;
  fragColor = vec4(texture(uMap, uColorRect.xy + inside(vGrid, uColorTexel) * uColorRect.zw).rgb, 1.0);
#else
  if (alpha >= uCore || alpha < uAlphaCutoff) discard;
  vec3 color = texture(uMap, uColorRect.xy + inside(vGrid, uColorTexel) * uColorRect.zw).rgb;
  fragColor = vec4(color * alpha, alpha);
#endif
}
`;

const SURFEL_VERTEX = `
precision highp float;
precision highp int;

uniform sampler2D uMap;
uniform vec4 uColorRect;
uniform vec4 uDepthRect;
uniform vec4 uAlphaRect;
uniform vec2 uColorTexel;
uniform vec2 uDepthTexel;
uniform vec2 uAlphaTexel;
uniform ivec2 uGrid;
uniform vec2 uTanHalf;
uniform vec2 uDisparity;
uniform vec2 uAlphaRamp;
uniform float uAlphaCutoff;
uniform float uCore;
uniform float uBorderFeather;
uniform vec2 uViewport;
uniform float uLowPass;
uniform float uSpread;
uniform float uExtent;
uniform float uEdgeStretch;
uniform float uLoosen;
uniform float uLoosenSpread;
uniform float uLoosenOpacity;
uniform float uLoosenExtent;
uniform int uLoosenStride;
uniform float uLift;

out vec4 vColor;
out vec2 vOffset;
out float vExtent;

const float MIN_DISPARITY = 0.01;
const float MIN_DEPTH = 0.02;

vec2 inside(vec2 grid, vec2 texel) {
  return clamp(grid, 0.5 * texel, 1.0 - 0.5 * texel);
}

vec3 pointAt(vec2 grid) {
  float level = textureLod(uMap, uDepthRect.xy + inside(grid, uDepthTexel) * uDepthRect.zw, 0.0).r;
  float depth = 1.0 / max(mix(uDisparity.x, uDisparity.y, level), MIN_DISPARITY);
  return vec3((grid - 0.5) * 2.0 * uTanHalf * depth, depth);
}

vec3 shorter(vec3 forward, vec3 backward, float limit) {
  vec3 tangent = dot(forward, forward) < dot(backward, backward) ? forward : backward;
  float size = length(tangent);
  return size > limit ? tangent * (limit / size) : tangent;
}

void cull() {
  gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
  vColor = vec4(0.0);
  vOffset = vec2(0.0);
  vExtent = 0.0;
}

void main() {
  vec2 step = 1.0 / vec2(uGrid);
  ivec2 cell = ivec2(gl_InstanceID % uGrid.x, gl_InstanceID / uGrid.x);
  vec2 grid = (vec2(cell) + 0.5) * step;

  vec2 edges = min(grid, 1.0 - grid);
  float border = smoothstep(0.0, uBorderFeather, min(edges.x, edges.y));
  float coverage = textureLod(uMap, uAlphaRect.xy + inside(grid, uAlphaTexel) * uAlphaRect.zw, 0.0).r;
  float alpha = smoothstep(uAlphaRamp.x, uAlphaRamp.y, coverage) * border;
#ifdef CORE
  if (alpha < uCore) {
    cull();
    return;
  }
  float spread = uSpread;
  float extent = uExtent;
  float lift = 0.0;
#else
  bool solid = alpha >= uCore;
  bool sampled = cell.x % uLoosenStride == 0 && cell.y % uLoosenStride == 0;
  if ((solid && (uLoosen <= 0.0 || !sampled)) || alpha < uAlphaCutoff) {
    cull();
    return;
  }
  float spread = solid ? uSpread * mix(1.0, uLoosenSpread, uLoosen) : uSpread;
  float extent = solid ? uLoosenExtent : uExtent;
  float lift = uLift * uLoosen;
  if (solid) alpha *= uLoosen * uLoosenOpacity;
#endif

  vec3 center = pointAt(grid);
  vec2 footprint = 2.0 * uTanHalf * center.z * step;
  vec3 across = shorter(pointAt(grid + vec2(step.x, 0.0)) - center, center - pointAt(grid - vec2(step.x, 0.0)), uEdgeStretch * footprint.x);
  vec3 down = shorter(pointAt(grid + vec2(0.0, step.y)) - center, center - pointAt(grid - vec2(0.0, step.y)), uEdgeStretch * footprint.y);
  vec3 normal = cross(across, down);
  normal = dot(normal, normal) > 1e-20 ? normalize(normal) : vec3(0.0, 0.0, 1.0);
  float thickness = 0.05 * min(footprint.x, footprint.y);
  mat3 covariance = spread * spread * (outerProduct(across, across) + outerProduct(down, down))
    + thickness * thickness * outerProduct(normal, normal);

  vec4 viewCenter = modelViewMatrix * vec4(center, 1.0);
  float depth = -viewCenter.z;
  vec4 clipCenter = projectionMatrix * viewCenter;
  if (depth < MIN_DEPTH) {
    cull();
    return;
  }

  vec2 focal = vec2(projectionMatrix[0][0], projectionMatrix[1][1]) * 0.5 * uViewport;
  float inverseDepth = 1.0 / depth;
  float inverseDepth2 = inverseDepth * inverseDepth;
  mat3 jacobian = mat3(
    focal.x * inverseDepth, 0.0, 0.0,
    0.0, focal.y * inverseDepth, 0.0,
    focal.x * viewCenter.x * inverseDepth2, focal.y * viewCenter.y * inverseDepth2, 0.0
  );
  mat3 toScreen = jacobian * mat3(modelViewMatrix);
  mat3 projected = toScreen * covariance * transpose(toScreen);

  float a = projected[0][0] + uLowPass;
  float b = projected[0][1];
  float c = projected[1][1] + uLowPass;
  float mid = 0.5 * (a + c);
  float radius = length(vec2(0.5 * (a - c), b));
  float lambda1 = mid + radius;
  float lambda2 = max(mid - radius, 1e-6);
  vec2 axis = abs(b) > 1e-7 ? normalize(vec2(b, lambda1 - a)) : (a >= c ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  vec2 offsetPixels = position.x * extent * sqrt(lambda1) * axis + position.y * extent * sqrt(lambda2) * vec2(-axis.y, axis.x);

  gl_Position = vec4(clipCenter.xy / clipCenter.w + offsetPixels * 2.0 / uViewport, clipCenter.z / clipCenter.w - lift, 1.0);
  vOffset = position.xy * extent;
  vExtent = extent;
  vColor = vec4(textureLod(uMap, uColorRect.xy + inside(grid, uColorTexel) * uColorRect.zw, 0.0).rgb, alpha);
}
`;

const SURFEL_FRAGMENT = `
precision highp float;

uniform float uCone;

in vec4 vColor;
in vec2 vOffset;
in float vExtent;

out vec4 fragColor;

void main() {
  float radius = dot(vOffset, vOffset);
  if (radius > vExtent * vExtent) discard;
#ifdef CORE
  gl_FragDepth = gl_FragCoord.z + uCone * radius / (vExtent * vExtent);
  fragColor = vec4(vColor.rgb, 1.0);
#else
  float alpha = vColor.a * exp(-0.5 * radius);
  if (alpha < 1.0 / 255.0) discard;
  fragColor = vec4(vColor.rgb * alpha, alpha);
#endif
}
`;

function normalizedRect(rect, width, height) {
  const [x, y, w, h] = rect;
  return new THREE.Vector4(x / width, y / height, w / width, h / height);
}

function bandTexel(rect) {
  return new THREE.Vector2(1 / Math.max(1, rect[2]), 1 / Math.max(1, rect[3]));
}

export function createLayerMaterial(texture, meta, { core, grid }) {
  const { layout } = meta;
  const tanVertical = Math.tan((meta.camera.vfovDeg * DEG) / 2);
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: LAYER_VERTEX,
    fragmentShader: LAYER_FRAGMENT,
    uniforms: {
      uMap: { value: texture },
      uColorRect: { value: normalizedRect(layout.color, layout.width, layout.height) },
      uDepthRect: { value: normalizedRect(layout.depth, layout.width, layout.height) },
      uAlphaRect: { value: normalizedRect(layout.alpha, layout.width, layout.height) },
      uColorTexel: { value: bandTexel(layout.color) },
      uDepthTexel: { value: bandTexel(layout.depth) },
      uAlphaTexel: { value: bandTexel(layout.alpha) },
      uGridStep: { value: grid.clone() },
      uTanHalf: { value: new THREE.Vector2(tanVertical * meta.camera.aspect, tanVertical) },
      uDisparity: { value: new THREE.Vector2(meta.disparity.min, meta.disparity.max) },
      uTearRelative: { value: HYBRID.tearRelative },
      uTearMinStep: { value: HYBRID.tearMinLevels / LEVELS },
      uAlphaRamp: { value: new THREE.Vector2(HYBRID.alphaLow, HYBRID.alphaHigh) },
      uAlphaCutoff: { value: HYBRID.alphaCutoff },
      uCore: { value: HYBRID.coreAlpha },
      uBorderFeather: { value: HYBRID.borderFeather },
    },
    defines: core ? { CORE: "" } : {},
    side: THREE.DoubleSide,
    forceSinglePass: true,
    transparent: !core,
    depthTest: true,
    depthWrite: core,
    blending: core ? THREE.NoBlending : THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}

export function createSurfelGeometry(columns, rows) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.instanceCount = columns * rows;
  return geometry;
}

export function createSurfelMaterial(texture, meta, { core, columns, rows }) {
  const { layout } = meta;
  const tanVertical = Math.tan((meta.camera.vfovDeg * DEG) / 2);
  const look = core ? SURFEL.core : SURFEL.rim;
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: SURFEL_VERTEX,
    fragmentShader: SURFEL_FRAGMENT,
    defines: core ? { CORE: "" } : {},
    uniforms: {
      uMap: { value: texture },
      uColorRect: { value: normalizedRect(layout.color, layout.width, layout.height) },
      uDepthRect: { value: normalizedRect(layout.depth, layout.width, layout.height) },
      uAlphaRect: { value: normalizedRect(layout.alpha, layout.width, layout.height) },
      uColorTexel: { value: bandTexel(layout.color) },
      uDepthTexel: { value: bandTexel(layout.depth) },
      uAlphaTexel: { value: bandTexel(layout.alpha) },
      uGrid: { value: [columns, rows] },
      uTanHalf: { value: new THREE.Vector2(tanVertical * meta.camera.aspect, tanVertical) },
      uDisparity: { value: new THREE.Vector2(meta.disparity.min, meta.disparity.max) },
      uAlphaRamp: { value: new THREE.Vector2(HYBRID.alphaLow, HYBRID.alphaHigh) },
      uAlphaCutoff: { value: HYBRID.alphaCutoff },
      uCore: { value: HYBRID.coreAlpha },
      uBorderFeather: { value: HYBRID.borderFeather },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uLowPass: { value: look.lowPass },
      uSpread: { value: look.spread },
      uExtent: { value: look.extent },
      uEdgeStretch: { value: SURFEL.edgeStretch },
      uCone: { value: SURFEL.cone },
      uLoosen: { value: 0 },
      uLoosenSpread: { value: SURFEL.loosen.spread },
      uLoosenOpacity: { value: SURFEL.loosen.opacity },
      uLoosenExtent: { value: SURFEL.loosen.extent },
      uLoosenStride: { value: SURFEL.loosen.stride },
      uLift: { value: SURFEL.loosen.lift },
    },
    transparent: !core,
    depthTest: true,
    depthWrite: core,
    blending: core ? THREE.NoBlending : THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}
