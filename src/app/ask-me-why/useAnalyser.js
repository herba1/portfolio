"use client";

import { useCallback, useEffect, useRef } from "react";

const FFT_SIZE = 512;

export function useAnalyser(audioRef, playing) {
  const ctxRef = useRef(null);
  const analyserRef = useRef(null);
  const binsRef = useRef(null);

  useEffect(() => {
    if (!playing) return;
    const el = audioRef.current;
    if (!el || analyserRef.current) return;

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;

    try {
      const ctx = new Ctx();
      const source = ctx.createMediaElementSource(el);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      binsRef.current = new Uint8Array(analyser.frequencyBinCount);
    } catch {
      analyserRef.current = null;
    }
  }, [audioRef, playing]);

  useEffect(() => {
    if (playing) ctxRef.current?.resume?.();
  }, [playing]);

  return useCallback(() => {
    const analyser = analyserRef.current;
    const bins = binsRef.current;
    if (!analyser || !bins) return null;
    analyser.getByteFrequencyData(bins);
    return bins;
  }, []);
}
