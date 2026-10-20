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

async function loadOwn(engine, file, done) {
  if (!engine) return;
  try {
    if (await engine.setImage(file)) done(true);
  } catch (error) {
    console.error(error);
  }
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const dialRefs = useRef([]);
  const fRef = useRef(null);
  const tRef = useRef(null);
  const engineRef = useRef(null);
  const fileRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [own, setOwn] = useState(false);

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
        engineRef.current = engine;
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
      engineRef.current = null;
    };
  }, [embedded]);

  useEffect(() => {
    if (embedded) return undefined;
    const root = rootRef.current;
    if (!root) return undefined;
    let depth = 0;
    const hasFile = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
    const onEnter = (e) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      depth += 1;
      setDropping(true);
    };
    const onOver = (e) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e) => {
      if (!hasFile(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDropping(false);
    };
    const onDrop = (e) => {
      if (!hasFile(e)) return;
      e.preventDefault();
      depth = 0;
      setDropping(false);
      const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
      if (file) loadOwn(engineRef.current, file, setOwn);
    };
    const onPaste = (e) => {
      const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      loadOwn(engineRef.current, file, setOwn);
    };
    root.addEventListener("dragenter", onEnter);
    root.addEventListener("dragover", onOver);
    root.addEventListener("dragleave", onLeave);
    root.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      root.removeEventListener("dragenter", onEnter);
      root.removeEventListener("dragover", onOver);
      root.removeEventListener("dragleave", onLeave);
      root.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, [embedded]);

  const onPick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) loadOwn(engineRef.current, file, setOwn);
  };

  const Root = embedded ? "div" : "main";
  const arc = `M ${-LENS_TEXT_R} 0 A ${LENS_TEXT_R} ${LENS_TEXT_R} 0 0 0 ${LENS_TEXT_R} 0`;

  return (
    <Root
      ref={rootRef}
      className="iris-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-failed={failed ? "" : undefined}
      data-dropping={dropping ? "" : undefined}
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
            <span className="iris-lede-line" data-on={own ? undefined : ""} aria-hidden={own}>
              Turn the ring. Nine blades close on a mountain stream shot on film, and the sun glinting off the water falls from <em>soft discs</em> into stars.
            </span>
            <span className="iris-lede-line" data-on={own ? "" : undefined} aria-hidden={!own}>
              Turn the ring. Nine blades close on your picture, and its brightest points fall from <em>soft discs</em> into stars.
            </span>
          </p>
          <button type="button" className="iris-own" onClick={() => fileRef.current?.click()}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <rect x="2" y="3" width="12" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <circle cx="6" cy="6.75" r="1.25" fill="currentColor" />
              <path d="M3 12l3.4-3.4 2.2 2.2L11 8.4l2.6 2.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
            <span>{dropping ? "Drop it on the lens" : own ? "Use another image" : "Use your own image"}</span>
          </button>
          <input ref={fileRef} className="iris-file" type="file" accept="image/*" tabIndex={-1} aria-hidden="true" onChange={onPick} />
        </header>
      )}
      {failed ? <p className="iris-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
