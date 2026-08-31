"use client";

import { BUCKETS, PEAK_SEATS } from "./statFeed";

const WIDTH = 240;
const HEIGHT = 64;
const TOP = 8;
const BASE = 56;
const GAP = 4;
const SLOT = WIDTH / BUCKETS.length;
const BAR = SLOT - GAP;

export default function OrderColumns({ active, held }) {
  return (
    <svg className="lsc-columns" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
      <line className="lsc-columns__base" x1="0" y1={BASE} x2={WIDTH} y2={BASE} />
      {BUCKETS.map((bucket, index) => {
        const height = Math.max(2, (bucket.seats / PEAK_SEATS) * (BASE - TOP));
        const state = !held ? "on" : index < active ? "past" : index === active ? "on" : "after";
        return (
          <rect
            key={bucket.start}
            className="lsc-columns__bar"
            data-state={state}
            style={{ "--i": index }}
            x={index * SLOT + GAP / 2}
            y={BASE - height}
            width={BAR}
            height={height}
            rx="1.5"
          />
        );
      })}
    </svg>
  );
}
