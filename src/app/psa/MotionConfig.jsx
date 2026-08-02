"use client";

import { useState } from "react";

import { useSaveFlight } from "./SaveFlight";
import { useFlag } from "./flags";
import {
  EASES,
  FLAGGED_GROUPS,
  GLOBALS,
  GLOBAL_KNOBS,
  SAVE_VARIANTS,
  knobsFor,
} from "./saveMotion";

/* ─────────────────────────────────────────────────────────────────────────
   MotionConfig — the switcher and the tuning bench for the save flight.

   Deliberately outside the phone shell, and hidden entirely under 1000px
   (see saveFlight.css): the shell is the artefact being judged, and a control
   panel docked beside it on a phone viewport would be inside the thing it is
   measuring. Desktop is where you tune; the phone is where you look.

   Everything here renders from the schemas in saveMotion.js — ARC_KNOBS,
   LAUNCH_KNOBS, GLOBAL_KNOBS. There is no per-knob JSX. Adding a field to a
   variant and a row to the schema is all it takes to get a slider, which is
   what keeps "every number is configurable" true rather than aspirational.
   ───────────────────────────────────────────────────────────────────────── */

// Declared order, deduped — the group is a field on each variant, so this
// stays correct as rows are added.
const GROUPS = [...new Set(SAVE_VARIANTS.map((v) => v.group))];

// "outSine" → "Out sine". The curve names are already the vocabulary; they
// just need spaces.
const easeLabel = (id) =>
  id.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

// Print to the precision the slider actually steps at, so a 0.005 knob does
// not read as 0.07000000000000001.
const fmt = (v, step) => {
  const dp = (String(step).split(".")[1] ?? "").length;
  return dp ? Number(v).toFixed(dp) : String(Math.round(v));
};

function Knob({ row, value, base, onChange }) {
  const dirty = base !== undefined && value !== base;

  if (row.type === "ease") {
    return (
      <label className="psa-knob" data-dirty={dirty || undefined}>
        <span className="psa-knob-head">
          <span className="psa-knob-label">{row.label}</span>
        </span>
        <select value={value} onChange={(e) => onChange(row.key, e.target.value)}>
          {EASES.map((e) => (
            <option key={e.id} value={e.id}>
              {easeLabel(e.id)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (row.type === "seg") {
    return (
      <div className="psa-knob" data-dirty={dirty || undefined}>
        <span className="psa-knob-head">
          <span className="psa-knob-label">{row.label}</span>
        </span>
        <div className="psa-config-seg">
          {row.options.map((o) => (
            <button
              key={o.id}
              type="button"
              data-on={value === o.id || undefined}
              onClick={() => onChange(row.key, o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <label className="psa-knob" data-dirty={dirty || undefined}>
      <span className="psa-knob-head">
        <span className="psa-knob-label">{row.label}</span>
        <span className="psa-knob-value">
          {fmt(value, row.step)}
          {row.unit ? ` ${row.unit}` : ""}
        </span>
      </span>
      <input
        type="range"
        min={row.min}
        max={row.max}
        step={row.step}
        value={value}
        onChange={(e) => onChange(row.key, Number(e.target.value))}
      />
      {row.help && <p className="psa-config-help">{row.help}</p>}
    </label>
  );
}

function Section({ spec, values, base, onChange, open }) {
  return (
    <details className="psa-config-sec" open={open}>
      <summary>{spec.section}</summary>
      <div className="psa-config-sec-body">
        {spec.help && <p className="psa-config-help">{spec.help}</p>}
        {spec.rows.map((row) => (
          <Knob
            key={row.key}
            row={row}
            value={values[row.key]}
            base={base?.[row.key]}
            onChange={onChange}
          />
        ))}
      </div>
    </details>
  );
}

export default function MotionConfig() {
  const flight = useSaveFlight();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  /* Flagged groups exist in the registry either way — getTuning() must never
     have a hole in it — but they are not OFFERED until the flag is on, so
     nothing that already works changes because something new was added next
     to it. Turn it on with /psa?spring=1; it sticks after that. */
  const spring = useFlag("spring");

  if (!flight) return null;

  const groups = GROUPS.filter((g) => {
    const flag = FLAGGED_GROUPS[g];
    if (!flag) return true;
    return flag === "spring" ? spring : false;
  });

  const { variant, tuning, overrides, setKnob, resetVariant, globals, setGlobal, resetGlobals } =
    flight;

  const base = SAVE_VARIANTS.find((v) => v.id === variant);
  const schema = knobsFor(variant);
  const touched = Object.keys(overrides ?? {}).length > 0;

  /* Copy the current numbers back out as the row you would paste into
     saveMotion.js. The panel is for finding a feel; the file is where it
     lives, and retyping fifteen values off a screen is how a good one gets
     lost between the eye and the repo. */
  const copy = () => {
    const row = Object.fromEntries(
      schema.flatMap((s) => s.rows).map((r) => [r.key, tuning[r.key]]),
    );
    const text = `// ${base?.name}\n${JSON.stringify({ id: variant, ...row }, null, 2)}\n\n// GLOBALS\n${JSON.stringify(globals, null, 2)}`;
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      },
      () => {},
    );
  };

  return (
    /* Carries `pk` itself so it can read the kit's tokens while living
       outside the phone shell.

       data-lenis-prevent is what makes the panel scrollable at all. /psa calls
       lenis.stop(), and a STOPPED Lenis is not a passive one — it keeps its
       wheel listener and preventDefault()s everything it sees, which is how it
       holds the page still. Any scroller on the route therefore has to opt out
       by name or it silently refuses to move, however much it overflows. The
       app panel already does; this one was the last one that did not. */
    <aside className="pk psa-config" data-open={open || undefined} data-lenis-prevent>
      <button
        type="button"
        className="psa-config-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? "Hide" : "Motion"}
      </button>

      {open && (
        <div className="psa-config-body">
          <span className="psa-config-title">Save motion</span>

          {/* CHIPS, not cards. Six variants each carrying a paragraph pushed
              every slider below the fold, which is a good way to ship a
              control panel nobody can find the controls in. The description
              belongs to the one that is armed; the rest just need names. */}
          {groups.map((group) => (
            <div className="psa-config-group" key={group}>
              <span className="psa-config-group-label">{group}</span>
              <div className="psa-config-chips">
                {SAVE_VARIANTS.filter((v) => v.group === group).map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className="psa-config-chip"
                    data-on={variant === v.id || undefined}
                    onClick={() => flight.setVariant(v.id)}
                  >
                    {v.name}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <p className="psa-config-note">{base?.note}</p>

          {/* Per-variant knobs. Path open by default because it is the one
              that changes the shape of the thing rather than its detail. */}
          {schema.map((spec, i) => (
            <Section
              key={spec.section}
              spec={spec}
              values={tuning}
              base={base}
              onChange={setKnob}
              open={i <= 1 || spec.section === "Approach"}
            />
          ))}

          {/* Globals. Same machinery, different store. */}
          {GLOBAL_KNOBS.map((spec) => (
            <Section
              key={spec.section}
              spec={spec}
              values={globals}
              base={GLOBALS}
              onChange={setGlobal}
            />
          ))}

          <div className="psa-config-actions">
            <button
              type="button"
              className="psa-config-action"
              onClick={resetVariant}
              disabled={!touched}
            >
              Reset {base?.name}
            </button>
            <button type="button" className="psa-config-action" onClick={resetGlobals}>
              Reset globals
            </button>
            <button type="button" className="psa-config-action" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <p className="psa-config-foot">
            Cloned node, CSS keyframes, FLIP for the grid. No view transitions.
            Every slider above writes a custom property the keyframes already
            read, so nothing recompiles.
          </p>
        </div>
      )}
    </aside>
  );
}
