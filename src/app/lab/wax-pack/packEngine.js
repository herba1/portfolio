import {
  CARD,
  PACK,
  cardFace,
  crinkleMap,
  cutMask,
  dealPack,
  haloCanvas,
  loadCover,
  packBack,
  packFront,
  shadowCanvas,
} from "./packArt";
import { createPackAudio } from "./packAudio";
import { cardFragment, cardVertex } from "./packShader";

const FOV = 30;
const NX = 72;
const BODY_ROWS = 60;
const STRIP_ROWS = 10;
const BULGE = 0.055;
const SEAM = 0.0035;
const TEAR_Y = PACK.H / 2 - PACK.TEAR;
const CRIMP_TOP = PACK.H / 2 - PACK.CRIMP;
const CRIMP_BOTTOM = -PACK.H / 2 + PACK.CRIMP;
const IN_Y = -0.1;
const CLEAR_Y = PACK.H / 2 + 0.06 + CARD.H / 2;
const OUT_Z = 0.36;
const IN_GAP = 0.005;
const DEAL_GAP = 0.016;
const X_OUT = 0.62;
const X_CLEAR = 0.55;
const COUNT = 6;
const BG = 0xe6e3dc;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const spring = (s, target, k, dt, zeta = 1) => {
  const a = k * (target - s.x) - 2 * zeta * Math.sqrt(k) * s.v;
  s.v += a * dt;
  s.x += s.v * dt;
};
const sp = (x = 0) => ({ x, v: 0 });

function tearY(x) {
  return TEAR_Y + 0.006 * Math.sin(x * 41 + 0.7) + 0.004 * Math.sin(x * 97 + 2.1) + 0.0025 * Math.sin(x * 173);
}

function pillow(x, y) {
  const ax = Math.min(1, Math.abs((2 * x) / PACK.W));
  const fx = 1 - ax ** 6;
  const fy = (1 - smooth(TEAR_Y - 0.02, CRIMP_TOP, y)) * smooth(CRIMP_BOTTOM, CRIMP_BOTTOM + 0.14, y);
  return SEAM + BULGE * fx * fy;
}

function sheet(THREE, lo, hi, rows, side) {
  const cols = NX + 1;
  const count = cols * (rows + 1);
  const base = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  for (let j = 0; j <= rows; j += 1) {
    for (let i = 0; i <= NX; i += 1) {
      const k = j * cols + i;
      const x = -PACK.W / 2 + (PACK.W * i) / NX;
      const y0 = lo(x);
      const y1 = hi(x);
      const y = y0 + ((y1 - y0) * j) / rows;
      base[k * 3] = x;
      base[k * 3 + 1] = y;
      base[k * 3 + 2] = side * pillow(x, y);
      const u = (x + PACK.W / 2) / PACK.W;
      uvs[k * 2] = side > 0 ? u : 1 - u;
      uvs[k * 2 + 1] = (y + PACK.H / 2) / PACK.H;
    }
  }
  const index = [];
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < NX; i += 1) {
      const a = j * cols + i;
      const b = a + 1;
      const c = a + cols + 1;
      const d = a + cols;
      if (side > 0) index.push(a, b, c, a, c, d);
      else index.push(a, c, b, a, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(base.slice(), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return { geo, base };
}

function deformStrip(part, p, dir) {
  const attr = part.geo.attributes.position;
  const pos = attr.array;
  const base = part.base;
  const xe = dir > 0 ? -PACK.W / 2 + p * PACK.W * 1.04 : PACK.W / 2 - p * PACK.W * 1.04;
  for (let k = 0; k < base.length; k += 3) {
    const x = base[k];
    const y = base[k + 1];
    const z = base[k + 2];
    const d = (xe - x) * dir;
    if (d <= 0) {
      pos[k] = x;
      pos[k + 1] = y;
      pos[k + 2] = z;
      continue;
    }
    const a = 1.35 * smooth(0, 0.26, d);
    const am = a * 0.62;
    pos[k] = xe - dir * d * Math.cos(am) + dir * Math.sin(a) * z;
    pos[k + 1] = y + 0.018 * smooth(0, 0.05, d) + d * 0.11 * smooth(0, 0.3, d);
    pos[k + 2] = d * Math.sin(am) + Math.cos(a) * z;
  }
  attr.needsUpdate = true;
  part.geo.computeVertexNormals();
}

export async function createPack(stage, canvas, { embedded, onChange, insets, getPool, family }) {
  const THREE = await import("three");
  const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
  await document.fonts?.ready;
  const sans = family || "Inter, system-ui, sans-serif";
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(BG);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 40);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envTarget = pmrem.fromScene(room, 0.04);
  room.dispose?.();
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 1.0;
  const key = new THREE.DirectionalLight(0xfff4e6, 1.6);
  key.position.set(-1.5, 2.5, 4);
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 0.5));

  const disposables = [];
  const keep = (x) => {
    disposables.push(x);
    return x;
  };
  const textures = new Set();
  const tex = (cnv, srgb = true) => {
    const t = new THREE.CanvasTexture(cnv);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    textures.add(t);
    return t;
  };
  const dropTex = (t) => {
    if (!t) return;
    textures.delete(t);
    t.dispose();
  };

  const backTex = tex(packBack(sans));
  const bumpTex = tex(crinkleMap(), false);
  const cutTex = tex(cutMask(), false);
  const shadowTex = tex(shadowCanvas());
  const haloTex = tex(haloCanvas());
  let frontTex = null;

  const foil = {
    metalness: 0.48,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    iridescence: 0.5,
    iridescenceIOR: 1.5,
    iridescenceThicknessRange: [220, 620],
    bumpMap: bumpTex,
    bumpScale: 0.8,
    alphaTest: 0.5,
  };
  const frontMat = keep(new THREE.MeshPhysicalMaterial({ ...foil }));
  const backMat = keep(new THREE.MeshPhysicalMaterial({ ...foil, map: backTex, metalness: 0.75, roughness: 0.28, iridescence: 0.3 }));
  const innerMat = keep(
    new THREE.MeshStandardMaterial({
      color: 0xdfe3ea,
      metalness: 0.85,
      roughness: 0.34,
      side: THREE.BackSide,
      alphaMap: cutTex,
      alphaTest: 0.5,
      bumpMap: bumpTex,
      bumpScale: 0.6,
    }),
  );
  const stripFront = keep(frontMat.clone());
  const stripBack = keep(backMat.clone());
  const stripInner = keep(innerMat.clone());
  const stripMats = [stripFront, stripBack, stripInner];

  const packRig = new THREE.Group();
  scene.add(packRig);
  const lowBody = () => -PACK.H / 2;
  const highTop = () => PACK.H / 2;
  const bodyFront = sheet(THREE, lowBody, tearY, BODY_ROWS, 1);
  const bodyBack = sheet(THREE, lowBody, tearY, BODY_ROWS, -1);
  const stripF = sheet(THREE, tearY, highTop, STRIP_ROWS, 1);
  const stripB = sheet(THREE, tearY, highTop, STRIP_ROWS, -1);
  [bodyFront, bodyBack, stripF, stripB].forEach((s) => keep(s.geo));
  packRig.add(new THREE.Mesh(bodyFront.geo, frontMat));
  packRig.add(new THREE.Mesh(bodyFront.geo, innerMat));
  packRig.add(new THREE.Mesh(bodyBack.geo, backMat));
  packRig.add(new THREE.Mesh(bodyBack.geo, innerMat));
  const pivotY = PACK.H / 2 - PACK.TEAR / 2;
  const stripRig = new THREE.Group();
  stripRig.position.set(0, pivotY, 0);
  packRig.add(stripRig);
  const stripMeshes = [
    new THREE.Mesh(stripF.geo, stripFront),
    new THREE.Mesh(stripF.geo, stripInner),
    new THREE.Mesh(stripB.geo, stripBack),
    new THREE.Mesh(stripB.geo, stripInner),
  ];
  for (const m of stripMeshes) {
    m.position.y = -pivotY;
    stripRig.add(m);
  }
  const shadowGeo = keep(new THREE.PlaneGeometry(1, 1));
  const packShadowMat = keep(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false }));
  const packShadow = new THREE.Mesh(shadowGeo, packShadowMat);
  packShadow.scale.set(PACK.W * 1.7, PACK.H * 1.45, 1);
  packShadow.position.set(0.05, -0.08, -0.32);
  packRig.add(packShadow);

  const stackRig = new THREE.Group();
  packRig.add(stackRig);
  const stackShadowMat = keep(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }));
  const stackShadow = new THREE.Mesh(shadowGeo, stackShadowMat);
  stackShadow.scale.set(CARD.W * 1.8, CARD.H * 1.5, 1);
  stackShadow.position.set(0.05, -0.07, -0.3);
  stackRig.add(stackShadow);
  const haloMat = keep(new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }));
  const halo = new THREE.Mesh(shadowGeo, haloMat);
  halo.scale.set(CARD.W * 2.1, CARD.H * 1.8, 1);
  halo.position.set(0, 0, -0.2);
  stackRig.add(halo);
  const cardGeo = keep(new THREE.PlaneGeometry(CARD.W, CARD.H));
  const cards = Array.from({ length: COUNT }, (_, i) => {
    const uniforms = {
      map: { value: null },
      uHolo: { value: i === COUNT - 1 ? 1 : 0 },
      uReveal: { value: 0 },
      uGlow: { value: 0 },
      uTime: { value: 0 },
      uTilt: { value: new THREE.Vector2() },
    };
    const mat = keep(new THREE.ShaderMaterial({ uniforms, vertexShader: cardVertex, fragmentShader: cardFragment, toneMapped: false }));
    const mesh = new THREE.Mesh(cardGeo, mat);
    stackRig.add(mesh);
    return { mesh, mat, uniforms, slot: sp(i), slotT: i, x: sp(0), dragX: 0, mode: "rest", dir: 1, jx: 0, jr: 0, data: null };
  });

  const audio = createPackAudio();
  const st = {
    phase: "sealed",
    loading: false,
    p: sp(0),
    pTarget: 0,
    auto: false,
    dir: 1,
    fly: null,
    u: sp(0),
    uTarget: 0,
    committed: false,
    packY: sp(0),
    fall: null,
    sx: sp(0),
    sy: sp(IN_Y),
    sz: sp(0),
    gap: sp(IN_GAP),
    deal: sp(0),
    tx: sp(0),
    ty: sp(0),
    aimX: 0,
    aimY: 0,
    hover: false,
    order: cards.map((_, i) => i),
    reveal: -1,
    glow: sp(0),
    cam: { x: sp(0), y: sp(0), z: sp(0), w: sp(PACK.W), h: sp(PACK.H) },
    lastActive: performance.now(),
    pack: null,
  };
  let width = 1;
  let height = 1;
  let ppu = 300;
  let raf = 0;
  let visible = true;
  let lost = false;
  let destroyed = false;
  let last = performance.now();
  const time0 = last;

  const say = (message, phase) => onChange?.({ message, phase });

  async function buildPack() {
    const pool = getPool();
    const pack = dealPack(pool);
    const images = await Promise.all([
      ...pack.cards.map((c) => loadCover(c.src, c.remote)),
      loadCover(pack.featured?.cover, false),
    ]);
    if (destroyed) return null;
    const nextFront = tex(packFront(pack.featured, images[COUNT], sans));
    const faces = pack.cards.map((c, i) => tex(cardFace(c, images[i], sans)));
    return { pack, nextFront, faces };
  }

  function applyPack(built) {
    const old = frontTex;
    frontTex = built.nextFront;
    frontMat.map = frontTex;
    stripFront.map = frontTex;
    frontMat.needsUpdate = true;
    stripFront.needsUpdate = true;
    dropTex(old);
    st.pack = built.pack;
    cards.forEach((card, i) => {
      dropTex(card.uniforms.map.value);
      card.uniforms.map.value = built.faces[i];
      card.data = built.pack.cards[i];
      card.jx = (Math.random() - 0.5) * 0.024;
      card.jr = (Math.random() - 0.5) * 0.05;
    });
  }

  function resetState(enter) {
    st.phase = "sealed";
    st.p = sp(0);
    st.pTarget = 0;
    st.auto = false;
    st.dir = 1;
    st.fly = null;
    st.u = sp(0);
    st.uTarget = 0;
    st.committed = false;
    st.fall = null;
    st.packY = sp(enter ? -2.6 : 0);
    st.sx = sp(0);
    st.sy = sp(IN_Y);
    st.sz = sp(0);
    st.gap = sp(IN_GAP);
    st.deal = sp(0);
    st.order = cards.map((_, i) => i);
    st.reveal = -1;
    st.glow = sp(0);
    for (const part of [stripF, stripB]) deformStrip(part, 0, 1);
    stripRig.position.set(0, pivotY, 0);
    stripRig.rotation.set(0, 0, 0);
    stripRig.visible = true;
    for (const m of stripMats) {
      m.transparent = false;
      m.opacity = 1;
      m.needsUpdate = true;
    }
    packRig.visible = true;
    packRig.rotation.set(0, 0, 0);
    packRig.position.set(0, st.packY.x, 0);
    if (stackRig.parent !== packRig) packRig.attach(stackRig);
    stackRig.position.set(0, IN_Y, 0);
    stackRig.rotation.set(0, 0, 0);
    stackRig.visible = false;
    stackShadowMat.opacity = 0;
    haloMat.opacity = 0;
    cards.forEach((card, i) => {
      card.slot = sp(i);
      card.slotT = i;
      card.x = sp(0);
      card.mode = "rest";
      card.uniforms.uReveal.value = 0;
      card.uniforms.uGlow.value = 0;
    });
    say("", "sealed");
  }

  const built = await buildPack();
  if (!built) {
    renderer.dispose();
    throw new Error("destroyed");
  }
  applyPack(built);
  resetState(false);

  function resize() {
    const box = stage.getBoundingClientRect();
    width = Math.max(1, Math.round(box.width));
    height = Math.max(1, Math.round(box.height));
    renderer.setSize(width, height, false);
    wake();
  }

  function fitCamera() {
    const ins = insets();
    const availW = Math.max(40, width - ins.left - ins.right);
    const availH = Math.max(40, height - ins.top - ins.bottom);
    const c = st.cam;
    const wpp = Math.max(c.h.x / availH, c.w.x / availW);
    const fullH = wpp * height;
    const dist = fullH / 2 / Math.tan((FOV * Math.PI) / 360);
    ppu = height / fullH;
    camera.aspect = width / height;
    camera.position.set(c.x.x, c.y.x, c.z.x + dist);
    camera.near = Math.max(0.05, dist * 0.2);
    camera.far = dist * 4 + 4;
    const ox = ins.left + availW / 2 - width / 2;
    const oy = ins.top + availH / 2 - height / 2;
    camera.setViewOffset(width, height, -ox, -oy, width, height);
    camera.updateProjectionMatrix();
  }

  function stackWorld() {
    if (stackRig.parent === packRig) return { x: st.sx.x, y: st.packY.x + st.sy.x, z: st.sz.x };
    return { x: st.sx.x, y: st.sy.x, z: st.sz.x };
  }

  function cameraTarget() {
    const pad = 1.1;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    let z = 0;
    const add = (cx, cy, w, h) => {
      x0 = Math.min(x0, cx - w / 2);
      x1 = Math.max(x1, cx + w / 2);
      y0 = Math.min(y0, cy - h / 2);
      y1 = Math.max(y1, cy + h / 2);
    };
    const packIn = !st.fall;
    const lifted = stackRig.visible && stackWorld().y + CARD.H / 2 > PACK.H / 2;
    if (packIn && lifted) {
      const s = stackWorld();
      const rise = smooth(0.2, CLEAR_Y, s.y);
      const keep = PACK.H * (1 - 0.8 * rise);
      add(0, st.packY.x + PACK.H / 2 - keep / 2, PACK.W, keep);
    }
    else if (packIn) add(0, Math.max(st.packY.x, -0.4), PACK.W, PACK.H);
    if (stackRig.visible) {
      const s = stackWorld();
      if (!packIn) {
        add(s.x, s.y, CARD.W * 1.5, CARD.H);
        z = s.z;
      } else if (s.y + CARD.H / 2 > PACK.H / 2) add(s.x, s.y, CARD.W, CARD.H);
    }
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z, w: (x1 - x0) * pad, h: (y1 - y0) * pad };
  }

  function frontCard() {
    return cards[st.order[0]];
  }

  function announceFront() {
    const c = frontCard().data;
    if (!c) return;
    const at = cards.indexOf(frontCard());
    say(`${c.rarity.name}: ${c.title}${c.year ? `, ${c.year}` : ""}. Card ${c.number} of ${c.count}.`, at === COUNT - 1 && st.reveal >= 0 ? "rare" : "dealt");
  }

  function startTear(dir) {
    if (st.phase !== "sealed") return;
    if (st.p.x < 0.002 && st.pTarget < 0.002) st.dir = dir;
    st.auto = true;
    wake();
  }

  function commitPull() {
    if (st.phase !== "open") return;
    st.committed = true;
    st.uTarget = 1;
    st.phase = "pulling";
    say("Pulling the cards out.", "pulling");
    wake();
  }

  function canSend() {
    if (st.phase !== "dealt") return false;
    const front = frontCard();
    if (front.mode === "out" || front.mode === "in") return false;
    return !cards.some((c) => c.mode === "out" && Math.abs(c.x.x) < X_CLEAR * 0.7);
  }

  function send(dir) {
    if (!canSend()) return false;
    const card = frontCard();
    card.mode = "out";
    card.dir = dir;
    if (card.x.v * dir < 0) card.x.v = 0;
    st.order.push(st.order.shift());
    st.order.forEach((idx, slot) => {
      cards[idx].slotT = slot;
    });
    audio.swish();
    const next = frontCard();
    const nextIdx = cards.indexOf(next);
    if (nextIdx === COUNT - 1 && st.reveal < 0) {
      st.reveal = 0;
      audio.sparkle();
    }
    announceFront();
    wake();
    return true;
  }

  function activate(kind) {
    if (st.loading) return false;
    st.lastActive = performance.now();
    audio.start();
    if (st.phase === "sealed") {
      startTear(kind === "left" ? -1 : 1);
      return true;
    }
    if (st.phase === "open") {
      commitPull();
      return true;
    }
    if (st.phase === "dealt") return send(kind === "right" ? 1 : -1);
    return false;
  }

  const drag = { id: null, x: 0, y: 0, t: 0, mode: null, startP: 0, lastX: 0, lastT: 0, vx: 0, moved: 0 };

  function localPoint(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function aim(pt) {
    st.aimX = clamp((pt.x / width) * 2 - 1, -1, 1);
    st.aimY = clamp((pt.y / height) * 2 - 1, -1, 1);
    st.hover = true;
  }

  function onDown(e) {
    if (drag.id !== null || st.loading) return;
    drag.id = e.pointerId;
    const pt = localPoint(e);
    drag.x = pt.x;
    drag.y = pt.y;
    drag.t = performance.now();
    drag.mode = null;
    drag.moved = 0;
    drag.lastX = pt.x;
    drag.lastT = drag.t;
    drag.vx = 0;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    audio.start();
    st.lastActive = drag.t;
    aim(pt);
    wake();
  }

  function onMove(e) {
    const pt = localPoint(e);
    if (e.pointerType === "mouse" || drag.id === e.pointerId) aim(pt);
    st.lastActive = performance.now();
    wake();
    if (drag.id !== e.pointerId) return;
    const dx = pt.x - drag.x;
    const dy = pt.y - drag.y;
    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
    const now = performance.now();
    const dt = Math.max(1, now - drag.lastT);
    drag.vx = drag.vx * 0.6 + (((pt.x - drag.lastX) / dt) * 1000 * 0.4) / ppu;
    drag.lastX = pt.x;
    drag.lastT = now;
    if (!drag.mode && drag.moved > 6) {
      if (st.phase === "sealed" && Math.abs(dx) >= Math.abs(dy) * 0.7) {
        drag.mode = "tear";
        if (st.p.x < 0.002 && st.pTarget < 0.002) st.dir = dx >= 0 ? 1 : -1;
        drag.startP = st.pTarget;
        drag.x = pt.x - Math.sign(dx) * 6;
      } else if (st.phase === "open" && dy < 0 && Math.abs(dy) > Math.abs(dx) && !embedded) {
        drag.mode = "pull";
      } else if (st.phase === "dealt" && Math.abs(dx) > Math.abs(dy) && canSend()) {
        drag.mode = "swipe";
        const card = frontCard();
        card.mode = "drag";
        drag.startX = card.x.x;
      } else drag.mode = "none";
    }
    if (drag.mode === "tear") {
      const along = ((pt.x - drag.x) * st.dir) / (PACK.W * 0.85 * ppu);
      const next = clamp(Math.max(st.pTarget, drag.startP + along), 0, 1);
      if (next > st.pTarget + 0.002) audio.crinkle(clamp((next - st.pTarget) * 30, 0.3, 1.5));
      st.pTarget = next;
    } else if (drag.mode === "pull") {
      st.uTarget = clamp(-dy / (1.0 * ppu), 0, 1);
    } else if (drag.mode === "swipe") {
      const card = frontCard();
      card.dragX = drag.startX + dx / ppu;
    }
  }

  function onUp(e) {
    if (drag.id !== e.pointerId) return;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {}
    const tap = drag.moved < 6 && performance.now() - drag.t < 500;
    const mode = drag.mode;
    drag.id = null;
    drag.mode = null;
    if (e.pointerType !== "mouse") st.hover = false;
    if (tap) {
      activate("next");
      return;
    }
    if (mode === "tear" && st.pTarget > 0.5) st.auto = true;
    if (mode === "pull") {
      if (st.uTarget > 0.3) commitPull();
      else st.uTarget = 0;
    }
    if (mode === "swipe") {
      const card = frontCard();
      if (card.mode === "drag") {
        const off = card.dragX - card.jx;
        if (Math.abs(off) > 0.16 || Math.abs(drag.vx) > 1.4) {
          card.x.x = card.dragX;
          card.x.v = drag.vx;
          card.mode = "rest";
          send(Math.abs(off) > 0.05 ? Math.sign(off) : Math.sign(drag.vx) || -1);
        } else {
          card.x.x = card.dragX;
          card.x.v = 0;
          card.mode = "rest";
        }
      }
    }
    wake();
  }

  function onLeave(e) {
    if (e.pointerType === "mouse" && drag.id === null) {
      st.hover = false;
      wake();
    }
  }

  function step(dt, now) {
    const t = (now - time0) / 1000;
    const idle = (now - st.lastActive) / 1000;
    const sway = reduced ? 0 : smooth(14, 4, idle);
    const tiltScale = reduced ? 0.35 : 1;
    const tearing = drag.mode === "tear" ? 0.4 : 1;
    const ax = st.hover ? st.aimX : Math.sin(t * 0.6) * 0.35 * sway;
    const ay = st.hover ? st.aimY : Math.sin(t * 0.43 + 1) * 0.25 * sway;
    spring(st.tx, ay * 0.16 * tiltScale * tearing, 60, dt);
    spring(st.ty, ax * 0.26 * tiltScale * tearing, 60, dt);

    if (st.auto) st.pTarget = Math.min(1, st.pTarget + dt * (reduced ? 4 : 1.6));
    const prevP = st.p.x;
    spring(st.p, st.pTarget, 260, dt);
    st.p.x = clamp(st.p.x, 0, 1);
    if (st.auto && st.p.x > prevP + 0.003) audio.crinkle(1);
    if (Math.abs(st.p.x - prevP) > 1e-5 && !st.fly) {
      deformStrip(stripF, st.p.x, st.dir);
      deformStrip(stripB, st.p.x, st.dir);
    }
    if (st.phase === "sealed" && st.p.x > 0.992 && st.pTarget >= 1) {
      st.phase = "open";
      st.auto = false;
      deformStrip(stripF, 1, st.dir);
      deformStrip(stripB, 1, st.dir);
      st.fly = { t: 0, vx: st.dir * 1.7, vy: 0.12, vz: 0.6, spin: st.dir * -1.4 };
      for (const m of stripMats) {
        m.transparent = true;
        m.needsUpdate = true;
      }
      stackRig.visible = true;
      audio.rip();
      say(embedded ? "The foil is open. Tap to pull the cards out." : "The foil is open. Pull the cards up, or tap.", "open");
    }
    if (st.fly) {
      const f = st.fly;
      f.t += dt;
      f.vy -= 3.2 * dt;
      stripRig.position.x += f.vx * dt;
      stripRig.position.y += f.vy * dt;
      stripRig.position.z += f.vz * dt;
      stripRig.rotation.z += f.spin * dt;
      stripRig.rotation.x -= 0.9 * dt;
      const o = 1 - smooth(0.15, reduced ? 0.3 : 0.75, f.t);
      for (const m of stripMats) m.opacity = o;
      if (o <= 0) {
        stripRig.visible = false;
        st.fly = null;
      }
    }

    if (st.phase === "open" || st.phase === "pulling") {
      spring(st.u, st.uTarget, st.committed ? 46 : 140, dt);
      const e = smooth(0, 1, clamp(st.u.x, 0, 1));
      st.sy.x = IN_Y + (CLEAR_Y - IN_Y) * e;
      if (st.committed && st.u.x > 0.985) {
        st.phase = "pulled";
        scene.attach(stackRig);
        st.sx = sp(stackRig.position.x);
        st.sy = sp(stackRig.position.y);
        st.sz = sp(stackRig.position.z);
      }
    }
    if (st.phase === "pulled" || st.phase === "dealt") {
      spring(st.sx, 0, 50, dt);
      spring(st.sy, CLEAR_Y, 50, dt);
      spring(st.sz, OUT_Z, 50, dt);
      spring(st.gap, DEAL_GAP, 80, dt);
      spring(st.deal, 1, 60, dt);
      if (!st.fall && st.sz.x > 0.18) st.fall = { v: 0, spin: (Math.random() - 0.5) * 0.6 };
      if (st.phase === "pulled" && st.sz.x > OUT_Z - 0.03) {
        st.phase = "dealt";
        announceFront();
      }
      stackShadowMat.opacity = 0.6 * st.deal.x;
    }
    if (st.fall) {
      st.fall.v -= 7 * dt;
      st.packY.x += st.fall.v * dt;
      packRig.rotation.z += st.fall.spin * dt;
      if (st.packY.x < -6) packRig.visible = false;
    } else spring(st.packY, 0, 70, dt, 0.8);

    packRig.position.y = st.packY.x;
    packRig.rotation.x = st.tx.x;
    packRig.rotation.y = st.ty.x;
    if (stackRig.parent === packRig) {
      stackRig.position.set(st.sx.x, st.sy.x, st.sz.x);
      stackRig.rotation.set(0, 0, 0);
    } else {
      stackRig.position.set(st.sx.x, st.sy.x, st.sz.x);
      stackRig.rotation.x = st.tx.x;
      stackRig.rotation.y = st.ty.x;
    }

    const gap = st.gap.x;
    const mid = (COUNT - 1) / 2;
    const zOf = (slot) => (mid - slot) * gap;
    let minRest = Infinity;
    for (const card of cards) {
      spring(card.slot, card.slotT, 420, dt);
      if (card.mode === "rest" || card.mode === "drag") minRest = Math.min(minRest, zOf(card.slot.x));
    }
    for (const card of cards) {
      const restX = card.jx * st.deal.x;
      if (card.mode === "drag") {
        card.x.x = card.dragX;
      } else if (card.mode === "out") {
        const reach = Math.min(1, Math.max(0.68, (width / 2 / ppu - CARD.W * 0.1) / X_OUT));
        spring(card.x, card.dir * X_OUT * reach, 170, dt);
        if (Math.abs(card.x.x) > X_CLEAR * reach) {
          card.mode = "in";
          card.slot.x = card.slotT;
          card.slot.v = 0;
        }
      } else if (card.mode === "in") {
        spring(card.x, restX, 130, dt);
        if (Math.abs(card.x.x - restX) < 0.002 && Math.abs(card.x.v) < 0.02) card.mode = "rest";
      } else spring(card.x, restX, 200, dt);
      let z = zOf(card.slot.x);
      if (card.mode === "out") {
        const tuck = smooth(0.28, X_CLEAR, Math.abs(card.x.x - restX));
        z = zOf(0) + 0.06 + (Math.min(zOf(card.slotT), minRest - 0.004) - zOf(0) - 0.06) * tuck;
      }
      if (card.mode === "in") z = Math.min(zOf(card.slotT), minRest - 0.004);
      const off = card.x.x - restX;
      card.mesh.position.set(card.x.x, 0, z);
      card.mesh.rotation.z = card.jr * st.deal.x - off * 0.12;
      card.mesh.rotation.y = card.mode === "out" || card.mode === "in" ? off * 0.25 : 0;
      card.uniforms.uTime.value = t;
      card.uniforms.uTilt.value.set(st.ty.x + off * 0.4, st.tx.x);
    }

    const rare = cards[COUNT - 1];
    if (st.reveal >= 0 && st.reveal < 1) st.reveal = Math.min(1, st.reveal + dt / (reduced ? 0.6 : 1.4));
    rare.uniforms.uReveal.value = Math.max(0, st.reveal);
    const rareFront = frontCard() === rare && st.phase === "dealt";
    spring(st.glow, rareFront && st.reveal >= 0 ? 1 : 0, 30, dt);
    rare.uniforms.uGlow.value = st.glow.x;
    haloMat.opacity = clamp(st.glow.x, 0, 1) * (0.55 + 0.15 * Math.sin(t * 2.2));

    const target = cameraTarget();
    const c = st.cam;
    const camK = st.phase === "open" || st.phase === "pulling" ? 900 : 40;
    spring(c.x, target.x, camK, dt);
    spring(c.y, target.y, camK, dt);
    spring(c.z, target.z, camK, dt);
    spring(c.w, target.w, camK, dt);
    spring(c.h, target.h, camK, dt);

    const moving =
      Math.abs(st.tx.v) + Math.abs(st.ty.v) + Math.abs(st.p.v) + Math.abs(st.u.v) + Math.abs(c.y.v) + Math.abs(c.h.v) + Math.abs(st.sz.v) + Math.abs(st.packY.v) >
      1e-4;
    const cardsMoving = cards.some((k) => k.mode !== "rest" || Math.abs(k.x.v) > 1e-4 || Math.abs(k.slot.v) > 1e-4);
    return (
      moving ||
      cardsMoving ||
      sway > 0 ||
      st.auto ||
      st.fly ||
      (st.fall && packRig.visible) ||
      (st.reveal >= 0 && st.reveal < 1) ||
      rareFront ||
      st.phase === "pulling" ||
      st.phase === "pulled" ||
      drag.id !== null
    );
  }

  function frame(now) {
    raf = 0;
    if (destroyed || lost || !visible) return;
    const dt = Math.min(1 / 30, Math.max(0, (now - last) / 1000));
    last = now;
    let busy = false;
    const sub = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < sub; i += 1) busy = step(dt / sub, now) || busy;
    fitCamera();
    renderer.render(scene, camera);
    if (busy) raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (raf || destroyed || lost || !visible) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && document.visibilityState !== "hidden";
    if (visible) wake();
  });
  io.observe(stage);
  const onVis = () => {
    visible = document.visibilityState !== "hidden";
    if (visible) wake();
  };
  document.addEventListener("visibilitychange", onVis);
  const onLost = (e) => {
    e.preventDefault();
    lost = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  const onRestored = () => {
    lost = false;
    for (const t of textures) t.needsUpdate = true;
    wake();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  resize();

  return {
    key(kind) {
      return activate(kind);
    },
    async reset() {
      if (st.loading) return;
      st.loading = true;
      audio.start();
      say("Opening a new pack.", st.phase);
      const next = await buildPack();
      st.loading = false;
      if (!next || destroyed) return;
      applyPack(next);
      resetState(true);
      st.lastActive = performance.now();
      wake();
      say("A new sealed pack. Drag across the top to tear it open, or tap.", "sealed");
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      audio.destroy();
      for (const t of textures) t.dispose();
      textures.clear();
      for (const d of disposables) d.dispose();
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
