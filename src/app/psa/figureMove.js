"use client";

import { useRef } from "react";

/* ─────────────────────────────────────────────────────────────────────────
   useMove — beat and direction for one live figure.

   Every rolling number on /psa goes through this: the price, the delta, the
   collection total, the tab count and the undo's stack depth. Two properties
   matter and both are about staying in sync:

     · the beat advances ONLY when the printed digits change, so a tick that
       moves a price under the rounding never fires a gesture on a figure
       that is standing still
     · the direction is this figure's own, taken from its own value, so two
       figures are never told to gesture on each other's behalf

   A ref written during render rather than an effect, because the gesture has
   to be on the element in the same commit that hands SlotNumber its new
   value — a frame later and the two would visibly separate.

   THE GUARD IS THE POINT. Writing the previous value on every render looks
   equivalent and is not: React renders twice in development under Strict
   Mode, so a naive `prev.current = value` records the NEW value on the first
   pass and the second pass then compares the value against itself, decides
   nothing moved, and reports "up". Handed to SlotNumber for a decrement that
   is a full ten-cell spin in the wrong direction to land one digit lower.
   Updating only when the TEXT actually changed makes the second pass a
   no-op, so the direction survives it.
   ───────────────────────────────────────────────────────────────────────── */
export function useMove(text, value) {
  const ref = useRef(null);
  if (ref.current === null) ref.current = { text, value, beat: 0, dir: 1 };
  const prev = ref.current;
  if (text !== prev.text) {
    ref.current = {
      text,
      value,
      beat: prev.beat + 1,
      dir: value < prev.value ? -1 : 1,
    };
  }
  return ref.current;
}

/** The direction word SlotNumber wants, straight off a move. */
export const moveDir = (move) => (move.dir < 0 ? "down" : "up");
