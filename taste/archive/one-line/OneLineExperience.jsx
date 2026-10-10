"use client";

import { useCallback, useState } from "react";

import MorphText from "@/app/ui/MorphText";

import OneLineBar from "./OneLineBar";
import { ICONS } from "./oneLineIcons";
import { THREAD_SWATCH } from "./oneLineThread";
import "./one-line.css";

export default function OneLineExperience({ embedded = false }) {
  const [active, setActive] = useState(0);
  const select = useCallback((index) => setActive(index), []);
  const icon = ICONS[active];
  const Root = embedded ? "div" : "main";

  return (
    <Root
      className="ol-root bg-surface text-ink"
      data-embedded={embedded ? "" : undefined}
      data-scroll-contain={embedded ? undefined : ""}
      style={{ "--ol-thread": THREAD_SWATCH }}
    >
      {embedded ? null : <h1 className="ol-title text-heading">One line</h1>}
      <section className="ol-stage rounded-xl" aria-label="Music app">
        <div className="ol-screen" id="ol-panel" role="tabpanel" aria-labelledby={`ol-tab-${icon.key}`}>
          <p className="ol-screen__title text-title-sm">
            <MorphText text={icon.title} />
          </p>
        </div>
        <OneLineBar active={active} onSelect={select} demo={embedded} />
      </section>
    </Root>
  );
}
