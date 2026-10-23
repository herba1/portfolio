"use client";

import { useEffect } from "react";

// A phone has no cursor to carry PlateHand's "Click to change", so nothing
// says a plate can be tapped. Each tile whose piece is a plate gets a small
// chip in its corner instead, worded from the piece's own hint, until the
// first tap inside that tile shows the visitor they have it.
const DEFAULT_HINT = "Tap to change";
// Further than this between press and release is a swipe, not a tap.
const TAP_SLOP_PX = 10;

const wording = (plate) => plate.dataset.plateHint?.replace(/^Click\b/, "Tap") || DEFAULT_HINT;

export default function TapHint() {
  useEffect(() => {
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) return undefined;
    const root = document.querySelector(".xl-bento");
    if (!root) return undefined;
    const chips = new Map();

    const sync = () => {
      for (const plate of root.querySelectorAll(".xl-tile [data-plate]")) {
        const tile = plate.closest(".xl-tile");
        if (tile.dataset.tapped !== undefined) continue;
        let chip = chips.get(tile);
        if (!chip) {
          chip = document.createElement("span");
          chip.className = "xl-tap";
          chip.setAttribute("aria-hidden", "true");
          tile.append(chip);
          tile.dataset.tapHint = "";
          chips.set(tile, chip);
        }
        const text = wording(plate);
        if (chip.textContent !== text) chip.textContent = text;
      }
    };

    // Only a tap retires the chip; a sideways swipe through the deck hasn't
    // found what a tap does yet.
    const down = { x: 0, y: 0 };
    const onDown = (event) => {
      down.x = event.clientX;
      down.y = event.clientY;
    };
    const onUp = (event) => {
      if (event.pointerType !== "touch") return;
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > TAP_SLOP_PX) return;
      const tile = event.target instanceof Element ? event.target.closest(".xl-tile") : null;
      if (!tile || !chips.has(tile)) return;
      tile.dataset.tapped = "";
    };

    // Pieces mount as they near the viewport, and the deck rewords its hint
    // when it toggles.
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-plate-hint"] });
    sync();
    root.addEventListener("pointerdown", onDown, { passive: true });
    root.addEventListener("pointerup", onUp, { passive: true });
    return () => {
      observer.disconnect();
      root.removeEventListener("pointerdown", onDown);
      root.removeEventListener("pointerup", onUp);
      for (const [tile, chip] of chips) {
        chip.remove();
        delete tile.dataset.tapHint;
      }
    };
  }, []);
  return null;
}
