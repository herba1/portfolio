"use client";

import { useEffect, useRef } from "react";
import { CREDITS, ESSAY, META } from "./linerNotes";
import "./weighted-reading.css";

const LIGHT = 430;
const HEAVY = 600;
const LINE = 28;
const SOFT = 36;
const TAU = 70;
const MAX_SPEED = 2.2;
const READ_AT = 0.4;
const OPENING_WORDS = 13;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function lowerBound(arr, n, value) {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function Paragraph({ text }) {
  const words = text.split(" ");
  return (
    <p className="wr-p">
      {words.map((word, i) => (
        <span key={i}>
          <span className="wr-w">{word}</span>
          {i < words.length - 1 ? " " : null}
        </span>
      ))}
    </p>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const scrollerRef = useRef(null);
  const colRef = useRef(null);
  const bodyRef = useRef(null);
  const markerRef = useRef(null);
  const pctRef = useRef(null);
  const againRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    const scroller = scrollerRef.current;
    const col = colRef.current;
    const body = bodyRef.current;
    const marker = markerRef.current;
    const pctEl = pctRef.current;
    const again = againRef.current;
    if (!root || !scroller || !body) return undefined;

    const words = Array.from(body.querySelectorAll(".wr-w"));
    const n = words.length;
    const heavyW = new Float64Array(n);
    const extra = new Float64Array(n);
    const pos = new Float64Array(n);
    const shown = new Float32Array(n).fill(-1);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let measured = false;
    let alive = true;
    let visible = false;
    let baseTrack = 0;
    let readY = 0;
    let target = 0;
    let display = 0;
    let lastPct = -1;
    let raf = 0;
    let last = 0;
    let rewinding = false;
    let lastWidth = 0;
    let lastHeight = 0;

    const write = (i, t) => {
      if (Math.abs(shown[i] - t) < 0.002 && !(t === 0 || t === 1)) return;
      if (shown[i] === t) return;
      shown[i] = t;
      const el = words[i];
      el.style.fontWeight = (LIGHT + (HEAVY - LIGHT) * t).toFixed(1);
      el.style.letterSpacing = `${(baseTrack + (1 - t) * extra[i]).toFixed(3)}px`;
    };

    const weightAt = (i, s) => clamp01((s - pos[i]) / SOFT + 0.5);

    const paintVisible = (s) => {
      const top = scroller.scrollTop;
      const a = Math.max(0, lowerBound(pos, n, top - LINE * 3));
      const b = Math.min(n, lowerBound(pos, n, top + (lastHeight || 800) + LINE * 3));
      for (let i = a; i < b; i += 1) write(i, weightAt(i, s));
    };

    const paintAll = (s) => {
      for (let i = 0; i < n; i += 1) write(i, weightAt(i, s));
    };

    const readLine = () => scroller.scrollTop + readY;

    const updatePct = () => {
      if (!n) return;
      const start = pos[0] - SOFT * 0.5;
      const end = pos[n - 1] + SOFT * 0.5;
      const pct = Math.round(clamp01((display - start) / (end - start)) * 100);
      if (pct === lastPct) return;
      lastPct = pct;
      if (pctEl) pctEl.textContent = `${pct}%`;
      if (again) again.dataset.done = pct >= 100 ? "true" : "false";
    };

    const frame = (now) => {
      raf = 0;
      if (!alive) return;
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      const gap = target - display;
      const span = lastHeight || 600;
      if (Math.abs(gap) > span) display = target - Math.sign(gap) * span * 0.5;
      let step = reduced ? target - display : (target - display) * (1 - Math.exp(-dt / TAU));
      const cap = MAX_SPEED * dt;
      if (!reduced && Math.abs(step) > cap) step = Math.sign(step) * cap;
      display += step;
      if (Math.abs(target - display) < 0.05) display = target;
      paintVisible(display);
      updatePct();
      if (display !== target) schedule();
      else last = 0;
    };

    const schedule = () => {
      if (!raf && alive) raf = requestAnimationFrame(frame);
    };

    const onScroll = () => {
      if (!measured) return;
      const s = readLine();
      if (rewinding) {
        target = s;
        if (scroller.scrollTop <= 1) {
          rewinding = false;
          target = Math.max(target, pos[Math.min(n - 1, OPENING_WORDS)] + SOFT * 0.5);
        }
      } else if (s > target) {
        target = s;
      }
      if (visible) schedule();
    };

    const stopRewind = () => {
      rewinding = false;
    };

    const placeMarker = () => {
      const rootRect = root.getBoundingClientRect();
      const colRect = col.getBoundingClientRect();
      const gutter = colRect.left - rootRect.left;
      const compact = gutter < 96;
      root.dataset.compact = compact ? "true" : "false";
      const top = Math.round(scroller.offsetTop + readY);
      const x = compact ? 0 : Math.round(gutter - 88);
      if (marker) marker.style.transform = `translate3d(${x}px, ${top - 8}px, 0)`;
    };

    const layout = () => {
      const width = scroller.clientWidth;
      const height = scroller.clientHeight;
      lastWidth = width;
      lastHeight = height;
      const minRead = embedded ? 96 : 168;
      readY = Math.round(Math.max(minRead, height * READ_AT) / 4) * 4;
      const colWidth = body.clientWidth || 1;
      for (let i = 0; i < n; i += 1) {
        const el = words[i];
        pos[i] = el.offsetTop + LINE * 0.5 + ((el.offsetLeft - body.offsetLeft + heavyW[i] * 0.5) / colWidth - 0.5) * LINE;
      }
      placeMarker();
    };

    const measure = () => {
      if (!alive || measured) return;
      body.dataset.phase = "heavy";
      for (let i = 0; i < n; i += 1) heavyW[i] = words[i].getBoundingClientRect().width;
      body.dataset.phase = "light";
      const lightW = new Float64Array(n);
      for (let i = 0; i < n; i += 1) lightW[i] = words[i].getBoundingClientRect().width;
      baseTrack = parseFloat(getComputedStyle(words[0]).letterSpacing) || 0;
      const glyphs = new Float64Array(n);
      for (let i = 0; i < n; i += 1) {
        glyphs[i] = Math.max(1, Array.from(words[i].textContent).length);
        extra[i] = Math.max(0, heavyW[i] - lightW[i]) / glyphs[i];
        words[i].style.letterSpacing = `${(baseTrack + extra[i]).toFixed(3)}px`;
      }
      for (let i = 0; i < n; i += 1) lightW[i] = words[i].getBoundingClientRect().width;
      for (let i = 0; i < n; i += 1) {
        extra[i] = Math.max(0, extra[i] + (heavyW[i] - lightW[i]) / glyphs[i]);
        words[i].style.width = `${heavyW[i].toFixed(3)}px`;
      }
      body.dataset.phase = "set";
      layout();
      measured = true;
      display = pos[0] - SOFT;
      paintAll(display);
      target = Math.max(readLine(), pos[Math.min(n - 1, OPENING_WORDS)] + SOFT * 0.5);
      updatePct();
      body.dataset.ready = "true";
      if (marker) marker.dataset.ready = "true";
      schedule();
    };

    const io = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? false;
      if (!visible) return;
      if (!measured) document.fonts.ready.then(() => requestAnimationFrame(measure));
      else schedule();
    });
    io.observe(root);

    const ro = new ResizeObserver(() => {
      if (!measured) return;
      if (scroller.clientWidth === lastWidth && scroller.clientHeight === lastHeight) return;
      const targetIndex = lowerBound(pos, n, target);
      const displayIndex = lowerBound(pos, n, display);
      layout();
      const toPos = (index, fallback) => (index <= 0 ? fallback : index >= n ? pos[n - 1] + SOFT : pos[index]);
      target = toPos(targetIndex, target);
      display = toPos(displayIndex, display);
      shown.fill(-1);
      paintAll(display);
      onScroll();
    });
    ro.observe(scroller);

    const onVisibility = () => {
      if (document.hidden && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
        last = 0;
      } else if (!document.hidden && visible) schedule();
    };

    const onAgain = () => {
      if (!measured) return;
      rewinding = true;
      scroller.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
      requestAnimationFrame(onScroll);
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("wheel", stopRewind, { passive: true });
    scroller.addEventListener("pointerdown", stopRewind, { passive: true });
    scroller.addEventListener("touchstart", stopRewind, { passive: true });
    again?.addEventListener("click", onAgain);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("wheel", stopRewind);
      scroller.removeEventListener("pointerdown", stopRewind);
      scroller.removeEventListener("touchstart", stopRewind);
      again?.removeEventListener("click", onAgain);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [embedded]);

  return (
    <div ref={rootRef} className="wr-root" data-embedded={embedded ? "true" : "false"}>
      <div
        ref={scrollerRef}
        className="wr-scroller"
        tabIndex={0}
        data-scroll-contain
        aria-label="Liner notes for Please Please Me"
      >
        <article ref={colRef} className="wr-col">
          <header className="wr-head">
            <p className="wr-kicker">
              <span className="wr-kicker-strong">{META.kicker}</span>
              <span className="wr-kicker-record">
                <span className="wr-kicker-sep" aria-hidden="true">·</span>
                <span>{META.record}</span>
              </span>
            </p>
            <h1 className="wr-title">
              {META.titleLead} <em>{META.titleEmphasis}</em>
            </h1>
            <p className="wr-byline">
              <span>{META.byline}</span>
              <span className="wr-kicker-sep" aria-hidden="true">·</span>
              <span className="wr-tabular">{META.minutes}</span>
            </p>
          </header>
          <div ref={bodyRef} className="wr-body" data-phase="light">
            {ESSAY.map((block, i) =>
              block.kind === "h" ? (
                <h2 key={i} className="wr-h">
                  {block.text}
                </h2>
              ) : (
                <Paragraph key={i} text={block.text} />
              ),
            )}
          </div>
          <footer className="wr-foot">
            <dl className="wr-credits">
              {CREDITS.map(([label, value]) => (
                <div key={label} className="wr-credit">
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <button ref={againRef} type="button" className="wr-again" data-done="false">
              Read it again
            </button>
          </footer>
        </article>
      </div>
      <div className="wr-fade wr-fade--top" aria-hidden="true" />
      <div className="wr-fade wr-fade--bottom" aria-hidden="true" />
      <div ref={markerRef} className="wr-marker" aria-hidden="true">
        <span ref={pctRef} className="wr-pct">
          0%
        </span>
        <span className="wr-tick" />
      </div>
    </div>
  );
}
