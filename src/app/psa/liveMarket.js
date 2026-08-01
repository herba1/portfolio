"use client";

import { useCallback, useSyncExternalStore } from "react";

import { CARDS } from "./cards";

/* ─────────────────────────────────────────────────────────────────────────
   liveMarket — a mocked tape for the /psa grid.

   Shape of the thing: ONE interval for the whole page, a per-card listener
   set, and a random walk that only touches a handful of cards per tick. A
   tile that did not move does not re-render, so the cost of "live" is a few
   React updates a second, not a grid-wide diff — and each of those updates
   bottoms out in SlotNumber, which writes one custom property per digit that
   actually changed. Nothing here touches layout.

   Interruption is the default and not a special case: the store always holds
   the latest price, and SlotNumber retargets a reel mid-roll rather than
   waiting for it to land. A card can reverse direction three times inside one
   transition and the digits just follow.

   The timer is reference-counted against live subscribers and parked while
   the tab is hidden, so a backgrounded page costs nothing.
   ───────────────────────────────────────────────────────────────────────── */

const TICK_MS = 1100;
const MOVERS = 4; // cards touched per tick
const VOL = 0.016; // per-tick drift, fraction of price
const PULL = 0.05; // mean reversion toward the opening price

// Opening prices — the deltas stay honest by being measured against these
// rather than against the previous tick.
const OPEN = new Map(CARDS.map((c) => [c.id, c.price]));

// The authored values, kept aside and never mutated: this is what SSR and the
// hydration pass read, so first paint is identical on both sides.
const STATIC = new Map(
  CARDS.map((c) => [c.id, { price: c.price, delta: c.delta, move: 0, tick: 0 }]),
);

const state = new Map(STATIC);
const listeners = new Map();

let timer = null;
let subscribers = 0;

function tick() {
  for (let n = 0; n < MOVERS; n++) {
    const card = CARDS[(Math.random() * CARDS.length) | 0];
    const open = OPEN.get(card.id);
    const prev = state.get(card.id);

    // Random walk with a light tether: without the pull a long session drifts
    // somewhere silly, and a marketplace that only ever climbs reads as fake.
    const drift = (Math.random() * 2 - 1) * VOL;
    const pull = (open / prev.price - 1) * PULL;
    const pct = drift + pull;

    const price = Math.max(1, prev.price * (1 + pct));
    if (price === prev.price) continue;

    state.set(card.id, {
      price,
      delta: card.delta + (price / open - 1) * 100,
      move: pct >= 0 ? 1 : -1,
      // Monotonic, and the flash animation keys off its parity — see psa.css.
      tick: prev.tick + 1,
    });

    const set = listeners.get(card.id);
    if (set) for (const fn of set) fn();
  }
}

function running() {
  return subscribers > 0 && document.visibilityState === "visible";
}

function sync() {
  const should = running();
  if (should && timer === null) timer = setInterval(tick, TICK_MS);
  else if (!should && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

let watching = false;
function watch() {
  if (watching) return;
  watching = true;
  document.addEventListener("visibilitychange", sync);
}

function subscribe(id, fn) {
  let set = listeners.get(id);
  if (!set) listeners.set(id, (set = new Set()));
  set.add(fn);
  subscribers += 1;
  watch();
  sync();

  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(id);
    subscribers -= 1;
    sync();
  };
}

/** Live figures for one card. Re-renders only this card's tile, only on a
    tick that actually moved it. */
export function useLiveCard(id) {
  const sub = useCallback((fn) => subscribe(id, fn), [id]);
  const get = useCallback(() => state.get(id) ?? STATIC.get(id), [id]);
  const server = useCallback(() => STATIC.get(id), [id]);
  return useSyncExternalStore(sub, get, server);
}
