import { createFFT } from "./fft";

const MAX_PEAKS = 192;
const KEY_MAX_RATIO = 0.9;
const OCTAVE_NSDF_RATIO = 0.72;
const SUBHARMONIC_EVIDENCE = 0.24;
const MISSING_FUNDAMENTAL_EVIDENCE = 0.12;
const HARMONIC_PROBE_DEPTH = 4;
const REFINE_HARMONICS = 6;
const REFINE_CEILING_HZ = 2600;
const REFINE_LIMIT_CENTS = 60;
const REFINE_MAGNITUDE_FLOOR = 0.12;
const MAGNITUDE_CACHE = 64;

export function createPitchDetector(windowSize) {
  const fftSize = 1 << Math.ceil(Math.log2(windowSize * 2));
  const fft = createFFT(fftSize);

  const samples = new Float64Array(windowSize);
  const realPart = new Float64Array(fftSize);
  const imagPart = new Float64Array(fftSize);
  const nsdf = new Float32Array(windowSize);
  const cumulativeEnergy = new Float64Array(windowSize + 1);
  const peakLags = new Int32Array(MAX_PEAKS);
  const peakValues = new Float64Array(MAX_PEAKS);
  const harmonicMagnitudes = new Float64Array(REFINE_HARMONICS + 1);
  const cacheKeys = new Float64Array(MAGNITUDE_CACHE);
  const cacheValues = new Float64Array(MAGNITUDE_CACHE);
  let cacheCount = 0;

  const fullWindow = hann(windowSize);
  const segmentLength = (windowSize >> 2) * 3;
  const segmentHop = windowSize >> 2;
  const segmentWindow = blackmanHarris(segmentLength);

  const result = {
    frequency: 0,
    clarity: 0,
    rms: 0,
    peak: 0,
    refined: false,
  };

  function analyze(input, sampleRate, minFrequency, maxFrequency) {
    const n = windowSize;

    let mean = 0;
    for (let i = 0; i < n; i++) mean += input[i];
    mean /= n;

    let sumSquares = 0;
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const value = input[i] - mean;
      samples[i] = value;
      sumSquares += value * value;
      const magnitude = value < 0 ? -value : value;
      if (magnitude > peak) peak = magnitude;
    }

    result.rms = Math.sqrt(sumSquares / n);
    result.peak = peak;
    result.frequency = 0;
    result.clarity = 0;
    result.refined = false;
    cacheCount = 0;
    if (result.rms <= 0) return result;

    const maxLag = Math.min(n - 2, Math.floor(sampleRate / minFrequency));
    const minLag = Math.max(2, Math.floor(sampleRate / maxFrequency));
    if (maxLag <= minLag) return result;

    autocorrelate(n);
    normalize(n, maxLag);

    const peakCount = collectKeyMaxima(minLag, maxLag);
    if (peakCount === 0) return result;

    let best = 0;
    for (let i = 0; i < peakCount; i++) {
      if (peakValues[i] > best) best = peakValues[i];
    }
    if (best <= 0) return result;

    const threshold = KEY_MAX_RATIO * best;
    let chosenLag = peakLags[0];
    let chosenValue = peakValues[0];
    for (let i = 0; i < peakCount; i++) {
      if (peakValues[i] >= threshold) {
        chosenLag = peakLags[i];
        chosenValue = peakValues[i];
        break;
      }
    }

    const interpolatedLag = parabolicVertex(nsdf, chosenLag);
    if (!(interpolatedLag > 0)) return result;

    let frequency = sampleRate / interpolatedLag;
    frequency = correctOctave(
      frequency,
      chosenLag,
      chosenValue,
      sampleRate,
      minFrequency,
      maxFrequency,
      maxLag
    );

    const refinedFrequency = refineByPhase(frequency, sampleRate);
    if (refinedFrequency > 0) {
      frequency = refinedFrequency;
      result.refined = true;
    }

    if (frequency < minFrequency || frequency > maxFrequency) return result;

    result.frequency = frequency;
    result.clarity = Math.max(0, Math.min(1, chosenValue));
    return result;
  }

  function autocorrelate(n) {
    realPart.fill(0);
    imagPart.fill(0);
    for (let i = 0; i < n; i++) realPart[i] = samples[i];
    fft.forward(realPart, imagPart);
    for (let i = 0; i < fftSize; i++) {
      const re = realPart[i];
      const im = imagPart[i];
      realPart[i] = re * re + im * im;
      imagPart[i] = 0;
    }
    fft.inverse(realPart, imagPart);
  }

  function normalize(n, maxLag) {
    cumulativeEnergy[0] = 0;
    for (let i = 0; i < n; i++) {
      cumulativeEnergy[i + 1] = cumulativeEnergy[i] + samples[i] * samples[i];
    }
    const total = cumulativeEnergy[n];
    for (let lag = 0; lag <= maxLag; lag++) {
      const divisor =
        cumulativeEnergy[n - lag] + (total - cumulativeEnergy[lag]);
      nsdf[lag] = divisor > 0 ? (2 * realPart[lag]) / divisor : 0;
    }
  }

  function collectKeyMaxima(minLag, maxLag) {
    let count = 0;
    let lag = minLag;
    while (lag <= maxLag && nsdf[lag] > 0) lag++;
    while (lag <= maxLag && count < MAX_PEAKS) {
      while (lag <= maxLag && nsdf[lag] <= 0) lag++;
      if (lag > maxLag) break;
      let bestValue = nsdf[lag];
      let bestLag = lag;
      while (lag <= maxLag && nsdf[lag] > 0) {
        if (nsdf[lag] > bestValue) {
          bestValue = nsdf[lag];
          bestLag = lag;
        }
        lag++;
      }
      peakLags[count] = bestLag;
      peakValues[count] = bestValue;
      count++;
    }
    return count;
  }

  function correctOctave(
    frequency,
    chosenLag,
    chosenValue,
    sampleRate,
    minFrequency,
    maxFrequency,
    maxLag
  ) {
    for (const divisor of [2, 3]) {
      const candidate = frequency / divisor;
      if (candidate < minFrequency) continue;
      const candidateLag = Math.round(chosenLag * divisor);
      if (candidateLag > maxLag) continue;
      if (nsdf[candidateLag] < OCTAVE_NSDF_RATIO * chosenValue) continue;
      if (
        interleavedEnergyRatio(frequency, divisor, sampleRate) >=
        SUBHARMONIC_EVIDENCE
      ) {
        return candidate;
      }
    }

    const doubled = frequency * 2;
    if (
      doubled <= maxFrequency &&
      oddToEvenRatio(frequency, sampleRate) < MISSING_FUNDAMENTAL_EVIDENCE
    ) {
      return doubled;
    }

    return frequency;
  }

  function interleavedEnergyRatio(frequency, divisor, sampleRate) {
    const nyquist = sampleRate / 2;
    let present = 0;
    let presentCount = 0;
    for (let k = 1; k <= HARMONIC_PROBE_DEPTH; k++) {
      const probe = frequency * k;
      if (probe >= nyquist) break;
      present += binMagnitude(probe, sampleRate);
      presentCount++;
    }
    if (presentCount === 0 || present <= 0) return 0;

    let interleaved = 0;
    let interleavedCount = 0;
    for (let j = 1; j <= HARMONIC_PROBE_DEPTH * divisor; j++) {
      if (j % divisor === 0) continue;
      const probe = (frequency * j) / divisor;
      if (probe >= nyquist) break;
      interleaved += binMagnitude(probe, sampleRate);
      interleavedCount++;
    }
    if (interleavedCount === 0) return 0;

    return interleaved / interleavedCount / (present / presentCount);
  }

  function oddToEvenRatio(frequency, sampleRate) {
    const nyquist = sampleRate / 2;
    let odd = 0;
    let oddCount = 0;
    let even = 0;
    let evenCount = 0;
    for (let k = 1; k <= 6; k++) {
      const probe = frequency * k;
      if (probe >= nyquist) break;
      const magnitude = binMagnitude(probe, sampleRate);
      if (k % 2 === 1) {
        odd += magnitude;
        oddCount++;
      } else {
        even += magnitude;
        evenCount++;
      }
    }
    if (oddCount === 0 || evenCount === 0) return 1;
    const evenMean = even / evenCount;
    if (evenMean <= 0) return 1;
    return odd / oddCount / evenMean;
  }

  function refineByPhase(frequency, sampleRate) {
    const ceiling = Math.min(REFINE_CEILING_HZ, sampleRate * 0.4);
    harmonicMagnitudes.fill(0);
    let strongest = 0;
    for (let k = 1; k <= REFINE_HARMONICS; k++) {
      const probe = frequency * k;
      if (probe >= ceiling) break;
      const magnitude = binMagnitude(probe, sampleRate);
      harmonicMagnitudes[k] = magnitude;
      if (magnitude > strongest) strongest = magnitude;
    }
    if (strongest <= 0) return 0;

    let weightedSum = 0;
    let weightTotal = 0;
    for (let k = 1; k <= REFINE_HARMONICS; k++) {
      const magnitude = harmonicMagnitudes[k];
      if (!(magnitude > 0) || magnitude < strongest * REFINE_MAGNITUDE_FLOOR) {
        continue;
      }
      const probe = frequency * k;
      const first = binPhase(0, probe, sampleRate);
      const second = binPhase(segmentHop, probe, sampleRate);
      if (first == null || second == null) continue;

      const omega = (2 * Math.PI * probe) / sampleRate;
      const error = wrapToPi(second - first - omega * segmentHop);
      const corrected =
        probe + (error * sampleRate) / (2 * Math.PI * segmentHop);
      if (!(corrected > 0)) continue;

      const estimate = corrected / k;
      const drift = Math.abs(1200 * Math.log2(estimate / frequency));
      if (!Number.isFinite(drift) || drift > REFINE_LIMIT_CENTS) continue;

      const weight = (magnitude * magnitude) / k;
      weightedSum += estimate * weight;
      weightTotal += weight;
    }
    if (weightTotal <= 0) return 0;

    return weightedSum / weightTotal;
  }

  function binMagnitude(frequency, sampleRate) {
    for (let i = 0; i < cacheCount; i++) {
      if (cacheKeys[i] === frequency) return cacheValues[i];
    }
    const value = computeBinMagnitude(frequency, sampleRate);
    if (cacheCount < MAGNITUDE_CACHE) {
      cacheKeys[cacheCount] = frequency;
      cacheValues[cacheCount] = value;
      cacheCount++;
    }
    return value;
  }

  function computeBinMagnitude(frequency, sampleRate) {
    const omega = (2 * Math.PI * frequency) / sampleRate;
    const rotationCos = Math.cos(omega);
    const rotationSin = Math.sin(omega);
    let phasorRe = 1;
    let phasorIm = 0;
    let sumRe = 0;
    let sumIm = 0;
    for (let i = 0; i < windowSize; i++) {
      const value = samples[i] * fullWindow[i];
      sumRe += value * phasorRe;
      sumIm += value * phasorIm;
      const nextRe = phasorRe * rotationCos + phasorIm * rotationSin;
      phasorIm = phasorIm * rotationCos - phasorRe * rotationSin;
      phasorRe = nextRe;
    }
    return Math.sqrt(sumRe * sumRe + sumIm * sumIm) / windowSize;
  }

  function binPhase(offset, frequency, sampleRate) {
    const omega = (2 * Math.PI * frequency) / sampleRate;
    const rotationCos = Math.cos(omega);
    const rotationSin = Math.sin(omega);
    let phasorRe = 1;
    let phasorIm = 0;
    let sumRe = 0;
    let sumIm = 0;
    for (let i = 0; i < segmentLength; i++) {
      const value = samples[offset + i] * segmentWindow[i];
      sumRe += value * phasorRe;
      sumIm += value * phasorIm;
      const nextRe = phasorRe * rotationCos + phasorIm * rotationSin;
      phasorIm = phasorIm * rotationCos - phasorRe * rotationSin;
      phasorRe = nextRe;
    }
    if (sumRe === 0 && sumIm === 0) return null;
    return Math.atan2(sumIm, sumRe);
  }

  return { windowSize, fftSize, analyze };
}

function hann(length) {
  const table = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    table[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length);
  }
  return table;
}

function blackmanHarris(length) {
  const table = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    const phase = (2 * Math.PI * i) / length;
    table[i] =
      0.35875 -
      0.48829 * Math.cos(phase) +
      0.14128 * Math.cos(2 * phase) -
      0.01168 * Math.cos(3 * phase);
  }
  return table;
}

function parabolicVertex(values, index) {
  if (index <= 0 || index >= values.length - 1) return index;
  const previous = values[index - 1];
  const current = values[index];
  const next = values[index + 1];
  const denominator = previous - 2 * current + next;
  if (denominator === 0) return index;
  return index + (0.5 * (previous - next)) / denominator;
}

function wrapToPi(angle) {
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= 2 * Math.PI;
  while (wrapped < -Math.PI) wrapped += 2 * Math.PI;
  return wrapped;
}
