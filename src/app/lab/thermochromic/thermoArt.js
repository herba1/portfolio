import { BAND, GRAIN, MASK } from "./thermoSleeves";

function fontStack() {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim();
  return value || "ui-sans-serif, system-ui, sans-serif";
}

function track(size) {
  return `${(-0.043 * (size - 12)).toFixed(2)}px`;
}

export async function readyFont() {
  const sans = fontStack();
  try {
    await Promise.all([document.fonts.load(`600 132px ${sans}`), document.fonts.load(`500 30px ${sans}`)]);
  } catch {}
  return sans;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

export function drawVarnish(sleeve, sans) {
  const canvas = document.createElement("canvas");
  canvas.width = MASK;
  canvas.height = MASK;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, MASK, MASK);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  const set = (weight, size) => {
    ctx.font = `${weight} ${size}px ${sans}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = track(size);
  };
  set(600, 44);
  ctx.textAlign = "left";
  ctx.fillText(BAND, 68, 112);
  set(500, 28);
  ctx.textAlign = "right";
  ctx.fillText(sleeve.side, MASK - 68, 108);
  ctx.fillText("Stereo", MASK - 68, 144);
  set(600, 136);
  ctx.textAlign = "left";
  const words = sleeve.album.split(" ");
  const lines = words.length > 1 ? [words.slice(0, -1).join(" "), words[words.length - 1]] : words;
  const base = MASK - 72;
  lines.forEach((line, i) => {
    ctx.fillText(line, 60, base - (lines.length - 1 - i) * 128);
  });
  ctx.fillRect(68, 136, 44, 4);
  return canvas;
}

function lattice(seed) {
  let a = Math.floor(seed * 1000) >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const size = 256;
  const table = new Float32Array(size * size);
  for (let i = 0; i < table.length; i += 1) table[i] = rand();
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const at = (i, j) => table[(((j & 255) * size) + (i & 255))];
    const a0 = at(ix, iy);
    const b0 = at(ix + 1, iy);
    const c0 = at(ix, iy + 1);
    const d0 = at(ix + 1, iy + 1);
    return a0 + (b0 - a0) * ux + (c0 - a0) * uy + (a0 - b0 - c0 + d0) * ux * uy;
  };
}

function fbm(noise, x, y) {
  let v = 0;
  let amp = 0.5;
  let fx = x;
  let fy = y;
  for (let i = 0; i < 4; i += 1) {
    v += amp * noise(fx, fy);
    fx = fx * 2.03 + 17.1;
    fy = fy * 2.03 + 9.7;
    amp *= 0.5;
  }
  return v;
}

export function drawGrain(seed) {
  const canvas = document.createElement("canvas");
  canvas.width = GRAIN;
  canvas.height = GRAIN;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(GRAIN, GRAIN);
  const noise = lattice(seed);
  const scale = 1 / GRAIN;
  for (let y = 0; y < GRAIN; y += 1) {
    for (let x = 0; x < GRAIN; x += 1) {
      const u = (x + 0.5) * scale;
      const v = (y + 0.5) * scale;
      const o = (y * GRAIN + x) * 4;
      image.data[o] = Math.round(fbm(noise, u * 5.5 + seed, v * 5.5 + seed) * 255);
      image.data[o + 1] = Math.round(fbm(noise, u * 23 + 40, v * 23 + 40) * 255);
      image.data[o + 2] = Math.round(noise(u * 14 + 90, v * 14 + 90) * 255);
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
