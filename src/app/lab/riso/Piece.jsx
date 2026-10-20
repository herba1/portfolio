"use client";

import { useEffect, useRef, useState } from "react";

import { COVERS, INKS, LINES } from "./risoEngine";
import "./riso.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="riso-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

function Arrow({ dir }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d={dir < 0 ? "M10 3.5L5.5 8l4.5 4.5" : "M6 3.5L10.5 8 6 12.5"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

const fmt = (v) => {
  const r = Math.round(v * 10) / 10;
  if (Object.is(r, -0) || r === 0) return "0.0";
  return r < 0 ? `−${Math.abs(r).toFixed(1)}` : `+${r.toFixed(1)}`;
};

export default function Piece({ embedded = false }) {
  const stageRef = useRef(null);
  const sheetRef = useRef(null);
  const underRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(false);
  const [failed, setFailed] = useState(false);
  const [state, setState] = useState({ offsets: [[0, 0], [0, 0], [0, 0]], printing: false, content: { cover: 0, line: 0 }, active: 1 });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let cancelled = false;
    let engine = null;
    const start = () => {
      if (cancelled) return;
      import("./risoEngine").then(({ createRiso }) => {
        if (cancelled) return;
        engine = createRiso({ sheet: sheetRef.current, under: underRef.current, onState: (s) => setState((prev) => ({ ...prev, ...s, content: s.content || prev.content })), onFail: () => setFailed(true) });
        engineRef.current = engine;
        setReady(true);
      });
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        start();
      },
      { rootMargin: "240px" },
    );
    io.observe(stage);
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

  const cover = state.content?.cover ?? 0;
  const line = state.content?.line ?? 0;
  const pull = (c, l) => engineRef.current?.pull(c, l);
  const stepLine = (d) => pull(cover, (line + d + LINES.length) % LINES.length);
  const choose = (i) => engineRef.current?.setActive(i);

  const onKeyDown = (e) => {
    const engine = engineRef.current;
    if (!engine) return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (dirs[e.key] && e.target === sheetRef.current) {
      e.preventDefault();
      engine.nudge(state.active, ...dirs[e.key]);
    } else if (e.key === "1" || e.key === "2" || e.key === "3") {
      choose(Number(e.key) - 1);
    } else if ((e.key === "p" || e.key === "Enter") && e.target === sheetRef.current) {
      e.preventDefault();
      pull(cover, line);
    }
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={stageRef} className="riso" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined} onKeyDown={onKeyDown}>
      {embedded ? null : (
        <header className="riso-caption">
          <h1 className="riso-title">Riso</h1>
          <p className="riso-hint">Three spot inks, one drum at a time. Drag the print to register the selected drum, then pull another.</p>
          <button type="button" className="riso-pill riso-sound" aria-pressed={sound} onClick={toggleSound}>
            <SpeakerIcon on={sound} />
            <span>{sound ? "Sound on" : "Sound off"}</span>
          </button>
        </header>
      )}

      <div className="riso-bed">
        <canvas ref={underRef} className="riso-under" aria-hidden="true" />
        <div
          ref={sheetRef}
          className="riso-sheet"
          tabIndex={0}
          role="img"
          aria-label={`Risograph print of ${COVERS[cover].title} with the line: ${LINES[line]}. Arrow keys move the selected drum.`}
        />
        {failed ? <p className="riso-fallback">This print needs WebGL 2.</p> : null}
      </div>

      <aside className="riso-panel" aria-label="Print controls">
        <section className="riso-group">
          <h2 className="riso-label">Cover</h2>
          <div className="riso-covers">
            {COVERS.map((a, i) => (
              <button key={a.id} type="button" className="riso-cover" aria-pressed={i === cover} aria-label={a.title} onClick={() => pull(i, line)}>
                <span className="riso-cover-art" style={{ backgroundImage: `url(${a.cover})` }} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>

        <section className="riso-group">
          <h2 className="riso-label">Line</h2>
          <div className="riso-line">
            <button type="button" className="riso-icon" aria-label="Previous line" onClick={() => stepLine(-1)}>
              <Arrow dir={-1} />
            </button>
            <p className="riso-line-text">{LINES[line]}</p>
            <button type="button" className="riso-icon" aria-label="Next line" onClick={() => stepLine(1)}>
              <Arrow dir={1} />
            </button>
          </div>
        </section>

        <section className="riso-group">
          <h2 className="riso-label">Drums</h2>
          <div className="riso-drums" role="radiogroup" aria-label="Drum to register">
            {INKS.map((ink, i) => (
              <button key={ink.id} type="button" role="radio" aria-checked={state.active === i} className="riso-drum" onClick={() => choose(i)}>
                <span className="riso-swatch" style={{ "--riso-swatch": ink.hex }} aria-hidden="true" />
                <span className="riso-drum-name">{ink.name}</span>
                <span className="riso-drum-value">
                  {fmt(state.offsets[i][0])} {fmt(state.offsets[i][1])} mm
                </span>
              </button>
            ))}
          </div>
        </section>

        <button type="button" className="riso-pull" onClick={() => pull(cover, line)} data-printing={state.printing ? "" : undefined}>
          {state.printing ? "Printing…" : "Pull a print"}
        </button>
      </aside>
    </Root>
  );
}
