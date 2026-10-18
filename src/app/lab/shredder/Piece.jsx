"use client";

import { useEffect, useRef, useState } from "react";

import { albumById } from "@/app/lab/_music/catalog";
import "./shredder.css";

const ALBUMS = ["revolver", "abbey-road", "sgt-pepper", "rubber-soul", "help", "magical-mystery-tour"].map((id) => albumById(id));

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const buttonRef = useRef(null);
  const engineRef = useRef(null);
  const [album, setAlbum] = useState(0);
  const [busy, setBusy] = useState(false);
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
        const { createShredder } = await import("./shredderEngine");
        if (disposed) return;
        const made = await createShredder({
          root,
          canvas: canvasRef.current,
          button: buttonRef.current,
          albums: ALBUMS,
          onAlbum: (i) => {
            if (!disposed) setAlbum(i);
          },
          onBusy: (b) => {
            if (!disposed) setBusy(b);
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
    <div ref={rootRef} className="shredder" data-embedded={embedded || undefined} data-status={status} data-busy={busy || undefined}>
      <canvas
        ref={canvasRef}
        className="shredder__canvas"
        role="img"
        aria-label={`A glossy desk shredder with ${ALBUMS[album].title} waiting above the slot. Drag the cover down into the slot or press the green button to shred it.`}
      />
      <button
        ref={buttonRef}
        type="button"
        className="shredder__power"
        aria-label={`Shred ${ALBUMS[album].title}`}
        disabled={status !== "ready" || busy}
        onClick={() => engineRef.current?.shred()}
      />
      {!embedded && (
        <header className="shredder__head">
          <h1 className="shredder__title">Shredder</h1>
          <p className="shredder__hint">
            Push a record sleeve into the slot, or press the <em>green button</em>.
          </p>
        </header>
      )}
      {!embedded && (
        <div className="shredder__bar">
          <div className="shredder__albums" role="radiogroup" aria-label="Next sleeve">
            {ALBUMS.map((a, i) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={album === i}
                aria-label={`${a.title}, ${a.year}`}
                className="shredder__album"
                disabled={status !== "ready"}
                onClick={() => engineRef.current?.choose(i)}
              >
                <img src={a.cover} alt="" width={32} height={32} draggable={false} />
              </button>
            ))}
          </div>
          <button type="button" className="shredder__empty" disabled={status !== "ready"} onClick={() => engineRef.current?.empty()}>
            Empty bin
          </button>
        </div>
      )}
      {status === "failed" && <p className="shredder__fallback">The shredder could not load its sleeves.</p>}
    </div>
  );
}
