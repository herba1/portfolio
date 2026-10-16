function rasterize(width, height, polygons, { blur = 0, erode = 0, grow = 0 } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  if (blur) ctx.filter = `blur(${blur}px)`;
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#000";
  ctx.lineJoin = "round";
  for (const poly of polygons) {
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(x * width, y * height) : ctx.moveTo(x * width, y * height)));
    ctx.closePath();
    ctx.fill();
    if (grow) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = grow * 2;
      ctx.stroke();
      ctx.strokeStyle = "#000";
    }
    if (erode) {
      ctx.lineWidth = erode * 2;
      ctx.stroke();
    }
  }
  const data = ctx.getImageData(0, 0, width, height).data;
  const out = new Uint8Array(width * height);
  for (let k = 0; k < width * height; k += 1) out[k] = data[k * 4];
  return out;
}

function pixelsOf(image, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

function pushPull(rgb, known, w, h) {
  const levels = [];
  let lw = w;
  let lh = h;
  let c = new Float32Array(w * h * 3);
  let wt = new Float32Array(w * h);
  for (let k = 0; k < w * h; k += 1) {
    const kw = known[k];
    wt[k] = kw;
    c[k * 3] = rgb[k * 3] * kw;
    c[k * 3 + 1] = rgb[k * 3 + 1] * kw;
    c[k * 3 + 2] = rgb[k * 3 + 2] * kw;
  }
  levels.push({ c, wt, w: lw, h: lh });
  while (lw > 1 || lh > 1) {
    const nw = Math.max(1, Math.ceil(lw / 2));
    const nh = Math.max(1, Math.ceil(lh / 2));
    const nc = new Float32Array(nw * nh * 3);
    const nwt = new Float32Array(nw * nh);
    for (let y = 0; y < lh; y += 1) {
      for (let x = 0; x < lw; x += 1) {
        const k = y * lw + x;
        const n = (y >> 1) * nw + (x >> 1);
        nwt[n] += wt[k];
        nc[n * 3] += c[k * 3];
        nc[n * 3 + 1] += c[k * 3 + 1];
        nc[n * 3 + 2] += c[k * 3 + 2];
      }
    }
    for (let n = 0; n < nw * nh; n += 1) {
      const s = nwt[n];
      if (s > 0) {
        nc[n * 3] /= s;
        nc[n * 3 + 1] /= s;
        nc[n * 3 + 2] /= s;
      }
      nwt[n] = Math.min(1, s);
      nc[n * 3] *= nwt[n];
      nc[n * 3 + 1] *= nwt[n];
      nc[n * 3 + 2] *= nwt[n];
    }
    lw = nw;
    lh = nh;
    c = nc;
    wt = nwt;
    levels.push({ c, wt, w: lw, h: lh });
  }
  for (let i = levels.length - 2; i >= 0; i -= 1) {
    const fine = levels[i];
    const coarse = levels[i + 1];
    for (let y = 0; y < fine.h; y += 1) {
      for (let x = 0; x < fine.w; x += 1) {
        const k = y * fine.w + x;
        const a = fine.wt[k];
        if (a >= 1) continue;
        const gx = Math.min(coarse.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
        const gy = Math.min(coarse.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const x1 = Math.min(coarse.w - 1, x0 + 1);
        const y1 = Math.min(coarse.h - 1, y0 + 1);
        const fx = gx - x0;
        const fy = gy - y0;
        for (let ch = 0; ch < 3; ch += 1) {
          const v00 = coarse.c[(y0 * coarse.w + x0) * 3 + ch] / Math.max(coarse.wt[y0 * coarse.w + x0], 1e-4);
          const v10 = coarse.c[(y0 * coarse.w + x1) * 3 + ch] / Math.max(coarse.wt[y0 * coarse.w + x1], 1e-4);
          const v01 = coarse.c[(y1 * coarse.w + x0) * 3 + ch] / Math.max(coarse.wt[y1 * coarse.w + x0], 1e-4);
          const v11 = coarse.c[(y1 * coarse.w + x1) * 3 + ch] / Math.max(coarse.wt[y1 * coarse.w + x1], 1e-4);
          const v = (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
          fine.c[k * 3 + ch] = fine.c[k * 3 + ch] + v * (1 - a);
        }
        fine.wt[k] = 1;
      }
    }
  }
  return levels[0].c;
}

function fill(pixels, known, width, height) {
  const n = width * height;
  const rgb = new Float32Array(n * 3);
  for (let k = 0; k < n; k += 1) {
    rgb[k * 3] = pixels[k * 4] / 255;
    rgb[k * 3 + 1] = pixels[k * 4 + 1] / 255;
    rgb[k * 3 + 2] = pixels[k * 4 + 2] / 255;
  }
  const filled = pushPull(rgb, known, width, height);
  const out = new Uint8Array(n * 4);
  for (let k = 0; k < n; k += 1) {
    out[k * 4] = Math.max(0, Math.min(255, Math.round(filled[k * 3] * 255)));
    out[k * 4 + 1] = Math.max(0, Math.min(255, Math.round(filled[k * 3 + 1] * 255)));
    out[k * 4 + 2] = Math.max(0, Math.min(255, Math.round(filled[k * 3 + 2] * 255)));
    out[k * 4 + 3] = 255;
  }
  return out;
}

export function prepareCard(card, image) {
  const aspect = image.naturalWidth / image.naturalHeight || card.aspect;
  const mw = 330;
  const mh = Math.round(mw / aspect);
  const figure = rasterize(mw, mh, [card.figure], { blur: 0.8, grow: 3 });
  const limb = rasterize(mw, mh, card.limb, { blur: 0.8, grow: 3 });
  const core = rasterize(mw, mh, [card.figure], { blur: 1.5, erode: 4 });
  const limbWide = rasterize(mw, mh, card.limb, { blur: 1.5, grow: 7 });
  const limbCore = rasterize(mw, mh, card.limb, { blur: 1.2, erode: 2.5 });
  const masks = new Uint8Array(mw * mh * 4);
  for (let k = 0; k < mw * mh; k += 1) {
    masks[k * 4] = figure[k];
    masks[k * 4 + 1] = limb[k];
    masks[k * 4 + 2] = Math.max(core[k], Math.min(figure[k], limbWide[k]));
    masks[k * 4 + 3] = limbCore[k];
  }
  const fw = 165;
  const fh = Math.round(fw / aspect);
  const pixels = pixelsOf(image, fw, fh);
  const cover = rasterize(fw, fh, [card.figure, ...card.limb], { blur: 2.5, grow: 4 });
  const limbHole = rasterize(fw, fh, card.limb, { blur: 2, grow: 3 });
  const figureCore = rasterize(fw, fh, [card.figure], { blur: 1, erode: 2 });
  const bodyKnown = new Float32Array(fw * fh);
  const bgKnown = new Float32Array(fw * fh);
  const [ax0, ay0, ax1, ay1] = card.art;
  for (let y = 0; y < fh; y += 1) {
    for (let x = 0; x < fw; x += 1) {
      const k = y * fw + x;
      const u = (x + 0.5) / fw;
      const v = (y + 0.5) / fh;
      const inArt = u > ax0 + 0.026 && u < ax1 - 0.026 && v > ay0 + 0.016 && v < ay1 - 0.016 ? 1 : 0;
      bgKnown[k] = cover[k] < 8 ? inArt : 0;
      bodyKnown[k] = figureCore[k] > 220 && limbHole[k] < 4 ? inArt : 0;
    }
  }
  return {
    aspect,
    masks: { data: masks, width: mw, height: mh },
    bg: { data: fill(pixels, bgKnown, fw, fh), width: fw, height: fh },
    body: { data: fill(pixels, bodyKnown, fw, fh), width: fw, height: fh },
  };
}
