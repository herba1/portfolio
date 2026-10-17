import {
  backArt,
  coverArt,
  edgeArt,
  floorArt,
  labelArt,
  loadImage,
  noiseCanvas,
  plyEdge,
  plyFace,
  rng,
  vinylMaps,
} from "./crateArt";
import { SLEEVES } from "./crateSleeves";

const N = SLEEVES.length;
const W = 0.314;
const H = 0.314;
const T = 0.0034;
const DISC_R = 0.151;
const LABEL_R = 0.05;
const GAP = 0.0165;
const FRONT_GAP = 0.122;
const WALL_FRONT = 0.11;
const WALL_BACK = 0.21;
const INNER_W = 0.338;
const PLY = 0.012;
const FLIP = 0.82;
const LEAN = -0.42;
const REST_BACK = -0.3;
const LIFT_MAX = 0.27;
const SLIDE_MAX = 0.168;
const CLEAR = 0.235;
const PULL = 0.065;
const GRAV = 22;
const STEP = 1 / 240;
const VMAX = 11;
const FOV = 30;
const EL = 0.78;
const AZ = -0.16;
const START = 3;
const BG = 0xe9e4dc;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

function spring(s, key, vel, target, omega, zeta, h) {
  const a = omega * omega * (target - s[key]) - 2 * zeta * omega * s[vel];
  s[vel] += a * h;
  s[key] += s[vel] * h;
}

export async function createCrate({
  host,
  root,
  embedded,
  reduced,
  onIndex,
  onReady,
}) {
  const THREE = await import("three");
  const { RoomEnvironment } = await import(
    "three/examples/jsm/environments/RoomEnvironment.js"
  );
  const { RoundedBoxGeometry } = await import(
    "three/examples/jsm/geometries/RoundedBoxGeometry.js"
  );
  await document.fonts?.ready;
  const family =
    getComputedStyle(root).getPropertyValue("--font-sans").trim() ||
    "Inter, system-ui, sans-serif";
  const srcs = [...new Set(SLEEVES.filter((s) => s.src).map((s) => s.src))];
  const imgs = new Map(
    await Promise.all(
      srcs.map((src) => loadImage(src).then((img) => [src, img])),
    ),
  );

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const renderer = new THREE.WebGLRenderer({
    antialias: dpr < 2,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(BG);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.96;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.className = "crate__canvas";
  host.appendChild(canvas);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.Fog(BG, 2.2, 5.5);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 20);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envTarget = pmrem.fromScene(room, 0.03);
  room.dispose?.();
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.24;

  scene.add(new THREE.HemisphereLight(0xfff7ec, 0x8a7f70, 0.55));
  const key = new THREE.DirectionalLight(0xfff1de, 2.7);
  key.castShadow = true;
  const mobile = Math.min(host.clientWidth, host.clientHeight) < 600;
  key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  key.shadow.camera.left = -0.5;
  key.shadow.camera.right = 0.5;
  key.shadow.camera.top = 0.5;
  key.shadow.camera.bottom = -0.5;
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 3;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.0012;
  key.shadow.radius = 4;
  scene.add(key);
  scene.add(key.target);
  const rim = new THREE.DirectionalLight(0xe8eeff, 0.7);
  scene.add(rim);
  scene.add(rim.target);

  const disposables = [];
  const keep = (x) => {
    disposables.push(x);
    return x;
  };
  const tex = (cnv, srgb = true, repeat = null) => {
    const t = keep(new THREE.CanvasTexture(cnv));
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    if (repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat[0], repeat[1]);
    }
    return t;
  };
  const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

  const grain = noiseCanvas(256, 3, 0.8);
  const floorTex = tex(floorArt(512, grain), true, [10, 10]);
  const floor = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(10, 10)),
    keep(new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.92 })),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -PLY - 0.004;
  floor.receiveShadow = true;
  scene.add(floor);

  const hinge = [];
  const jr = rng(21);
  for (let i = 0; i < N; i += 1) {
    const prev = i === 0 ? 0 : hinge[i - 1].z - GAP * (0.82 + jr() * 0.36);
    hinge.push({
      z: prev,
      x: (jr() - 0.5) * 0.008,
      yaw: (jr() - 0.5) * 0.014,
      roll: (jr() - 0.5) * 0.004,
    });
  }
  const zFrontIn = FRONT_GAP;
  const backGap = WALL_BACK * Math.tan(-REST_BACK) + 0.035;
  const zBackIn = hinge[N - 1].z - backGap;
  const frontLimit = Math.atan2(FRONT_GAP - 0.004, WALL_FRONT);
  const backLimit = -Math.atan2(backGap - 0.004, WALL_BACK);
  const eps = hinge.map((h, i) =>
    i === 0
      ? 0
      : Math.atan2(Math.max(0.002, hinge[i - 1].z - h.z - T * 1.05), H),
  );

  const woodFace = tex(plyFace(512, 9, "#d8c09c"), true, [2.2, 2.2]);
  const woodEdge = tex(plyEdge(64), true, [8, 1 / PLY]);
  const woodMat = keep(
    new THREE.MeshStandardMaterial({ map: woodFace, roughness: 0.78 }),
  );
  const woodEdgeMat = keep(
    new THREE.MeshStandardMaterial({ map: woodEdge, roughness: 0.85 }),
  );
  const crate = new THREE.Group();
  scene.add(crate);
  const extrude = (shape) =>
    keep(
      new THREE.ExtrudeGeometry(shape, {
        depth: PLY,
        bevelEnabled: true,
        bevelThickness: 0.0012,
        bevelSize: 0.0012,
        bevelSegments: 2,
        curveSegments: 24,
      }),
    );
  const outerW = INNER_W + PLY * 2;
  const frontShape = new THREE.Shape();
  frontShape.moveTo(-outerW / 2, -PLY);
  frontShape.lineTo(outerW / 2, -PLY);
  frontShape.lineTo(outerW / 2, WALL_FRONT);
  frontShape.lineTo(0.06, WALL_FRONT);
  frontShape.absarc(0, WALL_FRONT, 0.06, 0, -Math.PI, true);
  frontShape.lineTo(-outerW / 2, WALL_FRONT);
  frontShape.closePath();
  const front = new THREE.Mesh(extrude(frontShape), [woodMat, woodEdgeMat]);
  front.position.z = zFrontIn;
  const backShape = new THREE.Shape();
  backShape.moveTo(-outerW / 2, -PLY);
  backShape.lineTo(outerW / 2, -PLY);
  backShape.lineTo(outerW / 2, WALL_BACK);
  backShape.lineTo(-outerW / 2, WALL_BACK);
  backShape.closePath();
  const handle = new THREE.Path();
  handle.moveTo(-0.045, WALL_BACK - 0.045);
  handle.lineTo(0.045, WALL_BACK - 0.045);
  handle.absarc(
    0.045,
    WALL_BACK - 0.06,
    0.015,
    Math.PI / 2,
    -Math.PI / 2,
    true,
  );
  handle.lineTo(-0.045, WALL_BACK - 0.075);
  handle.absarc(
    -0.045,
    WALL_BACK - 0.06,
    0.015,
    -Math.PI / 2,
    Math.PI / 2,
    true,
  );
  backShape.holes.push(handle);
  const back = new THREE.Mesh(extrude(backShape), [woodMat, woodEdgeMat]);
  back.position.z = zBackIn - PLY;
  const zF = zFrontIn + PLY;
  const zB = zBackIn - PLY;
  const sideShape = new THREE.Shape();
  sideShape.moveTo(-zF, -PLY);
  sideShape.lineTo(-zB, -PLY);
  sideShape.lineTo(-zB, WALL_BACK);
  sideShape.bezierCurveTo(
    -zB - (zB - zF) * 0.3,
    WALL_BACK,
    -zF + (zF - zB) * 0.25,
    WALL_FRONT + 0.02,
    -zF,
    WALL_FRONT,
  );
  sideShape.closePath();
  const sideGeo = extrude(sideShape);
  const right = new THREE.Mesh(sideGeo, [woodMat, woodEdgeMat]);
  right.rotation.y = Math.PI / 2;
  right.position.x = INNER_W / 2 + PLY;
  const left = new THREE.Mesh(sideGeo, [woodMat, woodEdgeMat]);
  left.rotation.y = Math.PI / 2;
  left.position.x = -INNER_W / 2;
  const bottom = new THREE.Mesh(
    keep(new THREE.BoxGeometry(INNER_W, PLY, zFrontIn - zBackIn)),
    woodMat,
  );
  bottom.position.set(0, -PLY / 2, (zFrontIn + zBackIn) / 2);
  for (const m of [front, back, right, left, bottom]) {
    m.castShadow = true;
    m.receiveShadow = true;
    crate.add(m);
  }

  const sleeveGeo = keep(new RoundedBoxGeometry(W, H, T, 1, 0.0011));
  sleeveGeo.translate(0, H / 2, 0);
  const edgeTex = tex(edgeArt(256), true, [1, 1]);
  const edgeMat = keep(
    new THREE.MeshStandardMaterial({ map: edgeTex, roughness: 0.9 }),
  );
  const openMat = keep(
    new THREE.MeshStandardMaterial({ color: 0x1b1916, roughness: 0.95 }),
  );
  const discGeo = keep(
    new THREE.CylinderGeometry(DISC_R, DISC_R, 0.0013, 160, 1),
  );
  discGeo.rotateX(Math.PI / 2);
  const vm = vinylMaps(1024, LABEL_R / DISC_R, 0.965);
  const discMat = keep(
    new THREE.MeshPhysicalMaterial({
      color: 0x0c0c0d,
      roughness: 1,
      roughnessMap: tex(vm.rough, false),
      anisotropy: 0.9,
      anisotropyMap: tex(vm.aniso, false),
      ior: 1.6,
      specularIntensity: 1,
      envMap: envTarget.texture,
      envMapIntensity: 0.3,
    }),
  );
  const labelGeo = keep(new THREE.CircleGeometry(LABEL_R, 64));

  const sleeves = [];
  const bigCover = Math.min(host.clientWidth, host.clientHeight) * dpr * 0.5;
  const coverSize = bigCover > 620 ? 1024 : bigCover > 380 ? 768 : 512;
  for (let i = 0; i < N; i += 1) {
    const spec = SLEEVES[i];
    const art = coverArt(
      spec,
      spec.src ? imgs.get(spec.src) : null,
      coverSize,
      101 + i * 17,
      family,
      grain,
    );
    const backCanvas = backArt(
      spec,
      Math.min(512, coverSize),
      101 + i * 17,
      family,
      grain,
      art.map,
    );
    const map = tex(art.map);
    const surf = tex(art.surface, false);
    const backMap = backCanvas === art.map ? map : tex(backCanvas);
    const cut = spec.kind === "diecut";
    const frontMat = keep(
      new THREE.MeshPhysicalMaterial({
        map,
        roughness: 1,
        roughnessMap: surf,
        bumpMap: surf,
        bumpScale: 0.8,
        clearcoat: spec.gloss * 0.3,
        clearcoatRoughness: 0.34,
        alphaTest: cut ? 0.5 : 0,
        side: cut ? THREE.DoubleSide : THREE.FrontSide,
      }),
    );
    const backMat = keep(
      new THREE.MeshPhysicalMaterial({
        map: backMap,
        roughness: 1,
        roughnessMap: surf,
        bumpMap: surf,
        bumpScale: 0.6,
        clearcoat: spec.gloss * 0.35,
        clearcoatRoughness: 0.4,
        alphaTest: cut ? 0.5 : 0,
        side: cut ? THREE.DoubleSide : THREE.FrontSide,
      }),
    );
    const pivot = new THREE.Group();
    pivot.position.set(hinge[i].x, 0, hinge[i].z);
    pivot.rotation.order = "YXZ";
    pivot.rotation.y = hinge[i].yaw;
    pivot.rotation.z = hinge[i].roll;
    const lifter = new THREE.Group();
    pivot.add(lifter);
    const mesh = new THREE.Mesh(sleeveGeo, [
      openMat,
      edgeMat,
      edgeMat,
      edgeMat,
      frontMat,
      backMat,
    ]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.index = i;
    lifter.add(mesh);
    const disc = new THREE.Group();
    disc.position.set(0, H / 2 + 0.001, 0);
    const vinyl = new THREE.Mesh(discGeo, discMat);
    vinyl.castShadow = true;
    vinyl.receiveShadow = true;
    const labelMat = keep(
      new THREE.MeshStandardMaterial({
        map: tex(labelArt(spec, 512, family)),
        roughness: 0.62,
      }),
    );
    const labelA = new THREE.Mesh(labelGeo, labelMat);
    labelA.position.z = 0.00068;
    const labelB = new THREE.Mesh(labelGeo, labelMat);
    labelB.position.z = -0.00068;
    labelB.rotation.y = Math.PI;
    disc.add(vinyl, labelA, labelB);
    disc.visible = cut;
    lifter.add(disc);
    scene.add(pivot);
    sleeves.push({
      i,
      pivot,
      lifter,
      mesh,
      disc,
      cut,
      th: 0,
      om: 0,
      lift: 0,
      lv: 0,
      slide: 0,
      sv: 0,
      spin: 0,
      target: 0,
    });
    if (i % 3 === 2) await yieldFrame();
  }

  const state = {
    p: reduced ? START : 0,
    pv: 0,
    pT: reduced ? START : 0,
    mode: "idle",
    hold: false,
    hover: -1,
    liftIdx: -1,
    liftDrag: 0,
    shown: -1,
  };
  for (const s of sleeves) {
    s.th = targetAngle(s.i);
    s.target = s.th;
  }
  for (let k = 0; k < 6; k += 1) constrain(false);
  const cam = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    d: 1,
    vd: 0,
    ready: false,
  };
  const view = { w: 1, h: 1, top: 0, bottom: 0 };
  const pointer = {
    id: -1,
    x: 0,
    y: 0,
    sx: 0,
    sy: 0,
    down: false,
    moved: false,
    hit: -1,
    lastX: 0,
    lastY: 0,
    p0: 0,
    lift0: 0,
    vel: 0,
    lvel: 0,
    prevP: 0,
    prevL: 0,
  };
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let raf = 0;
  let last = 0;
  let acc = 0;
  let active = false;
  let destroyed = false;
  let wheelTimer = 0;
  let introTimer = 0;
  let moved = 1;

  function revealed() {
    return clamp(Math.round(state.p), 0, N - 1);
  }

  function targetAngle(i) {
    const d = state.p - i;
    const press = state.mode === "dig" ? 0.07 : 0;
    if (d >= 1) return FLIP + 0.035 * Math.min(d - 1, 3);
    if (d >= 0) {
      const s = smooth(0.12, 0.92, d);
      return LEAN - press * (1 - s) + (FLIP - LEAN + press) * s;
    }
    const b = smooth(-1.4, 0, d);
    return REST_BACK + (LEAN - REST_BACK) * b - press * b;
  }

  function constrain(withVel) {
    const first = sleeves[0];
    if (first.th > frontLimit) {
      first.th = frontLimit;
      if (withVel && first.om > 0) first.om *= -0.15;
    }
    const lastS = sleeves[N - 1];
    if (lastS.th < backLimit) {
      lastS.th = backLimit;
      if (withVel && lastS.om < 0) lastS.om *= -0.15;
    }
    for (let i = 1; i < N; i += 1) {
      const a = sleeves[i - 1];
      const b = sleeves[i];
      if (a.lift > 0.02 || b.lift > 0.02) continue;
      const over = b.th - a.th - eps[i];
      if (over > 0) {
        const wa = i - 1 === 0 && a.th >= frontLimit - 1e-4 ? 0 : 0.5;
        const wb = i === N - 1 && b.th <= backLimit + 1e-4 ? 0 : 1 - wa;
        a.th += over * wa;
        b.th -= over * (wa === 0 ? 1 : wb);
        if (withVel) {
          if (b.om > a.om) {
            const m = (a.om + b.om) / 2;
            a.om = m;
            b.om = m;
          }
        }
      }
    }
  }

  function physics(h) {
    const dig = state.mode === "dig";
    if (!dig) {
      const omega = 10;
      spring(state, "p", "pv", state.pT, omega, 1, h);
      if (Math.abs(state.pv) > VMAX) state.pv = Math.sign(state.pv) * VMAX;
    }
    const lifting = state.liftIdx;
    for (const s of sleeves) {
      s.target = targetAngle(s.i);
      const isLift = s.i === lifting;
      let tgt = s.target;
      if (s.lift > 0.002) tgt = LEAN - 0.04 * clamp(s.lift / LIFT_MAX, 0, 1);
      const a =
        112 * (tgt - s.th) -
        2 * 0.86 * Math.sqrt(112) * s.om +
        GRAV * Math.sin(s.th) * 0.5;
      s.om += a * h;
      s.th += s.om * h;
      let lt = 0;
      if (isLift) {
        if (state.mode === "lift") lt = state.liftDrag;
        else if (state.hold) lt = LIFT_MAX;
        else if (state.hover === s.i) lt = 0.007;
      } else if (state.hover === s.i && state.mode === "idle" && !state.hold)
        lt = 0.007;
      const slideFrac = s.slide / SLIDE_MAX;
      lt = Math.max(lt, CLEAR * smooth(0, 0.35, slideFrac));
      const grabbing = isLift && state.mode === "lift";
      spring(s, "lift", "lv", lt, grabbing ? 26 : 8.5, grabbing ? 1 : 0.94, h);
      if (s.lift < 0) {
        s.lift = 0;
        if (s.lv < 0) s.lv = 0;
      }
      const holding = isLift && (state.mode === "lift" || state.hold);
      const st = holding ? SLIDE_MAX * smooth(0.5, 0.97, s.lift / LIFT_MAX) : 0;
      spring(s, "slide", "sv", st, holding ? 6.5 : 8, 1, h);
      if (s.slide < 0) {
        s.slide = 0;
        if (s.sv < 0) s.sv = 0;
      }
    }
    constrain(true);
  }

  function snapAll() {
    state.p = state.pT;
    state.pv = 0;
    for (const s of sleeves) {
      s.th = targetAngle(s.i);
      s.om = 0;
      const isLift = s.i === state.liftIdx;
      const want = isLift && (state.hold || state.mode === "lift");
      s.lift = want ? (state.mode === "lift" ? state.liftDrag : LIFT_MAX) : 0;
      s.lv = 0;
      s.slide = want ? SLIDE_MAX * smooth(0.5, 0.97, s.lift / LIFT_MAX) : 0;
      s.sv = 0;
    }
    for (let k = 0; k < 8; k += 1) constrain(false);
  }

  function camGoal() {
    const fi = clamp(state.p, 0, N - 1);
    const i0 = Math.floor(fi);
    const i1 = Math.min(N - 1, i0 + 1);
    const z = hinge[i0].z + (hinge[i1].z - hinge[i0].z) * (fi - i0);
    let lift = 0;
    let slide = 0;
    for (const s of sleeves) {
      if (s.lift > lift) lift = s.lift;
      if (s.slide > slide) slide = s.slide;
    }
    const lf = clamp(lift / LIFT_MAX, 0, 1);
    const sideways = view.w / view.h > 1.1 ? 0.45 : 0.3;
    return {
      x: slide * sideways,
      y: 0.08 + lift * 0.66,
      z: z + 0.015 - lf * 0.06,
      d: fitDistance(lf, slide / SLIDE_MAX),
    };
  }

  function fitDistance(lf, sf) {
    const tanH = Math.tan(((FOV / 2) * Math.PI) / 180);
    const availH = Math.max(120, view.h - view.top - view.bottom);
    const aspect = view.w / availH;
    const needH = (embedded ? 0.6 : 0.64) + lf * 0.14;
    const needW = (view.w < 600 ? 0.5 : 0.52) + sf * 0.16;
    const frac = availH / view.h;
    return Math.max(
      needH / (2 * tanH * frac),
      needW / (2 * tanH * aspect * frac),
    );
  }

  function placeCamera() {
    const ce = Math.cos(EL);
    const dir = new THREE.Vector3(
      Math.sin(AZ) * ce,
      Math.sin(EL),
      Math.cos(AZ) * ce,
    );
    camera.position.set(
      cam.x + dir.x * cam.d,
      cam.y + dir.y * cam.d,
      cam.z + dir.z * cam.d,
    );
    camera.lookAt(cam.x, cam.y, cam.z);
    const shift = (view.top - view.bottom) / 2;
    camera.setViewOffset(view.w, view.h, 0, -shift, view.w, view.h);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    key.position.set(cam.x - 0.55, cam.y + 1.25, cam.z + 0.95);
    key.target.position.set(cam.x, 0.1, cam.z - 0.02);
    rim.position.set(cam.x + 0.7, cam.y + 0.6, cam.z - 1.1);
    rim.target.position.set(cam.x, 0.1, cam.z);
    key.target.updateMatrixWorld();
    rim.target.updateMatrixWorld();
  }

  function stepCamera(h) {
    const g = camGoal();
    if (!cam.ready || reduced) {
      Object.assign(cam, {
        x: g.x,
        y: g.y,
        z: g.z,
        d: g.d,
        vx: 0,
        vy: 0,
        vz: 0,
        vd: 0,
        ready: true,
      });
      return;
    }
    spring(cam, "x", "vx", g.x, 5, 1, h);
    spring(cam, "y", "vy", g.y, 5.5, 1, h);
    spring(cam, "z", "vz", g.z, 5.5, 1, h);
    spring(cam, "d", "vd", g.d, 4.5, 1, h);
  }

  function sync() {
    moved = 0;
    for (const s of sleeves) {
      moved = Math.max(
        moved,
        Math.abs(s.th - s.pivot.rotation.x),
        Math.abs(s.lift - s.lifter.position.y),
        Math.abs(s.slide - s.disc.position.x),
      );
      s.pivot.rotation.x = s.th;
      s.lifter.position.y = s.lift;
      s.pivot.position.z =
        hinge[s.i].z + PULL * smooth(0, 0.6, s.lift / LIFT_MAX);
      s.disc.position.x = s.slide;
      s.disc.rotation.z = (-s.slide / DISC_R) * 0.3;
      s.disc.visible = s.cut || s.slide > 0.0005;
    }
    placeCamera();
    const idx = revealed();
    if (idx !== state.shown) {
      state.shown = idx;
      onIndex?.(idx);
    }
  }

  function busy() {
    if (state.mode !== "idle") return true;
    if (Math.abs(state.p - state.pT) > 1e-4 || Math.abs(state.pv) > 1e-3)
      return true;
    if (moved > 2e-5) return true;
    for (const s of sleeves) {
      if (Math.abs(s.lv) > 1e-4 || Math.abs(s.sv) > 1e-4) return true;
    }
    const g = camGoal();
    return (
      Math.abs(cam.x - g.x) +
        Math.abs(cam.y - g.y) +
        Math.abs(cam.z - g.z) +
        Math.abs(cam.d - g.d) >
        1e-4 || Math.abs(cam.vz) + Math.abs(cam.vy) > 1e-4
    );
  }

  function pxPerRecord() {
    return clamp(view.h * 0.085, 44, 84);
  }

  function pxPerMeter() {
    const tanH = Math.tan(((FOV / 2) * Math.PI) / 180);
    return view.h / (2 * cam.d * tanH);
  }

  function readPointer(h) {
    if (!pointer.down) return;
    if (state.mode === "dig") {
      const dy = pointer.y - pointer.sy;
      const dx = pointer.x - pointer.sx;
      let p = pointer.p0 + (dy - dx * 0.6) / pxPerRecord();
      if (p < 0) p = -0.5 * Math.tanh(-p / 0.5);
      if (p > N - 1) p = N - 1 + 0.5 * Math.tanh((p - (N - 1)) / 0.5);
      const v = (p - state.p) / h;
      pointer.vel = pointer.vel * 0.6 + clamp(v, -40, 40) * 0.4;
      state.p = p;
      state.pv = pointer.vel;
      state.pT = p;
    } else if (state.mode === "lift") {
      let l = pointer.lift0 + -(pointer.y - pointer.sy) / (pxPerMeter() * 0.92);
      if (l > LIFT_MAX) l = LIFT_MAX + 0.06 * Math.tanh((l - LIFT_MAX) / 0.06);
      if (l < 0) l = -0.02 * Math.tanh(-l / 0.02);
      state.liftDrag = l;
    }
  }

  function frame(now) {
    raf = 0;
    if (destroyed || !active) return;
    const dt = last ? clamp((now - last) / 1000, 0, 1 / 20) : 1 / 60;
    last = now;
    readPointer(Math.max(dt, 1 / 240));
    if (reduced) {
      snapAll();
      stepCamera(dt);
    } else {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 24) {
        physics(STEP);
        acc -= STEP;
        n += 1;
      }
      stepCamera(dt);
    }
    sync();
    renderer.render(scene, camera);
    if (busy() && !reduced) raf = requestAnimationFrame(frame);
    else last = 0;
  }

  function wake() {
    if (destroyed || !active || raf) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function layout() {
    view.w = Math.max(1, host.clientWidth);
    view.h = Math.max(1, host.clientHeight);
    if (embedded) {
      view.top = 0;
      view.bottom = 0;
    } else {
      const head = root.querySelector(".crate__head");
      const base = root.getBoundingClientRect().top;
      view.top = head
        ? Math.max(
            96,
            head.getBoundingClientRect().bottom -
              base +
              (view.w < 600 ? 28 : 8),
          )
        : 136;
      view.bottom = 24;
    }
    renderer.setPixelRatio(dpr);
    renderer.setSize(view.w, view.h, false);
    camera.aspect = view.w / view.h;
    const g = camGoal();
    if (!cam.ready) Object.assign(cam, { ...g, ready: true });
    else cam.d = g.d;
    placeCamera();
  }

  function setPointer(e) {
    const r = canvas.getBoundingClientRect();
    pointer.x = e.clientX - r.left;
    pointer.y = e.clientY - r.top;
  }

  function hitTest() {
    ndc.set((pointer.x / view.w) * 2 - 1, -(pointer.y / view.h) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(
      sleeves.map((s) => s.mesh),
      false,
    );
    return hits.length ? hits[0].object.userData.index : -1;
  }

  function startLift(i) {
    if (state.liftIdx !== i) {
      state.liftIdx = i;
    }
  }

  function onDown(e) {
    if (pointer.down) return;
    if (e.button !== undefined && e.button !== 0) return;
    setPointer(e);
    pointer.down = true;
    pointer.id = e.pointerId;
    pointer.sx = pointer.x;
    pointer.sy = pointer.y;
    pointer.moved = false;
    pointer.vel = 0;
    pointer.hit = hitTest();
    canvas.setPointerCapture?.(e.pointerId);
    host.setAttribute("data-grabbing", "");
    const lifted = sleeves.find((s) => s.lift > 0.02);
    if (lifted && (pointer.hit === lifted.i || state.hold)) {
      state.liftIdx = lifted.i;
      state.mode = "lift";
      state.hold = false;
      pointer.lift0 = lifted.lift;
      state.liftDrag = lifted.lift;
    } else {
      state.mode = "pending";
    }
    wake();
  }

  function onMove(e) {
    if (!pointer.down) {
      if (e.pointerType !== "mouse") return;
      setPointer(e);
      const h = hitTest();
      const hv = h === revealed() ? h : -1;
      if (hv !== state.hover) {
        state.hover = hv;
        if (hv >= 0 && state.liftIdx < 0) state.liftIdx = hv;
        host.toggleAttribute("data-over", hv >= 0);
        wake();
      }
      return;
    }
    if (e.pointerId !== pointer.id) return;
    setPointer(e);
    const dx = pointer.x - pointer.sx;
    const dy = pointer.y - pointer.sy;
    if (state.mode === "pending" && Math.hypot(dx, dy) > 6) {
      pointer.moved = true;
      const onCover =
        pointer.hit >= 0 &&
        pointer.hit === revealed() &&
        Math.abs(state.p - Math.round(state.p)) < 0.3;
      if (onCover && dy < 0 && Math.abs(dy) > Math.abs(dx)) {
        startLift(pointer.hit);
        state.mode = "lift";
        state.hold = false;
        pointer.lift0 = sleeves[pointer.hit].lift;
        state.liftDrag = pointer.lift0;
        pointer.sy = pointer.y;
      } else {
        state.mode = "dig";
        state.hover = -1;
        pointer.p0 = state.p;
        pointer.sx = pointer.x;
        pointer.sy = pointer.y;
      }
    } else if (Math.hypot(dx, dy) > 6) pointer.moved = true;
    wake();
  }

  function onUp(e) {
    if (!pointer.down || (e && e.pointerId !== pointer.id)) return;
    pointer.down = false;
    host.removeAttribute("data-grabbing");
    if (state.mode === "dig") {
      const v = clamp(state.pv, -VMAX, VMAX);
      const projected = state.p + v * 0.2;
      state.pT = clamp(Math.round(projected), 0, N - 1);
      state.pv = v;
    } else if (state.mode === "lift") {
      state.hold = false;
      const s = sleeves[state.liftIdx];
      if (s) s.lv = clamp(s.lv, -1.5, 1.5);
    } else if (state.mode === "pending" && !pointer.moved) {
      tap(pointer.hit);
    }
    state.mode = "idle";
    wake();
  }

  function tap(i) {
    if (i < 0) return;
    const r = revealed();
    if (i === r && Math.abs(state.p - r) < 0.3) {
      startLift(i);
      state.hold = !state.hold;
    } else {
      state.hold = false;
      state.pT = i;
    }
  }

  function onLeave() {
    if (pointer.down) return;
    if (state.hover !== -1) {
      state.hover = -1;
      host.removeAttribute("data-over");
      wake();
    }
  }

  function onWheel(e) {
    if (embedded) return;
    e.preventDefault();
    if (state.hold || sleeves.some((s) => s.lift > 0.02)) {
      state.hold = false;
      wake();
      return;
    }
    const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
    const delta = clamp((e.deltaY + e.deltaX) * unit, -120, 120);
    state.pT = clamp(state.pT + delta / 110, 0, N - 1);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      state.pT = clamp(Math.round(state.pT + state.pv * 0.04), 0, N - 1);
      wake();
    }, 140);
    wake();
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  const ro = new ResizeObserver(() => {
    layout();
    if (active) {
      sync();
      renderer.render(scene, camera);
    }
  });

  layout();
  sync();
  ro.observe(host);
  onReady?.();

  return {
    setActive(next) {
      if (active === next) return;
      active = next;
      if (active) {
        sync();
        renderer.render(scene, camera);
        wake();
        if (!introTimer && state.pT === 0 && !reduced) {
          introTimer = setTimeout(() => {
            state.pT = START;
            wake();
          }, 380);
        }
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    step(dir) {
      state.hold = false;
      state.pT = clamp(Math.round(state.pT) + dir, 0, N - 1);
      wake();
    },
    go(i) {
      state.hold = false;
      state.pT = clamp(i, 0, N - 1);
      wake();
    },
    toggleLift() {
      const i = clamp(Math.round(state.pT), 0, N - 1);
      startLift(i);
      state.pT = i;
      state.hold = !state.hold;
      wake();
    },
    drop() {
      state.hold = false;
      wake();
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(wheelTimer);
      clearTimeout(introTimer);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      for (const d of disposables) d.dispose();
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
