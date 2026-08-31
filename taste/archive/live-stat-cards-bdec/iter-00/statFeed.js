export const POINTS = 25;
export const VISIBLE = 24;
export const RECENT = 7;
export const TICK_MS = 2400;

const seeded = (seed) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const METRICS = [
  {
    id: "orders",
    label: "Orders",
    seed: 20240419,
    base: 1246,
    drift: 3.4,
    volatility: 22,
    swing: 9,
    min: 1080,
    max: 1520,
    format: "count",
    deltaUnit: "percent",
  },
  {
    id: "gross",
    label: "Gross volume",
    seed: 771205,
    base: 178400,
    drift: 520,
    volatility: 2600,
    swing: 1400,
    min: 150000,
    max: 260000,
    format: "currency",
    deltaUnit: "percent",
  },
  {
    id: "sellthrough",
    label: "Sell-through",
    seed: 51503,
    base: 0.612,
    drift: 0.0026,
    volatility: 0.014,
    swing: 0.006,
    min: 0.42,
    max: 0.94,
    format: "percent",
    deltaUnit: "points",
  },
  {
    id: "refunds",
    label: "Refunds",
    empty: true,
    format: "count",
    deltaUnit: "percent",
  },
];

export const STALE_METRIC = "sellthrough";
export const STALE_FROM = 8;
export const STALE_UNTIL = 12;

export const isStale = (metricId, frame) =>
  metricId === STALE_METRIC && frame >= STALE_FROM && frame < STALE_UNTIL;

export const catchUpFor = (metricId, frame) =>
  metricId === STALE_METRIC && frame === STALE_UNTIL ? STALE_UNTIL - STALE_FROM : 1;

export const seriesFor = (metric, frame) => {
  if (metric.empty) return [];
  const random = seeded(metric.seed);
  const walk = [];
  let level = metric.base;
  const total = frame + POINTS;
  for (let i = 0; i <= total; i += 1) {
    level = clamp(level + metric.drift + (random() - 0.5) * metric.volatility, metric.min, metric.max);
    walk.push(clamp(level + Math.sin(i / 6.5) * metric.swing, metric.min, metric.max));
  }
  return walk.slice(frame, frame + POINTS);
};

const formatterCache = new Map();

const formatter = (options) => {
  const key = JSON.stringify(options);
  let found = formatterCache.get(key);
  if (!found) {
    found = new Intl.NumberFormat("en-US", options);
    formatterCache.set(key, found);
  }
  return found;
};

export const formatValue = (metric, value) => {
  if (metric.format === "currency") {
    return formatter({
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }
  if (metric.format === "percent") {
    return formatter({ style: "percent", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
  }
  return formatter({ minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
};

export const formatCompact = (metric, value) => {
  if (metric.format === "currency") {
    return formatter({
      notation: "compact",
      compactDisplay: "short",
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 1,
    }).format(value);
  }
  return formatValue(metric, value);
};

export const deltaFor = (metric, points) => {
  if (points.length < RECENT + 1) return null;
  const last = points[points.length - 1];
  const previous = points[points.length - RECENT - 1];
  if (metric.deltaUnit === "points") {
    const change = (last - previous) * 100;
    return {
      direction: change >= 0 ? "up" : "down",
      text: `${formatter({ minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "always" }).format(change)} pts`,
    };
  }
  const change = (last - previous) / Math.abs(previous);
  return {
    direction: change >= 0 ? "up" : "down",
    text: formatter({
      style: "percent",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      signDisplay: "always",
    }).format(change),
  };
};

const START_MINUTES = 20 * 60 + 5;
const MINUTES_PER_POINT = 5;

export const stampFor = (absoluteIndex) => {
  const minutes = (START_MINUTES + absoluteIndex * MINUTES_PER_POINT) % 1440;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};
