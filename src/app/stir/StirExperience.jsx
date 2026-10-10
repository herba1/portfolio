"use client";

import { useMemo, useRef } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import StirStage from "./StirStage";
import { entryLabel, tracksFrom } from "./stirTracks";
import "./stir.css";

export default function StirExperience({ recent, embedded = false }) {
  const tracks = useMemo(() => tracksFrom(recent), [recent]);
  const rootRef = useRef(null);
  const near = useNearViewport(rootRef);
  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="stir" data-embedded={embedded ? "true" : undefined}>
      <StirStage tracks={tracks} embedded={embedded} live={near} />
      <ol className="sr-only">
        {tracks.map((track, index) => (
          <li key={`${track.title}-${index}`}>{entryLabel(track, index)}</li>
        ))}
      </ol>
    </Root>
  );
}
