export const CAPACITY = 2050;
export const OPEN_AT = 20 * 60 + 2;
export const DOORS_AT = 21 * 60;
export const SPAN = 219;
export const CLOSE_AT = OPEN_AT + SPAN;
export const BUCKET_MIN = 15;
export const TAPE_ROWS = 72;
export const WINDOW_MIN = 30;

const TARGET = 1986;

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
  "Otis Vance",
  "Wren Callahan",
];

export const TIERS = [
  { id: "early", label: "Early", price: 34 },
  { id: "general", label: "General", price: 46 },
  { id: "balcony", label: "Balcony", price: 62 },
  { id: "table", label: "Table", price: 240 },
];

const tierWeights = (progress) => {
  if (progress < 0.22) return [0.46, 0.34, 0.15, 0.05];
  if (progress < 0.68) return [0, 0.6, 0.32, 0.08];
  return [0, 0.74, 0.22, 0.04];
};

const pickTier = (roll, progress) => {
  const weights = tierWeights(progress);
  let running = 0;
  for (let index = 0; index < TIERS.length; index += 1) {
    running += weights[index];
    if (roll <= running) return TIERS[index];
  }
  return TIERS[1];
};

const SHAPE = [
  [0, 0],
  [0.089, 0.15],
  [0.447, 0.35],
  [0.66, 0.6],
  [0.779, 0.8],
  [1, 1],
];

const warp = (fraction) => {
  for (let index = 1; index < SHAPE.length; index += 1) {
    const [x0, y0] = SHAPE[index - 1];
    const [x1, y1] = SHAPE[index];
    if (fraction <= x1) return y0 + ((fraction - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 1;
};

const pickChannel = (roll, minute) => {
  if (minute >= DOORS_AT) {
    if (roll < 0.3) return "Door";
    if (roll < 0.58) return "App";
    if (roll < 0.82) return "Web";
    return "Resale";
  }
  if (roll < 0.44) return "App";
  if (roll < 0.78) return "Web";
  return "Resale";
};

const buildOrders = () => {
  const random = seeded(20250912);
  const draft = [];
  const sales = [];
  let sold = 0;

  while (sold < TARGET && draft.length < 1400) {
    const progress = sold / TARGET;
    const refundable = sales.length > 24 && progress > 0.42 && random() < 0.024;
    if (refundable) {
      const source = sales[Math.floor(random() * sales.length * 0.72)];
      const order = {
        id: `order-${draft.length}`,
        kind: "refund",
        buyer: source.buyer,
        tier: source.tier,
        seats: -source.seats,
        amount: -source.amount,
      };
      draft.push(order);
      sold -= source.seats;
      continue;
    }
    const tier = pickTier(random(), progress);
    const seats = tier.id === "table" ? 1 : 1 + Math.floor(random() * 3);
    const order = {
      id: `order-${draft.length}`,
      kind: "sale",
      buyer: BUYERS[Math.floor(random() * BUYERS.length)],
      tier,
      seats,
      amount: seats * tier.price,
    };
    draft.push(order);
    sales.push(order);
    sold += seats;
  }

  const clock = seeded(451);
  const last = draft.length - 1;
  return draft.map((order, index) => {
    const at = OPEN_AT + Math.round(SPAN * warp(index / last));
    return {
      ...order,
      at,
      channel: order.kind === "refund" ? "Refund" : pickChannel(clock(), at),
    };
  });
};

export const ORDERS = buildOrders();

export const TOTALS = [];

ORDERS.reduce(
  (previous, order) => {
    const next = {
      sold: previous.sold + order.seats,
      gross: previous.gross + order.amount,
      refundSeats: previous.refundSeats + (order.kind === "refund" ? -order.seats : 0),
      refundOrders: previous.refundOrders + (order.kind === "refund" ? 1 : 0),
    };
    TOTALS.push(next);
    return next;
  },
  { sold: 0, gross: 0, refundSeats: 0, refundOrders: 0 },
);

export const TIER_SERIES = [];

ORDERS.reduce((previous, order) => {
  const next = { ...previous, [order.tier.id]: previous[order.tier.id] + order.seats };
  TIER_SERIES.push(next);
  return next;
}, Object.fromEntries(TIERS.map((tier) => [tier.id, 0])));

export const LAST = ORDERS.length - 1;
export const FINAL = TOTALS[LAST];

export const BUCKETS = (() => {
  const count = Math.ceil(SPAN / BUCKET_MIN);
  const list = Array.from({ length: count }, (unused, index) => ({
    start: OPEN_AT + index * BUCKET_MIN,
    seats: 0,
    gross: 0,
  }));
  for (const order of ORDERS) {
    const slot = Math.min(count - 1, Math.floor((order.at - OPEN_AT) / BUCKET_MIN));
    list[slot].seats += order.seats;
    list[slot].gross += order.amount;
  }
  return list;
})();

export const PEAK_SEATS = BUCKETS.reduce((most, bucket) => Math.max(most, bucket.seats), 0);
export const PEAK_BUCKET = BUCKETS.findIndex((bucket) => bucket.seats === PEAK_SEATS);

export const GROSS_CURVE = (() => {
  const points = [];
  let cursor = 0;
  for (let minute = OPEN_AT; minute <= CLOSE_AT; minute += 2) {
    while (cursor < ORDERS.length && ORDERS[cursor].at <= minute) cursor += 1;
    points.push({
      x: (minute - OPEN_AT) / SPAN,
      value: cursor === 0 ? 0 : TOTALS[cursor - 1].gross,
    });
  }
  return points;
})();

export const GROSS_PEAK = FINAL.gross;

export const REFUND_TICKS = ORDERS.reduce((list, order, index) => {
  if (order.kind === "refund") {
    list.push({ index, at: order.at, seats: -order.seats, x: (order.at - OPEN_AT) / SPAN });
  }
  return list;
}, []);

export const REFUND_PEAK = REFUND_TICKS.reduce((most, tick) => Math.max(most, tick.seats), 1);

export const clampIndex = (index) => Math.min(Math.max(index, 0), LAST);

export const totalsAt = (index) => TOTALS[clampIndex(index)];

export const bucketAt = (index) =>
  Math.min(BUCKETS.length - 1, Math.floor((ORDERS[clampIndex(index)].at - OPEN_AT) / BUCKET_MIN));

export const positionAt = (index) => (ORDERS[clampIndex(index)].at - OPEN_AT) / SPAN;

export const segmentsAt = (index) => {
  const series = TIER_SERIES[clampIndex(index)];
  return TIERS.map((tier) => ({ ...tier, seats: Math.max(0, series[tier.id]) }));
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

const MONEY = { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 };

export const formatMoney = (value) => formatter(MONEY).format(value);

export const formatCount = (value) => formatter({ maximumFractionDigits: 0 }).format(value);

export const formatValue = (metric, value) => {
  if (metric.format === "currency") return formatMoney(value);
  if (metric.format === "percent") {
    return formatter({ style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
  }
  return formatCount(value);
};

export const formatSigned = (metric, value) => {
  if (metric.format === "currency") return formatter({ ...MONEY, signDisplay: "always" }).format(value);
  if (metric.format === "percent") {
    return `${formatter({ minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: "always" }).format(value * 100)} pts`;
  }
  return formatter({ maximumFractionDigits: 0, signDisplay: "always" }).format(value);
};

export const stampFor = (minutes) => {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
};

export const stampAt = (index) => stampFor(ORDERS[clampIndex(index)].at);

const baseIndex = (index) => {
  const cut = ORDERS[index].at - WINDOW_MIN;
  let walker = index;
  while (walker > 0 && ORDERS[walker].at > cut) walker -= 1;
  return walker;
};

export const deltaFor = (metric, index) => {
  const end = clampIndex(index);
  const from = baseIndex(end);
  const change = metric.read(TOTALS[end]) - metric.read(TOTALS[from]);
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const since = stampFor(ORDERS[from].at);
  if (metric.deltaUnit === "points") {
    return {
      direction,
      since,
      text: `${formatter({ minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "always" }).format(change * 100)} pts`,
    };
  }
  if (metric.deltaUnit === "count") {
    return { direction, since, text: formatter({ maximumFractionDigits: 0, signDisplay: "always" }).format(change) };
  }
  const previous = metric.read(TOTALS[from]);
  if (!previous) return { direction, since, text: "First half hour" };
  return {
    direction,
    since,
    text: formatter({
      style: "percent",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      signDisplay: "always",
    }).format(change / Math.abs(previous)),
  };
};

export const contributionFor = (metric, index) => {
  const end = clampIndex(index);
  if (end === 0) return metric.read(TOTALS[0]);
  return metric.read(TOTALS[end]) - metric.read(TOTALS[end - 1]);
};

const SALE_COUNT = ORDERS.filter((order) => order.kind === "sale").length;
const AVERAGE_ORDER = Math.round(FINAL.gross / SALE_COUNT);

export const METRICS = [
  {
    id: "tickets",
    label: "Tickets sold",
    chart: "columns",
    format: "count",
    deltaUnit: "percent",
    note: `peak ${stampFor(BUCKETS[PEAK_BUCKET].start)}, ${PEAK_SEATS} seats`,
    read: (totals) => totals.sold,
    touched: () => true,
  },
  {
    id: "gross",
    label: "Gross volume",
    chart: "curve",
    format: "currency",
    deltaUnit: "percent",
    note: `average order ${formatMoney(AVERAGE_ORDER)}`,
    read: (totals) => totals.gross,
    touched: () => true,
  },
  {
    id: "sellthrough",
    label: "Sell-through",
    chart: "capacity",
    format: "percent",
    deltaUnit: "points",
    note: `${formatCount(CAPACITY - FINAL.sold)} seats left of ${formatCount(CAPACITY)}`,
    read: (totals) => totals.sold / CAPACITY,
    touched: () => true,
  },
  {
    id: "refunds",
    label: "Refunds",
    chart: "ticks",
    format: "count",
    deltaUnit: "count",
    note: `${FINAL.refundOrders} orders, ${FINAL.refundSeats} seats`,
    read: (totals) => totals.refundSeats,
    touched: (order) => order.kind === "refund",
    canBeEmpty: true,
  },
];

export const HEADLINE = {
  sold: FINAL.sold,
  gross: FINAL.gross,
  opened: stampFor(OPEN_AT),
  closed: stampFor(CLOSE_AT),
  doors: stampFor(DOORS_AT),
  orders: ORDERS.length,
};
