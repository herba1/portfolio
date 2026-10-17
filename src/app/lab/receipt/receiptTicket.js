export const DOTS = 5;
export const PAPER_W = 80;
export const TEX_W = PAPER_W * DOTS;
export const COLS = 24;

const MARGIN_X = 4 * DOTS;
const CELL = (72 * DOTS) / COLS;
const EM = CELL / 0.6;
const LINE = 6 * DOTS;

export const VENUE = { name: "Lowtide Room", street: "41 Harbour Street", date: "Sat 17 Oct 2026" };

export const SETS = [
  {
    label: "Set 1 of 5",
    artist: "Mara Velde",
    tracks: [
      ["Salt Lamp", "21:00", 112],
      ["Glasshouse", "21:07", 114],
      ["Low Orbit", "21:13", 116],
      ["Night Bus", "21:20", 118],
      ["Paper Moons", "21:26", 118],
      ["Tidewater", "21:33", 120],
      ["Open Hands", "21:40", 121],
      ["Soft Static", "21:47", 122],
    ],
  },
  {
    label: "Set 2 of 5",
    artist: "Oskar Lind",
    tracks: [
      ["Copper Hymn", "22:10", 122],
      ["Fog Lights", "22:17", 123],
      ["Halfway", "22:23", 124],
      ["Kite Season", "22:30", 124],
      ["Blue Hour", "22:36", 125],
      ["Slow Signal", "22:43", 126],
      ["Arcade Rain", "22:49", 126],
      ["Late Ferry", "22:56", 127],
    ],
  },
  {
    label: "Set 3 of 5",
    artist: "Juno Abara",
    tracks: [
      ["Heat Map", "23:30", 128],
      ["Marigold", "23:36", 128],
      ["Sodium", "23:42", 129],
      ["Undertow", "23:48", 130],
      ["Glass Bead", "23:55", 130],
      ["Afterimage", "00:01", 131],
      ["Pilot Light", "00:08", 132],
      ["Riverbed", "00:14", 132],
    ],
  },
  {
    label: "Set 4 of 5",
    artist: "Teo b2b Ines",
    tracks: [
      ["Night Swim", "00:50", 126],
      ["Overpass", "00:57", 125],
      ["Hum", "01:03", 124],
      ["Pale Fire", "01:10", 124],
      ["Ferris", "01:16", 122],
      ["Quiet Car", "01:23", 121],
      ["Sea Glass", "01:29", 120],
      ["Last Tram", "01:36", 118],
    ],
  },
  {
    label: "Closing",
    artist: "Mara Velde",
    tracks: [
      ["Velvet Hours", "02:10", 112],
      ["Dawn Chorus", "02:18", 108],
      ["Long Shadow", "02:26", 104],
      ["Warm Tape", "02:33", 100],
      ["Morning Bus", "02:41", 96],
      ["Home Now", "02:49", 92],
    ],
  },
];

function pad(text, width, right) {
  const s = String(text);
  if (s.length >= width) return s.slice(0, width);
  return right ? " ".repeat(width - s.length) + s : s + " ".repeat(width - s.length);
}

function runtime(tracks) {
  const toMin = (t) => {
    const [h, m] = t.split(":").map(Number);
    return (h < 12 ? h + 24 : h) * 60 + m;
  };
  const first = toMin(tracks[0][1]);
  const last = toMin(tracks[tracks.length - 1][1]) + 7;
  const span = last - first;
  return `${Math.floor(span / 60)}:${String(span % 60).padStart(2, "0")}:00`;
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function ticketLines(index) {
  const set = SETS[index % SETS.length];
  const no = String(41 + index).padStart(4, "0");
  const lines = [];
  const push = (kind, text, extra) => lines.push({ kind, text, ...extra });
  push("gap", "", { h: 7 });
  push("big", VENUE.name);
  push("gap", "", { h: 2 });
  push("center", VENUE.street);
  push("row", pad(VENUE.date, 17) + pad(set.tracks[0][1], 7, true));
  push("rule", "-".repeat(COLS));
  push("bold", pad("Tonight", 12) + pad(set.label, 12, true));
  push("text", set.artist);
  push("rule", "-".repeat(COLS));
  push("row", pad("#", 3) + pad("Track", 12) + pad("Start", 5) + pad("BPM", 4, true));
  set.tracks.forEach(([title, start, bpm], i) => {
    push("row", pad(String(i + 1).padStart(2, "0"), 3) + pad(title, 12) + pad(start, 5) + pad(bpm, 4, true));
  });
  push("rule", "-".repeat(COLS));
  const avg = Math.round(set.tracks.reduce((s, t) => s + t[2], 0) / set.tracks.length);
  push("row", pad("Tracks", 16) + pad(set.tracks.length, 8, true));
  push("row", pad("Runtime", 16) + pad(runtime(set.tracks), 8, true));
  push("bold", pad("Avg tempo", 16) + pad(`${avg} BPM`, 8, true));
  push("rule", "=".repeat(COLS));
  push("gap", "", { h: 2 });
  push("barcode", no, { seed: 7919 * (index + 3) });
  push("center", `No. ${no}  Keep it`);
  push("gap", "", { h: 1 });
  push("center", "Thank you, dance kindly");
  push("gap", "", { h: 12 });
  return lines;
}

function lineHeight(line) {
  if (line.kind === "gap") return line.h * DOTS;
  if (line.kind === "big") return LINE * 2;
  if (line.kind === "barcode") return 15 * DOTS;
  return LINE;
}

export function ticketLength(index) {
  return ticketLines(index).reduce((s, l) => s + lineHeight(l), 0) / DOTS;
}

export function lineStops(index) {
  const stops = [];
  let y = 0;
  for (const line of ticketLines(index)) {
    y += lineHeight(line);
    stops.push(y / DOTS);
  }
  return stops;
}

export function rasterTicket(index, mono) {
  const lines = ticketLines(index);
  const height = Math.ceil(lines.reduce((s, l) => s + lineHeight(l), 0));
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, TEX_W, height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "alphabetic";
  const cellText = (text, top, weight, scale) => {
    ctx.save();
    ctx.translate(MARGIN_X, top);
    ctx.scale(scale, scale);
    ctx.font = `${weight} ${EM.toFixed(2)}px ${mono}`;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === " ") continue;
      ctx.fillText(ch, i * CELL + (CELL - ctx.measureText(ch).width) / 2, EM * 0.98);
    }
    ctx.restore();
  };
  let y = 0;
  for (const line of lines) {
    const h = lineHeight(line);
    if (line.kind === "big") {
      const lead = Math.max(0, Math.floor((COLS / 2 - line.text.length) / 2));
      cellText(" ".repeat(lead) + line.text, y + 2, 640, 2);
    } else if (line.kind === "center") {
      const lead = Math.floor((COLS - line.text.length) / 2);
      cellText(" ".repeat(Math.max(0, lead)) + line.text, y + 2, 520, 1);
    } else if (line.kind === "row" || line.kind === "text") {
      cellText(line.text, y + 2, 520, 1);
    } else if (line.kind === "bold") {
      cellText(line.text, y + 2, 680, 1);
    } else if (line.kind === "rule") {
      const double = line.text[0] === "=";
      for (let i = 0; i < COLS; i += 1) {
        const x0 = Math.round(MARGIN_X + i * CELL + CELL * 0.18);
        const w = Math.round(CELL * 0.64);
        const mid = Math.round(y + LINE / 2);
        if (double) {
          ctx.fillRect(x0, mid - 4, w, 2);
          ctx.fillRect(x0, mid + 1, w, 2);
        } else ctx.fillRect(x0, mid - 1, w, 3);
      }
    } else if (line.kind === "barcode") {
      const r = rng(line.seed);
      let x = MARGIN_X + 40;
      const end = TEX_W - MARGIN_X - 40;
      let bar = true;
      while (x < end) {
        const w = 2 + Math.floor(r() * 4) * 2;
        if (bar) ctx.fillRect(x, y + 6, Math.min(w, end - x), h - 18);
        x += w;
        bar = !bar;
      }
    }
    y += h;
  }
  const img = ctx.getImageData(0, 0, TEX_W, height).data;
  const out = new Uint8Array(TEX_W * height);
  for (let i = 0; i < out.length; i += 1) out[i] = img[i * 4] < 120 ? 255 : 0;
  return { data: out, rows: height };
}
