"use client";

import { useCallback, useEffect, useState } from "react";

import ClientOnly from "@/app/ui/ClientOnly";

import GalaxiumControls from "./GalaxiumControls";
import "./galaxium.css";
import { DEFAULT_PRESET, GALAXIUM_DEFAULTS, presetValues, rerollValues } from "./galaxiumParams";

export default function GalaxiumExperimentalWebgpuSpaceExperience() {
  const [params, setParams] = useState(GALAXIUM_DEFAULTS);
  const [activePreset, setActivePreset] = useState(DEFAULT_PRESET);
  const [panelOpen, setPanelOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth > 900,
  );
  const [frameloop, setFrameloop] = useState("always");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onVisibility = () => setFrameloop(document.hidden ? "never" : "always");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const handleChange = useCallback((key, value) => {
    setActivePreset(null);
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handlePreset = useCallback((preset) => {
    setActivePreset(preset.name);
    setParams(presetValues(preset));
  }, []);

  const handleReroll = useCallback(() => {
    setActivePreset(null);
    setParams((prev) => rerollValues(prev));
  }, []);

  const handleReset = useCallback(() => {
    setActivePreset(DEFAULT_PRESET);
    setParams(GALAXIUM_DEFAULTS);
  }, []);

  const handleReady = useCallback(() => setReady(true), []);

  return (
    <main className="galaxium-page" data-panel={panelOpen ? "open" : "closed"}>
      <aside className="galaxium-panel-slot">
        <GalaxiumControls
          params={params}
          activePreset={activePreset}
          status={ready ? "WebGPU live" : "starting the renderer…"}
          onChange={handleChange}
          onPreset={handlePreset}
          onReroll={handleReroll}
          onReset={handleReset}
        />
      </aside>

      <button
        type="button"
        className="galaxium-panel-toggle"
        onClick={() => setPanelOpen((open) => !open)}
      >
        {panelOpen ? "Hide controls" : "Controls"}
      </button>

      <div className="galaxium-stage">
        <ClientOnly
          load={() => import("./GalaxiumScene")}
          fallback={<div className="galaxium-stage__fallback" />}
          params={params}
          frameloop={frameloop}
          onReady={handleReady}
        />
      </div>
    </main>
  );
}
