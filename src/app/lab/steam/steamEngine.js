import * as THREE from "three";

import { flowFragment, screenVertex, steamFragment } from "./steamShader";

const HOLD = 7.2;
const IN_TIME = 2.6;
const OUT_TIME = 2.1;

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
      gain.gain.setTargetAtTime(Math.min(0.14, v), ctx.currentTime, 0.08);
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

function paintMask(canvas, text, { family, weight, compact }) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `${weight} 100px ${family}`;
  const words = text.split(" ");
  const boxW = w * (compact ? 0.86 : 0.8);
  const size = compact ? Math.min(w * 0.125, h * 0.075) : Math.min(h * 0.12, w * 0.066);
  ctx.font = `${weight} ${size}px ${family}`;
  const fill = (limit) => {
    const out = [];
    let line = [];
    for (const word of words) {
      const next = [...line, word].join(" ");
      if (line.length && ctx.measureText(next).width > limit) {
        out.push(line.join(" "));
        line = [word];
      } else {
        line.push(word);
      }
    }
    out.push(line.join(" "));
    return out;
  };
  let lines = fill(boxW);
  if (lines.length > 1) {
    const count = lines.length;
    let limit = ctx.measureText(text).width / count;
    let balanced = fill(limit);
    while (balanced.length > count && limit < boxW) {
      limit += size * 0.25;
      balanced = fill(limit);
    }
    lines = balanced;
  }
  const lead = size * 1.22;
  const cy = h * (compact ? 0.56 : 0.54);
  const layer = (blur) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.filter = blur ? `blur(${blur}px)` : "none";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `${weight} ${size}px ${family}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${-0.035 * size}px`;
    lines.forEach((line, i) => {
      const y = cy + (i - (lines.length - 1) / 2) * lead + size * 0.34;
      ctx.fillText(line, w / 2, y);
    });
    ctx.filter = "none";
    return ctx.getImageData(0, 0, w, h).data;
  };
  const sharp = layer(Math.max(1, size * 0.012));
  const soft = layer(size * 0.03);
  const wide = layer(size * 0.26);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const src = (h - 1 - y) * w * 4;
    const dst = y * w * 4;
    for (let x = 0; x < w; x += 1) {
      const i = x * 4;
      out[dst + i] = sharp[src + i];
      out[dst + i + 1] = Math.min(255, soft[src + i] * 1.25);
      out[dst + i + 2] = Math.min(255, wide[src + i] * 1.6);
      out[dst + i + 3] = 255;
    }
  }
  return out;
}

export async function createSteam(stage, canvas, { reducedMotion = false, lines, palette, onLine = () => {} } = {}) {
  const host = stage.closest(".piece-box") || stage;
  const family = getComputedStyle(stage).fontFamily || "sans-serif";
  const weight = 560;
  try {
    await Promise.race([document.fonts.load(`${weight} 100px ${family}`), new Promise((r) => setTimeout(r, 1500))]);
  } catch {}

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.setClearColor(new THREE.Color(...palette.ground.map((c) => c / 255)), 1);

  const flowOptions = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  let flowRead = new THREE.WebGLRenderTarget(128, 128, flowOptions);
  let flowWrite = new THREE.WebGLRenderTarget(128, 128, flowOptions);
  const noise = noiseTexture();
  const scratch = document.createElement("canvas");

  const makeMask = () => {
    const t = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  const masks = [makeMask(), makeMask()];

  const screenGeo = new THREE.PlaneGeometry(2, 2);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const flowMat = new THREE.ShaderMaterial({
    uniforms: {
      uPrev: { value: flowRead.texture },
      uFalloff: { value: 0.12 },
      uDissipation: { value: 0.99 },
      uAspect: { value: 1 },
      uRise: { value: 0 },
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
  const steamMat = new THREE.ShaderMaterial({
    uniforms: {
      uFlow: { value: flowRead.texture },
      uNoise: { value: noise },
      uMaskA: { value: masks[0] },
      uMaskB: { value: masks[1] },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uPush: { value: 80 },
      uInA: { value: 0 },
      uOutA: { value: 0 },
      uInB: { value: 0 },
      uOutB: { value: 1 },
      uLift: { value: 0.14 },
      uGround: { value: new THREE.Vector3(...palette.ground.map((c) => c / 255)) },
      uSteam: { value: new THREE.Vector3(...palette.steam.map((c) => c / 255)) },
    },
    vertexShader: screenVertex,
    fragmentShader: steamFragment,
    depthTest: false,
    depthWrite: false,
  });
  const steamScene = new THREE.Scene();
  steamScene.add(new THREE.Mesh(screenGeo, steamMat));

  const breath = createBreath();
  const pointer = { lastX: 0, lastY: 0, lastT: 0, vx: 0, vy: 0, fresh: false, inside: false, downX: 0, downY: 0, downT: 0, moved: 0 };
  const velocity = new THREE.Vector2();
  const view = { w: 1, h: 1, dpr: 1, compact: false };
  const slots = [
    { index: -1, phase: "idle", inT: 0, outT: 1 },
    { index: -1, phase: "idle", inT: 0, outT: 1 },
  ];
  let pending = false;
  let active = 0;
  let index = -1;
  let hold = 0;
  let raf = 0;
  let last = 0;
  let time = 3;
  let destroyed = false;
  let visible = true;

  function paint(slot) {
    const s = slots[slot];
    if (s.index < 0) return;
    const w = Math.max(64, Math.round(view.w * Math.min(view.dpr, 1.5) * 0.6));
    const h = Math.max(64, Math.round(view.h * Math.min(view.dpr, 1.5) * 0.6));
    scratch.width = w;
    scratch.height = h;
    const data = paintMask(scratch, lines[s.index], { family, weight, compact: view.compact });
    const old = masks[slot];
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    masks[slot] = tex;
    steamMat.uniforms[slot ? "uMaskB" : "uMaskA"].value = tex;
    old.dispose();
  }

  function show(next) {
    const incoming = 1 - active;
    if (slots[incoming].phase === "out" && slots[incoming].outT < 0.85) {
      pending = true;
      return;
    }
    pending = false;
    index = ((next % lines.length) + lines.length) % lines.length;
    const leaving = slots[active];
    if (leaving.phase === "in" || leaving.phase === "hold") {
      leaving.phase = "out";
      leaving.outT = 0;
    }
    slots[incoming] = { index, phase: "in", inT: -0.42, outT: 0 };
    active = incoming;
    hold = 0;
    paint(incoming);
    onLine(lines[index], index);
  }

  function advance(dt) {
    for (let i = 0; i < 2; i += 1) {
      const s = slots[i];
      if (s.phase === "in") {
        s.inT = Math.min(1, s.inT + dt / IN_TIME);
        if (s.inT >= 1) s.phase = "hold";
      } else if (s.phase === "out") {
        s.outT = Math.min(1, s.outT + (dt / OUT_TIME) * (pending ? 3 : 1));
        if (s.outT >= 1) s.phase = "idle";
      }
      const inAmt = s.index < 0 ? 0 : 1 - Math.pow(1 - Math.max(0, s.inT), 2.2);
      const outAmt = s.index < 0 ? 1 : s.outT;
      steamMat.uniforms[i ? "uInB" : "uInA"].value = inAmt;
      steamMat.uniforms[i ? "uOutB" : "uOutA"].value = outAmt;
    }
    if (pending) show(index + 1);
    if (slots[active].phase === "hold") {
      hold += dt;
      if (hold > HOLD * (reducedMotion ? 1.6 : 1)) show(index + 1);
    }
  }

  function layout() {
    const rect = host.getBoundingClientRect();
    view.w = Math.max(1, rect.width);
    view.h = Math.max(1, rect.height);
    view.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const wasCompact = view.compact;
    view.compact = view.w < 900;
    renderer.setPixelRatio(view.dpr);
    renderer.setSize(view.w, view.h, false);
    steamMat.uniforms.uRes.value.set(view.w * view.dpr, view.h * view.dpr);
    steamMat.uniforms.uPush.value = (view.compact ? 60 : 90) * view.dpr;
    flowMat.uniforms.uAspect.value = view.w / view.h;
    flowMat.uniforms.uFalloff.value = view.compact ? 0.18 : 0.12;
    if (index >= 0) {
      paint(0);
      paint(1);
    }
    return wasCompact !== view.compact;
  }

  function updateFlow(dt) {
    if (!pointer.fresh) {
      flowMat.uniforms.uMouse.value.set(-1, -1);
      pointer.vx = 0;
      pointer.vy = 0;
    }
    pointer.fresh = false;
    const target = new THREE.Vector2(pointer.vx, pointer.vy);
    velocity.lerp(target, target.length() ? 0.5 : 0.1);
    flowMat.uniforms.uVelocity.value.copy(velocity);
    flowMat.uniforms.uDissipation.value = Math.pow(0.988, dt * 60);
    flowMat.uniforms.uRise.value = 0.035 * dt;
    flowMat.uniforms.uPrev.value = flowRead.texture;
    renderer.setRenderTarget(flowWrite);
    renderer.render(flowScene, ortho);
    renderer.setRenderTarget(null);
    const swap = flowRead;
    flowRead = flowWrite;
    flowWrite = swap;
    steamMat.uniforms.uFlow.value = flowRead.texture;
  }

  function tick(now) {
    raf = 0;
    if (destroyed || !visible) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    time += dt * (reducedMotion ? 0.35 : 1);
    advance(dt);
    updateFlow(dt);
    breath.level(pointer.inside ? velocity.length() * 0.05 : 0);
    steamMat.uniforms.uTime.value = time;
    renderer.render(steamScene, ortho);
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
    pointer.moved += Math.hypot(x - pointer.lastX, y - pointer.lastY);
    pointer.lastX = x;
    pointer.lastY = y;
    pointer.lastT = now;
    pointer.fresh = true;
    pointer.inside = true;
    flowMat.uniforms.uMouse.value.set(x / rect.width, 1 - y / rect.height);
  }

  function onDown(event) {
    breath.unlock();
    pointer.downX = event.clientX;
    pointer.downY = event.clientY;
    pointer.downT = performance.now();
    pointer.moved = 0;
    onMove(event);
  }

  function onUp(event) {
    const dist = Math.hypot(event.clientX - pointer.downX, event.clientY - pointer.downY);
    if (pointer.downT && dist < 8 && performance.now() - pointer.downT < 450) show(index + 1);
    pointer.downT = 0;
  }

  function onLeave() {
    pointer.inside = false;
    pointer.lastT = 0;
  }

  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
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
  show(0);
  slots[active].inT = reducedMotion ? 1 : 0.45;
  if (reducedMotion) slots[active].phase = "hold";
  start();

  return {
    next() {
      breath.unlock();
      show(index + 1);
    },
    blow(direction = 1) {
      const rect = canvas.getBoundingClientRect();
      let k = 0;
      const steps = 16;
      const y = rect.height * (view.compact ? 0.48 : 0.5);
      const run = () => {
        if (destroyed || k > steps) return;
        const x = (0.5 - 0.42 * direction + (0.84 * direction * k) / steps) * rect.width;
        onMove({ clientX: rect.left + x, clientY: rect.top + y });
        k += 1;
        requestAnimationFrame(run);
      };
      pointer.lastT = 0;
      run();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      breath.close();
      [flowRead, flowWrite].forEach((t) => t.dispose());
      masks.forEach((t) => t.dispose());
      noise.dispose();
      screenGeo.dispose();
      flowMat.dispose();
      steamMat.dispose();
      renderer.dispose();
    },
  };
}
