"use client";

import { useEffect, useRef, useState } from "react";

import { LAYOUTS, LYRICS, MAX_LINES, PHOTOS, SONG } from "./cardData";
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

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3.5 8.4l2.9 2.9 6.1-6.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function ReplayIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <path d="M3.4 2.4v2.8h2.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
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

const INITIAL = { lines: [4], layout: "block", photo: "beams", grain: 0.45, bloom: 0.5, serif: false };

export default function Piece({ embedded = false }) {
  const hostRef = useRef(null);
  const engineRef = useRef(null);
  const stateRef = useRef(null);
  const prevRef = useRef(null);
  const [selected, setSelected] = useState(INITIAL.lines);
  const [layout, setLayout] = useState(INITIAL.layout);
  const [photo, setPhoto] = useState(INITIAL.photo);
  const [grain, setGrain] = useState(INITIAL.grain);
  const [bloom, setBloom] = useState(INITIAL.bloom);
  const [serif, setSerif] = useState(INITIAL.serif);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState(false);
  const [saving, setSaving] = useState("idle");

  useEffect(() => {
    const next = { lines: selected.map((i) => LYRICS[i]), layout, photo, grain, bloom, serif };
    const prev = prevRef.current;
    prevRef.current = next;
    stateRef.current = next;
    const engine = engineRef.current;
    if (!engine) return;
    const replay = Boolean(prev) && (prev.lines.join("|") !== next.lines.join("|") || prev.layout !== layout || prev.photo !== photo || prev.serif !== serif);
    engine.set(next, { replay });
  }, [selected, layout, photo, grain, bloom, serif]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createCard } = await import("./cardEngine");
      if (cancelled) return;
      engine = createCard(host, {
        photos: PHOTOS,
        onState: (s) => {
          if (s.playing !== undefined) setPlaying(s.playing);
        },
      });
      engineRef.current = engine;
      engine.set(stateRef.current);
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

  const toggleLine = (index) => {
    const on = !selected.includes(index);
    engineRef.current?.tick(on);
    setSelected((list) => {
      if (list.includes(index)) return list.filter((i) => i !== index);
      const grown = [...list, index];
      const trimmed = grown.length > MAX_LINES ? grown.slice(grown.length - MAX_LINES) : grown;
      return trimmed.sort((a, b) => a - b);
    });
  };

  const toggleSound = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !sound;
    setSound(next);
    const result = await engine.setSound(next);
    if (result !== next) setSound(false);
  };

  const replay = () => engineRef.current?.replay();

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
  const current = PHOTOS.find((p) => p.id === photo) || PHOTOS[0];

  return (
    <Root className="lyric-card" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div className="lyric-card-scroll" data-scroll-contain="">
        {embedded ? null : (
          <header className="lyric-card-caption">
            <div className="lyric-card-caption-text">
              <h1 className="lyric-card-title">Lyric Card</h1>
              <p className="lyric-card-hint">Tap lines to share them. The card cuts them in word by word, like an edit.</p>
            </div>
            <button type="button" className="lyric-card-pill" aria-pressed={sound} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
              <span>{sound ? "Beat on" : "Beat off"}</span>
            </button>
          </header>
        )}
        <div className="lyric-card-grid">
          <section className="lyric-card-lyrics" aria-label="Lyrics">
            <div className="lyric-card-song">
              <span className="lyric-card-cover" style={{ backgroundImage: `url(${PHOTOS[1].src})` }} aria-hidden="true" />
              <div className="lyric-card-song-text">
                <p className="lyric-card-song-title">{SONG.title}</p>
                <p className="lyric-card-song-meta">
                  {SONG.artist} · <span className="lyric-card-count">{selected.length} of {MAX_LINES} lines</span>
                </p>
              </div>
            </div>
            <ol className="lyric-card-lines">
              {LYRICS.map((line, i) => {
                const on = selected.includes(i);
                return (
                  <li key={line}>
                    <button type="button" className="lyric-card-line" aria-pressed={on} onClick={() => toggleLine(i)}>
                      <span className="lyric-card-line-text">{line}</span>
                      <span className="lyric-card-line-check">
                        <CheckIcon />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>

          <div className="lyric-card-stage">
            <button type="button" ref={hostRef} className="lyric-card-frame" data-playing={playing ? "" : undefined} onClick={replay} aria-label="Play the card again">
              <span className="lyric-card-empty" data-show={selected.length ? undefined : ""}>
                Pick a line
              </span>
            </button>
          </div>

          <section className="lyric-card-controls" aria-label="Card settings">
            <div className="lyric-card-group">
              <p className="lyric-card-label">Layout</p>
              <div className="lyric-card-segments" role="radiogroup" aria-label="Layout">
                {LAYOUTS.map((l) => (
                  <button key={l.id} type="button" role="radio" aria-checked={layout === l.id} className="lyric-card-segment" onClick={() => setLayout(l.id)}>
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="lyric-card-group">
              <p className="lyric-card-label">
                Photo <span className="lyric-card-label-note">{current.label}</span>
              </p>
              <div className="lyric-card-photos" role="radiogroup" aria-label="Photo">
                {PHOTOS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={photo === p.id}
                    aria-label={p.label}
                    className="lyric-card-photo"
                    style={{ backgroundImage: `url(${p.src})`, backgroundPosition: `${p.focus[0] * 100}% ${p.focus[1] * 100}%` }}
                    onClick={() => setPhoto(p.id)}
                  />
                ))}
              </div>
            </div>
            <div className="lyric-card-group lyric-card-sliders">
              <label className="lyric-card-slider">
                <span className="lyric-card-label">Grain</span>
                <input type="range" min="0" max="1" step="0.01" value={grain} onChange={(e) => setGrain(Number(e.target.value))} style={{ "--lyric-card-fill": `${grain * 100}%` }} />
              </label>
              <label className="lyric-card-slider">
                <span className="lyric-card-label">Bloom</span>
                <input type="range" min="0" max="1" step="0.01" value={bloom} onChange={(e) => setBloom(Number(e.target.value))} style={{ "--lyric-card-fill": `${bloom * 100}%` }} />
              </label>
            </div>
            <div className="lyric-card-group">
              <p className="lyric-card-label">Type</p>
              <div className="lyric-card-segments" role="radiogroup" aria-label="Typeface">
                <button type="button" role="radio" aria-checked={!serif} className="lyric-card-segment lyric-card-face-sans" onClick={() => setSerif(false)}>
                  Arimo
                </button>
                <button type="button" role="radio" aria-checked={serif} className="lyric-card-segment lyric-card-face-serif" onClick={() => setSerif(true)}>
                  Serif
                </button>
              </div>
            </div>
            <div className="lyric-card-actions">
              <button type="button" className="lyric-card-button" onClick={replay} disabled={!selected.length}>
                <ReplayIcon />
                <span>Replay</span>
              </button>
              <button type="button" className="lyric-card-button lyric-card-button-primary" onClick={save} disabled={!selected.length || saving === "saving"}>
                <DownloadIcon />
                <span>{saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : "Save PNG"}</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </Root>
  );
}
