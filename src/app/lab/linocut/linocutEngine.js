import * as THREE from "three";

import { POST_FRAGMENT, POST_VERTEX, WAVE_CHUNK } from "./linocutShader";

const MAX_DPR = 2;
const HORIZON = "#e9e4d8";
const ZENITH = "#7d8ca0";
const MOON_DISTANCE = 92;
const PRINT_ASPECT = 1.3;
const MIN_ASPECT = 1;
const FRAME_MS = 1000 / 60;

const WAVES = [
  { dir: [1, 0.3], amplitude: 0.7, length: 20, speed: 1.1 },
  { dir: [-0.4, 1], amplitude: 0.4, length: 10, speed: 1.6 },
  { dir: [0.7, -0.6], amplitude: 0.22, length: 5.5, speed: 2.2 },
  { dir: [0.2, 1], amplitude: 0.1, length: 2.7, speed: 3 },
].map(({ dir, amplitude, length, speed }) => {
  const d = new THREE.Vector2(dir[0], dir[1]).normalize();
  return { dir: d, amplitude, k: (Math.PI * 2) / length, speed };
});

function wave(x, z, t) {
  let h = 0;
  let dx = 0;
  let dz = 0;
  for (const w of WAVES) {
    const phase = w.k * (w.dir.x * x + w.dir.y * z) + t * w.speed;
    h += w.amplitude * Math.sin(phase);
    const slope = w.amplitude * w.k * Math.cos(phase);
    dx += slope * w.dir.x;
    dz += slope * w.dir.y;
  }
  return { h, dx, dz };
}

const hexVector = (hex) => new THREE.Vector3(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));

export const PAPER = "#efe8da";
export const INK = "#16140f";

export default class LinocutEngine {
  constructor({ root, stage, canvas, onReady, onError, onMoon }) {
    this.root = root;
    this.stage = stage;
    this.canvas = canvas;
    this.onReady = onReady;
    this.onError = onError;
    this.onMoon = onMoon;
    this.visible = true;
    this.destroyed = false;
    this.raf = 0;
    this.last = 0;
    this.time = 0;
    this.lastDraw = 0;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.moonAim = new THREE.Vector2(-0.34, 0.62);
    this.moonNow = this.moonAim.clone();
    this.scale = 0.85;
    this.swirl = 0.85;
    this.scaleNow = 0.85;
    this.swirlNow = 0.85;
    this.dragging = false;
    this.frame = this.frame.bind(this);
    this.handleVisibility = () => this.wake();
  }

  start() {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
    } catch {
      this.onError?.();
      return;
    }
    this.renderer = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    this.buildScene();
    this.buildPost();
    this.canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
    document.addEventListener("visibilitychange", this.handleVisibility);
    this.intersection = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.wake();
    });
    this.intersection.observe(this.root);
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(this.root);
    this.resizer.observe(this.stage);
    this.resize();
    this.placeMoon();
    this.draw();
    this.onReady?.();
    this.wake();
  }

  buildScene() {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(HORIZON, 70, 230);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(46, PRINT_ASPECT, 0.1, 600);
    this.camera.position.set(0, 3.2, 15);
    this.camera.lookAt(0, 5.5, -20);
    this.camera.updateMatrixWorld();

    const skyGeometry = new THREE.SphereGeometry(300, 32, 24);
    const position = skyGeometry.getAttribute("position");
    const colors = new Float32Array(position.count * 3);
    const horizon = new THREE.Color(HORIZON);
    const zenith = new THREE.Color(ZENITH);
    const color = new THREE.Color();
    for (let v = 0; v < position.count; v += 1) {
      const h = Math.max(position.getY(v) / 300, 0);
      color.lerpColors(horizon, zenith, Math.min(h * 2, 1));
      color.toArray(colors, v * 3);
    }
    skyGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.sky = new THREE.Mesh(skyGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
    scene.add(this.sky);

    this.moon = new THREE.Mesh(
      new THREE.SphereGeometry(7, 48, 32),
      new THREE.MeshBasicMaterial({ color: "#fffaf0", fog: false, toneMapped: false }),
    );
    scene.add(this.moon);
    this.halo = new THREE.Mesh(
      new THREE.CircleGeometry(15, 64),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        uniforms: {},
        vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader:
          "varying vec2 vUv; void main() { float d = length(vUv - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - d), 2.2) * 0.55; gl_FragColor = vec4(vec3(1.0, 0.98, 0.94), a); }",
      }),
    );
    scene.add(this.halo);

    scene.add(new THREE.HemisphereLight("#f2efe6", ZENITH, 0.78 * Math.PI));
    this.sun = new THREE.DirectionalLight("#fff6e6", 1.6 * Math.PI);
    scene.add(this.sun);

    this.waveTime = { value: 0 };
    const seaMaterial = new THREE.MeshStandardMaterial({ color: "#8299aa", roughness: 0.32 });
    seaMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.waveTime;
      shader.uniforms.uWaves = { value: WAVES.map((w) => new THREE.Vector4(w.dir.x, w.dir.y, w.amplitude, w.k)) };
      shader.uniforms.uSpeeds = { value: WAVES.map((w) => w.speed) };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${WAVE_CHUNK}`)
        .replace(
          "#include <beginnormal_vertex>",
          "vec3 waveData = wave(position.xz);\nvec3 objectNormal = normalize(vec3(-waveData.y, 1.0, -waveData.z));",
        )
        .replace("#include <begin_vertex>", "vec3 transformed = vec3(position);\ntransformed.y += waveData.x;");
    };
    this.seaMaterial = seaMaterial;
    const segments = 220;
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(260, 260, segments, segments).rotateX(-Math.PI / 2), seaMaterial);
    scene.add(this.sea);

    const boat = new THREE.Group();
    const hullMaterial = new THREE.MeshBasicMaterial({ color: "#d9d0bd" });
    const mastMaterial = new THREE.MeshBasicMaterial({ color: "#1d1a15" });
    const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), hullMaterial);
    hull.scale.set(1.7, 0.55, 0.6);
    const deck = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: "#a59a86" }));
    deck.rotation.x = -Math.PI / 2;
    deck.scale.set(1.7, 0.6, 1);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.6, 12), mastMaterial);
    mast.position.set(0.2, 1.3, 0);
    const sailShape = new THREE.Shape().moveTo(0, 0).lineTo(0, 2.2).lineTo(1.3, 0).closePath();
    const sail = new THREE.Mesh(
      new THREE.ShapeGeometry(sailShape),
      new THREE.MeshBasicMaterial({ color: "#fbf6ea", side: THREE.DoubleSide }),
    );
    sail.position.set(0.25, 0.25, 0);
    boat.add(hull, deck, mast, sail);
    this.boat = boat;
    this.boatAt = { x: 3, z: 2 };
    scene.add(boat);
    this.placeBoat();
  }

  buildPost() {
    this.target = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true, samples: 0 });
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postMaterial = new THREE.ShaderMaterial({
      vertexShader: POST_VERTEX,
      fragmentShader: POST_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.target.texture },
        uSize: { value: new THREE.Vector2(1, 1) },
        uImage: { value: new THREE.Vector4(0, 0, 1, 1) },
        uDpr: { value: 1 },
        uCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uScale: { value: this.scale },
        uSwirl: { value: this.swirl },
        uNoise: { value: 0.1 },
        uSeed: { value: Math.random() * 40 },
        uPaper: { value: hexVector(PAPER) },
        uInk: { value: hexVector(INK) },
      },
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMaterial));
  }

  resize() {
    if (!this.renderer || this.destroyed) return;
    const host = this.root.getBoundingClientRect();
    const box = this.stage.getBoundingClientRect();
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const aspect = Math.max(MIN_ASPECT, Math.min(PRINT_ASPECT, box.width / Math.max(1, box.height)));
    let w = box.width;
    let h = w / aspect;
    if (h > box.height) {
      h = box.height;
      w = h * aspect;
    }
    const sheetX = Math.round(box.left - host.left + (box.width - w) / 2);
    const sheetY = Math.round(box.top - host.top + (box.height - h) / 2);
    this.sheet = { x: sheetX, y: sheetY, w: Math.round(w), h: Math.round(h) };
    const margin = Math.round(Math.min(w, h) * 0.06);
    this.image = { x: margin, y: margin, w: this.sheet.w - margin * 2, h: this.sheet.h - margin * 2 };
    this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.sheet.w, this.sheet.h, false);
    const style = this.canvas.style;
    style.left = `${sheetX}px`;
    style.top = `${sheetY}px`;
    style.width = `${this.sheet.w}px`;
    style.height = `${this.sheet.h}px`;
    this.root.style.setProperty("--lino-x", `${sheetX}px`);
    this.root.style.setProperty("--lino-y", `${sheetY}px`);
    this.root.style.setProperty("--lino-w", `${this.sheet.w}px`);
    this.root.style.setProperty("--lino-h", `${this.sheet.h}px`);
    this.target.setSize(Math.round(this.image.w * dpr * 0.75), Math.round(this.image.h * dpr * 0.75));
    this.camera.aspect = this.image.w / this.image.h;
    this.camera.updateProjectionMatrix();
    this.moonAim.copy(this.clampMoon(this.moonAim.x, this.moonAim.y));
    this.moonNow.copy(this.clampMoon(this.moonNow.x, this.moonNow.y));
    const u = this.postMaterial.uniforms;
    u.uSize.value.set(this.sheet.w, this.sheet.h);
    u.uImage.value.set(this.image.x, this.image.y, this.image.w, this.image.h);
    u.uDpr.value = dpr;
    this.draw();
  }

  pointToMoon(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left - this.image.x) / this.image.w) * 2 - 1;
    const y = 1 - ((clientY - rect.top - this.image.y) / this.image.h) * 2;
    return this.clampMoon(x, y);
  }

  clampMoon(x, y) {
    const image = this.image || { w: 2, h: 2 };
    const radius = (7 / MOON_DISTANCE) * (image.h / 2) / Math.tan((this.camera.fov * Math.PI) / 360);
    const reach = radius * 1.15 + 20;
    const limitX = Math.max(0, 1 - reach / (image.w / 2));
    const limitY = Math.max(0, 1 - reach / (image.h / 2));
    const floor = Math.min(limitY, 0.24 + reach / (image.h / 2));
    return new THREE.Vector2(Math.max(-limitX, Math.min(limitX, x)), Math.max(floor, Math.min(limitY, y)));
  }

  aimMoon(clientX, clientY) {
    this.moonAim.copy(this.pointToMoon(clientX, clientY));
    this.wake();
  }

  nudgeMoon(dx, dy) {
    this.moonAim.copy(this.clampMoon(this.moonAim.x + dx, this.moonAim.y + dy));
    this.wake();
  }

  moonScreen() {
    if (!this.image) return null;
    const p = this.moon.position.clone().project(this.camera);
    return {
      x: this.sheet.x + this.image.x + ((p.x + 1) / 2) * this.image.w,
      y: this.sheet.y + this.image.y + ((1 - p.y) / 2) * this.image.h,
      r: (7 / MOON_DISTANCE) * (this.image.h / 2) / Math.tan((this.camera.fov * Math.PI) / 360),
    };
  }

  placeMoon() {
    const ray = new THREE.Vector3(this.moonNow.x, this.moonNow.y, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    const pos = this.camera.position.clone().addScaledVector(ray, MOON_DISTANCE);
    pos.y = Math.max(pos.y, 3);
    this.moon.position.copy(pos);
    this.halo.position.copy(pos);
    this.halo.lookAt(this.camera.position);
    this.sun.position.copy(pos);
    const p = pos.clone().project(this.camera);
    this.postMaterial.uniforms.uCenter.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    const rise = pos.clone().sub(this.camera.position);
    const altitude = Math.round((Math.atan2(rise.y, Math.hypot(rise.x, rise.z)) * 180) / Math.PI);
    this.onMoon?.({ ...this.moonScreen(), altitude });
  }

  placeBoat() {
    const { x, z } = this.boatAt;
    const { h, dx, dz } = wave(x, z, this.time);
    this.boat.position.set(x, h + 0.35, z);
    this.boat.rotation.set(-Math.atan(dz), 0, Math.atan(dx));
  }

  setGouge(value) {
    this.scale = value;
    this.wake();
  }

  setSwirl(value) {
    this.swirl = value;
    this.wake();
  }

  wake() {
    if (this.destroyed || !this.renderer) return;
    if (!this.visible || document.hidden) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      return;
    }
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  frame(now) {
    this.raf = 0;
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (!this.reduced) this.time += dt * 0.55;
    this.moonNow.x = damp(this.moonNow.x, this.moonAim.x, 7, dt);
    this.moonNow.y = damp(this.moonNow.y, this.moonAim.y, 7, dt);
    this.scaleNow = damp(this.scaleNow, this.scale, 8, dt);
    this.swirlNow = damp(this.swirlNow, this.swirl, 8, dt);
    if (now - this.lastDraw >= FRAME_MS - 2) {
      this.lastDraw = now;
      this.placeMoon();
      this.draw();
    }
    const settled =
      this.reduced &&
      this.moonNow.distanceTo(this.moonAim) < 0.0005 &&
      Math.abs(this.scaleNow - this.scale) < 0.001 &&
      Math.abs(this.swirlNow - this.swirl) < 0.001;
    if (!settled && this.visible && !document.hidden) this.raf = requestAnimationFrame(this.frame);
  }

  draw() {
    if (!this.renderer) return;
    this.waveTime.value = this.time;
    this.placeBoat();
    const u = this.postMaterial.uniforms;
    u.uScale.value = this.scaleNow;
    u.uSwirl.value = this.swirlNow;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.intersection?.disconnect();
    this.resizer?.disconnect();
    if (this.scene) {
      this.scene.traverse((obj) => {
        obj.geometry?.dispose();
        obj.material?.dispose?.();
      });
    }
    this.postScene?.traverse((obj) => {
      obj.geometry?.dispose();
      obj.material?.dispose?.();
    });
    this.target?.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
  }
}
