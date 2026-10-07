"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

import ClientOnly from "@/app/ui/ClientOnly";
import SlotNumber from "@/app/ui/SlotNumber";
import useNearViewport from "@/app/experiments/useNearViewport";

import ScorchControls from "./ScorchControls";
import { DEFAULT_PRESET, SCORCH_DEFAULTS, presetValues } from "./scorchParams";
import "./scorch.css";

const loadStage = () => import("./ScorchStage");
if (typeof window !== "undefined") loadStage();

const ERRORS = {
  webgl2: "This needs WebGL 2 to burn, and this browser does not offer it.",
  float: "This device cannot hold the heat map the fire needs.",
  covers: "The covers would not load, so there is nothing to burn.",
  lost: "The graphics context was lost.",
  shader: "The fire shader would not compile on this device.",
};

function subscribeQuery(query) {
  return (callback) => {
    const list = window.matchMedia(query);
    list.addEventListener("change", callback);
    return () => list.removeEventListener("change", callback);
  };
}

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
const NARROW_QUERY = "(max-width: 900px)";
const subscribeReduced = subscribeQuery(REDUCED_QUERY);
const subscribeNarrow = subscribeQuery(NARROW_QUERY);
const readReduced = () => window.matchMedia(REDUCED_QUERY).matches;
const readNarrow = () => window.matchMedia(NARROW_QUERY).matches;
const readFalse = () => false;

function Plate({ children }) {
  return <div className="scorch-plate scorch-plate--placeholder">{children}</div>;
}

function LoadingPlate() {
  return (
    <Plate>
      <div className="scorch-plate__fuse" aria-hidden="true">
        <span className="scorch-plate__fuse-line" />
      </div>
    </Plate>
  );
}

export default function ScorchExperience({ covers = [], embedded = false }) {
  const [params, setParams] = useState(SCORCH_DEFAULTS);
  const [activePreset, setActivePreset] = useState(DEFAULT_PRESET);
  const [sheet, setSheet] = useState({ index: 0, under: 1 });
  const [status, setStatus] = useState("loading");
  const [errorReason, setErrorReason] = useState(null);
  const [panelChoice, setPanelChoice] = useState(null);
  const [soundOn, setSoundOn] = useState(true);
  const [stageKey, setStageKey] = useState(0);

  const reducedMotion = useSyncExternalStore(subscribeReduced, readReduced, readFalse);
  const narrow = useSyncExternalStore(subscribeNarrow, readNarrow, readFalse);
  const panelOpen = panelChoice ?? !narrow;

  const stageWrapRef = useRef(null);
  const stageRef = useRef(null);
  const burntRef = useRef(null);
  const near = useNearViewport(stageWrapRef);

  const handleSheet = useCallback((index, under) => {
    setSheet({ index, under });
  }, []);

  const handleBurnt = useCallback((fraction) => {
    burntRef.current?.setValue(String(Math.min(100, Math.round(fraction * 100))));
  }, []);

  const handleReady = useCallback(() => setStatus("ready"), []);

  const handleError = useCallback((reason) => {
    setErrorReason(reason);
    setStatus("error");
  }, []);

  const handleRetry = useCallback(() => {
    setErrorReason(null);
    setStatus("loading");
    setStageKey((key) => key + 1);
  }, []);

  const handlePreset = useCallback((name) => {
    setActivePreset(name);
    setParams(presetValues(name));
  }, []);

  const handleChange = useCallback((key, value) => {
    setActivePreset(null);
    setParams((previous) => ({ ...previous, [key]: value }));
  }, []);

  const handleDouse = useCallback(() => stageRef.current?.douse(), []);
  const handleSkip = useCallback(() => stageRef.current?.skip(), []);
  const handleSound = useCallback(() => {
    stageRef.current?.wakeSound();
    setSoundOn((on) => !on);
  }, []);

  const Root = embedded ? "div" : "main";
  const empty = covers.length === 0;
  const current = covers[sheet.index] ?? covers[0];
  const next = covers[sheet.under] ?? covers[1] ?? current;

  let stage;
  if (empty) {
    stage = (
      <Plate>
        <p className="scorch-plate__note text-ui-lg text-ink">Nothing has played recently, so there is nothing to burn.</p>
      </Plate>
    );
  } else if (status === "error") {
    stage = (
      <Plate>
        <div
          className="scorch-plate__still"
          role="img"
          aria-label={`${current.title} by ${current.artist}`}
          style={{ backgroundImage: `url("${current.image}")` }}
        />
        <div className="scorch-plate__error">
          <p className="text-ui-lg text-ink">{ERRORS[errorReason] ?? ERRORS.shader}</p>
          {errorReason === "lost" ? (
            <button type="button" className="scorch-action text-ui-lg" onClick={handleRetry}>
              Try again
            </button>
          ) : null}
        </div>
      </Plate>
    );
  } else if (near) {
    stage = (
      <ClientOnly
        key={stageKey}
        load={loadStage}
        fallback={<LoadingPlate />}
        ref={stageRef}
        covers={covers}
        params={params}
        soundOn={soundOn}
        embedded={embedded}
        reducedMotion={reducedMotion}
        onSheet={handleSheet}
        onBurnt={handleBurnt}
        onReady={handleReady}
        onError={handleError}
      />
    );
  } else {
    stage = <LoadingPlate />;
  }

  return (
    <Root className="scorch" data-embedded={embedded ? "1" : undefined} data-status={status}>
      <div className="scorch-body" data-panel={panelOpen && !embedded ? "open" : "closed"}>
        {embedded ? null : (
          <header className="scorch-head">
            <h1 className="text-title-sm text-ink">Scorch</h1>
            <p className="text-ui-lg text-ink-secondary">Hold still on the cover until it catches, then drag to fan the fire.</p>
          </header>
        )}
        <section className="scorch-stage" aria-label="Burning cover">
          <div ref={stageWrapRef} className="scorch-stage__plate">
            {stage}
          </div>
          {empty ? null : (
            <div className="scorch-caption">
              <div className="scorch-caption__track" key={`${sheet.index}-${current?.id}`}>
                <p className="scorch-caption__title text-heading text-ink">
                  {current.title} <span className="scorch-caption__artist">— {current.artist}</span>
                </p>
                <p className="text-ui-lg text-ink-secondary">Underneath: {next.title}</p>
              </div>
              <p className="scorch-caption__burnt text-title-sm text-ink">
                <SlotNumber ref={burntRef} value="0" />
                <span className="scorch-caption__unit text-ui-lg text-ink-secondary">% burnt</span>
              </p>
            </div>
          )}
        </section>
        {embedded ? null : (
          <aside className="scorch-panel" aria-label="Paper and fire">
            <button
              type="button"
              className="scorch-panel__toggle text-ui-lg"
              aria-expanded={panelOpen}
              onClick={() => setPanelChoice(!panelOpen)}
            >
              <span>Paper and fire</span>
              <span className="scorch-panel__chevron" aria-hidden="true" />
            </button>
            <div className="scorch-panel__body" data-open={panelOpen ? "1" : undefined}>
              <div className="scorch-panel__inner">
                <ScorchControls
                  params={params}
                  activePreset={activePreset}
                  soundOn={soundOn}
                  onPreset={handlePreset}
                  onChange={handleChange}
                  onDouse={handleDouse}
                  onSkip={handleSkip}
                  onSound={handleSound}
                />
              </div>
            </div>
          </aside>
        )}
      </div>
    </Root>
  );
}
