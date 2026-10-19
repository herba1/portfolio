const PAPER = [244, 239, 228];

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function canvasOf(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function halftone(image, { width, height, cell = 3, paper = PAPER, fade = 0.9, crop = null }) {
  const src = canvasOf(width, height);
  const sctx = src.getContext("2d", { willReadFrequently: true });
  const cw = crop ? crop[2] : image.naturalWidth || image.width;
  const ch = crop ? crop[3] : image.naturalHeight || image.height;
  const scale = Math.max(width / cw, height / ch);
  const dw = cw * scale;
  const dh = ch * scale;
  if (crop) sctx.drawImage(image, crop[0], crop[1], crop[2], crop[3], (width - dw) / 2, (height - dh) / 2, dw, dh);
  else sctx.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);
  const pixels = sctx.getImageData(0, 0, src.width, src.height);
  const d = pixels.data;
  const out = sctx.createImageData(src.width, src.height);
  const o = out.data;
  const angles = [15, 75, 0, 45].map((a) => (a * Math.PI) / 180);
  const cs = angles.map(Math.cos);
  const sn = angles.map(Math.sin);
  const ink = [
    [0.86, 0.1, 0.0],
    [0.06, 0.82, 0.05],
    [0.0, 0.05, 0.84],
    [0.88, 0.88, 0.86],
  ];
  const rand = seeded(77);
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const i = (y * src.width + x) * 4;
      let r = d[i] / 255;
      let g = d[i + 1] / 255;
      let b = d[i + 2] / 255;
      r = 1 - (1 - r) * fade;
      g = 1 - (1 - g) * fade;
      b = 1 - (1 - b) * fade;
      const k = 1 - Math.max(r, g, b);
      const inv = k < 0.999 ? 1 / (1 - k) : 0;
      const cov = [(1 - r - k) * inv, (1 - g - k) * inv, (1 - b - k) * inv, k * 0.9];
      let cr = paper[0] / 255;
      let cg = paper[1] / 255;
      let cb = paper[2] / 255;
      for (let n = 0; n < 4; n += 1) {
        const c = cov[n];
        if (c <= 0.01) continue;
        const u = (x * cs[n] + y * sn[n]) / cell;
        const v = (-x * sn[n] + y * cs[n]) / cell;
        const fu = u - Math.floor(u) - 0.5;
        const fv = v - Math.floor(v) - 0.5;
        const dist = Math.sqrt(fu * fu + fv * fv);
        const radius = Math.sqrt(c) * 0.62;
        const edge = 0.7 / cell;
        const amount = Math.min(1, Math.max(0, (radius - dist) / edge + 0.5));
        if (amount <= 0) continue;
        cr *= 1 - ink[n][0] * amount;
        cg *= 1 - ink[n][1] * amount;
        cb *= 1 - ink[n][2] * amount;
      }
      const grain = (rand() - 0.5) * 0.035;
      o[i] = Math.max(0, Math.min(255, (cr + grain) * 255));
      o[i + 1] = Math.max(0, Math.min(255, (cg + grain) * 255));
      o[i + 2] = Math.max(0, Math.min(255, (cb + grain) * 255));
      o[i + 3] = 255;
    }
  }
  sctx.putImageData(out, 0, 0);
  return src;
}

export function slip(text, { height = 160, font = "scanner-tinos" } = {}) {
  const probe = canvasOf(4, 4).getContext("2d");
  const size = Math.round(height * 0.5);
  probe.font = `400 ${size}px ${font}, "Times New Roman", serif`;
  const w = Math.ceil(probe.measureText(text).width + height * 0.9);
  const c = canvasOf(w, height);
  const ctx = c.getContext("2d");
  ctx.fillStyle = `rgb(${PAPER[0]},${PAPER[1]},${PAPER[2]})`;
  ctx.fillRect(0, 0, c.width, c.height);
  const rand = seeded(text.length * 131 + 7);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 10;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n - 1;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = "#1b1a18";
  ctx.font = `400 ${size}px ${font}, "Times New Roman", serif`;
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(27,26,24,0.45)";
  ctx.shadowBlur = height * 0.006;
  ctx.fillText(text, height * 0.45, height * 0.66);
  return c;
}

export function makeDust(seed = 2024) {
  const rand = seeded(seed);
  const specks = Array.from({ length: 34 }, () => ({
    x: rand(),
    y: rand(),
    r: 0.15 + rand() * rand() * 0.6,
    a: 0.35 + rand() * 0.5,
  }));
  const hair = {
    x: 0.62 + rand() * 0.2,
    y: 0.18 + rand() * 0.2,
    pts: Array.from({ length: 5 }, (_, i) => [i * 3.2 + rand() * 1.2, Math.sin(i * 1.3 + rand()) * 2.4]),
  };
  return { specks, hair };
}

export function composeScan(target, { bedW, bedH, items, dust, seed = 1 }) {
  const W = target.width;
  const H = target.height;
  const k = W / bedW;
  const ctx = target.getContext("2d", { willReadFrequently: true });
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#1b1b1d");
  bg.addColorStop(0.18, "#121214");
  bg.addColorStop(0.7, "#0c0c0e");
  bg.addColorStop(1, "#09090a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H / 2);
  ctx.rotate(0.0055);
  ctx.translate(-W / 2, -H / 2);
  for (const item of items) {
    const w = item.w * k;
    const h = item.h * k;
    ctx.save();
    ctx.translate(item.x * k, item.y * k);
    ctx.rotate(item.rot);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.filter = `blur(${Math.max(0.6, k * 0.5)}px)`;
    ctx.fillRect(-w / 2 + k * 0.6, -h / 2 + k * 0.3, w, h);
    ctx.filter = "none";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(item.bitmap, -w / 2, -h / 2, w, h);
    if (item.halftone) {
      ctx.globalAlpha = 0.18;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(item.bitmap, -w / 2, -h / 2, w, h);
      ctx.globalAlpha = 1;
    }
    const lift = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    lift.addColorStop(0, "rgba(255,255,255,0.06)");
    lift.addColorStop(0.02, "rgba(255,255,255,0)");
    lift.addColorStop(0.98, "rgba(0,0,0,0)");
    lift.addColorStop(1, "rgba(0,0,0,0.12)");
    ctx.fillStyle = lift;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
  ctx.restore();
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const rand = seeded(seed * 7919 + 13);
  const gain = new Float32Array(W);
  let drift = 0;
  for (let x = 0; x < W; x += 1) {
    drift = drift * 0.96 + (rand() - 0.5) * 0.012;
    gain[x] = 1 + drift + (rand() < 0.006 ? 0.08 : 0);
  }
  const rowTint = new Float32Array(H);
  for (let y = 0; y < H; y += 1) rowTint[y] = 1 + Math.sin(y * 0.9 + seed) * 0.004;
  const shift = Math.max(1, Math.round(W / 700));
  const copy = new Uint8ClampedArray(d);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      const xr = Math.max(0, x - shift);
      const xb = Math.min(W - 1, x + shift);
      const g = gain[x] * rowTint[y];
      const n = (rand() - 0.5) * 9;
      d[i] = copy[(y * W + xr) * 4] * g * 1.01 + n;
      d[i + 1] = copy[i + 1] * g + n;
      d[i + 2] = copy[(y * W + xb) * 4 + 2] * g * 0.985 + n + 2;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.save();
  for (const s of dust.specks) {
    ctx.fillStyle = `rgba(128,124,118,${s.a})`;
    ctx.beginPath();
    ctx.arc(s.x * W, s.y * H, Math.max(0.5, s.r * k), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(110,106,100,0.6)";
  ctx.lineWidth = Math.max(0.6, k * 0.12);
  ctx.beginPath();
  dust.hair.pts.forEach(([px, py], i) => {
    const x = dust.hair.x * W + px * k;
    const y = dust.hair.y * H + py * k;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
  return target;
}
