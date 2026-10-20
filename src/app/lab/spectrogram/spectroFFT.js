export function createSpectrum(size) {
  const bits = Math.log2(size);
  const rev = new Uint32Array(size);
  for (let i = 0; i < size; i += 1) {
    let r = 0;
    for (let b = 0; b < bits; b += 1) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(size / 2);
  const sin = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i += 1) {
    cos[i] = Math.cos((-2 * Math.PI * i) / size);
    sin[i] = Math.sin((-2 * Math.PI * i) / size);
  }
  const win = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    const x = i / size;
    win[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * x) + 0.08 * Math.cos(4 * Math.PI * x);
  }
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const ring = new Float32Array(size);
  const out = new Float32Array(size / 2);
  let head = 0;

  return {
    write(samples, count) {
      for (let i = 0; i < count; i += 1) {
        ring[head] = samples[i];
        head = (head + 1) % size;
      }
    },
    compute() {
      for (let i = 0; i < size; i += 1) {
        const v = ring[(head + i) % size] * win[i];
        const j = rev[i];
        re[j] = v;
        im[j] = 0;
      }
      for (let len = 2; len <= size; len <<= 1) {
        const half = len >> 1;
        const stride = size / len;
        for (let i = 0; i < size; i += len) {
          for (let k = 0; k < half; k += 1) {
            const wr = cos[k * stride];
            const wi = sin[k * stride];
            const a = i + k;
            const b = a + half;
            const tr = re[b] * wr - im[b] * wi;
            const ti = re[b] * wi + im[b] * wr;
            re[b] = re[a] - tr;
            im[b] = im[a] - ti;
            re[a] += tr;
            im[a] += ti;
          }
        }
      }
      for (let k = 0; k < size / 2; k += 1) {
        const mag = Math.hypot(re[k], im[k]) / size;
        out[k] = mag > 1e-12 ? 20 * Math.log10(mag) : -240;
      }
      return out;
    },
  };
}
