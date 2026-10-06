"use client";

import { useEffect } from "react";

const TILE_MAX_WAIT_MS = 1200;
const WAVE_STEP_MS = 80;

function tileIsReady(tile) {
  if (tile.querySelector("[data-plate]")) return Boolean(tile.querySelector("canvas[data-painted]"));
  if (tile.querySelector(".backdrop-page, .deck")) return true;
  return [...tile.querySelectorAll("img")].every((image) => image.complete);
}

function startsOffscreen(tile) {
  const rect = tile.getBoundingClientRect();
  return rect.top > window.innerHeight || rect.bottom < 0;
}

export default function ReadyGate() {
  useEffect(() => {
    const startedAt = performance.now();
    let pending = [...document.querySelectorAll(".xl-bento .xl-tile")];
    let frame = 0;

    const release = (tile, elapsed) => {
      const wave = parseFloat(getComputedStyle(tile).getPropertyValue("--wave")) || 0;
      const delay = `${Math.max(0, Math.round(wave * WAVE_STEP_MS - elapsed))}ms`;
      tile.style.animationDelay = `${delay}, ${delay}`;
      tile.dataset.ready = "true";
    };

    pending = pending.filter((tile) => {
      if (!startsOffscreen(tile)) return true;
      tile.dataset.ready = "true";
      return false;
    });

    const check = () => {
      const elapsed = performance.now() - startedAt;
      pending = pending.filter((tile) => {
        if (elapsed < TILE_MAX_WAIT_MS && !tileIsReady(tile)) return true;
        release(tile, elapsed);
        return false;
      });
      if (pending.length) frame = requestAnimationFrame(check);
    };
    frame = requestAnimationFrame(check);
    return () => cancelAnimationFrame(frame);
  }, []);
  return null;
}
