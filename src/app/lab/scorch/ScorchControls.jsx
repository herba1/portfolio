"use client";

import SlotNumber from "@/app/ui/SlotNumber";

import { SCORCH_CONTROLS, SCORCH_PRESETS } from "./scorchParams";

function Slider({ control, value, onChange }) {
  const { key, label, min, max, step } = control;
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="scorch-slider">
      <span className="scorch-slider__head">
        <span className="text-ui-lg text-ink">{label}</span>
        <SlotNumber value={value.toFixed(2)} duration={260} stagger={18} className="scorch-slider__value text-ui-lg text-ink-secondary" />
      </span>
      <input
        type="range"
        className="scorch-slider__input"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--fill": `${fill}%` }}
        onChange={(event) => onChange(key, Number(event.target.value))}
      />
    </label>
  );
}

export default function ScorchControls({ params, activePreset, soundOn, onPreset, onChange, onDouse, onSkip, onSound }) {
  return (
    <div className="scorch-controls">
      <div className="scorch-presets" role="radiogroup" aria-label="Paper stock">
        {SCORCH_PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            role="radio"
            aria-checked={activePreset === preset.name}
            data-active={activePreset === preset.name ? "1" : undefined}
            className="scorch-chip text-ui-lg"
            onClick={() => onPreset(preset.name)}
          >
            {preset.name}
          </button>
        ))}
      </div>
      <div className="scorch-sliders">
        {SCORCH_CONTROLS.map((control) => (
          <Slider key={control.key} control={control} value={params[control.key]} onChange={onChange} />
        ))}
      </div>
      <div className="scorch-actions">
        <button type="button" className="scorch-action text-ui-lg" onClick={onDouse}>
          <span>Douse</span>
          <kbd className="scorch-key">Esc</kbd>
        </button>
        <button type="button" className="scorch-action text-ui-lg" onClick={onSkip}>
          <span>Next sheet</span>
          <kbd className="scorch-key">→</kbd>
        </button>
        <button type="button" className="scorch-action text-ui-lg" aria-pressed={soundOn} onClick={onSound}>
          <span>Sound</span>
          <span className="scorch-toggle" data-on={soundOn ? "1" : undefined} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
