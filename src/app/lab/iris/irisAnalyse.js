const SCALES = [
  { r0: 2, r1: 4, core: 0, sigma: 1.0 },
  { r0: 3, r1: 5, core: 0, sigma: 1.3 },
  { r0: 5, r1: 8, core: 1, sigma: 2.0 },
  { r0: 8, r1: 12, core: 1, sigma: 3.0 },
];
const RING = 16;
const MAX_LIGHTS = 240;

const toLinear = (c) => Math.pow(c / 255, 2.2);
const toByte = (c) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, c)), 1 / 2.2));
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function ellipse(u, v, cx, cy, rx, ry, soft) {
  const d = Math.hypot((u - cx) / rx, (v - cy) / ry);
  return 1 - smooth(1 - soft, 1 + soft, d);
}

export function depthAt(u, v) {
  const dx = u - 0.51;
  const dy = (v - 0.385) * 1.3;
  const rr = Math.hypot(dx, dy);
  let far = 1 - 0.42 * smooth(0, 0.62, rr);
  far = Math.min(1, far + 0.08 * smooth(0.36, 0.5, v));
  let near = 0;
  near = Math.max(near, ellipse(u, v, 0.2, 0.79, 0.3, 0.37, 0.12));
  near = Math.max(near, ellipse(u, v, 0.255, 0.445, 0.095, 0.08, 0.3));
  near = Math.max(near, ellipse(u, v, 0.8, 0.83, 0.33, 0.3, 0.12));
  near = Math.max(near, ellipse(u, v, 0.78, 0.545, 0.125, 0.095, 0.3));
  near = Math.max(near, smooth(0.86, 0.94, v));
  const desk = ellipse(u, v, 0.52, 0.75, 0.13, 0.14, 0.3) * 0.75;
  let d = far * (1 - near) + 0.1 * near;
  d = d * (1 - desk) + 0.3 * desk;
  return d;
}

export function analysePhoto(img) {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H);
  const px = data.data;
  const n = W * H;
  const lin = new Float32Array(n * 3);
  const L = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const r = toLinear(px[i * 4]);
    const g = toLinear(px[i * 4 + 1]);
    const b = toLinear(px[i * 4 + 2]);
    lin[i * 3] = r;
    lin[i * 3 + 1] = g;
    lin[i * 3 + 2] = b;
    L[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  const ringOffsets = SCALES.map(({ r0, r1 }) => {
    const pts = [];
    for (let k = 0; k < RING; k += 1) {
      const t = (k / RING) * Math.PI * 2;
      pts.push([Math.round(Math.cos(t) * r0), Math.round(Math.sin(t) * r0)]);
      pts.push([Math.round(Math.cos(t) * r1), Math.round(Math.sin(t) * r1)]);
    }
    return pts;
  });

  const candidates = [];
  for (let y = 2; y < H - 2; y += 1) {
    for (let x = 2; x < W - 2; x += 1) {
      const i = y * W + x;
      const c = L[i];
      if (c < 0.2) continue;
      let peak = true;
      for (let oy = -1; oy <= 1 && peak; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (L[i + oy * W + ox] > c) {
            peak = false;
            break;
          }
        }
      }
      if (peak) candidates.push(i);
    }
  }
  candidates.sort((a, b) => L[b] - L[a]);

  const taken = new Uint8Array(n);
  const lights = [];
  const sample = (x, y) => L[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  for (const i of candidates) {
    if (taken[i]) continue;
    const x = i % W;
    const y = (i - x) / W;
    let found = -1;
    let ringMean = 0;
    for (let s = 0; s < SCALES.length; s += 1) {
      const { core } = SCALES[s];
      let coreSum = 0;
      let coreN = 0;
      for (let oy = -core; oy <= core; oy += 1) {
        for (let ox = -core; ox <= core; ox += 1) {
          coreSum += sample(x + ox, y + oy);
          coreN += 1;
        }
      }
      const coreMean = coreSum / coreN;
      const vals = ringOffsets[s].map(([ox, oy]) => sample(x + ox, y + oy)).sort((a, b) => a - b);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const hi = vals[Math.floor(vals.length * 0.85)];
      if (hi < 0.72 * coreMean && mean < 0.55 * coreMean) {
        found = s;
        ringMean = mean;
        break;
      }
    }
    if (found < 0) continue;
    const { r0, sigma } = SCALES[found];
    let energy = 0;
    const rr = r0 + 1;
    for (let oy = -rr; oy <= rr; oy += 1) {
      for (let ox = -rr; ox <= rr; ox += 1) {
        const xx = x + ox;
        const yy = y + oy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        const d = Math.hypot(ox, oy);
        if (d <= r0) taken[j] = 1;
        const w = 1 - smooth(r0 * 0.6, rr + 0.5, d);
        const excess = Math.max(0, L[j] - ringMean) * w;
        energy += excess;
        if (w > 0 && L[j] > ringMean) {
          const k = (ringMean + (L[j] - ringMean) * (1 - w)) / L[j];
          lin[j * 3] *= k;
          lin[j * 3 + 1] *= k;
          lin[j * 3 + 2] *= k;
          L[j] *= k;
        }
      }
    }
    if (energy < 0.6) continue;
    lights.push({ u: (x + 0.5) / W, v: (y + 0.5) / H, energy, sigma });
    if (lights.length >= MAX_LIGHTS) break;
  }

  const out = ctx.createImageData(W, H);
  for (let i = 0; i < n; i += 1) {
    out.data[i * 4] = toByte(lin[i * 3]);
    out.data[i * 4 + 1] = toByte(lin[i * 3 + 1]);
    out.data[i * 4 + 2] = toByte(lin[i * 3 + 2]);
    out.data[i * 4 + 3] = 255;
  }

  const DW = 120;
  const DH = Math.round((DW * H) / W);
  const depth = new Uint8Array(DW * DH);
  for (let y = 0; y < DH; y += 1) {
    for (let x = 0; x < DW; x += 1) {
      depth[y * DW + x] = Math.round(255 * depthAt((x + 0.5) / DW, (y + 0.5) / DH));
    }
  }

  let seed = 1013;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const instances = new Float32Array(lights.length * 8);
  lights.forEach((l, k) => {
    const o = k * 8;
    instances[o] = l.u;
    instances[o + 1] = l.v;
    instances[o + 2] = l.energy;
    instances[o + 3] = depthAt(l.u, l.v);
    instances[o + 4] = l.sigma;
    instances[o + 5] = rand();
    instances[o + 6] = rand();
    instances[o + 7] = 0;
  });

  return { width: W, height: H, base: out, depth, depthW: DW, depthH: DH, lights: instances, count: lights.length };
}
