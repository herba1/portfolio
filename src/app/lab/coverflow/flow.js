const MAX_SPEED = 9;
const STIFFNESS = 140;
const DAMPING = 2 * Math.sqrt(STIFFNESS) * 0.96;

const FLIP_K = 70;
const FLIP_D = 2 * Math.sqrt(FLIP_K);
const LIGHT = 28;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const glint = (deg) => {
  const d = deg - LIGHT;
  return { at: clamp(0.5 - d / 70, -0.4, 1.4), o: Math.exp(-((d / 34) ** 2)) };
};
const rubber = (x, d) => (1 - 1 / ((x * 0.55) / d + 1)) * d;

export function createFlow(root, { count, start = 0, onCenter, onTick, onFlip, onFlick }) {
  const stage = root.querySelector("[data-cf-stage]");
  const items = [...root.querySelectorAll("[data-cf-item]")];
  const flipA = new Float64Array(count);
  const flipV = new Float64Array(count);
  let flipped = -1;
  const scrub = root.querySelector("[data-cf-scrub]");
  const thumb = root.querySelector("[data-cf-thumb]");
  const last = count - 1;

  let size = 240;
  let pos = start;
  let vel = 0;
  let target = start;
  let center = start;
  let raf = 0;
  let prev = 0;
  let drag = null;
  let scrubbing = false;
  let wheelTimer = 0;
  let destroyed = false;

  const layout = () => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    size = w < 640 ? Math.min(w * 0.7, h * 0.6) : Math.min(h * 0.62, w * 0.3);
    size = Math.round(clamp(size, 120, 380));
    const y = Math.max(0, (h - size * 1.38) * 0.68) + size / 2;
    root.style.setProperty("--cf-size", `${size}px`);
    root.style.setProperty("--cf-y", `${Math.round(y)}px`);
    stage.style.perspective = `${Math.round(size * 3.2)}px`;
  };

  const paint = () => {
    const spread = size * 0.6;
    const step = size * 0.2;
    for (let i = 0; i < items.length; i += 1) {
      const d = i - pos;
      const ad = Math.abs(d);
      const el = items[i];
      if (ad > 9) {
        el.style.visibility = "hidden";
        continue;
      }
      el.style.visibility = "visible";
      const a = clamp(d, -1, 1);
      const x = a * spread + (ad > 1 ? Math.sign(d) * (ad - 1) * step : 0);
      const near = Math.min(ad, 1);
      const rot = -a * 66;
      const f = flipA[i] / 180;
      const lift = Math.sin(Math.PI * clamp(f, 0, 1));
      const grow = 1 + 0.1 * clamp(f, 0, 1) * (1 - near);
      const z = (1 - near) * size * 0.28 - near * size * 0.12 + lift * size * 0.34;
      const turn = rot + flipA[i];
      el.style.transform = `translate3d(${x.toFixed(2)}px,0,${z.toFixed(2)}px) rotateY(${turn.toFixed(2)}deg) scale(${grow.toFixed(4)})`;
      el.style.zIndex = String(1000 - Math.round(ad * 10) + (f > 0.001 ? 20 : 0));
      el.style.setProperty("--cf-shade", (near * 0.42 + Math.max(0, ad - 1) * 0.06).toFixed(3));
      const gf = glint(turn);
      const gb = glint(turn - 180);
      el.style.setProperty("--cf-gf", gf.at.toFixed(3));
      el.style.setProperty("--cf-gfo", gf.o.toFixed(3));
      el.style.setProperty("--cf-gb", gb.at.toFixed(3));
      el.style.setProperty("--cf-gbo", gb.o.toFixed(3));
    }
    if (thumb && scrub) {
      const travel = scrub.clientWidth - thumb.offsetWidth;
      thumb.style.transform = `translateX(${((clamp(pos, 0, last) / last) * travel).toFixed(2)}px)`;
    }
    const idx = clamp(Math.round(pos), 0, last);
    if (idx !== center) {
      center = idx;
      onCenter?.(idx);
      onTick?.(Math.abs(vel));
    }
  };

  const setFlip = (i) => {
    if (i === flipped) return;
    flipped = i;
    root.dataset.flipped = i >= 0 ? "true" : "false";
    onFlip?.(i);
    onFlick?.();
  };

  const stepFlips = (dt) => {
    let busy = false;
    for (let i = 0; i < count; i += 1) {
      const goal = i === flipped ? 180 : 0;
      if (flipA[i] === goal && flipV[i] === 0) continue;
      let left = dt;
      while (left > 0) {
        const h = Math.min(left, 1 / 240);
        flipV[i] += (-FLIP_K * (flipA[i] - goal) - FLIP_D * flipV[i]) * h;
        flipA[i] += flipV[i] * h;
        left -= h;
      }
      if (Math.abs(flipA[i] - goal) < 0.05 && Math.abs(flipV[i]) < 0.5) {
        flipA[i] = goal;
        flipV[i] = 0;
      } else busy = true;
    }
    return busy;
  };

  const frame = (now) => {
    raf = 0;
    const dt = Math.min(0.05, prev ? (now - prev) / 1000 : 1 / 60);
    prev = now;
    let busy = false;
    if (!drag) {
      let left = dt;
      while (left > 0) {
        const h = Math.min(left, 1 / 240);
        const acc = -STIFFNESS * (pos - target) - DAMPING * vel;
        vel = clamp(vel + acc * h, -MAX_SPEED, MAX_SPEED);
        pos += vel * h;
        left -= h;
      }
      if (Math.abs(pos - target) < 0.0008 && Math.abs(vel) < 0.01) {
        pos = target;
        vel = 0;
      } else busy = true;
    }
    if (flipped >= 0 && (Math.abs(target - flipped) > 0.01 || Math.abs(pos - flipped) > 0.08)) setFlip(-1);
    if (stepFlips(dt)) busy = true;
    paint();
    if (busy) raf = requestAnimationFrame(frame);
    else prev = 0;
  };

  const kick = () => {
    if (!raf && !destroyed) raf = requestAnimationFrame(frame);
  };

  const goTo = (i) => {
    target = clamp(Math.round(i), 0, last);
    kick();
  };

  const toggle = (open = flipped < 0) => {
    const i = clamp(Math.round(target), 0, last);
    if (open && Math.abs(pos - i) > 0.3) return;
    setFlip(open ? i : -1);
    kick();
  };

  const onDown = (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (e.target.closest(".cf-controls")) return;
    drag = { id: e.pointerId, x: e.clientX, lastX: e.clientX, t: performance.now(), base: pos, moved: 0, item: e.target.closest("[data-cf-item]"), onButton: !!e.target.closest("button"), captured: false };
    vel = 0;
    root.dataset.grab = "true";
  };

  const onMove = (e) => {
    if (scrubbing) {
      scrubTo(e.clientX);
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    const now = performance.now();
    const dx = e.clientX - drag.x;
    drag.moved = Math.max(drag.moved, Math.abs(dx));
    if (drag.moved < 5) return;
    if (!drag.captured) {
      drag.captured = true;
      root.setPointerCapture?.(e.pointerId);
    }
    const per = size * 0.34;
    let raw = drag.base - dx / per;
    if (raw < 0) raw = -rubber(-raw, 1.2);
    if (raw > last) raw = last + rubber(raw - last, 1.2);
    const dtm = Math.max(1, now - drag.t);
    const inst = clamp(-(e.clientX - drag.lastX) / per / (dtm / 1000), -MAX_SPEED * 2, MAX_SPEED * 2);
    vel = vel * 0.6 + inst * 0.4;
    drag.lastX = e.clientX;
    drag.t = now;
    pos = raw;
    if (drag.moved > 5 && flipped >= 0) setFlip(-1);
    paint();
    kick();
  };

  const onUp = (e) => {
    if (scrubbing) {
      scrubbing = false;
      root.dataset.scrub = "false";
      goTo(target);
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    const { moved, item, onButton } = drag;
    const idle = performance.now() - drag.t > 90;
    drag = null;
    root.dataset.grab = "false";
    if (moved < 5 && onButton) {
      vel = 0;
      goTo(target);
      return;
    }
    if (moved < 5 && !item) {
      vel = 0;
      if (flipped >= 0) toggle(false);
      goTo(target);
      return;
    }
    if (moved < 5 && item) {
      vel = 0;
      const i = Number(item.dataset.index);
      if (i === Math.round(target) && Math.abs(pos - i) < 0.3) toggle();
      else goTo(i);
      return;
    }
    if (idle) vel = 0;
    vel = clamp(vel, -MAX_SPEED, MAX_SPEED);
    goTo(pos + clamp(vel * 0.32, -5, 5));
  };

  const scrubTo = (clientX) => {
    const r = scrub.getBoundingClientRect();
    const f = clamp((clientX - r.left - thumb.offsetWidth / 2) / (r.width - thumb.offsetWidth), 0, 1);
    target = f * last;
    kick();
  };

  const onScrubDown = (e) => {
    e.stopPropagation();
    scrubbing = true;
    root.dataset.scrub = "true";
    root.setPointerCapture?.(e.pointerId);
    scrubTo(e.clientX);
  };

  const onWheel = (e) => {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!delta) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 33 : 1;
    target = clamp(target + (delta * unit) / (size * 0.5), 0, last);
    kick();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => goTo(target), 140);
  };

  const onKey = (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const inButton = e.target !== root && e.target.closest?.("button");
    if ((e.key === "Enter" || e.key === " ") && !inButton) {
      e.preventDefault();
      toggle();
    } else if (e.key === "Escape" && flipped >= 0) {
      e.preventDefault();
      toggle(false);
      root.focus({ preventScroll: true });
    } else if (step && inButton && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      return;
    } else if (step) {
      if (inButton) root.focus({ preventScroll: true });
      e.preventDefault();
      goTo(Math.round(target) + step);
    } else if (e.key === "Home") {
      e.preventDefault();
      goTo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      goTo(last);
    }
  };

  const ro = new ResizeObserver(() => {
    layout();
    paint();
  });
  ro.observe(root);
  layout();
  paint();

  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  root.addEventListener("wheel", onWheel, { passive: false });
  root.addEventListener("keydown", onKey);
  scrub?.addEventListener("pointerdown", onScrubDown);

  return {
    goTo,
    toggle,
    step: (n) => goTo(Math.round(target) + n),
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(wheelTimer);
      ro.disconnect();
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("keydown", onKey);
      scrub?.removeEventListener("pointerdown", onScrubDown);
    },
  };
}
