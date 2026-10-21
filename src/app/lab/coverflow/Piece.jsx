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

function Swap({ id, className, block = false, children }) {
  const [s, setS] = useState({ id, node: children, prev: null, n: 0 });
  if (s.id !== id) setS({ id, node: children, prev: { node: s.node, n: s.n }, n: s.n + 1 });
  const Tag = block ? "div" : "span";
  return (
    <Tag className={`cf-swap ${className ?? ""}`}>
      {s.prev ? (
        <Tag key={s.prev.n} className="cf-swap-layer" data-out="" aria-hidden="true">
          {s.prev.node}
        </Tag>
      ) : null}
      <Tag key={s.n} className="cf-swap-layer" data-in={s.n > 0 ? "" : undefined}>
        {s.id === id ? children : s.node}
      </Tag>
    </Tag>
  );
}

function Layers({ layers, front }) {
  return layers.map((l) => (
    <img key={l.key} className="cf-cover" src={l.cover} alt="" draggable={false} data-in={l.on ? "true" : "false"} data-plain={l.plain ? "true" : undefined} data-back-layer={front ? undefined : "true"} />
  ));
}

export default function Piece({ embedded = false }) {
  const { tracks, live } = useTopSongs(50);
  const records = useMemo(() => recordsFrom(tracks, live), [tracks, live]);
  const rootRef = useRef(null);
  const flowRef = useRef(null);
  const [hist, setHist] = useState({ records, prev: null });
  if (hist.records !== records) setHist({ records, prev: hist.records });
  const prev = hist.records === records ? hist.prev : null;
  const [view, setView] = useState(() => startOf(records));
  const [flipped, setFlipped] = useState(-1);
  const [playing, setPlaying] = useState(null);
  const [sleeves, setSleeves] = useState({});
  const [loaded, setLoaded] = useState({});
  const [start] = useState(view);
  const center = Math.min(view, records.length - 1);

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
        setSleeves((m) => (m[r.cover] === tone ? m : { ...m, [r.cover]: tone }));
        setLoaded((m) => ({ ...m, [r.cover]: plain ? "plain" : "ok" }));
      };
      img.onerror = () => {
        if (alive) setLoaded((m) => ({ ...m, [r.cover]: "failed" }));
      };
      img.src = r.cover;
    }
    return () => {
      alive = false;
    };
  }, [records]);

  useEffect(() => {
    const root = rootRef.current;
    const ticks = createTicks();
    const wake = () => ticks.wake();
    root.addEventListener("pointerdown", wake);
    root.addEventListener("keydown", wake);
    const flow = createFlow(root, {
      count: root.querySelectorAll("[data-cf-item]").length,
      start,
      onCenter: (i) => setView(i),
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
  }, [start]);

  useEffect(() => {
    flowRef.current?.setCount(records.length);
  }, [records]);

  const album = records[center] ?? records[0];
  const ok = (cover) => loaded[cover] === "ok" || loaded[cover] === "plain";
  const slots = Array.from({ length: Math.max(records.length, prev?.length ?? 0) }, (_, i) => {
    const rec = records[i] ?? null;
    const old = prev?.[i] ?? null;
    const shown = rec ?? old;
    const layers = [];
    if (old && (!rec || old.cover !== rec.cover)) layers.push({ key: `o-${old.cover}`, cover: old.cover, on: !!rec && ok(old.cover), plain: loaded[old.cover] === "plain" });
    if (rec) layers.push({ key: `n-${rec.cover}`, cover: rec.cover, on: ok(rec.cover), plain: loaded[rec.cover] === "plain" });
    return { i, rec, shown, layers };
  });

  return (
    <div
      ref={rootRef}
      className="cf"
      data-embedded={embedded ? "true" : "false"}
      data-flipped="false"
      tabIndex={0}
      role="listbox"
      aria-label="Records"
      aria-activedescendant={`cf-item-${center}`}
    >
      {!embedded && <h1 className="cf-heading text-heading">Cover Flow</h1>}

      <div className="cf-stage" data-cf-stage>
        {slots.map(({ i, rec, shown, layers }) => (
          <div
            key={i}
            id={rec ? `cf-item-${i}` : undefined}
            className="cf-item"
            data-cf-item={rec ? "" : undefined}
            data-gone={rec ? undefined : "true"}
            data-lit={layers.some((l) => l.on) ? "" : undefined}
            data-index={i}
            role={rec ? "option" : undefined}
            aria-hidden={rec ? undefined : "true"}
            aria-selected={rec ? i === center : undefined}
            aria-label={rec ? (rec.year ? `${rec.title}, ${rec.artist}, ${rec.year}` : `${rec.title}, ${rec.artist}`) : undefined}
            style={{ "--cf-sleeve": sleeves[shown.cover] ?? "hsl(30 6% 14%)" }}
          >
            <div className="cf-face cf-front">
              <Layers layers={layers} front />
              <span className="cf-gloss" aria-hidden="true" />
              <span className="cf-shade" aria-hidden="true" />
            </div>
            <div className="cf-face cf-back" inert={!rec || flipped !== i ? true : undefined} aria-hidden={!rec || flipped !== i}>
              <Back record={shown} playing={playing} onPlay={setPlaying} live={!!rec} />
              <span className="cf-gloss" aria-hidden="true" />
              <span className="cf-shade" aria-hidden="true" />
            </div>
            <div className="cf-mirror" aria-hidden="true" inert>
              <div className="cf-face cf-front">
                <Layers layers={layers} front />
                <span className="cf-shade" />
              </div>
              <div className="cf-face cf-back">
                <Back record={shown} playing={playing} onPlay={setPlaying} live={false} />
                <span className="cf-shade" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <Swap id={`${album.cover}|${album.title}`} className="cf-caption" block>
        <h2 className="cf-title text-title-lg">
          <span className="cf-title-text">{album.title}</span>
        </h2>
        <p className="cf-meta text-ui-lg">
          <span className="cf-meta-artist">{album.artist}</span>
          {album.year && <span aria-hidden="true">·</span>}
          {album.year && <span className="cf-meta-year tabular-nums">{album.year}</span>}
        </p>
      </Swap>

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
        <Swap id={`${center}/${records.length}`} className="cf-count text-ui font-mono tabular-nums">
          {String(center + 1).padStart(2, "0")} / {String(records.length).padStart(2, "0")}
        </Swap>
      </div>
    </div>
  );
}
