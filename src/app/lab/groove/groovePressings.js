export const SLOTS = 36;
export const STROBE_HZ = 20;
export const RPM = 100 / 3;
export const NOMINAL = (RPM * 360) / 60;

const TAU = Math.PI * 2;
const CYCLE = 12;

export const DISC = {
  hole: 0.024,
  label: 0.335,
  runout: 0.39,
  inner: 0.41,
  outer: 0.962,
  rim: 0.985,
};

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

const frameOf = (k) => (CYCLE - (k % CYCLE)) % CYCLE;

function circle(ctx, r) {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
}

function ring(ctx, r0, r1) {
  ctx.beginPath();
  ctx.arc(0, 0, r1, 0, TAU);
  ctx.arc(0, 0, r0, 0, TAU, true);
}

function eachSlot(ctx, radius, draw) {
  for (let k = 0; k < SLOTS; k += 1) {
    const a = (k / SLOTS) * TAU;
    ctx.save();
    ctx.rotate(a);
    ctx.translate(0, -radius);
    draw(frameOf(k), k);
    ctx.restore();
  }
}

function grooves(ctx, R, { from, to, ink, alpha, seed, bands = [] }) {
  const rand = mulberry(seed);
  const count = Math.round((to - from) * R * 0.9);
  ctx.save();
  ctx.lineWidth = Math.max(0.6, R / 900);
  for (let i = 0; i < count; i += 1) {
    const r = from + ((to - from) * (i + rand() * 0.6)) / count;
    if (bands.some((b) => Math.abs(r - b) < 0.006)) continue;
    ctx.strokeStyle = ink;
    ctx.globalAlpha = alpha * (0.45 + rand() * 0.55);
    circle(ctx, r * R);
    ctx.stroke();
  }
  ctx.restore();
}

function rim(ctx, R, color) {
  ctx.save();
  ring(ctx, DISC.rim * R, R);
  ctx.fillStyle = color;
  ctx.fill("evenodd");
  ctx.restore();
}

function labelText(ctx, R, { font, ink, top, middle, bottom }) {
  ctx.save();
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (top) {
    ctx.font = `560 ${Math.round(R * 0.04)}px ${font}`;
    ctx.fillText(top, 0, -R * 0.2);
  }
  if (middle) {
    ctx.font = `600 ${Math.round(R * 0.085)}px ${font}`;
    ctx.fillText(middle, 0, -R * 0.1);
  }
  if (bottom) {
    ctx.font = `460 ${Math.round(R * 0.034)}px ${font}`;
    ctx.fillText(bottom, 0, R * 0.17);
  }
  ctx.restore();
}

function bird(ctx, s, frame, ink) {
  const p = (frame / CYCLE) * TAU;
  const w = Math.sin(p);
  const lift = Math.cos(p) * 0.08;
  ctx.save();
  ctx.scale(s, s);
  ctx.translate(0, lift);
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.46, 0.15, -0.08, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-0.42, -0.06, 0.13, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-0.53, -0.08);
  ctx.lineTo(-0.7, -0.03);
  ctx.lineTo(-0.53, 0.0);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0.38, -0.02);
  ctx.lineTo(0.78, -0.16 + w * 0.05);
  ctx.lineTo(0.74, 0.1 + w * 0.04);
  ctx.closePath();
  ctx.fill();
  const tipY = -w * 0.86;
  const tipX = 0.2 + Math.abs(w) * 0.06;
  ctx.beginPath();
  ctx.moveTo(-0.2, -0.06);
  ctx.quadraticCurveTo(-0.12, tipY * 0.55 - 0.08, tipX, tipY);
  ctx.quadraticCurveTo(0.12, tipY * 0.35, 0.18, -0.02);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(-0.1, -0.08);
  ctx.quadraticCurveTo(0.0, tipY * 0.42 - 0.06, tipX + 0.18, tipY * 0.8);
  ctx.quadraticCurveTo(0.2, tipY * 0.28, 0.26, -0.04);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function ball(ctx, R, frame, ink, shade) {
  const t = frame / CYCLE;
  const h = 4 * t * (1 - t);
  const squash = Math.max(0, 1 - h * 5);
  const sx = 1 + squash * 0.34;
  const sy = 1 - squash * 0.32;
  const r = R * 0.024;
  ctx.save();
  ctx.fillStyle = shade;
  ctx.globalAlpha = 0.5 + 0.5 * (1 - h);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * (0.5 + 0.7 * (1 - h)), R * 0.005, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = ink;
  const y = -r * sy - h * R * 0.12;
  ctx.beginPath();
  ctx.ellipse(0, y, r * sx, r * sy, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function star(ctx, s, frame, ink) {
  const a = (frame / CYCLE) * (Math.PI / 2);
  ctx.save();
  ctx.scale(s, s);
  ctx.rotate(a);
  ctx.fillStyle = ink;
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const r = i % 2 ? 0.16 : 0.5;
    const th = (i / 8) * TAU;
    ctx.lineTo(Math.sin(th) * r, -Math.cos(th) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFlight(ctx, R, { font }) {
  const paper = "#f3ecdd";
  const navy = "#1e2a46";
  const red = "#d0452e";
  circle(ctx, R);
  ctx.fillStyle = paper;
  ctx.fill();
  ctx.save();
  ctx.strokeStyle = navy;
  ctx.lineWidth = R * 0.003;
  for (const r of [0.955, 0.705, 0.505, 0.345]) {
    circle(ctx, r * R);
    ctx.stroke();
  }
  ctx.restore();
  eachSlot(ctx, R * 0.835, (f) => {
    bird(ctx, R * 0.082, f, navy);
  });
  eachSlot(ctx, R * 0.505, (f) => {
    ball(ctx, R, f, red, navy);
  });
  eachSlot(ctx, R * 0.423, (f) => {
    star(ctx, R * 0.05, f, navy);
  });
  labelText(ctx, R, { font, ink: navy, middle: "33⅓", bottom: "Zoetrope, side A" });
  grooves(ctx, R, { from: DISC.inner + 0.005, to: DISC.outer, ink: "#7d725e", alpha: 0.08, seed: 3 });
  rim(ctx, R, "rgb(190 178 152 / 0.55)");
}

function drawPulse(ctx, R, { font }) {
  const paper = "#f4f1ea";
  const ink = "#141414";
  const red = "#d63a2a";
  circle(ctx, R);
  ctx.fillStyle = paper;
  ctx.fill();
  const rings = [0.405, 0.49, 0.585, 0.69, 0.805, 0.925];
  rings.forEach((r, j) => {
    const pitch = (TAU * r) / SLOTS;
    for (let k = 0; k < SLOTS; k += 1) {
      const f = (frameOf(k) + j * 2) % CYCLE;
      const wave = 0.5 - 0.5 * Math.cos((f / CYCLE) * TAU);
      const size = pitch * (0.08 + 0.34 * wave);
      const a = (k / SLOTS) * TAU;
      ctx.save();
      ctx.rotate(a);
      ctx.translate(0, -r * R);
      ctx.fillStyle = j === 3 ? red : ink;
      ctx.beginPath();
      ctx.arc(0, 0, size * R, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  });
  circle(ctx, DISC.label * R);
  ctx.fillStyle = ink;
  ctx.fill();
  labelText(ctx, R, { font, ink: paper, middle: "33⅓", bottom: "Zoetrope, side B" });
  grooves(ctx, R, { from: DISC.inner - 0.02, to: DISC.outer, ink: "#6f6a60", alpha: 0.07, seed: 7 });
  rim(ctx, R, "rgb(180 174 162 / 0.5)");
}

function drawPicture(ctx, R) {
  ctx.save();
  circle(ctx, R);
  ctx.clip();
  const sky = ctx.createLinearGradient(0, -R, 0, R * 0.2);
  sky.addColorStop(0, "#22305e");
  sky.addColorStop(0.3, "#4a3f78");
  sky.addColorStop(0.55, "#b4567a");
  sky.addColorStop(0.78, "#ee8a5c");
  sky.addColorStop(1, "#f7c06b");
  ctx.fillStyle = sky;
  ctx.fillRect(-R, -R, 2 * R, 2 * R);
  ctx.fillStyle = "#fbe4a6";
  ctx.beginPath();
  ctx.arc(R * 0.04, R * 0.12, R * 0.3, 0, TAU);
  ctx.fill();
  const hills = [
    { y: 0.16, amp: 0.1, freq: 2.2, phase: 0.4, color: "#7c3f68" },
    { y: 0.27, amp: 0.08, freq: 3.1, phase: 1.7, color: "#4c2b57" },
  ];
  hills.forEach((h) => {
    ctx.beginPath();
    ctx.moveTo(-R, R);
    for (let x = -1; x <= 1.001; x += 0.02) {
      const y = h.y - h.amp * (0.6 + 0.4 * Math.sin(x * h.freq * Math.PI + h.phase)) * Math.cos(x * 1.2);
      ctx.lineTo(x * R, y * R);
    }
    ctx.lineTo(R, R);
    ctx.closePath();
    ctx.fillStyle = h.color;
    ctx.fill();
  });
  ctx.fillStyle = "#1f2148";
  ctx.fillRect(-R, R * 0.36, 2 * R, R);
  ctx.strokeStyle = "#f7c06b";
  ctx.lineCap = "round";
  for (let i = 0; i < 9; i += 1) {
    const y = 0.42 + i * 0.06;
    const half = 0.34 - i * 0.03;
    ctx.globalAlpha = 0.85 - i * 0.07;
    ctx.lineWidth = R * (0.014 - i * 0.0008);
    ctx.beginPath();
    ctx.moveTo(-half * R + R * 0.04, y * R);
    ctx.lineTo(half * R + R * 0.04, y * R);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#fbe4a6";
  const rand = mulberry(11);
  for (let i = 0; i < 70; i += 1) {
    const a = rand() * TAU;
    const r = Math.sqrt(rand()) * 0.95;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (y > -0.2) continue;
    ctx.globalAlpha = 0.4 + rand() * 0.6;
    ctx.beginPath();
    ctx.arc(x * R, y * R, R * (0.002 + rand() * 0.004), 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  grooves(ctx, R, { from: DISC.inner, to: DISC.outer, ink: "#ffffff", alpha: 0.05, seed: 5, bands: [0.52, 0.63, 0.75, 0.86] });
  rim(ctx, R, "rgb(255 255 255 / 0.28)");
}

function drawSplatter(ctx, R, { font }) {
  const rand = mulberry(29);
  ctx.save();
  circle(ctx, R);
  ctx.clip();
  const base = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R);
  base.addColorStop(0, "rgb(226 112 52 / 0.94)");
  base.addColorStop(0.6, "rgb(232 124 60 / 0.9)");
  base.addColorStop(0.92, "rgb(238 140 72 / 0.84)");
  base.addColorStop(1, "rgb(244 160 92 / 0.7)");
  ctx.fillStyle = base;
  ctx.fillRect(-R, -R, 2 * R, 2 * R);
  const inks = ["#151312", "#f6efe0", "#151312", "#2c5d7c"];
  for (let i = 0; i < 46; i += 1) {
    const a = rand() * TAU;
    const d = Math.sqrt(rand()) * R;
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    const size = R * (0.008 + Math.pow(rand(), 2.4) * 0.05);
    ctx.fillStyle = inks[i % inks.length];
    ctx.beginPath();
    ctx.ellipse(x, y, size * (1 + rand() * 0.4), size, rand() * TAU, 0, TAU);
    ctx.fill();
    const drops = 4 + Math.floor(rand() * 12);
    const dir = rand() * TAU;
    for (let j = 0; j < drops; j += 1) {
      const spread = dir + (rand() - 0.5) * 1.6;
      const reach = size * (1.2 + rand() * 3.4);
      const dr = size * (0.06 + rand() * 0.24);
      ctx.beginPath();
      ctx.arc(x + Math.cos(spread) * reach, y + Math.sin(spread) * reach, dr, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
  grooves(ctx, R, { from: DISC.inner, to: DISC.outer, ink: "#3a1a08", alpha: 0.09, seed: 13, bands: [0.5, 0.6, 0.71, 0.83] });
  circle(ctx, DISC.label * R);
  ctx.fillStyle = "#efe7d6";
  ctx.fill();
  ctx.save();
  ctx.strokeStyle = "#151312";
  ctx.lineWidth = R * 0.0025;
  circle(ctx, DISC.label * R * 0.9);
  ctx.stroke();
  ctx.restore();
  labelText(ctx, R, { font, ink: "#151312", top: "Side A", middle: "33⅓", bottom: "Splatter on orange" });
  rim(ctx, R, "rgb(255 214 170 / 0.4)");
}

export const ETCH_RINGS = [
  { from: 0.05, to: 0.16, cells: 12, skew: 30, twist: 2 },
  { from: 0.16, to: 0.27, cells: 24, skew: -40, twist: -1 },
  { from: 0.27, to: 0.38, cells: 36, skew: 70, twist: 3 },
  { from: 0.38, to: 0.5, cells: 36, skew: -55, twist: -2 },
  { from: 0.5, to: 0.62, cells: 48, skew: 25, twist: 1 },
  { from: 0.62, to: 0.74, cells: 48, skew: -30, twist: 4 },
  { from: 0.74, to: 0.86, cells: 72, skew: 50, twist: -1 },
  { from: 0.86, to: 0.955, cells: 72, skew: -65, twist: 2 },
];

export function etchCells() {
  const cells = [];
  ETCH_RINGS.forEach((ring, j) => {
    const lean = (j % 2 ? -1 : 1) * (TAU / ring.cells) * 0.9;
    for (let c = 0; c < ring.cells; c += 1) {
      const a0 = (c / ring.cells) * TAU;
      const a1 = ((c + 1) / ring.cells) * TAU;
      const path = new Path2D();
      const steps = 6;
      for (let k = 0; k <= steps; k += 1) {
        const r = ring.from + ((ring.to - ring.from) * k) / steps;
        const a = a0 + (lean * k) / steps;
        path.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      path.arc(0, 0, ring.to, a0 + lean, a1 + lean);
      for (let k = steps; k >= 0; k -= 1) {
        const r = ring.from + ((ring.to - ring.from) * k) / steps;
        const a = a1 + (lean * k) / steps;
        path.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      path.arc(0, 0, ring.from, a1, a0, true);
      path.closePath();
      const mid = ((c + 0.5) / ring.cells) * 360;
      cells.push({ path, dir: mid * ring.twist + ring.skew, ring: j });
    }
  });
  return cells;
}

function hatch(ctx, R, stroke, width) {
  ctx.save();
  ctx.lineWidth = width;
  ctx.strokeStyle = stroke;
  for (const cell of etchCells()) {
    ctx.save();
    ctx.scale(R, R);
    ctx.clip(cell.path);
    ctx.scale(1 / R, 1 / R);
    const th = (cell.dir * Math.PI) / 180;
    const cx = Math.cos(th);
    const sy = Math.sin(th);
    ctx.beginPath();
    for (let t = -R; t <= R; t += Math.max(3, R / 120)) {
      ctx.moveTo(-sy * t - cx * R, cx * t - sy * R);
      ctx.lineTo(-sy * t + cx * R, cx * t + sy * R);
    }
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawEtched(ctx, R) {
  circle(ctx, R);
  ctx.fillStyle = "#121212";
  ctx.fill();
  hatch(ctx, R, "rgb(255 255 255 / 0.09)", Math.max(0.8, R / 500));
  rim(ctx, R, "rgb(70 70 70 / 0.6)");
}

export function buildEtchMask(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const R = size / 2;
  ctx.translate(R, R);
  hatch(ctx, R, "#fff", Math.max(1.2, R / 380));
  return canvas;
}

export const PRESSINGS = [
  { key: "flight", name: "Zoetrope", draw: drawFlight, sheen: "clear", animated: true },
  { key: "pulse", name: "Op-art zoetrope", draw: drawPulse, sheen: "clear", animated: true },
  { key: "picture", name: "Picture disc", draw: drawPicture, sheen: "clear" },
  { key: "splatter", name: "Splatter", draw: drawSplatter, sheen: "colour" },
  { key: "etched", name: "Etched B-side", draw: drawEtched, sheen: "none", etched: true },
];

export function buildTexture(pressing, size, font) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const R = size / 2;
  ctx.translate(R, R);
  pressing.draw(ctx, R, { font });
  ctx.globalCompositeOperation = "destination-out";
  circle(ctx, DISC.hole * R);
  ctx.fill();
  return canvas;
}

export function buildGrooveMask(size, seed = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const R = size / 2;
  ctx.translate(R, R);
  const rand = mulberry(seed);
  const count = Math.round((DISC.outer - DISC.inner) * R * 0.7);
  ctx.lineWidth = Math.max(0.7, R / 700);
  for (let i = 0; i < count; i += 1) {
    const r = DISC.inner + ((DISC.outer - DISC.inner) * (i + rand())) / count;
    ctx.strokeStyle = `rgb(255 255 255 / ${(0.35 + rand() * 0.65).toFixed(3)})`;
    circle(ctx, r * R);
    ctx.stroke();
  }
  return canvas;
}
