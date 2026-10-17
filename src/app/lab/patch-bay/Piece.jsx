"use client";

import { useEffect, useRef, useState } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import "./patch-bay.css";

const SOUND_LABEL = {
  off: "Turn sound on",
  on: "Sound on",
  muted: "Sound off",
};

const STAGE_LABEL =
  "A small modular synth seen close up, with heavy rubber patch cables hanging between its jacks. Drag a plug from the park to any jack to patch it; pull a seated plug away to yank it out. Each effect you patch joins the signal chain in the order you patched it, and the knob on each module turns it. Press 1 to 5 to patch or unpatch low pass, tape echo, wobble, crush and room, and M to turn sound on or off.";

function SpeakerIcon({ state }) {
  return (
    <svg className="patch-bay__speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
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
  const liveRef = useRef(null);
  const headRef = useRef(null);
  const engineRef = useRef(null);
  const near = useNearViewport(rootRef);
  const [sound, setSound] = useState("off");
  const [ready, setReady] = useState(false);
  const [chain, setChain] = useState(["Low pass", "Room"]);
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    if (!near) return undefined;
    const root = rootRef.current;
    let cancelled = false;
    let engine = null;
    const insets = (rect) => {
      if (embedded) return { top: 10, side: 10, bottom: 10 };
      const wide = rect.width >= 900;
      const head = headRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - rect.top + (wide ? 20 : 12) : 160;
      return { top, side: wide ? 24 : 10, bottom: wide ? 24 : 10 };
    };
    const start = async () => {
      try {
        const { createPatchEngine } = await import("./patchEngine");
        if (cancelled) return;
        engine = createPatchEngine({
          box: root,
          stage: stageRef.current,
          live: liveRef.current,
          insets,
          embedded,
          onSound: (next) => setSound(next),
          onChain: (next) => setChain(next),
          onReady: () => setReady(true),
          onAnnounce: (text) => setAnnounce(text),
        });
        engineRef.current = engine;
      } catch (error) {
        console.error(error);
      }
    };
    start();
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
    };
  }, [near, embedded]);

  const Root = embedded ? "div" : "main";

  const soundButton = (
    <button
      type="button"
      className="patch-bay__sound"
      aria-pressed={sound === "on"}
      aria-label={embedded ? SOUND_LABEL[sound] : undefined}
      onClick={() => engineRef.current?.toggleSound()}
    >
      <SpeakerIcon state={sound} />
      {embedded ? null : <span className="patch-bay__sound-label">{SOUND_LABEL[sound]}</span>}
    </button>
  );

  return (
    <Root
      ref={rootRef}
      className="patch-bay"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-sound={sound}
    >
      <div ref={stageRef} className="patch-bay__stage" tabIndex={0} role="application" aria-label={STAGE_LABEL}>
        <canvas ref={liveRef} className="patch-bay__canvas" />
      </div>

      {embedded ? null : (
        <header ref={headRef} className="patch-bay__head">
          <div className="patch-bay__intro">
            <h1 className="patch-bay__title">Patch Bay</h1>
            <p className="patch-bay__lede">
              Drag a plug from the park onto any jack, or yank one out. Effects chain in the <em>order you patch</em> them.
            </p>
          </div>
          <div className="patch-bay__tools">
            <p className="patch-bay__chain" aria-hidden="true">
              <span className="patch-bay__chain-step">Beat</span>
              {chain.map((name) => (
                <span key={name} className="patch-bay__chain-step" data-fx="">
                  {name}
                </span>
              ))}
              <span className="patch-bay__chain-step">Out</span>
            </p>
            {soundButton}
          </div>
        </header>
      )}

      {embedded ? soundButton : null}

      <p className="patch-bay__live" aria-live="polite">
        {announce}
      </p>
    </Root>
  );
}
