"use client";

import { HALFTONE_GROUPS, HALFTONE_PRESETS } from "./halftoneParams";

function format(value, step) {
  if (step >= 1) return String(Math.round(value));
  const decimals = step >= 0.1 ? 1 : step >= 0.01 ? 2 : step >= 0.001 ? 3 : 4;
  return value.toFixed(decimals);
}

function Control({ control, value, onChange }) {
  const { key, label, type } = control;

  if (type === "toggle") {
    return (
      <label className="ht-row ht-row--flat">
        <span className="ht-row__label">{label}</span>
        <input
          type="checkbox"
          className="ht-check"
          checked={value === 1}
          onChange={(event) => onChange(key, event.target.checked ? 1 : 0)}
        />
      </label>
    );
  }

  if (type === "color") {
    return (
      <label className="ht-row ht-row--flat">
        <span className="ht-row__label">{label}</span>
        <input
          type="color"
          className="ht-swatch"
          value={value}
          onChange={(event) => onChange(key, event.target.value)}
        />
      </label>
    );
  }

  const { min, max, step, unit } = control;

  return (
    <div className="ht-row">
      <div className="ht-row__head">
        <span className="ht-row__label">{label}</span>
        <span className="ht-row__readout">
          <input
            type="number"
            className="ht-number"
            value={format(value, step)}
            min={min}
            max={max}
            step={step}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) onChange(key, Math.min(max, Math.max(min, next)));
            }}
          />
          {unit ? <span className="ht-row__unit">{unit}</span> : null}
        </span>
      </div>
      <input
        type="range"
        className="ht-slider"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(key, Number(event.target.value))}
      />
    </div>
  );
}

export default function HalftoneControls({
  params,
  activePreset,
  imageLabel,
  sourceStatus,
  onChange,
  onPreset,
  onReroll,
  onReset,
  onSave,
  onPickImage,
  onCopy,
  onPaste,
  note,
  onAutoLevels,
}) {
  return (
    <div className="ht-panel">
      <div className="ht-panel__head">
        <h1 className="ht-panel__title">Halftone</h1>
        <p className="ht-panel__sub">Three inks, one warped screen.</p>
      </div>

      <div className="ht-panel__body" data-lenis-prevent>
        <section className="ht-group">
          <h2 className="ht-group__name">Plate</h2>
          <div className="ht-presets">
            {HALFTONE_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className="ht-chip"
                data-active={activePreset === preset.name ? "true" : undefined}
                onClick={() => onPreset(preset)}
              >
                {preset.name}
              </button>
            ))}
          </div>
          <div className="ht-actions">
            <button type="button" className="ht-button" onClick={onPickImage}>
              Load image
            </button>
            <button type="button" className="ht-button" onClick={onAutoLevels}>
              Auto levels
            </button>
            <button type="button" className="ht-button" onClick={onReroll}>
              Reroll
            </button>
            <button type="button" className="ht-button" onClick={onSave}>
              Save PNG
            </button>
            <button type="button" className="ht-button" onClick={onCopy}>
              Copy JSON
            </button>
            <button type="button" className="ht-button" onClick={onPaste}>
              Paste JSON
            </button>
            <button type="button" className="ht-button" onClick={onReset}>
              Reset
            </button>
          </div>
          {note ? <p className="ht-note">{note}</p> : null}
          <p className="ht-source">{imageLabel}</p>
          <p className="ht-source">{sourceStatus}</p>
        </section>

        {HALFTONE_GROUPS.map((group) => (
          <section key={group.name} className="ht-group">
            <h2 className="ht-group__name">{group.name}</h2>
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
