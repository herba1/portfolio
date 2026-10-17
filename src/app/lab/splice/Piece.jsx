"use client";

import { useEffect, useRef, useState } from "react";

import "./splice.css";

const STEPS = {
  scrub: (
    <>
      Drag the tape to rock it past the head. Slide the pencil mark onto the 45° slot and press the razor <em>into it</em>.
    </>
  ),
  lay: <>Lay the end of reel B into the channel, right up against your cut.</>,
  butt: <>Slide reel B along until the two ends meet.</>,
  tab: <>Peel a splicing tab off the card and lay it over the joint.</>,
  rub: (
    <>
      Rub the tab down until the air is <em>out</em>.
    </>
  ),
  play: (
    <>
      Press play. The beat jumps <em>exactly</em> where you cut.
    </>
  ),
};

const SOUND_LABEL = {
  off: "Sound",
  on: "Sound on",
  muted: "Sound off",
};

function PlayIcon({ playing }) {
  return (
    <svg className="splice-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {playing ? <path d="M4.5 3.5h2.5v9H4.5zM9 3.5h2.5v9H9z" fill="currentColor" /> : <path d="M5 3.2v9.6l7.6-4.8z" fill="currentColor" />}
    </svg>
  );
}

function ReelIcon() {
  return (
    <svg className="splice-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
      <circle cx="8" cy="4.9" r="1.1" fill="currentColor" />
      <circle cx="10.7" cy="9.6" r="1.1" fill="currentColor" />
      <circle cx="5.3" cy="9.6" r="1.1" fill="currentColor" />
    </svg>
  );
}

function SpeakerIcon({ state }) {
  return (
    <svg className="splice-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {state === "on" ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const engineRef = useRef(null);
  const [step, setStep] = useState("scrub");
  const [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState("off");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    const root = rootRef.current;
    let cancelled = false;
    let engine = null;
    const insets = () => {
      const rect = root.getBoundingClientRect();
      if (embedded) return { top: 12, bottom: 56, left: 12, right: 12 };
      const narrow = rect.width < 520;
      const head = headRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - rect.top + (narrow ? 8 : 16) : 160;
      const side = rect.width >= 900 ? 32 : narrow ? 8 : 16;
      return { top, bottom: narrow ? 12 : 24, left: side, right: side };
    };
    const start = async () => {
      try {
        const { createSpliceEngine } = await import("./spliceEngine");
        if (cancelled) return;
        engine = createSpliceEngine({
          box: root,
          stage: stageRef.current,
          canvas: canvasRef.current,
          insets,
          embedded,
          onStage: (next) => setStep(next),
          onPlay: (next) => setPlaying(next),
          onSound: (next) => setSound(next),
          onReady: () => setReady(true),
          onFail: () => setFailed(true),
          onAnnounce: (text) => setAnnounce(text),
        });
        engineRef.current = engine;
      } catch (error) {
        console.error(error);
        if (!cancelled) setFailed(true);
      }
    };
    start();
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  const Root = embedded ? "div" : "main";

  const controls = (
    <div className="splice-controls">
      <button type="button" className="splice-button" data-primary={step === "play" && !playing ? "" : undefined} aria-pressed={playing} aria-label={embedded ? (playing ? "Stop" : "Play") : undefined} onClick={() => engineRef.current?.togglePlay()}>
        <PlayIcon playing={playing} />
        {embedded ? null : <span className="splice-label">{playing ? "Stop" : "Play"}</span>}
      </button>
      <button type="button" className="splice-button" aria-label={embedded ? "New tape" : undefined} onClick={() => engineRef.current?.newTape()}>
        <ReelIcon />
        {embedded ? null : <span className="splice-label">New tape</span>}
      </button>
      {embedded ? null : (
        <button type="button" className="splice-button" data-icon="" aria-pressed={sound === "on"} aria-label={SOUND_LABEL[sound]} onClick={() => engineRef.current?.toggleSound()}>
          <SpeakerIcon state={sound} />
        </button>
      )}
    </div>
  );

  return (
    <Root ref={rootRef} className="splice" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div
        ref={stageRef}
        className="splice-stage"
        tabIndex={0}
        role="application"
        aria-label="A tape splicing block with a playback head. Drag the tape to scrub it across the head. Drag the razor into the 45 degree slot to cut, lay reel B into the channel against the cut, put a splicing tab over the joint and rub it down. Space plays, Enter does the next step, arrow keys shuttle the tape, M marks the tape at the head, R threads fresh tape, S turns sound on or off."
      >
        <canvas ref={canvasRef} className="splice-canvas" />
      </div>

      {embedded ? null : (
        <header ref={headRef} className="splice-head">
          <h1 className="splice-title">Splice</h1>
          <p key={step} className="splice-lede">
            {STEPS[step]}
          </p>
          {controls}
        </header>
      )}

      {embedded ? controls : null}

      {failed ? <p className="splice-fallback">This splicing block needs WebGL 2.</p> : null}
      <p className="splice-live" aria-live="polite">
        {announce}
      </p>
    </Root>
  );
}
