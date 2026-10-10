"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import SlotNumber from "@/app/ui/SlotNumber";
import MarqueeText from "@/app/ui/MarqueeText";
import EqBars from "./EqBars";
import { TransportButton, useSettledStatus } from "./Transport";
import { useAudio, toggle, stop } from "./lib/audioEngine";

// ---------------------------------------------------------------------------
// The dock: a small player that stays in the world. Close the big card and the
// song keeps going down here — art, name, and the four lines.
//
// Enter/exit is a CSS state machine (data-state="in" | "out"), not a spring
// library: nothing about a dock sliding 14px needs JS on the main thread.
// ---------------------------------------------------------------------------
const EXIT_MS = 220;
const SWIPE_DISMISS_PX = 96;
const SWIPE_DISMISS_VELOCITY = 600;
const DRAG_CLICK_GUARD_PX = 4;

export default function NowPlaying({ hidden = false, landing = false, onExpand }) {
  const audio = useAudio();
  const rootRef = useRef(null);
  const artRef = useRef(null);
  const lastCover = useRef(null);
  if (audio.cover) lastCover.current = audio.cover;
  const cover = audio.cover || lastCover.current;
  const draggedRef = useRef(false);
  const statusText = useSettledStatus(audio);

  const shown = audio.status !== "idle" && !!audio.cover && !hidden;
  const [mounted, setMounted] = useState(shown);

  useEffect(() => {
    if (shown) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [shown]);


  if (!mounted || !cover) return null;

  // Grow the big card out of the little album thumb when the dock is expanded —
  // same morph the grid tiles use, just from a different starting box.
  const expand = () => {
    if (draggedRef.current) return;
    const art = artRef.current;
    if (!art) {
      onExpand?.(cover, null);
      return;
    }
    const a = art.getBoundingClientRect();
    onExpand?.(cover, {
      cx: a.left + a.width / 2,
      cy: a.top + a.height / 2,
      size: a.width,
      radius: parseFloat(getComputedStyle(art).borderTopLeftRadius) || 0,
    });
  };

  // The dock says exactly what the card says — one component, one vocabulary,
  // so a track that is "Still loading" up here can't read as idle down there.
  // Remount the readout when the KIND of thing it says changes (clock → status
  // → a different status) so CSS can give the new line a way in. Keying on the
  // text itself would re-run the animation on every tick of a percentage.
  const readoutKind = statusText ? audio.status : "clock";

  return (
    <motion.div
      ref={rootRef}
      className="cv-dock"
      data-state={shown ? "in" : "out"}
      data-entrance={landing ? "land" : undefined}
      role="region"
      aria-label="Now playing"
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.9}
      dragSnapToOrigin
      onDragStart={() => {
        draggedRef.current = false;
      }}
      onDrag={(_, info) => {
        if (Math.abs(info.offset.x) > DRAG_CLICK_GUARD_PX) draggedRef.current = true;
      }}
      onDragEnd={(_, info) => {
        if (Math.abs(info.offset.x) > SWIPE_DISMISS_PX || Math.abs(info.velocity.x) > SWIPE_DISMISS_VELOCITY) stop();
        requestAnimationFrame(() => {
          draggedRef.current = false;
        });
      }}
    >
      <button
        ref={artRef}
        className="cv-dock-art"
        style={cover.image ? { backgroundImage: `url(${cover.image})` } : undefined}
        onClick={expand}
        aria-label={`Open ${cover.title}`}
      >
        <EqBars playing={audio.playing} size={16} className="cv-dock-eq" />
      </button>

      <button className="cv-dock-meta" onClick={expand}>
        <MarqueeText className="cv-dock-title">{cover.title}</MarqueeText>
        <MarqueeText className="cv-dock-artist">{cover.sub}</MarqueeText>
      </button>

      <span className="cv-dock-time" data-kind={statusText ? "status" : "clock"} data-status={audio.status}>
        <span key={readoutKind} className="cv-dock-readout">
          {statusText ? statusText : <SlotNumber value={fmt(audio.currentTime)} direction="up" />}
        </span>
      </span>

      <TransportButton className="cv-dock-play" audio={audio} onClick={toggle} size={18} />
    </motion.div>
  );
}

function fmt(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
