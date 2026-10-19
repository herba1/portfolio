"use client";

import { useEffect, useRef, useState } from "react";

import "./iris.css";

const STOPS = ["1.4", "2", "2.8", "4", "5.6", "8", "11", "16"];
const STOP_DEG = 26;
const NUM_R = 82.6;
const LENS_TEXT_R = 75.2;
const LAYERS = [
  { key: "low", shift: "translate(0 -0.42)", className: "iris-engrave-low" },
  { key: "lip", shift: "translate(0 0.38)", className: "iris-engrave-lip" },
  { key: "paint", shift: "", className: "iris-engrave-paint" },
];

function DialMarks() {
  const ticks = [];
  for (let k = 0; k <= (STOPS.length - 1) * 3; k += 1) {
    const deg = (k / 3) * STOP_DEG;
    const major = k % 3 === 0;
    ticks.push(
      <line
        key={k}
        x1="0"
        x2="0"
        y1={major ? -88.4 : -88.4}
        y2={major ? -85.9 : -87.1}
        strokeWidth={major ? 0.6 : 0.42}
        transform={`rotate(${deg})`}
      />,
    );
  }
  return (
    <>
      {ticks}
      {STOPS.map((label, k) => (
        <text
          key={label}
          transform={`rotate(${k * STOP_DEG}) translate(0 ${-NUM_R})`}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={label.length > 2 ? 5.4 : 5.9}
          className={k === STOPS.length - 1 ? "iris-num iris-num-end" : "iris-num"}
        >
          {label}
        </text>
      ))}
    </>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const dialRefs = useRef([]);
  const fRef = useRef(null);
  const tRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      try {
        const { createIris } = await import("./irisEngine");
        if (cancelled) return;
        engine = createIris({
          box: root,
          canvas,
          header: embedded ? null : headRef.current,
          dial: dialRefs.current.filter(Boolean),
          readout: { f: fRef.current, t: tRef.current },
          embedded,
          onReady: () => {
            if (!cancelled) setReady(true);
          },
        });
      } catch (error) {
        console.error(error);
        if (!cancelled) setFailed(true);
      }
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
    };
  }, [embedded]);

  const Root = embedded ? "div" : "main";
  const arc = `M ${-LENS_TEXT_R} 0 A ${LENS_TEXT_R} ${LENS_TEXT_R} 0 0 0 ${LENS_TEXT_R} 0`;

  return (
    <Root
      ref={rootRef}
      className="iris-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-failed={failed ? "" : undefined}
    >
      <canvas
        ref={canvasRef}
        className="iris-canvas"
        tabIndex={0}
        role="slider"
        aria-label="Lens aperture. Turn the ring, drag, or scroll to stop down from f/1.4 to f/16."
        aria-valuemin={0}
        aria-valuemax={STOPS.length - 1}
        aria-valuenow={1}
        aria-valuetext="f/2"
        aria-orientation="vertical"
      />
      <svg className="iris-scale" viewBox="-100 -100 200 200" aria-hidden="true">
        <defs>
          <path id={embedded ? "iris-arc-tile" : "iris-arc"} d={arc} />
        </defs>
        {LAYERS.map((layer, i) => (
          <g key={layer.key} className={layer.className}>
            <g
              ref={(el) => {
                dialRefs.current[i] = el;
              }}
              data-shift={layer.shift}
              transform={`${layer.shift} rotate(${-STOP_DEG * 4.6})`}
            >
              <DialMarks />
            </g>
            <g transform={layer.shift}>
              <text className="iris-lens-text" fontSize={3.3}>
                <textPath href={embedded ? "#iris-arc-tile" : "#iris-arc"} startOffset="50%" textAnchor="middle">
                  Iris 1:1.4 f=50mm ⌀58
                </textPath>
              </text>
            </g>
          </g>
        ))}
        <path className="iris-index" d="M 0 -76.2 L 1.5 -73.2 L -1.5 -73.2 Z" />
      </svg>
      <div className="iris-readout" aria-hidden="true">
        <span className="iris-readout-f">
          <em>f</em>/<span ref={fRef}>5.6</span>
        </span>
        <span className="iris-readout-rule" />
        <span className="iris-readout-t">
          <span ref={tRef}>1/40</span> s
        </span>
      </div>
      {embedded ? null : (
        <header ref={headRef} className="iris-head">
          <h1 className="iris-title">Iris</h1>
          <p className="iris-lede">
            Turn the ring. Nine blades close on a foggy night shot on film, and the lamps in the haze fall from <em>soft discs</em> into stars.
          </p>
        </header>
      )}
      {failed ? <p className="iris-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
