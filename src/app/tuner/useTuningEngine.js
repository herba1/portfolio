"use client";

import { useEffect, useRef, useState } from "react";
import { useMotionValue } from "motion/react";
import { freqToNote, noteToFreq, centsBetween } from "./pitch/notes";
import { nearestStringInTuning } from "./tunings";

/**
 * The tuning brain. Runs a light RAF that reads the smoothed frequency and:
 *  - picks the current target (string in fixed tunings, nearest semitone in
 *    chromatic), computes signed cents, EMA-smooths it for display;
 *  - drives the needle motion value + shared tuneRef (waveform reads it) +
 *    the root --accent CSS var (so the whole display shifts cyan→amber→green);
 *  - in auto mode, follows your pluck and checks off a string once it holds in
 *    tune for `dwellMs`.
 */
export default function useTuningEngine({
  freqRef,
  mode,
  tuning,
  a4,
  selectedIndex,
  setSelectedIndex,
  inTuneCents = 5,
  dwellMs = 600,
}) {
  const centsMV = useMotionValue(0);
  const [target, setTarget] = useState({
    index: null,
    label: null,
    cents: 0,
    inTune: false,
    active: false,
  });
  const [tuned, setTuned] = useState(() => new Set());

  // Latest config for the RAF closure (avoids restarting the loop on change).
  const cfgRef = useRef(null);
  cfgRef.current = { mode, tuning, a4, selectedIndex, inTuneCents, dwellMs };

  const dispCentsRef = useRef(0);
  const dwellStartRef = useRef(0);
  const lastStateRef = useRef(0);
  const tunedRef = useRef(tuned);
  tunedRef.current = tuned;
  const rafRef = useRef(0);

  // Reset progress when the tuning changes.
  useEffect(() => {
    setTuned(new Set());
    dwellStartRef.current = 0;
  }, [tuning.id]);

  useEffect(() => {
    function frame() {
      rafRef.current = requestAnimationFrame(frame);
      const { mode, tuning, a4, selectedIndex, inTuneCents, dwellMs } =
        cfgRef.current;
      const freq = freqRef.current;
      const active = freq != null;

      let rawCents = dispCentsRef.current;
      let idx = selectedIndex;
      let label = null;

      if (active) {
        if (tuning.type === "chromatic" || mode === "chromatic") {
          const n = freqToNote(freq, a4);
          rawCents = n.cents;
          label = n.label;
          idx = null;
        } else {
          let useIdx;
          if (mode === "manual" && selectedIndex != null) {
            useIdx = selectedIndex;
          } else {
            const near = nearestStringInTuning(freq, tuning, a4);
            useIdx = near ? near.index : selectedIndex || 0;
          }
          const s = tuning.strings[useIdx];
          if (s) {
            rawCents = centsBetween(freq, noteToFreq(s.midi, a4));
            label = s.label;
            idx = useIdx;
            // follow-the-pluck: in auto, track whatever string is being played
            if (mode === "auto" && useIdx !== selectedIndex) {
              setSelectedIndex(useIdx);
            }
          }
        }
      }

      // EMA smoothing — settle toward 0 when idle so the needle rests centered.
      const clamped = Math.max(-60, Math.min(60, rawCents));
      const k = active ? 0.25 : 0.08;
      dispCentsRef.current += ((active ? clamped : 0) - dispCentsRef.current) * k;
      const disp = dispCentsRef.current;
      centsMV.set(Math.max(-50, Math.min(50, disp)));

      const inTune = active && Math.abs(disp) <= inTuneCents;

      // Auto-advance: hold in tune for dwellMs → check the string off.
      if (mode === "auto" && idx != null && tuning.strings.length) {
        if (inTune) {
          if (!dwellStartRef.current) dwellStartRef.current = performance.now();
          else if (
            performance.now() - dwellStartRef.current >= dwellMs &&
            !tunedRef.current.has(idx)
          ) {
            const next = new Set(tunedRef.current);
            next.add(idx);
            setTuned(next);
          }
        } else {
          dwellStartRef.current = 0;
        }
      } else {
        dwellStartRef.current = 0;
      }

      // Throttled state mirror for rendering the strip (~16 Hz).
      const now = performance.now();
      if (now - lastStateRef.current > 60) {
        lastStateRef.current = now;
        setTarget({ index: idx, label, cents: disp, inTune, active });
      }
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [centsMV, freqRef, setSelectedIndex]);

  return {
    centsMV,
    target,
    tuned,
    allTuned:
      tuning.strings.length > 0 && tuned.size === tuning.strings.length,
  };
}
