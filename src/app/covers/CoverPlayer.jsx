"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useIsPresent } from "motion/react";
// Aliased deliberately: the hi-res art preloader below calls `new Image()`, the
// DOM constructor. Importing next/image under its usual name would shadow that
// and turn a preload into an attempt to construct a React component.
import NextImage from "next/image";
import { X } from "lucide-react";
import Waveform from "@/app/ui/Waveform";
import Lyrics from "./Lyrics";
import EqBars from "./EqBars";
import SlotNumber from "@/app/ui/SlotNumber";
import { CLOCK_READOUTS, STATUS_READOUTS, TransportButton, transportStatus } from "./Transport";
import { useAudio, load, toggle, seek, scrubStart, scrubEnd, keyOf } from "./lib/audioEngine";
import { useArtInk } from "./lib/artInk";
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

// The readout swaps between a running clock and a word about the load, and it
// used to do it by replacing a string — so a failure ARRIVED as a line of text
// appearing out of nothing, in a card where every other element had been given
// a way in. Same vocabulary as the panel's own entrance, a beat quicker: the
// old line lifts out, the new one rises in behind it. Keyed on the KIND of
// readout, not the text, so a ticking percentage refines in place instead of
// re-animating itself eleven times a second.
const READ_IN = { duration: 0.3, ease: [0.16, 1, 0.3, 1] };
const READ_OUT = { duration: 0.16, ease: [0.16, 1, 0.3, 1] };

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

  // Playback lives in the module-level engine, not here — that's what lets the
  // dock keep the song going once this card unmounts. Opening a cover loads it
  // and starts it; reopening the one already playing is a no-op.
  const engine = useAudio();
  const key = keyOf(cover);
  // keyed on the track, not the object: the covers array is swapped once when
  // the Spotify data lands, and that must not restart a track you'd paused.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load(cover, { autoplay: true });
  }, [key]);
  // black or white for the badge on the artwork, measured from the art itself
  const artInk = useArtInk(cover.index, cover.image);
  // false the moment the card starts closing — the badge is a plain CSS element
  // inside the morphing art, so it needs the presence flag to know to fade.
  const isPresent = useIsPresent();
  // The frame or two before the engine has picked this track up. `pending` is
  // true because opening a cover asks for playback — so the transport shows the
  // loading ring immediately rather than a dead-looking play button.
  const IDLE = {
    status: "loading",
    playing: false,
    peaks: null,
    duration: 0,
    currentTime: 0,
    loaded: null,
    slow: false,
    pending: true,
  };
  const audio = engine.key === key ? engine : IDLE;
  const progress = audio.duration ? audio.currentTime / audio.duration : 0;
  const statusText = transportStatus(audio);
  const waveWaiting = !audio.peaks && (audio.status === "loading" || audio.status === "ready");
  // Nothing is coming — the attempt failed, or there was never a preview. The
  // wave lies down flat, which is the whole failure notice: it's the widest
  // thing in the row, so it going quiet says more than a sentence can, and the
  // words are left free to be one calm line rather than an alarm.
  const waveFlat = audio.status === "error" || audio.status === "none";
  const readoutKind = statusText ? audio.status : "clock";
  const clockText = `${fmt(audio.currentTime)} / ${fmt(audio.duration)}`;

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

  // The mobile panel is sized to its content, not to leftover space: measure the
  // stack once it's laid out and feed that back into the geometry. That's what
  // removes the scroll box entirely — with the panel exactly as tall as what's
  // in it, there is nothing to scroll and nothing to clip at either edge. The
  // card animates to the corrected height as part of the same opening morph.
  const stackRef = useRef(null);
  const [contentH, setContentH] = useState(null);
  useLayoutEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    const measure = () => setContentH(Math.ceil(el.offsetHeight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => playerLayout(contentH), [contentH]);
  const tile = useMemo(() => tileBox(rect, layout), [rect, layout]);
  if (!layout) return null;
  const { card, art, panel, header, link, stacked } = layout;

  // Match the WebGL tile's rounded corners: the shader rounds to a fraction
  // (config.cornerRadius) of the tile's on-screen size, so the morph's tile-end
  // radius must be computed the same way — a fixed px value won't line up.
  const tileRadius = tile.size * cornerRadius;

  // Close lives in its own line above the art on mobile (not floating over the
  // artwork), pinned to the card's top-right corner on desktop.
  const closePos = stacked
    ? { left: card.left + card.width - 16 - 40, top: card.top + 7 }
    // 38px tap target holding an 18px glyph → 10px of slack per side, so back the
    // box off by that much to land the glyph itself on the card's 24px padding.
    : { left: card.left + card.width - 24 + 10 - 38, top: card.top + 24 - 10 };

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
        {artInk ? (
          <EqBars
            playing={audio.playing}
            size={18}
            className={`cv-art-eq is-${artInk}${isPresent ? "" : " is-leaving"}`}
          />
        ) : null}
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

      {/* rank — top-centred on the header line above the art (mobile only). The
          chart position is the one bit of metadata that isn't the song itself, so
          it sits apart from the title/artist block rather than under it. */}
      {stacked && cover.rank ? (
        <motion.div
          className="cv-music-toprank"
          style={{ left: header.left, top: header.top, width: header.width, height: header.height }}
          initial={{ opacity: 0, y: 8, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, filter: "blur(6px)", transition: { duration: 0.2 } }}
          transition={{ delay: 0.16, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          <span>
            #{cover.rank} · {cover.rankLabel}
          </span>
        </motion.div>
      ) : null}

      {/* info / waveform / lyrics — staggered + blur-in */}
      <motion.div
        className="cv-music-panel"
        style={{ left: panel.left, top: panel.top, width: panel.width, height: panel.height }}
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
        {/* the measured stack. It carries the stagger (not the panel) because the
            panel's height is derived FROM this element — variants have to
            propagate from whatever wraps the actual items. */}
        <motion.div className="cv-music-stack" ref={stackRef} variants={panelV} initial="hidden" animate="show">
        <motion.div className="cv-music-head" variants={itemV}>
          <h2 className="cv-music-title no-orphan">{cover.title}</h2>
          {/* The credit is a hover group, not a static line: on desktop, taking
              the pointer to either the disc or the name grows the artist's
              photo itself into a portrait (see covers.css). ONE element does
              that — the disc IS the portrait, so there is never a small copy
              sitting next to a big one.
              It's fed the large rendition wherever it can actually be grown,
              since the browser downsamples that to 22px far better than it
              would upscale the thumbnail to 148. On mobile there is no hover,
              so the thumbnail is all that gets fetched. */}
          <p className="cv-music-artist">
            {cover.artistImage ? (
              <span
                className="cv-artist"
                style={{ "--cv-tint": cover.color }}
                tabIndex={0}
              >
                {/* A 22px hole in the line that never changes size, so the name
                    beside it cannot be shoved sideways by what the photo does. */}
                <span className="cv-artist-slot">
                  {/* The morphing box is this SPAN, not the image. Tailwind's
                      preflight puts `max-width: 100%` on every img, which on an
                      absolutely-positioned one resolves against its containing
                      block — so the box could never grow wider than the 22px
                      slot however the hover rule was written. A span has no such
                      rule anywhere. The photo just fills whatever the span is. */}
                  <span className="cv-artist-frame">
                    <NextImage
                      className="cv-artist-photo"
                      src={
                        (!stacked && cover.artistImageLarge) ||
                        cover.artistImage
                      }
                      alt=""
                      fill
                      sizes="148px"
                      draggable={false}
                    />
                  </span>
                </span>
                <span className="cv-artist-name">{cover.sub}</span>
              </span>
            ) : (
              <span>{cover.sub}</span>
            )}
          </p>
          {/* on mobile the rank has moved to the header strip above the art */}
          {cover.rank && !stacked ? (
            <p className="cv-music-rank">
              #{cover.rank} · {cover.rankLabel}
            </p>
          ) : null}
        </motion.div>

        <motion.div className={`cv-music-controls${stacked ? " is-stacked" : ""}`} variants={itemV}>
          {/* Every non-playing state is pressable and named — see Transport.jsx. */}
          <TransportButton className="cv-play-btn" audio={audio} onClick={toggle} size={20} />
          {/* Sweeps while there is nothing to draw yet, so the empty bars read as
              "the waveform is coming" rather than as a track with no sound in it.
              Only while something is actually on its way, though — "no preview"
              and "retry" are settled answers, and a shimmer under either of them
              would promise a wave that is never going to arrive. */}
          <div className={`cv-wave-wrap${waveWaiting ? " is-waiting" : ""}`}>
            <Waveform
              peaks={audio.peaks}
              progress={progress}
              duration={audio.duration}
              onSeek={seek}
              onScrubStart={scrubStart}
              onScrubEnd={scrubEnd}
              accent={cover.color}
              flat={waveFlat}
            />
          </div>
          <span className="cv-music-time" data-kind={statusText ? "status" : "clock"} data-status={audio.status}>
            {/* The slot's width, and nothing else: every line the CURRENT state
                can show, stacked invisibly in the same grid cell, so the box is
                as wide as the widest of them and never resizes while that state
                is up. The waveform beside it is flex:1 and would otherwise be
                dragged wider or narrower by every word and every digit the
                percentage gains.

                Scoped to the state rather than to every string in the player —
                see Transport.jsx. Holding one box big enough for "Loading,
                paused" meant the clock, which is what's showing essentially all
                the time, never filled it, and the slack sat in a gap between
                the wave and the time.

                Deliberately not a hard-coded width: the browser measures the
                real strings in the real font, so this is correct at both type
                sizes and stays correct if the copy is edited. */}
            <span className="cv-time-ruler" aria-hidden="true">
              {(statusText ? STATUS_READOUTS : CLOCK_READOUTS).map((line) => (
                <span key={line}>{line}</span>
              ))}
              {/* the live clock too, in case a duration ever runs past 9:59 */}
              {statusText ? null : <span>{clockText}</span>}
            </span>
            {/* Not `mode="wait"`: waiting empties the slot for the length of the
                exit, and the two lines have to overlap for the crossfade to be a
                crossfade at all. With the ruler holding the box open, nothing
                either of them does can move the wave. */}
            <AnimatePresence initial={false}>
              <motion.span
                key={readoutKind}
                className="cv-music-readout"
                initial={{ opacity: 0, y: 7, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -7, filter: "blur(4px)", transition: READ_OUT }}
                transition={READ_IN}
              >
                {statusText ? statusText : <SlotNumber value={clockText} direction="up" />}
              </motion.span>
            </AnimatePresence>
          </span>
        </motion.div>

        {!stacked ? (
          <motion.div className="cv-music-lyricwrap" variants={itemV}>
            <Lyrics
              artist={cover.sub}
              title={cover.title}
              isrc={cover.isrc}
              durationSec={cover.durationSec}
              color={cover.color}
              previewMs={audio.currentTime * 1000}
              playing={audio.playing}
            />
          </motion.div>
        ) : null}

        {cover.url && !stacked ? (
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

      {/* mobile: the link lives OUTSIDE the panel, on its own reserved band at the
          card's bottom. Inside the panel's overflow box a long title could always
          push it out of view — and the panel can't be touch-scrolled back (see
          the touch-action note in covers.css). Out here it is always reachable. */}
      {cover.url && stacked ? (
        <motion.a
          className="cv-spotify-link squircle-pill cv-spotify-fixed"
          style={{ left: link.left, top: link.top, height: link.height }}
          href={cover.url}
          target="_blank"
          rel="noopener noreferrer"
          initial={{ opacity: 0, y: 12, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, filter: "blur(6px)", transition: { duration: 0.2 } }}
          transition={{ delay: 0.37, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          Open in Spotify ↗
        </motion.a>
      ) : null}
    </motion.div>
  );
}

function fmt(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Centered geometry: a card containing art (left) + panel (right); narrow → stacked.
// Exported so the grid can shape its click-push field to the card's real
// footprint — wide + landscape on desktop, narrow + portrait on mobile.
export function playerLayout(contentH) {
  if (typeof window === "undefined") return null;
  const vw = window.innerWidth;
  // The VISUAL viewport, not innerHeight: on mobile Safari innerHeight includes
  // the strip behind the collapsing toolbar, so centring on it pushes the card's
  // bottom (where the Spotify link sits) underneath the browser chrome.
  const vh = window.visualViewport?.height || window.innerHeight;

  if (vw < 820) {
    const pad = 18;
    const headerH = 52; // close button + rank get their own line above the art
    const marginTop = 14;
    const marginBottom = 28; // clears the home indicator / toolbar lip
    const pw = Math.min(vw * 0.94, 460);
    const left = (vw - pw) / 2;
    // The Spotify link is NOT part of the panel on mobile — it gets its own
    // reserved band pinned to the card's bottom, where nothing above can push it.
    const linkH = 38;
    const linkGap = 16;
    const gap = 16; // art → panel
    // The panel is EXACTLY as tall as its measured content (title, artist, and
    // the transport). Not a band with slack in it: with no leftover space there
    // is nothing to scroll, nothing to clip at either edge, and no dead gap
    // between the transport and the link. 200 is the pre-measurement estimate.
    // artMin is the last-resort floor: on a very short screen the artwork gives
    // up its size before the card is ever allowed to run off the bottom.
    const artMin = 100;
    const chrome = marginTop + marginBottom + headerH + gap + linkGap + linkH + pad;
    const panelH = Math.max(120, Math.min(contentH || 200, 360, vh - chrome - artMin));
    // Whatever's left after the card's own chrome goes to the artwork.
    const avail = vh - marginTop - marginBottom - headerH - gap - panelH - linkGap - linkH - pad;
    const artSize = Math.max(artMin, Math.min(pw - pad * 2, vh * 0.46, avail));
    const ph = headerH + artSize + gap + panelH + linkGap + linkH + pad;
    // Centred, but never so low that the card's bottom edge leaves the visible
    // viewport — on a short screen it pins to the top margin instead.
    const top = Math.max(marginTop, Math.min((vh - ph) / 2, vh - marginBottom - ph));
    const panelTop = top + headerH + artSize + gap;
    return {
      stacked: true,
      card: { left, top, width: pw, height: ph },
      art: { left: left + (pw - artSize) / 2, top: top + headerH, size: artSize },
      panel: { left: left + pad, top: panelTop, width: pw - pad * 2, height: panelH },
      header: { left, top, width: pw, height: headerH },
      link: { left: left + pad, top: panelTop + panelH + linkGap, height: linkH },
    };
  }

  // One padding value for every card edge the art touches (left, top, bottom).
  // The card's height is DERIVED from the art rather than capped independently —
  // otherwise a width-constrained art gets centred in a taller card and the
  // vertical gap silently grows past the horizontal one.
  const pad = 24;
  const gap = 26; // art → panel
  const pw = Math.min(vw * 0.92, 1020);
  const maxH = Math.min(vh * 0.82, 540);
  const artSize = Math.min(maxH - pad * 2, pw * 0.48);
  const ph = artSize + pad * 2;
  const left = (vw - pw) / 2;
  const top = (vh - ph) / 2;
  return {
    stacked: false,
    card: { left, top, width: pw, height: ph },
    art: { left: left + pad, top: top + pad, size: artSize },
    panel: { left: left + pad + artSize + gap, top: top + pad, width: pw - pad * 2 - artSize - gap, height: artSize },
  };
}

function tileBox(rect, layout) {
  if (!rect) return layout ? { left: layout.art.left, top: layout.art.top, size: layout.art.size } : { left: 0, top: 0, size: 200 };
  return { left: rect.cx - rect.size / 2, top: rect.cy - rect.size / 2, size: rect.size };
}
