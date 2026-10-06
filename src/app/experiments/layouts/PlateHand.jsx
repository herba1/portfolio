"use client";

import { useEffect, useRef } from "react";

const SIZE = 30;
const RENDER_SCALE = 4;
const LEAN_DEG_PER_PX = 3.2;
const MAX_LEAN_DEG = 42;
const VELOCITY_SMOOTHING = 0.55;
const FRAME_MS = 16;
const REST_RX_DEG = 14;
const REST_RY_DEG = -10;
const SETTLE_AFTER_MS = 90;
const DEFAULT_HINT = "Click to change";
const HINT_AFTER_MS = 1000;
const HINT_AFTER_CLICK_MS = 2600;
const HINT_EVERY_MS = 2400;
const HINT_JITTER_PX = 5;
const TIP_X = (7 / 24) * SIZE;
const TIP_Y = (2 / 24) * SIZE;

const HAND_SILHOUETTE =
  "M6 14V4a2 2 0 0 1 4 0v5a2 2 0 0 1 4 0v1a2 2 0 0 1 4 0v1a2 2 0 0 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15z";
const HAND_LINES = ["M10 9v3.4", "M14 10v2.4", "M18 11v2"];

function restart(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

export default function PlateHand() {
  const handRef = useRef(null);
  const ringRef = useRef(null);

  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return undefined;
    const hand = handRef.current;
    const tilt = hand.querySelector(".xl-hand__tilt");
    const spin = hand.querySelector(".xl-hand__spin");
    const stage = hand.querySelector(".xl-hand__stage");
    const ring = ringRef.current;
    const chip = hand.querySelector(".xl-hand__chip");
    const last = { x: 0, y: 0, t: 0, placed: false };
    const velocity = { x: 0, y: 0 };
    const pin = { on: false, x: 0, y: 0 };
    let visible = false;
    let settle = 0;
    let hintDelay = 0;
    let hintLoop = 0;
    const anchor = { x: 0, y: 0 };

    const stopHint = () => {
      clearTimeout(hintDelay);
      clearInterval(hintLoop);
      hintDelay = 0;
      hand.dataset.hint = "false";
    };
    const playHint = () => {
      restart(stage, "xl-hand__stage--nudge");
      restart(ring, "xl-hand__ring--go");
    };
    const armHint = (x, y, delay = HINT_AFTER_MS) => {
      stopHint();
      if (!visible) return;
      anchor.x = x;
      anchor.y = y;
      hintDelay = setTimeout(() => {
        hand.dataset.hint = "true";
        playHint();
        hintLoop = setInterval(playHint, HINT_EVERY_MS);
      }, delay);
    };

    const lean = (value) => Math.max(-MAX_LEAN_DEG, Math.min(MAX_LEAN_DEG, value * LEAN_DEG_PER_PX));
    const setLean = (dx, dy) => {
      tilt.style.setProperty("--rx", `${(REST_RX_DEG - lean(dy)).toFixed(1)}deg`);
      tilt.style.setProperty("--ry", `${(REST_RY_DEG + lean(dx)).toFixed(1)}deg`);
      tilt.style.setProperty("--rz", `${(lean(dx) * 0.55).toFixed(1)}deg`);
    };

    const show = (on) => {
      if (on === visible) return;
      visible = on;
      hand.dataset.visible = on ? "true" : "false";
      if (!on) {
        last.placed = false;
        stopHint();
      }
    };

    const onMove = (event) => {
      const plate = event.target instanceof Element ? event.target.closest(".xl-tile [data-plate]") : null;
      if (!plate) {
        show(false);
        return;
      }
      const x = event.clientX;
      const y = event.clientY;
      if (!pin.on) {
        hand.style.transform = `translate3d(${x - TIP_X}px, ${y - TIP_Y}px, 0)`;
        ring.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
      show(true);
      const hint = plate.dataset.plateHint || DEFAULT_HINT;
      if (chip.textContent !== hint) chip.textContent = hint;
      if (last.placed) {
        const dt = Math.max(4, event.timeStamp - last.t);
        const pinned = Boolean(document.pointerLockElement);
        const stepX = pinned ? event.movementX : x - last.x;
        const stepY = pinned ? event.movementY : y - last.y;
        const perFrameX = (stepX / dt) * FRAME_MS;
        const perFrameY = (stepY / dt) * FRAME_MS;
        velocity.x += (perFrameX - velocity.x) * VELOCITY_SMOOTHING;
        velocity.y += (perFrameY - velocity.y) * VELOCITY_SMOOTHING;
        setLean(velocity.x, velocity.y);
      } else {
        velocity.x = 0;
        velocity.y = 0;
      }
      last.x = x;
      last.y = y;
      last.t = event.timeStamp;
      last.placed = true;
      clearTimeout(settle);
      settle = setTimeout(() => {
        velocity.x = 0;
        velocity.y = 0;
        setLean(0, 0);
      }, SETTLE_AFTER_MS);
      if (Math.hypot(x - anchor.x, y - anchor.y) > HINT_JITTER_PX || !hintDelay) armHint(x, y);
    };
    const onDown = (event) => {
      if (!visible) return;
      const plate = event.target instanceof Element ? event.target.closest(".xl-tile [data-plate]") : null;
      pin.on = Boolean(plate && plate.hasAttribute("data-plate-drag"));
      pin.x = event.clientX;
      pin.y = event.clientY;
      hand.dataset.pinned = pin.on ? "true" : "false";
      hand.dataset.pressed = "true";
      armHint(last.x, last.y, HINT_AFTER_CLICK_MS);
      restart(ring, "xl-hand__ring--go");
      restart(spin, "xl-hand__spin--go");
    };
    const onUp = (event) => {
      hand.dataset.pressed = "false";
      if (!pin.on) return;
      pin.on = false;
      hand.dataset.pinned = "false";
      hand.style.transform = `translate3d(${event.clientX - TIP_X}px, ${event.clientY - TIP_Y}px, 0)`;
      ring.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
    };
    const onLeave = () => show(false);

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerdown", onDown, { passive: true });
    document.addEventListener("pointerup", onUp, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      stopHint();
      clearTimeout(settle);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <>
      <span ref={ringRef} className="xl-hand__ring" aria-hidden="true">
        <i />
      </span>
      <span ref={handRef} className="xl-hand" data-visible="false" data-pressed="false" data-hint="false" aria-hidden="true">
        <span className="xl-hand__chip">Click to change</span>
        <span className="xl-hand__stage">
          <span className="xl-hand__tilt">
            <span className="xl-hand__spin">
              <svg
                width={SIZE * RENDER_SCALE}
                height={SIZE * RENDER_SCALE}
                viewBox="0 0 24 24"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={HAND_SILHOUETTE} fill="#fff" stroke="none" />
                <g stroke="#111214" strokeWidth="1.6" fill="none">
                  <path d={HAND_SILHOUETTE} />
                  {HAND_LINES.map((d) => (
                    <path key={d} d={d} />
                  ))}
                </g>
              </svg>
            </span>
          </span>
        </span>
      </span>
    </>
  );
}
