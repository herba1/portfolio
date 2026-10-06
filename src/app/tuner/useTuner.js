"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPitchDetector } from "./pitch/detector";
import { createPitchTracker } from "./pitch/tracker";
import { buildInputChain, disconnectChain } from "./pitch/filters";

const DEMO_SAMPLE_RATE = 48000;
const DEMO_NOTE_SECONDS = 2.8;
const DEMO_HARMONICS = [1, 0.5, 0.25];

function fillDemoBuffer(buffer, demo, nowMs) {
  const elapsed = (nowMs - demo.startedAt) / 1000;
  const noteIndex = Math.floor(elapsed / DEMO_NOTE_SECONDS);
  const sinceAttack = elapsed - noteIndex * DEMO_NOTE_SECONDS;
  const base = demo.frequencies[noteIndex % demo.frequencies.length];
  const cents =
    -32 * Math.exp(-Math.max(0, sinceAttack - 0.35) / 0.7) + Math.sin(sinceAttack * 7) * 1.2;
  const frequency = base * 2 ** (cents / 1200);
  const tremolo = 1 + 0.08 * Math.sin(sinceAttack * 11);
  const amplitude = Math.min(1, sinceAttack / 0.015) * (0.02 + 0.3 * Math.exp(-sinceAttack / 0.55)) * tremolo;
  const endTime = nowMs / 1000;
  const length = buffer.length;
  for (let i = 0; i < length; i++) {
    const t = endTime - (length - i) / DEMO_SAMPLE_RATE;
    let sample = 0;
    for (let h = 0; h < DEMO_HARMONICS.length; h++) {
      sample += DEMO_HARMONICS[h] * Math.sin(2 * Math.PI * frequency * (h + 1) * t);
    }
    buffer[i] = sample * amplitude;
  }
}

export default function useTuner({
  windowSize = 4096,
  minFrequency = 73,
  maxFrequency = 1400,
  detectMs = 33,
  demoFrequencies = null,
  demoPaused = false,
} = {}) {
  const [status, setStatus] = useState(demoFrequencies?.length ? "running" : "idle");

  const streamRef = useRef(null);
  const contextRef = useRef(null);
  const sourceRef = useRef(null);
  const chainRef = useRef(null);
  const analyserRef = useRef(null);
  const detectorRef = useRef(null);
  const trackerRef = useRef(null);
  const timeBufferRef = useRef(null);
  const frameRef = useRef(0);
  const demoRef = useRef(null);
  const demoPausedRef = useRef(false);
  demoPausedRef.current = demoPaused;
  const lastDetectRef = useRef(0);
  const startingRef = useRef(false);
  const subscribersRef = useRef(new Set());

  const pitchRef = useRef({
    frequency: 0,
    confidence: 0,
    level: 0,
    voiced: false,
    holding: false,
  });

  const configRef = useRef(null);
  configRef.current = { windowSize, minFrequency, maxFrequency, detectMs };

  const subscribe = useCallback((listener) => {
    subscribersRef.current.add(listener);
    return () => subscribersRef.current.delete(listener);
  }, []);

  const loop = useCallback(() => {
    frameRef.current = requestAnimationFrame(loop);

    const analyser = analyserRef.current;
    const detector = detectorRef.current;
    const tracker = trackerRef.current;
    const buffer = timeBufferRef.current;
    const context = contextRef.current;
    const now = performance.now();

    const demo = demoRef.current;
    if (demo && detector && tracker && buffer) {
      const config = configRef.current;
      if (!demoPausedRef.current && now - lastDetectRef.current >= config.detectMs) {
        lastDetectRef.current = now;
        fillDemoBuffer(buffer, demo, now);
        const reading = detector.analyze(
          buffer,
          DEMO_SAMPLE_RATE,
          config.minFrequency,
          config.maxFrequency
        );
        const next = tracker.update(reading, now);
        const target = pitchRef.current;
        target.frequency = next.frequency;
        target.confidence = next.confidence;
        target.level = next.level;
        target.voiced = next.voiced;
        target.holding = next.holding;
      }
    } else if (analyser && detector && tracker && buffer && context) {
      const config = configRef.current;
      if (now - lastDetectRef.current >= config.detectMs) {
        lastDetectRef.current = now;
        analyser.getFloatTimeDomainData(buffer);
        const reading = detector.analyze(
          buffer,
          context.sampleRate,
          config.minFrequency,
          config.maxFrequency
        );
        const next = tracker.update(reading, now);
        const target = pitchRef.current;
        target.frequency = next.frequency;
        target.confidence = next.confidence;
        target.level = next.level;
        target.voiced = next.voiced;
        target.holding = next.holding;
      }
    }

    for (const listener of subscribersRef.current) listener(now);
  }, []);

  const startLoop = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    lastDetectRef.current = 0;
    frameRef.current = requestAnimationFrame(loop);
  }, [loop]);

  const teardown = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    try {
      sourceRef.current?.disconnect();
    } catch {}
    disconnectChain(chainRef.current);
    try {
      analyserRef.current?.disconnect();
    } catch {}
    streamRef.current?.getTracks().forEach((track) => track.stop());
    const context = contextRef.current;
    if (context && context.state !== "closed") context.close().catch(() => {});
    streamRef.current = null;
    sourceRef.current = null;
    chainRef.current = null;
    analyserRef.current = null;
    contextRef.current = null;
    timeBufferRef.current = null;
    trackerRef.current?.reset();
    const target = pitchRef.current;
    target.frequency = 0;
    target.confidence = 0;
    target.level = 0;
    target.voiced = false;
    target.holding = false;
  }, []);

  const enable = useCallback(async () => {
    if (contextRef.current) {
      if (contextRef.current.state === "suspended") {
        await contextRef.current.resume().catch(() => {});
        setStatus(contextRef.current.state === "running" ? "running" : "suspended");
        if (!frameRef.current) startLoop();
      }
      return;
    }
    if (startingRef.current) return;
    startingRef.current = true;
    setStatus("requesting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
        video: false,
      });
      streamRef.current = stream;

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContextClass();
      contextRef.current = context;

      const config = configRef.current;
      const source = context.createMediaStreamSource(stream);
      sourceRef.current = source;

      const chain = buildInputChain(context, {
        lowestFrequency: config.minFrequency,
        highestFrequency: config.maxFrequency,
      });
      chainRef.current = chain;

      const analyser = context.createAnalyser();
      analyser.fftSize = config.windowSize;
      analyser.smoothingTimeConstant = 0;
      analyserRef.current = analyser;

      source.connect(chain.input);
      chain.output.connect(analyser);

      timeBufferRef.current = new Float32Array(config.windowSize);
      detectorRef.current = createPitchDetector(config.windowSize);
      trackerRef.current = createPitchTracker();

      await context.resume();
      setStatus(context.state === "running" ? "running" : "suspended");
      startLoop();
    } catch (error) {
      teardown();
      const denied =
        error &&
        (error.name === "NotAllowedError" || error.name === "SecurityError");
      setStatus(denied ? "denied" : "error");
    } finally {
      startingRef.current = false;
    }
  }, [startLoop, teardown]);

  const disable = useCallback(() => {
    teardown();
    setStatus("idle");
  }, [teardown]);

  useEffect(() => {
    const analyser = analyserRef.current;
    if (!analyser || analyser.fftSize === windowSize) return;
    analyser.fftSize = windowSize;
    timeBufferRef.current = new Float32Array(windowSize);
    detectorRef.current = createPitchDetector(windowSize);
    trackerRef.current?.reset();
  }, [windowSize]);

  useEffect(() => {
    const context = contextRef.current;
    const chain = chainRef.current;
    if (!context || !chain) return;
    const source = sourceRef.current;
    const analyser = analyserRef.current;
    try {
      source?.disconnect();
    } catch {}
    disconnectChain(chain);
    const next = buildInputChain(context, {
      lowestFrequency: minFrequency,
      highestFrequency: maxFrequency,
    });
    chainRef.current = next;
    source?.connect(next.input);
    if (analyser) next.output.connect(analyser);
    trackerRef.current?.reset();
  }, [minFrequency, maxFrequency]);

  useEffect(() => {
    startLoop();
    return () => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [startLoop]);

  useEffect(() => {
    function onVisibility() {
      const context = contextRef.current;
      if (document.hidden) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
        context?.suspend().catch(() => {});
      } else {
        if (context) {
          context.resume().catch(() => {});
          setStatus(context.state === "running" ? "running" : "suspended");
        }
        if (!frameRef.current) startLoop();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [startLoop]);

  useEffect(() => {
    if (!demoFrequencies?.length) return undefined;
    timeBufferRef.current = new Float32Array(windowSize);
    detectorRef.current = createPitchDetector(windowSize);
    trackerRef.current = createPitchTracker();
    demoRef.current = { frequencies: demoFrequencies, startedAt: performance.now() };
    setStatus("running");
    startLoop();
    return () => {
      demoRef.current = null;
      trackerRef.current?.reset();
      const target = pitchRef.current;
      target.frequency = 0;
      target.confidence = 0;
      target.level = 0;
      target.voiced = false;
      target.holding = false;
      setStatus("idle");
    };
  }, [demoFrequencies, windowSize, startLoop]);

  useEffect(() => () => teardown(), [teardown]);

  return { status, enable, disable, pitchRef, subscribe };
}
