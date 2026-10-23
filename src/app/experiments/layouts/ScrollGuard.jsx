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
//
// Touch never engages a tile on its own. A finger has no wheel to hand over,
// only the swipe itself, and on a phone a vertical swipe is the page's: a tap
// or a sideways drag still reaches the piece, but the next swipe up or down
// scrolls the index, never a stack or a list inside a tile. A piece that
// wants the whole finger gets it through focus: the tile's Focus button hands
// it every gesture, the page holds still around it, and Done, a tap outside,
// Escape or scrolling it away gives the page back.
const PRESS_WINDOW_MS = 900;
// A wheel gesture, trackpad momentum included, arrives as events far closer
// together than this; a longer gap is a new gesture.
const WHEEL_GAP_MS = 220;

export default function ScrollGuard() {
  useEffect(() => {
    const root = document.querySelector(".xl-bento");
    if (!root) return undefined;
    let engaged = null;
    // The wheel may reach the engaged piece until then.
    let wheelUntil = 0;
    let idle = 0;
    let focused = null;

    const tileOf = (target) => (target instanceof Element ? target.closest(".xl-tile") : null);
    const release = () => {
      clearTimeout(idle);
      if (engaged) {
        delete engaged.dataset.engaged;
        if (engaged !== focused) offscreen.unobserve(engaged);
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

    const unfocus = () => {
      if (!focused) return;
      delete focused.dataset.focused;
      focused.querySelector("[data-tile-focus]")?.setAttribute("aria-pressed", "false");
      if (focused !== engaged) offscreen.unobserve(focused);
      focused = null;
    };
    const focus = (tile) => {
      unfocus();
      focused = tile;
      tile.dataset.focused = "";
      tile.querySelector("[data-tile-focus]")?.setAttribute("aria-pressed", "true");
      offscreen.observe(tile);
    };
    const onClick = (event) => {
      const button = event.target instanceof Element ? event.target.closest("[data-tile-focus]") : null;
      if (!button) return;
      const tile = tileOf(button);
      if (tile === focused) unfocus();
      else focus(tile);
    };
    const onKey = (event) => {
      if (event.key === "Escape") unfocus();
    };

    const onDown = (event) => {
      // A tile's idle demo (TileDemos) is not a visitor.
      if (!event.isTrusted) return;
      const tile = tileOf(event.target);
      if (focused && tile !== focused) unfocus();
      if (!tile || !root.contains(tile)) {
        release();
        return;
      }
      if (event.pointerType === "touch") {
        release();
        return;
      }
      engage(tile, PRESS_WINDOW_MS + WHEEL_GAP_MS);
      wheelUntil = performance.now() + PRESS_WINDOW_MS;
    };
    const onMove = (event) => {
      if (!event.isTrusted) return;
      // A drag in progress keeps its tile in hand.
      if (engaged && event.buttons && engaged.contains(event.target)) {
        engage(engaged, PRESS_WINDOW_MS + WHEEL_GAP_MS);
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
    const offscreen = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) continue;
        if (entry.target === engaged) release();
        if (entry.target === focused) unfocus();
      }
    });

    // Capture, and on the window for the press, so it lands before any piece
    // can stop it.
    window.addEventListener("pointerdown", onDown, { capture: true, passive: true });
    root.addEventListener("pointermove", onMove, { capture: true, passive: true });
    root.addEventListener("wheel", onWheel, { capture: true, passive: true });
    root.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      release();
      unfocus();
      offscreen.disconnect();
      window.removeEventListener("pointerdown", onDown, { capture: true });
      root.removeEventListener("pointermove", onMove, { capture: true });
      root.removeEventListener("wheel", onWheel, { capture: true });
      root.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return null;
}
