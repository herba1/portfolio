"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "./MorphText.css";

/* ═══════════════════════════════════════════════════════════════════════════
 * MorphText — text that reshapes instead of crossfading.
 *
 *   <MorphText text={title} />
 *
 * Give it a new string and the letters the two strings share keep their place
 * in the word and SLIDE to where they now belong; everything else fades out or
 * in around them. "Heartless Kanye" → "Gold Digger Kanye" carries "Kanye"
 * across intact rather than dissolving the whole line and redrawing it.
 *
 *
 * ── PROPS ──────────────────────────────────────────────────────────────────
 *
 *   text          string    The string to display. Coerced, so numbers are
 *                           fine. Changing it starts a morph.
 *
 *   as            elem      Element to render. Default "span". The base class
 *                           sets `display: inline-block`; override in CSS if
 *                           you pass a block tag.
 *
 *   maxSlideEm    number    How far a shared letter may travel before we would
 *                           rather fade it out and fade a new one in, in ems of
 *                           the rendered font size. Default 8.
 *                             0        never slide — a per-letter crossfade
 *                             8        letters stay put-ish (the default)
 *                             Infinity always slide, however far
 *                           This is the main taste knob. Lower it if stray
 *                           letters fly further across the line than reads well.
 *
 *   animateOnMount bool     Animate the first string in, letter by letter.
 *                           Default false — the first paint is just text, on
 *                           the assumption a parent owns the entrance.
 *
 *   onWidth       fn(px)    Called with the string's measured width whenever it
 *                           changes, during the layout phase — so a parent can
 *                           sync its own width in the SAME frame. See the
 *                           layout contract below. Identity may change freely;
 *                           it is read through a ref.
 *
 *   label         string    Overrides the text announced to screen readers.
 *                           Defaults to `text`. (Same convention as SlotNumber.)
 *
 * Anything else — className, style, id, data-*, aria-* — lands on the host.
 *
 *
 * ── CSS API ────────────────────────────────────────────────────────────────
 *
 * All timing and feel is CSS custom properties on the host, so tuning never
 * touches JS. Set them in a stylesheet, on a wrapper, or inline:
 *
 *   .my-title {
 *     --morph-slide: 400ms;
 *     --morph-cap: 6;
 *   }
 *
 *   --morph-slide    520ms   a shared letter travelling to its new x
 *   --morph-in       340ms   a new letter arriving
 *   --morph-out      180ms   a dropped letter leaving
 *   --morph-lead     120ms   head start the exits get before the entries land
 *   --morph-step       8ms   per-letter stagger on the slide
 *   --morph-step-in   14ms   per-letter stagger on the entry
 *   --morph-cap         12   stagger stops accumulating past this many letters
 *   --morph-ease             curve for slides and entries
 *   --morph-ease-out         curve for exits
 *   --morph-blur       4px   blur depth on the fade in / out
 *
 * These are the real contract: JS READS them back off the element to know when
 * the animation is over, so a longer --morph-slide genuinely runs longer rather
 * than being cut off by a stale constant baked into this file.
 *
 * `prefers-reduced-motion: reduce` collapses everything to a plain 120ms
 * crossfade with no travel. Handled in MorphText.css; nothing to pass.
 *
 *
 * ── LAYOUT CONTRACT ────────────────────────────────────────────────────────
 *
 * Every glyph is absolutely positioned, so the host has no intrinsic width —
 * it is given an explicit px width from the measurement, and that width eases
 * with `--morph-slide` (see MorphText.css).
 *
 * That matters if you CENTRE it. A centred child whose width snaps while the
 * parent's width eases will slide sideways by half the difference on the first
 * frame. Two ways out:
 *
 *   1. Let the parent size itself from `onWidth` and give it a width
 *      transition with the SAME duration and curve as `--morph-slide`. The two
 *      widths then move in lockstep and the recentring cancels exactly. This is
 *      what .cv-focus-title does in covers.css.
 *   2. Left-align it and don't set a width on the parent at all.
 *
 * Also: give the container `overflow: clip` if its width can shrink below the
 * text. Letters are placed from the left edge, so a shrinking box leaves
 * outgoing glyphs hanging past its flank.
 *
 *
 * ── ACCESSIBILITY ──────────────────────────────────────────────────────────
 *
 * The glyph layer is `aria-hidden`; a visually-hidden span carries the real
 * string. Screen readers get plain text and never see the split. There is no
 * live region — for something that changes on scroll or hover you do not want
 * one. Add `aria-live` on a wrapper yourself if a given usage warrants it.
 *
 *
 * ── PERFORMANCE ────────────────────────────────────────────────────────────
 *
 * JS runs three times per change, then stops. Nothing runs per frame.
 *
 *   1. Match old string → new string (LCS, monotone — slides never cross).
 *   2. Look up x positions. ONE hidden measurement per UNIQUE string, cached
 *      for the life of the component. A fixed set of strings measures itself
 *      once and never again.
 *   3. Write `--x` on each glyph.
 *
 * The browser does the rest: `transform` transitions on the compositor. No
 * rAF, no animation loop, no layout while anything is moving.
 *
 * Two invariants hold that up, and both are easy to break by accident:
 *
 *   • Matched letters carry their `id` across renders, so React reuses the DOM
 *     node and the transition fires for free. Change the key scheme and every
 *     letter remounts — no slide, just a flash.
 *   • New nodes are only ever APPENDED, never reordered. Reordering children
 *     detaches and re-inserts them, which cancels a running transition
 *     mid-slide. Visual order comes from `--x`, not DOM order, so there is
 *     never a reason to sort this list.
 *
 * ═══════════════════════════════════════════════════════════════════════════ */

// Fallbacks, used only until the element can be read. The live values come off
// the host's computed style — MorphText.css is the source of truth.
const FALLBACK = {
  slide: 520,
  in: 340,
  out: 180,
  lead: 120,
  step: 8,
  stepIn: 14,
  cap: 12,
  fontSize: 16,
};

const MAX_DIFF = 96; // past this a plain crossfade is cheaper and reads the same
const SETTLE_PAD = 60; // slack so we never cut an animation off at its last frame
const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;
const isSpace = (c) => c === " " || c === "\u00a0" || c === "\t" || c === "\n";

function MorphText({
  text = "",
  as: Tag = "span",
  maxSlideEm = 8,
  animateOnMount = false,
  onWidth,
  label,
  className = "",
  style,
  ...rest
}) {
  const str = typeof text === "string" ? text : String(text ?? "");

  const hostRef = useRef(null);
  const mirrorRef = useRef(null);
  const cacheRef = useRef(new Map()); // string -> { xs, width }
  const uidRef = useRef(0);
  const timerRef = useRef(0);
  const widthRef = useRef(-1);

  // the render model, mirrored in a ref so the layout effect can diff against
  // what is actually on screen without re-subscribing
  const [view, setView] = useState(() => ({
    text: null,
    items: [],
    width: 0,
    laid: false,
    busy: false,
  }));
  const viewRef = useRef(view);
  viewRef.current = view;

  const onWidthRef = useRef(onWidth);
  onWidthRef.current = onWidth;

  // ── measurement ────────────────────────────────────────────────────────
  // One hidden pass per unique string. The mirror lives inside the host, so it
  // inherits the real font without a single style being copied across.
  const measure = useCallback((s) => {
    const cache = cacheRef.current;
    const hit = cache.get(s);
    if (hit) return hit;

    const mirror = mirrorRef.current;
    const chars = Array.from(s);
    if (!mirror || !chars.length) {
      const empty = { xs: [], width: 0 };
      cache.set(s, empty);
      return empty;
    }

    mirror.replaceChildren(
      ...chars.map((ch) => {
        const el = document.createElement("span");
        el.className = "morph-m";
        el.textContent = ch;
        return el;
      }),
    );
    const kids = mirror.children;
    const xs = new Array(chars.length);
    for (let i = 0; i < chars.length; i++) xs[i] = kids[i].offsetLeft;
    const width = mirror.offsetWidth;
    mirror.replaceChildren();

    const out = { xs, width };
    cache.set(s, out);
    return out;
  }, []);

  // ── read the schedule back off the CSS ─────────────────────────────────
  // So that retuning --morph-* actually retunes the component instead of
  // desyncing it from a constant hardcoded here. Cheap: these all resolve at
  // style time, so nothing below forces a layout.
  const timing = useCallback(() => {
    const host = hostRef.current;
    if (!host) return FALLBACK;
    const cs = getComputedStyle(host);
    const time = (name, fallback) => {
      const v = cs.getPropertyValue(name).trim();
      if (!v) return fallback;
      const n = parseFloat(v);
      if (!Number.isFinite(n)) return fallback;
      return v.endsWith("ms") ? n : v.endsWith("s") ? n * 1000 : n;
    };
    const num = (name, fallback) => {
      const n = parseFloat(cs.getPropertyValue(name));
      return Number.isFinite(n) ? n : fallback;
    };
    return {
      slide: time("--morph-slide", FALLBACK.slide),
      in: time("--morph-in", FALLBACK.in),
      out: time("--morph-out", FALLBACK.out),
      lead: time("--morph-lead", FALLBACK.lead),
      step: time("--morph-step", FALLBACK.step),
      stepIn: time("--morph-step-in", FALLBACK.stepIn),
      cap: num("--morph-cap", FALLBACK.cap),
      fontSize: parseFloat(cs.fontSize) || FALLBACK.fontSize,
    };
  }, []);

  // ── build the next frame of the model ──────────────────────────────────
  const build = useCallback(
    (next, { animate = true } = {}) => {
      const { xs, width } = measure(next);
      const t = timing();
      const prev = viewRef.current;
      const chars = Array.from(next);

      // letters currently on screen and not already leaving
      const live = [];
      for (const it of prev.items) if (it.state !== "out") live.push(it);

      // whitespace is never rendered (nothing to see) and never matched — it
      // only exists in the measurement, where it does its job as advance width.
      const A = [];
      for (let k = 0; k < live.length; k++) A.push({ ch: live[k].ch, k });
      const B = [];
      for (let j = 0; j < chars.length; j++) if (!isSpace(chars[j])) B.push({ ch: chars[j], j });

      const keep = new Map(); // live item id -> { x, i }
      const filled = new Set(); // indices of `next` already claimed by a slide

      if (animate && A.length && B.length && A.length <= MAX_DIFF && B.length <= MAX_DIFF) {
        const maxSlide = maxSlideEm * t.fontSize;
        for (const [ai, bi] of lcs(A, B)) {
          const it = live[A[ai].k];
          const j = B[bi].j;
          const x = xs[j];
          if (Math.abs(x - it.x) > maxSlide) continue; // too far to read as one letter
          keep.set(it.id, { x, i: j });
          filled.add(j);
        }
      }

      // Rebuild in place: survivors hold their slot, dropped letters flip to
      // "out" where they stand, arrivals go on the end. Relative order never
      // changes, so React only ever inserts and removes — it never moves a node.
      const items = [];
      for (const it of prev.items) {
        if (it.state === "out") {
          items.push(it); // still finishing its exit — leave it alone
          continue;
        }
        const k = keep.get(it.id);
        if (k) items.push({ ...it, x: k.x, i: k.i, state: "stay" });
        else items.push({ ...it, state: animate ? "out" : "gone" });
      }
      for (let j = 0; j < chars.length; j++) {
        if (isSpace(chars[j]) || filled.has(j)) continue;
        items.push({
          id: ++uidRef.current,
          ch: chars[j],
          x: xs[j],
          i: j,
          state: animate ? "in" : "stay",
        });
      }

      // when the last animation this change could have started is guaranteed
      // done, derived from what the CSS actually says right now
      const settle =
        Math.max(t.out, t.lead + t.in + t.cap * t.stepIn, t.slide + t.cap * t.step) + SETTLE_PAD;

      return {
        text: next,
        items: animate ? items : items.filter((it) => it.state !== "gone"),
        width,
        laid: true,
        busy: animate,
        settle,
      };
    },
    [measure, timing, maxSlideEm],
  );

  // ── drive it ───────────────────────────────────────────────────────────
  useIso(() => {
    const prev = viewRef.current;
    if (prev.laid && prev.text === str) return;

    const next = build(str, { animate: prev.laid || animateOnMount });
    viewRef.current = next;
    setView(next);

    if (next.width !== widthRef.current) {
      widthRef.current = next.width;
      onWidthRef.current?.(next.width);
    }

    if (!next.busy) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // everything has landed: drop the letters that left, and let the ones
      // that arrived fall back to plain resting style (which also releases
      // their blur filter and the will-change promotion).
      const v = viewRef.current;
      const settled = {
        ...v,
        busy: false,
        items: v.items
          .filter((it) => it.state !== "out")
          .map((it) => (it.state === "in" ? { ...it, state: "stay" } : it)),
      };
      viewRef.current = settled;
      setView(settled);
    }, next.settle);
  }, [str, build, animateOnMount]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // ── invalidate: webfont swap and viewport-relative type ────────────────
  // Measurements taken against the fallback face are wrong the instant the real
  // one lands, and a clamp()'d font-size changes with the viewport. Both just
  // mean "throw the cache away and re-place the glyphs, silently".
  useEffect(() => {
    let alive = true;
    let raf = 0;
    let debounce = 0;

    const replace = () => {
      if (!alive || !viewRef.current.laid) return;
      cacheRef.current.clear();
      const current = viewRef.current.text ?? "";
      const { xs, width } = measure(current);
      const chars = Array.from(current);

      const host = hostRef.current;
      if (host) host.dataset.quiet = "1"; // reposition without travelling

      const at = new Map();
      for (let j = 0; j < chars.length; j++) if (!isSpace(chars[j])) at.set(j, xs[j]);

      const moved = {
        ...viewRef.current,
        width,
        // only letters that belong to the current string — a letter still
        // exiting carries an index into the PREVIOUS one, which would collide
        items: viewRef.current.items.map((it) =>
          it.state !== "out" && at.has(it.i) ? { ...it, x: at.get(it.i) } : it,
        ),
      };
      viewRef.current = moved;
      setView(moved);

      if (width !== widthRef.current) {
        widthRef.current = width;
        onWidthRef.current?.(width);
      }

      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          if (hostRef.current) hostRef.current.dataset.quiet = "0";
        });
      });
    };

    document.fonts?.ready.then(replace).catch(() => {});
    const onResize = () => {
      clearTimeout(debounce);
      debounce = setTimeout(replace, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      alive = false;
      clearTimeout(debounce);
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [measure]);

  return (
    <Tag
      ref={hostRef}
      className={`morph ${className}`.trim()}
      data-morphing={view.busy ? "1" : "0"}
      style={view.laid ? { width: view.width, ...style } : style}
      {...rest}
    >
      <span className="morph-sr">{label === undefined ? str : label}</span>
      <span ref={mirrorRef} className="morph-mirror" aria-hidden="true" />
      {view.laid ? null : (
        <span className="morph-flow" aria-hidden="true">
          {str}
        </span>
      )}
      {view.items.map((it) => (
        <span
          key={it.id}
          className="morph-c"
          data-morph={it.state}
          style={{ "--x": `${it.x}px`, "--i": it.i }}
          aria-hidden="true"
        >
          <span className="morph-g">{it.ch}</span>
        </span>
      ))}
    </Tag>
  );
}

// Longest common subsequence over two character lists, returned as index pairs
// into a and b. Monotone: matched letters keep their relative order, so slides
// never cross. Strings here are short — the DP table is a few thousand cells.
function lcs(a, b) {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    const row = i * w;
    const nrow = row + w;
    for (let j = m - 1; j >= 0; j--) {
      dp[row + j] =
        a[i].ch === b[j].ch ? dp[nrow + j + 1] + 1 : Math.max(dp[nrow + j], dp[row + j + 1]);
    }
  }
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].ch === b[j].ch) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
    else j++;
  }
  return pairs;
}

export default memo(MorphText);
