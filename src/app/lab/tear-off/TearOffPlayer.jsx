"use client";

import PlayPauseIcon from "@/app/ui/PlayPauseIcon";
import SlotNumber from "@/app/ui/SlotNumber";

function EjectGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 3.9 12.1 9.1 H3.9 Z" fill="currentColor" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="3.1" y="11" width="9.8" height="1.8" rx="0.9" fill="currentColor" />
    </svg>
  );
}

export default function TearOffPlayer({ deck, mouthRef, elapsedRef, totalRef, progressRef, onToggle, onEject }) {
  const { id, cover, status } = deck;
  const loaded = Boolean(cover);
  const playing = status === "playing" || status === "loading";
  const silent = status === "none";
  const trackKey = id ?? "empty";

  return (
    <section className="to-player" data-status={status} aria-label="Ticket reader">
      <span ref={mouthRef} className="to-player__mouth" aria-hidden="true" />
      <span className="to-player__sr" aria-live="polite">
        {loaded ? `${silent ? "No preview for" : "Now playing"} ${cover.title}${cover.artist ? ` by ${cover.artist}` : ""}` : ""}
      </span>
      <div className="to-player__body">
        <span className="to-player__art" aria-hidden="true">
          {loaded && cover.image ? <img key={trackKey} className="to-player__cover" src={cover.image} alt="" draggable={false} decoding="async" /> : null}
        </span>
        <div className="to-player__info">
          <span key={`title-${trackKey}`} className="to-player__title text-heading-sm">
            {loaded ? cover.title : "Nothing playing"}
          </span>
          <span key={`artist-${trackKey}`} className="to-player__artist text-ui">
            {loaded ? cover.artist : "Drop a ticket in the slot"}
          </span>
          <span className="to-player__time text-ui">
            <span className="to-player__clock">
              <SlotNumber ref={elapsedRef} value="0:00" duration={360} stagger={24} />
              <span className="to-player__of" aria-hidden="true">
                /
              </span>
              <SlotNumber ref={totalRef} value="0:30" duration={360} stagger={24} />
            </span>
            <span className="to-player__note">No preview</span>
          </span>
          <span className="to-player__track" aria-hidden="true">
            <span ref={progressRef} className="to-player__fill" />
          </span>
        </div>
        <div className="to-player__controls">
          <button
            type="button"
            className="to-button to-button--icon to-player__button"
            aria-label={playing ? "Pause" : "Play"}
            disabled={!loaded || silent}
            onClick={onToggle}
          >
            <PlayPauseIcon playing={playing && loaded && !silent} size={16} />
          </button>
          <button type="button" className="to-button to-button--icon to-player__button" aria-label="Eject" disabled={!loaded} onClick={onEject}>
            <EjectGlyph />
          </button>
        </div>
      </div>
    </section>
  );
}
