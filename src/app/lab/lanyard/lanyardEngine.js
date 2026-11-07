import * as THREE from "three";

import { createStage } from "../_kit/stage";
import { paintCard, paintStrap, paintPeel } from "./lanyardArt";
import { createSim, CARD } from "./lanyardSim";

const BG = "#f2f0eb";
const WALL_Z = -0.85;

// A soft studio for the laminate and the metal to reflect: a warm room, one
// broad softbox above and in front, and a thin strip to the left. The
// laminate's gloss is these panels sliding across the print as the card turns.
function makeEnvironment(renderer) {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(30, 30, 30), new THREE.MeshBasicMaterial({ color: new THREE.Color("#a59d91"), side: THREE.BackSide }));
  scene.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: new THREE.Color("#5c564d") }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -10;
  scene.add(floor);
  const panel = (w, h, pos, intensity) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.97, 0.92).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.copy(pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  panel(12, 5, new THREE.Vector3(-1, 8, 10), 5.5);
  panel(1.6, 12, new THREE.Vector3(-12, 1, 4), 3.2);
  panel(6, 3, new THREE.Vector3(9, 4, -6), 1.6);
  // Behind the camera: a low band that grazes the top of the pass at rest,
  // and a tall strip off to the left that the gloss sweeps through on a turn.
  panel(16, 2.4, new THREE.Vector3(0, 2.2, 13), 2.6);
  panel(1.4, 12, new THREE.Vector3(-3.4, 0.5, 12.5), 3.4);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.015).texture;
  pmrem.dispose();
  scene.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  return env;
}

// The card body: a rounded slab with bevelled edges. The two faces read from
// one atlas, front on the left half and back on the right.
function cardGeometry() {
  const { W, H, T, R } = CARD;
  const bevel = 0.007;
  const w = W - bevel * 2;
  const h = H - bevel * 2;
  const r = R - bevel;
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const depth = T - bevel * 2;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  const cap = g.groups[0];
  for (let i = cap.start; i < cap.start + cap.count; i += 1) {
    const x = pos.getX(i) / W + 0.5;
    const y = pos.getY(i) / H + 0.5;
    uv.setXY(i, pos.getZ(i) > 0 ? x * 0.5 : 0.5 + (1 - x) * 0.5, y);
  }
  uv.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// The clip that bites the top edge: a nickel jaw on both faces, a swivel
// shank and the ring the strap is sewn through. Everything is in card space.
function makeClip(metal) {
  const { H, T, PIVOT } = CARD;
  const group = new THREE.Group();
  const top = H / 2;
  const jawGeo = new THREE.BoxGeometry(0.2, 0.15, 0.012);
  for (const side of [1, -1]) {
    const jaw = new THREE.Mesh(jawGeo, metal);
    jaw.position.set(0, top - 0.035, side * (T / 2 + 0.006));
    group.add(jaw);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.024, T + 0.024), metal);
  bridge.position.set(0, top + 0.05, 0);
  group.add(bridge);
  const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 12), metal);
  rib.rotation.z = Math.PI / 2;
  rib.position.set(0, top + 0.03, T / 2 + 0.012);
  group.add(rib);
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, PIVOT - top - 0.08, 14), metal);
  shank.position.set(0, (top + 0.06 + PIVOT - 0.02) / 2, 0);
  group.add(shank);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.01, 10, 28), metal);
  ring.position.set(0, PIVOT - 0.02, 0);
  ring.rotation.y = Math.PI / 2;
  group.add(ring);
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return group;
}

export async function createLanyard(host, { embedded = false } = {}) {
  const params = new URLSearchParams(location.search);
  const still = params.has("t") ? Math.max(0, parseFloat(params.get("t")) || 0) : null;

  const stage = createStage(host, { dpr: 2, webgl: true });
  const { canvas } = stage;
  const renderer = new THREE.WebGLRenderer({ canvas, context: stage.ctx, antialias: true });
  renderer.setClearColor(BG, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  const aniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  scene.environment = makeEnvironment(renderer);
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(24, 1, 1, 60);

  scene.add(new THREE.HemisphereLight("#fffaf2", "#b8ad9c", 0.9));
  const key = new THREE.DirectionalLight("#fff6ea", 2.4);
  key.position.set(-2.2, 4.4, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -4.5;
  key.shadow.camera.right = 4.5;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -4;
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 22;
  key.shadow.radius = 16;
  key.shadow.blurSamples = 16;
  key.shadow.bias = -0.0004;
  scene.add(key);

  const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ color: new THREE.Color("#3b2c1c"), opacity: 0.13 }));
  wall.position.z = WALL_Z;
  wall.receiveShadow = true;
  scene.add(wall);

  // Fonts and the cover have to be in before the print is painted.
  const art = await paintCard();
  const strapArt = paintStrap();
  const peel = paintPeel();

  const cardTex = new THREE.CanvasTexture(art.canvas);
  cardTex.colorSpace = THREE.SRGBColorSpace;
  cardTex.anisotropy = aniso;
  const peelTex = new THREE.CanvasTexture(peel);
  peelTex.wrapS = peelTex.wrapT = THREE.RepeatWrapping;
  peelTex.repeat.set(7, 5);

  const face = new THREE.MeshPhysicalMaterial({
    map: cardTex,
    roughness: 0.62,
    clearcoat: 1,
    clearcoatRoughness: 0.07,
    clearcoatNormalMap: peelTex,
    clearcoatNormalScale: new THREE.Vector2(0.025, 0.025),
    specularIntensity: 0.4,
  });
  const edge = new THREE.MeshPhysicalMaterial({ color: "#f3efe4", roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 });
  const metal = new THREE.MeshPhysicalMaterial({ color: "#c4c0b8", metalness: 1, roughness: 0.3, envMapIntensity: 2.2 });

  const card = new THREE.Group();
  const slab = new THREE.Mesh(cardGeometry(), [face, edge]);
  slab.castShadow = true;
  card.add(slab);
  card.add(makeClip(metal));
  scene.add(card);

  // The strap: a flat ribbon swept along the rope, its face turned by the
  // twist the rope is carrying, woven texture with a printed repeat.
  const SAMPLES = 120;
  const strapGeo = new THREE.BufferGeometry();
  const sPos = new Float32Array(SAMPLES * 2 * 3);
  const sNor = new Float32Array(SAMPLES * 2 * 3);
  const sUv = new Float32Array(SAMPLES * 2 * 2);
  const idx = [];
  for (let i = 0; i < SAMPLES - 1; i += 1) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  strapGeo.setIndex(idx);
  strapGeo.setAttribute("position", new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage));
  strapGeo.setAttribute("normal", new THREE.BufferAttribute(sNor, 3).setUsage(THREE.DynamicDrawUsage));
  strapGeo.setAttribute("uv", new THREE.BufferAttribute(sUv, 2).setUsage(THREE.DynamicDrawUsage));
  const strapTex = new THREE.CanvasTexture(strapArt.color);
  strapTex.colorSpace = THREE.SRGBColorSpace;
  strapTex.wrapS = strapTex.wrapT = THREE.RepeatWrapping;
  strapTex.anisotropy = aniso;
  const strapNor = new THREE.CanvasTexture(strapArt.normal);
  strapNor.wrapS = strapNor.wrapT = THREE.RepeatWrapping;
  strapNor.anisotropy = aniso;
  const strapMat = new THREE.MeshPhysicalMaterial({
    map: strapTex,
    normalMap: strapNor,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.78,
    sheen: 0.6,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color("#ffd9c8"),
    side: THREE.DoubleSide,
  });
  const strap = new THREE.Mesh(strapGeo, strapMat);
  strap.castShadow = true;
  strap.frustumCulled = false;
  scene.add(strap);

  const crimp = new THREE.Mesh(new THREE.BoxGeometry(CARD.STRAP + 0.02, 0.07, 0.03), metal);
  crimp.castShadow = true;
  scene.add(crimp);

  const sim = createSim();

  // ---- strap mesh from the rope -------------------------------------------
  const curve = new THREE.CatmullRomCurve3(sim.rope.map((p) => p.clone()), false, "centripetal");
  const P = new THREE.Vector3();
  const Tn = new THREE.Vector3();
  const Nn = new THREE.Vector3();
  const Bn = new THREE.Vector3();
  const pts = Array.from({ length: SAMPLES }, () => new THREE.Vector3());
  const tmp = new THREE.Vector3();
  const qTw = new THREE.Quaternion();
  const crimpUp = new THREE.Vector3();
  const crimpBasis = new THREE.Matrix4();
  const updateStrap = () => {
    const rope = sim.rope;
    for (let i = 0; i < rope.length; i += 1) curve.points[i].copy(rope[i]);
    curve.points[rope.length - 1].copy(sim.pivotWorld);
    let len = 0;
    for (let i = 0; i < SAMPLES; i += 1) {
      curve.getPoint(i / (SAMPLES - 1), pts[i]);
      if (i) len += pts[i].distanceTo(pts[i - 1]);
    }
    Nn.set(0, 0, 1);
    let s = 0;
    const half = CARD.STRAP / 2;
    for (let i = 0; i < SAMPLES; i += 1) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(SAMPLES - 1, i + 1)];
      Tn.subVectors(b, a).normalize();
      if (i) s += pts[i].distanceTo(pts[i - 1]);
      // Parallel transport: keep the last normal, strip its tangent part.
      Nn.addScaledVector(Tn, -Nn.dot(Tn)).normalize();
      const f = s / len;
      qTw.setFromAxisAngle(Tn, sim.twist * f);
      tmp.copy(Nn).applyQuaternion(qTw);
      Bn.crossVectors(Tn, tmp).normalize();
      P.copy(pts[i]);
      const o = i * 6;
      sPos[o] = P.x - Bn.x * half;
      sPos[o + 1] = P.y - Bn.y * half;
      sPos[o + 2] = P.z - Bn.z * half;
      sPos[o + 3] = P.x + Bn.x * half;
      sPos[o + 4] = P.y + Bn.y * half;
      sPos[o + 5] = P.z + Bn.z * half;
      sNor[o] = sNor[o + 3] = tmp.x;
      sNor[o + 1] = sNor[o + 4] = tmp.y;
      sNor[o + 2] = sNor[o + 5] = tmp.z;
      const v = (len - s) / (CARD.STRAP * strapArt.aspect);
      const u = i * 4;
      sUv[u] = 1;
      sUv[u + 1] = v;
      sUv[u + 2] = 0;
      sUv[u + 3] = v;
    }
    strapGeo.attributes.position.needsUpdate = true;
    strapGeo.attributes.normal.needsUpdate = true;
    strapGeo.attributes.uv.needsUpdate = true;
    strapGeo.computeBoundingSphere();
    // The crimp sits where the strap is sewn round the ring, square to the strap's end.
    crimpUp.copy(Tn).negate();
    tmp.negate();
    crimpBasis.makeBasis(Bn, crimpUp, tmp);
    crimp.quaternion.setFromRotationMatrix(crimpBasis);
    crimp.position.copy(pts[SAMPLES - 1]).addScaledVector(Tn, -0.03);
  };

  // ---- camera -------------------------------------------------------------
  let viewW = 1;
  let viewH = 1;
  stage.onResize((w, h, dpr) => {
    viewW = w;
    viewH = h;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // Keep the whole swing in frame on narrow boxes.
    const dist = Math.max(embedded ? 8.6 : 9.2, 1.5 / (tanHalf * aspect));
    camera.position.set(0, 0.1, dist);
    camera.lookAt(0, 0.1, 0);
    camera.updateProjectionMatrix();
  });

  // ---- pointer ------------------------------------------------------------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hitPoint = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  const castAt = (p) => {
    ndc.set((p.x / viewW) * 2 - 1, -(p.y / viewH) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  const pickCard = (p) => {
    castAt(p);
    card.updateMatrixWorld();
    const hits = ray.intersectObject(card, true);
    return hits[0] || null;
  };
  const target = new THREE.Vector3();
  // A hand does not drag in a plane: the further you pull, the more the
  // card comes toward you, which is what turns it on its clip.
  const grabStart = new THREE.Vector3();
  const pointerTarget = (p) => {
    castAt(p);
    if (ray.ray.intersectPlane(plane, hitPoint)) target.copy(hitPoint);
    target.z += 0.45 * Math.min(1, target.distanceTo(grabStart) / 1.4);
    return target;
  };
  stage.on("down", (p) => {
    if (still != null) return;
    const hit = pickCard(p);
    if (!hit) return;
    inv.copy(card.matrixWorld).invert();
    const local = hit.point.clone().applyMatrix4(inv);
    plane.set(new THREE.Vector3(0, 0, 1), -hit.point.z);
    grabStart.copy(hit.point);
    sim.grab(local, pointerTarget(p).clone());
    canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (sim.dragging) {
      sim.drag(pointerTarget(p));
      return;
    }
    canvas.style.cursor = pickCard(p) ? "grab" : "";
  });
  stage.on("up", (p) => {
    if (!sim.dragging) return;
    sim.release();
    canvas.style.cursor = pickCard(p) ? "grab" : "";
  });

  // ---- still: a scripted throw held at time t after it begins ----------------
  if (still != null) {
    const corner = new THREE.Vector3(CARD.W * 0.42, -CARD.H * 0.44, CARD.T / 2);
    const start = corner.clone().applyQuaternion(sim.q).add(sim.x);
    const end = start.clone().add(new THREE.Vector3(-1.15, 0.55, 0));
    sim.grab(corner, start.clone());
    const step = 1 / 120;
    const pull = 0.42;
    for (let t = 0; t < still; t += step) {
      if (t < pull) {
        const k = t / pull;
        const e = 1 - (1 - k) ** 3;
        target.lerpVectors(start, end, e);
        target.z += 0.45 * Math.min(1, target.distanceTo(start) / 1.4);
        sim.drag(target);
      } else if (sim.dragging) sim.release();
      sim.step(step);
    }
  }

  const sync = () => {
    card.position.copy(sim.x);
    card.quaternion.copy(sim.q);
    updateStrap();
  };

  // Draw only while something moves: a settled pass costs nothing.
  let quiet = 0;
  let lastW = 0;
  let lastH = 0;
  stage.onFrame((dt) => {
    if (still == null) sim.advance(dt);
    const resized = viewW !== lastW || viewH !== lastH;
    lastW = viewW;
    lastH = viewH;
    quiet = sim.dragging || sim.energy() > 1e-5 || resized ? 0 : quiet + 1;
    if (quiet > 3) return;
    sync();
    renderer.render(scene, camera);
  });
  sync();

  return {
    destroy() {
      stage.destroy();
      scene.traverse((o) => {
        o.geometry?.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m?.dispose();
      });
      [cardTex, peelTex, strapTex, strapNor, scene.environment].forEach((t) => t?.dispose());
      renderer.dispose();
    },
  };
}
