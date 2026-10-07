"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import SlotNumber from "@/app/ui/SlotNumber";
import "./deck.css";

/* ───────────────────────────────────────────────────────────────────
 * Deck — the JS half of the interaction, and it is deliberately small.
 *
 * Everything geometric (place in the stack, the slide-out, the climb)
 * is computed in CSS from a single inherited custom property, `--dk-p`.
 * This file's only job is to keep `--dk-p` in step with scroll — the
 * deck's OWN scroll, on an element inside the box it was given. It never
 * scrolls the document, so it can sit anywhere, any size, any number of
 * times on one page:
 *
 *   • one `style.setProperty` per frame, on ONE element
 *   • no `getBoundingClientRect` in the hot path — track metrics are
 *     cached and only re-read when the box resizes
 *   • reads (scroll events) and writes (rAF) live in different phases
 *     of the frame, so there is never a forced synchronous layout
 *   • the rAF loop parks itself when the value settles
 *
 * React renders NOTHING while the deck moves. The readout is handed to
 * SlotNumber through its ref, which writes one custom property per digit
 * column that changed, so a scrub from end to end costs zero renders in
 * this component and zero in the counter. The card list is memoised
 * against `cards` alone, so the renders that do happen — the layout
 * toggle, the box-size resolve — never touch the 50 <img> elements.
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
      // What sampleEdges() works out from a real cover, known up front
      // for a made-up one: the colour running down the board's edge.
      edge: `linear-gradient(${a} 10%, ${b} 50%, ${c} 90%)`,
    };
  });
}

/* ── the edge colour ───────────────────────────────────────────────
 * The board's edge is lit and shaded in CSS, but its COLOUR has to come
 * from the record, and that is the one thing a stylesheet cannot work
 * out for itself.
 *
 * Every attempt to make CSS do it failed the same way. A background is
 * either a piece of the artwork (detail, and at six projected pixels
 * detail is noise), or the artwork resized to fit (a distorted album
 * cover, which reads as a mistake), or a small piece tiled (a repeat,
 * which reads as broken). There is no fourth option, because a
 * background can only ever paint the image it was given.
 *
 * So the image is read instead of painted. Each cover goes through a
 * 1 × SAMPLES canvas, which asks the browser to average it down to a
 * single column of five pixels — five horizontal bands of the record,
 * each one the mean of everything across it. Those five become the
 * stops of a vertical gradient, and THAT is what the edges paint.
 *
 * The result has no detail to be noisy, no scaling to distort, and no
 * tile to repeat, while still being, quite literally, the colours of the
 * cover in the order they appear down it. It is also cheaper at render
 * time than any of the versions it replaces: a gradient, evaluated once.
 *
 * It costs nothing at the network either. i.scdn.co answers with
 * `access-control-allow-origin: *`, so `crossOrigin` makes the canvas
 * readable without a second request — and if that ever stops being true,
 * onCoverError below quietly refetches without it and the edges fall
 * back to plain board.
 * ─────────────────────────────────────────────────────────────────── */

const SAMPLES = 5;

/* ── putting the colour back ───────────────────────────────────────
 * An average is a walk toward grey — that is what averaging IS — so a
 * band read off a whole row of artwork always comes back duller than the
 * record looks. A sleeve that reads as deep red averages to a dusty
 * pink, and five dusty bands make an edge that looks washed out even
 * though every value in it is technically correct.
 *
 * So the saturation lost in the mean is put back afterwards, with the
 * standard luminance-preserving matrix — the same one `filter:
 * saturate()` applies. Hold the band's brightness, push its channels
 * away from it.
 *
 * Deliberately NOT done as a CSS filter on the faces, which would have
 * been tempting since the sheen and the board are greys and a saturate()
 * would leave them alone. A filter is a grouping property: putting one
 * on an element inside a preserve-3d context asks the browser to render
 * it to an intermediate image and composite that back in as a plane.
 * That is a lot of rope, on a hundred faces, for something a multiply
 * does once before the first frame.
 * ─────────────────────────────────────────────────────────────────── */
const SATURATION = 1.65;

function vivid(r, g, b) {
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const up = (c) =>
    Math.max(0, Math.min(255, Math.round(l + (c - l) * SATURATION)));
  return `${up(r)} ${up(g)} ${up(b)}`;
}

// One cover failed to load as a CORS request. The likeliest cause by far
// is the CDN dropping its ACAO header, and the artwork matters more than
// the edge colour does — so drop the attribute and fetch it again the
// ordinary way. The stylesheet's board fallback covers the rest.
function onCoverError(e) {
  const img = e.currentTarget;
  if (!img.crossOrigin) return;
  img.crossOrigin = null;
  img.src = img.src;
}

function uniqueByArtwork(tracks) {
  const seen = new Set();
  return tracks.filter((track) => {
    if (!track.image) return true;
    if (seen.has(track.image)) return false;
    seen.add(track.image);
    return true;
  });
}

// The size of the box the deck was handed, and nothing else. A phone and a
// 440px tile on the experiments index are the same case: there is no
// window in here, only the box. (deck.css makes the same call with
// `@container`, against the same element.)
const SMALL = 640;
const EMBEDDED_CAP = 12; // covers in a narrow tile on someone else's page
const WIDE = 900;
const TAP_SLOP_PX = 6;
const LOCK_RETRY_MS = 1500;
const INERTIA_TAU_MS = 240;
const INERTIA_STOP = 0.015;
const RELEASE_WINDOW_MS = 90;

export default function Deck({ tracks, embedded = false }) {
  const all = useMemo(
    () => (tracks?.length ? uniqueByArtwork(tracks) : fallbackDeck(24)),
    [tracks],
  );

  // ── phone budget ─────────────────────────────────────────────────
  // Every card recomputes its transform when `--dk-p` changes, so the cost
  // of a frame is linear in how many are mounted — and a phone has an
  // order of magnitude less of everything to spend on it. Well past the
  // first ~20 the covers are a few px of sliver anyway, so in a small
  // box the tail is simply not built. Resolved after mount so SSR
  // markup stays identical for every client.
  const [cap, setCap] = useState(0);
  const [wide, setWide] = useState(false);

  // ── which way the deck runs ──────────────────────────────────────
  // In a narrow box — a phone, a small tile — it is a HORIZONTAL
  // scroller: the deck runs on its own sideways overflow. That buys two
  // things at once, neither of which is hand-written —
  //
  //   • the gesture is native, so it has real momentum, friction and
  //     rubber-banding. Nothing tracks a finger better than the
  //     platform's own scroller.
  //   • sideways is the direction the deck actually runs, so the swipe
  //     and the artwork agree.
  //
  // (Either way the document never scrolls — the deck scrolls itself.)
  // See the @container block in deck.css for the other half.
  //
  // Not when embedded. A tile on a page that scrolls vertically is
  // swiped vertically, so there the deck stays a vertical scroller and
  // CHAINS: a swipe runs through the covers, and at either end the same
  // swipe carries on into the page. Twelve covers rather than twenty-two,
  // so getting past the tile is a few flicks, not a chore.
  const [hscroll, setHscroll] = useState(false);

  const trackRef = useRef(null);

  // Read off the box, not the window: the same breakpoints deck.css
  // resolves with `@container`, so the JS mode and the CSS layout can
  // never disagree about which one this is.
  useEffect(() => {
    const el = trackRef.current;
    const box = el?.closest(".piece-box") ?? el?.parentElement;
    if (!box) return;
    const read = () => {
      const w = box.clientWidth;
      const small = w <= SMALL;
      setCap(small ? (embedded ? EMBEDDED_CAP : 22) : 0);
      setHscroll(small && !embedded);
      setWide(w >= WIDE);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(box);
    return () => ro.disconnect();
  }, [embedded]);

  const cards = useMemo(() => (cap ? all.slice(0, cap) : all), [all, cap]);
  const count = cards.length;

  // The run: as long as the deck's scroll, on whichever axis it runs.
  // `.deck` is the scrollport, this is what overflows it.
  const innerRef = useRef(null);
  const stageRef = useRef(null);

  const countRef = useRef(null);

  // Layout toggle. The value goes out as `--dk-m` on the section, and the
  // CSS transition on `.deck` does the whole morph — this is the only
  // thing React knows about the two layouts.
  const [spread, setSpread] = useState(false);
  const spreadRef = useRef(false);
  spreadRef.current = spread;
  const embeddedRef = useRef(embedded);
  embeddedRef.current = embedded;

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

  // On its own page the deck is the page, so the keys go to it from the
  // first press, as they did when it scrolled the document. In a box on
  // someone else's page it waits to be clicked or tabbed to.
  useEffect(() => {
    if (!embedded) trackRef.current?.focus({ preventScroll: true });
  }, [embedded]);

  // ── read each cover down to five colours ─────────────────────────
  // See the note above SAMPLES. This runs once per cover, off the back
  // of the load it was going to do anyway, and writes one custom
  // property on that card's frame — no React state, so none of this
  // reaches the render path. A card whose cover hasn't loaded yet simply
  // keeps the board fallback until it does.
  useEffect(() => {
    const root = trackRef.current;
    if (!root) return;

    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = SAMPLES;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";

    const off = [];

    const read = (img) => {
      const frame = img.parentElement;
      if (!frame || !img.naturalWidth) return;
      try {
        // Drawing 300px of cover into one pixel of width is the whole
        // averaging step — the browser's own downscale filter does it,
        // and it does it on five bands at once.
        ctx.clearRect(0, 0, 1, SAMPLES);
        ctx.drawImage(img, 0, 0, 1, SAMPLES);
        const { data } = ctx.getImageData(0, 0, 1, SAMPLES);

        // Stops land at each band's CENTRE, not its edge, so the ramp
        // reads as the colours easing through one another rather than as
        // five stripes with seams between them.
        let stops = "";
        for (let i = 0; i < SAMPLES; i++) {
          const o = i * 4;
          const at = (((i + 0.5) / SAMPLES) * 100).toFixed(1);
          const c = vivid(data[o], data[o + 1], data[o + 2]);
          stops += `${i ? "," : ""}rgb(${c}) ${at}%`;
        }
        frame.style.setProperty("--dk-edge", `linear-gradient(${stops})`);
      } catch {
        // A tainted canvas — the CDN stopped answering CORS. Nothing to
        // do: the stylesheet's board fallback is already correct.
      }
    };

    // Never read straight off the load event. drawImage on a
    // freshly-loaded img forces a synchronous JPEG decode, and lazy
    // covers land in network bursts — several decodes coalescing into
    // one task is a ~100ms stall in the middle of a drag. decode()
    // moves the decode off-thread, and the queue spends one read per
    // frame, so fifty covers cost fifty frames spread flat instead of
    // a hitch.
    const queue = [];
    let rafId = 0;
    const drain = () => {
      rafId = 0;
      const img = queue.shift();
      if (img) read(img);
      if (queue.length) rafId = requestAnimationFrame(drain);
    };
    const enqueue = (img) => {
      const push = () => {
        queue.push(img);
        if (!rafId) rafId = requestAnimationFrame(drain);
      };
      if (img.decode) img.decode().then(push, push);
      else push();
    };

    for (const img of root.querySelectorAll("img")) {
      if (img.complete) enqueue(img);
      else {
        const on = () => enqueue(img);
        img.addEventListener("load", on, { once: true });
        off.push(() => img.removeEventListener("load", on));
      }
    }

    return () => {
      off.forEach((fn) => fn());
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [cards]);

  useEffect(() => {
    const trackEl = trackRef.current;
    const stageEl = stageRef.current;
    if (!trackEl || !stageEl || count < 2) return;

    const last = count - 1;

    // Sideways in a narrow box, downwards everywhere else. `.deck` is the
    // scroller either way; the two differ only in which axis the run
    // overflows it on.
    const runEl = innerRef.current;
    if (!runEl) return;

    // ── cached metrics: measured on mount + resize, never in the loop ──
    //
    // The span is the stage's own size subtracted from the run's, not a
    // separately-read box size. Both are sized off the same container, so
    // the mapping can't drift out from under a gesture — and it is the
    // more correct number anyway: a sticky stage is stuck for exactly
    // (runLength − stageLength) of scroll, so this is the real range
    // rather than an approximation of it.
    let span = 1;
    const measure = () => {
      span = hscroll
        ? Math.max(1, runEl.offsetWidth - stageEl.offsetWidth)
        : Math.max(1, runEl.offsetHeight - stageEl.offsetHeight);
    };

    const position = () => (hscroll ? trackEl.scrollLeft : trackEl.scrollTop);

    let written = -1;
    let shown = -1;

    // The entire per-frame cost of this component. No lerp, no animation
    // loop: `--dk-p` carries a CSS transition (see deck.css), so writing
    // the raw scroll position is enough — the browser does the easing,
    // the overshoot and the settle.
    //
    // "Read first, then write" only protects a single event. Across
    // events it inverts: the write dirties style for fifty transformed
    // cards, and the NEXT event's scroll read pays a forced reflow of
    // all of them — and a drag drives several scrollTo events per frame,
    // which is a couple hundred milliseconds of pure layout in one task.
    // So scroll events only REQUEST a sync, and the read+write pair runs
    // once per frame in rAF. The transition's follow lag is two orders
    // of magnitude longer than the frame this defers by.
    const sync = () => {
      const t = position() / span;
      const p = (t < 0 ? 0 : t > 1 ? 1 : t) * last;
      if (p > written - 0.001 && p < written + 0.001) return;
      written = p;
      stageEl.style.setProperty("--dk-p", p.toFixed(3));

      // The readout is written straight into the odometer, so a scrub
      // renders nothing at all. It tracks the scroll target rather than the
      // eased value, so the counter leads the deck by up to --follow.
      // Invisible on a number that takes 520ms to roll, and it saves
      // reading style back per frame.
      const r = Math.round(p);
      if (r !== shown) {
        shown = r;
        countRef.current?.setValue(
          `${String(r + 1).padStart(2, "0")} / ${count}`,
        );
      }
    };

    // Re-measure only when the geometry genuinely changed: the scrollport
    // or the run resized. A ResizeObserver reports exactly that and
    // nothing else, so the URL bar animating on a phone — which used to
    // fire `resize` constantly while nothing in the deck moved — never
    // reaches it.
    const onResize = () => {
      measure();
      sync();
    };

    measure();
    sync();

    let syncRaf = 0;
    const requestSync = () => {
      if (syncRaf) return;
      syncRaf = requestAnimationFrame(() => {
        syncRaf = 0;
        sync();
      });
    };

    trackEl.addEventListener("scroll", requestSync, { passive: true });
    const ro = new ResizeObserver(onResize);
    ro.observe(trackEl);
    ro.observe(runEl);

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
    let lockBlockedUntil = 0;
    let travelled = 0;
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
    const scrollBy = (dy) => {
      resid += dy;
      const step = Math.trunc(resid);
      if (!step) return;
      resid -= step;

      // A hand is direct manipulation, so this is written straight in —
      // no smoothing between the pointer and the scroller.
      if (hscroll) trackEl.scrollLeft += step;
      else trackEl.scrollTop += step;
    };

    let velocity = 0;
    let inertiaFrame = 0;
    const stopInertia = () => {
      cancelAnimationFrame(inertiaFrame);
      inertiaFrame = 0;
      velocity = 0;
    };
    const startInertia = (initial) => {
      cancelAnimationFrame(inertiaFrame);
      velocity = initial;
      stageEl.dataset.drag = "1";
      let previous = performance.now();
      const step = (now) => {
        const dt = Math.min(48, now - previous);
        previous = now;
        velocity *= Math.exp(-dt / INERTIA_TAU_MS);
        scrollBy(velocity * dt);
        if (Math.abs(velocity) < INERTIA_STOP) {
          inertiaFrame = 0;
          velocity = 0;
          delete stageEl.dataset.drag;
          return;
        }
        inertiaFrame = requestAnimationFrame(step);
      };
      inertiaFrame = requestAnimationFrame(step);
    };
    let releaseSamples = [];

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

    const requestLock = () => {
      if (performance.now() < lockBlockedUntil) return;
      const ask = (options) => stageEl.requestPointerLock?.(options);
      Promise.resolve(ask({ unadjustedMovement: true }))
        .catch((error) => (error?.name === "NotSupportedError" ? ask() : Promise.reject(error)))
        .catch(() => {
          lockBlockedUntil = performance.now() + LOCK_RETRY_MS;
        });
    };

    const onDown = (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // the toggle lives inside the stage; a press on it isn't a scrub
      if (e.target.closest?.("[data-deck-ui]")) return;
      // the scroller has this one — see the note above
      if (hscroll && e.pointerType === "touch") return;
      stopInertia();
      releaseSamples = [];
      dragging = true;
      touch = e.pointerType === "touch";
      axis = touch ? 0 : 1;
      downX = lastX = e.clientX;
      downY = lastY = e.clientY;
      travelled = 0;
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
      if (embeddedRef.current && !touch) requestLock();
    };

    const onMove = (e) => {
      if (!dragging) return;
      const pinned = document.pointerLockElement === stageEl;
      const dx = pinned ? e.movementX : e.clientX - lastX;
      const dy = pinned ? e.movementY : e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      travelled += Math.abs(dx) + Math.abs(dy);

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
      const amount = (dp * span) / last;
      scrollBy(amount);
      releaseSamples.push({ at: e.timeStamp, amount });
      while (releaseSamples.length && e.timeStamp - releaseSamples[0].at > RELEASE_WINDOW_MS)
        releaseSamples.shift();
    };

    const onUp = (e) => {
      if (!dragging) return;
      dragging = false;
      if (document.pointerLockElement === stageEl) document.exitPointerLock();
      if (embeddedRef.current && travelled < TAP_SLOP_PX) {
        setSpread((current) => !current);
      }
      const wasOurs = axis === 1;
      axis = 0;
      let release = 0;
      if (wasOurs && releaseSamples.length > 1) {
        const first = releaseSamples[0].at;
        const lastAt = releaseSamples[releaseSamples.length - 1].at;
        if (e.timeStamp - lastAt < RELEASE_WINDOW_MS) {
          const travelled = releaseSamples.reduce((sum, sample) => sum + sample.amount, 0);
          release = travelled / Math.max(16, lastAt - first);
        }
      }
      if (Math.abs(release) > INERTIA_STOP * 4) startInertia(release);
      else delete stageEl.dataset.drag;
      if (pid !== null && !touch && stageEl.hasPointerCapture(pid))
        stageEl.releasePointerCapture(pid);
      pid = null;
    };

    // ── the cross wheel ──────────────────────────────────────────────
    // The deck's scroller runs on ONE axis — down in a roomy box, sideways
    // in a narrow one — and a wheel on that axis is simply native scroll:
    // momentum, smoothing and all, from the platform, on `.deck` itself.
    //
    // The other axis is the one nothing would consume. Running down, a
    // trackpad's two-finger swipe and a mouse's tilt wheel arrive as
    // deltaX; sideways, a plain mouse wheel arrives as deltaY and would
    // otherwise fall through to the page around the box. Either way the
    // deck claims it and spends it on its own scroller.
    //
    // The first attempt at this ran deltaX through the DRAG projection —
    // a pixel of swipe moving the deck a pixel along its own screen axis
    // — and it felt wrong next to the native scroll, for two reasons
    // that are worth separating:
    //
    //   • WEIGHT. Native wheel scroll is smoothed, so a notch eases in
    //     and settles. The projected version wrote the scroller directly,
    //     which is the one thing that reads as different no matter how
    //     the number is scaled.
    //   • RATE. Direct manipulation is the right model for a hand that
    //     is holding a card and the wrong one for a wheel, which is a
    //     rate input aimed at nothing in particular. The projection also
    //     made sensitivity depend on the layout: one card is ~420px of
    //     travel spread and ~35px stacked, so the same flick moved the
    //     deck twelve times as far in one mode as the other.
    //
    // So the wheel knows nothing about the deck's geometry. One pixel of
    // cross-axis delta is one pixel of the deck's own scroll, handed over
    // as a smooth scroll — the same amount of deck, eased the same way,
    // as a pixel on the native axis.
    //
    // A wheel reporting LINES rather than pixels (mode 1, some Windows
    // mice) is worth 100/6 px per line, and PAGES (mode 2) one scrollport.
    const LINE = 100 / 6;

    const onWheel = (e) => {
      // The native axis is already handled — and handled well. The deck
      // only claims the axis nothing else was using. A shift-wheel
      // arrives as deltaX on some browsers and deltaY on others; the
      // dominance test covers both without having to care which.
      const across = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (across !== !hscroll) return;

      const raw = hscroll ? e.deltaY : e.deltaX;
      const page = hscroll ? trackEl.clientWidth : trackEl.clientHeight;
      const unit = e.deltaMode === 1 ? LINE : e.deltaMode === 2 ? page : 1;

      e.preventDefault();

      const distance = raw * unit;
      const notched = e.deltaMode !== 0 || (Number.isInteger(raw) && Math.abs(raw) >= 50);
      if (notched) {
        startInertia(velocity + distance / INERTIA_TAU_MS);
      } else {
        stopInertia();
        scrollBy(distance);
      }
    };

    const onLockChange = () => {
      if (document.pointerLockElement === stageEl && !dragging) document.exitPointerLock();
    };
    document.addEventListener("pointerlockchange", onLockChange);
    stageEl.addEventListener("wheel", onWheel, { passive: false });

    stageEl.addEventListener("pointerdown", onDown);
    stageEl.addEventListener("pointermove", onMove);
    stageEl.addEventListener("pointerup", onUp);
    stageEl.addEventListener("pointercancel", onUp);

    return () => {
      trackEl.removeEventListener("scroll", requestSync);
      stopInertia();
      if (syncRaf) cancelAnimationFrame(syncRaf);
      ro.disconnect();
      document.removeEventListener("pointerlockchange", onLockChange);
      if (document.pointerLockElement === stageEl) document.exitPointerLock();
      stageEl.removeEventListener("wheel", onWheel);
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
  // 50 square frames would otherwise lay out in normal flow and give the
  // deck a ~15,000px scroll before collapsing back.
  //
  // The frame is the card's whole DOM contribution beyond the artwork:
  // the two printed edges are its ::before / ::after, so a card is one
  // wrapper and one image, and the edges cost no elements and no JS.
  // See the CARDS block in deck.css for the geometry.
  //
  // Nothing here names the cover twice. The edges take their colour from
  // `--dk-edge`, which is five sampled colours rather than a url, so the
  // artwork is referenced exactly once — by the <img> — and `loading`
  // means what it says again.
  //
  // A made-up card knows its own --dk-edge up front; a real one is left
  // to the sampler above and shows plain board until its cover lands.
  const rail = useMemo(
    () => (
      <div className="deck__rail" style={{ position: "absolute", inset: 0 }}>
        {cards.map((c, i) => (
          <div
            key={c.id ?? i}
            className="deck__card"
            style={{
              "--dk-i": i,
              ...(c.image ? null : { "--dk-art": c.gradient }),
              ...(c.edge ? { "--dk-edge": c.edge } : null),
              position: "absolute",
            }}
          >
            {c.image ? (
              // Plain <img>, not next/image: these are fixed-size square
              // thumbnails already served at the right size by Spotify's
              // CDN, so the optimizer would only add a hop.
              //
              // crossOrigin is what makes the canvas above readable. It
              // is not an extra request — it is the SAME request, asked
              // for in CORS mode, which i.scdn.co allows outright.
              <img
                className="deck__art"
                src={c.image}
                alt=""
                width={300}
                height={300}
                crossOrigin="anonymous"
                onError={onCoverError}
                draggable={false}
                decoding="async"
                loading={i < 24 ? "eager" : "lazy"}
                fetchPriority={i < 6 ? "high" : "auto"}
              />
            ) : (
              // No src to give an <img>, so the gradient card paints its
              // face off --dk-art on the frame.
              <div className="deck__art" />
            )}
          </div>
        ))}
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

      {/* The deck's own scroller — it is focusable so the arrow
          keys, space and page keys run the stack the way they would a
          page. */}
      <section
        ref={trackRef}
        className="deck bg-surface"
        data-spread={spread ? "1" : "0"}
        data-scroll-contain={embedded ? undefined : ""}
        data-embedded={embedded ? "" : undefined}
        data-plate={embedded ? "" : undefined}
        data-plate-drag={embedded ? "" : undefined}
        data-plate-hint={embedded ? (spread ? "Click to stack" : "Click to spread") : undefined}
        onKeyDown={
          embedded
            ? (event) => {
                if (event.key === "Enter") setSpread((current) => !current);
              }
            : undefined
        }
        tabIndex={0}
        aria-label="Recently played covers"
        style={{
          "--count": count,
          "--dk-m": spread ? 1 : 0,
        }}
      >
        {/* The run: taller than the box (or wider, when narrow) by the
            whole deck's travel. The stage sticks inside it. */}
        <div ref={innerRef} className="deck__track">
          <div ref={stageRef} className="deck__stage">
            {rail}

            <div className="deck__count">
              <SlotNumber ref={countRef} value={`01 / ${count}`} />
            </div>

            {embedded ? null : (
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
            )}
          </div>
        </div>
      </section>

      {/* The panel is wider than a phone and covers the thing it tunes,
          so it only mounts where there's room for it — and never in a
          box on someone else's page. */}
      {DEV && wide && !embedded ? <DeckControls target={trackRef} /> : null}
    </>
  );
}
