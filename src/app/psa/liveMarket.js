"use client";

import { useCallback, useSyncExternalStore } from "react";

/* ─────────────────────────────────────────────────────────────────────────
   liveMarket — a mocked tape for the collection grid.

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

/* Items join the tape when a surface registers its kit (registerItems), not
   at import: what is on the tape is decided by whichever kit is mounted, and
   two kits on one page share the one interval. Registering is idempotent, so
   the server pass, the hydration pass and every remount agree.

   OPEN holds the opening values — the deltas stay honest by being measured
   against these rather than against the previous tick. STATIC holds the
   authored figures, kept aside and never mutated: it is what SSR and the
   hydration pass read, so first paint is identical on both sides. */
const OPEN = new Map();
const BASE_DELTA = new Map();
const STATIC = new Map();
const state = new Map();
const listeners = new Map();

export function registerItems(items) {
  for (const item of items) {
    if (STATIC.has(item.id)) continue;
    const figures = { price: item.value, delta: item.delta, move: 0, tick: 0 };
    OPEN.set(item.id, item.value);
    BASE_DELTA.set(item.id, item.delta);
    STATIC.set(item.id, figures);
    state.set(item.id, figures);
  }
}

let timer = null;
let subscribers = 0;

function tick() {
  // Only items something is watching move — a tick spent on an unseen item
  // is a tick the visible ones did not get.
  const live = [...listeners.keys()];
  if (!live.length) return;
  for (let n = 0; n < MOVERS; n++) {
    const id = live[(Math.random() * live.length) | 0];
    const open = OPEN.get(id);
    const prev = state.get(id);
    if (open === undefined || !prev) continue;

    // Random walk with a light tether: without the pull a long session drifts
    // somewhere silly, and a marketplace that only ever climbs reads as fake.
    const drift = (Math.random() * 2 - 1) * VOL;
    const pull = (open / prev.price - 1) * PULL;
    const pct = drift + pull;

    const price = Math.max(1, prev.price * (1 + pct));
    if (price === prev.price) continue;

    state.set(id, {
      price,
      delta: BASE_DELTA.get(id) + (price / open - 1) * 100,
      move: pct >= 0 ? 1 : -1,
      // Monotonic, and the flash animation keys off its parity — see psa.css.
      tick: prev.tick + 1,
    });

    const set = listeners.get(id);
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
  // A null id is a tile with no figures: it reads nothing and costs nothing.
  const sub = useCallback((fn) => (id == null ? () => {} : subscribe(id, fn)), [id]);
  const get = useCallback(() => state.get(id) ?? STATIC.get(id), [id]);
  const server = useCallback(() => STATIC.get(id), [id]);
  return useSyncExternalStore(sub, get, server);
}

/** The live sum of a set of cards — the collection's value.

    Subscribes to exactly the ids handed in, so a collection of three costs
    three listeners and a tick that moved none of them re-renders nothing.
    The snapshot is a NUMBER, which is what makes this safe to recompute on
    every read: React compares snapshots with Object.is, and a sum that did
    not change compares equal without any caching on our side. */
export function useLiveTotal(ids) {
  // The identity of `ids` changes whenever the collection re-renders; the
  // CONTENT is what the subscription actually depends on.
  const key = ids.join(",");

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sub = useCallback(
    (fn) => {
      const offs = ids.map((id) => subscribe(id, fn));
      return () => {
        for (const off of offs) off();
      };
    },
    [key],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const get = useCallback(() => sum(ids, state), [key]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const server = useCallback(() => sum(ids, STATIC), [key]);

  return useSyncExternalStore(sub, get, server);
}

function sum(ids, from) {
  let total = 0;
  for (const id of ids) total += (from.get(id) ?? STATIC.get(id))?.price ?? 0;
  return total;
}
