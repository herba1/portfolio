"use client";

import { useEffect, useState } from "react";

import SlotNumber from "@/app/ui/SlotNumber";
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


/* The countdown, on the same odometer as every other live figure on the site.
   A price and a deadline are both numbers that move on their own, and the app
   already has one way of showing that; a plain digit swapping in place would
   be the only figure here that does not roll.

   Whole seconds, and the only thing in the pill carrying the deadline. Polled
   at 100ms so the digit turns close to the boundary rather than up to a second
   late, but only committed when the whole second does — a same-value setState
   never reaches the reel. */
const ROLL = 300;

function UndoSeconds({ ms, nonce, open }) {
  const [secs, setSecs] = useState(() => Math.ceil(ms / 1000));

  useEffect(() => {
    if (!open) return undefined;
    const end = performance.now() + ms;
    const write = () => {
      // Floored at 1: the pill is gone the moment this would read 0, and a 0
      // flashing on the way out is a frame of the wrong number.
      const left = Math.max(1, Math.ceil((end - performance.now()) / 1000));
      setSecs((prev) => (prev === left ? prev : left));
    };
    write();
    const id = setInterval(write, 100);
    return () => clearInterval(id);
  }, [ms, nonce, open]);

  return (
    <span className="psa-undo-secs num" aria-hidden="true">
      <SlotNumber value={secs} duration={ROLL} stagger={0} direction="down" label="" />
      <span className="psa-undo-unit">s</span>
    </span>
  );
}

export default function TabBar({ active, onChange, counts = {}, countNonce, undo }) {
  const flight = useSaveFlight();
  const undoMs = undo?.ms ?? 3000;

  return (
    <nav className="psa-tabbar" aria-label="Sections">
      {/* Collection is the middle of five columns, so dead centre of the bar
          is exactly above it — no measuring and no ref needed. */}
      <button
        type="button"
        className="psa-undo"
        data-show={undo?.open || undefined}
        onClick={undo?.onUndo}
        tabIndex={undo?.open ? 0 : -1}
        aria-hidden={!undo?.open}
        aria-label={
          undo?.count > 1 ? `Undo last save, ${undo.count} stacked` : "Undo last save"
        }
      >
        {/* The word and the clock. No fill and no shimmer behind them, and no
            stacked-saves chip beside them — how many are queued still reaches a
            screen reader through the button's own label. */}
        <span className="psa-undo-label">Undo</span>
        <UndoSeconds ms={undoMs} nonce={undo?.nonce} open={!!undo?.open} />
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
            onClick={() => onChange(tab.id)}
          >
            {/* The icon, not the button, is what a card flies at — the button
                is a fifth of the bar wide and aiming at its centre would land
                the card beside the bookmark rather than on it. */}
            <span className="psa-tab-icon" ref={isTarget ? flight?.registerTarget : undefined}>
              <Icon id={tab.id} active={isActive} />
              {count > 0 && (
                /* Keyed on the nonce, not the value, so the pop re-fires even
                   when a save and a removal leave the number where it was.
                   Keying just this span means the rest of the bar — and the
                   undo pill, which needs to animate in — never remounts. */
                <span className="psa-tab-count num" key={countNonce} aria-hidden="true">
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </span>
            <span className="psa-tab-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
