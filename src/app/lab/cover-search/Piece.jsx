"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";

import { buildIndex, search } from "./searchIndex";
import "./cover-search.css";

const SUGGESTIONS = ["sun", "love", "walrus", "1967", "yesterday", "abbey"];
const BROWSE_ALBUMS = [
  "abbey-road",
  "revolver",
  "rubber-soul",
  "sgt-pepper",
  "let-it-be",
  "help",
];

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
    <svg
      viewBox="0 0 20 20"
      width="20"
      height="20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <circle cx="9" cy="9" r="5.8" />
      <path d="m13.4 13.4 3.8 3.8" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M4.5 2.8v10.4a.6.6 0 0 0 .9.5l8.3-5.2a.6.6 0 0 0 0-1L5.4 2.3a.6.6 0 0 0-.9.5Z"
        fill="currentColor"
      />
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

function TopCard({ item, active, playing, onPlay }) {
  return (
    <button
      type="button"
      id={`cs-opt-${item.id}`}
      role="option"
      aria-selected={active}
      className="cs-card"
      data-active={active ? "true" : "false"}
      data-playing={playing ? "true" : "false"}
      onClick={() => onPlay(item.id)}
    >
      <span key={item.id} className="cs-card-body cs-fade">
        <img
          className="cs-card-cover"
          src={item.cover}
          alt=""
          draggable={false}
        />
        <span className="cs-card-text">
          <span className="cs-card-title text-title">
            <Highlight text={item.title} hits={item.titleHits} />
          </span>
          <span className="cs-card-meta text-ui-lg">
            {item.kind}
            <span aria-hidden="true"> · </span>
            <Highlight text={item.sub} hits={item.subHits} />
          </span>
        </span>
      </span>
      <span
        className="cs-card-play"
        data-playing={playing ? "true" : "false"}
        aria-hidden="true"
      >
        {playing ? <Bars /> : <PlayGlyph />}
      </span>
    </button>
  );
}

function SongRow({ item, active, playing, onPlay }) {
  return (
    <li className="cs-fade">
      <button
        type="button"
        id={`cs-opt-${item.id}`}
        role="option"
        aria-selected={active}
        className="cs-row"
        data-active={active ? "true" : "false"}
        data-playing={playing ? "true" : "false"}
        onClick={() => onPlay(item.id)}
      >
        <span className="cs-row-cover">
          <img src={item.cover} alt="" draggable={false} />
          {playing && (
            <span className="cs-row-bars">
              <Bars />
            </span>
          )}
        </span>
        <span className="cs-row-text">
          <span className="cs-row-title text-body">
            <Highlight text={item.title} hits={item.titleHits} />
          </span>
          <span className="cs-row-sub text-ui-lg">
            <Highlight text={item.sub} hits={item.subHits} />
          </span>
        </span>
      </button>
    </li>
  );
}

function AlbumTile({ item, active, playing, onPlay }) {
  const year = item.sub.split(" · ").pop();
  const shift = item.sub.length - year.length;
  const yearHits = (item.subHits ?? [])
    .map((h) => h - shift)
    .filter((h) => h >= 0);
  return (
    <button
      type="button"
      id={`cs-opt-${item.id}`}
      role="option"
      aria-selected={active}
      className="cs-album cs-fade"
      data-active={active ? "true" : "false"}
      onClick={() => onPlay(item.id)}
    >
      <span className="cs-album-cover">
        <img src={item.cover} alt="" draggable={false} />
        {playing && (
          <span className="cs-row-bars">
            <Bars />
          </span>
        )}
      </span>
      <span className="cs-album-title text-heading-sm">
        <Highlight text={item.title} hits={item.titleHits} />
      </span>
      <span className="cs-album-year text-ui-lg tabular-nums">
        <Highlight text={year} hits={yearHits} />
      </span>
    </button>
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

  const browsing = !query.trim();
  const results = useMemo(() => search(index, query, 40), [index, query]);

  const view = useMemo(() => {
    if (browsing) {
      const top = index.filter((i) => i.top);
      const albums = BROWSE_ALBUMS.map((id) =>
        index.find((i) => i.id === `album-${id}`),
      ).filter(Boolean);
      return { lead: top[0] ?? null, songs: top.slice(1, 5), albums };
    }
    const lead = results[0] ?? null;
    const rest = results.slice(1);
    return {
      lead,
      songs: rest.filter((i) => i.kind === "Song").slice(0, 4),
      albums: rest.filter((i) => i.kind === "Album").slice(0, 6),
    };
  }, [browsing, index, results]);

  const ordered = [view.lead, ...view.songs, ...view.albums].filter(Boolean);
  const activeIndex = ordered.findIndex((i) => i.id === activeId);
  const isActive = (id) => activeIndex >= 0 && ordered[activeIndex].id === id;

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
      if (n < word.length) typerRef.current = setTimeout(() => step(n + 1), 70);
    };
    step(1);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = ordered[Math.min(ordered.length - 1, activeIndex + 1)];
      if (next) setActiveId(next.id);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveId(activeIndex > 0 ? ordered[activeIndex - 1].id : null);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = ordered[Math.max(0, activeIndex)];
      if (pick) setPlayingId(pick.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      change("");
    }
  };

  const status = browsing
    ? ""
    : results.length
      ? `${results.length} result${results.length === 1 ? "" : "s"}`
      : "No results";

  return (
    <div className="cs" data-embedded={embedded ? "true" : "false"}>
      <div className="cs-scroll" data-scroll-contain>
        <div className="cs-column">
          {!embedded && <h1 className="cs-heading text-title-lg">Search</h1>}

          <div className="cs-field">
            <SearchIcon />
            <input
              ref={inputRef}
              className="cs-input text-body-lg"
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls="cs-results"
              aria-activedescendant={
                activeId ? `cs-opt-${activeId}` : undefined
              }
              aria-label="Search songs and albums"
              placeholder="Songs, albums, years"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => change(e.target.value)}
              onKeyDown={onKeyDown}
            />
            {query ? (
              <button
                type="button"
                className="cs-clear"
                aria-label="Clear search"
                onClick={() => change("")}
              >
                <ClearIcon />
              </button>
            ) : (
              <kbd className="cs-kbd text-ui-lg">⌘K</kbd>
            )}
          </div>

          <div className="cs-suggest">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className="cs-chip text-ui-lg"
                data-on={query === s ? "true" : "false"}
                onClick={() => typeOut(s)}
              >
                {s}
              </button>
            ))}
          </div>

          <p className="cs-sr" aria-live="polite">
            {status}
          </p>

          <div
            id="cs-results"
            role="listbox"
            aria-label="Results"
            className="cs-results"
          >
            {view.lead ? (
              <>
                <div
                  className="cs-top"
                  data-songs={view.songs.length ? "true" : "false"}
                >
                  <section className="cs-section">
                    <h2 className="cs-label text-heading">
                      {browsing ? "Your top song" : "Top result"}
                    </h2>
                    <TopCard
                      item={view.lead}
                      active={isActive(view.lead.id)}
                      playing={playingId === view.lead.id}
                      onPlay={setPlayingId}
                    />
                  </section>
                  {view.songs.length > 0 ? (
                    <section className="cs-section">
                      <h2 className="cs-label text-heading">
                        {browsing ? "Top songs" : "Songs"}
                      </h2>
                      <ul className="cs-rows">
                        {view.songs.map((item) => (
                          <SongRow
                            key={item.id}
                            item={item}
                            active={isActive(item.id)}
                            playing={playingId === item.id}
                            onPlay={setPlayingId}
                          />
                        ))}
                      </ul>
                    </section>
                  ) : (
                    view.albums.length > 0 && (
                      <section className="cs-section">
                        <h2 className="cs-label text-heading">Albums</h2>
                        <div className="cs-albums" data-side="true">
                          {view.albums.map((item) => (
                            <AlbumTile
                              key={item.id}
                              item={item}
                              active={isActive(item.id)}
                              playing={playingId === item.id}
                              onPlay={setPlayingId}
                            />
                          ))}
                        </div>
                      </section>
                    )
                  )}
                </div>
                {view.songs.length > 0 && view.albums.length > 0 && (
                  <section className="cs-section cs-albums-section">
                    <h2 className="cs-label text-heading">Albums</h2>
                    <div className="cs-albums">
                      {view.albums.map((item) => (
                        <AlbumTile
                          key={item.id}
                          item={item}
                          active={isActive(item.id)}
                          playing={playingId === item.id}
                          onPlay={setPlayingId}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </>
            ) : (
              <div className="cs-empty cs-fade">
                <p className="cs-empty-title text-title-sm">
                  Nothing matches “{query.trim()}”
                </p>
                <p className="cs-empty-sub text-body">
                  Try a song, an album or a year, like 1965.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
