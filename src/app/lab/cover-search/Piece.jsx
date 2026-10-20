"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";

import { buildIndex, search } from "./searchIndex";
import "./cover-search.css";

const EASE = [0.22, 1, 0.36, 1];
const SPRING = { type: "spring", stiffness: 380, damping: 36, mass: 0.8 };
const SUGGESTIONS = ["sun", "love", "walrus", "1967", "yesterday", "abbey"];

function Highlight({ text, hits }) {
  if (!hits?.length) return text;
  const set = new Set(hits);
  const parts = [];
  let run = "";
  let on = set.has(0);
  for (let i = 0; i < text.length; i += 1) {
    const hit = set.has(i);
    if (hit !== on) {
      parts.push({ on, s: run });
      run = "";
      on = hit;
    }
    run += text[i];
  }
  parts.push({ on, s: run });
  return parts.map((p, i) =>
    p.on ? (
      <mark key={i} className="cs-hit">
        {p.s}
      </mark>
    ) : (
      <span key={i}>{p.s}</span>
    ),
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="9" cy="9" r="5.8" />
      <path d="m13.4 13.4 3.8 3.8" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M4.5 2.8v10.4a.6.6 0 0 0 .9.5l8.3-5.2a.6.6 0 0 0 0-1L5.4 2.3a.6.6 0 0 0-.9.5Z" fill="currentColor" />
    </svg>
  );
}

function Bars() {
  return (
    <span className="cs-bars" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function Tile({ ref, item, active, playing, onPlay, onHover, index }) {
  return (
    <motion.button
      ref={ref}
      layout
      type="button"
      id={`cs-opt-${item.id}`}
      role="option"
      aria-selected={active}
      className="cs-tile"
      data-active={active ? "true" : "false"}
      initial={{ opacity: 0, scale: 0.7, y: 24, filter: "blur(6px)" }}
      animate={{ opacity: 1, scale: 1, y: 0, rotate: 0, filter: "blur(0px)", transition: { ...SPRING, delay: Math.min(index, 12) * 0.018 } }}
      exit={{ opacity: 0, scale: 0.86, y: 56, rotate: item.tilt * 9, filter: "blur(4px)", transition: { duration: 0.32, ease: [0.55, 0, 0.75, 0.2] } }}
      transition={SPRING}
      onClick={() => onPlay(item.id)}
      onPointerEnter={() => onHover(item.id)}
    >
      <span className="cs-tile-cover">
        <motion.img layoutId={`cover-${item.id}`} transition={SPRING} src={item.cover} alt="" draggable={false} crossOrigin={item.cover.startsWith("http") ? "anonymous" : undefined} />
        {playing && (
          <span className="cs-playing">
            <Bars />
          </span>
        )}
      </span>
      <span className="cs-tile-title text-heading-sm">
        <Highlight text={item.title} hits={item.titleHits} />
      </span>
      <span className="cs-tile-sub text-ui">
        <span className="cs-kind">{item.kind}</span>
        <span aria-hidden="true"> · </span>
        <Highlight text={item.sub} hits={item.subHits} />
      </span>
    </motion.button>
  );
}

function Hero({ ref, item, active, playing, onPlay, onHover }) {
  return (
    <motion.button
      ref={ref}
      layout
      type="button"
      id={`cs-opt-${item.id}`}
      role="option"
      aria-selected={active}
      className="cs-hero"
      data-active={active ? "true" : "false"}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.16 } }}
      transition={SPRING}
      onClick={() => onPlay(item.id)}
      onPointerEnter={() => onHover(item.id)}
    >
      <span className="cs-hero-cover">
        <motion.img layoutId={`cover-${item.id}`} transition={SPRING} src={item.cover} alt="" draggable={false} crossOrigin={item.cover.startsWith("http") ? "anonymous" : undefined} />
      </span>
      <motion.span
        key={item.id}
        className="cs-hero-text"
        initial={{ opacity: 0, x: -12, filter: "blur(6px)" }}
        animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.42, ease: EASE, delay: 0.06 }}
      >
        <span className="cs-hero-label text-ui-lg">Top result</span>
        <span className="cs-hero-title text-title-lg">
          <Highlight text={item.title} hits={item.titleHits} />
        </span>
        <span className="cs-hero-sub text-ui-lg">
          <span className="cs-kind-pill text-ui">{item.kind}</span>
          <Highlight text={item.sub} hits={item.subHits} />
        </span>
      </motion.span>
      <span className="cs-hero-play" data-playing={playing ? "true" : "false"} aria-hidden="true">
        {playing ? <Bars /> : <PlayGlyph />}
      </span>
    </motion.button>
  );
}

export default function Piece({ embedded = false }) {
  const { tracks } = useTopSongs(16);
  const index = useMemo(() => buildIndex(tracks), [tracks]);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [playingId, setPlayingId] = useState(null);
  const inputRef = useRef(null);
  const typerRef = useRef(0);

  const results = useMemo(() => search(index, query), [index, query]);
  const browsing = !query.trim();
  const list = browsing ? [...index.filter((i) => i.top).slice(0, 12), ...index.filter((i) => i.album)] : results;
  const hero = browsing ? null : list[0] ?? null;
  const grid = hero ? list.slice(1) : list;
  const ordered = hero ? [hero, ...grid] : grid;
  const activeIndex = Math.max(0, ordered.findIndex((i) => i.id === activeId));
  const active = ordered[activeIndex] ?? null;
  const backdrop = (hero ?? active)?.cover ?? null;

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(typerRef.current);
    };
  }, []);

  const change = (value) => {
    clearTimeout(typerRef.current);
    setQuery(value);
    setActiveId(null);
  };

  const typeOut = (word) => {
    clearTimeout(typerRef.current);
    setActiveId(null);
    inputRef.current?.focus();
    const step = (n) => {
      setQuery(word.slice(0, n));
      if (n < word.length) typerRef.current = setTimeout(() => step(n + 1), 90);
    };
    step(1);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      if (e.key === "ArrowRight" && e.currentTarget.selectionStart < query.length) return;
      e.preventDefault();
      const next = ordered[Math.min(ordered.length - 1, activeIndex + (activeId ? 1 : 0))];
      if (next) setActiveId(next.id);
    } else if (e.key === "ArrowUp" || (e.key === "ArrowLeft" && activeId)) {
      e.preventDefault();
      const prev = ordered[Math.max(0, activeIndex - 1)];
      if (prev) setActiveId(prev.id);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = active ?? ordered[0];
      if (pick) setPlayingId(pick.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      change("");
    }
  };

  const countLabel = browsing ? "Your top songs and albums" : results.length ? `${results.length} result${results.length === 1 ? "" : "s"}` : "No results";

  return (
    <div className="cs" data-embedded={embedded ? "true" : "false"}>
      <div className="cs-backdrop" aria-hidden="true">
        <AnimatePresence initial={false}>
          {backdrop && (
            <motion.img
              key={backdrop}
              src={backdrop}
              alt=""
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8, ease: EASE }}
            />
          )}
        </AnimatePresence>
      </div>

      <div className="cs-scroll" data-scroll-contain>
        <div className="cs-column">
          {!embedded && <h1 className="cs-heading text-title">Search</h1>}

          <div className="cs-field" data-filled={query ? "true" : "false"}>
            <SearchIcon />
            <input
              ref={inputRef}
              className="cs-input text-body"
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls="cs-results"
              aria-activedescendant={activeId ? `cs-opt-${activeId}` : undefined}
              aria-label="Search songs and albums"
              placeholder="Songs, albums, years"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => change(e.target.value)}
              onKeyDown={onKeyDown}
            />
            {query ? (
              <button type="button" className="cs-clear" aria-label="Clear search" onClick={() => change("")}>
                <ClearIcon />
              </button>
            ) : (
              <kbd className="cs-kbd text-ui font-mono">⌘K</kbd>
            )}
          </div>

          <div className="cs-suggest">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="cs-chip text-ui" data-on={query === s ? "true" : "false"} onClick={() => typeOut(s)}>
                {s}
              </button>
            ))}
          </div>

          <p className="cs-count text-ui-lg tabular-nums" aria-live="polite">
            {countLabel}
          </p>

          <LayoutGroup>
            <div id="cs-results" role="listbox" aria-label="Results" className="cs-results">
              <AnimatePresence mode="popLayout">
                {hero && (
                  <Hero
                    key="hero"
                    item={hero}
                    active={active?.id === hero.id && Boolean(activeId)}
                    playing={playingId === hero.id}
                    onPlay={setPlayingId}
                    onHover={setActiveId}
                  />
                )}
              </AnimatePresence>
              <div className="cs-grid">
                <AnimatePresence mode="popLayout">
                  {grid.map((item, i) => (
                    <Tile
                      key={item.id}
                      item={item}
                      index={i}
                      active={Boolean(activeId) && active?.id === item.id}
                      playing={playingId === item.id}
                      onPlay={setPlayingId}
                      onHover={setActiveId}
                    />
                  ))}
                </AnimatePresence>
              </div>
              <AnimatePresence>
                {!browsing && !results.length && (
                  <motion.div
                    className="cs-empty"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3, ease: EASE }}
                  >
                    <p className="cs-empty-title text-heading">Nothing matches “{query}”</p>
                    <p className="cs-empty-sub text-ui-lg">Try a song, an album or a year, like 1965.</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </LayoutGroup>
        </div>
      </div>
    </div>
  );
}
