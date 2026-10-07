export const PADS = 16;

const ANALYSIS_RATE = 22050;
const HOP = 256;
const WINDOW = 512;
const FRAME_RATE = ANALYSIS_RATE / HOP;
const LOW_CUTOFF = 160;
const MIN_BPM = 70;
const MAX_BPM = 180;
const TEMPO_CENTER = 115;
const TEMPO_SPREAD = 0.5;
const OCTAVE_FACTORS = [0.5, 1, 2];
const MIN_CONFIDENCE = 1.12;
const DP_TIGHTNESS = 100;
const EDGE_MARGIN_SECONDS = 1;
const SNAP_FRAMES = 3;
const PRE_ROLL_SECONDS = 0.004;
const REFINE_SECONDS = 0.02;
const REFINE_HOP = 64;
const REFINE_SPAN = 128;
const ZERO_SEARCH = 96;
const MAX_REGION_SECONDS = 32;
const EVEN_WINDOW_SECONDS = 8;
const YIELD_EVERY = 192;

function yieldToMain() {
  if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}

export function analysisRegion(duration) {
  if (duration <= MAX_REGION_SECONDS + 4) return { start: 0, end: duration };
  const start = Math.min(30, Math.max(0, duration - MAX_REGION_SECONDS - 2));
  return { start, end: start + MAX_REGION_SECONDS };
}

export function cropBuffer(buffer, start, end) {
  const from = Math.max(0, Math.floor(start * buffer.sampleRate));
  const to = Math.min(buffer.length, Math.floor(end * buffer.sampleRate));
  if (from === 0 && to === buffer.length) return buffer;
  const cropped = new AudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length: to - from,
    sampleRate: buffer.sampleRate,
  });
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    cropped.copyToChannel(buffer.getChannelData(channel).subarray(from, to), channel);
  }
  return cropped;
}

export function reverseBuffer(buffer) {
  const reversed = new AudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length: buffer.length,
    sampleRate: buffer.sampleRate,
  });
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const source = buffer.getChannelData(channel);
    const target = reversed.getChannelData(channel);
    const last = source.length - 1;
    for (let index = 0; index <= last; index += 1) target[index] = source[last - index];
  }
  return reversed;
}

function mixDown(buffer) {
  const channels = buffer.numberOfChannels;
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) mono[index] += data[index] / channels;
  }
  return mono;
}

function downsample(mono, sampleRate) {
  const ratio = sampleRate / ANALYSIS_RATE;
  const length = Math.floor(mono.length / ratio);
  const full = new Float32Array(length);
  const low = new Float32Array(length);
  const coefficient = Math.exp((-2 * Math.PI * LOW_CUTOFF) / sampleRate);
  let lowState = 0;
  let cursor = 0;
  for (let index = 0; index < length; index += 1) {
    const end = Math.min(mono.length, Math.round((index + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (; cursor < end; cursor += 1) {
      const sample = mono[cursor];
      lowState = sample + coefficient * (lowState - sample);
      sum += sample;
      count += 1;
    }
    full[index] = count ? sum / count : mono[Math.min(cursor, mono.length - 1)];
    low[index] = lowState;
  }
  return { full, low };
}

function createFft(size) {
  const levels = Math.log2(size);
  const order = new Uint32Array(size);
  for (let index = 0; index < size; index += 1) {
    let reversed = 0;
    let value = index;
    for (let level = 0; level < levels; level += 1) {
      reversed = (reversed << 1) | (value & 1);
      value >>= 1;
    }
    order[index] = reversed;
  }
  const cosine = new Float32Array(size / 2);
  const sine = new Float32Array(size / 2);
  for (let index = 0; index < size / 2; index += 1) {
    cosine[index] = Math.cos((2 * Math.PI * index) / size);
    sine[index] = Math.sin((2 * Math.PI * index) / size);
  }
  const hann = new Float32Array(size);
  for (let index = 0; index < size; index += 1) hann[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
  const real = new Float32Array(size);
  const imaginary = new Float32Array(size);

  return function magnitudesAt(input, offset, magnitudes) {
    for (let index = 0; index < size; index += 1) {
      real[order[index]] = input[offset + index] * hann[index];
      imaginary[order[index]] = 0;
    }
    for (let span = 2; span <= size; span <<= 1) {
      const half = span >> 1;
      const stride = size / span;
      for (let start = 0; start < size; start += span) {
        for (let step = 0; step < half; step += 1) {
          const c = cosine[step * stride];
          const s = sine[step * stride];
          const a = start + step;
          const b = a + half;
          const twistedReal = real[b] * c + imaginary[b] * s;
          const twistedImaginary = imaginary[b] * c - real[b] * s;
          real[b] = real[a] - twistedReal;
          imaginary[b] = imaginary[a] - twistedImaginary;
          real[a] += twistedReal;
          imaginary[a] += twistedImaginary;
        }
      }
    }
    for (let bin = 0; bin < magnitudes.length; bin += 1) {
      magnitudes[bin] = Math.sqrt(real[bin] * real[bin] + imaginary[bin] * imaginary[bin]);
    }
  };
}

async function onsetEnvelope(full, low) {
  const frames = Math.max(0, Math.floor((full.length - WINDOW) / HOP) + 1);
  const magnitudesAt = createFft(WINDOW);
  const magnitudes = new Float32Array(WINDOW / 2);
  const previous = new Float32Array(WINDOW / 2);
  const flux = new Float32Array(frames);
  const lowFlux = new Float32Array(frames);
  const loudness = new Float32Array(frames);
  let previousLow = 0;
  let fluxPeak = 1e-9;
  let lowPeak = 1e-9;

  for (let frame = 0; frame < frames; frame += 1) {
    const offset = frame * HOP;
    magnitudesAt(full, offset, magnitudes);
    let rise = 0;
    for (let bin = 1; bin < magnitudes.length; bin += 1) {
      const value = Math.log1p(magnitudes[bin] * 20);
      const difference = value - previous[bin];
      if (difference > 0) rise += difference;
      previous[bin] = value;
    }
    let lowEnergy = 0;
    let fullEnergy = 0;
    for (let index = offset; index < offset + WINDOW; index += 1) {
      lowEnergy += low[index] * low[index];
      fullEnergy += full[index] * full[index];
    }
    const lowLevel = Math.sqrt(lowEnergy / WINDOW);
    flux[frame] = frame ? rise : 0;
    lowFlux[frame] = frame ? Math.max(0, lowLevel - previousLow) : 0;
    loudness[frame] = fullEnergy / WINDOW;
    previousLow = lowLevel;
    if (flux[frame] > fluxPeak) fluxPeak = flux[frame];
    if (lowFlux[frame] > lowPeak) lowPeak = lowFlux[frame];
    if (frame % YIELD_EVERY === YIELD_EVERY - 1) await yieldToMain();
  }

  const novelty = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    lowFlux[frame] /= lowPeak;
    novelty[frame] = flux[frame] / fluxPeak + 0.6 * lowFlux[frame];
  }
  return { novelty, lowFlux, loudness, frames };
}

function detrendAndNormalise(novelty) {
  const radius = 12;
  const length = novelty.length;
  const prefix = new Float64Array(length + 1);
  for (let index = 0; index < length; index += 1) prefix[index + 1] = prefix[index] + novelty[index];
  const onset = new Float32Array(length);
  let sum = 0;
  let squares = 0;
  for (let index = 0; index < length; index += 1) {
    const from = Math.max(0, index - radius);
    const to = Math.min(length, index + radius + 1);
    const mean = (prefix[to] - prefix[from]) / (to - from);
    const value = Math.max(0, novelty[index] - mean);
    onset[index] = value;
    sum += value;
    squares += value * value;
  }
  const mean = sum / Math.max(1, length);
  const deviation = Math.sqrt(Math.max(1e-12, squares / Math.max(1, length) - mean * mean));
  for (let index = 0; index < length; index += 1) onset[index] /= deviation;
  return onset;
}

function autocorrelate(signal, maxLag) {
  const correlation = new Float32Array(maxLag + 1);
  const length = signal.length;
  for (let lag = 1; lag <= maxLag && lag < length; lag += 1) {
    let sum = 0;
    for (let index = 0; index + lag < length; index += 1) sum += signal[index] * signal[index + lag];
    correlation[lag] = sum / (length - lag);
  }
  return correlation;
}

function correlationAt(correlation, lag) {
  const floor = Math.floor(lag);
  if (floor < 1 || floor + 1 >= correlation.length) return 0;
  const fraction = lag - floor;
  return correlation[floor] * (1 - fraction) + correlation[floor + 1] * fraction;
}

function tempoStrength(correlation, bpm) {
  const lag = (60 * FRAME_RATE) / bpm;
  let strength = 0;
  for (let multiple = 1; multiple <= 4; multiple += 1) strength += correlationAt(correlation, lag * multiple) / multiple;
  return strength;
}

function tempoPrior(bpm) {
  const octaves = Math.log2(bpm / TEMPO_CENTER) / TEMPO_SPREAD;
  return Math.exp(-0.5 * octaves * octaves);
}

function estimateTempo(onset) {
  const maxLag = Math.ceil(((60 * FRAME_RATE) / MIN_BPM) * 4) + 2;
  const correlation = autocorrelate(onset, maxLag);
  let raw = TEMPO_CENTER;
  let rawStrength = -Infinity;
  let total = 0;
  let count = 0;
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.25) {
    const strength = tempoStrength(correlation, bpm);
    total += strength;
    count += 1;
    if (strength > rawStrength) {
      rawStrength = strength;
      raw = bpm;
    }
  }
  let best = raw;
  let bestScore = -Infinity;
  for (const factor of OCTAVE_FACTORS) {
    const bpm = raw * factor;
    if (bpm < MIN_BPM || bpm > MAX_BPM) continue;
    const score = tempoStrength(correlation, bpm) * tempoPrior(bpm);
    if (score > bestScore) {
      bestScore = score;
      best = bpm;
    }
  }
  const mean = total / Math.max(1, count);
  return { bpm: best, confidence: mean > 0 ? tempoStrength(correlation, best) / mean : 0 };
}

function trackBeats(onset, bpm) {
  const period = (60 * FRAME_RATE) / bpm;
  const length = onset.length;
  const nearest = Math.max(1, Math.round(period / 2));
  const farthest = Math.round(period * 2);
  const penalty = new Float32Array(farthest + 1);
  for (let gap = nearest; gap <= farthest; gap += 1) {
    const ratio = Math.log(gap / period);
    penalty[gap] = DP_TIGHTNESS * ratio * ratio;
  }
  const score = new Float32Array(length);
  const previous = new Int32Array(length).fill(-1);
  for (let frame = 0; frame < length; frame += 1) {
    let bestValue = 0;
    let bestFrame = -1;
    for (let gap = nearest; gap <= farthest; gap += 1) {
      const candidate = frame - gap;
      if (candidate < 0) break;
      const value = score[candidate] - penalty[gap];
      if (value > bestValue) {
        bestValue = value;
        bestFrame = candidate;
      }
    }
    score[frame] = onset[frame] + bestValue;
    previous[frame] = bestFrame;
  }
  let end = length - 1;
  for (let frame = Math.max(0, length - Math.ceil(period)); frame < length; frame += 1) {
    if (score[frame] > score[end]) end = frame;
  }
  const beats = [];
  for (let frame = end; frame >= 0; frame = previous[frame]) beats.push(frame);
  return beats.reverse();
}

function downbeatPhase(beats, lowFlux) {
  const weight = [0, 0, 0, 0];
  beats.forEach((frame, index) => {
    weight[index % 4] += lowFlux[frame] ?? 0;
  });
  let phase = 0;
  let best = -Infinity;
  for (let candidate = 0; candidate < 4; candidate += 1) {
    const score = weight[candidate] + 0.5 * weight[(candidate + 2) % 4];
    if (score > best) {
      best = score;
      phase = candidate;
    }
  }
  return phase;
}

function loudnessPrefix(loudness) {
  const prefix = new Float64Array(loudness.length + 1);
  for (let index = 0; index < loudness.length; index += 1) prefix[index + 1] = prefix[index] + loudness[index];
  return prefix;
}

function chooseWindow(beats, prefix, phase, span, frames) {
  const margin = EDGE_MARGIN_SECONDS * FRAME_RATE;
  let first = -1;
  let best = -Infinity;
  for (let index = 0; index + span < beats.length; index += 1) {
    const from = beats[index];
    const to = beats[index + span];
    if (from < margin || to > frames - margin) continue;
    const aligned = (((index - phase) % 4) + 4) % 4 === 0;
    const energy = (prefix[to] - prefix[from]) * (aligned ? 1 : 0.85);
    if (energy > best) {
      best = energy;
      first = index;
    }
  }
  return first;
}

function snapToOnset(frame, onset) {
  let best = frame;
  for (let candidate = frame - SNAP_FRAMES; candidate <= frame + SNAP_FRAMES; candidate += 1) {
    if (candidate < 0 || candidate >= onset.length) continue;
    if (onset[candidate] > onset[best]) best = candidate;
  }
  return best;
}

function frameSeconds(frame) {
  return (frame * HOP + (WINDOW - HOP) / 2) / ANALYSIS_RATE;
}

function refineStart(mono, sampleRate, seconds) {
  const centre = Math.round(seconds * sampleRate);
  const reach = Math.round(REFINE_SECONDS * sampleRate);
  let onset = centre;
  let bestRise = -Infinity;
  for (let position = centre - reach; position <= centre + reach; position += REFINE_HOP) {
    if (position - REFINE_SPAN < 0 || position + REFINE_SPAN >= mono.length) continue;
    let before = 0;
    let after = 0;
    for (let index = 0; index < REFINE_SPAN; index += 1) {
      const early = mono[position - REFINE_SPAN + index];
      const late = mono[position + index];
      before += early * early;
      after += late * late;
    }
    const rise = after - before;
    if (rise > bestRise) {
      bestRise = rise;
      onset = position;
    }
  }
  let start = Math.max(1, onset - Math.round(PRE_ROLL_SECONDS * sampleRate));
  for (let index = start; index > Math.max(1, start - ZERO_SEARCH); index -= 1) {
    if (mono[index - 1] <= 0 && mono[index] > 0) {
      start = index;
      break;
    }
  }
  return start / sampleRate;
}

function evenSlices(prefix, frames, duration) {
  const length = Math.min(EVEN_WINDOW_SECONDS, duration);
  const windowFrames = Math.floor(length * FRAME_RATE);
  const margin = Math.floor(EDGE_MARGIN_SECONDS * FRAME_RATE);
  let start = 0;
  let best = -Infinity;
  for (let frame = margin; frame + windowFrames < frames - margin; frame += 8) {
    const energy = prefix[frame + windowFrames] - prefix[frame];
    if (energy > best) {
      best = energy;
      start = frame;
    }
  }
  const startSeconds = Math.min(frameSeconds(start), Math.max(0, duration - length));
  const stepSeconds = length / PADS;
  const bounds = new Float64Array(PADS + 1);
  for (let index = 0; index <= PADS; index += 1) bounds[index] = startSeconds + index * stepSeconds;
  return { bounds, bpm: 60 / stepSeconds, stepSeconds, beatsPerSlice: 1, mode: "even" };
}

export async function sliceTrack(buffer) {
  const mono = mixDown(buffer);
  const { full, low } = downsample(mono, buffer.sampleRate);
  await yieldToMain();
  const { novelty, lowFlux, loudness, frames } = await onsetEnvelope(full, low);
  const prefix = loudnessPrefix(loudness);
  if (frames < FRAME_RATE * 6) return evenSlices(prefix, frames, buffer.duration);

  const onset = detrendAndNormalise(novelty);
  const tempo = estimateTempo(onset);
  if (tempo.confidence < MIN_CONFIDENCE) return evenSlices(prefix, frames, buffer.duration);
  await yieldToMain();

  const beats = trackBeats(onset, tempo.bpm);
  const beatsPerSlice = tempo.bpm < 90 ? 2 : 1;
  const span = PADS * beatsPerSlice;
  const phase = downbeatPhase(beats, lowFlux);
  const first = chooseWindow(beats, prefix, phase, span, frames);
  if (first < 0) return evenSlices(prefix, frames, buffer.duration);

  const bounds = new Float64Array(PADS + 1);
  for (let index = 0; index <= PADS; index += 1) {
    const frame = snapToOnset(beats[first + index * beatsPerSlice], onset);
    bounds[index] = refineStart(mono, buffer.sampleRate, frameSeconds(frame));
  }
  for (let index = 1; index <= PADS; index += 1) {
    if (bounds[index] - bounds[index - 1] < 0.08) return evenSlices(prefix, frames, buffer.duration);
  }
  if (bounds[PADS] > buffer.duration) bounds[PADS] = buffer.duration;
  const stepSeconds = (bounds[PADS] - bounds[0]) / PADS;
  return { bounds, bpm: (60 * beatsPerSlice) / stepSeconds, stepSeconds, beatsPerSlice, mode: "beats" };
}
