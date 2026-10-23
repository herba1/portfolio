"use client";

import { useEffect } from "react";

// The page's scroll belongs to the page. A vertical wheel over a tile scrolls
// the index, not the piece, unless the visitor has just taken that piece in
// hand: a wheel that starts within a moment of a press inside the tile goes
// to the piece, and keeps going to it for as long as it flows unbroken. A
// pause, or a wheel that comes later, is the page's again. Until a tile is
// engaged the guard stops the wheel before any piece's listener sees it
// (nothing is prevented, so the browser scrolls the page), the tile's inner
// scrollers are held still (layouts.css), and touch only pans the page. A
// horizontal swipe or a pinch is never a page scroll, so it always reaches
// the piece.
const PRESS_WINDOW_MS = 900;
// A wheel gesture, trackpad momentum included, arrives as events far closer
// together than this; a longer gap is a new gesture.
const WHEEL_GAP_MS = 220;
// A finger cannot wheel, so a tap engages the tile for its next touches,
// until the visitor leaves it alone this long.
const TOUCH_IDLE_MS = 3000;

export default function ScrollGuard() {
  useEffect(() => {
    const root = document.querySelector(".xl-bento");
    if (!root) return undefined;
    let engaged = null;
    // The wheel may reach the engaged piece until then.
    let wheelUntil = 0;
    let idle = 0;

    const tileOf = (target) => (target instanceof Element ? target.closest(".xl-tile") : null);
    const release = () => {
      clearTimeout(idle);
      if (engaged) {
        delete engaged.dataset.engaged;
        offscreen.unobserve(engaged);
      }
      engaged = null;
      wheelUntil = 0;
    };
    const engage = (tile, ms) => {
      if (engaged !== tile) {
        release();
        engaged = tile;
        tile.dataset.engaged = "";
        offscreen.observe(tile);
      }
      clearTimeout(idle);
      idle = setTimeout(release, ms);
    };

    const onDown = (event) => {
      const tile = tileOf(event.target);
      if (!tile || !root.contains(tile)) {
        release();
        return;
      }
      // A touch engages only once it ends as a tap (below): engaging on the
      // press would hand the swipe it starts to the piece's own scroller.
      if (event.pointerType === "touch") {
        if (tile !== engaged) release();
        else engage(tile, TOUCH_IDLE_MS);
        return;
      }
      engage(tile, PRESS_WINDOW_MS + WHEEL_GAP_MS);
      wheelUntil = performance.now() + PRESS_WINDOW_MS;
    };
    const onUp = (event) => {
      if (event.pointerType !== "touch") return;
      const tile = tileOf(event.target);
      if (tile && root.contains(tile)) engage(tile, TOUCH_IDLE_MS);
    };
    const onMove = (event) => {
      // A drag in progress keeps its tile in hand.
      if (engaged && event.buttons && engaged.contains(event.target)) {
        engage(engaged, event.pointerType === "touch" ? TOUCH_IDLE_MS : PRESS_WINDOW_MS + WHEEL_GAP_MS);
        wheelUntil = performance.now() + PRESS_WINDOW_MS;
      }
    };
    const onWheel = (event) => {
      const tile = tileOf(event.target);
      if (!tile) return;
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const now = performance.now();
      if (tile === engaged && now <= wheelUntil) {
        wheelUntil = now + WHEEL_GAP_MS;
        engage(tile, WHEEL_GAP_MS);
        return;
      }
      if (tile === engaged) release();
      event.stopPropagation();
    };
    const offscreen = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting && entry.target === engaged) release();
    });

    // Capture, and on the window for the press, so it lands before any piece
    // can stop it.
    window.addEventListener("pointerdown", onDown, { capture: true, passive: true });
    window.addEventListener("pointerup", onUp, { capture: true, passive: true });
    root.addEventListener("pointermove", onMove, { capture: true, passive: true });
    root.addEventListener("wheel", onWheel, { capture: true, passive: true });
    return () => {
      release();
      offscreen.disconnect();
      window.removeEventListener("pointerdown", onDown, { capture: true });
      window.removeEventListener("pointerup", onUp, { capture: true });
      root.removeEventListener("pointermove", onMove, { capture: true });
      root.removeEventListener("wheel", onWheel, { capture: true });
    };
  }, []);
  return null;
}
