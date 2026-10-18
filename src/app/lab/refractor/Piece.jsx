"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";
import { DEFAULT_CARDS, FOILS, cardsFromTracks } from "./refractorCards";
import { createRefractorAudio } from "./refractorAudio";
import { createRefractorEngine } from "./refractorEngine";
import "./refractor.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const footRef = useRef(null);
  const engineRef = useRef(null);
  const [active, setActive] = useState(0);
  const [foil, setFoil] = useState(0);
  const [motion, setMotion] = useState("hidden");
  const { tracks, live } = useTopSongs(40);
  const cards = useMemo(() => (live ? cardsFromTracks(tracks) : DEFAULT_CARDS), [live, tracks]);
  const cardsRef = useRef(cards);

  useEffect(() => {
    const root = rootRef.current;
    const insets = () => {
      if (embedded) return { top: 24, bottom: 28 };
      const boxRect = root.getBoundingClientRect();
      const head = headRef.current?.getBoundingClientRect();
      const foot = footRef.current?.getBoundingClientRect();
      const wide = boxRect.width >= 900;
      const top = wide ? 84 : head ? head.bottom - boxRect.top + 28 : 100;
      const bottom = foot ? boxRect.bottom - foot.top + 28 : 36;
      return { top, bottom };
    };
    const audio = createRefractorAudio();
    const wakeAudio = () => audio.start();
    root.addEventListener("pointerdown", wakeAudio);
    root.addEventListener("keydown", wakeAudio);
    const engine = createRefractorEngine({
      box: root,
      cards: cardsRef.current,
      onRiffle: () => audio.snap(),
      stage: stageRef.current,
      canvas: canvasRef.current,
      insets,
      embedded,
      onSelect: (idx) => setActive(idx),
      onFoil: (idx) => setFoil(idx),
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
      root.removeEventListener("pointerdown", wakeAudio);
      root.removeEventListener("keydown", wakeAudio);
      audio.destroy();
      engine.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  useEffect(() => {
    cardsRef.current = cards;
    engineRef.current?.setCards(cards);
  }, [cards]);

  const enableMotion = () => {
    engineRef.current?.enableMotion().then((ok) => {
      if (!ok) setMotion("denied");
    });
  };

  const current = cards[active] || cards[0];

  return (
    <div ref={rootRef} className="refractor" data-embedded={embedded ? "" : undefined}>
      <div
        ref={stageRef}
        className="refractor__stage"
        tabIndex={0}
        role="application"
        aria-label={`A chrome refractor card of ${current.title} by ${current.artist} in a penny sleeve, ${FOILS[foil].name.toLowerCase()} foil. Move the pointer to tilt it, flick it hard to spin to the next record, or tilt your phone. Arrow keys tilt, space spins to the next card, 1 to 3 change the foil, brackets change the card.`}
      >
        <canvas ref={canvasRef} className="refractor__canvas" />
        <img className="refractor__fallback" src={current.src} alt={`${current.title} by ${current.artist}`} draggable={false} />
      </div>

      {!embedded && (
        <header ref={headRef} className="refractor__head">
          <h1 className="refractor__title">Refractor</h1>
          <p className="refractor__lede">
            Album covers reprinted on chrome. Tilt it and the foil splits the light <em>into colour</em>; flick it hard and the next record spins in.
          </p>
        </header>
      )}

      {!embedded && (
        <footer ref={footRef} className="refractor__foot">
          <div className="refractor__tray" role="radiogroup" aria-label="Foil">
            {FOILS.map((f, i) => (
              <button
                key={f.key}
                type="button"
                role="radio"
                aria-checked={foil === i}
                aria-label={`${f.name}, ${f.note.toLowerCase()}`}
                className="refractor__foil"
                data-foil={f.key}
                onClick={() => engineRef.current?.setFoil(i)}
              >
                <span className="refractor__chip" aria-hidden="true" />
                <span className="refractor__foil-name">{f.name}</span>
              </button>
            ))}
          </div>
          <div className="refractor__tray" role="radiogroup" aria-label="Card">
            {cards.map((card, i) => (
              <button
                key={card.key}
                type="button"
                role="radio"
                aria-checked={active === i}
                aria-label={`${card.title}, ${card.artist}`}
                title={card.title}
                className="refractor__card"
                onClick={() => engineRef.current?.select(i)}
              >
                <img className="refractor__thumb" src={card.src} alt="" width={28} height={28} draggable={false} />
              </button>
            ))}
          </div>
          {motion !== "hidden" && (
            <button
              type="button"
              className="refractor__motion"
              data-state={motion}
              onClick={enableMotion}
              disabled={motion === "on" || motion === "denied"}
            >
              {motion === "on" ? "Tilting with your phone" : motion === "denied" ? "Motion blocked, drag instead" : "Tilt with your phone"}
            </button>
          )}
        </footer>
      )}
    </div>
  );
}
