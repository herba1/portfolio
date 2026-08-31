export const CAPACITY = 2050;
export const TICK_MS = 2600;
export const HISTORY = 26;
export const RECENT = 7;
export const LEAD = 26;
export const TAPE_ROWS = 8;
export const STALE_FROM = 7;
export const STALE_UNTIL = 12;

const seeded = (seed) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const BUYERS = [
  "Maya Ruiz",
  "Devon Clark",
  "Priya Anand",
  "Ola Bakare",
  "Sam Whitfield",
  "Noor Haddad",
  "Theo Lindqvist",
  "Jess Moreau",
  "Kai Nakamura",
  "Ruth Adeyemi",
  "Ana Vidal",
  "Malik Ferrante",
  "Lena Kowalski",
  "Cyrus Behzadi",
  "Frankie Doyle",
  "Imani Brooks",
];

const TIERS = [
  { label: "General", price: 42, weight: 0.56 },
  { label: "Early", price: 34, weight: 0.14 },
  { label: "Balcony", price: 58, weight: 0.2 },
  { label: "Table", price: 240, weight: 0.1 },
];

const CHANNELS = ["App", "Web", "Resale", "Door"];

const pickTier = (roll) => {
  let running = 0;
  for (const tier of TIERS) {
    running += tier.weight;
    if (roll <= running) return tier;
  }
  return TIERS[0];
};

const buildEvents = (count) => {
  const random = seeded(90210);
  const events = [];
  let minute = 20 * 60 + 2;
  for (let index = 0; index < count; index += 1) {
    minute += 1 + Math.floor(random() * 3);
    const tier = pickTier(random());
    const seats = tier.label === "Table" ? 1 : 1 + Math.floor(random() * 3);
    const refunded = index > LEAD + 5 && random() < 0.08;
    events.push({
      id: `sale-${index}`,
      at: minute,
      kind: refunded ? "refund" : "sale",
      buyer: BUYERS[Math.floor(random() * BUYERS.length)],
      tier: tier.label,
      channel: refunded ? "Refund" : CHANNELS[Math.floor(random() * CHANNELS.length)],
      seats: refunded ? -seats : seats,
      amount: (refunded ? -1 : 1) * seats * tier.price,
    });
  }
  return events;
};

export const EVENTS = buildEvents(320);

const OPENING = { sold: 902, gross: 42394, refunded: 0 };

export const TOTALS = [];

EVENTS.reduce((previous, event) => {
  const next = {
    sold: previous.sold + event.seats,
    gross: previous.gross + event.amount,
    refunded: previous.refunded + (event.kind === "refund" ? -event.seats : 0),
  };
  TOTALS.push(next);
  return next;
}, OPENING);

export const METRICS = [
  {
    id: "tickets",
    label: "Tickets sold",
    source: "Ticketing",
    format: "count",
    deltaUnit: "percent",
    read: (totals) => totals.sold,
    touched: () => true,
  },
  {
    id: "gross",
    label: "Gross volume",
    source: "Ticketing",
    format: "currency",
    deltaUnit: "percent",
    read: (totals) => totals.gross,
    touched: () => true,
  },
  {
    id: "sellthrough",
    label: "Sell-through",
    source: "Box office",
    format: "percent",
    deltaUnit: "points",
    read: (totals) => totals.sold / CAPACITY,
    touched: () => true,
  },
  {
    id: "refunds",
    label: "Refunds",
    source: "Ticketing",
    format: "count",
    deltaUnit: "count",
    read: (totals) => totals.refunded,
    touched: (event) => event.kind === "refund",
    canBeEmpty: true,
  },
];

export const isStale = (metricId, tick) =>
  metricId === "sellthrough" && tick >= STALE_FROM && tick < STALE_UNTIL;

export const catchUpFor = (metricId, tick) =>
  metricId === "sellthrough" && tick === STALE_UNTIL ? STALE_UNTIL - STALE_FROM : 1;

export const totalsAt = (index) => TOTALS[Math.min(Math.max(index, 0), TOTALS.length - 1)];

export const seriesFor = (metric, index) => {
  const end = Math.min(Math.max(index, 0), TOTALS.length - 1);
  const start = Math.max(0, end - HISTORY + 1);
  const points = [];
  for (let i = start; i <= end; i += 1) points.push(metric.read(TOTALS[i]));
  return points;
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
    return formatter({ style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
  }
  return formatter({ minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
};

export const formatMoney = (value) =>
  formatter({
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

export const formatSigned = (metric, value) => {
  if (metric.format === "currency") {
    return formatter({
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
      signDisplay: "always",
    }).format(value);
  }
  if (metric.format === "percent") {
    return `${formatter({ minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "always" }).format(value * 100)} pts`;
  }
  return formatter({ maximumFractionDigits: 0, signDisplay: "always" }).format(value);
};

export const deltaFor = (metric, index) => {
  const end = Math.min(Math.max(index, 0), TOTALS.length - 1);
  const from = end - RECENT;
  if (from < 0) return null;
  const last = metric.read(TOTALS[end]);
  const previous = metric.read(TOTALS[from]);
  const change = last - previous;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  if (metric.deltaUnit === "points") {
    return {
      direction,
      text: `${formatter({ minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "always" }).format(change * 100)} pts`,
    };
  }
  if (metric.deltaUnit === "count") {
    return { direction, text: formatter({ maximumFractionDigits: 0, signDisplay: "always" }).format(change) };
  }
  if (!previous) return { direction, text: "New" };
  return {
    direction,
    text: formatter({
      style: "percent",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      signDisplay: "always",
    }).format(change / Math.abs(previous)),
  };
};

export const contributionFor = (metric, index) => {
  const end = Math.min(Math.max(index, 0), TOTALS.length - 1);
  if (end === 0) return 0;
  return metric.read(TOTALS[end]) - metric.read(TOTALS[end - 1]);
};

export const stampFor = (minutes) => {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

export const stampAt = (index) => stampFor(EVENTS[Math.min(Math.max(index, 0), EVENTS.length - 1)].at);
