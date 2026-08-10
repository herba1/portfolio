"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./SlotNumber.css";

// ---------------------------------------------------------------------------
// SlotNumber — rolling odometer digits, CSS-first.
//
//   <SlotNumber value={12} />
//   <SlotNumber value="0:14 / 0:29" direction="up" />
//   <SlotNumber value={n} pad={3} duration={620} stagger={40} />
//
//   const slot = useRef(null);
//   <SlotNumber ref={slot} value="01 / 24" />
//   slot.current.setValue("07 / 24");
//
// The element tree is built once per SHAPE (the string with every digit
// replaced by "#"), so a ticking value re-renders nothing: React returns the
// same memoised children and the update is a single custom-property write per
// column that actually changed. The browser then transitions `transform` on a
// promoted layer — compositor only, zero layout, zero paint, zero React diff.
//
// Wrapping: a column is three stacked copies of 0–9 and rests in the middle
// one, so 9 → 0 keeps rolling in the same direction instead of spinning back
// through 8…1. Once at rest a column silently rebases into the middle band —
// the strip repeats every ten cells, so that jump is invisible by construction.
// ---------------------------------------------------------------------------

const HOME = 10; // first cell of the middle copy
const CELLS = 30; // three copies of 0–9
const MAX = CELLS - 1;

const isDigit = (c) => c >= "0" && c <= "9";
const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

// One shared strip of elements — React is happy to mount the same element
// objects in every column, so 30 cells are described once, not per digit.
const REEL = Array.from({ length: CELLS }, (_, i) => (
  <span className="slot-cell" key={i}>
    {i % 10}
  </span>
));

const format = (value, pad) => {
  const text = value === null || value === undefined ? "" : String(value);
  return pad > 0 ? text.padStart(pad, "0") : text;
};

const shapeOf = (text) => text.replace(/\d/g, "#");

// Fresh markup already carries the right positions; just adopt them.
function readColumns(root, shape) {
  return {
    shape,
    items: Array.from(root.querySelectorAll(".slot-reel"), (el) => ({
      el,
      pos: Number(el.style.getPropertyValue("--slot-d")) || HOME,
      order: Number(el.style.getPropertyValue("--slot-i")) || 0,
      at: 0,
    })),
  };
}

function roll(cols, text, { duration, stagger, direction }) {
  const now = performance.now();
  const step = stagger === null || stagger === undefined ? 30 : stagger;
  const fixed = direction === "up" ? 1 : direction === "down" ? -1 : 0;

  let i = 0;
  for (const ch of text) {
    if (!isDigit(ch)) continue;
    const it = cols.items[i];
    const d = +ch;
    i++;
    if (!it) continue;

    const mod = ((it.pos % 10) + 10) % 10;
    if (mod === d) continue; // untouched column: not one DOM write

    const up = (d - mod + 10) % 10; // 1…9
    const down = up - 10; // −9…−1
    const delta = fixed === 1 ? up : fixed === -1 ? down : up <= 5 ? up : down;

    let base = it.pos;
    let target = base + delta;

    if (target < 0 || target > MAX) {
      const rested = now - it.at >= duration + step * it.order;
      if (rested) {
        base = HOME + mod;
        snap(it.el, base);
        target = base + delta;
      }
      // Only reachable when a change interrupts a roll near the strip's end:
      // flip the direction rather than pop.
      if (target < 0 || target > MAX) target = base + (delta > 0 ? down : up);
    }

    it.pos = target;
    it.at = now;
    it.el.style.setProperty("--slot-d", target);
  }
}

function SlotNumber(
  {
    value,
    pad = 0,
    duration = 520,
    ease,
    stagger,
    direction = "auto", // "up" | "down" | "auto" (shortest path)
    label, // accessible text override
    className = "",
    style,
    ...rest
  },
  ref,
) {
  const propText = format(value, pad);

  const propRef = useRef(propText);
  const liveRef = useRef(null);
  const [, rebuild] = useState(0);
  if (propText !== propRef.current) {
    propRef.current = propText;
    liveRef.current = null;
  }

  const text = liveRef.current ?? propText;
  const shape = shapeOf(text);

  const rootRef = useRef(null);
  const srRef = useRef(null);
  const colsRef = useRef(null);

  const optsRef = useRef(null);
  optsRef.current = { duration, stagger, direction, pad, silent: label !== undefined };

  // Structure only — rebuilt when a digit is added or a separator moves, never
  // when the digits change. buildTree stamps the current digits inline so the
  // first paint (and SSR markup) is already correct.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tree = useMemo(() => buildTree(text), [shape]);

  useIso(() => {
    const root = rootRef.current;
    if (!root) return;
    const cols = colsRef.current;
    if (!cols || cols.shape !== shape) {
      colsRef.current = readColumns(root, shape);
      return;
    }
    roll(cols, text, optsRef.current);
  }, [text, shape]);

  const setValue = useCallback((next) => {
    const opts = optsRef.current;
    const nextText = format(next, opts.pad);
    if (nextText === (liveRef.current ?? propRef.current)) return;

    liveRef.current = nextText;
    const cols = colsRef.current;
    if (!cols || cols.shape !== shapeOf(nextText)) {
      rebuild((n) => n + 1);
      return;
    }
    roll(cols, nextText, opts);
    if (!opts.silent && srRef.current) srRef.current.textContent = nextText;
  }, []);

  useImperativeHandle(ref, () => ({ setValue }), [setValue]);

  const vars = { "--slot-dur": `${duration}ms` };
  if (ease) vars["--slot-ease"] = ease;
  if (stagger !== null && stagger !== undefined) vars["--slot-stagger"] = `${stagger}ms`;

  return (
    <span ref={rootRef} className={`slot ${className}`} style={{ ...vars, ...style }} {...rest}>
      <span ref={srRef} className="slot-sr">
        {label === undefined ? text : label}
      </span>
      {tree}
    </span>
  );
}

function buildTree(text) {
  const chars = Array.from(text);
  // Cascade order is counted from the right within each whitespace-separated
  // field, so "0:14 / 0:29" ticks both readouts on the same frame while a
  // grouped number like "1,204,880" still carries left across its commas.
  const order = new Array(chars.length).fill(0);
  for (let end = chars.length - 1, n = 0; end >= 0; end--) {
    const ch = chars[end];
    if (ch === " " || ch === "\u00a0") n = 0;
    else if (isDigit(ch)) order[end] = n++;
  }
  return chars.map((ch, i) => {
    if (!isDigit(ch)) {
      return (
        <span className="slot-sep" key={i} aria-hidden="true">
          {ch === " " ? "\u00a0" : ch}
        </span>
      );
    }
    return (
      <span className="slot-col" key={i} aria-hidden="true">
        <span className="slot-reel" style={{ "--slot-i": order[i], "--slot-d": HOME + +ch }}>
          {REEL}
        </span>
      </span>
    );
  });
}

// Move without animating. The strip repeats every ten cells, so a ±10 rebase
// lands on identical pixels — mid-roll included.
function snap(el, v) {
  el.style.transitionDuration = "0s";
  el.style.setProperty("--slot-d", v);
  void el.offsetHeight;
  el.style.transitionDuration = "";
}

export default memo(forwardRef(SlotNumber));
