export const MARGIN = 0.05;
export const WASHI = [238, 230, 213];

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function wrapped(ctx, size, draw, x = size / 2, y = size / 2, reach = size) {
  const xs = [0];
  const ys = [0];
  if (x < reach) xs.push(size);
  if (x > size - reach) xs.push(-size);
  if (y < reach) ys.push(size);
  if (y > size - reach) ys.push(-size);
  for (const dx of xs) {
    for (const dy of ys) {
      ctx.save();
      ctx.translate(dx, dy);
      draw();
      ctx.restore();
    }
  }
}

function strand(ctx, rand, x, y, len, curl) {
  let a = rand() * Math.PI * 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  const steps = 5;
  for (let i = 0; i < steps; i += 1) {
    a += (rand() - 0.5) * curl;
    const nx = x + Math.cos(a) * (len / steps);
    const ny = y + Math.sin(a) * (len / steps);
    ctx.quadraticCurveTo((x + nx) / 2 + (rand() - 0.5) * 3, (y + ny) / 2 + (rand() - 0.5) * 3, nx, ny);
    x = nx;
    y = ny;
  }
  ctx.stroke();
}

export function fibreCanvas(size, seed) {
  const rand = rng(seed);
  const c = canvas(size, size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgb(128 128 128)";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 90; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * (0.04 + rand() * 0.12);
    const light = rand() > 0.5;
    wrapped(ctx, size, () => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const tone = light ? "255 255 255" : "0 0 0";
      g.addColorStop(0, `rgb(${tone} / 0.07)`);
      g.addColorStop(0.45, `rgb(${tone} / 0.045)`);
      g.addColorStop(0.75, `rgb(${tone} / 0.016)`);
      g.addColorStop(1, `rgb(${tone} / 0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }, x, y, r);
  }
  ctx.lineCap = "round";
  const count = Math.round((size * size) / 190);
  for (let i = 0; i < count; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const len = size * (0.02 + rand() * rand() * 0.11);
    const light = rand() > 0.28;
    ctx.lineWidth = 0.5 + rand() * 1.1;
    ctx.strokeStyle = light ? `rgb(255 255 255 / ${0.12 + rand() * 0.22})` : `rgb(40 30 18 / ${0.05 + rand() * 0.1})`;
    const seedCurl = 0.7 + rand() * 0.9;
    const strandSeed = Math.floor(rand() * 1e9);
    wrapped(ctx, size, () => strand(ctx, rng(strandSeed), x, y, len, seedCurl), x, y, len + 4);
  }
  for (let i = 0; i < 26; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const len = size * (0.08 + rand() * 0.16);
    ctx.lineWidth = 0.7 + rand() * 0.8;
    ctx.strokeStyle = `rgb(92 66 38 / ${0.12 + rand() * 0.14})`;
    const strandSeed = Math.floor(rand() * 1e9);
    wrapped(ctx, size, () => strand(ctx, rng(strandSeed), x, y, len, 1.1), x, y, len + 4);
  }
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 14;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n * 0.6));
    d[i + 2] = d[i + 2];
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function washiFill(ctx, w, h, fibre, scale) {
  ctx.fillStyle = `rgb(${WASHI.join(" ")})`;
  ctx.fillRect(0, 0, w, h);
  const pattern = ctx.createPattern(fibre, "repeat");
  const m = new DOMMatrix();
  m.scaleSelf(scale, scale);
  pattern.setTransform(m);
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

export function sheetSize(img) {
  const printW = 1 - MARGIN * 2;
  const printH = printW * (img.naturalHeight / img.naturalWidth);
  return { width: 1, height: printH + MARGIN * 2 };
}

export function frontCanvas(img, fibre, width, sheet) {
  const height = Math.round((width * sheet.height) / sheet.width);
  const c = canvas(width, height);
  const ctx = c.getContext("2d");
  washiFill(ctx, width, height, fibre, width / 1400);
  const px = MARGIN * width;
  const pw = width - px * 2;
  const ph = pw * (img.naturalHeight / img.naturalWidth);
  ctx.globalCompositeOperation = "multiply";
  ctx.filter = "saturate(0.92) contrast(1.02)";
  ctx.drawImage(img, px, px, pw, ph);
  ctx.filter = "none";
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = 0.5;
  const pattern = ctx.createPattern(fibre, "repeat");
  const m = new DOMMatrix();
  m.scaleSelf(width / 1400, width / 1400);
  pattern.setTransform(m);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  return c;
}

export function backCanvas(img, fibre, width, sheet) {
  const height = Math.round((width * sheet.height) / sheet.width);
  const c = canvas(width, height);
  const ctx = c.getContext("2d");
  washiFill(ctx, width, height, fibre, width / 1400);
  const px = MARGIN * width;
  const pw = width - px * 2;
  const ph = pw * (img.naturalHeight / img.naturalWidth);
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.09;
  ctx.filter = "blur(2px) grayscale(0.6)";
  ctx.drawImage(img, px, px, pw, ph);
  ctx.filter = "none";
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  return c;
}

export function feltCanvas(size, seed) {
  const rand = rng(seed);
  const field = new Float32Array(size * size);
  const hairs = Math.round((size * size) / 26);
  for (let i = 0; i < hairs; i += 1) {
    let x = rand() * size;
    let y = rand() * size;
    let a = rand() * Math.PI * 2;
    const len = 3 + rand() * 9;
    const amp = (rand() - 0.5) * 0.5;
    const turn = (rand() - 0.5) * 0.4;
    for (let k = 0; k < len; k += 1) {
      const xi = ((Math.floor(x) % size) + size) % size;
      const yi = ((Math.floor(y) % size) + size) % size;
      field[yi * size + xi] += amp;
      a += turn;
      x += Math.cos(a);
      y += Math.sin(a);
    }
  }
  const c = canvas(size, size);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < field.length; i += 1) {
    const v = Math.max(0, Math.min(255, 128 + field[i] * 110 + (rand() - 0.5) * 22));
    d[i * 4] = v;
    d[i * 4 + 1] = v;
    d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function creasePainter(width, sheet, seed) {
  const height = Math.round((width * sheet.height) / sheet.width);
  const c = canvas(width, height);
  const ctx = c.getContext("2d");
  const rand = rng(seed);
  ctx.fillStyle = "rgb(0 0 0)";
  ctx.fillRect(0, 0, width, height);
  const k = width / sheet.width;

  function line(x0, y0, x1, y1, color, w, blur) {
    ctx.filter = blur > 0 ? `blur(${blur}px)` : "none";
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  function draw(segments) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "butt";
    for (const s of segments) {
      const x0 = s.a[0] * k;
      const y0 = s.a[1] * k;
      const x1 = s.b[0] * k;
      const y1 = s.b[1] * k;
      const len = Math.hypot(x1 - x0, y1 - y0);
      if (len < 0.5) continue;
      const ch = s.valleyFront ? [0, 1, 0] : [0, 0, 1];
      const col = (a) => `rgb(${ch.map((v) => Math.round(v * a * 255)).join(" ")})`;
      line(x0, y0, x1, y1, col(0.3), 9, 3);
      line(x0, y0, x1, y1, col(0.55), 3, 0.8);
      line(x0, y0, x1, y1, col(0.6), 1.2, 0);
      line(x0, y0, x1, y1, "rgb(110 0 0)", 2.2, 0.7);
      const steps = Math.max(1, Math.round(len / 3));
      ctx.filter = "none";
      for (let i = 0; i < steps; i += 1) {
        const t0 = i / steps;
        const t1 = (i + 1) / steps;
        const a = 0.6 + rand() * 0.4;
        const jitter = (rand() - 0.5) * 0.7;
        const nx = -(y1 - y0) / len;
        const ny = (x1 - x0) / len;
        ctx.strokeStyle = `rgb(${Math.round(a * 255)} 0 0)`;
        ctx.lineWidth = 1.2 + rand() * 1.4;
        ctx.beginPath();
        ctx.moveTo(x0 + (x1 - x0) * t0 + nx * jitter, y0 + (y1 - y0) * t0 + ny * jitter);
        ctx.lineTo(x0 + (x1 - x0) * t1 + nx * jitter, y0 + (y1 - y0) * t1 + ny * jitter);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  return { canvas: c, draw };
}
