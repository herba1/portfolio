import { DYE_DIFFUSION, DYE_MOVING_SPEED, PRESSURE_CARRY } from "./stirParams";

export function createFluid(cols, rows, cellW, cellH) {
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
    get dye() {
      return dye;
    },
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

  function splat(px, py, vx, vy, grip, dyeAmount, dyeCap, radius, reach, dyeRadius = radius) {
    const centreI = px / cellW - 0.5;
    const centreJ = py / cellH - 0.5;
    const spanI = Math.ceil((radius * reach) / cellW);
    const spanJ = Math.ceil((radius * reach) / cellH);
    const iStart = Math.max(0, Math.floor(centreI - spanI));
    const iEnd = Math.min(lastCol, Math.ceil(centreI + spanI));
    const jStart = Math.max(0, Math.floor(centreJ - spanJ));
    const jEnd = Math.min(lastRow, Math.ceil(centreJ + spanJ));
    if (iStart > iEnd || jStart > jEnd) return;
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
        if (dyeAmount > 0 && dye[k] < dyeCap) {
          const dyeFalloff = sharedFalloff ? falloff : Math.exp(-squared * inverseDyeRadius);
          dye[k] += (dyeCap - dye[k]) * Math.min(1, dyeAmount * dyeFalloff);
        }
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

  function confine(dt, strength) {
    for (let j = 0; j < rows; j += 1) {
      const row = j * cols;
      for (let i = 0; i < cols; i += 1) {
        const k = row + i;
        const left = i > 0 ? k - 1 : k;
        const right = i < lastCol ? k + 1 : k;
        const up = j > 0 ? k - cols : k;
        const down = j < lastRow ? k + cols : k;
        curl[k] = (v[right] - v[left]) * halfInvW - (u[down] - u[up]) * halfInvH;
      }
    }
    const push = dt * strength;
    for (let j = 1; j < lastRow; j += 1) {
      const row = j * cols;
      for (let i = 1; i < lastCol; i += 1) {
        const k = row + i;
        const gradX = (Math.abs(curl[k + 1]) - Math.abs(curl[k - 1])) * halfInvW;
        const gradY = (Math.abs(curl[k + cols]) - Math.abs(curl[k - cols])) * halfInvH;
        const length = Math.sqrt(gradX * gradX + gradY * gradY) + 1e-5;
        const spin = curl[k];
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
        dyeHat[k] = sample(dye, i - u[k] * stepX, j - v[k] * stepY);
      }
    }
    for (let j = 0; j < rows; j += 1) {
      const row = j * cols;
      for (let i = 0; i < cols; i += 1) {
        const k = row + i;
        const centre = dye[k];
        const flowX = u[k];
        const flowY = v[k];
        const driftX = flowX * stepX;
        const driftY = flowY * stepY;
        const back = sample(dyeHat, i + driftX, j + driftY);
        const carried = limit(dye, i - driftX, j - driftY, dyeHat[k] + 0.5 * (centre - back));
        const left = i > 0 ? dye[k - 1] : centre;
        const right = i < lastCol ? dye[k + 1] : centre;
        const up = j > 0 ? dye[k - cols] : centre;
        const down = j < lastRow ? dye[k + cols] : centre;
        const motion = Math.sqrt(flowX * flowX + flowY * flowY) * inverseMoving;
        const keep = Math.exp(-inverseTau / (stillShare + movingShare * (motion < 1 ? motion : 1)));
        const settled = (carried + ((left + right + up + down) * 0.25 - centre) * spread) * keep;
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

  function step(dt, { velocityTau, dyeTau, dyeStillShare, vorticity, iterations, maxSpeed }) {
    if (vorticity > 0) confine(dt, vorticity);
    advectVelocity(dt, Math.exp(-dt / velocityTau));
    project(iterations);
    subtractGradient(maxSpeed);
    applyKicks();
    advectDye(dt, dyeTau, dyeStillShare, DYE_DIFFUSION);
  }

  function fade(velocityKeep, dyeKeep) {
    for (let k = 0; k < count; k += 1) {
      u[k] *= velocityKeep;
      v[k] *= velocityKeep;
      dye[k] *= dyeKeep;
    }
  }

  function clear() {
    u.fill(0);
    v.fill(0);
    dye.fill(0);
    pressure.fill(0);
    kickU.fill(0);
    kickV.fill(0);
    kicked = false;
    state.maxDye = 0;
    state.maxSpeed = 0;
  }

  state.splat = splat;
  state.impulse = impulse;
  state.step = step;
  state.fade = fade;
  state.clear = clear;
  return state;
}
