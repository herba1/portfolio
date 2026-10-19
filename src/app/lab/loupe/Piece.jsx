"use client";

import { useEffect, useRef, useState } from "react";

import { CARDS } from "./loupeCards";
import { createLoupeEngine } from "./loupeEngine";
import "./loupe.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const tagRef = useRef(null);
  const sliderRef = useRef(null);
  const headRef = useRef(null);
  const footRef = useRef(null);
  const engineRef = useRef(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const root = rootRef.current;
    const insets = () => {
      if (embedded) return { top: 20, bottom: 20 };
      const boxRect = root.getBoundingClientRect();
      const head = headRef.current?.getBoundingClientRect();
      const foot = footRef.current?.getBoundingClientRect();
      const wide = boxRect.width >= 900;
      const top = wide ? 76 : head ? head.bottom - boxRect.top + 16 : 84;
      const bottom = foot ? boxRect.bottom - foot.top + 16 : 24;
      return { top, bottom };
    };
    const engine = createLoupeEngine({
      box: root,
      stage: stageRef.current,
      canvas: canvasRef.current,
      tag: tagRef.current,
      slider: sliderRef.current,
      insets,
      embedded,
      onSelect: (idx) => setActive(idx),
      onFail: () => {
        root.dataset.fallback = "true";
      },
      onReady: () => {
        if (!root.dataset.ready) root.dataset.ready = "true";
      },
    });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  return (
    <div ref={rootRef} className="loupe" data-embedded={embedded ? "" : undefined}>
      <div
        ref={stageRef}
        className="loupe__stage"
        tabIndex={0}
        role="application"
        aria-label="A Beatles record sleeve on a dark desk under a magnifying loupe, lit by a low sun that the glass focuses into a hot spot. Move the pointer or the arrow keys to move the loupe, scroll, pinch or press plus and minus to change magnification, and press 1 to 4 to change record."
      >
        <canvas ref={canvasRef} className="loupe__canvas" />
        <img className="loupe__fallback" src={CARDS[active].src} alt={`${CARDS[active].full}, ${CARDS[active].year}`} draggable={false} />
      </div>

      {!embedded && (
        <header ref={headRef} className="loupe__head">
          <h1 className="loupe__title">Loupe</h1>
          <p className="loupe__lede">
            Slide the glass over a sleeve and turn it up. The low sun burns to a point beside it, and up close the cover is <em>only ink</em>.
          </p>
        </header>
      )}

      {!embedded && (
        <footer ref={footRef} className="loupe__foot">
          <div className="loupe__cards" role="radiogroup" aria-label="Record">
            {CARDS.map((card, i) => (
              <button
                key={card.key}
                type="button"
                role="radio"
                aria-checked={active === i}
                aria-label={`${card.full}, ${card.year}`}
                className="loupe__card"
                onClick={() => engineRef.current?.select(i)}
              >
                <img className="loupe__thumb" src={card.src} alt="" width={32} height={32} draggable={false} />
                <span className="loupe__card-name">{card.name}</span>
              </button>
            ))}
          </div>
          <label className="loupe__zoom">
            <input ref={sliderRef} className="loupe__range" type="range" min="0" max="1000" step="1" defaultValue="544" aria-label="Magnification, 2 to 20 times" />
            <span ref={tagRef} className="loupe__zoom-value" aria-hidden="true">7.0×</span>
          </label>
        </footer>
      )}
    </div>
  );
}
