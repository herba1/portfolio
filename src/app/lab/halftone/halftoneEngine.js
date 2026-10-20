import { albumById } from "@/app/lab/_music/catalog";

import { createHalftoneSound } from "./halftoneAudio";
import { createGL } from "./halftoneGL";

const FONT = "HalftoneArimo";
const LINES = ["it never", "really faded"];
const COVERS = ["with-the-beatles", "abbey-road", "let-it-be", "help"].map((id) => albumById(id));
const TAU = Math.PI * 2;
const COVER_EVERY = 38;
const DISSOLVE = 2.6;
const BREATH = 19;
const DISP_CELL = 14;
const PAPER = [0.953, 0.933, 0.886];
const INK = [0.085, 0.08, 0.075];

const loadImage = (src) =>
  new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

const smooth = (x) => x * x * (3 - 2 * x);

export function createHalftone(stage, { embedded = false, caption = null, onLive = () => {}, onFail = () => {}, onGesture = () => {} } = {}) {
  const root = document.createElement("div");
  root.className = "halftone-screen";
  root.tabIndex = embedded ? 0 : -1;
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", `${COVERS[0].title} printed as a halftone, with the line ${LINES.join(" ")}. Drag across it to push the dots.`);
  const canvas = document.createElement("canvas");
  canvas.className = "halftone-canvas";
  root.append(canvas);
  stage.append(root);

  const gl = createGL(canvas);
  if (!gl) {
    root.remove();
    onFail();
    return { destroy() {}, setSound: async () => false };
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let sound = null;
  let images = [];
  let W = 0;
  let H = 0;
  let scale = 1;
  let art = { x: 0, y: 0, s: 100, w: 100, h: 140, font: 40, line: 40, gap: 12 };
  let nx = 0;
  let ny = 0;
  let off = new Float32Array(0);
  let vel = new Float32Array(0);
  let tex = new Float32Array(0);
  let settled = true;
  let plates = [];
  let shown = 0;
  let plateSlot = 0;
  let coverIndex = 0;
  let mix = 0;
  let mixing = false;
  let ready = false;
  let destroyed = false;
  let visible = !document.hidden;
  let onscreen = true;
  let raf = 0;
  let last = performance.now();
  let clock = 0;
  let fade = 0;
  let pointer = null;
  let engage = 0;
  let sizeKey = "";

  const makePlate = (img) => {
    const ps = Math.min(2, window.devicePixelRatio || 1);
    const c = document.createElement("canvas");
    c.width = Math.max(2, Math.round(art.w * ps));
    c.height = Math.max(2, Math.round(art.h * ps));
    const x = c.getContext("2d", { willReadFrequently: true });
    x.fillStyle = "#fff";
    x.fillRect(0, 0, c.width, c.height);
    const S = Math.round(art.s * ps);
    if (img) {
      x.imageSmoothingQuality = "high";
      x.drawImage(img, 0, 0, S, S);
      const im = x.getImageData(0, 0, S, S);
      const d = im.data;
      for (let i = 0; i < d.length; i += 4) {
        const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        const v = Math.min(1, Math.max(0, (l - 0.5) * 1.1 + 0.52));
        const tone = v > 0.985 ? 0 : 0.05 + 0.83 * Math.pow(1 - v, 0.95);
        const b = Math.round((1 - tone) * 255);
        d[i] = b;
        d[i + 1] = b;
        d[i + 2] = b;
      }
      x.putImageData(im, 0, 0);
    }
    x.fillStyle = "rgb(82,82,82)";
    x.textBaseline = "alphabetic";
    x.font = `${art.font * ps}px ${FONT}`;
    LINES.forEach((line, i) => {
      x.fillText(line, -art.font * 0.06 * ps, (art.s + art.gap + art.line * (i + 0.8)) * ps);
    });
    return c;
  };

  const rebuildPlates = () => {
    plates = COVERS.map((_, i) => (images[i] !== undefined ? makePlate(images[i]) : null));
    if (plates[coverIndex]) gl.plate(plateSlot, plates[coverIndex]);
    const next = (coverIndex + 1) % COVERS.length;
    if (plates[next]) gl.plate(1 - plateSlot, plates[next]);
  };

  const layout = (force) => {
    const sr = stage.getBoundingClientRect();
    if (!sr.width || !sr.height) return;
    const key = `${Math.round(sr.width)}x${Math.round(sr.height)}x${window.devicePixelRatio}`;
    if (!force && key === sizeKey) return;
    sizeKey = key;
    W = Math.round(sr.width);
    H = Math.round(sr.height);
    const maxScale = Math.min(window.devicePixelRatio || 1, 2);
    scale = Math.min(maxScale, Math.sqrt(4600000 / (W * H)));
    root.style.width = `${W}px`;
    root.style.height = `${H}px`;
    gl.resize(Math.round(W * scale), Math.round(H * scale));
    const narrow = W < 640;
    const side = embedded ? 20 : narrow ? 16 : 32;
    if (caption) {
      caption.style.left = `${side}px`;
      caption.style.width = `${W - side * 2}px`;
    }
    const capBottom = caption ? caption.getBoundingClientRect().bottom - sr.top : 0;
    const top = caption ? capBottom + (narrow ? 28 : 36) : side;
    const bottom = embedded ? side : narrow ? 32 : 48;
    const availW = W - side * 2;
    const availH = H - top - bottom;
    const k = 0.158;
    let S = Math.min(availW, availH / (1 + 0.055 + 2 * k * 0.98), 560);
    S = Math.max(120, Math.floor(S));
    const probe = document.createElement("canvas").getContext("2d");
    let font = S * k;
    probe.font = `100px ${FONT}`;
    const widest = Math.max(...LINES.map((l) => probe.measureText(l).width / 100));
    if (widest * font > S * 1.02) font = (S * 1.02) / widest;
    const line = Math.round(font * 0.98);
    const gap = Math.round(S * 0.055);
    const h = S + gap + line * 2 + Math.round(font * 0.24);
    const x = Math.round((W - S) / 2);
    const y = Math.round(top + Math.max(0, (availH - h) / 2));
    art = { x, y, s: S, w: S, h, font, line, gap };
    nx = Math.ceil(W / DISP_CELL) + 2;
    ny = Math.ceil(H / DISP_CELL) + 2;
    off = new Float32Array(nx * ny * 2);
    vel = new Float32Array(nx * ny * 2);
    tex = new Float32Array(nx * ny * 2);
    gl.disp(tex, nx, ny);
    settled = true;
    rebuildPlates();
    wake();
  };

  const reach = () => Math.max(46, Math.min(112, art.s * 0.18));

  const stepField = (dt) => {
    if (!pointer && settled) return false;
    const target = pointer ? 1 : 0;
    engage += (target - engage) * (1 - Math.exp(-dt / (pointer ? 0.08 : 0.05)));
    const R = reach();
    const A = R * 0.4;
    const K = 150;
    const C = 2 * 0.82 * Math.sqrt(K);
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    const px = pointer ? pointer.x : 0;
    const py = pointer ? pointer.y : 0;
    const R2 = (R * 2.8) * (R * 2.8);
    let maxMove = 0;
    for (let s = 0; s < steps; s += 1) {
      for (let j = 0; j < ny; j += 1) {
        const y = j * DISP_CELL;
        for (let i = 0; i < nx; i += 1) {
          const k2 = (j * nx + i) * 2;
          let tx = 0;
          let ty = 0;
          if (pointer && engage > 0.001) {
            const dx = i * DISP_CELL - px;
            const dy = y - py;
            const d2 = dx * dx + dy * dy;
            if (d2 < R2 && d2 > 0.0001) {
              const d = Math.sqrt(d2);
              const t = d / R;
              const mag = A * t * Math.exp(0.5 - 0.5 * t * t) * engage;
              tx = (dx / d) * mag;
              ty = (dy / d) * mag;
            }
          }
          const ax = K * (tx - off[k2]) - C * vel[k2];
          const ay = K * (ty - off[k2 + 1]) - C * vel[k2 + 1];
          vel[k2] += ax * h;
          vel[k2 + 1] += ay * h;
          off[k2] += vel[k2] * h;
          off[k2 + 1] += vel[k2 + 1] * h;
          if (s === steps - 1) {
            const m = Math.abs(off[k2]) + Math.abs(off[k2 + 1]) + Math.abs(vel[k2]) * 0.05 + Math.abs(vel[k2 + 1]) * 0.05;
            if (m > maxMove) maxMove = m;
          }
        }
      }
    }
    if (!pointer && maxMove < 0.02) {
      off.fill(0);
      vel.fill(0);
      settled = true;
    } else settled = false;
    tex.set(off);
    gl.disp(tex, nx, ny);
    return true;
  };

  const frame = () => {
    const now = performance.now();
    raf = 0;
    if (destroyed) return;
    const raw = Math.min(0.25, Math.max(0.001, (now - last) / 1000));
    const dt = Math.min(0.05, raw);
    last = now;
    clock += dt * (reduced ? 0.35 : 1);
    if (ready) fade = Math.min(1, fade + raw / 0.9);
    stepField(dt);

    const t = clock;
    const breath = Math.pow(0.5 - 0.5 * Math.cos((TAU * t) / BREATH), 2.2);
    const cMin = Math.max(4, art.s / 96);
    const cMax = Math.max(7, art.s / 50);
    const drift = 0.5 + 0.5 * Math.sin((TAU * t) / 23 + 0.4);
    const coarse = cMin + (cMax - cMin) * (0.35 + 0.65 * drift);
    const cell = coarse + (cMin * 0.75 - coarse) * Math.pow(breath, 0.6);
    const angle = ((45 + 26 * Math.sin((TAU * t) / 41) + 9 * Math.sin((TAU * t) / 14.3)) * Math.PI) / 180;
    const shape = ((t + 1.2) / 9.5) % 3;

    const due = Math.floor(t / COVER_EVERY);
    if (!mixing && due > shown && plates.length) {
      const next = (coverIndex + 1) % COVERS.length;
      if (plates[next]) {
        mixing = true;
        mix = 0;
        sound?.impression();
        onLive(`${COVERS[next].title}`);
      } else shown = due;
    }
    if (mixing) {
      mix = Math.min(1, mix + dt / DISSOLVE);
      if (mix >= 1) {
        mixing = false;
        shown += 1;
        coverIndex = (coverIndex + 1) % COVERS.length;
        plateSlot = 1 - plateSlot;
        mix = 0;
        const after = (coverIndex + 1) % COVERS.length;
        if (plates[after]) gl.plate(1 - plateSlot, plates[after]);
        root.setAttribute("aria-label", `${COVERS[coverIndex].title} printed as a halftone, with the line ${LINES.join(" ")}. Drag across it to push the dots.`);
      }
    }

    gl.render({
      plateA: plateSlot,
      scale,
      origin: [art.x + art.s / 2, art.y + art.s / 2],
      art: [art.x, art.y, art.w, art.h],
      dispCell: DISP_CELL,
      nx,
      ny,
      cell,
      angle,
      shape,
      clean: breath,
      mix: smooth(mix),
      time: now / 1000,
      fade: smooth(fade),
      paper: PAPER,
      ink: INK,
    });
    raf = requestAnimationFrame(frame);
  };

  function wake() {
    if (destroyed || raf || !visible || !onscreen || !W) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const local = (e) => {
    const r = root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const panOf = (x) => (W ? (x / W) * 2 - 1 : 0);

  const onDown = (e) => {
    if (e.button > 0) return;
    onGesture();
    const p = local(e);
    pointer = { ...p, id: e.pointerId, t: performance.now() };
    settled = false;
    root.setPointerCapture?.(e.pointerId);
    sound?.press(panOf(p.x));
  };

  const onMove = (e) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    const p = local(e);
    const now = performance.now();
    const dt = Math.max(8, now - pointer.t);
    const speed = (Math.hypot(p.x - pointer.x, p.y - pointer.y) / dt) * 1000;
    pointer.x = p.x;
    pointer.y = p.y;
    pointer.t = now;
    sound?.drag(speed, panOf(p.x));
  };

  const onUp = (e) => {
    if (!pointer || e.pointerId !== pointer.id) return;
    sound?.release(panOf(pointer.x));
    pointer = null;
  };

  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
    else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  document.addEventListener("visibilitychange", onVisibility);
  const ro = new ResizeObserver(() => {
    if (W) layout(false);
  });
  ro.observe(stage);
  const io = new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    if (onscreen) wake();
    else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  });
  io.observe(root);

  const boot = async () => {
    const first = loadImage(COVERS[0].cover);
    await Promise.race([document.fonts.load(`100px ${FONT}`).catch(() => {}), new Promise((r) => setTimeout(r, 2500))]);
    if (destroyed) return;
    images[0] = await first;
    if (destroyed) return;
    layout(true);
    ready = true;
    root.dataset.ready = "";
    const rest = await Promise.all(COVERS.slice(1).map((c) => loadImage(c.cover)));
    if (destroyed) return;
    images = [images[0], ...rest];
    rebuildPlates();
  };
  boot();

  return {
    async setSound(on) {
      if (on && !sound) sound = createHalftoneSound();
      if (!sound) return false;
      return sound.setEnabled(on);
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      document.removeEventListener("visibilitychange", onVisibility);
      sound?.destroy();
      gl.dispose();
      root.remove();
    },
  };
}
