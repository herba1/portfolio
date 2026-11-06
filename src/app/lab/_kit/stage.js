// The shared stage for factory pieces: a canvas that fills the piece box,
// pointer input in box pixels with velocity, and a frame loop that sleeps
// while the piece is off screen or the tab is hidden.
//
//   const stage = createStage(host, { dpr: 1.5, webgl: false });
//   stage.onFrame((dt, t) => …); stage.onResize((w, h, dpr) => …);
//   stage.pointer  { x, y, vx, vy, down, inside, lastInput }
//   stage.on("down" | "move" | "up", fn)
export function createStage(host, { dpr: maxDpr = 1.5, webgl = false, alpha = false } = {}) {
  const box = host.closest(".piece-box") || host;
  const canvas = document.createElement("canvas");
  canvas.className = "kit-canvas";
  host.appendChild(canvas);
  const ctx = webgl ? canvas.getContext("webgl2", { alpha, antialias: true, premultipliedAlpha: false, preserveDrawingBuffer: false }) : canvas.getContext("2d", { alpha });

  const pointer = { x: 0, y: 0, vx: 0, vy: 0, down: false, inside: false, lastInput: -1e9, id: null };
  const listeners = { down: [], move: [], up: [] };
  const frames = [];
  const resizes = [];
  let width = 1;
  let height = 1;
  let dpr = 1;
  let raf = 0;
  let visible = true;
  let last = 0;
  let destroyed = false;

  const resize = () => {
    const r = box.getBoundingClientRect();
    width = Math.max(1, Math.round(r.width));
    height = Math.max(1, Math.round(r.height));
    dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    for (const fn of resizes) fn(width, height, dpr);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(box);

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  let lastMove = 0;
  const onDown = (e) => {
    if (pointer.down) return;
    const [x, y] = local(e);
    Object.assign(pointer, { x, y, vx: 0, vy: 0, down: true, inside: true, id: e.pointerId, lastInput: performance.now() });
    lastMove = performance.now();
    canvas.setPointerCapture?.(e.pointerId);
    for (const fn of listeners.down) fn(pointer, e);
  };
  const onMove = (e) => {
    const [x, y] = local(e);
    const now = performance.now();
    const dt = Math.max(1, now - lastMove);
    const k = Math.min(1, dt / 40);
    pointer.vx += ((x - pointer.x) / dt * 1000 - pointer.vx) * k;
    pointer.vy += ((y - pointer.y) / dt * 1000 - pointer.vy) * k;
    pointer.x = x;
    pointer.y = y;
    pointer.inside = true;
    pointer.lastInput = now;
    lastMove = now;
    for (const fn of listeners.move) fn(pointer, e);
  };
  const onUp = (e) => {
    if (!pointer.down || (pointer.id != null && e.pointerId !== pointer.id)) return;
    pointer.down = false;
    pointer.id = null;
    pointer.lastInput = performance.now();
    if (performance.now() - lastMove > 60) {
      pointer.vx = 0;
      pointer.vy = 0;
    }
    for (const fn of listeners.up) fn(pointer, e);
  };
  const onLeave = () => {
    pointer.inside = false;
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);

  const loop = (t) => {
    raf = 0;
    if (destroyed || !visible) return;
    const dt = Math.min(1 / 20, last ? (t - last) / 1000 : 1 / 60);
    last = t;
    // Velocity bleeds away when the pointer stops moving.
    if (t - lastMove > 50) {
      pointer.vx *= 0.8;
      pointer.vy *= 0.8;
    }
    for (const fn of frames) fn(dt, t / 1000);
    raf = requestAnimationFrame(loop);
  };
  const wake = () => {
    if (!raf && visible && !destroyed) {
      last = 0;
      raf = requestAnimationFrame(loop);
    }
  };
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && !document.hidden;
    wake();
  });
  io.observe(box);
  const onVis = () => {
    visible = !document.hidden;
    wake();
  };
  document.addEventListener("visibilitychange", onVis);

  queueMicrotask(() => {
    resize();
    wake();
  });

  return {
    canvas,
    ctx,
    pointer,
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    get dpr() {
      return dpr;
    },
    idleFor: () => performance.now() - pointer.lastInput,
    onFrame: (fn) => frames.push(fn),
    onResize: (fn) => {
      resizes.push(fn);
      if (width > 1) fn(width, height, dpr);
    },
    on: (type, fn) => listeners[type].push(fn),
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      canvas.remove();
    },
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const mix = (a, b, t) => a + (b - a) * t;
// Frame-rate independent approach: covers `rate` of the distance per second.
export const damp = (a, b, lambda, dt) => b + (a - b) * Math.exp(-lambda * dt);
