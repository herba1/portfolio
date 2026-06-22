"use client";

import { useEffect, useState } from "react";
import { DEFAULT_TUNING_ID, getTuning } from "./tunings";
import { freqToNote, formatCents } from "./pitch/notes";
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

export default function TunerExperience() {
  const [mode, setMode] = useState("auto"); // "auto" | "chromatic"
  const [tuningId, setTuningId] = useState(DEFAULT_TUNING_ID);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const a4 = 440;

  const tuning = getTuning(tuningId);
  const analysis =
    tuning.type === "bass"
      ? { fftSize: 4096, minFrequency: 35, detectMs: 45 }
      : { fftSize: 2048, minFrequency: 55, detectMs: 33 };

  const { status, enable, liveFreq, freqRef, getAnalyser } = useTuner(analysis);

  const { centsMV, target } = useTuningEngine({
    freqRef,
    mode,
    tuning,
    a4,
    selectedIndex,
    setSelectedIndex,
  });

  useEffect(() => {
    setSelectedIndex(0);
  }, [tuningId]);

  const note = freqToNote(liveFreq, a4);
  const active = !!note;
  const running = status === "running";

  const inTune = target.active && target.inTune;

  const freqStr = active && liveFreq ? liveFreq.toFixed(1) : "—";
  const centsStr = target.active ? formatCents(target.cents) : "—";

  return (
    <main className="tuner">
      <Waveform getAnalyser={getAnalyser} active={target.active} inTune={inTune} />

      <div className="sr-only" role="status" aria-live="polite">
        {active ? `${note.label}${inTune ? ", in tune" : ""}` : ""}
      </div>

      <div className="tuner__ui">
        <section className="tuner__readout">
          <div className="tuner__note-row">
            <div className="tuner__note-main">
              {running ? (
                <NoteReadout note={note} />
              ) : (
                <MicGate status={status} onEnable={enable} />
              )}
            </div>
          </div>

          <div className="tuner__meter-wrap">
            <TunerMeter centsMV={centsMV} active={target.active} inTune={inTune} />
          </div>

          <div className="tuner__figures">
            <span className="tuner__figure">{freqStr} Hz</span>
            <span className="tuner__figure">{centsStr} cents</span>
          </div>

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
