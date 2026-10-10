"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MorphText from "@/app/ui/MorphText";
import SlotNumber from "@/app/ui/SlotNumber";
import SandField from "./SandField";
import { DEFAULT_GRAIN, FALLBACK_COVERS, GRAIN_OPTIONS, grainPx } from "./sandParams";
import "./sand.css";

const formatCount = (count) => count.toLocaleString("en-GB");
const shapeOf = (text) => text.replace(/\d/g, "#");
const ROLL_SETTLE_MS = 580;

function fitToShape(count, shape) {
  const digits = String(count).padStart((shape.match(/#/g) ?? []).length, "0");
  let cursor = digits.length;
  let out = "";
  for (let index = shape.length - 1; index >= 0; index -= 1) {
    out = (shape[index] === "#" ? digits[--cursor] ?? "0" : shape[index]) + out;
  }
  return out;
}

const isTyping = (target) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

const ownsArrowKeys = (target) => target instanceof Element && Boolean(target.closest("[role=radiogroup], a[href]"));

const GRAIN_STEP_KEYS = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export default function SandExperience({ covers, embedded = false }) {
  const surfaceRef = useRef(null);
  const ringRef = useRef(null);
  const countRef = useRef(null);
  const fieldRef = useRef(null);
  const grainRef = useRef(DEFAULT_GRAIN);
  const shownRef = useRef("0");
  const rollTimerRef = useRef(0);

  const [grain, setGrain] = useState(DEFAULT_GRAIN);
  const [track, setTrack] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [busy, setBusy] = useState(false);
  const [hasLoose, setHasLoose] = useState(false);

  const list = covers?.length ? covers : FALLBACK_COVERS;

  useEffect(() => {
    grainRef.current = grain;
    fieldRef.current?.setGrain(grainPx(grain));
  }, [grain]);

  const showCount = useCallback((count) => {
    const slot = countRef.current;
    if (!slot) return;
    window.clearTimeout(rollTimerRef.current);
    const text = formatCount(count);
    const shown = shownRef.current;
    const nextShape = shapeOf(text);
    const shownShape = shapeOf(shown);
    if (nextShape === shownShape) {
      shownRef.current = text;
      slot.setValue(text);
      return;
    }
    if (nextShape.length > shownShape.length) {
      const zeroed = text.replace(/\d/g, "0");
      shownRef.current = zeroed;
      slot.setValue(zeroed);
      rollTimerRef.current = window.setTimeout(() => {
        shownRef.current = text;
        countRef.current?.setValue(text);
      }, 48);
      return;
    }
    const fitted = fitToShape(count, shownShape);
    shownRef.current = fitted;
    slot.setValue(fitted);
    rollTimerRef.current = window.setTimeout(() => {
      shownRef.current = text;
      countRef.current?.setValue(text);
    }, ROLL_SETTLE_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(rollTimerRef.current), []);

  useEffect(() => {
    const field = new SandField({
      surface: surfaceRef.current,
      ring: ringRef.current,
      covers: list,
      grainPx: grainPx(grainRef.current),
      embedded,
      onCover: (cover) => setTrack({ title: cover.title ?? "", artist: cover.artist ?? "" }),
      onLoose: (count) => {
        showCount(count);
        setHasLoose(count > 0);
      },
      onReady: () => setPhase("ready"),
      onBusy: (value) => setBusy(value),
      onError: () => setPhase("error"),
    });
    fieldRef.current = field;
    return () => {
      field.destroy();
      if (fieldRef.current === field) fieldRef.current = null;
    };
  }, [list, embedded, showCount]);

  const handleKeyDown = useCallback((event) => {
    const field = fieldRef.current;
    if (!field || event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
    const onTray = event.target === surfaceRef.current;
    if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      if (event.shiftKey) field.restore();
      else field.rebuild();
    } else if ((event.key === "ArrowRight" || event.key === "n" || event.key === "N") && !ownsArrowKeys(event.target)) {
      event.preventDefault();
      field.next();
    } else if (event.key === "c" || event.key === "C" || (onTray && (event.key === " " || event.key === "Enter"))) {
      event.preventDefault();
      field.crumble();
    }
  }, []);

  useEffect(() => {
    if (embedded) return undefined;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [embedded, handleKeyDown]);

  const handleRebuild = useCallback(() => fieldRef.current?.rebuild(), []);
  const handleNext = useCallback(() => fieldRef.current?.next(), []);

  const handleGrainKeyDown = useCallback((event) => {
    const direction = GRAIN_STEP_KEYS[event.key];
    if (!direction) return;
    event.preventDefault();
    const options = Array.from(event.currentTarget.querySelectorAll("[role=radio]"));
    const current = options.indexOf(document.activeElement);
    const nextIndex = (Math.max(0, current) + direction + GRAIN_OPTIONS.length) % GRAIN_OPTIONS.length;
    options[nextIndex]?.focus();
    setGrain(GRAIN_OPTIONS[nextIndex].key);
  }, []);

  const grainIndex = Math.max(0, GRAIN_OPTIONS.findIndex((option) => option.key === grain));
  const Root = embedded ? "div" : "main";

  return (
    <Root
      className="sand bg-surface text-ink"
      data-phase={phase}
      data-busy={busy || undefined}
      data-embedded={embedded || undefined}
      onKeyDown={embedded ? handleKeyDown : undefined}
    >
      <div className="sand__stage">
        <header className="sand__head">
          <h1 className="sand__name text-title-sm">Sand</h1>
          <p className="sand__hint text-ui text-ink-secondary">Drag across the cover to crumble it. Press and hold to pour the sand into the next record.</p>
        </header>
        <div
          ref={surfaceRef}
          className="sand__tray"
          tabIndex={0}
          role="application"
          aria-roledescription="sand tray"
          aria-label="Album cover made of sand. Drag to crumble. Press and hold, double-click or press R to pour the sand into the next cover. Shift with hold or R rebuilds this cover. C to crumble, right arrow to collapse into the next cover."
        >
          <div className="sand__placeholder" aria-hidden="true" />
          <svg ref={ringRef} className="sand__ring" viewBox="0 0 48 48" aria-hidden="true" data-state="idle">
            <circle className="sand__ring-halo" cx="24" cy="24" r="17" pathLength="1" />
            <circle className="sand__ring-fill" cx="24" cy="24" r="17" pathLength="1" />
          </svg>
          {phase === "error" ? (
            <p className="sand__error text-ui">This tray could not start its renderer.</p>
          ) : null}
        </div>

        <div className="sand__meta">
          <p className="sand__track text-ui">
            <MorphText className="sand__title" text={track?.title ?? ""} />
            <MorphText className="sand__artist text-ink-secondary" text={track?.artist ?? ""} />
          </p>
          <p className="sand__count text-ui tabular-nums">
            <SlotNumber ref={countRef} value="0" />
            <span className="sand__count-unit text-ink-secondary">loose</span>
          </p>
        </div>

        <div className="sand__controls">
          <div className="sand__actions">
            <button type="button" className="sand__button text-ui" onClick={handleRebuild} disabled={busy || !hasLoose}>
              Pour into next
            </button>
            <button type="button" className="sand__button text-ui" onClick={handleNext} disabled={busy || phase !== "ready"}>
              Collapse into next
            </button>
          </div>
          <div
            className="sand__grain"
            role="radiogroup"
            aria-label="Grain size"
            style={{ "--sand-grain-index": grainIndex }}
            onKeyDown={handleGrainKeyDown}
          >
            <span className="sand__grain-pill" aria-hidden="true" />
            {GRAIN_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={option.key === grain}
                tabIndex={option.key === grain ? 0 : -1}
                data-active={option.key === grain || undefined}
                className="sand__grain-option text-ui"
                onClick={() => setGrain(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Root>
  );
}
