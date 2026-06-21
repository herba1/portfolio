"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { useTrackAudio } from "./useTrackAudio";
import Waveform from "@/app/ui/Waveform";
import Lyrics from "./Lyrics";
import PlayPauseIcon from "@/app/ui/PlayPauseIcon";
import { DEFAULTS } from "./lib/config";

// ---------------------------------------------------------------------------
// Music active-state. A glass CARD grows out of the clicked tile (hugging the
// album art), the art morphs square→square to its left slot, and the right
// panel's elements stagger + blur in: title/rank, a studio-style waveform with
// a playable preview, and synced lyrics (desktop only — mobile drops lyrics and
// puts the close button on its own line above a larger, viewport-filling art).
// ---------------------------------------------------------------------------
const MORPH = { duration: 0.5, ease: [0.16, 1, 0.3, 1] };

const panelV = { hidden: {}, show: { transition: { delayChildren: 0.16, staggerChildren: 0.07 } } };
const itemV = {
  hidden: { opacity: 0, y: 12, filter: "blur(8px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } },
};

export default function CoverPlayer({ cover, rect, onClose, onClosed, cornerRadius = DEFAULTS.cornerRadius }) {
  return (
    <AnimatePresence onExitComplete={onClosed}>
      {cover ? (
        <PlayerInner key={cover.index} cover={cover} rect={rect} onClose={onClose} cornerRadius={cornerRadius} />
      ) : null}
    </AnimatePresence>
  );
}

function PlayerInner({ cover, rect, onClose, cornerRadius }) {
  const [hiReady, setHiReady] = useState(false);
  const audio = useTrackAudio(cover.sub, cover.title);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    setHiReady(false);
    const hi = cover.imageLarge || cover.image;
    if (!hi) return;
    const img = new Image();
    img.onload = () => setHiReady(true);
    img.src = hi;
    return () => {
      img.onload = null;
    };
  }, [cover.imageLarge, cover.image]);

  const layout = useMemo(playerLayout, []);
  const tile = useMemo(() => tileBox(rect, layout), [rect, layout]);
  if (!layout) return null;
  const { card, art, panel, stacked } = layout;

  // Match the WebGL tile's rounded corners: the shader rounds to a fraction
  // (config.cornerRadius) of the tile's on-screen size, so the morph's tile-end
  // radius must be computed the same way — a fixed px value won't line up.
  const tileRadius = tile.size * cornerRadius;

  const onPlay = () => audio.toggle();

  // Close lives in its own line above the art on mobile (not floating over the
  // artwork), pinned to the card's top-right corner on desktop.
  const closePos = stacked
    ? { left: card.left + card.width - 16 - 40, top: card.top + 7 }
    : { left: card.left + card.width - 46, top: card.top + 12 };

  return (
    <motion.div className="cv-player" onPointerDown={onClose}>
      <motion.div
        className="cv-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.32 }}
      />

      {/* glass card — grows out of the tile, hugging the art */}
      <motion.div
        className="cv-music-card"
        initial={{ left: tile.left, top: tile.top, width: tile.size, height: tile.size, borderRadius: tileRadius, boxShadow: "0 12px 30px -18px rgba(26,26,26,0.28)" }}
        animate={{ left: card.left, top: card.top, width: card.width, height: card.height, borderRadius: 24, boxShadow: "0 46px 110px -44px rgba(26,26,26,0.5)" }}
        exit={{ left: tile.left, top: tile.top, width: tile.size, height: tile.size, borderRadius: tileRadius, boxShadow: "0 12px 30px -18px rgba(26,26,26,0.28)" }}
        transition={MORPH}
        onPointerDown={(e) => e.stopPropagation()}
      />

      {/* album art — morphs square→square out of the tile (sharp on close) */}
      <motion.div
        className="cv-music-art"
        style={cover.image ? { backgroundImage: `url(${cover.image})` } : undefined}
        initial={{ left: tile.left, top: tile.top, width: tile.size, height: tile.size, borderRadius: tileRadius, filter: "blur(7px)" }}
        animate={{ left: art.left, top: art.top, width: art.size, height: art.size, borderRadius: 14, filter: "blur(0px)" }}
        exit={{ left: tile.left, top: tile.top, width: tile.size, height: tile.size, borderRadius: tileRadius, filter: "blur(0px)" }}
        transition={MORPH}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <motion.div
          className="cv-music-art-hi"
          style={(cover.imageLarge || cover.image) ? { backgroundImage: `url(${cover.imageLarge || cover.image})` } : undefined}
          initial={{ opacity: 0 }}
          animate={{ opacity: hiReady ? 1 : 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        />
      </motion.div>

      {/* close — pinned to the card's top-right */}
      <motion.button
        className="cv-close cv-music-close"
        style={closePos}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{
          left: tile.left + tile.size - 40,
          top: tile.top + 8,
          opacity: 0,
          transition: { ...MORPH, opacity: { duration: 0.2 } },
        }}
        transition={{ delay: 0.2, duration: 0.2 }}
        onClick={onClose}
        aria-label="Close"
      >
        <X size={18} />
      </motion.button>

      {/* info / waveform / lyrics — staggered + blur-in */}
      <motion.div
        className="cv-music-panel"
        style={{ left: panel.left, top: panel.top, width: panel.width, height: panel.height }}
        variants={panelV}
        initial="hidden"
        animate="show"
        exit={{
          left: tile.left,
          top: tile.top,
          width: tile.size,
          height: tile.size,
          opacity: 0,
          filter: "blur(6px)",
          transition: { ...MORPH, opacity: { duration: 0.26 }, filter: { duration: 0.26 } },
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <motion.div className="cv-music-head" variants={itemV}>
          <h2 className="cv-music-title">{cover.title}</h2>
          <p className="cv-music-artist">
            {cover.artistImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="cv-music-avatar"
                src={cover.artistImage}
                alt=""
                loading="lazy"
                draggable={false}
              />
            ) : null}
            <span>{cover.sub}</span>
          </p>
          {cover.rank ? (
            <p className="cv-music-rank">
              #{cover.rank} · {cover.rankLabel}
            </p>
          ) : null}
        </motion.div>

        <motion.div className={`cv-music-controls${stacked ? " is-stacked" : ""}`} variants={itemV}>
          <button
            className="cv-play-btn"
            onClick={onPlay}
            disabled={audio.status !== "ready"}
            aria-label={audio.playing ? "Pause" : "Play"}
          >
            <PlayPauseIcon playing={audio.playing} />
          </button>
          <Waveform
            peaks={audio.peaks}
            progress={audio.progress}
            duration={audio.duration}
            onSeek={audio.seek}
            onScrubStart={audio.scrubStart}
            onScrubEnd={audio.scrubEnd}
            accent={cover.color}
          />
          <span className="cv-music-time">
            {audio.status === "loading"
              ? "…"
              : audio.status === "none"
                ? "no preview"
                : `${fmt(audio.currentTime)} / ${fmt(audio.duration)}`}
          </span>
        </motion.div>

        {!stacked ? (
          <motion.div className="cv-music-lyricwrap" variants={itemV}>
            <Lyrics artist={cover.sub} title={cover.title} color={cover.color} />
          </motion.div>
        ) : null}

        {cover.url ? (
          <motion.a
            className="cv-spotify-link squircle-pill"
            href={cover.url}
            target="_blank"
            rel="noopener noreferrer"
            variants={itemV}
          >
            Open in Spotify ↗
          </motion.a>
        ) : null}
      </motion.div>
    </motion.div>
  );
}

function fmt(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Centered geometry: a card containing art (left) + panel (right); narrow → stacked.
function playerLayout() {
  if (typeof window === "undefined") return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (vw < 820) {
    const pad = 18;
    const headerH = 52; // close button gets its own line above the art
    const margin = 14;
    const pw = Math.min(vw * 0.94, 460);
    const left = (vw - pw) / 2;
    // No lyrics on mobile — the panel holds the title (which may wrap to two
    // lines), artist, rank and the player. Give it a comfortable band that fits
    // that content without clipping; if a long title overflows, the panel itself
    // scrolls (see covers.css). The art takes whatever height remains so the
    // whole card stays within the viewport.
    const panelH = 224;
    const maxArt = vh - margin * 2 - headerH - 16 - panelH - pad;
    const artSize = Math.max(150, Math.min(pw - pad * 2, vh * 0.4, maxArt));
    const ph = headerH + artSize + 16 + panelH + pad;
    const top = Math.max(margin, (vh - ph) / 2);
    return {
      stacked: true,
      card: { left, top, width: pw, height: ph },
      art: { left: left + (pw - artSize) / 2, top: top + headerH, size: artSize },
      panel: { left: left + pad, top: top + headerH + artSize + 16, width: pw - pad * 2, height: panelH },
    };
  }

  const pw = Math.min(vw * 0.92, 1020);
  const ph = Math.min(vh * 0.82, 540);
  const left = (vw - pw) / 2;
  const top = (vh - ph) / 2;
  const artSize = Math.min(ph - 28, pw * 0.48);
  return {
    stacked: false,
    card: { left, top, width: pw, height: ph },
    art: { left: left + 16, top: top + (ph - artSize) / 2, size: artSize },
    panel: { left: left + 16 + artSize + 26, top: top + 30, width: pw - 16 - artSize - 26 - 28, height: ph - 60 },
  };
}

function tileBox(rect, layout) {
  if (!rect) return layout ? { left: layout.art.left, top: layout.art.top, size: layout.art.size } : { left: 0, top: 0, size: 200 };
  return { left: rect.cx - rect.size / 2, top: rect.cy - rect.size / 2, size: rect.size };
}
