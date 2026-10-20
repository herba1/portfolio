import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

import { CARD_H, CARD_R, CARD_W, FOIL, PX, SLOT, drawBack, drawFoilThickness, drawFront, drawFrontSurface, drawStrap, drawWeave, loadFonts, newCanvas } from "./lanyardArt";
import { createFoley } from "./lanyardAudio";
import { STRAP_POINTS, shadeFragment, shadeVertex, wallFragment, wallVertex } from "./lanyardShader";

const GRAVITY = -40;
const DAMPING = 2;
const STEP = 1 / 120;
const ITERATIONS = 10;
const CLIP_Y = CARD_H / 2 + 0.27;
const THICK = 0.014;
const STRAP_W = 0.34;
const STRAP_TILE = STRAP_W * 8;
const STRAP_SAMPLES = 56;
const WALL_Z = -0.95;
const SHADOW_SCALE = 0.25;
const FOV = 25;
const TWIST_K = 9;
const TWIST_DAMP = 2.4;
const MAX_SPEED = 13;
const LIGHT = new THREE.Vector3(-0.36, 0.52, 1).normalize();

const ANCHOR = 0;
const R1 = 1;
const R2 = 2;
const K = 3;
const BL = 4;
const BR = 5;
const CARD = [K, BL, BR];
const LOCAL = {
  [K]: new THREE.Vector3(0, CLIP_Y, 0),
  [BL]: new THREE.Vector3(-CARD_W / 2, -CARD_H / 2, 0),
  [BR]: new THREE.Vector3(CARD_W / 2, -CARD_H / 2, 0),
};

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const damp = (x, y, lambda, dt) => x + (y - x) * (1 - Math.exp(-lambda * dt));

function cardShape() {
  const w = CARD_W / 2;
  const h = CARD_H / 2;
  const r = CARD_R;
  const s = new THREE.Shape();
  s.moveTo(-w + r, -h);
  s.lineTo(w - r, -h);
  s.quadraticCurveTo(w, -h, w, -h + r);
  s.lineTo(w, h - r);
  s.quadraticCurveTo(w, h, w - r, h);
  s.lineTo(-w + r, h);
  s.quadraticCurveTo(-w, h, -w, h - r);
  s.lineTo(-w, -h + r);
  s.quadraticCurveTo(-w, -h, -w + r, -h);
  const sw = SLOT.w / 2;
  const sh = SLOT.h / 2;
  const hole = new THREE.Path();
  hole.moveTo(-sw + sh, SLOT.y - sh);
  hole.lineTo(sw - sh, SLOT.y - sh);
  hole.absarc(sw - sh, SLOT.y, sh, -Math.PI / 2, Math.PI / 2, false);
  hole.lineTo(-sw + sh, SLOT.y + sh);
  hole.absarc(-sw + sh, SLOT.y, sh, Math.PI / 2, Math.PI * 1.5, false);
  s.holes.push(hole);
  return s;
}

function foilShape() {
  const x0 = FOIL.x / PX - CARD_W / 2;
  const x1 = (FOIL.x + FOIL.w) / PX - CARD_W / 2;
  const y1 = CARD_H / 2 - FOIL.y / PX;
  const y0 = CARD_H / 2 - (FOIL.y + FOIL.h) / PX;
  const r = FOIL.r / PX;
  const s = new THREE.Shape();
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0);
  s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r);
  s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

function faceGeometry(shape) {
  const g = new THREE.ShapeGeometry(shape, 12);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i += 1) {
    uv.setXY(i, (pos.getX(i) + CARD_W / 2) / CARD_W, (pos.getY(i) + CARD_H / 2) / CARD_H);
  }
  uv.needsUpdate = true;
  return g;
}

function canvasTexture(canvas, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function studio(renderer, ground) {
  const room = new THREE.Scene();
  room.background = new THREE.Color().setScalar(ground);
  const plane = new THREE.PlaneGeometry();
  const strips = [
    { i: 2, p: [0, -1, 5], r: [0, 0, Math.PI / 3], s: [100, 0.1, 1] },
    { i: 3, p: [-1, -1, 1], r: [0, 0, Math.PI / 3], s: [100, 0.1, 1] },
    { i: 3, p: [1, 1, 1], r: [0, 0, Math.PI / 3], s: [100, 0.1, 1] },
    { i: 2, p: [-10, 0, 14], r: [0, Math.PI / 2, Math.PI / 3], s: [100, 10, 1] },
    { i: 1.4, p: [-5, 6, 7], r: [-0.6, -0.5, 0], s: [9, 4, 1] },
    { i: 0.6, p: [8, 2, 4], r: [0, -Math.PI / 2.4, 0], s: [6, 10, 1] },
  ];
  const mats = [];
  for (const { i, p, r, s } of strips) {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(i), side: THREE.DoubleSide });
    mats.push(m);
    const mesh = new THREE.Mesh(plane, m);
    mesh.position.set(...p);
    mesh.rotation.set(...r);
    mesh.scale.set(...s);
    room.add(mesh);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(room, 0.02).texture;
  plane.dispose();
  mats.forEach((m) => m.dispose());
  pmrem.dispose();
  return env;
}

export async function createLanyard(stage, canvas, { embedded = false, reducedMotion = false, onChange = () => {} } = {}) {
  const host = stage.closest(".piece-box") || stage;
  const fonts = await loadFonts(stage);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
  const env = studio(renderer, 0.34);
  const darkEnv = studio(renderer, 0.035);
  scene.environment = env;
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.copy(LIGHT).multiplyScalar(10);
  scene.add(key);

  const shape = cardShape();
  const frontCanvas = drawFront(newCanvas(), fonts);
  const surfaceCanvas = drawFrontSurface(newCanvas());
  const backCanvas = drawBack(newCanvas(), fonts);
  const strapCanvas = drawStrap(newCanvas(128, 1024), fonts);
  const weaveCanvas = drawWeave(newCanvas(64, 64));
  const thicknessCanvas = drawFoilThickness(newCanvas(256, 360));

  const frontTex = canvasTexture(frontCanvas);
  const surfaceTex = canvasTexture(surfaceCanvas, false);
  const backTex = canvasTexture(backCanvas);
  const strapTex = canvasTexture(strapCanvas);
  strapTex.wrapS = THREE.RepeatWrapping;
  strapTex.wrapT = THREE.RepeatWrapping;
  const thicknessTex = canvasTexture(thicknessCanvas, false);
  const weaveTex = canvasTexture(weaveCanvas, false);
  weaveTex.wrapS = THREE.RepeatWrapping;
  weaveTex.wrapT = THREE.RepeatWrapping;
  weaveTex.repeat.set(1, 8);

  const finish = { clearcoat: 1, clearcoatRoughness: 0.08, envMap: darkEnv, envMapIntensity: 1 };
  const frontMat = new THREE.MeshPhysicalMaterial({ ...finish, map: frontTex, roughness: 0.32, metalness: 0 });
  const foilMat = new THREE.MeshPhysicalMaterial({
    map: frontTex,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.25,
    roughness: 1,
    metalness: 1,
    roughnessMap: surfaceTex,
    metalnessMap: surfaceTex,
    iridescence: 1,
    iridescenceMap: surfaceTex,
    iridescenceThicknessMap: thicknessTex,
    iridescenceIOR: 1.8,
    iridescenceThicknessRange: [240, 560],
  });
  const backMat = new THREE.MeshPhysicalMaterial({ ...finish, map: backTex, roughness: 0.34, metalness: 0 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.4, envMap: darkEnv });
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const metal = new THREE.MeshStandardMaterial({ color: 0xdcdde0, metalness: 1, roughness: 0.22, envMapIntensity: 1.2 });

  const front = new THREE.Mesh(faceGeometry(shape), frontMat);
  front.position.z = THICK / 2 + 0.0005;
  const foil = new THREE.Mesh(faceGeometry(foilShape()), foilMat);
  foil.position.z = THICK / 2 + 0.0011;
  const backGeo = faceGeometry(shape);
  backGeo.rotateY(Math.PI);
  const back = new THREE.Mesh(backGeo, backMat);
  back.position.z = -THICK / 2 - 0.0005;
  const edgeGeo = new THREE.ExtrudeGeometry(shape, { depth: THICK, bevelEnabled: false, curveSegments: 12 });
  edgeGeo.translate(0, 0, -THICK / 2);
  const edge = new THREE.Mesh(edgeGeo, [hidden, edgeMat]);

  const crimpGeo = new RoundedBoxGeometry(0.4, 0.15, 0.06, 3, 0.022);
  const crimp = new THREE.Mesh(crimpGeo, metal);
  crimp.position.set(0, CLIP_Y - 0.075, 0);
  const ringGeo = new THREE.TorusGeometry(0.075, 0.013, 14, 48);
  const ring = new THREE.Mesh(ringGeo, metal);
  ring.rotation.y = Math.PI / 2;
  ring.scale.set(1, 1.75, 1);
  ring.position.set(0, CARD_H / 2 - 0.02, 0);

  const card = new THREE.Group();
  card.matrixAutoUpdate = false;
  card.add(front, foil, back, edge, crimp, ring);
  scene.add(card);
  const hitTargets = [front, foil, back, edge, crimp];

  const strapGeo = new THREE.BufferGeometry();
  const strapPos = new Float32Array((STRAP_SAMPLES + 1) * 2 * 3);
  const strapNorm = new Float32Array((STRAP_SAMPLES + 1) * 2 * 3);
  const strapUv = new Float32Array((STRAP_SAMPLES + 1) * 2 * 2);
  const strapIdx = [];
  for (let j = 0; j < STRAP_SAMPLES; j += 1) {
    const a = j * 2;
    strapIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  strapGeo.setIndex(strapIdx);
  strapGeo.setAttribute("position", new THREE.BufferAttribute(strapPos, 3).setUsage(THREE.DynamicDrawUsage));
  strapGeo.setAttribute("normal", new THREE.BufferAttribute(strapNorm, 3).setUsage(THREE.DynamicDrawUsage));
  strapGeo.setAttribute("uv", new THREE.BufferAttribute(strapUv, 2).setUsage(THREE.DynamicDrawUsage));
  const strapMat = new THREE.MeshStandardMaterial({
    map: strapTex,
    bumpMap: weaveTex,
    bumpScale: 1.2,
    roughness: 0.82,
    side: THREE.DoubleSide,
    envMapIntensity: 0.7,
  });
  strapMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      "vec2 strapUv = gl_FrontFacing ? vMapUv : vec2(1.0 - vMapUv.x, vMapUv.y);\nvec4 sampledDiffuseColor = texture2D( map, strapUv );\ndiffuseColor *= sampledDiffuseColor;",
    );
  };
  const strap = new THREE.Mesh(strapGeo, strapMat);
  strap.frustumCulled = false;
  scene.add(strap);

  const wallUniforms = {
    uCardInv: { value: new THREE.Matrix4() },
    uCardN: { value: new THREE.Vector3(0, 0, 1) },
    uCardC: { value: new THREE.Vector3() },
    uLight: { value: LIGHT.clone() },
    uHalf: { value: new THREE.Vector2(CARD_W / 2, CARD_H / 2) },
    uRadius: { value: CARD_R },
    uStrap: { value: Array.from({ length: STRAP_POINTS }, () => new THREE.Vector3()) },
    uStrapHalf: { value: STRAP_W * 0.4 },
    uShade: { value: new THREE.Color(0x1c2733) },
  };
  const wallMat = new THREE.ShaderMaterial({
    uniforms: wallUniforms,
    vertexShader: wallVertex,
    fragmentShader: wallFragment,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
  });
  const wallGeo = new THREE.PlaneGeometry(1, 1);
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.position.z = WALL_Z;
  const shadowScene = new THREE.Scene();
  shadowScene.add(wall);
  const shadowTarget = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });
  const shadeMat = new THREE.ShaderMaterial({
    uniforms: { uShadow: { value: shadowTarget.texture }, uSize: { value: new THREE.Vector2(1, 1) } },
    vertexShader: shadeVertex,
    fragmentShader: shadeFragment,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    depthTest: false,
  });
  const shade = new THREE.Mesh(wallGeo, shadeMat);
  shade.position.z = WALL_Z;
  shade.renderOrder = -1;
  scene.add(shade);

  const pos = Array.from({ length: 6 }, () => new THREE.Vector3());
  const prev = Array.from({ length: 6 }, () => new THREE.Vector3());
  const inv = [0, 1, 1, 1, 1, 1];
  const rigid = [
    [K, BL, LOCAL[K].distanceTo(LOCAL[BL])],
    [K, BR, LOCAL[K].distanceTo(LOCAL[BR])],
    [BL, BR, CARD_W],
  ];
  const smoothR = [new THREE.Vector3(), new THREE.Vector3()];

  const view = { w: 1, h: 1, halfW: 1, halfH: 1, link: 0.6, anchorY: 3 };
  const frame = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), n: new THREE.Vector3(0, 0, 1), c: new THREE.Vector3() };
  const twist = { cum: 0, raw: 0, target: 0, side: 0, strapCum: 0, strapRaw: 0 };
  const curve = new THREE.CatmullRomCurve3(Array.from({ length: 5 }, () => new THREE.Vector3()), false, "chordal");
  const tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), q: new THREE.Quaternion(), m: new THREE.Matrix4() };

  const foley = createFoley();
  let raf = 0;
  let last = 0;
  let acc = 0;
  let visible = true;
  let destroyed = false;
  let awake = true;
  let quiet = 0;
  let drag = null;
  let hover = false;

  function layout() {
    const rect = host.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    view.w = w;
    view.h = h;
    const aspect = w / h;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const compact = w < 900;
    let halfH = CARD_H / (2 * (compact ? 0.44 : 0.52));
    halfH = Math.max(halfH, (compact ? 1.12 : 1.4) / aspect);
    view.halfH = halfH;
    view.halfW = halfH * aspect;
    camera.position.set(0, 0, halfH / tan);
    camera.aspect = aspect;
    camera.near = 0.1;
    camera.far = camera.position.z + 10;
    camera.updateProjectionMatrix();
    const bottom = -halfH + 2 * halfH * (compact ? 0.13 : 0.1);
    const kY = bottom + CARD_H + (CLIP_Y - CARD_H / 2);
    view.anchorY = halfH + 0.45;
    view.link = Math.max(0.3, (view.anchorY - kY) / 3);
    view.compact = compact;
    pos[ANCHOR].set(0, view.anchorY, 0);
    prev[ANCHOR].copy(pos[ANCHOR]);
    const span = 2 * (camera.position.z - WALL_Z) * tan * 1.1;
    wall.scale.set(span * aspect, span, 1);
    shade.scale.copy(wall.scale);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    shadowTarget.setSize(Math.max(4, Math.round(w * SHADOW_SCALE)), Math.max(4, Math.round(h * SHADOW_SCALE)));
    shadeMat.uniforms.uSize.value.set(w * ratio, h * ratio);
  }

  function place(angle, yaw) {
    const dir = new THREE.Vector3(Math.sin(angle), -Math.cos(angle), 0);
    for (let i = 1; i <= K; i += 1) pos[i].copy(pos[ANCHOR]).addScaledVector(dir, view.link * i);
    const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, angle));
    for (const i of [BL, BR]) {
      tmp.a.copy(LOCAL[i]).sub(LOCAL[K]).applyQuaternion(rot);
      pos[i].copy(pos[K]).add(tmp.a);
    }
    for (let i = 0; i < 6; i += 1) prev[i].copy(pos[i]);
    smoothR[0].copy(pos[R1]);
    smoothR[1].copy(pos[R2]);
    twist.cum = yaw;
    twist.raw = yaw;
  }

  function cardFrame() {
    const { x, y, n, c } = frame;
    x.subVectors(pos[BR], pos[BL]).normalize();
    c.addVectors(pos[BL], pos[BR]).multiplyScalar(0.5);
    y.subVectors(pos[K], c);
    y.addScaledVector(x, -y.dot(x)).normalize();
    n.crossVectors(x, y).normalize();
    c.addScaledVector(y, CARD_H / 2);
  }

  function trackYaw() {
    const yaw = Math.atan2(frame.n.x, frame.n.z);
    twist.cum += wrap(yaw - twist.raw);
    twist.raw = yaw;
  }

  function spinAbout(dOmega) {
    for (const i of [BL, BR]) {
      const rx = pos[i].x - pos[K].x;
      const rz = pos[i].z - pos[K].z;
      prev[i].x -= dOmega * STEP * rz;
      prev[i].z += dOmega * STEP * rx;
    }
  }

  function yawRate() {
    let num = 0;
    let den = 0;
    for (const i of [BL, BR]) {
      const rx = pos[i].x - pos[K].x;
      const rz = pos[i].z - pos[K].z;
      const vx = (pos[i].x - prev[i].x) / STEP;
      const vz = (pos[i].z - prev[i].z) / STEP;
      num += rz * vx - rx * vz;
      den += rx * rx + rz * rz;
    }
    return den > 1e-6 ? num / den : 0;
  }

  function solveRope() {
    const pairs = [
      [ANCHOR, R1],
      [R1, R2],
      [R2, K],
    ];
    for (const [a, b] of pairs) {
      tmp.a.subVectors(pos[b], pos[a]);
      const d = tmp.a.length();
      if (d <= view.link || d < 1e-6) continue;
      const wa = inv[a];
      const wb = inv[b];
      const sum = wa + wb;
      if (sum === 0) continue;
      const corr = (d - view.link) / d / sum;
      pos[a].addScaledVector(tmp.a, wa * corr);
      pos[b].addScaledVector(tmp.a, -wb * corr);
    }
  }

  function solveCard() {
    for (const [a, b, len] of rigid) {
      tmp.a.subVectors(pos[b], pos[a]);
      const d = tmp.a.length();
      const wa = inv[a];
      const wb = inv[b];
      const sum = wa + wb;
      if (sum === 0 || d < 1e-6) continue;
      const corr = (d - len) / d / sum;
      pos[a].addScaledVector(tmp.a, wa * corr);
      pos[b].addScaledVector(tmp.a, -wb * corr);
    }
  }

  function holdTargets(alpha) {
    const g = drag.target;
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), drag.lean);
    const rollQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), drag.roll);
    yawQ.multiply(rollQ);
    for (const i of CARD) {
      tmp.b.copy(drag.offsets[i]).applyQuaternion(yawQ).add(g);
      pos[i].lerp(tmp.b, alpha);
    }
  }

  function step() {
    const fade = Math.exp(-DAMPING * STEP);
    const g = GRAVITY * STEP * STEP;
    for (let i = 1; i < 6; i += 1) {
      if (inv[i] === 0) continue;
      tmp.a.subVectors(pos[i], prev[i]).multiplyScalar(fade);
      prev[i].copy(pos[i]);
      pos[i].add(tmp.a);
      pos[i].y += g;
    }
    if (drag) {
      for (const i of CARD) prev[i].copy(pos[i]);
      holdTargets(1 - Math.exp(-40 * STEP));
    }
    for (let k = 0; k < ITERATIONS; k += 1) {
      solveCard();
      solveRope();
    }
    cardFrame();
    trackYaw();
    if (!drag) {
      const target = twist.side * Math.PI;
      const err = clamp(target - twist.cum, -2.6, 2.6);
      const omega = yawRate();
      spinAbout(err * TWIST_K * STEP - omega * (1 - Math.exp(-TWIST_DAMP * STEP)));
    }
  }

  function settleCheck() {
    let move = 0;
    for (let i = 1; i < 6; i += 1) move = Math.max(move, pos[i].distanceToSquared(prev[i]));
    const err = Math.abs(twist.side * Math.PI - twist.cum);
    if (!drag && move < 1e-10 && err < 0.004) quiet += 1;
    else quiet = 0;
    return quiet > 20;
  }

  function smoothStrap(dt) {
    for (let k = 0; k < 2; k += 1) {
      const target = pos[k === 0 ? R1 : R2];
      const s = smoothR[k];
      const dist = clamp(s.distanceTo(target), 0.1, 1);
      s.lerp(target, Math.min(1, dt * (10 + dist * 40)));
    }
  }

  function buildStrap() {
    const { x, y } = frame;
    const pts = curve.points;
    pts[0].copy(pos[K]);
    pts[1].copy(pos[K]).addScaledVector(y, 0.3);
    pts[2].copy(smoothR[1]);
    pts[3].copy(smoothR[0]);
    pts[4].copy(pos[ANCHOR]).add(tmp.c.set(0, 0.6, 0));
    curve.updateArcLengths();
    const samples = curve.getSpacedPoints(STRAP_SAMPLES);
    const tangents = samples.map((p, j) => {
      const a = samples[Math.max(0, j - 1)];
      const b = samples[Math.min(STRAP_SAMPLES, j + 1)];
      return new THREE.Vector3().subVectors(b, a).normalize();
    });
    const sides = new Array(STRAP_SAMPLES + 1);
    let side = new THREE.Vector3(1, 0, 0);
    side.addScaledVector(tangents[STRAP_SAMPLES], -side.dot(tangents[STRAP_SAMPLES])).normalize();
    sides[STRAP_SAMPLES] = side.clone();
    for (let j = STRAP_SAMPLES - 1; j >= 0; j -= 1) {
      tmp.q.setFromUnitVectors(tangents[j + 1], tangents[j]);
      side = side.clone().applyQuaternion(tmp.q);
      side.addScaledVector(tangents[j], -side.dot(tangents[j])).normalize();
      sides[j] = side;
    }
    const t0 = tangents[0];
    tmp.a.copy(x).addScaledVector(t0, -x.dot(t0)).normalize();
    const phi = Math.atan2(tmp.b.crossVectors(sides[0], tmp.a).dot(t0), sides[0].dot(tmp.a));
    twist.strapCum += wrap(phi - twist.strapRaw);
    twist.strapRaw = phi;
    let len = 0;
    for (let j = 0; j <= STRAP_SAMPLES; j += 1) {
      if (j > 0) len += samples[j].distanceTo(samples[j - 1]);
      const t = j / STRAP_SAMPLES;
      const weight = Math.pow(1 - t, 1.4);
      tmp.q.setFromAxisAngle(tangents[j], twist.strapCum * weight);
      const s = sides[j].clone().applyQuaternion(tmp.q);
      const n = tmp.c.crossVectors(s, tangents[j]).normalize();
      const p = samples[j];
      const o = j * 6;
      strapPos[o] = p.x - s.x * STRAP_W * 0.5;
      strapPos[o + 1] = p.y - s.y * STRAP_W * 0.5;
      strapPos[o + 2] = p.z - s.z * STRAP_W * 0.5;
      strapPos[o + 3] = p.x + s.x * STRAP_W * 0.5;
      strapPos[o + 4] = p.y + s.y * STRAP_W * 0.5;
      strapPos[o + 5] = p.z + s.z * STRAP_W * 0.5;
      strapNorm.set([n.x, n.y, n.z, n.x, n.y, n.z], o);
      const v = len / STRAP_TILE;
      strapUv.set([0, v, 1, v], j * 4);
    }
    strapGeo.attributes.position.needsUpdate = true;
    strapGeo.attributes.normal.needsUpdate = true;
    strapGeo.attributes.uv.needsUpdate = true;
    strapGeo.computeBoundingSphere();
    const shadow = wallUniforms.uStrap.value;
    for (let i = 0; i < STRAP_POINTS; i += 1) {
      const p = samples[Math.round((i / (STRAP_POINTS - 1)) * STRAP_SAMPLES)];
      const depth = (p.z - WALL_Z) / LIGHT.z;
      shadow[i].set(p.x - LIGHT.x * depth, p.y - LIGHT.y * depth, depth);
    }
  }

  function updateCard() {
    const { x, y, n, c } = frame;
    tmp.m.makeBasis(x, y, n).setPosition(c);
    card.matrix.copy(tmp.m);
    card.matrixWorldNeedsUpdate = true;
    wallUniforms.uCardInv.value.copy(tmp.m).invert();
    wallUniforms.uCardN.value.copy(n);
    wallUniforms.uCardC.value.copy(c);
  }

  function render() {
    updateCard();
    buildStrap();
    renderer.setRenderTarget(shadowTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(shadowScene, camera);
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  }

  function tick(now) {
    raf = 0;
    if (destroyed || !visible) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    if (drag) {
      drag.lean = damp(drag.lean, clamp(-drag.vx * 0.09, -0.55, 0.55), 10, dt);
      drag.roll = damp(drag.roll, clamp(-drag.vx * 0.035, -0.22, 0.22), 10, dt);
      drag.vx = damp(drag.vx, 0, 6, dt);
    }
    acc += dt;
    while (acc >= STEP) {
      step();
      acc -= STEP;
    }
    smoothStrap(dt);
    render();
    if (settleCheck()) {
      awake = false;
      last = 0;
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function wake() {
    awake = true;
    quiet = 0;
    if (!raf && visible && !destroyed) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function pointerRay(event) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray;
  }

  function hitCard(event) {
    pointerRay(event);
    card.updateMatrixWorld(true);
    const hits = raycaster.intersectObjects(hitTargets, false);
    return hits[0] || null;
  }

  function planePoint(z, out) {
    const ray = raycaster.ray;
    const t = (z - ray.origin.z) / ray.direction.z;
    return out.copy(ray.origin).addScaledVector(ray.direction, t);
  }

  function clampTarget(target) {
    target.x = clamp(target.x, -view.halfW * 0.92, view.halfW * 0.92);
    target.y = clamp(target.y, -view.halfH * 0.95, view.halfH * 0.9);
    tmp.a.copy(drag.offsets[K]).add(target).sub(pos[ANCHOR]);
    const reach = view.link * 3 * 0.995;
    const d = tmp.a.length();
    if (d > reach) target.addScaledVector(tmp.a, (reach - d) / d);
  }

  function setCursor() {
    canvas.style.cursor = drag ? "grabbing" : hover ? "grab" : "";
  }

  function onPointerDown(event) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const hit = hitCard(event);
    if (!hit) return;
    event.preventDefault();
    foley.unlock();
    canvas.setPointerCapture(event.pointerId);
    const grab = hit.point.clone();
    const offsets = {};
    for (const i of CARD) offsets[i] = pos[i].clone().sub(grab);
    drag = { id: event.pointerId, z: grab.z, target: grab.clone(), offsets, lean: 0, roll: 0, vx: 0, lastX: grab.x, lastT: performance.now() };
    for (const i of CARD) inv[i] = 0;
    foley.tick(0.8);
    setCursor();
    onChange({ held: true });
    wake();
  }

  function onPointerMove(event) {
    if (drag && event.pointerId === drag.id) {
      pointerRay(event);
      const p = planePoint(drag.z, new THREE.Vector3());
      clampTarget(p);
      const now = performance.now();
      const dt = Math.max(0.008, (now - drag.lastT) / 1000);
      drag.vx = damp(drag.vx, (p.x - drag.lastX) / dt, 14, dt);
      drag.lastX = p.x;
      drag.lastT = now;
      drag.target.copy(p);
      wake();
      return;
    }
    if (event.pointerType !== "mouse") return;
    const over = Boolean(hitCard(event));
    if (over !== hover) {
      hover = over;
      setCursor();
    }
  }

  function release(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    try {
      canvas.releasePointerCapture(drag.id);
    } catch {}
    const maxStep = MAX_SPEED * STEP;
    let speed = 0;
    for (const i of CARD) {
      inv[i] = 1;
      tmp.a.subVectors(pos[i], prev[i]);
      const d = tmp.a.length();
      speed = Math.max(speed, d / STEP);
      if (d > maxStep) prev[i].copy(pos[i]).addScaledVector(tmp.a, -maxStep / d);
    }
    spinAbout(clamp(drag.vx * 0.25, -3, 3));
    drag = null;
    foley.tick(0.5);
    if (speed > 6) foley.clink(Math.min(1, speed / MAX_SPEED));
    setCursor();
    onChange({ held: false });
    wake();
  }

  function flip() {
    twist.side = twist.side === 0 ? 1 : 0;
    const dir = twist.side === 1 ? 1 : -1;
    spinAbout(dir * 7.5);
    for (const i of CARD) prev[i].y -= 2.2 * STEP;
    foley.unlock();
    foley.whoosh();
    onChange({ side: twist.side === 1 ? "back" : "front" });
    wake();
  }

  function onDoubleClick(event) {
    if (!hitCard(event)) return;
    flip();
  }

  function nudge(dx, dy) {
    for (const i of CARD) {
      prev[i].x -= dx * STEP;
      prev[i].y -= dy * STEP;
    }
    wake();
  }

  function onLeave() {
    if (hover) {
      hover = false;
      setCursor();
    }
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("lostpointercapture", release);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("dblclick", onDoubleClick);

  const ro = new ResizeObserver(() => {
    layout();
    wake();
  });
  ro.observe(host);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && !document.hidden;
    if (visible) wake();
  });
  io.observe(stage);
  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
  };
  document.addEventListener("visibilitychange", onVisibility);

  layout();
  if (reducedMotion) place(0, 0);
  else {
    const reach = view.link * 3 + CLIP_Y + CARD_H / 2;
    const offset = Math.min(0.85, view.halfW - CARD_W / 2 - 0.15);
    place(Math.asin(clamp(offset / reach, 0, 0.5)), 1.1);
  }
  cardFrame();
  smoothR[0].copy(pos[R1]);
  smoothR[1].copy(pos[R2]);
  render();
  wake();

  return {
    flip,
    nudge,
    get side() {
      return twist.side === 1 ? "back" : "front";
    },
    get awake() {
      return awake;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", release);
      canvas.removeEventListener("pointercancel", release);
      canvas.removeEventListener("lostpointercapture", release);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("dblclick", onDoubleClick);
      foley.close();
      [front.geometry, foil.geometry, backGeo, edgeGeo, crimpGeo, ringGeo, strapGeo, wallGeo].forEach((g) => g.dispose());
      [frontMat, foilMat, backMat, edgeMat, hidden, metal, strapMat, wallMat, shadeMat].forEach((m) => m.dispose());
      [frontTex, surfaceTex, backTex, strapTex, weaveTex, thicknessTex, env, darkEnv].forEach((t) => t.dispose());
      shadowTarget.dispose();
      renderer.dispose();
    },
  };
}
