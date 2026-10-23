"use client";

import { useEffect } from "react";

// The page's scroll belongs to the page. A vertical wheel over a tile scrolls
// the index, not the piece, unless the visitor has clearly taken that piece
// in hand: pressed inside it, and kept using it since. Until then the guard
// stops the wheel before any piece's listener sees it (nothing is
// prevented, so the browser scrolls the page on the compositor as usual),
// the tile's inner scrollers are held still (layouts.css), and touch only
// pans the page vertically. A horizontal swipe or a pinch is never a page
// scroll, so it always reaches the piece.
const IDLE_MS = 2500;

export default function ScrollGuard() {
  useEffect(() => {
    const root = document.querySelector(".xl-bento");
    if (!root) return undefined;
    let engaged = null;
    let idle = 0;

    const tileOf = (target) => (target instanceof Element ? target.closest(".xl-tile") : null);
    const release = () => {
      clearTimeout(idle);
      if (engaged) delete engaged.dataset.engaged;
      engaged = null;
    };
    const keep = () => {
      clearTimeout(idle);
      idle = setTimeout(release, IDLE_MS);
    };
    const engage = (tile) => {
      if (engaged !== tile) release();
      engaged = tile;
      tile.dataset.engaged = "";
      keep();
    };

    const onDown = (event) => {
      const tile = tileOf(event.target);
      if (tile && root.contains(tile)) engage(tile);
      else release();
    };
    const onMove = (event) => {
      if (engaged && event.buttons && engaged.contains(event.target)) keep();
    };
    const onOut = (event) => {
      // A finger lifting also reads as leaving; only a hovering pointer can
      // walk off a tile.
      if (event.pointerType === "touch" || !engaged) return;
      if (!engaged.contains(event.relatedTarget)) release();
    };
    const onWheel = (event) => {
      const tile = tileOf(event.target);
      if (!tile) return;
      if (tile === engaged) {
        keep();
        return;
      }
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.stopPropagation();
    };
    const offscreen = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting && entry.target === engaged) release();
    });
    const watch = new MutationObserver(() => {
      offscreen.disconnect();
      if (engaged) offscreen.observe(engaged);
    });
    watch.observe(root, { subtree: true, attributeFilter: ["data-engaged"] });

    // Capture, and on the window for the press, so it lands before any piece
    // can stop it.
    window.addEventListener("pointerdown", onDown, { capture: true, passive: true });
    root.addEventListener("pointermove", onMove, { capture: true, passive: true });
    root.addEventListener("pointerout", onOut, { capture: true, passive: true });
    root.addEventListener("wheel", onWheel, { capture: true, passive: true });
    return () => {
      release();
      watch.disconnect();
      offscreen.disconnect();
      window.removeEventListener("pointerdown", onDown, { capture: true });
      root.removeEventListener("pointermove", onMove, { capture: true });
      root.removeEventListener("pointerout", onOut, { capture: true });
      root.removeEventListener("wheel", onWheel, { capture: true });
    };
  }, []);
  return null;
}
