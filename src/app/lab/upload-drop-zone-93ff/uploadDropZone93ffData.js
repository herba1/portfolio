export const TICK_MS = 100;
export const CONCURRENCY = 2;
export const MAX_FILES = 8;
export const MOSAIC = 8;
export const CELLS = MOSAIC * MOSAIC;

const INK = "#181a1d";
const SUNKEN = "#e8ecf2";
const PAPER = "#fbfcfe";
const RULE = "#c2ccd9";

const SUNSET = {
  angle: 148,
  stops: [["#f7dfc4", 0], ["#eec295", 17], ["#dd9670", 36], ["#b96a62", 57], ["#7c4a67", 79], ["#3b3352", 100]],
};
const HARBOUR = {
  angle: 158,
  stops: [["#dfe9f0", 0], ["#b8cfe0", 16], ["#86adca", 35], ["#5c86ac", 56], ["#3c5a83", 78], ["#23324f", 100]],
};
const STAGE = {
  angle: 142,
  stops: [["#2a2340", 0], ["#46305a", 18], ["#7a3f63", 38], ["#b4595c", 60], ["#dc8a5f", 80], ["#f2c184", 100]],
};
const FIELD = {
  angle: 152,
  stops: [["#eef1e2", 0], ["#cfd9b4", 18], ["#a4b982", 38], ["#74965f", 58], ["#4a6a4a", 79], ["#27392f", 100]],
};
const NEON = {
  angle: 136,
  stops: [["#1d2237", 0], ["#2f3f66", 19], ["#4a6aa1", 39], ["#7f9ac4", 59], ["#c2b7d4", 80], ["#efd9dd", 100]],
};

export const SEED_FILES = [
  { name: "sleeve-front-2400.png", bytes: 4_412_000, kind: "image", duration: 3.4, preview: SUNSET, at: 1, lane: 0 },
  { name: "studio-loop-1080.mp4", bytes: 122_339_000, kind: "video", duration: 7.6, preview: STAGE, failAt: 0.61, at: 0.44, lane: 1 },
  { name: "mixdown-take-14.wav", bytes: 38_642_000, kind: "audio", duration: 6.2, at: 0.23, lane: 0 },
  { name: "press-notes-final.pdf", bytes: 812_000, kind: "doc", duration: 2.4 },
  { name: "contact-sheet-03.jpg", bytes: 6_118_000, kind: "image", duration: 4.1, preview: HARBOUR },
];

export const POOL = [
  { name: "sleeve-back-2400.png", bytes: 3_904_000, kind: "image", duration: 3.2, preview: FIELD },
  { name: "b-side-rough.wav", bytes: 21_447_000, kind: "audio", duration: 5.1 },
  { name: "rehearsal-cam.mp4", bytes: 64_820_000, kind: "video", duration: 6.8, preview: NEON },
  { name: "tour-dates-2027.pdf", bytes: 438_000, kind: "doc", duration: 2.1 },
  { name: "band-portrait-05.jpg", bytes: 8_712_000, kind: "image", duration: 4.4, preview: SUNSET },
];

export const megabytes = (bytes) => (bytes / 1_000_000).toFixed(1);

export const seconds = (file) => 1 / file.speed;

export const gradientCss = ({ angle, stops }) =>
  `linear-gradient(${angle}deg, ${stops.map(([color, at]) => `${color} ${at}%`).join(", ")})`;

export const kindOf = (name) => {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (["png", "jpg", "jpeg", "webp", "gif", "tif", "avif"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "avi"].includes(ext)) return "video";
  if (["wav", "mp3", "aiff", "flac", "m4a"].includes(ext)) return "audio";
  return "doc";
};

const fingerprint = (text) => {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0) / 4294967295;
};

const waveformFor = (name) => {
  const seed = fingerprint(name) * 60;
  return Array.from({ length: 11 }, (_, index) => {
    const grain = Math.sin(seed + index * 1.73) * Math.sin(seed * 0.41 + index * 0.62);
    const envelope = Math.sin(((index + 0.5) / 11) * Math.PI) ** 0.55;
    return Math.round(5 + 27 * envelope * (0.42 + 0.58 * (0.5 + 0.5 * grain)));
  });
};

const rulesFor = (name) => {
  const seed = fingerprint(name) * 40;
  return Array.from({ length: 4 }, (_, index) =>
    46 + Math.round(52 * (0.5 + 0.5 * Math.sin(seed + index * 2.31))),
  );
};

const rgbOf = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const clamp01 = (value) => Math.min(1, Math.max(0, value));

const sampleGradient = ({ stops }, position) => {
  const t = clamp01(position) * 100;
  let lower = stops[0];
  let upper = stops[stops.length - 1];
  for (let index = 0; index < stops.length - 1; index += 1) {
    if (t >= stops[index][1] && t <= stops[index + 1][1]) {
      lower = stops[index];
      upper = stops[index + 1];
      break;
    }
  }
  const span = upper[1] - lower[1] || 1;
  return mix(rgbOf(lower[0]), rgbOf(upper[0]), clamp01((t - lower[1]) / span));
};

const gradientCell = (def, col, row) => {
  const radians = (def.angle * Math.PI) / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  const length = Math.abs(sin) + Math.abs(cos);
  const x = (col + 0.5) / MOSAIC - 0.5;
  const y = (row + 0.5) / MOSAIC - 0.5;
  return sampleGradient(def, 0.5 + (x * sin - y * cos) / length);
};

const waveCell = (waveform, col, row) => {
  const bar = waveform[Math.min(waveform.length - 1, Math.floor(((col + 0.5) / MOSAIC) * waveform.length))];
  const half = bar / 44 / 2;
  const distance = Math.abs((row + 0.5) / MOSAIC - 0.5);
  const edge = clamp01((half + 1 / MOSAIC - distance) * MOSAIC);
  return mix(rgbOf(SUNKEN), rgbOf(INK), edge);
};

const docCell = (rules, col, row) => {
  const line = (row - 1) / 2;
  if (row < 1 || row > 7 || line !== Math.round(line)) return rgbOf(PAPER);
  const reach = rules[Math.min(rules.length - 1, line)];
  if (col < 1 || ((col - 1) / (MOSAIC - 2)) * 100 >= reach) return rgbOf(PAPER);
  return rgbOf(RULE);
};

const cellsFor = (kind, def, waveform, rules) => {
  const out = [];
  for (let row = 0; row < MOSAIC; row += 1) {
    for (let col = 0; col < MOSAIC; col += 1) {
      if (kind === "audio") out.push(waveCell(waveform, col, row));
      else if (kind === "doc") out.push(docCell(rules, col, row));
      else out.push(gradientCell(def, col, row));
    }
  }
  return out;
};

const quantize = (cells, block) => {
  const out = new Array(cells.length);
  for (let row = 0; row < MOSAIC; row += block) {
    for (let col = 0; col < MOSAIC; col += block) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < block; dy += 1) {
        for (let dx = 0; dx < block; dx += 1) {
          const cell = cells[(row + dy) * MOSAIC + col + dx];
          r += cell[0];
          g += cell[1];
          b += cell[2];
        }
      }
      const count = block * block;
      const flat = `rgb(${Math.round(r / count)} ${Math.round(g / count)} ${Math.round(b / count)})`;
      for (let dy = 0; dy < block; dy += 1) {
        for (let dx = 0; dx < block; dx += 1) out[(row + dy) * MOSAIC + col + dx] = flat;
      }
    }
  }
  return out;
};

const dissolveFor = (name) => {
  const seed = fingerprint(name) * 100;
  const keys = Array.from({ length: CELLS }, (_, index) => ({
    index,
    weight: Math.sin(seed + index * 12.9898) * Math.cos(seed * 0.7 + index * 4.1),
  }));
  keys.sort((a, b) => a.weight - b.weight);
  const thresholds = new Array(CELLS);
  keys.forEach((entry, rank) => {
    thresholds[entry.index] = 0.5 + 0.42 * (rank / (CELLS - 1));
  });
  return thresholds;
};

export const mosaicLevel = (progress) => (progress < 0.2 ? 0 : progress < 0.4 ? 1 : 2);

export const makeFile = (spec, id, enterDelay) => {
  const at = Math.min(1, spec.at ?? 0);
  const def = spec.preview ?? HARBOUR;
  const waveform = waveformFor(spec.name);
  const rules = rulesFor(spec.name);
  const cells = cellsFor(spec.kind, def, waveform, rules);
  return {
    id,
    name: spec.name,
    bytes: spec.bytes,
    kind: spec.kind,
    preview: gradientCss(def),
    waveform,
    rules,
    mosaic: [quantize(cells, 4), quantize(cells, 2), quantize(cells, 1)],
    dissolve: dissolveFor(spec.name),
    speed: 1 / spec.duration,
    failAt: spec.failAt ?? null,
    attempt: 0,
    status: at >= 1 ? "done" : at > 0 ? "uploading" : "queued",
    progress: at,
    ticks: id * 7,
    wait: 0,
    lane: spec.lane ?? null,
    enterDelay,
  };
};

export const planLanes = (files) => {
  const lanes = Array.from({ length: CONCURRENCY }, () => []);
  const load = new Array(CONCURRENCY).fill(0);

  for (const file of files) {
    if (file.lane == null || file.status === "queued" || file.status === "retrying") continue;
    const lane = Math.min(CONCURRENCY - 1, file.lane);
    lanes[lane].push({ file, planned: false });
    if (file.status === "uploading") load[lane] += (1 - file.progress) * seconds(file);
  }

  for (const file of files) {
    if (file.status !== "queued" && file.status !== "retrying") continue;
    let lane = 0;
    for (let index = 1; index < CONCURRENCY; index += 1) if (load[index] < load[lane]) lane = index;
    lanes[lane].push({ file, planned: true });
    load[lane] += seconds(file);
  }

  const totals = lanes.map((lane) => lane.reduce((sum, item) => sum + seconds(item.file), 0));
  const scale = Math.max(1, ...totals);
  return lanes.map((lane) =>
    lane.map((item) => ({ ...item, share: (seconds(item.file) / scale) * 100 })),
  );
};

const dt = TICK_MS / 1000;

export function advance(files) {
  const taken = new Set();
  for (const file of files) if (file.status === "uploading") taken.add(file.lane);
  let active = taken.size;
  let moved = false;

  const claim = (preferred) => {
    if (preferred != null && !taken.has(preferred)) {
      taken.add(preferred);
      return preferred;
    }
    for (let index = 0; index < CONCURRENCY; index += 1) {
      if (!taken.has(index)) {
        taken.add(index);
        return index;
      }
    }
    return 0;
  };

  const next = files.map((file) => {
    if (file.status === "retrying") {
      moved = true;
      const wait = file.wait - 1;
      return wait <= 0 ? { ...file, status: "queued", wait: 0 } : { ...file, wait };
    }
    if (file.status === "queued" && active < CONCURRENCY) {
      active += 1;
      moved = true;
      return { ...file, status: "uploading", lane: claim(file.lane) };
    }
    if (file.status !== "uploading") return file;

    moved = true;
    const ticks = file.ticks + 1;
    const wobble = 0.78 + 0.44 * (0.5 + 0.5 * Math.sin(ticks * 0.63 + file.id));
    const progress = file.progress + file.speed * dt * wobble;

    if (file.failAt != null && file.attempt === 0 && progress >= file.failAt) {
      return { ...file, status: "error", progress: file.failAt, ticks };
    }
    if (progress >= 1) return { ...file, status: "done", progress: 1, ticks };
    return { ...file, progress, ticks };
  });

  return moved ? next : files;
}
