"use client";

import { useEffect, useImperativeHandle, useRef, useState } from "react";

import { assign, sleep, springFor, wake } from "./morphEngine";
import { EQ_REST, SHAPES, eqShape } from "./shapes";

const MOVE = springFor(0.4, 0.9);
const FADE = springFor(0.16, 1);
const NUDGE = springFor(0.34, 0.78);
const SUB = 1 / 240;

function resolve(shape, levels) {
  return shape === "eq" ? eqShape(levels) : SHAPES[shape];
}

function createMorph(lines) {
  const pos = new Float64Array(15);
  const vel = new Float64Array(15);
  const tgt = new Float64Array(15);
  lines.forEach((line, i) => {
    for (let j = 0; j < 5; j += 1) {
      pos[i * 5 + j] = line[j];
      tgt[i * 5 + j] = line[j];
    }
  });
  const morph = {
    els: [],
    group: null,
    reduced: false,
    shift: 0,
    shiftVel: 0,
    attach(els, group) {
      morph.els = els;
      morph.group = group;
    },
    setReduced(value) {
      morph.reduced = value;
    },
    write() {
      for (let i = 0; i < 3; i += 1) {
        const el = morph.els[i];
        if (!el) continue;
        const o = i * 5;
        el.setAttribute("x1", pos[o].toFixed(3));
        el.setAttribute("y1", pos[o + 1].toFixed(3));
        el.setAttribute("x2", pos[o + 2].toFixed(3));
        el.setAttribute("y2", pos[o + 3].toFixed(3));
        el.setAttribute("opacity", Math.min(1, Math.max(0, pos[o + 4])).toFixed(3));
      }
      if (morph.group) morph.group.setAttribute("transform", `translate(${morph.shift.toFixed(3)} 0)`);
    },
    current() {
      return [0, 1, 2].map((i) => Array.from(pos.slice(i * 5, i * 5 + 5)));
    },
    to(lines, instant = false) {
      const next = assign(morph.current(), lines);
      next.forEach((line, i) => {
        for (let j = 0; j < 5; j += 1) tgt[i * 5 + j] = line[j];
      });
      if (morph.reduced || instant) {
        sleep(morph);
        pos.set(tgt);
        vel.fill(0);
        morph.write();
        return;
      }
      wake(morph);
    },
    kick(dx) {
      if (morph.reduced) return;
      morph.shiftVel += dx;
      wake(morph);
    },
    step(dt) {
      let t = 0;
      while (t < dt) {
        const h = Math.min(SUB, dt - t);
        t += h;
        for (let i = 0; i < 15; i += 1) {
          const s = i % 5 === 4 ? FADE : MOVE;
          const a = -s.k * (pos[i] - tgt[i]) - s.c * vel[i];
          vel[i] += a * h;
          pos[i] += vel[i] * h;
        }
        const a = -NUDGE.k * morph.shift - NUDGE.c * morph.shiftVel;
        morph.shiftVel += a * h;
        morph.shift += morph.shiftVel * h;
      }
      let moving = Math.abs(morph.shift) > 0.002 || Math.abs(morph.shiftVel) > 0.01;
      for (let i = 0; i < 15 && !moving; i += 1) {
        if (Math.abs(pos[i] - tgt[i]) > 0.002 || Math.abs(vel[i]) > 0.01) moving = true;
      }
      if (!moving) {
        pos.set(tgt);
        vel.fill(0);
        morph.shift = 0;
        morph.shiftVel = 0;
      }
      morph.write();
      return moving;
    },
  };
  return morph;
}

export default function MorphIcon({ shape, live = false, snap = false, size = 24, stroke = 2, className = "", ref }) {
  const [initial] = useState(() => resolve(shape, EQ_REST));
  const [morph] = useState(() => createMorph(initial));
  const lineRefs = useRef([]);
  const groupRef = useRef(null);
  const first = useRef(true);
  const lastShape = useRef(shape);

  useImperativeHandle(ref, () => ({ kick: (dx) => morph.kick(dx) }), [morph]);

  useEffect(() => {
    morph.attach(lineRefs.current, groupRef.current);
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    morph.setReduced(query.matches);
    const onChange = () => morph.setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
      sleep(morph);
    };
  }, [morph]);

  useEffect(() => {
    const instant = snap && lastShape.current !== shape;
    lastShape.current = shape;
    if (first.current) {
      first.current = false;
      if (shape !== "eq" || !live) return undefined;
    }
    if (shape !== "eq") {
      morph.to(resolve(shape), instant);
      return undefined;
    }
    morph.to(eqShape(EQ_REST), instant);
    if (!live) return undefined;
    let timer = 0;
    const tick = () => {
      const peak = 7 + Math.random() * 5;
      morph.to(eqShape([3 + Math.random() * (peak - 3), 4 + Math.random() * (peak - 2), 3 + Math.random() * (peak - 4)]));
      timer = window.setTimeout(tick, 200 + Math.random() * 160);
    };
    timer = window.setTimeout(tick, 60);
    return () => window.clearTimeout(timer);
  }, [shape, live, snap, morph]);

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <g ref={groupRef}>
        {initial.map((line, i) => (
          <line
            key={i}
            ref={(el) => {
              lineRefs.current[i] = el;
            }}
            x1={line[0]}
            y1={line[1]}
            x2={line[2]}
            y2={line[3]}
            opacity={line[4]}
          />
        ))}
      </g>
    </svg>
  );
}
