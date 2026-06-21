"use client";

import { useEffect, useRef, useState } from "react";
import { useControls } from "leva";

/**
 * Dev-only panel (mounted only when NODE_ENV !== production). Its main job: a
 * synthetic oscillator routed in as a fake microphone, so the whole pipeline
 * (detection → smoothing → needle → auto-advance → waveform) can be exercised
 * with exact known frequencies, no real mic needed. Toggle "fakeMic" ON, set a
 * frequency, then hit Enable on the tuner.
 */
export default function TunerDevControls() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const oscRef = useRef(null);
  const ctxRef = useRef(null);
  const origRef = useRef(null);

  const { fakeMic, waveform, testFreq, drift } = useControls("Tuner (dev)", {
    fakeMic: false,
    waveform: {
      value: "sawtooth",
      options: ["sawtooth", "sine", "triangle", "square"],
    },
    testFreq: { value: 220, min: 55, max: 660, step: 0.5, label: "freq (Hz)" },
    drift: false,
  });

  // Install / restore the fake getUserMedia. Rebuilds when waveform changes.
  useEffect(() => {
    if (!fakeMic) return;
    if (!origRef.current && navigator.mediaDevices) {
      origRef.current = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices
      );
    }
    navigator.mediaDevices.getUserMedia = async () => {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      ctxRef.current = ctx;
      const osc = ctx.createOscillator();
      oscRef.current = osc;
      osc.type = waveform;
      osc.frequency.value = testFreq;
      const g = ctx.createGain();
      g.gain.value = 0.32;
      const dest = ctx.createMediaStreamDestination();
      osc.connect(g).connect(dest);
      osc.start();
      ctx.resume();
      return dest.stream;
    };
    return () => {
      if (origRef.current) navigator.mediaDevices.getUserMedia = origRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fakeMic, waveform]);

  // Live-update the running oscillator's frequency.
  useEffect(() => {
    const osc = oscRef.current;
    const ctx = ctxRef.current;
    if (osc && ctx) {
      try {
        osc.frequency.setValueAtTime(testFreq, ctx.currentTime);
      } catch {}
    }
  }, [testFreq]);

  // Optional slow drift to exercise smoothing/hysteresis.
  useEffect(() => {
    if (!drift) return;
    let raf = 0;
    let t = 0;
    const loop = () => {
      t += 0.016;
      const osc = oscRef.current;
      const ctx = ctxRef.current;
      if (osc && ctx) {
        try {
          osc.frequency.setValueAtTime(
            testFreq + Math.sin(t * 0.7) * 10,
            ctx.currentTime
          );
        } catch {}
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [drift, testFreq]);

  if (!mounted) return null;
  return null; // leva renders its own floating panel
}
