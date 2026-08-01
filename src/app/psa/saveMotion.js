/* ─────────────────────────────────────────────────────────────────────────
   Save-motion config.

   HOW IT IS BUILT, since that keeps coming up:

     · the card is a CLONED NODE in a layer, not the tile itself
     · every frame of its flight is a CSS @keyframes animation — no rAF loop,
       no JS driving values, nothing on the main thread once it starts
     · the only JS is one measurement at the tap, written out as custom
       properties, and the FLIP that closes the grid
     · the FLIP uses the Web Animations API (el.animate) because it needs a
       per-element distance that cannot be known until the layout changes
     · NO view transitions anywhere.

   So every number below is DATA. There is one arc keyframe block in
   saveFlight.css and it reads all of its stops from custom properties, which
   is what lets the panel on the right of the screen retune the whole thing
   live without recompiling a single rule.

   EVERY knob in this file is exposed in that panel. KNOBS at the bottom is
   the schema it renders from — add a field to a variant, add a row to KNOBS,
   and it gets a slider.
   ───────────────────────────────────────────────────────────────────────── */

/* Penner curves, named, so the rows below read as intent rather than digits.
   Variants store the ID, not the string, so the panel can offer them as a
   list and so a curve can be renamed in one place. */
const CURVES = {
  linear: "linear",
  outSine: "cubic-bezier(0.39, 0.575, 0.565, 1)",
  inSine: "cubic-bezier(0.47, 0, 0.745, 0.715)",
  inOutSine: "cubic-bezier(0.37, 0, 0.63, 1)",
  outQuad: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
  inQuad: "cubic-bezier(0.55, 0.085, 0.68, 0.53)",
  inCubic: "cubic-bezier(0.55, 0.055, 0.675, 0.19)",
  outCubic: "cubic-bezier(0.215, 0.61, 0.355, 1)",
  outExpo: "cubic-bezier(0.16, 1, 0.3, 1)",
  inExpo: "cubic-bezier(0.7, 0, 0.84, 0)",
  outBack: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  inHard: "cubic-bezier(0.5, 0, 0.9, 0.3)",
  standard: "cubic-bezier(0.4, 0, 0.2, 1)",
  hover: "cubic-bezier(0.26, 0.08, 0.25, 1)",
};

export const EASES = Object.keys(CURVES).map((id) => ({ id, value: CURVES[id] }));
export const easeValue = (id) => CURVES[id] ?? CURVES.outSine;

/* ── The same curves, as functions ────────────────────────────────────────
   CSS can APPLY an easing but it cannot tell you where the thing is. To point
   a card along its own path you have to know the path, which means evaluating
   the two curves in JS at the moment of the tap.

   A cubic-bezier easing is a parametric curve through (0,0) and (1,1); its x
   is time and its y is progress, and x is NOT the parameter. So getting
   progress-at-time means solving x(u) = t for u first. Bisection rather than
   Newton: 24 halvings is exact to seven digits, always converges, and this
   runs a few dozen times per save — the robustness is free.                */
const BEZ = /cubic-bezier\(([^)]+)\)/;

export function easeFn(id) {
  const css = easeValue(id);
  const m = BEZ.exec(css);
  if (!m) return (t) => t; // linear
  const [x1, y1, x2, y2] = m[1].split(",").map(Number);

  const axis = (u, a, b) => {
    const v = 1 - u;
    return 3 * v * v * u * a + 3 * v * u * u * b + u * u * u;
  };

  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (axis(mid, x1, x2) < t) lo = mid;
      else hi = mid;
    }
    return axis((lo + hi) / 2, y1, y2);
  };
}

/* Inverse: given a progress value, when does the curve reach it? Same
   bisection, run on the output instead of the input. Used to find the exact
   frame a rising card clears the footer, so the stacking swap is derived from
   the geometry rather than guessed at with a fraction. */
export function easeInvert(id, value) {
  const f = easeFn(id);
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (lo + hi) / 2;
    if (f(mid) < value) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ═══════════════════════════════════════════════════════════════════════
   THE ARC ITERATIONS

   All of them run the same machinery. What separates them:

     easeX / easeY   the PATH. Two axes on two curves is what bends the line —
                     a circle is (sin t, 1 − cos t), so outSine against inSine
                     is a true quarter-ellipse. Swap them and the curve bows
                     the other way. Both-accelerating reads as being pulled;
                     both-decelerating reads as being thrown.

     press / lift    the DEPARTURE. A card that just turns and slides is not
                     how anything leaves a surface. It gets pressed (a squash
                     against the pivot), released, and hopped upward before the
                     travel takes over. `lift` is superposed on the Y travel by
                     its own nested element, so the pop and the flight are
                     independent curves rather than one compromised one.

     lean            how hard it tips into the turn, bottom edge leading.
                     Always starts and ends at zero — frame one is the tile,
                     arrival is square on to the tab.

     s1 / s2 / s3    the scale ramp at 16% / 34% / 68%.
     swallow / fade  where the bookmark starts eating it, and where it goes.
     origin          rotation pivot, as a percentage down the card.
   ═══════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════
   THE DIVE: TWO CLONES, NOT ONE

   One element could not do this. Making a single card drop, move sideways
   under the bar and climb back means three motions on two axes sharing one
   timeline, and however the overlap is tuned some of the sideways move bleeds
   into the end of the descent — which is the arc that kept appearing at the
   bottom of the slide. There is no arrangement of one object's timings that
   removes it, because the object genuinely has to get from one column to
   another and it only has the one trip to do it in.

   So there are two:

     THE FALLER  starts on the tile and slides straight down. One axis, one
                 curve, no sideways component to bleed anywhere. It goes under
                 the bar and it is gone.

     THE RISER   starts at the Collection column, below the bottom of the
                 screen, born at the size the faller left at. It climbs behind
                 the footer, clears the top edge, and drops into the tab.

   The lateral move is not animated at all — it is the gap between where one
   clone starts and where the other does. Nothing can arc, because nothing ever
   moves on two axes.

   ITS OWN OBJECT, spread into BOTH bases. It used to live inside ARC_BASE
   only, which meant a path variant — including the default one — reached
   runDive with every one of these fields undefined: NaN durations, NaN
   distances, an `animation` shorthand invalid at computed-value time, and
   therefore no animation on either clone at all. The dive is not an arc
   feature. Any variant can be handed a card the footer is covering.
   ═══════════════════════════════════════════════════════════════════════ */
const DIVE = {
  /* The whole dive is longer than the flight it replaces — it is three moves
     against one. Every fraction below is of THIS, not of `duration`. */
  underDurScale: 1.6,

  /* ── The faller ──────────────────────────────────────────────────────────
     `fallBy` is SLACK, not the distance. The distance is solved at the tap
     from where the bar actually is: the card falls exactly far enough to put
     its own top edge under the footer's top edge, and then this much further.

     It used to be a flat 260px, which is two different bugs depending on where
     the tile was. A tall card with its bottom edge only just touching the bar
     was still more than half on screen when the riser surfaced — that is the
     "duplicate element" — and a card already mostly behind the bar carried on
     travelling for another 200px nobody could see, which is time the riser
     spends waiting. */
  fallBy: 44,
  fallFrac: 0.34,
  fallEase: "inCubic",
  /* NOT 1. It used to be a pure slide, so a full-width card left the screen
     and a 24px thumbnail came back — two objects, not one trip. It shrinks on
     the way down and THE RISER IS BORN AT EXACTLY THIS SIZE, which makes this
     one number the size of the whole second half of the dive.

     0.62 was too generous twice over: a card two-thirds of a tile wide coming
     up over the footer is not a thumbnail returning, it is the card itself
     arriving in the wrong place — and it left the final drop with a 4.9×
     collapse to get into a 24px bookmark, which is a card being crushed rather
     than filed.

     A quarter, in the end. Two-thirds was the card arriving in the wrong
     place; a third was still a picture you could read, coming up over a
     footer. What is wanted is a TOKEN of the card — obviously a stand-in for
     something being filed, and close enough to the 24px bookmark that landing
     on it is a settle rather than a collapse. */
  fallScale: 0.26,
  fallFadeAt: 0.28,

  /* ── The riser ─────────────────────────────────────────────────────────── */
  // The box it LANDS in, measured against the tab icon. Landing is not
  // animated toward the target — the box IS the target.
  underWidth: 1,
  // ...and the size it is BORN at, as a multiple of the faller's exit size.
  // 1 is continuous: the card comes back the size it went away.
  underBorn: 1,
  /* THE BEAT. Nothing on screen at all between the faller going behind the bar
     and the riser clearing it — the card is under the footer, and for this long
     you can see that it is. The riser's whole sub-timeline is slid to hold it,
     so it is the same pause however long that particular card's fall took.

     0.05 was technically a gap and perceptually nothing: forty milliseconds
     reads as one continuous move with a hitch in it rather than as a card
     going somewhere and coming back. ~120ms is the smallest pause that reads
     as a pause. */
  underGap: 0.14,
  riseAt: 0.3,
  riseFrac: 0.46,
  riseEase: "outCubic",
  /* How far past the footer's top edge the box gets before it turns over. It
     has to be a real climb: the card is coming back from under a surface, and
     eighteen pixels is a card peeking out rather than a card that went and
     came back.

     Scaled with the card. The number that reads right is not an absolute
     height, it is "the card just barely gets all the way out" — a sliver of it
     still behind the bar at the top of the arc, so it stays attached to the
     footer it is climbing out of instead of floating free above it. 88 was that
     for a 165px-tall riser; this is the same relationship at the smaller one. */
  clearBy: 32,
  /* The drop STARTS BEFORE THE CLIMB ENDS, and that overlap is the whole
     reason there is an apex instead of a stall. The two translations are
     nested, so they add: a decelerating climb and an accelerating drop
     crossing over is a ballistic top. Set dropAt to riseAt + riseFrac and the
     card comes to a dead stop in mid-air first, which is what it was doing. */
  dropAt: 0.64,
  dropFrac: 0.3,
  dropEase: "inOutSine",

  /* ── The arc ─────────────────────────────────────────────────────────────
     The riser is the ONLY thing here that bends. The faller must not — it is
     one axis on one curve precisely so nothing sideways can bleed into the end
     of its descent, which is the whole reason there are two clones instead of
     one.

     But the riser is already past that problem: it is born at the Collection
     column and lands at the Collection column, so a lateral offset that
     resolves to zero cannot walk it off its target. Starting it out to one side
     and easing X to zero against the climb's Y is the same quarter-ellipse
     trick as the genie arc — two axes, two curves, no path maths.

     `auto` takes the side from where the tile actually was, so the card comes
     back up from the side it went down on. */
  arcBy: 42,
  arcSide: "auto",
  arcEase: "outSine",

  /* THE TILT, which is the arc's — same side, same window, and it resolves to
     zero for the same reason the offset does: arrival has to be square to the
     bookmark or the card is filed crooked.

     It leans INTO the lateral travel. A card that starts out to the right is
     moving left, so its top goes left, which is a negative angle under CSS's
     clockwise-positive convention — hence the sign flip against `side`. A card
     swinging across dead upright is the thing that reads as a sprite being
     moved rather than an object with any weight to it.

     Small on purpose. This is a 68px card crossing 42px; anything past about
     ten degrees stops being a bank and starts being a tumble. */
  tiltBy: 7,
  tiltEase: "outSine",

  /* THE VEIL — a mask on the LAYER, at the BOTTOM OF THE VIEWPORT.

     The riser is born below the bottom edge of the screen and climbs in. In
     theory the shell's `overflow: hidden` handles that: the card is simply
     clipped until it is on screen, the way anything sliding in from off screen
     is. In practice, on Safari, the bottom strip is not opaque — the shell does
     not own those pixels the way it owns the rest — so the clip is a visible
     hard edge, and the card does not slide in so much as get cut off along a
     line while it does.

     So: a short ramp pinned to the bottom of the viewport, easing the card in
     over the last few pixels. That is all it is for. It does NOT dim the card
     over the footer — by the time the riser is up, it is up, in front of the
     bar, at full strength, which is the point of the climb.

     On the CARD would have been wrong twice: the card would be permanently
     soft-edged, and the softness would travel with it instead of staying at
     the screen edge where the artefact actually is.

     Both numbers are measured UP from the bottom of the viewport, and both want
     to stay small — this is taking the edge off a cut, not fading anything in.
     A long ramp reads as the card going translucent, which is a different
     effect and a worse one. */
  veilFade: 18,
  veilInset: 0,

  /* WHEN IT SHRINKS. Not on the way up — it holds the size the faller left at
     for the whole climb and only comes down into the bookmark as it drops in,
     so the rise reads as the card returning and the drop reads as it being
     filed. Shrinking during the climb makes the arrival start before the card
     has finished coming back. */
  shrinkAt: "drop",

  /* There was a `zNudge` here, to shift the stacking swap either side of the
     frame the climb crosses the bar. There is no swap now — the riser is in
     front of the footer for its whole life — so there is nothing to nudge. See
     .psa-flight-veil in saveFlight.css. */
};

/* Shared by every arc row. Only the fields a variant actually wants to differ
   on are written out below, so a new iteration is three lines, not thirty. */
const ARC_BASE = {
  group: "Genie arc",
  duration: 520,
  easeX: "outSine",
  easeY: "inSine",

  // Departure
  press: 0.07,
  lift: 22,
  liftFrac: 0.24,
  liftEase: "outCubic",

  /* ── BANK ───────────────────────────────────────────────────────────────
     `path` mode ORIENTS THE CARD TO ITS OWN TRAJECTORY. The two path curves
     are evaluated in JS, the velocity is taken by difference, and the card's
     bottom edge is pointed along it: θ = atan2(−vx, vy).

     This is the fix for "the rotation and the arc are fighting each other".
     They were two independent shapes that happened to overlap — a bump that
     peaked at 44% against a path that was doing something else entirely, so
     whether they agreed was luck, and on Pop they happened to. Derived from
     the path they cannot disagree, on any variant, at any duration.

     `amplify` now multiplies a REAL angle, so 1.0 is physically exact and
     anything above it is deliberate exaggeration. It is no longer the 2.6–5×
     it had to be when the angle was a made-up constant.

     `leanIn`/`leanOut` blend the orientation on and off at the ends: frame
     one has to be the tile exactly, and arrival has to be square to the tab. */
  leanMode: "path",
  leanAmplify: 0.6,
  leanMax: 28,
  leanIn: 0.12,
  leanOut: 0.2,
  // bump mode only — the old free-timed turn, kept for comparison
  leanAt: 0,
  leanFrac: 0.44,
  leanEase: "outCubic",

  /* TWO pivots, because rotation and scale want opposite things.

     Rotation wants a LOW pivot so the bottom edge leads. Scale wants the
     CENTRE — the flight is measured centre-to-centre, so scaling about
     anything else walks the card off its own target: a 66% pivot at 0.16
     arrival scale lands it about 38px below the bookmark. They are separate
     elements now, so each gets the origin it actually needs. */
  origin: 66,
  scaleOrigin: 50,

  // Scale ramp
  s1: 1.055,
  s2: 0.72,
  s3: 0.42,
  endScale: 0.16,
  endSquash: 0.52,

  // Exit
  swallowFrom: 0.62,
  fadeFrom: 0.74,

  /* Approach — see measureApproach() in SaveFlight.jsx.

     underAt is deliberately tiny. "If the footer is covering the image" means
     COVERING, not half-swallowing it: the moment any part of the card is
     behind the bar there is nothing left below it to fall through, so the
     whole idea of arcing down is dead and it has to go under instead. */
  approach: "auto",
  underAt: 0.02,

  // The dive — see DIVE above. Shared with the path variants, which can be
  // handed a covered card just as easily.
  ...DIVE,

  liftBoost: 1.6,
};

export const ARC_VARIANTS = [
  {
    ...ARC_BASE,
    id: "arc-sine",
    name: "Sine",
    /* The default. Out on X against in on Y: it carries ACROSS first and
       drops in at the end, which is the read you want — the card commits to
       the destination and then arrives. Drop is this pair inverted, and the
       inversion is exactly why it goes down before it goes sideways. */
    note: "Across first, then in. The true quarter-ellipse — even, unhurried, and it never looks like it is falling off the page.",
    duration: 460,
    leanAmplify: 2.8,
    leanMax: 36,
  },
  {
    ...ARC_BASE,
    id: "arc-drop",
    name: "Drop",
    note: "Sine inverted: falls away first, then swings across. Heavier and more gravity, at the cost of a beat where it reads as going down sideways.",
    duration: 520,
    easeX: "inSine",
    easeY: "outSine",
    press: 0.085,
    lift: 30,
    liftFrac: 0.27,
    leanAmplify: 3.8,
    leanMax: 44,
    origin: 62,
    s1: 1.06,
    s2: 0.7,
    s3: 0.4,
    endScale: 0.15,
    endSquash: 0.55,
    swallowFrom: 0.64,
    fadeFrom: 0.76,
  },
  {
    ...ARC_BASE,
    id: "arc-pop",
    name: "Pop",
    note: "Almost all departure. Hard press, tall hop, and the travel only starts once it is already in the air. Reads as flicked off the page.",
    duration: 560,
    easeX: "inQuad",
    easeY: "outQuad",
    press: 0.12,
    lift: 54,
    liftFrac: 0.34,
    liftEase: "outExpo",
    leanAmplify: 4.2,
    leanMax: 52,
    origin: 74,
    s1: 1.1,
    s2: 0.78,
    s3: 0.44,
    endScale: 0.15,
    endSquash: 0.5,
    swallowFrom: 0.68,
    fadeFrom: 0.8,
  },
  {
    ...ARC_BASE,
    id: "arc-toss",
    name: "Toss",
    note: "Slower and more aerial. Stays near full size for half the trip, leans hard, then goes all at once. Thrown rather than filed.",
    duration: 640,
    easeX: "outQuad",
    easeY: "inCubic",
    press: 0.09,
    lift: 40,
    liftFrac: 0.3,
    leanAmplify: 4,
    leanMax: 50,
    origin: 78,
    s1: 1.09,
    s2: 0.88,
    s3: 0.5,
    endScale: 0.12,
    endSquash: 0.6,
    swallowFrom: 0.7,
    fadeFrom: 0.82,
  },
  {
    ...ARC_BASE,
    id: "arc-whip",
    name: "Whip",
    note: "Leaves on an expo, so most of the distance is gone in the first third. Big lean that snaps level at the end. Reflex, not deliberation.",
    duration: 420,
    easeX: "outExpo",
    easeY: "inHard",
    press: 0.06,
    lift: 18,
    liftFrac: 0.18,
    leanAmplify: 5,
    leanMax: 56,
    origin: 72,
    s1: 1.07,
    s2: 0.8,
    s3: 0.38,
    endScale: 0.14,
    endSquash: 0.5,
    swallowFrom: 0.66,
    fadeFrom: 0.78,
  },
  {
    ...ARC_BASE,
    id: "arc-suck",
    name: "Suck",
    note: "Both axes accelerate, so it never slows down — the tab pulls it in rather than the card flying there. Barely a pop. The fastest of the set.",
    duration: 380,
    easeX: "inOutSine",
    easeY: "inCubic",
    press: 0.04,
    lift: 10,
    liftFrac: 0.14,
    leanAmplify: 1.8,
    leanMax: 22,
    origin: 55,
    s1: 1.02,
    s2: 0.5,
    s3: 0.2,
    endScale: 0.1,
    endSquash: 0.4,
    swallowFrom: 0.5,
    fadeFrom: 0.62,
  },
];

export const LAUNCH_VARIANT = {
  id: "launch",
  name: "Launch & file",
  group: "Other",
  note: "The card drops away under the nav, holds there, then rises back over it and lands. Crossing the bar in both directions is the whole idea.",
  duration: 820,
  dropScale: 0.34,
  endScale: 0.17,
  clearance: 44,
  sink: 64,
};

/* ═══════════════════════════════════════════════════════════════════════
   GLOBALS — everything that is not per-variant.
   ═══════════════════════════════════════════════════════════════════════ */
export const GLOBALS = {
  /* WHICH ENGINE runs the grid reflow. Both do the same job; they disagree
     about who measures.

       flip   Read every tile's box, change the DOM, read again, hand the
              browser the difference. Two forced layouts, then N compositor
              animations. Interruptible — a second filter tap retargets the
              tiles from wherever they are, because each one is an independent
              animation on a live element.

       view   document.startViewTransition. The browser snapshots the old
              frame, takes the new one, and tweens between them itself. No
              measuring, and exits are free — a tile with an old snapshot and
              no new one fades out without being asked. The cost is that a
              transition is atomic: it owns the frame until it finishes, it
              cannot be redirected mid-flight, and a second one has to skip
              the first. Input is inert for its duration.

     Neither is meaningfully faster here. 24 tiles is nothing for either, and
     both animate on the compositor once they start. Pick on FEEL: view
     transitions are cleaner to write and give you exits for nothing; FLIP
     survives being interrupted, which matters if you tap filters quickly. */
  reflowMode: "flip",

  /* The grid closing behind a filed card, and opening again for one that
     comes back. */
  reflowDur: 380,
  reflowEase: "hover",

  /* A tile LEAVING because it no longer matches — a filter cut it, not a
     save. Nothing carries it away, so if it is not animated it simply
     disappears and the neighbours close over a hole that was never there.
     The tile is detached by React and re-parented into an overlay pinned at
     the box it just vacated, so it can fade from where it was rather than
     from wherever the reflow has since moved things.

     A saved card does NOT use this: the flying clone already IS its exit. */
  exitDur: 260,
  exitEase: "outQuad",
  exitScale: 0.88,

  /* A tile ARRIVING — the undo, or a card removed from Collection. FLIP has
     no "before" box for it, so it needs its own entrance: it scales up into
     the gap its neighbours are opening rather than fading in on the spot. */
  enterDur: 420,
  enterEase: "outBack",
  enterScale: 0.82,
  enterLift: 14,

  /* The hit. The tab is struck from above so it goes DOWN first, then
     overshoots up, then settles — a struck object recoils away from the
     impact before it returns, and getting that order backwards is what makes
     most "bounce" feedback read as a wobble instead of a hit. */
  recoilDur: 520,
  recoilDepth: 5,
  recoilRebound: 3,

  /* Fraction of the flight after which the card counts as landed. The tab's
     count does not move until then — a number appearing while the card is
     still in the air says the save already happened somewhere else. */
  landAt: 0.86,

  /* How long the undo stays up. Long enough to notice and reach, short enough
     that it is gone before it becomes furniture. */
  undoMs: 3000,
};

/* Back-compat named exports, so nothing outside has to know about the store. */
export const REFLOW = { duration: GLOBALS.reflowDur, easing: easeValue(GLOBALS.reflowEase) };
export const RECOIL = {
  duration: GLOBALS.recoilDur,
  depth: GLOBALS.recoilDepth,
  rebound: GLOBALS.recoilRebound,
};
export const LAND_AT = GLOBALS.landAt;
export const UNDO_MS = GLOBALS.undoMs;

/* ═══════════════════════════════════════════════════════════════════════
   THE PANEL SCHEMA

   The config UI renders from this and nothing else. `range` rows become
   sliders, `ease` rows become curve pickers, `seg` rows become segmented
   controls. Order here is the order on screen.
   ═══════════════════════════════════════════════════════════════════════ */

const range = (key, label, min, max, step, unit, help) => ({
  type: "range",
  key,
  label,
  min,
  max,
  step,
  unit,
  help,
});

/* The dive rows, once. Both schemas below splice them in, because both bases
   carry the DIVE numbers and either can be handed a covered card. */
const DIVE_ROWS = [
  range("underDurScale", "Dive takes longer", 1, 2.5, 0.05, "×dur"),

  range(
    "fallBy",
    "Faller · slack past bar",
    0,
    240,
    4,
    "px",
    "The distance itself is solved from where the bar is — this is the extra it travels once its top edge is already under it.",
  ),
  range("fallFrac", "Faller · time", 0.15, 1, 0.01, "×dur"),
  { type: "ease", key: "fallEase", label: "Faller · curve" },
  range(
    "fallScale",
    "Faller · size",
    0.2,
    1,
    0.01,
    "×",
    "What it has shrunk to by the time it is behind the bar. The riser is born at this size, which is what makes the two clones read as one card.",
  ),
  range("fallFadeAt", "Faller · fades at", 0.05, 1, 0.01, "×dur"),

  range(
    "underWidth",
    "Riser · landing box",
    0.3,
    3,
    0.05,
    "× icon",
    "The box it lands IN, measured against the tab icon. Arrival is not animated toward the target — the box is the target.",
  ),
  range(
    "underBorn",
    "Riser · birth size",
    0.4,
    2,
    0.05,
    "× faller",
    "1 is continuous: it comes back up exactly the size the faller went away.",
  ),
  range(
    "underGap",
    "Gap between clones",
    0,
    0.3,
    0.01,
    "×dur",
    "Nothing on screen between the faller going behind the bar and the riser clearing it. The riser waits on the fall, however long that card's fall turns out to be.",
  ),
  range("riseAt", "Riser · starts at", 0, 0.8, 0.01, "×dur"),
  range("riseFrac", "Riser · climb time", 0.15, 1, 0.01, "×dur", "Longer is the 'not so fast' climb."),
  { type: "ease", key: "riseEase", label: "Riser · climb curve" },
  range("clearBy", "Riser · clears bar by", 0, 240, 2, "px", "How far past the footer's top edge the box gets before it turns over. Low is a card peeking out; high is a card that went and came back."),
  range(
    "dropAt",
    "Riser · drops at",
    0.2,
    1,
    0.01,
    "×dur",
    "Set this to climb-start + climb-time and the two stop overlapping — the card comes to a dead stop in mid-air. Earlier is a ballistic apex.",
  ),
  range("dropFrac", "Riser · drop time", 0.08, 0.6, 0.01, "×dur"),
  { type: "ease", key: "dropEase", label: "Riser · drop curve" },

  range(
    "arcBy",
    "Riser · arc",
    0,
    160,
    2,
    "px",
    "How far to one side it starts. X eases to zero against the climb's Y, which is a quarter-ellipse — the same two-axis trick as the genie arc. The faller cannot do this; the riser can, because it starts and lands in the same column.",
  ),
  {
    type: "seg",
    key: "arcSide",
    label: "Riser · arc from",
    options: [
      { id: "auto", label: "Auto" },
      { id: "left", label: "Left" },
      { id: "right", label: "Right" },
    ],
  },
  { type: "ease", key: "arcEase", label: "Riser · arc curve" },

  range(
    "tiltBy",
    "Riser · tilt",
    0,
    24,
    0.5,
    "°",
    "Leans into the lateral travel, on the arc's side and the arc's window, and squares up by the landing — arrival has to be flat to the bookmark. Past about ten degrees it stops being a bank.",
  ),
  { type: "ease", key: "tiltEase", label: "Riser · tilt curve" },

  range(
    "veilFade",
    "Veil · ramp",
    0,
    60,
    1,
    "px",
    "A short mask pinned to the BOTTOM OF THE VIEWPORT, easing the riser in as it climbs on screen. Safari does not give the shell an opaque bottom strip, so the clip that should be invisible is a hard cut. Long ramps read as the card going translucent.",
  ),
  range(
    "veilInset",
    "Veil · lifted off the edge",
    0,
    40,
    1,
    "px",
    "How far above the viewport's bottom edge the ramp finishes. 0 puts it right on the edge.",
  ),

  {
    type: "seg",
    key: "shrinkAt",
    label: "Riser · shrinks",
    options: [
      { id: "drop", label: "On the way in" },
      { id: "rise", label: "On the way up" },
    ],
  },

];

const DIVE_HELP =
  "TWO clones. The faller slides straight down off the tile, shrinking, and goes behind the bar; the riser is born at the Collection column below the screen, at the size the faller left at, climbs behind the footer on a slight arc, clears it and drops in — shrinking only on the way in. They are never on screen together: the riser's timeline waits on the fall. The lateral MOVE between columns is the gap between the two clones, not an animation, which is why the faller can never bend.";

export const ARC_KNOBS = [
  {
    section: "Path",
    rows: [
      range("duration", "Duration", 200, 1400, 10, "ms"),
      { type: "ease", key: "easeX", label: "Across" },
      { type: "ease", key: "easeY", label: "Down" },
    ],
    help: "Two axes on two curves is what bends the line. Matching out-then-in traces a circle; swapping them mirrors the bow.",
  },
  {
    section: "Departure",
    rows: [
      range("press", "Press", 0, 0.24, 0.005, "", "Squash against the pivot before it leaves."),
      range("lift", "Hop", 0, 90, 1, "px", "Superposed on the travel, so it pops up and then falls."),
      range("liftFrac", "Hop time", 0.05, 0.45, 0.01, "×dur"),
      { type: "ease", key: "liftEase", label: "Hop curve" },
    ],
  },
  {
    section: "Bank",
    rows: [
      {
        type: "seg",
        key: "leanMode",
        label: "Mode",
        options: [
          { id: "path", label: "Follow path" },
          { id: "bump", label: "Free bump" },
        ],
      },
      range("leanAmplify", "Lean gain", 0, 4, 0.05, "×", "Multiplies the real tangent angle. 1.0 is physically exact."),
      range("leanMax", "Lean cap", 0, 80, 1, "°"),
      range("leanIn", "Blend in over", 0, 0.4, 0.01, "×dur", "Frame one has to be the tile exactly, so the orientation fades up from square."),
      range("leanOut", "Blend out over", 0, 0.5, 0.01, "×dur", "And arrival has to be square to the tab."),
      range("leanAt", "Bump starts at", 0, 0.5, 0.01, "×dur", "Free-bump mode only."),
      range("leanFrac", "Bump time", 0.1, 0.8, 0.01, "×dur", "Free-bump mode only."),
      { type: "ease", key: "leanEase", label: "Bump curve" },
      range("origin", "Rotation pivot", 30, 95, 1, "%", "How far down the card it turns about. Low means the bottom edge leads."),
      range("scaleOrigin", "Scale pivot", 0, 100, 1, "%", "Centre, or the card walks off its own target as it shrinks."),
    ],
  },
  {
    section: "Shape",
    rows: [
      range("s1", "Release", 0.9, 1.3, 0.005, "×"),
      range("s2", "Mid", 0.2, 1.1, 0.01, "×"),
      range("s3", "Late", 0.05, 0.9, 0.01, "×"),
      range("endScale", "Arrival", 0.04, 0.4, 0.005, "×"),
      range("endSquash", "Arrival squash", 0.2, 1, 0.01, "×", "Narrower than tall on arrival — pulled through a slot."),
    ],
  },
  {
    section: "Approach",
    rows: [
      {
        type: "seg",
        key: "approach",
        label: "Mode",
        options: [
          { id: "auto", label: "Auto" },
          { id: "over", label: "Over" },
          { id: "under", label: "Under" },
        ],
      },
      range(
        "underAt",
        "Go under when",
        0.01,
        1,
        0.01,
        "covered",
        "How much of the card the bar has to cover before it dives. 0.02 = any of it at all.",
      ),
      ...DIVE_ROWS,

      range("liftBoost", "Low-card hop gain", 0, 4, 0.1, "×", "OVER only. A diving card never hops."),
    ],
    help: DIVE_HELP,
  },
  {
    section: "Exit",
    rows: [
      range("swallowFrom", "Swallow at", 0.2, 1, 0.01, "×dur", "Clipped from the leading edge, so it goes INTO the bookmark."),
      range("fadeFrom", "Fade at", 0.2, 1, 0.01, "×dur"),
    ],
  },
];

export const LAUNCH_KNOBS = [
  {
    section: "Launch",
    rows: [
      range("duration", "Duration", 300, 1600, 10, "ms"),
      range("dropScale", "Size behind bar", 0.1, 0.8, 0.01, "×"),
      range("endScale", "Arrival", 0.04, 0.4, 0.005, "×"),
      range("sink", "Sink past bar", 0, 200, 2, "px"),
      range("clearance", "Rise above bar", 0, 160, 2, "px"),
    ],
  },
];

export const GLOBAL_KNOBS = [
  {
    section: "Grid",
    rows: [
      {
        type: "seg",
        key: "reflowMode",
        label: "Engine",
        options: [
          { id: "flip", label: "FLIP" },
          { id: "view", label: "View transition" },
        ],
      },
      range("reflowDur", "Close gap", 120, 900, 10, "ms"),
      { type: "ease", key: "reflowEase", label: "Close curve" },
      range("exitDur", "Leave", 0, 700, 10, "ms"),
      { type: "ease", key: "exitEase", label: "Leave curve" },
      range("exitScale", "Leave to", 0.5, 1, 0.01, "×"),
      range("enterDur", "Come back", 120, 900, 10, "ms"),
      { type: "ease", key: "enterEase", label: "Return curve" },
      range("enterScale", "Return from", 0.4, 1, 0.01, "×"),
      range("enterLift", "Return rise", 0, 40, 1, "px"),
    ],
    help: "FLIP measures every tile twice and animates the difference; view transitions let the browser tween its own snapshots. Try a filter chip on each. FLIP can be interrupted mid-flight, a view transition cannot; a view transition gives you the leave animation for free. On this many tiles the speed is the same.",
  },
  {
    section: "Tab",
    rows: [
      range("recoilDur", "Recoil", 160, 1000, 10, "ms"),
      range("recoilDepth", "Recoil down", 0, 16, 0.5, "px"),
      range("recoilRebound", "Recoil up", 0, 16, 0.5, "px"),
      range("landAt", "Counts as landed", 0.4, 1, 0.01, "×dur"),
      range("undoMs", "Undo window", 800, 8000, 100, "ms"),
    ],
  },
];

/* ═══════════════════════════════════════════════════════════════════════
   PATH VARIANTS — a real curve, not two curves pretending to be one

   Everything above builds the arc out of two independent axis animations and
   hopes their product looks like a path. It mostly does, but the shape is an
   emergent property of two easing curves, which is why it kept having to be
   argued with: you cannot move a control point, because there are no control
   points. There is no curve anywhere in the system.

   `offset-path` is the curve. One authored cubic Bézier in real pixels, and
   the browser walks the element along it — `offset-distance` from 0% to 100%
   is the ONLY animated property. Which separates the two things that were
   tangled together:

       THE SHAPE   is the path. Four numbers: two control points.
       THE SPEED   is one easing along it. Nothing to do with the shape.

   Change the speed and the trajectory is untouched. Change the shape and the
   timing is untouched. That was never true of the two-axis version, where
   every easing change silently rebent the path.

   The hop is in the path too — a control point above the start line IS the
   lob, so there is no separate bump element to keep in sync.

   And rotation is finally free: a cubic's tangent is its analytic derivative,
   B'(t) = 3(1−t)²(C₁−P₀) + 6(1−t)t(C₂−C₁) + 3t²(P₃−C₂), so the angle comes
   from the same four points that define the shape. They cannot disagree.
   ═══════════════════════════════════════════════════════════════════════ */

/* Control points as FRACTIONS OF THE TRIP, not pixels — so one row is the
   same gesture whether the card is going 80px or 600px.

     c1 near (1, 0)   leaves flat and sideways
     c1 near (0, 1)   leaves straight down
     c1y NEGATIVE     leaves UPWARD — this is the lob, and it is just a number
     c2 near (1, 0)   arrives from the side
     c2 near (0.5, 1) arrives from above, dropping in                        */
const PATH_BASE = {
  group: "Path",
  duration: 520,
  ease: "inOutSine",

  c1x: 0.55,
  c1y: 0,
  c2x: 1,
  c2y: 0.4,

  /* Rotation, from the same curve.

     A card BANKS, it does not align. Exact alignment puts a horizontally
     travelling card flat on its side, which is right for an arrow and absurd
     for a piece of cardboard — so `amount` is well under 1 and the cap does
     the rest. 26° is a lean; 46° was a card falling over. */
  rotate: "tangent",
  rotateAmount: 0.55,
  rotateMax: 26,
  rotateIn: 0.14,
  rotateOut: 0.24,
  origin: 66,

  /* ── Shape ───────────────────────────────────────────────────────────────
     FRONT-LOADED, because size is the only depth cue there is. The stops sit
     at 16 / 34 / 68 / 100% against a LINEAR timing function, so the ramp is
     read literally: whatever is written here is where the card is.

     The old row — 1.05 / 0.74 / 0.42 / 0.16 — spent the first third of the
     trip within a quarter of full size and then collapsed. That reads as a
     full-size card being deleted at the last moment rather than an object
     going away from you: it was still ~0.42 of a tile at 68%, most of the way
     down, which is a card you can still read arriving at a 24px bookmark.

     Shrinking hard EARLY is what makes the drop physical. By 34% it is
     already half size — it has committed to leaving — and by 68% it is a
     token, so the last third is a small thing being filed rather than a large
     thing being crushed. Arrival is barely changed; it was never the problem,
     and it is sized to the bookmark it lands on. */
  press: 0.07,
  s1: 1.04,
  s2: 0.55,
  s3: 0.24,
  endScale: 0.14,
  endSquash: 0.52,
  scaleOrigin: 50,

  swallowFrom: 0.66,
  fadeFrom: 0.78,

  // A path variant still dives when the footer covers the card — so it needs
  // the numbers to do it with. Without this spread every dive knob read
  // undefined here, and the default variant is one of these.
  approach: "auto",
  underAt: 0.02,
  ...DIVE,
};

export const PATH_VARIANTS = [
  {
    ...PATH_BASE,
    id: "path-swoop",
    name: "Swoop",
    note: "Leaves flat and sideways, arrives dropping in from above. The control points are (0.55, 0) and (1, 0.4) — commit to the destination, then land on it.",
  },
  {
    ...PATH_BASE,
    id: "path-lob",
    name: "Lob",
    note: "The first control point sits ABOVE the start line, so the card leaves upward and comes over the top. The hop is not a separate animation here — it is one negative number.",
    duration: 580,
    ease: "outSine",
    c1x: 0.3,
    c1y: -0.38,
    c2x: 0.92,
    c2y: 0.42,
    rotateAmount: 0.62,
    rotateMax: 32,
    s1: 1.07,
  },
  {
    ...PATH_BASE,
    id: "path-fall",
    name: "Fall",
    note: "Falls away first and swings across underneath. The mirror of Swoop, and the honest version of what the old Drop was trying to be.",
    duration: 540,
    ease: "inOutSine",
    c1x: 0,
    c1y: 0.52,
    c2x: 0.48,
    c2y: 1,
    rotateAmount: 0.6,
  },
  {
    ...PATH_BASE,
    id: "path-hook",
    name: "Hook",
    note: "Both control points pushed past the end, so the card overshoots and hooks back into the tab. Fastest of the four and the most obviously thrown.",
    duration: 440,
    ease: "outQuad",
    c1x: 0.7,
    c1y: -0.12,
    c2x: 1.18,
    c2y: 0.62,
    rotateAmount: 0.7,
    rotateMax: 34,
    // Hook has always shrunk harder than the base — it is the thrown one. Kept
    // in the same relation now the base itself is front-loaded, or these two
    // rows would have inverted and Hook would be the gentlest of the four.
    s2: 0.46,
    s3: 0.17,
  },
];

export const isPath = (id) => String(id).startsWith("path-");

export const PATH_KNOBS = [
  {
    section: "Speed",
    rows: [
      range("duration", "Duration", 200, 1400, 10, "ms"),
      { type: "ease", key: "ease", label: "Along the path" },
    ],
    help: "One easing, for how fast it travels. It cannot change the shape of the trip — that is what the path is for.",
  },
  {
    section: "The curve",
    rows: [
      range("c1x", "Leave · across", -0.5, 1.5, 0.01, "×trip", "1 leaves flat and sideways, 0 leaves straight down."),
      range("c1y", "Leave · down", -1, 1.5, 0.01, "×trip", "NEGATIVE leaves upward. This is the lob, and it is the whole of it."),
      range("c2x", "Arrive · across", -0.5, 1.5, 0.01, "×trip"),
      range("c2y", "Arrive · down", -1, 1.5, 0.01, "×trip", "Near 1 drops in from directly above the bookmark."),
    ],
    help: "The two control points of one cubic Bézier, as fractions of the trip — so the same row is the same gesture at any distance. Push either past 1 and the card overshoots and hooks back.",
  },
  {
    section: "Rotation",
    rows: [
      {
        type: "seg",
        key: "rotate",
        label: "Mode",
        options: [
          { id: "tangent", label: "Bank" },
          { id: "none", label: "None" },
        ],
      },
      range("rotateAmount", "Amount", 0, 2, 0.05, "×", "1.0 aligns the card exactly to the curve — which lays it flat on its side when travelling sideways. Well under 1 is a bank."),
      range("rotateMax", "Cap", 0, 90, 1, "°", "Does most of the work. Past about 35 it stops reading as a lean."),
      range("rotateIn", "Square at start for", 0, 0.4, 0.01, "×dur", "Frame one has to be the tile exactly."),
      range("rotateOut", "Square at end for", 0, 0.5, 0.01, "×dur", "And it has to go into the bookmark straight."),
      range("origin", "Rotation pivot", 30, 95, 1, "%"),
    ],
    help: "Taken from the curve's own derivative, so the same four numbers drive the shape and the tilt. Measured as the angle away from VERTICAL, which is bounded and cannot wrap — a card rising is upright, never inverted.",
  },
  {
    section: "Shape",
    rows: [
      range("press", "Press", 0, 0.24, 0.005, ""),
      range("s1", "Release", 0.9, 1.3, 0.005, "×"),
      range("s2", "Mid", 0.2, 1.1, 0.01, "×"),
      range("s3", "Late", 0.05, 0.9, 0.01, "×"),
      range("endScale", "Arrival", 0.04, 0.4, 0.005, "×"),
      range("endSquash", "Arrival squash", 0.2, 1, 0.01, "×"),
      range("scaleOrigin", "Scale pivot", 0, 100, 1, "%", "Centre, or it walks off the bookmark as it shrinks."),
    ],
  },
  {
    section: "Approach",
    rows: [
      {
        type: "seg",
        key: "approach",
        label: "Mode",
        options: [
          { id: "auto", label: "Auto" },
          { id: "over", label: "Over" },
          { id: "under", label: "Under" },
        ],
      },
      range(
        "underAt",
        "Go under when",
        0.01,
        1,
        0.01,
        "covered",
        "How much of the card the bar has to cover before it dives. 0.02 = any of it at all.",
      ),
      ...DIVE_ROWS,
    ],
    help: `${DIVE_HELP} A curve has no more room under the footer than an arc does, so a path variant dives on exactly the same rule.`,
  },
  {
    section: "Exit",
    rows: [
      range("swallowFrom", "Swallow at", 0.2, 1, 0.01, "×dur"),
      range("fadeFrom", "Fade at", 0.2, 1, 0.01, "×dur"),
    ],
  },
];


/* ═══════════════════════════════════════════════════════════════════════
   SPRING — behind the `spring` flag (/psa?spring=1)

   How iOS actually does this, which is the question that prompted it:

     · THERE IS NO PATH. An icon flying into the Dynamic Island travels in a
       straight line. The curve people think they see is the scale changing,
       not the position bending.
     · THERE IS NO ROTATION. Not a degree, ever.
     · THERE ARE NO KEYFRAMES. Position and scale are driven by ONE spring —
       the same spring, the same instant. That is the whole reason it reads as
       a single physical object rather than several properties animated into
       agreement.
     · THE DESTINATION REACTS. The Island expands to receive the thing.

   And it has TWO numbers. Not fifty.

   That is not a coincidence, it is the point. A spring is a physical system,
   so everything attached to one is already in agreement — there is nothing
   left to tune INTO agreement. Almost every knob above exists to reconcile
   independent timelines that a spring never creates in the first place.
   ═══════════════════════════════════════════════════════════════════════ */
const SPRING_BASE = {
  group: "Spring",
  /* PERCEPTUAL duration: roughly when it looks finished, not when the maths
     stops. A spring is asymptotic and never truly arrives, so the real settle
     time is computed from the damping rather than guessed at. */
  duration: 420,
  bounce: 0.18,
  endScale: 0.16,
  fadeFrom: 0.72,
};

export const SPRING_VARIANTS = [
  {
    ...SPRING_BASE,
    id: "spring-ios",
    name: "iOS",
    note: "One spring drives position and scale together, in a straight line, with no rotation at all. Two numbers. This is the shape of the thing Apple actually ships.",
  },
  {
    ...SPRING_BASE,
    id: "spring-flat",
    name: "No bounce",
    note: "Critically damped — the fastest approach that never overshoots. Quieter, and the right choice if the save is going to happen fifty times a session.",
    duration: 380,
    bounce: 0,
  },
  {
    ...SPRING_BASE,
    id: "spring-loose",
    name: "Springy",
    note: "Visibly elastic. Too much for a save you repeat, useful for feeling where the limit is.",
    duration: 520,
    bounce: 0.42,
  },
];

export const isSpring = (id) => String(id).startsWith("spring-");

export const SPRING_KNOBS = [
  {
    section: "Spring",
    rows: [
      range("duration", "Duration", 150, 900, 10, "ms", "Perceptual — when it looks finished. The real settle runs a little past it."),
      range("bounce", "Bounce", -0.4, 0.6, 0.02, "", "0 never overshoots. 0.2 is the iOS house style. Negative is overdamped."),
      range("endScale", "Arrival size", 0.04, 0.4, 0.005, "×"),
      range("fadeFrom", "Fades at", 0.3, 1, 0.01, "×settle"),
    ],
    help: "Four numbers, and two of them are the motion. Position and scale are two readings of one spring, so there is nothing to keep in sync — which is why the list is this short.",
  },
];

/* ═══════════════════════════════════════════════════════════════════════
   THE REGISTRY

   Last in the file on purpose: it names every variant list, so it has to come
   after all of them. Path variants lead — they are the ones with an actual
   curve in them.
   ═══════════════════════════════════════════════════════════════════════ */
export const SAVE_VARIANTS = [
  ...SPRING_VARIANTS,
  ...PATH_VARIANTS,
  ...ARC_VARIANTS,
  LAUNCH_VARIANT,
];

/* Groups the panel hides unless a flag is on. The variants stay in the
   registry either way so getTuning() never has a hole in it — the flag gates
   what is OFFERED, not what exists. */
export const FLAGGED_GROUPS = { Spring: "spring" };

/* Fall, not Swoop. For a card clear of the bar — the OVER approach — the two
   differ in which axis commits first, and falling away before swinging across
   is the one that agrees with the dive sitting underneath it: both start with
   the card dropping. Swoop carries sideways first, so the same tap read as two
   unrelated gestures depending on which row the tile was in. */
export const DEFAULT_VARIANT = "path-fall";

export const isArc = (id) => id !== "launch" && !isPath(id) && !isSpring(id);

export function getTuning(id) {
  return SAVE_VARIANTS.find((v) => v.id === id) ?? SAVE_VARIANTS[0];
}

/* Which schema the panel renders for a given variant. */
export function knobsFor(id) {
  if (isSpring(id)) return SPRING_KNOBS;
  if (isPath(id)) return PATH_KNOBS;
  if (isArc(id)) return ARC_KNOBS;
  return LAUNCH_KNOBS;
}
