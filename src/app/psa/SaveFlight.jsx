"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

import { haptic } from "@/lib/haptics";
import {
  DEFAULT_VARIANT,
  GLOBALS,
  easeFn,
  easeInvert,
  easeValue,
  getTuning,
  isArc,
  isPath,
  isSpring,
} from "./saveMotion";
import { samplePath, smoothstep, tipAngle } from "./flightPath";
import { sampleSpring } from "./spring";
import "./saveFlight.css";

/* ─────────────────────────────────────────────────────────────────────────
   SaveFlight — the card's trip from the grid to the Collection tab.

   The technique, in full:

     · the flying card is a CLONED NODE in a layer, never the tile itself
     · its whole flight is CSS @keyframes. Nothing drives values per frame.
     · JS measures once at the tap and writes the result out as custom
       properties — every stop in the keyframes reads from those, which is
       why every arc feel shares one keyframe block, and why the config panel
       can retune the motion live without touching a stylesheet
     · the grid closing its gap is a FLIP, using el.animate(), because a
       per-element distance cannot be known until the layout has changed
     · the flight itself never uses a view transition — the panel can swap
       the GRID REFLOW to one to compare, but the courier stays hand-driven

   Once the clone is attached, the main thread has nothing left to do.

   This file also owns the TUNING STORE: the armed variant, the per-variant
   overrides the panel writes, and the globals. Everything is held in refs
   alongside state so a flight fired mid-drag reads the value under the
   user's finger rather than the one from the last commit.
   ───────────────────────────────────────────────────────────────────────── */

const FlightCtx = createContext(null);

export function useSaveFlight() {
  return useContext(FlightCtx);
}

/* A variant plus whatever the panel has changed on it. Kept as a separate
   layer rather than mutating the variant so "Reset" is a delete, and so the
   panel can mark exactly which knobs have been moved. */
function resolve(variantId, overrides) {
  return { ...getTuning(variantId), ...(overrides[variantId] ?? {}) };
}

export function SaveFlightProvider({ children }) {
  const [variant, setVariant] = useState(DEFAULT_VARIANT);
  const [overrides, setOverrides] = useState({});
  const [globals, setGlobals] = useState(GLOBALS);

  /* Bumped when a card actually arrives. The tab's count and the undo both
     read off this, so they appear when the card lands rather than when the
     finger lifts. */
  const [landings, setLandings] = useState(0);

  const layerRef = useRef(null);
  const targetRef = useRef(null);

  const tuning = useMemo(() => resolve(variant, overrides), [variant, overrides]);
  const tuningRef = useRef(tuning);
  tuningRef.current = tuning;
  const globalsRef = useRef(globals);
  globalsRef.current = globals;

  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  /* The one haptic worth the whole file. Every variant — arc, path, spring,
     dive, and the degenerate-geometry bail — funnels through here at the
     moment the clone reaches the tab, so hanging the note on `land` means the
     buzz stays welded to the impact no matter which flight ran or how long it
     took. Firing it at tap time instead would put the feedback a few hundred
     ms ahead of the thing it is describing. */
  const land = useCallback(() => {
    haptic("land");
    setLandings((n) => n + 1);
  }, []);

  /* The Collection tab registers itself so nothing has to go looking for it in
     the DOM, and so the target survives the tab bar being re-keyed. It is also
     where the recoil numbers get written out, so those keyframes read from the
     store like everything else — including while a slider is being dragged. */
  const registerTarget = useCallback((el) => {
    targetRef.current = el;
    if (el) writeRecoil(el, globalsRef.current);
  }, []);
  useEffect(() => {
    if (targetRef.current) writeRecoil(targetRef.current, globals);
  }, [globals]);

  /* Restarting an animation means taking the attribute off, forcing a reflow,
     and putting it back — re-matching the same rule leaves a running animation
     exactly where it was. */
  const hit = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    el.removeAttribute("data-hit");
    void el.offsetWidth;
    el.setAttribute("data-hit", "");
  }, []);

  /* The grid reflow, bound to the live globals — so undo and a filed card
     close and open on the numbers currently in the panel. */
  const flip = useCallback((mutate, gridEl, opts) => {
    flipGrid(mutate, gridEl, globalsRef.current, opts);
  }, []);

  const save = useCallback(
    (originEl, commit) => {
      const target = targetRef.current;
      const layer = layerRef.current;

      if (reducedRef.current || !originEl || !target || !layer) {
        commit();
        land();
        if (!reducedRef.current) hit();
        return;
      }

      runFlight({
        originEl,
        target,
        layer,
        commit,
        hit,
        land,
        tuning: tuningRef.current,
        globals: globalsRef.current,
      });
    },
    [hit, land],
  );

  /* ── The panel's write side ─────────────────────────────────────────── */
  const setKnob = useCallback(
    (key, value) =>
      setOverrides((o) => ({ ...o, [variant]: { ...(o[variant] ?? {}), [key]: value } })),
    [variant],
  );
  const resetVariant = useCallback(
    () => setOverrides((o) => ({ ...o, [variant]: undefined })),
    [variant],
  );
  const setGlobal = useCallback((key, value) => setGlobals((g) => ({ ...g, [key]: value })), []);
  const resetGlobals = useCallback(() => setGlobals(GLOBALS), []);

  const value = useMemo(
    () => ({
      save,
      flip,
      registerTarget,
      landings,
      layerRef,
      // tuning store
      variant,
      setVariant,
      tuning,
      overrides: overrides[variant] ?? {},
      setKnob,
      resetVariant,
      globals,
      setGlobal,
      resetGlobals,
    }),
    [
      save,
      flip,
      registerTarget,
      landings,
      variant,
      tuning,
      overrides,
      setKnob,
      resetVariant,
      globals,
      setGlobal,
      resetGlobals,
    ],
  );

  return <FlightCtx.Provider value={value}>{children}</FlightCtx.Provider>;
}

function writeRecoil(el, g) {
  el.style.setProperty("--recoil-dur", `${g.recoilDur}ms`);
  el.style.setProperty("--recoil-depth", `${g.recoilDepth}px`);
  el.style.setProperty("--recoil-rebound", `${-g.recoilRebound}px`);
}

/* The layer is rendered by the app shell rather than the provider, because it
   has to sit inside the shell's stacking context — the launch variant and the
   under-approach both step a clone's z-index across the footer nav, and that
   is only meaningful if the clone and the nav are siblings in the same
   context. */
export function SaveFlightLayer() {
  const ctx = useContext(FlightCtx);
  return <div className="psa-flight-layer" ref={ctx?.layerRef} aria-hidden="true" />;
}

/* ── The grid reflow ──────────────────────────────────────────────────────
   Can CSS do "the remaining tiles slide into the gap" on its own? No. CSS only
   ever sees the final layout; there is no mechanism to animate an element from
   the position it held before a DOM change. Two engines can, and the panel
   swaps between them — see GLOBALS.reflowMode for the trade.
   ───────────────────────────────────────────────────────────────────────── */
const tiles = (grid) => [...grid.children].filter((el) => el.dataset.cardId);

export function flipGrid(mutate, gridEl, g = GLOBALS, opts = {}) {
  const grid = gridEl ?? document.querySelector(".psa-grid");
  if (!grid) {
    mutate();
    return;
  }
  /* The save forces FLIP whatever the panel says. Its tile is already being
     carried off by the flying clone, and a view transition would fade a second
     copy out from under it — the same card leaving twice. The toggle is about
     the grid REFLOW: filters and undo. */
  if (
    !opts.forceFlip &&
    g.reflowMode === "view" &&
    typeof document.startViewTransition === "function"
  ) {
    viewGrid(mutate, grid, g);
    return;
  }
  manualFlip(mutate, grid, g, opts);
}

/* ── Engine 1: FLIP ───────────────────────────────────────────────────────
   Read every tile's box, change the DOM, read again, hand the browser the
   difference to animate away.

   It works in both directions, but not symmetrically, and that asymmetry is
   the whole shape of this function. Three cases, not one:

     MOVED    a before box and an after box, so it interpolates. This is the
              only case FLIP actually does by itself.
     ARRIVED  no before box, so there is nothing to invert — it would appear
              fully formed in a gap its neighbours are still opening. Gets its
              own entrance instead, scaling up out of that gap.
     LEFT     no after box, and no node either: React took it out of the tree
              before we ever got to measure it. This is the one that reads as
              "it just unmounted", because it did. See exitClones.

   The two forced layout reads are unavoidable and are the entire cost. After
   the animations are handed off they run on the compositor.
   ───────────────────────────────────────────────────────────────────────── */
function manualFlip(mutate, grid, g, opts) {
  clearExits(grid);

  const before = new Map();
  const nodes = new Map();
  // Keyed on the card id, not node identity — React does not guarantee the
  // same DOM node survives a reconcile, but the attribute does.
  for (const el of tiles(grid)) {
    before.set(el.dataset.cardId, el.getBoundingClientRect());
    nodes.set(el.dataset.cardId, el);
  }
  // Grid-relative, so the clones stay put even if removing rows shortens the
  // scroller and the browser clamps scrollTop under us.
  const origin = grid.getBoundingClientRect();

  // flushSync so the new layout exists to be measured on the very next line
  // rather than a frame later.
  flushSync(mutate);

  const reflowEase = easeValue(g.reflowEase);
  const enterEase = easeValue(g.enterEase);
  const survivors = new Set();

  for (const el of tiles(grid)) {
    const id = el.dataset.cardId;
    survivors.add(id);
    const first = before.get(id);

    if (!first) {
      // Arriving. Kill the CSS mount entrance first — it is a staggered
      // 320ms fade meant for a whole grid appearing at once, and letting the
      // two run together gives one tile two different opinions about where it
      // is. This one is not staggered: it is the tile the user just asked for.
      if (g.enterDur > 0) {
        el.style.animation = "none";
        el.animate(
          [
            {
              transform: `translateY(${g.enterLift}px) scale(${g.enterScale})`,
              opacity: 0,
            },
            { transform: "translateY(0) scale(1)", opacity: 1 },
          ],
          { duration: g.enterDur, easing: enterEase, composite: "replace" },
        );
      }
      continue;
    }

    const last = el.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
      { duration: g.reflowDur, easing: reflowEase, composite: "replace" },
    );
  }

  if (opts.exit && g.exitDur > 0) {
    for (const [id, node] of nodes) {
      if (!survivors.has(id)) exitClone(grid, node, before.get(id), origin, g);
    }
  }
}

/* ── Leaving ──────────────────────────────────────────────────────────────
   A tile cut by a filter is gone from the tree by the time we can look at it,
   so there is nothing left to animate. But the NODE still exists — React
   detached it, it did not destroy it, and our map is still holding the
   reference. So it gets re-parented into an overlay pinned over the grid,
   frozen at the box it just vacated, and faded out from there while its old
   neighbours slide across.

   The real node rather than a clone: it is already laid out and its scan is
   already decoded, so there is no frame where a copy is still resolving its
   image. Re-inserting it does restart the CSS mount animation, which is why
   the overlay kills that in psa.css.

   Only a FILTER does this. A saved card is carried off by the flying clone —
   giving it a second, stationary exit would be the same card leaving twice.
   ───────────────────────────────────────────────────────────────────────── */
function exitClone(grid, node, box, origin, g) {
  if (!node || !box) return;

  let layer = grid.querySelector(":scope > .psa-grid-exit");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "psa-grid-exit";
    layer.setAttribute("aria-hidden", "true");
    grid.append(layer);
  }

  node.style.left = `${box.left - origin.left}px`;
  node.style.top = `${box.top - origin.top}px`;
  node.style.width = `${box.width}px`;
  node.style.height = `${box.height}px`;
  layer.append(node);

  const anim = node.animate(
    [
      { opacity: 1, transform: "scale(1)" },
      { opacity: 0, transform: `scale(${g.exitScale})` },
    ],
    { duration: g.exitDur, easing: easeValue(g.exitEase), fill: "forwards" },
  );
  anim.finished.then(
    () => node.remove(),
    () => {},
  );
}

// Anything still fading when the next reflow starts is stale by definition —
// its box belongs to a layout two changes ago.
function clearExits(grid) {
  grid.querySelector(":scope > .psa-grid-exit")?.remove();
}

/* ── Engine 2: view transitions ───────────────────────────────────────────
   The browser does the measuring. Every tile is given a unique
   view-transition-name, the DOM changes inside startViewTransition's callback,
   and the browser tweens its own before-and-after snapshots — position, size
   and cross-fade — without being told any distances.

   Two things make it behave here:

     · the ROOT name is dropped for the duration. By default the whole document
       is captured as one snapshot and cross-faded, which would fade the head,
       the nav and the scrollbar along with the grid. With no root name only
       the named tiles are snapshotted and everything else renders live, which
       is both cheaper and the effect we actually want.
     · durations are custom properties on <html>, because ::view-transition
       pseudos live on the root and cannot see anything scoped further in.
       Same store as FLIP reads, so both engines answer to the same sliders.

   ONE duration for the group, the old snapshot and the new one, and that is
   not laziness. The default cross-fade blends with plus-lighter, which sums to
   exactly the original image only while the two opacities are complements of
   each other. Give the outgoing snapshot its own shorter "leave" time and a
   tile that is merely MOVING — identical pixels either side — dims through
   the middle of its own travel. So the Leave knob belongs to FLIP; here,
   leaving is the same cross-fade as everything else.

   Only one can run at a time, so a second one skips the first. That is the
   real difference from FLIP: this cannot be redirected mid-flight, only
   abandoned.
   ───────────────────────────────────────────────────────────────────────── */
let running = null;

function viewGrid(mutate, grid, g) {
  clearExits(grid);
  running?.skipTransition();

  const tag = () => {
    for (const el of tiles(grid)) el.style.viewTransitionName = `psa-t-${el.dataset.cardId}`;
  };
  const untag = () => {
    for (const el of tiles(grid)) el.style.viewTransitionName = "";
  };

  const root = document.documentElement;
  root.style.setProperty("--psa-vt-dur", `${g.reflowDur}ms`);
  root.style.setProperty("--psa-vt-ease", easeValue(g.reflowEase));
  root.dataset.psaVt = "";

  tag();
  const t = document.startViewTransition(() => {
    flushSync(mutate);
    tag(); // the tiles that just arrived need names before the new capture
  });
  running = t;

  t.finished.finally(() => {
    untag();
    if (running !== t) return;
    running = null;
    delete root.dataset.psaVt;
  });
}

/* ── Which way it goes ────────────────────────────────────────────────────
   A card at the top of the grid has the whole screen to fall through. A card
   in the last row is already sitting half behind the nav, and an arc for that
   one is a two-inch nudge sideways — there is no fall in it, because there is
   nowhere left to fall.

   So the approach is chosen from the geometry, not fixed by the variant:

     OVER    the card is clear of the bar. Press, hop, arc down into the tab.
             The lower it starts, the higher it hops — a card that is close to
             the bar has to get above it before falling makes any sense.

     UNDER   the footer is already covering the card. It drops STRAIGHT down
             past the bar, climbs back up behind it, clears the top edge, and
             only then falls into the tab. No hop: it is below the bar, so up
             is backwards.

   `underAt` defaults to 0.02 — any of the card covered at all is enough. A
   card with even a sliver behind the footer has nothing left to fall through,
   and an arc for that one is a nudge sideways with no drop in it.
   ───────────────────────────────────────────────────────────────────────── */
function measureApproach(tuning, from, target) {
  const nav = target.closest(".psa-tabbar");
  const navTop = nav ? nav.getBoundingClientRect().top : null;

  // How far past the bar's top edge the card's bottom edge already sits, as a
  // fraction of the card's own height. 0 = just touching, 1 = fully behind.
  const lowness =
    navTop == null ? 0 : Math.min(1, Math.max(0, (from.bottom - navTop) / from.height));

  const mode =
    tuning.approach === "over" || tuning.approach === "under"
      ? tuning.approach
      : lowness > 0 && lowness >= tuning.underAt
        ? "under"
        : "over";

  return { mode, lowness, navTop };
}

/* ── The flight ───────────────────────────────────────────────────────────
   Four nested elements, and the nesting IS the animation:

     .psa-flight         owns X travel
       .psa-flight-y     owns Y travel
         .psa-flight-lift  owns the hop, superposed on the travel
           .psa-flight-art  scale, lean, clip, fade

   Two axes on two curves bend the line with no path maths. The hop is its own
   element because a rise and a fall cannot come out of one curve, but two
   nested translateYs add. Rotation lives on the innermost element so it
   composes with the translation instead of fighting it — the card banks
   without its path changing.
   ───────────────────────────────────────────────────────────────────────── */
function runFlight({ originEl, target, layer, commit, hit, land, tuning: armed, globals }) {
  let tuning = armed;
  const from = originEl.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const layerBox = layer.getBoundingClientRect();
  let arc = isArc(tuning.id);

  if (!from.width || !from.height) {
    detach(originEl, layer, commit, globals);
    land();
    hit();
    return;
  }

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);

  /* Which way it goes is decided before anything is written, because the dive
     takes longer than the arc — three moves against one — and every delay
     below is a fraction of the duration. */
  /* The spring is a different physics, not a different curve — no path, no
     rotation, one system. It forks first and shares nothing but the clone. */
  if (isSpring(tuning.id)) {
    runSpring({ originEl, target, layer, commit, hit, land, tuning, globals });
    return;
  }

  const curved = isPath(tuning.id);
  const approach = arc || curved ? measureApproach(tuning, from, target) : null;

  /* A dive is not a variation on the flight, it is a different object graph —
     two clones instead of one — so it forks here rather than threading a flag
     through forty property writes. Path variants dive too: a card the footer
     is covering has no room for a curve either. */
  if (approach?.mode === "under") {
    runDive({ originEl, target, layer, commit, hit, land, tuning, globals, navTop: approach.navTop });
    return;
  }

  if (curved) {
    runPath({ originEl, target, layer, commit, hit, land, tuning, globals });
    return;
  }

  const dur = tuning.duration;

  let leanPlan = null;

  const outer = document.createElement("div");
  outer.className = `psa-flight psa-flight--${arc ? "arc" : "launch"}`;
  outer.style.left = `${from.left - layerBox.left}px`;
  outer.style.top = `${from.top - layerBox.top}px`;
  outer.style.width = `${from.width}px`;
  outer.style.height = `${from.height}px`;
  outer.style.setProperty("--fx", `${dx}px`);
  outer.style.setProperty("--fy", `${dy}px`);
  outer.style.setProperty("--dur", `${dur}ms`);
  outer.style.setProperty("--end-scale", String(tuning.endScale));

  if (arc) {
    const { lowness } = approach;

    // The path itself is two custom properties. That is the entire difference
    // between the arc iterations — same keyframes, different curves.
    outer.style.setProperty("--ease-x", easeValue(tuning.easeX));
    outer.style.setProperty("--ease-y", easeValue(tuning.easeY));
    // Two pivots. `--origin` is where it TURNS (low, so the bottom edge
    // leads); `--scale-origin` is where it SHRINKS (centre, so it converges on
    // the target it was measured against). They are separate elements, which
    // is the whole reason both can be right at once.
    outer.style.setProperty("--origin", `${tuning.origin}%`);
    outer.style.setProperty("--scale-origin", `${tuning.scaleOrigin}%`);
    outer.style.setProperty("--press", String(tuning.press));
    outer.style.setProperty("--end-squash", String(tuning.endSquash));

    outer.style.setProperty("--s1", String(tuning.s1));
    outer.style.setProperty("--s2", String(tuning.s2));
    outer.style.setProperty("--s3", String(tuning.s3));

    /* The hop. It grows with how low the card started: clearing the bar from
       just under it takes more air than from the top of the screen. */
    const lift = tuning.lift * (1 + tuning.liftBoost * lowness);
    outer.style.setProperty("--lift", `${lift}px`);
    outer.style.setProperty("--lift-dur", `${dur * tuning.liftFrac}ms`);
    outer.style.setProperty("--ease-lift", easeValue(tuning.liftEase));

    outer.style.setProperty("--x-delay", "0ms");
    outer.style.setProperty("--x-dur", `${dur}ms`);

    outer.style.setProperty("--swallow-delay", `${dur * tuning.swallowFrom}ms`);
    outer.style.setProperty("--swallow-dur", `${dur * (1 - tuning.swallowFrom)}ms`);
    outer.style.setProperty("--fade-delay", `${dur * tuning.fadeFrom}ms`);
    outer.style.setProperty("--fade-dur", `${dur * (1 - tuning.fadeFrom)}ms`);

    leanPlan = { fx: dx, fy: dy, lift, dur, tuning };
  } else {
    outer.style.setProperty("--drop-scale", String(tuning.dropScale));
    outer.style.setProperty("--sink", `${dy + to.height / 2 + tuning.sink}px`);
    outer.style.setProperty("--clear", `${dy - tuning.clearance}px`);
  }

  const y = document.createElement("div");
  y.className = "psa-flight-y";
  const liftEl = document.createElement("div");
  liftEl.className = "psa-flight-lift";
  // The bank, on its own clock so it turns WITH the travel rather than after.
  const leanEl = document.createElement("div");
  leanEl.className = "psa-flight-lean";
  const art = cloneArt(originEl, { globals, dur });

  leanEl.appendChild(art);
  liftEl.appendChild(leanEl);
  y.appendChild(liftEl);
  outer.appendChild(y);

  /* The tile leaves and the grid closes behind it, for every variant. The
     clone is attached in the same task, so the hole never shows. */
  if (leanPlan) writeLean(leanEl, leanPlan);

  detach(originEl, layer, commit, globals);
  layer.appendChild(outer);

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    outer.remove();
  };
  // animationend BUBBLES, so a child's timeline would otherwise tear the clone
  // down — harmless while everything ends together, but a silent truncation
  // the moment one is retimed. The timeout backs up a backgrounded tab.
  outer.addEventListener("animationend", (e) => {
    if (e.target === outer) cleanup();
  });
  setTimeout(cleanup, dur + 400);

  // The count appears and the tab takes the hit at the same moment: when the
  // card is absorbed, not when it was tapped.
  setTimeout(() => {
    land();
    hit();
  }, dur * globals.landAt);
}



function runPath({ originEl, target, layer, commit, hit, land, tuning, globals }) {
  const from = originEl.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const box = layer.getBoundingClientRect();
  const dur = tuning.duration;

  /* The curve is in DELTAS from the card's own centre, and the clone is placed
     on the tile's box. So u=0 is translate(0, 0) — the clone is the tile,
     exactly, provably, with no coordinate system to get wrong. u=1 is the
     centre-to-centre delta, which lands it on the bookmark. */
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);

  const outer = document.createElement("div");
  outer.className = "psa-flight psa-flight--path";
  outer.style.left = `${from.left - box.left}px`;
  outer.style.top = `${from.top - box.top}px`;
  outer.style.width = `${from.width}px`;
  outer.style.height = `${from.height}px`;

  outer.style.setProperty("--dur", `${dur}ms`);
  outer.style.setProperty("--origin", `${tuning.origin}%`);
  outer.style.setProperty("--scale-origin", `${tuning.scaleOrigin}%`);
  outer.style.setProperty("--press", String(tuning.press));
  outer.style.setProperty("--s1", String(tuning.s1));
  outer.style.setProperty("--s2", String(tuning.s2));
  outer.style.setProperty("--s3", String(tuning.s3));
  outer.style.setProperty("--end-scale", String(tuning.endScale));
  outer.style.setProperty("--end-squash", String(tuning.endSquash));
  outer.style.setProperty("--swallow-delay", `${dur * tuning.swallowFrom}ms`);
  outer.style.setProperty("--swallow-dur", `${dur * (1 - tuning.swallowFrom)}ms`);
  outer.style.setProperty("--fade-delay", `${dur * tuning.fadeFrom}ms`);
  outer.style.setProperty("--fade-dur", `${dur * (1 - tuning.fadeFrom)}ms`);

  const leanEl = document.createElement("div");
  leanEl.className = "psa-flight-lean";
  leanEl.appendChild(cloneArt(originEl, { globals, dur }));
  outer.appendChild(leanEl);

  /* ONE SAMPLE LOOP FOR BOTH, and it lives in flightPath.js so that /arcs
     draws the same numbers this animates. Position and rotation are read at
     the same `t`, on the same iteration, off the same curve — which is why
     they cannot drift out of phase. Every version before this had two systems
     agreeing by arrangement.

     The speed easing is baked into the sampling, which is why the animations
     run `linear`: a curve laid over samples that already carry one bends it
     twice. */
  const { rows } = samplePath(dx, dy, tuning, 40);
  const banking = tuning.rotate !== "none";

  const move = rows.map((r) => ({
    transform: `translate(${r.x.toFixed(2)}px, ${r.y.toFixed(2)}px)`,
    offset: r.u,
  }));
  const turn = rows.map((r) => ({
    transform: `rotate(${r.deg.toFixed(2)}deg)`,
    offset: r.u,
  }));

  detach(originEl, layer, commit, globals);
  layer.appendChild(outer);

  const run = outer.animate(move, { duration: dur, easing: "linear", fill: "both" });
  if (banking) leanEl.animate(turn, { duration: dur, easing: "linear", fill: "both" });

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    outer.remove();
  };
  run.addEventListener("finish", cleanup);
  setTimeout(cleanup, dur + 400);

  setTimeout(() => {
    land();
    hit();
  }, dur * globals.landAt);
}


/* ── The spring flight ────────────────────────────────────────────────────
   Behind the `spring` flag. The shape of what iOS actually does:

     · a STRAIGHT LINE. No path, no control points, no arc. The curve people
       think they see in an app flying into the Dynamic Island is the scale
       changing, not the position bending.
     · NO ROTATION. Not a degree.
     · ONE SPRING for position and scale, read at the same instant. They are
       not two animations timed to agree — they are two readings of the same
       number, which is the entire reason it holds together as one object.
     · the destination REACTS, on the same schedule.

   Which is why this function is a third the length of the path one and has
   four knobs instead of twenty: there are no independent timelines here, so
   there is nothing to reconcile. Every knob we kept adding upstream existed
   to make two clocks agree. A spring only ever has one.
   ───────────────────────────────────────────────────────────────────────── */
function runSpring({ originEl, target, layer, commit, hit, land, tuning, globals }) {
  const from = originEl.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const box = layer.getBoundingClientRect();

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);

  const { rows, settle } = sampleSpring(tuning.duration, tuning.bounce, 60);

  const outer = document.createElement("div");
  outer.className = "psa-flight psa-flight--spring";
  outer.style.left = `${from.left - box.left}px`;
  outer.style.top = `${from.top - box.top}px`;
  outer.style.width = `${from.width}px`;
  outer.style.height = `${from.height}px`;
  outer.style.setProperty("--fade-delay", `${settle * tuning.fadeFrom}ms`);
  outer.style.setProperty("--fade-dur", `${settle * (1 - tuning.fadeFrom)}ms`);

  const art = cloneArt(originEl, { globals, dur: settle });
  outer.appendChild(art);

  detach(originEl, layer, commit, globals);
  layer.appendChild(outer);

  // ONE progress value, two properties. Nothing to keep in phase.
  const move = rows.map((r) => ({
    transform: `translate(${(dx * r.p).toFixed(2)}px, ${(dy * r.p).toFixed(2)}px)`,
    offset: r.u,
  }));
  const shape = rows.map((r) => ({
    transform: `scale(${(1 + (tuning.endScale - 1) * r.p).toFixed(4)})`,
    offset: r.u,
  }));

  const run = outer.animate(move, { duration: settle, easing: "linear", fill: "both" });
  art.animate(shape, { duration: settle, easing: "linear", fill: "both" });

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    outer.remove();
  };
  run.addEventListener("finish", cleanup);
  setTimeout(cleanup, settle + 400);

  /* The tab reacts when the card has effectively arrived — the first sample
     past 90% of the way — rather than at a fraction of the duration. A spring
     is asymptotic, so "most of the way there" is a real moment and "86% of
     the runtime" is not. */
  const hitRow = rows.find((r) => r.p >= 0.9) ?? rows[rows.length - 1];
  setTimeout(() => {
    land();
    hit();
  }, settle * hitRow.u);
}

/* ── The dive: two clones ─────────────────────────────────────────────────
   One element could not do this. Getting a single card to drop, cross to
   another column under the bar and climb back is three motions on two axes
   sharing one timeline, and however the overlap is tuned some of the sideways
   move bleeds into the end of the descent — the arc that kept showing up at
   the bottom of the slide. No arrangement of one object's timings removes it,
   because the object really does have to change columns and it has one trip
   to do it in.

   Two clones, each doing exactly one thing:

     THE FALLER  the tile's own box, straight down, shrinking, gone behind the
                 bar. One axis, one curve, nothing to bend, and it never comes
                 in front of the footer.

     THE RISER   born at the Collection column below the bottom of the screen,
                 at the size the faller left at. Climbs behind the bar,
                 shrinking into its box, clears it, drops in.

   The lateral move is not animated at all. It is the gap between where one
   clone starts and where the other does — which is why nothing can arc.

   The riser also lands exactly: its climb ends at −clear and its drop ends at
   +clear, so it finishes at translateY(0), which is the box it was positioned
   in, centred on the bookmark. The landing is not animated toward the target,
   it IS the target.

   THREE THINGS THE PAIR HAS TO GET RIGHT, and it used to get none of them:

     · they are never on screen together. The riser waits on the faller being
       behind the bar, solved per card rather than set as a fraction.
     · the riser is the size the faller left at, not icon size, so what comes
       back up is the card that went down.
     · the drop starts before the climb finishes. Butted end to end, with a
       decelerating climb into an accelerating drop, the card comes to a dead
       stop in mid-air over the footer.
   ───────────────────────────────────────────────────────────────────────── */
const clamp01 = (v) => Math.min(1, Math.max(0, v));

function runDive({ originEl, target, layer, commit, hit, land, tuning, globals, navTop }) {
  const from = originEl.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const box = layer.getBoundingClientRect();
  // Every fraction below is of T. The dive is longer than the flight it stands
  // in for because it is three moves against one.
  const T = tuning.duration * tuning.underDurScale;

  const navLocal = (navTop ?? to.top - 8) - box.top;
  const fromTop = from.top - box.top;

  /* ── the faller ──────────────────────────────────────────────────────────
     The distance is SOLVED, not set: far enough to put the card's own top edge
     under the bar's top edge, plus `fallBy` of slack. A flat 260px was two
     different bugs at once — a tall tile only just touching the bar was still
     half on screen when the riser surfaced, and a tile already mostly hidden
     went on travelling for another 200px out of sight. */
  const hide = Math.max(0, navLocal - fromTop);
  const fallBy = hide + tuning.fallBy;
  const fallDur = T * tuning.fallFrac;

  /* ...and the FRAME it disappears on, by the same inversion the stacking swap
     uses: how far along its own curve the top edge reaches the bar. This is
     the number the riser waits for, and it is why the two are never both on
     screen no matter which row of the grid the card came from. */
  const hiddenAt =
    tuning.fallFrac * easeInvert(tuning.fallEase, fallBy === 0 ? 1 : clamp01(hide / fallBy));

  // The fade is insurance, not choreography — it runs while the card is
  // already behind the bar and is finished by the time the fall is.
  const fadeAt = Math.min(tuning.fallFadeAt, tuning.fallFrac);

  const fall = document.createElement("div");
  fall.className = "psa-flight psa-flight--fall";
  fall.style.left = `${from.left - box.left}px`;
  fall.style.top = `${fromTop}px`;
  fall.style.width = `${from.width}px`;
  fall.style.height = `${from.height}px`;
  fall.style.setProperty("--fall-by", `${fallBy}px`);
  fall.style.setProperty("--fall-scale", String(tuning.fallScale));
  fall.style.setProperty("--fall-dur", `${fallDur}ms`);
  fall.style.setProperty("--ease-fall", easeValue(tuning.fallEase));
  fall.style.setProperty("--fall-fade-delay", `${T * fadeAt}ms`);
  fall.style.setProperty("--fall-fade-dur", `${Math.max(1, T * (tuning.fallFrac - fadeAt))}ms`);
  fall.style.setProperty("--scale-origin", `${tuning.scaleOrigin}%`);
  /* The faller carries the bookmark, and only the faller. The riser is the
     card coming BACK — it left with a mark on it a third of a second ago and
     what returns is on its way into the tab, not still confirming. */
  fall.appendChild(cloneArt(originEl, { globals, dur: fallDur }));

  /* ── the riser ───────────────────────────────────────────────────────────
     The BOX is in pixels and it is the landing: the climb ends at −clear and
     the drop ends at +clear, so the riser finishes at translateY(0), which is
     the box it was positioned in, centred on the bookmark. Arrival is not
     animated toward the target, it IS the target.

     The SIZE is a scale on top of that, and it is the fix for "a little
     duplicate comes up". The riser used to be born at icon size, so a
     full-width card slid away and a 24px thumbnail came back — two objects,
     not one trip. It is now born at the size the faller left at, HOLDS that
     size for the whole climb, and only shrinks into the bookmark once it is
     over the bar and dropping in. Shrinking on the way up is the same bug in
     slow motion: all of it happens behind the footer, so what surfaces is
     still a thumbnail. */
  const w = to.width * tuning.underWidth;
  const h = w * (from.height / from.width); // the card's own aspect, kept
  const cx = to.left + to.width / 2 - box.left;
  const cy = to.top + to.height / 2 - box.top;
  const restTop = cy - h / 2;
  const born = Math.max(1, ((from.width * tuning.fallScale) / w) * tuning.underBorn);
  // How much further the scaled card's edges reach than its box does. The box
  // is the landing; this is what you actually see on the way there.
  const bleed = (h * (born - 1)) / 2;

  // Starts fully off screen — its top on the bottom edge of the shell, at its
  // BIRTH size, which is taller than the box it will land in.
  const riseFrom = Math.max(0, box.height - restTop + bleed);
  const clear = Math.max(0, restTop - (navLocal - tuning.clearBy));

  const travel = -clear - riseFrom;

  /* THE RISER IS IN FRONT OF THE FOOTER FOR ITS WHOLE LIFE. No stacking swap,
     and that is the fix rather than a shortcut.

     The swap was solved exactly — invert the climb curve at the Y where the top
     edge crosses the bar and you have the frame — and it was still wrong to
     have at all. Two things have to agree for it to look right: the frame the
     card is DRAWN in front, and the frame it is geometrically PAST the bar.
     They are computed from the same numbers but they land on different frames,
     because a curve evaluated at a Y and an animation sampled by the compositor
     do not have to round the same way. One frame out and the card is behind the
     bar when it should be over it, which is the flicker — and there is no
     amount of care that makes two clocks the same clock.

     Above it always, and the question stops existing. The riser is a small card
     travelling over the footer, which is what it looked like it was trying to
     be anyway. The FALLER still goes behind: it has to, the bar swallowing it
     is the whole point of the dive, and it never has to come back out.

     The card is now visible the moment it starts climbing — it is born with its
     top edge on the bottom of the viewport — so `riseAt` IS the frame it
     appears, and that is what the gap has to be measured against. */
  const showAt = Math.max(0, hiddenAt + tuning.underGap);

  /* THE TWO CLONES ARE NEVER ON SCREEN TOGETHER, and that was the original
     break: the faller was sixty pixels into a two-hundred-and-sixty pixel
     accelerating slide — still a full card in plain view — when the riser
     arrived. BOTH WAYS: too early is two cards at once, too late is a hole in
     the middle of the animation, and which one you got depended on the row the
     tile was in. */
  const shift = showAt - tuning.riseAt;
  const riseAt = showAt;
  const dropAt = tuning.dropAt + shift;

  /* The flight ends when the drop does, which is NOT T — the drop deliberately
     overlaps the climb, and the shift can push it past T. Everything that has
     to agree with the landing reads this rather than the duration. */
  const landAt = dropAt + tuning.dropFrac;
  const total = T * Math.max(landAt, tuning.fallFrac);

  const rise = document.createElement("div");
  rise.className = "psa-flight psa-flight--rise";
  rise.style.left = `${cx - w / 2}px`;
  rise.style.top = `${restTop}px`;
  rise.style.width = `${w}px`;
  rise.style.height = `${h}px`;

  rise.style.setProperty("--rise-from", `${riseFrom}px`);
  rise.style.setProperty("--clear-by", `${clear}px`);
  rise.style.setProperty("--rise-dur", `${T * tuning.riseFrac}ms`);
  rise.style.setProperty("--rise-delay", `${T * riseAt}ms`);
  rise.style.setProperty("--ease-rise", easeValue(tuning.riseEase));
  rise.style.setProperty("--drop-dur", `${T * tuning.dropFrac}ms`);
  rise.style.setProperty("--drop-delay", `${T * dropAt}ms`);
  rise.style.setProperty("--ease-drop", easeValue(tuning.dropEase));
  rise.style.setProperty("--born-scale", String(born));

  /* THE ARC, and it belongs to the riser alone. The faller is one axis on one
     curve on purpose — anything sideways in it bleeds into the end of the
     descent, which is the reason there are two clones at all. The riser has no
     such problem: it is born at the Collection column and lands at the
     Collection column, so an offset that resolves to zero cannot walk it off
     its target. X easing to zero against the climb's Y is a quarter-ellipse.

     The SIDE is taken from where the tile actually was, so the card comes back
     up on the side it went down on — the two clones are then obviously the same
     trip rather than two events that happen to share a column. */
  const side =
    tuning.arcSide === "left"
      ? -1
      : tuning.arcSide === "right"
        ? 1
        : Math.sign(from.left + from.width / 2 - (to.left + to.width / 2)) || 1;
  rise.style.setProperty("--arc-from", `${side * tuning.arcBy}px`);
  rise.style.setProperty("--arc-delay", `${T * riseAt}ms`);
  rise.style.setProperty("--arc-dur", `${Math.max(1, T * (landAt - riseAt))}ms`);
  rise.style.setProperty("--ease-arc", easeValue(tuning.arcEase));

  /* The tilt is the arc's: same side, same window, and it resolves to zero for
     the same reason the offset does — the card has to be square to the tab when
     it lands. NEGATIVE against `side`, because a card starting out to the right
     is travelling left and its top goes with it, and CSS counts clockwise. */
  rise.style.setProperty("--tilt-from", `${-side * tuning.tiltBy}deg`);
  rise.style.setProperty("--tilt-delay", `${T * riseAt}ms`);
  rise.style.setProperty("--tilt-dur", `${Math.max(1, T * (landAt - riseAt))}ms`);
  rise.style.setProperty("--ease-tilt", easeValue(tuning.tiltEase));

  /* The exit windows are measured against the VISIBLE part of the trip: from
     the frame the card appears at the bottom of the screen to the frame it
     lands. Not against T — landing is no longer the end of T, so a window
     measured that way would still be running after the card had arrived. */
  const vis = (f) => riseAt + (landAt - riseAt) * f;

  /* THE SHRINK IS THE ARRIVAL, not the climb. By default it starts when the
     drop does, so the card holds the size the faller left at all the way up —
     the rise reads as the card coming back and the drop reads as it being
     filed. Started at the appearance instead, the card is already collapsing
     while it is still on its way up, which begins the arrival before the
     return has finished. */
  const shrinkAt = tuning.shrinkAt === "rise" ? riseAt : dropAt;
  rise.style.setProperty("--shrink-delay", `${T * shrinkAt}ms`);
  rise.style.setProperty("--shrink-dur", `${Math.max(1, T * (landAt - shrinkAt))}ms`);

  const swallowFrom = vis(tuning.swallowFrom);
  const fadeFrom = vis(tuning.fadeFrom);
  rise.style.setProperty("--swallow-delay", `${T * swallowFrom}ms`);
  rise.style.setProperty("--swallow-dur", `${Math.max(1, T * (landAt - swallowFrom))}ms`);
  rise.style.setProperty("--fade-delay", `${T * fadeFrom}ms`);
  rise.style.setProperty("--fade-dur", `${Math.max(1, T * (landAt - fadeFrom))}ms`);

  /* Nested, and the nesting is the trajectory: X, then the climb, then the
     drop, then the tilt, then the art. Translations that add, with the rotation
     innermost so it composes with them rather than bending the path — the card
     banks without going anywhere different. */
  const arcEl = document.createElement("div");
  arcEl.className = "psa-flight-rise-x";
  const up = document.createElement("div");
  up.className = "psa-flight-rise-up";
  const drop = document.createElement("div");
  drop.className = "psa-flight-rise-drop";
  const lean = document.createElement("div");
  lean.className = "psa-flight-rise-lean";
  lean.appendChild(cloneArt(originEl));
  drop.appendChild(lean);
  up.appendChild(drop);
  arcEl.appendChild(up);
  rise.appendChild(arcEl);

  /* ── the veil ────────────────────────────────────────────────────────────
     A mask on the LAYER rather than on the card, pinned to the BOTTOM OF THE
     VIEWPORT, and it does not move.

     The riser is born below the bottom edge and climbs in, which the shell's
     `overflow: hidden` ought to handle by itself. On Safari it does not: the
     bottom strip is not opaque, so the clip that should be invisible is a hard
     cut, and the card gets sliced along a line as it comes up rather than
     sliding in from off screen. A few pixels of ramp there is the whole fix.

     It does not touch the card once it is up. By then the riser is in front of
     the bar at full strength, which is what the climb is for.

     Masking the card's own bottom instead would be wrong twice over: the card
     would be permanently soft-edged, and the softness would travel with it
     rather than staying at the screen edge where the artefact is.

     It carries the riser's stacking too, because it has to: a mask establishes
     a stacking context, so a z-index on anything inside is settled against its
     siblings in here and never against the footer. The veil claims 3 — over the
     bar's 2 — and holds it for the whole flight. */
  const veilEnd = box.height - tuning.veilInset;
  const veil = document.createElement("div");
  veil.className = "psa-flight-veil";
  veil.style.setProperty("--veil-solid", `${veilEnd - tuning.veilFade}px`);
  veil.style.setProperty("--veil-end", `${veilEnd}px`);
  veil.appendChild(rise);

  detach(originEl, layer, commit, globals);
  layer.appendChild(fall);
  layer.appendChild(veil);

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    fall.remove();
    veil.remove(); // takes the riser with it
  };
  /* Listen on the DROP, not on the riser. The only animation on the riser
     itself is the one-millisecond stacking swap, so `e.target === rise` fired
     the moment the card came to the front and tore both clones out of the DOM
     mid-flight. The drop is the last thing to finish. */
  drop.addEventListener("animationend", (e) => {
    if (e.target === drop) cleanup();
  });
  setTimeout(cleanup, total + 400);

  /* Against the LANDING, not against T. `landAt` is a fraction of the flight,
     and for the dive the flight ends when the drop does — which the overlap
     and the shift both move. Measured against T the count could pop while the
     card was still coming down. */
  setTimeout(() => {
    land();
    hit();
  }, T * landAt * globals.landAt);
}

/* Clone the scan rather than rebuilding it: the image is already decoded and
   cached, so the copy paints in the same frame and the flying card cannot
   look different from the one it left.

   `mark` is the bookmark's ride — see rideMark. Passed only by the clone the
   user is actually watching leave: the riser in a dive is a card coming BACK,
   and its bookmark left with the faller a third of a second ago. */
function cloneArt(originEl, mark) {
  const art = document.createElement("div");
  art.className = "psa-flight-art";
  const source = originEl.querySelector("img");
  if (source) {
    const img = document.createElement("img");
    img.src = source.currentSrc || source.src;
    img.decoding = "sync";
    art.appendChild(img);
  }
  if (mark) rideMark(art, originEl, mark.globals, mark.dur);
  return art;
}

/* ── The bookmark rides ───────────────────────────────────────────────────
   NO MEASURING, and that is not a shortcut — it is why this is exact. The
   button is positioned against `.psa-tile-art`, and the clone's art element
   IS that box: same width, same height, same class on the copy, so the same
   `top`/`right` inset resolves to the same pixels. Measure it and you have
   introduced a rounding error to solve a problem you did not have.

   It is also the first time the save has ever CONFIRMED. The fill wipe, the
   pop and the ring all hang off [data-saved], and on a grid tile not one of
   them has ever played: the attribute would arrive in the same commit that
   unmounts the tile. The copy is born saved, so the bookmark fills as the
   card lifts — and then leaves with it rather than being cut.

   `data-touched` and `data-hint` are stripped. The first drives the un-save
   drain, the second the miss-tap nudge; neither has any business firing on a
   card that is on its way to the Collection.
   ───────────────────────────────────────────────────────────────────────── */
function rideMark(art, originEl, g, dur) {
  if (!g || !g.markDur) return;
  const mark = originEl.querySelector(".psa-tile-save");
  if (!mark) return;

  const copy = mark.cloneNode(true);
  copy.classList.add("psa-flight-mark");
  const button = copy.querySelector(".pk-save") ?? copy;
  button.setAttribute("data-saved", "");
  button.removeAttribute("data-touched");
  button.removeAttribute("data-hint");
  button.tabIndex = -1;
  art.appendChild(copy);

  /* Clamped against the flight. The window is in real milliseconds because
     the icon's own animations are, but a 380ms variant would otherwise land
     with the mark still sitting on it. */
  const delay = Math.min(g.markDelay, dur * 0.45);
  const span = Math.min(g.markDur, Math.max(60, dur * 0.85 - delay));

  copy.animate(
    [
      { opacity: 1, transform: "scale(1)" },
      { opacity: 0, transform: `scale(${g.markScale})` },
    ],
    { duration: span, delay, easing: easeValue(g.markEase), fill: "forwards" },
  );
}

/* ── What the tile leaves behind ──────────────────────────────────────────
   The caption cannot ride: it sits BELOW the art wrapper, outside the box
   that flies, and it captions the grid slot rather than the card. So it stays
   where it was and comes apart there, line by line, while the gap closes over
   it.

   Cloned rather than animated in place for the same reason the flying card is
   a clone: `commit` is one flushSync away and the tile will not exist to be
   animated. Measured BEFORE that commit, which is the only reason the boxes
   are still true.

   IT HAS TO BEAT THE REFLOW. It is not leaving through empty space — the gap
   closes over this exact rectangle, and a neighbour is arriving into it. Two
   legible things in one place is the mud, so the whole caption is out inside
   the reflow's opening move rather than fading through the middle of it.

   And it SLIDES rather than shrinking. See GLOBALS.chromeScale for why a
   scale on type this size is blur wearing motion's clothes.
   ───────────────────────────────────────────────────────────────────────── */
function ghostChrome(originEl, layer, g) {
  if (!layer || !g.chromeDur) return;
  const tile = originEl.closest(".psa-tile");
  const text = tile?.querySelector(".psa-tile-text");
  if (!text) return;

  const box = layer.getBoundingClientRect();
  const ease = easeValue(g.chromeEase);
  const rows = [...text.children];

  rows.forEach((row, i) => {
    const r = row.getBoundingClientRect();
    if (!r.width || !r.height) return;

    const ghost = document.createElement("div");
    ghost.className = "psa-flight-ghost";
    ghost.style.left = `${r.left - box.left}px`;
    ghost.style.top = `${r.top - box.top}px`;
    ghost.style.width = `${r.width}px`;
    ghost.style.height = `${r.height}px`;
    ghost.appendChild(row.cloneNode(true));
    layer.appendChild(ghost);

    const anim = ghost.animate(
      [
        { opacity: 1, transform: "translateY(0) scale(1)" },
        {
          opacity: 0,
          transform: `translateY(${-g.chromeLift}px) scale(${g.chromeScale})`,
        },
      ],
      { duration: g.chromeDur, delay: i * g.chromeStagger, easing: ease, fill: "forwards" },
    );
    // Same backstop the clones get: a backgrounded tab pauses WAAPI, so a
    // ghost waiting on `finished` alone would still be pinned over the grid
    // when the user came back to it.
    const drop = () => ghost.remove();
    anim.finished.then(drop, drop);
    setTimeout(drop, g.chromeDur + i * g.chromeStagger + 400);
  });
}

/* The tile leaves, the grid closes behind it, and everything the tile was
   wearing is accounted for. One call so all four flights answer to it — a
   variant that forgot it would be the one that still blinks. */
function detach(originEl, layer, commit, globals) {
  ghostChrome(originEl, layer, globals);
  flipGrid(commit, originEl.closest(".psa-grid"), globals, { forceFlip: true });
}

/* ── The lean ─────────────────────────────────────────────────────────────
   TWO MODES, and the default one derives the angle from the path itself.

   `bump` is the old way: a made-up peak angle, out and back on its own clock.
   It has one problem, which is that the turn and the trip are then two
   independent shapes that only agree by coincidence. Tuned against one
   variant it looks right; the same numbers against a different easing pair
   are a card rotating one way while travelling another. That is the fighting.

   `path` removes the coincidence. The two path curves are evaluated in JS,
   the velocity is taken by central difference, and the card's own "down" is
   pointed along it. Rotating (0,1) by θ under CSS's clockwise-positive
   convention gives (−sin θ, cos θ), so pointing the bottom along (vx, vy)
   solves to θ = atan2(−vx, vy). Sampled 24 times and handed to WAAPI as a
   keyframe list — computed once at the tap, then it is the compositor's.

   The envelope is the one concession to the interface over the physics: the
   clone's first frame has to be the tile exactly, and arrival has to be
   square to the tab, so the orientation is blended on over `leanIn` and off
   over `leanOut` with a smoothstep rather than snapping to true at t=0.   */
function writeLean(el, { fx, fy, lift, dur, tuning }) {
  el.style.setProperty("--lean-peak", "0deg");
  el.style.setProperty("--lean-dur", `${dur * tuning.leanFrac}ms`);
  el.style.setProperty("--lean-delay", `${dur * tuning.leanAt}ms`);
  el.style.setProperty("--ease-lean", easeValue(tuning.leanEase));

  if (tuning.leanMode !== "path") {
    // Free bump: the CSS animation above does the work. One angle, from how
    // sideways the trip is overall.
    const sideways = Math.atan2(Math.abs(fx), Math.max(1, Math.abs(fy)));
    const deg = (sideways * 180) / Math.PI;
    const peak =
      Math.min(deg * tuning.leanAmplify, tuning.leanMax) * -Math.sign(fx || 1);
    el.style.setProperty("--lean-peak", `${peak}deg`);
    return;
  }

  const ex = easeFn(tuning.easeX);
  const ey = easeFn(tuning.easeY);
  const eLift = easeFn(tuning.liftEase);
  const half = Math.max(0.001, tuning.liftFrac);

  const xAt = (t) => fx * ex(t);
  /* The hop has to be in here. It is a real part of where the card is, and a
     tangent taken without it points along the travel while the card is
     visibly rising — which is the same disagreement in miniature. */
  const yAt = (t) => {
    let hop = 0;
    if (t < half) hop = -lift * eLift(t / half);
    else if (t < half * 2) hop = -lift * eLift(1 - (t - half) / half);
    return fy * ey(t) + hop;
  };

  const N = 24;
  const d = 1 / (N * 4);
  const frames = [];
  for (let i = 0; i <= N; i += 1) {
    const t = i / N;
    const a = Math.max(0, t - d);
    const b = Math.min(1, t + d);
    const vx = xAt(b) - xAt(a);
    const vy = yAt(b) - yAt(a);

    let deg = tipAngle(vx, vy);
    deg *= tuning.leanAmplify;
    deg = Math.max(-tuning.leanMax, Math.min(tuning.leanMax, deg));
    deg *= smoothstep(t / (tuning.leanIn || 0.0001));
    deg *= smoothstep((1 - t) / (tuning.leanOut || 0.0001));

    frames.push({ transform: `rotate(${deg.toFixed(2)}deg)`, offset: t });
  }

  // linear BETWEEN the samples: the curve is already in where the samples
  // are, and a second easing over the top would bend it again.
  el.animate(frames, { duration: dur, easing: "linear", fill: "both" });
}
