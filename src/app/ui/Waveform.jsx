"use client";

import { useRef, useState } from "react";
import { motion } from "motion/react";

// Studio-style waveform: springy motion bars (real peaks), staggered entrance,
// played bars in dark, gaussian vertical stretch around the drag point, and an
// iOS-style rubber-band overscroll — drag past an edge and the bars splay apart
// like an accordion (the far edge stays pinned, the spacing opens up toward the
// pull), then everything springs back on release.
//
// Self-contained: all layout-critical styling is inline so this works anywhere
// (the covers route also themes it via .cv-wave / .cv-wave-bar in covers.css).
const EMPTY = Array.from({ length: 40 }, () => 0.14);

// Rubber-band overscroll tuning.
const MAX_OVER = 44; // px the pull edge can travel past the boundary
const STRETCH_K = 1.9; // >1 → spacing opens up more the closer a bar is to the pull edge
const RECOIL = { type: "spring", stiffness: 620, damping: 17, mass: 0.5 }; // bouncy snap-back
const FOLLOW = { type: "spring", stiffness: 1100, damping: 48, mass: 0.4 }; // tight live-drag follow

function rubber(deltaPx) {
  const sign = Math.sign(deltaPx);
  const x = Math.abs(deltaPx);
  // approaches MAX_OVER but never reaches it — feels like real resistance
  return sign * MAX_OVER * (1 - 1 / (x / MAX_OVER + 1));
}

export default function Waveform({
  peaks,
  progress = 0,
  duration = 0,
  onSeek,
  onScrubStart,
  onScrubEnd,
  accent = "#9CB6C4",
  height = 54,
  playedColor = "#1a1a1a",
  idleColor = "rgba(26,26,26,0.14)",
}) {
  const ref = useRef(null);
  const [dragX, setDragX] = useState(-1); // 0..1, -1 = not dragging
  const [over, setOver] = useState(0); // signed px the pull edge is past the boundary
  const ready = !!peaks;
  const bars = peaks || EMPTY;
  const n = bars.length;
  const dragging = dragX >= 0;

  const fracAt = (clientX) => {
    const r = ref.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  const seekAt = (clientX) => {
    const f = fracAt(clientX);
    setDragX(f);
    onSeek?.(f * duration);
  };
  // rubber-band pull from the raw (unclamped) pointer position
  const applyOver = (clientX) => {
    const r = ref.current.getBoundingClientRect();
    const raw = (clientX - r.left) / r.width;
    if (raw < 0) setOver(rubber(raw * r.width));
    else if (raw > 1) setOver(rubber((raw - 1) * r.width));
    else setOver(0);
  };
  const release = () => {
    if (dragX >= 0) onSeek?.(dragX * duration); // exact final position
    onScrubEnd?.();
    setDragX(-1);
    setOver(0); // springs every bar back via the FOLLOW→RECOIL transition
  };

  return (
    <div
      ref={ref}
      className="cv-wave"
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        flex: 1,
        minWidth: 0,
        height,
        gap: 2,
        cursor: "pointer",
        touchAction: "none",
      }}
      role="slider"
      aria-label="Seek"
      aria-valuenow={Math.round(progress * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      onPointerDown={(e) => {
        if (!ready) return;
        ref.current.setPointerCapture?.(e.pointerId);
        onScrubStart?.();
        seekAt(e.clientX);
        applyOver(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1 && ready) {
          seekAt(e.clientX);
          applyOver(e.clientX);
        }
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      {/* While dragging the fill follows the finger (dragX) so it tracks 1:1,
          independent of where the (scrub-paused) audio element actually is. */}
      {bars.map((h, i) => {
        const pct = i / n;
        const active = pct <= (dragging ? dragX : progress);

        // vertical stretch — gaussian falloff around the drag point
        let scaleY = 1;
        if (dragX >= 0) {
          const d = pct - dragX;
          const inf = Math.exp(-(d * d) / (2 * 0.03 * 0.03));
          scaleY = 1 + inf * 0.6;
        }

        // horizontal accordion — the edge OPPOSITE the pull stays pinned, each
        // bar slides by an amount that grows toward the pull edge (^K), so the
        // gaps open up most where you're pulling from.
        let x = 0;
        if (over !== 0 && n > 1) {
          const u = over >= 0 ? i / (n - 1) : 1 - i / (n - 1); // 0 at pinned edge → 1 at pull edge
          x = over * Math.pow(u, STRETCH_K);
        }

        return (
          <motion.span
            key={i}
            className="cv-wave-bar"
            style={{
              flex: 1,
              minWidth: 0,
              borderRadius: 999,
              transformOrigin: "center",
              display: "block",
            }}
            initial={{ height: "10%" }}
            animate={{
              height: `${Math.max(7, h * 100)}%`,
              backgroundColor: active ? playedColor : idleColor,
              scaleY,
              x,
            }}
            transition={{
              height: { type: "spring", stiffness: 380, damping: 22, mass: 0.4, delay: ready ? i * 0.004 : 0 },
              backgroundColor: { duration: 0.08 },
              scaleY: { type: "spring", stiffness: 600, damping: 20, mass: 0.3 },
              x: dragging ? FOLLOW : RECOIL,
            }}
          />
        );
      })}
    </div>
  );
}
