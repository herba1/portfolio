// The cutting lathe. The record's grooves are cut from a real programme: a
// public-domain recording of Satie's first Gymnopédie (Robin Alciatore, for
// Musopen), split where the piece repeats into two tracks with a band of
// silence between them.
//
// The lathe does what a variable-pitch lathe does. A preview head reads the
// programme a turn ahead, and the feed screw spreads the turns wide where the
// signal is loud (the groove swings far sideways and needs room) and packs
// them tight where it is quiet. Where the signal falls silent for a second or
// more it stops modulating and feeds fast, so the gap between tracks is a
// band of almost flat vinyl with a single thin groove crossing it. After the
// last sound it cuts the run-out: a fast, plain spiral down to the locked
// groove by the label.
//
// It returns two tables for the GPU bake: the spiral's radius and groove
// width at every point of every turn, and the waveform at a quarter of the
// sample rate (its displacement, its slope, and the slope energy above what
// a texel of the field can hold).

export const SR = 22050;
export const TURN = 1.8; // seconds a turn at 33 1/3
export const SPT = 256; // spiral samples per turn
export const WR = SR / 4; // waveform table rate
export const WAVE_W = 2048;

const R_RIM = 0.984; // where the lead-in starts
const R_FIRST = 0.966; // first music groove
const R_LAST = 0.4; // last music groove
const R_LOCK = 0.352; // the locked groove
const LEAD_TURNS = 2;
const BAND_PITCH = 0.0105; // a turn of the band between tracks, in radii
const RUNOUT_PITCH = 0.021;
const THIN = 0.0007; // half width of an unmodulated groove

export async function decodeProgramme(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`programme: ${res.status}`);
  const data = await res.arrayBuffer();
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Ctx(1, 1, SR);
  const buf = await new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject);
    if (p && p.then) p.then(resolve, reject);
  });
  return buf;
}

// A low-pass, run forward and back so it shifts nothing in time: what the
// field can hold of the waveform. What it removes is left for the texels to
// scatter.
function lowpass(x, cut) {
  const w = Math.tan(Math.PI * cut);
  const y = Float32Array.from(x);
  // Two Butterworth sections (Q for a fourth-order response), each run
  // forward then backward.
  for (const q of [0.5412, 1.3066]) {
    const n = 1 / (1 + w / q + w * w);
    const b0 = w * w * n;
    const b1 = 2 * b0;
    const a1 = 2 * (w * w - 1) * n;
    const a2 = (1 - w / q + w * w) * n;
    for (const dir of [1, -1]) {
      let x1 = 0;
      let x2 = 0;
      let y1 = 0;
      let y2 = 0;
      const start = dir > 0 ? 0 : y.length - 1;
      for (let i = start; i >= 0 && i < y.length; i += dir) {
        const v = y[i];
        const o = b0 * v + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = v;
        y2 = y1;
        y1 = o;
        y[i] = o;
      }
    }
  }
  return y;
}

export function cutLacquer(x) {
  const D = x.length / SR;

  // --- the preview head: loudness a turn ahead and a turn behind
  const HOP = 256;
  const nb = Math.ceil(x.length / HOP);
  const rms = new Float32Array(nb);
  for (let b = 0; b < nb; b += 1) {
    let s = 0;
    const e = Math.min(x.length, (b + 1) * HOP);
    for (let i = b * HOP; i < e; i += 1) s += x[i] * x[i];
    rms[b] = Math.sqrt(s / Math.max(1, e - b * HOP));
  }
  const bps = SR / HOP;
  // The preview head: the loudest the signal gets within half a turn
  // either side, which is the swing the neighbouring turns must clear.
  const look = Math.round(bps * TURN * 0.25);
  const peak = new Float32Array(nb);
  for (let b = 0; b < nb; b += 1) {
    let m = 0;
    for (let i = Math.max(0, b - look); i <= Math.min(nb - 1, b + look); i += 1) m = Math.max(m, rms[i]);
    peak[b] = m;
  }
  // The feed screw cannot jump: smooth both ways.
  const feed = Float32Array.from(peak);
  const k = 1 - Math.exp(-1 / (bps * 0.4));
  for (let b = 1; b < nb; b += 1) feed[b] += (feed[b - 1] - feed[b]) * (1 - k);
  for (let b = nb - 2; b >= 0; b -= 1) feed[b] += (feed[b + 1] - feed[b]) * (1 - k);

  // Silence: a second or more under the noise floor is a band, not music.
  const silent = new Uint8Array(nb);
  const floor = Math.pow(10, -60 / 20);
  for (let b = 0; b < nb; ) {
    if (rms[b] >= floor) {
      b += 1;
      continue;
    }
    let e = b;
    while (e < nb && rms[e] < floor) e += 1;
    if ((e - b) / bps > 1.0 || e >= nb) for (let i = b; i < e; i += 1) silent[i] = 1;
    b = e;
  }
  // Loudness in dB, spread over this programme's own range: its quietest
  // passages pack tightest, its loudest spread widest.
  const dB = new Float32Array(nb);
  const live = [];
  for (let b = 0; b < nb; b += 1) {
    dB[b] = 20 * Math.log10(feed[b] + 1e-9);
    if (!silent[b]) live.push(dB[b]);
  }
  live.sort((a, b) => a - b);
  const lo = live[Math.floor(live.length * 0.04)] ?? -60;
  const hi = live[Math.floor(live.length * 0.97)] ?? 0;
  const loud = new Float32Array(nb);
  for (let b = 0; b < nb; b += 1) loud[b] = Math.min(1, Math.max(0, (dB[b] - lo) / Math.max(1, hi - lo)));

  // Pitch per turn, relative, then scaled so the music fills the side.
  const rel = (b) => 1 + 3.4 * Math.pow(loud[b], 1.5);
  let musicTurns = 0;
  let bandWidth = 0;
  for (let b = 0; b < nb; b += 1) {
    if (silent[b]) bandWidth += BAND_PITCH / (bps * TURN);
    else musicTurns += rel(b) / (bps * TURN);
  }
  const scale = (R_FIRST - R_LAST - bandWidth) / musicTurns;

  // --- the spiral, sampled SPT times a turn: lead-in, programme, run-out
  const leadT = LEAD_TURNS * TURN;
  const dtS = TURN / SPT;
  const radius = [];
  const width = [];
  let r = R_RIM;
  let t = -leadT;
  const leadPitch = (R_RIM - R_FIRST) / LEAD_TURNS;
  while (t < 0) {
    radius.push(r);
    width.push(THIN);
    r -= (leadPitch * dtS) / TURN;
    t += dtS;
  }
  r = R_FIRST;
  while (t < D) {
    const b = Math.min(nb - 1, Math.floor(t * bps));
    radius.push(r);
    if (silent[b]) {
      width.push(THIN);
      r -= (BAND_PITCH * dtS) / TURN;
    } else {
      const p = scale * rel(b);
      width.push(Math.max(THIN, p * (0.27 + 0.13 * loud[b])));
      r -= (p * dtS) / TURN;
    }
    t += dtS;
  }
  const tEnd = t;
  while (r > R_LOCK + 0.003) {
    radius.push(r);
    width.push(THIN);
    r -= (RUNOUT_PITCH * dtS) / TURN;
    t += dtS;
  }
  // Ease into the locked groove, then one closed turn.
  const ease = (r - R_LOCK) / SPT;
  for (let i = 0; i < SPT; i += 1) {
    radius.push(r);
    width.push(THIN);
    r -= ease;
  }
  while (radius.length % SPT) {
    radius.push(R_LOCK);
    width.push(THIN);
  }
  for (let i = 0; i < SPT; i += 1) {
    radius.push(R_LOCK - 1e-6 * i);
    width.push(THIN);
  }
  const turns = radius.length / SPT;
  const spiral = new Float32Array(radius.length * 2);
  for (let i = 0; i < radius.length; i += 1) {
    spiral[i * 2] = radius[i];
    spiral[i * 2 + 1] = width[i];
  }

  // --- the waveform, at a quarter rate: displacement and slope of what a
  // texel resolves, and the slope energy of everything finer.
  const lp = lowpass(x, 2200 / SR);
  let lpPeak = 1e-6;
  for (let i = 0; i < lp.length; i += 1) lpPeak = Math.max(lpPeak, Math.abs(lp[i]));
  const nw = Math.ceil(x.length / 4);
  const waveH = Math.ceil(nw / WAVE_W);
  const wave = new Float32Array(WAVE_W * waveH * 4);
  for (let w = 0; w < nw; w += 1) {
    const n = w * 4;
    const a = lp[Math.max(0, n - 1)];
    const c = lp[Math.min(lp.length - 1, n + 1)];
    let hf = 0;
    for (let i = n; i < Math.min(x.length - 1, n + 4); i += 1) {
      const d = x[i + 1] - lp[i + 1] - (x[i] - lp[i]);
      hf += d * d;
    }
    const b = Math.min(nb - 1, Math.floor(n / HOP));
    wave[w * 4] = lp[n] / lpPeak;
    wave[w * 4 + 1] = ((c - a) * SR * 0.5) / lpPeak;
    wave[w * 4 + 2] = (Math.sqrt(hf / 4) * SR) / lpPeak;
    wave[w * 4 + 3] = silent[b] ? 0 : 1;
  }

  // Radius of the groove at programme time t, and the time at a radius.
  const radiusAt = (time) => {
    const f = ((time + leadT) / TURN) * SPT;
    const i = Math.max(0, Math.min(radius.length - 2, Math.floor(f)));
    const u = Math.max(0, Math.min(1, f - i));
    return radius[i] + (radius[i + 1] - radius[i]) * u;
  };
  const timeAt = (rr) => {
    let lo = 0;
    let hi = radius.length - 1;
    if (rr >= radius[0]) return -leadT;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (radius[mid] > rr) lo = mid;
      else hi = mid;
    }
    return (lo / SPT) * TURN - leadT;
  };

  return { spiral, turns, wave, waveH, nw, leadT, D, tEnd, radiusAt, timeAt, silent, bps };
}
