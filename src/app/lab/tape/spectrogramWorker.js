import {
  COLUMNS_PER_SECOND,
  LEVEL_COUNT,
  LOOP_SECONDS,
  LOOP_START_SECONDS,
  PRINT_BANDS,
  PRINT_BINS,
  SEAM_SECONDS,
} from "./tapeConstants";

export const SPECTROGRAM_WORKER_SOURCE = `
const LOOP_START_SECONDS = ${LOOP_START_SECONDS};
const LOOP_SECONDS = ${LOOP_SECONDS};
const SEAM_SECONDS = ${SEAM_SECONDS};
const LEVEL_COUNT = ${LEVEL_COUNT};
const COLUMNS_PER_SECOND = ${COLUMNS_PER_SECOND};
const BINS = ${PRINT_BINS};
const BANDS = ${PRINT_BANDS};
const FFT_SIZE = 1024;
const PRINT_LEVEL = 2;
const MIN_HZ = 55;
const MAX_HZ = 5000;
const TILT_DB_PER_OCTAVE = 3;
const RANGE_DB = 62;
const TAPS = 31;

function buildLoop(samples, sampleRate) {
  const start = Math.min(Math.round(LOOP_START_SECONDS * sampleRate), Math.floor(samples.length / 4));
  const seam = Math.round(SEAM_SECONDS * sampleRate);
  const fit = Math.min(Math.round(LOOP_SECONDS * sampleRate), samples.length - start - seam);
  const length = Math.max(64, fit - (fit % 32));
  const loop = new Float32Array(length);
  for (let i = 0; i < length; i++) loop[i] = samples[(start + i) % samples.length];
  for (let i = 0; i < seam; i++) {
    const phase = (i / seam) * Math.PI * 0.5;
    const tail = samples[(start + length + i) % samples.length];
    loop[i] = loop[i] * Math.sin(phase) + tail * Math.cos(phase);
  }
  return loop;
}

function halfBandKernel() {
  const half = (TAPS - 1) / 2;
  const kernel = new Float32Array(TAPS);
  let sum = 0;
  for (let n = -half; n <= half; n++) {
    const x = n * 0.5;
    const sinc = n === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const span = half + 1;
    const window = 0.42 + 0.5 * Math.cos((Math.PI * n) / span) + 0.08 * Math.cos((2 * Math.PI * n) / span);
    kernel[n + half] = sinc * window;
    sum += kernel[n + half];
  }
  for (let i = 0; i < TAPS; i++) kernel[i] /= sum;
  return kernel;
}

function decimate(source, kernel) {
  const n = source.length;
  const half = (kernel.length - 1) / 2;
  const out = new Float32Array(n >> 1);
  for (let i = 0; i < out.length; i++) {
    const centre = i * 2;
    let acc = 0;
    for (let k = 0; k < kernel.length; k++) {
      let j = centre + k - half;
      if (j < 0) j += n;
      else if (j >= n) j -= n;
      acc += source[j] * kernel[k];
    }
    out[i] = acc;
  }
  return out;
}

function makeFft(size) {
  const bits = Math.log2(size);
  const reverse = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    reverse[i] = r;
  }
  const cos = new Float64Array(size / 2);
  const sin = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / size);
    sin[i] = Math.sin((-2 * Math.PI * i) / size);
  }
  return (re, im) => {
    for (let i = 0; i < size; i++) {
      const j = reverse[i];
      if (j > i) {
        const tr = re[i];
        re[i] = re[j];
        re[j] = tr;
        const ti = im[i];
        im[i] = im[j];
        im[j] = ti;
      }
    }
    for (let len = 2; len <= size; len <<= 1) {
      const halfLen = len >> 1;
      const stride = size / len;
      for (let i = 0; i < size; i += len) {
        for (let k = 0; k < halfLen; k++) {
          const wr = cos[k * stride];
          const wi = sin[k * stride];
          const a = i + k;
          const b = a + halfLen;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  };
}

function print(samples, rate, seconds) {
  const columns = Math.max(1, Math.round(seconds * COLUMNS_PER_SECOND));
  const fft = makeFft(FFT_SIZE);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const power = new Float64Array(FFT_SIZE / 2);
  const hann = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
  const low = new Float64Array(BINS);
  const high = new Float64Array(BINS);
  const tilt = new Float64Array(BINS);
  const ratio = MAX_HZ / MIN_HZ;
  for (let b = 0; b < BINS; b++) {
    const loHz = MIN_HZ * Math.pow(ratio, b / BINS);
    const hiHz = MIN_HZ * Math.pow(ratio, (b + 1) / BINS);
    low[b] = (loHz * FFT_SIZE) / rate;
    high[b] = (hiHz * FFT_SIZE) / rate;
    tilt[b] = TILT_DB_PER_OCTAVE * Math.log2(Math.sqrt(loHz * hiHz) / MIN_HZ);
  }
  const decibels = new Float32Array(columns * BINS);
  const n = samples.length;
  for (let c = 0; c < columns; c++) {
    const centre = Math.round((c / COLUMNS_PER_SECOND) * rate);
    const start = centre - FFT_SIZE / 2;
    for (let i = 0; i < FFT_SIZE; i++) {
      let j = (start + i) % n;
      if (j < 0) j += n;
      re[i] = samples[j] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < FFT_SIZE / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];
    for (let b = 0; b < BINS; b++) {
      const lo = low[b];
      const hi = high[b];
      let value;
      if (hi - lo < 1.5) {
        const centreBin = Math.min(FFT_SIZE / 2 - 2, (lo + hi) * 0.5);
        const k = Math.floor(centreBin);
        const f = centreBin - k;
        value = power[k] * (1 - f) + power[k + 1] * f;
      } else {
        let sum = 0;
        let count = 0;
        const end = Math.min(FFT_SIZE / 2 - 1, Math.floor(hi));
        for (let k = Math.ceil(lo); k <= end; k++) {
          sum += power[k];
          count++;
        }
        value = count ? sum / count : power[Math.min(FFT_SIZE / 2 - 1, Math.round(lo))];
      }
      decibels[c * BINS + b] = 10 * Math.log10(value + 1e-10) + tilt[b];
    }
  }
  const sample = [];
  for (let i = 0; i < decibels.length; i += 7) sample.push(decibels[i]);
  sample.sort((a, b) => a - b);
  const top = sample[Math.floor(sample.length * 0.997)] ?? 0;
  const floor = top - RANGE_DB;
  const width = Math.ceil(columns / BANDS);
  const height = BINS * BANDS;
  const data = new Uint8Array(width * height);
  for (let c = 0; c < columns; c++) {
    const band = Math.floor(c / width);
    const x = c - band * width;
    for (let b = 0; b < BINS; b++) {
      const level = Math.min(1, Math.max(0, (decibels[c * BINS + b] - floor) / RANGE_DB));
      data[(band * BINS + b) * width + x] = Math.round(Math.pow(level, 1.1) * 255);
    }
  }
  return { data, width, height, columns, bins: BINS, bands: BANDS };
}

self.onmessage = (event) => {
  const { samples, sampleRate } = event.data;
  const loop = buildLoop(samples, sampleRate);
  const kernel = halfBandKernel();
  const levels = [loop];
  for (let i = 1; i < LEVEL_COUNT; i++) levels.push(decimate(levels[i - 1], kernel));
  const printLevel = levels[Math.min(PRINT_LEVEL, levels.length - 1)];
  const printRate = sampleRate / Math.pow(2, Math.min(PRINT_LEVEL, levels.length - 1));
  const period = loop.length / sampleRate;
  const plate = print(printLevel, printRate, period);
  self.postMessage(
    { levels, sampleRate, period, print: plate },
    [...levels.map((level) => level.buffer), plate.data.buffer],
  );
};
`;
