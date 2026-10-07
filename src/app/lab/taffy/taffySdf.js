export function computeFields(alpha, width, height, tiles) {
  const INF = 1e20;
  const field = new Float32Array(width * height);
  let longest = 0;
  for (const tile of tiles) longest = Math.max(longest, tile[2], tile[3]);
  const f = new Float64Array(longest);
  const v = new Uint16Array(longest);
  const z = new Float64Array(longest + 1);
  const outer = new Float64Array(width * height);
  const inner = new Float64Array(width * height);

  const pass = (grid, offset, stride, length) => {
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    f[0] = grid[offset];
    for (let q = 1, k = 0, s = 0; q < length; q += 1) {
      f[q] = grid[offset + q * stride];
      const q2 = q * q;
      do {
        const r = v[k];
        s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
      } while (s <= z[k] && --k > -1);
      k += 1;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    for (let q = 0, k = 0; q < length; q += 1) {
      while (z[k + 1] < q) k += 1;
      const r = v[k];
      const qr = q - r;
      grid[offset + q * stride] = f[r] + qr * qr;
    }
  };

  const transform = (grid, x0, y0, w, h) => {
    for (let x = x0; x < x0 + w; x += 1) pass(grid, y0 * width + x, width, h);
    for (let y = y0; y < y0 + h; y += 1) pass(grid, y * width + x0, 1, w);
  };

  for (const [x0, y0, w, h] of tiles) {
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) {
        const index = y * width + x;
        const a = alpha[index] / 255;
        if (a <= 0) {
          outer[index] = INF;
          inner[index] = 0;
        } else if (a >= 1) {
          outer[index] = 0;
          inner[index] = INF;
        } else {
          const d = 0.5 - a;
          outer[index] = d > 0 ? d * d : 0;
          inner[index] = d < 0 ? d * d : 0;
        }
      }
    }
    transform(outer, x0, y0, w, h);
    transform(inner, x0, y0, w, h);
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) {
        const index = y * width + x;
        field[index] = Math.sqrt(outer[index]) - Math.sqrt(inner[index]);
      }
    }
  }
  return field;
}

export function encodeField(field, width, height) {
  const scratch = new Float32Array(1);
  const bits = new Uint32Array(scratch.buffer);
  const toHalf = (value) => {
    scratch[0] = value;
    const x = bits[0];
    const sign = (x >>> 16) & 0x8000;
    const exponent = ((x >>> 23) & 0xff) - 112;
    const mantissa = x & 0x7fffff;
    if (exponent <= 0) {
      if (exponent < -10) return sign;
      return sign | (((mantissa | 0x800000) >>> (1 - exponent)) + 0x1000) >>> 13;
    }
    if (exponent >= 31) return sign | 0x7bff;
    return sign | Math.min(0x7bff, (exponent << 10) + ((mantissa + 0x1000) >>> 13));
  };
  const half = new Uint16Array(width * height);
  for (let i = 0; i < half.length; i += 1) half[i] = toHalf(field[i]);
  const coarseWidth = (width + 1) >> 1;
  const coarseHeight = (height + 1) >> 1;
  const coarse = new Int16Array(coarseWidth * coarseHeight);
  for (let y = 0; y < coarseHeight; y += 1) {
    const source = y * 2 * width;
    const target = y * coarseWidth;
    for (let x = 0; x < coarseWidth; x += 1) {
      const value = Math.round(field[source + x * 2] * 8);
      coarse[target + x] = value > 32767 ? 32767 : value < -32767 ? -32767 : value;
    }
  }
  return { half, coarse, coarseWidth, coarseHeight };
}

function workerSource() {
  return [
    `const computeFields = ${computeFields.toString()};`,
    `const encodeField = ${encodeField.toString()};`,
    "self.onmessage = (event) => {",
    "  const { id, alpha, width, height, tiles } = event.data;",
    "  try {",
    "    const encoded = encodeField(computeFields(alpha, width, height, tiles), width, height);",
    "    self.postMessage({ id, encoded }, [encoded.half.buffer, encoded.coarse.buffer]);",
    "  } catch (error) {",
    "    self.postMessage({ id, error: String(error) });",
    "  }",
    "};",
  ].join("\n");
}

const idle = (callback) => {
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(callback, { timeout: 120 });
  else window.setTimeout(callback, 16);
};

export function createFieldBuilder() {
  let worker = null;
  let url = null;
  let nextId = 1;
  const pending = new Map();

  const runOnMainThread = (job) =>
    new Promise((resolve) => {
      idle(() => resolve(encodeField(computeFields(job.alpha, job.width, job.height, job.tiles), job.width, job.height)));
    });

  const failWorker = () => {
    const jobs = [...pending.values()];
    pending.clear();
    worker?.terminate();
    worker = null;
    for (const { job, resolve, reject } of jobs) runOnMainThread(job).then(resolve, reject);
  };

  try {
    url = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
    worker = new Worker(url);
    worker.onmessage = (event) => {
      const { id, encoded, error } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (error) runOnMainThread(entry.job).then(entry.resolve, entry.reject);
      else entry.resolve(encoded);
    };
    worker.onerror = failWorker;
  } catch {
    worker = null;
  }

  return {
    build(job) {
      if (!worker) return runOnMainThread(job);
      return new Promise((resolve, reject) => {
        const id = nextId;
        nextId += 1;
        pending.set(id, { job, resolve, reject });
        worker.postMessage({ id, alpha: job.alpha, width: job.width, height: job.height, tiles: job.tiles });
      });
    },
    dispose() {
      pending.clear();
      worker?.terminate();
      worker = null;
      if (url) URL.revokeObjectURL(url);
      url = null;
    },
  };
}
