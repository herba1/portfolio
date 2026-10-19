"use client";

import { Fragment, useEffect, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";
import { renderCard } from "./renderCard";
import { coverColor } from "./shareData";

import "./setlist-share.css";

function gradient(colors) {
  return `linear-gradient(160deg, ${colors.stops.map(([at, c]) => `${c} ${Math.round(at * 100)}%`).join(", ")})`;
}

function decode(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    (img.decode ? img.decode() : Promise.resolve()).then(resolve, resolve);
  });
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path className="ss-check" d="M3.5 8.4 6.6 11.4 12.6 4.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="5.2" y="5.2" width="8" height="8" rx="1.6" />
      <path d="M10.8 3.2V2.8c0-.9-.7-1.6-1.6-1.6H4.4c-.9 0-1.6.7-1.6 1.6v4.8c0 .9.7 1.6 1.6 1.6h.4" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2.5v7.5M4.8 7 8 10.2 11.2 7M3 12.8h10" />
    </svg>
  );
}

function Face({ face, rank, faceRef, leaving }) {
  const { track, colors } = face;
  return (
    <div ref={faceRef} className="ss-face" data-leaving={leaving ? "" : undefined} aria-hidden={leaving || undefined} style={{ background: gradient(colors), "--ss-soft": colors.soft }}>
      <div className="ss-top">
        <span className="ss-label" data-draw="text">
          On repeat
        </span>
        <span className="ss-rank-tag" data-draw="text">
          No. {rank}
        </span>
      </div>
      <img className="ss-cover" data-draw="image" src={track.imageLarge || track.image} alt={`${track.album} cover`} crossOrigin="anonymous" draggable={false} />
      <div className="ss-bottom">
        <h2 className="ss-title" data-draw="text">
          {track.title.split(" ").map((w, i, all) => (
            <Fragment key={i}>
              <span className="ss-tw" data-w={w}>
                {w}
              </span>
              {i < all.length - 1 ? " " : null}
            </Fragment>
          ))}
        </h2>
        <p className="ss-meta" data-draw="text">
          {track.artist} · {track.album}
        </p>
      </div>
    </div>
  );
}

function ActionLabel({ states, current }) {
  return (
    <span className="ss-label-stack">
      {Object.entries(states).map(([key, text]) => (
        <span key={key} data-on={key === current ? "" : undefined} aria-hidden={key !== current}>
          {text}
        </span>
      ))}
    </span>
  );
}

export default function Piece({ embedded = false }) {
  const { tracks } = useTopSongs(8);
  const cardRef = useRef(null);
  const topFace = useRef(null);
  const seq = useRef(0);
  const [index, setIndex] = useState(0);
  const [faces, setFaces] = useState([]);
  const [copy, setCopy] = useState("idle");
  const [save, setSave] = useState("idle");
  const track = tracks[Math.min(index, tracks.length - 1)];
  const front = faces[faces.length - 1];
  const ready = Boolean(front && track && front.track.id === track.id);

  useEffect(() => {
    if (!track) return undefined;
    let alive = true;
    const src = track.imageLarge || track.image;
    Promise.all([coverColor(src), decode(src)]).then(([colors]) => {
      if (!alive) return;
      seq.current += 1;
      const id = seq.current;
      setFaces((fs) => {
        if (fs.length && fs[fs.length - 1].track.id === track.id) return fs;
        return [...fs.slice(-2), { id, track, colors, rank: index + 1 }];
      });
    });
    return () => {
      alive = false;
    };
  }, [track, index]);

  useEffect(() => {
    if (faces.length < 2) return undefined;
    const t = setTimeout(() => setFaces((fs) => fs.slice(-1)), 480);
    return () => clearTimeout(t);
  }, [faces]);

  useEffect(() => {
    if (copy !== "done" && copy !== "downloaded") return undefined;
    const t = setTimeout(() => setCopy("idle"), 1800);
    return () => clearTimeout(t);
  }, [copy]);

  useEffect(() => {
    if (save !== "done") return undefined;
    const t = setTimeout(() => setSave("idle"), 1800);
    return () => clearTimeout(t);
  }, [save]);

  const capture = async () => {
    const el = topFace.current;
    if (!el || !front) return null;
    cardRef.current?.animate([{ transform: "scale(0.985)" }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    return renderCard(el, front.colors);
  };

  const download = (blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${front.track.title.replace(/[^\w]+/g, "-").toLowerCase()}-card.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const onCopy = async () => {
    if (!ready || copy === "working") return;
    setCopy("working");
    try {
      const blob = await capture();
      if (!blob) throw new Error("empty");
      try {
        await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
        setCopy("done");
      } catch {
        download(blob);
        setCopy("downloaded");
      }
    } catch {
      setCopy("idle");
    }
  };

  const onSave = async () => {
    if (!ready || save === "working") return;
    setSave("working");
    try {
      const blob = await capture();
      if (!blob) throw new Error("empty");
      download(blob);
      setSave("done");
    } catch {
      setSave("idle");
    }
  };

  const pick = (i) => {
    if (i === index) return;
    setIndex(i);
    setCopy("idle");
    setSave("idle");
  };

  const onListKey = (event) => {
    const keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = (index + keys[event.key] + tracks.length) % tracks.length;
    pick(next);
    event.currentTarget.querySelectorAll("[role=radio]")[next]?.focus();
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root className="ss-root" data-embedded={embedded ? "" : undefined}>
      <div className="ss-scroll" data-scroll-contain="">
        {embedded ? null : (
          <header className="ss-head">
            <h1 className="ss-h1">Setlist Share</h1>
          </header>
        )}
        <div className="ss-layout">
          <section className="ss-stage" aria-label="Share card">
            <div ref={cardRef} className="ss-card" aria-busy={!ready}>
              {faces.map((f, i) => (
                <Face key={f.id} face={f} rank={f.rank} leaving={i < faces.length - 1} faceRef={i === faces.length - 1 ? topFace : undefined} />
              ))}
            </div>
          </section>
          <div className="ss-side">
            <div className="ss-list" role="radiogroup" aria-label="Top songs" onKeyDown={onListKey}>
              {tracks.map((t, i) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={i === index}
                  aria-label={`${t.title}, ${t.album}`}
                  tabIndex={i === index ? 0 : -1}
                  className="ss-row"
                  onClick={() => pick(i)}
                >
                  <span className="ss-rank">{i + 1}</span>
                  <img src={t.image} alt="" draggable={false} crossOrigin="anonymous" />
                  <span className="ss-row-text">
                    <span className="ss-row-title">{t.title}</span>
                    <span className="ss-row-sub">{t.album}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="ss-actions">
              <button type="button" className="ss-copy" data-state={copy} onClick={onCopy} disabled={!ready}>
                <span className="ss-icon">{copy === "done" || copy === "downloaded" ? <CheckIcon key="c" /> : <CopyIcon />}</span>
                <ActionLabel states={{ idle: "Copy image", working: "Copying", done: "Copied", downloaded: "Downloaded" }} current={copy} />
              </button>
              <button type="button" className="ss-save" data-state={save} onClick={onSave} disabled={!ready}>
                <span className="ss-icon">{save === "done" ? <CheckIcon key="c" /> : <SaveIcon />}</span>
                <ActionLabel states={{ idle: "Save PNG", working: "Saving", done: "Saved" }} current={save} />
              </button>
            </div>
            <p className="ss-live" aria-live="polite">
              {copy === "done" ? "Card copied to the clipboard" : copy === "downloaded" || save === "done" ? "Card saved as a PNG" : ""}
            </p>
          </div>
        </div>
      </div>
    </Root>
  );
}
