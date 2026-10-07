"use client";

import { useEffect, useRef, useState } from "react";

import { entryLabel } from "./stirTracks";
import { createStirWall } from "./stirWall";

const FALLBACK_REPEATS = 6;

function StillWall({ tracks }) {
  const entries = tracks.map((track, index) => entryLabel(track, index).replaceAll(", ", "  "));
  const text = Array.from({ length: FALLBACK_REPEATS }, () => entries.join("    ")).join("    ");
  return (
    <p className="stir__still text-ui-lg" aria-hidden="true">
      {text}
    </p>
  );
}

export default function StirStage({ tracks, onWeight }) {
  const stageRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const markFailed = () => setFailed(true);
    const wall = createStirWall({
      stage: stageRef.current,
      tracks,
      onWeight,
      onFail: markFailed,
    });
    return () => wall.destroy();
  }, [tracks, onWeight]);

  return (
    <div
      ref={stageRef}
      className="stir__stage bg-surface text-ink"
      tabIndex={0}
      role="application"
      aria-roledescription="tracklist wall"
      aria-label="Tracklist wall. Drag to stir bold weight through the type, tap to push the ink outward in a ring, arrow keys send a current in from that side, R calms it."
      data-failed={failed ? "true" : undefined}
    >
      {failed ? <StillWall tracks={tracks} /> : null}
    </div>
  );
}
