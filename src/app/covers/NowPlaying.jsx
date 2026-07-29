"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import SlotNumber from "@/app/ui/SlotNumber";
import EqBars from "./EqBars";
import { TransportButton, transportStatus } from "./Transport";
import { useAudio, toggle, stop, registerVisual } from "./lib/audioEngine";

// ---------------------------------------------------------------------------
// The dock: a small player that stays in the world. Close the big card and the
// song keeps going down here — art, name, the four lines, and a hairline that
// tracks the preview along the bottom edge.
//
// Enter/exit is a CSS state machine (data-state="in" | "out"), not a spring
// library: nothing about a dock sliding 14px needs JS on the main thread. The
// progress hairline is a scaleX on a CSS variable the engine writes, so it moves
// every frame while React re-renders roughly ten times a second.
// ---------------------------------------------------------------------------
const EXIT_MS = 220;

export default function NowPlaying({ hidden = false, onExpand }) {
  const audio = useAudio();
  const rootRef = useRef(null);
  const artRef = useRef(null);
  const lastCover = useRef(null);
  if (audio.cover) lastCover.current = audio.cover;
  const cover = audio.cover || lastCover.current;

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

  // the hairline rides --cv-progress, written straight onto this node
  useEffect(() => {
    if (mounted) return registerVisual(rootRef.current);
  }, [mounted]);

  if (!mounted || !cover) return null;

  // Grow the big card out of the little album thumb when the dock is expanded —
  // same morph the grid tiles use, just from a different starting box.
  const expand = () => {
    const r = artRef.current?.getBoundingClientRect();
    onExpand?.(cover, r ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, size: r.width } : null);
  };

  // The dock says exactly what the card says — one component, one vocabulary,
  // so a track that is "Still loading" up here can't read as idle down there.
  const statusText = transportStatus(audio);
  // Remount the readout when the KIND of thing it says changes (clock → status
  // → a different status) so CSS can give the new line a way in. Keying on the
  // text itself would re-run the animation on every tick of a percentage.
  const readoutKind = statusText ? audio.status : "clock";

  return (
    <div
      ref={rootRef}
      className="cv-dock"
      data-state={shown ? "in" : "out"}
      role="region"
      aria-label="Now playing"
    >
      <button
        ref={artRef}
        className="cv-dock-art"
        style={cover.image ? { backgroundImage: `url(${cover.image})` } : undefined}
        onClick={expand}
        aria-label={`Open ${cover.title}`}
      />

      <button className="cv-dock-meta" onClick={expand}>
        <span className="cv-dock-title">{cover.title}</span>
        <span className="cv-dock-artist">{cover.sub}</span>
      </button>

      <EqBars playing={audio.playing} />

      <TransportButton className="cv-dock-play" audio={audio} onClick={toggle} size={16} />

      {/* On a narrow screen the running clock is the first thing to go, but the
          STATUS never is — a phone on a bad connection is exactly where "is it
          loading or is it stuck?" gets asked. See the mobile rule in covers.css. */}
      <span className="cv-dock-time" data-kind={statusText ? "status" : "clock"} data-status={audio.status}>
        <span key={readoutKind} className="cv-dock-readout">
          {statusText ? statusText : <SlotNumber value={fmt(audio.currentTime)} direction="up" />}
        </span>
      </span>

      <button className="cv-dock-close" onClick={stop} aria-label="Stop">
        <X size={15} />
      </button>

      <span className="cv-dock-line" aria-hidden="true" />
    </div>
  );
}

function fmt(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
