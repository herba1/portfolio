"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "./rotary.css";
import RotaryOdometer from "./RotaryOdometer";
import {
  DEFAULT_VALUE,
  FRICTION,
  MAX_BEND_DEG,
  MAX_BLUR_PX,
  MAX_VALUE,
  MIN_VALUE,
  STEP,
  TICKS,
  TICK_ACTIVE_RANGE,
  VELOCITY_STOP,
  VELOCITY_TRAIL_NORMALIZER,
  angleForValue,
  clampValue,
  snapValue,
  tickProximity,
  valueForAngle,
} from "./rotaryParams";

function angleFromPointer(clientX, clientY, rect) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = clientX - centerX;
  const dy = clientY - centerY;
  return Math.atan2(dx, -dy) * (180 / Math.PI);
}

export default function DetentV2Experience() {
  const [value, setValue] = useState(DEFAULT_VALUE);
  const [dragging, setDragging] = useState(false);
  const [coasting, setCoasting] = useState(false);
  const [settling, setSettling] = useState(false);
  const [velocity, setVelocity] = useState(0);

  const knobRef = useRef(null);
  const sampleRef = useRef(null);
  const velocityRef = useRef(0);
  const rafRef = useRef(null);

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
    setVelocity(0);
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
      setVelocity(velocityRef.current);

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
      setVelocity(velocityRef.current);
    }
    sampleRef.current = { value: next, time: now };

    setValue(next);
  }, [dragging]);

  const handlePointerUp = useCallback((event) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);

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
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setValue((current) => clampValue(current - STEP));
      setSettling(true);
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

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const litCount = Math.round((value - MIN_VALUE) / STEP);
  const interacting = dragging || coasting;
  const knobAngle = angleForValue(value);
  const speed = Math.min(1, Math.abs(velocity) / VELOCITY_TRAIL_NORMALIZER);
  const trailSign = velocity === 0 ? 0 : Math.sign(velocity);

  return (
    <main className="rotary bg-surface text-ink">
      <header className="rotary__head">
        <h1 className="text-title-sm">Evolve Detent</h1>
        <p className="text-ui text-ink">One knob. Flick it — it keeps spinning.</p>
      </header>

      <div className="rotary__stage">
        <div className="rotary__ticks" aria-hidden="true">
          {TICKS.map((tick) => {
            const proximity = tickProximity(tick, value);
            const scale = 1 + proximity * (interacting ? 0.85 : 0.32);
            const active = Math.abs(tick - value) <= TICK_ACTIVE_RANGE;
            return (
              <span
                key={tick}
                className="rotary__tick"
                data-lit={tick <= value}
                data-active={active}
                style={{
                  "--rotary-tick-angle": `${angleForValue(tick)}deg`,
                  "--rotary-tick-scale": scale,
                }}
              />
            );
          })}
        </div>

        <div
          ref={knobRef}
          id="detent-v2-knob"
          className="rotary__knob"
          role="slider"
          tabIndex={0}
          aria-valuemin={MIN_VALUE}
          aria-valuemax={MAX_VALUE}
          aria-valuenow={value}
          aria-valuetext={`${value}`}
          data-dragging={dragging}
          data-coasting={coasting}
          data-settling={settling}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
        >
          <span
            className="rotary__needle"
            data-settling={settling}
            style={{
              "--rotary-mark-angle": `${knobAngle}deg`,
              "--rotary-mark-bend": `${-trailSign * speed * MAX_BEND_DEG}deg`,
              "--rotary-mark-blur": `${speed * MAX_BLUR_PX}px`,
            }}
          >
            <span className="rotary__knob-mark" />
          </span>
        </div>

        <output htmlFor="detent-v2-knob" className="rotary__value text-title-lg">
          <RotaryOdometer value={value} />
        </output>
      </div>
    </main>
  );
}
