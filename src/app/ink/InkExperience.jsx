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

import InkControls from "./InkControls";
import "./ink.css";
import { DEFAULT_IMAGE, DEFAULT_PRESET, INK_DEFAULTS, presetValues, rerollValues } from "./inkParams";

const STORAGE_KEY = "herb:ink:params";

export default function InkExperience() {
  const [params, setParams] = useState(INK_DEFAULTS);
  const [activePreset, setActivePreset] = useState(DEFAULT_PRESET);
  const [image, setImage] = useState({ src: DEFAULT_IMAGE, label: "cast/john.webp" });
  const [panelOpen, setPanelOpen] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState(null);
  const [source, setSource] = useState({ status: "loading" });

  const captureRef = useRef(null);
  const fileInputRef = useRef(null);
  const objectUrlRef = useRef(null);
  const restoredRef = useRef(false);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  useEffect(() => {
    if (window.innerWidth <= 900) setPanelOpen(false);
  }, []);

  useEffect(() => {
    const saved = loadStored(STORAGE_KEY, INK_DEFAULTS);
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
      zoom: prev.zoom,
      offsetX: prev.offsetX,
      offsetY: prev.offsetY,
    }));
  }, []);

  const handleReroll = useCallback(() => {
    setActivePreset(null);
    setParams((prev) => rerollValues(prev));
  }, []);

  const handleReset = useCallback(() => {
    setActivePreset(DEFAULT_PRESET);
    setParams(INK_DEFAULTS);
    clearStored(STORAGE_KEY);
    setNote("reset to defaults");
  }, []);

  const handleCopy = useCallback(async () => {
    const ok = await copyParams(params);
    setNote(ok ? "config copied to clipboard" : "could not reach the clipboard");
  }, [params]);

  const handlePaste = useCallback(async () => {
    const next = await readParams(INK_DEFAULTS);
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
    link.download = "ink.png";
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
  }, []);

  const sourceStatus =
    source.shaderError ??
    (source.status === "ready"
      ? `${source.width} × ${source.height}`
      : source.status === "failed"
        ? "could not load that image"
        : "loading…");

  return (
    <main className="ink-page" data-panel={panelOpen ? "open" : "closed"}>
      <aside className="ink-panel-slot">
        <InkControls
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
        />
      </aside>

      <button
        type="button"
        className="ink-panel-toggle"
        onClick={() => setPanelOpen((open) => !open)}
      >
        {panelOpen ? "Hide controls" : "Controls"}
      </button>

      <div
        className="ink-stage"
        data-dragging={dragging ? "true" : undefined}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <ClientOnly
          load={() => import("./InkScene")}
          fallback={<div className="ink-stage__fallback" />}
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
        className="ink-file"
        onChange={(event) => acceptFile(event.target.files?.[0])}
      />
    </main>
  );
}
