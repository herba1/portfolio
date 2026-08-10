"use client";

import { memo, useEffect, useRef } from "react";

/* ───────────────────────────────────────────────────────────────────────────
   Vertical waveform HISTORY — a scrolling timeline of how loud you've been.
   Bars are recorded moments; the newest enters at the TOP small and spreads
   open as it travels down, older moments keep scrolling down (still there).
   Both motions are continuous: the whole group translateY's smoothly (no per-
   row stepping), and each bar's "open" is eased from its live screen position
   (easeOutCubic — a natural, decelerating bloom) rather than snapping per row.
   Green in tune.

   ↓↓↓  EVERYTHING YOU'D WANT TO TWEAK LIVES HERE  ↓↓↓
─────────────────────────────────────────────────────────────────────────── */
const CONFIG = {
  bars: 110, // how many bars = how much history is on screen
  maxWidth: 340, // px — the column's max width; it's centred on the page
  widthVw: 84, // …but never wider than this % of the viewport on small screens
  topOffset: 0, // dvh — where the column STARTS (0 = very top of the screen)
  length: 100, // dvh — how tall it is (100 = all the way to the bottom)
  barThickness: 3, // px — thickness of each horizontal bar
  gain: 1, // loudness multiplier (raise to make it react harder)
  minBar: 0.02, // resting length when silent (0–1) so the centre never empties
  flatFloor: 0.008, // hairline width a brand-new bar starts at, before it spreads
  growBars: 18, // how many rows the "spread open" takes (bigger = gentler open)
  inputSmooth: 0.5, // smoothing on incoming loudness (0–1, lower = smoother)
  scrollSpeed: 0.34, // rows advanced per frame (higher = faster timeline)
};
/* ─────────────────────────────────────────────────────────────────────────── */

// natural, decelerating open. Swap for another curve to change the feel:
//   easeOutCubic:  1 - (1-p)^3   ·   easeOutQuart: 1 - (1-p)^4 (snappier)
const ease = (p) => 1 - (1 - p) * (1 - p) * (1 - p);

function Waveform({ pitchRef, subscribe }) {
  const innerRef = useRef(null);
  const barsRef = useRef([]);

  useEffect(() => {
    const N = CONFIG.bars;
    const COUNT = N + 2; // +2 spare rows so the top/bottom never show a gap
    const hist = new Float32Array(COUNT).fill(CONFIG.minBar); // 0 = newest (top)

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let t = 0;
    let ema = CONFIG.minBar;
    let scroll = 0; // fractional rows, 0..1, drives the smooth translate

    function render() {
      const f = CONFIG.flatFloor;
      for (let i = 0; i < COUNT; i++) {
        const el = barsRef.current[i];
        if (!el) continue;
        // ease the open from the bar's LIVE screen position → smooth, not stepped
        let p = (i - 1 + scroll) / CONFIG.growBars;
        p = p < 0 ? 0 : p > 1 ? 1 : p;
        const g = ease(p);
        const full = hist[i] < CONFIG.minBar ? CONFIG.minBar : hist[i];
        el.style.transform = `scaleX(${(f + (full - f) * g).toFixed(3)})`;
      }
      if (innerRef.current) {
        innerRef.current.style.transform = `translateY(${((scroll * 100) / N).toFixed(3)}%)`;
      }
    }

    function record() {
      const live = Math.min(1, pitchRef.current.level * CONFIG.gain);
      const idle = CONFIG.minBar + (0.5 + 0.5 * Math.sin(t)) * 0.05;
      t += 0.25;
      const amp = live > idle ? live : idle;
      ema += (amp - ema) * CONFIG.inputSmooth;
      for (let i = COUNT - 1; i > 0; i--) hist[i] = hist[i - 1];
      hist[0] = ema;
    }

    render();

    if (reduce) return;

    return subscribe(() => {
      scroll += CONFIG.scrollSpeed;
      while (scroll >= 1) {
        record();
        scroll -= 1;
      }
      render();
    });
  }, [pitchRef, subscribe]);

  const COUNT = CONFIG.bars + 2;

  return (
    <div
      className="wave"
      aria-hidden="true"
      style={{
        top: `${CONFIG.topOffset}dvh`,
        height: `${CONFIG.length}dvh`,
        width: `min(${CONFIG.maxWidth}px, ${CONFIG.widthVw}vw)`,
      }}
    >
      <div className="wave__inner" ref={innerRef}>
        {Array.from({ length: COUNT }).map((_, i) => (
          <span
            key={i}
            ref={(el) => (barsRef.current[i] = el)}
            className="wave__bar"
            style={{
              top: `${((i - 1) / CONFIG.bars) * 100}%`,
              height: CONFIG.barThickness,
              marginTop: -CONFIG.barThickness / 2,
            }}
          />
        ))}
      </div>
    </div>
  );
}

export default memo(Waveform);
