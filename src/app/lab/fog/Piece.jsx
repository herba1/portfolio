"use client";

import { Mic, MicOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import { SCENES } from "./fogScenes";
import "./fog.css";

const GLASS_LABEL =
  "A cold window pane at dusk. Press and hold to breathe on the glass and fog it, then drag to write in the fog; the strokes clear to the view, bead with water, sometimes drip, and the fog slowly evaporates from its edges. Hold Space to breathe, press Enter to write a word, and 1 to 3 to change the view.";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const glassRef = useRef(null);
  const canvasRef = useRef(null);
  const cursorRef = useRef(null);
  const engineRef = useRef(null);
  const sceneRef = useRef(SCENES[0].id);
  const near = useNearViewport(rootRef);
  const [sceneId, setSceneId] = useState(SCENES[0].id);
  const [mic, setMic] = useState("off");

  useEffect(() => {
    if (!near) return undefined;
    const root = rootRef.current;
    let cancelled = false;
    let engine = null;
    import("./fogEngine")
      .then(({ default: FogEngine }) => {
        if (cancelled) return;
        engine = new FogEngine({
          host: glassRef.current,
          canvas: canvasRef.current,
          cursor: cursorRef.current,
          onReady: () => root.setAttribute("data-ready", ""),
          onFail: () => root.setAttribute("data-fallback", ""),
        });
        engineRef.current = engine;
        engine.start(sceneRef.current);
      })
      .catch(() => root.setAttribute("data-fallback", ""));
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
    };
  }, [near]);

  const chooseScene = (id) => {
    sceneRef.current = id;
    setSceneId(id);
    engineRef.current?.setScene(id);
  };

  const toggleMic = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (mic === "on") {
      engine.disableMic();
      setMic("off");
      return;
    }
    setMic("asking");
    const ok = await engine.enableMic();
    setMic(ok ? "on" : "blocked");
  };

  const onGlassKey = (e) => {
    if (e.key === " ") {
      e.preventDefault();
      if (!e.repeat) engineRef.current?.breathNow(true);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      engineRef.current?.writeNow();
      return;
    }
    const index = Number(e.key) - 1;
    if (index >= 0 && index < SCENES.length) {
      e.preventDefault();
      chooseScene(SCENES[index].id);
    }
  };

  const onGlassKeyUp = (e) => {
    if (e.key === " ") engineRef.current?.breathNow(false);
  };

  const scene = SCENES.find((s) => s.id === sceneId) || SCENES[0];
  const micLabel = mic === "on" ? "Mic on" : mic === "blocked" ? "Mic blocked" : mic === "asking" ? "Allow mic…" : "Use mic";

  return (
    <div ref={rootRef} className="fog" data-embedded={embedded ? "" : undefined}>
      <div
        ref={glassRef}
        className="fog__glass"
        tabIndex={0}
        role="application"
        aria-label={GLASS_LABEL}
        onKeyDown={onGlassKey}
        onKeyUp={onGlassKeyUp}
        onBlur={() => engineRef.current?.breathNow(false)}
      >
        <img className="fog__fallback" src={scene.src} alt="" draggable={false} />
        <canvas ref={canvasRef} className="fog__canvas" />
        <span ref={cursorRef} className="fog__cursor" aria-hidden="true" />
      </div>

      {!embedded && (
        <header className="fog__head">
          <h1 className="fog__title">Fog</h1>
          <p className="fog__lede">
            Hold to breathe on the glass, then write in it. It <em>clears on its own</em>.
          </p>
        </header>
      )}

      <div className="fog__bar">
        <div className="fog__scenes" role="radiogroup" aria-label="View">
          {SCENES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={s.id === sceneId}
              aria-label={`${s.label}: ${s.note}`}
              title={s.note}
              className="fog__scene"
              onClick={() => chooseScene(s.id)}
            >
              <img className="fog__thumb" src={s.src} alt="" width={20} height={20} draggable={false} />
              <span className="fog__scene-name">{s.label}</span>
            </button>
          ))}
        </div>
        {!embedded && (
          <button
            type="button"
            className="fog__mic"
            aria-pressed={mic === "on"}
            data-state={mic}
            title="Blow on your microphone to breathe on the glass"
            onClick={toggleMic}
          >
            {mic === "blocked" ? <MicOff size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}
            <span className="fog__mic-label">{micLabel}</span>
          </button>
        )}
      </div>
    </div>
  );
}
