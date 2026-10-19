import { albumById } from "@/app/lab/_music/catalog";

export const SCENE_W = 480;
export const SCENE_H = 600;
export const SUBJECT = albumById("sgt-pepper");

const COVER = { x: 240, y: 258, size: 116, tilt: -0.035 };
const FIELD = { x: 240, y: 258, r: 246 };
const SPACING = 50;

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
  const cover = 1 - smooth(-2, 2, insideCover(u, v, 0));
  return 1 - 0.9 * cover;
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

function lightWall(ctx, rand) {
  const placed = [];
  const ring = 11;
  for (let i = 0; i < ring; i += 1) {
    const a = -Math.PI / 2 + (i / ring) * Math.PI * 2 + (rand() - 0.5) * 0.12;
    const r = 88 + (rand() - 0.5) * 6;
    const x = FIELD.x + Math.cos(a) * r;
    const y = FIELD.y + Math.sin(a) * r;
    placed.push([x, y]);
    bulb(ctx, x, y, 1.8, i % 4 === 2 ? [255, 150, 112] : [255, 206, 150], 0.95);
  }
  for (let tries = 0; tries < 4000 && placed.length < 120; tries += 1) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * FIELD.r;
    const x = FIELD.x + Math.cos(a) * r;
    const y = FIELD.y + Math.sin(a) * r;
    if (insideCover(x / SCENE_W, y / SCENE_H, 10) < 0) continue;
    if (placed.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < SPACING * SPACING)) continue;
    placed.push([x, y]);
    const pick = rand();
    const warm = pick > 0.93 ? [150, 196, 255] : pick > 0.84 ? [255, 132, 104] : pick > 0.45 ? [255, 206, 150] : [255, 186, 118];
    bulb(ctx, x, y, 1.5 + rand() * 0.5, warm, 0.6 + rand() * 0.4);
  }
}

export function buildScene(coverImg) {
  const canvas = document.createElement("canvas");
  canvas.width = SCENE_W;
  canvas.height = SCENE_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const rand = rng(41);
  BULBS.length = 0;

  ctx.fillStyle = "#050404";
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  lightWall(ctx, rand);

  ctx.save();
  ctx.translate(COVER.x, COVER.y);
  ctx.rotate(COVER.tilt);
  const half = COVER.size / 2;
  ctx.fillStyle = "#111";
  ctx.fillRect(-half, -half, COVER.size, COVER.size);
  if (coverImg) ctx.drawImage(coverImg, -half, -half, COVER.size, COVER.size);
  const light = ctx.createLinearGradient(-half, -half, half, half);
  light.addColorStop(0, "rgba(255,214,170,0.08)");
  light.addColorStop(0.4, "rgba(255,214,170,0)");
  light.addColorStop(0.75, "rgba(0,0,0,0.06)");
  light.addColorStop(1, "rgba(0,0,0,0.16)");
  ctx.fillStyle = light;
  ctx.fillRect(-half, -half, COVER.size, COVER.size);
  ctx.restore();
  return canvas;
}

export function lightAllowed(u, v) {
  return depthAt(u, v) > 0.6 && insideCover(u, v, 6) > 0;
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
