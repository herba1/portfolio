export function buildFields(alpha, width, height, tiles) {
  const INF = 1e20;
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

  let longest = 0;
  let largest = 0;
  for (const tile of tiles) {
    longest = Math.max(longest, tile[2], tile[3]);
    largest = Math.max(largest, tile[2] * tile[3]);
  }
  const f = new Float64Array(longest);
  const v = new Int32Array(longest);
  const z = new Float64Array(longest + 1);
  const outer = new Float32Array(largest);
  const inner = new Float32Array(largest);
  const half = new Uint16Array(width * height);
  const coarseWidth = (width + 1) >> 1;
  const coarseHeight = (height + 1) >> 1;
  const coarse = new Int16Array(coarseWidth * coarseHeight);

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

  for (const [x0, y0, w, h] of tiles) {
    for (let y = 0; y < h; y += 1) {
      const row = (y0 + y) * width + x0;
      for (let x = 0; x < w; x += 1) {
        const local = y * w + x;
        const a = alpha[row + x] / 255;
        if (a <= 0) {
          outer[local] = INF;
          inner[local] = 0;
        } else if (a >= 1) {
          outer[local] = 0;
          inner[local] = INF;
        } else {
          const d = 0.5 - a;
          outer[local] = d > 0 ? d * d : 0;
          inner[local] = d < 0 ? d * d : 0;
        }
      }
    }
    for (let x = 0; x < w; x += 1) {
      pass(outer, x, w, h);
      pass(inner, x, w, h);
    }
    for (let y = 0; y < h; y += 1) {
      pass(outer, y * w, 1, w);
      pass(inner, y * w, 1, w);
    }
    for (let y = 0; y < h; y += 1) {
      const gy = y0 + y;
      const row = gy * width;
      const evenRow = (gy & 1) === 0;
      const coarseRow = (gy >> 1) * coarseWidth;
      for (let x = 0; x < w; x += 1) {
        const local = y * w + x;
        const gx = x0 + x;
        const d = Math.sqrt(outer[local]) - Math.sqrt(inner[local]);
        half[row + gx] = toHalf(d);
        if (evenRow && (gx & 1) === 0) {
          const value = Math.round(d * 8);
          coarse[coarseRow + (gx >> 1)] = value > 32767 ? 32767 : value < -32767 ? -32767 : value;
        }
      }
    }
  }
  return { half, coarse, coarseWidth, coarseHeight };
}

function workerSource() {
  return [
    `const buildFields = ${buildFields.toString()};`,
    "self.onmessage = (event) => {",
    "  const { id, alpha, width, height, tiles } = event.data;",
    "  try {",
    "    const encoded = buildFields(alpha, width, height, tiles);",
    "    self.postMessage({ id, encoded }, [encoded.half.buffer, encoded.coarse.buffer]);",
    "  } catch (error) {",
    "    self.postMessage({ id, error: String(error), alpha }, [alpha.buffer]);",
    "  }",
    "};",
  ].join("\n");
}

const idle = (callback) => {
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(callback, { timeout: 120 });
  else window.setTimeout(callback, 16);
};

export const BUILDER_DISPOSED = "taffy field builder disposed";

export function createFieldBuilder() {
  let worker = null;
  let url = null;
  let nextId = 1;
  let disposed = false;
  const pending = new Map();

  const runOnMainThread = (job) =>
    new Promise((resolve, reject) => {
      idle(() => {
        if (disposed) {
          reject(new Error(BUILDER_DISPOSED));
          return;
        }
        try {
          resolve(buildFields(job.alpha, job.width, job.height, job.tiles));
        } catch (error) {
          reject(error);
        }
      });
    });

  const failWorker = () => {
    const jobs = [...pending.values()];
    pending.clear();
    worker?.terminate();
    worker = null;
    for (const { reject } of jobs) reject(new Error("taffy field worker failed"));
  };

  try {
    url = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
    worker = new Worker(url);
    worker.onmessage = (event) => {
      const { id, encoded, error, alpha } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (error) runOnMainThread({ ...entry.job, alpha }).then(entry.resolve, entry.reject);
      else entry.resolve(encoded);
    };
    worker.onerror = failWorker;
  } catch {
    worker = null;
  }

  return {
    build(job) {
      if (disposed) return Promise.reject(new Error(BUILDER_DISPOSED));
      if (!worker) return runOnMainThread(job);
      return new Promise((resolve, reject) => {
        const id = nextId;
        nextId += 1;
        pending.set(id, { job: { width: job.width, height: job.height, tiles: job.tiles }, resolve, reject });
        worker.postMessage({ id, alpha: job.alpha, width: job.width, height: job.height, tiles: job.tiles }, [job.alpha.buffer]);
      });
    },
    dispose() {
      disposed = true;
      const jobs = [...pending.values()];
      pending.clear();
      worker?.terminate();
      worker = null;
      if (url) URL.revokeObjectURL(url);
      url = null;
      for (const { reject } of jobs) reject(new Error(BUILDER_DISPOSED));
    },
  };
}
