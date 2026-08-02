"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import SlotNumber from "@/app/ui/SlotNumber";
import { haptic } from "@/lib/haptics";
import MotionConfig from "./MotionConfig";
import PsaChrome from "./PsaChrome";
import { SaveFlightLayer, SaveFlightProvider, flipGrid, useSaveFlight } from "./SaveFlight";
import { UNDO_MS } from "./saveMotion";
import Slab from "./Slab";
import SaveButton from "./SaveButton";
import TabBar, { TABS } from "./TabBar";
import { CARDS, CARD_IMAGES, formatDelta, formatPrice } from "./cards";
import { useLiveCard, useLiveTotal } from "./liveMarket";
import { useMove } from "./figureMove";
import { warmImages } from "./warmImages";
import "./psa-kit.css";
import "./psa.css";

const SHOW_MOTION_CONFIG = process.env.NODE_ENV === "development";

/* ─────────────────────────────────────────────────────────────────────────
   /psa — the collection app.

   Two columns, settled. Five tabs in a footer nav, four of them placeholder
   surfaces and one — Collection — real, because that is where a save goes.

   The transitions are the point of this pass:
     · tab panels slide in from the side you came from, 16px and 220ms, so
       the direction of travel is legible without a page transition
     · saving anywhere pops the Collection tab's count, which is the only
       feedback a save needs once there is a visible destination for it
     · the grid staggers in on mount, 24ms apart, capped so a long list never
       turns into a queue. A filter change is a REFLOW, not a new list — it
       FLIPs the tiles it already has instead of playing that stagger again
     · Collection is the same cards in a different FORMAT — rows, not tiles,
       because it is a ledger and the figures are what you came for. Taking a
       card out of it reflows on the same machinery a filter does: the row
       fades out where it stood and the rest close up over it

   Everything on this surface is memoised, and the props handed to it are
   stable by construction. The reason is the tape: prices tick a few times a
   second, so an un-memoised tree would be re-rendering a dozen cards, their
   scans and the whole footer nav several times a second to move two digits.
   ───────────────────────────────────────────────────────────────────────── */

const FILTERS = [
  { id: "all", label: "All" },
  { id: "gem", label: "Gem mint", test: (c) => c.grade === 10 },
  { id: "t206", label: "T206", test: (c) => c.set.startsWith("T206") },
  { id: "goudey", label: "Goudey", test: (c) => c.set === "Goudey" },
  { id: "oldjudge", label: "Old Judge", test: (c) => c.set.startsWith("Old Judge") },
];

/* The provider sits above the shell so the tab bar can register itself as the
   flight target and MotionConfig can read the armed variant, both of which
   have to happen outside the component that fires the flight. */
export default function PsaExperience() {
  return (
    <SaveFlightProvider>
      <PsaApp />
      {SHOW_MOTION_CONFIG && <MotionConfig />}
    </SaveFlightProvider>
  );
}

function PsaApp() {
  // Fetch and decode every scan once, before any filter or tab is touched.
  // An effect rather than the render body: this mutates a module-level map,
  // and a render-phase side effect during hydration is how the decode state
  // used to change under React mid-pass. The bytes are already moving anyway
  // — PreloadScans puts the preload hints in the first HTML response.
  useEffect(() => {
    warmImages(CARD_IMAGES);
  }, []);

  const [saved, setSaved] = useState(() => new Set());
  const [tab, setTab] = useState("browse");
  const [dir, setDir] = useState(1);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [scrolled, setScrolled] = useState(false);

  // The head collapse is a pure CSS scroll timeline wherever one exists. This
  // listener is the fallback for Safari < 26 only, so it is never attached on
  // a browser that can do the work off the main thread.
  const [needsFallback, setNeedsFallback] = useState(false);
  useEffect(() => {
    setNeedsFallback(
      !(typeof CSS !== "undefined" && CSS.supports?.("animation-timeline: scroll()")),
    );
  }, []);

  const onScroll = useCallback((e) => {
    const past = e.currentTarget.scrollTop > 4;
    setScrolled((prev) => (prev === past ? prev : past));
  }, []);

  // Bumped on every save so the badge animation can be re-keyed. A raw count
  // would not re-fire when a card is removed and another added.
  const saveTick = useRef(0);
  // Cards tapped but not yet landed. Drained one per landing — see Undo below.
  const pendingSaves = useRef([]);

  /* `next` comes down from the bookmark, so the handler knows whether this was
     a save or a removal without having to diff the set — which is what lets
     the undo name the exact card that just landed.

     Saves go into a QUEUE rather than a single slot. A card is tapped now and
     lands a few hundred ms later, so with fast taps the taps run ahead of the
     landings; the queue is what keeps the two paired, and each landing takes
     the oldest tap that has not been claimed yet. */
  const toggle = useCallback((id, next) => {
    if (next) pendingSaves.current.push(id);
    setSaved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    saveTick.current += 1;
  }, []);

  const go = useCallback(
    (next) => {
      const from = TABS.findIndex((t) => t.id === tab);
      const to = TABS.findIndex((t) => t.id === next);
      setDir(to >= from ? 1 : -1);
      setTab(next);
      setScrolled(false); // the panel remounts at scrollTop 0
    },
    [tab],
  );
  // The empty collection's CTA. Inline, it would be a new function every
  // render and CollectionPanel's memo would never hold.
  const goBrowse = useCallback(() => go("browse"), [go]);

  /* The one list every surface below reads. No totals here: the two screens
     that show one subscribe to the live tape themselves, so a figure can
     never be a sum of opening prices sitting over a column of live ones. */
  const savedCards = useMemo(() => CARDS.filter((c) => saved.has(c.id)), [saved]);

  /* The tab's count LAGS the saved set on purpose. A number that appears while
     the card is still in the air says the save already happened somewhere
     else, which makes the whole flight decorative — so the badge waits for
     the landing. Removals are not flights and land immediately. */
  const flight = useSaveFlight();
  const landings = flight?.landings ?? 0;
  // Live from the tuning store, so the panel's slider moves the real window.
  const undoMs = flight?.globals?.undoMs ?? UNDO_MS;
  const [badge, setBadge] = useState(0);
  useEffect(() => {
    setBadge(savedCards.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landings]);
  useEffect(() => {
    setBadge((b) => (savedCards.length < b ? savedCards.length : b));
  }, [savedCards.length]);

  /* ── Undo ───────────────────────────────────────────────────────────────
     Raised when a card lands, not when it is tapped, so the offer arrives
     with the card rather than chasing it.

     It STACKS. Saving four cards in a row and then reaching for undo should
     walk back four cards, newest first, not just the last one — the offer is
     a stack of individual saves, not a single slot that the next save
     overwrites. Each undo pops one card and RE-ARMS the window at full
     length, so you are never racing a clock that started three cards ago.
     Letting the window lapse drops the whole stack at once: the offer was
     "the cards you just saved", and that batch is what expires.

     Undoing puts the tile back into Browse, and that reflows too. FLIP works
     in both directions, but not symmetrically: the neighbours have a before
     and an after so they interpolate, while the arriving tile has no before
     box at all. So it gets its own entrance and SCALES back into the gap
     rather than materialising in it — see flipGrid. */
  const [undoStack, setUndoStack] = useState([]); // oldest first, pop the end
  /* Bumped on every raise AND every undo. It re-keys the drain fill so the
     single visual/behavioral clock restarts from full rather than inheriting
     whatever was left of the previous card's window. */
  const [undoNonce, setUndoNonce] = useState(0);

  useEffect(() => {
    if (!landings) return;
    const id = pendingSaves.current.shift();
    if (!id) return;
    setUndoStack((prev) => [...prev, id]);
    setUndoNonce((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landings]);

  /* The fill is the clock. Its animation-end expires the stack, so the visual
     deadline and the actual offer cannot drift onto two separate timelines. */
  const expireUndo = useCallback(() => setUndoStack([]), []);

  const runUndo = useCallback(() => {
    /* Pop past anything already gone — a card can be un-saved by hand from
       Collection while it is still sitting in the stack, and undoing that
       would be a no-op that eats a tap. */
    const rest = undoStack.slice();
    let target = null;
    while (rest.length) {
      const id = rest.pop();
      if (saved.has(id)) {
        target = id;
        break;
      }
    }
    setUndoStack(rest);
    if (!target) return;
    const put = () =>
      setSaved((prev) => {
        const next = new Set(prev);
        next.delete(target);
        return next;
      });
    if (flight?.flip) flight.flip(put);
    else put();
    // Anything still stacked gets a fresh full window, not the leftovers.
    if (rest.length) setUndoNonce((n) => n + 1);
  }, [undoStack, saved, flight]);

  /* Every component below this line is memoised, which only buys anything if
     the props are stable — an object literal in JSX is a new object on every
     render and defeats the comparison it is handed to. The tape ticks a few
     times a second, so "every render" here still means several a second. */
  const counts = useMemo(() => ({ collection: badge }), [badge]);
  const undo = useMemo(
    () => ({
      open: undoStack.length > 0,
      count: undoStack.length,
      ms: undoMs,
      nonce: undoNonce,
      onUndo: runUndo,
      onExpire: expireUndo,
    }),
    [undoStack.length, undoMs, undoNonce, runUndo, expireUndo],
  );

  return (
    <div className="pk psa">
      <PsaChrome killLenis />

      {/* Keyed on the tab so React remounts and the enter animation runs. */}
      <main
        className="psa-panel"
        key={tab}
        style={{ "--dir": dir }}
        data-lenis-prevent
        data-scrolled={(needsFallback && scrolled) || undefined}
        onScroll={needsFallback ? onScroll : undefined}
      >
        {tab === "browse" && (
          <BrowsePanel
            saved={saved}
            onToggle={toggle}
            filter={filter}
            onFilter={setFilter}
          />
        )}
        {tab === "search" && (
          <SearchPanel
            saved={saved}
            onToggle={toggle}
            query={query}
            onQuery={setQuery}
          />
        )}
        {tab === "collection" && (
          <CollectionPanel cards={savedCards} onToggle={toggle} onBrowse={goBrowse} />
        )}
        {tab === "activity" && <ActivityPanel />}
        {tab === "profile" && <ProfilePanel cards={savedCards} />}
      </main>

      {/* Solid at the very top so anything passing under the status bar is
          gone, not blurred. Lives on the shell, not the head, so it stays put
          while the head lifts. */}
      <div className="psa-status-scrim" aria-hidden />

      {/* Inside the shell, between the panel and the nav: the launch variant
          steps a clone's z-index across the nav, which only means anything if
          they share a stacking context. */}
      <SaveFlightLayer />

      {/* Not re-keyed. The count restarts its pop via its own key inside, so
          the bar — and the undo pill, which has to animate in — survives. */}
      <TabBar
        active={tab}
        onChange={go}
        counts={counts}
        countNonce={landings}
        undo={undo}
      />
    </div>
  );
}

/* ── Shared tile ──────────────────────────────────────────────────────────
   The two-column tile, one definition used by every panel so the grid never
   drifts between surfaces.

   The figures are odometers on a live tape. SlotNumber only animates on a
   value CHANGE, so a tile mounts with its digits zeroed — same shape, same
   width, no reflow when they land — and swaps to the real figures once its
   own entrance is under way. After that the market takes over: useLiveCard
   subscribes this tile alone, so a tick that moves four cards re-renders four
   tiles, and each of those writes one custom property per digit that actually
   turned. A price arriving mid-roll retargets the reel instead of queueing
   behind it, which is what makes a fast-moving card look fast rather than
   backed up.                                                               */
const STAGGER_STEP = 24; // ms — mirrors .psa-tile's animation-delay
const ROLL_LEAD = 110; // ms into the 320ms entrance before the digits start
const ROLL_MS = 640; // must equal --psa-tick-dur in psa.css
const ROLL_STAGGER = 38; // per-digit carry delay

// Zeroed twin of a formatted figure: "$12.4K" → "$00.0K", "+2.4%" → "+0.0%".
// Digits only, so the separators and the sign stay put and the reel structure
// is identical before and after — SlotNumber rebuilds nothing.
const zeroed = (text) => text.replace(/\d/g, "0");

function useRolled(delay) {
  const [rolled, setRolled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setRolled(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return rolled;
}

/* One card's live figures, and the beat each of them is on. Shared by the
   grid tile and the collection row so both surfaces read the same tape the
   same way — the only thing that differs between them is the layout. */
function useFigures(id, rolled) {
  const live = useLiveCard(id);

  const price = rolled ? formatPrice(live.price) : zeroed(formatPrice(live.price));
  const delta = rolled ? formatDelta(live.delta) : zeroed(formatDelta(live.delta));

  // Each figure keeps its own beat, off its own rendered text. This is the
  // whole sync story: a tick that moves the price from 12,412 to 12,447 still
  // prints "$12.4K", and a figure that is not turning must not pulse.
  const priceMove = useMove(price, live.price);
  const deltaMove = useMove(delta, live.delta);

  return { live, price, delta, priceMove, deltaMove };
}

/* Both figures, in DOM order, for whichever container is holding them. The
   grid lays them out on one line and the collection stacks them in a column;
   neither changes what a figure is. */
const Figures = memo(function Figures({ live, price, delta, priceMove, deltaMove }) {
  return (
    <>
      <Figure move={priceMove}>
        <SlotNumber
          className="price"
          value={price}
          label={formatPrice(live.price)}
          direction={priceMove.dir < 0 ? "down" : "up"}
          duration={ROLL_MS}
          stagger={ROLL_STAGGER}
        />
      </Figure>
      <Figure move={deltaMove}>
        <SlotNumber
          className="delta"
          data-dir={live.delta >= 0 ? "up" : "down"}
          value={delta}
          label={formatDelta(live.delta)}
          direction={deltaMove.dir < 0 ? "down" : "up"}
          duration={ROLL_MS}
          stagger={ROLL_STAGGER}
        />
      </Figure>
    </>
  );
});

const Tile = memo(function Tile({ card, saved, onToggle, index = 0 }) {
  const stagger = Math.min(index, 8);
  const rolled = useRolled(stagger * STAGGER_STEP + ROLL_LEAD);
  const figures = useFigures(card.id, rolled);

  /* The scan is what travels, so the flight measures the art wrapper rather
     than the tile — including the caption would launch a rectangle with two
     lines of dead space under the picture. Only a SAVE flies; removing a card
     is not an event that needs a courier. */
  const artRef = useRef(null);
  const flight = useSaveFlight();

  /* Stable, so SaveButton's memo holds through a tick that only moved the
     price. The tile takes (id, next) from its parent rather than a bound
     closure for the same reason — a closure per card is a new prop per
     render, and a memo comparing new props every time is just overhead. */
  const handleToggle = useCallback(
    (next) => {
      if (next && flight) flight.save(artRef.current, () => onToggle(card.id, next));
      else onToggle(card.id, next);
    },
    [flight, onToggle, card.id],
  );

  /* Tapping the card is a MISS, not a second way to save. The bookmark is the
     one action on this surface, so a tap that lands anywhere else answers by
     pointing at it — the icon hops and flashes brand rather than the card
     quietly doing nothing. Bumped, not toggled, so a second miss re-fires it;
     see SaveButton for why the attribute alternates. An already-saved card has
     nothing to point at, so it stays still. */
  const [hint, setHint] = useState(0);
  const nudge = useCallback(() => {
    if (!saved) {
      haptic("nudge");
      setHint((n) => n + 1);
    }
  }, [saved]);
  /* Clearing on a state flip is what stops a stale hint from firing later:
     miss a card in Search, save it, un-save it, and the attribute would start
     matching again mid-drain and play a nudge nobody asked for. Adjusted
     during render rather than in an effect so the attribute is already gone in
     the same commit — an effect would let one frame of it through. */
  const wasSaved = useRef(saved);
  if (wasSaved.current !== saved) {
    wasSaved.current = saved;
    if (hint) setHint(0);
  }

  return (
    /* data-card-id is what FLIP matches boxes on across the removal — the
       node identity is not stable through a React reconcile, but this is. */
    <li
      className="psa-tile"
      data-card-id={card.id}
      style={{ "--stagger": stagger }}
      onClick={nudge}
    >
      <div className="psa-tile-art" ref={artRef}>
        <Slab card={card} sizes="45vw" />
        <div className="psa-tile-save">
          <SaveButton saved={saved} onToggle={handleToggle} hint={hint} />
        </div>
      </div>
      <div className="psa-tile-text">
        <span className="t-body-sm psa-tile-player">{card.player}</span>
        {/* Two-line meta: the set line is what stops a grid of portraits from
            being a grid of anonymous portraits. Six T206s share a look, and
            the year plus set is the cheapest thing that tells them apart. */}
        <span className="t-body-sm psa-tile-set">
          {card.year} {card.set}
        </span>
        <div className="psa-tile-figures">
          <Figures {...figures} />
        </div>
      </div>
    </li>
  );
});

/* The move gesture: the figure scales out when its digits roll up and in when
   they roll down. Every part of it is CSS — React contributes a direction and
   the beat's parity, and the parity is there because two consecutive up-moves
   would otherwise re-match the same rule and the animation would never
   restart. Alternating between two identical sets of keyframes restarts it
   without touching the DOM or reading layout.

   The gesture and the roll are started by the SAME render off the SAME text
   change, run for the same duration, and are interrupted together — which is
   what keeps them locked to each other however fast the tape moves. */
const Figure = memo(function Figure({ move, children }) {
  return (
    <span
      className="psa-fig"
      data-dir={move.dir < 0 ? "down" : "up"}
      data-beat={move.beat === 0 ? undefined : move.beat % 2}
    >
      {children}
    </span>
  );
});

const Grid = memo(function Grid({ cards, saved, onToggle, stagKey }) {
  return (
    <ul className="psa-grid" key={stagKey}>
      {cards.map((card, i) => (
        <Tile
          key={card.id}
          card={card}
          index={i}
          saved={saved.has(card.id)}
          onToggle={onToggle}
        />
      ))}
    </ul>
  );
});

const PanelHead = memo(function PanelHead({ title, children }) {
  return (
    <header className="psa-panel-head">
      <h1 className="t-head-2xl">{title}</h1>
      {children}
    </header>
  );
});

/* ── Browse ───────────────────────────────────────────────────────────── */
const BrowsePanel = memo(function BrowsePanel({ saved, onToggle, filter, onFilter }) {
  /* Saving FILES a card, whichever variant is armed: the tile leaves Browse
     and the rest close the gap behind it. Un-saving — from Collection or from
     the undo — puts it back, and the grid opens up for it again. */
  const visible = useMemo(() => {
    const spec = FILTERS.find((f) => f.id === filter);
    const base = spec?.test ? CARDS.filter(spec.test) : CARDS;
    return base.filter((c) => !saved.has(c.id));
  }, [filter, saved]);

  /* A filter is not a new list, it is the same list with fewer cards in it —
     so it REFLOWS. The grid used to re-key here, which threw away every tile
     and played the mount stagger again: 24 cards fading up from nothing to
     say that six of them had gone. FLIP instead. The survivors slide from
     where they were to where they are now, the cut ones vanish, and the
     cards that a wider filter brings back scale into their gaps.

     Same machinery a save uses, for the same reason — see flipGrid. */
  const flight = useSaveFlight();
  const pick = useCallback(
    (id) => {
      // Before the note, not after: re-tapping the active chip changes
      // nothing on screen, so it should change nothing in the hand either.
      if (id === filter) return;
      haptic("tick");
      // exit: the cut cards have nothing carrying them off, so they animate
      // out themselves. A saved card never does — its clone already left.
      if (flight?.flip) flight.flip(() => onFilter(id), undefined, { exit: true });
      else onFilter(id);
    },
    [filter, onFilter, flight],
  );

  return (
    <>
      {/* Title and rail share one sticky bar that lifts as you scroll — the
          hairline rides its bottom edge. See .psa-head in psa.css. */}
      <div className="psa-head">
        {/* Names the control, not the outcome. "Add to your collection" is
            true but leaves the bookmark looking like decoration on the scan;
            the title has to say which 28px to press. */}
        <PanelHead title="Add to your bookmarks" />
        <div className="chip-rail psa-rail psa-rail-fade">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="chip"
              aria-pressed={filter === f.id}
              onClick={() => pick(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {/* No stagKey: the grid must NOT re-key on a filter, or FLIP has no
          "before" boxes to measure and every tile mounts from scratch. */}
      <Grid cards={visible} saved={saved} onToggle={onToggle} />
    </>
  );
});

/* ── Search ───────────────────────────────────────────────────────────── */
const SearchPanel = memo(function SearchPanel({ saved, onToggle, query, onQuery }) {
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CARDS;
    return CARDS.filter((c) =>
      `${c.player} ${c.set} ${c.variant} ${c.year}`.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <>
      <PanelHead title="Search" />
      <div className="psa-search">
        <input
          className="psa-search-input"
          type="search"
          value={query}
          placeholder="Player, set or year"
          onChange={(e) => onQuery(e.target.value)}
        />
      </div>
      {results.length === 0 ? (
        <p className="t-body psa-empty">No cards match {query}.</p>
      ) : (
        <Grid cards={results} saved={saved} onToggle={onToggle} stagKey={query} />
      )}
    </>
  );
});

/* ── Collection ───────────────────────────────────────────────────────── */

/* The empty state's mark: three real scans rather than a drawn icon. An
   outlined bookmark would be a picture of the control; this is a picture of
   what you get for using it, which is the thing worth showing on a screen
   that is otherwise empty.

   Order is back-left, back-right, front — DOM order is stacking order, so the
   card that reads as on top is simply last.

   The three are chosen on RATIO, not on fame. A slab is 14/25 and the scans
   are contained inside it, so a card whose scan is a different shape gets
   matted — which is right in a grid, where every slab has to be the same box,
   and wrong here, where the scan is the whole picture and the mat reads as a
   mistake. The Goudey Ruth is 660×801, near enough square, so it sat in the
   frame with bars down both sides. Every other scan in the set is between
   0.536 and 0.565 against a frame of 0.560 — they fill it, edge to edge, as
   shot. So: Cobb in front, Mathewson and Galvin behind, and Galvin's sepia
   Old Judge keeps the trio from being three of the same white border.

   Three wrappers, one job each, because they animate on different clocks:
   the li holds the static fan, .psa-blank-rise deals it in once, and
   .psa-blank-float loops forever. Stacking them means neither animation has
   to restate the other's transform. */
const STACK_IDS = ["oldjudge-galvin", "t206-mathewson", "t206-cobb"];
const STACK = STACK_IDS.map((id) => CARDS.find((c) => c.id === id)).filter(Boolean);

const BlankStack = memo(function BlankStack() {
  return (
    <ul className="psa-blank-stack" aria-hidden="true">
      {STACK.map((card, i) => (
        <li className="psa-blank-card" key={card.id} style={{ "--i": i }}>
          <span className="psa-blank-rise">
            <span className="psa-blank-float">
              <Slab card={card} sizes="96px" />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
});

/* ── The row ──────────────────────────────────────────────────────────────
   Collection is a LEDGER, not a shop window. Browse is two columns of scans
   because the question there is "which card is this", and the answer is the
   picture; here the card is already yours and the question is what it is
   worth, so the scan drops to a 40px thumbnail and the figures take the
   width the picture gives up.

   The format is what fixes the figures. In a tile, price and delta share one
   line at opposite ends of a 45vw box, which puts the two numbers on the
   same baseline but in different columns on every row — nothing lines up
   with anything and a column of prices cannot be read as a column. In a row
   they stack into a right-aligned block: every price sits on the same right
   edge in tabular figures, every delta directly beneath its own price, and
   the eye can run straight down the column. The row also has room for the
   grade, which the tile never had anywhere to put.
   ───────────────────────────────────────────────────────────────────────── */
const ROW_STAGGER_STEP = 28; // ms — mirrors .psa-row's animation-delay

const CollectionRow = memo(function CollectionRow({ card, onToggle, index = 0 }) {
  const stagger = Math.min(index, 8);
  const rolled = useRolled(stagger * ROW_STAGGER_STEP + ROLL_LEAD);
  const figures = useFigures(card.id, rolled);

  /* Only ever a REMOVAL. Every card on this surface is already saved, so the
     bookmark has one direction to go and nothing flies anywhere — the flight
     is for the trip TO here. */
  const remove = useCallback((next) => onToggle(card.id, next), [onToggle, card.id]);

  return (
    // data-card-id is what FLIP matches boxes on across the removal — same
    // contract the grid tiles have, so flipGrid works on this list unchanged.
    <li className="psa-row" data-card-id={card.id} style={{ "--stagger": stagger }}>
      <span className="psa-row-thumb">
        <Slab card={card} sizes="40px" />
      </span>
      <span className="psa-row-text">
        <span className="t-body psa-row-player">{card.player}</span>
        <span className="t-body-sm psa-row-meta">
          {card.year} {card.set} · PSA {card.grade}
        </span>
      </span>
      <span className="psa-row-figures">
        <Figures {...figures} />
      </span>
      <span className="psa-row-save">
        <SaveButton saved onToggle={remove} />
      </span>
    </li>
  );
});

const CollectionPanel = memo(function CollectionPanel({ cards, onToggle, onBrowse }) {
  const listRef = useRef(null);
  const flight = useSaveFlight();

  /* The removal the collection never had. Taking a card out used to re-key
     the whole list — every remaining card was thrown away and re-mounted, so
     removing one of eight replayed an eight-card entrance to say that one had
     gone. Now it REFLOWS, the same way a filter does in Browse: the row that
     is leaving fades out pinned at the box it just vacated, and the rows
     below it slide up into the gap.

     exit: true because nothing else is carrying this card off. A save has a
     flying clone doing that job; an un-save has no courier, so the row has to
     animate out on its own. See flipGrid. */
  const remove = useCallback(
    (id, next) => {
      const run = () => onToggle(id, next);
      if (flight?.flip) flight.flip(run, listRef.current, { exit: true });
      else run();
    },
    [flight, onToggle],
  );

  /* The total rides the same tape the rows do. A static sum sitting over a
     column of live prices is the one figure on the screen that is wrong, and
     it is the largest one — so it subscribes to exactly the cards in the
     list and rolls when they move. */
  const ids = useMemo(() => cards.map((c) => c.id), [cards]);
  const total = useLiveTotal(ids);
  const totalText = formatPrice(total);
  const totalMove = useMove(totalText, total);

  if (cards.length === 0) {
    return (
      <>
        <PanelHead title="Collection" />
        {/* The head keeps the top; this box takes the rest of the panel and
            centres in it. See .psa-panel:has(> .psa-blank) in psa.css. */}
        <div className="psa-blank">
          <BlankStack />
          <p className="t-body psa-blank-text">
            <strong>Nothing bookmarked yet.</strong>
            Tap the bookmark on any card and it lands here.
          </p>
          <button type="button" className="psa-cta" onClick={onBrowse}>
            Browse cards
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <PanelHead title="Collection">
        {/* Value first in the DOM because it is first on the line — the count
            is the annotation, so it sits at the right edge the price column
            below is set against. */}
        <div className="psa-summary">
          <Figure move={totalMove}>
            <SlotNumber
              className="t-head-xl num"
              value={totalText}
              label={totalText}
              direction={totalMove.dir < 0 ? "down" : "up"}
              duration={ROLL_MS}
              stagger={ROLL_STAGGER}
            />
          </Figure>
          <span className="t-body-sm psa-summary-label">
            {cards.length} card{cards.length === 1 ? "" : "s"}
          </span>
        </div>
      </PanelHead>
      {/* No stagKey and no re-key on length: the list must survive a removal
          for FLIP to have "before" boxes to measure. The stagger is a MOUNT
          entrance, so it belongs to arriving on the tab, not to editing. */}
      <ul className="psa-rows" ref={listRef}>
        {cards.map((card, i) => (
          <CollectionRow key={card.id} card={card} index={i} onToggle={remove} />
        ))}
      </ul>
    </>
  );
});

/* ── Activity (placeholder surface) ───────────────────────────────────── */
const FEED = [
  { id: "a1", card: CARDS[0], event: "Sold at auction", when: "2h" },
  { id: "a2", card: CARDS[9], event: "New population high", when: "6h" },
  { id: "a3", card: CARDS[4], event: "Price up 5.7%", when: "1d" },
  { id: "a4", card: CARDS[6], event: "Graded PSA 10", when: "2d" },
  { id: "a5", card: CARDS[2], event: "Listed for sale", when: "3d" },
];

const ActivityPanel = memo(function ActivityPanel() {
  return (
    <>
      <PanelHead title="Activity" />
      <ul className="psa-feed">
        {FEED.map((item, i) => (
          <li className="psa-feed-row" key={item.id} style={{ "--stagger": i }}>
            <span className="psa-feed-thumb">
              <Slab card={item.card} sizes="36px" />
            </span>
            <span className="psa-feed-text">
              <span className="t-body psa-feed-event">{item.event}</span>
              <span className="t-body-sm psa-feed-card">
                {item.card.year} {item.card.set} · {item.card.player}
              </span>
            </span>
            <span className="t-body-sm psa-feed-when num">{item.when}</span>
          </li>
        ))}
      </ul>
    </>
  );
});

/* ── Profile (placeholder surface) ────────────────────────────────────── */
/* The surface is a placeholder; the FIGURES on it are not. All three read the
   same saved set the collection does, off the same live tape — a Value here
   that disagreed with the total two tabs over would be the app contradicting
   itself, and "Sets" was a hardcoded 3 that stayed 3 while you held one card. */
const ProfilePanel = memo(function ProfilePanel({ cards }) {
  const ids = useMemo(() => cards.map((c) => c.id), [cards]);
  const total = useLiveTotal(ids);
  const sets = useMemo(() => new Set(cards.map((c) => c.set)).size, [cards]);
  const count = cards.length;

  return (
    <>
      <PanelHead title="Profile" />
      <div className="psa-profile">
        <div className="psa-profile-id">
          <span className="psa-avatar" aria-hidden="true" />
          <span className="psa-profile-name">
            <span className="t-head-lg">Herb</span>
            <span className="t-body-sm psa-profile-handle">Collector since 2019</span>
          </span>
        </div>
        <dl className="psa-profile-stats">
          <div>
            <dt className="t-body-sm">Saved</dt>
            <dd className="t-head-xl num">{count}</dd>
          </div>
          <div>
            <dt className="t-body-sm">Value</dt>
            <dd className="t-head-xl num">{formatPrice(total)}</dd>
          </div>
          <div>
            <dt className="t-body-sm">Sets</dt>
            <dd className="t-head-xl num">{sets}</dd>
          </div>
        </dl>
      </div>
    </>
  );
});
