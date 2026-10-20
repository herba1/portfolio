import { glyphRows } from "./teletextFont";
import { C, PAGE_INDEX, bannerRow, row } from "./teletextPages";

export const BPM = 156;
export const BEAT = 60 / BPM;
export const STEP = BEAT / 4;

export const RAINBOW = [C.red, C.yellow, C.green, C.cyan, C.blue, C.magenta];

export const BRIGHTS = [C.yellow, C.magenta, C.green, C.red, C.white, C.cyan];

const PAIRS = [
  [C.blue, C.yellow],
  [C.magenta, C.white],
  [C.red, C.yellow],
  [C.cyan, C.blue],
  [C.yellow, C.red],
  [C.green, C.blue],
  [C.white, C.magenta],
  [C.blue, C.cyan],
];

export const HYPER = [
  { page: 120, kind: "burst", title: "Tonight", line: "you don't have to be anyone tonight" },
  { page: 133, kind: "field", title: "Still here?", line: "still here? how are you?" },
  { page: 150, kind: "burst", title: "Easy", line: "nothing good comes easy but it comes" },
  { page: 152, kind: "field", title: "Streetlights", line: "we can stay out till the streetlights go soft" },
  { page: 160, kind: "burst", title: "Walk home", line: "i keep your voice on the walk home" },
  { page: 171, kind: "field", title: "Again", line: "it will take a while to feel like this again" },
  { page: 188, kind: "burst", title: "Anyway", line: "the whole point is not knowing and going anyway" },
  { page: 199, kind: "field", title: "Stay", line: "stay on the line. it comes back round." },
];

export const hyperFor = (n) => HYPER.find((h) => h.page === n) || null;

const BITS = [1, 2, 4, 8, 16, 64];

export function fgOn(color) {
  return color === C.white || color === C.yellow || color === C.cyan || color === C.green ? C.blue : C.white;
}

export function pulseAt(s) {
  return [1, 0.55, 0.75, 0.4][((s % 4) + 4) % 4];
}

function letterOn(word, px, py) {
  const letter = Math.floor(px / 6);
  const lx = px % 6;
  if (lx === 5 || letter >= word.length) return false;
  const rows = glyphRows(word[letter]);
  return rows[py] ? rows[py][lx] === "#" : false;
}

export function bigRows(word, bg, fg) {
  const w = Math.min(12, word.length);
  const text = word.slice(0, w);
  const offset = Math.floor((36 - w * 3) / 2);
  const out = [];
  for (let cy = 0; cy < 3; cy += 1) {
    const cells = [];
    for (let c = 0; c < 36; c += 1) {
      const lc = c - offset;
      let bits = 0;
      if (lc >= 0 && lc < w * 3) {
        for (let k = 0; k < 6; k += 1) {
          const px = lc * 2 + (k & 1);
          const py = cy * 3 + (k >> 1);
          if (letterOn(text, px, py)) bits |= BITS[k];
        }
      }
      cells.push(0x20 + bits);
    }
    out.push([bg, C.newBg, C.double, 0x10 + fg, ...cells]);
  }
  return out;
}

export function bandRow(bg) {
  return row(bg, C.newBg);
}

const levelBits = (k) => (k >= 1 ? 16 | 64 : 0) | (k >= 2 ? 4 | 8 : 0) | (k >= 3 ? 1 | 2 : 0);

function barLevel(c, s, pulse, seed) {
  const a = Math.abs(Math.sin(c * 0.37 + s * 0.61 + seed));
  const b = Math.abs(Math.sin(c * 0.11 - s * 0.23 + seed * 2.1));
  const tilt = 1 - Math.abs(c - 19) / 26;
  return Math.max(0, Math.min(1, 0.12 + (0.5 * a + 0.38 * b) * (0.45 + 0.55 * pulse) * (0.6 + 0.4 * tilt)));
}

export function meterRows(s, rowsN, seed = 0) {
  const pulse = pulseAt(s);
  const levels = [];
  for (let c = 0; c < 38; c += 1) levels.push(Math.round(barLevel(c, s, pulse, seed) * rowsN * 3));
  const out = [];
  for (let r = 0; r < rowsN; r += 1) {
    const fromBottom = rowsN - 1 - r;
    const color = fromBottom === 0 ? C.green : fromBottom === rowsN - 1 ? (pulse > 0.9 ? C.red : C.yellow) : C.yellow;
    const cells = levels.map((lv) => 0x20 + levelBits(Math.max(0, Math.min(3, lv - fromBottom * 3))));
    out.push([0x10 + color, C.separated, ...cells]);
  }
  return out;
}

export function tickerRow(s, color = C.green) {
  const nums = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, ...HYPER.map((h) => h.page)];
  const text = nums.map((n) => `${n} `).join("");
  const loop = text + text;
  const off = (s * 2) % text.length;
  return row(color, loop.slice(off, off + 39));
}

export function waveRow(s) {
  const cells = [];
  for (let c = 0; c < 39; c += 1) {
    let bits = 0;
    for (let k = 0; k < 2; k += 1) {
      const x = c * 2 + k;
      const h = Math.round(1 + Math.sin(x * 0.42 - s * 0.9));
      bits |= k === 0 ? [16, 4, 1][h] : [64, 8, 2][h];
    }
    cells.push(0x20 + bits);
  }
  return [0x10 + RAINBOW[Math.floor(s / 4) % 6], ...cells];
}

function plasmaRow(r, s, seed) {
  const t = s * 0.16 + seed;
  const value = (x, y) => {
    const v = Math.sin(x * 0.16 + t) + Math.sin(y * 0.34 - t * 1.2) + Math.sin((x + y) * 0.09 + t * 0.7) + Math.sin(Math.hypot(x - 40, y - 36) * 0.21 - t * 1.5);
    return (v + 4) / 8;
  };
  const out = [C.hold];
  let current = -1;
  for (let c = 1; c < 40; c += 1) {
    const u = value(c * 2 + 1, r * 3 + 1.5) * 3 + t * 0.12;
    const band = ((Math.floor(u) % 6) + 6) % 6;
    const color = RAINBOW[band];
    if (color !== current) {
      out.push(0x10 + color);
      current = color;
      continue;
    }
    let bits = 0;
    for (let k = 0; k < 6; k += 1) {
      const us = value(c * 2 + (k & 1), r * 3 + (k >> 1)) * 3 + t * 0.12;
      if (us - Math.floor(us) < 0.62) bits |= BITS[k];
    }
    out.push(0x20 + bits);
  }
  return out.slice(0, 40);
}

function wrapLine(text, width) {
  const words = text.split(" ");
  const lines = [];
  let cur = [];
  let len = 0;
  for (const w of words) {
    const add = cur.length ? len + 1 + w.length : w.length;
    if (cur.length && add > width) {
      lines.push(cur);
      cur = [w];
      len = w.length;
    } else {
      cur.push(w);
      len = add;
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

function lineRow(words, startIndex, current, beat, centre) {
  const parts = [C.double];
  const length = words.join(" ").length + 1;
  if (centre) parts.push(" ".repeat(Math.max(0, Math.floor((38 - length) / 2))));
  words.forEach((w, i) => {
    const gi = startIndex + i;
    const color = gi === current ? BRIGHTS[beat % 5] : gi < current ? C.white : C.cyan;
    parts.push(color, w);
  });
  return row(...parts);
}

function fastextFor(h) {
  const i = HYPER.indexOf(h);
  const prev = HYPER[(i - 1 + HYPER.length) % HYPER.length].page;
  const next = HYPER[(i + 1) % HYPER.length].page;
  const colors = [C.red, C.green, C.yellow, C.cyan];
  const labels = [`${prev} prev`, `${next} next`, "100 index", "records"];
  const parts = [];
  labels.forEach((label, k) => parts.push(colors[k], label.slice(0, 9).padEnd(9)));
  return {
    row: row(...parts),
    links: [
      { row: 24, c0: 0, c1: 9, page: prev },
      { row: 24, c0: 10, c1: 19, page: next },
      { row: 24, c0: 20, c1: 29, page: PAGE_INDEX },
      { row: 24, c0: 30, c1: 39, page: 101 },
    ],
  };
}

export function buildHyper(h, s) {
  const p = Array.from({ length: 25 }, () => row());
  const beat = Math.floor(s / 4);
  const words = h.line.split(" ");
  const current = beat % (words.length + 2);
  const seed = h.page * 0.37;
  p[1] = bannerRow(RAINBOW[beat % 6], h.title, `${h.page}`);
  const lines = wrapLine(h.line, 34);
  const fast = fastextFor(h);
  if (h.kind === "burst") {
    const pair = PAIRS[(beat + h.page) % PAIRS.length];
    const word = current < words.length ? words[current] : "\u2665";
    p[4] = bandRow(pair[0]);
    const big = bigRows(word, pair[0], pair[1]);
    p[5] = big[0];
    p[7] = big[1];
    p[9] = big[2];
    p[11] = bandRow(pair[0]);
    let start = 0;
    lines.slice(0, 2).forEach((ln, i) => {
      p[13 + i * 2] = lineRow(ln, start, current, beat, true);
      start += ln.length;
    });
    const meters = meterRows(s, 2, seed);
    p[18] = meters[0];
    p[19] = meters[1];
    p[21] = tickerRow(s);
  } else {
    for (let r = 3; r <= 8; r += 1) p[r] = plasmaRow(r, s, seed);
    let start = 0;
    lines.slice(0, 2).forEach((ln, i) => {
      p[10 + i * 2] = lineRow(ln, start, current, beat, true);
      start += ln.length;
    });
    for (let r = 15; r <= 21; r += 1) p[r] = plasmaRow(r, s, seed);
  }
  p[22] = row(C.cyan, "the beatles on herb.art", C.white, "    ", C.yellow, "100");
  p[24] = fast.row;
  return { rows: p, links: [...fast.links, { row: 22, c0: 0, c1: 39, page: PAGE_INDEX }] };
}
