import { albumById } from "@/app/lab/_music/catalog";

export const SCENE_W = 480;
export const SCENE_H = 600;
export const SUBJECT = albumById("revolver");

const COVER = { x: 240, y: 318, size: 176, tilt: -0.045 };
const SHELF_Y = 420;

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

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function insideCover(u, v, pad) {
  const x = u * SCENE_W - COVER.x;
  const y = v * SCENE_H - COVER.y;
  const c = Math.cos(-COVER.tilt);
  const s = Math.sin(-COVER.tilt);
  const lx = x * c - y * s;
  const ly = x * s + y * c;
  const half = COVER.size / 2 + pad;
  return Math.max(Math.abs(lx), Math.abs(ly)) - half;
}

export function depthAt(u, v) {
  const y = v * SCENE_H;
  let d = 1 - 0.1 * smooth(0, 0.3, v);
  const shelf = smooth(SHELF_Y - 150, SHELF_Y - 120, y) * (1 - smooth(SHELF_Y - 6, SHELF_Y + 4, y));
  d = d * (1 - shelf) + 0.5 * shelf;
  const front = smooth(SHELF_Y - 4, SHELF_Y + 6, y);
  d = d * (1 - front) + (0.1 + 0.25 * smooth(SHELF_Y + 40, SCENE_H, y)) * front;
  const cover = 1 - smooth(-3, 3, insideCover(u, v, 0));
  return d * (1 - cover) + 0.1 * cover;
}

const BULBS = [];

function bulb(ctx, x, y, r, warm, power) {
  BULBS.push([x, y, warm[2] > warm[0] * 0.9 ? 2 : warm[1] < warm[0] * 0.6 ? 1 : 0]);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
  g.addColorStop(0, `rgba(255,255,255,${power})`);
  g.addColorStop(0.18, `rgba(${warm[0]},${warm[1]},${warm[2]},${power})`);
  g.addColorStop(0.4, `rgba(${warm[0]},${warm[1] * 0.7},${warm[2] * 0.4},${power * 0.25})`);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
  ctx.fill();
}

function festoon(ctx, rand, x0, y0, x1, y1, sag, count, size, power) {
  const pts = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t + sag * 4 * t * (1 - t);
    pts.push([x, y]);
  }
  ctx.strokeStyle = "rgba(30,22,16,0.9)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  const palette = [
    [255, 196, 120],
    [255, 178, 96],
    [255, 210, 150],
    [255, 160, 90],
  ];
  pts.forEach(([x, y], i) => {
    if (i === 0 || i === count) return;
    const warm = rand() > 0.88 ? [255, 120, 110] : palette[Math.floor(rand() * palette.length)];
    bulb(ctx, x + (rand() - 0.5) * 2, y + 4 + rand() * 2, size * (0.8 + rand() * 0.4), warm, power * (0.75 + rand() * 0.25));
  });
}

export function buildScene(coverImg) {
  const canvas = document.createElement("canvas");
  canvas.width = SCENE_W;
  canvas.height = SCENE_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const rand = rng(23);
  BULBS.length = 0;

  const wall = ctx.createLinearGradient(0, 0, 0, SCENE_H);
  wall.addColorStop(0, "#0b0807");
  wall.addColorStop(0.35, "#1a110c");
  wall.addColorStop(0.62, "#24160e");
  wall.addColorStop(0.7, "#120c09");
  wall.addColorStop(1, "#070505");
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);

  const lamp = ctx.createRadialGradient(330, 250, 0, 330, 250, 300);
  lamp.addColorStop(0, "rgba(160,84,40,0.42)");
  lamp.addColorStop(0.35, "rgba(110,52,26,0.2)");
  lamp.addColorStop(0.7, "rgba(60,26,14,0.06)");
  lamp.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = lamp;
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);

  const teal = ctx.createRadialGradient(70, 160, 0, 70, 160, 200);
  teal.addColorStop(0, "rgba(40,90,110,0.32)");
  teal.addColorStop(0.5, "rgba(20,50,64,0.12)");
  teal.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = teal;
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);

  festoon(ctx, rand, -30, 70, 520, 40, 70, 13, 2.6, 1);
  festoon(ctx, rand, -20, 150, 510, 175, 60, 15, 2.2, 0.95);
  festoon(ctx, rand, -40, 228, 530, 214, 34, 18, 1.8, 0.85);
  for (let i = 0; i < 26; i += 1) {
    const x = rand() * SCENE_W;
    const y = 20 + rand() * 240;
    const hue = rand();
    const warm = hue > 0.8 ? [140, 190, 255] : hue > 0.65 ? [255, 120, 150] : [255, 190, 120];
    bulb(ctx, x, y, 1.1 + rand() * 0.8, warm, 0.55 + rand() * 0.3);
  }

  const shelfTop = SHELF_Y - 132;
  const spines = ["#7a2e22", "#c8b07a", "#203a4a", "#9a6a2a", "#3c2a40", "#5e6a3a", "#8a3a2e", "#d0c4a8", "#2a2a2a", "#6a4a32", "#24405a", "#a0502a"];
  let x = -6;
  while (x < SCENE_W + 6) {
    const w = 3 + rand() * 6;
    const lean = (rand() - 0.5) * 0.04;
    const top = shelfTop + rand() * 14;
    ctx.save();
    ctx.translate(x, SHELF_Y);
    ctx.rotate(lean);
    const tone = ctx.createLinearGradient(0, top - SHELF_Y, 0, 0);
    const base = spines[Math.floor(rand() * spines.length)];
    tone.addColorStop(0, base);
    tone.addColorStop(0.5, base);
    tone.addColorStop(1, "#0a0706");
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = tone;
    ctx.fillRect(0, top - SHELF_Y, w, SHELF_Y - top);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#000";
    ctx.fillRect(w - 0.8, top - SHELF_Y, 0.8, SHELF_Y - top);
    ctx.restore();
    x += w + rand() * 0.6;
  }
  ctx.globalAlpha = 1;
  const shade = ctx.createLinearGradient(0, shelfTop - 10, 0, SHELF_Y);
  shade.addColorStop(0, "rgba(10,7,6,0.5)");
  shade.addColorStop(0.3, "rgba(10,7,6,0)");
  shade.addColorStop(1, "rgba(10,7,6,0.35)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, shelfTop - 10, SCENE_W, SHELF_Y - shelfTop + 10);

  const edge = ctx.createLinearGradient(0, SHELF_Y, 0, SCENE_H);
  edge.addColorStop(0, "#5a3e2a");
  edge.addColorStop(0.03, "#3a2618");
  edge.addColorStop(0.2, "#21150e");
  edge.addColorStop(1, "#0b0706");
  ctx.fillStyle = edge;
  ctx.fillRect(0, SHELF_Y, SCENE_W, SCENE_H - SHELF_Y);
  for (let i = 0; i < 40; i += 1) {
    ctx.globalAlpha = 0.05 + rand() * 0.05;
    ctx.fillStyle = rand() > 0.5 ? "#000" : "#6a4a32";
    ctx.fillRect(0, SHELF_Y + 6 + rand() * (SCENE_H - SHELF_Y), SCENE_W, 0.6 + rand());
  }
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(COVER.x, COVER.y);
  ctx.rotate(COVER.tilt);
  const half = COVER.size / 2;
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetX = 6;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = "#111";
  ctx.fillRect(-half, -half, COVER.size, COVER.size);
  ctx.shadowColor = "transparent";
  if (coverImg) ctx.drawImage(coverImg, -half, -half, COVER.size, COVER.size);
  const light = ctx.createLinearGradient(-half, -half, half, half);
  light.addColorStop(0, "rgba(255,190,130,0.1)");
  light.addColorStop(0.45, "rgba(255,190,130,0)");
  light.addColorStop(0.8, "rgba(0,0,0,0.18)");
  light.addColorStop(1, "rgba(0,0,0,0.32)");
  ctx.fillStyle = light;
  ctx.fillRect(-half, -half, COVER.size, COVER.size);
  ctx.restore();

  const dim = ctx.getImageData(0, 0, SCENE_W, SCENE_H);
  const px = dim.data;
  for (let y = 0; y < SCENE_H; y += 1) {
    for (let xx = 0; xx < SCENE_W; xx += 1) {
      if (insideCover(xx / SCENE_W, y / SCENE_H, 2) > 0) continue;
      const i = (y * SCENE_W + xx) * 4;
      px[i] *= 0.86;
      px[i + 1] *= 0.84;
      px[i + 2] *= 0.82;
    }
  }
  ctx.putImageData(dim, 0, 0);
  return canvas;
}

export function lightAllowed(u, v) {
  return depthAt(u, v) > 0.6 && insideCover(u, v, 8) > 0;
}

export function hueAt(u, v) {
  const x = u * SCENE_W;
  const y = v * SCENE_H;
  let best = 0;
  let bestD = 36;
  for (const [bx, by, hue] of BULBS) {
    const d = (bx - x) ** 2 + (by - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = hue;
    }
  }
  return best;
}
