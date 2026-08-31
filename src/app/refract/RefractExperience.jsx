"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import ClientOnly from "@/app/ui/ClientOnly";
import {
  clearStored,
  copyParams,
  loadStored,
  readParams,
  storeParams,
} from "@/app/ui/paramStore";

import RefractControls from "./RefractControls";
import "./refract.css";
import {
  DEFAULT_IMAGE,
  DEFAULT_PRESET,
  REFRACT_DEFAULTS,
  presetValues,
  rerollValues,
} from "./refractParams";

const STORAGE_KEY = "herb:refract:params";

export default function RefractExperience() {
  const [params, setParams] = useState(REFRACT_DEFAULTS);
  const [activePreset, setActivePreset] = useState(DEFAULT_PRESET);
  const [image, setImage] = useState({ src: DEFAULT_IMAGE, label: "cast/paul.webp" });
  const [panelOpen, setPanelOpen] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState(null);
  const [source, setSource] = useState({ status: "loading" });

  const captureRef = useRef(null);
  const fileInputRef = useRef(null);
  const objectUrlRef = useRef(null);
  const restoredRef = useRef(false);
  const levelledSrcRef = useRef(DEFAULT_IMAGE);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  useEffect(() => {
    if (window.innerWidth <= 900) setPanelOpen(false);
  }, []);

  useEffect(() => {
    const saved = loadStored(STORAGE_KEY, REFRACT_DEFAULTS);
    if (saved) {
      setParams(saved);
      setActivePreset(null);
      setNote("restored your last config");
    }
    restoredRef.current = true;
  }, []);

  useEffect(() => {
    if (!restoredRef.current) return;
    storeParams(STORAGE_KEY, params);
  }, [params]);

  useEffect(() => {
    if (!note) return undefined;
    const id = setTimeout(() => setNote(null), 2600);
    return () => clearTimeout(id);
  }, [note]);

  const handleChange = useCallback((key, value) => {
    setActivePreset(null);
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handlePreset = useCallback((preset) => {
    setActivePreset(preset.name);
    setParams((prev) => ({
      ...presetValues(preset),
      fill: prev.fill,
      tile: prev.tile,
      zoom: prev.zoom,
      offsetX: prev.offsetX,
      offsetY: prev.offsetY,
      black: prev.black,
      white: prev.white,
    }));
  }, []);

  const handleReroll = useCallback(() => {
    setActivePreset(null);
    setParams((prev) => rerollValues(prev));
  }, []);

  const handleReset = useCallback(() => {
    setActivePreset(DEFAULT_PRESET);
    setParams(REFRACT_DEFAULTS);
    clearStored(STORAGE_KEY);
    setNote("reset to defaults");
  }, []);

  const handleCopy = useCallback(async () => {
    const ok = await copyParams(params);
    setNote(ok ? "config copied to clipboard" : "could not reach the clipboard");
  }, [params]);

  const handlePaste = useCallback(async () => {
    const next = await readParams(REFRACT_DEFAULTS);
    if (!next) {
      setNote("that was not a valid config");
      return;
    }
    setActivePreset(null);
    setParams(next);
    setNote("config applied");
  }, []);

  const handleSave = useCallback(() => {
    const capture = captureRef.current;
    if (!capture) return;
    const link = document.createElement("a");
    link.href = capture();
    link.download = "refract.png";
    link.click();
  }, []);

  const acceptFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setImage({ src: url, label: file.name });
  }, []);

  const handleDrop = useCallback(
    (event) => {
      event.preventDefault();
      setDragging(false);
      acceptFile(event.dataTransfer.files?.[0]);
    },
    [acceptFile],
  );

  const registerCapture = useCallback((capture) => {
    captureRef.current = capture;
  }, []);

  const handleSource = useCallback((next) => {
    setSource((prev) =>
      next.status === "shader"
        ? { ...prev, shaderError: next.message }
        : { ...next, shaderError: prev.shaderError },
    );

    if (next.status === "ready" && next.levels && levelledSrcRef.current !== next.src) {
      levelledSrcRef.current = next.src;
      setParams((prev) => ({ ...prev, black: next.levels.black, white: next.levels.white }));
    }
  }, []);

  const handleAutoLevels = useCallback(() => {
    if (source.status !== "ready" || !source.levels) return;
    setActivePreset(null);
    setParams((prev) => ({ ...prev, black: source.levels.black, white: source.levels.white }));
  }, [source]);

  const sourceStatus =
    source.shaderError ??
    (source.status === "ready"
      ? `${source.width} × ${source.height}`
      : source.status === "failed"
        ? "could not load that image"
        : "loading…");

  return (
    <main className="rf-page" data-panel={panelOpen ? "open" : "closed"}>
      <aside className="rf-panel-slot">
        <RefractControls
          params={params}
          activePreset={activePreset}
          imageLabel={image.label}
          sourceStatus={sourceStatus}
          onChange={handleChange}
          onPreset={handlePreset}
          onReroll={handleReroll}
          onReset={handleReset}
          onSave={handleSave}
          onPickImage={() => fileInputRef.current?.click()}
          onCopy={handleCopy}
          onPaste={handlePaste}
          note={note}
          onAutoLevels={handleAutoLevels}
        />
      </aside>

      <button
        type="button"
        className="rf-panel-toggle"
        onClick={() => setPanelOpen((open) => !open)}
      >
        {panelOpen ? "Hide controls" : "Controls"}
      </button>

      <div
        className="rf-stage"
        data-dragging={dragging ? "true" : undefined}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <ClientOnly
          load={() => import("./RefractScene")}
          fallback={<div className="rf-stage__fallback" />}
          params={params}
          imageSrc={image.src}
          onReady={registerCapture}
          onSource={handleSource}
        />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="rf-file"
        onChange={(event) => acceptFile(event.target.files?.[0])}
      />
    </main>
  );
}
