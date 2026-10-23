// Tempo, beats and the sixteenth grid everything else snaps to. The beat
// tracker is Ellis's dynamic-programming tracker (2007), the same one librosa
// ships: pick the period from the onset envelope's autocorrelation, then find
// the beat sequence that lands on strong onsets while keeping that period.

import { bandFlux, detrend, percentile } from "./dsp";

export const BANDS = {
  all: [40, 8000],
  low: [35, 140],
  body: [140, 600],
  snare: [1500, 5000],
  hat: [6500, 11000],
};

export function onsetFeatures(mono, rate, hop) {
  const keys = Object.keys(BANDS);
  const flux = bandFlux(mono, rate, hop, keys.map((k) => BANDS[k]));
  const fps = rate / hop;
  const out = { fps, n: flux[0].length };
  keys.forEach((k, i) => {
    out[k] = detrend(flux[i], Math.round(fps * 0.4));
  });
  return out;
}

function smooth(x, sigma) {
  const r = Math.ceil(sigma * 3);
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i += 1) {
    let s = 0;
    for (let j = -r; j <= r; j += 1) {
      const t = i + j;
      if (t >= 0 && t < x.length) s += x[t] * k[j + r];
    }
    out[i] = s;
  }
  return out;
}

// Period in frames. Autocorrelation weighted by a log-normal prior around
// 120 BPM so a song is read at the tempo people tap, not double or half.
export function estimatePeriod(env, fps, { minBpm = 55, maxBpm = 210, centerBpm = 118 } = {}) {
  const n = env.length;
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += env[i];
  mean /= n || 1;
  const lo = Math.floor((60 * fps) / maxBpm);
  const hi = Math.min(n - 1, Math.ceil((60 * fps) / minBpm));
  const ac = new Float32Array(hi + 2);
  for (let lag = lo; lag <= hi + 1; lag += 1) {
    let s = 0;
    for (let i = lag; i < n; i += 1) s += (env[i] - mean) * (env[i - lag] - mean);
    ac[lag] = s / (n - lag);
  }
  let best = lo;
  let bestScore = -Infinity;
  for (let lag = lo + 1; lag <= hi; lag += 1) {
    if (ac[lag] < ac[lag - 1] || ac[lag] < ac[lag + 1]) continue;
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * Math.log2(bpm / centerBpm) ** 2 / 0.9 ** 2);
    // A real beat also lines up at twice its period.
    const echo = 2 * lag <= hi + 1 ? Math.max(0, ac[2 * lag]) : 0;
    const score = (Math.max(0, ac[lag]) + 0.5 * echo) * prior;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  const a = ac[best - 1];
  const b = ac[best];
  const c = ac[best + 1];
  const den = a - 2 * b + c;
  return den < 0 ? best + (0.5 * (a - c)) / den : best;
}

function autocorr(env, lag) {
  const L = Math.round(lag);
  let mean = 0;
  for (let i = 0; i < env.length; i += 1) mean += env[i];
  mean /= env.length || 1;
  let s = 0;
  let z = 0;
  for (let i = 0; i < env.length; i += 1) {
    z += (env[i] - mean) ** 2;
    if (i >= L) s += (env[i] - mean) * (env[i - L] - mean);
  }
  return z > 0 ? s / z : 0;
}

// Fast tempos are often eighth notes read as beats. A backbeat snare repeats
// every two beats, so if the snare only repeats every four "beats" the beat
// was really twice as long.
// Only past 160 BPM: below that a busy groove (sixteenth hats, syncopated
// kicks) also repeats most strongly over the bar and would be halved wrongly.
export function refinePeriod(period, feat) {
  const bpm = (60 * feat.fps) / period;
  if (bpm < 160) return period;
  const back = feat.snare.map((v, i) => v + feat.body[i]);
  const two = autocorr(back, 2 * period);
  const four = autocorr(back, 4 * period);
  return four > 0.15 && four > two * 1.1 ? period * 2 : period;
}

export function trackBeats(env, period, tightness = 100) {
  const n = env.length;
  let sd = 0;
  for (let i = 0; i < n; i += 1) sd += env[i] * env[i];
  sd = Math.sqrt(sd / (n || 1)) || 1;
  const local = smooth(
    env.map((v) => v / sd),
    period / 32 + 0.5,
  );
  const score = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  // librosa's rule: until the onset strength first passes 1% of its peak, a
  // frame starts a fresh chain instead of hanging off the silence before it.
  let peak = 0;
  for (let i = 0; i < n; i += 1) peak = Math.max(peak, local[i]);
  let started = false;
  for (let i = 0; i < n; i += 1) {
    let best = 0;
    let arg = -1;
    if (!started && local[i] <= 0.01 * peak) {
      score[i] = local[i];
      continue;
    }
    started = true;
    for (let prev = Math.max(0, Math.round(i - 2 * period)); prev <= i - Math.round(period / 2); prev += 1) {
      const v = score[prev] - tightness * Math.log((i - prev) / period) ** 2;
      if (arg < 0 || v > best) {
        best = v;
        arg = prev;
      }
    }
    score[i] = local[i] + (arg >= 0 ? best : 0);
    back[i] = arg;
  }
  // End on the strongest beat of the final period, then walk back.
  let end = Math.max(0, n - Math.round(period));
  for (let i = end; i < n; i += 1) if (score[i] > score[end]) end = i;
  const beats = [];
  for (let i = end; i >= 0; i = back[i]) {
    beats.push(i);
    if (back[i] < 0) break;
  }
  return beats.reverse();
}

// Beat frames to times, extended at both ends to cover [0, duration].
export function beatTimes(frames, fps, duration, period) {
  const sec = period / fps;
  const times = frames.map((f) => f / fps);
  // The tracker can pin a stray first or last beat to the edge of the audio;
  // drop edge beats that break the period before extending the grid.
  const off = (a, b) => Math.abs(b - a - sec) > sec * 0.25;
  while (times.length > 2 && off(times[0], times[1])) times.shift();
  while (times.length > 2 && off(times[times.length - 2], times[times.length - 1])) times.pop();
  if (!times.length) times.push(0);
  while (times[0] - sec > -sec * 0.5) times.unshift(times[0] - sec);
  while (times[times.length - 1] < duration) times.push(times[times.length - 1] + sec);
  return times;
}

export function sixteenths(beats) {
  const grid = [];
  for (let i = 0; i < beats.length - 1; i += 1) {
    const a = beats[i];
    const step = (beats[i + 1] - a) / 4;
    for (let k = 0; k < 4; k += 1) grid.push(a + k * step);
  }
  grid.push(beats[beats.length - 1]);
  return grid;
}

// Nearest grid index to a time (grid is ascending).
export function snap(grid, t) {
  let lo = 0;
  let hi = grid.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (grid[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && t - grid[lo - 1] < grid[lo] - t) return lo - 1;
  return lo;
}

// Strongest value of a band inside each grid slot's window.
function slotPeaks(env, fps, grid) {
  const out = new Float32Array(grid.length);
  for (let s = 0; s < grid.length; s += 1) {
    const half = ((s + 1 < grid.length ? grid[s + 1] : grid[s] + (grid[s] - grid[s - 1])) - grid[s]) / 2;
    const a = Math.max(0, Math.floor((grid[s] - half) * fps));
    const b = Math.min(env.length - 1, Math.ceil((grid[s] + half) * fps));
    let m = 0;
    for (let i = a; i <= b; i += 1) m = Math.max(m, env[i]);
    out[s] = m;
  }
  return out;
}

// Kick, snare and hat hits per sixteenth. Band flux alone is a weak witness
// (a bass note spikes the kick band, a strummed chord the snare band), so each
// slot is scored, the scores are averaged over every bar into one 16-step
// pattern, and the pattern decides. A bar keeps a pattern hit only if it shows
// some of that evidence itself, and a much stronger than usual snare-band hit
// off the pattern comes through as a fill.
// `lowOnsets` marks slots where the transcribed bass starts a note; that note
// explains most of the low-band spike there.
export function detectDrums(feat, grid, { lowOnsets, downbeat = 0 } = {}) {
  const norm = (x) => {
    const ref = percentile(x, 0.92) || 1;
    return x.map((v) => v / ref);
  };
  const L = norm(slotPeaks(feat.low, feat.fps, grid));
  const B = norm(slotPeaks(feat.body, feat.fps, grid));
  const S = norm(slotPeaks(feat.snare, feat.fps, grid));
  const H = norm(slotPeaks(feat.hat, feat.fps, grid));
  const kick = L.map((v, s) => v * (lowOnsets?.[s] ? 0.35 : 1));
  const snare = B.map((v, s) => Math.min(v, S[s]));
  const first = (((downbeat * 4) % 16) + 16) % 16;
  const pos = (s) => (s - first + 16) % 16;
  const mean = Array.from({ length: 16 }, () => ({ k: 0, s: 0, h: 0, n: 0 }));
  for (let s = 0; s < grid.length; s += 1) {
    const m = mean[pos(s)];
    m.k += kick[s];
    m.s += snare[s];
    m.h += H[s];
    m.n += 1;
  }
  // Thresholds are relative to the strongest step: a kick's click lights up
  // the snare band too, just less than the backbeat does.
  const avg = mean.map(({ k, s, h, n }) => ({ k: k / Math.max(1, n), s: (s - 0.3 * k) / Math.max(1, n), h: h / Math.max(1, n) }));
  const top = (key) => Math.max(...avg.map((a) => a[key]));
  const sBar = Math.max(0.4, 0.8 * top("s"));
  const kBar = Math.max(0.3, 0.55 * top("k"));
  const pattern = avg.map((a) => {
    const kinds = [];
    if (a.s >= sBar) kinds.push("s");
    else {
      if (a.k >= kBar) kinds.push("k");
      if (a.h >= 0.3) kinds.push("h");
    }
    return kinds;
  });
  // No backbeat and no steady hats: leave the drums out rather than invent them.
  if (!pattern.some((p) => p.includes("s")) && pattern.filter((p) => p.includes("h")).length < 4) return [];
  const own = { k: kick, s: snare, h: H };
  const hits = [];
  for (let s = 0; s < grid.length; s += 1) {
    const kinds = pattern[pos(s)];
    for (const kind of kinds) {
      if (own[kind][s] > 0.15) hits.push({ slot: s, kind, v: kind === "h" ? 0.5 + 0.2 * Math.min(1, H[s]) : Math.min(1, 0.6 + 0.4 * own[kind][s]) });
    }
    if (!kinds.includes("s") && snare[s] > 1.1 && S[s] >= (S[s - 1] ?? 0) && S[s] >= (S[s + 1] ?? 0)) hits.push({ slot: s, kind: "s", v: 0.8 });
  }
  return hits;
}
