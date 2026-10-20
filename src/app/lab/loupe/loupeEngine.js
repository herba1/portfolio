import { CARDS, ZOOM_MAX, ZOOM_MIN, ZOOM_REST } from "./loupeCards";
import { createLoupeGL } from "./loupeGL";

const LOG_MIN = Math.log(ZOOM_MIN);
const LOG_MAX = Math.log(ZOOM_MAX);
const SUB = 1 / 240;
const SWAP_MS = 760;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const mix = (a, b, t) => a + (b - a) * t;

function spring(state, key, velKey, target, omega, h) {
  const x = state[key];
  const v = state[velKey];
  const a = omega * omega * (target - x) - 2 * omega * v;
  state[velKey] = v + a * h;
  state[key] = x + state[velKey] * h;
}

export function createLoupeEngine({ box, stage, canvas, tag, slider, insets, embedded, onSelect, onReady, onFail }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const view = { width: 1, height: 1, dpr: 1, tableMm: 0.1, radius: 80 };
  const lens = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, lz: Math.log(ZOOM_REST), vlz: 0, tlz: Math.log(ZOOM_REST), lift: 0, vlift: 0, tlift: 0, on: false };
  const pointers = new Map();
  const images = new Map();
  let pinch = null;
  let pending = null;
  let queued = null;
  let touchOffset = 0;
  let intro = false;
  let armed = !embedded;
  let gl = null;
  let failed = false;
  let visible = false;
  let raf = 0;
  let last = 0;
  let destroyed = false;
  let shownZoom = "";
  let layerA = { idx: 0, from: null, t0: 0 };
  let quality = 1;
  let motionQuality = 1;
  let interval = 16;
  let layerB = null;

  function fit(aspect, tilt) {
    const pad = insets();
    const availH = Math.max(120, view.height - pad.top - pad.bottom);
    const freeW = Math.max(160, view.width - pad.left - pad.right);
    const wide = !embedded && view.width >= 900;
    const c = Math.abs(Math.cos(tilt));
    const s = Math.abs(Math.sin(tilt));
    let hh = Math.min(availH * 0.44, view.height * 0.34);
    if (!wide) hh = Math.min(hh, (freeW * (view.width < 640 ? 0.5 : 0.42)) / aspect);
    hh = Math.min(hh, (freeW * 0.47) / (aspect * c + s), (availH * 0.48) / (aspect * s + c));
    hh = Math.max(60, hh);
    const hw = hh * aspect;
    const ext = hw * c + hh * s;
    const lo = pad.left + ext;
    const hi = view.width - pad.right - ext;
    const x = wide ? clamp(view.width / 2, Math.min(lo, hi), Math.max(lo, hi)) : view.width / 2;
    return { x, y: pad.top + availH / 2, hw, hh };
  }

  function rest(idx) {
    const card = CARDS[idx];
    const aspect = images.get(card.key)?.aspect || card.aspect;
    const f = fit(aspect, card.tilt);
    return { x: f.x, y: f.y, rot: card.tilt, hw: f.hw, hh: f.hh, mmPx: card.widthMm / (2 * f.hw) };
  }

  function layout() {
    const { hh } = fit(CARDS[0].aspect, CARDS[0].tilt);
    view.tableMm = 50 / (2 * hh);
    view.radius = clamp(0.5 * hh, 52, 150);
  }

  function poseOf(layer, now) {
    const target = rest(layer.idx);
    if (!layer.from) return { ...target, lift: 0, done: true };
    const t = reduced ? 1 : clamp((now - layer.t0) / SWAP_MS, 0, 1);
    const e = ease(t);
    const f = layer.from;
    const to = layer.exit ? { ...target, x: target.x - view.width * 0.62 - target.hw, y: target.y + view.height * 0.1, rot: target.rot - 0.2 } : target;
    return {
      x: mix(f.x, to.x, e),
      y: mix(f.y, to.y, e),
      rot: mix(f.rot, to.rot, e),
      hw: target.hw,
      hh: target.hh,
      mmPx: target.mmPx,
      lift: layer.exit ? Math.sin(e * Math.PI * 0.5) * 0.5 : Math.sin((1 - e) * Math.PI * 0.5) * 0.7,
      done: t >= 1,
    };
  }

  function select(idx, now = performance.now()) {
    if (layerB) {
      queued = idx === layerA.idx ? null : idx;
      onSelect(idx);
      return;
    }
    queued = null;
    if (idx === layerA.idx) return;
    const current = poseOf(layerA, now);
    layerB = { idx: layerA.idx, from: current, t0: now, exit: true };
    const target = rest(idx);
    layerA = { idx, from: { x: target.x + view.width * 0.62 + target.hw, y: target.y + view.height * 0.06, rot: target.rot + 0.16 }, t0: now };
    load(idx);
    onSelect(idx);
    wake();
  }

  function focusPoint(idx) {
    const r = rest(idx);
    const [fx, fy] = CARDS[idx].focus;
    const lx = (fx - 0.5) * 2 * r.hw;
    const ly = (fy - 0.5) * 2 * r.hh;
    const c = Math.cos(r.rot);
    const s = Math.sin(r.rot);
    return [r.x + lx * c - ly * s, r.y + lx * s + ly * c];
  }

  function place() {
    const [fx, fy] = focusPoint(layerA.idx);
    lens.tx = fx;
    lens.ty = fy;
    lens.tlz = Math.log(ZOOM_REST);
    if (pending) {
      const [px, py] = bound(pending[0], pending[1]);
      lens.x = lens.tx = px;
      lens.y = lens.ty = py;
      lens.lz = lens.tlz;
      intro = false;
    } else if (reduced) {
      lens.x = fx;
      lens.y = fy;
      lens.lz = lens.tlz;
    } else {
      lens.x = fx + view.radius * 1.5;
      lens.y = fy + view.radius * 1.1;
      lens.lz = Math.log(2);
      intro = true;
    }
    lens.on = true;
    syncSlider();
  }

  function load(idx) {
    const card = CARDS[idx];
    if (images.has(card.key)) return;
    images.set(card.key, { pending: true });
    const img = new Image();
    img.decoding = "async";
    img.src = card.src;
    img
      .decode()
      .then(() => {
        if (destroyed || !gl) return;
        gl.upload(card.key, img);
        images.set(card.key, { aspect: img.naturalWidth / img.naturalHeight });
        if (idx === layerA.idx && !lens.on) place();
        wake();
      })
      .catch(() => images.delete(card.key));
  }

  function init() {
    if (gl || failed) return;
    try {
      gl = createLoupeGL(canvas);
    } catch {
      gl = null;
    }
    if (!gl) {
      failed = true;
      onFail();
      return;
    }
    resize();
    load(layerA.idx);
    CARDS.forEach((_, i) => load(i));
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
    if (lens.on && !pointers.size) {
      lens.tx = clamp(lens.tx, 0, view.width);
      lens.ty = clamp(lens.ty, 0, view.height);
    }
    wake();
  }

  function applyQuality(q) {
    quality = q;
    if (gl) gl.resize(Math.max(1, Math.round(view.width * view.dpr * q)), Math.max(1, Math.round(view.height * view.dpr * q)));
  }

  function syncSlider() {
    if (slider && document.activeElement !== slider) slider.value = String(Math.round(((lens.tlz - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 1000));
  }

  function setZoomTarget(lz) {
    lens.tlz = clamp(lz, LOG_MIN, LOG_MAX);
    if (reduced) lens.lz = lens.tlz;
    intro = false;
    syncSlider();
    wake();
  }

  function bound(x, y) {
    const r = rest(layerA.idx);
    const reach = Math.max(r.hw, r.hh) + view.radius * 0.2;
    return [clamp(x, Math.max(view.radius * 0.6, r.x - reach), Math.min(view.width - view.radius * 0.6, r.x + reach)), clamp(y, r.y - r.hh + view.radius * 0.2, r.y + r.hh + view.radius * 0.2)];
  }

  function setTarget(x, y) {
    const [bx, by] = bound(x, y);
    lens.tx = bx;
    lens.ty = by;
    if (reduced) {
      lens.x = lens.tx;
      lens.y = lens.ty;
    }
    wake();
  }

  function local(e) {
    const rect = box.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!lens.on) return;
    armed = true;
    intro = false;
    stage.setPointerCapture?.(e.pointerId);
    const [x, y] = local(e);
    pointers.set(e.pointerId, { x, y, type: e.pointerType });
    lens.tlift = 1;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, lz: lens.tlz };
      setTarget((a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (pointers.size === 1) {
      touchOffset = e.pointerType === "touch" ? -(view.radius + 24) : 0;
      setTarget(x, y + touchOffset);
    }
    wake();
  }

  function onMove(e) {
    const [x, y] = local(e);
    if (!lens.on) {
      if (e.pointerType !== "touch") pending = [x, y];
      return;
    }
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === "touch" || pointers.size) return;
      intro = false;
      setTarget(x, y);
      return;
    }
    p.x = x;
    p.y = y;
    if (pointers.size >= 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      setZoomTarget(pinch.lz + Math.log(dist / pinch.dist));
      setTarget((a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    setTarget(x, y + touchOffset);
  }

  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 1) {
      const [only] = [...pointers.values()];
      touchOffset = only.type === "touch" ? -(view.radius + 24) : 0;
    }
    if (!pointers.size) lens.tlift = 0;
    wake();
  }

  function onWheel(e) {
    if (!armed || !lens.on) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.height : 1;
    const dy = clamp(e.deltaY * unit, -240, 240);
    setZoomTarget(lens.tlz - dy * (e.ctrlKey ? 0.012 : 0.0024));
  }

  function onKey(e) {
    if (!lens.on) return;
    const step = e.shiftKey ? 48 : 12;
    let handled = true;
    if (e.key === "ArrowLeft") setTarget(lens.tx - step, lens.ty);
    else if (e.key === "ArrowRight") setTarget(lens.tx + step, lens.ty);
    else if (e.key === "ArrowUp") setTarget(lens.tx, lens.ty - step);
    else if (e.key === "ArrowDown") setTarget(lens.tx, lens.ty + step);
    else if (e.key === "+" || e.key === "=") setZoomTarget(lens.tlz + Math.log(1.3));
    else if (e.key === "-" || e.key === "_") setZoomTarget(lens.tlz - Math.log(1.3));
    else if (e.key === "]") select((layerA.idx + 1) % CARDS.length);
    else if (e.key === "[") select((layerA.idx + CARDS.length - 1) % CARDS.length);
    else if (/^[1-4]$/.test(e.key)) select(Number(e.key) - 1);
    else handled = false;
    if (handled) {
      intro = false;
      e.preventDefault();
    }
  }

  function onSlider() {
    const v = Number(slider.value) / 1000;
    lens.tlz = mix(LOG_MIN, LOG_MAX, v);
    if (reduced) lens.lz = lens.tlz;
    intro = false;
    armed = true;
    wake();
  }

  function render(now) {
    if (layerB && poseOf(layerB, now).done) {
      layerB = null;
      if (queued != null) {
        const next = queued;
        queued = null;
        select(next, now);
      }
    }
    const a = poseOf(layerA, now);
    const b = layerB ? poseOf(layerB, now) : null;
    if (b && b.done) layerB = null;
    if (a.done && layerA.from) layerA = { idx: layerA.idx, from: null, t0: 0 };
    const zoom = Math.exp(lens.lz);
    const radius = view.radius * (1 + lens.lift * 0.035);
    const cardA = CARDS[layerA.idx];
    gl.draw({
      width: view.width,
      height: view.height,
      dpr: view.dpr * quality,
      tableMm: view.tableMm,
      a: { ...a, key: cardA.key, wear: cardA.wear },
      b: b && !b.done ? { ...b, key: CARDS[layerB.idx].key, wear: CARDS[layerB.idx].wear } : null,
      lens: { x: lens.x, y: lens.y, r: radius, zoom, lift: lens.lift, on: lens.on },
    });
    if (tag) {
      const label = `${zoom < 9.95 ? zoom.toFixed(1) : Math.round(zoom)}×`;
      if (label !== shownZoom) {
        tag.textContent = label;
        shownZoom = label;
      }
    }
    if (gl.has(cardA.key)) onReady();
    return (!a.done) || Boolean(layerB);
  }

  function frame(now) {
    raf = 0;
    if (!gl || !visible || document.hidden) return;
    const raw = now - last;
    const dt = clamp(raw / 1000, 0, 0.05);
    last = now;
    let moving = false;
    if (lens.on && !reduced) {
      const steps = Math.max(1, Math.ceil(dt / SUB));
      const h = dt / steps;
      const omega = intro ? 9 : 19;
      for (let i = 0; i < steps; i += 1) {
        spring(lens, "x", "vx", lens.tx, omega, h);
        spring(lens, "y", "vy", lens.ty, omega, h);
        spring(lens, "lz", "vlz", lens.tlz, intro ? 8 : 13, h);
        spring(lens, "lift", "vlift", lens.tlift, 16, h);
      }
      const far = Math.abs(lens.x - lens.tx) + Math.abs(lens.y - lens.ty) > 0.04 || Math.abs(lens.vx) + Math.abs(lens.vy) > 0.4;
      const zooming = Math.abs(lens.lz - lens.tlz) > 0.0005 || Math.abs(lens.vlz) > 0.002;
      const lifting = Math.abs(lens.lift - lens.tlift) > 0.002 || Math.abs(lens.vlift) > 0.01;
      moving = far || zooming || lifting;
      if (!moving) {
        lens.x = lens.tx;
        lens.y = lens.ty;
        lens.lz = lens.tlz;
        lens.lift = lens.tlift;
        lens.vx = lens.vy = lens.vlz = lens.vlift = 0;
        intro = false;
      }
    } else if (reduced) {
      lens.lift = lens.tlift;
    }
    const busy = moving || Boolean(layerB) || Boolean(layerA.from);
    if (busy) {
      interval = interval * 0.75 + raw * 0.25;
      if (interval > 34 && motionQuality > 0.5) {
        motionQuality = Math.max(0.5, motionQuality * 0.85);
        interval = 20;
      }
      if (quality !== motionQuality) applyQuality(motionQuality);
    }
    const swapping = render(now);
    if (!moving && !swapping && quality !== 1) {
      applyQuality(1);
      render(now);
    }
    if (moving || swapping) raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (raf || !gl || !visible || document.hidden || destroyed) return;
    last = performance.now();
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
    { rootMargin: "120px" },
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
  stage.addEventListener("wheel", onWheel, { passive: false });
  stage.addEventListener("keydown", onKey);
  slider?.addEventListener("input", onSlider);

  return {
    select: (idx) => (gl ? select(idx) : onSelect(idx)),
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
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("keydown", onKey);
      slider?.removeEventListener("input", onSlider);
      if (gl) gl.destroy();
      gl = null;
    },
  };
}
