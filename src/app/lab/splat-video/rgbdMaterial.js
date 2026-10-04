import * as THREE from "three";

import { HYBRID, RGBD } from "./splatVideoParams";

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
    vec2 diagonal = vec2(uGridStep.x, -uGridStep.y);
    tear = max(
      max(
        max(jumpTo(aGrid - across, level, disparity), jumpTo(aGrid + across, level, disparity)),
        max(jumpTo(aGrid - down, level, disparity), jumpTo(aGrid + down, level, disparity))
      ),
      max(jumpTo(aGrid - diagonal, level, disparity), jumpTo(aGrid + diagonal, level, disparity))
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

const ROOM_VERTEX = `
precision highp float;

uniform sampler2D uPlate;
uniform vec2 uPlateTexel;
uniform vec2 uTanHalf;
uniform vec2 uDisparity;
uniform float uLevelShift;

in vec2 aGrid;

out vec2 vGrid;

const float MIN_DISPARITY = 0.01;

void main() {
  float s = clamp(aGrid.x, 0.5 * uPlateTexel.x, 1.0 - 0.5 * uPlateTexel.x);
  float t = clamp(0.5 + 0.5 * aGrid.y, 0.5 + 0.5 * uPlateTexel.y, 1.0 - 0.5 * uPlateTexel.y);
  float level = clamp(textureLod(uPlate, vec2(s, t), 0.0).r + uLevelShift, 0.0, 1.0);
  float depth = 1.0 / max(mix(uDisparity.x, uDisparity.y, level), MIN_DISPARITY);
  vec3 point = vec3((aGrid - 0.5) * 2.0 * uTanHalf * depth, depth);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
  vGrid = aGrid;
}
`;

const ROOM_FRAGMENT = `
precision highp float;

uniform sampler2D uMap;
uniform sampler2D uPlate;
uniform vec4 uColorRect;
uniform vec4 uAlphaRect;
uniform vec2 uColorTexel;
uniform vec2 uAlphaTexel;
uniform vec2 uPlateTexel;
uniform vec3 uGain;
uniform float uCoverRadius;
uniform float uLean;
uniform vec2 uCoverRamp;

in vec2 vGrid;

out vec4 fragColor;

const vec2 RING[8] = vec2[8](
  vec2(1.0, 0.0), vec2(0.7071, 0.7071), vec2(0.0, 1.0), vec2(-0.7071, 0.7071),
  vec2(-1.0, 0.0), vec2(-0.7071, -0.7071), vec2(0.0, -1.0), vec2(0.7071, -0.7071)
);

vec2 inside(vec2 grid, vec2 texel) {
  return clamp(grid, 0.5 * texel, 1.0 - 0.5 * texel);
}

float coverAt(vec2 grid) {
  return texture(uMap, uAlphaRect.xy + inside(grid, uAlphaTexel) * uAlphaRect.zw).r;
}

void main() {
  float reach = uCoverRadius * uLean;
  float cover = coverAt(vGrid);
  for (int i = 0; i < 8; i++) {
    cover = max(cover, coverAt(vGrid + RING[i] * reach * uAlphaTexel));
    cover = max(cover, coverAt(vGrid + RING[i] * 0.5 * reach * uAlphaTexel));
  }
  vec3 live = texture(uMap, uColorRect.xy + inside(vGrid, uColorTexel) * uColorRect.zw).rgb;
  vec2 plateUv = vec2(clamp(vGrid.x, 0.5 * uPlateTexel.x, 1.0 - 0.5 * uPlateTexel.x), clamp(0.5 * vGrid.y, 0.5 * uPlateTexel.y, 0.5 - 0.5 * uPlateTexel.y));
  vec3 plate = min(texture(uPlate, plateUv).rgb * uGain, vec3(1.0));
  fragColor = vec4(mix(live, plate, smoothstep(uCoverRamp.x, uCoverRamp.y, cover)), 1.0);
}
`;

export function normalizedRect(rect, width, height) {
  return new THREE.Vector4(rect[0] / width, rect[1] / height, rect[2] / width, rect[3] / height);
}

export function bandTexel(rect) {
  return stackedTexel(rect[2], rect[3]);
}

export function createLayerGrid(layout, isMobile) {
  const stride = isMobile ? HYBRID.mobileGridStride : 1;
  const columns = Math.max(2, Math.round(layout.depth[2] / stride));
  const rows = Math.max(2, Math.round(layout.depth[3] / stride));
  return { columns, rows, grid: new THREE.Vector2(1 / columns, 1 / rows), geometry: createRgbdGeometry(columns, rows) };
}

export function createRoomMaterial(texture, plateTexture, meta) {
  const { layout, layers } = meta;
  const tanVertical = Math.tan((meta.camera.vfovDeg * DEG) / 2);
  const plateImage = plateTexture.image;
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: ROOM_VERTEX,
    fragmentShader: ROOM_FRAGMENT,
    uniforms: {
      uMap: { value: texture },
      uPlate: { value: plateTexture },
      uColorRect: { value: normalizedRect(layout.color, layout.width, layout.height) },
      uAlphaRect: { value: normalizedRect(layout.alpha, layout.width, layout.height) },
      uColorTexel: { value: bandTexel(layout.color) },
      uAlphaTexel: { value: bandTexel(layout.alpha) },
      uPlateTexel: { value: stackedTexel(plateImage.width, plateImage.height) },
      uTanHalf: { value: new THREE.Vector2(tanVertical * meta.camera.aspect, tanVertical) },
      uDisparity: { value: new THREE.Vector2(meta.disparity.min, meta.disparity.max) },
      uLevelShift: { value: -RGBD.platePushLevels / LEVELS },
      uGain: { value: new THREE.Vector3(1, 1, 1) },
      uCoverRadius: { value: layers.coverRadius },
      uLean: { value: 0 },
      uCoverRamp: { value: new THREE.Vector2(layers.coverLow, layers.coverHigh) },
    },
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
    transparent: false,
  });
}

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
