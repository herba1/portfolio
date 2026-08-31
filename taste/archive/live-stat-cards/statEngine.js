export const HISTORY_LENGTH = 30;
export const TICK_MS = 1400;

export const STAT_DEFS = [
  {
    id: "listeners",
    label: "Active listeners",
    unit: "",
    seed: 12480,
    volatility: 0.018,
    drift: 0.0006,
    min: 800,
    max: 60000,
    decimals: 0,
  },
  {
    id: "revenue",
    label: "Revenue / hr",
    unit: "$",
    seed: 2140,
    volatility: 0.022,
    drift: 0.0004,
    min: 200,
    max: 9000,
    decimals: 0,
  },
  {
    id: "requests",
    label: "Requests / sec",
    unit: "",
    seed: 860,
    volatility: 0.03,
    drift: -0.0002,
    min: 40,
    max: 4000,
    decimals: 0,
  },
  {
    id: "errorRate",
    label: "Error rate",
    unit: "%",
    seed: 0.42,
    volatility: 0.09,
    drift: 0.0003,
    min: 0,
    max: 8,
    decimals: 2,
  },
];

export function seedHistory(def) {
  const history = new Array(HISTORY_LENGTH).fill(def.seed);
  let value = def.seed;
  for (let i = HISTORY_LENGTH - 1; i >= 0; i -= 1) {
    history[i] = value;
    value = clamp(value * (1 - def.drift + (Math.random() - 0.5) * def.volatility), def.min, def.max);
  }
  return history;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function nextValue(def, current) {
  const noise = (Math.random() - 0.5) * def.volatility;
  const next = current * (1 + def.drift + noise);
  return clamp(next, def.min, def.max);
}

export function formatValue(def, value) {
  const rounded = def.decimals === 0 ? Math.round(value) : Number(value.toFixed(def.decimals));
  const formatted = rounded.toLocaleString("en-US", {
    minimumFractionDigits: def.decimals,
    maximumFractionDigits: def.decimals,
  });
  return def.unit === "$" ? `${def.unit}${formatted}` : `${formatted}${def.unit}`;
}

export function percentDelta(history) {
  const first = history[0];
  const last = history[history.length - 1];
  if (first === 0) return 0;
  return ((last - first) / first) * 100;
}

export function sparklinePoints(history, width, height, padding = 4) {
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = max - min || 1;
  const usableHeight = height - padding * 2;
  return history.map((value, i) => {
    const x = (i / (history.length - 1)) * width;
    const y = padding + usableHeight - ((value - min) / range) * usableHeight;
    return { x, y, value };
  });
}

export function pathFromPoints(points) {
  return points.map((point, i) => `${i === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
}
