"use client";

import { useEffect, useRef } from "react";

import RollingNumber from "./RollingNumber";
import Sparkline from "./Sparkline";
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
  points,
  cursor,
  catchUp,
  slideKey,
  index,
  hit,
  contribution,
  stamp,
}) {
  const chipRef = useRef(null);
  const cardRef = useRef(null);
  const armed = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      armed.current = true;
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const node = chipRef.current;
    if (!node || !armed.current || slideKey === 0) return undefined;
    node.dataset.blinking = "false";
    const raf = requestAnimationFrame(() => {
      node.dataset.blinking = "true";
    });
    return () => {
      cancelAnimationFrame(raf);
      node.dataset.blinking = "false";
    };
  }, [slideKey]);

  useEffect(() => {
    const node = cardRef.current;
    if (!node || !hit || !armed.current) return undefined;
    node.dataset.hit = "false";
    const raf = requestAnimationFrame(() => {
      node.dataset.hit = "true";
    });
    return () => {
      cancelAnimationFrame(raf);
      node.dataset.hit = "false";
    };
  }, [slideKey, hit]);

  const tone = state === "stale" ? "flat" : delta ? delta.direction : "flat";
  const reading = state === "empty" ? "no refunds since doors" : formatValue(metric, value);
  const spoken =
    state === "loading"
      ? `${metric.label}, loading`
      : `${metric.label}, ${reading}${delta && state !== "empty" ? `, ${delta.text} over seven orders` : ""}${
          state === "stale" ? ", box office feed reconnecting" : ""
        }`;

  return (
    <article
      ref={cardRef}
      className="lsc-card"
      style={{ "--card": index }}
      data-state={state}
      data-tone={tone}
      data-marked={cursor === null ? "false" : "true"}
    >
      <span className="lsc-sr">{spoken}</span>

      <span className="lsc-card__head" aria-hidden="true">
        <span className="text-ui-lg lsc-card__label">{metric.label}</span>
        <span className="lsc-card__flag" data-state={state}>
          <span className="lsc-card__ping" />
        </span>
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

      <span className="lsc-card__meta" aria-hidden="true">
        {state === "loading" ? (
          <span className="lsc-skeleton lsc-skeleton--chip" />
        ) : (
          <span ref={chipRef} className="text-ui lsc-chip" data-tone={tone}>
            {delta && state !== "empty" ? <Chevron /> : null}
            {state === "empty" ? "No movement" : delta ? delta.text : "—"}
          </span>
        )}
        <span className="text-ui lsc-card__window">
          {state === "stale"
            ? `${metric.source} reconnecting`
            : cursor === null
              ? "last 7 orders"
              : `at ${stamp}`}
        </span>
      </span>

      <span className="lsc-card__track" aria-hidden="true">
        {state === "loading" ? (
          <span className="lsc-skeleton lsc-skeleton--spark" />
        ) : (
          <Sparkline
            points={state === "empty" ? [] : points}
            slideKey={slideKey}
            catchUp={catchUp}
            metricId={metric.id}
            tone={tone}
            cursor={state === "empty" ? null : cursor}
            live={state === "live" && cursor === null}
          />
        )}
      </span>

      <span className="lsc-card__contribution" data-shown={cursor !== null && contribution ? "true" : "false"} aria-hidden="true">
        <span className="text-ui lsc-card__contribution-value">
          {contribution ? formatSigned(metric, contribution) : ""}
        </span>
        <span className="text-ui lsc-card__contribution-note">this order</span>
      </span>
    </article>
  );
}
