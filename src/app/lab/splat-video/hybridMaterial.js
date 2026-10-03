import * as THREE from "three";

import { HYBRID } from "./splatVideoParams";

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

const POINT_VERTEX = `
precision highp float;

uniform sampler2D uMap;
uniform vec4 uColorRect;
uniform vec4 uDepthRect;
uniform vec4 uAlphaRect;
uniform vec2 uColorTexel;
uniform vec2 uDepthTexel;
uniform vec2 uAlphaTexel;
uniform vec2 uGridStep;
uniform vec2 uTanHalf;
uniform vec2 uDisparity;
uniform vec2 uAlphaRamp;
uniform float uAlphaCutoff;
uniform float uBorderFeather;
uniform float uPixelsPerUnit;
uniform float uPointScale;

in vec2 aGrid;

out vec3 vColor;
out float vAlpha;

const float MIN_DISPARITY = 0.01;

vec2 inside(vec2 grid, vec2 texel) {
  return clamp(grid, 0.5 * texel, 1.0 - 0.5 * texel);
}

void main() {
  float level = textureLod(uMap, uDepthRect.xy + inside(aGrid, uDepthTexel) * uDepthRect.zw, 0.0).r;
  float depth = 1.0 / max(mix(uDisparity.x, uDisparity.y, level), MIN_DISPARITY);
  vec3 point = vec3((aGrid - 0.5) * 2.0 * uTanHalf * depth, depth);
  vec4 view = modelViewMatrix * vec4(point, 1.0);
  gl_Position = projectionMatrix * view;

  vec2 edges = min(aGrid, 1.0 - aGrid);
  float border = smoothstep(0.0, uBorderFeather, min(edges.x, edges.y));
  float coverage = textureLod(uMap, uAlphaRect.xy + inside(aGrid, uAlphaTexel) * uAlphaRect.zw, 0.0).r;
  vAlpha = smoothstep(uAlphaRamp.x, uAlphaRamp.y, coverage) * border;
  vColor = textureLod(uMap, uColorRect.xy + inside(aGrid, uColorTexel) * uColorRect.zw, 0.0).rgb;

  float cell = 2.0 * uTanHalf.y * depth * uGridStep.y;
  gl_PointSize = max(1.0, uPointScale * cell * uPixelsPerUnit / max(-view.z, 1e-4));
  if (vAlpha < uAlphaCutoff) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const POINT_FRAGMENT = `
precision highp float;

in vec3 vColor;
in float vAlpha;

out vec4 fragColor;

void main() {
  vec2 offset = gl_PointCoord * 2.0 - 1.0;
  float radius = dot(offset, offset);
  if (radius > 1.0) discard;
  float alpha = vAlpha * exp(-2.5 * radius);
  fragColor = vec4(vColor * alpha, alpha);
}
`;

function normalizedRect(rect, width, height) {
  const [x, y, w, h] = rect;
  return new THREE.Vector4(x / width, y / height, w / width, h / height);
}

function bandTexel(rect) {
  return new THREE.Vector2(1 / Math.max(1, rect[2]), 1 / Math.max(1, rect[3]));
}

export function createDepthMaterial(texture, meta, grid) {
  const material = createLayerMaterial(texture, meta, { core: true, grid });
  material.colorWrite = false;
  material.polygonOffset = true;
  material.polygonOffsetFactor = HYBRID.depthOffset;
  material.polygonOffsetUnits = HYBRID.depthOffset;
  return material;
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

export function createPointsGeometry(grid) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("aGrid", grid);
  geometry.setDrawRange(0, grid.count);
  return geometry;
}

export function createPointsMaterial(texture, meta, grid) {
  const { layout } = meta;
  const tanVertical = Math.tan((meta.camera.vfovDeg * DEG) / 2);
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: POINT_VERTEX,
    fragmentShader: POINT_FRAGMENT,
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
      uAlphaRamp: { value: new THREE.Vector2(HYBRID.alphaLow, HYBRID.alphaHigh) },
      uAlphaCutoff: { value: HYBRID.alphaCutoff },
      uBorderFeather: { value: HYBRID.borderFeather },
      uPixelsPerUnit: { value: 1 },
      uPointScale: { value: HYBRID.pointScale },
    },
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}
