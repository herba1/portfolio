"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

import SlotNumber from "@/app/ui/SlotNumber";

import TearOffPlayer from "./TearOffPlayer";
import { createTearOff } from "./tearOffEngine";
import "./tear-off.css";

const INITIAL_TORN = 2;
const EMPTY_DECK = { id: null, cover: null, status: "empty" };
const END_SNAP_SECONDS = 0.25;

function clockOf(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export default function TearOffExperience({ covers = [], embedded = false }) {
  const stageRef = useRef(null);
  const engineRef = useRef(null);
  const soundRef = useRef(true);
  const mouthRef = useRef(null);
  const elapsedRef = useRef(null);
  const totalRef = useRef(null);
  const progressRef = useRef(null);
  const [torn, setTorn] = useState(INITIAL_TORN);
  const [soundOn, setSoundOn] = useState(true);
  const [deck, setDeck] = useState(EMPTY_DECK);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const shown = { elapsed: "0:00", total: "0:30", fill: "" };
    const writeTime = (current, duration) => {
      const total = Math.round(duration);
      const elapsed = clockOf(current >= duration - END_SNAP_SECONDS ? total : current);
      const length = clockOf(total);
      if (elapsed !== shown.elapsed) {
        shown.elapsed = elapsed;
        elapsedRef.current?.setValue(elapsed);
      }
      if (length !== shown.total) {
        shown.total = length;
        totalRef.current?.setValue(length);
      }
      const fill = `scaleX(${Math.min(1, Math.max(0, current / duration)).toFixed(4)})`;
      if (fill !== shown.fill && progressRef.current) {
        shown.fill = fill;
        progressRef.current.style.transform = fill;
      }
    };
    const engine = createTearOff(stage, {
      covers,
      onCount: (next) => setTorn(next),
      onDeck: (next) => setDeck(next),
      onTime: writeTime,
      mouth: mouthRef.current,
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
      <header className="to-head">
        <h1 className="text-title-sm">Tear-off</h1>
        <div className="to-chrome">
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
        </div>
      </header>
      <div ref={stageRef} className="to-stage" role="group" aria-label="Ticket roll" />
      <TearOffPlayer
        deck={deck}
        mouthRef={mouthRef}
        elapsedRef={elapsedRef}
        totalRef={totalRef}
        progressRef={progressRef}
        onToggle={() => engineRef.current?.togglePlayback()}
        onEject={() => engineRef.current?.eject()}
      />
    </Root>
  );
}
