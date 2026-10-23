"use client";

import { useEffect } from "react";

// A tile's hint (bento/page.js) stays until the visitor takes hold of the
// piece: a press with a mouse, a tap or a drag that ends inside it on a
// touch screen (a swipe the page took for a scroll is cancelled, and
// doesn't count), or a key typed into it. The Focus button is not the piece.
export default function TileHints() {
  useEffect(() => {
    const root = document.querySelector(".xl-bento");
    if (!root) return undefined;
    const tileOf = (target) => {
      if (!(target instanceof Element) || target.closest("[data-tile-focus]")) return null;
      return target.closest(".xl-tile");
    };
    const take = (event) => {
      const tile = tileOf(event.target);
      if (tile) tile.dataset.touched = "";
    };
    const onDown = (event) => {
      if (event.pointerType !== "touch") take(event);
    };
    const onUp = (event) => {
      if (event.pointerType === "touch") take(event);
    };
    root.addEventListener("pointerdown", onDown, { passive: true });
    root.addEventListener("pointerup", onUp, { passive: true });
    root.addEventListener("keydown", take);
    return () => {
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointerup", onUp);
      root.removeEventListener("keydown", take);
    };
  }, []);
  return null;
}
