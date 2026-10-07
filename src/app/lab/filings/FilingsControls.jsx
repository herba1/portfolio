"use client";

import SlotNumber from "@/app/ui/SlotNumber";

import { FILINGS_CONTROLS, FILINGS_LOOKS } from "./filingsParams";

function Slider({ control, value, onChange }) {
  const { key, label, min, max, step, unit } = control;
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="filings-slider">
      <span className="filings-slider__head">
        <span className="text-ui text-ink">{label}</span>
        <span className="filings-slider__value text-ui text-ink">
          <SlotNumber value={`${value}${unit}`} />
        </span>
      </span>
      <input
        type="range"
        className="filings-slider__input"
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

export default function FilingsControls({ compact, look, onLook, params, onChange, count, tint, onShake, onSave, onReset }) {
  return (
    <div className="filings-panel">
      <div className="filings-panel__head">
        <h2 className="text-heading-sm text-ink">Plate</h2>
        <p className="filings-panel__count text-ui text-ink-secondary">
          <SlotNumber value={count.toLocaleString("en-GB")} /> filings
        </p>
      </div>

      <div className="filings-looks" role="radiogroup" aria-label="Look">
        {FILINGS_LOOKS.map((item) => (
          <button
            key={item.name}
            type="button"
            role="radio"
            aria-checked={look.name === item.name}
            className="filings-look text-ui text-ink"
            data-active={look.name === item.name ? "true" : undefined}
            onClick={() => onLook(item)}
          >
            <span
              className="filings-look__swatch"
              style={{ "--swatch-paper": item.paper, "--swatch-ink": item.tint ? tint : item.ink }}
            >
              <span className="filings-look__filing" />
              <span className="filings-look__filing" />
              <span className="filings-look__filing" />
            </span>
            {item.name}
          </button>
        ))}
      </div>

      <div className="filings-sliders">
        {FILINGS_CONTROLS.filter((control) => !(compact && control.key === "creep")).map((control) => (
          <Slider key={control.key} control={control} value={params[control.key]} onChange={onChange} />
        ))}
      </div>

      <div className="filings-actions">
        <button type="button" className="filings-button text-ui text-ink" onClick={onShake}>
          Shake
        </button>
        <button type="button" className="filings-button text-ui text-ink" onClick={onSave}>
          Save PNG
        </button>
        <button type="button" className="filings-button text-ui text-ink" onClick={onReset}>
          Reset
        </button>
      </div>
    </div>
  );
}
