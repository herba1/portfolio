"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Pause, Play, Repeat, Rewind, FastForward, Shuffle } from "lucide-react";
import DynamicBackdrop from "./DynamicBackdrop";
import { BACKDROP_DEFAULTS } from "./gradientScene";
import { BackdropAudio } from "./backdropAudio";
import "./backdrop.css";

const DEV = process.env.NODE_ENV !== "production";
const BackdropControls = dynamic(() => import("./BackdropControls"), { ssr: false });

const DEFAULT_QUERY = "lady hear me tonight modjo";

const FALLBACK_TRACK = {
  id: "fallback",
  title: "Lady (Hear Me Tonight)",
  artist: "Modjo",
  artwork: "/backdrop/fallback.jpg",
  sources: [],
};

function toTrack(found) {
  return {
    id: found.id,
    title: found.title,
    artist: found.artist,
    artwork: found.artwork,
    sources: [{ src: found.preview, type: "audio/mp4" }],
  };
}

function pickSource(element, sources) {
  for (const source of sources) {
    if (!source.type || element.canPlayType(source.type)) return source.src;
  }
  return sources[0]?.src || "";
}

export default function BackdropExperience() {
  const [config, setConfig] = useState(BACKDROP_DEFAULTS);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [track, setTrack] = useState(FALLBACK_TRACK);
  const [wide, setWide] = useState(false);
  const [plates, setPlates] = useState([{ id: 0, url: FALLBACK_TRACK.artwork, loaded: false }]);

  const audioRef = useRef(null);
  const engineRef = useRef(null);
  const railRef = useRef(null);
  const elapsedRef = useRef(null);
  const remainingRef = useRef(null);
  const autoplayRef = useRef(false);
  const pickedRef = useRef(false);
  const nextId = useRef(1);

  const artworkURL = plates[plates.length - 1].url;

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    const engine = new BackdropAudio(element);
    engine.setProgressTargets({
      rail: railRef.current,
      elapsed: elapsedRef.current,
      remaining: remainingRef.current,
    });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    const source = pickSource(element, track.sources);
    if (!source) return;
    element.src = source;
    element.load();
    engineRef.current?.reset();
    if (autoplayRef.current) {
      autoplayRef.current = false;
      engineRef.current?.play().catch(() => setPlaying(false));
    }
  }, [track]);

  useEffect(() => {
    const big = window.matchMedia("(min-width: 900px)");
    const read = () => setWide(big.matches);
    read();
    big.addEventListener("change", read);
    return () => big.removeEventListener("change", read);
  }, []);

  const sampler = useCallback(() => engineRef.current?.read() ?? null, []);
  const getLevel = useCallback(() => engineRef.current?.read().level ?? 0, []);
  const handleReady = useCallback(() => setReady(true), []);
  const handleConfig = useCallback((values) => {
    setConfig((previous) => {
      const changed = Object.keys(values).some((key) => previous[key] !== values[key]);
      return changed ? { ...previous, ...values } : previous;
    });
  }, []);

  function swapArtwork(url) {
    const id = nextId.current;
    nextId.current += 1;
    setPlates((previous) => [...previous, { id, url, loaded: false }]);
  }

  const selectTrack = useCallback((found) => {
    pickedRef.current = true;
    autoplayRef.current = true;
    setTrack(toTrack(found));
    swapArtwork(found.artwork);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/itunes/search?q=${encodeURIComponent(DEFAULT_QUERY)}`, {
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((data) => {
        const found = data.tracks?.[0];
        if (!found || pickedRef.current) return;
        setTrack(toTrack(found));
        swapArtwork(found.artwork);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  function toggle() {
    const element = audioRef.current;
    const engine = engineRef.current;
    if (!element || !engine) return;
    if (element.paused) engine.play().catch(() => setPlaying(false));
    else engine.pause();
  }

  function scrub(offset) {
    const element = audioRef.current;
    if (!element) return;
    element.currentTime = Math.min(
      Math.max(0, element.currentTime + offset),
      element.duration || 0,
    );
    engineRef.current?.reseat();
  }

  function seek(event) {
    const element = audioRef.current;
    if (!element || !element.duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    element.currentTime = ((event.clientX - rect.left) / rect.width) * element.duration;
    engineRef.current?.reseat();
  }

  function markLoaded(id) {
    setPlates((previous) => {
      const current = previous.find((plate) => plate.id === id);
      if (!current || current.loaded) return previous;
      const next = previous.map((plate) =>
        plate.id === id ? { ...plate, loaded: true } : plate,
      );
      return next[next.length - 1].id === id && next.length > 1 ? next.slice(-2) : next;
    });
  }

  function absorbPlate(node, id) {
    if (!node) return;
    markLoaded(id);
  }

  function adoptPlate(node, id) {
    if (node?.complete && node.naturalWidth > 0) absorbPlate(node, id);
  }

  useEffect(() => {
    if (plates.length < 2) return;
    const timer = setTimeout(() => {
      setPlates((previous) => previous.slice(-1));
    }, config.crossfadeMS + 200);
    return () => clearTimeout(timer);
  }, [plates, config.crossfadeMS]);

  const fade = { transitionDuration: `${config.crossfadeMS}ms` };
  let lastLoaded = -1;
  plates.forEach((plate, index) => {
    if (plate.loaded) lastLoaded = index;
  });

  return (
    <main
      className="backdrop-page"
      data-ready={ready ? "true" : "false"}
    >
      <DynamicBackdrop
        artworkURL={artworkURL}
        config={config}
        onReady={handleReady}
        sampler={sampler}
      />

      <div className="backdrop-player">
        <div className="backdrop-artwork">
          {plates.map((plate, index) => (
            <img
              key={plate.id}
              ref={(node) => adoptPlate(node, plate.id)}
              src={plate.url}
              alt="Album artwork"
              crossOrigin="anonymous"
              data-visible={index === lastLoaded ? "true" : "false"}
              style={fade}
              onLoad={(event) => absorbPlate(event.currentTarget, plate.id)}
              onError={() => markLoaded(plate.id)}
            />
          ))}
        </div>

        <div className="backdrop-meta">
          <div className="backdrop-title">{track.title}</div>
          <div className="backdrop-artist">{track.artist}</div>
        </div>

        <div className="backdrop-track">
          <div className="backdrop-rail" ref={railRef} onPointerDown={seek}>
            <span />
          </div>
          <div className="backdrop-times">
            <span ref={elapsedRef}>0:00</span>
            <span ref={remainingRef}>-0:00</span>
          </div>
        </div>

        <div className="backdrop-transport">
          <button type="button" aria-label="Shuffle">
            <Shuffle size={18} />
          </button>
          <button type="button" aria-label="Back 10 seconds" onClick={() => scrub(-10)}>
            <Rewind size={22} fill="currentColor" />
          </button>
          <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>
            {playing ? (
              <Pause size={30} fill="currentColor" />
            ) : (
              <Play size={30} fill="currentColor" />
            )}
          </button>
          <button type="button" aria-label="Forward 10 seconds" onClick={() => scrub(10)}>
            <FastForward size={22} fill="currentColor" />
          </button>
          <button type="button" aria-label="Repeat">
            <Repeat size={18} />
          </button>
        </div>
      </div>


      <audio
        ref={audioRef}
        preload="metadata"
        crossOrigin="anonymous"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={() => engineRef.current?.reseat()}
      />

      {DEV && wide ? (
        <BackdropControls onChange={handleConfig} getLevel={getLevel} />
      ) : null}
    </main>
  );
}
