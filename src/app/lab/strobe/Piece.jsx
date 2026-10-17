"use client";

import { useEffect, useRef, useState } from "react";

import "./strobe.css";

const SOUND_LABEL = {
  off: "Turn sound on",
  on: "Sound on",
  muted: "Sound off",
};

function SpeakerIcon({ state }) {
  return (
    <svg className="strobe-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
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
  const meterRef = useRef(null);
  const headRef = useRef(null);
  const engineRef = useRef(null);
  const [sound, setSound] = useState("off");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [deck, setDeck] = useState({ motor: true, speed: 33 });

  useEffect(() => {
    const root = rootRef.current;
    let cancelled = false;
    let engine = null;
    const insets = () => {
      const rect = root.getBoundingClientRect();
      if (embedded) return { top: 12, bottom: 12, left: 12, right: 12 };
      const wide = rect.width >= 900;
      if (wide) return { top: 100, bottom: 72, left: 24, right: 24 };
      const head = headRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - rect.top + 16 : 160;
      return { top, bottom: 20, left: 12, right: 12 };
    };
    const start = async () => {
      try {
        const { createStrobeEngine } = await import("./strobeEngine");
        if (cancelled) return;
        engine = createStrobeEngine({
          box: root,
          stage: stageRef.current,
          canvas: canvasRef.current,
          tag: tagRef.current,
          meter: meterRef.current,
          insets,
          embedded,
          onSound: (next) => setSound(next),
          onReady: () => setReady(true),
          onFail: () => setFailed(true),
          onAnnounce: (text) => setAnnounce(text),
          onState: (next) => setDeck(next),
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
      className="strobe-sound"
      aria-pressed={sound === "on"}
      aria-label={embedded ? SOUND_LABEL[sound] : undefined}
      onClick={() => engineRef.current?.toggleSound()}
    >
      <SpeakerIcon state={sound} />
      {embedded ? null : <span className="strobe-sound-label">{SOUND_LABEL[sound]}</span>}
      <span ref={meterRef} className="strobe-meter" aria-hidden="true">
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
      className="strobe"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-sound={sound}
    >
      <div
        ref={stageRef}
        className="strobe-stage"
        tabIndex={0}
        role="application"
        aria-label="A direct-drive turntable seen low at the platter's edge, its strobe dots lit by a neon lamp. Drag the pitch fader; at exactly zero it clicks into the detent and the 33 row of dots stands still. Drag the platter edge to nudge it. Up and down arrows move the pitch, Home returns it to zero, left and right arrows nudge the platter, Space starts and stops, 3 and 4 pick 33 or 45, M turns sound on or off."
      >
        <canvas ref={canvasRef} className="strobe-canvas" />
      </div>
      <span ref={tagRef} className="strobe-tag" aria-hidden="true" data-show="false" />
      <div className="strobe-deck" role="group" aria-label="Motor">
        <button
          type="button"
          className="strobe-start"
          aria-pressed={deck.motor}
          aria-label={deck.motor ? "Stop the platter" : "Start the platter"}
          onClick={() => engineRef.current?.pressKey(0)}
        >
          <span className="strobe-start-dot" aria-hidden="true" />
          <span className="strobe-start-label">{deck.motor ? "Stop" : "Start"}</span>
        </button>
        <span className="strobe-rule" aria-hidden="true" />
        <button
          type="button"
          className="strobe-speed"
          aria-pressed={deck.speed === 33}
          aria-label="33⅓ rpm"
          onClick={() => engineRef.current?.pressKey(1)}
        >
          33
        </button>
        <button
          type="button"
          className="strobe-speed"
          aria-pressed={deck.speed === 45}
          aria-label="45 rpm"
          onClick={() => engineRef.current?.pressKey(2)}
        >
          45
        </button>
      </div>

      {embedded ? null : (
        <header ref={headRef} className="strobe-head">
          <h1 className="strobe-title">Strobe</h1>
          <p className="strobe-lede">
            Ride the pitch fader until it clicks into zero and the dots <em>stand still</em>.
          </p>
          {soundButton}
        </header>
      )}

      {embedded ? soundButton : null}

      {failed ? <p className="strobe-fallback">This turntable needs WebGL 2.</p> : null}
      <p className="strobe-live" aria-live="polite">
        {announce}
      </p>
    </Root>
  );
}
