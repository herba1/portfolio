"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Airplay, ChevronDown, Ellipsis, ListMusic, MessageSquareQuote, Pause, Play, SkipBack, SkipForward, Volume1, Volume2 } from "lucide-react";

import { FEATURED } from "@/app/lab/_music/catalog";
import { useTopSongs } from "@/app/lab/_music/useTopSongs";
import { createSheet } from "./psEngine";
import { css, glow, readPalette } from "./psPalette";
import { withDuration } from "./psTracks";
import "./player-sheet.css";

export default function Piece({ embedded = false }) {
  const { tracks: raw } = useTopSongs(12);
  const tracks = useMemo(() => raw.map(withDuration), [raw]);
  const rootRef = useRef(null);
  const phoneRef = useRef(null);
  const libraryRef = useRef(null);
  const dimRef = useRef(null);
  const sheetRef = useRef(null);
  const lightRef = useRef(null);
  const artRef = useRef(null);
  const shadowRef = useRef(null);
  const miniRef = useRef(null);
  const fullRef = useRef(null);
  const coverRef = useRef(null);
  const fillRef = useRef(null);
  const knobRef = useRef(null);
  const miniFillRef = useRef(null);
  const trackRef = useRef(null);
  const timeARef = useRef(null);
  const timeBRef = useRef(null);
  const engineRef = useRef(null);
  const openBtnRef = useRef(null);
  const closeBtnRef = useRef(null);
  const playingRef = useRef(true);

  const [currentId, setCurrentId] = useState(null);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [volume, setVolume] = useState(0.7);

  const track = tracks.find((t) => t.id === currentId) || tracks[0];
  const cover = track?.imageLarge || track?.image;

  useEffect(() => {
    const engine = createSheet(
      {
        root: rootRef.current,
        phoneEl: phoneRef.current,
        library: libraryRef.current,
        dim: dimRef.current,
        sheet: sheetRef.current,
        light: lightRef.current,
        art: artRef.current,
        shadow: shadowRef.current,
        mini: miniRef.current,
        full: fullRef.current,
        cover: coverRef.current,
        fill: fillRef.current,
        knob: knobRef.current,
        miniFill: miniFillRef.current,
        track: trackRef.current,
        timeA: timeARef.current,
        timeB: timeBRef.current,
      },
      { onOpenChange: setOpen },
    );
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (track) engineRef.current?.load(track);
  }, [track]);

  useEffect(() => {
    if (!cover) return undefined;
    let alive = true;
    readPalette(cover).then(({ colors }) => {
      const root = rootRef.current;
      if (!alive || !root) return;
      colors.forEach((c, i) => root.style.setProperty(`--ps-c${i + 1}`, css(glow(c))));
    });
    return () => {
      alive = false;
    };
  }, [cover]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (open && root.querySelector(".ps-mini")?.contains(document.activeElement)) closeBtnRef.current?.focus({ preventScroll: true });
    if (!open && fullRef.current?.contains(document.activeElement)) openBtnRef.current?.focus({ preventScroll: true });
  }, [open]);

  const togglePlay = () => {
    const next = !playingRef.current;
    playingRef.current = next;
    setPlaying(next);
    engineRef.current?.setPlaying(next);
  };

  const step = (dir) => {
    const i = tracks.findIndex((t) => t.id === track.id);
    if (dir < 0 && (engineRef.current?.elapsed() || 0) > 3) {
      engineRef.current?.seek(0, true);
      return;
    }
    setCurrentId(tracks[(i + dir + tracks.length) % tracks.length].id);
  };

  const pick = (id) => {
    setCurrentId(id);
    if (!playingRef.current) togglePlay();
  };

  const onTrackDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const id = e.pointerId;
    el.setPointerCapture(id);
    setScrubbing(true);
    const at = (ev) => (ev.clientX - rect.left) / rect.width;
    engineRef.current?.seek(at(e), false);
    const move = (ev) => ev.pointerId === id && engineRef.current?.seek(at(ev), false);
    const up = (ev) => {
      if (ev.pointerId !== id) return;
      engineRef.current?.seek(at(ev), true);
      setScrubbing(false);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const onTrackKey = (e) => {
    const s = e.shiftKey ? 15 : 5;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") engineRef.current?.nudge(s);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") engineRef.current?.nudge(-s);
    else return;
    e.preventDefault();
  };

  const onVolumeDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const id = e.pointerId;
    el.setPointerCapture(id);
    const at = (ev) => Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
    setVolume(at(e));
    const move = (ev) => ev.pointerId === id && setVolume(at(ev));
    const up = (ev) => {
      if (ev.pointerId !== id) return;
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const onVolumeKey = (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") setVolume((v) => Math.min(1, v + 0.05));
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") setVolume((v) => Math.max(0, v - 0.05));
    else return;
    e.preventDefault();
  };

  const onRootKey = (e) => {
    if (e.key === "Escape" && open) {
      e.preventDefault();
      engineRef.current?.setOpen(false);
    }
  };

  if (!track) return null;

  return (
    <div
      className="player-sheet"
      ref={rootRef}
      data-embedded={embedded ? "" : undefined}
      data-open={open ? "" : undefined}
      data-playing={playing ? "" : undefined}
      data-scrubbing={scrubbing ? "" : undefined}
      onKeyDown={onRootKey}
    >
      {embedded ? null : (
        <header className="ps-caption">
          <h1 className="ps-title">Player Sheet</h1>
          <p className="ps-hint">Drag the mini player up, or fling it. Catch it halfway, pull it past the end, flick it back down.</p>
        </header>
      )}
      <div className="ps-stage">
        <div className="ps-phone" ref={phoneRef}>
          <div className="ps-library" ref={libraryRef} inert={open}>
            <div className="ps-scroll" data-scroll-contain="">
              <div className="ps-lib-head">
                <h2 className="ps-lib-title">Library</h2>
                <div className="ps-chips" aria-hidden="true">
                  <span>Playlists</span>
                  <span>Albums</span>
                  <span data-on="">Songs</span>
                </div>
              </div>
              <h3 className="ps-section">Recently Played</h3>
              <div className="ps-shelf">
                {FEATURED.slice(0, 6).map((a) => (
                  <button key={a.id} type="button" className="ps-album" onClick={() => pick(tracks.find((t) => t.album === a.title)?.id || tracks[0].id)}>
                    <img src={a.cover} alt="" draggable={false} />
                    <span className="ps-album-title">{a.title}</span>
                    <span className="ps-album-year">{a.year}</span>
                  </button>
                ))}
              </div>
              <h3 className="ps-section">Top Songs</h3>
              <ol className="ps-rows">
                {tracks.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="ps-row" data-current={t.id === track.id ? "" : undefined} onClick={() => pick(t.id)}>
                      <img src={t.image} alt="" draggable={false} />
                      <span className="ps-row-text">
                        <span className="ps-row-title">{t.title}</span>
                        <span className="ps-row-artist">{t.artist}</span>
                      </span>
                      {t.id === track.id ? (
                        <span className="ps-eq" aria-label="Now playing">
                          <i />
                          <i />
                          <i />
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <div className="ps-dim" ref={dimRef} aria-hidden="true" />
          <div className="ps-mini-shadow" ref={shadowRef} aria-hidden="true" />
          <div className="ps-sheet" ref={sheetRef}>
            <div className="ps-art" ref={artRef} aria-hidden="true">
              <img key={cover} src={cover} alt="" draggable={false} />
              <span className="ps-art-shade" />
            </div>
            <div className="ps-light" ref={lightRef} aria-hidden="true" />
            <div className="ps-mini" ref={miniRef} inert={open}>
              <button type="button" className="ps-mini-open" ref={openBtnRef} aria-label={`Open player, ${track.title} by ${track.artist}`} onClick={() => engineRef.current?.setOpen(true)}>
                <span className="ps-mini-text" key={track.id}>
                  <span className="ps-mini-title">{track.title}</span>
                  <span className="ps-mini-artist">{track.artist}</span>
                </span>
              </button>
              <button type="button" className="ps-mini-btn" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
                {playing ? <Pause size={22} fill="currentColor" strokeWidth={0} /> : <Play size={22} fill="currentColor" strokeWidth={0} />}
              </button>
              <button type="button" className="ps-mini-btn" aria-label="Next" onClick={() => step(1)}>
                <SkipForward size={22} fill="currentColor" strokeWidth={0} />
              </button>
              <span className="ps-mini-progress" aria-hidden="true">
                <span ref={miniFillRef} />
              </span>
            </div>
            <div className="ps-full" ref={fullRef} inert={!open}>
              <button type="button" className="ps-grabber" ref={closeBtnRef} aria-label="Close player" onClick={() => engineRef.current?.setOpen(false)}>
                <ChevronDown size={20} strokeWidth={2.5} />
              </button>
              <div className="ps-cover-slot" aria-hidden="true" />
              <div className="ps-full-head" key={track.id}>
                <span className="ps-full-text">
                  <span className="ps-full-title">{track.title}</span>
                  <span className="ps-full-artist">
                    {track.artist} · {track.album}
                  </span>
                </span>
                <button type="button" className="ps-round" aria-label="More">
                  <Ellipsis size={20} strokeWidth={2.5} />
                </button>
              </div>
              <div
                className="ps-track"
                ref={trackRef}
                data-nodrag=""
                role="slider"
                tabIndex={0}
                aria-label="Playback position"
                aria-valuemin={0}
                aria-valuemax={track.duration}
                onPointerDown={onTrackDown}
                onKeyDown={onTrackKey}
              >
                <span className="ps-rail">
                  <span className="ps-fill" ref={fillRef} />
                </span>
                <span className="ps-knob" ref={knobRef} />
              </div>
              <div className="ps-times">
                <span ref={timeARef}>0:00</span>
                <span ref={timeBRef}>-0:00</span>
              </div>
              <div className="ps-transport">
                <button type="button" className="ps-btn" aria-label="Previous" onClick={() => step(-1)}>
                  <SkipBack size={32} fill="currentColor" strokeWidth={0} />
                </button>
                <button type="button" className="ps-btn ps-btn-main" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
                  <span className="ps-glyph" data-playing={playing ? "" : undefined}>
                    <Play className="ps-glyph-play" size={44} fill="currentColor" strokeWidth={0} />
                    <Pause className="ps-glyph-pause" size={44} fill="currentColor" strokeWidth={0} />
                  </span>
                </button>
                <button type="button" className="ps-btn" aria-label="Next" onClick={() => step(1)}>
                  <SkipForward size={32} fill="currentColor" strokeWidth={0} />
                </button>
              </div>
              <div className="ps-volume">
                <Volume1 size={16} strokeWidth={2} aria-hidden="true" />
                <div
                  className="ps-vol-track"
                  data-nodrag=""
                  role="slider"
                  tabIndex={0}
                  aria-label="Volume"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(volume * 100)}
                  onPointerDown={onVolumeDown}
                  onKeyDown={onVolumeKey}
                >
                  <span className="ps-vol-rail">
                    <span className="ps-vol-fill" style={{ transform: `scaleX(${volume})` }} />
                  </span>
                </div>
                <Volume2 size={16} strokeWidth={2} aria-hidden="true" />
              </div>
              <div className="ps-bottom">
                <button type="button" className="ps-round" aria-label="Lyrics">
                  <MessageSquareQuote size={20} strokeWidth={2} />
                </button>
                <button type="button" className="ps-round" aria-label="Play on another device">
                  <Airplay size={20} strokeWidth={2} />
                </button>
                <button type="button" className="ps-round" aria-label="Up next">
                  <ListMusic size={20} strokeWidth={2} />
                </button>
              </div>
            </div>
          </div>
          <div className="ps-cover" ref={coverRef} aria-hidden="true">
            <img key={cover} src={cover} alt="" draggable={false} />
          </div>
          <span className="ps-home" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
