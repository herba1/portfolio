"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight } from "lucide-react";

import ClientOnly from "@/app/ui/ClientOnly";
import MorphText from "@/app/ui/MorphText";
import SlotNumber from "@/app/ui/SlotNumber";

import TaffyControls from "./TaffyControls";
import { DEFAULT_PRESET, pickTitles, presetValues } from "./taffyParams";
import { GEIST_ASCENT_EM, estimateProxy } from "./taffyProxy";
import "./taffy.css";

const loadScene = () => import("./TaffyScene");
if (typeof window !== "undefined") loadScene();

function useMedia(query, serverValue) {
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
    () => serverValue,
  );
}

const pad2 = (value) => String(value).padStart(2, "0");

function TitleProxy({ proxyRef, estimate, measured }) {
  return (
    <div ref={proxyRef} className="taffy__proxy font-sans" style={estimate.style} aria-hidden="true">
      {measured ? (
        <div className="taffy__proxy-set" data-set="measured" style={{ "--taffy-size": `${measured.F}px` }}>
          {measured.rows.map((row, rowIndex) => (
            <span
              key={`${row.text}-${rowIndex}`}
              className="taffy__proxy-row"
              style={{ "--taffy-x": `${row.x}px`, "--taffy-y": `${row.baseline - GEIST_ASCENT_EM * measured.F}px` }}
            >
              {row.text}
            </span>
          ))}
        </div>
      ) : (
        <>
          <div className="taffy__proxy-set" data-set="wide">
            <span className="taffy__proxy-row">{estimate.whole}</span>
          </div>
          <div className="taffy__proxy-set" data-set="narrow" data-rows={estimate.narrow.length}>
            {estimate.narrow.map((text, rowIndex) => (
              <span key={`${text}-${rowIndex}`} className="taffy__proxy-row" data-row={rowIndex}>
                {text}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function TaffyExperience({ covers, embedded = false }) {
  const titles = useMemo(() => pickTitles(covers), [covers]);
  const proxyRef = useRef(null);
  const [index, setIndex] = useState(0);
  const [params, setParams] = useState(() => presetValues(DEFAULT_PRESET));
  const [activePreset, setActivePreset] = useState(DEFAULT_PRESET.name);
  const [panelOverride, setPanelOverride] = useState(null);
  const [measured, setMeasured] = useState(null);
  const [shownTitle, setShownTitle] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [settled, setSettled] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const reducedMotion = useMedia("(prefers-reduced-motion: reduce)", false);

  const count = titles.length;
  const shownIndex = unsupported || shownTitle === null ? -1 : titles.findIndex((title) => title.title === shownTitle);
  const captionIndex = shownIndex >= 0 ? shownIndex : index;
  const entry = titles[captionIndex] ?? titles[0];
  const requested = titles[index] ?? titles[0];
  const estimate = useMemo(() => estimateProxy(requested?.title ?? ""), [requested]);
  const panelOpen = panelOverride ?? false;
  const captionTop = measured ? Math.round(measured.bottom + Math.max(32, measured.F * 0.34)) : null;

  const advance = useCallback(
    (delta) => {
      if (!count) return;
      setIndex((value) => (value + delta + count) % count);
    },
    [count],
  );

  const handleLayout = useCallback((summary) => setMeasured(summary), []);
  const handleTitleShown = useCallback((text) => setShownTitle(text), []);
  const handleSettled = useCallback(() => setSettled(true), []);
  const handleUnsupported = useCallback(() => setUnsupported(true), []);
  const handleReady = useCallback(() => {
    const running = proxyRef.current?.getAnimations?.() ?? [];
    Promise.all(running.map((animation) => animation.finished.catch(() => null))).then(() => setRevealed(true));
  }, []);

  useEffect(() => {
    const handleKey = (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (target?.classList?.contains("taffy-stage__letter")) return;
      if (target?.closest?.(".taffy-panel")) return;
      if (event.key === "ArrowRight") advance(1);
      else if (event.key === "ArrowLeft") advance(-1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [advance]);

  const handleParam = useCallback((key, value) => {
    setParams((current) => ({ ...current, [key]: value }));
    setActivePreset(null);
  }, []);

  const handlePreset = useCallback((preset) => {
    setParams(presetValues(preset));
    setActivePreset(preset.name);
  }, []);

  const Root = embedded ? "div" : "main";

  return (
    <Root
      className="taffy"
      data-embedded={embedded ? "true" : undefined}
      data-ready={revealed ? "true" : undefined}
      data-settled={settled || unsupported ? "true" : undefined}
    >
      <h1 className="taffy__sr">{entry ? `${entry.title} by ${entry.artist}` : "Taffy"}</h1>

      {!embedded ? (
        <header className="taffy__head">
          <p className="text-heading">Taffy</p>
          <p className="text-ui text-ink-secondary">Grab a letter and pull until it snaps. Tap the paper for the next title.</p>
        </header>
      ) : null}

      <div className="taffy__plate">
        <TitleProxy proxyRef={proxyRef} estimate={estimate} measured={measured} />
        {unsupported ? null : (
          <ClientOnly
            load={loadScene}
            titles={titles}
            index={index}
            params={params}
            reducedMotion={reducedMotion}
            embedded={embedded}
            revealed={revealed}
            onAdvance={advance}
            onReady={handleReady}
            onLayout={handleLayout}
            onSettled={handleSettled}
            onTitleShown={handleTitleShown}
            onUnsupported={handleUnsupported}
          />
        )}
      </div>

      {entry ? (
        <div className="taffy__caption" style={captionTop === null ? undefined : { "--taffy-caption-top": `${captionTop}px` }}>
          <span key={entry.id} className="taffy__cover" style={entry.image ? { backgroundImage: `url("${entry.image}")` } : undefined} aria-hidden="true" />
          <MorphText className="taffy__song text-ui" text={`${entry.title} — ${entry.artist}`} />
          <button type="button" className="taffy__next text-ui tabular-nums" onClick={() => advance(1)} aria-label={`Next title, ${captionIndex + 1} of ${count}`}>
            <SlotNumber value={`${pad2(captionIndex + 1)} / ${pad2(count)}`} label="" />
            <ArrowRight className="taffy__next-arrow" size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {!embedded ? (
        <TaffyControls
          params={params}
          activePreset={activePreset}
          open={panelOpen ? "open" : "closed"}
          onToggle={() => setPanelOverride(!panelOpen)}
          onChange={handleParam}
          onPreset={handlePreset}
        />
      ) : null}
    </Root>
  );
}
