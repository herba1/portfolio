"use client";

import { useEffect, useRef } from "react";

import CapacityBar from "./CapacityBar";
import OrderColumns from "./OrderColumns";
import RefundTicks from "./RefundTicks";
import RollingNumber from "./RollingNumber";
import VolumeCurve from "./VolumeCurve";
import { formatSigned, formatValue } from "./statFeed";

const Chevron = () => (
  <svg viewBox="0 0 12 12" className="lsc-chip__arrow" aria-hidden="true">
    <path
      d="M6 9.5V2.5M6 2.5L2.75 5.75M6 2.5L9.25 5.75"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default function StatCard({
  metric,
  state,
  value,
  delta,
  held,
  cut,
  bucket,
  segments,
  finalFraction,
  activeIndex,
  contribution,
  stamp,
  index,
  hit,
}) {
  const cardRef = useRef(null);

  useEffect(() => {
    const node = cardRef.current;
    if (!node || !hit) return undefined;
    node.dataset.hit = "false";
    const frame = requestAnimationFrame(() => {
      node.dataset.hit = "true";
    });
    return () => {
      cancelAnimationFrame(frame);
      node.dataset.hit = "false";
    };
  }, [hit, activeIndex]);

  const tone = state === "empty" ? "flat" : delta ? delta.direction : "flat";
  const reading = state === "empty" ? "none yet" : formatValue(metric, value);
  const spoken = `${metric.label}, ${state === "loading" ? "loading" : reading}${
    delta && state === "live" ? `, ${delta.text} since ${delta.since}` : ""
  }`;

  return (
    <article
      ref={cardRef}
      className="lsc-card"
      style={{ "--card": index }}
      data-state={state}
      data-tone={tone}
      data-held={held ? "true" : "false"}
    >
      <span className="lsc-sr">{spoken}</span>

      <span className="lsc-card__head" aria-hidden="true">
        <span className="text-ui-lg lsc-card__label">{metric.label}</span>
        {state === "loading" ? (
          <span className="lsc-skeleton lsc-skeleton--chip" />
        ) : (
          <span className="text-ui lsc-chip" data-tone={tone}>
            {delta && state !== "empty" ? <Chevron /> : null}
            {state === "empty" ? "None" : delta.text}
          </span>
        )}
      </span>

      <span className="lsc-card__value" aria-hidden="true">
        {state === "loading" ? (
          <span className="lsc-skeleton lsc-skeleton--value" />
        ) : state === "empty" ? (
          <span className="text-title-sm lsc-card__idle">None yet</span>
        ) : (
          <RollingNumber text={formatValue(metric, value)} className="text-title-lg" />
        )}
      </span>

      <span className="lsc-card__track" aria-hidden="true">
        {state === "loading" ? (
          <span className="lsc-skeleton lsc-skeleton--chart" />
        ) : metric.chart === "columns" ? (
          <OrderColumns active={bucket} held={held} />
        ) : metric.chart === "curve" ? (
          <VolumeCurve cut={cut} value={value} held={held} />
        ) : metric.chart === "capacity" ? (
          <CapacityBar segments={segments} finalFraction={finalFraction} held={held} />
        ) : (
          <RefundTicks cut={cut} activeIndex={activeIndex} held={held} empty={state === "empty"} />
        )}
      </span>

      <span className="lsc-card__foot" aria-hidden="true">
        {state === "loading" ? (
          <span className="lsc-skeleton lsc-skeleton--note" />
        ) : (
          <span className="text-ui lsc-card__note">{held ? `reading ${stamp}` : metric.note}</span>
        )}
        <span className="lsc-card__contribution" data-shown={held && contribution ? "true" : "false"}>
          <span className="text-ui lsc-card__contribution-value">
            {contribution ? formatSigned(metric, contribution) : ""}
          </span>
          <span className="text-ui lsc-card__contribution-note">this order</span>
        </span>
      </span>
    </article>
  );
}
