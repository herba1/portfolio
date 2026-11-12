// Landscape engine: a camera flying through planes of real DOM text.
//
// Every plane carries a world matrix (its owner's, then its own offset and
// scale), solved from where it should read in its owner's poster. Each frame
// the camera's view and the CSS perspective are folded into one
// plane-to-screen homography per plane, written as a matrix3d; no
// preserve-3d, so we sort the layers ourselves. When the camera rests on a
// viewpoint every plane faces it, the homography's perspective row vanishes,
// and it is written as a plain 2D matrix(), so the text is painted flat and
// crisp, and the framed plane sits at exactly its authored size.
//
// The grid: every viewpoint puts the left end of its plane's first baseline
// on one margin and one baseline, so each stop is cropped the same way.

import { PLANES, VIEWS } from "./landscapeContent";

const DIST = 1000; // perspective distance in px: a plane at DIST x s reads at true size
const DEG = Math.PI / 180;
// The grid, in design px: a margin column and a hanging baseline.
const MARGIN = 96;
const BASELINE = 0.26; // of the frame's height, from the top
const GAP = 24; // between a plane's last line and the next level, when framed
// The reference frame the placements are authored against (fit = 1).
const REF = { w: 1280, h: 800 };
// Projected-size cull: below CAP_MIN screen px of cap height a line
// collapses to a solid bar of ink the length of the line; a plane whose
// largest bar is thinner than a hairline goes.
const CAP = 0.7; // cap height / font size, Geist and Geist Mono
const CAP_MIN = 6;
const BAR = 0.42; // bar thickness / font size, a little under the x-height
// What the frame may crop, by rendered size in design px: copy under
// DISPLAY goes as soon as it touches an edge, display type must stand almost
// wholly in frame, and only GIANT type may run hard off an edge.
const DISPLAY = 64;
const GIANT = 160;
// In transit the camera swings round the point it is flying to, so the
// layers part in parallax; it is square on again when it settles.
const SWING = [16, -7]; // degrees [about y, about x], alternating per leg

/* ---------- small column-major mat4 kit ---------- */

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
export const apply = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const snapNum = (v, to) => (Math.abs(v - to) < 1e-6 ? to : v);
const f = (v) => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(7));

/* ---------- engine ---------- */

// The grid in a frame of w x h screen px at the given fit: the screen point
// (from the centre, design px) of the margin and the baseline.
export const grid = (w, h, fit) => [-w / (2 * fit) + MARGIN, -h / (2 * fit) + (BASELINE * h) / fit];

// Read each text line's extent so it can collapse to a bar, and the plane's
// first baseline. Runs before any transform is written.
function measurePlane(el) {
  const box = el.getBoundingClientRect();
  const texts = [...el.querySelectorAll("p, h2, h3, h4")];
  const layer = document.createElement("div");
  layer.className = "ls-bars";
  layer.setAttribute("aria-hidden", "true");
  let bl = null;
  const parts = texts.map((t) => {
    const fs = parseFloat(getComputedStyle(t).fontSize);
    const mark = document.createElement("span");
    mark.className = "ls-mark";
    t.prepend(mark);
    const base = mark.getBoundingClientRect().bottom - box.top;
    mark.remove();
    if (bl === null) bl = base;
    const range = document.createRange();
    range.selectNodeContents(t);
    const lines = [];
    for (const r of range.getClientRects()) {
      if (r.width < 0.5) continue;
      const line = lines.find((l) => Math.abs(l.b - r.bottom) < fs * 0.5);
      if (line) {
        line.l = Math.min(line.l, r.left);
        line.r = Math.max(line.r, r.right);
      } else lines.push({ l: r.left, r: r.right, b: r.bottom });
    }
    // the first line's baseline sits this far above its glyph box's foot
    const drop = lines.length ? lines[0].b - box.top - base : 0;
    const g = document.createElement("div");
    g.className = "ls-bar-g";
    for (const l of lines) {
      const bar = document.createElement("i");
      const y = l.b - box.top - drop; // baseline
      bar.style.cssText = `left:${(l.l - box.left).toFixed(1)}px;top:${(y - fs * BAR).toFixed(1)}px;width:${(l.r - l.l).toFixed(1)}px;height:${(fs * BAR).toFixed(1)}px`;
      g.appendChild(bar);
    }
    layer.appendChild(g);
    // the lines' extent, plane px, for the edge test
    const ext = lines.length
      ? [Math.min(...lines.map((l) => l.l)) - box.left, lines[0].b - box.top - drop - fs * CAP, Math.max(...lines.map((l) => l.r)) - box.left, lines[lines.length - 1].b - box.top]
      : [0, 0, 0, 0];
    return { t, g, fs, cap: fs * CAP, ext, last: {} };
  });
  el.appendChild(layer);
  return { parts, bl: bl ?? 0, layer, big: Math.max(...parts.map((p) => p.fs)) };
}

// When the camera frames a child, its owner stands behind it A times its
// own size.
const behind = (p) => 1 / (1 + p.rel - p.rel / p.k);

// The baseline drop of a plane below its owner's, in the owner's poster.
//   "below": low enough that when the camera frames this plane, the owner's
//     last line, now behind it A times its size, clears its first line.
//   "after": hung under the sibling before it (same depth), low enough to
//     clear that sibling and its own note in every poster they share.
function drop(p, owner, planes) {
  if (typeof p.dy === "number") return p.dy;
  if (p.dy === "below") return ((owner.h - owner.bl + (GAP + p.bl) / behind(p)) * p.k) / p.rel;
  const kin = planes.filter((q) => q.parent === p.parent);
  const prev = kin[kin.indexOf(p) - 1];
  const at = prev.dropped ?? drop(prev, owner, planes);
  // in the previous sibling's poster, the gap it needs below that baseline
  let need = prev.h - prev.bl + GAP;
  const note = planes.find((q) => q.parent === prev.id);
  if (note) {
    const dn = drop(note, prev, planes);
    const tail = note.h - note.bl + GAP;
    // framed on the sibling: the note hangs dn below and must clear it
    need = Math.max(need, dn + note.k * tail);
    // framed on the note: this plane passes behind, (r/k)A times further off
    need = Math.max(need, dn + (tail + p.bl * behind(note)) / ((note.rel / note.k) * behind(note)));
  }
  return at + p.k * (need + p.bl);
}

// World matrices, owners first (PLANES is authored in that order). A plane
// is placed so that, from its owner's viewpoint in the reference frame, it
// reads at k times its true size with its first baseline at (dx, dy) from
// the owner's. Its depth z (owner px, toward the viewer) is what makes it
// read at k; its x, y are found along the camera ray. Pure, so it can be
// checked outside the page.
export function placePlanes(planes, byId) {
  const [rx, ry] = grid(REF.w, REF.h, 1);
  for (const p of planes) {
    const owner = p.parent ? byId.get(p.parent) : null;
    if (!owner) {
      p.s = p.rel;
      p.W = scl(p.rel);
      continue;
    }
    const r = p.rel;
    const z = DIST * (1 - r / p.k);
    const dy = (p.dropped = drop(p, owner, planes));
    // the owner's camera: its frame point is (-rx, bl - ry), at distance DIST
    const toWorld = (DIST - z) / DIST;
    const sx = rx + p.dx, sy = ry + dy - p.k * p.bl; // child's top-left on screen
    const x = -rx + sx * toWorld;
    const y = owner.bl - ry + sy * toWorld;
    p.s = owner.s * r;
    p.W = mul(owner.W, mul(trans(x, y, z), scl(r)));
  }
}

export function createLandscape(root, { embedded = false } = {}) {
  const box = root.closest(".piece-box") || root;
  const byId = new Map();
  const planes = PLANES.map((p) => {
    const el = root.querySelector(`.ls-plane[data-id="${p.id}"]`);
    const node = { ...p, el, w: el.offsetWidth, h: el.offsetHeight, last: {}, ...measurePlane(el) };
    byId.set(p.id, node);
    return node;
  });

  placePlanes(planes, byId);

  let views = [];
  const N = VIEWS.length;
  function frameViews(w, h) {
    const [gx, gy] = grid(w, h, fit);
    views = VIEWS.map((v) => {
      const p = byId.get(v.plane);
      return { plane: p, G: apply(p.W, -gx, p.bl - gy, 0), s: p.s, l: Math.log(p.s) };
    });
  }

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
    const arc = Math.sin(Math.PI * e);
    const lift = 0.6 * Math.log(1 + Math.max(0, reach - 0.35));
    s *= Math.exp(lift * arc);
    // ...and swings round it, one way then the other, square again at rest.
    const side = k % 2 ? -1 : 1;
    const R = mul(rotY(SWING[0] * DEG * side * arc), rotX(SWING[1] * DEG * arc));
    return { G, s, R };
  }

  let fit = 1;
  let half = [0, 0];
  function measure() {
    const r = box.getBoundingClientRect();
    half = [r.width / 2, r.height / 2];
    fit = clamp(Math.min(r.width / 1180, r.height / 740), 0.42, 1);
    frameViews(r.width, r.height);
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
      // depth of the plane centre is DIST x wc, and the camera is focused at
      // DIST x s; lr is how far in front of the focus it stands (log2).
      const lr = Math.log2(wc / s);
      // screen px per plane px, at the plane's centre
      const sc = wc > 0 ? (p.s / wc) * fit : 0;
      // Depth is not fading: every plane keeps its flat ink at any distance,
      // and recession reads as scale and multiply overlap. Only a plane the
      // camera is about to pass through clears out of the way (an owner far
      // behind may stand huge and cropped), and one so far off that even its
      // bars are thinner than a hairline goes.
      let op = 0;
      if (wMin > 0.04 * s && wc > 0) op = smooth(-1.7, -1.1, lr) * smooth(0.6, 0.66, p.big * BAR * sc);
      p.keep = 0;
      p.sc = 0;
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

      // Projected-size cull, line by line: type whose cap height on screen
      // drops under CAP_MIN px gives way to a bar of its own ink, so far
      // levels read as clean colour shapes instead of specks.
      // The other way, an owner standing far behind and blown up keeps only
      // its display line, as a cropped field of colour; its small copy at
      // that size would only read as torn-off words.
      const blown = 1 - smooth(1.26, 1.32, sc / fit);
      const proj = (x, y) => {
        const w = hx * x + hy * y + 1;
        return [(a * x + c * y + e) / w, (b * x + d * y + g) / w];
      };
      // how much of a part's lines' box is in frame: [of its area, of its height]
      const inFrame = (part) => {
        const [x0, y0, x1, y1] = part.ext;
        const q = [proj(x0, y0), proj(x1, y0), proj(x0, y1), proj(x1, y1)];
        const l = Math.min(...q.map((v) => v[0])), r = Math.max(...q.map((v) => v[0]));
        const t = Math.min(...q.map((v) => v[1])), u = Math.max(...q.map((v) => v[1]));
        const iw = Math.max(0, Math.min(r, half[0]) - Math.max(l, -half[0])) / Math.max(1e-6, r - l);
        const ih = Math.max(0, Math.min(u, half[1]) - Math.max(t, -half[1])) / Math.max(1e-6, u - t);
        return [iw * ih, ih];
      };
      // Cropping is all or nothing. Only giant type may run hard off an edge
      // (and never sliced down to a sliver of its height); every other plane
      // either stands wholly in frame or goes as one, so no plane leaves a
      // stray date, a torn-off line or a sliced heading at the border. A
      // note goes with its entry when both are far context, so no note is
      // stranded either.
      const owner = p.kind === "note" ? byId.get(p.parent) : null;
      let keep = owner && owner.sc < fit ? owner.keep : 1;
      let giant = false;
      for (const part of p.parts) {
        const px = (part.fs * sc) / fit; // design px, so the rule holds at any fit
        if (part.fs < p.big && blown < 0.01) continue; // already gone
        if (px >= GIANT) giant = true;
        else keep = Math.min(keep, smooth(px < DISPLAY ? 0.9 : 0.93, px < DISPLAY ? 0.995 : 0.95, inFrame(part)[0]));
      }
      p.keep = keep;
      p.sc = sc;
      // a plane carrying giant type keeps it while its smaller copy goes
      if (!giant) op *= keep;
      const opS = op > 0.995 ? "" : op.toFixed(3);
      if (st.op !== opS) p.el.style.opacity = st.op = opS;

      for (const part of p.parts) {
        const px = (part.fs * sc) / fit; // design px, so the rule holds at any fit
        const bar = part.cap * sc < CAP_MIN;
        let ta = bar ? 0 : 1;
        if (part.fs < p.big) ta *= blown;
        let pk = 1;
        if (px >= GIANT) pk = smooth(0.5, 0.53, inFrame(part)[1]);
        else if (giant) pk = keep;
        ta *= pk;
        const tS = ta > 0.995 ? "" : ta.toFixed(3);
        const bS = bar ? (pk > 0.995 ? "1" : pk.toFixed(3)) : "0";
        if (part.last.t !== tS) part.t.style.opacity = part.last.t = tS;
        if (part.last.b !== bS) part.g.style.opacity = part.last.b = bS;
      }

      // A light depth of field around the camera's focus distance, capped at
      // 2 screen px so it softens an edge without turning type to mush;
      // converted to the plane's own px for the filter.
      // Small, far type keeps its edge: the cap also shrinks with the plane.
      const coc = Math.min(2, 1.5 * sc, 0.6 * Math.abs(lr));
      let fl = "";
      if (coc > 0.5) fl = `blur(${(coc / sc).toFixed(2)}px)`;
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
      for (const p of planes) {
        p.layer.remove();
        for (const part of p.parts) part.t.style.opacity = "";
      }
    },
  };
}
