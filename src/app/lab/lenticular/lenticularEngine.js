import { CARDS, FRAME_COUNT } from "./lenticularCards";
import { cardLayers } from "./lenticularArt";
import { createLenticularGL } from "./lenticularGL";

const DEG = Math.PI / 180;
const SUB = 1 / 240;
const YAW_MAX = 21 * DEG;
const PITCH_MAX = 13 * DEG;
const GAIN = 1.18;
const FLIP_MS = 760;
const KEY_LIGHT = (() => {
  const v = [-0.45, 0.62, 0.64];
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
})();
const TINT = [0.925, 0.918, 0.902];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const soft = (v, max) => max * Math.tanh(v / max);
const easeIn = (t) => t * t * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function spring(s, key, velKey, target, omega, zeta, h) {
  const x = s[key];
  const v = s[velKey];
  const a = omega * omega * (target - x) - 2 * zeta * omega * v;
  s[velKey] = v + a * h;
  s[key] = x + s[velKey] * h;
}

function rotation(yaw, pitch, roll) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const ry = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
  const rx = [1, 0, 0, 0, cp, sp, 0, -sp, cp];
  const rz = [cr, sr, 0, -sr, cr, 0, 0, 0, 1];
  const mul = (a, b) => {
    const o = new Array(9);
    for (let c = 0; c < 3; c += 1) {
      for (let r = 0; r < 3; r += 1) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
    }
    return o;
  };
  return new Float32Array(mul(mul(ry, rx), rz));
}

export function createLenticularEngine({ box, stage, canvas, insets, embedded, onSelect, onReady, onFail, onMotion }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const view = { width: 1, height: 1, dpr: 1, cx: 0, cy: 0, hh: 100 };
  const tilt = { yaw: 0, pitch: 0, vyaw: 0, vpitch: 0, lift: 0, vlift: 0 };
  const pointer = { mode: null, id: null, type: "mouse", x: 0, y: 0, sx: 0, sy: 0, startYaw: 0, startPitch: 0, px: 0, py: 0, vx: 0, vy: 0, inside: false };
  const hold = { yaw: 0, pitch: 0, until: 0, fresh: false, active: false };
  const orient = { on: false, gamma: 0, beta: 0, baseG: null, baseB: null, fresh: false };
  const images = new Map();
  let active = 0;
  let shown = 0;
  let flip = null;
  let gl = null;
  let failed = false;
  let visible = false;
  let raf = 0;
  let last = 0;
  let clock = 0;
  let idleClock = 0;
  let idleMix = reduced ? 0 : 1;
  let destroyed = false;
  let ready = false;
  let quality = 1;
  let interval = 16;
  let releaseFlick = false;

  function card(idx = shown) {
    return CARDS[idx];
  }

  function aspectOf(idx) {
    return CARDS[idx].aspect;
  }

  function layout() {
    const pad = insets();
    const availW = view.width - 32;
    const availH = Math.max(160, view.height - pad.top - pad.bottom);
    const aspect = aspectOf(shown);
    view.hh = Math.max(60, Math.min(availH * 0.44, (availW * 0.4) / aspect));
    view.cx = view.width / 2;
    view.cy = pad.top + availH / 2;
  }

  function resize() {
    const rect = box.getBoundingClientRect();
    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    const budget = Math.sqrt(2400000 / Math.max(1, rect.width * rect.height));
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    view.dpr = Math.max(0.75, Math.min(dprCap, budget));
    layout();
    applyQuality(quality);
    wake();
  }

  function applyQuality(q) {
    quality = q;
    if (gl) gl.resize(Math.max(1, Math.round(view.width * view.dpr * q)), Math.max(1, Math.round(view.height * view.dpr * q)));
  }

  function loadLayers(idx) {
    const spec = CARDS[idx];
    if (images.has(spec.key)) return images.get(spec.key);
    const promise = cardLayers(spec, gl ? gl.size : 640);
    images.set(spec.key, promise);
    return promise;
  }

  function ensure(idx) {
    const spec = CARDS[idx];
    return loadLayers(idx).then((layers) => {
      if (destroyed || !gl) return false;
      if (!gl.has(spec.key)) {
        gl.evict([CARDS[shown].key, CARDS[active].key, spec.key]);
        gl.build(spec.key, layers);
      }
      return true;
    });
  }

  function init() {
    if (gl || failed) return;
    try {
      gl = createLenticularGL(canvas);
    } catch {
      gl = null;
    }
    if (!gl) {
      failed = true;
      onFail();
      return;
    }
    resize();
    ensure(active)
      .then((ok) => {
        if (!ok) return;
        layout();
        ready = true;
        onReady();
        wake();
        if (!embedded) {
          const later = window.requestIdleCallback || ((fn) => window.setTimeout(fn, 400));
          later(() => CARDS.forEach((_, i) => i !== active && loadLayers(i).catch(() => {})));
        }
      })
      .catch(() => {
        failed = true;
        onFail();
      });
  }

  function select(idx) {
    if (idx === active || idx < 0 || idx >= CARDS.length) return;
    active = idx;
    onSelect(idx);
    if (!gl) return;
    ensure(idx)
      .then(() => {
        if (!ready) {
          shown = active;
          layout();
        }
        wake();
      })
      .catch(() => {});
    wake();
  }

  function local(e) {
    const rect = box.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function positional(x, y) {
    const hw = view.hh * aspectOf(shown);
    const nx = clamp((x - view.cx) / (hw * 1.05), -1.4, 1.4);
    const ny = clamp((y - view.cy) / (view.hh * 1.2), -1.3, 1.3);
    return [soft(nx * 1.15, 1.1) * YAW_MAX, soft(-ny, 1) * PITCH_MAX];
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (pointer.mode === "drag") return;
    const [x, y] = local(e);
    stage.setPointerCapture?.(e.pointerId);
    pointer.mode = "drag";
    pointer.id = e.pointerId;
    pointer.type = e.pointerType;
    pointer.x = pointer.sx = pointer.px = x;
    pointer.y = pointer.sy = pointer.py = y;
    pointer.vx = pointer.vy = 0;
    pointer.startYaw = tilt.yaw;
    pointer.startPitch = tilt.pitch;
    hold.active = false;
    wake();
  }

  function onMove(e) {
    const [x, y] = local(e);
    if (pointer.mode === "drag") {
      if (e.pointerId !== pointer.id) return;
      pointer.x = x;
      pointer.y = y;
      wake();
      return;
    }
    if (e.pointerType === "touch") return;
    pointer.inside = true;
    pointer.mode = "hover";
    pointer.type = e.pointerType;
    pointer.x = x;
    pointer.y = y;
    hold.active = false;
    wake();
  }

  function onCard(x, y) {
    const hw = view.hh * aspectOf(shown);
    return Math.abs(x - view.cx) <= hw && Math.abs(y - view.cy) <= view.hh;
  }

  function onUp(e) {
    if (pointer.mode !== "drag" || e.pointerId !== pointer.id) return;
    const touch = pointer.type !== "mouse";
    const [ux, uy] = local(e);
    if (e.type === "pointerup" && Math.hypot(ux - pointer.sx, uy - pointer.sy) < 6 && onCard(ux, uy) && !flip) {
      select((active + 1) % CARDS.length);
    }
    pointer.id = null;
    if (touch || e.type === "pointercancel") {
      pointer.mode = null;
      releaseFlick = true;
    } else {
      pointer.mode = pointer.inside ? "hover" : null;
    }
    wake();
  }

  function onLeave(e) {
    if (e.pointerType === "touch") return;
    pointer.inside = false;
    if (pointer.mode === "hover") pointer.mode = null;
    wake();
  }

  function frameStep() {
    return Math.atan(1 / (FRAME_COUNT * GAIN));
  }

  function onKey(e) {
    let handled = true;
    const base = hold.active ? hold : { yaw: tilt.yaw, pitch: tilt.pitch };
    if (e.key === "ArrowLeft") setHold(base.yaw - frameStep(), base.pitch);
    else if (e.key === "ArrowRight") setHold(base.yaw + frameStep(), base.pitch);
    else if (e.key === "ArrowUp") setHold(base.yaw, base.pitch + 4 * DEG);
    else if (e.key === "ArrowDown") setHold(base.yaw, base.pitch - 4 * DEG);
    else if (e.key === "Home" || e.key === "0") setHold(0, 0);
    else if (/^[1-4]$/.test(e.key)) select(Number(e.key) - 1);
    else if (e.key === "Enter" || e.key === " ") select((active + 1) % CARDS.length);
    else if (e.key === "]") select((active + 1) % CARDS.length);
    else if (e.key === "[") select((active + CARDS.length - 1) % CARDS.length);
    else handled = false;
    if (handled) e.preventDefault();
  }

  function setHold(yaw, pitch) {
    hold.yaw = clamp(yaw, -YAW_MAX * 1.15, YAW_MAX * 1.15);
    hold.pitch = clamp(pitch, -PITCH_MAX, PITCH_MAX);
    hold.active = true;
    hold.fresh = true;
    if (pointer.mode === "hover") pointer.mode = null;
    wake();
  }

  function onOrientation(e) {
    if (e.gamma == null || e.beta == null) return;
    orient.gamma = e.gamma;
    orient.beta = e.beta;
    if (orient.baseG == null) {
      orient.baseG = e.gamma;
      orient.baseB = e.beta;
    }
    if (!orient.on) {
      orient.on = true;
      onMotion?.("on");
    }
    orient.fresh = true;
    wake();
  }

  function enableMotion() {
    const Ctor = window.DeviceOrientationEvent;
    if (!Ctor) return Promise.resolve(false);
    const attach = () => {
      window.addEventListener("deviceorientation", onOrientation);
      return true;
    };
    if (typeof Ctor.requestPermission === "function") {
      return Ctor.requestPermission()
        .then((state) => (state === "granted" ? attach() : false))
        .catch(() => false);
    }
    return Promise.resolve(attach());
  }

  function target(dt, now) {
    if (pointer.mode === "drag") {
      if (pointer.type === "mouse") {
        const [yaw, pitch] = positional(pointer.x, pointer.y);
        return [yaw, pitch, false];
      }
      const scale = 1 / Math.max(80, view.hh * aspectOf(shown) * 1.6);
      const yaw = pointer.startYaw + (pointer.x - pointer.sx) * scale * YAW_MAX * 1.4;
      const pitch = pointer.startPitch - (pointer.y - pointer.sy) * scale * PITCH_MAX * 1.4;
      return [soft(yaw, YAW_MAX * 1.2), soft(pitch, PITCH_MAX * 1.1), false];
    }
    if (pointer.mode === "hover") {
      const [yaw, pitch] = positional(pointer.x, pointer.y);
      return [yaw, pitch, false];
    }
    if (orient.on) {
      const k = 1 - Math.exp(-dt / 5);
      orient.baseG += (orient.gamma - orient.baseG) * k;
      orient.baseB += (orient.beta - orient.baseB) * k;
      const yaw = soft((orient.gamma - orient.baseG) * 1.3 * DEG, YAW_MAX * 1.1);
      const pitch = soft(-(orient.beta - orient.baseB) * 0.7 * DEG, PITCH_MAX);
      return [yaw, pitch, false];
    }
    if (hold.active) {
      if (hold.fresh) {
        hold.until = now + (reduced ? 1e9 : 4200);
        hold.fresh = false;
      }
      if (now < hold.until) return [hold.yaw, hold.pitch, false];
      hold.active = false;
    }
    return [0, 0, true];
  }

  function swayAt(t) {
    const p = (t * Math.PI * 2) / 7.6;
    const dwell = p - 0.34 * Math.sin(2 * p);
    const yaw = 13 * DEG * Math.sin(dwell) + 1.2 * DEG * Math.sin((t * Math.PI * 2) / 3.1 + 1.1);
    const pitch = 4.5 * DEG * Math.sin((t * Math.PI * 2) / 9.4 + 0.6) + 1.2 * DEG * Math.sin((t * Math.PI * 2) / 4.3);
    return [yaw, pitch];
  }

  function step(dt, now) {
    if (pointer.mode === "drag") {
      const ivx = (pointer.x - pointer.px) / Math.max(dt, 1e-3);
      const ivy = (pointer.y - pointer.py) / Math.max(dt, 1e-3);
      const k = 1 - Math.exp(-dt / 0.05);
      pointer.vx += (ivx - pointer.vx) * k;
      pointer.vy += (ivy - pointer.vy) * k;
      pointer.px = pointer.x;
      pointer.py = pointer.y;
    }
    if (releaseFlick) {
      releaseFlick = false;
      const scale = 1 / Math.max(80, view.hh * aspectOf(shown) * 1.6);
      const flickYaw = clamp(pointer.vx * scale * YAW_MAX * 1.4, -4, 4);
      const flickPitch = clamp(-pointer.vy * scale * PITCH_MAX * 1.4, -3, 3);
      tilt.vyaw = tilt.vyaw * 0.5 + flickYaw * 0.5;
      tilt.vpitch = tilt.vpitch * 0.5 + flickPitch * 0.5;
      hold.yaw = clamp(tilt.yaw + flickYaw * 0.12, -YAW_MAX * 1.15, YAW_MAX * 1.15);
      hold.pitch = clamp(tilt.pitch + flickPitch * 0.12, -PITCH_MAX, PITCH_MAX);
      hold.active = true;
      hold.fresh = true;
    }
    const [ty, tp, idle] = target(dt, now);
    let goalYaw = ty;
    let goalPitch = tp;
    if (idle && !reduced) {
      idleMix = Math.min(1, idleMix + dt / 1.6);
      idleClock += dt;
    } else {
      idleMix = Math.max(0, idleMix - dt / 0.25);
    }
    if (!reduced && idleMix > 0) {
      const [sy, sp] = swayAt(idleClock);
      const m = idleMix * idleMix * (3 - 2 * idleMix);
      goalYaw += sy * m;
      goalPitch += sp * m;
    }
    const liftGoal = pointer.mode === "drag" ? 1 : 0;
    if (reduced) {
      tilt.yaw = goalYaw;
      tilt.pitch = goalPitch;
      tilt.lift = liftGoal;
      tilt.vyaw = tilt.vpitch = tilt.vlift = 0;
    } else {
      const dragging = pointer.mode === "drag";
      const omega = dragging ? 20 : idle ? 7 : 12;
      const zeta = dragging ? 0.9 : 0.82;
      const steps = Math.max(1, Math.ceil(dt / SUB));
      const h = dt / steps;
      for (let i = 0; i < steps; i += 1) {
        spring(tilt, "yaw", "vyaw", goalYaw, omega, zeta, h);
        spring(tilt, "pitch", "vpitch", goalPitch, omega, zeta, h);
        spring(tilt, "lift", "vlift", liftGoal, 16, 0.9, h);
      }
      const cap = 3.2;
      tilt.vyaw = clamp(tilt.vyaw, -cap, cap);
      tilt.vpitch = clamp(tilt.vpitch, -cap, cap);
    }
    let flipYaw = 0;
    let flipLift = 0;
    if (!flip && shown !== active && gl && gl.has(CARDS[active].key)) {
      if (reduced) {
        shown = active;
        layout();
      } else {
        flip = { t: 0, swapped: false };
      }
    }
    if (flip) {
      const canSwap = gl && gl.has(CARDS[active].key);
      const next = flip.t + (dt * 1000) / FLIP_MS;
      flip.t = !flip.swapped && !canSwap ? Math.min(next, 0.5) : next;
      if (!flip.swapped && flip.t >= 0.5 && canSwap) {
        flip.swapped = true;
        shown = active;
        layout();
      }
      const t = flip.t;
      flipYaw = t < 0.5 ? easeIn(t * 2) * 90 * DEG : -(1 - easeOut((t - 0.5) * 2)) * 90 * DEG;
      flipLift = Math.sin(Math.min(t, 1) * Math.PI);
      if (flip.t >= 1) flip = null;
    }
    const settled =
      Math.abs(tilt.yaw - goalYaw) < 0.0004 &&
      Math.abs(tilt.pitch - goalPitch) < 0.0004 &&
      Math.abs(tilt.vyaw) + Math.abs(tilt.vpitch) < 0.002 &&
      Math.abs(tilt.lift - liftGoal) < 0.002 &&
      Math.abs(tilt.vlift) < 0.01;
    return { flipYaw, flipLift, settled, idle };
  }

  function render(state) {
    const spec = card();
    const dir = spec.dir || 1;
    const aspect = aspectOf(shown);
    const hh = view.hh * (1 + tilt.lift * 0.015 + state.flipLift * 0.04);
    const hw = hh * aspect;
    const yaw = tilt.yaw + state.flipYaw;
    const rot = rotation(yaw, tilt.pitch, -tilt.yaw * 0.06);
    gl.draw({
      key: spec.key,
      dpr: view.dpr * quality,
      cx: view.cx,
      cy: view.cy,
      hw,
      hh,
      rot,
      lift: tilt.lift * view.hh * 0.06 + state.flipLift * view.hh * 0.18,
      dist: Math.max(view.width, view.height) * 1.7 + 400,
      ground: view.hh * 0.14,
      ridges: clamp(Math.round((2 * hw) / 3.6), 40, 120),
      gain: GAIN * dir,
      radius: hw * 0.06,
      thick: Math.max(1.2, hh * 0.008),
      key3: KEY_LIGHT,
      seed: CARDS.indexOf(spec) * 3.1 + 0.7,
      tint: TINT,
    });
  }

  function frame(now) {
    raf = 0;
    if (!gl || !visible || document.hidden || destroyed) return;
    const raw = last > 0 ? now - last : 16.7;
    const dt = clamp(raw / 1000, 0, 0.05);
    last = now;
    clock += dt;
    if (!ready) return;
    const state = step(dt, clock * 1000);
    interval = interval * 0.8 + raw * 0.2;
    if (interval > 30 && quality > 0.6) {
      applyQuality(Math.max(0.6, quality * 0.85));
      interval = 18;
    }
    render(state);
    const ambient = !reduced && state.idle;
    if (!state.settled || flip || ambient || pointer.mode === "drag" || orient.on) raf = requestAnimationFrame(frame);
    else if (quality !== 1) {
      applyQuality(1);
      render(state);
    }
  }

  function wake() {
    if (raf || !gl || !visible || document.hidden || destroyed) return;
    last = 0;
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
      }
    },
    { rootMargin: "80px" },
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
    select: (idx) => select(idx),
    motionAvailable: () => coarse && typeof window.DeviceOrientationEvent !== "undefined",
    enableMotion,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("deviceorientation", onOrientation);
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
