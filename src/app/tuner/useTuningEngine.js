"use client";

import { useEffect, useMemo, useRef } from "react";
import { useMotionValue } from "motion/react";
import { freqToNote, noteToFreq, centsBetween, formatCents } from "./pitch/notes";
import { nearestStringInTuning } from "./tunings";

const CENTS_RANGE = 50;
const SETTLE_RATE = 0.09;
const TRACK_RATE = 0.3;
const IN_TUNE_CENTS = 4;
const CLOSE_CENTS = 15;
const PHASE_HOLD_MS = 90;

export default function useTuningEngine({
  pitchRef,
  subscribe,
  rootRef,
  mode,
  tuning,
  a4 = 440,
}) {
  const centsMV = useMotionValue(0);
  const letterMV = useMotionValue("–");
  const accidentalMV = useMotionValue("");
  const octaveMV = useMotionValue("");
  const freqTextMV = useMotionValue("—");
  const centsTextMV = useMotionValue("—");
  const stringLabelMV = useMotionValue("");
  const announceMV = useMotionValue("");

  const configRef = useRef(null);
  configRef.current = { mode, tuning, a4 };

  const displayCentsRef = useRef(0);
  const stringIndexRef = useRef(0);
  const phaseRef = useRef("idle");
  const phaseSinceRef = useRef(0);
  const textRef = useRef({
    letter: "–",
    accidental: "",
    octave: "",
    frequency: "—",
    cents: "—",
    string: "",
    announce: "",
  });

  useEffect(() => {
    stringIndexRef.current = 0;
  }, [tuning.id]);

  useEffect(() => {
    const root = rootRef.current;
    if (root) root.dataset.phase = phaseRef.current;

    function frame(now) {
      const { mode, tuning, a4 } = configRef.current;
      const pitch = pitchRef.current;
      const active = (pitch.voiced || pitch.holding) && pitch.frequency > 0;
      const frequency = pitch.frequency;

      let rawCents = displayCentsRef.current;
      let note = null;
      let stringLabel = "";

      if (active) {
        note = freqToNote(frequency, a4);
        if (tuning.type === "chromatic" || mode === "chromatic") {
          rawCents = note ? note.cents : 0;
        } else {
          const nearest = nearestStringInTuning(frequency, tuning, a4);
          const index = nearest ? nearest.index : stringIndexRef.current;
          const string = tuning.strings[index];
          if (string) {
            stringIndexRef.current = index;
            rawCents = centsBetween(frequency, noteToFreq(string.midi, a4));
            stringLabel = string.label;
          } else if (note) {
            rawCents = note.cents;
          }
        }
      }

      const clamped = Math.max(-60, Math.min(60, rawCents));
      const rate = active ? TRACK_RATE : SETTLE_RATE;
      displayCentsRef.current +=
        ((active ? clamped : 0) - displayCentsRef.current) * rate;
      const display = displayCentsRef.current;

      centsMV.set(
        Math.round(
          Math.max(-CENTS_RANGE, Math.min(CENTS_RANGE, display)) * 100
        ) / 100
      );

      const distance = Math.abs(display);
      const phase = pitch.voiced
        ? distance <= IN_TUNE_CENTS
          ? "intune"
          : distance <= CLOSE_CENTS
            ? "close"
            : "off"
        : pitch.holding
          ? "holding"
          : "idle";

      if (phase !== phaseRef.current) {
        if (now - phaseSinceRef.current >= PHASE_HOLD_MS) {
          phaseRef.current = phase;
          phaseSinceRef.current = now;
          const root = rootRef.current;
          if (root) root.dataset.phase = phase;
        }
      } else {
        phaseSinceRef.current = now;
      }

      const text = textRef.current;
      const letter = note ? note.name[0] : "–";
      const accidental = note && note.isSharp ? "♯" : "";
      const octave = note ? String(note.octave) : "";
      const frequencyText = active ? frequency.toFixed(1) : "—";
      const centsText = active ? formatCents(display) : "—";

      if (letter !== text.letter) {
        text.letter = letter;
        letterMV.set(letter);
      }
      if (accidental !== text.accidental) {
        text.accidental = accidental;
        accidentalMV.set(accidental);
      }
      if (octave !== text.octave) {
        text.octave = octave;
        octaveMV.set(octave);
      }
      if (frequencyText !== text.frequency) {
        text.frequency = frequencyText;
        freqTextMV.set(frequencyText);
      }
      if (centsText !== text.cents) {
        text.cents = centsText;
        centsTextMV.set(centsText);
      }
      if (stringLabel !== text.string) {
        text.string = stringLabel;
        stringLabelMV.set(stringLabel);
      }

      const announce = note
        ? `${note.label}${phaseRef.current === "intune" ? ", in tune" : ""}`
        : "";
      if (announce !== text.announce) {
        text.announce = announce;
        announceMV.set(announce);
      }
    }

    return subscribe(frame);
  }, [
    subscribe,
    pitchRef,
    rootRef,
    centsMV,
    letterMV,
    accidentalMV,
    octaveMV,
    freqTextMV,
    centsTextMV,
    stringLabelMV,
    announceMV,
  ]);

  return useMemo(
    () => ({
      centsMV,
      letterMV,
      accidentalMV,
      octaveMV,
      freqTextMV,
      centsTextMV,
      stringLabelMV,
      announceMV,
    }),
    [
      centsMV,
      letterMV,
      accidentalMV,
      octaveMV,
      freqTextMV,
      centsTextMV,
      stringLabelMV,
      announceMV,
    ]
  );
}
