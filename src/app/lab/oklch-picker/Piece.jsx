"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { createEngine } from "./engine";
import "./oklch-picker.css";

const INITIAL = [
  { id: "accent", L: 0.623, C: 0.188, h: 259.8 },
  { id: "encore", L: 0.637, C: 0.208, h: 25.3 },
  { id: "stage", L: 0.666, C: 0.179, h: 58.3 },
  { id: "moss", L: 0.627, C: 0.17, h: 149.2 },
  { id: "plum", L: 0.552, C: 0.164, h: 313.4 },
];

const LIMIT = 12;

function sameColor(a, b) {
  const dh = Math.abs(((a.h - b.h + 540) % 360) - 180);
  return Math.abs(a.L - b.L) < 0.004 && Math.abs(a.C - b.C) < 0.003 && (dh < 0.8 || a.C < 0.01);
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const engineRef = useRef(null);
  const chipEls = useRef(new Map());
  const idRef = useRef(0);
  const [saved, setSaved] = useState(INITIAL);
  const [current, setCurrent] = useState(INITIAL[0]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const engine = createEngine(rootRef.current, chipEls.current, {
      onSettle: (color) => setCurrent(color),
      onGone: (id) => setSaved((list) => list.filter((item) => item.id !== id)),
    });
    engineRef.current = engine;
    engine.set(INITIAL[0], false);
    return () => engine.destroy();
  }, []);

  useLayoutEffect(() => {
    engineRef.current?.layoutChips();
  }, [saved]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  const chipRef = useCallback((id) => (el) => {
    if (el) chipEls.current.set(id, el);
    else chipEls.current.delete(id);
  }, []);

  const live = saved.filter((item) => !item.gone);
  const match = live.find((item) => sameColor(item, current));

  const save = () => {
    const color = engineRef.current?.color();
    if (!color || live.some((item) => sameColor(item, color))) return;
    idRef.current += 1;
    const fresh = { id: `saved-${idRef.current}`, L: color.L, C: color.C, h: color.h };
    setSaved((list) => {
      const alive = list.filter((item) => !item.gone);
      const ghosts = list.filter((item) => item.gone);
      const next = [fresh, ...alive];
      const overflow = next.slice(LIMIT).map((item) => ({ ...item, gone: true, at: engineRef.current?.chipAt(item.id) }));
      return [...next.slice(0, LIMIT), ...ghosts, ...overflow];
    });
    setCurrent(color);
  };

  const remove = (id) => {
    const at = engineRef.current?.chipAt(id);
    setSaved((list) => list.map((item) => (item.id === id ? { ...item, gone: true, at } : item)));
  };

  const pick = (item) => {
    setCurrent(item);
    engineRef.current?.set(item, true);
  };

  const copy = async () => {
    const text = engineRef.current?.css();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
    setCopied(true);
  };

  const onChipKey = (event, item) => {
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      const index = live.findIndex((x) => x.id === item.id);
      const neighbour = live[index + 1] || live[index - 1];
      remove(item.id);
      if (neighbour) requestAnimationFrame(() => chipEls.current.get(neighbour.id)?.querySelector("button")?.focus());
    }
  };

  const field = (axis, label) => (
    <label className="okp-field">
      <span className="okp-field-label text-ui-sm">{label}</span>
      <input
        className="okp-input text-ui font-mono"
        data-axis={axis}
        inputMode="decimal"
        spellCheck={false}
        autoComplete="off"
        aria-label={label}
        onKeyDown={(e) => engineRef.current?.fieldKey(e, axis)}
        onBlur={(e) => engineRef.current?.fieldCommit(e.currentTarget, axis)}
      />
    </label>
  );

  return (
    <div ref={rootRef} className={`okp${embedded ? " okp--embedded" : ""}`}>
      <header className="okp-head">
        <div className="okp-title">
          <span className="okp-name text-heading-sm">Accent</span>
          <span className="okp-token text-ui font-mono">--color-accent</span>
        </div>
        <span className="okp-gamut text-ui-sm" data-gamut="srgb">
          <span className="okp-gamut-dot" />
          <span className="okp-gamut-label">sRGB</span>
        </span>
      </header>

      <div className="okp-body">
        <section className="okp-stage">
          <div className="okp-plane-wrap">
            <div className="okp-ticks okp-ticks--l text-ui-xs font-mono" aria-hidden>
              <span>100</span>
              <span>75</span>
              <span>50</span>
              <span>25</span>
              <span>0</span>
            </div>
            <div
              className="okp-plane"
              tabIndex={0}
              role="slider"
              aria-label="Lightness and chroma"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={62}
              onPointerDown={(e) => engineRef.current?.planeDown(e)}
              onKeyDown={(e) => engineRef.current?.planeKey(e)}
            >
              <canvas className="okp-plane-canvas" />
              <svg className="okp-edges" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
                <path className="okp-edge-p3" vectorEffect="non-scaling-stroke" />
                <path className="okp-edge-srgb" vectorEffect="non-scaling-stroke" />
              </svg>
              <span className="okp-legend text-ui-xs font-mono" aria-hidden>
                <span className="okp-legend-item">
                  <i className="okp-swatch-line" />
                  sRGB
                </span>
                <span className="okp-legend-item">
                  <i className="okp-swatch-line okp-swatch-line--dash" />
                  P3
                </span>
              </span>
              <span className="okp-cross okp-cross--x" />
              <span className="okp-cross okp-cross--y" />
              <span className="okp-handle" />
            </div>
            <div className="okp-ticks okp-ticks--c text-ui-xs font-mono" aria-hidden>
              <span>0</span>
              <span>0.1</span>
              <span>0.2</span>
              <span>0.3</span>
            </div>
          </div>
          <div
            className="okp-hue"
            tabIndex={0}
            role="slider"
            aria-label="Hue"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={260}
            onPointerDown={(e) => engineRef.current?.hueDown(e)}
            onKeyDown={(e) => engineRef.current?.hueKey(e)}
          >
            <canvas className="okp-hue-canvas" width={360} height={1} />
            <span className="okp-hue-thumb" />
          </div>
        </section>

        <aside className="okp-side">
          <div className="okp-preview">
            <span className="okp-cta text-ui-lg">
              <span className="okp-cta-label">Get tickets</span>
              <span className="okp-cta-price font-mono">£38</span>
            </span>
            <span className="okp-link text-ui-lg">View lineup</span>
          </div>

          <div className="okp-values">
            <div className="okp-fields">
              {field("L", "L")}
              {field("C", "C")}
              {field("H", "H")}
            </div>
            <button type="button" className="okp-css text-ui font-mono" onClick={copy}>
              <span className="okp-css-text" data-hidden={copied || undefined} />
              <span className="okp-css-copied" data-shown={copied || undefined}>
                Copied
              </span>
            </button>
            <span className="okp-hex text-ui font-mono" />
          </div>

          <div className="okp-contrast">
            <div className="okp-pair" data-on="surface">
              <span className="okp-aa text-heading-sm" aria-hidden>
                Aa
              </span>
              <span className="okp-pair-label text-ui">On surface</span>
              <span className="okp-ratio text-ui font-mono">
                <span className="okp-ratio-n" />
                <span className="okp-ratio-x">:1</span>
              </span>
              <span className="okp-grade text-ui-xs" />
            </div>
            <div className="okp-pair" data-on="ink">
              <span className="okp-aa text-heading-sm" aria-hidden>
                Aa
              </span>
              <span className="okp-pair-label text-ui">On ink</span>
              <span className="okp-ratio text-ui font-mono">
                <span className="okp-ratio-n" />
                <span className="okp-ratio-x">:1</span>
              </span>
              <span className="okp-grade text-ui-xs" />
            </div>
          </div>

          <div className="okp-saved">
            <div className="okp-saved-head">
              <span className="okp-saved-title text-ui">
                Saved <span className="okp-count font-mono">{live.length}</span>
              </span>
              <button type="button" className="okp-save text-ui" onClick={save} disabled={Boolean(match)}>
                {match ? "Saved" : "Save colour"}
              </button>
            </div>
            <ul className="okp-chips">
              {saved.map((item) => (
                <li
                  key={item.id}
                  ref={chipRef(item.id)}
                  className="okp-chip"
                  data-gone={item.gone || undefined}
                  data-current={(match && match.id === item.id) || undefined}
                  style={item.gone && item.at ? { left: item.at.x, top: item.at.y } : undefined}
                >
                  <button
                    type="button"
                    className="okp-chip-swatch"
                    style={{ background: `oklch(${item.L} ${item.C} ${item.h})` }}
                    aria-label={`oklch ${Math.round(item.L * 1000) / 10}% ${item.C.toFixed(3)} ${item.h.toFixed(1)}`}
                    tabIndex={item.gone ? -1 : 0}
                    onClick={() => pick(item)}
                    onKeyDown={(e) => onChipKey(e, item)}
                  />
                  <button
                    type="button"
                    className="okp-chip-x"
                    aria-label="Remove colour"
                    tabIndex={-1}
                    onClick={() => remove(item.id)}
                  >
                    <svg viewBox="0 0 10 10" aria-hidden>
                      <path d="M3 3l4 4M7 3l-4 4" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
