"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import SlotNumber from "@/app/ui/SlotNumber";
import MotionConfig from "./MotionConfig";
import PsaChrome from "./PsaChrome";
import { SaveFlightLayer, SaveFlightProvider, flipGrid, useSaveFlight } from "./SaveFlight";
import { UNDO_MS } from "./saveMotion";
import Slab from "./Slab";
import SaveButton from "./SaveButton";
import TabBar, { TABS } from "./TabBar";
import { CARDS, CARD_IMAGES, formatDelta, formatPrice } from "./cards";
import { useLiveCard } from "./liveMarket";
import { warmImages } from "./warmImages";
import "./psa-kit.css";
import "./psa.css";

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
      <MotionConfig />
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

  const savedCards = useMemo(() => CARDS.filter((c) => saved.has(c.id)), [saved]);
  const total = useMemo(
    () => savedCards.reduce((sum, c) => sum + c.price, 0),
    [savedCards],
  );

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
  /* Bumped on every raise AND every undo. It is what re-keys the drain bar and
     the countdown, so both restart from full rather than inheriting whatever
     was left of the previous card's window. */
  const [undoNonce, setUndoNonce] = useState(0);

  useEffect(() => {
    if (!landings) return;
    const id = pendingSaves.current.shift();
    if (!id) return;
    setUndoStack((prev) => [...prev, id]);
    setUndoNonce((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landings]);

  /* One timer for the whole stack, re-armed by the nonce. Nothing to clear by
     hand on undo: bumping the nonce tears this effect down and sets it up
     again, which IS the reset. */
  useEffect(() => {
    if (!undoNonce || !undoStack.length) return;
    const t = setTimeout(() => setUndoStack([]), undoMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoNonce, undoMs]);

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
          <CollectionPanel
            cards={savedCards}
            total={total}
            onToggle={toggle}
            onBrowse={() => go("browse")}
          />
        )}
        {tab === "activity" && <ActivityPanel />}
        {tab === "profile" && <ProfilePanel count={savedCards.length} total={total} />}
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
        counts={{ collection: badge }}
        countNonce={landings}
        undo={{
          open: undoStack.length > 0,
          count: undoStack.length,
          ms: undoMs,
          nonce: undoNonce,
          onUndo: runUndo,
        }}
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

/* Beat and direction for one figure, derived from the text it actually
   renders. Two properties matter and both are about staying in sync:

     · the beat advances ONLY when the printed digits change, so a tick that
       moves the price under the rounding never fires a gesture on a figure
       that is standing still
     · the direction is this figure's own, taken from its own value, so the
       price and the delta are never told to gesture on each other's behalf

   A ref written during render rather than an effect, because the gesture has
   to be on the element in the same commit that hands SlotNumber its new
   value — a frame later and the two would visibly separate. */
function useMove(text, value) {
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

function useRolled(delay) {
  const [rolled, setRolled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setRolled(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return rolled;
}

function Tile({ card, saved, onToggle, index = 0 }) {
  const stagger = Math.min(index, 8);
  const rolled = useRolled(stagger * STAGGER_STEP + ROLL_LEAD);
  const live = useLiveCard(card.id);

  const price = rolled ? formatPrice(live.price) : zeroed(formatPrice(live.price));
  const delta = rolled ? formatDelta(live.delta) : zeroed(formatDelta(live.delta));

  // Each figure keeps its own beat, off its own rendered text. This is the
  // whole sync story: a tick that moves the price from 12,412 to 12,447 still
  // prints "$12.4K", and a figure that is not turning must not pulse.
  const priceMove = useMove(price, live.price);
  const deltaMove = useMove(delta, live.delta);

  /* The scan is what travels, so the flight measures the art wrapper rather
     than the tile — including the caption would launch a rectangle with two
     lines of dead space under the picture. Only a SAVE flies; removing a card
     is not an event that needs a courier. */
  const artRef = useRef(null);
  const flight = useSaveFlight();

  const handleToggle = (next) => {
    if (next && flight) flight.save(artRef.current, () => onToggle(next));
    else onToggle(next);
  };

  /* Tapping the card is a MISS, not a second way to save. The bookmark is the
     one action on this surface, so a tap that lands anywhere else answers by
     pointing at it — the icon hops and flashes brand rather than the card
     quietly doing nothing. Bumped, not toggled, so a second miss re-fires it;
     see SaveButton for why the attribute alternates. An already-saved card has
     nothing to point at, so it stays still. */
  const [hint, setHint] = useState(0);
  const nudge = () => {
    if (!saved) setHint((n) => n + 1);
  };
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
        </div>
      </div>
    </li>
  );
}

/* The move gesture: the figure scales out when its digits roll up and in when
   they roll down. Every part of it is CSS — React contributes a direction and
   the beat's parity, and the parity is there because two consecutive up-moves
   would otherwise re-match the same rule and the animation would never
   restart. Alternating between two identical sets of keyframes restarts it
   without touching the DOM or reading layout.

   The gesture and the roll are started by the SAME render off the SAME text
   change, run for the same duration, and are interrupted together — which is
   what keeps them locked to each other however fast the tape moves. */
function Figure({ move, children }) {
  return (
    <span
      className="psa-fig"
      data-dir={move.dir < 0 ? "down" : "up"}
      data-beat={move.beat === 0 ? undefined : move.beat % 2}
    >
      {children}
    </span>
  );
}

function Grid({ cards, saved, onToggle, stagKey }) {
  return (
    <ul className="psa-grid" key={stagKey}>
      {cards.map((card, i) => (
        <Tile
          key={card.id}
          card={card}
          index={i}
          saved={saved.has(card.id)}
          onToggle={(next) => onToggle(card.id, next)}
        />
      ))}
    </ul>
  );
}

function PanelHead({ title, children }) {
  return (
    <header className="psa-panel-head">
      <h1 className="t-head-2xl">{title}</h1>
      {children}
    </header>
  );
}

/* ── Browse ───────────────────────────────────────────────────────────── */
function BrowsePanel({ saved, onToggle, filter, onFilter }) {
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
      if (id === filter) return;
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
}

/* ── Search ───────────────────────────────────────────────────────────── */
function SearchPanel({ saved, onToggle, query, onQuery }) {
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
}

/* ── Collection ───────────────────────────────────────────────────────── */
function CollectionPanel({ cards, total, onToggle, onBrowse }) {
  if (cards.length === 0) {
    return (
      <>
        <PanelHead title="Collection" />
        <div className="psa-blank">
          <p className="t-body psa-blank-text">
            Nothing bookmarked yet. Tap the bookmark on any card and it lands
            here.
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
        <div className="psa-summary">
          <span className="t-body-sm psa-summary-label">
            {cards.length} card{cards.length === 1 ? "" : "s"}
          </span>
          <span className="t-head-xl num">{formatPrice(total)}</span>
        </div>
      </PanelHead>
      <Grid
        cards={cards}
        saved={new Set(cards.map((c) => c.id))}
        onToggle={onToggle}
        stagKey={`col-${cards.length}`}
      />
    </>
  );
}

/* ── Activity (placeholder surface) ───────────────────────────────────── */
const FEED = [
  { id: "a1", card: CARDS[0], event: "Sold at auction", when: "2h" },
  { id: "a2", card: CARDS[9], event: "New population high", when: "6h" },
  { id: "a3", card: CARDS[4], event: "Price up 5.7%", when: "1d" },
  { id: "a4", card: CARDS[6], event: "Graded PSA 10", when: "2d" },
  { id: "a5", card: CARDS[2], event: "Listed for sale", when: "3d" },
];

function ActivityPanel() {
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
}

/* ── Profile (placeholder surface) ────────────────────────────────────── */
function ProfilePanel({ count, total }) {
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
            <dd className="t-head-xl num">3</dd>
          </div>
        </dl>
      </div>
    </>
  );
}
