import { drawBackdrop, drawGrooves, drawLabel } from "./jukeboxLabels";
import { SONGS } from "./jukeboxSongs";
import { SLOT_ANGLE, SLOTS } from "./jukeboxRig";

export const DIM = {
  record: 0.875,
  hole: 0.19,
  label: 0.45,
  half: 0.011,
  carousel: [0, -3.2],
  ring: 1.86,
  cradleY: 1.035,
  plate: 2.86,
  plateTop: 0.12,
  platter: [0, 0.9],
  platterTop: 0.4,
  platterR: 0.92,
  pivot: [1.65, 0.9],
  armLen: 1.45,
  shoulder: [-2.15, 0.62, 1.05],
  upper: 1.8,
  fore: 1.5,
  rod: 0.42,
};

function lathe(THREE, strips, segments) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let base = 0;
  for (const strip of strips) {
    const rows = strip.length;
    for (let s = 0; s <= segments; s += 1) {
      const a = (s / segments) * Math.PI * 2;
      const c = Math.cos(a);
      const n = Math.sin(a);
      for (const [r, y, nr, ny] of strip) {
        positions.push(r * c, y, -r * n);
        const len = Math.hypot(nr, ny) || 1;
        normals.push((nr / len) * c, ny / len, (-nr / len) * n);
        uvs.push(s / segments, Math.min(1, r / DIM.record));
      }
    }
    for (let s = 0; s < segments; s += 1) {
      for (let k = 0; k < rows - 1; k += 1) {
        const a0 = base + s * rows + k;
        const a1 = base + (s + 1) * rows + k;
        indices.push(a0, a0 + 1, a1, a1, a0 + 1, a1 + 1);
      }
    }
    base += rows * (segments + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeBoundingSphere();
  return g;
}

function vinylGeometry(THREE) {
  const { record: R, hole: H, half: T } = DIM;
  const top = [
    [H, T, 0, 1],
    [0.47, T, 0, 1],
    [0.8, T, 0, 1],
    [0.835, T, 0, 1],
  ];
  const bead = [
    [0.835, T, -0.3, 1],
    [0.85, T + 0.0028, 0, 1],
    [0.864, T + 0.0018, 0.6, 0.8],
    [0.873, T * 0.4, 0.95, 0.3],
    [R, 0, 1, 0],
    [0.873, -T * 0.4, 0.95, -0.3],
    [0.864, -T - 0.0018, 0.6, -0.8],
    [0.85, -T - 0.0028, 0, -1],
    [0.835, -T, -0.3, -1],
  ];
  const bottom = [
    [0.835, -T, 0, -1],
    [0.8, -T, 0, -1],
    [0.47, -T, 0, -1],
    [H, -T, 0, -1],
  ];
  const wall = [
    [H, -T, -1, 0],
    [H, T, -1, 0],
  ];
  return lathe(THREE, [top, bead, bottom, wall], 128);
}

function radialCanvas(size, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext("2d"), size);
  return canvas;
}

function matCanvas() {
  return radialCanvas(512, (ctx, size) => {
    const c = size / 2;
    ctx.fillStyle = "#1b1716";
    ctx.fillRect(0, 0, size, size);
    for (let r = c * 0.24; r < c * 0.98; r += c * 0.034) {
      ctx.strokeStyle = "rgba(255,240,220,0.06)";
      ctx.lineWidth = c * 0.012;
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = c * 0.016;
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * c * 0.3, c + Math.sin(a) * c * 0.3);
      ctx.lineTo(c + Math.cos(a) * c * 0.95, c + Math.sin(a) * c * 0.95);
      ctx.stroke();
    }
  });
}

function brushedCanvas(seed) {
  return radialCanvas(256, (ctx, size) => {
    const img = ctx.createImageData(size, size);
    let s = seed;
    for (let y = 0; y < size; y += 1) {
      s = (s * 16807) % 2147483647;
      const row = (s / 2147483647) * 40;
      for (let x = 0; x < size; x += 1) {
        s = (s * 16807) % 2147483647;
        const v = 120 + row + (s / 2147483647) * 30;
        const i = (y * size + x) * 4;
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

function environment(THREE, renderer) {
  const room = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(20, 12, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.035, 0.022, 0.018), side: THREE.BackSide }));
  room.add(box);
  const panel = (w, h, color, x, y, z, ry = 0, rx = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    room.add(m);
    return m;
  };
  panel(8, 3, new THREE.Color(3.2, 2.5, 1.8), 0, 5.8, 1, 0, Math.PI / 2);
  panel(2.2, 9, new THREE.Color(3.4, 0.9, 0.8), -9.8, 2, -2, Math.PI / 2);
  panel(2.2, 9, new THREE.Color(3.6, 1.9, 0.7), 9.8, 2, -2, -Math.PI / 2);
  for (let i = 0; i < 6; i += 1) panel(0.5, 8, new THREE.Color(2.2, 1.2, 0.5), -6 + i * 2.4, 2, -9.8);
  panel(10, 2, new THREE.Color(0.5, 0.42, 0.36), 0, 1.5, 9.8, Math.PI);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(room, 0.03);
  pmrem.dispose();
  room.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  return target;
}

export function buildScene(THREE, renderer) {
  const disposables = [];
  const track = (x) => {
    disposables.push(x);
    return x;
  };
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0.012, 0.007, 0.006);
  const envTarget = environment(THREE, renderer);
  disposables.push(envTarget);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.85;

  const hemi = new THREE.HemisphereLight(0xffe2c4, 0x1a0e0a, 0.35);
  scene.add(hemi);
  const key = new THREE.SpotLight(0xffd6a6, 140, 0, 0.62, 0.75, 2);
  key.position.set(0.8, 8.2, 3.2);
  key.target.position.set(0, 0.6, -0.9);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 3;
  key.shadow.camera.far = 16;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key, key.target);
  const rose = new THREE.PointLight(0xff4e5a, 16, 0, 2);
  rose.position.set(-4.4, 2.6, -4.2);
  const amber = new THREE.PointLight(0xffa144, 18, 0, 2);
  amber.position.set(4.4, 2.4, -3.8);
  const fill = new THREE.PointLight(0xffc690, 3.2, 0, 2);
  fill.position.set(-1.2, 2.4, 3.6);
  scene.add(rose, amber, fill);

  const chrome = track(new THREE.MeshStandardMaterial({ color: 0xe6ded2, metalness: 1, roughness: 0.16 }));
  const satin = track(new THREE.MeshStandardMaterial({ color: 0xb8aea2, metalness: 1, roughness: 0.34 }));
  const darkMetal = track(new THREE.MeshStandardMaterial({ color: 0x5a4d44, metalness: 0.85, roughness: 0.42 }));
  const bakelite = track(new THREE.MeshPhysicalMaterial({ color: 0x3a120c, roughness: 0.38, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.22 }));
  const ivory = track(new THREE.MeshPhysicalMaterial({ color: 0xe8dcc3, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.3 }));
  const rubber = track(new THREE.MeshStandardMaterial({ color: 0x141110, roughness: 0.9, metalness: 0 }));

  const brushTex = track(new THREE.CanvasTexture(brushedCanvas(5)));
  brushTex.wrapS = brushTex.wrapT = THREE.RepeatWrapping;
  brushTex.repeat.set(10, 1);
  const deckMat = track(new THREE.MeshStandardMaterial({ color: 0x3a2b24, metalness: 0.7, roughness: 0.55, roughnessMap: brushTex }));
  const deck = new THREE.Mesh(track(new THREE.PlaneGeometry(40, 40)), deckMat);
  deck.rotation.x = -Math.PI / 2;
  deck.receiveShadow = true;
  scene.add(deck);

  const backTex = track(new THREE.CanvasTexture(drawBackdrop()));
  backTex.colorSpace = THREE.SRGBColorSpace;
  const back = new THREE.Mesh(track(new THREE.PlaneGeometry(26, 10)), track(new THREE.MeshBasicMaterial({ map: backTex, color: new THREE.Color(2.4, 2.1, 1.9) })));
  back.position.set(0, 3.2, -10.5);
  scene.add(back);
  const tubeGeo = track(new THREE.CylinderGeometry(0.16, 0.16, 6, 24));
  for (const [x, color] of [
    [-4.6, new THREE.Color(3.0, 0.8, 0.65)],
    [4.6, new THREE.Color(3.2, 1.6, 0.55)],
    [-7.2, new THREE.Color(2.4, 1.2, 0.45)],
    [7.4, new THREE.Color(2.6, 0.7, 0.7)],
  ]) {
    const tube = new THREE.Mesh(tubeGeo, track(new THREE.MeshBasicMaterial({ color })));
    tube.position.set(x, 3, -6.4 - Math.abs(x) * 0.2);
    scene.add(tube);
  }

  const [cx, cz] = DIM.carousel;
  const carousel = new THREE.Group();
  carousel.position.set(cx, 0, cz);
  scene.add(carousel);
  const plateGeo = track(new THREE.CylinderGeometry(DIM.plate, DIM.plate, 0.08, 160));
  const plate = new THREE.Mesh(plateGeo, darkMetal);
  plate.position.y = DIM.plateTop - 0.04;
  plate.receiveShadow = true;
  plate.castShadow = true;
  carousel.add(plate);
  const rimGeo = track(new THREE.TorusGeometry(DIM.plate, 0.035, 12, 180));
  const rim = new THREE.Mesh(rimGeo, chrome);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = DIM.plateTop - 0.01;
  carousel.add(rim);
  const hubGeo = track(new THREE.CylinderGeometry(0.72, 0.86, 0.9, 64));
  const hub = new THREE.Mesh(hubGeo, bakelite);
  hub.position.y = DIM.plateTop + 0.45;
  hub.castShadow = true;
  carousel.add(hub);
  const capGeo = track(new THREE.CylinderGeometry(0.5, 0.74, 0.12, 64));
  const cap = new THREE.Mesh(capGeo, chrome);
  cap.position.y = DIM.plateTop + 0.96;
  carousel.add(cap);
  const knobGeo = track(new THREE.SphereGeometry(0.16, 32, 16));
  const knob = new THREE.Mesh(knobGeo, chrome);
  knob.position.y = DIM.plateTop + 1.04;
  carousel.add(knob);

  const postGeo = track(new THREE.CylinderGeometry(0.022, 0.022, 0.62, 12));
  const ballGeo = track(new THREE.SphereGeometry(0.04, 16, 10));
  const saddleGeo = track(new THREE.BoxGeometry(1.5, 0.05, 0.09));
  const toothGeo = track(new THREE.BoxGeometry(0.14, 0.09, 0.06));
  const posts = new THREE.InstancedMesh(postGeo, chrome, SLOTS * 4);
  const balls = new THREE.InstancedMesh(ballGeo, chrome, SLOTS * 4);
  const saddles = new THREE.InstancedMesh(saddleGeo, satin, SLOTS);
  const teeth = new THREE.InstancedMesh(toothGeo, satin, SLOTS);
  posts.castShadow = true;
  saddles.castShadow = true;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < SLOTS; i += 1) {
    const a = i * SLOT_ANGLE;
    const rx = Math.sin(a);
    const rz = Math.cos(a);
    const tx = Math.cos(a);
    const tz = -Math.sin(a);
    let k = 0;
    for (const radial of [DIM.ring - 0.62, DIM.ring + 0.62]) {
      for (const side of [-1, 1]) {
        v.set(rx * radial + tx * side * 0.045, DIM.plateTop + 0.31, rz * radial + tz * side * 0.045);
        m4.compose(v, q.identity(), one);
        posts.setMatrixAt(i * 4 + k, m4);
        v.y = DIM.plateTop + 0.62;
        m4.compose(v, q, one);
        balls.setMatrixAt(i * 4 + k, m4);
        k += 1;
      }
    }
    q.setFromAxisAngle(up, a - Math.PI / 2);
    v.set(rx * DIM.ring, DIM.plateTop + 0.025, rz * DIM.ring);
    m4.compose(v, q, one);
    saddles.setMatrixAt(i, m4);
    const ta = a + SLOT_ANGLE / 2;
    q.setFromAxisAngle(up, ta);
    v.set(Math.sin(ta) * (DIM.plate + 0.05), DIM.plateTop - 0.04, Math.cos(ta) * (DIM.plate + 0.05));
    m4.compose(v, q, one);
    teeth.setMatrixAt(i, m4);
  }
  carousel.add(posts, balls, saddles, teeth);

  const pawl = new THREE.Group();
  const pawlAngle = -0.62;
  pawl.position.set(cx + Math.sin(pawlAngle) * (DIM.plate + 0.3), 0, cz + Math.cos(pawlAngle) * (DIM.plate + 0.3));
  pawl.rotation.y = pawlAngle;
  scene.add(pawl);
  const pawlPost = new THREE.Mesh(track(new THREE.CylinderGeometry(0.07, 0.09, 0.2, 24)), darkMetal);
  pawlPost.position.set(0.32, 0.1, 0);
  pawl.add(pawlPost);
  const pawlArm = new THREE.Group();
  pawlArm.position.set(0.32, 0.12, 0);
  pawl.add(pawlArm);
  const lever = new THREE.Mesh(track(new THREE.BoxGeometry(0.72, 0.035, 0.06)), chrome);
  lever.rotation.y = -0.28;
  lever.position.set(-0.34, 0, -0.1);
  pawlArm.add(lever);
  const roller = new THREE.Mesh(track(new THREE.CylinderGeometry(0.06, 0.06, 0.07, 24)), chrome);
  roller.position.set(-0.68, -0.02, -0.2);
  pawlArm.add(roller);

  const [px, pz] = DIM.platter;
  const platter = new THREE.Group();
  platter.position.set(px, 0, pz);
  scene.add(platter);
  const bearing = new THREE.Mesh(track(new THREE.CylinderGeometry(0.34, 0.42, 0.33, 48)), bakelite);
  bearing.position.y = 0.165;
  bearing.castShadow = true;
  platter.add(bearing);
  const spinner = new THREE.Group();
  platter.add(spinner);
  const body = new THREE.Mesh(track(new THREE.CylinderGeometry(DIM.platterR, DIM.platterR - 0.02, 0.064, 128)), chrome);
  body.position.y = DIM.platterTop - 0.035;
  body.castShadow = true;
  body.receiveShadow = true;
  spinner.add(body);
  const matTex = track(new THREE.CanvasTexture(matCanvas()));
  matTex.colorSpace = THREE.SRGBColorSpace;
  matTex.anisotropy = anisotropy;
  const matMat = track(new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.82, metalness: 0 }));
  const mat = new THREE.Mesh(track(new THREE.CylinderGeometry(DIM.platterR - 0.04, DIM.platterR - 0.04, 0.006, 128)), [rubber, matMat, rubber]);
  mat.position.y = DIM.platterTop - 0.003;
  mat.receiveShadow = true;
  spinner.add(mat);
  const puck = new THREE.Mesh(track(new THREE.CylinderGeometry(0.176, 0.184, 0.05, 48)), chrome);
  puck.position.y = DIM.platterTop + 0.025;
  puck.castShadow = true;
  spinner.add(puck);
  const dome = new THREE.Mesh(track(new THREE.SphereGeometry(0.176, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2)), chrome);
  dome.scale.y = 0.28;
  dome.position.y = DIM.platterTop + 0.05;
  spinner.add(dome);
  const notch = new THREE.Mesh(track(new THREE.BoxGeometry(0.03, 0.012, 0.12)), bakelite);
  notch.position.set(0, DIM.platterTop + 0.098, 0.06);
  spinner.add(notch);

  const [ax, az] = DIM.pivot;
  const armBase = new THREE.Group();
  armBase.position.set(ax, 0, az);
  scene.add(armBase);
  const pillar = new THREE.Mesh(track(new THREE.CylinderGeometry(0.15, 0.2, 0.42, 48)), bakelite);
  pillar.position.y = 0.21;
  pillar.castShadow = true;
  armBase.add(pillar);
  const collar = new THREE.Mesh(track(new THREE.CylinderGeometry(0.12, 0.15, 0.08, 48)), chrome);
  collar.position.y = 0.46;
  armBase.add(collar);
  const armYawGroup = new THREE.Group();
  armYawGroup.position.y = 0.532;
  armBase.add(armYawGroup);
  const gimbal = new THREE.Mesh(track(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 32)), chrome);
  armYawGroup.add(gimbal);
  const armPitch = new THREE.Group();
  armYawGroup.add(armPitch);
  const tube = new THREE.Mesh(track(new THREE.CylinderGeometry(0.032, 0.032, 1.62, 24)), chrome);
  tube.rotation.z = Math.PI / 2;
  tube.position.x = 0.5;
  tube.castShadow = true;
  armPitch.add(tube);
  const weight = new THREE.Mesh(track(new THREE.CylinderGeometry(0.085, 0.085, 0.2, 32)), satin);
  weight.rotation.z = Math.PI / 2;
  weight.position.x = -0.36;
  weight.castShadow = true;
  armPitch.add(weight);
  const head = new THREE.Mesh(track(new THREE.BoxGeometry(0.26, 0.06, 0.12)), bakelite);
  head.position.set(DIM.armLen - 0.04, -0.012, 0);
  head.castShadow = true;
  armPitch.add(head);
  const lip = new THREE.Mesh(track(new THREE.BoxGeometry(0.12, 0.012, 0.03)), chrome);
  lip.position.set(DIM.armLen + 0.13, 0.0, 0.03);
  lip.rotation.y = -0.3;
  armPitch.add(lip);
  const cart = new THREE.Mesh(track(new THREE.BoxGeometry(0.1, 0.05, 0.08)), ivory);
  cart.position.set(DIM.armLen, -0.06, 0);
  armPitch.add(cart);
  const stylus = new THREE.Mesh(track(new THREE.ConeGeometry(0.008, 0.03, 8)), satin);
  stylus.rotation.x = Math.PI;
  stylus.position.set(DIM.armLen, -0.094, 0);
  armPitch.add(stylus);
  const rest = new THREE.Group();
  rest.position.set(ax, 0, az - DIM.armLen);
  scene.add(rest);
  const restPost = new THREE.Mesh(track(new THREE.CylinderGeometry(0.03, 0.04, 0.44, 16)), chrome);
  restPost.position.y = 0.22;
  rest.add(restPost);
  const restCup = new THREE.Mesh(track(new THREE.BoxGeometry(0.12, 0.04, 0.12)), rubber);
  restCup.position.y = 0.44;
  rest.add(restCup);

  const [sx, sy, sz] = DIM.shoulder;
  const gripBase = new THREE.Group();
  gripBase.position.set(sx, 0, sz);
  scene.add(gripBase);
  const gPillar = new THREE.Mesh(track(new THREE.CylinderGeometry(0.16, 0.24, sy, 48)), bakelite);
  gPillar.position.y = sy / 2;
  gPillar.castShadow = true;
  gripBase.add(gPillar);
  const jointGeo = track(new THREE.SphereGeometry(0.1, 32, 16));
  const boneGeo = track(new THREE.CylinderGeometry(0.045, 0.06, 1, 24));
  boneGeo.translate(0, 0.5, 0);
  const rodGeo = track(new THREE.CylinderGeometry(0.03, 0.03, 1, 16));
  rodGeo.translate(0, 0.5, 0);
  const shoulderJoint = new THREE.Mesh(jointGeo, chrome);
  shoulderJoint.scale.setScalar(1.3);
  const elbowJoint = new THREE.Mesh(jointGeo, chrome);
  const wristJoint = new THREE.Mesh(jointGeo, bakelite);
  wristJoint.scale.setScalar(0.85);
  const upperBone = new THREE.Mesh(boneGeo, chrome);
  const foreBone = new THREE.Mesh(boneGeo, chrome);
  const rod = new THREE.Mesh(rodGeo, satin);
  for (const m of [shoulderJoint, elbowJoint, wristJoint, upperBone, foreBone, rod]) {
    m.castShadow = true;
    scene.add(m);
  }
  const jawGeo = track(new THREE.BoxGeometry(0.16, 0.012, 0.11));
  const jawA = new THREE.Mesh(jawGeo, chrome);
  const jawB = new THREE.Mesh(jawGeo, chrome);
  const jawBlock = new THREE.Mesh(track(new THREE.BoxGeometry(0.12, 0.12, 0.13)), bakelite);
  for (const m of [jawA, jawB, jawBlock]) {
    m.castShadow = true;
    scene.add(m);
  }

  const vinylGeo = track(vinylGeometry(THREE));
  const grooveTex = track(new THREE.CanvasTexture(drawGrooves()));
  grooveTex.colorSpace = THREE.NoColorSpace;
  grooveTex.minFilter = THREE.LinearFilter;
  grooveTex.generateMipmaps = false;
  const vinyl = track(
    new THREE.MeshPhysicalMaterial({
      color: 0x0c0a0a,
      roughness: 1,
      roughnessMap: grooveTex,
      metalness: 0,
      anisotropy: 0.92,
      anisotropyRotation: 0,
      clearcoat: 0.35,
      clearcoatRoughness: 0.3,
      specularIntensity: 1,
      envMapIntensity: 1.2,
    }),
  );
  const labelTopGeo = track(new THREE.RingGeometry(DIM.hole, DIM.label, 96, 1));
  labelTopGeo.rotateX(-Math.PI / 2);
  labelTopGeo.translate(0, DIM.half + 0.0007, 0);
  const labelBottomGeo = track(new THREE.RingGeometry(DIM.hole, DIM.label, 96, 1));
  labelBottomGeo.rotateX(Math.PI / 2);
  labelBottomGeo.translate(0, -DIM.half - 0.0007, 0);
  const proxyGeo = track(new THREE.BoxGeometry(1.75, 0.12, 1.75));
  const proxyMat = track(new THREE.MeshBasicMaterial({ visible: false }));

  const records = SONGS.map((song) => {
    const tex = track(new THREE.CanvasTexture(drawLabel(song, 384)));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    const labelMat = track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const group = new THREE.Group();
    const spin = new THREE.Group();
    group.add(spin);
    const disc = new THREE.Mesh(vinylGeo, vinyl);
    disc.castShadow = true;
    disc.receiveShadow = true;
    const top = new THREE.Mesh(labelTopGeo, labelMat);
    const bottom = new THREE.Mesh(labelBottomGeo, labelMat);
    top.receiveShadow = true;
    bottom.receiveShadow = true;
    spin.add(disc, top, bottom);
    const proxy = new THREE.Mesh(proxyGeo, proxyMat);
    proxy.userData.index = song.index;
    group.add(proxy);
    scene.add(group);
    return { song, group, spin, proxy };
  });

  return {
    scene,
    carousel,
    platterSpinner: spinner,
    pawlArm,
    armYawGroup,
    armPitch,
    grip: { shoulderJoint, elbowJoint, wristJoint, upperBone, foreBone, rod, jawA, jawB, jawBlock },
    records,
    key,
    dispose() {
      for (const d of disposables) d.dispose?.();
    },
  };
}
