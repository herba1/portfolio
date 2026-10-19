"use client";

import { useEffect, useRef, useState } from "react";

import { albumById } from "@/app/lab/_music/catalog";
import "./pins.css";

const SUBJECTS = [
  { id: "mathewson", title: "Mathewson, 1909", full: "Christy Mathewson on a 1909 baseball card", src: "/flyout/card-03.jpg", crop: [0.1, 0.13, 0.8], thumb: "50% 20%" },
  { id: "young", title: "Cy Young, 1909", full: "Cy Young on a 1909 baseball card", src: "/flyout/card-04.jpg", crop: [0.1, 0.13, 0.8], thumb: "50% 20%" },
  { id: "with-the-beatles", title: "With the Beatles", full: "the cover of With the Beatles", src: albumById("with-the-beatles").cover, crop: [0.025, 0.025, 0.95], thumb: "50% 50%" },
];

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [album, setAlbum] = useState(0);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let disposed = false;
    let started = false;
    let visible = false;
    let engine = null;
    const sync = () => engine?.setActive(visible && !document.hidden);
    const start = async () => {
      started = true;
      try {
        const { createPins } = await import("./pinsEngine");
        if (disposed) return;
        const made = await createPins({
          root,
          stage: stageRef.current,
          canvas: canvasRef.current,
          subjects: SUBJECTS,
          onAlbum: (i) => {
            if (!disposed) setAlbum(i);
          },
        });
        if (disposed) {
          made.destroy();
          return;
        }
        engine = made;
        engineRef.current = made;
        setStatus("ready");
        sync();
      } catch (error) {
        console.error(error);
        if (!disposed) setStatus("failed");
      }
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible && !started) start();
        sync();
      },
      { rootMargin: "160px" },
    );
    io.observe(root);
    document.addEventListener("visibilitychange", sync);
    return () => {
      disposed = true;
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      engine?.destroy();
      engineRef.current = null;
    };
  }, []);

  return (
    <div ref={rootRef} className="pins-root" data-embedded={embedded || undefined} data-status={status}>
      <div className="pins-layout">
      {!embedded && (
        <header className="pins-head">
          <h1 className="pins-title">Pin Art</h1>
          <p className="pins-lede">
            A bed of steel pins with a face pressed through from behind. Drag to push your own <em>fingertip</em> in, then watch the pins settle back.
          </p>
        </header>
      )}
      <div className="pins-well">
        <div
          ref={stageRef}
          className="pins-plate"
          tabIndex={0}
          role="application"
          aria-label={`A pin art toy with ${SUBJECTS[album].full} pressed into the steel pins. Drag across the pins to push them through; Delete lets every pin fall back flat, and keys 1 to 3 press a different picture. Left alone, it presses the next picture through by itself.`}
        >
          <canvas ref={canvasRef} className="pins-canvas" />
        </div>
      </div>
      {!embedded && (
        <div className="pins-bar">
          <div className="pins-albums" role="radiogroup" aria-label="Picture">
            {SUBJECTS.map((a, i) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={album === i}
                className="pins-album"
                disabled={status !== "ready"}
                onClick={() => engineRef.current?.choose(i)}
              >
                <img src={a.src} alt="" width={28} height={28} draggable={false} style={{ objectPosition: a.thumb }} />
                <span>{a.title}</span>
              </button>
            ))}
          </div>
          <button type="button" className="pins-flat" disabled={status !== "ready"} onClick={() => engineRef.current?.flatten()}>
            Let them fall
          </button>
        </div>
      )}
      </div>
      {status === "failed" && <p className="pins-note">This piece needs WebGL 2.</p>}
    </div>
  );
}
