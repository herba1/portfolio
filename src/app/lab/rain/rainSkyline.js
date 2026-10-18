const W = 1800;
const H = 1200;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LOOKS = {
  dusk: {
    seed: 11,
    sky: [
      [0, "#1a1d3d"],
      [0.22, "#3b2f5c"],
      [0.42, "#8a4a74"],
      [0.56, "#d8687a"],
      [0.66, "#f39a62"],
      [0.73, "#ffc47e"],
      [0.78, "#ffe2a8"],
    ],
    sun: { x: 0.6, y: 0.55, r: 44, core: "#fff6d8", glow: [255, 190, 120] },
    cloud: [255, 160, 150],
    haze: [244, 150, 120],
    far: "#7a4a6a",
    mid: "#3a2440",
    near: "#160e1c",
    windows: 0.32,
    windowTint: [255, 214, 150],
    horizon: 0.78,
    water: false,
  },
  blue: {
    seed: 29,
    sky: [
      [0, "#060a1e"],
      [0.3, "#0e1a3e"],
      [0.55, "#1f3768"],
      [0.7, "#3b5a8c"],
      [0.78, "#6f7fa8"],
    ],
    sun: null,
    moon: { x: 0.24, y: 0.2, r: 18 },
    cloud: [120, 140, 190],
    haze: [90, 110, 160],
    far: "#2a3a64",
    mid: "#131c38",
    near: "#070a16",
    windows: 0.55,
    windowTint: [255, 210, 140],
    horizon: 0.78,
    water: false,
  },
  harbor: {
    seed: 47,
    sky: [
      [0, "#232048"],
      [0.25, "#4d3866"],
      [0.42, "#b25c74"],
      [0.52, "#f08a62"],
      [0.58, "#ffc27a"],
      [0.6, "#ffe6b0"],
    ],
    sun: { x: 0.42, y: 0.5, r: 40, core: "#fff4d0", glow: [255, 180, 110] },
    cloud: [255, 150, 140],
    haze: [240, 140, 110],
    far: "#8a5070",
    mid: "#4a2a48",
    near: "#24142a",
    windows: 0.24,
    windowTint: [255, 210, 150],
    horizon: 0.6,
    water: true,
  },
};

function rgba([r, g, b], a) {
  return `rgba(${r},${g},${b},${a})`;
}

function drawSky(ctx, look) {
  const g = ctx.createLinearGradient(0, 0, 0, H * look.horizon);
  for (const [stop, color] of look.sky) g.addColorStop(stop / look.sky[look.sky.length - 1][0], color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawSun(ctx, look) {
  const s = look.sun;
  if (!s) return;
  const x = s.x * W;
  const y = s.y * H;
  const glow = ctx.createRadialGradient(x, y, 0, x, y, W * 0.55);
  glow.addColorStop(0, rgba(s.glow, 0.85));
  glow.addColorStop(0.08, rgba(s.glow, 0.5));
  glow.addColorStop(0.25, rgba(s.glow, 0.18));
  glow.addColorStop(0.55, rgba(s.glow, 0.05));
  glow.addColorStop(1, rgba(s.glow, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const disc = ctx.createRadialGradient(x, y, 0, x, y, s.r * 1.6);
  disc.addColorStop(0, s.core);
  disc.addColorStop(0.6, s.core);
  disc.addColorStop(0.7, rgba(s.glow, 0.7));
  disc.addColorStop(1, rgba(s.glow, 0));
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(x, y, s.r * 1.6, 0, Math.PI * 2);
  ctx.fill();
}

function drawMoon(ctx, look) {
  const m = look.moon;
  if (!m) return;
  const x = m.x * W;
  const y = m.y * H;
  const halo = ctx.createRadialGradient(x, y, 0, x, y, m.r * 9);
  halo.addColorStop(0, "rgba(200,215,255,0.35)");
  halo.addColorStop(0.2, "rgba(160,180,240,0.12)");
  halo.addColorStop(1, "rgba(120,140,220,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#eef2ff";
  ctx.beginPath();
  ctx.arc(x, y, m.r, 0, Math.PI * 2);
  ctx.fill();
}

function drawStars(ctx, rand, look) {
  if (look.sun) return;
  for (let i = 0; i < 160; i += 1) {
    ctx.fillStyle = `rgba(230,236,255,${0.2 + rand() * 0.6})`;
    const r = rand() < 0.1 ? 1.4 : 0.8;
    ctx.fillRect(rand() * W, rand() * H * 0.45, r, r);
  }
}

function drawClouds(ctx, rand, look) {
  const top = look.horizon * H;
  for (let i = 0; i < 9; i += 1) {
    const y = top * (0.25 + rand() * 0.55);
    const x = rand() * W;
    const w = 260 + rand() * 520;
    const h = 10 + rand() * 22;
    const lit = 0.12 + 0.22 * (y / top);
    const g = ctx.createRadialGradient(x, y, 0, x, y, w / 2);
    g.addColorStop(0, rgba(look.cloud, lit));
    g.addColorStop(0.6, rgba(look.cloud, lit * 0.4));
    g.addColorStop(1, rgba(look.cloud, 0));
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, h / (w / 2));
    ctx.translate(-x, -y);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, w / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function waterTower(ctx, x, base, s) {
  ctx.fillRect(x - s * 0.5, base - s * 0.9, s * 0.08, s * 0.9);
  ctx.fillRect(x + s * 0.42, base - s * 0.9, s * 0.08, s * 0.9);
  ctx.fillRect(x - s * 0.55, base - s * 1.9, s * 1.1, s * 1.05);
  ctx.beginPath();
  ctx.moveTo(x - s * 0.62, base - s * 1.88);
  ctx.lineTo(x, base - s * 2.45);
  ctx.lineTo(x + s * 0.62, base - s * 1.88);
  ctx.closePath();
  ctx.fill();
}

function building(ctx, rand, x, w, top, base, color, look, lit, layer) {
  ctx.fillStyle = color;
  ctx.fillRect(x, top, w, base - top);
  const kind = rand();
  if (kind < 0.18 && w > 40) {
    const sw = w * 0.6;
    const sh = (base - top) * (0.1 + rand() * 0.12);
    ctx.fillRect(x + (w - sw) / 2, top - sh, sw, sh);
    const tw = sw * 0.5;
    ctx.fillRect(x + (w - tw) / 2, top - sh * 1.8, tw, sh * 0.8);
    ctx.fillRect(x + w / 2 - 1.5, top - sh * 1.8 - 60 - rand() * 60, 3, 60 + rand() * 60);
  } else if (kind < 0.4 && layer === 2) {
    waterTower(ctx, x + w * (0.25 + rand() * 0.5), top, 14 + rand() * 8);
  } else if (kind < 0.55) {
    ctx.fillRect(x + w * 0.1, top - 8, w * 0.8, 8);
  }
  if (!lit) return;
  const cols = Math.max(2, Math.floor(w / 9));
  const rows = Math.floor((base - top) / 12);
  const cw = w / cols;
  const pattern = rand();
  for (let r = 1; r < rows; r += 1) {
    const rowOn = rand() < 0.85;
    for (let c = 0; c < cols; c += 1) {
      if (!rowOn || rand() > lit) continue;
      const warm = rand();
      const a = 0.45 + rand() * 0.55;
      const tint = warm > 0.85 ? [200, 225, 255] : look.windowTint;
      ctx.fillStyle = rgba(tint, a * (layer === 1 ? 0.55 : 1));
      const ww = pattern > 0.5 ? cw * 0.55 : cw * 0.7;
      ctx.fillRect(x + c * cw + (cw - ww) / 2, top + r * 12 + 3, ww, 5);
    }
  }
}

function skyline(ctx, rand, look, layer, base, minH, maxH, color, density, lit) {
  let x = -20;
  while (x < W + 20) {
    const w = 30 + rand() * (layer === 2 ? 110 : 80);
    const tall = rand() < 0.12 ? 1.5 : 1;
    const h = (minH + rand() * (maxH - minH)) * tall;
    building(ctx, rand, x, w, base - h, base, color, look, lit, layer);
    if (rand() < 0.06 && layer > 0) {
      ctx.fillStyle = "rgba(255,70,60,0.9)";
      ctx.beginPath();
      ctx.arc(x + w / 2, base - h - 4, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = color;
    }
    x += w * density;
  }
}

function haze(ctx, look, y0, y1, a) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, rgba(look.haze, 0));
  g.addColorStop(0.6, rgba(look.haze, a * 0.6));
  g.addColorStop(1, rgba(look.haze, a));
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, W, y1 - y0);
}

function drawWater(ctx, rand, look, top) {
  const g = ctx.createLinearGradient(0, top, 0, H);
  g.addColorStop(0, "#5a3450");
  g.addColorStop(0.2, "#3a2240");
  g.addColorStop(0.6, "#1c1228");
  g.addColorStop(1, "#0c0814");
  ctx.fillStyle = g;
  ctx.fillRect(0, top, W, H - top);
  const s = look.sun;
  if (s) {
    const x = s.x * W;
    for (let i = 0; i < 140; i += 1) {
      const y = top + 4 + Math.pow(rand(), 1.6) * (H - top);
      const spread = 20 + (y - top) * 0.35;
      const len = 20 + rand() * 90 * (1 - (y - top) / (H - top) * 0.5);
      const a = (0.25 + rand() * 0.6) * (1 - (y - top) / (H - top) * 0.7);
      ctx.fillStyle = rgba(s.glow, a);
      ctx.fillRect(x + (rand() - 0.5) * spread * 2 - len / 2, y, len, 2 + rand() * 2);
    }
  }
  for (let i = 0; i < 260; i += 1) {
    const y = top + rand() * (H - top);
    const a = 0.03 + rand() * 0.08;
    ctx.fillStyle = `rgba(255,190,170,${a})`;
    ctx.fillRect(rand() * W, y, 30 + rand() * 120, 1.5);
  }
}

export function drawSkyline(id) {
  const look = LOOKS[id] || LOOKS.dusk;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const rand = rng(look.seed);
  drawSky(ctx, look);
  drawStars(ctx, rand, look);
  drawMoon(ctx, look);
  drawSun(ctx, look);
  drawClouds(ctx, rand, look);
  const base = look.horizon * H;
  if (look.water) {
    skyline(ctx, rand, look, 0, base, 30, 110, look.far, 0.9, 0);
    haze(ctx, look, base - 140, base, 0.35);
    skyline(ctx, rand, look, 1, base, 40, 200, look.mid, 0.95, look.windows * 0.6);
    haze(ctx, look, base - 60, base, 0.25);
    drawWater(ctx, rand, look, base);
  } else {
    skyline(ctx, rand, look, 0, base + 40, 120, 340, look.far, 0.85, 0);
    haze(ctx, look, base - 200, base + 40, 0.4);
    skyline(ctx, rand, look, 1, base + 160, 200, 520, look.mid, 0.92, look.windows * 0.7);
    haze(ctx, look, base - 40, base + 160, 0.3);
    skyline(ctx, rand, look, 2, H + 10, 240, 420, look.near, 1.02, look.windows);
    const street = ctx.createLinearGradient(0, H - 160, 0, H);
    street.addColorStop(0, rgba(look.windowTint, 0));
    street.addColorStop(1, rgba(look.windowTint, 0.16));
    ctx.fillStyle = street;
    ctx.fillRect(0, H - 160, W, 160);
  }
  return canvas;
}
