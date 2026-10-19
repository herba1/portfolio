"use client";

import { useEffect, useRef, useState } from "react";

import { PHOTOS, SONG, STYLES, VERSES } from "./cardData";
import "./lyric-card.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="lyric-card-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M8 2.5v7.4M4.9 7l3.1 3.1L11.1 7M3 12.8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const hostRef = useRef(null);
  const engineRef = useRef(null);
  const [style, setStyle] = useState("block");
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(false);
  const [saving, setSaving] = useState("idle");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createCard } = await import("./cardEngine");
      if (cancelled) return;
      engine = createCard(host, { verses: VERSES, photos: PHOTOS });
      engineRef.current = engine;
      await engine.ready;
      if (!cancelled) setReady(true);
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        start();
      },
      { rootMargin: "240px" },
    );
    io.observe(host);
    return () => {
      cancelled = true;
      io.disconnect();
      engine?.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (embedded) return undefined;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        engineRef.current?.next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        engineRef.current?.prev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [embedded]);

  const chooseStyle = (id) => {
    setStyle(id);
    engineRef.current?.setStyle(id);
  };

  const toggleSound = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !sound;
    setSound(next);
    const result = await engine.setSound(next);
    if (result !== next) setSound(false);
  };

  const save = async () => {
    const engine = engineRef.current;
    if (!engine || saving === "saving") return;
    setSaving("saving");
    const blob = await engine.exportBlob().catch(() => null);
    if (!blob) {
      setSaving("idle");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${SONG.title}-lyric-card.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setSaving("saved");
    setTimeout(() => setSaving("idle"), 1800);
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root className="lyric-card" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      {embedded ? null : (
        <header className="lyric-card-caption">
          <div className="lyric-card-caption-text">
            <h1 className="lyric-card-title">Lyric Card</h1>
            <p className="lyric-card-hint">Every word cuts in on the beat. Click the card for the next verse.</p>
          </div>
          <div className="lyric-card-tools">
            <div className="lyric-card-styles" role="radiogroup" aria-label="Type">
              {STYLES.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={style === s.id} className="lyric-card-style" data-face={s.id} onClick={() => chooseStyle(s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
            <button type="button" className="lyric-card-icon" aria-pressed={sound} aria-label={sound ? "Beat on" : "Beat off"} title={sound ? "Beat on" : "Beat off"} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
            </button>
            <button type="button" className="lyric-card-icon" aria-label="Save as PNG" title="Save as PNG" onClick={save} disabled={saving === "saving"} data-saved={saving === "saved" ? "" : undefined}>
              <DownloadIcon />
            </button>
          </div>
        </header>
      )}
      <div className="lyric-card-stage">
        <button type="button" ref={hostRef} className="lyric-card-frame" onClick={() => engineRef.current?.next()} aria-label="Next verse" />
      </div>
    </Root>
  );
}
