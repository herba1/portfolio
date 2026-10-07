"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

import SlotNumber from "@/app/ui/SlotNumber";

import { createTearOff } from "./tearOffEngine";
import "./tear-off.css";

const INITIAL_TORN = 2;

export default function TearOffExperience({ covers = [], embedded = false }) {
  const stageRef = useRef(null);
  const engineRef = useRef(null);
  const soundRef = useRef(true);
  const [torn, setTorn] = useState(INITIAL_TORN);
  const [soundOn, setSoundOn] = useState(true);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const engine = createTearOff(stage, {
      covers,
      onCount: (next) => setTorn(next),
      reducedMotion: motionQuery.matches,
    });
    engine.setSound(soundRef.current);
    engineRef.current = engine;
    const onMotionChange = (event) => engine.setReducedMotion(event.matches);
    motionQuery.addEventListener("change", onMotionChange);
    return () => {
      motionQuery.removeEventListener("change", onMotionChange);
      engine.destroy();
      engineRef.current = null;
    };
  }, [covers]);

  useEffect(() => {
    soundRef.current = soundOn;
    engineRef.current?.setSound(soundOn);
  }, [soundOn]);

  const Root = embedded ? "div" : "main";

  return (
    <Root className="to-root bg-surface text-ink" data-embedded={embedded ? "" : undefined}>
      <div ref={stageRef} className="to-stage" role="group" aria-label="Ticket roll" />
      <header className="to-head">
        <h1 className="text-title-sm">Tear-off</h1>
      </header>
      <footer className="to-chrome">
        <span className="to-count text-ui-lg">
          <SlotNumber value={torn} label={`${torn} torn`} />
          <span aria-hidden="true">torn</span>
        </span>
        <button
          type="button"
          className="to-button to-button--icon"
          aria-label="Sound"
          aria-pressed={soundOn}
          onClick={() => setSoundOn((value) => !value)}
        >
          <span key={soundOn ? "on" : "off"} className="to-button__icon">
            {soundOn ? <Volume2 size={16} strokeWidth={1.75} /> : <VolumeX size={16} strokeWidth={1.75} />}
          </span>
        </button>
        <button type="button" className="to-button" onClick={() => engineRef.current?.newRoll()}>
          New roll
        </button>
      </footer>
    </Root>
  );
}
