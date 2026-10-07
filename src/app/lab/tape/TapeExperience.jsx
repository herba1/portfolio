"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import PlayPauseIcon from "@/app/ui/PlayPauseIcon";
import SlotNumber from "@/app/ui/SlotNumber";

import { CAST, SHUTTLE_CHIPS } from "./tapeConstants";
import { mountTape } from "./tapeEngine";
import { clipWords, fetchTapeWords } from "./tapeLyrics";
import "./tape.css";

const INITIAL_DECK = {
  playing: false,
  shuttle: 1,
  audible: false,
  audio: "loading",
  direction: "up",
  worn: false,
  offset: undefined,
};

const HEAD_HEIGHT = 280;
const SMEAR_FILTER = "tape-smear";

export default function TapeExperience() {
  const stripRef = useRef(null);
  const plateRef = useRef(null);
  const wordsRef = useRef(null);
  const smearBlurRef = useRef(null);
  const headSvgRef = useRef(null);
  const headPathRef = useRef(null);
  const timeRef = useRef(null);
  const rateRef = useRef(null);
  const signRef = useRef(null);
  const castRef = useRef(null);
  const engineRef = useRef(null);
  const [deck, setDeck] = useState(INITIAL_DECK);
  const [lyricWords, setLyricWords] = useState(null);

  useEffect(() => {
    const engine = mountTape(
      {
        strip: stripRef.current,
        plateHost: plateRef.current,
        wordsLayer: wordsRef.current,
        smearBlur: smearBlurRef.current,
        smearFilter: SMEAR_FILTER,
        headSvg: headSvgRef.current,
        headPath: headPathRef.current,
        timeSlot: timeRef,
        rateSlot: rateRef,
        sign: signRef.current,
        cast: castRef.current,
      },
      (patch) => setDeck((current) => ({ ...current, ...patch })),
    );
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchTapeWords(controller.signal)
      .then(setLyricWords)
      .catch(() => {
        if (!controller.signal.aborted) setLyricWords([]);
      });
    return () => controller.abort();
  }, []);

  const words = useMemo(
    () => (lyricWords && typeof deck.offset === "number" ? clipWords(lyricWords, deck.offset) : null),
    [lyricWords, deck.offset],
  );
  const laneOpen = deck.offset !== null && (words === null || words.length > 0);

  useEffect(() => {
    engineRef.current?.refreshWords(laneOpen);
  }, [words, laneOpen]);

  const sounding = deck.playing && (deck.audible || deck.audio === "none");

  return (
    <main className="tape">
      <header className="tape__intro">
        <h1 className="text-title-sm">Tape</h1>
        <p className="text-ui-lg text-ink-secondary">
          Grab the tape and pull, backwards too.
          <span className="tape__keys"> Space for the motor, J K L to shuttle.</span>
        </p>
      </header>

      <svg className="tape__defs" width="0" height="0" aria-hidden="true" focusable="false">
        <filter id={SMEAR_FILTER} x="-25%" y="0" width="150%" height="100%" colorInterpolationFilters="sRGB">
          <feGaussianBlur ref={smearBlurRef} stdDeviation="0 0" />
        </filter>
      </svg>

      <section className="tape__deck" aria-label="Ask Me Why on tape">
        <div
          ref={stripRef}
          className="tape__strip"
          role="slider"
          tabIndex={0}
          aria-label="Tape position"
          aria-valuemin={0}
          aria-valuemax={29}
          aria-valuenow={0}
          aria-valuetext="0:00"
          aria-keyshortcuts="Space J K L ArrowLeft ArrowRight"
        >
          <div ref={plateRef} className="tape__plate-host" />
          <div ref={wordsRef} className="tape__words">
            {words?.map((word, index) => (
              <span
                key={`${word.start}-${index}`}
                className="tape__word"
                data-word=""
                data-start={word.start}
                data-end={word.end}
                data-singers={word.singers}
              >
                <span className="tape__word-ink">{word.text}</span>
              </span>
            ))}
          </div>
          <svg
            ref={headSvgRef}
            className="tape__head"
            width="40"
            height={HEAD_HEIGHT}
            viewBox={`0 0 40 ${HEAD_HEIGHT}`}
            aria-hidden="true"
          >
            <path ref={headPathRef} d={`M20 4 Q20 ${HEAD_HEIGHT / 2} 20 ${HEAD_HEIGHT - 4}`} />
          </svg>
        </div>

        <div className="tape__readout" aria-hidden="true">
          <div className="tape__readout-inner">
            <span className="tape__time text-heading">
              <SlotNumber ref={timeRef} value="0:00.0" duration={280} stagger={24} direction={deck.direction} />
            </span>
            <span className="tape__rate text-ui-lg">
              <span>×</span>
              <span ref={signRef} className="tape__sign">
                −
              </span>
              <SlotNumber ref={rateRef} value="0.00" duration={360} stagger={30} />
            </span>
            {deck.audio === "none" ? <span className="tape__note text-ui-sm text-ink-secondary">No audio</span> : null}
          </div>
        </div>

        <div className="tape__controls">
          <button
            type="button"
            className="tape__play"
            aria-label={sounding ? "Pause" : "Play"}
            onClick={() => engineRef.current?.togglePlay()}
          >
            <PlayPauseIcon playing={sounding} size={20} />
          </button>

          <div className="tape__shuttle" role="group" aria-label="Motor speed">
            {SHUTTLE_CHIPS.map((chip) => {
              const active = deck.playing && deck.shuttle === chip.value;
              return (
                <button
                  key={chip.value}
                  type="button"
                  className="tape__chip text-ui-lg"
                  data-active={active ? "" : undefined}
                  aria-pressed={active}
                  onClick={() => engineRef.current?.shuttleTo(chip.value)}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={deck.worn}
            className="tape__worn text-ui-lg"
            data-on={deck.worn ? "" : undefined}
            onClick={() => engineRef.current?.setWorn(!deck.worn)}
          >
            <span className="tape__worn-track">
              <span className="tape__worn-knob" />
            </span>
            Worn tape
          </button>

          <div ref={castRef} className="tape__track">
            <span className="tape__cast">
              {CAST.map((member) => (
                <span
                  key={member.id}
                  className="tape__face"
                  data-cast={member.id}
                  data-on={member.id === "john" ? "" : undefined}
                  role="img"
                  aria-label={member.name}
                  style={{ backgroundImage: `url(${member.image})` }}
                />
              ))}
            </span>
            <span className="text-ui-lg">Ask Me Why · The Beatles</span>
          </div>
        </div>
      </section>
    </main>
  );
}
