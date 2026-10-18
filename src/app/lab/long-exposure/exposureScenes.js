import { albumById } from "@/app/lab/_music/catalog";

export const SCENE_ALBUM = albumById("abbey-road");

export const LIGHTS = [
  { id: "rose", label: "Rose", rgb: [1.0, 0.12, 0.4], swatch: "rgb(255 92 156)" },
  { id: "amber", label: "Amber", rgb: [1.0, 0.36, 0.06], swatch: "rgb(255 160 64)" },
  { id: "ice", label: "Ice", rgb: [0.16, 0.56, 1.0], swatch: "rgb(120 196 255)" },
];

export const LAMPS = [];

export function paintScene(cover) {
  const W = 800;
  const H = 1000;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  const horizon = H * 0.7;
  const wall = ctx.createLinearGradient(0, 0, 0, horizon);
  wall.addColorStop(0, "#07070a");
  wall.addColorStop(1, "#1d1c22");
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, W, horizon);
  const floor = ctx.createLinearGradient(0, horizon, 0, H);
  floor.addColorStop(0, "#26252b");
  floor.addColorStop(1, "#0a0a0d");
  ctx.fillStyle = floor;
  ctx.fillRect(0, horizon, W, H - horizon);
  const pool = ctx.createRadialGradient(W * 0.5, horizon, 0, W * 0.5, horizon, W * 0.75);
  pool.addColorStop(0, "rgb(255 250 240 / 0.12)");
  pool.addColorStop(1, "rgb(255 250 240 / 0)");
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, W, H);
  const S = W * 0.44;
  const x = (W - S) / 2 - S * 0.12;
  const base = H * 0.78;
  const y = base - S;
  const disc = S * 0.96;
  const dx = x + S * 0.52 + disc / 2;
  const dy = y + S / 2;
  const shadow = ctx.createRadialGradient(W * 0.54, base, 0, W * 0.54, base, S * 0.95);
  shadow.addColorStop(0, "rgb(0 0 0 / 0.55)");
  shadow.addColorStop(1, "rgb(0 0 0 / 0)");
  ctx.save();
  ctx.translate(0, base);
  ctx.scale(1, 0.12);
  ctx.fillStyle = shadow;
  ctx.fillRect(0, -S, W, S * 2);
  ctx.restore();
  const drawRecord = () => {
    ctx.fillStyle = "#0c0c0e";
    ctx.beginPath();
    ctx.arc(dx, dy, disc / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1;
    for (let r = disc * 0.2; r < disc * 0.49; r += 3) {
      ctx.strokeStyle = `rgb(255 255 255 / ${0.03 + 0.03 * Math.sin(r * 0.21)})`;
      ctx.beginPath();
      ctx.arc(dx, dy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    const sheen = ctx.createLinearGradient(dx - disc / 2, dy - disc / 2, dx + disc / 2, dy + disc / 2);
    sheen.addColorStop(0.3, "rgb(255 255 255 / 0)");
    sheen.addColorStop(0.45, "rgb(255 255 255 / 0.1)");
    sheen.addColorStop(0.6, "rgb(255 255 255 / 0)");
    ctx.fillStyle = sheen;
    ctx.beginPath();
    ctx.arc(dx, dy, disc / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#7fb046";
    ctx.beginPath();
    ctx.arc(dx, dy, disc * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0c0c0e";
    ctx.beginPath();
    ctx.arc(dx, dy, disc * 0.012, 0, Math.PI * 2);
    ctx.fill();
  };
  const drawSleeve = () => {
    ctx.drawImage(cover, x, y, S, S);
    const gloss = ctx.createLinearGradient(x, y, x + S, y + S);
    gloss.addColorStop(0, "rgb(255 255 255 / 0.08)");
    gloss.addColorStop(0.5, "rgb(255 255 255 / 0)");
    gloss.addColorStop(1, "rgb(0 0 0 / 0.2)");
    ctx.fillStyle = gloss;
    ctx.fillRect(x, y, S, S);
    ctx.strokeStyle = "rgb(255 255 255 / 0.18)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.75, y + 0.75, S - 1.5, S - 1.5);
  };
  drawRecord();
  drawSleeve();
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, base, W, H - base);
  ctx.clip();
  ctx.translate(0, base * 2);
  ctx.scale(1, -1);
  ctx.globalAlpha = 0.22;
  drawRecord();
  drawSleeve();
  ctx.restore();
  const fade = ctx.createLinearGradient(0, base, 0, base + S * 0.6);
  fade.addColorStop(0, "rgb(10 10 13 / 0.35)");
  fade.addColorStop(1, "rgb(10 10 13 / 1)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, base, W, H - base);
  return c;
}

function tremor(t, seed) {
  return [
    0.0024 * Math.sin(t * 41 + seed) + 0.0014 * Math.sin(t * 83 + seed * 2.3),
    0.0024 * Math.sin(t * 37 + seed * 1.7) + 0.0014 * Math.sin(t * 71 + seed * 0.6),
  ];
}

function coil(u) {
  const turns = 5.5;
  const a = Math.PI * 2 * turns * u;
  const swell = 0.75 + 0.25 * Math.sin(Math.PI * u);
  return [0.13 + 0.74 * u + 0.075 * Math.cos(a + Math.PI) * swell, 0.36 + 0.11 * Math.sin(a) * swell];
}

function infinity(u) {
  const a = Math.PI * 2 * u * 1.5 - Math.PI * 0.5;
  return [0.5 + 0.34 * Math.cos(a), 0.52 + 0.12 * Math.sin(a * 2) + 0.02 * Math.sin(u * 9)];
}

function spiral(u) {
  const a = Math.PI * 2 * 2.3 * u + 0.4;
  const r = 0.26 - 0.17 * u;
  return [0.5 + r * Math.cos(a), 0.42 + r * 1.05 * Math.sin(a)];
}

function wave(u) {
  const a = Math.PI * 2 * 3 * u;
  return [0.1 + 0.8 * u, 0.62 - 0.1 * Math.sin(a) * (0.3 + 0.7 * u) - 0.06 * u];
}

export const FIGURES = { coil, infinity, spiral, wave };

export function figurePath(name, seconds, seed = 0) {
  const fn = FIGURES[name] || coil;
  return (t) => {
    const raw = Math.min(1, Math.max(0, t / seconds));
    const u = raw + 0.025 * Math.sin(raw * Math.PI * 6 + seed) * Math.sin(raw * Math.PI);
    const [x, y] = fn(Math.min(1, Math.max(0, u)));
    const [jx, jy] = tremor(t, seed);
    return [x + jx, y + jy];
  };
}

export const SEED_SHOTS = [
  { strokes: [{ figure: "spiral", light: 2, from: 0.6, seconds: 4.2 }], seconds: 6.4 },
  { strokes: [{ figure: "wave", light: 1, from: 0.4, seconds: 3.6 }], seconds: 5.1 },
  {
    strokes: [
      { figure: "infinity", light: 1, from: 0.5, seconds: 4.4 },
      { figure: "coil", light: 0, from: 5.2, seconds: 3.4 },
    ],
    seconds: 9.6,
  },
];

export const AUTO_FIGURES = ["coil", "infinity", "spiral", "wave"];
