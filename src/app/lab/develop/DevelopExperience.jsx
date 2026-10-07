"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import ClientOnly from "@/app/ui/ClientOnly";
import MorphText from "@/app/ui/MorphText";
import SlotNumber from "@/app/ui/SlotNumber";
import useNearViewport from "@/app/experiments/useNearViewport";

import DevelopControls, { DevelopTitle } from "./DevelopControls";
import { NegativeStrip, PrintLine } from "./DevelopBench";
import {
  DEVELOP_DEFAULTS,
  applyPreset,
  readStoredParams,
  resetStoredParams,
  serverParams,
  subscribeParams,
  writeStoredParams,
} from "./developParams";
import { buildSources, loadSource, warmSource } from "./developSources";
import "./develop.css";

const loadStage = () => import("./DevelopStage");
if (typeof window !== "undefined") loadStage();

const THUMB_LANDING_MS = 280;
const MAX_PRINTS = 24;
const MIN_PRINT_SECONDS = 1;
const WARM_DELAY_MS = 900;
const WARM_AHEAD = 2;
const NO_FAILURES = [];

const TILT_QUERY = "(pointer: coarse)";

function subscribeTilt(callback) {
  const query = window.matchMedia(TILT_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function readTilt() {
  return window.matchMedia(TILT_QUERY).matches && typeof window.DeviceOrientationEvent !== "undefined";
}

function readNoTilt() {
  return false;
}

function formatClock(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function nextAfter(all, failed, id) {
  const from = all.findIndex((item) => item.id === id);
  for (let step = 1; step <= all.length; step += 1) {
    const candidate = all[(from + step + all.length) % all.length];
    if (!failed.has(candidate.id)) return candidate.id;
  }
  return null;
}

function revoke(urls, print) {
  for (const url of [print.thumb, print.full]) {
    if (!url) continue;
    URL.revokeObjectURL(url);
    urls.delete(url);
  }
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "print";
}

export default function DevelopExperience({ covers = [], embedded = false }) {
  const allSources = useMemo(() => buildSources(covers), [covers]);
  const [failedIds, setFailedIds] = useState(NO_FAILURES);
  const sources = useMemo(
    () => (failedIds.length ? allSources.filter((item) => !failedIds.includes(item.id)) : allSources),
    [allSources, failedIds],
  );
  const storedParams = useSyncExternalStore(subscribeParams, readStoredParams, serverParams);
  const [localParams, setLocalParams] = useState(DEVELOP_DEFAULTS);
  const params = embedded ? localParams : storedParams;

  const [sourceId, setSourceId] = useState(null);
  const [prints, setPrints] = useState([]);
  const [fogging, setFogging] = useState(false);
  const [failure, setFailure] = useState(null);
  const [stageKey, setStageKey] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [tiltOn, setTiltOn] = useState(false);
  const tiltAvailable = useSyncExternalStore(subscribeTilt, readTilt, readNoTilt);

  const slotRef = useRef(null);
  const apiRef = useRef(null);
  const printCountRef = useRef(0);
  const printsRef = useRef([]);
  const secondsRef = useRef(0);
  const urlsRef = useRef(new Set());
  const timersRef = useRef(new Set());
  const failedRef = useRef(new Set());
  const requestRef = useRef(0);
  const sourceIdRef = useRef(null);
  const stageRef = useRef(null);
  const near = useNearViewport(stageRef);

  const source = sources.find((item) => item.id === sourceId) ?? sources[0] ?? allSources[0];

  useEffect(() => {
    sourceIdRef.current = source.id;
  }, [source.id]);

  useEffect(() => {
    const urls = urlsRef.current;
    const timers = timersRef.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  const setParams = useCallback(
    (update) => {
      if (embedded) {
        setLocalParams(update);
        return;
      }
      writeStoredParams(update(readStoredParams()));
    },
    [embedded],
  );

  const handleChange = useCallback(
    (key, value) => setParams((current) => ({ ...current, [key]: value, preset: "" })),
    [setParams],
  );

  const handlePreset = useCallback((preset) => setParams((current) => applyPreset(current, preset)), [setParams]);

  const handleStats = useCallback(({ seconds, fogging: fog }) => {
    secondsRef.current = seconds;
    slotRef.current?.setValue(formatClock(seconds));
    setFogging(fog);
  }, []);

  const handleApi = useCallback((api) => {
    apiRef.current = api;
  }, []);

  const later = useCallback((callback, delay) => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      callback();
    }, delay);
    timersRef.current.add(timer);
  }, []);

  const markFailed = useCallback((id) => {
    if (failedRef.current.has(id)) return;
    failedRef.current.add(id);
    setFailedIds(Array.from(failedRef.current));
  }, []);

  const handleFailure = useCallback(
    (reason, id) => {
      if (reason === "lost") {
        setStageKey((key) => key + 1);
        return;
      }
      if (reason === "source") {
        markFailed(id);
        return;
      }
      setFailure("webgl");
    },
    [markFailed],
  );

  const handleReady = useCallback(() => {
    later(() => {
      let id = sourceIdRef.current;
      for (let step = 0; step < WARM_AHEAD; step += 1) {
        id = nextAfter(allSources, failedRef.current, id);
        const upcoming = allSources.find((item) => item.id === id);
        if (upcoming) warmSource(upcoming);
      }
    }, WARM_DELAY_MS);
  }, [allSources, later]);

  const keepPrint = useCallback(
    (files, label, developed) => {
      if (!files) return;
      const urls = urlsRef.current;
      urls.add(files.full);
      urls.add(files.thumb);
      if (embedded || developed < MIN_PRINT_SECONDS) {
        revoke(urls, files);
        return;
      }
      later(() => {
        printCountRef.current += 1;
        const print = { id: `print-${printCountRef.current}`, thumb: files.thumb, full: files.full, label, time: formatClock(developed) };
        const next = [print, ...printsRef.current];
        for (const dropped of next.slice(MAX_PRINTS)) revoke(urls, dropped);
        printsRef.current = next.slice(0, MAX_PRINTS);
        setPrints(printsRef.current);
      }, THUMB_LANDING_MS);
    },
    [embedded, later],
  );

  const retireTo = useCallback(
    (nextId, keepTrying) => {
      if (!nextId) return;
      requestRef.current += 1;
      const request = requestRef.current;
      const currentId = source.id;
      const label = source.label;

      const attempt = (id) => {
        const upcoming = allSources.find((item) => item.id === id);
        if (!upcoming) return;
        loadSource(upcoming).then(
          (loaded) => {
            if (request !== requestRef.current) return;
            const api = apiRef.current;
            const developed = secondsRef.current;
            setSourceId(id);
            if (api) api.retire(loaded).then((files) => keepPrint(files, label, developed));
          },
          () => {
            markFailed(id);
            if (!keepTrying || request !== requestRef.current) return;
            const following = nextAfter(allSources, failedRef.current, id);
            if (following && following !== currentId) attempt(following);
          },
        );
      };

      attempt(nextId);
    },
    [allSources, source, keepPrint, markFailed],
  );

  const handleNext = useCallback(() => {
    retireTo(nextAfter(allSources, failedRef.current, source.id), true);
  }, [retireTo, allSources, source.id]);

  const handlePick = useCallback((id) => retireTo(id, false), [retireTo]);

  const handleSave = useCallback(() => {
    apiRef.current?.save(`develop-${slugify(source.label)}`);
  }, [source]);

  const handleReset = useCallback(() => {
    if (embedded) setLocalParams(DEVELOP_DEFAULTS);
    else resetStoredParams();
    apiRef.current?.fresh();
  }, [embedded]);

  const handleSavePrint = useCallback((print) => {
    const link = document.createElement("a");
    link.href = print.full;
    link.download = `develop-${slugify(print.label)}.jpg`;
    link.click();
  }, []);

  const handleTilt = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    if (tiltOn) {
      api.setGyro(false);
      setTiltOn(false);
      return;
    }
    const Orientation = window.DeviceOrientationEvent;
    if (Orientation && typeof Orientation.requestPermission === "function") {
      try {
        const answer = await Orientation.requestPermission();
        if (answer !== "granted") return;
      } catch {
        return;
      }
    }
    api.setGyro(true);
    setTiltOn(true);
  }, [tiltOn]);

  const Root = embedded ? "div" : "main";
  const paperStyle = { "--develop-paper": params.paper, "--develop-silver": params.silver };

  const fallbackPlate = (
    <div className="develop-plate develop-plate--waiting" aria-hidden="true">
      <div className="develop-paper" />
    </div>
  );

  const failedPlate = (
    <div className="develop-plate develop-plate--failed">
      <div className="develop-paper">
        <div className="develop-still" style={{ "--still-image": `url("${source.src}")` }} />
      </div>
      <p className="develop-failed text-ui-sm">This darkroom needs WebGL2.</p>
    </div>
  );

  const plate = failure ? (
    failedPlate
  ) : near ? (
    <ClientOnly
      key={stageKey}
      load={loadStage}
      fallback={fallbackPlate}
      source={source}
      params={params}
      embedded={embedded}
      label={source.label}
      onApi={handleApi}
      onStats={handleStats}
      onFailure={handleFailure}
      onNext={handleNext}
      onReady={handleReady}
    />
  ) : (
    fallbackPlate
  );

  return (
    <Root
      className="develop"
      data-embedded={embedded ? "" : undefined}
      data-panel={panelOpen ? "open" : "closed"}
      style={paperStyle}
    >
      {embedded ? null : (
        <aside className="develop-panel" aria-label="Darkroom controls">
          <DevelopControls
            params={params}
            onChange={handleChange}
            onPreset={handlePreset}
            onSave={handleSave}
            onReset={handleReset}
            onClose={panelOpen ? () => setPanelOpen(false) : null}
          />
        </aside>
      )}

      <section className="develop-stage">
        {embedded ? null : <DevelopTitle className="develop-head--stage" />}
        <div className="develop-bench">
          {embedded ? null : <NegativeStrip sources={sources} activeId={source.id} onPick={handlePick} />}

          <div className="develop-center">
            <div ref={stageRef} className="develop-slot">
              {plate}
            </div>

            {embedded ? null : (
              <div className="develop-meta">
                <div className="develop-readout">
                  <SlotNumber ref={slotRef} value="0:00" className="develop-clock text-title-sm" label="Development time" />
                  <span className="develop-readout__labels">
                    <MorphText text={source.label} className="develop-readout__name text-ui" />
                    <MorphText text={fogging ? "Fogging" : "Developing"} className="develop-readout__status text-ui-sm" />
                  </span>
                </div>
                <div className="develop-meta__actions">
                  {tiltAvailable ? (
                    <button
                      type="button"
                      className="develop-button text-ui"
                      data-active={tiltOn ? "true" : undefined}
                      aria-pressed={tiltOn}
                      onClick={handleTilt}
                    >
                      Use tilt
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="develop-button develop-button--panel text-ui"
                    aria-expanded={panelOpen}
                    onClick={() => setPanelOpen((open) => !open)}
                  >
                    Controls
                  </button>
                  <button type="button" className="develop-button develop-button--primary text-ui" onClick={handleNext}>
                    Next sheet
                  </button>
                </div>
              </div>
            )}
          </div>

          {embedded ? null : <PrintLine prints={prints} onSave={handleSavePrint} />}
        </div>
      </section>
    </Root>
  );
}
