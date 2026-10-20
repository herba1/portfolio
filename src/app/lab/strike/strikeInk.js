export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CLOG = { e: 0.8, a: 0.7, o: 0.4, g: 0.7, 8: 0.6, s: 0.25, d: 0.3, b: 0.35, p: 0.3, q: 0.3, 6: 0.4, 9: 0.4, m: 0.2, "@": 0.9 };
const HEAVY = new Set([".", ",", ";", ":", "!", "?", "'", '"', "-"]);
const wear = new Map();

function wearOf(ch) {
  const hit = wear.get(ch);
  if (hit) return hit;
  const r = seeded(ch.charCodeAt(0) * 7919 + 131);
  const off = r() < 0.22 ? (r() - 0.5) * 0.09 : 0;
  const w = {
    dx: (r() - 0.5) * 0.05,
    dy: (r() - 0.5) * 0.05 + off,
    rot: (r() - 0.5) * 0.03,
    density: 0.8 + r() * 0.2,
    tiltAngle: r() * Math.PI * 2,
    tilt: 0.15 + r() * 0.4,
    clog: CLOG[ch] ?? r() * 0.1,
  };
  wear.set(ch, w);
  return w;
}

function ribbonTile() {
  const size = 192;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  const r = seeded(4242);
  const TAU = Math.PI * 2;
  const period = 3;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const warp = 0.5 + 0.5 * Math.cos((TAU * (x + 0.5)) / period);
      const weft = 0.5 + 0.5 * Math.cos((TAU * (y + 0.5)) / period);
      const over = (Math.floor(x / period) + Math.floor(y / period)) % 2 === 0 ? warp : weft;
      const thread = Math.max(warp * 0.7, weft * 0.7, over);
      const blotch = 0.5 + 0.25 * Math.sin((TAU * x) / size + 1.3) * Math.sin((TAU * 2 * y) / size) + 0.25 * Math.sin((TAU * 3 * (x + y)) / size);
      let v = 0.66 + 0.4 * (0.5 * thread + 0.25 * r() + 0.25 * blotch);
      if (r() < 0.025) v *= 0.3;
      const i = (y * size + x) * 4;
      img.data[i] = 26;
      img.data[i + 1] = 25;
      img.data[i + 2] = 28;
      img.data[i + 3] = Math.round(Math.min(1, v) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function createInk(family) {
  const ribbon = ribbonTile();
  const scratch = document.createElement("canvas");
  const g = scratch.getContext("2d", { willReadFrequently: true });
  let cell = 0;
  let pattern = null;

  const strike = (ctx, s, metrics) => {
    const { size, dpr, charW } = metrics;
    const need = Math.ceil(size * 1.8 * dpr);
    if (need !== cell) {
      cell = need;
      scratch.width = cell;
      scratch.height = cell;
    }
    const w = wearOf(s.ch);
    const heavy = HEAVY.has(s.ch);
    const ox = cell * 0.3;
    const oy = cell * 0.7;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.clearRect(0, 0, cell, cell);
    g.font = `${size * dpr}px ${family}`;
    g.textBaseline = "alphabetic";
    g.fillStyle = "#000";
    g.strokeStyle = "#000";
    g.lineJoin = "round";
    g.lineWidth = size * dpr * 0.035 * s.weight;
    g.fillText(s.ch, ox, oy);
    g.strokeText(s.ch, ox, oy);
    g.globalCompositeOperation = "source-in";
    if (!pattern) pattern = g.createPattern(ribbon, "repeat");
    g.save();
    g.translate(-Math.floor(s.rx * 192), -Math.floor(s.ry * 192));
    g.fillStyle = pattern;
    g.fillRect(0, 0, cell + 192, cell + 192);
    g.restore();
    g.globalCompositeOperation = "destination-out";
    const a = w.tiltAngle + s.ta;
    const cx = ox + charW * dpr * 0.5;
    const cy = oy - size * dpr * 0.35;
    const reach = size * dpr * 0.6;
    const grad = g.createLinearGradient(cx - Math.cos(a) * reach, cy - Math.sin(a) * reach, cx + Math.cos(a) * reach, cy + Math.sin(a) * reach);
    const tilt = Math.min(0.7, w.tilt * s.tiltMul);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.45, `rgba(0,0,0,${tilt * 0.25})`);
    grad.addColorStop(1, `rgba(0,0,0,${tilt})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, cell, cell);
    g.globalCompositeOperation = "source-over";

    const density = Math.min(1, w.density * s.density * (heavy ? 1.18 : 1));
    const px = s.x * dpr + (w.dx * size + s.jx) * dpr - ox;
    const py = s.y * dpr + (w.dy * size + s.jy) * dpr - oy;
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.translate(px + ox, py + oy);
    ctx.rotate(w.rot + s.rot);
    ctx.translate(-ox, -oy);
    const bleed = 0.4 * dpr;
    ctx.globalAlpha = density * 0.2;
    ctx.drawImage(scratch, -bleed, 0);
    ctx.drawImage(scratch, bleed, 0);
    ctx.drawImage(scratch, 0, -bleed);
    ctx.drawImage(scratch, 0, bleed);
    ctx.globalAlpha = density;
    ctx.drawImage(scratch, 0, 0);
    if (heavy) {
      ctx.globalAlpha = density * 0.55;
      ctx.drawImage(scratch, 0.25 * dpr, 0.2 * dpr);
    }
    if (w.clog > 0.2 && s.clog) {
      g.globalCompositeOperation = "source-in";
      g.fillStyle = "#1a191c";
      g.fillRect(0, 0, cell, cell);
      g.globalCompositeOperation = "source-over";
      ctx.globalAlpha = density * w.clog * 0.35;
      ctx.drawImage(scratch, 0, 0);
    }
    if (s.ghost) {
      ctx.globalAlpha = density * 0.2;
      ctx.drawImage(scratch, s.ghost * dpr, -0.25 * dpr);
    }
    ctx.restore();
  };

  return { strike, heavy: (ch) => HEAVY.has(ch) };
}
