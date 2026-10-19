export const FONT_FAMILY = "LyricEditArimo";

export const LYRIC = [
  "we can stay out till the streetlights go soft",
  "you don't have to be anyone tonight",
  "i keep your voice on the walk home",
].map((line) => line.split(" "));

export const BEAT = 0.5;
export const LOOP = 20;

const DEMO_BEATS = [
  [0, 0.5, 1, 2, 3, 3.5, 4, 5, 6],
  12,
  [13, 14, 15, 15.5, 16, 17, 18],
  25,
  [26, 26.5, 27, 28, 29, 29.5, 30, 31],
  39,
];

export function buildEvents() {
  const events = [];
  LYRIC.forEach((words, phrase) => {
    words.forEach((text, index) => events.push({ kind: "word", phrase, index, text }));
    events.push({ kind: "clear", phrase });
  });
  return events;
}

export function demoTake() {
  const times = [];
  for (const entry of DEMO_BEATS) {
    if (Array.isArray(entry)) for (const b of entry) times.push(b * BEAT);
    else times.push(entry * BEAT);
  }
  return { start: 0, times, demo: true };
}

export function textMetrics(w, h) {
  const size = Math.max(24, Math.min(54, h * 0.058, w * 0.092));
  return { size, lead: size * 1.06, measure: size * 5.3 };
}

export function layoutPhrase(ctx, words, w, h, dpr) {
  const m = textMetrics(w, h);
  const size = m.size * dpr;
  ctx.font = `400 ${size}px ${FONT_FAMILY}, Arimo, Arial, sans-serif`;
  const space = ctx.measureText(" ").width;
  const widths = words.map((word) => ctx.measureText(word).width);
  const measure = Math.max(m.measure * dpr, ...widths);
  const lines = [];
  let current = [];
  let used = 0;
  words.forEach((word, i) => {
    const add = current.length ? space * 1.2 + widths[i] : widths[i];
    if (current.length && used + add > measure) {
      lines.push(current);
      current = [];
      used = 0;
    }
    current.push(i);
    used += current.length > 1 ? space * 1.2 + widths[i] : widths[i];
  });
  if (current.length) lines.push(current);
  const lead = m.lead * dpr;
  const blockH = lines.length * lead;
  const x0 = (w * dpr - measure) / 2;
  const centreY = h * dpr * 0.45;
  const y0 = centreY - blockH / 2;
  const slots = new Array(words.length);
  lines.forEach((line, li) => {
    const total = line.reduce((s, i) => s + widths[i], 0);
    const gap = line.length > 1 ? (measure - total) / (line.length - 1) : 0;
    let x = x0;
    for (const i of line) {
      slots[i] = { x, y: y0 + li * lead + size * 0.86, w: widths[i] };
      x += widths[i] + gap;
    }
  });
  return { slots, size, font: ctx.font };
}
