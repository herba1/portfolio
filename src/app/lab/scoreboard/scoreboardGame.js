export const TEAMS = [
  { name: "GULLS", short: "GUL", label: "Gulls" },
  { name: "MILLERS", short: "MIL", label: "Millers" },
];

export const INNINGS = [
  [0, 1, 0, 0, 2, 1, null, null, null],
  [1, 0, 0, 3, 0, null, null, null, null],
];

export const HITS = [7, 6];
export const ERRORS = [1, 0];

export const RACK_DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "1", "2", null, null, null];

export const COL_R = 9;
export const COL_H = 10;
export const COL_E = 11;

export function slotKey(team, col) {
  return `${team}-${col}`;
}

export function colName(col) {
  if (col === COL_R) return "runs";
  if (col === COL_H) return "hits";
  if (col === COL_E) return "errors";
  const n = col + 1;
  const suffix = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

export function computeLayout(width, height, insets) {
  const narrow = width < 640;
  const spec = narrow
    ? { mx: 0.3, name: 1.75, g1: 0.2, g2: 0, rackCols: 8, rackRowsN: 2, rackPitch: 1.1 }
    : { mx: 0.6, name: 3.9, g1: 0.35, g2: 0.55, rackCols: 16, rackRowsN: 1, rackPitch: 1 };
  const unitsW = narrow ? spec.mx * 2 + spec.name + spec.g1 + 9 : spec.mx * 2 + spec.name + spec.g1 + 9 + spec.g2 + 3;
  const rackRowH = 1.5;
  const blockH = 0.7 + 3.0;
  const splitGap = 0.55;
  const scoreH = narrow ? blockH * 2 + splitGap : blockH;
  const unitsH = scoreH + 0.95 + rackRowH * spec.rackRowsN;
  const gutter = narrow ? 12 : 32;
  const availW = width - gutter * 2;
  const availH = height - insets.top - insets.bottom;
  const u = Math.max(12, Math.min(availW / unitsW, availH / unitsH, 88));
  const boardW = unitsW * u;
  const ox = (width - boardW) / 2;
  const oy = insets.top + Math.max(0, (availH - unitsH * u) / 2);
  const slotW = u * 0.86;
  const slotH = u * 1.26;
  const pw = u * 0.74;
  const ph = u * 1.1;
  const splitX = width / 2 - ((spec.name + spec.g1 + 3) * u) / 2;
  const colX = (col) => {
    if (col < 9) return ox + (spec.mx + spec.name + spec.g1 + col + 0.5) * u;
    if (narrow) return splitX + (spec.name + spec.g1 + (col - 9) + 0.5) * u;
    return ox + (spec.mx + spec.name + spec.g1 + 9 + spec.g2 + (col - 9) + 0.5) * u;
  };
  const blockTop = (col) => oy + (narrow && col >= 9 ? (blockH + splitGap) * u : 0);
  const rowY = (team, col) => blockTop(col) + 0.7 * u + 0.75 * u + team * 1.5 * u;
  const slots = [];
  for (let team = 0; team < 2; team += 1) {
    for (let col = 0; col < 12; col += 1) {
      slots.push({ key: slotKey(team, col), team, col, x: colX(col), y: rowY(team, col), w: slotW, h: slotH });
    }
  }
  const labels = [];
  for (let col = 0; col < 9; col += 1) labels.push({ text: String(col + 1), x: colX(col), y: blockTop(col) + 0.35 * u, h: u * 0.34, align: "center" });
  ["R", "H", "E"].forEach((t, i) => labels.push({ text: t, x: colX(9 + i), y: blockTop(9) + 0.35 * u, h: u * 0.34, align: "center" }));
  for (let team = 0; team < 2; team += 1) {
    const name = narrow ? TEAMS[team].short : TEAMS[team].name;
    const h = u * (narrow ? 0.5 : 0.56);
    const squeeze = narrow ? 0.86 : 0.92;
    labels.push({ text: name, x: ox + (spec.mx + 0.12) * u, y: rowY(team, 0), h, align: "left", squeeze });
    if (narrow) labels.push({ text: name, x: splitX + 0.12 * u, y: rowY(team, 9), h, align: "left", squeeze });
  }
  const rackTop = oy + (scoreH + 0.95) * u;
  const rack = [];
  const rackRows = [];
  const pitch = spec.rackPitch * u;
  const perRow = spec.rackCols;
  for (let row = 0; row < spec.rackRowsN; row += 1) {
    const railY = rackTop + row * rackRowH * u + 0.1 * u;
    const x0 = width / 2 - (perRow * pitch) / 2;
    rackRows.push({ y: railY, x0: x0 - u * 0.1, x1: x0 + perRow * pitch + u * 0.1 });
    for (let i = 0; i < perRow; i += 1) {
      rack.push({ index: row * perRow + i, x: x0 + (i + 0.5) * pitch, y: railY + 0.06 * u + ph / 2, railY });
    }
  }
  const rackBottom = rackTop + spec.rackRowsN * rackRowH * u;
  const panels = narrow
    ? [
        { x: ox + spec.mx * u * 0.4, y: oy - u * 0.3, w: boardW - spec.mx * u * 0.8, h: (blockH + 0.6) * u },
        { x: splitX - u * 0.1, y: oy + (blockH + splitGap - 0.3) * u, w: (spec.name + spec.g1 + 3.3) * u, h: (blockH + 0.6) * u },
      ]
    : [{ x: ox + spec.mx * u * 0.4, y: oy - u * 0.3, w: boardW - spec.mx * u * 0.8, h: (blockH + 0.6) * u }];
  return { W: width, H: height, u, ox, oy, spec, boardW, slots, labels, rack, rackRows, rackTop, rackBottom, slotW, slotH, pw, ph, narrow, panels };
}
