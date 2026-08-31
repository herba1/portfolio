"use client";

import { useMemo, useState } from "react";
import {
  GLYPH_ROWS,
  KERNING_PAIRS,
  PANGRAM,
  SPECIMEN_SIZES,
  SPECIMEN_WEIGHTS,
} from "./schema";
import { measureAdvances, measureKernPairs } from "./features";
import { round } from "./css";

const VIEWS = [
  { id: "waterfall", label: "Waterfall" },
  { id: "weights", label: "Weights" },
  { id: "glyphs", label: "Glyphs" },
  { id: "kerning", label: "Kerning" },
  { id: "numerals", label: "Numerals" },
];

const NUMERAL_ROWS = [
  { label: "Default", style: {} },
  { label: "Tabular", style: { fontVariantNumeric: "tabular-nums" } },
  { label: "Proportional", style: { fontVariantNumeric: "proportional-nums" } },
  { label: "Oldstyle", style: { fontVariantNumeric: "oldstyle-nums" } },
  { label: "Lining", style: { fontVariantNumeric: "lining-nums" } },
  { label: "Slashed zero", style: { fontVariantNumeric: "slashed-zero" } },
  { label: "Superscript", style: { fontVariantPosition: "super" } },
  { label: "Subscript", style: { fontVariantPosition: "sub" } },
];

function baseFont(computed) {
  if (!computed) return {};
  return {
    fontFamily: computed.fontFamily,
    fontWeight: computed.fontWeight,
    fontStyle: computed.fontStyle,
    fontStretch: computed.fontStretch,
    fontVariationSettings: computed.fontVariationSettings,
    fontFeatureSettings: computed.fontFeatureSettings,
    fontOpticalSizing: computed.fontOpticalSizing,
  };
}

export default function Specimen({ element, computed }) {
  const [view, setView] = useState("waterfall");
  const [sample, setSample] = useState("");

  const font = useMemo(() => baseFont(computed), [computed]);
  const trackingEm = useMemo(() => {
    if (!computed) return 0;
    const size = Number.parseFloat(computed.fontSize) || 16;
    const ls = Number.parseFloat(computed.letterSpacing);
    return Number.isFinite(ls) ? ls / size : 0;
  }, [computed]);

  const elementText = useMemo(() => {
    const text = (element?.textContent || "").replace(/\s+/g, " ").trim();
    return text.slice(0, 48);
  }, [element]);

  const kernText = sample || elementText || "AVATAR Wavy Tofu";

  const advances = useMemo(
    () => (view === "kerning" ? measureAdvances(element, kernText) : []),
    [view, element, kernText],
  );

  const pairs = useMemo(
    () => (view === "kerning" ? measureKernPairs(element, KERNING_PAIRS) : []),
    [view, element],
  );

  if (!element || !computed) return <p className="ti-empty">Pick some text first.</p>;

  return (
    <div className="ti-spec">
      <div className="ti-segmented">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className="ti-segmented__btn"
            data-active={view === v.id || undefined}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "waterfall" ? (
        <div className="ti-spec__body">
          {SPECIMEN_SIZES.map((size) => (
            <div key={size} className="ti-spec__line">
              <span className="ti-spec__tag">{size}</span>
              <p
                className="ti-spec__text"
                style={{
                  ...font,
                  fontSize: `${size}px`,
                  letterSpacing: `${round(trackingEm, 4)}em`,
                }}
              >
                {PANGRAM}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {view === "weights" ? (
        <div className="ti-spec__body">
          {SPECIMEN_WEIGHTS.map((weight) => (
            <div key={weight} className="ti-spec__line">
              <span className="ti-spec__tag">{weight}</span>
              <p
                className="ti-spec__text"
                style={{
                  ...font,
                  fontWeight: weight,
                  fontSize: "26px",
                  letterSpacing: `${round(trackingEm, 4)}em`,
                }}
              >
                Handgloves 0123
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {view === "glyphs" ? (
        <div className="ti-spec__body">
          {GLYPH_ROWS.map((row) => (
            <p
              key={row}
              className="ti-spec__glyphs"
              style={{ ...font, fontSize: "22px" }}
            >
              {row}
            </p>
          ))}
        </div>
      ) : null}

      {view === "numerals" ? (
        <div className="ti-spec__body">
          {NUMERAL_ROWS.map((row) => (
            <div key={row.label} className="ti-spec__line">
              <span className="ti-spec__tag ti-spec__tag--wide">{row.label}</span>
              <p
                className="ti-spec__text"
                style={{ ...font, ...row.style, fontSize: "22px" }}
              >
                0123456789 · 1,234.56 · 1/2
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {view === "kerning" ? (
        <div className="ti-spec__body">
          <input
            className="ti-text"
            value={sample}
            placeholder={elementText || "AVATAR Wavy Tofu"}
            spellCheck={false}
            onChange={(e) => setSample(e.target.value)}
          />

          <div className="ti-kern__stack">
            <span className="ti-spec__tag ti-spec__tag--wide">Kerned</span>
            <p
              className="ti-kern__line"
              style={{ ...font, fontSize: "40px", fontKerning: "normal" }}
            >
              {kernText}
            </p>
            <span className="ti-spec__tag ti-spec__tag--wide">Unkerned</span>
            <p
              className="ti-kern__line"
              style={{
                ...font,
                fontSize: "40px",
                fontKerning: "none",
                fontFeatureSettings: '"kern" 0',
              }}
            >
              {kernText}
            </p>
          </div>

          <div className="ti-kern__glyphs">
            {advances.map((entry, i) => (
              <span key={`${entry.char}-${i}`} className="ti-kern__glyph">
                <b style={{ ...font, fontSize: "24px" }}>
                  {entry.char === " " ? "␣" : entry.char}
                </b>
                <i>{round(entry.advance, 3)}</i>
                <u data-tight={entry.sidebearing < -0.002 || undefined}>
                  {i === 0 ? "—" : `${entry.sidebearing >= 0 ? "+" : ""}${round(entry.sidebearing, 3)}`}
                </u>
              </span>
            ))}
          </div>

          <table className="ti-kern__table">
            <thead>
              <tr>
                <th>Pair</th>
                <th>Kern</th>
                <th>On</th>
                <th>Off</th>
              </tr>
            </thead>
            <tbody>
              {pairs.map((p) => (
                <tr key={p.pair} data-kerned={Math.abs(p.deltaEm) > 0.0005 || undefined}>
                  <td style={{ ...font, fontSize: "16px" }}>{p.pair}</td>
                  <td className="ti-kern__delta">
                    {p.deltaEm >= 0 ? "+" : ""}
                    {round(p.deltaEm, 4)}em
                  </td>
                  <td>{round(p.kerned / 100, 3)}</td>
                  <td>{round(p.flat / 100, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
