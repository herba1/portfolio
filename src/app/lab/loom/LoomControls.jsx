"use client";

import SlotNumber from "@/app/ui/SlotNumber";

import { PRESETS, SLIDERS, THREADS_MAX, THREADS_MIN, THREADS_STEP, WEAVES } from "./loomParams";

function Segmented({ label, options, activeIndex, onPick }) {
  return (
    <div className="loom-field">
      <span className="loom-label text-ui text-ink-secondary">{label}</span>
      <div
        className="loom-segments"
        role="radiogroup"
        aria-label={label}
        data-empty={activeIndex < 0 ? "1" : undefined}
        style={{ "--loom-seg-index": Math.max(0, activeIndex), "--loom-seg-count": options.length }}
      >
        <span className="loom-segments__pill" aria-hidden="true" />
        {options.map((option, optionIndex) => (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={optionIndex === activeIndex}
            data-active={optionIndex === activeIndex ? "1" : undefined}
            className="loom-segment text-ui"
            onClick={() => onPick(optionIndex)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function formatValue(value, step) {
  return step < 1 ? value.toFixed(1) : String(Math.round(value));
}

function Slider({ label, value, min, max, step, onChange }) {
  const fill = (value - min) / (max - min);
  return (
    <label className="loom-field loom-slider" style={{ "--loom-fill": fill }}>
      <span className="loom-slider__head">
        <span className="loom-label text-ui text-ink-secondary">{label}</span>
        <SlotNumber className="loom-value text-ui text-ink" value={formatValue(value, step)} duration={260} stagger={18} />
      </span>
      <span className="loom-slider__rail">
        <span className="loom-slider__track" aria-hidden="true">
          <span className="loom-slider__fill" />
        </span>
        <span className="loom-slider__knob" aria-hidden="true" />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </span>
    </label>
  );
}

export default function LoomControls({ params, threads, presetId, onPreset, onChange, open, id }) {
  const presetIndex = PRESETS.findIndex((preset) => preset.id === presetId);
  return (
    <aside id={id} className="loom-panel" data-open={open ? "1" : undefined} aria-label="Cloth controls">
      <Segmented
        label="Cloth"
        options={PRESETS.map((preset) => ({ key: preset.id, label: preset.label }))}
        activeIndex={presetIndex}
        onPick={(pick) => onPreset(PRESETS[pick].id)}
      />
      <Segmented
        label="Weave"
        options={WEAVES.map((weave) => ({ key: weave.id, label: weave.label }))}
        activeIndex={params.weave}
        onPick={(pick) => onChange({ weave: WEAVES[pick].id })}
      />
      <Slider
        label="Threads"
        value={threads}
        min={THREADS_MIN}
        max={THREADS_MAX}
        step={THREADS_STEP}
        onChange={(value) => onChange({ threads: value })}
      />
      {SLIDERS.map((slider) => (
        <Slider
          key={slider.key}
          label={slider.label}
          value={params[slider.key]}
          min={slider.min}
          max={slider.max}
          step={slider.step}
          onChange={(value) => onChange({ [slider.key]: value })}
        />
      ))}
    </aside>
  );
}
