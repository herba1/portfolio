"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import ClientOnly from "@/app/ui/ClientOnly";
import MorphText from "@/app/ui/MorphText";
import useNearViewport from "@/app/experiments/useNearViewport";

import FilingsControls from "./FilingsControls";
import { CHIP_COUNT, DEFAULT_LOOK, FALLBACK_CHIPS, FILINGS_DEFAULTS } from "./filingsParams";
import { sampleCover } from "./filingsSim";
import "./filings.css";

const loadScene = () => import("./FilingsScene");
if (typeof window !== "undefined") loadScene();

const FAILED = "failed";
const IDLE_FALLBACK_MS = 240;
const COMPACT_QUERY = "(max-width: 899px), (pointer: coarse)";
const NARROW_QUERY = "(max-width: 899px)";

function whenIdle(task) {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(task, { timeout: 1200 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(task, IDLE_FALLBACK_MS);
  return () => window.clearTimeout(handle);
}

function useMediaQuery(query) {
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
    () => false,
  );
}

function useCoverSamples(chips) {
  const [samples, setSamples] = useState({});
  const [fallbackFor, setFallbackFor] = useState(null);
  const loaderRef = useRef(null);
  const list = chips.length === 0 || fallbackFor === chips ? FALLBACK_CHIPS : chips;

  useEffect(() => {
    let alive = true;
    let failures = 0;
    const records = new Map();

    const settle = (cover, sample) => {
      const record = records.get(cover.id);
      if (!alive || !record || record.settled) return;
      record.settled = true;
      record.cancel?.();
      record.cancel = null;
      const result = sample ?? FAILED;
      if (result === FAILED) {
        failures += 1;
        if (failures === list.length && list !== FALLBACK_CHIPS) setFallbackFor(chips);
      }
      setSamples((previous) => ({ ...previous, [cover.id]: result }));
    };

    list.forEach((cover, index) => {
      const image = new Image();
      const record = { image, cancel: null, settled: false };
      records.set(cover.id, record);
      image.crossOrigin = "anonymous";
      image.decoding = "async";
      image.onload = () => {
        if (!alive || record.settled) return;
        if (index === 0) settle(cover, sampleCover(image));
        else record.cancel = whenIdle(() => settle(cover, sampleCover(image)));
      };
      image.onerror = () => settle(cover, null);
      image.src = cover.image;
    });

    loaderRef.current = (cover) => {
      const record = cover ? records.get(cover.id) : null;
      if (!record || record.settled) return;
      if (record.image.complete && record.image.naturalWidth > 0) settle(cover, sampleCover(record.image));
    };

    return () => {
      alive = false;
      loaderRef.current = null;
      for (const record of records.values()) {
        record.cancel?.();
        record.image.onload = null;
        record.image.onerror = null;
      }
    };
  }, [list, chips]);

  const sampleNow = useCallback((cover) => loaderRef.current?.(cover), []);

  return { list, samples, sampleNow };
}

function Placeholder() {
  return (
    <div className="filings-plate">
      <div className="filings-plate__canvas" />
    </div>
  );
}

export default function FilingsExperience({ covers = [], embedded = false }) {
  const chips = useMemo(() => covers.slice(0, CHIP_COUNT), [covers]);
  const { list, samples, sampleNow } = useCoverSamples(chips);
  const [request, setRequest] = useState({ index: 0, previous: 0 });
  const [look, setLook] = useState(DEFAULT_LOOK);
  const [params, setParams] = useState(FILINGS_DEFAULTS);
  const [count, setCount] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const compact = useMediaQuery(COMPACT_QUERY);
  const narrow = useMediaQuery(NARROW_QUERY);
  const apiRef = useRef(null);
  const stageRef = useRef(null);
  const near = useNearViewport(stageRef);

  const stateAt = (index) => (list[index] ? samples[list[index].id] : FAILED);
  const usableAt = (index) => {
    const state = stateAt(index);
    return Boolean(state) && state !== FAILED;
  };

  let shownIndex = request.index;
  if (!usableAt(request.index)) {
    if (usableAt(request.previous)) shownIndex = request.previous;
    else if (stateAt(request.index) === FAILED) {
      const found = list.findIndex((_, index) => usableAt(index));
      if (found >= 0) shownIndex = found;
    }
  }
  const sample = usableAt(shownIndex) ? samples[list[shownIndex].id] : null;
  const cover = list[shownIndex];
  const caption = cover ? `${cover.title} — ${cover.artist}` : "";

  const choose = (index) => {
    if (!list[index]) return;
    sampleNow(list[index]);
    setRequest({ index, previous: shownIndex });
  };

  const handleReady = useCallback((api) => {
    apiRef.current = api;
  }, []);

  const handleTapEmpty = () => {
    if (list.length) choose((request.index + 1) % list.length);
  };

  const handleChange = useCallback((key, value) => {
    setParams((previous) => ({ ...previous, [key]: value }));
  }, []);

  const handleShake = useCallback(() => apiRef.current?.shake(), []);

  const handleSave = useCallback(() => {
    const url = apiRef.current?.capture();
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = "filings.png";
    link.click();
  }, []);

  const handleReset = useCallback(() => {
    setParams(FILINGS_DEFAULTS);
    setLook(DEFAULT_LOOK);
    apiRef.current?.reset();
  }, []);

  const Root = embedded ? "div" : "main";

  return (
    <Root
      className="filings-page"
      data-embedded={embedded ? "true" : undefined}
      data-panel={panelOpen ? "open" : "closed"}
    >
      {embedded ? null : (
        <header className="filings-head">
          <h1 className="filings-title text-title-sm text-ink">Filings</h1>
          <p className="text-ui-lg text-ink-secondary">
            Drag the magnet through the cover. Tap it to flip, double-click the
            paper for another.
          </p>
        </header>
      )}

      <div ref={stageRef} className="filings-frame">
        {near ? (
          <ClientOnly
            load={loadScene}
            fallback={<Placeholder />}
            sample={sample}
            look={look}
            params={params}
            embedded={embedded}
            onReady={handleReady}
            onTapEmpty={handleTapEmpty}
            onCount={setCount}
          />
        ) : (
          <Placeholder />
        )}
      </div>

      {embedded ? null : (
        <div className="filings-foot">
          <p className="filings-caption text-ui-lg text-ink">
            <MorphText text={caption} />
          </p>
          <div className="filings-chips" role="radiogroup" aria-label="Cover">
            {list.map((chip, index) => {
              const state = samples[chip.id];
              const pending = index === request.index && index !== shownIndex && !state;
              return (
                <button
                  key={chip.id}
                  type="button"
                  role="radio"
                  aria-checked={index === shownIndex}
                  aria-label={`${chip.title} by ${chip.artist}`}
                  className="filings-chip"
                  data-active={index === shownIndex ? "true" : undefined}
                  data-loaded={state && state !== FAILED ? "true" : undefined}
                  data-pending={pending ? "true" : undefined}
                  disabled={state === FAILED}
                  style={{
                    "--chip-image": `url("${chip.image}")`,
                    "--chip-index": index,
                  }}
                  onClick={() => choose(index)}
                />
              );
            })}
          </div>
        </div>
      )}

      {embedded ? null : (
        <>
          <aside className="filings-panel-slot" aria-label="Controls" inert={narrow && !panelOpen}>
            <FilingsControls
              compact={compact}
              look={look}
              onLook={setLook}
              params={params}
              onChange={handleChange}
              count={count}
              tint={sample?.swatch ?? "#8a5a3c"}
              onShake={handleShake}
              onSave={handleSave}
              onReset={handleReset}
            />
          </aside>
          <button
            type="button"
            className="filings-panel-toggle text-ui text-ink"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((open) => !open)}
          >
            {panelOpen ? "Close" : "Controls"}
          </button>
        </>
      )}
    </Root>
  );
}
