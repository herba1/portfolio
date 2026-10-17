import { drawGrain, drawVarnish, loadImage, readyFont } from "./thermoArt";
import { createThermoGL } from "./thermoGL";
import { FIELD, SLEEVES } from "./thermoSleeves";

const SUB = 1 / 240;
const MAX_SUBSTEPS = 12;
const DIFFUSION = 0.0013;
const COOL = 0.19;
const VISIBLE_HEAT = 0.05;
const STEADY_S = 14;
const SWAP_S = 0.86;
const TILT = -0.012;
const SIDE_COLUMN = 320;
const MAX_POINTERS = 5;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createThermoEngine({ box, stage, canvas, insets, embedded, onSelect, onReady, onFail }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const view = { width: 1, height: 1, dpr: 1, cx: 0, cy: 0, hs: 100 };
  const loads = new Map();
  const heat = SLEEVES.map(() => ({ est: 0, shown: false, touched: false }));
  const pointers = new Map();
  const timers = new Set();
  const light = { x: 0, y: 0, tx: 0, ty: 0 };
  let font = null;
  let gl = null;
  let failed = false;
  let visible = false;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let layerA = { idx: 0, t: 1, from: null, exit: false };
  let layerB = null;
  let pendingStamp = null;
  let introPending = true;
  let handTurn = 0;

  function layout() {
    const pad = insets();
    const wide = !embedded && view.width >= 900;
    let left = 16;
    let right = view.width - 16;
    if (wide) {
      left = SIDE_COLUMN;
      right = view.width - 48;
    }
    const availW = Math.max(80, right - left);
    const availH = Math.max(120, view.height - pad.top - pad.bottom);
    const hs = Math.max(40, Math.min(availW / 2, availH / 2, 380));
    let cx = view.width / 2;
    if (wide && cx - hs < left) cx = (left + right) / 2;
    view.hs = hs;
    view.cx = cx;
    view.cy = pad.top + availH / 2;
  }

  function travel() {
    return view.width * 0.5 + view.hs * 1.3;
  }

  function restPose() {
    return { x: view.cx, y: view.cy, rot: TILT, lift: 0 };
  }

  function enterPose() {
    return { x: view.cx + travel(), y: view.cy + view.height * 0.04, rot: TILT + 0.09, lift: 0.8 };
  }

  function exitPose() {
    return { x: view.cx - travel(), y: view.cy - view.height * 0.03, rot: TILT - 0.08, lift: 0.7 };
  }

  function poseOf(layer) {
    if (layer.t >= 1 && !layer.exit) return restPose();
    const e = ease(clamp(layer.t, 0, 1));
    const from = layer.from || enterPose();
    const to = layer.exit ? exitPose() : restPose();
    return {
      x: from.x + (to.x - from.x) * e,
      y: from.y + (to.y - from.y) * e,
      rot: from.rot + (to.rot - from.rot) * e,
      lift: from.lift + (to.lift - from.lift) * e + Math.sin(e * Math.PI) * 0.15,
    };
  }

  function toUV(sx, sy, pose) {
    const dx = sx - pose.x;
    const dy = sy - pose.y;
    const c = Math.cos(pose.rot);
    const s = Math.sin(pose.rot);
    const lx = c * dx + s * dy;
    const ly = -s * dx + c * dy;
    return [lx / (2 * view.hs) + 0.5, ly / (2 * view.hs) + 0.5];
  }

  function layerFrame(layer) {
    const pose = poseOf(layer);
    return {
      key: SLEEVES[layer.idx].key,
      x: pose.x,
      y: pose.y,
      hs: view.hs * (1 + pose.lift * 0.025),
      rot: pose.rot,
      lift: pose.lift,
      seed: SLEEVES[layer.idx].seed,
    };
  }

  function render() {
    gl.draw({
      width: view.width,
      height: view.height,
      light: [light.x, light.y],
      a: layerFrame(layerA),
      b: layerB ? layerFrame(layerB) : null,
    });
  }

  function contactOf(p, speed) {
    const fast = Math.min(speed, 4);
    const pool = 1 + p.dwell * 1.05;
    if (p.type === "mouse" && !p.pressed) return { radius: 0.05 * pool, rate: 4.2 + fast * 6, target: 1 + p.dwell * 0.2 };
    if (p.type === "mouse") return { radius: 0.062 * pool, rate: 8 + fast * 10, target: 1.06 + p.dwell * 0.2 };
    return { radius: 0.056 * pool, rate: 8 + fast * 10, target: 1.04 + p.dwell * 0.2 };
  }

  function simulate(idx, dt, segsFor) {
    const key = SLEEVES[idx].key;
    const steps = clamp(Math.ceil(dt / SUB), 1, MAX_SUBSTEPS);
    const h = dt / steps;
    const frozen = reduced && !heat[idx].touched;
    const diff = frozen ? 0 : DIFFUSION * FIELD * FIELD * h;
    const cool = frozen ? 0 : COOL * h;
    for (let i = 0; i < steps; i += 1) {
      const stamp = i === 0 && pendingStamp && pendingStamp.idx === idx ? pendingStamp : null;
      if (stamp) pendingStamp = null;
      gl.step(key, { diff, cool, h, segs: segsFor ? segsFor(i, steps) : [], stamp });
    }
  }

  function stampHand(idx, amp, pose) {
    const hand = pose || SLEEVES[idx].hand;
    pendingStamp = { idx, x: hand.x, y: hand.y, rot: hand.rot, scale: hand.scale, amp };
    heat[idx].est = Math.max(heat[idx].est, amp);
    simulate(idx, SUB, null);
    const settle = reduced ? 0 : 20;
    for (let i = 0; i < settle; i += 1) simulate(idx, SUB, null);
  }

  function updatePointers(dt, pose) {
    const segs = [];
    let any = false;
    for (const p of pointers.values()) {
      const [u, v] = toUV(p.x, p.y, pose);
      if (p.fresh) {
        p.pu = u;
        p.pv = v;
        p.speed = 0;
        p.fresh = false;
      }
      const moved = Math.hypot(u - p.pu, v - p.pv);
      const vel = dt > 0 ? moved / dt : 0;
      p.speed += (vel - p.speed) * (1 - Math.exp(-dt / 0.05));
      p.still = moved < 0.0004 ? p.still + dt : 0;
      const settle = p.speed < 0.08 ? 1 : 0;
      p.dwell += (settle - p.dwell) * (1 - Math.exp(-dt / (settle ? 1.6 : 0.25)));
      const inside = u > -0.06 && u < 1.06 && v > -0.06 && v < 1.06;
      const wasInside = p.pu > -0.06 && p.pu < 1.06 && p.pv > -0.06 && p.pv < 1.06;
      if ((inside || wasInside) && p.still < STEADY_S && segs.length < MAX_POINTERS) {
        segs.push({ pu: p.pu, pv: p.pv, u, v, ...contactOf(p, p.speed) });
        any = true;
      }
      p.pu = u;
      p.pv = v;
    }
    return { segs, any };
  }

  function busy() {
    if (layerB || layerA.t < 1) return true;
    if (Math.abs(light.x - light.tx) > 0.002 || Math.abs(light.y - light.ty) > 0.002) return true;
    for (const p of pointers.values()) if (p.still < STEADY_S) return true;
    return heat.some((s) => s.est > VISIBLE_HEAT && !(reduced && !s.touched));
  }

  function updateLight(dt) {
    let tx = 0;
    let ty = 0;
    let n = 0;
    for (const p of pointers.values()) {
      tx += clamp((p.x - view.cx) / view.hs, -1.4, 1.4);
      ty += clamp((p.y - view.cy) / view.hs, -1.4, 1.4);
      n += 1;
    }
    light.tx = n ? (tx / n) * 0.5 : 0;
    light.ty = n ? (ty / n) * 0.5 : 0;
    if (reduced) {
      light.x = light.tx;
      light.y = light.ty;
      return;
    }
    const k = 1 - Math.exp(-dt * 3.2);
    light.x += (light.tx - light.x) * k;
    light.y += (light.ty - light.y) * k;
  }

  function frame(now) {
    raf = 0;
    if (!gl || !visible || document.hidden || destroyed) return;
    const dt = clamp(last ? (now - last) / 1000 : 1 / 60, 0.001, 0.05);
    last = now;
    updateLight(dt);
    if (layerA.t < 1) layerA.t = reduced ? 1 : Math.min(1, layerA.t + dt / SWAP_S);
    if (layerB) {
      layerB.t = reduced ? 1 : Math.min(1, layerB.t + dt / (SWAP_S * 0.92));
      if (layerB.t >= 1) layerB = null;
    }
    if (layerA.land && layerA.t >= 0.8) {
      layerA.land = false;
      show(layerA.idx, 1.25);
    }
    const active = layerA.idx;
    const pose = poseOf(layerA);
    const live = layerA.t > 0.7 ? updatePointers(dt, pose) : { segs: [], any: false };
    if (live.any) {
      heat[active].touched = true;
      heat[active].est = Math.max(heat[active].est, 1.3);
    }
    heat.forEach((s, i) => {
      const loaded = gl.has(SLEEVES[i].key);
      if (!loaded) return;
      const heating = i === active && live.any;
      if (!heating && s.est <= VISIBLE_HEAT) return;
      if (reduced && !s.touched) return;
      simulate(i, dt, heating ? (step, steps) => live.segs.map((g) => ({
        x0: g.pu + (g.u - g.pu) * (step / steps),
        y0: g.pv + (g.v - g.pv) * (step / steps),
        x1: g.pu + (g.u - g.pu) * ((step + 1) / steps),
        y1: g.pv + (g.v - g.pv) * ((step + 1) / steps),
        radius: g.radius,
        rate: g.rate,
        target: g.target,
      })) : null);
      if (!heating) s.est *= Math.exp(-COOL * dt);
    });
    render();
    if (busy()) raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (raf || !gl || !visible || document.hidden || destroyed || introPending) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function ensure(idx) {
    const sleeve = SLEEVES[idx];
    const have = loads.get(sleeve.key);
    if (have) return have;
    const promise = (async () => {
      if (!font) font = await readyFont();
      const image = await loadImage(sleeve.src);
      if (destroyed || !gl) return false;
      gl.add(sleeve.key, image, drawVarnish(sleeve, font), drawGrain(sleeve.seed));
      return true;
    })().catch((error) => {
      loads.delete(sleeve.key);
      console.error(error);
      return false;
    });
    loads.set(sleeve.key, promise);
    return promise;
  }

  function prebuild() {
    let delay = 700;
    SLEEVES.forEach((_, i) => {
      if (i === layerA.idx) return;
      const id = setTimeout(() => {
        timers.delete(id);
        if (!destroyed) ensure(i);
      }, delay);
      timers.add(id);
      delay += 400;
    });
  }

  function show(idx, amp) {
    const s = heat[idx];
    if (s.est > 0.5) return;
    stampHand(idx, amp, handTurn % 2 === 0 || !s.shown ? null : flipped(idx));
    handTurn += 1;
    s.shown = true;
  }

  function flipped(idx) {
    const hand = SLEEVES[idx].hand;
    return { x: 1 - hand.x, y: hand.y + 0.03, rot: -hand.rot * 0.8, scale: hand.scale * 0.96 };
  }

  function init() {
    if (gl || failed) return;
    try {
      gl = createThermoGL(canvas);
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
    ensure(layerA.idx).then((ok) => {
      if (!ok || destroyed) return;
      show(layerA.idx, 1.2);
      introPending = false;
      render();
      onReady();
      wake();
      prebuild();
    });
  }

  function resize() {
    const rect = box.getBoundingClientRect();
    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    const budget = Math.sqrt(2600000 / Math.max(1, rect.width * rect.height));
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    view.dpr = Math.max(0.75, Math.min(dprCap, budget));
    layout();
    if (gl) {
      gl.resize(Math.max(1, Math.round(view.width * view.dpr)), Math.max(1, Math.round(view.height * view.dpr)));
      if (!introPending) {
        render();
        wake();
      }
    }
  }

  function select(idx) {
    if (idx === layerA.idx || idx < 0 || idx >= SLEEVES.length) return;
    onSelect(idx);
    ensure(idx).then((ok) => {
      if (!ok || destroyed || idx === layerA.idx) return;
      pointers.forEach((p) => {
        p.fresh = true;
      });
      const from = poseOf(layerA);
      layerB = reduced ? null : { ...layerA, exit: true, t: 0, from };
      layerA = { idx, t: reduced ? 1 : 0, from: reduced ? null : enterPose(), exit: false, land: true };
      render();
      wake();
    });
  }

  function local(e) {
    const rect = box.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function track(e, pressed) {
    const [x, y] = local(e);
    let p = pointers.get(e.pointerId);
    if (!p) {
      if (pointers.size >= MAX_POINTERS) return null;
      p = { x, y, pu: 0, pv: 0, speed: 0, still: 0, dwell: 0, fresh: true, pressed, type: e.pointerType };
      pointers.set(e.pointerId, p);
    }
    p.x = x;
    p.y = y;
    p.still = 0;
    if (pressed != null) p.pressed = pressed;
    return p;
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (introPending) return;
    track(e, true);
    stage.setPointerCapture?.(e.pointerId);
    if (e.pointerType === "mouse") box.dataset.pressing = "";
    wake();
  }

  function onMove(e) {
    if (introPending) return;
    const known = pointers.get(e.pointerId);
    if (!known && e.pointerType !== "mouse") return;
    track(e, null);
    wake();
  }

  function onUp(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (e.pointerType === "mouse" && e.type === "pointerup") {
      p.pressed = false;
      delete box.dataset.pressing;
      const [x, y] = local(e);
      const inside = x >= 0 && y >= 0 && x <= view.width && y <= view.height;
      if (!inside) pointers.delete(e.pointerId);
    } else {
      pointers.delete(e.pointerId);
      delete box.dataset.pressing;
    }
    wake();
  }

  function onLeave(e) {
    if (e.pointerType !== "mouse") return;
    const p = pointers.get(e.pointerId);
    if (p && !p.pressed) pointers.delete(e.pointerId);
    wake();
  }

  function onKey(e) {
    if (introPending) return;
    let handled = true;
    if (e.key === "Enter" || e.key === " ") {
      const idx = layerA.idx;
      heat[idx].touched = true;
      const pose = handTurn % 2 === 0 ? SLEEVES[idx].hand : flipped(idx);
      handTurn += 1;
      stampHand(idx, 1.2, pose);
      render();
      wake();
    } else if (/^[1-9]$/.test(e.key)) select(Number(e.key) - 1);
    else handled = false;
    if (handled) e.preventDefault();
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
    select,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      for (const id of timers) clearTimeout(id);
      timers.clear();
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
