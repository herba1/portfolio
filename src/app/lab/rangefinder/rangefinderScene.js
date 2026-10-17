export const PHOTO = "/monovolt/abt5.webp";
export const NEAREST = 0.7;
export const DEPTH_W = 240;
export const DEPTH_H = 300;

const near = (metres) => NEAREST / metres;

const LAYERS = [
  { d: 4.4, shape: [["rect", 0.0, 0.31, 1.0, 1.0, 0.02]] },
  { d: 5.2, shape: [["rect", 0.0, 0.0, 1.0, 0.335, 0.012]] },
  { d: 4.0, shape: [["rect", 0.82, 0.34, 1.0, 0.5, 0.03]] },
  {
    d: 3.5,
    shape: [
      ["ellipse", 0.565, 0.43, 0.075, 0.1],
      ["ellipse", 0.565, 0.35, 0.042, 0.048],
      ["ellipse", 0.49, 0.405, 0.04, 0.045],
      ["ellipse", 0.6, 0.38, 0.045, 0.05],
    ],
  },
  {
    d: 3.3,
    shape: [
      ["ellipse", 0.18, 0.47, 0.085, 0.12],
      ["ellipse", 0.2, 0.39, 0.05, 0.06],
      ["ellipse", 0.245, 0.43, 0.045, 0.045],
    ],
  },
  {
    d: 3.2,
    shape: [
      ["ellipse", 0.39, 0.46, 0.065, 0.1],
      ["ellipse", 0.39, 0.39, 0.045, 0.05],
    ],
  },
  { d: 2.8, shape: [["ellipse", 0.83, 0.47, 0.075, 0.065]] },
  { d: 3.0, shape: [["rect", 0.34, 0.505, 0.78, 0.68, 0.015]] },
  {
    d: 2.05,
    shape: [
      ["ellipse", 0.28, 0.545, 0.08, 0.06],
      ["ellipse", 0.27, 0.66, 0.1, 0.09],
      ["ellipse", 0.2, 0.6, 0.06, 0.06],
    ],
  },
  { d: 1.6, shape: [["ellipse", 0.06, 0.6, 0.085, 0.11]] },
  {
    d: 1.55,
    shape: [
      ["ellipse", 0.46, 0.56, 0.07, 0.065],
      ["ellipse", 0.47, 0.8, 0.135, 0.24],
    ],
  },
  {
    d: 1.35,
    shape: [
      ["ellipse", 0.835, 0.57, 0.085, 0.1],
      ["ellipse", 0.83, 0.72, 0.13, 0.13],
      ["ellipse", 0.73, 0.535, 0.04, 0.04],
      ["ellipse", 0.7, 0.68, 0.05, 0.065],
      ["ellipse", 0.96, 0.6, 0.06, 0.15],
    ],
  },
  { d: 1.15, shape: [["ellipse", 0.455, 0.845, 0.05, 0.085]] },
  { d: 1.0, shape: [["ellipse", 0.02, 0.75, 0.05, 0.07]] },
  { d: 0.9, shape: [["ellipse", 0.9, 0.87, 0.135, 0.17]] },
  { d: 0.84, shape: [["ellipse", 0.17, 0.87, 0.18, 0.18]] },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function coverage(prim, u, v) {
  if (prim[0] === "rect") {
    const [, x0, y0, x1, y1, soft] = prim;
    const dx = Math.max(x0 - u, u - x1);
    const dy = Math.max(y0 - v, v - y1);
    return 1 - smooth(-soft, soft, Math.max(dx, dy));
  }
  const [, cx, cy, rx, ry] = prim;
  const r = Math.hypot((u - cx) / rx, (v - cy) / ry);
  return 1 - smooth(0.82, 1.12, r);
}

function coarseDepth(u, v) {
  let d = near(4.4);
  for (const layer of LAYERS) {
    let m = 0;
    for (const prim of layer.shape) m = Math.max(m, coverage(prim, u, v));
    if (m > 0) d += (near(layer.d) - d) * m;
  }
  return d;
}

export function buildDepth(img) {
  const W = DEPTH_W;
  const H = DEPTH_H;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const n = W * H;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i += 1) lum[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
  let depth = new Float32Array(n);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) depth[y * W + x] = coarseDepth((x + 0.5) / W, (y + 0.5) / H);
  }
  const R = 4;
  const sigmaS = 2 * 2.6 * 2.6;
  const sigmaI = 2 * 0.07 * 0.07;
  const spatial = [];
  for (let oy = -R; oy <= R; oy += 1) for (let ox = -R; ox <= R; ox += 1) spatial.push([ox, oy, Math.exp(-(ox * ox + oy * oy) / sigmaS)]);
  for (let pass = 0; pass < 2; pass += 1) {
    const next = new Float32Array(n);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = y * W + x;
        const c = lum[i];
        let acc = 0;
        let wsum = 0;
        for (const [ox, oy, ws] of spatial) {
          const xx = x + ox;
          const yy = y + oy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx;
          const dl = lum[j] - c;
          const w = ws * Math.exp(-(dl * dl) / sigmaI);
          acc += depth[j] * w;
          wsum += w;
        }
        next[i] = wsum > 1e-6 ? acc / wsum : depth[i];
      }
    }
    depth = next;
  }
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) bytes[i] = Math.round(clamp(depth[i], 0, 1) * 255);
  return { depth, bytes, width: W, height: H };
}

export function sampleDepth(map, u, v) {
  const { depth, width: W, height: H } = map;
  const x = clamp(u * W - 0.5, 0, W - 1.001);
  const y = clamp(v * H - 0.5, 0, H - 1.001);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * W + x0;
  const a = depth[i] + (depth[i + 1] - depth[i]) * fx;
  const b = depth[i + W] + (depth[i + W + 1] - depth[i + W]) * fx;
  return a + (b - a) * fy;
}

export function metresFor(u) {
  if (u <= 0.0001) return Infinity;
  return NEAREST / u;
}
