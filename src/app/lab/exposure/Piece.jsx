"use client";

import { useEffect, useRef, useState } from "react";

import beams from "./beams.jpg";
import sign from "./sign.jpg";
import thumbBeams from "./thumb-beams.jpg";
import thumbSign from "./thumb-sign.jpg";
import thumbTimesSquare from "./thumb-times-square.jpg";
import timesSquare from "./times-square.jpg";
import { START_EV, formatEv, spokenEv } from "./exposureEngine";
import "./exposure.css";

const PHOTOS = [
  { id: "times-square", label: "Times Square", src: timesSquare.src, thumb: thumbTimesSquare.src, focus: [0.5, 0.56], caption: "it will take a while to feel like this again" },
  { id: "sign", label: "Under the signs", src: sign.src, thumb: thumbSign.src, focus: [0.5, 0.52], caption: "i keep your voice on the walk home" },
  { id: "beams", label: "Lights in the fog", src: beams.src, thumb: thumbBeams.src, focus: [0.5, 0.57], caption: "you don't have to be anyone tonight" },
];

const KNURL = Array.from({ length: 96 }, (_, i) => (i * 360) / 96);
const TICKS = Array.from({ length: 19 }, (_, i) => i - 9);
const LABELS = [-3, -2, -1, 0, 1, 2, 3];

function SpeakerIcon({ on }) {
  return (
    <svg className="exposure-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

function DialFace() {
  return (
    <svg className="exposure-face" viewBox="-100 -100 200 200" aria-hidden="true">
      <g className="exposure-knurl">
        {KNURL.map((a) => (
          <line key={a} x1="0" y1="-99" x2="0" y2="-89" transform={`rotate(${a})`} />
        ))}
      </g>
      <circle className="exposure-face-edge" r="87" />
      {TICKS.map((n) => (
        <line
          key={n}
          className="exposure-tick"
          data-major={n % 3 === 0 ? "" : undefined}
          x1="0"
          y1={n % 3 === 0 ? -83 : -82}
          x2="0"
          y2={n % 3 === 0 ? -71 : -76}
          transform={`rotate(${n * 12})`}
        />
      ))}
      {LABELS.map((v) => (
        <text
          key={v}
          className="exposure-label"
          data-zero={v === 0 ? "" : undefined}
          x="0"
          y="-52"
          textAnchor="middle"
          transform={`rotate(${v * 36})`}
          fontSize="17"
        >
          {v === 0 ? "0" : `${v > 0 ? "+" : "−"}${Math.abs(v)}`}
        </text>
      ))}
      <circle className="exposure-hub" r="22" />
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const knobRef = useRef(null);
  const rotorRef = useRef(null);
  const readoutRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(false);
  const [failed, setFailed] = useState(false);
  const [photo, setPhoto] = useState(0);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createExposureEngine } = await import("./exposureEngine");
      if (cancelled) return;
      engine = createExposureEngine({
        stage,
        canvas: canvasRef.current,
        knob: knobRef.current,
        rotor: rotorRef.current,
        readout: readoutRef.current,
        embedded,
        photos: PHOTOS,
        onReady: () => setReady(true),
        onFail: () => setFailed(true),
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
    io.observe(stage);
    return () => {
      cancelled = true;
      io.disconnect();
      engine?.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  const toggleSound = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !sound;
    setSound(next);
    const result = await engine.setSound(next);
    if (result !== next) setSound(result);
  };

  const pick = (i) => {
    setPhoto(i);
    engineRef.current?.choose(i);
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root className="exposure" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div ref={stageRef} className="exposure-stage">
        <canvas ref={canvasRef} className="exposure-canvas" aria-hidden="true" />
        <div className="exposure-shade" aria-hidden="true" />
        {embedded ? null : (
          <header className="exposure-caption">
            <div className="exposure-caption-text">
              <h1 className="exposure-title">Exposure</h1>
              <p className="exposure-hint">Turn the dial to blow the night out or crush it down to the streetlights.</p>
              <div className="exposure-photos" role="radiogroup" aria-label="Photo">
                {PHOTOS.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={photo === i}
                    aria-label={p.label}
                    title={p.label}
                    className="exposure-photo"
                    onClick={() => pick(i)}
                  >
                    <img src={p.thumb} alt="" width="64" height="48" draggable="false" />
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className="exposure-button" aria-pressed={sound} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
              <span>{sound ? "Clicks on" : "Clicks off"}</span>
            </button>
          </header>
        )}
        <div className="exposure-control">
          <div className="exposure-readout">
            <span ref={readoutRef} className="exposure-value">
              {formatEv(START_EV)}
            </span>
            <span className="exposure-unit">EV</span>
          </div>
          <div className="exposure-dial">
            <span className="exposure-index" aria-hidden="true" />
            <div
              ref={knobRef}
              className="exposure-knob"
              role="slider"
              tabIndex={0}
              aria-label="Exposure compensation"
              aria-valuemin={-3}
              aria-valuemax={3}
              aria-valuenow={START_EV}
              aria-valuetext={spokenEv(START_EV)}
            >
              <div className="exposure-rim" />
              <div ref={rotorRef} className="exposure-rotor" style={{ transform: `rotate(${-START_EV * 36}deg)` }}>
                <DialFace />
              </div>
              <div className="exposure-sheen" />
            </div>
          </div>
        </div>
      </div>
      {failed ? <p className="exposure-fallback">This photo needs WebGL 2.</p> : null}
    </Root>
  );
}
