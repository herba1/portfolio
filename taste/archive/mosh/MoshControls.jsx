"use client";

import SlotNumber from "@/app/ui/SlotNumber";

import { BLOCK_SIZES, MOSH_PRESETS, MOSH_SLIDERS } from "./moshParams";

function formatValue(slider, value) {
  return `${value.toFixed(slider.digits)}${slider.unit}`;
}

function Slider({ slider, value, onChange }) {
  const fill = (value - slider.min) / (slider.max - slider.min);
  const id = `mosh-${slider.key}`;
  return (
    <div className="mosh-slider" style={{ "--fill": fill }}>
      <div className="mosh-slider__head">
        <label htmlFor={id} className="text-ui text-ink">
          {slider.label}
        </label>
        <SlotNumber className="mosh-slider__value text-ui text-ink" value={formatValue(slider, value)} duration={420} />
      </div>
      <div className="mosh-slider__track">
        <span className="mosh-slider__fill" aria-hidden="true" />
        <input
          id={id}
          type="range"
          min={slider.min}
          max={slider.max}
          step={slider.step}
          value={value}
          onChange={(event) => onChange(slider.key, Number(event.target.value))}
        />
      </div>
    </div>
  );
}

export default function MoshControls({ params, activePreset, open, onToggleOpen, onPreset, onChange, onReset }) {
  const presetIndex = Math.max(
    0,
    MOSH_PRESETS.findIndex((preset) => preset.name === activePreset),
  );
  const blockIndex = BLOCK_SIZES.indexOf(params.block);

  return (
    <section className="mosh-codec" data-open={open ? "true" : "false"} aria-label="Codec">
      <div className="mosh-codec__row">
        <div
          className="mosh-segments"
          role="radiogroup"
          aria-label="Codec preset"
          data-matched={activePreset ? "true" : "false"}
          style={{ "--segment-index": presetIndex, "--segment-count": MOSH_PRESETS.length }}
        >
          <span className="mosh-segments__pill" aria-hidden="true" />
          {MOSH_PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              role="radio"
              aria-checked={preset.name === activePreset}
              className="mosh-segments__option text-ui"
              onClick={() => onPreset(preset)}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <button type="button" className="mosh-codec__more text-ui text-ink" aria-expanded={open} onClick={onToggleOpen}>
          <span>Tune</span>
          <span className="mosh-codec__chevron" aria-hidden="true" />
        </button>
      </div>

      <div className="mosh-codec__drawer" inert={!open}>
        <div className="mosh-codec__inner">
          <div className="mosh-codec__field">
            <span className="text-ui text-ink">Macroblock</span>
            <div
              className="mosh-segments mosh-segments--small"
              role="radiogroup"
              aria-label="Macroblock size"
              style={{ "--segment-index": blockIndex, "--segment-count": BLOCK_SIZES.length }}
            >
              <span className="mosh-segments__pill" aria-hidden="true" />
              {BLOCK_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  role="radio"
                  aria-checked={size === params.block}
                  className="mosh-segments__option text-ui tabular-nums"
                  onClick={() => onChange("block", size)}
                >
                  {size}px
                </button>
              ))}
            </div>
          </div>

          {MOSH_SLIDERS.map((slider) => (
            <Slider key={slider.key} slider={slider} value={params[slider.key]} onChange={onChange} />
          ))}

          <div className="mosh-codec__toggles">
            <button
              type="button"
              role="switch"
              aria-checked={params.subsample}
              className="mosh-switch text-ui text-ink"
              onClick={() => onChange("subsample", !params.subsample)}
            >
              <span className="mosh-switch__track" aria-hidden="true">
                <span className="mosh-switch__knob" />
              </span>
              4:2:0 chroma
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={params.vectors}
              className="mosh-switch text-ui text-ink"
              onClick={() => onChange("vectors", !params.vectors)}
            >
              <span className="mosh-switch__track" aria-hidden="true">
                <span className="mosh-switch__knob" />
              </span>
              Show vectors
            </button>
          </div>

          <button type="button" className="mosh-reset text-ui text-ink" onClick={onReset}>
            Reset to H.264
          </button>
        </div>
      </div>
    </section>
  );
}
