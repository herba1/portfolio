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
  maxWidth: 340, // px — the column's max width; it's centred in the box
  widthCqw: 84, // …but never wider than this % of the box in small boxes
  topOffset: 0, // cqh — where the column STARTS (0 = very top of the box)
  length: 100, // cqh — how tall it is (100 = all the way to the bottom)
  barThickness: 4, // px — thickness of each horizontal bar
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
const ROW_PITCH = 12;
const MIN_ROWS = 24;

const ease = (p) => 1 - (1 - p) * (1 - p) * (1 - p);

function Waveform({ pitchRef, subscribe }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    let N = CONFIG.bars;
    let COUNT = N + 2;
    let hist = new Float32Array(COUNT).fill(CONFIG.minBar);

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let t = 0;
    let ema = CONFIG.minBar;
    let scroll = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let ink = "";
    let inkShifting = false;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      ink = getComputedStyle(wrap).color;
      width = wrap.clientWidth;
      height = wrap.clientHeight;
      const rows = Math.max(MIN_ROWS, Math.round(height / ROW_PITCH));
      if (rows !== N) {
        const previous = hist;
        N = rows;
        COUNT = N + 2;
        hist = new Float32Array(COUNT).fill(CONFIG.minBar);
        hist.set(previous.subarray(0, Math.min(previous.length, COUNT)));
      }
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
    }

    function render() {
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      if (inkShifting) ink = getComputedStyle(wrap).color;
      context.fillStyle = ink;
      const thickness = CONFIG.barThickness;
      const f = CONFIG.flatFloor;
      context.beginPath();
      for (let i = 0; i < COUNT; i++) {
        let p = (i - 1 + scroll) / CONFIG.growBars;
        p = p < 0 ? 0 : p > 1 ? 1 : p;
        const g = ease(p);
        const full = hist[i] < CONFIG.minBar ? CONFIG.minBar : hist[i];
        const barWidth = (f + (full - f) * g) * width;
        const centreY = ((i - 1 + scroll) / N) * height;
        context.roundRect((width - barWidth) / 2, centreY - thickness / 2, barWidth, thickness, thickness / 2);
      }
      context.fill();
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

    resize();
    render();
    const resizeObserver = new ResizeObserver(() => {
      resize();
      render();
    });
    resizeObserver.observe(wrap);

    if (reduce) return () => resizeObserver.disconnect();

    const onInkShiftStart = (event) => {
      if (event.target === wrap && event.propertyName === "color") inkShifting = true;
    };
    const onInkShiftEnd = (event) => {
      if (event.target !== wrap || event.propertyName !== "color") return;
      inkShifting = false;
      ink = getComputedStyle(wrap).color;
    };
    wrap.addEventListener("transitionrun", onInkShiftStart);
    wrap.addEventListener("transitionend", onInkShiftEnd);
    wrap.addEventListener("transitioncancel", onInkShiftEnd);

    let onScreen = true;
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
    });
    intersectionObserver.observe(wrap);

    const unsubscribe = subscribe(() => {
      if (!onScreen) return;
      scroll += CONFIG.scrollSpeed;
      while (scroll >= 1) {
        record();
        scroll -= 1;
      }
      render();
    });

    return () => {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      wrap.removeEventListener("transitionrun", onInkShiftStart);
      wrap.removeEventListener("transitionend", onInkShiftEnd);
      wrap.removeEventListener("transitioncancel", onInkShiftEnd);
      unsubscribe();
    };
  }, [pitchRef, subscribe]);

  return (
    <div
      ref={wrapRef}
      className="wave"
      aria-hidden="true"
      style={{
        top: `${CONFIG.topOffset}cqh`,
        height: `${CONFIG.length}cqh`,
        width: `min(${CONFIG.maxWidth}px, ${CONFIG.widthCqw}cqw)`,
      }}
    >
      <canvas ref={canvasRef} className="wave__canvas" />
    </div>
  );
}

export default memo(Waveform);
