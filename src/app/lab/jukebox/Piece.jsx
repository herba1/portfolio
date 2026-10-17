"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

import { LETTERS, NUMBERS, SONGS, START_INDEX, songFromCode } from "./jukeboxSongs";
import "./jukebox.css";

const STAGE_LABEL =
  "A close view into the dome of a 1950s jukebox: a carousel of twenty 45s in chrome cradles, a gripper, a platter and a tone arm. Punch a letter then a number, or click a record or a title card, and the carousel turns to that slot, the gripper lays the record on the platter and the needle drops.";

const PHASE_TEXT = {
  idle: "Ready",
  fetching: "Selecting",
  cueing: "Cueing",
  playing: "Playing",
};

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const headRef = useRef(null);
  const panelRef = useRef(null);
  const stripRef = useRef(null);
  const engineRef = useRef(null);
  const armedRef = useRef(null);
  const wantRef = useRef(START_INDEX);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [want, setWant] = useState(START_INDEX);
  const [phase, setPhase] = useState("idle");
  const [armed, setArmedState] = useState(null);
  const [hover, setHover] = useState(null);
  const [muted, setMuted] = useState(false);
  const [pressed, setPressed] = useState(null);

  const setArmed = useCallback((value) => {
    armedRef.current = value;
    setArmedState(value);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const insets = () => {
      if (embedded) {
        const panel = panelRef.current?.getBoundingClientRect();
        const rect = root.getBoundingClientRect();
        return { top: 0, bottom: panel ? rect.bottom - panel.top - 24 : 120 };
      }
      const rect = root.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      const head = headRef.current?.getBoundingClientRect();
      const bottom = panel ? rect.bottom - panel.top - 28 : 200;
      const top = rect.width >= 900 ? 64 : head ? head.bottom - rect.top + 4 : 120;
      return { top, bottom };
    };
    const start = async () => {
      try {
        const { createJukebox } = await import("./jukeboxEngine");
        if (cancelled) return;
        engine = await createJukebox({
          box: root,
          host: stageRef.current,
          insets,
          embedded,
          onReady: () => {
            if (!cancelled) setReady(true);
          },
          onFail: () => {
            if (!cancelled) setFailed(true);
          },
          onState: (next) => {
            if (cancelled) return;
            wantRef.current = next.want;
            setWant(next.want);
            setPhase(next.phase);
          },
          onHover: (index) => {
            if (!cancelled) setHover(index);
          },
        });
        if (cancelled) {
          engine.destroy();
          return;
        }
        engineRef.current = engine;
      } catch (error) {
        console.error(error);
        if (!cancelled) setFailed(true);
      }
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
  }, [embedded]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || strip.scrollWidth <= strip.clientWidth + 1) return;
    const card = strip.querySelector(`[data-index="${want}"]`);
    if (!card) return;
    const left = card.offsetLeft - (strip.clientWidth - card.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [want]);

  const choose = useCallback(
    (index) => {
      setArmed(null);
      engineRef.current?.select(index);
    },
    [setArmed],
  );

  const pressKey = useCallback(
    (key) => {
      engineRef.current?.unlock();
      if (LETTERS.includes(key)) {
        setArmed(armedRef.current === key ? null : key);
        return;
      }
      if (!NUMBERS.includes(key)) return;
      const letter = armedRef.current || SONGS[wantRef.current].letter;
      const song = songFromCode(letter, key);
      if (song) choose(song.index);
    },
    [choose, setArmed],
  );

  useEffect(() => {
    const root = rootRef.current;
    const target = embedded ? root : window;
    if (!target) return undefined;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
      if (e.key === "Escape") {
        if (armedRef.current) setArmed(null);
        return;
      }
      const key = e.key.length === 1 ? e.key.toUpperCase() : "";
      if (!LETTERS.includes(key) && !NUMBERS.includes(key)) return;
      if (e.repeat) return;
      e.preventDefault();
      setPressed(key);
      pressKey(key);
    };
    const onUp = () => setPressed(null);
    target.addEventListener("keydown", onKey);
    target.addEventListener("keyup", onUp);
    return () => {
      target.removeEventListener("keydown", onKey);
      target.removeEventListener("keyup", onUp);
    };
  }, [embedded, pressKey, setArmed]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    engineRef.current?.unlock();
    engineRef.current?.setMuted(next);
  };

  const current = SONGS[want];
  const Root = embedded ? "div" : "main";
  const display = armed ? `${armed}-` : current.code;

  return (
    <Root
      ref={rootRef}
      className="jukebox-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-failed={failed ? "" : undefined}
      data-phase={phase}
    >
      <div ref={stageRef} className="jukebox-stage" tabIndex={0} role="application" aria-label={STAGE_LABEL} />

      {embedded ? null : (
        <header ref={headRef} className="jukebox-head">
          <h1 className="jukebox-title">Jukebox</h1>
          <p className="jukebox-lede">
            Punch a code or tap a title. The rig fetches the <em>45</em> and drops the needle.
          </p>
        </header>
      )}

      <div ref={panelRef} className="jukebox-panel">
        <div className="jukebox-console">
          <div className="jukebox-readout" aria-live="polite">
            <span className="jukebox-window" data-armed={armed ? "" : undefined}>
              <span className="jukebox-window-code">{display}</span>
              {armed ? <span className="jukebox-window-caret" aria-hidden="true" /> : null}
            </span>
            <span className="jukebox-now">
              <span className="jukebox-now-state">
                <span className="jukebox-now-lamp" aria-hidden="true" />
                {armed ? "Pick a number" : PHASE_TEXT[phase]}
              </span>
              <span className="jukebox-now-title">{current.title}</span>
              <span className="jukebox-now-artist">{current.artist}</span>
            </span>
          </div>
          <div className="jukebox-keys" role="group" aria-label="Selector keys">
            <div className="jukebox-keyset">
              {LETTERS.map((letter) => (
                <button
                  key={letter}
                  type="button"
                  className="jukebox-key jukebox-key--letter"
                  aria-pressed={armed === letter}
                  data-down={pressed === letter ? "" : undefined}
                  onClick={() => pressKey(letter)}
                >
                  {letter}
                </button>
              ))}
            </div>
            <div className="jukebox-keyset">
              {NUMBERS.map((number) => (
                <button
                  key={number}
                  type="button"
                  className="jukebox-key"
                  data-down={pressed === number ? "" : undefined}
                  aria-label={`Number ${number}`}
                  onClick={() => pressKey(number)}
                >
                  {number}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="jukebox-mute"
              aria-pressed={muted}
              aria-label={muted ? "Unmute" : "Mute"}
              onClick={toggleMute}
            >
              {muted ? <VolumeX size={16} strokeWidth={1.75} /> : <Volume2 size={16} strokeWidth={1.75} />}
            </button>
          </div>
        </div>

        <div ref={stripRef} className="jukebox-strip" data-scroll-contain="">
          <div className="jukebox-cards">
            {SONGS.map((song) => (
              <button
                key={song.code}
                type="button"
                data-index={song.index}
                className="jukebox-card"
                data-active={song.index === want ? "" : undefined}
                data-playing={song.index === want && phase === "playing" ? "" : undefined}
                data-hover={hover === song.index ? "" : undefined}
                data-armed={armed && song.letter === armed ? "" : undefined}
                aria-label={`${song.code}, ${song.title} by ${song.artist}`}
                onClick={() => choose(song.index)}
              >
                <span className="jukebox-card-code">{song.code}</span>
                <span className="jukebox-card-title">{song.title}</span>
                <span className="jukebox-card-artist">{song.artist}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {failed ? <p className="jukebox-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
