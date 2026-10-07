"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";

import ClientOnly from "@/app/ui/ClientOnly";
import SlotNumber from "@/app/ui/SlotNumber";
import useCovers from "@/app/ui/useCovers";
import useNearViewport from "@/app/experiments/useNearViewport";
import { clearStored, copyParams, readParams, sanitise, storeParams } from "@/app/ui/paramStore";

import MarbleControls from "./MarbleControls";
import { TOOLS } from "./marbleOps";
import { DEFAULT_PRESET, MARBLE_DEFAULTS, MARBLE_PRESETS, presetValues, rerollValues } from "./marbleParams";
import "./marble.css";

const STORAGE_KEY = "herb:marble:params";
const INK_SLOTS = 12;
const NO_COUNTS = { drops: 0, pulls: 0, canUndo: false };

const loadScene = () => import("./MarbleScene");
if (typeof window !== "undefined") loadScene();

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
    return sanitise(JSON.parse(raw), MARBLE_DEFAULTS);
  } catch {
    return null;
  }
}

function PlateFallback() {
  return <div className="marble-fallback" />;
}

export default function MarbleExperience({ covers = [], embedded = false }) {
  const coverInput = useMemo(() => covers.slice(0, INK_SLOTS), [covers]);
  const items = useCovers(coverInput);
  const storedRaw = useSyncExternalStore(subscribeStorage, readStorage, readNothing);
  const reducedMotion = useSyncExternalStore(subscribeMotion, readMotion, readFalse);
  const storedParams = useMemo(() => (embedded ? null : parseStored(storedRaw)), [embedded, storedRaw]);

  const [edited, setEdited] = useState(null);
  const [activePreset, setActivePreset] = useState(DEFAULT_PRESET);
  const [activeRecipe, setActiveRecipe] = useState(DEFAULT_PRESET);
  const [tool, setTool] = useState("rake");
  const [nextInk, setNextInk] = useState(1);
  const [highlight, setHighlight] = useState(-1);
  const [counts, setCounts] = useState(NO_COUNTS);
  const [panelOpen, setPanelOpen] = useState(false);
  const [painted, setPainted] = useState(false);
  const [failure, setFailure] = useState(null);
  const [note, setNote] = useState(null);
  const [pop, setPop] = useState({ index: -1, beat: 0 });

  const params = edited ?? storedParams ?? MARBLE_DEFAULTS;
  const stageRef = useRef(null);
  const apiRef = useRef(null);
  const noteTimer = useRef(0);
  const near = useNearViewport(stageRef);
  const inkCount = Math.max(1, items.length);
  const ink = items.length ? nextInk % inkCount : 0;
  const nextItem = items[ink];
  const recipe = MARBLE_PRESETS.find((preset) => preset.name === activeRecipe)?.recipe ?? "bouquet";
  const toolsRef = useRef(null);

  const flash = useCallback((message) => {
    setNote(message);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 2600);
  }, []);

  const commitParams = useCallback(
    (next) => {
      setEdited(next);
      if (!embedded) storeParams(STORAGE_KEY, next);
    },
    [embedded],
  );

  const handleReady = useCallback((api) => {
    apiRef.current = api;
  }, []);

  const handleDropped = useCallback(
    (cover) => {
      setNextInk((cover + 1) % inkCount);
      setPop((previous) => ({ index: cover, beat: previous.beat + 1 }));
    },
    [inkCount],
  );

  const handleUndoDrop = useCallback((cover) => setNextInk(cover), []);
  const handlePainted = useCallback(() => setPainted(true), []);
  const handleError = useCallback((message) => setFailure(message), []);

  const handleChange = useCallback(
    (key, value) => {
      setActivePreset(null);
      commitParams({ ...params, [key]: value });
    },
    [commitParams, params],
  );

  const handlePreset = useCallback(
    (preset) => {
      const next = { ...presetValues(preset), paper: params.paper, lag: params.lag, dropSize: params.dropSize, seed: params.seed };
      setActivePreset(preset.name);
      setActiveRecipe(preset.name);
      commitParams(next);
      apiRef.current?.playPreset(preset.recipe, next.seed);
    },
    [commitParams, params],
  );

  const handleEmbeddedTap = useCallback(() => {
    const at = MARBLE_PRESETS.findIndex((preset) => preset.name === activeRecipe);
    handlePreset(MARBLE_PRESETS[(at + 1) % MARBLE_PRESETS.length]);
  }, [activeRecipe, handlePreset]);

  const handleReroll = useCallback(() => {
    const next = rerollValues(params, Math.random);
    commitParams(next);
    apiRef.current?.playPreset(recipe, next.seed);
  }, [commitParams, params, recipe]);

  const handleReset = useCallback(() => {
    setActivePreset(DEFAULT_PRESET);
    setActiveRecipe(DEFAULT_PRESET);
    setEdited(MARBLE_DEFAULTS);
    clearStored(STORAGE_KEY);
    apiRef.current?.playPreset("bouquet", MARBLE_DEFAULTS.seed);
    flash("Back to the Bouquet tray");
  }, [flash]);

  const handleCopy = useCallback(async () => {
    const ok = await copyParams(params);
    flash(ok ? "Settings copied" : "Could not reach the clipboard");
  }, [flash, params]);

  const handlePaste = useCallback(async () => {
    const next = await readParams(MARBLE_DEFAULTS);
    if (!next) {
      flash("That was not a Marble config");
      return;
    }
    setActivePreset(null);
    commitParams(next);
    flash("Settings applied");
  }, [commitParams, flash]);

  const handleToolKey = useCallback(
    (event) => {
      const at = TOOLS.findIndex((entry) => entry.id === tool);
      const moves = { ArrowLeft: at - 1, ArrowUp: at - 1, ArrowRight: at + 1, ArrowDown: at + 1, Home: 0, End: TOOLS.length - 1 };
      if (!(event.key in moves)) return;
      event.preventDefault();
      const next = (moves[event.key] + TOOLS.length) % TOOLS.length;
      setTool(TOOLS[next].id);
      toolsRef.current?.querySelectorAll('[role="radio"]')[next]?.focus();
    },
    [tool],
  );

  const handleSave = useCallback(() => apiRef.current?.save(), []);
  const handleUndo = useCallback(() => apiRef.current?.undo(), []);
  const handleLift = useCallback(() => apiRef.current?.lift(), []);

  const Root = embedded ? "div" : "main";
  const sceneReady = near && items.length > 0 && !failure;

  return (
    <Root
      className="marble-page"
      data-embedded={embedded ? "true" : undefined}
      data-panel={panelOpen && !embedded ? "open" : "closed"}
      data-painted={painted ? "true" : undefined}
    >
      {embedded ? null : (
        <header className="marble-head">
          <div className="marble-head__text">
            <h1 className="marble-title text-title-sm text-ink">Marble</h1>
            <p className="marble-hint text-ui-lg text-ink">Tap to drop a record on the water, drag to comb it into feathers.</p>
          </div>
          <div className="marble-head__tools">
            <div
              ref={toolsRef}
              className="marble-tools"
              role="radiogroup"
              aria-label="Tool"
              onKeyDown={handleToolKey}
              style={{ "--tool-index": TOOLS.findIndex((entry) => entry.id === tool) }}
            >
              <span className="marble-tools__pill" aria-hidden="true" />
              {TOOLS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="radio"
                  aria-checked={tool === entry.id}
                  tabIndex={tool === entry.id ? 0 : -1}
                  className="marble-tools__option text-ui"
                  data-active={tool === entry.id ? "true" : undefined}
                  onClick={() => setTool(entry.id)}
                  title={`${entry.label} (${entry.key})`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <button type="button" className="marble-button" onClick={handleUndo} disabled={!counts.canUndo}>
              Undo
            </button>
            <button type="button" className="marble-button" onClick={handleLift} disabled={!counts.canUndo}>
              Lift print
            </button>
            <button
              type="button"
              className="marble-button"
              aria-expanded={panelOpen}
              onClick={() => setPanelOpen((open) => !open)}
            >
              Controls
            </button>
          </div>
        </header>
      )}

      <div ref={stageRef} className="marble-plate" style={{ "--marble-paper": params.paper }}>
        {sceneReady ? (
          <ClientOnly
            load={loadScene}
            fallback={<PlateFallback />}
            items={items}
            params={params}
            tool={tool}
            nextInk={ink}
            highlight={highlight}
            reducedMotion={reducedMotion}
            embedded={embedded}
            preset={recipe}
            onReady={handleReady}
            onDropped={handleDropped}
            onUndoDrop={handleUndoDrop}
            onCounts={setCounts}
            onPainted={handlePainted}
            onError={handleError}
            onTool={setTool}
            onEmbeddedTap={handleEmbeddedTap}
          />
        ) : (
          <PlateFallback />
        )}
        {failure && items[0] ? (
          <div className="marble-failed">
            <span
              role="img"
              aria-label={`${items[0].title} by ${items[0].artist}`}
              className="marble-failed__disc"
              style={{ backgroundImage: `url("${items[0].image}")` }}
            />
          </div>
        ) : null}
      </div>

      {embedded ? null : (
        <footer className="marble-foot">
          <ul className="marble-inks" aria-label="Inks" data-scroll-contain>
            {items.length
              ? items.map((item, index) => (
                  <li key={item.id ?? index} className="marble-inks__item" style={{ "--ink-i": index }}>
                    <button
                      type="button"
                      className="marble-ink"
                      data-next={index === ink ? "true" : undefined}
                      data-pop={pop.index === index ? (pop.beat % 2 ? "a" : "b") : undefined}
                      aria-pressed={index === ink}
                      title={`${item.title} — ${item.artist}`}
                      aria-label={`${item.title} by ${item.artist}`}
                      onPointerEnter={() => setHighlight(index)}
                      onPointerLeave={() => setHighlight(-1)}
                      onFocus={() => setHighlight(index)}
                      onBlur={() => setHighlight(-1)}
                      onClick={() => setNextInk(index)}
                    >
                      <span className="marble-ink__image" style={{ backgroundImage: `url("${item.image}")` }} />
                    </button>
                  </li>
                ))
              : Array.from({ length: 6 }, (_, index) => <li key={index} className="marble-ink marble-ink--empty" />)}
          </ul>
          <div className="marble-next" aria-live="polite">
            {nextItem ? (
              <span key={nextItem.id ?? ink} className="marble-next__line">
                <span className="marble-next__title text-heading-sm text-ink">{nextItem.title}</span>
                <span className="marble-next__artist text-ui-lg text-ink">{nextItem.artist}</span>
              </span>
            ) : null}
          </div>
          <div className="marble-counts text-ui-lg text-ink" data-shown={counts.drops + counts.pulls > 0 ? "true" : undefined}>
            <span className="marble-count">
              <SlotNumber value={counts.drops} pad={2} className="marble-count__value" />
              <span>{counts.drops === 1 ? "drop" : "drops"}</span>
            </span>
            <span className="marble-count">
              <SlotNumber value={counts.pulls} pad={2} className="marble-count__value" />
              <span>{counts.pulls === 1 ? "pull" : "pulls"}</span>
            </span>
          </div>
        </footer>
      )}

      {embedded ? null : (
        <aside className="marble-panel-slot" aria-hidden={!panelOpen} inert={!panelOpen}>
          <MarbleControls
            params={params}
            activePreset={activePreset}
            note={note}
            onChange={handleChange}
            onPreset={handlePreset}
            onReroll={handleReroll}
            onReset={handleReset}
            onSave={handleSave}
            onCopy={handleCopy}
            onPaste={handlePaste}
            onClose={() => setPanelOpen(false)}
          />
        </aside>
      )}
    </Root>
  );
}
