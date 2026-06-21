"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detectPitchMPM, createPitchSmoother } from "./pitch/mpm";

/**
 * Owns the whole audio graph + pitch-detection loop for the tuner.
 *
 * Hot values (freqRef / clarityRef) update at the MPM cadence and are meant to
 * be read inside a consumer's own RAF (waveform, needle) — they do NOT trigger
 * React renders. A throttled mirror (liveFreq / liveClarity) drives the text
 * readout at ~20 Hz so the DSEG display re-renders calmly.
 */
export default function useTuner({
  fftSize = 2048,
  minFrequency = 60,
  maxFrequency = 1400,
  detectMs = 33, // MPM cadence (~30 Hz)
  confidenceFloor = 0.8, // reject pitches below this clarity
  stateMs = 50, // React readout mirror cadence (~20 Hz)
} = {}) {
  const [status, setStatus] = useState("idle"); // idle|requesting|running|suspended|denied|error
  const [liveFreq, setLiveFreq] = useState(null);
  const [liveClarity, setLiveClarity] = useState(0);

  const streamRef = useRef(null);
  const ctxRef = useRef(null);
  const sourceRef = useRef(null);
  const gainNodeRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(0);
  const timeBufRef = useRef(null);
  const smootherRef = useRef(null);
  const lastDetectRef = useRef(0);
  const lastStateRef = useRef(0);
  const startingRef = useRef(false);

  const freqRef = useRef(null); // smoothed Hz | null
  const clarityRef = useRef(0);
  const gainRef = useRef(1); // auto-gain factor applied to the input

  // Loop params kept fresh in a ref so changing them never restarts the loop.
  const paramsRef = useRef(null);
  paramsRef.current = { minFrequency, maxFrequency, detectMs, confidenceFloor, stateMs };

  const getAnalyser = useCallback(() => analyserRef.current, []);

  const loop = useCallback(() => {
    rafRef.current = requestAnimationFrame(loop);
    const analyser = analyserRef.current;
    const buf = timeBufRef.current;
    const ctx = ctxRef.current;
    if (!analyser || !buf || !ctx) return;

    const now = performance.now();
    const p = paramsRef.current;
    if (now - lastDetectRef.current < p.detectMs) return;
    lastDetectRef.current = now;

    analyser.getFloatTimeDomainData(buf);

    // peak of the (already gain-staged) buffer — drives the auto-gain loop
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const a = buf[i] < 0 ? -buf[i] : buf[i];
      if (a > peak) peak = a;
    }

    const { frequency, clarity } = detectPitchMPM(buf, ctx.sampleRate, {
      minFrequency: p.minFrequency,
      maxFrequency: p.maxFrequency,
      // low gate: let faint/distant input through to be evaluated; clarity (not
      // loudness) decides whether it's a real note. The gain stage lifts it.
      minRms: 0.0022,
    });

    // ── Auto-gain: pitch is amplitude-invariant, so a quiet/distant signal is
    // detectable in principle but sits below the gate and looks dead. A GainNode
    // (source → gain → analyser) lifts a real tone toward a target level. We only
    // raise gain when a periodic tone is present (clarity-gated), so room hiss
    // isn't amplified into false notes; on silence the gain eases back to unity.
    const gainNode = gainNodeRef.current;
    if (gainNode) {
      let agc = gainRef.current;
      if (clarity >= 0.5) {
        // makeup gain to bring the raw peak (peak / agc) up to ~0.3
        let ideal = (0.3 * agc) / Math.max(peak, 1e-3);
        ideal = Math.max(1, Math.min(64, ideal));
        agc += (ideal - agc) * (ideal > agc ? 0.1 : 0.35); // rise slow, fall fast
      } else {
        agc += (1 - agc) * 0.04; // decay toward unity on noise/silence
      }
      gainRef.current = agc;
      gainNode.gain.value = agc;
    }

    const confident = frequency != null && clarity >= p.confidenceFloor;
    const smoothed = smootherRef.current.push(confident ? frequency : null);
    freqRef.current = smoothed;
    clarityRef.current = confident ? clarity : 0;

    if (now - lastStateRef.current >= p.stateMs) {
      lastStateRef.current = now;
      setLiveFreq(smoothed);
      setLiveClarity(confident ? clarity : 0);
    }
  }, []);

  const startLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    lastDetectRef.current = 0;
    rafRef.current = requestAnimationFrame(loop);
  }, [loop]);

  const teardown = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    try {
      sourceRef.current?.disconnect();
    } catch {}
    try {
      gainNodeRef.current?.disconnect();
    } catch {}
    try {
      analyserRef.current?.disconnect();
    } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop());
    const ctx = ctxRef.current;
    if (ctx && ctx.state !== "closed") ctx.close().catch(() => {});
    streamRef.current = null;
    sourceRef.current = null;
    gainNodeRef.current = null;
    analyserRef.current = null;
    ctxRef.current = null;
    timeBufRef.current = null;
    smootherRef.current?.reset();
    freqRef.current = null;
    clarityRef.current = 0;
    gainRef.current = 1;
  }, []);

  const enable = useCallback(async () => {
    // Already running: a click in the "suspended" state just resumes.
    if (ctxRef.current) {
      if (ctxRef.current.state === "suspended") {
        await ctxRef.current.resume().catch(() => {});
        setStatus(ctxRef.current.state === "running" ? "running" : "suspended");
        if (!rafRef.current) startLoop();
      }
      return;
    }
    if (startingRef.current) return; // dedupe StrictMode / double-clicks
    startingRef.current = true;
    setStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Voice DSP wrecks pitch accuracy — turn it all off.
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
        video: false,
      });
      streamRef.current = stream;
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const gain = ctx.createGain();
      gain.gain.value = 1;
      gainNodeRef.current = gain;
      gainRef.current = 1;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = fftSize;
      analyser.smoothingTimeConstant = 0;
      analyserRef.current = analyser;
      // source → gain → analyser (auto-gain stage). Never to destination.
      source.connect(gain);
      gain.connect(analyser);
      timeBufRef.current = new Float32Array(analyser.fftSize);
      smootherRef.current = createPitchSmoother({ window: 5, ema: 0.25 });

      await ctx.resume();
      setStatus(ctx.state === "running" ? "running" : "suspended");
      startLoop();
    } catch (err) {
      teardown();
      const denied =
        err && (err.name === "NotAllowedError" || err.name === "SecurityError");
      setStatus(denied ? "denied" : "error");
    } finally {
      startingRef.current = false;
    }
  }, [fftSize, startLoop, teardown]);

  const disable = useCallback(() => {
    teardown();
    setLiveFreq(null);
    setLiveClarity(0);
    setStatus("idle");
  }, [teardown]);

  // React to fftSize changes (e.g. switching to a bass preset) without a restart.
  useEffect(() => {
    const analyser = analyserRef.current;
    if (!analyser || analyser.fftSize === fftSize) return;
    analyser.fftSize = fftSize;
    timeBufRef.current = new Float32Array(analyser.fftSize);
    smootherRef.current?.reset();
  }, [fftSize]);

  // Pause cleanly when the tab is hidden; resume on return.
  useEffect(() => {
    function onVisibility() {
      const ctx = ctxRef.current;
      if (!ctx) return;
      if (document.hidden) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
        ctx.suspend().catch(() => {});
      } else {
        ctx.resume().catch(() => {});
        setStatus(ctx.state === "running" ? "running" : "suspended");
        if (!rafRef.current) startLoop();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [startLoop]);

  // Release the mic on unmount (the browser recording indicator must turn off).
  useEffect(() => () => teardown(), [teardown]);

  return {
    status,
    enabled: status === "running",
    enable,
    disable,
    freqRef,
    clarityRef,
    liveFreq,
    liveClarity,
    getAnalyser,
  };
}
