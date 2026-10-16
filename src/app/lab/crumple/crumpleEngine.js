import { MAX_CREASES, SHEET_H, SHEET_W, addCreases, makeCreases, packCreases, rng } from "./crumpleCreases";
import { FELT, backCanvas, blobCanvas, feltCanvas, loadImage, printCanvas, surfaceCanvas } from "./crumplePrint";
import { BALL_R, buildSheet, deformSheet } from "./crumpleSheet";
import { bakeFragment, bakeVertex } from "./crumpleShader";

export const PRINTS = [
  { src: "/cast/john.webp", name: "John", no: "no. 01" },
  { src: "/cast/paul.webp", name: "Paul", no: "no. 02" },
  { src: "/cast/george.webp", name: "George", no: "no. 03" },
  { src: "/cast/john.webp", name: "John", no: "no. 04" },
  { src: "/cast/paul.webp", name: "Paul", no: "no. 05" },
  { src: "/cast/george.webp", name: "George", no: "no. 06" },
];

const R = BALL_R * 1.1;
const GRAVITY = 22;
const STEP = 1 / 120;
const ROLL_DECAY = 3.2;
const AIR_DECAY = 0.25;
const REST = 0.16;
const WALL_REST = 0.32;
const MAX_SPEED = 8.5;
const HOLD_LIFT = 0.15;
const T_OPEN = 0.045;
const LIFT = 0.62;
const FOV = 30;
const TILT = 0.24;
const TAP_PX = 6;

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smoother = (x) => x * x * x * (x * (x * 6 - 15) + 10);
const outCubic = (x) => 1 - Math.pow(1 - x, 3);
const inOutQuad = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

export async function createCrumple({ host, root, embedded, reduced, onOpen, inspect }) {
  const THREE = await import("three");
  const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
  const images = await Promise.all([...new Set(PRINTS.map((p) => p.src))].map((src) => loadImage(src).then((img) => [src, img])));
  const imageBySrc = new Map(images);

  const renderer = new THREE.WebGLRenderer({ antialias: (window.devicePixelRatio || 1) < 2, powerPreference: "high-performance" });
  renderer.setClearColor(FELT);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const canvas = renderer.domElement;
  canvas.className = "crumple__canvas";
  host.appendChild(canvas);
  const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envTarget = pmrem.fromScene(room, 0.04);
  room.dispose?.();
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.06;

  const hemi = new THREE.HemisphereLight(0xfff8ee, 0x8f877b, 0.55);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff0dc, 3.3);
  key.position.set(-2.9, 3.1, -1.6);
  key.castShadow = true;
  key.shadow.mapSize.set(512, 512);
  key.shadow.camera.left = -3.4;
  key.shadow.camera.right = 3.4;
  key.shadow.camera.top = 3.4;
  key.shadow.camera.bottom = -3.4;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 14;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.012;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 10;
  scene.add(key);
  scene.add(key.target);
  const lamp = new THREE.PointLight(0xfff3e4, 1.6, 0, 2);
  scene.add(lamp);

  const feltTex = new THREE.CanvasTexture(feltCanvas(512, 11));
  feltTex.colorSpace = THREE.SRGBColorSpace;
  feltTex.wrapS = feltTex.wrapT = THREE.RepeatWrapping;
  feltTex.repeat.set(40 / 0.9, 40 / 0.9);
  feltTex.anisotropy = anisotropy;
  const table = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshLambertMaterial({ map: feltTex }));
  table.rotation.x = -Math.PI / 2;
  table.receiveShadow = true;
  scene.add(table);

  const blobTex = new THREE.CanvasTexture(blobCanvas(128));
  blobTex.colorSpace = THREE.SRGBColorSpace;
  const blobGeo = new THREE.PlaneGeometry(1, 1);
  blobGeo.rotateX(-Math.PI / 2);

  const backTex = new THREE.CanvasTexture(backCanvas(512, root));
  backTex.colorSpace = THREE.SRGBColorSpace;
  backTex.wrapS = THREE.RepeatWrapping;
  backTex.repeat.x = -1;
  backTex.offset.x = 1;
  backTex.anisotropy = anisotropy;

  const bakeWidth = Math.min(1024, Math.max(640, Math.round(Math.min(host.clientWidth, host.clientHeight) * Math.min(2, window.devicePixelRatio || 1) * 0.9)));
  const bakeHeight = Math.round((bakeWidth * SHEET_H) / SHEET_W);
  const printTexBySrc = new Map();
  for (const p of PRINTS) {
    const key2 = `${p.src}|${p.no}`;
    const tex = new THREE.CanvasTexture(printCanvas(imageBySrc.get(p.src), p.name, p.no, bakeWidth, root));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    printTexBySrc.set(key2, tex);
  }

  const creaseA = Array.from({ length: MAX_CREASES }, () => new THREE.Vector4());
  const creaseB = Array.from({ length: MAX_CREASES }, () => new THREE.Vector4());
  const bakeMaterial = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: bakeVertex,
    fragmentShader: bakeFragment,
    uniforms: {
      print: { value: null },
      creaseA: { value: creaseA },
      creaseB: { value: creaseB },
      creaseCount: { value: 0 },
      sheet: { value: new THREE.Vector2(SHEET_W, SHEET_H) },
      texel: { value: new THREE.Vector2(1 / bakeWidth, 1 / bakeHeight) },
      mode: { value: 0 },
      relief: { value: 0.12 },
      seed: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
  });
  const bakeScene = new THREE.Scene();
  const bakeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bakeMaterial);
  bakeQuad.frustumCulled = false;
  bakeScene.add(bakeQuad);
  const bakeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const makeTarget = (srgb) => {
    const rt = new THREE.WebGLRenderTarget(bakeWidth, bakeHeight, {
      type: THREE.UnsignedByteType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    rt.texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    rt.texture.anisotropy = anisotropy;
    return rt;
  };

  function bake(sheet) {
    packCreases(sheet.creases, creaseA, creaseB);
    const u = bakeMaterial.uniforms;
    u.print.value = sheet.printTex;
    u.creaseCount.value = sheet.creases.length;
    u.seed.value = sheet.index * 17.3;
    const prev = renderer.getRenderTarget();
    const prevTone = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    u.mode.value = 0;
    renderer.setRenderTarget(sheet.colorRT);
    renderer.render(bakeScene, bakeCamera);
    u.mode.value = 1;
    renderer.setRenderTarget(sheet.normalRT);
    renderer.render(bakeScene, bakeCamera);
    renderer.setRenderTarget(prev);
    renderer.toneMapping = prevTone;
  }

  const facetChunk = THREE.ShaderChunk.normal_fragment_begin.replace(
    "vec3 normal = normalize( vNormal );",
    "vec3 normal = normalize( vNormal ); vec3 facetN = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) ); normal = normalize( mix( normal, facetN, uFacet ) );",
  );
  const withFacets = (material, facet) => {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uFacet = facet;
      shader.fragmentShader = "uniform float uFacet;\n" + shader.fragmentShader.replace("#include <normal_fragment_begin>", facetChunk);
    };
    material.customProgramCacheKey = () => "crumple-facet";
    return material;
  };

  const surfaceTex = new THREE.CanvasTexture(surfaceCanvas(256));
  surfaceTex.colorSpace = THREE.NoColorSpace;
  const segments = [88, 102];
  const sheets = [];
  for (const [index, p] of PRINTS.entries()) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const seed = 101 + index * 31;
    const creases = makeCreases(seed);
    const data = buildSheet(THREE, creases, seed, segments);
    const colorRT = makeTarget(true);
    const normalRT = makeTarget(false);
    const facet = { value: 0 };
    const front = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      map: colorRT.texture,
      normalMap: normalRT.texture,
      roughness: 0.9,
      roughnessMap: surfaceTex,
      metalness: 0,
      clearcoat: 0.4,
      clearcoatMap: surfaceTex,
      clearcoatRoughness: 0.3,
      clearcoatNormalMap: normalRT.texture,
      specularIntensity: 0.35,
      envMap: envTarget.texture,
      envMapIntensity: 0.07,
      side: THREE.FrontSide,
    });
    withFacets(front, facet);
    const back = withFacets(new THREE.MeshLambertMaterial({ vertexColors: true, map: backTex, normalMap: normalRT.texture, side: THREE.BackSide }), facet);
    const group = new THREE.Group();
    const frontMesh = new THREE.Mesh(data.geometry, front);
    const backMesh = new THREE.Mesh(data.geometry, back);
    for (const m of [frontMesh, backMesh]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.sheet = index;
      group.add(m);
    }
    scene.add(group);
    const blob = new THREE.Mesh(blobGeo, new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, toneMapped: false }));
    blob.renderOrder = 1;
    scene.add(blob);
    const sheet = {
      index,
      print: p,
      seed,
      creases,
      crushes: 0,
      printTex: printTexBySrc.get(`${p.src}|${p.no}`),
      colorRT,
      normalRT,
      front,
      back,
      facet,
      data,
      group,
      meshes: [frontMesh, backMesh],
      blob,
      ballScale: 1,
      mode: "ball",
      t: 1,
      shownT: -1,
      anim: null,
      pos: new THREE.Vector3(),
      prev: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      w: new THREE.Vector3(),
      held: false,
      still: 0,
      asleep: false,
      grounded: false,
    };
    bake(sheet);
    deformSheet(data, 1);
    sheet.shownT = 1;
    const arr = data.geometry.attributes.position.array;
    let mean = 0;
    for (let i = 0; i < arr.length; i += 3) mean += Math.hypot(arr[i], arr[i + 1], arr[i + 2]);
    mean /= arr.length / 3;
    sheet.ballScale = (BALL_R * 0.92) / mean;
    applyFinish(sheet);
    sheets.push(sheet);
  }

  const up = new THREE.Vector3(0, 1, 0);
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const holdPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(R + HOLD_LIFT));
  const lampPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -LIFT);
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const spinTarget = new THREE.Vector3();
  const identityQ = new THREE.Quaternion();
  const spinQ = new THREE.Quaternion();
  const present = { pos: new THREE.Vector3(), q: new THREE.Quaternion() };
  const bounds = { minX: -1, maxX: 1, minZ: -1, maxZ: 1, hx: 1, hz: 1, footX: 0.5, footZ: 0.5 };
  const lampDefault = new THREE.Vector3();
  const lampTarget = new THREE.Vector3();
  const pointer = { id: -1, x: 0, y: 0, sx: 0, sy: 0, inside: false, down: false, sheet: -1, grabbed: false, onPrint: false, time: 0, target: new THREE.Vector3(), cursor: "" };
  let width = 1;
  let height = 1;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let active = false;
  let destroyed = false;
  let openIndex = -1;
  let slots = [];
  let intro = reduced ? null : { time: 0, opened: false };
  let tossSeed = 7;

  function blocked(x, z) {
    const c = tmp.set(x, R, z).project(camera);
    const e = tmp2.set(x + R * 1.15, R, z).project(camera);
    const px = ((c.x + 1) / 2) * width;
    const py = ((1 - c.y) / 2) * height;
    const pr = Math.abs(e.x - c.x) * 0.5 * width + 8;
    const rects = embedded
      ? []
      : [
          [0, 0, width, 64],
          [0, 0, Math.min(width, 360), 152],
          [width - 300, height - 64, width, height],
          [0, height - 80, 80, height],
        ];
    for (const [x0, y0, x1, y1] of rects) {
      const nx = Math.max(x0, Math.min(px, x1));
      const ny = Math.max(y0, Math.min(py, y1));
      if (Math.hypot(px - nx, py - ny) < pr) return true;
    }
    return false;
  }

  function computeSlots(count) {
    const out = [];
    const cands = [];
    const nx = 17;
    const nz = 17;
    for (let i = 0; i < nx; i += 1) {
      for (let j = 0; j < nz; j += 1) {
        const x = bounds.minX + ((bounds.maxX - bounds.minX) * (i + 0.5)) / nx;
        const z = bounds.minZ + ((bounds.maxZ - bounds.minZ) * (j + 0.5)) / nz;
        const ox = Math.max(0, Math.abs(x) - bounds.footX);
        const oz = Math.max(0, Math.abs(z) - bounds.footZ);
        const out2 = Math.hypot(ox, oz);
        if (!blocked(x, z)) cands.push({ x, z, clear: out2 });
      }
    }
    const anyClear = cands.some((c) => c.clear > R * 0.6);
    const pool = anyClear ? cands.filter((c) => c.clear > R * 0.6) : cands;
    const jitter = rng(5);
    for (let k = 0; k < count; k += 1) {
      let best = null;
      let bestScore = -Infinity;
      const free = pool.filter((c) => out.every((o) => Math.hypot(o.x - c.x, o.z - c.z) > R * 2.1));
      for (const c of free.length ? free : pool) {
        let d = Infinity;
        for (const o of out) d = Math.min(d, Math.hypot(o.x - c.x, o.z - c.z));
        const edge = Math.min(c.x - bounds.minX, bounds.maxX - c.x, c.z - bounds.minZ, bounds.maxZ - c.z);
        const score = Math.min(d, 6) + Math.min(edge, 0.3) * 0.5 - Math.abs(c.clear - R * 1.6) * 0.12 + jitter() * 0.04;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      out.push({ x: best.x, z: best.z });
    }
    return out;
  }

  function layout() {
    width = Math.max(1, host.clientWidth);
    height = Math.max(1, host.clientHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    const aspect = width / height;
    camera.aspect = aspect;
    const tanH = Math.tan(((FOV / 2) * Math.PI) / 180);
    const fracH = embedded ? 0.66 : 0.6;
    const fracW = width < 600 ? 0.7 : 0.8;
    const dist = Math.max(SHEET_H / (fracH * 2 * tanH), SHEET_W / (fracW * 2 * tanH * aspect));
    const D = dist + LIFT;
    camera.position.set(0, D * Math.cos(TILT), D * Math.sin(TILT));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    tmp.copy(camera.position).normalize();
    present.pos.copy(tmp).multiplyScalar(LIFT / tmp.y);
    const zAxis = tmp2.copy(camera.position).sub(present.pos).normalize();
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const xAxis = new THREE.Vector3().crossVectors(camUp, zAxis).normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
    const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
    present.q.setFromRotationMatrix(m);
    present.q.multiply(tmpQ.setFromEuler(new THREE.Euler(-0.05, 0.035, 0.028)));
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const corners = [
      [-1, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
    ].map(([x, y]) => {
      raycaster.setFromCamera(ndc.set(x, y), camera);
      const hit = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, hit);
      return hit;
    });
    const hx = Math.min(...corners.map((c) => Math.abs(c.x)));
    const zTop = Math.max(corners[0].z, corners[1].z);
    const zBottom = Math.min(corners[2].z, corners[3].z);
    const pad = R * 1.7;
    const ballPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -R);
    const zAt = (py) => {
      raycaster.setFromCamera(ndc.set(0, 1 - (2 * py) / height), camera);
      const hit = new THREE.Vector3();
      raycaster.ray.intersectPlane(ballPlane, hit);
      return hit.z;
    };
    bounds.minX = -hx + pad;
    bounds.maxX = hx - pad;
    bounds.minZ = embedded ? zTop + pad : zAt(152) + R * 1.2;
    bounds.maxZ = embedded ? zBottom - pad : zAt(height - 64) - R * 1.2;
    const scale = D / dist;
    bounds.footX = (SHEET_W / 2) * scale + present.pos.x;
    bounds.footZ = (SHEET_H / 2) * scale;
    lampDefault.set(present.pos.x - 0.42, LIFT + 0.62, present.pos.z - 0.46);
    slots = computeSlots(PRINTS.length - 1);
    for (const s of sheets) {
      if (s.mode === "open") {
        s.group.position.copy(present.pos);
        s.group.quaternion.copy(present.q);
      }
      if (s.mode === "ball") {
        s.pos.x = Math.min(bounds.maxX, Math.max(bounds.minX, s.pos.x));
        s.pos.z = Math.min(bounds.maxZ, Math.max(bounds.minZ, s.pos.z));
        s.prev.x = s.pos.x;
        s.prev.z = s.pos.z;
      }
    }
  }

  function placeInitial() {
    sheets.forEach((s, i) => {
      const slot = i === 0 ? { x: present.pos.x, z: present.pos.z } : slots[i - 1];
      const drop = intro ? 1.3 + ((i * 3) % 6) * 0.26 : 0;
      s.pos.set(slot.x, R + drop, slot.z);
      s.prev.copy(s.pos);
      s.q.setFromEuler(new THREE.Euler(i * 1.7, i * 2.3, i * 0.9));
      s.w.set(0, 0, 0);
      s.asleep = !intro;
      s.group.position.copy(s.pos);
      s.group.quaternion.copy(s.q);
    });
    if (!intro) {
      const s = sheets[0];
      s.mode = "open";
      s.t = T_OPEN;
      s.group.position.copy(present.pos);
      s.group.quaternion.copy(present.q);
      openIndex = 0;
      onOpen?.(0);
    }
  }

  function setOpen(i) {
    if (openIndex === i) return;
    openIndex = i;
    onOpen?.(i);
  }

  function beginOpen(s, delay = 0) {
    s.held = false;
    s.anim = {
      kind: "open",
      k: -delay,
      dur: reduced ? 0.42 : 1.15,
      from: s.group.position.clone(),
      fromQ: s.group.quaternion.clone(),
      fromT: s.t,
      vacated: s.mode === "ball" ? new THREE.Vector3(s.pos.x, R, s.pos.z) : null,
    };
    s.mode = "opening";
    setOpen(s.index);
  }

  function freeSpot(except) {
    let best = slots[0];
    let bestD = -1;
    for (const slot of slots) {
      let d = Infinity;
      for (const o of sheets) {
        if (o === except || (o.mode !== "ball" && o.mode !== "closing")) continue;
        const px = o.mode === "ball" ? o.pos.x : o.anim?.toss?.x ?? o.group.position.x;
        const pz = o.mode === "ball" ? o.pos.z : o.anim?.toss?.z ?? o.group.position.z;
        d = Math.min(d, Math.hypot(px - slot.x, pz - slot.z));
      }
      if (d > bestD) {
        bestD = d;
        best = slot;
      }
    }
    return new THREE.Vector3(best.x, R, best.z);
  }

  function beginClose(s, toss) {
    const rand = rng((tossSeed += 13));
    const axis = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    s.anim = {
      kind: "close",
      k: 0,
      dur: reduced ? 0.36 : 0.72,
      from: s.group.position.clone(),
      fromQ: s.group.quaternion.clone(),
      spin: new THREE.Quaternion().setFromAxisAngle(axis, 0.9 + rand() * 0.8),
      fromT: s.t,
      toss: toss ?? freeSpot(s),
      rebaked: s.t > 0.55,
    };
    s.mode = "closing";
    if (openIndex === s.index) setOpen(-1);
  }

  function release(s) {
    const a = s.anim;
    s.anim = null;
    s.mode = "ball";
    s.t = 1;
    s.pos.copy(s.group.position);
    s.q.copy(s.group.quaternion);
    const T = 0.42;
    const dx = a.toss.x - s.pos.x;
    const dz = a.toss.z - s.pos.z;
    const k = T + 0.7 / ROLL_DECAY;
    const vx = dx / k;
    const vz = dz / k;
    const vy = (R - s.pos.y) / T + 0.5 * GRAVITY * T;
    s.prev.set(s.pos.x - vx * STEP, s.pos.y - vy * STEP, s.pos.z - vz * STEP);
    tmp.set(vx, 0, vz);
    s.w.crossVectors(up, tmp).multiplyScalar(1 / R);
    s.w.x += 3;
    s.asleep = false;
    s.still = 0;
  }

  function wakeAll() {
    for (const s of sheets) if (s.mode === "ball") s.asleep = false;
  }

  function physics(dt) {
    let awake = false;
    const bodies = sheets.filter((s) => s.mode === "ball");
    for (const s of bodies) {
      if (s.asleep && !s.held) continue;
      const vx = s.pos.x - s.prev.x;
      const vy = s.pos.y - s.prev.y;
      const vz = s.pos.z - s.prev.z;
      s.prev.copy(s.pos);
      if (s.held) {
        const f = 1 - Math.exp(-dt * 26);
        let mx = (pointer.target.x - s.pos.x) * f;
        let my = (pointer.target.y - s.pos.y) * f;
        let mz = (pointer.target.z - s.pos.z) * f;
        const m = Math.hypot(mx, my, mz);
        const cap = MAX_SPEED * dt;
        if (m > cap) {
          mx *= cap / m;
          my *= cap / m;
          mz *= cap / m;
        }
        s.pos.x += mx;
        s.pos.y += my;
        s.pos.z += mz;
      } else {
        const decay = Math.exp(-dt * (s.grounded ? ROLL_DECAY : AIR_DECAY));
        let hx = vx * decay;
        let hz = vz * decay;
        let yv = vy - GRAVITY * dt * dt;
        const sp = Math.hypot(hx, yv, hz) / dt;
        if (sp > MAX_SPEED) {
          const c = MAX_SPEED / sp;
          hx *= c;
          hz *= c;
          yv *= c;
        }
        s.pos.x += hx;
        s.pos.y += yv;
        s.pos.z += hz;
      }
      if (s.pos.y < R) {
        const vin = s.pos.y - s.prev.y;
        s.pos.y = R;
        const thud = vin < -0.004 ? 0.78 : 1;
        s.prev.y = R + vin * REST;
        s.prev.x = s.pos.x - (s.pos.x - s.prev.x) * thud;
        s.prev.z = s.pos.z - (s.pos.z - s.prev.z) * thud;
      }
      s.grounded = s.pos.y <= R + 0.003;
      if (s.pos.x < bounds.minX || s.pos.x > bounds.maxX) {
        const v = s.pos.x - s.prev.x;
        s.pos.x = Math.min(bounds.maxX, Math.max(bounds.minX, s.pos.x));
        s.prev.x = s.pos.x + v * WALL_REST;
      }
      if (s.pos.z < bounds.minZ || s.pos.z > bounds.maxZ) {
        const v = s.pos.z - s.prev.z;
        s.pos.z = Math.min(bounds.maxZ, Math.max(bounds.minZ, s.pos.z));
        s.prev.z = s.pos.z + v * WALL_REST;
      }
    }
    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        const a = bodies[i];
        const b = bodies[j];
        tmp.subVectors(b.pos, a.pos);
        const d = tmp.length();
        if (d >= R * 2 || d < 1e-6) continue;
        const push = (R * 2 - d) / d;
        const wa = a.held ? 0 : b.held ? 1 : 0.5;
        const wb = 1 - wa;
        a.pos.addScaledVector(tmp, -push * wa);
        b.pos.addScaledVector(tmp, push * wb);
        const vertical = Math.abs(tmp.y) / d;
        if (vertical > 0.55) {
          let hx = tmp.x;
          let hz = tmp.z;
          let hl = Math.hypot(hx, hz);
          if (hl < 1e-4) {
            hx = 0.96;
            hz = 0.28;
            hl = 1;
          }
          const k = (0.0015 * (vertical - 0.5)) / hl;
          const top = tmp.y > 0 ? b : a;
          const sign = top === b ? 1 : -1;
          if (!top.held) {
            top.pos.x += hx * k * sign;
            top.pos.z += hz * k * sign;
          }
        }
        if (a.asleep || b.asleep) {
          a.asleep = false;
          b.asleep = false;
          a.still = 0;
          b.still = 0;
        }
      }
    }
    for (const s of bodies) {
      if (s.asleep && !s.held) continue;
      tmp.subVectors(s.pos, s.prev).multiplyScalar(1 / dt);
      const speed = tmp.length();
      tmp2.set(tmp.x, 0, tmp.z);
      spinTarget.crossVectors(up, tmp2).multiplyScalar(1 / R);
      if (s.held) s.w.lerp(spinTarget.multiplyScalar(0.45), 1 - Math.exp(-dt * 8));
      else if (!s.grounded) s.w.multiplyScalar(Math.exp(-dt * 0.4));
      else s.w.lerp(spinTarget, 1 - Math.exp(-dt * 22));
      const wl = s.w.length();
      if (wl > 1e-5) {
        tmpQ.setFromAxisAngle(tmp2.copy(s.w).multiplyScalar(1 / wl), wl * dt);
        s.q.premultiply(tmpQ).normalize();
      }
      if (!s.held && s.grounded && speed < 0.03) {
        s.still += 1;
        if (s.still > 24) {
          s.asleep = true;
          s.prev.copy(s.pos);
          s.w.set(0, 0, 0);
        }
      } else s.still = 0;
      if (!s.asleep || s.held) awake = true;
    }
    return awake;
  }

  function animate(dt) {
    let busy = false;
    for (const s of sheets) {
      const a = s.anim;
      if (!a) continue;
      busy = true;
      a.k += dt / a.dur;
      const k = clamp01(a.k);
      if (a.kind === "open") {
        if (a.k < 0) continue;
        const ep = outCubic(k);
        const eq = smoother(k);
        const et = smoother(clamp01((k - 0.08) / 0.92));
        s.group.position.lerpVectors(a.from, present.pos, ep);
        s.group.position.y += Math.sin(Math.PI * ep) * 0.16 * (1 - ep * 0.5);
        s.group.quaternion.slerpQuaternions(a.fromQ, present.q, eq);
        s.t = a.fromT + (T_OPEN - a.fromT) * et;
        if (a.k >= 1) {
          s.anim = null;
          s.mode = "open";
          s.t = T_OPEN;
        }
      } else {
        const ec = inOutQuad(k);
        s.t = a.fromT + (1 - a.fromT) * ec;
        tmp.subVectors(a.toss, a.from).setY(0);
        const lean = Math.min(0.45, tmp.length() * 0.3);
        tmp.normalize();
        s.group.position.copy(a.from).addScaledVector(tmp, lean * smoother(k));
        s.group.position.y -= 0.14 * ec;
        tmpQ.copy(a.fromQ).multiply(spinQ.slerpQuaternions(identityQ, a.spin, ec));
        s.group.quaternion.copy(tmpQ);
        if (!a.rebaked && s.t > 0.55) {
          a.rebaked = true;
          s.crushes += 1;
          s.creases = addCreases(s.creases, s.seed + s.crushes * 97, 8);
          bake(s);
        }
        if (a.k >= 1) release(s);
      }
    }
    return busy;
  }

  function applyFinish(s) {
    const t = s.t;
    s.facet.value = Math.min(0.6, t * 0.8);
    s.front.clearcoat = 0.4 - 0.3 * t;
    s.front.clearcoatRoughness = 0.3 + 0.2 * t;
    s.front.roughness = 0.9 + 0.1 * t;
    s.front.envMapIntensity = 0.07 - 0.045 * t;
    s.front.specularIntensity = 0.35 - 0.15 * t;
  }

  function syncVisuals() {
    for (const s of sheets) {
      if (Math.abs(s.t - s.shownT) > 1e-4) {
        deformSheet(s.data, s.t);
        s.shownT = s.t;
        applyFinish(s);
      }
      s.group.scale.setScalar(1 + (s.ballScale - 1) * s.t);
      if (s.mode === "ball") {
        s.group.position.copy(s.pos);
        s.group.quaternion.copy(s.q);
      }
      const y = s.group.position.y;
      const lift = Math.max(0, y - R);
      const size = (R * 2.5 + lift * 0.9) * (0.35 + 0.65 * s.t);
      s.blob.scale.set(size, 1, size);
      s.blob.position.set(s.group.position.x + lift * 0.18, 0.002, s.group.position.z + lift * 0.14);
      s.blob.material.opacity = (0.9 / (1 + lift * 5)) * Math.pow(s.t, 0.6);
      s.blob.visible = s.blob.material.opacity > 0.01;
    }
  }

  function updateLamp(dt) {
    const f = 1 - Math.exp(-dt * 12);
    lamp.position.lerp(lampTarget, f);
    return lamp.position.distanceToSquared(lampTarget) > 1e-6;
  }

  function frame(now) {
    raf = 0;
    if (destroyed || !active) return;
    const dt = Math.min(1 / 12, Math.max(0, (now - last) / 1000));
    last = now;
    let busy = false;
    if (intro) {
      intro.time += dt;
      busy = true;
      if (!intro.opened && intro.time > 0.95) {
        intro.opened = true;
        beginOpen(sheets[0]);
      }
      if (intro.time > 2.2) intro = null;
    }
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 10) {
      if (physics(STEP)) busy = true;
      acc -= STEP;
      steps += 1;
    }
    if (steps === 10) acc = 0;
    if (pointer.grabbed) busy = true;
    if (animate(dt)) busy = true;
    if (busy) renderer.shadowMap.needsUpdate = true;
    if (updateLamp(dt)) busy = true;
    syncVisuals();
    renderer.render(scene, camera);
    if (busy) raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (destroyed || !active || raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function setNdc(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = e.clientX - rect.left;
    pointer.y = e.clientY - rect.top;
    ndc.set((pointer.x / rect.width) * 2 - 1, -(pointer.y / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }

  function hitTest() {
    let best = null;
    let bestD = Infinity;
    for (const s of sheets) {
      if (s.mode === "open" || s.mode === "opening") {
        const hits = raycaster.intersectObjects(s.meshes, false);
        if (hits.length && hits[0].distance < bestD) {
          bestD = hits[0].distance;
          best = { sheet: s, print: true };
        }
      } else {
        const c = s.group.position;
        const oc = tmp.subVectors(raycaster.ray.origin, c);
        const b = oc.dot(raycaster.ray.direction);
        const cc = oc.lengthSq() - R * R * 1.1;
        const disc = b * b - cc;
        if (disc < 0) continue;
        const d = -b - Math.sqrt(disc);
        if (d > 0 && d < bestD) {
          bestD = d;
          best = { sheet: s, print: false };
        }
      }
    }
    return best;
  }

  function aimLamp() {
    const hit = raycaster.ray.intersectPlane(lampPlane, tmp);
    if (hit) lampTarget.set(hit.x + 0.06, LIFT + 0.5, hit.z + 0.08);
  }

  function setCursor(c) {
    if (pointer.cursor === c) return;
    pointer.cursor = c;
    canvas.style.cursor = c;
  }

  function onDown(e) {
    if (pointer.id !== -1 || (e.pointerType === "mouse" && e.button !== 0)) return;
    setNdc(e);
    aimLamp();
    const hit = hitTest();
    pointer.id = e.pointerId;
    pointer.down = true;
    pointer.sx = e.clientX;
    pointer.sy = e.clientY;
    pointer.time = performance.now();
    pointer.sheet = hit ? hit.sheet.index : -1;
    pointer.onPrint = Boolean(hit?.print);
    pointer.grabbed = false;
    canvas.setPointerCapture?.(e.pointerId);
    if (hit && !hit.print && hit.sheet.mode === "ball") e.preventDefault();
    wake();
  }

  function onMove(e) {
    setNdc(e);
    aimLamp();
    pointer.inside = true;
    if (pointer.down && e.pointerId === pointer.id) {
      const s = sheets[pointer.sheet];
      const moved = Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy);
      if (s && !pointer.onPrint && s.mode === "ball" && !pointer.grabbed && moved > TAP_PX) {
        pointer.grabbed = true;
        s.held = true;
        s.asleep = false;
        s.still = 0;
        wakeAll();
      }
      if (pointer.grabbed) {
        raycaster.ray.intersectPlane(holdPlane, pointer.target);
        pointer.target.x = Math.min(bounds.maxX, Math.max(bounds.minX, pointer.target.x));
        pointer.target.z = Math.min(bounds.maxZ, Math.max(bounds.minZ, pointer.target.z));
        setCursor("grabbing");
      }
    } else if (e.pointerType === "mouse") {
      const hit = hitTest();
      setCursor(hit ? (hit.print ? "pointer" : "grab") : "default");
    }
    wake();
  }

  function onUp(e) {
    if (e.pointerId !== pointer.id) return;
    const s = sheets[pointer.sheet];
    const tap = !pointer.grabbed && Math.hypot(e.clientX - pointer.sx, e.clientY - pointer.sy) <= TAP_PX && e.type === "pointerup";
    if (pointer.grabbed && s) {
      s.held = false;
      s.asleep = false;
    } else if (tap) {
      if (s && !pointer.onPrint && (s.mode === "ball" || s.mode === "closing")) openSheet(s.index);
      else if (s && pointer.onPrint) closeOpen();
      else closeOpen();
    }
    pointer.id = -1;
    pointer.down = false;
    pointer.grabbed = false;
    pointer.sheet = -1;
    canvas.releasePointerCapture?.(e.pointerId);
    if (e.pointerType === "mouse") {
      setNdc(e);
      const hit = hitTest();
      setCursor(hit ? (hit.print ? "pointer" : "grab") : "default");
    }
    wake();
  }

  function onLeave(e) {
    if (pointer.down) return;
    pointer.inside = false;
    if (e.pointerType === "mouse") lampTarget.copy(lampDefault);
    setCursor("default");
    wake();
  }

  function openSheet(i) {
    const s = sheets[i];
    if (!s || s.mode === "open" || s.mode === "opening") return;
    let vacated = null;
    if (s.mode === "ball") vacated = new THREE.Vector3(s.pos.x, R, s.pos.z);
    let crushing = false;
    for (const o of sheets) {
      if (o !== s && (o.mode === "open" || o.mode === "opening")) {
        beginClose(o, vacated);
        crushing = true;
      }
    }
    beginOpen(s, crushing && !reduced ? 0.16 : 0);
    wakeAll();
    wake();
  }

  function closeOpen() {
    let any = false;
    for (const o of sheets) {
      if (o.mode === "open" || o.mode === "opening") {
        beginClose(o, null);
        any = true;
      }
    }
    if (any) wake();
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);

  const ro = new ResizeObserver(() => {
    layout();
    renderer.shadowMap.needsUpdate = true;
    if (active) {
      syncVisuals();
      renderer.render(scene, camera);
    }
  });

  layout();
  placeInitial();
  lamp.position.copy(lampDefault);
  lampTarget.copy(lampDefault);
  syncVisuals();
  ro.observe(host);
  inspect?.({ THREE, sheets, renderer, scene, camera, present, lamp, lampTarget, render: () => { syncVisuals(); renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); } });

  return {
    setActive(next) {
      if (active === next) return;
      active = next;
      if (active) {
        syncVisuals();
        renderer.render(scene, camera);
        wake();
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    open: openSheet,
    close: closeOpen,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      for (const s of sheets) {
        s.data.geometry.dispose();
        s.front.dispose();
        s.back.dispose();
        s.colorRT.dispose();
        s.normalRT.dispose();
        s.blob.material.dispose();
      }
      for (const tex of printTexBySrc.values()) tex.dispose();
      surfaceTex.dispose();
      blobGeo.dispose();
      blobTex.dispose();
      backTex.dispose();
      feltTex.dispose();
      table.geometry.dispose();
      table.material.dispose();
      bakeQuad.geometry.dispose();
      bakeMaterial.dispose();
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
