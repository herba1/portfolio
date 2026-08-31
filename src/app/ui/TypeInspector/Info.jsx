"use client";

import { useMemo, useState } from "react";
import { INSPECTED_PROPS, elementLabel, resolvedFontFamily, round } from "./css";

function fontMetrics(computed) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const size = 100;
  ctx.font = `${computed.fontStyle} ${computed.fontWeight} ${size}px ${computed.fontFamily}`;

  const cap = ctx.measureText("H");
  const ex = ctx.measureText("x");
  const full = ctx.measureText("Hxdgpq");

  return {
    capHeight: round(cap.actualBoundingBoxAscent / size, 3),
    xHeight: round(ex.actualBoundingBoxAscent / size, 3),
    ascender: round(full.fontBoundingBoxAscent / size, 3),
    descender: round(full.fontBoundingBoxDescent / size, 3),
    lineGap: round(
      (full.fontBoundingBoxAscent + full.fontBoundingBoxDescent) / size,
      3,
    ),
  };
}

function textStats(element) {
  const text = element?.textContent || "";
  const trimmed = text.replace(/\s+/g, " ").trim();
  let lines = 0;
  try {
    const range = document.createRange();
    range.selectNodeContents(element);
    lines = range.getClientRects().length;
  } catch {}
  return {
    characters: trimmed.length,
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    lines,
  };
}

function Ancestors({ element, onSelect }) {
  const chain = [];
  let node = element;
  while (node && node !== document.body && chain.length < 6) {
    chain.unshift(node);
    node = node.parentElement;
  }
  return (
    <div className="ti-crumbs">
      {chain.map((node, i) => (
        <button
          key={i}
          type="button"
          className="ti-crumb"
          data-current={node === element || undefined}
          onClick={() => onSelect(node)}
        >
          {elementLabel(node)}
        </button>
      ))}
    </div>
  );
}

function OverrideAudit({ element, computed, overrides }) {
  const entries = Object.entries(overrides || {});
  if (!element || !entries.length) return null;

  const rows = entries.map(([prop, wanted]) => {
    const inline = element.style.getPropertyValue(prop);
    const priority = element.style.getPropertyPriority(prop);
    const winner = computed.getPropertyValue(prop).trim();
    const landed = inline !== "";
    return { prop, wanted, inline, priority, winner, landed };
  });

  const failures = rows.filter((r) => !r.landed);

  return (
    <div className="ti-audit">
      <h4 className="ti-audit__title">
        {failures.length
          ? `${failures.length} override${failures.length > 1 ? "s" : ""} rejected by CSS`
          : `${rows.length} override${rows.length > 1 ? "s" : ""} live`}
      </h4>
      <dl className="ti-facts">
        {rows.map((row) => (
          <div key={row.prop} className="ti-fact" data-bad={!row.landed || undefined}>
            <dt>{row.prop}</dt>
            <dd title={`wrote ${row.wanted} · computed ${row.winner}`}>
              {row.landed ? row.winner : `rejected: ${row.wanted}`}
            </dd>
          </div>
        ))}
      </dl>
      {failures.length ? (
        <p className="ti-audit__note">
          The browser refused those values as invalid for the property.
        </p>
      ) : null}
    </div>
  );
}

function ContainerWarning({ element }) {
  if (!element) return null;
  const hasElementChildren = element.children.length > 0;
  const ownText = Array.from(element.childNodes).some(
    (n) => n.nodeType === 3 && n.textContent.trim().length,
  );
  if (!hasElementChildren || ownText) return null;

  const sized = Array.from(element.children).filter((child) => {
    const own = getComputedStyle(child).fontSize;
    return own !== getComputedStyle(element).fontSize;
  });

  return (
    <p className="ti-audit__warn">
      This is a container with no text of its own.
      {sized.length
        ? ` ${sized.length} of its ${element.children.length} children set their own font-size, so size and tracking here will not reach them. Press ↓ to step into one.`
        : " Press ↓ to step into the element that actually holds the text."}
    </p>
  );
}

export default function Info({ element, computed, overrides, onSelect }) {
  const [filter, setFilter] = useState("");

  const metrics = useMemo(() => (computed ? fontMetrics(computed) : null), [computed]);
  const stats = useMemo(() => (element ? textStats(element) : null), [element, computed]);
  const resolved = useMemo(() => (computed ? resolvedFontFamily(computed) : ""), [computed]);

  if (!element || !computed) {
    return (
      <p className="ti-empty">
        Move over any text to read it. Click to pin, double-click to rewrite it.
      </p>
    );
  }

  const rect = element.getBoundingClientRect();
  const size = Number.parseFloat(computed.fontSize) || 16;
  const lineHeightPx = Number.parseFloat(computed.lineHeight);
  const tracking = Number.parseFloat(computed.letterSpacing) || 0;

  const headline = [
    ["Font", resolved],
    ["Size", `${round(size, 2)}px`],
    [
      "Leading",
      Number.isFinite(lineHeightPx)
        ? `${round(lineHeightPx, 2)}px · ${round(lineHeightPx / size, 3)}`
        : computed.lineHeight,
    ],
    ["Tracking", `${round(tracking, 3)}px · ${round(tracking / size, 4)}em`],
    ["Weight", computed.fontWeight],
    ["Colour", computed.color],
  ];

  const box = [
    ["Box", `${round(rect.width, 1)} × ${round(rect.height, 1)}`],
    ["Characters", stats?.characters ?? 0],
    ["Words", stats?.words ?? 0],
    ["Lines", stats?.lines ?? 0],
    [
      "Measure",
      stats?.characters && stats?.lines
        ? `≈${Math.round(stats.characters / Math.max(stats.lines, 1))}ch`
        : "—",
    ],
  ];

  const vertical = metrics
    ? [
        ["Cap height", `${metrics.capHeight}em · ${round(metrics.capHeight * size, 1)}px`],
        ["x-height", `${metrics.xHeight}em · ${round(metrics.xHeight * size, 1)}px`],
        ["Ascender", `${metrics.ascender}em`],
        ["Descender", `${metrics.descender}em`],
        [
          "Half-leading",
          Number.isFinite(lineHeightPx)
            ? `${round((lineHeightPx - size * metrics.lineGap) / 2, 2)}px`
            : "—",
        ],
      ]
    : [];

  const query = filter.trim().toLowerCase();
  const dump = INSPECTED_PROPS.map((prop) => [
    prop,
    computed.getPropertyValue(prop).trim(),
  ]).filter(([prop, value]) =>
    query ? prop.includes(query) || value.toLowerCase().includes(query) : true,
  );

  return (
    <div className="ti-info">
      <Ancestors element={element} onSelect={onSelect} />

      <ContainerWarning element={element} />
      <OverrideAudit element={element} computed={computed} overrides={overrides} />

      <dl className="ti-facts ti-facts--lead">
        {headline.map(([label, value]) => (
          <div key={label} className="ti-fact">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <dl className="ti-facts">
        {box.map(([label, value]) => (
          <div key={label} className="ti-fact">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {vertical.length ? (
        <dl className="ti-facts">
          {vertical.map(([label, value]) => (
            <div key={label} className="ti-fact">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <input
        className="ti-text"
        placeholder="Filter computed properties"
        value={filter}
        spellCheck={false}
        onChange={(e) => setFilter(e.target.value)}
      />

      <dl className="ti-facts ti-facts--dump">
        {dump.map(([prop, value]) => (
          <div key={prop} className="ti-fact">
            <dt>{prop}</dt>
            <dd title={value}>{value || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
