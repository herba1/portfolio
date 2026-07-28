"use client";

/* ═════════════════════════════════════════════════════════════════════
 * EYE TRACKER — one pointer listener, one rAF loop, N pairs of eyes.
 *
 * Every visitor on the hero renders their own <EyePair>. If each pair
 * attached its own pointermove handler and its own animation frame, a
 * busy room would mean twenty listeners all doing layout reads on the
 * same mouse event. So the work lives here instead, as a module-level
 * singleton that eye pairs subscribe to.
 *
 * The loop is not always running. It starts on pointer input (or a
 * scroll / resize that invalidates cached geometry) and stops itself
 * once every pupil has settled inside EPSILON of its target. A still
 * mouse costs nothing.
 *
 * Frame shape is read-all-then-write-all: every getBoundingClientRect
 * happens up front, in one batch, and only when geometry is dirty —
 * pointer movement alone never re-measures. Then all the transform
 * writes. No read/write interleaving, so no layout thrash.
 *
 * Motion is a damped spring per pupil rather than a lerp. Eyes settle;
 * they don't glide to a stop at a constant fraction per frame.
 * ═════════════════════════════════════════════════════════════════════ */

/* ── Geometry ──────────────────────────────────────────────────────────
 * The SVG is 52×26 CSS px over a 39×19 viewBox, so the two aspect
 * ratios don't match and `preserveAspectRatio="xMidYMid meet"` letter-
 * boxes the content vertically. These constants map a point in viewBox
 * units to a point inside the element's client rect. */

const VIEW_W = 39;
const VIEW_H = 19;
const ATTR_W = 52;
const ATTR_H = 26;
/** viewBox unit → attribute px. */
const UNIT = Math.min(ATTR_W / VIEW_W, ATTR_H / VIEW_H);
const PAD_X = (ATTR_W - VIEW_W * UNIT) / 2;
const PAD_Y = (ATTR_H - VIEW_H * UNIT) / 2;

/** Pupil rest centres, in viewBox units — must match the <circle> cx/cy. */
const PUPILS = [
  { x: 8.5, y: 10.5 },
  { x: 31.5, y: 10.5 },
];

/* ── Feel ──────────────────────────────────────────────────────────────
 * Travel is elliptical because the socket is taller than it is wide.
 * The values below keep the 2.5r pupil inside the 2-wide stroke of the
 * eye outline at full deflection. */

/** Max pupil travel from centre, viewBox units. */
const MAX_X = 2.2;
const MAX_Y = 2.5;

/** The eyeball itself leans after the pupil, at a fraction of its
 *  travel. Small — this reads as a head turn, not a slide. */
const SOCKET_RATIO = 0.28;

/** Distance (px) at which deflection saturates. Inside it the pupil
 *  eases back to centre, so a cursor sitting on the eye is looked at
 *  rather than looked past. */
const FALLOFF = 170;

/** Spring. Stiff enough to feel attentive, damped just under critical
 *  so there is a hint of settle rather than a hard stop. */
const STIFFNESS = 190;
const DAMPING = 24;

/** Below this, in viewBox units (and units/sec), a pupil is at rest. */
const EPSILON = 0.002;

/** Longest step the integrator will take. A backgrounded tab that
 *  resumes should not launch the pupils across the socket. */
const MAX_DT = 1 / 30;

/* ── State ─────────────────────────────────────────────────────────── */

/** @type {Set<object>} live subscriptions */
const entries = new Set();

let pointerX = 0;
let pointerY = 0;
/** False before the first move, and while the pointer is off-window —
 *  both mean "look straight ahead". */
let pointerLive = false;

let rafId = 0;
let lastTime = 0;
/** Cached rects are stale; re-measure on the next frame. */
let dirty = true;
/** Listeners are attached lazily, on the first registration. */
let bound = false;

let observer = null;

/* ── Loop ──────────────────────────────────────────────────────────── */

function kick() {
  if (rafId || entries.size === 0) return;
  lastTime = 0;
  rafId = requestAnimationFrame(frame);
}

function markDirty() {
  dirty = true;
  kick();
}

function frame(now) {
  rafId = 0;

  const dt = lastTime ? Math.min((now - lastTime) / 1000, MAX_DT) : 1 / 60;
  lastTime = now;

  // ── Read phase. Batched, and only when something invalidated it.
  if (dirty) {
    for (const e of entries) {
      if (e.visible) e.rect = e.svg.getBoundingClientRect();
    }
    dirty = false;
  }

  // ── Write phase. No layout reads past this point.
  let moving = false;

  for (const e of entries) {
    if (!e.visible || !e.rect) continue;

    const rect = e.rect;
    if (rect.width === 0) continue;

    // Element scale, then viewBox-unit scale. Rotation on an ancestor
    // inflates the bounding box slightly; at the ±5° the hero uses that
    // is under 4% of gaze direction and not perceptible.
    const k = rect.width / ATTR_W;
    const unit = UNIT * k;

    for (let i = 0; i < 2; i++) {
      const st = e.springs[i];

      let tx = 0;
      let ty = 0;

      if (pointerLive) {
        const p = PUPILS[i];
        const cx = rect.left + (PAD_X + p.x * UNIT) * k;
        const cy = rect.top + (PAD_Y + p.y * UNIT) * k;

        const dx = pointerX - cx;
        const dy = pointerY - cy;
        const dist = Math.hypot(dx, dy);

        if (dist > 0.001) {
          const reach = Math.min(1, dist / (FALLOFF * k));
          tx = (dx / dist) * MAX_X * reach;
          ty = (dy / dist) * MAX_Y * reach;
        }
      }

      // Semi-implicit Euler. Velocity first, then position — stable at
      // this stiffness for any dt we allow through.
      const ax = (tx - st.x) * STIFFNESS - st.vx * DAMPING;
      const ay = (ty - st.y) * STIFFNESS - st.vy * DAMPING;
      st.vx += ax * dt;
      st.vy += ay * dt;
      st.x += st.vx * dt;
      st.y += st.vy * dt;

      const settled =
        Math.abs(tx - st.x) < EPSILON &&
        Math.abs(ty - st.y) < EPSILON &&
        Math.abs(st.vx) < EPSILON * 60 &&
        Math.abs(st.vy) < EPSILON * 60;

      if (settled) {
        st.x = tx;
        st.y = ty;
        st.vx = 0;
        st.vy = 0;
      } else {
        moving = true;
      }

      const pupil = e.pupils[i];
      if (!pupil) continue;

      // A stim remounts the group the pupil lives in, so the node under
      // us can be swapped for a fresh one with no inline transform. When
      // that happens the write-skip below has to be overridden once.
      const swapped = pupil !== st.node;
      if (swapped) st.node = pupil;

      // Skip the style write when nothing moved by a drawable amount.
      // `unit` converts viewBox units to device px, so the threshold
      // scales with how large the eyes actually render.
      if (
        swapped ||
        Math.abs(st.x - st.wx) * unit > 0.01 ||
        Math.abs(st.y - st.wy) * unit > 0.01
      ) {
        st.wx = st.x;
        st.wy = st.y;
        pupil.style.transform = `translate(${st.x.toFixed(3)}px, ${st.y.toFixed(3)}px)`;
        const s = e.sockets[i];
        if (s) {
          s.style.transform =
            `translate(${(st.x * SOCKET_RATIO).toFixed(3)}px, ${(st.y * SOCKET_RATIO).toFixed(3)}px)`;
        }
      }
    }
  }

  if (moving) rafId = requestAnimationFrame(frame);
}

/* ── Listeners ─────────────────────────────────────────────────────── */

function onPointerMove(ev) {
  // A hybrid laptop matches `hover: hover` and still gets touched. A
  // finger is not a cursor — relax the gaze rather than leaving the
  // eyes staring at wherever the last tap landed.
  if (ev.pointerType === "touch") {
    if (pointerLive) {
      pointerLive = false;
      kick();
    }
    return;
  }

  pointerX = ev.clientX;
  pointerY = ev.clientY;
  pointerLive = true;
  kick();
}

function onPointerOut(ev) {
  // relatedTarget is null when the pointer actually leaves the window,
  // as opposed to crossing between two elements inside it.
  if (ev.relatedTarget === null) {
    pointerLive = false;
    kick();
  }
}

function onVisibility() {
  if (document.hidden) {
    pointerLive = false;
  } else {
    markDirty();
  }
}

function bind() {
  if (bound) return;
  bound = true;

  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerMove, { passive: true });
  document.addEventListener("pointerout", onPointerOut, { passive: true });
  window.addEventListener("scroll", markDirty, { passive: true, capture: true });
  window.addEventListener("resize", markDirty, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);

  observer = new IntersectionObserver(
    (records) => {
      for (const rec of records) {
        const e = rec.target.__eyeEntry;
        if (!e) continue;
        e.visible = rec.isIntersecting;
        if (rec.isIntersecting) e.rect = rec.boundingClientRect;
      }
      markDirty();
    },
    { rootMargin: "120px" },
  );
}

function unbind() {
  if (!bound) return;
  bound = false;

  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerdown", onPointerMove);
  document.removeEventListener("pointerout", onPointerOut);
  window.removeEventListener("scroll", markDirty, { capture: true });
  window.removeEventListener("resize", markDirty);
  document.removeEventListener("visibilitychange", onVisibility);

  observer?.disconnect();
  observer = null;

  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  pointerLive = false;
}

/* ── Public API ────────────────────────────────────────────────────── */

/* A phone has no cursor to follow, so there is nothing to track and no
 * reason to attach a single listener. Touch devices fall through to the
 * CSS idle animations, which is exactly what shipped before this file
 * existed. Same for anyone who asked for reduced motion. */
const HOVER_Q = "(hover: hover) and (pointer: fine)";
const REDUCED_Q = "(prefers-reduced-motion: reduce)";

/** True on devices with a real cursor, when motion is welcome. */
export function eyeTrackingSupported() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return (
    window.matchMedia(HOVER_Q).matches &&
    !window.matchMedia(REDUCED_Q).matches
  );
}

/**
 * Re-run `onChange` whenever the answer from `eyeTrackingSupported`
 * could have changed — a mouse plugged into a tablet, a phone docked to
 * a display, or reduced-motion toggled in OS settings mid-session. The
 * one-shot check at mount would miss all three.
 *
 * @param {() => void} onChange
 * @returns {() => void} cleanup
 */
export function watchEyeTracking(onChange) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};

  const queries = [window.matchMedia(HOVER_Q), window.matchMedia(REDUCED_Q)];
  for (const q of queries) q.addEventListener("change", onChange);

  return () => {
    for (const q of queries) q.removeEventListener("change", onChange);
  };
}

/** True while a cursor is on-window and the eyes are actively looking
 *  at it. Callers use this to suppress idle "look away" behaviour. */
export function pointerIsLive() {
  return pointerLive;
}

/**
 * Subscribe one pair of eyes to the shared loop.
 *
 * `sockets` and `pupils` are read every frame rather than captured, so
 * pass long-lived arrays and let callback refs write into their slots.
 * That keeps a remount (a blink swapping out the stim group) from
 * needing a re-registration, which would reset the springs mid-flight.
 *
 * @param {SVGSVGElement} svg   the <svg> — measured, never written to
 * @param {Element[]} sockets   [left, right] eyeball wrappers
 * @param {Element[]} pupils    [left, right] pupil wrappers
 * @returns {() => void} unsubscribe
 */
export function registerEyes(svg, sockets, pupils) {
  if (!svg || !sockets || !pupils) return () => {};

  bind();

  const entry = {
    svg,
    sockets,
    pupils,
    rect: null,
    visible: true,
    springs: [
      { x: 0, y: 0, vx: 0, vy: 0, wx: 0, wy: 0, node: null },
      { x: 0, y: 0, vx: 0, vy: 0, wx: 0, wy: 0, node: null },
    ],
  };

  svg.__eyeEntry = entry;
  entries.add(entry);
  observer?.observe(svg);
  markDirty();

  return () => {
    entries.delete(entry);
    observer?.unobserve(svg);
    delete svg.__eyeEntry;

    // Hand the eyes back exactly as they were found. Unsubscribing is
    // not always an unmount — reduced-motion can flip on mid-session,
    // and a leftover inline transform would freeze the pupils wherever
    // they happened to be pointing.
    for (const node of [...sockets, ...pupils]) {
      if (node) node.style.transform = "";
    }

    if (entries.size === 0) unbind();
  };
}
