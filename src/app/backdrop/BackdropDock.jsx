"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { readTone } from "./tone";
import "./dock.css";

const DEBOUNCE_MS = 320;
const MIN_QUERY = 2;
const RESULT_CACHE_MAX = 120;
const resultCache = new Map();

function cacheKey(term) {
  return term.replace(/\s+/g, " ").toLowerCase();
}

function rememberResults(term, tracks) {
  const key = cacheKey(term);
  resultCache.delete(key);
  resultCache.set(key, tracks);
  while (resultCache.size > RESULT_CACHE_MAX) {
    resultCache.delete(resultCache.keys().next().value);
  }
}

const FILL_ALPHA = 0.92;
const PANEL_MAX_PX = 336;
const VIEWPORT_GUTTER_PX = 168;
const SLIDE_MS = 380;
const FADE_LEAD_MS = 130;

function paintTone(image) {
  const row = image.closest(".bd-dock__row");
  if (!row) return;

  const tone = readTone(image);
  if (!tone) return;

  row.style.setProperty("--row-tint", tone.tint);
  row.style.setProperty("--row-alpha", String(FILL_ALPHA));
  row.style.setProperty("--row-ink", tone.ink);
  row.style.setProperty("--row-ink-soft", tone.inkSoft);
}

export default function BackdropDock({ onSelect, mode = "dark" }) {
  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const [panelHeight, setPanelHeight] = useState(0);
  const [pressed, setPressed] = useState(false);
  const [sliding, setSliding] = useState(false);
  const [notice, setNotice] = useState("");
  const cooldownRef = useRef(0);
  const containerRef = useRef(null);
  const listRef = useRef(null);
  const keyboardRef = useRef(false);
  const expanded = open && tracks.length > 0;

  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_QUERY) {
      setBusy(false);
      setOpen(false);
      setNotice("");
      return;
    }

    const cached = resultCache.get(cacheKey(term));
    if (cached) {
      setTracks(cached);
      setActive(0);
      setOpen(true);
      setBusy(false);
      setNotice("");
      return;
    }

    if (Date.now() < cooldownRef.current) {
      setNotice("Too many searches — one moment");
      return;
    }

    const controller = new AbortController();
    setBusy(true);
    const timer = setTimeout(() => {
      fetch(`/api/itunes/search?q=${encodeURIComponent(term)}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          if (response.status === 429) {
            const wait = Number(response.headers.get("Retry-After")) || 10;
            cooldownRef.current = Date.now() + wait * 1000;
            setNotice("Too many searches — one moment");
            setBusy(false);
            return;
          }
          const data = await response.json();
          if (data.error) {
            setNotice("Search is unavailable right now");
            setBusy(false);
            return;
          }
          const found = data.tracks || [];
          rememberResults(term, found);
          setTracks(found);
          setActive(0);
          setOpen(true);
          setBusy(false);
          setNotice(found.length ? "" : "No songs found");
        })
        .catch((error) => {
          if (error.name === "AbortError") return;
          setNotice("Search is unavailable right now");
          setBusy(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    function onPointerDown(event) {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    if (!pressed) return;
    const release = () => setPressed(false);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [pressed]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const limit = Math.max(
        120,
        Math.min(PANEL_MAX_PX, window.innerHeight - VIEWPORT_GUTTER_PX),
      );
      setPanelHeight(Math.min(list.scrollHeight, limit));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [tracks]);

  useEffect(() => {
    setSliding(true);
    const timer = setTimeout(() => setSliding(false), SLIDE_MS - FADE_LEAD_MS);
    return () => clearTimeout(timer);
  }, [expanded]);

  useEffect(() => {
    if (!keyboardRef.current) return;
    keyboardRef.current = false;
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(track) {
    onSelect(track);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      setOpen(false);
      event.currentTarget.blur();
      return;
    }
    if (!open || !tracks.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      keyboardRef.current = true;
      setActive((index) => (index + 1) % tracks.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      keyboardRef.current = true;
      setActive((index) => (index - 1 + tracks.length) % tracks.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(tracks[active]);
    }
  }

  return (
    <div className="bd-dock" ref={containerRef} data-mode={mode}>
      <div
        className="bd-dock__shell"
        data-open={expanded ? "true" : "false"}
        data-busy={busy ? "true" : "false"}
        data-press={pressed ? "true" : "false"}
        data-sliding={sliding ? "true" : "false"}
      >
        <div
          className="bd-dock__panel"
          data-lenis-prevent=""
          style={{ height: expanded ? panelHeight : 0 }}
        >
          <ul className="bd-dock__scroll" ref={listRef}>
            {tracks.map((track, index) => (
              <li key={track.id}>
                <button
                  type="button"
                  className="bd-dock__row"
                  data-active={index === active ? "true" : "false"}
                  onPointerEnter={() => setActive(index)}
                  onClick={() => choose(track)}
                >
                  <img
                    src={track.thumb}
                    alt=""
                    width={36}
                    height={36}
                    crossOrigin="anonymous"
                    onLoad={(event) => paintTone(event.currentTarget)}
                  />
                  <span className="bd-dock__name">{track.title}</span>
                  <span className="bd-dock__artist">{track.artist}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="bd-dock__bar" onPointerDown={() => setPressed(true)}>
          <Search size={16} strokeWidth={2} aria-hidden="true" />
          <input
            type="text"
            value={query}
            placeholder="Search a song"
            aria-label="Search a song"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => tracks.length && setOpen(true)}
          />
          {notice ? <span className="bd-dock__notice">{notice}</span> : null}
        </div>
      </div>
    </div>
  );
}
