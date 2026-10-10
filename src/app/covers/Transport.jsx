"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { RotateCw } from "lucide-react";
import PlayPauseIcon from "@/app/ui/PlayPauseIcon";

// ---------------------------------------------------------------------------
// The transport button and its status line, shared by the big card and the
// dock so the two players cannot say different things about the same track.
//
// The rule both obey: a press always does something, and the current state
// always has a name on screen. Every state below is reachable on a slow or
// flaky connection, and each one used to look identical — a dimmed circle and
// an ellipsis — which is why "I click play and nothing happens" had no answer.
//
//   loading  the status line counts the bytes downloaded. Pressing toggles
//            whether it starts on its own when it lands.
//   blocked  the browser refused playback without a gesture. Pressing IS the
//            gesture, so the button is live and says what it wants.
//   error    this attempt failed. Pressing retries — and the button SAYS so:
//            the play glyph turns over into a rotate arrow, so the control
//            names the failure instead of leaving that to a line of red text.
//   none     the server looked and there is no preview. The one honestly dead
//            state, and the only one that gets a disabled button.
// ---------------------------------------------------------------------------

// The glyph swap. In: turns clockwise into place out of nothing. Out: keeps
// turning, all the way round and away — pressing retry spins the arrow off and
// the loading ring arrives in its place, so the press is answered by motion in
// the same direction rather than by a control that blinks into something else.
const GLYPH_IN = { duration: 0.34, ease: [0.16, 1, 0.3, 1] };
const GLYPH_OUT = { duration: 0.26, ease: [0.16, 1, 0.3, 1] };

/** Is the button worth pressing? Everything except "there is no preview". */
export function isPressable(status) {
  return status !== "none" && status !== "idle";
}

export function transportLabel({ status, playing, pending }) {
  if (status === "loading") return pending ? "Don't play when loaded" : "Play when loaded";
  if (status === "blocked") return "Play";
  if (status === "error") return "Retry";
  if (status === "none") return "No preview available";
  return playing ? "Pause" : "Play";
}

// The lines the readout can show, so a slot can be reserved as wide as the
// widest of them.
//
// It has to be reserved, because the readout sits in a flex row next to a
// flex:1 waveform — so every word here that is a different width to the last
// one DRAGS THE WAVE with it. And they change constantly: the percentage grows
// a digit twice on the way up, "Loading" becomes "Still loading" becomes the
// clock or a failure. That was a wave that visibly resized three or four times
// on the way to playing a song.
//
// Split in two, because reserving the widest of ALL of them meant the clock —
// which is what's on screen for all but the first second of a track — sat in a
// box sized for "Loading, paused" and never filled it. The digits are flush
// right, so every unused pixel piled up in one hole between the wave and the
// time. On a phone that hole was a real fraction of the row, taken off the one
// element anybody touches.
//
// Reserving per state instead keeps the promise that mattered — nothing MOVES
// while a state is on screen, and the percentage can't nudge the wave — and
// gives the width back the rest of the time. The one resize left is the
// handoff between the two, which the crossfade already covers: the outgoing
// line holds the box open until it has finished leaving.
//
// Lists rather than hand-picked px values: the browser measures these in the
// real font at the real size, so the slot is right at every breakpoint and
// stays right if the copy is ever edited. Keep them in step with the returns
// below — a string that isn't in here is one the slot can't hold.

/** Tabular figures, so every time of this shape is exactly this wide. */
export const CLOCK_READOUTS = ["0:00 / 0:00"];

/** Everything `transportStatus` can say. */
export const STATUS_READOUTS = [
  "Loading 100%",
  "Loading, paused",
  "Still loading",
  "You're offline",
  "Didn't load",
  "No preview",
  "Press play",
  "Buffering",
  "Loading",
];

/**
 * Words for whatever is happening. Sentence case, solid ink, no abbreviation —
 * this is the line that has to answer "is it broken or is it slow?".
 */
const STATUS_SETTLE_MS = 300;

export function useSettledStatus(audio) {
  const raw = transportStatus(audio);
  const [settled, setSettled] = useState(!!raw);
  useEffect(() => {
    if (!raw) {
      setSettled(false);
      return;
    }
    if (settled) return;
    const timer = setTimeout(() => setSettled(true), STATUS_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [raw, settled]);
  return raw && settled ? raw : null;
}

export function transportStatus({ status, loaded, slow, pending, buffering, offline }) {
  if (status === "loading") {
    // A percentage is the strongest possible "it is working": it moves.
    if (loaded > 0 && loaded < 1) return `Loading ${Math.round(loaded * 100)}%`;
    if (slow) return "Still loading";
    return pending ? "Loading" : "Loading, paused";
  }
  if (status === "blocked") return "Press play";
  // No "— retry" any more: the button next to this line is now visibly a retry
  // arrow, so the words are free to say the one thing the control can't, which
  // is WHY. A dead link is a different sentence to a request that came back
  // empty, and it's the one where pressing again is pointless until you move.
  if (status === "error") return offline ? "You're offline" : "Didn't load";
  if (status === "none") return "No preview";
  // Playing, but the stream ran dry. Its own word, because the alternative is a
  // clock that stops ticking for two seconds with no account of itself — which
  // looks exactly like the player having died.
  if (buffering) return "Buffering";
  return null; // "ready" hands the space back to the clock
}

/**
 * Play / pause. The load state lives in the status line beside it.
 */
export function TransportButton({ className = "", audio, onClick, size = 20 }) {
  const { status, playing, pending } = audio;
  const loading = status === "loading";
  // Reduced motion keeps the SWAP (the glyph is information — it is how the
  // button says "retry") and drops only the turning and the scale.
  const reduce = useReducedMotion();
  const spin = (deg) => (reduce ? {} : { scale: 0.6, rotate: deg });

  return (
    <button
      className={`cv-transport ${className}`}
      data-status={status}
      data-pending={loading && pending ? "" : undefined}
      onClick={onClick}
      disabled={!isPressable(status)}
      aria-label={transportLabel(audio)}
      aria-busy={loading || undefined}
    >
      {/* Both glyphs share one grid cell, so the swap is a crossfade in place
          rather than anything the layout has to absorb. */}
      <span className="cv-transport-glyph" style={{ width: size, height: size }}>
        <AnimatePresence initial={false}>
          {status === "error" ? (
            <motion.span
              key="retry"
              className="cv-transport-cell"
              initial={{ opacity: 0, ...spin(-140) }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, ...spin(360), transition: GLYPH_OUT }}
              transition={GLYPH_IN}
            >
              <RotateCw size={size - 2} strokeWidth={2} aria-hidden="true" />
            </motion.span>
          ) : (
            <motion.span
              key="play"
              className="cv-transport-cell"
              initial={{ opacity: 0, ...(reduce ? {} : { scale: 0.6 }) }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, ...(reduce ? {} : { scale: 0.6 }), transition: GLYPH_OUT }}
              transition={GLYPH_IN}
            >
              {/* Mid-load the glyph shows the INTENT, not the element: a pause
                  icon means "this is going to play". That is what makes the
                  press legible — it flips to a play triangle on the frame you
                  click, so the control visibly answers even though no sound can
                  start yet. */}
              <PlayPauseIcon playing={playing || (loading && pending)} size={size} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </button>
  );
}
