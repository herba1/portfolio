const SEPARATION = 10;
const ALIGNMENT = 16;
const COHESION = 20;
const ZONE = SEPARATION + ALIGNMENT + COHESION;
const ZONE_SQ = ZONE * ZONE;
const SEP_THRESH = SEPARATION / ZONE;
const ALIGN_THRESH = (SEPARATION + ALIGNMENT) / ZONE;
const TAU = Math.PI * 2;
const SPEED_LIMIT = 9;
const ALIGN_GAIN = 4;
const COHESION_GAIN = 2;
const PULL = 0.6;
const STEER = 5;
const CRUISE = 7;
const MIN_SPEED = 4.5;
const FLEE_BONUS = 5;
const PREY_RADIUS = 150;
const PREY_RADIUS_SQ = PREY_RADIUS * PREY_RADIUS;
const PANIC_RADIUS = PREY_RADIUS * 1.25;
const NEIGHBOUR_CAP = 14;
const CELL = ZONE;
const OFFSETS = new Int8Array(81);
{
  let n = 3;
  for (let x = -1; x <= 1; x += 1) {
    for (let y = -1; y <= 1; y += 1) {
      for (let z = -1; z <= 1; z += 1) {
        if (x === 0 && y === 0 && z === 0) continue;
        OFFSETS[n] = x;
        OFFSETS[n + 1] = y;
        OFFSETS[n + 2] = z;
        n += 3;
      }
    }
  }
}

const ALIGN_CURVE = new Float32Array(65);
const COHESION_CURVE = new Float32Array(65);
for (let i = 0; i <= 64; i += 1) {
  const t = i / 64;
  ALIGN_CURVE[i] = 0.5 - Math.cos(t * TAU) * 0.5 + 0.5;
  COHESION_CURVE[i] = 0.5 - (Math.cos(t * TAU) * -0.5 + 0.5);
}

const curve = (table, t) => {
  const x = Math.min(64, Math.max(0, t * 64));
  const i = Math.floor(x);
  const f = x - i;
  return i >= 64 ? table[64] : table[i] + (table[i + 1] - table[i]) * f;
};

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

export function createFlock(count, seed = 7) {
  const rand = mulberry(seed);
  const px = new Float32Array(count);
  const py = new Float32Array(count);
  const pz = new Float32Array(count);
  const vx = new Float32Array(count);
  const vy = new Float32Array(count);
  const vz = new Float32Array(count);
  const phase = new Float32Array(count);
  const panic = new Float32Array(count);
  const bank = new Float32Array(count);
  const next = new Int32Array(count);
  const nextPanic = new Float32Array(count);
  const TABLE = 8192;
  const heads = new Int32Array(TABLE);

  for (let i = 0; i < count; i += 1) {
    const a = rand() * TAU;
    const r = Math.sqrt(rand());
    const x = Math.cos(a) * r * 200;
    const z = Math.sin(a) * r * 110;
    px[i] = x;
    py[i] = (rand() - 0.5) * 70 * (1 - r * 0.5);
    pz[i] = z;
    const swirl = Math.atan2(z, x) + Math.PI / 2;
    const h = swirl * 0.35 + 0.2 + (rand() - 0.5) * 0.3;
    vx[i] = Math.cos(h) * 6.5;
    vy[i] = (rand() - 0.5) * 0.6;
    vz[i] = Math.sin(h) * 6.5;
    phase[i] = rand() * 62.83;
  }

  const centre = { x: 0, y: 0, z: 0, t: 0, wave: 40, ySquash: 1.4, reach: 200 };
  const hawk = { x: 0, y: 0, active: 0 };

  const keyOf = (cx, cy, cz) => ((Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ Math.imul(cz, 83492791)) >>> 0) & (TABLE - 1);

  const rebuild = () => {
    heads.fill(-1);
    for (let i = 0; i < count; i += 1) {
      const key = keyOf(Math.floor(px[i] / CELL), Math.floor(py[i] / CELL), Math.floor(pz[i] / CELL));
      next[i] = heads[key];
      heads[key] = i;
    }
  };

  const step = (dt) => {
    const delta = Math.min(dt, 1 / 30);
    rebuild();
    const hawkOn = hawk.active > 0.02;
    const panicDecay = Math.exp(-delta * 1.4);
    const panicCharge = 1 - Math.exp(-delta * 9);

    let meanX = 0;
    let meanY = 0;
    let meanZ = 0;
    for (let i = 0; i < count; i += 1) {
      meanX += px[i];
      meanY += py[i];
      meanZ += pz[i];
    }
    meanX /= count;
    meanY /= count;
    meanZ /= count;
    let tx = centre.x - meanX;
    let ty = (centre.y - meanY) * 2;
    let tz = (centre.z - meanZ) * 1.8;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    const steerGain = delta * STEER * Math.min(2.2, tl / 140);
    const steerX = (tx / tl) * steerGain;
    const steerY = (ty / tl) * steerGain;
    const steerZ = (tz / tl) * steerGain;
    for (let i = 0; i < count; i += 1) {
      const sx = px[i];
      const sy = py[i];
      const sz = pz[i];
      let nx = vx[i];
      let ny = vy[i];
      let nz = vz[i];
      let limit = SPEED_LIMIT;
      let fear = panic[i] * panicDecay;

      if (hawkOn) {
        const dx = hawk.x - sx;
        const dy = hawk.y - sy;
        const d2 = dx * dx + dy * dy;
        if (d2 < PREY_RADIUS_SQ) {
          const d = Math.sqrt(d2) || 1;
          const f = (d2 / PREY_RADIUS_SQ - 1) * delta * 100 * hawk.active;
          nx += (dx / d) * f;
          ny += (dy / d) * f;
          limit += FLEE_BONUS;
        }
        if (d2 < PANIC_RADIUS * PANIC_RADIUS) fear = Math.max(fear, hawk.active * (1 - Math.sqrt(d2) / PANIC_RADIUS) * 1.4);
      }

      let cx = sx - meanX;
      let cy = (sy - meanY - Math.sin(sx * 0.011 + centre.t * 0.6) * centre.wave - Math.sin(sz * 0.013 - centre.t * 0.4) * centre.wave * 0.6) * centre.ySquash;
      let cz = (sz - meanZ) * 1.6;
      const cl = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
      const pull = delta * (PULL + Math.max(0, cl - centre.reach) * 0.06);
      nx -= (cx / cl) * pull - steerX;
      ny -= (cy / cl) * pull - steerY;
      nz -= (cz / cl) * pull - steerZ;

      const gx = Math.floor(sx / CELL);
      const gy = Math.floor(sy / CELL);
      const gz = Math.floor(sz / CELL);
      let seen = 0;
      let neighbourFear = 0;
      for (let c = 0; c < 27 && seen < NEIGHBOUR_CAP; c += 1) {
        const o = c === 0 ? 0 : 1 + ((c - 1 + i) % 26);
        let j = heads[keyOf(gx + OFFSETS[o * 3], gy + OFFSETS[o * 3 + 1], gz + OFFSETS[o * 3 + 2])];
        while (j !== -1 && seen < NEIGHBOUR_CAP) {
          if (j !== i) {
            const dx = px[j] - sx;
            const dy = py[j] - sy;
            const dz = pz[j] - sz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < ZONE_SQ && d2 > 0.0001) {
              seen += 1;
              const percent = d2 / ZONE_SQ;
              const d = Math.sqrt(d2);
              if (percent < SEP_THRESH) {
                const f = (SEP_THRESH / percent - 1) * delta;
                nx -= (dx / d) * f;
                ny -= (dy / d) * f;
                nz -= (dz / d) * f;
              } else if (percent < ALIGN_THRESH) {
                const f = curve(ALIGN_CURVE, (percent - SEP_THRESH) / (ALIGN_THRESH - SEP_THRESH)) * delta * ALIGN_GAIN;
                const bx = vx[j];
                const by = vy[j];
                const bz = vz[j];
                const bl = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
                nx += (bx / bl) * f;
                ny += (by / bl) * f;
                nz += (bz / bl) * f;
              } else {
                const f = curve(COHESION_CURVE, (percent - ALIGN_THRESH) / (1 - ALIGN_THRESH)) * delta * COHESION_GAIN;
                nx += (dx / d) * f;
                ny += (dy / d) * f;
                nz += (dz / d) * f;
              }
              if (panic[j] > neighbourFear) neighbourFear = panic[j];
            }
          }
          j = next[j];
        }
      }

      const relay = neighbourFear * 0.84;
      if (relay > fear) fear += (relay - fear) * panicCharge;
      nextPanic[i] = Math.min(1, fear);

      if (fear > 0.05) {
        const ax = sx - hawk.x;
        const ay = sy - hawk.y;
        const al = Math.sqrt(ax * ax + ay * ay) || 1;
        const push = fear * delta * 8;
        nx += (ax / al) * push;
        ny += (ay / al) * push - fear * delta * 6;
      }

      let speed = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const cruise = CRUISE + fear * 3;
      const want = Math.min(limit, speed + (cruise - speed) * (1 - Math.exp(-delta * 1.5)));
      {
        const k = Math.max(MIN_SPEED, want) / speed;
        nx *= k;
        ny *= k;
        nz *= k;
        speed = Math.max(MIN_SPEED, want);
      }

      const turn = (vx[i] * nz - vz[i] * nx) / (speed * speed + 1);
      bank[i] += (Math.max(-1, Math.min(1, turn * 40)) - bank[i]) * (1 - Math.exp(-delta * 8));

      vx[i] = nx;
      vy[i] = ny;
      vz[i] = nz;
    }

    for (let i = 0; i < count; i += 1) {
      panic[i] = nextPanic[i];
      px[i] += vx[i] * delta * 15;
      py[i] += vy[i] * delta * 15;
      pz[i] += vz[i] * delta * 15;
      const hv = Math.sqrt(vx[i] * vx[i] + vz[i] * vz[i]);
      phase[i] = (phase[i] + delta + hv * delta * 3 + Math.max(vy[i], 0) * delta * 6 + panic[i] * delta * 10) % 62.83;
    }
  };

  return { count, px, py, pz, vx, vy, vz, phase, panic, bank, centre, hawk, step };
}
