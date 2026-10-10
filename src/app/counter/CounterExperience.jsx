"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import useCovers from "@/app/ui/useCovers";

import CounterStage from "./CounterStage";
import { FALLBACK_TRACKS, normaliseTracks } from "./counterTracks";
import "./counter.css";

const revealedStages = new Set();

function showWithoutFade(canvas) {
  canvas.style.transition = "none";
  canvas.getBoundingClientRect();
  canvas.style.transition = "";
}

function settleReveal(event) {
  if (event.animationName === "counter-reveal") event.currentTarget.dataset.revealed = "";
}

export default function CounterExperience({ covers, embedded = false }) {
  const [useFallback, setUseFallback] = useState(false);
  const tracks = useMemo(() => normaliseTracks(useFallback ? FALLBACK_TRACKS : covers), [covers, useFallback]);
  const loaded = useCovers(tracks);
  const [landing, setLanding] = useState({ trackIndex: 0, number: 1, total: 0 });

  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const probeRef = useRef(null);
  const engineRef = useRef(null);
  const loadedRef = useRef(loaded);
  const revealKey = embedded ? "tile" : "page";

  useEffect(() => {
    const stageElement = stageRef.current;
    const revealedBefore = revealedStages.has(revealKey);
    if (revealedBefore) stageElement.dataset.revealed = "";
    const engine = new CounterStage({
      root: stageElement,
      canvas: canvasRef.current,
      probe: probeRef.current,
      tracks,
      embedded,
      isFallback: Boolean(tracks.isFallback),
      revealed: revealedBefore,
      onLand: setLanding,
      onReady: () => {
        if (revealedBefore) showWithoutFade(canvasRef.current);
        revealedStages.add(revealKey);
      },
      onFallback: () => setUseFallback(true),
    });
    engineRef.current = engine;
    engine.start();
    engine.setCovers(loadedRef.current);
    return () => {
      engine.destroy();
      engineRef.current = null;
      if (!revealedStages.has(revealKey)) delete stageElement.dataset.ready;
    };
  }, [tracks, embedded, revealKey]);

  useEffect(() => {
    loadedRef.current = loaded;
    engineRef.current?.setCovers(loaded);
  }, [loaded]);

  const track = tracks[landing.trackIndex] ?? tracks[0];
  const Root = embedded ? "div" : "main";
  const byline = `${track?.title ?? ""}${track?.artist ? ` by ${track.artist}` : ""}`;
  const howTo = embedded ? "Tap or press Enter to fall into the next title; Backspace surfaces." : "Scroll, swipe, tap or press Enter to fall into the next title; Backspace surfaces.";

  return (
    <Root className="counter" data-embedded={embedded || undefined}>
      <div
        ref={stageRef}
        className="counter-stage"
        tabIndex={0}
        role="button"
        aria-label={`Counter. ${byline}. ${howTo}`}
        onAnimationEnd={settleReveal}
      >
        <canvas ref={canvasRef} className="counter-canvas" aria-hidden="true" />
      </div>
      {!embedded && (
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {landing.total && !landing.auto ? `${byline}, ${landing.number} of ${landing.total}` : ""}
        </p>
      )}
      <span ref={probeRef} className="counter-probe font-sans" aria-hidden="true" />
    </Root>
  );
}
