"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import ClientOnly from "@/app/ui/ClientOnly";
import MorphText from "@/app/ui/MorphText";
import SlotNumber from "@/app/ui/SlotNumber";
import useNearViewport from "@/app/experiments/useNearViewport";
import { clearStored, storeParams } from "@/app/ui/paramStore";

import MoshControls from "./MoshControls";
import { BLOCK_SIZES, MOSH_DEFAULTS, MOSH_PRESETS, matchPreset, presetValues, sanitiseParams } from "./moshParams";
import "./mosh.css";

const STORAGE_KEY = "herb:mosh:params";
const STREAM_LENGTH = 6;
const COUNTER_PAD = 3;

const loadStage = () => import("./MoshStage");
if (typeof window !== "undefined") loadStage();

function subscribeStorage(callback) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function readStorage() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribeMotion(callback) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function readMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function readNothing() {
  return null;
}

function readFalse() {
  return false;
}

function parseStored(raw) {
  if (!raw) return null;
  try {
    return sanitiseParams(JSON.parse(raw));
  } catch {
    return null;
  }
}

function captionFor(cover) {
  if (!cover) return "";
  return cover.artist ? `${cover.title} — ${cover.artist}` : cover.title;
}

export default function MoshExperience({ covers = [], embedded = false, source = "recent" }) {
  const stream = useMemo(() => covers.slice(0, STREAM_LENGTH), [covers]);
  const storedRaw = useSyncExternalStore(subscribeStorage, readStorage, readNothing);
  const reducedMotion = useSyncExternalStore(subscribeMotion, readMotion, readFalse);
  const storedParams = useMemo(() => (embedded ? null : parseStored(storedRaw)), [embedded, storedRaw]);

  const [edited, setEdited] = useState(null);
  const [state, setState] = useState({ current: 0, target: stream.length > 1 ? 1 : 0 });
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState(null);
  const [tuneOpen, setTuneOpen] = useState(false);
  const [counterDirection, setCounterDirection] = useState("up");
  const [keyBeat, setKeyBeat] = useState(0);

  const params = edited ?? storedParams ?? MOSH_DEFAULTS;
  const activePreset = matchPreset(params);

  const plateRef = useRef(null);
  const apiRef = useRef(null);
  const counterRef = useRef(null);
  const counterPendingRef = useRef(null);
  const counterDirectionRef = useRef("up");
  const near = useNearViewport(plateRef);

  const currentCover = stream[state.current];
  const targetCover = stream[state.target];

  const commitParams = useCallback(
    (next) => {
      setEdited(next);
      if (!embedded) storeParams(STORAGE_KEY, next);
    },
    [embedded],
  );

  const handleApi = useCallback((api) => {
    apiRef.current = api;
    if (!api) setReady(false);
  }, []);

  const handleReady = useCallback(() => setReady(true), []);
  const handleError = useCallback((message) => setFailure(message), []);

  const handleCovers = useCallback((next) => {
    setState((previous) => (previous.current === next.current && previous.target === next.target ? previous : next));
  }, []);

  const handleFrames = useCallback((count, reset) => {
    const text = String(Math.min(count, 999)).padStart(COUNTER_PAD, "0");
    if (reset) {
      counterPendingRef.current = text;
      counterDirectionRef.current = "down";
      setCounterDirection("down");
      setKeyBeat((beat) => beat + 1);
      return;
    }
    if (counterDirectionRef.current === "down") {
      counterPendingRef.current = text;
      counterDirectionRef.current = "up";
      setCounterDirection("up");
      return;
    }
    counterRef.current?.setValue(text);
  }, []);

  useLayoutEffect(() => {
    const pendingText = counterPendingRef.current;
    if (pendingText === null) return;
    counterPendingRef.current = null;
    counterRef.current?.setValue(pendingText);
  }, [counterDirection, keyBeat]);

  const handleChange = useCallback(
    (key, value) => {
      commitParams({ ...params, [key]: value });
      if (key === "block") window.setTimeout(() => apiRef.current?.playSwipe(BLOCK_SIZES.indexOf(value) + 1), 60);
    },
    [commitParams, params],
  );

  const handlePreset = useCallback(
    (preset) => {
      commitParams({ ...presetValues(preset), vectors: params.vectors });
      window.setTimeout(() => apiRef.current?.playSwipe(MOSH_PRESETS.indexOf(preset)), 60);
    },
    [commitParams, params.vectors],
  );

  const handleReset = useCallback(() => {
    setEdited(MOSH_DEFAULTS);
    clearStored(STORAGE_KEY);
  }, []);

  const handleKeyframe = useCallback(() => {
    apiRef.current?.keyframe();
  }, []);

  const handleChip = useCallback((index) => {
    apiRef.current?.keyframe(index);
  }, []);

  const toggleTune = useCallback(() => setTuneOpen((open) => !open), []);

  const Root = embedded ? "div" : "main";
  const label = currentCover
    ? `Datamosh plate showing ${captionFor(currentCover)}. Drag to smear, hold to pin, Space for a keyframe, arrow keys to pan.`
    : "Datamosh plate";

  return (
    <Root className="mosh" data-embedded={embedded ? "true" : undefined} data-ready={ready ? "true" : "false"}>
      <div className="mosh-layout">
        <div className="mosh-stage">
          <div ref={plateRef} className="mosh-plate" data-failed={failure ? "true" : undefined}>
            {currentCover ? (
              <img
                className="mosh-placeholder"
                src={currentCover.image}
                alt=""
                aria-hidden="true"
                crossOrigin="anonymous"
                decoding="async"
                fetchPriority="high"
                draggable={false}
              />
            ) : null}
            {near && !failure && stream.length ? (
              <ClientOnly
                load={loadStage}
                fallback={null}
                covers={stream}
                params={params}
                embedded={embedded}
                reducedMotion={reducedMotion}
                label={label}
                onApi={handleApi}
                onReady={handleReady}
                onCovers={handleCovers}
                onFrames={handleFrames}
                onError={handleError}
              />
            ) : null}
            {failure ? <p className="mosh-failure text-ui text-ink">Mosh needs WebGL2. Showing the cover untouched.</p> : null}
          </div>
        </div>

        {embedded ? null : (
          <aside className="mosh-side">
            <header className="mosh-head mosh-rise" style={{ "--rise": 0 }}>
              <h1 className="mosh-title text-title-sm text-ink">Mosh</h1>
              <p className="mosh-hint text-ui-lg text-ink">Drag across the cover to smear it into the next record. Hold still to pin blocks; tap for a keyframe.</p>
            </header>

            <section className="mosh-now mosh-rise" style={{ "--rise": 1 }} aria-live="polite">
              <p className="text-ui text-ink-secondary">{source === "fallback" ? "Now showing" : "Now playing"}</p>
              <div className="mosh-now__title text-fade text-ui-lg text-ink">
                <MorphText text={captionFor(currentCover)} maxSlideEm={6} />
              </div>
              <p className="mosh-now__next text-ui text-ink-secondary">
                <span>Next</span>
                <span className="mosh-now__next-title text-fade">
                  <MorphText text={targetCover?.title ?? ""} maxSlideEm={6} />
                </span>
              </p>
            </section>

            <div className="mosh-chips mosh-rise" style={{ "--rise": 2, "--chip-index": state.current }} role="group" aria-label="Stream">
              {stream.map((cover, index) => (
                <button
                  key={cover.id}
                  type="button"
                  className="mosh-chip"
                  style={{ "--chip-image": `url("${cover.thumb ?? cover.image}")`, "--chip-order": index }}
                  data-current={index === state.current ? "true" : "false"}
                  data-next={index === state.target ? "true" : "false"}
                  aria-label={`Keyframe to ${captionFor(cover)}`}
                  aria-pressed={index === state.current}
                  onClick={() => handleChip(index)}
                />
              ))}
              <span className="mosh-chips__underline" aria-hidden="true" />
            </div>

            <div className="mosh-counter mosh-rise" style={{ "--rise": 3 }}>
              <p className="mosh-counter__readout text-ui text-ink-secondary">
                <span>Frames since keyframe</span>
                <SlotNumber
                  ref={counterRef}
                  className="mosh-counter__value text-ui-lg text-ink"
                  value="000"
                  direction={counterDirection}
                  duration={480}
                />
              </p>
              <button type="button" className="mosh-key text-ui text-ink" onClick={handleKeyframe}>
                Keyframe
                <kbd className="mosh-key__kbd text-ui-xs">Space</kbd>
              </button>
            </div>

            <div className="mosh-rise" style={{ "--rise": 4 }}>
              <MoshControls
                params={params}
                activePreset={activePreset}
                open={tuneOpen}
                onToggleOpen={toggleTune}
                onPreset={handlePreset}
                onChange={handleChange}
                onReset={handleReset}
              />
            </div>
          </aside>
        )}
      </div>
    </Root>
  );
}

