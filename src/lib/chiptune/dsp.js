export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

// Spectral flux in a handful of bands, one value per hop. Bands are [lo, hi)
// in Hz; flux is the positive change of log-compressed magnitude, so a loud
// sustained note reads as nothing and a hit reads as a spike.
export function bandFlux(mono, rate, hop, bands, size = 1024) {
  const n = Math.max(1, Math.floor(mono.length / hop));
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const win = Float32Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  const half = size / 2;
  const prev = new Float32Array(half);
  const mag = new Float32Array(half);
  const binHz = rate / size;
  const ranges = bands.map(([lo, hi]) => [Math.max(1, Math.round(lo / binHz)), Math.min(half - 1, Math.round(hi / binHz))]);
  const out = bands.map(() => new Float32Array(n));
  for (let f = 0; f < n; f += 1) {
    const c = f * hop - half;
    for (let i = 0; i < size; i += 1) {
      const k = c + i;
      re[i] = k >= 0 && k < mono.length ? mono[k] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < half; k += 1) mag[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
    ranges.forEach(([a, b], bi) => {
      let s = 0;
      for (let k = a; k <= b; k += 1) {
        const d = mag[k] - prev[k];
        if (d > 0) s += d;
      }
      // Until the previous window lies wholly inside the clip, the rise is the
      // zero padding ending, not an onset (a clip cut mid-song would open on a spike).
      out[bi][f] = (f - 1) * hop < half ? 0 : s / (b - a + 1);
    });
    prev.set(mag);
  }
  return out;
}

export function percentile(arr, q) {
  if (!arr.length) return 0;
  const s = Float32Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
}

// Subtract a moving average so slow swells don't read as onsets.
export function detrend(x, radius) {
  const out = new Float32Array(x.length);
  let sum = 0;
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < x.length; i += 1) {
    for (; hi < x.length && hi <= i + radius; hi += 1) sum += x[hi];
    for (; lo < i - radius; lo += 1) sum -= x[lo];
    out[i] = Math.max(0, x[i] - sum / (hi - lo));
  }
  return out;
}
