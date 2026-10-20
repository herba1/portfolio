"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";
import { FEATURED } from "@/app/lab/_music/catalog";
import { useTopSongs } from "@/app/lab/_music/useTopSongs";

import InkDragEngine from "./inkDragEngine";
import "./ink-drag.css";

const STATUS_TEXT = {
  wet: "Wet ink",
  tacky: "Drying",
  dry: "Dry, set for good",
  static: "Proof",
};

const SHORT_TITLES = { "sgt-pepper": "Sgt. Pepper" };

const ALBUM_ITEMS = FEATURED.slice(0, 6).map((album) => ({
  id: album.id,
  cover: album.cover,
  word: SHORT_TITLES[album.id] || album.title,
  caption: `${album.artist}, ${album.year}`,
}));

const SHEET_LABEL =
  "A record printed in wet ink: its album cover, then its title in type. Drag through the sheet with a mouse, finger or pen to smear the ink along your path; slow strokes push thick soft smears, fast strokes pull thin streaks. Every few seconds the ink of the cover flows across the sheet and settles into the letters of its title, then flows back out into the next cover. Press Enter to flip between cover and title.";

function FreshIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path
        d="M4.5 10a5.5 5.5 0 1 0 1.7-3.98"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M5.6 3.4v3.1h3.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const sheetRef = useRef(null);
  const canvasRef = useRef(null);
  const cursorRef = useRef(null);
  const statusRef = useRef(null);
  const engineRef = useRef(null);
  const near = useNearViewport(rootRef);
  const { tracks, live } = useTopSongs(6);
  const [view, setView] = useState({ index: 0, kind: "cover" });

  const items = useMemo(() => {
    if (!live) return ALBUM_ITEMS;
    return tracks.map((track) => ({
      id: track.id,
      cover: track.imageLarge || track.image,
      word: track.title,
      caption: track.artist,
    }));
  }, [live, tracks]);

  useEffect(() => {
    if (!near) return undefined;
    const root = rootRef.current;
    const engine = new InkDragEngine({
      host: sheetRef.current,
      canvas: canvasRef.current,
      cursor: cursorRef.current,
      onStatus: (status) => {
        root.setAttribute("data-status", status);
        if (statusRef.current)
          statusRef.current.textContent = STATUS_TEXT[status] || "";
      },
      onReady: () => root.setAttribute("data-ready", ""),
      onState: (next) => setView(next),
    });
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [near]);

  useEffect(() => {
    engineRef.current?.setItems(items);
  }, [items, near]);

  const fresh = () => engineRef.current?.fresh();
  const flip = () => engineRef.current?.toggle();
  const pick = (index) => engineRef.current?.show(index, "cover");

  const onSheetKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      flip();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      pick((view.index + step + items.length) % items.length);
    }
  };

  const current = items[view.index] || items[0];

  return (
    <div
      ref={rootRef}
      className="ink-drag"
      data-embedded={embedded ? "" : undefined}
      data-status="wet"
    >
      <div
        ref={sheetRef}
        className="ink-drag__sheet"
        tabIndex={0}
        role="img"
        aria-label={SHEET_LABEL}
        onKeyDown={onSheetKey}
      >
        <canvas ref={canvasRef} className="ink-drag__canvas" />
        <span
          className="ink-drag__mark ink-drag__mark--tl"
          aria-hidden="true"
        />
        <span
          className="ink-drag__mark ink-drag__mark--tr"
          aria-hidden="true"
        />
        <span
          className="ink-drag__mark ink-drag__mark--bl"
          aria-hidden="true"
        />
        <span
          className="ink-drag__mark ink-drag__mark--br"
          aria-hidden="true"
        />
        <span ref={cursorRef} className="ink-drag__cursor" aria-hidden="true" />
      </div>

      {!embedded && (
        <header className="ink-drag__head">
          <div className="ink-drag__heading">
            <h1 className="ink-drag__title">Ink Drag</h1>
            <p className="ink-drag__caption" aria-live="polite">
              {current ? `${current.word}, ${current.caption}` : ""}
            </p>
          </div>
          <p className="ink-drag__status" aria-live="polite">
            <span className="ink-drag__dot" aria-hidden="true" />
            <span ref={statusRef}>Wet ink</span>
          </p>
        </header>
      )}

      {embedded ? (
        <button
          type="button"
          className="ink-drag__fresh ink-drag__fresh--round"
          onClick={flip}
          aria-label={
            view.kind === "cover" ? "Pull into title" : "Pull into cover"
          }
        >
          <FreshIcon />
        </button>
      ) : (
        <div className="ink-drag__bar">
          <div
            className="ink-drag__records"
            role="radiogroup"
            aria-label="Record"
          >
            {items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={i === view.index}
                aria-label={item.word}
                className="ink-drag__record"
                onClick={() => pick(i)}
              >
                <img
                  src={item.cover}
                  alt=""
                  width="28"
                  height="28"
                  draggable="false"
                />
              </button>
            ))}
          </div>

          <div className="ink-drag__inks" role="radiogroup" aria-label="Show">
            {["cover", "title"].map((kind) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={view.kind === kind}
                className="ink-drag__ink"
                onClick={() => engineRef.current?.show(view.index, kind)}
              >
                {kind === "cover" ? "Cover" : "Title"}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="ink-drag__fresh"
            onClick={fresh}
            aria-label="Fresh sheet"
          >
            <FreshIcon />
            <span>Fresh</span>
          </button>
        </div>
      )}
    </div>
  );
}
