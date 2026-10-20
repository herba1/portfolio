import * as THREE from "three";

import { INK, PAPER, SHEET_H, SHEET_W, TABLE, drawBack, drawFront, drawTable, newCanvas, noiseData } from "./noteArt";
import { createRustle } from "./noteAudio";
import { bakeFragment, bakeVertex, contactFragment, contactVertex, paperMap, paperNormal, paperUniforms } from "./noteShader";

const NX = 40;
const NY = 56;
const HB = 0.0012;
const HA = 0.003;
const FOV = 30;
const TILT = 0.19;
const PI = Math.PI;
const LIGHT = new THREE.Vector3(-0.8, 0.44, 0.42).normalize();
const SETTLED = 0.0015;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const damp = (x, y, lambda, dt) => x + (y - x) * (1 - Math.exp(-lambda * dt));

function flap(s, angle, curl, length) {
  const p0 = angle + curl;
  const k = (-2 * curl) / length;
  if (Math.abs(k) < 1e-5) return [s * Math.cos(p0), s * Math.sin(p0), p0];
  const p1 = p0 + k * s;
  return [(Math.sin(p1) - Math.sin(p0)) / k, (Math.cos(p0) - Math.cos(p1)) / k, p1];
}

function makeFold() {
  return { angle: PI, vel: 0, target: PI, held: false, mem: 1, closed: true, opened: false };
}

export async function createNote(stage, canvas, { family, reducedMotion = false, onChange = () => {} } = {}) {
  const host = stage.closest(".piece-box") || stage;
  try {
    await Promise.all([document.fonts.load(`80px ${family}`, "Took the first train"), document.fonts.ready]);
  } catch {}

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(new THREE.Color(TABLE), 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 20);
  camera.up.set(0, 1, 0);

  const sun = new THREE.DirectionalLight(0xfffaf4, 6);
  sun.position.copy(LIGHT).multiplyScalar(4);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -1.1;
  sun.shadow.camera.right = 1.1;
  sun.shadow.camera.top = 1.1;
  sun.shadow.camera.bottom = -1.1;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 7;
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.0012;
  sun.shadow.radius = 7;
  scene.add(sun, sun.target);
  const sky = new THREE.HemisphereLight(0xf1f3f6, 0xd8d6d2, 3.3);
  sky.position.set(0, 0, 1);
  scene.add(sky);

  const tableCanvas = drawTable(newCanvas(256, 256));
  const tableTex = new THREE.CanvasTexture(tableCanvas);
  tableTex.colorSpace = THREE.SRGBColorSpace;
  tableTex.wrapS = THREE.RepeatWrapping;
  tableTex.wrapT = THREE.RepeatWrapping;
  tableTex.repeat.set(18, 18);
  tableTex.anisotropy = 8;
  const tableGeo = new THREE.PlaneGeometry(12, 12);
  const tableMat = new THREE.MeshStandardMaterial({ map: tableTex, roughness: 1, metalness: 0 });
  const table = new THREE.Mesh(tableGeo, tableMat);
  table.position.z = -0.0012;
  table.receiveShadow = true;
  scene.add(table);

  const contactUniforms = { uRect: { value: new THREE.Vector4(-0.5, 0, 0, 0.7) }, uStrength: { value: 0.32 } };
  const contactMat = new THREE.ShaderMaterial({
    uniforms: contactUniforms,
    vertexShader: contactVertex,
    fragmentShader: contactFragment,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
  });
  const contactGeo = new THREE.PlaneGeometry(3, 3);
  const contact = new THREE.Mesh(contactGeo, contactMat);
  contact.position.z = -0.0006;
  scene.add(contact);

  const noiseTex = new THREE.DataTexture(noiseData(256), 256, 256, THREE.RGBAFormat);
  noiseTex.wrapS = THREE.RepeatWrapping;
  noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.minFilter = THREE.LinearFilter;
  noiseTex.needsUpdate = true;
  const bakeH = 1434;
  const bakeW = Math.round((bakeH * SHEET_W) / SHEET_H);
  const patternTarget = new THREE.WebGLRenderTarget(bakeW, bakeH, {
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
  });
  const bakeMat = new THREE.ShaderMaterial({
    uniforms: {
      uNoise: { value: noiseTex },
      uAspect: { value: SHEET_W / SHEET_H },
      uRes: { value: new THREE.Vector2(bakeW, bakeH) },
      uLightDir: { value: new THREE.Vector2(LIGHT.x, LIGHT.y).normalize() },
      uSeedShift: { value: new THREE.Vector2(0.34, 0.62) },
      uRoughness: { value: 0.2 },
      uRoughnessSize: { value: 0.55 },
      uRoughnessRows: { value: 0.22 },
      uFiber: { value: 0.36 },
      uFiberSize: { value: 0.3 },
    },
    vertexShader: bakeVertex,
    fragmentShader: bakeFragment,
    depthTest: false,
    depthWrite: false,
  });
  const bakeGeo = new THREE.PlaneGeometry(2, 2);
  const bakeScene = new THREE.Scene();
  bakeScene.add(new THREE.Mesh(bakeGeo, bakeMat));
  renderer.setRenderTarget(patternTarget);
  renderer.render(bakeScene, camera);
  renderer.setRenderTarget(null);

  const frontTex = new THREE.CanvasTexture(drawFront(newCanvas(), family));
  frontTex.colorSpace = THREE.SRGBColorSpace;
  frontTex.anisotropy = 8;
  const backTex = new THREE.CanvasTexture(drawBack(newCanvas(), family));
  backTex.colorSpace = THREE.SRGBColorSpace;
  backTex.anisotropy = 8;

  const paperUniformValues = {
    uBack: { value: backTex },
    uPaper: { value: new THREE.Color(PAPER) },
    uInk: { value: new THREE.Color(INK) },
    uSheet: { value: new THREE.Vector2(SHEET_W, SHEET_H) },
    uMem: { value: new THREE.Vector2(1, 1) },
    uFold: { value: new THREE.Vector2(1, 1) },
    uGrain: { value: 0.045 },
  };
  const paperMat = new THREE.MeshStandardMaterial({
    map: frontTex,
    bumpMap: patternTarget.texture,
    bumpScale: 0.22,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
  });
  paperMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, paperUniformValues);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${paperUniforms}`)
      .replace("#include <map_fragment>", paperMap)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${paperNormal}`);
  };

  const paperGeo = new THREE.BufferGeometry();
  const count = (NX + 1) * (NY + 1);
  const flat = new Float32Array(count * 2);
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const index = [];
  for (let j = 0; j <= NY; j += 1) {
    for (let i = 0; i <= NX; i += 1) {
      const k = j * (NX + 1) + i;
      flat[k * 2] = -SHEET_W / 2 + (SHEET_W * i) / NX;
      flat[k * 2 + 1] = -SHEET_H / 2 + (SHEET_H * j) / NY;
      uvs[k * 2] = i / NX;
      uvs[k * 2 + 1] = j / NY;
    }
  }
  for (let j = 0; j < NY; j += 1) {
    for (let i = 0; i < NX; i += 1) {
      const a = j * (NX + 1) + i;
      const b = a + 1;
      const c = a + NX + 1;
      const d = c + 1;
      index.push(a, b, d, a, d, c);
    }
  }
  paperGeo.setIndex(index);
  paperGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  paperGeo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  const paper = new THREE.Mesh(paperGeo, paperMat);
  paper.castShadow = true;
  paper.receiveShadow = true;
  paper.frustumCulled = false;
  scene.add(paper);

  const folds = { a: makeFold(), b: makeFold() };
  const queue = [];
  const view = { w: 1, h: 1, aspect: 1, compact: false, target: new THREE.Vector3(), dist: 3, fullDist: 3, tan: 0.27, fillH: 0.78, fillW: 0.8 };
  const cam = { x: -SHEET_W / 4, y: SHEET_H / 4, dist: 2 };
  const rustle = createRustle();
  let raf = 0;
  let last = 0;
  let visible = true;
  let destroyed = false;
  let drag = null;
  let hover = false;
  let calm = 0;

  function effective(fold) {
    const residual = 0.035 * fold.mem;
    return fold.angle + residual * (1 - fold.angle / PI);
  }

  function curlOf(fold, angle) {
    return clamp(-0.07 * fold.vel, -0.38, 0.38) * Math.sin(angle) + 0.06 * fold.mem * Math.sin(angle);
  }

  function shape() {
    const bAngle = effective(folds.b);
    const aAngle = effective(folds.a);
    const bCurl = curlOf(folds.b, bAngle);
    const aCurl = curlOf(folds.a, aAngle);
    const bLift = HB * (1 - Math.cos(bAngle));
    const aLift = HA * (1 - Math.cos(aAngle));
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < count; k += 1) {
      const x = flat[k * 2];
      const y = flat[k * 2 + 1];
      let py = y;
      let pz = 0;
      if (y < 0) {
        const [along, up] = flap(-y, bAngle, bCurl, SHEET_H / 2);
        py = -along;
        pz = up + bLift;
      }
      let px = x;
      if (x > 0) {
        const [along, up, dir] = flap(x, aAngle, aCurl, SHEET_W / 2);
        px = along - Math.sin(dir) * pz;
        pz = up + Math.cos(dir) * pz + aLift;
      }
      positions[k * 3] = px;
      positions[k * 3 + 1] = py;
      positions[k * 3 + 2] = pz;
      if (pz < 0.012) {
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    }
    paperGeo.attributes.position.needsUpdate = true;
    paperGeo.computeVertexNormals();
    if (minX < maxX) contactUniforms.uRect.value.set(minX, minY, maxX, maxY);
  }

  function framing() {
    const xMax = Math.max(0, (SHEET_W / 2) * Math.cos(folds.a.target));
    const yMin = Math.min(0, -(SHEET_H / 2) * Math.cos(folds.b.target));
    const cx = (-SHEET_W / 2 + xMax) / 2;
    const cy = (yMin + SHEET_H / 2) / 2;
    const area = ((xMax + SHEET_W / 2) / SHEET_W) * ((SHEET_H / 2 - yMin) / SHEET_H);
    const open = clamp((area - 0.25) / 0.75, 0, 1);
    const fit = Math.max((SHEET_H / 2 - yMin) / (2 * view.fillH * view.tan), (xMax + SHEET_W / 2) / (2 * view.fillW * view.tan * view.aspect));
    return { cx, cy, dist: Math.max(fit, view.fullDist * (0.7 + 0.3 * open)) };
  }

  function layout() {
    const rect = host.getBoundingClientRect();
    view.w = Math.max(1, rect.width);
    view.h = Math.max(1, rect.height);
    view.aspect = view.w / view.h;
    view.compact = view.w < 900;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const fillH = view.compact ? 0.6 : 0.78;
    const fillW = view.compact ? 0.86 : 0.8;
    view.fullDist = Math.max(SHEET_H / (2 * fillH * tan), SHEET_W / (2 * fillW * tan * view.aspect));
    view.tan = tan;
    view.fillH = fillH;
    view.fillW = fillW;
    camera.aspect = view.aspect;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(view.w, view.h, false);
  }

  function placeCamera() {
    const lift = view.compact ? 0.06 * SHEET_H : 0;
    const tx = cam.x;
    const ty = cam.y + lift;
    camera.position.set(tx, ty - cam.dist * Math.sin(TILT), cam.dist * Math.cos(TILT));
    camera.lookAt(tx, ty, 0);
  }

  function legal(name) {
    if (name === "a") return folds.b.angle > PI - 0.04 && folds.b.target === PI;
    return folds.a.angle < 0.04 && folds.a.target === 0;
  }

  function stepFold(fold, dt) {
    const k = fold.held ? 320 : 34;
    const c = 2 * Math.sqrt(k) * (fold.held ? 1 : 1.04);
    const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / sub;
    for (let i = 0; i < sub; i += 1) {
      const acc = k * (fold.target - fold.angle) - c * fold.vel;
      fold.vel += acc * h;
      fold.angle += fold.vel * h;
      if (fold.angle < 0) {
        fold.angle = 0;
        if (fold.vel < 0) fold.vel = 0;
      }
      if (fold.angle > PI) {
        fold.angle = PI;
        if (fold.vel > 0) fold.vel = 0;
      }
    }
    const closed = fold.angle > PI - 0.02;
    const open = fold.angle < 0.02;
    if (closed && !fold.closed) {
      fold.closed = true;
      if (fold.cycled) fold.mem = Math.min(2.2, fold.mem + 0.22);
      fold.cycled = false;
      rustle.crease();
    }
    if (!closed && fold.angle < PI / 2) fold.closed = false;
    if (open && !fold.opened) {
      fold.opened = true;
      fold.cycled = true;
      rustle.land(0.8);
    }
    if (fold.angle > PI / 2) fold.opened = false;
  }

  function runQueue() {
    while (queue.length) {
      const next = queue[0];
      const fold = folds[next.fold];
      if (fold.target === next.to && Math.abs(fold.angle - next.to) < 0.03) {
        queue.shift();
        continue;
      }
      if (fold.target === next.to) return;
      if (!legal(next.fold)) return;
      fold.target = next.to;
      announce();
      return;
    }
  }

  function state() {
    const a = folds.a.target;
    const b = folds.b.target;
    if (a === PI) return "folded";
    if (b === PI) return "half";
    return "open";
  }

  function announce() {
    onChange({ state: state() });
  }

  function tick(now) {
    raf = 0;
    if (destroyed || !visible) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    runQueue();
    stepFold(folds.a, dt);
    stepFold(folds.b, dt);
    paperUniformValues.uMem.value.set(folds.a.mem, folds.b.mem);
    paperUniformValues.uFold.value.set(Math.min(1, folds.a.angle / 1.2), Math.min(1, folds.b.angle / 1.2));
    rustle.motion(Math.abs(folds.a.vel) + Math.abs(folds.b.vel));
    if (!drag) {
      const f = framing();
      const lambda = reducedMotion ? 30 : 2.4;
      cam.x = damp(cam.x, f.cx, lambda, dt);
      cam.y = damp(cam.y, f.cy, lambda, dt);
      cam.dist = damp(cam.dist, f.dist, lambda, dt);
    }
    shape();
    placeCamera();
    renderer.render(scene, camera);
    const f = framing();
    const moving =
      drag ||
      queue.length ||
      Math.abs(folds.a.vel) > SETTLED ||
      Math.abs(folds.b.vel) > SETTLED ||
      Math.abs(folds.a.angle - folds.a.target) > SETTLED ||
      Math.abs(folds.b.angle - folds.b.target) > SETTLED ||
      Math.abs(cam.x - f.cx) > 0.0004 ||
      Math.abs(cam.y - f.cy) > 0.0004 ||
      Math.abs(cam.dist - f.dist) > 0.0006;
    calm = moving ? 0 : calm + 1;
    if (calm > 4) {
      rustle.motion(0);
      last = 0;
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function wake() {
    calm = 0;
    if (!raf && visible && !destroyed) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tablePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  function aim(event) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }

  function tablePoint(event) {
    aim(event);
    return raycaster.ray.intersectPlane(tablePlane, new THREE.Vector3());
  }

  function hitPaper(event) {
    aim(event);
    const hits = raycaster.intersectObject(paper, false);
    return hits[0] || null;
  }

  function candidates(hit) {
    const sx = (hit.uv.x - 0.5) * SHEET_W;
    const sy = (hit.uv.y - 0.5) * SHEET_H;
    const list = [];
    if (legal("a") && sx > 0.01) list.push("a");
    if (legal("b") && sy < -0.01) list.push("b");
    return { list, sx, sy };
  }

  function begin(name, point) {
    const fold = folds[name];
    const reach = name === "a" ? Math.max(Math.abs(drag.sx), 0.32 * (SHEET_W / 2)) : Math.max(Math.abs(drag.sy), 0.32 * (SHEET_H / 2));
    const coord = name === "a" ? point.x / reach : -point.y / reach;
    drag.fold = name;
    drag.reach = reach;
    drag.offset = Math.cos(fold.angle) - coord;
    fold.held = true;
    queue.length = 0;
  }

  function follow(point) {
    const fold = folds[drag.fold];
    const coord = drag.fold === "a" ? point.x / drag.reach : -point.y / drag.reach;
    fold.target = Math.acos(clamp(coord + drag.offset, -1, 1));
  }

  function setCursor() {
    canvas.style.cursor = drag?.fold ? "grabbing" : hover ? "grab" : "";
  }

  function onPointerDown(event) {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    rustle.unlock();
    const hit = hitPaper(event);
    if (!hit) return;
    event.preventDefault();
    const { list, sx, sy } = candidates(hit);
    canvas.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, list, sx, sy, x0: event.clientX, y0: event.clientY, t0: performance.now(), fold: null };
    if (list.length === 1) begin(list[0], tablePoint(event) || new THREE.Vector3());
    setCursor();
    wake();
  }

  function onPointerMove(event) {
    if (drag && event.pointerId === drag.id) {
      const point = tablePoint(event);
      if (!point) return;
      if (!drag.fold && drag.list.length > 1) {
        const dx = event.clientX - drag.x0;
        const dy = event.clientY - drag.y0;
        if (Math.hypot(dx, dy) < 6) return;
        begin(Math.abs(dx) > Math.abs(dy) ? "a" : "b", point);
      }
      if (drag.fold) follow(point);
      wake();
      return;
    }
    if (event.pointerType !== "mouse") return;
    const hit = hitPaper(event);
    const over = Boolean(hit && candidates(hit).list.length);
    if (over !== hover) {
      hover = over;
      setCursor();
    }
  }

  function settle(fold) {
    const projected = fold.angle + fold.vel * 0.16;
    fold.target = projected > PI / 2 ? PI : 0;
    fold.held = false;
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.id) return;
    try {
      canvas.releasePointerCapture(drag.id);
    } catch {}
    const moved = Math.hypot(event.clientX - drag.x0, event.clientY - drag.y0);
    const quick = performance.now() - drag.t0 < 400;
    if (moved < 6 && quick) {
      if (drag.fold) folds[drag.fold].held = false;
      step();
    } else if (drag.fold) settle(folds[drag.fold]);
    drag = null;
    setCursor();
    announce();
    wake();
  }

  function onCancel(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    if (drag.fold) settle(folds[drag.fold]);
    drag = null;
    setCursor();
    wake();
  }

  function step() {
    queue.length = 0;
    if (folds.a.target === PI) queue.push({ fold: "a", to: 0 });
    else if (folds.b.target === PI) queue.push({ fold: "b", to: 0 });
    else queue.push({ fold: "b", to: PI }, { fold: "a", to: PI });
    wake();
  }

  function unfoldAll() {
    queue.length = 0;
    if (folds.a.target === PI) queue.push({ fold: "a", to: 0 });
    queue.push({ fold: "b", to: 0 });
    wake();
  }

  function foldUp() {
    queue.length = 0;
    if (folds.a.target === 0) queue.push({ fold: "b", to: PI });
    queue.push({ fold: "a", to: PI });
    wake();
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onCancel);
  canvas.addEventListener("lostpointercapture", onCancel);

  const ro = new ResizeObserver(() => {
    layout();
    wake();
  });
  ro.observe(host);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && !document.hidden;
    if (visible) wake();
  });
  io.observe(stage);
  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
  };
  document.addEventListener("visibilitychange", onVisibility);

  layout();
  const f0 = framing();
  cam.x = f0.cx;
  cam.y = f0.cy;
  cam.dist = f0.dist;
  shape();
  placeCamera();
  renderer.render(scene, camera);
  wake();

  return {
    step,
    unfoldAll,
    foldUp,
    get state() {
      return state();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("lostpointercapture", onCancel);
      rustle.close();
      [tableGeo, contactGeo, bakeGeo, paperGeo].forEach((g) => g.dispose());
      [tableMat, contactMat, bakeMat, paperMat].forEach((m) => m.dispose());
      [tableTex, noiseTex, frontTex, backTex].forEach((t) => t.dispose());
      patternTarget.dispose();
      renderer.dispose();
    },
  };
}
