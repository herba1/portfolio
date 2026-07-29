"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useLenis } from "@/context/LenisContext";
import { useMobileMenu } from "@/app/ui/Navigation/MobileMenuContext";
import SlotNumber from "@/app/ui/SlotNumber";
import "./deck.css";

/* ───────────────────────────────────────────────────────────────────
 * Deck — the JS half of the interaction, and it is deliberately small.
 *
 * Everything geometric (place in the stack, the slide-out, the climb)
 * is computed in CSS from a single inherited custom property, `--dk-p`.
 * This file's only job is to keep `--dk-p` in step with scroll:
 *
 *   • one `style.setProperty` per frame, on ONE element
 *   • no `getBoundingClientRect` in the hot path — track metrics are
 *     cached and only re-read on resize
 *   • reads (scroll events) and writes (rAF) live in different phases
 *     of the frame, so there is never a forced synchronous layout
 *   • the rAF loop parks itself when the value settles
 *
 * React state changes exactly once per whole-index crossing (~50 times
 * over the entire page) to feed the readout. The card list is memoised
 * against `cards` alone, so those renders never touch the 50 <img>
 * elements — React sees the same element objects and skips them.
 * ─────────────────────────────────────────────────────────────────── */

// Off. The deck runs on the defaults in deck.css; flip this to
// `process.env.NODE_ENV !== "production"` when there's tuning to do.
const DEV = false;
const DeckControls = dynamic(() => import("./DeckControls"), { ssr: false });

// Multi-stop, eased gradients for the no-Spotify fallback so the route
// still demonstrates the interaction with nothing configured.
const FALLBACK = [
  ["#F3B7A3", "#E5876B", "#B4453C"],
  ["#A9C4D6", "#6E9AB8", "#2F5B7C"],
  ["#C6D3A8", "#94AC72", "#4F6B3C"],
  ["#F0D3A1", "#D9A85E", "#9A6C22"],
  ["#CDB4D8", "#9B7BB8", "#5B3F7A"],
  ["#F4E1A0", "#DCC152", "#96811B"],
  ["#B0B8DE", "#7A85C0", "#3E4885"],
  ["#EFB9C4", "#D0808F", "#8C3F50"],
  ["#A8CFC0", "#6FA893", "#2F6B57"],
  ["#E2B49A", "#C08560", "#7E4E2C"],
];

function fallbackDeck(n) {
  return Array.from({ length: n }, (_, i) => {
    const [a, b, c] = FALLBACK[i % FALLBACK.length];
    return {
      id: `fallback-${i}`,
      title: `Untitled ${String(i + 1).padStart(2, "0")}`,
      artist: "Spotify not configured",
      image: null,
      // Eased multi-stop, not a two-stop fade — the midpoints are placed
      // off-centre so the ramp reads as light falling rather than a blend.
      gradient: `linear-gradient(148deg, ${a} 0%, ${b} 38%, ${b} 52%, ${c} 100%)`,
    };
  });
}

export default function Deck({ tracks }) {
  const all = useMemo(
    () => (tracks?.length ? tracks : fallbackDeck(24)),
    [tracks],
  );

  // ── phone budget ─────────────────────────────────────────────────
  // Every card recomputes its transform when `--dk-p` changes, so the cost
  // of a frame is linear in how many are mounted — and a phone has an
  // order of magnitude less of everything to spend on it. Well past the
  // first ~20 the covers are a few px of sliver anyway, so on a small
  // screen the tail is simply not built. Resolved after mount so SSR
  // markup stays identical for every client.
  const [cap, setCap] = useState(0);
  const [wide, setWide] = useState(false);

  // ── which way the deck runs ──────────────────────────────────────
  // On a phone it is a HORIZONTAL scroller: the page is exactly one
  // screen tall, and the deck runs on its own sideways overflow. That
  // buys three things at once, none of which is hand-written —
  //
  //   • the gesture is native, so it has real momentum, friction and
  //     rubber-banding. Nothing tracks a finger better than the
  //     platform's own scroller.
  //   • sideways is the direction the deck actually runs, so the swipe
  //     and the artwork agree.
  //   • the document never scrolls, so the URL bar has no reason to
  //     move and the viewport simply stops resizing.
  //
  // See the media block in deck.css for the other half.
  const [hscroll, setHscroll] = useState(false);

  useEffect(() => {
    const small = window.matchMedia("(max-width: 640px)");
    const big = window.matchMedia("(min-width: 900px)");
    const read = () => {
      setCap(small.matches ? 22 : 0);
      setHscroll(small.matches);
      setWide(big.matches);
    };
    read();
    small.addEventListener("change", read);
    big.addEventListener("change", read);
    return () => {
      small.removeEventListener("change", read);
      big.removeEventListener("change", read);
    };
  }, []);

  const cards = useMemo(() => (cap ? all.slice(0, cap) : all), [all, cap]);
  const count = cards.length;

  const trackRef = useRef(null);
  // The sideways run's length, and ONLY used in that mode — on desktop
  // this element is `display: contents` and has no box at all, so the
  // desktop measurement still comes off `.deck` exactly as it always did.
  const innerRef = useRef(null);
  const stageRef = useRef(null);
  const { lenis } = useLenis();
  const lenisRef = useRef(null);
  lenisRef.current = lenis;

  // The mobile menu turns the page into a fixed, clipped card and
  // translates its contents up by the scroll you had — at which point
  // nothing scrolls and `position: sticky` has nothing to stick to, so
  // the stage drops to the top of a several-thousand-pixel section and
  // the card shows blank. Handing that offset to CSS lets the stage
  // place itself by hand for the duration. See `.page-card.is-active`
  // in deck.css.
  const { active: menuActive, snapshotY } = useMobileMenu();

  const [active, setActive] = useState(0);

  // Layout toggle. The value goes out as `--dk-m` on the section, and the
  // CSS transition on `.deck` does the whole morph — this is the only
  // thing React knows about the two layouts.
  const [spread, setSpread] = useState(false);
  const spreadRef = useRef(false);
  spreadRef.current = spread;

  // ── arm the intro ────────────────────────────────────────────────
  // The deck rests with its animations PAUSED (deck.css), holding frame
  // 0 of the sequence: spread, camera in, swept ahead — and the stage at
  // opacity 0. That state is doing two jobs: it's the intro's first
  // frame, and it's the cover over first paint — the stylesheet
  // arriving, the images decoding. Nothing is shown until all of that
  // has already happened, so there is nothing to see shifting.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;

    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      el.dataset.ready = "1";
    };

    // Wait for the covers that will actually be on screen, not all 50 —
    // and never longer than the fallback, so a slow CDN can't hold the
    // page hostage.
    const imgs = Array.from(el.querySelectorAll("img")).slice(0, 8);
    const decoded = imgs.map((img) =>
      img.decode ? img.decode().catch(() => {}) : Promise.resolve(),
    );
    Promise.all(decoded).then(() =>
      requestAnimationFrame(() => requestAnimationFrame(go)),
    );

    const t = setTimeout(go, 1400);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const trackEl = trackRef.current;
    const stageEl = stageRef.current;
    if (!trackEl || !stageEl || count < 2) return;

    const last = count - 1;

    // Sideways on a phone, down the document everywhere else. The two
    // differ in exactly three lines — which element scrolls, which axis
    // it is measured on, and where the scroll event comes from.
    const runEl = hscroll ? innerRef.current : trackEl;
    if (!runEl) return;

    // ── cached metrics: measured on mount + resize, never in the loop ──
    //
    // The span is the stage's own size subtracted from the run's, NOT
    // `window.innerHeight`. That was the height glitch: both elements are
    // sized in svh, which is fixed, but innerHeight grows and shrinks by
    // ~60px every time the mobile URL bar hides or shows. Deriving the
    // scroll mapping from it meant a drag that nudged the URL bar
    // silently rescaled the entire deck mid-gesture.
    //
    // It is also the more correct number: a sticky stage is stuck for
    // exactly (runLength − stageLength) of scroll, so this is the real
    // range rather than an approximation of it.
    let top = 0;
    let span = 1;
    const measure = () => {
      if (hscroll) {
        top = 0;
        span = Math.max(1, runEl.offsetWidth - stageEl.offsetWidth);
      } else {
        top = trackEl.getBoundingClientRect().top + window.scrollY;
        span = Math.max(1, runEl.offsetHeight - stageEl.offsetHeight);
      }
    };

    const position = () =>
      hscroll ? trackEl.scrollLeft : window.scrollY - top;

    let written = -1;
    let shown = -1;

    // The entire per-frame cost of this component. No rAF, no lerp, no
    // animation loop: `--dk-p` carries a CSS transition (see deck.css), so
    // writing the raw scroll position is enough — the browser does the
    // easing, the overshoot and the settle.
    //
    // Runs in the event phase. It reads scroll and then writes a custom
    // property; the read happens first and the write can't invalidate it,
    // so there is no forced synchronous layout.
    const sync = () => {
      const t = position() / span;
      const p = (t < 0 ? 0 : t > 1 ? 1 : t) * last;
      if (p > written - 0.001 && p < written + 0.001) return;
      written = p;
      stageEl.style.setProperty("--dk-p", p.toFixed(3));

      // The only React state this whole interaction produces. It tracks
      // the scroll target rather than the eased value, so the counter
      // leads the deck by up to --follow. Invisible on a number that
      // takes 520ms to roll, and it saves reading style back per frame.
      const r = Math.round(p);
      if (r !== shown) {
        shown = r;
        setActive(r);
      }
    };

    // Only re-measure when the geometry genuinely changed. On a phone the
    // resize event fires constantly as the URL bar animates, and since
    // both heights are in svh nothing has actually moved — remeasuring on
    // every one of those was the second half of the jitter.
    let lastH = 0;
    let lastW = 0;
    const onResize = () => {
      const h = trackEl.offsetHeight;
      const w = window.innerWidth;
      if (h === lastH && w === lastW) return;
      lastH = h;
      lastW = w;
      measure();
      sync();
    };

    lastH = trackEl.offsetHeight;
    lastW = window.innerWidth;
    measure();
    sync();

    // The sideways scroller is the section itself; the vertical one is
    // the document.
    const scroller = hscroll ? trackEl : window;
    scroller.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", onResize);

    // ── drag ─────────────────────────────────────────────────────────
    // The old version mapped horizontal drag onto vertical scroll with a
    // made-up multiplier, which is why it felt arbitrary: the deck does
    // not run horizontally, it runs diagonally up-and-right, and dragging
    // across that axis did nothing coherent.
    //
    // Now the pointer delta is projected onto the deck's ACTUAL screen
    // axis, so grabbing a cover and pushing it moves the deck exactly as
    // far as your hand goes, in whatever direction you push. One index
    // step lands at:
    //
    //   sx = sin(yaw) · depth · w   the Z gap, projected through the yaw
    //   sy = −rise · w              the in-plane climb (rotateY spares Y)
    //
    // and a card sits at (i − p)·(sx, sy), so moving it by (dx, dy) means
    // Δp = −(dx·sx + dy·sy) / |s|². That's a plain vector projection —
    // no tuning constant, and it stays correct when the Leva panel
    // changes yaw or spacing, because the values are read back off the
    // element each time a drag starts.
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let pid = null;
    let sx = 0;
    let sy = 0;
    let len2 = 1;

    // The axis is recomputed at every pointerdown, because the deck runs
    // diagonally when stacked and horizontally when spread. The spread
    // flag is read from a ref rather than from `--dk-m`, since `--dk-m` may be
    // mid-transition and we want the destination, not the frame.
    const readAxis = () => {
      const cs = getComputedStyle(trackEl);
      const num = (n) => parseFloat(cs.getPropertyValue(n)) || 0;
      const w = num("--dk-w");
      const yaw = (num("--dk-yaw") * Math.PI) / 180;
      const shape = trackEl.dataset.shape || "fan";
      const rad = (deg) => (deg * Math.PI) / 180;

      // stacked
      const ax = Math.sin(yaw) * num("--dk-depth-k") * w;
      const ay = -num("--dk-rise-k") * w;

      // spread — on the curved shapes the run is tangential at the front
      // of the arc, i.e. arc length: radius × step in radians
      let bx;
      if (shape === "flat") bx = num("--dk-flat-k") * w;
      else if (shape === "ring") bx = num("--dk-ring-r") * rad(num("--dk-ring-step"));
      else bx = num("--dk-fan-r") * rad(num("--dk-fan-step"));

      const m = spreadRef.current ? 1 : 0;
      sx = ax + (bx - ax) * m;
      sy = ay + (0 - ay) * m;
      len2 = sx * sx + sy * sy || 1;
    };

    // ── why the residual ─────────────────────────────────────────────
    // Scroll positions are quantised — whatever float you hand a scroller
    // it stores a rounded one, so a sub-pixel delta is not a small move,
    // it is NO move, and the next delta starts over from the rounded
    // value. That is why spread mode was nearly immovable: a spread card
    // sits a full card-width from its neighbour (~420px on a laptop),
    // while one index is only ~90px of scroll, so a pixel of drag asked
    // for ~0.2px of scroll and every frame of it was rounded away. In the
    // stack the same pixel asks for ~2.5px and survives, which is why
    // only one of the two layouts felt broken.
    //
    // Keeping the remainder here and spending it once it adds up to a
    // whole pixel makes the mapping exact at any card spacing.
    let resid = 0;
    const scrollBy = (dy, touch) => {
      resid += dy;
      const step = Math.trunc(resid);
      if (!step) return;
      resid -= step;

      // A mouse on a narrow window is still a drag, and in that mode the
      // thing that scrolls is the deck, sideways — not the document.
      if (hscroll) {
        trackEl.scrollLeft += step;
        return;
      }

      // Lenis doesn't smooth touch (syncTouch/smoothTouch are both off), so
      // on touch the native scroll is the real one and driving it through
      // Lenis just adds a second writer. Go straight to the window instead.
      const l = lenisRef.current;
      if (l && !touch) l.scrollTo(l.targetScroll + step, { immediate: true });
      else window.scrollBy(0, step);
    };

    // ── touch ────────────────────────────────────────────────────────
    // A finger never reaches this handler on a phone. The deck's sideways
    // overflow IS the gesture there, and the platform scroller is simply
    // better at it than anything written here: it tracks 1:1, it carries
    // momentum, it rubber-bands at the ends, and it does all of it off
    // the main thread.
    //
    // What this handler used to do to a finger is also exactly why it
    // felt hair-triggered. It projected the swipe onto the deck's own
    // screen axis — and in the stack that axis is the SLIVER, about 26px
    // per cover on a 390px phone. Treated literally, a 200px flick is
    // seven and a half covers. Direct manipulation is the right instinct
    // for a card you can see and grab; it is the wrong instinct for a
    // 26px edge, because the thing you are dragging isn't the thing you
    // are looking at.
    //
    // Mouse and pen still get the full 2D projection — a cursor really is
    // holding the card it is over, and there is no native gesture to
    // defer to.
    let touch = false;
    let axis = 0; // 0 undecided · 1 ours · -1 the browser's
    let downX = 0;
    let downY = 0;

    const onDown = (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // the toggle lives inside the stage; a press on it isn't a scrub
      if (e.target.closest?.("[data-deck-ui]")) return;
      // the scroller has this one — see the note above
      if (hscroll && e.pointerType === "touch") return;
      dragging = true;
      touch = e.pointerType === "touch";
      axis = touch ? 0 : 1;
      downX = lastX = e.clientX;
      downY = lastY = e.clientY;
      pid = e.pointerId;
      resid = 0;
      readAxis();
      // A hand on a card is direct manipulation, and --follow is mass:
      // 460ms of it between your finger and the deck is exactly the
      // "won't move" feeling. Drop the lag for the duration of the grab
      // and put it back on release. See [data-drag] in deck.css.
      if (!touch) stageEl.dataset.drag = "1";
      // Touch pointers are implicitly captured by the spec, and taking
      // an explicit capture here is what interferes with native panning.
      if (!touch) stageEl.setPointerCapture(pid);
    };

    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      if (axis === 0) {
        const tx = e.clientX - downX;
        const ty = e.clientY - downY;
        if (tx * tx + ty * ty < 64) return; // too early to call it
        axis = Math.abs(tx) > Math.abs(ty) ? 1 : -1;
        // Only once the gesture is ours: a vertical swipe stays on the
        // scroller, and the scroller wants its mass.
        if (axis === 1) stageEl.dataset.drag = "1";
      }
      if (axis !== 1) return; // the browser is handling this one

      const dp = -(dx * sx + (touch ? 0 : dy) * sy) / len2;
      scrollBy((dp * span) / last, touch);
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      axis = 0;
      delete stageEl.dataset.drag;
      if (pid !== null && !touch && stageEl.hasPointerCapture(pid))
        stageEl.releasePointerCapture(pid);
      pid = null;
    };

    stageEl.addEventListener("pointerdown", onDown);
    stageEl.addEventListener("pointermove", onMove);
    stageEl.addEventListener("pointerup", onUp);
    stageEl.addEventListener("pointercancel", onUp);

    return () => {
      scroller.removeEventListener("scroll", sync);
      window.removeEventListener("resize", onResize);
      stageEl.removeEventListener("pointerdown", onDown);
      stageEl.removeEventListener("pointermove", onMove);
      stageEl.removeEventListener("pointerup", onUp);
      stageEl.removeEventListener("pointercancel", onUp);
      delete stageEl.dataset.drag;
    };
  }, [count, hscroll]);

  // Memoised against `cards` alone. The readout's state changes can't
  // reach these 50 elements — React gets identical element objects back
  // and bails out of the subtree.
  //
  // `position: absolute` is inline rather than left to the stylesheet on
  // purpose: it ships with the HTML. If the CSS is even one tick late,
  // 50 square images would otherwise lay out in normal flow and give the
  // document a ~15,000px height before collapsing back.
  const rail = useMemo(
    () => (
      <div className="deck__rail" style={{ position: "absolute", inset: 0 }}>
        {cards.map((c, i) =>
          c.image ? (
            // Plain <img>, not next/image: these are fixed-size square
            // thumbnails already served at the right size by Spotify's
            // CDN, so the optimizer would only add a hop.
            <img
              key={c.id ?? i}
              className="deck__card"
              style={{ "--dk-i": i, position: "absolute" }}
              src={c.image}
              alt=""
              width={300}
              height={300}
              draggable={false}
              decoding="async"
              loading={i < 24 ? "eager" : "lazy"}
              fetchPriority={i < 6 ? "high" : "auto"}
            />
          ) : (
            <div
              key={c.id ?? i}
              className="deck__card"
              style={{ "--dk-i": i, position: "absolute", background: c.gradient }}
            />
          ),
        )}
      </div>
    ),
    [cards],
  );

  return (
    <>
      {/* React 19 hoists this into <head> — the covers come off Spotify's
          CDN, so open the connection before the first <img> asks for it. */}
      <link rel="preconnect" href="https://i.scdn.co" crossOrigin="" />
      {/* Without JS nothing ever sets data-ready, and the paused intro
          would hold every card at opacity 0. Drop the intro instead. */}
      <noscript>
        <style>{`.deck,.deck__stage,.deck__card{animation:none}`}</style>
      </noscript>

      <section
        ref={trackRef}
        className="deck bg-surface"
        data-spread={spread ? "1" : "0"}
        style={{
          "--count": count,
          "--dk-m": spread ? 1 : 0,
          "--snap": menuActive ? `${snapshotY}px` : "0px",
        }}
      >
        {/* The sideways run's length. `display: contents` everywhere but
            the phone, so on desktop it has no box and the stage sticks to
            `.deck` exactly as it did before this element existed. */}
        <div ref={innerRef} className="deck__track">
          <div ref={stageRef} className="deck__stage">
            {rail}

            <div className="deck__count">
              <SlotNumber
                value={`${String(active + 1).padStart(2, "0")} / ${count}`}
              />
            </div>

            <div className="deck__ui" data-deck-ui>
              <button
                type="button"
                className="btn btn--raised"
                aria-pressed={spread}
                onClick={() => setSpread((s) => !s)}
              >
                {spread ? "Stack" : "Spread"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* The panel is wider than a phone and covers the thing it tunes,
          so it only mounts where there's room for it. */}
      {DEV && wide ? <DeckControls target={trackRef} /> : null}
    </>
  );
}
