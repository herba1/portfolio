import FilmSim, { HALF, LIP_INSIDE, PITCH, SEG, U_MAX } from "./filmSim";
import { FRAMES, buildDetailAtlas, buildLabel, buildPhotoAtlas, buildTableDust, loadImage } from "./filmArt";
import { FILM_FRAGMENT, FILM_VERTEX, GLOSS_FRAGMENT, SHADOW_FRAGMENT, SHADOW_VERTEX, TABLE_FRAGMENT, TABLE_VERTEX } from "./filmShader";

const MAX_DPR = 2;
const SUB = 3;
const FOV = 26;
const TILT = 0.55;
const GRAB_Y = 7;
const LEADER = 76;
const SLOT = [15.2, 4.2, 0];
const DIR_PITCH = -0.2;
const BOX_DIR = normalize3([-0.42, 1, -0.5]);
const TAP_PX = 6;

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export function framesOut(u) {
  return Math.max(0, Math.min(FRAMES.length, Math.floor((u - LEADER + 1) / PITCH)));
}

export async function createFilmEngine({ host, canvas, embedded, onReady, onFail, onStatus }) {
  const THREE = await import("three");
  const { RoundedBoxGeometry } = await import("three/examples/jsm/geometries/RoundedBoxGeometry.js");

  const fontFamily = getComputedStyle(host).fontFamily || "sans-serif";
  const monoFamily = getComputedStyle(host).getPropertyValue("--font-mono").trim() || "ui-monospace, monospace";
  if (document.fonts?.ready) await document.fonts.ready.catch(() => null);
  const images = await Promise.all(FRAMES.map((frame) => loadImage(frame.src).catch(() => null)));

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  } catch {
    onFail?.();
    return { destroy() {}, setPrint() {}, key() {} };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0xf4f3f0, 1);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 6000);

  const disposables = [];
  const keep = (thing) => {
    disposables.push(thing);
    return thing;
  };

  const canvasTexture = (source, srgb) => {
    const tex = keep(new THREE.CanvasTexture(source));
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.anisotropy = maxAniso;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  };

  const photoTex = canvasTexture(buildPhotoAtlas(images), false);
  photoTex.flipY = false;
  const detailTex = canvasTexture(buildDetailAtlas(monoFamily), false);
  detailTex.flipY = false;
  const labelTex = canvasTexture(buildLabel(fontFamily), true);
  const dustTex = canvasTexture(buildTableDust(), false);
  dustTex.wrapS = THREE.RepeatWrapping;
  dustTex.wrapT = THREE.RepeatWrapping;

  const envScene = new THREE.Scene();
  const envGeo = keep(new THREE.BoxGeometry(20, 10, 20));
  const envRoom = new THREE.Mesh(envGeo, keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.24, 0.23, 0.22), side: THREE.BackSide })));
  envRoom.position.y = 4;
  envScene.add(envRoom);
  const planeGeo = keep(new THREE.PlaneGeometry(1, 1));
  const envFloor = new THREE.Mesh(planeGeo, keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.5, 1.48), side: THREE.DoubleSide })));
  envFloor.rotation.x = -Math.PI / 2;
  envFloor.scale.set(12, 12, 1);
  envFloor.position.y = -0.9;
  envScene.add(envFloor);
  const envBox = new THREE.Mesh(planeGeo, keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.9, 5.7), side: THREE.DoubleSide })));
  envBox.scale.set(4.2, 2.6, 1);
  envBox.position.set(BOX_DIR[0] * 7, BOX_DIR[1] * 7, BOX_DIR[2] * 7);
  envBox.lookAt(0, 0, 0);
  envScene.add(envBox);
  const envFill = new THREE.Mesh(planeGeo, keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.05, 0.9), side: THREE.DoubleSide })));
  envFill.scale.set(5, 3, 1);
  envFill.position.set(8, 3, 4);
  envFill.lookAt(0, 0, 0);
  envScene.add(envFill);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(envScene, 0.02);
  scene.environment = envTarget.texture;

  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(BOX_DIR[0] * 100, BOX_DIR[1] * 100, BOX_DIR[2] * 100);
  scene.add(key);

  const shadowShift = [-BOX_DIR[0] / BOX_DIR[1] * 12.5, -BOX_DIR[2] / BOX_DIR[1] * 12.5];
  const tableGeo = keep(new THREE.PlaneGeometry(5000, 5000));
  tableGeo.rotateX(-Math.PI / 2);
  const tableMat = keep(
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: TABLE_VERTEX,
      fragmentShader: TABLE_FRAGMENT,
      uniforms: {
        uDust: { value: dustTex },
        uCenter: { value: new THREE.Vector2(140, 0) },
        uShadowShift: { value: new THREE.Vector2(shadowShift[0], shadowShift[1]) },
      },
      depthWrite: false,
      depthTest: false,
    }),
  );
  const table = new THREE.Mesh(tableGeo, tableMat);
  table.renderOrder = 0;
  scene.add(table);

  const can = new THREE.Group();
  can.position.set(0, 12.5, 0);
  scene.add(can);
  const bodyGeo = keep(new THREE.CylinderGeometry(12.5, 12.5, 40, 128, 1, true));
  bodyGeo.rotateX(Math.PI / 2);
  const bodyMat = keep(
    new THREE.MeshPhysicalMaterial({ map: labelTex, roughness: 0.42, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.22, envMapIntensity: 0.9 }),
  );
  can.add(new THREE.Mesh(bodyGeo, bodyMat));
  const capProfile = [
    [0.001, 1.7],
    [3.8, 1.7],
    [4.2, 1.45],
    [11.6, 1.45],
    [12.7, 1.35],
    [13.35, 1.0],
    [13.45, 0.45],
    [13.1, 0.0],
    [12.4, -0.2],
  ].map(([r, h]) => new THREE.Vector2(r, h));
  const capGeo = keep(new THREE.LatheGeometry(capProfile, 96));
  const capMat = keep(new THREE.MeshPhysicalMaterial({ color: 0xc9ccd2, roughness: 0.26, metalness: 1, envMapIntensity: 1.1 }));
  const capFront = new THREE.Mesh(capGeo, capMat);
  capFront.rotation.x = Math.PI / 2;
  capFront.position.z = 20;
  can.add(capFront);
  const capBack = new THREE.Mesh(capGeo, capMat);
  capBack.rotation.x = -Math.PI / 2;
  capBack.position.z = -20;
  can.add(capBack);
  const knobGeo = keep(new THREE.CylinderGeometry(4.4, 4.6, 6.4, 48));
  knobGeo.rotateX(Math.PI / 2);
  const knobMat = keep(new THREE.MeshPhysicalMaterial({ color: 0x1a1a1c, roughness: 0.38, metalness: 0.1, clearcoat: 0.4 }));
  const knob = new THREE.Mesh(knobGeo, knobMat);
  knob.position.z = -20 - 1.7 - 3.2;
  can.add(knob);
  const knobCapGeo = keep(new THREE.CylinderGeometry(3.0, 3.6, 0.9, 40));
  knobCapGeo.rotateX(Math.PI / 2);
  const knobCap = new THREE.Mesh(knobCapGeo, knobMat);
  knobCap.position.z = -20 - 1.7 - 6.6;
  can.add(knobCap);
  const stubGeo = keep(new THREE.CylinderGeometry(3.4, 3.6, 1.6, 40));
  stubGeo.rotateX(Math.PI / 2);
  const stub = new THREE.Mesh(stubGeo, capMat);
  stub.position.z = 20 + 1.7 + 0.6;
  can.add(stub);

  const dir = [Math.cos(DIR_PITCH), Math.sin(DIR_PITCH), 0];
  const lipAngle = Math.atan2(dir[1], dir[0]);
  const lipGeo = keep(new RoundedBoxGeometry(9, 5.4, 39.2, 4, 1.8));
  const lipMat = keep(new THREE.MeshPhysicalMaterial({ color: 0x1d356f, roughness: 0.4, metalness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.3 }));
  const lip = new THREE.Mesh(lipGeo, lipMat);
  lip.position.set(SLOT[0] - dir[0] * 4.0, SLOT[1] - dir[1] * 4.0, 0);
  lip.rotation.z = lipAngle;
  scene.add(lip);
  const feltGeo = keep(new RoundedBoxGeometry(1.6, 1.3, 37.2, 2, 0.5));
  const feltMat = keep(new THREE.MeshPhysicalMaterial({ color: 0x141416, roughness: 1, metalness: 0, sheen: 1, sheenColor: new THREE.Color(0x5a5a62), sheenRoughness: 0.5 }));
  const normalLip = [-dir[1], dir[0]];
  for (const side of [1, -1]) {
    const felt = new THREE.Mesh(feltGeo, feltMat);
    felt.position.set(SLOT[0] + dir[0] * 0.2 + normalLip[0] * 0.95 * side, SLOT[1] + dir[1] * 0.2 + normalLip[1] * 0.95 * side, 0);
    felt.rotation.z = lipAngle;
    scene.add(felt);
  }

  const sim = new FilmSim({ slot: SLOT, dir });
  const maxPoints = sim.cap + 3;
  const maxSamples = (maxPoints - 1) * SUB + 1;
  const filmGeo = keep(new THREE.BufferGeometry());
  const filmPos = new Float32Array(maxSamples * 2 * 3);
  const filmNormal = new Float32Array(maxSamples * 2 * 3);
  const filmCoord = new Float32Array(maxSamples * 2 * 2);
  const index = [];
  for (let i = 0; i < maxSamples - 1; i += 1) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  filmGeo.setIndex(index);
  const posAttr = new THREE.BufferAttribute(filmPos, 3).setUsage(THREE.DynamicDrawUsage);
  const normalAttr = new THREE.BufferAttribute(filmNormal, 3).setUsage(THREE.DynamicDrawUsage);
  const coordAttr = new THREE.BufferAttribute(filmCoord, 2).setUsage(THREE.DynamicDrawUsage);
  filmGeo.setAttribute("position", posAttr);
  filmGeo.setAttribute("normal", normalAttr);
  filmGeo.setAttribute("aFilm", coordAttr);

  const flips = new Array(16).fill(0);
  const filmMat = keep(
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FILM_VERTEX,
      fragmentShader: FILM_FRAGMENT,
      uniforms: { uPhoto: { value: photoTex }, uDetail: { value: detailTex }, uFlip: { value: flips } },
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
    }),
  );
  const boxU = normalize3([BOX_DIR[2], 0, -BOX_DIR[0]]);
  const boxV = normalize3([
    BOX_DIR[1] * boxU[2] - BOX_DIR[2] * boxU[1],
    BOX_DIR[2] * boxU[0] - BOX_DIR[0] * boxU[2],
    BOX_DIR[0] * boxU[1] - BOX_DIR[1] * boxU[0],
  ]);
  const glossMat = keep(
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FILM_VERTEX,
      fragmentShader: GLOSS_FRAGMENT,
      uniforms: {
        uBoxDir: { value: new THREE.Vector3(...BOX_DIR) },
        uBoxU: { value: new THREE.Vector3(...boxU) },
        uBoxV: { value: new THREE.Vector3(...boxV) },
      },
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    }),
  );
  const film = new THREE.Mesh(filmGeo, filmMat);
  film.frustumCulled = false;
  film.renderOrder = 3;
  scene.add(film);
  const gloss = new THREE.Mesh(filmGeo, glossMat);
  gloss.frustumCulled = false;
  gloss.renderOrder = 4;
  scene.add(gloss);

  const shadowGeo = keep(new THREE.BufferGeometry());
  const shadowPos = new Float32Array(maxSamples * 2 * 3);
  const shadowCoord = new Float32Array(maxSamples * 2 * 3);
  shadowGeo.setIndex(index);
  const shadowPosAttr = new THREE.BufferAttribute(shadowPos, 3).setUsage(THREE.DynamicDrawUsage);
  const shadowCoordAttr = new THREE.BufferAttribute(shadowCoord, 3).setUsage(THREE.DynamicDrawUsage);
  shadowGeo.setAttribute("position", shadowPosAttr);
  shadowGeo.setAttribute("aShadow", shadowCoordAttr);
  const shadowMat = keep(
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SHADOW_VERTEX,
      fragmentShader: SHADOW_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
    }),
  );
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.frustumCulled = false;
  shadow.renderOrder = 1;
  scene.add(shadow);

  const ctrl = new Float32Array(maxPoints * 3);
  const ctrlW = new Float32Array(maxPoints * 3);
  const ctrlF = new Float32Array(maxPoints);
  const sampleP = new Float32Array(maxSamples * 3);
  const sampleW = new Float32Array(maxSamples * 3);
  const sampleF = new Float32Array(maxSamples);
  let sampleCount = 0;
  const rootW = normalize3([-dir[2], 0, dir[0]]);
  const rootSide = [rootW[0], rootW[1], rootW[2]];
  {
    const [dx, , dz] = dir;
    const l = Math.hypot(dx, dz) || 1;
    rootSide[0] = -dz / l;
    rootSide[1] = 0;
    rootSide[2] = dx / l;
  }

  const prevW = [0, 0, 1];
  const prevQ = [0, 1];
  const buildRibbon = () => {
    const n = sim.n;
    const P = sim.pos;
    const W = sim.side;
    let count = 0;
    for (let i = 0; i < n; i += 1) {
      ctrl[count * 3] = P[i * 3];
      ctrl[count * 3 + 1] = P[i * 3 + 1];
      ctrl[count * 3 + 2] = P[i * 3 + 2];
      ctrlW[count * 3] = W[i * 3];
      ctrlW[count * 3 + 1] = W[i * 3 + 1];
      ctrlW[count * 3 + 2] = W[i * 3 + 2];
      ctrlF[count] = i * SEG;
      count += 1;
    }
    const extra = [
      [SLOT, sim.u],
      [[SLOT[0] - dir[0] * LIP_INSIDE, SLOT[1] - dir[1] * LIP_INSIDE, 0], sim.u + LIP_INSIDE],
    ];
    for (const [p, f] of extra) {
      ctrl[count * 3] = p[0];
      ctrl[count * 3 + 1] = p[1];
      ctrl[count * 3 + 2] = p[2];
      ctrlW[count * 3] = rootSide[0];
      ctrlW[count * 3 + 1] = rootSide[1];
      ctrlW[count * 3 + 2] = rootSide[2];
      ctrlF[count] = f;
      count += 1;
    }
    let s = 0;
    const at = (k, c) => ctrl[Math.max(0, Math.min(count - 1, k)) * 3 + c];
    for (let k = 0; k < count - 1; k += 1) {
      const steps = k === count - 2 ? SUB + 1 : SUB;
      for (let j = 0; j < steps; j += 1) {
        const t = j / SUB;
        for (let c = 0; c < 3; c += 1) {
          sampleP[s * 3 + c] = catmull(at(k - 1, c), at(k, c), at(k + 1, c), at(k + 2, c), t);
          sampleW[s * 3 + c] = ctrlW[k * 3 + c] * (1 - t) + ctrlW[(k + 1) * 3 + c] * t;
        }
        sampleF[s] = ctrlF[k] * (1 - t) + ctrlF[k + 1] * t;
        sampleP[s * 3 + 1] = Math.max(0.1, sampleP[s * 3 + 1]);
        s += 1;
      }
    }
    sampleCount = s;
    for (let i = 0; i < s; i += 1) {
      const a = Math.max(0, i - 1);
      const b = Math.min(s - 1, i + 1);
      let tx = sampleP[b * 3] - sampleP[a * 3];
      let ty = sampleP[b * 3 + 1] - sampleP[a * 3 + 1];
      let tz = sampleP[b * 3 + 2] - sampleP[a * 3 + 2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      let wx = sampleW[i * 3];
      let wy = sampleW[i * 3 + 1];
      let wz = sampleW[i * 3 + 2];
      let d = wx * tx + wy * ty + wz * tz;
      wx -= d * tx;
      wy -= d * ty;
      wz -= d * tz;
      let wl = Math.hypot(wx, wy, wz);
      if (i > 0 && wl < 0.4) {
        wx = prevW[0];
        wy = prevW[1];
        wz = prevW[2];
        d = wx * tx + wy * ty + wz * tz;
        wx -= d * tx;
        wy -= d * ty;
        wz -= d * tz;
        wl = Math.hypot(wx, wy, wz);
      }
      wl = wl || 1;
      wx /= wl;
      wy /= wl;
      wz /= wl;
      if (i > 0 && wx * prevW[0] + wy * prevW[1] + wz * prevW[2] < 0) {
        wx = -wx;
        wy = -wy;
        wz = -wz;
      }
      prevW[0] = wx;
      prevW[1] = wy;
      prevW[2] = wz;
      const y = sampleP[i * 3 + 1];
      const f = sampleF[i];
      const lift = smooth(1.5, 14, y);
      const twist = (0.2 * Math.sin(f * 0.019 + 0.8) + 0.08 * Math.sin(f * 0.051 + 2.1)) * lift;
      const cx = ty * wz - tz * wy;
      const cy = tz * wx - tx * wz;
      const cz = tx * wy - ty * wx;
      const ct = Math.cos(twist);
      const st = Math.sin(twist);
      const ex = wx * ct + cx * st;
      const ey = wy * ct + cy * st;
      const ez = wz * ct + cz * st;
      const nx = ey * tz - ez * ty;
      const ny = ez * tx - ex * tz;
      const nz = ex * ty - ey * tx;
      sampleW[i * 3] = ex;
      sampleW[i * 3 + 1] = ey;
      sampleW[i * 3 + 2] = ez;
      const px = sampleP[i * 3];
      const py = sampleP[i * 3 + 1];
      const pz = sampleP[i * 3 + 2];
      const v = i * 6;
      filmPos[v] = px - ex * HALF;
      filmPos[v + 1] = Math.max(0.06, py - ey * HALF);
      filmPos[v + 2] = pz - ez * HALF;
      filmPos[v + 3] = px + ex * HALF;
      filmPos[v + 4] = Math.max(0.06, py + ey * HALF);
      filmPos[v + 5] = pz + ez * HALF;
      filmNormal[v] = nx;
      filmNormal[v + 1] = ny;
      filmNormal[v + 2] = nz;
      filmNormal[v + 3] = nx;
      filmNormal[v + 4] = ny;
      filmNormal[v + 5] = nz;
      const c = i * 4;
      filmCoord[c] = f;
      filmCoord[c + 1] = -HALF;
      filmCoord[c + 2] = f;
      filmCoord[c + 3] = HALF;
      const kx = BOX_DIR[0] / BOX_DIR[1];
      const kz = BOX_DIR[2] / BOX_DIR[1];
      const scx = px - kx * py;
      const scz = pz - kz * py;
      const ptx = tx - kx * ty;
      const ptz = tz - kz * ty;
      const ptl = Math.hypot(ptx, ptz);
      let qx = 0;
      let qz = 1;
      if (ptl > 1e-4) {
        qx = -ptz / ptl;
        qz = ptx / ptl;
      }
      if (i > 0 && qx * prevQ[0] + qz * prevQ[1] < 0) {
        qx = -qx;
        qz = -qz;
      }
      prevQ[0] = qx;
      prevQ[1] = qz;
      const span = Math.abs((ex - kx * ey) * qx + (ez - kz * ey) * qz) * HALF;
      const grow = py * 0.4 + 1.2;
      const half = span + grow;
      shadowPos[v] = scx - qx * half;
      shadowPos[v + 1] = 0.04;
      shadowPos[v + 2] = scz - qz * half;
      shadowPos[v + 3] = scx + qx * half;
      shadowPos[v + 4] = 0.04;
      shadowPos[v + 5] = scz + qz * half;
      const flatness = Math.abs(ny) * smooth(0.4, 0.75, ptl);
      const edgeAt = span / half;
      shadowCoord[v] = -1;
      shadowCoord[v + 1] = py;
      shadowCoord[v + 2] = flatness * edgeAt;
      shadowCoord[v + 3] = 1;
      shadowCoord[v + 4] = py;
      shadowCoord[v + 5] = flatness * edgeAt;
    }
    const tris = (s - 1) * 6;
    filmGeo.setDrawRange(0, tris);
    shadowGeo.setDrawRange(0, tris);
    posAttr.needsUpdate = true;
    normalAttr.needsUpdate = true;
    coordAttr.needsUpdate = true;
    shadowPosAttr.needsUpdate = true;
    shadowCoordAttr.needsUpdate = true;
  };

  let width = 1;
  let height = 1;
  let portrait = false;
  const layoutCamera = () => {
    const rect = host.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    portrait = width / height < 0.9;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const long = portrait ? height : width;
    const short = portrait ? width : height;
    const ppm = Math.min(long / (embedded ? 330 : 360), short / (portrait ? 150 : 185));
    const dist = height / (ppm * 2 * Math.tan((FOV * Math.PI) / 360));
    const wMm = width / ppm;
    const hMm = height / ppm;
    let cx;
    let cz;
    if (portrait) {
      const head = host.parentElement?.querySelector(".film-leader__head");
      const headBottom = head ? head.getBoundingClientRect().bottom - rect.top : 0;
      const fy = embedded ? 0.2 : Math.min(0.42, Math.max(0.3, (headBottom + 12 + 30 * ppm) / height));
      cx = (0.5 - fy) * hMm;
      cz = 0;
      camera.up.set(-1, 0, 0);
      camera.position.set(cx + dist * Math.sin(TILT), dist * Math.cos(TILT), cz);
    } else {
      const fx = embedded ? 0.2 : width >= 900 ? 0.3 : 0.24;
      const fy = embedded ? 0.5 : 0.56;
      cx = (0.5 - fx) * wMm;
      cz = -(fy - 0.5) * hMm;
      camera.up.set(0, 0, -1);
      camera.position.set(cx, dist * Math.cos(TILT), cz + dist * Math.sin(TILT));
    }
    camera.lookAt(cx, 0, cz);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    tableMat.uniforms.uCenter.value.set(cx, cz);
  };

  const restYaw = 0.1;
  sim.layout(restYaw);
  sim.settle(5);
  buildRibbon();

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  const projA = new THREE.Vector3();
  const projB = new THREE.Vector3();

  const planePoint = (clientX, clientY, y) => {
    const rect = host.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    plane.constant = -y;
    const hit = raycaster.ray.intersectPlane(plane, hitPoint);
    return hit ? [hit.x, y, hit.z] : null;
  };

  const toScreen = (x, y, z, out) => {
    out.set(x, y, z).project(camera);
    return [(out.x * 0.5 + 0.5) * width, (-out.y * 0.5 + 0.5) * height, out.z];
  };

  const pick = (clientX, clientY, slop) => {
    const rect = host.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    let best = null;
    let prev = null;
    for (let i = 0; i < sampleCount; i += 1) {
      const px = sampleP[i * 3];
      const py = sampleP[i * 3 + 1];
      const pz = sampleP[i * 3 + 2];
      const c = toScreen(px, py, pz, projA);
      const e = toScreen(px + sampleW[i * 3] * HALF, py + sampleW[i * 3 + 1] * HALF, pz + sampleW[i * 3 + 2] * HALF, projB);
      const cur = { x: c[0], y: c[1], z: c[2], wx: e[0] - c[0], wy: e[1] - c[1], f: sampleF[i] };
      if (prev && cur.f <= sim.u + 0.5) {
        const ax = prev.x;
        const ay = prev.y;
        const bx = cur.x - ax;
        const by = cur.y - ay;
        const len2 = bx * bx + by * by;
        const t = len2 > 1e-6 ? Math.max(0, Math.min(1, ((mx - ax) * bx + (my - ay) * by) / len2)) : 0;
        const qx = ax + bx * t;
        const qy = ay + by * t;
        const wx = prev.wx + (cur.wx - prev.wx) * t;
        const wy = prev.wy + (cur.wy - prev.wy) * t;
        const wl = Math.hypot(wx, wy);
        const dx = mx - qx;
        const dy = my - qy;
        const across = wl > 1e-3 ? (dx * wx + dy * wy) / wl : 0;
        const along = Math.hypot(dx, dy);
        const lateral = Math.sqrt(Math.max(0, along * along - across * across));
        const reach = Math.max(wl, 10);
        if (Math.abs(across) <= reach + slop && lateral <= slop + 3) {
          const z = prev.z + (cur.z - prev.z) * t;
          if (!best || z < best.z) {
            best = { f: prev.f + (cur.f - prev.f) * t, v: (across / Math.max(wl, 1e-3)) * HALF, z };
          }
        }
      }
      prev = cur;
    }
    return best;
  };

  const flipTarget = new Array(16).fill(0);
  const pinned = new Array(16).fill(false);
  let printAll = false;
  let hoverTile = -1;
  const setFlipTargets = () => {
    for (let t = 0; t < 16; t += 1) flipTarget[t] = printAll || pinned[t] || t === hoverTile ? 1 : 0;
  };

  let statusText = "";
  const pushStatus = () => {
    if (!onStatus) return;
    const out = framesOut(sim.u);
    let text;
    if (hoverTile >= 2) text = `Frame ${String(hoverTile - 1).padStart(2, "0")} · ${FRAMES[hoverTile - 2]?.name || ""}`;
    else if (sim.u >= U_MAX - 2) text = "End of roll · light-struck";
    else if (out >= 13) text = "Past 12 · light leak";
    else text = `${String(out).padStart(2, "0")} of 12 frames out`;
    if (text !== statusText) {
      statusText = text;
      onStatus(text);
    }
  };

  let raf = 0;
  let last = 0;
  let visible = true;
  let destroyed = false;
  let simAwake = false;
  let simQuiet = 0;
  const pointer = { id: null, x: 0, y: 0, downX: 0, downY: 0, moved: false, offset: [0, 0], lift: 0, startY: 0, tile: -1, onStrip: false };
  let keyPull = null;

  const running = () => visible && !document.hidden && !destroyed;

  const wake = (physics) => {
    if (physics) {
      simAwake = true;
      simQuiet = 0;
    }
    if (!raf && running()) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  };

  const render = () => {
    renderer.render(scene, camera);
  };

  const easeFlips = (dt) => {
    let moving = false;
    const k = 1 - Math.exp(-dt * (reduced ? 60 : 11));
    for (let t = 0; t < 16; t += 1) {
      const d = flipTarget[t] - flips[t];
      if (Math.abs(d) > 0.002) {
        flips[t] += d * k;
        moving = true;
      } else flips[t] = flipTarget[t];
    }
    return moving;
  };

  const grabTarget = (now, dt) => {
    if (keyPull) {
      if (keyPull.start === null) keyPull.start = now;
      const t = Math.min(1, (now - keyPull.start) / keyPull.ms);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const x = keyPull.from[0] + (keyPull.to[0] - keyPull.from[0]) * e;
      const z = keyPull.from[2] + (keyPull.to[2] - keyPull.from[2]) * e;
      const y = keyPull.from[1] + (GRAB_Y - keyPull.from[1]) * Math.min(1, t * 3);
      if (t >= 1) {
        keyPull = null;
        sim.release();
        return null;
      }
      return [x, y, z];
    }
    if (pointer.id === null || !sim.grab) return null;
    pointer.lift = Math.min(1, pointer.lift + dt * 7);
    const y = pointer.startY + (GRAB_Y - pointer.startY) * (1 - Math.pow(1 - pointer.lift, 3));
    const p = planePoint(pointer.x, pointer.y, y);
    if (!p) return null;
    return [p[0] + pointer.offset[0], y, p[2] + pointer.offset[1]];
  };

  function frame(now) {
    raf = 0;
    if (!running()) return;
    const dt = last ? Math.min(1 / 30, Math.max(1 / 240, (now - last) / 1000)) : 1 / 60;
    last = now;
    if (simAwake) {
      const target = grabTarget(now, dt);
      if (target) sim.moveGrab(target);
      const motion = sim.step(dt);
      buildRibbon();
      if (!sim.grab && Math.abs(sim.u - sim.rest) < 0.5) sim.rewindSpeed = 140;
      const busy = sim.grab || keyPull || motion > 2.5 || Math.abs(sim.u - sim.rest) > 0.4;
      simQuiet = busy ? 0 : simQuiet + 1;
      if (simQuiet > 30) simAwake = false;
    }
    const flipping = easeFlips(dt);
    render();
    pushStatus();
    if (!simAwake && !flipping) return;
    raf = requestAnimationFrame(frame);
  }

  const tileAt = (hit) => {
    if (!hit) return -1;
    const tile = Math.floor(hit.f / PITCH);
    const x = hit.f - tile * PITCH;
    if (tile < 2 || tile > 15) return -1;
    if (x < 1 || x > 37 || Math.abs(hit.v) > 12.4) return -1;
    return tile;
  };

  const setCursor = (state) => {
    if (host.dataset.cursor !== state) host.dataset.cursor = state;
  };

  const onDown = (e) => {
    if (pointer.id !== null) return;
    if (e.button !== undefined && e.button !== 0) return;
    const hit = pick(e.clientX, e.clientY, e.pointerType === "touch" ? 14 : 4);
    if (!hit) return;
    e.preventDefault();
    keyPull = null;
    host.setPointerCapture?.(e.pointerId);
    pointer.id = e.pointerId;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.downX = e.clientX;
    pointer.downY = e.clientY;
    pointer.moved = false;
    pointer.tile = tileAt(hit);
    const i = Math.max(0, Math.min(sim.n - 1, Math.round(hit.f / SEG)));
    const k = i * 3;
    const py = sim.pos[k + 1];
    const ground = planePoint(e.clientX, e.clientY, py);
    pointer.offset = ground ? [sim.pos[k] - ground[0], sim.pos[k + 2] - ground[2]] : [0, 0];
    pointer.startY = py;
    pointer.lift = 0;
    sim.grabAt(i, [sim.pos[k], py, sim.pos[k + 2]]);
    hoverTile = -1;
    setFlipTargets();
    setCursor("grabbing");
    wake(true);
  };

  const onMove = (e) => {
    if (pointer.id === e.pointerId) {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      if (!pointer.moved && Math.hypot(e.clientX - pointer.downX, e.clientY - pointer.downY) > TAP_PX) pointer.moved = true;
      return;
    }
    if (pointer.id !== null || e.pointerType !== "mouse") return;
    const hit = pick(e.clientX, e.clientY, 2);
    setCursor(hit ? "grab" : "idle");
    const tile = tileAt(hit);
    if (tile !== hoverTile) {
      hoverTile = tile;
      setFlipTargets();
      pushStatus();
      wake(false);
    }
  };

  const onUp = (e) => {
    if (pointer.id !== e.pointerId) return;
    const tap = !pointer.moved;
    pointer.id = null;
    sim.release();
    if (tap && pointer.tile >= 2) {
      pinned[pointer.tile] = !pinned[pointer.tile];
      setFlipTargets();
    }
    host.releasePointerCapture?.(e.pointerId);
    setCursor(e.pointerType === "mouse" && pick(e.clientX, e.clientY, 2) ? "grab" : "idle");
    wake(true);
  };

  const onLeave = (e) => {
    if (e.pointerType !== "mouse" || pointer.id !== null) return;
    if (hoverTile !== -1) {
      hoverTile = -1;
      setFlipTargets();
      pushStatus();
      wake(false);
    }
    setCursor("idle");
  };

  const onVisibility = () => {
    if (running()) wake(false);
    else if (!running() && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  host.addEventListener("pointerdown", onDown);
  host.addEventListener("pointermove", onMove);
  host.addEventListener("pointerup", onUp);
  host.addEventListener("pointercancel", onUp);
  host.addEventListener("pointerleave", onLeave);
  document.addEventListener("visibilitychange", onVisibility);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    onVisibility();
  });
  io.observe(host);
  const ro = new ResizeObserver(() => {
    layoutCamera();
    if (!raf) render();
  });
  ro.observe(host);
  const onLost = (e) => e.preventDefault();
  canvas.addEventListener("webglcontextlost", onLost);

  layoutCamera();
  render();
  pushStatus();
  onReady?.();

  return {
    setPrint(value) {
      printAll = value;
      setFlipTargets();
      wake(false);
    },
    key(name) {
      if (name === "pull") {
        if (pointer.id !== null) return;
        const k = 0;
        const from = [sim.pos[k], sim.pos[k + 1], sim.pos[k + 2]];
        const ref = Math.min(sim.n - 1, 8) * 3;
        let hx = sim.pos[k] - sim.pos[ref];
        let hz = sim.pos[k + 2] - sim.pos[ref + 2];
        const hl = Math.hypot(hx, hz) || 1;
        hx /= hl;
        hz /= hl;
        if (hl < 6) {
          hx = 1;
          hz = 0;
        }
        const step = PITCH * 1.4;
        sim.grabAt(0, from);
        keyPull = { start: null, ms: reduced ? 240 : 620, from, to: [from[0] + hx * step, GRAB_Y, from[2] + hz * step] };
        wake(true);
      } else if (name === "rewind") {
        if (pointer.id !== null) return;
        keyPull = null;
        sim.release();
        sim.rewindSpeed = 320;
        wake(true);
      }
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      host.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      io.disconnect();
      ro.disconnect();
      for (const thing of disposables) thing.dispose?.();
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
