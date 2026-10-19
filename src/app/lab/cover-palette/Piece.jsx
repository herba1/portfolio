"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ALBUMS } from "@/app/lab/_music/catalog";

import { ROLES, deriveTheme, extractPalette, toHex } from "./palette";
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
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M8 13.4S2.2 10 2.2 6a3 3 0 0 1 5.8-1.2A3 3 0 0 1 13.8 6C13.8 10 8 13.4 8 13.4Z" />
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const coverRef = useRef(null);
  const huesRef = useRef({});
  const stackRef = useRef(0);
  const copyTimer = useRef(0);
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
      clearTimeout(copyTimer.current);
    };
  }, []);

  const shownId = previewId ?? selectedId;
  const album = ALBUMS.find((a) => a.id === shownId);
  const swatches = palettes[shownId];
  const theme = useMemo(() => (swatches ? deriveTheme(swatches) : null), [swatches]);
  const chips = useMemo(() => (swatches ?? []).slice(0, SLOTS).map((s) => ({ ...s, hex: toHex(s) })), [swatches]);

  const centeredRef = useRef(false);
  useLayoutEffect(() => {
    const picker = pickerRef.current;
    const thumb = picker?.querySelector(`[data-id="${selectedId}"]`);
    if (!thumb || picker.scrollWidth <= picker.clientWidth) return;
    const left = thumb.offsetLeft - (picker.clientWidth - thumb.offsetWidth) / 2;
    picker.scrollTo({ left, behavior: centeredRef.current ? "smooth" : "instant" });
    centeredRef.current = true;
  }, [selectedId]);

  useLayoutEffect(() => {
    const img = coverRef.current?.querySelector(`[data-id="${shownId}"]`);
    if (!img) return;
    stackRef.current += 1;
    img.style.zIndex = String(stackRef.current);
  }, [shownId]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !theme) return;
    const hues = huesRef.current;
    const tone = theme.dark ? "dark" : "light";
    root.dataset.flip = root.dataset.tone && root.dataset.tone !== tone ? "true" : "false";
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
    root.dataset.tone = tone;
  }, [theme]);

  const copy = (hex) => {
    navigator.clipboard?.writeText(hex).catch(() => {});
    setCopied(hex);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1400);
  };

  const choose = (id) => {
    setSelectedId(id);
    setPreviewId(null);
  };

  const onPickerKey = (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = ALBUMS.findIndex((a) => a.id === selectedId);
    const next = ALBUMS[(i + step + ALBUMS.length) % ALBUMS.length];
    choose(next.id);
    const el = pickerRef.current?.querySelector(`[data-id="${next.id}"]`);
    el?.focus({ preventScroll: true });
  };

  return (
    <div ref={rootRef} className="cp" data-embedded={embedded ? "true" : "false"} data-ready="false">
      <div className="cp-scroll" data-scroll-contain>
        <div className="cp-layout">
          <div ref={coverRef} className="cp-cover">
            {ALBUMS.map((a) => (
              <img key={a.id} data-id={a.id} src={a.cover} alt={a.id === shownId ? `${a.title} cover` : ""} data-on={a.id === shownId ? "true" : "false"} draggable={false} />
            ))}
          </div>

          <div className="cp-info">
            <p className="cp-eyebrow text-ui-lg">
              <span className="tabular-nums">{album.year}</span> · {album.tracks.length} songs
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

            <ul className="cp-chips" aria-label={`Colours of ${album.title}`}>
              {Array.from({ length: SLOTS }, (_, i) => chips[i] ?? null).map((c, i) => (
                <li key={i} className="cp-chip-cell" data-empty={c ? "false" : "true"}>
                  {c && (
                    <button type="button" className="cp-chip" onClick={() => copy(c.hex)} aria-label={`Copy ${c.hex}`}>
                      <span className="cp-chip-swatch" style={{ backgroundColor: c.hex }} />
                      <span className="cp-chip-label text-ui-lg tabular-nums">{copied === c.hex ? "Copied" : c.hex}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>

            <ol className="cp-tracks">
              {album.tracks.map((t, i) => (
                <li key={i} className="cp-track">
                  <span className="cp-n text-ui-lg tabular-nums">{i + 1}</span>
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
            onClick={() => choose(a.id)}
          >
            <img src={a.cover} alt="" draggable={false} />
          </button>
        ))}
      </div>
    </div>
  );
}
