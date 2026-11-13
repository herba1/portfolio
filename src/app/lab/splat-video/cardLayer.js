import * as THREE from "three";

import { CARD } from "./splatVideoParams";

// The anchor card: the signal, gantry and catenary as one photographic RGBA
// image on the silhouette plane, drawn over the resolved splats. It lives in
// the same OpenCV camera0 frame as the splats and goes through the same
// stereographic lens per vertex, so a lean moves it rigidly (one plane, one
// homography) while the cloud slides behind it. Its edge is the matte's own
// antialiased rim plus at most one device pixel of film diffusion.

const CARD_VERTEX = `
precision highp float;

uniform vec2 uViewport;
uniform float uStereo;
uniform vec2 uTan;
uniform vec4 uRect;
uniform vec3 uPlane;

out vec2 vUv;
out float vSourceY;

void main() {
  // position.xy runs 0..1 over the card's rect of the photo.
  vec2 photo = mix(uRect.xy, uRect.zw, position.xy);
  vec2 sourceTan = (photo * 2.0 - 1.0) * uTan;
  float z = 1.0 / max(dot(uPlane, vec3(sourceTan, 1.0)), 1e-4);
  vec4 view = modelViewMatrix * vec4(sourceTan * z, z, 1.0);
  vUv = position.xy;
  vSourceY = sourceTan.y;
  if (uStereo > 0.0) {
    float len = length(view.xyz);
    float s = max(len - view.z, 1e-4);
    vec2 p = 2.0 * view.xy / s;
    gl_Position = vec4(p / vec2(uStereo * uViewport.x / uViewport.y, uStereo), 0.0, 1.0);
  } else {
    gl_Position = projectionMatrix * view;
  }
}
`;

const CARD_FRAGMENT = `
precision highp float;

uniform sampler2D uCard;
uniform vec2 uTopFade;
uniform float uNearBand;
uniform float uDiffusion;

in vec2 vUv;
in float vSourceY;

out vec4 fragColor;

void main() {
  // Film diffusion: the centre tap and four taps half a device pixel out, so
  // the edge softens by under a pixel and never by more.
  vec2 dx = dFdx(vUv) * uDiffusion;
  vec2 dy = dFdy(vUv) * uDiffusion;
  vec4 c = texture(uCard, vUv);
  float a = 0.5 * c.a;
  a += 0.125 * texture(uCard, vUv + dx).a;
  a += 0.125 * texture(uCard, vUv - dx).a;
  a += 0.125 * texture(uCard, vUv + dy).a;
  a += 0.125 * texture(uCard, vUv - dy).a;
  // The gantry thins out over a short band below the photo's top edge, where
  // the source ends and the analytic sky takes over.
  a *= smoothstep(uTopFade.x, mix(uTopFade.x, uTopFade.y, uNearBand), vSourceY);
  if (a < 0.5 / 255.0) discard;
  fragColor = vec4(c.rgb * a, a);
}
`;

function cardGeometry() {
  const geometry = new THREE.PlaneGeometry(1, 1, CARD.segments[0], CARD.segments[1]);
  geometry.translate(0.5, 0.5, 0);
  // PlaneGeometry runs y upward; the card's rows run down the photo.
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i += 1) position.setY(i, 1 - position.getY(i));
  position.needsUpdate = true;
  return geometry;
}

export function createCardLayer(card, image, remap, gl) {
  const texture = new THREE.Texture(image);
  texture.flipY = false;
  texture.premultiplyAlpha = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = Math.min(CARD.anisotropy, gl.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: CARD_VERTEX,
    fragmentShader: CARD_FRAGMENT,
    uniforms: {
      uCard: { value: texture },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uStereo: { value: remap ? 2 * Math.tan((remap.vfovDeg * Math.PI) / 720) : 0 },
      uTan: { value: new THREE.Vector2(...card.tan) },
      uRect: { value: new THREE.Vector4(...card.rect) },
      uPlane: { value: new THREE.Vector3(...card.plane) },
      uTopFade: { value: new THREE.Vector2(...(remap ? remap.fade.top : [-1e6, -1e6 + 1])) },
      uNearBand: { value: remap ? remap.fade.nearBand : 1 },
      uDiffusion: { value: CARD.diffusion },
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
  const geometry = cardGeometry();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  const scene = new THREE.Scene();
  scene.add(mesh);

  return {
    // Draws over whatever is bound, on top of the resolved splats. `frame` is
    // the splat group's world matrix (the source remap), so the card shares
    // the splats' frame exactly.
    render(renderer, camera, frame, width, height) {
      mesh.matrix.copy(frame);
      mesh.matrixWorldNeedsUpdate = true;
      material.uniforms.uViewport.value.set(width, height);
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = autoClear;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
