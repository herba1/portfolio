"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "./dial.css";
import {
  DEFAULT_VALUE,
  FRICTION,
  MAX_VALUE,
  MIN_VALUE,
  PLACES,
  SPIN_REFERENCE,
  STEP,
  TICKS,
  VELOCITY_STOP,
  angleForValue,
  clampValue,
  digitStrip,
  snapValue,
  tickProximity,
  valueForAngle,
} from "./detentParams";

function angleFromPointer(clientX, clientY, rect) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = clientX - centerX;
  const dy = clientY - centerY;
  return Math.atan2(dx, -dy) * (180 / Math.PI);
}

export default function DetentV2V2Experience() {
  const [value, setValue] = useState(DEFAULT_VALUE);
  const [dragging, setDragging] = useState(false);
  const [coasting, setCoasting] = useState(false);
  const [settling, setSettling] = useState(false);
  const [spin, setSpin] = useState(0);
  const [pulseIndex, setPulseIndex] = useState(null);
  const [markTension, setMarkTension] = useState({ bend: 0, stretch: 1 });

  const knobRef = useRef(null);
  const sampleRef = useRef(null);
  const velocityRef = useRef(0);
  const rafRef = useRef(null);
  const prevLitRef = useRef(null);

  const stopCoast = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setCoasting(false);
  }, []);

  const settle = useCallback((raw) => {
    setValue(snapValue(raw));
    setSettling(true);
    setSpin(0);
  }, []);

  const coast = useCallback((startValue) => {
    let current = startValue;
    let lastTime = performance.now();

    const step = (now) => {
      const dt = Math.min(48, now - lastTime);
      lastTime = now;

      velocityRef.current *= FRICTION;
      const next = current + velocityRef.current * dt;
      const clamped = clampValue(next);
      current = clamped;

      if (clamped !== next) {
        velocityRef.current = 0;
      }

      setValue(clamped);
      setSpin(Math.min(1, Math.abs(velocityRef.current) / SPIN_REFERENCE));

      if (Math.abs(velocityRef.current) < VELOCITY_STOP || clamped === MIN_VALUE || clamped === MAX_VALUE) {
        rafRef.current = null;
        setCoasting(false);
        settle(clamped);
        return;
      }

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
  }, [settle]);

  const handlePointerDown = useCallback((event) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    stopCoast();
    setSettling(false);
    setDragging(true);
    sampleRef.current = { value, time: performance.now() };
    velocityRef.current = 0;
  }, [stopCoast, value]);

  const handlePointerMove = useCallback((event) => {
    if (!dragging || !knobRef.current) return;
    const rect = knobRef.current.getBoundingClientRect();
    const angle = angleFromPointer(event.clientX, event.clientY, rect);
    const next = snapValue(valueForAngle(angle));

    const now = performance.now();
    const prev = sampleRef.current;
    if (prev) {
      const dt = Math.max(1, now - prev.time);
      velocityRef.current = (next - prev.value) / dt;
    }
    sampleRef.current = { value: next, time: now };

    const committedAngle = angleForValue(value);
    const rawTension = ((angle - committedAngle + 180) % 360 + 360) % 360 - 180;
    const bend = Math.max(-22, Math.min(22, rawTension * 0.9));

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const pull = Math.hypot(event.clientX - centerX, event.clientY - centerY) / (rect.width / 2);
    const stretch = Math.max(0.85, Math.min(1.35, 0.85 + pull * 0.3));
    setMarkTension({ bend, stretch });

    setValue(next);
    setSpin(Math.min(1, Math.abs(velocityRef.current) / SPIN_REFERENCE));
  }, [dragging, value]);

  const handlePointerUp = useCallback((event) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    setMarkTension({ bend: 0, stretch: 1 });

    if (Math.abs(velocityRef.current) > VELOCITY_STOP * 6) {
      setCoasting(true);
      coast(value);
    } else {
      settle(value);
    }
  }, [coast, settle, value]);

  const handleKeyDown = useCallback((event) => {
    stopCoast();
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setValue((current) => clampValue(current + STEP));
      setSettling(true);
      setSpin(0.3);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setValue((current) => clampValue(current - STEP));
      setSettling(true);
      setSpin(0.3);
    } else if (event.key === "Home") {
      event.preventDefault();
      setValue(MIN_VALUE);
      setSettling(true);
    } else if (event.key === "End") {
      event.preventDefault();
      setValue(MAX_VALUE);
      setSettling(true);
    }
  }, [stopCoast]);

  useEffect(() => {
    if (!settling) return undefined;
    const timeout = setTimeout(() => setSettling(false), 280);
    return () => clearTimeout(timeout);
  }, [settling]);

  useEffect(() => {
    if (!settling) return undefined;
    const timeout = setTimeout(() => setSpin(0), 240);
    return () => clearTimeout(timeout);
  }, [settling]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const litCount = Math.round((value - MIN_VALUE) / STEP);

  useEffect(() => {
    if (prevLitRef.current === litCount) return undefined;
    prevLitRef.current = litCount;
    const index = Math.max(0, Math.min(TICKS.length - 1, litCount));
    setPulseIndex(index);
    const timeout = setTimeout(() => setPulseIndex(null), 220);
    return () => clearTimeout(timeout);
  }, [litCount]);

  return (
    <main className="d2v2 bg-surface text-ink">
      <header className="d2v2__head">
        <h1 className="text-title-sm">Evolve Evolve Detent</h1>
        <p className="text-ui text-ink">Flick it — it keeps spinning, and shows you exactly how hard.</p>
      </header>

      <div className="d2v2__stage" data-active={dragging || coasting || settling}>
        <div className="d2v2__ticks" aria-hidden="true">
          {TICKS.map((tick, index) => (
            <span
              key={tick}
              className="d2v2__tick"
              data-lit={index <= litCount}
              data-pulse={index === pulseIndex}
              style={{
                "--d2v2-tick-angle": `${angleForValue(tick)}deg`,
                "--d2v2-tick-scale": 1 + tickProximity(tick, value) * 0.85,
              }}
            />
          ))}
        </div>

        <div
          className="d2v2__energy"
          aria-hidden="true"
          style={{ "--d2v2-angle": `${angleForValue(value)}deg`, "--d2v2-spin": spin }}
        />

        <div
          ref={knobRef}
          id="detent-v2-v2-knob"
          className="d2v2__knob"
          role="slider"
          tabIndex={0}
          aria-valuemin={MIN_VALUE}
          aria-valuemax={MAX_VALUE}
          aria-valuenow={Math.round(value)}
          aria-valuetext={`${Math.round(value)}`}
          data-dragging={dragging}
          data-coasting={coasting}
          data-settling={settling}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
          style={{ "--d2v2-angle": `${angleForValue(value)}deg` }}
        >
          <span
            className="d2v2__knob-mark"
            style={{
              "--d2v2-mark-bend": `${markTension.bend}deg`,
              "--d2v2-mark-stretch": markTension.stretch,
            }}
          />
        </div>
      </div>

      <output
        htmlFor="detent-v2-v2-knob"
        className="d2v2__readout text-title-lg tabular-nums"
        data-live={dragging || coasting}
      >
        {PLACES.map((place) => (
          <span className="d2v2__digit" key={place} style={{ "--d2v2-offset": value / place }}>
            <span className="d2v2__digit-strip">
              {digitStrip(place).map((digit, index) => (
                <span className="d2v2__digit-cell" key={index}>{digit}</span>
              ))}
            </span>
          </span>
        ))}
      </output>
    </main>
  );
}
