// Landscape engine: a camera flying through planes of real DOM text.
//
// Every plane carries a world matrix (its owner's, then its own offset,
// turn and scale). Each frame the camera's view and the CSS perspective are
// folded into one plane-to-screen homography per plane, written as a
// matrix3d; no preserve-3d, so we sort the layers ourselves. When the camera
// rests on a viewpoint the framed plane faces it at exactly its authored
// size, the homography's perspective row vanishes, and it is written as a
// plain 2D matrix(), so the text is painted flat and crisp.

import { PLANES, VIEWS } from "./landscapeContent";

const DIST = 1000; // perspective distance in px: a plane at DIST x s reads at true size
const DEG = Math.PI / 180;

/* ---------- small column-major mat4 / quat kit ---------- */

const mul = (a, b) => {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
};
const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const trans = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const scl = (s) => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
const rotX = (a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
};
const rotY = (a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
};
const apply = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

function quatFromMat(m) {
  const r00 = m[0], r10 = m[1], r20 = m[2], r01 = m[4], r11 = m[5], r21 = m[6], r02 = m[8], r12 = m[9], r22 = m[10];
  const tr = r00 + r11 + r22;
  let w, x, y, z;
  if (tr > 0) {
    const S = Math.sqrt(tr + 1) * 2;
    w = 0.25 * S; x = (r21 - r12) / S; y = (r02 - r20) / S; z = (r10 - r01) / S;
  } else if (r00 > r11 && r00 > r22) {
    const S = Math.sqrt(1 + r00 - r11 - r22) * 2;
    w = (r21 - r12) / S; x = 0.25 * S; y = (r01 + r10) / S; z = (r02 + r20) / S;
  } else if (r11 > r22) {
    const S = Math.sqrt(1 + r11 - r00 - r22) * 2;
    w = (r02 - r20) / S; x = (r01 + r10) / S; y = 0.25 * S; z = (r12 + r21) / S;
  } else {
    const S = Math.sqrt(1 + r22 - r00 - r11) * 2;
    w = (r10 - r01) / S; x = (r02 + r20) / S; y = (r12 + r21) / S; z = 0.25 * S;
  }
  const n = Math.hypot(w, x, y, z);
  return [w / n, x / n, y / n, z / n];
}

function slerp(a, b, t) {
  let [aw, ax, ay, az] = a;
  let [bw, bx, by, bz] = b;
  let d = aw * bw + ax * bx + ay * by + az * bz;
  if (d < 0) { bw = -bw; bx = -bx; by = -by; bz = -bz; d = -d; }
  if (d > 0.99995) {
    const q = [aw + (bw - aw) * t, ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t];
    const n = Math.hypot(...q);
    return q.map((v) => v / n);
  }
  const th = Math.acos(d), sn = Math.sin(th);
  const ka = Math.sin((1 - t) * th) / sn, kb = Math.sin(t * th) / sn;
  return [aw * ka + bw * kb, ax * ka + bx * kb, ay * ka + by * kb, az * ka + bz * kb];
}

function matFromQuat([w, x, y, z]) {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const snapNum = (v, to) => (Math.abs(v - to) < 1e-6 ? to : v);
const f = (v) => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(7));

/* ---------- engine ---------- */

export function createLandscape(root, { embedded = false } = {}) {
  const box = root.closest(".piece-box") || root;
  const byId = new Map();
  const planes = PLANES.map((p) => {
    const el = root.querySelector(`.ls-plane[data-id="${p.id}"]`);
    const node = { ...p, el, w: el.offsetWidth, h: el.offsetHeight, last: {} };
    byId.set(p.id, node);
    return node;
  });

  // World matrices, owners first (PLANES is authored in that order).
  for (const p of planes) {
    const owner = p.parent ? byId.get(p.parent) : null;
    const base = owner ? owner.W : ident();
    p.s = (owner ? owner.s : 1) * p.rel;
    p.W = mul(base, mul(trans(...p.at), mul(rotY(p.turn[1] * DEG), mul(rotX(p.turn[0] * DEG), scl(p.rel)))));
    const R = p.W.map((v, i) => (i % 4 < 3 && i < 12 ? v / p.s : i === 15 ? 1 : 0));
    p.q = quatFromMat(R);
  }

  const views = VIEWS.map((v) => {
    const p = byId.get(v.plane);
    // chapters and entries sit left of centre so their children show beside them
    const lean = { chapter: [170, 44], entry: [120, 8] }[p.kind] || [0, 0];
    const [fx, fy] = v.frame || [p.w / 2 + lean[0], p.h / 2 + lean[1]];
    return { plane: p, G: apply(p.W, fx, fy, 0), s: p.s, l: Math.log(p.s), q: p.q };
  });
  const N = views.length;

  /* camera on the path, at fractional viewpoint t */
  function camera(t) {
    t = clamp(t, 0, N - 1);
    let k = Math.floor(t);
    if (k >= N - 1) k = N - 2;
    const e = t - k;
    const a = views[k], b = views[k + 1];
    const dl = b.l - a.l;
    let s = Math.exp(a.l + dl * e);
    // Zoom about a fixed point: the target slides in step with the scale.
    const u = Math.abs(dl) > 0.05 ? (a.s - s) / (a.s - b.s) : e;
    const G = [0, 1, 2].map((i) => a.G[i] + (b.G[i] - a.G[i]) * u);
    // A long move at one scale pulls back to see where it is going.
    const gap = Math.hypot(b.G[0] - a.G[0], b.G[1] - a.G[1], b.G[2] - a.G[2]);
    const reach = gap / (DIST * Math.max(a.s, b.s));
    const lift = 0.6 * Math.log(1 + Math.max(0, reach - 0.35));
    s *= Math.exp(lift * Math.sin(Math.PI * e));
    const q = slerp(a.q, b.q, e * e * (3 - 2 * e));
    return { G, s, R: matFromQuat(q) };
  }

  let fit = 1;
  function measure() {
    const r = box.getBoundingClientRect();
    fit = clamp(Math.min(r.width / 1180, r.height / 740), 0.42, 1);
    dirty = true;
    kick();
  }

  function render(t) {
    const { G, s, R } = camera(t);
    const Ds = DIST * s;
    const C = [G[0] + R[8] * Ds, G[1] + R[9] * Ds, G[2] + R[10] * Ds];
    // View: camera space = R^T (p - C), then the eye moved to z = DIST.
    const V = [
      R[0], R[4], R[8], 0,
      R[1], R[5], R[9], 0,
      R[2], R[6], R[10], 0,
      -(R[0] * C[0] + R[1] * C[1] + R[2] * C[2]),
      -(R[4] * C[0] + R[5] * C[1] + R[6] * C[2]),
      -(R[8] * C[0] + R[9] * C[1] + R[10] * C[2]) + DIST,
      1,
    ];
    const P = [fit, 0, 0, 0, 0, fit, 0, 0, 0, 0, 1, -1 / DIST, 0, 0, 0, 1];
    const VP = mul(P, V);

    const order = [];
    for (const p of planes) {
      const M = mul(VP, p.W);
      // plane (x, y) -> screen, as a 3x3 homography (rows x, y, w)
      let a = M[0], b = M[1], hx = M[3];
      let c = M[4], d = M[5], hy = M[7];
      let e = M[12], g = M[13], hw = M[15];
      const wAt = (x, y) => hx * x + hy * y + hw;
      const wc = wAt(p.w / 2, p.h / 2);
      const wMin = Math.min(wAt(0, 0), wAt(p.w, 0), wAt(0, p.h), wAt(p.w, p.h));
      const st = p.last;
      // depth of the plane centre is DIST x wc; r is how far it sits from
      // the distance at which it reads at true size (log2, 0 = true size).
      const lr = Math.log2(wc / p.s);
      let op = 0;
      if (wMin > 0.04 * s && wc > 0) {
        op = lr < 0 ? smooth(-1.3, -0.15, lr) : 1 - 0.76 * smooth(0.08, 2.4, lr);
        op *= 1 - smooth(4.6, 6.4, lr);
      }
      // out-of-focus layers also thin out, as Cooper's distant planes did
      // circle of confusion, softer in front of focus than behind it
      const coc = Math.min(10, (wc < s ? 4 : 7) * Math.abs(1 - s / wc));
      op *= 1 - 0.55 * smooth(1.2, 7, coc);
      if (op < 0.01) {
        if (st.vis !== "hidden") p.el.style.visibility = st.vis = "hidden";
        continue;
      }
      if (st.vis !== "visible") p.el.style.visibility = st.vis = "visible";

      // Normalise, and land on an exact flat 2D matrix when facing the camera.
      a /= hw; b /= hw; c /= hw; d /= hw; e /= hw; g /= hw; hx /= hw; hy /= hw;
      let tf;
      if (Math.abs(hx) < 1e-9 && Math.abs(hy) < 1e-9) {
        a = snapNum(a, fit); d = snapNum(d, fit); b = snapNum(b, 0); c = snapNum(c, 0);
        tf = `matrix(${f(a)},${f(b)},${f(c)},${f(d)},${f(e)},${f(g)})`;
      } else {
        tf = `matrix3d(${f(a)},${f(b)},0,${hx},${f(c)},${f(d)},0,${hy},0,0,1,0,${f(e)},${f(g)},0,1)`;
      }
      if (st.tf !== tf) p.el.style.transform = st.tf = tf;

      const opS = op > 0.995 ? "" : op.toFixed(3);
      if (st.op !== opS) p.el.style.opacity = st.op = opS;

      // Depth of field around the camera's focus distance, in screen px,
      // converted to the plane's own px for the filter.
      const sc = (p.s / wc) * fit;
      let fl = "";
      if (coc > 0.3 && sc > 0.06) fl = `blur(${Math.min(40, coc / sc).toFixed(2)}px)`;
      if (st.fl !== fl) p.el.style.filter = st.fl = fl;

      order.push([wc, p]);
    }
    order.sort((x, y) => y[0] - x[0]);
    order.forEach(([, p], i) => {
      const z = String(i + 1);
      if (p.last.z !== z) p.el.style.zIndex = p.last.z = z;
    });
  }

  /* ---------- spring camera ---------- */

  const params = new URLSearchParams(location.search);
  const held = params.has("v") ? clamp(parseFloat(params.get("v")) || 0, 0, N - 1) : null;
  let pos = held ?? 0;
  let target = pos;
  let anchor = Math.round(pos);
  let vel = 0;
  let raf = 0;
  let dirty = true;
  let lastT = 0;
  const K = 44, C = 2 * Math.sqrt(K) * 0.92;

  function frame(now) {
    raf = 0;
    const dt = Math.min(1 / 30, lastT ? (now - lastT) / 1000 : 1 / 60);
    lastT = now;
    const steps = 4, h = dt / steps;
    for (let i = 0; i < steps; i++) {
      vel += (K * (target - pos) - C * vel) * h;
      pos += vel * h;
    }
    const settled = Math.abs(target - pos) < 2e-4 && Math.abs(vel) < 2e-3;
    if (settled) { pos = target; vel = 0; }
    render(pos);
    root.toggleAttribute("data-settled", settled);
    if (!settled || dirty) {
      dirty = false;
      raf = requestAnimationFrame(frame);
    } else lastT = 0;
  }
  function kick() {
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function go(t) {
    target = clamp(t, 0, N - 1);
    kick();
  }
  function settleFrom(proj) {
    let to = clamp(Math.round(proj), 0, N - 1);
    if (to === anchor && Math.abs(proj - anchor) > 0.14) to = clamp(anchor + Math.sign(proj - anchor), 0, N - 1);
    anchor = to;
    go(to);
  }

  /* wheel */
  let wheelTimer = 0;
  function onWheel(ev) {
    let dy = ev.deltaY + ev.deltaX * 0.5;
    if (ev.deltaMode === 1) dy *= 16;
    if (embedded && ((target <= 0 && dy < 0) || (target >= N - 1 && dy > 0))) return;
    ev.preventDefault();
    go(target + dy * 0.0021);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => settleFrom(target), 150);
  }

  /* drag */
  let drag = null;
  function onDown(ev) {
    if (ev.button !== 0) return;
    root.focus({ preventScroll: true });
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, t0: target, moved: 0, samples: [[performance.now(), target]] };
    root.setPointerCapture(ev.pointerId);
    root.setAttribute("data-grabbing", "");
  }
  function onMove(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
    const span = box.getBoundingClientRect().height * 0.6;
    go(drag.t0 - (dy + dx * 0.6) / span);
    drag.samples.push([performance.now(), target]);
    if (drag.samples.length > 6) drag.samples.shift();
  }
  function onUp(ev) {
    if (!drag || ev.pointerId !== drag.id) return;
    root.removeAttribute("data-grabbing");
    const d = drag;
    drag = null;
    if (d.moved < 5) {
      // a tap on a plane flies to it
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".ls-plane");
      let p = el && byId.get(el.dataset.id);
      while (p) {
        const hits = views.map((v, i) => (v.plane === p ? i : -1)).filter((i) => i >= 0);
        if (hits.length) {
          const best = hits.reduce((x, y) => (Math.abs(y - pos) < Math.abs(x - pos) ? y : x));
          anchor = best;
          go(best);
          return;
        }
        p = p.parent && byId.get(p.parent);
      }
      settleFrom(target);
      return;
    }
    const [t1, v1] = d.samples[0], [t2, v2] = d.samples[d.samples.length - 1];
    const v = t2 > t1 ? ((v2 - v1) / (t2 - t1)) * 1000 : 0;
    settleFrom(target + clamp(v, -6, 6) * 0.2);
  }

  /* keys */
  function onKey(ev) {
    const next = ["ArrowDown", "ArrowRight", "PageDown", " ", "j"];
    const prev = ["ArrowUp", "ArrowLeft", "PageUp", "k"];
    let to = null;
    if (next.includes(ev.key)) to = anchor + 1;
    else if (prev.includes(ev.key)) to = anchor - 1;
    else if (ev.key === "Home") to = 0;
    else if (ev.key === "End") to = N - 1;
    if (to === null) return;
    ev.preventDefault();
    anchor = clamp(to, 0, N - 1);
    go(anchor);
  }

  root.addEventListener("wheel", onWheel, { passive: false });
  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  root.addEventListener("keydown", onKey);
  const ro = new ResizeObserver(measure);
  ro.observe(box);
  measure();

  return {
    destroy() {
      cancelAnimationFrame(raf);
      clearTimeout(wheelTimer);
      ro.disconnect();
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("pointercancel", onUp);
      root.removeEventListener("keydown", onKey);
    },
  };
}
