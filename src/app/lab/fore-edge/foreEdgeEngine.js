import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { createStage, clamp } from "../_kit/stage";
import painting from "./turner-shipwreck.jpg";

// A fore-edge painting is painted on the leaves of a book while they are
// fanned, then the edge is squared up and gilded. Closed, the book shows a
// plain gold edge. Bent, every leaf steps back from the one below it, the
// gold breaks into hairlines, and the strip of page each leaf exposes carries
// one row of the picture.
//
// The camera sits low in front of the fore-edge, almost square to it, so the
// edge is the picture and the boards are two bands of cloth above and below.
// One long strip light rakes in from above-left: closed, the concave gilt
// throws it back as a single hard streak; fanned, each leaf's nose catches
// its own hairline of it.
//
// Units are centimetres. x runs along the fore-edge, z from spine (−) to the
// fore-edge (+), y up from the table.

const L = 20; // length of the fore-edge (the book's height)
const D = 13; // page width, spine to fore-edge
const N = 48; // leaves, each standing for a sheaf of pages
const BOARD = 0.32; // board thickness
const T = 3.4; // book block thickness
const LEAF = T / N;
const SQUARE = 0.3; // how far the boards overhang the block
const SMAX = 4.5; // how far the top leaf steps back at full bend
const CONC = 0.55; // a rounded-and-backed book has a concave fore-edge
const LIFT = 0.3; // the thumb opens the block a little as it fans
const EDGE = D / 2;
const Y0 = BOARD; // block sits on the lower board
const CX = -0.4; // where the lens looks along the edge

// Shared deformation: the block shears like a deck of cards. Every leaf
// slides back in its own plane by the same amount along its whole length,
// so the head and tail stay square and the block skews into a parallelogram.
// The lift thickens the leaves rather than parting them, so no dark gap ever
// opens between two leaves. The concave edge shears out as the block fans.
const BEND_GLSL = /* glsl */ `
uniform float uBend;
float bendDz(float frac){ return -uBend * ${SMAX.toFixed(3)} * frac; }
float bendDy(float frac){ return uBend * ${LIFT.toFixed(3)} * frac; }
float bendSy(){ return 1.0 + uBend * ${(LIFT / T).toFixed(5)}; }
// A leaf that slides back also shrinks in the lens, which would pinch the
// sheared block into a trapezoid. Stretch it along the edge by exactly what
// the lens takes away, so head and tail stay parallel, as on a drawing board.
uniform float uPersp;
float bendSx(float frac){ return 1.0 - bendDz(frac) * uPersp; }
float concK(){ return ${CONC.toFixed(3)} * (1.0 - 0.65 * smoothstep(0.0, 0.5, uBend)); }
float concDz(float h){ float c = 2.0 * h - 1.0; return -concK() * (1.0 - c * c); }
// Slope of the concave face, dz/dy, at height fraction h.
float concSlope(float h){ return concK() * 4.0 * (2.0 * h - 1.0) / ${T.toFixed(3)}; }
`;

function leafMaterial(tex, uniforms) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uBend = uniforms.uBend;
    s.uniforms.uPersp = uniforms.uPersp;
    s.uniforms.uPaint = { value: tex };
    s.vertexShader = s.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
${BEND_GLSL}
attribute vec4 aLeaf; // index, jitter x, jitter z, tint
varying vec3 vObjN; varying vec3 vLoc; varying vec4 vLeaf;
float hl1(float n){ return fract(sin(n * 37.719) * 23421.631); }`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
// The gilt face follows the concave edge, each leaf tipped a hair on its own,
// so the strip light lands on a few leaves as one streak, not on all of them.
if (normal.z > 0.5) {
  float hN = (aLeaf.x + 0.5) / ${N.toFixed(1)};
  objectNormal = normalize(vec3(0.0, -concSlope(hN) + (hl1(aLeaf.x) - 0.5) * 0.06, 1.0));
}`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vObjN = normal; vLeaf = aLeaf;
float frac = aLeaf.x / ${N.toFixed(1)};
float hC = (aLeaf.x + 0.5) / ${N.toFixed(1)};
transformed.x = (transformed.x + aLeaf.y - ${CX.toFixed(2)}) * bendSx(frac) + ${CX.toFixed(2)};
transformed.y = (transformed.y + (aLeaf.x + 0.5) * ${LEAF.toFixed(5)}) * bendSy() + ${Y0.toFixed(3)};
transformed.z += aLeaf.z + concDz(hC) + bendDz(frac);
vLoc = vec3(position.x + aLeaf.y, position.y / ${LEAF.toFixed(5)} + 0.5, position.z + aLeaf.z);`,
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
${BEND_GLSL}
uniform sampler2D uPaint;
varying vec3 vObjN; varying vec3 vLoc; varying vec4 vLeaf;
float h1(float n){ return fract(sin(n * 91.345) * 47453.21); }
float h2(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float gilt; float giltRough; float hair; float painted;
// The painting covers the fanned face: x along the edge, height up the block.
// Watercolour on rag paper, not a print: a little of its saturation goes to
// the paper it soaked into.
vec3 paintAt(float u, float h, vec3 paper){
  vec3 p = texture2D(uPaint, vec2(0.02 + 0.96 * u, 0.04 + 0.92 * h)).rgb;
  float l = dot(p, vec3(0.299, 0.587, 0.114));
  p = mix(vec3(l), p, 0.8);
  return mix(p, p * paper * 1.06, 0.5);
}
// How much of each leaf's step is newly exposed page rather than gilt nose.
// It grows from nothing with the bend, so the gold gives way to the picture
// over the whole gesture instead of all at once.
float reveal(){ return 0.85 * clamp((uBend - 0.03) / 0.85, 0.0, 1.0); }`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
{
  gilt = 0.0; giltRough = 0.3; hair = 0.0; painted = 0.0;
  vec3 paper = vec3(0.93, 0.905, 0.85) * (0.97 + 0.03 * vLeaf.w);
  // Paper fibre, so a page is not a flat colour.
  paper *= 0.99 + 0.02 * h2(floor(vLoc.xz * 8.0));
  vec3 c = paper;
  float u = (vLoc.x + ${(L / 2).toFixed(2)}) / ${L.toFixed(1)};
  float fan = smoothstep(0.0, 0.08, uBend);
  float p = reveal();
  if (vObjN.z > 0.5) {
    // The gilt edge. Closed it is one burnished field. As the block shears,
    // each leaf keeps its outermost sliver of gold, the nose, and the page the
    // leaf above has stepped past shows below it, carrying its row of the
    // picture that was painted under the gilding.
    float y = vLoc.y;
    // A fixed edge rather than a screen-derivative one: fwidth is computed
    // per 2x2 quad and would break each hairline into dots.
    float aa = 0.05;
    float gz = min(p, 0.85);
    float isGilt = max(smoothstep(gz - aa, gz + aa, y), 1.0 - smoothstep(0.0, 0.04, p));
    hair = fan * isGilt;
    vec3 gold = vec3(1.0, 0.71, 0.32) * (0.9 + 0.1 * h1(vLeaf.x));
    // Burnished, but each page edge leaves a faint line in the gold.
    gold *= 0.95 + 0.05 * h2(vec2(floor(y * 6.0), vLeaf.x));
    float h = (vLeaf.x + y) / ${N.toFixed(1)};
    vec3 paint = paintAt(u, h, paper);
    c = mix(paint, gold, isGilt);
    gilt = isGilt;
    painted = 1.0 - isGilt;
    giltRough = 0.1 + 0.04 * h1(vLeaf.x + 7.0) + 0.16 * hair;
  } else if (vObjN.y > 0.5) {
    // The strip this leaf exposes when fanned was painted while fanned.
    float back = ${EDGE.toFixed(2)} - vLoc.z;
    float hi = (vLeaf.x + 0.5) / ${N.toFixed(1)};
    float hj = (vLeaf.x + 1.5) / ${N.toFixed(1)};
    float exposed = max(1e-4, uBend * ${(SMAX / N).toFixed(5)} + concDz(hi) - concDz(hj));
    float t = clamp(back / exposed, 0.0, 1.0);
    vec3 paint = paintAt(u, (vLeaf.x + 1.0 - 0.15 * t) / ${N.toFixed(1)}, paper);
    // Watercolour sits in the paper: it fades a little under the leaf above.
    float inBand = 1.0 - smoothstep(exposed * 1.2, exposed * 1.8 + 0.05, back);
    c = mix(paper, paint, inBand * fan);
    painted = inBand * fan;
    // The leaf above only just shades the back of the strip it overhangs.
    c *= mix(0.93, 1.0, smoothstep(0.0, 0.8, 1.0 - t));
    // This strip faces straight up into the strip light while the fanned face
    // beside it leans back only a little. Held level with that face, the
    // sub-pixel sliver blends into the row instead of sparkling as dots.
    c *= mix(1.0, 0.72, fan);
  }
  diffuseColor.rgb = c;
}`,
      )
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\nmetalnessFactor = gilt;`)
      // A fanned leaf's gilt nose is rounded, so some part of it always faces
      // the strip light: it never goes dark the way a flat mirror can.
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.1 * hair;`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, giltRough, gilt);`)
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
// The hairline is the rounded nose of a leaf: it faces up into the strip
// light, each leaf tipped its own way, so each one catches its own glint.
{
  vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  if (hair > 0.0) {
    float tip = h1(vLeaf.x + 3.0);
    vec3 nose = normalize(mix(normal, upV, 0.04 + 0.5 * tip * tip));
    normal = normalize(mix(normal, nose, hair));
  }
  // The painted part of a step is page fanned back at the slope of the
  // block, so it faces up into the light as the shear opens.
  if (vObjN.z > 0.5 && painted > 0.0) {
    float slope = uBend * ${(SMAX / T).toFixed(4)};
    normal = normalize(normal + upV * 0.3 * slope * painted);
  }
}`,
      );
  };
  return m;
}

function clothMaterial(uniforms, frac, bump) {
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0x5f6b5a),
    roughness: 0.86,
    metalness: 0,
    bumpMap: bump,
    bumpScale: 1.2,
    sheen: 0.35,
    sheenColor: new THREE.Color(0xc9d2c2),
    sheenRoughness: 0.55,
  });
  // Each board bends by its own amount, so each needs its own program.
  m.customProgramCacheKey = () => `cloth-${frac}`;
  m.onBeforeCompile = (s) => {
    s.uniforms.uBend = uniforms.uBend;
    s.uniforms.uPersp = uniforms.uPersp;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", `#include <common>\n${BEND_GLSL}`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
transformed.x = (transformed.x - ${CX.toFixed(2)}) * bendSx(${frac.toFixed(3)}) + ${CX.toFixed(2)};
transformed.y += bendDy(${frac.toFixed(3)});
transformed.z += bendDz(${frac.toFixed(3)});`,
      );
  };
  return m;
}

// Book cloth: a fine plain weave, as a bump map.
function weaveTexture() {
  const n = 256;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d");
  const img = g.createImageData(n, n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const wx = Math.sin((x / 4) * Math.PI) ** 2;
      const wy = Math.sin((y / 4) * Math.PI) ** 2;
      const over = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? wx : wy;
      const v = 110 + over * 100 + (Math.random() - 0.5) * 40;
      const i = (y * n + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  t.anisotropy = 8;
  return t;
}

// A soft contact shadow under the book.
function shadowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(128, 128, 20, 128, 128, 128);
  grd.addColorStop(0, "rgba(0,0,0,0.55)");
  grd.addColorStop(0.55, "rgba(0,0,0,0.25)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

export async function createForeEdge(host) {
  const stage = createStage(host, { webgl: true, dpr: 2 });
  const renderer = new THREE.WebGLRenderer({ canvas: stage.canvas, context: stage.ctx, antialias: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const ground = new THREE.Color(0xf2efe9);
  scene.background = ground;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;

  // The strip light: long along the edge, high and a little to the left,
  // raking down across the steps.
  RectAreaLightUniformsLib.init();
  const strip = new THREE.RectAreaLight(0xfff4e4, 8, 46, 0.6);
  strip.position.set(-9, 17, EDGE + 19);
  strip.lookAt(0, Y0 + T * 0.3, EDGE);
  scene.add(strip);
  // A low fill from the left so the cloth and paper keep their colour.
  const key = new THREE.PointLight(0xfff1e0, 500, 0, 2);
  key.position.set(-22, 14, 14);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xdfe8ff, 0.4);
  rim.position.set(18, 10, -12);
  scene.add(rim);

  const img = new Image();
  img.src = painting.src ?? painting;
  await img.decode();
  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;

  const uniforms = { uBend: { value: 0 }, uPersp: { value: 0 } };
  const book = new THREE.Group();
  scene.add(book);

  // Leaves.
  const leafGeo = new THREE.BoxGeometry(L, LEAF, D, 1, 1, 28);
  const attr = new Float32Array(N * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N; i++) attr.set([i, (rnd() - 0.5) * 0.05, (rnd() - 0.5) * 0.006, rnd()], i * 4);
  leafGeo.setAttribute("aLeaf", new THREE.InstancedBufferAttribute(attr, 4));
  const leaves = new THREE.InstancedMesh(leafGeo, leafMaterial(tex, uniforms), N);
  const id = new THREE.Matrix4();
  for (let i = 0; i < N; i++) leaves.setMatrixAt(i, id);
  leaves.frustumCulled = false;
  book.add(leaves);

  // Boards and spine in grey-green cloth.
  const bump = weaveTexture();
  const boardGeo = () => new RoundedBoxGeometry(L + SQUARE * 2, BOARD, D + SQUARE, 3, 0.1);
  const lower = new THREE.Mesh(boardGeo(), clothMaterial(uniforms, 0, bump));
  lower.position.set(0, BOARD / 2, SQUARE / 2);
  const upper = new THREE.Mesh(boardGeo(), clothMaterial(uniforms, 1, bump));
  upper.position.set(0, Y0 + T + BOARD / 2, SQUARE / 2);
  const spine = new THREE.Mesh(new RoundedBoxGeometry(L + SQUARE * 2, T + BOARD * 2, 1.1, 4, 0.5), clothMaterial(uniforms, 0, bump));
  spine.position.set(0, (T + BOARD * 2) / 2, -EDGE - 0.3);
  book.add(lower, upper, spine);

  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.5, toneMapped: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(L * 1.3, D * 1.35, 1);
  shadow.position.set(0.6, 0.002, 0.2);
  scene.add(shadow);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: ground, toneMapped: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.renderOrder = -1;
  scene.add(floor);

  // Low and close: the fore-edge nearly square to the lens, raked a little
  // so the head of the block shows its pages.
  const camera = new THREE.PerspectiveCamera(24, 1, 1, 400);
  const target = new THREE.Vector3(CX, Y0 + T * 0.52, EDGE);
  const AZ = 0.13; // rake, radians round from square-on
  const EL = 0.22; // height above the table plane, radians
  const FILL = 0.68; // share of the frame's width the edge spans (more on a phone)
  const fit = (w, h) => {
    camera.aspect = w / h;
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    const fill = camera.aspect < 1 ? 0.9 : FILL;
    const dist = (L * Math.cos(AZ)) / (fill * 2 * tanH);
    const dir = new THREE.Vector3(Math.sin(AZ) * Math.cos(EL), Math.sin(EL), Math.cos(AZ) * Math.cos(EL));
    camera.position.copy(target).addScaledVector(dir, dist);
    uniforms.uPersp.value = dir.z / dist;
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  };
  let dirty = true;
  const onSize = (w, h) => {
    renderer.setSize(stage.canvas.width, stage.canvas.height, false);
    fit(w, h);
    dirty = true;
  };
  stage.onResize(onSize);

  // The thumb: drawing sideways bends the block, how far you drew is how
  // far it fans. Let go and it springs back flat under the gold.
  let from = null;
  // ?bend=0.8 holds the book fanned, for stills.
  const still = typeof location !== "undefined" ? parseFloat(new URLSearchParams(location.search).get("bend")) : NaN;
  let want = Number.isFinite(still) ? still : 0;
  // A still is a photograph, not an entrance: it shows up whole, no fade.
  if (Number.isFinite(still)) stage.canvas.style.transition = "none";
  let bend = want;
  let vel = 0;
  stage.on("down", (p) => {
    from = { x: p.x, y: p.y, b: want };
  });
  stage.on("up", () => {
    from = null;
    want = Number.isFinite(still) ? still : 0;
  });

  // The stage may have measured itself while the painting was loading.
  onSize(stage.width, stage.height);

  stage.onFrame((dt) => {
    const p = stage.pointer;
    if (from && p.down) {
      const reach = Math.min(stage.width, stage.height) * 0.42;
      const d = Math.hypot(p.x - from.x, (p.y - from.y) * 0.6);
      want = clamp(d / reach, 0, 1);
    }
    // Paper is springy: an underdamped return that settles flush.
    const k = from ? 180 : 120;
    const c = from ? 26 : 13;
    vel += ((want - bend) * k - vel * c) * dt;
    bend += vel * dt;
    bend = clamp(bend, -0.04, 1.05);
    const b = Math.max(0, bend);
    // Only draw when the book moves: at rest it is a still life.
    if (dirty || Math.abs(b - uniforms.uBend.value) > 1e-5) {
      uniforms.uBend.value = b;
      renderer.render(scene, camera);
      dirty = false;
    }
  });

  // Compile and draw the first frame before saying ready, so the canvas fades
  // in on a finished picture rather than stalling mid-fade on shader work.
  renderer.compile(scene, camera);
  uniforms.uBend.value = Math.max(0, bend);
  renderer.render(scene, camera);
  dirty = false;

  return {
    destroy: () => {
      stage.destroy();
      renderer.dispose();
      pmrem.dispose();
    },
  };
}
