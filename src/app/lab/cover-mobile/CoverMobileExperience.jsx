"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import ClientOnly from "@/app/ui/ClientOnly";
import MorphText from "@/app/ui/MorphText";
import PlayPauseIcon from "@/app/ui/PlayPauseIcon";
import SlotNumber from "@/app/ui/SlotNumber";

import MobileControls from "./MobileControls";
import { createPlaybackStore, createPreviewPlayer } from "./mobileAudio";
import { MOBILE_DEFAULTS, NARROW_COUNT, WIDE_COUNT, isLocalScan, nextSeed, physicsFor } from "./mobileParams";
import "./cover-mobile.css";

const loadStage = () => import("./MobileStage");
if (typeof window !== "undefined") loadStage();

const IDLE_PLAYBACK = { id: null, playing: false, loading: false, unavailable: false, elapsed: 0, duration: 30 };

function useMedia(query, serverValue) {
  const subscribe = useCallback(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

function clock(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function MobilePlayer({ top, store, onToggle }) {
  const playback = useSyncExternalStore(store.subscribe, store.get, () => IDLE_PLAYBACK);
  const textRef = useRef(null);
  const widthRef = useRef(0);
  const captionOnly = isLocalScan(top);
  const topIsLoaded = playback.id === top.id;
  const topPlaying = topIsLoaded && playback.playing;
  const topUnavailable = topIsLoaded && playback.unavailable;
  const playerState = topPlaying ? "playing" : topIsLoaded && playback.loading ? "loading" : "idle";

  const measure = useCallback(() => {
    const text = textRef.current;
    if (!text) return;
    if (widthRef.current > text.clientWidth + 1) text.dataset.clipped = "true";
    else delete text.dataset.clipped;
  }, []);

  const handleWidth = useCallback(
    (width) => {
      widthRef.current = width;
      measure();
    },
    [measure],
  );

  useEffect(() => {
    const text = textRef.current;
    if (!text) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(text);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div className="cm-player" data-state={playerState} data-mode={captionOnly ? "caption" : "player"}>
      {captionOnly ? null : (
        <button
          type="button"
          className="cm-player__toggle"
          onClick={onToggle}
          disabled={topUnavailable}
          aria-label={topPlaying ? `Pause ${top.title}` : `Play ${top.title}`}
        >
          <PlayPauseIcon playing={topPlaying} size={16} />
        </button>
      )}
      <div ref={textRef} className="cm-player__text">
        <MorphText className="cm-player__title text-ui-lg" text={`${top.title} · ${top.artist}`} onWidth={handleWidth} />
        {captionOnly ? null : (
          <span className="cm-player__meta text-ui tabular-nums">
            {topUnavailable ? (
              "No preview for this one"
            ) : (
              <>
                <SlotNumber value={clock(topIsLoaded ? playback.elapsed : 0)} duration={420} />
                <span className="cm-player__sep">/</span>
                <SlotNumber value={clock(topIsLoaded ? playback.duration : 30)} duration={420} />
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

export default function CoverMobileExperience({ covers = [], embedded = false }) {
  const [params, setParams] = useState(MOBILE_DEFAULTS);
  const [panelOpen, setPanelOpen] = useState(false);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [store] = useState(() => createPlaybackStore(IDLE_PLAYBACK));
  const reducedMotion = useMedia("(prefers-reduced-motion: reduce)", false);
  const narrow = useMedia("(max-width: 640px), (max-height: 500px)", false);
  const playerRef = useRef(null);
  const controllerRef = useRef(null);

  const count = params.count ?? (narrow ? NARROW_COUNT : WIDE_COUNT);
  const physics = useMemo(() => physicsFor(params), [params]);
  const values = useMemo(() => ({ ...params, count }), [params, count]);
  const top = nowPlaying ?? covers[0] ?? null;
  const jukebox = useMemo(() => covers.some((cover) => !isLocalScan(cover)), [covers]);

  useEffect(() => {
    const player = createPreviewPlayer((snapshot) => {
      store.set(snapshot);
      controllerRef.current?.syncLabels();
      if (snapshot.playing || snapshot.loading) controllerRef.current?.wake();
    });
    playerRef.current = player;
    player.onEnd(() => controllerRef.current?.promoteNext());
    return () => {
      player.destroy();
      playerRef.current = null;
      store.set(IDLE_PLAYBACK);
    };
  }, [store]);

  useEffect(() => {
    if (embedded) return undefined;
    const hung = covers.slice(0, WIDE_COUNT).filter((cover) => !isLocalScan(cover));
    if (!hung.length) return undefined;
    const run = () => playerRef.current?.prefetch(hung);
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(run, { timeout: 2400 });
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(run, 600);
    return () => window.clearTimeout(handle);
  }, [covers, embedded]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== " " || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target !== document.body && target !== document.documentElement) return;
      event.preventDefault();
      controllerRef.current?.gust(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handlePromote = useCallback(
    (cover) => {
      setNowPlaying(cover);
      if (!embedded) playerRef.current?.play(cover);
      controllerRef.current?.wake();
    },
    [embedded],
  );

  const handleTopTap = useCallback(
    (cover) => {
      setNowPlaying(cover);
      if (!embedded) playerRef.current?.toggle(cover);
      controllerRef.current?.wake();
    },
    [embedded],
  );

  const handleController = useCallback((controller) => {
    controllerRef.current = controller;
  }, []);

  const handleToggle = useCallback(() => {
    const cover = controllerRef.current?.topCover() ?? top;
    if (!cover) return;
    setNowPlaying(cover);
    playerRef.current?.toggle(cover);
    controllerRef.current?.wake();
  }, [top]);

  const handleParam = useCallback((key, value) => {
    setParams((current) => ({ ...current, [key]: value }));
  }, []);

  const handleReroll = useCallback(() => {
    setParams((current) => ({ ...current, seed: nextSeed(current.seed) }));
  }, []);

  const handleReset = useCallback(() => {
    setParams(MOBILE_DEFAULTS);
  }, []);

  const handlePanel = useCallback(() => {
    setPanelOpen((open) => !open);
  }, []);

  const Root = embedded ? "div" : "main";

  return (
    <Root className="cm" data-embedded={embedded ? "true" : undefined}>
      <ClientOnly
        load={loadStage}
        fallback={<div className="cm-stage" />}
        covers={covers}
        count={count}
        seed={params.seed}
        physics={physics}
        reducedMotion={reducedMotion}
        embedded={embedded}
        playerRef={playerRef}
        onPromote={handlePromote}
        onTopTap={handleTopTap}
        onControllerReady={handleController}
      />

      {!embedded ? (
        <header className="cm-head">
          <h1 className="text-heading">Mobile</h1>
          <p className="text-ui text-ink-secondary">
            {jukebox ? "Pull a cover and let go. Tap one to hang it on top and play it." : "Pull a cover and let go. Tap one to hang it on top."}
          </p>
        </header>
      ) : null}

      {top && !embedded ? <MobilePlayer top={top} store={store} onToggle={handleToggle} /> : null}

      {!embedded ? (
        <MobileControls
          values={values}
          open={panelOpen}
          onToggle={handlePanel}
          onChange={handleParam}
          onReroll={handleReroll}
          onReset={handleReset}
        />
      ) : null}
    </Root>
  );
}
