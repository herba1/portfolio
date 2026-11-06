import * as THREE from "three";
import { createStage, clamp, damp } from "../_kit/stage";
import { loadImage } from "../_kit/covers";

// An accordion-fold book after Ruscha's Sunset Strip. Eight panels hinged
// at seven creases. Shut, it lies on the table as a small silver block.
// Pulled, it rises onto its spine and the creases let go one at a time,
// each a damped spring, so the strip stands as a zig-zag that every panel
// lights differently.

const BG = "#f2f0eb";
const N = 8;
const PH = 1; // panel height
const PW = 0.79; // panel width (Ruscha's book is 5 5/8 x 7 1/8 in)
const DEPTH = 0.0068; // board thickness
const GAP = 0.0082; // fold allowance between stacked panels
const TURN_OPEN = 0.96; // heading change at an open crease, radians
const TEX_PANEL = 512;

const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function makeEnvironment(renderer) {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(30, 30, 30), new THREE.MeshBasicMaterial({ color: new THREE.Color("#a9a8a5"), side: THREE.BackSide })));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: new THREE.Color("#d9d4ca") }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2;
  scene.add(floor);
  const panel = (w, h, pos, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.97, 0.92).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.copy(pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  panel(10, 6, new THREE.Vector3(-4, 10, 6), 5);
  panel(2, 10, new THREE.Vector3(12, 3, 2), 2.4);
  panel(16, 3, new THREE.Vector3(-2, 4.5, -10), 2.1);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  scene.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  return env;
}

// The printed strip: one street along the top, the facing side upside down
// along the bottom, street numbers in the gutter, on warm uncoated stock.
async function paintStrip() {
  const css = getComputedStyle(document.body);
  const mono = css.getPropertyValue("--font-geist-mono").trim() || "ui-monospace, monospace";
  const [img] = await Promise.all([loadImage("/accordion/street.jpg"), document.fonts.load(`500 16px ${mono}`).catch(() => null)]);

  const W = TEX_PANEL * N;
  const H = Math.round((TEX_PANEL * PH) / PW);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#f5f2eb";
  g.fillRect(0, 0, W, H);

  // Paper tooth: faint, large-grained noise so lit faces are not plastic.
  const tooth = g.getImageData(0, 0, W, H);
  for (let i = 0; i < tooth.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 7;
    tooth.data[i] += n;
    tooth.data[i + 1] += n;
    tooth.data[i + 2] += n;
  }
  g.putImageData(tooth, 0, 0);

  // Each source band is cropped to its middle rows so the strip keeps air.
  const half = img.height / 2;
  const sh = half * 0.74;
  const sy = (half - sh) / 2;
  const bandH = Math.round((W * sh) / img.width);
  const margin = Math.round((H - 2 * bandH) * 0.24);
  const topY = margin;
  const botY = H - margin - bandH;

  g.save();
  g.filter = "grayscale(1) contrast(1.4) brightness(1.06)";
  g.drawImage(img, 0, sy, img.width, sh, 0, topY, W, bandH);
  g.translate(W, botY + bandH);
  g.rotate(Math.PI);
  g.drawImage(img, 0, half + sy, img.width, sh, 0, 0, W, bandH);
  g.restore();
  // Halftone stock prints a little warm and never reaches true black.
  g.save();
  g.globalCompositeOperation = "multiply";
  g.fillStyle = "#efe8dc";
  g.fillRect(0, topY, W, bandH);
  g.fillRect(0, botY, W, bandH);
  g.globalCompositeOperation = "screen";
  g.fillStyle = "#141210";
  g.fillRect(0, topY, W, bandH);
  g.fillRect(0, botY, W, bandH);
  g.restore();

  // Street numbers, Ruscha-style: under each frontage on the near side,
  // upside down over each frontage on the far side.
  g.fillStyle = "#3d3933";
  g.font = `500 15px ${mono}`;
  g.textBaseline = "top";
  let x = 60;
  let num = 1520;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  while (x < W - 80) {
    g.fillText(String(num), x, topY + bandH + 12);
    num += 2 + 2 * Math.floor(rnd() * 6);
    x += 150 + rnd() * 260;
  }
  g.save();
  g.translate(W, botY);
  g.rotate(Math.PI);
  x = 90;
  num = 1521;
  while (x < W - 80) {
    g.fillText(String(num), x, 12);
    num += 2 + 2 * Math.floor(rnd() * 6);
    x += 150 + rnd() * 260;
  }
  g.restore();
  return c;
}

function panelGeometry(i) {
  const geo = new THREE.BoxGeometry(PW, PH, DEPTH);
  geo.translate(PW / 2, PH / 2, 0);
  const uv = geo.attributes.uv;
  // +z face (group 4, vertices 16..19) carries this panel's slice of the strip.
  for (let v = 16; v < 20; v += 1) uv.setX(v, (i + uv.getX(v)) / N);
  return geo;
}

export async function createAccordion(host) {
  const params = new URLSearchParams(location.search);
  const still = params.has("t") ? clamp(parseFloat(params.get("t")) || 0, 0, 1) : null;

  const stage = createStage(host, { dpr: 2, webgl: true });
  const { canvas } = stage;
  canvas.style.cursor = "grab";
  const renderer = new THREE.WebGLRenderer({ canvas, context: stage.ctx, antialias: true });
  renderer.setClearColor(BG, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;

  const scene = new THREE.Scene();
  scene.environment = makeEnvironment(renderer);
  scene.environmentIntensity = 0.35;
  const camera = new THREE.PerspectiveCamera(20, 1, 0.5, 80);

  scene.add(new THREE.HemisphereLight("#fffaf1", "#bdb3a3", 0.75));
  const key = new THREE.DirectionalLight("#fff4e6", 2.6);
  key.position.set(-7, 6.5, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
  key.shadow.radius = 10;
  key.shadow.blurSamples = 20;
  key.shadow.bias = -0.0006;
  scene.add(key);
  const rim = new THREE.DirectionalLight("#eef1ff", 0.5);
  rim.position.set(6, 2.5, -3);
  scene.add(rim);

  const table = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ color: new THREE.Color("#3a2c1d"), opacity: 0.3 }));
  table.rotation.x = -Math.PI / 2;
  table.receiveShadow = true;
  scene.add(table);

  const stripTex = new THREE.CanvasTexture(await paintStrip());
  stripTex.colorSpace = THREE.SRGBColorSpace;
  stripTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const print = new THREE.MeshStandardMaterial({ map: stripTex, roughness: 0.86 });
  const paper = new THREE.MeshStandardMaterial({ color: "#f3f0e8", roughness: 0.9 });
  const edge = new THREE.MeshStandardMaterial({ color: "#e9e4d9", roughness: 0.95 });
  const silver = new THREE.MeshStandardMaterial({ color: "#e6e6e4", metalness: 1, roughness: 0.26, envMapIntensity: 1.5 });

  const book = new THREE.Group(); // centred on the table
  const tilt = new THREE.Group(); // rotates about the spine: lying to standing
  book.add(tilt);
  scene.add(book);
  // Contact shade under the shut book: a board this thin barely casts a
  // shadow from a high key, but it still darkens the table where it sits.
  const blob = document.createElement("canvas");
  blob.width = 256;
  blob.height = 256;
  const bg = blob.getContext("2d");
  bg.filter = "blur(14px)";
  bg.fillStyle = "#000";
  bg.fillRect(40, 46, 176, 164);
  const contactMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(blob), color: "#3a2c1d", transparent: true, depthWrite: false, opacity: 0 });
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(PH * 1.55, PW * 1.8), contactMat);
  contact.rotation.x = -Math.PI / 2;
  contact.position.set(-PH / 2 + 0.03, 0.001, -PW / 2 + 0.03);
  book.add(contact);
  const panels = [];
  for (let i = 0; i < N; i += 1) {
    const back = i === 0 || i === N - 1 ? silver : paper;
    const m = new THREE.Mesh(panelGeometry(i), [edge, edge, edge, edge, print, back]);
    m.castShadow = true;
    m.receiveShadow = true;
    tilt.add(m);
    panels.push(m);
  }

  // Each crease: openness 0 (folded flat) .. 1 (open), sprung.
  const creases = Array.from({ length: N - 1 }, (_, i) => ({ x: 0, v: 0, k: 140 * (1 + 0.22 * Math.sin(i * 2.7 + 1)) }));
  const tiltS = { x: Math.PI / 2, v: 0 };
  let open = 0;
  let target = 0;

  const targets = (o) => {
    const p = clamp((o - 0.07) / 0.93, 0, 1) * (N - 1 + 0.4);
    return {
      tilt: (Math.PI / 2) * (1 - smooth(0, 0.09, o)),
      crease: creases.map((_, i) => smooth(0, 1, p - i * 0.92)),
    };
  };

  const layout = () => {
    let u = DEPTH;
    let v = 0;
    let phi = -(Math.PI - (Math.PI - TURN_OPEN) * creases[0].x) / 2;
    for (let i = 0; i < N; i += 1) {
      const m = panels[i];
      m.position.set(u, 0, v);
      m.rotation.y = -phi;
      // Panels alternate a hair forward and back so a shut stack never fights.
      u += PW * Math.cos(phi);
      v += PW * Math.sin(phi);
      if (i < N - 1) {
        const c = creases[i].x;
        const turn = Math.PI - (Math.PI - TURN_OPEN) * c;
        u += GAP * (1 - c) * (1 - c);
        phi += i % 2 === 0 ? turn : -turn;
      }
    }
    tilt.rotation.z = tiltS.x;
    // Shut, it lies a little askew, as a book put down by hand does.
    const lying = clamp(tiltS.x / (Math.PI / 2), 0, 1);
    book.rotation.y = -0.16 * lying;
    contactMat.opacity = 0.5 * lying ** 3;
    contact.visible = lying > 0.01;
    book.position.set(0, 0, 0);
    book.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(tilt, true);
    book.position.x = -(box.min.x + box.max.x) / 2;
    book.position.z = -(box.min.z + box.max.z) / 2 + 0.15;
  };

  const settle = (o) => {
    const t = targets(o);
    tiltS.x = t.tilt;
    creases.forEach((c, i) => {
      c.x = t.crease[i];
      c.v = 0;
    });
  };

  let span = 600; // pointer px for a full unfold
  const fit = (w, h) => {
    const aspect = w / h;
    camera.aspect = aspect;
    const elev = THREE.MathUtils.degToRad(24);
    const vf = THREE.MathUtils.degToRad(camera.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    const want = N * PW * Math.cos(TURN_OPEN / 2) * 1.32; // strip plus air
    const dist = Math.max(want / 2 / Math.tan(hf / 2), 3.2 / 2 / Math.tan(vf / 2));
    const target3 = new THREE.Vector3(0, 0.36, 0);
    camera.position.set(0, Math.sin(elev) * dist, Math.cos(elev) * dist).add(target3);
    camera.lookAt(target3);
    camera.updateProjectionMatrix();
    span = (w * 0.76) / 2 / 0.92; // stack moves at half the strip's growth
  };
  let dirty = true;
  stage.onResize((w, h, dpr) => {
    dirty = true;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    fit(w, h);
  });

  // Input: drag sideways anywhere; the stack follows the hand.
  let drag = null;
  const rubber = (x) => (x < 0 ? x * 0.15 : x > 1 ? 1 + (x - 1) * 0.15 : x);
  stage.on("down", (p) => {
    drag = { x: p.x, from: target };
    canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (!drag) return;
    target = rubber(drag.from + (p.x - drag.x) / span);
  });
  stage.on("up", (p) => {
    if (!drag) return;
    drag = null;
    canvas.style.cursor = "grab";
    let t = clamp(target + (p.vx * 0.14) / span, 0, 1);
    if (t < 0.08) t = 0;
    if (t > 0.94) t = 1;
    target = t;
  });

  if (still != null) {
    open = target = still;
    settle(still);
  }

  stage.onFrame((dt) => {
    open = damp(open, target, drag ? 16 : 7, dt);
    const t = targets(open);
    // Hinges: stiff paper, slightly underdamped, a few sub-steps for stability.
    const steps = 3;
    const h = dt / steps;
    for (let s = 0; s < steps; s += 1) {
      for (let i = 0; i < creases.length; i += 1) {
        const c = creases[i];
        const zeta = 0.42;
        c.v += (c.k * (t.crease[i] - c.x) - 2 * zeta * Math.sqrt(c.k) * c.v) * h;
        c.x += c.v * h;
        if (c.x < 0) {
          c.x = 0;
          c.v *= -0.2;
        }
        if (c.x > 1.06) {
          c.x = 1.06;
          c.v = 0;
        }
      }
      const kt = 70;
      tiltS.v += (kt * (t.tilt - tiltS.x) - 2 * 0.9 * Math.sqrt(kt) * tiltS.v) * h;
      tiltS.x = clamp(tiltS.x + tiltS.v * h, -0.02, Math.PI / 2);
    }
    // Sleep once everything has come to rest.
    let motion = Math.abs(open - target) + Math.abs(tiltS.v) + Math.abs(t.tilt - tiltS.x);
    for (let i = 0; i < creases.length; i += 1) motion += Math.abs(creases[i].v) + Math.abs(t.crease[i] - creases[i].x);
    if (motion < 1e-4 && !drag && !dirty) return;
    dirty = false;
    layout();
    renderer.render(scene, camera);
  });

  return {
    destroy() {
      stage.destroy();
      stripTex.dispose();
      scene.traverse((o) => o.geometry?.dispose());
      [print, paper, edge, silver, contactMat].forEach((m) => m.dispose());
      contactMat.map.dispose();
      scene.environment?.dispose();
      renderer.dispose();
    },
  };
}
