"use client";

import { GROSS_CURVE, GROSS_PEAK } from "./statFeed";

const WIDTH = 240;
const HEIGHT = 64;
const TOP = 8;
const BASE = 56;

const xAt = (fraction) => fraction * WIDTH;
const yAt = (value) => BASE - (value / GROSS_PEAK) * (BASE - TOP);

const LINE = GROSS_CURVE.map(
  (point, index) => `${index === 0 ? "M" : "L"}${xAt(point.x).toFixed(2)} ${yAt(point.value).toFixed(2)}`,
).join(" ");

const AREA = `${LINE} L${WIDTH} ${HEIGHT} L0 ${HEIGHT} Z`;

export default function VolumeCurve({ cut, value, held }) {
  const width = Math.max(0, Math.min(1, cut)) * WIDTH;

  return (
    <svg className="lsc-curve" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="lsc-curve-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="0.18" stopColor="currentColor" stopOpacity="0.2" />
          <stop offset="0.42" stopColor="currentColor" stopOpacity="0.11" />
          <stop offset="0.66" stopColor="currentColor" stopOpacity="0.05" />
          <stop offset="0.85" stopColor="currentColor" stopOpacity="0.02" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
        <clipPath id="lsc-curve-clip">
          <rect className="lsc-curve__cut" x="0" y="0" width={WIDTH} height={HEIGHT} style={{ "--cut": cut }} />
        </clipPath>
      </defs>

      <path className="lsc-curve__ghost" d={LINE} />
      <g clipPath="url(#lsc-curve-clip)">
        <path className="lsc-curve__area" d={AREA} fill="url(#lsc-curve-fill)" />
        <path className="lsc-curve__line" d={LINE} pathLength="1" />
      </g>

      <g className="lsc-curve__mark" data-held={held ? "true" : "false"} style={{ "--x": `${width}px` }}>
        <line x1="0" y1="0" x2="0" y2={HEIGHT} />
        <circle cx="0" cy={yAt(value)} r="3.5" />
      </g>
    </svg>
  );
}
