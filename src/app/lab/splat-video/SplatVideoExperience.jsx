"use client";

import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import ClientOnly from "@/app/ui/ClientOnly";

import SplatVideoControls from "./SplatVideoControls";
import { Splat4dError, loadSplat4d, resolveClip } from "./loadSplat4d";
import "./splat-video.css";
import {
  DEFAULT_SPEED,
  RENDER,
  createEngine,
  exportCommand,
  formatBytes,
  formatCount,
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
  const [scrubbing, setScrubbing] = useState(false);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [expanded, setExpanded] = useState(false);
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
    resolveClip(new URLSearchParams(window.location.search).get("clip"), signal)
      .then((clip) => {
        setLoad({ status: "loading", clip, received: 0, total: 0 });
        return loadSplat4d(clip, { signal, onProgress });
      })
      .then((data) => {
        if (signal.aborted) return;
        const engine = engineRef.current;
        engine.time = 0;
        engine.direction = 1;
        resetOrbit(engine);
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
  }, []);

  useEffect(() => {
    engineRef.current.playing = playing;
  }, [playing]);

  useEffect(() => {
    engineRef.current.speed = speed;
  }, [speed]);

  useEffect(() => {
    engineRef.current.reducedMotion = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    engineRef.current.scrubbing = scrubbing;
  }, [scrubbing]);

  const ready = load.status === "ready";

  useEffect(() => {
    if (!ready) return undefined;
    const onKeyDown = (event) => {
      if (event.code !== "Space" && event.key !== " ") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTextEntry(event.target)) return;
      if (event.target instanceof HTMLElement && event.target.closest("button")) return;
      event.preventDefault();
      setPlaying((value) => !value);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ready]);

  const handleTogglePlay = useCallback(() => setPlaying((value) => !value), []);
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

  const meta = ready ? load.data.meta : null;
  const aspect = meta ? meta.camera.aspect : 16 / 9;
  const summary = ready
    ? `${load.clip} · ${formatCount(meta.count)} splats · ${meta.frames} frames · ${formatBytes(load.data.bytes)}`
    : load.status === "error"
      ? "Nothing to play yet"
      : "Moving Gaussian splats you can nudge while they play";

  return (
    <main
      className="splat-video bg-surface text-ink"
      data-status={load.status}
      style={{ "--splat-video-aspect": String(aspect) }}
    >
      <header className="splat-video__head">
        <h1 className="splat-video__title text-title-sm">Splat video</h1>
        <p className="text-ui tabular-nums">{summary}</p>
      </header>

      <section
        className="splat-video__stage"
        aria-label="Splat video stage. Drag to orbit, scroll to dolly."
      >
        {ready ? (
          <ClientOnly
            load={() => import("./SplatVideoScene")}
            clip={load.data}
            engineRef={engineRef}
            isMobile={isMobile}
          />
        ) : load.status === "error" ? (
          <StageError load={load} />
        ) : (
          <StageLoading load={load} />
        )}
      </section>

      {ready ? (
        <SplatVideoControls
          engineRef={engineRef}
          meta={meta}
          playing={playing}
          scrubbing={scrubbing}
          speed={speed}
          expanded={expanded}
          onTogglePlay={handleTogglePlay}
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
