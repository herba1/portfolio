"use client";

import { useEffect } from "react";
import { useControls, folder } from "leva";

/* ───────────────────────────────────────────────────────────────────
 * DeckControls — dev-only Leva panel for the deck.
 *
 * Every dial writes a CSS custom property straight onto the `.deck`
 * element, which is where deck.css declares all of them. Nothing here
 * owns state the stylesheet doesn't already own: pull the panel out and
 * the deck keeps working on the defaults in the CSS.
 *
 * The one exception is `ease`, which drives the scroll-follow lerp in
 * JS. That's written into a plain ref the rAF loop reads, so tuning it
 * never re-runs the effect or re-renders anything.
 *
 * Mounted only when NODE_ENV !== production, via next/dynamic — the
 * chunk (and leva with it) is never fetched in a production build.
 * ─────────────────────────────────────────────────────────────────── */

export default function DeckControls({ target }) {
  const v = useControls("Deck", {
    camera: folder({
      yaw: { value: 40, min: 0, max: 80, step: 0.5, label: "yaw (deg)" },
      persp: {
        value: 3600,
        min: 600,
        max: 12000,
        step: 50,
        label: "perspective",
      },
      offX: { value: -14, min: -60, max: 60, step: 0.5, label: "offset x (%)" },
      offY: { value: 13, min: -60, max: 60, step: 0.5, label: "offset y (%)" },
    }),
    stack: folder({
      size: { value: 44, min: 12, max: 80, step: 0.5, label: "card (vmin)" },
      depth: { value: 0.13, min: 0.01, max: 0.6, step: 0.005, label: "z gap" },
      rise: { value: 0.042, min: -0.2, max: 0.2, step: 0.002, label: "climb" },
    }),
    slide: folder({
      pop: { value: 0.55, min: 0, max: 2, step: 0.01, label: "peek (x)" },
      focus: {
        value: 1.15,
        min: 0.2,
        max: 12,
        step: 0.05,
        label: "spread",
      },
      popRy: { value: -5, min: -30, max: 30, step: 0.5, label: "turn (deg)" },
    }),
    feel: folder({
      travel: { value: 10, min: 3, max: 60, step: 0.5, label: "svh / card" },
      // The mass. 0 welds the deck to the wheel; higher lets it trail.
      follow: { value: 460, min: 0, max: 1400, step: 10, label: "follow (ms)" },
      // The overshoot control point. 1.0 = pure ease-out, no coast past
      // the target; above that the deck rocks into place.
      bounce: { value: 1.3, min: 1, max: 2.2, step: 0.02, label: "overshoot" },
    }),
    spread: folder({
      shape: {
        value: "fan",
        options: ["fan", "flat", "ring"],
        label: "layout",
      },
      morph: { value: 680, min: 100, max: 2000, step: 20, label: "morph (ms)" },
      fanStep: {
        value: 9,
        min: 1,
        max: 30,
        step: 0.25,
        label: "fan step (deg)",
      },
      // Clearance between neighbours in card widths — 1 is exactly
      // touching. The radius is solved from this, so the fan can't
      // overlap at any step.
      fanGap: { value: 1.06, min: 1, max: 2, step: 0.01, label: "fan gap" },
      fanFall: {
        value: 0.045,
        min: 0,
        max: 0.3,
        step: 0.002,
        label: "size falloff",
      },
      fanMin: { value: 0.4, min: 0.1, max: 1, step: 0.01, label: "min size" },
      flatK: { value: 1.12, min: 0.4, max: 2.5, step: 0.01, label: "flat gap" },
      ringStep: {
        value: 7,
        min: 0.5,
        max: 30,
        step: 0.25,
        label: "ring step (deg)",
      },
      ringR: { value: 4, min: 1, max: 14, step: 0.1, label: "ring radius (w)" },
    }),
    intro: folder({
      introDur: {
        value: 2600,
        min: 600,
        max: 8000,
        step: 50,
        label: "duration (ms)",
      },
      introRise: { value: 64, min: 0, max: 260, step: 2, label: "rise (px)" },
      introCard: {
        value: 520,
        min: 120,
        max: 1600,
        step: 20,
        label: "per card (ms)",
      },
      introStep: {
        value: 55,
        min: 0,
        max: 200,
        step: 5,
        label: "stagger (ms)",
      },
      introCap: { value: 12, min: 1, max: 50, step: 1, label: "stagger cap" },
    }),
  });

  useEffect(() => {
    const el = target?.current;
    if (!el) return;
    const set = (k, val) => el.style.setProperty(k, val);

    set("--dk-yaw", `${v.yaw}deg`);
    set("--persp", `${v.persp}px`);
    set("--off-x", `${v.offX}%`);
    set("--off-y", `${v.offY}%`);
    set("--w-vmin", v.size);
    set("--dk-depth-k", v.depth);
    set("--dk-rise-k", v.rise);
    set("--pop-k", v.pop);
    set("--focus", v.focus);
    set("--pop-ry", `${v.popRy}deg`);
    set("--travel", v.travel);
    set("--follow", `${v.follow}ms`);
    // Composed here because CSS can't put a calc() inside cubic-bezier().
    set("--ease-follow", `cubic-bezier(0.34, ${v.bounce}, 0.64, 1)`);

    set("--m-dur", `${v.morph}ms`);
    set("--dk-fan-step", `${v.fanStep}deg`);
    set("--fan-gap", v.fanGap);
    set("--fan-fall", v.fanFall);
    set("--fan-min", v.fanMin);
    set("--dk-flat-k", v.flatK);
    set("--dk-ring-step", `${v.ringStep}deg`);
    set("--dk-ring-r", `calc(var(--dk-w) * ${v.ringR})`);
    set("--intro-dur", `${v.introDur}ms`);
    set("--intro-rise", `${v.introRise}px`);
    set("--intro-card", `${v.introCard}ms`);
    set("--intro-step", `${v.introStep}ms`);
    set("--intro-cap", v.introCap);

    // An attribute, not a property: the shape swaps a whole block of
    // goal-position rules, which a single value can't express.
    el.dataset.shape = v.shape;
  }, [target, v]);

  return null; // leva renders its own floating panel
}
