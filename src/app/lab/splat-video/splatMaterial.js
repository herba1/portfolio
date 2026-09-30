import * as THREE from "three";

import { RENDER, TEXTURE_WIDTH, isFlipbook } from "./splatVideoParams";

export const SPLAT_VERTEX = `
precision highp float;
precision highp int;

uniform highp usampler2D uBase;
uniform highp usampler2D uStatic;
uniform highp usampler2DArray uDynamic;
uniform int uStaticCount;
uniform int uFrame0;
uniform int uFrame1;
uniform float uBlend;
uniform vec3 uBoundsMin;
uniform vec3 uBoundsSize;
uniform float uCovScale;
uniform vec2 uViewport;
uniform float uLowPass;

in float aSplat;

out vec4 vColor;
out vec2 vPosition;

const int TEXTURE_WIDTH = ${TEXTURE_WIDTH};
const float MAX_AXIS = 1024.0;
const float MIN_DEPTH = 0.02;
const float FRUSTUM_GUARD = 1.2;

ivec2 texelFor(int index) {
  return ivec2(index % TEXTURE_WIDTH, index / TEXTURE_WIDTH);
}

void cull() {
  gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
  vColor = vec4(0.0);
  vPosition = vec2(0.0);
}

void main() {
  int index = int(aSplat + 0.5);

  vec4 point;
  if (index < uStaticCount) {
    point = vec4(texelFetch(uStatic, texelFor(index), 0));
  } else {
    ivec2 cell = texelFor(index - uStaticCount);
    vec4 fromPoint = vec4(texelFetch(uDynamic, ivec3(cell, uFrame0), 0));
    vec4 toPoint = vec4(texelFetch(uDynamic, ivec3(cell, uFrame1), 0));
    point = mix(fromPoint, toPoint, uBlend);
  }

  vec3 center = uBoundsMin + point.xyz * (1.0 / 65535.0) * uBoundsSize;
  float opacity = point.w * (1.0 / 65535.0);

  vec4 viewCenter = modelViewMatrix * vec4(center, 1.0);
  float depth = -viewCenter.z;
  vec4 clipCenter = projectionMatrix * viewCenter;
  float guard = FRUSTUM_GUARD * clipCenter.w;
  if (depth < MIN_DEPTH || opacity < 0.004 || abs(clipCenter.x) > guard || abs(clipCenter.y) > guard) {
    cull();
    return;
  }

  uvec4 base = texelFetch(uBase, texelFor(index), 0);
  vec2 xxXy = unpackHalf2x16(base.x);
  vec2 xzYy = unpackHalf2x16(base.y);
  vec2 yzZz = unpackHalf2x16(base.z);
  mat3 covariance = mat3(
    xxXy.x, xxXy.y, xzYy.x,
    xxXy.y, xzYy.y, yzZz.x,
    xzYy.x, yzZz.x, yzZz.y
  ) / uCovScale;

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
  float lambda2 = mid - radius;
  if (lambda2 <= 0.0) {
    cull();
    return;
  }

  vec2 axis = abs(b) > 1e-7 ? normalize(vec2(b, lambda1 - a)) : (a >= c ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  vec2 majorAxis = min(sqrt(2.0 * lambda1), MAX_AXIS) * axis;
  vec2 minorAxis = min(sqrt(2.0 * lambda2), MAX_AXIS) * vec2(-axis.y, axis.x);

  vec2 offsetPixels = position.x * majorAxis + position.y * minorAxis;
  vec2 ndcCenter = clipCenter.xy / clipCenter.w;
  gl_Position = vec4(ndcCenter + offsetPixels * 2.0 / uViewport, 0.0, 1.0);

  uint rgba = base.w;
  vColor = vec4(
    float(rgba & 255u) / 255.0,
    float((rgba >> 8u) & 255u) / 255.0,
    float((rgba >> 16u) & 255u) / 255.0,
    opacity
  );
  vPosition = position.xy;
}
`;

export const SPLAT_FRAGMENT = `
precision highp float;

in vec4 vColor;
in vec2 vPosition;

out vec4 fragColor;

void main() {
  float r2 = dot(vPosition, vPosition);
  if (r2 > 4.0) discard;
  float alpha = min(0.99, exp(-r2) * vColor.a);
  if (alpha < 1.0 / 255.0) discard;
  fragColor = vec4(vColor.rgb * alpha, alpha);
}
`;

function integerTexture(texture) {
  texture.format = THREE.RGBAIntegerFormat;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.unpackAlignment = 4;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createSplatTextures(clip) {
  const { base, staticPoints, dynamicPoints, layout, meta } = clip;
  const baseTexture = integerTexture(
    new THREE.DataTexture(base, layout.width, layout.baseRows, THREE.RGBAIntegerFormat, THREE.UnsignedIntType),
  );
  baseTexture.internalFormat = "RGBA32UI";
  const staticTexture = integerTexture(
    new THREE.DataTexture(staticPoints, layout.width, layout.staticRows, THREE.RGBAIntegerFormat, THREE.UnsignedShortType),
  );
  staticTexture.internalFormat = "RGBA16UI";
  const flipbook = isFlipbook(meta);
  const dynamicTexture = new THREE.DataArrayTexture(
    dynamicPoints,
    flipbook ? 1 : layout.width,
    layout.dynamicRows,
    flipbook ? 1 : meta.frames,
  );
  dynamicTexture.type = THREE.UnsignedShortType;
  integerTexture(dynamicTexture);
  dynamicTexture.internalFormat = "RGBA16UI";
  return {
    baseTexture,
    staticTexture,
    dynamicTexture,
    dispose() {
      baseTexture.dispose();
      staticTexture.dispose();
      dynamicTexture.dispose();
    },
  };
}

export function createSplatMaterial(textures, meta) {
  const { min, max } = meta.bounds;
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: SPLAT_VERTEX,
    fragmentShader: SPLAT_FRAGMENT,
    uniforms: {
      uBase: { value: textures.baseTexture },
      uStatic: { value: textures.staticTexture },
      uDynamic: { value: textures.dynamicTexture },
      uStaticCount: { value: isFlipbook(meta) ? meta.count : meta.staticCount },
      uFrame0: { value: 0 },
      uFrame1: { value: 0 },
      uBlend: { value: 0 },
      uBoundsMin: { value: new THREE.Vector3(min[0], min[1], min[2]) },
      uBoundsSize: { value: new THREE.Vector3(max[0] - min[0], max[1] - min[1], max[2] - min[2]) },
      uCovScale: { value: meta.covScale },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uLowPass: { value: RENDER.lowPass },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

export function createSplatGeometry(count) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const order = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
  order.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aSplat", order);
  geometry.instanceCount = 0;
  return geometry;
}
