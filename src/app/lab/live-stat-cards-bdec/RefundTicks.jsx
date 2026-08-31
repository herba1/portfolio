"use client";

import { REFUND_PEAK, REFUND_TICKS } from "./statFeed";

const WIDTH = 240;
const HEIGHT = 64;
const TOP = 10;
const BASE = 52;

export default function RefundTicks({ cut, activeIndex, held, empty }) {
  const edge = Math.max(0, Math.min(1, cut)) * WIDTH;

  return (
    <svg className="lsc-ticks" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
      <line className="lsc-ticks__base" data-empty={empty ? "true" : "false"} x1="0" y1={BASE} x2={WIDTH} y2={BASE} />
      {empty
        ? null
        : REFUND_TICKS.map((tick, order) => {
            const height = TOP + (1 - tick.seats / REFUND_PEAK) * 8;
            const state = tick.index === activeIndex ? "on" : !held || tick.x * WIDTH <= edge ? "past" : "after";
            return (
              <g key={tick.index} className="lsc-ticks__stem" data-state={state} style={{ "--i": order }}>
                <line x1={tick.x * WIDTH} y1={BASE} x2={tick.x * WIDTH} y2={height} />
                <circle cx={tick.x * WIDTH} cy={height} r="2" />
              </g>
            );
          })}
      <g className="lsc-ticks__mark" data-held={held ? "true" : "false"} style={{ "--x": `${edge}px` }}>
        <line x1="0" y1="4" x2="0" y2={BASE} />
      </g>
    </svg>
  );
}
