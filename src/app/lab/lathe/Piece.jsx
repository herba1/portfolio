"use client";

import { useEffect, useRef, useState } from "react";

import "./lathe.css";

const SOUND_LABEL = {
  off: "Turn sound on",
  on: "Sound on",
  muted: "Sound off",
};

function SpeakerIcon({ state }) {
  return (
    <svg className="lathe-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {state === "on" ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

function PlayIcon({ playing }) {
  return (
    <svg className="lathe-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {playing ? <rect x="4" y="4" width="8" height="8" rx="1.2" fill="currentColor" /> : <path d="M5 3.4v9.2a.6.6 0 0 0 .9.5l7.3-4.6a.6.6 0 0 0 0-1L5.9 2.9a.6.6 0 0 0-.9.5z" fill="currentColor" />}
    </svg>
  );
}

function BlankIcon() {
  return (
    <svg className="lathe-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const readoutRef = useRef(null);
  const engineRef = useRef(null);
  const [sound, setSound] = useState("off");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [deckState, setDeckState] = useState({ canPlay: true, playing: false, full: false });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const insets = () => {
      const rect = root.getBoundingClientRect();
      if (embedded) return { top: 8, bottom: 8, left: 8, right: 8 };
      if (rect.width >= 1100) return { top: 76, bottom: 24, left: 316, right: 24 };
      const head = headRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - rect.top + 12 : 180;
      const narrow = rect.width < 520;
      return { top, bottom: 12, left: narrow ? 4 : 16, right: narrow ? 4 : 16 };
    };
    const start = async () => {
      try {
        const { createLatheEngine } = await import("./latheEngine");
        if (cancelled) return;
        engine = createLatheEngine({
          box: root,
          stage: stageRef.current,
          canvas: canvasRef.current,
          readout: readoutRef.current,
          insets,
          embedded,
          onSound: (next) => {
            if (!cancelled) setSound(next);
          },
          onReady: () => {
            if (!cancelled) setReady(true);
          },
          onFail: () => {
            if (!cancelled) setFailed(true);
          },
          onAnnounce: (text) => {
            if (!cancelled) setAnnounce(text);
          },
          onState: (next) => {
            if (!cancelled) setDeckState(next);
          },
        });
        engineRef.current = engine;
      } catch (error) {
        console.error(error);
        if (!cancelled) setFailed(true);
      }
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        start();
      },
      { rootMargin: "240px" },
    );
    io.observe(root);
    return () => {
      cancelled = true;
      io.disconnect();
      engine?.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  const Root = embedded ? "div" : "main";
  const playLabel = deckState.playing ? "Stop" : "Play";

  const controls = (
    <div className="lathe-controls">
      <button
        type="button"
        className="lathe-button"
        data-primary=""
        disabled={!deckState.canPlay}
        aria-pressed={deckState.playing}
        aria-label={embedded ? `${playLabel} the cut` : undefined}
        onClick={() => engineRef.current?.playFromButton()}
      >
        <PlayIcon playing={deckState.playing} />
        {embedded ? null : <span className="lathe-button-label">{playLabel}</span>}
      </button>
      <button
        type="button"
        className="lathe-button"
        data-pulse={deckState.full ? "" : undefined}
        aria-label={embedded ? "New blank" : undefined}
        onClick={() => engineRef.current?.newBlank()}
      >
        <BlankIcon />
        {embedded ? null : <span className="lathe-button-label">New blank</span>}
      </button>
      <button
        type="button"
        className="lathe-button"
        data-quiet=""
        aria-pressed={sound === "on"}
        aria-label={SOUND_LABEL[sound]}
        onClick={() => engineRef.current?.toggleSound()}
      >
        <SpeakerIcon state={sound} />
      </button>
    </div>
  );

  return (
    <Root
      ref={rootRef}
      className="lathe"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-sound={sound}
    >
      <div
        ref={stageRef}
        className="lathe-stage"
        tabIndex={0}
        role="application"
        aria-label="A record-cutting lathe seen from above. Press and hold to lower the cutter and cut a groove into the lacquer; move up and down while holding to wobble the groove. Release to lift. Space also holds the cutter down and the up and down arrows wobble it. P plays the cut back, N swaps in a new blank, M turns sound on or off."
      >
        <canvas ref={canvasRef} className="lathe-canvas" />
      </div>

      {embedded ? null : (
        <header ref={headRef} className="lathe-head">
          <h1 className="lathe-title">Lathe</h1>
          <p className="lathe-lede">
            Hold to cut a groove into the lacquer. Move <em>up and down</em> as you hold, then drop the needle to hear it.
          </p>
          {controls}
          <p className="lathe-readout">
            <span className="lathe-readout-mark" aria-hidden="true" />
            <span ref={readoutRef}>0:00 cut</span>
          </p>
        </header>
      )}

      {embedded ? <div className="lathe-corner">{controls}</div> : null}
      {embedded ? <span ref={readoutRef} hidden /> : null}

      {failed ? <p className="lathe-fallback">This lathe needs WebGL 2.</p> : null}
      <p className="lathe-live" aria-live="polite">
        {announce}
      </p>
    </Root>
  );
}
