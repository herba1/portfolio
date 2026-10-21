const MAX_SPEED = 9;
const STIFFNESS = 140;
const DAMPING = 2 * Math.sqrt(STIFFNESS);
const OMEGA = Math.sqrt(STIFFNESS);
const REACH = 12;

const FLIP_K = 70;
const FLIP_D = 2 * Math.sqrt(FLIP_K);
const LIGHT = 28;
const ANG = 74;
const Z_CENTER = 0.26;
const Z_SIDE = -0.22;
const GAP = 0.04;
const PERSP = 5;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const glint = (deg) => {
  const d = deg - LIGHT;
  return { at: clamp(0.5 - d / 70, -0.4, 1.4), o: Math.exp(-((d / 34) ** 2)) };
};
const rubber = (x, d) => (1 - 1 / ((x * 0.55) / d + 1)) * d;
const ease = (u) => u * u * (3 - 2 * u);
const snap = (t, dir) => (dir > 0 ? Math.ceil(t - 0.001) : dir < 0 ? Math.floor(t + 0.001) : Math.round(t));

export function createFlow(root, { count, start = 0, onCenter, onTick, onFlip, onFlick }) {
  const stage = root.querySelector("[data-cf-stage]");
  let items = [...root.querySelectorAll("[data-cf-item]")];
  let flipA = new Float64Array(count);
  let flipV = new Float64Array(count);
  let flipped = -1;
  const scrub = root.querySelector("[data-cf-scrub]");
  const thumb = root.querySelector("[data-cf-thumb]");
  let last = count - 1;
  let swapTimer = 0;

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
  let wheelDir = 0;
  let scrubDir = 0;
  let destroyed = false;

  const layout = () => {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    size = w < 640 ? Math.min(w * 0.7, h * 0.6) : Math.min(h * 0.62, w * 0.3);
    size = Math.round(clamp(size, 120, 380));
    const y = Math.max(0, (h - size * 1.38) * 0.68) + size / 2;
    root.style.setProperty("--cf-size", `${size}px`);
    root.style.setProperty("--cf-y", `${Math.round(y)}px`);
    stage.style.perspective = `${Math.round(size * PERSP)}px`;
  };

  const pose = (t) => {
    const near = ease(Math.min(Math.abs(t), 1));
    return { near, th: near * ANG, z: ((1 - near) * Z_CENTER + near * Z_SIDE) * size };
  };

  const shape = (th, z, scale = 1) => {
    const r = (th * Math.PI) / 180;
    return { c: (size / 2) * scale * Math.abs(Math.cos(r)), e: (size / 2) * scale * Math.abs(Math.sin(r)), z };
  };
  const kAt = (z) => {
    const P = size * PERSP;
    return P / Math.max(P * 0.15, P - z);
  };
  const shapeAt = (t) => {
    const p = pose(t);
    return shape(p.th, p.z);
  };
  const nextOut = (x, from, to, gap) => to.c + ((x + from.c) * kAt(from.z + from.e) + gap) / kAt(to.z - to.e);

  const N = 64;
  let table = null;
  let tableSize = 0;
  const reachAt = (x, t) => {
    const p = pose(t);
    const r = (p.th * Math.PI) / 180;
    const c = (size / 2) * Math.cos(r);
    const e = (size / 2) * Math.sin(r);
    return { c, kl: kAt(p.z - e), kr: kAt(p.z + e), l: (x - c) * kAt(p.z - e), r: (x + c) * kAt(p.z + e) };
  };
  const onward = (x, prevX, prevT, t) => {
    const was = reachAt(prevX, prevT);
    const now = reachAt(x, t);
    return Math.max(x, prevX, was.l / now.kl + now.c, was.r / now.kr - now.c);
  };
  const solve = () => {
    tableSize = size;
    const gap = GAP * size;
    const M = REACH * N;
    const one = shapeAt(1);
    const x1 = one.c + ((size / 2) * kAt(Z_CENTER * size) + gap) / kAt(one.z - one.e);
    let t = new Float64Array(M + 1);
    for (let j = 0; j <= N; j += 1) t[j] = (x1 * j) / N;
    const enforce = () => {
      for (let j = 1; j <= M; j += 1) {
        const at = j / N;
        let need;
        if (j < N) {
          const b = shapeAt(at);
          const a = shapeAt(1 - at);
          need = b.c + ((-t[N - j] + a.c) * kAt(a.z - a.e) + gap) / kAt(b.z - b.e);
        } else need = nextOut(t[j - N], shapeAt(at - 1), shapeAt(at), gap);
        t[j] = onward(Math.max(t[j], need), t[j - 1], (j - 1) / N, at);
      }
    };
    const hull = (from, to) => {
      const keep = [from];
      for (let j = from + 1; j <= to; j += 1) {
        while (keep.length > 1) {
          const a = keep[keep.length - 2];
          const b = keep[keep.length - 1];
          if ((t[b] - t[a]) * (j - a) <= (t[j] - t[a]) * (b - a)) keep.pop();
          else break;
        }
        keep.push(j);
      }
      for (let k = 1; k < keep.length; k += 1) {
        const a = keep[k - 1];
        const b = keep[k];
        for (let j = a + 1; j < b; j += 1) t[j] = t[a] + ((t[b] - t[a]) * (j - a)) / (b - a);
      }
    };
    for (let it = 0; it < 40; it += 1) enforce();
    for (let u = 1; u < REACH; u += 1) {
      for (let j = u * N + 1; j <= (u + 1) * N; j += 1) t[j] = Math.max(nextOut(t[j - N], shapeAt(j / N - 1), shapeAt(j / N), gap), t[j - 1]);
      hull(u * N, (u + 1) * N);
    }
    table = t;
  };

  const span = (d) => {
    if (!table || tableSize !== size) solve();
    const k = Math.min(Math.abs(d), REACH) * N;
    const j = Math.min(REACH * N - 1, Math.floor(k));
    return Math.sign(d) * (table[j] + (table[j + 1] - table[j]) * (k - j));
  };

  const paint = () => {
    let pushAt = -1;
    let pushR = 0;
    let pushL = 0;
    for (let i = 0; i < items.length; i += 1) {
      const f = flipA[i] / 180;
      if (f <= 0.001) continue;
      const d = i - pos;
      const p = pose(d);
      const lift = Math.sin(Math.PI * clamp(f, 0, 1));
      const grow = 1 + 0.1 * clamp(f, 0, 1) * (1 - p.near);
      const me = shape(p.th + flipA[i], p.z + lift * size * 0.34, grow);
      const x = span(d);
      const reachR = Math.max((x + me.c) * kAt(me.z + me.e), (x + me.c) * kAt(me.z - me.e));
      const reachL = Math.min((x - me.c) * kAt(me.z + me.e), (x - me.c) * kAt(me.z - me.e));
      const gap = GAP * size;
      const r = shapeAt(d + 1);
      const l = shapeAt(d - 1);
      pushR = Math.max(0, r.c + (reachR + gap) / kAt(r.z - r.e) - span(d + 1));
      pushL = Math.max(0, l.c + (-reachL + gap) / kAt(l.z - l.e) + span(d - 1));
      pushAt = i;
    }
    for (let i = 0; i < items.length; i += 1) {
      const d = i - pos;
      const ad = Math.abs(d);
      const el = items[i];
      if (ad > 9) {
        el.style.visibility = "hidden";
        continue;
      }
      el.style.visibility = "visible";
      const p = pose(d);
      const near = p.near;
      const shift = pushAt < 0 || i === pushAt ? 0 : i > pushAt ? pushR : -pushL;
      const x = span(d) + shift;
      const rot = -Math.sign(d) * p.th;
      const f = flipA[i] / 180;
      const lift = Math.sin(Math.PI * clamp(f, 0, 1));
      const grow = 1 + 0.1 * clamp(f, 0, 1) * (1 - near);
      const z = p.z + lift * size * 0.34;
      const turn = rot + flipA[i];
      el.style.transform = `translate3d(${x.toFixed(2)}px,0,${z.toFixed(2)}px) rotateY(${turn.toFixed(2)}deg) scale(${grow.toFixed(4)})`;
      el.style.zIndex = String(1000 - Math.round(ad * 10) + (f > 0.001 ? 20 : 0));
      el.style.setProperty("--cf-shade", (near * 0.42 + Math.max(0, ad - 1) * 0.06).toFixed(3));
      el.style.setProperty("--cf-dir", d >= 0 ? "90deg" : "270deg");
      const gf = glint(turn);
      const gb = glint(turn - 180);
      el.style.setProperty("--cf-gf", gf.at.toFixed(3));
      el.style.setProperty("--cf-gfo", gf.o.toFixed(3));
      el.style.setProperty("--cf-gb", gb.at.toFixed(3));
      el.style.setProperty("--cf-gbo", gb.o.toFixed(3));
    }
    if (thumb && scrub) {
      const travel = scrub.clientWidth - thumb.offsetWidth;
      thumb.style.transform = `translateX(${((clamp(pos, 0, last) / Math.max(1, last)) * travel).toFixed(2)}px)`;
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

  const goTo = (i, dir = 0) => {
    target = clamp(snap(i, dir), 0, last);
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
    drag = { id: e.pointerId, x: e.clientX, lastX: e.clientX, t: performance.now(), base: pos, moved: 0, item: e.target.closest("[data-cf-item]"), onButton: !!e.target.closest("button"), captured: false, dir: 0 };
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
    if (Math.abs(raw - pos) > 0.0001) drag.dir = Math.sign(raw - pos);
    pos = raw;
    if (drag.moved > 5 && flipped >= 0) setFlip(-1);
    paint();
    kick();
  };

  const onUp = (e) => {
    if (scrubbing) {
      scrubbing = false;
      root.dataset.scrub = "false";
      goTo(target, scrubDir);
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    const { moved, item, onButton, dir } = drag;
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
    if (idle || Math.sign(vel) !== dir) vel = 0;
    vel = clamp(vel, -MAX_SPEED, MAX_SPEED);
    const reach = clamp(vel * 0.32, -5, 5);
    const coast = Math.abs(vel) / OMEGA;
    goTo(pos + Math.sign(reach || dir) * Math.max(Math.abs(reach), coast), vel ? Math.sign(vel) : dir);
  };

  const scrubTo = (clientX) => {
    const r = scrub.getBoundingClientRect();
    const f = clamp((clientX - r.left - thumb.offsetWidth / 2) / (r.width - thumb.offsetWidth), 0, 1);
    if (Math.abs(f * last - target) > 0.0001) scrubDir = Math.sign(f * last - target);
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
    wheelDir = Math.sign(delta);
    wheelTimer = setTimeout(() => goTo(target, wheelDir), 140);
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

  const setCount = (n) => {
    items = [...root.querySelectorAll("[data-cf-item]")];
    if (n !== count) {
      const a = new Float64Array(n);
      const v = new Float64Array(n);
      a.set(flipA.subarray(0, Math.min(n, count)));
      v.set(flipV.subarray(0, Math.min(n, count)));
      flipA = a;
      flipV = v;
      count = n;
      last = n - 1;
      if (flipped > last) setFlip(-1);
      target = clamp(Math.round(target), 0, last);
      root.dataset.swap = "true";
      clearTimeout(swapTimer);
      swapTimer = setTimeout(() => {
        root.dataset.swap = "false";
      }, 700);
    }
    paint();
    kick();
  };

  return {
    goTo,
    toggle,
    setCount,
    step: (n) => goTo(Math.round(target) + n),
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(wheelTimer);
      clearTimeout(swapTimer);
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
