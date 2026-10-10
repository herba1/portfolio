"use client";

import { useEffect, useRef } from "react";

import { createScorchEngine } from "./scorchEngine";
import { createScorchGhost } from "./scorchGhost";
import { BLEED, FLAME, SCORCH_DEFAULTS } from "./scorchParams";
import { createCrackle } from "./scorchSound";

const KEY_HOLD_MS = 320;
const RING_COUNT = 2;
const SETTLE_MS = 90;
const CURSOR_BASE = 24;
const CURSOR_STRETCH = 34;
const KEY_SOURCE_MS = 600;
const MIN_PLATE_PX = 48;
const TOUCH_ARM_MS = 160;
const TOUCH_SLOP = 8;
const PAGE_LABEL =
  "Photographic print. Press and drag across it to burn it, or press Enter to light its darkest part. Escape douses the fire and the right arrow key brings the next print.";
const TILE_LABEL = "Photographic print. Press and drag across it to burn it, or press Enter to light its darkest part.";

const RING_SLOTS = Array.from({ length: RING_COUNT }, (_, index) => index);
const CANVAS_WIDTH = 1 + BLEED.left + BLEED.right;
const CANVAS_HEIGHT = 1 + BLEED.top + BLEED.bottom;

function restartState(node, state) {
  node.dataset.state = "idle";
  void node.offsetWidth;
  node.dataset.state = state;
}

function isTypingTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function percent(value) {
  return `${(value * 100).toFixed(4)}%`;
}

export default function ScorchStage({ sheets, embedded = false, reducedMotion = false, onReady, onError }) {
  const plateRef = useRef(null);
  const engineRef = useRef(null);
  const soundRef = useRef(null);
  const ghostRef = useRef(null);
  const callbacksRef = useRef({ onReady, onError });
  const reducedRef = useRef(reducedMotion);
  const igniteRef = useRef(null);

  useEffect(() => {
    callbacksRef.current = { onReady, onError };
  }, [onReady, onError]);

  useEffect(() => {
    reducedRef.current = reducedMotion;
    ghostRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    const sound = createCrackle();
    soundRef.current = sound;
    return () => {
      sound.dispose();
      soundRef.current = null;
    };
  }, []);

  useEffect(() => {
    const plate = plateRef.current;
    if (!plate) return undefined;
    const canvas = document.createElement("canvas");
    canvas.className = "scorch-plate__canvas";
    canvas.style.left = percent(-BLEED.left);
    canvas.style.top = percent(-BLEED.top);
    canvas.style.width = percent(CANVAS_WIDTH);
    canvas.style.height = percent(CANVAS_HEIGHT);
    canvas.style.transformOrigin = `50% ${percent((BLEED.top + 0.5) / CANVAS_HEIGHT)}`;
    plate.prepend(canvas);
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const gridSize = embedded || coarse || plate.clientWidth < 560 ? 256 : 384;
    const engine = createScorchEngine(canvas, {
      sheets,
      gridSize,
      dprCap: embedded ? 1.5 : 2,
      reducedMotion: reducedRef.current,
      onSheet: () => ghostRef.current?.sheet(),
      onBurnt: () => {},
      onReady: () => {
        plate.dataset.ready = "1";
        callbacksRef.current.onReady?.();
      },
      onError: (reason) => callbacksRef.current.onError?.(reason),
      onActivity: (level) => soundRef.current?.setLevel(level),
      onIgnite: (id) => igniteRef.current?.(id),
      onBreak: (strength) => soundRef.current?.catchFire(strength),
    });
    if (!engine) {
      canvas.remove();
      return undefined;
    }
    engineRef.current = engine;
    engine.setParams(SCORCH_DEFAULTS);
    engine.resize(plate.clientWidth, plate.clientHeight);
    const ghost = createScorchGhost({ engine, host: plate, keyTarget: embedded ? plate : window, reducedMotion: reducedRef.current });
    ghostRef.current = ghost;

    let onScreen = true;
    const sync = () => {
      const showing = onScreen && !document.hidden && plate.clientWidth > MIN_PLATE_PX;
      engine.setVisible(showing);
      ghost.setActive(showing);
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
      ghost.dispose();
      if (ghostRef.current === ghost) ghostRef.current = null;
      engine.dispose();
      engineRef.current = null;
      canvas.remove();
      delete plate.dataset.ready;
    };
  }, [sheets, embedded]);

  useEffect(() => {
    const plate = plateRef.current;
    if (!plate) return undefined;
    const rings = Array.from(plate.querySelectorAll(".scorch-ring"));
    const cursor = plate.querySelector(".scorch-cursor");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const pointers = new Map();
    const pending = new Map();
    const liveKeys = new Set();
    const ringOwners = new Map();
    const timers = new Set();
    let rect = plate.getBoundingClientRect();
    let rectStale = false;
    let hover = { x: 0, y: 0, t: 0 };
    let settleTimer = 0;
    let keyCount = 0;
    let pressCount = 0;

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

    const anyPressed = () => {
      for (const pointer of pointers.values()) if (pointer.pressed) return true;
      return false;
    };

    const syncPressed = () => {
      if (anyPressed()) plate.dataset.pressed = "1";
      else delete plate.dataset.pressed;
    };

    const pointerFor = (event, x, y) => {
      let pointer = pointers.get(event.pointerId);
      if (!pointer) {
        pointer = {
          pointerId: event.pointerId,
          mouse: event.pointerType === "mouse",
          flameId: null,
          x,
          y,
          t: event.timeStamp,
          vx: 0,
          vy: 0,
          pressed: false,
          stillTimer: 0,
          armTimer: 0,
          armX: x,
          armY: y,
        };
        pointers.set(event.pointerId, pointer);
      }
      return pointer;
    };

    const feed = (pointer) => {
      if (!pointer.pressed) return;
      const [u, v] = toUv(pointer.x, pointer.y);
      engineRef.current?.flame(pointer.flameId, u, v);
    };

    const press = (pointer) => {
      pressCount += 1;
      pointer.flameId = `f${pointer.pointerId}-${pressCount}`;
      pointer.pressed = true;
      syncPressed();
      feed(pointer);
    };

    const disarm = (pointer) => {
      cancelLater(pointer.armTimer);
      pointer.armTimer = 0;
    };

    const arm = (pointer, x, y) => {
      disarm(pointer);
      pointer.armX = x;
      pointer.armY = y;
      pointer.armTimer = later(() => {
        pointer.armTimer = 0;
        if (pointers.get(pointer.pointerId) === pointer) press(pointer);
      }, TOUCH_ARM_MS);
    };

    const lift = (pointer) => {
      if (!pointer.pressed) return;
      pointer.pressed = false;
      engineRef.current?.flameOut(pointer.flameId);
      pointer.flameId = null;
      syncPressed();
    };

    const fan = (pointer) => {
      const [u, v] = toUv(pointer.x, pointer.y);
      const scale = pointer.pressed ? 1 : FLAME.windHover;
      engineRef.current?.blow(u, v, pointer.vx * scale, pointer.vy * scale);
      cancelLater(pointer.stillTimer);
      pointer.stillTimer = later(() => {
        pointer.stillTimer = 0;
        pointer.vx = 0;
        pointer.vy = 0;
        if (pointers.get(pointer.pointerId) === pointer) engineRef.current?.blow(u, v, 0, 0);
      }, SETTLE_MS);
    };

    const endPointer = (pointer) => {
      if (pointers.get(pointer.pointerId) !== pointer) return;
      disarm(pointer);
      lift(pointer);
      pointers.delete(pointer.pointerId);
      cancelLater(pointer.stillTimer);
      pointer.stillTimer = 0;
      if (!pointers.size) engineRef.current?.calm();
      if (plate.hasPointerCapture?.(pointer.pointerId)) plate.releasePointerCapture(pointer.pointerId);
    };

    const movePointer = (pointer, x, y, timeStamp) => {
      const elapsed = Math.max(4, timeStamp - pointer.t);
      const instantX = ((x - pointer.x) / Math.max(1, rect.width)) * (1000 / elapsed);
      const instantY = (-(y - pointer.y) / Math.max(1, rect.height)) * (1000 / elapsed);
      pointer.vx += (instantX - pointer.vx) * 0.5;
      pointer.vy += (instantY - pointer.vy) * 0.5;
      pointer.x = x;
      pointer.y = y;
      pointer.t = timeStamp;
    };

    const insidePlate = (x, y) => x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;

    const capture = (pointerId) => {
      try {
        plate.setPointerCapture(pointerId);
      } catch {
        rect = plate.getBoundingClientRect();
      }
    };

    const handleDown = (event) => {
      if (event.button !== undefined && event.button > 0) return;
      wakeSound();
      rect = plate.getBoundingClientRect();
      rectStale = false;
      capture(event.pointerId);
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const pointer = pointerFor(event, x, y);
      lift(pointer);
      movePointer(pointer, x, y, event.timeStamp);
      if (embedded && event.pointerType !== "mouse") {
        arm(pointer, x, y);
        return;
      }
      press(pointer);
    };

    const handleMove = (event) => {
      freshRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const mouse = event.pointerType === "mouse";
      if (mouse && finePointer) trackCursor(x, y, event.timeStamp);
      let pointer = pointers.get(event.pointerId);
      if (!pointer) {
        if (!mouse || !insidePlate(x, y)) return;
        pointer = pointerFor(event, x, y);
      }
      movePointer(pointer, x, y, event.timeStamp);
      if (pointer.armTimer) {
        const dx = x - pointer.armX;
        const dy = y - pointer.armY;
        if (Math.abs(dx) <= TOUCH_SLOP || Math.abs(dx) <= Math.abs(dy)) return;
        disarm(pointer);
        press(pointer);
      }
      if (mouse) {
        const buttonDown = (event.buttons & 1) === 1;
        if (pointer.pressed && !buttonDown) lift(pointer);
        else if (!pointer.pressed && buttonDown && insidePlate(x, y)) {
          wakeSound();
          capture(event.pointerId);
          press(pointer);
        }
      }
      feed(pointer);
      fan(pointer);
    };

    const handleUp = (event) => {
      const pointer = pointers.get(event.pointerId);
      if (!pointer) return;
      if (pointer.armTimer) {
        disarm(pointer);
        if (event.type === "pointerup") press(pointer);
      }
      wakeSound();
      freshRect();
      const releasedOutside =
        event.type === "pointerup" && !insidePlate(event.clientX - rect.left, event.clientY - rect.top);
      if (pointer.mouse && event.type !== "pointercancel" && !releasedOutside) {
        lift(pointer);
        return;
      }
      endPointer(pointer);
    };

    const handleBlur = () => {
      for (const pointer of [...pointers.values()]) endPointer(pointer);
    };

    const handleEnter = (event) => {
      if (event.pointerType !== "mouse") return;
      rect = plate.getBoundingClientRect();
      rectStale = false;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (finePointer) {
        hover = { x, y, t: event.timeStamp };
        placeCursor(x, y, Number(cursor?.dataset.angle ?? 0), 0);
        plate.dataset.hover = "1";
      }
      const pointer = pointerFor(event, x, y);
      movePointer(pointer, x, y, event.timeStamp);
    };

    const handleLeave = (event) => {
      if (event.pointerType !== "mouse") return;
      delete plate.dataset.hover;
      const pointer = pointers.get(event.pointerId);
      if (pointer && !(pointer.pressed && plate.hasPointerCapture?.(pointer.pointerId))) endPointer(pointer);
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
      const burnBriefly = () => {
        dropRing(ring, "caught");
        soundRef.current?.catchFire();
        if (typeof navigator.vibrate === "function") navigator.vibrate(8);
        later(() => {
          liveKeys.delete(id);
          engineRef.current?.release(id);
        }, KEY_SOURCE_MS);
      };
      later(() => {
        const result = engineRef.current?.ignite(id, spot.u, spot.v);
        if (!result) {
          dropRing(ring, "cancel");
          return;
        }
        liveKeys.add(id);
        if (result === "lit") {
          burnBriefly();
          return;
        }
        pending.set(id, { light: burnBriefly, drop: () => dropRing(ring, "cancel") });
      }, KEY_HOLD_MS);
    };

    const handleIgnite = (id) => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      entry.light();
    };
    igniteRef.current = handleIgnite;

    const douseAll = () => {
      const engine = engineRef.current;
      if (!engine) return;
      engine.douse();
      for (const entry of pending.values()) entry.drop();
      pending.clear();
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
        douseAll();
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
    plate.addEventListener("lostpointercapture", handleUp);
    plate.addEventListener("pointerenter", handleEnter);
    plate.addEventListener("pointerleave", handleLeave);
    plate.addEventListener("keydown", handlePlateKey);
    plate.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("scroll", markStale, { passive: true, capture: true });
    window.addEventListener("resize", markStale, { passive: true });
    window.addEventListener("blur", handleBlur);
    if (!embedded) window.addEventListener("keydown", handleWindowKey);

    return () => {
      handleBlur();
      for (const id of liveKeys) engineRef.current?.release(id);
      liveKeys.clear();
      pending.clear();
      if (igniteRef.current === handleIgnite) igniteRef.current = null;
      plate.removeEventListener("pointerdown", handleDown);
      plate.removeEventListener("pointermove", handleMove);
      plate.removeEventListener("pointerup", handleUp);
      plate.removeEventListener("pointercancel", handleUp);
      plate.removeEventListener("lostpointercapture", handleUp);
      plate.removeEventListener("pointerenter", handleEnter);
      plate.removeEventListener("pointerleave", handleLeave);
      plate.removeEventListener("keydown", handlePlateKey);
      plate.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleWindowKey);
      window.removeEventListener("scroll", markStale, { capture: true });
      window.removeEventListener("resize", markStale);
      window.removeEventListener("blur", handleBlur);
      rectObserver.disconnect();
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
      delete plate.dataset.pressed;
      delete plate.dataset.hover;
    };
  }, [embedded]);

  return (
    <div
      ref={plateRef}
      className="scorch-plate"
      tabIndex={0}
      role="button"
      aria-label={embedded ? TILE_LABEL : PAGE_LABEL}
    >
      <div className="scorch-plate__overlay" aria-hidden="true">
        {RING_SLOTS.map((slot) => (
          <div key={slot} className="scorch-ring" data-state="idle">
            <svg viewBox="0 0 56 56" className="scorch-ring__svg">
              <circle cx="28" cy="28" r="20" className="scorch-ring__edge" />
              <circle cx="28" cy="28" r="20" className="scorch-ring__track" />
              <circle cx="28" cy="28" r="20" className="scorch-ring__arc" pathLength="1" />
            </svg>
          </div>
        ))}
        <div className="scorch-cursor">
          <span className="scorch-cursor__body">
            <span className="scorch-cursor__dot" />
          </span>
        </div>
      </div>
    </div>
  );
}
