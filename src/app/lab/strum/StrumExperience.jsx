"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";

import MorphText from "@/app/ui/MorphText";
import SlotNumber from "@/app/ui/SlotNumber";

import StrumHarp from "./StrumHarp";
import StrumRatio from "./StrumRatio";
import StrumVoice, { audioSupported } from "./strumVoice";
import {
  DEFAULT_INTERVAL,
  DISPLAY_FROM,
  INTERVALS,
  MAX_LINES,
  POP_IN_STAGGER_MS,
  bandFor,
  baselineDrop,
  formatSize,
  formatTracking,
  lawTracking,
  pickTitles,
  sizeAt,
  voiceScale,
} from "./strumScale";
import "./strum.css";

const HINTS = {
  pointer: {
    locked: "Click once for sound, then sweep across the lines",
    playing: "Sweep across the lines, or pull one down and let go",
  },
  touch: {
    locked: "Tap once for sound, then swipe across the lines",
    playing: "Swipe across the lines, or pull one down and let go",
  },
};
const COARSE_QUERY = "(pointer: coarse)";
const LINE_SLOTS = Array.from({ length: MAX_LINES }, (_, index) => index);

const subscribeNothing = () => () => {};
const readAudioSupport = () => audioSupported();
const readServerAudioSupport = () => true;
const subscribeCoarse = (callback) => {
  const query = window.matchMedia(COARSE_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
};
const readCoarse = () => window.matchMedia(COARSE_QUERY).matches;
const readServerCoarse = () => false;

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName) || target.getAttribute("role") === "slider";
}

const Readouts = memo(function Readouts({ rowsRef, sizeRefs, trackingRefs }) {
  const initialRatio = INTERVALS[DEFAULT_INTERVAL].ratio;
  return (
    <div className="strum__readouts" aria-hidden="true">
      {LINE_SLOTS.map((index) => {
        const size = sizeAt(initialRatio, index);
        return (
          <div
            key={index}
            className="strum__readout"
            data-shown="false"
            data-ringing="false"
            ref={(element) => {
              rowsRef.current[index] = element;
            }}
          >
            <span className="strum__readout-inner text-ui-sm font-mono tabular-nums">
              <SlotNumber ref={sizeRefs[index]} value={formatSize(size)} />
              <span className="strum__readout-tracking">
                <span className="strum__readout-dot">·</span>
                <SlotNumber ref={trackingRefs[index]} value={formatTracking(size)} />
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
});

const Ghost = memo(function Ghost({ titles }) {
  const ratio = INTERVALS[DEFAULT_INTERVAL].ratio;
  return (
    <div className="strum__ghost" aria-hidden="true">
      {LINE_SLOTS.map((index) => {
        const size = sizeAt(ratio, index);
        const display = size >= DISPLAY_FROM;
        const tracking = lawTracking(size);
        return (
          <div
            key={index}
            className="strum__ghost-row"
            data-display={display ? "true" : "false"}
            style={{
              "--strum-band": `${bandFor(size)}px`,
              "--strum-drop": `${baselineDrop(size)}px`,
              "--strum-size": `${size}px`,
              "--strum-tracking": display ? `${(tracking / size).toFixed(4)}em` : `${tracking.toFixed(3)}px`,
              "--strum-delay": `${index * POP_IN_STAGGER_MS}ms`,
            }}
          >
            <span className="strum__ghost-string" />
            <span className="strum__ghost-drop" />
            <span className="strum__ghost-text">{titles[index % Math.max(1, titles.length)]}</span>
          </div>
        );
      })}
    </div>
  );
});

export default function StrumExperience({ covers }) {
  const [intervalIndex, setIntervalIndex] = useState(DEFAULT_INTERVAL);
  const [muted, setMuted] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const hasAudio = useSyncExternalStore(subscribeNothing, readAudioSupport, readServerAudioSupport);
  const coarse = useSyncExternalStore(subscribeCoarse, readCoarse, readServerCoarse);

  const titles = useMemo(() => pickTitles(covers), [covers]);
  const interval = INTERVALS[intervalIndex];

  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const rowsRef = useRef([]);
  const harpRef = useRef(null);
  const voiceRef = useRef(null);
  const intervalRef = useRef(intervalIndex);
  const mutedRef = useRef(muted);
  const sizeRefs = useMemo(() => LINE_SLOTS.map(() => ({ current: null })), []);
  const trackingRefs = useMemo(() => LINE_SLOTS.map(() => ({ current: null })), []);

  useEffect(() => {
    intervalRef.current = intervalIndex;
    mutedRef.current = muted;
  }, [intervalIndex, muted]);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return undefined;

    const voice = new StrumVoice();
    voice.setMuted(mutedRef.current);
    voiceRef.current = voice;
    const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const startInterval = INTERVALS[intervalRef.current];

    const harp = new StrumHarp({
      stage,
      canvas,
      rows: rowsRef.current,
      titles,
      ratio: startInterval.ratio,
      frequencies: voiceScale(startInterval),
      reducedMotion: reducedQuery.matches,
      onPluck: (pluck) => voice.pluck(pluck),
      onSettle: (index, size) => {
        sizeRefs[index].current?.setValue(formatSize(size));
        trackingRefs[index].current?.setValue(formatTracking(size));
      },
      onRunning: (running) => voice.setActive(running),
    });
    harpRef.current = harp;

    const handleReduced = () => harp.setReducedMotion(reducedQuery.matches);
    reducedQuery.addEventListener("change", handleReduced);

    const unlock = () => {
      if (voice.unlock()) setUnlocked(true);
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("touchend", unlock, true);
    window.addEventListener("keydown", unlock, true);

    const handleKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (/^[0-9]$/.test(event.key)) {
        if (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
        harp.pluckLine(event.key === "0" ? 9 : Number(event.key) - 1);
        return;
      }
      if (event.key === " " || event.code === "Space") {
        if (isTypingTarget(event.target)) return;
        event.preventDefault();
        harp.strum(event.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener("keydown", handleKey);

    return () => {
      reducedQuery.removeEventListener("change", handleReduced);
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("touchend", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      window.removeEventListener("keydown", handleKey);
      harp.dispose();
      voice.dispose();
      harpRef.current = null;
      voiceRef.current = null;
    };
  }, [titles, sizeRefs, trackingRefs]);

  useEffect(() => {
    harpRef.current?.setTuning(interval.ratio, voiceScale(interval), Boolean(voiceRef.current?.unlocked));
  }, [interval]);

  useEffect(() => {
    voiceRef.current?.setMuted(muted);
  }, [muted]);

  const toggleMute = useCallback(() => setMuted((value) => !value), []);

  const selectInterval = useCallback((next) => {
    setIntervalIndex(next);
    voiceRef.current?.chime(INTERVALS[next].ratio);
  }, []);

  const hints = coarse ? HINTS.touch : HINTS.pointer;
  const hint = !hasAudio || unlocked ? hints.playing : hints.locked;

  return (
    <main className="strum bg-surface text-ink">
      <header className="strum__head">
        <div className="strum__titles">
          <h1 className="text-title-sm">Strum</h1>
          <MorphText className="strum__hint text-ui-lg text-ink-secondary" text={hint} />
        </div>
        {hasAudio ? (
          <button
            type="button"
            className="strum__mute"
            aria-pressed={muted}
            aria-label={muted ? "Unmute" : "Mute"}
            onClick={toggleMute}
            data-muted={muted ? "true" : "false"}
          >
            <span className="strum__mute-icon" data-icon="on">
              <Volume2 size={18} strokeWidth={1.75} />
            </span>
            <span className="strum__mute-icon" data-icon="off">
              <VolumeX size={18} strokeWidth={1.75} />
            </span>
          </button>
        ) : null}
      </header>

      <div
        ref={stageRef}
        className="strum__stage"
        tabIndex={0}
        role="application"
        aria-roledescription="harp"
        aria-label="A type scale strung as a harp. Keys 1 to 0 pluck a line, space strums down, shift and space strums up."
        data-grabbing="false"
      >
        <Ghost titles={titles} />
        <canvas ref={canvasRef} className="strum__canvas" aria-hidden="true" />
        <ol className="sr-only">
          {titles.map((title) => (
            <li key={title}>{title}</li>
          ))}
        </ol>
        <Readouts rowsRef={rowsRef} sizeRefs={sizeRefs} trackingRefs={trackingRefs} />
      </div>

      <footer className="strum__tuning">
        <div className="strum__interval">
          <MorphText className="strum__interval-name text-heading" text={interval.name} />
          <SlotNumber className="strum__interval-ratio text-heading font-mono tabular-nums" value={interval.ratio.toFixed(3)} />
        </div>
        <StrumRatio index={intervalIndex} onChange={selectInterval} />
      </footer>
    </main>
  );
}
