"use client";

import { useEffect, useRef } from "react";
import { GradientScene } from "./gradientScene";

export default function DynamicBackdrop({ artworkURL, config, onReady, sampler }) {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const configRef = useRef(config);
  const readyRef = useRef(onReady);
  const samplerRef = useRef(sampler);

  configRef.current = config;
  readyRef.current = onReady;
  samplerRef.current = sampler;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new GradientScene(canvas, {
      artworkURL,
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
  }, []);

  useEffect(() => {
    sceneRef.current?.setArtwork(artworkURL);
  }, [artworkURL]);

  useEffect(() => {
    if (config) sceneRef.current?.setConfig(config);
  }, [config]);

  return <canvas ref={canvasRef} className="backdrop-canvas" aria-hidden="true" />;
}
