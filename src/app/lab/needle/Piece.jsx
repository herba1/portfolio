"use client";

import { useEffect, useRef, useState } from "react";

import { albumById } from "@/app/lab/_music/catalog";
import "./needle.css";

const RECORD = albumById("revolver");

const SOUND_LABEL = {
  off: "Turn sound on",
  on: "Sound on",
  muted: "Sound off",
};

function SpeakerIcon({ state }) {
  return (
    <svg className="needle-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {state === "on" ? null : <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />}
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const tagRef = useRef(null);
  const keyRef = useRef(null);
  const meterRef = useRef(null);
  const headRef = useRef(null);
  const engineRef = useRef(null);
  const [sound, setSound] = useState("off");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [band, setBand] = useState(-1);

  useEffect(() => {
    const root = rootRef.current;
    let cancelled = false;
    let engine = null;
    const insets = () => {
      const rect = root.getBoundingClientRect();
      if (embedded) return { top: 12, bottom: 12, left: 12, right: 12 };
      const wide = rect.width >= 900;
      if (wide) return { top: 76, bottom: 24, left: rect.width >= 1100 ? 300 : 24, right: 24 };
      const head = headRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - rect.top + 12 : 160;
      return { top, bottom: 24, left: 16, right: 16 };
    };
    const start = async () => {
      try {
        const { createNeedleEngine } = await import("./needleEngine");
        if (cancelled) return;
        engine = createNeedleEngine({
          box: root,
          stage: stageRef.current,
          canvas: canvasRef.current,
          tag: tagRef.current,
          keyButton: keyRef.current,
          meter: meterRef.current,
          insets,
          embedded,
          record: RECORD,
          onBand: (idx) => setBand(idx),
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

  const soundButton = (
    <button
      type="button"
      className="needle-sound"
      aria-pressed={sound === "on"}
      aria-label={embedded ? SOUND_LABEL[sound] : undefined}
      onClick={() => engineRef.current?.toggleSound()}
    >
      <SpeakerIcon state={sound} />
      {embedded ? null : <span className="needle-sound-label">{SOUND_LABEL[sound]}</span>}
      <span ref={meterRef} className="needle-meter" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
    </button>
  );

  return (
    <Root
      ref={rootRef}
      className="needle"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-sound={sound}
    >
      <div
        ref={stageRef}
        className="needle-stage"
        tabIndex={0}
        role="application"
        aria-label="A turntable seen from above with Revolver by The Beatles on the platter. Drag the record to scratch it, forwards and backwards. Drag the tonearm and let go over the grooves to drop the needle there. Space starts and stops the motor, left and right arrows nudge the record, up and down arrows cue the previous or next band, M turns sound on or off."
      >
        <canvas ref={canvasRef} className="needle-canvas" />
      </div>
      <span ref={tagRef} className="needle-tag" aria-hidden="true" data-show="false" />
      <button ref={keyRef} type="button" className="needle-key" aria-label="Start or stop the motor" aria-pressed="true">
        <span className="needle-legend">Start · Stop</span>
      </button>

      {embedded ? null : (
        <header ref={headRef} className="needle-head">
          <h1 className="needle-title">Needle</h1>
          <p className="needle-lede">
            Revolver on the platter. Grab the record and scratch it, <em>backwards too</em>. Lift the arm and drop it anywhere to cue.
          </p>
          {soundButton}
          <ol className="needle-side" aria-label={`${RECORD.title}, side one`}>
            {RECORD.tracks.map((name, i) => (
              <li key={name}>
                <button
                  type="button"
                  className="needle-track"
                  aria-current={band === i ? "true" : undefined}
                  onClick={() => engineRef.current?.cueTrack(i)}
                >
                  <span className="needle-track-no">{String(i + 1).padStart(2, "0")}</span>
                  <span className="needle-track-name">{name}</span>
                </button>
              </li>
            ))}
          </ol>
        </header>
      )}

      {embedded ? soundButton : null}

      {failed ? <p className="needle-fallback">This turntable needs WebGL 2.</p> : null}
      <p className="needle-live" aria-live="polite">
        {announce}
      </p>
    </Root>
  );
}
