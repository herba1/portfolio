export const RATE = 20;
export const PITCH = 3;
export const BAR = 2;
export const RULER = 12;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createVoice(seed) {
  const rand = mulberry32(seed);
  const dt = 1 / RATE;
  let gap = 0.15;
  let phrase = 0;
  let note = 0;
  let noteDur = 1;
  let noteAmp = 0;
  let phraseAmp = 1;
  return () => {
    if (gap > 0) {
      gap -= dt;
      if (gap <= 0) {
        phrase = 1.2 + rand() * 2.8;
        phraseAmp = 0.7 + rand() * 0.3;
      }
      return 0.03 + rand() * 0.04;
    }
    if (note <= 0) {
      noteDur = 0.15 + rand() * 0.45;
      note = noteDur;
      noteAmp = 0.22 + rand() * (rand() < 0.2 ? 0.78 : 0.5);
    }
    const p = 1 - note / noteDur;
    const env = Math.sin(Math.PI * Math.min(1, 0.08 + p * 1.05)) ** 0.5;
    note -= dt;
    phrase -= dt;
    if (phrase <= 0) {
      gap = 0.2 + rand() * 0.9;
      note = 0;
    }
    return Math.min(1, 0.05 + phraseAmp * noteAmp * env * (0.78 + rand() * 0.3));
  };
}

export function prerecord(seed, seconds) {
  const next = createVoice(seed);
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i += 1) out[i] = next();
  return out;
}

export function bucketFor(span, w) {
  return Math.max(1 / RATE, (PITCH * span) / Math.max(1, w));
}

export function buildBars(samples, count, v0, v1, w, h, bucket) {
  const path = new Path2D();
  const span = v1 - v0;
  if (span <= 0 || count === 0) return path;
  const pxPerSec = w / span;
  const mid = RULER + (h - RULER) / 2;
  const maxH = (h - RULER) * 0.8;
  const bar = (t, amp) => {
    const x = (t - v0) * pxPerSec;
    if (x < -BAR || x > w + BAR) return;
    const bh = Math.max(BAR, amp * maxH);
    path.roundRect(x - BAR / 2, mid - bh / 2, BAR, bh, 1);
  };
  if (bucket <= 1 / RATE + 1e-9) {
    const i0 = Math.max(0, Math.floor(v0 * RATE) - 1);
    const i1 = Math.min(count - 1, Math.ceil(v1 * RATE) + 1);
    for (let i = i0; i <= i1; i += 1) bar((i + 0.5) / RATE, samples[i]);
    return path;
  }
  const end = count / RATE;
  const k0 = Math.max(0, Math.floor(v0 / bucket) - 1);
  const k1 = Math.min(Math.ceil(end / bucket), Math.ceil(v1 / bucket) + 1);
  for (let k = k0; k <= k1; k += 1) {
    const s0 = Math.floor(k * bucket * RATE);
    if (s0 >= count) break;
    const s1 = Math.min(count, Math.max(s0 + 1, Math.floor((k + 1) * bucket * RATE)));
    let amp = 0;
    for (let i = s0; i < s1; i += 1) if (samples[i] > amp) amp = samples[i];
    bar((k + 0.5) * bucket, amp);
  }
  return path;
}

export function buildRuler(v0, v1, w, limit) {
  const path = new Path2D();
  const span = v1 - v0;
  if (span <= 0) return path;
  const pxPerSec = w / span;
  const step = pxPerSec >= 28 ? 1 : pxPerSec >= 10 ? 5 : 10;
  const from = Math.max(0, Math.ceil(v0 / step)) * step;
  const to = Math.min(limit, v1);
  for (let t = from; t <= to + 1e-6; t += step) {
    const x = Math.round((t - v0) * pxPerSec);
    const major = Math.round(t) % (step * 5) === 0;
    path.rect(x, 0, 1, major ? 8 : 4);
  }
  return path;
}

const pad = (n) => String(n).padStart(2, "0");

export function clock(t) {
  const cs = Math.max(0, Math.floor(t * 100 + 1e-6));
  const s = Math.floor(cs / 100);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}.${pad(cs % 100)}`;
}

export function short(t) {
  const s = Math.max(0, Math.round(t));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}
