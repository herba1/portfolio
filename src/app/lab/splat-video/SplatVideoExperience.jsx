"use client";

import { Check, Copy, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import ClientOnly from "@/app/ui/ClientOnly";

import SplatVideoClips from "./SplatVideoClips";
import SplatVideoControls from "./SplatVideoControls";
import { Splat4dError, listClips, loadSplat4d, resolveClip } from "./loadSplat4d";
import "./splat-video.css";
import {
  DEFAULT_SPEED,
  RENDER,
  STREAM,
  createEngine,
  exportCommand,
  formatBytes,
  formatCount,
  formatDuration,
  LOOKS,
  isHybrid,
  isRgbd,
  isStream,
  resetOrbit,
} from "./splatVideoParams";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const MOBILE = `(max-width: ${RENDER.mobileBreakpoint - 1}px)`;
const COPY_RESET_MS = 1600;

function subscribeMedia(query) {
  return (callback) => {
    const list = window.matchMedia(query);
    list.addEventListener("change", callback);
    return () => list.removeEventListener("change", callback);
  };
}

const subscribeReducedMotion = subscribeMedia(REDUCED_MOTION);
const subscribeMobile = subscribeMedia(MOBILE);
const readReducedMotion = () => window.matchMedia(REDUCED_MOTION).matches;
const readMobile = () => window.matchMedia(MOBILE).matches;
const readOnServer = () => false;

function isTextEntry(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  return target.tagName === "INPUT" && target.type !== "range";
}

function loadingLine(load) {
  if (!load.total) return "Reading meta.json";
  return `${formatBytes(load.received)} of ${formatBytes(load.total)}`;
}

function loadScene(meta) {
  if (isHybrid(meta)) return () => import("./HybridScene");
  return isRgbd(meta) ? () => import("./RgbdScene") : () => import("./SplatVideoScene");
}

function summaryFor(load) {
  if (load.status === "error") return "Nothing to play yet";
  if (load.status !== "ready") return "Moving Gaussian splats you can nudge while they play";
  const { meta, bytes } = load.data;
  const size = formatBytes(bytes);
  if (isRgbd(meta)) return `${load.clip} · depth video · ${meta.frames} frames · ${size}`;
  if (isHybrid(meta)) return `${load.clip} · ${formatCount(meta.background.count)} background splats · ${meta.frames} frames · video streaming`;
  if (isStream(meta)) return `${load.clip} · ${formatDuration(meta.duration)} · ${meta.frames} moments · streaming`;
  return `${load.clip} · ${formatCount(meta.count)} splats · ${meta.frames} frames · ${size}`;
}

function StageLoading({ load }) {
  const progress = load.total ? load.received / load.total : 0;
  return (
    <div className="splat-video__overlay" role="status" aria-live="polite">
      <p className="text-heading">{load.clip ? `Loading ${load.clip}` : "Finding the newest export"}</p>
      <div className="splat-video__progress" style={{ "--splat-video-load": String(progress) }}>
        <span />
      </div>
      <p className="text-ui tabular-nums">{loadingLine(load)}</p>
    </div>
  );
}

function StageBuffering({ engineRef }) {
  const pillRef = useRef(null);
  const liveRef = useRef(null);

  useEffect(() => {
    let frame = 0;
    let since = -1;
    let shown = false;
    const tick = (now) => {
      const engine = engineRef.current;
      const stalled = engine.buffering || engine.soundWaiting;
      if (!stalled) since = -1;
      else if (since < 0) since = now;
      const show = stalled && now - since >= STREAM.bufferingShowMs;
      if (show !== shown) {
        shown = show;
        if (pillRef.current) pillRef.current.dataset.visible = String(show);
        if (liveRef.current) liveRef.current.textContent = show ? "Buffering" : "";
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [engineRef]);

  return (
    <>
      <div ref={pillRef} className="splat-video__buffering" data-visible="false" aria-hidden="true">
        <LoaderCircle size={16} strokeWidth={1.75} />
        <span className="text-ui">Buffering</span>
      </div>
      <p ref={liveRef} className="splat-video-sr" role="status" aria-live="polite" />
    </>
  );
}

function StageError({ load }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(0);
  const command = load.missing && load.clip ? exportCommand(load.clip) : null;

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), COPY_RESET_MS);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="splat-video__overlay splat-video__overlay--error" role="alert">
      <p className="text-heading">{load.message}</p>
      {command ? (
        <>
          <p className="text-ui">Run this from the repo root, then reload.</p>
          <div className="splat-video__command">
            <code className="text-ui-sm">{command}</code>
            <button type="button" className="splat-video__copy text-ui" onClick={handleCopy}>
              {copied ? <Check size={16} strokeWidth={1.75} aria-hidden="true" /> : <Copy size={16} strokeWidth={1.75} aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="splat-video__copy text-ui" onClick={() => window.location.reload()}>
          Try again
        </button>
      )}
    </div>
  );
}

export default function SplatVideoExperience() {
  const [load, setLoad] = useState({ status: "loading", clip: null, received: 0, total: 0 });
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [look, setLook] = useState(LOOKS[0]);
  const [scrubbing, setScrubbing] = useState(false);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [expanded, setExpanded] = useState(false);
  const [requested, setRequested] = useState(null);
  const [clips, setClips] = useState([]);
  const engineRef = useRef(createEngine());

  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, readOnServer);
  const isMobile = useSyncExternalStore(subscribeMobile, readMobile, readOnServer);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let lastShown = 0;
    const onProgress = (received, total) => {
      if (received !== total && received - lastShown < total / 100) return;
      lastShown = received;
      setLoad((previous) => ({ ...previous, received, total }));
    };
    const wanted = requested ? requested.clip : new URLSearchParams(window.location.search).get("clip");
    resolveClip(wanted, signal)
      .then((clip) => {
        setLoad({ status: "loading", clip, received: 0, total: 0 });
        return loadSplat4d(clip, { signal, onProgress });
      })
      .then((data) => {
        if (signal.aborted) return;
        const engine = engineRef.current;
        engine.time = 0;
        engine.direction = 1;
        engine.muted = true;
        resetOrbit(engine);
        setMuted(true);
        setPlaying(!window.matchMedia(REDUCED_MOTION).matches);
        setLoad({ status: "ready", clip: data.clip, data });
      })
      .catch((error) => {
        if (signal.aborted || error?.name === "AbortError") return;
        const known = error instanceof Splat4dError;
        setLoad({
          status: "error",
          clip: known ? error.clip : null,
          missing: known && error.missing,
          message: known ? error.message : "The clip could not be read.",
        });
      });
    return () => controller.abort();
  }, [requested]);

  useEffect(() => {
    const controller = new AbortController();
    listClips(controller.signal)
      .then(setClips)
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    engineRef.current.playing = playing;
  }, [playing]);

  useEffect(() => {
    engineRef.current.speed = speed;
  }, [speed]);

  useEffect(() => {
    engineRef.current.muted = muted;
  }, [muted]);

  useEffect(() => {
    engineRef.current.look = look;
  }, [look]);

  useEffect(() => {
    engineRef.current.reducedMotion = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    engineRef.current.scrubbing = scrubbing;
  }, [scrubbing]);

  const ready = load.status === "ready";

  const togglePlaying = useCallback(() => {
    const engine = engineRef.current;
    engine.playing = !engine.playing;
    engine.sound?.gesture();
    setPlaying(engine.playing);
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    const onKeyDown = (event) => {
      if (event.code !== "Space" && event.key !== " ") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTextEntry(event.target)) return;
      if (event.target instanceof HTMLElement && event.target.closest("button")) return;
      event.preventDefault();
      togglePlaying();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ready, togglePlaying]);

  const handleToggleMuted = useCallback(() => {
    const engine = engineRef.current;
    engine.muted = !engine.muted;
    engine.sound?.gesture();
    setMuted(engine.muted);
  }, []);
  const handlePause = useCallback(() => setPlaying(false), []);
  const handleBackToLens = useCallback(() => resetOrbit(engineRef.current), []);
  const handleScrubStart = useCallback(() => {
    engineRef.current.scrubbing = true;
    setScrubbing(true);
  }, []);
  const handleScrubEnd = useCallback(() => {
    engineRef.current.scrubbing = false;
    setScrubbing(false);
  }, []);
  const handleToggleExpanded = useCallback(() => setExpanded((value) => !value), []);
  const handleSelectClip = useCallback(
    (name) => {
      if (name === load.clip && load.status !== "error") return;
      const url = new URL(window.location.href);
      url.searchParams.set("clip", name);
      window.history.replaceState(window.history.state, "", url);
      engineRef.current.scrubbing = false;
      setScrubbing(false);
      setPlaying(false);
      setLoad({ status: "loading", clip: name, received: 0, total: 0 });
      setRequested({ clip: name });
    },
    [load.clip, load.status],
  );

  const meta = ready ? load.data.meta : null;
  const aspect = meta ? meta.camera.aspect : 16 / 9;
  const streaming = Boolean(meta && isStream(meta));
  const summary = summaryFor(load);

  return (
    <main
      className="splat-video bg-surface text-ink"
      data-status={load.status}
      style={{ "--splat-video-aspect": String(aspect) }}
    >
      <header className="splat-video__head">
        <h1 className="splat-video__title text-title-sm">Splat video</h1>
        <p className="text-ui tabular-nums">{summary}</p>
        <SplatVideoClips clips={clips} current={load.clip} onSelect={handleSelectClip} />
      </header>

      <section
        className="splat-video__stage"
        aria-label="Splat video stage. Drag to orbit, scroll to dolly."
      >
        {ready ? (
          <ClientOnly
            key={load.clip}
            load={loadScene(meta)}
            clip={load.data}
            engineRef={engineRef}
            isMobile={isMobile}
          />
        ) : load.status === "error" ? (
          <StageError load={load} />
        ) : (
          <StageLoading load={load} />
        )}
        {streaming || (ready && isHybrid(meta)) ? <StageBuffering key={`${load.clip}-buffering`} engineRef={engineRef} /> : null}
      </section>

      {ready ? (
        <SplatVideoControls
          engineRef={engineRef}
          meta={meta}
          playing={playing}
          scrubbing={scrubbing}
          speed={speed}
          expanded={expanded}
          sound={(streaming || isRgbd(meta) || isHybrid(meta)) && Boolean(meta.audio)}
          muted={muted}
          onToggleMuted={handleToggleMuted}
          look={isHybrid(meta) ? look : null}
          onLook={setLook}
          onTogglePlay={togglePlaying}
          onPause={handlePause}
          onSpeed={setSpeed}
          onBackToLens={handleBackToLens}
          onScrubStart={handleScrubStart}
          onScrubEnd={handleScrubEnd}
          onToggleExpanded={handleToggleExpanded}
        />
      ) : null}
    </main>
  );
}
