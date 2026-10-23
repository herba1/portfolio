"use client";

import { useEffect, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";

import "./skin.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="skin-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <>
          <path className="skin-wave skin-wave-near" d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
          <path className="skin-wave skin-wave-far" d="M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
        </>
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const stageRef = useRef(null);
  const captionRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState("pending");
  const [live, setLive] = useState("");
  const { tracks } = useTopSongs(20);
  const tracksRef = useRef(tracks);
  useEffect(() => {
    tracksRef.current = tracks;
    engineRef.current?.setTracks(tracks);
  }, [tracks]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createSkin } = await import("./skinEngine");
      if (cancelled) return;
      engine = createSkin(stage, { embedded, caption: captionRef.current, songs: tracksRef.current, onLive: setLive, onAudio: setSound, onReady: () => setReady(true) });
      engineRef.current = engine;
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        start();
      },
      { rootMargin: "240px" },
    );
    io.observe(stage);
    return () => {
      cancelled = true;
      io.disconnect();
      engine?.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  const toggleSound = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = sound !== "on";
    setSound(next ? "pending" : "off");
    const ok = await engine.setSound(next);
    if (next && !ok) setSound("pending");
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root className="skin" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div ref={stageRef} className="skin-stage">
        {embedded ? null : (
          <header ref={captionRef} className="skin-caption">
            <div className="skin-caption-text">
              <h1 className="skin-heading">8-Bit Player</h1>
              <p className="skin-hint">Your top songs, transcribed from their real previews by a pitch model and remade as chiptunes on four sound channels. Press play, double-click a track, or drop in a song of your own.</p>
            </div>
            <button type="button" className="skin-sound" data-state={sound} aria-pressed={sound === "on"} onClick={toggleSound}>
              <SpeakerIcon on={sound !== "off"} />
              {sound === "pending" ? (
                <>
                  <span className="skin-sound-fine">Click for sound</span>
                  <span className="skin-sound-touch">Tap for sound</span>
                </>
              ) : (
                <span>{sound === "on" ? "Sound on" : "Sound off"}</span>
              )}
            </button>
          </header>
        )}
      </div>
      <p className="skin-live" aria-live="polite">
        {live}
      </p>
    </Root>
  );
}
