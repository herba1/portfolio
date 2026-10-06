"use client";

import { useEffect, useRef, useState } from "react";

const EASE_RATE = 7;
const SETTLE_EPSILON = 5e-4;

function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mixHex(from, to, amount) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return `#${a
    .map((channel, i) => Math.round(channel + (b[i] - channel) * amount).toString(16).padStart(2, "0"))
    .join("")}`;
}

function isHex(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function approach(current, target, amount) {
  const next = {};
  let settled = true;
  for (const key of Object.keys(target)) {
    const from = current[key];
    const to = target[key];
    if (typeof to === "number" && typeof from === "number") {
      const gap = Math.abs(to - from);
      const close = gap < SETTLE_EPSILON * Math.max(1, Math.abs(to));
      next[key] = close ? to : from + (to - from) * amount;
      if (!close) settled = false;
    } else if (isHex(to) && isHex(from) && from !== to) {
      next[key] = mixHex(from, to, amount);
      settled = false;
    } else {
      next[key] = to;
    }
  }
  return { next, settled };
}

export default function useLivePlate(params, enabled) {
  const [shown, setShown] = useState(params);
  const shownRef = useRef(params);

  useEffect(() => {
    if (!enabled) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      shownRef.current = params;
      setShown(params);
      return undefined;
    }

    let frame = 0;
    let last = performance.now();

    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { next, settled } = approach(shownRef.current, params, 1 - Math.exp(-EASE_RATE * dt));
      shownRef.current = settled ? params : next;
      setShown(shownRef.current);
      if (!settled) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [params, enabled]);

  return enabled ? shown : params;
}
