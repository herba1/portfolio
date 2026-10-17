export const MAX_SPECKS = 14000;
const STRIDE = 8;

export default class DustCloud {
  constructor(seed = 1) {
    this.x = new Float32Array(MAX_SPECKS);
    this.y = new Float32Array(MAX_SPECKS);
    this.z = new Float32Array(MAX_SPECKS);
    this.vx = new Float32Array(MAX_SPECKS);
    this.vy = new Float32Array(MAX_SPECKS);
    this.vz = new Float32Array(MAX_SPECKS);
    this.age = new Float32Array(MAX_SPECKS);
    this.life = new Float32Array(MAX_SPECKS);
    this.size = new Float32Array(MAX_SPECKS);
    this.tone = new Float32Array(MAX_SPECKS);
    this.glint = new Float32Array(MAX_SPECKS);
    this.landed = new Float32Array(MAX_SPECKS);
    this.data = new Float32Array(MAX_SPECKS * STRIDE);
    this.count = 0;
    this.time = 0;
    this.state = seed >>> 0 || 1;
  }

  rand() {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }

  add(x, y, z, vx, vy, vz, life, size) {
    let i = this.count;
    if (i >= MAX_SPECKS) {
      i = Math.floor(this.rand() * MAX_SPECKS);
    } else {
      this.count += 1;
    }
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
    this.tone[i] = 0.75 + this.rand() * 0.5;
    this.glint[i] = this.rand();
    this.landed[i] = 0;
  }

  lift(x, y, bvx, bvy, nx, ny, side, fast) {
    const r = this.rand();
    const riser = r < 0.32 + 0.3 * fast;
    const carry = 0.12 + this.rand() * (0.35 + 0.3 * fast);
    const kick = (20 + this.rand() * 90) * (1 + fast) * side;
    const vx = bvx * carry + nx * kick + (this.rand() - 0.5) * 30;
    const vy = bvy * carry + ny * kick + (this.rand() - 0.5) * 30;
    if (riser) {
      const vz = (34 + this.rand() * 110) * (1 + 0.9 * fast);
      this.add(x, y, 0.5, vx, vy, vz, 7 + this.rand() * 9, 0.7 + Math.pow(this.rand(), 3) * 2.2);
    } else {
      const vz = 4 + this.rand() * 26;
      this.add(x, y, 0.2, vx * 1.3, vy * 1.3, vz, 1.2 + this.rand() * 2.4, 0.6 + Math.pow(this.rand(), 2) * 1.3);
    }
  }

  fall(x, y, z, life) {
    const vx = (this.rand() - 0.5) * 16;
    const vy = (this.rand() - 0.5) * 16;
    this.add(x, y, z, vx, vy, -(18 + this.rand() * 40), life, 0.7 + Math.pow(this.rand(), 3) * 2);
  }

  step(dt, center, reach) {
    this.time += dt;
    const t = this.time;
    const dragXY = Math.exp(-dt * 1.5);
    const dragZ = Math.exp(-dt * 0.9);
    const gravity = 7;
    let i = 0;
    while (i < this.count) {
      this.age[i] += dt;
      const z = this.z[i];
      if (this.landed[i] > 0) {
        this.landed[i] += dt;
        if (this.landed[i] > 0.9) {
          this.kill(i);
          continue;
        }
        i += 1;
        continue;
      }
      const x = this.x[i];
      const y = this.y[i];
      const air = Math.min(1, z / 20);
      const fx = Math.sin(y * 0.011 + t * 0.37 + i * 0.013) * 16 + Math.sin(x * 0.006 - t * 0.23) * 10;
      const fy = Math.cos(x * 0.0105 - t * 0.31 + i * 0.007) * 16 + Math.cos(y * 0.0071 + t * 0.19) * 10;
      const ox = x - center[0];
      const oy = y - center[1];
      const od = Math.hypot(ox, oy) || 1;
      const out = 7 * air * Math.min(1, od / reach);
      this.vx[i] = this.vx[i] * dragXY + (fx * air + (ox / od) * out) * dt;
      this.vy[i] = this.vy[i] * dragXY + (fy * air + (oy / od) * out) * dt;
      this.vz[i] = this.vz[i] * dragZ - gravity * dt + Math.sin(t * 0.8 + i) * 3 * air * dt;
      this.x[i] = x + this.vx[i] * dt;
      this.y[i] = y + this.vy[i] * dt;
      this.z[i] = z + this.vz[i] * dt;
      if (this.z[i] <= 0) {
        this.z[i] = 0;
        this.landed[i] = 1e-4;
      } else if (this.age[i] > this.life[i]) {
        this.landed[i] = 1e-4;
      }
      i += 1;
    }
  }

  kill(i) {
    const j = this.count - 1;
    if (i !== j) {
      this.x[i] = this.x[j];
      this.y[i] = this.y[j];
      this.z[i] = this.z[j];
      this.vx[i] = this.vx[j];
      this.vy[i] = this.vy[j];
      this.vz[i] = this.vz[j];
      this.age[i] = this.age[j];
      this.life[i] = this.life[j];
      this.size[i] = this.size[j];
      this.tone[i] = this.tone[j];
      this.glint[i] = this.glint[j];
      this.landed[i] = this.landed[j];
    }
    this.count = j;
  }

  pack() {
    const d = this.data;
    for (let i = 0; i < this.count; i += 1) {
      const k = i * STRIDE;
      const a = this.age[i];
      const fadeIn = Math.min(1, a / 0.12);
      const fadeOut = this.landed[i] > 0 ? Math.max(0, 1 - this.landed[i] / 0.9) : 1;
      d[k] = this.x[i];
      d[k + 1] = this.y[i];
      d[k + 2] = this.z[i];
      d[k + 3] = fadeIn * fadeOut;
      d[k + 4] = this.size[i];
      d[k + 5] = this.tone[i];
      d[k + 6] = this.glint[i];
      d[k + 7] = 0;
    }
    return this.count;
  }

  clear() {
    this.count = 0;
  }
}
