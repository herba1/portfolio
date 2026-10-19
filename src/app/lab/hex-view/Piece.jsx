"use client";

import { useEffect, useRef, useState } from "react";

import { albumById } from "@/app/lab/_music/catalog";

import "./hex-view.css";

const COVERS = ["abbey-road", "help", "revolver", "let-it-be", "magical-mystery-tour"].map(albumById);
const COLUMNS16 = "00 01 02 03 04 05 06 07  08 09 0A 0B 0C 0D 0E 0F";
const COLUMNS8 = "00 01 02 03 04 05 06 07";

function SpeakerIcon({ on }) {
  return (
    <svg className="hex-view-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
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
  const dumpRef = useRef(null);
  const canvasRef = useRef(null);
  const plateRef = useRef(null);
  const hoverRef = useRef(null);
  const selRef = useRef(null);
  const inputRef = useRef(null);
  const statusRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(false);
  const [edited, setEdited] = useState(0);
  const [cover, setCover] = useState(COVERS[0].id);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createHexView } = await import("./hexEngine");
      if (cancelled) return;
      engine = createHexView({
        dump: dumpRef.current,
        canvas: canvasRef.current,
        plate: plateRef.current,
        hoverBox: hoverRef.current,
        selBox: selRef.current,
        input: inputRef.current,
        status: statusRef.current,
        onFile: setEdited,
      });
      engineRef.current = engine;
      await engine.start(COVERS[0].cover);
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

  const pick = (album) => {
    if (album.id === cover) return;
    setCover(album.id);
    engineRef.current?.setCover(album.cover);
  };

  const save = () => {
    const engine = engineRef.current;
    if (!engine) return;
    const url = URL.createObjectURL(engine.file());
    const a = document.createElement("a");
    a.href = url;
    a.download = `${cover}.bmp`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const current = COVERS.find((a) => a.id === cover);
  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="hex-view" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div className="hex-view-side">
        {embedded ? null : (
          <header className="hex-view-caption">
            <h1 className="hex-view-title">Hex</h1>
            <p className="hex-view-hint">The cover as a real 32 by 32 bitmap, every byte on screen. Hover to see which pixel a byte paints, click one and type to change it.</p>
          </header>
        )}
        <div ref={plateRef} className="hex-view-plate" role="img" aria-label={`${current.title} by ${current.artist} as a 32 by 32 pixel bitmap`}>
          <canvas ref={canvasRef} className="hex-view-canvas" />
          <span className="hex-view-grid" aria-hidden="true" />
          <span ref={hoverRef} className="hex-view-box hex-view-box-hover" data-on="false" aria-hidden="true" />
          <span ref={selRef} className="hex-view-box hex-view-box-sel" data-on="false" aria-hidden="true" />
        </div>
        {embedded ? null : (
          <div className="hex-view-controls">
            <div className="hex-view-covers" role="radiogroup" aria-label="Cover">
              {COVERS.map((album) => (
                <button
                  key={album.id}
                  type="button"
                  role="radio"
                  aria-checked={album.id === cover}
                  aria-label={album.title}
                  className="hex-view-cover"
                  onClick={() => pick(album)}
                  style={{ backgroundImage: `url(${album.cover})` }}
                />
              ))}
            </div>
            <div className="hex-view-buttons">
              <button type="button" className="hex-view-button" onClick={save}>
                Save .bmp
              </button>
              <button type="button" className="hex-view-button" onClick={() => engineRef.current?.reset()} disabled={!edited}>
                Restore
              </button>
              <button type="button" className="hex-view-button" aria-pressed={sound} onClick={toggleSound} aria-label={sound ? "Keys on" : "Keys off"}>
                <SpeakerIcon on={sound} />
              </button>
            </div>
          </div>
        )}
      </div>
      <section className="hex-view-screen" aria-label="Hex dump">
        <div className="hex-view-head" aria-hidden="true">
          <span className="hex-view-off">offset</span>
          <span className="hex-view-hex hex-view-cols-16">{COLUMNS16}</span>
          <span className="hex-view-hex hex-view-cols-8">{COLUMNS8}</span>
          <span className="hex-view-asc">ascii</span>
        </div>
        <div ref={dumpRef} className="hex-view-dump" data-scroll-contain />
        <div className="hex-view-foot">
          <p ref={statusRef} className="hex-view-status" aria-live="polite" />
          <p className="hex-view-file">
            {current.id}.bmp, 3,126 bytes{edited ? `, ${edited} changed` : ""}
          </p>
        </div>
        <input
          ref={inputRef}
          className="hex-view-input"
          type="text"
          inputMode="text"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Type to overwrite the selected byte. Arrow keys move, Tab switches between hex and text."
        />
      </section>
    </Root>
  );
}
