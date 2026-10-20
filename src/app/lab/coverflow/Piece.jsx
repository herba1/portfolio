"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";

import { createFlow } from "./flow";
import { recordsFrom } from "./records";
import { isPlain, readSleeve } from "./sleeve";
import { createTicks } from "./tick";
import "./coverflow.css";

function Chevron({ dir }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d={dir < 0 ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5"} />
    </svg>
  );
}

function Bars() {
  return (
    <span className="cf-bars" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function Back({ record, playing, onPlay, live }) {
  const onKeyDown = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = [...e.currentTarget.querySelectorAll("button")];
    const i = rows.indexOf(e.target);
    if (i < 0) return;
    e.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))].focus();
  };
  return (
    <>
      <div className="cf-back-head">
        <p className="cf-back-title text-heading">{record.title}</p>
        <p className="cf-back-meta text-ui-lg tabular-nums">{record.year ? `${record.artist} · ${record.year}` : record.artist}</p>
      </div>
      <ol className="cf-tracks" onKeyDown={live ? onKeyDown : undefined}>
        {record.tracks.map((t) => (
          <li key={t.id}>
            {live ? (
              <button type="button" className="cf-track" data-playing={playing === t.id ? "true" : "false"} aria-current={playing === t.id ? "true" : undefined} onClick={() => onPlay(t.id)}>
                <span className="cf-n text-ui-lg tabular-nums">{playing === t.id ? <Bars /> : t.n}</span>
                <span className="cf-track-title text-ui-lg">{t.title}</span>
                <span className="cf-len text-ui-lg tabular-nums">{t.length}</span>
              </button>
            ) : (
              <span className="cf-track" data-playing={playing === t.id ? "true" : "false"}>
                <span className="cf-n text-ui-lg tabular-nums">{playing === t.id ? <Bars /> : t.n}</span>
                <span className="cf-track-title text-ui-lg">{t.title}</span>
                <span className="cf-len text-ui-lg tabular-nums">{t.length}</span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

const startOf = (records) => {
  const i = records.findIndex((r) => r.id === "revolver");
  return i >= 0 ? i : Math.floor((records.length - 1) / 2);
};

export default function Piece({ embedded = false }) {
  const { tracks, live } = useTopSongs(50);
  const records = useMemo(() => recordsFrom(tracks, live), [tracks, live]);
  const rootRef = useRef(null);
  const flowRef = useRef(null);
  const [view, setView] = useState({ records: null, center: 0 });
  const [flipped, setFlipped] = useState(-1);
  const [playing, setPlaying] = useState(null);
  const [sleeves, setSleeves] = useState({});
  const [loaded, setLoaded] = useState({ records: null, map: {} });
  const [late, setLate] = useState(null);
  const center = view.records === records ? view.center : startOf(records);

  useEffect(() => {
    let alive = true;
    for (const r of records) {
      const img = new Image();
      if (r.remote) img.crossOrigin = "anonymous";
      img.onload = () => {
        if (!alive) return;
        let tone = null;
        let plain = false;
        try {
          tone = readSleeve(img);
          plain = isPlain(img);
        } catch {
          tone = null;
        }
        setSleeves((m) => (m[r.id] === tone ? m : { ...m, [r.id]: tone }));
        setLoaded((l) => ({ records, map: { ...(l.records === records ? l.map : {}), [r.id]: plain ? "plain" : "ok" } }));
      };
      img.onerror = () => {
        if (alive) setLoaded((l) => ({ records, map: { ...(l.records === records ? l.map : {}), [r.id]: "failed" } }));
      };
      img.src = r.cover;
    }
    const timer = setTimeout(() => alive && setLate(records), 4000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [records]);

  useEffect(() => {
    const root = rootRef.current;
    const ticks = createTicks();
    const wake = () => ticks.wake();
    root.addEventListener("pointerdown", wake);
    root.addEventListener("keydown", wake);
    const flow = createFlow(root, {
      count: records.length,
      start: startOf(records),
      onCenter: (i) => setView({ records, center: i }),
      onTick: ticks.tick,
      onFlip: (i) => {
        setFlipped(i);
        if (i < 0 && root.contains(document.activeElement) && document.activeElement !== root) root.focus({ preventScroll: true });
      },
      onFlick: ticks.flick,
    });
    flowRef.current = flow;
    return () => {
      root.removeEventListener("pointerdown", wake);
      root.removeEventListener("keydown", wake);
      flow.destroy();
      ticks.destroy();
      flowRef.current = null;
    };
  }, [records]);

  const album = records[center] ?? records[0];
  const state = loaded.records === records ? loaded.map : {};
  const first = startOf(records);
  const ready = late === records || records.every((r, i) => Math.abs(i - first) > 4 || state[r.id]);

  return (
    <div
      ref={rootRef}
      className="cf"
      data-embedded={embedded ? "true" : "false"}
      data-flipped="false"
      tabIndex={0}
      role="listbox"
      aria-label="Records"
      aria-activedescendant={`cf-item-${album.id}`}
    >
      {!embedded && <h1 className="cf-heading text-heading">Cover Flow</h1>}

      <div className="cf-stage" data-cf-stage data-ready={ready ? "true" : "false"}>
        {records.map((a, i) => (
          <div
            key={a.id}
            id={`cf-item-${a.id}`}
            className="cf-item"
            data-cf-item
            data-index={i}
            role="option"
            aria-selected={i === center}
            aria-label={a.year ? `${a.title}, ${a.artist}, ${a.year}` : `${a.title}, ${a.artist}`}
            data-loaded={state[a.id] === "ok" || state[a.id] === "plain" ? "true" : "false"}
            data-plain={state[a.id] === "plain" ? "true" : undefined}
            style={{ "--cf-sleeve": sleeves[a.id] ?? "hsl(30 6% 14%)" }}
          >
            <div className="cf-face cf-front">
              <img className="cf-cover" src={a.cover} alt="" draggable={false} />
              <span className="cf-gloss" aria-hidden="true" />
              <span className="cf-shade" aria-hidden="true" />
            </div>
            <div className="cf-face cf-back" inert={flipped !== i ? true : undefined} aria-hidden={flipped !== i}>
              <Back record={a} playing={playing} onPlay={setPlaying} live />
              <span className="cf-gloss" aria-hidden="true" />
              <span className="cf-shade" aria-hidden="true" />
            </div>
            <div className="cf-mirror" aria-hidden="true" inert>
              <div className="cf-face cf-front">
                <img className="cf-cover" src={a.cover} alt="" draggable={false} />
                <span className="cf-shade" />
              </div>
              <div className="cf-face cf-back">
                <Back record={a} playing={playing} onPlay={setPlaying} live={false} />
                <span className="cf-shade" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="cf-caption">
        <h2 className="cf-title text-title-lg" aria-live="polite">
          {album.title}
        </h2>
        <p className="cf-meta text-ui-lg">
          <span className="cf-meta-artist">{album.artist}</span>
          {album.year && <span aria-hidden="true">·</span>}
          {album.year && <span className="tabular-nums">{album.year}</span>}
        </p>
      </div>

      <div className="cf-controls">
        <button type="button" className="cf-step" aria-label="Previous record" disabled={center === 0} onClick={() => flowRef.current?.step(-1)}>
          <Chevron dir={-1} />
        </button>
        <div className="cf-scrub" data-cf-scrub>
          <span className="cf-scrub-track" aria-hidden="true" />
          <span className="cf-thumb" data-cf-thumb aria-hidden="true" />
        </div>
        <button type="button" className="cf-step" aria-label="Next record" disabled={center === records.length - 1} onClick={() => flowRef.current?.step(1)}>
          <Chevron dir={1} />
        </button>
        <span className="cf-count text-ui font-mono tabular-nums">
          {String(center + 1).padStart(2, "0")} / {String(records.length).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}
