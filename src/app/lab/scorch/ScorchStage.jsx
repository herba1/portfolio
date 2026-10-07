"use client";

import { useEffect, useImperativeHandle, useRef } from "react";

import { createScorchEngine } from "./scorchEngine";
import { createCrackle } from "./scorchSound";

const HOLD_MS = 320;
const SLOP_PX = 6;
const RING_COUNT = 4;
const SETTLE_MS = 90;
const CURSOR_BASE = 24;
const CURSOR_STRETCH = 34;
const KEY_SOURCE_MS = 600;
const MIN_PLATE_PX = 48;

const RING_SLOTS = Array.from({ length: RING_COUNT }, (_, index) => index);

function restartState(node, state) {
  node.dataset.state = "idle";
  void node.offsetWidth;
  node.dataset.state = state;
}

function isTypingTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export default function ScorchStage({
  ref,
  covers,
  params,
  soundOn,
  embedded = false,
  reducedMotion = false,
  onSheet,
  onBurnt,
  onReady,
  onError,
}) {
  const plateRef = useRef(null);
  const engineRef = useRef(null);
  const soundRef = useRef(null);
  const callbacksRef = useRef({ onSheet, onBurnt, onReady, onError });
  const paramsRef = useRef(params);

  useEffect(() => {
    callbacksRef.current = { onSheet, onBurnt, onReady, onError };
  }, [onSheet, onBurnt, onReady, onError]);

  useEffect(() => {
    const sound = createCrackle();
    soundRef.current = sound;
    return () => {
      sound.dispose();
      soundRef.current = null;
    };
  }, []);

  useEffect(() => {
    soundRef.current?.setEnabled(soundOn);
  }, [soundOn]);

  useEffect(() => {
    paramsRef.current = params;
    engineRef.current?.setParams(params);
  }, [params]);

  useEffect(() => {
    const plate = plateRef.current;
    if (!plate) return undefined;
    const canvas = document.createElement("canvas");
    canvas.className = "scorch-plate__canvas";
    plate.prepend(canvas);
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const gridSize = embedded || coarse || plate.clientWidth < 560 ? 256 : 384;
    const engine = createScorchEngine(canvas, {
      covers,
      gridSize,
      dprCap: embedded ? 1.5 : 2,
      reducedMotion,
      onSheet: (index, under) => callbacksRef.current.onSheet?.(index, under),
      onBurnt: (fraction) => callbacksRef.current.onBurnt?.(fraction),
      onReady: () => {
        plate.dataset.ready = "1";
        callbacksRef.current.onReady?.();
      },
      onError: (reason) => callbacksRef.current.onError?.(reason),
      onActivity: (level) => soundRef.current?.setLevel(level),
    });
    if (!engine) {
      canvas.remove();
      return undefined;
    }
    engineRef.current = engine;
    engine.setParams(paramsRef.current);
    engine.resize(plate.clientWidth, plate.clientHeight);

    let onScreen = true;
    const sync = () => {
      const showing = onScreen && !document.hidden && plate.clientWidth > MIN_PLATE_PX;
      engine.setVisible(showing);
      if (!showing) soundRef.current?.setLevel(0);
    };
    const resizeObserver = new ResizeObserver(() => {
      engine.resize(plate.clientWidth, plate.clientHeight);
      sync();
    });
    resizeObserver.observe(plate);
    const intersection = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    });
    intersection.observe(plate);
    document.addEventListener("visibilitychange", sync);

    return () => {
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", sync);
      engine.dispose();
      engineRef.current = null;
      canvas.remove();
      delete plate.dataset.ready;
    };
  }, [covers, embedded, reducedMotion]);

  useEffect(() => {
    const plate = plateRef.current;
    if (!plate) return undefined;
    const rings = Array.from(plate.querySelectorAll(".scorch-ring"));
    const cursor = plate.querySelector(".scorch-cursor");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const pointers = new Map();
    const ringOwners = new Map();
    const timers = new Set();
    let rect = plate.getBoundingClientRect();
    let rectStale = false;
    let hover = { x: 0, y: 0, t: 0 };
    let settleTimer = 0;
    let keyCount = 0;

    const later = (callback, ms) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        callback();
      }, ms);
      timers.add(id);
      return id;
    };
    const cancelLater = (id) => {
      if (!id) return;
      window.clearTimeout(id);
      timers.delete(id);
    };

    const markStale = () => {
      rectStale = true;
    };
    const freshRect = () => {
      if (!rectStale) return;
      rectStale = false;
      rect = plate.getBoundingClientRect();
    };
    const rectObserver = new ResizeObserver(markStale);
    rectObserver.observe(plate);

    const toUv = (x, y) => [x / Math.max(1, rect.width), 1 - y / Math.max(1, rect.height)];

    const takeRing = (owner) => {
      const free = rings.find((ring) => !ringOwners.has(ring) && ring.dataset.state !== "charging") ?? rings.find((ring) => !ringOwners.has(ring));
      if (!free) return null;
      ringOwners.set(free, owner);
      return free;
    };
    const dropRing = (ring, state) => {
      if (!ring) return;
      ringOwners.delete(ring);
      restartState(ring, state);
    };
    const placeRing = (ring, x, y) => {
      ring.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };

    const placeCursor = (x, y, angle, stretch) => {
      if (!cursor) return;
      cursor.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${angle}rad) translate(-50%, -50%)`;
      cursor.style.setProperty("--cursor-length", `${CURSOR_BASE + stretch}px`);
      const engine = engineRef.current;
      if (engine) {
        const [u, v] = toUv(x, y);
        cursor.style.setProperty("--hunger", engine.fuelAt(u, v).toFixed(3));
      }
    };
    const relaxCursor = () => {
      cancelLater(settleTimer);
      settleTimer = later(() => {
        settleTimer = 0;
        cursor?.style.setProperty("--cursor-length", `${CURSOR_BASE}px`);
      }, SETTLE_MS);
    };
    const trackCursor = (x, y, now) => {
      const dx = x - hover.x;
      const dy = y - hover.y;
      const elapsed = Math.max(1, now - hover.t);
      const speed = Math.hypot(dx, dy) / elapsed;
      const angle = speed > 0.05 ? Math.atan2(dy, dx) : Number(cursor?.dataset.angle ?? 0);
      if (cursor) cursor.dataset.angle = String(angle);
      placeCursor(x, y, angle, Math.min(CURSOR_STRETCH, speed * 14));
      hover = { x, y, t: now };
      relaxCursor();
    };

    const wakeSound = () => soundRef.current?.wake();

    const catchFire = (pointer) => {
      pointer.holdTimer = 0;
      if (!pointers.has(pointer.id) || pointer.phase !== "hold") return;
      const [u, v] = toUv(pointer.x, pointer.y);
      const lit = engineRef.current?.ignite(pointer.id, u, v);
      if (!lit) {
        dropRing(pointer.ring, "cancel");
        pointer.ring = null;
        pointer.phase = "spent";
        return;
      }
      pointer.phase = "lit";
      dropRing(pointer.ring, "caught");
      pointer.ring = null;
      soundRef.current?.catchFire();
      if (typeof navigator.vibrate === "function") navigator.vibrate(8);
    };

    const handleDown = (event) => {
      if (event.button !== undefined && event.button > 0) return;
      wakeSound();
      rect = plate.getBoundingClientRect();
      rectStale = false;
      try {
        plate.setPointerCapture(event.pointerId);
      } catch {
        rect = plate.getBoundingClientRect();
      }
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const pointer = {
        id: `p${event.pointerId}`,
        pointerId: event.pointerId,
        startX: x,
        startY: y,
        x,
        y,
        t: event.timeStamp,
        vx: 0,
        vy: 0,
        phase: "hold",
        ring: null,
        holdTimer: 0,
        stillTimer: 0,
      };
      pointers.set(event.pointerId, pointer);
      plate.dataset.pressed = "1";
      pointer.ring = takeRing(pointer.id);
      if (pointer.ring) {
        placeRing(pointer.ring, x, y);
        restartState(pointer.ring, "charging");
      }
      pointer.holdTimer = later(() => catchFire(pointer), HOLD_MS);
    };

    const handleMove = (event) => {
      freshRect();
      const pointer = pointers.get(event.pointerId);
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (!pointer) {
        if (finePointer && event.pointerType === "mouse") trackCursor(x, y, event.timeStamp);
        return;
      }
      const elapsed = Math.max(4, event.timeStamp - pointer.t);
      const instantX = ((x - pointer.x) / Math.max(1, rect.width)) * (1000 / elapsed);
      const instantY = (-(y - pointer.y) / Math.max(1, rect.height)) * (1000 / elapsed);
      pointer.vx += (instantX - pointer.vx) * 0.5;
      pointer.vy += (instantY - pointer.vy) * 0.5;
      pointer.x = x;
      pointer.y = y;
      pointer.t = event.timeStamp;
      if (pointer.phase === "hold" || pointer.phase === "lit" || pointer.phase === "spent") {
        if (Math.hypot(x - pointer.startX, y - pointer.startY) <= SLOP_PX) {
          if (pointer.ring) placeRing(pointer.ring, x, y);
          return;
        }
        cancelLater(pointer.holdTimer);
        pointer.holdTimer = 0;
        if (pointer.ring) {
          dropRing(pointer.ring, "cancel");
          pointer.ring = null;
        }
        if (pointer.phase === "lit") engineRef.current?.release(pointer.id);
        pointer.phase = "drag";
        plate.dataset.dragging = "1";
      }
      if (finePointer && event.pointerType === "mouse") trackCursor(x, y, event.timeStamp);
      const [u, v] = toUv(x, y);
      engineRef.current?.blow(u, v, pointer.vx, pointer.vy);
      cancelLater(pointer.stillTimer);
      pointer.stillTimer = later(() => {
        pointer.stillTimer = 0;
        pointer.vx = 0;
        pointer.vy = 0;
        if (pointers.has(pointer.pointerId)) engineRef.current?.blow(u, v, 0, 0);
      }, SETTLE_MS);
    };

    const handleUp = (event) => {
      const pointer = pointers.get(event.pointerId);
      if (!pointer) return;
      wakeSound();
      pointers.delete(event.pointerId);
      cancelLater(pointer.holdTimer);
      cancelLater(pointer.stillTimer);
      if (pointer.ring) dropRing(pointer.ring, "cancel");
      if (pointer.phase === "lit") engineRef.current?.release(pointer.id);
      if (![...pointers.values()].some((entry) => entry.phase === "drag")) {
        engineRef.current?.calm();
        delete plate.dataset.dragging;
      }
      if (pointers.size === 0) delete plate.dataset.pressed;
      if (plate.hasPointerCapture?.(event.pointerId)) plate.releasePointerCapture(event.pointerId);
    };

    const handleEnter = (event) => {
      if (!finePointer || event.pointerType !== "mouse") return;
      rect = plate.getBoundingClientRect();
      rectStale = false;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      hover = { x, y, t: event.timeStamp };
      placeCursor(x, y, Number(cursor?.dataset.angle ?? 0), 0);
      plate.dataset.hover = "1";
    };
    const handleLeave = (event) => {
      if (event.pointerType !== "mouse") return;
      delete plate.dataset.hover;
    };

    const igniteFromKeyboard = () => {
      const engine = engineRef.current;
      if (!engine?.isReady()) return;
      wakeSound();
      rect = plate.getBoundingClientRect();
      rectStale = false;
      const spot = engine.darkestSpot();
      const x = spot.u * rect.width;
      const y = (1 - spot.v) * rect.height;
      keyCount += 1;
      const id = `key-${keyCount}`;
      const ring = takeRing(id);
      if (ring) {
        placeRing(ring, x, y);
        restartState(ring, "charging");
      }
      later(() => {
        const lit = engineRef.current?.ignite(id, spot.u, spot.v);
        dropRing(ring, lit ? "caught" : "cancel");
        if (!lit) return;
        soundRef.current?.catchFire();
        later(() => engineRef.current?.release(id), KEY_SOURCE_MS);
      }, HOLD_MS);
    };

    const handleContextMenu = (event) => event.preventDefault();

    const handlePlateKey = (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (event.repeat) return;
      igniteFromKeyboard();
    };

    const handleWindowKey = (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        engineRef.current?.douse();
        return;
      }
      if (event.key === "ArrowRight" && !isTypingTarget(event.target)) {
        event.preventDefault();
        engineRef.current?.skip();
      }
    };

    plate.addEventListener("pointerdown", handleDown);
    plate.addEventListener("pointermove", handleMove);
    plate.addEventListener("pointerup", handleUp);
    plate.addEventListener("pointercancel", handleUp);
    plate.addEventListener("pointerenter", handleEnter);
    plate.addEventListener("pointerleave", handleLeave);
    plate.addEventListener("keydown", handlePlateKey);
    plate.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("scroll", markStale, { passive: true, capture: true });
    window.addEventListener("resize", markStale, { passive: true });
    if (!embedded) window.addEventListener("keydown", handleWindowKey);

    return () => {
      plate.removeEventListener("pointerdown", handleDown);
      plate.removeEventListener("pointermove", handleMove);
      plate.removeEventListener("pointerup", handleUp);
      plate.removeEventListener("pointercancel", handleUp);
      plate.removeEventListener("pointerenter", handleEnter);
      plate.removeEventListener("pointerleave", handleLeave);
      plate.removeEventListener("keydown", handlePlateKey);
      plate.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleWindowKey);
      window.removeEventListener("scroll", markStale, { capture: true });
      window.removeEventListener("resize", markStale);
      rectObserver.disconnect();
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
    };
  }, [embedded]);

  useImperativeHandle(
    ref,
    () => ({
      douse: () => engineRef.current?.douse(),
      skip: () => engineRef.current?.skip(),
      wakeSound: () => soundRef.current?.wake(),
    }),
    [],
  );

  return (
    <div
      ref={plateRef}
      className="scorch-plate"
      tabIndex={0}
      role="button"
      aria-label="Album cover. Hold still on it until it catches, or press Enter to light the darkest ink."
    >
      {RING_SLOTS.map((slot) => (
        <div key={slot} className="scorch-ring" data-state="idle" aria-hidden="true">
          <svg viewBox="0 0 56 56" className="scorch-ring__svg">
            <circle cx="28" cy="28" r="20" className="scorch-ring__edge" />
            <circle cx="28" cy="28" r="20" className="scorch-ring__track" />
            <circle cx="28" cy="28" r="20" className="scorch-ring__arc" pathLength="1" />
          </svg>
        </div>
      ))}
      <div className="scorch-cursor" aria-hidden="true">
        <span className="scorch-cursor__body">
          <span className="scorch-cursor__dot" />
        </span>
      </div>
    </div>
  );
}
