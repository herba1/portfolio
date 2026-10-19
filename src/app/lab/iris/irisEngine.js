import { analysePhoto } from "./irisAnalyse";
import { FRAME, SCENE_H, SCENE_W, SUBJECT, buildScene, depthAt, extraLights, hueAt, lightAllowed } from "./irisScene";
import { createIrisSound } from "./irisSound";
import { createIrisGL } from "./irisGL";

export const STOPS = ["1.4", "2", "2.8", "4", "5.6", "8", "11", "16"];
export const STOP_DEG = 26;
const THIRDS = ["1.4", "1.6", "1.8", "2", "2.2", "2.5", "2.8", "3.2", "3.5", "4", "4.5", "5", "5.6", "6.3", "7.1", "8", "9", "10", "11", "13", "14", "16"];
const SHUTTER = ["1/500", "1/400", "1/320", "1/250", "1/200", "1/160", "1/125", "1/100", "1/80", "1/60", "1/50", "1/40", "1/30", "1/25", "1/20", "1/15", "1/13", "1/10", "1/8", "1/6", "1/5", "1/4"];
const MAX_STOP = STOPS.length - 1;
const REST = 1;
const INTRO = 2.2;
const DETENT = 0.62;
const SETTLE = 13;
const OPEN_SETTLE = 5.2;
const MAX_VEL = 10;
const TAU = Math.PI * 2;
const OPEN_PER_STOP = 0.17;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function felt(raw) {
  let x = raw;
  let over = 0;
  if (x < 0) {
    over = x;
    x = 0;
  } else if (x > MAX_STOP) {
    over = x - MAX_STOP;
    x = MAX_STOP;
  }
  return x - (DETENT * Math.sin(TAU * x)) / TAU + 0.22 * Math.tanh(over * 1.6);
}

function unfelt(s) {
  const target = clamp(s, 0, MAX_STOP);
  let x = target;
  for (let i = 0; i < 8; i += 1) {
    const g = x - (DETENT * Math.sin(TAU * x)) / TAU - target;
    const d = 1 - DETENT * Math.cos(TAU * x);
    x -= g / Math.max(d, 0.2);
  }
  return x;
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

export function readoutFor(s) {
  const i = clamp(Math.round(s * 3), 0, THIRDS.length - 1);
  return { f: THIRDS[i], t: SHUTTER[i] };
}

export function createIris({ box, canvas, header, dial, readout, embedded, onReady }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let gl = createIrisGL(canvas);
  if (!gl) throw new Error("WebGL2 unavailable");

  const bladeC = new Float32Array(18);
  const bladeN = new Float32Array(18);
  const shapeC = new Float32Array(18);
  const view = { width: 1, height: 1, dpr: 1, cx: 0, cy: 0, rl: 100 };
  const start = reduced ? REST : INTRO;
  const st = {
    s: start,
    v: 0,
    target: start,
    spring: false,
    omega: SETTLE,
    drag: null,
    gainEv: REST,
    fade: reduced ? 1 : 0,
    lastDetent: Math.round(start),
  };
  let quality = 1;
  let motionQuality = 1;
  let interval = 16.7;
  let slowFrames = 0;
  let visible = false;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let ready = false;
  let readySent = false;
  let wheelAcc = 0;
  let lastReadout = "";
  let lastAria = "";
  let lastDial = NaN;
  const sound = createIrisSound();
  let lastTick = Math.round(start * 3);

  function layout() {
    const rect = box.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    view.width = w;
    view.height = h;
    const narrow = w < 640;
    let top = embedded ? 12 : 88;
    if (!embedded && narrow && header) {
      const hr = header.getBoundingClientRect();
      top = Math.max(top, hr.bottom - rect.top + 20);
    }
    const bottom = embedded ? 56 : 76;
    const availH = Math.max(120, h - top - bottom);
    const rl = Math.max(60, Math.min(narrow ? w * 0.46 : w * 0.4, availH / 2, 440));
    view.rl = rl;
    view.cy = top + availH / 2;
    let cx = w / 2;
    if (!embedded && !narrow) cx = clamp(Math.max(w / 2, 336 + rl), rl + 24, w - rl - 24);
    view.cx = cx;
    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    const budget = Math.sqrt(2000000 / (w * h));
    view.dpr = Math.max(0.6, Math.min(dprCap, budget));
    box.style.setProperty("--iris-cx", `${cx}px`);
    box.style.setProperty("--iris-cy", `${view.cy}px`);
    box.style.setProperty("--iris-r", `${rl}px`);
    applyQuality(quality);
  }

  function applyQuality(q) {
    quality = q;
    gl?.resize(Math.max(1, Math.round(view.width * view.dpr * q)), Math.max(1, Math.round(view.height * view.dpr * q)));
  }

  function zoneOf(x, y) {
    const r = Math.hypot(x - view.cx, y - view.cy) / view.rl;
    return r >= 0.74 && r <= 1.06 ? "ring" : "field";
  }

  function angleOf(x, y) {
    return Math.atan2(y - view.cy, x - view.cx);
  }

  function release(v) {
    const vel = clamp(v, -MAX_VEL, MAX_VEL);
    st.v = vel;
    st.target = clamp(Math.round(st.s + vel * 0.1), 0, MAX_STOP);
    st.omega = SETTLE;
    st.spring = true;
  }

  function stepTo(target, omega = SETTLE) {
    st.target = clamp(target, 0, MAX_STOP);
    st.omega = omega;
    st.spring = true;
    wake();
  }

  function simulate(dt) {
    const d = st.drag;
    if (d) {
      let raw = d.startRaw;
      if (d.zone === "ring") {
        const a = angleOf(d.x, d.y);
        let delta = a - d.lastAngle;
        if (delta > Math.PI) delta -= TAU;
        if (delta < -Math.PI) delta += TAU;
        d.lastAngle = a;
        d.turn += delta;
        raw -= (d.turn * 180) / Math.PI / STOP_DEG;
      } else {
        const per = Math.max(40, view.rl * 0.3);
        raw += (d.x - d.startX + (d.y - d.startY)) / per;
      }
      const next = felt(raw);
      if (dt > 0.002) {
        const inst = (next - st.s) / dt;
        const k = 1 - Math.exp(-dt / 0.045);
        st.v += (inst - st.v) * k;
      }
      st.s = next;
      if (d.releasing) {
        st.drag = null;
        delete box.dataset.grabbing;
        release(d.cancelled ? 0 : st.v);
      }
      const detent = Math.round(st.s);
      if (detent !== st.lastDetent) {
        st.lastDetent = detent;
        if (d.touch && st.s >= -0.05 && st.s <= MAX_STOP + 0.05) navigator.vibrate?.(4);
      }
    } else if (st.spring) {
      const x0 = st.s - st.target;
      const w = st.omega;
      const b = st.v + w * x0;
      const e = Math.exp(-w * dt);
      const x1 = (x0 + b * dt) * e;
      st.v = (b - w * (x0 + b * dt)) * e;
      st.s = st.target + x1;
      if (Math.abs(x1) < 0.0004 && Math.abs(st.v) < 0.003) {
        st.s = st.target;
        st.v = 0;
        st.spring = false;
      }
      st.lastDetent = Math.round(st.s);
    }
    if (ready) {
      const adapt = reduced ? 1 : 1 - Math.exp(-dt / 0.22);
      st.gainEv += (st.s - st.gainEv) * adapt;
      if (Math.abs(st.s - st.gainEv) < 0.002) st.gainEv = st.s;
    }
    if (ready && st.fade < 1) st.fade = reduced ? 1 : Math.min(1, st.fade + dt / 1.1);
    return Boolean(st.drag) || st.spring || (ready && st.gainEv !== st.s) || (ready && st.fade < 1);
  }

  function updateDom() {
    const deg = -st.s * STOP_DEG;
    if (dial && !(Math.abs(deg - lastDial) <= 0.01)) {
      lastDial = deg;
      dial.forEach((g) => g.setAttribute("transform", `${g.dataset.shift || ""} rotate(${deg.toFixed(3)})`));
    }
    const r = readoutFor(st.s);
    const text = `${r.f}|${r.t}`;
    if (readout && text !== lastReadout) {
      lastReadout = text;
      readout.f.textContent = r.f;
      readout.t.textContent = r.t;
    }
    if (!st.drag && !st.spring) {
      const aria = `f/${r.f}`;
      if (aria !== lastAria) {
        lastAria = aria;
        canvas.setAttribute("aria-valuenow", String(Math.round(st.s)));
        canvas.setAttribute("aria-valuetext", `f/${STOPS[clamp(Math.round(st.s), 0, MAX_STOP)]}`);
      }
    }
  }

  function render(settled) {
    const scale = canvas.width / view.width;
    const rl = view.rl * scale;
    const cx = view.cx * scale;
    const cy = view.cy * scale;
    const s = st.s;
    const sc = clamp(s, -0.3, MAX_STOP + 0.3);
    const openMax = 0.645 * rl;
    const openA = openMax * Math.pow(2, -OPEN_PER_STOP * sc);
    const curv = 0.64 - 0.56 * smooth(0, MAX_STOP, sc);
    const rot = 0.32 + 0.075 * sc;
    const rb = openA / curv;
    const shapeRb = 1 / curv;
    for (let i = 0; i < 9; i += 1) {
      const a = rot + (i * TAU) / 9;
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      bladeN[i * 2] = nx;
      bladeN[i * 2 + 1] = ny;
      bladeC[i * 2] = -nx * (rb - openA);
      bladeC[i * 2 + 1] = -ny * (rb - openA);
      shapeC[i * 2] = -nx * (shapeRb - 1);
      shapeC[i * 2 + 1] = -ny * (shapeRb - 1);
    }
    const coc = 0.085 * rl * Math.pow(2, -sc / 2);
    const k = (FRAME.span * rl) / SCENE_W;
    const ev = clamp(st.gainEv - s, -0.3, 0.3);
    gl.draw({
      cx,
      cy,
      rl,
      px: Math.max(0.75, scale),
      openMax,
      bladeC,
      bladeN,
      rb,
      shapeC,
      shapeRb,
      spriteScale: settled || coc <= 9 * scale ? 1 : 0.5,
      openVis: Math.min(0.69 * rl, (openA / Math.cos(Math.PI / 9)) * 1.03),
      rot,
      ring: (-s * STOP_DEG * Math.PI) / 180,
      map: [cx - FRAME.anchorX * SCENE_W * k, cy - FRAME.anchorY * SCENE_H * k, SCENE_W * k, SCENE_H * k],
      k,
      coc,
      focus: 0.1,
      boost: 34,
      spike: smooth(2.2, 6.4, sc),
      spikeLen: 0.026 * rl,
      cat: Math.pow(2, OPEN_PER_STOP * Math.max(sc, 0)),
      exposure: Math.pow(2, ev),
      vig: 0.3 * (1 - smooth(0, 3.2, sc)),
      fade: ready ? 1 - Math.pow(1 - st.fade, 3) : 0,
      spill: [0.07, 0.06, 0.05],
    });
    updateDom();
    if (ready && !readySent && st.fade > 0) {
      readySent = true;
      onReady?.();
    }
  }

  function frame(now) {
    raf = 0;
    if (!gl || !visible || document.hidden || destroyed) return;
    const raw = last ? now - last : 16.7;
    const dt = last ? clamp(raw / 1000, 0, 0.1) : 0;
    last = now;
    const busy = simulate(dt);
    const tick = clamp(Math.round(st.s * 3), 0, MAX_STOP * 3);
    if (tick !== lastTick) {
      const main = tick % 3 === 0;
      lastTick = tick;
      if (ready) sound.click(main ? 1 : 0.4, st.s / MAX_STOP);
    }
    sound.swish(busy && ready ? st.v : 0, clamp(st.s / MAX_STOP, 0, 1));
    if (!reduced && busy) {
      interval = interval * 0.9 + raw * 0.1;
      slowFrames = interval > 42 ? slowFrames + 1 : 0;
      if (slowFrames > 8 && motionQuality > 0.56) {
        slowFrames = 0;
        interval = 20;
        motionQuality = Math.max(0.55, motionQuality * 0.85);
      }
    }
    const want = busy ? motionQuality : 1;
    if (want !== quality) applyQuality(want);
    render(!busy);
    if (busy) raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (raf || !gl || !visible || document.hidden || destroyed) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function local(e) {
    const r = box.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (st.drag && !st.drag.releasing) return;
    canvas.setPointerCapture?.(e.pointerId);
    sound.start();
    const [x, y] = local(e);
    const zone = zoneOf(x, y);
    st.spring = false;
    st.v = 0;
    st.drag = {
      id: e.pointerId,
      zone,
      touch: e.pointerType === "touch",
      startX: x,
      startY: y,
      x,
      y,
      startRaw: unfelt(st.s) + (st.s - clamp(st.s, 0, MAX_STOP)),
      lastAngle: angleOf(x, y),
      turn: 0,
      releasing: false,
      cancelled: false,
    };
    box.dataset.grabbing = "";
    wake();
  }

  function onMove(e) {
    const d = st.drag;
    if (!d || d.releasing || e.pointerId !== d.id) return;
    const [x, y] = local(e);
    d.x = x;
    d.y = y;
    wake();
  }

  function onUp(e) {
    const d = st.drag;
    if (!d || d.releasing || e.pointerId !== d.id) return;
    if (e.type === "pointerup") {
      const [x, y] = local(e);
      d.x = x;
      d.y = y;
    }
    d.cancelled = e.type === "pointercancel";
    d.releasing = true;
    wake();
  }

  function baseTarget() {
    return st.spring ? st.target : Math.round(st.s);
  }

  function onKey(e) {
    let next = null;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") next = baseTarget() + 1;
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = baseTarget() - 1;
    else if (e.key === "PageUp") next = baseTarget() + 2;
    else if (e.key === "PageDown") next = baseTarget() - 2;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = MAX_STOP;
    if (next === null) return;
    if (st.drag && !st.drag.releasing) return;
    sound.start();
    if (st.drag) {
      st.drag = null;
      delete box.dataset.grabbing;
    }
    e.preventDefault();
    stepTo(next);
  }

  function onWheel(e) {
    if (embedded && document.activeElement !== canvas) return;
    if (st.drag) return;
    e.preventDefault();
    sound.start();
    const dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    if (Math.abs(dy) >= 80) {
      wheelAcc = 0;
      stepTo(baseTarget() + Math.sign(dy));
      return;
    }
    wheelAcc += dy;
    if (Math.abs(wheelAcc) >= 56) {
      const dir = Math.sign(wheelAcc);
      wheelAcc -= dir * 56;
      stepTo(baseTarget() + dir);
    }
  }

  layout();
  updateDom();

  loadImage(SUBJECT.src)
    .then((img) => {
      if (destroyed || !gl) return;
      gl.uploadScene(analysePhoto(buildScene(img), { depthAt, allow: lightAllowed, hueAt, extra: extraLights() }));
      ready = true;
      if (!reduced) {
        st.v = 0;
        stepTo(REST, OPEN_SETTLE);
      }
      wake();
    })
    .catch((error) => {
      console.error(error);
    });

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        last = 0;
        if (!raf) raf = requestAnimationFrame(frame);
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    { rootMargin: "80px" },
  );
  io.observe(box);
  const ro = new ResizeObserver(() => {
    layout();
    lastDial = NaN;
    if (visible && !raf) raf = requestAnimationFrame(frame);
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
  canvas.addEventListener("wheel", onWheel, { passive: false });

  return {
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
      canvas.removeEventListener("wheel", onWheel);
      sound.destroy();
      gl?.destroy();
      gl = null;
    },
  };
}
