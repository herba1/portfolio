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
//   down    : pointer is pressed
//   didDrag : pointer moved far enough to count as a drag (suppresses tap)
//   hovering: pointer is over the canvas
//   pointer : pointer position in world space relative to centre {x,y}
//   tap     : {x,y} client coords of a click, set on release, consumed in loop
// ---------------------------------------------------------------------------
export function useGridInput(configRef) {
  const { gl, size } = useThree();

  const offset = useRef({ x: 0, y: 0 });
  const vel = useRef({ x: 0, y: 0 });
  const pending = useRef({ x: 0, y: 0 });
  const down = useRef(false);
  const didDrag = useRef(false);
  const hovering = useRef(false);
  const pointer = useRef({ x: 0, y: 0 });
  const tap = useRef(null);

  const last = useRef({ x: 0, y: 0 });
  const start = useRef({ x: 0, y: 0 });
  const dragDist = useRef(0);
  const coarse = useRef(false); // this gesture came from a finger, not a mouse
  const rect = useRef(null);

  useEffect(() => {
    const el = gl.domElement;
    const refreshRect = () => (rect.current = el.getBoundingClientRect());
    refreshRect();

    const toWorld = (cx, cy) => {
      const r = rect.current;
      return { x: cx - r.left - r.width / 2, y: -(cy - r.top - r.height / 2) };
    };

    const onDown = (e) => {
      refreshRect();
      down.current = true;
      didDrag.current = false;
      dragDist.current = 0;
      coarse.current = e.pointerType !== "mouse";
      last.current = { x: e.clientX, y: e.clientY };
      start.current = { x: e.clientX, y: e.clientY };
      // Seed the pointer here, not just on move. A touch tap that holds still
      // fires NO pointermove at all, so without this the grid would still be
      // reading wherever the last pointer happened to be (or the origin).
      const w = toWorld(e.clientX, e.clientY);
      pointer.current.x = w.x;
      pointer.current.y = w.y;
      hovering.current = true;
      vel.current.x = 0; // grabbing kills any glide
      vel.current.y = 0;
      try { el.setPointerCapture(e.pointerId); } catch {}
    };

    const onMove = (e) => {
      const r = rect.current;
      if (r) {
        hovering.current =
          e.clientX >= r.left && e.clientX <= r.right &&
          e.clientY >= r.top && e.clientY <= r.bottom;
        const w = toWorld(e.clientX, e.clientY);
        pointer.current.x = w.x;
        pointer.current.y = w.y;
      }
      if (!down.current) return;
      const ease = configRef.current.dragEase;
      const dx = e.clientX - last.current.x;
      const dy = e.clientY - last.current.y;
      last.current = { x: e.clientX, y: e.clientY };
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
      down.current = false;
      didDrag.current = false;
      hovering.current = false;
      pending.current.x = 0;
      pending.current.y = 0;
    };

    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const g = configRef.current.wheelStrength;
      if (e.shiftKey) {
        vel.current.x += -e.deltaY * g;
      } else {
        vel.current.x += -e.deltaX * g;
        vel.current.y += e.deltaY * g;
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

  return { offset, vel, pending, down, didDrag, hovering, pointer, tap };
}
