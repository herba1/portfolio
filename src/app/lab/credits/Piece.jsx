"use client";

import { useEffect, useRef, useState } from "react";

import { FINALE, OPENING, SECTIONS } from "./creditsData";
import "./credits.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="credits-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <>
          <path className="credits-wave" d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
          <path className="credits-wave credits-wave-far" d="M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
        </>
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

function Quote({ quote }) {
  return (
    <figure className="credits-quote">
      <blockquote className="credits-quote-text">{quote.text}</blockquote>
      <figcaption className="credits-credit">
        <span className="credits-by">{quote.by}</span>
        {quote.source ? <span className="credits-source">{quote.source}</span> : null}
      </figcaption>
    </figure>
  );
}

function Section({ section }) {
  return (
    <section className="credits-section">
      <p className="credits-heading">{section.heading}</p>
      {section.quotes ? (
        <div className="credits-quotes">
          {section.quotes.map((q) => (
            <Quote key={q.text} quote={q} />
          ))}
        </div>
      ) : null}
      {section.rows ? (
        <dl className="credits-rows">
          {section.rows.map(([line, name]) => (
            <div className="credits-row" key={line}>
              <dt className="credits-role">{line}</dt>
              <dd className="credits-name">{name}</dd>
            </div>
          ))}
        </dl>
      ) : null}
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
  const [sound, setSound] = useState("pending");

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
        onAudio: setSound,
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
    const next = sound !== "on";
    setSound(next ? "pending" : "off");
    const ok = await engine.setSound(next);
    if (next && !ok) setSound("pending");
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root className="credits" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined} data-ended={ended ? "" : undefined}>
      <div ref={filmRef} className="credits-film" tabIndex={0} aria-label="The most inspiring words of all time, as an end-credits roll. Drag or scroll to scrub, space to pause.">
        <div ref={gateRef} className="credits-gate">
          <div ref={rollRef} className="credits-roll">
            <div className="credits-opening">
              <p className="credits-album">{OPENING.title}</p>
              <p className="credits-kicker">{OPENING.kicker}</p>
            </div>
            {SECTIONS.map((section) => (
              <Section key={section.heading} section={section} />
            ))}
            <div ref={finaleRef} className="credits-finale">
              <blockquote className="credits-finale-text">{FINALE.text}</blockquote>
              <p className="credits-finale-by">
                <span className="credits-by">{FINALE.by}</span>
                <span className="credits-source">{FINALE.source}</span>
              </p>
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
            <p className="credits-hint">The most inspiring words of all time, rolling like the end of a film. Drag or scroll to scrub; let go and it rolls on.</p>
          </div>
          <button type="button" className="credits-pill" data-state={sound} aria-pressed={sound === "on"} onClick={toggleSound}>
            <SpeakerIcon on={sound !== "off"} />
            {sound === "pending" ? (
              <>
                <span className="credits-sound-fine">Click for sound</span>
                <span className="credits-sound-touch">Tap for sound</span>
              </>
            ) : (
              <span>{sound === "on" ? "Sound on" : "Sound off"}</span>
            )}
          </button>
        </header>
      )}
      <button type="button" className="credits-again" onClick={() => engineRef.current?.restart()} tabIndex={ended ? 0 : -1} aria-hidden={ended ? undefined : true}>
        Roll it again
      </button>
    </Root>
  );
}
