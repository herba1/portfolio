export const GRAIN_SIZE = 256;

const FORMATION_CELLS = 8;
const FLOC_CELLS = 32;
const TOOTH_CELLS = 64;
const DARK_FIBRES = 220;
const LIGHT_FIBRES = 140;
const LONG_FIBRES = 8;
const PULP = [112, 106, 98];
const FORMATION_DEPTH = 0.1;
const FORMATION_LIGHT = 1.2;
const PIXEL_GRAIN = 0.016;
const RIDGE_ONSET = 0.25;
const RIDGE_ALPHA = 90;
const PIT_RATE = 0.004;
const MAX_SCALE = 2;
const IDLE_TIMEOUT_MS = 240;

let pending = null;

function mulberry(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tileableNoise(random, cells) {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i += 1) lattice[i] = random();
  const cell = GRAIN_SIZE / cells;
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const gx = x / cell;
    const gy = y / cell;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = smooth(gx - x0);
    const ty = smooth(gy - y0);
    const ax = x0 % cells;
    const ay = y0 % cells;
    const bx = (x0 + 1) % cells;
    const by = (y0 + 1) % cells;
    const top = lattice[ay * cells + ax] * (1 - tx) + lattice[ay * cells + bx] * tx;
    const bottom = lattice[by * cells + ax] * (1 - tx) + lattice[by * cells + bx] * tx;
    return top * (1 - ty) + bottom * ty;
  };
}

function grainScale() {
  const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  return Math.min(MAX_SCALE, Math.max(1, ratio));
}

function makeCanvas(scale) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(GRAIN_SIZE * scale);
  canvas.height = canvas.width;
  return canvas;
}

function strokeFibre(context, random, color, minLength, maxLength, minWidth, maxWidth) {
  const x = random() * GRAIN_SIZE;
  const y = random() * GRAIN_SIZE;
  const length = minLength + random() * (maxLength - minLength);
  const angle = random() * Math.PI;
  const bend = (random() - 0.5) * length * 0.5;
  const dx = Math.cos(angle) * length;
  const dy = Math.sin(angle) * length;
  const cx = dx / 2 - Math.sin(angle) * bend;
  const cy = dy / 2 + Math.cos(angle) * bend;
  context.strokeStyle = color;
  context.lineWidth = minWidth + random() * (maxWidth - minWidth);
  for (const ox of [0, -GRAIN_SIZE]) {
    for (const oy of [0, -GRAIN_SIZE]) {
      context.beginPath();
      context.moveTo(x + ox, y + oy);
      context.quadraticCurveTo(x + ox + cx, y + oy + cy, x + ox + dx, y + oy + dy);
      context.stroke();
    }
  }
}

function paintPaper(canvas, scale) {
  const context = canvas.getContext("2d");
  const random = mulberry(0x5eed7a3);
  const formation = tileableNoise(random, FORMATION_CELLS);
  const flocs = tileableNoise(random, FLOC_CELLS);
  const size = canvas.width;
  const image = context.createImageData(size, size);
  const { data } = image;
  for (let py = 0; py < size; py += 1) {
    const y = py / scale;
    for (let px = 0; px < size; px += 1) {
      const x = px / scale;
      const index = (py * size + px) * 4;
      const cloud = formation(x, y) * 0.6 + flocs(x, y) * 0.4 - 0.5;
      const grain = (random() - 0.5) * PIXEL_GRAIN;
      const tone = cloud * FORMATION_DEPTH + grain;
      if (tone > 0) {
        data[index] = PULP[0];
        data[index + 1] = PULP[1];
        data[index + 2] = PULP[2];
        data[index + 3] = Math.min(255, tone * 255);
      } else {
        data[index] = 255;
        data[index + 1] = 255;
        data[index + 2] = 252;
        data[index + 3] = Math.min(255, -tone * FORMATION_LIGHT * 255);
      }
    }
  }
  context.putImageData(image, 0, 0);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.lineCap = "round";
  for (let i = 0; i < DARK_FIBRES; i += 1) {
    strokeFibre(context, random, `rgba(${PULP[0]}, ${PULP[1]}, ${PULP[2]}, ${(0.04 + random() * 0.04).toFixed(3)})`, 3, 10, 0.25, 0.5);
  }
  for (let i = 0; i < LIGHT_FIBRES; i += 1) {
    strokeFibre(context, random, `rgba(255, 255, 252, ${(0.1 + random() * 0.1).toFixed(3)})`, 3, 10, 0.4, 0.8);
  }
  for (let i = 0; i < LONG_FIBRES; i += 1) {
    strokeFibre(context, random, `rgba(${PULP[0]}, ${PULP[1]}, ${PULP[2]}, ${(0.03 + random() * 0.02).toFixed(3)})`, 18, 36, 0.25, 0.4);
  }
}

function paintTooth(canvas, scale) {
  const context = canvas.getContext("2d");
  const random = mulberry(0x7007f1);
  const tooth = tileableNoise(random, TOOTH_CELLS);
  const size = canvas.width;
  const pitRate = 1 - PIT_RATE / scale;
  const image = context.createImageData(size, size);
  const { data } = image;
  for (let py = 0; py < size; py += 1) {
    const y = py / scale;
    for (let px = 0; px < size; px += 1) {
      const x = px / scale;
      const index = (py * size + px) * 4;
      const roll = random();
      const ridge = tooth(x, y) - 0.5;
      if (ridge > RIDGE_ONSET) {
        data[index] = 255;
        data[index + 1] = 255;
        data[index + 2] = 252;
        data[index + 3] = (ridge - RIDGE_ONSET) * RIDGE_ALPHA;
      } else if (roll > pitRate) {
        data[index] = PULP[0];
        data[index + 1] = PULP[1];
        data[index + 2] = PULP[2];
        data[index + 3] = 8 + random() * 8;
      }
    }
  }
  context.putImageData(image, 0, 0);
}

function toUrl(canvas) {
  return new Promise((resolve) => {
    if (!canvas.toBlob) {
      resolve(canvas.toDataURL("image/png"));
      return;
    }
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png")), "image/png");
  });
}

function whenIdle(callback) {
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS });
  else setTimeout(callback, 0);
}

export function paperGrain() {
  if (pending) return pending;
  pending = new Promise((resolve) => {
    whenIdle(() => {
      try {
        const scale = grainScale();
        const paper = makeCanvas(scale);
        const tooth = makeCanvas(scale);
        paintPaper(paper, scale);
        paintTooth(tooth, scale);
        Promise.all([toUrl(paper), toUrl(tooth)]).then(
          ([paperUrl, toothUrl]) => resolve({ paper: paperUrl, tooth: toothUrl }),
          () => resolve(null),
        );
      } catch {
        resolve(null);
      }
    });
  });
  return pending;
}
