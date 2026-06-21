// McLeod Pitch Method (MPM) — monophonic pitch detection on a time-domain
// buffer. Pure JS, no React/DOM, unit-testable with synthetic sine buffers.
//
// MPM computes the Normalized Square Difference Function (NSDF), whose peaks
// are bounded to [-1, 1]. That bound gives us a free, well-scaled "clarity"
// value (how periodic the signal is) which we use to reject noise and to drive
// the in-tune gate. MPM resists the octave errors that plain autocorrelation
// suffers on harmonically-rich low strings (the guitar low-E problem).
//
// Ref: P. McLeod & G. Wyvill, "A Smarter Way to Find Pitch" (ICMC 2005).

const DEFAULTS = {
  clarityThreshold: 0.9, // pick the first key maximum >= k * globalMax
  minRms: 0.008, // gate out silence / quiet room noise
  minFrequency: 60, // Hz — caps maxLag (lowest pitch we bother detecting)
  maxFrequency: 1400, // Hz — caps minLag (ignore sub-period lags)
};

/**
 * @param {Float32Array} buf   time-domain samples in [-1, 1]
 * @param {number} sampleRate  AudioContext sample rate (e.g. 44100/48000)
 * @param {object} [opts]      { clarityThreshold, minRms, minFrequency, maxFrequency }
 * @returns {{ frequency: number|null, clarity: number, rms: number }}
 */
export function detectPitchMPM(buf, sampleRate, opts = {}) {
  const { clarityThreshold, minRms, minFrequency, maxFrequency } = {
    ...DEFAULTS,
    ...opts,
  };
  const n = buf.length;

  // --- 1. RMS loudness gate (cheap pre-reject) ---
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < minRms) return { frequency: null, clarity: 0, rms };

  const maxLag = Math.min(n - 1, Math.floor(sampleRate / minFrequency));
  const minLag = Math.max(2, Math.floor(sampleRate / maxFrequency));

  // --- 2. NSDF[tau] = 2 * ACF[tau] / m[tau] ---
  // ACF[tau] = Σ x[i]·x[i+tau];  m[tau] = Σ (x[i]² + x[i+tau]²) over i<n-tau.
  const nsdf = new Float32Array(maxLag + 1);
  for (let tau = 0; tau <= maxLag; tau++) {
    let acf = 0;
    let m = 0;
    for (let i = 0, j = tau; j < n; i++, j++) {
      const a = buf[i];
      const b = buf[j];
      acf += a * b;
      m += a * a + b * b;
    }
    nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
  }

  // --- 3. Key-maxima peak picking ---
  // Skip the lobe around tau=0 (down to the first negative crossing), then take
  // the maximum NSDF value inside each positive region between zero crossings.
  const peakIndices = [];
  const peakValues = [];
  let tau = minLag;
  while (tau <= maxLag && nsdf[tau] > 0) tau++; // skip initial positive lobe
  while (tau <= maxLag) {
    while (tau <= maxLag && nsdf[tau] <= 0) tau++; // to next positive crossing
    if (tau > maxLag) break;
    let maxVal = nsdf[tau];
    let maxIdx = tau;
    while (tau <= maxLag && nsdf[tau] > 0) {
      if (nsdf[tau] > maxVal) {
        maxVal = nsdf[tau];
        maxIdx = tau;
      }
      tau++;
    }
    peakIndices.push(maxIdx);
    peakValues.push(maxVal);
  }

  if (peakIndices.length === 0) return { frequency: null, clarity: 0, rms };

  // --- 4. Choose the first key maximum >= threshold * globalMax ---
  let globalMax = 0;
  for (let i = 0; i < peakValues.length; i++) {
    if (peakValues[i] > globalMax) globalMax = peakValues[i];
  }
  if (globalMax <= 0) return { frequency: null, clarity: 0, rms };

  const threshold = clarityThreshold * globalMax;
  let chosenIdx = peakIndices[0];
  let chosenVal = peakValues[0];
  for (let i = 0; i < peakValues.length; i++) {
    if (peakValues[i] >= threshold) {
      chosenIdx = peakIndices[i];
      chosenVal = peakValues[i];
      break;
    }
  }

  // --- 5. Parabolic interpolation for sub-sample lag precision ---
  const tauEst = parabolicPeak(nsdf, chosenIdx);
  if (tauEst <= 0) return { frequency: null, clarity: chosenVal, rms };

  const frequency = sampleRate / tauEst;
  if (frequency < minFrequency || frequency > maxFrequency) {
    return { frequency: null, clarity: chosenVal, rms };
  }
  return { frequency, clarity: chosenVal, rms };
}

// Fit a parabola through (i-1, i, i+1) and return the sub-sample x of its vertex.
function parabolicPeak(arr, i) {
  if (i <= 0 || i >= arr.length - 1) return i;
  const a = arr[i - 1];
  const b = arr[i];
  const c = arr[i + 1];
  const denom = a - 2 * b + c;
  if (denom === 0) return i;
  return i + (0.5 * (a - c)) / denom;
}

/**
 * Rolling median + EMA smoother for the per-frame frequency stream.
 * Median kills single-frame octave-error outliers; EMA gives a calm readout.
 * One instance per tuner session (created in useTuner).
 */
export function createPitchSmoother({ window = 5, ema = 0.25 } = {}) {
  const buf = [];
  let smoothed = null;
  return {
    push(freq) {
      if (freq == null) {
        // Decay confidence quickly on dropout so a held note releases cleanly.
        buf.length = 0;
        smoothed = null;
        return null;
      }
      buf.push(freq);
      if (buf.length > window) buf.shift();
      const sorted = [...buf].sort((x, y) => x - y);
      const median = sorted[sorted.length >> 1];
      // If the EMA is far from the median (new note / big jump), snap to it so
      // the readout doesn't lag a deliberate change; otherwise ease toward it.
      if (smoothed == null || Math.abs(1200 * Math.log2(median / smoothed)) > 80) {
        smoothed = median;
      } else {
        smoothed += (median - smoothed) * ema;
      }
      return smoothed;
    },
    reset() {
      buf.length = 0;
      smoothed = null;
    },
  };
}
