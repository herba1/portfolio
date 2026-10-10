"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import SlotNumber from "@/app/ui/SlotNumber";

import { ABSORB_RANGE, DRY_RANGE, INKS, PENS } from "./wetInkParams";

function Dial({ label, value, range, format, onChange }) {
  const [dragging, setDragging] = useState(false);
  const fill = (value - range.min) / (range.max - range.min);
  return (
    <label className="wi-dial" data-dragging={dragging ? "true" : "false"}>
      <span className="wi-dial__head">
        <span className="text-ui-lg">{label}</span>
        <SlotNumber className="wi-dial__value text-ui tabular-nums" value={format(value)} duration={dragging ? 0 : 420} stagger={30} />
      </span>
      <span className="wi-dial__track" style={{ "--wi-fill": fill }}>
        <span className="wi-dial__fill" />
        <span className="wi-dial__thumb" />
        <input
          className="wi-dial__input"
          type="range"
          min={range.min}
          max={range.max}
          step={range.step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerDown={() => setDragging(true)}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onBlur={() => setDragging(false)}
        />
      </span>
    </label>
  );
}

export default function InkPanel({ penId, onPen, inkId, onInk, absorb, onAbsorb, dry, onDry }) {
  const [open, setOpen] = useState(false);
  const activeInk = INKS.find((ink) => ink.id === inkId) ?? INKS[0];
  const penIndex = Math.max(
    0,
    PENS.findIndex((pen) => pen.id === penId),
  );
  return (
    <aside className="wi-panel" data-open={open ? "true" : "false"}>
      <button type="button" className="wi-panel__toggle text-heading-sm" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>Pen and ink</span>
        <ChevronDown className="wi-panel__chevron" size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      <div className="wi-panel__body">
        <div className="wi-panel__inner">
          <section className="wi-group">
            <h2 className="wi-group__title text-heading-sm">Pen</h2>
            <div className="wi-pens" role="radiogroup" aria-label="Pen" style={{ "--wi-pen-index": penIndex }}>
              <span className="wi-pens__pill" aria-hidden="true" />
              {PENS.map((pen) => (
                <button
                  key={pen.id}
                  type="button"
                  role="radio"
                  aria-checked={pen.id === penId}
                  className="wi-pens__option text-ui"
                  data-active={pen.id === penId ? "true" : "false"}
                  aria-label={pen.label}
                  onClick={() => onPen(pen.id)}
                >
                  {pen.short}
                </button>
              ))}
            </div>
          </section>
          <section className="wi-group">
            <div className="wi-group__head">
              <h2 className="wi-group__title text-heading-sm">Ink</h2>
              <span className="text-ui-lg text-ink-secondary">{activeInk.label}</span>
            </div>
            <div className="wi-inks" role="radiogroup" aria-label="Ink colour">
              {INKS.map((ink) => (
                <button
                  key={ink.id}
                  type="button"
                  role="radio"
                  aria-checked={ink.id === inkId}
                  aria-label={ink.label}
                  title={ink.label}
                  className="wi-inks__chip"
                  data-active={ink.id === inkId ? "true" : "false"}
                  style={{ "--wi-chip": ink.hex }}
                  onClick={() => onInk(ink.id)}
                />
              ))}
            </div>
          </section>
          <section className="wi-group">
            <Dial label="Absorbency" value={absorb} range={ABSORB_RANGE} format={(v) => v.toFixed(2)} onChange={onAbsorb} />
            <Dial label="Drying speed" value={dry} range={DRY_RANGE} format={(v) => `${v.toFixed(1)}×`} onChange={onDry} />
          </section>
        </div>
      </div>
    </aside>
  );
}
