import { FOILS } from "./refractorCards";
import { createRefractorGL } from "./refractorGL";
import { prepareCard } from "./refractorPrep";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const SUB = 1 / 240;
const YAW_MAX = 17 * DEG;
const PITCH_MAX = 12 * DEG;
const SPIN_CAP = 11;
const FOIL_MS = 640;
const TINT = [0.925, 0.918, 0.902];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const soft = (v, max) => max * Math.tanh(v / max);
const smooth01 = (t) => t * t * (3 - 2 * t);

function spring(s, key, velKey, target, omega, zeta, h) {
  const a = omega * omega * (target - s[key]) - 2 * zeta * omega * s[velKey];
  s[velKey] += a * h;
  s[key] += s[velKey] * h;
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
    for (let col = 0; col < 3; col += 1) {
      for (let r = 0; r < 3; r += 1) o[col * 3 + r] = a[r] * b[col * 3] + a[3 + r] * b[col * 3 + 1] + a[6 + r] * b[col * 3 + 2];
    }
    return o;
  };
  return new Float32Array(mul(mul(ry, rx), rz));
}

export function createRefractorEngine({ box, stage, canvas, insets, embedded, cards: initialCards, onSelect, onRiffle, onFoil, onReady, onFail, onMotion }) {
  let CARDS = initialCards;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const view = { width: 1, height: 1, dpr: 1, cx: 0, cy: 0, hh: 100 };
  const body = { yaw: 0, pitch: 0, vyaw: 0, vpitch: 0, lift: 0, vlift: 0 };
  const pointer = { mode: null, id: null, type: "mouse", x: 0, y: 0, sx: 0, sy: 0, px: 0, py: 0, vx: 0, vy: 0, inside: false, yaw0: 0, pitch0: 0, trail: [] };
  const hold = { yaw: 0, pitch: 0, until: 0, fresh: false, active: false };
  const orient = { on: false, gamma: 0, beta: 0, baseG: null, baseB: null };
  const foil = { from: 0, to: 0, t: 1 };
  const images = new Map();
  const preps = new Map();
  let home = 0;
  let coast = null;
  let release = false;
  let active = 0;
  let shown = 0;
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
  let lastFront = true;
  let riffle = null;

  function aspectOf(idx) {
    return preps.get(CARDS[idx].key)?.aspect || 660 / 1200;
  }

  function layout() {
    const pad = insets();
    const availW = view.width - 32;
    const availH = Math.max(160, view.height - pad.top - pad.bottom);
    const aspect = aspectOf(shown);
    view.hh = Math.max(60, Math.min(availH * 0.43, (availW * 0.42) / aspect));
    view.cx = view.width / 2;
    view.cy = pad.top + availH / 2;
  }

  function applyQuality(q) {
    quality = q;
    if (gl) gl.resize(Math.max(1, Math.round(view.width * view.dpr * q)), Math.max(1, Math.round(view.height * view.dpr * q)));
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
    wake();
  }

  function loadImage(spec) {
    if (images.has(spec.key)) return images.get(spec.key);
    const promise = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      if (spec.remote) img.crossOrigin = "anonymous";
      img.src = spec.src;
      img
        .decode()
        .then(() => resolve(img))
        .catch(reject);
    });
    images.set(spec.key, promise);
    return promise;
  }

  function ensure(idx) {
    return ensureSpec(CARDS[idx]);
  }

  function ensureSpec(spec) {
    return loadImage(spec).then((img) => {
      if (destroyed || !gl) return false;
      if (!preps.has(spec.key)) preps.set(spec.key, prepareCard(spec, img, box));
      if (!gl.has(spec.key)) gl.build(spec.key, preps.get(spec.key).front, preps.get(spec.key));
      return true;
    });
  }

  function init() {
    if (gl || failed) return;
    try {
      gl = createRefractorGL(canvas);
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
          const later = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 900 }) : window.setTimeout(fn, 300));
          const warm = (i) => {
            if (destroyed || i >= CARDS.length) return;
            const next = () => later(() => warm(i + 1));
            if (i === active) next();
            else ensure(i).then(next, next);
          };
          later(() => warm(0));
        }
      })
      .catch(() => {
        failed = true;
        onFail();
      });
  }

  function coastTo(target, velocity) {
    const from = body.yaw;
    const dist = target - from;
    const speed = Math.max(Math.abs(velocity), 1);
    const span = clamp((3 * Math.abs(dist)) / speed, 0.7, 1.6);
    const power = clamp((speed * span) / Math.max(Math.abs(dist), 1e-3), 1.6, 4);
    return { from, dist, span, power, t: 0 };
  }

  function spinBy(turns, speed) {
    const dirn = Math.sign(turns) || 1;
    let target = Math.round(body.yaw / TAU) * TAU + turns * TAU;
    if ((target - body.yaw) * dirn < Math.PI * 0.6) target += TAU * dirn;
    while ((target - body.yaw) * dirn > TAU * 1.6) target -= TAU * dirn;
    const v = Math.max(Math.abs(body.vyaw), speed) * dirn;
    coast = coastTo(target, v);
    home = target;
    hold.active = false;
  }

  function setCards(list) {
    if (!list.length || list.map((c) => c.key).join() === CARDS.map((c) => c.key).join()) return;
    if (!gl) {
      CARDS = list;
      active = shown = 0;
      onSelect(0);
      return;
    }
    ensureSpec(list[0])
      .then((ok) => {
        if (!ok) return;
        const keep = list.map((c) => c.key);
        CARDS = list;
        active = shown = 0;
        riffle = null;
        gl.evict(keep);
        onSelect(0);
        layout();
        wake();
        list.slice(1).forEach((spec) => ensureSpec(spec).catch(() => {}));
      })
      .catch(() => {});
  }

  function select(idx, dirn = 1) {
    if (idx === active || idx < 0 || idx >= CARDS.length) return;
    active = idx;
    onSelect(idx);
    if (!gl) return;
    ensure(idx)
      .then(() => {
        if (!ready || reduced) {
          shown = active;
          layout();
        }
        wake();
      })
      .catch(() => {});
    if (!reduced && ready) spinBy(dirn, 7.5);
    wake();
  }

  function setFoil(idx) {
    if (idx < 0 || idx >= FOILS.length) return;
    if (idx === foil.to) return;
    const current = foil.t < 0.5 ? foil.from : foil.to;
    foil.from = current;
    foil.to = idx;
    foil.t = reduced ? 1 : 0;
    onFoil(idx);
    wake();
  }

  function local(e) {
    const rect = box.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function positional(x, y) {
    const hw = view.hh * aspectOf(shown);
    const nx = clamp((x - view.cx) / (hw * 1.15), -1.5, 1.5);
    const ny = clamp((y - view.cy) / (view.hh * 1.15), -1.4, 1.4);
    return [soft(nx * 1.1, 1.1) * YAW_MAX, soft(-ny, 1) * PITCH_MAX];
  }

  function dragScale() {
    return Math.PI / Math.max(120, view.hh * aspectOf(shown) * 2.8);
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
    pointer.trail = [{ x, y, t: e.timeStamp }];
    pointer.yaw0 = body.yaw;
    pointer.pitch0 = body.pitch;
    coast = null;
    riffle = null;
    hold.active = false;
    wake();
  }

  function onMove(e) {
    const [x, y] = local(e);
    if (pointer.mode === "drag") {
      if (e.pointerId !== pointer.id) return;
      pointer.x = x;
      pointer.y = y;
      pointer.trail.push({ x, y, t: e.timeStamp });
      if (pointer.trail.length > 12) pointer.trail.shift();
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

  function onUp(e) {
    if (pointer.mode !== "drag" || e.pointerId !== pointer.id) return;
    const recent = pointer.trail.filter((p) => e.timeStamp - p.t < 90);
    const all = pointer.trail;
    const trail = recent.length > 1 ? recent : all.length > 1 && all[all.length - 1].t - all[all.length - 2].t < 600 && e.timeStamp - all[all.length - 1].t < 90 ? all.slice(-2) : recent;
    if (trail.length > 1) {
      const a = trail[0];
      const b = trail[trail.length - 1];
      const span = Math.max(0.016, (b.t - a.t) / 1000);
      pointer.vx = (b.x - a.x) / span;
      pointer.vy = (b.y - a.y) / span;
    } else if (e.timeStamp - pointer.trail[pointer.trail.length - 1].t > 90) {
      pointer.vx = pointer.vy = 0;
    }
    pointer.id = null;
    pointer.mode = pointer.type === "mouse" && pointer.inside && e.type !== "pointercancel" ? "hover" : null;
    release = true;
    wake();
  }

  function onLeave(e) {
    if (e.pointerType === "touch") return;
    pointer.inside = false;
    if (pointer.mode === "hover") pointer.mode = null;
    wake();
  }

  function setHold(yaw, pitch) {
    hold.yaw = clamp(yaw, -YAW_MAX * 1.3, YAW_MAX * 1.3);
    hold.pitch = clamp(pitch, -PITCH_MAX * 1.2, PITCH_MAX * 1.2);
    hold.active = true;
    hold.fresh = true;
    if (pointer.mode === "hover") pointer.mode = null;
    wake();
  }

  function onKey(e) {
    let handled = true;
    const base = hold.active ? hold : { yaw: body.yaw - home, pitch: body.pitch };
    if (e.key === "ArrowLeft") setHold(base.yaw - 5 * DEG, base.pitch);
    else if (e.key === "ArrowRight") setHold(base.yaw + 5 * DEG, base.pitch);
    else if (e.key === "ArrowUp") setHold(base.yaw, base.pitch + 4 * DEG);
    else if (e.key === "ArrowDown") setHold(base.yaw, base.pitch - 4 * DEG);
    else if (e.key === "Home" || e.key === "0") setHold(0, 0);
    else if (e.key === " " || e.key === "Enter") {
      const dirn = e.shiftKey ? -1 : 1;
      select((active + dirn + CARDS.length) % CARDS.length, dirn);
      wake();
    } else if (/^[1-3]$/.test(e.key)) setFoil(Number(e.key) - 1);
    else if (e.key === "]") select((active + 1) % CARDS.length);
    else if (e.key === "[") select((active + CARDS.length - 1) % CARDS.length, -1);
    else handled = false;
    if (handled) e.preventDefault();
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

  function offsetTarget(dt, now) {
    if (pointer.mode === "hover") {
      const [yaw, pitch] = positional(pointer.x, pointer.y);
      return [yaw, pitch, false];
    }
    if (orient.on) {
      const k = 1 - Math.exp(-dt / 5);
      orient.baseG += (orient.gamma - orient.baseG) * k;
      orient.baseB += (orient.beta - orient.baseB) * k;
      const yaw = soft((orient.gamma - orient.baseG) * 1.2 * DEG, YAW_MAX * 1.2);
      const pitch = soft(-(orient.beta - orient.baseB) * 0.8 * DEG, PITCH_MAX * 1.1);
      return [yaw, pitch, false];
    }
    if (hold.active) {
      if (hold.fresh) {
        hold.until = now + (reduced ? 1e9 : 4500);
        hold.fresh = false;
      }
      if (now < hold.until) return [hold.yaw, hold.pitch, false];
      hold.active = false;
    }
    return [0, 0, true];
  }

  function swayAt(t) {
    const p = (t * TAU) / 9.2;
    const dwell = p - 0.3 * Math.sin(2 * p);
    const yaw = 10 * DEG * Math.sin(dwell) + 1.4 * DEG * Math.sin((t * TAU) / 3.7 + 1.1);
    const pitch = 5.5 * DEG * Math.sin((t * TAU) / 11.3 + 0.6) + 1.3 * DEG * Math.sin((t * TAU) / 4.9);
    return [yaw, pitch];
  }

  function step(dt, now) {
    const dragging = pointer.mode === "drag";
    if (dragging) {
      const ivx = (pointer.x - pointer.px) / Math.max(dt, 1e-3);
      const ivy = (pointer.y - pointer.py) / Math.max(dt, 1e-3);
      const k = 1 - Math.exp(-dt / 0.045);
      pointer.vx += (ivx - pointer.vx) * k;
      pointer.vy += (ivy - pointer.vy) * k;
      pointer.px = pointer.x;
      pointer.py = pointer.y;
    }
    if (release) {
      release = false;
      const flick = clamp(pointer.vx * dragScale(), -SPIN_CAP, SPIN_CAP);
      const v = Math.abs(flick) > Math.abs(body.vyaw) ? flick * 0.7 + body.vyaw * 0.3 : body.vyaw;
      body.vyaw = clamp(v, -SPIN_CAP, SPIN_CAP);
      if (Math.abs(body.vyaw) > 2.4 && !reduced) {
        const natural = body.yaw + body.vyaw * 0.85;
        let target = Math.round(natural / TAU) * TAU;
        const dirn = Math.sign(body.vyaw);
        while ((target - body.yaw) / body.vyaw < 0.4) target += TAU * dirn;
        while ((target - body.yaw) / body.vyaw > 1.9 && (target - TAU * dirn - body.yaw) / body.vyaw >= 0.4) target -= TAU * dirn;
        coast = coastTo(target, body.vyaw);
        home = target;
        const turns = clamp(Math.round(Math.abs(target - body.yaw) / TAU), 1, CARDS.length - 1);
        riffle = { dir: dirn, left: turns };
        for (let k = 1; k <= turns; k += 1) ensure((((shown + dirn * k) % CARDS.length) + CARDS.length) % CARDS.length).catch(() => {});
      } else {
        home = Math.round(body.yaw / TAU) * TAU;
      }
      body.vpitch = clamp(body.vpitch - pointer.vy * dragScale() * 0.25, -3, 3);
    }
    const [oy, op, idle] = offsetTarget(dt, now);
    const ambient = idle && !dragging && !coast && !reduced;
    if (ambient) {
      idleMix = Math.min(1, idleMix + dt / 1.8);
      idleClock += dt;
    } else {
      idleMix = Math.max(0, idleMix - dt / 0.3);
    }
    let goalYaw = home + oy;
    let goalPitch = op;
    if (!reduced && idleMix > 0) {
      const [sy, sp] = swayAt(idleClock);
      const m = smooth01(idleMix);
      goalYaw += sy * m;
      goalPitch += sp * m;
    }
    if (dragging) {
      const s = dragScale();
      goalYaw = pointer.yaw0 + (pointer.x - pointer.sx) * s;
      goalPitch = soft(pointer.pitch0 - (pointer.y - pointer.sy) * s * 0.55, 32 * DEG);
    }
    const liftGoal = dragging ? 1 : coast ? 0.6 : 0;
    if (reduced && !dragging) {
      body.yaw = goalYaw;
      body.pitch = goalPitch;
      body.lift = liftGoal;
      body.vyaw = body.vpitch = body.vlift = 0;
    } else {
      const steps = Math.max(1, Math.ceil(dt / SUB));
      const h = dt / steps;
      const omega = dragging ? 26 : idle ? 6.5 : 11;
      const zeta = dragging ? 1 : 0.86;
      for (let i = 0; i < steps; i += 1) {
        if (coast) {
          coast.t += h;
          const u = Math.min(1, coast.t / coast.span);
          const rest = Math.pow(1 - u, coast.power);
          body.yaw = coast.from + coast.dist * (1 - rest);
          body.vyaw = u >= 1 ? 0 : (coast.dist * coast.power * rest) / ((1 - u) * coast.span);
          if (u >= 1) coast = null;
        } else {
          spring(body, "yaw", "vyaw", goalYaw, omega, zeta, h);
        }
        spring(body, "pitch", "vpitch", goalPitch, dragging ? 22 : 9, 0.9, h);
        spring(body, "lift", "vlift", liftGoal, 14, 0.95, h);
      }
      body.vyaw = clamp(body.vyaw, -SPIN_CAP * 1.2, SPIN_CAP * 1.2);
    }
    if (!dragging && !coast && Math.abs(home) > TAU * 8) {
      const wrap = Math.round(home / TAU) * TAU;
      home -= wrap;
      body.yaw -= wrap;
    }
    const front = Math.cos(body.yaw) * Math.cos(body.pitch) > 0;
    if (riffle && !front && lastFront && gl) {
      const next = (((shown + riffle.dir) % CARDS.length) + CARDS.length) % CARDS.length;
      if (gl.has(CARDS[next].key)) {
        active = shown = next;
        onSelect(next);
        onRiffle?.(riffle.dir);
        layout();
        riffle.left -= 1;
      } else {
        active = next;
        onSelect(next);
        ensure(next).catch(() => {});
        riffle.left = 0;
      }
      if (riffle.left <= 0) riffle = null;
    }
    if (riffle && !coast && !dragging) riffle = null;
    if (shown !== active && gl && gl.has(CARDS[active].key) && (reduced || (!front && lastFront) || (!front && !coast))) {
      shown = active;
      layout();
    }
    if (shown !== active && gl && gl.has(CARDS[active].key) && !coast && !dragging && front) {
      spinBy(1, 7.5);
    }
    lastFront = front;
    if (foil.t < 1) foil.t = Math.min(1, foil.t + (dt * 1000) / FOIL_MS);
    const settled =
      Math.abs(body.yaw - goalYaw) < 0.0004 &&
      Math.abs(body.pitch - goalPitch) < 0.0004 &&
      Math.abs(body.vyaw) + Math.abs(body.vpitch) < 0.002 &&
      Math.abs(body.lift - liftGoal) < 0.002 &&
      Math.abs(body.vlift) < 0.01 &&
      !coast &&
      foil.t >= 1;
    return { settled, ambient };
  }

  function render() {
    const spec = CARDS[shown];
    const aspect = aspectOf(shown);
    const hh = view.hh * (1 + body.lift * 0.02);
    const hw = hh * aspect;
    const roll = -Math.sin(body.yaw) * 0.04 - (body.yaw - home) * 0.02;
    const rot = rotation(body.yaw, body.pitch, clamp(roll, -0.06, 0.06));
    const mix = foil.t >= 1 ? 0 : smooth01(foil.t);
    const sleeveBottom = -hh - hh * 0.014;
    const sleeveTop = hh + hh * 0.07;
    gl.draw({
      key: spec.key,
      dpr: view.dpr * quality,
      cx: view.cx,
      cy: view.cy,
      hw,
      hh,
      rot,
      lift: body.lift * view.hh * 0.08,
      dist: Math.max(view.width, view.height) * 1.6 + 500,
      ground: view.hh * 0.16,
      radius: hw * 0.045,
      thick: Math.max(1.2, hh * 0.007),
      sleeve: [(sleeveTop + sleeveBottom) / 2, hw + hw * 0.05, (sleeveTop - sleeveBottom) / 2],
      keyLight: [-0.95 * view.hh, 1.35 * view.hh, 2.7 * view.hh],
      fillLight: [1.7 * view.hh, -0.15 * view.hh, 2.3 * view.hh],
      foil: foil.t >= 1 ? [foil.to, foil.to, 0] : [foil.from, foil.to, mix],
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
    render();
    if (!state.settled || state.ambient || pointer.mode === "drag" || orient.on) raf = requestAnimationFrame(frame);
    else if (quality !== 1) {
      applyQuality(1);
      render();
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
    relayout: () => resize(),
    setCards: (list) => setCards(list),
    setFoil: (idx) => setFoil(idx),
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
