"use client";

import { useEffect, useRef } from "react";

import { createSpring, snapSpring, stepSpring } from "./spring";

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function PillSlider({ label, min, max, step = 1, value, format, disabled = false, onInput, onCommit }) {
  const rootRef = useRef(null);
  const trackRef = useRef(null);
  const fillRef = useRef(null);
  const valueRef = useRef(null);
  const sim = useRef(null);
  const live = useRef({ target: value, shown: null, drag: null, raf: 0, last: 0 });
  const handlers = useRef({ onInput, onCommit, format });

  useEffect(() => {
    handlers.current = { onInput, onCommit, format };
  });

  const frac = (v) => (v - min) / (max - min);

  const paint = () => {
    const s = sim.current;
    const f = Math.min(1, Math.max(0, s.f.x));
    if (fillRef.current) fillRef.current.style.clipPath = `inset(0 calc((100% - 36px) * ${(1 - f).toFixed(4)}) 0 0 round 20px)`;
    if (trackRef.current) {
      const o = s.o.x;
      const w = trackRef.current.offsetWidth || 200;
      trackRef.current.style.transformOrigin = o >= 0 ? "0% 50%" : "100% 50%";
      trackRef.current.style.transform = Math.abs(o) < 0.01 ? "" : `scale(${(1 + Math.abs(o) / w).toFixed(4)}, ${(1 - Math.abs(o) / 220).toFixed(4)})`;
    }
    const st = live.current;
    if (st.shown !== st.target) {
      st.shown = st.target;
      if (valueRef.current) valueRef.current.textContent = handlers.current.format(st.target);
      rootRef.current?.setAttribute("aria-valuenow", String(st.target));
      rootRef.current?.setAttribute("aria-valuetext", handlers.current.format(st.target));
      handlers.current.onInput?.(st.target);
    }
  };

  const tick = (t) => {
    const st = live.current;
    const dt = st.last ? (t - st.last) / 1000 : 1 / 60;
    st.last = t;
    const s = sim.current;
    const a = stepSpring(s.f, dt);
    const b = stepSpring(s.o, dt);
    paint();
    if (a && b && !st.drag) {
      st.raf = 0;
      st.last = 0;
      return;
    }
    st.raf = requestAnimationFrame(tick);
  };

  const kick = () => {
    const st = live.current;
    if (reducedMotion()) {
      snapSpring(sim.current.f, sim.current.f.target);
      snapSpring(sim.current.o, 0);
      paint();
      return;
    }
    if (!st.raf) st.raf = requestAnimationFrame(tick);
  };

  const setTarget = (v, animate = true) => {
    const clamped = Math.min(max, Math.max(min, Math.round(v / step) * step));
    live.current.target = clamped;
    sim.current.f.target = frac(clamped);
    if (!animate) snapSpring(sim.current.f, frac(clamped));
    kick();
  };

  useEffect(() => {
    if (!sim.current) {
      sim.current = { f: createSpring(frac(value), { response: 0.2, damping: 1 }), o: createSpring(0, { response: 0.32, damping: 0.86 }) };
      live.current.target = value;
      paint();
      return;
    }
    if (live.current.drag) return;
    live.current.target = value;
    sim.current.f.target = frac(value);
    kick();
  });

  useEffect(() => () => cancelAnimationFrame(live.current.raf), []);

  const fromX = (clientX) => {
    const r = trackRef.current.getBoundingClientRect();
    const inner = r.width - 36;
    const x = clientX - r.left - 18;
    return { v: min + (x / inner) * (max - min), over: x < 0 ? x : x > inner ? x - inner : 0 };
  };

  const onPointerDown = (e) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    live.current.drag = { id: e.pointerId };
    const { v } = fromX(e.clientX);
    setTarget(v);
  };

  const onPointerMove = (e) => {
    const st = live.current;
    if (!st.drag || st.drag.id !== e.pointerId) return;
    const { v, over } = fromX(e.clientX);
    const o = Math.sign(over) * 8 * (1 - Math.exp(-Math.abs(over) / 40));
    sim.current.o.target = o;
    setTarget(v);
  };

  const release = (e) => {
    const st = live.current;
    if (!st.drag || st.drag.id !== e.pointerId) return;
    st.drag = null;
    sim.current.o.target = 0;
    kick();
    handlers.current.onCommit?.(st.target);
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    const big = (max - min) / 10;
    const delta = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: big, PageDown: -big }[e.key];
    let next = null;
    if (delta != null) next = live.current.target + delta * (e.shiftKey ? 5 : 1);
    if (e.key === "Home") next = min;
    if (e.key === "End") next = max;
    if (next == null) return;
    e.preventDefault();
    e.stopPropagation();
    setTarget(next);
    handlers.current.onCommit?.(live.current.target);
  };

  return (
    <div
      ref={rootRef}
      className="mt-slider"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-disabled={disabled || undefined}
      data-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={onKeyDown}
    >
      <span ref={trackRef} className="mt-slider__track">
        <span ref={fillRef} className="mt-slider__fill" />
      </span>
      <span className="mt-slider__label text-ui-lg">{label}</span>
      <span ref={valueRef} className="mt-slider__value text-ui-lg">{format(value)}</span>
    </div>
  );
}
