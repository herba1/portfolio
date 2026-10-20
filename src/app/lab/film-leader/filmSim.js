export const PITCH = 38;
export const WIDTH = 35;
export const HALF = WIDTH / 2;
export const SEG = 3.8;
export const TILES = 16;
export const U_MAX = 604;
export const U_REST = 172;
export const LIP_INSIDE = 7;

const SUBSTEPS = 4;
const ITERATIONS = 10;
const GRAVITY = -300;
const FLOOR = 0.12;
const AIR = 4.4;
const TABLE_DRAG = 11;
const STICK = 3;
const MAX_SPEED = 2600;
const FREE_SPEED = 1100;
const FLING = 1200;
const MAX_TAKEUP = 1400;
const MIN_OUT = 46;
const CAN_CLEAR = 10;
const NEAR_MIN = 38;
const TURN_RADIUS = 40;
const CAN_X = 14.5;
const CAN_HALF = 42;
const CAN_TOP = 27;
const W_STIFF = 0.8;
const N_STIFF = 0.16;
const MIN_SIDE_RADIUS = 46;
const HOLD = 6;

function curlAt(f, u) {
  const lead = 1 / 14 + (1 / 50 - 1 / 14) * smooth(45, 115, f);
  const body = 1 / 160;
  const tail = (1 / 30) * smooth(420, 560, f);
  const near = smooth(u - 26, u - 6, f) * 0.006;
  return Math.max(lead, body) + tail - near;
}

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export default class FilmSim {
  constructor({ slot, dir }) {
    this.slot = slot;
    this.dir = dir;
    const cap = Math.ceil(U_MAX / SEG) + 4;
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.prev = new Float32Array(cap * 3);
    this.side = new Float32Array(cap * 3);
    this.contact = new Uint8Array(cap);
    this.n = 0;
    this.u = U_REST;
    this.uVel = 0;
    this.grab = null;
    this.target = [0, 0, 0];
    this.targetFrom = [0, 0, 0];
    this.motion = 0;
    this.taut = 0;
    this.rewindSpeed = 140;
    this.rest = U_REST;
    this.calm = 0;
    this.takeup = false;
    this.lastH = 1 / 240;
  }

  layout(yaw) {
    const [sx, sy, sz] = this.slot;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    this.n = Math.floor(this.u / SEG) + 1;
    for (let i = 0; i < this.n; i += 1) {
      const along = this.u - i * SEG;
      const bend = along * along * 0.000015;
      const x = sx + c * along - s * bend * 40;
      const z = sz + s * along + c * bend * 40;
      const y = Math.max(FLOOR, sy - along * 0.4);
      const k = i * 3;
      this.pos[k] = x;
      this.pos[k + 1] = y;
      this.pos[k + 2] = z;
      this.prev[k] = x;
      this.prev[k + 1] = y;
      this.prev[k + 2] = z;
    }
    this.transport();
  }

  settle(seconds) {
    const step = 1 / 60;
    for (let t = 0; t < seconds; t += step) this.step(step);
    for (let i = 0; i < this.n * 3; i += 1) this.prev[i] = this.pos[i];
    this.uVel = 0;
  }

  grabAt(index, point) {
    const i = Math.max(0, Math.min(this.n - 1, index));
    const hold = [];
    const k0 = i * 3;
    for (let j = -HOLD; j <= HOLD; j += 1) {
      const m = i + j;
      if (j === 0 || m < 0 || m >= this.n) continue;
      const km = m * 3;
      hold.push([m, this.pos[km] - this.pos[k0], this.pos[km + 1] - this.pos[k0 + 1], this.pos[km + 2] - this.pos[k0 + 2], 1 - Math.abs(j) / (HOLD + 1)]);
    }
    const reach0 = Math.hypot(this.pos[k0] - this.slot[0], this.pos[k0 + 1] - this.slot[1], this.pos[k0 + 2] - this.slot[2]);
    const slack0 = Math.max(0, this.u - i * SEG - (reach0 * 1.02 + 4));
    this.grab = { index: i, f: i * SEG, hold, slack0, fade: 0 };
    this.target[0] = point[0];
    this.target[1] = point[1];
    this.target[2] = point[2];
    const k = i * 3;
    this.targetFrom[0] = this.pos[k];
    this.targetFrom[1] = this.pos[k + 1];
    this.targetFrom[2] = this.pos[k + 2];
  }

  moveGrab(point) {
    if (!this.grab) return;
    this.target[0] = point[0];
    this.target[1] = point[1];
    this.target[2] = point[2];
  }

  release() {
    if (!this.grab) return;
    const k = this.grab.index * 3;
    let vx = this.pos[k] - this.prev[k];
    let vy = this.pos[k + 1] - this.prev[k + 1];
    let vz = this.pos[k + 2] - this.prev[k + 2];
    const speed = Math.hypot(vx, vy, vz) / this.lastH;
    if (speed > FLING) {
      const scale = FLING / speed;
      vx *= scale;
      vy *= scale;
      vz *= scale;
      this.prev[k] = this.pos[k] - vx;
      this.prev[k + 1] = this.pos[k + 1] - vy;
      this.prev[k + 2] = this.pos[k + 2] - vz;
    }
    this.grab = null;
  }

  reach(point) {
    if (!this.grab) return point;
    const f = this.grab.f;
    const available = U_MAX - f;
    const [sx, sy, sz] = this.slot;
    const dx = point[0] - sx;
    const dy = point[1] - sy;
    const dz = point[2] - sz;
    const dist = Math.hypot(dx, dy, dz);
    const limit = available * 0.985;
    const scale = dist <= limit || dist < 1e-6 ? 1 : limit / dist;
    return this.clearCan([sx + dx * scale, sy + dy * scale, sz + dz * scale]);
  }

  clearCan(input) {
    let point = input;
    const mx = CAN_X + CAN_CLEAR;
    const mz = CAN_HALF + CAN_CLEAR;
    if (point[0] < mx && Math.abs(point[2]) < mz) point = [mx, point[1], point[2]];
    const ox = point[0] - this.slot[0];
    const oz = point[2] - this.slot[2];
    const near = Math.hypot(ox, oz);
    if (near < NEAR_MIN) {
      const ux = near > 1e-3 ? ox / near : this.dir[0];
      const uz = near > 1e-3 ? oz / near : this.dir[2];
      point = [this.slot[0] + ux * NEAR_MIN, point[1], this.slot[2] + uz * NEAR_MIN];
    }
    const rx = point[0] - this.slot[0];
    const rz = point[2] - this.slot[2];
    const reach = Math.hypot(rx, rz);
    const base = Math.atan2(this.dir[2], this.dir[0]);
    let turn = Math.atan2(rz, rx) - base;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const room = reach < 2 * TURN_RADIUS ? Math.asin(reach / (2 * TURN_RADIUS)) + 0.26 : Math.PI * 0.86;
    if (Math.abs(turn) > room) {
      const a = base + Math.sign(turn) * room;
      point = [this.slot[0] + Math.cos(a) * reach, point[1], this.slot[2] + Math.sin(a) * reach];
    }
    return point;
  }

  step(dt) {
    const h = dt / SUBSTEPS;
    this.lastH = h;
    const from = [...this.targetFrom];
    const goal = this.grab ? this.reach(this.target) : null;
    let motion = 0;
    for (let s = 0; s < SUBSTEPS; s += 1) {
      const mix = (s + 1) / SUBSTEPS;
      const pin = goal ? [from[0] + (goal[0] - from[0]) * mix, from[1] + (goal[1] - from[1]) * mix, from[2] + (goal[2] - from[2]) * mix] : null;
      motion = Math.max(motion, this.substep(h, pin));
    }
    if (goal) {
      this.targetFrom[0] = goal[0];
      this.targetFrom[1] = goal[1];
      this.targetFrom[2] = goal[2];
    }
    this.motion = motion;
    return motion;
  }

  spool(h) {
    if (this.grab) {
      this.uVel *= Math.exp(-h * 7);
      if (this.u > this.rest) this.uVel -= 60 * h;
      if (this.grab.fade > 0) this.grab.slack0 = Math.max(0, this.grab.slack0 - this.grab.fade * h);
      const gi = this.grab.index * 3;
      const between = this.u - this.grab.f;
      const reach = Math.hypot(this.pos[gi] - this.slot[0], this.pos[gi + 1] - this.slot[1], this.pos[gi + 2] - this.slot[2]);
      const slack = between - (reach * 1.02 + 4) - this.grab.slack0;
      this.takeup = slack > 0;
      if (this.takeup) this.uVel = Math.min(this.uVel, -Math.min(MAX_TAKEUP, slack * 26));
    } else {
      this.takeup = false;
      const over = this.u - this.rest;
      const want = over > 0 ? -Math.min(this.rewindSpeed, over * 1.8 + 2) : Math.min(70, -over * 1.4);
      this.uVel += (want - this.uVel) * (1 - Math.exp(-h * 2.6));
      if (Math.abs(over) <= 0.25) {
        this.uVel = 0;
        this.u = this.rest;
      }
    }
    const before = this.u;
    this.u += this.uVel * h;
    const floor = Math.min(before, this.grab ? Math.max(MIN_OUT, this.grab.f + 14) : SEG * 2);
    if (this.u < floor) {
      this.u = floor;
      if (this.uVel < 0) this.uVel = 0;
    }
    this.u = Math.min(U_MAX, this.u);
  }

  resize() {
    const want = Math.floor(this.u / SEG) + 1;
    const [sx, sy, sz] = this.slot;
    const [dx, dy, dz] = this.dir;
    while (this.n < want && this.n < this.cap) {
      const f = this.n * SEG;
      const out = Math.max(0, this.u - f);
      const k = this.n * 3;
      this.pos[k] = sx + dx * out;
      this.pos[k + 1] = sy + dy * out;
      this.pos[k + 2] = sz + dz * out;
      const feed = this.uVel * this.lastH;
      this.prev[k] = this.pos[k] - dx * feed;
      this.prev[k + 1] = this.pos[k + 1] - dy * feed;
      this.prev[k + 2] = this.pos[k + 2] - dz * feed;
      this.n += 1;
    }
    while (this.n > want && this.n > 2) {
      this.n -= 1;
      if (this.grab && this.grab.index >= this.n) this.grab = null;
    }
  }

  transport() {
    const n = this.n;
    const P = this.pos;
    const W = this.side;
    const [dx, , dz] = this.dir;
    let wx = -dz;
    let wy = 0;
    let wz = dx;
    const len0 = Math.hypot(wx, wz) || 1;
    wx /= len0;
    wz /= len0;
    let px = this.slot[0];
    let py = this.slot[1];
    let pz = this.slot[2];
    let ax = -this.dir[0];
    let ay = -this.dir[1];
    let az = -this.dir[2];
    for (let i = n - 1; i >= 0; i -= 1) {
      const k = i * 3;
      let tx = px - P[k];
      let ty = py - P[k + 1];
      let tz = pz - P[k + 2];
      if (i === n - 1) {
        const short = Math.max(0, SEG - Math.hypot(tx, ty, tz));
        tx -= this.dir[0] * short;
        ty -= this.dir[1] * short;
        tz -= this.dir[2] * short;
      }
      const tl = Math.hypot(tx, ty, tz);
      if (tl > 1e-5) {
        tx /= tl;
        ty /= tl;
        tz /= tl;
        const c = ax * tx + ay * ty + az * tz;
        if (c > -0.95) {
          const vx = ay * tz - az * ty;
          const vy = az * tx - ax * tz;
          const vz = ax * ty - ay * tx;
          const cx = vy * wz - vz * wy;
          const cy = vz * wx - vx * wz;
          const cz = vx * wy - vy * wx;
          const k2 = 1 / (1 + c);
          wx += cx + (vy * cz - vz * cy) * k2;
          wy += cy + (vz * cx - vx * cz) * k2;
          wz += cz + (vx * cy - vy * cx) * k2;
        }
        const rx = wx;
        const ry = wy;
        const rz = wz;
        wy *= 0.2;
        let d = wx * tx + wy * ty + wz * tz;
        wx -= d * tx;
        wy -= d * ty;
        wz -= d * tz;
        let wl = Math.hypot(wx, wy, wz);
        if (wl < 0.3) {
          d = rx * tx + ry * ty + rz * tz;
          wx = rx - d * tx;
          wy = ry - d * ty;
          wz = rz - d * tz;
          wl = Math.hypot(wx, wy, wz);
        }
        wl = wl || 1;
        wx /= wl;
        wy /= wl;
        wz /= wl;
        ax = tx;
        ay = ty;
        az = tz;
      }
      W[k] = wx;
      W[k + 1] = wy;
      W[k + 2] = wz;
      px = P[k];
      py = P[k + 1];
      pz = P[k + 2];
    }
  }

  substep(h, pin) {
    this.spool(h);
    this.resize();
    const n = this.n;
    const P = this.pos;
    const Q = this.prev;
    if (this.grab || Math.abs(this.u - this.rest) > 0.3) this.calm = 0;
    else this.calm = Math.min(1, this.calm + h / 1.6);
    const airKeep = Math.exp(-(AIR + this.calm * this.calm * 40) * h);
    for (let i = 0; i < n; i += 1) {
      const k = i * 3;
      const vx = (P[k] - Q[k]) * airKeep;
      const vy = (P[k + 1] - Q[k + 1]) * airKeep;
      const vz = (P[k + 2] - Q[k + 2]) * airKeep;
      Q[k] = P[k];
      Q[k + 1] = P[k + 1];
      Q[k + 2] = P[k + 2];
      P[k] += vx;
      P[k + 1] += vy + GRAVITY * h * h;
      P[k + 2] += vz;
    }
    const grabbed = pin && this.grab ? this.grab.index : -1;
    if (grabbed >= 0) {
      const k = grabbed * 3;
      P[k] = pin[0];
      P[k + 1] = pin[1];
      P[k + 2] = pin[2];
    }
    this.transport();
    const uStart = this.u;
    const share = this.grab ? (this.takeup ? 0 : 0.9) : this.u > this.rest + 1 ? 0 : 0.18;
    const [sx, sy, sz] = this.slot;
    const [dx, dy, dz] = this.dir;
    for (let it = 0; it < ITERATIONS; it += 1) {
      for (let i = 0; i < n - 1; i += 1) {
        const a = i * 3;
        const b = a + 3;
        const ex = P[b] - P[a];
        const ey = P[b + 1] - P[a + 1];
        const ez = P[b + 2] - P[a + 2];
        const len = Math.hypot(ex, ey, ez);
        if (len < 1e-6) continue;
        const wa = i === grabbed ? 0 : 1;
        const wb = i + 1 === grabbed ? 0 : 1;
        const sum = wa + wb;
        if (sum === 0) continue;
        const diff = (len - SEG) / len / sum;
        P[a] += ex * diff * wa;
        P[a + 1] += ey * diff * wa;
        P[a + 2] += ez * diff * wa;
        P[b] -= ex * diff * wb;
        P[b + 1] -= ey * diff * wb;
        P[b + 2] -= ez * diff * wb;
      }
      const last = (n - 1) * 3;
      const rem = Math.max(0, this.u - (n - 1) * SEG);
      const rx = P[last] - sx;
      const ry = P[last + 1] - sy;
      const rz = P[last + 2] - sz;
      const rl = Math.hypot(rx, ry, rz);
      if (rl > rem && rl > 1e-6) {
        const excess = rl - rem;
        const room = U_MAX - this.u;
        const feed = Math.min(room, excess * share);
        this.u += feed;
        if (n - 1 !== grabbed) {
          const move = (excess - feed) / rl;
          P[last] -= rx * move;
          P[last + 1] -= ry * move;
          P[last + 2] -= rz * move;
        }
      }
      const remNow = Math.max(0, this.u - (n - 1) * SEG);
      for (let j = 0; j < 3 && j < n; j += 1) {
        const idx = n - 1 - j;
        if (idx === grabbed) break;
        const kk = idx * 3;
        const out = remNow + j * SEG;
        const pull = j === 0 ? 0.4 : j === 1 ? 0.18 : 0.06;
        P[kk] += (sx + dx * out - P[kk]) * pull;
        P[kk + 1] += (sy + dy * out - P[kk + 1]) * pull;
        P[kk + 2] += (sz + dz * out - P[kk + 2]) * pull;
      }
      this.bend(grabbed);
      if (pin && this.grab) this.holdGrip(pin);
      this.collide(grabbed);
    }
    for (let pass = 0; pass < 10; pass += 1) this.limitSide(grabbed);
    this.collide(grabbed);
    const fed = this.u - uStart;
    if (fed > 0 && this.grab) this.uVel = Math.max(this.uVel, fed / h);
    this.taut = fed / h;
    this.resize();
    let motion = 0;
    const drag = Math.exp(-TABLE_DRAG * h);
    for (let i = 0; i < this.n; i += 1) {
      const k = i * 3;
      let vx = P[k] - Q[k];
      let vy = P[k + 1] - Q[k + 1];
      let vz = P[k + 2] - Q[k + 2];
      if (this.contact[i]) {
        vx *= drag;
        vz *= drag;
        if (vy < 0) vy = 0;
        if (Math.hypot(vx, vz) < STICK * h) {
          vx = 0;
          vz = 0;
        }
      }
      const sp = Math.hypot(vx, vy, vz);
      const cap = (this.grab ? MAX_SPEED : FREE_SPEED) * h;
      if (sp > cap) {
        vx *= cap / sp;
        vy *= cap / sp;
        vz *= cap / sp;
      }
      Q[k] = P[k] - vx;
      Q[k + 1] = P[k + 1] - vy;
      Q[k + 2] = P[k + 2] - vz;
      if (i !== grabbed) motion = Math.max(motion, sp / h);
    }
    motion = Math.max(motion, Math.abs(this.uVel));
    return motion;
  }

  holdGrip(pin) {
    const P = this.pos;
    for (const [m, ox, oy, oz, w] of this.grab.hold) {
      if (m >= this.n) continue;
      const k = m * 3;
      const t = 0.5 * w;
      P[k] += (pin[0] + ox - P[k]) * t;
      P[k + 1] += (Math.max(FLOOR, pin[1] + oy) - P[k + 1]) * t;
      P[k + 2] += (pin[2] + oz - P[k + 2]) * t;
    }
  }

  bend(grabbed) {
    const n = this.n;
    const P = this.pos;
    const W = this.side;
    const u = this.u;
    for (let i = 1; i < n - 1; i += 1) {
      const a = (i - 1) * 3;
      const b = i * 3;
      const c = (i + 1) * 3;
      let tx = P[c] - P[a];
      let ty = P[c + 1] - P[a + 1];
      let tz = P[c + 2] - P[a + 2];
      const chord = Math.hypot(tx, ty, tz);
      if (chord < 1e-5) continue;
      tx /= chord;
      ty /= chord;
      tz /= chord;
      let wx = W[b];
      let wy = W[b + 1];
      let wz = W[b + 2];
      const d = wx * tx + wy * ty + wz * tz;
      wx -= d * tx;
      wy -= d * ty;
      wz -= d * tz;
      const wl = Math.hypot(wx, wy, wz) || 1;
      wx /= wl;
      wy /= wl;
      wz /= wl;
      const nx = wy * tz - wz * ty;
      const ny = wz * tx - wx * tz;
      const nz = wx * ty - wy * tx;
      const kappa = curlAt(i * SEG, u);
      const sag = (kappa * chord * chord) / 8;
      const mx = (P[a] + P[c]) * 0.5 + nx * sag;
      const my = (P[a + 1] + P[c + 1]) * 0.5 + ny * sag;
      const mz = (P[a + 2] + P[c + 2]) * 0.5 + nz * sag;
      const ex = mx - P[b];
      const ey = my - P[b + 1];
      const ez = mz - P[b + 2];
      const along = ex * wx + ey * wy + ez * wz;
      const limit = (chord * chord) / (8 * MIN_SIDE_RADIUS);
      const hard = along - Math.max(-limit, Math.min(limit, along));
      const soft = along - hard;
      const side = soft * W_STIFF + hard / 1.5;
      const cx = (ex - along * wx) * N_STIFF + side * wx;
      const cy = (ey - along * wy) * N_STIFF + side * wy;
      const cz = (ez - along * wz) * N_STIFF + side * wz;
      const wa = i - 1 === grabbed ? 0 : 1;
      const wb = i === grabbed ? 0 : 2;
      const wc = i + 1 === grabbed ? 0 : 1;
      const total = wa + wb + wc;
      if (total === 0) continue;
      const kb = wb / total;
      const ka = wa / total;
      const kc = wc / total;
      P[b] += cx * kb * 1.5;
      P[b + 1] += cy * kb * 1.5;
      P[b + 2] += cz * kb * 1.5;
      P[a] -= cx * ka * 1.5;
      P[a + 1] -= cy * ka * 1.5;
      P[a + 2] -= cz * ka * 1.5;
      P[c] -= cx * kc * 1.5;
      P[c + 1] -= cy * kc * 1.5;
      P[c + 2] -= cz * kc * 1.5;
    }
  }

  limitSide(grabbed) {
    const n = this.n;
    const P = this.pos;
    const W = this.side;
    for (let i = 1; i < n - 1; i += 1) {
      const a = (i - 1) * 3;
      const b = i * 3;
      const c = (i + 1) * 3;
      const chord = Math.hypot(P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]);
      const wx = W[b];
      const wy = W[b + 1];
      const wz = W[b + 2];
      const along = (P[b] - (P[a] + P[c]) * 0.5) * wx + (P[b + 1] - (P[a + 1] + P[c + 1]) * 0.5) * wy + (P[b + 2] - (P[a + 2] + P[c + 2]) * 0.5) * wz;
      const limit = (chord * chord) / (8 * MIN_SIDE_RADIUS);
      const excess = along - Math.max(-limit, Math.min(limit, along));
      if (excess === 0) continue;
      const wa = i - 1 === grabbed ? 0 : 1;
      const wb = i === grabbed ? 0 : 2;
      const wc = i + 1 === grabbed ? 0 : 1;
      const total = wa + wb + wc;
      if (total === 0) continue;
      const k = excess / (wb / total + 0.5 * (wa + wc) / total);
      const mb = (-k * wb) / total;
      const ma = (k * wa) / total;
      const mc = (k * wc) / total;
      P[b] += wx * mb;
      P[b + 1] += wy * mb;
      P[b + 2] += wz * mb;
      P[a] += wx * ma * 0.5;
      P[a + 1] += wy * ma * 0.5;
      P[a + 2] += wz * ma * 0.5;
      P[c] += wx * mc * 0.5;
      P[c + 1] += wy * mc * 0.5;
      P[c + 2] += wz * mc * 0.5;
    }
  }

  collide(grabbed) {
    const n = this.n;
    const P = this.pos;
    for (let i = 0; i < n; i += 1) {
      const k = i * 3;
      if (P[k + 1] < FLOOR) {
        P[k + 1] = FLOOR;
        this.contact[i] = 1;
      } else {
        this.contact[i] = P[k + 1] < FLOOR + 0.25 ? 1 : 0;
      }
      if (i === grabbed) continue;
      const W = this.side;
      const ex = i >= n - 3 ? 0 : HALF * Math.abs(W[k]);
      const ez = HALF * Math.abs(W[k + 2]);
      const ey = HALF * Math.abs(W[k + 1]);
      if (P[k + 1] < CAN_TOP + ey) {
        const px = Math.abs(P[k]) - CAN_X - ex;
        const pz = Math.abs(P[k + 2]) - CAN_HALF - ez;
        const py = P[k + 1] - CAN_TOP - ey;
        if (px < 0 && pz < 0) {
          if (py > px && py > pz) P[k + 1] = CAN_TOP + ey;
          else if (px > pz) P[k] = Math.sign(P[k] || 1) * (CAN_X + ex);
          else P[k + 2] = Math.sign(P[k + 2] || 1) * (CAN_HALF + ez);
        }
      }
    }
  }
}
