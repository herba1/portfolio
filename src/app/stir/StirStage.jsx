"use client";

import { useEffect, useRef, useState } from "react";

import { entryLabel } from "./stirTracks";
import { createStirWall } from "./stirWall";

const FALLBACK_REPEATS = 6;
const HOW_TO =
  "Tracklist wall woven from endless rows that drift as one cloth, with an invisible hand stirring it every few seconds. Drag or hover to stir bold weight and each song's cover colour through the type and it rides away with the letters, swipe along a row to throw it and its neighbours follow, tap to push the ink outward in a ring.";
const HOW_TO_KEYS = " Arrow keys send a current in from that side, R calms it.";

function StillWall({ tracks }) {
  const entries = tracks.map((track, index) => entryLabel(track, index).replaceAll(", ", "  "));
  const text = Array.from({ length: FALLBACK_REPEATS }, () => entries.join("    ")).join("    ");
  return (
    <p className="stir__still text-ui-lg" aria-hidden="true">
      {text}
    </p>
  );
}

export default function StirStage({ tracks, embedded = false, live = true }) {
  const stageRef = useRef(null);
  const revealedRef = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!live) return undefined;
    const wall = createStirWall({
      stage: stageRef.current,
      tracks,
      keyTarget: embedded ? "stage" : "window",
      isRevealed: () => revealedRef.current,
      onReveal: () => {
        revealedRef.current = true;
      },
      onFail: () => setFailed(true),
    });
    return () => wall.destroy();
  }, [tracks, embedded, live]);

  return (
    <div
      ref={stageRef}
      className="stir__stage bg-surface text-ink"
      tabIndex={0}
      role="application"
      aria-roledescription="tracklist wall"
      aria-label={HOW_TO + HOW_TO_KEYS}
      data-failed={failed ? "true" : undefined}
    >
      {failed ? <StillWall tracks={tracks} /> : null}
    </div>
  );
}
