"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import MorphText from "@/app/ui/MorphText";

import OneLineBar from "./OneLineBar";
import OneLineShelf from "./OneLineShelf";
import { ICONS } from "./oneLineIcons";
import { buildShelves } from "./oneLineShelves";
import { THREAD_SWATCH } from "./oneLineThread";
import "./one-line.css";

const revealedLines = new Set();

export default function OneLineExperience({ embedded = false, tracks }) {
  const revealKey = embedded ? "tile" : "page";
  const [revealedBefore] = useState(() => revealedLines.has(revealKey));
  const [risen, setRisen] = useState(revealedBefore);
  const [active, setActive] = useState(0);
  const shelves = useMemo(() => buildShelves(tracks), [tracks]);
  const select = useCallback((index) => setActive(index), []);
  const handleRiseEnd = useCallback((event) => {
    if (event.animationName === "ol-rise" && event.target.classList.contains("ol-stage")) setRisen(true);
  }, []);

  useEffect(() => {
    revealedLines.add(revealKey);
  }, [revealKey]);
  const icon = ICONS[active];
  const Root = embedded ? "div" : "main";

  return (
    <Root
      className="ol-root bg-surface text-ink"
      data-embedded={embedded ? "" : undefined}
      data-scroll-contain={embedded ? undefined : ""}
      data-revealed={risen ? "" : undefined}
      onAnimationEnd={handleRiseEnd}
      style={{ "--ol-thread": THREAD_SWATCH }}
    >
      {embedded ? null : <h1 className="ol-title text-heading">One line</h1>}
      <section className="ol-stage rounded-xl" aria-label="Music app">
        <div className="ol-screen" id="ol-panel" role="tabpanel" aria-labelledby={`ol-tab-${icon.key}`}>
          <p className="ol-screen__title text-title-sm">
            <MorphText text={icon.title} />
          </p>
          <OneLineShelf shelves={shelves} active={active} />
        </div>
        <OneLineBar active={active} onSelect={select} introPlayed={revealedBefore} />
      </section>
    </Root>
  );
}
