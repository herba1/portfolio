"use client";

import { GALAXIUM_GROUPS, GALAXIUM_PRESETS } from "./galaxiumParams";

function format(value, step) {
  if (step >= 1) return String(Math.round(value));
  const decimals = step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return value.toFixed(decimals);
}

function Control({ control, value, onChange }) {
  const { key, label, min, max, step, unit } = control;

  return (
    <div className="galaxium-row">
      <div className="galaxium-row__head">
        <span className="galaxium-row__label">{label}</span>
        <span className="galaxium-row__readout">
          <input
            type="number"
            className="galaxium-number"
            value={format(value, step)}
            min={min}
            max={max}
            step={step}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) onChange(key, Math.min(max, Math.max(min, next)));
            }}
          />
          {unit ? <span className="galaxium-row__unit">{unit}</span> : null}
        </span>
      </div>
      <input
        type="range"
        className="galaxium-slider"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(key, Number(event.target.value))}
      />
    </div>
  );
}

export default function GalaxiumControls({
  params,
  activePreset,
  status,
  onChange,
  onPreset,
  onReroll,
  onReset,
}) {
  return (
    <div className="galaxium-panel">
      <div className="galaxium-panel__head">
        <h1 className="galaxium-panel__title">Galaxium</h1>
        <p className="galaxium-panel__sub">A spiral galaxy, computed live on the GPU.</p>
      </div>

      <div className="galaxium-panel__body" data-lenis-prevent>
        <section className="galaxium-group">
          <h2 className="galaxium-group__name">Field</h2>
          <div className="galaxium-presets">
            {GALAXIUM_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className="galaxium-chip"
                data-active={activePreset === preset.name ? "true" : undefined}
                onClick={() => onPreset(preset)}
              >
                {preset.name}
              </button>
            ))}
          </div>
          <div className="galaxium-actions">
            <button type="button" className="galaxium-button" onClick={onReroll}>
              Reroll
            </button>
            <button type="button" className="galaxium-button" onClick={onReset}>
              Reset
            </button>
          </div>
          <p className="galaxium-status">{status}</p>
        </section>

        {GALAXIUM_GROUPS.map((group) => (
          <section key={group.name} className="galaxium-group">
            <h2 className="galaxium-group__name">{group.name}</h2>
            {group.controls.map((control) => (
              <Control
                key={control.key}
                control={control}
                value={params[control.key]}
                onChange={onChange}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
