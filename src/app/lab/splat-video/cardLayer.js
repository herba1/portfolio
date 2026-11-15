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
// meet without a seam. After card_finish.py the top edge carries no ramp,
// and the photo's own steel stops at its top row on one antialiased line; the
// gantry does not. The photo cuts the truss obliquely along that row, from the
// left edge to the signal head, so the same clean bay carries it on over the
// top along its own axis, out to the vertical past the head's end bracket
// where the cantilever really ends. Under the top row each bay is laid in
// beneath the photo's steel down to the first chord the photo shows whole
// across that bay, so the carried members end inside a chord, the steps
// between chords fall on verticals, and no member ends on the row; the
// bracket posts that meet the row just under the band are carried up into the
// bottom chord.

const HAZE_GLSL = `
uniform vec2 uHazeFrom;
uniform float uHazeAspect;
uniform vec2 uHazeRange;
uniform float uHaze;
uniform vec3 uHazeColor;

// Atmosphere between the post's foot and the far end of the arc: the steel
// pales a little towards the sky with distance up and along the photo.
vec3 hazeAt(vec3 rgb, vec2 photo) {
  float d = length((photo - uHazeFrom) * vec2(uHazeAspect, 1.0));
  return mix(rgb, uHazeColor, uHaze * smoothstep(uHazeRange.x, uHazeRange.y, d));
}
`;

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
uniform sampler2D uTone;
uniform float uToneOn;
uniform float uToneMid;
uniform float uToneGain;
uniform vec3 uToneTint;
uniform float uToneDeep;
uniform float uToneCap;
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
uniform float uTrussEnd;
uniform vec2 uTrussVertical;
uniform vec3 uTrussChords;
uniform float uTrussSliver;
uniform vec2 uExtrude;
uniform float uTopCut;
${HAZE_GLSL}
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
// and right ramps are divided back out, the bottom one kept (and the top one,
// unless card_finish.py took it off for the hard cut).
float unfade(vec2 photo) {
  vec2 px = photo * uPhotoPx - 0.5;
  float sides = min(px.x, uPhotoPx.x - 1.0 - px.x);
  float ends = uTopCut > 0.5 ? uPhotoPx.y - 1.0 - px.y : min(px.y, uPhotoPx.y - 1.0 - px.y);
  return ramp(ends) / max(ramp(min(sides, ends)), 1e-3);
}

// Coverage of the photo's top row as a hard edge: about one device pixel of
// antialiasing, however the lens stretches the card.
float topCut(vec2 photo) {
  float y = photo.y * uPhotoPx.y;
  return clamp(y / max(fwidth(y), 1e-4) + 0.5, 0.0, 1.0);
}

// The image with its film diffusion: the centre tap and four taps half a
// device pixel out, so the edge softens by under a pixel and never by more.
// The card's colour is one graded material; the plate's own shadow tone
// (card_tone.py) goes back on top of it around the same mean, so the stripes
// on the crossbuck, the lamp hoods and the plates on the head still print.
vec4 image(vec2 photo, vec2 gx, vec2 gy) {
  vec2 uv = texUv(photo);
  vec2 dx = gx * uDiffusion;
  vec2 dy = gy * uDiffusion;
  vec4 c = textureGrad(uCard, uv, gx, gy);
  if (uToneOn > 0.5) {
    // above the mean the tone adds light; below it, it takes a share away,
    // so the blackest hoods deepen without ever crushing to black
    float shade = min(uToneGain * (textureGrad(uTone, uv, gx, gy).r - uToneMid), uToneCap);
    c.rgb = shade > 0.0 ? c.rgb + shade * uToneTint : c.rgb * exp(shade * uToneDeep);
  }
  float a = 0.5 * c.a;
  a += 0.125 * textureGrad(uCard, uv + dx, gx, gy).a;
  a += 0.125 * textureGrad(uCard, uv - dx, gx, gy).a;
  a += 0.125 * textureGrad(uCard, uv + dy, gx, gy).a;
  a += 0.125 * textureGrad(uCard, uv - dy, gx, gy).a;
  return vec4(c.rgb, a);
}

// The truss at a point of the plane: the clean bay shifted by whole periods
// along the axis, inside the band and short of its far end. Past the left
// seam it fills the band (s before the bay). From the bay on it is laid in
// over the top: above the photo's top row it fills the band, and under the
// row each bay (from just left of one vertical to just left of the next, so
// a vertical is never split) goes down to the first chord whose centre is
// still inside the photo at the bay's right end, where the photo's own chord
// swallows the ends of the members.
vec4 trussAt(vec2 q, bool above, bool left, vec2 gx, vec2 gy) {
  if (uTrussOn < 0.5) return vec4(0.0);
  vec2 across = vec2(-uTrussAxis.y, uTrussAxis.x);
  vec2 rel = q - uTrussRef;
  float s = dot(rel, uTrussAxis);
  float t = dot(rel, across);
  if (t < uTrussBand.x || t > uTrussBand.y || s > uTrussEnd) return vec4(0.0);
  float period = uTrussWindow.y - uTrussWindow.x;
  if (s < uTrussWindow.x) {
    if (!left) return vec4(0.0);
  } else if (!above) {
    float vertical = uTrussVertical.x - uTrussVertical.y;
    float right = vertical + ceil((s - vertical) / period) * period + uTrussVertical.y;
    float limit = uTrussBand.y;
    for (int i = 2; i >= 0; i -= 1) {
      vec2 chord = photoOf(uTrussRef + right * uTrussAxis + uTrussChords[i] * across);
      if (chord.y >= 0.0) limit = uTrussChords[i];
    }
    if (t > limit) return vec4(0.0);
  }
  float k = -floor((s - uTrussWindow.x) / period);
  return image(photoOf(q + k * period * uTrussAxis), gx, gy);
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
    float top = uTopCut > 0.5 ? topCut(vPhoto) : topFade;
    bool inX = px.x >= uSeamPx && px.x <= uPhotoPx.x - 1.0 - uSeamPx;
    bool inside = inX && vPhoto.y <= 1.0 && (vPhoto.y >= 0.0 || (uTopCut > 0.5 && px.y >= -8.0));
    bool left = vPhoto.x < 0.5;
    if (inside) {
      c = image(vPhoto, gx, gy);
      c.a = clamp(c.a * unfade(vPhoto), 0.0, 1.0) * top;
    } else {
      // an edge column carried out
      float edgeRow = left ? uExtrude.x : uExtrude.y;
      if (edgeRow >= 0.0 && px.y >= edgeRow && vPhoto.y <= 1.0) {
        float column = left ? 2.0 * uEdgePx : uPhotoPx.x - 1.0 - 2.0 * uEdgePx;
        vec2 from = vec2((column + 0.5) / uPhotoPx.x, vPhoto.y);
        vec4 edge = image(from, vec2(0.0, gx.y), vec2(0.0, gy.y));
        c = vec4(edge.rgb, clamp(edge.a * unfade(from), 0.0, 1.0) * top);
      }
    }
    // The truss, bay by bay, past the left seam and over the top, laid in
    // under whatever steel the photo has there.
    vec4 truss = trussAt(q, vPhoto.y < 0.0, left && !inside, gx, gy);
    if (truss.a > c.a) c = truss;
    // The posts that meet the top row just under the band, carried up into
    // its bottom chord.
    if (vPhoto.y < 0.0 && inX && uTrussOn > 0.5 && uTrussSliver > 0.0) {
      vec2 rel = q - uTrussRef;
      float s = dot(rel, uTrussAxis);
      float t = dot(rel, vec2(-uTrussAxis.y, uTrussAxis.x));
      if (s >= uTrussWindow.x && s <= uTrussEnd && t > uTrussBand.y - 0.01 && t <= uTrussBand.y + uTrussSliver) {
        vec2 from = vec2(vPhoto.x, 0.5 / uPhotoPx.y);
        vec4 post = image(from, vec2(gx.x, 0.0), vec2(gy.x, 0.0));
        if (post.a > c.a) c = post;
      }
    }
  }
  if (c.a < 0.5 / 255.0) discard;
  fragColor = vec4(hazeAt(c.rgb, vPhoto) * c.a, c.a);
}
`;

// The wires past the photo: each a straight line on the plane from the seam
// (start + t * run, camera0 frame), run out to its vanishing point. A wire
// that leaves the photo inside a splice sleeve keeps the sleeve's width and
// centre for the rest of the sleeve's length, then tapers to the wire
// (uSleeve: half-width, taper start, taper end, offset across). t grows
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
uniform vec4 uSleeve[WIRES_MAX];
uniform float uReach;
uniform float uOverlap;
uniform vec2 uTan;

in float aWire;
in float aSide;

out float vAcross;
out float vHalf;
out float vAlive;
out vec2 vPhoto;

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
  // starts a hair inside the seam, so no sliver of sky opens between the
  // card's last texel and the ribbon
  float t = uReach * s / max(1.0 - s, 1e-4) - uOverlap;
  vec4 sleeve = uSleeve[i];
  float inSleeve = 1.0 - smoothstep(sleeve.y, sleeve.z, t);
  float halfWidth = mix(uHalf[i], sleeve.x, inSleeve);
  vec3 point = uStart[i] + t * uRun[i] + inSleeve * sleeve.w * uAcross[i];
  vec3 here = project(point);
  vec3 ahead = project(point + max(0.02, 0.02 * t) * uRun[i]);
  vec3 side = project(point + halfWidth * uAcross[i]);
  vec2 along = ahead.xy - here.xy;
  vec2 normal = normalize(vec2(-along.y, along.x) + 1e-9);
  float halfPx = abs(dot(side.xy - here.xy, normal));
  float reach = max(halfPx, 0.5) + 1.0;
  vec2 pixel = here.xy + normal * aSide * reach;
  vAcross = aSide * reach;
  vHalf = halfPx;
  vAlive = step(0.15, min(here.z, ahead.z));
  vPhoto = (point.xy / max(point.z, 1e-4) / uTan + 1.0) * 0.5;
  gl_Position = vec4(pixel / (0.5 * uViewport), 0.0, 1.0);
}
`;

const WIRE_FRAGMENT = `
precision highp float;

uniform vec3 uWireColor;
${HAZE_GLSL}
in float vAcross;
in float vHalf;
in float vAlive;
in vec2 vPhoto;

out vec4 fragColor;

void main() {
  if (vAlive < 0.999) discard;
  // A wire under a pixel wide keeps a one-pixel footprint and gives up
  // coverage instead.
  float width = max(vHalf, 0.5);
  float a = clamp(width - abs(vAcross) + 0.5, 0.0, 1.0) * min(1.0, vHalf / 0.5);
  if (a < 0.5 / 255.0) discard;
  fragColor = vec4(hazeAt(uWireColor, vPhoto) * a, a);
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

function hazeUniforms() {
  return {
    uHazeFrom: { value: new THREE.Vector2(...CARD.hazeFrom) },
    uHazeAspect: { value: CARD.hazeAspect },
    uHazeRange: { value: new THREE.Vector2(...CARD.hazeRange) },
    uHaze: { value: CARD.haze },
    uHazeColor: { value: new THREE.Vector3(...CARD.hazeColor) },
  };
}

function cardTexture(image, gl) {
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
  return texture;
}

function createWireMesh(extend, tan) {
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
      // no sleeve: the taper has ended before the seam
      uSleeve: { value: pad(extend.wires.map((w) => new THREE.Vector4(...(w.sleeve ?? [0, -2, -1, 0]))), () => new THREE.Vector4(0, -2, -1, 0)) },
      uReach: { value: CARD.wireReach },
      uOverlap: { value: CARD.wireOverlap },
      uWireColor: { value: new THREE.Vector3(...extend.wireColor) },
      uTan: { value: new THREE.Vector2(...tan) },
      ...hazeUniforms(),
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

// `clearRows` rows cover the top `clearTo` of the card, where nothing is drawn
// (it is there so the card's edge stays out of the frame), and `rows` the rest.
function cardGeometry(columns, rows, clearRows = 0, clearTo = 0) {
  const total = rows + clearRows;
  const geometry = new THREE.PlaneGeometry(1, 1, columns, total);
  geometry.translate(0.5, 0.5, 0);
  // PlaneGeometry runs y upward; the card's rows run down the photo.
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i += 1) {
    const row = Math.round((1 - position.getY(i)) * total);
    position.setY(i, row <= clearRows ? (clearRows > 0 ? (row / clearRows) * clearTo : 0) : clearTo + ((row - clearRows) / rows) * (1 - clearTo));
  }
  position.needsUpdate = true;
  return geometry;
}

// `toneImage` is the plate's shadow tone on the card's texel grid
// (meta.card.tone), or null for a card that is its graded colour alone.
export function createCardLayer(card, image, remap, gl, toneImage = null) {
  const texture = cardTexture(image, gl);
  const tone = toneImage && card.tone ? cardTexture(toneImage, gl) : null;

  // Only the worm's-eye remap shows past the photo, so only it extends.
  const extend = remap ? card.extend : null;
  const rect = extend ? extend.rect : card.rect;
  // Above `clear` (photo v) the extended card is empty sky: it runs on only so
  // that its top edge stays above the frame at every lean.
  const clear = extend ? extend.clearAbove : rect[1];
  const clearTo = (clear - rect[1]) / (rect[3] - rect[1]);
  const span = [(rect[2] - rect[0]) / (card.rect[2] - card.rect[0]), (rect[3] - clear) / (card.rect[3] - card.rect[1])];
  const truss = extend?.truss;

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: CARD_VERTEX,
    fragmentShader: CARD_FRAGMENT,
    uniforms: {
      uCard: { value: texture },
      uTone: { value: tone ?? texture },
      uToneOn: { value: tone ? 1 : 0 },
      uToneMid: { value: card.tone?.mid ?? 0 },
      uToneGain: { value: CARD.toneGain },
      uToneTint: { value: new THREE.Vector3(...CARD.toneTint) },
      uToneDeep: { value: CARD.toneDeep },
      uToneCap: { value: CARD.toneCap },
      ...hazeUniforms(),
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
      // over the top (no end: it only runs on past the left seam)
      uTrussEnd: { value: truss?.end ?? truss?.window[0] ?? 0 },
      uTrussVertical: { value: new THREE.Vector2(...(truss?.vertical ?? [0, 0])) },
      uTrussChords: { value: new THREE.Vector3(...(truss?.chords ?? [0, 0, 0])) },
      uTrussSliver: { value: truss?.sliver ?? 0 },
      uExtrude: { value: new THREE.Vector2(...(extend?.extrude ?? [-1, -1])) },
      uTopCut: { value: extend && card.finish?.topRamp === false ? 1 : 0 },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    ...PREMULTIPLIED_OVER,
  });
  // The grid stays as fine per unit of photo as before, so the lens bends the
  // longer card's rows as smoothly as it bends the splats; the empty sky above
  // gets a few rows of its own.
  const geometry = cardGeometry(Math.ceil(CARD.segments[0] * span[0]), Math.ceil(CARD.segments[1] * span[1]), clearTo > 0 ? CARD.clearRows : 0, clearTo);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  const wires = extend && extend.wires.length > 0 ? createWireMesh(extend, card.tan) : null;
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
      if (tone) tone.dispose();
      if (wires) {
        wires.geometry.dispose();
        wires.material.dispose();
      }
    },
  };
}
