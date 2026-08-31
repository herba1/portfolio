"use client";

import { useEffect, useRef } from "react";

import { TAPE_ROWS, formatMoney, stampFor } from "./statFeed";

export default function Tape({ rows, loading, activeIndex, pinned, queued, slideKey, onEngage, onRelease, onPin, onResume }) {
  const listRef = useRef(null);
  const rowRefs = useRef([]);
  const previousKey = useRef(slideKey);

  useEffect(() => {
    const node = listRef.current;
    const jump = slideKey - previousKey.current;
    previousKey.current = slideKey;
    if (!node || jump <= 0) return undefined;
    node.dataset.flush = jump > 1 ? "true" : "false";
    node.dataset.sliding = "false";
    const raf = requestAnimationFrame(() => {
      node.dataset.sliding = "true";
    });
    return () => {
      cancelAnimationFrame(raf);
      node.dataset.sliding = "false";
    };
  }, [slideKey]);

  const step = (from, direction) => {
    const next = Math.min(rows.length - 1, Math.max(0, from + direction));
    const node = rowRefs.current[next];
    if (node) node.focus();
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
        <h2 className="text-heading-sm lsc-tape__title">Order tape</h2>
        <div className="lsc-tape__status">
          {queued > 0 ? (
            <button type="button" className="text-ui lsc-resume" onClick={onResume}>
              <span className="lsc-resume__dot" />
              {queued === 1 ? "1 order waiting" : `${queued} orders waiting`}
            </button>
          ) : (
            <span className="text-ui lsc-tape__hint">
              {activeIndex === null ? "Hover a row to read the board at that order" : pinned ? "Pinned — press escape to resume" : "Holding"}
            </span>
          )}
        </div>
      </div>

      <div className="lsc-tape__clip">
        <ol
          ref={listRef}
          className="lsc-tape__list"
          onPointerLeave={pinned ? undefined : onRelease}
        >
          {loading
            ? Array.from({ length: TAPE_ROWS }, (unused, position) => (
                <li key={`skeleton-${position}`} className="lsc-tape__item" style={{ "--r": position }}>
                  <span className="lsc-skeleton lsc-skeleton--row" />
                </li>
              ))
            : rows.map((row, position) => (
                <li key={row.event.id} className="lsc-tape__item" style={{ "--r": position }} data-fresh={position === 0 ? "true" : "false"}>
                  <button
                    type="button"
                    ref={(node) => {
                      rowRefs.current[position] = node;
                    }}
                    className="lsc-row"
                    data-kind={row.event.kind}
                    data-active={row.index === activeIndex ? "true" : "false"}
                    data-pinned={pinned && row.index === activeIndex ? "true" : "false"}
                    tabIndex={position === rovingPosition ? 0 : -1}
                    aria-pressed={pinned && row.index === activeIndex}
                    aria-label={`${stampFor(row.event.at)}, ${row.event.buyer}, ${row.event.tier} ${Math.abs(row.event.seats)} seats, ${formatMoney(row.event.amount)}, ${row.event.channel}`}
                    onPointerEnter={pinned ? undefined : () => onEngage(row.index)}
                    onFocus={() => onEngage(row.index)}
                    onClick={() => onPin(row.index)}
                    onKeyDown={(event) => handleKeyDown(event, position)}
                  >
                    <span className="text-ui lsc-row__time">{stampFor(row.event.at)}</span>
                    <span className="text-ui lsc-row__buyer">{row.event.buyer}</span>
                    <span className="text-ui lsc-row__tier">
                      {row.event.tier}
                      <span className="lsc-row__seats">{`×${Math.abs(row.event.seats)}`}</span>
                    </span>
                    <span className="text-ui lsc-row__amount">{formatMoney(row.event.amount)}</span>
                    <span className="text-ui lsc-row__channel">{row.event.channel}</span>
                  </button>
                </li>
              ))}
        </ol>
      </div>
    </section>
  );
}
