import * as THREE from "three";

export const FILL_Y = 0.535;
export const FILL_R = 0.452;
export const SEAT_Y = 0.034;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function glazeCanvas() {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#efe8dc";
  ctx.fillRect(0, 0, c.width, c.height);
  const rand = mulberry(812);
  for (let i = 0; i < 1500; i += 1) {
    const x = rand() * c.width;
    const y = rand() * c.height;
    const r = 0.4 + Math.pow(rand(), 4) * 1.6;
    ctx.fillStyle = `rgba(${90 + rand() * 40}, ${62 + rand() * 30}, ${40 + rand() * 20}, ${0.35 + rand() * 0.5})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.7 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, "rgba(255,250,240,0)");
  g.addColorStop(0.5, "rgba(230,220,200,0.08)");
  g.addColorStop(1, "rgba(255,250,240,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

function coffeeCanvas() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
  g.addColorStop(0, "#1c0e07");
  g.addColorStop(0.72, "#211008");
  g.addColorStop(0.88, "#3b1d0d");
  g.addColorStop(0.95, "#7a4a26");
  g.addColorStop(0.985, "#a8754a");
  g.addColorStop(1, "#5a3218");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  const rand = mulberry(77);
  for (let i = 0; i < 260; i += 1) {
    const a = rand() * Math.PI * 2;
    const r = 220 + rand() * 30;
    ctx.fillStyle = `rgba(190,140,90,${0.08 + rand() * 0.12})`;
    ctx.beginPath();
    ctx.arc(256 + Math.cos(a) * r, 256 + Math.sin(a) * r, 1 + rand() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

function smoothNoise(rand, cells) {
  const grid = Array.from({ length: cells * cells }, () => rand());
  const at = (x, y) => grid[(((y % cells) + cells) % cells) * cells + (((x % cells) + cells) % cells)];
  return (u, v) => {
    const x = u * cells;
    const y = v * cells;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

const PROFILE = (() => {
  const pts = [];
  const r = 1.8;
  const z0 = -1.2;
  pts.push([7, 0]);
  pts.push([2, 0]);
  pts.push([z0, 0]);
  for (let i = 1; i <= 24; i += 1) {
    const t = (i / 24) * (Math.PI / 2);
    pts.push([z0 - r * Math.sin(t), r - r * Math.cos(t)]);
  }
  pts.push([z0 - r, 4]);
  pts.push([z0 - r, 10]);
  let s = 0;
  return pts.map(([z, y], i) => {
    if (i) s += Math.hypot(z - pts[i - 1][0], y - pts[i - 1][1]);
    return { z, y, s };
  });
})();

const FLOOR_END = PROFILE.find((p) => p.z === -1.2).s;
const LENGTH = PROFILE[PROFILE.length - 1].s;

function sweepGeometry(width) {
  const positions = [];
  const uvs = [];
  const index = [];
  PROFILE.forEach(({ z, y, s }) => {
    positions.push(-width / 2, y, z, width / 2, y, z);
    uvs.push(0, s / LENGTH, 1, s / LENGTH);
  });
  for (let i = 0; i < PROFILE.length - 1; i += 1) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

function sweepCanvas(base, light) {
  const w = 512;
  const h = 1024;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, h);
  const rand = mulberry(9);
  const n1 = smoothNoise(rand, 20);
  const cupS = 7;
  for (let y = 0; y < h; y += 1) {
    const s = (1 - y / h) * LENGTH;
    const up = Math.min(1, Math.max(0, (s - FLOOR_END) / 6));
    const rise = 1 - 0.42 * up * up * (3 - 2 * up);
    const near = Math.min(1, Math.max(0, (cupS + 0.4 - s) / 1.8));
    const front = 1 - 0.42 * near * near * (3 - 2 * near);
    const top = Math.min(1, Math.max(0, (s - 9.5) / 1.6));
    const lift = top * top * (3 - 2 * top);
    for (let x = 0; x < w; x += 1) {
      const u = x / w;
      const wx = (u - 0.5) * 20;
      const side = 0.66 + 0.34 * Math.exp(-((wx / 3.2) ** 2));
      const pool = 0.16 * Math.exp(-((wx + 0.2) ** 2) / 3.2 - ((s - cupS) ** 2) / 2.4);
      const grain = (n1(u * 3, (s / LENGTH) * 6) - 0.5) * 0.02 + (rand() - 0.5) * 0.02;
      const k = rise * front * side * (1 + grain) + pool;
      const kl = (0.94 + 0.06 * side) * (1 + grain * 0.5);
      const o = (y * w + x) * 4;
      for (let j = 0; j < 3; j += 1) img.data[o + j] = base[j] * k * (1 - lift) + light[j] * kl * lift;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function texture(canvas, repeat = 1) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat !== 1) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
  }
  return t;
}

function room(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0.22, 0.2, 0.19);
  const plane = new THREE.PlaneGeometry(1, 1);
  const panels = [
    { c: [5.5, 5.2, 4.8], p: [-4.5, 2.6, -2.2], s: [3.2, 3.6, 1] },
    { c: [0.9, 0.85, 0.8], p: [0, 5, 0], s: [8, 8, 1], r: [Math.PI / 2, 0, 0] },
    { c: [0.55, 0.5, 0.46], p: [4.5, 1.5, 2], s: [5, 4, 1] },
    { c: [0.42, 0.36, 0.3], p: [0, -1, 0], s: [12, 12, 1], r: [-Math.PI / 2, 0, 0] },
  ];
  const mats = [];
  for (const { c, p, s, r } of panels) {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(...c), side: THREE.DoubleSide });
    mats.push(m);
    const mesh = new THREE.Mesh(plane, m);
    mesh.position.set(...p);
    mesh.scale.set(...s);
    if (r) mesh.rotation.set(...r);
    else mesh.lookAt(0, 0.5, 0);
    scene.add(mesh);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.03).texture;
  pmrem.dispose();
  plane.dispose();
  mats.forEach((m) => m.dispose());
  return env;
}

export function buildScene(renderer, { ground, light }) {
  const scene = new THREE.Scene();
  const disposables = [];
  const keep = (x) => {
    disposables.push(x);
    return x;
  };
  const env = keep(room(renderer));
  scene.environment = env;

  const glaze = keep(texture(glazeCanvas()));
  const ceramic = keep(
    new THREE.MeshPhysicalMaterial({
      map: glaze,
      roughness: 0.34,
      metalness: 0,
      clearcoat: 0.7,
      clearcoatRoughness: 0.16,
      envMapIntensity: 0.9,
    }),
  );

  const cupProfile = [
    [0.0, 0.016],
    [0.2, 0.004],
    [0.27, 0.0],
    [0.292, 0.012],
    [0.3, 0.032],
    [0.33, 0.052],
    [0.395, 0.12],
    [0.44, 0.24],
    [0.468, 0.38],
    [0.481, 0.5],
    [0.488, 0.598],
    [0.487, 0.611],
    [0.481, 0.618],
    [0.473, 0.614],
    [0.468, 0.6],
    [0.461, 0.5],
    [0.443, 0.36],
    [0.398, 0.23],
    [0.31, 0.13],
    [0.18, 0.098],
    [0.0, 0.092],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const cupGeo = keep(new THREE.LatheGeometry(cupProfile, 96));
  const cup = new THREE.Mesh(cupGeo, ceramic);
  cup.castShadow = true;
  cup.receiveShadow = true;

  const handleCurve = new THREE.CatmullRomCurve3(
    [
      [0.455, 0.5, 0],
      [0.56, 0.535, 0],
      [0.665, 0.47, 0],
      [0.675, 0.33, 0],
      [0.58, 0.215, 0],
      [0.43, 0.19, 0],
    ].map((p) => new THREE.Vector3(...p)),
  );
  const handleGeo = keep(new THREE.TubeGeometry(handleCurve, 64, 0.034, 20, false));
  handleGeo.scale(1, 1, 1.35);
  const handle = new THREE.Mesh(handleGeo, ceramic);
  handle.castShadow = true;
  handle.receiveShadow = true;

  const coffeeTex = keep(texture(coffeeCanvas()));
  const coffeeMat = keep(new THREE.MeshPhysicalMaterial({ map: coffeeTex, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.3 }));
  const coffeeGeo = keep(new THREE.CircleGeometry(FILL_R, 96));
  coffeeGeo.rotateX(-Math.PI / 2);
  const coffee = new THREE.Mesh(coffeeGeo, coffeeMat);
  coffee.position.y = FILL_Y;
  coffee.receiveShadow = true;

  const saucerProfile = [
    [0.0, 0.002],
    [0.28, 0.0],
    [0.3, 0.008],
    [0.33, 0.014],
    [0.5, 0.024],
    [0.64, 0.04],
    [0.73, 0.066],
    [0.765, 0.078],
    [0.768, 0.086],
    [0.758, 0.09],
    [0.72, 0.08],
    [0.62, 0.062],
    [0.48, 0.046],
    [0.37, 0.036],
    [0.33, 0.04],
    [0.3, 0.036],
    [0.0, 0.032],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const saucerGeo = keep(new THREE.LatheGeometry(saucerProfile, 96));
  const saucer = new THREE.Mesh(saucerGeo, ceramic);
  saucer.castShadow = true;
  saucer.receiveShadow = true;

  const set = new THREE.Group();
  const cupGroup = new THREE.Group();
  cupGroup.add(cup, handle, coffee);
  cupGroup.position.y = SEAT_Y;
  cupGroup.rotation.y = -0.62;
  set.add(saucer, cupGroup);
  scene.add(set);

  const groundTex = keep(texture(sweepCanvas(ground, light)));
  const groundMat = keep(new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.92, envMapIntensity: 0.25 }));
  const groundGeo = keep(sweepGeometry(20));
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  const sun = new THREE.DirectionalLight(0xfff1e0, 7.5);
  sun.position.set(-3.2, 3.4, -0.6);
  sun.target.position.set(0, 0.3, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -2.4;
  sc.right = 2.4;
  sc.top = 2.4;
  sc.bottom = -2.4;
  sc.near = 0.5;
  sc.far = 14;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.01;
  sun.shadow.radius = 6;
  scene.add(sun, sun.target);
  const sky = new THREE.HemisphereLight(0xf3eee8, 0xb9ab9c, 2.2);
  scene.add(sky);

  return {
    scene,
    coffeeCentre: () => new THREE.Vector3(0, FILL_Y + SEAT_Y, 0),
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
