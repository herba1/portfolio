"use client";

import { useEffect, useRef, useState } from "react";

import "./split-flap.css";

const CLIPS = [
  {
    key: "bloom",
    name: "Bloom",
    full: "A red flower opening and closing, a time-lapse",
    webm: new URL("./bloom.webm", import.meta.url).href,
    mp4: new URL("./bloom.mp4", import.meta.url).href,
  },
  {
    key: "switchboard",
    name: "Switchboard",
    full: "Switchboard operators at work, from His Girl Friday, 1940",
    webm: new URL("./switchboard.webm", import.meta.url).href,
    mp4: new URL("./switchboard.mp4", import.meta.url).href,
  },
];

function SpeakerIcon({ on }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const captionRef = useRef(null);
  const footRef = useRef(null);
  const fileRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(false);
  const [live, setLive] = useState("");
  const [failed, setFailed] = useState(false);
  const [film, setFilm] = useState(CLIPS[0].key);
  const [dropping, setDropping] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createBoard } = await import("./flapEngine");
      if (cancelled) return;
      engine = createBoard(stage, {
        embedded,
        caption: captionRef.current,
        footer: footRef.current,
        onLive: setLive,
        onFail: () => setFailed(true),
      });
      engine.setSource(CLIPS[0]);
      engineRef.current = engine;
      setReady(true);
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

  useEffect(() => {
    if (embedded) return undefined;
    const root = rootRef.current;
    if (!root) return undefined;
    let depth = 0;
    const hasFile = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
    const onEnter = (e) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      depth += 1;
      setDropping(true);
    };
    const onOver = (e) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e) => {
      if (!hasFile(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDropping(false);
    };
    const onDrop = (e) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      depth = 0;
      setDropping(false);
      const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("video/"));
      if (file && engineRef.current) {
        engineRef.current.setSource(file);
        setFilm("own");
        setLive(`Playing ${file.name}.`);
      }
    };
    root.addEventListener("dragenter", onEnter);
    root.addEventListener("dragover", onOver);
    root.addEventListener("dragleave", onLeave);
    root.addEventListener("drop", onDrop);
    return () => {
      root.removeEventListener("dragenter", onEnter);
      root.removeEventListener("dragover", onOver);
      root.removeEventListener("dragleave", onLeave);
      root.removeEventListener("drop", onDrop);
    };
  }, [embedded]);

  const choose = (clip) => {
    setFilm(clip.key);
    engineRef.current?.setSource(clip);
    setLive(`Playing ${clip.name}.`);
  };

  const onPick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !engineRef.current) return;
    engineRef.current.setSource(file);
    setFilm("own");
    setLive(`Playing ${file.name}.`);
  };

  const toggleSound = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !sound;
    setSound(next);
    const result = await engine.setSound(next);
    if (result !== next) setSound(false);
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root
      ref={rootRef}
      className="split-flap"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-dropping={dropping ? "" : undefined}
    >
      <div ref={stageRef} className="split-flap-stage">
        {embedded ? null : (
          <header ref={captionRef} className="split-flap-caption">
            <h1 className="split-flap-title">Split Flap</h1>
            <p className="split-flap-hint">A film on a board of flaps: each one falls only when its piece of the picture changes. Click to pause, or drop in your own video.</p>
          </header>
        )}
        {embedded ? null : (
          <div ref={footRef} className="split-flap-foot">
            <div className="split-flap-films" role="radiogroup" aria-label="Film">
              {CLIPS.map((clip) => (
                <button
                  key={clip.key}
                  type="button"
                  role="radio"
                  aria-checked={film === clip.key}
                  aria-label={clip.full}
                  className="split-flap-film"
                  onClick={() => choose(clip)}
                >
                  {clip.name}
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={film === "own"}
                className="split-flap-film split-flap-film-own"
                onClick={() => fileRef.current?.click()}
              >
                {dropping ? "Drop it on the board" : "Your own video"}
              </button>
            </div>
            <button type="button" className="split-flap-sound" aria-pressed={sound} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
              <span>{sound ? "Clicks on" : "Clicks off"}</span>
            </button>
            <input ref={fileRef} className="split-flap-file" type="file" accept="video/*" tabIndex={-1} aria-hidden="true" onChange={onPick} />
          </div>
        )}
      </div>
      {failed ? <p className="split-flap-fallback">This board needs WebGL 2.</p> : null}
      <p className="split-flap-live" aria-live="polite">
        {live}
      </p>
    </Root>
  );
}
