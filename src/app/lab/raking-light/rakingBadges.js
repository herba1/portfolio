import { albumById } from "@/app/lab/_music/catalog";

export const CELL = 640;

const KIND_HARD = 85;
const KIND_SATIN = 170;

const PIN = { w: 520, h: 520, r: 64 };
const PATCH = { w: 600, h: 404, r: 40 };
const BUTTON = { d: 600 };

export const BADGES = [
  { key: "revolver", album: albumById("revolver"), detail: "Enamel pin", widthMm: 50, heightMm: 50, cellW: PIN.w, tilt: -0.06, dy: -3 },
  { key: "magical-mystery-tour", album: albumById("magical-mystery-tour"), detail: "Embroidered patch", widthMm: 96, heightMm: (96 * PATCH.h) / PATCH.w, cellW: PATCH.w, tilt: 0.02, dy: 0 },
  { key: "sgt-pepper", album: albumById("sgt-pepper"), detail: "Embroidered patch", widthMm: 58, heightMm: 58, cellW: BUTTON.d, tilt: 0.08, dy: 4 },
];

const N = CELL * CELL;
const C = CELL / 2;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function canvas2d() {
  const c = document.createElement("canvas");
  c.width = CELL;
  c.height = CELL;
  return c.getContext("2d", { willReadFrequently: true });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`cover failed: ${src}`));
    img.src = src;
  });
}

function blur(src, radius) {
  if (radius < 0.5) return src.slice();
  const r = Math.max(1, Math.round(radius));
  const a = src.slice();
  const b = new Float32Array(N);
  const norm = 1 / (2 * r + 1);
  for (let pass = 0; pass < 2; pass += 1) {
    for (let y = 0; y < CELL; y += 1) {
      let acc = 0;
      const row = y * CELL;
      for (let x = -r; x <= r; x += 1) acc += a[row + Math.min(CELL - 1, Math.max(0, x))];
      for (let x = 0; x < CELL; x += 1) {
        b[row + x] = acc * norm;
        acc += a[row + Math.min(CELL - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < CELL; x += 1) {
      let acc = 0;
      for (let y = -r; y <= r; y += 1) acc += b[Math.min(CELL - 1, Math.max(0, y)) * CELL + x];
      for (let y = 0; y < CELL; y += 1) {
        a[y * CELL + x] = acc * norm;
        acc += b[Math.min(CELL - 1, y + r + 1) * CELL + x] - b[Math.max(0, y - r) * CELL + x];
      }
    }
  }
  return a;
}

function sdRoundRect(x, y, hw, hh, r) {
  const qx = Math.abs(x) - hw + r;
  const qy = Math.abs(y) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function angleCode(theta) {
  const t = ((theta % Math.PI) + Math.PI) % Math.PI;
  return 1 + Math.round((t / Math.PI) * 253);
}

function drawCover(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh, clip) {
  ctx.save();
  clip(ctx);
  ctx.clip();
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx * img.naturalWidth, sy * img.naturalHeight, sw * img.naturalWidth, sh * img.naturalHeight, dx, dy, dw, dh);
  ctx.restore();
}

function lumaOf(ctx) {
  const px = ctx.getImageData(0, 0, CELL, CELL).data;
  const out = new Float32Array(N);
  for (let i = 0; i < N; i += 1) out[i] = (px[i * 4] * 0.2126 + px[i * 4 + 1] * 0.7152 + px[i * 4 + 2] * 0.0722) / 255;
  return out;
}

function sobel(lum) {
  const gx = new Float32Array(N);
  const gy = new Float32Array(N);
  for (let y = 1; y < CELL - 1; y += 1) {
    for (let x = 1; x < CELL - 1; x += 1) {
      const i = y * CELL + x;
      const tl = lum[i - CELL - 1];
      const t = lum[i - CELL];
      const tr = lum[i - CELL + 1];
      const l = lum[i - 1];
      const r = lum[i + 1];
      const bl = lum[i + CELL - 1];
      const b = lum[i + CELL];
      const br = lum[i + CELL + 1];
      gx[i] = (tr + 2 * r + br - tl - 2 * l - bl) / 8;
      gy[i] = (bl + 2 * b + br - tl - 2 * t - tr) / 8;
    }
  }
  return [gx, gy];
}

function pack(albedo, height, layers) {
  const mat = new Uint8Array(N * 4);
  for (let i = 0; i < N; i += 1) {
    for (const layer of layers) {
      const w = layer.mask[i];
      if (w < 0.02) continue;
      mat[i * 4] = layer.metal ? 255 : 0;
      mat[i * 4 + 1] = Math.round(layer.gloss * 255);
      mat[i * 4 + 2] = layer.angle ? layer.angle[i] : 0;
      mat[i * 4 + 3] = layer.kind;
    }
  }
  return { albedo: albedo.canvas, height, mat };
}

function dilate(src, r) {
  return blur(src, r).map((v) => (v > 0.22 ? 1 : v / 0.22));
}

function enamelPin(img) {
  const hw = PIN.w / 2;
  const hh = PIN.h / 2;
  const rim = 16;
  const face = (c) => {
    c.beginPath();
    c.roundRect(C - hw + rim, C - hh + rim, PIN.w - rim * 2, PIN.h - rim * 2, PIN.r - rim);
  };
  const src = canvas2d();
  src.fillStyle = "#fff";
  src.fillRect(0, 0, CELL, CELL);
  drawCover(src, img, 0, 0, 1, 1, C - hw + rim, C - hh + rim, PIN.w - rim * 2, PIN.h - rim * 2, face);
  const lum = lumaOf(src);
  const fine = blur(lum, 0.6);
  const local = blur(lum, 7);
  const raw = new Float32Array(N);
  for (let i = 0; i < N; i += 1) raw[i] = Math.max(smooth(0.035, 0.11, local[i] - fine[i]), smooth(0.42, 0.26, fine[i]));
  const lines = dilate(raw, 1);

  const al = canvas2d();
  const out = al.createImageData(CELL, CELL);
  const metal = new Float32Array(N);
  const enamel = new Float32Array(N);
  const plate = new Float32Array(N);
  const nickel = [44, 46, 52];
  const white = [246, 244, 238];
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const i = y * CELL + x;
      const d = sdRoundRect(x + 0.5 - C, y + 0.5 - C, hw, hh, PIN.r);
      const inside = clamp01(0.5 - d);
      const onFace = clamp01(-d - rim + 0.5);
      const m = Math.max(1 - onFace, onFace * lines[i]);
      plate[i] = inside;
      metal[i] = inside * m;
      enamel[i] = inside * (1 - m);
      for (let k = 0; k < 3; k += 1) out.data[i * 4 + k] = Math.round(nickel[k] * m + white[k] * (1 - m));
      out.data[i * 4 + 3] = Math.round(inside * 255);
    }
  }
  al.putImageData(out, 0, 0);
  const pB = blur(plate, 3);
  const mB = blur(metal, 0.8);
  const height = new Float32Array(N);
  for (let i = 0; i < N; i += 1) height[i] = 6 * pB[i] + 2.2 * mB[i] - 0.6 * enamel[i] * (1 - mB[i]);
  return pack(al, height, [
    { mask: enamel, metal: false, gloss: 0.95, kind: KIND_HARD },
    { mask: metal, metal: true, gloss: 0.9, kind: KIND_HARD },
  ]);
}

function threads(px, inside, count) {
  const samples = [];
  for (let i = 0; i < N; i += 7) {
    if (inside[i] < 0.9) continue;
    samples.push([px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]);
  }
  const lumOf = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  const gap = (c, m) => (c[0] - m[0]) ** 2 * 0.9 + (c[1] - m[1]) ** 2 * 1.2 + (c[2] - m[2]) ** 2 * 0.8;
  const sorted = samples.slice().sort((a, b) => lumOf(a) - lumOf(b));
  const centres = [sorted[Math.floor(sorted.length / 2)].slice()];
  const near = samples.map((c) => gap(c, centres[0]));
  while (centres.length < count) {
    let far = 0;
    for (let j = 1; j < samples.length; j += 1) if (near[j] > near[far]) far = j;
    centres.push(samples[far].slice());
    samples.forEach((c, j) => {
      near[j] = Math.min(near[j], gap(c, centres[centres.length - 1]));
    });
  }
  const assign = new Int32Array(samples.length);
  for (let iter = 0; iter < 10; iter += 1) {
    const sum = centres.map(() => [0, 0, 0, 0]);
    samples.forEach((c, j) => {
      let best = 0;
      let bd = Infinity;
      centres.forEach((m, k) => {
        const d = (c[0] - m[0]) ** 2 * 0.9 + (c[1] - m[1]) ** 2 * 1.2 + (c[2] - m[2]) ** 2 * 0.8;
        if (d < bd) {
          bd = d;
          best = k;
        }
      });
      assign[j] = best;
      sum[best][0] += c[0];
      sum[best][1] += c[1];
      sum[best][2] += c[2];
      sum[best][3] += 1;
    });
    sum.forEach((acc, k) => {
      if (acc[3]) centres[k] = [acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3]];
    });
  }
  return centres.map((c) => {
    const l = lumOf(c);
    return c.map((v) => Math.max(0, Math.min(255, 255 * Math.pow(Math.max(0, l + (v - l) * 1.28) / 255, 0.86))));
  });
}

function labelsOf(px, palette) {
  const label = new Uint8Array(N);
  for (let i = 0; i < N; i += 1) {
    let best = 0;
    let bd = Infinity;
    for (let k = 0; k < palette.length; k += 1) {
      const m = palette[k];
      const d = (px[i * 4] - m[0]) ** 2 * 0.9 + (px[i * 4 + 1] - m[1]) ** 2 * 1.2 + (px[i * 4 + 2] - m[2]) ** 2 * 0.8;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    label[i] = best;
  }
  return label;
}

function majority(label, count, r) {
  const out = new Uint8Array(N);
  const hist = new Int32Array(count);
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      hist.fill(0);
      for (let dy = -r; dy <= r; dy += 1) {
        const yy = Math.min(CELL - 1, Math.max(0, y + dy));
        for (let dx = -r; dx <= r; dx += 1) hist[label[yy * CELL + Math.min(CELL - 1, Math.max(0, x + dx))]] += 1;
      }
      let best = label[y * CELL + x];
      for (let k = 0; k < count; k += 1) if (hist[k] > hist[best]) best = k;
      out[y * CELL + x] = best;
    }
  }
  return out;
}

function embroider(img, { crop, sdf, count, edge, edgeColor, edgeGloss, angleBase, soften = 1.4, clean = [2, 1] }) {
  const shape = (c) => {
    c.beginPath();
    for (let a = 0; a <= 256; a += 1) {
      const t = (a / 256) * Math.PI * 2;
      let lo = 0;
      let hi = CELL;
      for (let k = 0; k < 18; k += 1) {
        const mid = (lo + hi) / 2;
        if (sdf(Math.cos(t) * mid, Math.sin(t) * mid) < 0) lo = mid;
        else hi = mid;
      }
      c.lineTo(C + Math.cos(t) * lo, C + Math.sin(t) * lo);
    }
    c.closePath();
  };
  const src = canvas2d();
  drawCover(src, img, crop[0], crop[1], crop[2], crop[3], C - crop[4] / 2, C - crop[5] / 2, crop[4], crop[5], shape);
  const smoothCtx = canvas2d();
  smoothCtx.filter = `blur(${soften}px)`;
  smoothCtx.drawImage(src.canvas, 0, 0);
  const px = smoothCtx.getImageData(0, 0, CELL, CELL).data;
  const inside = new Float32Array(N);
  const dist = new Float32Array(N);
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const i = y * CELL + x;
      const d = sdf(x + 0.5 - C, y + 0.5 - C);
      dist[i] = d;
      inside[i] = clamp01(0.5 - d);
    }
  }
  const palette = threads(px, inside, count);
  const label = clean.reduce((acc, r) => majority(acc, count, r), labelsOf(px, palette));
  const tone = palette.map((c) => (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11) / 255);
  const toneField = new Float32Array(N);
  for (let i = 0; i < N; i += 1) toneField[i] = tone[label[i]];
  const toneB = blur(toneField, 1.5);
  const [gx, gy] = sobel(toneB);
  const outlineMask = new Float32Array(N);
  const outlineCol = new Int16Array(N).fill(-1);
  for (let y = 2; y < CELL - 2; y += 1) {
    for (let x = 2; x < CELL - 2; x += 1) {
      const i = y * CELL + x;
      const me = label[i];
      let other = -1;
      for (let dy = -2; dy <= 2 && other < 0; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const n = label[i + dy * CELL + dx];
          if (n !== me && Math.abs(tone[n] - tone[me]) > 0.22) {
            other = n;
            break;
          }
        }
      }
      if (other >= 0) {
        outlineMask[i] = 1;
        outlineCol[i] = tone[other] < tone[me] ? other : me;
      }
    }
  }

  const al = canvas2d();
  const out = al.createImageData(CELL, CELL);
  const angle = new Uint8Array(N);
  const fill = new Float32Array(N);
  const satin = new Float32Array(N);
  const rimMask = new Float32Array(N);
  const relief = new Float32Array(N);
  const e = 0.7;
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const i = y * CELL + x;
      const a = inside[i];
      if (a <= 0) continue;
      const lx = x + 0.5 - C;
      const ly = y + 0.5 - C;
      const d = dist[i];
      const inRim = smooth(-edge - 1, -edge + 1, d);
      const outline = outlineMask[i] * (1 - inRim);
      if (inRim > 0.5) {
        const nx = sdf(lx + e, ly) - sdf(lx - e, ly);
        const ny = sdf(lx, ly + e) - sdf(lx, ly - e);
        angle[i] = angleCode(Math.atan2(ny, nx) + 0.38);
      } else if (outline > 0.5) angle[i] = angleCode(Math.atan2(gy[i], gx[i]));
      else angle[i] = angleCode(angleBase + label[i] * 0.83);
      rimMask[i] = a * inRim;
      satin[i] = a * outline;
      fill[i] = a * (1 - inRim) * (1 - outline);
      const q = clamp01((d + edge) / edge);
      const roll = Math.sqrt(Math.max(0, 1 - (2 * q - 1) * (2 * q - 1)));
      relief[i] = inRim * (2.6 + 3.6 * roll) + (1 - inRim) * (0.7 + 0.35 * (label[i] % 3) + 1.1 * outline);
      const col = outline > 0.5 ? palette[outlineCol[i]] : palette[label[i]];
      for (let k = 0; k < 3; k += 1) out.data[i * 4 + k] = Math.round(edgeColor[k] * inRim + col[k] * (1 - inRim));
      out.data[i * 4 + 3] = Math.round(a * 255);
    }
  }
  al.putImageData(out, 0, 0);
  const iB = blur(inside, 2);
  const rB = blur(relief, 0.8);
  const height = new Float32Array(N);
  for (let i = 0; i < N; i += 1) height[i] = 3.6 * iB[i] + rB[i] * inside[i];
  return pack(al, height, [
    { mask: fill, metal: false, gloss: 0.4, kind: KIND_SATIN, angle },
    { mask: satin, metal: false, gloss: 0.62, kind: KIND_SATIN, angle },
    { mask: rimMask, metal: false, gloss: edgeGloss, kind: KIND_SATIN, angle },
  ]);
}

function embroideredPatch(img) {
  const hw = PATCH.w / 2;
  const hh = PATCH.h / 2;
  const cropH = PATCH.h / PATCH.w;
  return embroider(img, {
    crop: [0.02, 0.25, 0.96, cropH * 0.96, PATCH.w, PATCH.h],
    sdf: (x, y) => sdRoundRect(x, y, hw, hh, PATCH.r),
    count: 12,
    edge: 20,
    edgeColor: [24, 32, 48],
    edgeGloss: 0.6,
    angleBase: 0.42,
  });
}

function roundPatch(img) {
  const R = BUTTON.d / 2;
  const span = 0.58;
  return embroider(img, {
    crop: [0.52 - span / 2, 0.48 - span / 2, span, span, BUTTON.d, BUTTON.d],
    sdf: (x, y) => Math.hypot(x, y) - R,
    count: 14,
    edge: 22,
    edgeColor: [206, 160, 64],
    edgeGloss: 0.86,
    angleBase: 0.9,
  });
}

export async function buildBadges() {
  const [revolver, mystery, pepper] = await Promise.all(BADGES.map((b) => loadImage(b.album.cover)));
  return [enamelPin(revolver), embroideredPatch(mystery), roundPatch(pepper)];
}
