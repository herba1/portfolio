const SLANT = 0.1;

function hseg(x0, x1, y, t) {
  const h = t / 2;
  return [
    [x0, y],
    [x0 + h, y - h],
    [x1 - h, y - h],
    [x1, y],
    [x1 - h, y + h],
    [x0 + h, y + h],
  ];
}

function vseg(x, y0, y1, t) {
  const h = t / 2;
  return [
    [x, y0],
    [x + h, y0 + h],
    [x + h, y1 - h],
    [x, y1],
    [x - h, y1 - h],
    [x - h, y0 + h],
  ];
}

function dseg(x0, y0, x1, y1, t) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const nx = (-dy / len) * (t / 2);
  const ny = (dx / len) * (t / 2);
  return [
    [x0 + nx, y0 + ny],
    [x1 + nx, y1 + ny],
    [x1 - nx, y1 - ny],
    [x0 - nx, y0 - ny],
  ];
}

function slant(poly, h) {
  return poly.map(([x, y]) => [x + (h - y) * SLANT, y]);
}

export const SIXTEEN = ["A1", "A2", "B", "C", "D2", "D1", "E", "F", "G1", "G2", "H", "I", "J", "K", "L", "M", "DP"];

export function sixteenGeometry(w, h) {
  const t = w * 0.12;
  const g = t * 0.24;
  const m = h / 2;
  const cx = w / 2;
  const segs = {
    A1: hseg(g, cx - g, 0, t),
    A2: hseg(cx + g, w - g, 0, t),
    D1: hseg(g, cx - g, h, t),
    D2: hseg(cx + g, w - g, h, t),
    G1: hseg(g, cx - g, m, t),
    G2: hseg(cx + g, w - g, m, t),
    F: vseg(0, g, m - g, t),
    E: vseg(0, m + g, h - g, t),
    B: vseg(w, g, m - g, t),
    C: vseg(w, m + g, h - g, t),
    I: vseg(cx, g, m - g, t),
    L: vseg(cx, m + g, h - g, t),
    H: dseg(t * 1.05, t * 1.15, cx - t * 0.95, m - t * 1.05, t * 0.82),
    J: dseg(w - t * 1.05, t * 1.15, cx + t * 0.95, m - t * 1.05, t * 0.82),
    K: dseg(cx - t * 0.95, m + t * 1.05, t * 1.05, h - t * 1.15, t * 0.82),
    M: dseg(cx + t * 0.95, m + t * 1.05, w - t * 1.05, h - t * 1.15, t * 0.82),
  };
  const out = {};
  for (const k of Object.keys(segs)) out[k] = slant(segs[k], h);
  const r = t * 0.62;
  out.DP = { circle: [w + t * 1.3 + (0 - 0) * SLANT, h - r * 0.4, r] };
  return out;
}

export const SEVEN = ["a", "b", "c", "d", "e", "f", "g"];

export function sevenGeometry(w, h) {
  const t = w * 0.17;
  const g = t * 0.22;
  const m = h / 2;
  const segs = {
    a: hseg(g, w - g, 0, t),
    g: hseg(g, w - g, m, t),
    d: hseg(g, w - g, h, t),
    f: vseg(0, g, m - g, t),
    e: vseg(0, m + g, h - g, t),
    b: vseg(w, g, m - g, t),
    c: vseg(w, m + g, h - g, t),
  };
  const out = {};
  for (const k of Object.keys(segs)) out[k] = slant(segs[k], h);
  return out;
}

const S16 = {
  " ": "",
  0: "A1 A2 B C D1 D2 E F J K",
  1: "B C J",
  2: "A1 A2 B G1 G2 E D1 D2",
  3: "A1 A2 B C D1 D2 G2",
  4: "F G1 G2 B C",
  5: "A1 A2 F G1 G2 C D1 D2",
  6: "A1 A2 F G1 G2 E C D1 D2",
  7: "A1 A2 B C",
  8: "A1 A2 B C D1 D2 E F G1 G2",
  9: "A1 A2 B C D1 D2 F G1 G2",
  A: "A1 A2 B C E F G1 G2",
  B: "A1 A2 B C D1 D2 I L G2",
  C: "A1 A2 F E D1 D2",
  D: "A1 A2 B C D1 D2 I L",
  E: "A1 A2 F E D1 D2 G1",
  F: "A1 A2 F E G1",
  G: "A1 A2 F E D1 D2 C G2",
  H: "F E B C G1 G2",
  I: "A1 A2 I L D1 D2",
  J: "B C D1 D2 E",
  K: "F E G1 J M",
  L: "F E D1 D2",
  M: "F E B C H J",
  N: "F E B C H M",
  O: "A1 A2 B C D1 D2 E F",
  P: "A1 A2 B F E G1 G2",
  Q: "A1 A2 B C D1 D2 E F M",
  R: "A1 A2 B F E G1 G2 M",
  S: "A1 A2 F G1 G2 C D1 D2",
  T: "A1 A2 I L",
  U: "F E D1 D2 C B",
  V: "F E K J",
  W: "F E B C K M",
  X: "H J K M",
  Y: "H J L",
  Z: "A1 A2 J K D1 D2",
  "-": "G1 G2",
  ".": "DP",
  ",": "K",
  "'": "J",
  "!": "I DP",
  "?": "A1 A2 B G2 L",
  "&": "A1 H J G1 E D1 D2 M",
  "(": "J M",
  ")": "H K",
  "/": "J K",
  "+": "G1 G2 I L",
  "*": "H J K M I L G1 G2",
  ":": "I L",
};

const S7 = {
  " ": "",
  "-": "g",
  0: "a b c d e f",
  1: "b c",
  2: "a b g e d",
  3: "a b g c d",
  4: "f g b c",
  5: "a f g c d",
  6: "a f g e c d",
  7: "a b c",
  8: "a b c d e f g",
  9: "a b c d f g",
};

export function sixteenMask(ch) {
  let key = ch.toUpperCase();
  if (!(key in S16)) key = key.normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (key === "’" || key === "‘") key = "'";
  if (!(key in S16)) key = " ";
  const list = S16[key] ? S16[key].split(" ") : [];
  let mask = 0;
  for (const s of list) mask |= 1 << SIXTEEN.indexOf(s);
  return mask;
}

export function sevenMask(ch) {
  const list = S7[ch] ? S7[ch].split(" ") : [];
  let mask = 0;
  for (const s of list) mask |= 1 << SEVEN.indexOf(s);
  return mask;
}

export const STROKE16 = ["F", "A1", "A2", "B", "H", "I", "J", "G1", "G2", "E", "K", "L", "M", "C", "D1", "D2", "DP"].map((s) => SIXTEEN.indexOf(s));
