"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MorphText from "@/app/ui/MorphText";
import SlotNumber from "@/app/ui/SlotNumber";
import useCovers from "@/app/ui/useCovers";

import CounterStage from "./CounterStage";
import { FALLBACK_TRACKS, normaliseTracks } from "./counterTracks";
import "./counter.css";

const THUMB_PX = 48;
const THUMB_BLOCKS = [8, 4, 2, 1];
const THUMB_STEP_MS = 90;

const pad = (value) => String(value).padStart(2, "0");

function drawThumb(canvas, item, block) {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const size = Math.round(THUMB_PX * ratio);
  if (canvas.width !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  const ctx = canvas.getContext("2d");
  const image = item.element;
  const naturalW = image.naturalWidth || image.width || 1;
  const naturalH = image.naturalHeight || image.height || 1;
  const side = Math.min(naturalW, naturalH);
  const sx = (naturalW - side) / 2;
  const sy = (naturalH - side) / 2;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (block <= 1) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, sx, sy, side, side, 0, 0, size, size);
    return;
  }
  const cells = Math.max(1, Math.round(THUMB_PX / block));
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(image, sx, sy, side, side, 0, 0, cells, cells);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, cells, cells, 0, 0, size, size);
}

export default function CounterExperience({ covers, embedded = false }) {
  const [useFallback, setUseFallback] = useState(false);
  const tracks = useMemo(() => normaliseTracks(useFallback ? FALLBACK_TRACKS : covers), [covers, useFallback]);
  const loaded = useCovers(tracks);
  const [landing, setLanding] = useState({ trackIndex: 0, number: 1, total: 0, canSurface: false });
  const current = landing.trackIndex;
  const canSurface = landing.canSurface;

  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const probeRef = useRef(null);
  const slotRef = useRef(null);
  const thumbRef = useRef(null);
  const engineRef = useRef(null);
  const loadedRef = useRef(loaded);

  useEffect(() => {
    const stageElement = stageRef.current;
    const engine = new CounterStage({
      root: stageElement,
      canvas: canvasRef.current,
      probe: probeRef.current,
      tracks,
      embedded,
      isFallback: Boolean(tracks.isFallback),
      onLand: (next) => {
        slotRef.current?.setValue(`${pad(next.number)} / ${pad(next.total)}`);
        setLanding(next);
      },
      onFallback: () => setUseFallback(true),
    });
    engineRef.current = engine;
    engine.start();
    engine.setCovers(loadedRef.current);
    return () => {
      engine.destroy();
      engineRef.current = null;
      delete stageElement.dataset.ready;
    };
  }, [tracks, embedded]);

  useEffect(() => {
    loadedRef.current = loaded;
    engineRef.current?.setCovers(loaded);
  }, [loaded]);

  const track = tracks[current] ?? tracks[0];
  const item = useMemo(() => loaded.find((entry) => entry.id === track?.id) ?? null, [loaded, track]);

  useEffect(() => {
    const canvas = thumbRef.current;
    if (!canvas || !item) return undefined;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const blocks = reduced ? [1] : THUMB_BLOCKS;
    const timers = blocks.map((block, step) => setTimeout(() => drawThumb(canvas, item, block), step * THUMB_STEP_MS));
    return () => timers.forEach(clearTimeout);
  }, [item]);

  const surface = useCallback(() => {
    engineRef.current?.surface();
    stageRef.current?.focus({ preventScroll: true });
  }, []);

  const Root = embedded ? "div" : "main";

  return (
    <Root className="counter" data-embedded={embedded || undefined}>
      <div
        ref={stageRef}
        className="counter-stage"
        tabIndex={0}
        role="button"
        aria-label={`${track?.title ?? "Counter"}. Scroll, swipe, tap or press Enter to fall into the next title; Backspace surfaces.`}
      >
        <canvas ref={canvasRef} className="counter-canvas" aria-hidden="true" />
        <p className="counter-loading text-display" aria-hidden="true">
          {tracks[0]?.title}
        </p>
      </div>

      {!embedded && (
        <header className="counter-head">
          <h1 className="text-title-sm">Counter</h1>
        </header>
      )}

      <footer className="counter-caption">
        <canvas ref={thumbRef} className="counter-thumb" width={THUMB_PX * 2} height={THUMB_PX * 2} aria-hidden="true" />
        <div className="counter-meta">
          <MorphText text={track?.title ?? ""} className="counter-title text-heading-sm" />
          <p className="sr-only text-ui" aria-live="polite" aria-atomic="true">
            {landing.total ? `${track?.title ?? ""} by ${track?.artist ?? ""}, ${landing.number} of ${landing.total}` : ""}
          </p>
          <p className="counter-sub text-ui-lg">
            <SlotNumber ref={slotRef} value={`01 / ${pad(tracks.length)}`} className="counter-index text-ui" />
            <MorphText text={track?.artist ?? ""} className="counter-artist text-ink-secondary" />
          </p>
        </div>
        <button type="button" className="counter-surface text-ui" data-shown={canSurface || undefined} onClick={surface} tabIndex={canSurface ? 0 : -1} aria-hidden={!canSurface}>
          Surface
        </button>
      </footer>

      <span ref={probeRef} className="counter-probe font-sans" aria-hidden="true">
        Ag
      </span>
    </Root>
  );
}
