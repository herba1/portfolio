"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import FrontEndRipgrepControls from "./FrontEndRipgrepControls";
import FrontEndRipgrepScene from "./FrontEndRipgrepScene";
import "./front-end-ripgrep.css";
import { DEFAULT_PARAMS, buildCommand, runSearch } from "./frontEndRipgrepParams";

function subscribeToViewport(callback) {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
}

function getWideViewport() {
  return window.innerWidth > 900;
}

function getWideViewportServer() {
  return true;
}

export default function FrontEndRipgrepExperience() {
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [activePreset, setActivePreset] = useState("TODO / FIXME");
  const [panelOverride, setPanelOverride] = useState(null);
  const wideViewport = useSyncExternalStore(subscribeToViewport, getWideViewport, getWideViewportServer);
  const panelOpen = panelOverride ?? wideViewport;

  const handleChange = useCallback((key, value) => {
    setActivePreset(null);
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handlePreset = useCallback((preset) => {
    setActivePreset(preset.label);
    setParams((prev) => ({
      ...prev,
      pattern: preset.pattern,
      mode: preset.mode,
      caseMode: preset.caseMode,
      wholeWord: preset.wholeWord,
      fileType: preset.fileType,
    }));
  }, []);

  const { groups, stats, error } = useMemo(() => runSearch(params), [params]);
  const command = useMemo(() => buildCommand(params), [params]);

  return (
    <main className="rg-page" data-panel={panelOpen ? "open" : "closed"}>
      <aside className="rg-panel-slot">
        <FrontEndRipgrepControls
          params={params}
          activePreset={activePreset}
          onChange={handleChange}
          onPreset={handlePreset}
        />
      </aside>

      <button
        type="button"
        className="rg-panel-toggle"
        onClick={() => setPanelOverride((prev) => !(prev ?? wideViewport))}
      >
        {panelOpen ? "Hide controls" : "Controls"}
      </button>

      <div className="rg-stage">
        <FrontEndRipgrepScene command={command} stats={stats} groups={groups} error={error} />
      </div>
    </main>
  );
}
