import { BAKE } from "./crumpleBake";
import { createRustle } from "./crumpleSound";
import { createFacets } from "./crumpleCreases";

const SUB = 6;
const GROUND = "#ebe9e4";
const FRAME_MS = 200;
const KEYS = [0.42, 0.78, 1.05, 0.98, 1];
const CRUSH = [0, 0.6, 0.74, 0.8, 0.855, 1];
const OPEN = CRUSH;
const LEVEL = [0, 1, 2, 3, 4, 6];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const levelAt = (p) => {
  if (p < CRUSH[1]) return clamp(p / (CRUSH[1] * KEYS[0]), 0, 1);
  for (let i = 1; i < CRUSH.length; i += 1) {
    if (p <= CRUSH[i]) return LEVEL[i - 1] + ((LEVEL[i] - LEVEL[i - 1]) * (p - CRUSH[i - 1])) / (CRUSH[i] - CRUSH[i - 1]);
  }
  return LEVEL[LEVEL.length - 1];
};

function decode(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const raw = new Int16Array(bytes.buffer);
  const out = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw[i] / BAKE.scale;
  return out;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function printCanvas(img) {
  const w = 1024;
  const h = Math.round(w * (BAKE.h / BAKE.w));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#f6f4ef";
  ctx.fillRect(0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  let seed = 9;
  for (let i = 0; i < data.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const n = (seed / 2147483647 - 0.5) * 7;
    data.data[i] += n;
    data.data[i + 1] += n;
    data.data[i + 2] += n;
  }
  ctx.putImageData(data, 0, 0);
  const m = w * 0.06;
  const size = w - m * 2;
  const crop = Math.min(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(img, (img.naturalWidth - crop) / 2, (img.naturalHeight - crop) / 2, crop, crop, m, m, size, size);
  ctx.strokeStyle = "rgb(0 0 0 / 0.08)";
  ctx.lineWidth = 2;
  ctx.strokeRect(m, m, size, size);
  return c;
}

export async function createCrumple({ host, root, src, reduced, onState }) {
  const THREE = await import("three");
  const img = await loadImage(src);
  const UV = decode(BAKE.uv);
  const A = decode(BAKE.a);
  const B = decode(BAKE.b);
  const { nx, ny, frames: F } = BAKE;
  const N = nx * ny;
  const stride = N * 3;

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  // The shaders are fixed; checking each link reads the log back synchronously.
  renderer.debug.checkShaderErrors = false;
  renderer.setClearColor(new THREE.Color(GROUND));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.className = "crumple__canvas";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 20);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xd8d4cc, 1.25);
  hemi.position.set(0, 0, 1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfffaf2, 2.1);
  key.position.set(-1.9, 1.5, 1.7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -0.9;
  key.shadow.camera.right = 0.9;
  key.shadow.camera.top = 0.9;
  key.shadow.camera.bottom = -0.9;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 6;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.012;
  key.shadow.radius = 6;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xe8eeff, 0.35);
  fill.position.set(1.6, -1, 1.4);
  scene.add(fill);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ color: 0x2a2620, opacity: 0.16 }));
  ground.receiveShadow = true;
  ground.position.z = -0.0005;
  scene.add(ground);

  const RX = (nx - 1) * SUB + 1;
  const RY = (ny - 1) * SUB + 1;
  const RN = RX * RY;
  const geometry = new THREE.BufferGeometry();
  const position = new Float32Array(RN * 3);
  const uv = new Float32Array(RN * 2);
  const color = new Float32Array(RN * 3).fill(1);
  for (let j = 0; j < RY; j += 1) {
    const gy = j / SUB;
    const j0 = Math.min(ny - 2, Math.floor(gy));
    const ty = gy - j0;
    for (let i = 0; i < RX; i += 1) {
      const gx = i / SUB;
      const i0 = Math.min(nx - 2, Math.floor(gx));
      const tx = gx - i0;
      const a = (j0 * nx + i0) * 2;
      const b = a + 2;
      const c = a + nx * 2;
      const d = c + 2;
      const k = (j * RX + i) * 2;
      for (let q = 0; q < 2; q += 1) {
        uv[k + q] = (UV[a + q] * (1 - tx) + UV[b + q] * tx) * (1 - ty) + (UV[c + q] * (1 - tx) + UV[d + q] * tx) * ty;
      }
    }
  }
  const index = [];
  for (let j = 0; j < RY - 1; j += 1) {
    for (let i = 0; i < RX - 1; i += 1) {
      const a = j * RX + i;
      const b = a + 1;
      const c = a + RX;
      const d = c + 1;
      if ((i + j) % 2) index.push(a, b, d, a, d, c);
      else index.push(a, b, c, b, d, c);
    }
  }
  geometry.setIndex(index);
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(color, 3));

  const tex = new THREE.CanvasTexture(printCanvas(img));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const front = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.52, metalness: 0, vertexColors: true, flatShading: false, side: THREE.FrontSide }),
  );
  const back = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0xf3f1ec, roughness: 0.92, metalness: 0, vertexColors: true, flatShading: false, side: THREE.BackSide }),
  );
  for (const m of [front, back]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
  }
  const sheet = new THREE.Group();
  sheet.add(front, back);
  scene.add(sheet);

  const pose = new Float32Array(stride);
  const gridNormal = new Float32Array(stride);
  const facets = createFacets({ nx, ny, sub: SUB });
  const st = { p: 0, target: 0, stage: 0, dir: 1, memory: 0, level: 0, raf: 0, anim: null, active: true, destroyed: false, dirty: true, held: false };
  const view = { w: 1, h: 1 };
  const rustle = createRustle();

  function sample(src, f, out, weight) {
    const f0 = Math.floor(f);
    const f1 = Math.min(F - 1, f0 + 1);
    const t = f - f0;
    const o0 = f0 * stride;
    const o1 = f1 * stride;
    for (let k = 0; k < stride; k += 1) out[k] += (src[o0 + k] + (src[o1 + k] - src[o0 + k]) * t) * weight;
  }

  function buildPose() {
    pose.fill(0);
    const f = clamp(st.p, 0, 1) * (F - 1);
    const m = st.memory;
    if (m < 1) for (let k = 0; k < stride; k += 1) pose[k] += A[k] * (1 - m);
    if (m > 0) sample(B, (F - 1) - f, pose, m);
  }

  function poseNormals() {
    const at = (i, j) => (clamp(j, 0, ny - 1) * nx + clamp(i, 0, nx - 1)) * 3;
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const l = at(i - 1, j);
        const r = at(i + 1, j);
        const d = at(i, j - 1);
        const u = at(i, j + 1);
        const ax = pose[r] - pose[l];
        const ay = pose[r + 1] - pose[l + 1];
        const az = pose[r + 2] - pose[l + 2];
        const bx = pose[u] - pose[d];
        const by = pose[u + 1] - pose[d + 1];
        const bz = pose[u + 2] - pose[d + 2];
        const k = (j * nx + i) * 3;
        gridNormal[k] = ay * bz - az * by;
        gridNormal[k + 1] = az * bx - ax * bz;
        gridNormal[k + 2] = ax * by - ay * bx;
      }
    }
  }

  function upsample() {
    const pos = position;
    for (let j = 0; j < RY; j += 1) {
      const gy = j / SUB;
      const j0 = Math.min(ny - 2, Math.floor(gy));
      const ty = gy - j0;
      for (let i = 0; i < RX; i += 1) {
        const gx = i / SUB;
        const i0 = Math.min(nx - 2, Math.floor(gx));
        const tx = gx - i0;
        const a = (j0 * nx + i0) * 3;
        const b = a + 3;
        const c = a + nx * 3;
        const d = c + 3;
        const w00 = (1 - tx) * (1 - ty);
        const w10 = tx * (1 - ty);
        const w01 = (1 - tx) * ty;
        const w11 = tx * ty;
        const k = (j * RX + i) * 3;
        pos[k] = pose[a] * w00 + pose[b] * w10 + pose[c] * w01 + pose[d] * w11;
        pos[k + 1] = pose[a + 1] * w00 + pose[b + 1] * w10 + pose[c + 1] * w01 + pose[d + 1] * w11;
        pos[k + 2] = pose[a + 2] * w00 + pose[b + 2] * w10 + pose[c + 2] * w01 + pose[d + 2] * w11;
      }
    }
  }

  function crease() {
    const p = clamp(st.p, 0, 1);
    facets.apply(position, pose, gridNormal, st.level, 0.35 + 0.65 * smoothstep(0, 0.6, p), smoothstep(0.7, 1, p));
    let low = Infinity;
    for (let k = 2; k < RN * 3; k += 3) low = Math.min(low, position[k]);
    for (let k = 2; k < RN * 3; k += 3) position[k] -= low;
  }

  function shade() {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < RN * 3; k += 3) {
      cx += position[k];
      cy += position[k + 1];
      cz += position[k + 2];
    }
    cx /= RN;
    cy /= RN;
    cz /= RN;
    let rmax = 1e-6;
    for (let k = 0; k < RN * 3; k += 3) rmax = Math.max(rmax, Math.hypot(position[k] - cx, position[k + 1] - cy, position[k + 2] - cz));
    const depth = smoothstep(0.25, 0.9, st.p) * 0.55;
    for (let k = 0; k < RN * 3; k += 3) {
      const r = Math.hypot(position[k] - cx, position[k + 1] - cy, position[k + 2] - cz) / rmax;
      const ao = 1 - depth * Math.pow(1 - r, 1.6);
      color[k] = ao;
      color[k + 1] = ao;
      color[k + 2] = ao;
    }
  }

  function update() {
    buildPose();
    poseNormals();
    upsample();
    crease();
    shade();
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.computeVertexNormals();
    sheet.rotation.z = smoothstep(0, 1, st.p) * 0.35;
  }

  function layout() {
    const rect = root.getBoundingClientRect();
    view.w = Math.max(1, rect.width);
    view.h = Math.max(1, rect.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(view.w, view.h, false);
    camera.aspect = view.w / view.h;
    const narrow = view.w < 760;
    const fov = (camera.fov * Math.PI) / 180;
    const sheetH = BAKE.h * 1.22;
    const sheetW = BAKE.w * 1.22;
    const fill = narrow ? 0.62 : 0.7;
    const distH = sheetH / 2 / Math.tan(fov / 2) / fill;
    const distW = sheetW / 2 / Math.tan(fov / 2) / camera.aspect / (narrow ? 0.88 : 0.6);
    const dist = Math.max(distH, distW);
    const tilt = 0.32;
    const lift = narrow ? 0.06 : 0;
    camera.position.set(0, -Math.sin(tilt) * dist + lift, Math.cos(tilt) * dist);
    camera.lookAt(0, lift, 0.04);
    camera.updateProjectionMatrix();
    st.dirty = true;
  }

  function render() {
    renderer.render(scene, camera);
  }

  function step(now) {
    st.raf = 0;
    if (st.destroyed || !st.active) return;
    const anim = st.anim;
    if (anim) {
      const keys = reduced ? [1] : KEYS;
      const k = Math.min(keys.length - 1, Math.max(0, Math.floor((now - anim.start) / FRAME_MS)));
      if (k !== anim.k) {
        const prev = st.p;
        st.p = clamp(anim.from + (anim.to - anim.from) * keys[k], 0, 1);
        st.memory = Math.max(st.memory, smoothstep(0, 0.14, st.p));
        st.level = Math.max(st.level, levelAt(st.p));
        anim.k = k;
        anim.speed = Math.abs(st.p - prev) / (FRAME_MS / 1000);
        st.dirty = true;
      }
      if (st.dirty) {
        update();
        render();
        st.dirty = false;
      }
      const left = now - anim.start - k * FRAME_MS;
      if (anim.speed > 0 && left < FRAME_MS * 0.6) rustle.rustle(anim.speed, st.p);
      if (k >= keys.length - 1 && left >= FRAME_MS) st.anim = null;
    } else if (st.dirty) {
      update();
      render();
      st.dirty = false;
    }
    if (st.anim) st.raf = requestAnimationFrame(step);
  }

  function wake() {
    if (st.raf || st.destroyed || !st.active) return;
    st.raf = requestAnimationFrame(step);
  }

  function squeeze() {
    rustle.unlock();
    const last = CRUSH.length - 1;
    if (st.dir > 0 && st.stage >= last) st.dir = -1;
    else if (st.dir < 0 && st.stage <= 0) st.dir = 1;
    st.stage = clamp(st.stage + st.dir, 0, last);
    st.target = (st.dir < 0 ? OPEN : CRUSH)[st.stage];
    st.anim = { from: st.p, to: st.target, start: performance.now(), k: -1, speed: 0 };
    onState?.({ stage: st.stage, dir: st.dir, last });
    if (st.raf) cancelAnimationFrame(st.raf);
    st.raf = 0;
    step(performance.now());
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    host.setPointerCapture?.(e.pointerId);
    st.held = e.pointerId;
    squeeze();
  }

  function onUp(e) {
    if (st.held !== e.pointerId) return;
    st.held = false;
  }

  const ro = new ResizeObserver(() => {
    layout();
    update();
    render();
  });
  ro.observe(root);
  host.addEventListener("pointerdown", onDown);
  host.addEventListener("pointerup", onUp);
  host.addEventListener("pointercancel", onUp);
  host.addEventListener("lostpointercapture", onUp);

  layout();
  update();
  render();

  return {
    squeeze,
    setActive(on) {
      st.active = on;
      if (on) {
        st.dirty = true;
        wake();
      } else if (st.raf) {
        cancelAnimationFrame(st.raf);
        st.raf = 0;
      }
    },
    destroy() {
      st.destroyed = true;
      if (st.raf) cancelAnimationFrame(st.raf);
      ro.disconnect();
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      host.removeEventListener("lostpointercapture", onUp);
      rustle.destroy();
      geometry.dispose();
      tex.dispose();
      front.material.dispose();
      back.material.dispose();
      ground.geometry.dispose();
      ground.material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
