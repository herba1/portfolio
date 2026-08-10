"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LYRIC_VOICES,
  annotateLines,
  singersAt,
  castMap,
  fingerprint,
  migrateEntry,
  publishVoices,
  resolveVoices,
  writeVoiceOverride,
} from "../covers/lib/lyricVoices";
import AlignmentScope from "./AlignmentScope";
import CastBar from "./CastBar";
import Scrubber from "./Scrubber";
import Timeline from "./Timeline";
import ViewMode from "./ViewMode";
import VoiceRail from "./VoiceRail";
import { useAnalyser } from "./useAnalyser";
import { usePeaks } from "./usePeaks";
import "./ask-me-why.css";

const TRACK = {
  artist: "The Beatles",
  title: "Ask Me Why",
  isrc: "GBAYE0601415",
  durationSec: 147,
};

const AUDIO_SOURCES = ["/audio/ask-me-why.opus", "/audio/ask-me-why.m4a"];
const DRIFT_KEY = "cv:driftMs:GBAYE0601415";
const ZOOM_STEPS = [1000, 2000, 4000, 8000];

const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function AskMeWhy() {
  const [lyrics, setLyrics] = useState(null);
  const [status, setStatus] = useState("loading");
  const [cast, setCast] = useState([]);
  const [notes, setNotes] = useState({});
  const [secondary, setSecondary] = useState([]);
  const [selectedSeg, setSelectedSeg] = useState(null);
  const [viewing, setViewing] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [committed, setCommitted] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [pendingRemove, setPendingRemove] = useState(null);
  const [mode, setMode] = useState("browse");

  const [activeWord, setActiveWord] = useState(-1);

  const dragRef = useRef(null);

  const [playing, setPlaying] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [durationMs, setDurationMs] = useState(TRACK.durationSec * 1000);
  const [driftMs, setDriftMs] = useState(0);
  const [zoomMs, setZoomMs] = useState(4000);
  const [following, setFollowing] = useState(true);
  const [clockMs, setClockMs] = useState(0);

  const audioRef = useRef(null);
  const rafRef = useRef(0);
  const scopeRef = useRef(null);
  const scrubRef = useRef(null);
  const timelineRef = useRef(null);
  const viewRef = useRef(null);
  const viewingRef = useRef(false);
  const railRef = useRef(null);
  const activeNodeRef = useRef(null);
  const driftRef = useRef(0);
  const activeRef = useRef(-1);
  const followRef = useRef(true);
  const timedRef = useRef(null);
  const tickRef = useRef(-1);
  const wordRef = useRef(-1);
  const castRef = useRef([]);
  const docRef = useRef({ cast: [], notes: {} });
  const loadedRef = useRef(false);

  const peaks = usePeaks(AUDIO_SOURCES);
  const readSpectrum = useAnalyser(audioRef, playing);

  useEffect(() => {
    const q = new URLSearchParams({
      artist: TRACK.artist,
      title: TRACK.title,
      isrc: TRACK.isrc,
      duration: String(TRACK.durationSec),
    });
    fetch(`/api/spotify/lyrics?${q}`)
      .then((r) => r.json())
      .then((d) => {
        setLyrics(d);
        setStatus(d.plain ? "ready" : "none");
      })
      .catch(() => setStatus("none"));

    try {
      const stored = Number(localStorage.getItem(DRIFT_KEY));
      if (Number.isFinite(stored)) {
        setDriftMs(stored);
        driftRef.current = stored;
      }
    } catch {
      return;
    }
  }, []);

  const rawLines = useMemo(() => {
    if (!lyrics) return [];
    if (lyrics.lines?.length) return lyrics.lines;
    return (lyrics.plain || "").split("\n").map((t) => ({ text: t.trim(), words: null }));
  }, [lyrics]);

  const ensureSelection = useCallback((list) => {
    setActiveId((a) => (list.some((m) => m.id === a) ? a : list[0]?.id || null));
  }, []);

  const load = useCallback(
    (source) => {
      const raw = source === "source" ? LYRIC_VOICES[TRACK.isrc] : resolveVoices(TRACK.isrc);
      if (!raw) return;
      const existing = migrateEntry(raw, timedRef.current);
      setCast(existing.cast || []);
      setSecondary(existing.secondary || []);
      ensureSelection(existing.cast || []);
      if (!existing.fingerprint || existing.fingerprint === fingerprint(rawLines)) {
        setNotes(existing.lines || {});
      }
      setPast([]);
      setFuture([]);
      setDirty(false);
    },
    [rawLines, ensureSelection],
  );

  useEffect(() => {
    if (!rawLines.length || loadedRef.current) return;
    loadedRef.current = true;
    load("stored");
  }, [rawLines, load]);

  castRef.current = cast;
  docRef.current = { cast, notes, secondary };
  viewingRef.current = viewing;

  const edit = useCallback((fn) => {
    const prev = docRef.current;
    const next = fn(prev);
    if (!next || next === prev) return;
    setPast((p) => [...p, prev].slice(-80));
    setFuture([]);
    setCast(next.cast);
    setNotes(next.notes);
    if (next.secondary) setSecondary(next.secondary);
    setDirty(true);
    setCommitted(false);
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [...f, docRef.current]);
      setCast(prev.cast);
      setNotes(prev.notes);
      setSecondary(prev.secondary || []);
      setDirty(true);
      return p.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[f.length - 1];
      setPast((p) => [...p, docRef.current]);
      setCast(next.cast);
      setNotes(next.notes);
      setSecondary(next.secondary || []);
      setDirty(true);
      return f.slice(0, -1);
    });
  }, []);

  const entry = useMemo(
    () => ({
      title: `${TRACK.artist} — ${TRACK.title}`,
      fingerprint: fingerprint(rawLines),
      cast,
      lines: notes,
      secondary,
    }),
    [rawLines, cast, notes, secondary],
  );

  const lines = useMemo(() => annotateLines(rawLines, entry), [rawLines, entry]);
  const colors = castMap(entry);
  const timed = lyrics?.lines?.length ? lyrics.lines : null;
  timedRef.current = timed;

  const lineOnsets = useMemo(
    () => (timed || []).map((l) => l.start).filter((n) => n != null),
    [timed],
  );

  const wordOnsets = useMemo(() => {
    const out = [];
    for (const line of timed || []) {
      for (const w of line.words || []) {
        if (w.start != null && w.text.trim()) out.push(w.start);
      }
    }
    return out;
  }, [timed]);

  const indexAt = useCallback((cueMs) => {
    const list = timedRef.current;
    if (!list) return -1;
    let lo = 0;
    let hi = list.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].start <= cueMs) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  }, []);

  const paint = useCallback(() => {
    rafRef.current = requestAnimationFrame(paint);
    const el = audioRef.current;
    if (!el) return;

    const ms = el.currentTime * 1000;
    const cue = ms + driftRef.current;

    scopeRef.current?.draw(ms);
    scrubRef.current?.draw(ms);
    timelineRef.current?.paint(ms + driftRef.current);

    const tick = Math.floor(ms / 250);
    if (tick !== tickRef.current) {
      tickRef.current = tick;
      setClockMs(ms);
    }

    const idx = indexAt(cue);
    if (idx !== activeRef.current) {
      activeRef.current = idx;
      setActiveIndex(idx);
    }

    const list = timedRef.current;
    let wi = -1;
    if (idx >= 0 && list?.[idx]?.words) {
      const words = list[idx].words;
      for (let k = 0; k < words.length; k++) {
        const w = words[k];
        if (!w.text.trim()) continue;
        if (cue >= w.start && cue < (w.end ?? w.start + 220)) {
          wi = k;
          break;
        }
        if (cue >= w.start) wi = k;
      }
    }
    if (wi !== wordRef.current) {
      wordRef.current = wi;
      setActiveWord(wi);
    }

    const node = activeNodeRef.current;
    if (node) {
      for (const g of node.querySelectorAll("[data-s]")) {
        const s = +g.dataset.s;
        const e = +g.dataset.e;
        const p = Math.min(1, Math.max(0, (cue - s) / Math.max(1, e - s)));
        const q = Math.round(p * 40) / 40;
        if (g.__p !== q) {
          g.__p = q;
          g.style.setProperty("--p", q);
        }
      }
    }

    const bins = readSpectrum();
    railRef.current?.draw(bins);
    viewRef.current?.paint(cue, activeRef.current, bins);
  }, [indexAt, readSpectrum]);

  useEffect(() => {
    if (!playing) return;
    rafRef.current = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, paint]);

  useEffect(() => {
    if (!following || activeIndex < 0) return;
    activeNodeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex, following]);

  useEffect(() => {
    const stop = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, []);

  useEffect(() => {
    const release = () => {
      if (!followRef.current) return;
      followRef.current = false;
      setFollowing(false);
    };
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchmove", release, { passive: true });
    return () => {
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchmove", release);
    };
  }, []);

  const selectMember = useCallback(
    (id) => {
      setActiveId((current) => {
        if (current === id) {
          setMode("browse");
          return null;
        }
        setMode((m) => (m === "browse" ? "line" : m));
        return id;
      });
    },
    [],
  );

  const chooseMode = useCallback(
    (next) => {
      setMode(next);
      if (next === "browse") setActiveId(null);
      else setActiveId((a) => a || castRef.current[0]?.id || null);
    },
    [],
  );

  const resync = useCallback(() => {
    followRef.current = true;
    setFollowing(true);
    activeNodeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  }, []);

  const seekMs = useCallback((ms) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, ms / 1000);
    const at = el.currentTime * 1000;
    setClockMs(at);
    scopeRef.current?.draw(at);
    scrubRef.current?.draw(at);
    const idx = indexAtRef.current(at + driftRef.current);
    if (idx !== activeRef.current) {
      activeRef.current = idx;
      setActiveIndex(idx);
    }
  }, []);

  const indexAtRef = useRef(indexAt);
  indexAtRef.current = indexAt;

  const setDrift = useCallback((next) => {
    driftRef.current = next;
    setDriftMs(next);
    try {
      localStorage.setItem(DRIFT_KEY, String(next));
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    scopeRef.current?.draw();
    scrubRef.current?.draw();
  }, [driftMs, zoomMs, peaks, durationMs, lineOnsets, wordOnsets]);

  const setSinger = useCallback(
    (index, wordIndex, turnOn) => {
      if (!activeId) return null;
      let applied = turnOn;
      edit((doc) => {
        const prev = doc.notes[index] || { singers: [], words: {} };
        const current = singersAt(prev, wordIndex);
        const has = current.includes(activeId);
        const on = turnOn == null ? !has : turnOn;
        applied = on;
        if (on === has) return null;

        const nextList = on
          ? [...current, activeId]
          : current.filter((id) => id !== activeId);

        const note = {
          singers: [...(prev.singers || [])],
          words: { ...(prev.words || {}) },
        };
        if (wordIndex == null) note.singers = nextList;
        else note.words[wordIndex] = nextList;

        const notes = { ...doc.notes };
        if (note.singers.length || Object.keys(note.words).length) {
          notes[index] = note;
        } else delete notes[index];
        return { ...doc, notes };
      });
      return applied;
    },
    [activeId, edit],
  );

  const clearWordOverride = useCallback(
    (index, wordIndex) => {
      edit((doc) => {
        const prev = doc.notes[index];
        if (!prev?.words || prev.words[wordIndex] === undefined) return null;
        const words = { ...prev.words };
        delete words[wordIndex];
        const note = { ...prev, words };
        const notes = { ...doc.notes };
        if (note.singers.length || Object.keys(words).length) {
          notes[index] = note;
        } else delete notes[index];
        return { ...doc, notes };
      });
    },
    [edit],
  );

  const createSeg = useCallback(
    (seg) => {
      edit((doc) => ({ ...doc, secondary: [...(doc.secondary || []), seg] }));
      setSelectedSeg(seg.id);
    },
    [edit],
  );

  const changeSeg = useCallback(
    (id, patch) => {
      edit((doc) => ({
        ...doc,
        secondary: (doc.secondary || []).map((x) => (x.id === id ? { ...x, ...patch } : x)),
      }));
    },
    [edit],
  );

  const removeSeg = useCallback(
    (id) => {
      edit((doc) => ({ ...doc, secondary: (doc.secondary || []).filter((x) => x.id !== id) }));
      setSelectedSeg(null);
    },
    [edit],
  );

  const removeMember = useCallback(
    (id) => {
      if (pendingRemove !== id) {
        setPendingRemove(id);
        return;
      }
      setPendingRemove(null);
      edit((doc) => {
        const notes = {};
        for (const [k, v] of Object.entries(doc.notes)) {
          if (v.agent !== id) {
            notes[k] = v;
            continue;
          }
          const { agent, ...rest } = v;
          if (Object.keys(rest).length) notes[k] = rest;
        }
        return { cast: doc.cast.filter((m) => m.id !== id), notes };
      });
      ensureSelection(docRef.current.cast.filter((m) => m.id !== id));
    },
    [edit, pendingRemove, ensureSelection],
  );

  const addMember = useCallback(
    (member) => {
      edit((doc) => ({ ...doc, cast: [...doc.cast, member] }));
      setActiveId(member.id);
    },
    [edit],
  );

  const save = useCallback(() => {
    writeVoiceOverride(TRACK.isrc, entry);
    publishVoices(TRACK.isrc, entry);
    setCommitted(true);
    setDirty(false);
    setSavedAt(
      new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    );
  }, [entry]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
        return;
      }
      if (e.target instanceof HTMLInputElement) return;
      if (viewingRef.current && e.key !== " ") return;
      if (e.key === " ") {
        e.preventDefault();
        toggle();
      } else if (e.key === "[") setDrift(driftRef.current - (e.shiftKey ? 10 : 100));
      else if (e.key === "]") setDrift(driftRef.current + (e.shiftKey ? 10 : 100));
      else if (e.key === "f") resync();
      else if (e.key === "v") setViewing(true);
      else if (e.key === "n") chooseMode("browse");
      else if (e.key === "l") chooseMode("line");
      else if (e.key === "w") chooseMode("word");
      else if (e.key >= "1" && e.key <= "9") {
        const member = castRef.current[Number(e.key) - 1];
        if (member) selectMember(member.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, setDrift, resync, undo, redo, save, chooseMode, selectMember]);

  useEffect(() => {
    if (!dirty) return;
    const guard = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  const orderedIds = useCallback(
    (ids) => {
      const rank = new Map(cast.map((m, i) => [m.id, i]));
      return [...new Set(ids)].filter((id) => rank.has(id)).sort((a, b) => rank.get(a) - rank.get(b));
    },
    [cast],
  );
  const activeLine = activeIndex >= 0 ? lines[activeIndex] : null;
  const cueNow = clockMs + driftMs;
  const lineSingers = orderedIds(
    (activeWord >= 0 ? activeLine?.words?.[activeWord]?.singers : null) ||
      activeLine?.singers ||
      [],
  );
  const activeSingers = orderedIds([
    ...lineSingers,
    ...secondary.filter((x) => cueNow >= x.start && cueNow <= x.end).map((x) => x.singer),
  ]);
  const stats = {
    attributed: Object.values(notes).filter((n) => n.singers?.length).length,
    detailed: Object.values(notes).filter((n) => Object.keys(n.words || {}).length).length,
    extras: secondary.length,
  };

  return (
    <main
      className="amw"
      style={activeId && colors[activeId] ? { "--pending": colors[activeId].color } : undefined}
    >
      <header className="amw-head">
        <p className="amw-artist">{TRACK.artist}</p>
        <h1 className="amw-title">{TRACK.title}</h1>
        <p className="amw-meta">
          {lyrics?.source ? `${lyrics.source} · ${lyrics.level}-synced` : "loading"} ·{" "}
          {rawLines.length} lines · {wordOnsets.length} word onsets ·{" "}
          {peaks ? "waveform ready" : "decoding audio"}
        </p>
      </header>

      <section className="amw-deck">
        <div className="amw-transport">
          <button className="amw-play" onClick={toggle} data-playing={playing}>
            {playing ? "Pause" : "Play"}
          </button>
          <span className="amw-time">
            {clock(clockMs)} / {clock(durationMs)}
          </span>
        </div>

        <Scrubber
          ref={scrubRef}
          peaks={peaks}
          durationMs={durationMs}
          lineOnsets={lineOnsets}
          driftMs={driftMs}
          height={56}
          onSeek={seekMs}
        />

        <div className="amw-align-head">
          <h2 className="amw-h2">Alignment</h2>
          <div className="amw-zooms">
            {ZOOM_STEPS.map((z) => (
              <button
                key={z}
                className="amw-zoom"
                data-on={zoomMs === z}
                onClick={() => setZoomMs(z)}
              >
                {z / 1000}s
              </button>
            ))}
          </div>
        </div>

        <AlignmentScope
          ref={scopeRef}
          peaks={peaks}
          windowMs={zoomMs}
          wordOnsets={wordOnsets}
          lineOnsets={lineOnsets}
          driftMs={driftMs}
          height={112}
        />

        <div className="amw-slider-row">
          <input
            className="amw-slider"
            type="range"
            min={-20000}
            max={20000}
            step={5}
            value={driftMs}
            onChange={(e) => setDrift(Number(e.target.value))}
          />
          <span className="amw-drift-val">
            <input
              className="amw-drift-input"
              type="number"
              step={5}
              value={driftMs}
              onChange={(e) => setDrift(Math.round(Number(e.target.value) || 0))}
            />
            <span className="amw-unit">ms</span>
          </span>
          <button className="amw-nudge" onClick={() => setDrift(0)}>
            Reset
          </button>
        </div>
      </section>

      <Timeline
        ref={timelineRef}
        cast={cast}
        segments={secondary}
        durationMs={durationMs}
        lineOnsets={lineOnsets}
        selectedId={selectedSeg}
        onSelect={setSelectedSeg}
        onCreate={createSeg}
        onChange={changeSeg}
        onRemove={removeSeg}
        onSeek={(ms) => seekMs(ms - driftRef.current)}
      />

      <CastBar
        cast={cast}
        activeId={activeId}
        onSelect={selectMember}
        onAdd={addMember}
        onRemove={removeMember}
        mode={mode}
        onMode={chooseMode}
        onSave={save}
        onRevert={() => load("stored")}
        onRestoreSource={() => load("source")}
        onUndo={undo}
        onRedo={redo}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        dirty={dirty}
        committed={committed}
        savedAt={savedAt}
        pendingRemove={pendingRemove}
        playing={playing}
        clockMs={clockMs}
        durationMs={durationMs}
        onToggle={toggle}
        onView={() => setViewing(true)}
        stats={stats}
      />

      {status === "none" ? <p className="amw-empty">No lyrics found</p> : null}

      <div className="amw-stage">
        <VoiceRail
          ref={railRef}
          cast={cast}
          activeSingers={activeSingers}
        />

        <ol className="amw-lines">
          {lines.map((line, i) => {
            const isActive = activeIndex === i;
            const singers = line.singers || [];
            const everyone = orderedIds([
              ...singers,
              ...Object.values(notes[i]?.words || {}).flat(),
            ]);
            const first = singers[0] ? colors[singers[0]] : null;
            return (
              <li
                key={i}
                ref={(el) => {
                  if (isActive) activeNodeRef.current = el;
                }}
                className="amw-line"
                data-state={isActive ? "lead" : "idle"}
                data-voiced={singers.length > 0}
                style={first ? { "--agent": first.color } : undefined}
              >
                <button
                  className="amw-stamp"
                  onClick={() => seekMs((line.start ?? 0) - driftRef.current)}
                  title="Jump to this line"
                >
                  {line.start != null ? clock(line.start) : "—"}
                </button>

                <span className="amw-who">
                  {everyone.map((id) => (
                    <span
                      key={id}
                      className="amw-badge"
                      data-partial={singers.includes(id) ? undefined : "true"}
                      style={{ "--agent": colors[id]?.color }}
                      title={colors[id]?.name}
                    />
                  ))}
                </span>

                <span
                  className="amw-text"
                  data-mode={mode}
                  onClick={
                    mode === "line"
                      ? () => setSinger(i, null)
                      : mode === "browse"
                        ? () => seekMs((line.start ?? 0) - driftRef.current)
                        : undefined
                  }
                  role="presentation"
                >
                  {line.words?.length ? (
                    <Split
                      words={line.words}
                      split={isActive}
                      colors={colors}
                      order={orderedIds}
                      mode={mode}
                      onWordDown={(wi) => {
                        if (mode === "browse") {
                          const w = line.words?.[wi];
                          if (w) seekMs(w.start - driftRef.current);
                          return;
                        }
                        const applied = setSinger(i, wi);
                        dragRef.current = { line: i, on: applied };
                      }}
                      onWordEnter={(wi) => {
                        const drag = dragRef.current;
                        if (!drag || drag.line !== i) return;
                        setSinger(i, wi, drag.on);
                      }}
                      onWordClear={(wi) => clearWordOverride(i, wi)}
                    />
                  ) : (
                    line.text || "\u266a"
                  )}

                </span>

              </li>
            );
          })}
        </ol>
      </div>

      <button className="amw-resync" data-on={!following} onClick={resync}>
        Follow the music
      </button>

      {viewing ? (
        <ViewMode
          ref={viewRef}
          lines={lines}
          cast={cast}
          colors={colors}
          secondary={secondary}
          playing={playing}
          liveSingers={lineSingers}
          clockMs={clockMs}
          durationMs={durationMs}
          onToggle={toggle}
          onSeek={(ms) => seekMs(ms - driftRef.current)}
          onExit={() => setViewing(false)}
        />
      ) : null}

      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDurationMs(e.currentTarget.duration * 1000)}
      >
        <source src={AUDIO_SOURCES[0]} type="audio/ogg; codecs=opus" />
        <source src={AUDIO_SOURCES[1]} type="audio/mp4" />
      </audio>
    </main>
  );
}

function Split({ words, split, colors, order, mode, onWordDown, onWordEnter, onWordClear }) {
  return words.map((w, wi) => {
    if (!w.text.trim()) return <span key={wi}>{w.text}</span>;
    const singers = order(w.singers || []);
    const first = singers[0] ? colors[singers[0]] : null;
    const handlers =
      mode === "word" || mode === "browse"
        ? {
            onPointerDown: (e) => {
              e.stopPropagation();
              e.preventDefault();
              if (e.altKey) onWordClear(wi);
              else onWordDown(wi);
            },
            onPointerEnter: () => onWordEnter(wi),
          }
        : {};

    const common = {
      className: "amw-word",
      "data-pick": mode === "word" ? "true" : undefined,
      "data-seek": mode === "browse" ? "true" : undefined,
      "data-over": w.overridden ? "true" : undefined,
      style: { ...(first ? { "--agent": first.color } : {}), "--n": singers.length },
      ...handlers,
    };

    const stack = singers.length ? (
      <span className="amw-stack" aria-hidden="true">
        {singers.map((id) => (
          <span key={id} style={{ "--agent": colors[id]?.color }} />
        ))}
      </span>
    ) : null;

    if (!split) {
      return (
        <span key={wi} {...common}>
          {w.text}
          {stack}
        </span>
      );
    }

    const dur = Math.max(1, (w.end ?? w.start + 220) - w.start);
    const glyphs = [...w.text];
    return (
      <span key={wi} {...common}>
        {glyphs.map((ch, ci) => (
          <span
            key={ci}
            className="amw-g"
            data-s={Math.round(w.start + (dur * ci) / glyphs.length)}
            data-e={Math.round(w.start + (dur * (ci + 1)) / glyphs.length)}
            style={{ "--p": 0 }}
          >
            {ch}
          </span>
        ))}
        {stack}
      </span>
    );
  });
}

function spanOf(line, id) {
  const extra = (line.extras || []).find((x) => x.id === id);
  if (!extra || !Number.isInteger(extra.from)) return null;
  return { from: extra.from, to: extra.to ?? extra.from };
}

