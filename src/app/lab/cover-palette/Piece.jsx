"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ALBUMS } from "@/app/lab/_music/catalog";

import { ROLES, deriveTheme, extractPalette, fmt } from "./palette";
import "./cover-palette.css";

const START = "abbey-road";
const SLOTS = 6;

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M4.5 2.8v10.4a.6.6 0 0 0 .9.5l8.3-5.2a.6.6 0 0 0 0-1L5.4 2.3a.6.6 0 0 0-.9.5Z" fill="currentColor" />
    </svg>
  );
}

function HeartIcon({ on }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M8 13.4S2.2 10 2.2 6a3 3 0 0 1 5.8-1.2A3 3 0 0 1 13.8 6C13.8 10 8 13.4 8 13.4Z" />
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const huesRef = useRef({});
  const pickerRef = useRef(null);
  const [palettes, setPalettes] = useState({});
  const [selectedId, setSelectedId] = useState(START);
  const [previewId, setPreviewId] = useState(null);
  const [liked, setLiked] = useState({});
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    let alive = true;
    ALBUMS.forEach((album) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        if (!alive) return;
        const swatches = extractPalette(img);
        setPalettes((prev) => ({ ...prev, [album.id]: swatches }));
      };
      img.src = album.cover;
    });
    return () => {
      alive = false;
    };
  }, []);

  const shownId = previewId ?? selectedId;
  const album = ALBUMS.find((a) => a.id === shownId);
  const swatches = palettes[shownId];
  const theme = useMemo(() => (swatches ? deriveTheme(swatches) : null), [swatches]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !theme) return;
    const hues = huesRef.current;
    for (const role of ROLES) {
      const c = theme.roles[role];
      const prev = hues[role];
      let h = c.h;
      if (prev != null) {
        h = c.C < 0.02 ? prev : prev + ((((c.h - prev) % 360) + 540) % 360) - 180;
      }
      hues[role] = h;
      root.style.setProperty(`--cp-${role}-l`, c.L.toFixed(4));
      root.style.setProperty(`--cp-${role}-c`, c.C.toFixed(4));
      root.style.setProperty(`--cp-${role}-h`, h.toFixed(2));
    }
    root.dataset.ready = "true";
    root.dataset.tone = theme.dark ? "dark" : "light";
  }, [theme]);

  const slots = Array.from({ length: SLOTS }, (_, i) => swatches?.[i] ?? null);

  const copy = (i, value) => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopied(i);
    setTimeout(() => setCopied((c) => (c === i ? null : c)), 1200);
  };

  const onPickerKey = (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = ALBUMS.findIndex((a) => a.id === selectedId);
    const next = ALBUMS[(i + step + ALBUMS.length) % ALBUMS.length];
    setSelectedId(next.id);
    setPreviewId(null);
    pickerRef.current?.querySelector(`[data-id="${next.id}"]`)?.focus();
  };

  return (
    <div ref={rootRef} className="cp" data-embedded={embedded ? "true" : "false"} data-ready="false">
      <div className="cp-mesh" aria-hidden="true">
        <span className="cp-blob cp-blob--0" />
        <span className="cp-blob cp-blob--1" />
        <span className="cp-blob cp-blob--2" />
        <span className="cp-blob cp-blob--3" />
      </div>

      <div className="cp-scroll" data-scroll-contain>
        <div className="cp-layout">
          <div className="cp-left">
            {!embedded && <h1 className="cp-heading text-heading">Cover Palette</h1>}
            <div className="cp-cover">
              {ALBUMS.map((a) => (
                <img key={a.id} src={a.cover} alt={a.id === shownId ? `${a.title} cover` : ""} data-on={a.id === shownId ? "true" : "false"} draggable={false} />
              ))}
            </div>

            <div className="cp-palette">
              <div className="cp-bar" role="img" aria-label={`Palette of ${album.title}`}>
                {slots.map((s, i) => (
                  <span
                    key={i}
                    className="cp-seg"
                    style={{ flexGrow: s ? Math.max(s.share, 0.02) : 0, backgroundColor: s ? fmt(s) : "transparent" }}
                  />
                ))}
              </div>
              <ul className="cp-swatches">
                {slots.map((s, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className="cp-swatch"
                      disabled={!s}
                      onClick={() => s && copy(i, fmt(s))}
                      aria-label={s ? `Copy ${fmt(s)}` : "Empty swatch"}
                    >
                      <span className="cp-dot" style={{ backgroundColor: s ? fmt(s) : "transparent" }} />
                      <span className="cp-value font-mono text-ui tabular-nums">
                        {copied === i ? "Copied" : s ? `${s.L.toFixed(2)} ${s.C.toFixed(2)} ${Math.round(s.h)}°` : "—"}
                      </span>
                      <span className="cp-share font-mono text-ui tabular-nums">{s ? `${Math.round(s.share * 100)}%` : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="cp-right">
            <p className="cp-eyebrow text-ui-lg">
              Album · <span className="tabular-nums">{album.year}</span>
            </p>
            <h2 key={album.id} className="cp-title text-title-xl">
              {album.title}
            </h2>
            <p className="cp-artist text-body">{album.artist}</p>
            <div className="cp-actions">
              <button type="button" className="cp-play text-ui-lg">
                <PlayIcon />
                Play
              </button>
              <button
                type="button"
                className="cp-like"
                aria-pressed={Boolean(liked[album.id])}
                aria-label={liked[album.id] ? "Remove from library" : "Add to library"}
                onClick={() => setLiked((l) => ({ ...l, [album.id]: !l[album.id] }))}
              >
                <HeartIcon on={Boolean(liked[album.id])} />
              </button>
            </div>
            <ol className="cp-tracks">
              {album.tracks.map((t, i) => (
                <li key={`${album.id}-${i}`} className="cp-track" style={{ "--i": i }}>
                  <span className="cp-n font-mono text-ui tabular-nums">{i + 1}</span>
                  <span className="cp-track-title text-ui-lg">{t}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      <div
        ref={pickerRef}
        className="cp-picker"
        role="radiogroup"
        aria-label="Albums"
        onPointerLeave={() => setPreviewId(null)}
        onKeyDown={onPickerKey}
      >
        {ALBUMS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            data-id={a.id}
            aria-checked={a.id === selectedId}
            aria-label={a.title}
            tabIndex={a.id === selectedId ? 0 : -1}
            className="cp-thumb"
            data-shown={a.id === shownId ? "true" : "false"}
            onPointerEnter={(e) => e.pointerType === "mouse" && setPreviewId(a.id)}
            onClick={() => {
              setSelectedId(a.id);
              setPreviewId(null);
            }}
          >
            <img src={a.cover} alt="" draggable={false} />
          </button>
        ))}
      </div>
    </div>
  );
}
