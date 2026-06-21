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
  const dragDist = useRef(0);
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
      last.current = { x: e.clientX, y: e.clientY };
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
      dragDist.current += Math.hypot(dx, dy);
      if (dragDist.current > 6) didDrag.current = true;
    };

    const onUp = (e) => {
      if (down.current && !didDrag.current) {
        tap.current = { x: e.clientX, y: e.clientY };
      }
      down.current = false;
      try { el.releasePointerCapture(e.pointerId); } catch {}
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
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", refreshRect);
    window.addEventListener("scroll", refreshRect, true);

    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
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
