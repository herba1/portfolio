export const LEDGER_ROWS = [
  { id: "yanya", artist: "Nilüfer Yanya", track: "Stabilise", territory: "UK", streams: 1284930, rate: 0.0041, settled: true },
  { id: "yaeji", artist: "Yaeji", track: "Raingurl", territory: "KR", streams: 2940118, rate: 0.0038, settled: false },
  { id: "fred", artist: "Fred again..", track: "Delilah (pull me out of this)", territory: "GB", streams: 8112445, rate: 0.0043, settled: false },
  { id: "jamiexx", artist: "Jamie xx", track: "Gosh", territory: "GB", streams: 1003771, rate: 0.004, settled: false },
  { id: "sudan", artist: "Sudan Archives", track: "Selfish Soul", territory: "US", streams: 642208, rate: 0.0046, settled: false },
  { id: "overmono", artist: "Overmono", track: "So U Kno", territory: "GB", streams: 3455690, rate: 0.0039, settled: false },
  { id: "kelela", artist: "Kelela", track: "Contact", territory: "US", streams: 812554, rate: 0.0044, settled: false },
  { id: "cdw", artist: "Charlotte Day Wilson", track: "Mountains", territory: "CA", streams: 1570332, rate: 0.0042, settled: false },
];

export const EDITABLE_FIELDS = ["track", "streams", "rate"];

export const FLAKY_ROW = "fred";

const streamFormatter = new Intl.NumberFormat("en-US");
const rateFormatter = new Intl.NumberFormat("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const payoutFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatStreams = (value) => streamFormatter.format(value);
export const formatRate = (value) => rateFormatter.format(value);
export const formatPayout = (value) => payoutFormatter.format(value);

export const payoutOf = (row) => row.streams * row.rate;

export const cellKey = (rowId, field) => `${rowId}:${field}`;

export const rawValue = (row, field) => (field === "rate" ? row.rate.toFixed(4) : String(row[field]));

export const displayValue = (row, field) => {
  if (field === "streams") return formatStreams(row.streams);
  if (field === "rate") return formatRate(row.rate);
  return row.track;
};

export const parseField = (field, raw) => {
  const input = raw.trim();
  if (field === "track") return input.length ? input : null;
  const numeric = Number(input.replace(/[,$\s]/g, ""));
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (field === "streams") return Math.round(numeric);
  if (numeric > 1) return null;
  return Math.round(numeric * 10000) / 10000;
};

export const fieldLabel = { track: "track", streams: "streams", rate: "rate" };
