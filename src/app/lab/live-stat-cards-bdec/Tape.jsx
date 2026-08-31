"use client";

import { useRef } from "react";

import { formatCount, formatMoney, stampFor } from "./statFeed";

export default function Tape({ rows, loading, activeIndex, pinned, onEngage, onRelease, onPin }) {
  const rowRefs = useRef([]);

  const step = (from, direction) => {
    const next = Math.min(rows.length - 1, Math.max(0, from + direction));
    const node = rowRefs.current[next];
    if (node) node.focus({ preventScroll: true });
    if (node) node.scrollIntoView({ block: "nearest" });
    onEngage(rows[next].index);
  };

  const handleKeyDown = (event, position) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      step(position, 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      step(position, -1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      step(0, 0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      step(rows.length - 1, 0);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onRelease();
    }
  };

  const activePosition = rows.findIndex((row) => row.index === activeIndex);
  const rovingPosition = activePosition < 0 ? 0 : activePosition;

  return (
    <section className="lsc-tape" data-held={activeIndex === null ? "false" : "true"}>
      <div className="lsc-tape__head">
        <span className="lsc-tape__id">
          <h2 className="text-heading-sm lsc-tape__title">Order tape</h2>
          <span className="text-ui lsc-tape__count">{`${formatCount(rows.length)} orders`}</span>
        </span>
        <span className="text-ui lsc-tape__hint">
          {activeIndex === null
            ? "Hover or arrow a row to read the board at that order"
            : pinned
              ? "Pinned — press escape to release"
              : "Holding"}
        </span>
      </div>

      <div className="lsc-tape__columns" aria-hidden="true">
        <span className="text-ui lsc-tape__column">Time</span>
        <span className="text-ui lsc-tape__column">Buyer</span>
        <span className="text-ui lsc-tape__column">Tier</span>
        <span className="text-ui lsc-tape__column lsc-tape__column--end">Amount</span>
        <span className="text-ui lsc-tape__column">Channel</span>
      </div>

      <div className="lsc-tape__scroll">
        <ol className="lsc-tape__list" onPointerLeave={pinned ? undefined : onRelease}>
          {loading
            ? Array.from({ length: 10 }, (unused, position) => (
                <li key={`skeleton-${position}`} className="lsc-tape__item" style={{ "--r": position }}>
                  <span className="lsc-skeleton lsc-skeleton--row" />
                </li>
              ))
            : rows.map((row, position) => (
                <li
                  key={row.order.id}
                  className="lsc-tape__item"
                  style={{ "--r": Math.min(position, 12) }}
                  data-enter={position < 12 ? "true" : "false"}
                >
                  <button
                    type="button"
                    ref={(node) => {
                      rowRefs.current[position] = node;
                    }}
                    className="lsc-row"
                    data-kind={row.order.kind}
                    data-active={row.index === activeIndex ? "true" : "false"}
                    data-pinned={pinned && row.index === activeIndex ? "true" : "false"}
                    tabIndex={position === rovingPosition ? 0 : -1}
                    aria-pressed={pinned && row.index === activeIndex}
                    aria-label={`${stampFor(row.order.at)}, ${row.order.buyer}, ${row.order.tier.label}, ${Math.abs(
                      row.order.seats,
                    )} seats, ${formatMoney(row.order.amount)}, ${row.order.channel}`}
                    onPointerEnter={pinned ? undefined : () => onEngage(row.index)}
                    onFocus={() => onEngage(row.index)}
                    onClick={() => onPin(row.index)}
                    onKeyDown={(event) => handleKeyDown(event, position)}
                  >
                    <span className="text-ui lsc-row__time">{stampFor(row.order.at)}</span>
                    <span className="text-ui lsc-row__buyer">{row.order.buyer}</span>
                    <span className="text-ui lsc-row__tier">
                      {row.order.tier.label}
                      <span className="lsc-row__seats">{`×${Math.abs(row.order.seats)}`}</span>
                    </span>
                    <span className="text-ui lsc-row__amount">{formatMoney(row.order.amount)}</span>
                    <span className="text-ui lsc-row__channel">{row.order.channel}</span>
                  </button>
                </li>
              ))}
        </ol>
      </div>
    </section>
  );
}
