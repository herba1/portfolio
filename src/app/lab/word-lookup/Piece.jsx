"use client";

import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ALBUM, ARTIST } from "./songs";
import { SONG_BY_ID, SONG_DATA, entryFor, firstIndexOf } from "./lyricData";
import { createLookupEngine } from "./lookupEngine";
import "./word-lookup.css";

const CARD_MAX = 312;
const GAP = 8;
const EDGE = 16;

const INITIAL = { songId: "cambric", index: firstIndexOf("cambric", "cambric"), open: true, key: 1, trail: [] };

function Line({ song, line }) {
  return (
    <span className="wl-line">
      {line.parts.map((part, i) =>
        part.i === undefined ? (
          <Fragment key={i}>{part.sep}</Fragment>
        ) : (
          <span key={i} className="wl-w" data-wi={part.i}>
            {song.words[part.i].text}
          </span>
        ),
      )}
    </span>
  );
}

const Lyrics = memo(function Lyrics({ song, embedded }) {
  return (
    <div className="wl-song">
      <header className="wl-head">
        <h1 className="wl-title">{song.title}</h1>
        <p className="wl-meta">
          <span>{ARTIST}</span>
          <span aria-hidden="true">·</span>
          <em>{ALBUM}</em>
          <span aria-hidden="true">·</span>
          <span className="wl-tabular">{song.length}</span>
        </p>
        {embedded ? null : (
          <p className="wl-hint">
            <span className="wl-hint-fine">Double-click any word to look it up.</span>
            <span className="wl-hint-touch">Tap any word to look it up.</span>
          </p>
        )}
      </header>
      <div className="wl-verses">
        {song.verses.map((verse, v) => (
          <div key={v} className="wl-verse">
            <span className="wl-verse-num" aria-hidden="true">
              {v + 1}
            </span>
            <p className="wl-lines">
              {song.lines
                .filter((line) => line.verseIndex === v)
                .map((line, li) => (
                  <Line key={li} song={song} line={line} />
                ))}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
});

const Entry = memo(function Entry({ songId, index, state, onJump, layerRef }) {
  const entry = entryFor(songId, index);
  if (!entry) return null;
  return (
    <div
      ref={layerRef}
      className="wl-entry"
      data-state={state}
      aria-hidden={state === "out" ? "true" : undefined}
    >
      <div className="wl-e-head">
        <span className="wl-e-word">{entry.headword}</span>
        {entry.ipa ? <span className="wl-e-ipa">/{entry.ipa}/</span> : null}
      </div>
      <div className="wl-e-pos">
        <em>{entry.pos}</em>
        {entry.count > 1 ? (
          <span className="wl-e-count">
            {entry.count} times in {entry.songTitle}
          </span>
        ) : null}
      </div>
      <p className="wl-e-def">{entry.definition}</p>
      {entry.note ? (
        <p className="wl-e-form">
          {entry.note} <b>{entry.lemma}</b>
        </p>
      ) : null}
      <div className="wl-e-also">
        <div className="wl-e-label">{entry.also.length ? "Also in" : `Only in ${entry.songTitle}`}</div>
        {entry.also.map((hit) => (
          <button
            key={hit.songId}
            type="button"
            className="wl-e-link"
            tabIndex={state === "out" ? -1 : 0}
            onClick={() => onJump(hit.songId, hit.index)}
          >
            <span className="wl-e-track">{String(hit.track).padStart(2, "0")}</span>
            <span className="wl-e-link-body">
              <span className="wl-e-link-title">{hit.title}</span>
              <span className="wl-e-link-line">
                {hit.line.parts.map((part, i) =>
                  part.i === undefined ? (
                    <Fragment key={i}>{part.sep}</Fragment>
                  ) : part.i === hit.index ? (
                    <b key={i}>{SONG_BY_ID[hit.songId].words[part.i].text}</b>
                  ) : (
                    <Fragment key={i}>{SONG_BY_ID[hit.songId].words[part.i].text}</Fragment>
                  ),
                )}
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="wl-e-keys" aria-hidden="true">
        <span>
          <kbd>←</kbd>
          <kbd>→</kbd> next word
        </span>
        <span>
          <kbd>esc</kbd> close
        </span>
      </div>
    </div>
  );
});

export default function Piece({ embedded = false }) {
  const [state, setState] = useState(INITIAL);
  const scrollerRef = useRef(null);
  const sheetRef = useRef(null);
  const layerRef = useRef(null);
  const bodyRef = useRef(null);
  const markRef = useRef(null);
  const currentRef = useRef(null);
  const engineRef = useRef(null);
  const stateRef = useRef(state);
  const lastRectRef = useRef(null);

  const song = SONG_BY_ID[state.songId];

  const select = useCallback((songId, index) => {
    setState((prev) => {
      if (prev.open && prev.songId === songId && prev.index === index) return prev;
      return {
        songId,
        index,
        open: true,
        key: prev.key + 1,
        trail: prev.open ? [{ songId: prev.songId, index: prev.index, key: prev.key }, ...prev.trail].slice(0, 3) : [],
      };
    });
  }, []);

  const close = useCallback(() => {
    setState((prev) => (prev.open ? { ...prev, open: false, trail: [] } : prev));
  }, []);

  const switchSong = useCallback((songId) => {
    setState((prev) => {
      if (prev.songId === songId) return prev;
      return { songId, index: 0, open: false, key: prev.key + 1, trail: [] };
    });
  }, []);

  const sync = useCallback((scroll) => {
    const engine = engineRef.current;
    const sheet = sheetRef.current;
    const scroller = scrollerRef.current;
    const body = bodyRef.current;
    if (!engine || !sheet || !scroller || !body) return;
    const current = stateRef.current;
    const sheetRect = sheet.getBoundingClientRect();
    const sheetW = sheet.offsetWidth;
    const sheetH = sheet.offsetHeight;
    engine.setSheet(sheetW, sheetH);
    const span = sheet.querySelector(`.wl-w[data-wi="${current.index}"]`);
    let word = lastRectRef.current?.word ?? null;
    if (span) {
      const r = span.getBoundingClientRect();
      word = { x: r.left - sheetRect.left, y: r.top - sheetRect.top, w: r.width, h: r.height };
    }
    if (!word) return;
    const below = { x: word.x, y: word.y + word.h + 1, w: word.w, h: 2 };
    if (!current.open) {
      engine.hide({ origin: lastRectRef.current?.origin ?? below, word });
      return;
    }
    const cardW = Math.min(CARD_MAX, sheetW - EDGE * 2);
    body.style.width = `${cardW}px`;
    const cardH = currentRef.current ? currentRef.current.offsetHeight : 200;
    const visTop = scroller.getBoundingClientRect().top - sheetRect.top;
    const visBottom = visTop + scroller.clientHeight;
    const x = Math.round(Math.min(Math.max(word.x - 16, EDGE), sheetW - EDGE - cardW));
    const yBelow = Math.round(word.y + word.h + GAP);
    const yAbove = Math.round(word.y - GAP - cardH);
    const fitsBelow = yBelow + cardH <= Math.min(visBottom - 12, sheetH - 8);
    const fitsAbove = yAbove >= visTop + 12;
    const above = !fitsBelow && fitsAbove;
    const y = above ? yAbove : yBelow;
    const origin = above ? { x: word.x, y: word.y - 3, w: word.w, h: 2 } : below;
    lastRectRef.current = { word, origin };
    engine.show({ card: { x, y, w: cardW, h: cardH }, origin, word });
    if (scroll && !fitsBelow && !fitsAbove) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const delta = y + cardH + 16 - visBottom;
      const up = word.y - 24 - visTop;
      const by = delta > 0 ? Math.min(delta, up) : up < 0 ? up : 0;
      if (by) scroller.scrollBy({ top: by, behavior: reduced ? "auto" : "smooth" });
    }
  }, []);

  useEffect(() => {
    const engine = createLookupEngine({
      layer: layerRef.current,
      body: bodyRef.current,
      mark: markRef.current,
    });
    engineRef.current = engine;
    let alive = true;
    document.fonts?.ready.then(() => {
      if (alive) sync(false);
    });
    const ro = new ResizeObserver(() => sync(false));
    ro.observe(sheetRef.current);
    return () => {
      alive = false;
      ro.disconnect();
      engine.destroy();
      engineRef.current = null;
    };
  }, [sync]);

  useLayoutEffect(() => {
    stateRef.current = state;
    const sheet = sheetRef.current;
    if (sheet) {
      for (const el of sheet.querySelectorAll(".wl-w[data-active], .wl-w[data-caret]")) {
        el.removeAttribute("data-active");
        el.removeAttribute("data-caret");
      }
      const el = sheet.querySelector(`.wl-w[data-wi="${state.index}"]`);
      if (el) {
        el.dataset.caret = "true";
        if (state.open) el.dataset.active = "true";
      }
    }
    sync(true);
  }, [state, sync]);

  const wordFromEvent = (event) => {
    const el = event.target.closest?.(".wl-w");
    if (!el || !sheetRef.current?.contains(el)) return null;
    return Number(el.dataset.wi);
  };

  const onDoubleClick = (event) => {
    const index = wordFromEvent(event);
    if (index === null) return;
    window.getSelection()?.removeAllRanges();
    select(stateRef.current.songId, index);
  };

  const onPointerUp = (event) => {
    if (event.target.closest?.(".wl-card")) return;
    const index = wordFromEvent(event);
    const current = stateRef.current;
    if (index !== null && (event.pointerType === "touch" || current.open)) {
      select(current.songId, index);
      return;
    }
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (text && /^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(text)) {
      const anchor = selection.anchorNode?.parentElement?.closest?.(".wl-w") ?? selection.focusNode?.parentElement?.closest?.(".wl-w");
      if (anchor && sheetRef.current?.contains(anchor)) {
        selection.removeAllRanges();
        select(current.songId, Number(anchor.dataset.wi));
        return;
      }
    }
    if (index === null && current.open && !text) close();
  };

  const moveLine = (direction) => {
    const sheet = sheetRef.current;
    const current = stateRef.current;
    const words = SONG_BY_ID[current.songId].words;
    const from = words[current.index];
    if (!sheet || !from) return current.index;
    const targetLine = from.lineIndex + direction;
    const candidates = words.map((w, i) => [w, i]).filter(([w]) => w.lineIndex === targetLine);
    if (!candidates.length) return current.index;
    const fromEl = sheet.querySelector(`.wl-w[data-wi="${current.index}"]`);
    const fromRect = fromEl?.getBoundingClientRect();
    const cx = fromRect ? fromRect.left + fromRect.width / 2 : 0;
    let best = candidates[0][1];
    let bestD = Infinity;
    for (const [, i] of candidates) {
      const r = sheet.querySelector(`.wl-w[data-wi="${i}"]`)?.getBoundingClientRect();
      if (!r) continue;
      const d = Math.abs(r.left + r.width / 2 - cx);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  const onKeyDown = (event) => {
    if (event.target !== scrollerRef.current) {
      if (event.key === "Escape") {
        close();
        scrollerRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    const current = stateRef.current;
    const count = SONG_BY_ID[current.songId].words.length;
    let next = null;
    if (event.key === "ArrowRight") next = current.open ? Math.min(count - 1, current.index + 1) : current.index;
    else if (event.key === "ArrowLeft") next = current.open ? Math.max(0, current.index - 1) : current.index;
    else if (event.key === "ArrowDown") next = current.open ? moveLine(1) : current.index;
    else if (event.key === "ArrowUp") next = current.open ? moveLine(-1) : current.index;
    else if (event.key === "Enter" || event.key === " ") next = current.index;
    else if (event.key === "Escape") {
      if (current.open) {
        event.preventDefault();
        close();
      }
      return;
    } else return;
    event.preventDefault();
    select(current.songId, next);
  };

  const currentEntry = entryFor(state.songId, state.index);

  return (
    <div className="wl-root" data-embedded={embedded ? "true" : "false"}>
      <div
        ref={scrollerRef}
        className="wl-scroller"
        tabIndex={0}
        data-scroll-contain
        aria-label={`Lyrics of ${song.title}. Arrow keys move between words, Enter looks one up.`}
        onKeyDown={onKeyDown}
        onPointerUp={onPointerUp}
      >
        <div ref={sheetRef} className="wl-sheet" onDoubleClick={onDoubleClick}>
          <nav className="wl-tabs" aria-label="Songs">
            {SONG_DATA.map((s) => (
              <button
                key={s.id}
                type="button"
                className="wl-tab"
                aria-current={s.id === state.songId ? "true" : undefined}
                onClick={() => switchSong(s.id)}
              >
                <span className="wl-tab-num">{String(s.track).padStart(2, "0")}</span>
                {s.title}
              </button>
            ))}
          </nav>
          <Lyrics key={song.id} song={song} embedded={embedded} />
          <span ref={markRef} className="wl-mark" data-on={state.open ? "true" : "false"} aria-hidden="true" />
          <div ref={layerRef} className="wl-layer" data-shown="false">
            <div
              ref={bodyRef}
              className="wl-card"
              role="region"
              aria-label={currentEntry ? `Definition of ${currentEntry.headword}` : "Definition"}
              aria-live="polite"
            >
              {[...state.trail.slice().reverse(), { songId: state.songId, index: state.index, key: state.key, current: true }].map(
                (item) => (
                  <Entry
                    key={item.key}
                    songId={item.songId}
                    index={item.index}
                    state={item.current && state.open ? "in" : "out"}
                    onJump={select}
                    layerRef={item.current ? currentRef : undefined}
                  />
                ),
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
