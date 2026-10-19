const REST = 0;
const LOOSE = 1;
const FLY = 2;
const AWAY = 3;
const BACK = 4;

const GX = 28;
const GY = 28;
const DRAG = 1.8;
const FALL = 0.2;
const MAX_GUSTS = 140;
const WAVES = [
  [2.3, 0.9, 0.55, 0.0, 0.13],
  [-1.1, 2.6, 0.8, 1.9, 0.1],
  [3.4, -2.7, 0.9, 4.2, 0.06],
  [-4.6, -3.3, 1.4, 2.6, 0.04],
  [6.1, 4.4, 1.9, 0.7, 0.025],
];

function smooth(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export default class SeedSim {
  constructor(lattice, tones, motion) {
    const n = lattice.count;
    this.n = n;
    this.sp = lattice.sp;
    this.home = lattice.home;
    this.rnd = lattice.rnd;
    this.motion = motion;
    this.state = new Uint8Array(n);
    this.ambient = new Uint8Array(n);
    const f = () => new Float32Array(n);
    this.x = f();
    this.y = f();
    this.z = f();
    this.vx = f();
    this.vy = f();
    this.ax = f();
    this.ay = f();
    this.az = f();
    this.avx = f();
    this.avy = f();
    this.avz = f();
    this.spin = f();
    this.spinV = f();
    this.lx = f();
    this.ly = f();
    this.lvx = f();
    this.lvy = f();
    this.cx = f();
    this.cy = f();
    this.bx = f();
    this.by = f();
    this.timer = f();
    this.age = f();
    this.tone = f();
    this.toneTarget = f();
    this.present = f();
    this.zTop = f();
    this.returnAt = new Float64Array(n);
    this.rt = f();
    this.rdur = f();
    this.sx = f();
    this.sy = f();
    this.kx = f();
    this.ky = f();
    this.sz = f();
    this.rax = f();
    this.ray = f();
    this.raz = f();
    this.restTheta = new Float32Array(n);
    this.restTilt = new Float32Array(n);
    this.dyn = new Float32Array(n * 8);

    for (let i = 0; i < n; i += 1) {
      const theta = lattice.rest[i * 2];
      const tilt = lattice.rest[i * 2 + 1];
      this.restTheta[i] = theta;
      this.restTilt[i] = tilt;
      this.rax[i] = Math.sin(tilt) * Math.cos(theta);
      this.ray[i] = Math.sin(tilt) * Math.sin(theta);
      this.raz[i] = Math.cos(tilt);
      this.x[i] = this.home[i * 2];
      this.y[i] = this.home[i * 2 + 1];
      this.tone[i] = tones[i];
      this.toneTarget[i] = tones[i];
      this.present[i] = 1;
      this.spin[i] = this.rnd[i * 2 + 1] * 6.2831853;
      this.returnAt[i] = Infinity;
      const a = this.rnd[i * 2];
      const b = this.rnd[i * 2 + 1];
      if (tones[i] > 0.1 && ((a * 7919 + b * 104729) % 1) < 0.035) this.ambient[i] = 1;
    }

    this.grid = new Float32Array(GX * GY * 4);
    this.gusts = [];
    this.windOn = false;
    this.view = [-1.5, -1.5, 1.5, 1.5];
    this.time = 0;
    this.lastHard = -100;
    this.waiting = false;
    this.pause = 1;
    this.w = [0, 0, 0, 0];
    this.t2 = [0, 0];
    for (let i = 0; i < n; i += 1) this.writeRest(i);
  }

  setView(x0, y0, x1, y1) {
    this.view = [x0, y0, x1, y1];
  }

  addGust(x, y, vx, vy, hard) {
    const speed = Math.hypot(vx, vy);
    this.gusts.push({ x, y, vx, vy, age: 0, hard, r: 0.11 + Math.min(0.1, speed * 0.02) });
    if (this.gusts.length > MAX_GUSTS) this.gusts.shift();
    if (hard && speed > 0.3) this.markHard();
  }

  markHard() {
    this.lastHard = this.time;
    if (!this.waiting) {
      for (let i = 0; i < this.n; i += 1) {
        const st = this.state[i];
        if (st === FLY || st === AWAY) this.returnAt[i] = Infinity;
      }
    }
    this.waiting = true;
  }

  turbulence(x, y, t) {
    let vx = 0;
    let vy = 0;
    for (let k = 0; k < WAVES.length; k += 1) {
      const wave = WAVES[k];
      const c = Math.cos(wave[0] * x + wave[1] * y + wave[2] * t + wave[3]) * wave[4];
      vx += c * wave[1];
      vy -= c * wave[0];
    }
    this.t2[0] = vx;
    this.t2[1] = vy;
  }

  buildGrid(dt) {
    const gusts = this.gusts;
    for (let k = gusts.length - 1; k >= 0; k -= 1) {
      const g = gusts[k];
      g.age += dt;
      g.x += g.vx * dt * 0.32;
      g.y += g.vy * dt * 0.32;
      if (g.age > 1.3) gusts.splice(k, 1);
    }
    this.windOn = gusts.length > 0;
    if (!this.windOn) return;
    const grid = this.grid;
    grid.fill(0);
    const [x0, y0, x1, y1] = this.view;
    const cw = (x1 - x0) / (GX - 1);
    const ch = (y1 - y0) / (GY - 1);
    for (let k = 0; k < gusts.length; k += 1) {
      const g = gusts[k];
      const amp = Math.exp(-g.age * 2.6) * (g.hard ? 1 : 0.35);
      const reach = g.r * 2.3;
      const i0 = Math.max(0, Math.floor((g.x - reach - x0) / cw));
      const i1 = Math.min(GX - 1, Math.ceil((g.x + reach - x0) / cw));
      const j0 = Math.max(0, Math.floor((g.y - reach - y0) / ch));
      const j1 = Math.min(GY - 1, Math.ceil((g.y + reach - y0) / ch));
      const inv = 1 / (g.r * g.r);
      for (let j = j0; j <= j1; j += 1) {
        const py = y0 + j * ch - g.y;
        for (let i = i0; i <= i1; i += 1) {
          const px = x0 + i * cw - g.x;
          const weight = Math.exp(-(px * px + py * py) * inv) * amp;
          if (weight < 1e-3) continue;
          const cell = (j * GX + i) * 4;
          grid[cell] += g.vx * weight;
          grid[cell + 1] += g.vy * weight;
          if (g.hard) {
            grid[cell + 2] += g.vx * weight;
            grid[cell + 3] += g.vy * weight;
          }
        }
      }
    }
  }

  sample(x, y) {
    const w = this.w;
    if (!this.windOn) {
      w[0] = 0;
      w[1] = 0;
      w[2] = 0;
      w[3] = 0;
      return w;
    }
    const [x0, y0, x1, y1] = this.view;
    const fx = Math.min(GX - 1.001, Math.max(0, ((x - x0) / (x1 - x0)) * (GX - 1)));
    const fy = Math.min(GY - 1.001, Math.max(0, ((y - y0) / (y1 - y0)) * (GY - 1)));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const tx = fx - i;
    const ty = fy - j;
    const a = (j * GX + i) * 4;
    const b = a + 4;
    const c = a + GX * 4;
    const d = c + 4;
    const grid = this.grid;
    for (let k = 0; k < 4; k += 1) {
      const top = grid[a + k] * (1 - tx) + grid[b + k] * tx;
      const bottom = grid[c + k] * (1 - tx) + grid[d + k] * tx;
      w[k] = top * (1 - ty) + bottom * ty;
    }
    return w;
  }

  threshold(i) {
    return 0.5 + 1.3 * Math.pow(this.rnd[i * 2 + 1], 1.4);
  }

  sweep(nextTones, dirX, dirY) {
    const t = this.time;
    for (let i = 0; i < this.n; i += 1) {
      this.toneTarget[i] = nextTones[i];
      const st = this.state[i];
      const visible = this.tone[i] > 0.015;
      if (st === REST || st === LOOSE) {
        if (visible) {
          const hx = this.home[i * 2];
          const hy = this.home[i * 2 + 1];
          const lead = ((hx * dirX + hy * dirY) + 1) * 0.42;
          this.state[i] = LOOSE;
          this.timer[i] = 0.04 + lead + this.rnd[i * 2] * 0.14;
          const push = 2.2 * (0.8 + 0.4 * this.rnd[i * 2 + 1]);
          this.cx[i] = dirX * push - dirY * 0.3 * (this.rnd[i * 2] - 0.5);
          this.cy[i] = dirY * push + dirX * 0.3 * (this.rnd[i * 2] - 0.5) - 0.3;
        } else {
          this.tone[i] = nextTones[i];
          if (nextTones[i] > 0.015) {
            this.state[i] = AWAY;
            this.bx[i] = dirX * 0.3;
            this.by[i] = dirY * 0.3;
            this.returnAt[i] = Infinity;
            this.present[i] = 0;
            this.z[i] = 0.4;
            this.writeAway(i);
          }
        }
      } else if (st === AWAY) {
        this.tone[i] = nextTones[i];
      }
    }
    this.lastHard = t + 0.9;
    this.waiting = true;
    this.pause = 0.7;
    for (let i = 0; i < this.n; i += 1) {
      const st = this.state[i];
      if (st === FLY || st === AWAY) this.returnAt[i] = Infinity;
    }
  }

  launch(i) {
    const r1 = this.rnd[i * 2];
    const r2 = this.rnd[i * 2 + 1];
    let wx = this.cx[i];
    let wy = this.cy[i];
    const mag = Math.hypot(wx, wy);
    if (mag > 2) {
      wx *= 2 / mag;
      wy *= 2 / mag;
    }
    this.state[i] = FLY;
    const fan = (r1 - 0.5) * 0.9 + (r2 - 0.5) * 0.4;
    const fc = Math.cos(fan);
    const fs = Math.sin(fan);
    const fx = wx * fc - wy * fs;
    const fy = wx * fs + wy * fc;
    const take = 0.28 + 0.3 * r2;
    const keep = 0.18 + 0.38 * r1;
    this.vx[i] = fx * take + (r1 - 0.5) * 0.2;
    this.vy[i] = fy * take + (r2 - 0.5) * 0.2 - 0.1;
    this.cx[i] = fx * keep;
    this.cy[i] = fy * keep;
    const m = Math.max(1e-4, Math.hypot(fx, fy));
    const drift = 0.2 + 0.12 * r2;
    this.bx[i] = (fx / m) * drift;
    this.by[i] = (fy / m) * drift - 0.05;
    this.z[i] = 0;
    this.zTop[i] = 0.3 + 0.4 * r1;
    this.avx[i] = (r2 - 0.5) * 1.6;
    this.avy[i] = (r1 - 0.5) * 1.6;
    this.avz[i] = 0;
    const turn = r2 > 0.5 ? 1 : -1;
    this.spinV[i] = turn * (1.2 + 2.2 * r1);
    this.age[i] = 0;
    this.present[i] = 0;
    this.returnAt[i] = Infinity;
    this.waiting = true;
  }

  beginReturn(i) {
    const hx = this.home[i * 2];
    const hy = this.home[i * 2 + 1];
    const r1 = this.rnd[i * 2];
    const r2 = this.rnd[i * 2 + 1];
    let sx;
    let sy;
    let kx;
    let ky;
    let dur;
    if (this.state[i] === AWAY) {
      let dx = this.bx[i];
      let dy = this.by[i];
      const m = Math.hypot(dx, dy);
      if (m < 1e-4) {
        dx = 1;
        dy = 0;
      } else {
        dx /= m;
        dy /= m;
      }
      const qx = -dy;
      const qy = dx;
      const jitter = (r1 - 0.5) * 1.3;
      const px = hx + qx * jitter;
      const py = hy + qy * jitter;
      const [x0, y0, x1, y1] = this.view;
      const margin = 0.12;
      let reach = 8;
      if (dx > 1e-4) reach = Math.min(reach, (px - (x0 - margin)) / dx);
      if (dx < -1e-4) reach = Math.min(reach, (px - (x1 + margin)) / dx);
      if (dy > 1e-4) reach = Math.min(reach, (py - (y0 - margin)) / dy);
      if (dy < -1e-4) reach = Math.min(reach, (py - (y1 + margin)) / dy);
      reach = Math.max(0.4, reach + 0.08 + r2 * r1 * 1.1);
      sx = px - dx * reach;
      sy = py - dy * reach;
      const bow = (r2 - 0.5) * 0.5;
      kx = (sx + hx) * 0.5 + qx * bow;
      ky = (sy + hy) * 0.5 + qy * bow - 0.18;
      const dist = Math.hypot(hx - sx, hy - sy);
      dur = Math.min(2.3, Math.max(1.6, dist / 1.2)) * (0.9 + 0.2 * r2);
      this.sz[i] = 0.28 + 0.22 * r1;
      this.ax[i] = 0;
      this.ay[i] = -0.9;
      this.az[i] = 0.42;
      this.avx[i] = 0;
      this.avy[i] = 0;
      this.avz[i] = 0;
      this.spinV[i] = (r2 > 0.5 ? 1 : -1) * (1 + 1.5 * r1);
    } else {
      sx = this.x[i];
      sy = this.y[i];
      const dist = Math.hypot(hx - sx, hy - sy);
      dur = Math.min(3.6, Math.max(2.0, dist / 0.55)) * (0.9 + 0.2 * r2);
      kx = sx + (this.vx[i] * dur) / 4.4;
      ky = sy + (this.vy[i] * dur) / 4.4;
      this.sz[i] = this.z[i];
    }
    this.state[i] = BACK;
    this.sx[i] = sx;
    this.sy[i] = sy;
    this.kx[i] = kx;
    this.ky[i] = ky;
    this.rt[i] = 0;
    this.rdur[i] = dur;
    this.x[i] = sx;
    this.y[i] = sy;
  }

  scheduleReturns() {
    const t = this.time;
    let out = 0;
    for (let i = 0; i < this.n; i += 1) {
      const st = this.state[i];
      if ((st === FLY || st === AWAY) && this.toneTarget[i] > 0.015) out += 1;
    }
    const window = Math.min(5, Math.max(1.2, (out / 450) * 1.4));
    for (let i = 0; i < this.n; i += 1) {
      const st = this.state[i];
      if (st !== FLY && st !== AWAY) continue;
      const r1 = this.rnd[i * 2];
      const hx = this.home[i * 2];
      const hy = this.home[i * 2 + 1];
      const inward = Math.max(0, 1 - Math.min(1, hx * hx + hy * hy));
      const slot = Math.min(1, inward * 0.85 + r1 * 0.15);
      this.returnAt[i] = t + 0.1 + slot * window;
    }
    this.waiting = false;
    this.pause = 1;
  }

  springAxis(i, tx, ty, tz, dt, omega, zeta) {
    const tm = Math.max(1e-5, Math.hypot(tx, ty, tz));
    tx /= tm;
    ty /= tm;
    tz /= tm;
    const k = omega * omega;
    const d = 2 * zeta * omega;
    this.avx[i] += (k * (tx - this.ax[i]) - d * this.avx[i]) * dt;
    this.avy[i] += (k * (ty - this.ay[i]) - d * this.avy[i]) * dt;
    this.avz[i] += (k * (tz - this.az[i]) - d * this.avz[i]) * dt;
    let x = this.ax[i] + this.avx[i] * dt;
    let y = this.ay[i] + this.avy[i] * dt;
    let z = this.az[i] + this.avz[i] * dt;
    const m = Math.max(1e-5, Math.hypot(x, y, z));
    x /= m;
    y /= m;
    z /= m;
    this.ax[i] = x;
    this.ay[i] = y;
    this.az[i] = z;
  }

  writePose(i, x, y, z, ax, ay, az, present) {
    const o = i * 8;
    const dyn = this.dyn;
    dyn[o] = x;
    dyn[o + 1] = y;
    dyn[o + 2] = z;
    dyn[o + 3] = Math.atan2(ay, ax);
    dyn[o + 4] = Math.min(1.35, Math.acos(Math.min(1, Math.abs(az))));
    dyn[o + 5] = this.spin[i];
    dyn[o + 6] = this.tone[i];
    dyn[o + 7] = present;
  }

  writeRest(i) {
    const lx = this.lx[i];
    const ly = this.ly[i];
    const ax = this.rax[i] + lx * 1.15;
    const ay = this.ray[i] + ly * 1.15;
    const az = this.raz[i];
    const m = Math.max(1e-5, Math.hypot(ax, ay, az));
    this.ax[i] = ax / m;
    this.ay[i] = ay / m;
    this.az[i] = az / m;
    const reach = this.sp * 0.8;
    this.writePose(i, this.home[i * 2] + lx * reach, this.home[i * 2 + 1] + ly * reach, 0, this.ax[i], this.ay[i], this.az[i], 1);
  }

  writeAway(i) {
    const o = i * 8;
    this.dyn[o + 2] = -1;
    this.dyn[o + 6] = this.tone[i];
    this.dyn[o + 7] = 0;
  }

  step(dt, time) {
    this.time = time;
    this.buildGrid(dt);
    if (this.waiting && time - this.lastHard > this.pause) this.scheduleReturns();
    const motion = this.motion;
    let busy = this.windOn || this.waiting;
    let flying = false;
    let bare = false;
    const [x0, y0, x1, y1] = this.view;
    const margin = this.sp * 3 + 0.08;

    for (let i = 0; i < this.n; i += 1) {
      const st = this.state[i];
      const r1 = this.rnd[i * 2];
      const r2 = this.rnd[i * 2 + 1];

      if (st === REST || st === LOOSE) {
        if (this.tone[i] < 0.015 && st === REST) continue;
        const ambient = this.ambient[i] && motion > 0;
        if (!this.windOn && st === REST && !ambient && this.lx[i] === 0 && this.ly[i] === 0) continue;
        let tx = 0;
        let ty = 0;
        const hx = this.home[i * 2];
        const hy = this.home[i * 2 + 1];
        if (this.windOn) {
          const w = this.sample(hx, hy);
          tx = w[0] * 0.2;
          ty = w[1] * 0.2;
          if (st === REST && Math.hypot(w[2], w[3]) > this.threshold(i)) {
            this.state[i] = LOOSE;
            this.timer[i] = 0.03 + r1 * 0.2;
            this.cx[i] = w[0];
            this.cy[i] = w[1];
          } else if (st === LOOSE && Math.hypot(w[0], w[1]) > Math.hypot(this.cx[i], this.cy[i])) {
            this.cx[i] = w[0];
            this.cy[i] = w[1];
          }
        }
        if (ambient) {
          const ph = r1 * 6.2831853;
          tx += Math.sin(time * 0.8 + ph) * 0.19 + Math.sin(time * 0.31 + r2 * 9) * 0.1;
          ty += Math.cos(time * 0.6 + ph * 1.3) * 0.1;
        }
        if (this.state[i] === LOOSE) {
          tx = tx * 1.6 + Math.sin(time * 37 + r1 * 40) * 0.035;
          ty = ty * 1.6 + Math.cos(time * 41 + r2 * 40) * 0.035;
          this.timer[i] -= dt;
          busy = true;
        }
        const tm = Math.hypot(tx, ty);
        if (tm > 0.75) {
          tx *= 0.75 / tm;
          ty *= 0.75 / tm;
        }
        const omega = 10;
        const damp = 2 * 0.42 * omega;
        this.lvx[i] += (omega * omega * (tx - this.lx[i]) - damp * this.lvx[i]) * dt;
        this.lvy[i] += (omega * omega * (ty - this.ly[i]) - damp * this.lvy[i]) * dt;
        this.lx[i] += this.lvx[i] * dt;
        this.ly[i] += this.lvy[i] * dt;
        if (!ambient && tx === 0 && ty === 0 && Math.abs(this.lx[i]) + Math.abs(this.ly[i]) < 2e-4 && Math.abs(this.lvx[i]) + Math.abs(this.lvy[i]) < 2e-3) {
          this.lx[i] = 0;
          this.ly[i] = 0;
          this.lvx[i] = 0;
          this.lvy[i] = 0;
        } else busy = true;
        this.writeRest(i);
        if (this.state[i] === LOOSE && this.timer[i] <= 0) {
          this.x[i] = this.dyn[i * 8];
          this.y[i] = this.dyn[i * 8 + 1];
          this.lx[i] = 0;
          this.ly[i] = 0;
          this.lvx[i] = 0;
          this.lvy[i] = 0;
          this.launch(i);
        }
        continue;
      }

      busy = true;

      if (st === AWAY) {
        bare = true;
        if (this.returnAt[i] <= time) {
          this.beginReturn(i);
        } else continue;
      }

      if (this.state[i] === FLY) {
        flying = true;
        bare = true;
        if (this.returnAt[i] <= time) {
          this.beginReturn(i);
        } else {
          let x = this.x[i];
          let y = this.y[i];
          const w = this.sample(x, y);
          this.turbulence(x * 1.3, y * 1.3, time * 0.9 + r1 * 3);
          const turb = 0.85 * (0.6 + 0.4 * motion);
          const relax = 1 - Math.exp(-dt / 2.2);
          this.cx[i] += (this.bx[i] - this.cx[i]) * relax;
          this.cy[i] += (this.by[i] - this.cy[i]) * relax;
          const airX = w[0] + this.t2[0] * turb + this.cx[i];
          const airY = w[1] + this.t2[1] * turb + this.cy[i];
          const drag = DRAG * (0.6 + 0.8 * r2);
          let vx = this.vx[i] + (airX - this.vx[i]) * drag * dt;
          let vy = this.vy[i] + ((airY - this.vy[i]) * drag + FALL) * dt;
          const speed = Math.hypot(vx, vy);
          if (speed > 3) {
            vx *= 3 / speed;
            vy *= 3 / speed;
          }
          x += vx * dt;
          y += vy * dt;
          this.vx[i] = vx;
          this.vy[i] = vy;
          this.x[i] = x;
          this.y[i] = y;
          const age = this.age[i] + dt;
          this.age[i] = age;
          const bob = 0.06 * Math.sin(age * 1.7 + r2 * 6);
          this.z[i] += (this.zTop[i] + bob - this.z[i]) * (1 - Math.exp(-dt * 2.4));
          const relX = vx - airX;
          const relY = vy - airY;
          const relM = Math.max(0.06, Math.hypot(relX, relY + 0.02));
          const tumble = 0.55 * Math.sin(age * (1.1 + r2) + r1 * 6.2831853) + 0.25 * Math.sin(age * 2.7 + r2 * 11);
          const cs = Math.cos(tumble);
          const sn = Math.sin(tumble);
          const ux = -relX / relM;
          const uy = -(relY + 0.02) / relM;
          this.springAxis(i, ux * cs - uy * sn, ux * sn + uy * cs, 0.32 + 0.3 * (0.5 + 0.5 * Math.sin(age * 1.9 + r1 * 9)), dt, 5, 0.55);
          const sign = this.spinV[i] >= 0 ? 1 : -1;
          const want = sign * (1.3 + 2 * r1 + Math.hypot(relX, relY) * 1.5);
          this.spinV[i] += (want - this.spinV[i]) * Math.min(1, dt * 2);
          this.spin[i] += this.spinV[i] * dt;
          if (x < x0 - margin || x > x1 + margin || y < y0 - margin || y > y1 + margin) {
            this.state[i] = AWAY;
            this.tone[i] = this.toneTarget[i];
            this.writeAway(i);
            continue;
          }
          this.writePose(i, x, y, this.z[i], this.ax[i], this.ay[i], this.az[i], 0);
          continue;
        }
      }

      if (this.state[i] === BACK) {
        bare = true;
        if (this.windOn) {
          const w = this.sample(this.x[i], this.y[i]);
          if (Math.hypot(w[2], w[3]) > this.threshold(i) * 0.8) {
            this.cx[i] = w[0] + this.vx[i];
            this.cy[i] = w[1] + this.vy[i];
            const keepX = this.vx[i];
            const keepY = this.vy[i];
            const keepZ = this.z[i];
            this.launch(i);
            this.vx[i] = keepX + w[0] * 0.4;
            this.vy[i] = keepY + w[1] * 0.4;
            this.z[i] = keepZ;
            flying = true;
            this.writePose(i, this.x[i], this.y[i], this.z[i], this.ax[i], this.ay[i], this.az[i], 0);
            continue;
          }
        }
        const u = Math.min(1, this.rt[i] + dt / this.rdur[i]);
        this.rt[i] = u;
        const e = 1 - Math.pow(1 - u, 2.2);
        const ie = 1 - e;
        const hx = this.home[i * 2];
        const hy = this.home[i * 2 + 1];
        let x = ie * ie * this.sx[i] + 2 * ie * e * this.kx[i] + e * e * hx;
        let y = ie * ie * this.sy[i] + 2 * ie * e * this.ky[i] + e * e * hy;
        this.turbulence(x * 1.3, y * 1.3, time * 0.9 + r1 * 3);
        const wobble = 0.16 * Math.pow(ie, 1.5) * (0.4 + 0.6 * motion);
        x += this.t2[0] * wobble;
        y += this.t2[1] * wobble;
        const vx = (x - this.x[i]) / Math.max(dt, 1e-4);
        const vy = (y - this.y[i]) / Math.max(dt, 1e-4);
        this.vx[i] = vx;
        this.vy[i] = vy;
        this.x[i] = x;
        this.y[i] = y;
        const land = smooth(0.6, 1, e);
        const roll = 0.6 * Math.sin(time * (0.9 + r2) + r1 * 6.2831853) + 0.25 * Math.sin(time * 2.3 + r2 * 13);
        const gx = -0.15 * vx;
        const gy = -1 - 0.1 * vy;
        const fx = gx * Math.cos(roll) - gy * Math.sin(roll);
        const fy = gx * Math.sin(roll) + gy * Math.cos(roll);
        const lift = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(time * 1.4 + r2 * 9));
        const fm = Math.max(1e-5, Math.hypot(fx, fy, lift));
        const tx = (fx / fm) * (1 - land) + this.rax[i] * land;
        const ty = (fy / fm) * (1 - land) + this.ray[i] * land;
        const tz = (lift / fm) * (1 - land) + this.raz[i] * land;
        this.springAxis(i, tx, ty, tz, dt, 4.5 + 4 * land, 0.75);
        this.z[i] = this.sz[i] * (1 - smooth(0.45, 1, e));
        this.spinV[i] *= Math.exp(-dt * (0.3 + 3 * land));
        this.spin[i] += this.spinV[i] * dt;
        this.tone[i] += (this.toneTarget[i] - this.tone[i]) * Math.min(1, dt * 1.2);
        const present = -(1 - smooth(0.8, 1, e));
        if (u >= 1) {
          this.state[i] = REST;
          this.tone[i] = this.toneTarget[i];
          this.z[i] = 0;
          this.lx[i] = (this.ax[i] / Math.max(0.2, this.az[i])) * this.raz[i] - this.rax[i];
          this.ly[i] = (this.ay[i] / Math.max(0.2, this.az[i])) * this.raz[i] - this.ray[i];
          this.lx[i] = Math.max(-0.5, Math.min(0.5, this.lx[i] / 1.15));
          this.ly[i] = Math.max(-0.5, Math.min(0.5, this.ly[i] / 1.15));
          this.lvx[i] = 0;
          this.lvy[i] = 0;
          this.writeRest(i);
          continue;
        }
        if (present < 0) flying = true;
        this.writePose(i, x, y, this.z[i], this.ax[i], this.ay[i], this.az[i], present);
      }
    }

    this.flying = flying;
    this.bare = bare;
    return busy || (motion > 0 && this.hasAmbient());
  }

  hasAmbient() {
    if (this.ambientCount === undefined) {
      let count = 0;
      for (let i = 0; i < this.n; i += 1) count += this.ambient[i];
      this.ambientCount = count;
    }
    return this.ambientCount > 0;
  }
}
