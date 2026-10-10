import {
  CONFINE_INK_GAIN,
  CORE_DYE_FROM,
  CORE_DYE_RAMP,
  CORE_FLOOR_CURL,
  CORE_SHARE,
  CORE_SPAN,
  CORE_SPEED_FROM,
  CORE_SPEED_RAMP,
  CORE_SPIN_SPAN,
  CORE_TAU,
  DYE_ACROSS_SHARE,
  DYE_DIFFUSION,
  DYE_MOVING_SPEED,
  LANE_FEEL_SPEED,
  LANE_YIELD_SPEED,
  ORIENT_TAU,
  PRESSURE_CARRY,
  STROKE_SWAP_SECONDS,
  TURN_HOLD,
} from "./stirParams";

const QUARTER_TURN = Math.PI / 2;
const HALF_TURN = Math.PI;
const FULL_TURN = Math.PI * 2;
const TURN_SWITCH = QUARTER_TURN / 2 + TURN_HOLD;
const SWAP_CEILING = 0.98;

function ramp(t) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

function inflow(x, lastCol) {
  if (x < 0) return x > -1 ? 1 + x : 0;
  if (x > lastCol) return x < lastCol + 1 ? 1 - (x - lastCol) : 0;
  return 1;
}

export function createFluid(cols, rows, cellW, cellH, lanes) {
  const count = cols * rows;
  const lastCol = cols - 1;
  const lastRow = rows - 1;
  let u = new Float32Array(count);
  let v = new Float32Array(count);
  let uNext = new Float32Array(count);
  let vNext = new Float32Array(count);
  let dye = new Float32Array(count);
  let dyeNext = new Float32Array(count);
  const uHat = new Float32Array(count);
  const vHat = new Float32Array(count);
  const dyeHat = new Float32Array(count);
  let pressure = new Float32Array(count);
  let pressureNext = new Float32Array(count);
  const divergence = new Float32Array(count);
  const curl = new Float32Array(count);
  const kickU = new Float32Array(count);
  const kickV = new Float32Array(count);
  let kicked = false;
  let stain = new Float32Array(count);
  let stainNext = new Float32Array(count);
  let tintR = new Float32Array(count);
  let tintG = new Float32Array(count);
  let tintB = new Float32Array(count);
  let tintRNext = new Float32Array(count);
  let tintGNext = new Float32Array(count);
  let tintBNext = new Float32Array(count);
  let stained = false;
  const core = new Float32Array(count);
  const orientC = new Float32Array(count);
  const orientS = new Float32Array(count);
  const turn = new Uint8Array(count);
  const previousTurn = new Uint8Array(count);
  const swapLeft = new Float32Array(count);
  let curlPeak = 0;
  let curlFresh = false;
  const driftU = new Float32Array(count);
  const rowWeight = new Float32Array(rows);
  const rowFlow = new Float32Array(rows);
  const fieldPack = new Float32Array(count * 4);
  const tintPack = new Float32Array(count * 4);
  const inverseX = 1 / (cellW * cellW);
  const inverseY = 1 / (cellH * cellH);
  const jacobiScale = 1 / (2 * inverseX + 2 * inverseY);
  const halfInvW = 0.5 / cellW;
  const halfInvH = 0.5 / cellH;

  const state = {
    cols,
    rows,
    cellW,
    cellH,
    maxDye: 0,
    maxSpeed: 0,
    maxStain: 0,
    maxCore: 0,
    idle: true,
    rowWeight,
    rowFlow,
    fieldPack,
    tintPack,
  };

  function sample(field, x, y) {
    const cx = x < 0 ? 0 : x > lastCol ? lastCol : x;
    const cy = y < 0 ? 0 : y > lastRow ? lastRow : y;
    const i0 = cx | 0;
    const j0 = cy | 0;
    const i1 = i0 < lastCol ? i0 + 1 : i0;
    const j1 = j0 < lastRow ? j0 + 1 : j0;
    const fx = cx - i0;
    const fy = cy - j0;
    const top = j0 * cols;
    const bottom = j1 * cols;
    const upper = field[top + i0] + (field[top + i1] - field[top + i0]) * fx;
    const lower = field[bottom + i0] + (field[bottom + i1] - field[bottom + i0]) * fx;
    return upper + (lower - upper) * fy;
  }

  function limit(field, x, y, value) {
    const cx = x < 0 ? 0 : x > lastCol ? lastCol : x;
    const cy = y < 0 ? 0 : y > lastRow ? lastRow : y;
    const i0 = cx | 0;
    const j0 = cy | 0;
    const i1 = i0 < lastCol ? i0 + 1 : i0;
    const j1 = j0 < lastRow ? j0 + 1 : j0;
    const a = field[j0 * cols + i0];
    const b = field[j0 * cols + i1];
    const c = field[j1 * cols + i0];
    const d = field[j1 * cols + i1];
    let low = a < b ? a : b;
    let high = a < b ? b : a;
    if (c < low) low = c;
    if (c > high) high = c;
    if (d < low) low = d;
    if (d > high) high = d;
    return value < low ? low : value > high ? high : value;
  }

  function splat(px, py, vx, vy, grip, dyeAmount, dyeCap, radius, reach, dyeRadius = radius, tint = null) {
    const centreI = px / cellW - 0.5;
    const centreJ = py / cellH - 0.5;
    const spanI = Math.ceil((radius * reach) / cellW);
    const spanJ = Math.ceil((radius * reach) / cellH);
    const iStart = Math.max(0, Math.floor(centreI - spanI));
    const iEnd = Math.min(lastCol, Math.ceil(centreI + spanI));
    const jStart = Math.max(0, Math.floor(centreJ - spanJ));
    const jEnd = Math.min(lastRow, Math.ceil(centreJ + spanJ));
    if (iStart > iEnd || jStart > jEnd) return;
    if (grip > 0 || dyeAmount > 0) state.idle = false;
    const inverseRadius = 1 / (radius * radius);
    const inverseDyeRadius = 1 / (dyeRadius * dyeRadius);
    const sharedFalloff = dyeRadius === radius;
    for (let j = jStart; j <= jEnd; j += 1) {
      const dy = (j - centreJ) * cellH;
      const dy2 = dy * dy;
      const row = j * cols;
      for (let i = iStart; i <= iEnd; i += 1) {
        const dx = (i - centreI) * cellW;
        const squared = dx * dx + dy2;
        const falloff = Math.exp(-squared * inverseRadius);
        if (falloff < 0.01) continue;
        const k = row + i;
        if (grip > 0) {
          const pull = grip * falloff;
          u[k] += (vx - u[k]) * pull;
          v[k] += (vy - v[k]) * pull;
        }
        if (dyeAmount <= 0) continue;
        const dyeFalloff = sharedFalloff ? falloff : Math.exp(-squared * inverseDyeRadius);
        const take = Math.min(1, dyeAmount * dyeFalloff);
        if (dye[k] < dyeCap) dye[k] += (dyeCap - dye[k]) * take;
        if (!tint) continue;
        const before = stain[k];
        const after = before + ((before > dyeCap ? before : dyeCap) - before) * take;
        const held = 1 - take;
        const fresh = after - before * held;
        tintR[k] = tintR[k] * held + tint[0] * fresh;
        tintG[k] = tintG[k] * held + tint[1] * fresh;
        tintB[k] = tintB[k] * held + tint[2] * fresh;
        stain[k] = after;
        stained = true;
      }
    }
  }

  function impulse(px, py, strength, width, front, reach) {
    const centreI = px / cellW - 0.5;
    const centreJ = py / cellH - 0.5;
    const outer = front + width * reach;
    const inner = front - width * reach;
    const innerSquared = inner > 0 ? inner * inner : -1;
    const iStart = Math.max(0, Math.floor(centreI - outer / cellW));
    const iEnd = Math.min(lastCol, Math.ceil(centreI + outer / cellW));
    const jStart = Math.max(0, Math.floor(centreJ - outer / cellH));
    const jEnd = Math.min(lastRow, Math.ceil(centreJ + outer / cellH));
    if (iStart > iEnd || jStart > jEnd || strength <= 0) return;
    const inverseWidth = 1 / width;
    for (let j = jStart; j <= jEnd; j += 1) {
      const dy = (j - centreJ) * cellH;
      const dy2 = dy * dy;
      const row = j * cols;
      for (let i = iStart; i <= iEnd; i += 1) {
        const dx = (i - centreI) * cellW;
        const squared = dx * dx + dy2;
        if (squared < innerSquared || squared < 1e-4) continue;
        const distance = Math.sqrt(squared);
        const band = (distance - front) * inverseWidth;
        const falloff = Math.exp(-band * band);
        if (falloff < 0.01) continue;
        const scale = (strength * falloff) / distance;
        const k = row + i;
        kickU[k] += dx * scale;
        kickV[k] += dy * scale;
      }
    }
    kicked = true;
    state.idle = false;
  }

  function applyKicks() {
    if (!kicked) return;
    for (let k = 0; k < count; k += 1) {
      u[k] += kickU[k];
      v[k] += kickV[k];
    }
    kickU.fill(0);
    kickV.fill(0);
    kicked = false;
  }

  function measureCurl() {
    let peak = 0;
    for (let j = 0; j < rows; j += 1) {
      const row = j * cols;
      for (let i = 0; i < cols; i += 1) {
        const k = row + i;
        const left = i > 0 ? k - 1 : k;
        const right = i < lastCol ? k + 1 : k;
        const up = j > 0 ? k - cols : k;
        const down = j < lastRow ? k + cols : k;
        const spin = (v[right] - v[left]) * halfInvW - (u[down] - u[up]) * halfInvH;
        curl[k] = spin;
        const magnitude = spin < 0 ? -spin : spin;
        if (dye[k] > CORE_DYE_FROM && magnitude > peak) peak = magnitude;
      }
    }
    curlPeak = peak;
  }

  function confine(dt, strength) {
    measureCurl();
    const push = dt * strength;
    for (let j = 1; j < lastRow; j += 1) {
      const row = j * cols;
      for (let i = 1; i < lastCol; i += 1) {
        const k = row + i;
        const gradX = (Math.abs(curl[k + 1]) - Math.abs(curl[k - 1])) * halfInvW;
        const gradY = (Math.abs(curl[k + cols]) - Math.abs(curl[k - cols])) * halfInvH;
        const held = dye[k] * CONFINE_INK_GAIN;
        if (held <= 0) continue;
        const length = Math.sqrt(gradX * gradX + gradY * gradY) + 1e-5;
        const spin = curl[k] * (held < 1 ? held : 1);
        u[k] += push * (gradY / length) * spin;
        v[k] -= push * (gradX / length) * spin;
      }
    }
  }

  function advectVelocity(dt, keep) {
    const stepX = dt / cellW;
    const stepY = dt / cellH;
    for (let j = 0; j < rows; j += 1) {
      const row = j * cols;
      for (let i = 0; i < cols; i += 1) {
        const k = row + i;
        const x = i - u[k] * stepX;
        const y = j - v[k] * stepY;
        uHat[k] = sample(u, x, y);
        vHat[k] = sample(v, x, y);
      }
    }
    for (let j = 0; j < rows; j += 1) {
      const row = j * cols;
      for (let i = 0; i < cols; i += 1) {
        const k = row + i;
        const driftX = u[k] * stepX;
        const driftY = v[k] * stepY;
        const backX = i + driftX;
        const backY = j + driftY;
        const x = i - driftX;
        const y = j - driftY;
        uNext[k] = limit(u, x, y, uHat[k] + 0.5 * (u[k] - sample(uHat, backX, backY))) * keep;
        vNext[k] = limit(v, x, y, vHat[k] + 0.5 * (v[k] - sample(vHat, backX, backY))) * keep;
      }
    }
    let swap = u;
    u = uNext;
    uNext = swap;
    swap = v;
    v = vNext;
    vNext = swap;
  }

  function project(iterations) {
    for (let j = 0; j < rows; j += 1) {
      const row = j * cols;
      for (let i = 0; i < cols; i += 1) {
        const k = row + i;
        const uLeft = i > 0 ? u[k - 1] : -u[k];
        const uRight = i < lastCol ? u[k + 1] : -u[k];
        const vUp = j > 0 ? v[k - cols] : -v[k];
        const vDown = j < lastRow ? v[k + cols] : -v[k];
        divergence[k] = (uRight - uLeft) * halfInvW + (vDown - vUp) * halfInvH;
        pressure[k] *= PRESSURE_CARRY;
      }
    }
    for (let pass = 0; pass < iterations; pass += 1) {
      for (let j = 0; j < rows; j += 1) {
        const row = j * cols;
        for (let i = 0; i < cols; i += 1) {
          const k = row + i;
          const centre = pressure[k];
          const pLeft = i > 0 ? pressure[k - 1] : centre;
          const pRight = i < lastCol ? pressure[k + 1] : centre;
          const pUp = j > 0 ? pressure[k - cols] : centre;
          const pDown = j < lastRow ? pressure[k + cols] : centre;
          pressureNext[k] = (inverseX * (pLeft + pRight) + inverseY * (pUp + pDown) - divergence[k]) * jacobiScale;
        }
      }
      const swap = pressure;
      pressure = pressureNext;
      pressureNext = swap;
    }
  }

  function subtractGradient(maxSpeed) {
    const limit = maxSpeed * maxSpeed;
    let fastest = 0;
    for (let j = 0; j < rows; j += 1) {
      const row = j * cols;
      for (let i = 0; i < cols; i += 1) {
        const k = row + i;
        const centre = pressure[k];
        const pLeft = i > 0 ? pressure[k - 1] : centre;
        const pRight = i < lastCol ? pressure[k + 1] : centre;
        const pUp = j > 0 ? pressure[k - cols] : centre;
        const pDown = j < lastRow ? pressure[k + cols] : centre;
        let x = u[k] - (pRight - pLeft) * halfInvW;
        let y = v[k] - (pDown - pUp) * halfInvH;
        if (i === 0 || i === lastCol) x = 0;
        if (j === 0 || j === lastRow) y = 0;
        let speed = x * x + y * y;
        if (speed > limit) {
          const scale = maxSpeed / Math.sqrt(speed);
          x *= scale;
          y *= scale;
          speed = limit;
        }
        if (speed > fastest) fastest = speed;
        u[k] = x;
        v[k] = y;
      }
    }
    state.maxSpeed = Math.sqrt(fastest);
  }

  function measureDrift() {
    const yieldSquared = LANE_YIELD_SPEED * LANE_YIELD_SPEED;
    for (let j = 0; j < rows; j += 1) {
      const row = j * cols;
      const lane = lanes[j];
      for (let i = 0; i < cols; i += 1) {
        const k = row + i;
        const flowX = u[k];
        const flowY = v[k];
        driftU[k] = lane === 0 ? flowX : flowX + (lane * yieldSquared) / (yieldSquared + flowX * flowX + flowY * flowY);
      }
    }
  }

  function measureRows() {
    const inverseFeel = 1 / (LANE_FEEL_SPEED * LANE_FEEL_SPEED);
    for (let j = 0; j < rows; j += 1) {
      const row = j * cols;
      let weight = 0;
      let flow = 0;
      for (let i = 0; i < cols; i += 1) {
        const flowX = u[row + i];
        const felt = flowX * flowX * inverseFeel;
        const squared = felt * felt;
        const share = squared / (squared + 1);
        weight += share;
        flow += share * flowX;
      }
      rowWeight[j] = weight;
      rowFlow[j] = weight > 1e-4 ? flow / weight : 0;
    }
  }

  function advectDye(dt, dyeTau, stillShare, diffusion) {
    const stepX = dt / cellW;
    const stepY = dt / cellH;
    const spread = Math.min(1, diffusion * dt);
    const movingShare = 1 - stillShare;
    const inverseMoving = 1 / DYE_MOVING_SPEED;
    const inverseTau = dt / dyeTau;
    let densest = 0;
    for (let j = 0; j < rows; j += 1) {
      const row = j * cols;
      for (let i = 0; i < cols; i += 1) {
        const k = row + i;
        const x = i - driftU[k] * stepX;
        dyeHat[k] = sample(dye, x, j - v[k] * stepY) * inflow(x, lastCol);
      }
    }
    for (let j = 0; j < rows; j += 1) {
      const row = j * cols;
      for (let i = 0; i < cols; i += 1) {
        const k = row + i;
        const centre = dye[k];
        const flowX = u[k];
        const flowY = v[k];
        const driftX = driftU[k] * stepX;
        const driftY = flowY * stepY;
        const back = sample(dyeHat, i + driftX, j + driftY);
        const sourceX = i - driftX;
        const carried = limit(dye, sourceX, j - driftY, dyeHat[k] + 0.5 * (centre - back)) * inflow(sourceX, lastCol);
        const left = i > 0 ? dye[k - 1] : centre;
        const right = i < lastCol ? dye[k + 1] : centre;
        const up = j > 0 ? dye[k - cols] : centre;
        const down = j < lastRow ? dye[k + cols] : centre;
        const motion = Math.sqrt(flowX * flowX + flowY * flowY) * inverseMoving;
        const keep = Math.exp(-inverseTau / (stillShare + movingShare * (motion < 1 ? motion : 1)));
        const settled = (carried + (left + right - 2 * centre + (up + down - 2 * centre) * DYE_ACROSS_SHARE) * 0.25 * spread) * keep;
        const value = settled > 0 ? settled : 0;
        dyeNext[k] = value;
        if (value > densest) densest = value;
      }
    }
    const swap = dye;
    dye = dyeNext;
    dyeNext = swap;
    state.maxDye = densest;
  }

  function advectStain(dt, stainTau) {
    if (!stained && state.maxStain <= 0) return;
    const stepX = dt / cellW;
    const stepY = dt / cellH;
    const keep = Math.exp(-dt / stainTau);
    let densest = 0;
    for (let j = 0; j < rows; j += 1) {
      const row = j * cols;
      for (let i = 0; i < cols; i += 1) {
        const k = row + i;
        const x = i - driftU[k] * stepX;
        const y = j - v[k] * stepY;
        const fresh = keep * inflow(x, lastCol);
        const cx = x < 0 ? 0 : x > lastCol ? lastCol : x;
        const cy = y < 0 ? 0 : y > lastRow ? lastRow : y;
        const i0 = cx | 0;
        const j0 = cy | 0;
        const i1 = i0 < lastCol ? i0 + 1 : i0;
        const j1 = j0 < lastRow ? j0 + 1 : j0;
        const fx = cx - i0;
        const fy = cy - j0;
        const a = j0 * cols + i0;
        const b = j0 * cols + i1;
        const c = j1 * cols + i0;
        const d = j1 * cols + i1;
        const wa = (1 - fx) * (1 - fy) * fresh;
        const wb = fx * (1 - fy) * fresh;
        const wc = (1 - fx) * fy * fresh;
        const wd = fx * fy * fresh;
        const value = stain[a] * wa + stain[b] * wb + stain[c] * wc + stain[d] * wd;
        stainNext[k] = value;
        tintRNext[k] = tintR[a] * wa + tintR[b] * wb + tintR[c] * wc + tintR[d] * wd;
        tintGNext[k] = tintG[a] * wa + tintG[b] * wb + tintG[c] * wc + tintG[d] * wd;
        tintBNext[k] = tintB[a] * wa + tintB[b] * wb + tintB[c] * wc + tintB[d] * wd;
        if (value > densest) densest = value;
      }
    }
    let swap = stain;
    stain = stainNext;
    stainNext = swap;
    swap = tintR;
    tintR = tintRNext;
    tintRNext = swap;
    swap = tintG;
    tintG = tintGNext;
    tintGNext = swap;
    swap = tintB;
    tintB = tintBNext;
    tintBNext = swap;
    stained = false;
    state.maxStain = densest;
  }

  function rotationShare(k, i, j) {
    const left = i > 0 ? k - 1 : k;
    const right = i < lastCol ? k + 1 : k;
    const up = j > 0 ? k - cols : k;
    const down = j < lastRow ? k + cols : k;
    const dudx = (u[right] - u[left]) * halfInvW;
    const dvdy = (v[down] - v[up]) * halfInvH;
    const dvdx = (v[right] - v[left]) * halfInvW;
    const dudy = (u[down] - u[up]) * halfInvH;
    const stretch = dudx - dvdy;
    const shear = dvdx + dudy;
    const spin = dvdx - dudy;
    const spinSquared = spin * spin;
    if (spinSquared < 1e-6) return 0;
    return 1 - (stretch * stretch + shear * shear) / spinSquared;
  }

  function settleTurn(k, fresh) {
    const angle = Math.atan2(orientS[k], orientC[k]);
    const nearest = ((Math.round(angle / QUARTER_TURN) % 4) + 4) % 4;
    if (fresh) {
      turn[k] = nearest;
      swapLeft[k] = 0;
      return;
    }
    let drift = angle - turn[k] * QUARTER_TURN;
    drift -= FULL_TURN * Math.floor((drift + HALF_TURN) / FULL_TURN);
    if ((drift < 0 ? -drift : drift) <= TURN_SWITCH || nearest === turn[k]) return;
    previousTurn[k] = turn[k];
    turn[k] = nearest;
    swapLeft[k] = SWAP_CEILING;
  }

  function quietCores() {
    if (state.maxCore <= 0) return;
    core.fill(0);
    swapLeft.fill(0);
    state.maxCore = 0;
  }

  function structure(dt, enabled) {
    if (!enabled || (state.maxSpeed < CORE_SPEED_FROM && state.maxCore <= 0)) {
      quietCores();
      return;
    }
    if (!curlFresh) measureCurl();
    const peakCurl = curlPeak;
    const threshold = Math.max(CORE_FLOOR_CURL, peakCurl * CORE_SHARE);
    const inverseSpan = 1 / Math.max(1e-3, peakCurl * CORE_SPAN);
    const rise = 1 - Math.exp(-dt / CORE_TAU);
    const steer = 1 - Math.exp(-dt / ORIENT_TAU);
    const swapFade = dt / STROKE_SWAP_SECONDS;
    const live = peakCurl > CORE_FLOOR_CURL;
    let strongest = 0;
    for (let j = 0; j < rows; j += 1) {
      const row = j * cols;
      for (let i = 0; i < cols; i += 1) {
        const k = row + i;
        const flowX = u[k];
        const flowY = v[k];
        const speedSquared = flowX * flowX + flowY * flowY;
        let target = 0;
        if (live) {
          const spin = curl[k];
          const magnitude = spin < 0 ? -spin : spin;
          if (magnitude > threshold && dye[k] > CORE_DYE_FROM) {
            const rotation = rotationShare(k, i, j);
            if (rotation > 0) {
              const speed = Math.sqrt(speedSquared);
              target =
                ramp((magnitude - threshold) * inverseSpan) *
                ramp(rotation / CORE_SPIN_SPAN) *
                ramp((dye[k] - CORE_DYE_FROM) / CORE_DYE_RAMP) *
                ramp((speed - CORE_SPEED_FROM) / CORE_SPEED_RAMP);
            }
          }
        }
        const before = core[k];
        const next = before + (target - before) * rise;
        core[k] = next < 1e-3 ? 0 : next;
        if (swapLeft[k] > 0) swapLeft[k] = swapLeft[k] > swapFade ? swapLeft[k] - swapFade : 0;
        if (target > 0 && speedSquared > 1) {
          const inverse = 1 / speedSquared;
          orientC[k] += ((flowX * flowX - flowY * flowY) * inverse - orientC[k]) * steer;
          orientS[k] += (2 * flowX * flowY * inverse - orientS[k]) * steer;
          settleTurn(k, before <= 0);
        }
        if (core[k] > strongest) strongest = core[k];
      }
    }
    state.maxCore = strongest;
  }

  function pack() {
    for (let k = 0, at = 0; k < count; k += 1, at += 4) {
      fieldPack[at] = dye[k];
      fieldPack[at + 1] = core[k];
      fieldPack[at + 2] = turn[k];
      fieldPack[at + 3] = previousTurn[k] + swapLeft[k];
      tintPack[at] = tintR[k];
      tintPack[at + 1] = tintG[k];
      tintPack[at + 2] = tintB[k];
      tintPack[at + 3] = stain[k];
    }
  }

  function step(dt, { velocityTau, dyeTau, dyeStillShare, stainTau, vorticity, iterations, maxSpeed, structured }) {
    curlFresh = vorticity > 0;
    if (curlFresh) confine(dt, vorticity);
    advectVelocity(dt, Math.exp(-dt / velocityTau));
    project(iterations);
    subtractGradient(maxSpeed);
    applyKicks();
    measureDrift();
    advectDye(dt, dyeTau, dyeStillShare, DYE_DIFFUSION);
    advectStain(dt, stainTau);
    structure(dt, structured);
    measureRows();
  }

  function fade(velocityKeep, dyeKeep) {
    for (let k = 0; k < count; k += 1) {
      u[k] *= velocityKeep;
      v[k] *= velocityKeep;
      dye[k] *= dyeKeep;
      stain[k] *= dyeKeep;
      tintR[k] *= dyeKeep;
      tintG[k] *= dyeKeep;
      tintB[k] *= dyeKeep;
      core[k] *= dyeKeep;
    }
  }

  function clear() {
    u.fill(0);
    v.fill(0);
    dye.fill(0);
    pressure.fill(0);
    kickU.fill(0);
    kickV.fill(0);
    stain.fill(0);
    tintR.fill(0);
    tintG.fill(0);
    tintB.fill(0);
    core.fill(0);
    swapLeft.fill(0);
    curlPeak = 0;
    kicked = false;
    stained = false;
    rowWeight.fill(0);
    rowFlow.fill(0);
    state.idle = true;
    state.maxDye = 0;
    state.maxSpeed = 0;
    state.maxStain = 0;
    state.maxCore = 0;
  }

  state.splat = splat;
  state.impulse = impulse;
  state.step = step;
  state.fade = fade;
  state.clear = clear;
  state.pack = pack;
  return state;
}
