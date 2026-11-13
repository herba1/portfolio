import * as THREE from "three";

import { CARD } from "./splatVideoParams";

// The anchor card: the signal, gantry and catenary as one photographic RGBA
// image on the silhouette plane, drawn over the resolved splats. It lives in
// the same OpenCV camera0 frame as the splats and goes through the same
// stereographic lens per vertex, so a lean moves it rigidly (one plane, one
// homography) while the cloud slides behind it. Its edge is the matte's own
// antialiased rim plus at most one device pixel of film diffusion.
//
// The stage is full-bleed and the widest lean sees well past the photo, so
// with meta.card.extend the card carries on past the photo's edges
// (card_extend.py): each wire that leaves the photo runs on as a straight
// line on the plane, at its own width, out to its vanishing point; the plane
// itself runs on far enough for the gantry's truss to be filled bay by bay
// along its axis and for the rows under the building to carry the edge
// column out.
// Inside the photo the card is the image, with the border ramp baked into its
// left and right edges divided back out so the image and its continuation
// meet without a seam.

const CARD_VERTEX = `
precision highp float;

uniform vec2 uViewport;
uniform float uStereo;
uniform float uStereoShift;
uniform vec2 uTan;
uniform vec4 uRect;
uniform vec3 uPlane;

out vec2 vPhoto;
out float vSourceY;

void main() {
  // position.xy runs 0..1 over the card's rect of the photo (past its edges
  // when the card is extended).
  vec2 photo = mix(uRect.xy, uRect.zw, position.xy);
  vec2 sourceTan = (photo * 2.0 - 1.0) * uTan;
  float z = 1.0 / max(dot(uPlane, vec3(sourceTan, 1.0)), 1e-4);
  vec4 view = modelViewMatrix * vec4(sourceTan * z, z, 1.0);
  vPhoto = photo;
  vSourceY = sourceTan.y;
  if (uStereo > 0.0) {
    float len = length(view.xyz);
    float s = max(len - view.z, 1e-4);
    vec2 p = 2.0 * view.xy / s;
    gl_Position = vec4((p - vec2(uStereoShift, 0.0)) / vec2(uStereo * uViewport.x / uViewport.y, uStereo), 0.0, 1.0);
  } else {
    gl_Position = projectionMatrix * view;
  }
}
`;

const CARD_FRAGMENT = `
precision highp float;

uniform sampler2D uCard;
uniform vec4 uCardRect;
uniform vec2 uTopFade;
uniform float uNearBand;
uniform float uDiffusion;
uniform vec2 uTan;
uniform vec3 uPlane;

uniform float uExtend;
uniform vec2 uPhotoPx;
uniform float uSeamPx;
uniform float uEdgePx;
uniform vec3 uOrigin;
uniform vec3 uE1;
uniform vec3 uE2;
uniform float uTrussOn;
uniform vec2 uTrussRef;
uniform vec2 uTrussAxis;
uniform vec2 uTrussWindow;
uniform vec2 uTrussBand;
uniform vec2 uExtrude;

in vec2 vPhoto;
in float vSourceY;

out vec4 fragColor;

vec2 texUv(vec2 photo) {
  return (photo - uCardRect.xy) / (uCardRect.zw - uCardRect.xy);
}

// Photo uv <-> 2D coordinates on the card's plane (card_extend.py's basis).
vec2 planeOf(vec2 photo) {
  vec2 t = (photo * 2.0 - 1.0) * uTan;
  float z = 1.0 / max(dot(uPlane, vec3(t, 1.0)), 1e-6);
  vec3 p = vec3(t * z, z) - uOrigin;
  return vec2(dot(p, uE1), dot(p, uE2));
}

vec2 photoOf(vec2 q) {
  vec3 p = uOrigin + q.x * uE1 + q.y * uE2;
  return (p.xy / p.z / uTan + 1.0) * 0.5;
}

float ramp(float px) {
  float t = clamp(px / uEdgePx, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// card.py faded the image over its border; with the card extended the left
// and right ramps are divided back out, the top and bottom ones kept.
float unfade(vec2 photo) {
  vec2 px = photo * uPhotoPx - 0.5;
  float sides = min(px.x, uPhotoPx.x - 1.0 - px.x);
  float ends = min(px.y, uPhotoPx.y - 1.0 - px.y);
  return ramp(ends) / max(ramp(min(sides, ends)), 1e-3);
}

// The image with its film diffusion: the centre tap and four taps half a
// device pixel out, so the edge softens by under a pixel and never by more.
vec4 image(vec2 photo, vec2 gx, vec2 gy) {
  vec2 uv = texUv(photo);
  vec2 dx = gx * uDiffusion;
  vec2 dy = gy * uDiffusion;
  vec4 c = textureGrad(uCard, uv, gx, gy);
  float a = 0.5 * c.a;
  a += 0.125 * textureGrad(uCard, uv + dx, gx, gy).a;
  a += 0.125 * textureGrad(uCard, uv - dx, gx, gy).a;
  a += 0.125 * textureGrad(uCard, uv + dy, gx, gy).a;
  a += 0.125 * textureGrad(uCard, uv - dy, gx, gy).a;
  return vec4(c.rgb, a);
}

void main() {
  // The photo thins out over a short band below its top edge, where the
  // source ends and the analytic sky takes over.
  float topFade = smoothstep(uTopFade.x, mix(uTopFade.x, uTopFade.y, uNearBand), vSourceY);
  vec2 gx = dFdx(vPhoto) / (uCardRect.zw - uCardRect.xy);
  vec2 gy = dFdy(vPhoto) / (uCardRect.zw - uCardRect.xy);
  vec4 c = vec4(0.0);
  if (uExtend < 0.5) {
    if (any(lessThan(vPhoto, uCardRect.xy)) || any(greaterThan(vPhoto, uCardRect.zw))) discard;
    c = image(vPhoto, gx, gy);
    c.a *= topFade;
  } else {
    vec2 q = planeOf(vPhoto);
    vec2 px = vPhoto * uPhotoPx - 0.5;
    bool inside = px.x >= uSeamPx && px.x <= uPhotoPx.x - 1.0 - uSeamPx && vPhoto.y >= 0.0 && vPhoto.y <= 1.0;
    if (inside) {
      c = image(vPhoto, gx, gy);
      c.a = clamp(c.a * unfade(vPhoto), 0.0, 1.0) * topFade;
    } else {
      bool left = vPhoto.x < 0.5;
      // The truss, bay by bay, or an edge column carried out.
      vec4 base = vec4(0.0);
      float edgeRow = left ? uExtrude.x : uExtrude.y;
      if (uTrussOn > 0.5 && left) {
        vec2 rel = q - uTrussRef;
        float s = dot(rel, uTrussAxis);
        float t = dot(rel, vec2(-uTrussAxis.y, uTrussAxis.x));
        if (t >= uTrussBand.x && t <= uTrussBand.y && s < uTrussWindow.x) {
          float period = uTrussWindow.y - uTrussWindow.x;
          float k = ceil((uTrussWindow.x - s) / period);
          base = image(photoOf(q + k * period * uTrussAxis), gx, gy);
        }
      }
      if (edgeRow >= 0.0 && px.y >= edgeRow && vPhoto.y <= 1.0) {
        float column = left ? 2.0 * uEdgePx : uPhotoPx.x - 1.0 - 2.0 * uEdgePx;
        vec2 from = vec2((column + 0.5) / uPhotoPx.x, vPhoto.y);
        vec4 edge = image(from, vec2(0.0, gx.y), vec2(0.0, gy.y));
        edge.a *= unfade(from);
        base = edge.a > base.a ? edge : base;
      }
      c = vec4(base.rgb, base.a * topFade);
    }
  }
  if (c.a < 0.5 / 255.0) discard;
  fragColor = vec4(c.rgb * c.a, c.a);
}
`;

// The wires past the photo: each a straight line on the plane from the seam
// (start + t * run, camera0 frame), run out to its vanishing point. t grows
// as s / (1 - s) along the strip, so the samples are dense where the lens
// bends the wire hardest and the last ones sit at the vanishing point. Each
// vertex is pushed sideways in screen space by the wire's own projected
// half-width (never under a pixel, so a far wire thins in coverage instead of
// breaking up), and the fragment shader antialiases across it.
const WIRE_VERTEX = `
precision highp float;

uniform vec2 uViewport;
uniform float uStereo;
uniform float uStereoShift;
uniform vec3 uStart[WIRES_MAX];
uniform vec3 uRun[WIRES_MAX];
uniform vec3 uAcross[WIRES_MAX];
uniform float uHalf[WIRES_MAX];
uniform float uReach;

in float aWire;
in float aSide;

out float vAcross;
out float vHalf;
out float vAlive;

vec3 project(vec3 point) {
  vec4 view = modelViewMatrix * vec4(point, 1.0);
  float len = length(view.xyz);
  float s = len - view.z;
  vec2 p = 2.0 * view.xy / max(s, 1e-6);
  vec2 ndc = (p - vec2(uStereoShift, 0.0)) / vec2(uStereo * uViewport.x / uViewport.y, uStereo);
  // z: how far round from straight behind, so a strip that wraps past the
  // antipode can be dropped
  return vec3(ndc * 0.5 * uViewport, s / len);
}

void main() {
  int i = int(aWire + 0.5);
  float s = position.x;
  float t = uReach * s / max(1.0 - s, 1e-4);
  vec3 point = uStart[i] + t * uRun[i];
  vec3 here = project(point);
  vec3 ahead = project(point + max(0.02, 0.02 * t) * uRun[i]);
  vec3 side = project(point + uHalf[i] * uAcross[i]);
  vec2 along = ahead.xy - here.xy;
  vec2 normal = normalize(vec2(-along.y, along.x) + 1e-9);
  float halfPx = abs(dot(side.xy - here.xy, normal));
  float reach = max(halfPx, 0.5) + 1.0;
  vec2 pixel = here.xy + normal * aSide * reach;
  vAcross = aSide * reach;
  vHalf = halfPx;
  vAlive = step(0.15, min(here.z, ahead.z));
  gl_Position = vec4(pixel / (0.5 * uViewport), 0.0, 1.0);
}
`;

const WIRE_FRAGMENT = `
precision highp float;

uniform vec3 uWireColor;

in float vAcross;
in float vHalf;
in float vAlive;

out vec4 fragColor;

void main() {
  if (vAlive < 0.999) discard;
  // A wire under a pixel wide keeps a one-pixel footprint and gives up
  // coverage instead.
  float width = max(vHalf, 0.5);
  float a = clamp(width - abs(vAcross) + 0.5, 0.0, 1.0) * min(1.0, vHalf / 0.5);
  if (a < 0.5 / 255.0) discard;
  fragColor = vec4(uWireColor * a, a);
}
`;

function wireGeometry(count, segments) {
  const positions = [];
  const wires = [];
  const sides = [];
  const index = [];
  for (let w = 0; w < count; w += 1) {
    const base = positions.length / 3;
    for (let k = 0; k <= segments; k += 1) {
      const s = (k / segments) * CARD.wireEnd;
      for (const side of [-1, 1]) {
        positions.push(s, 0, 0);
        wires.push(w);
        sides.push(side);
      }
    }
    for (let k = 0; k < segments; k += 1) {
      const a = base + k * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aWire", new THREE.Float32BufferAttribute(wires, 1));
  geometry.setAttribute("aSide", new THREE.Float32BufferAttribute(sides, 1));
  geometry.setIndex(index);
  return geometry;
}

// Premultiplied "over", for the card and its wires alike.
const PREMULTIPLIED_OVER = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendEquationAlpha: THREE.AddEquation,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
};

function createWireMesh(extend) {
  const count = extend.wires.length;
  const pad = (list, fill) => [...list, ...Array.from({ length: CARD.wiresMax - list.length }, fill)];
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: `#define WIRES_MAX ${CARD.wiresMax}\n${WIRE_VERTEX}`,
    fragmentShader: WIRE_FRAGMENT,
    uniforms: {
      uViewport: { value: new THREE.Vector2(1, 1) },
      uStereo: { value: 1 },
      uStereoShift: { value: 0 },
      uStart: { value: pad(extend.wires.map((w) => new THREE.Vector3(...w.start)), () => new THREE.Vector3()) },
      uRun: { value: pad(extend.wires.map((w) => new THREE.Vector3(...w.run)), () => new THREE.Vector3(1, 0, 0)) },
      uAcross: { value: pad(extend.wires.map((w) => new THREE.Vector3(...w.across)), () => new THREE.Vector3(0, 1, 0)) },
      uHalf: { value: pad(extend.wires.map((w) => w.half), () => 0) },
      uReach: { value: CARD.wireReach },
      uWireColor: { value: new THREE.Vector3(...extend.wireColor) },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    ...PREMULTIPLIED_OVER,
  });
  const geometry = wireGeometry(count, CARD.wireSegments);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

function cardGeometry(columns, rows) {
  const geometry = new THREE.PlaneGeometry(1, 1, columns, rows);
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

  // Only the worm's-eye remap shows past the photo, so only it extends.
  const extend = remap ? card.extend : null;
  const rect = extend ? extend.rect : card.rect;
  const span = [(rect[2] - rect[0]) / (card.rect[2] - card.rect[0]), (rect[3] - rect[1]) / (card.rect[3] - card.rect[1])];
  const truss = extend?.truss;

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: CARD_VERTEX,
    fragmentShader: CARD_FRAGMENT,
    uniforms: {
      uCard: { value: texture },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uStereo: { value: remap ? 2 * Math.tan((remap.vfovDeg * Math.PI) / 720) : 0 },
      uStereoShift: { value: 0 },
      uTan: { value: new THREE.Vector2(...card.tan) },
      uRect: { value: new THREE.Vector4(...rect) },
      uCardRect: { value: new THREE.Vector4(...card.rect) },
      uPlane: { value: new THREE.Vector3(...card.plane) },
      uTopFade: { value: new THREE.Vector2(...(remap ? remap.fade.top : [-1e6, -1e6 + 1])) },
      uNearBand: { value: remap ? remap.fade.nearBand : 1 },
      uDiffusion: { value: CARD.diffusion },
      uExtend: { value: extend ? 1 : 0 },
      uPhotoPx: { value: new THREE.Vector2(...(extend ? extend.photo : [1, 1])) },
      uSeamPx: { value: extend ? extend.seamPx : 0 },
      uEdgePx: { value: extend ? extend.edgeFade * extend.photo[0] : 1 },
      uOrigin: { value: new THREE.Vector3(...(extend ? extend.basis.origin : [0, 0, 1])) },
      uE1: { value: new THREE.Vector3(...(extend ? extend.basis.e1 : [1, 0, 0])) },
      uE2: { value: new THREE.Vector3(...(extend ? extend.basis.e2 : [0, 1, 0])) },
      uTrussOn: { value: truss ? 1 : 0 },
      uTrussRef: { value: new THREE.Vector2(...(truss ? truss.ref : [0, 0])) },
      uTrussAxis: { value: new THREE.Vector2(...(truss ? truss.axis : [1, 0])) },
      uTrussWindow: { value: new THREE.Vector2(...(truss ? truss.window : [0, 1])) },
      uTrussBand: { value: new THREE.Vector2(...(truss ? truss.band : [0, 0])) },
      uExtrude: { value: new THREE.Vector2(...(extend?.extrude ?? [-1, -1])) },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    ...PREMULTIPLIED_OVER,
  });
  // The grid stays as fine per unit of photo as before, so the lens bends the
  // longer card's rows as smoothly as it bends the splats.
  const geometry = cardGeometry(Math.ceil(CARD.segments[0] * span[0]), Math.ceil(CARD.segments[1] * span[1]));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  const wires = extend && extend.wires.length > 0 ? createWireMesh(extend) : null;
  const scene = new THREE.Scene();
  scene.add(mesh);
  if (wires) scene.add(wires);

  return {
    // Draws over whatever is bound, on top of the resolved splats. `frame` is
    // the splat group's world matrix (the source remap), so the card shares
    // the splats' frame exactly; `stereo` and `shift` are the lens scale and
    // centre fitted to the full-bleed viewport.
    render(renderer, camera, frame, width, height, stereo, shift = 0) {
      for (const layer of wires ? [mesh, wires] : [mesh]) {
        const { uniforms } = layer.material;
        layer.matrix.copy(frame);
        layer.matrixWorldNeedsUpdate = true;
        uniforms.uViewport.value.set(width, height);
        if (remap && stereo > 0) {
          uniforms.uStereo.value = stereo;
          uniforms.uStereoShift.value = shift;
        }
      }
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = autoClear;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
      if (wires) {
        wires.geometry.dispose();
        wires.material.dispose();
      }
    },
  };
}
