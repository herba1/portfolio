import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXPORTS_DIR = join(ROOT, "public/splats/4d");
const NAME = "fake";
const OUT_DIR = join(EXPORTS_DIR, NAME);

const FRAMES = 24;
const DURATION = 3.2;
const VFOV_DEG = 40;
const ASPECT = 16 / 9;

const BACKDROP = { columns: 600, rows: 336, halfWidth: 2.9, halfHeight: 1.65, depth: 3.6, sigma: 0.0068, flatness: 0.22 };
const TORUS = { major: 300, minor: 100, radius: 0.42, tube: 0.14, depth: 2.4, bob: 0.12, tilt: (58 * Math.PI) / 180, sigma: 0.0068 };

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const float32Scratch = new Float32Array(1);
const uint32Scratch = new Uint32Array(float32Scratch.buffer);

function toHalf(value) {
  float32Scratch[0] = value;
  const bits = uint32Scratch[0];
  const sign = (bits >>> 16) & 0x8000;
  const exponent = (bits >>> 23) & 0xff;
  let mantissa = bits & 0x7fffff;
  if (exponent === 0xff) return sign | 0x7c00 | (mantissa ? 0x200 : 0);
  let halfExponent = exponent - 127 + 15;
  if (halfExponent >= 0x1f) return sign | 0x7c00;
  if (halfExponent <= 0) {
    if (halfExponent < -10) return sign;
    mantissa |= 0x800000;
    const shift = 14 - halfExponent;
    let halfMantissa = mantissa >>> shift;
    const remainder = mantissa & ((1 << shift) - 1);
    const halfway = 1 << (shift - 1);
    if (remainder > halfway || (remainder === halfway && (halfMantissa & 1))) halfMantissa += 1;
    return sign | halfMantissa;
  }
  let halfMantissa = mantissa >>> 13;
  const remainder = mantissa & 0x1fff;
  if (remainder > 0x1000 || (remainder === 0x1000 && (halfMantissa & 1))) {
    halfMantissa += 1;
    if (halfMantissa === 0x400) {
      halfMantissa = 0;
      halfExponent += 1;
      if (halfExponent >= 0x1f) return sign | 0x7c00;
    }
  }
  return sign | (halfExponent << 10) | halfMantissa;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function rampColor(stops, t) {
  const clamped = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i += 1) {
    const [position, color] = stops[i];
    const [previousPosition, previousColor] = stops[i - 1];
    if (clamped <= position) {
      const local = smoothstep(0, 1, (clamped - previousPosition) / (position - previousPosition));
      return previousColor.map((channel, k) => channel + (color[k] - channel) * local);
    }
  }
  return stops[stops.length - 1][1];
}

const BACKDROP_RAMP = [
  [0, [0.98, 0.62, 0.24]],
  [0.3, [0.96, 0.44, 0.42]],
  [0.55, [0.78, 0.46, 0.78]],
  [0.8, [0.36, 0.62, 0.86]],
  [1, [0.2, 0.74, 0.7]],
];

const TORUS_RAMP = [
  [0, [0.95, 0.2, 0.55]],
  [0.25, [1, 0.62, 0.12]],
  [0.5, [0.72, 0.9, 0.2]],
  [0.75, [0.16, 0.78, 0.9]],
  [1, [0.95, 0.2, 0.55]],
];

function inGlyphF(x, y) {
  const left = -1.95;
  const top = -1.05;
  const stem = x >= left && x <= left + 0.16 && y >= top && y <= top + 0.95;
  const bar = x >= left && x <= left + 0.62 && y >= top && y <= top + 0.16;
  const middle = x >= left && x <= left + 0.44 && y >= top + 0.4 && y <= top + 0.54;
  return stem || bar || middle;
}

const DISC = { x: 1.62, y: 0.78, radius: 0.3 };

function backdropDepth(x, y) {
  const relief = 0.16 * Math.sin(1.3 * x + 0.4) * Math.cos(1.7 * y) + 0.06 * Math.sin(3.1 * x - 2.2 * y);
  const disc = Math.hypot(x - DISC.x, y - DISC.y);
  const well = 0.22 * (1 - smoothstep(DISC.radius - 0.04, DISC.radius, disc));
  const glyph = inGlyphF(x, y) ? -0.14 : 0;
  return BACKDROP.depth + relief + well + glyph;
}

function backdropColor(x, y) {
  const diagonal = ((x + BACKDROP.halfWidth) / (2 * BACKDROP.halfWidth)) * 0.55 + ((y + BACKDROP.halfHeight) / (2 * BACKDROP.halfHeight)) * 0.45;
  const base = rampColor(BACKDROP_RAMP, diagonal);
  const checker = (Math.floor((x + 10) / 0.36) + Math.floor((y + 10) / 0.36)) % 2 === 0 ? 1.06 : 0.9;
  let color = base.map((c) => c * checker);
  if (inGlyphF(x, y)) color = [0.1, 0.1, 0.12];
  if (Math.hypot(x - DISC.x, y - DISC.y) < DISC.radius) color = [0.12, 0.26, 0.92];
  return color;
}

function discCovariance(normal, sigma, flatness) {
  const [nx, ny, nz] = normal;
  const variance = sigma * sigma;
  const squash = 1 - flatness * flatness;
  return [
    variance * (1 - squash * nx * nx),
    -variance * squash * nx * ny,
    -variance * squash * nx * nz,
    variance * (1 - squash * ny * ny),
    -variance * squash * ny * nz,
    variance * (1 - squash * nz * nz),
  ];
}

function buildBackdrop(random) {
  const count = BACKDROP.columns * BACKDROP.rows;
  const positions = new Float32Array(count * 3);
  const covariances = new Float32Array(count * 6);
  const colors = new Float32Array(count * 3);
  const stepX = (2 * BACKDROP.halfWidth) / (BACKDROP.columns - 1);
  const stepY = (2 * BACKDROP.halfHeight) / (BACKDROP.rows - 1);
  const h = 0.002;
  let i = 0;
  for (let row = 0; row < BACKDROP.rows; row += 1) {
    for (let column = 0; column < BACKDROP.columns; column += 1) {
      const x = -BACKDROP.halfWidth + column * stepX + (random() - 0.5) * stepX * 0.6;
      const y = -BACKDROP.halfHeight + row * stepY + (random() - 0.5) * stepY * 0.6;
      const z = backdropDepth(x, y);
      const dzdx = (backdropDepth(x + h, y) - backdropDepth(x - h, y)) / (2 * h);
      const dzdy = (backdropDepth(x, y + h) - backdropDepth(x, y - h)) / (2 * h);
      const length = Math.hypot(dzdx, dzdy, 1);
      const normal = Math.abs(dzdx) > 5 || Math.abs(dzdy) > 5 ? [0, 0, 1] : [-dzdx / length, -dzdy / length, 1 / length];
      positions.set([x, y, z], i * 3);
      covariances.set(discCovariance(normal, BACKDROP.sigma, BACKDROP.flatness), i * 6);
      colors.set(backdropColor(x, y), i * 3);
      i += 1;
    }
  }
  return { count, positions, covariances, colors };
}

function torusPose(t) {
  const turn = 2 * Math.PI * t;
  const bob = TORUS.bob * Math.sin(2 * Math.PI * t);
  return { turn, bob };
}

function buildTorus(random) {
  const count = TORUS.major * TORUS.minor;
  const local = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const covariances = new Float32Array(count * 6);
  const light = [-0.4, -0.6, -0.7];
  const lightLength = Math.hypot(...light);
  let i = 0;
  for (let a = 0; a < TORUS.major; a += 1) {
    for (let b = 0; b < TORUS.minor; b += 1) {
      const theta = ((a + random() * 0.5) / TORUS.major) * 2 * Math.PI;
      const phi = ((b + random() * 0.5) / TORUS.minor) * 2 * Math.PI;
      const ring = TORUS.radius + TORUS.tube * Math.cos(phi);
      local.set([ring * Math.cos(theta), TORUS.tube * Math.sin(phi), ring * Math.sin(theta)], i * 3);
      const normal = [Math.cos(phi) * Math.cos(theta), Math.sin(phi), Math.cos(phi) * Math.sin(theta)];
      const lambert = Math.max(0, -(normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2]) / lightLength);
      const stripe = Math.floor((a / TORUS.major) * 12) % 2 === 0 ? 1 : 0.78;
      const shade = (0.62 + 0.38 * lambert) * stripe;
      colors.set(rampColor(TORUS_RAMP, a / TORUS.major).map((c) => c * shade), i * 3);
      const variance = TORUS.sigma * TORUS.sigma;
      covariances.set([variance, 0, 0, variance, 0, variance], i * 6);
      i += 1;
    }
  }
  const frames = [];
  const cosTilt = Math.cos(TORUS.tilt);
  const sinTilt = Math.sin(TORUS.tilt);
  for (let f = 0; f < FRAMES; f += 1) {
    const { turn, bob } = torusPose(f / (FRAMES - 1));
    const cosTurn = Math.cos(turn);
    const sinTurn = Math.sin(turn);
    const positions = new Float32Array(count * 3);
    for (let k = 0; k < count; k += 1) {
      const x0 = local[k * 3];
      const y0 = local[k * 3 + 1];
      const z0 = local[k * 3 + 2];
      const y1 = y0 * cosTilt - z0 * sinTilt;
      const z1 = y0 * sinTilt + z0 * cosTilt;
      const x2 = x0 * cosTurn + z1 * sinTurn;
      const z2 = -x0 * sinTurn + z1 * cosTurn;
      positions[k * 3] = x2;
      positions[k * 3 + 1] = y1 + bob;
      positions[k * 3 + 2] = z2 + TORUS.depth;
    }
    frames.push(positions);
  }
  return { count, frames, covariances, colors };
}

function median(values) {
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.floor(sorted.length / 2)];
}

function main() {
  const random = mulberry32(20260929);
  const backdrop = buildBackdrop(random);
  const torus = buildTorus(random);
  const count = backdrop.count + torus.count;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const grow = (positions) => {
    for (let i = 0; i < positions.length; i += 3) {
      for (let k = 0; k < 3; k += 1) {
        if (positions[i + k] < min[k]) min[k] = positions[i + k];
        if (positions[i + k] > max[k]) max[k] = positions[i + k];
      }
    }
  };
  grow(backdrop.positions);
  torus.frames.forEach(grow);
  for (let k = 0; k < 3; k += 1) {
    min[k] -= 1e-4;
    max[k] += 1e-4;
  }

  const variances = [];
  for (let i = 0; i < backdrop.count; i += 97) variances.push(backdrop.covariances[i * 6], backdrop.covariances[i * 6 + 3], backdrop.covariances[i * 6 + 5]);
  for (let i = 0; i < torus.count; i += 97) variances.push(torus.covariances[i * 6], torus.covariances[i * 6 + 3], torus.covariances[i * 6 + 5]);
  const covScale = 1 / median(variances);

  const base = Buffer.alloc(count * 16);
  const writeBase = (index, covariance, color, opacity) => {
    const offset = index * 16;
    for (let k = 0; k < 6; k += 1) base.writeUInt16LE(toHalf(covariance[k] * covScale), offset + k * 2);
    base.writeUInt8(Math.round(Math.min(1, Math.max(0, color[0])) * 255), offset + 12);
    base.writeUInt8(Math.round(Math.min(1, Math.max(0, color[1])) * 255), offset + 13);
    base.writeUInt8(Math.round(Math.min(1, Math.max(0, color[2])) * 255), offset + 14);
    base.writeUInt8(Math.round(opacity * 255), offset + 15);
  };

  const quantize = (value, axis) => Math.round(Math.min(1, Math.max(0, (value - min[axis]) / (max[axis] - min[axis]))) * 65535);
  const writePoint = (buffer, index, positions, sourceIndex, opacity) => {
    const offset = index * 8;
    buffer.writeUInt16LE(quantize(positions[sourceIndex * 3], 0), offset);
    buffer.writeUInt16LE(quantize(positions[sourceIndex * 3 + 1], 1), offset + 2);
    buffer.writeUInt16LE(quantize(positions[sourceIndex * 3 + 2], 2), offset + 4);
    buffer.writeUInt16LE(Math.round(opacity * 65535), offset + 6);
  };

  const STATIC_OPACITY = 0.98;
  const DYNAMIC_OPACITY = 0.95;

  const staticBuffer = Buffer.alloc(backdrop.count * 8);
  for (let i = 0; i < backdrop.count; i += 1) {
    writeBase(i, backdrop.covariances.subarray(i * 6, i * 6 + 6), backdrop.colors.subarray(i * 3, i * 3 + 3), STATIC_OPACITY);
    writePoint(staticBuffer, i, backdrop.positions, i, STATIC_OPACITY);
  }

  const dynamicBuffer = Buffer.alloc(FRAMES * torus.count * 8);
  for (let i = 0; i < torus.count; i += 1) {
    writeBase(backdrop.count + i, torus.covariances.subarray(i * 6, i * 6 + 6), torus.colors.subarray(i * 3, i * 3 + 3), DYNAMIC_OPACITY);
  }
  torus.frames.forEach((positions, f) => {
    for (let i = 0; i < torus.count; i += 1) writePoint(dynamicBuffer, f * torus.count + i, positions, i, DYNAMIC_OPACITY);
  });

  const referenceDepths = [];
  for (let i = 0; i < torus.count; i += 7) referenceDepths.push(torus.frames[0][i * 3 + 2]);

  const meta = {
    format: "splat4d",
    version: 1,
    exportId: String(Date.now()),
    count,
    staticCount: backdrop.count,
    dynamicCount: torus.count,
    frames: FRAMES,
    duration: DURATION,
    bounds: { min, max },
    covScale,
    coords: "opencv-camera0",
    camera: { vfovDeg: VFOV_DEG, aspect: ASPECT, pivotDepth: median(referenceDepths) },
    source: { clip: "synthetic", inFrames: FRAMES, width: 1280, height: 720, movies: null, generator: "scripts/splat4d-fake.mjs" },
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  writeFileSync(join(OUT_DIR, "base.bin"), base);
  writeFileSync(join(OUT_DIR, "static.bin"), staticBuffer);
  writeFileSync(join(OUT_DIR, "dynamic.bin"), dynamicBuffer);

  const indexPath = join(EXPORTS_DIR, "index.json");
  let index = [];
  if (existsSync(indexPath)) {
    try {
      const parsed = JSON.parse(readFileSync(indexPath, "utf8"));
      if (Array.isArray(parsed)) index = parsed;
    } catch {
      index = [];
    }
  }
  const names = index.map((entry) => (typeof entry === "string" ? entry : entry?.name));
  if (!names.includes(NAME)) index.push(NAME);
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);

  const megabytes = (bytes) => (bytes / 1e6).toFixed(2);
  console.log(`wrote ${OUT_DIR}`);
  console.log(`  splats   ${count} (${backdrop.count} static, ${torus.count} dynamic × ${FRAMES} frames)`);
  console.log(`  base     ${megabytes(base.length)} MB`);
  console.log(`  static   ${megabytes(staticBuffer.length)} MB`);
  console.log(`  dynamic  ${megabytes(dynamicBuffer.length)} MB`);
  console.log(`  covScale ${covScale.toFixed(1)}  pivotDepth ${meta.camera.pivotDepth.toFixed(3)}`);
  console.log(`  index    ${JSON.stringify(index)}`);
}

main();
