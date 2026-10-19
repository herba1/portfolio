const MAX_SPEED = 9;
const STIFFNESS = 140;
const DAMPING = 2 * Math.sqrt(STIFFNESS) * 0.96;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rubber = (x, d) => (1 - 1 / ((x * 0.55) / d + 1)) * d;

export function createFlow(root, { count, start = 0, onCenter, onTick }) {
  const stage = root.querySelector("[data-cf-stage]");
  const items = [...root.querySelectorAll("[data-cf-item]")];
  const shades = items.map((el) => el.querySelector("[data-cf-shade]"));
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
      const z = (1 - near) * size * 0.28 - near * size * 0.12;
      el.style.transform = `translate3d(${x.toFixed(2)}px,0,${z.toFixed(2)}px) rotateY(${rot.toFixed(2)}deg)`;
      el.style.zIndex = String(1000 - Math.round(ad * 10));
      shades[i].style.opacity = (near * 0.42 + Math.max(0, ad - 1) * 0.06).toFixed(3);
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

  const frame = (now) => {
    raf = 0;
    const dt = Math.min(0.05, prev ? (now - prev) / 1000 : 1 / 60);
    prev = now;
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
        paint();
        prev = 0;
        return;
      }
    }
    paint();
    if (!drag) raf = requestAnimationFrame(frame);
    else prev = 0;
  };

  const kick = () => {
    if (!raf && !destroyed) raf = requestAnimationFrame(frame);
  };

  const goTo = (i) => {
    target = clamp(Math.round(i), 0, last);
    kick();
  };

  const onDown = (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (e.target.closest("button, [data-cf-scrub]")) return;
    root.setPointerCapture?.(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, lastX: e.clientX, t: performance.now(), base: pos, moved: 0, item: e.target.closest("[data-cf-item]") };
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
    paint();
  };

  const onUp = (e) => {
    if (scrubbing) {
      scrubbing = false;
      root.dataset.scrub = "false";
      goTo(target);
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    const { moved, item } = drag;
    const idle = performance.now() - drag.t > 90;
    drag = null;
    root.dataset.grab = "false";
    if (moved < 5 && item) {
      vel = 0;
      goTo(Number(item.dataset.index));
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
    if (step) {
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
