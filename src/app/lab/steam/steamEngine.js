import * as THREE from "three";

import { buildScene } from "./steamScene";
import { compositeFragment, flowFragment, screenVertex } from "./steamShader";

const FOV = 28;
const LOOK = new THREE.Vector3(0, 0.98, 0);
const ELEVATION = 0.3;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseTexture(size = 256) {
  const rand = mulberry(2024);
  const octave = (cells) => {
    const grid = Array.from({ length: cells * cells }, () => rand());
    const at = (x, y) => grid[((y + cells) % cells) * cells + ((x + cells) % cells)];
    return (u, v) => {
      const x = u * cells;
      const y = v * cells;
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const fx = x - xi;
      const fy = y - yi;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const a = at(xi, yi);
      const b = at(xi + 1, yi);
      const c = at(xi, yi + 1);
      const d = at(xi + 1, yi + 1);
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
  };
  const o1 = octave(8);
  const o2 = octave(16);
  const o3 = octave(32);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const n = o1(u, v) * 0.55 + o2(u, v) * 0.3 + o3(u, v) * 0.15;
      const o = (y * size + x) * 4;
      data[o] = Math.round(n * 255);
      data[o + 1] = data[o];
      data[o + 2] = data[o];
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function createBreath() {
  let ctx = null;
  let gain = null;
  let source = null;
  return {
    unlock() {
      if (ctx) {
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        return;
      }
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = buffer.getChannelData(0);
      let pink = 0;
      for (let i = 0; i < d.length; i += 1) {
        pink = pink * 0.94 + (Math.random() * 2 - 1) * 0.06;
        d[i] = pink * 3 + (Math.random() * 2 - 1) * 0.15;
      }
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 900;
      band.Q.value = 0.5;
      gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(band).connect(gain).connect(ctx.destination);
      source.start();
    },
    level(v) {
      if (!ctx || !gain) return;
      gain.gain.setTargetAtTime(Math.min(0.16, v), ctx.currentTime, 0.08);
    },
    close() {
      try {
        source?.stop();
      } catch {}
      ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}

export function createSteam(stage, canvas, { reducedMotion = false, palette } = {}) {
  const host = stage.closest(".piece-box") || stage;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const world = buildScene(renderer, palette);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 40);

  const sceneTarget = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
  const flowOptions = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  let flowRead = new THREE.WebGLRenderTarget(128, 128, flowOptions);
  let flowWrite = new THREE.WebGLRenderTarget(128, 128, flowOptions);
  const noise = noiseTexture();

  const screenGeo = new THREE.PlaneGeometry(2, 2);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const flowMat = new THREE.ShaderMaterial({
    uniforms: {
      uPrev: { value: flowRead.texture },
      uFalloff: { value: 0.11 },
      uDissipation: { value: 0.99 },
      uRise: { value: 0 },
      uAspect: { value: 1 },
      uMouse: { value: new THREE.Vector2(-1, -1) },
      uVelocity: { value: new THREE.Vector2() },
    },
    vertexShader: screenVertex,
    fragmentShader: flowFragment,
    depthTest: false,
    depthWrite: false,
  });
  const flowScene = new THREE.Scene();
  flowScene.add(new THREE.Mesh(screenGeo, flowMat));
  const compositeMat = new THREE.ShaderMaterial({
    uniforms: {
      uScene: { value: sceneTarget.texture },
      uFlow: { value: flowRead.texture },
      uNoise: { value: noise },
      uRes: { value: new THREE.Vector2(1, 1) },
      uSource: { value: new THREE.Vector2() },
      uRadius: { value: 100 },
      uHeight: { value: 400 },
      uTime: { value: 0 },
      uPush: { value: 60 },
      uSteam: { value: new THREE.Color(1.0, 0.96, 0.92) },
    },
    vertexShader: screenVertex,
    fragmentShader: compositeFragment,
    depthTest: false,
    depthWrite: false,
  });
  const compositeScene = new THREE.Scene();
  compositeScene.add(new THREE.Mesh(screenGeo, compositeMat));

  const breath = createBreath();
  const pointer = { x: -1, y: -1, lastX: 0, lastY: 0, lastT: 0, vx: 0, vy: 0, fresh: false, inside: false };
  const velocity = new THREE.Vector2();
  const view = { w: 1, h: 1, dpr: 1 };
  let raf = 0;
  let last = 0;
  let time = 7;
  let destroyed = false;
  let visible = true;
  let sceneDirty = true;
  let energy = 0;

  function frame() {
    const aspect = view.w / view.h;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const needH = view.w < 900 ? 1.25 : 1.12;
    const needW = view.w < 900 ? 1.0 : 1.5;
    const dist = Math.max(needH / tan, needW / (tan * aspect));
    camera.aspect = aspect;
    camera.position.set(0, LOOK.y + dist * Math.sin(ELEVATION), dist * Math.cos(ELEVATION));
    const look = LOOK.clone();
    if (view.w < 900) look.y += 0.06;
    camera.lookAt(look);
    camera.updateProjectionMatrix();
    const centre = world.coffeeCentre();
    const a = centre.clone().project(camera);
    const edge = centre.clone().add(new THREE.Vector3(0.45, 0, 0)).project(camera);
    const top = centre.clone().add(new THREE.Vector3(0, 1.45, 0)).project(camera);
    const W = view.w * view.dpr;
    const H = view.h * view.dpr;
    const sx = (a.x * 0.5 + 0.5) * W;
    const sy = (a.y * 0.5 + 0.5) * H;
    compositeMat.uniforms.uSource.value.set(sx, sy);
    compositeMat.uniforms.uRadius.value = Math.abs((edge.x * 0.5 + 0.5) * W - sx);
    compositeMat.uniforms.uHeight.value = Math.max(40, (top.y * 0.5 + 0.5) * H - sy);
    compositeMat.uniforms.uRes.value.set(W, H);
    compositeMat.uniforms.uPush.value = 90 * view.dpr;
    flowMat.uniforms.uAspect.value = aspect;
  }

  function layout() {
    const rect = host.getBoundingClientRect();
    view.w = Math.max(1, rect.width);
    view.h = Math.max(1, rect.height);
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(view.dpr);
    renderer.setSize(view.w, view.h, false);
    sceneTarget.setSize(Math.round(view.w * view.dpr), Math.round(view.h * view.dpr));
    frame();
    sceneDirty = true;
  }

  function updateFlow(dt) {
    const steps = dt * 60;
    flowMat.uniforms.uDissipation.value = Math.pow(0.99, steps);
    flowMat.uniforms.uRise.value = (0.26 * compositeMat.uniforms.uHeight.value * dt) / Math.max(1, view.h * view.dpr);
    if (!pointer.fresh) {
      flowMat.uniforms.uMouse.value.set(-1, -1);
      pointer.vx = 0;
      pointer.vy = 0;
    }
    pointer.fresh = false;
    const target = new THREE.Vector2(pointer.vx, pointer.vy);
    velocity.lerp(target, target.length() ? 0.5 : 0.1);
    flowMat.uniforms.uVelocity.value.copy(velocity);
    flowMat.uniforms.uPrev.value = flowRead.texture;
    renderer.setRenderTarget(flowWrite);
    renderer.render(flowScene, ortho);
    renderer.setRenderTarget(null);
    const swap = flowRead;
    flowRead = flowWrite;
    flowWrite = swap;
    compositeMat.uniforms.uFlow.value = flowRead.texture;
    energy = energy * 0.975 + velocity.length();
  }

  function tick(now) {
    raf = 0;
    if (destroyed || !visible) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    time += dt * (reducedMotion ? 0.35 : 1);
    if (sceneDirty) {
      renderer.setRenderTarget(sceneTarget);
      renderer.render(world.scene, camera);
      renderer.setRenderTarget(null);
      sceneDirty = false;
    }
    updateFlow(dt);
    breath.level(pointer.inside ? velocity.length() * 0.05 : 0);
    compositeMat.uniforms.uTime.value = time;
    renderer.render(compositeScene, ortho);
    raf = requestAnimationFrame(tick);
  }

  function start() {
    if (!raf && visible && !destroyed) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  }

  function onMove(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const now = performance.now();
    if (!pointer.lastT || now - pointer.lastT > 120) {
      pointer.lastX = x;
      pointer.lastY = y;
      pointer.lastT = now;
    }
    const delta = Math.max(14, now - pointer.lastT);
    const cap = 3.2;
    pointer.vx = Math.max(-cap, Math.min(cap, (x - pointer.lastX) / delta));
    pointer.vy = Math.max(-cap, Math.min(cap, (y - pointer.lastY) / delta));
    pointer.lastX = x;
    pointer.lastY = y;
    pointer.lastT = now;
    pointer.fresh = true;
    pointer.inside = true;
    flowMat.uniforms.uMouse.value.set(x / rect.width, 1 - y / rect.height);
  }

  function onDown(event) {
    breath.unlock();
    onMove(event);
  }

  function onLeave() {
    pointer.inside = false;
    pointer.lastT = 0;
  }

  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerleave", onLeave);

  const ro = new ResizeObserver(() => {
    layout();
    start();
  });
  ro.observe(host);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && !document.hidden;
    if (visible) start();
  });
  io.observe(stage);
  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) start();
  };
  document.addEventListener("visibilitychange", onVisibility);

  layout();
  start();

  return {
    blow(direction = 1) {
      const rect = canvas.getBoundingClientRect();
      const src = compositeMat.uniforms.uSource.value;
      const fx = src.x / view.dpr / rect.width;
      const fy = 1 - (src.y / view.dpr + compositeMat.uniforms.uHeight.value / view.dpr * 0.35) / rect.height;
      let k = 0;
      const steps = 14;
      const run = () => {
        if (destroyed || k > steps) return;
        const x = (fx - 0.2 * direction + (0.4 * direction * k) / steps) * rect.width;
        const y = (1 - fy) * rect.height;
        onMove({ clientX: rect.left + x, clientY: rect.top + y });
        k += 1;
        requestAnimationFrame(run);
      };
      run();
    },
    get energy() {
      return energy;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerleave", onLeave);
      breath.close();
      world.dispose();
      [sceneTarget, flowRead, flowWrite].forEach((t) => t.dispose());
      noise.dispose();
      screenGeo.dispose();
      flowMat.dispose();
      compositeMat.dispose();
      renderer.dispose();
    },
  };
}
