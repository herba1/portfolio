import { buildAtlas } from "./bustGlyphs";
import { createBustGL } from "./bustGL";

const HOME_YAW = -0.44;
const INTRO_YAW = -1.32;
const ROWS = 74;
const FRICTION = 1.55;
const DRAG_FRICTION = 0.22;
const MAX_SPIN = 7;
const PAPER = [244 / 255, 240 / 255, 231 / 255];
const INK = [27 / 255, 24 / 255, 21 / 255];
const DEFAULT_LIGHT = [-0.8, 0.7, 0.95];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function coast(v, h) {
  const nv = v * Math.exp(-FRICTION * h);
  const cut = Math.max(0, Math.abs(nv) - DRAG_FRICTION * h);
  return Math.sign(nv) * cut;
}

function launchFor(distance) {
  let lo = 0;
  let hi = 20;
  for (let k = 0; k < 40; k += 1) {
    const mid = (lo + hi) / 2;
    let v = mid;
    let x = 0;
    for (let i = 0; i < 2400 && v > 1e-4; i += 1) {
      x += v / 240;
      v = coast(v, 1 / 240);
    }
    if (x < distance) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function poseName(deg) {
  const a = Math.abs(deg);
  if (a < 10) return "Front";
  if (a < 62) return "Three-quarter";
  if (a < 118) return "Profile";
  if (a < 166) return "Over the shoulder";
  return "Back";
}

export function createBustEngine({ box, stage, canvas, status, insets, embedded, onReady, onFail }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const view = { width: 1, height: 1, dpr: 1, cx: 0, cy: 0, scale: 100, cell: [5, 10], origin: [0, 0] };
  let gl = null;
  let failed = false;
  let loaded = false;
  let visible = false;
  let destroyed = false;
  let raf = 0;
  let last = 0;
  let yaw = reduced ? HOME_YAW : INTRO_YAW;
  let yawVel = 0;
  let spring = 0;
  let drag = null;
  let pointer = null;
  let light = DEFAULT_LIGHT.slice();
  let lightGoal = DEFAULT_LIGHT.slice();
  let drawnYaw = NaN;
  let drawnLight = [0, 0, 0];
  let tail = 0;
  let shown = "";
  let pendingIntro = !reduced;
  let pace = 16;
  let skip = false;
  let stale = false;

  function layout() {
    const pad = insets();
    const availH = Math.max(120, view.height - pad.top - pad.bottom);
    const availW = Math.max(120, view.width - 32);
    view.scale = Math.max(40, Math.min(availH / 1.98, availW / 1.14));
    view.cx = view.width / 2;
    view.cy = pad.top + availH / 2;
    const ch = clamp((1.9 * view.scale) / ROWS, 7, 14);
    const cw = ch * 0.5;
    const cols = Math.ceil(view.width / cw) + 1;
    const rows = Math.ceil(view.height / ch) + 1;
    view.cell = [cw, ch];
    view.origin = [(view.width - cols * cw) / 2, (view.height - rows * ch) / 2];
    if (gl) gl.setGrid(cols, rows);
    drawnYaw = NaN;
  }

  function resize() {
    const rect = box.getBoundingClientRect();
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (gl) gl.resize(Math.max(1, Math.round(view.width * view.dpr)), Math.max(1, Math.round(view.height * view.dpr)));
    layout();
    if (loaded) {
      render(0, true);
      wake();
    }
  }

  function aimLight(x, y) {
    const k = view.scale * 1.15;
    const dx = clamp((x - view.cx) / k, -1.4, 1.4);
    const dy = clamp((view.cy - y) / k, -1.1, 1.3);
    lightGoal = [dx * 1.25, dy * 0.95 + 0.3, 0.95];
  }

  function writeStatus() {
    if (!status) return;
    let deg = ((yaw * 180) / Math.PI) % 360;
    if (deg > 180) deg -= 360;
    if (deg <= -180) deg += 360;
    const r = Math.round(deg);
    const text = `${poseName(r)}, ${Math.abs(r)}°`;
    if (text !== shown) {
      status.textContent = text;
      box.style.setProperty("--ascii-bust-yaw", `${r}deg`);
      shown = text;
    }
  }

  function bounds() {
    const s = view.scale;
    return [view.cx - 1.0 * s, view.cy - 1.08 * s, view.cx + 1.0 * s, view.cy + 1.12 * s];
  }

  function render(dt, instant) {
    const changed = Math.abs(yaw - drawnYaw) > 1e-5 || Number.isNaN(drawnYaw) || light.some((v, i) => Math.abs(v - drawnLight[i]) > 1e-4);
    let moved = changed || stale;
    if (moved && !instant && !Number.isNaN(drawnYaw) && pace > 24) {
      skip = !skip;
      if (skip) {
        moved = false;
        stale = true;
      }
    }
    if (moved) stale = false;
    gl.draw({
      scene: moved,
      bounds: bounds(),
      dt,
      instant,
      fade: 7.5,
      contrast: 1.1,
      origin: view.origin,
      cell: view.cell,
      cx: view.cx,
      cy: view.cy,
      scale: view.scale,
      yaw,
      light,
      dpr: view.dpr,
      paper: PAPER,
      ink: INK,
    });
    if (moved) {
      drawnYaw = yaw;
      drawnLight = light.slice();
      tail = 0.45;
    } else if (stale) tail = Math.max(tail, 0.1);
    writeStatus();
  }

  function step(dt) {
    if (drag) {
      if (drag.x != null) {
        const goal = drag.yaw0 + (drag.x - drag.x0) * (1.55 / view.scale);
        if (dt > 0 && drag.prevGoal != null) {
          const v = (goal - drag.prevGoal) / dt;
          const k = 1 - Math.exp(-dt / 0.05);
          drag.vel += (v - drag.vel) * k;
        }
        drag.prevGoal = goal;
        drag.goal = goal;
      }
      if (reduced) {
        yaw = drag.goal;
        spring = 0;
      } else {
        const omega = 24;
        const sub = Math.max(1, Math.ceil(dt * 240));
        const h = dt / sub;
        for (let i = 0; i < sub; i += 1) {
          const acc = omega * omega * (drag.goal - yaw) - 2 * omega * spring;
          spring += acc * h;
          yaw += spring * h;
        }
      }
    } else if (yawVel !== 0) {
      const sub = Math.max(1, Math.ceil(dt * 240));
      const h = dt / sub;
      for (let i = 0; i < sub; i += 1) {
        yaw += yawVel * h;
        yawVel = coast(yawVel, h);
      }
      if (Math.abs(yawVel) < 1e-3) yawVel = 0;
    }
    const lk = reduced ? 1 : 1 - Math.exp(-dt * 4.2);
    for (let i = 0; i < 3; i += 1) light[i] += (lightGoal[i] - light[i]) * lk;
  }

  function busy() {
    if (drag || yawVel !== 0 || tail > 0) return true;
    return light.some((v, i) => Math.abs(v - lightGoal[i]) > 2e-3);
  }

  function frame(now) {
    raf = 0;
    if (!gl || !loaded || !visible || document.hidden || destroyed) return;
    const raw = last ? now - last : 16.7;
    const dt = clamp(raw / 1000, 0, 0.05);
    last = now;
    pace = pace * 0.85 + Math.min(raw, 80) * 0.15;
    step(dt);
    render(dt, false);
    tail = Math.max(0, tail - dt);
    if (busy()) raf = requestAnimationFrame(frame);
    else last = 0;
  }

  function wake() {
    if (raf || !gl || !loaded || !visible || document.hidden || destroyed) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  async function init() {
    if (gl || failed) return;
    try {
      gl = createBustGL(canvas);
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
    try {
      const [image, atlas] = await Promise.all([loadImage("/cast/john.webp"), buildAtlas()]);
      if (destroyed || !gl) return;
      gl.setPhoto(image);
      gl.setAtlas(atlas.canvas, atlas.glyph, atlas.mean);
    } catch (error) {
      console.error(error);
      failed = true;
      onFail();
      return;
    }
    loaded = true;
    render(0, true);
    onReady();
    if (pendingIntro) {
      pendingIntro = false;
      yawVel = launchFor(HOME_YAW - INTRO_YAW);
    }
    wake();
  }

  function local(e) {
    const rect = box.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!loaded || drag) return;
    const [x, y] = local(e);
    stage.setPointerCapture?.(e.pointerId);
    pendingIntro = false;
    drag = { id: e.pointerId, type: e.pointerType, x0: x, x, yaw0: yaw, goal: yaw, prevGoal: null, vel: yawVel };
    spring = yawVel;
    yawVel = 0;
    pointer = [x, y];
    aimLight(x, y);
    box.dataset.grabbing = "";
    wake();
  }

  function onMove(e) {
    const [x, y] = local(e);
    if (drag && e.pointerId === drag.id) {
      drag.x = x;
      pointer = [x, y];
      aimLight(x, y);
      wake();
      return;
    }
    if (drag || e.pointerType !== "mouse") return;
    pointer = [x, y];
    aimLight(x, y);
    wake();
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const v = reduced ? 0 : clamp(drag.vel, -MAX_SPIN, MAX_SPIN);
    yawVel = Math.abs(v) < 0.02 ? 0 : v;
    if (!reduced && yawVel === 0 && Math.abs(spring) > 0.02) yawVel = clamp(spring, -MAX_SPIN, MAX_SPIN) * 0.5;
    const wasTouch = drag.type !== "mouse";
    drag = null;
    delete box.dataset.grabbing;
    if (wasTouch) lightGoal = DEFAULT_LIGHT.slice();
    wake();
  }

  function onLeave(e) {
    if (drag || e.pointerType !== "mouse") return;
    pointer = null;
    lightGoal = DEFAULT_LIGHT.slice();
    wake();
  }

  function onKey(e) {
    if (!loaded) return;
    let handled = true;
    const dir = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (dir) {
      if (reduced) yaw += dir * (e.shiftKey ? 0.8 : 0.26);
      else yawVel = clamp(yawVel + dir * (e.shiftKey ? 4 : 1.6), -MAX_SPIN, MAX_SPIN);
    } else if (e.key === "Home" || e.key === "Enter") {
      const turns = Math.round((yaw - HOME_YAW) / (Math.PI * 2));
      const goal = HOME_YAW + turns * Math.PI * 2;
      if (reduced) yaw = goal;
      else yawVel = Math.sign(goal - yaw) * launchFor(Math.abs(goal - yaw));
    } else handled = false;
    if (handled) {
      e.preventDefault();
      wake();
    }
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
    embedded,
    pointer: () => pointer,
  };
}
