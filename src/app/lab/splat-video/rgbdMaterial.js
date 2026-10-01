import * as THREE from "three";

import { RGBD } from "./splatVideoParams";

const DEG = Math.PI / 180;
const LEVELS = 255;

export const RGBD_VERTEX = `
precision highp float;

uniform sampler2D uMap;
uniform vec2 uTexel;
uniform vec2 uGridStep;
uniform vec2 uTanHalf;
uniform vec2 uDisparity;
uniform float uLevelShift;
uniform float uTearRelative;
uniform float uTearMinStep;

in vec2 aGrid;

out vec2 vColorUv;
out float vTear;

const float MIN_DISPARITY = 0.01;

float levelAt(vec2 grid) {
  float s = clamp(grid.x, 0.5 * uTexel.x, 1.0 - 0.5 * uTexel.x);
  float t = clamp(0.5 + 0.5 * grid.y, 0.5 + 0.5 * uTexel.y, 1.0 - 0.5 * uTexel.y);
  return clamp(textureLod(uMap, vec2(s, t), 0.0).r + uLevelShift, 0.0, 1.0);
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

  vColorUv = vec2(
    clamp(aGrid.x, 0.5 * uTexel.x, 1.0 - 0.5 * uTexel.x),
    clamp(0.5 * aGrid.y, 0.5 * uTexel.y, 0.5 - 0.5 * uTexel.y)
  );

  float tear = 0.0;
  if (uTearRelative > 0.0) {
    vec2 across = vec2(uGridStep.x, 0.0);
    vec2 down = vec2(0.0, uGridStep.y);
    tear = max(
      max(jumpTo(aGrid - across, level, disparity), jumpTo(aGrid + across, level, disparity)),
      max(jumpTo(aGrid - down, level, disparity), jumpTo(aGrid + down, level, disparity))
    );
  }
  vTear = tear;
}
`;

export const RGBD_FRAGMENT = `
precision highp float;

uniform sampler2D uMap;

in vec2 vColorUv;
in float vTear;

out vec4 fragColor;

void main() {
  if (vTear > 1.0) discard;
  fragColor = vec4(texture(uMap, vColorUv).rgb, 1.0);
}
`;

export function prepareStackedTexture(texture) {
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

export function createRgbdGeometry(columns, rows) {
  const geometry = new THREE.BufferGeometry();
  const grid = new Float32Array((columns + 1) * (rows + 1) * 2);
  for (let y = 0; y <= rows; y += 1) {
    for (let x = 0; x <= columns; x += 1) {
      const vertex = (y * (columns + 1) + x) * 2;
      grid[vertex] = x / columns;
      grid[vertex + 1] = y / rows;
    }
  }
  const index = new Uint32Array(columns * rows * 6);
  let cursor = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const topLeft = y * (columns + 1) + x;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + columns + 1;
      const bottomRight = bottomLeft + 1;
      index.set([topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight], cursor);
      cursor += 6;
    }
  }
  geometry.setAttribute("aGrid", new THREE.BufferAttribute(grid, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}

export function stackedTexel(width, height) {
  return new THREE.Vector2(1 / Math.max(1, width), 1 / Math.max(1, height));
}

export function createRgbdMaterial(texture, meta, { layer }) {
  const tanVertical = Math.tan((meta.camera.vfovDeg * DEG) / 2);
  const source = meta.source;
  const width = source.colorWidth ?? source.width;
  const height = (source.colorHeight ?? source.height) * 2;
  const live = layer === "live";
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: RGBD_VERTEX,
    fragmentShader: RGBD_FRAGMENT,
    uniforms: {
      uMap: { value: texture },
      uTexel: { value: stackedTexel(width, height) },
      uGridStep: { value: new THREE.Vector2(1 / source.width, 1 / source.height) },
      uTanHalf: { value: new THREE.Vector2(tanVertical * meta.camera.aspect, tanVertical) },
      uDisparity: { value: new THREE.Vector2(meta.disparity.min, meta.disparity.max) },
      uLevelShift: { value: live ? 0 : -RGBD.platePushLevels / LEVELS },
      uTearRelative: { value: live ? RGBD.tearRelative : RGBD.plateTearRelative },
      uTearMinStep: { value: RGBD.tearMinLevels / LEVELS },
    },
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
    transparent: false,
    polygonOffset: live,
    polygonOffsetFactor: live ? -1 : 0,
    polygonOffsetUnits: live ? -4 : 0,
  });
}
