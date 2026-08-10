"use client";

import { memo, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { DEFAULT_TUNING_ID, getTuning } from "./tunings";
import { noteToFreq } from "./pitch/notes";
import useTuner from "./useTuner";
import useTuningEngine from "./useTuningEngine";
import MicGate from "./MicGate";
import NoteReadout from "./NoteReadout";
import Waveform from "./Waveform";
import TunerMeter from "./TunerMeter";
import Controls from "./Controls";
import TunerDevControls from "./TunerDevControls";
import { isDevView } from "@/lib/viewMode";
import "./tuner.css";

const IS_DEV = isDevView();
const A4 = 440;
const LOW_MARGIN = 0.87;
const HIGH_MARGIN = 4;
const LONG_WINDOW_BELOW_HZ = 55;

function analysisFor(tuning, a4) {
  if (!tuning.strings.length) {
    return {
      windowSize: 4096,
      minFrequency: 65,
      maxFrequency: 1400,
      detectMs: 33,
    };
  }
  const midis = tuning.strings.map((string) => string.midi);
  const lowest = noteToFreq(Math.min(...midis), a4);
  const highest = noteToFreq(Math.max(...midis), a4);
  const minFrequency = lowest * LOW_MARGIN;
  const maxFrequency = Math.min(1600, highest * HIGH_MARGIN);
  const longWindow = minFrequency < LONG_WINDOW_BELOW_HZ;
  return {
    windowSize: longWindow ? 8192 : 4096,
    minFrequency,
    maxFrequency,
    detectMs: longWindow ? 45 : 33,
  };
}

const Figures = memo(function Figures({ freqTextMV, centsTextMV }) {
  return (
    <div className="tuner__figures">
      <span className="tuner__figure">
        <motion.span>{freqTextMV}</motion.span> Hz
      </span>
      <span className="tuner__figure">
        <motion.span>{centsTextMV}</motion.span> cents
      </span>
    </div>
  );
});

export default function TunerExperience() {
  const [mode, setMode] = useState("auto");
  const [tuningId, setTuningId] = useState(DEFAULT_TUNING_ID);
  const rootRef = useRef(null);

  const tuning = getTuning(tuningId);
  const analysis = useMemo(() => analysisFor(tuning, A4), [tuning]);

  const { status, enable, pitchRef, subscribe } = useTuner(analysis);
  const readouts = useTuningEngine({
    pitchRef,
    subscribe,
    rootRef,
    mode,
    tuning,
    a4: A4,
  });

  const running = status === "running";

  return (
    <main className="tuner" ref={rootRef}>
      <Waveform pitchRef={pitchRef} subscribe={subscribe} />

      <div className="sr-only" role="status" aria-live="polite">
        <motion.span>{readouts.announceMV}</motion.span>
      </div>

      <div className="tuner__ui">
        <section className="tuner__readout">
          <div className="tuner__note-row">
            <div className="tuner__note-main">
              {running ? (
                <NoteReadout
                  letterMV={readouts.letterMV}
                  accidentalMV={readouts.accidentalMV}
                  octaveMV={readouts.octaveMV}
                />
              ) : (
                <MicGate status={status} onEnable={enable} />
              )}
            </div>
          </div>

          <div className="tuner__meter-wrap">
            <TunerMeter centsMV={readouts.centsMV} />
          </div>

          <Figures
            freqTextMV={readouts.freqTextMV}
            centsTextMV={readouts.centsTextMV}
          />

          <footer className="tuner__foot">
            <Controls
              mode={mode}
              setMode={setMode}
              tuningId={tuningId}
              setTuningId={setTuningId}
            />
          </footer>
        </section>
      </div>

      {IS_DEV && <TunerDevControls />}
    </main>
  );
}
