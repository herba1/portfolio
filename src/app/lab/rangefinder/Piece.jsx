"use client";

import { useEffect, useRef, useState } from "react";

import "./rangefinder.css";

const NEAREST = 0.7;
const DISTANCES = [
  { m: Infinity, label: "∞" },
  { m: 10, label: "10" },
  { m: 5, label: "5" },
  { m: 3, label: "3" },
  { m: 2, label: "2" },
  { m: 1.5, label: "1.5" },
  { m: 1.2, label: "1.2" },
  { m: 1, label: "1" },
  { m: 0.85, label: ".85" },
  { m: 0.7, label: ".7" },
];
const MAJOR = DISTANCES.map((d) => ({ ...d, u: Number.isFinite(d.m) ? NEAREST / d.m : 0 }));
const MINOR = MAJOR.slice(1).map((d, i) => (d.u + MAJOR[i].u) / 2);
const DOF = [16, 8, 4];
const SLOTS = 16;
const FLYERS = 3;

function RingScale() {
  return (
    <>
      {MAJOR.map((d) => (
        <span key={d.label} className={d.m === 10 ? "rangefinder-mark rangefinder-mark-crowded" : "rangefinder-mark"} style={{ "--u": d.u }}>
          <span className="rangefinder-mark-tick" />
          <span className="rangefinder-mark-num">{d.label}</span>
        </span>
      ))}
      {MINOR.map((u) => (
        <span key={u} className="rangefinder-mark rangefinder-mark-minor" style={{ "--u": u }}>
          <span className="rangefinder-mark-tick" />
        </span>
      ))}
      <span className="rangefinder-mark rangefinder-mark-unit" style={{ "--u": 1.07 }}>
        <span className="rangefinder-mark-num">m</span>
      </span>
    </>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const ringRef = useRef(null);
  const trackRef = useRef(null);
  const leverRef = useRef(null);
  const counterRef = useRef(null);
  const shutterRef = useRef(null);
  const holesRef = useRef(null);
  const headRef = useRef(null);
  const slotRefs = useRef([]);
  const flyerRefs = useRef([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      try {
        const { createRangefinder } = await import("./rangefinderEngine");
        if (cancelled) return;
        engine = createRangefinder({
          box: root,
          embedded,
          refs: {
            canvas: canvasRef.current,
            ring: ringRef.current,
            track: trackRef.current,
            lever: leverRef.current,
            counter: counterRef.current,
            shutter: shutterRef.current,
            holes: holesRef.current,
            slots: slotRefs.current.filter(Boolean),
            flyers: flyerRefs.current.filter(Boolean),
            header: embedded ? null : headRef.current,
          },
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

  return (
    <Root
      ref={rootRef}
      className="rangefinder-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-failed={failed ? "" : undefined}
    >
      {embedded ? null : (
        <header ref={headRef} className="rangefinder-head">
          <h1 className="rangefinder-title">Rangefinder</h1>
          <p className="rangefinder-lede">
            Put the patch on someone, turn the focus until the <em>two images</em> become one, then press.
          </p>
        </header>
      )}

      <div className="rangefinder-body">
        <canvas
          ref={canvasRef}
          className="rangefinder-canvas"
          tabIndex={0}
          role="application"
          aria-label="Rangefinder viewfinder over a club. Move the pointer or the arrow keys to put the focusing patch on someone, scroll or press comma and period to focus, and click or press space to take the picture."
        />
        <div className="rangefinder-plate" aria-hidden="true">
          <span className="rangefinder-serial">Nº 1046 218</span>
          <span className="rangefinder-counter">
            <span ref={counterRef} className="rangefinder-counter-num">
              4
            </span>
          </span>
        </div>
        <div ref={leverRef} className="rangefinder-lever" aria-hidden="true">
          <span className="rangefinder-lever-arm" />
          <span className="rangefinder-lever-tip" />
          <span className="rangefinder-lever-boss" />
        </div>
        <div className="rangefinder-controls">
          <div
            ref={ringRef}
            className="rangefinder-ring"
            tabIndex={0}
            role="slider"
            aria-label="Focus distance"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={30}
            aria-valuetext="2.4 metres"
          >
            <div className="rangefinder-ring-band">
              <div ref={trackRef} className="rangefinder-track">
                <span className="rangefinder-knurl" />
                <RingScale />
                <span className="rangefinder-tab" style={{ "--u": 0.5 }}>
                  <span className="rangefinder-tab-dimple" />
                </span>
              </div>
            </div>
            <div className="rangefinder-ring-fixed" aria-hidden="true">
              {DOF.map((n) => (
                <span key={`l${n}`} className={n === 4 ? "rangefinder-dof rangefinder-dof-tight" : "rangefinder-dof"} style={{ "--d": -n * 0.0084 }}>
                  {n}
                </span>
              ))}
              <span className="rangefinder-index" />
              {DOF.map((n) => (
                <span key={`r${n}`} className={n === 4 ? "rangefinder-dof rangefinder-dof-tight" : "rangefinder-dof"} style={{ "--d": n * 0.0084 }}>
                  {n}
                </span>
              ))}
            </div>
          </div>
          <button ref={shutterRef} type="button" className="rangefinder-shutter" aria-label="Release the shutter">
            <span className="rangefinder-shutter-cap" />
          </button>
        </div>
      </div>

      <div className="rangefinder-strip" aria-label="Contact strip of the pictures you have taken" role="img">
        <div className="rangefinder-film">
          <div ref={holesRef} className="rangefinder-holes" aria-hidden="true">
            <span className="rangefinder-holes-row rangefinder-holes-top" />
            <span className="rangefinder-holes-row rangefinder-holes-bottom" />
          </div>
          {Array.from({ length: SLOTS }, (_, i) => (
            <div
              key={i}
              ref={(el) => {
                slotRefs.current[i] = el;
              }}
              className="rangefinder-slot"
            >
              <canvas className="rangefinder-print" width={360} height={240} />
              <span className="rangefinder-edge" data-num="" />
              <span className="rangefinder-edge rangefinder-edge-a" data-num-a="" />
            </div>
          ))}
        </div>
      </div>

      {Array.from({ length: FLYERS }, (_, i) => (
        <canvas
          key={i}
          ref={(el) => {
            flyerRefs.current[i] = el;
          }}
          className="rangefinder-flyer"
          width={720}
          height={480}
          aria-hidden="true"
        />
      ))}

      {failed ? <p className="rangefinder-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
