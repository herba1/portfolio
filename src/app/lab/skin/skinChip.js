const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const HARMONICS = 64;
export const CH_GAIN = [0.2, 0.15, 0.42, 0.3];

function lfsrBuffer(ctx, short, seconds = 1) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let reg = 1;
  const hold = Math.max(1, Math.round(ctx.sampleRate / 24000));
  let v = 0;
  for (let i = 0; i < length; i += 1) {
    if (i % hold === 0) {
      const bit = (reg ^ (reg >> (short ? 6 : 1))) & 1;
      reg = (reg >> 1) | (bit << 14);
      v = reg & 1 ? -0.8 : 0.8;
    }
    d[i] = v;
  }
  return buf;
}

export function createWaves(ctx) {
  const pulses = new Map();
  const pulse = (duty) => {
    if (pulses.has(duty)) return pulses.get(duty);
    const real = new Float32Array(HARMONICS);
    const imag = new Float32Array(HARMONICS);
    for (let k = 1; k < HARMONICS; k += 1) real[k] = (2 / (k * Math.PI)) * Math.sin(Math.PI * k * duty);
    const wave = ctx.createPeriodicWave(real, imag);
    pulses.set(duty, wave);
    return wave;
  };
  const N = 1024;
  const steps = [];
  for (let i = 0; i < 32; i += 1) steps.push(i < 16 ? 15 - i : i - 16);
  const x = new Float32Array(N);
  let mean = 0;
  for (let n = 0; n < N; n += 1) {
    x[n] = steps[Math.floor((n / N) * 32)] / 7.5 - 1;
    mean += x[n];
  }
  mean /= N;
  const tr = new Float32Array(HARMONICS);
  const ti = new Float32Array(HARMONICS);
  for (let k = 1; k < HARMONICS; k += 1) {
    let a = 0;
    let b = 0;
    for (let n = 0; n < N; n += 1) {
      const ang = (2 * Math.PI * k * n) / N;
      a += (x[n] - mean) * Math.cos(ang);
      b += (x[n] - mean) * Math.sin(ang);
    }
    tr[k] = (2 * a) / N;
    ti[k] = (2 * b) / N;
  }
  const triangle = ctx.createPeriodicWave(tr, ti);
  return { pulse, triangle, noiseLong: lfsrBuffer(ctx, false), noiseShort: lfsrBuffer(ctx, true) };
}

function tone(ctx, W, dest, when, dur, ev, flags) {
  const osc = ctx.createOscillator();
  const tri = ev.ch === 2;
  osc.setPeriodicWave(tri ? W.triangle : W.pulse(ev.duty ?? 0.5));
  const f = mtof(ev.m);
  if (ev.slide) {
    osc.frequency.setValueAtTime(mtof(ev.m + ev.slide), when);
    osc.frequency.exponentialRampToValueAtTime(f, when + 0.07);
  } else osc.frequency.setValueAtTime(f, when);
  const g = ctx.createGain();
  const peak = ev.v;
  const attack = tri ? 0.003 : 0.005;
  const sustain = tri ? peak * 0.95 : ev.env === "sustain" ? peak * 0.78 : peak * 0.52;
  const decay = ev.env === "sustain" ? 0.25 : 0.09;
  const release = tri ? 0.018 : ev.ch === 0 ? 0.05 : 0.03;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(peak, when + attack);
  g.gain.setTargetAtTime(sustain, when + attack, decay);
  g.gain.setTargetAtTime(0, when + dur, release);
  const end = when + dur + release * 7;
  osc.connect(g);
  g.connect(dest);
  osc.start(when);
  osc.stop(end);
  let lfo = null;
  if (ev.vib && dur > 0.28 && !tri) {
    lfo = ctx.createOscillator();
    lfo.frequency.value = 5.4;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, when);
    depth.gain.setValueAtTime(0, when + Math.min(0.2, dur * 0.4));
    depth.gain.linearRampToValueAtTime(ev.ch === 0 ? 16 : 9, when + Math.min(0.45, dur * 0.8));
    lfo.connect(depth);
    depth.connect(osc.detune);
    lfo.start(when);
    lfo.stop(end);
  }
  if (flags.live) {
    osc.onended = () => {
      g.disconnect();
      if (lfo) lfo.disconnect();
    };
  }
}

let noiseSeed = 1;
function hit(ctx, W, dest, triDest, when, ev, flags) {
  const kind = ev.kind;
  const v = ev.v;
  const noise = (buf, type, freq, q, gain, tau, len, rate = 1) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.0015);
    g.gain.setTargetAtTime(0, when + 0.0015, tau);
    src.connect(filt);
    filt.connect(g);
    g.connect(dest);
    noiseSeed = (noiseSeed * 1103515245 + 12345) >>> 0;
    const offset = ((noiseSeed >>> 8) % 1000) / 1000 * (buf.duration - len - 0.01);
    src.start(when, Math.max(0, offset), len);
    if (flags.live) src.onended = () => g.disconnect();
  };
  const drop = (from, to, gain, tau, len) => {
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(W.triangle);
    osc.frequency.setValueAtTime(from, when);
    osc.frequency.exponentialRampToValueAtTime(to, when + len * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.002);
    g.gain.setTargetAtTime(0, when + 0.002, tau);
    osc.connect(g);
    g.connect(triDest);
    osc.start(when);
    osc.stop(when + len);
    if (flags.live) osc.onended = () => g.disconnect();
  };
  if (kind === "k") {
    drop(150, 42, 1.1 * v, 0.06, 0.32);
    noise(W.noiseLong, "lowpass", 1400, 0.7, 0.35 * v, 0.012, 0.06);
  } else if (kind === "s") {
    noise(W.noiseLong, "highpass", 900, 0.6, 0.85 * v, 0.07, 0.4);
    drop(230, 150, 0.45 * v, 0.03, 0.12);
  } else if (kind === "h") {
    noise(W.noiseShort, "highpass", 6500, 0.7, 0.32 * v, 0.014, 0.09, 1.4);
  } else if (kind === "o") {
    noise(W.noiseShort, "highpass", 6000, 0.7, 0.3 * v, 0.06, 0.32, 1.4);
  } else if (kind === "t") {
    noise(W.noiseLong, "highpass", 7600, 0.7, 0.5 * v, 0.035, 0.18, 1.3);
  } else if (kind === "c") {
    noise(W.noiseShort, "bandpass", 2600, 3, 0.45 * v, 0.03, 0.16, 0.9);
  } else if (kind === "m") {
    drop(220, 110, 0.9 * v, 0.09, 0.4);
    noise(W.noiseLong, "bandpass", 700, 0.8, 0.25 * v, 0.03, 0.12);
  } else if (kind === "x") {
    noise(W.noiseLong, "highpass", 4200, 0.6, 0.55 * v, 0.32, 1.6, 0.9);
  }
}

export function buildChannels(ctx, out) {
  return CH_GAIN.map((v) => {
    const g = ctx.createGain();
    g.gain.value = v;
    g.connect(out);
    return g;
  });
}

export function voice(ctx, W, chans, when, ev, flags) {
  if (ev.ch === 3) hit(ctx, W, chans[3], chans[2], when, ev, flags);
  else tone(ctx, W, chans[ev.ch], when, ev.d, ev, flags);
}

export function firstEventAt(events, s) {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].s < s) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export async function renderSong(song, upto, rate = 32000) {
  const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Off) return null;
  const seconds = Math.min(upto, song.length);
  const ctx = new Off(1, Math.ceil(seconds * rate) + 1, rate);
  const W = createWaves(ctx);
  const out = ctx.createGain();
  out.gain.value = 0.8;
  out.connect(ctx.destination);
  const chans = buildChannels(ctx, out);
  for (const ev of song.events) {
    if (ev.s >= seconds) break;
    voice(ctx, W, chans, ev.s, ev, { live: false });
  }
  const buf = await ctx.startRendering();
  return { pcm: buf.getChannelData(0), rate };
}

export function activity(song, s, out) {
  out.fill(0);
  if (!song) return out;
  const ev = song.events;
  const i0 = firstEventAt(ev, s - 1.6);
  for (let i = i0; i < ev.length && ev[i].s <= s; i += 1) {
    const e = ev[i];
    const len = e.ch === 3 ? (e.kind === "x" ? 0.5 : 0.09) : e.d;
    const age = s - e.s;
    if (age < len + 0.05) {
      const lvl = e.ch === 3 ? 1 - age / (len + 0.05) : age < len ? 1 - Math.min(0.45, age / Math.max(0.3, len * 2)) : 0.3;
      out[e.ch] = Math.max(out[e.ch], lvl);
    }
  }
  return out;
}
