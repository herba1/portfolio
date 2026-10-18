function smooth(rgb, w, h) {
  const out = new Float32Array(rgb.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          const k = (yy * w + xx) * 3;
          r += rgb[k];
          g += rgb[k + 1];
          b += rgb[k + 2];
          n += 1;
        }
      }
      const o = (y * w + x) * 3;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
    }
  }
  return out;
}

function dist(a, i, b, j) {
  const dr = a[i] - b[j];
  const dg = a[i + 1] - b[j + 1];
  const db = a[i + 2] - b[j + 2];
  return Math.sqrt(dr * dr * 0.9 + dg * dg * 1.2 + db * db * 0.9);
}

function flood(w, h, seeds, accept) {
  const out = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  for (const k of seeds) {
    if (out[k]) continue;
    out[k] = 1;
    queue[tail] = k;
    tail += 1;
  }
  while (head < tail) {
    const k = queue[head];
    head += 1;
    const x = k % w;
    const y = (k - x) / w;
    const near = [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1];
    for (const n of near) {
      if (n < 0 || out[n] || !accept(k, n)) continue;
      out[n] = 1;
      queue[tail] = n;
      tail += 1;
    }
  }
  return out;
}

function components(field, w, h, value) {
  const label = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const stack = new Int32Array(w * h);
  for (let s = 0; s < w * h; s += 1) {
    if (field[s] !== value || label[s] >= 0) continue;
    const id = sizes.length;
    let top = 0;
    let size = 0;
    stack[top] = s;
    top += 1;
    label[s] = id;
    while (top > 0) {
      top -= 1;
      const k = stack[top];
      size += 1;
      const x = k % w;
      const y = (k - x) / w;
      const near = [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1];
      for (const n of near) {
        if (n < 0 || label[n] >= 0 || field[n] !== value) continue;
        label[n] = id;
        stack[top] = n;
        top += 1;
      }
    }
    sizes.push(size);
  }
  return { label, sizes };
}

function blur(src, w, h, radius) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const span = radius * 2 + 1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let s = 0;
      for (let d = -radius; d <= radius; d += 1) s += src[y * w + Math.min(w - 1, Math.max(0, x + d))];
      tmp[y * w + x] = s / span;
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let s = 0;
      for (let d = -radius; d <= radius; d += 1) s += tmp[Math.min(h - 1, Math.max(0, y + d)) * w + x];
      out[y * w + x] = s / span;
    }
  }
  return out;
}

function findArt(border, w, h) {
  const rowFill = (y, x0, x1) => {
    let n = 0;
    for (let x = x0; x < x1; x += 1) n += border[y * w + x] ? 0 : 1;
    return n / Math.max(1, x1 - x0);
  };
  const colFill = (x, y0, y1) => {
    let n = 0;
    for (let y = y0; y < y1; y += 1) n += border[y * w + x] ? 0 : 1;
    return n / Math.max(1, y1 - y0);
  };
  const bx0 = Math.round(w * 0.2);
  const bx1 = Math.round(w * 0.8);
  const by0 = Math.round(h * 0.2);
  const by1 = Math.round(h * 0.8);
  let top = Math.round(h * 0.04);
  for (let y = 2; y < h * 0.3; y += 1) {
    if (rowFill(y, bx0, bx1) > 0.9) {
      top = y;
      break;
    }
  }
  let bottom = Math.round(h * 0.94);
  for (let y = h - 3; y > h * 0.7; y -= 1) {
    if (rowFill(y, bx0, bx1) > 0.9) {
      bottom = y + 1;
      break;
    }
  }
  let left = Math.round(w * 0.06);
  for (let x = 2; x < w * 0.3; x += 1) {
    if (colFill(x, by0, by1) > 0.9) {
      left = x;
      break;
    }
  }
  let right = Math.round(w * 0.94);
  for (let x = w - 3; x > w * 0.7; x -= 1) {
    if (colFill(x, by0, by1) > 0.9) {
      right = x + 1;
      break;
    }
  }
  return [left, top, right, bottom];
}

export function chromeMask(pixels, w, h, { GRAD = 0.1, LOCAL = 0.04, GLOBAL = 0.14, artBox = null } = {}) {
  const n = w * h;
  const raw = new Float32Array(n * 3);
  for (let k = 0; k < n; k += 1) {
    raw[k * 3] = pixels[k * 4] / 255;
    raw[k * 3 + 1] = pixels[k * 4 + 1] / 255;
    raw[k * 3 + 2] = pixels[k * 4 + 2] / 255;
  }
  const sm = smooth(raw, w, h);
  const lum = (k) => sm[k * 3] * 0.3 + sm[k * 3 + 1] * 0.55 + sm[k * 3 + 2] * 0.15;
  const chroma = (k) => Math.max(sm[k * 3], sm[k * 3 + 1], sm[k * 3 + 2]) - Math.min(sm[k * 3], sm[k * 3 + 1], sm[k * 3 + 2]);
  const paper = (k) => lum(k) > 0.6 && chroma(k) < 0.24;

  const edgeSeeds = [];
  const inset = 3;
  for (let x = inset; x < w - inset; x += 1) {
    edgeSeeds.push(inset * w + x, (h - 1 - inset) * w + x);
  }
  for (let y = inset; y < h - inset; y += 1) {
    edgeSeeds.push(y * w + inset, y * w + w - 1 - inset);
  }
  const border = flood(
    w,
    h,
    edgeSeeds.filter((k) => paper(k)),
    (p, q) => paper(q) && dist(sm, p * 3, sm, q * 3) < 0.1,
  );
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (x < inset || y < inset || x >= w - inset || y >= h - inset) border[y * w + x] = 1;
    }
  }
  const art = artBox ? artBox.map((v, i) => Math.round(v * (i % 2 ? h : w))) : findArt(border, w, h);
  const [ax0, ay0, ax1, ay1] = art;
  const inArt = (k) => {
    const x = k % w;
    const y = (k - x) / w;
    return x >= ax0 && x < ax1 && y >= ay0 && y < ay1;
  };

  let paperSum = 0;
  let paperCount = 0;
  for (let k = 0; k < n; k += 1) {
    if (border[k] && !inArt(k)) {
      paperSum += lum(k);
      paperCount += 1;
    }
  }
  const paperLum = paperCount ? paperSum / paperCount : 0.85;

  const ringBand = new Uint8Array(n);
  const band0 = 2;
  const band1 = 7;
  const sideEnd = ay0 + Math.round((ay1 - ay0) * 0.8);
  for (let y = ay0 + band0; y < sideEnd; y += 1) {
    for (let x = ax0 + band0; x < ax1 - band0; x += 1) {
      const top = y < ay0 + band1;
      const side = x < ax0 + band1 || x >= ax1 - band1;
      if (top || side) ringBand[y * w + x] = 1;
    }
  }
  const sm2 = smooth(sm, w, h);
  const grad = new Float32Array(n);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const k = y * w + x;
      grad[k] = Math.max(dist(sm2, (k - 1) * 3, sm2, (k + 1) * 3), dist(sm2, (k - w) * 3, sm2, (k + w) * 3));
    }
  }
  const topSeeds = [];
  for (let y = ay0 + band0; y < ay0 + band1; y += 1) {
    for (let x = ax0 + band0; x < ax1 - band0; x += 1) topSeeds.push(y * w + x);
  }
  const validRing = flood(w, h, topSeeds, (p, q) => ringBand[q] === 1 && grad[q] < GRAD && dist(sm2, p * 3, sm2, q * 3) < LOCAL);
  const ring = [];
  for (let k = 0; k < n; k += 1) if (validRing[k]) ring.push(k);
  const palette = [];
  const stride = Math.max(1, Math.floor(ring.length / 160));
  for (let i = 0; i < ring.length; i += stride) palette.push(ring[i]);
  const window = (ay1 - ay0) * 0.22;
  const lower = ay0 + (ay1 - ay0) * 0.6;
  const rows = new Array(h);
  for (let y = 0; y < h; y += 1) {
    const list = [];
    for (const p of palette) {
      const py = Math.floor(p / w);
      if (Math.abs(py - y) <= window || (y > py && py >= lower)) list.push(p * 3);
    }
    rows[y] = list;
  }
  const cache = new Float32Array(n).fill(-1);
  const nearPalette = (q) => {
    if (cache[q] >= 0) return cache[q];
    const list = rows[Math.floor(q / w)];
    const q3 = q * 3;
    let best = 9;
    for (let i = 0; i < list.length; i += 1) {
      const d = dist(sm2, q3, sm2, list[i]);
      if (d < best) best = d;
    }
    cache[q] = best;
    return best;
  };
  const bg = flood(w, h, ring, (p, q) => inArt(q) && grad[q] < GRAD && dist(sm2, p * 3, sm2, q * 3) < LOCAL && nearPalette(q) < GLOBAL);

  const artArea = (ax1 - ax0) * (ay1 - ay0);
  const holes = components(bg, w, h, 0);
  for (let k = 0; k < n; k += 1) {
    const id = holes.label[k];
    if (id >= 0 && inArt(k) && holes.sizes[id] < artArea * 0.006) bg[k] = 1;
  }
  const islands = components(bg, w, h, 1);
  for (let k = 0; k < n; k += 1) {
    const id = islands.label[k];
    if (id >= 0 && islands.sizes[id] < artArea * 0.004) bg[k] = 0;
  }

  const chrome = new Float32Array(n);
  const ink = new Float32Array(n);
  for (let k = 0; k < n; k += 1) {
    if (inArt(k)) {
      const lit = Math.min(1, Math.max(0, (lum(k) - 0.4) / 0.16));
      chrome[k] = bg[k] * lit * lit * (3 - 2 * lit);
    } else {
      const dark = Math.min(1, Math.max(0, (paperLum * 0.86 - lum(k)) / (paperLum * 0.3)));
      ink[k] = dark;
      chrome[k] = 1 - dark;
    }
  }
  const soft = blur(chrome, w, h, 1);
  const inkSoft = blur(ink, w, h, 1);
  const out = new Uint8Array(n * 4);
  for (let k = 0; k < n; k += 1) {
    out[k * 4] = Math.round(Math.min(1, Math.max(0, soft[k])) * 255);
    out[k * 4 + 1] = Math.round(Math.min(1, Math.max(0, inkSoft[k])) * 255);
    out[k * 4 + 2] = inArt(k) ? 255 : 0;
    out[k * 4 + 3] = 255;
  }
  return { data: out, width: w, height: h, art: [ax0 / w, ay0 / h, ax1 / w, ay1 / h], paper: paperLum };
}
