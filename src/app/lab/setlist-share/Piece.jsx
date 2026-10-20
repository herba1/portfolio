"use client";

import { Fragment, useEffect, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";
import { renderCard } from "./renderCard";
import { coverColor, lineFor, palette } from "./shareData";

import "./setlist-share.css";

const START = palette(30, 10);

function gradient(colors) {
  return `linear-gradient(160deg, ${colors.stops.map(([at, c]) => `${c} ${Math.round(at * 100)}%`).join(", ")})`;
}

function Typed({ text, delay }) {
  let n = 0;
  const words = text.split(" ");
  return words.map((word, wi) => {
    const chars = Array.from(word).map((ch, ci) => {
      n += 1;
      return (
        <span key={ci} className="ss-ch" style={{ "--d": `${delay + n * 16}ms` }}>
          {ch}
        </span>
      );
    });
    n += 1;
    return (
      <Fragment key={wi}>
        <span className="ss-word" data-w={word}>
          {chars}
        </span>
        {wi < words.length - 1 ? " " : null}
      </Fragment>
    );
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
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="5.2" y="5.2" width="8" height="8" rx="1.6" />
      <path d="M10.8 3.2V2.8c0-.9-.7-1.6-1.6-1.6H4.4c-.9 0-1.6.7-1.6 1.6v4.8c0 .9.7 1.6 1.6 1.6h.4" />
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const { tracks } = useTopSongs(8);
  const rootRef = useRef(null);
  const cardRef = useRef(null);
  const copyRef = useRef(null);
  const [index, setIndex] = useState(0);
  const [colors, setColors] = useState({ key: null, value: START });
  const [layers, setLayers] = useState([]);
  const [copy, setCopy] = useState("idle");
  const track = tracks[Math.min(index, tracks.length - 1)];
  const quote = track ? `“${lineFor(track)}”` : "";
  const ready = track && colors.key === track.id;
  const shown = ready ? colors.value : null;

  useEffect(() => {
    if (!track) return undefined;
    let alive = true;
    coverColor(track.imageLarge || track.image).then((value) => {
      if (!alive) return;
      setColors({ key: track.id, value });
      setLayers((ls) => [...ls.slice(-1), { id: `${track.id}-${Date.now()}`, css: gradient(value) }]);
    });
    return () => {
      alive = false;
    };
  }, [track]);

  useEffect(() => {
    if (copy !== "copied" && copy !== "saved") return undefined;
    const t = setTimeout(() => setCopy("idle"), 2200);
    return () => clearTimeout(t);
  }, [copy]);

  const fly = (url) => {
    const root = rootRef.current;
    const card = cardRef.current;
    const button = copyRef.current;
    if (!root || !card || !button) return;
    const o = root.getBoundingClientRect();
    const a = card.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    const img = document.createElement("img");
    img.src = url;
    img.className = "ss-fly";
    img.style.width = `${a.width}px`;
    img.style.height = `${a.height}px`;
    root.appendChild(img);
    const x0 = a.left - o.left;
    const y0 = a.top - o.top;
    const s1 = 28 / a.width;
    const x1 = b.left - o.left + 10;
    const y1 = b.top - o.top + (b.height - a.height * s1) / 2;
    const anim = img.animate(
      [
        { transform: `translate(${x0}px, ${y0}px) scale(1)`, opacity: 1, offset: 0 },
        { transform: `translate(${x0 + (x1 - x0) * 0.3}px, ${y0 - 24}px) scale(0.6) rotate(-6deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${x1}px, ${y1}px) scale(${s1}) rotate(0deg)`, opacity: 0.9, offset: 1 },
      ],
      { duration: 720, easing: "cubic-bezier(0.5, 0, 0.2, 1)", fill: "forwards" },
    );
    anim.onfinish = () => {
      img.remove();
      URL.revokeObjectURL(url);
      button.animate([{ transform: "scale(1.08)" }, { transform: "scale(1)" }], { duration: 320, easing: "cubic-bezier(0.3, 1.4, 0.5, 1)" });
    };
    card.querySelector(".ss-flash")?.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 520, easing: "ease-out" });
  };

  const save = (blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${track.title.replace(/[^\w]+/g, "-").toLowerCase()}-card.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const onCopy = async () => {
    if (!shown || copy === "working") return;
    setCopy("working");
    try {
      const blob = await renderCard(cardRef.current, shown);
      fly(URL.createObjectURL(blob));
      try {
        await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
        setCopy("copied");
      } catch {
        save(blob);
        setCopy("saved");
      }
    } catch {
      setCopy("idle");
    }
  };

  const onSave = async () => {
    if (!shown) return;
    const blob = await renderCard(cardRef.current, shown);
    save(blob);
  };

  const onListKey = (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const next = (index + (event.key === "ArrowDown" ? 1 : -1) + tracks.length) % tracks.length;
    setIndex(next);
    event.currentTarget.querySelectorAll("[role=radio]")[next]?.focus();
  };

  const Root = embedded ? "div" : "main";
  const label = copy === "copied" ? "Copied" : copy === "saved" ? "Saved as PNG" : copy === "working" ? "Rendering" : "Copy image";

  return (
    <Root ref={rootRef} className="ss-root" data-embedded={embedded ? "" : undefined}>
      <div className="ss-scroll" data-scroll-contain="">
        <aside className="ss-side">
          {embedded ? null : (
            <header className="ss-head">
              <h1 className="text-title-sm">Setlist Share</h1>
              <p className="ss-hint text-ui-lg">Pick one of the top songs and its share card composes itself in the colour of its cover. Copy it as an image.</p>
            </header>
          )}
          <div className="ss-list" role="radiogroup" aria-label="Top songs" onKeyDown={onListKey}>
            {tracks.map((t, i) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={i === index}
                tabIndex={i === index ? 0 : -1}
                className="ss-row"
                onClick={() => setIndex(i)}
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
        </aside>
        <section className="ss-stage" aria-label="Share card">
          <div ref={cardRef} className="ss-card" data-ready={ready ? "" : undefined}>
            <div className="ss-bgs" aria-hidden="true">
              {layers.map((l) => (
                <span key={l.id} className="ss-bg" style={{ background: l.css }} />
              ))}
            </div>
            {track && ready ? (
              <div key={track.id} className="ss-compose" style={{ "--glow": shown.glow }}>
                <span className="ss-glow" data-draw="glow" aria-hidden="true" />
                <p className="ss-label" data-draw="text">
                  On repeat
                </p>
                <img className="ss-cover" data-draw="image" src={track.imageLarge || track.image} alt={`${track.album} cover`} crossOrigin="anonymous" />
                <h2 className="ss-title" data-draw="text" data-text={track.title}>
                  {track.title.split(" ").map((w, i, all) => (
                    <Fragment key={i}>
                      <span className="ss-tw" data-w={w}>
                        <span style={{ "--i": i }}>{w}</span>
                      </span>
                      {i < all.length - 1 ? " " : null}
                    </Fragment>
                  ))}
                </h2>
                <p className="ss-meta" data-draw="text">
                  {track.artist} · {track.album}
                </p>
                <blockquote className="ss-quote" data-draw="text" data-text={quote}>
                  <Typed text={quote} delay={760} />
                </blockquote>
                <p className="ss-foot" data-draw="text">
                  Number {index + 1} in Herb&rsquo;s top songs
                </p>
              </div>
            ) : null}
            <span className="ss-flash" aria-hidden="true" />
          </div>
          <div className="ss-actions">
            <button ref={copyRef} type="button" className="ss-copy" data-state={copy} onClick={onCopy} disabled={!ready}>
              {copy === "copied" || copy === "saved" ? <CheckIcon /> : <CopyIcon />}
              <span key={label}>{label}</span>
            </button>
            <button type="button" className="ss-save" onClick={onSave} disabled={!ready}>
              Save PNG
            </button>
          </div>
          <p className="ss-live" aria-live="polite">
            {copy === "copied" ? "Card copied to the clipboard" : copy === "saved" ? "Card saved as a PNG" : ""}
          </p>
        </section>
      </div>
    </Root>
  );
}
