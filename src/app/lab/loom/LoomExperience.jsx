"use client";

import {
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import ClientOnly from "@/app/ui/ClientOnly";
import SlotNumber from "@/app/ui/SlotNumber";

import LoomControls from "./LoomControls";
import {
  DEFAULTS,
  PRESETS,
  THREADS_NARROW,
  THREADS_WIDE,
  presetFor,
} from "./loomParams";
import "./loom.css";

const loadStage = () => import("./LoomStage");
if (typeof window !== "undefined") loadStage();

const NARROW_QUERY = "(max-width: 899px)";
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function mediaStore(query) {
  return {
    subscribe(callback) {
      const media = window.matchMedia(query);
      media.addEventListener("change", callback);
      return () => media.removeEventListener("change", callback);
    },
    snapshot() {
      return window.matchMedia(query).matches;
    },
    server() {
      return false;
    },
  };
}

const FAILURE_NOTES = {
  webgl: "This loom needs WebGL2, so the cover sits flat.",
  shader: "The loom could not thread on this device, so the cover sits flat.",
  lost: "The graphics card dropped the loom, so the cover sits flat for now.",
};

const RETRYABLE = new Set(["shader", "lost"]);

const narrowStore = mediaStore(NARROW_QUERY);
const reducedStore = mediaStore(REDUCED_QUERY);

function pad(value) {
  return String(value).padStart(2, "0");
}

function isTyping(target) {
  if (!target || !(target instanceof Element)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, [role=radio]"));
}

export default function LoomExperience({ covers = [] }) {
  const narrow = useSyncExternalStore(
    narrowStore.subscribe,
    narrowStore.snapshot,
    narrowStore.server,
  );
  const reducedMotion = useSyncExternalStore(
    reducedStore.subscribe,
    reducedStore.snapshot,
    reducedStore.server,
  );
  const [nav, setNav] = useState({ index: 0, direction: 1, turn: 0, leaving: null });
  const [params, setParams] = useState(DEFAULTS);
  const [panelOpen, setPanelOpen] = useState(false);
  const [paintedFor, setPaintedFor] = useState(null);
  const [failure, setFailure] = useState(null);
  const engineRef = useRef(null);

  const count = covers.length;
  const cover = count ? covers[nav.index] : null;
  const previous = count ? covers[(nav.index - 1 + count) % count] : null;
  const next = count ? covers[(nav.index + 1) % count] : null;
  const threads = params.threads ?? (narrow ? THREADS_NARROW : THREADS_WIDE);
  const stageKey = `${reducedMotion ? "still" : "live"}`;
  const painted = paintedFor === stageKey;

  const stageParams = useMemo(
    () => ({
      weave: params.weave,
      threads,
      tension: params.tension,
      coupling: params.coupling,
      damping: params.damping,
      sound: params.sound,
    }),
    [
      params.weave,
      threads,
      params.tension,
      params.coupling,
      params.damping,
      params.sound,
    ],
  );

  const primeAudio = useCallback((force = false) => {
    engineRef.current?.primeAudio(force);
  }, []);

  const go = useCallback(
    (direction) => {
      if (count < 2) return;
      primeAudio();
      setNav((state) => ({
        index: (state.index + direction + count) % count,
        direction,
        turn: state.turn + 1,
        leaving: { cover: covers[state.index], direction, turn: state.turn },
      }));
    },
    [count, covers, primeAudio],
  );

  const dropLeaving = useCallback((event) => {
    if (event.target !== event.currentTarget) return;
    setNav((state) => (state.leaving ? { ...state, leaving: null } : state));
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (
        event.defaultPrevented ||
        event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (isTyping(event.target)) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go]);

  const onPainted = useCallback(() => setPaintedFor(stageKey), [stageKey]);
  const onError = useCallback((kind) => setFailure(kind), []);
  const onEngine = useCallback((engine) => {
    engineRef.current = engine;
  }, []);

  const retry = useCallback(() => {
    setPaintedFor(null);
    setFailure(null);
  }, []);

  const change = useCallback((patch) => {
    setParams((state) => {
      const merged = { ...state, ...patch };
      return { ...merged, preset: presetFor(merged) };
    });
  }, []);

  const pickPreset = useCallback((id) => {
    const preset = PRESETS.find((entry) => entry.id === id);
    if (!preset) return;
    setParams((state) => ({ ...state, ...preset.values, preset: id }));
  }, []);

  const toggleSound = useCallback(() => {
    primeAudio(true);
    setParams((state) => ({ ...state, sound: !state.sound }));
  }, [primeAudio]);

  const togglePanel = useCallback(() => {
    setPanelOpen((open) => !open);
    if (panelOpen || !narrow) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document
          .getElementById("loom-panel")
          ?.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
      });
    });
  }, [panelOpen, narrow, reducedMotion]);

  const showStage = count > 0 && !failure;

  return (
    <main
      className="loom bg-surface text-ink"
      data-painted={painted ? "1" : undefined}
    >
      <header className="loom-head">
        <h1 className="loom-title text-title-sm text-ink">Loom</h1>
        <p className="loom-hint text-ui-lg text-ink-secondary">
          Pull a thread. Across for a row, down for a column.
        </p>
      </header>

      <div className="loom-frame">
        <div
          className="loom-blank"
          aria-hidden="true"
          style={{ "--loom-threads": threads }}
        />
        {failure && cover ? (
          <div
            className="loom-flat"
            style={{ backgroundImage: `url("${cover.image}")` }}
            role="img"
            aria-label={`${cover.title} by ${cover.artist}`}
          />
        ) : null}
        {showStage ? (
          <div className="loom-reveal">
            <ClientOnly
              load={loadStage}
              covers={covers}
              index={nav.index}
              direction={nav.direction}
              params={stageParams}
              reducedMotion={reducedMotion}
              onPainted={onPainted}
              onError={onError}
              onEngine={onEngine}
            />
          </div>
        ) : null}
        {!count ? (
          <p className="loom-note text-ui-lg text-ink">
            No covers to weave right now.
          </p>
        ) : null}
        {failure ? (
          <div className="loom-note">
            <p className="text-ui-lg text-ink">
              {FAILURE_NOTES[failure] ?? FAILURE_NOTES.shader}
            </p>
            {RETRYABLE.has(failure) ? (
              <button
                type="button"
                className="loom-retry text-ui text-ink"
                onClick={retry}
              >
                Rethread
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <section className="loom-caption" aria-label="Now woven">
        <div className="loom-track-slot" aria-live="polite">
          {nav.leaving && !reducedMotion ? (
            <div
              className="loom-track loom-track--leaving"
              key={`leaving-${nav.leaving.turn}`}
              style={{ "--loom-dir": nav.leaving.direction }}
              aria-hidden="true"
              onAnimationEnd={dropLeaving}
            >
              <p className="loom-track__title text-heading text-ink">
                {nav.leaving.cover.title}
              </p>
              <p className="loom-track__artist text-ui-lg text-ink-secondary">
                {nav.leaving.cover.artist}
              </p>
            </div>
          ) : null}
          {cover ? (
            <div
              className="loom-track"
              key={`${cover.id}-${nav.index}`}
              style={{ "--loom-dir": nav.direction }}
            >
              <p className="loom-track__title text-heading text-ink">
                {cover.title}
              </p>
              <p className="loom-track__artist text-ui-lg text-ink-secondary">
                {cover.artist}
              </p>
            </div>
          ) : null}
        </div>
        <div className="loom-nav">
          <button
            type="button"
            className="loom-chip"
            onClick={() => go(-1)}
            disabled={count < 2}
            aria-label={previous ? `Previous: ${previous.title}` : "Previous"}
          >
            <ChevronLeft className="loom-chip__icon" aria-hidden="true" />
            {previous ? (
              <span
                className="loom-chip__thumb"
                key={previous.id}
                style={{ backgroundImage: `url("${previous.thumb ?? previous.image}")` }}
              />
            ) : null}
          </button>
          <span className="loom-count text-ui text-ink">
            <SlotNumber
              value={`${pad(nav.index + 1)} / ${pad(Math.max(count, 1))}`}
              direction={nav.direction > 0 ? "up" : "down"}
              label={`Cover ${nav.index + 1} of ${count}`}
            />
          </span>
          <button
            type="button"
            className="loom-chip"
            onClick={() => go(1)}
            disabled={count < 2}
            aria-label={next ? `Next: ${next.title}` : "Next"}
          >
            {next ? (
              <span
                className="loom-chip__thumb"
                key={next.id}
                style={{ backgroundImage: `url("${next.thumb ?? next.image}")` }}
              />
            ) : null}
            <ChevronRight className="loom-chip__icon" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="loom-round"
            onClick={toggleSound}
            aria-pressed={params.sound}
            aria-label={params.sound ? "Mute plucks" : "Unmute plucks"}
          >
            <span
              className="loom-round__icon"
              key={params.sound ? "on" : "off"}
            >
              {params.sound ? (
                <Volume2 aria-hidden="true" />
              ) : (
                <VolumeX aria-hidden="true" />
              )}
            </span>
          </button>
          <button
            type="button"
            className="loom-round loom-tune"
            onClick={togglePanel}
            aria-expanded={panelOpen}
            aria-controls="loom-panel"
            aria-label="Tune the cloth"
            data-active={panelOpen ? "1" : undefined}
          >
            <SlidersHorizontal aria-hidden="true" />
          </button>
        </div>
      </section>

      <LoomControls
        id="loom-panel"
        params={params}
        threads={threads}
        presetId={params.preset}
        onPreset={pickPreset}
        onChange={change}
        open={panelOpen}
      />
    </main>
  );
}
