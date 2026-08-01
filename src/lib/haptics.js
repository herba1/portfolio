/* ═════════════════════════════════════════════════════════════════════
 * HAPTICS — the tactile half of the motion system.
 *
 * The web has no haptics API. It has two unrelated things that produce a
 * buzz, and neither works where the other does, so this file is the seam
 * between them.
 *
 *   Android  navigator.vibrate(pattern). A real API. Takes an array of
 *            on/off durations in ms, so a note can have SHAPE — two taps
 *            with a gap between them is one call.
 *
 *   iOS      No Vibration API, ever. But Safari 17.4 shipped
 *            <input type="checkbox" switch>, and toggling that native
 *            control fires the Taptic Engine. Clicking a hidden one is a
 *            haptic with no switch on screen. One fixed intensity, one
 *            fixed duration — the only thing that can be varied is HOW
 *            MANY and HOW FAR APART, which is why every note below
 *            declares a pulse count as well as a vibrate pattern.
 *
 * KNOWN CEILING: Apple patched the programmatic path in iOS 26.5. A real
 * finger landing on a real switch still fires; label.click() no longer
 * does. So on 26.5+ this file is silent, and the fix is not a different
 * pattern — it is restructuring a control to BE a switch so the tap is
 * genuine. Deliberately not done here: that means rebuilding the save
 * button's DOM, which is a bigger change than adding feedback to it.
 *
 * Also, on iOS the Taptic Engine only answers when the ringer switch is
 * unmuted. A silent phone gets nothing and there is no way to detect it.
 *
 * WHY NOT A LIBRARY: all three on npm are ~30 lines around this same
 * trick. ios-haptics only attaches to an element (can't fire from a
 * timer, which is where our best moment is). use-haptic is a React hook
 * that mounts a fixed-id node per instance, so calling it from five
 * components puts five duplicate ids in the document. @rowixorg/
 * web-haptics has the right shape but plays an AudioContext noise burst
 * on every trigger with no way off. None of them can express a note with
 * more than one pulse.
 * ═════════════════════════════════════════════════════════════════════ */

/* ── The vocabulary ───────────────────────────────────────────────────
 * Five notes, ordered by weight. Named for what happened, not for how
 * hard it buzzes — the call sites should not have to know that `land` is
 * two pulses, only that a card arrived.
 *
 * `vibrate` is the Android pattern in ms: [on] or [on, off, on, …].
 * `pulses` / `gap` are the iOS translation, since intensity is not ours
 * to set there — a heavier note has to be spelled with more taps. */
export const NOTES = {
  /** Selection changed. The lightest thing that still registers. */
  tick: { vibrate: [8], pulses: 1, gap: 0 },

  /** A press that did something small. Un-save, undo, dismiss. */
  tap: { vibrate: [16], pulses: 1, gap: 0 },

  /** A press that started something. The save, at the moment of the tap. */
  press: { vibrate: [28], pulses: 1, gap: 0 },

  /** Arrival. The card reaching the collection tab — the payoff beat.
   *  Two pulses far enough apart to read as thud-then-settle rather than
   *  as one long buzz. */
  land: { vibrate: [34, 70, 18], pulses: 2, gap: 80 },

  /** The miss. Three quick ones is the universal "not there" — short
   *  enough apart that it never reads as two separate events. */
  nudge: { vibrate: [10, 45, 10, 45, 10], pulses: 3, gap: 45 },
};

/* Rapid taps would otherwise stack into one continuous buzz, which is
 * the difference between feedback and a phone going off in a pocket.
 * Long enough to swallow a double-tap, short enough that deliberate
 * consecutive saves each get their own note. */
const MIN_GAP_MS = 45;

let last = 0;
let label = null;
let domReady = false;
let capability = null; // null = not yet probed

/* Probed once and cached. Reading matchMedia and navigator on every tap
 * is wasted work on a path that has to be cheap enough to sit inside a
 * click handler. */
const SILENT = { kind: "none" };

function probe() {
  if (typeof window === "undefined") return SILENT;

  // Read live and BEFORE the cache, because the preference can be
  // toggled mid-session and a cached answer would outlive it.
  //
  // Reduced motion is not strictly the same preference — there is no
  // prefers-reduced-haptics — but it is the closest signal we have that
  // someone wants the interface to stop moving, and the PSA surface
  // already skips the whole flight animation under it. Feedback for an
  // animation that did not play would be feedback for nothing.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return SILENT;

  if (capability) return capability;

  const canVibrate = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  capability = { kind: canVibrate ? "vibrate" : "switch" };
  return capability;
}

/* The hidden switch, built on first use rather than at import — most
 * visitors never trigger a haptic and this is a DOM node on body.
 *
 * The style sequence is load-bearing, not defensive: `all: initial`
 * clears any inherited appearance, `appearance: auto` puts the NATIVE
 * switch rendering back, and only a natively-rendered switch reaches the
 * Taptic Engine. A plain hidden checkbox does nothing. The label is what
 * gets clicked — clicking the input directly is less reliable. */
function ensureSwitch() {
  if (domReady || typeof document === "undefined") return;
  domReady = true;

  const id = `hap-${Math.random().toString(36).slice(2, 8)}`;
  const el = document.createElement("label");
  el.setAttribute("for", id);
  el.setAttribute("aria-hidden", "true");
  el.style.display = "none";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.setAttribute("tabindex", "-1");
  input.id = id;
  input.style.all = "initial";
  input.style.appearance = "auto";
  input.style.display = "none";

  el.appendChild(input);
  document.body.appendChild(el);
  label = el;
}

/**
 * Fire a haptic note. Safe to call from anywhere — server render, a
 * desktop browser, a timer, an animation callback. Everything that
 * cannot produce a buzz returns silently rather than throwing, so call
 * sites never need to guard.
 *
 * @param {keyof typeof NOTES} name
 */
export function haptic(name) {
  const note = NOTES[name];
  if (!note) return;

  const { kind } = probe();
  if (kind === "none") return;

  const now = performance.now();
  if (now - last < MIN_GAP_MS) return;
  last = now;

  if (kind === "vibrate") {
    // Wrapped: vibrate throws in a cross-origin iframe and is a no-op on
    // desktop, and neither is worth a broken click handler.
    try {
      navigator.vibrate(note.vibrate);
    } catch {
      /* no haptics here */
    }
    return;
  }

  ensureSwitch();
  if (!label) return;

  // One pulse now so the feedback is in the same frame as the tap; the
  // rest scheduled, because a switch toggled twice inside one task fires
  // the engine once.
  label.click();
  for (let i = 1; i < note.pulses; i += 1) {
    setTimeout(() => label?.click(), note.gap * i);
  }
}
