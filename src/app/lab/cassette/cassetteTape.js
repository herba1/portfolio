export const HUBS = [
  { x: -21, z: -2, s: -1 },
  { x: 21, z: -2, s: 1 },
];
export const CORE = 11;
export const FULL = 24;
export const TOTAL = 15400;
export const THICK = (Math.PI * (FULL * FULL - CORE * CORE)) / TOTAL;
export const SIDE_SECONDS = 1800;
export const TAPE_Y = 6;
export const TAPE_HALF = 1.905;
export const ROLLER = { x: 36, z: 27.4, r: 2 };
export const MOUTH = { x: 23, z: 29.4, edge: 31.9 };
export const SLACK_MAX = 105;
const SLACK_SOFT = 62;

const SPRING = 720;
const DAMPING = 0.92;
const COULOMB = 5;
const VISCOUS = 0.9;
const MAX_OMEGA = 40;
const SUBSTEPS = 8;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function packRadius(length) {
  return Math.sqrt(CORE * CORE + (Math.max(0, length) * THICK) / Math.PI);
}

export function inertia(radius) {
  const r4 = radius ** 4;
  const c4 = CORE ** 4;
  return 1 + (2.2 * (r4 - c4)) / (FULL ** 4 - c4);
}

export function createTape(startFraction = 0.38) {
  return {
    length: [TOTAL * (1 - startFraction), TOTAL * startFraction],
    omega: [0, 0],
    theta: [0.4, 2.1],
    slack: 0,
    speed: 0,
    snap: 0,
    stop: 0,
  };
}

function friction(omega, inertiaValue, h) {
  const w = omega * Math.exp((-VISCOUS * (0.4 + 0.6 * inertiaValue) * h) / inertiaValue);
  const drop = ((COULOMB * (0.4 + 0.6 * inertiaValue)) / inertiaValue) * h;
  if (Math.abs(w) <= drop) return 0;
  return w - Math.sign(w) * drop;
}

export function stepTape(tape, dt, drive) {
  const h = dt / SUBSTEPS;
  let snap = 0;
  let stop = 0;
  let travelled = 0;
  for (let n = 0; n < SUBSTEPS; n += 1) {
    const radius = [packRadius(tape.length[0]), packRadius(tape.length[1])];
    const mass = [inertia(radius[0]), inertia(radius[1])];
    for (let i = 0; i < 2; i += 1) {
      if (drive && drive.held && drive.hub === i) {
        const c = 2 * DAMPING * Math.sqrt(SPRING * mass[i]);
        const torque = SPRING * (drive.target - tape.theta[i]) - c * tape.omega[i];
        tape.omega[i] += (torque / mass[i]) * h;
      } else {
        tape.omega[i] = friction(tape.omega[i], mass[i], h);
      }
      tape.omega[i] = clamp(tape.omega[i], -MAX_OMEGA, MAX_OMEGA);
    }
    const take = [HUBS[0].s * tape.omega[0] * radius[0], HUBS[1].s * tape.omega[1] * radius[1]];
    const closing = take[0] + take[1];
    if (tape.slack <= 1e-4 && closing > 0) {
      const m0 = mass[0] / (radius[0] * radius[0]);
      const m1 = mass[1] / (radius[1] * radius[1]);
      const w = (m0 * take[0] - m1 * take[1]) / (m0 + m1);
      if (tape.wasSlack) snap = Math.max(snap, closing);
      take[0] = w;
      take[1] = -w;
    }
    for (let i = 0; i < 2; i += 1) {
      if (take[i] < 0 && tape.length[i] <= 0) {
        if (Math.abs(take[i]) > 20) stop = Math.max(stop, Math.abs(take[i]));
        take[i] = 0;
        if (tape.slack <= 1e-4) take[1 - i] = Math.min(0, take[1 - i]);
      }
    }
    if (tape.slack > SLACK_SOFT) {
      const give = clamp(1 - (tape.slack - SLACK_SOFT) / (SLACK_MAX - SLACK_SOFT), 0, 1);
      for (let i = 0; i < 2; i += 1) if (take[i] < 0) take[i] *= give;
    }
    for (let i = 0; i < 2; i += 1) {
      tape.omega[i] = take[i] / (HUBS[i].s * radius[i]);
      tape.theta[i] += tape.omega[i] * h;
      tape.length[i] = Math.max(0, tape.length[i] + take[i] * h);
    }
    tape.slack = Math.max(0, TOTAL - tape.length[0] - tape.length[1]);
    if (tape.slack < 1e-4) {
      const over = tape.length[0] + tape.length[1] - TOTAL;
      if (over > 0) tape.length[take[0] > take[1] ? 1 : 0] -= over;
      tape.slack = 0;
    }
    tape.wasSlack = tape.slack > 0.05;
    travelled += ((take[1] - take[0]) / 2) * h;
  }
  tape.speed = travelled / dt;
  tape.snap = snap;
  tape.stop = stop;
  return tape;
}

export function tapeSeconds(tape) {
  return (tape.length[1] / TOTAL) * SIDE_SECONDS;
}

function tangentLeft(cx, cz, radius) {
  const dx = -ROLLER.x - cx;
  const dz = ROLLER.z - cz;
  const dist = Math.hypot(dx, dz);
  const base = Math.atan2(dz, dx);
  const beta = Math.acos(clamp((radius - ROLLER.r) / dist, -1, 1));
  const a = base + beta;
  const b = base - beta;
  const ang = Math.cos(a) < Math.cos(b) ? a : b;
  const nx = Math.cos(ang);
  const nz = Math.sin(ang);
  return { p1: [cx + radius * nx, cz + radius * nz], p2: [-ROLLER.x + ROLLER.r * nx, ROLLER.z + ROLLER.r * nz], ang };
}

function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

function loopControls(height) {
  const flare = Math.max(0, height - 4) * 1.05;
  const p0 = [-MOUTH.x, MOUTH.z];
  const p3 = [MOUTH.x, MOUTH.z];
  return [p0, [p0[0] - flare, p0[1] + height * 1.2], [p3[0] + flare, p3[1] + height * 1.2], p3];
}

function loopLength(height) {
  const [p0, p1, p2, p3] = loopControls(height);
  let len = 0;
  let prev = p0;
  for (let i = 1; i <= 32; i += 1) {
    const p = bezier(p0, p1, p2, p3, i / 32);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return len;
}

export function loopHeightFor(slack) {
  if (slack <= 0.01) return 0;
  const want = MOUTH.x * 2 + slack;
  let lo = 0;
  let hi = 160;
  for (let i = 0; i < 22; i += 1) {
    const mid = (lo + hi) / 2;
    if (loopLength(mid) < want) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function tapePath(radiusLeft, radiusRight, loopHeight, out) {
  out.length = 0;
  const push = (x, z) => out.push([x, z]);
  const side = (radius, mirror) => {
    const { p1, p2, ang } = tangentLeft(HUBS[0].x, HUBS[0].z, radius);
    const pts = [];
    for (let i = 0; i <= 10; i += 1) {
      const t = i / 10;
      pts.push([p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t]);
    }
    let a0 = ang;
    if (a0 < Math.PI / 2) a0 += Math.PI * 2;
    for (let i = 1; i <= 10; i += 1) {
      const a = a0 + (Math.PI / 2 - a0) * (i / 10);
      pts.push([-ROLLER.x + ROLLER.r * Math.cos(a), ROLLER.z + ROLLER.r * Math.sin(a)]);
    }
    for (let i = 1; i <= 6; i += 1) {
      const t = i / 6;
      pts.push([-ROLLER.x + (ROLLER.x - MOUTH.x) * t, MOUTH.z]);
    }
    return mirror ? pts.map(([x, z]) => [-x, z]).reverse() : pts;
  };
  for (const p of side(radiusLeft, false)) push(p[0], p[1]);
  const [c0, c1, c2, c3] = loopControls(loopHeight);
  const steps = 72;
  for (let i = 1; i < steps; i += 1) {
    const p = bezier(c0, c1, c2, c3, i / steps);
    push(p[0], p[1]);
  }
  for (const p of side(radiusRight, true)) push(p[0], p[1]);
  return out;
}
