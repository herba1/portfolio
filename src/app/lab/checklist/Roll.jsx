"use client";

import { useEffect, useState } from "react";

import { sleep, springFor, wake } from "./loop";

const ROLL = springFor(0.5, 0.94);
const STACK = Array.from({ length: 30 }, (_, i) => i % 10);
const SUB = 1 / 240;

function createColumn(digit) {
  const col = {
    el: null,
    pos: digit,
    vel: 0,
    tgt: digit,
    reduced: false,
    attach(el, reduced) {
      col.el = el;
      col.reduced = reduced;
    },
    write() {
      if (!col.el) return;
      const m = ((col.pos % 10) + 10) % 10;
      col.el.style.transform = `translateY(calc(var(--checklist-roll-unit) * ${(-(m + 10)).toFixed(4)}))`;
    },
    to(digit, dir) {
      const at = ((Math.round(col.tgt) % 10) + 10) % 10;
      const delta = dir < 0 ? -((((at - digit) % 10) + 10) % 10) : (((digit - at) % 10) + 10) % 10;
      if (!delta) return;
      col.tgt += delta;
      if (col.reduced) {
        col.pos = col.tgt;
        col.vel = 0;
        col.write();
        return;
      }
      wake(col);
    },
    step(dt) {
      let t = 0;
      while (t < dt) {
        const h = Math.min(SUB, dt - t);
        t += h;
        const a = -ROLL.k * (col.pos - col.tgt) - ROLL.c * col.vel;
        col.vel += a * h;
        col.pos += col.vel * h;
      }
      const moving = Math.abs(col.pos - col.tgt) > 0.001 || Math.abs(col.vel) > 0.01;
      if (!moving) {
        col.pos = col.tgt;
        col.vel = 0;
      }
      col.write();
      return moving;
    },
  };
  return col;
}

function Column({ digit, dir, blank }) {
  const [initial] = useState(digit);
  const [col] = useState(() => createColumn(digit));

  useEffect(() => {
    return () => sleep(col);
  }, [col]);

  useEffect(() => {
    col.to(digit, dir);
  }, [digit, dir, col]);

  return (
    <span className="checklist__roll-col" data-blank={blank || undefined} aria-hidden="true">
      <span className="checklist__roll-sizer">0</span>
      <span
        className="checklist__roll-stack"
        ref={(el) => col.attach(el, typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches)}
        style={{ transform: `translateY(calc(var(--checklist-roll-unit) * ${-(initial + 10)}))` }}
      >
        {STACK.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </span>
    </span>
  );
}

const numeric = (text) => Number(text.replace(/\D/g, ""));

export default function Roll({ text, blank = [], className = "", label }) {
  const [prev, setPrev] = useState(text);
  const [dir, setDir] = useState(-1);
  if (prev !== text) {
    setPrev(text);
    setDir(numeric(text) < numeric(prev) ? -1 : 1);
  }
  return (
    <span className={`checklist__roll ${className}`}>
      <span className="sr-only">{label}</span>
      {Array.from(text).map((ch, i) =>
        /\d/.test(ch) ? (
          <Column key={i} digit={Number(ch)} dir={dir} blank={blank.includes(i)} />
        ) : (
          <span key={i} className="checklist__roll-sep" aria-hidden="true">
            {ch}
          </span>
        ),
      )}
    </span>
  );
}
