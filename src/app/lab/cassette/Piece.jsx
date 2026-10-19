"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";
import { mixtapeFrom } from "./cassetteMixtape";
import "./cassette.css";

const SOUND_LABEL = {
  off: "Turn sound on",
  on: "Sound on",
  muted: "Sound off",
};

const STAGE_LABEL =
  "A C60 mixtape of top songs lying on a desk with a pencil beside it. Drag the pencil into either hub of the cassette, then press and circle around it to wind the tape. Wind back fast and slack tape spills out of the mouth; wind forward to take it back in. Tap the pencil to lay it down again. Enter puts the pencil in or out, 1 and 2 choose the hub, left and right arrows wind, M turns sound on or off.";

function SpeakerIcon({ state }) {
  return (
    <svg className="cassette-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {state === "on" ? (
        <path d="M10.4 5.6c.9.7 1.4 1.5 1.4 2.4s-.5 1.7-1.4 2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
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
  const [sound, setSound] = useState("off");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pencil, setPencil] = useState("rest");
  const [announce, setAnnounce] = useState("");
  const { tracks } = useTopSongs(12);
  const mix = useMemo(() => mixtapeFrom(tracks), [tracks]);
  const mixRef = useRef(mix);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const insets = () => {
      const rect = root.getBoundingClientRect();
      if (embedded) return { top: 12, bottom: 12, left: 12, right: 12 };
      if (rect.width >= 900) return { top: 88, bottom: 32, left: rect.width >= 1100 ? 300 : 48, right: 48 };
      const head = headRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - rect.top + 8 : 160;
      return { top, bottom: 24, left: 20, right: 20 };
    };
    const start = async () => {
      try {
        const { createCassetteEngine } = await import("./cassetteEngine");
        const startMix = mixRef.current;
        if (cancelled) return;
        engine = await createCassetteEngine({
          box: root,
          stage: stageRef.current,
          canvas: canvasRef.current,
          insets,
          embedded,
          mix: startMix,
          onReady: () => {
            if (!cancelled) setReady(true);
          },
          onFail: () => {
            if (!cancelled) setFailed(true);
          },
          onSound: (next) => {
            if (!cancelled) setSound(next);
          },
          onPencil: (next) => {
            if (!cancelled) setPencil(next);
          },
          onAnnounce: (text) => {
            if (!cancelled) setAnnounce(text);
          },
        });
        if (cancelled) {
          engine.destroy();
          engine = null;
          return;
        }
        engineRef.current = engine;
        if (mixRef.current !== startMix) engine.setMix(mixRef.current);
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

  useEffect(() => {
    if (mixRef.current === mix) return;
    mixRef.current = mix;
    engineRef.current?.setMix(mix);
  }, [mix]);

  const Root = embedded ? "div" : "main";
  const seated = pencil === "left" || pencil === "right";

  const soundButton = (
    <button
      type="button"
      className="cassette-sound"
      aria-pressed={sound === "on"}
      aria-label={embedded ? SOUND_LABEL[sound] : undefined}
      onClick={() => engineRef.current?.toggleSound()}
    >
      <SpeakerIcon state={sound} />
      {embedded ? null : <span className="cassette-sound-label">{SOUND_LABEL[sound]}</span>}
    </button>
  );

  return (
    <Root
      ref={rootRef}
      className="cassette"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-sound={sound}
      data-pencil={seated ? "seated" : pencil}
    >
      <div ref={stageRef} className="cassette-stage" tabIndex={0} role="application" aria-label={STAGE_LABEL}>
        <canvas ref={canvasRef} className="cassette-canvas" />
      </div>

      {embedded ? null : (
        <header ref={headRef} className="cassette-head">
          <h1 className="cassette-title">Cassette</h1>
          <p className="cassette-lede">
            {seated ? (
              <>
                Circle around the pencil to wind. Go back too fast and the tape <em>spills out</em>.
              </>
            ) : (
              <>
                Top songs on a C60. Pick up the pencil and drop it into a hub, <em>like you used to</em>.
              </>
            )}
          </p>
          {soundButton}
        </header>
      )}

      {embedded ? soundButton : null}

      {failed ? <p className="cassette-fallback">This cassette needs WebGL 2.</p> : null}
      <p className="cassette-live" aria-live="polite">
        {announce}
      </p>
    </Root>
  );
}
