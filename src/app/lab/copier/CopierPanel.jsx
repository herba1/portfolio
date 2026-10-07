"use client";

import SlotNumber from "@/app/ui/SlotNumber";

import { COPIER_CONTROLS, COPIER_PRESETS, SOURCES } from "./copierParams";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/avif";

function formatValue(value, step) {
  if (step >= 1) return String(Math.round(value));
  return value.toFixed(step >= 0.1 ? 1 : 2);
}

export default function CopierPanel({
  phase,
  generation,
  hasCopy,
  presetName,
  params,
  sourceId,
  tuneOpen,
  sound,
  note,
  onCopy,
  onCopyTheCopy,
  onPreset,
  onParam,
  onSource,
  onFile,
  onTune,
  onSound,
}) {
  const passing = phase === "pass";

  return (
    <div className="copier__panel">
      <div className="copier-actions">
        <button type="button" className="copier-button text-ui-lg" data-variant="primary" onClick={onCopy} disabled={passing}>
          <span>Copy</span>
          <kbd className="copier-kbd">Space</kbd>
        </button>
        <button type="button" className="copier-button text-ui-lg" onClick={onCopyTheCopy} disabled={passing || !hasCopy}>
          <span>Copy the copy</span>
          <kbd className="copier-kbd">Enter</kbd>
        </button>
      </div>

      <p className="copier-generation text-ui-lg">
        <span className="text-ink-secondary">Generation</span>
        <SlotNumber className="copier-generation__number font-strong" value={generation} />
      </p>

      <div className="copier-presets" role="radiogroup" aria-label="Toner">
        {COPIER_PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            role="radio"
            aria-checked={presetName === preset.name}
            className="copier-chip text-ui"
            data-active={presetName === preset.name ? "true" : undefined}
            onClick={() => onPreset(preset)}
          >
            {preset.name}
          </button>
        ))}
      </div>

      <div className="copier-originals">
        <div className="copier-originals__row" role="radiogroup" aria-label="Original">
          {SOURCES.map((source) => (
            <button
              key={source.id}
              type="button"
              role="radio"
              aria-checked={sourceId === source.id}
              aria-label={source.label}
              title={source.label}
              className="copier-thumb"
              data-active={sourceId === source.id ? "true" : undefined}
              disabled={passing}
              onClick={() => onSource(source)}
              style={{ backgroundImage: `url(${source.url})` }}
            />
          ))}
        </div>
        <label className="copier-link text-ui" data-disabled={passing ? "true" : undefined}>
          <input
            type="file"
            accept={ACCEPT}
            className="copier-file"
            disabled={passing}
            onChange={(event) => {
              const file = event.target.files && event.target.files[0];
              if (file) onFile(file);
              event.target.value = "";
            }}
          />
          Put your own picture on the glass
        </label>
        {note ? <p className="copier-note text-ui">{note}</p> : null}
      </div>

      <div className="copier-tune" data-open={tuneOpen ? "true" : "false"}>
        <button type="button" className="copier-link text-ui" aria-expanded={tuneOpen} onClick={onTune}>
          {tuneOpen ? "Hide the dials" : "Tune the toner"}
        </button>
        <div className="copier-tune__body">
          <div className="copier-tune__inner">
            {COPIER_CONTROLS.map((control) => (
              <label key={control.key} className="copier-dial">
                <span className="copier-dial__head text-ui">
                  <span className="text-ink-secondary">{control.label}</span>
                  <span className="copier-dial__value tabular-nums">
                    {formatValue(params[control.key], control.step)}
                    {control.unit || ""}
                  </span>
                </span>
                <input
                  type="range"
                  className="copier-range"
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={params[control.key]}
                  tabIndex={tuneOpen ? 0 : -1}
                  onChange={(event) => onParam(control.key, Number(event.target.value))}
                />
              </label>
            ))}
            <label className="copier-dial copier-dial--row text-ui">
              <span className="text-ink-secondary">Motor sound</span>
              <input
                type="checkbox"
                className="copier-switch"
                checked={sound}
                tabIndex={tuneOpen ? 0 : -1}
                onChange={(event) => onSound(event.target.checked)}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
