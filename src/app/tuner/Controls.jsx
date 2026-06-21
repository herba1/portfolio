"use client";

import { TUNING_LIST } from "./tunings";

const MODES = [
  { id: "auto", label: "Auto" },
  { id: "chromatic", label: "Chromatic" },
];

// Instrument presets only — "chromatic" is a mode, not a tuning.
const PRESETS = TUNING_LIST.filter((t) => t.type !== "chromatic");

// Controls as plain type: a text-style preset dropdown and a two-word mode
// toggle. No labels, no chrome — the values speak for themselves; state is
// carried by solid colour (active = ink, inactive = muted).

export default function Controls({ mode, setMode, tuningId, setTuningId }) {
  return (
    <div className="tuner__controls">
      <span className="tuner__select">
        <select
          value={tuningId}
          onChange={(e) => setTuningId(e.target.value)}
          aria-label="Tuning preset"
        >
          {PRESETS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </span>

      <div className="tuner__modes" role="group" aria-label="Mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`tuner__mode${mode === m.id ? " is-active" : ""}`}
            onClick={() => setMode(m.id)}
            aria-pressed={mode === m.id}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
