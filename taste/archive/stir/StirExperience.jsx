"use client";

import { useCallback, useMemo, useRef } from "react";

import SlotNumber from "@/app/ui/SlotNumber";

import StirStage from "./StirStage";
import { REST_WEIGHT } from "./stirParams";
import { entryLabel, tracksFrom } from "./stirTracks";
import "./stir.css";

export default function StirExperience({ recent }) {
  const tracks = useMemo(() => tracksFrom(recent), [recent]);
  const gaugeRef = useRef(null);
  const gaugeBoxRef = useRef(null);

  const handleWeight = useCallback((weight) => {
    gaugeRef.current?.setValue(String(weight));
    gaugeBoxRef.current?.style.setProperty("--stir-gauge-weight", String(weight));
  }, []);

  return (
    <main className="stir bg-surface text-ink">
      <header className="stir__head">
        <div className="stir__titles">
          <h1 className="stir__title text-title-sm">Stir</h1>
          <p className="stir__hint text-ui-lg">
            Whip a loop through the tracklist, swipe a row to throw it, tap to scatter.
            <span className="stir__keys"> Arrows send a current, R calms it.</span>
          </p>
        </div>
        <p ref={gaugeBoxRef} className="stir__gauge text-ui-lg tabular-nums">
          <span className="stir__axis">wght</span>
          <SlotNumber ref={gaugeRef} value={String(REST_WEIGHT)} duration={420} />
        </p>
      </header>
      <StirStage tracks={tracks} onWeight={handleWeight} />
      <ol className="sr-only">
        {tracks.map((track, index) => (
          <li key={`${track.title}-${index}`}>{entryLabel(track, index)}</li>
        ))}
      </ol>
    </main>
  );
}
