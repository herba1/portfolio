"use client";

import { useEffect, useRef } from "react";
import { GradientScene } from "./gradientScene";
import useNearViewport from "@/app/experiments/useNearViewport";

export default function DynamicBackdrop({ artworkURL, config, onReady, sampler }) {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const configRef = useRef(config);
  const readyRef = useRef(onReady);
  const samplerRef = useRef(sampler);
  const artworkRef = useRef(artworkURL);
  // The GL context and its frame loop start only near the viewport; the
  // canvas is transparent until its first frame either way.
  const near = useNearViewport(canvasRef);

  artworkRef.current = artworkURL;
  configRef.current = config;
  readyRef.current = onReady;
  samplerRef.current = sampler;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !near) return;

    const scene = new GradientScene(canvas, {
      artworkURL: artworkRef.current,
      config: configRef.current,
      sampler: () => samplerRef.current?.() ?? null,
      onReady: () => {
        canvas.dataset.ready = "true";
        readyRef.current?.();
      },
    });
    sceneRef.current = scene;

    const resizeObserver = new ResizeObserver(() => scene.resize());
    resizeObserver.observe(canvas);

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => scene.setVisible(entry.isIntersecting),
      { threshold: 0 },
    );
    intersectionObserver.observe(canvas);

    return () => {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      scene.destroy();
      sceneRef.current = null;
    };
  }, [near]);

  useEffect(() => {
    sceneRef.current?.setArtwork(artworkURL);
  }, [artworkURL]);

  useEffect(() => {
    if (config) sceneRef.current?.setConfig(config);
  }, [config]);

  return <canvas ref={canvasRef} className="backdrop-canvas" aria-hidden="true" />;
}
