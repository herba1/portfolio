"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";
import "./shredder.css";

function toSleeves(tracks) {
  const seen = new Set();
  const out = [];
  for (const t of tracks) {
    const cover = t.imageLarge || t.image;
    const key = t.album || cover;
    if (!cover || seen.has(key)) continue;
    seen.add(key);
    out.push({ id: t.id || key, title: t.album || t.title, artist: t.artist, cover });
    if (out.length === 6) break;
  }
  return out;
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const buttonRef = useRef(null);
  const engineRef = useRef(null);
  const chromeRef = useRef(null);
  const { tracks } = useTopSongs(30);
  const sleeves = useMemo(() => toSleeves(tracks), [tracks]);
  const sleevesRef = useRef(sleeves);
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
        const startList = sleevesRef.current;
        if (disposed) return;
        const made = await createShredder({
          root,
          canvas: canvasRef.current,
          button: buttonRef.current,
          chrome: chromeRef.current,
          albums: startList,
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
        if (sleevesRef.current !== startList) made.setAlbums(sleevesRef.current);
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

  useEffect(() => {
    if (sleevesRef.current === sleeves) return;
    sleevesRef.current = sleeves;
    engineRef.current?.setAlbums(sleeves);
  }, [sleeves]);

  const current = sleeves[Math.min(album, sleeves.length - 1)];

  return (
    <div ref={rootRef} className="shredder" data-embedded={embedded || undefined} data-status={status} data-busy={busy || undefined}>
      <canvas
        ref={canvasRef}
        className="shredder__canvas"
        role="img"
        aria-label={`A glossy shredder with ${current?.title} waiting above the slot. Drag the cover down into the slot or press the green button to shred it.`}
      />
      <button
        ref={buttonRef}
        type="button"
        className="shredder__power"
        aria-label={`Shred ${current?.title}`}
        disabled={status !== "ready" || busy}
        onClick={() => engineRef.current?.shred()}
      />
      {!embedded && (
        <div ref={chromeRef} className="shredder__side">
          <header className="shredder__head">
            <h1 className="shredder__title">Shredder</h1>
            <p className="shredder__hint">
              Push a record sleeve into the slot, or press the <em>green button</em>.
            </p>
          </header>
          <div className="shredder__albums" role="radiogroup" aria-label="Next sleeve">
            {sleeves.map((a, i) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={album === i}
                aria-label={`${a.title}, ${a.artist}`}
                className="shredder__album"
                disabled={status !== "ready"}
                onClick={() => engineRef.current?.choose(i)}
              >
                <img src={a.cover} alt="" width={32} height={32} draggable={false} />
              </button>
            ))}
          </div>
        </div>
      )}
      {status === "failed" && <p className="shredder__fallback">The shredder could not load its sleeves.</p>}
    </div>
  );
}
