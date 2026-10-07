"use client";

import SlotNumber from "@/app/ui/SlotNumber";

import { TAFFY_CONTROLS, TAFFY_PRESETS } from "./taffyParams";

function Slider({ control, value, onChange }) {
  const { key, label, min, max, step, digits, unit } = control;
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="taffy-panel__row">
      <span className="taffy-panel__head">
        <span className="text-ui">{label}</span>
        <span className="taffy-panel__readout text-ui tabular-nums">
          <SlotNumber value={value.toFixed(digits)} duration={420} />
          {unit ? <span className="taffy-panel__unit">{unit}</span> : null}
        </span>
      </span>
      <input
        type="range"
        className="taffy-panel__range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--taffy-fill": `${fill}%` }}
        onChange={(event) => onChange(key, Number(event.target.value))}
      />
    </label>
  );
}

const ROVING_KEYS = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };

export default function TaffyControls({ params, activePreset, open, onToggle, onChange, onPreset }) {
  const activeIndex = TAFFY_PRESETS.findIndex((preset) => preset.name === activePreset);
  const tabStop = activeIndex >= 0 ? activeIndex : 0;

  const handleRadioKey = (event) => {
    const step = ROVING_KEYS[event.key];
    if (!step) return;
    event.preventDefault();
    const chips = Array.from(event.currentTarget.querySelectorAll("[role='radio']"));
    const from = Math.max(0, chips.indexOf(event.target));
    const to = (from + step + chips.length) % chips.length;
    onPreset(TAFFY_PRESETS[to]);
    chips[to]?.focus();
  };

  return (
    <aside className="taffy-panel" data-open={open} aria-label="Taffy controls">
      <button type="button" className="taffy-panel__toggle text-ui" aria-expanded={open !== "closed"} onClick={onToggle}>
        <span className="taffy-panel__toggle-mark" aria-hidden="true" />
        Material
      </button>
      <div className="taffy-panel__body">
        <div className="taffy-panel__presets" role="radiogroup" aria-label="Material" onKeyDown={handleRadioKey}>
          {TAFFY_PRESETS.map((preset, presetIndex) => (
            <button
              key={preset.name}
              type="button"
              role="radio"
              aria-checked={activePreset === preset.name}
              tabIndex={presetIndex === tabStop ? 0 : -1}
              className="taffy-panel__chip text-ui"
              data-active={activePreset === preset.name ? "true" : undefined}
              onClick={() => onPreset(preset)}
            >
              {preset.name}
            </button>
          ))}
        </div>
        {TAFFY_CONTROLS.map((control) => (
          <Slider key={control.key} control={control} value={params[control.key]} onChange={onChange} />
        ))}
      </div>
    </aside>
  );
}
