export function createFFT(size) {
  const levels = Math.round(Math.log2(size));
  if (1 << levels !== size) {
    throw new Error(`FFT size must be a power of two, got ${size}`);
  }

  const half = size >> 1;
  const cosTable = new Float64Array(half);
  const sinTable = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    cosTable[i] = Math.cos((2 * Math.PI * i) / size);
    sinTable[i] = Math.sin((2 * Math.PI * i) / size);
  }

  const bitReversed = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    let value = i;
    let reversed = 0;
    for (let bit = 0; bit < levels; bit++) {
      reversed = (reversed << 1) | (value & 1);
      value >>>= 1;
    }
    bitReversed[i] = reversed >>> 0;
  }

  function forward(re, im) {
    for (let i = 0; i < size; i++) {
      const j = bitReversed[i];
      if (j > i) {
        let swap = re[i];
        re[i] = re[j];
        re[j] = swap;
        swap = im[i];
        im[i] = im[j];
        im[j] = swap;
      }
    }

    for (let span = 1; span < size; span <<= 1) {
      const step = size / (span << 1);
      for (let start = 0; start < size; start += span << 1) {
        for (let i = start, k = 0; i < start + span; i++, k += step) {
          const j = i + span;
          const c = cosTable[k];
          const s = sinTable[k];
          const tre = re[j] * c + im[j] * s;
          const tim = -re[j] * s + im[j] * c;
          re[j] = re[i] - tre;
          im[j] = im[i] - tim;
          re[i] += tre;
          im[i] += tim;
        }
      }
    }
  }

  function inverse(re, im) {
    forward(im, re);
    const scale = 1 / size;
    for (let i = 0; i < size; i++) {
      re[i] *= scale;
      im[i] *= scale;
    }
  }

  return { size, forward, inverse };
}
