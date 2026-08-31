"use client";

import { useEffect, useRef } from "react";

import { HISTORY } from "./statFeed";

const WIDTH = 240;
const HEIGHT = 56;
const TOP = 8;
const BOTTOM = 48;
const STEP = WIDTH / (HISTORY - 2);

const xAt = (index) => (index - 1) * STEP;

export default function Sparkline({ points, slideKey, catchUp = 1, metricId, tone, cursor, live }) {
  const slideRef = useRef(null);

  useEffect(() => {
    const node = slideRef.current;
    if (!node || slideKey === 0) return undefined;
    node.dataset.sliding = "false";
    const raf = requestAnimationFrame(() => {
      node.dataset.sliding = "true";
    });
    return () => {
      cancelAnimationFrame(raf);
      node.dataset.sliding = "false";
    };
  }, [slideKey]);

  if (!points.length) {
    return (
      <svg className="lsc-spark" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        <line className="lsc-spark__empty" x1="0" y1={BOTTOM} x2={WIDTH} y2={BOTTOM} />
      </svg>
    );
  }

  const lowest = Math.min(...points);
  const highest = Math.max(...points);
  const span = highest - lowest || 1;
  const yAt = (value) => BOTTOM - ((value - lowest) / span) * (BOTTOM - TOP);

  const line = points
    .map((value, index) => `${index === 0 ? "M" : "L"}${xAt(index).toFixed(2)} ${yAt(value).toFixed(2)}`)
    .join(" ");
  const area = `${line} L${xAt(points.length - 1).toFixed(2)} ${HEIGHT} L${xAt(0).toFixed(2)} ${HEIGHT} Z`;
  const gradientId = `lsc-fill-${metricId}`;
  const head = points.length - 1;
  const marked = cursor === null || cursor === undefined ? null : Math.min(head, Math.max(0, cursor));

  return (
    <svg
      className="lsc-spark"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      data-tone={tone}
      data-marked={marked === null ? "false" : "true"}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.26" />
          <stop offset="0.2" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="0.44" stopColor="currentColor" stopOpacity="0.1" />
          <stop offset="0.68" stopColor="currentColor" stopOpacity="0.05" />
          <stop offset="0.86" stopColor="currentColor" stopOpacity="0.02" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g
        ref={slideRef}
        className="lsc-spark__slide"
        data-catchup={catchUp > 1 ? "true" : "false"}
        style={{ "--step": `${STEP * catchUp}px` }}
      >
        <path className="lsc-spark__area" d={area} fill={`url(#${gradientId})`} />
        <path className="lsc-spark__line" d={line} pathLength="1" />
        <circle
          className="lsc-spark__head"
          data-live={live ? "true" : "false"}
          cx={xAt(head)}
          cy={yAt(points[head])}
          r="2.5"
        />
        {marked === null ? null : (
          <g className="lsc-spark__mark" style={{ "--x": `${xAt(marked)}px` }}>
            <line x1="0" y1={TOP - 6} x2="0" y2={HEIGHT} />
            <circle cx="0" cy={yAt(points[marked])} r="3.5" />
          </g>
        )}
      </g>
    </svg>
  );
}
