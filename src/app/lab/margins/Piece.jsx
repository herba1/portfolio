"use client";

import { useEffect, useRef, useState } from "react";

import { META, TITLE, buildWords } from "./marginsLyric";
import "./margins.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="margins-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

function RubberIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M9.6 2.9 13.1 6.4a1.2 1.2 0 0 1 0 1.7L8.6 12.6H5.4L2.9 10.1a1.2 1.2 0 0 1 0-1.7L7.9 2.9a1.2 1.2 0 0 1 1.7 0z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M5.6 5.2 10.8 10.4M8.6 12.6H13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

const WORDS = buildWords();

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const sheetRef = useRef(null);
  const canvasRef = useRef(null);
  const notesRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(true);
  const [marks, setMarks] = useState(0);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createMargins } = await import("./marginsEngine");
      if (cancelled) return;
      engine = createMargins({
        root: rootRef.current,
        sheet,
        canvas: canvasRef.current,
        notesLayer: notesRef.current,
        embedded,
        onCount: (n) => setMarks(n),
        onReady: () => setReady(true),
      });
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
    io.observe(sheet);
    return () => {
      cancelled = true;
      io.disconnect();
      engine?.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  const toggleSound = async () => {
    const next = !sound;
    setSound(next);
    const engine = engineRef.current;
    if (!engine) return;
    const result = await engine.setSound(next);
    if (next && !result) setSound(false);
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="margins" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      {embedded ? null : (
        <header className="margins-caption">
          <div className="margins-caption-text">
            <h1 className="margins-title">Margins</h1>
            <p className="margins-hint">Circle, underline or strike through words, bracket a verse, or draw an arrow out to the margin to leave a note.</p>
          </div>
          <div className="margins-actions">
            <button type="button" className="margins-button" disabled={!marks} onClick={() => engineRef.current?.undo()}>
              <RubberIcon />
              <span>Rub out</span>
            </button>
            <button type="button" className="margins-button" aria-pressed={sound} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
              <span>{sound ? "Sound on" : "Sound off"}</span>
            </button>
          </div>
        </header>
      )}
      <div className="margins-desk">
        <article ref={sheetRef} className="margins-sheet" aria-label="Lyric sheet, draw on it to mark it up">
          <header className="margins-sheet-head">
            <h2 className="margins-sheet-title">{TITLE}</h2>
            <p className="margins-sheet-meta">{META}</p>
          </header>
          {WORDS.map((stanza, s) => (
            <div key={s} className="margins-stanza">
              {stanza.map((line, l) => (
                <p key={l} className="margins-line">
                  {line.map((word, w) => (
                    <span key={word.id}>
                      <span className="margins-word" data-w={word.id}>
                        {word.text}
                      </span>
                      {w < line.length - 1 ? " " : null}
                    </span>
                  ))}
                </p>
              ))}
            </div>
          ))}
          <p className="margins-folio">1</p>
          <canvas ref={canvasRef} className="margins-canvas" aria-hidden="true" />
          <div ref={notesRef} className="margins-notes" />
        </article>
      </div>
    </Root>
  );
}
