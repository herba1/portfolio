export const SHEET_COLS = 85;
export const MARGIN_COLS = 10;
export const MAX_COL = 64;
export const BELL_COL = 57;
export const TOP_LINES = 18;
export const LINE_UNITS = 5 / 3;
export const SHEET_LINES = 66;
export const LAST_LINE = 44;
export const INK_COL0 = MARGIN_COLS - 3;
export const INK_COLS = MAX_COL + 7;

const NOTES = [
  "The Beatles",
  "Revolver",
  "",
  "Parlophone PMC 7009. Released in Britain on 5 August 1966.",
  "",
  "Recorded at EMI Studios, Abbey Road, London, between",
  "6 April and 21 June 1966. Produced by George Martin.",
  "Balance engineer: Geoff Emerick. Cover drawing and",
  "collage by",
];

const OVERTYPES = [];

export const START = { line: NOTES.length - 1, col: NOTES[NOTES.length - 1].length + 1 };

export function noteStrikes() {
  const out = [];
  NOTES.forEach((text, line) => {
    for (let col = 0; col < text.length; col += 1) if (text[col] !== " ") out.push({ ch: text[col], line, col });
  });
  for (const o of OVERTYPES) {
    for (let k = 0; k < o.text.length; k += 1) out.push({ ch: o.text[k], line: o.line, col: o.col + k });
  }
  return out;
}

export const SCRIPT =
  "Klaus Voormann.\n\nSide one\n\nTaxman  2:39\nEleanor Rigby  2:08\nI'm Only Sleeping  3:01\nLove You To  3:01\nHere, There and Everywhere  2:25\nYellow Submarine  2:40\nShe Said She Said  2:37\n";

const KEY_ROWS = [
  ["`1234567890-=", "~!@#$%^&*()_+"],
  ["qwertyuiop[]\\", "QWERTYUIOP{}|"],
  ["asdfghjkl;'", 'ASDFGHJKL:"'],
  ["zxcvbnm,./", "ZXCVBNM<>?"],
];

function buildBars() {
  const keys = [];
  KEY_ROWS.forEach(([lower, upper], row) => {
    for (let i = 0; i < lower.length; i += 1) {
      const x = i + row * 0.5 - (row === 0 ? 1 : 0);
      keys.push({ lower: lower[i], upper: upper[i], x, row });
    }
  });
  keys.sort((a, b) => a.x - b.x || a.row - b.row);
  const map = new Map();
  keys.forEach((k, index) => {
    const left = k.x < 5.2;
    map.set(k.lower, { index, left });
    map.set(k.upper, { index, left });
  });
  return { map, count: keys.length };
}

export const BARS = buildBars();

export const STRIP_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm,."];
