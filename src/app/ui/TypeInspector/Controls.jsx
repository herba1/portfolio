"use client";

import { useEffect, useRef, useState } from "react";
import { FEATURE_GROUPS } from "./schema";
import {
  composeFeatureSettings,
  formatControlValue,
  parseFeatureSettings,
  readControlValue,
  round,
} from "./css";

function Row({ label, overridden, onReset, children }) {
  return (
    <div className="ti-row" data-overridden={overridden || undefined}>
      <button
        type="button"
        className="ti-row__label"
        onClick={onReset}
        title={overridden ? "Reset to inherited value" : label}
      >
        <span className="ti-row__dot" />
        {label}
      </button>
      <div className="ti-row__control">{children}</div>
    </div>
  );
}

function Dial({ control, value, overridden, onChange, onReset }) {
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const scrub = useRef(null);
  const current = value === null || value === undefined ? "" : value;

  useEffect(() => {
    if (!typing) setDraft(current === "" ? "" : String(current));
  }, [current, typing]);

  const commit = (next) => {
    const n = Number.parseFloat(next);
    if (!Number.isFinite(n)) return;
    onChange(formatControlValue(control, round(n, 4)));
  };

  const stepFor = (event) =>
    control.step * (event.altKey ? 0.1 : event.shiftKey ? 10 : 1);

  const onScrubDown = (e) => {
    scrub.current = {
      x: e.clientX,
      base: Number.parseFloat(current) || 0,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onScrubMove = (e) => {
    const state = scrub.current;
    if (!state) return;
    const dx = e.clientX - state.x;
    if (!state.moved && Math.abs(dx) < 3) return;
    state.moved = true;
    const next = round(state.base + dx * stepFor(e), 5);
    setDraft(String(next));
    onChange(formatControlValue(control, next));
  };

  const onScrubUp = (e) => {
    const moved = scrub.current?.moved;
    scrub.current = null;
    if (moved) {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  return (
    <Row label={control.label} overridden={overridden} onReset={onReset}>
      <input
        type="range"
        className="ti-slider"
        min={control.min}
        max={control.max}
        step={control.step}
        value={current === "" ? control.min : current}
        onChange={(e) => onChange(formatControlValue(control, Number(e.target.value)))}
      />
      <span className="ti-num">
        <input
          className="ti-num__input"
          value={draft}
          inputMode="decimal"
          title="Drag to scrub · alt for fine · shift for coarse"
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
          onFocus={() => setTyping(true)}
          onBlur={(e) => {
            setTyping(false);
            commit(e.target.value);
          }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit(e.currentTarget.value);
              e.currentTarget.blur();
            }
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const step = stepFor(e);
              const base = Number.parseFloat(draft) || 0;
              const next = round(base + (e.key === "ArrowUp" ? step : -step), 4);
              setDraft(String(next));
              onChange(formatControlValue(control, next));
            }
          }}
        />
        {control.unit && control.unit !== "ratio" ? (
          <em className="ti-num__unit">{control.unit}</em>
        ) : null}
      </span>
    </Row>
  );
}

function Picker({ control, value, overridden, onChange, onReset }) {
  return (
    <Row label={control.label} overridden={overridden} onReset={onReset}>
      <select
        className="ti-select"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        {!control.options.some((o) => o.value === (value ?? "")) ? (
          <option value={value ?? ""}>{value || "—"}</option>
        ) : null}
        {control.options.map((o) => (
          <option key={o.value || "inherit"} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

const toHex = (value) => {
  if (!value) return "#000000";
  if (value.startsWith("#")) return value.slice(0, 7);
  const parts = value.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return "#000000";
  return `#${parts
    .slice(0, 3)
    .map((p) => Math.round(Number(p)).toString(16).padStart(2, "0"))
    .join("")}`;
};

function Swatch({ control, value, overridden, onChange, onReset }) {
  return (
    <Row label={control.label} overridden={overridden} onReset={onReset}>
      <input
        type="color"
        className="ti-color"
        value={toHex(value)}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        className="ti-text ti-text--mono"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
    </Row>
  );
}

function Field({ control, value, overridden, onChange, onReset }) {
  return (
    <Row label={control.label} overridden={overridden} onReset={onReset}>
      <input
        className="ti-text ti-text--mono"
        placeholder={control.placeholder}
        value={value ?? ""}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </Row>
  );
}

export function ControlList({ controls, element, computed, overrides, setOverride }) {
  if (!element || !computed) return <p className="ti-empty">Pick some text first.</p>;

  return (
    <div className="ti-list">
      {controls.map((control) => {
        const overridden = control.prop in overrides;
        const live = overridden
          ? overrides[control.prop]
          : computed.getPropertyValue(control.prop).trim();
        const onChange = (next) => setOverride(control.prop, next);
        const onReset = () => setOverride(control.prop, undefined);

        if (control.type === "range") {
          return (
            <Dial
              key={control.prop}
              control={control}
              value={readControlValue(control, computed, element)}
              overridden={overridden}
              onChange={onChange}
              onReset={onReset}
            />
          );
        }
        if (control.type === "select") {
          return (
            <Picker
              key={control.prop}
              control={control}
              value={live}
              overridden={overridden}
              onChange={onChange}
              onReset={onReset}
            />
          );
        }
        if (control.type === "color") {
          return (
            <Swatch
              key={control.prop}
              control={control}
              value={live}
              overridden={overridden}
              onChange={onChange}
              onReset={onReset}
            />
          );
        }
        return (
          <Field
            key={control.prop}
            control={control}
            value={live}
            overridden={overridden}
            onChange={onChange}
            onReset={onReset}
          />
        );
      })}
    </div>
  );
}

const STATE_ORDER = { undefined: 1, 1: 0, 0: undefined };

export function FeatureGrid({ computed, overrides, setOverride, available }) {
  const settings = parseFeatureSettings(
    overrides["font-feature-settings"] ??
      computed.getPropertyValue("font-feature-settings"),
  );

  const cycle = (tag) => {
    const next = { ...settings };
    const state = settings[tag];
    const upcoming = state === undefined ? 1 : state === 1 ? 0 : undefined;
    if (upcoming === undefined) delete next[tag];
    else next[tag] = upcoming;
    const composed = composeFeatureSettings(next);
    setOverride("font-feature-settings", composed || undefined);
  };

  return (
    <div className="ti-features">
      {FEATURE_GROUPS.map((group) => (
        <section key={group.label} className="ti-features__group">
          <h4 className="ti-features__title">{group.label}</h4>
          <div className="ti-chips">
            {group.tags.map((tag) => {
              const state = settings[tag];
              const supported = !available || available.has(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className="ti-chip"
                  data-state={state === 1 ? "on" : state === 0 ? "off" : undefined}
                  data-missing={supported ? undefined : "1"}
                  title={
                    supported
                      ? `${tag} — click to cycle on / off / default`
                      : `${tag} — not present in this font`
                  }
                  onClick={() => cycle(tag)}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <div className="ti-features__raw">
        <label className="ti-features__rawlabel">font-feature-settings</label>
        <input
          className="ti-text ti-text--mono"
          value={overrides["font-feature-settings"] ?? ""}
          placeholder={computed.getPropertyValue("font-feature-settings")}
          spellCheck={false}
          onChange={(e) =>
            setOverride("font-feature-settings", e.target.value || undefined)
          }
        />
      </div>
    </div>
  );
}
