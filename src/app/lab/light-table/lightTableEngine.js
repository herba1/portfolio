import { LAYOUTS, PIECES, TEXEL_MM, buildPiece, readFonts } from "./lightTableFilm";
import { createLightTableGL } from "./lightTableGL";

const SUB = 1 / 240;
const BEZEL = 7;
const MAX_SPEED = 560;
const POWER_S = 0.9;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (t) => t * t * (3 - 2 * t);

export function createLightTableEngine({ box, stage, canvas, insets, embedded, onReady, onFail }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const view = { width: 1, height: 1, dpr: 1, scale: 1, gx: 0, gy: 0, layout: LAYOUTS[0] };
  const bodies = PIECES.map((def) => ({
    def,
    x: 0,
    y: 0,
    a: 0,
    vx: 0,
    vy: 0,
    va: 0,
    hw: def.w / 2,
    hh: def.h / 2,
    inertia: (def.w * def.w + def.h * def.h) / 12,
    moving: false,
  }));
  let order = bodies.slice();
  const drags = new Map();
  let gl = null;
  let failed = false;
  let visible = false;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let loaded = false;
  let power = reduced ? 1 : 0;
  let quality = 1;
  let motionQuality = 1;
  let interval = 16;
  let placed = "";

  function layout() {
    const pad = insets();
    const side = embedded ? 16 : view.width >= 900 ? 48 : 16;
    const availW = Math.max(80, view.width - side * 2);
    const availH = Math.max(80, view.height - pad.top - pad.bottom);
    let best = null;
    for (const L of LAYOUTS) {
      const ow = L.w + BEZEL * 2;
      const oh = L.h + BEZEL * 2;
      const s = Math.min(availW / ow, availH / oh);
      const fill = (s * ow * s * oh) / (availW * availH);
      if (!best || fill > best.fill + 0.04) best = { L, s, fill };
    }
    view.layout = best.L;
    view.scale = best.s;
    view.gx = view.width / 2 - (best.L.w * best.s) / 2;
    view.gy = pad.top + availH / 2 - (best.L.h * best.s) / 2;
    if (placed !== best.L.key) place(best.L);
  }

  function place(L) {
    placed = L.key;
    drags.clear();
    for (const b of bodies) {
      const [x, y, deg] = L.pieces[b.def.key];
      b.x = x;
      b.y = y;
      b.a = (deg * Math.PI) / 180;
      b.vx = b.vy = b.va = 0;
      b.moving = false;
    }
    order = bodies.slice();
  }

  function toMm(sx, sy) {
    return [(sx - view.gx) / view.scale, (sy - view.gy) / view.scale];
  }

  function local(e) {
    const rect = box.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function pick(mx, my) {
    for (let i = order.length - 1; i >= 0; i -= 1) {
      const b = order[i];
      const dx = mx - b.x;
      const dy = my - b.y;
      const c = Math.cos(b.a);
      const s = Math.sin(b.a);
      const lx = c * dx + s * dy;
      const ly = -s * dx + c * dy;
      if (Math.abs(lx) < b.hw + 1.5 && Math.abs(ly) < b.hh + 1.5) return { body: b, lx, ly };
    }
    return null;
  }

  function walls(obj, inset) {
    const L = view.layout;
    const lo = inset;
    const hiX = L.w - inset;
    const hiY = L.h - inset;
    if (obj.x < lo) {
      obj.x = lo;
      if (obj.vx < 0) obj.vx *= -0.22;
    } else if (obj.x > hiX) {
      obj.x = hiX;
      if (obj.vx > 0) obj.vx *= -0.22;
    }
    if (obj.y < lo) {
      obj.y = lo;
      if (obj.vy < 0) obj.vy *= -0.22;
    } else if (obj.y > hiY) {
      obj.y = hiY;
      if (obj.vy > 0) obj.vy *= -0.22;
    }
  }

  function slide(obj, h, mu, visc) {
    const sp = Math.hypot(obj.vx, obj.vy);
    if (sp > 0) {
      const k = Math.max(0, sp - mu * h) / sp;
      obj.vx *= k;
      obj.vy *= k;
    }
    const v = Math.exp(-visc * h);
    obj.vx *= v;
    obj.vy *= v;
  }

  function stepBody(b, drag, h) {
    if (drag) {
      const c = Math.cos(b.a);
      const s = Math.sin(b.a);
      const rx = c * drag.lx - s * drag.ly;
      const ry = s * drag.lx + c * drag.ly;
      const ex = drag.tx - (b.x + rx);
      const ey = drag.ty - (b.y + ry);
      const vpx = b.vx - b.va * ry;
      const vpy = b.vy + b.va * rx;
      const omega = 30;
      const k = omega * omega;
      const damp = 2 * 0.95 * omega;
      const fx = k * ex + damp * (drag.vx - vpx);
      const fy = k * ey + damp * (drag.vy - vpy);
      b.vx += fx * h;
      b.vy += fy * h;
      b.va += ((rx * fy - ry * fx) / b.inertia) * h * 0.36;
      const drift = Math.exp(-3.2 * h);
      b.vx *= drift;
      b.vy *= drift;
      b.va *= Math.exp(-12 * h);
    } else {
      slide(b, h, 1050, 1.8);
      const av = Math.abs(b.va);
      if (av > 0) b.va *= Math.max(0, av - 7 * h) / av;
      b.va *= Math.exp(-2.6 * h);
    }
    b.va = clamp(b.va, -7, 7);
    b.x += b.vx * h;
    b.y += b.vy * h;
    b.a += b.va * h;
    walls(b, 2);
  }

  function updateDrags(dt) {
    for (const drag of drags.values()) {
      if (drag.px == null) continue;
      const [mx, my] = toMm(drag.px, drag.py);
      if (dt > 0 && drag.prevX != null) {
        const vx = (mx - drag.prevX) / dt;
        const vy = (my - drag.prevY) / dt;
        const k = 1 - Math.exp(-dt / 0.04);
        drag.vx += (vx - drag.vx) * k;
        drag.vy += (vy - drag.vy) * k;
      }
      drag.prevX = mx;
      drag.prevY = my;
      drag.tx = mx;
      drag.ty = my;
    }
  }

  function dragOf(target) {
    for (const d of drags.values()) if (d.target === target) return d;
    return null;
  }

  function simulate(dt) {
    if (reduced) {
      for (const b of bodies) {
        const d = dragOf(b);
        if (!d) continue;
        const c = Math.cos(b.a);
        const s = Math.sin(b.a);
        b.x = d.tx - (c * d.lx - s * d.ly);
        b.y = d.ty - (s * d.lx + c * d.ly);
        walls(b, 2);
      }
      return;
    }
    const steps = Math.max(1, Math.ceil(dt / SUB));
    const h = dt / steps;
    for (let i = 0; i < steps; i += 1) {
      for (const b of bodies) {
        const d = dragOf(b);
        if (d || b.moving) stepBody(b, d, h);
      }
    }
    for (const b of bodies) {
      if (dragOf(b)) {
        b.moving = true;
        continue;
      }
      if (b.moving && Math.hypot(b.vx, b.vy) < 0.6 && Math.abs(b.va) < 0.004) {
        b.vx = b.vy = b.va = 0;
        b.moving = false;
      }
    }
  }

  function busy() {
    if (drags.size || power < 1) return true;
    return bodies.some((b) => b.moving);
  }

  function render() {
    const s = view.scale;
    const pieces = order.map((b) => ({
      x: view.gx + b.x * s,
      y: view.gy + b.y * s,
      a: b.a,
      hw: b.hw * s,
      hh: b.hh * s,
      code: b.def.code,
      seed: b.def.seed,
      rect: b.def.rect,
    }));
    const L = view.layout;
    gl.draw({
      height: view.height,
      scale: s,
      glass: [view.gx, view.gy, view.gx + L.w * s, view.gy + L.h * s],
      bezel: BEZEL * s,
      power: reduced ? 1 : smooth(clamp(power, 0, 1)),
      texel: TEXEL_MM,
      pieces,
    });
  }

  function frame(now) {
    raf = 0;
    if (!gl || !loaded || !visible || document.hidden || destroyed) return;
    const raw = last ? now - last : 16.67;
    const dt = clamp(raw / 1000, 0, 0.05);
    last = now;
    updateDrags(dt);
    simulate(dt);
    if (power < 1) power = Math.min(1, power + Math.min(raw / 1000, 0.25) / POWER_S);
    const moving = busy();
    if (moving) {
      interval = interval * 0.75 + raw * 0.25;
      if (interval > 34 && motionQuality > 0.6) {
        motionQuality = Math.max(0.6, motionQuality * 0.88);
        interval = 20;
      }
      if (quality !== motionQuality) applyQuality(motionQuality);
    }
    render();
    if (!moving && quality !== 1) {
      applyQuality(1);
      render();
    }
    if (moving) raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (raf || !gl || !loaded || !visible || document.hidden || destroyed) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  async function load() {
    try {
      const fonts = await readFonts(box);
      for (const piece of PIECES) {
        const data = await buildPiece(piece, fonts);
        if (destroyed || !gl) return;
        gl.upload(piece, data);
      }
      if (destroyed || !gl) return;
      gl.finish();
      loaded = true;
      onReady();
      wake();
    } catch (error) {
      console.error(error);
      if (!destroyed) {
        failed = true;
        onFail();
      }
    }
  }

  function init() {
    if (gl || failed) return;
    try {
      gl = createLightTableGL(canvas);
    } catch (error) {
      console.error(error);
      gl = null;
    }
    if (!gl) {
      failed = true;
      onFail();
      return;
    }
    resize();
    load();
  }

  function resize() {
    const rect = box.getBoundingClientRect();
    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    const budget = Math.sqrt(2600000 / Math.max(1, rect.width * rect.height));
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    view.dpr = Math.max(0.75, Math.min(dprCap, budget));
    layout();
    applyQuality(quality);
    if (gl && loaded) {
      render();
      wake();
    }
  }

  function applyQuality(q) {
    quality = q;
    if (gl) gl.resize(Math.max(1, Math.round(view.width * view.dpr * q)), Math.max(1, Math.round(view.height * view.dpr * q)));
  }

  function setHover(kind) {
    if (kind) box.dataset.hover = kind;
    else delete box.dataset.hover;
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!loaded) return;
    const [x, y] = local(e);
    const [mx, my] = toMm(x, y);
    const hit = pick(mx, my);
    if (!hit) return;
    const target = hit.body;
    if (dragOf(target)) return;
    stage.setPointerCapture?.(e.pointerId);
    order = order.filter((b) => b !== target);
    order.push(target);
    drags.set(e.pointerId, {
      target,
      lx: hit.lx,
      ly: hit.ly,
      px: x,
      py: y,
      prevX: null,
      prevY: null,
      tx: mx,
      ty: my,
      vx: target.vx,
      vy: target.vy,
    });
    box.dataset.grabbing = "";
    e.preventDefault();
    wake();
  }

  function onMove(e) {
    const drag = drags.get(e.pointerId);
    const [x, y] = local(e);
    if (drag) {
      drag.px = x;
      drag.py = y;
      wake();
      return;
    }
    if (e.pointerType !== "mouse" || !loaded || drags.size) return;
    const [mx, my] = toMm(x, y);
    setHover(pick(mx, my) ? "grab" : null);
  }

  function onUp(e) {
    const drag = drags.get(e.pointerId);
    if (!drag) return;
    drags.delete(e.pointerId);
    const t = drag.target;
    const sp = Math.hypot(t.vx, t.vy);
    if (sp > MAX_SPEED) {
      t.vx *= MAX_SPEED / sp;
      t.vy *= MAX_SPEED / sp;
    }
    if (reduced) {
      t.vx = t.vy = 0;
      t.va = 0;
      t.moving = false;
    }
    if (!drags.size) delete box.dataset.grabbing;
    wake();
  }

  function onKey(e) {
    if (!loaded) return;
    const push = e.shiftKey ? 260 : 120;
    const top = order[order.length - 1];
    let dx = 0;
    let dy = 0;
    if (e.key === "ArrowLeft") dx = -1;
    else if (e.key === "ArrowRight") dx = 1;
    else if (e.key === "ArrowUp") dy = -1;
    else if (e.key === "ArrowDown") dy = 1;
    else if (e.key === " " || e.key === "Enter") {
      order = [order[order.length - 1], ...order.slice(0, -1)];
      e.preventDefault();
      render();
      return;
    } else return;
    e.preventDefault();
    if (reduced) {
      top.x += dx * (e.shiftKey ? 20 : 8);
      top.y += dy * (e.shiftKey ? 20 : 8);
      walls(top, 2);
      render();
      return;
    }
    top.vx += dx * push;
    top.vy += dy * push;
    top.moving = true;
    wake();
  }

  function onLeave(e) {
    if (e.pointerType === "mouse" && !drags.size) setHover(null);
  }

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        init();
        wake();
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    { rootMargin: "160px" },
  );
  io.observe(box);
  const ro = new ResizeObserver(() => resize());
  ro.observe(box);
  const onVisibility = () => {
    if (!document.hidden) wake();
  };
  document.addEventListener("visibilitychange", onVisibility);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("pointerleave", onLeave);
  stage.addEventListener("keydown", onKey);

  return {
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("pointerleave", onLeave);
      stage.removeEventListener("keydown", onKey);
      if (gl) gl.destroy();
      gl = null;
    },
  };
}
