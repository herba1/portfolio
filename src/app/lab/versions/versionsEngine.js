import { COUNT } from "./versionsData";
import { createTicks } from "./tick";

// The stack is one number, `p`: how far back in time the front of the stack
// is. 0 shows the current note; 12 shows the first draft. Card i sits at
// depth d = i - p. At d > 0 it recedes into the stack; as d goes negative it
// flies forward past the viewer and dissolves. Every input (drag, wheel,
// keys, the timeline) moves `p`, and a spring settles it on a whole version.

const LAST = COUNT - 1;
// Depth and lift together set how much of each older save shows above the
// one in front of it. A shallow DZ keeps every card near full size and a
// tall DY lifts it clear, so each save shows its whole head line (title and
// time) like a spine in a crate. The perspective origin is placed so the
// stack would converge REACH px above the front card's top edge: the lips
// then run from about 45px at the front to 22px at the back, which still
// clears the head line of a card shrunk to two thirds.
const PERSP = 1000; // px, the scene's perspective
const DZ = 40; // px of depth between saves
const DY = 32; // px each save sits higher, before perspective
const TOP = 336; // px from the scene's head to the front card's top edge
const REACH = 1170;
const ORIGIN = TOP + (DY * PERSP) / DZ - REACH;
const SCENE = 640; // px, the scene's own height
const DRAG_PX = 150; // px of drag per version, at fit 1
const WHEEL_PX = 110; // px of wheel delta per version
const PROJECT = 0.22; // s of flick velocity carried into the landing
const SNAP_K = 190;
const SNAP_Z = 0.9;
const CHASE_K = 420;
// The correction on the front card inks in once the spring is landing on
// it: over INK_IN s from the caret, and back to pencil faster once the card
// is pulled well away.
const INK_IN = 0.18;
const INK_OUT = 0.12;
const INK_LAND = 0.15; // versions from rest at which the ink starts
const INK_LEAVE = 0.3; // versions from rest at which it lifts

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Past either end the stack gives, but less and less.
const rubber = (x) => {
  if (x < 0) return -(1 - 1 / (1 - x * 0.6)) / 0.6;
  if (x > LAST) return LAST + (1 - 1 / (1 + (x - LAST) * 0.6)) / 0.6;
  return x;
};

// Under the finger the stack is slightly sticky at whole versions: the
// slope is 0.84 at a save and 1.16 between two, so a slow drag feels each
// one land without ever stopping.
const detent = (x) => {
  const n = Math.round(x);
  const f = x - n;
  return n + f - (0.16 / (2 * Math.PI)) * Math.sin(2 * Math.PI * f);
};

export function createVersions(root, { embedded = false } = {}) {
  const stage = root.querySelector(".versions-stage");
  const space = root.querySelector(".versions-space");
  const cards = [...root.querySelectorAll(".versions-card")];
  const ticks = [...root.querySelectorAll(".versions-tick")];
  const timeline = root.querySelector(".versions-timeline");
  const box = root.closest(".piece-box") || root;
  const sound = createTicks();
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  const params = new URLSearchParams(window.location.search);
  const held = params.has("v") ? clamp(Number(params.get("v")) || 0, 0, LAST) : null;

  let p = held ?? 0;
  let vel = 0;
  let target = Math.round(p);
  let mode = held != null ? "held" : "spring";
  let fit = 1;
  let heights = cards.map(() => 0);
  let raf = 0;
  let lastT = 0;
  let shown = Math.round(p);
  let spread = held != null || reduced?.matches ? 1 : 0;
  // How far each card's correction has inked, 0 (pencil) to 1.
  const ink = cards.map(() => 0);
  if (held != null && Math.abs(p - Math.round(p)) < INK_LEAVE) ink[Math.round(p)] = 1;
  const born = performance.now();

  space.style.perspective = `${PERSP}px`;
  space.style.perspectiveOrigin = `50% ${ORIGIN}px`;
  space.style.setProperty("--versions-top", `${TOP}px`);

  // Drag state.
  let drag = null;
  // Wheel state: the wheel moves an unsnapped aim that `p` chases; once the
  // wheel (and any trackpad momentum) goes quiet, the aim rounds.
  let aim = 0;
  let wheelTimer = 0;

  const measure = () => {
    const r = box.getBoundingClientRect();
    fit = clamp(Math.min((r.width - 48) / 600, (r.height - 24) / 600), 0.3, 1);
    // Each card is as tall as its own text. Measured unzoomed, in the
    // scene's own pixels.
    root.style.setProperty("--fit", "1");
    heights = cards.map((c) => c.offsetHeight);
    root.style.setProperty("--fit", fit.toFixed(4));
  };

  // Where a card's top edge lands on screen at depth d, in scene px.
  const lift = (d, s) => ORIGIN + ((TOP - d * DY * s - ORIGIN) * PERSP) / (PERSP + d * DZ * s);

  // Centre what is actually on screen, from the top of the oldest save still
  // behind to the foot of the front card, so the scene stays balanced as the
  // stack thins and as the front card's length changes.
  const centre = (q, s) => {
    const at = clamp(q, 0, LAST);
    const lo = Math.floor(at);
    const hi = Math.min(LAST, lo + 1);
    const h = heights[lo] + (heights[hi] - heights[lo]) * (at - lo);
    const top = lift(LAST - at, s);
    const shift = SCENE / 2 - (top + TOP + h) / 2;
    space.style.transform = `translate3d(0, ${shift.toFixed(2)}px, 0)`;
  };

  const render = () => {
    const q = reduced?.matches && mode !== "held" ? Math.round(p) : p;
    const s = spread;
    centre(q, s);
    for (let i = 0; i < COUNT; i += 1) {
      const c = cards[i];
      const d = i - q;
      if (d < -1.02) {
        c.style.visibility = "hidden";
        continue;
      }
      c.style.visibility = "visible";
      let z;
      let y;
      let blur;
      let fog;
      let alpha;
      if (d >= 0) {
        z = -d * DZ * s;
        y = -d * DY * s;
        // Saves behind stay sharp: the haze only tints their paper toward
        // the ground (see .versions-card), never the type on it.
        blur = 0;
        fog = Math.min(0.36, Math.pow(d, 1.15) * 0.026) * s;
        alpha = 1;
      } else {
        const k = -d;
        // Toward the eye, fast at first and easing as it goes, held up
        // against the perspective (which would otherwise drag a near card
        // down off the box) so it swells around its own middle and drifts
        // only a little below eye level.
        z = 860 * (1 - (1 - Math.min(k, 1)) ** 2);
        y = -z * 0.3;
        blur = k * 16;
        fog = 0;
        alpha = (1 - Math.min(1, k / 0.38)) ** 2;
      }
      c.style.transform = `translate3d(0, ${y.toFixed(2)}px, ${z.toFixed(2)}px)`;
      c.style.filter = blur > 0.02 ? `blur(${blur.toFixed(2)}px)` : "none";
      c.style.opacity = alpha.toFixed(3);
      c.style.zIndex = String(1000 - Math.round(d * 40));
      c.style.setProperty("--fog", fog.toFixed(3));
      // 1 on the front card (its head carries the title), 0 on every save
      // behind it (its head names what that save changed).
      c.style.setProperty("--front", (d <= 0 ? 1 : 1 - smooth(0.08, 0.5, d)).toFixed(3));
      // Eased out, so the stroke starts quick at the caret and slows into
      // the last letters.
      const f = 1 - (1 - ink[i]) ** 3;
      c.style.setProperty("--f", f.toFixed(3));
    }
    for (let i = 0; i < COUNT; i += 1) {
      const near = Math.exp(-((i - q) ** 2) / 1.4);
      const show = 1 - smooth(0, 0.5, Math.abs(i - q));
      ticks[i].style.setProperty("--near", near.toFixed(3));
      ticks[i].style.setProperty("--show", show.toFixed(3));
    }
    cards.forEach((c, i) => {
      const front = Math.round(q) === i;
      if (front) c.removeAttribute("aria-hidden");
      else c.setAttribute("aria-hidden", "true");
    });
  };

  // Ink rises on the card the spring is landing on, finishes a stroke it
  // has started, and lifts from a card pulled well away.
  const inkStep = (dt) => {
    let moving = false;
    for (let i = 0; i < COUNT; i += 1) {
      const off = Math.abs(p - i);
      const landing = (mode === "spring" || mode === "held") && target === i && off < INK_LAND && spread > 0.85;
      let v = ink[i];
      if (landing || (v > 0 && v < 1 && off < INK_LEAVE)) v = reduced?.matches ? 1 : Math.min(1, v + dt / INK_IN);
      else if (off >= INK_LEAVE || (mode === "spring" && target !== i)) v = reduced?.matches ? 0 : Math.max(0, v - dt / INK_OUT);
      ink[i] = v;
      if (v > 0 && v < 1) moving = true;
    }
    return moving;
  };

  const settled = (inking) =>
    mode === "spring" && !inking && Math.abs(target - p) < 0.0004 && Math.abs(vel) < 0.002 && spread >= 1;

  const frame = (now) => {
    raf = 0;
    const dt = Math.min(0.064, (now - (lastT || now)) / 1000) || 1 / 60;
    lastT = now;

    if (spread < 1) {
      const t = clamp((now - born - 180) / 1100, 0, 1);
      spread = 1 - (1 - t) ** 4;
    }

    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let n = 0; n < steps; n += 1) {
      if (mode === "spring") {
        if (reduced?.matches) {
          p = target;
          vel = 0;
          break;
        }
        const c = 2 * Math.sqrt(SNAP_K) * SNAP_Z;
        vel += (SNAP_K * (target - p) - c * vel) * h;
        p += vel * h;
      } else if (mode === "wheel") {
        const c = 2 * Math.sqrt(CHASE_K);
        vel += (CHASE_K * (rubber(aim) - p) - c * vel) * h;
        p += vel * h;
      }
    }

    const idx = clamp(Math.round(p), 0, LAST);
    if (idx !== shown) {
      shown = idx;
      sound.tick(Math.abs(vel));
    }

    const inking = inkStep(dt);
    if (settled(inking)) {
      p = target;
      vel = 0;
      render();
      lastT = 0;
      return;
    }
    render();
    raf = requestAnimationFrame(frame);
  };

  const wake = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  const snapTo = (t, v = vel) => {
    target = clamp(Math.round(t), 0, LAST);
    vel = v;
    mode = "spring";
    wake();
  };

  // ── Drag on the stack: down pulls older saves forward, up returns.
  const onDown = (e) => {
    if (e.button !== 0) return;
    sound.wake();
    stage.focus({ preventScroll: true });
    clearTimeout(wheelTimer);
    stage.setPointerCapture(e.pointerId);
    stage.setAttribute("data-dragging", "");
    drag = { id: e.pointerId, y0: e.clientY, raw0: p, samples: [{ t: e.timeStamp, p }] };
    mode = "drag";
    vel = 0;
    wake();
  };

  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const raw = drag.raw0 + (e.clientY - drag.y0) / (DRAG_PX * Math.max(fit, 0.5));
    const next = detent(rubber(raw));
    drag.samples.push({ t: e.timeStamp, p: next });
    while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 90) drag.samples.shift();
    const a = drag.samples[0];
    const span = (e.timeStamp - a.t) / 1000;
    vel = span > 0.004 ? (next - a.p) / span : vel;
    p = next;
    wake();
  };

  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    stage.removeAttribute("data-dragging");
    // A finger that stopped before lifting carries nothing.
    const last = drag.samples[drag.samples.length - 1];
    if (e.timeStamp - last.t > 70) vel = 0;
    drag = null;
    vel = clamp(vel, -40, 40);
    snapTo(p + vel * PROJECT, vel);
  };

  // ── Wheel and trackpad. Fingers moving down (deltaY < 0) pull older
  // saves forward, the same way a drag does.
  const onWheel = (e) => {
    if (embedded && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (mode !== "wheel") aim = mode === "spring" ? target : p;
    if (mode === "held") vel = 0;
    aim = clamp(aim - (e.deltaY * unit) / WHEEL_PX, -0.4, LAST + 0.4);
    mode = "wheel";
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      if (mode === "wheel") snapTo(clamp(aim, 0, LAST));
    }, 130);
    wake();
  };

  // ── Keys: one save at a time.
  const onKey = (e) => {
    const step = { ArrowUp: 1, PageUp: 1, ArrowDown: -1, PageDown: -1 }[e.key];
    const base = mode === "spring" ? target : Math.round(p);
    if (step) snapTo(base + step);
    else if (e.key === "Home") snapTo(0);
    else if (e.key === "End") snapTo(LAST);
    else return;
    e.preventDefault();
    sound.wake();
  };

  // ── The timeline: press and slide along the ticks to scrub.
  let scrub = null;
  const fromY = (clientY) => {
    const r = timeline.getBoundingClientRect();
    const local = (clientY - r.top) / (r.height / (COUNT * 16));
    return LAST - (local - 8) / 16;
  };
  const onScrubDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    sound.wake();
    timeline.setPointerCapture(e.pointerId);
    scrub = e.pointerId;
    snapTo(fromY(e.clientY));
  };
  const onScrubMove = (e) => {
    if (scrub !== e.pointerId) return;
    snapTo(fromY(e.clientY));
  };
  const onScrubUp = (e) => {
    if (scrub === e.pointerId) scrub = null;
  };
  const onTickKey = (e) => {
    const t = e.target.closest(".versions-tick");
    if (t && e.detail === 0) snapTo(Number(t.dataset.i));
  };

  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("keydown", onKey);
  root.addEventListener("wheel", onWheel, { passive: false });
  timeline.addEventListener("pointerdown", onScrubDown);
  timeline.addEventListener("pointermove", onScrubMove);
  timeline.addEventListener("pointerup", onScrubUp);
  timeline.addEventListener("pointercancel", onScrubUp);
  timeline.addEventListener("click", onTickKey);

  const ro = new ResizeObserver(() => {
    measure();
    render();
  });
  ro.observe(box);

  let alive = true;
  const ready = () => {
    if (!alive) return;
    measure();
    render();
    root.setAttribute("data-ready", "");
    if (mode !== "held") wake();
  };
  if (document.fonts?.ready) document.fonts.ready.then(ready);
  else ready();

  return {
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      clearTimeout(wheelTimer);
      ro.disconnect();
      stage.removeEventListener("pointerdown", onDown);
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      stage.removeEventListener("keydown", onKey);
      root.removeEventListener("wheel", onWheel);
      timeline.removeEventListener("pointerdown", onScrubDown);
      timeline.removeEventListener("pointermove", onScrubMove);
      timeline.removeEventListener("pointerup", onScrubUp);
      timeline.removeEventListener("pointercancel", onScrubUp);
      timeline.removeEventListener("click", onTickKey);
      sound.destroy();
    },
  };
}
