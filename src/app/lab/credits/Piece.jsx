"use client";

import { useEffect, useRef, useState } from "react";

import { albumById } from "@/app/lab/_music/catalog";
import { SECTIONS } from "./creditsData";
import "./credits.css";

const ALBUM = albumById("abbey-road");

function SpeakerIcon({ on }) {
  return (
    <svg className="credits-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

function Section({ section }) {
  return (
    <section className="credits-section">
      <p className="credits-heading">{section.heading}</p>
      {section.rows ? (
        <dl className="credits-rows">
          {section.rows.map(([role, name], i) => (
            <div className="credits-row" key={`${role}-${name}-${i}`}>
              <dt className="credits-role">{role}</dt>
              <dd className="credits-name">{name}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {section.names
        ? section.names.map((name) => (
            <p className="credits-solo" key={name}>
              {name}
            </p>
          ))
        : null}
      {section.note ? <p className="credits-note">{section.note}</p> : null}
    </section>
  );
}

export default function Piece({ embedded = false }) {
  const filmRef = useRef(null);
  const gateRef = useRef(null);
  const rollRef = useRef(null);
  const finaleRef = useRef(null);
  const grainRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [ended, setEnded] = useState(false);
  const [sound, setSound] = useState(false);

  useEffect(() => {
    const film = filmRef.current;
    if (!film) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createCredits } = await import("./creditsEngine");
      if (document.fonts?.load) await Promise.all([document.fonts.load('400 20px "CreditsSerif"'), document.fonts.load('italic 400 20px "CreditsSerif"')]).catch(() => {});
      if (cancelled) return;
      engine = createCredits(film, {
        film,
        gate: gateRef.current,
        roll: rollRef.current,
        finale: finaleRef.current,
        grain: grainRef.current,
        onEnd: setEnded,
      });
      engineRef.current = engine;
      setReady(true);
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        start();
      },
      { rootMargin: "240px" },
    );
    io.observe(film);
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
    <Root className="credits" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined} data-ended={ended ? "" : undefined}>
      <div ref={filmRef} className="credits-film" tabIndex={0} aria-label="Abbey Road end credits. Drag or scroll to scrub, space to pause.">
        <div ref={gateRef} className="credits-gate">
          <div ref={rollRef} className="credits-roll">
            <div className="credits-opening">
              <p className="credits-kicker">The Beatles</p>
              <p className="credits-album">Abbey Road</p>
            </div>
            {SECTIONS.map((section) => (
              <Section key={section.heading} section={section} />
            ))}
            <div ref={finaleRef} className="credits-finale">
              <img className="credits-cover" src={ALBUM.cover} alt="Abbey Road cover" width={168} height={168} draggable={false} />
              <p className="credits-finale-title">Abbey Road</p>
              <p className="credits-finale-note">The Beatles · EMI Studios, London · 1969</p>
            </div>
          </div>
        </div>
        <canvas ref={grainRef} className="credits-grain" aria-hidden="true" />
        <div className="credits-vignette" aria-hidden="true" />
      </div>
      {embedded ? null : (
        <header className="credits-caption">
          <div className="credits-caption-text">
            <h1 className="credits-title">Credits</h1>
            <p className="credits-hint">Drag or scroll to scrub the roll. Let go and it plays on at its own pace.</p>
          </div>
          <button type="button" className="credits-pill" aria-pressed={sound} onClick={toggleSound}>
            <SpeakerIcon on={sound} />
            <span>{sound ? "Projector on" : "Projector off"}</span>
          </button>
        </header>
      )}
      <button type="button" className="credits-again" onClick={() => engineRef.current?.restart()} tabIndex={ended ? 0 : -1} aria-hidden={ended ? undefined : true}>
        Run it back
      </button>
    </Root>
  );
}
