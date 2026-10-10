"use client";

import SlotNumber from "@/app/ui/SlotNumber";

import { QUAD_GROUPS, QUAD_PRESETS } from "./quadParams";

function decimalsFor(step) {
  if (step >= 1) return 0;
  return step >= 0.1 ? 1 : 2;
}

function Slider({ control, value, onChange }) {
  const { key, label, min, max, step, unit } = control;
  const fill = (value - min) / (max - min);
  return (
    <label className="qt-row">
      <span className="qt-row__head">
        <span className="qt-row__label text-ui text-ink">{label}</span>
        <span className="qt-row__value text-ui text-ink">
          <SlotNumber value={value.toFixed(decimalsFor(step))} duration={260} stagger={16} />
          {unit ? <span>{unit}</span> : null}
        </span>
      </span>
      <input
        type="range"
        className="qt-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--qt-fill": fill }}
        onChange={(event) => onChange(key, Number(event.target.value))}
      />
    </label>
  );
}

export default function QuadControls({
  params,
  activePreset,
  sourceName,
  onChange,
  onPreset,
  onSource,
  onSave,
  onReset,
  note,
}) {
  return (
    <div className="qt-panel">
      <section className="qt-group">
        <h2 className="qt-group__name text-ui">Look</h2>
        <div className="qt-chips">
          {QUAD_PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className="qt-chip text-ui"
              data-active={activePreset === preset.name ? "" : undefined}
              onClick={() => onPreset(preset)}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </section>

      <section className="qt-group">
        <h2 className="qt-group__name text-ui">Pictures</h2>
        <div className="qt-chips">
          {[
            { name: "covers", label: "Recently played" },
            { name: "faces", label: "Faces" },
          ].map((option) => (
            <button
              key={option.name}
              type="button"
              className="qt-chip text-ui"
              data-active={sourceName === option.name ? "" : undefined}
              onClick={() => onSource(option.name)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      {QUAD_GROUPS.map((group) => (
        <section key={group.name} className="qt-group">
          <h2 className="qt-group__name text-ui">{group.name}</h2>
          {group.controls.map((control) => (
            <Slider key={control.key} control={control} value={params[control.key]} onChange={onChange} />
          ))}
        </section>
      ))}

      <section className="qt-group qt-group--actions">
        <div className="qt-chips">
          <button type="button" className="qt-button text-ui" onClick={onSave}>
            Save PNG
          </button>
          <button type="button" className="qt-button text-ui" onClick={onReset}>
            Reset
          </button>
        </div>
        <p className="qt-note text-ui text-ink-secondary" data-shown={note ? "" : undefined} aria-live="polite">
          {note ?? ""}
        </p>
      </section>
    </div>
  );
}
