"use client";

import { useLayoutEffect, useRef } from "react";

const STRIP = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const STIFF = 260;
const DAMP = 28;

function place(el, p) {
  const m = ((p % 10) + 10) % 10;
  el.style.transform = `translate3d(0, ${(-m * 100) / 11}%, 0)`;
}

function Column({ digit }) {
  const stripRef = useRef(null);
  const state = useRef(null);

  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const s = state.current;
    if (!s) {
      state.current = { p: digit, v: 0, target: digit, digit, raf: 0, last: 0 };
      place(el, digit);
      return;
    }
    if (s.digit === digit) return;
    let delta = digit - s.digit;
    if (delta > 5) delta -= 10;
    if (delta < -5) delta += 10;
    s.digit = digit;
    s.target += delta;
    if (s.raf) return;
    s.last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.032, (now - s.last) / 1000);
      s.last = now;
      const n = Math.max(1, Math.ceil(dt * 240));
      for (let i = 0; i < n; i += 1) {
        const a = STIFF * (s.target - s.p) - DAMP * s.v;
        s.v += (a * dt) / n;
        s.p += (s.v * dt) / n;
      }
      place(el, s.p);
      if (Math.abs(s.target - s.p) < 0.002 && Math.abs(s.v) < 0.01) {
        s.p = s.target;
        place(el, s.p);
        s.raf = 0;
        return;
      }
      s.raf = requestAnimationFrame(step);
    };
    s.raf = requestAnimationFrame(step);
  }, [digit]);

  useLayoutEffect(
    () => () => {
      if (state.current?.raf) {
        cancelAnimationFrame(state.current.raf);
        state.current.raf = 0;
      }
    },
    [],
  );

  return (
    <span className="eq-curve-roll-col" aria-hidden="true">
      <span ref={stripRef} className="eq-curve-roll-strip">
        {STRIP.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </span>
    </span>
  );
}

export default function Roll({ text, className = "" }) {
  const chars = String(text).split("");
  const n = chars.length;
  return (
    <span className={`eq-curve-roll ${className}`.trim()}>
      <span className="eq-curve-sr">{text}</span>
      {chars.map((c, i) => {
        const fromRight = n - 1 - i;
        if (/\d/.test(c)) return <Column key={`d${fromRight}`} digit={Number(c)} />;
        return (
          <span key={`s${fromRight}`} className="eq-curve-roll-sym" aria-hidden="true">
            {c}
          </span>
        );
      })}
    </span>
  );
}
