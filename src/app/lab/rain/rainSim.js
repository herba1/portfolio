export const MAX_DROPS = 1600;

const SLIDE_RADIUS = 9.5;
const STOP_RADIUS = 7;
const MERGE_REACH = 0.86;
const GROW_IN = 0.16;

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

function cbrtSum(a, b) {
  return Math.cbrt(a * a * a + b * b * b);
}

export default class RainSim {
  constructor(seed = 7) {
    this.random = mulberry(seed);
    this.drops = [];
    this.width = 0;
    this.height = 0;
    this.scale = 1;
    this.rate = 0.45;
    this.deposit = 0;
    this.spawnDebt = 0;
    this.trails = [];
    this.data = new Float32Array(MAX_DROPS * 4);
    this.grid = new Map();
  }

  resize(width, height) {
    if (this.width && this.height) {
      const sx = width / this.width;
      const sy = height / this.height;
      for (const d of this.drops) {
        d.x *= sx;
        d.y *= sy;
        d.px = d.x;
        d.py = d.y;
      }
    }
    this.width = width;
    this.height = height;
    this.scale = Math.min(1.15, Math.max(0.78, Math.min(width, height) / 800));
  }

  makeDrop(x, y, r, grown = false) {
    const rand = this.random;
    return {
      x,
      y,
      px: x,
      py: y,
      r,
      age: grown ? GROW_IN : 0,
      moving: false,
      speed: 0,
      phase: rand() * 100,
      seed: rand(),
      travel: 0,
      nextTrail: r * (0.8 + rand() * 1.6),
      stretch: 0,
      dead: false,
    };
  }

  add(x, y, r, grown) {
    if (this.drops.length >= MAX_DROPS) return null;
    const d = this.makeDrop(x, y, r, grown);
    this.drops.push(d);
    return d;
  }

  rainRadius() {
    const rand = this.random;
    const s = this.scale;
    const pick = rand();
    if (pick < 0.72) return s * (1.2 + Math.pow(rand(), 1.4) * 3);
    if (pick < 0.95) return s * (3.6 + Math.pow(rand(), 1.2) * 4.4);
    return s * (7.5 + rand() * 4.5);
  }

  spawn(dt) {
    const area = this.width * this.height;
    const perSecond = (4 + this.rate * this.rate * 70) * (area / 1e5) * 0.34;
    this.spawnDebt += perSecond * dt;
    const rand = this.random;
    while (this.spawnDebt >= 1) {
      this.spawnDebt -= 1;
      if (this.drops.length >= MAX_DROPS - 40) break;
      this.add(rand() * this.width, rand() * (this.height + 20) - 10, this.rainRadius());
    }
  }

  step(dt, ambient = true) {
    if (!this.width) return;
    if (ambient) this.spawn(dt);
    const s = this.scale;
    const slide = SLIDE_RADIUS * s;
    const stop = STOP_RADIUS * s;
    const rand = this.random;
    this.trails.length = 0;
    const born = [];
    for (const d of this.drops) {
      d.px = d.x;
      d.py = d.y;
      if (d.age < GROW_IN) d.age = Math.min(GROW_IN, d.age + dt);
      if (!ambient) continue;
      if (!d.moving && d.r > slide) d.moving = true;
      if (d.moving && d.r < stop) d.moving = false;
      if (!d.moving) {
        d.speed *= Math.exp(-dt * 10);
        d.stretch *= Math.exp(-dt * 6);
        continue;
      }
      d.phase += dt * (0.9 + d.seed * 0.8);
      const grip = 0.5 + 0.5 * Math.sin(d.phase * 1.9 + d.seed * 9) * Math.sin(d.phase * 0.71 + d.seed * 3);
      const surge = Math.max(0, grip) ** 1.5;
      const target = (14 + (d.r - stop) * 18) * s * (0.12 + 0.88 * surge);
      const capped = Math.min(target, 260 * s);
      d.speed += (capped - d.speed) * (1 - Math.exp(-dt * 7));
      const dy = d.speed * dt;
      const wander = Math.sin(d.phase * 0.83 + d.seed * 17) * 0.22 + Math.sin(d.phase * 2.3 + d.seed * 5) * 0.06;
      d.y += dy;
      d.x += dy * wander;
      d.stretch += (Math.min(0.75, d.speed / (90 * s)) - d.stretch) * (1 - Math.exp(-dt * 8));
      d.travel += dy;
      if (d.travel > d.nextTrail && d.r > stop * 1.02) {
        d.travel = 0;
        d.nextTrail = d.r * (0.5 + rand() * 2.2);
        const tr = d.r * (0.2 + rand() * 0.2);
        const remain = Math.cbrt(Math.max(0, d.r ** 3 - tr ** 3));
        d.r = remain;
        born.push(this.makeDrop(d.x + (rand() - 0.5) * d.r * 0.5, d.y - d.r * (1.1 + rand() * 0.5), tr, true));
      }
      this.trails.push(d);
    }
    for (const b of born) if (this.drops.length < MAX_DROPS) this.drops.push(b);
    this.merge();
    const bottom = this.height + 40 * s;
    let write = 0;
    for (const d of this.drops) {
      if (d.dead || d.y - d.r * 3 > bottom || d.r < 0.4) continue;
      this.drops[write] = d;
      write += 1;
    }
    this.drops.length = write;
  }

  merge() {
    const cell = 22 * this.scale;
    const grid = this.grid;
    grid.clear();
    const drops = this.drops;
    for (let i = 0; i < drops.length; i += 1) {
      const d = drops[i];
      const key = Math.floor(d.x / cell) * 4096 + Math.floor(d.y / cell);
      let bucket = grid.get(key);
      if (!bucket) {
        bucket = [];
        grid.set(key, bucket);
      }
      bucket.push(i);
    }
    for (let i = 0; i < drops.length; i += 1) {
      const a = drops[i];
      if (a.dead) continue;
      const cx = Math.floor(a.x / cell);
      const cy = Math.floor(a.y / cell);
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oy = -1; oy <= 1; oy += 1) {
          const bucket = grid.get((cx + ox) * 4096 + cy + oy);
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            const b = drops[j];
            if (b.dead || a.dead) continue;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const reach = (a.r + b.r) * MERGE_REACH;
            if (dx * dx + dy * dy > reach * reach) continue;
            const keep = a.moving && !b.moving ? a : b.moving && !a.moving ? b : a.r >= b.r ? a : b;
            const lose = keep === a ? b : a;
            const wa = keep.r ** 3;
            const wb = lose.r ** 3;
            const pull = keep.moving ? 0.18 : wb / (wa + wb);
            keep.x += (lose.x - keep.x) * pull;
            keep.y += (lose.y - keep.y) * pull * (keep.moving ? 0.3 : 1);
            keep.r = cbrtSum(keep.r, lose.r);
            keep.age = Math.max(keep.age, lose.age);
            if (lose.moving && !keep.moving) {
              keep.moving = true;
              keep.speed = lose.speed;
            }
            lose.dead = true;
          }
        }
      }
    }
  }

  wipe(x0, y0, x1, y1, radius) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    let removed = 0;
    for (const d of this.drops) {
      if (d.dead) continue;
      const t = len2 > 1e-4 ? Math.min(1, Math.max(0, ((d.x - x0) * dx + (d.y - y0) * dy) / len2)) : 0;
      const ex = x0 + dx * t - d.x;
      const ey = y0 + dy * t - d.y;
      const reach = radius + d.r * 0.25;
      if (ex * ex + ey * ey < reach * reach) {
        d.dead = true;
        removed += d.r ** 3;
      }
    }
    const len = Math.sqrt(len2);
    this.deposit = Math.min(this.deposit + removed * 0.7 + len * 0.35 * this.scale, 6000 * this.scale ** 3);
    if (len < 0.5) return;
    const nx = -dy / len;
    const ny = dx / len;
    const rand = this.random;
    const s = this.scale;
    let guard = 0;
    while (this.deposit > (3.2 * s) ** 3 && guard < 4) {
      guard += 1;
      const rr = s * (1.2 + Math.pow(rand(), 2.2) * 6.5);
      const t = rand();
      const side = rand() < 0.5 ? -1 : 1;
      const off = radius * (0.86 + rand() * 0.42) + rr * 0.5;
      this.add(x0 + dx * t + nx * off * side, y0 + dy * t + ny * off * side, rr, true);
      this.deposit -= rr ** 3;
    }
  }

  pack() {
    const data = this.data;
    let n = 0;
    for (const d of this.drops) {
      if (d.dead) continue;
      const grow = d.age / GROW_IN;
      const eased = 1 - (1 - grow) * (1 - grow);
      data[n * 4] = d.x;
      data[n * 4 + 1] = d.y;
      data[n * 4 + 2] = d.r * eased;
      data[n * 4 + 3] = d.stretch;
      n += 1;
    }
    return n;
  }
}
