"use client";

import { useEffect, useRef, useState } from "react";

import { CARDS } from "./lenticularCards";
import { createLenticularEngine } from "./lenticularEngine";
import "./lenticular.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const footRef = useRef(null);
  const engineRef = useRef(null);
  const [active, setActive] = useState(0);
  const [motion, setMotion] = useState("hidden");

  useEffect(() => {
    const root = rootRef.current;
    const insets = () => {
      if (embedded) return { top: 16, bottom: 24 };
      const boxRect = root.getBoundingClientRect();
      const head = headRef.current?.getBoundingClientRect();
      const foot = footRef.current?.getBoundingClientRect();
      const wide = boxRect.width >= 900;
      const top = wide ? 80 : head ? head.bottom - boxRect.top + 24 : 96;
      const bottom = foot ? boxRect.bottom - foot.top + 24 : 32;
      return { top, bottom };
    };
    const engine = createLenticularEngine({
      box: root,
      stage: stageRef.current,
      canvas: canvasRef.current,
      insets,
      embedded,
      onSelect: (idx) => setActive(idx),
      onFail: () => {
        root.dataset.fallback = "true";
      },
      onReady: () => {
        if (!root.dataset.ready) root.dataset.ready = "true";
        if (!embedded && engine.motionAvailable()) setMotion((m) => (m === "hidden" ? "off" : m));
      },
      onMotion: (state) => setMotion(state),
    });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  const enableMotion = () => {
    engineRef.current?.enableMotion().then((ok) => {
      if (!ok) setMotion("denied");
    });
  };

  const current = CARDS[active];

  return (
    <div ref={rootRef} className="lenticular" data-embedded={embedded ? "" : undefined}>
      <div
        ref={stageRef}
        className="lenticular__stage"
        tabIndex={0}
        role="application"
        aria-label={`A lenticular flip card: ${current.full}. Move the pointer over it, drag it, or tilt your phone and the sleeve turns into its song. Tap the card, press Enter, or use 1 to 4 for the next card.`}
      >
        <canvas ref={canvasRef} className="lenticular__canvas" />
        <img className="lenticular__fallback" src={current.src} alt={`${current.album.title} cover`} draggable={false} />
      </div>

      {!embedded && (
        <header ref={headRef} className="lenticular__head">
          <h1 className="lenticular__title">Lenticular</h1>
          <p className="lenticular__lede">
            A flip card from a 1960s record shop. Tilt it and the sleeve turns into its song <em>in the plastic</em>; tap it for the next.
          </p>
        </header>
      )}

      {!embedded && (
        <footer ref={footRef} className="lenticular__foot">
          <div className="lenticular__cards" role="radiogroup" aria-label="Card">
            {CARDS.map((card, i) => (
              <button
                key={card.key}
                type="button"
                role="radio"
                aria-checked={active === i}
                aria-label={card.full}
                style={{ "--lenticular-paper": card.paper }}
                className="lenticular__card"
                onClick={() => engineRef.current?.select(i)}
              >
                <span className="lenticular__thumb" aria-hidden="true">
                  <img src={card.album.cover} alt="" width={32} height={32} draggable={false} />
                  <span className="lenticular__thumb-paper" />
                </span>
                <span className="lenticular__card-name">{card.song}</span>
              </button>
            ))}
          </div>
          {motion !== "hidden" && (
            <button
              type="button"
              className="lenticular__motion"
              data-state={motion}
              onClick={enableMotion}
              disabled={motion === "on" || motion === "denied"}
            >
              {motion === "on" ? "Tilting" : motion === "denied" ? "Drag to tilt" : "Use tilt"}
            </button>
          )}
        </footer>
      )}
    </div>
  );
}
