"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "./embroidery.css";

const PORTRAITS = [
  { key: "john", label: "John" },
  { key: "paul", label: "Paul" },
  { key: "george", label: "George" },
];

const THREADS = [
  { key: "redwork", label: "Redwork", short: "Red", swatch: "rgb(176, 28, 38)" },
  { key: "bluework", label: "Bluework", short: "Blue", swatch: "rgb(36, 60, 138)" },
  { key: "blackwork", label: "Blackwork", short: "Black", swatch: "rgb(34, 33, 37)" },
];

const STEP_KEYS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

function Choice({ label, options, value, onChange }) {
  const index = Math.max(0, options.findIndex((o) => o.key === value));
  const onKeyDown = (event) => {
    const dir = STEP_KEYS[event.key];
    if (!dir) return;
    event.preventDefault();
    const next = (index + dir + options.length) % options.length;
    const buttons = event.currentTarget.querySelectorAll("[role=radio]");
    buttons[next]?.focus();
    onChange(options[next].key);
  };
  return (
    <div className="embroidery__choice">
      <span className="embroidery__choice-label">{label}</span>
      <div className="embroidery__rail" role="radiogroup" aria-label={label} onKeyDown={onKeyDown} style={{ "--embroidery-count": options.length, "--embroidery-index": index }}>
        <span className="embroidery__pill" aria-hidden="true" />
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={option.key === value}
            tabIndex={option.key === value ? 0 : -1}
            className="embroidery__option"
            onClick={() => onChange(option.key)}
          >
            {option.swatch ? <span className="embroidery__swatch" style={{ background: option.swatch }} aria-hidden="true" /> : null}
            {option.short ? (
              <>
                <span className="embroidery__long">{option.label}</span>
                <span className="embroidery__short">{option.short}</span>
              </>
            ) : (
              option.label
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Piece({ embedded = false }) {
  const boxRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const countRef = useRef(null);
  const [portrait, setPortrait] = useState("paul");
  const [thread, setThread] = useState("redwork");
  const [ready, setReady] = useState(false);
  const initial = useRef({ portrait: "paul", thread: "redwork" });

  const onStat = useCallback((done, total) => {
    const el = countRef.current;
    if (!el) return;
    el.textContent = `${done.toLocaleString("en-GB")} of ${total.toLocaleString("en-GB")} stitches`;
  }, []);

  useEffect(() => {
    let engine = null;
    let cancelled = false;
    import("./embroideryEngine").then(({ default: Engine }) => {
      if (cancelled || !canvasRef.current || !boxRef.current) return;
      engine = new Engine({
        canvas: canvasRef.current,
        box: boxRef.current,
        embedded,
        portrait: initial.current.portrait,
        thread: initial.current.thread,
        onStat,
        onReady: () => setReady(true),
      });
      engineRef.current = engine;
    });
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
    };
  }, [embedded, onStat]);

  const choosePortrait = useCallback((key) => {
    initial.current.portrait = key;
    setPortrait(key);
    engineRef.current?.setPortrait(key);
  }, []);

  const chooseThread = useCallback((key) => {
    initial.current.thread = key;
    setThread(key);
    engineRef.current?.setThread(key);
  }, []);

  return (
    <div ref={boxRef} className="embroidery" data-embedded={embedded || undefined} data-ready={ready || undefined}>
      <canvas
        ref={canvasRef}
        className="embroidery__canvas"
        width={0}
        height={0}
        tabIndex={0}
        role="application"
        aria-roledescription="embroidery hoop"
        aria-label="A portrait embroidered on linen with one continuous red thread, its loose end hanging from the hoop with a needle. Drag the thread to unpick the stitches; let go and it sews itself back. Press the down arrow to unpick, R to sew back."
      />
      {embedded ? null : (
        <div className="embroidery__panel">
          <header className="embroidery__head">
            <h1 className="embroidery__title">Embroidery</h1>
            <p className="embroidery__hint">
              One thread, start to finish. Pull the loose end to unpick it, <em>let go</em> and it sews itself back.
            </p>
          </header>
          <div className="embroidery__controls">
            <Choice label="Portrait" options={PORTRAITS} value={portrait} onChange={choosePortrait} />
            <Choice label="Thread" options={THREADS} value={thread} onChange={chooseThread} />
          </div>
          <p ref={countRef} className="embroidery__count" aria-live="off" />
        </div>
      )}
    </div>
  );
}
