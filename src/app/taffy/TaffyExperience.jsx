"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import ClientOnly from "@/app/ui/ClientOnly";
import useNearViewport from "@/app/experiments/useNearViewport";

import { pickTitles } from "./taffyParams";
import "./taffy.css";

const loadScene = () => import("./TaffyScene");
const revealedTaffies = new Set();
if (typeof window !== "undefined") loadScene();

function useMedia(query, serverValue) {
  const subscribe = useCallback(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

const HOW_TO = "Pull a letter until it snaps, or drop it on another to bond them. Tap a bond to cut it, or tap the paper for the next title.";
const HOW_TO_KEYS = " Left and right arrow keys change the title.";

export default function TaffyExperience({ covers, embedded = false }) {
  const titles = useMemo(() => pickTitles(covers), [covers]);
  const rootRef = useRef(null);
  const near = useNearViewport(rootRef);
  const revealKey = embedded ? "tile" : "page";
  const [revealedBefore] = useState(() => revealedTaffies.has(revealKey));
  const [revealSettled, setRevealSettled] = useState(revealedBefore);
  const [index, setIndex] = useState(0);
  const [shownTitle, setShownTitle] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const reducedMotion = useMedia("(prefers-reduced-motion: reduce)", false);

  const count = titles.length;
  const shownIndex = shownTitle === null ? -1 : titles.findIndex((title) => title.title === shownTitle);
  const shown = shownIndex >= 0 ? titles[shownIndex] : null;
  const fallbackEntry = titles[index] ?? titles[0];

  const advance = useCallback(
    (delta, auto = false) => {
      if (!count) return;
      setQuiet(auto);
      setIndex((value) => (value + delta + count) % count);
    },
    [count],
  );

  const handleTitleShown = useCallback((text) => setShownTitle(text), []);
  const handleUnsupported = useCallback(() => setUnsupported(true), []);
  const handleReady = useCallback(() => {
    revealedTaffies.add(revealKey);
    setRevealed(true);
  }, [revealKey]);
  const handleRevealEnd = useCallback((event) => {
    if (event.animationName === "taffy-reveal") setRevealSettled(true);
  }, []);

  useEffect(() => {
    if (embedded) return undefined;
    const handleKey = (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (target?.classList?.contains("taffy-stage__letter")) return;
      if (event.key === "ArrowRight") advance(1);
      else if (event.key === "ArrowLeft") advance(-1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [advance, embedded]);

  const Root = embedded ? "div" : "main";

  return (
    <Root
      ref={rootRef}
      className="taffy"
      data-embedded={embedded ? "true" : undefined}
      data-ready={revealed ? "true" : undefined}
      data-revealed={revealSettled ? "true" : undefined}
      onAnimationEnd={handleRevealEnd}
    >
      <p className="sr-only">{embedded ? HOW_TO : HOW_TO + HOW_TO_KEYS}</p>
      {unsupported ? (
        fallbackEntry ? (
          <p className="taffy__fallback font-sans">{fallbackEntry.title}</p>
        ) : null
      ) : near ? (
        <ClientOnly
          load={loadScene}
          titles={titles}
          index={index}
          reducedMotion={reducedMotion}
          embedded={embedded}
          revealed={revealed}
          skipIntro={revealedBefore}
          onAdvance={advance}
          onReady={handleReady}
          onTitleShown={handleTitleShown}
          onUnsupported={handleUnsupported}
        />
      ) : null}
      {!embedded ? (
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {shown && !quiet ? `${shown.title}${shown.artist ? ` by ${shown.artist}` : ""}, ${shownIndex + 1} of ${count}` : ""}
        </p>
      ) : null}
    </Root>
  );
}
