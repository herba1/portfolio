"use client";

import { useEffect, useRef, useState } from "react";

import "./scanner.css";

const ITEMS = [
  { id: "sky", label: "Magazine page, sky over the bay" },
  { id: "slip", label: "Paper slip, it must be out there." },
  { id: "cover", label: "Abbey Road booklet" },
  { id: "wires", label: "Photo print, power lines at dusk" },
  { id: "slip2", label: "Paper slip, how are you?" },
];

function SpeakerIcon({ on }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createScanner } = await import("./scannerEngine");
      if (cancelled) return;
      engine = createScanner(root, { onReady: () => setReady(true), onBusy: setBusy });
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
    io.observe(root);
    return () => {
      cancelled = true;
      io.disconnect();
      engine?.destroy();
      engineRef.current = null;
    };
  }, []);

  const toggleSound = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !sound;
    setSound(next);
    const result = await engine.setSound(next);
    if (result !== next) setSound(false);
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="scanner" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div className="scanner-stage" data-scanner="stage">
        <div className="scanner-device" data-scanner="device">
          <div className="scanner-lid" aria-hidden="true">
            <div className="scanner-lid-face scanner-lid-out" />
            <div className="scanner-lid-face scanner-lid-in" />
          </div>
          <div className="scanner-body">
            <div className="scanner-bed" data-scanner="bed">
              <div className="scanner-light" data-scanner="light" />
              <svg className="scanner-dust" data-scanner="dust" aria-hidden="true" />
              <span className="scanner-corner" aria-hidden="true" />
            </div>
            <div className="scanner-rail">
              <button type="button" className="scanner-handle" data-scanner="handle" aria-label="Scan head, drag to scan by hand" />
            </div>
            <div className="scanner-panel">
              <span className="scanner-led" data-scanner="led" aria-hidden="true" />
              <button type="button" className="scanner-key" data-scanner="scan-key" disabled={busy}>
                Scan
              </button>
            </div>
          </div>
        </div>
        {ITEMS.map((item) => (
          <div key={item.id} className="scanner-item" data-item={item.id} role="img" aria-label={item.label}>
            <div className="scanner-item-face" />
            <div className="scanner-item-glow" />
          </div>
        ))}
        <section className="scanner-preview" data-scanner="preview" aria-label="Scan preview">
          <div className="scanner-preview-head">
            <span className="scanner-preview-title">Preview</span>
            <span className="scanner-preview-meta" data-scanner="meta">
              300 dpi
            </span>
          </div>
          <div className="scanner-preview-frame">
            <canvas className="scanner-preview-canvas" data-scanner="canvas" />
          </div>
          <div className="scanner-preview-actions">
            <button type="button" className="scanner-go" data-scanner="scan" disabled={busy}>
              Scan
            </button>
            <button type="button" className="scanner-pill" data-scanner="save">
              Save
            </button>
          </div>
        </section>
        {embedded ? null : (
          <header className="scanner-caption" data-scanner="caption">
            <div className="scanner-caption-text">
              <h1 className="scanner-title">Scan</h1>
              <p className="scanner-hint">Lay paper on the glass and press Scan, or pull the scan head across by hand.</p>
            </div>
            <button type="button" className="scanner-pill" aria-pressed={sound} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
              <span>{sound ? "Sound on" : "Sound off"}</span>
            </button>
          </header>
        )}
      </div>
    </Root>
  );
}
