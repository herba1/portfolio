export const MAX_DRIPS = 14;

const CELL = 10;
const FOG_CAP = 1.2;
const POOL_TRIGGER = 6;

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

export default class FogDrips {
  constructor(seed = 5) {
    this.random = mulberry(seed);
    this.cols = 0;
    this.rows = 0;
    this.width = 0;
    this.height = 0;
    this.fog = new Float32Array(0);
    this.pool = new Float32Array(0);
    this.drips = [];
    this.trails = [];
    this.data = new Float32Array(MAX_DRIPS * 4);
    this.meta = new Float32Array(MAX_DRIPS * 4);
  }

  resize(width, height) {
    const cols = Math.max(1, Math.ceil(width / CELL));
    const rows = Math.max(1, Math.ceil(height / CELL));
    const fog = new Float32Array(cols * rows);
    const pool = new Float32Array(cols * rows);
    if (this.cols) {
      for (let y = 0; y < rows; y += 1) {
        const sy = Math.min(this.rows - 1, Math.floor((y * this.rows) / rows));
        for (let x = 0; x < cols; x += 1) {
          const sx = Math.min(this.cols - 1, Math.floor((x * this.cols) / cols));
          fog[y * cols + x] = this.fog[sy * this.cols + sx];
        }
      }
      const kx = width / this.width;
      const ky = height / this.height;
      for (const d of this.drips) {
        d.x *= kx;
        d.y *= ky;
        d.px = d.x;
        d.py = d.y;
      }
    }
    this.cols = cols;
    this.rows = rows;
    this.width = width;
    this.height = height;
    this.fog = fog;
    this.pool = pool;
  }

  index(x, y) {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return -1;
    return cy * this.cols + cx;
  }

  fogAt(x, y) {
    const i = this.index(x, y);
    return i < 0 ? 0 : this.fog[i];
  }

  breathe(x, y, sigma, amount) {
    if (amount <= 0) return;
    const reach = sigma * 2.6;
    const x0 = Math.max(0, Math.floor((x - reach) / CELL));
    const x1 = Math.min(this.cols - 1, Math.floor((x + reach) / CELL));
    const y0 = Math.max(0, Math.floor((y - reach) / CELL));
    const y1 = Math.min(this.rows - 1, Math.floor((y + reach) / CELL));
    const inv = 1 / Math.max(1, 2 * sigma * sigma);
    for (let cy = y0; cy <= y1; cy += 1) {
      for (let cx = x0; cx <= x1; cx += 1) {
        const dx = (cx + 0.5) * CELL - x;
        const dy = (cy + 0.5) * CELL - y;
        const g = Math.exp(-Math.min(40, (dx * dx + dy * dy) * inv));
        const i = cy * this.cols + cx;
        this.fog[i] = Math.min(FOG_CAP, this.fog[i] + amount * g);
      }
    }
  }

  evaporate(amount) {
    if (amount <= 0) return;
    const fog = this.fog;
    for (let i = 0; i < fog.length; i += 1) if (fog[i] > 0) fog[i] = Math.max(0, fog[i] - amount);
    const pool = this.pool;
    for (let i = 0; i < pool.length; i += 1) if (pool[i] > 0) pool[i] = Math.max(0, pool[i] - amount * 0.6);
  }

  wipe(x0, y0, x1, y1, radius, pooling = 1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    const reach = radius + CELL;
    const gx0 = Math.max(0, Math.floor((Math.min(x0, x1) - reach) / CELL));
    const gx1 = Math.min(this.cols - 1, Math.floor((Math.max(x0, x1) + reach) / CELL));
    const gy0 = Math.max(0, Math.floor((Math.min(y0, y1) - reach) / CELL));
    const gy1 = Math.min(this.rows - 1, Math.floor((Math.max(y0, y1) + reach) / CELL));
    let gathered = 0;
    for (let cy = gy0; cy <= gy1; cy += 1) {
      for (let cx = gx0; cx <= gx1; cx += 1) {
        const px = (cx + 0.5) * CELL;
        const py = (cy + 0.5) * CELL;
        const t = len2 > 1e-4 ? Math.min(1, Math.max(0, ((px - x0) * dx + (py - y0) * dy) / len2)) : 0;
        const ex = x0 + dx * t - px;
        const ey = y0 + dy * t - py;
        if (ex * ex + ey * ey > radius * radius) continue;
        const i = cy * this.cols + cx;
        gathered += this.fog[i];
        this.fog[i] = 0;
      }
    }
    if (gathered <= 0 || pooling <= 0) return 0;
    return (gathered * pooling * CELL * CELL) / (Math.PI * radius * radius * 0.9);
  }

  pour(x, y, amount) {
    if (amount <= 0) return;
    const i = this.index(x, y);
    if (i < 0) return;
    this.pool[i] += amount;
    if (this.pool[i] > POOL_TRIGGER) {
      const mass = this.pool[i];
      this.pool[i] = 0;
      this.spawn(x, y, mass * 0.5);
    }
  }

  spawn(x, y, mass) {
    for (const d of this.drips) {
      if (Math.abs(d.x - x) < 12 && Math.abs(d.y - y) < 26) {
        d.mass += mass * 0.8;
        return;
      }
    }
    if (this.drips.length >= MAX_DRIPS) {
      let oldest = 0;
      for (let k = 1; k < this.drips.length; k += 1) if (this.drips[k].mass < this.drips[oldest].mass) oldest = k;
      this.drips.splice(oldest, 1);
    }
    const rand = this.random;
    this.drips.push({
      x,
      y,
      px: x,
      py: y,
      mass: Math.min(5, mass),
      speed: 0,
      stretch: 0,
      phase: rand() * 40,
      seed: rand(),
      grow: 0,
      settle: 0,
    });
  }

  radiusOf(d) {
    return Math.min(6.2, 1.6 + Math.sqrt(Math.max(0, d.mass)) * 1.9);
  }

  step(dt) {
    this.trails.length = 0;
    let moving = false;
    const kept = [];
    for (const d of this.drips) {
      d.px = d.x;
      d.py = d.y;
      d.grow = Math.min(1, d.grow + dt / 0.5);
      const r = this.radiusOf(d);
      d.phase += dt * (0.8 + d.seed * 0.7);
      const grip = 0.5 + 0.5 * Math.sin(d.phase * 1.7 + d.seed * 7) * Math.sin(d.phase * 0.63 + d.seed * 3);
      const heavy = Math.max(0, r - 3.1);
      const target = d.grow < 1 ? 0 : heavy * 26 * (0.18 + 0.82 * grip * grip);
      d.speed += (Math.min(target, 90) - d.speed) * (1 - Math.exp(-dt * 4));
      const dy = d.speed * dt;
      if (dy > 0.002) {
        moving = true;
        d.y += dy;
        d.x += dy * (Math.sin(d.phase * 0.9 + d.seed * 13) * 0.16 + Math.sin(d.phase * 2.1) * 0.04);
        const picked = this.fogAt(d.x, d.y + r) * dy * 0.05;
        d.mass = Math.min(6, d.mass + picked - dy * 0.034);
        this.trails.push([d.px, d.py, d.x, d.y, r]);
      } else {
        d.mass -= dt * 0.035;
      }
      d.stretch += (Math.min(0.9, d.speed / 32) - d.stretch) * (1 - Math.exp(-dt * 5));
      if (d.speed < 0.5) d.settle = Math.min(1, d.settle + dt);
      else d.settle = 0;
      if (d.mass > 0.04 && d.y - r < this.height + 20) kept.push(d);
    }
    this.drips = kept;
    return moving;
  }

  pack() {
    let n = 0;
    for (const d of this.drips) {
      const r = this.radiusOf(d);
      const g = d.grow;
      const eased = 1 - (1 - g) * (1 - g);
      this.data[n * 4] = d.x;
      this.data[n * 4 + 1] = d.y;
      this.data[n * 4 + 2] = r * eased * Math.min(1, d.mass / 0.25);
      this.data[n * 4 + 3] = d.stretch;
      n += 1;
    }
    return n;
  }

  clear() {
    this.fog.fill(0);
    this.pool.fill(0);
    this.drips.length = 0;
  }
}
