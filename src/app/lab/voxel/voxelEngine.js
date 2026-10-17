import { BORDER, CELL, COLS, PRINT_H, PRINT_W, ROWS, floorCanvas, loadImage, paperCanvas, sampleCells } from "./voxelPrint";
import { createPile } from "./voxelPile";

const SRC = "/monovolt/abt6.webp";
const COUNT = COLS * ROWS;
const SIDE = 0.092;
const BEVEL = 0.016;
const TILE = 0.014;
const PAPER = 0.004;
const GRAVITY = 30;
const OFF_X = 70;
const OFF_Z = 50;
const GRID_X = 210;
const GRID_Z = 170;
const HEAP_R = 1.95;
const GAP = 0.45;
const FOV = 26;
const YAW = 0.36;
const PITCH = 0.44;
const SLOT = 0;
const FREE = 1;
const HOME = 2;
const GROUND = "#e9e5de";

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const outCubic = (x) => 1 - (1 - x) * (1 - x) * (1 - x);
const smooth = (x) => x * x * (3 - 2 * x);

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cubeVertexHead = `
attribute vec4 aCell;
attribute vec3 aTint;
attribute vec2 aShape;
uniform float uSide;
varying vec2 vPhotoUv;
varying float vTop;
varying vec3 vTint;
varying float vBase;
varying float vOcc;
`;

const cubeVertexBody = `
vec3 transformed = vec3( position );
float squash = min( 1.0, aShape.x / uSide );
float halfH = aShape.x * 0.5;
transformed.y = position.y > 0.0 ? halfH - ( uSide * 0.5 - position.y ) * squash : -halfH + ( position.y + uSide * 0.5 ) * squash;
vPhotoUv = aCell.xy + vec2( clamp( position.x / uSide + 0.5, 0.0, 1.0 ), clamp( 0.5 - position.z / uSide, 0.0, 1.0 ) ) * aCell.zw;
vTop = normal.y;
vTint = aTint;
vBase = transformed.y + halfH;
vOcc = aShape.y;
`;

const depthVertexHead = `
attribute vec2 aShape;
uniform float uSide;
`;

const depthVertexBody = `
vec3 transformed = vec3( position );
float squash = min( 1.0, aShape.x / uSide );
float halfH = aShape.x * 0.5;
transformed.y = position.y > 0.0 ? halfH - ( uSide * 0.5 - position.y ) * squash : -halfH + ( position.y + uSide * 0.5 ) * squash;
`;

const cubeFragmentHead = `
uniform sampler2D uPhoto;
uniform float uSide;
varying vec2 vPhotoUv;
varying float vTop;
varying vec3 vTint;
varying float vBase;
varying float vOcc;
vec3 voxelTone( vec3 c ) {
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 warm = vec3( 1.0, 0.94, 0.85 );
  vec3 cool = vec3( 0.86, 0.9, 1.0 );
  float lifted = 0.026 + l * 0.9;
  return lifted * mix( cool, warm, smoothstep( 0.0, 0.45, l ) );
}
`;

const cubeFragmentColor = `
float topness = smoothstep( 0.78, 0.97, vTop );
vec3 photoCol = texture2D( uPhoto, vPhotoUv ).rgb;
vec3 baseCol = voxelTone( mix( vTint * 0.9 + 0.012, photoCol, topness ) );
float occ = mix( 1.0 - 0.6 * vOcc, 1.0, smoothstep( 0.0, uSide * 1.3, vBase ) );
occ = mix( occ, 1.0, topness );
vec4 diffuseColor = vec4( baseCol * occ, opacity );
`;

export async function createVoxel({ host, root, embedded, reduced, onState }) {
  const THREE = await import("three");
  const { RoundedBoxGeometry } = await import("three/examples/jsm/geometries/RoundedBoxGeometry.js");
  const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
  const img = await loadImage(SRC);
  const { lum, tint } = sampleCells(img);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.className = "voxel__canvas";
  host.appendChild(canvas);
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  const ground = new THREE.Color(GROUND);
  scene.background = ground;
  scene.fog = new THREE.Fog(ground, 20, 60);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envTarget = pmrem.fromScene(room, 0.04);
  room.dispose?.();
  pmrem.dispose();
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.22;

  const hemi = new THREE.HemisphereLight(0xfdfcfa, 0xb8b4ad, 1.1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfffaf3, 2.3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.006;
  key.shadow.radius = 3;
  scene.add(key);
  scene.add(key.target);
  const fill = new THREE.DirectionalLight(0xf1f4ff, 0.5);
  scene.add(fill);
  scene.add(fill.target);

  const floorTex = new THREE.CanvasTexture(floorCanvas(256));
  floorTex.colorSpace = THREE.SRGBColorSpace;
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(60, 60);
  floorTex.anisotropy = anisotropy;
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xf2eee7, map: floorTex, roughness: 0.94, metalness: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const paperTex = new THREE.CanvasTexture(paperCanvas(img));
  paperTex.colorSpace = THREE.SRGBColorSpace;
  paperTex.anisotropy = anisotropy;
  const paperW = PRINT_W + BORDER * 2;
  const paperH = PRINT_H + BORDER * 2;
  const paperGeo = new THREE.BoxGeometry(paperW, PAPER, paperH);
  const paperSide = new THREE.MeshStandardMaterial({ color: 0xf3f0e9, roughness: 0.9 });
  const paperTop = new THREE.MeshStandardMaterial({ map: paperTex, roughness: 0.86 });
  const paper = new THREE.Mesh(paperGeo, [paperSide, paperSide, paperTop, paperSide, paperSide, paperSide]);
  paper.position.y = PAPER / 2;
  paper.receiveShadow = true;
  paper.castShadow = true;
  scene.add(paper);

  const photoTex = new THREE.Texture(img);
  photoTex.colorSpace = THREE.SRGBColorSpace;
  photoTex.anisotropy = anisotropy;
  photoTex.needsUpdate = true;

  const geometry = new RoundedBoxGeometry(SIDE, SIDE, SIDE, 2, BEVEL);
  const cellAttr = new Float32Array(COUNT * 4);
  const tintAttr = new Float32Array(COUNT * 3);
  const shapeAttr = new Float32Array(COUNT * 2);
  const slotX = new Float32Array(COUNT);
  const slotZ = new Float32Array(COUNT);
  const full = new Float32Array(COUNT);
  for (let j = 0; j < ROWS; j += 1) {
    for (let i = 0; i < COLS; i += 1) {
      const n = j * COLS + i;
      cellAttr[n * 4] = i / COLS;
      cellAttr[n * 4 + 1] = 1 - (j + 1) / ROWS;
      cellAttr[n * 4 + 2] = 1 / COLS;
      cellAttr[n * 4 + 3] = 1 / ROWS;
      tintAttr[n * 3] = tint[n * 3];
      tintAttr[n * 3 + 1] = tint[n * 3 + 1];
      tintAttr[n * 3 + 2] = tint[n * 3 + 2];
      slotX[n] = (i + 0.5) * CELL - PRINT_W / 2;
      slotZ[n] = (j + 0.5) * CELL - PRINT_H / 2;
      full[n] = SIDE * (1.5 + 2.8 * Math.pow(lum[n], 1.25));
    }
  }
  geometry.setAttribute("aCell", new THREE.InstancedBufferAttribute(cellAttr, 4));
  geometry.setAttribute("aTint", new THREE.InstancedBufferAttribute(tintAttr, 3));
  const shape = new THREE.InstancedBufferAttribute(shapeAttr, 2);
  shape.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aShape", shape);

  const sideUniform = { value: SIDE };
  const photoUniform = { value: photoTex };
  const material = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0, envMapIntensity: 1 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSide = sideUniform;
    shader.uniforms.uPhoto = photoUniform;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${cubeVertexHead}`)
      .replace("#include <begin_vertex>", cubeVertexBody);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${cubeFragmentHead}`)
      .replace("vec4 diffuseColor = vec4( diffuse, opacity );", cubeFragmentColor)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix( 0.55, 0.4, smoothstep( 0.78, 0.97, vTop ) );");
  };
  material.customProgramCacheKey = () => "voxel-cube";
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uSide = sideUniform;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${depthVertexHead}`)
      .replace("#include <begin_vertex>", depthVertexBody);
  };
  depthMaterial.customProgramCacheKey = () => "voxel-depth";

  const cubes = new THREE.InstancedMesh(geometry, material, COUNT);
  cubes.customDepthMaterial = depthMaterial;
  cubes.castShadow = true;
  cubes.receiveShadow = true;
  cubes.frustumCulled = false;
  cubes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(cubes);
  const matrices = cubes.instanceMatrix.array;

  const mode = new Uint8Array(COUNT);
  const height = new Float32Array(COUNT);
  const animFrom = new Float32Array(COUNT);
  const animTo = new Float32Array(COUNT);
  const animStart = new Float32Array(COUNT);
  const animDur = new Float32Array(COUNT).fill(1);
  const launchAt = new Float32Array(COUNT).fill(Infinity);
  const tiltX = new Float32Array(COUNT);
  const tiltZ = new Float32Array(COUNT);
  const bump = new Float32Array(COUNT);
  const freeH = new Float32Array(COUNT);
  const homeAt = new Float32Array(COUNT).fill(Infinity);
  const flightStart = new Float32Array(COUNT);
  const flightDur = new Float32Array(COUNT).fill(1);
  const flightArc = new Float32Array(COUNT);
  const flightFrom = new Float32Array(COUNT * 3);
  const flightQ = new Float32Array(COUNT * 4);
  const freeAt = new Float32Array(COUNT).fill(Infinity);

  const waveX = PRINT_W * -0.62;
  const waveZ = PRINT_H * 0.62;
  for (let n = 0; n < COUNT; n += 1) {
    const d = Math.hypot(slotX[n] - waveX, slotZ[n] - waveZ);
    const crest = Math.exp(-Math.pow((d - 4.1) / 0.7, 2));
    const echo = 0.38 * Math.exp(-Math.pow((d - 2.85) / 0.4, 2));
    const echo2 = 0.14 * Math.exp(-Math.pow((d - 1.9) / 0.32, 2));
    const e = Math.min(1, crest + echo + echo2);
    const h = TILE + (full[n] - TILE) * e;
    height[n] = h;
    animFrom[n] = h;
    animTo[n] = h;
    animStart[n] = -1;
    animDur[n] = 1;
  }

  const groundAt = (x, z) => (Math.abs(x) > paperW / 2 || Math.abs(z) > paperH / 2 ? 0 : PAPER);
  const blockedTop = (gi, gj) => {
    const i = gi - OFF_X;
    const j = gj - OFF_Z;
    if (i < 0 || j < 0 || i >= COLS || j >= ROWS) return -1;
    const n = j * COLS + i;
    if (mode[n] !== SLOT) return -1;
    return PAPER + height[n] + bump[n] * (full[n] - TILE) * 0.4;
  };
  const pile = createPile(THREE, {
    count: COUNT,
    side: SIDE,
    cell: CELL,
    originX: -PRINT_W / 2 - OFF_X * CELL,
    originZ: -PRINT_H / 2 - OFF_Z * CELL,
    gx: GRID_X,
    gz: GRID_Z,
    gravity: GRAVITY,
    groundAt,
    blockedTop,
    reduced,
  });

  const heap = { x: 0, z: 0 };
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const vel = [0, 0, 0];
  const pointer = { id: -1, down: false, over: false, x: 0, z: 0, onPrint: false, valid: false };
  const pending = { ripple: null, home: false };
  const rand = rng(17);
  let clock = 0;
  let last = 0;
  let raf = 0;
  let active = false;
  let destroyed = false;
  let width = 1;
  let height2 = 1;
  let outCount = -1;
  let hovering = false;
  let handPrevX = 0;
  let handPrevZ = 0;

  const framings = [
    { pos: new THREE.Vector3(), target: new THREE.Vector3(), offX: 0, offY: 0, dist: 10 },
    { pos: new THREE.Vector3(), target: new THREE.Vector3(), offX: 0, offY: 0, dist: 10 },
  ];
  const view = { k: 0, v: 0, goal: 0 };
  let camYaw = YAW;
  let camPitch = PITCH;
  const lookTmp = new THREE.Vector3();

  function frame(pts, out, insets) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[2]);
      maxZ = Math.max(maxZ, p[2]);
    }
    const target = out.target.set((minX + maxX) / 2, 0.15, (minZ + maxZ) / 2);
    const dir = lookTmp.set(Math.sin(camYaw) * Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw) * Math.cos(camPitch));
    const availW = width - insets.side * 2;
    const availH = height2 - insets.top - insets.bottom;
    camera.clearViewOffset();
    const measure = (dist) => {
      camera.position.copy(target).addScaledVector(dir, dist);
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      let a = Infinity;
      let b = -Infinity;
      let c = Infinity;
      let d = -Infinity;
      for (const p of pts) {
        tmp.set(p[0], p[1], p[2]).project(camera);
        a = Math.min(a, tmp.x);
        b = Math.max(b, tmp.x);
        c = Math.min(c, tmp.y);
        d = Math.max(d, tmp.y);
      }
      return { x0: ((a + 1) / 2) * width, x1: ((b + 1) / 2) * width, y0: ((1 - d) / 2) * height2, y1: ((1 - c) / 2) * height2 };
    };
    let lo = 2;
    let hi = 120;
    for (let k = 0; k < 40; k += 1) {
      const mid = (lo + hi) / 2;
      const m = measure(mid);
      if (m.x1 - m.x0 <= availW && m.y1 - m.y0 <= availH) hi = mid;
      else lo = mid;
    }
    const m = measure(hi);
    out.pos.copy(camera.position);
    out.offX = (m.x0 + m.x1) / 2 - (insets.side + availW / 2);
    out.offY = (m.y0 + m.y1) / 2 - (insets.top + availH / 2);
    out.dist = hi;
  }

  function applyView() {
    const e = view.k;
    const a = framings[0];
    const b = framings[1];
    camera.position.lerpVectors(a.pos, b.pos, e);
    lookTmp.lerpVectors(a.target, b.target, e);
    camera.lookAt(lookTmp);
    camera.setViewOffset(width, height2, a.offX + (b.offX - a.offX) * e, a.offY + (b.offY - a.offY) * e, width, height2);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const dist = a.dist + (b.dist - a.dist) * e;
    scene.fog.near = dist * 1.15;
    scene.fog.far = dist * 3.2;
  }

  function layout() {
    width = Math.max(1, host.clientWidth);
    height2 = Math.max(1, host.clientHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height2, false);
    camera.aspect = width / height2;
    const aspect = width / height2;
    const wide = aspect > 0.95;
    const tall = clamp01((0.95 - aspect) / 0.45);
    camYaw = YAW + (0.1 - YAW) * tall;
    camPitch = PITCH + (0.76 - PITCH) * tall;
    if (wide) {
      heap.x = paperW / 2 + GAP + HEAP_R;
      heap.z = 0.2;
    } else {
      heap.x = 0.3;
      heap.z = paperH / 2 + GAP + HEAP_R * 0.9;
    }
    const printPts = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) printPts.push([(sx * paperW) / 2, 0, (sz * paperH) / 2]);
    printPts.push([0, 0.36, 0]);
    const allPts = printPts.slice();
    for (let k = 0; k < 12; k += 1) {
      const a = (k / 12) * Math.PI * 2;
      allPts.push([heap.x + Math.cos(a) * HEAP_R * 0.85, 0, heap.z + Math.sin(a) * HEAP_R * 0.85]);
    }
    allPts.push([heap.x, 1.0, heap.z]);
    const insets = {
      top: embedded ? 16 : width < 600 ? 128 : 112,
      bottom: embedded ? 64 : 88,
      side: embedded ? 12 : width < 600 ? 12 : 40,
    };
    frame(printPts, framings[0], { ...insets, side: insets.side + (wide && !embedded ? width * 0.06 : 0) });
    frame(allPts, framings[1], insets);
    applyView();
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of allPts) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[2]);
      maxZ = Math.max(maxZ, p[2]);
    }
    pile.bounds.minX = minX - 0.5;
    pile.bounds.maxX = maxX + 0.5;
    pile.bounds.minZ = minZ - 0.5;
    pile.bounds.maxZ = maxZ + 0.5;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    key.target.position.set(cx, 0, cz);
    key.position.set(cx - 6.5, 8.5, cz + 2.4);
    const span = Math.max(maxX - minX, maxZ - minZ) * 0.62 + 1.2;
    key.shadow.camera.left = -span;
    key.shadow.camera.right = span;
    key.shadow.camera.top = span;
    key.shadow.camera.bottom = -span;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.camera.updateProjectionMatrix();
    fill.target.position.set(cx, 0, cz);
    fill.position.copy(framings[1].pos).add(new THREE.Vector3(3, 2, 0));
  }


  function slotHeight(n) {
    const k = clamp01((clock - animStart[n]) / animDur[n]);
    return animFrom[n] + (animTo[n] - animFrom[n]) * outCubic(k);
  }

  function setSlotAnim(n, to, start, dur) {
    animFrom[n] = height[n] + bump[n] * (full[n] - TILE) * 0.4;
    bump[n] = 0;
    animTo[n] = to;
    animStart[n] = start;
    animDur[n] = dur;
  }

  function startRipple(x, z) {
    const speed = reduced ? 9 : 4.6;
    const rise = reduced ? 0.2 : 0.42;
    for (let n = 0; n < COUNT; n += 1) {
      const d = Math.hypot(slotX[n] - x, slotZ[n] - z);
      const at = clock + d / speed + rand() * 0.04;
      if (mode[n] === SLOT && launchAt[n] === Infinity) {
        setSlotAnim(n, full[n], at, rise);
        launchAt[n] = at + rise + (reduced ? 0.04 : 0.16);
        const l = d || 1;
        tiltX[n] = (slotX[n] - x) / l;
        tiltZ[n] = (slotZ[n] - z) / l;
        homeAt[n] = Infinity;
      } else if (mode[n] === HOME) {
        freeAt[n] = at;
      } else if (mode[n] === FREE) {
        homeAt[n] = Infinity;
      }
    }
  }

  function quatTilt(n, amount, out) {
    const ax = tiltZ[n];
    const az = -tiltX[n];
    const s = Math.sin(amount / 2);
    out[0] = ax * s;
    out[1] = 0;
    out[2] = az * s;
    out[3] = Math.cos(amount / 2);
    return out;
  }

  const qTmp = [0, 0, 0, 1];
  const wTmp = [0, 0, 0];

  function launch(n) {
    launchAt[n] = Infinity;
    mode[n] = FREE;
    const h = slotHeight(n);
    freeH[n] = h;
    const x0 = slotX[n];
    const z0 = slotZ[n];
    const y0 = PAPER + h * 0.5;
    const r = HEAP_R * 0.16 * Math.sqrt(rand());
    const a = rand() * Math.PI * 2;
    const tx = heap.x + Math.cos(a) * r;
    const tz = heap.z + Math.sin(a) * r;
    const ty = 0.35;
    const dist = Math.hypot(tx - x0, tz - z0);
    const T = Math.min(0.66, Math.max(0.36, 0.3 + 0.055 * dist)) * (0.94 + rand() * 0.12);
    const vx = (tx - x0) / T;
    const vz = (tz - z0) / T;
    const vy = (ty - y0) / T + 0.5 * GRAVITY * T;
    const hl = Math.hypot(vx, vz) || 1;
    const spinRate = 5 + rand() * 7;
    wTmp[0] = (vz / hl) * spinRate + (rand() - 0.5) * 3;
    wTmp[1] = (rand() - 0.5) * 4;
    wTmp[2] = (-vx / hl) * spinRate + (rand() - 0.5) * 3;
    quatTilt(n, 0.24, qTmp);
    pile.launch(n, x0, y0, z0, vx, vy, vz, qTmp, wTmp);
  }

  function flightPose(n, u, out) {
    const e = smooth(clamp01(u));
    const o = n * 3;
    const tx = slotX[n];
    const tz = slotZ[n];
    const ty = PAPER + SIDE / 2;
    out[0] = flightFrom[o] + (tx - flightFrom[o]) * e;
    out[1] = flightFrom[o + 1] + (ty - flightFrom[o + 1]) * e + flightArc[n] * Math.sin(Math.PI * clamp01(u));
    out[2] = flightFrom[o + 2] + (tz - flightFrom[o + 2]) * e;
    return out;
  }

  function depart(n) {
    homeAt[n] = Infinity;
    const o = n * 3;
    const q = n * 4;
    flightFrom[o] = pile.pos[o];
    flightFrom[o + 1] = pile.pos[o + 1];
    flightFrom[o + 2] = pile.pos[o + 2];
    flightQ[q] = pile.quat[q];
    flightQ[q + 1] = pile.quat[q + 1];
    flightQ[q + 2] = pile.quat[q + 2];
    flightQ[q + 3] = pile.quat[q + 3];
    pile.take(n);
    mode[n] = HOME;
    const dist = Math.hypot(slotX[n] - flightFrom[o], slotZ[n] - flightFrom[o + 2]);
    flightStart[n] = clock;
    flightDur[n] = reduced ? 0.3 : 0.5 + 0.17 * Math.sqrt(dist);
    flightArc[n] = reduced ? 0.1 : Math.min(1.1, 0.16 + 0.17 * dist);
  }

  function land(n) {
    const cellIndex = pile.cellAt(slotX[n], slotZ[n]);
    if (cellIndex >= 0) {
      const ax = slotX[n] - heap.x;
      const az = slotZ[n] - heap.z;
      const al = Math.hypot(ax, az) || 1;
      pile.clearCell(cellIndex, clock, -ax / al, -az / al);
    }
    mode[n] = SLOT;
    height[n] = SIDE;
    bump[n] = 0;
    animFrom[n] = SIDE;
    animTo[n] = TILE;
    animStart[n] = clock + (reduced ? 0 : 0.06);
    animDur[n] = reduced ? 0.2 : 0.5;
    if (freeAt[n] !== Infinity) {
      const at = Math.max(clock, freeAt[n]);
      freeAt[n] = Infinity;
      const rise = reduced ? 0.2 : 0.42;
      setSlotAnim(n, full[n], at, rise);
      launchAt[n] = at + rise + (reduced ? 0.04 : 0.16);
      tiltX[n] = 0;
      tiltZ[n] = 1;
    }
  }

  function release(n) {
    freeAt[n] = Infinity;
    const u = (clock - flightStart[n]) / flightDur[n];
    const p = flightPose(n, u, [0, 0, 0]);
    const p0 = flightPose(n, u - 1 / 60 / flightDur[n], [0, 0, 0]);
    const q = n * 4;
    const k = smooth(clamp01(u * 1.15));
    slerpToIdentity(flightQ, q, k, qTmp);
    wTmp[0] = 0;
    wTmp[1] = 0;
    wTmp[2] = 0;
    mode[n] = FREE;
    freeH[n] = SIDE;
    pile.launch(n, p[0], p[1], p[2], (p[0] - p0[0]) * 60, (p[1] - p0[1]) * 60, (p[2] - p0[2]) * 60, qTmp, wTmp);
  }

  function slerpToIdentity(src, q, k, out) {
    let x = src[q];
    let y = src[q + 1];
    let z = src[q + 2];
    let w = src[q + 3];
    if (w < 0) {
      x = -x;
      y = -y;
      z = -z;
      w = -w;
    }
    const cos = Math.min(1, w);
    const angle = Math.acos(cos);
    const s = Math.sin(angle);
    if (s < 1e-5) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
      return out;
    }
    const a = Math.sin((1 - k) * angle) / s;
    const b = Math.sin(k * angle) / s;
    out[0] = x * a;
    out[1] = y * a;
    out[2] = z * a;
    out[3] = w * a + b;
    return out;
  }

  function callHome() {
    const order = [];
    for (let n = 0; n < COUNT; n += 1) {
      if (mode[n] === SLOT) {
        if (launchAt[n] !== Infinity || height[n] > TILE + 1e-4 || animTo[n] > TILE) {
          launchAt[n] = Infinity;
          const d = Math.hypot(slotX[n], slotZ[n]);
          setSlotAnim(n, TILE, clock + d * 0.08, reduced ? 0.2 : 0.55);
        }
      } else if (mode[n] === FREE) {
        const o = n * 3;
        const d = Math.hypot(pile.pos[o] - slotX[n], pile.pos[o + 2] - slotZ[n]);
        order.push([n, d - pile.levelOf(n) * 0.22]);
      } else freeAt[n] = Infinity;
    }
    order.sort((a, b) => a[1] - b[1]);
    const spread = reduced ? 0.6 : 2.1;
    order.forEach(([n], rank) => {
      homeAt[n] = clock + spread * Math.pow(rank / Math.max(1, order.length), 0.82) + rand() * 0.03;
    });
  }

  function writeMatrix(n, x, y, z, qx, qy, qz, qw) {
    const o = n * 16;
    const x2 = qx + qx;
    const y2 = qy + qy;
    const z2 = qz + qz;
    const xx = qx * x2;
    const xy = qx * y2;
    const xz = qx * z2;
    const yy = qy * y2;
    const yz = qy * z2;
    const zz = qz * z2;
    const wx = qw * x2;
    const wy = qw * y2;
    const wz = qw * z2;
    matrices[o] = 1 - (yy + zz);
    matrices[o + 1] = xy + wz;
    matrices[o + 2] = xz - wy;
    matrices[o + 3] = 0;
    matrices[o + 4] = xy - wz;
    matrices[o + 5] = 1 - (xx + zz);
    matrices[o + 6] = yz + wx;
    matrices[o + 7] = 0;
    matrices[o + 8] = xz + wy;
    matrices[o + 9] = yz - wx;
    matrices[o + 10] = 1 - (xx + yy);
    matrices[o + 11] = 0;
    matrices[o + 12] = x;
    matrices[o + 13] = y;
    matrices[o + 14] = z;
    matrices[o + 15] = 1;
  }

  const poseTmp = [0, 0, 0];

  function update(dt) {
    let busy = false;
    if (pending.ripple) {
      startRipple(pending.ripple.x, pending.ripple.z);
      pending.ripple = null;
    }
    if (pending.home) {
      callHome();
      pending.home = false;
    }
    const hoverOn = !reduced && pointer.over && pointer.onPrint && !pointer.down;
    const bumpRate = 1 - Math.exp(-dt * 9);
    for (let n = 0; n < COUNT; n += 1) {
      const m = mode[n];
      if (m === SLOT) {
        if (launchAt[n] !== Infinity && clock >= launchAt[n]) {
          launch(n);
          busy = true;
          continue;
        }
        const h = slotHeight(n);
        height[n] = h;
        if (clock < animStart[n] + animDur[n] || launchAt[n] !== Infinity) busy = true;
        let target = 0;
        if (hoverOn && launchAt[n] === Infinity) {
          const dx = slotX[n] - pointer.x;
          const dz = slotZ[n] - pointer.z;
          target = 0.55 * Math.exp(-(dx * dx + dz * dz) / 0.2);
        }
        const b = bump[n] + (target - bump[n]) * bumpRate;
        bump[n] = Math.abs(b - target) < 1e-3 ? target : b;
        if (bump[n] !== target) busy = true;
      } else if (m === FREE) {
        if (homeAt[n] !== Infinity && clock >= homeAt[n]) depart(n);
        else {
          freeH[n] += (SIDE - freeH[n]) * (1 - Math.exp(-dt * 12));
          if (Math.abs(freeH[n] - SIDE) > 1e-4) busy = true;
          else freeH[n] = SIDE;
          if (homeAt[n] !== Infinity) busy = true;
        }
      } else if (m === HOME) {
        busy = true;
        if (freeAt[n] !== Infinity && clock >= freeAt[n]) release(n);
        else if (clock >= flightStart[n] + flightDur[n]) land(n);
      }
    }
    if (pointer.down && pointer.valid) {
      const hand = pile.hand;
      if (!hand.on) {
        hand.on = true;
        hand.x = pointer.x;
        hand.z = pointer.z;
        hand.vx = 0;
        hand.vz = 0;
        handPrevX = pointer.x;
        handPrevZ = pointer.z;
      }
      const dx = pointer.x - handPrevX;
      const dz = pointer.z - handPrevZ;
      const d = Math.hypot(dx, dz);
      const cap = 12 * dt;
      const k = d > cap ? cap / d : 1;
      handPrevX += dx * k;
      handPrevZ += dz * k;
      const hvx = (handPrevX - hand.x) / dt;
      const hvz = (handPrevZ - hand.z) / dt;
      const blend = 1 - Math.exp(-dt * 20);
      hand.vx += (hvx - hand.vx) * blend;
      hand.vz += (hvz - hand.vz) * blend;
      hand.x = handPrevX;
      hand.z = handPrevZ;
      busy = true;
    } else {
      pile.hand.on = false;
      pile.hand.vx = 0;
      pile.hand.vz = 0;
    }
    if (pile.size > 0 && pile.step(clock, dt)) busy = true;
    let lifted = false;
    for (let n = 0; n < COUNT && !lifted; n += 1) if (mode[n] !== SLOT || launchAt[n] !== Infinity) lifted = true;
    view.goal = lifted ? 1 : 0;
    if (Math.abs(view.goal - view.k) > 1e-4 || Math.abs(view.v) > 1e-4) {
      const omega = reduced ? 9 : 2.4;
      const acc = omega * omega * (view.goal - view.k) - 2 * omega * view.v;
      view.v += acc * dt;
      view.k += view.v * dt;
      applyView();
      busy = true;
    } else if (view.k !== view.goal) {
      view.k = view.goal;
      view.v = 0;
      applyView();
    }
    return busy;
  }

  function compose() {
    const q = qTmp;
    for (let n = 0; n < COUNT; n += 1) {
      const m = mode[n];
      if (m === SLOT) {
        const h = height[n] + bump[n] * (full[n] - TILE) * 0.4;
        shapeAttr[n * 2] = h;
        shapeAttr[n * 2 + 1] = 1;
        if (launchAt[n] !== Infinity) {
          const lead = launchAt[n] - clock;
          const amount = 0.24 * smooth(clamp01(1 - lead / 0.24));
          quatTilt(n, amount, q);
          const lx = tiltX[n] * Math.sin(amount) * h * 0.5;
          const lz = tiltZ[n] * Math.sin(amount) * h * 0.5;
          writeMatrix(n, slotX[n] + lx, PAPER + h / 2, slotZ[n] + lz, q[0], q[1], q[2], q[3]);
        } else writeMatrix(n, slotX[n], PAPER + h / 2, slotZ[n], 0, 0, 0, 1);
      } else if (m === FREE) {
        const o = n * 3;
        const k = n * 4;
        shapeAttr[n * 2] = freeH[n];
        shapeAttr[n * 2 + 1] = 0.55;
        writeMatrix(n, pile.pos[o], pile.pos[o + 1] + (freeH[n] - SIDE) / 2, pile.pos[o + 2], pile.quat[k], pile.quat[k + 1], pile.quat[k + 2], pile.quat[k + 3]);
      } else {
        const u = (clock - flightStart[n]) / flightDur[n];
        const p = flightPose(n, u, poseTmp);
        slerpToIdentity(flightQ, n * 4, smooth(clamp01(u * 1.15)), q);
        shapeAttr[n * 2] = SIDE;
        shapeAttr[n * 2 + 1] = 0.55;
        writeMatrix(n, p[0], p[1], p[2], q[0], q[1], q[2], q[3]);
      }
    }
    cubes.instanceMatrix.needsUpdate = true;
    shape.needsUpdate = true;
  }

  function report() {
    let out = 0;
    for (let n = 0; n < COUNT; n += 1) if (mode[n] !== SLOT) out += 1;
    if (out !== outCount) {
      outCount = out;
      onState?.({ out });
    }
  }

  function render() {
    compose();
    renderer.render(scene, camera);
  }

  function tick(ts) {
    raf = 0;
    if (destroyed || !active) return;
    const dt = last ? Math.min(1 / 30, Math.max(1 / 240, (ts - last) / 1000)) : 1 / 60;
    last = ts;
    clock += dt;
    const busy = update(dt);
    render();
    report();
    if (busy || pending.ripple || pending.home) raf = requestAnimationFrame(tick);
    else last = 0;
  }

  function kick() {
    if (!raf && active && !destroyed) raf = requestAnimationFrame(tick);
  }

  function toFloor(e) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const ok = raycaster.ray.intersectPlane(floorPlane, hit);
    if (!ok) return false;
    pointer.x = hit.x;
    pointer.z = hit.z;
    pointer.onPrint = Math.abs(hit.x) < PRINT_W / 2 + 0.05 && Math.abs(hit.z) < PRINT_H / 2 + 0.05;
    return true;
  }

  function anyLiftable() {
    for (let n = 0; n < COUNT; n += 1) if ((mode[n] === SLOT && launchAt[n] === Infinity) || mode[n] === HOME) return true;
    return false;
  }

  function cursor() {
    const want = pointer.down ? "grabbing" : pointer.onPrint && anyLiftable() ? "pointer" : outCount > 0 ? "grab" : "default";
    if (canvas.style.cursor !== want) canvas.style.cursor = want;
  }

  function onDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    pointer.valid = toFloor(e);
    if (!pointer.valid) return;
    pointer.id = e.pointerId;
    pointer.down = true;
    pointer.over = true;
    canvas.setPointerCapture?.(e.pointerId);
    if (pointer.onPrint && anyLiftable()) pending.ripple = { x: pointer.x, z: pointer.z };
    cursor();
    kick();
  }

  function onMove(e) {
    if (pointer.down && e.pointerId !== pointer.id) return;
    pointer.valid = toFloor(e);
    pointer.over = true;
    hovering = true;
    cursor();
    kick();
  }

  function onUp(e) {
    if (e.pointerId !== pointer.id) return;
    pointer.down = false;
    pointer.id = -1;
    if (e.pointerType !== "mouse") pointer.over = false;
    cursor();
    kick();
  }

  function onLeave() {
    if (pointer.down) return;
    pointer.over = false;
    hovering = false;
    kick();
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);

  const ro = new ResizeObserver(() => {
    layout();
    if (active) {
      render();
      kick();
    }
  });
  ro.observe(host);
  layout();
  render();
  report();
  root.setAttribute("data-ready", "");

  return {
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on) {
        last = 0;
        render();
        kick();
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    lift() {
      pending.ripple = { x: 0, z: PRINT_H * 0.1 };
      kick();
    },
    callHome() {
      pending.home = true;
      kick();
    },
    get hovering() {
      return hovering;
    },
    inspect() {
      return { clock, out: outCount, size: pile.size };
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      geometry.dispose();
      material.dispose();
      depthMaterial.dispose();
      floor.geometry.dispose();
      floorMat.dispose();
      floorTex.dispose();
      paperGeo.dispose();
      paperSide.dispose();
      paperTop.dispose();
      paperTex.dispose();
      photoTex.dispose();
      envTarget.dispose();
      key.shadow.map?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
