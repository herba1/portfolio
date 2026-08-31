"use client";

import { REFRACT_GROUPS, REFRACT_PRESETS } from "./refractParams";

function format(value, step) {
  if (step >= 1) return String(Math.round(value));
  const decimals = step >= 0.1 ? 1 : step >= 0.01 ? 2 : step >= 0.001 ? 3 : 4;
  return value.toFixed(decimals);
}

function Control({ control, value, onChange }) {
  const { key, label, type } = control;

  if (type === "toggle") {
    return (
      <label className="rf-row rf-row--flat">
        <span className="rf-row__label">{label}</span>
        <input
          type="checkbox"
          className="rf-check"
          checked={value === 1}
          onChange={(event) => onChange(key, event.target.checked ? 1 : 0)}
        />
      </label>
    );
  }

  if (type === "color") {
    return (
      <label className="rf-row rf-row--flat">
        <span className="rf-row__label">{label}</span>
        <input
          type="color"
          className="rf-swatch"
          value={value}
          onChange={(event) => onChange(key, event.target.value)}
        />
      </label>
    );
  }

  const { min, max, step, unit } = control;

  return (
    <div className="rf-row">
      <div className="rf-row__head">
        <span className="rf-row__label">{label}</span>
        <span className="rf-row__readout">
          <input
            type="number"
            className="rf-number"
            value={format(value, step)}
            min={min}
            max={max}
            step={step}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) onChange(key, Math.min(max, Math.max(min, next)));
            }}
          />
          {unit ? <span className="rf-row__unit">{unit}</span> : null}
        </span>
      </div>
      <input
        type="range"
        className="rf-slider"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(key, Number(event.target.value))}
      />
    </div>
  );
}

export default function RefractControls({
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
    <div className="rf-panel">
      <div className="rf-panel__head">
        <h1 className="rf-panel__title">Refract</h1>
        <p className="rf-panel__sub">A gradient bent through a lattice of lenses.</p>
      </div>

      <div className="rf-panel__body" data-lenis-prevent>
        <section className="rf-group">
          <h2 className="rf-group__name">Plate</h2>
          <div className="rf-presets">
            {REFRACT_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className="rf-chip"
                data-active={activePreset === preset.name ? "true" : undefined}
                onClick={() => onPreset(preset)}
              >
                {preset.name}
              </button>
            ))}
          </div>
          <div className="rf-actions">
            <button type="button" className="rf-button" onClick={onPickImage}>
              Load image
            </button>
            <button type="button" className="rf-button" onClick={onAutoLevels}>
              Auto levels
            </button>
            <button type="button" className="rf-button" onClick={onReroll}>
              Reroll
            </button>
            <button type="button" className="rf-button" onClick={onSave}>
              Save PNG
            </button>
            <button type="button" className="rf-button" onClick={onCopy}>
              Copy JSON
            </button>
            <button type="button" className="rf-button" onClick={onPaste}>
              Paste JSON
            </button>
            <button type="button" className="rf-button" onClick={onReset}>
              Reset
            </button>
          </div>
          {note ? <p className="rf-note">{note}</p> : null}
          <p className="rf-source">{imageLabel}</p>
          <p className="rf-source">{sourceStatus}</p>
        </section>

        {REFRACT_GROUPS.map((group) => (
          <section key={group.name} className="rf-group">
            <h2 className="rf-group__name">{group.name}</h2>
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
