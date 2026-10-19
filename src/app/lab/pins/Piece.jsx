"use client";

import { useEffect, useRef, useState } from "react";

import { albumById } from "@/app/lab/_music/catalog";
import "./pins.css";

const ALBUMS = ["with-the-beatles", "let-it-be", "a-hard-days-night"].map((id) => albumById(id));

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
          albums: ALBUMS,
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
            A bed of steel pins with a cover pressed through from behind. Drag to push your own <em>fingertip</em> in.
          </p>
        </header>
      )}
      <div className="pins-well">
        <div
          ref={stageRef}
          className="pins-plate"
          tabIndex={0}
          role="application"
          aria-label={`A pin art toy with ${ALBUMS[album].title} pressed into the steel pins. Drag across the pins to push them through; Delete lets every pin fall back flat, and keys 1 to 3 press a different cover.`}
        >
          <canvas ref={canvasRef} className="pins-canvas" />
        </div>
      </div>
      {!embedded && (
        <div className="pins-bar">
          <div className="pins-albums" role="radiogroup" aria-label="Cover">
            {ALBUMS.map((a, i) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={album === i}
                className="pins-album"
                disabled={status !== "ready"}
                onClick={() => engineRef.current?.choose(i)}
              >
                <img src={a.cover} alt="" width={28} height={28} draggable={false} />
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
