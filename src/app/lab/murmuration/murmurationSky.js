const SKY = [
  { at: 0, color: [196, 199, 236] },
  { at: 0.22, color: [214, 210, 238] },
  { at: 0.46, color: [236, 214, 232] },
  { at: 0.68, color: [246, 214, 220] },
  { at: 0.86, color: [249, 216, 204] },
  { at: 1, color: [252, 226, 206] },
];

const GLOW = [255, 236, 214];

const toLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (v) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, c * 255));
};

function toOklab([r, g, b]) {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const SKY_LAB = SKY.map((stop) => ({ at: stop.at, lab: toOklab(stop.color) }));
const GLOW_LAB = toOklab(GLOW);
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);

function skyAt(t) {
  for (let i = 1; i < SKY_LAB.length; i += 1) {
    const a = SKY_LAB[i - 1];
    const b = SKY_LAB[i];
    if (t <= b.at) {
      const k = smoother((t - a.at) / (b.at - a.at));
      return [a.lab[0] + (b.lab[0] - a.lab[0]) * k, a.lab[1] + (b.lab[1] - a.lab[1]) * k, a.lab[2] + (b.lab[2] - a.lab[2]) * k];
    }
  }
  return SKY_LAB[SKY_LAB.length - 1].lab;
}

export function skyColorAt(t) {
  return fromOklab(skyAt(Math.max(0, Math.min(1, t))));
}

function hash(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function paintSky(canvas, width, height, horizon) {
  const w = Math.max(2, Math.round(width / 2));
  const h = Math.max(2, Math.round(height / 2));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(w, h);
  const data = image.data;
  const glowX = w * 0.62;
  const glowY = h * horizon;
  const glowR = Math.max(w, h) * 0.7;
  for (let y = 0; y < h; y += 1) {
    const base = skyAt(y / (h * horizon));
    for (let x = 0; x < w; x += 1) {
      const dx = (x - glowX) / glowR;
      const dy = (y - glowY) / (glowR * 0.42);
      const g = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
      const k = smoother(g) * 0.55;
      const lab = [base[0] + (GLOW_LAB[0] - base[0]) * k, base[1] + (GLOW_LAB[1] - base[1]) * k, base[2] + (GLOW_LAB[2] - base[2]) * k];
      const rgb = fromOklab(lab);
      const n = (hash(x, y) + hash(x + 91, y + 37) - 1) * 1.6;
      const o = (y * w + x) * 4;
      data[o] = rgb[0] + n;
      data[o + 1] = rgb[1] + n;
      data[o + 2] = rgb[2] + n;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

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

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c, alpha = 1) => `rgb(${c[0]} ${c[1]} ${c[2]} / ${alpha})`;

export function paintLand(canvas, width, height, dpr, horizon) {
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const rand = mulberry(41);
  const base = height * horizon;
  const haze = skyColorAt(1);
  const ink = [38, 30, 46];
  const far = mix(ink, haze, 0.62);
  const mid = mix(ink, haze, 0.34);

  ctx.fillStyle = rgb(far);
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let x = 0; x <= width + 8; x += 8) {
    const y = base - 6 - Math.sin(x * 0.004 + 1.3) * 5 - Math.sin(x * 0.011) * 2.5 - Math.max(0, Math.sin(x * 0.0021 + 2.2)) * 10;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = rgb(mid);
  ctx.beginPath();
  ctx.moveTo(0, height);
  let x = 0;
  while (x <= width + 12) {
    const crown = 3 + rand() * 9;
    const tall = Math.max(0, Math.sin(x * 0.006 + 0.4)) * 10 + rand() * 4;
    ctx.lineTo(x, base + 4 - tall * 0.4);
    ctx.quadraticCurveTo(x + crown * 0.5, base + 2 - tall - crown * 0.6, x + crown, base + 4 - tall * 0.4);
    x += crown;
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();

  const ground = base + 10;
  ctx.fillStyle = rgb(ink);
  ctx.fillRect(0, ground, width, height - ground);

  ctx.strokeStyle = rgb(ink);
  ctx.lineCap = "round";
  const density = Math.max(160, Math.round(width / 3));
  for (let i = 0; i < density; i += 1) {
    const rx = rand() * width;
    const tall = 10 + rand() * 22 + Math.max(0, Math.sin(rx * 0.01 + 1)) * 8;
    const lean = (rand() - 0.35) * 5;
    ctx.lineWidth = 0.7 + rand() * 0.6;
    ctx.beginPath();
    ctx.moveTo(rx, ground + 2);
    ctx.quadraticCurveTo(rx + lean * 0.3, ground - tall * 0.6, rx + lean, ground - tall);
    ctx.stroke();
    if (rand() < 0.55) {
      ctx.save();
      ctx.translate(rx + lean, ground - tall);
      ctx.rotate(lean * 0.06 + 0.15);
      ctx.fillStyle = rgb(ink);
      ctx.beginPath();
      ctx.ellipse(0, -3, 1.4, 4 + rand() * 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
