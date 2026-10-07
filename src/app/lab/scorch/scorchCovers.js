const SAMPLE = 64;
const SPOT_LIMIT = 12;
const SPOT_SPACING = 0.14;
const BLUR_RADIUS = 2;
const QUIET_CORNER = 0.3;
const QUIET_INSET = 0.06;
const QUIET_EDGE_PULL = 0.4;
const QUIET_FALLBACK = { u: 0.12, v: 0.1 };

const fallbackAnalysis = () => ({ lo: 0.1, hi: 0.7, spots: [], quiet: QUIET_FALLBACK, fuel: null });

function rawFuel(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const top = Math.max(r, g, b);
  const saturation = top > 0 ? (top - Math.min(r, g, b)) / top : 0;
  return 0.7 * (1 - lum) + 0.3 * saturation;
}

export function cropFor(width, height) {
  const side = Math.min(width, height);
  const sx = (width - side) / 2;
  const sy = height > width ? height - side : (height - side) / 2;
  return {
    sx,
    sy,
    side,
    uv: [side / width, side / height, sx / width, (height - sy - side) / height],
  };
}

function analyse(image, crop) {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, crop.sx, crop.sy, crop.side, crop.side, 0, 0, SAMPLE, SAMPLE);
  const { data } = context.getImageData(0, 0, SAMPLE, SAMPLE);
  const raw = new Float32Array(SAMPLE * SAMPLE);
  for (let index = 0; index < raw.length; index += 1) {
    raw[index] = rawFuel(data[index * 4], data[index * 4 + 1], data[index * 4 + 2]);
  }
  const sorted = Float32Array.from(raw).sort();
  const lo = sorted[Math.floor(sorted.length * 0.12)];
  const hi = sorted[Math.floor(sorted.length * 0.94)];
  const span = Math.max(0.08, hi - lo);
  const fuel = new Float32Array(SAMPLE * SAMPLE);
  for (let index = 0; index < raw.length; index += 1) {
    fuel[index] = Math.min(1, Math.max(0, (raw[index] - lo) / span));
  }
  const blurred = new Float32Array(SAMPLE * SAMPLE);
  for (let y = 0; y < SAMPLE; y += 1) {
    for (let x = 0; x < SAMPLE; x += 1) {
      let total = 0;
      let count = 0;
      for (let dy = -BLUR_RADIUS; dy <= BLUR_RADIUS; dy += 1) {
        for (let dx = -BLUR_RADIUS; dx <= BLUR_RADIUS; dx += 1) {
          const sx = x + dx;
          const sy = y + dy;
          if (sx < 0 || sy < 0 || sx >= SAMPLE || sy >= SAMPLE) continue;
          total += fuel[sy * SAMPLE + sx];
          count += 1;
        }
      }
      blurred[y * SAMPLE + x] = total / count;
    }
  }
  const ranked = Array.from(blurred, (value, index) => ({ value, index }))
    .filter((entry) => {
      const x = entry.index % SAMPLE;
      const y = Math.floor(entry.index / SAMPLE);
      return x > 3 && y > 3 && x < SAMPLE - 4 && y < SAMPLE - 4;
    })
    .sort((a, b) => b.value - a.value);
  const spots = [];
  for (const entry of ranked) {
    if (spots.length >= SPOT_LIMIT) break;
    const u = ((entry.index % SAMPLE) + 0.5) / SAMPLE;
    const v = 1 - (Math.floor(entry.index / SAMPLE) + 0.5) / SAMPLE;
    if (spots.some((spot) => Math.hypot(spot.u - u, spot.v - v) < SPOT_SPACING)) continue;
    spots.push({ u, v, fuel: entry.value });
  }
  return { lo, hi, spots, quiet: quietCorner(blurred), fuel: blurred };
}

function quietCorner(blurred) {
  let best = QUIET_FALLBACK;
  let bestScore = Infinity;
  for (let y = 0; y < SAMPLE; y += 1) {
    const v = 1 - (y + 0.5) / SAMPLE;
    if (v >= QUIET_CORNER || v < QUIET_INSET) continue;
    for (let x = 0; x < SAMPLE; x += 1) {
      const u = (x + 0.5) / SAMPLE;
      if (u >= QUIET_CORNER || u < QUIET_INSET) continue;
      const score = blurred[y * SAMPLE + x] + QUIET_EDGE_PULL * Math.min(u, v);
      if (score < bestScore) {
        bestScore = score;
        best = { u, v };
      }
    }
  }
  return best;
}

export function loadCover(cover) {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      const finish = () => {
        if (!image.naturalWidth || !image.naturalHeight) {
          resolve(null);
          return;
        }
        const crop = cropFor(image.naturalWidth, image.naturalHeight);
        let analysis = fallbackAnalysis();
        try {
          analysis = analyse(image, crop);
        } catch {
          analysis = fallbackAnalysis();
        }
        resolve({ cover, image, crop: crop.uv, ...analysis });
      };
      if (typeof image.decode === "function") image.decode().then(finish, finish);
      else finish();
    };
    image.onerror = () => resolve(null);
    image.src = cover.image;
  });
}

export function fuelAt(analysis, u, v) {
  if (!analysis?.fuel) return 0.5;
  const x = Math.min(SAMPLE - 1, Math.max(0, Math.floor(u * SAMPLE)));
  const y = Math.min(SAMPLE - 1, Math.max(0, Math.floor((1 - v) * SAMPLE)));
  return analysis.fuel[y * SAMPLE + x];
}
