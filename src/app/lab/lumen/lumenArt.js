function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const OBJECTS = [
  { id: "fern", name: "Fern frond", w: 0.36, h: 0.84, cover: 0.9, thick: 0.15 },
  { id: "grass", name: "Sprig of grass", w: 0.24, h: 0.76, cover: 0.94, thick: 0.25 },
  { id: "key", name: "Brass key", w: 0.36, h: 0.14, cover: 1, thick: 1 },
];

function fernGeometry() {
  const rand = mulberry(1907);
  const rachis = [];
  for (let i = 0; i <= 60; i += 1) {
    const t = i / 60;
    rachis.push([0.03 * Math.sin(Math.PI * t * 1.1) - 0.012 * t + 0.004, 0.41 - 0.82 * t]);
  }
  const at = (t) => {
    const f = t * 60;
    const i = Math.min(59, Math.floor(f));
    const k = f - i;
    const a = rachis[i];
    const b = rachis[i + 1];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, Math.atan2(b[1] - a[1], b[0] - a[0])];
  };
  const pinnae = [];
  const n = 30;
  for (let i = 0; i < n; i += 1) {
    const u = Math.pow(i / (n - 1), 0.9);
    const t = 0.13 + 0.85 * u;
    const [x, y, dir] = at(t);
    const side = i % 2 === 0 ? 1 : -1;
    const shape = u < 0.22 ? 0.55 + 0.45 * (u / 0.22) : 1 - Math.pow((u - 0.22) / 0.78, 1.25);
    const len = 0.165 * Math.max(0.05, shape) * (0.92 + rand() * 0.16);
    const spread = (1.02 - 0.32 * u) * side;
    pinnae.push({ x, y, angle: dir + spread, len, side, u, wobble: (rand() - 0.5) * 0.12 });
  }
  return { rachis, pinnae, rand };
}

function drawFernInto(ctx, s, mode) {
  const { rachis, pinnae, rand } = fernGeometry();
  const solid = mode === "mask";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const p of pinnae) {
    const count = Math.max(2, Math.round(p.len / 0.0105));
    const bend = 0.18 * p.side;
    for (let k = 0; k < count; k += 1) {
      const f = (k + 0.5) / count;
      const along = p.len * f;
      const a = p.angle + p.wobble + bend * f;
      const px = p.x + Math.cos(a) * along;
      const py = p.y + Math.sin(a) * along;
      const lobe = 0.03 * (1 - 0.72 * f) * (0.75 + 0.5 * Math.sin(Math.PI * Math.min(1, p.u * 1.3 + 0.15)));
      for (const side of [-1, 1]) {
        const la = a + side * 1.12 - side * 0.38 * f;
        ctx.save();
        ctx.translate(px * s, py * s);
        ctx.rotate(la);
        const L = lobe * 1.05 * s;
        const Wd = lobe * 0.36 * s;
        ctx.beginPath();
        ctx.moveTo(0, -Wd * 0.35);
        const N = 9;
        for (let q = 1; q <= N; q += 1) {
          const e = q / N;
          const hw = Wd * Math.pow(Math.sin(Math.PI * Math.min(0.999, 0.35 + 0.65 * e)), 0.8) * (1 + 0.1 * Math.sin(e * 17));
          ctx.lineTo(L * e, -hw);
        }
        ctx.quadraticCurveTo(L * 1.06, 0, L * 0.98, Wd * 0.3);
        for (let q = N; q >= 1; q -= 1) {
          const e = q / N;
          const hw = Wd * Math.pow(Math.sin(Math.PI * Math.min(0.999, 0.35 + 0.65 * e)), 0.8) * (1 + 0.1 * Math.sin(e * 13 + 1));
          ctx.lineTo(L * e, hw);
        }
        ctx.lineTo(0, Wd * 0.35);
        ctx.closePath();
        if (solid) ctx.fillStyle = "rgba(0,0,0,0.9)";
        else {
          const hue = 82 + rand() * 10 - p.u * 5;
          const light = 31 + rand() * 6 + f * 4;
          const g = ctx.createLinearGradient(0, 0, L, 0);
          g.addColorStop(0, `hsl(${hue - 4} ${34 + rand() * 6}% ${light - 6}%)`);
          g.addColorStop(1, `hsl(${hue + 4} ${30 + rand() * 8}% ${light + 7}%)`);
          ctx.fillStyle = g;
        }
        ctx.fill();
        if (!solid) {
          ctx.strokeStyle = "rgba(28,40,14,0.4)";
          ctx.lineWidth = Math.max(0.5, s * 0.001);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(L * 0.82, 0);
          ctx.stroke();
          ctx.strokeStyle = "rgba(20,30,10,0.25)";
          ctx.lineWidth = Math.max(0.5, s * 0.0008);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    ctx.strokeStyle = solid ? "rgba(0,0,0,1)" : "#3a4f22";
    ctx.lineWidth = Math.max(0.8, s * 0.0024 * (1 - p.u * 0.5));
    ctx.beginPath();
    ctx.moveTo(p.x * s, p.y * s);
    const steps = 6;
    for (let k = 1; k <= steps; k += 1) {
      const f = k / steps;
      const a = p.angle + p.wobble + bend * f;
      ctx.lineTo((p.x + Math.cos(a) * p.len * f) * s, (p.y + Math.sin(a) * p.len * f) * s);
    }
    ctx.stroke();
  }
  ctx.beginPath();
  rachis.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)));
  if (solid) {
    ctx.strokeStyle = "rgba(0,0,0,1)";
    ctx.lineWidth = s * 0.006;
    ctx.stroke();
  } else {
    ctx.strokeStyle = "#4a3a1f";
    ctx.lineWidth = s * 0.0062;
    ctx.stroke();
    ctx.strokeStyle = "rgba(170,160,110,0.45)";
    ctx.lineWidth = s * 0.0018;
    ctx.stroke();
  }
}

function grassGeometry() {
  const rand = mulberry(3301);
  const culm = [];
  for (let i = 0; i <= 40; i += 1) {
    const t = i / 40;
    culm.push([0.035 - 0.05 * t + 0.022 * Math.sin(t * 2.4), 0.37 - 0.74 * t]);
  }
  return { culm, rand };
}

function drawGrassInto(ctx, s, mode) {
  const { culm, rand } = grassGeometry();
  const solid = mode === "mask";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const blade = (x0, y0, angle, len, width, curl) => {
    ctx.beginPath();
    const pts = [];
    for (let i = 0; i <= 20; i += 1) {
      const f = i / 20;
      const a = angle + curl * f * f;
      const prev = pts[i - 1] || [x0, y0];
      pts.push([prev[0] + Math.cos(a) * (len / 20), prev[1] + Math.sin(a) * (len / 20)]);
    }
    const left = [];
    const right = [];
    pts.forEach(([x, y], i) => {
      const next = pts[Math.min(20, i + 1)];
      const prev = pts[Math.max(0, i - 1)];
      const a = Math.atan2(next[1] - prev[1], next[0] - prev[0]);
      const w = width * (1 - i / 20) * (i === 0 ? 0.6 : 1);
      left.push([x + Math.cos(a + Math.PI / 2) * w, y + Math.sin(a + Math.PI / 2) * w]);
      right.push([x - Math.cos(a + Math.PI / 2) * w, y - Math.sin(a + Math.PI / 2) * w]);
    });
    left.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)));
    right.reverse().forEach(([x, y]) => ctx.lineTo(x * s, y * s));
    ctx.closePath();
    if (solid) ctx.fillStyle = "rgba(0,0,0,0.94)";
    else {
      const g = ctx.createLinearGradient(x0 * s, y0 * s, (x0 + Math.cos(angle) * len) * s, (y0 + Math.sin(angle) * len) * s);
      g.addColorStop(0, "#8f8a4a");
      g.addColorStop(0.5, "#b3a463");
      g.addColorStop(1, "#c9b97d");
      ctx.fillStyle = g;
    }
    ctx.fill();
  };
  blade(culm[6][0], culm[6][1], -1.95, 0.42, 0.011, 0.9);
  blade(culm[14][0], culm[14][1], -1.0, 0.3, 0.009, -0.7);
  ctx.beginPath();
  culm.forEach(([x, y], i) => (i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)));
  ctx.strokeStyle = solid ? "rgba(0,0,0,1)" : "#a0914f";
  ctx.lineWidth = s * 0.0042;
  ctx.stroke();
  for (let b = 0; b < 9; b += 1) {
    const ti = 22 + b * 2;
    const [x, y] = culm[ti];
    const side = b % 2 ? 1 : -1;
    const len = 0.05 + 0.07 * Math.sin((b / 8) * Math.PI) * (1 - b / 14);
    const a = -Math.PI / 2 + side * (0.55 + rand() * 0.2);
    const ex = x + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len;
    ctx.beginPath();
    ctx.moveTo(x * s, y * s);
    ctx.quadraticCurveTo((x + Math.cos(a) * len * 0.5) * s, (y + Math.sin(a) * len * 0.5 + 0.006) * s, ex * s, ey * s);
    ctx.strokeStyle = solid ? "rgba(0,0,0,1)" : "#a69655";
    ctx.lineWidth = s * 0.0018;
    ctx.stroke();
    const seeds = 4 + Math.floor(len / 0.018);
    for (let k = 0; k < seeds; k += 1) {
      const f = 0.25 + (0.75 * (k + 1)) / seeds;
      const sx = x + (ex - x) * f;
      const sy = y + (ey - y) * f;
      const sa = a + (rand() - 0.5) * 0.6 + side * 0.2;
      ctx.save();
      ctx.translate(sx * s, sy * s);
      ctx.rotate(sa);
      ctx.beginPath();
      ctx.ellipse(0.006 * s, 0, 0.0105 * s, 0.0036 * s, 0, 0, Math.PI * 2);
      ctx.fillStyle = solid ? "rgba(0,0,0,0.9)" : `hsl(${44 + rand() * 8} ${38 + rand() * 10}% ${58 + rand() * 10}%)`;
      ctx.fill();
      if (!solid) {
        ctx.strokeStyle = "rgba(110,90,40,0.5)";
        ctx.lineWidth = Math.max(0.5, s * 0.0008);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  const [tx, ty] = culm[40];
  for (let k = 0; k < 4; k += 1) {
    ctx.save();
    ctx.translate((tx + (rand() - 0.5) * 0.006) * s, (ty - k * 0.012) * s);
    ctx.rotate(-Math.PI / 2 + (rand() - 0.5) * 0.5);
    ctx.beginPath();
    ctx.ellipse(0.006 * s, 0, 0.011 * s, 0.0036 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = solid ? "rgba(0,0,0,0.9)" : "#cdb983";
    ctx.fill();
    ctx.restore();
  }
}

function keyPath(ctx, s) {
  ctx.beginPath();
  ctx.arc(-0.118 * s, 0, 0.052 * s, 0, Math.PI * 2);
  ctx.moveTo(-0.118 * s + 0.026 * s, 0);
  ctx.arc(-0.118 * s, 0, 0.026 * s, 0, Math.PI * 2, true);
  ctx.closePath();
  ctx.rect(-0.072 * s, -0.016 * s, 0.022 * s, 0.032 * s);
  ctx.rect(-0.052 * s, -0.0095 * s, 0.205 * s, 0.019 * s);
  ctx.moveTo(0.1 * s, 0.006 * s);
  ctx.lineTo(0.152 * s, 0.006 * s);
  ctx.lineTo(0.152 * s, 0.058 * s);
  ctx.lineTo(0.138 * s, 0.058 * s);
  ctx.lineTo(0.138 * s, 0.044 * s);
  ctx.lineTo(0.126 * s, 0.044 * s);
  ctx.lineTo(0.126 * s, 0.058 * s);
  ctx.lineTo(0.112 * s, 0.058 * s);
  ctx.lineTo(0.112 * s, 0.034 * s);
  ctx.lineTo(0.1 * s, 0.034 * s);
  ctx.closePath();
}

function drawKeyInto(ctx, s, mode) {
  if (mode === "mask") {
    ctx.fillStyle = "rgba(0,0,0,1)";
    keyPath(ctx, s);
    ctx.fill("nonzero");
    return;
  }
  const g = ctx.createLinearGradient(-0.17 * s, -0.06 * s, 0.16 * s, 0.07 * s);
  g.addColorStop(0, "#c99a3c");
  g.addColorStop(0.2, "#f0d488");
  g.addColorStop(0.38, "#b58a33");
  g.addColorStop(0.55, "#e2bf6a");
  g.addColorStop(0.78, "#9c742a");
  g.addColorStop(1, "#d8b261");
  ctx.fillStyle = g;
  keyPath(ctx, s);
  ctx.fill("nonzero");
  ctx.save();
  keyPath(ctx, s);
  ctx.clip("nonzero");
  const shade = ctx.createLinearGradient(0, -0.06 * s, 0, 0.06 * s);
  shade.addColorStop(0, "rgba(255,246,210,0.55)");
  shade.addColorStop(0.35, "rgba(255,240,200,0)");
  shade.addColorStop(0.7, "rgba(60,40,10,0)");
  shade.addColorStop(1, "rgba(60,40,10,0.45)");
  ctx.fillStyle = shade;
  ctx.fillRect(-0.2 * s, -0.08 * s, 0.4 * s, 0.16 * s);
  ctx.strokeStyle = "rgba(255,248,220,0.7)";
  ctx.lineWidth = s * 0.0026;
  ctx.beginPath();
  ctx.moveTo(-0.048 * s, -0.0055 * s);
  ctx.lineTo(0.148 * s, -0.0055 * s);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-0.118 * s, 0, 0.04 * s, Math.PI * 1.05, Math.PI * 1.6);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = "rgba(92,64,18,0.85)";
  ctx.lineWidth = Math.max(0.8, s * 0.0018);
  keyPath(ctx, s);
  ctx.stroke();
}

const DRAW = { fern: drawFernInto, grass: drawGrassInto, key: drawKeyInto };

export function paintObject(canvas, object, unit, mode) {
  const w = Math.ceil(object.w * unit);
  const h = Math.ceil(object.h * unit);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  DRAW[object.id](ctx, unit, mode);
  ctx.restore();
  return canvas;
}

export function hitMask(object, unit) {
  const c = document.createElement("canvas");
  paintObject(c, object, unit, "mask");
  const grown = document.createElement("canvas");
  grown.width = c.width;
  grown.height = c.height;
  const ctx = grown.getContext("2d");
  const r = Math.max(2, unit * 0.016);
  ctx.drawImage(c, 0, 0);
  for (let k = 0; k < 12; k += 1) {
    const a = (k / 12) * Math.PI * 2;
    ctx.drawImage(c, Math.cos(a) * r, Math.sin(a) * r);
  }
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const alpha = new Uint8Array(c.width * c.height);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = data[i * 4 + 3];
  return { alpha, w: c.width, h: c.height };
}

export function buildLut(stops, size = 256) {
  const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const cols = stops.map(([p, c]) => [p, parse(c)]);
  const data = new Uint8Array(size * 4);
  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1);
    let k = 0;
    while (k < cols.length - 2 && t > cols[k + 1][0]) k += 1;
    const [p0, c0] = cols[k];
    const [p1, c1] = cols[k + 1];
    let f = Math.min(1, Math.max(0, (t - p0) / (p1 - p0)));
    f = f * f * (3 - 2 * f);
    for (let j = 0; j < 3; j += 1) data[i * 4 + j] = Math.round(c0[j] + (c1[j] - c0[j]) * f);
    data[i * 4 + 3] = 255;
  }
  return data;
}

export const LIVE_STOPS = [
  [0, "#2a0f2e"],
  [0.35, "#7a2f5e"],
  [0.7, "#d58c78"],
  [1, "#f4e6d4"],
];

export const FIXED_STOPS = [
  [0, "#3a1b24"],
  [0.35, "#8a4650"],
  [0.7, "#dba27f"],
  [1, "#f6ead6"],
];
