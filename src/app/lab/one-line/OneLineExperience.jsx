"use client";

import { useCallback, useMemo, useState } from "react";

import MorphText from "@/app/ui/MorphText";
import useCovers from "@/app/ui/useCovers";

import CoverTile from "./CoverTile";
import OneLineBar from "./OneLineBar";
import { ICONS } from "./oneLineIcons";
import "./one-line.css";

const PANEL_SIZE = 6;

function panelCovers(covers, tab) {
  if (!covers.length) return [];
  const offset = Math.round((tab * covers.length) / ICONS.length);
  const list = [];
  for (let index = 0; index < PANEL_SIZE; index += 1) list.push(covers[(offset + index) % covers.length]);
  return list;
}

function Panel({ tab, phase, covers, loaded, onExited }) {
  const list = useMemo(() => panelCovers(covers, tab), [covers, tab]);
  const exiting = phase === "exit";
  return (
    <div
      className="ol-panel"
      data-phase={phase}
      id={exiting ? undefined : "ol-panel"}
      role={exiting ? undefined : "tabpanel"}
      aria-labelledby={exiting ? undefined : `ol-tab-${ICONS[tab].key}`}
      aria-hidden={exiting ? "true" : undefined}
      inert={exiting}
      onAnimationEnd={(event) => {
        if (exiting && event.target === event.currentTarget) onExited();
      }}
    >
      <ul className="ol-grid">
        {list.map((cover, index) => (
          <CoverTile key={`${cover.id}-${index}`} cover={cover} item={loaded.get(cover.image)} order={index} />
        ))}
      </ul>
    </div>
  );
}

export default function OneLineExperience({ covers }) {
  const [view, setView] = useState({ active: 0, previous: -1, direction: 1, sequence: 0 });
  const items = useCovers(covers);
  const loaded = useMemo(() => new Map(items.map((item) => [item.image, item])), [items]);

  const select = useCallback((index) => {
    setView((current) => {
      if (current.active === index) return current;
      return {
        active: index,
        previous: current.active,
        direction: index > current.active ? 1 : -1,
        sequence: current.sequence + 1,
      };
    });
  }, []);

  const exitedSequence = view.sequence;
  const clearPrevious = useCallback(() => {
    setView((current) => (current.sequence === exitedSequence ? { ...current, previous: -1 } : current));
  }, [exitedSequence]);

  const panels = [];
  if (view.previous >= 0) panels.push({ key: view.sequence - 1, tab: view.previous, phase: "exit" });
  panels.push({ key: view.sequence, tab: view.active, phase: view.sequence === 0 ? "rest" : "enter" });

  return (
    <main className="ol-root bg-surface text-ink">
      <div className="ol-column">
        <header className="ol-head">
          <h1 className="ol-head__title text-heading">One line</h1>
          <p className="ol-head__hint text-ui-lg">Tap a tab, or drag along the bar and pull the line out.</p>
        </header>
        <section className="ol-phone rounded-xl" aria-label="Music app">
          <div className="ol-phone__head">
            <h2 className="ol-phone__title text-title-sm">
              <MorphText text={ICONS[view.active].title} />
            </h2>
          </div>
          <div className="ol-panels" style={{ "--ol-dir": view.direction }}>
            {panels.map((panel) => (
              <Panel key={panel.key} tab={panel.tab} phase={panel.phase} covers={covers} loaded={loaded} onExited={clearPrevious} />
            ))}
          </div>
          <OneLineBar active={view.active} onSelect={select} />
        </section>
      </div>
    </main>
  );
}
