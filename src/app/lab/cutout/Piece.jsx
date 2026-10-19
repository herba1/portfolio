"use client";

import { useEffect, useRef, useState } from "react";

import { albumById } from "@/app/lab/_music/catalog";
import { PRINTS } from "./cutoutPrint";
import { PAPERS } from "./cutoutEngine";
import sea from "./sea.jpg";
import dusk from "./dusk.jpg";
import "./cutout.css";

const ALBUM = albumById("rubber-soul");
const ALBUM_META = { title: ALBUM.title, artist: ALBUM.artist, year: ALBUM.year, folio: 14 };

function SpeakerIcon({ on }) {
  return (
    <svg className="cutout-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

function ScissorsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="4.2" cy="11.6" r="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="11.8" cy="11.6" r="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.6 10.2 11.4 2.6M10.4 10.2 4.6 2.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const pageRef = useRef(null);
  const sheetA = useRef(null);
  const sheetB = useRef(null);
  const layerRef = useRef(null);
  const inputRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sound, setSound] = useState(true);
  const [drafting, setDrafting] = useState(false);
  const [thumbs, setThumbs] = useState(null);
  const [printId, setPrintId] = useState(PRINTS[0].id);
  const [paperId, setPaperId] = useState(PAPERS[0].id);

  useEffect(() => {
    const pageEl = pageRef.current;
    if (!pageEl) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createCutout } = await import("./cutoutEngine");
      if (cancelled) return;
      engine = createCutout({
        root: rootRef.current,
        page: pageEl,
        sheets: [sheetA.current, sheetB.current],
        layer: layerRef.current,
        input: inputRef.current,
        sources: { dusk: dusk.src, sea: sea.src, album: ALBUM.cover },
        album: ALBUM_META,
        embedded,
        onReady: () => setReady(true),
        onFail: () => setFailed(true),
        onDraft: (on) => setDrafting(on),
        onThumbs: (next) => setThumbs(next),
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
    io.observe(pageEl);
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

  const choosePrint = (id) => {
    setPrintId(id);
    engineRef.current?.setPrint(id);
  };

  const choosePaper = (id) => {
    setPaperId(id);
    engineRef.current?.setPaper(id);
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="cutout" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      {embedded ? null : (
        <header className="cutout-caption">
          <div className="cutout-caption-text">
            <h1 className="cutout-title">Cut-out</h1>
            <p className="cutout-hint">Type a line to cut it from paper. Drag strips around; drop one off the page to bin it.</p>
          </div>
          <div className="cutout-actions">
            <button
              type="button"
              className="cutout-button"
              data-active={drafting ? "" : undefined}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => engineRef.current?.newLine()}
            >
              <ScissorsIcon />
              <span>New line</span>
            </button>
            <button type="button" className="cutout-button cutout-button-icon" aria-pressed={sound} aria-label={sound ? "Sound on" : "Sound off"} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
            </button>
          </div>
        </header>
      )}
      <div className="cutout-desk">
        <div ref={pageRef} className="cutout-page">
          <canvas ref={sheetA} className="cutout-print" aria-hidden="true" />
          <canvas ref={sheetB} className="cutout-print" aria-hidden="true" />
          <div className="cutout-sheen" aria-hidden="true" />
          <div ref={layerRef} className="cutout-layer" />
          <span className="cutout-tape" data-side="left" aria-hidden="true" />
          <span className="cutout-tape" data-side="right" aria-hidden="true" />
        </div>
        {embedded ? null : (
          <div className="cutout-rail">
            <div className="cutout-group" role="radiogroup" aria-label="Page">
              {PRINTS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={printId === p.id}
                  aria-label={p.label}
                  title={p.label}
                  className="cutout-thumb"
                  style={thumbs ? { backgroundImage: `url(${thumbs[p.id]})` } : undefined}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => choosePrint(p.id)}
                />
              ))}
            </div>
            <div className="cutout-group" role="radiogroup" aria-label="Paper">
              {PAPERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={paperId === p.id}
                  aria-label={p.label}
                  title={p.label}
                  className="cutout-chip"
                  style={{ "--chip-paper": p.paper, "--chip-ink": p.ink }}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => choosePaper(p.id)}
                >
                  <span aria-hidden="true">Aa</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        className="cutout-input"
        type="text"
        maxLength={56}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        aria-label="Type a line to cut out"
      />
      {failed ? <p className="cutout-fallback">This page needs WebGL 2.</p> : null}
    </Root>
  );
}
