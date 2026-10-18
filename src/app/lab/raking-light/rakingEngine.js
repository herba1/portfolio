import { BADGES, CELL, buildBadges } from "./rakingBadges";
import { createRakingGL } from "./rakingGL";

export const LAMP_MIN = 2;
export const LAMP_MAX = 90;
const LAMP_REST = 11;
const LOG_MIN = Math.log(LAMP_MIN);
const LOG_MAX = Math.log(LAMP_MAX);
const SUB = 1 / 240;
const IDLE_AFTER = 2.6;
const INTRO_S = 1.6;
const VISIBLE = [560 / CELL, 584 / CELL, 560 / CELL];
const TALL = [416 / 560, 1, 1];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const easeOut = (t) => 1 - Math.pow(1 - t, 4);

function spring(state, key, velKey, target, omega, h) {
  const a = omega * omega * (target - state[key]) - 2 * omega * state[velKey];
  state[velKey] += a * h;
  state[key] += state[velKey] * h;
}

export function createRakingEngine({ box, stage, canvas, tag, slider, insets, onReady, onFail }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const view = { width: 1, height: 1, dpr: 1, pxPerMm: 4, cx: 0, cy: 0, spanX: 100, spanY: 60 };
  const lamp = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, lz: Math.log(LAMP_REST), vlz: 0, tlz: Math.log(LAMP_REST), power: 0 };
  const rects = new Float32Array(12);
  const lift = new Float32Array(3);
  const pointers = new Map();
  let pinch = null;
  let gl = null;
  let visible = false;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let quality = 1;
  let motionQuality = 1;
  let interval = 16;
  let introT = reduced ? INTRO_S : 0;
  let idleT = IDLE_AFTER;
  let orbit = 0;
  let shownHeight = "";
  let tagOn = false;
  let sentReady = false;
  let placed = false;

  function layout() {
    const pad = insets();
    const availW = Math.max(200, view.width - 32);
    const availH = Math.max(200, view.height - pad.top - pad.bottom);
    const narrow = view.width < 720;
    const mm = BADGES.map((b, i) => b.widthMm / VISIBLE[i]);
    const vis = BADGES.map((b, i) => [b.widthMm, b.widthMm * TALL[i]]);
    const gap = 12;
    let centres;
    if (narrow) {
      const wMm = Math.max(vis[1][0], vis[0][0] + vis[2][0] + gap);
      const hMm = vis[1][1] + gap + Math.max(vis[0][1], vis[2][1]);
      view.pxPerMm = Math.min((availW * 0.94) / wMm, (availH * 0.9) / hMm);
      view.spanX = wMm / 2;
      view.spanY = hMm / 2;
      const topY = -hMm / 2 + vis[1][1] / 2;
      const lowY = hMm / 2 - Math.max(vis[0][1], vis[2][1]) / 2;
      centres = [
        [-(vis[2][0] + gap) / 2, lowY],
        [0, topY],
        [(vis[0][0] + gap) / 2, lowY + 2],
      ];
    } else {
      const wMm = vis[0][0] + vis[1][0] + vis[2][0] + gap * 2;
      const hMm = Math.max(vis[0][1], vis[1][1], vis[2][1]);
      view.pxPerMm = Math.min((availW * 0.84) / wMm, (availH * 0.82) / hMm);
      view.spanX = wMm / 2;
      view.spanY = hMm / 2;
      const x0 = -wMm / 2;
      centres = [
        [x0 + vis[0][0] / 2, 4],
        [x0 + vis[0][0] + gap + vis[1][0] / 2, -2],
        [x0 + vis[0][0] + vis[1][0] + gap * 2 + vis[2][0] / 2, 6],
      ];
    }
    view.cx = view.width / 2;
    view.cy = pad.top + availH / 2;
    BADGES.forEach((b, i) => {
      rects[i * 4] = view.cx + centres[i][0] * view.pxPerMm;
      rects[i * 4 + 1] = view.cy + centres[i][1] * view.pxPerMm;
      rects[i * 4 + 2] = (mm[i] / 2) * view.pxPerMm;
      rects[i * 4 + 3] = b.tilt;
    });
    if (!placed) {
      placed = true;
      orbit = Math.PI * 0.85;
      const [ox, oy] = orbitPoint(orbit);
      lamp.x = lamp.tx = ox;
      lamp.y = lamp.ty = oy;
    }
  }

  function orbitPoint(a) {
    const rx = (view.spanX + 10) * view.pxPerMm;
    const ry = (view.spanY + 8) * view.pxPerMm;
    return [view.cx + Math.cos(a) * rx, view.cy + Math.sin(a) * ry * 0.9];
  }

  function init() {
    if (gl) return;
    try {
      gl = createRakingGL(canvas);
    } catch (error) {
      console.error(error);
      gl = null;
    }
    if (!gl) {
      onFail();
      return;
    }
    resize();
    const sans = getComputedStyle(box).fontFamily || "system-ui, sans-serif";
    document.fonts.ready.then(() => {
      if (destroyed || !gl) return;
      gl.upload(buildBadges(sans));
      wake();
    });
  }

  function resize() {
    const rect = box.getBoundingClientRect();
    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    const budget = Math.sqrt(2200000 / Math.max(1, rect.width * rect.height));
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    view.dpr = Math.max(0.75, Math.min(dprCap, budget));
    layout();
    applyQuality(quality);
    wake();
  }

  function applyQuality(q) {
    quality = q;
    gl?.resize(Math.max(1, Math.round(view.width * view.dpr * q)), Math.max(1, Math.round(view.height * view.dpr * q)));
  }

  function syncSlider() {
    if (slider && document.activeElement !== slider) slider.value = String(Math.round(((lamp.tlz - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 1000));
  }

  function setLamp(x, y) {
    lamp.tx = clamp(x, 0, view.width);
    lamp.ty = clamp(y, 0, view.height);
    idleT = 0;
    if (reduced) {
      lamp.x = lamp.tx;
      lamp.y = lamp.ty;
    }
    wake();
  }

  function setHeight(lz) {
    lamp.tlz = clamp(lz, LOG_MIN, LOG_MAX);
    if (reduced) lamp.lz = lamp.tlz;
    syncSlider();
    wake();
  }

  function local(e) {
    const rect = box.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function touchLift(type) {
    return type === "touch" ? -Math.min(64, view.height * 0.08) : 0;
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    stage.setPointerCapture?.(e.pointerId);
    const [x, y] = local(e);
    pointers.set(e.pointerId, { x, y, type: e.pointerType });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, lz: lamp.tlz };
    } else setLamp(x, y + touchLift(e.pointerType));
  }

  function onMove(e) {
    const [x, y] = local(e);
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === "mouse" && !pointers.size) setLamp(x, y);
      return;
    }
    p.x = x;
    p.y = y;
    if (pointers.size >= 2 && pinch) {
      const [a, b] = [...pointers.values()];
      setHeight(pinch.lz + Math.log((Math.hypot(a.x - b.x, a.y - b.y) || 1) / pinch.dist) * 1.4);
      idleT = 0;
      return;
    }
    setLamp(x, y + touchLift(p.type));
  }

  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
  }

  function onWheel(e) {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.height : 1;
    const dy = clamp(e.deltaY * unit, -240, 240);
    idleT = 0;
    setHeight(lamp.tlz - dy * (e.ctrlKey ? 0.012 : 0.0028));
  }

  function onKey(e) {
    const step = (e.shiftKey ? 8 : 2) * view.pxPerMm;
    let handled = true;
    if (e.key === "ArrowLeft") setLamp(lamp.tx - step, lamp.ty);
    else if (e.key === "ArrowRight") setLamp(lamp.tx + step, lamp.ty);
    else if (e.key === "ArrowUp") setLamp(lamp.tx, lamp.ty - step);
    else if (e.key === "ArrowDown") setLamp(lamp.tx, lamp.ty + step);
    else if (e.key === "+" || e.key === "=") setHeight(lamp.tlz + Math.log(1.25));
    else if (e.key === "-" || e.key === "_") setHeight(lamp.tlz - Math.log(1.25));
    else handled = false;
    if (handled) {
      idleT = 0;
      e.preventDefault();
    }
  }

  function onSlider() {
    lamp.tlz = LOG_MIN + (LOG_MAX - LOG_MIN) * (Number(slider.value) / 1000);
    if (reduced) lamp.lz = lamp.tlz;
    idleT = 0;
    wake();
  }

  function setTag(on) {
    if (!tag || on === tagOn) return;
    tagOn = on;
    tag.dataset.on = on ? "true" : "false";
  }

  function render() {
    if (!gl.has()) return;
    const z = Math.exp(lamp.lz);
    gl.draw({
      scale: view.dpr * quality,
      rects,
      lift,
      lamp: [lamp.x, lamp.y, z * view.pxPerMm, lamp.power],
      bulb: 0.06 + z * 0.004,
      falloff: 120 * view.pxPerMm,
      steps: quality < 1 ? 20 : 34,
    });
    if (tag) {
      const label = `${z < 9.95 ? z.toFixed(1) : Math.round(z)} mm`;
      if (label !== shownHeight) {
        tag.textContent = label;
        shownHeight = label;
      }
      const tx = clamp(lamp.x + 18, 8, view.width - 72);
      const ty = clamp(lamp.y + 18, 8, view.height - 32);
      tag.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0)`;
    }
    if (!sentReady) {
      sentReady = true;
      onReady();
    }
  }

  function step(dt) {
    let moving = false;
    if (introT < INTRO_S) {
      introT = Math.min(INTRO_S, introT + dt);
      moving = true;
    }
    lamp.power = easeOut(introT / INTRO_S);
    idleT += dt;
    if (!reduced && idleT > IDLE_AFTER && !pointers.size) {
      const fade = clamp((idleT - IDLE_AFTER) / 2, 0, 1);
      if (fade < 1 && idleT - dt <= IDLE_AFTER) orbit = Math.atan2((lamp.y - view.cy) / Math.max(1, view.spanY), (lamp.x - view.cx) / Math.max(1, view.spanX));
      orbit += dt * 0.32 * fade;
      const [ox, oy] = orbitPoint(orbit);
      lamp.tx += (ox - lamp.tx) * Math.min(1, dt * 2.4 * fade);
      lamp.ty += (oy - lamp.ty) * Math.min(1, dt * 2.4 * fade);
      moving = true;
    }
    if (reduced) {
      lamp.x = lamp.tx;
      lamp.y = lamp.ty;
      lamp.lz = lamp.tlz;
      return moving;
    }
    const steps = Math.max(1, Math.ceil(dt / SUB));
    const h = dt / steps;
    for (let i = 0; i < steps; i += 1) {
      spring(lamp, "x", "vx", lamp.tx, 14, h);
      spring(lamp, "y", "vy", lamp.ty, 14, h);
      spring(lamp, "lz", "vlz", lamp.tlz, 11, h);
    }
    const far = Math.abs(lamp.x - lamp.tx) + Math.abs(lamp.y - lamp.ty) > 0.05 || Math.abs(lamp.vx) + Math.abs(lamp.vy) > 0.5;
    const rising = Math.abs(lamp.lz - lamp.tlz) > 0.0006 || Math.abs(lamp.vlz) > 0.003;
    setTag(rising);
    if (far || rising) moving = true;
    return moving;
  }

  function frame(now) {
    raf = 0;
    if (!gl || !visible || document.hidden || destroyed) return;
    const raw = last ? now - last : 16;
    const dt = clamp(raw / 1000, 0, 0.05);
    last = now;
    const moving = step(dt) || !gl.has();
    if (moving) {
      interval = interval * 0.8 + raw * 0.2;
      if (interval > 34 && motionQuality > 0.5) {
        motionQuality = Math.max(0.5, motionQuality * 0.85);
        interval = 20;
      }
      if (quality !== motionQuality) applyQuality(motionQuality);
    } else if (quality !== 1) applyQuality(1);
    render();
    if (moving || idleT <= IDLE_AFTER + 0.1) raf = requestAnimationFrame(frame);
    else {
      last = 0;
      setTag(false);
    }
  }

  function wake() {
    if (raf || !gl || !visible || document.hidden || destroyed) return;
    raf = requestAnimationFrame(frame);
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
        last = 0;
      }
    },
    { rootMargin: "120px" },
  );
  io.observe(box);
  const ro = new ResizeObserver(() => resize());
  ro.observe(box);
  const onVisibility = () => {
    if (!document.hidden) {
      last = 0;
      wake();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("wheel", onWheel, { passive: false });
  stage.addEventListener("keydown", onKey);
  slider?.addEventListener("input", onSlider);
  syncSlider();

  return {
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("keydown", onKey);
      slider?.removeEventListener("input", onSlider);
      gl?.destroy();
      gl = null;
    },
  };
}
