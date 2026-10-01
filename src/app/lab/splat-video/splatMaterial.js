import * as THREE from "three";

import { RENDER, TEXTURE_WIDTH, isFlipbook } from "./splatVideoParams";

const SPLAT_HEADER = `
precision highp float;
precision highp int;

uniform vec2 uViewport;
uniform float uLowPass;

in float aSplat;

out vec4 vColor;
out vec2 vPosition;

const int TEXTURE_WIDTH = ${TEXTURE_WIDTH};
const float MAX_AXIS = 1024.0;
const float MIN_DEPTH = 0.02;
const float FRUSTUM_GUARD = 1.2;
const float UNIT16 = 1.0 / 65535.0;

ivec2 texelFor(int index) {
  return ivec2(index % TEXTURE_WIDTH, index / TEXTURE_WIDTH);
}

void cull() {
  gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
  vColor = vec4(0.0);
  vPosition = vec2(0.0);
}
`;

const SPLAT_MAIN = `
void main() {
  int index = int(aSplat + 0.5);

  vec3 center;
  float opacity;
  readPoint(index, center, opacity);

  vec4 viewCenter = modelViewMatrix * vec4(center, 1.0);
  float depth = -viewCenter.z;
  vec4 clipCenter = projectionMatrix * viewCenter;
  float guard = FRUSTUM_GUARD * clipCenter.w;
  if (depth < MIN_DEPTH || opacity < 0.004 || abs(clipCenter.x) > guard || abs(clipCenter.y) > guard) {
    cull();
    return;
  }

  float covScale;
  uvec4 base = readBase(index, covScale);
  vec2 xxXy = unpackHalf2x16(base.x);
  vec2 xzYy = unpackHalf2x16(base.y);
  vec2 yzZz = unpackHalf2x16(base.z);
  mat3 covariance = mat3(
    xxXy.x, xxXy.y, xzYy.x,
    xxXy.y, xzYy.y, yzZz.x,
    xzYy.x, yzZz.x, yzZz.y
  ) / covScale;

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

const PLAYBACK_READERS = `
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
uniform highp sampler2D uVelocity;
uniform float uGlideOn;
uniform float uTime;
uniform float uMomentTime;
uniform float uHalfStep;

void readPoint(int index, out vec3 center, out float opacity) {
  vec4 point;
  vec3 drift = vec3(0.0);
  if (index < uStaticCount) {
    point = vec4(texelFetch(uStatic, texelFor(index), 0));
    if (uGlideOn > 0.5) {
      drift = texelFetch(uVelocity, texelFor(index), 0).xyz * clamp(uTime - uMomentTime, -uHalfStep, uHalfStep);
    }
  } else {
    ivec2 cell = texelFor(index - uStaticCount);
    vec4 fromPoint = vec4(texelFetch(uDynamic, ivec3(cell, uFrame0), 0));
    vec4 toPoint = vec4(texelFetch(uDynamic, ivec3(cell, uFrame1), 0));
    point = mix(fromPoint, toPoint, uBlend);
  }
  center = uBoundsMin + point.xyz * UNIT16 * uBoundsSize + drift;
  opacity = point.w * UNIT16;
}

uvec4 readBase(int index, out float covScale) {
  covScale = uCovScale;
  return texelFetch(uBase, texelFor(index), 0);
}
`;

const STREAM_READERS = `
uniform highp usampler2D uBase;
uniform highp usampler2D uStatic;
uniform highp usampler2D uChunkBase;
uniform highp usampler2D uChunkPoints;
uniform int uStaticCount;
uniform vec3 uBoundsMin;
uniform vec3 uBoundsSize;
uniform float uCovScale;
uniform vec3 uChunkBoundsMin;
uniform vec3 uChunkBoundsSize;
uniform float uChunkCovScale;
uniform highp sampler2D uChunkVelocity;
uniform float uChunkGlideOn;
uniform float uTime;
uniform float uMomentTime;
uniform float uHalfStep;

void readPoint(int index, out vec3 center, out float opacity) {
  vec4 point;
  if (index < uStaticCount) {
    point = vec4(texelFetch(uStatic, texelFor(index), 0));
    center = uBoundsMin + point.xyz * UNIT16 * uBoundsSize;
  } else {
    ivec2 cell = texelFor(index - uStaticCount);
    point = vec4(texelFetch(uChunkPoints, cell, 0));
    center = uChunkBoundsMin + point.xyz * UNIT16 * uChunkBoundsSize;
    if (uChunkGlideOn > 0.5) {
      center += texelFetch(uChunkVelocity, cell, 0).xyz * clamp(uTime - uMomentTime, -uHalfStep, uHalfStep);
    }
  }
  opacity = point.w * UNIT16;
}

uvec4 readBase(int index, out float covScale) {
  if (index < uStaticCount) {
    covScale = uCovScale;
    return texelFetch(uBase, texelFor(index), 0);
  }
  covScale = uChunkCovScale;
  return texelFetch(uChunkBase, texelFor(index - uStaticCount), 0);
}
`;

export const SPLAT_VERTEX = SPLAT_HEADER + PLAYBACK_READERS + SPLAT_MAIN;

export const STREAM_VERTEX = SPLAT_HEADER + STREAM_READERS + SPLAT_MAIN;

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
  const velocityTexture = clip.velocity ? halfFloatTexture(clip.velocity, layout.width, layout.staticRows) : null;
  return {
    baseTexture,
    staticTexture,
    dynamicTexture,
    velocityTexture,
    dispose() {
      baseTexture.dispose();
      staticTexture.dispose();
      dynamicTexture.dispose();
      if (velocityTexture) velocityTexture.dispose();
    },
  };
}

const SPLAT_MATERIAL = {
  glslVersion: THREE.GLSL3,
  fragmentShader: SPLAT_FRAGMENT,
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
};

function boundsMinOf(bounds) {
  const { min } = bounds;
  return new THREE.Vector3(min[0], min[1], min[2]);
}

function boundsSizeOf(bounds) {
  const { min, max } = bounds;
  return new THREE.Vector3(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}

export function createSplatMaterial(textures, meta) {
  return new THREE.ShaderMaterial({
    ...SPLAT_MATERIAL,
    vertexShader: SPLAT_VERTEX,
    uniforms: {
      uBase: { value: textures.baseTexture },
      uStatic: { value: textures.staticTexture },
      uDynamic: { value: textures.dynamicTexture },
      uStaticCount: { value: isFlipbook(meta) ? meta.count : meta.staticCount },
      uFrame0: { value: 0 },
      uFrame1: { value: 0 },
      uBlend: { value: 0 },
      uBoundsMin: { value: boundsMinOf(meta.bounds) },
      uBoundsSize: { value: boundsSizeOf(meta.bounds) },
      uCovScale: { value: meta.covScale },
      uVelocity: { value: textures.velocityTexture ?? STILL_VELOCITY },
      uGlideOn: { value: textures.velocityTexture ? 1 : 0 },
      uTime: { value: 0 },
      uMomentTime: { value: 0 },
      uHalfStep: { value: 0 },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uLowPass: { value: RENDER.lowPass },
    },
  });
}

export function createPairTextures(set) {
  const baseTexture = integerTexture(
    new THREE.DataTexture(set.base, TEXTURE_WIDTH, set.rows, THREE.RGBAIntegerFormat, THREE.UnsignedIntType),
  );
  baseTexture.internalFormat = "RGBA32UI";
  const pointsTexture = integerTexture(
    new THREE.DataTexture(set.points, TEXTURE_WIDTH, set.rows, THREE.RGBAIntegerFormat, THREE.UnsignedShortType),
  );
  pointsTexture.internalFormat = "RGBA16UI";
  const velocityTexture = set.velocity ? halfFloatTexture(set.velocity, TEXTURE_WIDTH, set.rows) : null;
  return {
    baseTexture,
    pointsTexture,
    velocityTexture,
    dispose() {
      baseTexture.dispose();
      pointsTexture.dispose();
      if (velocityTexture) velocityTexture.dispose();
    },
  };
}

function halfFloatTexture(data, width, height) {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const STILL_VELOCITY = halfFloatTexture(new Uint16Array(4), 1, 1);

export function createStreamMaterial(staticPair, staticSet) {
  return new THREE.ShaderMaterial({
    ...SPLAT_MATERIAL,
    vertexShader: STREAM_VERTEX,
    uniforms: {
      uBase: { value: staticPair.baseTexture },
      uStatic: { value: staticPair.pointsTexture },
      uChunkBase: { value: staticPair.baseTexture },
      uChunkPoints: { value: staticPair.pointsTexture },
      uStaticCount: { value: staticSet.count },
      uBoundsMin: { value: boundsMinOf(staticSet.bounds) },
      uBoundsSize: { value: boundsSizeOf(staticSet.bounds) },
      uCovScale: { value: staticSet.covScale },
      uChunkBoundsMin: { value: new THREE.Vector3() },
      uChunkBoundsSize: { value: new THREE.Vector3(1, 1, 1) },
      uChunkCovScale: { value: 1 },
      uChunkVelocity: { value: STILL_VELOCITY },
      uChunkGlideOn: { value: 0 },
      uTime: { value: 0 },
      uMomentTime: { value: 0 },
      uHalfStep: { value: 0 },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uLowPass: { value: RENDER.lowPass },
    },
  });
}

export function bindStreamChunk(material, pair, set) {
  const { uniforms } = material;
  const { min, max } = set.bounds;
  uniforms.uChunkBase.value = pair.baseTexture;
  uniforms.uChunkPoints.value = pair.pointsTexture;
  uniforms.uChunkBoundsMin.value.set(min[0], min[1], min[2]);
  uniforms.uChunkBoundsSize.value.set(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  uniforms.uChunkCovScale.value = set.covScale;
  uniforms.uChunkVelocity.value = pair.velocityTexture ?? STILL_VELOCITY;
  uniforms.uChunkGlideOn.value = pair.velocityTexture ? 1 : 0;
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

export const RESOLVE_VERTEX = `
out vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const RESOLVE_FRAGMENT = `
precision highp float;

uniform sampler2D uSplats;
uniform float uFloor;
uniform float uSolid;

in vec2 vUv;

out vec4 fragColor;

void main() {
  vec4 accumulated = texture(uSplats, vUv);
  float coverage = accumulated.a;
  if (coverage < uFloor) discard;
  vec3 color = accumulated.rgb / coverage;
  float alpha = smoothstep(uFloor, uSolid, coverage);
  fragColor = vec4(color * alpha, alpha);
}
`;

export function createResolvePass() {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: RESOLVE_VERTEX,
    fragmentShader: RESOLVE_FRAGMENT,
    uniforms: {
      uSplats: { value: target.texture },
      uFloor: { value: RENDER.coverageFloor },
      uSolid: { value: RENDER.coverageSolid },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const quad = new THREE.Mesh(geometry, material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    target,
    render(gl, splatScene, splatCamera, width, height) {
      if (target.width !== width || target.height !== height) target.setSize(width, height);
      const previousTarget = gl.getRenderTarget();
      const previousColor = gl.getClearColor(new THREE.Color());
      const previousAlpha = gl.getClearAlpha();
      gl.setRenderTarget(target);
      gl.setClearColor(0x000000, 0);
      gl.clear(true, false, false);
      gl.render(splatScene, splatCamera);
      gl.setRenderTarget(previousTarget);
      gl.setClearColor(previousColor, previousAlpha);
      gl.clear(true, false, false);
      gl.render(scene, camera);
    },
    dispose() {
      target.dispose();
      material.dispose();
      geometry.dispose();
    },
  };
}
