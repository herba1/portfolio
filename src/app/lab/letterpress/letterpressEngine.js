import { createInk } from "./letterpressInk";
import { PRINT_FRAGMENT, PRINT_VERTEX, injectPaper, injectSort } from "./letterpressShader";
import { ironCanvas, slabInkCanvas, tableCanvas, tympanCanvas, woodCanvas } from "./letterpressTextures";
import {
  MAX_CHARS,
  SLOT,
  SLOTS,
  SLOT_COLS,
  SLOT_ROWS,
  createGlyphPainter,
  createMeasurer,
  layoutLine,
  readyFonts,
  slotRect,
  sortWidthEm,
  writeSlot,
} from "./letterpressType";

const BED_TOP = 0.3;
const TYPE_HIGH = 0.533;
const FURN_TOP = 0.47;
const HINGE_Y = 0.537;
const HINGE_Z = -0.9;
const LID_X = 1.78;
const LID_Z0 = 0.06;
const LID_Z1 = 1.78;
const LID_T = 0.1;
const SHEET_W = 2.8;
const SHEET_D = 1.15;
const SHEET_Z0 = 0.325;
const SHEET_Z1 = SHEET_Z0 + SHEET_D;
const SHEET_Y = -0.0032;
const LEVER_X = 2.0;
const LEVER_LEN = 2.3;
const GRIP_LOCAL = [LEVER_X + 0.22, 0.04, LEVER_LEN - 0.06];
const OPEN = 1.92;
const CONTACT = 0.03;
const CHASE_IN_X = 1.56;
const CHASE_IN_Z = 0.58;
const ROLLER_R = 0.13;
const ROLLER_L = 1.0;
const STACK_MAX = 5;
const POOL = STACK_MAX + 2;
const PRINT_W = 1536;
const PRINT_H = 632;
const SUB = 1 / 240;
const EL = (55 * Math.PI) / 180;
const FOV = 26;
const BRIDGE = 0.5;
const ROWS = 44;
const COLS = 10;
const INERTIA = 2.2;
const K_RET = 10;
const R_BUILD = 16;
const C_FREE = 5.8;
const K_DRAG = 900;
const C_DRAG = 52;
const K_C = 4200;
const C_C = 14;
const P_REF = 82;
const TACK = 20;
const PAPER_RGB = [0.9, 0.878, 0.82];
const INK_RGB = [0.011, 0.0105, 0.012];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => clamp(v, 0, 1);
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const smoother = (x) => {
  const t = clamp01(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);

function mulberry(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function impressionWord(p) {
  if (p < 0.22) return "kiss impression";
  if (p < 0.55) return "light impression";
  if (p < 0.92) return "firm impression";
  return "deep impression";
}

export async function createLetterpress({ host, embedded, reduced, insets, text, face, onStatus, onText }) {
  const THREE = await import("three");
  const { RoundedBoxGeometry } = await import("three/examples/jsm/geometries/RoundedBoxGeometry.js");
  const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
  const fonts = await readyFonts();
  const measure = createMeasurer(fonts);
  const paint = createGlyphPainter(fonts);
  const rand = mulberry(20261017);

  const renderer = new THREE.WebGLRenderer({ antialias: (window.devicePixelRatio || 1) < 2, powerPreference: "high-performance" });
  renderer.setClearColor(0xd8d6d0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const canvas = renderer.domElement;
  canvas.className = "letterpress-canvas";
  host.appendChild(canvas);
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 80);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envTarget = pmrem.fromScene(room, 0.04);
  room.dispose?.();
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.5;

  const hemi = new THREE.HemisphereLight(0xf7f4ee, 0x8d877b, 0.72);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff0de, 2.7);
  key.position.set(-5.4, 4.6, 2.2);
  key.target.position.set(0, 0, 0.3);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const sc = key.shadow.camera;
  sc.left = -4.4;
  sc.right = 4.4;
  sc.top = 4.4;
  sc.bottom = -4.4;
  sc.near = 0.5;
  sc.far = 20;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.008;
  key.shadow.radius = 4;
  key.shadow.blurSamples = 8;
  scene.add(key);
  scene.add(key.target);
  const lightDir = new THREE.Vector3().subVectors(key.position, key.target.position).normalize();

  const disposables = [];
  const keep = (x) => {
    disposables.push(x);
    return x;
  };
  const canvasTex = (cnv, srgb, repeat) => {
    const t = keep(new THREE.CanvasTexture(cnv));
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = anisotropy;
    if (repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat[0], repeat[1]);
    }
    return t;
  };

  const tableTex = canvasTex(tableCanvas(512, 7), true, [12, 12]);
  const ironTex = canvasTex(ironCanvas(256, 3), false, [2, 2]);
  const ironTexFine = canvasTex(ironCanvas(256, 5), false, [5, 5]);
  const beechTex = canvasTex(woodCanvas(256, 256, 11, [222, 196, 156]), true, [1, 1]);
  const mapleTex = canvasTex(woodCanvas(256, 256, 17, [206, 160, 104]), true, [1, 1]);
  const walnutTex = canvasTex(woodCanvas(128, 256, 23, [108, 70, 44]), true, [1, 1]);
  const tympanTex = canvasTex(tympanCanvas(512, 256, 29), true, null);
  const slabTex = canvasTex(slabInkCanvas(256, 256, 31), false, null);

  const tableMat = keep(new THREE.MeshStandardMaterial({ map: tableTex, roughness: 0.94, metalness: 0 }));
  const ironMat = keep(
    new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.62, roughness: 0.5, roughnessMap: ironTex, bumpMap: ironTexFine, bumpScale: 0.12 }),
  );
  const ironDarkMat = keep(new THREE.MeshStandardMaterial({ color: 0x2c2e31, metalness: 0.55, roughness: 0.62, roughnessMap: ironTexFine }));
  const chaseMat = keep(
    new THREE.MeshStandardMaterial({ color: 0x5b5e61, metalness: 0.85, roughness: 0.4, roughnessMap: ironTexFine, bumpMap: ironTexFine, bumpScale: 0.3 }),
  );
  const steelMat = keep(new THREE.MeshStandardMaterial({ color: 0xa4a7aa, metalness: 1, roughness: 0.28 }));
  const beechMat = keep(new THREE.MeshStandardMaterial({ map: beechTex, roughness: 0.74 }));
  const mapleMat = keep(new THREE.MeshStandardMaterial({ map: mapleTex, roughness: 0.52 }));
  const walnutMat = keep(new THREE.MeshPhysicalMaterial({ map: walnutTex, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.3 }));
  const tympanMat = keep(new THREE.MeshStandardMaterial({ map: tympanTex, roughness: 0.6 }));
  const rollerMat = keep(new THREE.MeshPhysicalMaterial({ color: 0x0c0c0d, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.08 }));
  const slabInkMat = keep(
    new THREE.MeshPhysicalMaterial({
      color: 0x0b0b0c,
      roughness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      alphaMap: slabTex,
      transparent: true,
      bumpMap: slabTex,
      bumpScale: 0.8,
      depthWrite: false,
    }),
  );
  const hidden = keep(new THREE.MeshBasicMaterial({ visible: false }));

  const geos = new Map();
  const box = (w, h, d, r = 0) => {
    const k = `b${w}:${h}:${d}:${r}`;
    if (!geos.has(k)) geos.set(k, r > 0 ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d));
    return geos.get(k);
  };
  const add = (geo, mat, x, y, z, parent = scene, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const cylX = (r, len, seg = 24) => {
    const g = keep(new THREE.CylinderGeometry(r, r, len, seg));
    g.rotateZ(Math.PI / 2);
    return g;
  };

  const tableGeo = keep(new THREE.PlaneGeometry(40, 40));
  tableGeo.rotateX(-Math.PI / 2);
  const table = add(tableGeo, tableMat, 0, 0, 0, scene, false);
  table.castShadow = false;

  add(box(4.06, 0.12, 2.06, 0.03), ironDarkMat, 0, 0.06, 0);
  add(box(3.7, 0.18, 1.7, 0.025), ironMat, 0, 0.21, 0);
  add(box(3.32, 0.2, 0.1, 0.012), chaseMat, 0, 0.4, -0.63);
  add(box(3.32, 0.2, 0.1, 0.012), chaseMat, 0, 0.4, 0.63);
  add(box(0.1, 0.2, 1.16, 0.012), chaseMat, -1.61, 0.4, 0);
  add(box(0.1, 0.2, 1.16, 0.012), chaseMat, 1.61, 0.4, 0);
  add(box(0.12, 0.52, 0.22, 0.02), ironMat, -1.86, 0.38, HINGE_Z);
  add(box(0.12, 0.52, 0.22, 0.02), ironMat, 1.86, 0.38, HINGE_Z);
  add(cylX(0.036, 4.08), steelMat, 0, HINGE_Y, HINGE_Z);

  const furniture = [0, 1, 2, 3].map(() => add(box(1, 1, 1), beechMat, 0, (BED_TOP + FURN_TOP) / 2, 0));
  const quoins = [-0.26, 0.26].map((z) => add(box(0.1, 0.13, 0.34), steelMat, 1.49, BED_TOP + 0.065, z));

  const lid = new THREE.Group();
  lid.position.set(0, HINGE_Y, HINGE_Z);
  scene.add(lid);
  const lidLen = LID_Z1 - LID_Z0;
  add(box(LID_X * 2, LID_T, lidLen, 0.02), ironMat, 0, LID_T / 2, (LID_Z0 + LID_Z1) / 2, lid);
  add(box(LID_X * 2, 0.06, 0.08, 0.015), ironMat, 0, LID_T + 0.03, LID_Z0 + 0.04, lid);
  add(box(LID_X * 2, 0.06, 0.08, 0.015), ironMat, 0, LID_T + 0.03, LID_Z1 - 0.04, lid);
  add(box(0.08, 0.06, lidLen, 0.015), ironMat, -LID_X + 0.04, LID_T + 0.03, (LID_Z0 + LID_Z1) / 2, lid);
  add(box(0.08, 0.06, lidLen, 0.015), ironMat, LID_X - 0.04, LID_T + 0.03, (LID_Z0 + LID_Z1) / 2, lid);
  add(box(0.07, 0.05, lidLen, 0.012), ironMat, -0.62, LID_T + 0.025, (LID_Z0 + LID_Z1) / 2, lid);
  add(box(0.07, 0.05, lidLen, 0.012), ironMat, 0.62, LID_T + 0.025, (LID_Z0 + LID_Z1) / 2, lid);
  add(box(LID_X * 2, 0.05, 0.07, 0.012), ironMat, 0, LID_T + 0.025, (LID_Z0 + LID_Z1) / 2, lid);
  add(cylX(0.075, 0.5), ironMat, -1.32, 0, 0, lid);
  add(cylX(0.075, 0.5), ironMat, 1.32, 0, 0, lid);
  add(cylX(0.075, 0.6), ironMat, 0, 0, 0, lid);
  const tympanGeo = keep(new THREE.PlaneGeometry(3.24, 1.5));
  tympanGeo.rotateX(Math.PI / 2);
  add(tympanGeo, tympanMat, 0, -0.0012, 0.93, lid, false);
  add(cylX(0.013, 3.34, 12), steelMat, 0, -0.008, 0.19, lid);
  add(cylX(0.013, 3.34, 12), steelMat, 0, -0.008, 1.67, lid);
  add(box(0.12, 0.014, 0.035), steelMat, -0.85, -0.008, SHEET_Z1 + 0.017, lid);
  add(box(0.12, 0.014, 0.035), steelMat, 0.85, -0.008, SHEET_Z1 + 0.017, lid);
  add(box(0.07, 0.08, LEVER_LEN, 0.02), ironMat, LEVER_X, 0.04, LEVER_LEN / 2, lid);
  add(cylX(0.095, 0.14), ironMat, LEVER_X, 0, 0, lid);
  add(box(0.1, 0.06, 0.12), ironMat, (LID_X + LEVER_X) / 2, 0.05, 0.2, lid);
  const gripProfile = [
    [0.0, 0.0],
    [0.034, 0.0],
    [0.036, 0.04],
    [0.05, 0.06],
    [0.062, 0.16],
    [0.064, 0.24],
    [0.058, 0.33],
    [0.048, 0.39],
    [0.03, 0.42],
    [0.0, 0.425],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const gripGeo = keep(new THREE.LatheGeometry(gripProfile, 32));
  gripGeo.rotateZ(-Math.PI / 2);
  add(gripGeo, walnutMat, LEVER_X + 0.035, 0.04, LEVER_LEN - 0.06, lid);
  const leverProxy = add(box(0.7, 0.4, 1.3), hidden, LEVER_X + 0.16, 0.04, LEVER_LEN - 0.55, lid, false);
  const lidProxy = add(box(LID_X * 2, 0.24, lidLen), hidden, 0, 0.05, (LID_Z0 + LID_Z1) / 2, lid, false);

  const glyphBytes = new Uint8Array(SLOT * SLOT_COLS * SLOT * SLOT_ROWS * 4);
  const glyphTex = keep(new THREE.DataTexture(glyphBytes, SLOT * SLOT_COLS, SLOT * SLOT_ROWS, THREE.RGBAFormat, THREE.UnsignedByteType));
  glyphTex.minFilter = THREE.LinearFilter;
  glyphTex.magFilter = THREE.LinearFilter;
  glyphTex.generateMipmaps = false;
  glyphTex.needsUpdate = true;
  const ink = createInk();
  const inkTex = keep(new THREE.DataTexture(ink.bytes, ink.width, ink.height, THREE.RedFormat, THREE.UnsignedByteType));
  inkTex.minFilter = THREE.LinearFilter;
  inkTex.magFilter = THREE.LinearFilter;
  inkTex.generateMipmaps = false;
  inkTex.unpackAlignment = 1;
  inkTex.needsUpdate = true;

  const shared = {
    uGlyph: { value: glyphTex },
    uInkTex: { value: inkTex },
    uLightV: { value: new THREE.Vector3() },
    uInkCol: { value: new THREE.Vector3(...INK_RGB) },
  };

  const sortBodyGeo = keep(new THREE.BoxGeometry(1, 1, 1));
  sortBodyGeo.translate(0, -0.5, 0);
  const faceGeo = keep(new THREE.PlaneGeometry(1, 1));
  faceGeo.rotateX(-Math.PI / 2);

  const freeSlots = Array.from({ length: SLOTS }, (_, i) => SLOTS - 1 - i);
  let sorts = [];
  let body = 0.78;
  let bodyTarget = 0.78;
  let bodyVel = 0;
  let currentFace = face === "italic" ? "italic" : "gothic";
  let currentText = "";

  function makeSort(ch, style, seedBase) {
    const slot = freeSlots.pop();
    if (slot == null) return null;
    const widthEm = sortWidthEm(ch, style, measure);
    const glyph = paint(ch, style, widthEm);
    writeSlot(glyphBytes, slot, glyph);
    glyphTex.needsUpdate = true;
    ink.setMask(slot, glyph.low);
    const isSpace = ch === " ";
    const bodyMesh = new THREE.Mesh(sortBodyGeo, mapleMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    scene.add(bodyMesh);
    let top = null;
    let uniforms = null;
    let mat = null;
    if (!isSpace) {
      const r = slotRect(slot);
      uniforms = {
        ...shared,
        uSlot: { value: new THREE.Vector4(r[0], r[1], r[2], r[3]) },
        uSize: { value: new THREE.Vector2(0.5, 0.78) },
        uSeed: { value: seedBase },
        uStain: { value: 0.55 + 0.4 * ((seedBase * 7.31) % 1) },
      };
      mat = new THREE.MeshPhysicalMaterial({ roughness: 0.5, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.3 });
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        injectSort(shader);
      };
      mat.customProgramCacheKey = () => "letterpress-sort";
      top = new THREE.Mesh(faceGeo, mat);
      top.receiveShadow = true;
      scene.add(top);
    }
    return {
      ch,
      style,
      slot,
      isSpace,
      widthEm,
      body: bodyMesh,
      top,
      mat,
      uniforms,
      seed: seedBase,
      x: 0,
      vx: 0,
      tx: 0,
      drop: 0,
      vdrop: 0,
      yaw: 0,
      vyaw: 0,
      delay: 0,
      state: "in",
      out: 0,
    };
  }

  function freeSort(s) {
    scene.remove(s.body);
    if (s.top) scene.remove(s.top);
    s.mat?.dispose();
    ink.clear(s.slot);
    freeSlots.push(s.slot);
  }

  function relayout(instant) {
    const live = sorts.filter((s) => s.state === "in");
    const res = layoutLine(
      live.map((s) => s.ch),
      currentFace,
      measure,
    );
    bodyTarget = live.length ? res.body : bodyTarget;
    live.forEach((s, i) => {
      s.tx = res.xs[i];
      if (instant) {
        s.x = s.tx;
        s.vx = 0;
      }
    });
    if (instant) {
      body = bodyTarget;
      bodyVel = 0;
    }
  }

  function setText(next, style, instant = false) {
    const chars = Array.from(next).slice(0, MAX_CHARS);
    const nextStyle = style === "italic" ? "italic" : "gothic";
    const live = sorts.filter((s) => s.state === "in");
    const same = (s, ch) => s.ch === ch && s.style === nextStyle;
    let pre = 0;
    while (pre < live.length && pre < chars.length && same(live[pre], chars[pre])) pre += 1;
    let suf = 0;
    while (
      suf < live.length - pre &&
      suf < chars.length - pre &&
      same(live[live.length - 1 - suf], chars[chars.length - 1 - suf])
    )
      suf += 1;
    const removed = live.slice(pre, live.length - suf);
    for (const s of removed) {
      s.state = "out";
      s.out = 0;
      if (instant || reduced) s.out = 1;
    }
    const added = [];
    for (let i = pre; i < chars.length - suf; i += 1) {
      const s = makeSort(chars[i], nextStyle, 0.37 + rand() * 9.1);
      if (s) added.push(s);
    }
    const head = live.slice(0, pre);
    const tail = live.slice(live.length - suf);
    const outs = sorts.filter((s) => s.state === "out");
    sorts = [...head, ...added, ...tail, ...outs];
    currentFace = nextStyle;
    currentText = chars.join("");
    relayout(instant);
    const anchor = added.length ? (added[0].tx + added[added.length - 1].tx) / 2 : 0;
    added.forEach((s, i) => {
      s.x = s.tx;
      if (instant || reduced) {
        s.drop = 0;
      } else {
        s.drop = 0.85 + rand() * 0.25;
        s.vdrop = 0;
        s.delay = i * 0.045;
        s.yaw = (rand() - 0.5) * 0.3;
        s.x = s.tx + (s.tx - anchor) * 0.04;
      }
    });
    if (!instant) wake();
    return added;
  }

  function primeAll(amount, seed) {
    for (const s of sorts) if (s.state === "in" && !s.isSpace) ink.prime(s.slot, amount, seed + s.slot * 13);
  }

  function lineExtent() {
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const s of sorts) {
      if (s.state !== "in") continue;
      const w = s.widthEm * body;
      x0 = Math.min(x0, s.x - w / 2);
      x1 = Math.max(x1, s.x + w / 2);
    }
    if (!Number.isFinite(x0)) return [-0.2, 0.2];
    return [x0, x1];
  }

  function syncSorts() {
    const [x0, x1] = lineExtent();
    for (const s of sorts) {
      const w = s.widthEm * body;
      const fw = Math.max(0.01, w - 0.006);
      const fh = Math.max(0.01, body - 0.006);
      const lift = s.drop + (s.state === "out" ? s.out * 0.5 : 0);
      const shrink = s.state === "out" ? 1 - smooth(0.2, 1, s.out) : 1;
      const height = s.isSpace ? FURN_TOP - BED_TOP - 0.02 : TYPE_HIGH - BED_TOP;
      const topY = (s.isSpace ? FURN_TOP - 0.02 : TYPE_HIGH) + lift;
      s.body.position.set(s.x, topY, 0);
      s.body.scale.set(fw * shrink, height * Math.max(0.05, shrink), fh * shrink);
      s.body.rotation.y = s.yaw;
      s.body.visible = shrink > 0.01;
      if (s.top) {
        s.top.position.set(s.x, topY + 0.0004, 0);
        s.top.scale.set(fw * shrink, 1, fh * shrink);
        s.top.rotation.y = s.yaw;
        s.top.visible = shrink > 0.01;
        s.uniforms.uSize.value.set(fw, fh);
      }
    }
    const fz = body / 2;
    const fy = (BED_TOP + FURN_TOP) / 2;
    const fhgt = FURN_TOP - BED_TOP;
    const back = furniture[0];
    back.position.set(0, fy, -(fz + CHASE_IN_Z) / 2 - 0.002);
    back.scale.set(CHASE_IN_X * 2 - 0.01, fhgt, Math.max(0.01, CHASE_IN_Z - fz - 0.006));
    const front = furniture[1];
    front.position.set(0, fy, (fz + CHASE_IN_Z) / 2 + 0.002);
    front.scale.set(CHASE_IN_X * 2 - 0.01, fhgt, Math.max(0.01, CHASE_IN_Z - fz - 0.006));
    const left = furniture[2];
    const lx = Math.max(-CHASE_IN_X + 0.02, x0 - 0.006);
    left.position.set((-CHASE_IN_X + lx) / 2, fy, 0);
    left.scale.set(Math.max(0.01, lx + CHASE_IN_X - 0.004), fhgt, body - 0.006);
    const right = furniture[3];
    const rx = Math.min(1.42, x1 + 0.006);
    right.position.set((rx + 1.42) / 2, fy, 0);
    right.scale.set(Math.max(0.01, 1.42 - rx - 0.004), fhgt, body - 0.006);
    quoins.forEach((q, i) => q.position.set(1.49, BED_TOP + 0.065, (i ? 1 : -1) * Math.min(0.26, Math.max(0.12, fz * 0.6))));
  }

  const sheetGeo = keep(new THREE.PlaneGeometry(SHEET_W, SHEET_D));
  sheetGeo.rotateX(Math.PI / 2);
  const printTargets = [];
  function makeSheet(i) {
    const rt = new THREE.WebGLRenderTarget(PRINT_W, PRINT_H, {
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    rt.texture.anisotropy = anisotropy;
    printTargets.push(rt);
    const tint = 0.985 + rand() * 0.03;
    const uniforms = {
      uPrint: { value: rt.texture },
      uHas: { value: 0 },
      uSeed: { value: 2.3 + i * 7.71 },
      uSize: { value: new THREE.Vector2(SHEET_W, SHEET_D) },
      uTexel: { value: new THREE.Vector2(1 / PRINT_W, 1 / PRINT_H) },
      uBite: { value: 0.032 },
      uInkCol: shared.uInkCol,
      uPaper: { value: new THREE.Vector3(PAPER_RGB[0] * tint, PAPER_RGB[1] * tint, PAPER_RGB[2] * (tint - 0.01)) },
    };
    const mat = keep(
      new THREE.MeshPhysicalMaterial({
        roughness: 0.92,
        metalness: 0,
        sheen: 0.45,
        sheenRoughness: 0.75,
        sheenColor: new THREE.Color(1, 0.99, 0.96),
        side: THREE.DoubleSide,
      }),
    );
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      injectPaper(shader);
    };
    mat.customProgramCacheKey = () => "letterpress-paper";
    const mesh = new THREE.Mesh(sheetGeo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    scene.add(mesh);
    return { rt, uniforms, mat, mesh, number: 0, pressure: 0 };
  }
  const pool = Array.from({ length: POOL }, (_, i) => makeSheet(i));
  let spare = [...pool];
  const stack = [];
  let lidSheet = spare.pop();

  const lidSheetGeo = keep(new THREE.BufferGeometry());
  const lidPos = new Float32Array(ROWS * COLS * 3);
  const lidUv = new Float32Array(ROWS * COLS * 2);
  const lidIdx = [];
  for (let j = 0; j < ROWS; j += 1) {
    for (let i = 0; i < COLS; i += 1) {
      const k = j * COLS + i;
      lidUv[k * 2] = i / (COLS - 1);
      lidUv[k * 2 + 1] = j / (ROWS - 1);
      if (i < COLS - 1 && j < ROWS - 1) {
        const a = k;
        const b = k + 1;
        const c = k + COLS;
        const d = k + COLS + 1;
        lidIdx.push(a, b, c, b, d, c);
      }
    }
  }
  lidSheetGeo.setAttribute("position", new THREE.BufferAttribute(lidPos, 3));
  lidSheetGeo.setAttribute("uv", new THREE.BufferAttribute(lidUv, 2));
  lidSheetGeo.setIndex(lidIdx);
  lidSheetGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, -0.4), 4);
  const lidSheetMesh = new THREE.Mesh(lidSheetGeo, lidSheet.mat);
  lidSheetMesh.castShadow = true;
  lidSheetMesh.receiveShadow = false;
  lidSheetMesh.frustumCulled = false;
  scene.add(lidSheetMesh);

  const printMat = keep(
    new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: PRINT_VERTEX,
      fragmentShader: PRINT_FRAGMENT,
      uniforms: {
        uGlyph: shared.uGlyph,
        uInkTex: shared.uInkTex,
        uRects: { value: Array.from({ length: 24 }, () => new THREE.Vector4()) },
        uInfo: { value: Array.from({ length: 24 }, () => new THREE.Vector4()) },
        uCount: { value: 0 },
        uSheet: { value: new THREE.Vector4() },
        uPress: { value: new THREE.Vector4() },
      },
      depthTest: false,
      depthWrite: false,
    }),
  );
  const printScene = new THREE.Scene();
  const printQuad = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 1)), printMat);
  printQuad.frustumCulled = false;
  printScene.add(printQuad);
  const printCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let pulled = 0;
  let lastWord = "";

  function bakePrint(sheet, pressure) {
    if (ink.flush()) inkTex.needsUpdate = true;
    const u = printMat.uniforms;
    let n = 0;
    for (const s of sorts) {
      if (n >= 24) break;
      if (s.state !== "in" || s.isSpace || s.drop > 0.004) continue;
      const w = s.widthEm * body;
      u.uRects.value[n].set(s.x, 0, Math.max(0.01, w - 0.006), Math.max(0.01, body - 0.006));
      u.uInfo.value[n].set(s.slot, s.seed, 1, 0);
      n += 1;
    }
    u.uCount.value = n;
    const offX = (rand() - 0.5) * 0.03;
    const offZ = (rand() - 0.5) * 0.024;
    u.uSheet.value.set(-SHEET_W / 2 + offX, HINGE_Z + SHEET_Z0 + offZ, SHEET_W, SHEET_D);
    u.uPress.value.set(pressure, (rand() - 0.5) * 0.3, 0.06 + rand() * 0.1, rand() * 50);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(sheet.rt);
    renderer.render(printScene, printCam);
    renderer.setRenderTarget(prev);
    sheet.uniforms.uHas.value = 1;
    sheet.pressure = pressure;
    pulled += 1;
    sheet.number = pulled;
    const transfer = 0.22 + 0.12 * clamp01(pressure);
    for (const s of sorts) if (s.state === "in" && !s.isSpace && s.drop <= 0.004) ink.lift(s.slot, transfer);
    lastWord = impressionWord(pressure);
  }

  const layoutState = { mode: "wide", stack: new THREE.Vector3(0, 0, 1.95), slab: new THREE.Vector3(-2.72, 0, 0.05) };
  const stackPose = (k, sheet) => {
    const jit = mulberry(sheet.number * 977 + 13);
    const pos = new THREE.Vector3(
      layoutState.stack.x + (jit() - 0.5) * 0.14,
      0.0016 + k * 0.0032,
      layoutState.stack.z + (jit() - 0.5) * 0.1,
    );
    const yaw = (jit() - 0.5) * 0.075;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
    return { pos, q };
  };

  function placeStack() {
    stack.forEach((sheet, k) => {
      const { pos, q } = stackPose(k, sheet);
      sheet.mesh.position.copy(pos);
      sheet.mesh.quaternion.copy(q);
      sheet.mesh.visible = true;
    });
  }

  const brayer = new THREE.Group();
  scene.add(brayer);
  const rollerSpin = new THREE.Group();
  brayer.add(rollerSpin);
  const rollerGeo = keep(new THREE.CylinderGeometry(ROLLER_R, ROLLER_R, ROLLER_L, 56, 1));
  rollerGeo.rotateX(Math.PI / 2);
  const roller = new THREE.Mesh(rollerGeo, rollerMat);
  roller.castShadow = true;
  roller.receiveShadow = true;
  rollerSpin.add(roller);
  const capGeo = keep(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 24));
  capGeo.rotateX(Math.PI / 2);
  for (const z of [-1, 1]) {
    const cap = new THREE.Mesh(capGeo, steelMat);
    cap.position.z = z * (ROLLER_L / 2 + 0.015);
    cap.castShadow = true;
    brayer.add(cap);
  }
  const rodBetween = (a, b, r) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const g = keep(new THREE.CylinderGeometry(r, r, len, 10));
    const m = new THREE.Mesh(g, steelMat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    m.castShadow = true;
    brayer.add(m);
  };
  const ferrule = new THREE.Vector3(-0.5, 0.24, 0);
  rodBetween(new THREE.Vector3(0, 0, -(ROLLER_L / 2 + 0.035)), new THREE.Vector3(-0.42, 0.2, -0.05), 0.014);
  rodBetween(new THREE.Vector3(0, 0, ROLLER_L / 2 + 0.035), new THREE.Vector3(-0.42, 0.2, 0.05), 0.014);
  rodBetween(new THREE.Vector3(0, 0, -(ROLLER_L / 2 + 0.035)), new THREE.Vector3(0, 0, ROLLER_L / 2 + 0.035), 0.01);
  rodBetween(new THREE.Vector3(-0.42, 0.2, -0.05), ferrule, 0.022);
  rodBetween(new THREE.Vector3(-0.42, 0.2, 0.05), ferrule, 0.022);
  const handleProfile = [
    [0, 0],
    [0.038, 0],
    [0.04, 0.05],
    [0.062, 0.09],
    [0.078, 0.26],
    [0.082, 0.5],
    [0.072, 0.66],
    [0.045, 0.71],
    [0, 0.715],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const handleGeo = keep(new THREE.LatheGeometry(handleProfile, 28));
  const handle = new THREE.Mesh(handleGeo, walnutMat);
  handle.position.copy(ferrule);
  handle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0.36, 0).normalize());
  handle.castShadow = true;
  brayer.add(handle);
  const brayerProxy = add(box(1.7, 0.6, 1.2), hidden, -0.55, 0.15, 0, brayer, false);

  const slabGroup = new THREE.Group();
  scene.add(slabGroup);
  add(box(1.3, 0.05, 1.34, 0.01), chaseMat, 0, 0.025, 0, slabGroup);
  const slabInkGeo = keep(new THREE.PlaneGeometry(1.14, 1.18));
  slabInkGeo.rotateX(-Math.PI / 2);
  const slabInk = add(slabInkGeo, slabInkMat, 0.02, 0.0508, 0, slabGroup, false);
  slabInk.renderOrder = 2;

  const br = {
    x: 0,
    z: 0,
    y: ROLLER_R,
    vx: 0,
    vz: 0,
    vy: 0,
    spin: 0,
    speed: 0,
    lastDir: 0,
    pass: 1,
    home: new THREE.Vector3(),
  };

  let o = OPEN;
  let w = 0;
  let lidDrag = null;
  let brDrag = null;
  let auto = null;
  let contact = false;
  let peak = 0;
  let pressureNow = 0;
  let sheetState = "blank";
  let peel = 1;
  let peelV = 0;
  let slide = 0;
  let slideT = 1;
  let dwell = 0;
  let flight = null;
  let raf = 0;
  let last = 0;
  let active = false;
  let destroyed = false;
  let shadowDirty = true;
  let statusKey = "";
  let coverageCache = 0;
  let coverageDirty = true;

  const view = { width: 1, height: 1, pr: 1 };
  let quality = 1;
  let interval = 16;
  const pointer = { id: -1, x: 0, y: 0, inside: false };
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const plane = new THREE.Plane();

  function lidPoint(lx, ly, lz, angle, out) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    out.set(lx, HINGE_Y + ly * c + lz * s, HINGE_Z - ly * s + lz * c);
    return out;
  }

  function project(v) {
    tmpV2.copy(v).project(camera);
    return [(tmpV2.x * 0.5 + 0.5) * view.width, (-tmpV2.y * 0.5 + 0.5) * view.height];
  }

  function groundAt(x, z) {
    const xr0 = x - 0.05;
    const xr1 = x + 0.05;
    const zr0 = z - ROLLER_L / 2 + 0.04;
    const zr1 = z + ROLLER_L / 2 - 0.04;
    const over = (ax0, ax1, az0, az1) => xr1 > ax0 && xr0 < ax1 && zr1 > az0 && zr0 < az1;
    let h = 0;
    const st = layoutState.stack;
    if (stack.length && over(st.x - SHEET_W / 2, st.x + SHEET_W / 2, st.z - SHEET_D / 2, st.z + SHEET_D / 2)) h = 0.0016 + stack.length * 0.0032;
    const sl = layoutState.slab;
    if (over(sl.x - 0.65, sl.x + 0.65, sl.z - 0.67, sl.z + 0.67)) h = Math.max(h, 0.0505);
    if (over(-2.03, 2.03, -1.03, 1.03)) h = Math.max(h, 0.12);
    if (over(-1.85, 1.85, -0.85, 0.85)) h = Math.max(h, BED_TOP);
    if (over(-1.66, 1.66, -0.68, 0.68)) h = Math.max(h, FURN_TOP);
    const [x0, x1] = lineExtent();
    if (over(x0 + 0.01, x1 - 0.01, -body / 2 + 0.01, body / 2 - 0.01)) h = TYPE_HIGH;
    return h;
  }

  function brayerBounds(x, z) {
    const sl = layoutState.slab;
    const minX = Math.min(sl.x - 0.3, -3.2);
    let nx = clamp(x, minX, 1.62);
    let nz = clamp(z, -0.28, layoutState.mode === "tall" ? sl.z + 0.6 : 2.6);
    if (Math.abs(nx) < 2.05 && nz < -0.28) nz = -0.28;
    return [nx, nz];
  }

  function updateLidSheet() {
    if (!lidSheet) {
      lidSheetMesh.visible = false;
      return;
    }
    lidSheetMesh.visible = true;
    if (lidSheetMesh.material !== lidSheet.mat) lidSheetMesh.material = lidSheet.mat;
    const tacked = sheetState === "tacked";
    const p = tacked ? peel : 1;
    const a = SHEET_Z0 - BRIDGE + (SHEET_Z1 - SHEET_Z0 + BRIDGE) * p;
    const b = a + BRIDGE;
    const c = Math.cos(o);
    const s = Math.sin(o);
    const aY = HINGE_Y + SHEET_Y * c + a * s;
    const aZ = HINGE_Z - SHEET_Y * s + a * c;
    const bY = TYPE_HIGH + 0.0022;
    const bZ = HINGE_Z + b;
    const len = Math.hypot(aY - bY, aZ - bZ) * 0.9 + 0.04;
    for (let j = 0; j < ROWS; j += 1) {
      const zl = SHEET_Z0 + (j / (ROWS - 1)) * SHEET_D;
      let py;
      let pz;
      if (!tacked || zl <= a) {
        const z2 = zl + slide * 0.12;
        const y2 = SHEET_Y - slide * 0.42;
        py = HINGE_Y + y2 * c + z2 * s;
        pz = HINGE_Z - y2 * s + z2 * c;
      } else if (zl >= b) {
        py = bY;
        pz = HINGE_Z + zl;
      } else {
        const t = (zl - a) / BRIDGE;
        const t2 = t * t;
        const t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;
        py = h00 * aY + h10 * s * len + h01 * bY;
        pz = h00 * aZ + h10 * c * len + h01 * bZ + h11 * len;
        if (py < bY) py = bY;
      }
      for (let i = 0; i < COLS; i += 1) {
        const k = (j * COLS + i) * 3;
        lidPos[k] = -SHEET_W / 2 + (i / (COLS - 1)) * SHEET_W;
        lidPos[k + 1] = py;
        lidPos[k + 2] = pz;
      }
    }
    lidSheetGeo.attributes.position.needsUpdate = true;
    lidSheetGeo.computeVertexNormals();
  }

  function sheetLidPose(out) {
    lid.updateMatrixWorld(true);
    tmpV.set(0, SHEET_Y, SHEET_Z0 + SHEET_D / 2);
    out.pos.copy(tmpV).applyMatrix4(lid.matrixWorld);
    out.q.copy(lid.quaternion);
    return out;
  }

  function startTransfer(fast) {
    if (!lidSheet || !lidSheet.uniforms.uHas.value) return;
    const sheet = lidSheet;
    const from = sheetLidPose({ pos: new THREE.Vector3(), q: new THREE.Quaternion() });
    from.pos.add(new THREE.Vector3(0, -0.004, 0).applyQuaternion(from.q));
    const k = Math.min(stack.length, STACK_MAX);
    if (stack.length >= STACK_MAX) {
      const old = stack.shift();
      old.mesh.visible = false;
      old.uniforms.uHas.value = 0;
      spare.unshift(old);
      placeStack();
    }
    const to = stackPose(Math.min(k, STACK_MAX - 1), sheet);
    sheet.mesh.position.copy(from.pos);
    sheet.mesh.quaternion.copy(from.q);
    sheet.mesh.visible = true;
    flight = { sheet, t: 0, from, to, dur: fast ? 0.7 : 0.95 };
    lidSheet = spare.pop() || null;
    if (lidSheet) {
      lidSheet.uniforms.uHas.value = 0;
      lidSheet.mesh.visible = false;
    }
    sheetState = "blank";
    peel = 1;
    dwell = 0;
    slide = 0;
    slideT = 1;
    if (reduced) finishFlight();
    shadowDirty = true;
    wake();
  }

  function finishFlight() {
    if (!flight) return;
    const sheet = flight.sheet;
    flight = null;
    stack.push(sheet);
    placeStack();
  }

  function doPrint(pressure) {
    if (!lidSheet) return;
    if (lidSheet.uniforms.uHas.value) {
      startTransfer(true);
      if (!lidSheet) return;
    }
    slide = 0;
    slideT = 1;
    bakePrint(lidSheet, pressure);
    coverageDirty = true;
    sheetState = reduced ? "printed" : "tacked";
    peel = 0;
    peelV = 0;
    dwell = 0;
  }

  function layout() {
    const rect = host.getBoundingClientRect();
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    const budget = Math.sqrt(2600000 / Math.max(1, view.width * view.height));
    view.pr = Math.max(0.75, Math.min(dprCap, budget));
    renderer.setPixelRatio(view.pr * quality);
    renderer.setSize(view.width, view.height, false);
    camera.aspect = view.width / view.height;
    const pad = insets();
    const availW = view.width - pad.left - pad.right;
    const availH = view.height - pad.top - pad.bottom;
    const tall = availW / Math.max(1, availH) < 1.05;
    layoutState.mode = tall ? "tall" : "wide";
    if (tall) {
      layoutState.stack.set(-0.15, 0, 1.92);
      layoutState.slab.set(-0.3, 0, 3.25);
    } else {
      layoutState.stack.set(0.05, 0, 1.95);
      layoutState.slab.set(-2.78, 0, 0.1);
    }
    slabGroup.position.set(layoutState.slab.x, 0, layoutState.slab.z);
    br.home.set(layoutState.slab.x + 0.34, 0, layoutState.slab.z);
    if (!brDrag && !(auto && auto.kind === "ink")) {
      br.x = br.home.x;
      br.z = br.home.z;
      br.y = groundAt(br.x, br.z) + ROLLER_R;
      br.vx = br.vz = br.vy = 0;
    }
    placeStack();
    const pts = [];
    const P = (x, y, z) => pts.push(new THREE.Vector3(x, y, z));
    for (const x of [-2.03, 2.03]) for (const z of [-1.03, 1.03]) P(x, 0, z);
    for (const x of [-LID_X, LID_X]) {
      lidPoint(x, LID_T + 0.06, LID_Z1, OPEN, tmpV);
      P(tmpV.x, tmpV.y, tmpV.z);
    }
    lidPoint(GRIP_LOCAL[0] + 0.2, GRIP_LOCAL[1] + 0.08, GRIP_LOCAL[2], OPEN, tmpV);
    P(tmpV.x, tmpV.y, tmpV.z);
    lidPoint(GRIP_LOCAL[0] + 0.2, GRIP_LOCAL[1], GRIP_LOCAL[2], 0, tmpV);
    P(tmpV.x, tmpV.y, tmpV.z);
    const st = layoutState.stack;
    for (const x of [-1, 1]) for (const z of [-1, 1]) P(st.x + x * (SHEET_W / 2 + 0.05), 0, st.z + z * (SHEET_D / 2 + 0.05));
    const sl = layoutState.slab;
    P(sl.x - 0.66, 0, sl.z - 0.68);
    P(sl.x + 0.66, 0, sl.z + 0.68);
    P(br.home.x - 1.25, 0.45, br.home.z);
    const target = new THREE.Vector3(0, 0.3, 0.4);
    const dir = new THREE.Vector3(0, Math.sin(EL), Math.cos(EL));
    let dist = 13;
    const safe = {
      l: (pad.left / view.width) * 2 - 1,
      r: 1 - (pad.right / view.width) * 2,
      t: 1 - (pad.top / view.height) * 2,
      b: (pad.bottom / view.height) * 2 - 1,
    };
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    for (let it = 0; it < 8; it += 1) {
      camera.position.copy(target).addScaledVector(dir, dist);
      camera.lookAt(target);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of pts) {
        tmpV.copy(p).project(camera);
        minX = Math.min(minX, tmpV.x);
        maxX = Math.max(maxX, tmpV.x);
        minY = Math.min(minY, tmpV.y);
        maxY = Math.max(maxY, tmpV.y);
      }
      const sx = (maxX - minX) / Math.max(0.05, safe.r - safe.l);
      const sy = (maxY - minY) / Math.max(0.05, safe.t - safe.b);
      const scale = Math.max(sx, sy);
      const halfH = Math.tan((FOV * Math.PI) / 360) * dist;
      const halfW = halfH * camera.aspect;
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      up.setFromMatrixColumn(camera.matrixWorld, 1);
      const offX = ((minX + maxX) / 2 - (safe.l + safe.r) / 2) * halfW;
      const offY = ((minY + maxY) / 2 - (safe.t + safe.b) / 2) * halfH;
      target.addScaledVector(right, offX * 0.9);
      target.addScaledVector(up, offY * 0.9);
      dist = clamp(dist * (0.35 + 0.65 * scale), 4, 60);
    }
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    shadowDirty = true;
  }

  function setNdc(px, py) {
    ndc.set((px / view.width) * 2 - 1, -(py / view.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }

  function hitTest(px, py) {
    setNdc(px, py);
    lid.updateMatrixWorld(true);
    brayer.updateMatrixWorld(true);
    const hits = ray.intersectObjects([leverProxy, brayerProxy, lidProxy], false);
    if (!hits.length) return null;
    const h = hits[0];
    if (h.object === brayerProxy) return { kind: "brayer", point: h.point };
    if (h.object === leverProxy) return { kind: "lever", point: h.point };
    if (o > 0.5) return { kind: "lid", point: h.point };
    return { kind: "lid", point: h.point };
  }

  function pathScreen(local, angle) {
    lidPoint(local[0], local[1], local[2], angle, tmpV);
    return project(tmpV);
  }

  function leverTarget(drag) {
    const tx = pointer.x - drag.offX;
    const ty = pointer.y - drag.offY;
    const N = 48;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i <= N; i += 1) {
      const a = (i / N) * OPEN;
      const [sx, sy] = pathScreen(drag.local, a);
      const d = (sx - tx) ** 2 + (sy - ty) ** 2;
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    let lo = Math.max(0, best - OPEN / N);
    let hi = Math.min(OPEN, best + OPEN / N);
    for (let i = 0; i < 14; i += 1) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      const [ax, ay] = pathScreen(drag.local, m1);
      const [bx, by] = pathScreen(drag.local, m2);
      if ((ax - tx) ** 2 + (ay - ty) ** 2 < (bx - tx) ** 2 + (by - ty) ** 2) hi = m2;
      else lo = m1;
    }
    let angle = (lo + hi) / 2;
    if (angle < 0.02) {
      const [ex, ey] = pathScreen(drag.local, 0);
      const [fx, fy] = pathScreen(drag.local, 0.08);
      const dx = ex - fx;
      const dy = ey - fy;
      const len = Math.hypot(dx, dy);
      if (len > 0.5) {
        const over = ((tx - ex) * dx + (ty - ey) * dy) / len;
        if (over > 0) angle = -Math.min(0.16, (over / (len / 0.08)) * 0.95);
      }
    }
    return angle;
  }

  function brayerPointerTarget() {
    setNdc(pointer.x, pointer.y);
    plane.set(new THREE.Vector3(0, 1, 0), -(TYPE_HIGH + ROLLER_R));
    const hit = ray.ray.intersectPlane(plane, tmpV);
    if (!hit) return null;
    return [hit.x + brDrag.offX, hit.z + brDrag.offZ];
  }

  function onDown(e) {
    if (pointer.id !== -1) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const rect = host.getBoundingClientRect();
    pointer.x = e.clientX - rect.left;
    pointer.y = e.clientY - rect.top;
    const hit = hitTest(pointer.x, pointer.y);
    if (!hit) return;
    auto = null;
    pointer.id = e.pointerId;
    host.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    if (hit.kind === "brayer") {
      setNdc(pointer.x, pointer.y);
      plane.set(new THREE.Vector3(0, 1, 0), -(TYPE_HIGH + ROLLER_R));
      const p = ray.ray.intersectPlane(plane, tmpV);
      brDrag = { offX: p ? br.x - p.x : 0, offZ: p ? br.z - p.z : 0, tx: br.x, tz: br.z };
      br.pass += 1;
    } else {
      if (sheetState === "printed" && lidSheet?.uniforms.uHas.value) startTransfer(true);
      if (sheetState === "tacked") {
        sheetState = "printed";
        peel = 1;
        startTransfer(true);
      }
      lid.updateMatrixWorld(true);
      const local = lid.worldToLocal(hit.point.clone());
      const radius = Math.max(0.9, Math.hypot(local.y, local.z));
      const ang = Math.atan2(local.y, local.z);
      const lz = Math.cos(ang) * radius;
      const ly = Math.sin(ang) * radius;
      const loc = [local.x, ly, lz];
      const [sx, sy] = pathScreen(loc, o);
      lidDrag = { local: loc, offX: pointer.x - sx, offY: pointer.y - sy, target: o };
    }
    host.dataset.grabbing = "";
    wake();
  }

  function onMove(e) {
    const rect = host.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (e.pointerId === pointer.id) {
      pointer.x = x;
      pointer.y = y;
      wake();
      return;
    }
    if (pointer.id !== -1 || e.pointerType !== "mouse") return;
    const hit = hitTest(x, y);
    if (hit) host.dataset.hover = "";
    else delete host.dataset.hover;
  }

  function onUp(e) {
    if (e.pointerId !== pointer.id) return;
    pointer.id = -1;
    host.releasePointerCapture?.(e.pointerId);
    lidDrag = null;
    brDrag = null;
    delete host.dataset.grabbing;
    wake();
  }

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Enter") {
      e.preventDefault();
      api.pull();
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      api.ink();
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      const next = Array.from(currentText).slice(0, -1).join("");
      setText(next, currentFace);
      onText?.(next);
      return;
    }
    if (e.key.length === 1 && /[\p{L}\p{N} &'!?.,-]/u.test(e.key)) {
      e.preventDefault();
      if (Array.from(currentText).length >= MAX_CHARS) return;
      const next = currentText + e.key;
      setText(next, currentFace);
      onText?.(next);
    }
  }

  function stepLid(h) {
    let tau = K_RET * (OPEN - o) + R_BUILD * Math.pow(1 - clamp01(o / OPEN), 3) - C_FREE * w;
    if (lidDrag) tau += K_DRAG * (lidDrag.target - o) - C_DRAG * w;
    if (sheetState === "tacked" && o < 0.35) tau -= TACK * (1 - o / 0.35) * (1 - peel);
    let ct = 0;
    if (o < CONTACT) {
      ct = K_C * (CONTACT - o) - C_C * w;
      tau += K_C * (CONTACT - o) - C_C * w * 2;
    }
    w += (tau / INERTIA) * h;
    o += w * h;
    if (o < -0.004) {
      ct = Math.max(ct, K_C * (CONTACT + 0.004) - C_C * Math.min(0, w));
      o = -0.004;
      if (w < 0) w = 0;
    }
    if (o > OPEN) {
      o = OPEN;
      if (w > 0) w = -w * 0.1;
    }
    return Math.max(0, ct) / P_REF;
  }

  function stepBrayer(dt) {
    let tx = br.home.x;
    let tz = br.home.z;
    let omega = 9.5;
    if (brDrag) {
      const t = brayerPointerTarget();
      if (t) {
        brDrag.tx = t[0];
        brDrag.tz = t[1];
      }
      tx = brDrag.tx;
      tz = brDrag.tz;
      omega = 26;
    } else if (auto && auto.kind === "ink") {
      tx = auto.tx;
      tz = auto.tz;
      omega = 22;
    }
    if (Math.abs(tx) < 1.66 && Math.abs(tz) < 0.7) tz *= 0.8;
    [tx, tz] = brayerBounds(tx, tz);
    const x0 = br.x;
    if (reduced) {
      br.x = tx;
      br.z = tz;
      br.vx = br.vz = 0;
    } else {
      const steps = Math.max(1, Math.ceil(dt / SUB));
      const h = dt / steps;
      for (let i = 0; i < steps; i += 1) {
        br.vx += (omega * omega * (tx - br.x) - 2 * omega * br.vx) * h;
        br.vz += (omega * omega * (tz - br.z) - 2 * omega * br.vz) * h;
        br.x += br.vx * h;
        br.z += br.vz * h;
      }
    }
    const ground = groundAt(br.x, br.z);
    const ty = ground + ROLLER_R;
    if (reduced) br.y = ty;
    else {
      const k = 1 - Math.exp(-dt * 30);
      br.y += (ty - br.y) * k;
      if (br.y < ty) br.y = ty;
    }
    const dx = br.x - x0;
    br.spin -= dx / ROLLER_R;
    const inst = dt > 0 ? Math.abs(dx) / dt : 0;
    br.speed += (inst - br.speed) * (1 - Math.exp(-dt / 0.06));
    const dir = Math.sign(dx);
    if (dir && Math.abs(dx) > 0.0004 && dir !== br.lastDir) {
      br.lastDir = dir;
      br.pass += 1;
    }
    if (ground === TYPE_HIGH && Math.abs(br.y - ty) < 0.015 && Math.abs(dx) > 1e-5) {
      const xa = Math.min(x0, br.x);
      const xb = Math.max(x0, br.x);
      const gain = 0.55 / (1 + br.speed / 2.2);
      const patch = clamp(0.2 + br.speed * 0.09, 0.2, 0.85);
      let any = false;
      for (const s of sorts) {
        if (s.state !== "in" || s.isSpace || s.drop > 0.01) continue;
        const fw = Math.max(0.01, s.widthEm * body - 0.006);
        const fh = Math.max(0.01, body - 0.006);
        const left = s.x - fw / 2;
        const sa = (xa - left) / fw;
        const sb = (xb - left) / fw;
        if (sb < 0 || sa > 1) continue;
        const zmin = br.z - ROLLER_L / 2 + 0.03;
        const zmax = br.z + ROLLER_L / 2 - 0.03;
        const va = (fh / 2 - zmax) / fh;
        const vb = (fh / 2 - zmin) / fh;
        if (ink.roll(s.slot, sa, sb, va, vb, gain, patch, br.pass * 131 + s.slot)) any = true;
      }
      if (any) coverageDirty = true;
    }
    brayer.position.set(br.x, br.y, br.z);
    rollerSpin.rotation.z = br.spin;
  }

  function stepSorts(dt) {
    let moving = false;
    if (reduced) {
      body = bodyTarget;
      bodyVel = 0;
    } else {
      bodyVel += (120 * (bodyTarget - body) - 2 * Math.sqrt(120) * bodyVel) * dt;
      body += bodyVel * dt;
      if (Math.abs(bodyTarget - body) > 1e-4 || Math.abs(bodyVel) > 1e-4) moving = true;
      else {
        body = bodyTarget;
        bodyVel = 0;
      }
    }
    const keepSorts = [];
    for (const s of sorts) {
      if (s.state === "out") {
        s.out += dt / 0.3;
        if (s.out >= 1) {
          freeSort(s);
          continue;
        }
        moving = true;
        keepSorts.push(s);
        continue;
      }
      keepSorts.push(s);
      if (reduced) {
        s.x = s.tx;
        s.drop = 0;
        s.yaw = 0;
        continue;
      }
      const om = 16;
      s.vx += (om * om * (s.tx - s.x) - 2 * om * s.vx) * dt;
      s.x += s.vx * dt;
      if (s.delay > 0) {
        s.delay -= dt;
        moving = true;
      } else if (s.drop !== 0 || s.vdrop !== 0) {
        const od = 19;
        s.vdrop += (-od * od * s.drop - 2 * 0.74 * od * s.vdrop) * dt;
        s.drop += s.vdrop * dt;
        if (s.drop < -0.0015) {
          s.drop = -0.0015;
          s.vdrop = Math.abs(s.vdrop) * 0.1;
        }
        if (Math.abs(s.drop) < 0.0004 && Math.abs(s.vdrop) < 0.01) {
          s.drop = 0;
          s.vdrop = 0;
        }
      }
      const oy = 14;
      s.vyaw += (-oy * oy * s.yaw - 2 * oy * s.vyaw) * dt;
      s.yaw += s.vyaw * dt;
      if (Math.abs(s.yaw) < 1e-4 && Math.abs(s.vyaw) < 1e-3) {
        s.yaw = 0;
        s.vyaw = 0;
      }
      if (Math.abs(s.tx - s.x) > 1e-4 || Math.abs(s.vx) > 1e-4 || s.drop !== 0 || s.yaw !== 0 || s.delay > 0) moving = true;
      else {
        s.x = s.tx;
        s.vx = 0;
      }
    }
    sorts = keepSorts;
    return moving;
  }

  function stepAuto(dt) {
    if (!auto) return;
    auto.t += dt;
    if (auto.kind === "pull") {
      const t = auto.t;
      if (t < 0.85) {
        const e = smoother(t / 0.85);
        lidDrag = lidDrag || { local: [GRIP_LOCAL[0], GRIP_LOCAL[1], GRIP_LOCAL[2]], offX: 0, offY: 0, target: o, synthetic: true };
        lidDrag.target = auto.from + (-0.09 - auto.from) * e;
      } else if (t < 1.15) {
        if (lidDrag) lidDrag.target = -0.09;
      } else {
        lidDrag = null;
        auto = null;
      }
    } else if (auto.kind === "ink") {
      const [x0, x1] = lineExtent();
      const a = x0 - 0.32;
      const b = Math.min(1.5, x1 + 0.22);
      const legs = [
        [br.home.x, br.home.z, a, 0, 0.7],
        [a, 0, b, 0, 1.3],
        [b, 0, a, 0, 1.3],
        [a, 0, b, 0, 1.3],
        [b, 0, br.home.x, br.home.z, 0.9],
      ];
      let t = auto.t;
      for (const [ax, az, bx, bz, d] of legs) {
        if (t <= d) {
          const e = smoother(t / d);
          auto.tx = ax + (bx - ax) * e;
          auto.tz = az + (bz - az) * e;
          return;
        }
        t -= d;
      }
      auto = null;
    }
  }

  function stepSheet(dt) {
    let moving = false;
    if (sheetState === "tacked") {
      const target = smooth(0.05, 1.15, o);
      if (reduced) peel = target;
      else {
        const om = 15;
        peelV += (om * om * (target - peel) - 2 * 0.8 * om * peelV) * dt;
        peel = clamp01(peel + peelV * dt);
      }
      if (target >= 1 && peel > 0.995) {
        peel = 1;
        sheetState = "printed";
        dwell = 0;
      }
      moving = true;
    } else if (sheetState === "printed" && !lidDrag) {
      if (o > OPEN - 0.04 && Math.abs(w) < 0.25) {
        dwell += dt;
        if (dwell > 0.75) startTransfer(false);
      }
      moving = true;
    }
    if (slideT < 1) {
      slideT += dt / 0.7;
      const e = easeOut(clamp01(slideT));
      slide = slideT < 0 ? 1 : 1 - e;
      if (slideT >= 1) slide = 0;
      moving = true;
    }
    if (flight) {
      flight.t += dt / flight.dur;
      const e = smoother(flight.t);
      const m = flight.sheet.mesh;
      m.position.lerpVectors(flight.from.pos, flight.to.pos, e);
      m.position.y += Math.sin(Math.PI * Math.min(1, flight.t)) * 0.5;
      tmpQ.copy(flight.from.q).slerp(flight.to.q, smoother(flight.t * 1.08));
      m.quaternion.copy(tmpQ);
      if (flight.t >= 1) finishFlight();
      moving = true;
    }
    return moving;
  }

  function busy() {
    if (lidDrag || brDrag || auto || flight) return true;
    if (o < OPEN - 1e-4 || Math.abs(w) > 1e-4) return true;
    if (sheetState !== "blank" || slideT < 1) return true;
    const homeD = Math.hypot(br.x - br.home.x, br.z - br.home.z);
    if (homeD > 1e-4 || Math.hypot(br.vx, br.vz) > 1e-4) return true;
    return false;
  }

  let lastEmit = 0;
  function emitStatus(force, now = 0) {
    if (!force && now - lastEmit < 180) return;
    if (coverageDirty) {
      const slots = sorts.filter((s) => s.state === "in" && !s.isSpace).map((s) => s.slot);
      coverageCache = ink.coverage(slots);
      coverageDirty = false;
    }
    const inkPct = Math.round(coverageCache * 100);
    const pressing = contact && pressureNow > 0.02;
    const state = pressing ? `pressing ${impressionWord(pressureNow)}` : lastWord ? `${lastWord}` : "";
    const k = `${inkPct}|${pulled}|${state}`;
    if (!force && k === statusKey) return;
    statusKey = k;
    lastEmit = now;
    onStatus?.({ ink: inkPct, pulled, word: pressing ? impressionWord(pressureNow) : lastWord, pressing });
  }

  function render() {
    shared.uLightV.value.copy(lightDir).transformDirection(camera.matrixWorldInverse);
    if (ink.flush()) inkTex.needsUpdate = true;
    if (shadowDirty) {
      renderer.shadowMap.needsUpdate = true;
      shadowDirty = false;
    }
    renderer.render(scene, camera);
  }

  function frame(now) {
    raf = 0;
    if (!active || destroyed) return;
    const raw = last ? now - last : 16.67;
    const dt = clamp(raw / 1000, 0.001, 0.05);
    last = now;
    stepAuto(dt);
    if (lidDrag && !lidDrag.synthetic) lidDrag.target = leverTarget(lidDrag);
    let pmax = 0;
    if (reduced) {
      const prevO = o;
      o = lidDrag ? clamp(lidDrag.target, -0.004, OPEN) : OPEN;
      w = 0;
      if (o < CONTACT) pmax = clamp((CONTACT - o) / 0.1 + 0.4, 0, 1.2);
      if (prevO !== o) shadowDirty = true;
    } else {
      const steps = Math.max(1, Math.ceil(dt / SUB));
      const h = dt / steps;
      for (let i = 0; i < steps; i += 1) pmax = Math.max(pmax, stepLid(h));
    }
    const inContact = o < CONTACT;
    if (inContact) {
      contact = true;
      peak = Math.max(peak, pmax);
      pressureNow = pmax;
    } else if (contact && o > CONTACT + 0.004) {
      contact = false;
      pressureNow = 0;
      if (peak > 0.04) doPrint(Math.min(1.3, peak));
      peak = 0;
    } else if (contact && reduced && !lidDrag) {
      contact = false;
      if (peak > 0.04) doPrint(Math.min(1.3, peak));
      peak = 0;
    }
    lid.rotation.x = -o;
    const sortsMoving = stepSorts(dt);
    stepBrayer(dt);
    const sheetMoving = stepSheet(dt);
    updateLidSheet();
    syncSorts();
    const moving = busy() || sortsMoving || sheetMoving;
    shadowDirty = true;
    if (moving) {
      interval = interval * 0.8 + raw * 0.2;
      if (interval > 34 && quality > 0.5) {
        setQuality(Math.max(0.5, quality * 0.8));
        interval = 20;
      }
    } else if (quality !== 1) setQuality(1);
    render();
    emitStatus(!moving, now);
    if (moving) raf = requestAnimationFrame(frame);
    else last = 0;
  }

  function setQuality(q) {
    quality = q;
    renderer.setPixelRatio(view.pr * quality);
    renderer.setSize(view.width, view.height, false);
  }

  function wake() {
    if (raf || !active || destroyed) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  setText(text || "Side A", currentFace, true);
  syncSorts();
  const presses = [0.62, 1.02, 0.82];
  for (let i = 0; i < presses.length; i += 1) {
    primeAll(0.82 + i * 0.12, 40 + i * 17);
    const sheet = spare.pop();
    bakePrint(sheet, presses[i]);
    stack.push(sheet);
  }
  primeAll(1.0, 7);
  coverageDirty = true;
  lastWord = "";
  layout();
  updateLidSheet();
  lid.rotation.x = -o;
  brayer.position.set(br.x, br.y, br.z);
  syncSorts();
  emitStatus(true);

  const ro = new ResizeObserver(() => {
    layout();
    updateLidSheet();
    brayer.position.set(br.x, br.y, br.z);
    if (active) {
      render();
      wake();
    }
  });
  ro.observe(host);
  host.addEventListener("pointerdown", onDown);
  host.addEventListener("pointermove", onMove);
  host.addEventListener("pointerup", onUp);
  host.addEventListener("pointercancel", onUp);
  host.addEventListener("keydown", onKey);

  const api = {
    setActive(next) {
      if (active === next) return;
      active = next;
      if (active) {
        render();
        wake();
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    setText(next, style) {
      setText(next, style);
      coverageDirty = true;
      wake();
    },
    pull() {
      if (lidDrag && !lidDrag.synthetic) return;
      brDrag = null;
      if (sheetState === "printed" || sheetState === "tacked") {
        sheetState = "printed";
        peel = 1;
        startTransfer(true);
      }
      auto = { kind: "pull", t: 0, from: o };
      wake();
    },
    ink() {
      if (lidDrag || brDrag) return;
      br.pass += 1;
      auto = { kind: "ink", t: 0, tx: br.x, tz: br.z };
      wake();
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      host.removeEventListener("keydown", onKey);
      for (const s of sorts) s.mat?.dispose();
      for (const rt of printTargets) rt.dispose();
      for (const d of disposables) d.dispose?.();
      for (const g of geos.values()) g.dispose();
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
  render();
  return api;
}
