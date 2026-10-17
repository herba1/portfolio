export const SLOTS = 20;
export const SLOT_ANGLE = (Math.PI * 2) / SLOTS;
export const SIDE_SECONDS = 40;

const STEP = 1 / 240;
const TAU = Math.PI * 2;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const wrapPi = (x) => x - TAU * Math.round(x / TAU);

function spring(state, key, goal, dt, freq, vmax, amax) {
  const vKey = `${key}V`;
  const x = state[key];
  let v = state[vKey];
  const a = clamp(freq * freq * (goal - x) - 2 * freq * v, -amax, amax);
  v = clamp(v + a * dt, -vmax, vmax);
  let next = x + v * dt;
  if (Math.abs(goal - next) < 0.003 && Math.abs(v) < 0.08) {
    next = goal;
    v = 0;
  }
  state[vKey] = v;
  state[key] = next;
}

export function createRig({ start, armYaw, onClick, onContact, onSeat }) {
  const s = {
    theta: -start * SLOT_ANGLE,
    thetaV: 0,
    thetaGoal: -start * SLOT_ANGLE,
    out: start,
    tau: 1,
    tauV: 0,
    e: 0,
    eV: 0,
    g: 0,
    gV: 0,
    w: 0,
    phi: 0,
    yaw: armYaw.rest,
    yawV: 0,
    h: 1,
    hV: 0,
    want: start,
    playT: 0,
    finished: true,
    dropped: false,
    contact: false,
    notch: start,
    spin: new Float32Array(SLOTS),
    goals: {},
  };

  const goals = { tau: 1, e: 0, g: 0, w: 0, yaw: armYaw.rest, h: 1 };

  const settledCarousel = () => Math.abs(wrapPi(s.thetaGoal - s.theta)) < 0.004 && Math.abs(s.thetaV) < 0.05;

  function plan() {
    const want = s.want;
    const parked = s.h > 0.85 && Math.abs(s.yaw - armYaw.rest) < 0.22;
    goals.h = 1;
    goals.yaw = s.h > 0.75 ? armYaw.rest : s.yaw;
    goals.w = 0;
    const wasDropped = s.dropped;
    s.dropped = false;
    if (s.out !== null && s.out !== want) {
      if (s.tau >= 0.998) {
        goals.tau = 1;
        goals.g = 1;
        if (s.e >= 0.94) goals.tau = 0;
        goals.e = parked && s.w < 0.08 && s.g > 0.97 ? 1 : s.e > 0.5 ? 1 : 0;
      } else if (s.tau > 0.002) {
        goals.g = 1;
        goals.e = 1;
        goals.tau = 0;
      } else {
        goals.g = 1;
        goals.tau = 0;
        goals.e = 0;
        if (s.e < 0.02) {
          s.out = null;
          onSeat?.();
        }
      }
      return;
    }
    if (s.out === null) {
      goals.g = 1;
      goals.e = 0;
      goals.tau = 0;
      s.thetaGoal = -want * SLOT_ANGLE;
      if (settledCarousel() && s.e < 0.04 && s.g > 0.97) {
        s.theta = s.thetaGoal + wrapPi(s.theta - s.thetaGoal);
        s.notch = Math.round(-s.theta / SLOT_ANGLE);
        s.out = want;
      }
      return;
    }
    if (s.tau < 0.998 || s.e > 0.02) {
      goals.g = 1;
      if (s.tau < 0.002 && s.e < 0.98) {
        goals.e = s.g > 0.97 ? 1 : 0;
        goals.tau = 0;
      } else if (s.tau < 0.998) {
        goals.e = 1;
        goals.tau = s.e > 0.94 ? 1 : s.tau;
      } else {
        goals.e = 0;
        goals.tau = 1;
      }
      return;
    }
    goals.tau = 1;
    goals.e = 0;
    goals.g = 0;
    if (s.finished) return;
    goals.w = 1;
    if (s.w > 0.5 && s.g < 0.6) {
      const target = armYaw.at(clamp(s.playT / SIDE_SECONDS, 0, 1));
      goals.yaw = target;
      if (Math.abs(s.yaw - target) < 0.012 || wasDropped) {
        goals.h = 0;
        s.dropped = true;
      }
    }
  }

  function substep(dt) {
    plan();
    const err = wrapPi(s.thetaGoal - s.theta);
    const near = clamp(1 - Math.abs(err) / (SLOT_ANGLE * 1.2), 0, 1);
    const drive = clamp(70 * err, -9.5, 9.5);
    const detent = -5 * Math.sin(SLOTS * s.theta) * (s.out === null ? 1 : 2.4);
    const damp = (4.4 + 18 * near * near) * s.thetaV;
    s.thetaV = clamp(s.thetaV + (drive + detent - damp) * dt, -3.4, 3.4);
    s.theta += s.thetaV * dt;
    const notch = Math.round(-s.theta / SLOT_ANGLE);
    if (notch !== s.notch) {
      s.notch = notch;
      onClick?.(Math.min(1, Math.abs(s.thetaV) / 1.6));
    }
    spring(s, "tau", goals.tau, dt, 10, 1.7, 7.5);
    if (s.tau < 0) {
      s.tau = 0;
      s.tauV = Math.max(0, s.tauV);
    } else if (s.tau > 1) {
      s.tau = 1;
      s.tauV = Math.min(0, s.tauV);
    }
    spring(s, "e", goals.e, dt, 18, 7, 70);
    s.e = clamp(s.e, 0, 1);
    spring(s, "g", goals.g, dt, 9, 3, 18);
    s.g = clamp(s.g, 0, 1);
    const wRate = goals.w > s.w ? 0.3 : 0.16;
    s.w += (goals.w - s.w) * (1 - Math.exp(-dt / wRate));
    if (Math.abs(goals.w - s.w) < 0.002) s.w = goals.w;
    spring(s, "yaw", goals.yaw, dt, 7.5, 2.4, 14);
    spring(s, "h", goals.h, dt, goals.h < s.h ? 11 : 13, 3.6, 40);
    s.h = clamp(s.h, 0, 1);
    s.phi -= s.w * (TAU * 0.75) * dt;
    if (s.out !== null && s.tau >= 0.998 && s.e < 0.05) s.spin[s.out] = s.phi;
    const contact = s.h < 0.035 && s.dropped;
    if (contact !== s.contact) {
      s.contact = contact;
      onContact?.(contact, s.out);
    }
    if (contact) {
      s.playT += dt;
      if (s.playT >= SIDE_SECONDS) s.finished = true;
    }
  }

  function step(dt) {
    let left = dt;
    while (left > 1e-6) {
      const h = Math.min(STEP, left);
      substep(h);
      left -= h;
    }
  }

  function select(index) {
    if (index === s.want) {
      if (s.finished && s.out === index) {
        s.finished = false;
        s.playT = 0;
        return true;
      }
      return false;
    }
    s.want = index;
    s.finished = false;
    s.playT = 0;
    return true;
  }

  function busy() {
    if (s.contact) return true;
    if (Math.abs(wrapPi(s.thetaGoal - s.theta)) > 2e-4 || Math.abs(s.thetaV) > 1e-3) return true;
    for (const k of ["tau", "e", "g", "yaw", "h"]) {
      if (Math.abs(s[k] - goals[k]) > 2e-4 || Math.abs(s[`${k}V`]) > 1e-3) return true;
    }
    if (Math.abs(s.w - goals.w) > 1e-4 || s.w > 1e-4) return true;
    if (s.out !== s.want) return true;
    return !s.finished && !s.contact ? true : false;
  }

  function phase() {
    if (s.contact) return "playing";
    if (s.out !== s.want || s.tau < 0.998 || s.e > 0.02) return "fetching";
    if (!s.finished) return "cueing";
    return "idle";
  }

  plan();
  return { state: s, goals, step, select, busy, phase };
}
