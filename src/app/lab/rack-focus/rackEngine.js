import { createRackGL } from "./rackGL";
import { BG_DEPTH, PHI_MAX, TYPE_DEPTH, buildLights, cameraFor, distanceLabel, paintBackground, paintType, project } from "./rackScene";

const REST_PHI = 1 / TYPE_DEPTH;
const OMEGA = 6.4;
const MAX_SPEED = 2.6;
const BLADES = 7;
const BLADE_ROT = 0.31;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createRack({ box, canvas, scale, strip, readout, reticle, embedded, onReady }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let gl = createRackGL(canvas);
  if (!gl) throw new Error("WebGL2 unavailable");

  const family = getComputedStyle(box).fontFamily || "system-ui, sans-serif";
  const bgCanvas = document.createElement("canvas");
  const typeCanvas = document.createElement("canvas");
  const world = buildLights();
  const view = { width: 1, height: 1, dpr: 1, k: 90, cam: null };
  let screenLights = [];
  let typeBoxes = [];
  const st = { phi: reduced ? REST_PHI : REST_PHI + 0.14, v: 0, target: REST_PHI, drag: null, spring: false };
  let quality = gl.software ? 0.7 : 1;
  let fontReady = false;
  let ready = false;
  let readySent = false;
  let fade = reduced ? 1 : 0;
  let introDelay = reduced ? 0 : 0.5;
  let visible = false;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let lastLabel = "";
  let lastShift = NaN;

  function ppd() {
    return parseFloat(getComputedStyle(box).getPropertyValue("--rack-ppd")) || 200;
  }

  function buildScreen() {
    const cam = view.cam;
    const data = [];
    screenLights = [];
    world.forEach((l) => {
      const [x, y] = project(cam, l.x, l.h, l.d);
      if (x < -120 || x > view.width + 120 || y < -120 || y > view.height + 120) return;
      screenLights.push({ x, y, d: l.d, energy: l.energy });
      data.push({ x, y, d: l.d, e: l.energy, c: l.color, s: 0 });
      if (l.reflect) {
        const [, yRoad] = project(cam, l.x, 0, l.d);
        const [, yRef] = project(cam, l.x, -l.h, l.d);
        if (yRef < view.height + 60) {
          const half = Math.max(2, (yRef - yRoad) * 0.3);
          data.push({ x, y: yRoad + (yRef - yRoad) * 0.62, d: l.d, e: l.energy * 0.075, c: l.color, s: half });
        }
      }
    });
    const gain = 2200 * Math.pow(view.k / 96, 2);
    const arr = new Float32Array(data.length * 8);
    data.forEach((l, i) => {
      arr.set([l.x, l.y, l.d, l.e * gain, l.c[0], l.c[1], l.c[2], l.s], i * 8);
    });
    gl.uploadLights(arr, data.length);
  }

  function paint() {
    const texScale = Math.min(2, view.dpr);
    paintBackground(bgCanvas, view.cam, texScale * 0.75, world);
    gl.uploadBackground(bgCanvas);
    typeBoxes = paintType(typeCanvas, view.width, view.height, texScale, family);
    gl.uploadType(typeCanvas);
  }

  function layout() {
    const rect = box.getBoundingClientRect();
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    view.cam = cameraFor(view.width, view.height);
    view.k = clamp(0.095 * Math.sqrt(view.width * view.height), 30, 120);
    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    const budget = Math.sqrt(2200000 / (view.width * view.height));
    view.dpr = Math.max(0.6, Math.min(dprCap, budget));
    gl.resize(Math.max(1, Math.round(view.width * view.dpr * quality)), Math.max(1, Math.round(view.height * view.dpr * quality)));
    buildScreen();
    if (fontReady) paint();
  }

  function render() {
    const phi = st.phi;
    gl.draw({
      stage: [view.width, view.height],
      phi,
      k: view.k,
      breath: 1 + 0.012 * (phi / PHI_MAX),
      bgRadius: view.k * Math.abs(1 / BG_DEPTH - phi),
      typeRadius: view.k * Math.abs(1 / TYPE_DEPTH - phi),
      blurScale: gl.software ? 0.4 : 0.5,
      blades: BLADES,
      bladeRot: BLADE_ROT,
      exposure: 1,
      fade: 1 - Math.pow(1 - fade, 3),
    });
    updateDom();
    if (!readySent && fade > 0) {
      readySent = true;
      onReady?.();
    }
  }

  function updateDom() {
    const shift = PHI_MAX - st.phi;
    if (strip && !(Math.abs(shift - lastShift) < 0.0004)) {
      lastShift = shift;
      strip.style.setProperty("--rack-shift", shift.toFixed(4));
    }
    const label = distanceLabel(st.phi);
    if (readout && label !== lastLabel) {
      lastLabel = label;
      readout.textContent = label;
    }
    if (!st.drag) {
      scale?.setAttribute("aria-valuenow", st.target.toFixed(2));
      scale?.setAttribute("aria-valuetext", `Focused at ${distanceLabel(st.target)}`);
    }
  }

  function simulate(dt) {
    const d = st.drag;
    if (d && d.kind === "scale") {
      const k = 1 - Math.exp(-dt * 22);
      const prev = st.phi;
      st.phi += (st.target - st.phi) * k;
      st.v = dt > 0 ? (st.phi - prev) / dt : 0;
      return true;
    }
    if (!st.spring) return false;
    const x0 = st.phi - st.target;
    const b = st.v + OMEGA * x0;
    const e = Math.exp(-OMEGA * dt);
    let x1 = (x0 + b * dt) * e;
    let v1 = (b - OMEGA * (x0 + b * dt)) * e;
    if (Math.abs(v1) > MAX_SPEED) {
      v1 = Math.sign(v1) * MAX_SPEED;
      x1 = x0 + v1 * dt;
      if (Math.sign(x1) !== Math.sign(x0)) x1 = 0;
    }
    st.phi = st.target + x1;
    st.v = v1;
    if (Math.abs(x1) < 0.0005 && Math.abs(v1) < 0.004) {
      st.phi = st.target;
      st.v = 0;
      st.spring = false;
    }
    return true;
  }

  function rackTo(phi) {
    introDelay = 0;
    st.target = clamp(phi, 0, PHI_MAX);
    st.spring = true;
    wake();
  }

  function frame(now) {
    raf = 0;
    if (!gl || !visible || document.hidden || destroyed) return;
    const dt = last ? clamp((now - last) / 1000, 0, 0.05) : 0;
    last = now;
    let busy = false;
    if (ready) {
      if (fade < 1) {
        fade = Math.min(1, fade + dt / 0.8);
        busy = true;
      }
      if (introDelay > 0) {
        introDelay -= dt;
        busy = true;
        if (introDelay <= 0) rackTo(REST_PHI);
      }
      busy = simulate(dt) || busy;
      render();
    }
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

  function pickFocus(x, y) {
    const pad = 18;
    if (typeBoxes.some((b) => x > b.x0 - pad && x < b.x1 + pad && y > b.y0 - pad && y < b.y1 + pad)) return 1 / TYPE_DEPTH;
    let best = null;
    let bestScore = Infinity;
    screenLights.forEach((l) => {
      const dist = Math.hypot(l.x - x, l.y - y);
      if (dist > 64) return;
      const score = dist / (0.6 + Math.sqrt(l.energy));
      if (score < bestScore) {
        bestScore = score;
        best = l;
      }
    });
    return best ? 1 / best.d : 1 / BG_DEPTH;
  }

  function showReticle(x, y) {
    if (!reticle) return;
    reticle.style.left = `${x}px`;
    reticle.style.top = `${y}px`;
    delete reticle.dataset.on;
    void reticle.offsetWidth;
    reticle.dataset.on = "";
  }

  function onCanvasDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (st.drag) return;
    canvas.setPointerCapture?.(e.pointerId);
    introDelay = 0;
    const [x, y] = local(e);
    st.drag = { kind: "canvas", id: e.pointerId, x0: x, y0: y, phi0: st.phi, moved: false };
  }

  function onCanvasMove(e) {
    const d = st.drag;
    if (!d || d.kind !== "canvas" || e.pointerId !== d.id) return;
    const [x, y] = local(e);
    const dy = y - d.y0;
    if (!d.moved && Math.hypot(x - d.x0, dy) > 6) {
      d.moved = true;
      box.dataset.grabbing = "";
      d.y0 = y;
      d.phi0 = st.phi;
      return;
    }
    if (!d.moved) return;
    rackTo(d.phi0 + (dy / Math.max(240, view.height * 0.7)) * PHI_MAX);
  }

  function onCanvasUp(e) {
    const d = st.drag;
    if (!d || d.kind !== "canvas" || e.pointerId !== d.id) return;
    st.drag = null;
    delete box.dataset.grabbing;
    if (!d.moved && e.type === "pointerup") {
      const [x, y] = local(e);
      showReticle(x, y);
      rackTo(pickFocus(x, y));
    }
  }

  function onScaleDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (st.drag) return;
    scale.setPointerCapture?.(e.pointerId);
    introDelay = 0;
    st.spring = false;
    st.target = st.phi;
    st.drag = { kind: "scale", id: e.pointerId, x0: e.clientX, phi0: st.phi };
    box.dataset.grabbing = "";
    wake();
  }

  function onScaleMove(e) {
    const d = st.drag;
    if (!d || d.kind !== "scale" || e.pointerId !== d.id) return;
    st.target = clamp(d.phi0 + (e.clientX - d.x0) / ppd(), 0, PHI_MAX);
    wake();
  }

  function onScaleUp(e) {
    const d = st.drag;
    if (!d || d.kind !== "scale" || e.pointerId !== d.id) return;
    st.drag = null;
    delete box.dataset.grabbing;
    st.v = clamp(st.v, -MAX_SPEED, MAX_SPEED);
    rackTo(st.target);
  }

  function onKey(e) {
    let next = null;
    const base = st.target;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = base - 0.05;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = base + 0.05;
    else if (e.key === "PageUp") next = base - 0.2;
    else if (e.key === "PageDown") next = base + 0.2;
    else if (e.key === "End") next = 0;
    else if (e.key === "Home") next = PHI_MAX;
    else if (e.key === "t" || e.key === "T") next = 1 / TYPE_DEPTH;
    if (next === null || st.drag) return;
    e.preventDefault();
    rackTo(next);
  }

  function onWheel(e) {
    if (embedded && document.activeElement !== canvas && document.activeElement !== scale) return;
    if (st.drag) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    rackTo(st.target + clamp(dy, -120, 120) * 0.0016);
  }

  layout();
  updateDom();

  document.fonts
    .load(`500 100px ${family}`, "walk you home")
    .catch(() => null)
    .then(() => {
      if (destroyed || !gl) return;
      fontReady = true;
      paint();
      ready = true;
      if (reduced) st.spring = false;
      wake();
    });

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible) wake();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    { rootMargin: "80px" },
  );
  io.observe(box);
  const ro = new ResizeObserver(() => {
    layout();
    if (ready && gl) render();
  });
  ro.observe(box);
  const onVisibility = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else wake();
  };
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("pointerdown", onCanvasDown);
  canvas.addEventListener("pointermove", onCanvasMove);
  canvas.addEventListener("pointerup", onCanvasUp);
  canvas.addEventListener("pointercancel", onCanvasUp);
  canvas.addEventListener("keydown", onKey);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  scale?.addEventListener("pointerdown", onScaleDown);
  scale?.addEventListener("pointermove", onScaleMove);
  scale?.addEventListener("pointerup", onScaleUp);
  scale?.addEventListener("pointercancel", onScaleUp);
  scale?.addEventListener("keydown", onKey);
  scale?.addEventListener("wheel", onWheel, { passive: false });

  return {
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onCanvasDown);
      canvas.removeEventListener("pointermove", onCanvasMove);
      canvas.removeEventListener("pointerup", onCanvasUp);
      canvas.removeEventListener("pointercancel", onCanvasUp);
      canvas.removeEventListener("keydown", onKey);
      canvas.removeEventListener("wheel", onWheel);
      scale?.removeEventListener("pointerdown", onScaleDown);
      scale?.removeEventListener("pointermove", onScaleMove);
      scale?.removeEventListener("pointerup", onScaleUp);
      scale?.removeEventListener("pointercancel", onScaleUp);
      scale?.removeEventListener("keydown", onKey);
      scale?.removeEventListener("wheel", onWheel);
      gl?.destroy();
      gl = null;
    },
  };
}
