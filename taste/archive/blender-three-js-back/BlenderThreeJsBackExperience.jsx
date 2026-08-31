"use client";

import { useCallback, useEffect, useState } from "react";
import BlenderThreeJsBackScene from "./BlenderThreeJsBackScene";
import BlenderThreeJsBackControls from "./BlenderThreeJsBackControls";
import { DEFAULT_SPEED, SPEEDS, TIPS } from "./blenderThreeJsBackParams";
import "./blender-three-js-back.css";

export default function BlenderThreeJsBackExperience() {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speedId, setSpeedId] = useState(DEFAULT_SPEED);

  const step = useCallback((delta) => {
    setPlaying(false);
    setIndex((prev) => (prev + delta + TIPS.length) % TIPS.length);
  }, []);

  const select = useCallback((next) => {
    setPlaying(false);
    setIndex(next);
  }, []);

  useEffect(() => {
    if (!playing) return undefined;
    const speed = SPEEDS.find((s) => s.id === speedId) ?? SPEEDS[1];
    const id = setInterval(() => {
      setIndex((prev) => (prev + 1) % TIPS.length);
    }, speed.ms);
    return () => clearInterval(id);
  }, [playing, speedId]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.target instanceof HTMLElement && event.target.closest("button, select, input")) return;
      if (event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowLeft") step(-1);
      else if (event.key === " ") {
        event.preventDefault();
        setPlaying((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step]);

  return (
    <main className="btjb">
      <header className="btjb__head">
        <p className="text-ink-secondary text-ui-lg">Blender to Three.js and back</p>
        <h1 className="btjb__title text-ink text-title-sm sm:text-title">
          Ten tips for a round trip that doesn&rsquo;t break the mesh
        </h1>
      </header>

      <BlenderThreeJsBackScene tips={TIPS} index={index} onSelect={select} />

      <BlenderThreeJsBackControls
        playing={playing}
        speedId={speedId}
        onTogglePlay={() => setPlaying((prev) => !prev)}
        onStep={step}
        onSpeed={setSpeedId}
      />
    </main>
  );
}
