"use client";

import SlotNumber from "@/app/ui/SlotNumber";

import { MOBILE_CONTROLS } from "./mobileParams";

function Slider({ control, value, onChange }) {
  const { key, label, min, max, step, digits, unit } = control;
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="cm-panel__row">
      <span className="cm-panel__head">
        <span className="text-ui">{label}</span>
        <span className="cm-panel__readout text-ui tabular-nums">
          <SlotNumber value={value.toFixed(digits)} duration={420} />
          {unit ? <span className="cm-panel__unit">{unit}</span> : null}
        </span>
      </span>
      <input
        type="range"
        className="cm-panel__range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--cm-fill": `${fill}%` }}
        onChange={(event) => onChange(key, Number(event.target.value))}
      />
    </label>
  );
}

export default function MobileControls({ values, open, onToggle, onChange, onReroll, onReset }) {
  return (
    <aside className="cm-panel" data-open={open ? "open" : "closed"} aria-label="Mobile controls">
      <button type="button" className="cm-panel__toggle text-ui" aria-expanded={open} onClick={onToggle}>
        <span className="cm-panel__toggle-mark" aria-hidden="true" />
        Tune
      </button>
      <div className="cm-panel__body">
        {MOBILE_CONTROLS.map((control) => (
          <Slider key={control.key} control={control} value={values[control.key]} onChange={onChange} />
        ))}
        <div className="cm-panel__actions">
          <button type="button" className="cm-panel__action text-ui" onClick={onReroll}>
            Rehang
            <span className="cm-panel__seed tabular-nums">
              <SlotNumber value={String(values.seed).padStart(5, "0")} duration={520} />
            </span>
          </button>
          <button type="button" className="cm-panel__action text-ui" onClick={onReset}>
            Reset
          </button>
        </div>
      </div>
    </aside>
  );
}
