"use client";

import { useEffect, useImperativeHandle, useRef } from "react";

import { createCopierEngine } from "./copierEngine";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function CopierStage({ source, params, preset, sound, apiRef, onPhase, onCopied, onReady, onError }) {
  const sheetRef = useRef(null);
  const canvasHostRef = useRef(null);
  const handleRef = useRef(null);
  const engineRef = useRef(null);
  const propsRef = useRef(null);

  useEffect(() => {
    propsRef.current = { params, preset, onPhase, onCopied, onReady, onError };
    if (engineRef.current) engineRef.current.requestRender();
  }, [params, preset, onPhase, onCopied, onReady, onError]);

  useEffect(() => {
    const engine = createCopierEngine({
      host: sheetRef.current,
      canvasHost: canvasHostRef.current,
      handle: handleRef.current,
      getProps: () => propsRef.current,
      reducedMotion: prefersReducedMotion(),
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (engineRef.current) engineRef.current.loadSource(source);
  }, [source]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.setSound(sound);
  }, [sound]);

  useImperativeHandle(
    apiRef,
    () => ({
      startPass: () => (engineRef.current ? engineRef.current.startPass() : false),
      takeHeld: () => (engineRef.current ? engineRef.current.takeHeld() : null),
      snapshot: () => (engineRef.current ? engineRef.current.snapshot() : null),
      recentre: () => engineRef.current && engineRef.current.recentre(),
      wake: () => engineRef.current && engineRef.current.wake(),
      sheet: () => sheetRef.current,
    }),
    [],
  );

  return (
    <div
      ref={sheetRef}
      className="copier-sheet"
      tabIndex={0}
      role="application"
      aria-label="Copier glass. Drag the picture to copy it as the light passes, drag the light bar to carry the scan, scroll over the picture to turn it, arrows to nudge, Space to copy, Enter to copy the copy."
    >
      <div
        className="copier-sheet__fallback"
        style={source && source.kind === "image" ? { "--copier-original": `url(${source.url})` } : undefined}
        aria-hidden="true"
      />
      <div ref={canvasHostRef} className="copier-sheet__canvas" />
      <span ref={handleRef} className="copier-handle" aria-hidden="true">
        <span className="copier-handle__grip" />
      </span>
    </div>
  );
}
