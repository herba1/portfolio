"use client";

import { useRef, useState } from "react";

import { MARBLE_GROUPS, MARBLE_PRESETS } from "./marbleParams";

function format(value, step) {
  if (step >= 1) return String(Math.round(value));
  const decimals = step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return Number(value).toFixed(decimals);
}

function NumberField({ label, value, min, max, step, onCommit }) {
  const [draft, setDraft] = useState(null);
  const discardRef = useRef(false);

  const commit = () => {
    const text = draft;
    setDraft(null);
    if (discardRef.current) {
      discardRef.current = false;
      return;
    }
    if (text === null || text.trim() === "") return;
    const next = Number(text);
    if (Number.isFinite(next)) onCommit(Math.min(max, Math.max(min, next)));
  };

  return (
    <input
      type="number"
      inputMode="decimal"
      className="marble-number"
      aria-label={`${label} value`}
      value={draft ?? format(value, step)}
      min={min}
      max={max}
      step={step}
      onFocus={() => setDraft(format(value, step))}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          discardRef.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function Control({ control, value, onChange }) {
  const { key, label, type } = control;

  if (type === "color") {
    return (
      <label className="marble-row marble-row--flat">
        <span className="marble-row__label">{label}</span>
        <input
          type="color"
          className="marble-swatch"
          value={value}
          onChange={(event) => onChange(key, event.target.value)}
        />
      </label>
    );
  }

  const { min, max, step, unit } = control;
  const fill = ((value - min) / (max - min)) * 100;

  return (
    <div className="marble-row">
      <div className="marble-row__head">
        <label className="marble-row__label" htmlFor={`marble-${key}`}>
          {label}
        </label>
        <span className="marble-row__readout">
          <NumberField label={label} value={value} min={min} max={max} step={step} onCommit={(next) => onChange(key, next)} />
          {unit ? <span className="marble-row__unit">{unit}</span> : null}
        </span>
      </div>
      <input
        id={`marble-${key}`}
        type="range"
        className="marble-slider"
        style={{ "--fill": `${fill}%` }}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(key, Number(event.target.value))}
      />
    </div>
  );
}

export default function MarbleControls({
  params,
  activePreset,
  note,
  onChange,
  onPreset,
  onReroll,
  onReset,
  onSave,
  onCopy,
  onPaste,
  onClose,
}) {
  return (
    <div className="marble-panel">
      <div className="marble-panel__head">
        <h2 className="marble-panel__title">Tray</h2>
        <button type="button" className="marble-button" onClick={onClose}>
          Done
        </button>
      </div>

      <div className="marble-panel__body" data-scroll-contain data-lenis-prevent>
        <section className="marble-group">
          <h3 className="marble-group__name">Pattern</h3>
          <div className="marble-presets">
            {MARBLE_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className="marble-chip"
                data-active={activePreset === preset.name ? "true" : undefined}
                onClick={() => onPreset(preset)}
              >
                {preset.name}
              </button>
            ))}
          </div>
          <div className="marble-actions">
            <button type="button" className="marble-button" onClick={onReroll}>
              Reroll
            </button>
            <button type="button" className="marble-button" onClick={onSave}>
              Save PNG
            </button>
            <button type="button" className="marble-button" onClick={onCopy}>
              Copy JSON
            </button>
            <button type="button" className="marble-button" onClick={onPaste}>
              Paste JSON
            </button>
            <button type="button" className="marble-button" onClick={onReset}>
              Reset
            </button>
          </div>
          {note ? (
            <p key={note} className="marble-note">
              {note}
            </p>
          ) : null}
        </section>

        {MARBLE_GROUPS.map((group) => (
          <section key={group.name} className="marble-group">
            <h3 className="marble-group__name">{group.name}</h3>
            {group.controls.map((control) => (
              <Control key={control.key} control={control} value={params[control.key]} onChange={onChange} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
