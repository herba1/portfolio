import { COUNT, DZ, PERSP } from "./versionsData";
import { createTicks } from "./tick";

// The stack is one number, `p`: how far back in time the front of the stack
// is. 0 shows the current note; 12 shows the first draft. Card i sits at
// depth d = i - p. At d > 0 it recedes into the stack; as d goes negative it
// flies forward past the viewer and dissolves. Every input (drag, wheel,
// keys, a date in the margin) moves `p`, and a spring settles it on a whole version.

const LAST = COUNT - 1;
// Depth and lift together set how much of each older save shows above the
// one in front of it. A shallow DZ keeps every card near full size and a
// tall DY lifts it clear, so each save shows its whole head line (title and
// time) like a spine in a crate. The perspective origin is placed so the
// stack would converge REACH px above the front card's top edge: the lips
// then run from about 45px at the front to 22px at the back, which still
// clears the head line of a card shrunk to two thirds.
// PERSP (px, the scene's perspective) and DZ (px of depth between saves)
// live in versionsData.js, which budgets each spine's line by its depth.
const DY = 32; // px each save sits higher, before perspective
const TOP = 336; // px from the scene's head to the front card's top edge
const REACH = 1170;
const ORIGIN = TOP + (DY * PERSP) / DZ - REACH;
const SCENE = 640; // px, the scene's own height
const CARD_L = 100; // px, the front card's left edge in the scene
const CARD_R = 540; // px, and its right edge
const PAD = 32; // px, a card's side padding
// The index's one left axis: the front card's text column. The stack
// recedes toward it, so a point on the axis stays on it at every depth and
// every sheet keeps the axis inside its paper; the sheets step in on the
// right only.
const AXIS = CARD_L + PAD;
const MEASURE = CARD_R - CARD_L - 2 * PAD; // px, the text column's width
// The margin: one hairline GUTTER px clear of the front card's right edge,
// ticks reaching back toward the spines, dates set GAP px past the rule.
const GUTTER = 28;
const RULE = CARD_R + GUTTER;
const TICK = 8; // px, a tick's reach back from the rule
const GAP = 8; // px, from the rule to the date
const LEAD = 12; // px, from the end of a spine's line to its leader
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
  const rule = root.querySelector(".versions-rule");
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
  // Baselines, in px from a card's top edge, of its title and of its change
  // line (laid out one line below the title, rolled up into its place), and
  // of a date from the top of its own line.
  let titleBase = 31;
  let dateBase = 15;
  // Where the label's own line box starts in a card, and the natural width
  // of each card's title and change line, in px at the meta rung.
  let labelTop = 16;
  let titleW = cards.map(() => 0);
  let changeW = cards.map(() => 0);
  let shiftX = 0;
  let raf = 0;
  let lastT = 0;
  let shown = Math.round(p);
  let spread = held != null || reduced?.matches ? 1 : 0;
  // How far each card's correction has inked, 0 (pencil) to 1.
  const ink = cards.map(() => 0);
  if (held != null && Math.abs(p - Math.round(p)) < INK_LEAVE) ink[Math.round(p)] = 1;
  const born = performance.now();
  const labels = cards.map((c) => c.querySelector(".versions-label"));

  space.style.perspective = `${PERSP}px`;
  space.style.perspectiveOrigin = `${AXIS}px ${ORIGIN}px`;
  space.style.setProperty("--versions-top", `${TOP}px`);
  space.style.setProperty("--versions-rule", `${RULE}px`);
  space.style.setProperty("--versions-gutter", `${GUTTER}px`);
  space.style.setProperty("--versions-reach", `${TICK}px`);
  space.style.setProperty("--versions-gap", `${GAP}px`);

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
    const base = (el) => {
      let y = 0;
      for (let n = el; n && n !== el.closest(".versions-card, .versions-tick"); n = n.offsetParent) y += n.offsetTop;
      return y;
    };
    const head = cards[0];
    titleBase = base(head.querySelector(".versions-title .versions-base"));
    labelTop = base(labels[0]);
    dateBase = base(ticks[0].querySelector(".versions-base"));
    // The leader runs through the middle of the lower case, so it meets the
    // date and the line it joins rather than underlining them.
    space.style.setProperty("--versions-tick-at", `${dateBase - 4}px`);
    labels.forEach((l) => {
      l.style.width = `${MEASURE}px`;
      l.style.transformOrigin = `0 ${titleBase - labelTop}px`;
    });
    titleW = labels.map((l) => l.querySelector(".versions-title").scrollWidth);
    changeW = labels.map((l) => l.querySelector(".versions-change").scrollWidth);
    // The front sheet and its margin are one block: centre that, so the
    // sheet itself sits left of the axis and the dates hang to its right.
    const wide = Math.max(...ticks.map((t) => t.querySelector(".versions-when").offsetWidth));
    const right = RULE + GAP + wide;
    shiftX = SCENE / 2 - (CARD_L + right) / 2;
    fit = clamp(Math.min((r.width - 48) / Math.max(600, right - CARD_L + 48), (r.height - 24) / 600), 0.3, 1);
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
    space.style.transform = `translate3d(${shiftX.toFixed(2)}px, ${shift.toFixed(2)}px, 0)`;
    return top;
  };

  const render = () => {
    const q = reduced?.matches && mode !== "held" ? Math.round(p) : p;
    const s = spread;
    const top = centre(q, s);
    let foot = null;
    for (let i = 0; i < COUNT; i += 1) {
      const c = cards[i];
      const d = i - q;
      if (d < -1.02) {
        c.style.visibility = "hidden";
        ticks[i].style.visibility = "hidden";
        continue;
      }
      c.style.visibility = "visible";
      let z;
      let y;
      let x = 0;
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
        // The stack converges on the text axis, left of the card's middle:
        // carried right by as much, so it still swells about its middle.
        x = ((SCENE / 2 - AXIS) * -z) / PERSP;
        blur = k * 16;
        fog = 0;
        alpha = (1 - Math.min(1, k / 0.38)) ** 2;
      }
      c.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px)`;
      const front = d <= 0 ? 1 : 1 - smooth(0.08, 0.5, d);
      // The paper recedes; the type on its spine does not. Only the
      // label's place is projected: the card's scale is cancelled on the
      // label itself, so every spine is set at the meta rung, hung from the
      // one axis, and given the measure its sheet has left at that depth.
      // A card flying off past the eye keeps its scale, title and all.
      const sc = PERSP / (PERSP - z);
      const kc = d >= 0 ? sc : 1;
      const edge = ORIGIN + (TOP + y - ORIGIN) * sc;
      // The baseline: the title's on the front sheet; deeper in, where the
      // lip of paper showing is shorter than the head, the line is set in
      // the lip, never down into the sheet in front.
      let off = titleBase * sc;
      if (d >= 1) off = clamp(lift(d - 1, s) - lift(d, s) - 6, 15, off);
      labels[i].style.width = `${(MEASURE * kc).toFixed(2)}px`;
      labels[i].style.transform = `translate3d(0, ${((off - titleBase * sc) / sc).toFixed(2)}px, 0) scale(${(1 / kc).toFixed(4)})`;
      // The date rides its spine, on the same baseline, and leaves with it.
      const at = edge + off;
      ticks[i].style.visibility = "visible";
      ticks[i].style.transform = `translate3d(0, ${(at - dateBase).toFixed(2)}px, 0)`;
      ticks[i].style.opacity = alpha.toFixed(3);
      // A leader from the end of the spine's line out to the rule: the
      // change and its date read as one row, like a contents page.
      const wide = Math.min(MEASURE * kc, titleW[i] * front + changeW[i] * (1 - front));
      const end = AXIS + (x + wide / kc) * sc + LEAD;
      // The rule runs the stack's full height, from the oldest sheet still
      // behind to the foot of the front one, wherever perspective has it.
      if (foot == null && d >= 0) foot = edge + heights[i] * sc;
      ticks[i].style.setProperty("--reach", `${Math.max(TICK, RULE + 1 - end).toFixed(2)}px`);
      c.style.filter = blur > 0.02 ? `blur(${blur.toFixed(2)}px)` : "none";
      c.style.opacity = alpha.toFixed(3);
      c.style.zIndex = String(1000 - Math.round(d * 40));
      c.style.setProperty("--fog", fog.toFixed(3));
      // 1 on the front card (its head carries the title), 0 on every save
      // behind it (its head names what that save changed).
      c.style.setProperty("--front", front.toFixed(3));
      // Eased out, so the stroke starts quick at the caret and slows into
      // the last letters.
      const f = 1 - (1 - ink[i]) ** 3;
      c.style.setProperty("--f", f.toFixed(3));
    }
    rule.style.top = `${top.toFixed(2)}px`;
    rule.style.height = `${Math.max(0, (foot ?? top) - top).toFixed(2)}px`;
    // The current save's leader is drawn in full ink.
    for (let i = 0; i < COUNT; i += 1) {
      const near = 1 - smooth(0, 0.6, Math.abs(i - q));
      ticks[i].style.setProperty("--near", near.toFixed(3));
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

  // ── The margin: a date takes you to its save. Pressed here, the stack
  // underneath must not start a drag.
  const onTickDown = (e) => {
    if (e.target.closest(".versions-tick")) e.stopPropagation();
  };
  const onTick = (e) => {
    const t = e.target.closest(".versions-tick");
    if (!t) return;
    sound.wake();
    snapTo(Number(t.dataset.i), 0);
  };

  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("keydown", onKey);
  root.addEventListener("wheel", onWheel, { passive: false });
  timeline.addEventListener("pointerdown", onTickDown);
  timeline.addEventListener("click", onTick);

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
      timeline.removeEventListener("pointerdown", onTickDown);
      timeline.removeEventListener("click", onTick);
      sound.destroy();
    },
  };
}
