import { albumById } from "@/app/lab/_music/catalog";

export const CELL = 640;

const KIND_HARD = 85;
const KIND_SATIN = 170;
const KIND_TWILL = 255;

const PIN = { w: 520, h: 520, r: 64 };
const PATCH = { w: 600, h: 404, r: 40 };
const BUTTON = { d: 600 };

export const BADGES = [
  { key: "revolver", album: albumById("revolver"), detail: "Enamel pin", widthMm: 50, heightMm: 50, cellW: PIN.w, tilt: -0.06, dy: -3 },
  { key: "abbey-road", album: albumById("abbey-road"), detail: "Embroidered patch", widthMm: 96, heightMm: (96 * PATCH.h) / PATCH.w, cellW: PATCH.w, tilt: 0.02, dy: 0 },
  { key: "sgt-pepper", album: albumById("sgt-pepper"), detail: "Button badge", widthMm: 58, heightMm: 58, cellW: BUTTON.d, tilt: 0.08, dy: 4 },
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

function enamelPin(img) {
  const hw = PIN.w / 2;
  const hh = PIN.h / 2;
  const rim = 18;
  const face = (c) => {
    c.beginPath();
    c.roundRect(C - hw + rim, C - hh + rim, PIN.w - rim * 2, PIN.h - rim * 2, PIN.r - rim);
  };
  const src = canvas2d();
  drawCover(src, img, 0, 0, 1, 1, C - hw + rim, C - hh + rim, PIN.w - rim * 2, PIN.h - rim * 2, face);
  const lum = lumaOf(src);

  const al = canvas2d();
  const out = al.createImageData(CELL, CELL);
  const plate = new Float32Array(N);
  const metal = new Float32Array(N);
  const enamel = new Float32Array(N);
  const gold = [184, 136, 52];
  const cream = [246, 242, 232];
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const i = y * CELL + x;
      const d = sdRoundRect(x + 0.5 - C, y + 0.5 - C, hw, hh, PIN.r);
      const inside = clamp01(0.5 - d);
      const onFace = clamp01(-d - rim + 0.5);
      const line = smooth(0.6, 0.42, lum[i]);
      const m = Math.max(1 - onFace, line);
      plate[i] = inside;
      metal[i] = inside * m;
      enamel[i] = inside * (1 - m);
      const shade = 0.9 + 0.1 * smooth(0.2, 0.6, lum[i]);
      for (let k = 0; k < 3; k += 1) out.data[i * 4 + k] = Math.round((gold[k] * m + cream[k] * (1 - m)) * (m > 0.5 ? shade : 1));
      out.data[i * 4 + 3] = Math.round(inside * 255);
    }
  }
  al.putImageData(out, 0, 0);
  const pB = blur(plate, 3);
  const mB = blur(metal, 1);
  const height = new Float32Array(N);
  for (let i = 0; i < N; i += 1) height[i] = 6.5 * pB[i] + 2.6 * mB[i];
  return pack(al, height, [
    { mask: enamel, metal: false, gloss: 0.94, kind: KIND_HARD },
    { mask: metal, metal: true, gloss: 0.86, kind: KIND_HARD },
  ]);
}

function embroideredPatch(img) {
  const hw = PATCH.w / 2;
  const hh = PATCH.h / 2;
  const border = 22;
  const shape = (c) => {
    c.beginPath();
    c.roundRect(C - hw, C - hh, PATCH.w, PATCH.h, PATCH.r);
  };
  const cropH = (PATCH.h / PATCH.w) * 1;
  const src = canvas2d();
  drawCover(src, img, 0, 1 - cropH - 0.02, 1, cropH, C - hw, C - hh, PATCH.w, PATCH.h, shape);
  const px = src.getImageData(0, 0, CELL, CELL).data;
  const lum = lumaOf(src);
  const lumB = blur(lum, 2);
  const [gx, gy] = sobel(lumB);
  const jxx = new Float32Array(N);
  const jxy = new Float32Array(N);
  const jyy = new Float32Array(N);
  for (let i = 0; i < N; i += 1) {
    jxx[i] = gx[i] * gx[i];
    jxy[i] = gx[i] * gy[i];
    jyy[i] = gy[i] * gy[i];
  }
  const bxx = blur(jxx, 5);
  const bxy = blur(jxy, 5);
  const byy = blur(jyy, 5);
  const fallback = 0.0012;
  const fillTheta = 0.42;
  const fgx = Math.cos(fillTheta - Math.PI / 2);
  const fgy = Math.sin(fillTheta - Math.PI / 2);

  const al = canvas2d();
  const out = al.createImageData(CELL, CELL);
  const angle = new Uint8Array(N);
  const inside = new Float32Array(N);
  const fill = new Float32Array(N);
  const satin = new Float32Array(N);
  const rimMask = new Float32Array(N);
  const relief = new Float32Array(N);
  const thread = [22, 30, 44];
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const i = y * CELL + x;
      const lx = x + 0.5 - C;
      const ly = y + 0.5 - C;
      const d = sdRoundRect(lx, ly, hw, hh, PATCH.r);
      const a = clamp01(0.5 - d);
      inside[i] = a;
      if (a <= 0) continue;
      const inRim = smooth(-border - 1, -border + 1, d);
      rimMask[i] = a * inRim;
      const e = 0.7;
      const nx = sdRoundRect(lx + e, ly, hw, hh, PATCH.r) - sdRoundRect(lx - e, ly, hw, hh, PATCH.r);
      const ny = sdRoundRect(lx, ly + e, hw, hh, PATCH.r) - sdRoundRect(lx, ly - e, hw, hh, PATCH.r);
      const edge = Math.hypot(gx[i], gy[i]);
      const xx = bxx[i] + fallback * fgx * fgx;
      const xy = bxy[i] + fallback * fgx * fgy;
      const yy = byy[i] + fallback * fgy * fgy;
      const gradTheta = 0.5 * Math.atan2(2 * xy, xx - yy);
      const outline = smooth(0.08, 0.16, edge) * (1 - inRim);
      if (inRim > 0.5) angle[i] = angleCode(Math.atan2(ny, nx) + 0.32);
      else if (outline > 0.5) angle[i] = angleCode(gradTheta + Math.PI / 2);
      else angle[i] = angleCode(fillTheta);
      satin[i] = a * outline;
      fill[i] = a * (1 - inRim) * (1 - outline);
      const q = clamp01((d + border) / border);
      const roll = Math.sqrt(Math.max(0, 1 - (2 * q - 1) * (2 * q - 1)));
      relief[i] = inRim * (2.4 + 3.4 * roll) + (1 - inRim) * (0.9 * lumB[i] + 1.1 * outline);
      const levels = 7;
      for (let k = 0; k < 3; k += 1) {
        const v = px[i * 4 + k] / 255;
        const boosted = clamp01((v - 0.5) * 1.12 + 0.5 + 0.02);
        const q8 = Math.round(boosted * levels) / levels;
        const col = q8 * 0.55 + boosted * 0.45;
        const dark = 1 - outline * 0.1;
        out.data[i * 4 + k] = Math.round((thread[k] * inRim + col * 255 * dark * (1 - inRim)));
      }
      out.data[i * 4 + 3] = Math.round(a * 255);
    }
  }
  al.putImageData(out, 0, 0);
  const iB = blur(inside, 2);
  const rB = blur(relief, 1);
  const height = new Float32Array(N);
  for (let i = 0; i < N; i += 1) height[i] = 4.2 * iB[i] + rB[i] * inside[i];
  return pack(al, height, [
    { mask: fill, metal: false, gloss: 0.32, kind: KIND_TWILL, angle },
    { mask: satin, metal: false, gloss: 0.45, kind: KIND_SATIN, angle },
    { mask: rimMask, metal: false, gloss: 0.62, kind: KIND_SATIN, angle },
  ]);
}

function buttonBadge(img) {
  const R = BUTTON.d / 2;
  const shape = (c) => {
    c.beginPath();
    c.arc(C, C, R, 0, Math.PI * 2);
  };
  const al = canvas2d();
  const span = 0.62;
  drawCover(al, img, 0.5 - span / 2, 0.44 - span / 2, span, span, C - R, C - R, R * 2, R * 2, shape);
  const px = al.getImageData(0, 0, CELL, CELL);
  const disc = new Float32Array(N);
  const height = new Float32Array(N);
  for (let y = 0; y < CELL; y += 1) {
    for (let x = 0; x < CELL; x += 1) {
      const i = y * CELL + x;
      const r = Math.hypot(x + 0.5 - C, y + 0.5 - C);
      const a = clamp01(R - r + 0.5);
      disc[i] = a;
      px.data[i * 4 + 3] = Math.round(a * 255);
      const u = Math.min(1, r / R);
      const dome = Math.sqrt(Math.max(0, 1 - u * u));
      const edge = Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, (u - 0.9) / 0.1), 2)));
      height[i] = a * (4 * edge + 9 * dome);
    }
  }
  al.putImageData(px, 0, 0);
  const hB = blur(height, 1);
  return pack(al, hB, [{ mask: disc, metal: false, gloss: 0.985, kind: KIND_HARD }]);
}

export async function buildBadges() {
  const [revolver, abbey, pepper] = await Promise.all(BADGES.map((b) => loadImage(b.album.cover)));
  return [enamelPin(revolver), embroideredPatch(abbey), buttonBadge(pepper)];
}
