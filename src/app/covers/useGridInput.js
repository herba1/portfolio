"use client";

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";

// ---------------------------------------------------------------------------
// Pointer drag + inertial wheel + momentum input for the infinite grid.
//
// Returns a bag of refs (read every frame by CoversGrid). World space is
// 1 unit = 1px, so a pointer delta IS a world delta — no conversion needed.
//   offset  : current pan of the whole grid {x,y}
//   vel     : pan velocity in px/s {x,y}
//   pending : drag delta accumulated since the last frame (consumed in loop)
//   wheel   : wheel distance since the last frame, in px of pan (spent whole)
//   down    : pointer is pressed
//   didDrag : pointer moved far enough to count as a drag (suppresses tap)
//   hovering: pointer is over the canvas
//   pointer : pointer position in world space relative to centre {x,y}
//   tap     : {x,y} client coords of a click, set on release, consumed in loop
//   cancelled: the last gesture was yanked by the system, not released
// ---------------------------------------------------------------------------
export function useGridInput(configRef) {
  const { gl, size } = useThree();

  const offset = useRef({ x: 0, y: 0 });
  const vel = useRef({ x: 0, y: 0 });
  const pending = useRef({ x: 0, y: 0 });
  const wheel = useRef({ x: 0, y: 0 });
  const down = useRef(false);
  const didDrag = useRef(false);
  const hovering = useRef(false);
  const pointer = useRef({ x: 0, y: 0 });
  const tap = useRef(null);

  const cancelled = useRef(false); // the last gesture was yanked, not released

  const last = useRef({ x: 0, y: 0 });
  const start = useRef({ x: 0, y: 0 });
  const activeId = useRef(null); // pointerId that owns the gesture (touch: one finger)
  const dragDist = useRef(0);
  const coarse = useRef(false); // this gesture came from a finger, not a mouse
  const rect = useRef(null);

  useEffect(() => {
    const el = gl.domElement;
    const refreshRect = () => (rect.current = el.getBoundingClientRect());
    refreshRect();

    // Writes straight into `pointer` rather than returning a fresh {x,y}. A
    // finger on a 120Hz screen fires moves twice as often as frames render, and
    // every object allocated in that path is garbage the collector eventually
    // stops the world to sweep — which lands as a stutter mid-drag.
    const toWorld = (cx, cy) => {
      const r = rect.current;
      if (!r) return;
      pointer.current.x = cx - r.left - r.width / 2;
      pointer.current.y = -(cy - r.top - r.height / 2);
    };

    const onDown = (e) => {
      // ONE pointer owns the gesture. A second finger landing used to re-seed
      // `last`/`start` and carry the drag on from there — so the grid jumped by
      // the distance between the two fingers, and every subsequent move was read
      // against whichever finger had moved most recently. On a phone that's the
      // whole "it jerks for no reason" feeling; on a mouse it never came up.
      // …but only while that gesture is actually live. Guarding on `down` too
      // means a pointerup that never arrived (capture lost, tab switch) can't
      // leave a stale id locking the grid out of every gesture after it.
      if (activeId.current !== null && down.current) return;
      activeId.current = e.pointerId;
      cancelled.current = false;
      refreshRect();
      down.current = true;
      // Whatever the last gesture left un-consumed is dead weight — applying it
      // now would nudge the grid before the finger has moved at all.
      pending.current.x = 0;
      pending.current.y = 0;
      didDrag.current = false;
      dragDist.current = 0;
      coarse.current = e.pointerType !== "mouse";
      last.current.x = e.clientX;
      last.current.y = e.clientY;
      start.current.x = e.clientX;
      start.current.y = e.clientY;
      // Seed the pointer here, not just on move. A touch tap that holds still
      // fires NO pointermove at all, so without this the grid would still be
      // reading wherever the last pointer happened to be (or the origin).
      toWorld(e.clientX, e.clientY);
      hovering.current = true;
      vel.current.x = 0; // grabbing kills any glide…
      vel.current.y = 0;
      wheel.current.x = 0; // …and any wheel distance still draining
      wheel.current.y = 0;
      try { el.setPointerCapture(e.pointerId); } catch {}
    };

    const onMove = (e) => {
      const r = rect.current;
      if (r) {
        hovering.current =
          e.clientX >= r.left && e.clientX <= r.right &&
          e.clientY >= r.top && e.clientY <= r.bottom;
        toWorld(e.clientX, e.clientY);
      }
      if (!down.current || e.pointerId !== activeId.current) return;
      const ease = configRef.current.dragEase;
      const dx = e.clientX - last.current.x;
      const dy = e.clientY - last.current.y;
      last.current.x = e.clientX;
      last.current.y = e.clientY;
      pending.current.x += dx * ease;
      pending.current.y += -dy * ease; // screen-down → world-down
      // Tap-vs-drag: judge by NET displacement from where the finger landed,
      // not by accumulated path length. A finger resting on glass wobbles a few
      // px in every direction — that racks up path length without ever leaving
      // the tile, and used to get misread as a drag (tap swallowed). The path
      // total is kept only as a loose guard so a drag-out-and-back still counts.
      dragDist.current += Math.hypot(dx, dy);
      const slop = coarse.current ? 12 : 6; // fingers are blunter than cursors
      const net = Math.hypot(
        e.clientX - start.current.x,
        e.clientY - start.current.y,
      );
      if (net > slop || dragDist.current > slop * 4) didDrag.current = true;
    };

    const onUp = (e) => {
      // a stray finger lifting doesn't end the gesture the other one is driving
      if (activeId.current !== null && e.pointerId !== activeId.current) return;
      activeId.current = null;
      if (down.current && !didDrag.current) {
        tap.current = { x: e.clientX, y: e.clientY, coarse: coarse.current };
      }
      down.current = false;
      // A finger leaves no cursor behind — drop hover so the tile it released
      // over doesn't keep the hover bump (and steal the next tap's hit-test).
      if (coarse.current) hovering.current = false;
      try { el.releasePointerCapture(e.pointerId); } catch {}
    };

    // The browser can yank a gesture away mid-drag (system edge-swipe, a second
    // finger, the page scrolling). No pointerup follows, so without this the
    // grid stays stuck "down" — pan freezes and the next tap is eaten.
    const onCancel = () => {
      activeId.current = null;
      // A gesture the system took away never "let go", so it must not throw the
      // grid: the last measured speed is real, but the intent behind it isn't.
      cancelled.current = true;
      down.current = false;
      didDrag.current = false;
      hovering.current = false;
      pending.current.x = 0;
      pending.current.y = 0;
      wheel.current.x = 0;
      wheel.current.y = 0;
    };

    // A wheel delta is PAN DISTANCE. It accumulates here between frames and the
    // loop spends the whole lot on the next one — no cap on how much may arrive,
    // and nothing left over to drain late. 1:1 with the gesture; the only thing
    // between it and the grid is the pan's single smoothing constant.
    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const g = configRef.current.wheelStrength;
      // Trackpads report pixels; a notched mouse wheel reports lines (or pages).
      // Untranslated, a line-mode wheel moves ~3px per click instead of ~48.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? (rect.current?.height || 800) : 1;
      if (e.shiftKey) {
        wheel.current.x += -e.deltaY * unit * g;
      } else {
        wheel.current.x += -e.deltaX * unit * g;
        wheel.current.y += e.deltaY * unit * g;
      }
    };

    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", refreshRect);
    window.addEventListener("scroll", refreshRect, true);

    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", refreshRect);
      window.removeEventListener("scroll", refreshRect, true);
    };
  }, [gl, configRef]);

  // keep the cached rect honest when the canvas resizes
  useEffect(() => {
    rect.current = gl.domElement.getBoundingClientRect();
  }, [gl, size.width, size.height]);

  return { offset, vel, pending, wheel, down, didDrag, hovering, pointer, tap, cancelled };
}
