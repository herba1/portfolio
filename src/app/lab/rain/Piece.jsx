"use client";

import { useEffect, useRef, useState } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import RainEngine from "./rainEngine";
import { RAIN_DEFAULT, SCENES } from "./rainScenes";
import "./rain.css";

const GLASS_LABEL =
  "A rainy window. Drops bead on the glass, merge and run down, each holding a tiny upside-down view of the scene outside. Drag across the glass to wipe a clear streak; it fogs and beads back over. Press Enter to wipe, and 1 to 3 to change the song and the view.";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const glassRef = useRef(null);
  const canvasRef = useRef(null);
  const cursorRef = useRef(null);
  const engineRef = useRef(null);
  const sceneRef = useRef(SCENES[0].id);
  const near = useNearViewport(rootRef);
  const [sceneId, setSceneId] = useState(SCENES[0].id);
  const [rain, setRainValue] = useState(RAIN_DEFAULT);

  useEffect(() => {
    if (!near) return undefined;
    const root = rootRef.current;
    const engine = new RainEngine({
      host: glassRef.current,
      canvas: canvasRef.current,
      cursor: cursorRef.current,
      onReady: () => root.setAttribute("data-ready", ""),
      onFail: () => root.setAttribute("data-fallback", ""),
    });
    engineRef.current = engine;
    engine.start(sceneRef.current);
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [near]);

  const chooseScene = (id) => {
    sceneRef.current = id;
    setSceneId(id);
    engineRef.current?.setScene(id);
  };

  const changeRain = (value) => {
    setRainValue(value);
    engineRef.current?.setRain(value);
  };

  const onGlassKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      engineRef.current?.wipeNow();
      return;
    }
    const index = Number(e.key) - 1;
    if (index >= 0 && index < SCENES.length) {
      e.preventDefault();
      chooseScene(SCENES[index].id);
    }
  };

  const scene = SCENES.find((s) => s.id === sceneId) || SCENES[0];

  return (
    <div ref={rootRef} className="rain" data-embedded={embedded ? "" : undefined}>
      <div ref={glassRef} className="rain__glass" tabIndex={0} role="application" aria-label={GLASS_LABEL} onKeyDown={onGlassKey}>
        <div className="rain__fallback" style={{ backgroundImage: `url(${scene.src})` }} />
        <canvas ref={canvasRef} className="rain__canvas" />
        <span ref={cursorRef} className="rain__cursor" aria-hidden="true" />
      </div>

      {!embedded && (
        <header className="rain__head">
          <h1 className="rain__title">Rain</h1>
          <p className="rain__lede">
            Drag across the glass to wipe it. It <em>fogs back</em> on its own.
          </p>
        </header>
      )}

      <div className="rain__bar">
        <div className="rain__scenes" role="radiogroup" aria-label="Song">
          {SCENES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={s.id === sceneId}
              aria-label={`${s.song}, from ${s.album.title}. ${s.view}`}
              className="rain__scene"
              onClick={() => chooseScene(s.id)}
            >
              <img className="rain__thumb" src={s.album.cover} alt="" width={36} height={36} draggable={false} />
              <span className="rain__scene-text">
                <span className="rain__scene-name">{s.song}</span>
                <span className="rain__scene-album">{s.album.title}</span>
              </span>
            </button>
          ))}
        </div>
        {!embedded && (
          <label className="rain__amount">
            <span className="rain__amount-label">Rain</span>
            <input
              className="rain__range"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={rain}
              onChange={(e) => changeRain(Number(e.target.value))}
            />
          </label>
        )}
      </div>
    </div>
  );
}
