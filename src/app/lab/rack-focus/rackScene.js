export const LINE = ["i'll walk", "you home"];
export const TYPE_DEPTH = 2.4;
export const NEAR = 0.6;
export const PHI_MAX = 1 / NEAR;
export const BG_DEPTH = 34;

const SODIUM = [1, 0.5, 0.16];
const LED = [0.86, 0.92, 1];
const WARM = [1, 0.72, 0.4];
const RED = [1, 0.07, 0.04];
const AMBER = [1, 0.46, 0.06];
const CYAN = [0.2, 0.9, 1];
const MAGENTA = [1, 0.22, 0.62];
const HEAD = [1, 0.9, 0.74];

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

export function cameraFor(width, height) {
  const portrait = height > width * 1.1;
  const focal = Math.max(width * 0.86, height * 0.58);
  return {
    width,
    height,
    focal,
    eye: 1.6,
    horizon: height * (portrait ? 0.56 : 0.6),
    vanish: width * (portrait ? 0.6 : 0.56),
  };
}

export function project(cam, x, h, d) {
  return [cam.vanish + (x / d) * cam.focal, cam.horizon - ((h - cam.eye) / d) * cam.focal];
}

function lampRow(out, x, h, depths, color, energy, armDir) {
  depths.forEach((d, i) => out.push({ x: x + armDir * 1.4, h, d, color, energy: energy * (1 - i * 0.03), reflect: 1, lamp: { x, armDir } }));
}

export function buildLights() {
  const rand = rng(20261019);
  const out = [];
  lampRow(out, -5.6, 6.6, [9, 15, 23, 34, 50, 72, 104, 150], SODIUM, 1, 1);
  lampRow(out, 8.4, 6.4, [13, 21, 31, 46, 66, 96, 140], LED, 0.8, -1);
  out.push({ x: 1.6, h: 5.4, d: 41, color: RED, energy: 0.9, reflect: 1 });
  out.push({ x: 1.6, h: 5.0, d: 41, color: AMBER, energy: 0.06, reflect: 0 });
  out.push({ x: -3.8, h: 5.4, d: 58, color: RED, energy: 0.6, reflect: 1 });
  [
    [0.0, 0.0],
    [0.35, 0.12],
    [0.7, 0.05],
    [1.05, 0.18],
    [1.4, 0.04],
    [1.75, 0.14],
    [2.1, 0.0],
  ].forEach(([dx, dh], i) => out.push({ x: 7.1, h: 4.3 + dh, d: 10.5 + dx * 1.9, color: i % 3 === 2 ? MAGENTA : CYAN, energy: 0.32, reflect: 1 }));
  [0, 0.5, 1, 1.5].forEach((dx) => out.push({ x: 7.1, h: 3.7, d: 11 + dx * 1.9, color: MAGENTA, energy: 0.26, reflect: 1 }));
  const bulbs = 19;
  for (let i = 0; i < bulbs; i += 1) {
    const t = i / (bulbs - 1);
    const x = -5.2 + t * 12.6;
    const sag = 1.1 * (1 - Math.pow(2 * t - 1, 2));
    out.push({ x, h: 4.7 - sag + t * 0.2, d: 6.4 + t * 1.6, color: WARM, energy: 0.2 + rand() * 0.05, reflect: 0 });
  }
  [
    [1.3, 24],
    [1.0, 47],
    [1.6, 83],
  ].forEach(([x, d]) => {
    out.push({ x: x - 0.72, h: 0.8, d, color: RED, energy: 0.5, reflect: 1 });
    out.push({ x: x + 0.72, h: 0.8, d, color: RED, energy: 0.5, reflect: 1 });
  });
  [
    [-2.1, 36],
    [-2.3, 74],
  ].forEach(([x, d]) => {
    out.push({ x: x - 0.75, h: 0.7, d, color: HEAD, energy: 1.5, reflect: 1 });
    out.push({ x: x + 0.75, h: 0.7, d, color: HEAD, energy: 1.5, reflect: 1 });
  });
  const windows = (side, x) => {
    for (let k = 0; k < 70; k += 1) {
      const d = 18 + rand() * 90;
      const h = 3 + Math.floor(rand() * 7) * 3.1;
      if (rand() < 0.45) continue;
      const tint = rand() < 0.7 ? WARM : LED;
      out.push({ x: x + side * rand() * 1.5, h, d, color: tint, energy: 0.02 + rand() * 0.05, reflect: 0 });
    }
  };
  windows(-1, -10);
  windows(1, 12);
  for (let k = 0; k < 70; k += 1) {
    const d = 160 + rand() * 340;
    out.push({ x: (rand() - 0.5) * 220, h: rand() * rand() * 26, d, color: rand() < 0.55 ? SODIUM : rand() < 0.5 ? LED : WARM, energy: 0.04 + rand() * 0.09, reflect: 0 });
  }
  return out;
}

export function paintBackground(canvas, cam, scale, lights) {
  const { width, height, horizon } = cam;
  const cw = Math.max(1, Math.round(width * scale));
  const ch = Math.max(1, Math.round(height * scale));
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "rgb(4 6 14)");
  sky.addColorStop(0.45, "rgb(9 11 26)");
  sky.addColorStop(0.78, "rgb(24 20 34)");
  sky.addColorStop(0.93, "rgb(52 34 36)");
  sky.addColorStop(1, "rgb(70 44 36)");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, horizon + 1);

  const road = ctx.createLinearGradient(0, horizon, 0, height);
  road.addColorStop(0, "rgb(30 24 26)");
  road.addColorStop(0.12, "rgb(16 14 18)");
  road.addColorStop(0.5, "rgb(9 9 12)");
  road.addColorStop(1, "rgb(5 5 7)");
  ctx.fillStyle = road;
  ctx.fillRect(0, horizon, width, height - horizon);

  const quad = (pts, fill) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const near = 2.4;
  const far = 600;
  const P = (x, h, d) => project(cam, x, h, d);
  quad([P(-10, 0, near), P(-10, 0, far), P(-4.2, 0, far), P(-4.2, 0, near)], "rgb(12 11 14)");
  quad([P(6.6, 0, near), P(6.6, 0, far), P(12, 0, far), P(12, 0, near)], "rgb(12 11 14)");
  quad([P(-10, 0, near), P(-10, 26, near), P(-10, 26, 130), P(-10, 0, 130)], "rgb(6 6 10)");
  quad([P(12, 0, near), P(12, 22, near), P(12, 22, 120), P(12, 0, 120)], "rgb(7 6 10)");
  const skyline = rng(7);
  for (let i = 0; i < 26; i += 1) {
    const x = -70 + i * 6 + skyline() * 3;
    const h = 8 + skyline() * 34;
    const d = 160 + skyline() * 80;
    const w = 4 + skyline() * 7;
    quad([P(x, 0, d), P(x, h, d), P(x + w, h, d), P(x + w, 0, d)], `rgb(${8 + Math.round(skyline() * 6)} 8 14)`);
  }

  ctx.lineCap = "round";
  lights.forEach((l) => {
    if (!l.lamp) return;
    const [bx, by] = P(l.lamp.x, 0, l.d);
    const [tx, ty] = P(l.lamp.x, l.h + 0.25, l.d);
    const [hx, hy] = P(l.x, l.h + 0.12, l.d);
    ctx.strokeStyle = "rgb(3 3 5)";
    ctx.lineWidth = Math.max(0.6, (0.22 / l.d) * cam.focal);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(tx, ty);
    ctx.lineTo(hx, hy);
    ctx.stroke();
  });

  lights.forEach((l) => {
    if (!l.reflect) return;
    const [x] = P(l.x, l.h, l.d);
    const [, yRoad] = P(l.x, 0, l.d);
    const [, yRef] = P(l.x, -l.h, l.d);
    const g = ctx.createLinearGradient(0, yRoad, 0, Math.min(height, yRef + (yRef - yRoad) * 1.4));
    const c = l.color.map((v) => Math.round(v * 255));
    const a = Math.min(0.14, 0.03 + l.energy * 0.08);
    g.addColorStop(0, `rgb(${c[0]} ${c[1]} ${c[2]} / 0)`);
    g.addColorStop(0.3, `rgb(${c[0]} ${c[1]} ${c[2]} / ${a})`);
    g.addColorStop(0.65, `rgb(${c[0]} ${c[1]} ${c[2]} / ${a * 0.45})`);
    g.addColorStop(1, `rgb(${c[0]} ${c[1]} ${c[2]} / 0)`);
    const w = Math.max(3, (0.9 / l.d) * cam.focal);
    ctx.save();
    ctx.filter = `blur(${Math.max(4, w * 0.6).toFixed(1)}px)`;
    ctx.fillStyle = g;
    ctx.fillRect(x - w / 2, yRoad, w, Math.min(height, yRef + (yRef - yRoad) * 1.4) - yRoad);
    ctx.restore();
  });

  const haze = ctx.createRadialGradient(cam.vanish, horizon, 0, cam.vanish, horizon, width * 0.6);
  haze.addColorStop(0, "rgb(120 70 40 / 0.22)");
  haze.addColorStop(0.35, "rgb(80 50 40 / 0.1)");
  haze.addColorStop(0.7, "rgb(40 30 40 / 0.03)");
  haze.addColorStop(1, "rgb(0 0 0 / 0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, width, height);
}

export function typeLayout(width, height, family, measure) {
  const narrow = width < 640;
  const lines = narrow ? LINE : [LINE.join(" ")];
  const probe = 100;
  measure.font = `500 ${probe}px ${family}`;
  const widest = Math.max(...lines.map((l) => measure.measureText(l).width));
  const target = width * (narrow ? 0.8 : 0.56);
  const size = Math.max(32, Math.min(narrow ? 76 : 112, (probe * target) / widest));
  const lead = size * 1.04;
  const top = height * (narrow ? 0.43 : 0.5) - ((lines.length - 1) * lead) / 2;
  return { lines, size, lead, top };
}

export function paintType(canvas, width, height, scale, family) {
  const cw = Math.max(1, Math.round(width * scale));
  const ch = Math.max(1, Math.round(height * scale));
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const layout = typeLayout(width, height, family, ctx);
  ctx.font = `500 ${layout.size}px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  layout.lines.forEach((line, i) => ctx.fillText(line, width / 2, layout.top + i * layout.lead));
  const boxes = layout.lines.map((line, i) => {
    const w = ctx.measureText(line).width;
    return { x0: width / 2 - w / 2, x1: width / 2 + w / 2, y0: layout.top + i * layout.lead - layout.size * 0.5, y1: layout.top + i * layout.lead + layout.size * 0.5 };
  });
  return boxes;
}

export const MARKS = [0.6, 0.7, 0.8, 1, 1.2, 1.5, 2, 3, 5, 10, Infinity];

export function distanceLabel(phi) {
  if (phi < 0.02) return "∞";
  const d = 1 / phi;
  if (d >= 10) return `${Math.round(d)} m`;
  return `${d.toFixed(1)} m`;
}
