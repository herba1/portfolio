import { MAX_FILINGS } from "./filingsParams";

export const SAMPLE = 128;
export const INTRO_SPAN = 0.55;
export const MORPH_SPAN = 0.26;
export const GROW_OVERSHOOT = 1.70158;
export const MORPH_OVERSHOOT = 1.1;
export const LAG_BINS = 48;
export const LAG_SPAN = 0.6;

const JITTER = 0.42;
const REST_WEIGHT = 0.24;
const RANDOM_REST = 0.55;
const TORQUE = 260;
const STAGGER_HASH = 0.35;
const STAGGER_RADIAL = 0.8;
const MORPH_RADIAL = 0.6;
const CREEP_RATE = 7;
const KICK = 18;
const STICTION = 3;
const HALF_PI = Math.PI / 2;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function easeOutBack(t, overshoot) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const u = t - 1;
  return 1 + (overshoot + 1) * u * u * u + overshoot * u * u;
}

function boxBlur(source, scratch, radius) {
  const size = SAMPLE;
  const span = radius * 2 + 1;
  for (let y = 0; y < size; y += 1) {
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) sum += source[y * size + Math.min(size - 1, Math.max(0, k))];
    for (let x = 0; x < size; x += 1) {
      scratch[y * size + x] = sum / span;
      const add = Math.min(size - 1, x + radius + 1);
      const drop = Math.max(0, x - radius);
      sum += source[y * size + add] - source[y * size + drop];
    }
  }
  for (let x = 0; x < size; x += 1) {
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) sum += scratch[Math.min(size - 1, Math.max(0, k)) * size + x];
    for (let y = 0; y < size; y += 1) {
      source[y * size + x] = sum / span;
      const add = Math.min(size - 1, y + radius + 1);
      const drop = Math.max(0, y - radius);
      sum += scratch[add * size + x] - scratch[drop * size + x];
    }
  }
}

function percentile(histogram, total, fraction) {
  const goal = total * fraction;
  let seen = 0;
  for (let bin = 0; bin < histogram.length; bin += 1) {
    seen += histogram[bin];
    if (seen >= goal) return bin / (histogram.length - 1);
  }
  return 1;
}

export function sampleCover(image) {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) return null;
  const side = Math.min(width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, SAMPLE, SAMPLE);
  let data;
  try {
    data = context.getImageData(0, 0, SAMPLE, SAMPLE).data;
  } catch {
    return null;
  }

  const size = SAMPLE * SAMPLE;
  const light = new Float32Array(size);
  const rgb = new Float32Array(size * 3);
  const histogram = new Uint32Array(256);
  let swatchRed = 0;
  let swatchGreen = 0;
  let swatchBlue = 0;
  let swatchWeight = 0;
  for (let index = 0; index < size; index += 1) {
    const red = data[index * 4] / 255;
    const green = data[index * 4 + 1] / 255;
    const blue = data[index * 4 + 2] / 255;
    const value = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    light[index] = value;
    rgb[index * 3] = red;
    rgb[index * 3 + 1] = green;
    rgb[index * 3 + 2] = blue;
    histogram[Math.min(255, Math.round(value * 255))] += 1;
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
    const weight = 0.02 + chroma * chroma;
    swatchRed += red * weight;
    swatchGreen += green * weight;
    swatchBlue += blue * weight;
    swatchWeight += weight;
  }
  const swatch = `rgb(${Math.round((swatchRed / swatchWeight) * 255)} ${Math.round((swatchGreen / swatchWeight) * 255)} ${Math.round((swatchBlue / swatchWeight) * 255)})`;
  const low = percentile(histogram, size, 0.02);
  const high = Math.max(low + 0.08, percentile(histogram, size, 0.98));
  for (let index = 0; index < size; index += 1) {
    light[index] = Math.min(1, Math.max(0, (light[index] - low) / (high - low)));
  }

  const jxx = new Float32Array(size);
  const jxy = new Float32Array(size);
  const jyy = new Float32Array(size);
  const at = (x, y) => light[Math.min(SAMPLE - 1, Math.max(0, y)) * SAMPLE + Math.min(SAMPLE - 1, Math.max(0, x))];
  for (let y = 0; y < SAMPLE; y += 1) {
    for (let x = 0; x < SAMPLE; x += 1) {
      const gx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      const index = y * SAMPLE + x;
      jxx[index] = gx * gx;
      jxy[index] = gx * gy;
      jyy[index] = gy * gy;
    }
  }
  const scratch = new Float32Array(size);
  for (const field of [jxx, jxy, jyy]) {
    boxBlur(field, scratch, 3);
    boxBlur(field, scratch, 2);
  }
  const flowX = new Float32Array(size);
  const flowY = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const energy = jxx[index] + jyy[index] + 0.004;
    flowX[index] = -(jxx[index] - jyy[index]) / energy;
    flowY[index] = (-2 * jxy[index]) / energy;
  }
  return { light, rgb, flowX, flowY, swatch };
}

export function gridColumns(count) {
  return Math.max(8, Math.floor(Math.sqrt(Math.min(count, MAX_FILINGS))));
}

export function shownAt(clock, start, delay, span, overshoot) {
  return easeOutBack((clock - start - delay) / span, overshoot);
}

export class FilingsSim {
  constructor() {
    const n = MAX_FILINGS;
    this.count = 0;
    this.columns = 1;
    this.spacing = 1;
    this.seed = 1;
    this.kicks = 0;
    this.homeX = new Float32Array(n);
    this.homeY = new Float32Array(n);
    this.hash = new Float32Array(n);
    this.randomX = new Float32Array(n);
    this.randomY = new Float32Array(n);
    this.restX = new Float32Array(n);
    this.restY = new Float32Array(n);
    this.theta = new Float32Array(n);
    this.omega = new Float32Array(n);
    this.offsetX = new Float32Array(n);
    this.offsetY = new Float32Array(n);
    this.introDelay = new Float32Array(n);
    this.morphDelay = new Float32Array(n);
    this.shape = new Float32Array(n * 4);
    this.colour = new Float32Array(n * 6);
    this.state = new Float32Array(n * 3);
    this.introClock = 0;
    this.morphClock = -10;
    this.morphSpan = MORPH_SPAN;
    this.introSpan = INTRO_SPAN;
    this.hasCover = false;
  }

  layout(count, seed) {
    const columns = gridColumns(count);
    const total = columns * columns;
    const spacing = 1 / columns;
    const random = mulberry32(seed);
    this.count = total;
    this.columns = columns;
    this.spacing = spacing;
    this.seed = seed;
    for (let index = 0; index < total; index += 1) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = (column + 0.5) * spacing + (random() - 0.5) * 2 * JITTER * spacing;
      const y = (row + 0.5) * spacing + (random() - 0.5) * 2 * JITTER * spacing;
      this.homeX[index] = Math.min(1 - spacing * 0.3, Math.max(spacing * 0.3, x));
      this.homeY[index] = Math.min(1 - spacing * 0.3, Math.max(spacing * 0.3, y));
      this.hash[index] = random();
      const restAngle = random() * Math.PI;
      this.randomX[index] = Math.cos(restAngle * 2);
      this.randomY[index] = Math.sin(restAngle * 2);
      this.theta[index] = (random() - 0.5) * Math.PI;
      this.omega[index] = 0;
      this.offsetX[index] = 0;
      this.offsetY[index] = 0;
      this.state[index * 3] = this.theta[index];
      this.state[index * 3 + 1] = 0;
      this.state[index * 3 + 2] = 0;
    }
    this.hasCover = false;
  }

  paint(sample, look, { origins, clock, mode, reduced }) {
    const count = this.count;
    const spacing = this.spacing;
    const ink = look.inkRgb;
    const morphing = mode === "morph" && this.hasCover;
    const morphStart = this.morphClock;
    const morphSpan = this.morphSpan;
    for (let index = 0; index < count; index += 1) {
      const x = this.homeX[index];
      const y = this.homeY[index];
      const pixel = Math.min(SAMPLE - 1, Math.floor(y * SAMPLE)) * SAMPLE + Math.min(SAMPLE - 1, Math.floor(x * SAMPLE));
      const value = sample.light[pixel];
      const raw = look.invert ? value : 1 - value;
      const tone = raw * raw * (3 - 2 * raw) * 0.55 + raw * 0.45;
      const hash = this.hash[index];
      const length = spacing * (0.5 + 1.3 * tone) * (0.9 + 0.2 * hash);
      const width = spacing * (0.09 + 0.27 * tone);

      let red;
      let green;
      let blue;
      if (look.tint) {
        const r = sample.rgb[pixel * 3];
        const g = sample.rgb[pixel * 3 + 1];
        const b = sample.rgb[pixel * 3 + 2];
        const mean = (r + g + b) / 3;
        red = Math.min(1, Math.max(0, (mean + (r - mean) * 1.25) * 0.86));
        green = Math.min(1, Math.max(0, (mean + (g - mean) * 1.25) * 0.86));
        blue = Math.min(1, Math.max(0, (mean + (b - mean) * 1.25) * 0.86));
      } else {
        const sheen = 1 + (hash - 0.5) * 0.12;
        red = Math.min(1, ink[0] * sheen);
        green = Math.min(1, ink[1] * sheen);
        blue = Math.min(1, ink[2] * sheen);
      }

      let nearest = Infinity;
      for (let origin = 0; origin < origins.length; origin += 1) {
        const dx = x - origins[origin][0];
        const dy = y - origins[origin][1];
        const squared = dx * dx + dy * dy;
        if (squared < nearest) nearest = squared;
      }
      const distance = Number.isFinite(nearest) ? Math.sqrt(nearest) : 0.5;
      const s = index * 4;
      const c = index * 6;

      if (morphing) {
        const k = reduced ? 1 : shownAt(clock, morphStart, this.morphDelay[index], morphSpan, MORPH_OVERSHOOT);
        this.shape[s] += (this.shape[s + 2] - this.shape[s]) * k;
        this.shape[s + 1] += (this.shape[s + 3] - this.shape[s + 1]) * k;
        this.colour[c] += (this.colour[c + 3] - this.colour[c]) * k;
        this.colour[c + 1] += (this.colour[c + 4] - this.colour[c + 1]) * k;
        this.colour[c + 2] += (this.colour[c + 5] - this.colour[c + 2]) * k;
        this.morphDelay[index] = reduced ? 0 : distance * MORPH_RADIAL;
      } else {
        this.shape[s] = length;
        this.shape[s + 1] = width;
        this.colour[c] = red;
        this.colour[c + 1] = green;
        this.colour[c + 2] = blue;
        this.morphDelay[index] = 0;
        this.introDelay[index] = reduced ? 0 : mode === "spawn" ? hash * STAGGER_HASH + distance * STAGGER_RADIAL : hash * 0.18;
      }
      this.shape[s + 2] = length;
      this.shape[s + 3] = width;
      this.colour[c + 3] = red;
      this.colour[c + 4] = green;
      this.colour[c + 5] = blue;

      const flowX = sample.flowX[pixel];
      const flowY = sample.flowY[pixel];
      const coherence = Math.min(1, Math.sqrt(flowX * flowX + flowY * flowY));
      const loose = (1 - coherence) * RANDOM_REST;
      this.restX[index] = REST_WEIGHT * (flowX + loose * this.randomX[index]);
      this.restY[index] = REST_WEIGHT * (flowY + loose * this.randomY[index]);
    }
    if (morphing) {
      this.morphClock = clock;
    } else {
      this.morphClock = -10;
      this.introClock = clock;
      this.introSpan = reduced ? 0.0001 : mode === "spawn" ? INTRO_SPAN : 0.34;
    }
    this.morphSpan = reduced ? 0.0001 : MORPH_SPAN;
    this.hasCover = true;
  }

  kick() {
    this.kicks += 1;
    const random = mulberry32(this.seed * 7919 + this.kicks * 104729);
    for (let index = 0; index < this.count; index += 1) {
      this.omega[index] += (random() - 0.5) * 2 * KICK;
    }
  }

  settleOffsets() {
    for (let index = 0; index < this.count; index += 1) {
      this.offsetX[index] = 0;
      this.offsetY[index] = 0;
    }
  }

  snapToField(clock, field) {
    const introClock = this.introClock;
    const reduced = field.reduced;
    this.introClock = -Infinity;
    field.reduced = true;
    this.step(0, clock, field);
    field.reduced = reduced;
    this.introClock = introClock;
  }

  introBusy(clock) {
    return clock - this.introClock < this.introSpan + STAGGER_HASH + STAGGER_RADIAL * 1.5;
  }

  morphBusy(clock) {
    return clock - this.morphClock < this.morphSpan + MORPH_RADIAL * 1.5;
  }

  step(dt, clock, field) {
    const count = this.count;
    const {
      poleCount,
      poleX,
      poleY,
      poleQ,
      livePoleX,
      livePoleY,
      poleOffset,
      lagTable,
      lagPerUnit,
      turning,
      rippling,
      centreCount,
      centreX,
      centreY,
      nearSq,
      coreSq,
      bRefSq,
      damping,
      creep,
      pullRadius,
      pullStrength,
      laneStep,
      laneCap,
      capNear,
      capFar,
      reduced,
    } = field;
    const homeX = this.homeX;
    const homeY = this.homeY;
    const theta = this.theta;
    const omega = this.omega;
    const offsetX = this.offsetX;
    const offsetY = this.offsetY;
    const restX = this.restX;
    const restY = this.restY;
    const introDelay = this.introDelay;
    const state = this.state;
    const since = clock - this.introClock;
    const relax = reduced ? 1 : 1 - Math.exp(-dt * CREEP_RATE);
    const pullCube = pullRadius * pullRadius * pullRadius;
    const lagLast = LAG_BINS - 1.0001;
    let maxOmega = 0;
    let maxCreep = 0;

    for (let index = 0; index < count; index += 1) {
      if (since < introDelay[index]) continue;
      const x = homeX[index];
      const y = homeY[index];
      if (rippling) {
        for (let magnet = 0; magnet < centreCount; magnet += 1) {
          const plus = magnet * 2;
          if (turning[magnet] === 0) {
            livePoleX[plus] = poleX[plus];
            livePoleY[plus] = poleY[plus];
            livePoleX[plus + 1] = poleX[plus + 1];
            livePoleY[plus + 1] = poleY[plus + 1];
            continue;
          }
          const cx = centreX[magnet];
          const cy = centreY[magnet];
          const dx = x - cx;
          const dy = y - cy;
          let lag = Math.sqrt(dx * dx + dy * dy) * lagPerUnit;
          if (lag > lagLast) lag = lagLast;
          const bin = lag | 0;
          const base = magnet * LAG_BINS + bin;
          const delayed = lagTable[base] + (lagTable[base + 1] - lagTable[base]) * (lag - bin);
          const ox = Math.cos(delayed) * poleOffset;
          const oy = Math.sin(delayed) * poleOffset;
          livePoleX[plus] = cx + ox;
          livePoleY[plus] = cy + oy;
          livePoleX[plus + 1] = cx - ox;
          livePoleY[plus + 1] = cy - oy;
        }
      }
      const sourceX = rippling ? livePoleX : poleX;
      const sourceY = rippling ? livePoleY : poleY;
      let bx = 0;
      let by = 0;
      for (let pole = 0; pole < poleCount; pole += 1) {
        const dx = x - sourceX[pole];
        const dy = y - sourceY[pole];
        let r2 = dx * dx + dy * dy;
        if (r2 < coreSq) r2 = coreSq;
        const scale = poleQ[pole] / r2;
        bx += dx * scale;
        by += dy * scale;
      }
      const b2 = bx * bx + by * by;
      let mx = restX[index];
      let my = restY[index];
      let strength = 0;
      if (b2 > 1e-12) {
        const ratio = b2 / bRefSq;
        strength = ratio >= 1 ? 1 : Math.pow(ratio, 0.3);
        const inverse = strength / b2;
        mx += (bx * bx - by * by) * inverse;
        my += 2 * bx * by * inverse;
      }

      let angle = theta[index];
      if (reduced) {
        angle = 0.5 * Math.atan2(my, mx);
        omega[index] = 0;
      } else {
        const twice = angle * 2;
        const torque = my * Math.cos(twice) - mx * Math.sin(twice);
        const drive = TORQUE * torque;
        let spin = omega[index];
        if (spin === 0 && (drive < 0 ? -drive : drive) < STICTION) {
          spin = 0;
        } else {
          const friction = spin > 0 ? STICTION : spin < 0 ? -STICTION : 0;
          const next = spin + (drive - damping * spin - friction) * dt;
          spin = (spin > 0 && next < 0) || (spin < 0 && next > 0) ? ((drive < 0 ? -drive : drive) < STICTION ? 0 : next) : next;
        }
        angle += spin * dt;
        omega[index] = spin;
        const speed = spin < 0 ? -spin : spin;
        if (speed > maxOmega) maxOmega = speed;
      }
      if (angle > HALF_PI) angle -= Math.PI;
      else if (angle < -HALF_PI) angle += Math.PI;
      theta[index] = angle;

      let targetX = 0;
      let targetY = 0;
      if (creep > 0 && strength > 0.04) {
        for (let pole = 0; pole < poleCount; pole += 1) {
          const dx = sourceX[pole] - x;
          const dy = sourceY[pole] - y;
          const r = Math.sqrt(dx * dx + dy * dy) + 1e-6;
          const reach = r > pullRadius ? r : pullRadius;
          const pull = (pullStrength * pullCube) / (reach * reach * reach * r);
          targetX += dx * pull;
          targetY += dy * pull;
        }
        if (strength > 0.1) {
          const laneFade = strength > 0.25 ? 1 : (strength - 0.1) / 0.15;
          let psi = 0;
          for (let pole = 0; pole < poleCount; pole += 1) {
            psi += poleQ[pole] * Math.atan2(y - sourceY[pole], x - sourceX[pole]);
          }
          let lane = psi / laneStep;
          lane -= Math.round(lane);
          const weight = (lane * laneStep * strength * strength * laneFade) / b2;
          let laneX = weight * by;
          let laneY = -weight * bx;
          const laneLength = Math.sqrt(laneX * laneX + laneY * laneY);
          if (laneLength > laneCap) {
            laneX *= laneCap / laneLength;
            laneY *= laneCap / laneLength;
          }
          targetX += laneX;
          targetY += laneY;
        }
        let cap = capFar;
        for (let magnet = 0; magnet < centreCount; magnet += 1) {
          const dx = x - centreX[magnet];
          const dy = y - centreY[magnet];
          if (dx * dx + dy * dy < nearSq) cap = capNear;
        }
        cap *= creep;
        const length = Math.sqrt(targetX * targetX + targetY * targetY);
        if (length > cap) {
          targetX *= cap / length;
          targetY *= cap / length;
        }
      }
      const deltaX = targetX - offsetX[index];
      const deltaY = targetY - offsetY[index];
      const drift = (deltaX < 0 ? -deltaX : deltaX) + (deltaY < 0 ? -deltaY : deltaY);
      if (drift > maxCreep) maxCreep = drift;
      offsetX[index] += deltaX * relax;
      offsetY[index] += deltaY * relax;

      const slot = index * 3;
      state[slot] = angle;
      state[slot + 1] = offsetX[index];
      state[slot + 2] = offsetY[index];
    }
    return { maxOmega, maxCreep };
  }
}

