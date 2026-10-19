"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";

import "./burn.css";

const CAPACITY = 74 * 60;

const KNOWN = {
  "Come Together": 260,
  Something: 183,
  Taxman: 159,
  "Eleanor Rigby": 127,
  "Drive My Car": 146,
  "Norwegian Wood": 125,
  "Sgt. Pepper's Lonely Hearts Club Band": 122,
  "With a Little Help from My Friends": 164,
  "Two of Us": 216,
  "Across the Universe": 228,
  "Magical Mystery Tour": 171,
  "The Fool on the Hill": 180,
  "Help!": 138,
  "The Night Before": 154,
  "A Hard Day's Night": 154,
  "I Should Have Known Better": 163,
};

function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function SpeakerIcon({ on }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M4.6 4.6l6.8 6.8M11.4 4.6l-6.8 6.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3.6 8.4l2.8 2.8 6-6.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function withSeconds(tracks) {
  return tracks
    .map((t) => ({ ...t, seconds: t.durationMs ? Math.round(t.durationMs / 1000) : KNOWN[t.title] }))
    .filter((t) => t.seconds);
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const engineRef = useRef(null);
  const listRef = useRef(null);
  const ghostRef = useRef(null);
  const dragRef = useRef(null);
  const { tracks } = useTopSongs(16);
  const songs = useMemo(() => withSeconds(tracks), [tracks]);
  const [picked, setPicked] = useState(null);
  const [phase, setPhase] = useState("plan");
  const [current, setCurrent] = useState(-1);
  const [sound, setSound] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState("");
  const [dragging, setDragging] = useState(null);
  const [overDrop, setOverDrop] = useState(false);
  const [side, setSide] = useState("data");

  const plan = useMemo(() => {
    if (picked) return picked.map((id) => songs.find((s) => s.id === id)).filter(Boolean);
    return songs.slice(0, 5);
  }, [picked, songs]);
  const used = plan.reduce((a, t) => a + t.seconds, 0);
  const locked = phase !== "plan";

  useEffect(() => {
    engineRef.current?.setPlan(plan.map((t) => t.seconds));
  }, [plan, ready]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createBurn } = await import("./burnEngine");
      if (cancelled) return;
      engine = createBurn(root, {
        onPhase: (p) => {
          setPhase(p);
          if (p === "plan") setCurrent(-1);
          if (p === "burned") setSide("label");
          if (p === "plan") setSide("data");
        },
        onTrack: setCurrent,
        onReady: () => setReady(true),
        onFail: () => setFailed(true),
      });
      engineRef.current = engine;
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        start();
      },
      { rootMargin: "240px" },
    );
    io.observe(root);
    return () => {
      cancelled = true;
      io.disconnect();
      engine?.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!note) return undefined;
    const id = setTimeout(() => setNote(""), 2400);
    return () => clearTimeout(id);
  }, [note]);

  const add = useCallback(
    (song) => {
      if (locked) return;
      const ids = picked ?? plan.map((t) => t.id);
      if (ids.includes(song.id)) {
        setNote(`${song.title} is already on the disc`);
        return;
      }
      if (used + song.seconds > CAPACITY) {
        setNote(`Won't fit, ${clock(used + song.seconds - CAPACITY)} over`);
        return;
      }
      setPicked([...ids, song.id]);
    },
    [locked, picked, plan, used],
  );

  const remove = (id) => {
    if (locked) return;
    const ids = picked ?? plan.map((t) => t.id);
    setPicked(ids.filter((x) => x !== id));
  };

  const toggleSound = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !sound;
    setSound(next);
    const result = await engine.setSound(next);
    if (result !== next) setSound(false);
  };

  const overTarget = (x, y) => {
    const list = listRef.current?.getBoundingClientRect();
    const inList = list && x >= list.left && x <= list.right && y >= list.top && y <= list.bottom;
    return inList || Boolean(engineRef.current?.hitDisc(x, y));
  };

  const onSongDown = (e, song) => {
    if (locked || e.button > 0 || e.target.closest("button")) return;
    dragRef.current = { song, x: e.clientX, y: e.clientY, id: e.pointerId, active: false, el: e.currentTarget };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onSongMove = (e) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) {
      d.active = true;
      setDragging(d.song);
    }
    if (!d.active) return;
    const ghost = ghostRef.current;
    if (ghost) ghost.style.transform = `translate(${e.clientX - 20}px, ${e.clientY - 20}px)`;
    const over = overTarget(e.clientX, e.clientY);
    setOverDrop((prev) => (prev === over ? prev : over));
  };

  const onSongUp = (e) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    if (d.active) {
      if (overTarget(e.clientX, e.clientY)) add(d.song);
      setDragging(null);
      setOverDrop(false);
    }
  };

  useEffect(() => {
    const ghost = ghostRef.current;
    const d = dragRef.current;
    if (ghost && d) ghost.style.transform = `translate(${d.x - 20}px, ${d.y - 20}px)`;
  }, [dragging]);

  const onBurn = () => {
    if (!plan.length) return;
    engineRef.current?.burn();
  };

  const onFlip = () => {
    engineRef.current?.flip();
    setSide((s) => (s === "data" ? "label" : "data"));
  };

  const pickedIds = new Set(plan.map((t) => t.id));
  const Root = embedded ? "div" : "main";

  return (
    <Root
      ref={rootRef}
      className="burn"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-dragging={dragging ? "" : undefined}
      data-drop={overDrop ? "" : undefined}
    >
      <div className="burn-stage" data-burn="stage">
        <canvas className="burn-canvas" data-burn="canvas" aria-hidden="true" />
        <div className="burn-discbox" data-burn="discbox" />
        {embedded ? null : (
          <header className="burn-caption">
            <div className="burn-caption-text">
              <h1 className="burn-title">Burn</h1>
              <p className="burn-hint">Drag songs onto the disc, burn it, then write on it with a marker.</p>
            </div>
            <button type="button" className="burn-pill" aria-pressed={sound} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
              <span>{sound ? "Sound on" : "Sound off"}</span>
            </button>
          </header>
        )}
        <section className="burn-panel" data-burn-panel="" aria-label="Burn list">
          <div className="burn-head">
            <h2 className="burn-heading">On this disc</h2>
            <span className="burn-time">
              {clock(used)} of 74:00
            </span>
          </div>
          <div className="burn-meter" aria-hidden="true">
            {plan.map((t, i) => {
              const left = (plan.slice(0, i).reduce((a, x) => a + x.seconds, 0) / CAPACITY) * 100;
              return <span key={t.id} className="burn-seg" data-done={phase !== "plan" && (current > i || phase !== "burning") ? "" : undefined} style={{ left: `${left}%`, width: `${(t.seconds / CAPACITY) * 100}%` }} />;
            })}
          </div>
          <ol ref={listRef} className="burn-list" data-locked={locked ? "" : undefined}>
            {plan.length === 0 ? <li className="burn-empty">Drag songs here, or press plus</li> : null}
            {plan.map((t, i) => (
              <li key={t.id} className="burn-row" data-current={phase === "burning" && current === i ? "" : undefined} data-done={phase === "burning" ? (current > i ? "" : undefined) : phase !== "plan" ? "" : undefined}>
                <span className="burn-num">{phase !== "plan" && (current > i || phase !== "burning") ? <CheckIcon /> : i + 1}</span>
                <span className="burn-row-title">{t.title}</span>
                <span className="burn-row-time">{clock(t.seconds)}</span>
                <button type="button" className="burn-icon" aria-label={`Remove ${t.title}`} disabled={locked} onClick={() => remove(t.id)}>
                  <CrossIcon />
                </button>
              </li>
            ))}
          </ol>
          <div className="burn-actions">
            {phase === "plan" || phase === "burning" || phase === "cooling" ? (
              <button type="button" className="burn-go" data-burn="go" disabled={!plan.length || phase !== "plan"} onClick={onBurn}>
                <span className="burn-go-fill" />
                <span className="burn-go-label">{phase === "plan" ? "Burn" : <span data-burn="status">Writing lead-in</span>}</span>
              </button>
            ) : (
              <>
                <button type="button" className="burn-go" data-burn="eject" disabled={phase === "ejecting"} onClick={() => engineRef.current?.eject()}>
                  <span className="burn-go-label">Eject</span>
                </button>
                <button type="button" className="burn-pill" data-burn="flip" disabled={phase === "ejecting"} onClick={onFlip}>
                  <span>{side === "label" ? "Show the burn" : "Turn over"}</span>
                </button>
              </>
            )}
          </div>
          <p className="burn-note" aria-live="polite">
            {note || (phase === "burned" ? (side === "label" ? "Write the title on it." : "That ring is your music.") : "")}
          </p>
          <h2 className="burn-heading burn-songs-head">Your top songs</h2>
          <ul className="burn-songs" data-locked={locked ? "" : undefined}>
            {songs.map((s) => (
              <li
                key={s.id}
                className="burn-song"
                data-on={pickedIds.has(s.id) ? "" : undefined}
                onPointerDown={(e) => onSongDown(e, s)}
                onPointerMove={onSongMove}
                onPointerUp={onSongUp}
                onPointerCancel={onSongUp}
              >
                <span className="burn-cover" style={{ backgroundImage: `url(${s.image})` }} />
                <span className="burn-song-text">
                  <span className="burn-song-title">{s.title}</span>
                  <span className="burn-song-artist">{s.artist}</span>
                </span>
                <span className="burn-row-time">{clock(s.seconds)}</span>
                <button type="button" className="burn-icon" aria-label={`Add ${s.title}`} disabled={locked || pickedIds.has(s.id)} onClick={() => add(s)}>
                  {pickedIds.has(s.id) ? <CheckIcon /> : <PlusIcon />}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {dragging ? (
        <div ref={ghostRef} className="burn-ghost" aria-hidden="true">
          <span className="burn-ghost-cover" style={{ backgroundImage: `url(${dragging.image})` }} />
          <span>{dragging.title}</span>
        </div>
      ) : null}
      {failed ? <p className="burn-fallback">This disc needs WebGL 2.</p> : null}
    </Root>
  );
}
