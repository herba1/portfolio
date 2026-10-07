"use client";

import { useCallback, useMemo, useState } from "react";

import MorphText from "@/app/ui/MorphText";

import CoverTile from "./CoverTile";
import OneLineBar from "./OneLineBar";
import { ICONS } from "./oneLineIcons";
import "./one-line.css";

const PANEL_SIZE = 6;
const EXIT_LIMIT = 4;

function panelCovers(covers, tab) {
  if (!covers.length) return [];
  const offset = Math.round((tab * covers.length) / ICONS.length);
  const list = [];
  for (let index = 0; index < PANEL_SIZE; index += 1) list.push(covers[(offset + index) % covers.length]);
  return list;
}

function Panel({ entry, covers, onExited }) {
  const list = useMemo(() => panelCovers(covers, entry.tab), [covers, entry.tab]);
  const exiting = entry.exitDirection !== 0;
  return (
    <div
      className="ol-panel"
      data-phase={exiting ? "exit" : "rest"}
      style={{ "--ol-exit-dir": entry.exitDirection || 1 }}
      id={exiting ? undefined : "ol-panel"}
      role={exiting ? undefined : "tabpanel"}
      aria-labelledby={exiting ? undefined : `ol-tab-${ICONS[entry.tab].key}`}
      aria-hidden={exiting ? "true" : undefined}
      inert={exiting}
      onAnimationEnd={(event) => {
        if (exiting && event.target === event.currentTarget) onExited(entry.key);
      }}
    >
      <div className="ol-panel__body" data-enter={entry.enterDirection ? "" : undefined} style={{ "--ol-enter-dir": entry.enterDirection || 1 }}>
        <ul className="ol-grid">
          {list.map((cover, index) => (
            <CoverTile key={`${cover.id}-${index}`} cover={cover} order={index} />
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function OneLineExperience({ covers }) {
  const [view, setView] = useState({
    active: 0,
    sequence: 0,
    enterDirection: 0,
    exiting: [],
  });

  const select = useCallback((index) => {
    setView((current) => {
      if (current.active === index) return current;
      const direction = index > current.active ? 1 : -1;
      const leaving = {
        key: current.sequence,
        tab: current.active,
        enterDirection: current.enterDirection,
        exitDirection: direction,
      };
      return {
        active: index,
        sequence: current.sequence + 1,
        enterDirection: direction,
        exiting: [...current.exiting, leaving].slice(-EXIT_LIMIT),
      };
    });
  }, []);

  const clearExited = useCallback((key) => {
    setView((current) => {
      if (!current.exiting.some((entry) => entry.key === key)) return current;
      return { ...current, exiting: current.exiting.filter((entry) => entry.key !== key) };
    });
  }, []);

  const panels = [
    ...view.exiting,
    { key: view.sequence, tab: view.active, enterDirection: view.enterDirection, exitDirection: 0 },
  ];
  const title = ICONS[view.active].title;

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
              <MorphText text={title} />
            </h2>
          </div>
          <div className="ol-panels">
            {panels.map((entry) => (
              <Panel key={entry.key} entry={entry} covers={covers} onExited={clearExited} />
            ))}
          </div>
          <OneLineBar active={view.active} onSelect={select} />
        </section>
      </div>
    </main>
  );
}
