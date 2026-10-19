import { ALBUM_CHOICES, LAMP } from "./mirrorballAlbums";
import { createMirrorGL } from "./mirrorballGL";

const RINGS = 34;
const TILT = -0.16;
const MAX_SPIN = 6.5;
const STEP = 1.3;
const SHUTTER = 1 / 75;
const VISCOUS = 0.42;
const COULOMB = 0.22;
const LIGHT = (() => {
  const v = [-0.5, 0.58, 0.64];
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
})();

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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

function buildFacets() {
  const rand = mulberry(20261016);
  const d = Math.PI / RINGS;
  const counts = [];
  for (let j = 0; j < RINGS; j += 1) {
    const lat = -Math.PI / 2 + (j + 0.5) * d;
    counts.push(Math.max(4, Math.round((2 * Math.PI * Math.cos(lat)) / d)));
  }
  const width = Math.max(...counts);
  const data = new Float32Array(width * RINGS * 4);
  const instances = [];
  for (let j = 0; j < RINGS; j += 1) {
    const lat = -Math.PI / 2 + (j + 0.5) * d;
    const k = counts[j];
    for (let i = 0; i < width; i += 1) {
      const o = (j * width + i) * 4;
      data[o + 3] = k;
      if (i >= k) continue;
      const lon = ((i + 0.5) * 2 * Math.PI) / k;
      let x = Math.cos(lat) * Math.cos(lon);
      let y = Math.sin(lat);
      let z = Math.cos(lat) * Math.sin(lon);
      const wob = 0.12;
      x += (rand() - 0.5) * wob;
      y += (rand() - 0.5) * wob;
      z += (rand() - 0.5) * wob;
      const l = Math.hypot(x, y, z);
      data[o] = x / l;
      data[o + 1] = y / l;
      data[o + 2] = z / l;
      instances.push(i, j);
    }
  }
  return { width, height: RINGS, data, instances: new Float32Array(instances) };
}

function rotation(phi) {
  const cy = Math.cos(phi);
  const sy = Math.sin(phi);
  const cx = Math.cos(TILT);
  const sx = Math.sin(TILT);
  return new Float32Array([cy, sx * sy, -cx * sy, 0, cx, sx, sy, -sx * cy, cx * cy]);
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

function saturate(r, g, b, amount) {
  const l = 0.3 * r + 0.59 * g + 0.11 * b;
  return [l + (r - l) * amount, l + (g - l) * amount, l + (b - l) * amount].map((v) => clamp(v, 0, 1));
}

async function buildCover(src, facets) {
  const img = await loadImage(src);
  const cell = 512;
  const gap = 96;
  const atlas = document.createElement("canvas");
  atlas.width = (cell + gap) * 4;
  atlas.height = cell;
  const actx = atlas.getContext("2d");
  actx.fillStyle = "#000";
  actx.fillRect(0, 0, atlas.width, atlas.height);
  for (let i = 0; i < 4; i += 1) actx.drawImage(img, i * (cell + gap) + gap / 2, 0, cell, cell);

  const sw = 96;
  const sh = 64;
  const small = document.createElement("canvas");
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(img, 0, 0, sw, sh);
  const px = sctx.getImageData(0, 0, sw, sh).data;
  const { width, height, data } = facets;
  const tint = new Float32Array(width * height * 4);
  for (let j = 0; j < height; j += 1) {
    const k = data[(j * width) * 4 + 3];
    const v = 1 - (j + 0.5) / height;
    for (let i = 0; i < k; i += 1) {
      const u = (((i + 0.5) / k) * 2) % 1;
      const x = Math.min(sw - 1, Math.floor(u * sw));
      const y = Math.min(sh - 1, Math.floor(v * sh));
      const o = (y * sw + x) * 4;
      const [r, g, b] = saturate(px[o] / 255, px[o + 1] / 255, px[o + 2] / 255, 1.6);
      const lift = 0.1;
      const t = (j * width + i) * 4;
      tint[t] = lift + r * (1 - lift);
      tint[t + 1] = lift + g * (1 - lift);
      tint[t + 2] = lift + b * (1 - lift);
      tint[t + 3] = 1;
    }
  }
  return { atlas, tint };
}

export async function createMirrorball({ box, canvas, header, embedded, album = 0, onReady }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const facets = buildFacets();
  let gl = createMirrorGL(canvas, facets);
  if (!gl) throw new Error("WebGL2 unavailable");

  const view = { width: 1, height: 1, dpr: 1, cx: 0, cy: 0, radius: 100, focal: 2000, cam: [0, 0, 2000], wall: 260, room: [1, 1, 1, 1] };
  const sim = { phi: 0.6, omega: reduced ? 0 : MAX_SPIN, cruise: reduced ? 0 : MAX_SPIN, parked: MAX_SPIN, dragging: false, releasing: false, pointerId: null, startX: 0, startPhi: 0, pointerX: 0, vel: 0, clock: 0 };
  const gelNow = [...LAMP];
  const gelTarget = [...LAMP];
  let coverToken = 0;
  let mix = 1;
  let quality = 1;
  let interval = 16.7;
  let slowFrames = 0;
  let visible = false;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let atlasReady = false;
  let maskOn = false;
  let maskDirty = Boolean(header);
  let fade = 0;
  let readySent = false;
  let maskCanvas = null;
  let fontsReady = !header;

  function layout() {
    const rect = box.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    view.width = w;
    view.height = h;
    const narrow = w < 640;
    let radius;
    if (narrow) {
      radius = Math.min(w * 0.3, h * 0.15);
      view.cx = w * 0.5;
      view.cy = embedded ? h * 0.4 : h * 0.42;
    } else {
      radius = Math.min(w * 0.12, h * 0.19);
      view.cx = w * 0.5;
      view.cy = embedded ? h * 0.4 : h * 0.43;
    }
    view.radius = clamp(radius, 40, 220);
    const R = view.radius;
    view.focal = 1.25 * Math.max(w, h);
    view.cam = [w / 2 - view.cx, view.cy - h / 2, view.focal];
    view.wall = R * 7;
    view.room = [1e6, 1e6, 1e6, R * 7];
    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    const budget = Math.sqrt(2400000 / (w * h));
    view.dpr = Math.max(0.6, Math.min(dprCap, budget));
    applyQuality(quality);
    maskDirty = Boolean(header);
  }

  function applyQuality(q) {
    quality = q;
    gl?.resize(Math.max(1, Math.round(view.width * view.dpr * q)), Math.max(1, Math.round(view.height * view.dpr * q)));
  }

  function drawMask() {
    maskDirty = false;
    if (!header || !fontsReady) return;
    const w = Math.max(1, Math.round(view.width * view.dpr * quality));
    const h = Math.max(1, Math.round(view.height * view.dpr * quality));
    if (!maskCanvas) maskCanvas = document.createElement("canvas");
    maskCanvas.width = w;
    maskCanvas.height = h;
    const ctx = maskCanvas.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    const scale = w / view.width;
    const boxRect = box.getBoundingClientRect();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 10;
    ctx.lineJoin = "round";
    ctx.filter = `blur(${Math.round(6 * scale)}px)`;
    ctx.textBaseline = "alphabetic";
    const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || el.closest("[data-mask-skip]")) continue;
      const style = getComputedStyle(el);
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      if ("letterSpacing" in ctx) ctx.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
      const text = node.textContent;
      const re = /\S+/g;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const rects = range.getClientRects();
        if (!rects.length) continue;
        const r = rects[0];
        const metrics = ctx.measureText(m[0]);
        const ascent = metrics.fontBoundingBoxAscent ?? r.height * 0.8;
        const descent = metrics.fontBoundingBoxDescent ?? r.height * 0.2;
        const baseline = r.top - boxRect.top + (r.height - ascent - descent) / 2 + ascent;
        ctx.strokeText(m[0], r.left - boxRect.left, baseline);
        ctx.fillText(m[0], r.left - boxRect.left, baseline);
      }
    }
    range.detach?.();
    gl.uploadMask(maskCanvas);
    maskOn = true;
  }

  function simulate(dt) {
    const idle = sim.cruise;
    if (sim.dragging) {
      const target = sim.startPhi + ((sim.pointerX - sim.startX) / view.radius) * 0.95;
      if (dt > 0.002) {
        const inst = (target - sim.phi) / dt;
        const k = 1 - Math.exp(-dt / 0.05);
        sim.vel += (inst - sim.vel) * k;
      }
      sim.phi = target;
      sim.omega = sim.vel;
      if (sim.releasing) {
        sim.dragging = false;
        sim.releasing = false;
        sim.omega = clamp(sim.vel, -MAX_SPIN, MAX_SPIN);
      }
    } else {
      const diff = sim.omega - idle;
      const decel = (VISCOUS * Math.abs(diff) + COULOMB * (reduced ? 4 : 1)) * dt;
      sim.omega = Math.abs(diff) <= decel ? idle : sim.omega - Math.sign(diff) * decel;
      sim.phi += sim.omega * dt;
    }
    if (!sim.dragging && Math.abs(sim.phi) > 1000) sim.phi %= Math.PI * 2;
    const g = reduced ? 1 : 1 - Math.exp(-dt / 0.22);
    let gelMoving = false;
    for (let i = 0; i < 3; i += 1) {
      gelNow[i] += (gelTarget[i] - gelNow[i]) * g;
      if (Math.abs(gelTarget[i] - gelNow[i]) > 0.002) gelMoving = true;
      else gelNow[i] = gelTarget[i];
    }
    if (atlasReady) fade = reduced ? 1 : Math.min(1, fade + dt / 0.9);
    const mixing = mix < 1;
    mix = reduced ? 1 : Math.min(1, mix + dt / 0.7);
    sim.clock += reduced ? 0 : dt;
    return gelMoving || mixing || (atlasReady && fade < 1);
  }

  function render() {
    const tilePx = (view.radius * Math.PI) / RINGS;
    const texelsPerTile = (0.3 * 1600) / (Math.PI * 2);
    const envLod = Math.max(0, Math.log2(Math.max(1, texelsPerTile / Math.max(tilePx * view.dpr * quality, 1))));
    gl.draw({
      width: view.width,
      height: view.height,
      cx: view.cx,
      cy: view.cy,
      radius: view.radius,
      focal: view.focal,
      cam: view.cam,
      wall: view.wall,
      room: view.room,
      mix: mix * mix * (3 - 2 * mix),
      rot: rotation(sim.phi),
      rotPrev: rotation(sim.phi - sim.omega * SHUTTER),
      light: LIGHT,
      gel: gelNow,
      spread: 0.0035,
      rayGain: 0.05,
      speckGain: 90,
      glintGain: 1.1,
      time: sim.clock,
      frag: 0.3,
      envLod,
      haze: 0.05,
      seed: reduced ? 0.37 : sim.clock * 0.731,
      maskOn,
      photoOn: atlasReady ? 1 : 0,
      fade: reduced ? 1 : 1 - Math.pow(1 - fade, 3),
    });
    if (atlasReady && !readySent && (maskOn || !header)) {
      readySent = true;
      onReady?.();
    }
  }

  function frame(now) {
    raf = 0;
    if (!gl || !visible || document.hidden || destroyed) return;
    const raw = last ? now - last : 16.7;
    const dt = last ? clamp(raw / 1000, 0, 0.05) : 0;
    last = now;
    if (maskDirty && fontsReady) drawMask();
    const busy = simulate(dt);
    if (!reduced) {
      interval = interval * 0.9 + raw * 0.1;
      slowFrames = interval > 40 ? slowFrames + 1 : 0;
      if (slowFrames > 45 && quality > 0.62) {
        slowFrames = 0;
        interval = 20;
        applyQuality(Math.max(0.6, quality * 0.85));
        maskDirty = Boolean(header);
      }
    }
    render();
    const spinning = Math.abs(sim.omega) > 0.0005;
    if (!reduced || sim.dragging || spinning || busy || maskDirty) raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (raf || !gl || !visible || document.hidden || destroyed) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function localX(e) {
    return e.clientX - box.getBoundingClientRect().left;
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (sim.dragging && !sim.releasing) return;
    canvas.setPointerCapture?.(e.pointerId);
    sim.dragging = true;
    sim.releasing = false;
    sim.pointerId = e.pointerId;
    sim.startX = localX(e);
    sim.pointerX = sim.startX;
    sim.startPhi = sim.phi;
    sim.vel = 0;
    sim.omega = 0;
    box.dataset.grabbing = "";
    wake();
  }

  function onMove(e) {
    if (!sim.dragging || sim.releasing || e.pointerId !== sim.pointerId) return;
    sim.pointerX = localX(e);
    wake();
  }

  function onUp(e) {
    if (!sim.dragging || e.pointerId !== sim.pointerId) return;
    sim.pointerX = e.type === "pointerup" ? localX(e) : sim.pointerX;
    sim.releasing = true;
    sim.pointerId = null;
    delete box.dataset.grabbing;
    wake();
  }

  function onKey(e) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      sim.cruise = clamp(sim.cruise + dir * (e.shiftKey ? MAX_SPIN : STEP), -MAX_SPIN, MAX_SPIN);
      if (Math.abs(sim.cruise) < 0.05) sim.cruise = 0;
      if (sim.cruise !== 0) sim.parked = sim.cruise;
      wake();
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (sim.cruise !== 0) {
        sim.parked = sim.cruise;
        sim.cruise = 0;
      } else sim.cruise = sim.parked;
      wake();
    }
  }

  layout();

  function loadCover(idx) {
    const token = ++coverToken;
    buildCover(ALBUM_CHOICES[idx].cover, facets)
      .then(({ atlas, tint }) => {
        if (destroyed || !gl || token !== coverToken) return;
        gl.uploadCover(atlas, tint);
        mix = atlasReady ? 0 : 1;
        atlasReady = true;
        wake();
      })
      .catch(() => {
        atlasReady = true;
        wake();
      });
  }

  loadCover(album);

  if (header) {
    document.fonts.ready.then(() => {
      if (destroyed) return;
      fontsReady = true;
      maskDirty = true;
      wake();
    });
  }

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) wake();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    { rootMargin: "80px" },
  );
  io.observe(box);
  const ro = new ResizeObserver(() => {
    layout();
    wake();
  });
  ro.observe(box);
  const onVisibility = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else wake();
  };
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("lostpointercapture", onUp);
  canvas.addEventListener("keydown", onKey);

  return {
    setAlbum(idx) {
      loadCover(idx);
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("lostpointercapture", onUp);
      canvas.removeEventListener("keydown", onKey);
      gl?.destroy();
      gl = null;
    },
  };
}
