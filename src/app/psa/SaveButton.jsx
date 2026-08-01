"use client";

import { useId, useState } from "react";

import { haptic } from "@/lib/haptics";

/* ─────────────────────────────────────────────────────────────────────────
   SaveButton — the save-to-collection affordance.

   Deliberately icon-only and 28px square. A labelled "Save to collection"
   button is ~120px wide, which in a two-up grid eats a third of the card
   footer and in a row forces the price to wrap. Keeping it to an icon is
   what lets the grid fit more cards per screen — the tap
   target is still a 56px minimum via a transparent ::after inset, so
   nothing is lost on touch, it just does not take up visual room.

   The motion is the whole point of the component:
     · the solid bookmark is masked by a rect that scales from the bottom,
       so the shape FILLS UP rather than fading in — a rect can scale
       without distorting, which is why the mask carries it and not the path
     · the pop is a hand-authored fake spring, four stops rather than a
       library, on the signature fast-out/long-settle curve
     · a ring expands and dissolves once, so a save reads as landing

   `hint` is the miss case. This is THE action on the surface, so when someone
   taps the card instead of the bookmark the bookmark answers for itself —
   it hops, tilts and flashes brand once. Parity rather than a raw count on
   the attribute: re-matching the same animation-name leaves a running
   animation exactly where it is, so two identical sets of keyframes are what
   let a second miss restart it without touching the DOM. Same trick the price
   tape uses for [data-beat].
   ───────────────────────────────────────────────────────────────────────── */

const BOOKMARK =
  "M6.5 3.5 H17.5 A1.5 1.5 0 0 1 19 5 V20.4 L12 16.3 L5 20.4 V5 A1.5 1.5 0 0 1 6.5 3.5 Z";

export default function SaveButton({
  saved = false,
  onToggle,
  label = "bookmarks",
  size = 28,
  hint = 0,
}) {
  const maskId = useId();
  // Distinguishes "never interacted" from "explicitly unsaved" so the drain
  // animation only ever runs after a real un-save, not on first paint.
  const [touched, setTouched] = useState(false);

  function handleClick(event) {
    event.preventDefault();
    event.stopPropagation();
    setTouched(true);
    /* Asymmetric on purpose, the same way the motion is: a save is the
       start of something that flies across the screen and lands, so it
       gets the heavier note and a second one on arrival. Un-saving is
       over the moment it is tapped and gets one light one. */
    haptic(saved ? "tap" : "press");
    onToggle?.(!saved);
  }

  return (
    <button
      type="button"
      className="pk-save"
      data-saved={saved || undefined}
      data-touched={touched || undefined}
      data-hint={hint ? hint % 2 : undefined}
      aria-pressed={saved}
      aria-label={saved ? `Remove from ${label}` : `Add to ${label}`}
      onClick={handleClick}
      style={{ "--pk-save-size": `${size}px` }}
    >
      <span className="pk-save-ring" aria-hidden="true" />
      <svg
        className="pk-save-icon"
        viewBox="0 0 24 24"
        width={size - 8}
        height={size - 8}
        aria-hidden="true"
      >
        <defs>
          <mask id={maskId}>
            {/* White reveals. Scaling this rect from its bottom edge wipes
                the solid bookmark upward with no shape distortion. */}
            <rect className="pk-save-wipe" x="0" y="0" width="24" height="24" fill="#fff" />
          </mask>
        </defs>
        <path className="pk-save-solid" d={BOOKMARK} fill="currentColor" mask={`url(#${maskId})`} />
        <path
          className="pk-save-line"
          d={BOOKMARK}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
