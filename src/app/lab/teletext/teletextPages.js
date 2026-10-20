import { ALBUMS } from "@/app/lab/_music/catalog";

export const C = {
  red: 0x01,
  green: 0x02,
  yellow: 0x03,
  blue: 0x04,
  magenta: 0x05,
  cyan: 0x06,
  white: 0x07,
  flash: 0x08,
  steady: 0x09,
  normal: 0x0c,
  double: 0x0d,
  gRed: 0x11,
  gGreen: 0x12,
  gYellow: 0x13,
  gBlue: 0x14,
  gMagenta: 0x15,
  gCyan: 0x16,
  gWhite: 0x17,
  contiguous: 0x19,
  separated: 0x1a,
  blackBg: 0x1c,
  newBg: 0x1d,
  hold: 0x1e,
  release: 0x1f,
};

export const PALETTE = [
  [0, 0, 0],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [0, 0, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
];

const NOTES = {
  "please-please-me": { color: C.red, note: "recorded in one long day in february 1963, the last take a sore-throated twist and shout.", line: "start somewhere loud" },
  "with-the-beatles": { color: C.white, note: "four faces in half shadow. the second record in one year, made between gigs.", line: "half in the light" },
  "a-hard-days-night": { color: C.yellow, note: "the first album of only their own songs, written for a film about running.", line: "it was a long day, wasn't it" },
  "beatles-for-sale": { color: C.yellow, note: "tired faces in an autumn park. an album made on days off from touring.", line: "autumn makes you honest" },
  help: { color: C.cyan, note: "yesterday closes side two, one guitar and a string quartet.", line: "it's fine to ask" },
  "rubber-soul": { color: C.yellow, note: "the cover photo slipped and stretched on the projector, and they kept it.", line: "keep the happy accident" },
  revolver: { color: C.white, note: "the cover drawn by klaus voormann, their friend from hamburg days.", line: "listen backwards sometimes" },
  "sgt-pepper": { color: C.magenta, note: "a band pretending to be another band, so they could be anyone.", line: "you can be anyone tonight" },
  "magical-mystery-tour": { color: C.cyan, note: "strawberry fields and penny lane side by side, two kinds of home.", line: "roll up for the long way round" },
  "white-album": { color: C.white, note: "a plain white sleeve, numbered, and thirty songs inside.", line: "say less, mean it" },
  "abbey-road": { color: C.green, note: "the last one they recorded together. side two plays like one long goodbye.", line: "and in the end" },
  "let-it-be": { color: C.cyan, note: "the rooftop, in the cold. the last songs they ever put out.", line: "still here? good" },
};

export const PAGE_INDEX = 100;
export const albumPage = (i) => 101 + i;
export const pageAlbum = (n) => (n >= 101 && n < 101 + ALBUMS.length ? n - 101 : -1);
export const SERVICE = [100, ...ALBUMS.map((_, i) => 101 + i), 120, 133, 150, 152, 160, 171, 188, 199];

export function row(...parts) {
  const out = [];
  for (const p of parts) {
    if (typeof p === "number") out.push(p);
    else for (const ch of p) out.push(ch.charCodeAt(0) > 126 ? 0x20 : ch.charCodeAt(0));
  }
  while (out.length < 40) out.push(0x20);
  return out.slice(0, 40);
}

export function blankPage() {
  return Array.from({ length: 25 }, () => row());
}

function wrap(text, width) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function fastext(items) {
  const parts = [];
  const colors = [C.red, C.green, C.yellow, C.cyan];
  items.forEach((label, i) => {
    parts.push(colors[i], label.slice(0, 9).padEnd(9));
  });
  return row(...parts);
}

export function bannerRow(color, title, right) {
  const fg = color === C.white || color === C.yellow || color === C.cyan || color === C.green ? C.blue : C.white;
  const parts = [color, C.newBg, C.double, fg, ` ${title}`];
  const used = 4 + title.length + 1;
  const pad = Math.max(0, 40 - used - right.length - 1);
  return row(...parts, " ".repeat(pad), right, " ");
}

export function buildIndex() {
  const p = blankPage();
  const links = [];
  p[1] = bannerRow(C.blue, "The Beatles", "herb.art");
  p[2] = row();
  p[3] = row(C.cyan, "records, one page each");
  ALBUMS.forEach((a, i) => {
    const r = 5 + i;
    const num = String(albumPage(i));
    const title = a.title.length > 27 ? `${a.title.slice(0, 26).trimEnd()}.` : a.title;
    const dots = ".".repeat(Math.max(1, 30 - title.length));
    p[r] = row(i % 2 ? C.cyan : C.white, title, C.blue, dots, C.yellow, num);
    links.push({ row: r, c0: 0, c1: 39, page: albumPage(i) });
  });
  p[18] = row(C.white, "type a page number, or tap a record.");
  p[20] = row(C.gGreen, "\x2c".repeat(39));
  p[21] = row(C.yellow, "  it will take a while to feel like");
  p[22] = row(C.yellow, "  this again. stay on the line.");
  p[24] = fastext(["Abbey Rd", "Revolver", "Let It Be", "Help!"]);
  const fx = [ALBUMS.findIndex((a) => a.id === "abbey-road"), ALBUMS.findIndex((a) => a.id === "revolver"), ALBUMS.findIndex((a) => a.id === "let-it-be"), ALBUMS.findIndex((a) => a.id === "help")];
  fx.forEach((ai, i) => links.push({ row: 24, c0: i * 10, c1: i * 10 + 9, page: albumPage(ai) }));
  return { rows: p, links };
}

export function buildAlbum(i, sub, mosaicRows) {
  const a = ALBUMS[i];
  const meta = NOTES[a.id] || { color: C.blue, note: "", line: "" };
  const p = blankPage();
  const links = [];
  const title = a.title.length > 22 ? a.title.replace("Sgt. Pepper's Lonely Hearts Club Band", "Sgt. Pepper's") : a.title;
  p[1] = bannerRow(meta.color, title, `${sub}/2`);
  p[2] = row();
  const right = [];
  if (sub === 1) {
    right.push([C.yellow, `${a.year}  side one`]);
    right.push([C.white, ""]);
    a.tracks.forEach((t, k) => {
      const lines = wrap(t, 19);
      lines.slice(0, 3).forEach((ln, j) => {
        right.push(j === 0 ? [C.cyan, `${k + 1}`, C.white, ln] : [C.white, "  ", ln]);
      });
    });
  } else {
    right.push([C.yellow, `${a.year}  about`]);
    right.push([C.white, ""]);
    wrap(meta.note, 21).forEach((ln) => right.push([C.white, ln]));
    right.push([C.white, ""]);
    right.push([C.green, `${a.tracks.length} songs here`]);
  }
  for (let r = 0; r < 13; r += 1) {
    const img = mosaicRows ? mosaicRows[r] : row().slice(0, 17);
    const text = right[r] ? row(...right[r]).slice(0, 22) : row().slice(0, 22);
    p[4 + r] = [...img.slice(0, 17), C.blackBg, ...text].slice(0, 40);
  }
  p[18] = row();
  p[19] = row(C.double, C.white, ` ${meta.line}`);
  p[20] = row();
  const prev = (i - 1 + ALBUMS.length) % ALBUMS.length;
  const next = (i + 1) % ALBUMS.length;
  p[22] = row(C.blue, "the beatles on herb.art", C.white, "    ", C.yellow, "100");
  p[24] = fastext([`${albumPage(prev)} prev`, `${albumPage(next)} next`, "100 index", sub === 1 ? "about" : "tracks"]);
  links.push({ row: 24, c0: 0, c1: 9, page: albumPage(prev) });
  links.push({ row: 24, c0: 10, c1: 19, page: albumPage(next) });
  links.push({ row: 24, c0: 20, c1: 29, page: PAGE_INDEX });
  links.push({ row: 24, c0: 30, c1: 39, page: albumPage(i), sub: sub === 1 ? 2 : 1 });
  links.push({ row: 22, c0: 0, c1: 39, page: PAGE_INDEX });
  return { rows: p, links };
}

export function decodePage(rows) {
  const cells = [];
  for (let r = 0; r < 25; r += 1) cells.push(decodeRow(rows[r] || row()));
  for (let r = 0; r < 24; r += 1) {
    if (!cells[r].some((c) => c.dh)) continue;
    cells[r + 1] = cells[r].map((c) => (c.dh ? { ...c, half: 2 } : { ...c, code: 0x20, mosaic: false, half: 0 }));
    cells[r] = cells[r].map((c) => (c.dh ? { ...c, half: 1 } : c));
    r += 1;
  }
  return cells;
}

export function decodeRow(bytes) {
  let fg = 7;
  let bg = 0;
  let gfx = false;
  let flash = false;
  let dh = false;
  let sep = false;
  let hold = false;
  let held = 0x20;
  let heldSep = false;
  const out = [];
  for (let i = 0; i < 40; i += 1) {
    const c = bytes[i] ?? 0x20;
    if (c === C.steady) flash = false;
    else if (c === C.normal) {
      if (dh) held = 0x20;
      dh = false;
    } else if (c === C.contiguous) sep = false;
    else if (c === C.separated) sep = true;
    else if (c === C.blackBg) bg = 0;
    else if (c === C.newBg) bg = fg;
    else if (c === C.hold) hold = true;
    let code = c;
    let mosaic = false;
    let cellSep = sep;
    if (c < 0x20) {
      if (hold && gfx) {
        code = held;
        mosaic = true;
        cellSep = heldSep;
      } else code = 0x20;
    } else if (gfx && (c & 0x20)) {
      mosaic = true;
      held = c;
      heldSep = sep;
    }
    out.push({ code, fg, bg, mosaic, sep: cellSep, flash, dh, half: 0 });
    if (c >= 0x01 && c <= 0x07) {
      fg = c;
      if (gfx) held = 0x20;
      gfx = false;
    } else if (c >= 0x11 && c <= 0x17) {
      fg = c - 0x10;
      if (!gfx) held = 0x20;
      gfx = true;
    } else if (c === C.flash) flash = true;
    else if (c === C.double) {
      if (!dh) held = 0x20;
      dh = true;
    } else if (c === C.release) hold = false;
  }
  return out;
}

function err(px, k) {
  const q = PALETTE[k];
  const rm = (px[0] + q[0]) / 2;
  const dr = px[0] - q[0];
  const dg = px[1] - q[1];
  const db = px[2] - q[2];
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

export function mosaicFromImage(img, cols = 16, rowsN = 13) {
  const w = cols * 2;
  const h = rowsN * 3;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.imageSmoothingQuality = "high";
  x.filter = "brightness(1.18) saturate(1.7) contrast(1.1)";
  x.drawImage(img, 0, 0, w, h);
  const data = x.getImageData(0, 0, w, h).data;
  const px = (xx, yy) => {
    const i = (yy * w + xx) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const result = [];
  for (let r = 0; r < rowsN; r += 1) {
    const cellsPx = [];
    for (let cc = 0; cc < cols; cc += 1) {
      const list = [];
      for (let sy = 0; sy < 3; sy += 1) for (let sx = 0; sx < 2; sx += 1) list.push(px(cc * 2 + sx, r * 3 + sy));
      cellsPx.push(list.map((p) => PALETTE.map((_, k) => err(p, k))));
    }
    const S = 64;
    const INF = 1e18;
    let cost = new Float64Array(S).fill(INF);
    for (let f = 1; f < 8; f += 1) cost[f * 8] = 0;
    const back = [];
    for (let cc = 0; cc < cols; cc += 1) {
      const e = cellsPx[cc];
      const next = new Float64Array(S).fill(INF);
      const from = new Int32Array(S).fill(-1);
      const kind = new Int32Array(S).fill(-1);
      const sum = (k) => e[0][k] + e[1][k] + e[2][k] + e[3][k] + e[4][k] + e[5][k];
      const solid = PALETTE.map((_, k) => sum(k));
      for (let s = 0; s < S; s += 1) {
        const base = cost[s];
        if (base >= INF) continue;
        const fg = s >> 3;
        const bg = s & 7;
        if (fg === 0) continue;
        let d = 0;
        for (let k = 0; k < 6; k += 1) d += Math.min(e[k][fg], e[k][bg]);
        if (base + d < next[s]) {
          next[s] = base + d;
          from[s] = s;
          kind[s] = 0;
        }
        for (let f2 = 1; f2 < 8; f2 += 1) {
          if (f2 === fg) continue;
          const t = (f2 << 3) | bg;
          const v = base + solid[bg] * 1.02;
          if (v < next[t]) {
            next[t] = v;
            from[t] = s;
            kind[t] = 1;
          }
        }
        const nb = (fg << 3) | fg;
        if (bg !== fg && base + solid[fg] * 1.02 < next[nb]) {
          next[nb] = base + solid[fg] * 1.02;
          from[nb] = s;
          kind[nb] = 2;
        }
        const kb = fg << 3;
        if (bg !== 0 && base + solid[0] * 1.02 < next[kb]) {
          next[kb] = base + solid[0] * 1.02;
          from[kb] = s;
          kind[kb] = 3;
        }
      }
      back.push({ from, kind });
      cost = next;
    }
    let best = 0;
    for (let s = 1; s < S; s += 1) if (cost[s] < cost[best]) best = s;
    const codes = new Array(cols);
    let s = best;
    for (let cc = cols - 1; cc >= 0; cc -= 1) {
      const { from, kind } = back[cc];
      const k = kind[s];
      const fg = s >> 3;
      const bg = s & 7;
      if (k === 0) {
        const e = cellsPx[cc];
        let bits = 0;
        const order = [1, 2, 4, 8, 16, 64];
        for (let q = 0; q < 6; q += 1) if (e[q][fg] < e[q][bg]) bits |= order[q];
        codes[cc] = 0x20 + bits;
      } else if (k === 1) codes[cc] = 0x10 + fg;
      else if (k === 2) codes[cc] = C.newBg;
      else codes[cc] = C.blackBg;
      s = from[s];
    }
    const startFg = s >> 3;
    result.push([0x10 + (startFg || 7), ...codes]);
  }
  return result;
}
