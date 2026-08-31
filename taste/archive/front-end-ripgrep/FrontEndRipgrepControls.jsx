"use client";

import { FILE_TYPES, PRESETS } from "./frontEndRipgrepParams";

const CASE_MODES = [
  { key: "smart", label: "Smart case" },
  { key: "sensitive", label: "Case sensitive" },
  { key: "insensitive", label: "Ignore case" },
];

export default function FrontEndRipgrepControls({ params, activePreset, onChange, onPreset }) {
  return (
    <div className="rg-panel">
      <div className="rg-panel__head">
        <h1 className="rg-panel__title">Front end for ripgrep</h1>
        <p className="rg-panel__sub">
          rg recurses a tree, skips what .gitignore hides, and prints every line a pattern
          touches. This runs the same match logic over a small mocked repo.
        </p>
      </div>

      <div className="rg-panel__body" data-lenis-prevent>
        <section className="rg-group">
          <h2 className="rg-group__name">Pattern</h2>
          <input
            type="text"
            className="rg-input"
            value={params.pattern}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="TODO|FIXME"
            onChange={(event) => onChange("pattern", event.target.value)}
          />
          <div className="rg-presets">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="rg-chip"
                data-active={activePreset === preset.label ? "true" : undefined}
                onClick={() => onPreset(preset)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </section>

        <section className="rg-group">
          <h2 className="rg-group__name">Match mode</h2>
          <div className="rg-presets">
            <button
              type="button"
              className="rg-chip"
              data-active={params.mode === "regex" ? "true" : undefined}
              onClick={() => onChange("mode", "regex")}
            >
              Regex
            </button>
            <button
              type="button"
              className="rg-chip"
              data-active={params.mode === "fixed" ? "true" : undefined}
              onClick={() => onChange("mode", "fixed")}
            >
              Fixed string
            </button>
          </div>
        </section>

        <section className="rg-group">
          <h2 className="rg-group__name">Case</h2>
          <div className="rg-presets">
            {CASE_MODES.map((mode) => (
              <button
                key={mode.key}
                type="button"
                className="rg-chip"
                data-active={params.caseMode === mode.key ? "true" : undefined}
                onClick={() => onChange("caseMode", mode.key)}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </section>

        <section className="rg-group">
          <h2 className="rg-group__name">Flags</h2>
          <label className="rg-row rg-row--flat">
            <span className="rg-row__label">Whole word (-w)</span>
            <input
              type="checkbox"
              className="rg-check"
              checked={params.wholeWord}
              onChange={(event) => onChange("wholeWord", event.target.checked)}
            />
          </label>
          <label className="rg-row rg-row--flat">
            <span className="rg-row__label">Invert match (-v)</span>
            <input
              type="checkbox"
              className="rg-check"
              checked={params.invert}
              onChange={(event) => onChange("invert", event.target.checked)}
            />
          </label>
          <label className="rg-row rg-row--flat">
            <span className="rg-row__label">Search hidden files (--hidden)</span>
            <input
              type="checkbox"
              className="rg-check"
              checked={params.hidden}
              onChange={(event) => onChange("hidden", event.target.checked)}
            />
          </label>
          <label className="rg-row rg-row--flat">
            <span className="rg-row__label">Ignore .gitignore (--no-ignore)</span>
            <input
              type="checkbox"
              className="rg-check"
              checked={params.noIgnore}
              onChange={(event) => onChange("noIgnore", event.target.checked)}
            />
          </label>
          <div className="rg-row">
            <div className="rg-row__head">
              <span className="rg-row__label">Context lines (-C)</span>
              <span className="rg-row__readout">{params.context}</span>
            </div>
            <input
              type="range"
              className="rg-slider"
              min={0}
              max={3}
              step={1}
              value={params.context}
              onChange={(event) => onChange("context", Number(event.target.value))}
            />
          </div>
        </section>

        <section className="rg-group">
          <h2 className="rg-group__name">File type (-t)</h2>
          <div className="rg-presets">
            {FILE_TYPES.map((type) => (
              <button
                key={type.key}
                type="button"
                className="rg-chip"
                data-active={params.fileType === type.key ? "true" : undefined}
                onClick={() => onChange("fileType", type.key)}
              >
                {type.label}
              </button>
            ))}
          </div>
        </section>

        <p className="rg-credit">
          Built against the mechanic of{" "}
          <a href="https://github.com/BurntSushi/ripgrep" target="_blank" rel="noopener noreferrer">
            BurntSushi/ripgrep
          </a>
          . Reimplemented from scratch — no code from the project.
        </p>
      </div>
    </div>
  );
}
