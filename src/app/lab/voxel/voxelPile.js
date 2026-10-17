const MAXH = 48;
const NONE = 0;
const FLY = 1;
const REST = 2;
const IDLE = 0;
const SETTLE = 1;
const ROLL = 2;
const DROP = 3;
const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createPile(THREE, { count, side, cell, originX, originZ, gx, gz, gravity, groundAt, blockedTop, reduced }) {
  const state = new Uint8Array(count);
  const anim = new Uint8Array(count);
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const spin = new Float32Array(count * 3);
  const quat = new Float32Array(count * 4);
  const rest = new Float32Array(count * 4);
  const from = new Float32Array(count * 3);
  const fromQ = new Float32Array(count * 4);
  const rollDir = new Float32Array(count * 2);
  const t0 = new Float32Array(count);
  const momentum = new Float32Array(count);
  const travel = new Uint8Array(count);
  const column = new Int32Array(count).fill(-1);
  const jitter = new Float32Array(count * 3);
  const cells = gx * gz;
  const height = new Uint8Array(cells);
  const stack = new Int32Array(cells * MAXH);
  const queued = new Uint8Array(cells);
  let queue = [];
  const members = new Set();
  const rand = rng(23);
  const hand = { on: false, x: 0, z: 0, vx: 0, vz: 0, r: 0.26 };
  const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
  const tipTime = reduced ? 0.08 : 0.17;
  const settleTime = reduced ? 0.06 : 0.13;

  for (let n = 0; n < count; n += 1) {
    quat[n * 4 + 3] = 1;
    jitter[n * 3] = (rand() - 0.5) * 0.012;
    jitter[n * 3 + 1] = (rand() - 0.5) * 0.012;
    jitter[n * 3 + 2] = (rand() - 0.5) * 0.16;
  }

  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const qc = new THREE.Quaternion();
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const axisV = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const ex = new THREE.Vector3();
  const ey = new THREE.Vector3();
  const ez = new THREE.Vector3();
  const axes = [ex, ey, ez];
  const basis = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const out = [basis[0], basis[1], basis[2]];

  const cellX = (c) => originX + ((c % gx) + 0.5) * cell;
  const cellZ = (c) => originZ + (Math.floor(c / gx) + 0.5) * cell;
  const cellAt = (x, z) => {
    const i = Math.floor((x - originX) / cell);
    const j = Math.floor((z - originZ) / cell);
    if (i < 0 || j < 0 || i >= gx || j >= gz) return -1;
    return j * gx + i;
  };
  const blocked = (c) => blockedTop(c % gx, Math.floor(c / gx));
  const topOf = (c) => {
    const b = blocked(c);
    if (b >= 0) return b;
    return groundAt(cellX(c), cellZ(c)) + height[c] * side;
  };

  function readQ(arr, n, q) {
    return q.set(arr[n * 4], arr[n * 4 + 1], arr[n * 4 + 2], arr[n * 4 + 3]);
  }
  function writeQ(arr, n, q) {
    arr[n * 4] = q.x;
    arr[n * 4 + 1] = q.y;
    arr[n * 4 + 2] = q.z;
    arr[n * 4 + 3] = q.w;
  }

  function snap(n) {
    readQ(quat, n, qa);
    m4.makeRotationFromQuaternion(qa);
    m4.extractBasis(ex, ey, ez);
    axes[0] = ex;
    axes[1] = ey;
    axes[2] = ez;
    let up = 0;
    for (let k = 1; k < 3; k += 1) if (Math.abs(axes[k].y) > Math.abs(axes[up].y)) up = k;
    const fwd = (up + 1) % 3;
    const third = (up + 2) % 3;
    const upSign = axes[up].y < 0 ? -1 : 1;
    const f = axes[fwd];
    let ang = Math.atan2(f.z, f.x);
    ang = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2) + jitter[n * 3 + 2];
    out[up] = basis[0].set(0, upSign, 0);
    out[fwd] = basis[1].set(Math.cos(ang), 0, Math.sin(ang));
    out[third] = basis[2].crossVectors(basis[0], basis[1]);
    m4.makeBasis(out[0], out[1], out[2]);
    if (m4.determinant() < 0) {
      basis[2].multiplyScalar(-1);
      m4.makeBasis(out[0], out[1], out[2]);
    }
    qb.setFromRotationMatrix(m4);
    if (qb.dot(qa) < 0) qb.set(-qb.x, -qb.y, -qb.z, -qb.w);
    writeQ(rest, n, qb);
  }

  function target(n, out) {
    const c = column[n];
    let level = 0;
    const base = c * MAXH;
    for (let k = 0; k < height[c]; k += 1) {
      if (stack[base + k] === n) {
        level = k;
        break;
      }
    }
    out[0] = cellX(c) + jitter[n * 3];
    out[2] = cellZ(c) + jitter[n * 3 + 1];
    out[1] = groundAt(cellX(c), cellZ(c)) + level * side + side / 2;
    return out;
  }

  function schedule(c) {
    if (c < 0 || queued[c]) return;
    queued[c] = 1;
    queue.push(c);
  }

  function scheduleAround(c) {
    schedule(c);
    const i = c % gx;
    const j = Math.floor(c / gx);
    for (const [di, dj] of NEIGHBOURS) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= gx || b >= gz) continue;
      schedule(b * gx + a);
    }
  }

  function push(n, c) {
    const h = height[c];
    if (h >= MAXH) return false;
    stack[c * MAXH + h] = n;
    height[c] = h + 1;
    column[n] = c;
    return true;
  }

  function pull(n) {
    const c = column[n];
    if (c < 0) return;
    const base = c * MAXH;
    const h = height[c];
    let k = 0;
    while (k < h && stack[base + k] !== n) k += 1;
    for (let m = k; m < h - 1; m += 1) {
      const above = stack[base + m + 1];
      stack[base + m] = above;
      if (anim[above] === IDLE || anim[above] === DROP) {
        if (anim[above] === IDLE) {
          anim[above] = DROP;
          t0[above] = 0;
          vel[above * 3 + 1] = 0;
        }
      }
    }
    height[c] = h - 1;
    column[n] = -1;
    scheduleAround(c);
  }

  function nearestFree(x, z) {
    const c0 = cellAt(x, z);
    if (c0 >= 0 && blocked(c0) < 0 && height[c0] < MAXH) return c0;
    const i0 = Math.floor((x - originX) / cell);
    const j0 = Math.floor((z - originZ) / cell);
    for (let r = 1; r < 40; r += 1) {
      let best = -1;
      let bestD = Infinity;
      for (let dj = -r; dj <= r; dj += 1) {
        for (let di = -r; di <= r; di += 1) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const a = i0 + di;
          const b = j0 + dj;
          if (a < 0 || b < 0 || a >= gx || b >= gz) continue;
          const c = b * gx + a;
          if (blocked(c) >= 0 || height[c] >= MAXH) continue;
          const d = di * di + dj * dj + height[c] * 0.5;
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
      }
      if (best >= 0) return best;
    }
    return Math.max(0, c0);
  }

  function beginRest(n, kind, now) {
    state[n] = REST;
    anim[n] = kind;
    t0[n] = now;
    from[n * 3] = pos[n * 3];
    from[n * 3 + 1] = pos[n * 3 + 1];
    from[n * 3 + 2] = pos[n * 3 + 2];
    fromQ[n * 4] = quat[n * 4];
    fromQ[n * 4 + 1] = quat[n * 4 + 1];
    fromQ[n * 4 + 2] = quat[n * 4 + 2];
    fromQ[n * 4 + 3] = quat[n * 4 + 3];
  }

  function downhill(c0) {
    let c = c0;
    let steps = 0;
    while (steps < 40) {
      const nb = lowestNeighbour(c, 1);
      if (nb < 0) break;
      c = nb;
      steps += 1;
    }
    return [c, steps];
  }

  function land(n, now) {
    const [c, steps] = downhill(nearestFree(pos[n * 3], pos[n * 3 + 2]));
    push(n, c);
    travel[n] = steps;
    if (steps > 0) {
      const dx = cellX(c) - pos[n * 3];
      const dz = cellZ(c) - pos[n * 3 + 2];
      const ax = Math.abs(dx) > Math.abs(dz) ? 0 : 1;
      const sign = (ax === 0 ? dx : dz) < 0 ? -1 : 1;
      if (ax === 0) axisV.set(0, 0, -sign);
      else axisV.set(sign, 0, 0);
      qc.setFromAxisAngle(axisV, (Math.PI / 2) * Math.min(steps, 3));
      readQ(quat, n, qa);
      qa.premultiply(qc);
      writeQ(quat, n, qa);
      snap(n);
      readQ(quat, n, qa);
      qa.premultiply(qc.invert());
      writeQ(quat, n, qa);
    }
    momentum[n] = steps > 0 ? 0 : Math.hypot(vel[n * 3], vel[n * 3 + 2]);
    rollDir[n * 2] = vel[n * 3];
    rollDir[n * 2 + 1] = vel[n * 3 + 2];
    if (steps === 0) snap(n);
    beginRest(n, SETTLE, now);
  }

  function roll(n, c1, now) {
    const c0 = column[n];
    pull(n);
    push(n, c1);
    const dx = cellX(c1) - cellX(c0);
    const dz = cellZ(c1) - cellZ(c0);
    const l = Math.hypot(dx, dz) || 1;
    rollDir[n * 2] = dx / l;
    rollDir[n * 2 + 1] = dz / l;
    vel[n * 3] = 0;
    beginRest(n, ROLL, now);
  }

  function lowestNeighbour(c, bias) {
    const i = c % gx;
    const j = Math.floor(c / gx);
    const h = height[c];
    const base = bias + (rand() < 0.5 ? 1 : 0);
    let best = -1;
    let bestH = Infinity;
    let ties = 0;
    for (const [di, dj] of NEIGHBOURS) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= gx || b >= gz) continue;
      const nb = b * gx + a;
      if (blocked(nb) >= 0) continue;
      const nh = height[nb];
      const need = di !== 0 && dj !== 0 ? base + (rand() < 0.45 ? 1 : 0) : base;
      if (h - nh < need) continue;
      if (nh < bestH) {
        bestH = nh;
        best = nb;
        ties = 1;
      } else if (nh === bestH) {
        ties += 1;
        if (rand() * ties < 1) best = nb;
      }
    }
    return best;
  }

  function momentumNeighbour(c, dx, dz) {
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) return -1;
    const a = Math.round(dx / l + (rand() - 0.5) * 0.6);
    const b = Math.round(dz / l + (rand() - 0.5) * 0.6);
    if (a === 0 && b === 0) return -1;
    const i = (c % gx) + a;
    const j = Math.floor(c / gx) + b;
    if (i < 0 || j < 0 || i >= gx || j >= gz) return -1;
    const nb = j * gx + i;
    if (blocked(nb) >= 0) return -1;
    if (height[nb] > height[c] - 1) return -1;
    return nb;
  }

  function settled(n, now) {
    anim[n] = IDLE;
    const c = column[n];
    if (c < 0) return;
    const top = stack[c * MAXH + height[c] - 1] === n;
    if (top && momentum[n] > 1.1) {
      const nb = momentumNeighbour(c, rollDir[n * 2], rollDir[n * 2 + 1]);
      momentum[n] *= 0.5;
      if (nb >= 0) {
        roll(n, nb, now);
        return;
      }
    }
    momentum[n] = 0;
    schedule(c);
  }

  const tgt = [0, 0, 0];

  function animate(n, now, dt) {
    const k = anim[n];
    const o = n * 3;
    target(n, tgt);
    if (k === SETTLE) {
      const steps = travel[n];
      const u = Math.min(1, (now - t0[n]) / (settleTime + Math.min(0.5, steps * 0.075)));
      const e = steps ? u * (2 - u) : 1 - (1 - u) * (1 - u) * (1 - u);
      pos[o] = from[o] + (tgt[0] - from[o]) * e;
      pos[o + 1] = from[o + 1] + (tgt[1] - from[o + 1]) * e + Math.sin(Math.PI * u) * side * 0.35 * Math.min(steps, 2);
      pos[o + 2] = from[o + 2] + (tgt[2] - from[o + 2]) * e;
      readQ(fromQ, n, qa);
      readQ(rest, n, qb);
      qa.slerp(qb, e);
      writeQ(quat, n, qa);
      if (u >= 1) settled(n, now);
      return;
    }
    if (k === ROLL) {
      const t = now - t0[n];
      const dx = rollDir[n * 2];
      const dz = rollDir[n * 2 + 1];
      axisV.set(dz, 0, -dx);
      if (t < tipTime) {
        const u = t / tipTime;
        const ang = (Math.PI / 2) * u * u;
        const ex0 = from[o] + dx * side * 0.5;
        const ey0 = from[o + 1] - side * 0.5;
        const ez0 = from[o + 2] + dz * side * 0.5;
        va.set(from[o] - ex0, from[o + 1] - ey0, from[o + 2] - ez0).applyAxisAngle(axisV, ang);
        pos[o] = ex0 + va.x;
        pos[o + 1] = ey0 + va.y;
        pos[o + 2] = ez0 + va.z;
        qc.setFromAxisAngle(axisV, ang);
        readQ(fromQ, n, qa);
        qa.premultiply(qc);
        writeQ(quat, n, qa);
        return;
      }
      if (vel[o] !== 1) {
        vel[o] = 1;
        vel[o + 1] = 0;
        from[o] += dx * side;
        from[o + 2] += dz * side;
        qc.setFromAxisAngle(axisV, Math.PI / 2);
        readQ(fromQ, n, qa);
        qa.premultiply(qc);
        writeQ(fromQ, n, qa);
        writeQ(quat, n, qa);
        snap(n);
      }
      const tf = t - tipTime;
      const drop = 0.5 * gravity * tf * tf;
      const fallSpan = Math.max(0.0001, from[o + 1] - tgt[1]);
      const fallTime = Math.max(0.07, Math.sqrt((2 * fallSpan) / gravity));
      const u = Math.min(1, tf / fallTime);
      const e = u * (2 - u);
      pos[o] = from[o] + (tgt[0] - from[o]) * e;
      pos[o + 2] = from[o + 2] + (tgt[2] - from[o + 2]) * e;
      pos[o + 1] = Math.max(tgt[1], from[o + 1] - drop);
      readQ(fromQ, n, qa);
      readQ(rest, n, qb);
      qa.slerp(qb, e);
      writeQ(quat, n, qa);
      if (u >= 1 && pos[o + 1] <= tgt[1] + 1e-5) {
        vel[o] = 0;
        pos[o] = tgt[0];
        pos[o + 1] = tgt[1];
        pos[o + 2] = tgt[2];
        writeQ(quat, n, qb);
        settled(n, now);
      }
      return;
    }
    if (k === DROP) {
      vel[o + 1] -= gravity * dt;
      pos[o + 1] += vel[o + 1] * dt;
      pos[o] += (tgt[0] - pos[o]) * 0.3;
      pos[o + 2] += (tgt[2] - pos[o + 2]) * 0.3;
      if (pos[o + 1] <= tgt[1]) {
        pos[o] = tgt[0];
        pos[o + 1] = tgt[1];
        pos[o + 2] = tgt[2];
        vel[o + 1] = 0;
        settled(n, now);
      }
      return;
    }
    pos[o] = tgt[0];
    pos[o + 1] = tgt[1];
    pos[o + 2] = tgt[2];
    quat[n * 4] = rest[n * 4];
    quat[n * 4 + 1] = rest[n * 4 + 1];
    quat[n * 4 + 2] = rest[n * 4 + 2];
    quat[n * 4 + 3] = rest[n * 4 + 3];
  }

  function launch(n, x, y, z, vx, vy, vz, q, w) {
    if (state[n] === REST) pull(n);
    state[n] = FLY;
    anim[n] = IDLE;
    members.add(n);
    const o = n * 3;
    pos[o] = x;
    pos[o + 1] = y;
    pos[o + 2] = z;
    vel[o] = vx;
    vel[o + 1] = vy;
    vel[o + 2] = vz;
    spin[o] = w[0];
    spin[o + 1] = w[1];
    spin[o + 2] = w[2];
    quat[n * 4] = q[0];
    quat[n * 4 + 1] = q[1];
    quat[n * 4 + 2] = q[2];
    quat[n * 4 + 3] = q[3];
  }

  function take(n) {
    if (state[n] === REST) pull(n);
    state[n] = NONE;
    anim[n] = IDLE;
    members.delete(n);
  }

  function kick(n, now) {
    const o = n * 3;
    let rx = pos[o] - hand.x;
    let rz = pos[o + 2] - hand.z;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl;
    rz /= rl;
    const push = 0.45 + rand() * 0.6;
    const vx = hand.vx * (0.6 + rand() * 0.4) + rx * push;
    const vz = hand.vz * (0.6 + rand() * 0.4) + rz * push;
    const vy = 0.5 + rand() * 1.0 + Math.hypot(hand.vx, hand.vz) * 0.14;
    const s = 4 + rand() * 6;
    const hl = Math.hypot(vx, vz) || 1;
    const w = [(vz / hl) * s, (rand() - 0.5) * 3, (-vx / hl) * s];
    const q = [quat[n * 4], quat[n * 4 + 1], quat[n * 4 + 2], quat[n * 4 + 3]];
    launch(n, pos[o], pos[o + 1], pos[o + 2], vx, vy, vz, q, w);
    t0[n] = now;
  }

  function clearCell(c, now, awayX, awayZ) {
    while (height[c] > 0) {
      const n = stack[c * MAXH + height[c] - 1];
      const o = n * 3;
      const sx = hand.x;
      const sz = hand.z;
      const svx = hand.vx;
      const svz = hand.vz;
      hand.x = pos[o] - awayX;
      hand.z = pos[o + 2] - awayZ;
      hand.vx = awayX * 0.6;
      hand.vz = awayZ * 0.6;
      kick(n, now);
      hand.x = sx;
      hand.z = sz;
      hand.vx = svx;
      hand.vz = svz;
    }
  }

  function flyStep(n, now, h) {
    const o = n * 3;
    vel[o + 1] -= gravity * h;
    const ox = pos[o];
    const oz = pos[o + 2];
    pos[o] += vel[o] * h;
    pos[o + 1] += vel[o + 1] * h;
    pos[o + 2] += vel[o + 2] * h;
    if (hand.on) {
      const dx = pos[o] - hand.x;
      const dz = pos[o + 2] - hand.z;
      const d = Math.hypot(dx, dz);
      const reach = hand.r + side * 0.5;
      if (d < reach && d > 1e-5) {
        pos[o] = hand.x + (dx / d) * reach;
        pos[o + 2] = hand.z + (dz / d) * reach;
        vel[o] += (hand.vx - vel[o]) * 0.5;
        vel[o + 2] += (hand.vz - vel[o + 2]) * 0.5;
      }
    }
    if (pos[o] < bounds.minX || pos[o] > bounds.maxX) {
      pos[o] = Math.min(bounds.maxX, Math.max(bounds.minX, pos[o]));
      vel[o] *= -0.3;
    }
    if (pos[o + 2] < bounds.minZ || pos[o + 2] > bounds.maxZ) {
      pos[o + 2] = Math.min(bounds.maxZ, Math.max(bounds.minZ, pos[o + 2]));
      vel[o + 2] *= -0.3;
    }
    const c0 = cellAt(ox, oz);
    const c = cellAt(pos[o], pos[o + 2]);
    if (c < 0) {
      pos[o] = ox;
      pos[o + 2] = oz;
      vel[o] *= -0.3;
      vel[o + 2] *= -0.3;
      return;
    }
    const bottom = pos[o + 1] - side * 0.5;
    if (c !== c0 && c0 >= 0 && blocked(c) < 0 && topOf(c) > bottom + side * 0.55) {
      const ci = c % gx;
      const c0i = c0 % gx;
      if (ci !== c0i) {
        pos[o] = ox;
        vel[o] *= -0.25;
      }
      if (Math.floor(c / gx) !== Math.floor(c0 / gx)) {
        pos[o + 2] = oz;
        vel[o + 2] *= -0.25;
      }
      return;
    }
    const top = topOf(c);
    if (bottom <= top && vel[o + 1] <= 0) land(n, now);
  }

  function spinStep(n, dt) {
    const o = n * 3;
    const wx = spin[o];
    const wy = spin[o + 1];
    const wz = spin[o + 2];
    const wl = Math.hypot(wx, wy, wz);
    if (wl < 1e-5) return;
    axisV.set(wx / wl, wy / wl, wz / wl);
    qc.setFromAxisAngle(axisV, wl * dt);
    readQ(quat, n, qa);
    qa.premultiply(qc);
    writeQ(quat, n, qa);
  }

  function handStep(now) {
    if (!hand.on) return;
    const r = hand.r + cell * 0.5;
    const i0 = Math.floor((hand.x - r - originX) / cell);
    const i1 = Math.floor((hand.x + r - originX) / cell);
    const j0 = Math.floor((hand.z - r - originZ) / cell);
    const j1 = Math.floor((hand.z + r - originZ) / cell);
    for (let j = Math.max(0, j0); j <= Math.min(gz - 1, j1); j += 1) {
      for (let i = Math.max(0, i0); i <= Math.min(gx - 1, i1); i += 1) {
        const c = j * gx + i;
        if (!height[c]) continue;
        if (Math.hypot(cellX(c) - hand.x, cellZ(c) - hand.z) > r) continue;
        while (height[c] > 0) kick(stack[c * MAXH + height[c] - 1], now);
      }
    }
  }

  function step(now, dt) {
    handStep(now);
    let busy = hand.on;
    const sub = 2;
    const h = dt / sub;
    for (const n of members) {
      if (state[n] === FLY) {
        busy = true;
        for (let s = 0; s < sub && state[n] === FLY; s += 1) flyStep(n, now, h);
        if (state[n] === FLY) spinStep(n, dt);
      } else if (state[n] === REST && anim[n] !== IDLE) {
        busy = true;
        animate(n, now, dt);
      }
    }
    if (queue.length) {
      const list = queue;
      queue = [];
      for (const c of list) {
        queued[c] = 0;
        const hc = height[c];
        if (!hc) continue;
        const n = stack[c * MAXH + hc - 1];
        if (anim[n] !== IDLE) continue;
        const nb = lowestNeighbour(c, 2);
        if (nb >= 0) {
          roll(n, nb, now);
          busy = true;
        }
      }
    }
    if (queue.length) busy = true;
    return busy;
  }

  function settleAll(now) {
    for (const n of members) if (state[n] === REST && anim[n] === IDLE) animate(n, now, 0);
  }

  function levelOf(n) {
    const c = column[n];
    if (c < 0) return 0;
    for (let k = 0; k < height[c]; k += 1) if (stack[c * MAXH + k] === n) return k;
    return 0;
  }

  return {
    pos,
    quat,
    state,
    hand,
    bounds,
    members,
    launch,
    take,
    step,
    settleAll,
    levelOf,
    cellAt,
    clearCell,
    get size() {
      return members.size;
    },
  };
}
