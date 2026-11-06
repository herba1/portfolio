// Optical: one paragraph that redraws itself as it is zoomed.
//
// The zoom is real type, not a scaled bitmap: every frame the paragraph is
// re-set at the new pixel size, with opsz pinned to that size and tracking
// from the house law. The line breaks are fixed, so the block grows in place
// instead of rewrapping, and the point under the pointer stays put.

const LINES = [
  "Reading is mostly not seeing. The eye",
  "lands, skips and lands again, three or",
  "four times a second, and the mind fills",
  "each gap with what it expects to find.",
  "A good page asks nothing of you. The",
  "letters are doing their work only when",
  "you have forgotten that they are there.",
];

const S_MIN = 6.5;
const S_MAX = 420;
const OPSZ_MIN = 6;
const OPSZ_MAX = 72;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const lawPx = (s) => -0.043 * (s - 12);

// Leading opens at caption sizes and closes at display sizes; whole pixels.
function leading(s) {
  const t = clamp((Math.log(s) - Math.log(8)) / (Math.log(120) - Math.log(8)), 0, 1);
  const r = lerp(1.5, 1.06, t * t * (3 - 2 * t));
  return Math.round(s * r);
}

function readParams() {
  try {
    const q = new URLSearchParams(window.location.search);
    return { z: parseFloat(q.get("z")), x: parseFloat(q.get("x")), y: parseFloat(q.get("y")) };
  } catch {
    return {};
  }
}

export async function createOptical(host, { embedded = false, family = "serif" } = {}) {
  const params = readParams();
  const block = document.createElement("div");
  block.className = "opt-block";
  const text = document.createElement("p");
  text.className = "opt-text";
  for (const line of LINES) {
    const row = document.createElement("span");
    row.className = "opt-line";
    row.textContent = line;
    text.appendChild(row);
  }
  block.append(text);
  host.appendChild(block);

  const stylePara = (el, s, opsz) => {
    el.style.fontFamily = family;
    el.style.fontSize = `${s}px`;
    el.style.lineHeight = `${leading(s)}px`;
    el.style.letterSpacing = `${lawPx(s).toFixed(3)}px`;
    el.style.fontVariationSettings = `"opsz" ${opsz.toFixed(2)}`;
  };

  try {
    await document.fonts.load(`32px ${family}`);
  } catch {}

  let W = host.clientWidth;
  let H = host.clientHeight;
  const box = host.closest(".piece-box") || host;
  const ro = new ResizeObserver(() => {
    W = host.clientWidth;
    H = host.clientHeight;
    wake();
  });
  ro.observe(box);

  // Resting size: a comfortable reading size for the box.
  const restSize = clamp(Math.min(W / 22, H / 12), 9, 22);
  const startSize = Number.isFinite(params.z) ? clamp(params.z, S_MIN, S_MAX) : embedded ? restSize : restSize * 0.72;

  // Zoom lives in log space so a flick feels the same at every size.
  let L = Math.log(startSize);
  let Lv = 0;
  let Lt = Number.isFinite(params.z) ? L : Math.log(restSize);
  let omega = Number.isFinite(params.z) ? 14 : 3.6;

  // Anchor: a point in the block (u, v as fractions of its box) pinned to a
  // point on screen (ax, ay). Correction (cx, cy) is a soft spring that keeps
  // the paragraph from being lost off the edge once you stop.
  let w = 0;
  let h = 0;
  let u = 0.5;
  let v = 0.5;
  let ax = W * (Number.isFinite(params.x) ? params.x : 0.5);
  let ay = H * (Number.isFinite(params.y) ? params.y : 0.5);
  let cx = 0;
  let cy = 0;
  let cvx = 0;
  let cvy = 0;
  let x = 0;
  let y = 0;
  let lastInput = -1e9;

  const measure = () => {
    w = text.offsetWidth;
    h = text.offsetHeight;
  };

  const layout = () => {
    const s = Math.exp(L);
    const opsz = clamp(s, OPSZ_MIN, OPSZ_MAX);
    stylePara(text, s, opsz);
    measure();
    x = ax - u * w + cx;
    y = ay - v * h + cy;
    block.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
  };

  const setAnchor = (px, py) => {
    // Fold the current correction into the anchor so nothing jumps.
    u = w ? (px - x) / w : 0.5;
    v = h ? (py - y) / h : 0.5;
    ax = px;
    ay = py;
    cx = cy = cvx = cvy = 0;
  };

  const input = () => {
    lastInput = performance.now();
    wake();
  };

  const local = (e) => {
    const r = host.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  // Wheel: pinch on a trackpad arrives as ctrl+wheel. On its own page plain
  // scroll zooms too; as a tile it leaves page scroll alone.
  const onWheel = (e) => {
    if (embedded && !e.ctrlKey) return;
    e.preventDefault();
    const [px, py] = local(e);
    setAnchor(px, py);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1;
    const k = e.ctrlKey ? 0.011 : 0.0024;
    Lt = clamp(Lt - e.deltaY * unit * k, Math.log(S_MIN), Math.log(S_MAX));
    omega = 16;
    input();
  };

  const pointers = new Map();
  let drag = null;
  const startGesture = () => {
    const pts = [...pointers.values()];
    if (pts.length === 1) {
      setAnchor(pts[0][0], pts[0][1]);
      drag = { kind: "drag", y0: pts[0][1], L0: Lt, t: performance.now(), lastY: pts[0][1], vel: 0 };
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      setAnchor(mx, my);
      drag = { kind: "pinch", d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, L0: Lt };
    }
  };
  const onDown = (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    host.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, local(e));
    startGesture();
    omega = 30;
    input();
  };
  const onMove = (e) => {
    if (!pointers.has(e.pointerId) || !drag) return;
    pointers.set(e.pointerId, local(e));
    const pts = [...pointers.values()];
    if (drag.kind === "drag" && pts.length === 1) {
      const py = pts[0][1];
      const now = performance.now();
      const dt = Math.max(1, now - drag.t);
      drag.vel = lerp(drag.vel, (drag.lastY - py) / dt, 0.35);
      drag.lastY = py;
      drag.t = now;
      Lt = clamp(drag.L0 + (drag.y0 - py) * 0.0075, Math.log(S_MIN), Math.log(S_MAX));
    } else if (drag.kind === "pinch" && pts.length >= 2) {
      const [a, b] = pts;
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      ax = (a[0] + b[0]) / 2;
      ay = (a[1] + b[1]) / 2;
      Lt = clamp(drag.L0 + Math.log(d / drag.d0), Math.log(S_MIN), Math.log(S_MAX));
    }
    input();
  };
  const onUp = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (drag?.kind === "drag" && pointers.size === 0) {
      // Carry the flick a little way, then let the spring settle it.
      const fresh = performance.now() - drag.t < 80 ? drag.vel : 0;
      Lt = clamp(Lt + fresh * 0.0075 * 140, Math.log(S_MIN), Math.log(S_MAX));
    }
    omega = 11;
    if (pointers.size) startGesture();
    else drag = null;
    input();
  };

  host.addEventListener("wheel", onWheel, { passive: false });
  host.addEventListener("pointerdown", onDown);
  host.addEventListener("pointermove", onMove);
  host.addEventListener("pointerup", onUp);
  host.addEventListener("pointercancel", onUp);

  // Gesture-safety: Safari pinch on a desktop trackpad.
  const onGesture = (e) => e.preventDefault();
  host.addEventListener("gesturestart", onGesture);

  layout();
  // First frame: centre the block on the anchor point.
  setAnchor(ax, ay);
  u = 0.5;
  v = 0.5;
  layout();

  let raf = 0;
  let prev = 0;
  let running = false;
  const frame = (t) => {
    const dt = Math.min(0.05, prev ? (t - prev) / 1000 : 1 / 60);
    prev = t;
    // Critically damped spring on log size, substepped.
    const n = 4;
    const h0 = dt / n;
    for (let i = 0; i < n; i++) {
      const a = omega * omega * (Lt - L) - 2 * omega * Lv;
      Lv += a * h0;
      L += Lv * h0;
    }

    // Soft bounds once input stops.
    const idle = t - lastInput > 140 && !drag;
    let tx = cx;
    let ty = cy;
    if (idle) {
      const m = Math.min(W, H) * 0.08;
      const bx = ax - u * w;
      const by = ay - v * h;
      const fit = (pos, size, span) => {
        if (size <= span - 2 * m) return clamp(pos, m, span - m - size);
        return clamp(pos, span - m - size, m);
      };
      tx = fit(bx, w, W) - bx;
      ty = fit(by, h, H) - by;
    }
    const k = 9;
    for (let i = 0; i < n; i++) {
      cvx += (k * k * (tx - cx) - 2 * k * cvx) * h0;
      cvy += (k * k * (ty - cy) - 2 * k * cvy) * h0;
      cx += cvx * h0;
      cy += cvy * h0;
    }

    layout();

    const still = Math.abs(Lt - L) < 0.002 && Math.abs(Lv) < 0.01 && Math.abs(tx - cx) < 0.3 && Math.abs(cvx) + Math.abs(cvy) < 2;
    if (still && idle) {
      running = false;
      prev = 0;
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  function wake() {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }
  // The intro zoom (own page, no ?z) shows the redesign before anyone touches it.
  setTimeout(wake, Number.isFinite(params.z) ? 0 : 500);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      host.removeEventListener("gesturestart", onGesture);
      block.remove();
    },
  };
}
