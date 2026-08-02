"use client";

import { memo, useEffect, useRef } from "react";

import SlotNumber from "@/app/ui/SlotNumber";
import { haptic } from "@/lib/haptics";
import { useSaveFlight } from "./SaveFlight";

/* ─────────────────────────────────────────────────────────────────────────
   TabBar — the footer nav.

   Five tabs, which is the most a thumb can reach across without the targets
   getting small. Four of them are placeholders so the shape of the app is
   legible; Collection is the real one — it is where a save lands, and it is
   the only tab that carries a count.

   Icons are inline 24px strokes rather than an icon package: five glyphs is
   not worth a dependency, and drawing them here means the active weight can
   thicken from 1.6 to 2 without swapping assets.
   ───────────────────────────────────────────────────────────────────────── */

/* `live: true` is the whole switch. Browse and Collection are the two halves
   of the interaction being tested — you find a card and you save it — so they
   are the only tabs that do anything. Search, Activity and Profile stay in
   the bar because removing them would change the reachability of the two that
   matter, but they are inert and say so. */
export const TABS = [
  { id: "browse", label: "Browse", live: true },
  { id: "search", label: "Search" },
  { id: "collection", label: "Collection", live: true },
  { id: "activity", label: "Activity" },
  { id: "profile", label: "Profile" },
];

function Icon({ id, active }) {
  const common = {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: active ? 2 : 1.6,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };

  if (id === "browse")
    return (
      <svg {...common}>
        <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
        <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
        <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
        <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
      </svg>
    );

  if (id === "search")
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="7" />
        <path d="M16.2 16.2 21 21" />
      </svg>
    );

  /* The bookmark, deliberately the same shape as the save button — the tab
     is the destination the save animation implies. */
  if (id === "collection")
    return (
      <svg {...common}>
        <path
          d="M6.5 3.5 H17.5 A1.5 1.5 0 0 1 19 5 V20.4 L12 16.3 L5 20.4 V5 A1.5 1.5 0 0 1 6.5 3.5 Z"
          fill={active ? "currentColor" : "none"}
        />
      </svg>
    );

  if (id === "activity")
    return (
      <svg {...common}>
        <path d="M3 16.5 8.5 10.5 12.5 14 21 5" />
        <path d="M15.5 5H21v5.5" />
      </svg>
    );

  return (
    <svg {...common}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}


const ROLL = 300;

function UndoFill({ duration, nonce, onEnd }) {
  const fillRef = useRef(null);

  useEffect(() => {
    const fill = fillRef.current;
    if (!fill) return undefined;

    const animation = fill.animate(
      [{ width: "100%" }, { width: "0%" }],
      { duration, easing: "linear", fill: "forwards" },
    );
    animation.finished.then(() => onEnd?.()).catch(() => {});
    return () => animation.cancel();
  }, [duration, nonce, onEnd]);

  return (
    <span className="psa-undo-track" aria-hidden="true">
      <span ref={fillRef} className="psa-undo-fill" />
    </span>
  );
}

/* How many saves are on the stack.

   The offer STACKS — four saves in a row can be walked back four times,
   newest first — and until now the only place that said so was the button's
   accessible name. On screen it was one pill that looked exactly the same
   whether it would undo one card or five, so the second tap was a surprise
   every time.

   A typographic count rather than a stack of pills behind the pill. Real
   stacked plies would be a picture of a stack: three ~2px slivers under a
   capsule that is already only 26px tall, at the exact moment the screen is
   busy with a card landing. This says the same thing in a glyph, and it says
   it at the size the rest of the pill is set at.

   It counts DOWN as you tap, on the same reel as the clock beside it, so
   the pill answers each tap by showing what is left rather than just
   surviving it. Absent at 1: "×1" is a multiplier that multiplies nothing,
   and the plain pill already means exactly that. */
function UndoCount({ count }) {
  return (
    <span className="psa-undo-count num" data-show={count > 1 || undefined} aria-hidden="true">
      <SlotNumber value={count} duration={ROLL} stagger={0} direction="auto" label="" />
    </span>
  );
}

/* The count on the Collection tab.

   It was a plain span, re-keyed on every save so React threw it away and the
   entrance animation re-fired. That worked, but it made this the one live
   figure in the app that did not roll — the price, the delta, the collection
   total and the undo clock all turn, and the number they are all turning
   about hard-swapped.

   So the badge stays mounted and rolls, and the two jobs are split across
   two elements because they are two different animations on two different
   clocks: the wrapper deals the badge in ONCE, when the collection stops
   being empty, and the badge itself nudges on every save after that.

   Parity, not a key, is what re-fires the nudge. Re-matching the same
   animation-name leaves a running animation exactly where it is, so there
   are two identical sets of keyframes and the attribute alternates between
   them — the same trick the price tape and the miss-tap hint use. A key
   would remount the reel and cost the roll it exists for. */
const COUNT_ROLL = 420; // ms — shorter than a price; the badge is 16px

function TabCount({ count, nonce }) {
  const text = count > 99 ? "99+" : String(count);

  return (
    <span className="psa-tab-count-in" data-show={count > 0 || undefined} aria-hidden="true">
      <span className="psa-tab-count num" data-pop={nonce % 2}>
        <SlotNumber
          value={text}
          duration={COUNT_ROLL}
          stagger={0}
          direction="auto"
          label=""
        />
      </span>
    </span>
  );
}

function TabBar({ active, onChange, counts = {}, countNonce, undo }) {
  const flight = useSaveFlight();
  const undoMs = undo?.ms ?? 3000;

  /* The stack empties and the pill closes in the same commit, so a count read
     straight off the live value would drop to nothing and take the "×3" out
     of a pill that is still on screen fading. Frozen at its last value while
     the pill is closed, live while it is open — the clock beside it already
     behaves this way, because its interval stops on the same flag. */
  const lastCount = useRef(0);
  if (undo?.open) lastCount.current = undo.count;
  const stackCount = undo?.open ? undo.count : lastCount.current;

  return (
    <nav className="psa-tabbar" aria-label="Sections">
      {/* Collection is the middle of five columns, so dead centre of the bar
          is exactly above it — no measuring and no ref needed. */}
      <button
        type="button"
        className="psa-undo"
        data-show={undo?.open || undefined}
        onClick={() => {
          haptic("tap");
          undo?.onUndo?.();
        }}
        tabIndex={undo?.open ? 0 : -1}
        aria-hidden={!undo?.open}
        aria-label={
          undo?.count > 1 ? `Undo last save, ${undo.count} stacked` : "Undo last save"
        }
      >
        {/* The fill uses the same Web Animations engine as the route's FLIP.
            A nonce change cancels the old drain and starts a fresh linear one;
            its completion dismisses Undo, so there is still only one clock. */}
        <UndoFill duration={undoMs} nonce={undo?.nonce} onEnd={undo?.onExpire} />
        <span className="psa-undo-label">Undo</span>
        <UndoCount count={stackCount} />
      </button>

      {TABS.map((tab) => {
        const isActive = tab.id === active;
        const count = counts[tab.id];
        const isTarget = tab.id === "collection";
        return (
          <button
            key={tab.id}
            type="button"
            className="psa-tab"
            data-active={isActive || undefined}
            data-inert={!tab.live || undefined}
            aria-current={isActive ? "page" : undefined}
            disabled={!tab.live}
            /* The three inert tabs are `disabled`, so they never reach this —
               a dead tab stays dead in the hand as well as on screen, which
               is the honest answer. No "rejected" buzz: a buzz is a response,
               and these are not responding. */
            onClick={() => {
              haptic("tick");
              onChange(tab.id);
            }}
          >
            {/* The icon, not the button, is what a card flies at — the button
                is a fifth of the bar wide and aiming at its centre would land
                the card beside the bookmark rather than on it. */}
            <span className="psa-tab-icon" ref={isTarget ? flight?.registerTarget : undefined}>
              <Icon id={tab.id} active={isActive} />
              <TabCount count={count ?? 0} nonce={countNonce} />
            </span>
            <span className="psa-tab-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/* The bar is deliberately NOT re-keyed by the shell — the undo pill has to
   animate in and out, which it cannot do if the nav remounts under it. So it
   sits through every render of the app, including one a second from the tape,
   and memo is what keeps those from reaching it. Both object props are
   useMemo'd upstream for exactly this. */
export default memo(TabBar);
