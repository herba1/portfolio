"use client";

import { INK_GROUPS, INK_PRESETS } from "./inkParams";

function format(value, step) {
  if (step >= 1) return String(Math.round(value));
  const decimals = step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return value.toFixed(decimals);
}

function Control({ control, value, onChange }) {
  const { key, label, type } = control;

  if (type === "toggle") {
    return (
      <label className="ink-row ink-row--flat">
        <span className="ink-row__label">{label}</span>
        <input
          type="checkbox"
          className="ink-check"
          checked={value === 1}
          onChange={(event) => onChange(key, event.target.checked ? 1 : 0)}
        />
      </label>
    );
  }

  if (type === "color") {
    return (
      <label className="ink-row ink-row--flat">
        <span className="ink-row__label">{label}</span>
        <input
          type="color"
          className="ink-swatch"
          value={value}
          onChange={(event) => onChange(key, event.target.value)}
        />
      </label>
    );
  }

  const { min, max, step, unit } = control;

  return (
    <div className="ink-row">
      <div className="ink-row__head">
        <span className="ink-row__label">{label}</span>
        <span className="ink-row__readout">
          <input
            type="number"
            className="ink-number"
            value={format(value, step)}
            min={min}
            max={max}
            step={step}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) onChange(key, Math.min(max, Math.max(min, next)));
            }}
          />
          {unit ? <span className="ink-row__unit">{unit}</span> : null}
        </span>
      </div>
      <input
        type="range"
        className="ink-slider"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(key, Number(event.target.value))}
      />
    </div>
  );
}

export default function InkControls({
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
}) {
  return (
    <div className="ink-panel">
      <div className="ink-panel__head">
        <h1 className="ink-panel__title">Ink</h1>
        <p className="ink-panel__sub">Relief print, one stroke per line.</p>
      </div>

      <div className="ink-panel__body" data-lenis-prevent>
        <section className="ink-group">
          <h2 className="ink-group__name">Plate</h2>
          <div className="ink-presets">
            {INK_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className="ink-chip"
                data-active={activePreset === preset.name ? "true" : undefined}
                onClick={() => onPreset(preset)}
              >
                {preset.name}
              </button>
            ))}
          </div>
          <div className="ink-actions">
            <button type="button" className="ink-button" onClick={onPickImage}>
              Load image
            </button>
            <button type="button" className="ink-button" onClick={onReroll}>
              Reroll
            </button>
            <button type="button" className="ink-button" onClick={onSave}>
              Save PNG
            </button>
            <button type="button" className="ink-button" onClick={onCopy}>
              Copy JSON
            </button>
            <button type="button" className="ink-button" onClick={onPaste}>
              Paste JSON
            </button>
            <button type="button" className="ink-button" onClick={onReset}>
              Reset
            </button>
          </div>
          {note ? <p className="ink-note">{note}</p> : null}
          <p className="ink-source">{imageLabel}</p>
          <p className="ink-source">{sourceStatus}</p>
        </section>

        {INK_GROUPS.map((group) => (
          <section key={group.name} className="ink-group">
            <h2 className="ink-group__name">{group.name}</h2>
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
