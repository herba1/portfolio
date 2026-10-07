"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import MorphText from "@/app/ui/MorphText";
import SlotNumber from "@/app/ui/SlotNumber";
import useNearViewport from "@/app/experiments/useNearViewport";
import { clearStored, sanitise, storeParams } from "@/app/ui/paramStore";

import QuadControls from "./QuadControls";
import QuadReadout from "./QuadReadout";
import QuadStage from "./QuadStage";
import { DEFAULT_PRESET, FACES, QUAD_DEFAULTS, presetValues } from "./quadParams";
import "./quadtree.css";

const STORAGE_KEY = "herb:quadtree:params";
const MAX_COVERS = 24;
const NOTE_MS = 2400;
const STORE_DELAY_MS = 200;

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

function subscribeMedia(query) {
  return (callback) => {
    const list = window.matchMedia(query);
    list.addEventListener("change", callback);
    return () => list.removeEventListener("change", callback);
  };
}

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
const WIDE_QUERY = "(min-width: 1100px)";
const subscribeReduced = subscribeMedia(REDUCED_QUERY);
const subscribeWide = subscribeMedia(WIDE_QUERY);
const readReduced = () => window.matchMedia(REDUCED_QUERY).matches;
const readWide = () => window.matchMedia(WIDE_QUERY).matches;
const readNothing = () => null;
const readFalse = () => false;

function parseStored(raw) {
  if (!raw) return null;
  try {
    return sanitise(JSON.parse(raw), QUAD_DEFAULTS);
  } catch {
    return null;
  }
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function slugOf(text) {
  return String(text ?? "quadtree")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function QuadtreeExperience({ covers = [], embedded = false }) {
  const storedRaw = useSyncExternalStore(subscribeStorage, readStorage, readNothing);
  const reducedMotion = useSyncExternalStore(subscribeReduced, readReduced, readFalse);
  const wide = useSyncExternalStore(subscribeWide, readWide, readFalse);
  const storedParams = useMemo(() => (embedded ? null : parseStored(storedRaw)), [embedded, storedRaw]);

  const [edited, setEdited] = useState(null);
  const [activePreset, setActivePreset] = useState(DEFAULT_PRESET);
  const [sourceName, setSourceName] = useState("covers");
  const [failed, setFailed] = useState(() => new Set());
  const [position, setPosition] = useState({ index: 0, direction: "up" });
  const [shownId, setShownId] = useState(null);
  const [panelChoice, setPanelChoice] = useState(null);
  const [note, setNote] = useState(null);

  const params = edited ?? storedParams ?? QUAD_DEFAULTS;
  const panelOpen = !embedded && (panelChoice ?? wide);
  const panelState = embedded || panelChoice === null ? undefined : panelChoice ? "open" : "closed";

  const stageRef = useRef(null);
  const readoutRef = useRef(null);
  const captureRef = useRef(null);
  const releaseRef = useRef(null);
  const originRef = useRef({ x: 0.5, y: 0.5 });
  const noteTimerRef = useRef(0);
  const storeTimerRef = useRef(0);
  const near = useNearViewport(stageRef);

  const list = useMemo(() => {
    const base = sourceName === "faces" ? FACES : covers.slice(0, MAX_COVERS);
    return base.filter((item) => !failed.has(item.id));
  }, [covers, sourceName, failed]);

  const count = list.length;
  const index = count ? ((position.index % count) + count) % count : 0;
  const entry = count ? list[index] : null;
  const upcoming = count > 1 ? list[(index + 1) % count] : null;
  const shown = list.find((item) => item.id === shownId) ?? entry;

  const commit = useCallback(
    (next) => {
      setEdited(next);
      if (embedded) return;
      window.clearTimeout(storeTimerRef.current);
      storeTimerRef.current = window.setTimeout(() => storeParams(STORAGE_KEY, next), STORE_DELAY_MS);
    },
    [embedded],
  );

  useEffect(
    () => () => {
      window.clearTimeout(storeTimerRef.current);
      window.clearTimeout(noteTimerRef.current);
    },
    [],
  );

  const flash = useCallback((message) => {
    setNote(message);
    window.clearTimeout(noteTimerRef.current);
    noteTimerRef.current = window.setTimeout(() => setNote(null), NOTE_MS);
  }, []);

  const handleChange = useCallback(
    (key, value) => {
      setActivePreset(null);
      commit({ ...params, [key]: value });
    },
    [commit, params],
  );

  const handleLens = useCallback(
    (value) => {
      commit({ ...params, lens: value });
    },
    [commit, params],
  );

  const handlePreset = useCallback(
    (preset) => {
      setActivePreset(preset.name);
      commit({ ...presetValues(preset), lens: params.lens, mergeDelay: params.mergeDelay, budget: params.budget, minTile: params.minTile });
    },
    [commit, params],
  );

  const handleReset = useCallback(() => {
    setActivePreset(DEFAULT_PRESET);
    setEdited(QUAD_DEFAULTS);
    window.clearTimeout(storeTimerRef.current);
    clearStored(STORAGE_KEY);
    releaseRef.current?.();
    flash("Back to the defaults");
  }, [flash]);

  const handleSave = useCallback(() => {
    const capture = captureRef.current;
    if (!capture) return;
    try {
      const link = document.createElement("a");
      link.href = capture();
      link.download = `quadtree-${slugOf(shown?.title)}.png`;
      link.click();
      flash("Saved the mosaic as a PNG");
    } catch {
      flash("This picture cannot be exported");
    }
  }, [flash, shown]);

  const handleSource = useCallback((name) => {
    originRef.current = { x: 0.5, y: 0.5 };
    setSourceName(name);
    setPosition({ index: 0, direction: "up" });
  }, []);

  const handleNext = useCallback(() => {
    setPosition((prev) => ({ index: prev.index + 1, direction: "up" }));
  }, []);

  const handlePrevious = useCallback(() => {
    setPosition((prev) => ({ index: prev.index - 1, direction: "down" }));
  }, []);

  const handleShown = useCallback((item) => setShownId(item.id), []);

  const handleFail = useCallback((item) => {
    setFailed((prev) => {
      if (prev.has(item.id)) return prev;
      const next = new Set(prev);
      next.add(item.id);
      return next;
    });
  }, []);

  const handleStats = useCallback((tiles, carved) => {
    readoutRef.current?.update(tiles, carved);
  }, []);

  const handleRelease = useCallback(() => releaseRef.current?.(), []);

  useEffect(() => {
    if (embedded) return undefined;
    const handleKey = (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, button, a, [contenteditable], .qt-panel")) return;
      if (event.key === "ArrowRight" || event.key === " ") {
        event.preventDefault();
        originRef.current = { x: 1, y: 0.5 };
        handleNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        originRef.current = { x: 0, y: 0.5 };
        handlePrevious();
      } else if (event.key === "Escape") {
        releaseRef.current?.();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [embedded, handleNext, handlePrevious]);

  const stepButton = (direction) => () => {
    originRef.current = direction > 0 ? { x: 1, y: 0.5 } : { x: 0, y: 0.5 };
    if (direction > 0) handleNext();
    else handlePrevious();
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root className="qt-page" data-embedded={embedded ? "" : undefined} data-panel={panelState}>
      <div className="qt-main">
        {embedded ? null : (
          <header className="qt-head">
            <div className="qt-head__text">
              <h1 className="qt-title text-heading text-ink">Quadtree</h1>
              <p className="qt-hint text-ui text-ink-secondary">
                <span className="qt-hint__fine">Hover to sharpen, press and drag to carve, click for the next cover</span>
                <span className="qt-hint__touch">Drag to sharpen, hold to carve, tap for the next cover</span>
              </p>
            </div>
            <button
              type="button"
              className="qt-button qt-panel-toggle text-ui"
              aria-expanded={panelOpen}
              onClick={() => setPanelChoice(!panelOpen)}
            >
              <span className="qt-toggle__open">Controls</span>
              <span className="qt-toggle__close">Hide controls</span>
            </button>
          </header>
        )}

        <div ref={stageRef} className="qt-stage">
          <div className="qt-frame">
            {near && entry ? (
              <QuadStage
                entry={entry}
                upcoming={upcoming}
                params={params}
                embedded={embedded}
                reducedMotion={reducedMotion}
                originRef={originRef}
                onStats={handleStats}
                onShown={handleShown}
                onFail={handleFail}
                onNext={handleNext}
                onPrevious={handlePrevious}
                onLens={handleLens}
                captureRef={captureRef}
                releaseRef={releaseRef}
              />
            ) : (
              <div className="qt-cover">
                <div className="qt-cover__well" />
              </div>
            )}

            <div className="qt-meta">
              <div className="qt-track">
                {shown ? (
                  <>
                    <MorphText className="qt-track__title text-ui text-ink" text={shown.title} />
                    <MorphText className="qt-track__artist text-ui text-ink-secondary" text={shown.artist} />
                  </>
                ) : (
                  <span className="text-ui text-ink-secondary">No pictures could be loaded</span>
                )}
              </div>
              <div className="qt-meta__end">
                <QuadReadout ref={readoutRef} onRelease={handleRelease} />
                {count > 1 ? (
                  <div className="qt-nav">
                    <button type="button" className="qt-step" aria-label="Previous cover" onClick={stepButton(-1)}>
                      <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                    <SlotNumber
                      className="qt-counter text-ui text-ink"
                      value={`${pad(index + 1)} / ${pad(count)}`}
                      direction={position.direction}
                    />
                    <button type="button" className="qt-step" aria-label="Next cover" onClick={stepButton(1)}>
                      <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {embedded ? null : (
        <aside className="qt-panel-slot" aria-hidden={panelOpen ? undefined : "true"} inert={panelOpen ? undefined : true}>
          <QuadControls
            params={params}
            activePreset={activePreset}
            sourceName={sourceName}
            onChange={handleChange}
            onPreset={handlePreset}
            onSource={handleSource}
            onSave={handleSave}
            onReset={handleReset}
            note={note}
          />
        </aside>
      )}
    </Root>
  );
}
