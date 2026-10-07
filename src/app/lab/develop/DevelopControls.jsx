"use client";

import { useState } from "react";

import SlotNumber from "@/app/ui/SlotNumber";

import { DEVELOP_CONTROLS, DEVELOP_PRESETS, formatValue } from "./developParams";

function SliderRow({ control, value, onChange }) {
  const { key, label, min, max, step, unit } = control;
  const [held, setHeld] = useState(false);
  const fill = (value - min) / (max - min);
  const inputId = `develop-${key}`;

  return (
    <div className="develop-row" data-held={held ? "true" : undefined}>
      <div className="develop-row__head">
        <label htmlFor={inputId} className="develop-row__label">
          {label}
        </label>
        <span className="develop-row__value">
          <SlotNumber value={formatValue(value, step)} duration={held ? 0 : 520} />
          {unit ? <span className="develop-row__unit">{unit}</span> : null}
        </span>
      </div>
      <input
        id={inputId}
        type="range"
        className="develop-slider"
        style={{ "--fill": fill }}
        value={value}
        min={min}
        max={max}
        step={step}
        onPointerDown={() => setHeld(true)}
        onPointerUp={() => setHeld(false)}
        onPointerCancel={() => setHeld(false)}
        onBlur={() => setHeld(false)}
        onChange={(event) => onChange(key, Number(event.target.value))}
      />
    </div>
  );
}

export function DevelopTitle({ className }) {
  return (
    <header className={`develop-head ${className}`}>
      <h1 className="develop-head__title text-title-sm">Develop</h1>
      <p className="develop-head__hint text-ui-lg">Hold the sheet where the developer should run.</p>
    </header>
  );
}

export default function DevelopControls({ params, onChange, onPreset, onSave, onReset, onClose }) {
  return (
    <div className="develop-controls">
      <DevelopTitle className="develop-head--panel" />

      <section className="develop-group" aria-label="Bath">
        <h2 className="develop-group__name text-heading-sm">Bath</h2>
        <div className="develop-chips">
          {DEVELOP_PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className="develop-chip text-ui"
              data-active={params.preset === preset.name ? "true" : undefined}
              aria-pressed={params.preset === preset.name}
              onClick={() => onPreset(preset)}
            >
              <span className="develop-chip__swatch" style={{ "--swatch-paper": preset.values.paper, "--swatch-silver": preset.values.silver }} />
              {preset.name}
            </button>
          ))}
        </div>
      </section>

      <section className="develop-group" aria-label="Developer">
        <h2 className="develop-group__name text-heading-sm">Developer</h2>
        {DEVELOP_CONTROLS.map((control) => (
          <SliderRow key={control.key} control={control} value={params[control.key]} onChange={onChange} />
        ))}
      </section>

      <div className="develop-actions">
        <button type="button" className="develop-button text-ui" onClick={onSave}>
          Save PNG
        </button>
        <button type="button" className="develop-button text-ui" onClick={onReset}>
          Reset
        </button>
        {onClose ? (
          <button type="button" className="develop-button develop-button--close text-ui" onClick={onClose}>
            Done
          </button>
        ) : null}
      </div>
    </div>
  );
}
