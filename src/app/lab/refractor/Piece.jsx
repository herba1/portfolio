"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCcw, Smartphone } from "lucide-react";

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
  const [face, setFace] = useState(0);
  const { tracks, live } = useTopSongs(40);
  const cards = useMemo(
    () => (live ? cardsFromTracks(tracks) : DEFAULT_CARDS),
    [live, tracks],
  );
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
      onFace: (side) => setFace(side),
      onFail: () => {
        root.dataset.fallback = "true";
      },
      onReady: () => {
        if (!root.dataset.ready) root.dataset.ready = "true";
        if (!embedded && engine.motionAvailable())
          setMotion((m) => (m === "hidden" ? "off" : m));
      },
      onMotion: (state) => setMotion(state),
    });
    engineRef.current = engine;
    const chrome = new ResizeObserver(() => engine.relayout());
    if (headRef.current) chrome.observe(headRef.current);
    if (footRef.current) chrome.observe(footRef.current);
    return () => {
      chrome.disconnect();
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
    <div
      ref={rootRef}
      className="refractor"
      data-embedded={embedded ? "" : undefined}
    >
      <div
        ref={stageRef}
        className="refractor__stage"
        tabIndex={0}
        role="application"
        aria-label={`A ${FOILS[foil].name.toLowerCase()} compact disc of ${current.title} by ${current.artist}, ${face ? "printed label" : "data side"} up. Move the pointer to tilt it through the rainbow, tap it to turn it over, flick it hard to spin to the next record, or tilt your phone. Arrow keys tilt, F turns it over, space spins to the next disc, 1 to 3 change the disc, brackets change the record.`}
      >
        <canvas ref={canvasRef} className="refractor__canvas" />
        <img
          className="refractor__fallback"
          src={current.src}
          alt={`${current.title} by ${current.artist}`}
          draggable={false}
        />
      </div>

      {!embedded && (
        <header ref={headRef} className="refractor__head">
          <h1 className="refractor__title">Compact Disc</h1>
          <p className="refractor__lede">
            Tilt it and the tracks split the light <em>into colour</em>. Tap to
            turn it over to the label; flick it hard and the next record spins
            in.
          </p>
        </header>
      )}

      {!embedded && (
        <footer ref={footRef} className="refractor__foot">
          <div className="refractor__tray" role="radiogroup" aria-label="Disc">
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
          <div className="refractor__tools">
            <button
              type="button"
              className="refractor__motion"
              aria-label={
                face ? "Turn over to the data side" : "Turn over to the label"
              }
              onClick={() => engineRef.current?.flip()}
            >
              <RefreshCcw
                className="refractor__motion-icon"
                size={18}
                strokeWidth={1.75}
                aria-hidden="true"
              />
              <span className="refractor__motion-label">
                {face ? "Data side" : "Label"}
              </span>
            </button>
            {motion !== "hidden" && (
              <button
                type="button"
                className="refractor__motion"
                data-state={motion}
                onClick={enableMotion}
                aria-label={
                  motion === "on"
                    ? "Tilting with your phone"
                    : motion === "denied"
                      ? "Motion blocked, drag instead"
                      : "Tilt with your phone"
                }
                disabled={motion === "on" || motion === "denied"}
              >
                <Smartphone
                  className="refractor__motion-icon"
                  size={18}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <span className="refractor__motion-label">
                  {motion === "on"
                    ? "Tilting with your phone"
                    : motion === "denied"
                      ? "Motion blocked, drag instead"
                      : "Tilt with your phone"}
                </span>
              </button>
            )}
          </div>
          <div
            className="refractor__tray"
            role="radiogroup"
            aria-label="Record"
          >
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
                <img
                  className="refractor__thumb"
                  src={card.src}
                  alt=""
                  width={28}
                  height={28}
                  draggable={false}
                />
              </button>
            ))}
          </div>
        </footer>
      )}
    </div>
  );
}
