import { buildPlates, readyFonts } from "./risoArt";
import { createRisoGL } from "./risoGL";
import { ASPECT, MARKS, POSTERS, SHEET_MM, TEX_H, TEX_W } from "./risoPosters";

const SUB = 1 / 240;
const LIMIT = 7;
const MAX_SPEED = 150;
const SWAP_S = 0.82;
const TILT = -0.011;
const SIDE_COLUMN = 320;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const unit = (rgb) => rgb.map((c) => c / 255);
const rubber = (v) => LIMIT * Math.tanh(v / LIMIT);

function springStep(p, tx, ty, omega, zeta, h) {
  const ax = omega * omega * (tx - p.x) - 2 * zeta * omega * p.vx;
  const ay = omega * omega * (ty - p.y) - 2 * zeta * omega * p.vy;
  p.vx += ax * h;
  p.vy += ay * h;
  p.x += p.vx * h;
  p.y += p.vy * h;
}

export function createRisoEngine({ box, stage, canvas, tag, status, insets, embedded, onSelect, onReady, onFail, onRegister }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const view = { width: 1, height: 1, dpr: 1, cx: 0, cy: 0, hw: 100 };
  const sheets = new Map();
  const timers = new Set();
  let fonts = null;
  let gl = null;
  let failed = false;
  let visible = false;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let quality = 1;
  let motionQuality = 1;
  let interval = 16;
  let layerA = makeLayer(0, "intro");
  let layerB = null;
  let active = 0;
  let drag = null;
  let hover = null;
  let press = 0;
  let registered = false;
  let shownStatus = "";
  let shownTag = "";
  let introPending = true;
  let kbd = false;

  function makeLayer(idx, entering) {
    const poster = POSTERS[idx];
    const far = entering === "intro" && !reduced ? 2.6 : 1;
    const plates = poster.rest.map(([x, y]) => ({
      x: x * far,
      y: y * far,
      vx: 0,
      vy: 0,
      tx: x,
      ty: y,
      mode: "rest",
      omega: 4.2,
      precise: far > 1,
    }));
    return { idx, plates, t: entering === "swap" && !reduced ? 0 : 1, exit: false, from: null, intro: far > 1 };
  }

  function pxPerMm() {
    return (2 * view.hw) / SHEET_MM;
  }

  function snapMm() {
    return clamp(5 / pxPerMm(), 0.6, 2.2);
  }

  function layout() {
    const pad = insets();
    const wide = !embedded && view.width >= 900;
    let left = 16;
    let right = view.width - 16;
    if (wide) {
      left = SIDE_COLUMN;
      right = view.width - 40;
    }
    const availW = Math.max(80, right - left);
    const availH = Math.max(120, view.height - pad.top - pad.bottom);
    const hw = Math.max(40, Math.min(availW / 2, availH / (2 * ASPECT)));
    let cx = view.width / 2;
    if (wide && cx - hw < left) cx = (left + right) / 2;
    view.hw = hw;
    view.cx = cx;
    view.cy = pad.top + availH / 2;
  }

  function travel() {
    return view.width * 0.5 + view.hw * 1.2;
  }

  function restPose() {
    return { x: view.cx, y: view.cy, rot: TILT, lift: 0 };
  }

  function enterPose() {
    return { x: view.cx + travel(), y: view.cy + view.height * 0.05, rot: TILT + 0.1, lift: 0.8 };
  }

  function exitPose() {
    return { x: view.cx - travel(), y: view.cy - view.height * 0.04, rot: TILT - 0.09, lift: 0.7 };
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
      lift: from.lift + (to.lift - from.lift) * e + Math.sin(e * Math.PI) * 0.2,
    };
  }

  function toLocal(sx, sy, pose) {
    const dx = sx - pose.x;
    const dy = sy - pose.y;
    const c = Math.cos(pose.rot);
    const s = Math.sin(pose.rot);
    return [c * dx + s * dy, -s * dx + c * dy];
  }

  function toMm(sx, sy) {
    const [lx, ly] = toLocal(sx, sy, poseOf(layerA));
    const k = SHEET_MM / (2 * view.hw);
    return [lx * k, ly * k];
  }

  function sample(data, u, v, channels) {
    if (u < 0 || u >= 1 || v < 0 || v >= ASPECT) return 0;
    const x = Math.floor(u * TEX_W);
    const y = Math.floor((v / ASPECT) * TEX_H);
    const o = (y * TEX_W + x) * 4;
    return Math.max(data[o + channels[0]], data[o + channels[1]]) / 255;
  }

  function pick(sx, sy) {
    const pose = poseOf(layerA);
    const [lx, ly] = toLocal(sx, sy, pose);
    const w = 2 * view.hw;
    const u = lx / w + 0.5;
    const v = ly / w + ASPECT / 2;
    const slack = 10 / w;
    const onSheet = u > -slack && u < 1 + slack && v > -slack && v < ASPECT + slack;
    if (!onSheet) return null;
    const plates = layerA.plates;
    const dist = [Infinity, Infinity];
    for (let k = 0; k < 2; k += 1) {
      const ox = plates[k].x / SHEET_MM;
      const oy = plates[k].y / SHEET_MM;
      for (const [mx, my] of MARKS) {
        const d = Math.hypot(u - (mx / TEX_W + ox), v - (my / TEX_W + oy)) * w;
        dist[k] = Math.min(dist[k], d);
      }
    }
    const reach = 26;
    if (Math.min(dist[0], dist[1]) < reach) {
      if (Math.abs(dist[0] - dist[1]) < 1.5) return { plate: 1 - active, mark: true };
      return { plate: dist[0] < dist[1] ? 0 : 1, mark: true };
    }
    const data = sheets.get(POSTERS[layerA.idx].key)?.data;
    if (!data) return { plate: active, mark: false };
    const w0 = sample(data, u - plates[0].x / SHEET_MM, v - plates[0].y / SHEET_MM, [0, 2]);
    const w1 = sample(data, u - plates[1].x / SHEET_MM, v - plates[1].y / SHEET_MM, [1, 3]);
    if (Math.max(w0, w1) < 0.06 || Math.abs(w0 - w1) < 0.08) return { plate: active, mark: false };
    return { plate: w0 > w1 ? 0 : 1, mark: false };
  }

  function relative() {
    const [a, b] = layerA.plates;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function step(h) {
    const plates = layerA.plates;
    const snap = snapMm();
    for (let k = 0; k < 2; k += 1) {
      const p = plates[k];
      const o = plates[1 - k];
      if (p.mode === "drag" && drag) {
        if (drag.locked) springStep(p, o.x, o.y, 46, 0.5, h);
        else springStep(p, drag.tx, drag.ty, 24, 1, h);
      } else if (p.mode === "home") {
        springStep(p, p.tx, p.ty, p.omega, 1, h);
        if (Math.hypot(p.tx - p.x, p.ty - p.y) < 0.004 && Math.hypot(p.vx, p.vy) < 0.02) {
          p.x = p.tx;
          p.y = p.ty;
          p.vx = p.vy = 0;
          p.mode = "rest";
          if (!p.precise && Math.hypot(p.x - o.x, p.y - o.y) < snap) p.mode = "snap";
          if (p.precise && Math.hypot(p.x - o.x, p.y - o.y) < 0.12) p.mode = "snap";
        }
      } else if (p.mode === "free") {
        const damp = Math.exp(-5.2 * h);
        p.vx *= damp;
        p.vy *= damp;
        const speed = Math.hypot(p.vx, p.vy);
        if (speed > 0) {
          const cut = Math.max(0, speed - 26 * h) / speed;
          p.vx *= cut;
          p.vy *= cut;
        }
        for (const axis of ["x", "y"]) {
          const vel = axis === "x" ? "vx" : "vy";
          const over = Math.abs(p[axis]) - LIMIT;
          if (over > 0) p[vel] += (-Math.sign(p[axis]) * over * 140 - p[vel] * 12) * h;
        }
        p.x += p.vx * h;
        p.y += p.vy * h;
        const near = Math.hypot(p.x - o.x, p.y - o.y) < snap;
        const now = Math.hypot(p.vx, p.vy);
        if (near && now < 45) p.mode = "snap";
        else if (now < 0.25 && Math.abs(p.x) <= LIMIT && Math.abs(p.y) <= LIMIT) {
          p.vx = p.vy = 0;
          p.mode = "rest";
        }
      } else if (p.mode === "snap") {
        springStep(p, o.x, o.y, 46, 0.5, h);
        if (Math.hypot(o.x - p.x, o.y - p.y) < 0.004 && Math.hypot(p.vx, p.vy) < 0.05) {
          p.x = o.x;
          p.y = o.y;
          p.vx = p.vy = 0;
          p.mode = "rest";
        }
      }
    }
  }

  function updateDragTarget(dt) {
    if (!drag || drag.pointerX == null) return;
    const [mx, my] = toMm(drag.pointerX, drag.pointerY);
    const rawX = rubber(drag.startX + (mx - drag.grabX));
    const rawY = rubber(drag.startY + (my - drag.grabY));
    if (dt > 0 && drag.prevX != null) {
      const vx = (rawX - drag.prevX) / dt;
      const vy = (rawY - drag.prevY) / dt;
      const k = 1 - Math.exp(-dt / 0.045);
      drag.vx += (vx - drag.vx) * k;
      drag.vy += (vy - drag.vy) * k;
    }
    drag.prevX = rawX;
    drag.prevY = rawY;
    drag.tx = rawX;
    drag.ty = rawY;
    const o = layerA.plates[1 - drag.plate];
    const d = Math.hypot(rawX - o.x, rawY - o.y);
    const snap = snapMm();
    drag.locked = drag.locked ? d < snap * 1.45 : d < snap * 0.7;
    if (reduced) {
      const p = layerA.plates[drag.plate];
      p.x = drag.locked ? o.x : rawX;
      p.y = drag.locked ? o.y : rawY;
      p.vx = p.vy = 0;
    }
  }

  function registerCheck() {
    const d = relative();
    const now = registered ? d < 0.08 : d < 0.03;
    if (now && !registered) {
      press = 1;
      if (!reduced && navigator.vibrate && drag?.type === "touch") {
        try {
          navigator.vibrate(8);
        } catch {}
      }
    }
    if (now !== registered) {
      registered = now;
      onRegister?.(now);
    }
  }

  function inkName(k) {
    return POSTERS[layerA.idx].inks[k].name;
  }

  function fmt(v) {
    const r = Math.round(v * 10) / 10;
    const s = Math.abs(r).toFixed(1);
    return r > 0 ? `+${s}` : r < 0 ? `−${s}` : ` ${s}`;
  }

  function writeStatus() {
    if (!status) return;
    const d = relative();
    const text = registered ? "In register" : `${d.toFixed(1)} mm out of register`;
    if (text !== shownStatus) {
      status.textContent = text;
      shownStatus = text;
    }
  }

  function writeTag(sx, sy, plate, live) {
    if (!tag) return;
    if (plate == null) {
      tag.style.opacity = "0";
      shownTag = "";
      return;
    }
    const p = layerA.plates[plate];
    const label = live ? `${inkName(plate)}  ${fmt(p.x)}  ${fmt(-p.y)}` : inkName(plate);
    const key = `${layerA.idx}:${plate}:${label}`;
    if (key !== shownTag) {
      tag.lastChild.textContent = label;
      tag.style.setProperty("--riso-tag-ink", `rgb(${POSTERS[layerA.idx].inks[plate].rgb.join(" ")})`);
      shownTag = key;
    }
    const x = Math.min(sx + 16, view.width - 180);
    const y = Math.min(sy + 20, view.height - 36);
    tag.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    tag.style.opacity = "1";
  }

  function plateFrame(layer, pose) {
    const poster = POSTERS[layer.idx];
    const [a, b] = layer.plates;
    const isA = layer === layerA;
    return {
      key: poster.key,
      x: pose.x,
      y: pose.y,
      hw: view.hw * (isA ? 1 - press * 0.0035 : 1),
      rot: pose.rot,
      off: [a.x / SHEET_MM, a.y / SHEET_MM, b.x / SHEET_MM, b.y / SHEET_MM],
      ink0: unit(poster.inks[0].rgb),
      ink1: unit(poster.inks[1].rgb),
      screen: [
        poster.screens[0].mode === "grain" ? 1 : 0,
        poster.screens[1].mode === "grain" ? 1 : 0,
        (poster.screens[0].angle * Math.PI) / 180,
        (poster.screens[1].angle * Math.PI) / 180,
      ],
      lift: pose.lift,
      seed: poster.seed,
      press: isA ? press : 0,
    };
  }

  function render() {
    const a = plateFrame(layerA, poseOf(layerA));
    const b = layerB ? plateFrame(layerB, poseOf(layerB)) : null;
    gl.draw({ width: view.width, height: view.height, dpr: view.dpr * quality, a, b });
    writeStatus();
    if (drag && drag.pointerX != null) writeTag(drag.pointerX, drag.pointerY, drag.plate, true);
    else if (kbd) {
      const pose = poseOf(layerA);
      writeTag(pose.x - view.hw + 8, pose.y - view.hw * ASPECT + 8, active, true);
    }
  }

  function busy() {
    if (drag || layerB || layerA.t < 1 || press > 0.002) return true;
    return layerA.plates.some((p) => p.mode !== "rest");
  }

  function frame(now) {
    raf = 0;
    if (!gl || !visible || document.hidden || destroyed) return;
    const raw = last ? now - last : 16.67;
    const dt = clamp(raw / 1000, 0, 0.05);
    last = now;
    updateDragTarget(dt);
    if (!reduced) {
      const steps = Math.max(1, Math.ceil(dt / SUB));
      const h = dt / steps;
      for (let i = 0; i < steps; i += 1) step(h);
    } else {
      for (const p of layerA.plates) {
        if (p.mode === "home") {
          p.x = p.tx;
          p.y = p.ty;
        } else if (p.mode === "snap") {
          const o = layerA.plates[layerA.plates.indexOf(p) ^ 1];
          p.x = o.x;
          p.y = o.y;
        }
        if (p.mode !== "drag") p.mode = "rest";
      }
    }
    if (layerA.t < 1) layerA.t = reduced ? 1 : Math.min(1, layerA.t + dt / SWAP_S);
    if (layerB) {
      layerB.t = reduced ? 1 : Math.min(1, layerB.t + dt / (SWAP_S * 0.92));
      if (layerB.t >= 1) layerB = null;
    }
    press = reduced ? 0 : press * Math.exp(-dt * 14);
    if (press < 0.002) press = 0;
    registerCheck();
    const moving = busy();
    if (moving) {
      interval = interval * 0.75 + raw * 0.25;
      if (interval > 40 && motionQuality > 0.75) {
        motionQuality = Math.max(0.75, motionQuality * 0.9);
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
    if (raf || !gl || !visible || document.hidden || destroyed) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function ensure(idx) {
    const poster = POSTERS[idx];
    const have = sheets.get(poster.key);
    if (have) return have.promise;
    const entry = { data: null, promise: null };
    entry.promise = (async () => {
      if (!fonts) fonts = await readyFonts();
      const data = await buildPlates(poster, fonts);
      if (destroyed || !gl) return false;
      gl.upload(poster.key, data);
      entry.data = data;
      return true;
    })().catch((error) => {
      sheets.delete(poster.key);
      console.error(error);
      return false;
    });
    sheets.set(poster.key, entry);
    return entry.promise;
  }

  function prebuild() {
    let delay = 600;
    POSTERS.forEach((_, i) => {
      if (i === layerA.idx) return;
      const id = setTimeout(() => {
        timers.delete(id);
        if (!destroyed) ensure(i);
      }, delay);
      timers.add(id);
      delay += 500;
    });
  }

  function startIntro() {
    if (!introPending) return;
    introPending = false;
    if (layerA.intro) layerA.plates.forEach((p) => (p.mode = "home"));
    onReady();
    wake();
  }

  function init() {
    if (gl || failed) return;
    try {
      gl = createRisoGL(canvas);
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
      startIntro();
      prebuild();
    });
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
    if (gl && sheets.get(POSTERS[layerA.idx].key)?.data) {
      render();
      wake();
    }
  }

  function applyQuality(q) {
    quality = q;
    if (gl) gl.resize(Math.max(1, Math.round(view.width * view.dpr * q)), Math.max(1, Math.round(view.height * view.dpr * q)));
  }

  function select(idx) {
    if (idx === layerA.idx || idx < 0 || idx >= POSTERS.length) return;
    onSelect(idx);
    ensure(idx).then((ok) => {
      if (!ok || destroyed || idx === layerA.idx) return;
      endDrag(null);
      layerB = reduced ? null : { ...layerA, exit: true, t: 0, from: poseOf(layerA) };
      layerA = makeLayer(idx, "swap");
      if (!reduced) layerA.from = enterPose();
      active = 0;
      registered = false;
      onRegister?.(false);
      writeTag(0, 0, null);
      wake();
    });
  }

  function local(e) {
    const rect = box.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function ready() {
    return gl && sheets.get(POSTERS[layerA.idx].key)?.data && layerA.t >= 1;
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    kbd = false;
    if (!ready() || drag) return;
    const [x, y] = local(e);
    const hit = pick(x, y);
    if (!hit) return;
    stage.setPointerCapture?.(e.pointerId);
    const p = layerA.plates[hit.plate];
    const [gx, gy] = toMm(x, y);
    p.mode = "drag";
    p.precise = false;
    active = hit.plate;
    drag = {
      id: e.pointerId,
      type: e.pointerType,
      plate: hit.plate,
      grabX: gx,
      grabY: gy,
      startX: p.x,
      startY: p.y,
      pointerX: x,
      pointerY: y,
      prevX: null,
      prevY: null,
      tx: p.x,
      ty: p.y,
      vx: p.vx,
      vy: p.vy,
      locked: registered,
    };
    box.dataset.grabbing = "";
    writeTag(x, y, hit.plate, true);
    wake();
  }

  function onMove(e) {
    const [x, y] = local(e);
    if (drag && e.pointerId === drag.id) {
      drag.pointerX = x;
      drag.pointerY = y;
      wake();
      return;
    }
    if (drag || e.pointerType !== "mouse" || !ready()) return;
    kbd = false;
    hover = pick(x, y);
    writeTag(x, y, hover ? hover.plate : null, false);
  }

  function endDrag(e) {
    if (!drag) return;
    if (e && e.pointerId !== drag.id) return;
    const p = layerA.plates[drag.plate];
    if (drag.locked) p.mode = "snap";
    else {
      const speed = Math.hypot(drag.vx, drag.vy);
      const k = speed > MAX_SPEED ? MAX_SPEED / speed : 1;
      p.vx = drag.vx * k;
      p.vy = drag.vy * k;
      p.mode = reduced ? "rest" : "free";
    }
    const wasMouse = drag.type === "mouse";
    const at = [drag.pointerX, drag.pointerY];
    drag = null;
    delete box.dataset.grabbing;
    if (e && wasMouse) {
      hover = pick(at[0], at[1]);
      writeTag(at[0], at[1], hover ? hover.plate : null, false);
    } else writeTag(0, 0, null);
    wake();
  }

  function onBlur() {
    if (!kbd) return;
    kbd = false;
    writeTag(0, 0, null);
  }

  function onLeave(e) {
    if (drag || e.pointerType !== "mouse") return;
    hover = null;
    writeTag(0, 0, null);
  }

  function nudge(dx, dy) {
    const p = layerA.plates[active];
    p.tx = clamp((p.mode === "home" ? p.tx : p.x) + dx, -LIMIT, LIMIT);
    p.ty = clamp((p.mode === "home" ? p.ty : p.y) + dy, -LIMIT, LIMIT);
    p.omega = 30;
    p.precise = true;
    p.mode = "home";
    kbd = true;
    wake();
  }

  function onKey(e) {
    if (!ready()) return;
    const stepMm = e.shiftKey ? 1.5 : 0.2;
    let handled = true;
    if (e.key === "ArrowLeft") nudge(-stepMm, 0);
    else if (e.key === "ArrowRight") nudge(stepMm, 0);
    else if (e.key === "ArrowUp") nudge(0, -stepMm);
    else if (e.key === "ArrowDown") nudge(0, stepMm);
    else if (e.key === " ") {
      active = 1 - active;
      kbd = true;
      render();
    } else if (e.key === "Enter" || e.key === "r" || e.key === "R") {
      const p = layerA.plates[active];
      p.mode = "snap";
      kbd = true;
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
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("pointerleave", onLeave);
  stage.addEventListener("keydown", onKey);
  stage.addEventListener("blur", onBlur);

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
      stage.removeEventListener("pointerup", endDrag);
      stage.removeEventListener("pointercancel", endDrag);
      stage.removeEventListener("pointerleave", onLeave);
      stage.removeEventListener("keydown", onKey);
      stage.removeEventListener("blur", onBlur);
      if (gl) gl.destroy();
      gl = null;
    },
  };
}
